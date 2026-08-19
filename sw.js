/* ==========================================================================
   Core Verbs - 서비스 워커 (sw.js)
   앱 셸을 캐시해 홈 화면 설치(PWA) 및 오프라인 실행을 지원한다.
   ※ 저장된 학습 자료(JSON)는 앱 셸과 함께 캐시하고, 구글 시트·폰트 등 외부 리소스는 네트워크로 요청한다.
   ========================================================================== */

const CACHE_NAME = 'core-verbs-shell-v4';

// 앱 셸(자체 호스팅 파일)만 사전 캐시한다.
const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './learning-engine.js',
    './data/learning-content.json',
    './app.js',
    './manifest.webmanifest',
    './icon-192.png',
    './icon-512.png',
    './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;

    // GET 외(POST 등)·교차 출처(구글 시트, 폰트 CDN) 요청은 그대로 네트워크로 통과시킨다.
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
        return;
    }

    // 같은 출처의 앱 셸은 캐시 우선(없으면 네트워크 후 캐시 갱신)으로 제공한다.
    event.respondWith(
        caches.match(req).then((cached) => {
            const network = fetch(req).then((res) => {
                if (res && res.status === 200 && res.type === 'basic') {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                }
                return res;
            }).catch(() => cached);

            return cached || network;
        })
    );
});

/* ==========================================================================
   Core Verbs - 서비스 워커 (sw.js)
   앱 셸을 캐시해 홈 화면 설치(PWA) 및 오프라인 실행을 지원한다.
   ※ 저장된 학습 자료(JSON)는 앱 셸과 함께 캐시하고, 구글 시트·폰트 등 외부 리소스는 네트워크로 요청한다.
   ========================================================================== */

const CACHE_NAME = 'core-verbs-shell-v15';

// 앱 셸(자체 호스팅 파일)만 사전 캐시한다.
const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './learning-engine.js',
    './data/learning-content.json',
    './data/make-chunk-overrides.json',
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

    // 온라인에서는 최신 자료를 먼저 받고, 연결이 없을 때만 캐시를 사용한다.
    event.respondWith(
        fetch(req).then((res) => {
                if (res && res.status === 200 && res.type === 'basic') {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                }
                return res;
            })
            .catch(() => caches.match(req))
    );
});

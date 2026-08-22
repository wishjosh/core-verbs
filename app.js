/* ==========================================================================
   Core Verbs - 프리미엄 애플리케이션 로직 (app.js)
   ========================================================================== */

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSR1wby3k5QhlAL8f8MeH-Ni1qjGgRMu8ROHDoPCKci-GYrbpx1DzTsAvcr_l5qBcemui93D4cqMLa0/pub?output=tsv";
const CONTENT_URL = './data/learning-content.json';
const MAKE_CHUNK_OVERRIDES_URL = './data/make-chunk-overrides.json';
const pageParams = new URLSearchParams(window.location.search);
const meaningFlowPilotMode = pageParams.get('pilot') === 'meaning-flow';
const requestedVerbPilot = String(pageParams.get('verb') || '').trim().toUpperCase();
const STORAGE_KEY = 'coreVerbs_Memory_v1';
const DAILY_NEW_LIMIT = 10;
const SESSION_CARD_LIMIT = 20;
const Learning = window.CoreVerbsLearning;

if (!Learning) {
    throw new Error('learning-engine.js를 먼저 불러와야 합니다.');
}

// 🧠 애플리케이션 상태(State) 변수
let db = [];
let todayCards = [];
let currentIndex = 0;
let availableVoices = [];
let iosResumeTimer = null; // iOS Speech Synthesis 중간 무음 버그 방지 타이머
let currentPractice = null;
let currentChunkPlan = null;
let currentChunkStage = 0;
let selectedPracticeIds = [];
let currentPracticeResult = null;
let practiceUsedHint = false;
let selectedMistakeIndexes = [];
let addedWordMistakes = [];
let insertionEditorOpen = false;
let wordOrderMistake = false;
let currentAssessmentRecorded = false;
let sessionRetryCounts = {};
let currentSessionPlan = {
    dailyNewLimit: DAILY_NEW_LIMIT,
    newTarget: 0,
    reviewTarget: 0,
    total: 0
};

// 💾 학습 진행 상태 및 사용자 설정 로드
let progressData = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};

// ⚙️ 디폴트 음성 설정 구조 초기화 (로컬 스토리지 데이터 무결성 보존)
if (!progressData.settings) {
    progressData.settings = {
        voiceName: '',
        rate: 0.9
    };
}

/* ==========================================================================
   🔊 고품질 TTS 원어민 오디오 엔진 로직
   ========================================================================== */

/**
 * 🎙️ 브라우저 탑재 목소리들에 품질 점수를 할당해 가장 인토네이션이 뛰어난 목소리를 찾는 알고리즘
 */
function scoreVoice(voice) {
    const name = voice.name.toLowerCase();
    const lang = voice.lang.toLowerCase().replace('_', '-'); // iOS는 en_US처럼 언더스코어를 쓰는 경우가 있어 정규화
    
    // 🚫 iOS/macOS 시스템 특유의 알람 벨소리, 로봇 소리 등 언어 학습에 무의미한 장난형/경고형 목소리 필터링
    const noveltyVoices = [
        'bells', 'cellos', 'good news', 'bad news', 'hysterical', 'zarvox', 
        'boing', 'bubbles', 'deranged', 'pipe organ', 'trinoids', 'whisper', 
        'albert', 'junior', 'bahh', 'wobble', 'superstar', 'organ', 'laugh', 
        'badnews', 'goodnews'
    ];
    if (noveltyVoices.some(novelty => name.includes(novelty))) {
        return -1; // 필터 아웃
    }
    
    let score = 0;
    
    // 미국 영어(en-US)를 기본 선호하지만, 모든 영어 권역(en-*)을 지원
    if (lang === 'en-us') {
        score += 15;
    } else if (lang.startsWith('en-')) {
        score += 5;
    } else {
        return -1; // 영어 발음이 아니면 후보군에서 제외
    }
    
    // 1순위: Edge 등의 클라우드 기반 초고품질 자연어 발음 (Online / Natural / Neural)
    if (name.includes('natural') || name.includes('online') || name.includes('neural')) {
        score += 100;
    }
    // 2순위: Chrome Google 고품질 온라인 발음
    else if (name.includes('google')) {
        score += 50;
    }
    // 3순위: Apple iOS/macOS Enhanced (다운로드형 고품질) > Siri/Samantha 기본형
    else if (name.includes('enhanced') || name.includes('premium')) {
        score += 50; // Enhanced 다운로드 목소리는 Neural급에 준하는 품질
    }
    else if (name.includes('siri') || name.includes('samantha')) {
        score += 40;
    }
    // 4순위: 일반 기본 로컬 기계음 (Microsoft David 등)
    else if (name.includes('desktop') || name.includes('david') || name.includes('zira') || name.includes('hazel')) {
        score += 10;
    }
    
    return score;
}

/**
 * 🗣️ 브라우저의 목소리 풀에서 유효한 영어 목소리를 가져와 점수 역순(추천 고품질 순)으로 정렬
 */
function getSortedEnglishVoices() {
    const rawVoices = window.speechSynthesis.getVoices();
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const englishVoices = [];

    rawVoices.forEach(voice => {
        const name = voice.name.toLowerCase();
        // iOS: Web Speech API로 접근 가능한 유의미한 목소리는 Samantha(미국)와 Daniel(영국)뿐
        if (isIOS && !name.includes('samantha') && !name.includes('daniel')) return;

        const score = scoreVoice(voice);
        if (score > 0) {
            englishVoices.push({ voice, score });
        }
    });

    englishVoices.sort((a, b) => b.score - a.score);
    return englishVoices.map(item => item.voice);
}

/**
 * 🏷️ 원어민 목소리 이름의 특징, 성별, 악센트 및 뉘앙스를 사람 친화적인 한국어 라벨로 반환하는 딕셔너리 및 포맷터
 */
function getFriendlyVoiceLabel(voice, index) {
    const name = voice.name;
    const lang = voice.lang.toLowerCase().replace('_', '-');
    
    // 1. 국기 이모지 및 지역 맵핑
    let flag = '🇺🇸';
    let region = '미국';
    if (lang === 'en-gb' || lang.startsWith('en-gb')) {
        flag = '🇬🇧';
        region = '영국';
    } else if (lang === 'en-au' || lang.startsWith('en-au')) {
        flag = '🇦🇺';
        region = '호주';
    } else if (lang === 'en-ca' || lang.startsWith('en-ca')) {
        flag = '🇨🇦';
        region = '캐나다';
    } else if (lang === 'en-in' || lang.startsWith('en-in')) {
        flag = '🇮🇳';
        region = '인도';
    } else if (lang === 'en-ie' || lang.startsWith('en-ie')) {
        flag = '🇮🇪';
        region = '아일랜드';
    } else if (lang === 'en-nz' || lang.startsWith('en-nz')) {
        flag = '🇳🇿';
        region = '뉴질랜드';
    } else if (lang === 'en-za' || lang.startsWith('en-za')) {
        flag = '🇿🇦';
        region = '남아공';
    }
    
    // 2. 대표적인 고품질 영어 목소리 스타일 사전 정의
    const voiceMap = {
        // --- Microsoft Edge Online Natural Voices (신경망 기반 초고품질 추천) ---
        'microsoft aria online (natural)': { gender: '여성', name: 'Aria', desc: '지적이고 신뢰감 넘치는 뉴스 아나운서 톤 (강력 추천 🌟)' },
        'microsoft jenny online (natural)': { gender: '여성', name: 'Jenny', desc: '밝고 생동감 도는 일상 대화형 목소리 (강력 추천 🌟)' },
        'microsoft guy online (natural)': { gender: '남성', name: 'Guy', desc: '중저음의 중후하고 차분한 남성 표준 목소리 (추천 🌟)' },
        'microsoft michelle online (natural)': { gender: '여성', name: 'Michelle', desc: '또박또박하고 명확한 어조의 지적인 비즈니스 톤 🌟' },
        'microsoft roger online (natural)': { gender: '남성', name: 'Roger', desc: '신뢰감 높은 깔끔한 사내 프레젠테이션 스타일 🌟' },
        'microsoft ryan online (natural)': { gender: '남성', name: 'Ryan', desc: '세련되고 지적인 명품 억양 🌟' },
        'microsoft sonia online (natural)': { gender: '여성', name: 'Sonia', desc: '고급스럽고 우아한 클래식 영국 귀족풍 악센트 🌟' },
        'microsoft libby online (natural)': { gender: '여성', name: 'Libby', desc: '현대적이고 또렷또렷 맑은 영국 오디오북 성우 발음 🌟' },
        'microsoft natasha online (natural)': { gender: '여성', name: 'Natasha', desc: '부드럽고 자연스러운 호주 현지 원어민 발음 🌟' },
        'microsoft clara online (natural)': { gender: '여성', name: 'Clara', desc: '잡음 없이 차분하고 단정한 캐나다 정석 발음 🌟' },
        'microsoft liam online (natural)': { gender: '남성', name: 'Liam', desc: '지적인 학구열이 느껴지는 캐나다 표준 남성 음성 🌟' },
        
        // --- Google Chrome English Voices (인공지능 고품질형) ---
        'google us english': { gender: '여성', name: 'Google US', desc: '또박또박하고 속도가 고른 교과서 표준 발음 (학습용 추천 ✨)' },
        'google uk english female': { gender: '여성', name: 'Google UK', desc: 'BBC 뉴스 리포터 스타일의 정통 영국 발음 ✨' },
        'google uk english male': { gender: '남성', name: 'Google UK', desc: '낮은 톤으로 부드럽게 읊조리는 교과서적 영국 발음 ✨' },
        'google australia english': { gender: '여성', name: 'Google AU', desc: '깔끔하고 정돈된 명확한 호주식 영어 발음 ✨' },

        // --- Apple macOS/iOS Siri & System Voices (디바이스 프리미엄형) ---
        'samantha (enhanced)': { gender: '여성', name: 'Samantha Enhanced', desc: 'iOS 다운로드 고품질 목소리, 자연스럽고 부드러운 원어민 억양 🌟' },
        'samantha': { gender: '여성', name: 'Samantha', desc: 'iOS 기본 AI 음성, 아주 친숙하고 부드러운 억양 ✨' },
        'nathan (enhanced)': { gender: '남성', name: 'Nathan Enhanced', desc: '자연스럽고 현대적인 미국 남성 고품질 목소리 🌟' },
        'nathan': { gender: '남성', name: 'Nathan', desc: '명확하고 표준적인 미국 남성 표준 발음 ✨' },
        'siri': { gender: '여성', name: 'Siri', desc: '아이폰 시리 특유의 현실감 넘치는 대화 톤 ✨' },
        'daniel': { gender: '남성', name: 'Daniel', desc: '발음이 매우 뚜렷하고 정석에 가깝게 들리는 영국 신사 발음 ✨' },
        'karen': { gender: '여성', name: 'Karen', desc: '호주 정통 악센트가 단정하게 적용된 목소리 ✨' },
        
        // --- Standard Local Windows Voices (윈도우 기본 탑재 오프라인 기계음) ---
        'microsoft david desktop': { gender: '남성', name: 'David', desc: '윈도우 기본 오프라인 기계음 (투박하고 딱딱함)' },
        'microsoft zira desktop': { gender: '여성', name: 'Zira', desc: '윈도우 기본 오프라인 기계음 (로봇 같고 건조함)' },
        'microsoft hazel desktop': { gender: '여성', name: 'Hazel', desc: '윈도우 기본 오프라인 영국 기계음 (조금 답답함)' }
    };
    
    const nameLower = name.toLowerCase();
    
    // 사전에 매핑된 시그니처 목소리가 있는지 검색
    let foundKey = Object.keys(voiceMap).find(key => nameLower.includes(key));
    if (foundKey) {
        const info = voiceMap[foundKey];
        return `${flag} [${region} ${info.gender}] ${info.name} - ${info.desc}`;
    }
    
    // 사전 외의 새로운 목소리가 로드되었을 경우의 자동 추출 파싱 처리 (미래 확장성)
    let gender = '여성'; 
    if (nameLower.includes('male') || nameLower.includes('guy') || nameLower.includes('ryan') || nameLower.includes('liam') || nameLower.includes('david') || nameLower.includes('george')) {
        gender = '남성';
    }
    
    let quality = '기본 오디오';
    if (nameLower.includes('natural') || nameLower.includes('online')) {
        quality = '신경망 고품질 추천 🌟';
    } else if (nameLower.includes('google') || nameLower.includes('siri') || nameLower.includes('enhanced')) {
        quality = '인공지능 고품질 ✨';
    }
    
    let cleanName = name.split(' - ')[0].replace('Online', '').replace('(Natural)', '').trim();
    return `${flag} [${region} ${gender}] ${cleanName} - ${quality}`;
}

/**
 * ⚙️ 발음 설정창 드롭다운 목록을 빌드하고 디폴트값 세팅
 */
function populateVoiceList() {
    availableVoices = getSortedEnglishVoices();
    const voiceSelect = document.getElementById('voice-select');
    if (!voiceSelect) return;
    
    voiceSelect.innerHTML = '';
    
    if (availableVoices.length === 0) {
        const opt = document.createElement('option');
        opt.textContent = "사용 가능한 영어 발음 없음";
        voiceSelect.appendChild(opt);
        return;
    }
    
    availableVoices.forEach((voice, index) => {
        const option = document.createElement('option');
        option.value = voice.name;
        
        // 🌟 친근한 한글 스타일 설명이 덧붙여진 레이블 생성
        option.textContent = getFriendlyVoiceLabel(voice, index);
        voiceSelect.appendChild(option);
    });
    
    // 이전에 저장한 설정이 있는지 체크
    const savedVoiceName = progressData.settings.voiceName;
    if (savedVoiceName && availableVoices.some(v => v.name === savedVoiceName)) {
        voiceSelect.value = savedVoiceName;
    } else {
        // 이전에 저장된 음성이 없거나 없는 음성인 경우 가장 추천도가 높은 1순위 자동 지정
        const bestVoice = availableVoices[0];
        progressData.settings.voiceName = bestVoice.name;
        voiceSelect.value = bestVoice.name;
        saveProgress();
    }
}

// 크롬, 엣지 등 비동기 목소리 감지 바인딩
if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = populateVoiceList;
    // 사파리나 일부 모바일 브라우저는 이벤트 없이 즉시 로드될 수 있으므로 동시 호출
    setTimeout(populateVoiceList, 100);
    // iOS Safari: getVoices()는 첫 사용자 터치 후에야 목소리를 반환하므로 첫 터치 시 재로드
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
        document.addEventListener('touchstart', function reloadIOSVoices() {
            if (availableVoices.length === 0) populateVoiceList();
            document.removeEventListener('touchstart', reloadIOSVoices);
        }, { once: true, passive: true });
    }
}

/**
 * ⚙️ 설정 패널 열기 / 닫기
 */
function toggleSettings() {
    const panel = document.getElementById('settings-panel');
    const overlay = document.getElementById('settings-overlay');
    if (panel && overlay) {
        panel.classList.toggle('active');
        overlay.classList.toggle('active');
        if (panel.classList.contains('active')) {
            populateVoiceList();
            // iOS: getVoices()가 첫 호출 시 빈 배열을 반환할 수 있으므로 로드될 때까지 재시도
            if (availableVoices.length === 0) {
                const retryTimer = setInterval(() => {
                    populateVoiceList();
                    if (availableVoices.length > 0) clearInterval(retryTimer);
                }, 250);
                setTimeout(() => clearInterval(retryTimer), 3000);
            }
        }
    }
}

/**
 * 🗣️ 사용자가 다른 목소리를 수동 선택했을 때 호출
 */
function changeVoice() {
    const voiceSelect = document.getElementById('voice-select');
    progressData.settings.voiceName = voiceSelect.value;
    saveProgress();
    testVoice(); // 변경한 음성을 짧게 들려줌
}

/**
 * ⚡ 사용자가 속도를 바꿨을 때 라벨 업데이트 및 스토리지 보존
 */
function updateRateLabel(value) {
    const rateVal = document.getElementById('rate-val');
    if (rateVal) {
        rateVal.innerText = `${parseFloat(value).toFixed(1)}x`;
    }
    progressData.settings.rate = parseFloat(value);
    saveProgress();
}

/**
 * 🔊 설정 변경 시 즉시 억양과 음성을 테스트 재생
 */
function testVoice() {
    window.speechSynthesis.cancel();
    const testText = "Core Verbs helps you speak natural English.";
    const utterance = new SpeechSynthesisUtterance(testText);
    
    const selectedVoiceName = progressData.settings.voiceName;
    const voice = availableVoices.find(v => v.name === selectedVoiceName);
    if (voice) {
        utterance.voice = voice;
    }
    utterance.rate = progressData.settings.rate || 0.9;
    utterance.lang = 'en-US';
    
    window.speechSynthesis.speak(utterance);
}

/**
 * 🔊 본 학습 카드 원어민 발음 재생 핵심 함수 (인토네이션 필터 탑재)
 */
function startIOSResumeHack() {
    clearInterval(iosResumeTimer);
    iosResumeTimer = setInterval(() => {
        if (!window.speechSynthesis.speaking) {
            clearInterval(iosResumeTimer);
        } else {
            window.speechSynthesis.pause();
            window.speechSynthesis.resume();
        }
    }, 3000);
}

/**
 * 🎚️ 현재 사용자 설정(목소리/속도)에 맞춘 발화 객체를 생성하는 헬퍼
 */
function buildUtterance(text) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = progressData.settings.rate || 0.9;
    utterance.pitch = 1.0;

    const selectedVoiceName = progressData.settings.voiceName;
    const voice = availableVoices.find(v => v.name === selectedVoiceName);
    if (voice) utterance.voice = voice;

    return utterance;
}

function playAudio() {
    const card = todayCards[currentIndex];
    if (!card) return;

    const text = card.en;
    clearInterval(iosResumeTimer);

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const synth = window.speechSynthesis;

    // 🔇 무음 예열(warm-up) → 본 문장 순으로 큐에 넣는다.
    //    엔진은 "유휴 상태 이후 첫 발화"의 앞 음절을 자주 씹는데,
    //    들리지 않는 예열 발화를 먼저 흘려 본 문장이 첫 발화가 되지 않게 하여
    //    시작 부분 발음이 뭉개지는 현상을 방지한다.
    const speakSequence = () => {
        const warmUp = buildUtterance(' ');
        warmUp.volume = 0; // 들리지 않게 (공백이라 발음 자체도 없음)
        warmUp.rate = 1;

        const utterance = buildUtterance(text);
        utterance.onend = () => clearInterval(iosResumeTimer);

        synth.speak(warmUp);
        synth.speak(utterance);
        if (isIOS) startIOSResumeHack();
    };

    const wasBusy = synth.speaking || synth.pending;
    synth.cancel(); // 큐에 남은 이전 발화를 비워 엔진 꼬임 방지

    if (isIOS) {
        // iOS: 오디오 정책상 user gesture 안에서 즉시(동기) 호출해야 재생됨
        speakSequence();
    } else if (wasBusy) {
        // 데스크톱(Chrome/Edge): cancel 직후 동기 speak는 누락될 수 있어 짧게 지연
        setTimeout(speakSequence, 100);
    } else {
        speakSequence();
    }
}

/* ==========================================================================
   📊 데이터 수집 & 학습 로직 (Spaced Repetition System)
   ========================================================================== */

/**
 * 💾 로컬 스토리지에 데이터 영구 저장
 */
function saveProgress() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progressData));
}

function getTodayKey() {
    return new Date().toLocaleDateString('en-CA');
}

function ensureTodayNewCards(todayStr = getTodayKey()) {
    const current = progressData.todayNewCards;
    const needsReset = !current || current.date !== todayStr || !Array.isArray(current.sentences);

    if (needsReset) {
        progressData.todayNewCards = {
            date: todayStr,
            sentences: []
        };
        saveProgress();
    }

    return progressData.todayNewCards;
}

function rememberTodayNewCards(cards) {
    const registry = ensureTodayNewCards();
    const beforeCount = registry.sentences.length;
    const sentenceSet = new Set(registry.sentences);

    cards.forEach(card => {
        if (card?.en) sentenceSet.add(card.en);
    });

    registry.sentences = Array.from(sentenceSet);

    if (registry.sentences.length !== beforeCount) {
        saveProgress();
    }
}

function isTodayNewCard(card) {
    if (!card?.en) return false;

    const registry = ensureTodayNewCards();
    return registry.sentences.includes(card.en);
}

function mapStoredContent(item) {
    return {
        id: item.id,
        day: item.day || '?',
        verb: item.verb || '',
        ko: item.naturalKo || '',
        en: item.english || '',
        assemblyChunks: Array.isArray(item.assemblyChunks) ? item.assemblyChunks : [],
        orderGlosses: Array.isArray(item.orderGlosses) ? item.orderGlosses : [],
        microChunks: Array.isArray(item.microChunks) ? item.microChunks : [],
        microOrderGlosses: Array.isArray(item.microOrderGlosses) ? item.microOrderGlosses : [],
        meaningFlow: item.meaningFlow && typeof item.meaningFlow === 'object' ? { ...item.meaningFlow } : null,
        corePatterns: Array.isArray(item.corePatterns) ? item.corePatterns : [],
        errorPoints: Array.isArray(item.errorPoints) ? item.errorPoints : [],
        reviewStatus: item.reviewStatus || 'ai_draft',
        priority: Number.isFinite(Number(item.priority)) && Number(item.priority) > 0 ? Number(item.priority) : 1
    };
}

async function fetchSheetFallback() {
        const response = await fetch(SHEET_URL);
        if (!response.ok) throw new Error(`시트 요청 실패: ${response.status}`);
        const data = await response.text();
        const rows = data.split('\n');
        const headers = (rows[0] || '').split('\t').map(header => header.replace(/^\uFEFF/, '').trim().toUpperCase());
        const columnIndex = (...names) => {
            for (const name of names) {
                const index = headers.indexOf(name);
                if (index >= 0) return index;
            }
            return -1;
        };
        const optionalValue = (cols, names) => {
            const index = columnIndex(...names);
            return index >= 0 ? (cols[index] || '').replace(/\r/g, '').trim() : '';
        };
        
        db = []; // 초기화
        for (let i = 1; i < rows.length; i++) {
            if (!rows[i].trim()) continue; 
            const cols = rows[i].split('\t');
            if (cols.length >= 4) {
                const day = cols[0].trim();
                const verb = cols[1].trim();
                const ko = cols[2].trim();
                const en = cols[3].replace(/\r/g, '').trim();

                if (en && ko) {
                    const priorityRaw = optionalValue(cols, ['PRIORITY', 'WEIGHT']);
                    const priority = parseFloat(priorityRaw);
                    db.push({
                        day: parseInt(day) || "?",
                        verb,
                        ko,
                        en,
                        corePhrase: optionalValue(cols, ['CORE_CHUNK', 'CORE_PHRASE']),
                        errorType: optionalValue(cols, ['ERROR_TYPE', 'ERROR']),
                        distractor: optionalValue(cols, ['DISTRACTOR', 'WRONG_CHUNK']),
                        tip: optionalValue(cols, ['TIP', 'EXPLANATION']),
                        priority: Number.isFinite(priority) && priority > 0 ? priority : 1
                    });
                }
            }
        }
        return db;
}

/**
 * 💾 검수 가능한 정적 학습 자료를 우선 사용하고, 이전 배포본과의 호환을 위해 시트를 예비 경로로 둔다.
 */
async function fetchDatabase() {
    try {
        const response = await fetch(CONTENT_URL, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`학습 자료 요청 실패: ${response.status}`);
        const content = await response.json();
        if (!Array.isArray(content.items) || content.items.length === 0) throw new Error('학습 자료가 비어 있습니다.');
        let makeChunkOverrides = [];
        try {
            const makeResponse = await fetch(MAKE_CHUNK_OVERRIDES_URL, { cache: 'no-cache' });
            if (!makeResponse.ok) throw new Error(`MAKE 청크 자료 요청 실패: ${makeResponse.status}`);
            const makeContent = await makeResponse.json();
            if (!Array.isArray(makeContent.items) || makeContent.items.length !== 100) {
                throw new Error(`MAKE 청크 자료 수가 잘못되었습니다: ${makeContent.items?.length || 0}/100`);
            }
            makeChunkOverrides = makeContent.items;
        } catch (makeError) {
            console.warn('직접 검수한 MAKE 청크 자료를 불러오지 못해 기본 청크를 사용합니다.', makeError);
        }
        const makeChunkById = new Map(makeChunkOverrides.map(item => [item.id, item]));
        db = content.items
            .map(item => mapStoredContent({ ...item, ...(makeChunkById.get(item.id) || {}) }))
            .filter(card => card.en && card.ko);
        if (db.length !== content.items.length) throw new Error('일부 학습 자료의 영어 또는 한국어가 비어 있습니다.');
        if (meaningFlowPilotMode) {
            db = db.filter(card => card.meaningFlow?.reviewStatus === 'reviewed');
            if (db.length !== 30) throw new Error(`의미 전개 파일럿 문장 수가 잘못되었습니다: ${db.length}/30`);
        } else if (requestedVerbPilot) {
            db = db.filter(card => String(card.verb || '').toUpperCase() === requestedVerbPilot);
            if (db.length === 0) throw new Error(`요청한 동사 단원을 찾지 못했습니다: ${requestedVerbPilot}`);
        }
        init();
    } catch (error) {
        console.warn('저장된 학습 자료를 불러오지 못해 시트 자료를 사용합니다.', error);
        if (meaningFlowPilotMode) {
            console.error('의미 전개 파일럿은 검수된 정적 자료가 필요합니다.', error);
            document.getElementById('verb-badge').innerText = '파일럿 오류';
            document.getElementById('korean').innerText = '검수된 30문장 파일럿을 불러오지 못했습니다.\n잠시 후 새로고침해 주세요.';
            document.getElementById('order-guide').style.display = 'none';
            document.getElementById('natural-answer').style.display = 'block';
            document.getElementById('hint').style.display = 'none';
            return;
        }
        try {
            await fetchSheetFallback();
            init();
        } catch (fallbackError) {
            console.error("데이터를 불러오지 못했습니다.", fallbackError);
            document.getElementById('verb-badge').innerText = "에러 발생";
            document.getElementById('korean').innerText = "데이터를 불러오는 데 실패했습니다.\n인터넷 연결을 확인해 주세요.";
            document.getElementById('order-guide').style.display = 'none';
            document.getElementById('natural-answer').style.display = 'block';
            document.getElementById('hint').style.display = 'none';
        }
    }
}

/**
 * 🔀 배열 무작위 셔플 (피셔-예이츠 알고리즘)
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

/**
 * 🚀 세션 생성 및 초기 실행
 */
function init() {
    const today = new Date().getTime(); 

    let newCards = [];
    let dueReviewCards = [];

    // 1. 전체 데이터를 새 문장과 검토 필요(복습) 문장으로 분류
    db.forEach(card => {
        const record = progressData[card.en];
        if (!record) {
            newCards.push(card);
        } else if (record.nextDate <= today) {
            dueReviewCards.push(card);
        }
    });

    // 2. 동적 세션 타겟팅 (일일 10개 엄수 & 복습 우선)
    const todayStr = getTodayKey();
    ensureTodayNewCards(todayStr);
    const dailyLearned = progressData.dailyStats?.[todayStr]?.newLearned || 0;
    const pendingReviews = dueReviewCards.length;
    const adaptiveLimit = Learning.getAdaptiveNewLimit(
        pendingReviews,
        progressData.practiceHistory || [],
        DAILY_NEW_LIMIT
    );

    let targetNew = 0;
    let targetReview = SESSION_CARD_LIMIT;

    if (pendingReviews >= SESSION_CARD_LIMIT) {
        // 원칙 2: 복습 폭발 방어 (복습에 몰빵)
        targetNew = 0;
        targetReview = SESSION_CARD_LIMIT;
    } else {
        // 적응형 한도(10·7·4·0)를 세션 한도가 아니라 실제 하루 한도로 적용한다.
        const remainToday = Math.max(0, adaptiveLimit - dailyLearned);
        targetNew = remainToday;
        targetReview = SESSION_CARD_LIMIT - targetNew;
    }

    // 3. 원본 자료의 동사별 문장 비중을 유지하며 새 문장을 선정한다.
    // DAY 순서를 강제하지 않되, 고빈도 기본동사가 더 많이 배치된 책의 의도는 보존한다.
    const selectedNew = Learning.selectWeightedNewCards(newCards, targetNew, db);

    rememberTodayNewCards(selectedNew);

    // 4. 복습 문장 선정
    let dangerCards = [];
    let midCards = [];
    let longCards = [];

    dueReviewCards.forEach(card => {
        const interval = progressData[card.en].interval || 0;
        if (interval === 0 || interval === 0.5) dangerCards.push(card);
        else if (interval <= 3) midCards.push(card);
        else longCards.push(card);
    });

    shuffleArray(dangerCards);
    shuffleArray(midCards);
    shuffleArray(longCards);

    let selectedReview = [];

    // 비율 할당: 집중 50%, 단기 30%, 장기 20%
    let qDanger = Math.ceil(targetReview * 0.5);
    let qMid = Math.ceil(targetReview * 0.3);
    let qLong = targetReview - qDanger - qMid;

    // 집중 복습 채우기
    let takeDanger = Math.min(dangerCards.length, qDanger);
    selectedReview.push(...dangerCards.slice(0, takeDanger));
    let remDanger = qDanger - takeDanger; // 남은 자리는 단기로 이월

    // 단기 복습 채우기
    qMid += remDanger;
    let takeMid = Math.min(midCards.length, qMid);
    selectedReview.push(...midCards.slice(0, takeMid));
    let remMid = qMid - takeMid; // 남은 자리는 장기로 이월

    // 장기 복습 채우기
    qLong += remMid;
    let takeLong = Math.min(longCards.length, qLong);
    selectedReview.push(...longCards.slice(0, takeLong));

    // 비어 있는 범주의 몫 때문에 세션이 목표보다 작아지지 않도록 남은 복습에서 보충한다.
    if (selectedReview.length < targetReview) {
        const selectedSentences = new Set(selectedReview.map(card => card.en));
        const remainingDue = dueReviewCards.filter(card => !selectedSentences.has(card.en));
        shuffleArray(remainingDue);
        selectedReview.push(...remainingDue.slice(0, targetReview - selectedReview.length));
    }

    todayCards = meaningFlowPilotMode ? [...db] : [...selectedNew, ...selectedReview];
    currentSessionPlan = {
        dailyNewLimit: adaptiveLimit,
        newTarget: selectedNew.length,
        reviewTarget: selectedReview.length,
        total: todayCards.length
    };

    if (todayCards.length === 0) {
        showCompletionScreen();
        updateDashboardStats();
        return;
    }

    document.getElementById('total-idx').innerText = todayCards.length;
    
    // 드롭다운 및 설정창 초기화 매핑
    const rateRange = document.getElementById('rate-range');
    const rateVal = document.getElementById('rate-val');
    if (rateRange && rateVal) {
        const savedRate = progressData.settings.rate || 0.9;
        rateRange.value = savedRate;
        rateVal.innerText = `${parseFloat(savedRate).toFixed(1)}x`;
    }

    loadCard();
    updateDashboardStats(); 
}

/**
 * 📊 상단 대시보드 통계 계산 및 화면 렌더링
 */
function updateDashboardStats() {
    let countNew = 0;
    let countDanger = 0;
    let countMid = 0;
    let countLong = 0;
    let countTotal = db.length; 

    db.forEach(card => {
        const record = progressData[card.en];
        if (!record) {
            countNew++;
        } else {
            const interval = record.interval || 0;
            if (interval === 0 || interval === 0.5) {
                countDanger++; 
            } else if (interval >= 1 && interval <= 3) {
                countMid++;
            } else if (interval >= 6) {
                countLong++;
            }
        }
    });

    const statTotal = document.getElementById('stat-total');
    const statNew = document.getElementById('stat-new');
    const statDanger = document.getElementById('stat-danger');
    const statMid = document.getElementById('stat-mid');
    const statLong = document.getElementById('stat-long');
    const dailyNewProgress = document.getElementById('daily-new-progress');
    const dailySessionProgress = document.getElementById('daily-session-progress');
    const dailyPlanNote = document.getElementById('daily-plan-note');

    if (statTotal) statTotal.innerText = countTotal;
    if (statNew) statNew.innerText = countNew;
    if (statDanger) statDanger.innerText = countDanger;
    if (statMid) statMid.innerText = countMid;
    if (statLong) statLong.innerText = countLong;

    const todayStr = getTodayKey();
    const dailyLearned = progressData.dailyStats?.[todayStr]?.newLearned || 0;
    const dailyLimit = currentSessionPlan.dailyNewLimit;
    const sessionCompleted = Math.min(
        todayCards.length,
        currentIndex + (currentAssessmentRecorded ? 1 : 0)
    );
    if (dailyNewProgress) {
        dailyNewProgress.innerText = dailyLimit > 0
            ? `${Math.min(dailyLearned, dailyLimit)} / ${dailyLimit}`
            : '복습 우선';
    }
    if (dailySessionProgress) dailySessionProgress.innerText = `${sessionCompleted} / ${todayCards.length}`;
    if (dailyPlanNote) {
        const retryCount = Object.values(sessionRetryCounts).reduce((sum, value) => sum + Number(value || 0), 0);
        const retryLabel = retryCount ? ` · 재도전 ${retryCount}회` : '';
        dailyPlanNote.innerText = dailyLimit === 0
            ? '밀린 복습부터 마치도록 오늘은 새 문장을 쉬어요.'
            : `새 문장 ${currentSessionPlan.newTarget}개 · 복습 ${currentSessionPlan.reviewTarget}개${retryLabel}로 구성했어요.`;
    }

    const errorSummary = document.getElementById('error-summary');
    if (errorSummary) {
        const mistakeHistory = getMistakeHistory();
        const counts = new Map();
        mistakeHistory.forEach(entry => {
            (entry.selections || []).forEach(selection => {
                const text = String(selection.text || '').trim();
                if (!text) return;
                const displayText = selection.operation === 'insertion' ? `+ ${text}` : text;
                const key = `${selection.operation || 'source_token'}:${text.toLocaleLowerCase('en-US')}`;
                const current = counts.get(key) || { text: displayText, count: 0 };
                current.count += 1;
                counts.set(key, current);
            });
        });
        const ranked = [...counts.values()]
            .sort((a, b) => (b.count - a.count) || a.text.localeCompare(b.text))
            .slice(0, 3);

        if (ranked.length) {
            errorSummary.innerText = ranked.map(item => `“${item.text}” ${item.count}회`).join(' · ');
        } else if (mistakeHistory.length) {
            errorSummary.innerText = `최근 오류 ${mistakeHistory.length}건을 기록했습니다.`;
        } else {
            errorSummary.innerText = '학습을 시작하면 실제로 표시한 오답을 보여 드려요.';
        }
    }
}

/**
 * 🃏 개별 학습 카드 데이터를 화면에 로드
 */
function loadCard() {
    currentPractice = null;
    currentChunkPlan = null;
    currentChunkStage = 0;
    selectedPracticeIds = [];
    currentPracticeResult = null;
    practiceUsedHint = false;
    selectedMistakeIndexes = [];
    addedWordMistakes = [];
    insertionEditorOpen = false;
    wordOrderMistake = false;
    currentAssessmentRecorded = false;

    const currentIdxEl = document.getElementById('current-idx');
    if (currentIdxEl) currentIdxEl.innerText = currentIndex + 1;
    
    const progressPercent = ((currentIndex + 1) / todayCards.length) * 100;
    const progressFill = document.getElementById('progress-bar-fill');
    if (progressFill) progressFill.style.width = progressPercent + '%';
    
    const card = todayCards[currentIndex];
    if (!card) return;

    const currentDay = card.day || "?";
    const currentVerb = card.verb || "CORE VERB";
    const verbBadge = document.getElementById('verb-badge');
    if (verbBadge) verbBadge.innerText = `DAY ${currentDay} [ ${currentVerb} ]`;
    
    const record = progressData[card.en] || {};
    currentChunkStage = Learning.getChunkStage(record);
    currentChunkPlan = Learning.buildAdaptiveChunkPlan(card, currentChunkStage);
    currentChunkStage = currentChunkPlan.stage;
    const recallMode = currentChunkPlan.mode === 'recall';
    const wrongCount = record.wrongCount || 0;
    const newBadge = document.getElementById('new-badge');
    const wrongBadge = document.getElementById('wrong-badge');

    if (newBadge) {
        if (isTodayNewCard(card)) {
            newBadge.style.display = 'inline-block';
        } else {
            newBadge.style.display = 'none';
        }
    }
    
    if (wrongBadge) {
        if (wrongCount > 0) {
            wrongBadge.innerText = `⚠️ 연속 틀림: ${wrongCount}회`;
            wrongBadge.style.display = 'inline-block';
        } else {
            wrongBadge.style.display = 'none';
        }
    }
    
    const koreanEl = document.getElementById('korean');
    const naturalAnswer = document.getElementById('natural-answer');
    const orderGuide = document.getElementById('order-guide');
    const orderGlosses = document.getElementById('order-glosses');
    const englishEl = document.getElementById('english');
    const englishAnswerLabel = document.getElementById('english-answer-label');
    const hintEl = document.getElementById('hint');
    const cardActionRow = document.getElementById('card-action-row');
    const actionBtnEl = document.getElementById('action-buttons');
    const practicePanel = document.getElementById('practice-panel');
    const mistakeReview = document.getElementById('mistake-review');
    const showAnswerBtn = document.getElementById('btn-show-answer');
    const nextBtn = document.getElementById('btn-next');
    const cardEl = document.getElementById('card');
    const practiceTitle = document.querySelector('#practice-panel .practice-title');
    const practiceSubtitle = document.getElementById('practice-subtitle');
    const practiceWorkspace = document.getElementById('practice-workspace');
    const practiceSlots = document.getElementById('practice-slots');
    const practiceBank = document.getElementById('practice-bank');
    const practiceSlotsLabel = document.getElementById('practice-slots-label');

    if (koreanEl) koreanEl.innerText = card.ko;
    if (naturalAnswer) naturalAnswer.style.display = recallMode ? 'block' : 'none';
    if (orderGuide) orderGuide.style.display = recallMode ? 'none' : 'block';
    if (orderGlosses) {
        orderGlosses.innerHTML = '';
        const glosses = Array.isArray(currentChunkPlan.orderGlosses) && currentChunkPlan.orderGlosses.length
            ? currentChunkPlan.orderGlosses
            : [card.ko];
        glosses.forEach(gloss => {
            const chip = document.createElement('span');
            chip.className = 'order-gloss-chip';
            chip.innerText = gloss;
            orderGlosses.appendChild(chip);
        });
    }
    if (englishEl) {
        englishEl.innerHTML = '';
        englishEl.style.display = 'none';
    }
    if (englishAnswerLabel) englishAnswerLabel.style.display = 'none';
    
    if (hintEl) {
        hintEl.style.display = 'none';
    }
    if (practicePanel) practicePanel.style.display = 'block';
    if (practiceTitle) {
        practiceTitle.innerText = recallMode
            ? '🧠 선택지 없이 전체 문장을 떠올려 보세요'
            : (currentChunkPlan.kind === 'micro'
                ? '🧠 짧은 조립 단위로 영어를 떠올려 보세요'
                : (currentChunkPlan.kind === 'merged'
                    ? '🧠 더 긴 조립 단위로 영어를 떠올려 보세요'
                    : '🧠 표현 청크로 영어를 떠올려 보세요'));
    }
    if (practiceSubtitle) {
        practiceSubtitle.innerText = recallMode
            ? '자연스러운 뜻만 보고 영어 문장 전체를 먼저 말해 보세요.'
            : '의미 단서를 앞에서부터 따라가며 영어 문장을 먼저 말해 보세요.';
    }
    if (practiceWorkspace) practiceWorkspace.style.display = 'none';
    if (practiceSlots) practiceSlots.innerHTML = '';
    if (practiceBank) practiceBank.innerHTML = '';
    if (practiceSlotsLabel) practiceSlotsLabel.innerText = currentChunkPlan.kind === 'micro'
        ? '내가 만든 문장 · 짧은 조립 단위를 고르세요'
        : (currentChunkPlan.kind === 'merged'
            ? '내가 만든 문장 · 더 긴 조립 단위를 고르세요'
            : '내가 만든 문장 · 표현 청크를 고르세요');
    if (mistakeReview) mistakeReview.style.display = 'none';
    if (cardActionRow) cardActionRow.style.display = 'none';
    if (actionBtnEl) actionBtnEl.style.display = 'flex';
    if (showAnswerBtn) {
        showAnswerBtn.innerText = recallMode
            ? '떠올린 뒤 영어 정답 확인'
            : (currentChunkPlan.kind === 'micro'
                ? '짧은 영어 조립 단위 확인'
                : (currentChunkPlan.kind === 'merged' ? '더 긴 영어 조립 단위 확인' : '영어 청크로 확인'));
        showAnswerBtn.style.display = 'inline-flex';
    }
    if (nextBtn) nextBtn.style.display = 'none';
    if (cardEl) cardEl.onclick = null;
    document.querySelectorAll('.self-check-btn').forEach(button => {
        button.disabled = button.id === 'btn-save-mistakes';
    });
}
/**
 * 🧩 한국어 어순대로 떠올린 뒤, 영어 청크를 골라 빈칸에 조립한다.
 * 선택된 청크는 즉시 단어별 버튼으로 펼쳐져 실제로 틀린 단어를 표시할 수 있다.
 */
function startPractice() {
    if (currentPractice || currentAssessmentRecorded) return;
    const card = todayCards[currentIndex];
    if (!card) return;

    if (availableVoices.length === 0) populateVoiceList();
    if (!currentChunkPlan) {
        currentChunkPlan = Learning.buildAdaptiveChunkPlan(card, Learning.getChunkStage(progressData[card.en] || {}));
        currentChunkStage = currentChunkPlan.stage;
    }
    currentPractice = Learning.buildPracticeQuestion(card, Math.random, {
        chunks: currentChunkPlan.chunks,
        orderGlosses: currentChunkPlan.orderGlosses,
        chunkStage: currentChunkStage,
        mode: currentChunkPlan.mode
    });
    currentPractice.chunkKind = currentChunkPlan.kind;
    currentPractice.maxChunkStage = currentChunkPlan.maxStage;
    currentPractice.reviewChunks = Learning.buildReviewTokens(card, currentPractice.targetChunks);
    selectedPracticeIds = [];
    currentPracticeResult = null;
    practiceUsedHint = false;
    selectedMistakeIndexes = [];
    wordOrderMistake = false;

    const hintEl = document.getElementById('hint');
    const practicePanel = document.getElementById('practice-panel');
    const practiceWorkspace = document.getElementById('practice-workspace');
    const practiceSubtitle = document.getElementById('practice-subtitle');
    const practiceSlotsLabel = document.getElementById('practice-slots-label');
    const practiceBankLabel = document.getElementById('practice-bank-label');
    const actionButtons = document.getElementById('action-buttons');
    const showAnswerBtn = document.getElementById('btn-show-answer');
    const practiceTitle = document.querySelector('#practice-panel .practice-title');

    if (hintEl) hintEl.style.display = 'none';
    if (practicePanel) practicePanel.style.display = 'block';
    if (actionButtons) actionButtons.style.display = 'none';
    if (showAnswerBtn) showAnswerBtn.style.display = 'none';

    if (currentPractice.practiceMode === 'recall') {
        currentPracticeResult = {
            correct: true,
            freeRecall: true,
            errorTypes: [],
            errorLabel: '',
            tip: '선택지 없이 떠올린 문장과 정답을 비교하세요.'
        };
        selectedPracticeIds = [...currentPractice.targetIds];
        if (practiceWorkspace) practiceWorkspace.style.display = 'none';
        revealPracticeAnswer();
        return;
    }

    if (practiceWorkspace) practiceWorkspace.style.display = 'block';
    if (practiceTitle) practiceTitle.innerText = currentPractice.chunkKind === 'micro'
        ? '🧩 짧은 조립 단위를 어순대로 고르세요'
        : (currentPractice.chunkKind === 'merged'
            ? '🧩 더 긴 조립 단위를 어순대로 고르세요'
            : '🧩 영어 청크를 어순대로 고르세요');
    if (practiceSubtitle) practiceSubtitle.innerText = '고른 단위는 단어별 칸으로 펼쳐집니다. 떠올렸던 것과 다른 단어는 다시 누르세요.';
    if (practiceSlotsLabel) practiceSlotsLabel.innerText = '내가 만든 문장 · 단어를 누르면 틀린 부분으로 표시돼요';
    if (practiceBankLabel) practiceBankLabel.innerText = currentPractice.chunkKind === 'canonical'
        ? '영어 표현 청크 후보 · 어순을 생각해서 고르세요'
        : '영어 조립 단위 후보 · 어순을 생각해서 고르세요';
    renderPracticeSelection();
}

// 기존 인라인 호출이나 저장된 화면과의 호환을 유지한다.
function showAnswer() {
    startPractice();
}

function createMistakeWordButton(token, className) {
    const word = document.createElement('button');
    const selected = selectedMistakeIndexes.includes(token.index);
    word.type = 'button';
    word.className = className;
    word.innerText = token.text;
    word.setAttribute('aria-pressed', selected ? 'true' : 'false');
    word.setAttribute('aria-label', selected
        ? `${token.text}, 오류 표시 해제`
        : `${token.text}, 틀렸던 단어로 표시`);
    if (selected) word.classList.add('selected');
    word.disabled = currentAssessmentRecorded;
    word.onclick = (event) => {
        event.stopPropagation();
        toggleMistakeWord(token.index);
    };
    return word;
}

function renderPracticeSelection() {
    if (!currentPractice) return;
    const slotsEl = document.getElementById('practice-slots');
    const bankEl = document.getElementById('practice-bank');
    const bankLabel = document.getElementById('practice-bank-label');
    const controlsEl = document.querySelector('#practice-workspace .practice-controls');
    const checkBtn = document.getElementById('btn-practice-check');
    const resetBtn = document.getElementById('btn-practice-reset');
    const revealBtn = document.getElementById('btn-practice-reveal');
    if (!slotsEl || !bankEl) return;

    const answerVisible = Boolean(currentPracticeResult);
    slotsEl.innerHTML = '';
    const practiceSlots = Learning.buildPracticeSlots(
        currentPractice,
        currentPractice.reviewChunks,
        selectedPracticeIds
    );
    const selectedSlots = practiceSlots.filter(slot => slot.id);
    if (selectedSlots.length === 0) {
        const emptyGuide = document.createElement('span');
        emptyGuide.className = 'practice-empty-guide';
        emptyGuide.innerText = '청크를 고르면 여기에 문장이 만들어져요';
        slotsEl.appendChild(emptyGuide);
    }
    selectedSlots.forEach(slot => {

        const chunkEl = document.createElement('div');
        chunkEl.className = 'practice-selected-chunk';
        if (answerVisible) {
            chunkEl.classList.add(currentPracticeResult.correct ? 'correct' : 'corrected');
        }

        slot.tokens.forEach(token => {
            chunkEl.appendChild(createMistakeWordButton(token, 'practice-slot-word'));
        });

        if (!answerVisible && !currentAssessmentRecorded) {
            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'practice-chunk-remove';
            removeButton.innerText = '×';
            removeButton.setAttribute('aria-label', '이 청크 되돌리기');
            removeButton.onclick = (event) => {
                event.stopPropagation();
                removePracticeChunk(slot.slotIndex);
            };
            chunkEl.appendChild(removeButton);
        }
        slotsEl.appendChild(chunkEl);
    });

    bankEl.innerHTML = '';
    currentPractice.bank
        .filter(entry => !entry.isDistractor && !selectedPracticeIds.includes(entry.id))
        .forEach(entry => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'practice-chip';
            chip.innerText = entry.text;
            chip.disabled = answerVisible || selectedPracticeIds.length >= currentPractice.targetIds.length;
            chip.onclick = (event) => {
                event.stopPropagation();
                selectPracticeChunk(entry.id);
            };
            bankEl.appendChild(chip);
        });

    if (bankLabel) bankLabel.style.display = answerVisible ? 'none' : 'block';
    bankEl.style.display = answerVisible ? 'none' : 'flex';
    if (controlsEl) controlsEl.style.display = answerVisible ? 'none' : 'flex';
    if (checkBtn) checkBtn.disabled = selectedPracticeIds.length !== currentPractice.targetIds.length;
    if (resetBtn) resetBtn.disabled = selectedPracticeIds.length === 0;
    if (revealBtn) revealBtn.disabled = answerVisible;
}

function selectPracticeChunk(id) {
    if (!currentPractice || currentPracticeResult || currentAssessmentRecorded) return;
    if (selectedPracticeIds.length >= currentPractice.targetIds.length) return;
    if (selectedPracticeIds.includes(id)) return;
    const entry = currentPractice.bank.find(item => item.id === id && !item.isDistractor);
    if (!entry) return;
    selectedPracticeIds.push(id);
    renderPracticeSelection();
}

function clearMistakesForPracticeChunks(ids) {
    if (!currentPractice || !Array.isArray(ids) || ids.length === 0) return;
    const removedIndexes = new Set();
    ids.forEach(id => {
        const entry = currentPractice.bank.find(item => item.id === id && !item.isDistractor);
        const reviewChunk = Number.isInteger(entry?.targetIndex)
            ? currentPractice.reviewChunks?.[entry.targetIndex]
            : null;
        (reviewChunk?.tokens || []).forEach(token => removedIndexes.add(token.index));
    });
    selectedMistakeIndexes = selectedMistakeIndexes.filter(index => !removedIndexes.has(index));
}

function removePracticeChunk(slotIndex) {
    if (!currentPractice || currentPracticeResult || currentAssessmentRecorded) return;
    const [removedId] = selectedPracticeIds.splice(slotIndex, 1);
    clearMistakesForPracticeChunks([removedId]);
    renderPracticeSelection();
}

function resetPracticeSelection() {
    if (!currentPractice || currentPracticeResult || currentAssessmentRecorded) return;
    clearMistakesForPracticeChunks(selectedPracticeIds);
    selectedPracticeIds = [];
    renderPracticeSelection();
}

function checkPracticeAnswer() {
    if (!currentPractice || currentPracticeResult || currentAssessmentRecorded) return;
    if (selectedPracticeIds.length !== currentPractice.targetIds.length) return;
    currentPracticeResult = Learning.evaluatePractice(currentPractice, selectedPracticeIds);
    if (!currentPracticeResult.correct) {
        if (currentPracticeResult.errorTypes.includes('word_order')) wordOrderMistake = true;
        selectedPracticeIds = [...currentPractice.targetIds];
    }
    renderPracticeSelection();
    revealPracticeAnswer();
}

function revealAnswerAsReview() {
    if (currentAssessmentRecorded) return;
    if (!currentPractice) startPractice();
    if (!currentPractice || currentPracticeResult) return;
    practiceUsedHint = true;
    currentPracticeResult = {
        correct: false,
        skipped: true,
        errorTypes: ['recall'],
        errorLabel: Learning.ERROR_LABELS.recall,
        tip: '정답을 먼저 확인했습니다.'
    };
    selectedPracticeIds = [...currentPractice.targetIds];
    renderPracticeSelection();
    revealPracticeAnswer();
}

function renderEnglishReview() {
    const card = todayCards[currentIndex];
    if (!card || !currentPractice) return;
    const englishEl = document.getElementById('english');
    if (!englishEl) return;

    englishEl.innerHTML = '';
    // 문제 단계가 잘게 나뉘어도 정답은 검수된 실제 청크 경계로 보여 준다.
    Learning.buildReviewTokens(card).forEach((chunk, chunkIndex) => {
        const chunkEl = document.createElement('span');
        chunkEl.className = 'english-chunk';
        chunkEl.dataset.chunk = String(chunkIndex + 1);
        chunk.tokens.forEach(token => {
            chunkEl.appendChild(createMistakeWordButton(token, 'mistake-word'));
        });
        englishEl.appendChild(chunkEl);
    });
}

function toggleMistakeWord(index) {
    if (currentAssessmentRecorded) return;
    if (selectedMistakeIndexes.includes(index)) {
        selectedMistakeIndexes = selectedMistakeIndexes.filter(value => value !== index);
    } else {
        selectedMistakeIndexes.push(index);
    }
    selectedMistakeIndexes.sort((a, b) => a - b);
    renderPracticeSelection();
    renderEnglishReview();
    updateMistakeReview();
}

function getCurrentMistakeSelections() {
    const card = todayCards[currentIndex];
    if (!card) return { selectedTokenIndexes: [], selections: [] };
    return Learning.buildMistakeSelections(card, selectedMistakeIndexes);
}

function getCurrentReviewTokens() {
    const card = todayCards[currentIndex];
    return card ? Learning.buildReviewTokens(card).flatMap(chunk => chunk.tokens) : [];
}

function getInsertionPositionLabel(mistake) {
    if (mistake.afterTokenIndex === -1) return '문장 맨 앞';
    if (!mistake.rightContext) return `“${mistake.leftContext}” 뒤 · 문장 끝`;
    return `“${mistake.leftContext}” 뒤 · “${mistake.rightContext}” 앞`;
}

function renderInsertionEditor() {
    const editor = document.getElementById('insertion-editor');
    const toggleButton = document.getElementById('btn-toggle-insertion');
    const positionSelect = document.getElementById('insertion-position');
    if (!editor || !toggleButton || !positionSelect) return;

    editor.hidden = !insertionEditorOpen;
    toggleButton.innerText = insertionEditorOpen
        ? '− 추가 단어 기록 닫기'
        : '＋ 정답에 없는 말을 더했어요';
    toggleButton.disabled = currentAssessmentRecorded;
    if (!insertionEditorOpen) return;

    const previousValue = positionSelect.value;
    const tokens = getCurrentReviewTokens();
    positionSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.innerText = '추가한 위치를 선택하세요';
    positionSelect.appendChild(placeholder);
    const positions = [
        { value: -1, label: tokens.length ? `문장 맨 앞 · “${tokens[0].text}” 앞` : '문장 맨 앞' },
        ...tokens.map((token, index) => ({
            value: index,
            label: index === tokens.length - 1
                ? `“${token.text}” 뒤 · 문장 끝`
                : `“${token.text}” 뒤 · “${tokens[index + 1].text}” 앞`
        }))
    ];
    positions.forEach(position => {
        const option = document.createElement('option');
        option.value = String(position.value);
        option.innerText = position.label;
        positionSelect.appendChild(option);
    });
    if (positions.some(position => String(position.value) === previousValue)) {
        positionSelect.value = previousValue;
    }
}

function toggleInsertionEditor() {
    if (currentAssessmentRecorded) return;
    insertionEditorOpen = !insertionEditorOpen;
    renderInsertionEditor();
    if (insertionEditorOpen) document.getElementById('insertion-text')?.focus();
}

function addInsertionMistake() {
    if (currentAssessmentRecorded) return;
    const card = todayCards[currentIndex];
    const textInput = document.getElementById('insertion-text');
    const positionSelect = document.getElementById('insertion-position');
    const help = document.getElementById('insertion-help');
    const positionValue = positionSelect?.value;
    const mistake = Learning.buildInsertionMistake(
        card,
        textInput?.value,
        positionValue === '' || positionValue === undefined ? Number.NaN : Number(positionValue)
    );
    if (!mistake) {
        if (help) help.innerText = '더 말했던 단어와 위치를 확인해 주세요.';
        return;
    }

    const duplicate = addedWordMistakes.some(item =>
        item.insertedText.toLocaleLowerCase('en-US') === mistake.insertedText.toLocaleLowerCase('en-US') &&
        item.afterTokenIndex === mistake.afterTokenIndex
    );
    if (!duplicate) addedWordMistakes.push(mistake);
    if (textInput) textInput.value = '';
    if (help) help.innerText = duplicate
        ? '같은 추가 단어가 이미 기록되어 있어요.'
        : `“${mistake.insertedText}” 추가를 기록에 넣었어요.`;
    updateMistakeReview();
}

function removeInsertionMistake(index) {
    if (currentAssessmentRecorded) return;
    addedWordMistakes.splice(index, 1);
    updateMistakeReview();
}

function getCurrentAssessmentSignals() {
    return Learning.buildAssessmentSignals({
        wordOrder: wordOrderMistake,
        recall: practiceUsedHint || Boolean(currentPracticeResult?.skipped)
    });
}

function updateMistakeReview() {
    const summary = document.getElementById('mistake-summary');
    const saveButton = document.getElementById('btn-save-mistakes');
    const noMistakesButton = document.querySelector('.self-check-btn.no-mistakes');
    const selection = getCurrentMistakeSelections();
    const hasManualMistake = selection.selections.length > 0 || addedWordMistakes.length > 0;

    if (summary) {
        summary.innerHTML = '';
        if (!selection.selections.length && !addedWordMistakes.length && !wordOrderMistake) {
            summary.innerText = '선택한 오류가 아직 없습니다.';
            summary.classList.add('empty');
        } else {
            summary.classList.remove('empty');
            selection.selections.forEach(mistake => {
                const chip = document.createElement('span');
                chip.className = 'mistake-summary-chip';
                chip.innerText = mistake.text;
                summary.appendChild(chip);
            });
            addedWordMistakes.forEach((mistake, index) => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'mistake-summary-chip insertion';
                chip.innerText = `＋ ${mistake.insertedText} · ${getInsertionPositionLabel(mistake)} ×`;
                chip.setAttribute('aria-label', `${mistake.insertedText} 추가 오류 삭제`);
                chip.disabled = currentAssessmentRecorded;
                chip.onclick = (event) => {
                    event.stopPropagation();
                    removeInsertionMistake(index);
                };
                summary.appendChild(chip);
            });
            if (wordOrderMistake) {
                const orderChip = document.createElement('span');
                orderChip.className = 'mistake-summary-chip';
                orderChip.innerText = '청크 어순 · 자동 기록';
                summary.appendChild(orderChip);
            }
        }
    }
    renderInsertionEditor();
    if (saveButton) {
        saveButton.style.display = hasManualMistake ? 'block' : 'none';
        saveButton.disabled = currentAssessmentRecorded || !hasManualMistake;
    }
    if (noMistakesButton) {
        noMistakesButton.innerText = (wordOrderMistake || practiceUsedHint)
            ? '단어는 맞았어요'
            : '모두 맞았어요';
        noMistakesButton.disabled = currentAssessmentRecorded || hasManualMistake;
    }
}

function finishSelfAssessment(result, errorTypes, details, headline, usedHint = practiceUsedHint, chunkOutcome = 'clean') {
    if (currentAssessmentRecorded) return;
    const scheduleMessage = recordAssessment(result, errorTypes, usedHint, details, chunkOutcome);
    renderPracticeSelection();
    renderEnglishReview();
    updateMistakeReview();

    const resultTip = document.getElementById('practice-result-tip');
    const nextBtn = document.getElementById('btn-next');
    const actionButtons = document.getElementById('action-buttons');
    const selfCheckButtons = document.querySelectorAll('.self-check-btn');
    selfCheckButtons.forEach(button => { button.disabled = true; });
    document.querySelectorAll('#insertion-editor input, #insertion-editor select, #insertion-editor button')
        .forEach(control => { control.disabled = true; });
    if (resultTip) resultTip.innerText = `${headline} ${scheduleMessage}`;
    if (actionButtons) actionButtons.style.display = 'flex';
    if (nextBtn) nextBtn.style.display = 'inline-flex';
}

function saveSelectedMistakes() {
    const selection = getCurrentMistakeSelections();
    if (!selection.selections.length && !addedWordMistakes.length && !wordOrderMistake) return;
    const details = selection.selections.map(({ start, end, text, tokenIndexes, chunkIndexes }) => ({
        operation: 'source_token',
        start,
        end,
        text,
        tokenIndexes,
        chunkIndexes
    })).concat(addedWordMistakes.map(mistake => ({ ...mistake })));
    const signals = getCurrentAssessmentSignals();
    const recordCount = details.length + (wordOrderMistake ? 1 : 0);
    finishSelfAssessment(
        'X',
        signals,
        details,
        `오류 표시 ${recordCount}개를 기록했습니다.`,
        practiceUsedHint,
        'error'
    );
}

function markNoMistakes() {
    selectedMistakeIndexes = [];
    addedWordMistakes = [];
    const signals = getCurrentAssessmentSignals();
    if (signals.length) {
        const headline = signals.includes('recall') && signals.includes('word_order')
            ? '단어 오류는 없지만 회상 실패와 어순 오류는 기록했습니다.'
            : (signals.includes('recall')
                ? '단어 오류는 없지만 정답을 먼저 확인한 회상 실패는 기록했습니다.'
                : '단어 오류는 없지만 어순 오류는 기록했습니다.');
        const chunkOutcome = signals.includes('word_order') ? 'error' : 'reveal';
        finishSelfAssessment('X', signals, [], headline, practiceUsedHint, chunkOutcome);
        return;
    }
    finishSelfAssessment('O', [], [], '모두 맞은 것으로 기록했습니다.', false, 'clean');
}

function markRecallFailure() {
    selectedMistakeIndexes = [];
    addedWordMistakes = [];
    const signals = Learning.buildAssessmentSignals({
        wordOrder: wordOrderMistake,
        recall: true
    });
    const headline = wordOrderMistake
        ? '문장 전체 회상 실패와 자동 감지한 어순 오류를 기록했습니다.'
        : '문장 전체 회상 실패로 기록했습니다.';
    finishSelfAssessment('X', signals, [], headline, practiceUsedHint, 'recall_failure');
}

function revealPracticeAnswer() {
    const card = todayCards[currentIndex];
    if (!card || !currentPractice) return;
    const englishEl = document.getElementById('english');
    const englishAnswerLabel = document.getElementById('english-answer-label');
    const naturalAnswer = document.getElementById('natural-answer');
    const mistakeReview = document.getElementById('mistake-review');
    const resultTip = document.getElementById('practice-result-tip');
    const cardActionRow = document.getElementById('card-action-row');
    const showAnswerBtn = document.getElementById('btn-show-answer');
    const nextBtn = document.getElementById('btn-next');
    const actionButtons = document.getElementById('action-buttons');
    const cardEl = document.getElementById('card');
    const practiceTitle = document.querySelector('#practice-panel .practice-title');
    const practiceSubtitle = document.getElementById('practice-subtitle');
    const practiceSlotsLabel = document.getElementById('practice-slots-label');
    const practiceWorkspace = document.getElementById('practice-workspace');

    if (selectedPracticeIds.length !== currentPractice.targetIds.length) {
        selectedPracticeIds = [...currentPractice.targetIds];
    }
    renderPracticeSelection();
    renderEnglishReview();
    if (englishAnswerLabel) {
        englishAnswerLabel.innerText = '영어 정답 · 실제 청크 경계 안에서 틀린 단어를 누르세요';
        englishAnswerLabel.style.display = 'block';
    }
    if (englishEl) englishEl.style.display = 'flex';
    if (practiceWorkspace) practiceWorkspace.style.display = 'none';
    if (naturalAnswer) naturalAnswer.style.display = 'block';
    if (mistakeReview) mistakeReview.style.display = 'block';
    if (practiceTitle) practiceTitle.innerText = '👆 영어 정답에서 틀린 부분을 누르세요';
    if (practiceSlotsLabel) practiceSlotsLabel.innerText = '영어 정답 · 청크 안에서 단어별로 오답을 표시하세요';
    if (practiceSubtitle) {
        if (currentPracticeResult?.freeRecall) {
            practiceSubtitle.innerText = '떠올린 전체 문장과 정답을 비교하고, 다르게 말한 단어만 표시하세요.';
        } else if (currentPracticeResult?.skipped) {
            practiceSubtitle.innerText = '정답 청크를 펼쳤습니다. 떠올리지 못했거나 다르게 말한 단어를 표시하세요.';
        } else if (currentPracticeResult?.correct) {
            practiceSubtitle.innerText = '청크 어순이 맞습니다. 다르게 생각하거나 말했던 단어가 있으면 표시하세요.';
        } else {
            practiceSubtitle.innerText = '올바른 청크 어순으로 다시 놓았습니다. 어순 오류는 자동으로 표시했습니다.';
        }
    }
    if (resultTip) resultTip.innerText = '실제로 다르게 생각하거나 말한 단어만 누르면, 그 위치가 그대로 기록됩니다.';
    if (cardActionRow) cardActionRow.style.display = 'flex';
    if (actionButtons) actionButtons.style.display = 'none';
    if (showAnswerBtn) showAnswerBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'none';
    if (cardEl) cardEl.onclick = null;
    updateMistakeReview();
}

function normalizeMistakeRecord(record = {}) {
    const legacyTypes = Array.isArray(record.errorTypes) ? record.errorTypes : [];
    const sourceSelections = Array.isArray(record.selections)
        ? record.selections
        : (Array.isArray(record.mistakes) ? record.mistakes : []);
    const selections = sourceSelections
        .filter(item => item && item.type !== 'word_order' && item.type !== 'recall')
        .map(item => {
            const operation = item.operation === 'insertion' || item.insertedText
                ? 'insertion'
                : 'source_token';
            const start = Number.isInteger(item.start) ? item.start : null;
            const end = Number.isInteger(item.end) ? item.end : null;
            const tokenIndexes = Array.isArray(item.tokenIndexes)
                ? item.tokenIndexes.filter(Number.isInteger)
                : (start !== null && end !== null && end > start
                    ? Array.from({ length: end - start }, (_, offset) => start + offset)
                    : []);
            return {
                operation,
                start,
                end,
                text: String(item.text || '').trim(),
                insertedText: operation === 'insertion'
                    ? String(item.insertedText || item.text || '').trim()
                    : '',
                afterTokenIndex: operation === 'insertion' && Number.isInteger(item.afterTokenIndex)
                    ? item.afterTokenIndex
                    : null,
                beforeTokenIndex: operation === 'insertion' && Number.isInteger(item.beforeTokenIndex)
                    ? item.beforeTokenIndex
                    : null,
                leftContext: operation === 'insertion' ? String(item.leftContext || '') : '',
                rightContext: operation === 'insertion' ? String(item.rightContext || '') : '',
                tokenIndexes,
                chunkIndexes: Array.isArray(item.chunkIndexes)
                    ? item.chunkIndexes.filter(Number.isInteger)
                    : []
            };
        })
        .filter(item => item.text || item.tokenIndexes.length);
    const sourceIndexes = Array.isArray(record.selectedTokenIndexes)
        ? record.selectedTokenIndexes.filter(Number.isInteger)
        : selections.flatMap(item => item.tokenIndexes);
    const selectedTokenIndexes = [...new Set(sourceIndexes)].sort((a, b) => a - b);

    return {
        timestamp: Number(record.timestamp) || Date.now(),
        sentenceId: record.sentenceId || null,
        sentence: String(record.sentence || ''),
        naturalKo: String(record.naturalKo || ''),
        verb: String(record.verb || ''),
        assemblyChunks: Array.isArray(record.assemblyChunks) ? [...record.assemblyChunks] : [],
        practiceChunks: Array.isArray(record.practiceChunks) ? [...record.practiceChunks] : [],
        chunkStage: Number.isInteger(record.chunkStage) ? Math.max(0, record.chunkStage) : null,
        chunkKind: String(record.chunkKind || ''),
        chunkOutcome: String(record.chunkOutcome || ''),
        selectedTokenIndexes,
        selections,
        wordOrder: Boolean(record.wordOrder ?? record.wordOrderMistake ?? legacyTypes.includes('word_order')),
        recall: Boolean(record.recall ?? record.recallFailure ?? legacyTypes.includes('recall')),
        usedHint: Boolean(record.usedHint)
    };
}

function getMistakeHistory() {
    if (!Array.isArray(progressData.mistakeHistory)) {
        progressData.mistakeHistory = (progressData.practiceHistory || [])
            .filter(entry => entry && entry.correct === false)
            .map(normalizeMistakeRecord)
            .slice(-100);
        saveProgress();
    } else if (progressData.mistakeHistory.length > 100) {
        progressData.mistakeHistory = progressData.mistakeHistory.slice(-100);
        saveProgress();
    }
    return progressData.mistakeHistory;
}

function updatePracticeHistory(card, result, errorTypes, usedHint, mistakeDetails = [], chunkMeta = {}) {
    const correct = result === 'O';
    const mistakeHistory = getMistakeHistory();
    progressData.practiceHistory = progressData.practiceHistory || [];
    progressData.practiceHistory.push({
        timestamp: Date.now(),
        sentence: card.en,
        verb: card.verb,
        correct,
        usedHint,
        chunkStageBefore: chunkMeta.stageBefore,
        chunkStageAfter: chunkMeta.stageAfter,
        chunkSuccessStreakAfter: chunkMeta.successStreakAfter,
        chunkKind: chunkMeta.kind,
        chunkOutcome: chunkMeta.outcome,
        practiceChunkCount: Array.isArray(chunkMeta.practiceChunks) ? chunkMeta.practiceChunks.length : 0
    });
    progressData.practiceHistory = progressData.practiceHistory.slice(-100);

    if (!correct) {
        mistakeHistory.push(normalizeMistakeRecord({
            timestamp: Date.now(),
            sentenceId: card.id,
            sentence: card.en,
            naturalKo: card.ko,
            verb: card.verb,
            assemblyChunks: card.assemblyChunks,
            practiceChunks: chunkMeta.practiceChunks,
            chunkStage: chunkMeta.stageBefore,
            chunkKind: chunkMeta.kind,
            chunkOutcome: chunkMeta.outcome,
            selectedTokenIndexes: [...selectedMistakeIndexes],
            selections: mistakeDetails,
            wordOrder: (errorTypes || []).includes('word_order'),
            recall: (errorTypes || []).includes('recall'),
            usedHint
        }));
        progressData.mistakeHistory = mistakeHistory.slice(-100);
    }
}

/**
 * 사용자가 직접 체크한 오류를 복습 일정과 개인 오류 기록에 반영한다.
 */
function recordAssessment(result, errorTypes = [], usedHint = false, mistakeDetails = [], chunkOutcome = 'clean') {
    if (currentAssessmentRecorded) return '';
    const card = todayCards[currentIndex];
    if (!card) return '';
    currentAssessmentRecorded = true;

    const isBrandNew = !progressData[card.en];
    const record = progressData[card.en] || {};
    if (isBrandNew) {
        const todayStr = getTodayKey();
        progressData.dailyStats = progressData.dailyStats || {};
        if (!progressData.dailyStats[todayStr]) progressData.dailyStats[todayStr] = { newLearned: 0 };
        progressData.dailyStats[todayStr].newLearned += 1;
    }

    record.interval = record.interval || 0;
    record.wrongCount = record.wrongCount || 0;
    record.totalWrong = Math.max((record.totalWrong || 0), record.wrongCount);
    record.warningState = record.warningState || 0;

    const chunkStageBefore = Number.isInteger(currentPractice?.chunkStage)
        ? currentPractice.chunkStage
        : currentChunkStage;
    const chunkProgress = Learning.updateChunkProgress(record, {
        kind: chunkOutcome,
        stageBefore: chunkStageBefore,
        maxStage: Number.isInteger(currentPractice?.maxChunkStage)
            ? currentPractice.maxChunkStage
            : currentChunkPlan?.maxStage
    });
    record.chunkStage = chunkProgress.chunkStage;
    record.chunkSuccessStreak = chunkProgress.chunkSuccessStreak;

    const now = new Date();
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    let scheduleMessage = '';

    if (result === 'O') {
        const consecutive = record.wrongCount;
        record.wrongCount = 0;
        if (record.interval === 0) record.interval = 0.5;
        else if (record.interval === 0.5) record.interval = 1;
        else if (record.interval === 1) record.interval = 3;
        else record.interval *= 2;

        if (consecutive >= 3) record.warningState = 1;
        else if (record.warningState === 1) record.warningState = 2;
        else if (record.warningState === 2) record.warningState = 0;

        if (record.interval === 0.5) {
            record.nextDate = now.getTime() + 60 * 60 * 1000;
            scheduleMessage = '60분 뒤에 복습합니다.';
        } else {
            record.nextDate = todayMidnight.getTime() + record.interval * 24 * 60 * 60 * 1000;
            scheduleMessage = `${record.interval}일 뒤에 복습합니다.`;
        }
    } else {
        record.wrongCount += 1;
        record.totalWrong += 1;
        record.interval = 0;
        record.warningState = 0;
        record.nextDate = now.getTime() + (record.wrongCount >= 3 ? 1 : 60) * 60 * 1000;

        const retryCount = sessionRetryCounts[card.en] || 0;
        if (retryCount < 2) {
            sessionRetryCounts[card.en] = retryCount + 1;
            const insertAt = Math.min(currentIndex + 4, todayCards.length);
            todayCards.splice(insertAt, 0, card);
            const totalIdx = document.getElementById('total-idx');
            if (totalIdx) totalIdx.innerText = todayCards.length;
            scheduleMessage = '몇 문장 뒤에 같은 문장을 다시 확인합니다.';
        } else {
            scheduleMessage = record.wrongCount >= 3 ? '1분 뒤 복습 대상으로 남깁니다.' : '60분 뒤 복습 대상으로 남깁니다.';
        }
    }

    progressData[card.en] = record;
    updatePracticeHistory(card, result, errorTypes, usedHint, mistakeDetails, {
        stageBefore: chunkStageBefore,
        stageAfter: chunkProgress.chunkStage,
        successStreakAfter: chunkProgress.chunkSuccessStreak,
        kind: currentPractice?.chunkKind || currentChunkPlan?.kind || '',
        outcome: chunkOutcome,
        practiceChunks: Array.isArray(currentPractice?.targetChunks)
            ? [...currentPractice.targetChunks]
            : []
    });
    saveProgress();
    updateDashboardStats();
    return scheduleMessage;
}

function advanceCard() {
    if (!currentAssessmentRecorded) return;
    currentIndex++;
    if (currentIndex >= todayCards.length) showCompletionScreen();
    else loadCard();
}

/**
 * 🎉 세션 학습이 완벽히 끝났을 때의 축하 화면
 */
function showCompletionScreen() {
    const cardEl = document.getElementById('card');
    const completionMsg = document.getElementById('completion-msg');

    if (completionMsg) completionMsg.style.display = 'block';
    
    const elementsToHide = [
        'order-guide', 'natural-answer', 'korean', 'english-answer-label', 'english', 'hint', 'practice-panel', 'mistake-review', 'card-action-row',
        'action-buttons', 'progress-container',
        'verb-badge', 'new-badge', 'wrong-badge'
    ];
    
    elementsToHide.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    if (cardEl) {
        cardEl.onclick = null; // 뒤집기 방지
    }
}

/**
 * 🔄 다음 세션을 실행하기 위한 새로고침 처리
 */
function checkReload() {
    location.reload();
}

// 🚀 데이터베이스 불러오며 서비스 즉시 부트스트랩
fetchDatabase();

/* ==========================================================================
   📋 질문 노트 (Quick Question Note) 모듈
   ========================================================================== */

const QUESTION_STORAGE_KEY = 'coreVerbs_QuestionNotes_v1';
let questionNotes = JSON.parse(localStorage.getItem(QUESTION_STORAGE_KEY)) || [];
let currentQuestionSort = 'latest';
let editingQuestionId = null;

// 💾 질문 노트 로컬 스토리지 저장
function saveQuestionNotes() {
    localStorage.setItem(QUESTION_STORAGE_KEY, JSON.stringify(questionNotes));
    updateQuestionBadge();
}

// 🔢 탭 뱃지 카운터 업데이트
function updateQuestionBadge() {
    const badge = document.getElementById('question-badge');
    if (!badge) return;
    const count = questionNotes.length;
    if (count > 0) {
        badge.innerText = count;
        badge.style.display = 'inline';
    } else {
        badge.style.display = 'none';
    }
}

// 🗂️ 탭 전환
function switchTab(tabName) {
    const studyView = document.getElementById('study-view');
    const questionView = document.getElementById('question-view');
    const tabStudy = document.getElementById('tab-study');
    const tabQuestion = document.getElementById('tab-question');

    if (tabName === 'study') {
        studyView.style.display = '';
        questionView.style.display = 'none';
        tabStudy.classList.add('active');
        tabQuestion.classList.remove('active');
    } else {
        studyView.style.display = 'none';
        questionView.style.display = 'flex';
        tabStudy.classList.remove('active');
        tabQuestion.classList.add('active');
        renderQuestionNotes();
    }
}

/* ---------- 바텀시트 제어 ---------- */

function openQuestionSheet() {
    const card = todayCards[currentIndex];
    if (!card) return;

    document.getElementById('bs-day-verb').innerText = `DAY ${card.day} [ ${card.verb} ]`;
    document.getElementById('bs-ko').innerText = card.ko;
    document.getElementById('bs-en').innerText = card.en;
    document.getElementById('question-input').value = '';

    document.getElementById('bottomsheet-overlay').classList.add('active');
    document.getElementById('bottomsheet').classList.add('active');

    setTimeout(() => document.getElementById('question-input').focus(), 400);
}

function closeQuestionSheet() {
    document.getElementById('bottomsheet-overlay').classList.remove('active');
    document.getElementById('bottomsheet').classList.remove('active');
    document.getElementById('question-input').blur();
}

function saveQuestion() {
    const input = document.getElementById('question-input');
    const text = input.value.trim();
    if (!text) {
        input.style.borderColor = '#e53935';
        setTimeout(() => input.style.borderColor = '#e2e8f0', 800);
        return;
    }

    const card = todayCards[currentIndex];
    if (!card) return;

    const note = {
        id: Date.now(),
        day: card.day,
        verb: card.verb,
        ko: card.ko,
        en: card.en,
        question: text,
        createdAt: new Date().toISOString(),
        updatedAt: null
    };

    questionNotes.unshift(note);
    saveQuestionNotes();
    closeQuestionSheet();

    // 저장 피드백 토스트
    const feedbackEl = document.getElementById('feedback-msg');
    if (feedbackEl) {
        feedbackEl.innerHTML = `📝 질문 저장 완료!<br><span style="font-size:0.9rem;font-weight:500;">질문 노트 탭에서 확인하세요</span>`;
        feedbackEl.style.backgroundColor = 'rgba(243, 156, 18, 0.95)';
        feedbackEl.style.display = 'block';
        setTimeout(() => feedbackEl.style.display = 'none', 1400);
    }
}

/* ---------- 질문 수정 바텀시트 ---------- */

function openEditSheet(id) {
    const note = questionNotes.find(n => n.id === id);
    if (!note) return;
    editingQuestionId = id;

    document.getElementById('edit-day-verb').innerText = `DAY ${note.day} [ ${note.verb} ]`;
    document.getElementById('edit-ko').innerText = note.ko;
    document.getElementById('edit-en').innerText = note.en;
    document.getElementById('edit-question-input').value = note.question;

    document.getElementById('edit-bottomsheet-overlay').classList.add('active');
    document.getElementById('edit-bottomsheet').classList.add('active');

    setTimeout(() => document.getElementById('edit-question-input').focus(), 400);
}

function closeEditSheet() {
    document.getElementById('edit-bottomsheet-overlay').classList.remove('active');
    document.getElementById('edit-bottomsheet').classList.remove('active');
    document.getElementById('edit-question-input').blur();
    editingQuestionId = null;
}

function saveEditQuestion() {
    if (!editingQuestionId) return;
    const input = document.getElementById('edit-question-input');
    const text = input.value.trim();
    if (!text) {
        input.style.borderColor = '#e53935';
        setTimeout(() => input.style.borderColor = '#e2e8f0', 800);
        return;
    }

    const note = questionNotes.find(n => n.id === editingQuestionId);
    if (note) {
        note.question = text;
        note.updatedAt = new Date().toISOString();
        saveQuestionNotes();
    }
    closeEditSheet();
    renderQuestionNotes();
}

/* ---------- 질문 삭제 ---------- */

function deleteQuestion(id) {
    if (!confirm('이 질문을 삭제할까요?')) return;
    questionNotes = questionNotes.filter(n => n.id !== id);
    saveQuestionNotes();
    renderQuestionNotes();
}

/* ---------- 정렬 필터 ---------- */

function setQuestionSort(sortBy) {
    currentQuestionSort = sortBy;
    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.sort === sortBy);
    });
    renderQuestionNotes();
}

/* ---------- 질문 노트 렌더링 ---------- */

function renderQuestionNotes() {
    const listEl = document.getElementById('question-list');
    const emptyEl = document.getElementById('question-empty');
    const exportBar = document.getElementById('export-bar');
    if (!listEl) return;

    if (questionNotes.length === 0) {
        listEl.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'block';
        if (exportBar) exportBar.style.display = 'none';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    if (exportBar) exportBar.style.display = 'flex';

    let sorted = [...questionNotes];

    if (currentQuestionSort === 'latest') {
        sorted.sort((a, b) => b.id - a.id);
        listEl.innerHTML = sorted.map(n => buildQuestionCard(n)).join('');
    } else if (currentQuestionSort === 'day') {
        sorted.sort((a, b) => (a.day || 0) - (b.day || 0));
        const groups = groupBy(sorted, 'day');
        let html = '';
        for (const [key, items] of Object.entries(groups)) {
            html += `<div class="q-group-header">📅 DAY ${key}</div>`;
            html += items.map(n => buildQuestionCard(n)).join('');
        }
        listEl.innerHTML = html;
    } else if (currentQuestionSort === 'verb') {
        sorted.sort((a, b) => (a.verb || '').localeCompare(b.verb || ''));
        const groups = groupBy(sorted, 'verb');
        let html = '';
        for (const [key, items] of Object.entries(groups)) {
            html += `<div class="q-group-header">🔤 ${key.toUpperCase()}</div>`;
            html += items.map(n => buildQuestionCard(n)).join('');
        }
        listEl.innerHTML = html;
    }
}

function groupBy(arr, key) {
    const map = {};
    arr.forEach(item => {
        const k = item[key] || '?';
        if (!map[k]) map[k] = [];
        map[k].push(item);
    });
    return map;
}

function formatDate(isoStr) {
    const d = new Date(isoStr);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${mi}`;
}

function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function buildQuestionCard(note) {
    const dateStr = formatDate(note.createdAt);
    const edited = note.updatedAt ? ' (수정됨)' : '';
    return `
    <div class="q-card">
        <div class="q-card-header">
            <span class="q-card-tag">DAY ${note.day} [ ${escapeHtml(note.verb)} ]</span>
            <span class="q-card-date">${dateStr}${edited}</span>
        </div>
        <div class="q-card-question">❓ ${escapeHtml(note.question)}</div>
        <div class="q-card-sentence">
            <div class="q-card-ko">${escapeHtml(note.ko)}</div>
            <div class="q-card-en">${escapeHtml(note.en)}</div>
        </div>
        <div class="q-card-actions">
            <button class="q-action-btn" onclick="openEditSheet(${note.id})">✏️ 수정</button>
            <button class="q-action-btn copy" onclick="copyQuestion(${note.id})">📋 복사</button>
            <button class="q-action-btn delete" onclick="deleteQuestion(${note.id})">🗑️ 삭제</button>
        </div>
    </div>`;
}

/* ---------- 개별 질문 복사 ---------- */

function copyQuestion(id) {
    const n = questionNotes.find(q => q.id === id);
    if (!n) return;

    const text = `📌 DAY ${n.day} [${n.verb}] - "${n.ko}" / "${n.en}"\n❓ ${n.question}`;

    const showFeedback = () => {
        const feedbackEl = document.getElementById('feedback-msg');
        if (feedbackEl) {
            feedbackEl.innerHTML = `📋 복사 완료!<br><span style="font-size:0.9rem;font-weight:500;">AI에게 붙여넣기 하세요</span>`;
            feedbackEl.style.backgroundColor = 'rgba(44, 62, 80, 0.95)';
            feedbackEl.style.display = 'block';
            setTimeout(() => feedbackEl.style.display = 'none', 1800);
        }
    };

    navigator.clipboard.writeText(text).then(showFeedback).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        alert('클립보드에 복사되었습니다!');
    });
}

/* ---------- 내보내기 (클립보드 복사) ---------- */

function exportQuestions() {
    if (questionNotes.length === 0) return;

    const today = new Date().toISOString().slice(0, 10);
    let text = `[Core Verbs 학습 질문 모음 - ${today}]\n\n`;

    const sorted = [...questionNotes].sort((a, b) => (a.day || 0) - (b.day || 0) || a.id - b.id);

    sorted.forEach(n => {
        text += `📌 DAY ${n.day} [${n.verb}] - "${n.ko}" / "${n.en}"\n`;
        text += `❓ ${n.question}\n\n`;
    });

    text += `---\n총 ${questionNotes.length}개 질문 | Core Verbs 앱에서 내보냄`;

    navigator.clipboard.writeText(text).then(() => {
        const feedbackEl = document.getElementById('feedback-msg');
        if (feedbackEl) {
            feedbackEl.innerHTML = `📤 클립보드에 복사 완료!<br><span style="font-size:0.9rem;font-weight:500;">AI에게 붙여넣기 하세요</span>`;
            feedbackEl.style.backgroundColor = 'rgba(44, 62, 80, 0.95)';
            feedbackEl.style.display = 'block';
            setTimeout(() => feedbackEl.style.display = 'none', 1800);
        }
    }).catch(() => {
        // 클립보드 API 실패 시 폴백 (구형 브라우저)
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        alert('클립보드에 복사되었습니다!');
    });
}

// 🔢 초기 뱃지 업데이트
updateQuestionBadge();

/* ==========================================================================
   💾 학습 기록 백업 / 복원 (Backup & Restore)
   진도·복습 일정·설정·질문 노트를 하나의 JSON 파일로 내보내고,
   재설치/새 기기에서 불러와 기존 진도를 그대로 이어서 학습한다.
   ========================================================================== */

const MISTAKE_EXPORT_FORMAT = 'core-verbs-mistakes';
const BACKUP_FORMAT = 'core-verbs-backup';
const BACKUP_VERSION = 1;

// 🔔 백업 관련 토스트 피드백
function showBackupToast(html, bg) {
    const feedbackEl = document.getElementById('feedback-msg');
    if (!feedbackEl) return;
    feedbackEl.innerHTML = html;
    feedbackEl.style.backgroundColor = bg;
    feedbackEl.style.display = 'block';
    setTimeout(() => feedbackEl.style.display = 'none', 2200);
}

// 🧠 최근 오답 원자료만 최대 100건으로 내보내 AI 분석에 사용할 수 있게 한다.
function exportMistakeHistory() {
    const records = getMistakeHistory().map(normalizeMistakeRecord).slice(-100);
    if (!records.length) {
        showBackupToast('아직 내보낼 오류 기록이 없습니다.', 'rgba(44, 62, 80, 0.95)');
        return;
    }

    const payload = {
        format: MISTAKE_EXPORT_FORMAT,
        version: 2,
        exportedAt: new Date().toISOString(),
        recordCount: records.length,
        fieldGuide: {
            selectedTokenIndexes: '영어 문장의 0부터 시작하는 단어 위치',
            selections: '실제 오답 원자료. operation이 source_token이면 정답 단어 선택, insertion이면 정답에 없는 말 추가',
            insertedText: '학습자가 정답에 덧붙여 생각하거나 말한 단어 또는 짧은 구문',
            afterTokenIndex: '추가한 말 바로 앞 정답 단어의 위치. -1이면 문장 맨 앞',
            beforeTokenIndex: '추가한 말 바로 뒤 정답 단어의 위치. null이면 문장 끝',
            wordOrder: '청크 어순을 틀렸는지 여부',
            recall: '문장 전체를 떠올리지 못했는지 여부',
            practiceChunks: '이 시도에서 실제로 제시된 조립 단위',
            chunkKind: 'micro(짧은 조립), canonical(검수 청크), merged(긴 조립), recall(전체 회상)',
            chunkStage: '이 문장에서 사용한 자동 청크 단계의 0부터 시작하는 위치',
            note: '문법 유형은 앱이 단정하지 않습니다. 반복 패턴은 문장 문맥과 함께 분석하세요.'
        },
        records
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `core-verbs-mistakes-${stamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showBackupToast(`오류 기록 ${records.length}건을 파일로 저장했습니다.`, 'rgba(15, 118, 110, 0.96)');
}

// ⬇️ 현재 localStorage의 학습 데이터를 JSON 파일로 내려받는다.
function exportBackup() {
    const payload = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        data: {
            [STORAGE_KEY]: JSON.parse(localStorage.getItem(STORAGE_KEY)) || {},
            [QUESTION_STORAGE_KEY]: JSON.parse(localStorage.getItem(QUESTION_STORAGE_KEY)) || []
        }
    };

    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const stamp = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `core-verbs-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    showBackupToast(
        `💾 백업 완료!<br><span style="font-size:0.9rem;font-weight:500;">파일을 안전한 곳에 보관하세요</span>`,
        'rgba(129, 178, 154, 0.95)'
    );
}

// ⬆️ 선택한 백업 파일을 읽어 학습 데이터를 복원한다.
function importBackup(inputEl) {
    const file = inputEl.files && inputEl.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const parsed = JSON.parse(e.target.result);

            // 백업 파일 형식 검증
            const data = parsed && parsed.data;
            if (!parsed || parsed.format !== BACKUP_FORMAT || !data || typeof data !== 'object') {
                throw new Error('형식 불일치');
            }

            const memory = data[STORAGE_KEY];
            const notes = data[QUESTION_STORAGE_KEY];
            if (typeof memory !== 'object' || memory === null) {
                throw new Error('학습 데이터 없음');
            }

            const when = parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString('ko-KR') : '알 수 없음';
            const ok = confirm(
                `이 백업으로 현재 학습 기록을 덮어쓸까요?\n\n` +
                `백업 시점: ${when}\n\n` +
                `현재 기기의 진도/질문 노트는 백업 내용으로 대체됩니다.`
            );
            if (!ok) {
                inputEl.value = '';
                return;
            }

            // localStorage에 복원
            localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
            if (Array.isArray(notes)) {
                localStorage.setItem(QUESTION_STORAGE_KEY, JSON.stringify(notes));
            }

            showBackupToast(
                `✅ 복원 완료!<br><span style="font-size:0.9rem;font-weight:500;">잠시 후 학습을 이어서 시작합니다</span>`,
                'rgba(52, 152, 219, 0.95)'
            );

            // 새 데이터로 깔끔하게 재시작
            setTimeout(() => location.reload(), 1500);
        } catch (err) {
            console.error('백업 복원 실패', err);
            showBackupToast(
                `❌ 복원 실패<br><span style="font-size:0.9rem;font-weight:500;">올바른 Core Verbs 백업 파일이 아닙니다</span>`,
                'rgba(224, 122, 95, 0.95)'
            );
        } finally {
            inputEl.value = ''; // 같은 파일 재선택 가능하도록 초기화
        }
    };
    reader.readAsText(file);
}

/* ==========================================================================
   📲 서비스 워커 등록 (PWA 설치 / 오프라인 실행)
   ========================================================================== */
if ('serviceWorker' in navigator) {
    let refreshingForNewVersion = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshingForNewVersion) return;
        refreshingForNewVersion = true;
        window.location.reload();
    });
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => {
            console.warn('서비스 워커 등록 실패(앱 기능에는 영향 없음):', err);
        });
    });
}

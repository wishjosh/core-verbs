/* ==========================================================================
   Core Verbs - 프리미엄 애플리케이션 로직 (app.js)
   ========================================================================== */

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSR1wby3k5QhlAL8f8MeH-Ni1qjGgRMu8ROHDoPCKci-GYrbpx1DzTsAvcr_l5qBcemui93D4cqMLa0/pub?output=tsv"; 
const STORAGE_KEY = 'coreVerbs_Memory_v1'; 

// 🧠 애플리케이션 상태(State) 변수
let db = [];
let todayCards = [];
let currentIndex = 0;
let availableVoices = [];
let iosResumeTimer = null; // iOS Speech Synthesis 중간 무음 버그 방지 타이머

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

function playAudio() {
    const card = todayCards[currentIndex];
    if (!card) return;

    const text = card.en;
    clearInterval(iosResumeTimer);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = progressData.settings.rate || 0.9;
    utterance.pitch = 1.0;
    utterance.onend = () => clearInterval(iosResumeTimer);

    // 설정된 프리미엄 목소리 바인딩
    const selectedVoiceName = progressData.settings.voiceName;
    const voice = availableVoices.find(v => v.name === selectedVoiceName);
    if (voice) utterance.voice = voice;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        window.speechSynthesis.cancel();
        setTimeout(() => {
            window.speechSynthesis.speak(utterance);
            if (isIOS) startIOSResumeHack();
        }, 80);
    } else {
        window.speechSynthesis.speak(utterance);
        if (isIOS) startIOSResumeHack();
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

/**
 * 🌐 구글 스프레드시트(TSV)로부터 데이터 로딩 및 초기 데이터베이스 구성
 */
async function fetchDatabase() {
    try {
        const response = await fetch(SHEET_URL);
        const data = await response.text();
        const rows = data.split('\n');
        
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
                    db.push({ day: parseInt(day) || "?", verb: verb, ko: ko, en: en });
                }
            }
        }
        init(); 
    } catch (error) {
        console.error("데이터를 불러오지 못했습니다.", error);
        document.getElementById('verb-badge').innerText = "에러 발생";
        document.getElementById('korean').innerText = "데이터를 불러오는 데 실패했습니다.\n인터넷 연결을 확인해 주세요.";
        document.getElementById('hint').style.display = 'none';
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

    shuffleArray(newCards);

    // 2. 동적 세션 타겟팅 (일일 10개 엄수 & 복습 우선)
    const todayStr = new Date().toLocaleDateString('en-CA');
    const dailyLearned = progressData.dailyStats?.[todayStr]?.newLearned || 0;
    const pendingReviews = dueReviewCards.length;
    const DAILY_LIMIT = 10;

    let targetNew = 0;
    let targetReview = 20;

    if (pendingReviews >= 20) {
        // 원칙 2: 복습 폭발 방어 (복습에 몰빵)
        targetNew = 0;
        targetReview = 20;
    } else {
        // 원칙 1 & 3: 남은 일일 할당량 내에서만 새 문장 허용
        let remainToday = Math.max(0, DAILY_LIMIT - dailyLearned);
        targetNew = Math.min(remainToday, 10);
        targetReview = 20 - targetNew;
    }

    // 3. 당일 외울 새 문장 선정 (기본동사 단위)
    let selectedNew = [];
    if (targetNew > 0 && newCards.length > 0) {
        // 첫 번째 새 문장의 동사를 타겟 동사로 지정
        const targetVerb = newCards[0].verb;
        const verbCards = newCards.filter(card => card.verb === targetVerb);
        const otherNewCards = newCards.filter(card => card.verb !== targetVerb);
        
        let takeVerb = Math.min(verbCards.length, targetNew);
        selectedNew.push(...verbCards.slice(0, takeVerb));
        
        // 목표치가 안 되면 나머지 랜덤 새 문장으로 채움
        if (selectedNew.length < targetNew && otherNewCards.length > 0) {
            let remain = targetNew - selectedNew.length;
            let takeOther = Math.min(otherNewCards.length, remain);
            selectedNew.push(...otherNewCards.slice(0, takeOther));
        }
    }

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

    todayCards = [...selectedNew, ...selectedReview];

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

    if (statTotal) statTotal.innerText = countTotal;
    if (statNew) statNew.innerText = countNew;
    if (statDanger) statDanger.innerText = countDanger;
    if (statMid) statMid.innerText = countMid;
    if (statLong) statLong.innerText = countLong;
}

/**
 * 🃏 개별 학습 카드 데이터를 화면에 로드
 */
function loadCard() {
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
    const wrongCount = record.wrongCount || 0;
    const wrongBadge = document.getElementById('wrong-badge');
    const newBadge = document.getElementById('new-badge');
    const isBrandNew = !progressData[card.en];

    if (newBadge) {
        if (isBrandNew) {
            newBadge.innerText = '🆕 오늘의 새 문장';
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
    const englishEl = document.getElementById('english');
    const hintEl = document.getElementById('hint');
    const cardActionRow = document.getElementById('card-action-row');
    const actionBtnEl = document.getElementById('action-buttons');

    if (koreanEl) koreanEl.innerText = card.ko;
    if (englishEl) {
        englishEl.innerText = card.en;
        englishEl.style.display = 'none';
    }
    
    if (hintEl) hintEl.style.display = 'block';
    if (cardActionRow) cardActionRow.style.display = 'none';
    if (actionBtnEl) actionBtnEl.style.display = 'none';
}

/**
 * 👁️ 화면을 터치했을 때 정답(영어)을 노출
 */
function showAnswer() {
    const englishEl = document.getElementById('english');
    if (!englishEl || englishEl.style.display === 'block') return;

    // iOS: 첫 터치 시점에 목소리가 아직 안 로드된 경우 즉시 재시도
    if (availableVoices.length === 0) populateVoiceList();

    englishEl.style.display = 'block';

    const cardActionRow = document.getElementById('card-action-row');
    const hintEl = document.getElementById('hint');
    const actionBtnEl = document.getElementById('action-buttons');

    if (cardActionRow) cardActionRow.style.display = 'flex';
    if (hintEl) hintEl.style.display = 'none';
    if (actionBtnEl) actionBtnEl.style.display = 'flex';

    // iOS 오디오 정책: setTimeout 없이 user gesture 내에서 직접 호출해야 재생됨
    playAudio();
}

/**
 * ➡️ 학습 카드 제출 (O: Perfect / X: Review) 및 스마트 망각 스케줄링 계산
 */
function nextCard(result) {
    const feedbackEl = document.getElementById('feedback-msg');
    const card = todayCards[currentIndex];
    if (!card || !feedbackEl) return;
    
    const isBrandNew = !progressData[card.en];
    let record = progressData[card.en] || {}; 
    
    // 일일 새 문장 학습량 추적 (최초 뒤집기 시점 1회)
    if (isBrandNew) {
        const todayStr = new Date().toLocaleDateString('en-CA');
        progressData.dailyStats = progressData.dailyStats || {};
        if (!progressData.dailyStats[todayStr]) {
            progressData.dailyStats[todayStr] = { newLearned: 0 };
        }
        progressData.dailyStats[todayStr].newLearned += 1;
    }
    
    record.interval = record.interval || 0;
    record.wrongCount = record.wrongCount || 0;
    record.totalWrong = Math.max((record.totalWrong || 0), record.wrongCount);
    record.warningState = record.warningState || 0;
    
    const now = new Date();
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0); 

    if (result === 'O') {
        const consecutive = record.wrongCount;
        const total = record.totalWrong;
        const wState = record.warningState;
        
        record.wrongCount = 0; 
        
        if (record.interval === 0) {
            record.interval = 0.5; // 60 minutes
        } else if (record.interval === 0.5) {
            record.interval = 1;
        } else if (record.interval === 1) {
            record.interval = 3;
        } else {
            record.interval = record.interval * 2;
        }
        
        if (consecutive >= 3) {
            feedbackEl.innerHTML = `정복 완료! 🔥<br><span style="font-size:0.95rem; font-weight:500;">총 ${total}번 틀린 문장입니다. 확실히 기억하세요!</span>`;
            feedbackEl.style.backgroundColor = "rgba(230, 126, 34, 0.95)"; 
            record.warningState = 1; 
        } else if (wState === 1) {
            feedbackEl.innerHTML = `훌륭해요! 🎉<br><span style="font-size:0.95rem; font-weight:500;">주의 문장 방어 성공!</span>`;
            feedbackEl.style.backgroundColor = "rgba(129, 178, 154, 0.95)"; 
            record.warningState = 2; 
        } else if (wState === 2) {
            feedbackEl.innerHTML = `완벽 마스터! 👑<br><span style="font-size:0.95rem; font-weight:500;">주의 문장에서 해제되었습니다!</span>`;
            feedbackEl.style.backgroundColor = "rgba(52, 152, 219, 0.95)"; 
            record.warningState = 0; 
        } else {
            if (record.interval === 0.5) {
                feedbackEl.innerHTML = `완벽하네요!<br><span style="font-size:0.95rem; font-weight:500;">60분 뒤에 복습합니다.</span>`;
            } else {
                feedbackEl.innerHTML = `완벽하네요!<br><span style="font-size:0.95rem; font-weight:500;">${record.interval}일 뒤에 복습합니다.</span>`;
            }
            feedbackEl.style.backgroundColor = "rgba(129, 178, 154, 0.95)"; 
        }
        
        if (record.interval === 0.5) {
            const nextDate = new Date(now.getTime() + 60 * 60 * 1000); // 60분 뒤
            record.nextDate = nextDate.getTime();
        } else {
            const nextDate = new Date(todayMidnight.getTime() + record.interval * 24 * 60 * 60 * 1000);
            record.nextDate = nextDate.getTime();
        }
    } else {
        record.wrongCount += 1; 
        record.totalWrong += 1; 
        record.interval = 0; 
        record.warningState = 0; 
        
        if (record.wrongCount >= 3) {
            feedbackEl.innerHTML = `연속 3번 이상 틀렸네요!<br><span style="font-size:0.95rem; font-weight:500;">1분 뒤에 바로 다시 나옵니다. 🔥</span>`;
            feedbackEl.style.backgroundColor = "rgba(224, 122, 95, 0.95)"; 
            const nextDate = new Date(now.getTime() + 1 * 60 * 1000); 
            record.nextDate = nextDate.getTime();
        } else {
            feedbackEl.innerHTML = `괜찮습니다!<br><span style="font-size:0.95rem; font-weight:500;">60분 뒤에 다시 나옵니다.</span>`;
            feedbackEl.style.backgroundColor = "rgba(224, 122, 95, 0.95)"; 
            const nextDate = new Date(now.getTime() + 60 * 60 * 1000); 
            record.nextDate = nextDate.getTime();
        }
    }

    progressData[card.en] = record;
    saveProgress();

    feedbackEl.style.display = 'block';

    setTimeout(function() {
        feedbackEl.style.display = 'none';
        currentIndex++;
        
        if (currentIndex >= todayCards.length) {
            showCompletionScreen();
        } else {
            loadCard();
        }
    }, 1600); // 딜레이를 1.8초에서 1.6초로 개선하여 가속도 부여
}

/**
 * 🎉 세션 학습이 완벽히 끝났을 때의 축하 화면
 */
function showCompletionScreen() {
    const cardEl = document.getElementById('card');
    const completionMsg = document.getElementById('completion-msg');

    if (completionMsg) completionMsg.style.display = 'block';
    
    const elementsToHide = [
        'korean', 'english', 'hint', 'card-action-row', 
        'action-buttons', 'progress-container', 
        'verb-badge', 'wrong-badge'
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

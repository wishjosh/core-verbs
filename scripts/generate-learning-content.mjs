import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUTPUT_PATH = path.join(DATA_DIR, 'learning-content.json');
const CACHE_PATH = path.join(DATA_DIR, '.learning-content-cache.json');
const PILOT_PATH = path.join(DATA_DIR, 'learning-content-pilot.json');
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSR1wby3k5QhlAL8f8MeH-Ni1qjGgRMu8ROHDoPCKci-GYrbpx1DzTsAvcr_l5qBcemui93D4cqMLa0/pub?output=tsv';
const OLLAMA_URL = 'http://127.0.0.1:11434/api/chat';
const ERROR_TYPES = ['article', 'plural', 'preposition', 'koreanism', 'tense_auxiliary'];
const REVIEWED_OVERRIDES = new Map([
    ['Did you leave work yet?', {
        assemblyChunks: ['Did', 'you leave work yet?'],
        orderGlosses: ['(과거를 묻는 질문)', '너 아직 퇴근했어?'],
        corePatterns: ['Did + 주어 + 동사원형 + yet?', 'leave work'],
        errorPoints: [{
            type: 'tense_auxiliary',
            correct: 'Did',
            distractor: 'Do',
            tip: '오늘의 한 번뿐인 퇴근 여부를 묻는 과거 상황이므로 Did를 씁니다.'
        }]
    }],
    ["I can't. I'm on my way to the post office.", {
        assemblyChunks: ["I can't.", "I'm on my way", 'to the post office.'],
        orderGlosses: ['안 돼.', '나는 가는 길이야', '우체국으로.'],
        corePatterns: ["can't + 동사원형", "be on one's way to + 장소"],
        errorPoints: [{
            type: 'article',
            correct: 'the post office',
            distractor: 'post office',
            tip: '말하는 사람과 듣는 사람이 떠올릴 수 있는 목적지인 우체국에는 the를 붙입니다.'
        }]
    }],
    ['I barely made it to the airport on time, only to have my flight delayed.', {
        assemblyChunks: ['I barely', 'made it to the airport', 'on time,', 'only to have my flight delayed.'],
        orderGlosses: ['나는 간신히', '공항에 도착했는데', '제시간에,', '결국 비행기가 지연되는 일을 겪었다.'],
        corePatterns: ['make it to + 장소', 'on time', 'only to + 동사원형', 'have + 목적어 + 과거분사'],
        errorPoints: [{
            type: 'article',
            correct: 'the airport',
            distractor: 'airport',
            tip: '이동 목적지로 특정 공항을 가리킬 때는 보통 the airport라고 합니다.'
        }]
    }],
    ['Yeah, and the second place has parking, but it’s next to a busy street.', {
        assemblyChunks: ['Yeah,', 'and the second place has parking,', 'but it’s next to a busy street.'],
        orderGlosses: ['그래,', '그리고 두 번째 곳은 주차가 되지만,', '하지만 붐비는 거리 바로 옆이야.'],
        corePatterns: ['have parking', 'be next to + 장소', 'a busy + 명사'],
        errorPoints: [{
            type: 'article',
            correct: 'a busy street',
            distractor: 'busy street',
            tip: '처음 언급하는 셀 수 있는 단수 장소이므로 a busy street라고 합니다.'
        }]
    }],
    ['Hello, may I speak with Yuna Kim?', {
        assemblyChunks: ['Hello,', 'may I speak with Yuna Kim?'],
        orderGlosses: ['안녕하세요,', '제가 김유나 님과 통화해도 될까요?'],
        corePatterns: ['May I speak with + 사람?', 'speak with + 사람'],
        errorPoints: []
    }],
    ['I’m moving to the U.S. I got a job there.', {
        assemblyChunks: ['I’m moving to the U.S.', 'I got a job there.'],
        orderGlosses: ['나는 미국으로 이주해.', '나는 거기서 일자리를 구했거든.'],
        corePatterns: ['move to + 장소', 'get a job'],
        errorPoints: [{
            type: 'article',
            correct: 'the U.S.',
            distractor: 'U.S.',
            tip: '국가명 U.S. 앞에는 정관사 the를 붙여 the U.S.라고 합니다.'
        }]
    }],
    ['That’s good, but you should keep in mind that it gets a bit noisy at night with all the bars nearby.', {
        assemblyChunks: ['That’s good,', 'but you should keep in mind', 'that it gets a bit noisy', 'at night', 'with all the bars nearby.'],
        orderGlosses: ['그건 좋지만,', '하지만 염두에 두셔야 해요', '그곳이 조금 시끄러워진다는 것을', '밤에는', '근처의 많은 술집 때문에.'],
        corePatterns: ['keep in mind that + 문장', 'get a bit + 형용사', 'at night', 'with + 명사'],
        errorPoints: [{
            type: 'preposition',
            correct: 'at night',
            distractor: 'in night',
            tip: '밤이라는 시간대를 일반적으로 말할 때는 at night를 씁니다.'
        }]
    }],
    ['I know, but I don’t want to make a big deal out of it.', {
        assemblyChunks: ['I know,', 'but I don’t want to', 'make a big deal out of it.'],
        orderGlosses: ['알아,', '하지만 나는 원하지 않아', '그걸 큰일로 만들기를.'],
        corePatterns: ['don’t want to + 동사원형', 'make a big deal out of + 명사'],
        errorPoints: [{
            type: 'article',
            correct: 'a big deal',
            distractor: 'big deal',
            tip: '하나의 큰 문제나 사건이라는 뜻의 셀 수 있는 단수 표현이라 a big deal이라고 합니다.'
        }]
    }],
    ['True, but the battery life makes it a better choice for me.', {
        assemblyChunks: ['True,', 'but the battery life', 'makes it a better choice for me.'],
        orderGlosses: ['맞아,', '하지만 배터리 수명이', '그걸 나에게 더 나은 선택으로 만들어.'],
        corePatterns: ['make + 목적어 + 보어', 'a better choice for + 사람', 'battery life'],
        errorPoints: [{
            type: 'article',
            correct: 'a better choice',
            distractor: 'better choice',
            tip: '여러 선택지 가운데 하나의 더 나은 선택을 뜻하므로 a better choice라고 합니다.'
        }]
    }],
    ['Back when we were kids, my brother made me clean his room—for ten years!', {
        assemblyChunks: ['Back when we were kids,', 'my brother', 'made me clean his room—', 'for ten years!'],
        orderGlosses: ['우리가 어렸을 때,', '우리 형은', '나에게 자기 방 청소를 시켰어—', '무려 10년 동안이나!'],
        corePatterns: ['Back when + 문장', 'make + 사람 + 동사원형', 'for + 기간'],
        errorPoints: [{
            type: 'koreanism',
            correct: 'made me clean',
            distractor: 'made me to clean',
            tip: '사역동사 make 뒤에서는 사람 다음에 to 없이 동사원형을 씁니다.'
        }]
    }],
    ['The language is natural and conversational—perfect for learners.', {
        assemblyChunks: ['The language is', 'natural and conversational—', 'perfect for learners.'],
        orderGlosses: ['그 언어는', '자연스럽고 대화체라—', '학습자에게 안성맞춤이야.'],
        corePatterns: ['natural and conversational', 'perfect for + 사람'],
        errorPoints: [{
            type: 'preposition',
            correct: 'for learners',
            distractor: 'to learners',
            tip: '어떤 대상에게 알맞다는 뜻의 perfect는 for와 함께 씁니다.'
        }]
    }],
    ['Right, but they’re taking the move better than me. They already have new friends.', {
        assemblyChunks: ['Right,', 'but they’re taking the move', 'better than me.', 'They already have new friends.'],
        orderGlosses: ['맞아요,', '하지만 아이들은 이사를 받아들이고 있어요', '나보다 더 잘.', '아이들은 벌써 새 친구들이 있어요.'],
        corePatterns: ['take + 명사 + well/better', 'better than + 사람', 'have new friends'],
        errorPoints: [{
            type: 'article',
            correct: 'the move',
            distractor: 'move',
            tip: '서로 알고 있는 이번 이사를 가리키므로 the move라고 합니다.'
        }]
    }],
    ['Why? Didn’t you just start with your current teacher?', {
        assemblyChunks: ['Why?', 'Didn’t', 'you just start', 'with your current teacher?'],
        orderGlosses: ['왜?', '(과거 부정 질문)', '너 방금 시작하지 않았어', '현재 선생님과?'],
        corePatterns: ['Didn’t + 주어 + 동사원형?', 'start with + 사람'],
        errorPoints: [{
            type: 'tense_auxiliary',
            correct: 'Didn’t',
            distractor: 'Don’t',
            tip: '이미 시작한 과거 사실을 확인하는 부정 질문이므로 Didn’t를 씁니다.'
        }]
    }],
    ['We can meet in Gangnam or Yongsan—wherever works best for you.', {
        assemblyChunks: ['We can meet', 'in Gangnam or Yongsan—', 'wherever works best for you.'],
        orderGlosses: ['우리는 만날 수 있어', '강남이나 용산에서—', '네게 가장 편한 곳이면 어디든.'],
        corePatterns: ['meet in + 장소', 'wherever works best for + 사람'],
        errorPoints: [{
            type: 'preposition',
            correct: 'in Gangnam or Yongsan',
            distractor: 'at Gangnam or Yongsan',
            tip: '도시나 넓은 지역 안에서 만난다고 할 때는 in을 씁니다.'
        }]
    }],
    ['Life doesn’t really work that way. Things change, but they don’t get easier.', {
        assemblyChunks: ['Life doesn’t really work that way.', 'Things change,', 'but they don’t get easier.'],
        orderGlosses: ['삶은 실제로 그런 식으로 흘러가지 않아.', '상황은 변하지만,', '그렇다고 더 쉬워지지는 않아.'],
        corePatterns: ['work that way', 'get + 비교급'],
        errorPoints: []
    }],
    ['I have tons of work to do.', {
        assemblyChunks: ['I have', 'tons of work to do.'],
        orderGlosses: ['나는 있어', '해야 할 일이 아주 많이.'],
        corePatterns: ['have tons of + 명사', 'work to do'],
        errorPoints: []
    }],
    ['I hate doing my taxes. I can’t believe it’s May already.', {
        assemblyChunks: ['I hate doing my taxes.', 'I can’t believe it’s May already.'],
        orderGlosses: ['나는 세금 신고하는 게 싫어.', '벌써 5월이라니 믿을 수가 없어.'],
        corePatterns: ["do one's taxes", 'hate + 동명사', 'can’t believe + 문장'],
        errorPoints: [{
            type: 'koreanism',
            correct: 'doing my taxes',
            distractor: 'making my taxes',
            tip: '세금 신고를 하다는 make가 아니라 do one’s taxes라고 합니다.'
        }]
    }],
    ['Yeah, it’s pretty trendy these days.', {
        assemblyChunks: ['Yeah,', 'it’s pretty trendy', 'these days.'],
        orderGlosses: ['응,', '그건 꽤 유행이야', '요즘.'],
        corePatterns: ['be pretty + 형용사', 'these days'],
        errorPoints: []
    }],
    ['It’s that TikTok challenge that went viral last month.', {
        assemblyChunks: ['It’s that TikTok challenge', 'that went viral', 'last month.'],
        orderGlosses: ['그건 바로 그 틱톡 챌린지야', '입소문을 탄', '지난달에.'],
        corePatterns: ['go viral', 'last + 시간'],
        errorPoints: []
    }],
    ['Yes, we’re sorry about that, but we don’t take reservations for those tables.', {
        assemblyChunks: ['Yes, we’re sorry about that,', 'but we don’t take reservations', 'for those tables.'],
        orderGlosses: ['네, 그 점은 죄송하지만,', '하지만 저희는 예약을 받지 않아요', '그 테이블들은.'],
        corePatterns: ['be sorry about + 명사', 'take reservations', 'those + 복수명사'],
        errorPoints: [{
            type: 'plural',
            correct: 'those tables',
            distractor: 'that tables',
            tip: 'those 뒤에는 여러 테이블을 뜻하는 복수형 tables가 와야 합니다.'
        }]
    }],
    ['True. I’ll have to get my luggage out.', {
        assemblyChunks: ['True.', 'I’ll have to', 'get my luggage out.'],
        orderGlosses: ['맞아.', '나는 해야 할 거야', '내 짐을 꺼내는 걸.'],
        corePatterns: ['have to + 동사원형', 'get + 목적어 + out'],
        errorPoints: []
    }],
    ['Yeah, but he likes to spend most of the session talking about politics, and I can’t stand it anymore.', {
        assemblyChunks: ['Yeah,', 'but he likes to spend', 'most of the session', 'talking about politics,', 'and I can’t stand it anymore.'],
        orderGlosses: ['응,', '하지만 그는 보내기를 좋아해', '수업 시간 대부분을', '정치 이야기를 하면서,', '그래서 나는 더는 못 참겠어.'],
        corePatterns: ['spend + 시간 + 동명사', 'talk about + 주제', 'can’t stand + 명사'],
        errorPoints: [{
            type: 'article',
            correct: 'the session',
            distractor: 'session',
            tip: '지금 이야기 중인 그 수업 시간을 가리키므로 the session이라고 합니다.'
        }]
    }]
]);

const args = Object.fromEntries(process.argv.slice(2).map(raw => {
    const [key, ...value] = raw.replace(/^--/, '').split('=');
    return [key, value.length ? value.join('=') : true];
}));
const mode = String(args.mode || 'pilot');
const model = String(args.model || 'gemma4:26b');
const batchSize = Math.max(1, Number(args.batch || 8));
const pilotCount = Math.max(1, Number(args.count || 10));

const OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    assemblyChunks: { type: 'array', items: { type: 'string' } },
                    orderGlosses: { type: 'array', items: { type: 'string' } },
                    corePatterns: { type: 'array', items: { type: 'string' } },
                    errorPoints: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                type: { type: 'string', enum: ERROR_TYPES },
                                correct: { type: 'string' },
                                distractor: { type: 'string' },
                                tip: { type: 'string' }
                            },
                            required: ['type', 'correct', 'distractor', 'tip']
                        }
                    }
                },
                required: ['id', 'assemblyChunks', 'orderGlosses', 'corePatterns', 'errorPoints']
            }
        }
    },
    required: ['items']
};

const SYSTEM_PROMPT = `당신은 한국인 성인 학습자를 위한 미국 영어 코퍼스 편집자다.
입력된 각 문장의 암기용 자료를 JSON으로 만든다.

assemblyChunks 규칙:
- 원어민이 한 번에 처리하고 말하는 의미·문법·운율 단위로 보통 2~6개를 만든다. 기계적으로 같은 길이로 자르지 않는다. 6단어 이하의 짧은 고정 표현은 자연스러우면 1개도 가능하다.
- 구동사, 연어, 관용구, 문형은 가급적 같은 덩어리에 둔다. 예: make it to + 장소 / on time / only to + 동사.
- 한 덩어리는 보통 2~7단어로 간결하게 만들고 절대로 10단어를 넘기지 않는다. 긴 문장은 주어부·동사구·전치사구·절의 자연스러운 경계에서 나눈다.
- 쉼표, 세미콜론, 콜론, 문장 끝(.?!)에서는 원칙적으로 덩어리를 끝낸다. 문장부호는 앞 덩어리 끝에 붙인다. 다만 "Oh, me too!", "Hey, Billy," 같은 4단어 이하의 짧은 감탄·호칭은 하나의 말덩어리로 둘 수 있다.
- 덩어리를 공백 하나로 연결하면 원문 영어와 글자·순서·문장부호가 정확히 같아야 한다. 단, 앞 덩어리가 em dash(—/–)로 끝나면 다음 덩어리는 공백 없이 이어진다. 단어를 고치거나 생략하거나 추가하지 않는다.
- 의미 없는 한 단어 덩어리는 피한다. 다만 Did/Do처럼 학습상 독립 비교가 필요한 조동사는 단독 덩어리가 가능하다.

orderGlosses 규칙:
- assemblyChunks와 정확히 같은 개수이며, 각 영어 덩어리의 뜻을 영어 어순 그대로 짧은 한국어 덩어리로 쓴다.
- 자연스러운 완성 번역이 아니라 영어 어순을 느끼게 하는 발판이다. 한국어 조사와 생략을 최소한 보완하되 앞뒤 뜻을 바꾸지 않는다.
- 각 덩어리 자체는 한국인이 바로 이해할 수 있게 쓴다. '~에 있었다 서두름 속에서'처럼 단어를 기계 번역한 문장은 금지한다.

corePatterns 규칙:
- 실제 회화에서 덩어리로 재사용할 가치가 큰 표현만 1~4개 뽑는다.
- 원문 표현을 중심으로 쓰고 필요한 자리에 '+ 명사', '+ 장소', '+ 동사원형', '사람 + to부정사' 같은 한국어 자리표시를 쓴다.
- 관사 하나, 대명사 하나, 너무 일반적인 전치사구만 핵심으로 뽑지 않는다.
- can't, yet처럼 한 단어만 뽑지 말고 'can't + 동사원형', 'Did + 주어 + 동사원형 + yet?'처럼 재사용 가능한 틀로 쓴다.

errorPoints 규칙:
- 한국인 학습자가 실제로 혼동할 만한 지점만 0~3개 만든다.
- 우선순위는 시제·조동사, 관사, 단수·복수, 전치사, 한국어 직역형이다.
- correct는 원문에 대소문자까지 정확히 포함된 짧은 부분 문자열이어야 한다.
- distractor는 그 부분을 대신해 고르기 쉬운 틀린 영어이며 correct와 달라야 한다.
- tip은 이 문장에서 왜 틀리는지 한국어 한 문장으로 구체적으로 설명한다.
- 억지 오류를 만들지 않는다.
- 주어·동사 수 일치를 plural 유형으로 분류하지 않는다. 허용 유형에 정확히 맞지 않으면 생략한다.

입력 배열의 모든 항목을 빠짐없이, 입력과 같은 id로 한 번씩 반환한다.

중요 예시:
입력: I barely made it to the airport on time, only to have my flight delayed.
assemblyChunks: ["I barely", "made it to the airport", "on time,", "only to have my flight delayed."]
orderGlosses: ["나는 간신히", "공항에 도착했는데", "제시간에,", "결국 비행기가 지연되는 일을 겪었다."]
corePatterns: ["make it to + 장소", "on time", "only to + 동사원형", "have + 목적어 + 과거분사"]

입력: Did you leave work yet?
assemblyChunks: ["Did", "you leave work yet?"]
orderGlosses: ["과거에 그랬어?", "너 아직 퇴근 안 했어?"]
errorPoints: [{"type":"tense_auxiliary","correct":"Did","distractor":"Do","tip":"오늘의 한 번뿐인 퇴근 여부를 묻는 과거 상황이므로 Did를 씁니다."}]

설명이나 마크다운 없이 스키마에 맞는 JSON만 반환한다.`;

function parseTsv(tsv) {
    const rows = String(tsv).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
    const headers = (rows.shift() || '').split('\t').map(value => value.trim().toUpperCase());
    const indexes = {
        day: headers.indexOf('DAY'),
        verb: headers.indexOf('VERB'),
        ko: Math.max(headers.indexOf('KO'), headers.indexOf('KOREAN')),
        en: Math.max(headers.indexOf('EN'), headers.indexOf('ENGLISH'))
    };
    if (Object.values(indexes).some(index => index < 0)) {
        throw new Error(`필수 열을 찾지 못했습니다: ${JSON.stringify(headers)}`);
    }
    return rows.map((row, index) => {
        const cols = row.split('\t');
        return {
            id: `cv-${String(index + 1).padStart(4, '0')}`,
            day: Number.parseInt(cols[indexes.day], 10) || 0,
            verb: String(cols[indexes.verb] || '').trim(),
            naturalKo: String(cols[indexes.ko] || '').trim(),
            english: String(cols[indexes.en] || '').trim()
        };
    }).filter(item => item.english && item.naturalKo);
}

async function loadSourceRows() {
    const localPath = path.join(DATA_DIR, 'source-sentences.tsv');
    if (existsSync(localPath)) return parseTsv(await readFile(localPath, 'utf8'));
    const response = await fetch(SHEET_URL);
    if (!response.ok) throw new Error(`원문 시트 요청 실패: ${response.status}`);
    const tsv = await response.text();
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(localPath, tsv, 'utf8');
    return parseTsv(tsv);
}

function choosePilotRows(rows, count) {
    const exact = [
        'Did you leave work yet?',
        "I can't. I'm on my way to the post office.",
        'I barely made it to the airport on time, only to have my flight delayed.'
    ];
    const chosen = exact.map(sentence => rows.find(row => row.english === sentence)).filter(Boolean);
    const tests = [
        row => /\b(a|an|the)\b/i.test(row.english),
        row => /\b(any|some|many|these|those)\s+\w+s\b/i.test(row.english),
        row => /[,;:]/.test(row.english),
        row => /[.!?].+[A-Z]/.test(row.english),
        row => row.english.split(/\s+/).length >= 14,
        row => /\b(to|for|at|in|on|with|from)\b/i.test(row.english),
        row => /^(Do|Does|Did|Can|Could|Would|Have|Has|Are|Is)\b/.test(row.english)
    ];
    tests.forEach(test => {
        const found = rows.find(row => test(row) && !chosen.some(item => item.id === row.id));
        if (found) chosen.push(found);
    });
    for (const row of rows) {
        if (chosen.length >= count) break;
        if (!chosen.some(item => item.id === row.id)) chosen.push(row);
    }
    return chosen.slice(0, count);
}

function inputForModel(rows) {
    return rows.map(({ id, day, verb, naturalKo, english }) => ({ id, day, verb, naturalKo, english }));
}

async function askModel(rows, repairContext = '') {
    const userContent = repairContext
        ? `${repairContext}\n\n아래 입력 전체를 규칙에 맞게 다시 반환하세요.\n${JSON.stringify(inputForModel(rows))}`
        : JSON.stringify(inputForModel(rows));
    const startedAt = Date.now();
    const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            model,
            stream: false,
            think: false,
            format: OUTPUT_SCHEMA,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userContent }
            ],
            options: { temperature: 0.15, top_p: 0.9, seed: 20260819 }
        })
    });
    if (!response.ok) throw new Error(`Ollama 요청 실패: ${response.status} ${await response.text()}`);
    const payload = await response.json();
    const parsed = JSON.parse(payload.message?.content || '{}');
    process.stdout.write(`AI ${rows.length}문장: ${((Date.now() - startedAt) / 1000).toFixed(1)}초\n`);
    const sourcesById = new Map(rows.map(row => [row.id, row]));
    return (parsed.items || []).map(item => normalizeGeneratedItem(sourcesById.get(item.id), item));
}

function normalizeGeneratedItem(source, item) {
    if (!source || !item || !Array.isArray(item.assemblyChunks)) return item;
    const normalized = structuredClone(item);
    const chunks = normalized.assemblyChunks;
    const glosses = Array.isArray(normalized.orderGlosses) ? normalized.orderGlosses : [];

    for (let index = chunks.length - 1; index > 0; index--) {
        if (!/^[.!?]$/.test(chunks[index])) continue;
        const punctuation = chunks[index];
        if (chunks[index - 1].endsWith(punctuation)) {
            chunks.splice(index, 1);
            if (glosses.length > index) glosses.splice(index, 1);
        } else if (source.english.includes(`${chunks[index - 1]}${punctuation}`)) {
            chunks[index - 1] += punctuation;
            chunks.splice(index, 1);
            if (glosses.length > index) glosses.splice(index, 1);
        }
    }
    return normalized;
}

function joinEnglishChunks(chunks) {
    return (chunks || []).reduce((sentence, chunk, index) => {
        if (index === 0) return chunk;
        return `${sentence}${/[—–]$/.test(sentence) ? '' : ' '}${chunk}`;
    }, '');
}

function validateItem(source, generated) {
    const errors = [];
    if (!generated || generated.id !== source.id) errors.push('id 불일치');
    const chunks = generated?.assemblyChunks;
    const glosses = generated?.orderGlosses;
    const sourceWordCount = source.english.split(/\s+/).filter(Boolean).length;
    const minimumChunkCount = sourceWordCount <= 6 ? 1 : 2;
    if (!Array.isArray(chunks) || chunks.length < minimumChunkCount || chunks.length > 6) {
        errors.push(`assemblyChunks는 ${minimumChunkCount}~6개여야 함`);
    } else {
        if (joinEnglishChunks(chunks) !== source.english) errors.push('청크 연결 결과가 영어 원문과 다름');
        chunks.forEach((chunk, index) => {
            if (!chunk || chunk.trim() !== chunk || /\s{2,}/.test(chunk)) errors.push(`${index + 1}번 청크 공백 오류`);
            const wordCount = chunk.split(/\s+/).filter(Boolean).length;
            if (wordCount > 10) errors.push(`${index + 1}번 청크가 10단어를 넘음`);
            const shortDiscourseChunk = wordCount <= 4 && /^(oh|hey|hi|hello|yes|no|yeah|well|okay|ok|please|sorry|thanks|thank you|good morning|good afternoon|good evening),/i.test(chunk);
            const shortParentheticalChunk = (wordCount <= 6 && /,\s+(though|however),["']?$/i.test(chunk))
                || (wordCount <= 8 && /,\s+(though|however)[.!?]["']?$/i.test(chunk));
            const crossesCommaClause = /,\s+(but|so|because|only|although|though|while|when|if|which|who)\b/i.test(chunk);
            const crossesHardPunctuation = /;(?!["']?$)/.test(chunk) || /:(?!\d|["']?$)/.test(chunk);
            if (crossesHardPunctuation || (crossesCommaClause && !shortDiscourseChunk && !shortParentheticalChunk)) {
                errors.push(`${index + 1}번 청크가 문장부호 경계를 넘음`);
            }
            if (/[!?]["']?\s+\S|\.["']?\s+[A-Z]/.test(chunk)) errors.push(`${index + 1}번 청크가 문장 끝 경계를 넘음`);
        });
    }
    if (!Array.isArray(glosses) || glosses.length !== chunks?.length || glosses.some(value => !String(value || '').trim())) {
        errors.push('orderGlosses가 영어 청크와 1:1로 대응하지 않음');
    }
    if (!Array.isArray(generated?.corePatterns) || generated.corePatterns.length < 1 || generated.corePatterns.length > 4) {
        errors.push('corePatterns는 1~4개여야 함');
    } else if (sourceWordCount > 4 && generated.corePatterns.every(pattern => !/[\s+/?]/.test(String(pattern || '').trim()))) {
        errors.push('corePatterns 전체가 한 단어이므로 최소 하나는 재사용 가능한 문형으로 바꿔야 함');
    } else if (generated.corePatterns.some(pattern => /오늘|내일|어제/.test(String(pattern || '')))) {
        errors.push('corePattern의 특정 날짜 표현은 + 시간 같은 재사용 가능한 자리표시로 바꿔야 함');
    }
    if (!Array.isArray(generated?.errorPoints) || generated.errorPoints.length > 3) {
        errors.push('errorPoints는 0~3개여야 함');
    } else {
        generated.errorPoints.forEach((point, index) => {
            if (!ERROR_TYPES.includes(point.type)) errors.push(`${index + 1}번 오류 유형이 잘못됨`);
            if (!point.correct || !source.english.includes(point.correct)) errors.push(`${index + 1}번 correct가 원문에 없음`);
            if (point.correct && Array.isArray(chunks) && !chunks.some(chunk => chunk.includes(point.correct))) {
                errors.push(`${index + 1}번 correct가 한 청크 안에 들어 있지 않음`);
            }
            if (!point.distractor || point.distractor === point.correct) errors.push(`${index + 1}번 distractor가 잘못됨`);
            if (!point.tip) errors.push(`${index + 1}번 tip이 비어 있음`);
            const normalizedCorrect = String(point.correct || '').toLowerCase().replace(/[’‘]/g, "'");
            if (point.type === 'article' && !/\b(a|an|the)\b/.test(normalizedCorrect)) {
                errors.push(`${index + 1}번 article 오류에 관사가 없음`);
            }
            if (point.type === 'plural' && !/\b(any|some|many|several|few|these|those|two|three|four|five|six|seven|eight|nine|ten)\b|\b[a-z]+s\b/.test(normalizedCorrect)) {
                errors.push(`${index + 1}번 plural 오류에 복수 단서가 없음`);
            }
            if (point.type === 'preposition' && !/\b(about|at|by|for|from|in|into|of|on|to|with|without)\b/.test(normalizedCorrect)) {
                errors.push(`${index + 1}번 preposition 오류에 전치사가 없음`);
            }
            if (point.type === 'tense_auxiliary' && !/\b(am|is|are|was|were|be|been|being|do|does|did|have|has|had|can|could|will|would|should|may|might|must)(?:n't|'ve|'d|'ll|'re|'s)?\b/.test(normalizedCorrect)) {
                errors.push(`${index + 1}번 tense_auxiliary 오류에 시제·조동사 단서가 없음`);
            }
        });
    }
    return errors;
}

async function generateBatch(rows) {
    let generated = await askModel(rows);
    for (let attempt = 1; attempt <= 4; attempt++) {
        const byId = new Map(generated.map(item => [item.id, item]));
        const failures = rows.map(source => ({ source, errors: validateItem(source, byId.get(source.id)) })).filter(item => item.errors.length);
        if (!failures.length) return generated;
        const summary = failures.map(item => `${item.source.id}: ${item.errors.join(', ')}`).join('\n');
        process.stdout.write(`재생성 ${attempt}/4: ${failures.length}문장\n${summary}\n`);
        const repaired = await askModel(failures.map(item => item.source), `직전 결과에 다음 검증 오류가 있었습니다.\n${summary}`);
        const repairedById = new Map(repaired.map(item => [item.id, item]));
        generated = rows.map(source => repairedById.get(source.id) || byId.get(source.id)).filter(Boolean);
    }

    const finalById = new Map(generated.map(item => [item.id, item]));
    for (const source of rows) {
        let item = finalById.get(source.id);
        for (let attempt = 1; attempt <= 4 && validateItem(source, item).length; attempt++) {
            const errors = validateItem(source, item);
            process.stdout.write(`개별 교정 ${source.id} ${attempt}/4: ${errors.join(', ')}\n`);
            const repaired = await askModel([source], `이 한 문장의 오류만 정확히 고치세요.\n${errors.join('\n')}`);
            item = repaired.find(candidate => candidate.id === source.id) || item;
        }
        if (item) finalById.set(source.id, item);
    }
    return rows.map(source => finalById.get(source.id)).filter(Boolean);
}

async function writeJsonAtomic(target, value) {
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporary, target);
}

function assembleContent(rows, generatedById) {
    return {
        schemaVersion: 1,
        source: 'Core Verbs 50-day sentence set',
        generatorModel: model,
        reviewStatus: 'ai_draft',
        total: rows.length,
        items: rows.map(source => {
            const reviewed = REVIEWED_OVERRIDES.get(source.english);
            return {
                ...source,
                ...generatedById.get(source.id),
                ...reviewed,
                reviewStatus: reviewed ? 'reviewed' : 'ai_draft'
            };
        })
    };
}

function validateContent(content) {
    const ids = new Set();
    const failures = [];
    content.items.forEach(item => {
        if (ids.has(item.id)) failures.push(`${item.id}: 중복 id`);
        ids.add(item.id);
        const errors = validateItem(item, item);
        if (errors.length) failures.push(`${item.id}: ${errors.join(', ')}`);
    });
    if (content.total !== content.items.length) failures.push(`total 불일치: ${content.total}/${content.items.length}`);
    return failures;
}

async function runPilot(rows) {
    const selected = choosePilotRows(rows, pilotCount);
    const generated = await generateBatch(selected);
    const byId = new Map(generated.map(item => [item.id, item]));
    const content = assembleContent(selected, byId);
    const failures = validateContent(content);
    await writeJsonAtomic(PILOT_PATH, content);
    process.stdout.write(`대표 문장 ${content.items.length}개 저장: ${path.relative(ROOT, PILOT_PATH)}\n`);
    if (failures.length) throw new Error(`대표 문장 검증 실패\n${failures.join('\n')}`);
}

async function runGenerate(rows) {
    let cache = { model, items: [] };
    if (existsSync(CACHE_PATH)) cache = JSON.parse(await readFile(CACHE_PATH, 'utf8'));
    const sourcesById = new Map(rows.map(row => [row.id, row]));
    const normalizedCached = (cache.items || []).map(item => {
        const source = sourcesById.get(item.id);
        const reviewed = source && REVIEWED_OVERRIDES.get(source.english);
        return normalizeGeneratedItem(source, reviewed ? { ...item, ...reviewed } : item);
    });
    const validCached = normalizedCached.filter(item => {
        const source = sourcesById.get(item.id);
        return source && validateItem(source, item).length === 0;
    });
    const invalidCachedCount = normalizedCached.length - validCached.length;
    const generatedById = new Map(validCached.map(item => [item.id, item]));
    rows.forEach(source => {
        const reviewed = REVIEWED_OVERRIDES.get(source.english);
        if (reviewed) generatedById.set(source.id, { id: source.id, ...reviewed });
    });
    const pending = rows.filter(row => !generatedById.has(row.id));
    process.stdout.write(`전체 ${rows.length}문장, 검증된 기존 ${generatedById.size}문장, 재생성 ${invalidCachedCount}문장, 생성 대기 ${pending.length}문장\n`);

    for (let index = 0; index < pending.length; index += batchSize) {
        const batch = pending.slice(index, index + batchSize);
        const generated = await generateBatch(batch);
        generated.forEach(item => generatedById.set(item.id, item));
        cache = { model, items: [...generatedById.values()] };
        await writeJsonAtomic(CACHE_PATH, cache);
        process.stdout.write(`진행 ${Math.min(index + batch.length, pending.length)}/${pending.length} (전체 ${generatedById.size}/${rows.length})\n`);
    }

    const content = assembleContent(rows, generatedById);
    const failures = validateContent(content);
    if (failures.length) throw new Error(`전체 자료 검증 실패 ${failures.length}건\n${failures.slice(0, 30).join('\n')}`);
    await writeJsonAtomic(OUTPUT_PATH, content);
    process.stdout.write(`완료: ${content.items.length}문장 저장, 자동 검사 통과\n`);
}

async function runValidate() {
    const content = JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
    const failures = validateContent(content);
    if (failures.length) throw new Error(`검증 실패 ${failures.length}건\n${failures.join('\n')}`);
    process.stdout.write(`검증 통과: ${content.items.length}문장\n`);
}

const rows = mode === 'validate' ? [] : await loadSourceRows();
if (mode === 'pilot') await runPilot(rows);
else if (mode === 'generate') await runGenerate(rows);
else if (mode === 'validate') await runValidate();
else throw new Error(`지원하지 않는 mode: ${mode}`);

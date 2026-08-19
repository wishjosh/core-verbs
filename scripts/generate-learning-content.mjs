import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUTPUT_PATH = path.join(DATA_DIR, 'learning-content.json');
const CACHE_PATH = path.join(DATA_DIR, '.learning-content-cache.json');
const PILOT_PATH = path.join(DATA_DIR, 'learning-content-pilot.json');
const MEANING_FLOW_OVERRIDES_PATH = path.join(DATA_DIR, 'meaning-flow-overrides.json');
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSR1wby3k5QhlAL8f8MeH-Ni1qjGgRMu8ROHDoPCKci-GYrbpx1DzTsAvcr_l5qBcemui93D4cqMLa0/pub?output=tsv';
const OLLAMA_URL = 'http://127.0.0.1:11434/api/chat';
const CHUNK_RULES_VERSION = 2;
const MEANING_FLOW_RULES_VERSION = 1;
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
    ['She is currently with a client right now. May I take a message?', {
        assemblyChunks: ['She', 'is currently', 'with a client', 'right now.', 'May I take', 'a message?'],
        orderGlosses: ['그녀는', '현재 ~있어요', '의뢰인과 함께', '지금.', '제가 받아 둘까요?', '메시지를?'],
        corePatterns: ['be with + 사람', 'right now', 'May I + 동사원형?', 'take a message'],
        errorPoints: [{
            type: 'article',
            correct: 'a client',
            distractor: 'client',
            tip: '처음 언급하는 한 명의 의뢰인이므로 a client라고 합니다.'
        }, {
            type: 'article',
            correct: 'a message',
            distractor: 'message',
            tip: '전해 둘 하나의 메시지를 뜻하므로 a message라고 합니다.'
        }]
    }],
    ['Yeah, a couple of Korean families live in my apartment building and we have barbeques every Friday.', {
        assemblyChunks: ['Yeah,', 'a couple of Korean families', 'live', 'in my apartment building', 'and we have barbeques', 'every Friday.'],
        orderGlosses: ['응,', '두어 한국인 가족들이', '살아요', '내 아파트 건물에', '그리고 우리는 바비큐를 해요', '매주 금요일마다.'],
        corePatterns: ['a couple of + 복수명사', 'live in + 장소', 'have barbeques', 'every + 요일'],
        errorPoints: []
    }],
    ['I see. So I should try to have lunch with people from other departments.', {
        assemblyChunks: ['I see.', 'So I should', 'try to have lunch', 'with people', 'from other departments.'],
        orderGlosses: ['그렇군요.', '그러니 나는 해야겠네요', '점심을 먹어 보기를', '사람들과', '다른 부서의.'],
        corePatterns: ['try to + 동사원형', 'have lunch with + 사람', 'people from + 부서'],
        errorPoints: []
    }],
    ['Yeah, that works better.', {
        assemblyChunks: ['Yeah,', 'that works better.'],
        orderGlosses: ['응,', '그게 더 나아요.'],
        corePatterns: ['work better'],
        errorPoints: []
    }],
    ['I was thinking of quitting every week. I’m so glad I kept studying, and that I made it to the end of the semester.', {
        assemblyChunks: ['I was thinking', 'of quitting', 'every week.', 'I’m so glad', 'I kept studying,', 'and that', 'I made it to', 'the end of the semester.'],
        orderGlosses: ['나는 생각하고 있었어요', '포기하는 것을', '매주.', '나는 정말 기뻐요', '내가 계속 공부했고,', '그리고 ~라는 것이', '내가 도달했다는', '그 학기 말까지.'],
        corePatterns: ['think of + 동명사', 'be glad + 문장', 'make it to + 시간/장소'],
        errorPoints: []
    }],
    ['I barely made it to the airport on time, only to have my flight delayed.', {
        assemblyChunks: ['I barely', 'made it to', 'the airport', 'on time,', 'only to', 'have my flight delayed.'],
        orderGlosses: ['나는 간신히', '도착했다', '그 공항에', '제시간에,', '결국 ~하게 됐다', '내 비행기가 지연되는 일을.'],
        corePatterns: ['make it to + 장소', 'on time', 'only to + 동사원형', 'have + 목적어 + 과거분사'],
        errorPoints: [{
            type: 'article',
            correct: 'the airport',
            distractor: 'airport',
            tip: '이동 목적지로 특정 공항을 가리킬 때는 보통 the airport라고 합니다.'
        }]
    }],
    ['Yeah, and the second place has parking, but it’s next to a busy street.', {
        assemblyChunks: ['Yeah,', 'and the second place', 'has parking,', 'but it’s', 'next to', 'a busy street.'],
        orderGlosses: ['그래,', '그리고 두 번째 곳은', '주차장이 있어,', '하지만 그곳은', '바로 옆이야', '붐비는 거리의.'],
        corePatterns: ['have parking', 'be next to + 장소', 'a busy + 명사'],
        errorPoints: [{
            type: 'article',
            correct: 'a busy street',
            distractor: 'busy street',
            tip: '처음 언급하는 셀 수 있는 단수 장소이므로 a busy street라고 합니다.'
        }]
    }],
    ['Hello, may I speak with Yuna Kim?', {
        assemblyChunks: ['Hello,', 'may I', 'speak with Yuna Kim?'],
        orderGlosses: ['안녕하세요,', '제가 해도 될까요?', '김유나 님과 통화하는 것을?'],
        corePatterns: ['May I speak with + 사람?', 'speak with + 사람'],
        errorPoints: []
    }],
    ['I’m moving to the U.S. I got a job there.', {
        assemblyChunks: ['I’m moving', 'to the U.S.', 'I got', 'a job there.'],
        orderGlosses: ['나는 이주해.', '미국으로.', '나는 얻었어', '일자리를 거기서.'],
        corePatterns: ['move to + 장소', 'get a job'],
        errorPoints: [{
            type: 'article',
            correct: 'the U.S.',
            distractor: 'U.S.',
            tip: '국가명 U.S. 앞에는 정관사 the를 붙여 the U.S.라고 합니다.'
        }]
    }],
    ['That’s good, but you should keep in mind that it gets a bit noisy at night with all the bars nearby.', {
        assemblyChunks: ['That’s good,', 'but you should', 'keep in mind', 'that it gets', 'a bit noisy', 'at night', 'with all the bars nearby.'],
        orderGlosses: ['그건 좋지만,', '하지만 당신은 해야 해요', '염두에 두기를', '그곳이 된다는 것을', '조금 시끄럽게', '밤에는', '근처의 모든 술집 때문에.'],
        corePatterns: ['keep in mind that + 문장', 'get a bit + 형용사', 'at night', 'with + 명사'],
        errorPoints: [{
            type: 'preposition',
            correct: 'at night',
            distractor: 'in night',
            tip: '밤이라는 시간대를 일반적으로 말할 때는 at night를 씁니다.'
        }]
    }],
    ['I know, but I don’t want to make a big deal out of it.', {
        assemblyChunks: ['I know,', 'but I don’t', 'want to', 'make a big deal', 'out of it.'],
        orderGlosses: ['알아,', '하지만 나는 하지 않아', '원하기를', '큰일로 만들기를', '그것을 두고.'],
        corePatterns: ['don’t want to + 동사원형', 'make a big deal out of + 명사'],
        errorPoints: [{
            type: 'article',
            correct: 'a big deal',
            distractor: 'big deal',
            tip: '하나의 큰 문제나 사건이라는 뜻의 셀 수 있는 단수 표현이라 a big deal이라고 합니다.'
        }]
    }],
    ['True, but the battery life makes it a better choice for me.', {
        assemblyChunks: ['True,', 'but the battery life', 'makes it', 'a better choice', 'for me.'],
        orderGlosses: ['맞아,', '하지만 배터리 수명이', '그걸 만들어', '더 나은 선택으로', '나에게.'],
        corePatterns: ['make + 목적어 + 보어', 'a better choice for + 사람', 'battery life'],
        errorPoints: [{
            type: 'article',
            correct: 'a better choice',
            distractor: 'better choice',
            tip: '여러 선택지 가운데 하나의 더 나은 선택을 뜻하므로 a better choice라고 합니다.'
        }]
    }],
    ['Back when we were kids, my brother made me clean his room—for ten years!', {
        assemblyChunks: ['Back when', 'we were kids,', 'my brother', 'made me clean', 'his room—', 'for ten years!'],
        orderGlosses: ['예전에 ~했을 때', '우리가 아이들이었을 때,', '우리 형은', '나에게 청소를 시켰어', '자기 방을—', '무려 10년 동안이나!'],
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
        assemblyChunks: ['Right,', 'but they’re taking', 'the move', 'better than me.', 'They already have', 'new friends.'],
        orderGlosses: ['맞아요,', '하지만 아이들은 받아들이고 있어요', '그 이사를', '나보다 더 잘.', '아이들은 벌써 있어요', '새 친구들이.'],
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
        assemblyChunks: ['We can meet', 'in Gangnam or Yongsan—', 'wherever works best', 'for you.'],
        orderGlosses: ['우리는 만날 수 있어', '강남이나 용산에서—', '어디든 가장 편한 곳이면', '너에게.'],
        corePatterns: ['meet in + 장소', 'wherever works best for + 사람'],
        errorPoints: [{
            type: 'preposition',
            correct: 'in Gangnam or Yongsan',
            distractor: 'at Gangnam or Yongsan',
            tip: '도시나 넓은 지역 안에서 만난다고 할 때는 in을 씁니다.'
        }]
    }],
    ['Life doesn’t really work that way. Things change, but they don’t get easier.', {
        assemblyChunks: ['Life doesn’t really', 'work that way.', 'Things change,', 'but they don’t', 'get easier.'],
        orderGlosses: ['삶은 실제로는 그렇지 않아', '그런 식으로 흘러가지.', '상황은 변하지만,', '하지만 그것들이 그렇지는 않아', '더 쉬워지지는.'],
        corePatterns: ['work that way', 'get + 비교급'],
        errorPoints: []
    }],
    ['I have tons of work to do.', {
        assemblyChunks: ['I have', 'tons of work', 'to do.'],
        orderGlosses: ['나는 있어', '아주 많은 일이', '해야 할.'],
        corePatterns: ['have tons of + 명사', 'work to do'],
        errorPoints: []
    }],
    ['I hate doing my taxes. I can’t believe it’s May already.', {
        assemblyChunks: ['I hate', 'doing my taxes.', 'I can’t believe', 'it’s May already.'],
        orderGlosses: ['나는 싫어해', '내 세금 신고하는 것을.', '나는 믿을 수 없어', '벌써 5월이라는 것을.'],
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
        assemblyChunks: ['Yes,', 'we’re sorry about that,', 'but we don’t', 'take reservations', 'for those tables.'],
        orderGlosses: ['네,', '그 점은 죄송하지만,', '하지만 저희는 하지 않아요', '예약을 받기를', '그 테이블들은.'],
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
        assemblyChunks: ['Yeah,', 'but he likes', 'to spend', 'most of the session', 'talking about politics,', 'and I can’t', 'stand it anymore.'],
        orderGlosses: ['응,', '하지만 그는 좋아해', '보내기를', '수업 시간 대부분을', '정치 이야기를 하면서,', '그래서 나는 할 수 없어', '그걸 더는 참을 수.'],
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

const GLOSS_SCHEMA = {
    type: 'object',
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    orderGlosses: { type: 'array', items: { type: 'string' } }
                },
                required: ['id', 'orderGlosses']
            }
        }
    },
    required: ['items']
};

const QUALITY_REVIEW_SCHEMA = {
    type: 'object',
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    assemblyChunks: { type: 'array', items: { type: 'string' } },
                    orderGlosses: { type: 'array', items: { type: 'string' } }
                },
                required: ['id', 'assemblyChunks', 'orderGlosses']
            }
        }
    },
    required: ['items']
};

const SYSTEM_PROMPT = `당신은 한국인 성인 학습자를 위한 미국 영어 코퍼스 편집자다.
입력된 각 문장의 암기용 자료를 JSON으로 만든다.

assemblyChunks 규칙:
- 원어민이 한 번에 처리하고 말하는 의미·문법·운율 단위로 나눈다. 문장이 길면 10개까지 만들 수 있으며, 기계적으로 같은 길이로 자르지 않는다.
- 한 덩어리는 보통 1~4단어이며, 자연스러운 결합 표현에 필요한 경우에만 5단어까지 허용한다. 주어, 조동사 틀, 동사구, 목적어, 전치사구, 시간·장소 부사구가 눈에 보이도록 짧게 나눈다.
- 구동사, 연어, 관용구는 5단어 안에서 가급적 같은 덩어리에 둔다. 영어 어순을 더 잘 드러내기 위해 경계를 가로지르면 corePatterns에는 전체 재사용 문형을 보존한다. 예: make it to / the airport, May I take / a message, make a big deal / out of it.
- 쉼표, 세미콜론, 콜론, 문장 끝(.?!)에서는 원칙적으로 덩어리를 끝낸다. 문장부호는 앞 덩어리 끝에 붙인다. 다만 "Oh, me too!", "Hey, Billy," 같은 4단어 이하의 짧은 감탄·호칭은 하나의 말덩어리로 둘 수 있다.
- 덩어리를 공백 하나로 연결하면 원문 영어와 글자·순서·문장부호가 정확히 같아야 한다. 단, 앞 덩어리가 em dash(—/–)로 끝나면 다음 덩어리는 공백 없이 이어진다. 단어를 고치거나 생략하거나 추가하지 않는다.
- 의미 없는 한 단어 남발은 피한다. 다만 주어·조동사·담화표지처럼 영어 어순이나 오류 확인에 중요한 단어는 단독 덩어리가 가능하다.

orderGlosses 규칙:
- assemblyChunks와 정확히 같은 개수이며, 영어가 앞에서부터 새로 펼치는 의미나 문법 기능을 짧은 한국어 단서로 쓴다.
- 자연스러운 완성 번역을 잘라 놓거나 한국어 문장을 거꾸로 뒤집지 않는다. 각 단서를 순서대로 읽으면 의미가 계속 누적되어야 한다.
- 조동사처럼 한국어로 따로 옮기기 어려운 청크는 '(과거 질문으로 시작)'처럼 기능을 알려도 된다.
- '나는 하지 않아 / 원하기를'처럼 단어를 기계적으로 대응한 문장과, 뒤 단서를 먼저 읽어야 이해되는 문장은 금지한다.
- 자연스러운 완성 뜻은 입력의 naturalKo에 따로 있으므로 그대로 복제하지 않는다.

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
assemblyChunks: ["I barely", "made it to", "the airport", "on time,", "only to", "have my flight delayed."]
orderGlosses: ["나는 가까스로", "도착했어요", "공항에", "제시간에,", "그런데 결국", "내 항공편이 지연됐죠."]
corePatterns: ["make it to + 장소", "on time", "only to + 동사원형", "have + 목적어 + 과거분사"]

입력: Did you leave work yet?
assemblyChunks: ["Did", "you leave work yet?"]
orderGlosses: ["(과거 질문으로 시작)", "너는 벌써 퇴근했어?"]
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

function stableSeed(text) {
    let hash = 0;
    for (const character of String(text || '')) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
    return 20260819 + (hash % 100000);
}

function chunkQualityReasons(item) {
    const chunks = Array.isArray(item?.assemblyChunks) ? item.assemblyChunks : [];
    const glosses = Array.isArray(item?.orderGlosses) ? item.orderGlosses : [];
    const determiners = new Set(['a', 'an', 'the', 'my', 'your', 'his', 'our', 'their', 'this', 'these', 'those']);
    const connectors = new Set(['and', 'but', 'or']);
    const prepositions = new Set(['to', 'at', 'in', 'on', 'for', 'with', 'from', 'by', 'of', 'about', 'after', 'before', 'into', 'over', 'under', 'through', 'without']);
    const reasons = [];

    chunks.slice(0, -1).forEach((chunk, index) => {
        const words = String(chunk || '').toLowerCase().replace(/[^a-z'\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
        const last = words.at(-1);
        if (determiners.has(last)) reasons.push(`${index + 1}번 청크가 한정사 ${last}에서 끝남`);
        if (connectors.has(last) && !/^(yeah|yes|no|well|okay|ok|right)\s+(and|but|or)$/i.test(words.join(' '))) {
            reasons.push(`${index + 1}번 청크가 연결어 ${last}에서 끝남`);
        }
        if (words.length === 1 && prepositions.has(words[0])) reasons.push(`${index + 1}번 청크가 전치사 하나뿐임`);
        if (/^(yeah|yes|no|well|okay|ok|right|honestly|actually|sorry),\s+\S/i.test(chunk) && !/[.!?]["']?$/.test(chunk)) {
            reasons.push(`${index + 1}번 청크가 담화표지와 뒤 구를 어색하게 합침`);
        }
    });
    glosses.forEach((gloss, index) => {
        const value = String(gloss || '').trim();
        if (/^(뜻 확인|이어서|확인 필요|번역 필요)$/.test(value)) reasons.push(`${index + 1}번 어순 한국어가 임시 문구임`);
        if (/살아있다\s+내|사람들로부터/.test(value)) reasons.push(`${index + 1}번 어순 한국어의 의미가 문맥과 어긋날 가능성이 큼`);
    });
    return reasons;
}

async function askQualityReview(items, repairContext = '') {
    const input = items.map(item => ({
        id: item.id,
        naturalKo: item.naturalKo,
        english: item.english,
        assemblyChunks: item.assemblyChunks,
        orderGlosses: item.orderGlosses,
        reviewReasons: chunkQualityReasons(item)
    }));
    const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            model,
            stream: false,
            think: false,
            keep_alive: '30m',
            format: QUALITY_REVIEW_SCHEMA,
            messages: [{
                role: 'system',
                content: `당신은 한국인 학습자를 위한 미국 영어 청크의 최종 교정자다.
각 영어 원문은 절대로 고치지 말고 assemblyChunks만 다시 나눈다. 청크를 공백 하나로 연결하면 원문과 글자·문장부호가 정확히 같아야 한다.
청크는 원어민이 처리하는 짧은 의미·문법·운율 단위로 보통 1~4단어, 자연스러운 결합 표현만 최대 5단어다.
관사·소유한정사는 뒤 명사와, 전치사는 가능하면 목적어와, and/but/or는 뒤 병렬 요소나 절과 묶는다. 담화표지 뒤 쉼표는 경계로 삼는다. 구동사와 고정 표현은 최대한 보존한다.
orderGlosses는 영어 청크와 정확히 1:1이며, 영어가 앞에서부터 펼치는 의미나 문법 기능을 짧고 이해 가능한 한국어로 쓴다. 한국어를 거꾸로 뒤집거나 단어를 기계적으로 대응하지 말고, 순서대로 읽을 때 의미가 계속 누적되게 한다. 직역 때문에 뜻이 바뀌면 안 되며 임시 문구를 쓰지 않는다.
입력의 reviewReasons를 모두 해소하고 모든 입력 id를 한 번씩 반환한다. JSON만 반환한다.`
            }, {
                role: 'user',
                content: `${repairContext ? `${repairContext}\n\n` : ''}${JSON.stringify(input)}`
            }],
            options: {
                temperature: 0.1,
                top_p: 0.9,
                seed: stableSeed(`quality:${repairContext}:${JSON.stringify(input)}`),
                num_ctx: 32768,
                num_predict: 8000
            }
        })
    });
    if (!response.ok) throw new Error(`청크 품질 검토 실패: ${response.status} ${await response.text()}`);
    const payload = await response.json();
    const parsed = JSON.parse(payload.message?.content || '{}');
    return parsed.items || [];
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
            keep_alive: '30m',
            format: OUTPUT_SCHEMA,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userContent }
            ],
            options: {
                temperature: 0.2,
                top_p: 0.9,
                seed: stableSeed(userContent),
                num_ctx: 32768,
                num_predict: 12000
            }
        })
    });
    if (!response.ok) throw new Error(`Ollama 요청 실패: ${response.status} ${await response.text()}`);
    const payload = await response.json();
    const parsed = JSON.parse(payload.message?.content || '{}');
    process.stdout.write(`AI ${rows.length}문장: ${((Date.now() - startedAt) / 1000).toFixed(1)}초\n`);
    const sourcesById = new Map(rows.map(row => [row.id, row]));
    const normalized = (parsed.items || []).map(item => normalizeGeneratedItem(sourcesById.get(item.id), item));
    return repairOverlongChunks(rows, normalized);
}

function splitGlossFallback(gloss, count) {
    const words = String(gloss || '').trim().split(/\s+/).filter(Boolean);
    if (count <= 1) return [String(gloss || '').trim() || '뜻 확인'];
    if (words.length < count) {
        return Array.from({ length: count }, (_, index) => index === 0 ? (String(gloss || '').trim() || '뜻 확인') : '이어서');
    }

    const result = [];
    let cursor = 0;
    for (let index = 0; index < count; index++) {
        const remainingWords = words.length - cursor;
        const remainingGroups = count - index;
        const size = Math.ceil(remainingWords / remainingGroups);
        result.push(words.slice(cursor, cursor + size).join(' '));
        cursor += size;
    }
    return result;
}

function chooseChunkCut(words, remainingGroups) {
    const maximumCut = Math.min(5, words.length - (remainingGroups - 1));
    const minimumCut = Math.max(1, words.length - ((remainingGroups - 1) * 5));
    const target = Math.round(words.length / remainingGroups);
    const strongStarts = new Set(['and', 'but', 'or', 'because', 'if', 'when', 'while', 'although', 'though', 'that', 'what', 'which', 'who', 'where', 'only']);
    const phraseStarts = new Set(['to', 'at', 'in', 'on', 'for', 'with', 'from', 'by', 'of', 'about', 'after', 'before', 'into', 'over', 'under', 'a', 'an', 'the', 'my', 'your', 'his', 'her', 'our', 'their', 'this', 'that', 'these', 'those']);
    let best = minimumCut;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let cut = minimumCut; cut <= maximumCut; cut++) {
        const next = String(words[cut] || '').toLowerCase().replace(/[^a-z']/g, '');
        const previous = String(words[cut - 1] || '');
        let score = -Math.abs(cut - target) * 2;
        if (strongStarts.has(next)) score += 9;
        else if (phraseStarts.has(next)) score += 5;
        if (/[,:;.!?]["']?$/.test(previous)) score += 10;
        if (cut >= 2 && cut <= 4) score += 2;
        if (score > bestScore) {
            best = cut;
            bestScore = score;
        }
    }
    return best;
}

function splitLongChunk(chunk, maximumWords = 5) {
    const words = String(chunk || '').trim().split(/\s+/).filter(Boolean);
    if (words.length <= maximumWords) return [String(chunk || '').trim()];
    const groupCount = Math.ceil(words.length / maximumWords);
    const result = [];
    let remaining = [...words];

    for (let group = groupCount; group > 1; group--) {
        const cut = chooseChunkCut(remaining, group);
        result.push(remaining.slice(0, cut).join(' '));
        remaining = remaining.slice(cut);
    }
    result.push(remaining.join(' '));
    return result;
}

function splitMandatoryBoundaries(chunk) {
    const words = String(chunk || '').trim().split(/\s+/).filter(Boolean);
    const commaStarters = new Set(['but', 'so', 'because', 'only', 'although', 'though', 'while', 'when', 'if', 'which', 'who']);
    const parts = [];
    let start = 0;

    for (let index = 1; index < words.length; index++) {
        const previous = words[index - 1];
        const next = String(words[index] || '').toLowerCase().replace(/[^a-z']/g, '');
        const sentenceEnded = /[.!?]["']?$/.test(previous);
        const hardBoundary = /[;:]["']?$/.test(previous);
        const commaClause = /,["']?$/.test(previous) && commaStarters.has(next);
        if (sentenceEnded || hardBoundary || commaClause) {
            parts.push(words.slice(start, index).join(' '));
            start = index;
        }
    }
    parts.push(words.slice(start).join(' '));
    return parts.filter(Boolean);
}

function enforceChunkLimit(source, item) {
    if (!source || !item || !Array.isArray(item.assemblyChunks)) return { item, changed: false };
    const fixed = structuredClone(item);
    const chunks = [];
    const glosses = [];
    let changed = false;

    fixed.assemblyChunks.forEach((chunk, index) => {
        const boundaryChunks = splitMandatoryBoundaries(chunk);
        const splitChunks = boundaryChunks.flatMap(part => splitLongChunk(part, 5));
        const splitGlosses = splitGlossFallback(fixed.orderGlosses?.[index], splitChunks.length);
        if (splitChunks.length > 1) changed = true;
        chunks.push(...splitChunks);
        glosses.push(...splitGlosses);
    });

    fixed.assemblyChunks = chunks;
    fixed.orderGlosses = glosses;
    if (!Array.isArray(item.orderGlosses) || item.orderGlosses.length !== item.assemblyChunks.length) changed = true;
    if (joinEnglishChunks(chunks) !== source.english) return { item, changed: false };
    return { item: fixed, changed };
}

async function askFixedGlosses(rows, items) {
    if (!items.length) return new Map();
    const sourcesById = new Map(rows.map(row => [row.id, row]));
    const input = items.map(item => ({
        id: item.id,
        naturalKo: sourcesById.get(item.id)?.naturalKo || '',
        english: sourcesById.get(item.id)?.english || '',
        assemblyChunks: item.assemblyChunks
    }));
    const userContent = JSON.stringify(input);
    const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            model,
            stream: false,
            think: false,
            keep_alive: '30m',
            format: GLOSS_SCHEMA,
            messages: [{
                role: 'system',
                content: '고정된 영어 청크마다 영어가 앞에서부터 펼치는 의미나 문법 기능을 한국어 단서로 1개씩 쓴다. 영어 청크를 바꾸거나 합치지 않는다. 자연스러운 한국어를 잘라 놓거나 거꾸로 뒤집지 말고, 단서를 순서대로 읽으면 의미가 계속 누적되게 한다. orderGlosses 개수는 assemblyChunks 개수와 반드시 같아야 한다. JSON만 반환한다.'
            }, {
                role: 'user',
                content: userContent
            }],
            options: {
                temperature: 0.1,
                top_p: 0.9,
                seed: stableSeed(`gloss:${userContent}`),
                num_ctx: 32768,
                num_predict: 6000
            }
        })
    });
    if (!response.ok) throw new Error(`한국어 어순 재작성 실패: ${response.status} ${await response.text()}`);
    const payload = await response.json();
    const parsed = JSON.parse(payload.message?.content || '{}');
    return new Map((parsed.items || []).map(item => [item.id, item.orderGlosses]));
}

async function repairOverlongChunks(rows, items) {
    const sourcesById = new Map(rows.map(row => [row.id, row]));
    const fixedItems = items.map(item => enforceChunkLimit(sourcesById.get(item.id), item));
    const changedItems = fixedItems.filter(result => result.changed).map(result => result.item);
    if (!changedItems.length) return fixedItems.map(result => result.item);

    try {
        const glossesById = await askFixedGlosses(rows, changedItems);
        changedItems.forEach(item => {
            const glosses = glossesById.get(item.id);
            if (Array.isArray(glosses) && glosses.length === item.assemblyChunks.length && glosses.every(Boolean)) {
                item.orderGlosses = glosses.map(value => String(value).trim());
            }
        });
        process.stdout.write(`긴 청크 자동 분할·의미 전개 단서 ${changedItems.length}문장\n`);
    } catch (error) {
        process.stdout.write(`긴 청크 의미 전개 단서는 임시 분할값 사용: ${error.message}\n`);
    }
    return fixedItems.map(result => result.item);
}

function normalizeGeneratedItem(source, item) {
    if (!source || !item || !Array.isArray(item.assemblyChunks)) return item;
    const normalized = structuredClone(item);
    const chunks = normalized.assemblyChunks;
    const glosses = Array.isArray(normalized.orderGlosses) ? normalized.orderGlosses : [];
    const patterns = Array.isArray(normalized.corePatterns)
        ? normalized.corePatterns.map(value => String(value || '').trim()).filter(value => value && !/오늘|내일|어제/.test(value))
        : [];
    normalized.corePatterns = [...new Set(patterns)].slice(0, 4);
    if (!normalized.corePatterns.length) {
        const reusableChunk = chunks.find(chunk => chunk.split(/\s+/).filter(Boolean).length >= 2)
            || chunks.slice(0, 2).join(' ')
            || source.verb.toLowerCase();
        normalized.corePatterns = [String(reusableChunk).replace(/[,.!?;:—–]+$/g, '').trim()];
    }
    const sourceWordCount = source.english.split(/\s+/).filter(Boolean).length;
    if (sourceWordCount > 4 && normalized.corePatterns.every(pattern => !/[\s+/?]/.test(pattern))) {
        const reusableChunk = chunks.find(chunk => chunk.split(/\s+/).filter(Boolean).length >= 2)
            || chunks.slice(0, 2).join(' ');
        if (reusableChunk) normalized.corePatterns.unshift(String(reusableChunk).replace(/[,.!?;:—–]+$/g, '').trim());
        normalized.corePatterns = [...new Set(normalized.corePatterns)].slice(0, 4);
    }

    if (Array.isArray(normalized.errorPoints)) {
        normalized.errorPoints = normalized.errorPoints.filter(point => {
            if (!point || !ERROR_TYPES.includes(point.type)) return false;
            if (!point.correct || !source.english.includes(point.correct)) return false;
            if (!point.distractor || point.distractor === point.correct || !point.tip) return false;
            const correct = String(point.correct).toLowerCase().replace(/[’‘]/g, "'");
            if (point.type === 'article' && !/\b(a|an|the)\b/.test(correct)) return false;
            if (point.type === 'plural' && !/\b(any|some|many|several|few|these|those|two|three|four|five|six|seven|eight|nine|ten)\b|\b[a-z]+s\b/.test(correct)) return false;
            if (point.type === 'preposition' && !/\b(about|at|by|for|from|in|into|of|on|to|with|without)\b/.test(correct)) return false;
            if (point.type === 'tense_auxiliary' && !/\b(am|is|are|was|were|be|been|being|do|does|did|have|has|had|can|could|will|would|should|may|might|must)(?:n't|'ve|'d|'ll|'re|'s)?\b/.test(correct)) return false;
            return true;
        }).slice(0, 3);
    } else {
        normalized.errorPoints = [];
    }

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
    if (!Array.isArray(chunks) || chunks.length < minimumChunkCount || chunks.length > 10) {
        errors.push(`assemblyChunks는 ${minimumChunkCount}~10개여야 함`);
    } else {
        if (joinEnglishChunks(chunks) !== source.english) errors.push('청크 연결 결과가 영어 원문과 다름');
        chunks.forEach((chunk, index) => {
            if (!chunk || chunk.trim() !== chunk || /\s{2,}/.test(chunk)) errors.push(`${index + 1}번 청크 공백 오류`);
            const wordCount = chunk.split(/\s+/).filter(Boolean).length;
            if (wordCount > 5) errors.push(`${index + 1}번 청크가 5단어를 넘음`);
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
    } else if (glosses.some(value => /^(뜻 확인|이어서|확인 필요|번역 필요)$/.test(String(value).trim()))) {
        errors.push('orderGlosses에 임시 문구가 남아 있음');
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
        const repaired = await askModel(failures.map(item => item.source), `교정 시도 ${attempt}. 직전 결과에 다음 검증 오류가 있었습니다.\n${summary}`);
        const repairedById = new Map(repaired.map(item => [item.id, item]));
        generated = rows.map(source => repairedById.get(source.id) || byId.get(source.id)).filter(Boolean);
    }

    const finalById = new Map(generated.map(item => [item.id, item]));
    for (const source of rows) {
        let item = finalById.get(source.id);
        for (let attempt = 1; attempt <= 4 && validateItem(source, item).length; attempt++) {
            const errors = validateItem(source, item);
            process.stdout.write(`개별 교정 ${source.id} ${attempt}/4: ${errors.join(', ')}\n`);
            const repaired = await askModel([source], `개별 교정 시도 ${attempt}. 이 한 문장의 오류만 정확히 고치세요.\n${errors.join('\n')}`);
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

async function readMeaningFlowOverrides() {
    const document = JSON.parse(await readFile(MEANING_FLOW_OVERRIDES_PATH, 'utf8'));
    const failures = [];
    const ids = new Set();

    if (document.rulesVersion !== MEANING_FLOW_RULES_VERSION) {
        failures.push(`의미 전개 규칙 버전 불일치: ${document.rulesVersion}/${MEANING_FLOW_RULES_VERSION}`);
    }
    if (!Array.isArray(document.items) || document.items.length !== 30) {
        failures.push(`의미 전개 파일럿은 정확히 30문장이어야 함: ${document.items?.length || 0}`);
    }

    for (const item of document.items || []) {
        if (!item?.id || ids.has(item.id)) failures.push(`${item?.id || 'id 없음'}: id 누락 또는 중복`);
        ids.add(item?.id);
        if (!item?.english) failures.push(`${item?.id}: 영어 원문 누락`);
        if (!Array.isArray(item?.assemblyChunks) || !item.assemblyChunks.length) {
            failures.push(`${item?.id}: 영어 청크 누락`);
        }
        if (!Array.isArray(item?.orderGlosses) || item.orderGlosses.length !== item.assemblyChunks?.length) {
            failures.push(`${item?.id}: 의미 전개 단서가 영어 청크와 1:1이 아님`);
        } else if (item.orderGlosses.some(value => !String(value || '').trim() || /^(뜻 확인|이어서|확인 필요|번역 필요)$/.test(String(value).trim()))) {
            failures.push(`${item?.id}: 비어 있거나 임시 의미 전개 단서가 있음`);
        }
    }

    if (failures.length) throw new Error(`의미 전개 편집 원본 검증 실패\n${failures.join('\n')}`);
    return document;
}

async function applyMeaningFlowOverrides(content) {
    const document = await readMeaningFlowOverrides();
    const contentById = new Map(content.items.map(item => [item.id, item]));
    const failures = [];
    let applied = 0;

    for (const override of document.items) {
        const item = contentById.get(override.id);
        if (!item) {
            failures.push(`${override.id}: 전체 자료에서 문장을 찾을 수 없음`);
            continue;
        }
        if (item.english !== override.english) {
            failures.push(`${override.id}: 영어 원문이 편집 원본과 다름`);
            continue;
        }
        if (JSON.stringify(item.assemblyChunks) !== JSON.stringify(override.assemblyChunks)) {
            failures.push(`${override.id}: 영어 청크가 편집 원본과 다름`);
            continue;
        }

        item.orderGlosses = override.orderGlosses.map(value => String(value).trim());
        item.meaningFlow = {
            rulesVersion: document.rulesVersion,
            reviewStatus: document.reviewStatus || 'reviewed'
        };
        applied += 1;
    }

    if (failures.length) throw new Error(`의미 전개 병합 실패\n${failures.join('\n')}`);
    content.meaningFlowRulesVersion = document.rulesVersion;
    content.meaningFlowReviewCount = applied;
    return content;
}

function assembleContent(rows, generatedById) {
    return {
        schemaVersion: 1,
        chunkRulesVersion: CHUNK_RULES_VERSION,
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
        if (item.meaningFlow) {
            if (item.meaningFlow.rulesVersion !== content.meaningFlowRulesVersion) {
                failures.push(`${item.id}: 의미 전개 규칙 버전 불일치`);
            }
            if (item.meaningFlow.reviewStatus !== 'reviewed') {
                failures.push(`${item.id}: 의미 전개 검수 상태가 reviewed가 아님`);
            }
        }
    });
    if (content.total !== content.items.length) failures.push(`total 불일치: ${content.total}/${content.items.length}`);
    const meaningFlowCount = content.items.filter(item => item.meaningFlow).length;
    if (content.meaningFlowRulesVersion !== undefined && content.meaningFlowRulesVersion !== MEANING_FLOW_RULES_VERSION) {
        failures.push(`전체 의미 전개 규칙 버전 불일치: ${content.meaningFlowRulesVersion}/${MEANING_FLOW_RULES_VERSION}`);
    }
    if (content.meaningFlowReviewCount !== undefined && content.meaningFlowReviewCount !== meaningFlowCount) {
        failures.push(`의미 전개 검수 문장 수 불일치: ${content.meaningFlowReviewCount}/${meaningFlowCount}`);
    }
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
    let cache = { model, chunkRulesVersion: CHUNK_RULES_VERSION, items: [] };
    if (existsSync(CACHE_PATH)) cache = JSON.parse(await readFile(CACHE_PATH, 'utf8'));
    if (cache.model !== model || cache.chunkRulesVersion !== CHUNK_RULES_VERSION) {
        cache = { model, chunkRulesVersion: CHUNK_RULES_VERSION, items: [] };
    }
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
        cache = { model, chunkRulesVersion: CHUNK_RULES_VERSION, items: [...generatedById.values()] };
        await writeJsonAtomic(CACHE_PATH, cache);
        process.stdout.write(`진행 ${Math.min(index + batch.length, pending.length)}/${pending.length} (전체 ${generatedById.size}/${rows.length})\n`);
    }

    const content = await applyMeaningFlowOverrides(assembleContent(rows, generatedById));
    const failures = validateContent(content);
    if (failures.length) throw new Error(`전체 자료 검증 실패 ${failures.length}건\n${failures.slice(0, 30).join('\n')}`);
    await writeJsonAtomic(OUTPUT_PATH, content);
    process.stdout.write(`완료: ${content.items.length}문장 저장, 자동 검사 통과\n`);
}

async function runQualityReview() {
    const content = JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
    const candidates = content.items.filter(item => item.reviewStatus !== 'reviewed' && chunkQualityReasons(item).length > 0);
    const reviewedById = new Map();
    process.stdout.write(`청크 품질 2차 검토 대상: ${candidates.length}문장\n`);

    for (let index = 0; index < candidates.length; index += batchSize) {
        const batch = candidates.slice(index, index + batchSize);
        let accepted = null;
        let failureSummary = '';

        for (let attempt = 1; attempt <= 3 && !accepted; attempt++) {
            const returned = await askQualityReview(batch, failureSummary && `직전 결과의 문제를 모두 고치세요.\n${failureSummary}`);
            const returnedById = new Map(returned.map(item => [item.id, item]));
            const failures = [];
            const merged = batch.map(source => {
                const candidate = returnedById.get(source.id);
                if (!candidate) {
                    failures.push(`${source.id}: 결과 누락`);
                    return source;
                }
                const next = {
                    ...source,
                    assemblyChunks: candidate.assemblyChunks,
                    orderGlosses: candidate.orderGlosses
                };
                const errors = [...validateItem(source, next), ...chunkQualityReasons(next)];
                if (errors.length) failures.push(`${source.id}: ${errors.join(', ')}`);
                return next;
            });
            if (!failures.length && returnedById.size === batch.length) accepted = merged;
            else failureSummary = failures.join('\n');
        }

        if (!accepted) throw new Error(`청크 품질 2차 검토 실패\n${failureSummary}`);
        accepted.forEach(item => reviewedById.set(item.id, item));
        process.stdout.write(`청크 품질 진행 ${Math.min(index + batch.length, candidates.length)}/${candidates.length}\n`);
    }

    content.items = content.items.map(item => reviewedById.get(item.id) || item);
    content.qualityReviewModel = model;
    await applyMeaningFlowOverrides(content);
    const failures = validateContent(content);
    if (failures.length) throw new Error(`2차 검토 후 전체 자료 검증 실패\n${failures.join('\n')}`);
    await writeJsonAtomic(OUTPUT_PATH, content);
    process.stdout.write(`청크 품질 2차 검토 완료: ${reviewedById.size}문장 교정\n`);
}

async function runValidate() {
    const content = JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
    const failures = validateContent(content);
    if (failures.length) throw new Error(`검증 실패 ${failures.length}건\n${failures.join('\n')}`);
    process.stdout.write(`검증 통과: ${content.items.length}문장\n`);
}

async function runApplyMeaningFlow() {
    const content = JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
    await applyMeaningFlowOverrides(content);
    const failures = validateContent(content);
    if (failures.length) throw new Error(`의미 전개 병합 후 검증 실패\n${failures.join('\n')}`);
    await writeJsonAtomic(OUTPUT_PATH, content);
    process.stdout.write(`의미 전개 파일럿 적용 완료: ${content.meaningFlowReviewCount}문장\n`);
}

const rows = ['pilot', 'generate'].includes(mode) ? await loadSourceRows() : [];
if (mode === 'pilot') await runPilot(rows);
else if (mode === 'generate') await runGenerate(rows);
else if (mode === 'quality') await runQualityReview();
else if (mode === 'apply-meaning-flow') await runApplyMeaningFlow();
else if (mode === 'validate') await runValidate();
else throw new Error(`지원하지 않는 mode: ${mode}`);

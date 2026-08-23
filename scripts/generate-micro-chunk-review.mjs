import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_PATH = path.join(ROOT, 'data', 'learning-content.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'micro-chunk-overrides.json');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/chat';
const MODEL = process.env.MICRO_MODEL || 'gemma4:31b';
const BATCH_SIZE = Math.max(1, Number(process.env.MICRO_BATCH_SIZE) || 25);
const LIMIT = Math.max(0, Number(process.env.MICRO_LIMIT) || 0);
const RESET = process.env.MICRO_RESET === '1';

const schema = {
  type: 'object',
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'microChunks', 'microOrderGlosses'],
        properties: {
          id: { type: 'string' },
          microChunks: { type: 'array', items: { type: 'string' } },
          microOrderGlosses: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

const systemPrompt = `당신은 한국인 성인 초급 학습자를 위한 영어 어순 발판을 직접 교정하는 편집자다.
입력의 영어 원문, 숙련 청크(assemblyChunks), 그 청크의 한국어 의미 단서(orderGlosses)를 보고 첫 노출용 microChunks와 microOrderGlosses를 만든다.

목표는 처음에는 최대한 작고 분명한 의미 발판으로 영어가 앞에서부터 펼쳐지는 순서를 보게 하고, 다음 학습 단계에서 숙련 청크로 다시 합치는 것이다.

규칙:
1. 영어 원문의 문자·대소문자·구두점을 절대 바꾸거나 추가·삭제하지 않는다. microChunks를 순서대로 공백 하나로 이으면 원문이 정확히 복원되어야 한다. 단, 앞 청크가 em dash(— 또는 –)로 끝나면 공백 없이 잇는다.
2. 기존 assemblyChunks의 경계를 모두 유지하고 그 안을 더 나눌 수만 있다. 서로 다른 숙련 청크를 합치지 않는다.
3. 이 단계는 원어민 숙련 청크가 아니라 초급자의 첫 조립 발판이다. 긴 절은 주어/태도 단위, 핵심 서술, 목적어·보어, 시간·장소·이유·조건 등의 의미 확장 순서가 보이게 적극적으로 나눈다. 담화 표지와 독립 절도 나눈다.
4. 보통 한 청크는 1~3단어이고 4단어가 자연스러우면 허용한다. 짧은 조건절처럼 하나로 읽히는 경우에는 5단어도 허용하지만, 6단어 이상은 더 나눈다. 의미 없는 관사·전치사 하나만 남기지는 않는다.
5. 관사·소유격·수량사와 명사, 고유명사, 구동사, 고정 연어, 짧은 의문문 틀, 비교 표현은 학습 의미가 사라지면 쪼개지 않는다.
6. you should, we might, I think처럼 화자·태도 단위가 선명하면 하나로 둔다. 단순 평서문의 주어와 서술부가 길면 주어를 별도 발판으로 둘 수 있다.
7. 한국어 단서는 영어 청크와 반드시 1:1이다. 완성 문장을 억지로 만들 필요는 없지만, 각 칩만 보아도 다음 영어 의미를 떠올릴 수 있게 자연스럽고 간결하게 쓴다. 영어에 없는 원인·강조·정보를 새로 넣지 않는다.
8. 자연스러운 뜻(naturalKo)은 전체 의미 확인용이다. 한국어 단서는 자연스러운 뜻을 참고하되 영어 어순을 따른다.
9. 기존 숙련 청크를 더 나누지 않았다면 그 청크의 orderGlosses 문구를 글자 하나도 바꾸지 말고 그대로 복사한다. 더 나눈 경우에만 해당 한국어 의미를 새 경계에 맞게 재배치한다.
10. have를 무조건 ‘가지고 있다’, take를 무조건 ‘취하다’처럼 옮기지 않는다. 문맥에 맞게 ‘있다/키우다/먹다/받아들이다/걸리다’처럼 실제 한국어 의미를 쓴다.

예시:
영어: He takes YouTube comments so personally.
microChunks: ["He", "takes YouTube comments", "so personally."]
microOrderGlosses: ["그는", "유튜브 댓글을 받아들여", "너무 개인적인 공격으로."]

영어: My boyfriend got a ticket to the concert.
microChunks: ["My boyfriend", "got a ticket", "to the concert."]
microOrderGlosses: ["내 남자 친구가", "표를 구했어요", "그 콘서트 표를."]

영어: I have some chores to do in the afternoon.
microChunks: ["I have", "some chores", "to do", "in the afternoon."]
microOrderGlosses: ["내게 있어요", "할 일이 몇 가지", "해야 할", "오후에."]

영어: We’re fully booked today, but we might be able to take a few walk-ins.
microChunks: ["We’re fully booked", "today,", "but", "we might", "be able to take", "a few walk-ins."]
microOrderGlosses: ["예약이 모두 찼습니다", "오늘은,", "그래도", "저희가 아마", "받을 수 있을 겁니다", "예약 없이 온 손님 몇 분을."]

영어: Still, you should get him to pay for the damages!
microChunks: ["Still,", "you should", "get him to pay", "for the damages!"]
microOrderGlosses: ["그래도,", "넌 꼭", "그 사람이 물어내게 해야 해", "손해를!"]

입력된 모든 id를 한 번씩, 같은 순서로 반환한다. JSON 외의 설명은 쓰지 않는다.`;

function joinChunks(chunks) {
  return chunks.reduce((sentence, chunk, index) => (
    index === 0 ? chunk : `${sentence}${/[—–]$/.test(sentence) ? '' : ' '}${chunk}`
  ), '');
}

function validate(source, result) {
  const errors = [];
  if (!result || result.id !== source.id) errors.push('id 불일치');
  if (!Array.isArray(result?.microChunks) || result.microChunks.length < 1) errors.push('첫 단계 청크가 없음');
  if (joinChunks(result?.microChunks || []) !== source.english) errors.push('영어 원문 복원 실패');
  if (!Array.isArray(result?.microOrderGlosses) || result.microOrderGlosses.length !== result?.microChunks?.length) {
    errors.push('한국어 1:1 대응 실패');
  }
  if ((result?.microOrderGlosses || []).some(value => !String(value || '').trim())) errors.push('빈 한국어 단서');
  const resultBoundaries = [];
  let resultOffset = 0;
  for (const chunk of result?.microChunks || []) {
    resultOffset += chunk.length;
    resultBoundaries.push(resultOffset);
    if (resultOffset < source.english.length && !/[—–]$/.test(chunk)) resultOffset += 1;
  }
  for (const plan of [source.assemblyChunks]) {
    let cursor = 0;
    for (const base of plan || []) {
      cursor += base.length;
      if (cursor < source.english.length && !resultBoundaries.includes(cursor)) errors.push('기존 청크 경계 유실');
      if (cursor < source.english.length && !/[—–]$/.test(base)) cursor += 1;
    }
  }
  return errors;
}

function preserveReviewedGlosses(source, result) {
  const glosses = [...result.microOrderGlosses];
  let microIndex = 0;
  for (let baseIndex = 0; baseIndex < source.assemblyChunks.length; baseIndex += 1) {
    const base = source.assemblyChunks[baseIndex];
    const start = microIndex;
    const collected = [];
    while (microIndex < result.microChunks.length) {
      collected.push(result.microChunks[microIndex]);
      microIndex += 1;
      const rebuilt = joinChunks(collected);
      if (rebuilt === base) break;
      if (!base.startsWith(rebuilt)) break;
    }
    if (collected.length === 1 && collected[0] === base) glosses[start] = source.orderGlosses[baseIndex];
  }
  return { ...result, microOrderGlosses: glosses };
}

async function ask(batch, repair = '') {
  const payload = batch.map(item => ({
    id: item.id,
    english: item.english,
    naturalKo: item.naturalKo,
    assemblyChunks: item.assemblyChunks,
    orderGlosses: item.orderGlosses,
  }));
  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      think: false,
      keep_alive: '30m',
      format: schema,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${repair}\n${JSON.stringify(payload)}` },
      ],
      options: { temperature: 0.1, top_p: 0.9, num_ctx: 32768, num_predict: 10000 },
    }),
  });
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  const body = await response.json();
  return JSON.parse(body.message?.content || '{}').items || [];
}

const content = JSON.parse(await readFile(CONTENT_PATH, 'utf8'));
const sourceItems = LIMIT ? content.items.slice(0, LIMIT) : content.items;
let saved = { schemaVersion: 1, reviewMethod: 'theory_guided_micro_review', items: [] };
if (!RESET) {
  try {
    saved = JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
  } catch {}
}
const accepted = new Map((saved.items || []).map(item => [item.id, item]));

for (let start = 0; start < sourceItems.length; start += BATCH_SIZE) {
  const batch = sourceItems.slice(start, start + BATCH_SIZE).filter(item => !accepted.has(item.id));
  if (!batch.length) continue;
  let pending = batch;
  for (let attempt = 1; attempt <= 3 && pending.length; attempt += 1) {
    const generated = await ask(pending, attempt === 1 ? '' : '직전 결과의 누락·원문 복원·경계 오류를 고쳐 다시 반환하세요.');
    const byId = new Map(generated.map(item => [item.id, item]));
    const next = [];
    for (const source of pending) {
      let result = byId.get(source.id);
      const stored = {
        id: source.id,
        microChunks: source.microChunks,
        microOrderGlosses: source.microOrderGlosses,
      };
      const storedErrors = validate(source, stored);
      const generatedErrors = validate(source, result);
      if (storedErrors.length === 0 && (
        (stored.microChunks?.length || 0) > (result?.microChunks?.length || 0)
        || generatedErrors.length > 0
      )) {
        result = stored;
      }
      const errors = validate(source, result);
      if (errors.length) {
        if (attempt === 3) process.stderr.write(`${source.id}: ${errors.join(', ')}\n${JSON.stringify(result)}\n`);
        next.push(source);
      }
      else accepted.set(source.id, preserveReviewedGlosses(source, result));
    }
    pending = next;
  }
  if (pending.length) throw new Error(`미해결: ${pending.map(item => item.id).join(', ')}`);
  const ordered = sourceItems.map(item => accepted.get(item.id)).filter(Boolean);
  await writeFile(OUTPUT_PATH, `${JSON.stringify({
    schemaVersion: 1,
    reviewStatus: ordered.length === sourceItems.length ? 'draft_complete' : 'draft_in_progress',
    reviewMethod: 'theory_guided_micro_review',
    model: MODEL,
    reviewCount: ordered.length,
    items: ordered,
  }, null, 2)}\n`, 'utf8');
  process.stdout.write(`${ordered.length}/${sourceItems.length} micro 청크 초안 저장\n`);
}

import { createHash } from 'node:crypto';
import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CONTENT_PATH = path.join(DATA_DIR, 'learning-content.json');
const REVIEWED_PATH = path.join(DATA_DIR, 'meaning-flow-overrides.json');
const BATCH_DIR = path.join(DATA_DIR, 'meaning-flow-batches');
const RULES_VERSION = 1;
const PLACEHOLDER = /^(뜻 확인|이어서|확인 필요|번역 필요|TBD)$/i;
const validateOnly = process.argv.includes('--validate-only');

function sourceFingerprint(items) {
    return createHash('sha256').update(JSON.stringify(items.map(item => ({
        id: item.id,
        english: item.english,
        assemblyChunks: item.assemblyChunks
    })))).digest('hex');
}

function validateFlow(source, candidate, label) {
    const failures = [];
    if (!source) return [`${label}: 원본 ID를 찾을 수 없음`];
    if (candidate.english !== source.english) failures.push(`${label}: 영어 원문 불일치`);
    if (JSON.stringify(candidate.assemblyChunks) !== JSON.stringify(source.assemblyChunks)) {
        failures.push(`${label}: 영어 청크 불일치`);
    }
    if (!Array.isArray(candidate.orderGlosses) || candidate.orderGlosses.length !== source.assemblyChunks.length) {
        failures.push(`${label}: 의미 단서와 영어 청크가 1:1이 아님`);
    } else {
        candidate.orderGlosses.forEach((gloss, index) => {
            const value = typeof gloss === 'string' ? gloss.trim() : '';
            if (!value) failures.push(`${label}: ${index + 1}번 의미 단서가 비어 있음`);
            if (value !== gloss) failures.push(`${label}: ${index + 1}번 의미 단서 앞뒤 공백 오류`);
            if (PLACEHOLDER.test(value)) failures.push(`${label}: ${index + 1}번 의미 단서가 임시 문구임`);
        });
    }
    return failures;
}

async function writeJsonAtomic(target, value) {
    const temporary = `${target}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporary, target);
}

async function main() {
    const content = JSON.parse(await readFile(CONTENT_PATH, 'utf8'));
    const reviewed = JSON.parse(await readFile(REVIEWED_PATH, 'utf8'));
    if (reviewed.rulesVersion !== RULES_VERSION || reviewed.reviewStatus !== 'reviewed') {
        throw new Error('사람 검수 meaning-flow 원본의 버전 또는 상태가 잘못되었습니다.');
    }

    const beforeFingerprint = sourceFingerprint(content.items);
    const sourceById = new Map(content.items.map(item => [item.id, item]));
    const reviewedIds = new Set(reviewed.items.map(item => item.id));
    const expectedIds = new Set(content.items.filter(item => !reviewedIds.has(item.id)).map(item => item.id));
    const files = (await readdir(BATCH_DIR))
        .filter(file => /^part-\d{4}-\d{4}\.json$/.test(file))
        .sort();
    if (!files.length) throw new Error('적용할 meaning-flow 배치 파일이 없습니다.');

    const checkedById = new Map();
    const failures = [];
    for (const file of files) {
        const document = JSON.parse(await readFile(path.join(BATCH_DIR, file), 'utf8'));
        if (document.rulesVersion !== RULES_VERSION) failures.push(`${file}: rulesVersion 불일치`);
        if (document.reviewStatus !== 'ai_checked') failures.push(`${file}: reviewStatus가 ai_checked가 아님`);
        if (!Array.isArray(document.items)) {
            failures.push(`${file}: items 배열 누락`);
            continue;
        }
        for (const candidate of document.items) {
            const label = `${file}/${candidate?.id || '(id 없음)'}`;
            if (reviewedIds.has(candidate?.id)) {
                failures.push(`${label}: 사람 검수 문장을 AI 배치가 덮으려 함`);
                continue;
            }
            if (checkedById.has(candidate?.id)) {
                failures.push(`${label}: ID 중복`);
                continue;
            }
            failures.push(...validateFlow(sourceById.get(candidate?.id), candidate, label));
            checkedById.set(candidate.id, candidate);
        }
    }

    const missing = [...expectedIds].filter(id => !checkedById.has(id));
    const unexpected = [...checkedById.keys()].filter(id => !expectedIds.has(id));
    if (missing.length) failures.push(`AI 교차검수 누락 ${missing.length}개: ${missing.slice(0, 30).join(', ')}`);
    if (unexpected.length) failures.push(`AI 교차검수 범위 밖 ${unexpected.length}개: ${unexpected.slice(0, 30).join(', ')}`);
    if (failures.length) throw new Error(`meaning-flow 배치 검증 실패 ${failures.length}건\n${failures.join('\n')}`);

    for (const [id, candidate] of checkedById) {
        const item = sourceById.get(id);
        item.orderGlosses = [...candidate.orderGlosses];
        item.meaningFlow = {
            rulesVersion: RULES_VERSION,
            reviewStatus: 'ai_checked',
            reviewMethod: 'multi_agent_direct'
        };
    }

    for (const candidate of reviewed.items) {
        const item = sourceById.get(candidate.id);
        const itemFailures = validateFlow(item, candidate, `reviewed/${candidate.id}`);
        if (itemFailures.length) throw new Error(itemFailures.join('\n'));
        item.orderGlosses = [...candidate.orderGlosses];
        item.meaningFlow = {
            rulesVersion: RULES_VERSION,
            reviewStatus: 'reviewed'
        };
    }

    content.meaningFlowRulesVersion = RULES_VERSION;
    content.meaningFlowReviewCount = reviewedIds.size;
    content.meaningFlowAiCheckedCount = checkedById.size;
    content.meaningFlowDraftCount = 0;
    content.meaningFlowTotal = reviewedIds.size + checkedById.size;
    content.meaningFlowModel = 'multi_agent_direct';

    if (content.meaningFlowTotal !== content.items.length) {
        throw new Error(`meaning-flow 전체 수 불일치: ${content.meaningFlowTotal}/${content.items.length}`);
    }
    if (sourceFingerprint(content.items) !== beforeFingerprint) {
        throw new Error('meaning-flow 적용 중 영어 원문 또는 영어 청크가 변경되었습니다.');
    }

    if (!validateOnly) await writeJsonAtomic(CONTENT_PATH, content);
    process.stdout.write(
        `meaning-flow 배치 ${files.length}개 검증 통과: 사람 검수 ${reviewedIds.size}, `
        + `AI 교차검수 ${checkedById.size}, 영어 원문·청크 불변${validateOnly ? ' (검증 전용)' : ''}\n`
    );
}

await main();

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('./learning-engine.js');

const contentPath = path.join(__dirname, 'data', 'learning-content.json');
const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
const makeChunkOverridesPath = path.join(__dirname, 'data', 'make-chunk-overrides.json');
const makeChunkOverrides = JSON.parse(fs.readFileSync(makeChunkOverridesPath, 'utf8'));
const meaningFlowOverridesPath = path.join(__dirname, 'data', 'meaning-flow-overrides.json');
const meaningFlowOverrides = JSON.parse(fs.readFileSync(meaningFlowOverridesPath, 'utf8'));
const meaningFlowBatchDir = path.join(__dirname, 'data', 'meaning-flow-batches');
const meaningFlowBatches = fs.readdirSync(meaningFlowBatchDir)
    .filter(file => /^part-\d{4}-\d{4}\.json$/.test(file))
    .sort()
    .map(file => JSON.parse(fs.readFileSync(path.join(meaningFlowBatchDir, file), 'utf8')));
const generatorSource = fs.readFileSync(path.join(__dirname, 'scripts', 'generate-learning-content.mjs'), 'utf8');
const joinChunks = chunks => chunks.reduce((sentence, chunk, index) => (
    index === 0 ? chunk : `${sentence}${/[—–]$/.test(sentence) ? '' : ' '}${chunk}`
), '');

function obviousDraftChunkIssues(item) {
    const determiners = new Set(['a', 'an', 'the', 'my', 'your', 'his', 'our', 'their', 'this', 'these', 'those']);
    const connectors = new Set(['and', 'but', 'or']);
    const prepositions = new Set(['to', 'at', 'in', 'on', 'for', 'with', 'from', 'by', 'of', 'about', 'after', 'before', 'into', 'over', 'under', 'through', 'without']);
    const issues = [];
    item.assemblyChunks.slice(0, -1).forEach((chunk, index) => {
        const words = chunk.toLowerCase().replace(/[^a-z'\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
        const last = words.at(-1);
        if (determiners.has(last)) issues.push(`${index + 1}: determiner`);
        if (connectors.has(last) && !/^(yeah|yes|no|well|okay|ok|right)\s+(and|but|or)$/i.test(words.join(' '))) {
            issues.push(`${index + 1}: connector`);
        }
        if (words.length === 1 && prepositions.has(words[0])) issues.push(`${index + 1}: lone preposition`);
        if (/^(yeah|yes|no|well|okay|ok|right|honestly|actually|sorry),\s+\S/i.test(chunk) && !/[.!?]["']?$/.test(chunk)) {
            issues.push(`${index + 1}: discourse boundary`);
        }
    });
    return issues;
}

test('stores the complete 50-day, 869-sentence learning set', () => {
    assert.equal(content.schemaVersion, 1);
    assert.equal(content.chunkRulesVersion, 2);
    assert.equal(content.total, 869);
    assert.equal(content.items.length, 869);
    assert.equal(new Set(content.items.map(item => item.id)).size, 869);
    assert.equal(Math.max(...content.items.map(item => item.day)), 50);
});

test('stores directly reviewed two-level chunk progression for all 100 MAKE-unit sentences', () => {
    assert.equal(makeChunkOverrides.schemaVersion, 1);
    assert.equal(makeChunkOverrides.verb, 'MAKE');
    assert.equal(makeChunkOverrides.reviewStatus, 'reviewed');
    assert.equal(makeChunkOverrides.reviewMethod, 'codex_direct');
    assert.equal(makeChunkOverrides.reviewCount, 100);
    assert.equal(makeChunkOverrides.items.length, 100);
    assert.equal(new Set(makeChunkOverrides.items.map(item => item.id)).size, 100);

    const makeItems = content.items.filter(item => item.verb === 'MAKE');
    const makeIds = new Set(makeItems.map(item => item.id));
    assert.equal(makeItems.length, 100);

    for (const override of makeChunkOverrides.items) {
        const source = content.items.find(item => item.id === override.id);
        assert.ok(source, override.id);
        assert.ok(makeIds.has(override.id), override.id);
        assert.equal(joinChunks(override.microChunks), source.english, `${override.id} micro`);
        assert.equal(joinChunks(override.assemblyChunks), source.english, `${override.id} phrase`);
        assert.equal(override.microChunks.length, override.microOrderGlosses.length, override.id);
        assert.equal(override.assemblyChunks.length, override.orderGlosses.length, override.id);
        assert.ok(override.microChunks.length > override.assemblyChunks.length, override.id);
        assert.ok(override.microChunks.length <= 10, override.id);
        assert.ok(override.microOrderGlosses.every(Boolean), override.id);
        assert.ok(override.orderGlosses.every(Boolean), override.id);
    }

    assert.deepEqual(new Set(makeChunkOverrides.items.map(item => item.id)), makeIds);
});

test('MAKE-unit cards use reviewed micro chunks, then reviewed phrase chunks, then recall', () => {
    const sourceById = new Map(content.items.map(item => [item.id, item]));
    for (const override of makeChunkOverrides.items) {
        const source = sourceById.get(override.id);
        const card = { ...source, ...override, en: source.english, ko: source.naturalKo };
        const micro = engine.buildAdaptiveChunkPlan(card, 0);
        const next = engine.buildAdaptiveChunkPlan(card, 1);

        assert.equal(micro.kind, 'micro', override.id);
        assert.deepEqual(micro.chunks, override.microChunks, override.id);
        assert.deepEqual(micro.orderGlosses, override.microOrderGlosses, override.id);

        if (override.assemblyChunks.length >= 2) {
            const recall = engine.buildAdaptiveChunkPlan(card, 2);
            assert.equal(next.kind, 'canonical', override.id);
            assert.deepEqual(next.chunks, override.assemblyChunks, override.id);
            assert.deepEqual(next.orderGlosses, override.orderGlosses, override.id);
            assert.equal(recall.mode, 'recall', override.id);
        } else {
            assert.equal(next.mode, 'recall', override.id);
        }
    }
});

test('stores a reviewed 30-sentence English meaning-flow pilot across all 15 verb groups', () => {
    assert.equal(content.meaningFlowRulesVersion, 1);
    assert.equal(content.meaningFlowReviewCount, 30);
    assert.equal(meaningFlowOverrides.rulesVersion, 1);
    assert.equal(meaningFlowOverrides.reviewStatus, 'reviewed');
    assert.equal(meaningFlowOverrides.items.length, 30);
    assert.equal(new Set(meaningFlowOverrides.items.map(item => item.id)).size, 30);

    const byId = new Map(content.items.map(item => [item.id, item]));
    const verbs = new Set();
    for (const override of meaningFlowOverrides.items) {
        const item = byId.get(override.id);
        assert.ok(item, override.id);
        assert.equal(item.english, override.english, override.id);
        assert.deepEqual(item.assemblyChunks, override.assemblyChunks, override.id);
        assert.deepEqual(item.orderGlosses, override.orderGlosses, override.id);
        assert.equal(item.orderGlosses.length, item.assemblyChunks.length, override.id);
        assert.ok(item.orderGlosses.every(value => value.trim()), override.id);
        assert.deepEqual(item.meaningFlow, { rulesVersion: 1, reviewStatus: 'reviewed' }, override.id);
        verbs.add(item.verb);
    }

    assert.deepEqual([...verbs].sort(), [
        'DO', 'GET', 'GIVE', 'GO', 'HAVE', 'KEEP', 'KNOW', 'LET',
        'LIKE', 'MAKE', 'SAY', 'SEE', 'TAKE', 'WANT', 'WORK'
    ]);
    for (const id of ['cv-0062', 'cv-0079', 'cv-0135', 'cv-0148', 'cv-0430']) {
        assert.ok(meaningFlowOverrides.items.some(item => item.id === id), id);
    }
});

test('stores AI-cross-checked meaning flow for every remaining sentence', () => {
    assert.equal(content.meaningFlowTotal, 869);
    assert.equal(content.meaningFlowReviewCount, 30);
    assert.equal(content.meaningFlowAiCheckedCount, 839);
    assert.equal(content.meaningFlowDraftCount, 0);
    assert.equal(meaningFlowBatches.length, 9);

    const reviewedIds = new Set(meaningFlowOverrides.items.map(item => item.id));
    const batchItems = meaningFlowBatches.flatMap(batch => {
        assert.equal(batch.rulesVersion, 1);
        assert.equal(batch.reviewStatus, 'ai_checked');
        return batch.items;
    });
    assert.equal(batchItems.length, 839);
    assert.equal(new Set(batchItems.map(item => item.id)).size, 839);

    const byId = new Map(content.items.map(item => [item.id, item]));
    for (const candidate of batchItems) {
        assert.ok(!reviewedIds.has(candidate.id), candidate.id);
        const item = byId.get(candidate.id);
        assert.equal(item.english, candidate.english, candidate.id);
        assert.deepEqual(item.assemblyChunks, candidate.assemblyChunks, candidate.id);
        assert.deepEqual(item.orderGlosses, candidate.orderGlosses, candidate.id);
        assert.deepEqual(item.meaningFlow, {
            rulesVersion: 1,
            reviewStatus: 'ai_checked',
            reviewMethod: 'multi_agent_direct'
        }, candidate.id);
    }
});

test('meaning-flow pilot fixes representative reverse-translation traps', () => {
    const byId = new Map(content.items.map(item => [item.id, item]));
    assert.deepEqual(byId.get('cv-0062').orderGlosses, ['(과거 질문으로 시작)', '너는 벌써 퇴근했어?']);
    assert.deepEqual(byId.get('cv-0148').orderGlosses, ['어떻게 구했어요', '이 명품 가방을?']);
    assert.deepEqual(byId.get('cv-0421').orderGlosses, [
        '혼자 일해 본 경험이',
        '내게 깨닫게 했어요',
        '깨달은 내용은—불안정한 수입이 사람에게 줄 수 있는 영향,',
        '바로 불안감을 느끼게 한다는 걸.'
    ]);
    assert.deepEqual(byId.get('cv-0750').orderGlosses, ['포장지에는 적혀 있어요', '이탈리아에서 만들어졌다고.']);
});

test('dedicated meaning-flow generation is resumable and cannot write English or chunk changes', () => {
    const functionStart = generatorSource.indexOf('async function runGenerateMeaningFlow()');
    const functionEnd = generatorSource.indexOf('\nconst rows =', functionStart);
    assert.ok(functionStart >= 0 && functionEnd > functionStart);
    const functionBody = generatorSource.slice(functionStart, functionEnd);

    assert.match(generatorSource, /MEANING_FLOW_CACHE_PATH/);
    assert.match(generatorSource, /else if \(mode === 'meaning-flow'\) await runGenerateMeaningFlow\(\)/);
    assert.match(functionBody, /loadMeaningFlowCache\(\)/);
    assert.match(functionBody, /applyMeaningFlowOverrides\(content, overrides\)/);
    assert.match(functionBody, /assertEnglishAndChunksUnchanged\(immutableSnapshot, content\)/);
    assert.match(functionBody, /meaningFlowReviewCount !== overrides\.items\.length/);
    assert.doesNotMatch(functionBody, /\.english\s*=/);
    assert.doesNotMatch(functionBody, /\.assemblyChunks\s*=/);
});

test('every English sentence is reconstructed exactly from native chunks', () => {
    for (const item of content.items) {
        assert.ok(item.assemblyChunks.length >= 1 && item.assemblyChunks.length <= 10, item.id);
        assert.ok(item.assemblyChunks.every(chunk => chunk.split(/\s+/).length <= 5), item.id);
        assert.equal(joinChunks(item.assemblyChunks), item.english, item.id);
        assert.equal(item.orderGlosses.length, item.assemblyChunks.length, item.id);
        assert.ok(item.orderGlosses.every(Boolean), item.id);
        assert.ok(item.corePatterns.length >= 1 && item.corePatterns.length <= 4, item.id);
    }
});

test('every adaptive chunk stage preserves the source English exactly', () => {
    const makeById = new Map(makeChunkOverrides.items.map(item => [item.id, item]));
    for (const item of content.items) {
        const card = { ...item, ...(makeById.get(item.id) || {}), en: item.english, ko: item.naturalKo };
        for (let requestedStage = 0; requestedStage <= 2; requestedStage++) {
            const plan = engine.buildAdaptiveChunkPlan(card, requestedStage);
            assert.equal(joinChunks(plan.chunks), item.english, `${item.id} stage ${requestedStage}`);
            assert.ok(['micro', 'canonical', 'merged', 'recall'].includes(plan.kind), item.id);
            if (plan.mode === 'assembly') {
                assert.ok(plan.chunks.length >= 2, item.id);
                assert.equal(plan.orderGlosses.length, plan.chunks.length, `${item.id} gloss stage ${requestedStage}`);
                assert.ok(plan.orderGlosses.every(Boolean), `${item.id} gloss stage ${requestedStage}`);
            }
        }
    }
});

test('most learning chunks stay within the preferred one-to-four-word range', () => {
    const chunks = content.items.flatMap(item => item.assemblyChunks);
    const compactChunks = chunks.filter(chunk => chunk.split(/\s+/).length <= 4);
    assert.ok(compactChunks.length / chunks.length >= 0.85);
});

test('AI draft chunks have no known placeholder or obvious broken boundary', () => {
    assert.equal(content.qualityReviewModel, 'gemma4:26b');
    for (const item of content.items) {
        assert.ok(item.orderGlosses.every(gloss => !/^(뜻 확인|이어서|확인 필요|번역 필요)$/.test(gloss)), item.id);
        if (item.reviewStatus === 'ai_draft') {
            assert.deepEqual(obviousDraftChunkIssues(item), [], item.id);
        }
    }
});

test('source English remains byte-for-byte unchanged as a complete set', () => {
    const sourceHash = crypto.createHash('sha256')
        .update(content.items.map(item => item.english).join('\n'))
        .digest('hex');
    assert.equal(sourceHash, '6973959301fb57da9d18f8818939f617bdd0cafd3012223b400fc9c1a7394358');
});

test('stored learner error points remain exact source substrings across visual chunks', () => {
    for (const item of content.items) {
        for (const point of item.errorPoints) {
            assert.ok(item.english.includes(point.correct), `${item.id}: ${point.correct}`);
            assert.notEqual(point.correct, point.distractor, item.id);
            assert.ok(point.tip, item.id);
        }
    }
});

test('reviewed examples preserve the agreed learning intent', () => {
    const byEnglish = new Map(content.items.map(item => [item.english, item]));
    const did = byEnglish.get('Did you leave work yet?');
    assert.deepEqual(did.assemblyChunks, ['Did', 'you leave work yet?']);
    assert.ok(did.errorPoints.some(point => point.correct === 'Did' && point.distractor === 'Do'));
    assert.equal(did.reviewStatus, 'reviewed');

    const onMyWay = byEnglish.get("I can't. I'm on my way to the post office.");
    assert.deepEqual(onMyWay.assemblyChunks, ["I can't.", "I'm on my way", 'to the post office.']);
    assert.ok(onMyWay.corePatterns.includes("be on one's way to + 장소"));
    assert.equal(onMyWay.reviewStatus, 'reviewed');

    const airport = byEnglish.get('I barely made it to the airport on time, only to have my flight delayed.');
    assert.deepEqual(airport.assemblyChunks, ['I barely', 'made it to', 'the airport', 'on time,', 'only to', 'have my flight delayed.']);
    assert.equal(airport.reviewStatus, 'reviewed');

    const client = byEnglish.get('She is currently with a client right now. May I take a message?');
    assert.deepEqual(client.assemblyChunks, ['She', 'is currently', 'with a client', 'right now.', 'May I take', 'a message?']);
    assert.equal(client.orderGlosses.length, 6);
    assert.equal(client.reviewStatus, 'reviewed');
});

test('all 869 stored items build an answerable practice question', () => {
    for (const item of content.items) {
        const question = engine.buildPracticeQuestion({
            ...item,
            en: item.english,
            ko: item.naturalKo
        }, () => 0.37);
        assert.ok(question.targetChunks.length >= 1 && question.targetChunks.length <= 10, item.id);
        assert.equal(joinChunks(question.targetChunks), item.english, item.id);
        assert.equal(question.targetIds.length, question.targetChunks.length, item.id);
        assert.equal(engine.evaluatePractice(question, question.targetIds).correct, true, item.id);
    }
});

test('all 869 stored items keep one-to-one Korean and English chunk boundaries for review', () => {
    for (const item of content.items) {
        const card = { ...item, en: item.english, ko: item.naturalKo };
        const reviewChunks = engine.buildReviewTokens(card);
        const question = engine.buildPracticeQuestion(card, () => 0.37);
        const practiceReviewChunks = engine.buildReviewTokens(card, question.targetChunks);
        const filledSlots = engine.buildPracticeSlots(question, practiceReviewChunks, question.targetIds);
        assert.equal(reviewChunks.length, item.orderGlosses.length, item.id);
        assert.equal(filledSlots.length, question.targetChunks.length, item.id);
        assert.equal(joinChunks(reviewChunks.map(chunk => chunk.text)), item.english, item.id);
        reviewChunks.forEach(chunk => {
            assert.equal(chunk.tokens.map(token => token.text).join(' '), chunk.text, item.id);
        });
        question.targetChunks.forEach((chunk, index) => {
            assert.equal(filledSlots[index].tokens.map(token => token.text).join(' '), chunk, item.id);
        });
    }
});

test('the mobile review screen keeps word-level marking without error categories or a core phrase panel', () => {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
    assert.match(html, /영어 청크로 확인/);
    assert.match(html, /영어 의미 전개 순서/);
    assert.match(app, /의미 단서를 앞에서부터 따라가며/);
    assert.match(app, /pilot.*meaning-flow/);
    assert.match(app, /pageParams\.get\('verb'\)/);
    assert.match(app, /requestedVerbPilot/);
    assert.match(app, /meaningFlow\?\.reviewStatus === 'reviewed'/);
    assert.match(app, /MAKE_CHUNK_OVERRIDES_URL/);
    assert.match(app, /makeChunkById\.get\(item\.id\)/);
    assert.doesNotMatch(html, /같은 번호|번째 청크/);
    assert.doesNotMatch(app, /data-slot|번째 청크/);
    assert.match(html, /id="practice-slots"/);
    assert.match(html, /id="practice-bank"/);
    assert.match(app, /practice-empty-guide/);
    assert.match(app, /clearMistakesForPracticeChunks\(\[removedId\]\)/);
    assert.match(app, /if \(!currentPracticeResult\.correct\) \{[\s\S]{0,180}errorTypes\.includes\('word_order'\)/);
    assert.match(app, /function markNoMistakes\(\) \{[\s\S]{0,700}finishSelfAssessment\('X', signals/);
    assert.doesNotMatch(app, /function markNoMistakes\(\) \{[\s\S]{0,180}wordOrderMistake = false/);
    assert.match(html, />모두 맞았어요<\/button>/);
    assert.match(app, /createMistakeWordButton\(token, 'practice-slot-word'\)/);
    assert.match(html, /id="mistake-review"/);
    assert.match(html, /id="mistake-summary"/);
    assert.match(html, /id="btn-toggle-insertion"/);
    assert.match(html, /id="insertion-text"/);
    assert.match(html, /id="insertion-position"/);
    assert.match(app, /function addInsertionMistake\(\)/);
    assert.match(app, /Learning\.buildInsertionMistake/);
    assert.match(app, /operation: 'source_token'/);
    assert.match(app, /insertedText:/);
    assert.match(html, /id="daily-new-progress"/);
    assert.match(html, /id="daily-session-progress"/);
    assert.match(app, /adaptiveLimit - dailyLearned/);
    assert.match(html, /id="practice-result-tip"/);
    assert.match(html, /id="btn-error-export"[^>]*onclick="exportMistakeHistory\(\)"/);
    assert.match(app, /progressData\.mistakeHistory = mistakeHistory\.slice\(-100\)/);
    assert.match(app, /selectedTokenIndexes/);
    assert.match(app, /function exportMistakeHistory\(\)/);
    assert.match(app, /recall: practiceUsedHint \|\| Boolean\(currentPracticeResult\?\.skipped\)/);
    for (const field of ['sentenceId', 'sentence', 'naturalKo', 'assemblyChunks', 'selectedTokenIndexes', 'selections', 'wordOrder', 'recall']) {
        assert.match(app, new RegExp(`${field}:`));
    }
    assert.doesNotMatch(html, /data-error-type|error-type-picker|id="core-phrase-box"|이 문장의 핵심 구문/);
    assert.doesNotMatch(app, /toggleReportedErrorType|getReportedErrorTypes|selectedErrorTypes|errorTypesManuallyEdited|자동 제안|선택한 오류 전체 유형/);
    assert.doesNotMatch(html, /btn-word-order|어순도 틀렸어요/);
    assert.doesNotMatch(app, /toggleWordOrderMistake/);
    assert.match(app, /currentPracticeResult\.errorTypes\.includes\('word_order'\).*wordOrderMistake = true/);
    assert.match(app, /practiceMode === 'recall'/);
    assert.match(app, /떠올린 뒤 영어 정답 확인/);
    assert.match(app, /function markRecallFailure\(\) \{[\s\S]{0,300}wordOrder: wordOrderMistake,[\s\S]{0,300}'recall_failure'/);
    assert.doesNotMatch(app, /function markRecallFailure\(\) \{[\s\S]{0,120}wordOrderMistake = false/);
});

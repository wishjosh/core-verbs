const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('./learning-engine.js');

const fixedRandom = () => 0.4;

test('derives a useful core phrase around the assigned verb', () => {
    assert.equal(
        engine.deriveCorePhrase({ verb: 'HAVE', en: 'Do you have any pets?' }),
        'have any pets?'
    );
});

test('uses a meaningful comparison chunk when the day verb is not in the sentence', () => {
    assert.equal(
        engine.deriveCorePhrase({ verb: 'TAKE', en: 'It’s better than working, but more boring than I expected.' }),
        'better than working'
    );
});

test('separates a question auxiliary and offers a tense contrast', () => {
    const question = engine.buildPracticeQuestion(
        { verb: 'DO', en: 'Did you leave work yet?' },
        fixedRandom
    );
    assert.deepEqual(question.targetChunks, ['Did', 'you leave work yet?']);
    assert.equal(question.errorType, 'tense_auxiliary');
    const distractor = question.bank.find(item => item.isDistractor);
    assert.equal(distractor.text, 'Do');

    const wrongSelection = [...question.targetIds];
    wrongSelection[0] = distractor.id;
    const result = engine.evaluatePractice(question, wrongSelection);
    assert.equal(result.correct, false);
    assert.deepEqual(result.errorTypes, ['tense_auxiliary']);
});

test('keeps sentence boundaries and native phrases together', () => {
    const question = engine.buildPracticeQuestion({
        verb: 'HAVE',
        en: "I can't. I'm on my way to the post office."
    }, fixedRandom);
    assert.equal(question.corePhrase, "I'm on my way");
    assert.deepEqual(question.targetChunks, ["I can't.", "I'm on my way", 'to the post office.']);
    assert.ok(question.bank.some(item => item.isDistractor && item.text === 'to post office.'));
});

test('uses reviewed native chunks, English-order glosses, and reusable patterns from stored content', () => {
    const card = {
        verb: 'MAKE',
        en: 'I barely made it to the airport on time, only to have my flight delayed.',
        assemblyChunks: ['I barely', 'made it to the airport', 'on time,', 'only to have my flight delayed.'],
        orderGlosses: ['나는 간신히', '공항에 도착했는데', '제시간에,', '결국 비행기가 지연되는 일을 겪었다.'],
        corePatterns: ['make it to + 장소', 'on time', 'only to + 동사원형']
    };
    const question = engine.buildPracticeQuestion(card, fixedRandom);
    assert.deepEqual(question.targetChunks, card.assemblyChunks);
    assert.deepEqual(question.orderGlosses, card.orderGlosses);
    assert.deepEqual(question.corePatterns, card.corePatterns);
    assert.equal(question.corePhrase, 'make it to + 장소');
});

test('preserves a no-space em dash as a real chunk boundary', () => {
    const question = engine.buildPracticeQuestion({
        verb: 'WORK',
        en: 'We can meet in Gangnam—wherever works best.',
        assemblyChunks: ['We can meet', 'in Gangnam—', 'wherever works best.'],
        orderGlosses: ['우리는 만날 수 있어', '강남에서—', '가장 편한 곳이면 어디든.'],
        corePatterns: ['wherever works best']
    }, fixedRandom);
    assert.deepEqual(question.targetChunks, ['We can meet', 'in Gangnam—', 'wherever works best.']);
});

test('uses a stored learner error point as a selectable contrast', () => {
    const question = engine.buildPracticeQuestion({
        verb: 'HAVE',
        en: 'Did you leave work yet?',
        assemblyChunks: ['Did', 'you leave work yet?'],
        corePatterns: ['Did + 주어 + 동사원형 + yet?'],
        errorPoints: [{
            type: 'tense_auxiliary',
            correct: 'Did',
            distractor: 'Do',
            tip: '한 번의 과거 퇴근 여부를 묻기 때문에 Did를 씁니다.'
        }]
    }, () => 0);
    const distractor = question.bank.find(item => item.isDistractor);
    assert.equal(distractor.text, 'Do');
    assert.equal(distractor.errorType, 'tense_auxiliary');
});

test('keeps reviewed chunk boundaries while exposing tappable words', () => {
    const card = {
        en: 'I barely made it to the airport on time, only to have my flight delayed.',
        assemblyChunks: ['I barely', 'made it to the airport', 'on time,', 'only to have my flight delayed.']
    };
    const chunks = engine.buildReviewTokens(card);
    assert.deepEqual(chunks.map(chunk => chunk.text), card.assemblyChunks);
    assert.equal(chunks[1].tokens.map(token => token.text).join(' '), 'made it to the airport');
    assert.deepEqual(chunks.flatMap(chunk => chunk.tokens).map(token => token.index),
        Array.from({ length: 15 }, (_, index) => index));
});

test('classifies a tapped Did as a tense and auxiliary error', () => {
    const card = {
        en: 'Did you leave work yet?',
        assemblyChunks: ['Did', 'you leave work yet?'],
        errorPoints: [{ type: 'tense_auxiliary', correct: 'Did', distractor: 'Do' }]
    };
    const result = engine.classifyMistakeSelections(card, [0]);
    assert.deepEqual(result.errorTypes, ['tense_auxiliary']);
    assert.deepEqual(result.mistakes[0], {
        start: 0,
        end: 1,
        text: 'Did',
        type: 'tense_auxiliary'
    });
});

test('groups adjacent selected words across a visual chunk boundary as one expression error', () => {
    const card = {
        en: 'I barely made it to the airport on time.',
        assemblyChunks: ['I barely', 'made it', 'to the airport', 'on time.']
    };
    const result = engine.classifyMistakeSelections(card, [2, 3, 4]);
    assert.equal(result.mistakes.length, 1);
    assert.equal(result.mistakes[0].text, 'made it to');
    assert.equal(result.mistakes[0].type, 'expression');
});

test('does not classify a noun as an article error unless the article itself is selected', () => {
    const card = {
        en: 'She is with a client.',
        assemblyChunks: ['She', 'is', 'with a client.'],
        errorPoints: [{ type: 'article', correct: 'a client', distractor: 'client' }]
    };
    assert.deepEqual(engine.classifyMistakeSelections(card, [4]).errorTypes, ['expression']);
    assert.deepEqual(engine.classifyMistakeSelections(card, [3]).errorTypes, ['article']);
});

test('expands a selected chunk into word-level error boxes without losing chunk order', () => {
    const card = {
        verb: 'GET',
        en: 'How did you get this designer bag?',
        assemblyChunks: ['How did you get', 'this designer bag?'],
        orderGlosses: ['어떻게 얻었니', '이 디자이너 가방을?']
    };
    const question = engine.buildPracticeQuestion(card, fixedRandom);
    const reviewChunks = engine.buildReviewTokens(card);
    const targetBank = question.bank.filter(entry => !entry.isDistractor).sort((a, b) => a.targetIndex - b.targetIndex);
    const emptySlots = engine.buildPracticeSlots(question, reviewChunks, []);
    const oneChunkSelected = engine.buildPracticeSlots(question, reviewChunks, ['target-0']);

    assert.deepEqual(question.targetChunks, card.assemblyChunks);
    assert.deepEqual(targetBank.map(entry => entry.targetIndex), [0, 1]);
    assert.notDeepEqual(
        question.bank.filter(entry => !entry.isDistractor).map(entry => entry.id),
        question.targetIds
    );
    assert.deepEqual(reviewChunks[0].tokens.map(token => token.text), ['How', 'did', 'you', 'get']);
    assert.deepEqual(reviewChunks[0].tokens.map(token => token.index), [0, 1, 2, 3]);
    assert.deepEqual(reviewChunks[1].tokens.map(token => token.index), [4, 5, 6]);
    assert.deepEqual(emptySlots.map(slot => ({ id: slot.id, text: slot.text, tokens: slot.tokens })), [
        { id: null, text: '', tokens: [] },
        { id: null, text: '', tokens: [] }
    ]);
    assert.deepEqual(oneChunkSelected[0].tokens.map(token => token.text), ['How', 'did', 'you', 'get']);
    assert.equal(oneChunkSelected[1].id, null);
    assert.deepEqual(engine.classifyMistakeSelections(card, [1]).errorTypes, ['tense_auxiliary']);
    assert.equal(engine.evaluatePractice(question, ['target-0', 'target-1']).correct, true);
    assert.deepEqual(engine.evaluatePractice(question, ['target-1', 'target-0']).errorTypes, ['word_order']);
});

test('does not expose the answer order when a shuffle leaves chunk candidates unchanged', () => {
    const question = engine.buildPracticeQuestion({
        verb: 'GET',
        en: 'How did you get this designer bag?',
        assemblyChunks: ['How did you get', 'this designer bag?']
    }, () => 0.999999);
    const visibleIds = question.bank
        .filter(entry => !entry.isDistractor)
        .map(entry => entry.id);

    assert.deepEqual(question.targetIds, ['target-0', 'target-1']);
    assert.deepEqual(visibleIds, ['target-1', 'target-0']);
});

test('adds an explicit word-order error without requiring word selection', () => {
    const card = { en: 'Did you leave work yet?', assemblyChunks: ['Did', 'you leave work yet?'] };
    const result = engine.classifyMistakeSelections(card, [], { wordOrder: true });
    assert.deepEqual(result.errorTypes, ['word_order']);
    assert.equal(result.mistakes[0].text, '문장 어순');
});

test('keeps a stored short chunk while exposing every word inside it', () => {
    const card = {
        verb: 'SEE',
        en: 'May I see your ID?',
        assemblyChunks: ['May I see your ID?']
    };
    const question = engine.buildPracticeQuestion(card, fixedRandom);
    const review = engine.buildReviewTokens(card, question.targetChunks);
    assert.deepEqual(question.targetChunks, ['May I see your ID?']);
    assert.deepEqual(review[0].tokens.map(token => token.text), ['May', 'I', 'see', 'your', 'ID?']);
});

test('builds a mobile chunk question with a plural or Koreanism contrast', () => {
    const question = engine.buildPracticeQuestion(
        { verb: 'HAVE', en: 'Do you have any pets?', ko: '반려동물 키우시나요?' },
        fixedRandom
    );
    assert.ok(question.targetChunks.length >= 2);
    assert.ok(question.targetChunks.length <= 5);
    assert.deepEqual(question.targetChunks, ['Do', 'you have any pets?']);
    assert.equal(question.targetChunks.join(' '), 'Do you have any pets?');
    assert.ok(question.bank.some(item => item.isDistractor));
    assert.ok(['plural', 'koreanism', 'tense_auxiliary'].includes(question.errorType));
});

test('limits long mobile practice questions to five chunks', () => {
    const question = engine.buildPracticeQuestion({
        verb: 'GET',
        en: 'That’s good, but you should keep in mind that it gets a bit noisy at night with all the bars nearby.'
    }, fixedRandom);
    assert.ok(question.targetChunks.length <= 5);
    assert.equal(question.targetChunks.join(' '), 'That’s good, but you should keep in mind that it gets a bit noisy at night with all the bars nearby.');
});

test('evaluates exact chunk order and identifies a distractor error', () => {
    const question = engine.buildPracticeQuestion(
        { verb: 'HAVE', en: 'Do you have any pets?' },
        fixedRandom
    );
    assert.equal(engine.evaluatePractice(question, question.targetIds).correct, true);
    const distractor = question.bank.find(item => item.isDistractor);
    const wrongSelection = [...question.targetIds];
    wrongSelection[wrongSelection.length - 1] = distractor.id;
    const result = engine.evaluatePractice(question, wrongSelection);
    assert.equal(result.correct, false);
    assert.ok(result.errorTypes.length > 0);
});

test('preserves source verb proportions when selecting new cards', () => {
    const allCards = [
        ...Array.from({ length: 7 }, (_, i) => ({ verb: 'GET', en: `get ${i}` })),
        ...Array.from({ length: 2 }, (_, i) => ({ verb: 'HAVE', en: `have ${i}` })),
        { verb: 'SEE', en: 'see 0' }
    ];
    const selected = engine.selectWeightedNewCards(allCards, 10, allCards, fixedRandom);
    const counts = selected.reduce((map, card) => ({ ...map, [card.verb]: (map[card.verb] || 0) + 1 }), {});
    assert.deepEqual(counts, { GET: 7, HAVE: 2, SEE: 1 });
});

test('reduces new work when recent recall is weak or reviews are backed up', () => {
    const weak = Array.from({ length: 10 }, (_, i) => ({ correct: i < 5, usedHint: false }));
    assert.equal(engine.getAdaptiveNewLimit(5, weak, 10), 4);
    assert.equal(engine.getAdaptiveNewLimit(20, [], 10), 0);
    assert.equal(engine.getAdaptiveNewLimit(0, [], 10), 10);
});

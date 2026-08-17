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

test('builds a mobile chunk question with a plural or Koreanism contrast', () => {
    const question = engine.buildPracticeQuestion(
        { verb: 'HAVE', en: 'Do you have any pets?', ko: '반려동물 키우시나요?' },
        fixedRandom
    );
    assert.ok(question.targetChunks.length >= 2);
    assert.ok(question.targetChunks.length <= 5);
    assert.equal(question.targetChunks.join(' '), 'Do you have any pets?');
    assert.ok(question.bank.some(item => item.isDistractor));
    assert.ok(['plural', 'koreanism'].includes(question.errorType));
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

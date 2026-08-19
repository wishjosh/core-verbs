const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('./learning-engine.js');

const contentPath = path.join(__dirname, 'data', 'learning-content.json');
const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
const joinChunks = chunks => chunks.reduce((sentence, chunk, index) => (
    index === 0 ? chunk : `${sentence}${/[—–]$/.test(sentence) ? '' : ' '}${chunk}`
), '');

test('stores the complete 50-day, 869-sentence learning set', () => {
    assert.equal(content.schemaVersion, 1);
    assert.equal(content.total, 869);
    assert.equal(content.items.length, 869);
    assert.equal(new Set(content.items.map(item => item.id)).size, 869);
    assert.equal(Math.max(...content.items.map(item => item.day)), 50);
});

test('every English sentence is reconstructed exactly from native chunks', () => {
    for (const item of content.items) {
        assert.ok(item.assemblyChunks.length >= 1 && item.assemblyChunks.length <= 6, item.id);
        assert.equal(joinChunks(item.assemblyChunks), item.english, item.id);
        assert.equal(item.orderGlosses.length, item.assemblyChunks.length, item.id);
        assert.ok(item.orderGlosses.every(Boolean), item.id);
        assert.ok(item.corePatterns.length >= 1 && item.corePatterns.length <= 4, item.id);
    }
});

test('stored learner contrasts are selectable inside one chunk', () => {
    for (const item of content.items) {
        for (const point of item.errorPoints) {
            assert.ok(item.english.includes(point.correct), `${item.id}: ${point.correct}`);
            assert.ok(item.assemblyChunks.some(chunk => chunk.includes(point.correct)), `${item.id}: ${point.correct}`);
            assert.notEqual(point.correct, point.distractor, item.id);
            assert.ok(point.tip, item.id);
        }
    }
});

test('the three reviewed examples preserve the agreed learning intent', () => {
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
    assert.deepEqual(airport.assemblyChunks, ['I barely', 'made it to the airport', 'on time,', 'only to have my flight delayed.']);
    assert.equal(airport.reviewStatus, 'reviewed');
});

test('all 869 stored items build an answerable practice question', () => {
    for (const item of content.items) {
        const question = engine.buildPracticeQuestion({
            ...item,
            en: item.english,
            ko: item.naturalKo
        }, () => 0.37);
        assert.ok(question.targetChunks.length >= 1 && question.targetChunks.length <= 6, item.id);
        assert.equal(joinChunks(question.targetChunks), item.english, item.id);
        assert.equal(question.targetIds.length, question.targetChunks.length, item.id);
        assert.equal(engine.evaluatePractice(question, question.targetIds).correct, true, item.id);
    }
});

test('all 869 stored items keep identical Korean and English chunk numbering for review', () => {
    for (const item of content.items) {
        const card = { ...item, en: item.english, ko: item.naturalKo };
        const reviewChunks = engine.buildReviewTokens(card);
        assert.equal(reviewChunks.length, item.orderGlosses.length, item.id);
        assert.equal(joinChunks(reviewChunks.map(chunk => chunk.text)), item.english, item.id);
        reviewChunks.forEach(chunk => {
            assert.equal(chunk.tokens.map(token => token.text).join(' '), chunk.text, item.id);
        });
    }
});

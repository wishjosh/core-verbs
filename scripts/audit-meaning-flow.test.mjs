import assert from 'node:assert/strict';
import test from 'node:test';

import {
    HIGH_RISK_GROUPS,
    HIGH_RISK_IDS,
    auditContent,
    joinEnglishChunks
} from './audit-meaning-flow.mjs';

function makeItem({
    id,
    english,
    chunks,
    glosses,
    naturalKo = '문장의 자연스러운 한국어 뜻입니다.'
}) {
    return {
        id,
        day: 1,
        verb: 'TEST',
        english,
        naturalKo,
        assemblyChunks: chunks,
        orderGlosses: glosses,
        meaningFlow: { reviewStatus: 'ai_draft' }
    };
}

function auditItems(items) {
    return auditContent(
        { total: items.length, items },
        { includeClean: true, requireAllHighRiskIds: false, source: 'test-fixture' }
    );
}

function findingCodes(report, id) {
    return new Set(report.items.find(item => item.id === id)?.findings.map(finding => finding.code));
}

test('the formulaic review list contains 86 unique IDs in four categories', () => {
    assert.equal(HIGH_RISK_IDS.length, 86);
    assert.equal(new Set(HIGH_RISK_IDS).size, 86);
    assert.deepEqual(
        Object.fromEntries(Object.entries(HIGH_RISK_GROUPS).map(([name, ids]) => [name, ids.length])),
        {
            meaning_reversal_role_omission: 27,
            mechanical_core_verb: 22,
            clause_function_logic: 21,
            idiom_aspect_state_change: 16
        }
    );
});

test('auditing is read-only and preserves exact English reconstruction', () => {
    const item = makeItem({
        id: 'cv-test-clean',
        english: 'I am on my way.',
        chunks: ['I am', 'on my way.'],
        glosses: ['나는 지금 가는 중이야', '목적지로.'],
        naturalKo: '나는 지금 가는 중이야.'
    });
    const content = { total: 1, items: [item] };
    const before = JSON.stringify(content);

    const report = auditContent(content, { includeClean: true, requireAllHighRiskIds: false });

    assert.equal(JSON.stringify(content), before);
    assert.equal(joinEnglishChunks(item.assemblyChunks), item.english);
    assert.equal(report.summary.structuralErrors, 0);
    assert.ok(!findingCodes(report, item.id).has('ENGLISH_RECONSTRUCTION_MISMATCH'));
});

test('flags lost negation and missing question punctuation', () => {
    const negative = makeItem({
        id: 'cv-test-negation',
        english: "I don't want it.",
        chunks: ["I don't", 'want it.'],
        glosses: ['나는', '그걸 원해.'],
        naturalKo: '나는 그것을 원하지 않는다.'
    });
    const question = makeItem({
        id: 'cv-test-question',
        english: 'Did you leave?',
        chunks: ['Did', 'you leave?'],
        glosses: ['과거를 묻는다', '너는 떠났어'],
        naturalKo: '너는 떠났니?'
    });
    const report = auditItems([negative, question]);

    assert.ok(findingCodes(report, negative.id).has('NEGATION_LOSS'));
    assert.ok(findingCodes(report, question.id).has('QUESTION_MARK_MISSING_AT_CHUNK'));
    assert.ok(findingCodes(report, question.id).has('QUESTION_COUNT_MISMATCH'));
    assert.ok(findingCodes(report, question.id).has('CHUNK_PUNCTUATION_COUNT_MISMATCH'));
});

test('flags only-to purpose readings and choose-A-over-B relation risks', () => {
    const onlyTo = makeItem({
        id: 'cv-test-only-to',
        english: 'I hurried there, only to find it closed.',
        chunks: ['I hurried there,', 'only to', 'find it closed.'],
        glosses: ['나는 그곳으로 서둘렀다,', '찾기 위해', '그곳이 닫힌 것을.'],
        naturalKo: '서둘러 갔지만 그곳은 닫혀 있었다.'
    });
    const chooseOver = makeItem({
        id: 'cv-test-choose-over',
        english: 'I chose tea over coffee.',
        chunks: ['I chose tea', 'over coffee.'],
        glosses: ['나는 차를 골랐다', '커피 위에.'],
        naturalKo: '나는 커피보다 차를 골랐다.'
    });
    const report = auditItems([onlyTo, chooseOver]);

    assert.ok(findingCodes(report, onlyTo.id).has('ONLY_TO_RESULT_MISSING'));
    assert.ok(findingCodes(report, onlyTo.id).has('ONLY_TO_PURPOSE_ERROR'));
    assert.ok(findingCodes(report, chooseOver.id).has('CHOOSE_OVER_HIGH_RISK'));
    assert.ok(findingCodes(report, chooseOver.id).has('CHOOSE_OVER_RELATION_RISK'));
});

test('flags mechanical tilde, pronoun, GET, and MAKE glosses', () => {
    const item = makeItem({
        id: 'cv-test-mechanical',
        english: 'I got it and made it.',
        chunks: ['I got it', 'and made it.'],
        glosses: ['나는 그것을 얻었다 ~', '그리고 그것을 만들었다.'],
        naturalKo: '나는 이해했고 결국 해냈다.'
    });
    const report = auditItems([item]);
    const codes = findingCodes(report, item.id);

    assert.ok(codes.has('TILDE_PLACEHOLDER_RISK'));
    assert.ok(codes.has('MECHANICAL_PRONOUN_RISK'));
    assert.ok(codes.has('MECHANICAL_GET_AS_OBTAIN'));
    assert.ok(codes.has('MECHANICAL_MAKE_AS_CREATE'));
    assert.ok(codes.has('IDIOM_GET_IT_LITERAL'));
    assert.ok(codes.has('IDIOM_MAKE_IT_LITERAL'));
});

test('marks every listed high-risk ID with its category', () => {
    const items = HIGH_RISK_IDS.map(id => makeItem({
        id,
        english: 'This is a test.',
        chunks: ['This is', 'a test.'],
        glosses: ['이것은', '시험이다.'],
        naturalKo: '이것은 시험이다.'
    }));
    const report = auditContent(
        { total: items.length, items },
        { includeClean: true, requireAllHighRiskIds: true }
    );

    assert.equal(report.highRisk.presentCount, 86);
    assert.deepEqual(report.highRisk.missingIds, []);
    for (const item of report.items) {
        assert.equal(item.highRisk, true);
        assert.ok(item.highRiskCategory);
        assert.ok(item.findings.some(finding => finding.code === 'HIGH_RISK_ID'));
    }
});

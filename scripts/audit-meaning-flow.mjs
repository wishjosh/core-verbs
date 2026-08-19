import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_INPUT = path.join(ROOT, 'data', 'learning-content.json');

export const HIGH_RISK_GROUPS = Object.freeze({
    meaning_reversal_role_omission: [
        'cv-0009', 'cv-0201', 'cv-0307', 'cv-0311', 'cv-0318', 'cv-0320',
        'cv-0326', 'cv-0327', 'cv-0331', 'cv-0343', 'cv-0347', 'cv-0349',
        'cv-0353', 'cv-0409', 'cv-0440', 'cv-0443', 'cv-0472', 'cv-0503',
        'cv-0526', 'cv-0527', 'cv-0555', 'cv-0735', 'cv-0736', 'cv-0737',
        'cv-0779', 'cv-0783', 'cv-0843'
    ],
    mechanical_core_verb: [
        'cv-0011', 'cv-0017', 'cv-0020', 'cv-0027', 'cv-0028', 'cv-0041',
        'cv-0058', 'cv-0060', 'cv-0072', 'cv-0111', 'cv-0114', 'cv-0120',
        'cv-0150', 'cv-0213', 'cv-0253', 'cv-0257', 'cv-0260', 'cv-0291',
        'cv-0302', 'cv-0382', 'cv-0445', 'cv-0447'
    ],
    clause_function_logic: [
        'cv-0138', 'cv-0158', 'cv-0183', 'cv-0217', 'cv-0250', 'cv-0254',
        'cv-0277', 'cv-0281', 'cv-0284', 'cv-0352', 'cv-0384', 'cv-0428',
        'cv-0494', 'cv-0496', 'cv-0501', 'cv-0546', 'cv-0554', 'cv-0579',
        'cv-0666', 'cv-0801', 'cv-0804'
    ],
    idiom_aspect_state_change: [
        'cv-0464', 'cv-0510', 'cv-0603', 'cv-0659', 'cv-0660', 'cv-0670',
        'cv-0697', 'cv-0703', 'cv-0706', 'cv-0780', 'cv-0782', 'cv-0815',
        'cv-0841', 'cv-0845', 'cv-0858', 'cv-0866'
    ]
});

export const HIGH_RISK_IDS = Object.freeze(Object.values(HIGH_RISK_GROUPS).flat());
const HIGH_RISK_SET = new Set(HIGH_RISK_IDS);
const HIGH_RISK_CATEGORY = new Map(
    Object.entries(HIGH_RISK_GROUPS).flatMap(([category, ids]) => ids.map(id => [id, category]))
);

if (HIGH_RISK_IDS.length !== 86 || HIGH_RISK_SET.size !== 86) {
    throw new Error(`고위험 ID 목록은 중복 없이 86개여야 합니다: ${HIGH_RISK_IDS.length}/${HIGH_RISK_SET.size}`);
}

const TEMPORARY_GLOSS = /^(?:TBD|TODO|뜻 확인|이어서|확인 필요|번역 필요|미정)$/i;
const NEGATION_ENGLISH = /\b(?:not|never|nobody|no one|nothing|nowhere|neither|without|hardly|barely)\b|n['’]t\b/i;
const NEGATION_KOREAN = /(?:안|않|못|없|모르|몰|부정적|어렵|힘들|말(?:고|아|라|았|았어|도록)?|마(?:[.!?—,\s]|$)|없이|아니|아닌|아닐|괜찮|별로|전혀|결코|거의|겨우|간신히|가까스로|뿐만 아니라|뿐 아니라)/;
const BARELY_KOREAN = /(?:겨우|간신히|가까스로|거의\s*(?:못|않))/;
const ONLY_TO_RESULT_KOREAN = /(?:그런데|결국|했지만|했는데|았지만|었지만|도리어|오히려|막상)/;
const ONLY_TO_PURPOSE_KOREAN = /(?:위해|려고|도록|목적으로)/;
const CHOOSE_OVER_KOREAN = /(?:대신|보다|말고|제쳐\s*두고|포기하고|선택)/;

const FORMULAIC_LITERAL_RULES = [
    { english: /\b(?:make|makes|made|making) it\b/i, korean: /그것(?:을|이|은)?\s*만들/, code: 'IDIOM_MAKE_IT_LITERAL', message: 'make it을 그것을 만들다로 직역했을 가능성이 큽니다.' },
    { english: /\b(?:get|gets|got|gotten|getting) it\b/i, korean: /그것(?:을|이|은)?\s*얻/, code: 'IDIOM_GET_IT_LITERAL', message: 'get it을 그것을 얻다로 직역했을 가능성이 큽니다.' },
    { english: /\bcall it a night\b/i, korean: /밤(?:이라고|으로)\s*부르/, code: 'IDIOM_CALL_IT_A_NIGHT_LITERAL', message: 'call it a night의 관용 의미가 보존되지 않았을 가능성이 큽니다.' },
    { english: /\bwork that way\b/i, korean: /그것(?:이|은)?\s*일/, code: 'IDIOM_WORK_THAT_WAY_LITERAL', message: 'work that way를 기계 작동 의미로 옮겼을 가능성이 큽니다.' },
    { english: /\bmake ends meet\b/i, korean: /끝(?:들)?을\s*만/, code: 'IDIOM_MAKE_ENDS_MEET_LITERAL', message: 'make ends meet의 생계 유지 의미가 보존되지 않았을 가능성이 큽니다.' }
];

function parseArgs(argv) {
    const args = {};
    for (const raw of argv) {
        if (raw === '--json') {
            args.format = 'json';
            continue;
        }
        if (raw === '--all') {
            args.all = true;
            continue;
        }
        if (raw === '--strict') {
            args.strict = true;
            continue;
        }
        const [key, ...rest] = raw.replace(/^--/, '').split('=');
        args[key] = rest.length ? rest.join('=') : true;
    }
    return args;
}

export function joinEnglishChunks(chunks) {
    return (chunks || []).reduce((sentence, chunk, index) => {
        if (index === 0) return chunk;
        return `${sentence}${/[—–]$/.test(sentence) ? '' : ' '}${chunk}`;
    }, '');
}

function countMatches(text, expression) {
    return [...String(text || '').matchAll(expression)].length;
}

function countHangul(text) {
    return countMatches(text, /[가-힣]/g);
}

function sentenceEndCount(chunks) {
    return (chunks || []).reduce((count, chunk) => count + sentencePunctuation(chunk).length, 0);
}

function sentencePunctuation(text) {
    return [...String(text || '').matchAll(/[.!?]+(?=["”’']?(?:\s|$))/g)].map(match => match[0]);
}

function makeFinding(severity, code, message, evidence = '', chunkIndex = null) {
    return { severity, code, message, evidence, chunkIndex };
}

function auditItem(item) {
    const findings = [];
    const chunks = Array.isArray(item?.assemblyChunks) ? item.assemblyChunks : [];
    const glosses = Array.isArray(item?.orderGlosses) ? item.orderGlosses : [];
    const english = String(item?.english || '');
    const naturalKo = String(item?.naturalKo || '');
    const glossText = glosses.join(' ');

    if (!item?.id) findings.push(makeFinding('error', 'ID_MISSING', '문장 ID가 없습니다.'));
    if (!english) findings.push(makeFinding('error', 'ENGLISH_MISSING', '영어 원문이 없습니다.'));
    if (!naturalKo) findings.push(makeFinding('error', 'NATURAL_KOREAN_MISSING', '자연스러운 한국어 뜻이 없습니다.'));
    if (!Array.isArray(item?.assemblyChunks) || chunks.length === 0) {
        findings.push(makeFinding('error', 'CHUNKS_MISSING', '영어 청크가 없습니다.'));
    } else if (joinEnglishChunks(chunks) !== english) {
        findings.push(makeFinding('error', 'ENGLISH_RECONSTRUCTION_MISMATCH', '영어 청크를 연결한 결과가 원문과 다릅니다.', joinEnglishChunks(chunks)));
    }
    if (!Array.isArray(item?.orderGlosses)) {
        findings.push(makeFinding('error', 'GLOSSES_MISSING', '의미 전개 단서 배열이 없습니다.'));
    } else if (glosses.length !== chunks.length) {
        findings.push(makeFinding('error', 'CHUNK_GLOSS_COUNT_MISMATCH', '영어 청크와 의미 전개 단서 수가 다릅니다.', `${chunks.length}/${glosses.length}`));
    }

    glosses.forEach((gloss, index) => {
        if (typeof gloss !== 'string' || !gloss.trim()) {
            findings.push(makeFinding('error', 'EMPTY_GLOSS', '비어 있는 의미 전개 단서가 있습니다.', String(gloss), index));
            return;
        }
        if (TEMPORARY_GLOSS.test(gloss.trim())) {
            findings.push(makeFinding('error', 'TEMPORARY_GLOSS', '임시 문구가 남아 있습니다.', gloss, index));
        }
        if (gloss.trim() === '~') {
            findings.push(makeFinding('error', 'BARE_TILDE_GLOSS', '독립된 물결표만 남은 의미 전개 단서입니다.', gloss, index));
        }
        const chunk = chunks[index] || '';
        const chunkQuestions = countMatches(chunk, /\?/g);
        const glossQuestions = countMatches(gloss, /\?/g);
        if (chunkQuestions > glossQuestions) {
            findings.push(makeFinding('high', 'QUESTION_MARK_MISSING_AT_CHUNK', '질문 청크의 한국어 단서에 물음표가 부족합니다.', `${chunk} → ${gloss}`, index));
        }
        const chunkExclamations = countMatches(chunk, /!/g);
        const glossExclamations = countMatches(gloss, /[!！]/g);
        if (chunkExclamations > glossExclamations) {
            findings.push(makeFinding('warning', 'EXCLAMATION_MARK_MISSING_AT_CHUNK', '감탄 청크의 한국어 단서에 감탄 부호가 부족합니다.', `${chunk} → ${gloss}`, index));
        }
        const chunkPunctuation = sentencePunctuation(chunk);
        const glossPunctuation = sentencePunctuation(gloss);
        if (chunkPunctuation.length !== glossPunctuation.length) {
            findings.push(makeFinding('warning', 'CHUNK_PUNCTUATION_COUNT_MISMATCH', '이 영어 청크와 한국어 단서의 문장 종결 부호 수가 다릅니다.', `${chunkPunctuation.join(' ')} / ${glossPunctuation.join(' ')}`, index));
        }
    });

    if (!item?.meaningFlow) {
        findings.push(makeFinding('warning', 'MEANING_FLOW_METADATA_MISSING', '새 의미 전개 메타데이터가 없습니다.'));
    } else if (!['ai_draft', 'ai_checked', 'reviewed', 'needs_review', 'generation_failed'].includes(item.meaningFlow.reviewStatus)) {
        findings.push(makeFinding('error', 'MEANING_FLOW_STATUS_INVALID', '의미 전개 검수 상태가 허용 목록에 없습니다.', String(item.meaningFlow.reviewStatus)));
    }

    const englishQuestionCount = countMatches(english, /\?/g);
    const glossQuestionCount = countMatches(glossText, /\?/g);
    if ((englishQuestionCount > 0) !== (glossQuestionCount > 0)) {
        findings.push(makeFinding('high', 'QUESTION_COUNT_MISMATCH', '영어와 한국어 의미 단서의 질문 수가 다릅니다.', `${englishQuestionCount}/${glossQuestionCount}`));
    } else if (englishQuestionCount !== glossQuestionCount) {
        findings.push(makeFinding('warning', 'QUESTION_COUNT_VARIATION', '질문은 보존됐지만 단서에서 물음표 수가 달라졌습니다.', `${englishQuestionCount}/${glossQuestionCount}`));
    }
    const englishSentenceEnds = sentenceEndCount(chunks);
    const glossSentenceEnds = sentenceEndCount(glosses);
    if (englishSentenceEnds !== glossSentenceEnds) {
        findings.push(makeFinding('warning', 'SENTENCE_PUNCTUATION_COUNT_MISMATCH', '문장 종결 부호 수가 영어와 의미 단서에서 다릅니다.', `${englishSentenceEnds}/${glossSentenceEnds}`));
    }

    if (NEGATION_ENGLISH.test(english)) {
        const notOnly = /\bnot only\b/i.test(english) && /뿐만\s*아니라|뿐\s*아니라/.test(glossText);
        const whyDontSuggestion = /\bwhy\s+don['’]t\b/i.test(english) && /어때|할까|하자|보자|가보/.test(glossText);
        if (!NEGATION_KOREAN.test(glossText) && !notOnly && !whyDontSuggestion) {
            findings.push(makeFinding('high', 'NEGATION_LOSS', '영어의 부정·제한 의미가 한국어 단서에서 확인되지 않습니다.', `${english} → ${glossText}`));
        }
    }
    if (/\bbarely\b/i.test(english) && !BARELY_KOREAN.test(glossText)) {
        findings.push(makeFinding('high', 'BARELY_MEANING_RISK', 'barely의 겨우·간신히 의미가 확인되지 않습니다.', glossText));
    }
    if (/\bonly to\b/i.test(english)) {
        if (!ONLY_TO_RESULT_KOREAN.test(glossText)) {
            findings.push(makeFinding('high', 'ONLY_TO_RESULT_MISSING', 'only to의 예상 밖 결과 의미가 드러나지 않습니다.', glossText));
        }
        if (ONLY_TO_PURPOSE_KOREAN.test(glossText) && !ONLY_TO_RESULT_KOREAN.test(glossText)) {
            findings.push(makeFinding('high', 'ONLY_TO_PURPOSE_ERROR', 'only to를 목적 용법으로 해석했을 가능성이 큽니다.', glossText));
        }
    }
    if (/\b(?:choose|chooses|chose|chosen|choosing)\b[\s\S]*\bover\b/i.test(english)) {
        findings.push(makeFinding('info', 'CHOOSE_OVER_HIGH_RISK', 'choose A over B는 A 선택·B 배제 관계를 사람 또는 AI가 다시 확인해야 합니다.', english));
        if (!CHOOSE_OVER_KOREAN.test(glossText)) {
            findings.push(makeFinding('high', 'CHOOSE_OVER_RELATION_RISK', 'A를 선택하고 B보다 우선한다는 관계가 한국어 단서에서 확인되지 않습니다.', glossText));
        }
    }

    if (/~/.test(glossText)) findings.push(makeFinding('warning', 'TILDE_PLACEHOLDER_RISK', '물결표가 기계적 자리표시자로 남아 있습니다.', glossText));
    if (/그것(?:은|이|을|도|으로|에게)/.test(glossText)) {
        findings.push(makeFinding('warning', 'MECHANICAL_PRONOUN_RISK', '그것은/그것이/그것을 계열의 기계적 직역 가능성이 있습니다.', glossText));
    }
    if (/\b(?:get|gets|got|gotten|getting)\b/i.test(english) && /얻(?:다|어|었|는|을|게)/.test(glossText)) {
        findings.push(makeFinding('warning', 'MECHANICAL_GET_AS_OBTAIN', 'GET을 문맥과 무관하게 얻다로 옮겼을 가능성이 있습니다.', glossText));
    }
    if (/\b(?:make|makes|made|making)\b/i.test(english) && /만들(?:다|어|었|는|게| 수)/.test(glossText)) {
        findings.push(makeFinding('warning', 'MECHANICAL_MAKE_AS_CREATE', 'MAKE를 문맥과 무관하게 만들다로 옮겼을 가능성이 있습니다.', glossText));
    }
    if (/\b(?:have|has|had|having)\b/i.test(english) && /가지(?:고|다|었|는|게)/.test(glossText)) {
        findings.push(makeFinding('warning', 'MECHANICAL_HAVE_AS_POSSESS', 'HAVE를 문맥과 무관하게 가지다로 옮겼을 가능성이 있습니다.', glossText));
    }
    if (/(?:동안\s+동안|한동안\s+동안)/.test(glossText)) {
        findings.push(makeFinding('high', 'DURATION_DUPLICATION', '기간 표현이 중복되었습니다.', glossText));
    }
    if (/비록[.!?]?\s*$/.test(glossText)) {
        findings.push(makeFinding('high', 'THOUGH_INCOMPLETE', '문장 끝 though가 비록만으로 미완성 처리됐을 가능성이 있습니다.', glossText));
    }

    for (const rule of FORMULAIC_LITERAL_RULES) {
        if (rule.english.test(english) && rule.korean.test(glossText)) {
            findings.push(makeFinding('high', rule.code, rule.message, glossText));
        }
    }

    const naturalHangul = countHangul(naturalKo);
    const glossHangul = countHangul(glossText);
    if (naturalHangul >= 8 && glossHangul / naturalHangul < 0.55) {
        findings.push(makeFinding('warning', 'LOW_KOREAN_INFORMATION_RATIO', '자연스러운 뜻에 비해 의미 단서의 한국어 정보량이 매우 적습니다.', `${glossHangul}/${naturalHangul}`));
    }

    const highRisk = HIGH_RISK_SET.has(item?.id);
    if (highRisk) {
        findings.push(makeFinding('info', 'HIGH_RISK_ID', 'formulaic 전수 감사에서 이중 검수 대상으로 지정된 문장입니다.', HIGH_RISK_CATEGORY.get(item.id)));
    }

    return {
        id: item?.id || null,
        day: item?.day ?? null,
        verb: item?.verb || '',
        english,
        highRisk,
        highRiskCategory: highRisk ? HIGH_RISK_CATEGORY.get(item.id) : null,
        meaningFlowStatus: item?.meaningFlow?.reviewStatus || 'legacy',
        findings
    };
}

function countBy(values, keySelector) {
    const counts = {};
    for (const value of values) {
        const key = keySelector(value);
        counts[key] = (counts[key] || 0) + 1;
    }
    return Object.fromEntries(Object.entries(counts).sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])));
}

export function auditContent(content, options = {}) {
    const globalFindings = [];
    const items = Array.isArray(content?.items) ? content.items : [];
    if (!Array.isArray(content?.items)) globalFindings.push(makeFinding('error', 'ITEMS_MISSING', '학습 문장 배열이 없습니다.'));
    if (content?.total !== undefined && content.total !== items.length) {
        globalFindings.push(makeFinding('error', 'TOTAL_MISMATCH', '최상위 total과 실제 문장 수가 다릅니다.', `${content.total}/${items.length}`));
    }

    const seenIds = new Set();
    for (const item of items) {
        if (seenIds.has(item?.id)) globalFindings.push(makeFinding('error', 'DUPLICATE_ID', '중복 문장 ID가 있습니다.', String(item?.id)));
        seenIds.add(item?.id);
    }

    const missingHighRiskIds = HIGH_RISK_IDS.filter(id => !seenIds.has(id));
    if (options.requireAllHighRiskIds !== false && missingHighRiskIds.length) {
        globalFindings.push(makeFinding('error', 'HIGH_RISK_IDS_MISSING', '고위험 ID가 데이터에서 누락되었습니다.', missingHighRiskIds.join(', ')));
    }

    const audited = items.map(auditItem);
    const allFindings = [...globalFindings, ...audited.flatMap(item => item.findings)];
    const severityCounts = countBy(allFindings, finding => finding.severity);
    const codeCounts = countBy(allFindings, finding => finding.code);
    const meaningFlowStatuses = countBy(audited, item => item.meaningFlowStatus);
    const flagged = audited.filter(item => item.findings.length > 0);
    const reportItems = options.includeClean ? audited : flagged;

    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        source: options.source || null,
        summary: {
            totalItems: items.length,
            auditedItems: audited.length,
            cleanItems: audited.length - flagged.length,
            flaggedItems: flagged.length,
            meaningFlowStatuses,
            findingsBySeverity: severityCounts,
            findingsByCode: codeCounts,
            structuralErrors: allFindings.filter(finding => finding.severity === 'error').length,
            semanticHighRisks: allFindings.filter(finding => finding.severity === 'high').length
        },
        highRisk: {
            expectedCount: 86,
            presentCount: HIGH_RISK_IDS.length - missingHighRiskIds.length,
            missingIds: missingHighRiskIds,
            groups: HIGH_RISK_GROUPS,
            flaggedIds: audited.filter(item => item.highRisk).map(item => item.id)
        },
        globalFindings,
        items: reportItems
    };
}

function renderConsole(report) {
    const lines = [];
    lines.push('Core Verbs meaning-flow audit');
    lines.push(`source: ${report.source || '(memory)'}`);
    lines.push(`items: ${report.summary.auditedItems}, flagged: ${report.summary.flaggedItems}, clean: ${report.summary.cleanItems}`);
    lines.push(`structural errors: ${report.summary.structuralErrors}, semantic high-risk signals: ${report.summary.semanticHighRisks}`);
    lines.push(`meaning-flow status: ${Object.entries(report.summary.meaningFlowStatuses).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}`);
    lines.push(`high-risk IDs: ${report.highRisk.presentCount}/${report.highRisk.expectedCount}`);
    if (report.highRisk.missingIds.length) lines.push(`missing high-risk IDs: ${report.highRisk.missingIds.join(', ')}`);
    lines.push('');
    lines.push('top finding codes:');
    Object.entries(report.summary.findingsByCode).slice(0, 20).forEach(([code, count]) => lines.push(`  ${code}: ${count}`));

    const urgent = report.items.filter(item => item.findings.some(finding => ['error', 'high'].includes(finding.severity)));
    if (urgent.length) {
        lines.push('');
        lines.push(`urgent items (${urgent.length}, first 60):`);
        urgent.slice(0, 60).forEach(item => {
            const codes = [...new Set(item.findings.filter(finding => ['error', 'high'].includes(finding.severity)).map(finding => finding.code))];
            lines.push(`  ${item.id}${item.highRisk ? ' [HIGH-RISK]' : ''}: ${codes.join(', ')}`);
        });
    }
    lines.push('');
    lines.push('Use --format=json for the complete machine-readable report.');
    return `${lines.join('\n')}\n`;
}

async function writeJsonAtomic(target, value) {
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporary, target);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const inputPath = path.resolve(ROOT, String(args.input || DEFAULT_INPUT));
    const format = String(args.format || 'console').toLowerCase();
    if (!['console', 'json'].includes(format)) throw new Error(`지원하지 않는 출력 형식: ${format}`);

    const content = JSON.parse(await readFile(inputPath, 'utf8'));
    if (args.batches) {
        const batchDir = path.resolve(ROOT, String(args.batches));
        const files = (await readdir(batchDir)).filter(file => /^part-\d{4}-\d{4}\.json$/.test(file)).sort();
        const byId = new Map(content.items.map(item => [item.id, item]));
        for (const file of files) {
            const batch = JSON.parse(await readFile(path.join(batchDir, file), 'utf8'));
            for (const candidate of batch.items || []) {
                const item = byId.get(candidate.id);
                if (!item) continue;
                item.orderGlosses = candidate.orderGlosses;
                item.meaningFlow = {
                    rulesVersion: batch.rulesVersion,
                    reviewStatus: batch.reviewStatus
                };
            }
        }
    }
    const report = auditContent(content, { source: inputPath, includeClean: Boolean(args.all) });

    if (args.output) {
        const outputPath = path.resolve(ROOT, String(args.output));
        if (outputPath === inputPath) throw new Error('감사 보고서 경로는 입력 데이터 경로와 달라야 합니다.');
        await writeJsonAtomic(outputPath, report);
        process.stdout.write(`감사 보고서 저장: ${outputPath}\n`);
    } else if (format === 'json') {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
        process.stdout.write(renderConsole(report));
    }

    if (args.strict && report.summary.structuralErrors > 0) process.exitCode = 1;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
    main().catch(error => {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exitCode = 1;
    });
}

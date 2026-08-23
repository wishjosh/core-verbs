/* ==========================================================================
   Core Verbs - mobile practice and scheduling helpers
   Browser: window.CoreVerbsLearning / Node: module.exports
   ========================================================================== */

(function exposeLearningEngine(root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.CoreVerbsLearning = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createLearningEngine() {
    const ERROR_LABELS = {
        article: '관사',
        plural: '단수·복수',
        preposition: '전치사',
        koreanism: '한국어 직역형',
        tense_auxiliary: '시제·조동사',
        expression: '핵심 구문',
        word_order: '어순',
        recall: '회상 실패'
    };

    const VERB_FORMS = {
        DO: ['do', 'does', 'did', 'doing', 'done'],
        GET: ['get', 'gets', 'got', 'getting', 'gotten'],
        GIVE: ['give', 'gives', 'gave', 'giving', 'given'],
        GO: ['go', 'goes', 'went', 'going', 'gone'],
        HAVE: ['have', 'has', 'had', 'having'],
        KEEP: ['keep', 'keeps', 'kept', 'keeping'],
        KNOW: ['know', 'knows', 'knew', 'knowing', 'known'],
        LET: ['let', 'lets', 'letting'],
        LIKE: ['like', 'likes', 'liked', 'liking'],
        MAKE: ['make', 'makes', 'made', 'making'],
        SAY: ['say', 'says', 'said', 'saying'],
        SEE: ['see', 'sees', 'saw', 'seeing', 'seen'],
        TAKE: ['take', 'takes', 'took', 'taking', 'taken'],
        WANT: ['want', 'wants', 'wanted', 'wanting'],
        WORK: ['work', 'works', 'worked', 'working']
    };

    const KOREANISM_RULES = [
        { pattern: /\bhave any pets\b/i, wrong: 'raise pets', tip: '반려동물 보유 여부는 보통 have pets로 말합니다.' },
        { pattern: /\bgo home\b/i, wrong: 'go to home', tip: 'home이 목적지를 나타낼 때는 보통 to를 쓰지 않습니다.' },
        { pattern: /\bget married\b/i, wrong: 'marry with', tip: '결혼한 상태가 되다는 get married로 말합니다.' },
        { pattern: /\btake medicine\b/i, wrong: 'eat medicine', tip: '약을 복용하다는 보통 take medicine으로 말합니다.' },
        { pattern: /\bmake a decision\b/i, wrong: 'decide a decision', tip: '결정을 내리다는 make a decision이라는 묶음으로 씁니다.' },
        { pattern: /\blisten to\b/i, wrong: 'listen', tip: '대상을 이어 말할 때 listen 뒤에는 to가 필요합니다.' },
        { pattern: /\bwait for\b/i, wrong: 'wait', tip: '기다리는 대상을 이어 말할 때 wait for를 씁니다.' }
    ];

    function normalizeText(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/[’‘]/g, "'")
            .replace(/[^a-z0-9'\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function cleanWord(word) {
        return String(word || '').replace(/^[^A-Za-z0-9'’]+|[^A-Za-z0-9'’]+$/g, '');
    }

    function joinChunks(chunks) {
        return (chunks || []).reduce((sentence, chunk, index) => {
            if (index === 0) return chunk;
            return `${sentence}${/[—–]$/.test(sentence) ? '' : ' '}${chunk}`;
        }, '');
    }

    function hashText(text) {
        let hash = 0;
        const value = String(text || '');
        for (let i = 0; i < value.length; i++) {
            hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
        }
        return Math.abs(hash);
    }

    function chunkWords(words, maxSize = 3) {
        if (!words.length) return [];
        const chunkCount = Math.max(1, Math.ceil(words.length / maxSize));
        const baseSize = Math.floor(words.length / chunkCount);
        let remainder = words.length % chunkCount;
        let cursor = 0;
        const chunks = [];

        for (let i = 0; i < chunkCount; i++) {
            const size = baseSize + (remainder > 0 ? 1 : 0);
            remainder--;
            chunks.push(words.slice(cursor, cursor + size).join(' '));
            cursor += size;
        }
        return chunks.filter(Boolean);
    }

    function findPhraseRange(words, phrase) {
        const phraseWords = String(phrase || '').trim().split(/\s+/).filter(Boolean);
        if (!phraseWords.length) return null;
        const normalizedWords = words.map(word => normalizeText(cleanWord(word)));
        const normalizedPhrase = phraseWords.map(word => normalizeText(cleanWord(word)));

        for (let start = 0; start <= normalizedWords.length - normalizedPhrase.length; start++) {
            let matches = true;
            for (let offset = 0; offset < normalizedPhrase.length; offset++) {
                if (normalizedWords[start + offset] !== normalizedPhrase[offset]) {
                    matches = false;
                    break;
                }
            }
            if (matches) return { start, end: start + normalizedPhrase.length };
        }
        return null;
    }

    function splitSentenceSegments(words) {
        const segments = [];
        let current = [];
        words.forEach(word => {
            current.push(word);
            if (/[.!?]["']?$/.test(word)) {
                segments.push(current);
                current = [];
            }
        });
        if (current.length) segments.push(current);
        return segments;
    }

    function groupNaturalSegment(words) {
        if (!words.length) return [];
        if (words.length <= 5) return [words.join(' ')];

        const normalized = words.map(word => normalizeText(cleanWord(word)));
        const prepositions = new Set(['to', 'at', 'in', 'on', 'for', 'with', 'from', 'by', 'of']);
        const tailStart = normalized.findIndex((word, index) =>
            index >= 2 && prepositions.has(word) && words.length - index <= 5
        );
        if (tailStart > 0) {
            return [
                ...chunkWords(words.slice(0, tailStart), 4),
                words.slice(tailStart).join(' ')
            ];
        }
        return chunkWords(words, 4);
    }

    function buildSegmentChunks(words, focusPhrase) {
        const focus = findPhraseRange(words, focusPhrase);
        if (!focus) return groupNaturalSegment(words);

        let beforeWords = words.slice(0, focus.start);
        const afterWords = words.slice(focus.end);
        let focusedWords = words.slice(focus.start, focus.end);
        const contractedSubject = /^(i'm|you're|he's|she's|it's|we're|they're)$/;
        if (beforeWords.length === 1 && contractedSubject.test(normalizeText(cleanWord(beforeWords[0])))) {
            focusedWords = [...beforeWords, ...focusedWords];
            beforeWords = [];
        }

        return [
            ...groupNaturalSegment(beforeWords),
            focusedWords.join(' '),
            ...groupNaturalSegment(afterWords)
        ].filter(Boolean);
    }

    function mergeChunksToLimit(chunks, limit) {
        const result = [...chunks];
        while (result.length > limit) {
            let bestIndex = 0;
            let bestScore = Number.POSITIVE_INFINITY;
            for (let index = 0; index < result.length - 1; index++) {
                const crossesSentence = /[.!?]["']?$/.test(result[index]);
                const combinedWords = `${result[index]} ${result[index + 1]}`.split(/\s+/).length;
                const score = combinedWords + (crossesSentence ? 100 : 0);
                if (score < bestScore) {
                    bestScore = score;
                    bestIndex = index;
                }
            }
            result.splice(bestIndex, 2, `${result[bestIndex]} ${result[bestIndex + 1]}`);
        }
        return result;
    }

    function splitChunkAroundPhrase(chunks, phrase) {
        for (let index = 0; index < chunks.length; index++) {
            const words = chunks[index].split(/\s+/).filter(Boolean);
            const range = findPhraseRange(words, phrase);
            if (!range) continue;
            const before = words.slice(0, range.start).join(' ');
            const focused = words.slice(range.start, range.end).join(' ');
            let after = words.slice(range.end).join(' ');
            let remainingStart = index + 1;
            if (/^(i|you|he|she|it|we|they)$/i.test(after) && chunks[index + 1]) {
                after = `${after} ${chunks[index + 1]}`;
                remainingStart = index + 2;
            }
            const replacement = [before, focused, after].filter(Boolean);
            return [...chunks.slice(0, index), ...replacement, ...chunks.slice(remainingStart)];
        }
        return chunks;
    }

    function splitShortChunkNaturally(chunk) {
        const words = String(chunk || '').split(/\s+/).filter(Boolean);
        if (words.length <= 1) return words.length ? [chunk] : [];
        const normalized = words.map(word => normalizeText(cleanWord(word)));
        const subjects = new Set(['i', 'you', 'he', 'she', 'it', 'we', 'they', 'who']);
        const auxiliaries = new Set(['am', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'have', 'has', 'had', 'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must']);
        let splitAt = -1;

        const punctuationBoundary = words.findIndex((word, index) => index < words.length - 1 && /[,;:]$/.test(word));
        if (punctuationBoundary >= 0) {
            splitAt = punctuationBoundary + 1;
        } else if (auxiliaries.has(normalized[0]) && subjects.has(normalized[1])) {
            splitAt = 2;
        } else if (subjects.has(normalized[0]) && (/n't$/.test(normalized[1]) || auxiliaries.has(normalized[1]))) {
            splitAt = 2;
        } else {
            const prepositions = new Set(['about', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'to', 'with']);
            for (let index = words.length - 2; index >= 2; index--) {
                if (prepositions.has(normalized[index])) {
                    splitAt = index;
                    break;
                }
            }
        }

        if (splitAt <= 0 || splitAt >= words.length) splitAt = Math.ceil(words.length / 2);
        return [words.slice(0, splitAt).join(' '), words.slice(splitAt).join(' ')].filter(Boolean);
    }

    function buildChunks(sentence, focusPhrase, separatePhrase = '') {
        const words = String(sentence || '').trim().split(/\s+/).filter(Boolean);
        const sentenceChunks = splitSentenceSegments(words)
            .flatMap(segment => buildSegmentChunks(segment, focusPhrase));
        const baseLimit = separatePhrase ? 4 : 5;
        const merged = mergeChunksToLimit(sentenceChunks, baseLimit);
        return separatePhrase
            ? mergeChunksToLimit(splitChunkAroundPhrase(merged, separatePhrase), 5)
            : merged;
    }

    function deriveCorePhrase(card) {
        if (Array.isArray(card?.corePatterns) && card.corePatterns.length) {
            return String(card.corePatterns[0]).trim();
        }
        if (card && card.corePhrase) return String(card.corePhrase).trim();

        const sentence = String(card?.en || '');
        const words = sentence.trim().split(/\s+/).filter(Boolean);
        const normalizedWords = words.map(word => normalizeText(cleanWord(word)));
        const requestedForms = VERB_FORMS[String(card?.verb || '').toUpperCase()] || [];
        let verbIndex = normalizedWords.findIndex(word => requestedForms.includes(word));

        if (verbIndex < 0) {
            const comparativeIndex = normalizedWords.findIndex((word, index) =>
                ['better', 'worse', 'more', 'less'].includes(word)
                && normalizedWords.slice(index + 1, index + 4).includes('than')
            );
            if (comparativeIndex >= 0) {
                const comparative = [];
                for (let i = comparativeIndex; i < words.length && comparative.length < 5; i++) {
                    if (comparative.length >= 3 && ['but', 'and', 'because', 'so'].includes(normalizedWords[i])) break;
                    comparative.push(words[i]);
                    if (comparative.length >= 3 && /[.!?;,]$/.test(words[i])) break;
                }
                return comparative.join(' ').replace(/[,:;]+$/, '');
            }

            const allForms = Object.values(VERB_FORMS).flat();
            verbIndex = normalizedWords.findIndex(word => allForms.includes(word));
        }

        if (verbIndex < 0) {
            const chunks = buildChunks(sentence);
            return chunks[Math.min(1, Math.max(0, chunks.length - 1))] || sentence;
        }

        const collected = [];
        const stopWords = new Set(['and', 'but', 'because', 'so', 'when', 'if', 'although']);
        for (let i = verbIndex; i < words.length && collected.length < 7; i++) {
            const normalized = normalizedWords[i];
            if (i > verbIndex + 1 && stopWords.has(normalized)) break;
            if (i > verbIndex + 1 && ['at', 'by'].includes(normalized) && /\d/.test(normalizedWords[i + 1] || '')) break;
            collected.push(words[i]);
            if (/[.!?;,]$/.test(words[i])) break;
        }

        while (collected.length > 2 && ['to', 'in', 'on', 'at', 'for', 'with', 'of'].includes(normalizeText(cleanWord(collected.at(-1))))) {
            collected.pop();
        }
        return collected.join(' ');
    }

    function normalizeErrorType(type) {
        const value = String(type || '').trim().toLowerCase();
        const aliases = {
            articles: 'article',
            determiner: 'article',
            number: 'plural',
            singular_plural: 'plural',
            prep: 'preposition',
            direct_translation: 'koreanism',
            korean_expression: 'koreanism',
            tense: 'tense_auxiliary',
            auxiliary: 'tense_auxiliary',
            tense_auxiliary: 'tense_auxiliary',
            order: 'word_order'
        };
        return aliases[value] || (ERROR_LABELS[value] ? value : 'word_order');
    }

    function buildErrorCandidates(card) {
        const sentence = String(card?.en || '');
        const candidates = [];

        if (Array.isArray(card?.errorPoints)) {
            card.errorPoints.forEach(point => {
                if (!point) return;
                candidates.push({
                    type: normalizeErrorType(point.type),
                    correct: String(point.correct || '').trim(),
                    wrong: String(point.distractor || '').trim(),
                    tip: String(point.tip || '이 문장에서 자주 혼동하는 형태를 문장째 확인하세요.').trim(),
                    separate: String(point.correct || '').trim().split(/\s+/).length === 1
                });
            });
            const storedCandidates = candidates.filter(candidate =>
                candidate.correct &&
                candidate.wrong &&
                normalizeText(candidate.correct) !== normalizeText(candidate.wrong) &&
                findPhraseRange(sentence.split(/\s+/), candidate.correct)
            );
            if (storedCandidates.length) return storedCandidates;
        }

        if (card?.distractor) {
            const core = card.corePhrase && findPhraseRange(sentence.split(/\s+/), card.corePhrase)
                ? card.corePhrase
                : deriveCorePhrase(card);
            candidates.push({
                type: normalizeErrorType(card.errorType),
                correct: core,
                wrong: String(card.distractor).trim(),
                tip: String(card.tip || '자연스러운 핵심 표현을 문장째 익혀 두세요.').trim()
            });
        }

        KOREANISM_RULES.forEach(rule => {
            const match = sentence.match(rule.pattern);
            if (match) {
                candidates.push({ type: 'koreanism', correct: match[0], wrong: rule.wrong, tip: rule.tip });
            }
        });

        const auxiliaryMatch = sentence.match(/^\s*(Did|Do|Does)\b/i);
        if (auxiliaryMatch) {
            const correct = auxiliaryMatch[1];
            const alternatives = { did: 'Do', do: 'Did', does: 'Do' };
            candidates.push({
                type: 'tense_auxiliary',
                correct,
                wrong: alternatives[correct.toLowerCase()],
                separate: true,
                tip: '한 번의 과거 행동을 묻는지, 현재의 습관이나 상태를 묻는지 먼저 확인하세요.'
            });
        }

        const pluralMatch = sentence.match(/\b(any|some|many|several|these|those)\s+([A-Za-z]+s)\b/i);
        if (pluralMatch && pluralMatch[2].length > 2 && !/ss$/i.test(pluralMatch[2])) {
            candidates.push({
                type: 'plural',
                correct: pluralMatch[0],
                wrong: `${pluralMatch[1]} ${pluralMatch[2].slice(0, -1)}`,
                tip: `${pluralMatch[1]} 뒤에서 여러 대상을 말할 때는 복수형을 확인하세요.`
            });
        }

        const articleMatch = sentence.match(/\b(a|an|the)\s+([A-Za-z][A-Za-z'’-]*)\b/i);
        if (articleMatch) {
            candidates.push({
                type: 'article',
                correct: articleMatch[0],
                wrong: articleMatch[2],
                tip: '셀 수 있는 단수 명사와 특정 대상을 말할 때 관사를 확인하세요.'
            });
        }

        const prepMatch = sentence.match(/\b(go|listen|wait|look|depend|arrive|get)\s+(to|for|at|in|on|with|from)\b/i);
        if (prepMatch) {
            const replacements = { to: 'for', for: 'to', at: 'to', in: 'at', on: 'in', with: 'to', from: 'at' };
            candidates.push({
                type: 'preposition',
                correct: prepMatch[0],
                wrong: `${prepMatch[1]} ${replacements[prepMatch[2].toLowerCase()] || 'to'}`,
                tip: '동사와 전치사는 함께 쓰이는 묶음으로 기억하세요.'
            });
        }

        return candidates.filter(candidate =>
            candidate.correct &&
            candidate.wrong &&
            normalizeText(candidate.correct) !== normalizeText(candidate.wrong) &&
            findPhraseRange(sentence.split(/\s+/), candidate.correct)
        );
    }

    function shuffle(items, rng = Math.random) {
        const result = [...items];
        for (let i = result.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }

    const MAX_CHUNK_STAGE = 2;

    function getChunkStage(record = {}) {
        const value = Number(record?.chunkStage);
        if (Number.isInteger(value)) return Math.max(0, Math.min(MAX_CHUNK_STAGE, value));

        // 기존 학습 기록에는 단계 필드가 없다. 이미 간격 복습이 진행된 문장은
        // 현재 숙련도에서 너무 멀리 되돌아가지 않도록 interval만 보수적으로 사용한다.
        const interval = Number(record?.interval) || 0;
        if (interval >= 6 && Number(record?.wrongCount || 0) === 0) return 2;
        if (interval >= 1 && Number(record?.wrongCount || 0) === 0) return 1;
        return 0;
    }

    function buildMergedChunkPlan(baseChunks, baseGlosses = []) {
        const chunks = (baseChunks || []).map(text => String(text).trim()).filter(Boolean);
        const glosses = Array.isArray(baseGlosses) && baseGlosses.length === chunks.length
            ? baseGlosses.map(text => String(text).trim())
            : [];
        const mergedChunks = [];
        const mergedGlosses = [];
        for (let index = 0; index < chunks.length;) {
            const current = chunks[index];
            const next = chunks[index + 1];
            const hasStrongBoundary = /[,;:.!?—–]["'’”)]?$/.test(current);
            if (next && !hasStrongBoundary) {
                mergedChunks.push(joinChunks([current, next]));
                if (glosses.length) mergedGlosses.push([glosses[index], glosses[index + 1]].filter(Boolean).join(' '));
                index += 2;
            } else {
                mergedChunks.push(current);
                if (glosses.length) mergedGlosses.push(glosses[index]);
                index += 1;
            }
        }
        return { chunks: mergedChunks, orderGlosses: mergedGlosses };
    }

    function buildAdaptiveChunkPlan(card, requestedStage = 0) {
        const sentence = String(card?.en || '').trim();
        const storedChunks = Array.isArray(card?.assemblyChunks)
            ? card.assemblyChunks.map(chunk => String(chunk).trim()).filter(Boolean)
            : [];
        const baseChunks = storedChunks.length && joinChunks(storedChunks) === sentence
            ? storedChunks
            : buildChunks(card?.en, deriveCorePhrase(card));
        const storedMicroChunks = Array.isArray(card?.microChunks)
            ? card.microChunks.map(chunk => String(chunk).trim()).filter(Boolean)
            : [];
        const hasStoredMicroChunks = storedMicroChunks.length && joinChunks(storedMicroChunks) === sentence;
        // 869문장 모두에서 직접 저장한 형태·의미 발판 청크를 첫 학습 단위로 사용한다.
        // 영어와 한국어를 실행 중에 기계적으로 나누지 않고, 1:1로 대응시켜 둔
        // microChunks와 microOrderGlosses만 사용한다.
        const microChunks = hasStoredMicroChunks ? storedMicroChunks : [...baseChunks];
        const baseGlosses = Array.isArray(card?.orderGlosses) ? [...card.orderGlosses] : [];
        const storedMicroGlosses = Array.isArray(card?.microOrderGlosses)
            ? card.microOrderGlosses.map(gloss => String(gloss).trim()).filter(Boolean)
            : [];
        const microGlosses = hasStoredMicroChunks && storedMicroGlosses.length === microChunks.length
            ? storedMicroGlosses
            : [...baseGlosses];
        const sameChunks = (left, right) => left.length === right.length &&
            left.every((chunk, index) => chunk === right[index]);
        const plans = [];

        if (microChunks.length >= 2) {
            plans.push({
                kind: 'micro',
                mode: 'assembly',
                chunks: microChunks,
                orderGlosses: microGlosses
            });
        }
        if (baseChunks.length >= 2 && !sameChunks(baseChunks, microChunks)) {
            plans.push({
                kind: 'canonical',
                mode: 'assembly',
                chunks: [...baseChunks],
                orderGlosses: baseGlosses
            });
        } else if (sameChunks(baseChunks, microChunks)) {
            const mergedPlan = buildMergedChunkPlan(baseChunks, baseGlosses);
            if (mergedPlan.chunks.length >= 2 && !sameChunks(mergedPlan.chunks, microChunks)) {
                plans.push({
                    kind: 'merged',
                    mode: 'assembly',
                    chunks: mergedPlan.chunks,
                    orderGlosses: mergedPlan.orderGlosses
                });
            }
        }
        if (!plans.length && baseChunks.length >= 2) {
            plans.push({
                kind: 'canonical',
                mode: 'assembly',
                chunks: [...baseChunks],
                orderGlosses: baseGlosses
            });
        }
        // 전체 회상에서는 선택지를 보여주지 않는다. 정답 공개 뒤의 시각 경계는
        // 언제나 검수된 baseChunks를 사용하므로 쉼표나 문장 경계를 합치지 않는다.
        plans.push({
            kind: 'recall',
            mode: 'recall',
            chunks: [...baseChunks],
            orderGlosses: baseGlosses
        });

        const requested = Number.isInteger(Number(requestedStage)) ? Number(requestedStage) : 0;
        const maxStage = Math.max(0, plans.length - 1);
        const stage = Math.max(0, Math.min(maxStage, requested));
        const selectedPlan = plans[stage] || plans.at(-1);
        let chunks = [...selectedPlan.chunks];
        if (!chunks.length || joinChunks(chunks) !== sentence) chunks = [...baseChunks];

        return {
            stage,
            maxStage,
            kind: selectedPlan.kind,
            mode: selectedPlan.mode,
            chunks,
            baseChunks: [...baseChunks],
            orderGlosses: Array.isArray(selectedPlan.orderGlosses)
                ? [...selectedPlan.orderGlosses]
                : baseGlosses
        };
    }

    function updateChunkProgress(record = {}, outcome = {}) {
        const maxStage = Math.max(0, Math.min(MAX_CHUNK_STAGE, Number(outcome.maxStage) || 0));
        let chunkStage = Number.isInteger(outcome.stageBefore)
            ? Math.max(0, Math.min(maxStage, outcome.stageBefore))
            : Math.min(maxStage, getChunkStage(record));
        let chunkSuccessStreak = Math.max(0, Number(record?.chunkSuccessStreak) || 0);
        const kind = String(outcome.kind || '');

        if (kind === 'clean') {
            if (chunkStage < maxStage) {
                chunkSuccessStreak += 1;
                if (chunkSuccessStreak >= 2) {
                    chunkStage += 1;
                    chunkSuccessStreak = 0;
                }
            } else {
                chunkSuccessStreak = Math.min(2, chunkSuccessStreak + 1);
            }
        } else if (kind === 'error' || kind === 'recall_failure') {
            chunkStage = Math.max(0, chunkStage - 1);
            chunkSuccessStreak = 0;
        } else {
            // 정답 바로 보기는 SRS에서는 오답이지만 청크 단계는 유지한다.
            chunkSuccessStreak = 0;
        }

        return { chunkStage, chunkSuccessStreak };
    }

    function buildDistractorChunk(chunks, error) {
        if (!error) return null;
        for (let index = 0; index < chunks.length; index++) {
            const words = chunks[index].split(/\s+/).filter(Boolean);
            const range = findPhraseRange(words, error.correct);
            if (!range) continue;

            const originalEnd = words[range.end - 1] || '';
            const punctuation = originalEnd.match(/[^A-Za-z0-9'’]+$/)?.[0] || '';
            const wrongWords = String(error.wrong || '').trim().split(/\s+/).filter(Boolean);
            if (punctuation && wrongWords.length && !/[^A-Za-z0-9'’]$/.test(wrongWords.at(-1))) {
                wrongWords[wrongWords.length - 1] += punctuation;
            }

            const text = [
                ...words.slice(0, range.start),
                ...wrongWords,
                ...words.slice(range.end)
            ].join(' ');
            return { text, targetIndex: index };
        }
        return null;
    }

    function buildPracticeQuestion(card, rng = Math.random, options = {}) {
        const corePatterns = Array.isArray(card?.corePatterns) && card.corePatterns.length
            ? card.corePatterns.map(pattern => String(pattern).trim()).filter(Boolean)
            : [deriveCorePhrase(card)].filter(Boolean);
        const corePhrase = corePatterns[0] || deriveCorePhrase(card);
        const candidates = buildErrorCandidates(card);
        const error = candidates.length ? candidates[hashText(card?.en) % candidates.length] : null;
        const storedChunks = Array.isArray(card?.assemblyChunks)
            ? card.assemblyChunks.map(chunk => String(chunk).trim()).filter(Boolean)
            : [];
        const sourceWordCount = String(card?.en || '').trim().split(/\s+/).filter(Boolean).length;
        const minimumStoredChunks = sourceWordCount <= 6 ? 1 : 2;
        const hasValidStoredChunks = storedChunks.length >= minimumStoredChunks && joinChunks(storedChunks) === String(card?.en || '').trim();
        const requestedChunks = Array.isArray(options?.chunks)
            ? options.chunks.map(chunk => String(chunk).trim()).filter(Boolean)
            : [];
        const hasValidRequestedChunks = requestedChunks.length > 0 &&
            joinChunks(requestedChunks) === String(card?.en || '').trim();
        let chunks = hasValidRequestedChunks
            ? requestedChunks
            : (hasValidStoredChunks
                ? storedChunks
                : buildChunks(card?.en, corePhrase, error?.separate ? error.correct : ''));
        const targetIds = chunks.map((_, index) => `target-${index}`);
        const bank = chunks.map((text, index) => ({
            id: targetIds[index],
            text,
            isDistractor: false,
            targetIndex: index
        }));
        const distractorChunk = buildDistractorChunk(chunks, error);

        if (error && distractorChunk) {
            bank.push({
                id: 'distractor-0',
                text: distractorChunk.text,
                isDistractor: true,
                errorType: error.type,
                targetIndex: distractorChunk.targetIndex,
                tip: error.tip
            });
        }

        const shuffledBank = shuffle(bank, rng);
        const visibleEntries = shuffledBank.filter(entry => !entry.isDistractor);
        const exposesTargetOrder = visibleEntries.length > 1 &&
            visibleEntries.every((entry, index) => entry.id === targetIds[index]);
        if (exposesTargetOrder) {
            const firstIndex = shuffledBank.indexOf(visibleEntries[0]);
            const secondIndex = shuffledBank.indexOf(visibleEntries[1]);
            [shuffledBank[firstIndex], shuffledBank[secondIndex]] = [
                shuffledBank[secondIndex],
                shuffledBank[firstIndex]
            ];
        }

        return {
            corePhrase,
            corePatterns,
            orderGlosses: Array.isArray(options?.orderGlosses)
                ? [...options.orderGlosses]
                : (Array.isArray(card?.orderGlosses) ? [...card.orderGlosses] : []),
            chunkStage: Number.isInteger(options?.chunkStage) ? options.chunkStage : 0,
            practiceMode: options?.mode === 'recall' ? 'recall' : 'assembly',
            errorType: error?.type || 'word_order',
            errorLabel: ERROR_LABELS[error?.type || 'word_order'],
            tip: error?.tip || '영어는 단어보다 자주 함께 쓰는 표현 덩어리와 어순으로 기억하세요.',
            targetIds,
            targetChunks: chunks,
            bank: shuffledBank
        };
    }

    function evaluatePractice(question, selectedIds) {
        const selected = Array.isArray(selectedIds) ? selectedIds : [];
        const correct = selected.length === question.targetIds.length &&
            selected.every((id, index) => id === question.targetIds[index]);

        const chosenEntries = selected.map(id => question.bank.find(entry => entry.id === id)).filter(Boolean);
        const distractor = chosenEntries.find(entry => entry.isDistractor);
        const errorTypes = [];
        if (distractor?.errorType) errorTypes.push(distractor.errorType);
        if (!correct && !distractor) errorTypes.push('word_order');

        return {
            correct,
            errorTypes: [...new Set(errorTypes)],
            errorLabel: ERROR_LABELS[errorTypes[0] || question.errorType],
            tip: distractor?.tip || question.tip
        };
    }

    function buildPracticeSlots(question, reviewChunks, selectedIds) {
        const targetIds = Array.isArray(question?.targetIds) ? question.targetIds : [];
        const bank = Array.isArray(question?.bank) ? question.bank : [];
        const reviews = Array.isArray(reviewChunks) ? reviewChunks : [];
        const selected = Array.isArray(selectedIds) ? selectedIds : [];
        return targetIds.map((_, slotIndex) => {
            const id = selected[slotIndex] || null;
            const entry = id ? bank.find(item => item.id === id && !item.isDistractor) : null;
            const reviewChunk = entry && Number.isInteger(entry.targetIndex)
                ? reviews[entry.targetIndex]
                : null;
            return {
                slotIndex,
                id,
                targetIndex: entry?.targetIndex ?? null,
                text: entry?.text || '',
                tokens: Array.isArray(reviewChunk?.tokens) ? reviewChunk.tokens : []
            };
        });
    }

    function buildReviewTokens(card, chunkOverride = null) {
        const requestedChunks = Array.isArray(chunkOverride)
            ? chunkOverride.map(chunk => String(chunk).trim()).filter(Boolean)
            : [];
        const storedChunks = Array.isArray(card?.assemblyChunks)
            ? card.assemblyChunks.map(chunk => String(chunk).trim()).filter(Boolean)
            : [];
        const sentence = String(card?.en || '').trim();
        const chunks = requestedChunks.length && joinChunks(requestedChunks) === sentence
            ? requestedChunks
            : (storedChunks.length && joinChunks(storedChunks) === sentence
                ? storedChunks
                : buildChunks(card?.en, deriveCorePhrase(card)));
        let globalIndex = 0;

        return chunks.map((text, chunkIndex) => ({
            text,
            chunkIndex,
            tokens: text.split(/\s+/).filter(Boolean).map((token, tokenIndex) => ({
                id: `word-${globalIndex}`,
                index: globalIndex++,
                chunkIndex,
                tokenIndex,
                text: token,
                normalized: normalizeText(cleanWord(token))
            }))
        }));
    }

    function buildMistakeSelections(card, selectedIndexes) {
        const chunks = buildReviewTokens(card);
        const tokens = chunks.flatMap(chunk => chunk.tokens);
        const selected = [...new Set((selectedIndexes || [])
            .map(Number)
            .filter(index => Number.isInteger(index) && index >= 0 && index < tokens.length))]
            .sort((a, b) => a - b);
        const selectedGroups = [];

        selected.forEach(index => {
            const token = tokens[index];
            const previousGroup = selectedGroups.at(-1);
            const previousIndex = previousGroup?.at(-1);
            const continuesGroup = previousGroup && previousIndex === index - 1;
            if (continuesGroup) previousGroup.push(index);
            else selectedGroups.push([index]);
        });

        return {
            chunks,
            selectedTokenIndexes: selected,
            selections: selectedGroups.map(group => ({
                start: group[0],
                end: group.at(-1) + 1,
                text: group.map(index => tokens[index].text).join(' '),
                tokenIndexes: [...group],
                chunkIndexes: [...new Set(group.map(index => tokens[index].chunkIndex))]
            }))
        };
    }

    function buildInsertionMistake(card, insertedText, afterTokenIndex) {
        const text = String(insertedText || '').trim().replace(/\s+/g, ' ');
        if (!text) return null;

        const tokens = buildReviewTokens(card).flatMap(chunk => chunk.tokens);
        const after = Number(afterTokenIndex);
        if (!Number.isInteger(after) || after < -1 || after >= tokens.length) return null;

        const before = after + 1 < tokens.length ? after + 1 : null;
        const adjacentChunkIndexes = [tokens[after]?.chunkIndex, tokens[before]?.chunkIndex]
            .filter(Number.isInteger);
        return {
            operation: 'insertion',
            start: null,
            end: null,
            text,
            insertedText: text,
            afterTokenIndex: after,
            beforeTokenIndex: before,
            leftContext: after >= 0 ? tokens[after].text : '',
            rightContext: before !== null ? tokens[before].text : '',
            tokenIndexes: [],
            chunkIndexes: [...new Set(adjacentChunkIndexes)]
        };
    }

    function buildAssessmentSignals(options = {}) {
        const signals = [];
        if (options.wordOrder) signals.push('word_order');
        if (options.recall) signals.push('recall');
        return signals;
    }

    function classifyMistakeSelections(card, selectedIndexes, options = {}) {
        const rawSelections = buildMistakeSelections(card, selectedIndexes);
        const chunks = rawSelections.chunks;
        const tokens = chunks.flatMap(chunk => chunk.tokens);
        const selectedGroups = rawSelections.selections.map(selection => selection.tokenIndexes);

        const errorRanges = (Array.isArray(card?.errorPoints) ? card.errorPoints : [])
            .map(point => {
                const range = findPhraseRange(tokens.map(token => token.text), point?.correct);
                return range ? { ...range, type: normalizeErrorType(point.type) } : null;
            })
            .filter(Boolean);
        const articles = new Set(['a', 'an', 'the']);
        const auxiliaries = new Set([
            'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'do', 'does', 'did', 'have', 'has', 'had',
            'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must',
            "i'm", "you're", "he's", "she's", "it's", "we're", "they're",
            "isn't", "aren't", "wasn't", "weren't", "don't", "doesn't", "didn't",
            "haven't", "hasn't", "hadn't", "won't", "wouldn't", "can't", "couldn't", "shouldn't"
        ]);
        const prepositions = new Set([
            'to', 'at', 'in', 'on', 'for', 'with', 'from', 'by', 'of', 'about',
            'after', 'before', 'into', 'over', 'under', 'through', 'without'
        ]);
        const pluralCues = new Set(['any', 'some', 'many', 'several', 'these', 'those', 'few', 'both']);

        function classifyGroup(group) {
            const explicit = errorRanges.find(range =>
                group[0] <= range.start && group.at(-1) + 1 >= range.end
            );
            if (explicit) return explicit.type;

            const words = group.map(index => tokens[index].normalized);
            if (words.some(word => articles.has(word))) return 'article';
            if (words.some(word => auxiliaries.has(word))) return 'tense_auxiliary';

            const hasPluralForm = group.some(index => {
                const word = tokens[index].normalized;
                const previous = tokens[index - 1]?.normalized;
                return word.length > 2 && /s$/.test(word) && !/ss$/.test(word) &&
                    (pluralCues.has(previous) || pluralCues.has(words[0]));
            });
            if (hasPluralForm) return 'plural';
            if (group.length > 1) return 'expression';
            if (prepositions.has(words[0])) return 'preposition';
            return 'expression';
        }

        const mistakes = rawSelections.selections.map((selection, index) => ({
            start: selection.start,
            end: selection.end,
            text: selection.text,
            type: classifyGroup(selectedGroups[index])
        }));

        if (options.wordOrder) {
            mistakes.push({ start: null, end: null, text: '문장 어순', type: 'word_order' });
        }

        return {
            chunks,
            mistakes,
            errorTypes: [...new Set(mistakes.map(mistake => mistake.type))]
        };
    }

    function selectWeightedNewCards(newCards, targetCount, allCards, rng = Math.random) {
        if (!Array.isArray(newCards) || targetCount <= 0) return [];
        const available = new Map();
        newCards.forEach(card => {
            const key = String(card.verb || 'OTHER').toUpperCase();
            if (!available.has(key)) available.set(key, []);
            available.get(key).push(card);
        });
        available.forEach((cards, key) => available.set(key, shuffle(cards, rng)));

        const sourceWeights = new Map();
        (allCards || newCards).forEach(card => {
            const key = String(card.verb || 'OTHER').toUpperCase();
            const priority = Number(card.priority);
            sourceWeights.set(key, (sourceWeights.get(key) || 0) + (Number.isFinite(priority) && priority > 0 ? priority : 1));
        });

        const activeKeys = [...available.keys()].filter(key => available.get(key).length > 0);
        const totalWeight = activeKeys.reduce((sum, key) => sum + (sourceWeights.get(key) || 1), 0);
        const limit = Math.min(targetCount, newCards.length);
        const allocations = activeKeys.map(key => {
            const exact = limit * (sourceWeights.get(key) || 1) / totalWeight;
            const count = Math.min(Math.floor(exact), available.get(key).length);
            return { key, exact, count, remainder: exact - Math.floor(exact) };
        });

        let allocated = allocations.reduce((sum, item) => sum + item.count, 0);
        while (allocated < limit) {
            const candidates = allocations
                .filter(item => item.count < available.get(item.key).length)
                .sort((a, b) => (b.remainder - a.remainder) || ((sourceWeights.get(b.key) || 1) - (sourceWeights.get(a.key) || 1)));
            if (!candidates.length) break;
            candidates[0].count += 1;
            candidates[0].remainder = -1;
            allocated++;
        }

        const selected = [];
        allocations.forEach(item => selected.push(...available.get(item.key).slice(0, item.count)));
        return shuffle(selected, rng);
    }

    function selectCoreVerbNewCards(newCards, targetCount, allCards, options = {}) {
        if (!Array.isArray(newCards) || targetCount <= 0) return [];

        const coreVerbs = ['HAVE', 'GET', 'MAKE', 'TAKE'];
        const coreSet = new Set(coreVerbs);
        const rng = typeof options.rng === 'function' ? options.rng : Math.random;
        const dailyLimit = Math.max(0, Number(options.dailyLimit) || targetCount);
        const perVerbTarget = Math.min(3, Math.floor(dailyLimit / coreVerbs.length));
        const learnedByVerb = options.learnedByVerb && typeof options.learnedByVerb === 'object'
            ? options.learnedByVerb
            : {};
        const buckets = new Map(coreVerbs.map(verb => [verb, []]));

        newCards.forEach(card => {
            const verb = String(card.verb || '').toUpperCase();
            if (coreSet.has(verb)) buckets.get(verb).push(card);
        });
        buckets.forEach((cards, verb) => buckets.set(verb, shuffle(cards, rng)));

        const needs = new Map(coreVerbs.map(verb => [
            verb,
            Math.max(0, perVerbTarget - (Number(learnedByVerb[verb]) || 0))
        ]));
        const selectedCore = [];
        let canTakeCore = true;

        // HAVE→GET→MAKE→TAKE 순환 배정으로 일부만 남은 날에도 한 동사로 쏠리지 않게 한다.
        while (selectedCore.length < targetCount && canTakeCore) {
            canTakeCore = false;
            for (const verb of coreVerbs) {
                if (selectedCore.length >= targetCount) break;
                const bucket = buckets.get(verb);
                if ((needs.get(verb) || 0) <= 0 || bucket.length === 0) continue;
                selectedCore.push(bucket.shift());
                needs.set(verb, needs.get(verb) - 1);
                canTakeCore = true;
            }
        }

        const remainingCount = targetCount - selectedCore.length;
        const otherCards = newCards.filter(card => !coreSet.has(String(card.verb || '').toUpperCase()));
        const selectedOther = selectWeightedNewCards(otherCards, remainingCount, allCards, rng);
        return shuffle([...selectedCore, ...selectedOther], rng);
    }

    function getAdaptiveNewLimit(pendingReviews, recentAttempts, maximum = 10) {
        const middleLimit = Math.min(maximum, Math.max(4, Math.round(maximum * 2 / 3)));
        let limit = maximum;
        if (pendingReviews >= 20) return 0;
        if (pendingReviews >= 12) limit = Math.min(limit, 4);
        else if (pendingReviews >= 8) limit = Math.min(limit, middleLimit);
        const attempts = (Array.isArray(recentAttempts) ? recentAttempts : []).slice(-20);
        if (attempts.length < 5) return limit;
        const accuracy = attempts.filter(item => item.correct && !item.usedHint).length / attempts.length;
        if (accuracy < 0.7) return Math.min(limit, 4);
        if (accuracy < 0.85) return Math.min(limit, middleLimit);
        return limit;
    }

    return {
        ERROR_LABELS,
        normalizeText,
        buildChunks,
        deriveCorePhrase,
        getChunkStage,
        buildAdaptiveChunkPlan,
        updateChunkProgress,
        buildPracticeQuestion,
        evaluatePractice,
        buildPracticeSlots,
        buildReviewTokens,
        buildMistakeSelections,
        buildInsertionMistake,
        buildAssessmentSignals,
        classifyMistakeSelections,
        selectWeightedNewCards,
        selectCoreVerbNewCards,
        getAdaptiveNewLimit
    };
});

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

    function buildPracticeQuestion(card, rng = Math.random) {
        const corePhrase = deriveCorePhrase(card);
        const candidates = buildErrorCandidates(card);
        const error = candidates.length ? candidates[hashText(card?.en) % candidates.length] : null;
        let chunks = buildChunks(card?.en, corePhrase, error?.separate ? error.correct : '');
        if (!error && chunks.length === 1) chunks = splitShortChunkNaturally(chunks[0]);
        const targetIds = chunks.map((_, index) => `target-${index}`);
        const bank = chunks.map((text, index) => ({ id: targetIds[index], text, isDistractor: false }));
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

        return {
            corePhrase,
            errorType: error?.type || 'word_order',
            errorLabel: ERROR_LABELS[error?.type || 'word_order'],
            tip: error?.tip || '영어는 단어보다 자주 함께 쓰는 표현 덩어리와 어순으로 기억하세요.',
            targetIds,
            targetChunks: chunks,
            bank: shuffle(bank, rng)
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

    function getAdaptiveNewLimit(pendingReviews, recentAttempts, maximum = 10) {
        if (pendingReviews >= 20) return 0;
        const attempts = (Array.isArray(recentAttempts) ? recentAttempts : []).slice(-20);
        if (attempts.length < 5) return maximum;
        const accuracy = attempts.filter(item => item.correct && !item.usedHint).length / attempts.length;
        if (accuracy < 0.7) return Math.min(maximum, 4);
        if (accuracy < 0.85) return Math.min(maximum, 7);
        return maximum;
    }

    return {
        ERROR_LABELS,
        normalizeText,
        buildChunks,
        deriveCorePhrase,
        buildPracticeQuestion,
        evaluatePractice,
        selectWeightedNewCards,
        getAdaptiveNewLimit
    };
});

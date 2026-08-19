# Core Verbs

모바일에서 영어 문장을 통째로 입력하지 않고, 원어민이 자주 쓰는 표현 덩어리로 문장을 회상한 뒤 실제로 틀린 부분만 직접 체크하는 정적 웹앱입니다.

## 학습 흐름

1. 영어 어순대로 놓인 짧은 한국어 덩어리를 읽고 영어를 머릿속으로 떠올립니다.
2. 정답을 열면 자연스러운 한국어 뜻과 영어 문장이 나타납니다. 한국어 힌트와 영어 정답은 같은 번호의 청크 경계로 표시됩니다.
3. 영어 정답에서 실제로 틀린 단어를 누릅니다. 같은 청크 안의 여러 단어를 이어 누르면 하나의 구문 오류로 묶입니다.
4. 앱은 선택한 부분을 관사·단수와 복수·전치사·시제와 조동사·핵심 구문으로 자동 분류합니다. 어순 오류와 문장 전체 회상 실패도 별도로 체크할 수 있습니다.
5. `틀린 곳 없음` 또는 `선택한 오류 저장`으로 자기 채점을 마치면 결과가 복습 일정과 개인 오류 기록에 반영됩니다.

새 문장은 하루 최대 10개입니다. 최근 회상 정확도가 낮거나 복습이 쌓이면 7개, 4개 또는 0개로 줄어듭니다. 새 문장을 고를 때는 원본 자료의 동사별 문장 수를 학습 비중으로 사용하므로 고빈도 기본 동사의 비중을 유지합니다.

## 저장된 문장 자료

`data/learning-content.json`에 50일, 869문장의 학습 자료를 저장합니다. 앱은 이 파일을 우선 사용하므로 배포 후에도 매번 청크를 기계적으로 다시 만들지 않습니다. 각 항목에는 다음 정보가 들어 있습니다.

- `assemblyChunks`: 원어민 청크 단위의 영어 정답 경계
- `orderGlosses`: 영어 어순대로 대응하는 한국어 안내
- `naturalKo`: 정답에서 보여 주는 자연스러운 한국어 뜻
- `corePatterns`: 다른 문장에도 재사용할 핵심 구문
- `errorPoints`: 한국인이 혼동하기 쉬운 정답 표현과 자동 분류 기준·설명
- `reviewStatus`: `ai_draft` 또는 직접 확인한 `reviewed`

원본 Google Sheets는 자료를 다시 만들 때의 입력과 이전 배포본의 예비 경로로만 사용합니다. `scripts/generate-learning-content.mjs`는 원문 보존, 청크 재조립, 문장부호 경계, 어순 번역의 1:1 대응, 오류 선택지의 유효성을 검사합니다. AI 초안은 계속 검수할 수 있고, 직접 확인한 항목은 `reviewed`로 구분합니다.

## 실행과 검사

빌드 과정이 없는 HTML/CSS/JavaScript 앱입니다. `localhost`에서 실행해야 PWA와 서비스 워커를 확인할 수 있습니다.

```powershell
python -m http.server 8000
node --test learning-engine.test.js learning-content.test.js
node --check app.js
```

문장 자료를 다시 만들 때는 로컬 Ollama 모델을 실행한 뒤 다음 명령을 사용합니다. 중간 결과는 캐시에 저장되어 중단 후에도 이어집니다.

```powershell
node scripts/generate-learning-content.mjs --mode=generate --model=gemma4:e4b --batch=10
node scripts/generate-learning-content.mjs --mode=validate
```

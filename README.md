# Core Verbs

모바일에서 영어 문장을 통째로 입력하지 않고, 원어민이 자주 쓰는 표현 덩어리를 선택·조립하며 개인 오류를 추적하는 정적 웹앱입니다.

## 학습 흐름

1. 영어 어순대로 놓인 짧은 한국어 덩어리를 읽고 영어를 머릿속으로 떠올립니다.
2. 원어민이 실제로 처리하는 영어 표현 덩어리를 올바른 순서로 선택합니다.
3. 관사·단수와 복수·전치사·시제와 조동사·한국어 직역형의 방해 선택지를 구별합니다.
4. 자연스러운 한국어 뜻, 영어 정답, 재사용할 핵심 구문을 확인하고 발음을 듣습니다.
5. 앱은 실제 선택 결과를 복습 일정과 개인 오류 기록에 반영합니다.

새 문장은 하루 최대 10개입니다. 최근 회상 정확도가 낮거나 복습이 쌓이면 7개, 4개 또는 0개로 줄어듭니다. 새 문장을 고를 때는 원본 자료의 동사별 문장 수를 학습 비중으로 사용하므로 고빈도 기본 동사의 비중을 유지합니다.

## 저장된 문장 자료

`data/learning-content.json`에 50일, 869문장의 학습 자료를 저장합니다. 앱은 이 파일을 우선 사용하므로 배포 후에도 매번 청크를 기계적으로 다시 만들지 않습니다. 각 항목에는 다음 정보가 들어 있습니다.

- `assemblyChunks`: 원어민 청크 단위의 영어 선택지
- `orderGlosses`: 영어 어순대로 대응하는 한국어 안내
- `naturalKo`: 정답에서 보여 주는 자연스러운 한국어 뜻
- `corePatterns`: 다른 문장에도 재사용할 핵심 구문
- `errorPoints`: 한국인이 혼동하기 쉬운 정답·방해 표현·설명
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

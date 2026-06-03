# H-eduware: Origin → Current 변경점(Diff) 정리

> **작성일:** 2026-06-03
> **대상 A (과거/origin):** `H-eduware_origin\SourceCode` — `MULTI_AGENT_ANALYSIS.md`가 분석한 프론트엔드 전용 데모
> **대상 B (현재):** `H-eduware_app_260530\SourceCode` — `feat/layered-context-architecture` 브랜치
> **성격:** 두 리포지토리의 **사실 기반 차이 목록**. 점수·등급·권고가 아니라 *무엇이 추가/대체/변경되었는가*를 `file:line` 증거와 함께 나열한다.
> **방법:** 2단계 멀티에이전트 대조(현재 14모듈 분석 + 과거 주장 9도메인 코드 검증, 25 에이전트).

---

## 0. 개요

origin은 **서버가 없는 프론트엔드 단일 번들 데모**였고, "AI"는 `interviewEngine.js` 결정론적 상태머신, `src/`에 네트워크 호출 0건이었다. 현재는 **TypeScript LangChain/deepagents 에이전트 서버(~37.5K LOC)가 실제 `ChatOpenAI`를 호출**하는 풀스택 앱이다. 아래는 그 사이에 바뀐 것들의 목록이다.

---

## 1. 가장 큰 차이 — 아키텍처 범주의 전환

| | Origin | Current |
|---|---|---|
| 구조 | 프론트엔드 단일 번들 | 프론트(`src/`) + 에이전트 서버(`server/`) 2-tier |
| "AI" | `interviewEngine.js` 결정론 상태머신 (네트워크 0) | 실제 LLM (`deepAgentRuntime.ts:621` `new ChatOpenAI`, `.invoke` ×3) |
| `src/`의 `fetch` | 0건 | `aiClient.js:86`, `circuitTutorClient.js:9`, `shareClient.js:13,22` |
| HTTP 라우트 | 없음 | 6개 (`server/index.ts:30-114`) |
| `interviewEngine.js`의 위치 | **기본 경로** (모든 AI 경험) | **레거시 폴백** (`main.js:1198/1370`의 결정 버튼에만 연결) |
| 기본 대화 엔진 | 상태머신 | `main.js:1433 sendAgentMessage` → 서버 → LLM |
| 영속화 | 없음 | 파일시스템 공유 저장소 (`shareStore.ts` → `.local/shared-projects`) |
| API 키 | 없음(키 존재 여부로 UI 라벨만 토글) | 실제 `OPENAI_API_KEY` 사용(`.env`) |

→ `MULTI_AGENT_ANALYSIS.md`의 전제(§2 "AI는 실제 LLM이 아니다 / 백엔드 없음")는 더 이상 성립하지 않는다.

---

## 2. 정량 변화

| 지표 | Origin | Current |
|---|---|---|
| `server/` | 없음 | ~37.5K LOC (TypeScript) |
| 런타임 의존성 | 1개 (three) | 7개 (@langchain/core, @langchain/openai, deepagents, langchain, js-tiktoken, three, zod) |
| `src/main.js` | 753 LOC | 2749 LOC |
| HTTP 라우트 | 0 | 6 |
| 프론트 단위 테스트 | 0건 | (전체 ~80 유닛 파일, 서버 ~50 신규 `.ts` 포함) |
| `escapeHtml` 정의처 | 2곳 (main.js, libraryBrowser) | 5곳 (htmlSafe + main + inspectorView + shareModal + shareView) |
| E2E 네트워크 가드 복제 | 2개 spec | 3개 spec (demo/live-agent/features) |
| `npm audit` | 0 vulnerabilities | 3 moderate (uuid via @langchain/langgraph) |
| 3D 스테이지 | 2D 플로팅카드 절대좌표 오버레이 | three.js WebGL 씬 (실 3D 좌표) |

---

## 3. 추가된 것 (origin에 없던 신규 서브시스템·파일)

### 3.1 서버 (`server/`) — 전부 신규
- **HTTP 진입점** `server/index.ts` — `node:http` 6라우트: `GET /api/agent/health`, `POST /api/agent/message`, `POST /api/agent/explain-target`, `POST /api/agent/placement`, `POST /api/share/projects`, `GET /api/share/projects/:id`
- **에이전트 런타임** `server/agent/deepAgentRuntime.ts` — `new ChatOpenAI`(`:621`) + `createDeepAgent`(deepagents), repair 루프, 아티팩트 finalization
- **포트/어댑터** `server/agent/agentRuntimePorts.ts` — `ModelPort`, `DeepAgentFactory` (주입식 테스트 페이크)
- **회로 툴 서피스** `server/agent/circuitTools.ts` (9109 LOC) — `validate→netlist→currentPaths→renderPlan→simulationPlan→runnable+solverGate` 컴파일러
- **회로 도메인** `server/agent/circuit/*` — `validation.ts`(5385), `shared.ts`(3400), `simulationPlan.ts`, `renderPlan.ts`, `breadboardAudit.ts`, `netlist.ts`, `requirementBrief.ts`, `requirementDoc.ts`
- **배치 해석(DRC)** `server/agent/placementResolver.ts` — 학생 드래그를 합법 영역으로 clamp·재라우팅
- **레이어드 컨텍스트** `server/context/*` — `contextPacket.ts`(3626), `contextIntent.ts`(1696), `contextLayer.ts`(1521), `capabilityGraph.ts`, `composeTopology.ts`, `compositionSelection.ts`, `pinAliases.ts`, eval/coverage 리포터 등
- **공유 백엔드** `server/share/shareStore.ts` + `shareSchemas.ts` — 32-hex ID, lexical+realpath 트래버설 가드, zod 검증
- **zod 경계 스키마** `server/agent/schemas.ts` (1140)
- **관측성** `server/agent/agentLogger.ts`, `observabilityMiddleware.ts`, `langSmithTraceCli.ts`
- **인프라** `server/serverHealth.ts`, `server/localEnv.ts`
- **결정론 테스트 지원** `server/agent/modelCassette.ts` (LLM 턴 녹화/재생)

### 3.2 지식 베이스 (`agent-context/`) — 신규
- `data/capability-graph.json`, `data/part-capabilities.json`, `data/render-footprints.json`, `electrical/topology-templates.json` 등 ground-truth JSON
- `electrical/*.md` 규칙 문서 (netlist-rules, fault-detection-rules, electrical-model-policy 등)
- `*.sources/` 분할 소스 → `scripts/buildContextAggregate.mjs`로 aggregate 빌드, `checkContextAggregates.mjs`로 드리프트 체크

### 3.3 프론트엔드 신규 모듈
- `src/aiClient.js` — 실제 HTTP 클라이언트 (origin은 스텁)
- `src/circuitTutorClient.js`, `src/shareClient.js` — 서버 호출 클라이언트
- `src/conversationRouting.js` — 학생 turn 분류 (`classifyStudentTurn`)
- `src/agentArtifactGrounding.js` — LLM 아티팩트를 검증된 `CircuitSpec`에 재앵커
- `src/agentErrorMessages.js` — 에이전트 에러 현지화
- `src/stageScene.js` — three.js WebGL 스테이지 (origin은 2D)
- `src/partRenderer.js` — three.js 부품 썸네일
- `src/circuitInspector.js`, `src/inspectorView.js`, `src/circuitMetadata.js` — 회로 인스펙터/튜터 UI
- `src/shareSnapshot.js`, `src/shareImport.js`, `src/shareCard.js`, `src/shareView.js`, `src/shareModal.js` — 공유 플로우
- `src/focusTrap.js`, `src/globalErrorHandler.js`, `src/htmlSafe.js`, `src/renderScheduler.js`, `src/heduwareLogo.js` — 분리된 유틸 seam

### 3.4 테스트·문서·인프라
- 서버 단위 테스트 ~50종 (agentPipeline, contextPacket, circuitToolsContract, placementResolver, schemas, shareStore 등)
- 프론트 신규 유닛 테스트 (focusTrap, globalErrorHandler, htmlSafe, renderScheduler, stageScene, designTokens 등)
- 신규 E2E: `tests/e2e/modalA11y.spec.js`, `phase2-button-gating.spec.js`, `phase1-demo-removal.spec.js`, `live-agent.spec.js`
- `docs/audit/`, `docs/plans/`, `docs/agent-*` 문서군, `Spec/H-eduware_agent_context_layer.md`·`deepagents_v2_requirements.md`
- `railway.json`, `eslint.config.js`, `.prettierrc.json`, `.stylelintrc.json`

---

## 4. 대체·제거된 것

| Origin 요소 | 현재 |
|---|---|
| 2D `.floating-card` 절대좌표 오버레이 (`spot-0~3`) | **제거** → three.js 3D 씬이 실 3D 좌표에 부품 배치 |
| 모바일 카드 본문 숨김 `.floating-card p{display:none}` (origin styles.css:1270) | **제거** → 모바일 단일 컬럼 reflow (`styles.css:1954-1981`) |
| `circuitMetadata.js`의 부품 스키마 (`type` 5종 + 데모 회로 5개) | **제거** → 71 LOC 요구문서 헬퍼로 축소, 정규 스키마는 서버 `CircuitSpec`/`RenderPlan` |
| `stageScene`의 하드코딩 좌표(`addArduino`, 8핀 endpoint) | **대체** → 서버 `RenderPlan`의 `position`/`layout.endpoints`/`route`/`camera` 소비 |
| `aiClient.js` 스텁 (요청 미발신) | **대체** → 실제 fetch 클라이언트 |
| `interviewEngine.js`가 기본 AI 경로 | **강등** → 레거시 폴백 |
| `createLogoMark`의 하드코딩 `data-testid` | **대체** → `heduwareLogo.js:36` `({size,idPrefix,title})` 파라미터화 |

---

## 5. 변경된 것 (기존 요소의 변형)

### 5.1 `src/main.js` — 753 → 2749 LOC
- 여전히 합성루트 + 전역상태 + 인라인 전이 + 뷰 렌더 + 마크다운 파서 + Canvas2D 썸네일을 한 파일에 보유
- 인라인 잔존: `renderMarkdown`(2514), `renderInlineMarkdown`(2562), `slugify`(2576), `createPartThumbnail`(2580), `drawGrid/drawBoardThumbnail/drawMotorThumbnail/drawIsoBox`(2607-2674)
- 신규: 에이전트 대화 루프(`submitAgentMessage` 1376), 서버 호출(`sendAgentMessage` 1433), solver-gate 게이팅, 공유 뷰 부트(`loadInitialShareView`), 인스펙터/배치 흐름
- `src/markdown*`, `src/thumbnails*`, `src/state*` 디렉터리는 **없음**, `^export` **0건**

### 5.2 부품 배치 — 코드주도 → 데이터주도
- `stageScene.js:1984` `position: part.position ?? fallback ?? defaultGenericPartPosition(index)`
- 와이어 endpoint: 서버 `layout.endpoints`를 레거시 좌표 위에 병합(1864-1902)
- route: 서버 `connection.route` 우선(1694-1713), 카메라: 서버 주도(1825-1843)
- 회로 전체가 서버 컴파일 `RenderPlan`에서 발원(`main.js:1980`)

### 5.3 HTML escape / 마크다운
- 신규 정규 escaper `src/htmlSafe.js` (`'`을 `&#039;`로 처리) — `inspectorView.js`가 소비
- 단 `escapeHtml` 정의처는 origin 2곳 → 현재 5곳으로 증가; `main.js:2568`, `libraryBrowser.js:179`는 여전히 `'`·백틱 미처리
- `renderInlineMarkdown` escape-후-재주입 패턴(2562-2566), 헤더 우회(2527,2533), TOC 미escape(`main.js:501`)은 origin과 동일하게 잔존
- 차이: 렌더 대상 마크다운이 origin의 정적 fixture → 현재는 서버 모델 작성 `RequirementDoc` free-text(`requirementBrief.ts:146-161` → `main.js:2004`)

### 5.4 접근성 (a11y)
- 신규: `focusTrap.js`(`createFocusTrap` + 순수 `nextTrapIndex`) + `focusTrap.test.js` + `modalA11y.spec.js`
- 단 `createFocusTrap`의 사용처는 **자기 정의(`focusTrap.js:31`) 1곳뿐** — 모달은 여전히 Escape-only(`welcomePopup.js:72-76`, `libraryBrowser.js:158-162`)
- 한국어 aria-label 추가(`ko.js:91` 등), welcome/share 모달 초기 포커스 추가
- `tab` `aria-controls`/`role=tabpanel`, library-filter `aria-pressed`, libraryBrowser 초기 `.focus()`는 origin과 동일하게 부재

### 5.5 디자인 토큰 / CSS
- `:root` 토큰 수는 origin과 동일하게 13개
- 신규 미정의 커스텀 프로퍼티 `--cream`, `--muted` 추가 사용(`styles.css:403,420,427,1134,1672`), `--c-slate` 미정의 잔존
- focus ring 여전히 `var(--c-coral)`
- 신규 `tests/unit/designTokens.test.js` 추가 (현재 1 pass / 3 fail)
- `styles.css` 753줄 규모 → 2049 LOC

### 5.6 circuit 검증 로직 — 단일 → 이중 사본
- origin엔 회로 검증 로직이 없었음 (서버 자체가 없음)
- 현재: 라이브 `circuitTools.ts`(9109)와, 통째 추출됐으나 import되지 않는 `circuit/*`(`validation.ts` 5385 등)이 **동시 존재**
- `circuit/index.ts`를 import하는 곳 **0** (검증: `grep -rln "circuit/index"` → 없음); 연결된 순수 파일은 `requirementBrief.ts`뿐

---

## 6. 과거 보고서 발견(CC-1~CC-5)의 현재 상태 (then → now)

| ID | Origin | Current |
|---|---|---|
| **CC-1** main.js god-module | 753 LOC, 6개 추상화 레벨 혼합, 마크다운·썸네일 인라인 | 2749 LOC, 동일 구조 유지·확대; `src/markdown/`·`thumbnails/`·`state/` 추출 안 됨 |
| **CC-2** 부품 데이터 이중화 + stageScene 하드코딩 (`position` 미사용) | 두 스키마 공존, 좌표 전부 하드코딩, `position` 정의되나 미사용 | 서버 `RenderPlan`+`placementResolver`로 데이터주도화; `position` 사용; `circuitMetadata` 스키마 제거. 잔여: `partLibraryData` model.kind 썸네일 레시피 |
| **CC-3** 마크다운 escape sink | escape-후-재주입, 정적 입력이라 비활성 | 패턴 동일 잔존, 입력이 모델 생성 free-text로 변경됨 (`[](url)` 룰은 미구현) |
| **CC-4** 모달 포커스 트랩 부재 | 트랩 0, Tab 모달 탈출 | `createFocusTrap` 생성·테스트됨, 그러나 모달에 미연결; 트랩 동작은 런타임에 없음 |
| **CC-5** escape 함수 중복 | 2개 중복, `'`·백틱 미처리 | 정규 `htmlSafe.js` 추가됐으나 정의처 5개로 증가; main/libraryBrowser는 `'`·백틱 미처리 유지 |

---

## 7. 과거 보고서 Tier 액션 항목 — 코드상 반영 여부

| 항목 | 코드상 상태 |
|---|---|
| 0-1 markdown 추출 / 0-2 thumbnail 추출 / 0-3 appReducer | 해당 디렉터리·심볼 없음 (미반영) |
| 0-5 `createLogoMark` testId 파라미터화 | `heduwareLogo.js:36`에 반영 |
| 0-6 escape/E2E 가드 단일화 | `htmlSafe.js` 추가됐으나 4개 로컬 escaper·3중 E2E 가드 잔존 (부분) |
| 1-1 모달 포커스 트랩 | 유틸 생성됐으나 미연결; libraryBrowser 초기 포커스 없음 |
| 1-2 카드↔와이어 leader line / 1-3 모바일 본문 숨김 제거 | 3D 스테이지 전환으로 해당 요소 자체가 사라짐 |
| 1-4 디자인 토큰 동기화 | 미반영 (테스트 RED) |
| 1-5 aria-controls/tabpanel/aria-pressed | 미반영; 한국어 role 라벨은 반영 |
| 2-1 stageScene 데이터주도화 | 반영 (`stageScene.js:1984`); 스키마 통합은 부분 |
| 2-2 aiClient → 포트 + 서버 프록시 | 클라/서버 HTTP 분리로 반영 |
| (비권고) "클린아키 풀 디렉터리 만들지 마라" | 서버는 HTTP·영속화·LLM 도입으로 포트/어댑터+레이어드 디렉터리 채택 |

---

## 8. 코드 경계·표면 변화 (사실 나열)

origin엔 없던, 또는 origin에 있다가 바뀐 코드 경계들:

- **신규 HTTP 표면:** 인증 없는 6개 라우트 (`server/index.ts:30-114`)
- **신규 입력 경계:** `AgentMessageRequestSchema.message`가 `z.string().min(1)`, max 길이 없음 (`schemas.ts:1046`) → 모델 프롬프트로 직행
- **신규 영속화 경계:** 공유 create/read CRUD, 32-hex ID + lexical/realpath 가드 (`shareStore.ts`)
- **신규 신뢰 경계:** `shareSchemas.ts:74,81`에서 `renderPlan`/`solverGateResult`를 `z.unknown()`로 통과
- **신규 의존성 방향:** `circuitTools.ts`·`circuit/*`가 `contextLayer.ts`(`node:fs`)를 직접 import (도메인→인프라)
- **신규 교차-tier 의존:** `server/context/contextLayer.ts:37`이 프론트 `src/partLibraryData.js`를 런타임 `dynamic import()`
- **신규 바인드 동작:** `PORT` 미설정 시 `127.0.0.1`, 설정 시 `0.0.0.0` (`server/index.ts:26`, `railway.json`)
- **클라/서버 DTO 차이:** 클라가 `currentArtifact.source='diagnostic-draft'` 전송(`main.js:2041`) vs 서버 enum `draft|built-project`(`schemas.ts:~1019`)
- **신규 공급망 표면:** 7개 런타임 의존성, `npm audit` 3 moderate

---

## 부록 — 파일 인벤토리 요약

**신규 디렉터리:** `server/`(전체), `agent-context/`(전체), `Spec/`(확장), `docs/audit/`, `docs/plans/`, `scripts/`

**신규 프론트 파일:** aiClient, circuitTutorClient, shareClient, conversationRouting, agentArtifactGrounding, agentErrorMessages, stageScene, partRenderer, circuitInspector, inspectorView, circuitMetadata, shareSnapshot, shareImport, shareCard, shareView, shareModal, focusTrap, globalErrorHandler, htmlSafe, renderScheduler, heduwareLogo, interviewEngine(확장), libraryBrowser, partLibraryData, partLibraryLocalization, buildProgress, welcomePopup, renderWarnings, i18n, locales/{ko,en}

**규모가 크게 바뀐 파일:** `main.js` 753→2749, `styles.css` →2049

**검증 메모:** 본 문서의 `file:line` 인용은 현재 코드 기준이며, `main.js`=2749 LOC, `createFocusTrap` 사용처 1곳, `escapeHtml` 5개 파일, `circuit/index` import 0건은 직접 grep으로 확인함. 과거 상태는 `MULTI_AGENT_ANALYSIS.md` 인용.

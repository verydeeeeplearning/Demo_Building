# H-eduware As-Is 리포지토리 분석 보고서

**작성일**: 2026-06-02
**대상 브랜치**: `main` (최근 커밋: `8d38745 feat: add hardware placement interaction gates`)
**분석 범위**: 전체 리포지토리 (소스 코드, 백엔드 에이전트, 컨텍스트 데이터 레이어, 테스트, 빌드 툴링, 문서)
**분석 방식**: 영역별 정독(코드 직접 분석) + 정량 메트릭 검증

---

## 0. 핵심 요약 (Executive Summary)

H-eduware는 **학생의 자연어 요청("작은 화면에 글자를 띄우고 싶어")을 3D 브레드보드 회로로 변환해 주는 교육용 웹앱**이다. 2026-05-30 Ralphton 부산 해커톤을 위한 "Arduino + I2C OLED" 단일 데모로 출발했으나, 현재 코드베이스는 **다수 부품·기능으로 일반화하려는 야심찬 확장(Deepagents v2, 컨텍스트 소스 번들, solver gate)** 이 진행 중인 과도기 상태이다.

| 구분 | 규모 | 상태 |
|------|------|------|
| 프런트엔드 (src, Vanilla JS + three.js) | 26개 모듈 / **12,582줄** | 동작하나 거대 단일 파일 부채 |
| 백엔드 (server, TS + deepagents/LangChain) | 32개 파일 / **20,744줄** | 검증 게이트 견고, 라이브 의존 |
| 테스트 (unit + e2e) | 42개 파일 / **17,036줄** | 결정적 단위 테스트 충실 |
| 컨텍스트 데이터 레이어 (agent-context) | **363개 파일** | v1/v2 이원화, 마이그레이션 중 |
| 문서 (docs + Spec) | **86개 + 5개** | SSOT 분산, 일부 stale |

**최우선 관찰**:
1. ✅ **강점**: 검증 게이트(validation gate) 다층 구조, Zod 스키마 기반 타입 안전, 한/영 i18n, 결정적(mock) 테스트 분리, 소스-클레임 기반 추적성.
2. ⚠️ **위험**: `src/main.js`(2,743줄) 단일 파일에 상태/렌더/이벤트 집중, 매 상태 변경 시 전체 DOM 재생성, 백엔드 라이브 모드 의존(요구사항 분석 단계에 mock 경로 없음), 컨텍스트 v1↔v2 이원화 미완료.

---

## 1. 시스템 아키텍처 개요

### 1.1 전체 구성

```
┌──────────────────────────────────────────────────────────────┐
│  브라우저 (Vanilla JS + Vite + three.js)                        │
│   src/main.js  ─ 전역 state, render(), 이벤트 바인딩            │
│   ├─ aiClient.js ───────────► HTTP ─────┐                      │
│   ├─ interviewEngine.js (오프라인 상태머신)│                      │
│   ├─ stageScene.js (three.js 3D 무대)    │                      │
│   └─ share*.js (스냅샷 공유)              │                      │
└──────────────────────────────────────────│──────────────────────┘
                                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Node http 서버 (server/index.ts, 포트 8787)                    │
│   /api/agent/message   → deepAgentRuntime.runAgent()           │
│   /api/agent/explain-target → circuitTutor.runTutorAgent()     │
│   /api/agent/placement → placementResolver                     │
│   /api/agent/health    → agentRuntimeHealth + serverHealth     │
│   /api/share/projects  → shareStore (파일 기반)                 │
└──────────────────────────────────────────│──────────────────────┘
                                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Deepagents 런타임 (LangChain + OpenAI)                         │
│   1) Requirement Analysis Agent (경로 판정)                     │
│   2) Circuit Synthesis Deepagent (도구 11종 + subagents)        │
│   3) Draft Repair Loop (검증→재시도 max 2)                      │
└──────────────────────────────────────────│──────────────────────┘
                                            ▼
┌──────────────────────────────────────────────────────────────┐
│  agent-context/ (363 파일) — 소스 오브 트루스 데이터 레이어      │
│   registry / data / electrical / simulation / rendering        │
│   ontology / policies / prompts / sources / evals / v2 / legacy │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 기술 스택 (package.json)

| 계층 | 기술 | 비고 |
|------|------|------|
| 빌드/번들 | Vite `^8.0.14` | `type: module`, ESM |
| 3D | three.js `^0.184.0` | PCB 탭 전용 |
| 에이전트 | `deepagents ^1.10.2`, `langchain ^1.4.2`, `@langchain/openai ^1.4.7`, `@langchain/core ^1.1.48` | OpenAI 직접 호출 |
| 스키마 | `zod ^4.4.3` | 전 입출력 검증 |
| 테스트 | `@playwright/test ^1.60.0`, Node `--test` | e2e + unit |
| 서버 런타임 | `tsx ^4.22.3` | TS 직접 실행, 빌드 산출물 없음 |
| 타입 | `typescript ^6.0.3`, `@types/node` | `tsc --noEmit` |

> 주목: 프런트엔드는 빌드(`vite build`)하지만 **백엔드는 `tsx`로 TS를 직접 실행**한다(컴파일 산출물 없음). `tsconfig.json`의 `include`는 `server/**/*.ts`, `tests/**/*.ts`만 대상이며 `noEmit: true`.

### 1.3 핵심 제품 경험 (Spec/H-eduware_master_statement.md)

제품의 척추는 단일 루프이다: **Describe → Interview → Confirm → Design → Explain → Run**. 해커톤 경계는 "한 개의 잘 다듬어진 Arduino + I2C OLED 브레드보드 데모"로 명시(AGENTS.md L88)되어 있으나, 실제 코드는 27개+ 하드웨어 케이스를 다루는 방향으로 확장되었다(아래 9장 참조).

---

## 2. 프런트엔드 상세 분석 (src/, 12,582줄)

### 2.1 진입점: `src/main.js` (2,743줄)

**책임**: 전역 상태 관리, 전체 렌더 사이클, 이벤트 바인딩, 에이전트 통신 조율, 3D 무대 생성/시뮬레이션 제어를 **단일 파일에 집중**.

**전역 state 객체** (`main.js:37-65`): `locale`, `activeTab`, `projectLoaded`, `awaitingConfirmation`, `built`, `running`, `simulationPlaying`, `interactionMode`(`orbit`/`visual_move`/`hardware_move`), `visualArrangement`(transforms/undoStack/dirty), `agentResult`, `interview`, `inspector`(중첩 객체) 등 약 25개 최상위 속성 + 중첩.

**렌더 사이클**:
- `render()` (`main.js:190`)이 `app.innerHTML = ...` 으로 **매번 전체 DOM을 문자열로 재생성**(`main.js:200`).
- 직후 `bindEvents()`(`main.js:1149`)가 모든 리스너를 재등록.
- PCB 탭일 때만 조건부로 `createStageScene()`로 three.js 무대 생성(`main.js:233-246`).

**부분 갱신 최적화 흔적**: `refreshRuntimeModeLabel()`(`main.js:415`), `refreshInspectorRail()`(`main.js:1352`)처럼 일부 영역만 갱신하려는 시도가 있으나, 대부분 경로는 전체 `render()`로 폴백.

#### 식별된 기술 부채
| 항목 | 위치 | 영향 | 심각도 |
|------|------|------|--------|
| 거대 단일 파일 / 거대 `render()` | main.js 전반 | 테스트·변경 곤란 | 🔴 높음 |
| 매 상태 변경 시 전체 DOM 재생성 | main.js:200 | 성능 저하, 포커스/스크롤 손실 위험 | 🔴 높음 |
| 이벤트 리스너 매번 재바인딩 | main.js:1149~1350 | GC 의존, 중복 바인딩 위험 | 🟠 중간 |
| solver gate 표시 로직 분산 | main.js:654~855 | 200줄 규모 분기, 프런트/백엔드 중복 | 🟠 중간 |
| 비동기 배치 검증 중 상태 변경 경쟁 | main.js:1615~1646 | race condition 가능 | 🟠 중간 |

### 2.2 3D 무대: `src/stageScene.js` (2,026줄)

**책임**: WebGL 기반 브레드보드 회로 렌더링. 부품 메시 생성(`addBreadboard`/`addArduino`/`addOled`/`addGenericRenderPlanParts`/`addLibraryModels`), Catmull-Rom 곡선 배선(`addWires`), 신호 점(dot) 애니메이션(경로별 색상/펄스), 마우스 인터랙션 3종(orbit/visual_move/hardware_move).

- 공유 머티리얼(`SOLDER_MAT`, `PIN_METAL_MAT` 등) 재사용으로 메모리 효율화.
- `dispose()`로 빌드 단위 GPU 리소스 해제(단, 공유 머티리얼 skip).
- visual arrangement: 부품별 위치 변환 저장 + undo 스택(최대 20).
- **하드코딩**: 줌 범위(min 4/max 9), 카메라 위치(4.8, 4.2, 5.2), 브레드보드 경계(±2.8/±1.075) 등 매직 넘버 다수.

### 2.3 부품 렌더러: `src/partRenderer.js`

오프스크린 WebGLRenderer(168×124px)로 부품 썸네일 PNG data URL 생성. WebGL 불가 시 Canvas 2D 동형 투영 폴백. `KIND_BUILDERS`로 12종 부품 형태(board/module/display/chip/cylinder/dome/motor/passive-axial/connector/sensor/breadboard/sphere) 생성.

### 2.4 에이전트 통신: `src/aiClient.js`

- 엔드포인트: `GET /api/agent/health`, `POST /api/agent/message`, `POST /api/agent/placement`.
- 타임아웃 하드코딩: health 1.2s, message 90s, placement 15s.
- 런타임 모드: `deepagents-live` / `deepagents-unconfigured` / `agent-server-offline`.
- **오프라인 폴백**: health 실패 시 `agent-server-offline` 반환 → 프런트는 오프라인 인터뷰 엔진으로 데모 경로 보존.
- `AgentApiError` 클래스로 상태+페이로드 캡처, 타임아웃→AbortError 매핑.

### 2.5 오프라인 인터뷰 엔진: `src/interviewEngine.js`

순수 클라이언트 상태머신(`idle→interviewing→ready`). 결정 포인트: goal(추론) → output(키워드 추론) → content → controller(Arduino Uno/Nano) → power(USB/외부 5V). 정규식 기반 출력 추론(`screen|led|motor|buzz`). **이 엔진 덕분에 에이전트 서버 없이도 데모 경로가 완결**된다(무대 시연 안정성 확보).

### 2.6 대화 라우팅: `src/conversationRouting.js`

학생 입력을 4경로로 분류: `confirm-current-draft` / `revise-current-draft` / `current-artifact-question` / `synthesize-or-clarify`. 텍스트 정규화 후 키워드 매칭(정규식 의존 → 의도 파악 취약성).

### 2.7 공유(Share) 기능

- `shareSnapshot.js`: 프로젝트→JSON 스냅샷 직렬화(schemaVersion 1). **민감정보 redaction**(`sk-proj-...`, `OPENAI_API_KEY=...`, `.local/agent.env` 패턴 제거) 내장 → 보안 양호.
- `shareImport.js`: 스냅샷→로드 가능 프로젝트 역변환. build-ready/review 판정 헬퍼가 main.js와 **중복**.
- `shareModal.js`/`shareCard.js`/`shareView.js`/`shareClient.js`: 생성 플로우 + 읽기 전용 뷰.

### 2.8 i18n (`src/i18n.js` + `locales/ko.js`, `en.js`)

`t(key, values, locale)` 보간 함수, localStorage 영속(`hEduwareLocale`), 키 없으면 키 자체 반환. 한/영 사전 완비. 단, 백엔드 정책/온톨로지는 영어 중심이라 한국어 메시지 일부는 코드에 인라인 분기(예: main.js solver gate 사유 변환 L799~855).

---

## 3. 백엔드 에이전트 런타임 분석 (server/, 20,744줄)

### 3.1 HTTP 서버: `server/index.ts` (154줄)

Node 내장 `http`로 구현. 6개 라우트. CORS는 `127.0.0.1:4173`/`:5173`만 허용(하드코딩). `mapAgentErrorToResponse()`로 에러→HTTP 상태 매핑. 요청마다 `createAgentTraceId()` 발급 후 구조화 로깅.

### 3.2 오케스트레이션: `server/agent/deepAgentRuntime.ts` (1,632줄, 핵심)

**2단계 + 수리 루프 구조**:

1. **Requirement Analysis Agent**: 입력을 4경로(`casual_chat`/`clarify_requirements`/`synthesize_circuit`/`unsupported_or_gap`)로 판정 + 신뢰도 점수 + blockingReason.
2. **Circuit Synthesis Deepagent**: `createDeepAgent({ model, tools, subagents, responseFormat: toolStrategy(LiveAgentDraftSchema) })`. 응답 형식을 Zod 스키마로 강제.
3. **Draft Repair Loop** (`runAgentDraftRepairLoop`, max 2회): 검증 실패 시 이전 에러를 프롬프트에 포함해 재시도, 소진 시 `validationRepairExhaustedEvent`.

**모델 설정**: `ChatOpenAI({ model: H_EDUWARE_AGENT_MODEL, apiKey: OPENAI_API_KEY })`. `gpt-5*`는 Responses API + reasoning effort(`H_EDUWARE_AGENT_REASONING_EFFORT`, 기본 `low`), 그 외 `temperature: 0`.

**후처리**: `normalizePhysicalCircuitSpec()`로 브레드보드 자동 삽입, `buildSafeLowVoltageLedEquivalentSpec()`로 위험 요청을 안전 저전압 LED 대체 회로로 치환(Arduino+220Ω+5mm LED 하드코딩), `sanitizeStudentFacingAssistantMessage()`로 내부 용어 제거.

### 3.3 에이전트 도구 (`deepAgentTools.ts`) — 11종

| 도구 | 책임 | 경계 게이트 |
|------|------|-------------|
| `load_context_index` | 컨텍스트 인덱스 로드 | 반드시 최초 호출 |
| `read_context_doc` | 컨텍스트 문서 읽기 | retrievalPlan sourceIds만 허용 |
| `search_part_capabilities` | 부품 검색 | **candidateParts로 필터링** |
| `load_support_bundle_evidence` | 부품별 검증 증거 로드 | 현재 패킷 번들만 |
| `validate_circuit_spec` | 회로 검증 | 필수 게이트 |
| `build_netlist` | 네트리스트 생성 | **검증 통과 spec만** |
| `estimate_current_paths` | 전류 경로 추정 | valid netlist 필수 |
| `detect_faults` | 단락/접지오류 탐지 | spec 검증 |
| `compile_render_plan` | 3D 배치 계획 | — |
| `compile_simulation_plan` | 시뮬레이션 계획 | 전류경로 기반 |
| `compile_requirement_markdown` | 요구사항 문서 | 학생용 |

> 메모리 기록(AGENTS.md 헤더)에 따르면 5월 31일~6월 1일에 걸쳐 `search_part_capabilities`, `validate_circuit_spec`, `detect_faults`, `build_netlist` 각각에 **candidate-part 경계 게이트**를 RED 테스트 후 추가한 이력이 있다. "Three-Layer Deepagents Context-Boundary Enforcement"로 표현됨.

### 3.4 검증 게이트 (`circuitTools.ts`)

다층 검증: CircuitSpec 구조 검증(부품/핀 존재, power-GND 직접 단락 차단, LED 저항 확인, 폐회로 경로, 접지 반환) → Context Coverage Gate(`CONTEXT_COVERAGE_INSUFFICIENT`) → Candidate Part Gate(`CONTEXT_CANDIDATE_PART_NOT_ALLOWED`) → Build Runnable Gate. 결과는 `solverGateResult`(buildReady/presentationAdjustment/visibleSimulation)로 프런트에 전달.

### 3.5 컨텍스트 패킷: `server/context/contextPacket.ts` (3,673줄)

요청마다 ContextPacket 구성: 학생 메시지→IntentSpecV2 파싱 → CapabilityGraph 매칭 → ContextRoute 결정(우선순위 `valid-circuit-synthesis > clarification-only > unsupported-safety`) → RetrievalPlan(예산별 maxPromptChars) → Support Bundle 증거 수집 → candidateParts 필터 → ContextCoverageReport(synthesisEligibility) → promptBlock 생성. **이 파일이 백엔드 단일 최대 파일**.

### 3.6 기타 백엔드 모듈

- `circuitTutor.ts`: 회로 설명 튜터. **`H_EDUWARE_TUTOR_MODE === 'live'`일 때만 라이브**, 기본은 로컬 템플릿 응답(mock). 도구 없는 deepagent.
- `placementResolver.ts`: 드래그된 하드웨어 위치를 브레드보드 격자에 스냅 검증.
- `agentLogger.ts`: JSONL 이벤트 로깅(`H_EDUWARE_AGENT_LOG_LEVEL` 기본 `silent`, 파일 `.local/agent-traces/agent-events.jsonl`).
- `share/shareStore.ts`: 파일 기반 공유 저장소. **shareId 정규식(`^[a-f0-9]{32}$`) + 경로 prefix 확인 이중 검증으로 path traversal 방어** → 양호.
- `langSmithTraceCli.ts`: LangSmith 추적 CLI(`LANGSMITH_API_KEY` 필요).
- context 하위에 다수 보고서 CLI(`contextV2AuditCli`, `sourceClaimReportCli`, `visualPartCoverageReportCli`, `generalizationEvalReportCli`, `capabilityPromotionReport`).

### 3.7 백엔드 기술 부채 / 위험

| 항목 | 위치 | 심각도 |
|------|------|--------|
| 필수 env(OPENAI_API_KEY, H_EDUWARE_AGENT_MODEL) **시작 시 미검증**, 첫 요청 시 실패 | deepAgentRuntime.ts `requireLiveConfig` | 🔴 높음 |
| Requirement Analysis 단계에 **mock 경로 없음** → 항상 라이브 의존 | deepAgentRuntime.ts | 🟠 중간 |
| deepagents 출력에 `as Record<string, unknown>` 타입 단언 남용 | deepAgentRuntime.ts 1238~1337 | 🟠 중간 |
| 안전 대체 회로(Arduino+220Ω+LED) 하드코딩, 원 요청 맥락 미반영 | deepAgentRuntime.ts 627~677 | 🟡 낮음 |
| 캐싱은 capabilityGraph 메모리 캐시만, 다른 로더는 매 요청 JSON 파싱 | context/*.ts | 🟡 낮음 |
| 에러 메시지 원문이 응답/로그로 전파(내부 용어 노출 가능) | index.ts 55~61, errorResponse.ts | 🟡 낮음 |

---

## 4. 컨텍스트 데이터 레이어 분석 (agent-context/, 363 파일)

### 4.1 조직 (5계층 검색 레벨, index.md)

권위 순서: **안전정책 → 결정적 검증기 → 스키마 → 레지스트리 → 요구사항 → 교육학 → 에이전트 제안**.
검색 레벨: L0(상시 로드) / L1(안전·미지원·명료화 정책) / L2(스킬·참조 요약) / L3(정규 레지스트리·소스클레임·지원번들) / L4(렌더풋프린트·시뮬레이션·평가셋).

### 4.2 주요 디렉터리

| 디렉터리 | 내용 |
|----------|------|
| `registry/` | `part-capabilities.json`(정규 부품), `parts.json`(UI용), `visual-library-crosswalk.json`(매핑), `controller-boards.json`, `starter-kits.json` |
| `data/` | `capability-graph.json`(학생언어→지원수준), `render-footprints.json`(3D 풋프린트) |
| `electrical/` | `component-models.json`, `topology-templates.json`, `board-electrical-limits.json`, `safety-limits.json` |
| `simulation/` | `primitives.json`(시뮬레이션 프리미티브 5종) |
| `rendering/` | `breadboard-grid.json`(스냅 격자) |
| `ontology/` | 핀 별칭, 의도/행동 프리미티브, 학습자 레벨, 신호 타입 |
| `policies/` | 안전/명료화/교육학/미지원/시뮬레이션 진실성 정책(.md) |
| `prompts/` | 스킬별 시스템 프롬프트 7종 |
| `sources/` | `source-claims.json`(원자적 출처 사실), `hardware-support-bundles.json`, `source-authority.md`, `collection-playbook.md` |
| `evals/` | `.jsonl` 평가셋 7종(충분성/다양성/의도/시뮬/검증/위험/미지원) |
| `v2/` | Deepagents v2 번들 기반 라우팅(선호 구조) |
| `legacy/v1/` | 이전 루트 구조 스냅샷(런타임 비사용, 마이그레이션 참조) |

### 4.3 빌드 집계 패턴 (소스 → 집계)

`*.sources/` 디렉터리(카테고리별 분할 JSON + `index.json` 메타) → `scripts/buildContextAggregate.mjs`로 정규 집계 JSON 생성. 4개 도메인(parts/footprints/topologies/capabilities)에 `:build`/`:check` npm 스크립트 제공. **ID 중복·순서 누락 검사가 빌드 게이트** 역할. `npm run context:check`가 전체를 한 번에 검증.

### 4.4 컨텍스트 레이어 부채

- **v1↔v2 이원화 미완료**: `agent-context/` 루트(호환) + `agent-context/v2/`(선호) + `legacy/v1/`(스냅샷)이 공존.
- **빌드 집계는 JSON 구문 검사만**, 스키마 검증은 런타임 테스트로 분리 → 잘못된 부품 정의가 빌드 시점에 안 잡힘.
- `source-claims.json` **수동 관리**(자동 수집 메커니즘 없음) → 부품 추가 시 이중 작업.
- `safety-limits.json`(기계가독) ↔ `safety-policy.md`(문서) **동기화 장치 없음**.

---

## 5. 테스트 전략 분석 (tests/, 17,036줄)

### 5.1 단위 테스트 (`tests/unit/`, 약 40개)

JS는 Node `--test`, TS는 `tsx --test`로 실행(`test:unit`). 커버 범위:
- **에이전트 워크플로/스키마**: `agentWorkflow.test.ts`, `agentSchemas.test.ts`, `agentErrorResponse.test.ts`, `placementResolver.test.ts`(다수 회로 케이스 E2E 검증).
- **컨텍스트**: `contextRouting`, `contextPacket(+Capability)`, `contextLayer(+Structure)`, `contextCoverage`, `contextV2Architecture`, `contextV2Audit`, `contextSufficiencyEval`, `generalizationEval`.
- **회로/시뮬**: `stageScene`, `circuitInspector`, `circuitTutor`, `circuitMetadata`, `renderWarnings`.
- **공유/i18n/카피**: `shareSnapshot`, `shareImport`, `shareSchemas`, `shareStore`, `i18n`, `koreanCopy`, `interviewEngine`, `conversationRouting`.

### 5.2 E2E 테스트 (`tests/e2e/`, Playwright)

- `demo.spec.js`: **오프라인 경계** 데모 전 경로(웰컴→데모 로드→입력→AI 응답→Files md→PCB 3D→Run→OLED 텍스트). **캔버스 픽셀 검사로 빈 3D 무대 차단**(AGENTS.md 계약).
- `features.spec.js`: 다중 회로 케이스 × 스테이지 상호작용 매트릭스(최대 규모).
- `live-agent.spec.js`: 라이브 API 끝-끝(`RUN_LIVE_E2E=1` 필요), 안전성 거부 시나리오(220V 히터 거부) 포함.
- `playwright.config.js`: fullyParallel, workers 4(로컬)/2(CI), desktop+mobile chromium, 120s 타임아웃, 앱+에이전트 2개 웹서버 병렬 기동.

### 5.3 테스트 전략 평가

✅ **mock/캐시 기본, 라이브는 opt-in**(AGENTS.md 보안 계약 준수). 결정적 도구(검증/전류/렌더/시뮬) 충실 커버.
⚠️ **빈틈**: 한국어 안전 정책 거부 시나리오 부족, 모바일 터치 상호작용 얕음, e2e 재시도 부재(플레이키 위험), 개별 부품 전기 한계 테스트 부재.

---

## 6. 빌드 / 툴링 분석 (scripts/)

| 스크립트 | 역할 |
|----------|------|
| `buildContextAggregate.mjs` | 소스→집계 JSON 빌드/검사(ID중복·순서 게이트) |
| `checkContextAggregates.mjs` | 4개 도메인 집계 일괄 검증 |
| `generate_e2e_word_assets.ts` | 12 케이스 E2E Word 자산 생성(도구 직접 호출) |
| `generate_hardware_evidence.mjs` | 브라우저 드래그 조정 증거 스크린샷 캡처 |
| `build_e2e_word_doc.py` / `build_hardware_evidence_doc.py` | Python으로 Word/PDF 산출 |

**검증 게이트** `npm run check` = `test:unit` → `typecheck` → `build` → `test:e2e` (AGENTS.md가 goal-mode 수용 게이트로 명시). `check:live`는 라이브 포함.

**부채**: mjs/ts/py 스크립트 혼재로 빌드 오류 추적 분산, 컨텍스트 검증이 빌드 스크립트와 런타임 테스트로 분산, 라이브 전환이 환경변수(RUN_LIVE_E2E/H_EDUWARE_AGENT_MODE) 기반이라 CI 구성 취약.

---

## 7. 문서 분석 (docs/ 86개, Spec/ 5개)

### 7.1 Spec/ (바인딩 사양)

- `H-eduware_master_statement.md`: **제품 정체성·스코프 단일 소스 오브 트루스**(AGENTS.md가 바인딩으로 지정).
- `H-eduware_design_system.md`: Cohere 파생 시각 언어(색/타이포/컴포넌트) — 바인딩.
- `flux_ai_ui_ux_analysis.md`: 레이아웃 참조 전용.
- `H-eduware_agent_context_layer.md`, `H-eduware_deepagents_v2_requirements.md`: 컨텍스트/에이전트 v2 사양.

### 7.2 docs/ 주요 문서

`superpowers/plans/`(13개+ RALPLAN 로드맵), `coworking_handoff_2026-05-31.md`(공유 핸드오프), `context_layer_sufficiency_audit.md`(일반화 충분성 감사 — "구조는 맞으나 광범위 일반화엔 미흡" 결론), `solver_gate_design.md`, `korean_ux_copy_style_guide.md`, e2e/evidence Word·PDF·PNG 자산.

### 7.3 문서 부채

- **SSOT 분산**: Spec/ + docs/ + 루트(`web_uiux_visual_audit_framework.md`, `webapp-ui-audit-agent-spec.md`)의 3층.
- 대형 바이너리 Word 문서 2개(합 ~900KB) → diff 불가.
- 다수 문서 타임스탬프가 `2026-05-31`에 고정 → 일부 stale 가능.
- git status상 `web_uiux_visual_audit_framework.md`는 **삭제(D)됨**, `webapp-ui-audit-agent-spec.md`는 **미추적(??)** — 문서 재편 진행 중.

---

## 8. 보안 점검 요약

| 항목 | 상태 |
|------|------|
| API 키 커밋 | AGENTS.md 금지 명시, 공유 스냅샷에 redaction 패턴 내장 → ✅ |
| 공유 path traversal | shareId 정규식+경로 prefix 이중검증 → ✅ |
| CORS | localhost 포트 화이트리스트 하드코딩 → ✅(데모 범위) |
| env 검증 | 시작 시 미검증, 첫 요청 시 실패 → ⚠️ 운영성 |
| 에러 메시지 노출 | 원문 전파 가능 → ⚠️ 정보 유출 소지 |
| 로그 시크릿 | 기본 `silent`, 시크릿 미출력 계약 → ✅ |

---

## 9. 스코프 드리프트 관찰 (중요)

`master_statement`와 `AGENTS.md`는 **"하나의 OLED 데모, 일반 회로 시뮬레이터 아님"** 을 해커톤 경계로 못박았다(AGENTS.md L88). 그러나 실제 코드는:
- `capability-graph.json`이 27개+ 하드웨어 기능을 매핑,
- `agentWorkflow.test.ts`/`generate_e2e_word_assets.ts`가 LCD·부저·RGB·서보·모터·LDR·초음파·DHT·7세그·매트릭스·neopixel·TFT 등 광범위 케이스를 검증/생성,
- Deepagents v2 + 컨텍스트 소스 번들 + solver gate로 **일반화 시뮬레이터로 확장 중**.

이 확장은 야심차지만, `context_layer_sufficiency_audit.md`의 자체 결론대로 **"starter-kit 수직화는 충분하나 광범위 일반화엔 미달"** 이며 v1↔v2 마이그레이션·시뮬레이션 프리미티브(현재 5종) 부족이 병목이다. 즉, **선언된 스코프(데모)와 구현 야망(일반화) 사이에 갭**이 존재한다.

---

## 10. 종합 평가 및 권고

### 10.1 강점
1. 다층 검증 게이트 + candidate-part 경계 강제(컨텍스트 밖 부품 합성 차단) — 교육 도구로서 신뢰성 핵심.
2. Zod 전 입출력 스키마, 결정적 mock 테스트와 라이브 opt-in 분리.
3. 오프라인 인터뷰 엔진으로 무대 시연 안정성 확보.
4. 한/영 i18n, 공유 redaction, path traversal 방어 등 기본기 견고.
5. 소스-클레임 기반 추적성(제조사 공식 출처까지 연결).

### 10.2 개선 우선순위
| 우선 | 항목 | 권고 |
|------|------|------|
| 🔴 1 | `main.js` 분할 | 탭/패널 단위 렌더러 모듈화, 상태를 UI/3D/시뮬/인터뷰로 분리 |
| 🔴 2 | DOM 전체 재생성 | 증분 갱신 또는 경량 diff 도입(포커스/스크롤 보존) |
| 🔴 3 | env 시작 시 검증 | 서버 부팅 시 필수 env 확인 + 명확한 실패 메시지 |
| 🟠 4 | 컨텍스트 v1↔v2 통합 | 마이그레이션 완료, legacy 제거 일정 수립 |
| 🟠 5 | Requirement Analysis mock 경로 | 라이브 의존 제거, 결정적 테스트 가능화 |
| 🟠 6 | 빌드 시 스키마 검증 | 집계 빌드에 Zod 스키마 검사 통합 |
| 🟡 7 | 스코프 정렬 | 선언 스코프(데모) vs 구현(일반화) 갭을 문서/로드맵에 명시 |
| 🟡 8 | 문서 SSOT 통합 | Spec/docs/루트 3층 정리, 대형 Word→마크다운 전환 |
| 🟡 9 | 한국어 평가/안전 테스트 보강 | 한국어 거부 시나리오·평가셋 추가 |

---

## 부록 A. 정량 메트릭 (검증값)

| 항목 | 값 |
|------|-----|
| 프런트엔드 JS | 12,582줄 / 26 모듈 |
| 백엔드 TS | 20,744줄 / 32 파일 |
| 테스트 | 17,036줄 / 42 파일 |
| 최대 파일 | `server/context/contextPacket.ts` (3,673줄) |
| 차순위 | `src/main.js`(2,743), `stageScene.js`(2,026), `deepAgentRuntime.ts`(1,632), `schemas.ts`(1,116) |
| agent-context 파일 | 363 |
| docs 파일 | 86 |
| 추적 파일 총계(git ls-files) | 570 |

## 부록 B. 핵심 파일 빠른 참조

- 서버 진입점: `server/index.ts`
- 에이전트 오케스트레이션: `server/agent/deepAgentRuntime.ts`
- 도구 정의: `server/agent/deepAgentTools.ts`, `server/agent/circuitTools.ts`
- 컨텍스트 구성: `server/context/contextPacket.ts`, `contextLayer.ts`
- 프런트 진입점: `src/main.js`
- 3D 무대: `src/stageScene.js`
- 에이전트 통신: `src/aiClient.js`
- 빌드 게이트: `scripts/checkContextAggregates.mjs`, `package.json`(`check`)
- 제품 사양(바인딩): `Spec/H-eduware_master_statement.md`, `Spec/H-eduware_design_system.md`
- 운영 메모리: `AGENTS.md`, `agent-context/index.md`

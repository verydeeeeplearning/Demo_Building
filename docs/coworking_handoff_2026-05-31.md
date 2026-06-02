# H-eduware Coworking Handoff

## 2026-06-01 Share Acceptance Cleanup

This checkpoint closes the remaining public-sharing MVP acceptance gaps around blank-project behavior and public share i18n coverage.

Changed files:

- `src/main.js`
  - The top-bar Share button is now disabled until `state.projectLoaded === true`.
  - `openShareModal()` also exits early when no project is loaded.

- `src/shareView.js`
  - Public share copy now uses the shared i18n dictionary via `t('publicShare.*')`.
  - Removed the private copy table from the view module.

- `src/locales/ko.js`, `src/locales/en.js`
  - Added `publicShare.*` keys for loading, error, validation, simulation, parts, context, and CTA copy.

- `tests/unit/i18n.test.js`
  - Added coverage for Share and public Share keys in Korean and English.

- `tests/e2e/features.spec.js`
  - Updated the Share modal flow to assert the Share button is disabled on a blank project before loading a demo.

Verification:

```powershell
node --test tests/unit/i18n.test.js
npx playwright test tests/e2e/features.spec.js -g "share button|public share link" --project=desktop-chromium --timeout=60000
npm run build
```

Result:

- i18n targeted unit tests: 3/3 passed.
- Targeted Share/public-share E2E: 2/2 passed.
- Production build passed.

Remaining share work:

- No known MVP share acceptance item remains open in the public sharing plan.

## 2026-06-01 Public Share PNG Card Export

This checkpoint completes the PNG share-card slice of the public sharing plan. Students can now save a 1200x630 image card for a validated circuit from the Share modal.

Changed files:

- `src/shareCard.js`
  - Added `createShareCardModel(snapshot, locale)`.
  - Added `renderShareCardCanvas(snapshot, locale, canvas)`.
  - Added `downloadShareCard(snapshot, locale, fileName)`.
  - The Canvas 2D card includes H-eduware branding, title, summary, validation badge, up to five parts, simulation explanation, and footer copy.
  - Card-visible strings are redacted through the existing share redaction path.

- `src/shareModal.js`
  - Added `data-testid="share-download-card"` action.
  - The action saves a PNG using the sanitized current share snapshot.

- `src/locales/ko.js`, `src/locales/en.js`
  - Added image export copy: `이미지 저장` / `Save image`.

- `tests/unit/shareCard.test.js`
  - Covers 1200x630 card model shape, visible fields, bounded parts, and secret redaction.

- `tests/e2e/features.spec.js`
  - Extends the Share modal flow to download the PNG.
  - Parses the downloaded image with `pngjs`, asserts 1200x630 dimensions, and checks that the image is not blank.

Verification:

```powershell
node --test tests/unit/shareCard.test.js
npx playwright test tests/e2e/features.spec.js -g "share button" --project=desktop-chromium --timeout=50000
npm run build
```

Result:

- Share card unit tests: 2/2 passed.
- Targeted Share modal E2E: 1/1 passed.
- Production build passed.

Remaining share work:

- Closed in the Share Acceptance Cleanup checkpoint above.

## 2026-06-01 Public Share Read-Only View And Import

This checkpoint makes generated share links usable by external viewers. A `?share=<id>` URL now renders a read-only public project page and can import the shared circuit into the local app session.

Changed files:

- `src/shareView.js`
  - Added read-only public share rendering for loading, error, and ready states.
  - Shows title, summary, validation state, simulation explanation, parts, concise context evidence, and CTAs.
  - Does not render the live AI chat/workbench while in public share mode.

- `src/shareImport.js`
  - Added `projectFromShareSnapshot(snapshot, locale)`.
  - Converts curated public snapshots into the existing `{ circuit, files }` project shape.
  - Preserves requirement Markdown as `shared-requirements`.
  - Preserves render plan parts/connections when available.
  - Normalizes render-plan connections so inspector/tutor code receives `education.label/title/what`.
  - Marks imported circuits with `source: "imported"` and never enables simulation for invalid snapshots.

- `src/main.js`
  - Detects `?share=<id>` at startup.
  - Loads the snapshot via `readPublicShare()`.
  - Renders the public share view before the normal workbench.
  - Adds "Start from this circuit" import behavior, opening the imported project on the PCB tab with Run stopped.
  - Adds "Create my own circuit" behavior from the public page.

- `src/styles.css`
  - Added public share page layout and responsive details grid.

- `tests/unit/shareImport.test.js`
  - Covers valid import conversion and invalid non-running draft behavior.

- `tests/e2e/features.spec.js`
  - Added public share E2E with mocked `GET /api/share/projects/:id`.
  - Verifies read-only page render, hidden AI panel, validation/parts/simulation content, and import into the local app.

Verification:

```powershell
node --test tests/unit/shareImport.test.js
npx playwright test tests/e2e/features.spec.js -g "public share link|share button" --project=desktop-chromium --timeout=50000
npm run build
```

Result:

- Share import unit tests: 2/2 passed.
- Targeted public/share E2E: 2/2 passed.
- Production build passed.

Remaining share work:

- Resolve the product decision around blank-project Share: disabled button vs current empty-state modal.
- Add fuller i18n key coverage for public share copy.

## 2026-06-01 Public Sharing Frontend Snapshot And Link Modal

This checkpoint connects the share modal to a curated frontend snapshot and the server-backed share API. It did not finish the whole sharing plan by itself; the public read-only `?share=<id>` and import/remix slice is documented in the checkpoint above, while PNG card generation remains open.

Changed files:

- `src/shareSnapshot.js`
  - Added `createShareSnapshot(project, options)` to project the current app state into a bounded public artifact.
  - Added `createShareMarkdown(snapshot, locale)` for portfolio-style Markdown copy.
  - Added `redactShareText(value)` and recursive sanitization so API key patterns, env var names, local secret paths, raw `agentEvents`, raw chat messages, and raw `contextTrace` are excluded.
  - Invalid/unsupported projects are never labelled as valid working circuits.

- `src/shareClient.js`
  - Added `createPublicShare(snapshot)` and `readPublicShare(shareId)`.
  - Uses the same `hEduwareAgentApiBase` localStorage override as the agent client, defaulting to `http://127.0.0.1:8787`.
  - Adds request timeout and typed `ShareClientError` failures.

- `src/shareModal.js`
  - Replaced the summary-only modal with snapshot-backed Markdown copy, JSON export, public-link creation, and link copy.
  - Link creation calls `POST /api/share/projects` through `createPublicShare()`.
  - API failure leaves Markdown and JSON actions available.

- `src/main.js`
  - `openShareModal()` now passes the current project and source (`agent` or `demo`) into the modal.

- `src/locales/ko.js`, `src/locales/en.js`
  - Added share link and JSON export copy.

- `src/styles.css`
  - Added share link input/result styling.

- `tests/unit/shareSnapshot.test.js`
  - Covers validated project projection, secret redaction, internal field exclusion, unsupported/invalid status handling, Markdown copy, and redaction helper behavior.

- `tests/unit/shareClient.test.js`
  - Covers create/read API calls, API base override, response unwrapping, and typed safe errors.

- `tests/e2e/features.spec.js`
  - Extends the share modal browser flow to mock `POST /api/share/projects`, click "공개 링크 만들기", assert the returned `?share=<id>` URL is shown, and assert the posted snapshot excludes raw internal/private fields and secret markers.

Verification:

```powershell
node --test tests/unit/shareSnapshot.test.js tests/unit/shareClient.test.js
npx playwright test tests/e2e/features.spec.js -g "share button" --project=desktop-chromium --timeout=30000
npm run typecheck
npm run build
```

Result:

- Share snapshot/client unit tests: 8/8 passed.
- Targeted share E2E: 1/1 passed.
- Typecheck passed.
- Production build passed.

Remaining share work:

- Decide whether blank-project Share should be disabled or keep the current empty-state modal.
- Add PNG share card generation.
- Run the full `npm run check` after the next verification pass.

## 2026-06-01 Public Sharing Server Boundary

This checkpoint starts implementing the public circuit sharing plan. It closes the backend data boundary first so frontend sharing can build from a curated, schema-validated snapshot instead of dumping raw agent results.

Changed files:

- `server/share/shareSchemas.ts`
  - Added `ShareSnapshotSchema`, `ShareCreateRequestSchema`, `ShareCreateResponseSchema`, `ShareReadResponseSchema`, and `StoredShareSchema`.
  - Snapshot fields are bounded and curated: title, summary, status, circuit components/connections, validation summary, simulation summary, optional render plan, and concise context evidence.

- `server/share/shareStore.ts`
  - Added file-backed local share storage under `.local/shared-projects`.
  - Creates 128-bit opaque hex ids with `crypto.randomBytes(16).toString('hex')`.
  - Rejects share ids outside `/^[a-f0-9]{32}$/` before resolving file paths.
  - Reads unknown valid ids as `null`, so the API can return 404 safely.

- `server/index.ts`
  - Added `POST /api/share/projects`.
  - Added `GET /api/share/projects/:shareId`.
  - Generated share URLs use `H_EDUWARE_PUBLIC_APP_URL` when configured and default to `http://127.0.0.1:4173/?share=<id>`.
  - Existing JSON/CORS response path is reused; route handlers do not log snapshot content.

- `tests/unit/shareSchemas.test.ts`
  - Covers valid snapshots, oversized public strings, invalid status, API response schema, and missing required fields.

- `tests/unit/shareStore.test.ts`
  - Covers create/read round trip, persisted JSON, unknown ids, and path traversal/id-shape rejection.

- `docs/superpowers/plans/2026-05-31-public-circuit-sharing.md`
  - Marked Tasks 1-3 complete and added implementation notes.

Verification:

```powershell
npm exec -- tsx --test tests/unit/shareSchemas.test.ts tests/unit/shareStore.test.ts
npm run typecheck
npm run check
```

Result:

- Share schema/store targeted tests: 6/6 passed.
- Typecheck passed.
- Full gate passed: 65 JavaScript unit tests, 138 TypeScript unit tests, production build, and Playwright E2E 44 passed / 8 skipped.
- Agent server restarted after `server/index.ts` changed.
- `/api/agent/health`: `ok=true`, `mode=live`, `model=gpt-5.5`, `sourceStatus.stale=false`.
- Route smoke: `POST /api/share/projects` returned status 200, a 32-character hex id, and a local share URL; `GET /api/share/projects/:shareId` returned the stored snapshot with matching id.
- Route smoke: unknown valid ids return 404; invalid ids return 400 with a safe error message.

Next share implementation slice:

- Add `src/shareSnapshot.js` with redaction and curated frontend projection tests.
- Connect `src/shareModal.js` to Markdown/JSON/link actions backed by the new API.
- Then add the `?share=<id>` public read-only page and import adapter.

## 2026-06-01 Opt-in Live Tutor And Korean Tutor Copy Guard

This checkpoint tightens the simulation-side circuit tutor, which answers questions about the currently selected wire, part, or current path.

Changed files:

- `server/agent/circuitTutor.ts`
  - Default route remains deterministic `mode: local`.
  - `H_EDUWARE_TUTOR_MODE=live` enables the Deepagents tutor path only when explicitly opted in.
  - Live tutor failures fall back to the grounded local answer instead of surfacing raw agent errors.
  - Korean intent detection now recognizes `전류`, `흐름`, `흘러`, `빠지면`, `없으면`, `누락`, and related wording.
  - Local Korean tutor copy now uses readable student-facing Korean for current-flow, missing-wire, and check/verify questions.

- `tests/unit/circuitTutor.test.ts`
  - Added injected-provider coverage proving opt-in live mode can return `mode: live` without changing the default local path.
  - Added fallback coverage proving live tutor failures return `mode: local`.
  - Added Korean current-flow and missing-wire regression tests to prevent the selected-target tutor from falling back to English default copy or mojibake.

- `docs/superpowers/plans/2026-05-31-circuit-inspector-tutor-agent.md`
  - Added the implementation note and targeted verification evidence for this checkpoint.

Verification so far:

```powershell
npm exec -- tsx --test tests/unit/circuitTutor.test.ts
npm run check
```

Result:

- 7/7 circuit tutor unit tests passed.
- Full gate passed: 65 JavaScript unit tests, 132 TypeScript unit tests, typecheck, production build, and Playwright E2E 44 passed / 8 skipped.
- Agent server restarted on port 8787 after the server-side tutor change.
- `/api/agent/health` returned `ok=true`, `mode=live`, `model=gpt-5.5`, and `sourceStatus.stale=false`.
- `/api/agent/explain-target` Korean smoke for `전류가 어떻게 흘러?` returned local grounded Korean current-flow copy, did not fall back to English default target text, and had no mojibake.

Residual risk:

- Live tutor generation remains opt-in through `H_EDUWARE_TUTOR_MODE=live`; default product/test behavior remains deterministic local tutor fallback.

## 2026-06-01 Responsive Chat Drawer Polish

이번 변경은 시뮬레이션 화면에서 하드웨어 설명 패널과 회로 질문 chat drawer가 데스크톱/모바일에서 더 명확하게 분리되도록 보강한 작업이다.

변경 사항:

- `tests/e2e/features.spec.js`
  - `circuit chat drawer stays separate from hardware on desktop and compact on mobile` E2E를 추가했다.
  - 데스크톱에서는 tutor chat drawer가 right rail 안에 머물고, 선택된 하드웨어 설명 카드 아래에 열리는지 확인한다.
  - 모바일에서는 drawer의 computed `max-height`가 viewport의 64% 이하이고, 화면 하단 bottom sheet로 열리는지 확인한다.
- `src/styles.css`
  - 모바일 `.circuit-chat-drawer`의 `max-height`를 `min(62vh, 560px)`로 줄였다.
  - 모바일 drawer 상단 radius를 키워 bottom sheet처럼 읽히게 했다.

RED/GREEN:

- RED: `npm run test:e2e -- --grep "circuit chat drawer stays separate"`가 mobile에서 실패했다. 원인은 drawer computed `max-height=685px`로, 화면 대부분을 덮을 수 있는 상태였다.
- GREEN: CSS 보정 후 같은 명령이 desktop/mobile 2개 프로젝트에서 통과했다.

브라우저 실측:

- 모바일 viewport `393x727`.
- drawer `x=12`, `y=264.27`, `width=369`, `height=450.73`, `maxHeight=450.74px`, `position=fixed`.
- stage canvas와 hardware rail 상태를 유지한 채 chat drawer가 하단 bounded sheet로 열렸다.

최종 검증:

- `npm run check` passed.
- JavaScript unit tests: 65 passed.
- TypeScript unit tests: 128 passed.
- Typecheck/build: passed.
- Playwright E2E: 44 passed, 8 opt-in live tests skipped.
- Agent health: `ok=true`, `mode=live`, `model=gpt-5.5`, `provider=openai`, `sourceStatus.stale=false`.

## 2026-06-01 Korean Preflight Copy Cleanup

이번 변경은 Deepagents preflight 단계에서 한국어 학생에게 영어 내부 문구나 깨진 문자열이 노출되는 문제를 줄인 작업이다.

변경 사항:

- `server/agent/deepAgentRuntime.ts`
  - visual-only/context-gap preflight assistant message를 한국어 학생-facing 문구로 분리했다.
  - unsafe preflight assistant message도 자연스러운 한국어 안전 안내로 생성한다.
  - 한국어 support-gap clarification은 “현재 지원되는 회로를 선택하거나, 부품 정보/검증/렌더링/시뮬레이션 자료를 먼저 추가해야 한다”는 식으로 설명한다.
  - 한국어 응답에서 `canonical context`, `validated synthesis`, `Missing support evidence` 같은 내부 문구를 노출하지 않도록 테스트했다.

추가 테스트:

- `tests/unit/agentWorkflow.test.ts`
  - `Korean visual-only context gaps return student-friendly Korean copy`
  - `Korean unsafe preflight returns readable safety copy without mojibake`

검증:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
```

결과:

- Agent workflow target tests: 58 passed.
- Full acceptance gate: `npm run check` passed with 65 JavaScript unit tests, 128 TypeScript unit tests, production build, and 42 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- Agent server health after restart: `ok=true`, `mode=live`, `model=gpt-5.5`, `provider=openai`, `sourceStatus.stale=false`.
- Live smoke, visual-only 한국어 요청 `Arduino Nano로 LED를 깜빡이고 싶어.`: `validationStatus=unsupported`, `simulationStatus=unsupported`, render part 0개, current path 0개, `contextCoverage.status=insufficient`, `synthesisEligibility=ineligible`, 내부 영어 문구 없음, mojibake 없음.
- Live smoke, unsafe 한국어 요청 `브레드보드로 220V 콘센트 히터를 제어하고 싶어.`: `validationStatus=unsupported`, `simulationStatus=unsupported`, render part 0개, current path 0개, `contextCoverage.status=insufficient`, `synthesisEligibility=ineligible`, 내부 영어 문구 없음, mojibake 없음.

## 2026-06-01 Visual-Only Hardware Context Gating

이번 변경은 학생이 부품 라이브러리에 보이는 임의 하드웨어를 요청했을 때, agent가 이를 지원 가능한 회로로 오해하지 않도록 context routing을 보강한 작업이다.

변경 사항:

- `server/context/contextLayer.ts`
  - `detectVisualLibraryPartMentions()`를 추가했다.
  - broad visual parts library의 부품명/id를 감지하고, `visual-library-crosswalk.json`에 매핑된 agent-ready 부품인지 visual-only 부품인지 구분한다.
- `server/context/contextPacket.ts`
  - visual-only mention을 `supportGaps`에 추가한다.
  - `Visual library hardware mentions`를 prompt block에 포함한다.
  - matched visual part trace를 `registry:visual-library:<id>`로 남긴다.
  - 예: `Use an Arduino Nano to blink an LED`는 LED behavior 자체는 supported로 match되더라도 `arduino-nano`가 visual-only라서 `valid_circuit_synthesis`가 차단된다.
  - 예: `ESP32 DevKit and DHT11 temperature sensor`는 vague clarification이 아니라 visual-only support gap으로 분류된다.

추가 테스트:

- `tests/unit/contextCoverage.test.ts`
  - `visual-only library hardware blocks otherwise supported synthesis until context is promoted`
  - `visual-only random hardware requests are explicit support gaps, not vague missing-intent prompts`

검증:

```powershell
npm exec -- tsx --test tests/unit/contextCoverage.test.ts
```

결과:

- Context coverage target tests: 20 passed.
- Related context/generalization target tests: 35 passed.
- `npm run typecheck`: passed.
- `npm run check`: passed.
  - JavaScript unit tests: 65 passed.
  - TypeScript unit tests: 126 passed.
  - typecheck: passed.
  - build: passed.
  - Playwright E2E: 42 passed, 8 skipped.
- Agent server restart 후 health: `ok=true`, `mode=live`, `model=gpt-5.5`, `sourceStatus.stale=false`.
- Live endpoint smoke: `Use an Arduino Nano to blink an LED.` 요청은 `validationStatus=unsupported`, `simulationStatus=unsupported`, render part 0개, current path 0개, `contextCoverage.status=insufficient`, `arduino-nano` visual-only support warning으로 종료된다.

## 2026-06-01 Simulation Block Explanation Surfacing

이번 변경은 브레드보드 물리/연속성/레일 DRC 때문에 Run 전류 애니메이션이 차단될 때, 학생이 이유를 확인할 수 있도록 설명 경로를 보강한 작업이다.

변경 사항:

- `server/agent/circuitTools.ts`: `compileRequirementMarkdown()`의 Safety And Validation Notes에 `simulationPlan.warnings`를 포함한다. 논리 회로 validation은 `valid`지만 render DRC 때문에 simulation이 `invalid`인 경우에도 `SIMULATION_BLOCKED_BY_RENDER_DRC`와 원본 DRC 코드가 요구사항 문서에 남는다.
- `server/agent/circuitTutor.ts`: current-flow 질문에서 validation 또는 simulation이 valid가 아니면 `validationReport.status`, `simulationPlan.status`, 첫 번째 simulation-blocking warning을 함께 설명한다. grounding에는 `simulation-warning:<code>`를 추가한다.
- `src/circuitInspector.js`: 네트워크 tutor endpoint를 쓰지 않는 기본 fallback 경로에서도 현재 circuit의 `simulationPlan.status`와 warning을 읽는다. Run/current 질문이 들어왔고 simulation이 invalid이면 일반 안내 대신 차단 사유를 답한다.

추가 테스트:

- `tests/unit/agentWorkflow.test.ts`: `requirement markdown explains when render DRC blocks current simulation`
- `tests/unit/circuitTutor.test.ts`: `tutor agent explains simulation-blocking render DRC warnings`
- `tests/unit/circuitInspector.test.js`: `circuit tutor explains why Run is blocked by render DRC warnings`

검증:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts tests/unit/circuitTutor.test.ts
node --test tests/unit/circuitInspector.test.js
```

결과:

- TypeScript target tests: 59 passed.
- JavaScript inspector target tests: 7 passed.
- `npm run check`: passed.
  - JavaScript unit tests: 65 passed.
  - TypeScript unit tests: 124 passed.
  - typecheck: passed.
  - build: passed.
  - Playwright E2E: 42 passed, 8 skipped.
- Agent server restart 후 health: `ok=true`, `mode=live`, `model=gpt-5.5`, `sourceStatus.stale=false`.
- Browser smoke: `http://127.0.0.1:4173/`에서 데모 로드 후 canvas 1개, Run 결과 표시, live runtime 표시, raw error/page error/console error 없음.

## 2026-06-01 RALPLAN Roadmap

Context Layer, deterministic validation, and Deepagents workflow improvements now have an approved ralplan document:

- `docs/superpowers/plans/2026-06-01-context-validation-deepagents-workflow.md`
- Source planning record: `.omx/plans/2026-06-01-context-validation-deepagents-workflow.md`
- Context snapshot: `.omx/context/context-validation-deepagents-workflow-20260531T171714Z.md`

Key decision: valid circuit synthesis must be separated from clarification/unsupported/refusal response sufficiency. Deepagents tools must become context-bound so tool-visible validation cannot contradict final server-side context coverage gating.

## 2026-06-01 Multi-Output Context/Simulation Promotion

This slice removes the known `model-synthesis-gap` for the `button-led-buzzer` prompt family without broadening hardware support beyond the existing canonical agent-ready parts.

What changed:

- `agent-context/electrical/topology-templates.json` now includes `controller-digital-input-switch-plus-multiple-outputs`, a role-based topology for one switch input, one current-limited DC load, one direct low-current load, and common ground.
- `server/agent/circuitTools.ts` now aggregates simulation contexts across output components. `inferCurrentPathIds()`, `estimateCurrentPaths()`, and expected-state inference can include both LED and buzzer outputs in one validated circuit.
- `agent-context/evals/context-sufficiency-prompts.jsonl` promotes `button-led-buzzer` from `expectedFailureClass: "model-synthesis-gap"` to `expectedFailureClass: "none"` and from `record-failure-class-and-context-evidence` to `render-and-run-valid-simulation`.
- `tests/unit/agentWorkflow.test.ts`, `tests/unit/generalizationEval.test.ts`, and `tests/unit/contextQaArtifactBundle.test.ts` now cover composite topology selection, two validated current paths, zero remaining `model-synthesis-gap` rows, and browser verification-plan promotion.

Verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts tests/unit/generalizationEval.test.ts tests/unit/contextQaArtifactBundle.test.ts
npm run typecheck
npm run eval:generalization:report
npm run audit:capabilities
```

Observed evidence:

- Targeted unit suite: 38 passed.
- Typecheck: passed.
- Generalization report: `byExpectedFailureClass.none = 8`, `byObservedFailureClass.none = 8`, `model-synthesis-gap = 0`.
- Capability audit still keeps the same 5 supported capabilities ready and leaves planned/unsupported capabilities blocked by data-first artifact gaps.

Next caution: this is composition of already-supported parts, not promotion of a new hardware family. Future multi-LED, multi-buzzer, or multi-resistor cases need per-load pairing logic before they can be claimed as valid synthesis.

## 2026-06-01 Repeated Output Passive Pairing

This slice follows up on multi-output support by fixing the repeated-same-part case: two LEDs with two resistors must not collapse into one current path or reuse the first resistor.

What changed:

- `server/agent/circuitTools.ts`
  - Current path compilation now disambiguates duplicate template ids by target component id only when duplicates exist.
  - Required passive parts are resolved from the actual endpoint path into each target output instead of using the first matching part id.
  - LED validation now records the resistor found in each LED series path and rejects one resistor shared across multiple LED loads with `LED_RESISTOR_SHARED`.
- `tests/unit/agentWorkflow.test.ts`
  - Added a positive two-LED/two-resistor circuit proving the current paths stay paired as `led-forward-current:led-1` and `led-forward-current:led-2`.
  - Added a negative shared-resistor case proving the validator blocks ambiguous current limiting and produces no current paths.

Verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
npm run typecheck
```

Observed evidence:

- Agent workflow targeted suite: 34 passed.
- Typecheck: passed.

## 2026-06-01 Korean Context Routing Hardening

This slice makes Korean student wording route through the same context-first support contract as English prompts, without promoting any new hardware family.

What changed:

- `server/context/capabilityGraph.ts` now expands Hangul token variants by trimming common particles/endings, so natural phrases such as `가변저항으로`, `밝기를`, and `조절하고` match canonical capability phrases.
- `server/context/contextPacket.ts` uses readable active Korean hardware keywords and unsafe-pattern lists for query expansion, intent hints, candidate part selection, and unsupported signal detection.
- `agent-context/evals/context-sufficiency-prompts.jsonl` adds Korean eval rows for valid button + LED + buzzer synthesis and planned potentiometer LED dimming support gaps.
- `tests/unit/contextRouting.test.ts` now covers Korean button + LED + buzzer, Korean planned potentiometer LED dimming, and Korean servo PWM routing.
- Generalization and QA artifact tests now avoid hardcoded corpus totals, so future prompt-family rows can expand the eval corpus deliberately.

Verification:

```powershell
npm exec -- tsx --test tests/unit/contextRouting.test.ts tests/unit/contextSufficiencyEval.test.ts tests/unit/generalizationEval.test.ts tests/unit/contextQaArtifactBundle.test.ts
npm run typecheck
```

Observed evidence:

- Targeted context/generalization/QA suite: 15 passed.
- Typecheck: passed.

## 2026-06-01 Render Placement DRC

This slice starts addressing browser-visible hardware mismatch by checking whether validated render plans are physically plausible on the breadboard before students trust the visualization.

What changed:

- `server/agent/circuitTools.ts`
  - `compileRenderPlan()` now runs a placement DRC pass after footprint attachment.
  - Breadboard-compatible parts emit `BREADBOARD_PLACEMENT_OUT_OF_BOUNDS` when their footprint bounds are outside the breadboard outline.
  - Breadboard-compatible parts emit `BREADBOARD_PLACEMENT_SURFACE_MISSING` when a valid electrical circuit omits the breadboard placement surface.
- `src/renderWarnings.js`
  - Korean render warning copy is now readable UTF-8 text.
  - Common render warning codes get student-friendly Korean explanations instead of raw debug-like English fallback copy.
- `tests/unit/agentWorkflow.test.ts`
  - Added regressions for out-of-bounds LED placement and missing breadboard surface warnings.
- `tests/unit/renderWarnings.test.js`
  - Added readable Korean warning Markdown coverage.

Verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
node --test tests/unit/renderWarnings.test.js
npm run typecheck
```

Observed evidence:

- Agent workflow targeted suite: 36 passed.
- Render warning suite: 3 passed.
- Typecheck: passed.

## 2026-06-01 Breadboard-Aware Default Placement

This slice follows the render DRC work by improving the default layout itself, so validated render plans are less likely to start with overlapping or physically implausible breadboard parts.

What changed:

- `server/agent/circuitTools.ts`
  - `compileRenderPlan()` now builds default positions through `planDefaultRenderPositions()`.
  - Explicit `CircuitSpec.component.position` values are still preserved.
  - Unspecified breadboard-compatible parts are packed onto the breadboard using footprint dimensions, breadboard bounds, margin, and row gap.
  - Arduino and servo defaults remain outside/alongside the breadboard according to their footprint placement policies.
- `tests/unit/agentWorkflow.test.ts`
  - Added a many-part render fixture with LEDs, resistors, a tactile button, and a buzzer.
  - The test verifies no `BREADBOARD_PLACEMENT_OUT_OF_BOUNDS` warning is emitted and auto-placed breadboard parts do not overlap.

Verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
npm run typecheck
```

Observed evidence:

- Agent workflow targeted suite: 37 passed.
- Typecheck: passed.

## 2026-06-01 Render Connection DRC

This slice closes the next visualization trust gap: validated circuit specs can still produce misleading visuals if a connection references a pin with no render anchor, or if both ends of a connection collapse to the same rendered point.

What changed:

- `server/agent/circuitTools.ts`
  - `compileRenderPlan()` now compiles endpoint coordinates once, audits every render connection against that endpoint layout, and returns the same endpoint layout in the render plan.
  - Missing render anchors emit `RENDER_CONNECTION_ENDPOINT_MISSING` with the affected component id and endpoint key.
  - Zero-length or near-zero-length wires emit `RENDER_CONNECTION_TOO_SHORT`.
- `src/renderWarnings.js`
  - Korean render warning Markdown now explains connection endpoint and too-short wire problems in student-facing Korean.
- `tests/unit/agentWorkflow.test.ts`
  - Added regressions for a missing render anchor and a same-endpoint connection.
- `tests/unit/renderWarnings.test.js`
  - Added Korean copy coverage for connection DRC warnings.

Verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
node --test tests/unit/renderWarnings.test.js
npm run typecheck
npm run check
```

Observed evidence:

- Agent workflow targeted suite: 39 passed.
- Render warning suite: 4 passed.
- Typecheck: passed.
- Full acceptance gate: `npm run check` passed with 105 TypeScript unit tests, 59 JavaScript unit tests, production build, and 42 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- Agent server restarted on port 8787 after the source change. Health reported `ok=true`, `mode=live`, `model=gpt-5.5`, `sourceStatus.stale=false`.
- Browser smoke at `http://127.0.0.1:4173/` showed Korean project copy, `Deepagents Live · gpt-5.5`, and no stale-server warning.

## 2026-06-01 Breadboard Pin Topology DRC

This slice addresses the next hardware visualization gap: a connection can have valid endpoints and still look physically misleading when a through-hole part places both terminals on the same simplified breadboard row.

What changed:

- `server/agent/circuitTools.ts`
  - Added `auditBreadboardPinTopology()` and wired it into `compileRenderPlan()`.
  - The DRC emits `BREADBOARD_PIN_ROW_COLLAPSE` when a breadboard-compatible part has multiple terminals collapsed onto one row.
- `agent-context/data/render-footprints.json`
  - OLED, LED, resistor, and buzzer pin anchors now occupy distinct breadboard rows instead of using one shared row.
  - This directly changes the render plan endpoint coordinates consumed by the three.js stage.
- `src/renderWarnings.js`
  - Added student-facing Korean copy for `BREADBOARD_PIN_ROW_COLLAPSE`.
- `tests/unit/agentWorkflow.test.ts`
  - Added coverage proving LED and resistor endpoints do not collapse onto one row in a valid LED circuit.
  - Added a crafted bad-footprint DRC regression.
- `tests/unit/renderWarnings.test.js`
  - Added Korean copy coverage for row-collapse warnings.

Verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
node --test tests/unit/renderWarnings.test.js
npm run check
```

Observed evidence:

- Agent workflow targeted suite: 41 passed.
- Render warning suite: 5 passed.
- Full acceptance gate: `npm run check` passed with 107 TypeScript unit tests, 60 JavaScript unit tests, production build, and 42 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- Agent server restarted on port 8787 after the source/context change. Health reported `ok=true`, `mode=live`, `model=gpt-5.5`, `sourceStatus.stale=false`.
- Browser smoke at `http://127.0.0.1:4173/` showed Korean project copy, `Deepagents Live · gpt-5.5`, and no stale-server warning.

## 2026-06-01 Breadboard Grid Snap Context

This slice turns the breadboard coordinate model from prose into machine-readable context and uses it to validate whether rendered through-hole pins actually land near breadboard holes.

What changed:

- `agent-context/rendering/breadboard-grid.json`
  - Added signal-hole rows, rail anchors, x pitch, snap tolerances, coordinate-system metadata, and continuity group labels.
- `agent-context/index.json`
  - Added the `breadboard-grid` context asset entry.
- `server/context/contextAssets.ts` and `server/context/contextLayer.ts`
  - Added and exported `loadBreadboardGrid()`.
- `server/agent/circuitTools.ts`
  - `compileRenderPlan()` now loads the breadboard grid with render footprints.
  - Auto-placed breadboard-compatible parts are snapped to signal-hole grid coordinates.
  - Explicit agent-supplied positions are preserved and checked by DRC.
  - Added `auditBreadboardGridSnap()` and `BREADBOARD_PIN_GRID_MISALIGNMENT`.
  - The auto-placement loop now avoids overlap after grid snapping.
- `agent-context/data/render-footprints.json`
  - LED and button anchors were adjusted to align with the machine-readable grid pitch.
- `src/renderWarnings.js`
  - Added Korean student-facing copy for grid misalignment warnings.
- Tests
  - `tests/unit/contextLayerStructure.test.ts` requires `rendering/breadboard-grid.json`.
  - `tests/unit/contextCoverage.test.ts` validates the grid asset shape via `loadBreadboardGrid()`.
  - `tests/unit/agentWorkflow.test.ts` checks valid LED render endpoints snap to signal holes and bad positions warn.
  - `tests/unit/renderWarnings.test.js` checks Korean grid-misalignment copy.

Verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
npm exec -- tsx --test tests/unit/contextCoverage.test.ts tests/unit/contextLayerStructure.test.ts
node --test tests/unit/renderWarnings.test.js
npm run typecheck
npm run check
```

Observed evidence:

- Agent workflow targeted suite: 43 passed.
- Context coverage/structure targeted suite: 22 passed.
- Render warning suite: 6 passed.
- Typecheck: passed.
- Full acceptance gate: `npm run check` passed with 110 TypeScript unit tests, 61 JavaScript unit tests, production build, and 42 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- Agent server restarted on port 8787 after the source/context change. Health reported `ok=true`, `mode=live`, `model=gpt-5.5`, `sourceStatus.stale=false`.
- Browser smoke at `http://127.0.0.1:4173/` showed Korean project copy, `Deepagents Live · gpt-5.5`, and no stale-server warning.

## 2026-06-01 Breadboard Physical Node DRC

This slice connects the machine-readable breadboard grid to a stronger render DRC: if two through-hole pins visually occupy the same breadboard signal hole, the render plan must either show a logical connection for that shared node or warn the student.

What changed:

- `server/agent/circuitTools.ts`
  - `compileRenderPlan()` now runs `auditBreadboardPhysicalNodeConflicts()` after render endpoint layout and connection compilation.
  - `auditBreadboardPhysicalNodeConflicts()` groups breadboard-compatible pin anchors by physical signal-hole node from `breadboard-grid.json`.
  - The DRC builds a logical graph from render connections and accepts pins sharing a physical node only when their endpoints are connected in that graph.
  - Unconnected pins sharing one physical hole emit `BREADBOARD_PHYSICAL_NODE_CONFLICT`.
- `src/renderWarnings.js`
  - Added Korean student-facing copy for hidden physical breadboard node conflicts.
- Tests
  - `tests/unit/agentWorkflow.test.ts` covers unconnected shared-hole warnings, intentional shared-node acceptance, and render-plan integration for explicit bad positions.
  - `tests/unit/renderWarnings.test.js` covers the Korean warning copy.

Verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
node --test tests/unit/renderWarnings.test.js
npm run typecheck
```

Observed evidence:

- Agent workflow targeted suite: 46 passed.
- Render warning suite: 7 passed.
- Typecheck: passed.
- Full acceptance gate: `npm run check` passed with 62 JavaScript unit tests, 113 TypeScript unit tests, production build, and 42 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- Agent server restarted on port 8787 after the source change. Health reported `ok=true`, `mode=live`, `model=gpt-5.5`, provider `openai`, `sourceStatus.stale=false`.
- Browser smoke at `http://127.0.0.1:4173/` showed Korean project copy, `Deepagents Live · gpt-5.5`, and no stale-server warning.

## 2026-06-01 Render DRC Simulation Gate

This slice prevents a mismatch where Files/PCB can warn about an accidental physical breadboard short while Run still presents a valid current animation.

What changed:

- `server/agent/circuitTools.ts`
  - `compileSimulationPlan()` now accepts an optional `RenderPlan`.
  - Critical render DRC warnings can downgrade a logically valid simulation to `invalid`.
  - `BREADBOARD_PHYSICAL_NODE_CONFLICT` is currently simulation-blocking.
  - Blocked simulations clear current paths and add `SIMULATION_BLOCKED_BY_RENDER_DRC` with the original warning code and message.
- `server/agent/deepAgentRuntime.ts`
  - Server finalization now passes the compiled render plan into `compileSimulationPlan()`.
- `server/agent/deepAgentTools.ts`
  - Deepagents tool artifact compilation now compiles render artifacts before simulation, so tool-visible simulation gating matches final server behavior.
- Tests
  - `tests/unit/agentWorkflow.test.ts` adds a valid button+LED logical circuit whose explicit render positions create a hidden physical node conflict. The test proves logical current paths exist before render gating, then verifies final simulation is invalid with no animated current paths.

Verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
npm run typecheck
```

Observed evidence:

- Agent workflow targeted suite: 47 passed.
- Typecheck: passed.
- Full acceptance gate: `npm run check` passed with 62 JavaScript unit tests, 114 TypeScript unit tests, production build, and 42 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- Agent server restarted on port 8787 after the source change. Health reported `ok=true`, `mode=live`, `model=gpt-5.5`, provider `openai`, `sourceStatus.stale=false`.
- Browser smoke at `http://127.0.0.1:4173/` showed Korean project copy, `Deepagents Live · gpt-5.5`, and no stale-server warning.

## 2026-06-01 Breadboard Row Continuity DRC

This slice extends physical breadboard checks from exact same-hole overlap to row-level continuity groups declared by `agent-context/rendering/breadboard-grid.json`.

What changed:

- `server/agent/circuitTools.ts`
  - Added `auditBreadboardContinuityConflicts()`.
  - The DRC maps breadboard-compatible footprint pins to the nearest signal row `continuityGroup`.
  - Pins in different holes but the same continuity group now warn with `BREADBOARD_CONTINUITY_CONFLICT` when the logical render connection graph does not connect them.
  - Intentional same-row sharing is accepted when the logical net explicitly connects those endpoints.
  - `compileRenderPlan()` now runs continuity DRC after exact physical-node DRC.
  - `BREADBOARD_CONTINUITY_CONFLICT` is simulation-blocking, so hidden row continuity conflicts disable current animation.
- `src/renderWarnings.js`
  - Added Korean student-facing copy for hidden breadboard row continuity conflicts.
- Tests
  - `tests/unit/agentWorkflow.test.ts` covers direct DRC warning/acceptance, render-plan integration, and final simulation blocking for a logically valid button+LED circuit with a hidden continuity conflict.
  - `tests/unit/renderWarnings.test.js` covers the Korean warning copy.

Verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
node --test tests/unit/renderWarnings.test.js
npm run typecheck
```

Observed evidence:

- Agent workflow targeted suite: 51 passed.
- Render warning suite: 8 passed.
- Typecheck: passed.
- Full acceptance gate: `npm run check` passed with 63 JavaScript unit tests, 118 TypeScript unit tests, production build, and 42 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- Agent server restarted on port 8787 after the source change. Health reported `ok=true`, `mode=live`, `model=gpt-5.5`, provider `openai`, `sourceStatus.stale=false`.
- Browser smoke at `http://127.0.0.1:4173/` showed Korean project copy, `Deepagents Live · gpt-5.5`, and no stale-server warning.

## 2026-06-01 Breadboard Rail Continuity DRC

This slice extends physical breadboard checks from signal tie rows to power/ground rails declared by `agent-context/rendering/breadboard-grid.json`.

What changed:

- `server/agent/circuitTools.ts`
  - Added `auditBreadboardRailConflicts()`.
  - The DRC maps breadboard-compatible footprint pins to nearest rail holes and groups them by `+ rail` or `- rail` continuity.
  - Pins in different holes on the same rail now warn with `BREADBOARD_RAIL_CONFLICT` when the logical render connection graph does not connect them.
  - Intentional rail sharing is accepted when the logical net explicitly connects those endpoints.
  - `compileRenderPlan()` now runs rail DRC after signal-hole and signal-row continuity checks.
  - `BREADBOARD_RAIL_CONFLICT` is simulation-blocking, so hidden rail conflicts disable current animation.
- `src/renderWarnings.js`
  - Added Korean student-facing copy for hidden breadboard rail conflicts.
- Tests
  - `tests/unit/agentWorkflow.test.ts` covers direct DRC warning/acceptance, render-plan integration, and final simulation blocking for a logically valid button+LED circuit with a hidden rail conflict.
  - `tests/unit/renderWarnings.test.js` covers the Korean warning copy.

Verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
node --test tests/unit/renderWarnings.test.js
npm run typecheck
```

Observed evidence:

- Agent workflow targeted suite: 55 passed.
- Render warning suite: 9 passed.
- Typecheck: passed.
- Full acceptance gate: `npm run check` passed with 64 JavaScript unit tests, 122 TypeScript unit tests, production build, and 42 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- Agent server restarted on port 8787 after the source change. Health reported `ok=true`, `mode=live`, `model=gpt-5.5`, provider `openai`, `sourceStatus.stale=false`.
- Browser smoke at `http://127.0.0.1:4173/` showed Korean project copy, `Deepagents Live · gpt-5.5`, and no stale-server warning.

Third checkpoint completed on 2026-06-01:

- `server/context/contextLayer.ts` now exposes `auditCapabilityPromotionGaps()`.
- The promotion gap report is machine-readable and aggregates every capability by current support level, recommended support level, readiness for supported promotion, and missing artifact type.
- Missing artifact buckets now make future hardware promotion review concrete: `part-capability`, `pin-aliases`, `validation-rule`, `simulation-primitive`, `render-footprint`, `eval-supported-prompt`, and `eval-unsupported-counterexample`.
- `npm run audit:capabilities` prints the same aggregate report as JSON for coworking reviews and future hardware promotion audits.
- `tests/unit/contextCoverage.test.ts` verifies that the report covers the whole capability graph, keeps planned capabilities out of supported promotion, and exposes planned-family blockers such as missing part capabilities.
- Verified with `npm exec -- tsx --test tests/unit/contextCoverage.test.ts`, `npm run typecheck`, and `npm run check`; result: pass, with 40 Playwright tests passed and 8 opt-in live tests skipped.

Fourth checkpoint completed on 2026-06-01:

- `server/context/generalizationEvalReport.ts` now builds a JSON-ready generalization eval report.
- The report runs every `agent-context/evals/context-sufficiency-prompts.jsonl` row through context routing and records expected/observed failure class, route id, coverage status, matched capabilities, candidate parts, support gaps, unsupported signals, and row-level promotion blockers.
- Planned context-gap rows now explain which missing artifacts block support promotion. For example, `potentiometer-planned` links `analog-led-dimmer` to missing `part-capability`, `validation-rule`, `render-footprint`, and eval evidence.
- `server/context/generalizationEvalReportCli.ts` and `npm run eval:generalization:report` print the report as JSON; the CLI also accepts `--out <path>` for QA artifact capture.
- Verified with `npm exec -- tsx --test tests/unit/generalizationEval.test.ts`, `npm run eval:generalization:report`, `npm run typecheck`, and `npm run check`.

Fifth checkpoint completed on 2026-06-01:

- `server/qa/contextQaArtifactBundle.ts` now creates context evidence bundles in the same directory shape as browser/manual QA runs.
- `npm run qa:context-artifacts -- --run-id <run-id>` writes `generalization-eval-report.json`, `capability-promotion-gaps.json`, `context-qa-summary.md`, and `context-qa-manifest.json` under `qa-artifacts/manual-product-qa/<run-id>/`.
- `docs/browser_generalization_verification.md` now tells QA workers to attach these context artifacts to each manual/browser QA run.
- `tests/unit/contextQaArtifactBundle.test.ts` verifies the bundle contains planned-row promotion blockers and machine-readable promotion gap artifacts.
- Verified with `npm exec -- tsx --test tests/unit/contextQaArtifactBundle.test.ts`, `npm run qa:context-artifacts -- --run-id context-qa-smoke --root .artifacts/qa-smoke`, `npm run typecheck`, and `npm run check`.

Sixth checkpoint completed on 2026-06-01:

- `server/agent/deepAgentRuntime.ts` now separates planned context gaps from safety refusals during preflight.
- Planned capabilities such as potentiometer LED dimming now return before consuming live/scripted Deepagents drafts, but the event is `context-support-gap` rather than `safety-policy`.
- Unsafe or unsupported safety routes such as 220V/high-voltage still use `safety-policy`.
- `tests/unit/agentWorkflow.test.ts` adds a planned potentiometer context-gap regression test that verifies no render/current simulation artifacts are produced and no safety refusal label is used.
- Verified with `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts`, `npm run typecheck`, and `npm run check`; result: pass, with 40 Playwright tests passed and 8 opt-in live tests skipped.

Seventh checkpoint completed on 2026-06-01:

- `src/main.js` now treats `context-support-gap` as a first-class support-readiness event in the chat decision chips.
- Planned context-gap summaries are sanitized before display, so internal phrases such as `canonical context`, `valid synthesis`, `part-capability`, `render-footprint`, and `simulation-primitive` do not appear in student-facing UI.
- `tests/e2e/features.spec.js` adds a planned potentiometer LED dimmer response fixture and verifies that the app blocks build/render/current simulation while showing only student-friendly decision text.
- Verified with `npm run test:e2e -- --grep "planned context gaps"` and `npm run check`; result: pass, with 42 Playwright tests passed and 8 opt-in live tests skipped.

Eighth checkpoint completed on 2026-06-01:

- `agent-context/registry/visual-library-crosswalk.json` now declares which broad UI library entries are truly mapped to canonical agent part capabilities.
- Any visual part omitted from that crosswalk is treated as `visual-only` by policy, so the 132-part browser cannot accidentally expand the synthesis/simulation support surface.
- `server/context/contextLayer.ts` now exposes `auditVisualLibraryExpansion()` and embeds its output in `auditCapabilityPromotionGaps()`.
- `npm run audit:capabilities` now reports `visualLibrary.totalVisualParts`, `canonicalAgentPartCount`, `agentReadyVisualPartIds`, `agentReadyAgentPartIds`, `visualOnlyPartIds`, and `invalidMappings`.
- Current audit snapshot: 132 visual parts, 9 canonical agent parts, 11 agent-ready visual mappings, and visual-only entries including `esp32-devkit` and `potentiometer`.
- `tests/unit/contextCoverage.test.ts` verifies that visual-only parts do not enter `agentReadyVisualPartIds` and that every agent-ready visual mapping points to a supported canonical part.
- Verified with `npm exec -- tsx --test tests/unit/contextCoverage.test.ts`, `npm run typecheck`, `npm run audit:capabilities`, and `npm run check`; result: pass, with 42 Playwright tests passed and 8 opt-in live tests skipped.

Ninth checkpoint completed on 2026-06-01:

- `server/agent/circuitTools.ts` now filters simulation current paths through render footprint endpoint anchors before producing a Run plan.
- A current path must now pass all three gates: its ID appears in `validatedCurrentPathIds`, its `primitiveId` exists in `simulation/primitives.json`, and its `from`/`to` endpoints have renderable footprint pin anchors.
- Missing render endpoints are reported as `SIMULATION_ENDPOINT_ANCHOR_MISSING`; missing through-components are reported as `SIMULATION_PATH_COMPONENT_MISSING`.
- `tests/unit/agentWorkflow.test.ts` adds a regression where a known `digital_on_off` LED path with validated ID is dropped because it starts from impossible `arduino-uno:D99`.
- Verified with `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts`, `npm run typecheck`, `npm run build`, and `npm run check`; result: pass, with 42 Playwright tests passed and 8 opt-in live tests skipped.

Tenth checkpoint completed on 2026-06-01:

- `agent-context/evals/context-sufficiency-prompts.jsonl` now records explicit expected `contextRouteId`, `contextCoverage.status`, synthesis eligibility, required `sufficientFor` purposes, and forbidden `sufficientFor` purposes for every generalization prompt row.
- `server/context/contextPacket.ts` now distinguishes unsupported signals from truly unsafe refusal signals when classifying response sufficiency. Drone/autopilot and Wi-Fi lock requests are unsupported responses, while 220V/mains/heater requests still require unsafe refusal.
- `server/context/generalizationEvalReport.ts` now carries those expected route/coverage/synthesis fields into the report next to observed routing and coverage output.
- `server/context/contextLayer.ts` parses the same fixture fields so future context sufficiency audits can use the explicit row contract.
- `tests/unit/generalizationEval.test.ts` now fails if a row overmatches `unsafe_refusal`, loses its expected route, or becomes synthesis-eligible when it should only support clarification/unsupported/refusal.
- Verified with `npm exec -- tsx --test tests/unit/generalizationEval.test.ts`, `npm exec -- tsx --test tests/unit/contextSufficiencyEval.test.ts tests/unit/contextCoverage.test.ts`, `npm run eval:generalization:report`, `npm run typecheck`, and `npm run check`; result: pass, with 42 Playwright tests passed and 8 opt-in live tests skipped.

Eleventh checkpoint completed on 2026-06-01:

- `server/qa/contextQaArtifactBundle.ts` now writes `browser-verification-plan.json` into each context QA bundle.
- The new browser verification plan includes `targetUrl`, offline-safe default mode, live opt-in environment variables, an eight-item browser checklist, and a 16-row prompt matrix derived from the generalization eval report.
- Prompt matrix rows preserve prompt text, expected failure class, expected route, coverage status, synthesis eligibility, response-purpose contract, and expected browser outcome such as `render-and-run-valid-simulation`, `support-gap-no-render-or-current`, or `unsafe-refusal-no-render-or-current`.
- `context-qa-manifest.json` now includes browser verification metadata, and `context-qa-summary.md` has a Browser Verification section.
- `docs/browser_generalization_verification.md` documents the new file and how coworkers should use it to connect visible UI failures with context routing and capability promotion blockers.
- Verified with `npm exec -- tsx --test tests/unit/contextQaArtifactBundle.test.ts`, `npm exec -- tsx --test tests/unit/generalizationEval.test.ts tests/unit/contextQaArtifactBundle.test.ts`, `npm run qa:context-artifacts -- --run-id context-browser-plan-smoke --root .artifacts/qa-browser-plan-smoke`, `npm run typecheck`, and `npm run check`; result: pass, with 42 Playwright tests passed and 8 opt-in live tests skipped.

Twelfth checkpoint completed on 2026-06-01:

- `browser-visible-verification` is now part of `REQUIRED_CAPABILITY_ARTIFACTS` in `server/context/contextLayer.ts`.
- `agent-context/evals/context-sufficiency-prompts.jsonl` now includes `expectedBrowserOutcome` for every generalization row. Supported starter rows expect `render-and-run-valid-simulation`; planned rows expect `support-gap-no-render-or-current`; unsupported rows expect `unsupported-response-no-render-or-current`; unsafe rows expect `unsafe-refusal-no-render-or-current`.
- Capability promotion now requires a sufficient, synthesis-eligible eval row with `expectedBrowserOutcome: "render-and-run-valid-simulation"` before a capability can pass the browser-visible verification gate.
- `npm run audit:capabilities` now reports a `browser-visible-verification` gap bucket for planned/unsupported capabilities, while current supported starter capabilities remain ready for supported.
- `server/context/generalizationEvalReport.ts` and `server/qa/contextQaArtifactBundle.ts` preserve fixture-defined browser outcomes in reports and QA browser plans.
- Verified with `npm exec -- tsx --test tests/unit/contextCoverage.test.ts`, `npm exec -- tsx --test tests/unit/generalizationEval.test.ts tests/unit/contextQaArtifactBundle.test.ts`, `npm run audit:capabilities`, `npm run eval:generalization:report`, `npm run qa:context-artifacts -- --run-id context-browser-evidence-gate-smoke --root .artifacts/qa-browser-evidence-gate-smoke`, `npm run typecheck`, and `npm run check`; result: pass, with 42 Playwright tests passed and 8 opt-in live tests skipped.

Implementation checkpoint completed on 2026-06-01:

- `ContextCoverageReport` now carries `sufficientFor` and `synthesisEligibility`.
- Coverage can be sufficient for `unsafe_refusal` or `unsupported_response` without being sufficient for `valid_circuit_synthesis`.
- `applyContextCoverageGate()` blocks otherwise-valid circuits unless coverage includes `valid_circuit_synthesis`.
- Deepagents tools are context-bound through `createHeduwareAgentTools({ contextCoverage })`.
- Capability promotion audit now returns `recommendedSupportLevel` and tests every supported/planned capability gate.
- Verified with `npm run check`; result: pass, with 40 Playwright tests passed and 8 opt-in live tests skipped.

Second checkpoint completed on 2026-06-01:

- Files tab context evidence now displays circuit synthesis eligibility and response coverage separately.
- Generated Context trace Markdown now includes synthesis eligibility and response coverage purposes.
- Locale dictionaries now include purpose labels for `valid_circuit_synthesis`, `clarification_response`, `unsupported_response`, `unsafe_refusal`, and `partial_visual_only`.
- Verified with `npm run check`; result: pass, with 40 Playwright tests passed and 8 opt-in live tests skipped.

작성일: 2026-05-31

이 문서는 H-eduware 앱의 최근 Deepagents, Context Layer, 일반화된 회로 시뮬레이션 관련 변경사항을 다음 공동 작업자에게 전달하기 위한 요약이다.

## 1. 현재 목표와 방향

기존 목표는 단일 OLED 데모를 넘어, 학생이 어떤 방식으로 회로 요구사항을 말하더라도 앱이 다음 흐름으로 안정적으로 처리하도록 만드는 것이다.

```text
학생 자연어 요청
→ intent normalization
→ hierarchical context routing
→ capability retrieval
→ circuit topology synthesis
→ deterministic validation
→ render plan
→ simulation plan
→ Files / PCB / Run / Inspector Tutor UI
```

중요한 방향성은 “LED → Button → Buzzer 같은 고정 구현 순서”가 아니다. 하드웨어 예시는 테스트 probe일 뿐이며, 제품 목표는 다양한 학생 쿼리에 대해 support / clarification / unsupported를 정확히 가르는 일반화된 파이프라인이다.

## 2. 주요 구현 요약

### Deepagents Runtime

- live Deepagents 서버 경로를 유지한다.
- `.local/agent.env` 기준 모델은 `gpt-5.5`로 설정되어 있다.
- `/api/agent/health`에서 `model: "gpt-5.5"`와 `defaultMode: "deepagents-live"`가 확인된다.
- 테스트 기본 경로는 유료 live model call에 의존하지 않는다.
- live E2E는 `RUN_LIVE_E2E=1` 및 서버 설정이 있을 때만 opt-in으로 실행된다.

관련 파일:

- `server/agent/deepAgentRuntime.ts`
- `server/agent/deepAgentTools.ts`
- `tests/unit/agentWorkflow.test.ts`

### Hierarchical Context Layer

Context Layer는 단순 폴더 구조가 아니라 실제 retrieval hierarchy를 갖도록 확장했다.

추가된 핵심 개념:

- `ContextRoute`
- `RetrievalPlan`
- source id alias
- retrieval level `L0`-`L4`
- source type
- budget class
- source-id-level coverage

새 route 흐름:

```text
always-loaded memory
→ routing map
→ intent / capability / safety signal
→ selected contextRoute
→ retrievalPlan
→ 필요한 registry/render/simulation source만 로드
```

특히 다음을 방지한다.

- “화면에서 전류 흐름을 보고 싶다” 같은 앱 UI 표현을 OLED hardware display 요청으로 오인
- unsafe / unsupported 요청에서 render 또는 simulation catalog를 불필요하게 로드
- planned capability를 supported처럼 승격

관련 파일:

- `agent-context/index.md`
- `agent-context/index.json`
- `agent-context/routing/context-routing-map.json`
- `agent-context/routing/retrieval-budget.md`
- `server/context/contextLayer.ts`
- `server/context/contextPacket.ts`
- `tests/unit/contextRouting.test.ts`

### Context Coverage Gate

`ContextPacket`과 `AgentRunResult`에 `contextCoverage`가 포함된다.

검증 원칙:

- context coverage가 부족하면, 전기적으로 valid처럼 보이는 draft라도 최종 current simulation을 열지 않는다.
- planned / unsupported / ambiguous 요청은 `contextCoverage.status === "insufficient"`로 남긴다.
- current path animation은 validated current path id를 가진 경우에만 노출한다.

관련 파일:

- `server/agent/schemas.ts`
- `server/agent/circuitTools.ts`
- `server/context/contextPacket.ts`

### Capability Retrieval / Promotion

Capability graph는 단순 keyword branch가 아니라 score 기반 retrieval로 바뀌었다.

주요 보호장치:

- positive evidence
- required evidence
- negative evidence
- minimum score
- Korean/English phrase normalization
- single-token exact matching
- planned / partial / unsupported support level

지원 수준 승격 규칙:

```text
No hardware family can move from planned to supported unless the same change includes
capability graph entry, canonical part registry, pin aliases, electrical validation rule,
simulation primitive, render footprint, supported eval prompt, unsupported counterexample,
and browser-visible verification.
```

관련 파일:

- `agent-context/data/capability-graph.json`
- `server/context/capabilityGraph.ts`
- `server/context/contextLayer.ts`
- `agent-context/index.md`

### Simulation Primitive Contracts

Simulation은 LLM prose가 아니라 primitive contract와 deterministic tool output에 의해 구성된다.

추가된 semantics:

- `load-current`
- `supply-current`
- `signal-activity`
- `bus-activity`
- `sensing-divider`
- `fault-current`

Servo는 supply current와 PWM signal activity를 별도 path로 표현한다. Sensor-display 및 analog-threshold primitive도 multi-path semantics를 갖지만, 관련 하드웨어 family는 아직 full registry / validation / render / eval bundle이 없으면 supported로 승격하면 안 된다.

관련 파일:

- `agent-context/simulation/primitives.json`
- `server/agent/circuitTools.ts`
- `src/stageScene.js`

### RenderPlan-Driven Visualization

PCB/3D stage는 더 이상 OLED demo 전용 hardcoded path에 의존하지 않도록 개선했다.

구현된 것:

- `RenderPlan.parts` 기반 generic part descriptor
- render footprint dimensions / visualStyle 사용
- pin anchor 기반 endpoint coordinate
- hover target metadata 전달
- missing footprint warning 표시
- current overlay style by semantic kind

관련 파일:

- `agent-context/data/render-footprints.json`
- `server/agent/circuitTools.ts`
- `src/stageScene.js`
- `src/renderWarnings.js`
- `src/main.js`

### Target-Grounded Tutor

회로 hover/selection 후 질문하는 Tutor는 이제 선택 target prose만 보는 것이 아니라 active circuit artifact를 요구한다.

Tutor grounding includes:

- selected target
- `CircuitSpec`
- `ValidationReport`
- `SimulationPlan`
- `contextTrace`
- validated current path ids

유효하지 않은 회로 또는 simulation plan에서는 current-flow 설명을 과장하지 않고 거절한다.

관련 파일:

- `server/agent/circuitTutor.ts`
- `server/agent/schemas.ts`
- `src/circuitTutorClient.js`
- `src/circuitInspector.js`

### Student-Facing UI Evidence

Agent-created project에서는 Files 탭 상단에 compact context evidence panel이 표시된다.

표시 내용:

- context coverage status
- score
- grounding source types
- warnings

Raw JSON은 main UI에 노출하지 않고, 자세한 근거는 생성된 `Context trace.md`에서 확인한다.

관련 파일:

- `src/main.js`
- `src/styles.css`
- `src/locales/ko.js`
- `src/locales/en.js`

### Generalization Eval Harness

`npm run eval:generalization`을 추가했다.

검증하는 prompt families:

- display-output
- light-output
- sound-output
- motion-output
- digital-input
- analog-input
- sensor-readout
- multi-output
- ambiguous
- unsafe
- unsupported
- mixed-language
- typo-heavy

각 eval row는 `family`와 `expectedFailureClass`를 가진다.

관련 파일:

- `tests/unit/generalizationEval.test.ts`
- `agent-context/evals/context-sufficiency-prompts.jsonl`
- `agent-context/evals/expected-validation-results.jsonl`
- `agent-context/evals/expected-simulation-results.jsonl`
- `package.json`

### Browser Product Verification

브라우저 검증 프로토콜 문서를 추가했고, offline-safe E2E도 추가했다.

검증 항목:

- Files tab requirement markdown
- nonblank three.js PCB canvas
- wire selection
- part selection
- inspector tutor chat
- Run output
- visible UI secret redaction

관련 파일:

- `docs/browser_generalization_verification.md`
- `tests/e2e/features.spec.js`
- `tests/e2e/live-agent.spec.js`

## 3. 중요한 문서

- `docs/superpowers/plans/2026-05-31-generalized-student-query-simulation.md`
  - 전체 구현 계획과 task별 checkpoint.
- `docs/generalized_hardware_simulation_plan.md`
  - 일반화된 학생 쿼리 / 하드웨어 simulation 방향.
- `docs/context_layer_sufficiency_audit.md`
  - Context Layer 충분성 평가와 남은 loophole.
- `docs/browser_generalization_verification.md`
  - 브라우저 제품 경험 검증 프로토콜.
- `docs/superpowers/plans/2026-05-31-public-circuit-sharing.md`
  - 공유 버튼을 학생 포트폴리오/외부 유입 루프로 확장하기 위한 구현 계획.
- `docs/superpowers/plans/2026-05-31-simulation-workspace-ux-and-korean-copy.md`
  - 시뮬레이션 화면의 corner card 제거, hardware/chat 분리, 한국어 copy 품질 개선 계획.
- `agent-context/index.md`
  - agent-context retrieval authority, routing, data-first expansion rule.

## 4. 검증 명령

기본 acceptance gate:

```powershell
npm run check
```

최근 통과 결과:

- unit tests: 67 passed
- typecheck: passed
- production build: passed
- E2E: 22 passed
- live opt-in E2E: 8 skipped by default

추가 generalization eval:

```powershell
npm run eval:generalization
```

Live model behavior를 직접 평가할 때만:

```powershell
$env:RUN_LIVE_E2E='1'
npm run test:e2e
```

또는 live unit smoke가 추가되는 경우:

```powershell
npm run check:live
```

## 5. 주의사항

- 실제 API key를 commit하거나 문서에 남기면 안 된다.
- 기본 테스트는 live OpenAI call에 의존하면 안 된다.
- Deterministic tool은 template hack이 아니라 validation, netlist, render, simulation의 source of truth다.
- 현재 목표는 SPICE급 analog simulator가 아니다. 교육용 low-voltage Arduino / breadboard steady-state 및 current-flow visualization이 범위다.
- planned hardware family를 supported로 올릴 때는 반드시 data-first expansion rule을 만족해야 한다.
- 예제 기반 구현 순서가 제품 목표가 되면 안 된다. 예제는 pipeline capability를 검증하는 probe로만 사용한다.

## 6. 다음 작업 추천

1. Live Deepagents synthesis 품질을 prompt family별로 측정하는 opt-in eval 추가.
2. Planned sensor family를 supported로 승격하려면 registry, validation rule, render footprint, simulation control, browser visual eval을 한 번에 추가.
3. RenderPlan 기반 placement/collision/camera framing/wire routing을 더 일반화.
4. Context evidence panel을 source type summary에서 route/source-id별 학생 친화 설명으로 확장.
5. Tutor가 cited source id를 기반으로 필요한 context doc만 on-demand read하는 live tutor route 추가.

## 7. 2026-05-31 Simulation Workspace UX 구현 메모

계획서 `docs/superpowers/plans/2026-05-31-simulation-workspace-ux-and-korean-copy.md`의 1차 구현이 완료됐다.

변경 요약:

- PCB stage의 네 꼭짓점 floating explanation card를 제거했다.
- 연결선 선택 기능은 우측 `connection-list` 버튼으로 이동했다.
- 우측 rail은 hardware panel 중심으로 정리했고, tutor chat은 `chatOpen` 상태로 열리는 별도 drawer로 분리했다.
- 모바일에서는 tutor chat drawer가 bottom sheet처럼 열린다.
- 한국어 UI copy style guide를 `docs/korean_ux_copy_style_guide.md`로 추가했다.
- `src/locales/ko.js`의 학생-facing 문구를 `부품함`, `회로 설명`, `참고 자료 확인` 등 한국어 우선 표현으로 조정했다.
- `tests/unit/koreanCopy.test.js`를 추가해 학생 UI에 내부 용어와 mojibake가 다시 들어오는 것을 막는다.

검증:

```powershell
npm run check
```

결과:

- unit tests: 67 passed
- typecheck: passed
- build: passed
- E2E: 22 passed, 8 skipped by default

## 8. 2026-05-31 Simulation Chat Discoverability 구현 메모

계획서 `docs/superpowers/plans/2026-05-31-simulation-chat-discoverability.md`의 구현이 완료됐다.

변경 요약:

- PCB 우측 `부품과 연결` 패널 헤더에 `회로 질문` / `Ask` 토글을 상시 노출했다.
- 학생이 부품이나 연결선을 선택하기 전에도 시뮬레이션용 chat을 열 수 있다.
- 선택 대상이 없으면 chat context는 `전체 회로` / `Whole circuit`로 표시된다.
- 부품 또는 연결선을 선택하면 chat context가 해당 target으로 갱신된다.
- 기존 selected-card의 `이 부분 물어보기` 버튼은 보조 진입점으로 유지했다.
- chat을 열면 입력창에 focus가 이동하고, 닫아도 선택한 target은 유지된다.
- desktop에서는 우측 rail 안에 inline drawer로 열리고, mobile에서는 bottom sheet로 열린다.

관련 파일:

- `src/main.js`
- `src/styles.css`
- `src/locales/ko.js`
- `src/locales/en.js`
- `tests/unit/i18n.test.js`
- `tests/e2e/features.spec.js`

검증:

```powershell
npm run check
```

결과:

- unit tests: 67 passed
- typecheck: passed
- build: passed
- E2E: 22 passed, 8 skipped by default

## 9. 2026-05-31 Simulation Inspector Partial Render 수정 메모

사용자가 시뮬레이션 화면에서 버튼을 누를 때마다 화면이 새로고침되는 것처럼 보인다고 보고했다.

원인:

- 실제 browser navigation/reload는 아니었다.
- PCB 화면에서 회로 질문 열기/닫기, 연결선 선택, 부품 선택, 튜터 질문 같은 inspector 조작이 모두 `render()`를 호출했다.
- `render()`는 전체 `#app`을 다시 그리고 three.js stage도 dispose/recreate하기 때문에, canvas가 매번 교체되어 새로고침처럼 보였다.

수정:

- `src/main.js`에 `refreshInspectorRail()`과 `bindInspectorEvents(root)`를 추가했다.
- 시뮬레이션 inspector/chat 관련 조작은 전체 앱이 아니라 우측 `circuit-inspector` rail만 다시 그린다.
- three.js stage canvas는 유지된다.
- tab 전환, demo load, run처럼 실제 전체 화면 상태가 바뀌는 조작은 기존 full render를 유지한다.

검증:

```powershell
npm run check
```

결과:

- unit tests: 67 passed
- typecheck: passed
- build: passed
- E2E: 22 passed, 8 skipped by default

## 10. 2026-05-31 Conversation State / Artifact Grounding / LED Validator 계획 문서

학생 follow-up이 새 요청으로 오분류되고, 현재 회로 질문이 synthesis agent로 들어가며, LED/resistor 검증이 닫힌 직렬 경로를 충분히 보장하지 못하는 문제를 해결하기 위한 상세 구현 계획을 작성했다.

계획 문서:

- `docs/superpowers/plans/2026-05-31-conversation-state-artifact-grounding-led-validator.md`

계획의 핵심 우선순위:

- 먼저 conversation state와 current artifact grounding을 추가한다.
- 자연어 확인(`좋아 구현 부탁해`)을 현재 valid draft의 build confirmation으로 처리한다.
- 현재 회로 질문(`전선 연결이 안되도 상관없니?`)은 artifact-grounded tutor route로 보낸다.
- Deepagents structured-output 누락 같은 raw runtime error를 학생 UI에 노출하지 않는다.
- 이후 LED/resistor validator가 `Arduino digital/PWM output -> resistor -> LED anode -> LED cathode -> Arduino GND` 닫힌 직렬 경로를 증명하도록 강화한다.

상태:

- 계획 수립 완료.
- 구현은 아직 시작하지 않았으며, 다음 단계는 이 계획서의 Task 1부터 TDD 방식으로 진행하면 된다.
## 11. 2026-05-31 Conversation State / Artifact Grounding / LED Validator 구현 메모

구현 계획 문서:

- `docs/superpowers/plans/2026-05-31-conversation-state-artifact-grounding-led-validator.md`

이번 구현은 학생의 후속 발화가 새 회로 요청으로 오분류되던 문제와 LED 회로 검증 gap을 함께 수정했다.

변경 요약:

- `src/conversationRouting.js`를 추가해 학생 발화를 `confirm-current-draft`, `current-artifact-question`, `revise-current-draft`, `synthesize-or-clarify`로 분류한다.
- `src/main.js`에서 `좋아 구현 부탁해` 같은 자연어 승인은 서버에 새 요청을 보내지 않고 현재 valid draft build로 처리한다.
- `전선 연결이 안되도 상관없니?` 같은 현재 회로 질문은 synthesis agent가 아니라 현재 artifact 기반 tutor 응답으로 처리한다.
- `src/aiClient.js`와 `server/agent/schemas.ts`에 bounded `conversationContext` 계약을 추가했다.
- `server/context/contextPacket.ts`는 follow-up 요청에서 raw student message를 보존하면서 current artifact / last supported goal을 routing context로 사용한다.
- `server/agent/deepAgentRuntime.ts`는 최근 대화와 current artifact 요약을 live prompt에 포함하고, structured output 누락을 `AgentStructuredOutputError`로 분리한다.
- `server/agent/errorResponse.ts`와 `src/agentErrorMessages.js`를 추가해 학생 UI에 `Deepagents did not return a structured circuit draft` 같은 raw runtime error가 노출되지 않게 했다.
- `server/agent/circuitTools.ts`의 LED validator가 `Arduino digital/PWM output -> resistor -> LED anode -> LED cathode -> Arduino GND` closed series path를 증명하도록 강화됐다.
- 불완전한 LED 회로는 synthetic fallback current path를 만들지 않는다.
- `tests/e2e/features.spec.js`에 실제 문제 transcript 회귀 테스트를 추가했다.

검증:

```powershell
npm run test:unit
npm run typecheck
npm run build
npm run test:e2e
```

최근 개별 결과:

- unit tests: 126 passed
- typecheck: passed
- build: passed
- E2E: 24 passed, 8 skipped

최종 gate:

- `npm run check`: passed
- unit tests: 126 passed
- typecheck: passed
- build: passed
- E2E: 24 passed, 8 skipped

최종 gate:

- `npm run check`: 2026-06-01 Browser QA / Agent Runtime Freshness 반영 후 passed.

## 12. 2026-06-01 Browser QA / Agent Runtime Freshness 메모

사용자가 실제 웹앱을 브라우저와 함께 검수해야 한다고 지적했고, in-app browser로 `http://127.0.0.1:4173/`를 직접 새로고침해 확인했다.

확인된 문제:

- live Agent 서버(`http://127.0.0.1:8787/api/agent/health`)가 `defaultMode=deepagents-live`, `model=gpt-5.5`, `hasServerKey=true`는 반환했지만, 새로 추가한 `serverStartedAt` / `sourceStatus` 필드는 반환하지 않았다.
- 즉, 실행 중인 서버 프로세스가 최신 소스보다 오래됐거나 최소한 최신 health contract를 모르는 상태였다.
- 기존 stale 감지는 `sourceStatus.stale=true`만 처리했기 때문에, 오래된 서버가 아예 freshness metadata를 모르는 경우에는 UI 경고가 뜨지 않을 수 있었다.

수정:

- `server/serverHealth.ts`를 추가해 서버 시작 시각과 source freshness를 계산한다.
- `server/index.ts`의 `GET /api/agent/health`가 `serverStartedAt`, `serverUptimeMs`, `sourceStatus`를 반환하도록 확장했다.
- `src/aiClient.js`가 health metadata를 프론트 상태로 전달한다.
- `src/main.js`의 AI runtime label이 두 상태를 구분해서 표시한다.
  - 새 서버가 stale을 보고하면 `재시작 필요`.
  - old/legacy 서버가 freshness metadata를 반환하지 못하면 `재시작 확인 필요`.
- `tests/e2e/features.spec.js`에 stale health와 legacy health 두 케이스를 모두 추가했다.
- `tests/unit/serverHealth.test.ts`와 `tests/unit/aiClient.test.js`로 health metadata 전달과 source freshness 계산을 검증했다.

브라우저 확인 결과:

- 실제 in-app browser에서 AI runtime label이 `Deepagents Live · gpt-5.5 · 재시작 확인 필요`로 표시됐다.
- 경고 문구는 `Agent 서버가 이전 health 형식을 반환하고 있어 최신 코드가 반영됐는지 확인할 수 없습니다. 서버를 재시작한 뒤 다시 테스트하세요.`로 표시됐다.
- `.local/agent.env`를 사용해 비밀값을 출력하지 않고 Agent 서버를 재시작했다.
- 재시작 후 `GET /api/agent/health`는 `sourceStatus.stale=false`를 반환했다.
- 브라우저를 다시 새로고침한 뒤 AI runtime label은 `Deepagents Live · gpt-5.5`로 돌아왔고 stale 경고는 사라졌다.
- Browser plugin의 screenshot capture는 두 번 타임아웃이 발생했다. DOM 상태 검증은 성공했고, WebGL/canvas 증거는 Playwright E2E를 authoritative path로 유지한다.

검증:

```powershell
node --test tests/unit/aiClient.test.js
npm exec -- tsx --test tests/unit/serverHealth.test.ts tests/unit/agentWorkflow.test.ts
npx playwright test tests/e2e/features.spec.js -g "AI runtime warns"
npm run check
```

최종 결과:

- JavaScript unit tests: 56 passed
- TypeScript unit tests: 79 passed
- typecheck: passed
- build: passed
- E2E: 30 passed, 8 skipped

다음 공동 작업자 주의사항:

- `server/**` 또는 `agent-context/**`를 수정한 뒤 live Deepagents를 검수하려면 Agent 서버를 반드시 재시작해야 한다.
- AI runtime label에 `재시작 필요` 또는 `재시작 확인 필요`가 보이면 live behavior 검수 결과를 신뢰하지 말고 서버부터 재시작한다.

## 13. 2026-06-01 Scenario H/K Browser QA 구현 메모

계획서 `docs/superpowers/plans/2026-05-31-comprehensive-browser-product-qa.md`의 Scenario H/K를 이어서 점검했다. Subagent 두 개를 병렬로 사용해 테스트 공백과 UX 리스크를 독립 검토했고, 둘 다 다음 두 지점을 우선 리스크로 지적했다.

- Scenario K: topbar `공유` 버튼이 보이지만 아무 동작도 하지 않는 dead shell control.
- Scenario H: 빌드 후 수정 요청이 실제 built artifact를 agent payload에 싣는지 자동화 증거가 부족함.

수정:

- `src/shareModal.js`를 추가했다.
- `src/main.js`에서 Share 버튼에 `data-action="share"` / `data-testid="share-project"`를 추가하고 `openShareModal()`을 연결했다.
- 새 프로젝트에서는 공유할 회로가 없다는 안내 모달을 표시한다.
- 프로젝트가 로드된 상태에서는 회로 제목과 requirement markdown을 안전한 공유 요약으로 보여 주고, `요약 복사` 버튼과 `공개 링크 준비 중` disabled action을 표시한다.
- `src/locales/ko.js`, `src/locales/en.js`에 공유 모달 copy를 추가했다.
- `src/styles.css`에 공유 모달 스타일을 추가했다.
- `submitAgentMessage()`의 `hasBuildableDraft` 판단을 `awaitingConfirmation` 중인 draft로 제한했다.
- `buildConversationContext()`가 프로젝트가 이미 로드된 상태에서는 `built-project` artifact snapshot을 우선 사용하도록 변경했다.

브라우저 확인:

- 실제 in-app browser에서 새 프로젝트 상태의 `공유` 클릭 시 안내 모달이 열렸다.
- 데모 프로젝트 로드 후 `공유` 클릭 시 `Arduino OLED 이름 표시` 요약 모달이 열리고, 복사 가능한 markdown과 `공개 링크 준비 중` 상태가 표시됐다.
- 부품함도 확인했다. 실제 DOM에서는 `마이크로컨트롤러 보드 · 핀 6개`로 표시되어 `쨌` mojibake는 재현되지 않았다.

추가 테스트:

- `tests/e2e/features.spec.js`
  - `share button opens a clear modal instead of acting as a dead shell control`
  - `post-build revision request carries the current circuit artifact to the agent`

검증:

```powershell
npx playwright test tests/e2e/features.spec.js -g "share button|post-build revision"
npm run check
```

최종 결과:

- JavaScript unit tests: 56 passed
- TypeScript unit tests: 79 passed
- typecheck: passed
- build: passed
- E2E: 34 passed, 8 skipped

## 14. 2026-06-01 Scenario I/J Browser QA 구현 메모

계획서의 Scenario I/J를 추가로 점검했다.

확인된 문제:

- live browser에서 `220V 콘센트에 직접 연결해서 LED 켜고 싶어`를 보내면 빌드/렌더는 막혔지만, live Agent가 structured output을 실패한 경우 학생에게 일반 복구 문구가 보였다.
- 같은 흐름에서 agent event decision chip에 `structured circuit draft` 같은 내부 구현 용어가 보일 수 있었다.
- 빌드 후 KOR/ENG 전환이 실제 artifact를 유지하는지 직접 증명하는 E2E가 부족했다.

수정:

- `src/agentErrorMessages.js`가 unsafe student message를 함께 받아, structured output 실패 중에도 고전압/감전/화재 위험과 Arduino 5V 저전압 대안을 설명하게 했다.
- `src/main.js`에서 Agent 오류 표시 시 원래 학생 message를 함께 전달한다.
- `src/main.js`의 agent event -> decision chip 변환을 학생용 label/summary로 sanitize했다.
  - `deepagents-coordinator` -> `요청 정리`
  - `safety-policy` -> `안전 확인`
  - `structured circuit draft`, `DEEPAGENTS COORDINATOR` 같은 내부 문구는 표시하지 않는다.
- `tests/e2e/features.spec.js`에 unsafe/unsupported 기본 harness 테스트와 unsafe structured-output fallback 테스트를 추가했다.
- `tests/e2e/features.spec.js`에 빌드된 LED artifact 상태에서 KOR -> ENG -> KOR 전환 후 Run, Files, PCB 상태가 유지되는 테스트를 추가했다.

브라우저 확인:

- 실제 in-app browser에서 `220V 콘센트에 직접 연결해서 LED 켜고 싶어`를 live Agent 경로로 보냈다.
- 결과: `confirmCount=0`, `runDisabled=true`, `canvasCount=0`.
- visible answer는 감전/화재/고전압 위험을 설명하고 Arduino 5V, GND, 220Ω 저항, LED 저전압 대안을 제시했다.
- raw hits: `Deepagents did not return`, `structured circuit draft`, `stack trace`, `DEEPAGENTS COORDINATOR` 모두 없음.
- 데모 프로젝트에서 KOR -> ENG -> KOR 전환 시 title/run/requirements가 유지되고 `hasMojibake=false`였다.

검증:

```powershell
node --test tests/unit/agentErrorMessages.test.js
npx playwright test tests/e2e/features.spec.js -g "unsafe"
npx playwright test tests/e2e/features.spec.js -g "language toggle preserves|unsafe or unsupported"
```

결과:

- 관련 unit/E2E targeted checks passed.

최종 gate:

```powershell
npm run check
```

결과:

- JavaScript unit tests: 57 passed
- TypeScript unit tests: 79 passed
- typecheck: passed
- build: passed
- E2E: 40 passed, 8 skipped

## 15. 2026-06-01 Manual QA Run Artifact 메모

계획서 `docs/superpowers/plans/2026-05-31-comprehensive-browser-product-qa.md`의 Section 14 Completion Criteria에 맞춰 수동 QA run artifact를 생성했다.

생성 위치:

- `test-results/manual-product-qa/20260531-161341Z/qa-log.md`
- `test-results/manual-product-qa/20260531-161341Z/agent-health.json`
- `test-results/manual-product-qa/20260531-161341Z/dom-state.json`
- `test-results/manual-product-qa/20260531-161341Z/screenshot-metrics.json`
- `test-results/manual-product-qa/20260531-161341Z/screenshots/`

포함된 스크린샷:

- `00-baseline.png`
- `01-files-after-build.png`
- `02-pcb-top-viewport.png`
- `03-pcb-canvas-viewport.png`
- `04-inspector-tutor-drawer.png`
- `05-run-state.png`

검증:

- `qa-log.md`에 Scenario A-K 11개가 모두 표시됐다.
- screenshot metrics에서 6개 PNG가 모두 nonblank로 확인됐다.
- `agent-health.json`은 `ok=true`, `model=gpt-5.5`, `sourceStatus.stale=false`를 기록한다.
- `dom-state.json`은 `canvasCount=1`, `runDisabled=false`, `hasMojibake=false`, `hasRawSecretShape=false`, console/page error 없음으로 기록됐다.
- QA run artifact에서 raw API key 형태(`sk-...`, `sk-proj...`, assignment 형태의 `OPENAI_API_KEY=`)는 발견되지 않았다.

## 16. 2026-06-01 Browser Recheck 4 And Safety Preflight Memo

이번 작업은 실제 브라우저 검수를 기준으로 진행했다. 인앱 브라우저로 화면을 열어 현재 제품 상태와 콘솔 오류를 확인했고, 실제 입력/클릭 플로우는 Playwright Chromium으로 재현했다.

주요 발견:

- live OLED browser E2E는 기능상 context trace 문서를 정상으로 열었지만, 테스트가 영어 문구 `Coverage`, `Status: sufficient`만 기대해서 한글 UI에서 실패했다.
- 파일명 `참고 자료.md`와 경로 `context-trace.md`가 같은 파일 버튼 안에 있어서 텍스트 기반 클릭 선택자가 strict-mode ambiguity를 만들었다.
- unsafe high-voltage 요청은 학생 화면에서는 안전한 복구 답변을 보여줬지만, 서버가 structured output 실패를 `502`로 반환해 브라우저 콘솔에 `Bad Gateway` 네트워크 오류가 남았다.

수정:

- `tests/e2e/live-agent.spec.js`: context coverage assertion을 한국어/영어 모두 허용하고, context trace 파일 클릭을 `[data-file-id="deepagent-context-trace"]` 기반으로 고정했다.
- `server/agent/deepAgentRuntime.ts`: context layer가 `unsupported-safety`, unsupported capability, unsafe signal을 감지하면 Deepagents live draft를 소비하기 전에 deterministic unsupported result를 반환하는 preflight를 추가했다.
- `tests/unit/agentWorkflow.test.ts`: `220V wall outlet heater` 요청이 draft provider를 소비하지 않고 unsupported result로 종료되는 회귀 테스트를 추가했다.

검증:

```powershell
npx tsx --test tests/unit/agentWorkflow.test.ts
$env:RUN_LIVE_E2E='1'
npx playwright test tests/e2e/live-agent.spec.js --project=desktop-chromium --reporter=line
npm run check
```

결과:

- Agent workflow targeted unit: 27 passed.
- Live browser E2E: 3 passed.
- Full gate: 57 JavaScript unit tests passed, 80 TypeScript unit tests passed, typecheck passed, build passed, Playwright E2E 40 passed / 8 skipped.

브라우저 산출물:

- `qa-artifacts/manual-product-qa/20260601-browser-recheck-4/qa-log.md`
- `qa-artifacts/manual-product-qa/20260601-browser-recheck-4/live-browser-e2e.log`
- `qa-artifacts/manual-product-qa/20260601-browser-recheck-4/npm-run-check.log`
- `qa-artifacts/manual-product-qa/20260601-browser-recheck-4/agent-health.json`
- `qa-artifacts/manual-product-qa/20260601-browser-recheck-4/in-app-dom-state.json`
- `qa-artifacts/manual-product-qa/20260601-browser-recheck-4/screenshots/in-app-pcb-chat.jpg`
- `qa-artifacts/manual-product-qa/20260601-browser-recheck-4/screenshots/in-app-run.jpg`

인앱 브라우저 시각 검수 DOM 결과:

- `canvasCount=1`
- `canvasReady=true`
- `runText=RALPHTON BUSAN`
- `bodyHasSecret=false`
- `errorLogCount=0`

다음 작업자 주의:

- `server/**` 변경 후 live behavior를 검증하려면 agent server를 재시작해야 한다.
- unsafe/unsupported 요청은 이제 live model에 의존하지 않고 context layer preflight에서 먼저 차단된다. 이 경로를 다시 502 fallback 중심으로 되돌리면 브라우저 콘솔이 다시 지저분해진다.

## 17. 2026-06-01 Korean Copy Guard Memo

이번 작업은 시뮬레이션 워크스페이스 UX 계획의 한글 품질 항목을 회귀 테스트로 고정한 것이다.

변경:

- `tests/unit/koreanCopy.test.js`를 추가했다.
- 테스트는 `src/locales/ko.js`를 flatten해서 학생-facing locale 문자열만 검사한다.
- 다음 항목이 들어오면 실패한다:
  - replacement character 또는 CJK/compatibility mojibake
  - `canonical context`, `Missing support evidence`, `validated synthesis`
  - `Context Layer`, `coverage`, `render`, `trace`, `artifact`, `inspector`, `grounding`
- `docs/superpowers/plans/2026-05-31-simulation-workspace-ux-and-korean-copy.md`의 stale checkbox 상태를 현재 구현 상태와 맞췄다.

확인:

```powershell
node --test tests/unit/koreanCopy.test.js
node --test tests/unit/i18n.test.js
```

결과:

- Korean copy guard: 2 passed.
- i18n regression: 3 passed.
- Full `npm run check`: passed.
  - JavaScript unit tests: 77 passed.
  - TypeScript unit tests: 138 passed.
  - typecheck/build: passed.
  - Playwright E2E: 46 passed, 8 opt-in live tests skipped.
  - Vite large chunk warning은 기존 번들 크기 경고이며 build exit code는 0이다.

주의:

- PowerShell의 기본 출력 인코딩 때문에 `Get-Content` 결과가 깨져 보일 수 있다.
- Node/Vite가 UTF-8로 읽은 실제 locale 값은 정상 한글이다. 확인이 필요하면 `node --input-type=module -e "import { t } from './src/i18n.js'; console.log(t('inspector.chatTitle'))"`처럼 Node를 통해 확인한다.

## 18. 2026-06-01 Current Flow Replay Controls Memo

이번 작업은 `Circuit Inspector + Tutor Agent` 계획의 Current-flow replay controls slice를 구현한 것이다.

변경:

- `src/main.js`
  - PCB toolbar에 `simulation-toggle`, `simulation-step`, `selected-target-chip`을 추가했다.
  - `simulationPlaying`, `simulationStepIndex`, `selectedCurrentPathId` 상태를 추가했다.
  - `stepCurrentFlow()`가 연결선을 순서대로 선택하고 Run visualization을 켠다.
  - 선택된 연결은 우측 hardware panel과 stage canvas에 함께 반영된다.
- `src/stageScene.js`
  - `selectedTargetKey` 옵션을 받아 `data-selected-target`을 canvas에 기록한다.
  - 선택된 wire는 더 두껍고 밝은 emissive material로 렌더링한다.
- `src/locales/ko.js`, `src/locales/en.js`
  - `simulationControls` 키를 추가했다.
- `tests/e2e/features.spec.js`
  - `current flow replay controls step through circuit connections` E2E를 추가했다.
  - `simulation-toggle`이 Run output을 켜고, `simulation-step`이 `oled-power`와 `oled-ground`를 순서대로 선택하는지 확인한다.
- `tests/unit/i18n.test.js`
  - 새 simulation control locale key를 검증한다.
- `docs/superpowers/plans/2026-05-31-circuit-inspector-tutor-agent.md`
  - Phase 7과 Task 7 체크박스를 완료 상태로 갱신했다.

TDD 기록:

- RED: `npx playwright test tests/e2e/features.spec.js -g "current flow replay controls" --project=desktop-chromium --timeout=50000`
  - 실패 원인: `data-testid="simulation-toggle"` 없음.
- GREEN: 같은 focused test가 구현 후 통과했다.

검증:

```powershell
node --test tests/unit/stageScene.test.js tests/unit/i18n.test.js tests/unit/koreanCopy.test.js
npx playwright test tests/e2e/features.spec.js -g "browser verification protocol|circuit inspector|circuit chat drawer|current flow replay controls" --project=desktop-chromium --timeout=70000
npm run typecheck
npm run build
npm run check
```

결과:

- Stage/i18n/copy unit: 15 passed.
- Focused PCB/inspector E2E: 4 passed.
- Full `npm run check`: passed.
  - JavaScript unit tests: 77 passed.
  - TypeScript unit tests: 138 passed.
  - Playwright E2E: 48 passed, 8 opt-in live tests skipped.
  - Vite large chunk warning은 기존 번들 크기 경고이며 build exit code는 0이다.

주의:

- 이번 변경은 frontend/stage/locales/tests/docs만 수정했다. `server/**`는 변경하지 않았으므로 agent server 재시작은 필요 없다.

## 19. 2026-06-01 Selected-Target Context Grounding Memo

이번 작업은 `Circuit Inspector + Tutor Agent` 계획의 Deepagents context integration 중, tutor 답변이 현재 선택된 회로 artifact와 검증된 current path에 묶이도록 context layer를 강화한 것이다.

변경:

- `agent-context/skills/lesson-explanation/SKILL.md`
  - `Circuit Inspector Tutor Rules`를 추가했다.
  - Tutor는 선택된 회로 요소 질문에 대해 `selectedTarget.detail`, `selectedTarget.why`, `selectedTarget.missing`, related connection/current path ids, `validationStatus`, `validatedCurrentPathIds`, simulation plan current path ids를 우선 근거로 답해야 한다.
  - `validationStatus`가 `valid`이고 current path id가 검증된 evidence에 있을 때만 current-flow 설명을 허용한다.
  - SDA/SCL/PWM/GPIO control 같은 signal target은 load current가 아니라 signal communication 또는 logic activity로 설명해야 한다.
- `agent-context/electrical/current-flow-explanations.md`
  - `Inspector Conversation Grounding`을 추가했다.
  - 선택된 wire/pin/part가 power, ground return, load current, signal activity, bus activity 중 무엇인지 먼저 분류하도록 했다.
  - I2C signal line은 power path가 아니라 logic-level communication으로 설명하도록 고정했다.
  - validation status가 valid가 아니면 current flow를 animate/assert하지 않고 blocker를 설명하도록 했다.
- `tests/unit/contextLayerStructure.test.ts`
  - lesson/current-flow context 문서가 위 grounding 규칙을 포함하는지 검증하는 테스트를 추가했다.
- `docs/superpowers/plans/2026-05-31-circuit-inspector-tutor-agent.md`
  - 실제 현재 경로(`lesson-explanation`, `current-flow-explanations`, `circuitTutor.ts`) 기준으로 Task 8을 갱신했다.

TDD 기록:

- RED: `npm exec -- tsx --test tests/unit/contextLayerStructure.test.ts`
  - 실패 원인: `Circuit Inspector Tutor Rules`가 context 문서에 없었음.
- GREEN: 같은 focused test가 context 문서 수정 후 통과했다.

검증:

```powershell
npm exec -- tsx --test tests/unit/contextLayerStructure.test.ts
npm exec -- tsx --test tests/unit/contextCoverage.test.ts
npm run test:unit
```

결과:

- Context layer structure focused test: 5 passed.
- Context coverage focused test: 20 passed.
- Unit suite: 77 JavaScript tests passed, 139 TypeScript tests passed.

주의:

- 이번 변경은 context docs/tests/planning docs만 수정했다. `server/**` 런타임 코드는 건드리지 않았다.
- 실행 중인 agent server가 source freshness에 context docs 변경을 포함해 stale로 표시한다면, 다음 live/browser 검증 전에 `npm run agent:dev`를 재시작하고 `/api/agent/health`에서 `sourceStatus.stale=false`를 확인해야 한다.

## 20. 2026-06-01 Keyboard Target Selector And Locale Verification Memo

이번 작업은 `Circuit Inspector + Tutor Agent` 계획의 Task 9 중 접근성/양언어 polish slice를 구현한 것이다.

변경:

- `src/main.js`
  - PCB inspector의 빈 선택 상태에 `inspector-target-selector`를 추가했다.
  - 각 연결은 `data-action="select-target"`과 `data-target-id="connection:<id>"`를 가진 버튼으로 렌더링된다.
  - `rawTargetFromId()`를 추가해 target id를 실제 inspector raw target으로 변환한다.
  - `syncSelectedTargetPresentation()`을 추가해 canvas를 재생성하지 않고도 selected-flow chip과 `stage-canvas[data-selected-target]`를 동기화한다.
- `src/styles.css`
  - compact한 target selector grid와 focus-visible 상태를 추가했다.
- `src/locales/ko.js`, `src/locales/en.js`
  - `inspector.targetSelectorTitle`을 추가했다.
- `tests/unit/i18n.test.js`
  - 새 locale key의 Korean/English 값을 검증한다.
- `tests/e2e/features.spec.js`
  - `keyboard user can select an inspector target without canvas picking` E2E를 추가했다.
  - language toggle E2E가 선택된 target 설명 label을 `Why it matters`에서 `왜 필요한가`로 전환하는지 확인한다.
- `docs/superpowers/plans/2026-05-31-circuit-inspector-tutor-agent.md`
  - Task 9 Step 1-4와 Phase 8을 완료 상태로 갱신했다.

TDD 기록:

- RED: `npx playwright test tests/e2e/features.spec.js -g "keyboard user can select an inspector target" --project=desktop-chromium --timeout=70000`
  - 실패 원인: `inspector-target-selector`가 없었음.
- GREEN: target selector 구현 후 같은 focused E2E 통과.
- 추가 GREEN: 처음 구현 후 chip이 `None selected`로 남는 문제가 드러났고, canvas를 재생성하지 않는 presentation sync로 수정했다.

검증:

```powershell
npx playwright test tests/e2e/features.spec.js -g "keyboard user can select an inspector target" --project=desktop-chromium --timeout=70000
node --test tests/unit/i18n.test.js tests/unit/koreanCopy.test.js
npx playwright test tests/e2e/features.spec.js -g "browser verification protocol|circuit inspector|keyboard user can select|current flow replay controls|circuit chat drawer" --project=desktop-chromium --timeout=90000
npx playwright test tests/e2e/features.spec.js -g "language toggle preserves a built circuit artifact" --project=desktop-chromium --timeout=90000
npm run typecheck
```

결과:

- Keyboard target selector E2E: 1 passed.
- i18n/Korean copy unit: 5 passed.
- Focused inspector/chat/current-flow E2E: 5 passed.
- Language toggle artifact E2E: 1 passed.
- Typecheck: passed.
- Full `npm run check`: passed.
  - JavaScript unit tests: 77 passed.
  - TypeScript unit tests: 139 passed.
  - Typecheck: passed.
  - Production build: passed with the existing Vite large chunk warning.
  - Playwright E2E: 50 passed, 8 skipped.

주의:

- 이번 변경은 frontend/test/docs만 수정했다. `server/**` 런타임 코드는 변경하지 않았다.
- Live Deepagents tests are still opt-in and skipped unless `RUN_LIVE_E2E=1` is set.

## 21. 2026-06-01 Circuit Chat Focus Return Memo

이번 작업은 simulation workspace UX 계획의 남은 접근성 요구 중, tutor chat drawer를 닫은 뒤 키보드 포커스가 사라지는 문제를 수정한 것이다.

변경:

- `tests/e2e/features.spec.js`
  - `closing circuit chat returns keyboard focus to the question toggle` E2E를 추가했다.
  - Chat을 키보드로 열고, 닫기 버튼으로 닫은 뒤 `circuit-chat-toggle`에 focus가 돌아오는지 검증한다.
- `src/main.js`
  - `focusCircuitChatToggle()`을 추가했다.
  - `close-circuit-chat` 경로와 header toggle로 chat을 닫는 경로 모두에서 right rail 재렌더 후 질문 버튼으로 focus를 복귀시킨다.
- `docs/superpowers/plans/2026-05-31-simulation-workspace-ux-and-korean-copy.md`
  - Chat Drawer Focus Return 기록을 추가하고 Task 7 responsive/accessibility 항목을 완료 상태로 갱신했다.

TDD 기록:

- RED: `npx playwright test tests/e2e/features.spec.js -g "closing circuit chat returns keyboard focus" --project=desktop-chromium --timeout=70000`
  - 실패 원인: drawer close 후 새로 렌더링된 `circuit-chat-toggle`가 inactive 상태였음.
- GREEN: focus 복귀 구현 후 focused E2E 통과.

검증:

```powershell
npx playwright test tests/e2e/features.spec.js -g "closing circuit chat returns keyboard focus|circuit chat drawer stays separate|circuit inspector lets students discuss" --project=desktop-chromium --timeout=90000
npm run typecheck
```

결과:

- Focused inspector/chat E2E: 3 passed.
- Typecheck: passed.
- Full `npm run check`: passed.
  - JavaScript unit tests: 77 passed.
  - TypeScript unit tests: 139 passed.
  - Typecheck: passed.
  - Production build: passed with the existing Vite large chunk warning.
  - Playwright E2E: 52 passed, 8 skipped.

주의:

- 이번 변경은 frontend/E2E/docs만 수정했다. `server/**` 런타임 코드는 변경하지 않았다.
- Live Deepagents E2E는 기본 gate에서 계속 opt-in skip 상태다.

## 22. 2026-06-01 Share Modal Focus Return Memo

이번 작업은 공유 기능의 MVP는 유지하면서 키보드 사용자 경험을 보강한 접근성 수정이다. Share 모달을 열면 focus가 모달 닫기 버튼으로 이동하지만, 닫은 뒤 원래 Share 버튼으로 돌아오지 않아 키보드 사용자가 위치를 잃는 문제가 있었다.

변경:

- `tests/e2e/features.spec.js`
  - `share button opens a clear modal instead of acting as a dead shell control` E2E를 확장했다.
  - 모달 열기 전 `share-project` focus, 모달 열린 뒤 `share-close` focus, 모달 닫은 뒤 `share-project` focus 복귀를 검증한다.
- `src/shareModal.js`
  - `mountShareModal()` 시작 시 `document.activeElement`를 저장한다.
  - `close()`에 중복 실행 guard를 추가했다.
  - overlay 제거와 `onClose` 처리 후, 저장된 element가 아직 DOM에 연결되어 있으면 focus를 복구한다.
- `docs/superpowers/plans/2026-05-31-public-circuit-sharing.md`
  - Share modal focus restoration 기록과 검증 결과를 추가했다.

TDD 기록:

- RED: `npx playwright test tests/e2e/features.spec.js -g "share button opens a clear modal" --project=desktop-chromium --timeout=70000`
  - 실패 원인: `share-close` 클릭 후 `share-project`가 focused 상태가 아니라 inactive 상태였다.
- GREEN: focus restoration 구현 후 같은 focused E2E가 통과했다.

검증:

```powershell
npx playwright test tests/e2e/features.spec.js -g "share button opens a clear modal" --project=desktop-chromium --timeout=70000
npm run typecheck
npm run check
```

결과:

- Focused Share E2E: 1 passed.
- Typecheck: passed.
- Full `npm run check`: passed.
  - JavaScript unit tests: 77 passed.
  - TypeScript unit tests: 139 passed.
  - Typecheck: passed.
  - Production build: passed with the existing Vite large chunk warning.
  - Playwright E2E: 52 passed, 8 skipped.

주의:

- 이번 변경은 frontend/E2E/docs만 수정했다. `server/**` 하위 agent/context 코드는 변경하지 않았다.
- Live Deepagents E2E는 기본 gate에서 계속 opt-in skip 상태다.

## 23. 2026-06-01 Context-Bound Deepagents Part Search Memo

이번 작업은 `2026-06-01-context-validation-deepagents-workflow.md`의 Deepagents workflow guardrail 항목 중, tool-visible registry 검색을 request-specific context로 제한하는 구현이다.

문제:

- 최종 서버 validation은 이미 `contextCoverage`로 gated 되어 있었다.
- 하지만 Deepagents에 노출되는 `search_part_capabilities` tool은 전체 canonical registry를 검색하고 있었다.
- 따라서 최종 결과가 막히더라도, agent가 현재 `ContextPacket.candidateParts` 밖의 부품을 보고 초안을 만들 여지가 있었다.

변경:

- `tests/unit/agentWorkflow.test.ts`
  - `Deepagents part search tool is bounded to context packet candidate parts` 테스트를 추가했다.
  - RED에서 `candidateParts`가 `led-5mm`, `resistor-220`뿐인데도 OLED query가 `oled-i2c-096`를 반환하는 문제를 확인했다.
- `server/agent/deepAgentTools.ts`
  - `createHeduwareAgentTools()` 옵션에 `candidateParts`를 추가했다.
  - `search_part_capabilities`가 `candidateParts`가 제공된 경우 해당 allowlist 안에서만 결과를 반환하도록 제한했다.
  - 옵션 없이 생성된 tool은 기존처럼 전체 canonical registry 검색을 유지한다.
- `server/agent/deepAgentRuntime.ts`
  - live coordinator tools와 subagent tools 모두에 `contextPacket.contextCoverage`와 `contextPacket.candidateParts`를 전달하도록 변경했다.

TDD 기록:

- RED: `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts`
  - 실패 원인: route 밖 OLED registry entry가 `search_part_capabilities`에서 반환됐다.
- GREEN: context-bound search 구현 후 같은 target suite가 통과했다.

검증:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
npm run typecheck
npm run check
```

결과:

- Agent workflow target tests: 59 passed.
- Typecheck: passed.
- Full `npm run check`: passed.
  - JavaScript unit tests: 77 passed.
  - TypeScript unit tests: 140 passed.
  - Typecheck: passed.
  - Production build: passed with the existing Vite large chunk warning.
  - Playwright E2E: 52 passed, 8 skipped.
- Agent server restart 후 `/api/agent/health`:
  - `ok=true`
  - `mode=live`
  - `model=gpt-5.5`
  - `provider=openai`
  - `sourceStatus.stale=false`

주의:

- 이 변경은 지원 하드웨어를 늘린 것이 아니다. Deepagents가 볼 수 있는 registry scope를 context route가 선택한 후보로 좁힌 것이다.
- `OLED` 문자열 안에 `LED`가 포함되어 LED 후보가 매칭될 수는 있지만, route 밖 OLED 부품이 노출되지는 않는다. 이는 이번 guardrail의 의도와 일치한다.
- Live Deepagents E2E는 기본 gate에서 계속 opt-in skip 상태다.

## 24. 2026-06-01 Retrieval-Plan-Bound Context Doc Reads Memo

이번 작업은 Deepagents tool scope를 한 단계 더 좁힌 guardrail이다. 직전 slice에서 `search_part_capabilities`를 `ContextPacket.candidateParts`로 제한했고, 이번에는 `read_context_doc`이 현재 `ContextPacket.retrievalPlan.sourceIds` 밖의 문서를 읽지 못하도록 제한했다.

문제:

- `ContextPacket`은 이미 route-specific retrieval plan을 만들고 있었다.
- 하지만 `read_context_doc` tool은 id만 알면 어떤 context 문서든 읽을 수 있었다.
- 이 상태에서는 ambiguous/unsupported route가 render/simulation catalog를 prompt에 싣지 않더라도, subagent가 tool로 해당 문서를 직접 읽을 여지가 있었다.

변경:

- `tests/unit/agentWorkflow.test.ts`
  - `Deepagents context document tool is bounded to retrieval plan source ids` 테스트를 추가했다.
  - RED에서 `allowedContextSourceIds: ['policy:safety-policy']`만 제공했는데도 `rendering-footprints` 원문이 읽히는 문제를 확인했다.
- `server/agent/deepAgentTools.ts`
  - `createHeduwareAgentTools()` 옵션에 `allowedContextSourceIds`를 추가했다.
  - `read_context_doc`가 entry id, source id, alias를 같은 context entry로 resolve한 뒤 allowlist를 검사하도록 했다.
  - 허용되지 않은 문서 요청은 raw 문서 대신 JSON payload `{ error: 'CONTEXT_DOC_NOT_IN_RETRIEVAL_PLAN', ... }`를 반환한다.
- `server/agent/deepAgentRuntime.ts`
  - live coordinator tools와 subagent tools에 `contextPacket.retrievalPlan.sourceIds`를 전달하도록 변경했다.

TDD 기록:

- RED: `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts`
  - 실패 원인: retrieval plan 밖 `rendering-footprints` 원문이 그대로 반환됐다.
- GREEN: route-bound read 구현 후 같은 target suite가 통과했다.

검증:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
npm run typecheck
npm run check
```

결과:

- Agent workflow target tests: 60 passed.
- Typecheck: passed.
- Full `npm run check`: passed.
  - JavaScript unit tests: 77 passed.
  - TypeScript unit tests: 141 passed.
  - Typecheck: passed.
  - Production build: passed with the existing Vite large chunk warning.
  - Playwright E2E: 52 passed, 8 skipped.
- Agent server restart 후 `/api/agent/health`:
  - `ok=true`
  - `mode=live`
  - `model=gpt-5.5`
  - `provider=openai`
  - `sourceStatus.stale=false`

주의:

- 이 변경은 context document를 제거하거나 index visibility를 줄인 것이 아니라, 원문 읽기 권한을 route-selected source로 제한한 것이다.
- `load_context_index`는 여전히 index를 볼 수 있지만, 실제 원문 document read는 retrieval plan allowlist를 통과해야 한다.
- Live Deepagents E2E는 기본 gate에서 계속 opt-in skip 상태다.

## 25. 2026-06-01 Candidate-Part Finalization Gate Memo

이번 작업은 Deepagents tool을 제한한 뒤에도 남아 있던 마지막 우회 경로를 막은 것이다. Tool search와 document read가 route-bound여도, 모델이 최종 structured draft에 route 밖 `partId`를 직접 써 넣으면 기존 validator는 "registry에 있는 부품"이라는 이유로 받아들일 수 있었다.

문제:

- LED 요청에서 model draft가 OLED 컴포넌트를 추가해도, OLED가 canonical registry에 있으면 단순 `UNKNOWN_PART`로 잡히지 않는다.
- 더 나쁘게는 기존 part capability search가 짧은 `led` 토큰을 `oled` 안의 부분 문자열로 과매칭할 수 있어, LED 요청의 candidate part set에 OLED가 들어갈 여지가 있었다.
- 이 경우 finalization이 "학생 요청/context route가 고른 부품"이 아니라 "registry에 존재하는 모든 부품"을 사실상 허용하게 된다.

변경:

- `tests/unit/agentWorkflow.test.ts`
  - `route-outside candidate parts in an agent draft are blocked before repair or render` 테스트를 추가했다.
  - LED 요청에 unrequested OLED component가 들어간 draft를 scripted agent result로 재현했다.
- `server/agent/circuitTools.ts`
  - `applyCandidatePartGate()`를 추가했다.
  - `ContextPacket.candidateParts` 밖의 partId가 있으면 `CONTEXT_CANDIDATE_PART_NOT_ALLOWED` error를 추가하고 `validatedCurrentPathIds`를 비운다.
- `server/agent/deepAgentRuntime.ts`
  - finalization에서 `validateCircuitSpec()` 다음에 candidate-part gate를 적용한다.
  - `CONTEXT_CANDIDATE_PART_NOT_ALLOWED`는 repair loop를 계속하지 않는 stop condition으로 처리한다.
- `server/agent/deepAgentTools.ts`
  - tool-visible validation 및 render/simulation/markdown compilation도 같은 candidate-part gate를 사용한다.
- `server/context/contextLayer.ts`
  - part scoring에서 `led` 같은 3자 이하 짧은 token은 longer word substring match를 하지 않도록 수정했다.
  - 이로써 `OLED`가 단순 `LED` 요청의 candidate part로 들어오는 과매칭을 줄였다.

TDD 기록:

- RED: `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts`
  - 실패 원인: route 밖 OLED component draft가 context mismatch로 멈추지 않고 repair loop로 들어가 scripted draft가 부족해졌다.
- GREEN: candidate-part gate와 short-token matching 정리 후 같은 target suite가 통과했다.

검증:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
npm run typecheck
npm run check
```

결과:

- Agent workflow target tests: 61 passed.
- Typecheck: passed.
- Full `npm run check`: passed.
  - JavaScript unit tests: 77 passed.
  - TypeScript unit tests: 142 passed.
  - Typecheck: passed.
  - Production build: passed with the existing Vite large chunk warning.
  - Playwright E2E: 52 passed, 8 skipped.
- Agent server restart 후 `/api/agent/health`:
  - `ok=true`
  - `mode=live`
  - `model=gpt-5.5`
  - `provider=openai`
  - `sourceStatus.stale=false`

주의:

- 이 변경은 "registry에 있는 모든 canonical part"를 허용하는 것이 아니라, 현재 요청의 `ContextPacket.candidateParts`에 선택된 part만 허용하도록 finalization boundary를 좁힌 것이다.
- 향후 supported hardware를 늘릴 때도 capability graph, registry, validation, render, simulation, eval, browser evidence가 함께 들어가야 candidate로 안정적으로 승격된다.
- Live Deepagents E2E는 기본 gate에서 계속 opt-in skip 상태다.

## 26. 2026-06-01 Candidate-Gated Fault Detection Tool Memo

This slice closes a remaining context-boundary gap in the Deepagents tool layer.

Problem:

- `validate_circuit_spec`, render compilation, simulation compilation, requirement markdown compilation, and finalization already rejected `CircuitSpec.components[].partId` values outside `ContextPacket.candidateParts`.
- `detect_faults` still called `detectFaults()` directly and only applied the context-coverage gate.
- That meant a LED-scoped request containing an unrequested OLED component could be described as a normal wiring fault such as `MISSING_COMMON_GROUND`, instead of being blocked as a route/context violation.

Change:

- `server/agent/deepAgentTools.ts`
  - `detect_faults` now wraps the deterministic fault report with `applyCandidatePartGate(...)`.
  - Candidate-part gating runs before context-coverage gating, matching the rest of the server-side validation boundary.
- `tests/unit/agentWorkflow.test.ts`
  - Added/verified `Deepagents detect_faults tool applies the same candidate part gate`.

TDD record:

- RED: `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts`
  - Failure: expected `CONTEXT_CANDIDATE_PART_NOT_ALLOWED`, but `detect_faults` returned only `MISSING_COMMON_GROUND`.
- GREEN: applying `applyCandidatePartGate()` in `detect_faults` made the target suite pass.

Verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
npm run typecheck
npm run check
```

Result:

- Agent workflow target tests: 62 passed.
- Typecheck: passed.
- Full `npm run check`: passed.
  - JavaScript unit tests: 77 passed.
  - TypeScript unit tests: 143 passed.
  - Typecheck: passed.
  - Production build: passed with the existing Vite large chunk warning.
  - Playwright E2E: 52 passed, 8 skipped.
- Agent server restart 후 `/api/agent/health`:
  - `ok=true`
  - `mode=live`
  - `model=gpt-5.5`
  - `provider=openai`
  - `sourceStatus.stale=false`

Note:

- This does not make the LLM itself the validator. The LLM can propose a draft, but the server-side deterministic tools remain the authority for route-allowed parts, context coverage, netlist validity, renderability, and current-path simulation eligibility.

## 27. 2026-06-01 Authoritative Current-Path Validation Memo

This slice closes a current-simulation trust gap in the Deepagents tool layer.

Problem:

- `estimate_current_paths` accepted an optional `validationReport` from the caller.
- If the agent supplied a forged `status: "valid"` report, the tool skipped server-side validation and could return current paths for a draft that should have been blocked by candidate/context gates.
- RED reproduction: a LED-scoped candidate set plus an unrequested OLED component produced both LED and OLED current paths when paired with a forged valid validation report.

Change:

- `server/agent/deepAgentTools.ts`
  - `estimate_current_paths` now always reruns `validateWithContext(spec)` before calling `estimateCurrentPaths(...)`.
  - Caller-supplied validation reports remain accepted by the schema for tool-call compatibility, but they are not trusted as authoritative.
  - The tool description now states that server validation is authoritative.
- `tests/unit/agentWorkflow.test.ts`
  - Added `Deepagents current path tool does not trust caller-supplied validation reports`.

TDD record:

- RED: `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts`
  - Failure: expected no current paths, but the tool returned `led-forward-current` and `oled-module-current`.
- GREEN: authoritative `validateWithContext(spec)` in the tool made the target suite pass.

Verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
npm run typecheck
npm run check
```

Result:

- Agent workflow target tests: 63 passed.
- Typecheck: passed.
- Full `npm run check`: passed.
  - JavaScript unit tests: 77 passed.
  - TypeScript unit tests: 144 passed.
  - Typecheck: passed.
  - Production build: passed with the existing Vite large chunk warning.
  - Playwright E2E: 52 passed, 8 skipped.
- Agent server restart 후 `/api/agent/health`:
  - `ok=true`
  - `mode=live`
  - `model=gpt-5.5`
  - `provider=openai`
  - `sourceStatus.stale=false`

Note:

- Current-flow visualization must come from server-validated circuit state, not from an LLM-provided validation artifact. This keeps Run-tab current animation aligned with the same candidate part, context coverage, and electrical validation boundaries used by finalization.

## 28. 2026-06-01 Validation-Gated Netlist Tool Memo

This slice closes another intermediate-artifact trust gap in the Deepagents tool layer.

Problem:

- `build_netlist` returned a raw netlist for any schema-valid `CircuitSpec`, even when the draft contained parts outside the current `ContextPacket.candidateParts`.
- A subagent could therefore see and reason over route-outside wiring before final validation blocked it.
- RED reproduction: a LED-scoped candidate set plus an unrequested OLED component and OLED wiring returned raw OLED nets.

Change:

- `server/agent/deepAgentTools.ts`
  - `build_netlist` now runs `validateWithContext(spec)` first.
  - Valid specs still return the regular netlist shape.
  - Invalid, unsupported, context-insufficient, or candidate-disallowed specs return:
    `{ error: "NETLIST_BLOCKED_BY_VALIDATION", validationReport, netlist: { nets: [] } }`
  - The tool description now states that netlists are exposed only after authoritative server validation.
- `tests/unit/agentWorkflow.test.ts`
  - Added `Deepagents netlist tool blocks route-outside components before exposing nets`.

TDD record:

- RED: `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts`
  - Failure: expected `NETLIST_BLOCKED_BY_VALIDATION`, but `build_netlist` returned raw netlist JSON.
- GREEN: authoritative `validateWithContext(spec)` gate in the tool made the target suite pass.

Verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
npm run typecheck
npm run check
```

Result:

- Agent workflow target tests: 64 passed.
- Typecheck: passed.
- Full `npm run check`: passed.
  - JavaScript unit tests: 77 passed.
  - TypeScript unit tests: 145 passed.
  - Typecheck: passed.
  - Production build: passed with the existing Vite large chunk warning.
  - Playwright E2E: 52 passed, 8 skipped.
- Agent server restart 후 `/api/agent/health`:
  - `ok=true`
  - `mode=live`
  - `model=gpt-5.5`
  - `provider=openai`
  - `sourceStatus.stale=false`

Note:

- Internal server code can still call `buildNetlist()` as part of deterministic validation/fault analysis. The restriction is specifically on the Deepagents-facing `build_netlist` tool so agent-visible intermediate artifacts cannot contradict final validation.

## 29. 2026-06-01 Invalid Requirement Markdown Build Guard Memo

This slice closes a user-facing artifact loophole in the Files tab.

Problem:

- Render and simulation artifacts were already gated on `validationReport.status === "valid"`.
- `compileRequirementMarkdown()` still listed every `CircuitSpec.component` and `CircuitSpec.connection` even when validation was `invalid` or `unsupported`.
- A student could therefore see buildable-looking wiring in the requirement document even after deterministic validation rejected the circuit.
- RED reproduction: an LED draft connected `arduino-uno:D99 -> resistor-1:1`; validation correctly returned `UNKNOWN_PIN`, but the markdown still listed that invalid wire and the rest of the wiring guide.

Change:

- `server/agent/circuitTools.ts`
  - `compileRequirementMarkdown()` now checks `validationReport.status === "valid"` before showing build-ready parts and wiring.
  - Non-valid reports now show `No build-ready parts` and `No build-ready wiring` guidance instead of concrete assembly instructions.
  - Goal, intended behavior, validation errors, warnings, current-path absence, and assumptions remain visible for student remediation.
- `tests/unit/agentWorkflow.test.ts`
  - Added `requirement markdown does not present invalid wiring as build ready`.

TDD record:

- RED: `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts`
  - Failure: expected `No build-ready parts`, but the invalid markdown listed parts and `arduino-uno:D99 -> resistor-1:1`.
- GREEN: the markdown build-ready guard made the target suite pass.

Verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
npm run check
```

Result:

- Agent workflow target tests: 65 passed.
- Full `npm run check`: passed.
  - JavaScript unit tests: 77 passed.
  - TypeScript unit tests: 146 passed.
  - Typecheck: passed.
  - Production build: passed with the existing Vite large chunk warning.
  - Playwright E2E: 52 passed, 8 skipped.
- Agent server restart -> `/api/agent/health`:
  - `ok=true`
  - `mode=live`
  - `model=gpt-5.5`
  - `provider=openai`
  - `sourceStatus.stale=false`

Note:

- This is intentionally stricter than a normal prose summary. If the circuit is not validated, H-eduware must not give the student a parts list or wiring guide that looks ready to assemble.

## 30. 2026-06-01 Invalid Assistant Message Grounding Memo

This slice closes a student-facing copy contradiction in final agent responses.

Problem:

- `finalizeAgentResult()` independently validates every Deepagents draft and blocks invalid render/simulation artifacts.
- It still returned `assistantMessages: [draft.assistantMessage]` unchanged.
- If the LLM draft said "This circuit is valid and ready to build" while server validation rejected the draft, the student could see a build-ready claim next to invalid artifacts.
- RED reproduction: an LED request received a route-outside OLED component. Validation correctly returned `CONTEXT_CANDIDATE_PART_NOT_ALLOWED`, but the assistant message still said the circuit was valid and ready to build.

Change:

- `server/agent/deepAgentRuntime.ts`
  - Added `finalAssistantMessage(...)` and `studentValidationReason(...)`.
  - When `validationReport.status === "invalid"`, finalization replaces the draft assistant text with a locale-aware validation-blocked message.
  - The replacement summarizes common failure classes such as route-outside candidate parts, unknown pins, LED resistor/path errors, power shorts, and missing common ground.
  - Valid and non-invalid responses keep their existing assistant copy.
- `tests/unit/agentWorkflow.test.ts`
  - Added `invalid final validation replaces overconfident assistant draft copy`.

TDD record:

- RED: `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts`
  - Failure: final assistant message was still `This circuit is valid and ready to build. I also added an OLED display.`
- GREEN: invalid finalization now returns validation-grounded copy and suppresses the overconfident draft text.

Verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
npm run typecheck
npm run check
```

Result:

- Agent workflow target tests: 66 passed.
- Typecheck: passed.
- Full `npm run check`: passed.
  - JavaScript unit tests: 77 passed.
  - TypeScript unit tests: 147 passed.
  - Typecheck: passed.
  - Production build: passed with the existing Vite large chunk warning.
  - Playwright E2E: 52 passed, 8 skipped.
- Agent server restart -> `/api/agent/health`:
  - `ok=true`
  - `mode=live`
  - `model=gpt-5.5`
  - `provider=openai`
  - `sourceStatus.stale=false`

Note:

- This makes the chat bubble obey the same server-side truth boundary as Files, PCB, and Run artifacts. A rejected draft can still be useful, but it must be presented as blocked/remediable, not ready to build.

## 31. 2026-06-01 Invalid Share Card Footer Guard Memo

This slice closes a public sharing copy issue.

Problem:

- `createShareCardModel()` already showed an invalid badge as `Needs review`.
- The same invalid card still used the footer `Designed, validated, and shared with H-eduware`.
- That made an invalid/non-running shared snapshot look externally validated in the most shareable asset.

Change:

- `src/shareCard.js`
  - Added `footerLabel(validation, locale)`.
  - Valid share cards keep `Designed, validated, and shared with H-eduware`.
  - Warning share cards say they were shared with validation warnings.
  - Invalid share cards now say they are drafts needing review and avoid the word `validated`.
- `tests/unit/shareCard.test.js`
  - Added `createShareCardModel does not claim invalid snapshots were validated`.

TDD record:

- RED: `node --test tests/unit/shareCard.test.js`
  - Failure: an invalid snapshot still returned `Designed, validated, and shared with H-eduware`.
- GREEN: validation-aware footer copy made the target suite pass.

Verification:

```powershell
node --test tests/unit/shareCard.test.js
npm run check
```

Result:

- Share card target tests: 3 passed.
- Full `npm run check`: passed.
  - JavaScript unit tests: 78 passed.
  - TypeScript unit tests: 147 passed.
  - Typecheck: passed.
  - Production build: passed with the existing Vite large chunk warning.
  - Playwright E2E: 52 passed, 8 skipped.
- Agent server restart was not required because no `server/**` or `agent-context/**` file changed.

Note:

- This keeps the external "brag/share" surface aligned with the validator truth boundary. Students can still share drafts, but the generated card cannot imply that an invalid draft was verified.

## 32. 2026-06-01 Invalid Shared Import Markdown Guard Memo

This slice closes a Files-tab import loophole for public shares.

Problem:

- `projectFromShareSnapshot()` correctly marked invalid public snapshots as non-running drafts.
- `shareRequirementMarkdown()` still returned raw `snapshot.requirementMarkdown` whenever it existed.
- A malicious or stale invalid share could therefore import a Files tab document saying "ready to assemble" with raw wiring such as `arduino-uno:D99 -> led-1:A`.

Change:

- `src/shareImport.js`
  - `shareRequirementMarkdown(snapshot, locale)` now checks `isBuildReadyShare(snapshot)` before trusting raw public markdown.
  - Build-ready means `snapshot.status === "valid"`, `snapshot.validation.status === "valid"`, and `snapshot.simulation.available === true`.
  - Non-build-ready imports receive generated review markdown that says the shared circuit is not validated for assembly/render/current simulation.
  - Validation warnings, unsupported items, and missing simulation state remain visible as review notes.
- `tests/unit/shareImport.test.js`
  - Added `projectFromShareSnapshot suppresses build-ready markdown for invalid shares`.

TDD record:

- RED: `node --test tests/unit/shareImport.test.js`
  - Failure: invalid imported markdown still contained `This circuit is ready to assemble`, `## Connections`, and `arduino-uno:D99 -> led-1:A`.
- GREEN: invalid import markdown now suppresses build-ready wiring and keeps validation review notes.

Verification:

```powershell
node --test tests/unit/shareImport.test.js
npm run check
```

Result:

- Share import target tests: 3 passed.
- Full `npm run check`: passed.
  - JavaScript unit tests: 79 passed.
  - TypeScript unit tests: 147 passed.
  - Typecheck: passed.
  - Production build: passed with the existing Vite large chunk warning.
  - Playwright E2E: 52 passed, 8 skipped.
- Agent server restart was not required because no `server/**` or `agent-context/**` file changed.

Note:

- This does not prevent students from importing a shared draft for inspection. It prevents the imported Files tab from presenting unvalidated public markdown as assembly instructions.

## 33. 2026-06-01 Invalid Shared Import Render Guard Memo

This slice closes the matching PCB/render import loophole for public shares.

Problem:

- The previous guard stopped invalid shared snapshots from showing raw build-ready markdown in the Files tab.
- `projectFromShareSnapshot()` still imported `renderPlan.parts`, `renderPlan.connections`, and `floatingCards` from invalid public snapshots.
- That meant an invalid or stale shared draft could still look like a real assembled circuit in the PCB tab even though validation and simulation were blocked.

Change:

- `src/shareImport.js`
  - Added a `buildReadyShare` gate for renderable project data.
  - Build-ready means `snapshot.status === "valid"`, `snapshot.validation.status === "valid"`, and `snapshot.simulation.available === true`.
  - Non-build-ready imports now set `parts`, `connections`, and `floatingCards` to empty arrays.
  - Non-build-ready imports add a `SHARED_SNAPSHOT_NOT_BUILD_READY` render warning explaining that PCB visualization and current-flow replay are hidden until review.
- `tests/unit/shareImport.test.js`
  - Added `projectFromShareSnapshot blocks renderable PCB data for invalid shares`.
  - Updated the existing invalid draft test to expect hidden PCB data instead of imported parts.

TDD record:

- RED: `node --test tests/unit/shareImport.test.js`
  - Failure: invalid imported snapshots still exposed Arduino/LED render parts from `renderPlan.parts`.
- GREEN: invalid imports now keep Files review notes but hide renderable PCB data and expose a student-facing warning.

Verification:

```powershell
node --test tests/unit/shareImport.test.js
npm run check
```

Result:

- Share import target tests: 4 passed.
- Full `npm run check`: passed.
  - JavaScript unit tests: 80 passed.
  - TypeScript unit tests: 147 passed.
  - Typecheck: passed.
  - Production build: passed with the existing Vite large chunk warning.
  - Playwright E2E: 52 passed, 8 skipped.
- Agent server restart was not required because no `server/**` or `agent-context/**` file changed.

Note:

- This keeps imported public shares aligned across all surfaces: share card, Files tab, PCB rendering, and Run/current-flow simulation now obey the same build-ready boundary.

## 36. 2026-06-01 Agent Context v2 Information Architecture Memo

Planned/implemented a bundle-first `agent-context/v2` structure for Deepagents.

Key points:

- v2 introduces capability bundles with `BUNDLE.md`, `manifest.json`, and `evals.jsonl`.
- Deepagents retrieval should select bundle IDs first, then load compact summaries and canonical refs.
- v2 keeps heavy shared data out of the prompt and inside deterministic tools.
- v1 files remain as shared canonical data during migration.
- Goal is to reduce context bloat while strengthening source-of-truth boundaries.

## 37. 2026-06-01 Context Source Bundle Collection Memo

Added a source-backed hardware context collection layer on top of the v2 context architecture.

Key points:

- `SourceClaim` records capture atomic official/vendor/educational source facts for canonical hardware values.
- `HardwareSupportBundle` records group source claims with canonical artifacts by supported capability.
- Capability promotion now requires `source-claims` in addition to registry, validation, render, simulation, eval, and browser evidence.
- Runtime Deepagents still consume canonical context data; source claims are for audits, maintainers, and hardware promotion.
- The initial supported starter set now has 10 source claims and 5 support bundles with no missing referenced claim IDs.
- Planned/unsupported capabilities remain blocked, now with explicit missing source-bundle evidence.

Verification:

```powershell
npm exec -- tsx --test tests/unit/sourceClaims.test.ts
npm run audit:sources
npm exec -- tsx --test tests/unit/contextLayer.test.ts
npm exec -- tsx --test tests/unit/contextCoverage.test.ts
npm run audit:capabilities
npm run eval:generalization:report
npm run check
```

Result:

- Source claim tests: 5 passed.
- `audit:sources`: 10 claims, 5 bundles, no missing bundle claim IDs.
- Context layer tests: 12 passed.
- Context coverage tests: 21 passed.
- Capability audit: 5 supported capabilities ready, 6 planned/unsupported blocked.
- Generalization report: 18 rows, observed failure classes matched expected classes.
- Full `npm run check`: passed.
  - JavaScript unit tests: 80 passed.
  - TypeScript unit tests: 165 passed.
  - Typecheck: passed.
  - Production build: passed with the existing Vite large chunk warning.
  - Playwright E2E: 52 passed, 8 skipped.

## 38. 2026-06-01 Legacy Context Layer Preservation Memo

Archived the existing root context layer for comparison before Deepagents workflow optimization.

Change:

- Added `agent-context/legacy/v1/` as a non-runtime preservation snapshot.
- The snapshot excludes `agent-context/v2/`, but keeps the root v1 canonical data, routing, policies, schemas, evals, skills, and source provenance files.
- Added `agent-context/legacy/README.md` and `agent-context/legacy/v1/README.md` to mark the snapshot as comparison-only.
- Updated `agent-context/index.md` to state that `legacy/v1/` is not a runtime retrieval root.
- Added a structure test that verifies the legacy snapshot exists and contains the expected v1 index data.

Verification:

```powershell
npm exec -- tsx --test tests/unit/contextLayerStructure.test.ts
```

## 39. 2026-06-01 Deepagents Source Bundle Workflow Memo

Rebuilt the Deepagents backend mechanism around source-backed support bundle evidence.

Key points:

- Added `SupportBundleEvidence` to the agent schema and `ContextPacket`.
- `ContextPacket` now traces and prompts concise request-scoped support bundle evidence.
- Supported synthesis now requires complete support bundle evidence; incomplete supported evidence removes `valid_circuit_synthesis` and is blocked by the existing context coverage gate.
- Added `load_support_bundle_evidence`, bounded to current capability matches.
- Passed support bundle evidence into Deepagents runtime tools and subagents.
- Tightened coordinator/subagent prompts to check bundle evidence before build-ready wiring, render, or current-flow claims.
- Kept v2 prompt budget intact by compacting support bundle evidence for bundle-routed prompts.

Verification:

```powershell
npm exec -- tsx --test tests/unit/supportBundleEvidence.test.ts
npm exec -- tsx --test tests/unit/contextPacket.test.ts tests/unit/contextCoverage.test.ts tests/unit/agentWorkflow.test.ts
npm exec -- tsx --test tests/unit/contextSufficiencyEval.test.ts tests/unit/generalizationEval.test.ts
npm run audit:context:v2
npm run audit:sources
npm run audit:capabilities
npm run check
```

Result:

- Support bundle evidence tests: 3 passed.
- Context packet/coverage/agent workflow targeted tests: 96 passed.
- Context sufficiency/generalization eval tests: 6 passed.
- v2 audit: 3 migrated bundles, 2 supported v2 bundles, 1 planned v2 bundle.
- Source audit: 10 claims, 5 support bundles, no missing bundle claim IDs.
- Capability audit: 5 supported capabilities ready, 6 planned/unsupported blocked.
- Full `npm run check`: passed.
  - JavaScript unit tests: 80 passed.
  - TypeScript unit tests: 173 passed.
  - Typecheck: passed.
  - Production build: passed with the existing Vite large chunk warning.
  - Playwright E2E: 52 passed, 8 skipped.

## 40. 2026-06-01 Legacy Runtime Decoupling and Browser Source Bundle Evidence Memo

This slice disconnects the preserved legacy context snapshot from the active runtime surface and reflects the new source-bundle-backed context evidence in the product UI.

Key points:

- `agent-context/legacy/v1/` remains a comparison-only archive, and active context metadata plus v2 routes are tested to avoid `legacy/` or `v1` runtime source ids.
- Files evidence now shows a student-facing source bundle row derived from `sources:support-bundle:*` context trace entries.
- Context trace markdown now has a dedicated source bundle evidence section with capability id, status, and reason.
- Browser QA protocol now explicitly requires source bundle evidence alongside context coverage.

Verification:

```powershell
npm exec -- tsx --test tests/unit/contextQaArtifactBundle.test.ts tests/unit/contextLayerStructure.test.ts tests/unit/contextPacket.test.ts tests/unit/agentWorkflow.test.ts
npm run test:e2e -- --grep "LED draft follow-up|browser verification protocol"
npm run check
```

Browser evidence:

- In-app browser E2E against `http://127.0.0.1:4173/` with the current-runtime scripted agent boundary showed `digital-light-output: ready` in Files evidence.
- Opening `Context trace.md` showed `Source bundle evidence` and `digital-light-output`.
- Screenshot: `test-results/source-bundle-evidence-browser.png`

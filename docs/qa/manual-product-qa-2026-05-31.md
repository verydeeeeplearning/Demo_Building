# H-eduware Manual Browser Product QA

## Scope

This document records browser-based QA cycles executed from `docs/superpowers/plans/2026-05-31-comprehensive-browser-product-qa.md`.

Targets:

- Frontend: `http://127.0.0.1:4173/`
- Agent server: `http://127.0.0.1:8787/`
- Browser surface: Codex in-app browser

## 2026-05-31 Cycle

### Runtime Baseline

- Frontend was running on `127.0.0.1:4173`.
- Agent health reported `defaultMode=deepagents-live`, `model=gpt-5.5`, and `hasServerKey=true`.
- Risk observed: the live server process could be older than the latest source edits, so browser QA could expose stale server behavior.

### Browser Scenarios Executed

1. Loaded the baseline page in the in-app browser.
2. Submitted `Arduino Uno D8 LED blink` through the visible chat UI.
3. Verified Deepagents Live draft creation:
   - D8 LED draft generated.
   - Confirm button appeared.
   - No raw `Deepagents did not return...` error appeared.
4. Confirmed the draft and opened the project.
5. Verified Files tab requirement document.
6. Verified PCB tab:
   - Canvas exists.
   - Inspector rail shows D8/LED/resistor context.
   - D9 is not present after grounding fix.
7. Clicked Run:
   - Simulation/current text appears.
   - D8 remains visible.
   - D9 does not appear.
8. Opened simulation tutor chat:
   - Drawer opens from the right rail.
   - Suggested question creates a tutor response.
   - No raw runtime error appears.
9. Reloaded new project baseline:
   - Placeholder is now a generic Arduino Uno D8 LED example.
   - OLED-specific new-project copy is no longer present.

### P1 Fixed: LED Current Flow Endpoint Mismatch

Before fix, browser QA showed a valid requirement document with:

- Connections: `uno:D8 -> r1:1`, `r1:2 -> led:A`, `led:K -> uno:GND`
- Current Flow: `from uno:D9 to uno:GND`

Fix:

- Added `src/agentArtifactGrounding.js`.
- Applied `groundAgentResultArtifacts()` in `src/main.js` before storing `agentResult`.
- The grounding layer compares `SimulationPlan.currentPaths` against the validated `CircuitSpec` and repairs LED current endpoints and requirement markdown.
- It also rewrites visible `estimate_current_paths` event summaries so stale D9 tool text is not shown to students.

Verification:

- Browser retest after fix: `hasD8CurrentFlow=true`, `hasD9CurrentFlow=false`, `rawRuntimeError=false`.
- `tests/unit/agentArtifactGrounding.test.js` covers D9-to-D8 repair.
- `npm run check` passed.

### P2 Fixed: OLED-Specific Tutor Run Copy

Before fix, generic run guidance could still say `OLED output`.

Fix:

- Changed tutor run guidance in `src/circuitInspector.js` to use generic `simulation output` wording.

Verification:

- `tests/unit/circuitInspector.test.js` covers generic simulation-output wording.
- `npm run check` passed.

### P2 Fixed: Generic Resistor Tutor Explanation

Before fix, the resistor tutor answer said the part merely supported the lesson context, which was too vague for students.

Fix:

- Added part-specific tutor enrichment for resistor, LED, Arduino, breadboard, and OLED in `src/circuitInspector.js`.
- Resistor answers now explain current limiting, overcurrent risk, and why the resistor is required for valid LED current simulation.

Verification:

- `tests/unit/circuitInspector.test.js` covers concrete resistor explanations.
- `npm run check` passed.

### P2 Fixed: OLED-Oriented New Project Placeholder

Before fix, the new-project placeholder and default planning steps were still OLED-specific.

Fix:

- Updated `src/locales/ko.js` and `src/locales/en.js`.
- Korean placeholder now uses a generic LED/D8 example.
- New-project landing copy refers to a prepared example circuit rather than an Arduino OLED demo.
- Empty-project planning steps now use generic requirement, parts, connection, validation, and simulation phases instead of `I2C OLED` steps.

Verification:

- Browser retest showed the generic Arduino Uno D8 LED placeholder.
- Browser retest showed `hasOledInNewProjectCopy=false`.
- Browser retest showed `hasGenericPlan=true` and `hasOledPlanResidue=false`.
- `npm run check` passed.

## 2026-06-01 Cycle

### P2 Fixed: PCB Canvas Started Below Fold On Narrow Viewports

Before fix, browser QA showed that after opening the PCB tab on a narrow viewport, the WebGL canvas existed but started far below the visible screen. Students could reasonably think the circuit visualization was missing.

Fix:

- Updated the mobile/narrow layout in `src/styles.css` so `.workbench.is-pcb` places the center stage before the inspector and AI panel.
- Added `focusPcbStageOnNarrowScreens()` in `src/main.js` so PCB tab activation and Run activation bring the stage into view on narrow screens.
- Added an E2E regression in `tests/e2e/features.spec.js` that asserts the PCB canvas is in the initial viewport after the PCB tab is opened.

Verification:

- Targeted Playwright test `PCB tab puts the circuit canvas in the initial viewport on narrow screens` passed on desktop and mobile.
- Targeted Playwright demo path passed on desktop and mobile.
- In-app browser verification showed `canvasInInitialViewport=true`, canvas top `0`, active tab `회로`, D8 present, and D9 absent.
- In-app browser Run/tutor verification still passed after the layout change.

### P2 Fixed: Demo Transcript Reused The Generic Placeholder

The new generic placeholder accidentally appeared as the scripted demo student's initial idea, making the OLED demo transcript mention an LED request.

Fix:

- Added locale-specific `interview.demoIdea`.
- Updated `demoInterviewState()` to use `interview.demoIdea` instead of `aiPanel.ideaPlaceholder`.
- Added E2E assertions that the demo AI panel contains OLED/event-name context and does not contain the LED placeholder.

Verification:

- In-app browser demo transcript now starts with the OLED event-name idea.
- Browser check showed `hasLedPlaceholderAsStudentMessage=false` and `hasOledIdea=true`.
- Targeted demo E2E passed on desktop and mobile.

### Manual QA Run Artifact

Created a plan-format QA run artifact at:

- `test-results/manual-product-qa/20260531-161341Z/qa-log.md`
- `test-results/manual-product-qa/20260531-161341Z/agent-health.json`
- `test-results/manual-product-qa/20260531-161341Z/dom-state.json`
- `test-results/manual-product-qa/20260531-161341Z/screenshot-metrics.json`
- `test-results/manual-product-qa/20260531-161341Z/screenshots/`

The run marks Scenarios A-K, records agent health, records DOM state, and stores six nonblank screenshot artifacts:

- baseline
- Files tab after build
- PCB tab top viewport
- PCB canvas viewport
- inspector tutor drawer
- Run state

Secret scan over the QA run artifacts found no raw API key pattern.

### P3 Mitigated: Agent Runtime Staleness Is Now Visible

Browser QA showed that the currently running live server on `127.0.0.1:8787` could be older than the latest source code. The first implementation added source freshness metadata to the new server code, but the real browser check exposed a stricter case: an already-running old server does not know how to return that metadata at all.

Fix:

- Added `server/serverHealth.ts` and extended `GET /api/agent/health` with non-secret runtime metadata:
  - `serverStartedAt`
  - `serverUptimeMs`
  - `sourceStatus.stale`
  - `sourceStatus.staleSourceFiles`
- Updated `src/aiClient.js` to forward the health metadata to the frontend runtime state.
- Updated `src/main.js` so the AI runtime label warns in both cases:
  - New server reports `sourceStatus.stale=true`: `재시작 필요`.
  - Old server cannot report source freshness metadata: `재시작 확인 필요`.
- Added E2E coverage for both stale-source health and legacy-health responses.

Browser verification:

- Reloaded `http://127.0.0.1:4173/` in the in-app browser while the live server returned the older health format.
- The AI runtime label showed `Deepagents Live · gpt-5.5 · 재시작 확인 필요`.
- The warning body showed: `Agent 서버가 이전 health 형식을 반환하고 있어 최신 코드가 반영됐는지 확인할 수 없습니다. 서버를 재시작한 뒤 다시 테스트하세요.`
- Restarted the local Agent server from `.local/agent.env` without printing secrets.
- After restart, `GET /api/agent/health` returned `sourceStatus.stale=false`.
- Reloaded the browser again and verified the AI runtime label returned to `Deepagents Live · gpt-5.5` with no stale warning.
- In-app screenshot capture timed out twice through the Browser plugin, so DOM state is recorded here and Playwright E2E remains the authoritative visual automation path.

Verification:

- `node --test tests/unit/aiClient.test.js` passed.
- `npx playwright test tests/e2e/features.spec.js -g "AI runtime warns"` passed on desktop and mobile.
- `npm run check` passed.

### P2 Fixed: Share Button Was A Dead Shell Control

Scenario K requires every visible topbar control to either work or clearly communicate its state. Browser QA showed that the `공유` button was visible and enabled but had no `data-action`, test id, or click behavior.

Fix:

- Added `src/shareModal.js`.
- Added `data-action="share"` and `data-testid="share-project"` to the topbar Share button.
- Added `openShareModal()` in `src/main.js`.
- Added Korean and English share copy in `src/locales/ko.js` and `src/locales/en.js`.
- Added modal styling in `src/styles.css`.
- New-project state now opens a clear empty-state modal instead of doing nothing.
- Loaded-project state opens a share summary modal with copyable markdown and an explicit `공개 링크 준비 중` / `Public link coming soon` disabled action.

Browser verification:

- Clicked `공유` on a new project and verified a modal explains that no shareable circuit exists yet.
- Loaded the demo project, clicked `공유`, and verified the modal contains `Arduino OLED 이름 표시`, a copyable markdown summary, a copy button, and public-link-coming-soon state.
- Verified the page URL did not change and no accidental reload occurred.

Verification:

- `npx playwright test tests/e2e/features.spec.js -g "share button"` passed on desktop and mobile.
- `npm run check` passed.

### P1 Fixed: Post-Build Revision Used Draft Context Instead Of Built Artifact Context

Scenario H expects a revision such as `LED 옆에 버튼도 추가해줘` to use the current built circuit as the base. E2E coverage exposed that after building a valid draft, the revision request still sent `conversationContext.currentArtifact.source = "draft"` because `state.agentResult` remained available after build.

Fix:

- Changed `submitAgentMessage()` so `hasBuildableDraft` is true only while `state.awaitingConfirmation` is true.
- Changed `buildConversationContext()` to prefer `artifactSnapshotFromProject(..., "built-project")` when a project is already loaded.
- Added mocked E2E coverage proving the revision request sends:
  - `message` containing the revision request.
  - `conversationContext.currentArtifact.source === "built-project"`.
  - current `circuitSpec` and `simulationPlan`.
  - prior LED turn history.

Verification:

- `npx playwright test tests/e2e/features.spec.js -g "post-build revision"` passed on desktop and mobile.
- `npm run check` passed.

### Scenario J/K Browser Copy Check

Subagent review flagged possible mojibake in the part library separator. Browser verification did not reproduce it in the actual DOM.

Observed DOM:

- Library title: `3D 부품 132개`
- Library meta examples: `마이크로컨트롤러 보드 · 핀 6개`
- `hasMojibake=false` for the sampled visible library text.

### P1 Fixed: Unsafe Requests Recover Safely Even When Live Agent Structured Output Fails

Scenario I requires unsafe high-voltage requests to be refused or redirected to safe low-voltage alternatives, and must not produce render/current simulation artifacts. A live browser test with `220V 콘센트에 직접 연결해서 LED 켜고 싶어` initially blocked build/render, but the visible assistant fallback was too generic when the live Agent failed to return structured output.

Fix:

- Extended `src/agentErrorMessages.js` so unsafe student messages get a safety-specific fallback even when the underlying error is `AGENT_STRUCTURED_OUTPUT_MISSING`.
- Passed the original student message into `formatAgentErrorMessage()` from `src/main.js`.
- Sanitized visible agent event chips in `src/main.js` so internal terms such as `DEEPAGENTS COORDINATOR` and `structured circuit draft` do not appear in student-facing decision chips.
- Added default E2E coverage for:
  - unsupported/unsafe results producing no confirm button, no Run enablement, no canvas, and no requirement artifact.
  - unsafe structured-output failures still showing safety/low-voltage guidance.

Browser verification:

- Submitted `220V 콘센트에 직접 연결해서 LED 켜고 싶어` through the real in-app browser with the live Agent server running.
- Verified `confirmCount=0`, `runDisabled=true`, `canvasCount=0`.
- Verified the visible answer says the request has 감전/화재/고전압 risk and suggests Arduino 5V, GND, 220Ω resistor, and LED as a safe low-voltage alternative.
- Verified `rawHits=[]` for `Deepagents did not return`, `structured circuit draft`, `stack trace`, and `DEEPAGENTS COORDINATOR`.

Verification:

- `node --test tests/unit/agentErrorMessages.test.js` passed.
- `npx playwright test tests/e2e/features.spec.js -g "unsafe"` passed on desktop and mobile.

### P2 Fixed: Language Toggle After Build Now Has Direct Artifact Preservation Coverage

Scenario J requires KOR/ENG switching to preserve the built artifact, not reset the project.

Fix:

- Added E2E coverage that builds the mocked LED circuit, switches ENG, opens PCB, then switches back to KOR.
- The test asserts Run remains enabled, the requirement document still contains LED/D9/GND, the PCB canvas remains visible, and the visible body text has no mojibake markers.

Browser verification:

- Loaded the demo project in the in-app browser.
- Switched KOR -> ENG -> KOR.
- Verified the project title changes between `Arduino OLED 이름 표시` and `Arduino OLED name display`, Run stays enabled, requirement content remains present, and `hasMojibake=false`.

Verification:

- `npx playwright test tests/e2e/features.spec.js -g "language toggle preserves"` passed on desktop and mobile.

## Remaining Risks

### P3: In-App Browser Screenshot Capture Is Flaky On WebGL Canvas

Several in-app Browser screenshot calls timed out when the WebGL canvas was in view. DOM and hit-testing checks still worked, and Playwright E2E canvas verification passed.

Recommended next step:

- Keep Playwright pixel checks as the authoritative canvas evidence.
- For manual QA, store DOM state and Playwright screenshots from the automated E2E runner when in-app screenshot capture fails.

### P3: Live Server Restart Still Required After Server Source Changes

The app now exposes stale or legacy server state visibly, but it cannot hot-reload an already-running `tsx server/index.ts` process. After server-side source edits, the local Agent server still needs to be restarted before validating live Deepagents behavior.

Recommended next step:

- Restart the Agent server whenever `server/**` or `agent-context/**` changes.
- Treat `재시작 필요` or `재시작 확인 필요` in the AI runtime label as a hard QA blocker for live behavior validation.

## Verification Summary

Latest targeted checks:

```powershell
npx playwright test tests/e2e/features.spec.js -g "PCB tab puts the circuit canvas in the initial viewport"
npx playwright test tests/e2e/demo.spec.js -g "student can complete"
```

Both targeted checks passed on desktop and mobile.

Latest full gate before the 2026-06-01 follow-up fixes:

```powershell
npm run check
```

Earlier result:

- 55 JavaScript unit tests passed.
- 77 TypeScript unit tests passed.
- Typecheck passed.
- Production build passed.
- Playwright E2E: 24 passed, 8 live-only tests skipped.

Latest full gate after the 2026-06-01 follow-up fixes:

```powershell
npm run check
```

Result:

- 57 JavaScript unit tests passed.
- 80 TypeScript unit tests passed.
- Typecheck passed.
- Production build passed.
- Playwright E2E: 40 passed, 8 live-only tests skipped.

## 2026-06-01 Browser Recheck 4

### Scope

This recheck was run because the product QA must be verified through the browser, not only by code inspection or unit tests.

Artifacts:

- `qa-artifacts/manual-product-qa/20260601-browser-recheck-4/qa-log.md`
- `qa-artifacts/manual-product-qa/20260601-browser-recheck-4/agent-health.json`
- `qa-artifacts/manual-product-qa/20260601-browser-recheck-4/live-browser-e2e.log`
- `qa-artifacts/manual-product-qa/20260601-browser-recheck-4/npm-run-check.log`
- `qa-artifacts/manual-product-qa/20260601-browser-recheck-4/in-app-dom-state.json`
- `qa-artifacts/manual-product-qa/20260601-browser-recheck-4/screenshots/in-app-pcb-chat.jpg`
- `qa-artifacts/manual-product-qa/20260601-browser-recheck-4/screenshots/in-app-run.jpg`

### Browser Issues Found

1. Live OLED browser E2E opened the context trace document correctly, but the test asserted English-only labels (`Coverage`, `Status: sufficient`) while the Korean UI renders `참고 자료 확인`, `확인 결과`, and `상태: sufficient`.
2. The unsafe high-voltage browser flow showed a safe student-facing answer, but the server returned `502` when the live model did not produce a structured draft. This left a browser console network error even though the visible UI recovered.

### Fixes

- Updated `tests/e2e/live-agent.spec.js` to accept Korean and English context coverage labels.
- Changed the context trace file click to use `[data-file-id="deepagent-context-trace"]` instead of text matching, avoiding strict-mode ambiguity between file name and path.
- Added an unsupported/safety preflight in `server/agent/deepAgentRuntime.ts`.
- Added `tests/unit/agentWorkflow.test.ts` coverage proving unsafe high-voltage requests return `unsupported` without render parts or current paths before consuming live drafts.

### Browser Verification

Live Playwright browser E2E:

```powershell
$env:RUN_LIVE_E2E='1'
npx playwright test tests/e2e/live-agent.spec.js --project=desktop-chromium --reporter=line
```

Result:

- 3 passed.
- Live API returned a validated OLED circuit with render/current artifacts.
- Live UI built, rendered, opened Files/context trace/PCB, and ran the simulation.
- Unsafe high-voltage request was refused without enabling build.

In-app browser visual check:

- Loaded demo project.
- Opened PCB tab.
- Opened circuit tutor drawer.
- Captured `in-app-pcb-chat.jpg`.
- Ran simulation.
- Captured `in-app-run.jpg`.

Recorded DOM:

- `canvasCount=1`
- `canvasReady=true`
- `runText=RALPHTON BUSAN`
- `bodyHasSecret=false`
- `errorLogCount=0`

### Full Gate

```powershell
npm run check
```

Result:

- JavaScript unit tests: 57 passed.
- TypeScript unit tests: 80 passed.
- Typecheck: passed.
- Production build: passed.
- Playwright E2E: 40 passed, 8 skipped.

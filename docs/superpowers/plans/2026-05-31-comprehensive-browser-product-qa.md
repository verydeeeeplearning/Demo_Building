# H-eduware Comprehensive Browser Product QA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검수자가 실제 브라우저에서 H-eduware 웹앱을 기능별로 조작하면서 UI, agent/API 응답, 서버 로그, 화면 시각화를 함께 확인하고 원인을 재현 가능한 이슈로 분류한다.

**Architecture:** 이 계획은 제품 검수 계획이며, 기본 앱 구조를 바꾸지 않는다. 검수는 `Vite frontend`, `Node Deepagents server`, `context layer`, `three.js stage`, `Playwright/browser`를 함께 관찰하는 방식으로 수행한다. 각 기능군은 “브라우저에서 학생처럼 조작 → DOM/스크린샷/콘솔/API/서버 로그 확인 → pass/fail/원인 후보 기록”의 동일한 루프를 따른다.

**Tech Stack:** Vanilla JavaScript, Vite, three.js, TypeScript server, Deepagents, Zod, Node test runner, Playwright, Codex in-app Browser.

---

## 1. Why This QA Plan Exists

최근 수동 검수에서 자동 E2E만으로는 잡히기 어려운 문제가 확인됐다.

- UI 채팅은 정상처럼 보이지만 server-side simulation artifact가 `D8` 연결을 `D9` current path로 표시할 수 있다.
- 자연어 확인은 라우팅상 정상 처리되더라도, 화면 문구에는 OLED demo residue가 남을 수 있다.
- PCB canvas는 nonblank여도 viewport에서 안 보이거나, inspector drawer가 stage를 가려 실제 학생 경험이 나쁠 수 있다.
- Chat-based tutor는 artifact-grounded route로 가더라도 문구가 현재 회로 타입을 충분히 반영하지 못할 수 있다.
- 서버 live process가 오래 떠 있으면 코드 수정 후 browser UI는 최신이지만 API server는 이전 로직으로 응답할 수 있다.

따라서 앞으로의 검수는 `npm run check`만으로 종료하지 않는다. 반드시 실제 웹앱 브라우저 조작과 서버 로그를 함께 보고, 문제를 다음 계층 중 어디에서 발생했는지 분류한다.

1. Student input routing
2. Deepagents output
3. Context packet / context layer retrieval
4. Deterministic validation / netlist / simulation tools
5. Frontend state transition
6. Files tab document rendering
7. PCB / three.js rendering
8. Inspector tutor / chat-based UI
9. Korean/English product copy
10. Runtime/dev-server lifecycle

---

## 2. Scope

### In Scope

- 실제 웹앱 `http://127.0.0.1:4173/` 기반 기능 검수
- 실제 또는 fixture Deepagents API `http://127.0.0.1:8787/` 기반 agent flow 검수
- 학생 chat UI: 일반 설계 상담, 자연어 승인, follow-up, revision, unsupported request
- Files tab: requirement markdown, context trace, warning docs
- PCB tab: canvas visibility, part/wire rendering, inspector rail, circuit tutor drawer
- Run flow: simulation output label, current-flow animation visibility, invalid simulation blocking
- 한글/영문 언어 전환과 자연스러운 한글 copy
- 서버 로그, browser console log, network/API payload, screenshot artifact 수집
- 기존 자동 harness: `npm run check`, targeted unit/e2e

### Out of Scope

- SPICE급 아날로그 시뮬레이션 정확도
- 실제 하드웨어 펌웨어 업로드
- 인증/배포/결제 같은 아직 제품에 없는 기능
- 지원되지 않는 planned hardware family를 supported로 승격하는 구현

---

## 3. Files and Artifacts

### Read During QA

- `docs/coworking_handoff_2026-05-31.md`
  - 지금까지의 구현 흐름과 known risk 확인.
- `docs/browser_generalization_verification.md`
  - 기존 browser verification baseline.
- `docs/superpowers/plans/2026-05-31-conversation-state-artifact-grounding-led-validator.md`
  - conversation state, current artifact grounding, LED validator 기준.
- `src/main.js`
  - UI state, submit route, build sequence, tab/inspector behavior.
- `src/conversationRouting.js`
  - 학생 발화 route 분류.
- `src/circuitInspector.js`
  - local tutor copy와 target description.
- `src/stageScene.js`
  - three.js rendering, current path overlay.
- `server/agent/deepAgentRuntime.ts`
  - Deepagents prompt/output/finalization.
- `server/agent/circuitTools.ts`
  - validation, netlist, render plan, simulation plan, requirement markdown.
- `server/context/contextPacket.ts`
  - context layer retrieval and prompt grounding.

### Create During QA

- `test-results/manual-product-qa/YYYYMMDD-HHMM/qa-log.md`
  - 사람이 읽는 QA run log.
- `test-results/manual-product-qa/YYYYMMDD-HHMM/screenshots/*.png`
  - browser screenshots.
- `test-results/manual-product-qa/YYYYMMDD-HHMM/api/*.json`
  - health/message/explain-target response snapshots with secrets redacted.
- `test-results/manual-product-qa/YYYYMMDD-HHMM/logs/*.log`
  - server/dev console excerpts.
- `test-results/manual-product-qa/YYYYMMDD-HHMM/issues.md`
  - fail/pass-with-warning issue list.

### Optional Automation Files To Add Later

Do not add these until repeated manual runs show stable patterns.

- `scripts/manualQaCapture.mjs`
  - Browser screenshot/log capture helper.
- `tests/e2e/product-qa.spec.js`
  - Promotion of repeated manual QA scenarios into automated Playwright checks.

---

## 4. Environment Setup

### Task 1: Confirm Runtime Processes

**Files:**
- Read: `package.json`
- Read: `server/index.ts`
- Output: `test-results/manual-product-qa/<run-id>/qa-log.md`

- [ ] **Step 1: Create a run id**

Use this convention:

```text
manual-product-qa-YYYYMMDD-HHMM
```

Example:

```powershell
$RunId = "manual-product-qa-20260531-2315"
New-Item -ItemType Directory -Force "test-results/manual-product-qa/$RunId/screenshots"
New-Item -ItemType Directory -Force "test-results/manual-product-qa/$RunId/api"
New-Item -ItemType Directory -Force "test-results/manual-product-qa/$RunId/logs"
```

- [ ] **Step 2: Check frontend and agent ports**

Run:

```powershell
Get-NetTCPConnection -LocalPort 4173,8787 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,State,OwningProcess
```

Expected:

```text
4173 Listen  <vite node pid>
8787 Listen  <agent node pid>
```

If either port is missing, start it:

```powershell
npm run dev -- --port 4173 --strictPort
npm run agent:dev
```

- [ ] **Step 3: Capture server health**

Run:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/agent/health" -TimeoutSec 5 |
  ConvertTo-Json -Depth 8
```

Expected live server:

```json
{
  "ok": true,
  "defaultMode": "deepagents-live",
  "model": "gpt-5.5",
  "hasServerKey": true
}
```

Expected local/mock/offline development server:

```json
{
  "ok": false,
  "requiredEnv": ["OPENAI_API_KEY", "H_EDUWARE_AGENT_MODEL"]
}
```

Record which mode is used. Do not mix live conclusions with fixture/mock conclusions.

- [ ] **Step 4: Record process staleness risk**

Run:

```powershell
Get-Process -Id <pid> | Select-Object Id,ProcessName,StartTime,Path
```

If server started before the latest source edit, mark:

```text
Risk: API server process may be stale. Restart before validating server-side fixes.
```

---

## 5. Browser Instrumentation Protocol

### Task 2: Open the Webapp and Capture Baseline

**Files:**
- Output: `test-results/manual-product-qa/<run-id>/screenshots/00-baseline.png`
- Output: `test-results/manual-product-qa/<run-id>/logs/browser-console.log`

- [ ] **Step 1: Open the app**

Use Codex in-app Browser:

```text
http://127.0.0.1:4173/
```

Expected visible state:

- Topbar shows H-eduware.
- `문서` and `회로` tabs are visible.
- `KOR / ENG` language controls are visible.
- AI mode shows `Deepagents Live · gpt-5.5` if live server is configured.
- Empty project landing is visible before a circuit is built.

- [ ] **Step 2: Capture DOM state**

Record:

```text
URL:
Topbar project title:
Active tab:
AI runtime label:
Visible prompt placeholder:
Console errors:
```

- [ ] **Step 3: Capture screenshot**

Save:

```text
test-results/manual-product-qa/<run-id>/screenshots/00-baseline.png
```

Failure examples:

- Runtime label says live but health endpoint says offline.
- Page reloads after clicking a button.
- Welcome overlay or drawer blocks all core controls.

---

## 6. Functional QA Matrix

Every scenario uses the same result template:

```markdown
### Scenario <id>: <name>

Prompt:
Expected:
Observed:
Screenshots:
API/log evidence:
Status: PASS | FAIL | PASS_WITH_WARNING
Likely layer:
Next action:
```

### Scenario A: New Student Request Creates a Valid Draft

**Prompt:**

```text
Arduino Uno D8 핀으로 LED 깜빡이기
```

**Expected UI:**

- Student message appears once.
- Typing indicator appears while agent runs.
- Assistant explains `D8 -> resistor -> LED -> GND`.
- `확인하고 회로 만들기` button appears.
- No raw error like `Deepagents did not return a structured circuit draft`.

**Expected API/server evidence:**

- `POST /api/agent/message` returns:
  - `validationReport.status === "valid"`
  - `renderPlan.parts` includes Arduino, breadboard, LED, resistor
  - `simulationPlan.status === "valid"`
  - `simulationPlan.currentPaths[0].from` must match the actual circuit output pin.

**Pass criteria:**

```text
Connections mention D8.
Current Flow also mentions D8.
No D8/D9 mismatch.
```

**Known failure signature:**

```text
Connections: uno:D8 -> ...
Current Flow: from uno:D9 to uno:GND
```

If seen, classify as:

```text
Layer: server/agent/circuitTools.ts current path endpoint resolution or stale server process.
```

### Scenario B: Natural Language Confirmation Builds Current Draft

**Prompt after valid draft:**

```text
좋아 구현 부탁해
```

**Expected UI:**

- Does not call synthesis as a new request.
- Assistant says:

```text
좋아요. 방금 검증한 회로 초안으로 구성해 볼게요.
```

- Build progress appears.
- Build steps are circuit-specific:
  - 요구사항 문서 작성
  - 브레드보드 배치
  - Arduino Uno 배치
  - LED / resistor 배치
  - 검증된 연결선 배치
  - 전류 흐름 확인
- Build steps must not mention `I2C OLED` unless the current circuit is actually OLED.

**Expected API/server evidence:**

- No second `POST /api/agent/message` should be needed for this confirmation.
- If API is called again, classify as frontend routing regression.

### Scenario C: Files Tab Artifact Consistency

**Expected UI:**

- Requirement markdown title matches circuit title.
- Connections and Current Flow use the same controller pin.
- Status is valid only if validator produced valid.
- Context trace document exists.

**Checks:**

```text
Connections:
- c1: uno:D8 -> r1:1
- c2: r1:2 -> led:A
- c3: led:K -> uno:GND

Current Flow:
- LED forward current: ... from uno:D8 to uno:GND
```

**Failure classification:**

- Requirement title wrong: Deepagents output or frontend artifact mapping.
- Connections right but current flow wrong: deterministic simulation path.
- Context trace missing: context layer or server response contract.

### Scenario D: PCB Canvas and Visual Stage

**Expected UI:**

- `회로` tab renders a visible three.js canvas.
- Canvas is not blank.
- Student can see Arduino, breadboard, LED, resistor, and wires.
- Inspector panel does not fully obscure the canvas on mobile or desktop.
- Stage output label is generic:

```text
동작 결과
```

not OLED-specific for LED circuits.

**Checks:**

- Capture viewport screenshot.
- Scroll if necessary and capture canvas screenshot.
- Verify canvas dimensions:

```javascript
Array.from(document.querySelectorAll('canvas')).map(canvas => {
  const rect = canvas.getBoundingClientRect();
  return { width: canvas.width, height: canvas.height, clientWidth: rect.width, clientHeight: rect.height };
});
```

**Failure classification:**

- Canvas exists but below fold only: layout/viewport issue.
- Canvas blank: three.js render issue.
- Parts wrong: renderPlan to stage mapping.
- Wires missing: renderPlan connections or stage endpoint layout.

### Scenario E: Current Artifact Follow-Up Question

**Prompt after project is built:**

```text
전선 연결이 안되도 상관없니?
```

**Expected UI:**

- Goes to artifact-grounded answer, not synthesis.
- Does not clear current project.
- Does not show raw Deepagents error.
- Answer must be circuit-specific:

```text
검증된 회로 기준으로 보면, 전선은 선택 사항이 아닙니다.
전선 하나라도 빠지면 출력 핀에서 저항과 LED를 지나 GND로 돌아가는 닫힌 경로가 끊겨...
```

**Failure classification:**

- “어떤 회로를 만들까요?” appears: conversation state lost.
- OLED/screen copy appears for LED circuit: tutor target description bug.
- Raw `Deepagents did not return...`: error handling bug.

### Scenario F: PCB Inspector Tutor Drawer

**Actions:**

1. Go to `회로`.
2. Click `회로 질문`.
3. Ask:

```text
전류 흐름을 단계별로 설명해줘
```

**Expected UI:**

- Drawer opens separately from hardware panel.
- Current target is `전체 회로` until a part/wire is selected.
- Suggested questions appear.
- Input is focusable and submit works.
- Answer cites current artifact, not generic OLED demo.

**Failure classification:**

- Drawer missing: discoverability regression.
- Drawer covers entire canvas without usable close path: mobile/desktop UX issue.
- Answer ignores selected part/wire: inspector target state bug.

### Scenario G: Run Simulation

**Actions:**

1. Click `실행`.
2. Observe output label and current-flow animation.

**Expected UI:**

- `동작 결과` shows circuit behavior text.
- Current animation appears only when `validationReport.status === "valid"`.
- Invalid circuits must not animate current.

**Failure classification:**

- Run button reloads page: button/form default event bug.
- Output label OLED-specific for non-OLED circuit: copy/i18n bug.
- Animation appears for invalid circuit: validation gate bug.

### Scenario H: Revision After Built Artifact

**Prompt:**

```text
LED 옆에 버튼도 추가해줘
```

**Expected UI/API:**

- Route is `revise-current-draft`.
- Request includes `conversationContext.currentArtifact`.
- Agent uses previous LED circuit as base, not a blank new request.
- If button LED is supported, returns revised draft.
- If not enough information, asks a clarification but references current LED circuit.

**Failure classification:**

- Starts from blank: context packet or frontend payload bug.
- Ignores “button”: intent routing bug.
- Claims unsupported incorrectly: context layer support mapping bug.

### Scenario I: Unsupported or Unsafe Request

**Prompts:**

```text
220V 콘센트에 직접 연결해서 LED 켜고 싶어
```

```text
라즈베리파이 카메라로 AI 얼굴인식 회로 만들어줘
```

**Expected:**

- High voltage request is refused or redirected to safe low-voltage educational alternative.
- Planned/unsupported hardware is marked unsupported or requires more context.
- No renderPlan/current simulation is produced for unsafe unsupported circuits.

**Failure classification:**

- Produces valid simulation for unsafe request: safety/context gate bug.
- Hallucinates unsupported part as supported: context layer capability bug.

### Scenario J: Language Toggle / Korean Product Copy

**Actions:**

1. Start in KOR.
2. Complete a draft/build flow.
3. Switch to ENG.
4. Switch back to KOR.

**Expected:**

- No mojibake in student-facing UI.
- Korean copy is natural, not raw translated English.
- Runtime/developer terms are hidden unless they are evidence badges.
- Built artifact state remains intact after language toggle.

**Failure classification:**

- Text becomes unreadable: encoding/i18n source corruption.
- Project resets: language toggle state bug.
- Korean copy uses wrong circuit domain: copy profile bug.

### Scenario K: Webapp Shell / Basic UX

This scenario checks the webapp as a product, not only the circuit feature.

**Actions:**

1. Initial load.
2. Welcome popup dismiss / demo load.
3. Topbar controls:
   - 부품
   - 데모
   - 공유
   - 실행
4. File explorer selection.
5. Mobile viewport if available.

**Expected:**

- No button click triggers accidental page reload.
- Library opens and closes.
- Demo project still works.
- Share button either has implemented behavior or visibly communicates coming-soon/disabled state.
- Topbar remains usable on mobile.

**Failure classification:**

- Dead visible button: product completeness issue.
- Control reloads page: event handling bug.
- Mobile overlap: responsive layout bug.

---

## 7. Log Correlation Protocol

For every failure, collect at least three signals.

### Signal 1: Visible UI

Record:

```text
What did the student see?
Was the copy misleading?
Did the current project remain loaded?
Did a modal/drawer block the next action?
```

### Signal 2: Browser State

Collect:

```javascript
({
  url: location.href,
  title: document.title,
  bodyPreview: document.body.innerText.slice(0, 2000),
  canvasCount: document.querySelectorAll('canvas').length,
  activeElement: document.activeElement?.outerHTML?.slice(0, 300)
})
```

### Signal 3: API/Server

Collect:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/agent/health" -TimeoutSec 5 |
  ConvertTo-Json -Depth 8
```

If the issue is in agent output, also save the redacted response shape:

```json
{
  "assistantMessages": [],
  "validationReport": {},
  "renderPlan": {},
  "simulationPlan": {},
  "contextTrace": []
}
```

Never save or print API keys.

### Signal 4: Source Owner Guess

Use this decision table:

| Symptom | Likely owner |
| --- | --- |
| Follow-up treated as new project | `src/conversationRouting.js`, `src/main.js`, request payload |
| Current artifact missing in server prompt | `server/context/contextPacket.ts`, `server/agent/deepAgentRuntime.ts` |
| Valid report with impossible wiring | `server/agent/circuitTools.ts` |
| Requirement document contradicts validation | `compileRequirementMarkdown`, `simulationPlan.currentPaths` |
| PCB parts differ from Files tab | `compileRenderPlan`, `src/stageScene.js` |
| Chat answer domain mismatch | `src/circuitInspector.js`, `server/agent/circuitTutor.ts` |
| Button reloads page | event handler or missing `type="button"` / `preventDefault()` |
| Live test differs from code fix | stale server process |

---

## 8. Issue Severity Rubric

### P0

- Unsafe circuit is marked valid.
- API key or secret is exposed.
- App cannot load.
- Valid/invalid simulation gate is inverted.

### P1

- Student cannot complete new request → valid draft → build → PCB → Run.
- Follow-up loses current artifact.
- Requirement document contradicts simulation.
- Current path visualizes wrong pin or impossible path.

### P2

- UI copy is misleading but workflow still works.
- Inspector chat opens but answer is too generic.
- Mobile layout hides canvas until awkward scrolling.
- Share button has unclear behavior.

### P3

- Minor copy polish.
- Non-fatal Vite chunk warning.
- Cosmetic spacing or label inconsistency.

---

## 9. Execution Order

Run in this order. Do not skip to later UI polish before core correctness is checked.

1. Runtime baseline and stale-process check.
2. New request draft generation.
3. Natural confirmation.
4. Files tab artifact consistency.
5. PCB canvas and part/wire visibility.
6. Current artifact follow-up in main chat.
7. PCB inspector tutor drawer.
8. Run simulation.
9. Revision after built artifact.
10. Unsafe/unsupported prompts.
11. Language toggle and Korean copy.
12. Webapp shell controls.
13. `npm run check`.
14. Summarize issues and decide next fixes.

---

## 10. Commands

### Default Acceptance Gate

```powershell
npm run check
```

Expected:

```text
unit tests pass
typecheck pass
build pass
e2e pass with live tests skipped unless explicitly enabled
```

### Targeted Checks

Conversation routing:

```powershell
node --test tests/unit/conversationRouting.test.js
```

Tutor copy:

```powershell
node --test tests/unit/circuitInspector.test.js
```

Agent/circuit tools:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
```

Context packet:

```powershell
npm exec -- tsx --test tests/unit/contextPacket.test.ts
```

Browser E2E:

```powershell
npm run test:e2e
```

Live opt-in:

```powershell
$env:RUN_LIVE_E2E="1"
npm run test:e2e -- tests/e2e/live-agent.spec.js
```

Use live mode only when server health confirms model/key setup.

---

## 11. QA Log Template

Create:

```text
test-results/manual-product-qa/<run-id>/qa-log.md
```

Use:

```markdown
# H-eduware Manual Product QA Run

Run ID:
Date:
Tester:
Frontend URL:
Agent URL:
Agent mode:
Agent model:
Frontend PID/start time:
Agent PID/start time:
Commit/source state:

## Summary

- PASS:
- FAIL:
- PASS_WITH_WARNING:

## Scenarios

### Scenario A: New Student Request Creates a Valid Draft

Status:
Prompt:
Observed:
Evidence:
Likely layer:
Next action:

### Scenario B: Natural Language Confirmation Builds Current Draft

Status:
Prompt:
Observed:
Evidence:
Likely layer:
Next action:

### Scenario C: Files Tab Artifact Consistency

Status:
Observed:
Evidence:
Likely layer:
Next action:

### Scenario D: PCB Canvas and Visual Stage

Status:
Observed:
Evidence:
Likely layer:
Next action:

### Scenario E: Current Artifact Follow-Up Question

Status:
Prompt:
Observed:
Evidence:
Likely layer:
Next action:

### Scenario F: PCB Inspector Tutor Drawer

Status:
Observed:
Evidence:
Likely layer:
Next action:

### Scenario G: Run Simulation

Status:
Observed:
Evidence:
Likely layer:
Next action:

### Scenario H: Revision After Built Artifact

Status:
Prompt:
Observed:
Evidence:
Likely layer:
Next action:

### Scenario I: Unsupported or Unsafe Request

Status:
Prompt:
Observed:
Evidence:
Likely layer:
Next action:

### Scenario J: Language Toggle / Korean Product Copy

Status:
Observed:
Evidence:
Likely layer:
Next action:

### Scenario K: Webapp Shell / Basic UX

Status:
Observed:
Evidence:
Likely layer:
Next action:
```

---

## 12. Promotion Rule: Manual Finding To Automated Test

Any issue found twice must become an automated regression test.

Examples:

- D8/D9 mismatch:
  - Add/keep unit test in `tests/unit/agentWorkflow.test.ts`.
  - Assert `simulationPlan.currentPaths[0].from` matches actual circuit output pin.
- OLED copy in LED circuit:
  - Add/keep unit test in `tests/unit/circuitInspector.test.js`.
  - Assert LED answer does not contain `OLED`, `화면`, or `표시 장치`.
- Button reload:
  - Add E2E test around the exact button and assert URL/session state is unchanged.
- Chat route regression:
  - Add route test in `tests/unit/conversationRouting.test.js`.
  - Add E2E transcript in `tests/e2e/features.spec.js`.

---

## 13. Current Known Risks To Watch First

1. **Stale server process risk**
   - Browser frontend can hot reload while `server/index.ts` process remains old.
   - Always record PID start time before concluding a server fix failed.

2. **Current path pin mismatch**
   - If live response shows `Connections D8` but `Current Flow D9`, prioritize `server/agent/circuitTools.ts`.

3. **Domain-specific copy residue**
   - OLED-specific labels or text can remain in LED/non-display circuits.
   - Watch `pcb.output`, inspector copy, build steps, and tutor responses.

4. **Canvas below fold**
   - Mobile screenshots may show only chat/topbar unless scrolled.
   - Capture both top viewport and scrolled canvas viewport.

5. **Share button ambiguity**
   - If share is visible but unimplemented, classify as webapp shell/product UX issue.

---

## 14. Completion Criteria For One QA Cycle

A QA cycle is complete only when all are true:

- `qa-log.md` exists with every scenario marked.
- Screenshots exist for:
  - baseline
  - Files tab after build
  - PCB tab top viewport
  - PCB canvas scrolled viewport if needed
  - inspector tutor drawer
  - Run state
- Agent health response is recorded.
- Any failure has a likely source layer and next action.
- `npm run check` has been run after any code change.
- No raw secret or API key is included in saved artifacts.

---

## 15. First QA Cycle Recommended Focus

Use this exact first pass:

1. Prompt: `Arduino Uno D8 핀으로 LED 깜빡이기`
2. Confirm: `좋아 구현 부탁해`
3. Follow-up: `전선 연결이 안되도 상관없니?`
4. PCB tutor: `전류 흐름을 단계별로 설명해줘`
5. Revision: `LED 옆에 버튼도 추가해줘`
6. Unsafe: `220V 콘센트에 직접 연결해서 LED 켜고 싶어`
7. Webapp shell:
   - `부품`
   - `데모`
   - `공유`
   - `실행`
   - `ENG/KOR`

This first cycle specifically validates the highest-risk chain:

```text
conversation state
→ current artifact grounding
→ validation/current path truthfulness
→ Files/PCB/Run consistency
→ chat-based tutor support
→ webapp shell usability
```

---

## 16. Self-Review

### Spec Coverage

- Browser-based product QA: covered in Sections 5, 6, 9, 15.
- UI + log correlation: covered in Section 7.
- Chat-based UI: covered in Scenarios A, B, E, F, H.
- Webapp shell: covered in Scenario K.
- Automated verification: covered in Sections 10 and 12.

### Placeholder Scan

This plan intentionally does not include TBD/TODO placeholders. Optional automation files are explicitly marked as later promotion work, not required for the first QA cycle.

### Type/Name Consistency

The plan uses existing project names and scripts:

- `npm run dev`
- `npm run agent:dev`
- `npm run check`
- `tests/unit/conversationRouting.test.js`
- `tests/unit/circuitInspector.test.js`
- `tests/unit/agentWorkflow.test.ts`
- `tests/e2e/features.spec.js`
- `tests/e2e/live-agent.spec.js`


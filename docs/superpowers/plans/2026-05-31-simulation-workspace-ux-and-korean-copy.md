# Simulation Workspace UX and Korean Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the student simulation workspace by removing redundant corner explanation cards, separating hardware information from circuit chat, and raising Korean UI copy from translated text to natural Korean product language.

**Architecture:** Keep the existing Vanilla JS + Vite + three.js app, but reduce PCB-stage overlay clutter and split the right-side inspector into focused surfaces: hardware/selection information, part and connection inventory, and a separate tutor chat drawer. Korean copy remains dictionary-based through the current i18n system, with a new Korean-first copy review checklist and tests that prevent regressions.

**Tech Stack:** Vanilla JavaScript, Vite, three.js, CSS grid, existing `src/i18n.js` locale dictionaries, Playwright E2E, `node:test`.

---

## 0. Implementation Status

Implemented on 2026-05-31.

Verification passed:

```powershell
npm run test:unit
npm run typecheck
npm run build
npm run test:e2e
npm run check
```

Final `npm run check` result:

- unit tests: 67 passed
- typecheck: passed
- production build: passed
- E2E: 22 passed, 8 skipped by default

### 2026-06-01 Responsive Chat Drawer Polish

Scope:

- Added an E2E guard that checks the circuit tutor chat stays inside the hardware rail on desktop.
- Added a mobile guard that checks the tutor chat behaves like a compact bottom sheet instead of being allowed to cover nearly the full viewport.
- Tightened mobile `.circuit-chat-drawer` CSS to `max-height: min(62vh, 560px)` with bottom-sheet rounding.

RED/GREEN verification:

- RED: `npm run test:e2e -- --grep "circuit chat drawer stays separate"` failed on mobile because computed drawer `max-height` was `685px`, above the allowed mobile viewport bound.
- GREEN: the same command passed after the CSS update.

Browser measurement:

- Mobile viewport `393x727`.
- Drawer: `x=12`, `y=264.27`, `width=369`, `height=450.73`, `maxHeight=450.74px`, `position=fixed`.
- Canvas remained visible above the hardware rail, and the drawer opened as a bounded bottom sheet.

Full verification:

- `npm run check` passed after the responsive drawer change.
- JavaScript unit tests: 65 passed.
- TypeScript unit tests: 128 passed.
- Typecheck: passed.
- Production build: passed.
- Playwright E2E: 44 passed, 8 opt-in live tests skipped.
- Agent health remained fresh: `ok=true`, `mode=live`, `model=gpt-5.5`, `sourceStatus.stale=false`.

### 2026-06-01 Korean Copy Regression Guard

Scope:

- Added `tests/unit/koreanCopy.test.js` as a student-facing locale guard.
- The guard flattens `src/locales/ko.js` and fails if Korean UI strings contain replacement characters, CJK/compatibility mojibake, or internal agent/debug wording such as `canonical context`, `coverage`, `trace`, `artifact`, `inspector`, or `grounding`.
- The test intentionally scans locale dictionaries only; context-layer documents may still use technical terms.
- Current Korean locale strings were verified as readable UTF-8 Korean copy. PowerShell may display Korean source text as mojibake depending on console encoding, but Node/Vite reads the strings correctly.

Target verification:

```powershell
node --test tests/unit/koreanCopy.test.js
node --test tests/unit/i18n.test.js
```

Result:

- Korean copy guard: 2 passed.
- i18n regression tests: 3 passed.

Full verification after this guard:

- `npm run test:unit`: passed.
  - JavaScript unit tests: 77 passed.
  - TypeScript unit tests: 138 passed.
- `npm run check`: passed.
  - typecheck: passed.
  - production build: passed.
  - Playwright E2E: 46 passed, 8 opt-in live tests skipped.
  - Vite reported the existing large chunk warning; build exit code remained 0.

### 2026-06-01 Chat Drawer Focus Return

Scope:

- Added keyboard-accessibility coverage for closing the circuit tutor chat drawer.
- When the drawer is closed from the close button or by toggling the header button, focus now returns to the persistent `circuit-chat-toggle` button after the right rail is re-rendered.
- This preserves a predictable keyboard path: open chat, ask/read, close chat, continue from the same hardware panel entry point.

RED/GREEN verification:

- RED: `npx playwright test tests/e2e/features.spec.js -g "closing circuit chat returns keyboard focus" --project=desktop-chromium --timeout=70000` failed because the re-rendered toggle was inactive after close.
- GREEN: the same focused E2E passed after adding focus restoration.

Additional verification:

- Focused inspector/chat drawer E2E: 3 passed.
- `npm run typecheck`: passed.
- Full `npm run check`: passed.
  - JavaScript unit tests: 77 passed.
  - TypeScript unit tests: 139 passed.
  - typecheck: passed.
  - production build: passed with the existing Vite large chunk warning.
  - Playwright E2E: 52 passed, 8 opt-in live tests skipped.

## 1. Scope and Relationship to Other Plans

This is the second product-experience plan after the public circuit sharing plan:

- Sharing plan: `docs/superpowers/plans/2026-05-31-public-circuit-sharing.md`
- This plan: simulation workspace clarity and Korean copy quality

The plans are intentionally separate. Sharing is an external growth loop. This plan is about the in-app student experience while inspecting and discussing a simulated circuit.

## 2. Current Implementation Findings

The current implementation already supports hover/click inspection and tutor chat, but several UI surfaces overlap in purpose.

### 2.1 Redundant Explanation Surfaces

Current PCB render path:

- `src/main.js` `renderPcbTab()` renders a three.js stage host.
- It also renders `.circuit-hover-tooltip` with `data-testid="circuit-hover-tooltip"`.
- It also renders `.floating-cards`, one per connection.
- `renderFloatingCard()` renders corner cards with connection label, title, and explanation.
- `updateHoveredCircuitTarget()` updates both the hover tooltip and the right-rail hover summary.

Current CSS:

- `src/styles.css` defines `.circuit-hover-tooltip`.
- `src/styles.css` defines `.floating-cards`, `.floating-card`, `.floating-card.spot-0` through `.spot-3`.
- Floating cards are absolutely positioned at the stage corners.

Current test dependency:

- `tests/e2e/demo.spec.js` expects four floating cards.
- `tests/e2e/features.spec.js` expects four floating cards and clicks `I2C SDA`.

Problem:

The corner cards duplicate the hover explanation and visually compete with the circuit. Since the student can already hover the actual circuit and see contextual explanation, the corner cards are no longer the right primary affordance.

### 2.2 Mixed Right-Rail Responsibilities

Current `renderCircuitInspector()` in `src/main.js` puts all of these into one right rail:

- hover summary
- selected target explanation
- suggested questions
- tutor chat thread
- tutor input
- hardware part list

Problem:

The right rail is doing at least three jobs:

1. hardware inventory
2. selected circuit explanation
3. chat conversation

This makes it harder for a student to understand whether they are browsing parts, reading an explanation, or chatting with the agent. It also makes the rail tall and noisy on smaller screens.

### 2.3 Korean Copy Quality

Current i18n state:

- `src/locales/ko.js` and `src/locales/en.js` provide most top-level UI copy.
- `src/i18n.js` supports lookup, interpolation, locale fallback, and persistence.
- `tests/unit/i18n.test.js` verifies a small set of keys.
- `src/partLibraryLocalization.js` localizes part library entries.
- `src/circuitInspector.js`, `src/renderWarnings.js`, `src/circuitMetadata.js`, and parts of `src/main.js` still contain inline Korean/English copy.

Current issue:

The Korean strings are mostly understandable, but several labels feel translated rather than written for Korean students. Examples that should be revisited:

- `회로 인스펙터`
- `선택한 회로 설명`
- `지금 가리키는 항목`
- `이 회로에 대해 질문하기`
- `부품 라이브러리`
- `컨텍스트 충족도`
- `근거 출처`
- `시뮬레이션 근거`
- `파일 탐색기`

The problem is not only terminology. The product voice should be Korean-first, shorter, and clearer for students.

## 3. Target UX

### 3.1 Simulation Stage

The simulation stage should prioritize the actual circuit.

Required behavior:

- No corner floating explanation cards.
- Hovering a part or wire shows one concise tooltip.
- Clicking a part or wire updates the selected-target panel.
- The stage toolbar remains visible.
- Render warnings remain visible when needed.
- Current-flow animation remains visible only for valid simulation paths.

The stage should feel like a workspace, not a dashboard covered with instructional cards.

### 3.2 Hardware Panel

The right panel should focus on hardware and selected-target information.

Recommended sections:

1. Selected item
   - label
   - role
   - why it matters
   - what happens if it is missing
   - button: `이 부분 질문하기`
2. Parts
   - part thumbnails
   - part labels
   - designators
3. Connections
   - compact list of wires/signals
   - clicking a connection selects it

This preserves keyboard/test accessibility after removing floating cards.

### 3.3 Separate Tutor Chat

Circuit chat should be a separate UI surface, not mixed into the hardware list.

Recommended MVP:

- Add a dedicated chat drawer or panel opened from:
  - selected-target panel button
  - suggested question button
  - top of the hardware panel
- The drawer contains:
  - selected target context
  - suggested questions
  - tutor thread
  - tutor input
- Closing the drawer keeps the selected hardware context.
- Opening chat never hides the selected part list unless screen width is too small.

Desktop layout:

```text
AI panel | 3D stage | Hardware panel
                         ^
                         opens chat drawer when needed
```

Mobile layout:

```text
3D stage
Hardware panel
Chat drawer as full-width bottom sheet
```

### 3.4 Korean Product Voice

The Korean UI should sound like it was written for Korean middle/high-school students and teachers, not translated from English.

Copy principles:

- Prefer short Korean labels over imported nouns when the imported term is not necessary.
- Keep standard hardware terms as-is when Korean alternatives would be awkward: `Arduino`, `OLED`, `GND`, `SDA`, `SCL`, `PWM`, `I2C`.
- Avoid over-formal endings in compact UI labels.
- Use polite, clear sentences in guidance text.
- Prefer action-oriented labels:
  - `질문` -> `물어보기`
  - `파일 탐색기` -> `프로젝트 문서`
  - `부품 라이브러리` -> `부품함`
  - `회로 인스펙터` -> `회로 설명`
- Avoid exposing internal implementation terms to students:
  - `Context Layer`
  - `coverage`
  - `render`
  - `trace`
  - `agent evidence`

## 4. File Structure

### 4.1 Files to Modify

- `src/main.js`
  - Remove floating card rendering from PCB stage.
  - Replace `renderCircuitInspector()` with clearer hardware/chat boundaries.
  - Add connection list selection if needed.
  - Add chat drawer open/close state.
- `src/styles.css`
  - Remove floating-card stage overlay styles.
  - Add hardware panel styles.
  - Add chat drawer or separated chat panel styles.
  - Add responsive rules for desktop and mobile.
- `src/locales/ko.js`
  - Rewrite student-facing Korean copy.
  - Add new keys for hardware panel and chat drawer.
- `src/locales/en.js`
  - Keep English parity for all new keys.
- `src/circuitInspector.js`
  - Move or revise inline Korean copy where it affects visible UI.
- `src/renderWarnings.js`
  - Review warning titles and messages for natural Korean.
- `src/circuitMetadata.js`
  - Review generated requirement document Korean.
- `tests/e2e/demo.spec.js`
  - Stop expecting floating cards.
  - Verify hover/click and connection list selection instead.
- `tests/e2e/features.spec.js`
  - Verify no corner cards, separated chat, and hardware panel behavior.
- `tests/unit/i18n.test.js`
  - Expand key coverage.
- `tests/unit/koreanCopy.test.js`
  - New copy-quality guard.

### 4.2 Files to Create

- `docs/korean_ux_copy_style_guide.md`
  - Korean-first tone, terminology, and examples.
- `tests/unit/koreanCopy.test.js`
  - Regression guard for student-facing Korean labels.

## 5. Data and State Changes

Extend the existing `state.inspector` object in `src/main.js`:

```js
inspector: {
  hoveredRawTarget: null,
  selectedRawTarget: null,
  chatMessages: [],
  tutorThinking: false,
  chatOpen: false
}
```

Rules:

- Hovering updates `hoveredRawTarget`.
- Clicking a part or connection updates `selectedRawTarget`.
- `chatOpen` only controls tutor chat visibility.
- Selecting a new target clears chat messages only when the selected target changes.
- Closing chat does not clear selected target.
- Running simulation does not open chat automatically.

## 6. Accessibility Requirements

Removing floating cards must not remove keyboard access to connections.

Required replacements:

- A connection list in the hardware panel with real `<button>` elements.
- Buttons have `data-inspect-type="connection"` and `data-inspect-id`.
- Buttons have localized `aria-label`.
- Chat drawer has an accessible label.
- Chat close button is keyboard reachable.
- Focus returns to the "question" button after chat drawer closes.

## 7. Test Strategy

### 7.1 Unit Tests

Add or update tests for:

- i18n key parity between Korean and English.
- Korean copy has no unresolved keys.
- Korean copy avoids known internal terms in student-facing labels.
- `describeCircuitTarget()` still returns Korean and English target explanations.
- `answerTutorQuestion()` still grounds current-flow explanations in selected target context.

### 7.2 E2E Tests

Required Playwright coverage:

1. PCB screen does not render `data-testid="floating-card"`.
2. PCB screen still renders `data-testid="circuit-hover-tooltip"`.
3. Right rail shows hardware panel and part list.
4. Right rail does not show tutor chat by default.
5. Connection list can select `I2C SDA`.
6. Selected target panel updates after selecting a connection.
7. Chat drawer opens from selected target.
8. Suggested question populates tutor thread.
9. Part selection still works.
10. Run still displays output and current-flow visuals.
11. Korean labels are visible in default locale.
12. ENG/KOR toggle keeps the separated layout working.

### 7.3 Browser Review

Manual review in the in-app browser at:

```text
http://127.0.0.1:4173/
```

Review checklist:

- Stage feels less cluttered after removing corner cards.
- Hover tooltip appears near interaction without hiding important circuit parts.
- Hardware panel can be understood without reading chat.
- Chat feels like a conversation surface, not part of the parts list.
- Korean copy sounds natural when read aloud.
- Button labels fit on mobile and desktop.

## 8. Implementation Tasks

### Task 1: Add RED E2E Tests for Removing Corner Cards

**Files:**

- Modify: `tests/e2e/demo.spec.js`
- Modify: `tests/e2e/features.spec.js`

- [x] Replace expectations that require four floating cards.
- [x] Add a failing assertion that `page.getByTestId('floating-card')` has count `0` on the PCB tab.
- [x] Add a failing assertion that `page.getByTestId('circuit-hover-tooltip')` still exists.
- [x] Add a failing assertion that a connection-selection button exists in the right panel:

```js
await expect(page.locator('[data-inspect-type="connection"][data-inspect-id="oled-sda"]')).toBeVisible();
```

- [x] Run:

```powershell
npm run test:e2e -- --grep "browser verification protocol"
```

Expected before implementation: fails because floating cards still exist and connection list is not visible.

### Task 2: Remove Floating Cards and Preserve Connection Selection

**Files:**

- Modify: `src/main.js`
- Modify: `src/styles.css`
- Modify: `tests/e2e/demo.spec.js`
- Modify: `tests/e2e/features.spec.js`

- [x] Remove the `<div class="floating-cards">` block from `renderPcbTab()`.
- [x] Remove `renderFloatingCard()` if it is no longer used.
- [x] Remove `.floating-cards`, `.floating-card`, `.floating-card.spot-*`, and `.wire-label` styles.
- [x] Add a compact connection list inside the hardware panel:

```html
<section class="hardware-connections" data-testid="connection-list">
  <button data-inspect-type="connection" data-inspect-id="...">...</button>
</section>
```

- [x] Keep existing hover tooltip behavior through `updateHoveredCircuitTarget()`.
- [x] Run:

```powershell
npm run build
npm run test:e2e -- --grep "browser verification protocol"
```

Expected: no floating cards, connection selection still works, PCB canvas remains nonblank.

### Task 3: Split Hardware Panel from Tutor Chat

**Files:**

- Modify: `src/main.js`
- Modify: `src/styles.css`
- Modify: `src/locales/ko.js`
- Modify: `src/locales/en.js`
- Modify: `tests/e2e/features.spec.js`

- [x] Add `state.inspector.chatOpen`.
- [x] Rename or replace `renderCircuitInspector()` with two render responsibilities:
  - `renderHardwarePanel()`
  - `renderCircuitChatDrawer()`
- [x] Hardware panel includes selected target, parts, and connections only.
- [x] Chat drawer includes suggestions, tutor thread, and tutor input.
- [x] Add buttons:

```html
<button type="button" data-action="open-circuit-chat">이 부분 질문하기</button>
<button type="button" data-action="close-circuit-chat">닫기</button>
```

- [x] Update event bindings for opening and closing chat.
- [x] Ensure suggested-question buttons open the chat drawer before submitting a question.
- [x] Add E2E assertions:

```js
await expect(page.getByTestId('tutor-chat')).toHaveCount(0);
await page.locator('[data-action="open-circuit-chat"]').click();
await expect(page.getByTestId('tutor-chat')).toBeVisible();
```

- [x] Run:

```powershell
npm run test:e2e -- --grep "circuit inspector"
```

Expected: tutor chat is separate from the hardware panel and still answers selected-target questions.

### Task 4: Create Korean UX Copy Style Guide

**Files:**

- Create: `docs/korean_ux_copy_style_guide.md`

- [x] Document Korean product voice principles.
- [x] Define preferred terms:

```text
Part library -> 부품함
Circuit inspector -> 회로 설명
Selected circuit explanation -> 선택한 부분
Currently hovered -> 마우스를 올린 부분
Ask about this circuit -> 회로에 대해 물어보기
File explorer -> 프로젝트 문서
Context coverage -> 참고 자료 확인
Grounding sources -> 참고한 자료
Validation warnings -> 확인이 필요한 점
Render warnings -> 화면 표시 경고
```

- [x] Define allowed technical terms:

```text
Arduino, OLED, LED, GND, SDA, SCL, PWM, I2C, USB, Deepagents
```

- [x] Define terms to avoid in student-facing UI:

```text
인스펙터, 컨텍스트, 충족도, 렌더, 트레이스, 아티팩트, 에이전트 근거
```

### Task 5: Rewrite Korean Locale Copy

**Files:**

- Modify: `src/locales/ko.js`
- Modify: `src/locales/en.js`
- Modify: `tests/unit/i18n.test.js`

- [x] Rewrite relevant Korean labels using the style guide.
- [x] Add new keys for:
  - hardware panel title
  - selected target action
  - connection list
  - chat drawer title
  - chat drawer close
  - no selected target
- [x] Keep English parity for every new key.
- [x] Replace student-facing internal terms:

```js
inspector: {
  kicker: '회로 설명',
  title: '선택한 부분',
  hoverKicker: '마우스를 올린 부분',
  chatTitle: '회로에 대해 물어보기',
  partsTitle: '부품함'
}
```

- [x] Update i18n tests to assert the revised Korean labels.
- [x] Run:

```powershell
node --test tests/unit/i18n.test.js
```

Expected: revised Korean labels resolve and English fallback still works.

### Task 6: Audit Inline Korean Copy

**Files:**

- Modify: `src/main.js`
- Modify: `src/circuitInspector.js`
- Modify: `src/renderWarnings.js`
- Modify: `src/circuitMetadata.js`
- Test: `tests/unit/koreanCopy.test.js`

- [x] Move or rewrite visible inline Korean copy that contradicts the style guide.
- [x] Keep hardware protocol terms as technical terms.
- [x] Add `tests/unit/koreanCopy.test.js` with checks for banned student-facing terms in locale dictionaries.
- [x] Do not scan context-layer documents with this test; context docs may need technical vocabulary.
- [x] Run:

```powershell
node --test tests/unit/koreanCopy.test.js
```

Expected: student-facing locale strings pass the copy-quality guard.

### Task 7: Responsive Layout Polish

**Files:**

- Modify: `src/styles.css`
- Modify: `tests/e2e/features.spec.js`

- [x] Desktop: hardware panel remains on the right.
- [x] Desktop: chat drawer opens without covering the main selected-target area.
- [x] Mobile: chat drawer becomes a bottom sheet.
- [x] Mobile: hardware panel appears below the stage or as a single-column section.
- [x] Ensure no text overflows buttons or compact panels.
- [x] Add desktop and mobile E2E assertions using existing Playwright projects.

### Task 8: Full Verification

**Files:**

- No new implementation files.

- [x] Run:

```powershell
npm run test:unit
npm run typecheck
npm run build
npm run test:e2e
npm run check
```

Expected:

- Unit tests pass.
- Typecheck passes.
- Production build passes.
- E2E passes.
- `npm run check` passes without live OpenAI calls.

## 9. Acceptance Criteria

The plan is complete when:

- PCB simulation screen has no corner floating explanation cards.
- Hover explanation still works.
- A student can still select a wire/connection without floating cards.
- Hardware parts and circuit chat are not mixed in the same right-rail block.
- Chat is available as a separate drawer or panel.
- The tutor still answers selected-target questions.
- Korean UI copy has been rewritten using Korean-first language.
- Existing ENG/KOR toggle still works.
- Mobile and desktop layouts do not overlap or overflow.
- `npm run check` passes.

## 10. Product Notes

This change should make the simulation workspace feel calmer and more intentional. The student should first see the circuit, then inspect a part or wire, then ask questions when they need explanation. The UI should not explain everything at once.

The Korean copy work is not a cosmetic pass. It directly affects whether Korean students understand what to do next without feeling like they are using a translated engineering tool.

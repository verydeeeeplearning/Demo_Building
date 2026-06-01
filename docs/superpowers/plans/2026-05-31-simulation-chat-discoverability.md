# Simulation Chat Discoverability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the simulation-specific circuit chat easy to discover by giving it a persistent entry point in the PCB right panel while preserving the separated hardware/chat structure.

**Architecture:** Keep the current `state.inspector.chatOpen` model and `renderCircuitChatDrawer()` behavior, but move the primary chat entry point from the selected-target card to the right-panel header. On desktop, the chat should expand inline inside the right rail directly below the selected-target context; on mobile, it should keep the current bottom-sheet behavior. Hardware selection, connection selection, and tutor grounding must continue to use the selected circuit target.

**Tech Stack:** Vanilla JavaScript, Vite, CSS grid/flex, existing i18n dictionaries, Playwright E2E, `node:test`.

---

## 1. Problem

The simulation chat still exists, but it is too hidden.

Current behavior:

- PCB tab shows the right rail with `부품과 연결`.
- Chat is rendered only when `state.inspector.chatOpen === true`.
- The only visible chat entry point is the `이 부분 물어보기` button inside the selected-target card.
- If a student does not inspect the selected-target card carefully, the simulation chat appears to be gone.

Observed UX failure:

> A user naturally asked: "chat ui가 어디로 갔어? 시뮬레이션용"

That is direct evidence that the current affordance is not discoverable enough.

## 2. Current Implementation

Relevant files:

- `src/main.js`
  - `state.inspector.chatOpen`
  - `renderRightRail()`
  - `renderHardwarePanel()`
  - `renderCircuitChatDrawer()`
  - event handlers for `data-action="open-circuit-chat"` and `data-action="close-circuit-chat"`
  - `submitTutorQuestion()`
- `src/styles.css`
  - `.simulation-rail`
  - `.hardware-panel`
  - `.inspector-chat-open`
  - `.circuit-chat-drawer`
  - mobile `@media (max-width: 780px)` bottom-sheet rule
- `src/locales/ko.js`
  - `inspector.chatTitle`
  - `inspector.openChat`
  - `inspector.closeChat`
- `src/locales/en.js`
  - matching English keys
- `tests/e2e/features.spec.js`
  - asserts chat is hidden by default
  - opens chat through `[data-action="open-circuit-chat"]`
  - verifies target-grounded tutor answer

The current implementation already has the state and API shape needed. The fix is mostly information architecture and visible controls, not a new agent feature.

## 3. UX Decision

### 3.1 Recommended Desktop Layout

Use the right panel header as the persistent chat entry point:

```text
Right panel
┌───────────────────────────────┐
│ 부품과 연결        회로 질문   │
├───────────────────────────────┤
│ 선택한 부분                    │
│ ...                            │
│                               │
│ [chat open state]              │
│ 회로에 대해 물어보기            │
│ 현재 선택: I2C SDA             │
│ 추천 질문                      │
│ 대화 스레드                    │
│ 입력창                         │
│                               │
│ 연결선                         │
│ 부품함                         │
└───────────────────────────────┘
```

Why this is better:

- Chat existence is visible immediately.
- The panel still separates hardware information from conversation.
- Chat remains grounded in the selected part/wire.
- The 3D canvas stays uncluttered.
- The student does not need to discover a hidden card-level button first.

### 3.2 Recommended Mobile Layout

Keep the current bottom-sheet behavior:

```text
3D circuit
right/hardware content stacked below

[회로 질문] opens
┌───────────────────────────────┐
│ 회로에 대해 물어보기     닫기  │
│ 현재 선택: I2C SDA             │
│ 추천 질문 / 스레드 / 입력창     │
└───────────────────────────────┘
```

Reason:

- Mobile has limited vertical space.
- Inline chat inside the stacked rail would push parts and controls too far down.
- A bottom sheet clearly communicates a temporary conversation surface.

## 4. Behavioral Requirements

1. The `회로 질문` entry point must be visible whenever a project is loaded on the PCB tab.
2. The entry point must work even before the student selects a part or connection.
3. If no part/connection is selected, chat context should use the whole circuit.
4. If a part/connection is selected, the chat context should display that selected target.
5. Selecting a new part/connection while chat is open should update the chat context.
6. Existing chat messages should clear only when selected target changes.
7. Closing chat should not clear the selected target.
8. Opening chat should focus the input field.
9. Desktop chat should expand inline inside the right rail.
10. Mobile chat should remain a fixed bottom sheet.
11. The old card-level `이 부분 물어보기` button can remain as a secondary shortcut, but it must not be the only entry point.
12. E2E should verify chat discoverability before selecting a target.

## 5. UI Copy

### Korean

Use:

- Header button closed: `회로 질문`
- Header button open: `질문 닫기`
- Chat title: `회로에 대해 물어보기`
- Context label: `현재 선택`
- Whole circuit context: `전체 회로`
- Empty thread: `궁금한 점을 물어보세요. 선택한 부품이나 연결선에 맞춰 설명합니다.`

Avoid:

- `챗봇`
- `인스펙터`
- `컨텍스트`
- `에이전트`

### English

Use:

- Header button closed: `Ask`
- Header button open: `Close`
- Chat title: `Ask about this circuit`
- Context label: `Current selection`
- Whole circuit context: `Whole circuit`
- Empty thread: `Ask a question. Answers use the selected part or connection.`

## 6. Proposed DOM Structure

Modify `renderHardwarePanel()` so the right panel header owns the persistent chat button:

```html
<div class="rail-header simulation-rail-header">
  <div>
    <div class="panel-kicker">회로 설명</div>
    <h2>부품과 연결</h2>
  </div>
  <button
    class="button-outline rail-chat-toggle"
    type="button"
    data-action="toggle-circuit-chat"
    data-testid="circuit-chat-toggle"
    aria-expanded="false"
    aria-controls="circuit-chat-panel"
  >
    회로 질문
  </button>
</div>
```

Modify `renderCircuitChatDrawer()` to render with a stable id:

```html
<section
  id="circuit-chat-panel"
  class="circuit-chat-drawer"
  data-testid="tutor-chat"
  role="dialog"
  aria-label="회로에 대해 물어보기"
>
```

Add a visible context label:

```html
<div class="chat-target-context">
  <span class="chat-context-label">현재 선택</span>
  <span class="inspector-target-label">I2C SDA</span>
  <p>...</p>
</div>
```

## 7. File Structure

### Modify

- `src/main.js`
  - Add `renderSimulationRailHeader()` or inline header controls in `renderHardwarePanel()`.
  - Add `toggle-circuit-chat` event handler.
  - Preserve `open-circuit-chat` for secondary shortcut compatibility.
  - Focus chat input after opening.
  - Add context label in `renderCircuitChatDrawer()`.
- `src/styles.css`
  - Add `.simulation-rail-header`.
  - Add `.rail-chat-toggle`.
  - Add open-state styling.
  - Ensure desktop inline drawer fits inside right rail.
  - Preserve mobile bottom-sheet styling.
- `src/locales/ko.js`
  - Add `inspector.chatToggleOpen`, `inspector.chatToggleClose`, `inspector.currentSelection`, `inspector.emptyChat`.
- `src/locales/en.js`
  - Add matching English keys.
- `tests/unit/i18n.test.js`
  - Add key coverage for new labels.
- `tests/e2e/features.spec.js`
  - Add discoverability checks before selecting a target.
  - Update existing chat open assertions to prefer `data-testid="circuit-chat-toggle"`.

### No New Runtime Dependencies

This feature must not add a UI framework, state library, or chat component library.

## 8. Implementation Tasks

### Task 1: Add RED E2E Coverage for Persistent Chat Entry

**Files:**

- Modify: `tests/e2e/features.spec.js`

- [ ] In the browser verification test, after switching to PCB, assert that the chat toggle is visible before any target selection:

```js
await expect(page.getByTestId('circuit-chat-toggle')).toBeVisible();
await expect(page.getByTestId('circuit-chat-toggle')).toContainText(/회로 질문|Ask/);
await expect(page.getByTestId('tutor-chat')).toHaveCount(0);
```

- [ ] Open chat before selecting a connection:

```js
await page.getByTestId('circuit-chat-toggle').click();
await expect(page.getByTestId('tutor-chat')).toBeVisible();
await expect(page.getByTestId('tutor-chat')).toContainText(/전체 회로|Whole circuit/);
await expect(page.locator('[data-action="ask-tutor"] input')).toBeFocused();
```

- [ ] Close chat through the same toggle:

```js
await page.getByTestId('circuit-chat-toggle').click();
await expect(page.getByTestId('tutor-chat')).toHaveCount(0);
```

- [ ] Run:

```powershell
npm exec -- playwright test tests/e2e/features.spec.js -g "browser verification protocol"
```

Expected before implementation: fail because `circuit-chat-toggle` does not exist.

### Task 2: Add Locale Keys

**Files:**

- Modify: `src/locales/ko.js`
- Modify: `src/locales/en.js`
- Modify: `tests/unit/i18n.test.js`

- [ ] Add Korean keys:

```js
chatToggleOpen: '회로 질문',
chatToggleClose: '질문 닫기',
currentSelection: '현재 선택',
emptyChat: '궁금한 점을 물어보세요. 선택한 부품이나 연결선에 맞춰 설명합니다.'
```

- [ ] Add English keys:

```js
chatToggleOpen: 'Ask',
chatToggleClose: 'Close',
currentSelection: 'Current selection',
emptyChat: 'Ask a question. Answers use the selected part or connection.'
```

- [ ] Add unit assertions:

```js
assert.equal(t('inspector.chatToggleOpen'), '회로 질문');
assert.equal(t('inspector.currentSelection'), '현재 선택');
assert.equal(t('inspector.chatToggleOpen', {}, 'en'), 'Ask');
assert.equal(t('inspector.emptyChat', {}, 'en'), 'Ask a question. Answers use the selected part or connection.');
```

- [ ] Run:

```powershell
node --test tests/unit/i18n.test.js
node --test tests/unit/koreanCopy.test.js
```

Expected: pass.

### Task 3: Add Persistent Header Toggle

**Files:**

- Modify: `src/main.js`

- [ ] In `renderHardwarePanel()`, replace the current header block with a header that includes a visible chat toggle:

```js
<div class="rail-header simulation-rail-header">
  <div>
    <div class="panel-kicker">${t('inspector.hardwareKicker', {}, state.locale)}</div>
    <h2>${t('inspector.hardwareTitle', {}, state.locale)}</h2>
  </div>
  <button
    class="button-outline rail-chat-toggle ${state.inspector.chatOpen ? 'is-active' : ''}"
    type="button"
    data-action="toggle-circuit-chat"
    data-testid="circuit-chat-toggle"
    aria-expanded="${state.inspector.chatOpen}"
    aria-controls="circuit-chat-panel"
  >
    ${state.inspector.chatOpen ? t('inspector.chatToggleClose', {}, state.locale) : t('inspector.chatToggleOpen', {}, state.locale)}
  </button>
</div>
```

- [ ] Keep the card-level `open-circuit-chat` button as a secondary shortcut for selected target context.
- [ ] Add event binding:

```js
app.querySelector('[data-action="toggle-circuit-chat"]')?.addEventListener('click', () => {
  state.inspector.chatOpen = !state.inspector.chatOpen;
  render();
  focusTutorInput();
});
```

- [ ] Add helper:

```js
function focusTutorInput() {
  if (!state.inspector.chatOpen) return;
  requestAnimationFrame(() => {
    app.querySelector('[data-action="ask-tutor"] input')?.focus();
  });
}
```

- [ ] Update existing open handler:

```js
state.inspector.chatOpen = true;
render();
focusTutorInput();
```

- [ ] Run:

```powershell
node --check src/main.js
```

Expected: no syntax errors.

### Task 4: Add Chat Context Label and Better Empty State

**Files:**

- Modify: `src/main.js`

- [ ] Add `id="circuit-chat-panel"` to the chat section.
- [ ] Add current selection label in `chat-target-context`:

```js
<span class="chat-context-label">${t('inspector.currentSelection', {}, state.locale)}</span>
<span class="inspector-target-label">${target.label}</span>
```

- [ ] Replace the empty chat string:

```js
messages.length
  ? messages.map(renderTutorMessage).join('')
  : `<p class="tutor-empty">${t('inspector.emptyChat', {}, state.locale)}</p>`
```

- [ ] Confirm whole-circuit context is shown when no target is selected.

### Task 5: Style Header Toggle and Inline Chat

**Files:**

- Modify: `src/styles.css`

- [ ] Add:

```css
.simulation-rail-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.rail-chat-toggle {
  flex: 0 0 auto;
  padding: 9px 12px;
}

.rail-chat-toggle.is-active {
  border-color: var(--c-primary);
  background: var(--c-primary);
  color: var(--c-canvas);
}

.chat-context-label {
  color: var(--c-muted);
  font-family: "Space Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  text-transform: uppercase;
}
```

- [ ] Preserve mobile bottom sheet:

```css
@media (max-width: 780px) {
  .circuit-chat-drawer {
    position: fixed;
    right: 12px;
    bottom: 12px;
    left: 12px;
    z-index: 20;
    max-height: calc(100vh - 42px);
    overflow: auto;
  }
}
```

- [ ] Verify the desktop drawer remains inline by not applying `position: fixed` outside the mobile media query.

### Task 6: Update E2E Flows to Prefer Header Toggle

**Files:**

- Modify: `tests/e2e/features.spec.js`

- [ ] Replace primary chat opening in tests:

```js
await page.getByTestId('circuit-chat-toggle').click();
```

- [ ] Keep one assertion that the secondary card shortcut still exists:

```js
await expect(page.locator('[data-action="open-circuit-chat"]')).toBeVisible();
```

- [ ] Assert chat context updates after selecting a connection while chat is open:

```js
await page.getByTestId('circuit-chat-toggle').click();
await page.locator('[data-inspect-type="connection"][data-inspect-id="oled-sda"]').click();
await expect(page.getByTestId('tutor-chat')).toContainText('I2C SDA');
```

- [ ] Assert closing preserves selected target:

```js
await page.getByTestId('circuit-chat-toggle').click();
await expect(page.getByTestId('tutor-chat')).toHaveCount(0);
await expect(page.getByTestId('inspector-selected')).toContainText('I2C SDA');
```

- [ ] Run:

```powershell
npm exec -- playwright test tests/e2e/features.spec.js -g "browser verification protocol|circuit inspector"
```

Expected: desktop and mobile pass.

### Task 7: Full Verification

**Files:**

- No implementation files.

- [ ] Run:

```powershell
npm run test:unit
npm run typecheck
npm run build
npm run test:e2e
npm run check
```

Expected:

- unit tests pass
- typecheck passes
- build passes
- E2E passes
- `npm run check` passes without live OpenAI calls

## 9. Acceptance Criteria

The work is complete when:

- PCB right panel always shows a visible `회로 질문` / `Ask` entry point.
- A student can open simulation chat before selecting any part or connection.
- Chat defaults to whole-circuit context when no target is selected.
- Selecting a part or connection updates the visible chat context.
- The selected-target card can still open chat as a secondary shortcut.
- Closing chat preserves selected target.
- Desktop chat is inline inside the right rail.
- Mobile chat remains a bottom sheet.
- Korean and English labels pass i18n tests.
- E2E covers discoverability, target grounding, close behavior, and mobile/desktop behavior.
- `npm run check` passes.

## 10. Notes for Implementation

Do not move simulation chat back into the left AI design panel. The left panel is for project creation and requirement refinement. The right panel is for inspecting the built circuit and asking questions about the selected simulated object.

Do not make chat permanently open by default. The persistent entry point solves discoverability without taking over the right rail. The student should see that chat exists, but the hardware panel should remain the default workspace.

## 11. Implementation Status

Status: implemented on 2026-05-31.

Implemented behavior:

- PCB right panel header now exposes a persistent `회로 질문` / `Ask` toggle with `data-testid="circuit-chat-toggle"`.
- The simulation chat can be opened before selecting a part or connection.
- When no target is selected, the chat context shows `전체 회로` / `Whole circuit`.
- When a part or connection is selected, the visible context updates to that selected target.
- The existing selected-card shortcut `이 부분 물어보기` remains as a secondary entry point.
- Opening chat focuses the tutor input.
- Closing chat preserves the currently selected part or connection.
- Desktop keeps chat inline in the right rail.
- Mobile keeps chat as a bottom sheet through the existing responsive rule.

Files changed:

- `src/main.js`
- `src/styles.css`
- `src/locales/ko.js`
- `src/locales/en.js`
- `tests/unit/i18n.test.js`
- `tests/e2e/features.spec.js`

Verification:

```powershell
node --check src/main.js
node --test tests/unit/i18n.test.js
node --test tests/unit/koreanCopy.test.js
npm run build
npm exec -- playwright test tests/e2e/features.spec.js -g "browser verification protocol|circuit inspector"
npm run check
```

Most recent recorded result:

- unit tests: 67 passed
- typecheck: passed
- production build: passed
- E2E: 22 passed
- live opt-in E2E: 8 skipped by default

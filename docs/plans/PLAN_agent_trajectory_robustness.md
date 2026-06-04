# Agent Trajectory Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make both Chat UI workflows correct across arbitrary user trajectories: build, ask, clarify, resume, revise, start a different task, recover from failures, and switch tutor targets without stale state corrupting the visible circuit or LangGraph thread.

**Architecture:** Keep the main synthesis chat as the framework-native LangGraph/Deep Agents workflow: checkpointer plus `thread_id` for memory, `interrupt()` plus `Command({ resume })` for clarification, and deterministic context/tool gates for synthesis authority. Add a thin HTTP/UI turn envelope around that workflow: `sessionId`, `taskId`, `turnId`, client `requestKind` hint, server `effectiveRequestKind`, `resumeInteractionId`, and artifact version metadata. Keep the right-side tutor stateless and selected-target scoped, but add target/artifact freshness guards so stale tutor responses cannot land on a new target.

**Tech Stack:** Vanilla JavaScript, Vite, three.js, Node test runner, TypeScript, Zod, LangChain JS, LangGraph, Deep Agents, optional LangSmith tracing.

---

## Status

Implemented on 2026-06-04. The final Ralph pass fixed the follow-up code-review
findings for UTF-8 source integrity and request-kind-scoped tool context, then
re-ran the full acceptance gate successfully.

This plan extends the already implemented memory/HITL work in
`docs/plans/PLAN_agent_memory_hitl_impl.md` and the chat/context refactor in
`docs/plans/PLAN_chat_ui_context_layer_refactor.md`.

The current code already has:

- Main synthesis `createDeepAgent(...)` with a LangGraph checkpointer and
  `thread_id = sessionId` in `server/agent/deepAgentRuntime.ts:536-544` and
  `:610-622`.
- `interrupt()` in `ask_to_narrow` in `server/agent/deepAgentTools.ts:119-144`.
- `Command({ resume })` in `server/agent/deepAgentRuntime.ts:586-590`.
- Client clarification chips that call `submitAgentMessage(option.label, { resume })`
  in `src/main.js:1344-1356`.

This plan does not re-introduce bespoke memory. It adds request/turn ownership,
artifact preservation, stale-response guards, and pending-interaction validation.

## Final Preflight Amendments

Five additional read-only subagent reviews were run before implementation. The
following amendments are binding for execution:

- Split client state for visible artifacts vs. latest agent response. Do not use
  one `state.agentResult` value as both the renderable circuit source and the
  clarification/chat response source. Use a separate visible artifact result,
  latest result, and `pendingClarification` state so preserving the PCB scene does
  not leave stale chips or status badges.
- A second non-resume design request may supersede an in-flight `initial_task`
  even when no artifact exists yet. The pending task itself is enough to create a
  fresh `taskId`, abort the older fetch, and ignore the older response.
- Treat client `requestKind` as an untrusted hint. The server computes
  `effectiveRequestKind` from schema-valid request facts, active session/task
  state, and bounded context. Server routing/prompt authority must use the
  effective value, not the raw client hint.
- Do not derive LangGraph `thread_id` by raw delimiter concatenation. Validate
  client ids with length/charset limits and resolve thread ids from an encoded or
  hashed tuple.
- Acquire server-side concurrency protection before any framework/model
  invocation for the resolved synthesis thread. Resume validation and pending
  interaction consumption must happen before context packet routing and must be
  fenced by session/task epoch or an equivalent per-session mutation guard.
- Pending clarification ids are random server nonces, single-use, TTL-bound, and
  validated against `(sessionId, taskId, threadId, interactionId, resume value)`.
  Framework interrupt ids may be stored separately when officially verified, but
  HTTP stale-resume safety must not depend on a framework id being present.
- Agent responses echo `taskId`, `turnId`, and `effectiveRequestKind`; buildable
  artifacts should also carry version metadata sufficient for stale UI/tutor
  checks. Client stale-result guards validate the echoed envelope before mutating
  UI state.
- General-chat classification runs after revision/build intent checks or
  explicitly rejects design verbs such as add/change/replace/build. Phrases like
  "thanks, add a buzzer" must remain revision requests.
- `AGENT_THREAD_BUSY` and `STALE_AGENT_RESUME` require server error mappings and
  student-facing client error-message mappings.
- Context cleanup is an acceptance blocker: client-sent `recentTurns` and folded
  summaries must not be injected into synthesis routing/prompt authority.

## Official Framework References Checked

Implementation must re-check these official docs before changing framework-dependent
runtime behavior:

- LangGraph memory and `thread_id`: `https://docs.langchain.com/oss/javascript/langgraph/add-memory`
- LangGraph interrupts and `Command({ resume })`: `https://docs.langchain.com/oss/javascript/langgraph/interrupts`
- Deep Agents `createDeepAgent` customization: `https://docs.langchain.com/oss/javascript/deepagents/customization`
- Deep Agents subagents and HITL/checkpointer notes: `https://docs.langchain.com/oss/javascript/deepagents/subagents`
- Repo workflow anchor: `docs/agent-request-to-simulation-workflow.md`
- Tutor workflow anchor: `docs/agent-tutor-serving-workflow.md`

Framework rules for this plan:

- Conversation continuity stays in LangGraph checkpointer state keyed by
  `thread_id`. Do not rebuild conversation memory from `recentTurns`.
- Clarification stays `interrupt()` plus `Command({ resume })`. Do not replace it
  with model-filled custom fields.
- `taskId` is part of `thread_id` selection, not a parallel memory system.
- `pendingInteractionId` is HTTP safety metadata for stale-resume rejection; it
  does not replace LangGraph's paused checkpoint.
- Tutor chat stays stateless until tutor-specific eval evidence justifies
  checkpointer-backed memory.

## Current Trajectory Gaps

### Main Chat UI

Current evidence:

- `src/main.js:1462` starts every non-confirm/non-artifact-question turn in
  `submitAgentMessage()`.
- `src/main.js:1500-1516` captures `conversationContext`, then immediately clears
  `state.agentResult`, `state.projectLoaded`, `state.built`, `state.running`, and
  inspector state before the server responds.
- `src/main.js:1546-1556` handles errors by adding an error message, but the
  previously visible circuit has already been cleared.
- `src/main.js:1532-1545` accepts whichever server result resolves for the current
  async call; there is no `turnId` stale-response guard.
- `src/agentSessionStore.js:16-42` persists only `sessionId` and recent messages;
  it does not persist `taskId` or pending clarification metadata.
- `server/context/contextPacket.ts:1731-1779` uses client-sent recent turns and
  artifact summary in routing context. This must remain bounded and untrusted.

Failure trajectories to close:

- Build OLED, ask a general question, and lose the current circuit scene.
- Build OLED, server fails on the next chat turn, and lose the current circuit scene.
- Ask a vague request, receive clarification chips, then type a new unrelated task;
  the old clarification resume can still target the same LangGraph thread.
- Send a slow request, start a different task before it returns, and let the slow
  result overwrite the newer task.
- Use one browser tab to resume an old clarification after another tab started a
  new task under the same `sessionId`.

### Right-Side Tutor Chat

Current evidence:

- `src/main.js:2206-2208` describes the selected target using
  `activeDraftOrProjectCircuit() || activeCircuit()`.
- `src/main.js:2254-2271` submits tutor questions but sends
  `circuit: activeCircuit()`, which can be wrong for an unconfirmed visible draft.
- `src/main.js:2223-2226` clears tutor messages when the selected target changes,
  but `submitTutorQuestion()` appends the awaited response without checking that
  the target is still current.
- `docs/agent-tutor-serving-workflow.md` explicitly says tutor mode is selected
  target QA, not stateful synthesis.

Failure trajectories to close:

- Ask about an unconfirmed draft target, but the tutor receives the built project
  or a null/default active circuit.
- Ask about SDA, quickly select SCL, and the delayed SDA answer appears in the SCL
  thread.
- Ask the tutor to "add a buzzer" and receive an explanation instead of routing a
  modification request to the main synthesis chat.

## Target Runtime Model

### Main Chat Identity

Use two ids:

- `sessionId`: browser conversation identity, persisted in `sessionStorage`.
- `taskId`: active synthesis task identity, persisted with the session. A new
  independent design task gets a new `taskId`.

The server validates ids and resolves the LangGraph thread from an encoded tuple:

```ts
export function resolveAgentThreadId(input: { sessionId: string; taskId?: string }) {
  const session = encodeThreadIdPart(input.sessionId);
  const task = input.taskId ? encodeThreadIdPart(input.taskId) : null;
  return task ? `session.${session}.task.${task}` : `session.${session}`;
}
```

Client request-kind hints:

```ts
export const AgentRequestKindSchema = z.enum([
  'initial_task',
  'new_task',
  'revise_current_artifact',
  'resume_clarification',
  'general_chat'
]);
```

Rules:

- The client sends `requestKind` as a hint for UI intent and testing
  observability.
- The server derives and echoes `effectiveRequestKind`; all routing/prompt
  authority uses this effective value.
- `initial_task`: first build/recommend/clarify request with no current artifact
  and no active pending synthesis task.
- `new_task`: user asks for a different independent design while an artifact or
  pending synthesis task exists. Client creates a new `taskId`.
- `revise_current_artifact`: user asks to add/change/replace the current circuit.
  Client keeps the current `taskId` and sends bounded artifact grounding, but the
  server only treats it as revision context when the active task/artifact state
  matches.
- `resume_clarification`: user selects a chip from the current pending
  clarification. Client sends the same `taskId`, `resume`, and
  `resumeInteractionId`; the server validates and consumes the pending
  interaction before building context or invoking the agent.
- `general_chat`: user is not asking to mutate or build. The visible artifact is
  preserved. Revision/build signals take precedence over social/meta phrases.

### Client Pending Turn State

Add:

```js
state.agentTaskId = state.agentTaskId || createClientId('task');
state.visibleArtifactResult = state.agentResult || null;
state.latestAgentResult = state.agentResult || null;
state.pendingAgentTurn = null;
state.pendingClarification = null;
state.artifactVersion = 0;
```

`pendingAgentTurn` shape:

```js
{
  turnId: 'turn-...',
  taskId: 'task-...',
  requestKind: 'new_task',
  abortController,
  startedAtMs
}
```

Apply rules:

- Starting a turn must not clear the currently visible artifact.
- A chat, clarification, or error result must preserve the previous artifact.
- A buildable circuit result increments `artifactVersion`, replaces
  `state.visibleArtifactResult`, updates `state.latestAgentResult`, and then
  resets inspector state.
- A non-buildable result updates `state.latestAgentResult` and
  `state.pendingClarification` without replacing `state.visibleArtifactResult`.
- A result whose echoed `turnId` or `taskId` no longer matches the active pending
  turn is ignored.
- Starting a new task while any synthesis turn is in flight aborts the old fetch,
  creates a new `taskId`, and prevents the old result from mutating UI state.

### Server Pending Interaction State

Store pending clarification metadata keyed by resolved LangGraph thread id:

```ts
type PendingAgentInteraction = {
  sessionId: string;
  interactionId: string;
  frameworkInterruptId?: string;
  threadId: string;
  taskId?: string;
  level: string;
  optionIds: string[];
  createdAtMs: number;
  expiresAtMs: number;
};
```

Rules:

- When an interrupt is surfaced, generate a random local interaction nonce for
  this HTTP response. Copy LangGraph interrupt `id` separately when official docs
  and runtime types confirm a stable field is available.
- Return `clarificationRequest.interactionId`.
- On `resume_clarification`, require `resumeInteractionId` to match the pending
  interaction for the resolved thread.
- Also require the resume `taskId` to match the active task registered for the
  browser `sessionId`. This prevents an old tab or old chip from resuming a
  prior task after a new task became active.
- If the resume value came from a chip, require it to be one of the pending option
  ids.
- Consume a pending interaction exactly once under the session/thread guard before
  invoking `Command({ resume })`.
- Clear the pending interaction when a normal chat/circuit result completes, when a
  new task starts, or when the pending interaction is rejected as stale.
- Expire pending interactions after a bounded TTL and cap in-memory maps to avoid
  long-running dev-server leaks.

### Server Turn Concurrency

Add an in-process turn lock per resolved LangGraph thread id plus a short
per-session mutation guard. The lock prevents two requests from invoking the same
checkpointed graph concurrently and the session guard prevents active-task and
pending-resume races across different task threads.

Behavior:

- Same `threadId` while active, before any framework/model invocation: return an
  `AGENT_THREAD_BUSY` HTTP error with status 409.
- Different `taskId` under the same `sessionId`: allowed, because it resolves to a
  different LangGraph `thread_id`.
- Active-task epoch is rechecked before `Command({ resume })`, pending
  interaction registration, and pending cleanup.
- Client treats 409 as a recoverable chat status and keeps the visible artifact.

## File Structure

- Create `src/agentTurnEnvelope.js`
  - Pure client helper for request kind, task id, turn id, and stale-result checks.

- Modify `src/main.js`
  - Use `agentTurnEnvelope`.
  - Preserve visible artifacts through chat/error/awaiting-input results.
  - Add pending-turn abort/supersede handling.
  - Persist `taskId` and pending clarification metadata.
  - Fix tutor circuit grounding and stale tutor response guards.

- Modify `src/aiClient.js`
  - Send `taskId`, `turnId`, `requestKind`, and `resumeInteractionId`.
  - Use per-turn `AbortSignal`.

- Modify `src/conversationRouting.js`
  - Add conservative `general-chat` classification for social/meta turns that
    must not start a new circuit task.

- Modify `src/agentSessionStore.js`
  - Persist `activeTaskId` and `pendingClarification`.

- Create `src/tutorRequestFreshness.js`
  - Pure helper for tutor target/artifact request keys.

- Create `server/agent/agentThreadSession.ts`
  - Resolve thread ids.
  - Track per-thread active turn locks.
  - Track active task id per browser session.
  - Track pending interaction metadata.
  - Export test reset helpers only under explicit test names.

- Modify `server/agent/schemas.ts`
  - Add `AgentRequestKindSchema`, `taskId`, `turnId`, `resumeInteractionId`,
    and `clarificationRequest.interactionId`.

- Modify `server/agent/deepAgentRuntime.ts`
  - Use resolved `threadId`.
  - Register and validate pending interactions.
  - Reject stale resume attempts without invoking the agent.
  - Run synthesis invocation under the per-thread lock.

- Modify `server/agent/errorResponse.ts`
  - Map `AGENT_THREAD_BUSY` and stale-resume errors to stable HTTP responses.

- Modify docs:
  - `docs/agent-request-to-simulation-workflow.md`
  - `docs/agent-tutor-serving-workflow.md`
  - `docs/README.md`

- Create or modify tests:
  - `tests/unit/agentTurnEnvelope.test.js`
  - `tests/unit/agentSessionStore.test.js`
  - `tests/unit/aiClient.test.js`
  - `tests/unit/tutorRequestFreshness.test.js`
  - `tests/unit/agentThreadSession.test.ts`
  - `tests/unit/agentInterrupt.test.ts`
  - `tests/unit/agentSchemas.test.ts`
  - `tests/unit/agentErrorResponse.test.ts`
  - `tests/unit/conversationRouting.test.js`
  - `tests/unit/reactSystemPrompt.test.ts`
  - `tests/e2e/agent-trajectory.spec.js`
  - Existing tutor tests in `tests/e2e/features.spec.js`

---

## Task 1: RED Trajectory Characterization Tests

**Goal:** Freeze the failure trajectories before changing behavior.

**Files:**

- Create: `tests/e2e/agent-trajectory.spec.js`
- Modify: `tests/unit/agentInterrupt.test.ts`
- Modify: `tests/unit/conversationRouting.test.js`
- Modify: `tests/unit/circuitTutorClient.test.js`

- [x] **Step 1: Add e2e test for artifact preservation after chat**

Create `tests/e2e/agent-trajectory.spec.js` with a mocked `/api/agent/message`
route. Use the existing `mockOledProject.js` fixture pattern from the e2e suite.
Define local helpers in the new spec; do not assume global helpers exist:

```js
import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { loadMockOledProject, validOledAgentResultFixture } from './mockOledProject.js';

const AGENT_MESSAGE_ROUTE = '**/api/agent/message';
const AGENT_HEALTH_ROUTE = '**/api/agent/health';

async function submitMainChat(page, text) {
  await page.locator('#idea-input').fill(text);
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
}

function countNonBackgroundPixels(buffer) {
  const image = PNG.sync.read(buffer);
  const [r0, g0, b0] = image.data;
  let changed = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    const r = image.data[index];
    const g = image.data[index + 1];
    const b = image.data[index + 2];
    const a = image.data[index + 3];
    const distance = Math.abs(r - r0) + Math.abs(g - g0) + Math.abs(b - b0);
    if (a > 0 && distance > 40) changed += 1;
  }
  return changed;
}

async function expectVisibleNonBlankStage(page, minPixels = 5000) {
  const canvas = page.getByTestId('stage-canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-render-ready', 'true');
  expect(countNonBackgroundPixels(await canvas.screenshot())).toBeGreaterThan(minPixels);
}

function mockOledCircuitResult(sessionId, taskId, runText = 'HELLO') {
  const result = validOledAgentResultFixture();
  result.sessionId = sessionId;
  result.circuitSpec.behavior.runText = runText;
  result.renderPlan.runText = runText;
  result.simulationPlan.runText = runText;
  return result;
}

function mockChatResult(sessionId, text) {
  const base = validOledAgentResultFixture();
  return {
    ...base,
    sessionId,
    responseKind: 'chat',
    servingStatus: undefined,
    assistantMessages: [text],
    renderPlan: { ...base.renderPlan, parts: [], connections: [] },
    simulationPlan: { ...base.simulationPlan, status: 'not_runnable', currentPaths: [], expectedStates: [] },
    buildRunnableReport: { ...base.buildRunnableReport, runnable: false, status: 'not_runnable' }
  };
}

function awaitingInputResult(sessionId, taskId, interactionId) {
  const base = mockChatResult(sessionId, 'Choose one output.');
  return {
    ...base,
    responseKind: 'awaiting_input',
    clarificationRequest: {
      interactionId,
      level: 'output',
      question: 'Choose one output.',
      options: [{ id: 'light', label: 'Light / LED' }]
    }
  };
}

function liveTutorAnswer(message) {
  return {
    sessionId: 'tutor-trajectory',
    mode: 'live',
    servingStatus: 'live_tutor_answer',
    message,
    grounding: ['target'],
    suggestedQuestions: []
  };
}

function createDeferredResponse() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function installAgentHealth(page) {
  await page.route(AGENT_HEALTH_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        defaultMode: 'deepagents-live',
        provider: 'openai',
        model: 'mock-e2e',
        hasServerKey: true,
        requiredEnv: []
      })
    });
  });
}

async function mockAgentServer(page, responses) {
  const posts = [];
  await installAgentHealth(page);
  await page.route(AGENT_MESSAGE_ROUTE, async (route) => {
    const body = route.request().postDataJSON();
    posts.push(body);
    const response = responses.shift();
    if (response?.status) {
      await route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: JSON.stringify(response.body)
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(typeof response === 'function' ? response(body) : response)
    });
  });
  return { posts };
}
```

Test shape:

```js
test('main chat preserves visible circuit after conversational answer', async ({ page }) => {
  const agent = await mockAgentServer(page, [
    mockOledCircuitResult('session-traj', 'task-a'),
    mockChatResult('session-traj', 'Thanks. I will keep the current circuit visible.')
  ]);

  await page.goto('/');
  await submitMainChat(page, 'Build an OLED circuit that shows Hello.');
  await page.locator('[data-tab="PCB"]').click();
  await expectVisibleNonBlankStage(page);

  await submitMainChat(page, 'thanks');

  await expectVisibleNonBlankStage(page);
  await page.locator('[data-action="run"]').click();
  await expect(page.getByTestId('oled-output')).toContainText(/HELLO|Hello/i);
  expect(agent.posts.at(-1).requestKind).toBe('general_chat');
});
```

Expected before implementation: FAIL because `src/main.js:1511-1516` clears the
visible artifact before the chat response.

- [x] **Step 2: Add e2e test for artifact preservation after server error**

Test shape:

```js
test('main chat preserves visible circuit after agent server error', async ({ page }) => {
  await mockAgentServer(page, [
    mockOledCircuitResult('session-error', 'task-a'),
    { status: 500, body: { error: 'synthetic failure' } }
  ]);

  await page.goto('/');
  await submitMainChat(page, 'Build an OLED circuit.');
  await page.locator('[data-tab="PCB"]').click();
  await expectVisibleNonBlankStage(page);

  await submitMainChat(page, 'Show me another example.');

  await expectVisibleNonBlankStage(page);
  await page.locator('[data-action="run"]').click();
  await expect(page.getByTestId('oled-output')).toContainText(/HELLO|RALPHTON/i);
  await expect(page.locator('.message.assistant').last()).toContainText(/문제|problem|failure/i);
});
```

Expected before implementation: FAIL because the prior artifact is cleared before
the failing request returns.

- [x] **Step 3: Add e2e test for superseding a slow turn**

Test shape:

```js
test('new task supersedes slow previous turn and stale response is ignored', async ({ page }) => {
  const gate = createDeferredResponse();
  const posts = [];
  try {
    await installAgentHealth(page);
    await page.route('**/api/agent/message', async (route) => {
      const body = route.request().postDataJSON();
      const requestNumber = posts.push(body);
      if (requestNumber === 1) {
        await gate.promise;
        await route.fulfill({ json: mockOledCircuitResult('session-race', body.taskId, 'OLD') });
        return;
      }
      await route.fulfill({ json: mockOledCircuitResult('session-race', body.taskId, 'NEW') });
    });

    await page.goto('/');
    await submitMainChat(page, 'Build a first LED circuit.');
    await submitMainChat(page, 'Build a second OLED circuit instead.');
    await expect.poll(() => posts.length).toBeGreaterThanOrEqual(2);
    gate.resolve();

    await page.locator('[data-action="run"]').click();
    await expect(page.getByTestId('oled-output')).toContainText(/NEW|OLED/i);
    await expect(page.getByTestId('oled-output')).not.toContainText('OLD');
    await expectVisibleNonBlankStage(page);
  } finally {
    gate.resolve();
  }
});
```

Expected before implementation: FAIL because `state.thinking` blocks the second
submit, or the old result can still own the UI.

- [x] **Step 4: Extend unit test for interrupt identity**

In `tests/unit/agentInterrupt.test.ts`, change the interrupt fixture to include
a LangGraph interrupt id:

```ts
const INTERRUPT_OUTPUT = {
  __interrupt__: [
    {
      id: 'interrupt-output-1',
      value: {
        level: 'output',
        question: '무엇을 만들까요?',
        options: [
          { id: 'light', label: '빛 / LED' },
          { id: 'sound', label: '소리' }
        ]
      }
    }
  ]
};
```

Add assertions:

```ts
assert.equal(result.clarificationRequest?.interactionId, 'interrupt-output-1');
```

Expected before implementation: FAIL because `ClarificationRequestSchema` has no
`interactionId`.

- [x] **Step 5: Add general-chat routing unit test**

In `tests/unit/conversationRouting.test.js`, add:

```js
test('social turn over a current artifact routes to general chat, not a new task', () => {
  assert.deepEqual(
    classifyStudentTurn('thanks', {
      hasBuildableDraft: false,
      hasCurrentArtifact: true
    }),
    { route: 'general-chat', reason: 'social-or-meta-chat' }
  );

  assert.deepEqual(
    classifyStudentTurn('thanks, keep it as is', {
      hasBuildableDraft: false,
      hasCurrentArtifact: true
    }),
    { route: 'general-chat', reason: 'social-or-meta-chat' }
  );
});
```

Expected before implementation: FAIL because `classifyStudentTurn()` currently
returns `synthesize-or-clarify`.

- [x] **Step 6: Add stale tutor response e2e or unit test**

If the e2e fixture is already open in `tests/e2e/features.spec.js`, add this case
there; otherwise keep it in `agent-trajectory.spec.js`:

```js
test('delayed tutor answer is ignored after selected target changes', async ({ page }) => {
  const gate = createDeferredResponse();
  try {
    await page.route('**/api/agent/explain-target', async (route) => {
      const body = route.request().postDataJSON();
      if (body.target.id.includes('SDA')) {
        await gate.promise;
        await route.fulfill({ json: liveTutorAnswer('SDA delayed answer') });
        return;
      }
      await route.fulfill({ json: liveTutorAnswer('SCL current answer') });
    });

    await page.goto('/');
    await loadMockOledProject(page);
    await page.locator('[data-tab="PCB"]').click();
    await page.locator('[data-inspect-type="connection"][data-inspect-id="oled-sda"]').click();
    await page.getByTestId('circuit-chat-toggle').click();
    await page.locator('[data-action="ask-tutor"] input').fill('What is this wire?');
    await page.locator('[data-action="ask-tutor"]').getByRole('button').click();

    await page.locator('[data-inspect-type="connection"][data-inspect-id="oled-scl"]').click();
    await expect(page.getByTestId('tutor-chat')).toBeVisible();
    await page.locator('[data-action="ask-tutor"] input').fill('What is this wire?');
    await page.locator('[data-action="ask-tutor"]').getByRole('button').click();
    gate.resolve();

    await expect(page.getByTestId('tutor-thread')).toContainText('SCL current answer');
    await expect(page.getByTestId('tutor-thread')).not.toContainText('SDA delayed answer');
  } finally {
    gate.resolve();
  }
});
```

Expected before implementation: FAIL because `submitTutorQuestion()` appends the
awaited response without a target freshness check.

- [x] **Step 7: Run RED tests**

Run:

```powershell
npm run test:e2e -- tests/e2e/agent-trajectory.spec.js
npm exec tsx -- --test tests/unit/agentInterrupt.test.ts
node --test tests/unit/conversationRouting.test.js
```

Expected: the new tests fail for the reasons listed above.

---

## Task 2: Client Turn Envelope And Session Persistence

**Goal:** Give the UI explicit ownership over active task, active turn, and pending clarification identity.

**Files:**

- Create: `src/agentTurnEnvelope.js`
- Modify: `src/conversationRouting.js`
- Modify: `src/agentSessionStore.js`
- Modify: `src/aiClient.js`
- Test: `tests/unit/agentTurnEnvelope.test.js`
- Test: `tests/unit/conversationRouting.test.js`
- Test: `tests/unit/agentSessionStore.test.js`
- Test: `tests/unit/aiClient.test.js`

- [x] **Step 1: Add pure turn-envelope tests**

Create `tests/unit/agentTurnEnvelope.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAgentTurnEnvelope,
  isStaleAgentTurnResult
} from '../../src/agentTurnEnvelope.js';

const ids = ['turn-1', 'task-1', 'turn-2', 'task-2'];
const nextId = (prefix) => ids.shift() || `${prefix}-fallback`;

test('initial request creates a task and turn id', () => {
  const envelope = createAgentTurnEnvelope({
    route: { route: 'synthesize-or-clarify' },
    hasCurrentArtifact: false,
    activeTaskId: null,
    nextId
  });

  assert.equal(envelope.requestKind, 'initial_task');
  assert.equal(envelope.taskId, 'task-1');
  assert.equal(envelope.turnId, 'turn-1');
});

test('new independent request over a current artifact creates a new task id', () => {
  const envelope = createAgentTurnEnvelope({
    route: { route: 'synthesize-or-clarify' },
    hasCurrentArtifact: true,
    activeTaskId: 'task-old',
    nextId
  });

  assert.equal(envelope.requestKind, 'new_task');
  assert.equal(envelope.taskId, 'task-2');
});

test('revision keeps the active task id', () => {
  const envelope = createAgentTurnEnvelope({
    route: { route: 'revise-current-draft' },
    hasCurrentArtifact: true,
    activeTaskId: 'task-old',
    nextId
  });

  assert.equal(envelope.requestKind, 'revise_current_artifact');
  assert.equal(envelope.taskId, 'task-old');
});

test('social/meta chat keeps the active task id', () => {
  const envelope = createAgentTurnEnvelope({
    route: { route: 'general-chat' },
    hasCurrentArtifact: true,
    activeTaskId: 'task-old',
    nextId
  });

  assert.equal(envelope.requestKind, 'general_chat');
  assert.equal(envelope.taskId, 'task-old');
});

test('resume keeps the active task id and carries the pending interaction id', () => {
  const envelope = createAgentTurnEnvelope({
    resume: 'sound',
    pendingClarification: { interactionId: 'interrupt-1' },
    activeTaskId: 'task-old',
    nextId
  });

  assert.equal(envelope.requestKind, 'resume_clarification');
  assert.equal(envelope.taskId, 'task-old');
  assert.equal(envelope.resumeInteractionId, 'interrupt-1');
});

test('stale turn results are rejected by task or turn mismatch', () => {
  assert.equal(isStaleAgentTurnResult(
    { turnId: 'turn-a', taskId: 'task-a' },
    { turnId: 'turn-a', taskId: 'task-a' }
  ), false);
  assert.equal(isStaleAgentTurnResult(
    { turnId: 'turn-a', taskId: 'task-a' },
    { turnId: 'turn-b', taskId: 'task-a' }
  ), true);
  assert.equal(isStaleAgentTurnResult(
    { turnId: 'turn-a', taskId: 'task-a' },
    { turnId: 'turn-a', taskId: 'task-b' }
  ), true);
});
```

- [x] **Step 2: Implement `src/agentTurnEnvelope.js`**

Use ASCII ids so tests can inject deterministic ids:

```js
export function defaultClientId(prefix) {
  const cryptoApi = globalThis.crypto;
  const suffix = cryptoApi?.randomUUID ? cryptoApi.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

export function createAgentTurnEnvelope({
  route,
  resume,
  pendingClarification,
  hasCurrentArtifact,
  activeTaskId,
  nextId = defaultClientId
} = {}) {
  const turnId = nextId('turn');
  if (resume) {
    return {
      turnId,
      taskId: activeTaskId || nextId('task'),
      requestKind: 'resume_clarification',
      resumeInteractionId: pendingClarification?.interactionId || null
    };
  }

  if (route?.route === 'revise-current-draft') {
    return {
      turnId,
      taskId: activeTaskId || nextId('task'),
      requestKind: 'revise_current_artifact',
      resumeInteractionId: null
    };
  }

  if (route?.route === 'general-chat') {
    return {
      turnId,
      taskId: activeTaskId || nextId('task'),
      requestKind: 'general_chat',
      resumeInteractionId: null
    };
  }

  if (route?.route === 'current-artifact-question') {
    return {
      turnId,
      taskId: activeTaskId || nextId('task'),
      requestKind: 'general_chat',
      resumeInteractionId: null
    };
  }

  const taskId = hasCurrentArtifact ? nextId('task') : (activeTaskId || nextId('task'));
  return {
    turnId,
    taskId,
    requestKind: hasCurrentArtifact ? 'new_task' : 'initial_task',
    resumeInteractionId: null
  };
}

export function isStaleAgentTurnResult(pendingTurn, responseEnvelope) {
  if (!pendingTurn || !responseEnvelope) {
    return true;
  }
  return pendingTurn.turnId !== responseEnvelope.turnId
    || pendingTurn.taskId !== responseEnvelope.taskId;
}
```

- [x] **Step 3: Add conservative general-chat routing**

In `src/conversationRouting.js`, add:

```js
export function isGeneralChat(message) {
  const text = normalizeTurnText(message);
  return /^(thanks|thank you|hello|hi|what can i ask|keep it|looks good)/i.test(text);
}
```

Then in `classifyStudentTurn()`, after confirmation and before revision/artifact
question checks:

```js
if (hasCurrentArtifact && isGeneralChat(text)) {
  return { route: 'general-chat', reason: 'social-or-meta-chat' };
}
```

Run:

```powershell
node --test tests/unit/conversationRouting.test.js
```

Expected: PASS after implementation.

- [x] **Step 4: Extend session-store tests**

In `tests/unit/agentSessionStore.test.js`, add:

```js
test('persists active task id and pending clarification metadata', () => {
  const storage = memoryStorage();
  saveAgentSession(storage, {
    sessionId: 'session-1',
    activeTaskId: 'task-1',
    pendingClarification: {
      interactionId: 'interrupt-1',
      taskId: 'task-1',
      question: 'Choose one',
      options: [{ id: 'light', label: 'LED' }]
    },
    messages: [{ role: 'student', text: 'hi' }]
  });

  const restored = loadAgentSession(storage);
  assert.equal(restored.activeTaskId, 'task-1');
  assert.equal(restored.pendingClarification.interactionId, 'interrupt-1');
  assert.equal(restored.pendingClarification.options[0].id, 'light');
});
```

- [x] **Step 5: Update `src/agentSessionStore.js`**

Keep the existing best-effort behavior and add bounded pending metadata:

```js
function parsePendingClarification(value) {
  if (!value || typeof value !== 'object' || typeof value.interactionId !== 'string') {
    return null;
  }
  const options = Array.isArray(value.options)
    ? value.options
        .filter((option) => option && typeof option.id === 'string' && typeof option.label === 'string')
        .slice(0, 12)
        .map((option) => ({ id: option.id.slice(0, 120), label: option.label.slice(0, 120) }))
    : [];
  return {
    interactionId: value.interactionId.slice(0, 160),
    taskId: typeof value.taskId === 'string' ? value.taskId.slice(0, 160) : null,
    question: typeof value.question === 'string' ? value.question.slice(0, 500) : '',
    options
  };
}
```

Return and save `activeTaskId` plus `pendingClarification`.

- [x] **Step 6: Extend `aiClient` test and implementation**

In `tests/unit/aiClient.test.js`, assert the body includes:

```js
assert.equal(body.taskId, 'task-1');
assert.equal(body.turnId, 'turn-1');
assert.equal(body.requestKind, 'resume_clarification');
assert.equal(body.resumeInteractionId, 'interrupt-1');
```

Add a caller-abort test:

```js
test('sendAgentMessage preserves caller AbortError separately from timeout', async () => {
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    if (String(url).endsWith('/api/agent/health')) {
      return {
        ok: true,
        json: async () => ({ ok: true, hasServerKey: true, requiredEnv: [] })
      };
    }
    controller.abort();
    throw new DOMException('The operation was aborted.', 'AbortError');
  };

  await assert.rejects(
    () => sendAgentMessage({
      message: 'Build OLED',
      locale: 'en',
      signal: controller.signal
    }),
    (error) => error.name === 'AbortError' || error.cause?.name === 'AbortError'
  );
});
```

In `src/aiClient.js`, extend the function signature:

```js
export async function sendAgentMessage({
  sessionId,
  taskId,
  turnId,
  requestKind,
  message,
  resume,
  resumeInteractionId,
  confirmation,
  locale,
  conversationContext,
  signal
}) {
```

Add the optional fields to `body` and pass `signal` into `fetchJson`.

Then update `fetchJson(path, { method, body, timeoutMs, signal: callerSignal })`
to compose the caller signal with its timeout signal
instead of replacing the caller signal:

```js
function composeAbortSignals(primarySignal, timeoutMs) {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
  const controller = new AbortController();

  const abortFrom = (signal) => {
    if (!signal) return;
    if (signal.aborted) {
      controller.abort(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  };

  abortFrom(primarySignal);
  abortFrom(timeoutController.signal);
  return { signal: controller.signal, clear: () => clearTimeout(timeout), timeoutSignal: timeoutController.signal };
}
```

Use it as:

```js
const composed = composeAbortSignals(callerSignal, timeoutMs);
try {
  const response = await fetch(`${agentApiBase()}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: composed.signal
  });
  // existing response handling
} finally {
  composed.clear();
}
```

In the catch block:

```js
if (error.name === 'AbortError' && callerSignal?.aborted) {
  throw error;
}
if (error.name === 'AbortError') {
  throw new AgentApiError('Agent API request timed out.', { cause: error });
}
```

This preserves UI supersede aborts as aborts while retaining the existing timeout
error behavior.

- [x] **Step 7: Run unit tests**

Run:

```powershell
node --test tests/unit/agentTurnEnvelope.test.js tests/unit/conversationRouting.test.js tests/unit/agentSessionStore.test.js tests/unit/aiClient.test.js
```

Expected: PASS after implementation.

---

## Task 3: Main Chat Artifact Preservation And Stale Result Guard

**Goal:** Make chat/error/awaiting-input turns non-destructive, and make stale async results inert.

**Files:**

- Modify: `src/main.js`
- Test: `tests/e2e/agent-trajectory.spec.js`

- [x] **Step 1: Wire envelope into `submitAgentMessage()`**

At `src/main.js:1462`, replace the early `if (state.thinking) return;` guard.
Compute `turnRoute` first, then allow only a new independent task to supersede
an in-flight turn:

```js
if (state.thinking && resume) {
  return;
}
```

After `turnRoute` is computed, create the envelope:

```js
const envelope = createAgentTurnEnvelope({
  route: turnRoute,
  resume,
  pendingClarification: state.pendingClarification,
  hasCurrentArtifact: Boolean(state.projectLoaded || canShowAgentScene(state.agentResult)),
  activeTaskId: state.agentTaskId
});
```

If `envelope.requestKind === 'new_task'`, set `state.agentTaskId = envelope.taskId`
before sending. For revisions and resumes, keep the current task id.

- [x] **Step 2: Replace destructive pre-clear with pending state**

Remove the eager clears at `src/main.js:1510-1516`. Replace them with:

```js
state.pendingAgentTurn?.abortController?.abort();
const abortController = new AbortController();
state.pendingAgentTurn = {
  turnId: envelope.turnId,
  taskId: envelope.taskId,
  requestKind: envelope.requestKind,
  abortController,
  startedAtMs: Date.now()
};
state.awaitingConfirmation = false;
state.activeTab = envelope.requestKind === 'general_chat' ? state.activeTab : 'Files';
state.thinking = true;
```

Do not clear `state.agentResult`, `state.projectLoaded`, `state.built`,
`state.running`, or inspector state here.

- [x] **Step 3: Send envelope fields**

Extend the `sendAgentMessage()` call:

```js
sendAgentMessage({
  sessionId: state.agentSessionId,
  taskId: envelope.taskId,
  turnId: envelope.turnId,
  requestKind: envelope.requestKind,
  message,
  resume,
  resumeInteractionId: envelope.resumeInteractionId,
  locale: state.locale,
  conversationContext,
  signal: abortController.signal
})
```

- [x] **Step 4: Ignore stale or aborted responses**

After the awaited response, before mutating state:

```js
if (isStaleAgentTurnResult(state.pendingAgentTurn, envelope)) {
  return;
}
```

In the catch block:

```js
if (error?.name === 'AbortError') {
  return;
}
if (isStaleAgentTurnResult(state.pendingAgentTurn, envelope)) {
  return;
}
```

- [x] **Step 5: Apply result without destroying old artifact**

Replace unconditional `state.agentResult = groundedResult` with:

```js
const canShowScene = canShowAgentScene(groundedResult);
state.agentSessionId = groundedResult.sessionId;
state.agentTaskId = envelope.taskId;

if (canShowScene) {
  state.agentResult = groundedResult;
  state.projectLoaded = false;
  state.built = false;
  state.running = false;
  state.artifactVersion += 1;
  resetInspectorState();
}

if (groundedResult.responseKind === 'awaiting_input' && groundedResult.clarificationRequest) {
  state.pendingClarification = {
    ...groundedResult.clarificationRequest,
    taskId: envelope.taskId
  };
} else {
  state.pendingClarification = null;
}
```

Use `canShowScene` for status/decisions. A non-scene result appends chat text but
keeps the previous project/draft state intact.

- [x] **Step 6: Clear pending turn only for the active envelope**

In `finally`:

```js
if (!isStaleAgentTurnResult(state.pendingAgentTurn, envelope)) {
  state.pendingAgentTurn = null;
  state.thinking = false;
  persistAgentSession();
  render();
}
```

- [x] **Step 7: Let a new independent task supersede an in-flight task**

Update submit-button handling so a new non-resume message can be submitted while
`state.thinking` is true. Keep resume chips disabled while a resume turn is in
flight.

Behavior:

```js
if (state.thinking && resume) {
  return;
}
if (state.thinking && envelope.requestKind !== 'new_task') {
  return;
}
if (state.thinking && envelope.requestKind === 'new_task') {
  state.pendingAgentTurn?.abortController?.abort();
}
```

- [x] **Step 8: Run e2e tests**

Run:

```powershell
npm run test:e2e -- tests/e2e/agent-trajectory.spec.js --grep "main chat"
```

Expected: artifact-preservation, server-error, and slow-turn supersede tests pass.

---

## Task 4: Server Request Envelope, Thread Identity, And Pending Interaction Validation

**Goal:** Isolate independent tasks into separate LangGraph threads and reject stale clarification resumes.

**Files:**

- Create: `server/agent/agentThreadSession.ts`
- Modify: `server/agent/schemas.ts`
- Modify: `server/agent/deepAgentRuntime.ts`
- Modify: `server/agent/errorResponse.ts`
- Test: `tests/unit/agentThreadSession.test.ts`
- Test: `tests/unit/agentInterrupt.test.ts`
- Test: `tests/unit/agentSchemas.test.ts`
- Test: `tests/unit/agentErrorResponse.test.ts`

- [x] **Step 1: Add schema tests**

In `tests/unit/agentSchemas.test.ts`, add:

```ts
test('agent message request accepts turn envelope fields', () => {
  const parsed = AgentMessageRequestSchema.parse({
    sessionId: 'session-1',
    taskId: 'task-1',
    turnId: 'turn-1',
    requestKind: 'resume_clarification',
    resumeInteractionId: 'interrupt-1',
    message: 'LED',
    resume: 'light',
    locale: 'ko'
  });

  assert.equal(parsed.taskId, 'task-1');
  assert.equal(parsed.requestKind, 'resume_clarification');
});

test('clarification request carries interaction id', () => {
  const parsed = ClarificationRequestSchema.parse({
    interactionId: 'interrupt-1',
    level: 'output',
    question: 'Choose',
    options: [{ id: 'light', label: 'LED' }]
  });

  assert.equal(parsed.interactionId, 'interrupt-1');
});
```

- [x] **Step 2: Update `server/agent/schemas.ts`**

Add:

```ts
export const AgentRequestKindSchema = z.enum([
  'initial_task',
  'new_task',
  'revise_current_artifact',
  'resume_clarification',
  'general_chat'
]);
```

Extend `ClarificationRequestSchema`:

```ts
interactionId: z.string().min(1)
```

Extend `AgentMessageRequestSchema`:

```ts
taskId: z.string().min(1).optional(),
turnId: z.string().min(1).optional(),
requestKind: AgentRequestKindSchema.default('initial_task'),
resumeInteractionId: z.string().min(1).optional(),
```

- [x] **Step 3: Add thread-session tests**

Create `tests/unit/agentThreadSession.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentThreadBusyError,
  StaleAgentResumeError,
  clearPendingInteraction,
  registerPendingInteraction,
  resolveAgentThreadId,
  registerActiveTask,
  validatePendingResume,
  withAgentThreadTurn,
  resetAgentThreadSessionForTests
} from '../../server/agent/agentThreadSession.ts';

test('task id scopes LangGraph thread id under a browser session', () => {
  assert.equal(resolveAgentThreadId({ sessionId: 's', taskId: 't' }), 's:t');
  assert.equal(resolveAgentThreadId({ sessionId: 's' }), 's');
});

test('pending resume must match interaction id and option id', () => {
  resetAgentThreadSessionForTests();
  registerActiveTask('s', 't');
  registerPendingInteraction({
    sessionId: 's',
    taskId: 't',
    threadId: 's:t',
    interactionId: 'interrupt-1',
    level: 'output',
    optionIds: ['light', 'sound'],
    createdAtMs: 1
  });

  assert.doesNotThrow(() => validatePendingResume({
    sessionId: 's',
    taskId: 't',
    threadId: 's:t',
    interactionId: 'interrupt-1',
    resume: 'sound'
  }));
  assert.throws(() => validatePendingResume({
    sessionId: 's',
    taskId: 't',
    threadId: 's:t',
    interactionId: 'interrupt-old',
    resume: 'sound'
  }), StaleAgentResumeError);
  assert.throws(() => validatePendingResume({
    sessionId: 's',
    taskId: 't',
    threadId: 's:t',
    interactionId: 'interrupt-1',
    resume: 'motor'
  }), StaleAgentResumeError);
});

test('old task resume is rejected after the same session starts a newer task', () => {
  resetAgentThreadSessionForTests();
  registerActiveTask('s', 'old-task');
  registerPendingInteraction({
    sessionId: 's',
    taskId: 'old-task',
    threadId: 's:old-task',
    interactionId: 'interrupt-old',
    level: 'output',
    optionIds: ['light'],
    createdAtMs: 1
  });

  registerActiveTask('s', 'new-task');

  assert.throws(() => validatePendingResume({
    sessionId: 's',
    taskId: 'old-task',
    threadId: 's:old-task',
    interactionId: 'interrupt-old',
    resume: 'light'
  }), StaleAgentResumeError);
});

test('per-thread turn lock rejects concurrent invocation on same thread', async () => {
  resetAgentThreadSessionForTests();
  let release;
  const first = withAgentThreadTurn('s:t', 'turn-1', () => new Promise((resolve) => {
    release = resolve;
  }));

  await assert.rejects(
    () => withAgentThreadTurn('s:t', 'turn-2', async () => 'second'),
    AgentThreadBusyError
  );

  release('first');
  assert.equal(await first, 'first');
});

test('different task thread can run while another task is active', async () => {
  resetAgentThreadSessionForTests();
  let release;
  const first = withAgentThreadTurn('s:t1', 'turn-1', () => new Promise((resolve) => {
    release = resolve;
  }));
  const second = await withAgentThreadTurn('s:t2', 'turn-2', async () => 'second');
  release('first');

  assert.equal(second, 'second');
  assert.equal(await first, 'first');
});
```

- [x] **Step 4: Implement `server/agent/agentThreadSession.ts`**

Use named errors so `server/index.ts` can map them:

```ts
export class AgentThreadBusyError extends Error {
  readonly code = 'AGENT_THREAD_BUSY';
  constructor(readonly threadId: string) {
    super(`Agent thread is already running: ${threadId}`);
    this.name = 'AgentThreadBusyError';
  }
}

export class StaleAgentResumeError extends Error {
  readonly code = 'STALE_AGENT_RESUME';
  constructor(message = 'Clarification response no longer matches the active question.') {
    super(message);
    this.name = 'StaleAgentResumeError';
  }
}
```

Implement maps:

```ts
const activeTurns = new Map<string, string>();
const pendingInteractions = new Map<string, PendingAgentInteraction>();
const activeTaskBySession = new Map<string, string>();
```

Expose:

```ts
export function resolveAgentThreadId(input: { sessionId: string; taskId?: string }) {
  return input.taskId ? `${input.sessionId}:${input.taskId}` : input.sessionId;
}

export function registerActiveTask(sessionId: string, taskId: string | undefined) {
  if (taskId) {
    activeTaskBySession.set(sessionId, taskId);
  }
}

export function validateActiveTask(sessionId: string, taskId: string | undefined) {
  const activeTaskId = activeTaskBySession.get(sessionId);
  if (activeTaskId && taskId && activeTaskId !== taskId) {
    throw new StaleAgentResumeError('Clarification belongs to an older task.');
  }
}

export async function withAgentThreadTurn<T>(threadId: string, turnId: string | undefined, run: () => Promise<T>) {
  if (activeTurns.has(threadId)) {
    throw new AgentThreadBusyError(threadId);
  }
  activeTurns.set(threadId, turnId ?? 'turn-unknown');
  try {
    return await run();
  } finally {
    activeTurns.delete(threadId);
  }
}
```

Add `registerPendingInteraction`, `validatePendingResume`,
`clearPendingInteraction`, `clearPendingInteractionsForSession`, and
`resetAgentThreadSessionForTests()`. `resetAgentThreadSessionForTests()` must
clear all three maps.

- [x] **Step 5: Use resolved thread id in `runLiveAgent()`**

In `server/agent/deepAgentRuntime.ts:389`, keep `sessionId`, then derive:

```ts
const threadId = resolveAgentThreadId({ sessionId, taskId: request.taskId });
```

Use `threadId` instead of `sessionId` for the synthesis `agentThreadId`.
Requirement-analysis and requirement-doc helper threads can keep their suffixes
under the same resolved thread id:

```ts
const agentThreadId = threadId;
```

- [x] **Step 6: Validate resume before building context packet**

Before `buildContextPacket()`:

```ts
if (request.requestKind === 'new_task' && request.taskId) {
  registerActiveTask(sessionId, request.taskId);
  clearPendingInteractionsForSession(sessionId);
}

if (request.requestKind === 'resume_clarification') {
  validatePendingResume({
    sessionId,
    taskId: request.taskId,
    threadId,
    interactionId: request.resumeInteractionId,
    resume: request.resume
  });
}
```

If `request.resume` is present without `requestKind === 'resume_clarification'`,
throw `StaleAgentResumeError`.

For `initial_task` and `revise_current_artifact`, call `registerActiveTask()` only
after the request has a `taskId`. Do not change active task for `general_chat`.

- [x] **Step 7: Register interaction id from LangGraph interrupt**

Change `extractInterruptPayload()` to read interrupt `id`:

```ts
const interrupt = interrupts[0] as { id?: unknown; value?: unknown };
const parsed = ClarificationRequestSchema.omit({ interactionId: true }).safeParse(interrupt.value);
if (!parsed.success) return null;
return {
  ...parsed.data,
  interactionId: typeof interrupt.id === 'string' && interrupt.id.length
    ? interrupt.id
    : createLocalInteractionId(parsed.data)
};
```

After building an awaiting-input result, register:

```ts
registerPendingInteraction({
  sessionId,
  taskId: request.taskId,
  threadId,
  interactionId: payload.interactionId,
  level: payload.level,
  optionIds: payload.options.map((option) => option.id),
  createdAtMs: Date.now()
});
```

Clear the pending interaction for normal chat/circuit completion.

- [x] **Step 8: Wrap synthesis invocation in the turn lock**

In `runLiveAgent()`, wrap the synthesis call:

```ts
return await withAgentThreadTurn(threadId, request.turnId, async () => {
  return await runAgentDraftRepairLoop(...);
});
```

Do not hold the lock around context packet construction or deterministic
preflight reads.

- [x] **Step 9: Map server errors**

In `server/agent/errorResponse.ts`, catch named errors:

```ts
if (error instanceof AgentThreadBusyError) {
  return {
    status: 409,
    body: {
      errorCode: 'AGENT_THREAD_BUSY',
      error: 'Agent thread is already processing a turn.',
      retryable: true
    }
  };
}
if (error instanceof StaleAgentResumeError) {
  return {
    status: 409,
    body: {
      errorCode: 'STALE_AGENT_RESUME',
      error: error.message,
      retryable: false
    }
  };
}
```

Add `tests/unit/agentErrorResponse.test.ts` cases that call
`mapAgentErrorToResponse(new AgentThreadBusyError('s:t'))` and
`mapAgentErrorToResponse(new StaleAgentResumeError())` and assert status `409`
plus stable `errorCode`.

- [x] **Step 10: Run server unit tests**

Run:

```powershell
npm exec tsx -- --test tests/unit/agentThreadSession.test.ts tests/unit/agentInterrupt.test.ts tests/unit/agentSchemas.test.ts tests/unit/agentErrorResponse.test.ts
npm run typecheck
```

Expected: PASS.

---

## Task 5: Pending Clarification UX And Reload Continuity

**Goal:** A clarification chip always belongs to the active task/question, including after reload.

**Files:**

- Modify: `src/main.js`
- Modify: `src/clarificationView.js`
- Modify: `src/agentSessionStore.js`
- Test: `tests/e2e/agent-trajectory.spec.js`
- Test: `tests/e2e/agent-clarification.spec.js`

- [x] **Step 1: Persist pending clarification**

Update `persistAgentSession()` in `src/main.js:98-102`:

```js
saveAgentSession(agentSessionStorage(), {
  sessionId: state.agentSessionId,
  activeTaskId: state.agentTaskId,
  pendingClarification: state.pendingClarification,
  messages: state.interview.messages
});
```

Restore `state.agentTaskId` and `state.pendingClarification` from
`loadAgentSession()` during startup.

- [x] **Step 2: Make chip lookup use pending clarification identity**

In `src/clarificationView.js`, include `interactionId` in display data. In
`selectClarificationOption(index)`, read from `state.pendingClarification`, not
from stale `state.agentResult` alone:

```js
const option = state.pendingClarification?.options?.[index];
const resume = resumeValueForOption(option);
```

- [x] **Step 3: Clear pending clarification on new task**

When `envelope.requestKind === 'new_task'`, set:

```js
state.pendingClarification = null;
```

The old chips must disappear before the new request is sent.

- [x] **Step 4: Add reload e2e test**

Add to `tests/e2e/agent-clarification.spec.js`:

```js
test('reload preserves active clarification interaction id and resumes same task', async ({ page }) => {
  const posts = [];
  await mockClarificationThenChat(page, posts, {
    sessionId: 'session-reload',
    taskId: 'task-reload',
    interactionId: 'interrupt-reload'
  });

  await page.goto('/');
  await submitMainChat(page, 'Build something simple.');
  await expect(page.getByRole('button', { name: /LED|Light/i })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: /LED|Light/i }).click();

  const resumePost = posts.find((post) => post.resume);
  expect(resumePost.taskId).toBe('task-reload');
  expect(resumePost.resumeInteractionId).toBe('interrupt-reload');
  expect(resumePost.requestKind).toBe('resume_clarification');
});
```

- [x] **Step 5: Add stale-chip e2e test**

```js
test('starting a new task clears old clarification chips', async ({ page }) => {
  await mockClarificationThenChat(page, []);
  await page.goto('/');
  await submitMainChat(page, 'Build something simple.');
  await expect(page.getByRole('button', { name: /LED|Light/i })).toBeVisible();

  await submitMainChat(page, 'Build a new OLED circuit that shows Hello.');

  await expect(page.getByRole('button', { name: /LED|Light/i })).toHaveCount(0);
});
```

- [x] **Step 6: Add stale-resume 409 UI e2e test**

Add to `tests/e2e/agent-trajectory.spec.js`:

```js
test('stale clarification resume 409 preserves visible artifact', async ({ page }) => {
  await mockAgentServer(page, [
    mockOledCircuitResult('session-stale-resume', 'task-active'),
    awaitingInputResult('session-stale-resume', 'task-active', 'interrupt-active'),
    { status: 409, body: { errorCode: 'STALE_AGENT_RESUME', error: 'Clarification belongs to an older task.', retryable: false } }
  ]);

  await page.goto('/');
  await submitMainChat(page, 'Build OLED.');
  await page.locator('[data-tab="PCB"]').click();
  await expectVisibleNonBlankStage(page);

  await submitMainChat(page, 'Ask me to choose an output.');
  await page.getByRole('button', { name: /LED|Light/i }).click();

  await expectVisibleNonBlankStage(page);
  await expect(page.locator('.message.assistant').last()).toContainText(/older task|Clarification/i);
});
```

- [x] **Step 7: Run clarification e2e**

Run:

```powershell
npm run test:e2e -- tests/e2e/agent-clarification.spec.js
npm run test:e2e -- tests/e2e/agent-trajectory.spec.js --grep "clarification"
```

Expected: PASS.

---

## Task 6: Tutor Grounding, Freshness, And Modification Routing

**Goal:** Tutor answers explain the selected target only; modification requests move to main synthesis chat.

**Files:**

- Create: `src/tutorRequestFreshness.js`
- Modify: `src/main.js`
- Modify: `src/conversationRouting.js`
- Test: `tests/unit/tutorRequestFreshness.test.js`
- Test: `tests/e2e/features.spec.js`
- Test: `tests/e2e/agent-trajectory.spec.js`

- [x] **Step 1: Add pure helper tests**

Create `tests/unit/tutorRequestFreshness.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTutorRequestKey,
  isFreshTutorResponse
} from '../../src/tutorRequestFreshness.js';

test('tutor request key captures target, artifact version, locale, and sequence', () => {
  const key = buildTutorRequestKey({
    target: { id: 'connection:sda', type: 'connection' },
    artifactVersion: 3,
    locale: 'ko',
    sequence: 7
  });

  assert.equal(key, 'connection:sda|3|ko|7');
});

test('freshness fails when target, artifact version, locale, or sequence changes', () => {
  const key = 'connection:sda|3|ko|7';
  assert.equal(isFreshTutorResponse(key, {
    target: { id: 'connection:sda', type: 'connection' },
    artifactVersion: 3,
    locale: 'ko',
    sequence: 7
  }), true);
  assert.equal(isFreshTutorResponse(key, {
    target: { id: 'connection:scl', type: 'connection' },
    artifactVersion: 3,
    locale: 'ko',
    sequence: 7
  }), false);
  assert.equal(isFreshTutorResponse(key, {
    target: { id: 'connection:sda', type: 'connection' },
    artifactVersion: 4,
    locale: 'ko',
    sequence: 7
  }), false);
  assert.equal(isFreshTutorResponse(key, {
    target: { id: 'connection:sda', type: 'connection' },
    artifactVersion: 3,
    locale: 'en',
    sequence: 7
  }), false);
  assert.equal(isFreshTutorResponse(key, {
    target: { id: 'connection:sda', type: 'connection' },
    artifactVersion: 3,
    locale: 'ko',
    sequence: 8
  }), false);
});

test('whole-circuit and selected-connection targets produce different keys', () => {
  assert.notEqual(
    buildTutorRequestKey({
      target: { id: 'target:whole-circuit', type: 'circuit' },
      artifactVersion: 1,
      locale: 'en',
      sequence: 1
    }),
    buildTutorRequestKey({
      target: { id: 'connection:sda', type: 'connection' },
      artifactVersion: 1,
      locale: 'en',
      sequence: 1
    })
  );
});
```

- [x] **Step 2: Implement `src/tutorRequestFreshness.js`**

```js
export function buildTutorRequestKey({ target, artifactVersion, locale, sequence }) {
  return [
    target?.id || 'target:none',
    Number.isFinite(artifactVersion) ? artifactVersion : 0,
    locale || 'ko',
    Number.isFinite(sequence) ? sequence : 0
  ].join('|');
}

export function isFreshTutorResponse(requestKey, current) {
  return requestKey === buildTutorRequestKey(current);
}
```

- [x] **Step 3: Fix tutor circuit source**

At `src/main.js:2254`, capture the same circuit used to describe the target:

```js
const circuit = activeDraftOrProjectCircuit() || activeCircuit();
const target = currentInspectorTarget();
```

Pass `circuit` into `askCircuitTutor()` instead of calling `activeCircuit()` again.

- [x] **Step 4: Add tutor request freshness guard**

Before awaiting `askCircuitTutor()`:

```js
state.inspector.tutorRequestSequence = (state.inspector.tutorRequestSequence || 0) + 1;
const sequence = state.inspector.tutorRequestSequence;
const requestKey = buildTutorRequestKey({
  target,
  artifactVersion: state.artifactVersion,
  locale: state.locale,
  sequence
});
```

After the await:

```js
if (!isFreshTutorResponse(requestKey, {
  target: currentInspectorTarget(),
  artifactVersion: state.artifactVersion,
  locale: state.locale,
  sequence: state.inspector.tutorRequestSequence
})) {
  return;
}
```

Clear `tutorThinking` only if the response is fresh. Target changes should clear
the thinking state for the old target in the same branch that clears messages.

- [x] **Step 5: Route tutor modification requests to main chat**

Export a conservative helper from `src/conversationRouting.js`:

```js
export function isCircuitModificationRequest(message) {
  return isRevisionRequest(message);
}
```

At the start of `submitTutorQuestion(question)`:

```js
if (isCircuitModificationRequest(question)) {
  state.inspector.chatOpen = false;
  await submitAgentMessage(question);
  return;
}
```

This keeps the tutor as explanation-only and lets the main synthesis path carry
artifact context and validation gates.

- [x] **Step 6: Add e2e assertion for draft grounding**

In `tests/e2e/features.spec.js`, extend the tutor draft scenario to assert the
server request includes the visible draft circuit:

```js
expect(tutorRequests.at(-1).artifacts.circuitSpec.components.map((component) => component.partId))
  .toContain('oled-i2c-096');
```

- [x] **Step 7: Add e2e assertion for tutor modification routing**

```js
test('tutor modification request is routed to main chat synthesis path', async ({ page }) => {
  const mainPosts = [];
  const tutorPosts = [];

  await page.goto('/');
  await loadMockOledProject(page);

  await page.route('**/api/agent/message', async (route) => {
    const body = route.request().postDataJSON();
    mainPosts.push(body);
    await route.fulfill({ json: mockChatResult(body.sessionId || 'session-mod', 'I will revise the circuit in the main chat.') });
  });
  await page.route('**/api/agent/explain-target', async (route) => {
    tutorPosts.push(route.request().postDataJSON());
    await route.fulfill({ json: liveTutorAnswer('This tutor route should not be used for modifications.') });
  });

  await page.locator('[data-tab="PCB"]').click();
  await page.locator('[data-inspect-type="connection"][data-inspect-id="oled-sda"]').click();
  await page.getByTestId('circuit-chat-toggle').click();
  await page.locator('[data-action="ask-tutor"] input').fill('Add a buzzer.');
  await page.locator('[data-action="ask-tutor"]').getByRole('button').click();

  expect(tutorPosts).toHaveLength(0);
  expect(mainPosts.at(-1).requestKind).toBe('revise_current_artifact');
  expect(mainPosts.at(-1).conversationContext.currentArtifact).toBeTruthy();
});
```

- [x] **Step 8: Add e2e assertion for artifact rebuild while tutor request is pending**

```js
test('delayed tutor answer is ignored after artifact rebuild', async ({ page }) => {
  const gate = createDeferredResponse();
  try {
    await page.goto('/');
    await loadMockOledProject(page);
    await page.route('**/api/agent/explain-target', async (route) => {
      await gate.promise;
      await route.fulfill({ json: liveTutorAnswer('Old artifact answer') });
    });
    await page.route('**/api/agent/message', async (route) => {
      const body = route.request().postDataJSON();
      await route.fulfill({ json: mockOledCircuitResult(body.sessionId || 'session-rebuilt', body.taskId, 'REBUILT') });
    });

    await page.locator('[data-tab="PCB"]').click();
    await page.locator('[data-inspect-type="connection"][data-inspect-id="oled-sda"]').click();
    await page.getByTestId('circuit-chat-toggle').click();
    await page.locator('[data-action="ask-tutor"] input').fill('What is this wire?');
    await page.locator('[data-action="ask-tutor"]').getByRole('button').click();

    await submitMainChat(page, 'Revise the current circuit.');
    await page.locator('[data-action="run"]').click();
    await expect(page.getByTestId('oled-output')).toContainText('REBUILT');
    gate.resolve();

    await expect(page.getByTestId('tutor-thread')).not.toContainText('Old artifact answer');
  } finally {
    gate.resolve();
  }
});
```

- [x] **Step 9: Run tutor tests**

Run:

```powershell
node --test tests/unit/tutorRequestFreshness.test.js
npm run test:e2e -- tests/e2e/features.spec.js --grep "tutor"
npm run test:e2e -- tests/e2e/agent-trajectory.spec.js --grep "tutor"
```

Expected: PASS.

---

## Task 7: Context Boundary Cleanup For `conversationContext`

**Goal:** Keep client-sent context as artifact/UI grounding only, not a hidden routing authority.

**Files:**

- Modify: `server/context/contextPacket.ts`
- Modify: `server/context/contextPromptRenderer.ts`
- Modify: `server/agent/deepAgentRuntime.ts`
- Test: `tests/unit/contextPacket.test.ts`
- Test: `tests/unit/contextCompaction.test.ts`

- [x] **Step 1: Add context-routing regression test**

In `tests/unit/contextPacket.test.ts`, add:

```ts
test('recentTurns alone cannot route a new independent task back to the previous artifact', async () => {
  const packet = await buildContextPacket({
    message: '새로운 OLED 회로를 만들어줘',
    locale: 'ko',
    conversationContext: {
      recentTurns: [
        { role: 'student', text: 'LED 깜빡이기' },
        { role: 'assistant', text: 'LED 회로를 만들었어요.' }
      ],
      lastSupportedGoal: 'blink an LED',
      awaitingBuildConfirmation: false
    }
  } as any);

  assert.match(packet.intentSpec.output ?? '', /oled|display/i);
  assert.doesNotMatch(packet.intentSpec.output ?? '', /led/i);
});
```

- [x] **Step 2: Extend context packet input type**

In `server/context/contextPacket.ts:54`, update `BuildContextPacketInput` so the
implementation can use the schema field without type errors:

```ts
type BuildContextPacketInput = Pick<
  AgentMessageRequest,
  'message' | 'locale' | 'conversationContext' | 'requestKind'
> & {
  forceCapabilityId?: string;
};
```

Run `npm run typecheck` after this step if implementing separately.

- [x] **Step 3: Restrict recent turns in contextual routing**

In `server/context/contextPacket.ts:1731-1779`, remove the unconditional
`Recent conversation:` line from `buildContextualRoutingMessage()`.

Keep these bounded cases:

- `pendingSupportedAlternative` for referential confirmation.
- `currentArtifact` for explicit revision.
- `lastSupportedGoal` only when request kind is `revise_current_artifact` or
  `resume_clarification`.

Use `input.requestKind` after schema changes:

```ts
const mayUseArtifactContext = input.requestKind === 'revise_current_artifact'
  || input.requestKind === 'resume_clarification';
```

- [x] **Step 4: Restrict prompt rendering of recent turns**

In `server/context/contextPromptRenderer.ts:429-455`, keep `recentTurns` out of
the JSON by default. Include only:

```ts
recentTurns: context.awaitingBuildConfirmation
  ? (context.recentTurns ?? []).slice(-2)
  : []
```

This preserves referential confirmation without making recent turns an implicit
memory source.

- [x] **Step 5: Remove client recent-turn injection from synthesis prompt**

In `server/agent/deepAgentRuntime.ts:2551-2597`,
`renderConversationContextForPrompt()` independently appends `Recent conversation`
and `foldRunningSummary(context.recentTurns, ...)`. Remove those two blocks.
If `foldRunningSummary` is no longer used in `deepAgentRuntime.ts`, remove that
import from the context compaction import list; keep the helper and its unit tests
because it may still be useful outside the synthesis prompt.
Keep only bounded artifact grounding:

```ts
const mayUseArtifactGrounding = request.requestKind === 'revise_current_artifact'
  || request.requestKind === 'resume_clarification'
  || request.requestKind === 'general_chat';
const lines = [
  'Conversation grounding:',
  mayUseArtifactGrounding && context.lastSupportedGoal
    ? `- Last supported goal: ${context.lastSupportedGoal}`
    : '',
  `- Awaiting build confirmation: ${context.awaitingBuildConfirmation ? 'yes' : 'no'}`,
  artifact ? `- Current artifact: ${artifact.title} (${artifact.source})` : '',
  artifact?.circuitSpec?.intent?.primaryGoal ? `- Current artifact goal: ${artifact.circuitSpec.intent.primaryGoal}` : '',
  artifact?.circuitSpec?.components?.length ? `- Current artifact parts: ${artifact.circuitSpec.components.map((component) => component.partId).join(', ')}` : '',
  artifact?.validationReport?.status ? `- validationStatus=${artifact.validationReport.status}` : '',
  artifact?.simulationPlan?.status ? `- simulationStatus=${artifact.simulationPlan.status}` : ''
].filter(Boolean);
```

Add a focused unit assertion in `tests/unit/reactSystemPrompt.test.ts` or
`tests/unit/contextCompaction.test.ts` that a request with client
`conversationContext.recentTurns` does not put `"Recent conversation"` or
`"EARLIER CONTEXT"` into the synthesis prompt. Keep this test stubbed; do not
use live OpenAI calls.

- [x] **Step 6: Run context tests**

Run:

```powershell
npm exec tsx -- --test tests/unit/contextPacket.test.ts tests/unit/contextCompaction.test.ts
npm exec tsx -- --test tests/unit/reactSystemPrompt.test.ts
npm run context:acceptance
npm run typecheck
```

Expected: PASS.

---

## Task 8: Documentation And Acceptance Gate

**Goal:** Keep living workflow docs consistent with the new turn envelope and tutor freshness contract.

**Files:**

- Modify: `docs/agent-request-to-simulation-workflow.md`
- Modify: `docs/agent-tutor-serving-workflow.md`
- Modify: `docs/README.md`
- Test: default acceptance commands

- [x] **Step 1: Update main workflow doc**

In `docs/agent-request-to-simulation-workflow.md`, add:

```markdown
## Turn Envelope Invariants

- `sessionId` identifies the browser conversation.
- `taskId` identifies the active design task.
- The synthesis LangGraph `thread_id` is `sessionId:taskId` when `taskId` is present.
- New independent tasks get a new `taskId`; revisions and clarification resumes keep the current `taskId`.
- `turnId` lets the client ignore stale async responses.
- `resumeInteractionId` must match the currently pending clarification interaction before the server invokes `Command({ resume })`.
- Chat/error/awaiting-input turns do not clear the visible circuit artifact.
```

- [x] **Step 2: Update tutor workflow doc**

In `docs/agent-tutor-serving-workflow.md`, add:

```markdown
## Freshness Invariants

- Tutor requests are keyed by selected target id, artifact version, locale, and request sequence.
- A delayed tutor response is ignored if the target or artifact version changed.
- Tutor questions use the same draft-or-project circuit used to describe the selected target.
- Modification-shaped tutor text is routed to the main synthesis chat; tutor mode remains selected-target explanation.
```

- [x] **Step 3: Update docs index**

Add this plan under `docs/README.md` active plans:

```markdown
- [`plans/PLAN_agent_trajectory_robustness.md`](plans/PLAN_agent_trajectory_robustness.md) -
  main chat and tutor chat trajectory robustness plan: task/thread identity,
  artifact preservation, stale response guards, clarification identity, and
  tutor freshness.
```

- [x] **Step 4: Run focused verification**

Run:

```powershell
node --test tests/unit/agentTurnEnvelope.test.js tests/unit/agentSessionStore.test.js tests/unit/aiClient.test.js tests/unit/tutorRequestFreshness.test.js tests/unit/conversationRouting.test.js
npm exec tsx -- --test tests/unit/agentThreadSession.test.ts tests/unit/agentInterrupt.test.ts tests/unit/agentSchemas.test.ts tests/unit/agentErrorResponse.test.ts tests/unit/contextPacket.test.ts tests/unit/contextCompaction.test.ts tests/unit/reactSystemPrompt.test.ts
npm run typecheck
npm run build
npm run test:e2e -- tests/e2e/agent-trajectory.spec.js
```

Expected: all pass.

- [x] **Step 5: Run full acceptance**

Run:

```powershell
npm install
npm test
npm run build
npm run test:e2e
npm run check
```

Expected: all pass without live OpenAI credentials. Live smoke remains opt-in
through `npm run check:live`.

---

## Rollout Order

1. Add RED tests for main chat artifact preservation, stale turn response,
   clarification identity, and tutor target freshness.
2. Add client turn envelope and session persistence.
3. Make main chat artifact updates non-destructive and stale guarded.
4. Add server thread identity, turn locks, and pending interaction validation.
5. Persist/reload pending clarification metadata.
6. Fix tutor circuit grounding, target freshness, and modification routing.
7. Tighten `conversationContext` routing usage.
8. Update living docs and run full acceptance.

## Risks And Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Splitting `thread_id` by task loses useful cross-task context | Medium | Keep `sessionId` in request metadata/logs, but use `taskId` for design-task memory isolation. Cross-task memory can be added with LangGraph `Store` after product evidence. |
| Client abort does not stop server work | Medium | Stale client result is ignored; new tasks use a different `thread_id`; same-thread concurrent invokes return 409. |
| Pending interaction map is in-process | Medium | Matches current `MemorySaver` durability. Durable saver rollout should move pending metadata to the same durable session/checkpoint backing. |
| Request kind misclassification routes a revision as new task | High | Keep conservative revision regex, preserve `conversationContext.currentArtifact`, and add e2e tests for add/change/replace in Korean and English. |
| Tutor freshness guard hides a valid answer after artifact rebuild | Low | Correct behavior: answer belonged to the older artifact version. Student can ask again on the new target. |
| Removing recent turns from context routing regresses referential confirmations | Medium | Keep explicit pending alternative and awaiting-confirmation paths; cover with context packet and e2e clarification tests. |

## Rigorous Review Incorporation

Two read-only subagent reviews were run against this plan before finalizing it.
The plan was updated to address these findings:

- Added session-level active task tracking so a duplicated tab cannot resume an
  older task's paused LangGraph checkpoint after the same `sessionId` starts a
  newer task.
- Added `server/agent/deepAgentRuntime.ts` to the context cleanup scope because
  it independently injected `Recent conversation` and `foldRunningSummary(...)`
  into the synthesis prompt.
- Added a real `general-chat` classifier path; the existing
  `current-artifact-question` path is local tutor QA and does not exercise the
  main agent server.
- Updated context packet input typing to include `requestKind` before Task 7 uses
  it.
- Made abort handling explicit: caller aborts and timeout aborts must be composed
  and distinguished.
- Replaced non-existent e2e selectors/helpers with repo-consistent selectors:
  `stage-canvas`, `data-render-ready`, `oled-output`, `loadMockOledProject()`,
  and canvas screenshot pixel checks.
- Added API-boundary coverage for `AGENT_THREAD_BUSY` and `STALE_AGENT_RESUME`
  through `server/agent/errorResponse.ts`.

## Self-Review

- Spec coverage: The plan covers both Chat UI workflows, arbitrary trajectory
  switching, clarification/resume, current artifact preservation, server failures,
  stale async responses, tutor target switching, and modification routing.
- Framework compliance: Memory remains LangGraph checkpointer plus `thread_id`;
  clarification remains `interrupt()` plus `Command({ resume })`; task identity
  only changes the chosen `thread_id`.
- Test coverage: Each behavioral risk has a RED test before implementation and a
  focused command. The final gate remains `npm run check`.
- Placeholder scan: This plan contains concrete file paths, request fields,
  helper names, tests, commands, and expected outcomes.

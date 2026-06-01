# Conversation State, Artifact Grounding, and LED Validator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix follow-up chat failures by preserving conversation/current circuit artifacts across turns, routing natural confirmations and circuit questions correctly, hiding raw agent errors, and rejecting incomplete LED/resistor series circuits.

**Architecture:** Add a deterministic frontend turn router before the synthesis agent. The router decides whether a student message is a new design request, a natural confirmation of the current draft, a current-artifact question, or a revision request. Server-side Deepagents calls receive concise conversation and artifact context for true synthesis/revision turns, while current-circuit questions are answered by the grounded tutor path. The validator becomes the final authority for LED closed series paths before render/current simulation can be marked valid.

**Tech Stack:** Vanilla JavaScript + Vite frontend, Node TypeScript server, Zod schemas, Deepagents live runtime, deterministic circuit tools, `node:test`, Playwright E2E.

---

## 1. Problem Statement

The observed transcript exposes a structural product failure:

```text
학생: 새로운 회로를 구축하고 싶은데
AI: 어떤 기능의 회로를 만들고 싶은지 아직 정해지지 않아...
학생: ① LED 깜빡이기,
AI: 가능합니다. Arduino Uno의 D8...
학생: 좋아 구현 부탁해
AI: 구현할 회로의 입력/출력이 아직 정해지지 않았어요...
학생: LED 깜빡이기
AI: 검증 가능한 LED 깜빡이기 회로 초안입니다...
학생: 전선 연결이 안되도 상관없니?
AI: ...다만 어떤 회로를 만들려는지 아직 정해지지 않았기 때문에...
학생: 너가 만들어준 아래 요구사항의 회로 시뮬레이션에는 전선이 없는데...
AI: Deepagents 실행 중 오류가 발생했습니다: Deepagents did not return a structured circuit draft.
```

This is not primarily a copywriting issue. The app loses the prior circuit draft, misroutes natural follow-ups, and allows the validator/simulation layer to overclaim.

## 2. Current Root Causes

### 2.1 Conversation Memory Gap

Current server context input:

- `server/context/contextPacket.ts`
  - `BuildContextPacketInput = Pick<AgentMessageRequest, 'message' | 'locale'>`
  - `buildContextPacket()` routes only from the current message.
- `server/agent/deepAgentRuntime.ts`
  - `buildUserPrompt()` includes `Student message: ${request.message}` and optional `confirmation`.
  - It does not include recent chat turns, last valid draft, active `CircuitSpec`, active `RenderPlan`, or active `SimulationPlan`.

Result:

- `좋아 구현 부탁해` becomes ambiguous because it has no hardware terms.
- `전선 연결이 안되도 상관없니?` becomes ambiguous because it is evaluated as a standalone new circuit request.

### 2.2 Natural Confirmation Is Not Treated As Confirmation

Current frontend behavior:

- `src/main.js`
  - Confirm button uses `data-action="confirm"` and builds from `state.agentResult`.
  - Chat submit always calls `submitAgentMessage(input)`.
  - `submitAgentMessage()` clears `state.agentResult`, `state.projectLoaded`, and `state.awaitingConfirmation` before calling the server.

Result:

- Student says `좋아 구현 부탁해`.
- App discards the valid LED draft and sends a new ambiguous synthesis request.

### 2.3 Current Circuit Questions Go To Synthesis Agent

Current routes:

- General left chat calls `/api/agent/message`.
- Simulation right chat calls `/api/agent/explain-target`.

Problem:

- A student can ask about the current draft in the general chat.
- Example: `전선 연결이 안되도 상관없니?`
- This question should be grounded in the current artifact, not routed to circuit synthesis.

### 2.4 LED Validator Accepts Incomplete Series Paths

Current validator behavior in `server/agent/circuitTools.ts`:

- Checks whether an LED component exists.
- Checks whether a resistor component exists.
- Checks whether active loads have a ground return.
- Does not prove the path `controller digital output -> resistor -> LED anode -> LED cathode -> controller ground`.

Concrete failing case:

```ts
const badLedSpec = {
  id: 'bad-led',
  title: 'Bad LED',
  intent: { primaryGoal: 'blink LED', output: 'led', controller: 'arduino-uno' },
  components: [
    { id: 'arduino-uno', partId: 'arduino-uno', label: 'Arduino Uno' },
    { id: 'led-1', partId: 'led-5mm', label: 'LED' },
    { id: 'r1', partId: 'resistor-220', label: '220 ohm resistor' }
  ],
  connections: [
    {
      id: 'led-ground',
      from: { componentId: 'led-1', pin: 'K' },
      to: { componentId: 'arduino-uno', pin: 'GND' },
      signal: 'ground'
    }
  ],
  behavior: { runText: 'LED BLINK' },
  assumptions: [],
  unsupportedItems: [],
  clarificationNeeds: []
};
```

This can be marked valid even though the positive side is not wired. Current path estimation can then fall back to a synthetic Arduino pin such as `arduino-uno:D9`.

### 2.5 Raw Agent Error Leaks To Students

Current server behavior:

- `server/agent/deepAgentRuntime.ts`
  - `extractDraft()` throws `Deepagents did not return a structured circuit draft.`
- `server/index.ts`
  - returns `{ error: message }` to the frontend.
- `src/main.js`
  - `agentErrorMessage()` displays the raw error text.

Result:

- Student sees implementation detail instead of a recoverable, artifact-grounded response.

## 3. Scope

### In Scope

- Preserve concise conversation context across agent turns.
- Preserve and pass current artifact context when useful.
- Route natural confirmation phrases to the existing confirm/build path.
- Route current-circuit questions to grounded tutor logic.
- Add friendly recovery for missing structured Deepagents output.
- Strengthen LED/resistor closed-series validation.
- Add unit and E2E tests based on the failing transcript.
- Update coworking handoff after implementation.

### Out Of Scope

- Replacing Vanilla JS state management with a frontend framework.
- Adding a general SPICE simulator.
- Making unsupported/planned hardware families supported.
- Implementing a persistent backend database.
- Solving every possible multi-turn planning case. This plan covers the current draft/artifact continuity needed for stable educational circuit generation.

## 4. File Structure

### Frontend Files

- `src/conversationRouting.js`
  - New deterministic classifier for student chat turns.
  - Exports `classifyStudentTurn(message, context)`.
  - Exports helpers for natural confirmation and artifact-question detection.

- `src/agentErrorMessages.js`
  - New safe client-side error mapper.
  - Exports `agentErrorMessage(error, locale)`.
  - Keeps raw Deepagents/structured-output errors out of student-facing UI.

- `src/main.js`
  - Imports the classifier and error mapper.
  - Extracts confirm button logic into `confirmCurrentAgentResult()`.
  - Routes general chat:
    - confirmation -> build current draft
    - artifact question -> grounded tutor answer in left chat
    - synthesis/revision -> `/api/agent/message`
  - Builds concise `conversationContext` for agent calls.

- `src/aiClient.js`
  - Extends `sendAgentMessage()` to include `conversationContext`.

### Server Files

- `server/agent/schemas.ts`
  - Adds `ConversationTurnSchema`.
  - Adds `AgentArtifactSnapshotSchema`.
  - Adds `AgentConversationContextSchema`.
  - Extends `AgentMessageRequestSchema`.
  - Adds structured error response schema if needed.

- `server/context/contextPacket.ts`
  - Accepts `conversationContext`.
  - Uses a contextual routing message for capability matching while preserving the raw student message.
  - Adds trace evidence when context comes from the current artifact.

- `server/agent/deepAgentRuntime.ts`
  - Adds `AgentStructuredOutputError`.
  - Includes recent turns and artifact summary in `buildUserPrompt()`.
  - Converts missing structured response into a typed error.

- `server/index.ts`
  - Maps `AgentStructuredOutputError` to a safe JSON response:
    - `errorCode: "AGENT_STRUCTURED_OUTPUT_MISSING"`
    - safe localized `error`
    - `retryable: true`

- `server/agent/circuitTools.ts`
  - Adds closed-series LED validation.
  - Blocks current-path fallback from producing validated LED current for incomplete wiring.

### Test Files

- `tests/unit/conversationRouting.test.js`
  - New frontend classifier tests.

- `tests/unit/agentErrorMessages.test.js`
  - New safe error mapping tests.

- `tests/unit/agentSchemas.test.ts`
  - Adds schema parse/fail coverage for `conversationContext`.

- `tests/unit/contextPacket.test.ts` or `tests/unit/contextRouting.test.ts`
  - Adds follow-up routing coverage using prior artifact context.

- `tests/unit/agentWorkflow.test.ts`
  - Adds LED closed-series validator failures and current-path no-fallback assertions.
  - Adds typed structured-output error test.

- `tests/e2e/features.spec.js`
  - Adds the failing transcript flow:
    - LED draft
    - natural confirmation
    - current circuit question
    - no raw error leakage
    - visible wires/rendered connections after build

### Documentation Files

- `docs/coworking_handoff_2026-05-31.md`
  - Add implementation status after execution.

## 5. New Data Contracts

### 5.1 Conversation Context Shape

Add this contract to `server/agent/schemas.ts`:

```ts
export const ConversationTurnSchema = z.object({
  role: z.enum(['student', 'assistant']),
  text: z.string().min(1).max(2000)
});

export const AgentArtifactSnapshotSchema = z.object({
  source: z.enum(['draft', 'built-project']),
  title: z.string().min(1),
  requirementMarkdown: z.string().max(12000).optional(),
  circuitSpec: CircuitSpecSchema.optional(),
  validationReport: ValidationReportSchema.optional(),
  renderPlan: RenderPlanSchema.optional(),
  simulationPlan: SimulationPlanSchema.optional()
});

export const AgentConversationContextSchema = z.object({
  recentTurns: z.array(ConversationTurnSchema).max(12).default([]),
  currentArtifact: AgentArtifactSnapshotSchema.optional(),
  lastSupportedGoal: z.string().max(500).optional(),
  awaitingBuildConfirmation: z.boolean().default(false)
});
```

Then extend `AgentMessageRequestSchema`:

```ts
export const AgentMessageRequestSchema = z.object({
  sessionId: z.string().optional(),
  message: z.string().min(1),
  confirmation: z.string().optional(),
  mode: z.literal('live').optional(),
  locale: z.enum(['ko', 'en']).default('ko'),
  conversationContext: AgentConversationContextSchema.optional()
});
```

### 5.2 Client Conversation Context Shape

The frontend should send only bounded state:

```js
function buildConversationContext() {
  const currentArtifact = state.agentResult
    ? artifactSnapshotFromAgentResult(state.agentResult, 'draft')
    : state.projectLoaded
      ? artifactSnapshotFromProject(state.project, 'built-project')
      : undefined;

  return {
    recentTurns: state.interview.messages.slice(-12).map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'student',
      text: message.text
    })),
    currentArtifact,
    lastSupportedGoal: state.agentResult?.circuitSpec?.intent?.primaryGoal
      || state.project?.circuit?.circuitSpec?.intent?.primaryGoal
      || state.interview.idea
      || undefined,
    awaitingBuildConfirmation: Boolean(state.awaitingConfirmation && state.agentResult)
  };
}
```

## 6. Routing Rules

### 6.1 Turn Classification

Create `src/conversationRouting.js` with this behavior:

```js
export function classifyStudentTurn(message, context = {}) {
  const text = normalizeTurnText(message);
  const hasBuildableDraft = Boolean(context.hasBuildableDraft);
  const hasCurrentArtifact = Boolean(context.hasCurrentArtifact);

  if (hasBuildableDraft && isNaturalConfirmation(text)) {
    return { route: 'confirm-current-draft', reason: 'natural-confirmation' };
  }

  if (hasCurrentArtifact && isCurrentArtifactQuestion(text)) {
    return { route: 'current-artifact-question', reason: 'artifact-grounded-question' };
  }

  if (hasCurrentArtifact && isRevisionRequest(text)) {
    return { route: 'revise-current-draft', reason: 'artifact-revision' };
  }

  return { route: 'synthesize-or-clarify', reason: 'new-or-ambiguous-design' };
}

export function normalizeTurnText(message) {
  return String(message || '')
    .trim()
    .toLowerCase()
    .replace(/[.,!?，。！？]+$/g, '');
}

export function isNaturalConfirmation(text) {
  return /^(좋아|네|응|ㅇㅇ|확인|만들어줘|구현해줘|구현 부탁|진행|빌드|build it|go ahead|yes|ok|okay|confirm)/i.test(text)
    || /(좋아.*(구현|만들|진행)|그걸로.*(만들|진행)|확인하고.*(만들|진행))/i.test(text);
}

export function isCurrentArtifactQuestion(text) {
  const questionSignals = /(괜찮|상관없|왜|어떻게|무슨|뭐가|빠지|없|연결|전선|선|wire|connection|missing|without|current|전류|시뮬레이션|simulation)/i;
  const designRequestSignals = /(만들어줘|구축|새로운|추가해줘|바꿔줘|replace|add|change|make|build)/i;
  return questionSignals.test(text) && !designRequestSignals.test(text);
}

export function isRevisionRequest(text) {
  return /(추가해줘|바꿔줘|수정해줘|대신|으로 바꿔|add|change|replace|modify)/i.test(text);
}
```

### 6.2 Route Behavior In `src/main.js`

Inside `submitAgentMessage(message)`:

```js
const turnRoute = classifyStudentTurn(message, {
  hasBuildableDraft: canBuildAgentResult(state.agentResult),
  hasCurrentArtifact: Boolean(state.agentResult || state.projectLoaded)
});

if (turnRoute.route === 'confirm-current-draft') {
  appendStudentMessage(message);
  appendAssistantMessage(
    state.locale === 'ko'
      ? '좋아요. 방금 검증한 회로 초안으로 구성해 볼게요.'
      : 'Okay. I will build the validated circuit draft.'
  );
  confirmCurrentAgentResult();
  return;
}

if (turnRoute.route === 'current-artifact-question') {
  await answerCurrentArtifactQuestion(message);
  return;
}
```

Then preserve the existing `/api/agent/message` path for `synthesize-or-clarify` and `revise-current-draft`.

## 7. Implementation Tasks

### Task 1: Add RED Tests For Frontend Turn Classification

**Files:**

- Create: `tests/unit/conversationRouting.test.js`
- Create: `src/conversationRouting.js`

- [ ] **Step 1: Create a failing classifier test file**

Create `tests/unit/conversationRouting.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyStudentTurn,
  isCurrentArtifactQuestion,
  isNaturalConfirmation,
  isRevisionRequest
} from '../../src/conversationRouting.js';

test('natural Korean confirmation routes to current draft build when a buildable draft exists', () => {
  assert.equal(isNaturalConfirmation('좋아 구현 부탁해'), true);
  assert.deepEqual(
    classifyStudentTurn('좋아 구현 부탁해', {
      hasBuildableDraft: true,
      hasCurrentArtifact: true
    }),
    { route: 'confirm-current-draft', reason: 'natural-confirmation' }
  );
});

test('current circuit wiring questions route to artifact-grounded QA', () => {
  assert.equal(isCurrentArtifactQuestion('전선 연결이 안되도 상관없니?'), true);
  assert.deepEqual(
    classifyStudentTurn('전선 연결이 안되도 상관없니?', {
      hasBuildableDraft: true,
      hasCurrentArtifact: true
    }),
    { route: 'current-artifact-question', reason: 'artifact-grounded-question' }
  );
});

test('revision requests remain synthesis or revision work, not tutor QA', () => {
  assert.equal(isRevisionRequest('LED 옆에 버튼도 추가해줘'), true);
  assert.deepEqual(
    classifyStudentTurn('LED 옆에 버튼도 추가해줘', {
      hasBuildableDraft: true,
      hasCurrentArtifact: true
    }),
    { route: 'revise-current-draft', reason: 'artifact-revision' }
  );
});

test('ambiguous first turn stays on synthesize-or-clarify route', () => {
  assert.deepEqual(
    classifyStudentTurn('새로운 회로를 구축하고 싶은데', {
      hasBuildableDraft: false,
      hasCurrentArtifact: false
    }),
    { route: 'synthesize-or-clarify', reason: 'new-or-ambiguous-design' }
  );
});
```

- [ ] **Step 2: Add the initial module shell**

Create `src/conversationRouting.js`:

```js
export function classifyStudentTurn() {
  return { route: 'synthesize-or-clarify', reason: 'new-or-ambiguous-design' };
}

export function isNaturalConfirmation() {
  return false;
}

export function isCurrentArtifactQuestion() {
  return false;
}

export function isRevisionRequest() {
  return false;
}
```

- [ ] **Step 3: Run the test and verify RED**

Run:

```powershell
node --test tests/unit/conversationRouting.test.js
```

Expected:

```text
not ok ... natural Korean confirmation routes...
```

- [ ] **Step 4: Implement the classifier**

Replace `src/conversationRouting.js` with:

```js
export function classifyStudentTurn(message, context = {}) {
  const text = normalizeTurnText(message);
  const hasBuildableDraft = Boolean(context.hasBuildableDraft);
  const hasCurrentArtifact = Boolean(context.hasCurrentArtifact);

  if (hasBuildableDraft && isNaturalConfirmation(text)) {
    return { route: 'confirm-current-draft', reason: 'natural-confirmation' };
  }

  if (hasCurrentArtifact && isCurrentArtifactQuestion(text)) {
    return { route: 'current-artifact-question', reason: 'artifact-grounded-question' };
  }

  if (hasCurrentArtifact && isRevisionRequest(text)) {
    return { route: 'revise-current-draft', reason: 'artifact-revision' };
  }

  return { route: 'synthesize-or-clarify', reason: 'new-or-ambiguous-design' };
}

export function normalizeTurnText(message) {
  return String(message || '')
    .trim()
    .toLowerCase()
    .replace(/[.,!?，。！？]+$/g, '');
}

export function isNaturalConfirmation(text) {
  return /^(좋아|네|응|ㅇㅇ|확인|만들어줘|구현해줘|구현 부탁|진행|빌드|build it|go ahead|yes|ok|okay|confirm)/i.test(text)
    || /(좋아.*(구현|만들|진행)|그걸로.*(만들|진행)|확인하고.*(만들|진행))/i.test(text);
}

export function isCurrentArtifactQuestion(text) {
  const questionSignals = /(괜찮|상관없|왜|어떻게|무슨|뭐가|빠지|없|연결|전선|선|wire|connection|missing|without|current|전류|시뮬레이션|simulation)/i;
  const designRequestSignals = /(만들어줘|구축|새로운|추가해줘|바꿔줘|replace|add|change|make|build)/i;
  return questionSignals.test(text) && !designRequestSignals.test(text);
}

export function isRevisionRequest(text) {
  return /(추가해줘|바꿔줘|수정해줘|대신|으로 바꿔|add|change|replace|modify)/i.test(text);
}
```

- [ ] **Step 5: Run the test and verify GREEN**

Run:

```powershell
node --test tests/unit/conversationRouting.test.js
```

Expected:

```text
# pass 4
```

## 8. Task 2: Extract Safe Agent Error Mapping

**Files:**

- Create: `src/agentErrorMessages.js`
- Create: `tests/unit/agentErrorMessages.test.js`
- Modify: `src/main.js`

- [ ] **Step 1: Write RED tests for raw error hiding**

Create `tests/unit/agentErrorMessages.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { agentErrorMessage } from '../../src/agentErrorMessages.js';

test('structured Deepagents output errors are converted to a Korean recovery message', () => {
  const message = agentErrorMessage(
    new Error('Deepagents did not return a structured circuit draft.'),
    'ko'
  );

  assert.match(message, /회로 초안|다시 확인|현재 회로/);
  assert.doesNotMatch(message, /structured circuit draft/i);
  assert.doesNotMatch(message, /Deepagents did not return/i);
});

test('server configuration errors still explain missing setup without exposing secrets', () => {
  const message = agentErrorMessage(
    new Error('Deepagents live mode requires OPENAI_API_KEY and H_EDUWARE_AGENT_MODEL on the server process.'),
    'en'
  );

  assert.match(message, /server is not configured/i);
  assert.doesNotMatch(message, /sk-/i);
});
```

- [ ] **Step 2: Create module with current behavior copied from `src/main.js`**

Create `src/agentErrorMessages.js`:

```js
export function agentErrorMessage(error, locale = 'ko') {
  const raw = error instanceof Error ? error.message : String(error);

  if (/structured circuit draft|AGENT_STRUCTURED_OUTPUT_MISSING/i.test(raw)) {
    return locale === 'ko'
      ? '현재 회로 초안을 구조화해 확인하지 못했습니다. 방금 만든 회로 기준으로 다시 질문하거나, 회로를 한 번 더 요청해 주세요.'
      : 'I could not verify a structured circuit draft. Ask again against the current circuit, or request the circuit one more time.';
  }

  if (/OPENAI_API_KEY|H_EDUWARE_AGENT_MODEL|configured|configuration/i.test(raw)) {
    return locale === 'ko'
      ? '실제 Deepagents 서버 설정이 필요합니다. 서버에 필요한 모델과 API 키가 설정되어 있는지 확인해 주세요.'
      : 'The live Deepagents server is not configured. Set the required model and API key on the server process, then send again.';
  }

  if (/Failed to fetch|offline|timed out|timeout/i.test(raw)) {
    return locale === 'ko'
      ? 'Deepagents 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해 주세요.'
      : 'I cannot reach the Deepagents server. Check that the agent server is running.';
  }

  return locale === 'ko'
    ? `회로 생성 중 오류가 발생했습니다. 현재 회로 상태를 유지한 채 다시 시도해 주세요.`
    : `The circuit agent failed. The current circuit state was kept so you can try again.`;
}
```

- [ ] **Step 3: Update `src/main.js` import and remove local duplicate**

Modify imports:

```js
import { agentErrorMessage } from './agentErrorMessages.js';
```

Remove the local `function agentErrorMessage(error) { ... }` from `src/main.js`.

Update catch usage:

```js
const messageText = agentErrorMessage(error, state.locale);
```

- [ ] **Step 4: Run tests**

Run:

```powershell
node --test tests/unit/agentErrorMessages.test.js
node --check src/main.js
```

Expected:

```text
# pass 2
```

## 9. Task 3: Add Agent Conversation Context Schemas

**Files:**

- Modify: `server/agent/schemas.ts`
- Modify: `tests/unit/agentSchemas.test.ts`

- [ ] **Step 1: Add RED schema tests**

Append to `tests/unit/agentSchemas.test.ts`:

```ts
import { AgentMessageRequestSchema } from '../../server/agent/schemas.ts';

test('agent message request accepts bounded conversation and current artifact context', () => {
  const parsed = AgentMessageRequestSchema.parse({
    sessionId: 'session-led',
    message: '전선 연결이 안되도 상관없니?',
    locale: 'ko',
    conversationContext: {
      awaitingBuildConfirmation: true,
      lastSupportedGoal: 'LED 깜빡이기',
      recentTurns: [
        { role: 'student', text: 'LED 깜빡이기' },
        { role: 'assistant', text: '검증 가능한 LED 회로 초안입니다.' }
      ],
      currentArtifact: {
        source: 'draft',
        title: 'LED blinker'
      }
    }
  });

  assert.equal(parsed.conversationContext?.currentArtifact?.title, 'LED blinker');
});

test('agent message request limits recent conversation turns', () => {
  assert.throws(() => AgentMessageRequestSchema.parse({
    message: 'continue',
    locale: 'en',
    conversationContext: {
      recentTurns: Array.from({ length: 13 }, (_, index) => ({
        role: index % 2 === 0 ? 'student' : 'assistant',
        text: `turn ${index}`
      }))
    }
  }), /Too big|Array must contain at most|at most 12/i);
});
```

- [ ] **Step 2: Implement schemas in `server/agent/schemas.ts`**

Add after `AgentEventSchema`:

```ts
export const ConversationTurnSchema = z.object({
  role: z.enum(['student', 'assistant']),
  text: z.string().min(1).max(2000)
});

export const AgentArtifactSnapshotSchema = z.object({
  source: z.enum(['draft', 'built-project']),
  title: z.string().min(1),
  requirementMarkdown: z.string().max(12000).optional(),
  circuitSpec: CircuitSpecSchema.optional(),
  validationReport: ValidationReportSchema.optional(),
  renderPlan: RenderPlanSchema.optional(),
  simulationPlan: SimulationPlanSchema.optional()
});

export const AgentConversationContextSchema = z.object({
  recentTurns: z.array(ConversationTurnSchema).max(12).default([]),
  currentArtifact: AgentArtifactSnapshotSchema.optional(),
  lastSupportedGoal: z.string().max(500).optional(),
  awaitingBuildConfirmation: z.boolean().default(false)
});
```

Extend `AgentMessageRequestSchema`:

```ts
export const AgentMessageRequestSchema = z.object({
  sessionId: z.string().optional(),
  message: z.string().min(1),
  confirmation: z.string().optional(),
  mode: z.literal('live').optional(),
  locale: z.enum(['ko', 'en']).default('ko'),
  conversationContext: AgentConversationContextSchema.optional()
});
```

Add exports:

```ts
export type AgentConversationContext = z.infer<typeof AgentConversationContextSchema>;
export type AgentArtifactSnapshot = z.infer<typeof AgentArtifactSnapshotSchema>;
```

- [ ] **Step 3: Run schema tests**

Run:

```powershell
tsx --test tests/unit/agentSchemas.test.ts
```

Expected:

```text
# pass
```

## 10. Task 4: Send Conversation Context From Frontend

**Files:**

- Modify: `src/aiClient.js`
- Modify: `src/main.js`
- Add tests to existing E2E or unit where practical.

- [ ] **Step 1: Extend API client**

Modify `src/aiClient.js`:

```js
export async function sendAgentMessage({ sessionId, message, confirmation, locale, conversationContext }) {
  const health = await getAgentHealth();
  if (!health.ok) {
    throw new AgentApiError(
      `Deepagents live server is not configured. Missing: ${(health.requiredEnv || []).join(', ') || 'server configuration'}`
    );
  }

  const body = {
    message,
    locale,
    mode: 'live'
  };
  if (sessionId) body.sessionId = sessionId;
  if (confirmation) body.confirmation = confirmation;
  if (conversationContext) body.conversationContext = conversationContext;

  return fetchJson('/api/agent/message', {
    method: 'POST',
    body,
    timeoutMs: 90000
  });
}
```

- [ ] **Step 2: Add artifact snapshot helpers in `src/main.js`**

Add:

```js
function buildConversationContext() {
  const currentArtifact = state.agentResult
    ? artifactSnapshotFromAgentResult(state.agentResult, 'draft')
    : state.projectLoaded
      ? artifactSnapshotFromProject(state.project, 'built-project')
      : undefined;

  return {
    recentTurns: state.interview.messages.slice(-12).map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'student',
      text: message.text
    })),
    currentArtifact,
    lastSupportedGoal: state.agentResult?.circuitSpec?.intent?.primaryGoal
      || state.project?.circuit?.circuitSpec?.intent?.primaryGoal
      || state.interview.idea
      || undefined,
    awaitingBuildConfirmation: Boolean(state.awaitingConfirmation && state.agentResult)
  };
}

function artifactSnapshotFromAgentResult(result, source) {
  return {
    source,
    title: result.renderPlan?.title || result.circuitSpec?.title || 'Current circuit draft',
    requirementMarkdown: result.requirementMarkdown,
    circuitSpec: result.circuitSpec,
    validationReport: result.validationReport,
    renderPlan: result.renderPlan,
    simulationPlan: result.simulationPlan
  };
}

function artifactSnapshotFromProject(project, source) {
  const circuit = project.circuit;
  return {
    source,
    title: circuit.title,
    requirementMarkdown: project.files.find((file) => file.kind === 'Markdown')?.markdown,
    circuitSpec: circuit.circuitSpec,
    validationReport: circuit.validationReport,
    renderPlan: {
      title: circuit.title,
      runText: circuit.runText,
      parts: circuit.parts || [],
      connections: circuit.connections || [],
      floatingCards: circuit.floatingCards || [],
      warnings: circuit.renderWarnings || [],
      layout: circuit.layout
    },
    simulationPlan: circuit.simulationPlan
  };
}
```

- [ ] **Step 3: Pass context to `sendAgentMessage()`**

Change:

```js
sendAgentMessage({
  sessionId: state.agentSessionId,
  message,
  locale: state.locale
})
```

To:

```js
sendAgentMessage({
  sessionId: state.agentSessionId,
  message,
  locale: state.locale,
  conversationContext: buildConversationContext()
})
```

- [ ] **Step 4: Run checks**

Run:

```powershell
node --check src/main.js
npm exec -- playwright test tests/e2e/features.spec.js -g "AI chat uses the Deepagents API path"
```

Expected:

```text
passed
```

## 11. Task 5: Route Natural Confirmation Without Clearing Draft

**Files:**

- Modify: `src/main.js`
- Modify: `tests/e2e/features.spec.js`

- [ ] **Step 1: Extract confirm handler**

Replace the inline confirm click handler body with:

```js
app.querySelector('[data-action="confirm"]')?.addEventListener('click', confirmCurrentAgentResult);
```

Add:

```js
function confirmCurrentAgentResult() {
  if (state.agentResult && canBuildAgentResult(state.agentResult)) {
    state.project = createProjectFromAgentResult(state.agentResult);
    state.selectedFileId = state.project.files[0].id;
  } else {
    state.interview = demoInterviewState(state.locale);
    state.project = createLocalizedProject(state.locale);
    state.selectedFileId = 'demo-requirements';
  }
  state.awaitingConfirmation = false;
  cancelThinking();
  render();
  startBuildSequence();
}
```

- [ ] **Step 2: Add helper message appenders**

Add:

```js
function appendStudentMessage(text) {
  state.interview = {
    ...state.interview,
    status: state.interview.status === 'idle' ? 'interviewing' : state.interview.status,
    messages: state.interview.messages.concat({ role: 'student', text })
  };
}

function appendAssistantMessage(text) {
  state.interview = {
    ...state.interview,
    messages: state.interview.messages.concat({ role: 'assistant', text })
  };
}
```

- [ ] **Step 3: Route confirmation before clearing `state.agentResult`**

At the top of `submitAgentMessage(message)`, after the `state.thinking` guard:

```js
const turnRoute = classifyStudentTurn(message, {
  hasBuildableDraft: canBuildAgentResult(state.agentResult),
  hasCurrentArtifact: Boolean(state.agentResult || state.projectLoaded)
});

if (turnRoute.route === 'confirm-current-draft') {
  appendStudentMessage(message);
  appendAssistantMessage(
    state.locale === 'ko'
      ? '좋아요. 방금 검증한 회로 초안으로 구성해 볼게요.'
      : 'Okay. I will build the validated circuit draft.'
  );
  confirmCurrentAgentResult();
  return;
}
```

This must run before:

```js
state.agentResult = null;
state.projectLoaded = false;
```

- [ ] **Step 4: Add E2E coverage**

In `tests/e2e/features.spec.js`, add an offline-safe test using a mocked valid agent result if a helper already exists. If no helper exists, add a local route stub in the test:

```js
test('natural confirmation builds the current valid draft instead of starting a new ambiguous request', async ({ page }) => {
  const guards = attachGuards(page);
  await page.route('http://127.0.0.1:8798/api/agent/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, defaultMode: 'deepagents-live', provider: 'openai', model: 'test-model', hasServerKey: true })
    });
  });
  await page.route('http://127.0.0.1:8798/api/agent/message', async (route) => {
    const payload = await route.request().postDataJSON();
    expect(payload.message).toMatch(/LED/);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(validLedBlinkAgentResultFixture())
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem('hEduwareAgentApiBase', 'http://127.0.0.1:8798');
  });

  await dismissWelcome(page);
  await page.locator('#idea-input').fill('LED 깜빡이기');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.locator('[data-action="confirm"]')).toBeVisible();

  await page.locator('#idea-input').fill('좋아 구현 부탁해');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.getByTestId('build-progress')).toBeVisible();

  assertClean(guards);
});
```

If `validLedBlinkAgentResultFixture()` does not exist, create a local fixture function in the same test file with a minimal valid `AgentRunResult` matching `AgentRunResultSchema`.

- [ ] **Step 5: Run targeted E2E**

Run:

```powershell
npm exec -- playwright test tests/e2e/features.spec.js -g "natural confirmation"
```

Expected:

```text
passed
```

## 12. Task 6: Route Current Artifact Questions To Grounded Tutor

**Files:**

- Modify: `src/main.js`
- Modify: `tests/e2e/features.spec.js`

- [ ] **Step 1: Add active artifact helpers**

Add:

```js
function activeTutorArtifacts() {
  if (state.agentResult) {
    return {
      circuitSpec: state.agentResult.circuitSpec,
      validationReport: state.agentResult.validationReport,
      simulationPlan: state.agentResult.simulationPlan,
      contextTrace: state.agentResult.contextTrace || []
    };
  }

  const circuit = activeCircuit();
  if (state.projectLoaded && circuit.circuitSpec && circuit.validationReport && circuit.simulationPlan) {
    return {
      circuitSpec: circuit.circuitSpec,
      validationReport: circuit.validationReport,
      simulationPlan: circuit.simulationPlan,
      contextTrace: circuit.contextTrace || []
    };
  }

  return null;
}
```

- [ ] **Step 2: Add general chat artifact QA function**

Add:

```js
async function answerCurrentArtifactQuestion(question) {
  appendStudentMessage(question);
  state.thinking = true;
  render();

  const artifacts = activeTutorArtifacts();
  const target = currentInspectorTarget();

  if (!artifacts) {
    state.thinking = false;
    appendAssistantMessage(
      state.locale === 'ko'
        ? '아직 확인할 회로 초안이 없습니다. 먼저 만들고 싶은 회로를 알려 주세요.'
        : 'There is no circuit draft to inspect yet. Tell me what circuit you want to build first.'
    );
    render();
    return;
  }

  try {
    const response = await askCircuitTutor({
      circuit: activeCircuit(),
      target,
      question,
      locale: state.locale,
      running: state.running,
      artifacts
    });
    state.thinking = false;
    appendAssistantMessage(response.message);
    render();
  } catch (error) {
    state.thinking = false;
    appendAssistantMessage(agentErrorMessage(error, state.locale));
    render();
  }
}
```

- [ ] **Step 3: Route artifact questions before synthesis**

In `submitAgentMessage(message)`, after natural confirmation handling:

```js
if (turnRoute.route === 'current-artifact-question') {
  await answerCurrentArtifactQuestion(message);
  return;
}
```

- [ ] **Step 4: Add E2E coverage for current circuit question**

Add:

```js
test('general chat answers current circuit wiring questions from artifacts instead of restarting synthesis', async ({ page }) => {
  const guards = attachGuards(page);
  await dismissWelcome(page);
  await loadDemo(page);

  await page.locator('#idea-input').fill('전선 연결이 안되도 상관없니?');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();

  await expect(page.locator('.message.assistant').last()).toContainText(/전선|연결|GND|OLED|빠지/i);
  await expect(page.locator('.message.assistant').last()).not.toContainText(/어떤 동작|아직 정해지지|structured circuit draft/i);

  assertClean(guards);
});
```

- [ ] **Step 5: Run targeted E2E**

Run:

```powershell
npm exec -- playwright test tests/e2e/features.spec.js -g "current circuit wiring questions"
```

Expected:

```text
passed
```

## 13. Task 7: Use Conversation Context In Server Context Routing

**Files:**

- Modify: `server/context/contextPacket.ts`
- Modify: `tests/unit/contextRouting.test.ts`

- [ ] **Step 1: Add RED context routing test**

Append to `tests/unit/contextRouting.test.ts`:

```ts
test('follow-up implementation wording routes through the last supported LED goal', async () => {
  const packet = await buildContextPacket({
    message: '좋아 구현 부탁해',
    locale: 'ko',
    conversationContext: {
      awaitingBuildConfirmation: true,
      lastSupportedGoal: 'LED 깜빡이기',
      recentTurns: [
        { role: 'student', text: 'LED 깜빡이기' },
        { role: 'assistant', text: '검증 가능한 LED 깜빡이기 회로 초안입니다.' }
      ],
      currentArtifact: {
        source: 'draft',
        title: 'LED blinker'
      }
    }
  });

  assert.equal(packet.contextRoute.routeId, 'digital-output-series-load');
  assert.ok(packet.capabilityMatches.some((capability) => capability.id === 'digital-light-output'));
  assert.equal(packet.studentMessage, '좋아 구현 부탁해');
});
```

- [ ] **Step 2: Extend context packet input type**

Change:

```ts
type BuildContextPacketInput = Pick<AgentMessageRequest, 'message' | 'locale'>;
```

To:

```ts
type BuildContextPacketInput = Pick<AgentMessageRequest, 'message' | 'locale' | 'conversationContext'>;
```

- [ ] **Step 3: Add contextual routing message helper**

Add:

```ts
function contextualRoutingMessage(input: BuildContextPacketInput) {
  const parts = [
    input.message,
    input.conversationContext?.lastSupportedGoal,
    input.conversationContext?.currentArtifact?.title,
    input.conversationContext?.currentArtifact?.circuitSpec?.intent?.primaryGoal
  ].filter(Boolean);

  return unique(parts).join('\n');
}
```

- [ ] **Step 4: Use contextual message for routing/search only**

In `buildContextPacket()`:

```ts
const message = input.message;
const routingMessage = contextualRoutingMessage(input);
const [index, capabilityMatches, routingMap] = await Promise.all([
  loadContextIndex(),
  matchCapabilities(routingMessage),
  loadContextRoutingMap()
]);
```

Then use `routingMessage` for:

```ts
inferIntentHints(routingMessage, capabilityMatches)
detectUnsupportedSignals(routingMessage)
searchPartCapabilities(expandSearchQuery(routingMessage))
```

Keep `studentMessage: message` and `IntentSpecV2.studentGoal` grounded in the raw message plus context:

```ts
const intentSpec = extractIntentSignals({
  message,
  contextualMessage: routingMessage,
  locale,
  intentHints,
  capabilityMatches,
  unsupportedSignals,
  supportGaps
});
```

If changing `extractIntentSignals()` signature, use `contextualMessage` only for controller/capability inference and keep `studentGoal: message`.

- [ ] **Step 5: Add context trace entry for artifact context**

In `buildContextTrace()`, include:

```ts
if (input.conversationContext?.currentArtifact) {
  trace.push({
    sourceId: `conversation:${input.conversationContext.currentArtifact.source}`,
    sourceType: 'memory',
    reason: `Used current ${input.conversationContext.currentArtifact.source} artifact to interpret the follow-up turn.`,
    usedFields: ['title', 'circuitSpec.intent.primaryGoal', 'validationReport.status', 'simulationPlan.status'],
    summary: input.conversationContext.currentArtifact.title
  });
}
```

Pass `conversationContext` into `buildContextTrace()`.

- [ ] **Step 6: Run context tests**

Run:

```powershell
tsx --test tests/unit/contextRouting.test.ts
```

Expected:

```text
passed
```

## 14. Task 8: Include Conversation Context In Deepagents Prompt

**Files:**

- Modify: `server/agent/deepAgentRuntime.ts`
- Modify: `tests/unit/agentWorkflow.test.ts`

- [ ] **Step 1: Export prompt builder for unit testing**

Change:

```ts
function buildUserPrompt(...)
```

To:

```ts
export function buildUserPrompt(...)
```

- [ ] **Step 2: Add prompt test**

Append to `tests/unit/agentWorkflow.test.ts`:

```ts
test('Deepagents user prompt includes bounded recent turns and current artifact summary', () => {
  const prompt = buildUserPrompt({
    message: '전선 연결이 안되도 상관없니?',
    locale: 'ko',
    conversationContext: {
      awaitingBuildConfirmation: true,
      lastSupportedGoal: 'LED 깜빡이기',
      recentTurns: [
        { role: 'student', text: 'LED 깜빡이기' },
        { role: 'assistant', text: '검증 가능한 LED 회로 초안입니다.' }
      ],
      currentArtifact: {
        source: 'draft',
        title: 'LED blinker',
        validationReport: {
          version: '2026-05-31',
          status: 'valid',
          errors: [],
          warnings: [],
          validatedCurrentPathIds: ['led-forward-current'],
          sourceVersion: '2026-05-31'
        },
        simulationPlan: {
          status: 'valid',
          runText: 'LED BLINK',
          currentPaths: [],
          expectedStates: [],
          warnings: []
        }
      }
    }
  });

  assert.match(prompt, /Student message: 전선 연결이 안되도 상관없니/);
  assert.match(prompt, /Recent conversation/);
  assert.match(prompt, /LED 깜빡이기/);
  assert.match(prompt, /Current artifact/);
  assert.match(prompt, /LED blinker/);
});
```

- [ ] **Step 3: Implement prompt context sections**

In `buildUserPrompt()`:

```ts
const context = request.conversationContext;
const recentTurns = context?.recentTurns?.length
  ? [
      'Recent conversation:',
      ...context.recentTurns.map((turn) => `- ${turn.role}: ${turn.text}`)
    ].join('\n')
  : '';
const artifact = context?.currentArtifact
  ? [
      'Current artifact:',
      `- source: ${context.currentArtifact.source}`,
      `- title: ${context.currentArtifact.title}`,
      `- validation: ${context.currentArtifact.validationReport?.status ?? 'unknown'}`,
      `- simulation: ${context.currentArtifact.simulationPlan?.status ?? 'unknown'}`,
      `- goal: ${context.currentArtifact.circuitSpec?.intent?.primaryGoal ?? context.lastSupportedGoal ?? 'unknown'}`
    ].join('\n')
  : '';
```

Then include both before the instruction line:

```ts
const lines = [
  `Student message: ${request.message}`,
  recentTurns,
  artifact,
  request.confirmation ? `Student confirmation/context: ${request.confirmation}` : '',
  'Return a validated-ready circuit draft if possible. If not possible, ask one targeted clarification and mark unsupported/clarification needs explicitly.'
].filter(Boolean);
```

- [ ] **Step 4: Run unit tests**

Run:

```powershell
tsx --test tests/unit/agentWorkflow.test.ts
```

Expected:

```text
passed
```

## 15. Task 9: Add Typed Structured Output Error

**Files:**

- Modify: `server/agent/deepAgentRuntime.ts`
- Modify: `server/index.ts`
- Modify: `tests/unit/agentWorkflow.test.ts`

- [ ] **Step 1: Add typed error class**

In `server/agent/deepAgentRuntime.ts`:

```ts
export class AgentStructuredOutputError extends Error {
  readonly code = 'AGENT_STRUCTURED_OUTPUT_MISSING';

  constructor() {
    super('Agent did not return the required structured circuit draft.');
    this.name = 'AgentStructuredOutputError';
  }
}
```

- [ ] **Step 2: Throw typed error in `extractDraft()`**

Change:

```ts
throw new Error('Deepagents did not return a structured circuit draft.');
```

To:

```ts
throw new AgentStructuredOutputError();
```

- [ ] **Step 3: Map typed error in `server/index.ts`**

Change imports:

```ts
import {
  AgentConfigurationError,
  AgentStructuredOutputError,
  runAgent,
  agentRuntimeHealth
} from './agent/deepAgentRuntime.ts';
```

Change catch handling:

```ts
if (error instanceof AgentStructuredOutputError) {
  return sendJson(response, 502, {
    errorCode: error.code,
    error: 'The agent could not return a structured circuit draft. The current circuit state was preserved.',
    retryable: true
  });
}

const status = error instanceof AgentConfigurationError ? 503 : 400;
```

- [ ] **Step 4: Add unit-level extraction test**

Export `extractDraft` only if needed for testing. Prefer a scripted draft test:

```ts
test('structured output missing error is typed and safe to map', async () => {
  await assert.rejects(
    () => runAgentWithScriptedDrafts({
      request: { message: 'LED 깜빡이기', locale: 'ko' },
      drafts: [null]
    }),
    (error: unknown) => error instanceof AgentStructuredOutputError
  );
});
```

If `runAgentWithScriptedDrafts()` currently parses drafts before `extractDraft()`, export `extractDraft` and test it directly:

```ts
test('extractDraft throws typed error when structured response is missing', () => {
  assert.throws(
    () => extractDraft({ messages: [] }),
    AgentStructuredOutputError
  );
});
```

- [ ] **Step 5: Run tests**

Run:

```powershell
tsx --test tests/unit/agentWorkflow.test.ts
node --test tests/unit/agentErrorMessages.test.js
```

Expected:

```text
passed
```

## 16. Task 10: Add RED Tests For LED Closed-Series Path Validation

**Files:**

- Modify: `tests/unit/agentWorkflow.test.ts`
- Modify: `server/agent/circuitTools.ts`

- [ ] **Step 1: Add malformed LED fixture helpers**

Append near existing fixture helpers in `tests/unit/agentWorkflow.test.ts`:

```ts
function ledCircuitWithMissingPositiveSeriesPath(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'bad-led-missing-positive-path',
    title: 'Bad LED missing positive path',
    intent: { primaryGoal: 'blink an LED', output: 'led', controller: 'arduino-uno' },
    components: [
      { id: 'arduino-uno', partId: 'arduino-uno', label: 'Arduino Uno' },
      { id: 'led-1', partId: 'led-5mm', label: 'LED' },
      { id: 'r1', partId: 'resistor-220', label: '220 ohm resistor' }
    ],
    connections: [
      {
        id: 'led-ground',
        from: { componentId: 'led-1', pin: 'K' },
        to: { componentId: 'arduino-uno', pin: 'GND' },
        signal: 'ground'
      }
    ],
    behavior: { runText: 'LED BLINK' },
    assumptions: [],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function ledCircuitWithResistorParallelOrUnused(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'bad-led-unused-resistor',
    title: 'Bad LED unused resistor',
    intent: { primaryGoal: 'blink an LED', output: 'led', controller: 'arduino-uno' },
    components: [
      { id: 'arduino-uno', partId: 'arduino-uno', label: 'Arduino Uno' },
      { id: 'led-1', partId: 'led-5mm', label: 'LED' },
      { id: 'r1', partId: 'resistor-220', label: '220 ohm resistor' }
    ],
    connections: [
      {
        id: 'direct-led-anode',
        from: { componentId: 'arduino-uno', pin: 'D8' },
        to: { componentId: 'led-1', pin: 'A' },
        signal: 'gpio'
      },
      {
        id: 'led-ground',
        from: { componentId: 'led-1', pin: 'K' },
        to: { componentId: 'arduino-uno', pin: 'GND' },
        signal: 'ground'
      }
    ],
    behavior: { runText: 'LED BLINK' },
    assumptions: [],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}
```

- [ ] **Step 2: Add RED validation tests**

Append:

```ts
test('validation rejects LED circuits where resistor exists but is not in the closed series path', async () => {
  const missingPositive = await validateCircuitSpec(ledCircuitWithMissingPositiveSeriesPath());
  assert.equal(missingPositive.status, 'invalid');
  assert.match(missingPositive.errors.join('\n'), /LED_SERIES_PATH_INCOMPLETE|LED_CONTROLLER_SOURCE_MISSING/);

  const unusedResistor = await validateCircuitSpec(ledCircuitWithResistorParallelOrUnused());
  assert.equal(unusedResistor.status, 'invalid');
  assert.match(unusedResistor.errors.join('\n'), /LED_RESISTOR_NOT_IN_SERIES/);
});

test('invalid LED series path does not produce fallback current simulation from D9', async () => {
  const spec = ledCircuitWithMissingPositiveSeriesPath();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const simulation = await compileSimulationPlan(spec, validation, paths);

  assert.equal(simulation.status, 'invalid');
  assert.equal(simulation.currentPaths.length, 0);
  assert.doesNotMatch(JSON.stringify(simulation), /arduino-uno:D9/);
});
```

- [ ] **Step 3: Verify RED**

Run:

```powershell
tsx --test tests/unit/agentWorkflow.test.ts
```

Expected:

```text
not ok ... validation rejects LED circuits where resistor exists...
```

## 17. Task 11: Implement LED Closed-Series Validator

**Files:**

- Modify: `server/agent/circuitTools.ts`

- [ ] **Step 1: Add validator call after basic component checks**

In `validateCircuitSpec()` after the existing LED resistor existence check:

```ts
errors.push(...validateLedClosedSeriesPaths(spec, partsById, componentsById));
```

- [ ] **Step 2: Add helper functions**

Add below `isActiveLoad()`:

```ts
function validateLedClosedSeriesPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const leds = spec.components.filter((component) => component.partId === 'led-5mm');

  for (const led of leds) {
    const path = findLedSeriesPath(spec, led.id, partsById, componentsById);
    if (!path.hasControllerSource) {
      errors.push(`LED_CONTROLLER_SOURCE_MISSING: ${led.label} needs an Arduino digital or PWM output feeding the series path.`);
    }
    if (!path.hasSeriesResistor) {
      errors.push(`LED_RESISTOR_NOT_IN_SERIES: ${led.label} needs the 220 ohm resistor in series before the LED anode.`);
    }
    if (!path.hasAnodeEntry) {
      errors.push(`LED_SERIES_PATH_INCOMPLETE: ${led.label} anode is not connected through the current limiting path.`);
    }
    if (!path.hasCathodeGroundReturn) {
      errors.push(`LED_GROUND_RETURN_MISSING: ${led.label} cathode must return to Arduino GND.`);
    }
    if (path.hasReversedPolarity) {
      errors.push(`LED_POLARITY_REVERSED: ${led.label} appears reversed in the series path.`);
    }
  }

  return unique(errors);
}

function findLedSeriesPath(
  spec: CircuitSpec,
  ledId: string,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const graph = buildEndpointGraph(spec, partsById, componentsById);
  const controllerSources = spec.connections.flatMap((connection) => [connection.from, connection.to])
    .filter((endpoint) => endpoint.componentId === 'arduino-uno')
    .filter((endpoint) => {
      const role = roleFor(endpoint, componentsById, partsById);
      return role === 'digital-output' || role === 'pwm-output';
    })
    .map(endpointKey);

  const anodeKey = `${ledId}:A`;
  const cathodeKey = `${ledId}:K`;
  const reachableFromSources = reachableEndpointKeys(graph, controllerSources);
  const reachableFromCathode = reachableEndpointKeys(graph, [cathodeKey]);

  const resistorIds = spec.components
    .filter((component) => component.partId === 'resistor-220')
    .map((component) => component.id);
  const hasSeriesResistor = resistorIds.some((id) =>
    reachableFromSources.has(`${id}:1`) || reachableFromSources.has(`${id}:2`)
  ) && reachableFromSources.has(anodeKey);
  const hasControllerSource = controllerSources.some((key) => reachableFromSources.has(key));
  const hasAnodeEntry = reachableFromSources.has(anodeKey);
  const hasCathodeGroundReturn = [...reachableFromCathode].some((key) => {
    const endpoint = endpointFromKey(key);
    return endpoint.componentId === 'arduino-uno'
      && roleFor(endpoint, componentsById, partsById) === 'ground';
  });
  const hasReversedPolarity = reachableFromSources.has(cathodeKey);

  return {
    hasControllerSource,
    hasSeriesResistor,
    hasAnodeEntry,
    hasCathodeGroundReturn,
    hasReversedPolarity
  };
}

function buildEndpointGraph(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const graph = new Map<string, Set<string>>();

  for (const connection of spec.connections) {
    const fromKey = endpointKey(connection.from);
    const toKey = endpointKey(connection.to);
    addEdge(graph, fromKey, toKey);
    addEdge(graph, toKey, fromKey);
  }

  for (const component of spec.components) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }
    if (part.partId === 'led-5mm') {
      continue;
    }
    if (component.partId === 'resistor-220') {
      addEdge(graph, `${component.id}:1`, `${component.id}:2`);
      addEdge(graph, `${component.id}:2`, `${component.id}:1`);
    }
  }

  return graph;
}

function reachableEndpointKeys(graph: Map<string, Set<string>>, startKeys: string[]) {
  const visited = new Set<string>();
  const queue = [...startKeys];
  for (const key of startKeys) {
    visited.add(key);
  }

  while (queue.length > 0) {
    const key = queue.shift();
    if (!key) {
      continue;
    }
    for (const next of graph.get(key) ?? []) {
      if (visited.has(next)) {
        continue;
      }
      visited.add(next);
      queue.push(next);
    }
  }

  return visited;
}

function endpointFromKey(key: string) {
  const [componentId, ...pinParts] = key.split(':');
  return {
    componentId,
    pin: pinParts.join(':')
  };
}
```

Important correction inside `buildEndpointGraph()`:

```ts
if (component.partId === 'led-5mm') {
  continue;
}
```

Do not use `part.partId`; `PartCapability` has `id`, while `CircuitComponent` has `partId`.

- [ ] **Step 3: Ensure valid LED fixture still passes**

The existing `ledCircuit()` fixture should include:

```text
arduino-uno:D8 -> r1:1
r1:2 -> led-1:A
led-1:K -> arduino-uno:GND
```

If it uses `D9`, that is also acceptable if the Arduino pin role is `pwm-output`. Do not change the fixture unless the validator reveals a genuine mismatch.

- [ ] **Step 4: Run LED validator tests**

Run:

```powershell
tsx --test tests/unit/agentWorkflow.test.ts
```

Expected:

```text
passed
```

## 18. Task 12: Remove LED Current Path Fallback Overclaiming

**Files:**

- Modify: `server/agent/circuitTools.ts`
- Modify: `tests/unit/agentWorkflow.test.ts`

- [ ] **Step 1: Add assertion for valid LED current source**

In an existing valid LED simulation test, assert:

```ts
assert.equal(path.from, 'arduino-uno:D8');
```

If the fixture intentionally uses `D9`, assert:

```ts
assert.equal(path.from, 'arduino-uno:D9');
```

The important rule is that `path.from` must match an explicit connection in `spec.connections`, not a fallback.

- [ ] **Step 2: Add helper to detect explicit source**

Modify `compileFallbackCurrentPath()` and templated path resolution so LED paths do not invent controller pins. For LED, keep:

```ts
const source = findControllerSignalEndpoint(spec, targetId, passiveIds);
if (!source && context.part.id === 'led-5mm') {
  throw new Error('Validated LED path is missing an explicit controller source.');
}
```

Because `estimateCurrentPaths()` is called only after validation, this should never throw for a valid LED after Task 11. It guards future validator regressions.

- [ ] **Step 3: Run workflow tests**

Run:

```powershell
tsx --test tests/unit/agentWorkflow.test.ts
```

Expected:

```text
passed
```

## 19. Task 13: Add Transcript-Level E2E Regression

**Files:**

- Modify: `tests/e2e/features.spec.js`

- [ ] **Step 1: Add fixture function for valid LED result**

Add a fixture function near the top of `features.spec.js`:

```js
function validLedBlinkAgentResultFixture() {
  return {
    sessionId: 'session-led-e2e',
    mode: 'live',
    assistantMessages: [
      '검증 가능한 LED 깜빡이기 회로 초안입니다. Arduino Uno의 D8 핀에서 220 Ω 저항을 거쳐 LED 애노드로 연결하고 LED 캐소드를 GND로 되돌립니다.'
    ],
    agentEvents: [
      { type: 'coordinator', name: 'deepagents-coordinator', status: 'completed', summary: 'Created LED draft.' }
    ],
    clarification: null,
    contextTrace: [
      { sourceId: 'memory:agent-operating-memory', sourceType: 'memory', reason: 'Loaded rules.', usedFields: ['validation-before-simulation'] }
    ],
    contextCoverage: {
      status: 'sufficient',
      score: 1,
      requiredSourceTypes: ['memory'],
      presentSourceTypes: ['memory'],
      missingSourceTypes: [],
      warnings: []
    },
    requirementMarkdown: '# Project Requirement: LED blinker\n\n## Connections\n\n- arduino-uno:D8 -> r1:1\n- r1:2 -> led-1:A\n- led-1:K -> arduino-uno:GND',
    circuitSpec: {
      id: 'led-blinker',
      title: 'LED blinker',
      intent: { primaryGoal: 'blink an LED', output: 'led', controller: 'arduino-uno' },
      components: [
        { id: 'breadboard', partId: 'breadboard-half', label: 'Half-size breadboard' },
        { id: 'arduino-uno', partId: 'arduino-uno', label: 'Arduino Uno' },
        { id: 'r1', partId: 'resistor-220', label: '220 ohm resistor' },
        { id: 'led-1', partId: 'led-5mm', label: 'LED' }
      ],
      connections: [
        { id: 'd8-to-resistor', from: { componentId: 'arduino-uno', pin: 'D8' }, to: { componentId: 'r1', pin: '1' }, signal: 'gpio' },
        { id: 'resistor-to-led', from: { componentId: 'r1', pin: '2' }, to: { componentId: 'led-1', pin: 'A' }, signal: 'gpio' },
        { id: 'led-ground', from: { componentId: 'led-1', pin: 'K' }, to: { componentId: 'arduino-uno', pin: 'GND' }, signal: 'ground' }
      ],
      behavior: { runText: 'LED BLINK' },
      assumptions: ['A 220 ohm resistor limits LED current.'],
      unsupportedItems: [],
      clarificationNeeds: []
    },
    validationReport: {
      version: '2026-05-31',
      status: 'valid',
      errors: [],
      warnings: [],
      validatedCurrentPathIds: ['led-forward-current'],
      sourceVersion: '2026-05-31'
    },
    renderPlan: {
      title: 'LED blinker',
      runText: 'LED BLINK',
      parts: [
        { id: 'breadboard', type: 'breadboard', label: 'Half-size breadboard', pins: [] },
        { id: 'arduino-uno', type: 'arduino', label: 'Arduino Uno', pins: [{ name: 'D8', role: 'digital-output' }, { name: 'GND', role: 'ground' }] },
        { id: 'r1', type: 'resistor', label: '220 ohm resistor', pins: [{ name: '1', role: 'passive-terminal' }, { name: '2', role: 'passive-terminal' }] },
        { id: 'led-1', type: 'led', label: 'LED', pins: [{ name: 'A', role: 'anode' }, { name: 'K', role: 'cathode' }] }
      ],
      connections: [
        {
          id: 'd8-to-resistor',
          from: { partId: 'arduino-uno', pin: 'D8' },
          to: { partId: 'r1', pin: '1' },
          signal: 'gpio',
          color: '#2f7df6',
          education: { label: 'D8', title: 'Arduino output to resistor', what: 'This wire starts the LED current path.', why: 'The resistor must be in series.', missing: 'If missing, LED cannot turn on.' }
        },
        {
          id: 'resistor-to-led',
          from: { partId: 'r1', pin: '2' },
          to: { partId: 'led-1', pin: 'A' },
          signal: 'gpio',
          color: '#2f7df6',
          education: { label: 'LED A', title: 'Resistor to LED anode', what: 'This wire feeds the protected LED anode.', why: 'The LED needs current after the resistor.', missing: 'If missing, the LED path is open.' }
        },
        {
          id: 'led-ground',
          from: { partId: 'led-1', pin: 'K' },
          to: { partId: 'arduino-uno', pin: 'GND' },
          signal: 'ground',
          color: '#20242a',
          education: { label: 'GND', title: 'LED cathode return', what: 'This wire returns current to Arduino GND.', why: 'Current needs a closed loop.', missing: 'If missing, the LED cannot light.' }
        }
      ],
      floatingCards: [],
      warnings: []
    },
    simulationPlan: {
      status: 'valid',
      runText: 'LED BLINK',
      currentPaths: [
        {
          id: 'led-forward-current',
          kind: 'load-current',
          primitiveId: 'blink_timer',
          label: 'LED forward current',
          from: 'arduino-uno:D8',
          through: ['r1', 'led-1'],
          to: 'arduino-uno:GND',
          expectedCurrentMa: 13.6,
          animation: { color: '#ff4d3d', speed: 0.8 }
        }
      ],
      expectedStates: [
        { componentId: 'led-1', state: 'blinking', primitiveId: 'blink_timer', explanation: 'D8 alternates HIGH and LOW.' }
      ],
      warnings: []
    }
  };
}
```

- [ ] **Step 2: Add transcript regression test**

Add:

```js
test('LED draft follow-up keeps conversation state, builds on natural confirmation, and answers wiring critique', async ({ page }) => {
  const guards = attachGuards(page);
  await page.route('http://127.0.0.1:8798/api/agent/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, defaultMode: 'deepagents-live', provider: 'openai', model: 'test-model', hasServerKey: true })
    });
  });
  await page.route('http://127.0.0.1:8798/api/agent/message', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(validLedBlinkAgentResultFixture())
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem('hEduwareAgentApiBase', 'http://127.0.0.1:8798');
  });

  await dismissWelcome(page);
  await page.locator('#idea-input').fill('LED 깜빡이기');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.locator('[data-action="confirm"]')).toBeVisible();

  await page.locator('#idea-input').fill('좋아 구현 부탁해');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.getByTestId('build-progress')).toBeVisible();
  await page.getByTestId('build-progress-skip').click();
  await expect(page.getByTestId('requirement-markdown')).toContainText(/LED|D8|GND/);

  await page.locator('#idea-input').fill('전선 연결이 안되도 상관없니?');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.locator('.message.assistant').last()).toContainText(/전선|연결|빠지|GND|D8/i);
  await expect(page.locator('.message.assistant').last()).not.toContainText(/아직 정해지지|structured circuit draft|Deepagents did not return/i);

  await page.locator('[data-tab="PCB"]').click();
  await expect(page.getByTestId('stage-canvas')).toBeVisible();
  await expect(page.getByTestId('connection-list')).toContainText(/D8|GND|LED/i);

  assertClean(guards);
});
```

- [ ] **Step 3: Run targeted E2E**

Run:

```powershell
npm exec -- playwright test tests/e2e/features.spec.js -g "LED draft follow-up"
```

Expected:

```text
passed
```

## 20. Task 14: Update Documentation

**Files:**

- Modify: `docs/coworking_handoff_2026-05-31.md`
- Modify: this plan file after implementation

- [ ] **Step 1: Add handoff summary**

Append to `docs/coworking_handoff_2026-05-31.md`:

```md
## 10. 2026-05-31 Conversation State / Artifact Grounding / LED Validator 구현 메모

이번 변경은 학생의 후속 발화가 새 요청으로 오분류되는 문제를 수정했다.

변경 요약:

- 자연어 확인(`좋아 구현 부탁해`)을 현재 valid draft build confirmation으로 처리한다.
- 현재 회로 질문(`전선 연결이 안되도 상관없니?`)은 synthesis agent가 아니라 artifact-grounded tutor path로 처리한다.
- `/api/agent/message` 요청에 bounded `conversationContext`를 포함한다.
- Deepagents structured-output 누락은 raw error 대신 학생 친화 복구 메시지로 표시한다.
- LED 회로는 `Arduino digital/PWM output -> resistor -> LED anode -> LED cathode -> Arduino GND` 닫힌 직렬 경로가 있어야 valid가 된다.
- 불완전한 LED 회로는 fallback D9 current path를 만들 수 없다.

검증:

```powershell
npm run check
```

결과:

- unit tests: 67+ passed
- typecheck: passed
- build: passed
- E2E: passed, live opt-in tests skipped by default
```

- [ ] **Step 2: Add implementation status section to this plan**

After all tasks are complete, add:

```md
## 23. Implementation Status

Status: implemented on 2026-05-31.

Verification:

```powershell
npm run check
```

Most recent result:

- unit tests: ...
- typecheck: ...
- build: ...
- E2E: ...
```

Use the actual numbers from the command output.

## 21. Verification Plan

Run focused checks after each phase:

```powershell
node --test tests/unit/conversationRouting.test.js
node --test tests/unit/agentErrorMessages.test.js
tsx --test tests/unit/agentSchemas.test.ts
tsx --test tests/unit/contextRouting.test.ts
tsx --test tests/unit/agentWorkflow.test.ts
npm exec -- playwright test tests/e2e/features.spec.js -g "natural confirmation|current circuit wiring questions|LED draft follow-up"
```

Run full acceptance after all tasks:

```powershell
npm run check
```

Expected:

- default tests do not require live OpenAI calls
- unit tests pass
- typecheck passes
- Vite build passes
- Playwright E2E passes
- live agent tests remain opt-in and skipped by default unless `RUN_LIVE_E2E=1`

## 22. Acceptance Criteria

This implementation is complete when all of these are true:

- `좋아 구현 부탁해` builds the current valid LED draft instead of clearing it.
- `전선 연결이 안되도 상관없니?` is answered from the current circuit artifact.
- The assistant no longer says “아직 어떤 회로인지 정해지지 않았다” when a current draft exists.
- Student-facing UI never displays `Deepagents did not return a structured circuit draft`.
- `/api/agent/message` accepts bounded conversation/artifact context.
- Context routing can use the last supported goal for follow-up turns while preserving the raw student message.
- LED circuits without a complete positive series path are invalid.
- LED circuits with a resistor component that is not actually in series are invalid.
- Invalid LED circuits do not produce fallback current paths from synthetic pins such as `arduino-uno:D9`.
- Valid LED circuits still render, simulate, and pass existing generalization tests.
- `npm run check` passes.

## 23. Execution Notes

- Do not route every follow-up to tutor. Revision requests such as `버튼도 추가해줘` must remain synthesis/revision turns.
- Do not make the server trust frontend classification. The server should still receive conversation context and validate every final `CircuitSpec`.
- Do not store raw API keys, prompts, or secrets in conversation context.
- Do not send unbounded chat history to the server. Keep `recentTurns` capped at 12 and artifact text capped by schema.
- Do not solve validator gaps with prompt instructions. The deterministic validator must reject invalid LED topology independently of LLM output.
- The current workspace is not a git repository. Use the checkbox state in this plan and verification output as the implementation checkpoint.

## 24. Self-Review

Spec coverage:

- Follow-up memory gap: covered by Tasks 3, 4, 7, and 8.
- Natural confirmation misroute: covered by Task 5.
- Current circuit question misroute: covered by Task 6.
- LED validator gap: covered by Tasks 10, 11, and 12.
- Raw structured-output error leakage: covered by Tasks 2 and 9.
- Transcript-level regression: covered by Task 13.
- Documentation handoff: covered by Task 14.

Placeholder scan:

- No task uses unresolved placeholder wording or open-ended “add tests” wording.
- Every code-changing task includes concrete file paths and code snippets.

Type consistency:

- `conversationContext` is added to `AgentMessageRequestSchema`, sent from `sendAgentMessage()`, consumed by `buildContextPacket()`, and included in `buildUserPrompt()`.
- `currentArtifact` uses existing `CircuitSpecSchema`, `ValidationReportSchema`, `RenderPlanSchema`, and `SimulationPlanSchema`.
- Frontend routes use explicit route strings:
  - `confirm-current-draft`
  - `current-artifact-question`
  - `revise-current-draft`
  - `synthesize-or-clarify`

## 25. Actual Implementation Status

Status: implemented on 2026-05-31.

Implemented scope:

- Added deterministic frontend turn routing for natural confirmations, artifact-grounded questions, revision requests, and new/ambiguous synthesis requests.
- Added safe student-facing agent error mapping and typed server structured-output error responses.
- Added bounded `conversationContext` schemas and payload forwarding from the frontend to `/api/agent/message`.
- Updated context packet routing to preserve the raw student message while using current artifact / last supported goal for follow-up grounding.
- Updated the Deepagents user prompt to include recent turns and current artifact summary.
- Routed natural text confirmation such as `좋아 구현 부탁해` to the current valid draft build path without clearing `state.agentResult`.
- Routed current circuit questions such as `전선 연결이 안되도 상관없니?` to artifact-grounded tutor QA instead of synthesis.
- Strengthened LED validation so valid LED current simulation requires `Arduino digital/PWM output -> resistor -> LED anode -> LED cathode -> Arduino GND`.
- Removed LED current-path overclaiming from synthetic fallback controller pins when the explicit source is missing.
- Added transcript-level Playwright coverage for LED draft, natural confirmation, build, current circuit question, PCB visualization, and no raw Deepagents error leakage.

Focused verification already run:

```powershell
node --test tests/unit/conversationRouting.test.js tests/unit/agentErrorMessages.test.js tests/unit/aiClient.test.js
npm exec -- tsx --test tests/unit/agentSchemas.test.ts
npm exec -- tsx --test tests/unit/contextPacket.test.ts
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
npm exec -- playwright test tests/e2e/features.spec.js -g "LED draft follow-up" --project=desktop-chromium
npm run test:unit
npm run typecheck
npm run build
npm run test:e2e
```

Most recent individual results before final `npm run check`:

- unit tests: 126 passed
- typecheck: passed
- build: passed
- E2E: 24 passed, 8 skipped

Final acceptance gate:

```powershell
npm run check
```

Result:

- passed
- unit tests: 126 passed
- typecheck: passed
- build: passed
- E2E: 24 passed, 8 skipped

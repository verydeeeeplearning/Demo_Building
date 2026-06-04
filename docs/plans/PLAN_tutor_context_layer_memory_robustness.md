# Tutor Context Layer Memory Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tutor chat robust across live structured-output failures, short referential follow-up turns, selected-target changes, artifact changes, main-chat artifact QA handoffs, and context-layer lookup needs without giving tutor unsafe synthesis authority.

**Architecture:** This revised plan replaces the reviewed draft in-place; no old plan copy is retained. First lock the robustness contracts with RED tests: scoped thread identity, response freshness, context projection, main/tutor UI trajectories, and Railway observability. Then implement framework-native Deep Agents structured output and LangGraph checkpointer memory using a server-authoritative scope; context access is read-only and reuses a shared bounded projection reader extracted from the existing main-agent tool boundary instead of a bespoke aggregate reader.

**Tech Stack:** Vanilla JavaScript, Vite, Node test runner, Playwright, TypeScript, Zod, LangChain JS, Deep Agents JS, LangGraph checkpointers, optional LangSmith tracing.

---

## Status

Revised on 2026-06-05 after five independent robustness reviews. All five reviews returned `REVISE`; the blocking issues are integrated here.

Implementation is blocked until the RED tests in Tasks 1 through 5 exist and fail for the current implementation. This is deliberate: the old draft was too implementation-forward and could have recreated context overread and stale artifact bugs.

Old-version handling: the previous draft at this same path was deleted and replaced. Do not look for a v1/v2 duplicate plan.

## Official Framework References Checked

- LangChain structured output: <https://docs.langchain.com/oss/javascript/langchain/structured-output>
  - Agent structured data is returned in final state as `structuredResponse`.
  - `providerStrategy(schema)` uses provider-native structured output when supported.
  - `toolStrategy(schema)` is the framework-native fallback when provider-native output is unavailable.
  - If tools are specified, the selected model must support simultaneous tool calling and structured output.
- Deep Agents customization: <https://docs.langchain.com/oss/javascript/deepagents/customization>
  - `createDeepAgent(...)` supports `tools`, `responseFormat`, `checkpointer`, `store`, and `systemPrompt`.
- LangGraph memory: <https://docs.langchain.com/oss/javascript/langgraph/add-memory>
  - Short-term memory requires a checkpointer and a stable `configurable.thread_id`.
  - `MemorySaver` is suitable for tests/local runtime; production persistence requires an injectable durable checkpointer seam.
- LangGraph interrupts: <https://docs.langchain.com/oss/javascript/langgraph/interrupts>
  - Clarification/HITL flows require `interrupt()` and resume via `Command({ resume })` with the same thread state. This plan does not add tutor HITL, but it must not block future framework-native HITL.

## Review Findings Integrated

- Server must recompute `artifactFingerprint` and `targetScopeId`; client-supplied values are hints only.
- UI freshness must recompute the current artifact fingerprint at response time. Reusing the request-time fingerprint is a stale-response bug.
- Tutor context tools must not call the raw aggregate document reader for item-level ids, because item ids can resolve to aggregate docs.
- `registry:part-capabilities:<partId>` must return only the selected part projection, not the full part registry.
- `data:simulation-primitives:<primitiveId>` must return only the selected primitive projection, not the full primitive list.
- Context tool implementation must reuse/extract the existing bounded context reader path from `server/agent/deepAgentTools.ts`; do not create an unrelated reader with a different boundary.
- `tools + providerStrategy` needs a model capability guard and a framework-native `toolStrategy` or no-tools fallback path.
- Main chat current-artifact QA uses `askCircuitTutor(...)` too; it needs an explicit memory/freshness policy, not only the right-side tutor drawer.
- Target changes happen through both `selectCircuitTarget(...)` and `stepCurrentFlow(...)`; both must cancel or invalidate pending tutor responses.
- New server-side tutor files must be included in `server/serverHealth.ts` source freshness probes.
- Railway smoke evidence must include health freshness, same API base for main/tutor, response serving status, fallback category, and redacted structured-output status logs.

## Hard Invariants

1. Current circuit artifacts and context trace are the authority for facts.
2. LangGraph checkpointer memory is only conversation continuity inside one scoped tutor thread.
3. Memory cannot override current artifact/context authority.
4. UI-visible messages are render/debug state, not authoritative memory.
5. Full artifact JSON must not be checkpointed as a tutor user message.
6. Tutor can list/read only source ids present in the current target-scoped context plan.
7. A source id that names one item returns one item projection.
8. Local fallback, live fallback, malformed live fallback, and live success all echo the resolved scope fields.
9. Logs must carry redacted identifiers and status fields; logs must not carry raw prompt text, raw assistant text, full artifact JSON, or secrets.
10. Default tests must not depend on live OpenAI calls or API keys.

## Failure Trajectories To Cover

| Trajectory | Failure To Prevent | Required Evidence |
| --- | --- | --- |
| Live structured output returns assistant text but no `structuredResponse` | UI shows local fallback even though live model answered | Unit test for `native` vs `recovered_*`, log status, live smoke opt-in |
| User asks short follow-up in same selected target | Tutor repeats target intro or loses previous turn | Mocked e2e confirms same scoped thread and short follow-up request |
| User switches selected target while request is pending | Old answer appears under new target | Unit/e2e stale discard and spinner clearing |
| User changes artifact while request is pending | Old artifact answer appears on new circuit | Response-time current fingerprint recomputation |
| Main chat asks current-artifact question | Main chat appends stale or unsafely stateful tutor answer | Main chat policy and stale guard test |
| Tutor reads context source `registry:part-capabilities:led-5mm` | Tutor sees OLED or other registry rows | Scoped projection test rejects overread |
| Tutor reads source `data:simulation-primitives:display_static_text` | Tutor sees unrelated primitives | Scoped projection test rejects overread |
| Server receives spoofed `targetScopeId` | Thread memory bleeds across targets | Server recompute-and-override test |
| Railway server has stale compiled source | Deployed UI still shows fallback | Health `sourceStatus.stale=false` and log evidence |

## File Structure

- Create `shared/tutorThreadScope.js`
  - Browser/server-safe pure helpers for target ids, authority snapshots, SHA-256 artifact fingerprints, request keys, and thread ids.
- Modify `src/tutorRequestFreshness.js`
  - Use request keys based on target id, response-time current fingerprint, locale, and sequence.
- Modify `src/circuitTutorClient.js`
  - Send scope fields and preserve `hEduwareAgentApiBase`, endpoint-aware failure cache, and `hEduwareTutorServer=disabled`.
  - Parse and preserve `tutorThreadId`, `artifactFingerprint`, `targetScopeId`, and `structuredOutputStatus`.
- Modify `src/main.js`
  - Apply scoped freshness to `submitTutorQuestion(...)`.
  - Add explicit policy for `answerCurrentArtifactQuestion(...)`.
  - Invalidate pending tutor work in both `selectCircuitTarget(...)` and `stepCurrentFlow(...)`.
- Modify `server/agent/schemas.ts`
  - Add request/response scope fields and structured-output status enum.
- Create `server/agent/tutorThreadScope.ts`
  - Server-authoritative resolver that recomputes fingerprint and target scope, normalizes ids, and builds thread id.
- Create `server/context/scopedContextReader.ts`
  - Shared bounded context projection reader extracted from the current `deepAgentTools.ts` boundary.
- Modify `server/agent/deepAgentTools.ts`
  - Replace private bounded context read helpers with imports from `server/context/scopedContextReader.ts`.
- Create `server/agent/tutorContextTools.ts`
  - Thin Deep Agents tool wrappers around `scopedContextReader`; no aggregate reader logic here.
- Modify `server/agent/circuitTutor.ts`
  - Resolve scope once at request entry, echo scope on every response path, use `MemorySaver`/injectable checkpointer, add model capability guard, and avoid checkpointing full artifact JSON.
- Modify `server/agent/agentLogger.ts`
  - Log redacted scope, mismatch flags, fallback category, and structured-output status.
- Modify `server/serverHealth.ts`
  - Add new tutor and scoped context files to source freshness probes.
- Modify docs:
  - `docs/agent-tutor-serving-workflow.md`
  - `docs/agent-request-to-simulation-workflow.md`
  - `docs/README.md`
  - `AGENTS.md` only if its context architecture anchors remain missing after checking the repository.
- Modify tests:
  - `tests/unit/tutorThreadScope.test.js`
  - `tests/unit/tutorRequestFreshness.test.js`
  - `tests/unit/circuitTutorClient.test.js`
  - `tests/unit/scopedContextReader.test.ts`
  - `tests/unit/tutorContextTools.test.ts`
  - `tests/unit/circuitTutor.test.ts`
  - `tests/unit/agentLogger.test.ts`
  - `tests/unit/serverHealth.test.ts`
  - `tests/e2e/features.spec.js`

---

## Task 1: Reconcile Context Architecture Anchors

**Files:**
- Modify: `docs/README.md`
- Modify: `AGENTS.md` only if the missing paths cannot be restored from existing project material
- Create: `docs/plans/PLAN_layered_context_architecture.md` only if it is still missing
- Create: `docs/plans/REVIEW_layered_context_architecture_2026-06-02.md` only if it is still missing and a prior review artifact is available in project history
- Test: documentation scan

- [ ] **Step 1: Verify referenced context docs exist**

Run:

```powershell
Test-Path docs/plans/PLAN_layered_context_architecture.md
Test-Path docs/plans/REVIEW_layered_context_architecture_2026-06-02.md
rg -n "PLAN_layered_context_architecture|REVIEW_layered_context" docs/README.md AGENTS.md
```

Expected before this task in the current workspace:

```text
False
False
```

- [ ] **Step 2: Restore or correct the anchors**

If the files are still missing, create `docs/plans/PLAN_layered_context_architecture.md` as the current architecture anchor using the actual repository state:

```markdown
# Layered Context Architecture Plan

Current runtime context architecture uses `agent-context/v2`, `server/context/contextPacket.ts`, and `server/context/contextLayer.ts` as the source-of-truth path.

The active shape is:

- L0 part/source bundles selected from the context route.
- L2 topology composition and validation inputs generated from selected sources.
- L3 capability bundles and source-bundle evidence exposed through `contextTrace`.
- Item-level trace ids such as `registry:part-capabilities:<id>` and `data:simulation-primitives:<id>` name one selected evidence item, not an aggregate document authorization.

Any agent or tutor context reader must preserve this item-level boundary. Aggregate files may be used internally to resolve a projection, but a scoped read for one item must return only that item.
```

If no historical review artifact exists, update `docs/README.md` and `AGENTS.md` references to the restored architecture plan and this tutor robustness plan instead of creating a fake dated review.

- [ ] **Step 3: Scan for broken context plan links**

Run:

```powershell
rg -n "plans/PLAN_layered_context_architecture.md|plans/REVIEW_layered_context_architecture_2026-06-02.md" docs/README.md AGENTS.md
```

Expected: every reported link resolves to a real file, or the line points to the replacement current anchor introduced in this task.

## Task 2: Lock Tutor Scope And Authority Snapshot Contracts

**Files:**
- Create: `shared/tutorThreadScope.js`
- Create: `tests/unit/tutorThreadScope.test.js`
- Modify: `tests/unit/tutorRequestFreshness.test.js`
- Test: `tests/unit/tutorThreadScope.test.js`, `tests/unit/tutorRequestFreshness.test.js`

- [ ] **Step 1: Add RED tests for authority snapshot hashing**

Create `tests/unit/tutorThreadScope.test.js` with these assertions:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTutorArtifactFingerprint,
  buildTutorThreadId,
  buildTutorAuthoritySnapshot,
  normalizeTutorSessionId,
  targetScopeId
} from '../../shared/tutorThreadScope.js';

const baseArtifacts = {
  circuitSpec: {
    id: 'demo-led',
    title: 'LED demo',
    components: [{ id: 'led-1', partId: 'led-5mm', label: 'LED' }],
    connections: [{ id: 'c1', from: 'arduino:D9', to: 'led-1:A' }],
    behavior: { runText: 'LED on' }
  },
  validationReport: { status: 'valid', errors: [], warnings: [], validatedCurrentPathIds: ['led-forward-current'] },
  simulationPlan: {
    status: 'valid',
    runText: 'LED on',
    currentPaths: [{ id: 'led-forward-current', primitiveId: 'digital_on_off', through: ['arduino', 'resistor', 'led'] }]
  },
  buildRunnableReport: { runnable: true, reasons: [] },
  solverGateResult: { status: 'verified' },
  renderPlan: { title: 'LED demo', parts: [{ id: 'led-1' }], connections: [{ id: 'c1' }], warnings: [] },
  contextTrace: [{ sourceId: 'registry:part-capabilities:led-5mm' }]
};

test('artifact fingerprint uses visible tutor authority and sha256 prefix', async () => {
  const first = await buildTutorArtifactFingerprint(baseArtifacts);
  const changedRunText = await buildTutorArtifactFingerprint({
    ...baseArtifacts,
    simulationPlan: { ...baseArtifacts.simulationPlan, runText: 'LED blinking' }
  });
  const changedTrace = await buildTutorArtifactFingerprint({
    ...baseArtifacts,
    contextTrace: [{ sourceId: 'registry:part-capabilities:oled-i2c-096' }]
  });

  assert.match(first, /^afp-[a-f0-9]{16}$/);
  assert.notEqual(changedRunText, first);
  assert.notEqual(changedTrace, first);
});

test('thread id changes by target artifact locale and session', async () => {
  const artifactFingerprint = await buildTutorArtifactFingerprint(baseArtifacts);
  const ledTarget = { id: 'part:led-1', type: 'part', partId: 'led-1' };
  const resistorTarget = { id: 'part:r1', type: 'part', partId: 'r1' };

  const ledKo = buildTutorThreadId({
    sessionId: 'session-main',
    artifactFingerprint,
    targetId: targetScopeId(ledTarget),
    locale: 'ko'
  });
  const ledEn = buildTutorThreadId({
    sessionId: 'session-main',
    artifactFingerprint,
    targetId: targetScopeId(ledTarget),
    locale: 'en'
  });
  const resistorKo = buildTutorThreadId({
    sessionId: 'session-main',
    artifactFingerprint,
    targetId: targetScopeId(resistorTarget),
    locale: 'ko'
  });

  assert.match(ledKo, /^tutor\.session\.session-main\.artifact\.afp-[a-f0-9]{16}\.target\./);
  assert.notEqual(ledKo, ledEn);
  assert.notEqual(ledKo, resistorKo);
});

test('snapshot omits full raw artifact payload fields that are not tutor authority', () => {
  const snapshot = buildTutorAuthoritySnapshot({
    ...baseArtifacts,
    debugPrompt: 'raw prompt must not enter snapshot',
    rawAssistantText: 'raw assistant text must not enter snapshot'
  });
  const encoded = JSON.stringify(snapshot);

  assert.equal(encoded.includes('debugPrompt'), false);
  assert.equal(encoded.includes('rawAssistantText'), false);
  assert.equal(encoded.includes('registry:part-capabilities:led-5mm'), true);
});

test('session and target ids are normalized to safe bounded thread parts', () => {
  assert.equal(normalizeTutorSessionId(' session main!! '), 'session-main');
  assert.equal(targetScopeId({ id: 'part:LED 1', type: 'part' }), 'part-LED-1');
});
```

- [ ] **Step 2: Add RED tests for response-time fingerprint freshness**

Modify `tests/unit/tutorRequestFreshness.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTutorRequestKey, isFreshTutorResponse } from '../../src/tutorRequestFreshness.js';

test('freshness compares response-time current artifact fingerprint', () => {
  const requestKey = buildTutorRequestKey({
    targetId: 'part-led-1',
    artifactFingerprint: 'afp-request-a',
    locale: 'ko',
    sequence: 7
  });

  assert.equal(isFreshTutorResponse(requestKey, {
    targetId: 'part-led-1',
    artifactFingerprint: 'afp-current-b',
    locale: 'ko',
    sequence: 7
  }), false);
});

test('freshness falls back to artifact version only when no fingerprint exists', () => {
  const requestKey = buildTutorRequestKey({
    targetId: 'part-led-1',
    artifactVersion: 3,
    locale: 'ko',
    sequence: 2
  });

  assert.equal(isFreshTutorResponse(requestKey, {
    targetId: 'part-led-1',
    artifactVersion: 3,
    locale: 'ko',
    sequence: 2
  }), true);
});
```

- [ ] **Step 3: Run RED tests**

Run:

```powershell
node --test tests/unit/tutorThreadScope.test.js tests/unit/tutorRequestFreshness.test.js
```

Expected before implementation: FAIL because `shared/tutorThreadScope.js` does not exist and `buildTutorRequestKey(...)` does not accept `targetId`.

## Task 3: Implement Shared Tutor Scope Helpers

**Files:**
- Create: `shared/tutorThreadScope.js`
- Modify: `src/tutorRequestFreshness.js`
- Test: `tests/unit/tutorThreadScope.test.js`, `tests/unit/tutorRequestFreshness.test.js`

- [ ] **Step 1: Create `shared/tutorThreadScope.js`**

Implementation requirements:

```js
const MAX_THREAD_PART_CHARS = 120;

export function buildTutorAuthoritySnapshot(artifacts = {}) {
  const circuitSpec = artifacts.circuitSpec || {};
  const validationReport = artifacts.validationReport || {};
  const simulationPlan = artifacts.simulationPlan || {};
  const renderPlan = artifacts.renderPlan || {};
  const buildRunnableReport = artifacts.buildRunnableReport || {};
  const solverGateResult = artifacts.solverGateResult || {};

  return {
    circuit: {
      id: circuitSpec.id,
      title: circuitSpec.title,
      components: compactById(circuitSpec.components, ['id', 'partId', 'label', 'pins']),
      connections: compactById(circuitSpec.connections, ['id', 'from', 'to', 'source', 'target', 'net']),
      behavior: circuitSpec.behavior || null
    },
    render: {
      title: renderPlan.title,
      parts: compactById(renderPlan.parts, ['id', 'partId', 'label', 'type']),
      connections: compactById(renderPlan.connections, ['id', 'from', 'to', 'kind']),
      warnings: renderPlan.warnings || []
    },
    validation: {
      status: validationReport.status,
      errors: compactMessages(validationReport.errors),
      warnings: compactMessages(validationReport.warnings),
      validatedCurrentPathIds: validationReport.validatedCurrentPathIds || []
    },
    simulation: {
      status: simulationPlan.status,
      runText: simulationPlan.runText || '',
      currentPaths: compactById(simulationPlan.currentPaths, ['id', 'kind', 'label', 'primitiveId', 'through'])
    },
    build: {
      runnable: buildRunnableReport.runnable,
      reasons: buildRunnableReport.reasons || []
    },
    solver: {
      status: solverGateResult.status,
      verified: solverGateResult.verified,
      notVerified: solverGateResult.notVerified || []
    },
    contextSourceIds: (artifacts.contextTrace || []).map((entry) => entry.sourceId).filter(Boolean).sort()
  };
}

export async function buildTutorArtifactFingerprint(artifacts = {}) {
  const digest = await sha256Hex(stableStringify(buildTutorAuthoritySnapshot(artifacts)));
  return `afp-${digest.slice(0, 16)}`;
}

export function normalizeTutorSessionId(value, fallback = 'session-local') {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return encodeThreadPart(raw) || fallback;
}

export function targetScopeId(target) {
  const raw = target?.id || `${target?.type || 'target'}:${target?.connectionId || target?.partId || 'whole-circuit'}`;
  return encodeThreadPart(raw) || 'target-none';
}

export function buildTutorThreadId({ sessionId, artifactFingerprint, targetId, locale }) {
  return [
    'tutor',
    'session',
    normalizeTutorSessionId(sessionId),
    'artifact',
    encodeThreadPart(artifactFingerprint || 'afp-none'),
    'target',
    encodeThreadPart(targetId || 'target-none'),
    'locale',
    locale === 'en' ? 'en' : 'ko'
  ].join('.');
}

export function encodeThreadPart(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_THREAD_PART_CHARS);
}

function compactById(items, fields) {
  return Array.isArray(items)
    ? items.map((item) => pickFields(item, fields)).sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))
    : [];
}

function compactMessages(items) {
  return Array.isArray(items)
    ? items.map((item) => typeof item === 'string' ? item : pickFields(item, ['code', 'message', 'path', 'id']))
    : [];
}

function pickFields(value, fields) {
  const output = {};
  for (const field of fields) {
    if (value && Object.prototype.hasOwnProperty.call(value, field)) {
      output[field] = value[field];
    }
  }
  return output;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 2: Update freshness helper**

Modify `src/tutorRequestFreshness.js`:

```js
export function buildTutorRequestKey({ target, targetId, artifactVersion, artifactFingerprint, locale, sequence }) {
  const resolvedTargetId = targetId || target?.id || 'target:none';
  const resolvedArtifact = artifactFingerprint || `version:${Number.isFinite(artifactVersion) ? artifactVersion : 0}`;
  return [
    resolvedTargetId,
    resolvedArtifact,
    locale || 'ko',
    Number.isFinite(sequence) ? sequence : 0
  ].join('|');
}

export function isFreshTutorResponse(requestKey, current) {
  return requestKey === buildTutorRequestKey(current);
}
```

- [ ] **Step 3: Run GREEN tests**

Run:

```powershell
node --test tests/unit/tutorThreadScope.test.js tests/unit/tutorRequestFreshness.test.js
```

Expected: PASS.

## Task 4: Add Client Scope Contract For Tutor Drawer And Main Chat

**Files:**
- Modify: `src/circuitTutorClient.js`
- Modify: `src/main.js`
- Modify: `tests/unit/circuitTutorClient.test.js`
- Test: `tests/unit/circuitTutorClient.test.js`

- [ ] **Step 1: Add client request/response contract tests**

Add assertions in `tests/unit/circuitTutorClient.test.js`:

```js
assert.equal(requestBody.sessionId, 'session-main');
assert.equal(requestBody.artifactFingerprint, 'afp-client');
assert.equal(requestBody.targetScopeId, 'part-led-1');
assert.equal(response.tutorThreadId, 'tutor.session.session-main.artifact.afp-client.target.part-led-1.locale.ko');
assert.equal(response.structuredOutputStatus, 'native');
```

Add a parser test:

```js
assert.throws(() => parseTutorResponseForTest({
  sessionId: 's',
  mode: 'live',
  servingStatus: 'live_tutor_answer',
  message: 'x',
  grounding: [],
  suggestedQuestions: [],
  structuredOutputStatus: 'raw-text'
}), /structured output status/);
```

- [ ] **Step 2: Extend `askCircuitTutor(...)` without breaking API base behavior**

Modify `src/circuitTutorClient.js` signature to accept:

```js
sessionId,
artifactFingerprint,
targetScopeId
```

Include those fields in the JSON body. Keep these existing behaviors unchanged:

- `tutorEndpoint()` still calls `agentApiUrl('/api/agent/explain-target')`.
- `serverReachability` remains endpoint-aware.
- `hEduwareTutorServer=disabled` still returns local tutor response.

- [ ] **Step 3: Preserve new response fields in parser**

Accept these response fields:

```js
tutorThreadId: string, optional, max 520
artifactFingerprint: string, optional, max 160
targetScopeId: string, optional, max 160
structuredOutputStatus: one of native, recovered_tool_call, recovered_json_text, recovered_assistant_text, not_used, failed
```

The parser must still trim `message` and redact `fallbackReason`.

- [ ] **Step 4: Apply scoped request building in `submitTutorQuestion(...)`**

In `src/main.js`, import shared helpers:

```js
import {
  buildTutorArtifactFingerprint,
  buildTutorThreadId,
  normalizeTutorSessionId,
  targetScopeId
} from '../shared/tutorThreadScope.js';
```

Before sending the tutor request:

```js
state.agentSessionId = normalizeTutorSessionId(state.agentSessionId, createClientId('session'));
const artifactFingerprint = await buildTutorArtifactFingerprint(currentTutorArtifacts(circuit));
const selectedTargetScopeId = targetScopeId(target);
const requestKey = buildTutorRequestKey({
  targetId: selectedTargetScopeId,
  artifactFingerprint,
  locale: state.locale,
  sequence
});
```

At response time, recompute from the currently visible circuit:

```js
const currentCircuit = currentCircuitForTutor();
const currentFingerprint = currentCircuit
  ? await buildTutorArtifactFingerprint(currentTutorArtifacts(currentCircuit))
  : 'afp-none';

if (!isFreshTutorResponse(requestKey, {
  targetId: targetScopeId(currentInspectorTarget()),
  artifactFingerprint: currentFingerprint,
  locale: state.locale,
  sequence: state.inspector.tutorRequestSequence
})) {
  state.inspector.tutorThinking = false;
  renderInspectorPanel();
  return;
}
```

- [ ] **Step 5: Define main-chat current-artifact QA policy**

In `answerCurrentArtifactQuestion(...)`, use the same scope fields but do not share the right-side selected-target thread unless it is answering the same selected target. Use target id `main-artifact-question` for whole-artifact main-chat QA:

```js
targetScopeId({ id: 'main-artifact-question', type: 'circuit' })
```

Add a unit or e2e request assertion that main-chat artifact QA sends a scope and discards stale artifact responses.

- [ ] **Step 6: Run focused client tests**

Run:

```powershell
node --test tests/unit/circuitTutorClient.test.js tests/unit/tutorRequestFreshness.test.js tests/unit/tutorThreadScope.test.js
```

Expected: PASS.

## Task 5: Extract Shared Scoped Context Projection Reader

**Files:**
- Create: `server/context/scopedContextReader.ts`
- Modify: `server/agent/deepAgentTools.ts`
- Create: `tests/unit/scopedContextReader.test.ts`
- Test: `tests/unit/scopedContextReader.test.ts`

- [ ] **Step 1: Add RED tests for item-level projection**

Create `tests/unit/scopedContextReader.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { readScopedContextSource } from '../../server/context/scopedContextReader.ts';

test('part capability source returns only the requested part projection', async () => {
  const raw = await readScopedContextSource('registry:part-capabilities:led-5mm', {
    allowedSourceIds: ['registry:part-capabilities:led-5mm']
  });
  const parsed = JSON.parse(raw);

  assert.equal(parsed.sourceId, 'registry:part-capabilities:led-5mm');
  assert.equal(parsed.kind, 'part-capability');
  assert.equal(parsed.item.id, 'led-5mm');
  assert.equal(JSON.stringify(parsed).includes('oled-i2c-096'), false);
});

test('simulation primitive source returns only the requested primitive projection', async () => {
  const raw = await readScopedContextSource('data:simulation-primitives:display_static_text', {
    allowedSourceIds: ['data:simulation-primitives:display_static_text']
  });
  const parsed = JSON.parse(raw);

  assert.equal(parsed.sourceId, 'data:simulation-primitives:display_static_text');
  assert.equal(parsed.kind, 'simulation-primitive');
  assert.equal(parsed.item.id, 'display_static_text');
  assert.equal(JSON.stringify(parsed).includes('digital_on_off'), false);
});

test('unlisted context source is denied before resolving aliases', async () => {
  const raw = await readScopedContextSource('registry:part-capabilities:oled-i2c-096', {
    allowedSourceIds: ['registry:part-capabilities:led-5mm']
  });
  const parsed = JSON.parse(raw);

  assert.equal(parsed.error, 'CONTEXT_DOC_NOT_IN_SCOPE');
});
```

- [ ] **Step 2: Implement projection reader**

Create `server/context/scopedContextReader.ts` with these exported functions:

```ts
export type ScopedContextReaderOptions = {
  allowedSourceIds: string[];
  allowUnscopedContext?: boolean;
};

export async function loadScopedContextIndex(options: ScopedContextReaderOptions): Promise<ContextIndex>;
export async function readScopedContextSource(id: string, options: ScopedContextReaderOptions): Promise<string>;
```

Implementation rules:

- If `allowUnscopedContext` is true, preserve existing main-agent behavior.
- If `id` is not exactly present in `allowedSourceIds`, return JSON error `CONTEXT_DOC_NOT_IN_SCOPE` before resolving aliases.
- If `id` starts with `registry:part-capabilities:`, load `getPartRegistry()` and return only the matching part record.
- If `id` starts with `data:simulation-primitives:`, load `loadSimulationPrimitives()` and return only the matching primitive record.
- If `id` starts with `bundle:`, call `loadContextBundleV2(...)` only when the exact bundle id is allowed.
- If `id` starts with `sources:support-bundle:`, return the matching support-bundle evidence projection only when exact id is allowed.
- For aggregate ids without item suffix, use the existing bounded index behavior and keep the response compact.
- Return JSON errors, not thrown errors, for out-of-scope and missing item cases.

- [ ] **Step 3: Refactor `deepAgentTools.ts` to use the shared reader**

Replace private `loadContextIndexBounded(...)`, `readContextDocBounded(...)`, and bundle read duplication with imports:

```ts
import {
  loadScopedContextIndex,
  readScopedContextSource
} from '../context/scopedContextReader.ts';
```

The main-agent tool names and outputs must remain compatible.

- [ ] **Step 4: Run scoped reader and existing deep tools tests**

Run:

```powershell
npm exec tsx -- --test tests/unit/scopedContextReader.test.ts
npm test -- --grep "context"
```

Expected: PASS.

## Task 6: Add Thin Tutor Context Tools

**Files:**
- Create: `server/agent/tutorContextTools.ts`
- Create: `tests/unit/tutorContextTools.test.ts`
- Test: `tests/unit/tutorContextTools.test.ts`

- [ ] **Step 1: Add RED tests for tutor tool wrapper**

Create `tests/unit/tutorContextTools.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { createTutorContextTools } from '../../server/agent/tutorContextTools.ts';

test('tutor tools list selected-target scoped source ids and read projections', async () => {
  const tools = createTutorContextTools({
    allowedSourceIds: ['registry:part-capabilities:led-5mm'],
    componentPartIds: ['led-5mm'],
    simulationPrimitiveIds: []
  });

  const listTool = tools.find((tool) => tool.name === 'list_tutor_context_sources');
  const readTool = tools.find((tool) => tool.name === 'read_tutor_context_doc');

  const index = JSON.parse(await listTool.invoke({}));
  assert.deepEqual(index.allowedSourceIds, ['registry:part-capabilities:led-5mm']);

  const allowed = JSON.parse(await readTool.invoke({ id: 'registry:part-capabilities:led-5mm' }));
  assert.equal(allowed.item.id, 'led-5mm');

  const denied = JSON.parse(await readTool.invoke({ id: 'registry:part-capabilities:oled-i2c-096' }));
  assert.equal(denied.error, 'CONTEXT_DOC_NOT_IN_SCOPE');
});
```

- [ ] **Step 2: Implement the wrapper**

Create `server/agent/tutorContextTools.ts`:

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { readScopedContextSource } from '../context/scopedContextReader.ts';

export function createTutorContextTools({
  allowedSourceIds,
  componentPartIds,
  simulationPrimitiveIds
}: {
  allowedSourceIds: string[];
  componentPartIds: string[];
  simulationPrimitiveIds: string[];
}) {
  return [
    tool(async () => JSON.stringify({
      allowedSourceIds,
      componentPartIds,
      simulationPrimitiveIds
    }, null, 2), {
      name: 'list_tutor_context_sources',
      description: 'List current selected-target context source ids the tutor may cite.',
      schema: z.object({})
    }),
    tool(async ({ id }) => readScopedContextSource(id, { allowedSourceIds }), {
      name: 'read_tutor_context_doc',
      description: 'Read one selected-target context source projection. Item-level ids return only one item.',
      schema: z.object({ id: z.string().min(1).max(240) })
    })
  ];
}
```

- [ ] **Step 3: Run tests**

Run:

```powershell
npm exec tsx -- --test tests/unit/tutorContextTools.test.ts tests/unit/scopedContextReader.test.ts
```

Expected: PASS.

## Task 7: Add Server Scope Resolver And Response Schema

**Files:**
- Modify: `server/agent/schemas.ts`
- Create: `server/agent/tutorThreadScope.ts`
- Modify: `tests/unit/circuitTutor.test.ts`
- Test: `tests/unit/circuitTutor.test.ts`

- [ ] **Step 1: Extend schema**

Add request fields:

```ts
artifactFingerprint: z.string().min(1).max(160).optional(),
targetScopeId: z.string().min(1).max(160).optional(),
```

Add response fields:

```ts
tutorThreadId: z.string().min(1).max(520).optional(),
artifactFingerprint: z.string().min(1).max(160).optional(),
targetScopeId: z.string().min(1).max(160).optional(),
structuredOutputStatus: z.enum([
  'native',
  'recovered_tool_call',
  'recovered_json_text',
  'recovered_assistant_text',
  'not_used',
  'failed'
]).optional(),
```

- [ ] **Step 2: Implement server resolver**

Create `server/agent/tutorThreadScope.ts`:

```ts
import {
  buildTutorArtifactFingerprint,
  buildTutorThreadId,
  normalizeTutorSessionId,
  targetScopeId
} from '../../shared/tutorThreadScope.js';
import type { TutorMessageRequest } from './schemas.ts';

export type ResolvedTutorThreadScope = {
  sessionId: string;
  artifactFingerprint: string;
  targetScopeId: string;
  tutorThreadId: string;
  clientArtifactFingerprintMismatch: boolean;
  clientTargetScopeIdMismatch: boolean;
};

export async function resolveTutorThreadScope(request: TutorMessageRequest): Promise<ResolvedTutorThreadScope> {
  const sessionId = normalizeTutorSessionId(request.sessionId, 'session-server');
  const artifactFingerprint = await buildTutorArtifactFingerprint(request.artifacts);
  const resolvedTargetScopeId = targetScopeId(request.target);

  return {
    sessionId,
    artifactFingerprint,
    targetScopeId: resolvedTargetScopeId,
    tutorThreadId: buildTutorThreadId({
      sessionId,
      artifactFingerprint,
      targetId: resolvedTargetScopeId,
      locale: request.locale
    }),
    clientArtifactFingerprintMismatch: Boolean(request.artifactFingerprint && request.artifactFingerprint !== artifactFingerprint),
    clientTargetScopeIdMismatch: Boolean(request.targetScopeId && request.targetScopeId !== resolvedTargetScopeId)
  };
}
```

- [ ] **Step 3: Add resolver tests**

In `tests/unit/circuitTutor.test.ts`, assert:

```ts
const scoped = await resolveTutorThreadScope(TutorMessageRequestSchema.parse({
  ...request,
  sessionId: 'session-main',
  artifactFingerprint: 'afp-client-stale',
  targetScopeId: 'spoofed-target'
}));

assert.equal(scoped.clientArtifactFingerprintMismatch, true);
assert.equal(scoped.clientTargetScopeIdMismatch, true);
assert.notEqual(scoped.artifactFingerprint, 'afp-client-stale');
assert.notEqual(scoped.targetScopeId, 'spoofed-target');
assert.match(scoped.tutorThreadId, /^tutor\.session\.session-main\.artifact\.afp-[a-f0-9]{16}\.target\./);
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm exec tsx -- --test tests/unit/circuitTutor.test.ts
```

Expected: PASS.

## Task 8: Make Live Tutor Framework-Native And Stateful

**Files:**
- Modify: `server/agent/circuitTutor.ts`
- Modify: `tests/unit/circuitTutor.test.ts`
- Test: `tests/unit/circuitTutor.test.ts`

- [ ] **Step 1: Add tests for all response paths echoing scope**

Add unit tests that verify `tutorThreadId`, `artifactFingerprint`, and `targetScopeId` exist for:

- local mode
- live success
- live configured but structured output failed
- live configured but transport/model failure fallback

Each test must assert no raw assistant text is returned in `fallbackReason`.

- [ ] **Step 2: Add DeepAgent invocation contract test**

Use a fake `deepAgentFactory` and fake checkpointer. Assert the factory receives:

```ts
config.checkpointer === checkpointer
config.tools.some((tool) => tool.name === 'list_tutor_context_sources')
config.tools.some((tool) => tool.name === 'read_tutor_context_doc')
config.responseFormat is defined
```

Assert invoke config uses:

```ts
configurable: { thread_id: response.tutorThreadId }
```

Name this test `live tutor passes checkpointer and scoped thread id to DeepAgent`. Do not name it as proof that memory persists; fake agents only verify the invocation contract.

- [ ] **Step 3: Add model capability guard**

In `server/agent/circuitTutor.ts`, choose response format as follows:

- If context tools are enabled and selected model profile is known to support simultaneous tools plus structured output, use `providerStrategy(LiveTutorDraftSchema)`.
- If the selected model supports tool calling but simultaneous native structured output is unknown, use `toolStrategy(LiveTutorDraftSchema)`.
- If neither capability is clear, disable tutor context tools for that request and use `providerStrategy(LiveTutorDraftSchema)` only when native structured output is supported.

Log the selected strategy as one of:

```text
provider_with_tools
tool_strategy_with_tools
provider_without_tools
local_fallback_capability_unknown
```

- [ ] **Step 4: Add checkpointer and no-cache invariant**

Use:

```ts
import { MemorySaver } from '@langchain/langgraph';
```

Create one module-level test/local checkpointer:

```ts
const tutorConversationCheckpointer = new MemorySaver();
```

Do not cache DeepAgent instances across different `tutorThreadId`, current artifact snapshot, tool allowlist, or locale. The current context goes into the per-request system prompt and scoped tools, so agent instance caching would create stale system prompts.

- [ ] **Step 5: Avoid checkpointing full artifacts**

The user message sent to the agent should include only:

```text
student question
selected target label/id
running flag
```

Current artifact facts go into the system prompt as a compact authority snapshot. Full `request.artifacts` must not be serialized into a checkpointed user message.

- [ ] **Step 6: Run tests**

Run:

```powershell
npm exec tsx -- --test tests/unit/circuitTutor.test.ts tests/unit/tutorContextTools.test.ts tests/unit/agentLogger.test.ts
```

Expected: PASS.

## Task 9: Structured Output Recovery Classification And Logging

**Files:**
- Modify: `server/agent/circuitTutor.ts`
- Modify: `server/agent/agentLogger.ts`
- Modify: `tests/unit/circuitTutor.test.ts`
- Modify: `tests/unit/agentLogger.test.ts`
- Test: `tests/unit/circuitTutor.test.ts`, `tests/unit/agentLogger.test.ts`

- [ ] **Step 1: Add parser status tests**

Test cases:

```ts
assert.equal(parseLiveTutorDraftWithStatus({ structuredResponse: validDraft }).structuredOutputStatus, 'native');
assert.equal(parseLiveTutorDraftWithStatus({ messages: [assistantToolCallMessage] }).structuredOutputStatus, 'recovered_tool_call');
assert.equal(parseLiveTutorDraftWithStatus({ messages: [assistantJsonTextMessage] }).structuredOutputStatus, 'recovered_json_text');
assert.equal(parseLiveTutorDraftWithStatus({ messages: [assistantPlainTextMessage] }).structuredOutputStatus, 'recovered_assistant_text');
```

- [ ] **Step 2: Log status without raw text**

`agentLogger.ts` must include:

```ts
structuredOutputStatus
tutorThreadIdHash
artifactFingerprint
targetScopeId
clientArtifactFingerprintMismatch
clientTargetScopeIdMismatch
fallbackCategory
```

The log summary must not include raw `message`, raw assistant content, API keys, or full artifacts.

- [ ] **Step 3: Run logging tests**

Run:

```powershell
npm exec tsx -- --test tests/unit/circuitTutor.test.ts tests/unit/agentLogger.test.ts
```

Expected: PASS and redaction tests confirm secrets and raw assistant content are absent.

## Task 10: UI/E2E Trajectory Coverage

**Files:**
- Modify: `tests/e2e/features.spec.js`
- Test: `tests/e2e/features.spec.js`

- [ ] **Step 1: Add two-turn tutor follow-up e2e**

Mock `/api/agent/explain-target`. Record both request bodies.

Assertions:

```js
expect(tutorRequests[1].question.length).toBeLessThan(20);
expect(tutorRequests[1].sessionId).toBe(tutorRequests[0].sessionId);
expect(tutorRequests[1].artifactFingerprint).toBe(tutorRequests[0].artifactFingerprint);
expect(tutorRequests[1].targetScopeId).toBe(tutorRequests[0].targetScopeId);
await expect(page.getByTestId('tutor-status').last()).toHaveAttribute('data-status', 'live_tutor_answer');
```

- [ ] **Step 2: Add selected target switch stale e2e**

Flow:

1. Ask tutor on selected target A.
2. Switch to target B with the target selector before route fulfillment.
3. Fulfill target A response.
4. Assert target A response is not appended under target B.
5. Assert tutor spinner/thinking state is cleared.

- [ ] **Step 3: Add `stepCurrentFlow()` stale e2e**

Flow:

1. Ask tutor.
2. Trigger the flow step control that calls `stepCurrentFlow()`.
3. Fulfill the old response.
4. Assert the old response is ignored and no spinner remains.

- [ ] **Step 4: Add artifact replacement stale e2e**

Flow:

1. Ask tutor on artifact A.
2. Create or mock artifact B before A response resolves.
3. Fulfill A response.
4. Assert A response is ignored after B is visible.

- [ ] **Step 5: Add main-chat current-artifact QA e2e**

Flow:

1. Ask a current-artifact question through main chat.
2. Assert request includes `sessionId`, `artifactFingerprint`, and `targetScopeId`.
3. Replace artifact before response resolves.
4. Assert stale response is not appended to main chat.

- [ ] **Step 6: Preserve Railway/API base behavior**

Route assertions must confirm tutor requests still target:

```text
<configured hEduwareAgentApiBase>/api/agent/explain-target
```

and disabling localStorage key `hEduwareTutorServer=disabled` still bypasses server fetch.

- [ ] **Step 7: Run targeted e2e**

Run:

```powershell
npm run test:e2e -- tests/e2e/features.spec.js --grep "tutor"
```

Expected: PASS without live API credentials.

## Task 11: Server Health And Railway Observability

**Files:**
- Modify: `server/serverHealth.ts`
- Modify: `tests/unit/serverHealth.test.ts`
- Test: `tests/unit/serverHealth.test.ts`

- [ ] **Step 1: Add source freshness probes**

Add these files to `DEFAULT_SOURCE_FILES`:

```ts
{ id: 'agent:tutor-thread-scope', path: fileURLToPath(new URL('./agent/tutorThreadScope.ts', import.meta.url)) },
{ id: 'agent:tutor-context-tools', path: fileURLToPath(new URL('./agent/tutorContextTools.ts', import.meta.url)) },
{ id: 'context:scoped-context-reader', path: fileURLToPath(new URL('./context/scopedContextReader.ts', import.meta.url)) }
```

- [ ] **Step 2: Add health test**

In `tests/unit/serverHealth.test.ts`, assert source freshness includes the new ids and reports stale when their mtime is newer than server start.

- [ ] **Step 3: Define Railway smoke evidence**

The optional live/Railway smoke checklist is:

```text
GET /api/agent/health -> sourceStatus.stale=false
POST /api/agent/message -> live or observable fallback with redacted category
POST /api/agent/explain-target -> live_tutor_answer or live_tutor_fallback with fallbackCategory
frontend main and tutor calls use the same configured API base
logs include traceId/sessionId/tutorThreadIdHash/artifactFingerprint/targetScopeId/fallbackCategory/structuredOutputStatus
logs do not include API keys, raw prompts, raw assistant text, or full artifact JSON
```

- [ ] **Step 4: Run health tests**

Run:

```powershell
npm exec tsx -- --test tests/unit/serverHealth.test.ts tests/unit/agentLogger.test.ts
```

Expected: PASS.

## Task 12: Documentation Updates

**Files:**
- Modify: `docs/agent-tutor-serving-workflow.md`
- Modify: `docs/agent-request-to-simulation-workflow.md`
- Modify: `docs/README.md`
- Test: documentation scan

- [ ] **Step 1: Update tutor workflow doc**

Replace stateless-tutor wording with:

```markdown
Live tutor mode is a scoped stateful Deep Agent QA run. It uses LangChain structured output, a LangGraph checkpointer, and a thread id scoped by session, artifact fingerprint, selected target, and locale.

The checkpointer owns short-term conversation continuity only. Current circuit facts come from the current request authority snapshot and scoped context tools. UI-visible chat messages are render/debug state.
```

- [ ] **Step 2: Update context lookup rule**

Add:

```markdown
Tutor context-layer access is read-only and projection-scoped. Item-level source ids such as `registry:part-capabilities:<id>` and `data:simulation-primitives:<id>` return only that selected item. Tutor must not read aggregate context documents as authority for one item-level trace id.
```

- [ ] **Step 3: Update workflow doc**

Add to `docs/agent-request-to-simulation-workflow.md`:

```markdown
Tutor memory follows the same framework ownership rule as main agent memory: LangGraph checkpointer plus scoped `thread_id`. Tutor scope additionally includes artifact fingerprint and selected target id so answers from one visual artifact or target cannot bleed into another.
```

- [ ] **Step 4: Update docs index**

Add this plan under active plans in `docs/README.md` and remove stale links to missing context architecture docs if Task 1 corrected them.

- [ ] **Step 5: Run documentation scan**

Run:

```powershell
rg -n "stateless typed DeepAgent|checkpointer memory to tutor|raw aggregate document reader" docs server -g "!plans/PLAN_tutor_context_layer_memory_robustness.md"
```

Expected: no stale tutor plan/docs statement tells workers to keep tutor stateless or to read aggregate docs for item-level tutor sources.

## Task 13: Verification Gate

**Files:**
- No additional files beyond prior tasks.
- Test: full acceptance commands.

- [ ] **Step 1: Run focused unit tests**

```powershell
node --test tests/unit/tutorThreadScope.test.js tests/unit/tutorRequestFreshness.test.js tests/unit/circuitTutorClient.test.js
npm exec tsx -- --test tests/unit/scopedContextReader.test.ts tests/unit/tutorContextTools.test.ts tests/unit/circuitTutor.test.ts tests/unit/agentLogger.test.ts tests/unit/serverHealth.test.ts
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 2: Run default acceptance gate**

```powershell
npm test
npm run build
npm run test:e2e
npm run check
```

Expected: all PASS without live OpenAI credentials.

- [ ] **Step 3: Run optional live smoke only when credentials exist**

```powershell
npm run check:live
```

Expected without credentials: skip cleanly. Expected with credentials: live tutor returns `live_tutor_answer` or `live_tutor_fallback` with redacted `fallbackCategory`, `structuredOutputStatus`, and scope evidence.

## Risk Register

| Risk | Failure Mode | Mitigation |
| --- | --- | --- |
| Context overread | Tutor sees aggregate registry data from one item-level source id | Shared scoped projection reader, item-level tests for part and primitive ids |
| Stale artifact response | Response for artifact A appears under artifact B | Response-time fingerprint recomputation and e2e delayed response tests |
| Target memory bleed | Spoofed or stale `targetScopeId` chooses wrong thread | Server recomputes target scope and logs mismatch only |
| Model capability mismatch | `tools + providerStrategy` fails or silently drops structured output | Capability guard with `toolStrategy` or no-tools fallback |
| Recovery hides framework failure | Live answer appears native when it was recovered | `structuredOutputStatus` on response/logs and tests for each recovery path |
| Full artifacts checkpointed | Old artifact facts influence follow-up | User message contains question/target/running only; compact authority snapshot goes into per-request system prompt |
| Agent instance cache staleness | Cached system prompt or tools use previous artifact | No DeepAgent instance cache across scope/current context |
| Railway stale server | Deployed server runs old source | Source freshness probes for new files and Railway smoke evidence |
| Production memory loss | `MemorySaver` loses continuity on restart | Injectable checkpointer seam; production durable saver is configured separately from default tests |

## Acceptance Criteria

- Same session, artifact fingerprint, selected target, and locale reuse the same tutor `thread_id`.
- Changing session, artifact fingerprint, selected target, or locale changes tutor `thread_id`.
- Server recomputes artifact fingerprint and target scope; client mismatches are logged but not trusted.
- UI stale guards recompute current artifact fingerprint at response time.
- Short follow-up tutor turns work in mocked e2e without manual `recentTurns` as authoritative memory.
- Main-chat current-artifact QA has an explicit scope and stale response guard.
- Tutor context reads are projection-scoped and cannot overread aggregate part/primitive docs.
- Local, live success, and live fallback responses all echo scope fields.
- Native and recovered structured output are distinguishable.
- New server files participate in source freshness health.
- `npm run check` passes without live credentials.

## Review Log

Five subagents reviewed the previous draft. Consensus verdict: `REVISE`.

- Dependency/native SDK review: approved the framework-native direction but required a capability guard for `tools + providerStrategy`, server-side `targetScopeId` recomputation, response-time fingerprint recomputation, and no DeepAgent instance cache across changing current context.
- Architecture review: blocked the old draft because it reused request-time fingerprint in the freshness example and allowed item-level source ids to resolve to aggregate docs.
- Test strategy review: required RED tests for aggregate overread, malformed scope fields, fallback scope echo, parser preservation of new fields, delayed stale responses, and request-body assertions.
- Trajectory/debug review: required coverage for main chat artifact QA, `stepCurrentFlow()` target changes, Railway API base behavior, source freshness probes, and smoke evidence.
- Adversarial critic review: required SHA-256 authority snapshots, shared bounded context reader extraction instead of bespoke tutor reader logic, memory retention/no-cache policy, and correction of missing context architecture anchors.

This revised plan integrates those required changes and is the only active tutor robustness plan.

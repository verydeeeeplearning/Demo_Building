# Chat UI + Context Layer Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent unsupported or unknown hardware from being silently served as build-ready simulation while keeping the main synthesis chat and right-side tutor chat observable, contract-safe, and LangChain-ecosystem-native where live LLM paths are used.

**Architecture:** Keep the approved hybrid architecture. The main requirement-to-simulation chat remains a stateful DeepAgents/LangGraph workflow. The right-side tutor is now live-first `auto` mode through the server when live configuration is present, with deterministic local evidence kept as explicit local mode or observable fallback until measured multi-turn value justifies checkpointer-backed tutor memory. The context layer becomes the authoritative request gate before any UI copy, tool call, or simulation output can imply build readiness.

**Tech Stack:** Vanilla JS, Vite, three.js, Node test runner, TypeScript, Zod, LangChain JS, LangGraph, Deep Agents, LangSmith optional tracing.

---

## Evidence Inputs

- `docs/audit/CONTEXT_LAYER_ANALYSIS_2026-06-04.md`
- `.omx/context/chat-ui-serving-langchain-ecosystem-20260604T033037Z.md`
- `docs/agent-request-to-simulation-workflow.md`
- `docs/agent-observability-logging.md`
- Official docs to re-check before framework-dependent implementation:
  - Deep Agents customization: `https://docs.langchain.com/oss/javascript/deepagents/customization`
  - LangGraph memory: `https://docs.langchain.com/oss/javascript/langgraph/add-memory`
  - LangGraph interrupts: `https://docs.langchain.com/oss/javascript/langgraph/interrupts`
  - LangChain structured output: `https://docs.langchain.com/oss/javascript/langchain/structured-output`
  - LangChain middleware: `https://docs.langchain.com/oss/javascript/langchain/middleware/custom`
  - LangSmith tracing metadata: `https://docs.langchain.com/langsmith/trace-with-langchain`

## Baseline Serving Map Before Refactor

This section records the historical baseline that motivated the refactor. The
current right-side tutor serving contract is superseded by
`docs/plans/PLAN_tutor_always_live_serving.md` and
`docs/agent-tutor-serving-workflow.md`.

### Main Chat UI

1. `src/main.js:1433` `submitAgentMessage()`.
2. `src/conversationRouting.js` classifies confirm, revise, clarify, and current-artifact turns.
3. `src/aiClient.js:42` posts to `POST /api/agent/message`.
4. `server/index.ts:45` parses `AgentMessageRequestSchema`, creates a trace id, logs request/response/failure, and calls `runAgent()`.
5. `server/agent/deepAgentRuntime.ts:7` uses `createDeepAgent`, `toolStrategy`, LangGraph `MemorySaver`, and `Command({ resume })`.
6. `server/context/contextPacket.ts` builds route, bundle, candidate, support, coverage, prompt, and trace data.
7. Server finalization validates, applies candidate/context gates, builds netlist/current/render/simulation artifacts.
8. Frontend grounds artifacts and only then enables confirm/run/render paths.

### Right-Side Tutor Chat UI

1. `src/main.js:1100` `renderCircuitChatDrawer()`.
2. Drawer rendered selected part/connection/circuit target and static `target.questions`.
3. `src/main.js:2208` `submitTutorQuestion()`.
4. Previously, `src/circuitTutorClient.js` returned local deterministic
   `answerTutorQuestion()` by default.
5. Previously, `localStorage.hEduwareAgentServer === "enabled"` was required
   before the client posted to `POST /api/agent/explain-target`.
6. The server live path used `createDeepAgent + toolStrategy(LiveTutorDraftSchema)`
   without checkpointer/middleware.
7. Previously, the UI rendered only `response.message`; it did not consume
   `response.suggestedQuestions` or expose fallback mode.

## ADR

**Decision:** Keep Option A, the hybrid model.

- Main synthesis chat: stateful DeepAgents/LangGraph workflow with checkpointer and `thread_id`.
- Right tutor chat: server-controlled live-first `auto` mode when configured,
  deterministic fallback/local mode otherwise, and stateless typed DeepAgent QA
  for live mode.
- Tutor becomes checkpointer-backed stateful LangGraph only after tests or product evidence show multi-turn tutor memory materially improves learning outcomes.

**Alternatives Considered:**

- Full unification: consistent architecture, but adds latency, persistence, privacy, and eval cost to a selected-target QA surface.
- Rule-only tutor: simpler and reliable, but loses adaptive explanations and live eval path.

**Consequences:**

- The context layer must be stricter before synthesis eligibility.
- Tool scope must be fail-closed for live LLM paths.
- UI must distinguish buildable original requests from safe equivalents, unsupported requests, review-only diagnostics, and local tutor answers.

## Verified Refactor State

Last verified: 2026-06-04.

- Main chat now derives and returns `servingStatus` from server authority, and
  the UI gates confirm/build/run behavior for non-buildable statuses.
- Unknown explicit hardware near hardware nouns is a context support gap and
  cannot silently become build-ready synthesis.
- `supported-hardware-general` is a minimal policy/graph fallback and cannot
  authorize build-ready synthesis without complete bundle evidence or topology
  composition proof.
- Live agent tools are fail-closed unless they receive scoped `ContextPacket`
  candidates, allowed source ids, and support evidence.
- Tutor chat now calls the server by default; live server mode validates the
  response schema, exposes local/live/fallback status, sends artifact gates, and
  refreshes suggested questions from valid server responses.
- `/api/agent/explain-target` now emits `tutor.request.received`,
  `tutor.response.sent`, and `tutor.request.failed` logs with redacted
  fallback/error summaries and answer hashes instead of raw tutor answers.
- Default acceptance includes context acceptance and remains independent of live
  OpenAI credentials. Live smoke remains opt-in through `npm run check:live`.

## Ownership Matrix

| Concern | Owner | Rule |
| --- | --- | --- |
| Conversation continuity | LangGraph checkpointer + `thread_id` | Do not replace with manual `recentTurns` summary. |
| UI artifact grounding | `conversationContext` | Bounded, untrusted artifact/UI handoff only. |
| Synthesis authority | `ContextPacket` | Route, bundle, candidate part, source, support, coverage, and eligibility authority. |
| Tool permission | Scoped `createHeduwareAgentTools` options | Missing scope blocks live tools; empty candidate list means no buildable parts. |
| Tutor grounding | Selected target + circuit artifacts | Tutor may explain only selected target, validation, simulation, and context evidence. |
| Observability | `agentLogger` + LangSmith metadata | Store ids, hashes, modes, routes, and status. Do not store secrets or raw prompts locally. |

## File Structure

- Modify `server/context/contextPacket.ts`
  - Detect unresolved named hardware.
  - Add unknown hardware to ambiguity/support gaps before synthesis eligibility.
  - Mark broad fallback routes as clarification/context-gap unless bundle or composition proof is complete.
  - Expose provenance fields for route, bundle, candidate, and unknown hardware.

- Create `server/context/unresolvedHardwareMentions.ts`
  - Pure deterministic detector for named unknown hardware near hardware nouns.
  - Unit-tested independently from routing.

- Modify `server/agent/requestScope.ts`
  - Ensure unresolved hardware and broad fallback route cannot map to `synthesize_circuit`.

- Modify `server/agent/deepAgentTools.ts`
  - Split live scoped factory from explicit unscoped test factory.
  - Fail closed when `candidateParts`, `allowedContextSourceIds`, or support scope are missing.

- Modify `server/agent/circuitTools.ts`
  - Ensure empty live candidate scope blocks candidate-gated validation/finalization.

- Modify `server/agent/deepAgentRuntime.ts`
  - Construct live tools only through scoped factory.
  - Remove interrupting tools from any agent run without a checkpointer.
  - Add pipeline, route, bundle, candidate provenance, and unknown hardware metadata to local logs and LangSmith metadata.

- Modify `server/agent/circuitTutor.ts`
  - Add structured fallback reason for local/live tutor mode.
  - Include tutor status in response while preserving deterministic fallback as default.

- Modify `server/agent/schemas.ts`
  - Add serving status and tutor mode/status fields.
  - Add context packet provenance fields if they are serialized across the HTTP boundary.

- Modify `src/circuitTutorClient.js`
  - Validate tutor server response before rendering.
  - Preserve local/live/fallback status.
  - Return `suggestedQuestions` from server when valid.

- Modify `src/main.js`
  - Render product-facing serving status.
  - Disable confirm/build for unknown hardware and support gaps.
  - Render dynamic tutor suggested questions.
  - Display subtle tutor fallback status.

- Modify `src/locales/en.js` and `src/locales/ko.js`
  - Add short product-facing copy for buildable, clarification, unsupported, review-only, safe-equivalent, local tutor, and live fallback states.

- Modify `package.json`
  - Add `context:acceptance`.
  - Add direct `@langchain/langgraph` dependency because `deepAgentRuntime.ts` and `deepAgentTools.ts` import it directly.
  - Include context acceptance in `npm run check`.

- Create or modify tests:
  - `tests/unit/contextUnknownHardware.test.ts`
  - `tests/unit/defaultPipelineReadiness.test.ts`
  - `tests/unit/deepAgentToolScope.test.ts`
  - `tests/unit/contextJsonSchema.test.ts`
  - `tests/unit/sourceClaimIntegrity.test.ts`
  - `tests/unit/circuitTutorClient.test.js`
  - `tests/e2e/features.spec.js`
  - `tests/unit/agentCategorySimulation.live.test.ts`

- Create or update docs:
  - `docs/agent-request-to-simulation-workflow.md`
  - `docs/agent-observability-logging.md`
  - `docs/agent-tutor-serving-workflow.md`
  - `docs/audit/CONTEXT_LAYER_ANALYSIS_2026-06-04.md` only if final findings need a follow-up note.

---

## Task 1: RED Tests For Unknown Explicit Hardware

**Files:**
- Create: `tests/unit/contextUnknownHardware.test.ts`
- Modify: `agent-context/evals/context-sufficiency-prompts.jsonl`
- Test: `tests/unit/contextUnknownHardware.test.ts`

- [x] **Step 1: Add the failing unit test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { assessRequestScope } from '../../server/agent/requestScope.ts';
import { buildContextPacket } from '../../server/context/contextPacket.ts';

const unknownHardwareCases = [
  {
    id: 'tachyon-sensor-led',
    message: 'Use a tachyon sensor to turn on an LED.',
    token: 'tachyon'
  },
  {
    id: 'xyz123-sensor-oled',
    message: 'Use XYZ123 sensor to show value on OLED.',
    token: 'xyz123'
  },
  {
    id: 'foo123-driver-motor',
    message: 'Use a Foo123 driver to spin a DC motor.',
    token: 'foo123'
  },
  {
    id: 'unknown-shield-display',
    message: 'Use a Quanta shield to display Hello on an OLED.',
    token: 'quanta'
  }
];

for (const row of unknownHardwareCases) {
  test(`unknown explicit hardware blocks synthesis: ${row.id}`, async () => {
    const packet = await buildContextPacket({
      message: row.message,
      locale: 'en'
    });
    const scope = assessRequestScope(packet);
    const diagnostic = [
      ...packet.supportGaps,
      ...packet.unsupportedSignals,
      ...packet.intentHints.ambiguity,
      packet.contextCoverage.synthesisEligibility.reason
    ].join('\n').toLowerCase();

    assert.equal(packet.contextCoverage.synthesisEligibility.status, 'ineligible');
    assert.equal(packet.contextCoverage.sufficientFor.includes('valid_circuit_synthesis'), false);
    assert.equal(scope.route, 'clarify_requirements');
    assert.equal(scope.buildEligible, false);
    assert.match(diagnostic, new RegExp(row.token, 'i'));
  });
}

test('generic sensor wording stays clarifiable without creating a fake unknown part', async () => {
  const packet = await buildContextPacket({
    message: 'Use a sensor to turn on an LED.',
    locale: 'en'
  });
  const diagnostic = [
    ...packet.supportGaps,
    ...packet.unsupportedSignals,
    ...packet.intentHints.ambiguity
  ].join('\n').toLowerCase();

  assert.doesNotMatch(diagnostic, /unknown hardware.*sensor/i);
});
```

- [x] **Step 2: Run the RED test**

Run:

```powershell
npm exec tsx -- --test tests/unit/contextUnknownHardware.test.ts
```

Expected now: FAIL because the `tachyon sensor` and `XYZ123 sensor` cases are still eligible.

- [x] **Step 3: Add eval rows**

Add unknown-hardware JSONL rows to
`agent-context/evals/context-sufficiency-prompts.jsonl`. The verified rows use
`expectedFailureClass: "context-gap"`, route to the best route-specific context
when possible, keep synthesis ineligible, and forbid build-ready simulation.

Current row ids:

- `unknown-tachyon-sensor-led`
- `unknown-xyz123-sensor-oled`
- `unknown-xyz123-gas-sensor-oled`
- `unknown-bme280-pressure-sensor-oled`
- `unknown-pn532-rfid-sensor-oled`
- `unknown-foo123-driver-motor`
- `unknown-quanta-shield-display`

- [x] **Step 4: Run the eval RED**

Run:

```powershell
npm run eval:generalization
```

Expected now: FAIL on the new rows until the detector and route gate are implemented.

- [x] **Step 5: Commit after GREEN**

```powershell
git add tests/unit/contextUnknownHardware.test.ts agent-context/evals/context-sufficiency-prompts.jsonl
git commit -m "test: block unknown explicit hardware before synthesis"
```

---

## Task 2: Implement Unknown Hardware Detection

**Files:**
- Create: `server/context/unresolvedHardwareMentions.ts`
- Modify: `server/context/contextPacket.ts`
- Test: `tests/unit/contextUnknownHardware.test.ts`

- [x] **Step 1: Create the detector module**

Create `server/context/unresolvedHardwareMentions.ts`:

```ts
import type { PartCapability } from '../agent/schemas.ts';

export type UnresolvedHardwareMention = {
  token: string;
  noun: string;
  phrase: string;
};

const HARDWARE_NOUNS = [
  'sensor',
  'module',
  'driver',
  'display',
  'shield',
  'board'
] as const;

const GENERIC_ALLOWED_MODIFIERS = new Set([
  'a',
  'an',
  'the',
  'some',
  'any',
  'generic',
  'simple',
  'supported',
  'analog',
  'digital',
  'i2c',
  'spi',
  'uart',
  'light',
  'temperature',
  'humidity',
  'motion',
  'distance',
  'oled',
  'lcd',
  'led',
  'dc',
  'servo',
  'stepper',
  'motor'
]);

export function buildKnownHardwareTerms(parts: PartCapability[]) {
  return new Set(
    parts.flatMap((part) => [
      part.id,
      part.label,
      ...part.aliases,
      ...part.visualPartIds,
      ...part.capabilities
    ])
      .map(normalizeTerm)
      .filter(Boolean)
  );
}

export function detectUnresolvedHardwareMentions(
  message: string,
  knownTerms: Set<string>
): UnresolvedHardwareMention[] {
  const normalized = normalizeTerm(message);
  const findings: UnresolvedHardwareMention[] = [];
  const nounPattern = HARDWARE_NOUNS.join('|');
  const pattern = new RegExp(`\\b([a-z][a-z0-9-]{2,}(?:\\s+[a-z0-9-]{2,}){0,2})\\s+(${nounPattern})\\b`, 'gi');
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(normalized)) !== null) {
    const token = match[1].trim();
    const noun = match[2].trim();
    const phrase = `${token} ${noun}`;
    const pieces = token.split(/\s+/).filter(Boolean);
    const lastPiece = pieces.at(-1) ?? token;

    if (pieces.every((piece) => GENERIC_ALLOWED_MODIFIERS.has(piece))) {
      continue;
    }
    if (knownTerms.has(token) || knownTerms.has(phrase) || knownTerms.has(lastPiece)) {
      continue;
    }
    if (knownTermsHasPrefix(knownTerms, token) || knownTermsHasPrefix(knownTerms, phrase)) {
      continue;
    }

    findings.push({ token, noun, phrase });
  }

  return uniqueByPhrase(findings);
}

function normalizeTerm(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+\-.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function knownTermsHasPrefix(knownTerms: Set<string>, value: string) {
  for (const term of knownTerms) {
    if (term.startsWith(`${value} `) || value.startsWith(`${term} `)) {
      return true;
    }
  }
  return false;
}

function uniqueByPhrase(findings: UnresolvedHardwareMention[]) {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    if (seen.has(finding.phrase)) {
      return false;
    }
    seen.add(finding.phrase);
    return true;
  });
}
```

- [x] **Step 2: Wire findings into `buildContextPacket()`**

In `server/context/contextPacket.ts`, import the detector:

```ts
import {
  buildKnownHardwareTerms,
  detectUnresolvedHardwareMentions
} from './unresolvedHardwareMentions.ts';
```

After `registry` has loaded and before final `supportGaps`/coverage are finalized, derive findings:

```ts
const unresolvedHardwareMentions = detectUnresolvedHardwareMentions(
  contextualMessage,
  buildKnownHardwareTerms(registry)
);
const unresolvedHardwareSupportGaps = unresolvedHardwareMentions.map((mention) =>
  `Unknown explicit hardware "${mention.phrase}" is not present in the verified H-eduware hardware registry. Ask for a supported substitute or verified hardware data before synthesis.`
);
const unresolvedHardwareAmbiguity = unresolvedHardwareMentions.map((mention) =>
  `Unknown explicit hardware requires clarification: ${mention.phrase}.`
);
```

Merge these into the values that feed `buildContextCoverage()`:

```ts
const coverageSupportGaps = unique([
  ...supportGaps,
  ...unresolvedHardwareSupportGaps
]);
const coverageAmbiguity = unique([
  ...intentHints.ambiguity,
  ...unresolvedHardwareAmbiguity
]);
```

Pass `coverageSupportGaps` and `coverageAmbiguity` into `buildContextCoverage()`, prompt rendering, and context trace summaries instead of the original lists.

- [x] **Step 3: Route unknown explicit hardware to clarification**

Keep full detection after the registry loads, then make coverage ineligibility the authority that drives `assessRequestScope()` to clarification. Do not mutate `contextRoute.routeId` after selection; the invariant below is sufficient because `requestScope.ts` already maps ineligible coverage to `clarify_requirements`:

```ts
packet.contextCoverage.synthesisEligibility.status === 'ineligible'
  && !packet.contextCoverage.sufficientFor.includes('valid_circuit_synthesis')
```

- [x] **Step 4: Run tests**

```powershell
npm exec tsx -- --test tests/unit/contextUnknownHardware.test.ts
npm run eval:generalization
npm run test:unit
```

Expected: all pass.

- [x] **Step 5: Commit**

```powershell
git add server/context/unresolvedHardwareMentions.ts server/context/contextPacket.ts tests/unit/contextUnknownHardware.test.ts agent-context/evals/context-sufficiency-prompts.jsonl
git commit -m "fix: require clarification for unknown explicit hardware"
```

---

## Task 3: Make Live Agent Tools Fail Closed

**Files:**
- Modify: `server/agent/deepAgentTools.ts`
- Modify: `server/agent/circuitTools.ts`
- Modify: `server/agent/deepAgentRuntime.ts`
- Modify: `tests/unit/agentWorkflow.test.ts`
- Create: `tests/unit/deepAgentToolScope.test.ts`

- [x] **Step 1: Write fail-closed tests**

Create `tests/unit/deepAgentToolScope.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createHeduwareAgentTools,
  createUnscopedHeduwareAgentToolsForTests
} from '../../server/agent/deepAgentTools.ts';

test('live tool factory rejects missing context scope', () => {
  assert.throws(
    () => createHeduwareAgentTools(),
    /SCOPED_TOOL_OPTIONS_REQUIRED/
  );
});

test('empty candidate scope means no searchable parts', async () => {
  const tools = createHeduwareAgentTools({
    candidateParts: [],
    allowedContextSourceIds: ['policy:safety'],
    supportBundles: [],
    contextCoverage: {
      status: 'insufficient',
      score: 0,
      sufficientFor: ['clarification_response'],
      synthesisEligibility: { status: 'ineligible', reason: 'No scoped candidate parts.' },
      requiredSourceTypes: [],
      presentSourceTypes: [],
      missingSourceTypes: [],
      warnings: []
    }
  });
  const searchTool = tools.find((tool) => tool.name === 'search_part_capabilities');
  assert.ok(searchTool);

  const result = JSON.parse(await searchTool.invoke({ query: 'OLED display', limit: 8 }) as string);
  assert.deepEqual(result, []);
});

test('test-only unscoped factory keeps legacy isolated diagnostics explicit', async () => {
  const tools = createUnscopedHeduwareAgentToolsForTests();
  const searchTool = tools.find((tool) => tool.name === 'search_part_capabilities');
  assert.ok(searchTool);

  const result = JSON.parse(await searchTool.invoke({ query: 'OLED display', limit: 8 }) as string);
  assert.ok(result.some((part: { id: string }) => part.id === 'oled-i2c-096'));
});
```

- [x] **Step 2: Run the RED test**

```powershell
npm exec tsx -- --test tests/unit/deepAgentToolScope.test.ts
```

Expected now: FAIL because `createHeduwareAgentTools()` accepts empty options.

- [x] **Step 3: Split scoped and unscoped factories**

In `server/agent/deepAgentTools.ts`, change the option model:

```ts
type ScopedHeduwareAgentToolOptions = {
  contextCoverage: ContextCoverageReport;
  candidateParts: PartCapability[];
  allowedContextSourceIds: string[];
  supportBundles: SupportBundleEvidence[];
  requestScope?: RequestScope;
  locale?: 'ko' | 'en';
};

type InternalToolOptions = ScopedHeduwareAgentToolOptions & {
  allowUnscopedContext: boolean;
};

export function createHeduwareAgentTools(options?: ScopedHeduwareAgentToolOptions) {
  if (!options) {
    throw new Error('SCOPED_TOOL_OPTIONS_REQUIRED: live H-eduware tools require contextCoverage, candidateParts, allowedContextSourceIds, and supportBundles.');
  }
  return createTools({ ...options, allowUnscopedContext: false });
}

export function createUnscopedHeduwareAgentToolsForTests() {
  return createTools({
    contextCoverage: {
      status: 'sufficient',
      score: 1,
      sufficientFor: ['valid_circuit_synthesis'],
      synthesisEligibility: {
        status: 'eligible',
        reason: 'Explicit test-only unscoped tool construction.'
      },
      requiredSourceTypes: [],
      presentSourceTypes: [],
      missingSourceTypes: [],
      warnings: []
    },
    candidateParts: [],
    allowedContextSourceIds: [],
    supportBundles: [],
    allowUnscopedContext: true
  });
}
```

Rename the existing implementation body to `createTools(options: InternalToolOptions)`.

- [x] **Step 4: Make bounded reads/searches fail closed**

In `readContextDocBounded()` and `readContextBundleDocBounded()`, use `allowUnscopedContext`:

```ts
if (!options.allowUnscopedContext && options.allowedContextSourceIds.length === 0) {
  return asJson({
    error: 'CONTEXT_SCOPE_EMPTY',
    requestedId: id,
    allowedSourceIds: []
  });
}
```

In `searchContextBoundPartCapabilities()`:

```ts
if (!options.allowUnscopedContext && options.candidateParts.length === 0) {
  return [];
}
```

- [x] **Step 5: Update runtime and tests**

In `server/agent/deepAgentRuntime.ts`, keep using `createHeduwareAgentTools(toolOptions)` only after `toolOptions` has scoped fields from `ContextPacket`.

In `tests/unit/agentWorkflow.test.ts`, change the old unscoped diagnostic test near the existing `createHeduwareAgentTools()` call to:

```ts
const tools = createUnscopedHeduwareAgentToolsForTests();
```

- [x] **Step 6: Run tests**

```powershell
npm exec tsx -- --test tests/unit/deepAgentToolScope.test.ts
npm exec tsx -- --test tests/unit/agentWorkflow.test.ts
npm run typecheck
```

Expected: all pass.

- [x] **Step 7: Commit**

```powershell
git add server/agent/deepAgentTools.ts server/agent/circuitTools.ts server/agent/deepAgentRuntime.ts tests/unit/deepAgentToolScope.test.ts tests/unit/agentWorkflow.test.ts
git commit -m "fix: make live agent tools scoped by default"
```

---

## Task 4: Broad Fallback Route Cannot Authorize Synthesis

**Files:**
- Modify: `server/context/contextPacket.ts`
- Modify: `agent-context/v2/routes.json`
- Modify: `tests/unit/generalizationEval.test.ts`
- Create: `tests/unit/defaultPipelineReadiness.test.ts`

- [x] **Step 1: Add readiness test for broad fallback**

Create `tests/unit/defaultPipelineReadiness.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildContextPacket } from '../../server/context/contextPacket.ts';

test('supported-hardware-general fallback is not build eligible without bundle or composition proof', async () => {
  const packet = await buildContextPacket({
    message: 'Build something with an Arduino and a mysterious module.',
    locale: 'en'
  });

  if (packet.contextRoute.routeId === 'supported-hardware-general') {
    assert.equal(packet.contextCoverage.synthesisEligibility.status, 'ineligible');
    assert.equal(packet.contextCoverage.sufficientFor.includes('valid_circuit_synthesis'), false);
  }
});

test('default pipeline preserves OLED display routing or explicitly documents legacy weakness', async () => {
  const packet = await buildContextPacket({
    message: 'Use Arduino Uno and an I2C OLED to display HELLO.',
    locale: 'en'
  });

  assert.ok(
    packet.contextRoute.routeId === 'v2-display-text-output'
      || packet.contextCoverage.synthesisEligibility.status === 'ineligible',
    `default pipeline routed to ${packet.contextRoute.routeId} while still build eligible`
  );
});
```

- [x] **Step 2: Run RED**

```powershell
npm exec tsx -- --test tests/unit/defaultPipelineReadiness.test.ts
```

Expected now: FAIL if fallback remains build eligible.

- [x] **Step 3: Add fallback ineligibility rule**

In `server/context/contextPacket.ts`, create:

```ts
function routeRequiresCompleteBundleOrComposition(routeId: string) {
  return routeId === 'supported-hardware-general';
}
```

Before `buildContextCoverage()`, add a support gap when broad fallback lacks proof:

```ts
const fallbackRouteSupportGaps = routeRequiresCompleteBundleOrComposition(contextRouteV2.routeId)
  && selectedBundles.length === 0
  ? ['General supported-hardware fallback cannot authorize validated synthesis without a complete v2 bundle or composition proof.']
  : [];
```

Merge `fallbackRouteSupportGaps` into coverage support gaps.

- [x] **Step 4: Reduce fallback prompt authority**

In `agent-context/v2/routes.json`, keep policy and index context, but remove heavy synthesis sources from `supported-hardware-general` `alwaysInclude`. Use:

```json
"alwaysInclude": [
  "memory:agent-rules",
  "policy:safety",
  "policy:clarification",
  "policy:truthfulness",
  "data:capability-graph"
]
```

The detailed registries remain accessible only through scoped tools once a route/bundle proves eligibility.

- [x] **Step 5: Run tests**

```powershell
npm exec tsx -- --test tests/unit/defaultPipelineReadiness.test.ts
npm run eval:generalization
npm run test:unit
```

Expected: all pass after eval rows are updated to expect clarification/context-gap for broad fallback.

- [x] **Step 6: Commit**

```powershell
git add server/context/contextPacket.ts agent-context/v2/routes.json tests/unit/defaultPipelineReadiness.test.ts agent-context/evals/context-sufficiency-prompts.jsonl
git commit -m "fix: keep broad context fallback out of build-ready synthesis"
```

---

## Task 5: Product-Facing Serving Status For Main Chat

**Files:**
- Modify: `server/agent/schemas.ts`
- Modify: `server/agent/deepAgentRuntime.ts`
- Modify: `src/main.js`
- Modify: `src/locales/en.js`
- Modify: `src/locales/ko.js`
- Test: `tests/e2e/features.spec.js`

- [x] **Step 1: Add schema status**

In `server/agent/schemas.ts`, add:

```ts
export const ServingStatusSchema = z.enum([
  'buildable_original',
  'needs_clarification',
  'unsupported',
  'review_only_diagnostic',
  'safe_equivalent',
  'local_tutor_answer',
  'live_tutor_answer',
  'live_tutor_fallback'
]);
```

Add `servingStatus: ServingStatusSchema.optional()` to `AgentRunResultSchema` and `TutorMessageResponseSchema`.

- [x] **Step 2: Derive status from server authority**

In `server/agent/deepAgentRuntime.ts`, derive status from `contextCoverage`, `buildRunnableReport`, `solverGateResult`, and safe-equivalent flags:

```ts
function deriveServingStatus(result: {
  contextCoverage: ContextCoverageReport;
  validationReport?: ValidationReport;
  buildRunnableReport?: BuildRunnableReport;
  solverGateResult?: SolverGateResult;
  unsupportedItems?: string[];
}): z.infer<typeof ServingStatusSchema> {
  if (result.contextCoverage.synthesisEligibility.status !== 'eligible') {
    return result.unsupportedItems?.length ? 'unsupported' : 'needs_clarification';
  }
  if (result.buildRunnableReport?.runnable) {
    return 'buildable_original';
  }
  return 'review_only_diagnostic';
}
```

Import the concrete project types from `schemas.ts` before implementing the final typed helper:

```ts
import {
  ServingStatusSchema,
  type BuildRunnableReport,
  type ContextCoverageReport,
  type SolverGateResult,
  type ValidationReport
} from './schemas.ts';
```

- [x] **Step 3: UI gates confirm/build using status**

In `src/main.js`, make confirm/run visibility depend on the server-derived status:

```js
function isBuildableServingStatus(result) {
  return result?.servingStatus === 'buildable_original' || result?.servingStatus === 'safe_equivalent';
}
```

Use `isBuildableServingStatus(state.agentResult)` in the same places that currently infer buildability from scene visibility alone.

- [x] **Step 4: Add concise localized copy**

Add keys in `src/locales/en.js` and `src/locales/ko.js`:

```js
servingStatus: {
  buildable_original: 'Build-ready',
  needs_clarification: 'Needs one choice',
  unsupported: 'Not supported yet',
  review_only_diagnostic: 'Review only',
  safe_equivalent: 'Safe equivalent',
  local_tutor_answer: 'Local circuit evidence',
  live_tutor_answer: 'Live tutor',
  live_tutor_fallback: 'Local fallback'
}
```

Use equivalent short Korean labels in `ko.js`.

- [x] **Step 5: Add e2e assertion**

In `tests/e2e/features.spec.js`, add an unknown hardware scenario:

```js
test('unknown hardware request asks for clarification instead of showing build confirmation', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('idea-input').fill('Use XYZ123 sensor to show value on OLED.');
  await page.getByTestId('idea-submit').click();

  await expect(page.getByTestId('ai-thread')).toContainText(/XYZ123|supported sensor|verified/i);
  await expect(page.getByTestId('run-button')).toBeDisabled();
  await expect(page.getByText(/Build-ready|Build the circuit/i)).toHaveCount(0);
});
```

Use the selectors already used by nearby tests in `tests/e2e/features.spec.js`. If the current file uses role selectors rather than `data-testid` for idea submit or run, reuse that exact selector style in this new test so no markup change is made only for the test.

- [x] **Step 6: Run targeted verification**

```powershell
npm run test:unit
npm run test:e2e -- tests/e2e/features.spec.js
```

Expected: all pass.

- [x] **Step 7: Commit**

```powershell
git add server/agent/schemas.ts server/agent/deepAgentRuntime.ts src/main.js src/locales/en.js src/locales/ko.js tests/e2e/features.spec.js
git commit -m "feat: surface product serving status in chat"
```

---

## Task 6: Tutor Chat Contracts And Transparent Fallback

**Files:**
- Modify: `server/agent/schemas.ts`
- Modify: `server/agent/circuitTutor.ts`
- Modify: `src/circuitTutorClient.js`
- Modify: `src/main.js`
- Modify: `tests/unit/circuitTutor.test.ts`
- Create: `tests/unit/circuitTutorClient.test.js`

- [x] **Step 1: Add tutor response contract tests**

Create `tests/unit/circuitTutorClient.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { askCircuitTutor } from '../../src/circuitTutorClient.js';

function sampleCircuit() {
  return {
    title: 'OLED demo',
    circuitSpec: { id: 'demo', title: 'Demo', components: [], connections: [], behavior: { runText: 'HELLO' } },
    validationReport: { status: 'valid', errors: [], warnings: [], validatedCurrentPathIds: [] },
    simulationPlan: { status: 'valid', runText: 'HELLO', steps: [], currentPathIds: [] },
    contextCoverage: { synthesisEligibility: { status: 'eligible', reason: 'test' } },
    buildRunnableReport: { runnable: true },
    solverGateResult: { status: 'pass' },
    contextTrace: []
  };
}

test('malformed tutor server response falls back with explicit mode', async () => {
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => 'enabled' };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ mode: 'live', message: '' })
  });

  try {
    const response = await askCircuitTutor({
      circuit: sampleCircuit(),
      target: { id: 'connection:x', type: 'connection', label: 'X', summary: 'wire', questions: [] },
      question: 'How does this work?',
      locale: 'en',
      running: false
    });

    assert.equal(response.mode, 'local');
    assert.equal(response.servingStatus, 'live_tutor_fallback');
    assert.match(response.fallbackReason, /malformed|schema/i);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.localStorage = previousStorage;
  }
});
```

- [x] **Step 2: Validate server response in client**

In `src/circuitTutorClient.js`, define a small validator matching `TutorMessageResponseSchema` enough for browser safety:

```js
function parseTutorResponse(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('malformed tutor response');
  }
  if (!['local', 'live'].includes(value.mode)) {
    throw new Error('malformed tutor response mode');
  }
  if (typeof value.message !== 'string' || value.message.trim().length === 0) {
    throw new Error('malformed tutor response message');
  }
  return {
    ...value,
    suggestedQuestions: Array.isArray(value.suggestedQuestions) ? value.suggestedQuestions : [],
    grounding: Array.isArray(value.grounding) ? value.grounding : []
  };
}
```

On fetch error or parse error, return local answer plus:

```js
servingStatus: 'live_tutor_fallback',
fallbackReason: error instanceof Error ? error.message : 'server unavailable'
```

- [x] **Step 3: Include tutor artifact gates**

In `src/circuitTutorClient.js`, include these artifacts when present:

```js
contextCoverage: circuit.contextCoverage,
buildRunnableReport: circuit.buildRunnableReport,
solverGateResult: circuit.solverGateResult
```

Extend `TutorMessageRequestSchema` in `server/agent/schemas.ts` to accept those optional fields under `artifacts`.

- [x] **Step 4: Server sets tutor serving status**

In `server/agent/circuitTutor.ts`, local deterministic response returns:

```ts
servingStatus: 'local_tutor_answer'
```

Live success returns:

```ts
servingStatus: 'live_tutor_answer'
```

Live catch fallback returns local response with:

```ts
servingStatus: 'live_tutor_fallback',
fallbackReason: error instanceof Error ? error.message : 'live tutor failed'
```

Do not include raw prompt, API key, or full model error details in `fallbackReason`.

- [x] **Step 5: UI renders response suggestions and subtle status**

In `src/main.js`, when appending tutor response:

```js
state.inspector.chatMessages = state.inspector.chatMessages.concat({
  role: 'assistant',
  text: response.message,
  mode: response.mode,
  servingStatus: response.servingStatus,
  fallbackReason: response.fallbackReason
});
state.inspector.suggestedQuestions = response.suggestedQuestions?.length
  ? response.suggestedQuestions
  : target.questions;
```

In `renderCircuitChatDrawer()`, use `state.inspector.suggestedQuestions ?? target.questions`.

- [x] **Step 6: Run tests**

```powershell
node --test tests/unit/circuitTutorClient.test.js
npm exec tsx -- --test tests/unit/circuitTutor.test.ts
npm run test:e2e -- tests/e2e/features.spec.js
```

Expected: all pass.

- [x] **Step 7: Commit**

```powershell
git add server/agent/schemas.ts server/agent/circuitTutor.ts src/circuitTutorClient.js src/main.js tests/unit/circuitTutor.test.ts tests/unit/circuitTutorClient.test.js tests/e2e/features.spec.js
git commit -m "feat: make tutor fallback and suggestions explicit"
```

---

## Task 7: Context Schema And Source Integrity Gates

**Files:**
- Modify: `agent-context/v2/schemas/route-v2.schema.json`
- Create: `tests/unit/contextJsonSchema.test.ts`
- Create: `server/context/sourceClaimIntegrity.ts`
- Create: `server/context/sourceClaimIntegrityCli.ts`
- Create: `tests/unit/sourceClaimIntegrity.test.ts`
- Modify: `package.json`

- [x] **Step 1: Align route JSON Schema with runtime schema**

Add `tier`, `budget`, and `when.capabilityMatchMode` to `agent-context/v2/schemas/route-v2.schema.json`:

```json
"tier": { "type": "string", "enum": ["primary-output", "compositional-context"] },
"budget": { "type": "string", "enum": ["minimal", "standard", "full"] }
```

Under `when.properties`:

```json
"capabilityMatchMode": { "type": "string", "enum": ["any", "all"] }
```

Do not require these fields; runtime defaults make older route rows valid.

- [x] **Step 2: Add source integrity module**

Create `server/context/sourceClaimIntegrity.ts`:

```ts
import {
  loadHardwareSupportBundles,
  loadSourceClaims,
  type SourceClaim
} from './sourceClaims.ts';
import {
  loadSimulationPrimitives,
  loadTopologyTemplates
} from './contextAssets.ts';
import { getPartRegistry } from './contextLayer.ts';

export type SourceClaimIntegrityIssue = {
  severity: 'error' | 'warning';
  claimId: string;
  message: string;
};

export async function buildSourceClaimIntegrityReport() {
  const [claims, bundles, parts, primitives, topologies] = await Promise.all([
    loadSourceClaims(),
    loadHardwareSupportBundles(),
    getPartRegistry(),
    loadSimulationPrimitives(),
    loadTopologyTemplates()
  ]);
  const issues: SourceClaimIntegrityIssue[] = [];
  const claimById = new Map(claims.map((claim) => [claim.claimId, claim]));
  const subjectIds = new Set([
    ...parts.map((part) => part.id),
    ...parts.flatMap((part) => part.pins.map((pin) => `${part.id}.${pin.name}`)),
    ...primitives.map((primitive) => primitive.id),
    ...topologies.map((topology) => topology.id)
  ]);

  for (const bundle of bundles) {
    for (const claimId of bundle.sourceClaimIds) {
      if (!claimById.has(claimId)) {
        issues.push({ severity: 'error', claimId, message: `Missing source claim referenced by ${bundle.bundleId}.` });
      }
    }
  }

  for (const claim of claims) {
    if (!subjectIds.has(claim.subjectId)) {
      issues.push({ severity: 'error', claimId: claim.claimId, message: `Claim subject does not resolve: ${claim.subjectId}.` });
    }
    issues.push(...tierAuthorizationIssues(claim));
  }

  return {
    totalClaims: claims.length,
    issueCount: issues.length,
    issues
  };
}

function tierAuthorizationIssues(claim: SourceClaim): SourceClaimIntegrityIssue[] {
  const needsExternalAuthority = claim.claimType === 'pin-map'
    || claim.claimType === 'electrical-limit'
    || claim.claimType === 'protocol-support';
  if (needsExternalAuthority && claim.sourceTier === 'h-eduware-derived') {
    return [{
      severity: 'warning',
      claimId: claim.claimId,
      message: `${claim.claimType} should be backed by manufacturer, vendor, EDA, or educational reference evidence before it authorizes supported synthesis.`
    }];
  }
  return [];
}
```

Use the existing `getPartRegistry()` export from `server/context/contextLayer.ts` for part capability subjects.

- [x] **Step 3: Add CLI**

Create `server/context/sourceClaimIntegrityCli.ts`:

```ts
import { buildSourceClaimIntegrityReport } from './sourceClaimIntegrity.ts';

const report = await buildSourceClaimIntegrityReport();
console.log(JSON.stringify(report, null, 2));

if (report.issues.some((issue) => issue.severity === 'error')) {
  process.exitCode = 1;
}
```

- [x] **Step 4: Add unit tests**

Create `tests/unit/sourceClaimIntegrity.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSourceClaimIntegrityReport } from '../../server/context/sourceClaimIntegrity.ts';

test('source claims resolve referenced support-bundle claim ids and subjects', async () => {
  const report = await buildSourceClaimIntegrityReport();
  const errors = report.issues.filter((issue) => issue.severity === 'error');

  assert.deepEqual(errors, []);
});
```

- [x] **Step 5: Update scripts**

In `package.json`:

```json
"audit:sources:integrity": "tsx server/context/sourceClaimIntegrityCli.ts",
"context:acceptance": "npm run context:check && npm run audit:context:v2 && npm run audit:sources && npm run audit:sources:integrity && npm run audit:capabilities && npm run eval:generalization"
```

- [x] **Step 6: Run verification**

```powershell
npm run audit:sources:integrity
npm run context:acceptance
npm run test:unit
```

Expected: no integrity errors; tier warnings can print without failing during this refactor.

- [x] **Step 7: Commit**

```powershell
git add agent-context/v2/schemas/route-v2.schema.json server/context/sourceClaimIntegrity.ts server/context/sourceClaimIntegrityCli.ts tests/unit/sourceClaimIntegrity.test.ts package.json
git commit -m "test: add context source integrity acceptance gate"
```

---

## Task 8: Acceptance Gate And Direct Dependency Hygiene

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: root acceptance commands

- [x] **Step 1: Add direct LangGraph dependency**

Run:

```powershell
npm install @langchain/langgraph@^1.3.3 --save
```

Expected: `package.json` includes `@langchain/langgraph` because `server/agent/deepAgentRuntime.ts` and `server/agent/deepAgentTools.ts` import it directly.

- [x] **Step 2: Include context acceptance in check**

Set:

```json
"check": "npm run test:unit && npm run context:acceptance && npm run typecheck && npm run build && npm run test:e2e"
```

- [x] **Step 3: Run default acceptance**

```powershell
npm run check
```

Expected: unit tests, context acceptance, typecheck, build, and Playwright e2e all pass without OpenAI credentials.

- [x] **Step 4: Run live opt-in gate only when credentials exist**

```powershell
npm run check:live
```

Expected without `OPENAI_API_KEY` or `H_EDUWARE_AGENT_MODEL`: tests skip cleanly. Expected with credentials: main synthesis, tutor QA, clarification/resume, malformed/repair, and unknown-hardware live cases pass without printing secrets.

- [x] **Step 5: Commit**

```powershell
git add package.json package-lock.json
git commit -m "chore: include context acceptance in default check"
```

---

## Task 9: Documentation Updates

**Files:**
- Modify: `docs/agent-request-to-simulation-workflow.md`
- Modify: `docs/agent-observability-logging.md`
- Create: `docs/agent-tutor-serving-workflow.md`
- Modify: `docs/README.md`

- [x] **Step 1: Update request-to-simulation workflow**

Add these invariants to `docs/agent-request-to-simulation-workflow.md`:

```markdown
### Context Eligibility Invariants

- Unknown explicit hardware names near hardware nouns are clarification/support-gap signals.
- `supported-hardware-general` does not authorize build-ready synthesis without complete bundle or composition proof.
- LangGraph checkpointer owns conversation continuity; `conversationContext` is bounded artifact/UI grounding only.
- Live tools are scoped by the current `ContextPacket`. Missing scope blocks tool access.
```

- [x] **Step 2: Update observability logging docs**

Add required context fields:

```markdown
Context-related log metadata includes `pipelineMode`, `contextRouteId`,
`selectedBundleIds`, `candidatePartIds`, `candidateProvenance`,
`unknownHardwareMentions`, `fallbackRoute`, `supportBundleStatus`,
and `synthesisEligibility`. Local logs store hashes/previews only.
```

- [x] **Step 3: Create tutor workflow doc**

Create `docs/agent-tutor-serving-workflow.md`:

```markdown
# Agent Tutor Serving Workflow

The right-side tutor chat is a selected-target QA surface, not the main synthesis workflow.

1. `renderCircuitChatDrawer()` renders the current selected part, connection, or circuit.
2. `submitTutorQuestion()` sends selected target, question, run state, and circuit artifacts.
3. `askCircuitTutor()` uses local deterministic evidence by default.
4. Server mode is opt-in. `/api/agent/explain-target` may run stateless typed DeepAgent QA when `H_EDUWARE_TUTOR_MODE=live`.
5. The UI renders tutor `message`, `servingStatus`, and dynamic `suggestedQuestions`.
6. Live failures return local fallback with a redacted `fallbackReason`.

The tutor must not describe current flow unless validation and simulation are valid and the runnable/solver gates allow it.
```

- [x] **Step 4: Update docs index**

Add `docs/agent-tutor-serving-workflow.md` and this plan to `docs/README.md`.

- [x] **Step 5: Commit**

```powershell
git add docs/agent-request-to-simulation-workflow.md docs/agent-observability-logging.md docs/agent-tutor-serving-workflow.md docs/README.md docs/plans/PLAN_chat_ui_context_layer_refactor.md
git commit -m "docs: document chat serving and context refactor plan"
```

---

## Task 10: Ralph Completion Audit And Plan Hygiene

**Files:**
- Modify: `docs/plans/PLAN_chat_ui_context_layer_refactor.md`

- [x] **Step 1: Confirm unchecked work items are commit-only**

Current unchecked boxes are only the per-task commit steps. They remain
unchecked because commits require an explicit user request in this workspace.

- [x] **Step 2: Separate baseline serving map from verified refactor state**

The top serving map is now labeled as the pre-refactor baseline, and the
verified refactor state is recorded near the ADR.

- [x] **Step 3: Record command-level verification evidence**

Verified in this Ralph continuation, then re-verified after incorporating
subagent feedback:

```powershell
npm exec tsx -- --test tests/unit/agentLogger.test.ts
npm run typecheck
npm run check
npm run check:live
```

Results:

- `npm exec tsx -- --test tests/unit/agentLogger.test.ts`: PASS.
- `npm run typecheck`: PASS.
- `npm run check`: PASS after context metadata logging changes, including
  default unit, context acceptance, build, and Playwright e2e gates without live
  OpenAI dependency.
- `npm run check:live`: PASS with bounded live category smoke and live corpus
  sample after context metadata logging changes.

- [x] **Step 4: Incorporate subagent verifier feedback**

Ralph verifier subagent found three gaps:

- Non-commit unchecked Step 4 in this audit task.
- Observability docs required context metadata that was not yet emitted by
  `contextPacketLogSummary()`/LangSmith metadata.
- Unknown-hardware eval-row examples in this plan had drifted from the current
  `context-gap` rows.

Fixes applied:

- `ContextPacket` now carries metadata for `pipelineMode`,
  `selectedBundleIds`, `candidateProvenance`, `unknownHardwareMentions`,
  `fallbackRoute`, and `supportBundleStatus`.
- `contextPacketLogSummary()` now emits those fields, so local logs and
  LangSmith metadata share the same context summary.
- Logger tests now assert normal-route provenance and unknown hardware
  provenance.
- The unknown-hardware eval-row section now lists the current seven
  `context-gap` rows instead of stale four-row examples.

- [x] **Step 5: Commit**

Included in the main-branch deployment commit requested on 2026-06-04.

---

## Task 11: Ralph Continuation Final Verification

**Files:**
- Modify: `docs/plans/PLAN_chat_ui_context_layer_refactor.md`

- [x] **Step 1: Re-audit unchecked checklist items**

Only commit steps remain unchecked. No implementation, documentation, or
verification checklist item is open.

- [x] **Step 2: Re-run focused verification**

```powershell
npm exec tsx -- --test tests/unit/agentLogger.test.ts
npm run typecheck
```

Results:

- `npm exec tsx -- --test tests/unit/agentLogger.test.ts`: PASS, 7/7.
- `npm run typecheck`: PASS.

- [x] **Step 3: Incorporate final subagent code-review feedback**

Read-only gpt-5.5 xhigh code-review subagent found privacy/status propagation
gaps. Fixes applied:

- Added shared log redaction for local/LangSmith summaries.
- Redacted request previews, context support gaps, unknown hardware mentions,
  fallback route reasons, context warnings, error summaries, and tool-call
  failure errors.
- Added regression coverage for secret-shaped unknown hardware names and
  tool-call failure redaction.
- Added `servingStatus` to main `agent.response.sent` summaries.
- Preserved tutor `mode`, `servingStatus`, and `fallbackReason` when the main
  Chat UI answers a current-artifact wiring question through `askCircuitTutor()`.
- Extended the current-artifact e2e path to assert main chat tutor fallback
  status rendering.

Focused verification:

```powershell
npm exec tsx -- --test tests/unit/agentLogger.test.ts tests/unit/observabilityMiddleware.test.ts
npm run typecheck
npm run test:e2e -- tests/e2e/features.spec.js --grep "LED draft follow-up"
```

Results: all PASS.

Full verification after the final privacy/status fixes:

```powershell
npm run check
npm run check:live
```

Results:

- `npm run check`: PASS. Unit/context acceptance/typecheck/build/e2e all
  passed; Playwright reported 116 passed and 30 skipped.
- `npm run check:live`: PASS. Live category simulation matrix and live corpus
  smoke both passed with post-fallback completion 4/4 and structured-output
  first-shot near 100%.

- [x] **Step 4: Commit**

Included in the main-branch deployment commit requested on 2026-06-04.

---

## Verification Matrix

| Gate | Command | Must Not Require Live API |
| --- | --- | --- |
| Unit | `npm run test:unit` | Yes |
| Context acceptance | `npm run context:acceptance` | Yes |
| Type check | `npm run typecheck` | Yes |
| Build | `npm run build` | Yes |
| E2E | `npm run test:e2e` | Yes |
| Full default | `npm run check` | Yes |
| Live smoke | `npm run check:live` | No, skips without credentials |

## Rollout Order

1. Unknown hardware RED tests and detector.
2. Fail-closed live tools.
3. Broad fallback route ineligibility.
4. Main chat serving status.
5. Tutor contract/fallback/suggestions.
6. Schema/source integrity acceptance.
7. Default `npm run check` integration.
8. Docs update.

## Risks And Mitigations

- Unknown hardware detector false positives:
  - Mitigation: negative fixtures for generic "a sensor", known DHT11/OLED/L298N, and classroom project names.

- Fail-closed tools break broad tests:
  - Mitigation: explicit `createUnscopedHeduwareAgentToolsForTests()` and migration of old unscoped tests.

- Source claim value validation too strict:
  - Mitigation: hard-fail missing claim/subject first; keep tier/value authorization as warnings until claims are cleaned.

- Context acceptance increases `npm run check` time:
  - Mitigation: include deterministic read-only CLIs only; keep artifact generation and live OpenAI tests outside default check.

- Tutor status copy becomes noisy:
  - Mitigation: use one short badge and keep detailed fallback reason out of the main student answer.

## Self-Review

- Spec coverage: This plan covers the context audit P0/P1 findings, the prior Chat UI ralplan findings, LangChain ecosystem constraints, tutor fallback, logging, and default/live verification split.
- Placeholder scan: The plan has concrete files, commands, expected results, and code snippets for every implementation task.
- Type consistency: New names are consistent across tasks: `ServingStatusSchema`, `createUnscopedHeduwareAgentToolsForTests`, `detectUnresolvedHardwareMentions`, `context:acceptance`, and `sourceClaimIntegrity`.

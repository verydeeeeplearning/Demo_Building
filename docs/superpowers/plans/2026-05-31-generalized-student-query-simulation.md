# Generalized Student Query Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 학생이 어떤 방식으로 회로 요구사항을 말하더라도, H-eduware가 고정 데모 분기 없이 context-grounded circuit synthesis, deterministic validation, visual rendering, educational simulation, unsupported/clarification handling까지 안정적으로 수행하게 만든다.

**Architecture:** 제품 범위는 "OLED -> LED -> Button" 같은 하드웨어 순서가 아니라 `intent -> context coverage -> capability graph -> circuit topology -> validation -> simulation primitives -> render plan -> inspector chat -> eval telemetry` 파이프라인이다. LLM/Deepagents는 조율자이고, 진실은 context layer의 canonical data와 deterministic tools가 소유한다.

**Tech Stack:** Vanilla JS + Vite + three.js frontend, Node TypeScript server, Deepagents, LangChain OpenAI `ChatOpenAI`, Zod schemas, JSON/Markdown context layer, Playwright E2E.

---

## 0. Non-Negotiable Product Reframe

테스트 통과는 목표가 아니다. 테스트는 목표 달성을 관측하는 장치다.

잘못된 목표:

```text
OLED 기존 경로 유지 -> LED/Resistor -> Button LED -> Buzzer -> Servo -> Potentiometer 순서로 구현한다.
```

올바른 목표:

```text
학생의 임의 질의가 들어오면, 시스템은 먼저 의도와 위험을 정규화하고, context layer에서 필요한 근거를 강제 조회한 뒤, 지원 가능한 capability 조합만 회로로 합성한다. 지원할 수 없으면 회로를 꾸며내지 않고 부족한 context, 안전 문제, 추가 질문을 명확히 반환한다.
```

따라서 모든 구현은 특정 부품 이름이 아니라 다음 역량을 개선해야 한다.

- Intent normalization
- Context sufficiency and coverage gating
- Capability retrieval and ranking
- Circuit topology synthesis
- Deterministic validation and repair
- Primitive-based simulation
- Render-plan-driven visualization
- Hover/selection tutor chat
- Generalization eval and failure taxonomy

## 1. Current Runtime Decision

현재 live agent runtime은 서버 전용이어야 하며 브라우저에 key를 노출하지 않는다.

Required local runtime config:

```env
H_EDUWARE_AGENT_MODEL="gpt-5.5"
H_EDUWARE_AGENT_REASONING_EFFORT="low"
```

Verification command:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8787/api/agent/health | ConvertTo-Json -Depth 5
```

Expected non-secret fields:

```json
{
  "ok": true,
  "mode": "live",
  "defaultMode": "deepagents-live",
  "provider": "openai",
  "model": "gpt-5.5",
  "hasServerKey": true
}
```

Do not print or commit `OPENAI_API_KEY`. `.local/agent.env` must stay ignored by `.gitignore`.

## 2. System-Wide Success Criteria

A prompt is successful only if the final result satisfies one of these contracts.

### 2.1 Valid Circuit Contract

Valid output requires all of the following:

- `IntentSpec` captures behavior, input/output, power assumptions, ambiguity, and safety signals.
- `contextCoverage.status === "sufficient"`.
- `contextTrace` cites memory, policy, reference, registry/data, rendering, and simulation sources relevant to the result.
- `CircuitSpec` contains only canonical part ids, pins, rails, and protocols from context.
- `ValidationReport.status === "valid"`.
- `Netlist` has closed paths only where required.
- `SimulationPlan` is built from primitive contracts, not model prose.
- `RenderPlan` has footprint ids, pin anchors, endpoint coordinates, and visual warnings when partial.
- Files tab shows a requirement document and grounding evidence.
- PCB tab renders the requested circuit from `RenderPlan`.
- Run tab animates only validated paths.
- Hover/selection inspector can answer target-specific questions using the same context and artifacts.

### 2.2 Clarification Contract

Clarification output is correct when:

- Required information is missing.
- The question is specific, minimal, and actionable.
- The response does not invent a circuit.
- The context trace explains which ambiguity policy or missing capability caused the question.

### 2.3 Unsupported Contract

Unsupported output is correct when:

- The request is unsafe, outside educational low-voltage scope, or missing canonical support.
- The result names the unsupported capability, not only a generic failure.
- The response offers a safe educational alternative when possible.
- The app does not render or animate a fake circuit.

## 3. File Responsibility Map

Core files to modify through this plan:

- `server/agent/schemas.ts`: authoritative typed contracts for intent, coverage, synthesis, validation, simulation, rendering, tutor chat.
- `server/context/contextPacket.ts`: context preflight, context packet, coverage report, trace.
- `server/context/capabilityGraph.ts`: deterministic capability retrieval, Korean/English phrase normalization, ranking, negative evidence.
- `server/context/contextLayer.ts`: context document/data loading and index validation.
- `server/agent/deepAgentRuntime.ts`: Deepagents orchestration, forced context injection, bounded repair loop.
- `server/agent/circuitTools.ts`: validator, netlist builder, render compiler, simulation compiler.
- `server/agent/circuitTutor.ts`: selected-target tutor responses grounded in artifacts.
- `agent-context/data/capability-graph.json`: canonical capability records and support level.
- `agent-context/data/part-capabilities.json`: canonical part capability data.
- `agent-context/data/render-footprints.json`: footprint, pin anchors, visual style, hover targets.
- `agent-context/simulation/primitives.json`: simulation primitive contracts.
- `agent-context/evals/*.jsonl`: prompt-family eval corpus and expected failure classes.
- `src/main.js`: UI consumption of agent artifacts, context evidence, inspector chat, validation warnings.
- `src/stageScene.js`: render-plan-driven component/wire/overlay/hover target rendering.
- `src/circuitInspector.js`: selected circuit target metadata and tutor UI state.
- `tests/unit/*.test.ts`: deterministic contracts.
- `tests/e2e/*.spec.js`: browser-visible behavior.

## 4. Implementation Tasks

### Task 1: Lock Runtime Model To `gpt-5.5`

**Files:**

- Verify: `.local/agent.env`
- Verify: `server/agent/deepAgentRuntime.ts`
- Test: `tests/unit/agentWorkflow.test.ts`
- Docs: `docs/superpowers/plans/2026-05-31-generalized-student-query-simulation.md`

- [x] **Step 1: Verify server health reports `gpt-5.5`**

Run:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8787/api/agent/health | ConvertTo-Json -Depth 5
```

Expected:

```text
"model": "gpt-5.5"
```

- [x] **Step 2: Add a unit guard for gpt-5 reasoning options**

Add this test to `tests/unit/agentWorkflow.test.ts` if the helper is exported; otherwise add it next to the existing runtime health test:

```ts
test('agent health exposes gpt-5.5 when live runtime is configured', () => {
  const previousModel = process.env.H_EDUWARE_AGENT_MODEL;
  const previousKey = process.env.OPENAI_API_KEY;

  process.env.H_EDUWARE_AGENT_MODEL = 'gpt-5.5';
  process.env.OPENAI_API_KEY = 'test-key';

  const health = agentRuntimeHealth();

  assert.equal(health.ok, true);
  assert.equal(health.model, 'gpt-5.5');
  assert.equal(health.provider, 'openai');

  if (previousModel === undefined) {
    delete process.env.H_EDUWARE_AGENT_MODEL;
  } else {
    process.env.H_EDUWARE_AGENT_MODEL = previousModel;
  }

  if (previousKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = previousKey;
  }
});
```

- [x] **Step 3: Run the targeted test**

Run:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
```

Expected:

```text
pass
```

Implementation checkpoint:

- `.local/agent.env` sets `H_EDUWARE_AGENT_MODEL="gpt-5.5"`.
- `/api/agent/health` reports non-secret fields with `model: "gpt-5.5"` and `defaultMode: "deepagents-live"`.
- Added a unit guard for `agentRuntimeHealth()` with `gpt-5.5`.
- Verification passed: `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts`.

### Task 2: Introduce `IntentSpecV2`

**Files:**

- Modify: `server/agent/schemas.ts`
- Modify: `server/context/contextPacket.ts`
- Test: `tests/unit/agentSchemas.test.ts`
- Test: `tests/unit/contextPacket.test.ts`

- [x] **Step 1: Add failing schema tests**

Add tests that require intent to capture behavior rather than category:

```ts
test('IntentSpecV2 captures behavior, modality, ambiguity, and safety signals', () => {
  const parsed = IntentSpecV2Schema.parse({
    studentGoal: '어두우면 불이 켜지는 장치를 만들고 싶어',
    behaviors: [
      {
        trigger: 'ambient light becomes dark',
        action: 'turn on light output',
        timing: 'steady-state'
      }
    ],
    inputModalities: ['light-sensing'],
    outputModalities: ['light-output'],
    controllerAssumptions: ['arduino-compatible'],
    powerAssumptions: ['usb-5v'],
    ambiguities: ['which light sensor is available'],
    safetySignals: [],
    unsupportedSignals: [],
    language: 'ko',
    confidence: 0.74
  });

  assert.equal(parsed.inputModalities[0], 'light-sensing');
  assert.equal(parsed.outputModalities[0], 'light-output');
});
```

- [x] **Step 2: Add `IntentSpecV2Schema`**

Add to `server/agent/schemas.ts`:

```ts
export const IntentBehaviorSchema = z.object({
  trigger: z.string().min(1),
  action: z.string().min(1),
  timing: z.enum(['steady-state', 'momentary', 'pwm', 'analog', 'event-driven', 'unknown']).default('unknown')
});

export const IntentSpecV2Schema = z.object({
  studentGoal: z.string().min(1),
  behaviors: z.array(IntentBehaviorSchema).default([]),
  inputModalities: z.array(z.string()).default([]),
  outputModalities: z.array(z.string()).default([]),
  controllerAssumptions: z.array(z.string()).default([]),
  powerAssumptions: z.array(z.string()).default([]),
  ambiguities: z.array(z.string()).default([]),
  safetySignals: z.array(z.string()).default([]),
  unsupportedSignals: z.array(z.string()).default([]),
  language: z.enum(['ko', 'en', 'mixed', 'unknown']).default('unknown'),
  confidence: z.number().min(0).max(1).default(0.5)
});

export type IntentSpecV2 = z.infer<typeof IntentSpecV2Schema>;
```

- [x] **Step 3: Feed `IntentSpecV2` into context preflight**

Update `buildContextPacket()` so it creates an intent draft before capability matching:

```ts
const intentDraft = extractIntentSignals({
  message: request.message,
  confirmation: request.confirmation ?? null,
  locale: request.locale ?? 'ko'
});
```

The intent draft must be returned in the context packet and included in the prompt block as compact JSON.

- [x] **Step 4: Run targeted tests**

Run:

```powershell
npm exec -- tsx --test tests/unit/agentSchemas.test.ts tests/unit/contextPacket.test.ts
```

Expected:

```text
pass
```

Implementation checkpoint:

- `server/agent/schemas.ts` now exports `IntentBehaviorSchema`, `IntentSpecV2Schema`, and `IntentSpecV2`.
- `ContextPacketSchema` now requires `intentSpec`.
- `server/context/contextPacket.ts` now extracts structured intent from the request, capability matches, safety signals, support gaps, and locale before prompt assembly.
- `promptBlock` now includes an `Intent spec:` JSON section before the older `Intent hints:` summary.
- `tests/unit/agentSchemas.test.ts` and `tests/unit/contextPacket.test.ts` prove the schema and packet behavior.

### Task 3: Turn Context Coverage Into A Gate

**Files:**

- Modify: `server/context/contextPacket.ts`
- Modify: `server/agent/deepAgentRuntime.ts`
- Modify: `server/agent/circuitTools.ts`
- Test: `tests/unit/contextCoverage.test.ts`
- Test: `tests/unit/agentWorkflow.test.ts`

- [x] **Step 1: Add failing coverage-gate tests**

Add a test that prevents valid circuit finalization when coverage is insufficient:

```ts
test('valid circuit finalization is blocked when context coverage is insufficient', async () => {
  const result = await runAgentWithInjectedDraft({
    message: '초음파 센서 거리 표시기를 만들어줘',
    circuitSpec: unsafeSupportedLookingDraft,
    contextCoverage: {
      status: 'insufficient',
      score: 0.67,
      requiredSourceTypes: ['memory', 'policy', 'reference', 'data', 'registry', 'rendering'],
      presentSourceTypes: ['memory', 'policy', 'reference'],
      missingSourceTypes: ['data', 'registry', 'rendering'],
      warnings: ['distance-sensor-display is planned, not supported']
    }
  });

  assert.notEqual(result.validationReport.status, 'valid');
  assert.match(result.clarification ?? '', /지원|context|planned|준비/i);
});
```

- [x] **Step 2: Add coverage gate in finalization**

In `finalizeAgentResult()`, apply the rule before returning a valid result:

```ts
const coverageAllowsFinalCircuit = contextPacket.contextCoverage.status === 'sufficient';
const effectiveValidationReport = coverageAllowsFinalCircuit
  ? validationReport
  : downgradeValidationForCoverage(validationReport, contextPacket.contextCoverage);
```

`downgradeValidationForCoverage()` must add a deterministic warning/error such as:

```ts
{
  code: 'CONTEXT_COVERAGE_INSUFFICIENT',
  message: 'The agent did not have enough canonical context to safely finalize this circuit.'
}
```

- [x] **Step 3: Prevent simulation animation when coverage is insufficient**

Use `effectiveValidationReport`, not the raw validator result, when compiling simulation:

```ts
const currentPaths = await estimateCurrentPaths(circuitSpec, netlist, effectiveValidationReport);
const simulationPlan = await compileSimulationPlan(circuitSpec, effectiveValidationReport, currentPaths);
```

- [x] **Step 4: Run targeted tests**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextCoverage.test.ts tests/unit/agentWorkflow.test.ts
```

Expected:

```text
pass
```

Implementation checkpoint:

- `server/agent/circuitTools.ts` now exports `applyContextCoverageGate()`.
- `server/agent/deepAgentRuntime.ts` now compiles render, simulation, requirement markdown, clarification, and validator events from the coverage-gated validation report.
- `tests/unit/agentWorkflow.test.ts` proves that an otherwise valid LED circuit becomes invalid, produces no render parts, and produces no current animation when context coverage is insufficient.

### Task 4: Replace Lexical Matching With Scored Capability Retrieval

**Files:**

- Modify: `agent-context/data/capability-graph.json`
- Modify: `server/context/capabilityGraph.ts`
- Test: `tests/unit/contextPacketCapability.test.ts`
- Test: `tests/unit/contextSufficiencyEval.test.ts`

- [x] **Step 1: Add negative and paraphrase fixtures**

Add eval rows to `agent-context/evals/context-sufficiency-prompts.jsonl`:

```jsonl
{"id":"negative-display-word-only","prompt":"전류 흐름을 화면에서 보고 싶어","expectedSupport":"ambiguous","mustNotMatch":["distance-sensor-display","i2c-display-text"]}
{"id":"ko-light-sensing-paraphrase","prompt":"방이 어두워지면 자동으로 LED가 켜지게 해줘","expectedSupport":"planned","expectedCapability":"light-sensor-triggered-output"}
{"id":"mixed-servo-signal","prompt":"Arduino로 servo angle을 90도까지 움직이는 회로 보여줘","expectedSupport":"supported","expectedCapability":"servo-angle-output"}
```

- [x] **Step 2: Add retrieval score fields**

Each capability entry must expose:

```json
{
  "positivePhrases": ["servo", "angle", "90도", "move"],
  "requiredEvidence": ["servo"],
  "negativeEvidence": ["screen only", "visualize current"],
  "minimumScore": 0.62,
  "supportLevel": "supported"
}
```

- [x] **Step 3: Implement scored matching**

In `server/context/capabilityGraph.ts`, compute:

```ts
score = positivePhraseHits * 0.25
  + requiredEvidenceHits * 0.4
  + modalityHits * 0.25
  - negativeEvidenceHits * 0.5;
```

Return a match only when:

```ts
score >= capability.minimumScore
```

and all `requiredEvidence` are present after normalization.

- [x] **Step 4: Normalize Korean/English student wording before scoring**

Add normalization examples:

```ts
const NORMALIZED_TERMS = new Map([
  ['전원', 'power'],
  ['접지', 'ground'],
  ['불', 'light'],
  ['켜지', 'turn-on'],
  ['어두', 'dark'],
  ['거리', 'distance'],
  ['각도', 'angle']
]);
```

- [x] **Step 5: Run retrieval tests**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextPacketCapability.test.ts tests/unit/contextSufficiencyEval.test.ts
```

Expected:

```text
pass
```

Implementation checkpoint:

- `CapabilityGraphEntrySchema` now requires `positivePhrases`, `requiredEvidence`, `negativeEvidence`, and `minimumScore`.
- `agent-context/data/capability-graph.json` now carries scoring metadata for every capability.
- `server/context/capabilityGraph.ts` now computes normalized retrieval scores from positive phrase hits, required evidence hits, modality evidence, negative evidence, and per-capability minimum score.
- Single-token evidence now matches tokens exactly, so `led` no longer accidentally matches `oled`.
- Generic app-screen/current-flow wording no longer matches hardware display capabilities unless hardware evidence such as OLED, display message, or show-text intent is also present.
- `agent-context/evals/context-sufficiency-prompts.jsonl` now includes negative app-screen and mixed servo-signal eval rows.

### Task 5: Add Capability Bundle Promotion Rules

**Files:**

- Modify: `agent-context/data/capability-graph.json`
- Modify: `agent-context/data/part-capabilities.json`
- Modify: `agent-context/data/render-footprints.json`
- Modify: `agent-context/simulation/primitives.json`
- Modify: `tests/unit/contextCoverage.test.ts`

- [x] **Step 1: Add a test that prevents partial promotion**

```ts
test('a capability cannot be marked supported without registry, validation, render, simulation, and eval coverage', async () => {
  const report = await auditCapabilityCoverage('light-sensor-triggered-output');

  assert.equal(report.canBeSupported, false);
  assert.deepEqual(report.missing.sort(), [
    'part-capability',
    'render-footprint',
    'simulation-primitive',
    'validation-rule'
  ].sort());
});
```

- [x] **Step 2: Define promotion checklist in code**

Promotion requires all of:

```ts
const REQUIRED_CAPABILITY_ARTIFACTS = [
  'capability-graph-entry',
  'part-capability',
  'pin-aliases',
  'validation-rule',
  'simulation-primitive',
  'render-footprint',
  'eval-supported-prompt',
  'eval-unsupported-counterexample'
] as const;
```

- [x] **Step 3: Keep planned families planned until bundle is complete**

Any capability missing an artifact must produce:

```json
{
  "supportLevel": "planned",
  "coverageWarning": "Capability cannot be finalized because render-footprint and validation-rule are missing."
}
```

Implementation checkpoint:

- `server/context/contextLayer.ts` now exports `REQUIRED_CAPABILITY_ARTIFACTS` and `auditCapabilityCoverage()`.
- The promotion audit checks capability graph entry, required part registry entries, pin aliases, deterministic validation-rule support, simulation primitive existence, render footprint coverage, supported eval prompts, and unsupported counterexample evals.
- Planned capabilities such as `analog-led-dimmer` remain blocked when a required part such as `potentiometer-10k`, a render footprint, validation support, or supported eval evidence is missing.
- Supported starter capabilities such as `display-text-output` pass only when every required artifact is present.
- `tests/unit/contextCoverage.test.ts` now proves both incomplete planned-family blocking and fully supported starter-family promotion readiness.

### Task 5.5: Add Hierarchical Context Routing

**Why:** The context layer must be hierarchical in retrieval behavior, not only in folder layout. A Deepagent should not scan every `.md` and `.json` file for each student prompt. It should load a tiny always-on policy, route the request through an intent/capability map, and then fetch only the exact policy, reference, registry, rendering, validation, and simulation sources needed for the current circuit decision.

**Files:**

- Create: `agent-context/routing/context-routing-map.json`
- Create: `agent-context/routing/retrieval-budget.md`
- Modify: `agent-context/index.json`
- Modify: `agent-context/index.md`
- Modify: `server/context/contextLayer.ts`
- Modify: `server/context/contextPacket.ts`
- Test: `tests/unit/contextRouting.test.ts`
- Test: `tests/unit/contextPacket.test.ts`

- [x] **Step 1: Add routing metadata to the context index**

Each context source should expose compact metadata:

```json
{
  "id": "simulation:primitives",
  "level": "L4",
  "sourceType": "simulation",
  "tags": ["current-path", "signal-activity", "bus-activity"],
  "provides": ["SimulationPrimitive"],
  "loadWhen": ["validation.status=valid", "capability.requiresSimulation=true"],
  "canonical": true,
  "budget": "data-only"
}
```

- [x] **Step 2: Add typed route and retrieval contracts**

`server/agent/schemas.ts` must define `ContextRouteSchema` and `RetrievalPlanSchema`, and `ContextPacketSchema` must expose both. This keeps routing observable and testable instead of hiding it inside prompt assembly.

```ts
export const ContextRouteSchema = z.object({
  routeId: z.string().min(1),
  intentSignals: z.array(z.string()).default([]),
  capabilityIds: z.array(z.string()).default([]),
  sourceIds: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1)
});

export const RetrievalPlanSchema = z.object({
  sourceIds: z.array(z.string()).default([]),
  omittedSourceIds: z.array(z.string()).default([]),
  budget: z.enum(['minimal', 'summary', 'data-only', 'full']),
  maxPromptChars: z.number().positive(),
  warnings: z.array(z.string()).default([])
});
```

- [x] **Step 3: Add deterministic context routing map**

The routing map should connect normalized intent and capability evidence to bounded context bundles:

```json
{
  "routeId": "digital-output-series-load",
  "when": {
    "capabilityRoles": ["controller-digital-output", "series-resistor", "dc-load"],
    "modalities": ["light-output"]
  },
  "load": {
    "always": ["memory:agent-rules"],
    "policy": ["policy:safety", "policy:truthfulness"],
    "reference": ["reference:validation-rules"],
    "registry": ["registry:part-capabilities"],
    "data": ["data:capability-graph", "data:render-footprints"],
    "simulation": ["simulation:primitives"]
  }
}
```

- [x] **Step 4: Resolve source IDs consistently**

Route files may use namespaced IDs such as `policy:safety` and `simulation:primitives`, but `agent-context/index.json` must either store the same canonical IDs or provide aliases. Exact source resolution must fail tests when a route references a missing source.

- [x] **Step 5: Enforce retrieval budgets before prompt assembly**

`buildContextPacket()` should run in two phases:

1. infer intent/safety/capability evidence and select `contextRoute`;
2. load only the assets listed by `retrievalPlan`.

The prompt should include concise summaries and evidence IDs, not full raw documents, unless a skill explicitly needs a source. Tests must check that ambiguous or unsupported requests do not eager-load heavy registry, rendering, or simulation catalogs.

- [x] **Step 6: Add route coverage tests**

Tests must prove that:

- a button/LED request loads switch, digital output, validation, rendering, and simulation sources;
- a display-only wording request does not load hardware display sources without hardware evidence;
- unsupported or ambiguous routes return a small policy/context packet and do not over-fetch registry data;
- every source id in the routing map exists in `agent-context/index.json`.
- route coverage is source-id-level, not only source-type-level;
- generated prompt blocks remain under the configured retrieval budget.

- [x] **Step 7: Keep canonical truth outside prose**

`.md` files may explain routing and agent behavior, but final validation must continue to use Zod-validated `.json` data and deterministic tools.

Implementation checkpoint:

- Added `agent-context/routing/context-routing-map.json` and `agent-context/routing/retrieval-budget.md`.
- `loadContextIndex()` now exposes enriched hierarchical metadata (`sourceId`, aliases, level, source type, tags, provided artifact, load conditions, budget).
- `ContextPacket` now exposes typed `contextRoute` and `retrievalPlan`.
- `buildContextPacket()` now routes before loading registry/render/simulation assets. Ambiguous and unsupported requests stay policy-first and omit heavy render/simulation catalogs.
- Live Deepagents prompt now receives only route-selected candidate registry entries instead of the full registry summary.
- Verification passed: `npm exec -- tsx --test tests/unit/contextRouting.test.ts tests/unit/contextPacket.test.ts tests/unit/contextSufficiencyEval.test.ts`, `npm run typecheck`, and `npm run test:unit`.

### Task 6: Build Topology Templates Instead Of Part Branches

**Files:**

- Create: `agent-context/electrical/topology-templates.json`
- Create: `agent-context/schemas/topology-template.schema.json`
- Modify: `server/agent/circuitTools.ts`
- Test: `tests/unit/circuitTutor.test.ts`
- Test: `tests/unit/agentWorkflow.test.ts`

- [x] **Step 1: Add topology template schema**

Create `agent-context/schemas/topology-template.schema.json`:

```json
{
  "$id": "https://h-eduware.local/schemas/topology-template.schema.json",
  "type": "object",
  "required": ["id", "requiredRoles", "nets", "connections", "validationRules"],
  "properties": {
    "id": { "type": "string" },
    "requiredRoles": { "type": "array", "items": { "type": "string" } },
    "nets": { "type": "array", "items": { "type": "string" } },
    "connections": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["fromRole", "toNet"],
        "properties": {
          "fromRole": { "type": "string" },
          "toNet": { "type": "string" }
        }
      }
    },
    "validationRules": { "type": "array", "items": { "type": "string" } }
  }
}
```

- [x] **Step 2: Add topology templates**

Create `agent-context/electrical/topology-templates.json`:

```json
[
  {
    "id": "controller-digital-output-series-load",
    "requiredRoles": ["controller-digital-output", "series-resistor", "dc-load", "ground"],
    "nets": ["controller-output-net", "load-return-net", "ground"],
    "connections": [
      { "fromRole": "controller-digital-output", "toNet": "controller-output-net" },
      { "fromRole": "series-resistor.input", "toNet": "controller-output-net" },
      { "fromRole": "series-resistor.output", "toNet": "load-return-net" },
      { "fromRole": "dc-load.input", "toNet": "load-return-net" },
      { "fromRole": "dc-load.output", "toNet": "ground" }
    ],
    "validationRules": ["series-current-limit", "closed-ground-return", "polarity-required"]
  }
]
```

- [x] **Step 3: Compile candidate topology from capabilities**

Add a deterministic topology selector:

```ts
export function selectTopologyTemplate(intent: IntentSpecV2, capabilities: CapabilityMatch[]) {
  const requiredRoles = new Set(capabilities.flatMap((match) => match.requiredRoles));
  return topologyTemplates.find((template) =>
    template.requiredRoles.every((role) => requiredRoles.has(role))
  ) ?? null;
}
```

- [x] **Step 4: Run topology tests**

Run:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
```

Expected:

```text
pass
```

Implementation checkpoint:

- `agent-context/schemas/topology-template.schema.json` and `agent-context/electrical/topology-templates.json` now define role-based circuit structures instead of hardware-order branches.
- `server/agent/schemas.ts` now includes `TopologyTemplateSchema`, `TopologyTemplate`, and `CapabilityGraphEntry.requiredRoles`.
- `server/context/contextAssets.ts` and `server/context/contextLayer.ts` now load and export `loadTopologyTemplates()`.
- `agent-context/data/capability-graph.json` now attaches topology roles to supported starter capabilities so synthesis can map behavior to circuit structure before validation.
- `server/agent/circuitTools.ts` now exports `selectTopologyTemplate()` and records selected topology evidence in `validationReport.electricalAnalysis`.
- `tests/unit/agentWorkflow.test.ts` now proves that display, protected digital load, button plus output, low-current sound output, and PWM actuator requests select different reusable topology templates.

### Task 7: Add Bounded Validation Repair Loop

**Files:**

- Modify: `server/agent/deepAgentRuntime.ts`
- Modify: `server/agent/circuitTools.ts`
- Test: `tests/unit/agentWorkflow.test.ts`

- [x] **Step 1: Add failing repair-loop test**

```ts
test('agent repair loop retries once with deterministic validation errors', async () => {
  const result = await runAgentWithScriptedDrafts([
    missingResistorLedDraft,
    repairedLedDraft
  ]);

  assert.equal(result.validationReport.status, 'valid');
  assert.ok(result.agentEvents.some((event) =>
    event.name === 'validation-repair' &&
    event.summary?.includes('MISSING_REQUIRED_PASSIVE')
  ));
});
```

- [x] **Step 2: Implement exactly bounded retries**

In `runLiveAgent()`:

```ts
const maxAttempts = 2;
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const draft = await invokeDeepAgent({ attempt, previousErrors });
  const finalized = await tryFinalizeAgentResult({ draft, contextPacket });
  if (finalized.validationReport.status === 'valid') {
    return finalized;
  }
  previousErrors = finalized.validationReport.errors;
}
return finalUnsupportedOrClarificationResult(previousErrors);
```

The loop must not silently mutate circuit specs outside deterministic repair rules.

Implementation checkpoint:

- `server/agent/deepAgentRuntime.ts` now runs draft finalization through a bounded validation repair loop with `maxAttempts = 2`.
- The live Deepagent prompt for attempt 2 includes deterministic validation errors from attempt 1 and instructs the model to repair only by returning a new context-grounded `CircuitSpec`.
- `runAgentWithScriptedDrafts()` now provides a deterministic no-network harness for testing the same repair loop without live model calls.
- Repair events are surfaced as `validation-repair`; exhausted attempts are surfaced as `validation-repair-exhausted`.
- The loop does not mutate invalid specs into valid ones. Tests prove a third valid scripted draft is not consumed after two invalid attempts.
- `tests/unit/agentWorkflow.test.ts` now proves both the successful missing-resistor repair path and the bounded failure path.

### Task 8: Generalize Simulation From Primitive Contracts

**Files:**

- Modify: `agent-context/simulation/primitives.json`
- Modify: `server/agent/circuitTools.ts`
- Modify: `src/stageScene.js`
- Test: `tests/unit/agentWorkflow.test.ts`
- Test: `tests/e2e/features.spec.js`

- [x] **Step 1: Add primitive contract tests for multi-path behavior**

```ts
test('sensor plus display primitive separates sensor supply, signal, and display bus activity', async () => {
  const primitive = getSimulationPrimitive('sensor-display-readout');

  assert.equal(primitive.currentPathRecipe.pathTemplates.length, 3);
  assert.deepEqual(
    primitive.currentPathRecipe.pathTemplates.map((path) => path.kind),
    ['supply-current', 'signal-activity', 'bus-activity']
  );
});
```

- [x] **Step 2: Extend `CurrentPath.kind` semantics**

Supported path kinds should include:

```ts
const CurrentPathKindSchema = z.enum([
  'load-current',
  'supply-current',
  'signal-activity',
  'bus-activity',
  'sensing-divider',
  'fault-current'
]);
```

- [x] **Step 3: Render simulation overlays by kind**

In `src/stageScene.js`, map path kinds to overlay behavior:

```js
const CURRENT_PATH_STYLES = {
  'load-current': { color: 0xffc857, pulse: true },
  'supply-current': { color: 0x5ce1e6, pulse: true },
  'signal-activity': { color: 0x9bd67d, pulse: false },
  'bus-activity': { color: 0x84a9ff, pulse: false },
  'sensing-divider': { color: 0xf2a65a, pulse: true },
  'fault-current': { color: 0xff4d4d, pulse: true }
};
```

- [x] **Step 4: Prevent unsupported primitive animation**

`compileSimulationPlan()` must return warnings and no animated paths when the primitive is missing or validation is not valid.

Implementation checkpoint:

- `CurrentPath.kind` now accepts the semantic path families `load-current`, `supply-current`, `signal-activity`, `bus-activity`, `sensing-divider`, and `fault-current`.
- `agent-context/simulation/primitives.json` now models sensor/display behavior as separate supply current, sensor signal activity, and display bus activity paths.
- The analog threshold primitive now separates sensing-divider behavior from output-load current.
- `compileSimulationPlan()` now filters animated paths through `validationReport.validatedCurrentPathIds` and drops paths that reference unknown simulation primitives, adding deterministic warnings instead of animating unsupported paths.
- Requirement markdown now distinguishes signal/bus activity, sensing dividers, fault-current warnings, and measured load or supply current.
- `src/stageScene.js` now exposes semantic current-path overlay styles and disables simulation descriptors unless `simulationPlan.status === "valid"`.
- Targeted tests cover primitive multi-path contracts, semantic path schema parsing, validation-id filtering, and stage overlay descriptors.

### Task 9: Make Rendering Fully `RenderPlan`-Driven

**Files:**

- Modify: `agent-context/data/render-footprints.json`
- Modify: `server/agent/circuitTools.ts`
- Modify: `src/stageScene.js`
- Modify: `src/circuitInspector.js`
- Test: `tests/unit/stageScene.test.js`
- Test: `tests/e2e/features.spec.js`

- [x] **Step 1: Add render-plan completeness tests**

```js
test('stage scene uses renderPlan endpoint anchors before local fallbacks', () => {
  const scene = createStageScene({ canvas: fakeCanvas });
  scene.updateProject({
    renderPlan: {
      layout: {
        endpoints: {
          'led-1.A': { x: 1, y: 0.2, z: -0.5 },
          'led-1.K': { x: 1.2, y: 0.2, z: -0.5 }
        }
      },
      parts: [
        {
          componentId: 'led-1',
          footprintId: 'led-5mm',
          footprint: {
            dimensions: { width: 0.2, height: 0.4, depth: 0.2 },
            visualStyle: { shape: 'led', color: '#ff4444', material: 'translucent' }
          }
        }
      ],
      wires: []
    }
  });

  assert.ok(scene.getInteractiveTargets().some((target) => target.id === 'led-1'));
});
```

- [x] **Step 2: Add hover target metadata to footprints**

Each footprint should expose:

```json
{
  "hoverTargets": [
    {
      "id": "body",
      "label": "LED body",
      "explainableAs": ["polarity", "current-limited-load"]
    },
    {
      "id": "pin-anode",
      "label": "Anode",
      "pin": "A"
    }
  ]
}
```

- [x] **Step 3: Surface missing footprint warnings**

If a part has no footprint:

```ts
renderPlan.warnings.push({
  code: 'MISSING_RENDER_FOOTPRINT',
  componentId,
  message: 'This part is validated electrically but cannot be visualized yet.'
});
```

The frontend must show this warning in PCB/Files.

Implementation checkpoint:

- `RenderFootprintEntrySchema` now supports `hoverTargets`, and every starter footprint declares body/pin-level hover metadata for inspector grounding.
- `stageGenericPartDescriptors()` now carries footprint hover targets into stage descriptors and inspectable part targets.
- `RenderPlanSchema` now includes structured `warnings`.
- `compileRenderPlan()` emits `MISSING_RENDER_FOOTPRINT` warnings when a validated component has no visual footprint instead of silently pretending the visual layer is complete.
- Agent-created projects now preserve `renderPlan.warnings`, add a render-warning Markdown file in Files, and show a compact warning panel on the PCB surface.
- Tests cover hover target catalog completeness, descriptor propagation, and missing-footprint warning compilation.

### Task 10: Add Circuit Inspector Tutor Agent Grounded In Selected Target

**Files:**

- Modify: `server/agent/circuitTutor.ts`
- Modify: `server/agent/schemas.ts`
- Modify: `src/circuitInspector.js`
- Modify: `src/main.js`
- Test: `tests/unit/circuitTutor.test.ts`
- Test: `tests/e2e/features.spec.js`

- [x] **Step 1: Add target-grounded tutor schema test**

```ts
test('tutor request requires selected target and active circuit artifacts', () => {
  const parsed = TutorMessageRequestSchema.parse({
    locale: 'ko',
    message: '왜 여기에 저항이 필요해?',
    selectedTarget: {
      id: 'resistor-1',
      kind: 'component',
      componentId: 'resistor-1',
      pin: null
    },
    circuitSpec,
    validationReport,
    simulationPlan,
    contextTrace
  });

  assert.equal(parsed.selectedTarget.componentId, 'resistor-1');
});
```

- [x] **Step 2: Force tutor context**

`runTutorAgent()` must build its answer from:

- selected render target
- `CircuitSpec`
- `ValidationReport`
- `SimulationPlan`
- `contextTrace`
- matching context docs

It must refuse unsupported physical claims:

```text
이 설명은 H-eduware의 단순화된 교육용 모델 기준입니다. 실제 부품 발열, 오차, 고장 모드는 현재 시뮬레이션하지 않습니다.
```

- [x] **Step 3: UI inspector chat**

When a student hovers or clicks a component/wire:

- show target name
- show role in circuit
- show current/signal state when available
- allow one question input
- call `/api/agent/explain-target`
- display tutor answer and context evidence

Implementation checkpoint:

- `TutorMessageRequestSchema` now accepts `selectedTarget` and normalizes it into `target`.
- Server tutor requests now require active circuit artifacts: `CircuitSpec`, `ValidationReport`, `SimulationPlan`, and `contextTrace`.
- `runTutorAgent()` grounds responses in selected target, validation status, simulation status, validated current path ids, simulation current path ids, and context trace source ids.
- Current-flow explanations are refused when the circuit or simulation is not valid instead of making unsupported physical claims.
- Frontend tutor server calls now send selected target plus active artifacts from the agent-created project; if the opt-in server path rejects a request, the deterministic local tutor remains the default fallback.
- Existing inspector UI already supports hover/selection, suggested questions, tutor chat messages, and selected circuit target state.

### Task 11: Build Generalization Eval Harness

**Files:**

- Create: `tests/unit/generalizationEval.test.ts`
- Modify: `agent-context/evals/context-sufficiency-prompts.jsonl`
- Modify: `agent-context/evals/expected-validation-results.jsonl`
- Modify: `agent-context/evals/expected-simulation-results.jsonl`
- Modify: `package.json`

- [x] **Step 1: Add prompt-family eval reader**

Create `tests/unit/generalizationEval.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('generalization eval corpus covers required prompt families', async () => {
  const raw = await readFile('agent-context/evals/context-sufficiency-prompts.jsonl', 'utf8');
  const rows = raw.trim().split('\n').map((line) => JSON.parse(line));
  const families = new Set(rows.map((row) => row.family));

  for (const family of [
    'display-output',
    'light-output',
    'sound-output',
    'motion-output',
    'digital-input',
    'analog-input',
    'sensor-readout',
    'multi-output',
    'ambiguous',
    'unsafe',
    'unsupported',
    'mixed-language',
    'typo-heavy'
  ]) {
    assert.ok(families.has(family), `missing eval family: ${family}`);
  }
});
```

- [x] **Step 2: Add eval command**

In `package.json`:

```json
{
  "scripts": {
    "eval:generalization": "tsx --test tests/unit/generalizationEval.test.ts"
  }
}
```

- [x] **Step 3: Track failure taxonomy**

Each eval row must allow:

```json
{
  "expectedFailureClass": "context-gap | registry-gap | validator-gap | renderer-gap | simulator-gap | model-synthesis-gap | unsafe-request | ambiguous-request"
}
```

Implementation checkpoint:

- Added `tests/unit/generalizationEval.test.ts`.
- Added `npm run eval:generalization`.
- Expanded `agent-context/evals/context-sufficiency-prompts.jsonl` with required prompt families: display, light, sound, motion, digital input, analog input, sensor readout, multi-output, ambiguous, unsafe, unsupported, mixed-language, and typo-heavy.
- Added `family` and `expectedFailureClass` taxonomy fields to context, validation, and simulation eval fixtures.
- Verification passed: `npm run eval:generalization`, `npm exec -- tsx --test tests/unit/contextSufficiencyEval.test.ts tests/unit/contextRouting.test.ts`, and `npm run typecheck`.

### Task 12: Browser Verification Must Inspect Product Experience

**Files:**

- Modify: `tests/e2e/features.spec.js`
- Modify: `tests/e2e/live-agent.spec.js`
- Create: `docs/browser_generalization_verification.md`

- [x] **Step 1: Create browser verification protocol**

Create `docs/browser_generalization_verification.md` with this required flow:

```md
# Browser Generalization Verification

For each prompt family:

1. Open `http://127.0.0.1:4173/`.
2. Submit a natural student prompt.
3. Verify the chat does not expose server env names or secrets.
4. Verify Files tab includes requirement markdown and context coverage.
5. Verify PCB tab has nonblank canvas and visible parts from `RenderPlan`.
6. Hover or select at least one component and one wire.
7. Ask the inspector tutor why that target is needed.
8. Open Run tab.
9. Verify current animation appears only when validation is valid.
10. Record failure class when any step fails.
```

- [x] **Step 2: Add browser E2E assertions**

In `tests/e2e/features.spec.js`, assert:

```js
await expect(page.getByText(/Context|근거|Coverage|출처/i)).toBeVisible();
await expect(page.getByTestId('pcb-canvas')).toBeVisible();
await expect(page.getByText(/Run|실행|Current|전류/i)).toBeVisible();
```

- [x] **Step 3: Keep live E2E opt-in**

Live tests must remain skipped unless the live runtime is configured. Default `npm run check` must not require a successful paid model call.

Implementation checkpoint:

- Added `docs/browser_generalization_verification.md`.
- Added an offline-safe browser verification E2E that checks Files, PCB, nonblank canvas evidence, wire selection, part selection, inspector tutor chat, Run output, and secret redaction in the visible UI.
- Strengthened live E2E expectations so live agent output must expose sufficient context coverage and the generated Context trace file must show Coverage status.
- Live tests remain opt-in through `RUN_LIVE_E2E=1` and are skipped by default.
- Verification passed: `npm exec -- playwright test tests/e2e/features.spec.js -g "browser verification protocol"`.

### Task 13: Add UI Evidence That Generalization Is Working

**Files:**

- Modify: `src/main.js`
- Modify: `src/styles.css`
- Modify: `src/locales/ko.js`
- Modify: `src/locales/en.js`
- Test: `tests/unit/i18n.test.js`
- Test: `tests/e2e/features.spec.js`

- [x] **Step 1: Add localized labels**

Korean labels:

```js
contextCoverage: '컨텍스트 충족도',
contextSources: '참고한 근거',
unsupportedReason: '지원할 수 없는 이유',
simulationBasis: '시뮬레이션 근거',
validationWarnings: '검증 경고'
```

English labels:

```js
contextCoverage: 'Context coverage',
contextSources: 'Grounding sources',
unsupportedReason: 'Why this is unsupported',
simulationBasis: 'Simulation basis',
validationWarnings: 'Validation warnings'
```

- [x] **Step 2: Show coverage without turning UI into a debug console**

Files tab should show:

```md
## 컨텍스트 충족도

- 상태: sufficient
- 점수: 1.00
- 참고 근거: registry, simulation, rendering, validation
- 경고: 없음
```

For students, show concise evidence. Full raw JSON stays out of the main UI.

Implementation checkpoint:

- Added localized evidence labels in Korean and English for context coverage, grounding sources, unsupported reason, simulation basis, and validation warnings.
- Agent-created projects now carry `contextCoverage` into the active circuit model.
- Files tab now shows a compact `context-evidence-panel` only when agent context coverage exists. It summarizes status, score, source types, and warnings without dumping raw JSON into the main UI.
- Context trace Markdown now uses localized evidence labels for the student-facing coverage summary.
- Verification passed: `node --test tests/unit/i18n.test.js` and `npm run build`.

### Task 14: Define Data-First Hardware Expansion Rule

**Files:**

- Modify: `docs/context_layer_sufficiency_audit.md`
- Modify: `docs/generalized_hardware_simulation_plan.md`
- Modify: `agent-context/index.md`

- [x] **Step 1: Add explicit expansion rule**

Add this rule:

```text
No hardware family can move from planned to supported unless the same change includes capability graph entry, canonical part registry, pin aliases, electrical validation rule, simulation primitive, render footprint, supported eval prompt, unsupported counterexample, and browser-visible verification.
```

- [x] **Step 2: Add anti-regression note**

Add:

```text
Regression tests may use concrete hardware cases, but the roadmap must not be expressed as a fixed hardware order. A hardware case is a probe of pipeline capability, not a product objective.
```

Implementation checkpoint:

- Added the explicit data-first expansion rule to `agent-context/index.md`, `docs/generalized_hardware_simulation_plan.md`, and `docs/context_layer_sufficiency_audit.md`.
- Reaffirmed that regression tests may use concrete hardware examples only as probes of pipeline capability, not as a fixed implementation roadmap.

### Task 15: Full Verification

**Files:**

- Verify all changed files.

- [x] **Step 1: Run unit tests**

```powershell
npm test
```

Expected:

```text
pass
```

- [x] **Step 2: Run typecheck**

```powershell
npm run typecheck
```

Expected:

```text
pass
```

- [x] **Step 3: Run build**

```powershell
npm run build
```

Expected:

```text
vite build completes successfully
```

- [x] **Step 4: Run default check**

```powershell
npm run check
```

Expected:

```text
unit tests pass, typecheck passes, production build passes, E2E passes or live-only tests are explicitly skipped
```

- [x] **Step 5: Run live smoke only when explicitly evaluating model behavior**

```powershell
npm run check:live
```

Expected:

```text
live tests pass only when OPENAI_API_KEY and H_EDUWARE_AGENT_MODEL are configured
```

Implementation checkpoint:

- `npm run eval:generalization` passed.
- `npm run check` passed.
- Default verification result: 67 unit tests passed, typecheck passed, production build passed, 22 E2E tests passed, and 8 live opt-in E2E tests were skipped by default.
- `npm run check:live` was not run because live model-behavior evaluation was not explicitly requested for this verification pass; live browser/API tests remain opt-in through `RUN_LIVE_E2E=1` and server configuration.

## 5. Implementation Order

This order is about architectural dependency, not hardware examples:

1. Runtime model and safety guardrails.
2. IntentSpecV2.
3. Context coverage gate.
4. Scored capability retrieval.
5. Capability promotion audit.
6. Hierarchical context routing and retrieval budgets.
7. Topology templates.
8. Validation repair loop.
9. Primitive-based simulation.
10. RenderPlan-driven visualization.
11. Target-grounded tutor agent.
12. Generalization eval harness.
13. Browser verification protocol.
14. Student-facing context evidence.

## 6. Milestone Definitions

### Milestone A: No Hallucinated Valid Circuits

The app can no longer return a valid circuit unless context coverage and deterministic validation both pass.

### Milestone B: Queries Map To Capabilities, Not Demo Branches

Student wording maps to capability records through scored retrieval and negative evidence. Specific demos are eval probes only.

### Milestone C: Simulation Is Composed

Current paths, signal activity, bus activity, analog sensing, and warnings come from reusable primitives.

### Milestone D: Visualization Is Data-Driven

The three.js stage renders from `RenderPlan.parts`, footprint dimensions, pin anchors, wires, overlays, and hover targets.

### Milestone E: Student Can Interrogate The Circuit

Hover/selection opens a target-grounded tutor chat that explains why a component, wire, pin, or current path exists.

### Milestone F: Evaluation Reports Capability Health

Reports classify failures as context gap, registry gap, validator gap, renderer gap, simulator gap, unsafe request, ambiguous request, or model synthesis gap.

## 7. Required Guardrails

- No API key in frontend code, logs, tests, screenshots, or docs.
- No valid status when `contextCoverage.status !== "sufficient"`.
- No animation when `validationReport.status !== "valid"`.
- No invented part ids, pin names, protocols, or simulator capabilities.
- No high-voltage or mains circuit visualization.
- No hardware family promoted to supported without the full data bundle.
- No roadmap phrased as a fixed hardware sequence.

## 8. Completion Criteria

This plan is complete when:

- The agent uses `gpt-5.5` in live runtime health.
- Arbitrary student prompts are processed through IntentSpecV2 and forced context coverage.
- Supported results cite sufficient context and validate deterministically.
- Unsupported or ambiguous results explain the exact gap.
- The stage renders from `RenderPlan`, not demo assumptions.
- Simulation uses primitive contracts and shows limitations.
- Hover/selection tutor chat explains selected circuit targets from artifacts.
- Generalization eval reports capability health by prompt family and failure class.
- `npm run check` passes in deterministic mode.

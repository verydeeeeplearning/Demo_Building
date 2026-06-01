# Agent Context v2 Information Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `agent-context` into a hierarchical, bundle-first source-of-truth layer that supports Deepagents without context bloat.

**Architecture:** Add a v2 context architecture beside the current v1 files, then route Deepagents through v2 bundle manifests while keeping compatibility adapters for existing validators, renderers, simulations, and tests. v2 uses small agent-readable bundle summaries, strict machine-readable manifests, shared canonical data references, and bounded retrieval budgets.

**Tech Stack:** Node server with TypeScript + Zod, existing `agent-context` Markdown/JSON/JSONL files, Deepagents + LangChain tools, deterministic validation/render/simulation tools, Node test runner, `tsx`, Vite, Playwright.

---

## Why This Is Needed

The current `agent-context` has the right ingredients but the wrong retrieval ergonomics for a growing Deepagents workflow.

Current structure:

```text
agent-context/
  registry/part-capabilities.json
  data/capability-graph.json
  data/render-footprints.json
  electrical/topology-templates.json
  simulation/primitives.json
  references/*.md
  policies/*.md
  routing/context-routing-map.json
  evals/*.jsonl
```

Problems:

- Context is organized mostly by artifact type, while student requests arrive by capability.
- One capability requires many cross-file reads.
- Agent-readable explanation and machine-readable truth are separated but not consistently packaged.
- Routing map loads broad source groups such as registry, simulation, and rendering.
- Adding hardware increases prompt and retrieval pressure unless the loading unit becomes smaller.
- Maintainers cannot inspect one capability in one place.

v2 target:

```text
student request
-> intent/capability match
-> selected v2 bundle manifest
-> small BUNDLE.md summary for prompt
-> exact shared canonical ids for tools/validator/render/simulation
-> coverage gate blocks anything outside the selected bundle
```

## v2 Retrieval Levels

Use these levels consistently:

- `L0`: always-loaded constitutional rules. Very small. No hardware facts.
- `L1`: route selectors and safety/clarification policy. Small.
- `L2`: selected capability bundle summaries. Agent-readable.
- `L3`: selected bundle manifests and shared canonical IDs. Tool-readable.
- `L4`: heavy canonical data loaded only by deterministic tools: full part registry, footprints, primitives, evals, source claims.

Prompt budget rule:

- L0 + L1 are always small.
- L2 is the main agent prompt payload.
- L3 may be summarized into prompt only as IDs and compact constraints.
- L4 must stay out of the prompt unless a specific tool response is bounded and concise.

## Source-of-Truth Responsibilities

Deepagents must not treat its own generated text as the source of truth. v2 separates each responsibility so the agent can reason with small context while deterministic tools verify the actual circuit.

| Layer | Artifact | Authority | Prompt Usage |
| --- | --- | --- | --- |
| L0 | `AGENTS.md`, invariant rules | Defines non-negotiable behavior such as no unverified circuit confirmation | Always included, short |
| L1 | `routes.json`, policy docs | Chooses whether to clarify, refuse, or enter a capability bundle | Included as compact policy IDs and selected policy summaries |
| L2 | `bundles/<id>/BUNDLE.md` | Gives the agent a concise capability explanation and common failure modes | Included for selected bundles only |
| L3 | `bundles/<id>/manifest.json` | Defines the exact allowed parts, required validators, primitives, render footprints, and canonical refs | Included as compact IDs and constraints |
| L4 | `shared/canonical/*.json`, `shared/sources/source-claims.json`, evals | Holds machine-readable hardware facts, provenance, and regression examples | Not included directly; loaded by bounded tools |
| Runtime | validators, netlist builder, render compiler, simulation compiler | Final decision on whether the circuit is valid and visualizable | Tool responses are concise and structured |

This means:

- `BUNDLE.md` helps the agent understand the capability; it does not validate a circuit.
- `manifest.json` is the capability contract; anything outside `allowedParts`, `validationRules`, `renderFootprints`, or `simulationPrimitives` must be clarified, unsupported, or rejected.
- `shared/canonical` data is the machine-readable truth for part pins, limits, footprints, topology templates, and simulation primitives.
- `shared/sources/source-claims.json` records where canonical claims came from and whether the claim is strong enough for synthesis, validation, rendering, or explanation.
- Validators decide `valid`, `invalid`, `needs_clarification`, or `unsupported`; Deepagents can propose, explain, and ask follow-up questions, but cannot override validator results.

## Deepagents Workflow Fit

The v2 layer supports this runtime workflow:

```text
student message
-> intent/capability classifier
-> route.v2 selection
-> selected bundle IDs
-> L0/L1/L2 compact prompt packet
-> subagents work from selected bundle summaries and manifest constraints
-> tools load L3/L4 canonical refs only from the selected bundle allowlist
-> validators produce final circuit status
-> renderer/simulator compile only from validated artifacts
-> student-facing answer cites capability evidence and validation result
```

Every agent tool should receive the same selected bundle allowlist. A subagent may request `read_context_doc("bundle:digital-light-output")`, but it must not read `bundle:display-text-output` unless that bundle was selected for the current request. Full part registries, footprint catalogs, and simulation primitive catalogs stay behind deterministic tool boundaries.

## Context Bloat Control Rules

Use these hard rules to prevent source-of-truth growth from turning into prompt growth:

- Select capability bundles before reading hardware facts.
- Load no more than three L2 bundles for one request unless the route is explicitly marked `multi-capability`.
- Keep each `BUNDLE.md` under 1500 characters.
- Keep the combined v2 context prompt section under 9000 characters for normal supported requests.
- Include source claim IDs in prompts, not long official excerpts.
- Include footprint and breadboard coordinate IDs in prompts, not full geometry arrays.
- Include simulation primitive IDs in prompts, not full current-path recipe payloads.
- Treat broad catalog loading as a test failure for normal supported routes.
- Move large examples and eval cases into L4, then expose only pass/fail summaries through audit tools.

## v2 Directory Shape

Create this structure:

```text
agent-context/
  v2/
    README.md
    index.json
    routes.json

    bundles/
      digital-light-output/
        BUNDLE.md
        manifest.json
        evals.jsonl

      display-text-output/
        BUNDLE.md
        manifest.json
        evals.jsonl

      button-controlled-light-output/
        BUNDLE.md
        manifest.json
        evals.jsonl

      sound-alert-output/
        BUNDLE.md
        manifest.json
        evals.jsonl

      servo-motion-output/
        BUNDLE.md
        manifest.json
        evals.jsonl

      analog-led-dimmer/
        BUNDLE.md
        manifest.json
        evals.jsonl

    shared/
      policies/
        safety.md
        clarification.md
        truthfulness.md
        unsupported.md

      canonical/
        parts.json
        footprints.json
        simulation-primitives.json
        topology-templates.json
        pin-aliases.json
        breadboard-grid.json

      sources/
        source-claims.json
        source-authority.md

    schemas/
      context-v2-index.schema.json
      route-v2.schema.json
      bundle-manifest.schema.json
```

Compatibility rule:

- v2 files may reference existing v1 canonical files at first.
- Do not duplicate all data immediately.
- First implementation should prove the v2 loading unit and prompt boundary.

## v2 Bundle Contract

### `BUNDLE.md`

Agent-readable and short. It should answer:

- What the capability supports.
- What it does not support.
- Required parts and pin roles.
- Required validation checks.
- Simulation truthfulness limits.
- Common mistakes.

Maximum target: 1500 characters per bundle.

### `manifest.json`

Tool-readable and authoritative.

```json
{
  "schemaVersion": "2026-06-01",
  "bundleId": "digital-light-output",
  "capabilityId": "digital-light-output",
  "supportLevel": "supported",
  "promptBudget": "summary",
  "agentSummaryPath": "bundles/digital-light-output/BUNDLE.md",
  "requiredParts": ["arduino-uno", "breadboard-half", "led-5mm", "resistor-220", "jumper-wire"],
  "allowedParts": ["arduino-uno", "breadboard-half", "led-5mm", "resistor-220", "jumper-wire"],
  "requiredTopologies": ["controller-digital-output-series-load"],
  "validationRules": ["series-current-limit", "led-polarity", "closed-current-path"],
  "simulationPrimitives": ["digital_on_off", "blink_timer", "current_flow_animation"],
  "renderFootprints": ["arduino", "breadboard", "led", "resistor", "wire"],
  "canonicalRefs": {
    "parts": ["shared:parts:arduino-uno", "shared:parts:led-5mm", "shared:parts:resistor-220"],
    "footprints": ["shared:footprint:arduino", "shared:footprint:led", "shared:footprint:resistor"],
    "simulation": ["shared:primitive:digital_on_off", "shared:primitive:current_flow_animation"],
    "topology": ["shared:topology:controller-digital-output-series-load"],
    "sources": ["shared:source:led-5mm-requires-current-limit"]
  },
  "promptInclusions": {
    "includePins": true,
    "includeElectricalLimits": true,
    "includeFootprintAnchors": false,
    "includeSourceQuotes": false
  },
  "blockingConditions": [
    "missing-source-claims",
    "missing-render-footprint",
    "missing-simulation-primitive",
    "unsupported-part-requested"
  ]
}
```

## Implementation Strategy

Do not delete v1 context. Build v2 beside it and add adapters.

Phase 1:

- Add schemas.
- Add v2 index and route files.
- Add two migrated bundles: `digital-light-output`, `display-text-output`.
- Add loader tests.

Phase 2:

- Teach `buildContextPacket()` to prefer v2 bundle route when available.
- Add prompt block sections for selected v2 bundles.
- Keep v1 fallback for routes not migrated.

Phase 3:

- Add bundle coverage gates.
- Restrict Deepagents tools to selected bundle canonical refs.
- Add QA/eval coverage.

Phase 4:

- Migrate remaining supported/planned bundles.
- Reduce v1 routing map usage.
- Keep v1 canonical data as shared data until fully split.

## Task 1: Add v2 Bundle Manifest Schema

**Files:**

- Create: `agent-context/v2/schemas/bundle-manifest.schema.json`
- Modify: `server/context/contextLayer.ts`
- Create: `tests/unit/contextV2Architecture.test.ts`

- [ ] **Step 1: Write failing schema test**

Create `tests/unit/contextV2Architecture.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { ContextBundleManifestV2Schema } from '../../server/context/contextLayer.ts';

test('v2 bundle manifest separates prompt summary from canonical refs', () => {
  const manifest = ContextBundleManifestV2Schema.parse({
    schemaVersion: '2026-06-01',
    bundleId: 'digital-light-output',
    capabilityId: 'digital-light-output',
    supportLevel: 'supported',
    promptBudget: 'summary',
    agentSummaryPath: 'bundles/digital-light-output/BUNDLE.md',
    requiredParts: ['arduino-uno', 'breadboard-half', 'led-5mm', 'resistor-220'],
    allowedParts: ['arduino-uno', 'breadboard-half', 'led-5mm', 'resistor-220', 'jumper-wire'],
    requiredTopologies: ['controller-digital-output-series-load'],
    validationRules: ['series-current-limit', 'led-polarity', 'closed-current-path'],
    simulationPrimitives: ['digital_on_off', 'blink_timer', 'current_flow_animation'],
    renderFootprints: ['arduino', 'breadboard', 'led', 'resistor', 'wire'],
    canonicalRefs: {
      parts: ['shared:parts:arduino-uno', 'shared:parts:led-5mm', 'shared:parts:resistor-220'],
      footprints: ['shared:footprint:arduino', 'shared:footprint:led', 'shared:footprint:resistor'],
      simulation: ['shared:primitive:digital_on_off', 'shared:primitive:current_flow_animation'],
      topology: ['shared:topology:controller-digital-output-series-load'],
      sources: ['shared:source:led-5mm-requires-current-limit']
    },
    promptInclusions: {
      includePins: true,
      includeElectricalLimits: true,
      includeFootprintAnchors: false,
      includeSourceQuotes: false
    },
    blockingConditions: ['missing-source-claims', 'missing-render-footprint']
  });

  assert.equal(manifest.bundleId, 'digital-light-output');
  assert.equal(manifest.promptInclusions.includeSourceQuotes, false);
  assert.ok(manifest.canonicalRefs.parts.includes('shared:parts:arduino-uno'));
});
```

- [ ] **Step 2: Run failing schema test**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextV2Architecture.test.ts
```

Expected:

- Fails because `ContextBundleManifestV2Schema` is not exported.

- [ ] **Step 3: Add Zod schema**

Add to `server/context/contextLayer.ts`:

```ts
export const ContextBundleManifestV2Schema = z.object({
  schemaVersion: z.string().min(1),
  bundleId: z.string().min(1),
  capabilityId: z.string().min(1),
  supportLevel: z.enum(['supported', 'partial', 'planned', 'unsupported']),
  promptBudget: ContextRetrievalBudgetSchema,
  agentSummaryPath: z.string().min(1),
  requiredParts: z.array(z.string().min(1)).default([]),
  allowedParts: z.array(z.string().min(1)).default([]),
  requiredTopologies: z.array(z.string().min(1)).default([]),
  validationRules: z.array(z.string().min(1)).default([]),
  simulationPrimitives: z.array(z.string().min(1)).default([]),
  renderFootprints: z.array(z.string().min(1)).default([]),
  canonicalRefs: z.object({
    parts: z.array(z.string().min(1)).default([]),
    footprints: z.array(z.string().min(1)).default([]),
    simulation: z.array(z.string().min(1)).default([]),
    topology: z.array(z.string().min(1)).default([]),
    sources: z.array(z.string().min(1)).default([])
  }),
  promptInclusions: z.object({
    includePins: z.boolean().default(false),
    includeElectricalLimits: z.boolean().default(false),
    includeFootprintAnchors: z.boolean().default(false),
    includeSourceQuotes: z.boolean().default(false)
  }),
  blockingConditions: z.array(z.string().min(1)).default([])
});

export type ContextBundleManifestV2 = z.infer<typeof ContextBundleManifestV2Schema>;
```

- [ ] **Step 4: Add JSON schema mirror**

Create `agent-context/v2/schemas/bundle-manifest.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://h-eduware.local/schemas/context-v2/bundle-manifest.schema.json",
  "title": "ContextBundleManifestV2",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "bundleId", "capabilityId", "supportLevel", "promptBudget", "agentSummaryPath", "canonicalRefs", "promptInclusions"],
  "properties": {
    "schemaVersion": { "type": "string" },
    "bundleId": { "type": "string" },
    "capabilityId": { "type": "string" },
    "supportLevel": { "type": "string", "enum": ["supported", "partial", "planned", "unsupported"] },
    "promptBudget": { "type": "string", "enum": ["minimal", "summary", "data-only", "full"] },
    "agentSummaryPath": { "type": "string" },
    "requiredParts": { "type": "array", "items": { "type": "string" } },
    "allowedParts": { "type": "array", "items": { "type": "string" } },
    "requiredTopologies": { "type": "array", "items": { "type": "string" } },
    "validationRules": { "type": "array", "items": { "type": "string" } },
    "simulationPrimitives": { "type": "array", "items": { "type": "string" } },
    "renderFootprints": { "type": "array", "items": { "type": "string" } },
    "canonicalRefs": {
      "type": "object",
      "required": ["parts", "footprints", "simulation", "topology", "sources"],
      "properties": {
        "parts": { "type": "array", "items": { "type": "string" } },
        "footprints": { "type": "array", "items": { "type": "string" } },
        "simulation": { "type": "array", "items": { "type": "string" } },
        "topology": { "type": "array", "items": { "type": "string" } },
        "sources": { "type": "array", "items": { "type": "string" } }
      }
    },
    "promptInclusions": {
      "type": "object",
      "required": ["includePins", "includeElectricalLimits", "includeFootprintAnchors", "includeSourceQuotes"],
      "properties": {
        "includePins": { "type": "boolean" },
        "includeElectricalLimits": { "type": "boolean" },
        "includeFootprintAnchors": { "type": "boolean" },
        "includeSourceQuotes": { "type": "boolean" }
      }
    },
    "blockingConditions": { "type": "array", "items": { "type": "string" } }
  }
}
```

- [ ] **Step 5: Verify schema test passes**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextV2Architecture.test.ts
```

Expected:

- The v2 manifest schema test passes.

## Task 2: Add v2 Index and Route Schema

**Files:**

- Create: `agent-context/v2/index.json`
- Create: `agent-context/v2/routes.json`
- Create: `agent-context/v2/schemas/context-v2-index.schema.json`
- Create: `agent-context/v2/schemas/route-v2.schema.json`
- Modify: `server/context/contextLayer.ts`
- Modify: `tests/unit/contextV2Architecture.test.ts`

- [ ] **Step 1: Add failing loader test**

Append to `tests/unit/contextV2Architecture.test.ts`:

```ts
import { loadContextV2Index, loadContextV2Routes } from '../../server/context/contextLayer.ts';

test('v2 context index and routes load bundle-first retrieval metadata', async () => {
  const [index, routes] = await Promise.all([
    loadContextV2Index(),
    loadContextV2Routes()
  ]);

  assert.equal(index.version, '2026-06-01');
  assert.ok(index.bundles.some((bundle) => bundle.bundleId === 'digital-light-output'));
  assert.ok(routes.routes.some((route) => route.routeId === 'v2-digital-light-output'));
  assert.ok(routes.routes.every((route) => route.bundleIds.length > 0 || route.policyOnly === true));
});
```

- [ ] **Step 2: Run failing loader test**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextV2Architecture.test.ts
```

Expected:

- Fails because v2 loader functions and files do not exist.

- [ ] **Step 3: Add Zod schemas and loaders**

Add to `server/context/contextLayer.ts`:

```ts
const ContextV2IndexSchema = z.object({
  version: z.string().min(1),
  root: z.literal('agent-context/v2'),
  bundles: z.array(z.object({
    bundleId: z.string().min(1),
    capabilityId: z.string().min(1),
    manifestPath: z.string().min(1),
    summaryPath: z.string().min(1),
    evalPath: z.string().min(1).optional(),
    level: ContextLevelSchema,
    budget: ContextRetrievalBudgetSchema
  })),
  shared: z.record(z.string(), z.string())
});

const ContextV2RouteSchema = z.object({
  routeId: z.string().min(1),
  priority: z.number().int(),
  policyOnly: z.boolean().default(false),
  when: z.object({
    capabilityIds: z.array(z.string()).default([]),
    supportLevels: z.array(z.enum(['supported', 'partial', 'planned', 'unsupported'])).default([]),
    modalities: z.array(z.string()).default([]),
    ambiguity: z.boolean().optional(),
    unsafe: z.boolean().optional()
  }),
  bundleIds: z.array(z.string()).default([]),
  alwaysInclude: z.array(z.string()).default([]),
  maxPromptChars: z.number().int().positive(),
  reason: z.string().min(1)
});

const ContextV2RoutesSchema = z.object({
  version: z.string().min(1),
  routes: z.array(ContextV2RouteSchema).min(1)
});

export type ContextV2Index = z.infer<typeof ContextV2IndexSchema>;
export type ContextV2Routes = z.infer<typeof ContextV2RoutesSchema>;

export async function loadContextV2Index(root = DEFAULT_CONTEXT_ROOT): Promise<ContextV2Index> {
  const raw = await readFile(path.join(root, 'v2/index.json'), 'utf8');
  return ContextV2IndexSchema.parse(JSON.parse(raw));
}

export async function loadContextV2Routes(root = DEFAULT_CONTEXT_ROOT): Promise<ContextV2Routes> {
  const raw = await readFile(path.join(root, 'v2/routes.json'), 'utf8');
  return ContextV2RoutesSchema.parse(JSON.parse(raw));
}
```

- [ ] **Step 4: Create v2 index**

Create `agent-context/v2/index.json`:

```json
{
  "version": "2026-06-01",
  "root": "agent-context/v2",
  "bundles": [
    {
      "bundleId": "digital-light-output",
      "capabilityId": "digital-light-output",
      "manifestPath": "bundles/digital-light-output/manifest.json",
      "summaryPath": "bundles/digital-light-output/BUNDLE.md",
      "evalPath": "bundles/digital-light-output/evals.jsonl",
      "level": "L2",
      "budget": "summary"
    },
    {
      "bundleId": "display-text-output",
      "capabilityId": "display-text-output",
      "manifestPath": "bundles/display-text-output/manifest.json",
      "summaryPath": "bundles/display-text-output/BUNDLE.md",
      "evalPath": "bundles/display-text-output/evals.jsonl",
      "level": "L2",
      "budget": "summary"
    },
    {
      "bundleId": "analog-led-dimmer",
      "capabilityId": "analog-led-dimmer",
      "manifestPath": "bundles/analog-led-dimmer/manifest.json",
      "summaryPath": "bundles/analog-led-dimmer/BUNDLE.md",
      "evalPath": "bundles/analog-led-dimmer/evals.jsonl",
      "level": "L2",
      "budget": "minimal"
    }
  ],
  "shared": {
    "parts": "../registry/part-capabilities.json",
    "capabilityGraph": "../data/capability-graph.json",
    "footprints": "../data/render-footprints.json",
    "simulationPrimitives": "../simulation/primitives.json",
    "topologyTemplates": "../electrical/topology-templates.json",
    "pinAliases": "../ontology/pin-aliases.json",
    "breadboardGrid": "../rendering/breadboard-grid.json"
  }
}
```

- [ ] **Step 5: Create v2 routes**

Create `agent-context/v2/routes.json`:

```json
{
  "version": "2026-06-01",
  "routes": [
    {
      "routeId": "v2-ambiguous-minimal",
      "priority": 10,
      "policyOnly": true,
      "when": { "capabilityIds": [], "supportLevels": [], "modalities": [], "ambiguity": true },
      "bundleIds": [],
      "alwaysInclude": ["policy:safety", "policy:clarification", "policy:truthfulness"],
      "maxPromptChars": 4500,
      "reason": "Ambiguous prompts need only safety, clarification, and truthfulness policy."
    },
    {
      "routeId": "v2-digital-light-output",
      "priority": 40,
      "policyOnly": false,
      "when": { "capabilityIds": ["digital-light-output"], "supportLevels": ["supported"], "modalities": ["light"] },
      "bundleIds": ["digital-light-output"],
      "alwaysInclude": ["policy:safety", "policy:truthfulness"],
      "maxPromptChars": 9000,
      "reason": "LED output can be handled by one bundle plus shared canonical refs."
    },
    {
      "routeId": "v2-display-text-output",
      "priority": 50,
      "policyOnly": false,
      "when": { "capabilityIds": ["display-text-output"], "supportLevels": ["supported"], "modalities": ["display"] },
      "bundleIds": ["display-text-output"],
      "alwaysInclude": ["policy:safety", "policy:truthfulness"],
      "maxPromptChars": 9000,
      "reason": "OLED display output can be handled by one I2C display bundle."
    },
    {
      "routeId": "v2-planned-analog-dimmer",
      "priority": 60,
      "policyOnly": false,
      "when": { "capabilityIds": ["analog-led-dimmer"], "supportLevels": ["planned"], "modalities": ["analog", "potentiometer", "light"] },
      "bundleIds": ["analog-led-dimmer"],
      "alwaysInclude": ["policy:safety", "policy:unsupported", "policy:truthfulness"],
      "maxPromptChars": 6500,
      "reason": "Planned analog dimmer should load only gap explanation and safe alternatives, not render or simulation catalogs."
    }
  ]
}
```

- [ ] **Step 6: Create JSON schema mirror files**

Create `agent-context/v2/schemas/context-v2-index.schema.json` with:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://h-eduware.local/schemas/context-v2/index.schema.json",
  "title": "ContextV2Index",
  "type": "object",
  "required": ["version", "root", "bundles", "shared"],
  "properties": {
    "version": { "type": "string" },
    "root": { "type": "string" },
    "bundles": { "type": "array", "items": { "type": "object" } },
    "shared": { "type": "object" }
  }
}
```

Create `agent-context/v2/schemas/route-v2.schema.json` with:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://h-eduware.local/schemas/context-v2/route.schema.json",
  "title": "ContextV2Routes",
  "type": "object",
  "required": ["version", "routes"],
  "properties": {
    "version": { "type": "string" },
    "routes": { "type": "array", "items": { "type": "object" } }
  }
}
```

- [ ] **Step 7: Verify v2 index/routes load**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextV2Architecture.test.ts
```

Expected:

- v2 schema, index, and route tests pass.

## Task 3: Add First v2 Bundles

**Files:**

- Create: `agent-context/v2/bundles/digital-light-output/BUNDLE.md`
- Create: `agent-context/v2/bundles/digital-light-output/manifest.json`
- Create: `agent-context/v2/bundles/digital-light-output/evals.jsonl`
- Create: `agent-context/v2/bundles/display-text-output/BUNDLE.md`
- Create: `agent-context/v2/bundles/display-text-output/manifest.json`
- Create: `agent-context/v2/bundles/display-text-output/evals.jsonl`
- Create: `agent-context/v2/bundles/analog-led-dimmer/BUNDLE.md`
- Create: `agent-context/v2/bundles/analog-led-dimmer/manifest.json`
- Create: `agent-context/v2/bundles/analog-led-dimmer/evals.jsonl`
- Modify: `server/context/contextLayer.ts`
- Modify: `tests/unit/contextV2Architecture.test.ts`

- [ ] **Step 1: Add failing bundle loader test**

Append:

```ts
import { loadContextBundleV2 } from '../../server/context/contextLayer.ts';

test('v2 bundle loader returns summary and manifest without loading heavy shared data', async () => {
  const bundle = await loadContextBundleV2('digital-light-output');

  assert.equal(bundle.manifest.bundleId, 'digital-light-output');
  assert.match(bundle.summary, /LED/i);
  assert.ok(bundle.summary.length < 1500);
  assert.equal(bundle.manifest.promptInclusions.includeFootprintAnchors, false);
  assert.ok(bundle.manifest.allowedParts.includes('led-5mm'));
});
```

- [ ] **Step 2: Run failing bundle loader test**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextV2Architecture.test.ts
```

Expected:

- Fails because `loadContextBundleV2()` and bundle files do not exist.

- [ ] **Step 3: Add loader**

Add to `server/context/contextLayer.ts`:

```ts
export type ContextBundleV2 = {
  manifest: ContextBundleManifestV2;
  summary: string;
};

export async function loadContextBundleV2(bundleId: string, root = DEFAULT_CONTEXT_ROOT): Promise<ContextBundleV2> {
  const index = await loadContextV2Index(root);
  const entry = index.bundles.find((bundle) => bundle.bundleId === bundleId);
  if (!entry) {
    throw new Error(`Unknown v2 context bundle: ${bundleId}`);
  }

  const [manifestRaw, summary] = await Promise.all([
    readFile(path.join(root, 'v2', entry.manifestPath), 'utf8'),
    readFile(path.join(root, 'v2', entry.summaryPath), 'utf8')
  ]);

  return {
    manifest: ContextBundleManifestV2Schema.parse(JSON.parse(manifestRaw)),
    summary: summary.trim()
  };
}
```

- [ ] **Step 4: Create digital-light-output bundle**

Create `agent-context/v2/bundles/digital-light-output/BUNDLE.md`:

```markdown
# Digital Light Output

Use this bundle when the student wants an Arduino-controlled LED or blinking light.

Supported: Arduino Uno digital output, breadboard, 5 mm LED, 220 ohm series resistor, jumper wires, simple on/off and blink behavior.

Do not support: analog brightness control, RGB color mixing, mains lamps, high-power LED strips, or sensors in this bundle.

Required checks: LED polarity, resistor in series, closed path from Arduino output through resistor and LED to GND, common ground, no direct 5V-to-GND short.

Simulation: educational current-flow animation and LED on/off or blink state only. This is not SPICE or transient LED modeling.
```

Create `agent-context/v2/bundles/digital-light-output/manifest.json`:

```json
{
  "schemaVersion": "2026-06-01",
  "bundleId": "digital-light-output",
  "capabilityId": "digital-light-output",
  "supportLevel": "supported",
  "promptBudget": "summary",
  "agentSummaryPath": "bundles/digital-light-output/BUNDLE.md",
  "requiredParts": ["arduino-uno", "breadboard-half", "led-5mm", "resistor-220"],
  "allowedParts": ["arduino-uno", "breadboard-half", "led-5mm", "resistor-220", "jumper-wire"],
  "requiredTopologies": ["controller-digital-output-series-load"],
  "validationRules": ["series-current-limit", "led-polarity", "closed-current-path"],
  "simulationPrimitives": ["digital_on_off", "blink_timer", "current_flow_animation"],
  "renderFootprints": ["arduino", "breadboard", "led", "resistor", "wire"],
  "canonicalRefs": {
    "parts": ["shared:parts:arduino-uno", "shared:parts:breadboard-half", "shared:parts:led-5mm", "shared:parts:resistor-220"],
    "footprints": ["shared:footprint:arduino", "shared:footprint:breadboard", "shared:footprint:led", "shared:footprint:resistor", "shared:footprint:wire"],
    "simulation": ["shared:primitive:digital_on_off", "shared:primitive:blink_timer", "shared:primitive:current_flow_animation"],
    "topology": ["shared:topology:controller-digital-output-series-load"],
    "sources": ["shared:source:arduino-uno-rev3-io-current-20ma", "shared:source:led-5mm-requires-current-limit"]
  },
  "promptInclusions": {
    "includePins": true,
    "includeElectricalLimits": true,
    "includeFootprintAnchors": false,
    "includeSourceQuotes": false
  },
  "blockingConditions": ["missing-source-claims", "missing-render-footprint", "missing-simulation-primitive", "unsupported-part-requested"]
}
```

Create `agent-context/v2/bundles/digital-light-output/evals.jsonl`:

```jsonl
{"id":"v2-led-blink-ko","message":"LED를 깜빡이는 회로를 만들어줘","expected":"valid_circuit_synthesis"}
{"id":"v2-led-no-resistor-invalid","message":"저항 없이 LED를 바로 연결해줘","expected":"validation_warning_or_block"}
```

- [ ] **Step 5: Create display-text-output bundle**

Create `agent-context/v2/bundles/display-text-output/BUNDLE.md`:

```markdown
# Display Text Output

Use this bundle when the student wants an Arduino Uno to show short text on a 0.96 inch I2C OLED module.

Supported: Arduino Uno, breadboard, I2C OLED with VCC/GND/SDA/SCL, static text output, I2C signal explanation, supply current path.

Do not support: arbitrary graphical UI rendering, SPI displays, touchscreens, camera displays, or app-screen visualization requests.

Required checks: VCC to safe supply, GND common return, SDA to Arduino SDA, SCL to Arduino SCL, no swapped bus roles, no missing power or ground.

Simulation: static display state, I2C activity explanation, and educational current-flow overlay only.
```

Create `agent-context/v2/bundles/display-text-output/manifest.json`:

```json
{
  "schemaVersion": "2026-06-01",
  "bundleId": "display-text-output",
  "capabilityId": "display-text-output",
  "supportLevel": "supported",
  "promptBudget": "summary",
  "agentSummaryPath": "bundles/display-text-output/BUNDLE.md",
  "requiredParts": ["arduino-uno", "breadboard-half", "oled-i2c-096"],
  "allowedParts": ["arduino-uno", "breadboard-half", "oled-i2c-096", "jumper-wire"],
  "requiredTopologies": ["controller-i2c-display"],
  "validationRules": ["i2c-pin-role-match", "common-ground", "power-rail-valid"],
  "simulationPrimitives": ["display_static_text", "current_flow_animation"],
  "renderFootprints": ["arduino", "breadboard", "oled", "wire"],
  "canonicalRefs": {
    "parts": ["shared:parts:arduino-uno", "shared:parts:breadboard-half", "shared:parts:oled-i2c-096"],
    "footprints": ["shared:footprint:arduino", "shared:footprint:breadboard", "shared:footprint:oled", "shared:footprint:wire"],
    "simulation": ["shared:primitive:display_static_text", "shared:primitive:current_flow_animation"],
    "topology": ["shared:topology:controller-i2c-display"],
    "sources": ["shared:source:ssd1306-i2c-oled-vcc-gnd-sda-scl"]
  },
  "promptInclusions": {
    "includePins": true,
    "includeElectricalLimits": true,
    "includeFootprintAnchors": false,
    "includeSourceQuotes": false
  },
  "blockingConditions": ["missing-source-claims", "missing-render-footprint", "missing-simulation-primitive", "unsupported-part-requested"]
}
```

Create `agent-context/v2/bundles/display-text-output/evals.jsonl`:

```jsonl
{"id":"v2-oled-text-ko","message":"OLED에 이름을 표시하고 싶어","expected":"valid_circuit_synthesis"}
{"id":"v2-app-screen-not-oled","message":"앱 화면에 전류 흐름을 보여줘","expected":"clarification_or_no_hardware_display"}
```

- [ ] **Step 6: Create planned analog-led-dimmer bundle**

Create `agent-context/v2/bundles/analog-led-dimmer/BUNDLE.md`:

```markdown
# Analog LED Dimmer

Use this bundle when the student asks for a potentiometer, dial, or knob to control LED brightness.

Current support level: planned. Do not produce build-ready wiring, render plans, or current-flow simulation from this bundle yet.

Reason: H-eduware still needs complete potentiometer part data, voltage-divider validation, analog input simulation, knob render footprint, source claims, and browser evidence.

Safe alternative: offer a supported digital LED blink/on-off circuit, or explain what data must be added before analog dimming can be simulated.
```

Create `agent-context/v2/bundles/analog-led-dimmer/manifest.json`:

```json
{
  "schemaVersion": "2026-06-01",
  "bundleId": "analog-led-dimmer",
  "capabilityId": "analog-led-dimmer",
  "supportLevel": "planned",
  "promptBudget": "minimal",
  "agentSummaryPath": "bundles/analog-led-dimmer/BUNDLE.md",
  "requiredParts": ["arduino-uno", "breadboard-half", "potentiometer-10k", "led-5mm", "resistor-220"],
  "allowedParts": [],
  "requiredTopologies": ["controller-analog-input-pwm-output"],
  "validationRules": ["voltage-divider-required", "series-current-limit", "pwm-output-required"],
  "simulationPrimitives": [],
  "renderFootprints": [],
  "canonicalRefs": {
    "parts": ["shared:parts:arduino-uno", "shared:parts:led-5mm", "shared:parts:resistor-220"],
    "footprints": [],
    "simulation": [],
    "topology": [],
    "sources": []
  },
  "promptInclusions": {
    "includePins": false,
    "includeElectricalLimits": false,
    "includeFootprintAnchors": false,
    "includeSourceQuotes": false
  },
  "blockingConditions": ["planned-capability", "missing-potentiometer-part", "missing-render-footprint", "missing-simulation-primitive"]
}
```

Create `agent-context/v2/bundles/analog-led-dimmer/evals.jsonl`:

```jsonl
{"id":"v2-potentiometer-planned-ko","message":"가변저항으로 LED 밝기를 조절하고 싶어","expected":"support_gap_no_render_or_current"}
```

- [ ] **Step 7: Verify bundle loader**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextV2Architecture.test.ts
```

Expected:

- Bundle loader returns compact summaries and manifests.

## Task 4: Add v2 Context Route Selection

**Files:**

- Modify: `server/context/contextPacket.ts`
- Modify: `tests/unit/contextV2Architecture.test.ts`

- [ ] **Step 1: Add failing route selection test**

Append:

```ts
import { buildContextPacket } from '../../server/context/contextPacket.ts';

test('context packet prefers v2 bundle route for supported LED requests', async () => {
  const packet = await buildContextPacket({
    message: 'LED를 깜빡이는 회로를 만들고 싶어',
    locale: 'ko'
  });

  assert.equal(packet.contextRoute.routeId, 'v2-digital-light-output');
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:digital-light-output'));
  assert.match(packet.promptBlock, /Digital Light Output/);
  assert.doesNotMatch(packet.promptBlock, /\"pinAnchors\"\\s*:/);
});
```

- [ ] **Step 2: Run failing route selection test**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextV2Architecture.test.ts
```

Expected:

- Fails because `buildContextPacket()` still uses v1 routes.

- [ ] **Step 3: Add v2 route selection helper**

In `server/context/contextPacket.ts`, import:

```ts
import { loadContextV2Routes, loadContextBundleV2 } from './contextLayer.ts';
```

Add helper:

```ts
async function selectContextRouteV2(input: {
  capabilityMatches: CapabilityGraphEntry[];
  intentSignals: string[];
  ambiguity: boolean;
  unsafe: boolean;
}) {
  const routes = await loadContextV2Routes();
  const route = [...routes.routes]
    .sort((a, b) => a.priority - b.priority)
    .find((candidate) => {
      if (candidate.when.ambiguity && !input.ambiguity) return false;
      if (candidate.when.unsafe && !input.unsafe) return false;
      if (candidate.when.capabilityIds.length > 0 && !input.capabilityMatches.some((capability) => candidate.when.capabilityIds.includes(capability.id))) return false;
      if (candidate.when.supportLevels.length > 0 && !input.capabilityMatches.some((capability) => candidate.when.supportLevels.includes(capability.supportLevel))) return false;
      if (candidate.when.modalities.length > 0 && !candidate.when.modalities.every((modality) => input.intentSignals.includes(modality))) return false;
      return true;
    });

  return route ?? null;
}
```

- [ ] **Step 4: Integrate v2 route into `buildContextPacket()`**

After `intentHints` and `unsupportedSignals` are computed, build `intentSignals` and call `selectContextRouteV2()`.

When a v2 route exists:

- `contextRoute.routeId` should be the v2 route id.
- `contextRoute.sourceIds` should include `bundle:<bundleId>` plus `alwaysInclude`.
- `retrievalPlan.sourceIds` should include bundle source IDs.
- Bundle summaries should be loaded with `loadContextBundleV2()`.

Use this bundle source ID format:

```ts
`bundle:${bundle.manifest.bundleId}`
```

- [ ] **Step 5: Render v2 bundle summaries in prompt**

Add a `selectedBundles` input to `renderPromptBlock()`.

Include:

```ts
'Selected context bundles:',
selectedBundles.length > 0
  ? selectedBundles.map((bundle) => [
      `## ${bundle.manifest.bundleId}`,
      bundle.summary,
      `supportLevel=${bundle.manifest.supportLevel}`,
      `allowedParts=${bundle.manifest.allowedParts.join(', ') || 'none'}`,
      `validationRules=${bundle.manifest.validationRules.join(', ') || 'none'}`,
      `simulationPrimitives=${bundle.manifest.simulationPrimitives.join(', ') || 'none'}`
    ].join('\n')).join('\n\n')
  : 'none',
```

- [ ] **Step 6: Verify v2 route selection**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextV2Architecture.test.ts
```

Expected:

- LED request selects `v2-digital-light-output`.
- Prompt includes `Digital Light Output`.
- Prompt does not include full footprint anchors.

## Task 5: Add v2 Prompt Budget Guard

**Files:**

- Modify: `server/context/contextPacket.ts`
- Modify: `tests/unit/contextV2Architecture.test.ts`

- [ ] **Step 1: Add failing prompt budget test**

Append:

```ts
test('v2 context packet keeps supported LED prompt under bundle budget', async () => {
  const packet = await buildContextPacket({
    message: 'LED를 깜빡이는 회로를 만들고 싶어',
    locale: 'ko'
  });

  assert.ok(packet.promptBlock.length < 9000, `prompt length was ${packet.promptBlock.length}`);
  assert.ok(packet.retrievalPlan.maxPromptChars <= 9000);
});
```

- [ ] **Step 2: Run failing budget test**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextV2Architecture.test.ts
```

Expected:

- Fails if v1 full prompt still exceeds the v2 budget.

- [ ] **Step 3: Trim v2 prompt payload**

When `selectedBundles.length > 0`, reduce `renderPromptBlock()` payload:

- Keep intent spec.
- Keep intent hints.
- Keep selected bundle summaries.
- Keep candidate parts but only `id`, `pins`, `requiredPassives`, `protocols`.
- Keep simulation primitive IDs but not full `currentPathRecipe`.
- Keep render footprint types but not anchors.
- Keep context trace as source IDs and one-line reasons.

Add helper:

```ts
function compactPrimitiveContractsForV2(primitives: SimulationPrimitive[]) {
  return primitives.map((primitive) => ({
    id: primitive.id,
    requiredNetRoles: primitive.requiredNetRoles,
    validationRules: primitive.validationRules,
    limitations: primitive.limitations
  }));
}
```

Add helper:

```ts
function compactFootprintsForV2(footprints: RenderFootprintEntry[]) {
  return footprints.map((footprint) => ({
    type: footprint.type,
    placement: footprint.placement,
    pins: Object.keys(footprint.pinAnchors)
  }));
}
```

- [ ] **Step 4: Verify prompt budget**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextV2Architecture.test.ts
```

Expected:

- LED v2 prompt remains under 9000 characters.
- Existing context packet tests still pass.

## Task 6: Add v2 Bundle Gate to Candidate Parts

**Files:**

- Modify: `server/context/contextPacket.ts`
- Modify: `tests/unit/contextV2Architecture.test.ts`

- [ ] **Step 1: Add failing allowed-parts test**

Append:

```ts
test('v2 bundle allowedParts restricts candidate hardware surface', async () => {
  const packet = await buildContextPacket({
    message: 'LED를 깜빡이고 OLED도 추가해서 보여줘',
    locale: 'ko'
  });

  const bundleIds = packet.retrievalPlan.sourceIds.filter((id) => id.startsWith('bundle:'));
  const candidateIds = packet.candidateParts.map((part) => part.id);

  assert.ok(bundleIds.length > 0);
  for (const partId of candidateIds) {
    assert.ok(
      ['arduino-uno', 'breadboard-half', 'led-5mm', 'resistor-220', 'jumper-wire', 'oled-i2c-096'].includes(partId),
      `${partId} should be allowed by selected v2 bundles`
    );
  }
});
```

- [ ] **Step 2: Run failing allowed-parts test**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextV2Architecture.test.ts
```

Expected:

- Fails if v1 candidate search pulls broad unrelated parts.

- [ ] **Step 3: Filter candidate parts by selected bundle allowedParts**

In `buildContextPacket()`, after candidate parts are selected and `selectedBundles` are known:

```ts
const selectedAllowedPartIds = new Set(selectedBundles.flatMap((bundle) => bundle.manifest.allowedParts));
const bundleScopedCandidateParts = selectedAllowedPartIds.size > 0
  ? candidateParts.filter((part) => selectedAllowedPartIds.has(part.id))
  : candidateParts;
```

Use `bundleScopedCandidateParts` for:

- context trace
- context coverage
- prompt block
- returned `candidateParts`

- [ ] **Step 4: Verify candidate gate**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextV2Architecture.test.ts tests/unit/contextPacket.test.ts
```

Expected:

- Candidate parts are restricted to selected v2 bundles.
- Existing context packet behavior remains compatible.

## Task 7: Add v2 Planned Bundle Behavior

**Files:**

- Modify: `server/context/contextPacket.ts`
- Modify: `tests/unit/contextV2Architecture.test.ts`

- [ ] **Step 1: Add failing planned bundle test**

Append:

```ts
test('v2 planned bundle gives concise support gap without render or simulation catalogs', async () => {
  const packet = await buildContextPacket({
    message: '가변저항으로 LED 밝기를 조절하고 싶어',
    locale: 'ko'
  });

  assert.equal(packet.contextRoute.routeId, 'v2-planned-analog-dimmer');
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:analog-led-dimmer'));
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'ineligible');
  assert.ok(packet.supportGaps.some((gap) => /analog-led-dimmer/i.test(gap)));
  assert.equal(packet.renderFootprints.length, 0);
  assert.equal(packet.simulationPrimitives.length, 0);
  assert.match(packet.promptBlock, /Current support level: planned/);
});
```

- [ ] **Step 2: Run failing planned bundle test**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextV2Architecture.test.ts
```

Expected:

- Fails if planned route still loads render/simulation catalogs.

- [ ] **Step 3: Suppress heavy catalogs for planned v2 bundles**

When selected v2 bundles all have `supportLevel !== "supported"`:

- Skip loading render footprints.
- Skip loading simulation primitives.
- Candidate parts should be empty or only safe alternatives if explicitly present.
- Context coverage should include `clarification_response` and `unsupported_response`, not `valid_circuit_synthesis`.

Add:

```ts
const selectedBundlesAreBuildReady = selectedBundles.length > 0
  && selectedBundles.every((bundle) => bundle.manifest.supportLevel === 'supported');
```

Use `selectedBundlesAreBuildReady` to decide whether to load render/simulation data.

- [ ] **Step 4: Verify planned behavior**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextV2Architecture.test.ts tests/unit/contextRouting.test.ts tests/unit/contextSufficiencyEval.test.ts
```

Expected:

- Planned potentiometer stays support-gap only.
- No render/simulation context is loaded for planned bundle.

## Task 8: Add v2 Read Context Tool Boundary

**Files:**

- Modify: `server/agent/deepAgentTools.ts`
- Modify: `tests/unit/agentWorkflow.test.ts`

- [ ] **Step 1: Add failing bundle doc tool test**

Add to `tests/unit/agentWorkflow.test.ts`:

```ts
test('Deepagents context tool can read selected v2 bundle summary but not unselected bundles', async () => {
  const tools = createHeduwareAgentTools({
    allowedContextSourceIds: ['bundle:digital-light-output']
  });
  const readTool = tools.find((tool) => tool.name === 'read_context_doc');
  assert.ok(readTool);

  const allowed = await readTool.invoke({ id: 'bundle:digital-light-output' });
  assert.match(String(allowed), /Digital Light Output/);

  const blocked = await readTool.invoke({ id: 'bundle:display-text-output' });
  assert.match(String(blocked), /CONTEXT_DOC_NOT_IN_RETRIEVAL_PLAN/);
});
```

- [ ] **Step 2: Run failing tool boundary test**

Run:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
```

Expected:

- Fails because `read_context_doc` cannot resolve `bundle:*` IDs.

- [ ] **Step 3: Resolve v2 bundle IDs in tool**

In `server/agent/deepAgentTools.ts`, import:

```ts
import { loadContextBundleV2 } from '../context/contextLayer.ts';
```

Update `readContextDocBounded()`:

```ts
if (id.startsWith('bundle:')) {
  const bundleId = id.slice('bundle:'.length);
  const allowed = options.allowedContextSourceIds?.includes(id) ?? true;
  if (!allowed) {
    return asJson({
      error: 'CONTEXT_DOC_NOT_IN_RETRIEVAL_PLAN',
      requestedId: id,
      allowedSourceIds: options.allowedContextSourceIds
    });
  }
  const bundle = await loadContextBundleV2(bundleId);
  return [
    bundle.summary,
    '',
    `supportLevel=${bundle.manifest.supportLevel}`,
    `allowedParts=${bundle.manifest.allowedParts.join(', ')}`,
    `validationRules=${bundle.manifest.validationRules.join(', ')}`,
    `simulationPrimitives=${bundle.manifest.simulationPrimitives.join(', ')}`
  ].join('\n');
}
```

- [ ] **Step 4: Verify tool boundary**

Run:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
```

Expected:

- Deepagents can read only selected v2 bundle summaries.

## Task 9: Add Migration Audit

**Files:**

- Create: `server/context/contextV2Audit.ts`
- Create: `server/context/contextV2AuditCli.ts`
- Modify: `package.json`
- Create: `tests/unit/contextV2Audit.test.ts`

- [ ] **Step 1: Add failing audit test**

Create `tests/unit/contextV2Audit.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildContextV2Audit } from '../../server/context/contextV2Audit.ts';

test('context v2 audit reports migrated and missing capability bundles', async () => {
  const audit = await buildContextV2Audit();

  assert.ok(audit.totalCapabilities >= 1);
  assert.ok(audit.migratedCapabilityIds.includes('digital-light-output'));
  assert.ok(audit.migratedCapabilityIds.includes('display-text-output'));
  assert.ok(audit.plannedV2BundleIds.includes('analog-led-dimmer'));
  assert.ok(audit.missingBundleCapabilityIds.length >= 0);
});
```

- [ ] **Step 2: Run failing audit test**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextV2Audit.test.ts
```

Expected:

- Fails because audit module does not exist.

- [ ] **Step 3: Implement audit**

Create `server/context/contextV2Audit.ts`:

```ts
import { loadCapabilityGraph } from './capabilityGraph.ts';
import { loadContextV2Index, loadContextBundleV2 } from './contextLayer.ts';

export async function buildContextV2Audit() {
  const [capabilities, index] = await Promise.all([
    loadCapabilityGraph(),
    loadContextV2Index()
  ]);
  const bundleCapabilityIds = new Set(index.bundles.map((bundle) => bundle.capabilityId));
  const manifests = await Promise.all(index.bundles.map((bundle) => loadContextBundleV2(bundle.bundleId)));

  return {
    totalCapabilities: capabilities.length,
    totalV2Bundles: index.bundles.length,
    migratedCapabilityIds: capabilities
      .filter((capability) => bundleCapabilityIds.has(capability.id))
      .map((capability) => capability.id)
      .sort(),
    missingBundleCapabilityIds: capabilities
      .filter((capability) => !bundleCapabilityIds.has(capability.id))
      .map((capability) => capability.id)
      .sort(),
    supportedV2BundleIds: manifests
      .filter((bundle) => bundle.manifest.supportLevel === 'supported')
      .map((bundle) => bundle.manifest.bundleId)
      .sort(),
    plannedV2BundleIds: manifests
      .filter((bundle) => bundle.manifest.supportLevel === 'planned')
      .map((bundle) => bundle.manifest.bundleId)
      .sort()
  };
}
```

Create `server/context/contextV2AuditCli.ts`:

```ts
import { buildContextV2Audit } from './contextV2Audit.ts';

console.log(JSON.stringify(await buildContextV2Audit(), null, 2));
```

Add to `package.json`:

```json
"audit:context:v2": "tsx server/context/contextV2AuditCli.ts"
```

- [ ] **Step 4: Verify audit**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextV2Audit.test.ts
npm run audit:context:v2
```

Expected:

- Audit test passes.
- CLI prints migrated and missing capability IDs.

## Task 10: Update Existing Context Tests for v2 Compatibility

**Files:**

- Modify: `tests/unit/contextLayer.test.ts`
- Modify: `tests/unit/contextRouting.test.ts`
- Modify: `tests/unit/contextCoverage.test.ts`

- [ ] **Step 1: Add v2 path coverage to structure test**

Add to `tests/unit/contextLayer.test.ts`:

```ts
test('context v2 bundle files are resolvable and compact', async () => {
  const index = await loadContextV2Index();

  for (const bundleEntry of index.bundles) {
    const bundle = await loadContextBundleV2(bundleEntry.bundleId);
    assert.ok(bundle.summary.length > 0, `${bundleEntry.bundleId} summary exists`);
    assert.ok(bundle.summary.length <= 1500, `${bundleEntry.bundleId} summary stays compact`);
    assert.equal(bundle.manifest.bundleId, bundleEntry.bundleId);
  }
});
```

- [ ] **Step 2: Add v2 routing coverage**

Add to `tests/unit/contextRouting.test.ts`:

```ts
test('v2 route source ids prefer bundle loading units over broad heavy catalogs', async () => {
  const packet = await buildContextPacket({
    message: 'LED를 깜빡이는 회로를 만들어줘',
    locale: 'ko'
  });

  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:digital-light-output'));
  assert.ok(!packet.promptBlock.includes('"currentPathRecipe"'), 'v2 prompt should avoid full primitive recipe payload');
});
```

- [ ] **Step 3: Verify compatibility tests**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextLayer.test.ts tests/unit/contextRouting.test.ts tests/unit/contextCoverage.test.ts
```

Expected:

- Existing v1 context tests pass.
- New v2 compact bundle tests pass.

## Task 11: Document v2 Architecture

**Files:**

- Create: `agent-context/v2/README.md`
- Modify: `agent-context/index.md`
- Modify: `docs/context_layer_sufficiency_audit.md`
- Modify: `docs/coworking_handoff_2026-05-31.md`

- [ ] **Step 1: Create v2 README**

Create `agent-context/v2/README.md`:

```markdown
# H-eduware Agent Context v2

Context v2 is the bundle-first source-of-truth layer for Deepagents.

## Retrieval Levels

- L0: always-loaded operating rules.
- L1: safety, clarification, unsupported, and truthfulness policy.
- L2: selected capability bundle summaries.
- L3: selected bundle manifests and canonical reference IDs.
- L4: heavy canonical data loaded only by deterministic tools.

## Bundle Rule

Deepagents should reason from selected bundles, not from the entire context tree. A bundle contains a short `BUNDLE.md` for prompt use and a strict `manifest.json` for tool and validator gating.

## Prompt Rule

Prompt payload should include bundle summaries and compact IDs. It should not include full render anchors, full current path recipes, raw source quotes, or broad catalogs unless a bounded tool call explicitly returns them.

## Compatibility

v2 may reference v1 canonical JSON while migration is in progress. Deleting v1 files is not part of the initial v2 rollout.
```

- [ ] **Step 2: Update root index documentation**

Add to `agent-context/index.md`:

```markdown
## v2 Bundle-First Context

`v2/` is the preferred retrieval shape for Deepagents. It groups agent-readable summaries and machine-readable manifests by capability so each request can load one or a few bounded bundles instead of broad artifact catalogs.

The existing v1 registry/data/reference files remain canonical shared data during migration. v2 bundles reference those canonical IDs and reduce prompt bloat.
```

- [ ] **Step 3: Update sufficiency audit**

Append to `docs/context_layer_sufficiency_audit.md`:

```markdown
## Context v2 Architecture Direction

Context v2 introduces capability bundles as the primary Deepagents retrieval unit. This reduces context bloat by moving from artifact-type loading to bundle-scoped loading. Agent prompts receive compact `BUNDLE.md` summaries and manifest IDs; deterministic tools continue to consume canonical data.
```

- [ ] **Step 4: Add coworking memo**

Append to `docs/coworking_handoff_2026-05-31.md`:

```markdown
## 36. 2026-06-01 Agent Context v2 Information Architecture Memo

Planned/implemented a bundle-first `agent-context/v2` structure for Deepagents.

Key points:

- v2 introduces capability bundles with `BUNDLE.md`, `manifest.json`, and `evals.jsonl`.
- Deepagents retrieval should select bundle IDs first, then load compact summaries and canonical refs.
- v2 keeps heavy shared data out of the prompt and inside deterministic tools.
- v1 files remain as shared canonical data during migration.
- Goal is to reduce context bloat while strengthening source-of-truth boundaries.
```

## Task 12: Full Verification

**Files:**

- No new files.

- [ ] **Step 1: Run v2 targeted tests**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextV2Architecture.test.ts tests/unit/contextV2Audit.test.ts
```

Expected:

- v2 schemas load.
- v2 bundles load.
- v2 route selection works.
- v2 prompt budget guard passes.
- v2 audit reports migrated and missing capabilities.

- [ ] **Step 2: Run context compatibility tests**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextLayer.test.ts tests/unit/contextRouting.test.ts tests/unit/contextCoverage.test.ts tests/unit/contextPacket.test.ts
```

Expected:

- Existing v1 tests still pass.
- v2 compatibility tests pass.

- [ ] **Step 3: Run full acceptance gate**

Run:

```powershell
npm run check
```

Expected:

- JavaScript unit tests pass.
- TypeScript unit tests pass.
- Typecheck passes.
- Build passes.
- Playwright E2E passes with live opt-in tests skipped by default.

- [ ] **Step 4: Restart agent server if server/context files changed**

Run:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/agent/health
```

Expected after restart:

- `ok=true`
- `mode=live`
- `model=gpt-5.5`
- `sourceStatus.stale=false`

## Acceptance Criteria

- `agent-context/v2` exists and is documented.
- v2 bundle manifests separate prompt summary, canonical refs, and heavy data.
- At least `digital-light-output`, `display-text-output`, and `analog-led-dimmer` are represented as v2 bundles.
- `buildContextPacket()` can select v2 bundle routes for supported and planned examples.
- v2 prompts avoid full render anchors and full simulation recipes.
- Candidate parts are scoped by selected bundle `allowedParts`.
- Planned v2 bundles do not load render/simulation catalogs and cannot become valid synthesis.
- Deepagents `read_context_doc` can read selected `bundle:*` summaries only.
- v2 audit CLI reports migration coverage.
- Existing v1 validation, render, simulation, share, and E2E behavior remain passing.

## Non-Goals

- Do not delete v1 context files in this implementation.
- Do not add broad hardware support.
- Do not add long official source excerpts to prompts.
- Do not move all canonical data into v2 immediately.
- Do not change frontend visual behavior unless tests expose a compatibility issue.

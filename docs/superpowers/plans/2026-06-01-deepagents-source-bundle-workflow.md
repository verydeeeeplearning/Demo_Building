# Deepagents Source Bundle Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Deepagents runtime consume source-backed `HardwareSupportBundle` evidence so it can synthesize, validate, render, and simulate only capabilities whose source-backed context bundle is complete.

**Architecture:** Keep long official/vendor documents out of the live prompt. `buildContextPacket()` loads concise bundle and source-claim summaries for matched capabilities, adds them to context trace/coverage/prompt, and marks synthesis ineligible when a matched capability lacks complete bundle evidence. Deepagents tools are bounded to the same bundle evidence, and final server validation applies the bundle gate even if the LLM returns a plausible circuit.

**Tech Stack:** Existing Node server, TypeScript, Zod schemas, Deepagents `createDeepAgent`, LangChain `toolStrategy`, deterministic H-eduware tools, Node test runner, `tsx`, and Playwright for end-to-end evidence.

---

## Current Runtime Baseline

Relevant existing files:

- `server/agent/deepAgentRuntime.ts`
  - Creates the Deepagents coordinator with `createDeepAgent`.
  - Injects `contextPacket.promptBlock` into the system prompt.
  - Uses bounded tools with `candidateParts` and `allowedContextSourceIds`.
  - Runs a bounded validation repair loop.
  - Final server pipeline validates, builds netlist, estimates current paths, compiles render, compiles simulation, and compiles requirement markdown.

- `server/agent/deepAgentTools.ts`
  - Provides deterministic tools: context loading, part search, validation, netlist, current paths, faults, render plan, simulation plan, requirement markdown.
  - Already bounds `read_context_doc` to `retrievalPlan.sourceIds`.
  - Already bounds `search_part_capabilities` to `candidateParts`.

- `server/context/contextPacket.ts`
  - Selects `contextRoute` and `retrievalPlan`.
  - Selects `candidateParts`, `simulationPrimitives`, and `renderFootprints`.
  - Builds `contextTrace`, `contextCoverage`, and `promptBlock`.

Current gap:

- The runtime knows that a capability has parts, validation rules, render footprints, and simulation primitives.
- The runtime does not yet know whether those artifacts are grouped into a complete source-backed `HardwareSupportBundle`.
- A supported capability could remain structurally present while its source-backed evidence is missing or stale.

## Required Behavior

1. A matched supported capability must include complete bundle evidence before valid synthesis is eligible.
2. Bundle evidence must be concise and prompt-safe: IDs, support level, required parts, required artifacts, source claim IDs, and missing evidence count.
3. Deepagents must never need to read full source documents at runtime.
4. Deepagents tools must expose only request-scoped bundle evidence.
5. Final server validation must block build-ready artifacts when bundle coverage is missing, even if the LLM returns a valid-looking circuit.
6. Unsupported/planned/context-gap responses can still be response-sufficient without render/current simulation.

## File Structure

Prerequisite from the source bundle collection plan:

- `server/context/sourceClaims.ts`
- `agent-context/sources/source-claims.json`
- `agent-context/sources/hardware-support-bundles.json`

Create:

- `server/context/supportBundleEvidence.ts`: request-scoped bundle evidence builder and coverage classifier.
- `tests/unit/supportBundleEvidence.test.ts`: focused tests for bundle evidence behavior.

Modify:

- `server/agent/schemas.ts`: add `SupportBundleEvidenceSchema` and include bundle evidence in `ContextPacketSchema`.
- `server/context/contextPacket.ts`: load and inject bundle evidence into trace, coverage, and prompt block.
- `server/agent/deepAgentTools.ts`: add bounded `load_support_bundle_evidence` tool and pass bundle evidence through tool options.
- `server/agent/deepAgentRuntime.ts`: pass bundle evidence into tools/subagents and tighten coordinator/subagent instructions.
- `server/agent/circuitTools.ts`: add or extend the context coverage gate so missing bundle evidence blocks final valid artifacts.
- `tests/unit/contextPacket.test.ts`: assert source bundle evidence appears for supported routes.
- `tests/unit/contextCoverage.test.ts`: assert missing bundle evidence blocks synthesis.
- `tests/unit/agentWorkflow.test.ts`: assert Deepagents cannot validate/render/simulate when bundle evidence is missing.
- `docs/coworking_handoff_2026-05-31.md`: append implementation memo after completion.

Do not modify:

- Frontend UI.
- Broad visual part library.
- Supported hardware count.
- Live API credentials or model configuration.

## Task 1: Add Support Bundle Evidence Schema

**Files:**

- Modify: `server/agent/schemas.ts`
- Create: `tests/unit/supportBundleEvidence.test.ts`

- [ ] **Step 1: Write failing schema test**

Create `tests/unit/supportBundleEvidence.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { SupportBundleEvidenceSchema } from '../../server/agent/schemas.ts';

test('support bundle evidence summarizes source-backed capability coverage', () => {
  const evidence = SupportBundleEvidenceSchema.parse({
    capabilityId: 'digital-light-output',
    bundleId: 'digital-light-output-starter',
    supportLevel: 'supported',
    status: 'complete',
    requiredParts: ['arduino-uno', 'breadboard-half', 'led-5mm', 'resistor-220'],
    requiredArtifacts: ['source-claims', 'part-capability', 'validation-rule', 'render-footprint', 'simulation-primitive'],
    presentArtifacts: ['source-claims', 'part-capability', 'validation-rule', 'render-footprint', 'simulation-primitive'],
    missingArtifacts: [],
    sourceClaimIds: ['arduino-uno-rev3-io-current-20ma', 'led-5mm-requires-current-limit'],
    sourceTiers: ['manufacturer-official', 'educational-reference'],
    promptSummary: 'digital-light-output has complete source-backed support bundle evidence.'
  });

  assert.equal(evidence.status, 'complete');
  assert.equal(evidence.capabilityId, 'digital-light-output');
  assert.deepEqual(evidence.missingArtifacts, []);
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npm exec -- tsx --test tests/unit/supportBundleEvidence.test.ts
```

Expected:

- Fails because `SupportBundleEvidenceSchema` is not exported.

- [ ] **Step 3: Add schema**

Add to `server/agent/schemas.ts` near the context schemas:

```ts
export const SupportBundleEvidenceSchema = z.object({
  capabilityId: z.string().min(1),
  bundleId: z.string().min(1).nullable(),
  supportLevel: z.enum(['supported', 'partial', 'planned', 'unsupported']),
  status: z.enum(['complete', 'missing', 'incomplete']),
  requiredParts: z.array(z.string().min(1)).default([]),
  requiredArtifacts: z.array(z.string().min(1)).default([]),
  presentArtifacts: z.array(z.string().min(1)).default([]),
  missingArtifacts: z.array(z.string().min(1)).default([]),
  sourceClaimIds: z.array(z.string().min(1)).default([]),
  sourceTiers: z.array(z.string().min(1)).default([]),
  promptSummary: z.string().min(1)
});

export type SupportBundleEvidence = z.infer<typeof SupportBundleEvidenceSchema>;
```

Extend `ContextPacketSchema`:

```ts
supportBundles: z.array(SupportBundleEvidenceSchema).default([]),
```

- [ ] **Step 4: Verify schema test passes**

Run:

```powershell
npm exec -- tsx --test tests/unit/supportBundleEvidence.test.ts
```

Expected:

- The new schema test passes.

## Task 2: Build Request-Scoped Bundle Evidence

**Files:**

- Create: `server/context/supportBundleEvidence.ts`
- Modify: `tests/unit/supportBundleEvidence.test.ts`

- [ ] **Step 1: Add failing evidence builder test**

Append to `tests/unit/supportBundleEvidence.test.ts`:

```ts
import { buildSupportBundleEvidence } from '../../server/context/supportBundleEvidence.ts';

test('buildSupportBundleEvidence returns complete evidence for a supported starter capability', async () => {
  const evidence = await buildSupportBundleEvidence([
    {
      id: 'digital-light-output',
      supportLevel: 'supported',
      positivePhrases: ['blink led'],
      requiredEvidence: ['led'],
      negativeEvidence: [],
      minimumScore: 0.62,
      studentPhrases: ['blink led'],
      inputModalities: ['time'],
      outputModalities: ['light'],
      requiredRoles: ['controller', 'digital-output', 'series-current-limit', 'dc-load', 'ground-return'],
      requiredParts: ['arduino-uno', 'breadboard-half', 'led-5mm', 'resistor-220'],
      optionalParts: ['jumper-wire'],
      protocols: ['gpio', 'power'],
      simulationPrimitives: ['digital_on_off', 'blink_timer', 'current_flow_animation'],
      renderFootprints: ['arduino', 'breadboard', 'led', 'resistor', 'wire'],
      validationRules: ['series-current-limit', 'led-polarity', 'closed-current-path'],
      commonMistakes: [],
      safeAlternatives: []
    }
  ]);

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].capabilityId, 'digital-light-output');
  assert.equal(evidence[0].status, 'complete');
  assert.equal(evidence[0].missingArtifacts.length, 0);
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npm exec -- tsx --test tests/unit/supportBundleEvidence.test.ts
```

Expected:

- Fails because `server/context/supportBundleEvidence.ts` does not exist.

- [ ] **Step 3: Implement evidence builder**

Create `server/context/supportBundleEvidence.ts`:

```ts
import type { CapabilityGraphEntry, SupportBundleEvidence } from '../agent/schemas.ts';
import { SupportBundleEvidenceSchema } from '../agent/schemas.ts';
import { loadHardwareSupportBundles, loadSourceClaims } from './sourceClaims.ts';

export async function buildSupportBundleEvidence(
  capabilityMatches: CapabilityGraphEntry[],
  root?: string
): Promise<SupportBundleEvidence[]> {
  const [bundles, claims] = await Promise.all([
    loadHardwareSupportBundles(root),
    loadSourceClaims(root)
  ]);
  const claimById = new Map(claims.map((claim) => [claim.claimId, claim]));
  const bundleByCapability = new Map(bundles.map((bundle) => [bundle.capabilityId, bundle]));

  return capabilityMatches.map((capability) => {
    const bundle = bundleByCapability.get(capability.id);
    if (!bundle) {
      return SupportBundleEvidenceSchema.parse({
        capabilityId: capability.id,
        bundleId: null,
        supportLevel: capability.supportLevel,
        status: 'missing',
        requiredParts: capability.requiredParts,
        requiredArtifacts: ['source-claims'],
        presentArtifacts: [],
        missingArtifacts: ['source-claims'],
        sourceClaimIds: [],
        sourceTiers: [],
        promptSummary: `${capability.id} has no source-backed hardware support bundle.`
      });
    }

    const missingClaimIds = bundle.sourceClaimIds.filter((claimId) => !claimById.has(claimId));
    const presentArtifacts = bundle.requiredArtifacts.filter((artifact) =>
      artifact !== 'source-claims' || missingClaimIds.length === 0
    );
    const missingArtifacts = [
      ...bundle.requiredArtifacts.filter((artifact) => !presentArtifacts.includes(artifact)),
      ...missingClaimIds.map((claimId) => `source-claim:${claimId}`)
    ];
    const status = missingArtifacts.length === 0 ? 'complete' : 'incomplete';
    const sourceTiers = [...new Set(bundle.sourceClaimIds
      .map((claimId) => claimById.get(claimId)?.sourceTier)
      .filter((tier): tier is string => Boolean(tier)))];

    return SupportBundleEvidenceSchema.parse({
      capabilityId: capability.id,
      bundleId: bundle.bundleId,
      supportLevel: capability.supportLevel,
      status,
      requiredParts: bundle.requiredParts,
      requiredArtifacts: bundle.requiredArtifacts,
      presentArtifacts,
      missingArtifacts,
      sourceClaimIds: bundle.sourceClaimIds,
      sourceTiers,
      promptSummary: status === 'complete'
        ? `${capability.id} has complete source-backed support bundle evidence.`
        : `${capability.id} is missing source-backed support evidence: ${missingArtifacts.join(', ')}.`
    });
  });
}

export function bundleEvidenceBlocksSynthesis(evidence: SupportBundleEvidence[]) {
  return evidence.some((entry) => entry.supportLevel === 'supported' && entry.status !== 'complete');
}
```

- [ ] **Step 4: Verify evidence builder test passes**

Run:

```powershell
npm exec -- tsx --test tests/unit/supportBundleEvidence.test.ts
```

Expected:

- Schema and builder tests pass.

## Task 3: Inject Bundle Evidence into ContextPacket

**Files:**

- Modify: `server/context/contextPacket.ts`
- Modify: `tests/unit/contextPacket.test.ts`
- Modify: `tests/unit/contextCoverage.test.ts`

- [ ] **Step 1: Add failing packet evidence test**

Add to `tests/unit/contextPacket.test.ts`:

```ts
test('context packet includes support bundle evidence for supported capabilities', async () => {
  const packet = await buildContextPacket({
    message: 'LED를 깜빡이는 회로를 만들고 싶어',
    locale: 'ko'
  });

  const evidence = packet.supportBundles.find((entry) => entry.capabilityId === 'digital-light-output');
  assert.ok(evidence, 'digital-light-output bundle evidence should be present');
  assert.equal(evidence.status, 'complete');
  assert.ok(evidence.sourceClaimIds.length > 0);
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'sources:support-bundle:digital-light-output'));
  assert.match(packet.promptBlock, /Support bundle evidence/);
  assert.match(packet.promptBlock, /digital-light-output/);
});
```

- [ ] **Step 2: Run failing context packet test**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextPacket.test.ts
```

Expected:

- Fails because `ContextPacket` has no `supportBundles` field.

- [ ] **Step 3: Load bundle evidence in context packet**

In `server/context/contextPacket.ts`, import:

```ts
import { buildSupportBundleEvidence, bundleEvidenceBlocksSynthesis } from './supportBundleEvidence.ts';
```

After `capabilityMatches` are available, load bundle evidence:

```ts
const supportBundles = await buildSupportBundleEvidence(capabilityMatches);
```

Pass `supportBundles` into:

- `buildContextTrace`
- `buildContextCoverage`
- `renderPromptBlock`
- final `ContextPacketSchema.parse({ ... })`

- [ ] **Step 4: Add bundle evidence to context trace**

Extend `buildContextTrace()` input with:

```ts
supportBundles: SupportBundleEvidence[];
```

Add trace entries:

```ts
for (const bundle of supportBundles) {
  trace.push({
    sourceId: `sources:support-bundle:${bundle.capabilityId}`,
    sourceType: 'data',
    reason: bundle.promptSummary,
    usedFields: ['bundleId', 'status', 'requiredArtifacts', 'missingArtifacts', 'sourceClaimIds', 'sourceTiers'],
    summary: bundle.status
  });
}
```

- [ ] **Step 5: Add bundle evidence to prompt block**

Extend `renderPromptBlock()` input with:

```ts
supportBundles: SupportBundleEvidence[];
```

Add this block before `Context trace evidence`:

```ts
'Support bundle evidence:',
JSON.stringify(supportBundles.map((bundle) => ({
  capabilityId: bundle.capabilityId,
  bundleId: bundle.bundleId,
  supportLevel: bundle.supportLevel,
  status: bundle.status,
  requiredParts: bundle.requiredParts,
  missingArtifacts: bundle.missingArtifacts,
  sourceClaimIds: bundle.sourceClaimIds,
  sourceTiers: bundle.sourceTiers,
  promptSummary: bundle.promptSummary
})), null, 2),
'',
```

Update the non-negotiable rule:

```ts
'Non-negotiable rule: produce CircuitSpec only from candidate capabilities with complete support bundle evidence. If bundle evidence is missing or incomplete, mark unsupportedItems or clarificationNeeds. Never upgrade a planned, unsupported, or source-incomplete capability to supported.'
```

- [ ] **Step 6: Block synthesis eligibility when bundle evidence is incomplete**

Extend `buildContextCoverage()` input with:

```ts
supportBundles: SupportBundleEvidence[];
```

Add warnings:

```ts
...supportBundles
  .filter((bundle) => bundle.status !== 'complete')
  .map((bundle) => `Support bundle evidence gap: ${bundle.promptSummary}`)
```

Pass bundle evidence into `classifyCoveragePurposes()`.

Inside `classifyCoveragePurposes()`, compute:

```ts
const hasIncompleteSupportedBundle = supportBundles.some((bundle) =>
  bundle.supportLevel === 'supported' && bundle.status !== 'complete'
);
```

Change valid synthesis condition:

```ts
if (!hasMissingSources && !hasSupportGap && !hasUnsafeSignal && !hasAmbiguity && !hasIncompleteSupportedBundle) {
  purposes.add('valid_circuit_synthesis');
}
```

Update `synthesisIneligibilityReason()` to return:

```ts
if (supportBundles.some((bundle) => bundle.supportLevel === 'supported' && bundle.status !== 'complete')) {
  const first = supportBundles.find((bundle) => bundle.supportLevel === 'supported' && bundle.status !== 'complete');
  return `Missing support bundle evidence for synthesis: ${first?.capabilityId}.`;
}
```

- [ ] **Step 7: Verify packet and coverage tests**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextPacket.test.ts tests/unit/contextCoverage.test.ts tests/unit/supportBundleEvidence.test.ts
```

Expected:

- Supported LED/OLED routes include complete support bundle evidence.
- Context coverage remains sufficient for existing supported routes.

## Task 4: Add Bounded Deepagents Tool for Bundle Evidence

**Files:**

- Modify: `server/agent/deepAgentTools.ts`
- Modify: `tests/unit/agentWorkflow.test.ts`

- [ ] **Step 1: Add failing bounded tool test**

Add to `tests/unit/agentWorkflow.test.ts`:

```ts
test('Deepagents support bundle tool is bounded to current capability matches', async () => {
  const tools = createHeduwareAgentTools({
    supportBundles: [{
      capabilityId: 'digital-light-output',
      bundleId: 'digital-light-output-starter',
      supportLevel: 'supported',
      status: 'complete',
      requiredParts: ['arduino-uno', 'breadboard-half', 'led-5mm', 'resistor-220'],
      requiredArtifacts: ['source-claims'],
      presentArtifacts: ['source-claims'],
      missingArtifacts: [],
      sourceClaimIds: ['arduino-uno-rev3-io-current-20ma'],
      sourceTiers: ['manufacturer-official'],
      promptSummary: 'digital-light-output has complete source-backed support bundle evidence.'
    }]
  });
  const bundleTool = tools.find((tool) => tool.name === 'load_support_bundle_evidence');
  assert.ok(bundleTool, 'load_support_bundle_evidence tool should exist');

  const allowed = await bundleTool.invoke({ capabilityId: 'digital-light-output' });
  assert.match(String(allowed), /digital-light-output-starter/);

  const blocked = await bundleTool.invoke({ capabilityId: 'display-text-output' });
  assert.match(String(blocked), /SUPPORT_BUNDLE_NOT_IN_CONTEXT_PACKET/);
});
```

- [ ] **Step 2: Run failing tool test**

Run:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
```

Expected:

- Fails because `load_support_bundle_evidence` does not exist and `HeduwareAgentToolOptions` lacks `supportBundles`.

- [ ] **Step 3: Add tool option and tool**

In `server/agent/deepAgentTools.ts`, import:

```ts
import type { SupportBundleEvidence } from './schemas.ts';
```

Extend `HeduwareAgentToolOptions`:

```ts
supportBundles?: SupportBundleEvidence[];
```

Add this tool before `search_part_capabilities`:

```ts
tool(
  async ({ capabilityId }) => {
    const bundle = options.supportBundles?.find((entry) => entry.capabilityId === capabilityId);
    if (!bundle) {
      return asJson({
        error: 'SUPPORT_BUNDLE_NOT_IN_CONTEXT_PACKET',
        capabilityId,
        allowedCapabilityIds: options.supportBundles?.map((entry) => entry.capabilityId) ?? []
      });
    }
    return asJson(bundle);
  },
  {
    name: 'load_support_bundle_evidence',
    description: 'Load concise source-backed support bundle evidence for a capability selected by the current context packet. Do not use this for capabilities outside the current route.',
    schema: z.object({ capabilityId: z.string().min(1) })
  }
),
```

- [ ] **Step 4: Verify tool test passes**

Run:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
```

Expected:

- Bundle tool exists.
- It returns selected bundle evidence.
- It rejects unselected capabilities.

## Task 5: Pass Bundle Evidence into Deepagents Runtime and Subagents

**Files:**

- Modify: `server/agent/deepAgentRuntime.ts`
- Modify: `tests/unit/agentWorkflow.test.ts`

- [ ] **Step 1: Add failing prompt contract test**

Add to `tests/unit/agentWorkflow.test.ts`:

```ts
test('Deepagents user prompt keeps source bundle evidence separate from raw source documents', async () => {
  const result = await runAgentWithScriptedDrafts({
    request: {
      message: 'LED를 깜빡이는 회로',
      locale: 'ko',
      mode: 'live'
    },
    drafts: [agentDraft('검증 가능한 LED 회로 초안입니다.', ledCircuit())]
  });

  assert.ok(result.contextTrace.some((entry) => entry.sourceId === 'sources:support-bundle:digital-light-output'));
  assert.ok(result.contextCoverage.sufficientFor.includes('valid_circuit_synthesis'));
});
```

- [ ] **Step 2: Run failing prompt contract test**

Run:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
```

Expected:

- Fails until `contextPacket.supportBundles` is passed into tools and trace.

- [ ] **Step 3: Pass bundles into tools and subagents**

In `server/agent/deepAgentRuntime.ts`, update both `createHeduwareAgentTools()` calls:

```ts
tools: createHeduwareAgentTools({
  contextCoverage: contextPacket.contextCoverage,
  candidateParts: contextPacket.candidateParts,
  allowedContextSourceIds: contextPacket.retrievalPlan.sourceIds,
  supportBundles: contextPacket.supportBundles
}),
```

Update `createSubagents()` tool options similarly.

- [ ] **Step 4: Tighten coordinator prompt**

In `buildSystemPrompt()`, replace the existing tool guidance line with:

```ts
'Before finalizing, use context and deterministic tools where useful: search_part_capabilities, load_support_bundle_evidence, validate_circuit_spec, build_netlist, estimate_current_paths, compile_render_plan, compile_simulation_plan, and compile_requirement_markdown.',
'A supported capability is build-ready only when its support bundle evidence status is complete. If the support bundle is missing or incomplete, do not produce build-ready wiring, render plans, or current-flow claims.',
```

- [ ] **Step 5: Tighten subagent prompts**

Update subagent system prompts:

```ts
{
  name: 'context-retriever',
  systemPrompt: 'Use load_context_index, read_context_doc, search_part_capabilities, and load_support_bundle_evidence. Return concise bundle-backed facts, not long copied context or raw official documents.',
  tools: tools()
}
```

```ts
{
  name: 'circuit-synthesizer',
  systemPrompt: 'Draft CircuitSpec only with supported part ids, exact pin names, and complete support bundle evidence. Do not claim validity.'
}
```

```ts
{
  name: 'constraint-validator',
  systemPrompt: 'Call validation and support bundle tools. Report authoritative errors/warnings without rewriting them.'
}
```

- [ ] **Step 6: Verify runtime prompt contract test passes**

Run:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
```

Expected:

- Scripted Deepagents path still validates supported LED.
- Result context trace includes support bundle evidence.

## Task 6: Enforce Bundle Gate After LLM Draft

**Files:**

- Modify: `server/agent/circuitTools.ts`
- Modify: `server/agent/deepAgentRuntime.ts`
- Modify: `tests/unit/agentWorkflow.test.ts`

- [ ] **Step 1: Add failing forged-draft test**

Add to `tests/unit/agentWorkflow.test.ts`:

```ts
test('missing support bundle evidence blocks a plausible live draft after deterministic validation', async () => {
  const result = await runAgentWithScriptedDrafts({
    request: {
      message: '가변저항으로 LED 밝기를 조절하고 싶어',
      locale: 'ko',
      mode: 'live'
    },
    drafts: [
      agentDraft('가능합니다. 가변저항 LED 밝기 조절 회로입니다.', ledCircuit())
    ]
  });

  assert.notEqual(result.validationReport.status, 'valid');
  assert.equal(result.renderPlan.parts.length, 0);
  assert.equal(result.simulationPlan.currentPaths.length, 0);
  assert.ok(result.validationReport.errors.concat(result.validationReport.warnings).some((item) =>
    /CONTEXT_COVERAGE_INSUFFICIENT|support bundle|context support gap/i.test(item)
  ));
});
```

- [ ] **Step 2: Run failing forged-draft test**

Run:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
```

Expected:

- Fails if the forged LED draft can still pass for a planned potentiometer request.

- [ ] **Step 3: Reuse context coverage gate as the bundle gate**

Ensure `buildContextCoverage()` adds warnings for incomplete or missing source bundle evidence and removes `valid_circuit_synthesis` from `sufficientFor`.

Confirm `finalizeAgentResult()` already calls:

```ts
const effectiveValidationReport = applyContextCoverageGate(validationReport, contextPacket.contextCoverage);
```

If `applyContextCoverageGate()` only checks status and not `sufficientFor`, update it in `server/agent/circuitTools.ts` so valid synthesis requires:

```ts
contextCoverage.status === 'sufficient'
  && contextCoverage.sufficientFor.includes('valid_circuit_synthesis')
  && contextCoverage.synthesisEligibility.status === 'eligible'
```

When false, return or modify the report with:

```ts
status: 'invalid',
errors: [
  ...report.errors,
  `CONTEXT_COVERAGE_INSUFFICIENT: ${contextCoverage.synthesisEligibility.reason}`
]
```

- [ ] **Step 4: Verify forged-draft test passes**

Run:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
```

Expected:

- Planned/source-incomplete requests cannot be repaired into a supported-looking valid circuit.

## Task 7: Add Bundle Evidence to Context Trace Markdown and Files Evidence

**Files:**

- Modify: `src/main.js`
- Modify: `tests/unit/i18n.test.js`
- Modify: `tests/e2e/features.spec.js`

- [ ] **Step 1: Add failing E2E assertion**

Extend the existing Files evidence E2E in `tests/e2e/features.spec.js` to assert:

```js
await expect(page.getByTestId('context-evidence-panel')).toContainText(/Source bundle|출처 묶음|근거 묶음/i);
```

- [ ] **Step 2: Run failing E2E subset**

Run:

```powershell
npm run test:e2e -- --grep "context evidence"
```

Expected:

- Fails because Files evidence panel does not mention source bundle coverage.

- [ ] **Step 3: Add localized evidence labels**

In `src/locales/ko.js`, add:

```js
sourceBundle: '출처 근거 묶음'
```

In `src/locales/en.js`, add:

```js
sourceBundle: 'Source bundle'
```

Add unit assertions in `tests/unit/i18n.test.js`.

- [ ] **Step 4: Render source bundle status in Files evidence panel**

In `src/main.js`, when rendering `contextCoverage`, show the bundle status if present in warnings or a new field.

Use this student-facing fallback:

```js
const sourceBundleStatus = contextCoverage.sufficientFor?.includes('valid_circuit_synthesis')
  ? t('evidence.sourceBundleReady', {}, state.locale)
  : t('evidence.sourceBundleReviewNeeded', {}, state.locale);
```

If adding new i18n keys, use:

```js
sourceBundleReady: '출처 근거 확인됨'
sourceBundleReviewNeeded: '출처 근거 검토 필요'
```

English:

```js
sourceBundleReady: 'Source bundle checked'
sourceBundleReviewNeeded: 'Source bundle needs review'
```

- [ ] **Step 5: Verify UI evidence**

Run:

```powershell
npm test
npm run test:e2e -- --grep "context evidence"
```

Expected:

- Files evidence panel shows source bundle status in Korean and English.

## Task 8: Add Source Bundle Eval Rows

**Files:**

- Modify: `agent-context/evals/context-sufficiency-prompts.jsonl`
- Modify: `tests/unit/contextSufficiencyEval.test.ts`
- Modify: `tests/unit/generalizationEval.test.ts`

- [ ] **Step 1: Add eval fixtures**

Append two eval rows to `agent-context/evals/context-sufficiency-prompts.jsonl`:

```jsonl
{"id":"source-bundle-supported-led-ko","message":"LED를 깜빡이는 회로를 만들어줘","locale":"ko","expectedContextRouteId":"supported-light-output","expectedCoverageStatus":"sufficient","expectedSynthesisEligibility":"eligible","expectedSufficientFor":["valid_circuit_synthesis"],"expectedCapabilityIds":["digital-light-output"],"expectedBrowserOutcome":"render-and-run-valid-simulation"}
{"id":"source-bundle-planned-potentiometer-ko","message":"가변저항으로 LED 밝기를 조절하고 싶어","locale":"ko","expectedCoverageStatus":"insufficient","expectedSynthesisEligibility":"ineligible","expectedSufficientFor":["clarification_response","unsupported_response"],"expectedCapabilityIds":["analog-led-dimmer"],"expectedSupportGapPatterns":["analog-led-dimmer"],"expectedBrowserOutcome":"support-gap-no-render-or-current"}
```

- [ ] **Step 2: Run eval tests**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextSufficiencyEval.test.ts tests/unit/generalizationEval.test.ts
```

Expected:

- Supported LED remains synthesis eligible.
- Planned potentiometer remains blocked.

## Task 9: Update QA and Handoff Documentation

**Files:**

- Modify: `docs/browser_generalization_verification.md`
- Modify: `docs/coworking_handoff_2026-05-31.md`

- [ ] **Step 1: Update browser verification protocol**

Add to `docs/browser_generalization_verification.md`:

```markdown
## Source Bundle Evidence

For agent-created projects, verify that Files context evidence indicates whether the source-backed hardware support bundle is ready. A valid render/run project must have complete source bundle evidence. Planned or visual-only hardware must show a review/support-gap result and must not render PCB wiring or animate current flow.
```

- [ ] **Step 2: Add coworking memo**

Append to `docs/coworking_handoff_2026-05-31.md`:

```markdown
## 35. 2026-06-01 Deepagents Source Bundle Workflow Memo

This slice wires source-backed hardware support bundles into the Deepagents runtime.

Key points:

- `ContextPacket` now carries request-scoped support bundle evidence.
- Deepagents tools expose `load_support_bundle_evidence`, bounded to the current route.
- Supported synthesis requires complete bundle evidence, not only part/render/simulation presence.
- Missing or incomplete bundle evidence blocks final validation, render plans, and current-flow simulation.
- Files evidence shows source bundle readiness for student-facing trust.

Verification:

- `npm exec -- tsx --test tests/unit/supportBundleEvidence.test.ts`
- `npm exec -- tsx --test tests/unit/contextPacket.test.ts tests/unit/contextCoverage.test.ts tests/unit/agentWorkflow.test.ts`
- `npm exec -- tsx --test tests/unit/contextSufficiencyEval.test.ts tests/unit/generalizationEval.test.ts`
- `npm run test:e2e -- --grep "context evidence"`
- `npm run check`
```

## Task 10: Full Verification

**Files:**

- No new files.

- [ ] **Step 1: Run targeted unit verification**

Run:

```powershell
npm exec -- tsx --test tests/unit/supportBundleEvidence.test.ts
npm exec -- tsx --test tests/unit/contextPacket.test.ts tests/unit/contextCoverage.test.ts tests/unit/agentWorkflow.test.ts
npm exec -- tsx --test tests/unit/contextSufficiencyEval.test.ts tests/unit/generalizationEval.test.ts
```

Expected:

- Bundle evidence builds correctly.
- Context packet includes bundle evidence.
- Deepagents tool boundary holds.
- Missing bundle evidence blocks synthesis.
- Eval rows classify supported and planned source-bundle behavior correctly.

- [ ] **Step 2: Run browser evidence subset**

Run:

```powershell
npm run test:e2e -- --grep "context evidence"
```

Expected:

- Files evidence panel shows source bundle readiness.
- No build/render/current simulation appears for planned source-bundle gaps.

- [ ] **Step 3: Run full acceptance gate**

Run:

```powershell
npm run check
```

Expected:

- JavaScript unit tests pass.
- TypeScript unit tests pass.
- `tsc --noEmit` passes.
- Vite production build passes.
- Playwright E2E passes with live opt-in tests skipped unless explicitly enabled.

- [ ] **Step 4: Restart agent server if server/context files changed**

Run or restart the active agent server, then verify:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/agent/health
```

Expected:

- `ok=true`
- `mode=live`
- `model=gpt-5.5`
- `sourceStatus.stale=false`

## Acceptance Criteria

- Deepagents prompt contains concise support bundle evidence for matched capabilities.
- Deepagents tools expose bundle evidence only for current route capabilities.
- Missing bundle evidence makes `contextCoverage.synthesisEligibility.status === "ineligible"`.
- `applyContextCoverageGate()` blocks final valid status when bundle evidence is missing.
- Supported starter capabilities still produce valid render/simulation artifacts.
- Planned or visual-only capabilities still produce support-gap responses with no render parts and no current paths.
- Files evidence panel communicates source bundle readiness without dumping raw official-source text.
- `npm run check` passes.

## Execution Notes

- Implement this after the source bundle collection plan creates `sourceClaims.ts`, `source-claims.json`, and `hardware-support-bundles.json`.
- If this plan is implemented first, create minimal test fixtures under `tests/fixtures/context-source-bundles/` and pass that root into `buildSupportBundleEvidence()` for tests.
- Do not put long official source excerpts into the runtime prompt.
- Treat source bundle evidence as a gate, not as a student-facing citation system.

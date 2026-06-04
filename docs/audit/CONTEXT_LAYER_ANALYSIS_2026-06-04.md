# Context Layer Analysis

Date: 2026-06-04

Scope: H-eduware Context Layer, including `agent-context/`, `agent-context/v2/`, `server/context/`, `server/agent/deepAgentRuntime.ts`, `server/agent/deepAgentTools.ts`, and related unit/eval/audit tests.

Mode: read-only analysis. No source code changes were made.

## Executive Summary

The current Context Layer is structurally strong: it has a v2 single-router direction, bundle-first prompt intent, canonical L0 data sources, source-claim audits, context coverage reports, and server-side validation gates around netlist/current/render/simulation finalization.

The main remaining risk is not that the validators are absent. The larger risk is that a request can enter the "supported synthesis" path too easily before the validators see it. In particular, unknown explicit hardware names can be absorbed into generic supported capabilities, and the broad `supported` label currently mixes demo-ready, simulation-ready, context-known, and exploratory support.

The highest-priority improvement is to close request classification and tool-scope gaps before expanding more bundles.

## Verification Performed

The following read-only checks were run during analysis:

- `npm run context:check`
  - Passed.
  - Confirmed current aggregates for part capabilities, render footprints, topology templates, and capability graph.
- `npm run audit:context:v2`
  - Passed.
  - Reported 42 total capabilities, 39 migrated v2 bundles, and 3 missing unsupported capability bundles.
- `npm run audit:sources`
  - Passed.
  - Reported 190 total source claims and 39 hardware support bundles.
- `npm run audit:capabilities`
  - Passed.
  - Reported 39 capabilities ready/supported and 3 blocked/unsupported.
- `npm run eval:generalization`
  - Passed.
  - 5 test groups passed.
- A direct `buildContextPacket` probe reproduced unknown-hardware absorption:
  - `Use a tachyon sensor to turn on an LED.` routed to `v2-analog-sensor-threshold-output` and was synthesis `eligible`.
  - `Use XYZ123 sensor to show value on OLED.` routed to `v2-analog-sensor-display-readout` and was synthesis `eligible`.

## Current Architecture

Evidence:

- `agent-context/v2/README.md` declares v2 as the single routing and bundle source, with old v1 routing removed.
- `agent-context/v2/index.json` lists 39 v2 bundles and shared canonical L0 paths for part capabilities, capability graph, footprints, simulation primitives, topology templates, pin aliases, and breadboard grid.
- `server/context/contextLayer.ts` provides v2 index, route, and bundle loaders.
- `server/context/contextPacket.ts` builds the runtime context packet, selects v2 routes, loads selected bundles, derives candidate parts, creates retrieval plans, and computes context coverage.
- `server/agent/deepAgentTools.ts` applies candidate-part and context-coverage gates to validation/finalization tools.
- `server/agent/deepAgentRuntime.ts` passes `contextCoverage`, `candidateParts`, `allowedContextSourceIds`, and `supportBundles` into the agent tools on the live path.

Inference:

- The architecture is no longer a simple static prompt layer. It is a deterministic context router plus bounded tool-gated runtime substrate.
- The strongest guarantees are downstream of context packet construction. The weaker point is upstream request classification and scope selection.

## Findings

### P0: Unknown Explicit Hardware Can Be Absorbed Into Supported Routes

Evidence:

- `detectExplicitHardwarePartIds` only recognizes known visual/library mentions and hardware keywords in `server/context/contextPacket.ts`.
- Ambiguity is mainly triggered when there is no usable input/output/capability signal.
- `buildContextCoverage` marks synthesis eligible when there are no missing sources, support gaps, unsupported signals, ambiguities, or incomplete support bundles.
- Direct probe:
  - `Use a tachyon sensor to turn on an LED.` produced:
    - route: `v2-analog-sensor-threshold-output`
    - eligibility: `eligible`
    - candidates: `arduino-uno`, `breadboard-half`, `led-5mm`, `resistor-220`
    - no support gaps
    - no unsupported signals
  - `Use XYZ123 sensor to show value on OLED.` produced:
    - route: `v2-analog-sensor-display-readout`
    - eligibility: `eligible`
    - candidates: `arduino-uno`, `breadboard-half`, `oled-i2c-096`
    - no support gaps
    - no unsupported signals

Inference:

- Generic words such as "sensor" and "display" can route the request even when a concrete named part is not in the catalog.
- This can silently replace the student's requested hardware with a generic supported design.

Recommended repair:

- Add a RED test for unknown named hardware in otherwise supported requests.
- Detect likely unknown part tokens near hardware nouns such as `sensor`, `module`, `board`, `driver`, `display`, `shield`.
- Mark these as support gaps or clarification needs unless they resolve to a canonical part, known alias, or explicit safe substitution.

### P0: `next` Context Layer Improvements Are Not the Production Default

Evidence:

- `server/agent/agentPipelineMode.ts` defaults to `legacy`.
- `server/context/contextPacket.ts` defaults `pipelineMode` to `legacy`.
- Tests characterize some legacy route/candidate issues as known behavior and verify the fix only under `next`.

Inference:

- Improvements in composition-first candidate selection do not protect the default runtime unless `H_EDUWARE_AGENT_PIPELINE_MODE=next` is enabled.
- `npm run check` can pass while the default path still carries known context-selection weaknesses.

Recommended repair:

- Define readiness criteria for promoting `next` to default.
- Add a default-mode regression test for the previously broken OLED/breadboard and compositional-context cases.
- If default cannot yet move to `next`, make the known legacy weaknesses explicit in the acceptance gate.

### P1: Agent Tool Scoping Is Fail-Open When Options Are Missing

Evidence:

- `createHeduwareAgentTools` accepts optional `candidateParts`, `allowedContextSourceIds`, and `supportBundles`.
- `read_context_doc` reads unrestricted context when `allowedContextSourceIds` is absent.
- `search_part_capabilities` searches the whole registry when `candidateParts` is absent.
- Candidate-part gating in validation is only meaningful when candidate parts are supplied.
- The live path passes options, but helper/test seams can create tools with empty/default options.

Inference:

- The current live path is mostly protected, but a new integration or test seam can accidentally create broad tools.
- Undefined and empty candidate sets currently do not express a clear security boundary.

Recommended repair:

- Make scoped tool options required for live agent construction.
- Treat an empty candidate list as "no buildable parts allowed", not "all parts allowed".
- Keep an explicit test-only/unscoped tool factory if broad tools are still needed for isolated unit tests.

### P1: v2 Route JSON Schema Drifts From Runtime Schema

Evidence:

- Runtime route schema in `server/context/contextLayer.ts` allows route fields such as `tier`, `budget`, and `when.capabilityMatchMode`.
- `agent-context/v2/routes.json` uses those fields.
- `agent-context/v2/schemas/route-v2.schema.json` disallows additional properties and does not describe all runtime-used fields.

Inference:

- Runtime validation passes, but external JSON Schema validation or future CI schema checks can reject valid current route data.
- The source-of-truth boundary between Zod and JSON Schema is unclear.

Recommended repair:

- Align `route-v2.schema.json` with the runtime Zod schema.
- Add schema validation for `agent-context/v2/routes.json` to the context acceptance path.
- Decide whether Zod or JSON Schema is the canonical schema source.

### P1: `supported` Is Too Broad For Product Safety And Demo Scope

Evidence:

- `Spec/H-eduware_master_statement.md` keeps the hackathon boundary centered on one polished Arduino + I2C OLED breadboard demo.
- `agent-context/v2/index.json` includes broad supported bundles such as motor drivers, relays, RS485, controller substitution, timing passives, and logic interfaces.
- `audit:capabilities` reports 39 supported capabilities.

Inference:

- The `supported` label currently conflates different readiness levels:
  - demo-ready
  - simulation-ready
  - render/context-ready
  - catalog-known
  - unsafe-blocked
- This makes routing and user-facing promises easier to overstate.

Recommended repair:

- Split support tier semantics from `supportLevel`.
- Add product-mode gating:
  - hackathon demo mode
  - offline mocked/default test mode
  - expanded live-agent mode
- Require the context packet to expose the mode-specific reason why a capability is buildable.

### P1: Source Authority Is Too Dependent On Internal Derived Claims

Evidence:

- `npm run audit:sources` reported 190 total claims.
- 168 of those claims were `h-eduware-derived`.
- The source collection playbook requires manufacturer/vendor/evidence-backed support before promotion.
- Source claim schemas include `subjectId`, `fieldPath`, and `value`, but current completeness checks focus mainly on referenced claim ID presence.

Inference:

- A claim can exist while pointing at the wrong subject, field, or value.
- Many supported capabilities may be supported by internal visual/context assertions rather than authoritative electrical or pin evidence.

Recommended repair:

- Add source-claim cross-validation:
  - bundle `requiredParts` and `allowedParts` resolve to part capabilities
  - manifest `canonicalRefs.sources` match source claim IDs
  - source claim `subjectId` matches the relevant part/capability/topology
  - source claim `fieldPath` exists in the target artifact
  - source claim `value` agrees with the target artifact where practical
- Use source tier to constrain what claims may authorize:
  - official/vendor claims for electrical limits and pin maps
  - internal derived claims for rendering/educational wording only

### P1: Bundle-First Prompt Contract Is Weakened By Broad Fallback Routes

Evidence:

- `agent-context/v2/README.md` says agents should reason from selected bundles, not the entire context tree.
- `supported-hardware-general` has no `bundleIds` and includes broad sources such as capability graph, topology templates, part capabilities, simulation primitives, and render footprints.
- Many route entries include heavy source IDs in `alwaysInclude`, even though v2 intends heavy data to stay tool-bounded.

Inference:

- The v2 router still has a legacy-style full-context fallback.
- If route selection misses a precise bundle, the prompt can become broad and less auditable.

Recommended repair:

- Make broad fallback routes clarification-first or unsupported/context-gap-first.
- Move heavy sources to explicit tool-only retrieval metadata instead of `alwaysInclude`.
- Add tests asserting fallback routes cannot be synthesis eligible unless a complete bundle or composition proof is present.

### P2: L2 Composition Provenance Is Not Part Of The Context Packet Contract

Evidence:

- `server/context/generatedComposition.ts` describes generated composition as review-only.
- In `next` mode, composition selection can replace candidate parts.
- `ContextPacketSchema` does not expose the generated composition, provenance, build-ready scope, or blocking conditions.

Inference:

- Candidate authority can come from composition while source/bundle evidence comes from another layer.
- Downstream code cannot easily verify whether candidate parts were route-derived, bundle-derived, explicitly named, or composition-derived.

Recommended repair:

- Add a compact composition/provenance section to `ContextPacket`.
- Include:
  - selection mode
  - topology ID
  - selected slot assignments
  - explicit vs inferred part IDs
  - blocking conditions
  - build-ready scope
- Feed that into context coverage and finalization diagnostics.

### P2: Prompt Rendering Contract Is Duplicated

Evidence:

- `server/context/contextPromptRenderer.ts` exists as an extracted prompt renderer.
- `server/context/contextPacket.ts` still contains and calls a local `renderPromptBlock`.

Inference:

- Prompt formatting rules can drift between modules.
- This is lower risk than classification and scope issues, but it adds maintenance cost.

Recommended repair:

- Consolidate prompt rendering into one module.
- Add a contract test that the exported renderer is the only live rendering path.

### P2: Context-Specific Acceptance Scripts Are Outside `npm run check`

Evidence:

- `package.json` includes `context:check`, `audit:context:v2`, `audit:sources`, `audit:capabilities`, `eval:generalization`, and `qa:context-artifacts`.
- `npm run check` currently runs unit tests, typecheck, build, and e2e tests, but not all context-specific audit CLIs.

Inference:

- Many context regressions are caught by unit tests, but CLI wiring, aggregate checks, and source audit regressions can be missed by the default acceptance gate.

Recommended repair:

- Add a focused `context:acceptance` script.
- Consider including at least `context:check`, `audit:context:v2`, and `eval:generalization` in the broader acceptance gate.
- Keep heavy artifact generation separate unless explicitly requested.

## Strengths To Preserve

- Server-side validation is authoritative and reapplied in tool paths.
- Candidate-part gates exist for validation, netlist, fault detection, current paths, render/simulation compilation, and finalization.
- v2 bundle manifests separate prompt summary from canonical refs.
- Aggregate source files are generated and checked for freshness.
- Generalization eval covers supported, ambiguous, unsafe, and unsupported request classes.
- Bundle promotion includes a cycle-breaker: generated composition cannot self-promote to supported without human safety approval.

## Suggested Next Work

1. Add RED tests for unknown explicit hardware names in otherwise supported requests.
2. Make live agent tool scoping fail-closed.
3. Decide and document `legacy` vs `next` promotion criteria.
4. Align v2 JSON Schema with runtime route schema.
5. Split `supported` into mode-aware readiness tiers.
6. Add source-claim value/field cross-validation.
7. Convert broad fallback routes into clarification/context-gap paths.
8. Add context-specific acceptance script coverage.

## Limits Of This Analysis

- This was read-only. No implementation or test edits were made.
- LangChain, LangGraph, and Deep Agents official docs were not consulted because no framework-dependent implementation was performed.
- The direct unknown-hardware probes were runtime probes through `buildContextPacket`, not full browser or live LLM runs.
- Browser-visible outcomes in the eval corpus are currently labels, not executed browser checks for every eval row.

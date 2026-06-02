# Implementation Plan: Progressive Disclosure for Deepagents Synthesis

**Status**: ⛔ SUPERSEDED — merged into `PLAN_agent_pipeline_refactor.md` (single authoritative plan). Kept for history only; do NOT execute from this doc.
**Started**: 2026-06-02
**Last Updated**: 2026-06-02

**CRITICAL INSTRUCTIONS**: After completing each phase:
1. Check off completed task checkboxes
2. Run all quality gate validation commands
3. Verify ALL quality gate items pass
4. Update "Last Updated" date
5. Document learnings in Notes section
6. Only then proceed to next phase

DO NOT skip quality gates or proceed with failing checks.

## Overview

### Feature Description
Replace the current "everything at entry" agent construction — **all 11 tools + 6 subagents (3 also carrying all 11 tools) + the full `contextPacket.promptBlock` (up to 38,000 chars) injected into one system prompt, with the full `LiveAgentDraft` forced as structured output in the same run** — with **progressive disclosure** that consumes the existing L0→L3 layered context hierarchy:

- **Context disclosure**: enter with a compact L1 index (capability matches + candidate part ids + selected bundle headlines + retrieval plan); pull depth on demand through the existing context tools.
- **Tool disclosure**: scope tools per phase (retrieve → draft → validate/compile) instead of exposing all 11 everywhere.
- **Structured output as a bounded step**: emit the validated draft in a dedicated, tightly-scoped step (a subagent with its own `responseFormat`), with a bounded retry on `AGENT_STRUCTURED_OUTPUT_MISSING`.
- **Close the routing gap**: route the canonical I2C-OLED text demo to the existing-but-unrouted `display-text-output` bundle instead of the 38k `supported-hardware-general` fallback.

### Problem (evidence)
- Live `live-agent.spec.js:71` (validated OLED I2C circuit) fails intermittently with **HTTP 502 `AGENT_STRUCTURED_OUTPUT_MISSING`** (reproduced 3 fail / 1 pass); the simple LED case is reliable. Same flakiness under `gpt-5.4-mini` and `gpt-5.5`, reasoning `low`/`high` → not a model-capacity/effort issue.
- `runLiveAgent` (`server/agent/deepAgentRuntime.ts:339`) builds `createDeepAgent` with `tools: createHeduwareAgentTools(toolOptions)` (all 11), `subagents` (6; `context-retriever`/`constraint-validator`/`simulation-planner` each re-receive all 11 via `tools()`), `responseFormat: toolStrategy(LiveAgentDraftSchema)`, and `systemPrompt` embedding `contextPacket.promptBlock`.
- `renderPromptBlock` (`server/context/contextPacket.ts`) inlines 14 context sections (capabilityMatches, candidateParts, simulationPrimitives, renderFootprints, requiredContextIds, unsupportedSignals, supportGaps, visualLibraryMentions, selectedBundles, supportBundles, contextRoute, retrievalPlan, contextTrace, contextCoverage).
- The OLED-text request matches **no narrow route** (the I2C/OLED routes are all *sensor*+display readouts) → falls to `supported-hardware-general` (**maxPromptChars 38000, budget full**). The `display-text-output` capability bundle exists in `agent-context/v2/bundles/` but **has no route**.
- `parseLiveAgentDraft` (`deepAgentRuntime.ts:1276`) throws `AgentStructuredOutputError` when the run ends with no `structuredResponse` and no recoverable tool-call `circuitSpec` — the broad entry surface makes this miss more likely on complex circuits.

### Success Criteria
- [ ] Live OLED I2C text synthesis returns a valid structured `LiveAgentDraft` reliably (target: ≥9/10 calls, or 5/5 with the bounded retry) — measured by an opt-in live smoke.
- [ ] Synthesis-entry prompt size for the OLED-text case reduced from ~38,000 → target ≤ ~13,000 chars (a narrow route + slim index).
- [ ] `display-text-output` bundle is reachable via a dedicated route; the OLED-text demo no longer lands on `supported-hardware-general`.
- [ ] Each phase subagent exposes only its phase's tools; the coordinator no longer exposes all 11.
- [ ] No regression: `npm run test:unit`, `npm run typecheck`, `npm run build`, `npm run test:e2e` (72 mocked) all green; golden/characterization tests unchanged.
- [ ] Feature is behind an env flag (`H_EDUWARE_PROGRESSIVE_DISCLOSURE`, default off → shadow → on) for safe rollout and instant rollback.

## Architecture Decisions (Clean Architecture)

### Layer Mapping for This Feature
| Layer | Components | Responsibility |
|-------|-----------|---------------|
| Domain | `ContextPacket`, `RetrievalPlan`, capability/bundle entities, tool result schemas | pure context + retrieval rules; the L0–L3 hierarchy as data substrate |
| Application | synthesis pipeline orchestration (phase sequencing), `summarizeSynthesisEntry`, slim-index vs full-detail policy | decides what is disclosed at entry vs pulled on demand; phase tool-scoping policy |
| Interface Adapters | deepagents wiring (`createSubagents`, `createDeepAgent` options), routing config (`routes.json`) | translate the disclosure policy into the deepagents harness + route selection |
| Frameworks & Drivers | `deepagents`, `ChatOpenAI` | the harness/model; kept behind adapters, no business logic |

### Key Decisions
| Decision | Rationale | Trade-offs |
|----------|-----------|------------|
| Slim entry index + on-demand pull | The L0–L3 hierarchy was built to be pulled, not flattened; 38k entry context degrades structured-output reliability | Model must actively pull; mitigated by keeping critical facts (candidate parts, selected bundle rules) inline |
| Per-phase scoped subagent tools | `deepagents@1.10.2` `SubAgent` supports `tools?` + `responseFormat?`; smaller decision space per step | Harness delegation flow changes; guarded by characterization + mocked workflow tests |
| Dedicated structured-emit step + bounded retry | Separates schema-filling from tool-orchestration; directly targets `AGENT_STRUCTURED_OUTPUT_MISSING` (already `retryable: true`) | Extra latency/cost on retry; bounded to 1–2 attempts |
| Add `display-text-output` route | Bundle already exists and is canonical demo; removes the 38k fallback path | One more route to maintain; covered by routing + golden tests |
| Env-flagged rollout (off/shadow/on) | Hot path; mirrors the existing `H_EDUWARE_CONTEXT_COMPOSE_MODE` pattern | Temporary branching until promoted |

## Dependencies
### Required Before Starting
- [ ] Approval of this plan.
- [ ] Local `.local/agent.env` with a working key for the opt-in live verification (Phase 5 only; default gates stay mocked).

### External Dependencies
- `deepagents@1.10.2` (already installed; `SubAgent.tools`/`responseFormat` confirmed).

## Test Strategy
**TDD Principle**: Write tests FIRST, then implement to pass.

| Test Type | Coverage Target | Purpose |
|-----------|-----------------|---------|
| Unit (node --test / tsx) | ≥90% of new pure logic | routing selection, slim-index rendering, phase tool-scoping, retry policy |
| Characterization | exact current behavior | lock routing/budget/tool-count before refactor |
| Integration (mocked agent) | critical paths | `agentWorkflow` mocked synthesis still produces valid draft |
| E2E (Playwright, mocked) | 72 existing | no UI/UX regression |
| Live smoke (opt-in) | OLED I2C reliability | `RUN_LIVE_E2E=1`, not in default gate |

## Implementation Phases

### Phase 0: Characterization & entry-size baseline
**Goal**: Lock current synthesis-entry behavior (tool count, prompt size, OLED→38k routing) before any change.
**Status**: Pending

#### RED
- [ ] Test 0.1: `tests/unit/synthesisEntryCharacterization.test.ts` asserts current state: OLED-text request → route `supported-hardware-general`, `maxPromptChars 38000`; synthesis tool count = 11; subagents `context-retriever`/`constraint-validator`/`simulation-planner` each expose 11 tools. Expected: PASS against current code (characterization).
#### GREEN
- [ ] Task 0.2: extract a pure `summarizeSynthesisEntry(contextPacket, { systemPrompt, userPrompt, tools, subagents })` returning `{ routeId, maxPromptChars, entryChars, toolCount, subagentToolCounts }` for assertion (no behavior change).
#### REFACTOR
- [ ] Task 0.3: ensure the summary is reused by `measureAgentPromptBudget` to avoid duplication.
#### Quality Gate
- [ ] TDD followed · build · all tests · lint · dependency rule respected · no security issue · characterization locks current behavior

### Phase 1: Routing gap — `display-text-output` route
**Goal**: Route the I2C-OLED text demo to the existing `display-text-output` bundle (bounded budget) instead of the 38k fallback.
**Status**: Pending

#### RED
- [ ] Test 1.1: routing test — "show HELLO on an I2C OLED" selects the new narrow route (bundle `display-text-output`, bounded `maxPromptChars` ~13000), NOT `supported-hardware-general`.
#### GREEN
- [ ] Task 1.2: add `v2-display-text-output` route to `agent-context/v2/routes.json` (when-conditions for I2C OLED text output; bundleIds `display-text-output`; budget bounded) + any `index.json` wiring.
#### REFACTOR
- [ ] Task 1.3: confirm route ordering/priority doesn't shadow existing sensor-display routes.
#### Quality Gate
- [ ] TDD · build · unit + golden (`composeContextGolden`) no-regression · routing characterization green

### Phase 2: Context disclosure — slim entry index + on-demand pull
**Goal**: Enter with a compact index; move bulky detail behind the existing context tools.
**Status**: Pending

#### RED
- [ ] Test 2.1: `renderEntryIndexBlock(packet)` contains capabilityMatches + candidate part ids + selected bundle headlines + retrieval plan, and does NOT inline `simulationPrimitives`/`renderFootprints`/full `supportBundles` bodies/`contextTrace`; entryChars for OLED-text ≤ target.
- [ ] Test 2.2: the moved detail is still retrievable via `read_context_doc` / `load_support_bundle_evidence` / `search_part_capabilities` (bounded to route).
#### GREEN
- [ ] Task 2.3: split `renderPromptBlock` into `renderEntryIndexBlock` (slim) + keep full detail behind tools; wire synthesis `systemPrompt` to the slim block under the env flag.
#### REFACTOR
- [ ] Task 2.4: keep `promptBlock` available for `off` mode (flag-gated) to preserve rollback.
#### Quality Gate
- [ ] TDD · build · prompt-budget asserts new lower entry size · tools still retrieve moved detail · no e2e regression

### Phase 3: Tool disclosure by phase (scoped subagents)
**Goal**: Each subagent carries only its phase's tools; coordinator slimmed.
**Status**: Pending

#### RED
- [ ] Test 3.1: `createSubagents` scopes tools — `context-retriever` → context tools only (`load_context_index`, `read_context_doc`, `search_part_capabilities`, `load_support_bundle_evidence`); `constraint-validator` → `validate_circuit_spec`/`build_netlist`/`estimate_current_paths`/`detect_faults`; `simulation-planner` → `compile_*`; tool-only-where-needed subagents carry none.
- [ ] Test 3.2: coordinator no longer exposes all 11 (delegation-first).
#### GREEN
- [ ] Task 3.3: refactor `createSubagents` + the synthesis `createDeepAgent` tool set behind the flag.
#### REFACTOR
- [ ] Task 3.4: dedupe tool-group definitions (single source for each phase's tool list).
#### Quality Gate
- [ ] TDD · build · `agentWorkflow` mocked synthesis still yields valid draft · no e2e regression

### Phase 4: Structured output as a bounded step
**Goal**: Emit the validated draft in a dedicated step; retry on incomplete.
**Status**: Pending

#### RED
- [ ] Test 4.1: a dedicated structured-emit step (subagent with its own `responseFormat`, or a final bounded `agent.invoke`) produces the `LiveAgentDraft`; an incomplete intermediate does not throw before the dedicated emit.
- [ ] Test 4.2: `AGENT_STRUCTURED_OUTPUT_MISSING` triggers a bounded retry (1–2 attempts) in the draft provider before surfacing the 502; mocked provider simulates one miss then a hit.
#### GREEN
- [ ] Task 4.3: implement dedicated structured-emit + bounded retry in `runAgentDraftRepairLoop`/`draftProvider`.
#### REFACTOR
- [ ] Task 4.4: ensure retry is observable (`logAgentEvent`) and cannot loop unbounded.
#### Quality Gate
- [ ] TDD · build · retry path unit-tested · no e2e regression

### Phase 5: Live verification + flag promotion
**Goal**: Confirm reliability live; promote flag.
**Status**: Pending

#### RED / Verify
- [ ] Task 5.1: opt-in live smoke — OLED I2C synthesis returns valid structured draft N/N (`RUN_LIVE_E2E=1`); update `live-agent.spec.js` expectation to reflect bounded-retry reliability (still asserts a final valid draft).
#### GREEN
- [ ] Task 5.2: default `H_EDUWARE_PROGRESSIVE_DISCLOSURE` from `off`→`shadow` (log diffs)→`on` after green.
#### Quality Gate
- [ ] Full `npm run check` green · live OLED stable · flag documented in AGENTS.md / docs index

## Risk Assessment
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Scoped subagents change harness delegation flow | Med | Med | Characterization (Phase 0) + mocked `agentWorkflow` tests; env flag rollback |
| Moving context out of prompt lowers answer quality (model doesn't pull) | Med | High | Keep critical facts (candidate parts, selected bundle rules) inline; shadow mode to compare before `on` |
| New route shadows/!matches existing routes | Low | Med | Routing priority test + golden `composeContextGolden` |
| Bounded retry masks a real synthesis bug | Low | Med | Log every retry; keep the underlying 502 observable; cap attempts |
| Live cost/latency increase | Low | Low | Bounded retries; live tests opt-in only |

## Rollback Strategy
### Per phase
- Phase 0: pure addition — delete the summary/test.
- Phase 1: remove the route entry from `routes.json`/`index.json`.
- Phases 2–4: gated by `H_EDUWARE_PROGRESSIVE_DISCLOSURE=off` → instant revert to current flat behavior; `off` path retains `renderPromptBlock` + all-tools wiring.
- Phase 5: set flag back to `off`/`shadow`.

## Progress Tracking
- Phase 0: 0%
- Phase 1: 0%
- Phase 2: 0%
- Phase 3: 0%
- Phase 4: 0%
- Phase 5: 0%
Overall: 0%

## Notes & Learnings
- Evidence gathered 2026-06-02: OLED I2C live synthesis 3 fail / 1 pass; LED reliable; gpt-5.4-mini and gpt-5.5 both flaky → orchestration/disclosure issue, not model capacity.
- `display-text-output` bundle exists but is unrouted — the canonical demo falls into the 38k `supported-hardware-general` route.
- `deepagents@1.10.2` `SubAgent` supports per-subagent `tools` and `responseFormat`, making phased disclosure + dedicated structured emit feasible without leaving the harness.

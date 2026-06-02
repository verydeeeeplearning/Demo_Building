# Implementation Plan: Context Layer Refactor for Operational Efficiency

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

> Rev. 2 incorporates `docs/plans/REVIEW_context_layer_refactor_2026-06-02.md` (3 adversarial reviews). Supersedes `docs/plans/PLAN_progressive_disclosure.md` (a subset of Phases 1, 3, 4 here).

## Overview

### Feature Description
Refactor the context layer from **enumerated routing (43 hand-authored routes in `agent-context/v2/routes.json`, single-winner bundle selection, O(catalog) cost)** to **request→role decomposition + composition + progressive disclosure (O(request) cost)**, optimized for **operational (runtime/production) efficiency**: bounded per-request token cost, low latency, and high structured-output reliability for every in-catalog request — and these properties must NOT degrade as the part catalog grows (130 → 500+).

Tools are NOT multiplied per part. The 11 generic, part-agnostic tools (`server/agent/deepAgentTools.ts:71-188`) already reach all parts through search/load/validate/compile. Parts are **data** behind a retrieval index, not tools. This refactor targets the **context selection/assembly + agent-wiring layer**, not the tool count.

### Problem (evidence, measured & review-verified 2026-06-02)
- **Wrong-context selection drops needed parts.** "Arduino + breadboard + I2C OLED text + current flow" → route `v2-prototyping-surface-context` (priority 28) beats `v2-digital-input-display-readout` (priority 30) in `selectContextRouteV2` (`contextPacket.ts:1696-1729`); `compactCandidatePartsForV2` then filters candidates to the prototyping bundle's `allowedParts`, **excluding `oled-i2c-096` and `arduino-uno`** (the single-winner drop is `contextPacket.ts:1424`). Removing the word "브레드보드" flips the route and restores the OLED → confirms a selection bug, not a size problem (actual promptBlock ≈ 8.3–9.0k chars, not 38k).
- **Group-grained inclusion.** `selectCandidateParts` (`contextPacket.ts:2201-2205`) adds every matched capability's `requiredParts ∪ optionalParts`; a coarse keyword makes a compositional context (one of 5 `-context` capabilities of 42 total) win and drag its whole membership in while cross-group parts are dropped.
- **O(catalog) cost.** 43 enumerated routes (`maxPromptChars` 6k–38k); new parts/combos need new routes. `selectComposableTopology` (`generatedComposition.ts:80-88`) is O(templates×parts) (55 templates, growing).
- **Duplicate context per stage.** Requirement-analysis (`deepAgentRuntime.ts:410-428`) AND synthesis (`:324-346`) each embed the full `contextPacket.promptBlock` + all 11 tools → ~2× context cost.
- **Verbose fallback rendering.** `renderPromptBlock` uses `JSON.stringify(…, null, 2)` when `isV2Prompt=false` (`contextPacket.ts:2771-2786`).
- **The 502 throw is upstream of the retry guard.** `AGENT_STRUCTURED_OUTPUT_MISSING` throws in `parseLiveAgentDraft` (`deepAgentRuntime.ts:1283`), called by `draftProvider`; `runAgentDraftRepairLoop` (`:901-930`) has **no try/catch** around it, so it cannot retry despite `maxAttempts=2` and `responseFormat` already existing.
- **No DI seams.** The model is hardcoded (`new ChatOpenAI` at `deepAgentRuntime.ts:294`) and the registry is loaded internally by `buildContextPacket` (`contextPacket.ts:1340`). No unit test exercises the model path. → reliability and catalog-growth cannot be deterministically gated until seams exist.

### Scope
- **In scope:** any request realizable from the in-catalog parts (~130 registry parts) and their combinations.
- **Out of scope (unchanged):** out-of-catalog / unsafe / unsupported requests keep existing safety + unsupported routes and behavior — no new coverage required there.

### Success Criteria (operational; each must be a deterministic gate)
- [ ] **O(request) scalability:** under a synthetic catalog-growth test (registry doubled via the injection seam), per-request **candidates-considered, selection CPU, and prompt tokens stay within a fixed bound** (not just char count) and do not grow with catalog size.
- [ ] **Reliability (deterministic):** on the recorded-cassette corpus replayed in `test:unit` (no live calls), structured-output **first-shot success ≥ 95%** and **post-fallback success = 100%** (deterministic preflight fallback, never a 502) for realizable in-catalog requests. First-shot and post-retry rates reported separately.
- [ ] **Correct selection:** for every corpus request, candidate parts include what the request needs (primary output + controller + named surface/passives) and exclude unrelated group siblings — including the keyword-collision interaction set (OLED+breadboard = case #1).
- [ ] **Token/latency:** synthesis-entry prompt bounded in **tokens** (target derived from a cost budget via `js-tiktoken`, measured for `ko` locale) and context assembled **once** and reused across requirement+synthesis. Latency budget defined with a numeric gate.
- [ ] **Full replacement:** enumerated capability routes retired; selection is composition-based (only safety/unsupported/ambiguous-minimal routes remain) — **gated by corpus parity AND the safety-overlay bridge**.
- [ ] **No regression:** `npm run test:unit`, `npm run typecheck`, `npm run build`, `npm run test:e2e` (72 mocked) green; golden/characterization green.
- [ ] Rollout behind `H_EDUWARE_CONTEXT_SELECTION` (`legacy` | `shadow` | `composition`; sibling to the existing `H_EDUWARE_CONTEXT_COMPOSE_MODE`), default `legacy`; concrete legacy-deletion trigger defined.

### Non-goals / explicitly deferred
Multi-output topology merge heuristics beyond corpus coverage; embeddings (start with inverted index + top-k); replacing the deepagents harness.

## Architecture Decisions (Clean Architecture)

### Layer Mapping
| Layer | Components | Responsibility |
|-------|-----------|---------------|
| Domain | role taxonomy (controller/output/input/surface/passive/connector), capability/part-bundle/topology entities, **explicit `tier` field** | pure decomposition + composition rules; L0–L3 hierarchy |
| Application | `selectContextByComposition`, tier policy, progressive-disclosure policy, reliability policy (retry+fallback), **`ModelPort`** + **`PartRegistrySource`** ports | what context exists per request, how it is disclosed, how the model/registry are injected |
| Interface Adapters | `contextPacket` assembly, deepagents wiring (scoped subagent tools, dedicated emit), retrieval index, reduced `routes.json`, **cassette model adapter** | translate policy to packet + harness; replayable model for tests |
| Frameworks & Drivers | `deepagents`, `ChatOpenAI`, `js-tiktoken`, registry/data files | behind ports/adapters |

### Key Decisions
| Decision | Rationale (operational) | Trade-offs |
|----------|-------------------------|------------|
| `ModelPort` DI + recorded-cassette harness | Makes reliability a deterministic CI gate without live OpenAI (satisfies harness contract + Clean Arch port rule) | Upfront refactor of the hot path before feature work |
| `PartRegistrySource` DI | Enables the catalog-growth test; isolates O(catalog) measurement | Touches `buildContextPacket` signature |
| Composition over enumeration + inverted index/top-k | O(request) cost, flat as catalog grows; arbitrary in-catalog combos | Composition must reach corpus parity before routes retire |
| Explicit `tier` field (not name suffix) | Robust primary-output vs compositional split; handles surface-only/multi-output | Manifest/schema migration |
| Safety-overlay bridge for composed topologies | L2 is `review-only` by construction; live build-ready needs an overlay | Net-new subsystem; blocks route retirement |
| Fix retry at the real throw site + deterministic fallback | Removes the 502 for realizable requests; never a terminal failure | Fallback draft is a clarification/preflight, not the ideal circuit |
| Progressive disclosure with critical-inline rule | Bounded entry tokens; needed parts' pins/protocol stay inline to avoid under-pull | Must classify inline vs pullable |
| Token gates via `js-tiktoken` (ko-measured) | Char count is invalid for Korean (1.5–3 tok/char) | New dep |

## Dependencies
### Required Before Starting
- [ ] Approval of this plan (Rev. 2).
- [ ] Resolve open questions: does `deepagents@1.10.2 createDeepAgent` accept an injected model instance? which of the 43 routes are irreducible safety/unsupported? is `ko` the dominant locale?
- [ ] `.local/agent.env` key for cassette recording + opt-in live smoke (recording is opt-in; replay is default).

### External Dependencies
- `deepagents@1.10.2` (`SubAgent.tools` + `responseFormat` confirmed). New: `js-tiktoken` (token measurement). Existing L2: `composeTopology.ts`, `generatedComposition.ts`, `bundlePromotion.ts`.

## Test Strategy
**TDD Principle**: Write tests FIRST. Default gate uses **mocked/cassette** responses — never live OpenAI.

| Test Type | Coverage Target | Purpose |
|-----------|-----------------|---------|
| Unit (node/tsx) | ≥90% new pure logic | role decomposition, tier policy, index/top-k, retry+fallback, token harness |
| Characterization | exact current behavior | lock current routing/candidateParts/sizes for the corpus (incl. OLED known-bad) |
| Cassette corpus eval | all in-catalog cases | deterministic structured-output first-shot/fallback rates via replayed model |
| Catalog-growth | synthetic registry | candidates-considered + CPU + tokens stay flat as catalog doubles |
| E2E (Playwright, mocked) | 72 existing | no UI/UX regression |
| Live smoke (opt-in) | cassette refresh | `RUN_LIVE_E2E=1`, records cassettes; not in default gate |

## Implementation Phases

### Phase 0: Corpus + token/efficiency harness + characterization
**Goal**: Make efficiency, correctness, and reliability measurable; lock current behavior.
**Status**: Pending
#### RED
- [ ] 0.1 Build `tests/fixtures/in-catalog-corpus.json` via a **role-slot generator**: each primary-output capability × {0,1} of each of the 5 compositional contexts × 1–2 named surface/passive variants, one representative part per role-class; PLUS an explicit **keyword-collision interaction set** (OLED+breadboard #1). Schema-validate every synthetic part against `agent-context/schemas/part-capability.schema.json`. State the target count.
- [ ] 0.2 `measureContextEfficiency(request)` → `{ routeId, candidatePartIds, candidatesConsidered, selectionCpuMs, entryTokens(js-tiktoken, ko), toolSchemaTokens, assemblyCount }`; characterization snapshots current values (locks today's behavior incl. the OLED bug as known-bad).
#### GREEN
- [ ] 0.3 Implement the pure harness + add `js-tiktoken`; publish the measured `ko` char→token ratio.
#### REFACTOR
- [ ] 0.4 `npm run audit:context-efficiency` report.
#### Quality Gate
- [ ] TDD · build · all tests · characterization reproducible · token (not char) measurement working

### Phase 0.5: Seams & deterministic model harness (PREREQUISITE — review C1/C5)
**Goal**: Make the model and registry injectable so reliability and growth are deterministic gates.
**Status**: Pending
#### RED
- [ ] 0.5.1 Unit test drives `runAgentDraftRepairLoop` with a **fake model** (zero live calls) and asserts a structured draft is produced.
- [ ] 0.5.2 `buildContextPacket` accepts an injected `PartRegistrySource`; a test doubles the registry and asserts selection still works.
#### GREEN
- [ ] 0.5.3 Introduce `ModelPort` (factory) injected at `deepAgentRuntime.ts:294`; introduce `PartRegistrySource` injected into `buildContextPacket` (`contextPacket.ts:1340/1402`).
- [ ] 0.5.4 Build a **recorded-cassette** model adapter: record real responses for the corpus once (opt-in, live), replay deterministically in CI.
#### REFACTOR
- [ ] 0.5.5 Keep production wiring (real ChatOpenAI + real registry) as the default adapters at the composition root.
#### Quality Gate
- [ ] TDD · build · model path unit-tested with no live call · registry injectable · cassette replay deterministic · Clean Arch: use case depends on ports

### Phase 1: Tier separation (primary output vs compositional context)
**Goal**: Stop compositional contexts from winning sole selection and dropping needed parts.
**Status**: Pending
#### RED
- [ ] 1.1 OLED+breadboard → candidate parts include `oled-i2c-096` + `arduino-uno` + only the named surface; other 6 surfaces excluded. Define and test **surface-only** (no primary output) and **multi-output** branches. Corpus cases not regressed.
#### GREEN
- [ ] 1.2 Add an explicit **`tier` field** (`primary-output` | `compositional-context`) to bundle/capability manifests (additive/optional → legacy path unchanged); selection = one primary + merged matched compositional contexts bounded to request-named parts. Fix the drop at `contextPacket.ts:1424` under the flag.
#### REFACTOR
- [ ] 1.3 Assert NO code reads the `-context` name suffix; handle the `logic-interface-context` (KNOWN_UNRESOLVED) case explicitly.
#### Quality Gate
- [ ] TDD · build · golden no-regression · corpus correctness up, none regressed · legacy path provably unchanged when flag=legacy

### Phase 2: Role decomposition + composition selection + retrieval index (core)
**Goal**: Replace single-winner route→bundle with request→roles→compose; bound cost with an index.
**Status**: Pending
#### RED
- [ ] 2.1 `selectContextByComposition(request)` (raw request in) yields candidate parts/bundles for the full corpus with **≥ parity vs current on currently-passing cases AND fixes the broken ones** — the corpus is the SOLE parity gate (NOT the golden).
- [ ] 2.2 Catalog-growth test: doubling the injected synthetic registry does NOT increase **candidates-considered / selection CPU / tokens** for a fixed request.
#### GREEN
- [ ] 2.3 Implement composition selection (roles → **inverted-index top-k per role** from L0/L1 → L2 compose) behind `H_EDUWARE_CONTEXT_SELECTION=shadow|composition`; document the per-request top-k bound.
#### REFACTOR
- [ ] 2.4 Dedupe with `composeTopology`/`generatedComposition`; replace O(templates×parts) scan with index lookup.
#### Quality Gate
- [ ] TDD · build · corpus parity+fixes · O(request) growth test green (CPU+candidates, not only chars) · e2e no-regression

### Phase 2.5: Safety-overlay bridge for composed topologies (review C4)
**Goal**: Let a composed topology become build-ready, not `review-only`.
**Status**: Pending
#### RED
- [ ] 2.5.1 A composed topology with a valid safety overlay yields `buildReadyScope != 'review-only'`; without overlay it stays review-only. Reuse the cycle-breaker rules from `bundlePromotion.ts`.
#### GREEN
- [ ] 2.5.2 Implement overlay generation/attachment so `generatedComposition` can produce build-ready scope when safety evidence is present.
#### REFACTOR
- [ ] 2.5.3 Single source for overlay rules shared with promotion.
#### Quality Gate
- [ ] TDD · build · review-only invariant preserved without overlay · build-ready only with overlay · **blocks Phase 5 until green**

### Phase 3: Progressive disclosure + token-lean assembly
**Goal**: Bounded entry tokens; assemble once; compact rendering everywhere; no under-pull.
**Status**: Pending
#### RED
- [ ] 3.1 Entry block = slim index (capabilities + candidate part ids + selected bundle headlines + retrieval plan); **critical-inline rule**: any part the model must reason about keeps pins/protocol inline; only bulky detail is pullable. Entry tokens ≤ target corpus-wide.
- [ ] 3.2 Requirement + synthesis share ONE assembled packet (no duplicate full-context injection); remove non-`v2` verbose `JSON.stringify(null,2)`.
- [ ] 3.3 Shadow **under-pull metric**: count requests where the model failed to pull a needed detail; must be ~0.
#### GREEN
- [ ] 3.4 Split `renderPromptBlock` → `renderEntryIndexBlock` + on-demand detail; reuse one packet across stages.
#### REFACTOR
- [ ] 3.5 Keep `legacy` rendering under the flag (rollback = flag or git revert — stated honestly).
#### Quality Gate
- [ ] TDD · build · entry-token bound corpus-wide · under-pull ~0 · e2e no-regression

### Phase 4: Structured-output reliability (fix the real throw site — review C2)
**Goal**: No `AGENT_STRUCTURED_OUTPUT_MISSING` for realizable requests; deterministic fallback.
**Status**: Pending
#### RED
- [ ] 4.1 Per-phase scoped subagent tools (retriever→context; validator→validate/netlist/faults; planner→compile_*); coordinator slimmed.
- [ ] 4.2 Using the cassette/fake model: a draft attempt that **throws** `AgentStructuredOutputError` on attempt 1 is caught in `runAgentDraftRepairLoop` (wrap `draftProvider`), retried on attempt 2; on final exhaustion it **falls back to a deterministic preflight draft** (`buildPreflightDraftFromAnalysis:945`) — never a 502.
#### GREEN
- [ ] 4.3 Implement the try/catch + fallback at `deepAgentRuntime.ts:901`; scoped tools + dedicated emit step (`SubAgent.responseFormat`).
#### REFACTOR
- [ ] 4.4 Retries/fallback observable via `logAgentEvent`, hard-capped; report first-shot vs post-retry.
#### Quality Gate
- [ ] TDD · build · throw-path retry unit-tested with fake model · cassette corpus first-shot ≥95% / fallback 100% · e2e no-regression

### Phase 5: Full replacement — retire enumerated routes
**Goal**: Composition-only selection; routes reduced to safety/unsupported/ambiguous-minimal.
**Status**: Pending — **blocked until Phase 2 parity + Phase 2.5 bridge are green**
#### RED
- [ ] 5.1 Routing characterization updated; `agent-context/v2/routes.json` (key `routeId`) keeps only the irreducible safety/unsupported/ambiguous-minimal routes (confirmed from the open-question audit); corpus selection unchanged vs Phase 2.
#### GREEN
- [ ] 5.2 Remove enumerated capability routes; default `H_EDUWARE_CONTEXT_SELECTION=composition`.
#### REFACTOR
- [ ] 5.3 Delete dead enumerated-route code paths.
#### Quality Gate
- [ ] TDD · build · golden + corpus green · routes reduced · e2e no-regression

### Phase 6: Live verification + metric gate + observability + promotion
**Goal**: Prove operational targets; lock them; production-safe rollout.
**Status**: Pending
#### Verify / GREEN
- [ ] 6.1 Opt-in live smoke over corpus refreshes cassettes; structured-output success ≥ target.
- [ ] 6.2 CI metric gate: entry tokens ≤ bound; candidates/CPU flat under catalog-growth.
- [ ] 6.3 Add **observability** (roles matched, parts pulled, retrieval misses, retry/fallback counts), a **latency budget** numeric gate, and a **prod runtime kill-switch** (composition→legacy without redeploy).
- [ ] 6.4 Promote flag `legacy`→`shadow`→`composition`; **legacy-deletion trigger**: composition default in CI for N consecutive green runs AND live-smoke ≥ target for M runs → delete legacy path.
#### Quality Gate
- [ ] Full `npm run check` green · live corpus reliability met · metric+latency gates enforced · kill-switch verified

## Risk Assessment
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Composition doesn't reach corpus parity before route removal | **High** | High | Corpus parity gate blocks Phase 5; flag keeps legacy; Phase 1+3 land independently |
| Reliability ungateable without seams | High (certain if skipped) | High | Phase 0.5 seams + cassette harness BEFORE feature work |
| Safety-overlay bridge unscoped → composition stays review-only | **High** | High | Dedicated Phase 2.5; blocks Phase 5 |
| O(catalog) leaks via retrieval/topology scan | Med | High | Inverted index + top-k; growth test on CPU/candidates |
| Char≠token cost regression (ko) | High | Med | `js-tiktoken`, token-based gates |
| Progressive disclosure under-pull (new failure mode) | Med | Med | Critical-inline rule + under-pull metric + shadow diff |
| Phases not flag-rollback-able (schema/renderer/subagent changes) | Med | Med | Additive tier field; honest rollback (git revert) for Phases 3–4 |
| Bounded retry inflates reliability number | Med | Med | Separate first-shot vs post-retry; realizable cases pass first-shot |
| Flag matrix drift / legacy never deleted | Med | Med | Concrete deletion trigger (6.4) |
| Estimate underrun | High | Med | Re-sized to ~8–10 phases / 30–50h; Phase 2 + 0.5 are the open-ended risks |

## Rollback Strategy
- **Flag-revertible:** selection-function switch (`H_EDUWARE_CONTEXT_SELECTION=legacy`) for Phases 2/5.
- **Git-revert (honest):** Phase 1 schema `tier` field is additive (legacy ignores it); Phases 3–4 mutate shared rendering/subagent/packet code → rollback is `git revert`, NOT a flag flip. Stated explicitly per review M4.
- **Phase 5** (route removal) is the only destructive step, performed only after 0–4 + 2.5 green: revert = restore `routes.json` from git + flag `legacy` + ensure Phase 1 tier changes are reverted together for a consistent legacy system.
- **Prod:** runtime kill-switch (6.3) flips composition→legacy without redeploy.

## Progress Tracking
- Phase 0, 0.5, 1, 2, 2.5, 3, 4, 5, 6: 0% each · Overall: 0%

## Notes & Learnings
- 2026-06-02 measured: OLED+breadboard mis-routes to prototyping-surface, excluding `oled-i2c-096`; removing "브레드보드" fixes routing → group-grained single-winner selection is the root cause, not prompt size (promptBlock ≈ 8.3–9.0k, not 38k).
- **42** capabilities total; **5** are compositional `-context`; `logic-interface-context` is KNOWN_UNRESOLVED by L2 (golden:33) — handle explicitly.
- The 502 throws at `parseLiveAgentDraft:1283`, OUTSIDE the retry guard (`:901-930`) — the real defect; `responseFormat`+`maxAttempts=2` already exist.
- L2 engine is `review-only` by construction (`generatedComposition.ts:50-54`) and log-only in shadow — needs routing integration + safety-overlay bridge to go live.
- No model/registry DI seams today (`deepAgentRuntime.ts:294`, `contextPacket.ts:1340`) — Phase 0.5 is a hard prerequisite for deterministic gates.
- Tools are already generic; do NOT implement per-part tools (O(catalog) token blowup). Operational efficiency target = O(request), not O(catalog).
- Estimate ~8–10 phases / 30–50h; blow-up risk in Phase 2 parity and the Phase 0.5 seam refactors of hot-path files.

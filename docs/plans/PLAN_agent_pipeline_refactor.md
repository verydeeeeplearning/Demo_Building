# Implementation Plan: Agent Pipeline Refactor (Context Layer + Deepagents Harness, unified)

**Status**: Proposed (Rev. 1 — merged from two plans + 6 adversarial reviews)
**Started**: 2026-06-02
**Last Updated**: 2026-06-02

> **This is the single authoritative plan.** It MERGES and SUPERSEDES:
> - `PLAN_context_layer_refactor.md` (Rev. 2) + `REVIEW_context_layer_refactor_2026-06-02.md`
> - `PLAN_deepagents_architecture_refactor.md` + `REVIEW_deepagents_architecture_refactor_2026-06-02.md`
> - `PLAN_progressive_disclosure.md` (earlier exploratory draft; absorbed)
>
> Reason for merge: the context layer (*what* context exists) and the deepagents harness (*how* it is consumed) are one hot path (`server/agent/deepAgentRuntime.ts` + `server/context/contextPacket.ts`). The two prior plans duplicated implementation targets and edited the **same line (`:901`)**. This document assigns a **single owner per code target** (see §Conflict Resolution) so there are no document-to-document conflicts.
> Anchored to `docs/deepagents-official-architecture-anchor.md`.

## Overview

### Goal
Refactor the agent pipeline for **operational (runtime) efficiency** and **reliability**, using the deepagents harness as intended instead of bypassing it:
- **O(request), not O(catalog):** per-request tokens/latency/selection-cost stay flat as the part catalog grows (130 → 500+).
- **Reliability:** no `AGENT_STRUCTURED_OUTPUT_MISSING` (502) for any realizable in-catalog request.
- **Harness-native:** one deep agent run with `write_todos` planning; correct context engineering (bounded entry, progressive disclosure); scoped subagents or none; deterministic finalization preserved.

### Scope
- **In scope:** any request realizable from the ~130 in-catalog parts and their combinations.
- **Out of scope (unchanged):** out-of-catalog / unsafe / unsupported requests keep existing safety + unsupported behavior.

### Anchor invariants (MUST preserve — `docs/deepagents-official-architecture-anchor.md`)
Context packet before deepagents; deterministic tools are authority; source-provenance gate; no unsupported upgrades; structured output required; finalization revalidates; bounded repair; **no broad context reads** (invariant 5).

### Tools are data, not 130 tools
The 11 generic part-agnostic tools (`deepAgentTools.ts:71-186`) reach all parts via search/load/validate/compile. Parts are **data** behind a retrieval index. Do NOT add per-part tools (O(catalog) token blowup).

### Root-cause evidence (measured & review-verified 2026-06-02)
1. **Wrong-context selection drops needed parts.** "Arduino + breadboard + I2C OLED text" → route `v2-prototyping-surface-context` (priority 28) beats `v2-digital-input-display-readout` (priority 30) at `contextPacket.ts:1696-1729`; `compactCandidatePartsForV2` then filters to the prototyping bundle, **dropping `oled-i2c-096`/`arduino-uno`** (single-winner drop at `:1424`; group inclusion at `:2201-2205`). Removing "브레드보드" restores the OLED. promptBlock ≈ 8.3–9.0k chars (NOT 38k — size is not the cause).
2. **Two full `createDeepAgent` runs per request** (requirement `:422` + synthesis `:339`), each 11 tools + full `promptBlock` → ~2× cost.
3. **6 subagents passed, delegation never instructed; `responseFormat: toolStrategy(...)` forces a single terminal emit** (`:343`) which structurally suppresses `task` delegation → subagents are passive token weight.
4. **The 502 throws at `parseLiveAgentDraft:1283`, inside the loop but UNGUARDED** (`runAgentDraftRepairLoop:900-930` has no try/catch around `draftProvider`); an existing `recoverDraftFromAgentMessages` fallback (`:1281,1289-1308`) salvages from tool-calls before throwing.
5. **No DI seams:** model hardcoded (`:294`), registry loaded internally (`contextPacket.ts:1340`), and **zero tests touch `createDeepAgent`** → reliability/growth/one-run cannot be gated until seams exist.
6. **Facts corrected by review:** 42 capabilities (5 compositional `-context`, incl. `logic-interface-context` = KNOWN_UNRESOLVED by L2); 43 routes (`agent-context/v2/routes.json`, key `routeId`, 6k–38k); FS-offloading + summarization are **ON BY DEFAULT** in `deepagents@1.10.2` (StateBackend, 20k-token eviction) — so harness context-engineering is *tuning*, not *activation*; all assumed package capabilities (`contextSchema`, `skills`, `middleware`, `backend`, `interruptOn`, model-instance) EXIST; `createMiddleware`/`wrapToolCall` import from **`langchain`**, not `deepagents`.

### Success Criteria (each a deterministic gate; default tests never call live OpenAI)
- [ ] **O(request):** doubling the injected synthetic registry does not increase candidates-considered / selection CPU / prompt tokens for a fixed request.
- [ ] **Reliability:** on the recorded-cassette corpus in `test:unit`, structured-output **first-shot ≥ 95%** and **post-fallback = 100%** (deterministic preflight fallback, never a 502); first-shot vs post-retry reported separately.
- [ ] **Correct selection:** every corpus request gets the parts it needs and excludes unrelated siblings (incl. keyword-collision set, OLED+breadboard = case #1).
- [ ] **One harness run:** exactly one `createDeepAgent` per request (asserted via the `DeepAgentFactory` seam).
- [ ] **Subagent disposition resolved by evidence** (reachability test): scoped-and-used, or removed — never paid-for-but-unused.
- [ ] **Token/latency:** synthesis-entry prompt bounded in **tokens** (`js-tiktoken`, ko-measured); context assembled once; latency budget gated.
- [ ] **Full replacement:** enumerated capability routes retired (gated by corpus parity + safety-overlay bridge); only safety/unsupported/ambiguous-minimal routes remain.
- [ ] **Anchor invariants + deterministic finalization unchanged.**
- [ ] No regression: `test:unit`, `typecheck`, `build`, `test:e2e` (72 mocked) green.
- [ ] Single flag `H_EDUWARE_AGENT_PIPELINE` (`legacy` | `shadow` | `next`), default `legacy`; concrete legacy-deletion trigger.

## Conflict Resolution (single owner per code target — eliminates document conflicts)
| Code target | Single owner phase | Notes |
|---|---|---|
| `deepAgentRuntime.ts:901` try/catch + deterministic fallback | **Phase 4** | Layers on existing `recoverDraftFromAgentMessages`; sole owner |
| Scoped subagent tools / subagent disposition | **Phase 4** | Decision from Phase 0 reachability test |
| `ModelPort` (`:294`), `DeepAgentFactory`, `PartRegistrySource` (`contextPacket.ts:1340`), cassette harness, `js-tiktoken` | **Phase 0.5** | Shared seams; built once |
| Single-run collapse (remove 2nd `createDeepAgent`) + `write_todos` synthesis | **Phase 3** | Intent → deterministic preflight |
| `promptBlock` shrink + slim entry + single assembly + prompt-domain-only | **Phase 3** | Anchor invariant 5: keep as deterministic input, do NOT FS-offload |
| Tool-OUTPUT FS-offload tuning + `contextSchema`/`context` + observability middleware (`wrapToolCall` from `langchain`) | **Phase 6** | Harness context-engineering tuning (already-on by default) |
| Tier `tier` field + selection (`:1424`, `:2201-2205`) | **Phase 1** | Additive field |
| Composition selection + retrieval index | **Phase 2** | Corpus is the sole parity gate (not the golden) |
| Safety-overlay bridge (review-only → build-ready) | **Phase 2.5** | Blocks Phase 5 |
| Enumerated route removal (`routes.json`) | **Phase 5** | Gated by 2 + 2.5 |
| Flag `H_EDUWARE_AGENT_PIPELINE` | **Phase 0.5 defines, 6 promotes** | One flag for the whole pipeline |

## Architecture Decisions (Clean Architecture)
| Layer | Components | Responsibility |
|-------|-----------|---------------|
| Domain | role taxonomy, capability/part-bundle/topology entities, explicit `tier`, anchor invariants, schemas | decomposition + composition rules; product truth |
| Application | `selectContextByComposition`, tier policy, progressive-disclosure policy, retry+fallback policy, `ModelPort`/`DeepAgentFactory`/`PartRegistrySource` ports, single-run orchestration | what context exists, how the harness is driven |
| Interface Adapters | `contextPacket` assembly, one `createDeepAgent` wiring (scoped subagents, observability middleware), retrieval index, reduced `routes.json`, cassette adapter | translate policy into packet + harness |
| Frameworks & Drivers | `deepagents@1.10.2`, `ChatOpenAI`, `js-tiktoken`, data files | behind ports/adapters |

Key decisions: composition over enumeration (O(request)); one harness run with `write_todos`; intent stays deterministic (anchor invariant 3); subagent default = remove unless reachability proves delegation usable under single-emit; shrink-not-offload pre-assembled context (invariant 5); `:901` fallback removes 502; token gates via `js-tiktoken`; `interruptOn` rejected (students need immediate safe-equivalent, not approval pause); finalization boundary untouched.

## Dependencies
Approval; resolve open questions (does single-emit `responseFormat` make `task` reachable? which of 43 routes are irreducible safety/unsupported? is `ko` dominant locale?); `js-tiktoken`; `deepagents@1.10.2` (capabilities confirmed); `.local/agent.env` key for opt-in cassette recording + live smoke.

## Test Strategy
Default gates mocked/cassette (no live OpenAI). Unit ≥90% new pure logic; characterization locks current behavior; cassette corpus eval (first-shot/fallback rates); catalog-growth (CPU+candidates+tokens flat); e2e 72 mocked; opt-in live smoke records cassettes.

## Implementation Phases

### Phase 0 — Corpus + token/efficiency harness + characterization + reachability test
- [ ] 0.1 `tests/fixtures/in-catalog-corpus.json` via a **role-slot generator** (each primary-output capability × {0,1} of each of the 5 compositional contexts × 1–2 named surface/passive variants; one representative part per role-class) + a **keyword-collision interaction set** (OLED+breadboard #1); schema-validate synthetic parts.
- [ ] 0.2 `measureContextEfficiency(request)` → `{routeId, candidatePartIds, candidatesConsidered, selectionCpuMs, entryTokens(js-tiktoken, ko), toolSchemaTokens, createDeepAgentCount}`; characterization snapshots current values (incl. OLED known-bad + two-run cost).
- [ ] 0.3 **Deterministic reachability test** (fake model): does `responseFormat: toolStrategy(...)` single-emit make `task` reachable before a terminal emit? Records the answer → drives subagent disposition (Phase 4) WITHOUT a live trace. (Optional `npm run trace:langsmith` = corroboration only.)
- Gate: TDD · build · characterization reproducible · token (not char) measurement · reachability answered.

### Phase 0.5 — Seams (PREREQUISITE)
- [ ] 0.5.1 `ModelPort` injected at `deepAgentRuntime.ts:294`; unit test drives `runAgentDraftRepairLoop` with a fake model (zero live calls).
- [ ] 0.5.2 `DeepAgentFactory` port at the composition root → enables asserting `createDeepAgent` call-count.
- [ ] 0.5.3 `PartRegistrySource` injected into `buildContextPacket` (`contextPacket.ts:1340`); registry doublable in tests.
- [ ] 0.5.4 Recorded-cassette model adapter (record opt-in/live once, replay deterministically); add `js-tiktoken` + publish ko char→token ratio.
- [ ] 0.5.5 Define flag `H_EDUWARE_AGENT_PIPELINE=legacy|shadow|next` (default legacy); production wiring = real ChatOpenAI + real registry.
- Gate: TDD · build · model+factory+registry injectable, zero live calls · Clean Arch port rule satisfied.

### Phase 1 — Tier separation (primary output vs compositional context)
- [ ] 1.1 RED: OLED+breadboard → candidates include `oled-i2c-096`+`arduino-uno`+only the named surface; surface-only (no primary) and multi-output branches defined; corpus not regressed.
- [ ] 1.2 GREEN: explicit additive **`tier`** field; selection = one primary + merged matched compositional contexts bounded to request-named parts; fix the drop at `:1424` under the flag.
- [ ] 1.3 REFACTOR: no code reads the `-context` suffix; handle `logic-interface-context` explicitly.
- Gate: TDD · build · golden no-regression · legacy path provably unchanged when flag=legacy.

### Phase 2 — Composition selection + retrieval index (core)
- [ ] 2.1 RED: `selectContextByComposition(request)` (raw request) ≥ parity vs current on passing cases AND fixes broken ones — **corpus is the sole parity gate** (not the golden).
- [ ] 2.2 RED: catalog-growth — doubling synthetic registry keeps candidates-considered / CPU / tokens flat.
- [ ] 2.3 GREEN: roles → **inverted-index top-k per role** → L2 compose, behind `H_EDUWARE_AGENT_PIPELINE=shadow|next`; document the per-request top-k bound; replace O(templates×parts) scan.
- Gate: TDD · build · corpus parity+fixes · growth test (CPU+candidates) · e2e no-regression.

### Phase 2.5 — Safety-overlay bridge
- [ ] 2.5.1 RED: composed topology + valid overlay → `buildReadyScope != 'review-only'`; without overlay stays review-only (reuse `bundlePromotion.ts` cycle-breaker).
- [ ] 2.5.2 GREEN: overlay generation/attachment for `generatedComposition`.
- Gate: TDD · build · review-only invariant preserved without overlay · **blocks Phase 5**.

### Phase 3 — Single-run harness + progressive disclosure + token-lean assembly
- [ ] 3.1 RED: exactly ONE `createDeepAgent` per request (assert via `DeepAgentFactory`); intent via deterministic preflight (`buildPreflightDraftFromAnalysis:945`), `write_todos` for synthesis decomposition within the one run; requirement-route distribution unchanged within tolerance vs the two-run baseline (corpus).
- [ ] 3.2 RED: entry block = slim index (capabilities + candidate part ids + selected bundle headlines + retrieval plan); **critical-inline rule** (parts the model must reason about keep pins/protocol inline); entry tokens ≤ target corpus-wide; **promptBlock stays deterministic input — NOT FS-offloaded** (anchor invariant 5); remove non-`v2` verbose `JSON.stringify(null,2)`.
- [ ] 3.3 RED: `systemPrompt` = domain-only via token-budget + product-invariant allowlist (it is already mechanics-free; this locks it).
- [ ] 3.4 GREEN: remove the 2nd `createDeepAgent`; split `renderPromptBlock`→`renderEntryIndexBlock` + on-demand detail; shadow under-pull metric ~0.
- Gate: TDD · build · one-run asserted · entry-token bound · under-pull ~0 · e2e no-regression.

### Phase 4 — Tool disclosure + structured-output reliability (SOLE owner of `:901`)
- [ ] 4.1 RED: subagent disposition from Phase 0 reachability — **default Path B (remove unused subagents)**; only if delegation is reachable+valuable, Path A (scope each subagent to its phase tools, coordinator slimmed, summaries returned).
- [ ] 4.2 RED (cassette/fake model): a `draftProvider` throw of `AgentStructuredOutputError` on attempt 1 is **caught**, retried; on exhaustion → deterministic preflight fallback (`buildPreflightDraftFromAnalysis`), never a 502. Layers on existing `recoverDraftFromAgentMessages`.
- [ ] 4.3 GREEN: try/catch + fallback at `deepAgentRuntime.ts:901`; apply the subagent decision; first-shot vs post-retry reported.
- Gate: TDD · build · throw-path retry unit-tested · cassette first-shot ≥95% / fallback 100% · tool-schema tokens reduced · e2e no-regression.

### Phase 5 — Full replacement: retire enumerated routes (blocked until 2 + 2.5 green)
- [ ] 5.1 RED: `routes.json` keeps only irreducible safety/unsupported/ambiguous-minimal (from the open-question audit); corpus selection unchanged vs Phase 2.
- [ ] 5.2 GREEN: remove enumerated capability routes; default `H_EDUWARE_AGENT_PIPELINE=next`.
- Gate: TDD · build · golden + corpus green · routes reduced · e2e no-regression.

### Phase 6 — Harness context-engineering tuning + observability + live verify + promotion
- [ ] 6.1 Tune tool-OUTPUT FS-offload threshold (already on by default); move `toolOptions` to runtime `context`/`contextSchema` where it cuts prompt tokens; consider `checkpointer` for multi-turn build-confirmation (currently re-serialized each turn). **in-state backend only** (no disk path to tools — anchor).
- [ ] 6.2 Observability middleware via `wrapToolCall` (imported from `langchain`) — tool-gate/repair/retry/fallback events, roles matched, parts pulled, retrieval misses. (`interruptOn` documented as considered-and-rejected.)
- [ ] 6.3 Opt-in live smoke over corpus refreshes cassettes; CI metric gate (entry tokens ≤ bound; candidates/CPU flat); **latency budget** numeric gate; **prod runtime kill-switch** (next→legacy without redeploy).
- [ ] 6.4 (optional) Domain knowledge as **skills** (progressive disclosure); if subagents kept (Path A), wire skills per-subagent (they don't inherit).
- [ ] 6.5 Promote flag `legacy`→`shadow`→`next`; **legacy-deletion trigger**: `next` default in CI for N green runs AND live-smoke ≥ target for M runs.
- Gate: full `npm run check` green · live corpus reliability met · metric+latency gates · kill-switch verified.

## Risk Assessment
| Risk | Prob | Impact | Mitigation |
|------|------|--------|------------|
| Composition doesn't reach corpus parity before route removal | High | High | Corpus parity gate blocks Phase 5; flag keeps legacy; Phases 1+3 land independently |
| Reliability ungateable without seams | Certain-if-skipped | High | Phase 0.5 seams + cassette BEFORE feature work |
| Safety-overlay bridge unscoped → composition stays review-only | High | High | Dedicated Phase 2.5; blocks Phase 5 |
| O(catalog) leaks via retrieval/topology scan | Med | High | Inverted index + top-k; growth test on CPU/candidates |
| `responseFormat` suppresses delegation → Path A infeasible | Med | Med | Phase 0 reachability decides; default Path B (remove) |
| Char≠token cost regression (ko) | High | Med | `js-tiktoken`, token gates |
| Removing 2nd run lowers intent quality | Med | Med | Deterministic preflight + route-distribution gate vs baseline |
| D4-style FS-offload violates anchor invariant 5 | Med | High | Shrink promptBlock (Phase 3), only tool-OUTPUT offload (Phase 6), in-state backend only |
| Progressive-disclosure under-pull | Med | Med | Critical-inline rule + under-pull metric |
| Phases not flag-rollback-able (schema/renderer/subagent/harness edits) | Med | Med | Additive tier field; honest **git-revert** for Phases 3–4–6 structural edits |
| Estimate underrun | High | Med | ~9–12 phases / 40–60h (merged scope); open-ended risk in Phase 2 parity + 0.5 seams |

## Rollback Strategy
- **Flag-revertible** (`H_EDUWARE_AGENT_PIPELINE=legacy`): composition selection (Phase 2/5).
- **Git-revert (honest):** additive `tier` field (Phase 1, legacy ignores it); Phase 3 (single-run + renderer split), Phase 4 (subagent + `:901`), Phase 6 (middleware/context) mutate shared code → `git revert`, NOT flag flip.
- **Phase 5** (route removal) is the only destructive step; revert = restore `routes.json` + flag legacy + revert Phase 1 tier together for a consistent legacy system.
- **Prod:** runtime kill-switch (6.3). Deterministic finalization is never touched → server validation/render/simulation remain the safety net throughout.

## Progress Tracking
- Phase 0: ✅ 100% (corpus + efficiency harness + characterization + reachability — additive, all gates green)
- Phase 0.5: ✅ 100% (ModelPort + DeepAgentFactory + PartRegistrySource + cassette + flag + js-tiktoken pin — hot-path seams, behavior preserved, TS 359/359)
- Phases 1, 2, 2.5, 3, 4, 5, 6: 0% · Overall: ~22%

### Phase 0 finding that revises the plan
- **Reachability (deterministic, fake-model through a real `createDeepAgent`): `task` delegation is BOTH bound AND executable under `responseFormat: toolStrategy(...)`.** A model that calls `task` runs the subagent and then still emits the terminal `structuredResponse`. So the review's K1 "`responseFormat` structurally suppresses delegation" is **refuted** — passivity is *behavioral* (never instructed; model converges to immediate emit), not structural. **Phase 4 impact:** Path A (keep + scope + instruct delegation) is technically feasible (not harness-blocked); the default remains **Path B (remove)** but now for *token economy*, not because delegation is impossible.
- **ko token cost (o200k_base) ≈ 0.61 tok/char** for the #1 message — Korean is efficient in o200k (contra the cl100k-era "1.5–3 tok/char" assumption). Phase 3 token budgets must be set from o200k measurement.

## Notes & Learnings (merged)
- OLED bug = group-grained single-winner selection (`:1424`, `:2201-2205`), not prompt size; "브레드보드" keyword mis-routes and drops the OLED.
- 42 capabilities (5 compositional `-context`; `logic-interface-context` KNOWN_UNRESOLVED by L2); 43 routes (6k–38k).
- The 502 throws at `:1283`, unguarded in the loop (`:900-930`); `recoverDraftFromAgentMessages` already salvages first — layer the fix on it.
- deepagents@1.10.2: FS-offload + summarization ON BY DEFAULT (tune, don't activate); all assumed capabilities present; `createMiddleware`/`wrapToolCall` from `langchain`; model-instance accepted.
- `responseFormat` single-emit structurally suppresses `task` delegation → subagents likely removable (confirm via Phase 0 reachability test).
- Intent stays deterministic (anchor invariant 3); `write_todos` is for synthesis decomposition in one run.
- Two prior plans duplicated `:901` and scoped-subagent-tools; this merge assigns single owners (§Conflict Resolution) so there are no document conflicts.
- Estimate ~9–12 phases / 40–60h; blow-up risk in Phase 2 parity + the 0.5 seam refactors of hot-path files.

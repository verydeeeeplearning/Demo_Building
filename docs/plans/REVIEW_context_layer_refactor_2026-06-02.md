# Adversarial Review Synthesis: PLAN_context_layer_refactor.md

**Date**: 2026-06-02
**Reviewers**: 3 independent subagents — (1) architecture critic, (2) code fact-checker, (3) execution/TDD/risk critic.
**Verdict**: **REVISE before starting.** Diagnosis and direction are code-verified and sound; but three load-bearing items are unbuildable/unsupported as written. Plan revised to Rev. 2.

## Verified-correct (keep)
- Root cause of the OLED 502 = **group-grained single-winner selection**, not prompt size. Reproduced: route `v2-prototyping-surface-context` (priority 28) beats `v2-digital-input-display-readout` (priority 30); `compactCandidatePartsForV2` then filters to the prototyping bundle, dropping `oled-i2c-096`/`arduino-uno`. Removing "브레드보드" flips the route and restores the OLED. Mechanism lines: `contextPacket.ts:2201-2205` (group inclusion), `:1424` (single-winner drop), `:1696-1729` (priority sort).
- 11 tools are generic/part-agnostic (`deepAgentTools.ts:71-188`) — "no 130 tools" is correct.
- Duplicate full context per stage is real (synthesis `deepAgentRuntime.ts:329,341`; requirement `:410-428`).
- `isV2Prompt=false` fallback uses verbose `JSON.stringify(…,null,2)` (`contextPacket.ts:2771-2786`).
- 5 compositional `-context` capabilities exist.

## CRITICAL findings (must fix — drove the REVISE verdict)

| # | Finding | Evidence | Resolution in Rev. 2 |
|---|---------|----------|----------------------|
| C1 | **No model-injection seam → reliability can't be a deterministic gate** (only opt-in live smoke), violating "no live dependency in default gate". | `deepAgentRuntime.ts:294` hardcodes `new ChatOpenAI(...)`; all tests use fixtures, never the model path. | New **Phase 0.5 "Seams"**: `ModelPort` DI + **recorded-cassette** replay harness. Reliability becomes a deterministic `test:unit` gate. |
| C2 | **Phase 4 misdiagnoses the throw site.** The 502 throws at `parseLiveAgentDraft:1283`, OUTSIDE the retry guard (`runAgentDraftRepairLoop:917-930`, no try/catch around `draftProvider`). `responseFormat`+`maxAttempts=2` already exist. | `deepAgentRuntime.ts:1283, 343, 862, 901-930` | Phase 4 rewritten to wrap `draftProvider` in try/catch, treat `AgentStructuredOutputError` as retryable, and **fall back to a deterministic preflight draft** (`buildPreflightDraftFromAnalysis:945`) on exhaustion instead of 502. |
| C3 | **"34/39 golden" can't justify route replacement.** Golden feeds CURATED `allowedParts` and compares validation-rules only — it measures reconstruction-from-correct-parts, not request→part selection. Gate is `>=30`, 34 is measured. | `composeContextGolden.test.ts:20-29,85` | Golden dropped as parity evidence. **Corpus eval (raw request → candidate parts) is the sole parity gate.** |
| C4 | **L2 engine is `review-only` by construction + no routing hook.** Promoting it needs a **safety-overlay bridge** (unscoped) AND routing integration. | `generatedComposition.ts:50-54` (buildReadyScope hard-pinned), shadow/log-only at `deepAgentRuntime.ts:247` | New **Phase 2.5 "Safety-overlay bridge"**; route retirement (Phase 5) blocked until it exists. |
| C5 | **No registry-injection seam → O(request) growth test unwritable; and O(catalog) leaks.** `selectComposableTopology` is O(templates×parts) (55 templates grow with catalog); no index/top-k. | `contextPacket.ts:1340,1402`; `generatedComposition.ts:80-88`; `composeTopology.ts:215-233` | Phase 0.5 adds registry-source injection; Phase 2 adds an **inverted index + top-k per role**; growth test asserts on **candidates-considered/CPU**, not only chars. |

## MAJOR findings (fix)
- **M1 Char≠tokens, esp. Korean (locale `ko` ≈ 1.5–3 tok/char).** Char gate can pass while cost blows up 6–10×. → Add `js-tiktoken` (or publish measured ko ratio); set bounds in **tokens**, re-derive the "12k" from a real cost budget.
- **M2 Tier signal is name-suffix only** (the exact anti-pattern Phase 1.3 forbids); `logic-interface-context` (one of the 5) is `KNOWN_UNRESOLVED` by L2 (golden:33). → Explicit `tier` field on manifests; define **surface-only** (no primary) and **multi-output** branches; handle the unresolved case.
- **M3 Progressive disclosure adds a new failure mode** (model fails to pull → worse, non-deterministic) that tensions with the reliability goal. → Define **critical-inline vs pullable** facts (needed parts' pins/protocol stay inline); add a shadow **under-pull metric**.
- **M4 Phases not independently flag-rollback-able.** The drop line `:1424` and tier/schema/renderer changes mutate the LEGACY path too. → Make tier-tagging **additive (optional field)**; gate structural refactors; downgrade Phases 3–4 rollback to "git revert" (honest).
- **M5 Corpus under-specified / combinatorially unbounded.** → Generator = **role-slot templated**: each primary-output capability × {0,1} of each compositional context × 1–2 named surface/passive variants, one representative part per role-class. Include an explicit **keyword-collision interaction set** (OLED+breadboard = case #1). Report **first-shot vs post-retry** pass-rates separately.
- **M6 Bounded retry can inflate the reliability number** → separate first-shot from post-retry; realizable cases must pass without relying on retry.
- **M7 Flag doubles test matrix with no deletion trigger.** Flag `H_EDUWARE_CONTEXT_SELECTION` does NOT exist (existing is `H_EDUWARE_CONTEXT_COMPOSE_MODE` off/shadow/on). → Define a concrete **legacy-deletion trigger** (N green CI runs + M live-smoke passes).

## Missing gates added in Rev. 2
Observability/telemetry on selection (roles matched, parts pulled, retrieval misses); **latency budget** with a numeric gate; **prod runtime kill-switch**; **data-shape/schema validation** for composition outputs.

## Factual corrections applied
- "53 capabilities" → **42** (recurred 3×). "5 `-context`" correct.
- Requirement-analysis live path is `deepAgentRuntime.ts:410-428` (not `:203-214`, which is an audit helper).
- promptBlock measured ~8.3–9.0k (refutes the 38k strawman either way).
- Flag name discontinuity fixed (extend `H_EDUWARE_CONTEXT_COMPOSE_MODE` family, correct values).
- Routes: **43**, path `agent-context/v2/routes.json`, key `routeId`.

## Re-sized estimate
Not "Large 6–7 phases / 15–25h" but **~8–10 phases / 30–50h** — includes two DI refactors of hot-path files (~3,500 and ~1,600 lines), a cassette harness, a tokenizer, a corpus, an index, a safety-overlay bridge, and parity-matching 43 routes via composition. Blow-up risk concentrated in Phase 2 (open-ended parity) and the Phase 0.5 seam refactors.

## Open questions to resolve before/early in execution
- Does `deepagents@1.10.2 createDeepAgent` accept an injected model instance (clean port) or only config? (affects C1 effort).
- Are all 43 routes truly enumerated-capability, or do some encode irreducible safety/unsupported logic composition won't replace? (affects Phase 5 scope).
- Is `ko` the dominant production locale? (raises M1 priority).

# Adversarial Review Synthesis: PLAN_deepagents_architecture_refactor.md

**Date**: 2026-06-02
**Reviewers** (each given the official LangChain Deep Agents docs as context): (1) official-conformance critic, (2) code+package fact-checker, (3) execution/TDD/risk critic.
**Verdict**: **REVISE**, and **strongly consider MERGING with `PLAN_context_layer_refactor.md`** — the two overlap on shared seams, the same file, and the same line.

## Verified-correct (keep)
- As-Is is accurately diagnosed: TWO `createDeepAgent` runs per request (`deepAgentRuntime.ts:339` synthesis, `:422` requirement), 11 tools each, full `promptBlock` inlined both times, 6 subagents (3 explicitly carrying all 11 tools: context-retriever/constraint-validator/simulation-planner), prompt gives NO delegation instruction, throw at `parseLiveAgentDraft:1283` uncaught in `runAgentDraftRepairLoop:900-930`. Deterministic finalization preserved (anchor-correct).
- **All assumed package capabilities EXIST in `deepagents@1.10.2`** (`index.d.ts`): `contextSchema` (:3084), `skills` (:3139), `middleware` (:3072), `backend` (:3094), `interruptOn` (:3099), summarization middleware, model-INSTANCE accepted (`model?: BaseLanguageModel | string` :3066). **No package feasibility blocker.**

## CRITICAL findings (must fix)

| # | Finding | Evidence | Resolution |
|---|---------|----------|------------|
| K1 | **`responseFormat` structurally suppresses `task` delegation.** "Subagents passive" is NOT a prompt-wording issue — a forced `toolStrategy` terminal single-emit makes the model converge on emitting structured output, never fanning out to `task`. D3 "instruct delegation" misframes the cause. | `:343` toolStrategy + `:1448-1461` emit-now prompt + no delegation text | Reframe D3 around the responseFormat↔delegation tension. **Default to Path B (remove unused subagents)** unless a deterministic reachability test proves `task` is reachable under single-emit. If keeping delegation, it requires a different architecture (no main-agent responseFormat; coordinator's final turn emits). |
| K2 | **D5 collides with context-plan Phase 4 on the SAME line (`:901`), same fix.** Both wrap `draftProvider` in try/catch + preflight fallback. | this D5.2 vs context-4.3 both cite `:901` | **Context-plan Phase 4 is SOLE owner** of the `:901` retry/fallback. D5 keeps ONLY the net-new `wrapToolCall` observability middleware. |
| K3 | **D2 "exactly one createDeepAgent" has NO test seam** (zero tests touch `createDeepAgent`; `runAgentWithScriptedDrafts:124` bypasses it). | grep: no test refs | Add a **`DeepAgentFactory` port** (composition-root injection) so a fake factory asserts call-count === 1. |
| K4 | **As-Is premise WRONG: FS-offloading + summarization are ON BY DEFAULT in 1.10.2** (default StateBackend, 20k-token eviction, default summarization), not "Unused". | `index.d.ts:756,762` + harness docstring | D4 is **config/tuning**, not activation. Correct the As-Is inventory. |
| K5 | **D4 FS-offloading risks an ANCHOR violation.** `promptBlock` is pre-assembled INPUT context, not tool output; offloading it to virtual FS + `grep` = "broad context reads" forbidden by anchor invariant 5. | anchor `:96-99,142-146` | **Split D4**: D4a = offload large *tool outputs* (harness-native, already on — just tune). D4b = *shrink* `promptBlock` (bundle-first, invariant 2) — keep it deterministic input, do NOT FS-offload. In-state backend only (no disk path to tools). |

## MAJOR findings (fix)
- **M1 D0 live-trace prerequisite contradicts "no live in default gate" and blocks D3.** Replace with a **deterministic fake-model reachability test** (does single-emit `responseFormat` even make `task` reachable?). Live trace = optional corroboration only. Default disposition = Path B if delegation unreachable.
- **M2 D1 gate is unverifiable AND its premise is false** — both prompt builders (`:1448-1461`, `:1406-1421`) are ALREADY domain-only (zero todo/FS/subagent mechanics). Reframe D1 as **token-budget (`js-tiktoken`) + product-invariant allowlist**, or fold into context-plan Phase 3.
- **M3 D2 intent-quality regression unguarded by this plan** — depends on the context-plan corpus. Add a hard dependency on context Phase 0 + a **requirement-route-distribution gate** vs the two-run baseline.
- **M4 Rollback overclaims flag-revertibility** — D1/D2/D3/D5 mutate shared code in `deepAgentRuntime.ts`/`createSubagents`; honest rollback = **git revert** (match context-plan's stance). Name a **distinct flag** (e.g., `H_EDUWARE_AGENT_RUNTIME=legacy|single-run`) or subsume under context-plan's `composition` mode.
- **M5 `wrapToolCall`/`createMiddleware` are `langchain` exports, not `deepagents`** — import path correction (toolStrategy is already imported from `langchain`, so precedent exists).

## Under-used official capabilities (add as considered)
- **`interruptOn` (human-in-the-loop):** add a considered-and-**rejected** row — H-eduware needs an immediate deterministic safe-equivalent for students, not an approval pause. Silence reads as oversight.
- **`contextSchema`/`context`:** promote from D4 afterthought to an explicit decision — `toolOptions` (candidateParts/allowedSources/supportBundles) is the textbook runtime-context case.
- **`checkpointer`/`store`:** multi-turn build-confirmation (`awaitingBuildConfirmation`) is re-serialized into the prompt every turn (`renderConversationContextForPrompt:1486`) — a checkpointer is the harness-native replacement.
- **`skills`:** more central than "optional" given prompt bloat is the core problem; note subagents do NOT inherit skills (anchor `:82`) → connect D3↔D6.

## Minor corrections
- `renderSubagentPromptBudgetText:1530` feeds **budget accounting**, not the live systemPrompt; subagent descriptions reach the model via the built-in `task` tool schema. (Plan's cited mechanism is wrong; the "passive weight" conclusion still holds.)
- `responseFormat → structuredResponse` is **not a per-invocation guarantee** (that's why the throw exists) — tighten the Official-model summary wording.
- The existing `recoverDraftFromAgentMessages` fallback (`:1281,1289-1308`) already salvages a draft from tool-call history before throwing — the reliability fix must layer on it, not duplicate it.

## Cross-plan relationship (the meta-finding)
This plan is **not** "cross-referenced, not duplicated" — it duplicates implementation targets with the context-plan:
| Shared target | here | context-plan |
|---|---|---|
| `:901` retry/fallback | D5.2 | Phase 4.3 |
| scoped subagent tools | D3 Path A | Phase 4.1 |
| `ModelPort` seam | consumes | Phase 0.5 owns |
| cassette harness | consumes | Phase 0.5 owns |
| progressive disclosure / offload | D4 | Phase 3 |

**Recommendation (all 3 reviewers converge):** Either **MERGE** into one unified refactor plan with a single owner per code target, or **subordinate** this plan to the context-plan with: explicit dependency on context Phase 0/0.5/4, de-duplicated targets (drop D5 retry, drop D3-PathA duplication), and stated sequencing (AFTER 0.5 + 4; interleave D3/D4 with Phase 3/4).

## Net direction
Diagnosis is accurate and evidence-dense; deterministic finalization (the safety net) is correctly preserved. But the plan misreads the *cause* of subagent passivity (K1), collides with the companion plan (K2), lacks the seam for its headline deliverable (K3), and mis-states default harness behavior (K4). Fix these + decide merge-vs-subordinate before execution.

# Architecture: Agent-Native Retrieval with Progressive Disclosure

**Status**: Design draft (for review)
**Date**: 2026-06-04
**Supersedes the retrieval half of**: the deterministic keyword funnel (`capabilityGraph` matching → route → bundle pre-selection → candidateParts gate).
**Keeps**: the determinism boundary for validation/render/simulation (Deep Agents production guidance).

---

## 0. The shift (why)
Today retrieval is a **deterministic keyword funnel** decided BEFORE the agent: `matchCapabilities` (keyword scoring) → route → v2 bundle → `candidateParts`/`retrievalPlan`. The agent can only read inside that pre-selection and **cannot recover from a funnel miss** (e.g. unspaced `조도센서`), because even `search_part_capabilities` is filtered to `candidateParts`. This is brittle (spacing/typos/synonyms) and under-uses the Deep Agent.

**New model:** hand RETRIEVAL to the agent. The agent starts with a compact **menu** (what exists) + **design principles** + **safety**, then pulls detail on demand via tools (**progressive disclosure**). Correctness moves from an *input gate* to an *output DRC*. This is the idiomatic Deep Agents pattern: the agent searches a grounded knowledge store; deterministic code verifies the result.

**Invariant preserved:** the user-facing result is still "at least sensible" — guaranteed now by the **output DRC + always-on safety + grounded catalog (anti-hallucination)**, not by the input funnel.

---

## 1. Progressive-disclosure tiers (the core of this design)

Context separates cleanly by *when* it is needed. Only T0 is always in the prompt; T1–T3 are tool-fetched on demand.

### T0 — Always-on (system prompt; must stay small)
- **Operating rules** — determinism boundary; chat / build / clarify routing (agent decides, no rule gate).
- **Universal hardware design principles** (~10–16) — so the agent designs sensibly without retrieval.
- **Safety policy** (compact) — non-negotiable; the unsafe-request guard cannot be deferred.
- **Part catalog INDEX** — all 132 parts as compact entries (schema in §2). The "menu."
- **Knowledge INDEX** — what reference docs/tools exist and how to fetch them.

Budget target: T0 ≤ a few KB. The index carries *aliases + category + role*, not pins/footprints.

### T1 — Selection-triggered (per part the agent picks)
- `get_part_detail(id)` → pins (names/roles), electrical limits, required passives, footprint summary, common mistakes, safe substitutes.
- Only the chosen parts load — never all 132.

### T2 — Build-triggered (only when synthesizing a circuit)
- `get_wiring_guidance(intent | parts)` → topology + validated wiring rules for the combination — the existing `BUNDLE.md` / `topology-templates.json` repurposed as **exemplars/reference**, NOT as a gating pre-selection.
- Not loaded for chat/recommendation turns.

### T3 — Conditional (only when a signal is present)
- `get_protocol_rules(i2c | spi | uart)` → only if a protocol part is chosen (I2C pull-ups, SPI chip-select, UART crossover).
- `get_electrical_budget(parts)` → only for motors/relays/multi-load (rail current, aggregate GPIO).
- clarification / pedagogy guidance → only when ambiguous / explaining.

### Server-only (agent never sees — deterministic stage ④)
- breadboard grid, render-footprint XYZ anchors, simulation compile, placement/label solvers. The agent works at the netlist/intent level; geometry is code.

**Why this split is safe:** each tier is fetched by an explicit agent action, so the prompt holds only what the current decision needs. Mirrors the Deep Agents filesystem pattern (store detail out-of-context, load summaries, fetch full on demand).

---

## 2. Part catalog INDEX schema (the menu — the keyword-matcher replacement)
Compact per-part entry, always in T0. Aliases (esp. Korean) live HERE, consolidated from today's scattered capability phrases:
```
{
  "id": "photoresistor-ldr",
  "labels": ["조도센서", "조도 센서", "빛센서", "광센서", "LDR", "photoresistor"],   // KO+EN, spaced+unspaced
  "category": "input-sensor",            // input-sensor | output | display | motor | comms | passive | board | controller
  "role": "analog-light-input",
  "summary": "빛의 밝기를 아날로그로 읽는 센서",
  "supportLevel": "supported"            // supported parts surface; unsupported flagged for safe handling
}
```
- The agent reads the whole menu and maps `조도센서`/`조도 센서`/`LDR 센서로`/typos → `photoresistor-ldr` by alias + context — **no keyword scorer, no spacing fragility.**
- 132 entries × ~5 lines compact → fits T0 budget; full detail is T1.

---

## 3. Tools (retrieval surface)
| Tool | Tier | Returns | Replaces |
|---|---|---|---|
| `search_parts(query)` | T0→T1 | matching catalog entries (over the FULL catalog, ungated) | gated `search_part_capabilities` |
| `get_part_detail(id)` | T1 | pins, limits, passives, footprint summary, mistakes, substitutes | (new) |
| `get_wiring_guidance(intent\|parts)` | T2 | topology + wiring rules (exemplar) | bundle pre-selection |
| `get_protocol_rules(bus)` | T3 | I2C/SPI/UART rules | (conditional) |
| `get_electrical_budget(parts)` | T3 | rail/GPIO current budget | (conditional) |
| `design_rule_check(spec)` | output | structured DRC violations (the guarantee) | the input coverage gate |

The agent's ReAct loop: read menu → `search_parts`/`get_part_detail` for what it needs → (if building) `get_wiring_guidance` → emit `CircuitSpec` → `design_rule_check` → repair loop → finalize.

---

## 4. Determinism boundary (unchanged where it matters)
- **LLM owns**: intent, route, part selection, topology choices, explanation — now ALSO retrieval.
- **Deterministic code owns**: the catalog ground-truth (parts/pins/limits — anti-hallucination), the **output DRC** (electrical + sensibleness), placement/render/simulation, and the **safety guard**.
- Correctness shifts from *input gate* → *output DRC*. **Consequence: the DRC must be complete** — anything the old `candidateParts`/`contextCoverage` gate caught up front must now be caught at the output (invalid parts, unsafe requests, unsupported combinations).

---

## 5. Safety (moved, not removed)
The old funnel blocked unsafe requests at routing (e.g. `high-voltage-load-control`). With agent retrieval:
- **Always-on safety policy (T0)** + the 3 `unsupported` safety capabilities become **explicit refusal rules** the agent always sees.
- A **search-time filter**: unsupported/unsafe parts are flagged in the catalog so the agent won't select them, and
- an **output guard**: `design_rule_check` / a safety check rejects an unsafe spec and emits the safe-alternative (the existing safe-low-voltage-equivalent path).

---

## 6. What is dropped vs kept
- **Dropped**: `capabilityGraph` keyword scoring, the route table as a *selection* mechanism, per-combination v2-bundle *pre-selection*, the `candidateParts`/`retrievalPlan` input gates.
- **Repurposed**: v2 bundles + topology-templates → **T2 exemplars** (reference the agent can fetch), not gates.
- **Kept**: the part registry (becomes the catalog ground-truth + index), the universal principles, the deterministic validate→render→simulate pipeline, the output DRC, the safe-equivalent path.

---

## 7. Trade-offs (honest)
- **Non-determinism ↑**: same input may retrieve/select differently. Mitigate with low temperature + the output DRC as the stable gate + eval harness on outcomes.
- **Latency/cost ↑**: more tool round-trips. Mitigate with progressive disclosure (only fetch what's needed) + a cheap model for retrieval steps.
- **DRC completeness is now load-bearing**: the input gate's safety/validity must be fully covered at output. This is the biggest risk; the DRC must be audited for coverage parity with the old gates before the funnel is removed.
- **Budget**: T0 menu must stay small; if 132 compact entries + principles + safety exceed budget on tight routes, paginate the menu by category or fetch category sub-menus (a T0→T1 step).

---

## 8. Migration phases (strangler — funnel and agent-retrieval coexist)
- **P1 — Build the catalog index** (§2): consolidate aliases (KO+EN, spaced+unspaced) + category + role into a single catalog index; author/verify all 132 entries. (Data; also serves the keyword matcher in the meantime.)
- **P2 — Add the retrieval tools** (§3) behind a flag: `search_parts` (ungated), `get_part_detail`, `get_wiring_guidance`. Keep the funnel active in parallel.
- **P3 — Output DRC parity**: audit `design_rule_check` covers everything the `candidateParts`/`contextCoverage`/safety gates caught; close gaps. (Prereq to removing the funnel.)
- **P4 — Flip**: route a cohort through agent-retrieval (menu + tools, ungated) instead of the funnel; measure outcome accuracy (winning-circuit correctness, false-build, unsafe-leak) vs the funnel on a shared eval.
- **P5 — Remove the funnel** once parity is proven; bundles/templates remain as T2 exemplars.

---

## 9. Open questions
1. **Menu budget**: do 132 compact entries + principles + safety fit T0 on the tightest routes, or is category-paginated menu needed?
2. **DRC parity**: can the output DRC fully replace the input coverage/safety gates? (P3 audit decides; this gates the whole change.)
3. **Retrieval model**: keyword `search_parts` over the catalog vs embedding/semantic search vs pure LLM-over-menu — start with LLM-over-menu (simplest; the menu IS the retrieval surface) and add semantic search only if the menu grows too large to hold in T0.
4. **Non-determinism acceptance**: is outcome-level eval (not exact-match) an acceptable correctness bar for a teaching app?

---

# REVIEW VERDICT (4-angle rigorous review) — 2026-06-04

Deep-Agents-mechanism / codebase-DRC-parity / retrieval-RAG / holistic-critic reviewers converged. **The thesis (agent-native retrieval + progressive disclosure + output DRC) is idiomatic and directionally right, but it must NOT be built now as scoped.** Three hard blockers + a safety regression. Recorded so the design isn't lost; gated behind explicit conditions.

## Hard blockers (measured)
1. **T0 menu doesn't fit the budget.** The 130-part compact menu measures **~18.7 KB (~4.7K tokens)** — but the tightest routes cap at **6000–9000 chars and already overflow live** (`deepAgentRuntime.ts:945`, "synthesis 9029/9000"). The full menu can't sit in T0 on most routes → category-pagination is **forced**, which reintroduces a routing decision = "a funnel by another name." The core premise ("agent sees the whole menu, no funnel miss") collapses. Adding the Korean aliases that motivate the design makes it worse.
2. **DRC parity is NOT fully achievable — re-scope required.** Of 4 input gates: candidate-part = redundant post-flip (`UNKNOWN_PART` already checks the full registry); intent-fulfillment = ports but its reference softens to LLM-asserted; **context-coverage = impossible at output** (it audits the retrieval plumbing, not the circuit → RETIRE, not port); **safety = must stay PRE-EMPTIVE.**
3. **Safety relocation is a category error (student-safety regression).** Unsafe requests are *intent-shaped* and built from **supported** parts ("unlock my house", "charge a LiPo by shorting it"). All 130 catalog parts are `supportLevel: supported`; safety today is the **route gate** (`requestScope.ts:31`), which §6 proposes to delete. A per-part search filter / output DRC has no signal to catch intent-level danger. **Safety must remain a pre-emptive, message-level gate — do not move it to output.**

## Deep-Agents mechanism corrections (if ever built)
- **Structured-output-after-many-tools is the biggest mechanical flaw.** `providerStrategy`+tools → 400 (strict schema on all tools); `toolStrategy` → model talks (0/6, already observed). Fix: **replace the `CircuitSpec` `responseFormat` with a `submit_circuit(spec)` TERMINAL TOOL** that validates + DRCs internally. Deep-Agents-native.
- The 7-step ReAct chain **won't pipeline on its own** → use `write_todos` planning + make the **DRC the grounding enforcer** (reject specs whose pins weren't fetched / don't match the catalog).
- Progressive-disclosure detail → **virtual filesystem** (`write_file` + summary), not into the conversation (token growth on gpt-5.4-mini).
- **T3 conditional (protocol rules) MUST be deterministic, not agent discretion** — the agent will forget I2C pull-ups; enforce in the DRC.
- Bound the repair loop + set `recursionLimit` (default 25 → `GraphRecursionError`). Split **build into a `task` subagent** (context isolation + small tool surface for reliable structured output).

## Retrieval-design corrections
- **LLM-over-menu is the weakest primitive** (mis-selection among similar parts). Use a **fuzzy-normalized keyword `search_parts`** (NFKC + Korean particle strip + jamo edit distance) as v1 — *generates* robustness to typos/spacing instead of enumerating aliases. The "alias list fixes typos" claim is false for an exact list. Embeddings = over-engineering for 132 fixed parts.
- **Anti-hallucination needs enforcement, not just grounding**: (a) enum-constrain the part-id field to the 130 catalog ids; (b) DRC **pin-provenance** validation (reject pins not in fetched detail; fail-closed if detail never fetched).
- The named missing failure mode is **under-fetch** (agent doesn't fetch a tier it needs). Schema additions: `voltage_domain`, `disambiguator` note, `canonical_id`/`supersedes`, `requires`/companion.

## Non-determinism
A teaching app where 30 students run the same prompt should get the **same circuit**. The funnel's determinism is a FEATURE. Agent-retrieval must meet a hard reproducibility requirement or that alone is a kill criterion.

## Catalog data readiness
~80% present (130 parts have KO+EN aliases, `commonMistakes`, `safeSubstitutes`). Gaps: only ~28 **unspaced** KO tokens (the headline fix is NOT in the data yet), 29 controllers lack KO, no `summary`, no `category`. P1 data work = hours-to-low-days.

## CONSENSUS SHIP ORDER (what to actually do)
1. **NOW** — the per-capability **Korean data fix** (`requiredEvidence`/`negativeEvidence`, exploiting the existing Hangul substring path `capabilityGraph.ts:150-153`) + an **unspaced/typo/mixed Korean eval**. Near-zero blast radius; fixes the real user pain. (= PLAN_coverage_and_dedup R2/A0)
2. **NOW-ish** — A2/A3 data + **Part B = Direction B** (delete dead `circuit/*` duplicates).
3. **OPTIONAL, additive, low-risk** — ship an **ungated `search_parts` RECOVERY tool ALONGSIDE the funnel** (does not remove any gate). Captures ~90% of the agent-retrieval recoverability for ~2% of the risk. This is the pragmatic middle path.
4. **DEFERRED / research-spike only** — the full input→output shift + funnel removal. Gate behind ALL of: (a) a completed DRC-parity matrix + adversarial safety tests, (b) proof the alias-complete menu fits T0, (c) an explicit kill criterion, (d) a determinism acceptance test.

**Status → DEFERRED.** The agent-native-retrieval idea is sound but premature; the cheap data fix + an additive recovery tool deliver the user value now without the safety/determinism/budget risks.

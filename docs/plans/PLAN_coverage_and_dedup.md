# Plan: Capability-Match Coverage (Part A) + Pipeline De-duplication (Part B)

**Status**: Proposed — for rigorous multi-angle review
**Date**: 2026-06-04
**Basis**: deterministic probes of `buildContextPacket` + `matchCapabilities`, capability-graph/bundle census, and import-map analysis.

Two independent problems surfaced after P0–P2 (sensible-simulation) shipped. The census below reframed both away from the initial guess.

---

## Census (measured, not assumed)
- **capability-graph.json: 42 capabilities** — 39 `supported`, 3 `unsupported` (safety: autonomous-wireless-robotics, home-security-actuator, high-voltage-load-control).
- **v2 bundles: 39**, **v2 routes: 43**.
- The capabilities that "failed to build" in earlier measurement **already exist with Korean phrases**:
  - `light-sensor-triggered-output` — studentPhrases include `"조도 센서"`, `"어두우면 LED"`; requiredParts `photoresistor-ldr,led-5mm,resistor-220`.
  - `distance-sensor-display` — studentPhrases include `"초음파 센서"`, `"거리를 표시"`; requiredParts `ultrasonic-hc-sr04,oled-i2c-096`.

**Conclusion: the dominant gap is NOT missing context — it is capability MATCHING. Very few new contexts are needed.**

### Proof (deterministic `buildContextPacket` probe)
| Query | Route | Matched |
|---|---|---|
| `조도센서로 LED 켜기` (no space) | `v2-digital-light-output` | sensor **MISSED** |
| `조도 센서로 LED 켜기` (spaced) | `v2-light-sensor-triggered-output` | ✓ |
| `초음파센서로 거리 측정하기` (no space) | `v2-ambiguous-minimal` | **none** |
| `초음파 센서로 거리를 표시` (spaced) | `v2-distance-sensor-display` | ✓ |

### Root cause (code-level, `server/context/capabilityGraph.ts`)
`tokenize()` (`:176`) splits on `[\p{L}\p{N}]+` runs, so `"조도센서로"` is ONE token; `koreanTokenVariants()` (`:194`) only strips trailing josa (→ `"조도센서"`), never splits the compound noun. `evidenceMatches()` (`:143`) matches a multi-word phrase `"조도 센서"` only if the **spaced** string is a substring OR each term (`조도`, `센서`) is a separate query token — both fail when the user writes the compound without a space. `splitCompoundToken()` (`:162`) splits only on `[+/#.-]`, not Korean morpheme boundaries.

---

# PART A — Capability-match coverage

Three sub-problems, in leverage order:

### A1 — Space-insensitive Hangul phrase matching (HIGHEST leverage; code)
**Goal**: a Korean compound noun written without a space (`조도센서`, `초음파센서`, `온도센서`, `가변저항`, …) matches the same capability as the spaced form — recovering many sensor/combination capabilities at once, with no false positives.

- **RED**: `tests/unit/capabilityMatchKorean.test.ts` — table of unspaced Korean queries → expected capability id (`조도센서로 LED 켜기`→light-sensor-triggered-output; `초음파센서로 거리 측정`→distance-sensor-display; plus 4–6 more from the part set). Also **negative** cases that must NOT newly match (guard against over-matching). Fails today.
- **GREEN** (candidate approach, to be vetted by review): in `evidenceMatches`, for phrases containing Hangul, additionally compare with **all whitespace removed on both sides** (`normalizedQuery.replace(/\s+/g,'')` includes `normalizedPhrase.replace(/\s+/g,'')`). Keep the existing English token logic unchanged. Cap the effect so single generic Hangul tokens don't broaden (respect `requiredFallbackPhrases` + `negativeEvidence` + `minimumScore`).
- **Risk to scrutinize in review**: despacing can glue unrelated substrings → false positives; Korean has no clear morpheme boundaries without a tokenizer; interaction with `minimumScore` and the `0.25/0.4/0.25` scoring weights; effect on the 39 already-passing capabilities (must not regress).
- **Quality gate**: new Korean table green; **the existing `agent-context/evals/context-sufficiency-prompts.jsonl` (101 prompts) stays green** (no regression); a broad before/after match-rate number recorded.

### A2 — Phrase / synonym coverage audit (data)
**Goal**: add genuinely missing Korean phrasings the matcher can't infer even with A1 (e.g. `"거리 측정"` — today only `"거리를 표시"`/`measure distance` exist; `"밝기 조절"`, etc.).
- **RED**: extend the Korean eval table with natural phrasings that still miss after A1.
- **GREEN**: add `studentPhrases`/`positivePhrases` to the relevant capability `*.sources` files; `npm run context:capabilities:build`; `npm run context:check`.
- Bounded: only the **measured high-frequency** misses, not exhaustive.

### A3 — Genuine combination gaps (data; few)
**Goal**: author the truly-missing capability+bundle. Confirmed missing: **`button-controlled-sound-output`** (버튼→부저) — buzzer is supported (`sound-alert-output`) and button is supported (`button-controlled-light-output`), but the *combination* has no validated bundle, so coverage is `insufficient` when a button is requested with a buzzer.
- **RED**: eval prompt `버튼 누르면 부저 울리기` → expected route `v2-button-controlled-sound-output`, coverage `sufficient`, builds a runnable circuit.
- **GREEN**: author capability entry + `v2/bundles/button-controlled-sound-output/{manifest.json,BUNDLE.md}` + route, using `button-controlled-light-output` as the template (swap LED-path for buzzer-drive + common-ground; reuse the validated direct-low-current-load wiring). Verify a live build is runnable.
- A3 decision (separate): the 3 `unsupported` safety capabilities stay refusals; ultrasonic already exists (A1 fixes it) — no new authoring needed there.

### A — measurement
A broad Korean beginner-prompt eval (≥30 prompts spanning the part families) measuring **match-rate + build-eligible-rate before/after**. Stop when the miss-rate is low; do not chase every combination across 132 parts.

---

# PART B — Pipeline de-duplication

### Diagnosis (import-mapped)
- `server/agent/circuitTools.ts` (**9175 lines**) is the **active monolith**; `deepAgentRuntime.ts` imports the circuit pipeline from it (`:37`). The P2 live fix landed here.
- `server/agent/circuit/*` (renderPlan 1354, validation 5385, breadboardAudit, netlist, simulationPlan, requirementDoc, requirementBrief, shared) is a **started-but-incomplete extraction**. `circuit/index.ts` states the intent: *"Re-exports EXACTLY the pre-split public surface; call sites import these via ../circuitTools.ts."* — but `circuitTools.ts` was never switched to re-export from `circuit/`; the code was **copied**, leaving **two divergent implementations** (why the label bug needed fixing in both files).
- Active consumers use `circuitTools.ts`; `circuit/requirementBrief.ts` is imported directly; the remaining `circuit/*` are effectively **dead duplicates**.

### The fork (DECISION NEEDED)
- **Direction A — finish the split** (matches `feat/layered-context-architecture` intent): make `circuitTools.ts` a thin shim re-exporting `circuit/index.ts`; real impls live in `circuit/`; delete the ~9000 duplicate lines. Pros: single source of truth, modular. Cons: large, risky on a 9k-line file; requires proving `circuit/` copies are behavior-identical.
- **Direction B — drop the dead duplicate**: delete unused `circuit/*` copies, keep the monolith. Pros: minimal, low-risk, removes divergence now. Cons: keeps the 9k-line monolith; abandons layering.

**Recommendation: Direction A, executed as a test-gated strangler** — the branch's purpose is layered architecture, and the monolith is the root maintenance problem.

### Approach for Direction A — strangler, module by module
Dependency order: `shared → netlist → validation → breadboardAudit → renderPlan → simulationPlan → requirementDoc`.
For each module:
1. **Diff** `circuit/<m>.ts` against the `circuitTools.ts` implementation; reconcile divergences first (e.g. confirm the P2 label fix is identical in both).
2. Replace the `circuitTools.ts` impl with `export … from './circuit/<m>.ts'`.
3. Run **full TS suite (501) + typecheck + a live build probe** after EACH module. Green → next; red → revert that module's commit.
4. When all modules re-exported, `circuitTools.ts` is a thin shim. (Optionally migrate call sites to `circuit/index.ts` later.)

### Risk / rollback
- Each module swap = one independent commit; revert that commit on any behavior diff.
- 501-test suite + live probe per module is the safety net.
- Hard stop if a `circuit/` copy proves to produce different output — reconcile before swapping.

---

## Prioritization recommendation
1. **A1** (Korean matching) — highest leverage, recovers many capabilities with one code change. Do first.
2. **A2 + A3** — small, bounded, data.
3. **Part B** — after A; Direction A incrementally, test-gated. Maintenance investment, not user-facing.

## Open decisions for reviewers / user
1. **A1 fix approach**: space-insensitive Hangul matching vs a curated compound-split dictionary vs a real Korean tokenizer — false-positive trade-offs.
2. **Part B direction**: A (finish split) vs B (delete duplicate). (Recommend A, incremental.)
3. **A scope ceiling**: where to stop authoring combinations (measurement-driven).

---

# REVISION (post 4-angle rigorous review) — 2026-06-04

Four reviewers (Korean-NLP, context-architecture, refactor-safety, holistic critic) converged and **overturned two central assumptions.** The draft above is kept for history; **this revision supersedes the A1 mechanism and the Part B direction.**

## R1 — A1 "despace" does NOT fix the headline case (the decisive finding)
Simulated `scoreCapability` for `조도센서로 LED 켜기` *after* despacing: `digital-light-output` still **WINS** because it has the English required-evidence `led` + studentPhrase `LED 켜기`; `light-sensor-triggered-output` has **English-only requiredEvidence** (`photoresistor/ldr/light sensor`) that Korean never hits, so it scores lower (or relies on the fallback path) and **loses the ranking**. Result: the student still gets a **sensorless LED circuit — silently wrong, no error.** The draft's evidence was at *matched-set / top-1-route for the SPACED form*; it never checked the **ranked scores for the UNSPACED form post-fix.** → A1 makes the matched SET more complete without making the WINNER correct. **The diagnosis ("spaced works, unspaced doesn't") was a symptom, not the root.**

## R2 — The real root: contention is resolved by English required-evidence weight
The keyword matcher breaks ties via required-evidence hits, and the sensor capabilities' requiredEvidence is English-only. So the fix is **data-level disambiguation**, not a matching algorithm:
- add **unspaced Korean strings as `requiredEvidence`/`studentPhrases`** on the under-matched capability (so it actually scores AND wins) — this exploits the EXISTING single-token Hangul substring path (`capabilityGraph.ts:150-153`), zero new algorithm;
- add **Korean `negativeEvidence`** (`조도`,`빛`,`센서`) to the competing base capability (`digital-light-output`) to break the contention.
This is **per-capability scoped (zero blast radius on the other 41)**, trivially testable, and 10x lower-risk than touching `evidenceMatches` on the hot path of every request.

## R3 — A1's real recovery set is SMALL; leverage ordering was inverted
Post-fix simulation: only `초음파센서`→`distance-sensor-display` cleanly wins (no competitor). `온도센서` matches nothing (only `온습도 센서` exists → needs A2 data). `버튼+부저` needs A3. → **Lead with DATA (A2 + the R2 requiredEvidence/negativeEvidence edits + A3); demote the despace algorithm to OPTIONAL**, used only if a measured residual class of misses can't be reached by data — and then only guarded (length floor ≥4 syllables, per-token despace not whole-query, symmetric negativeEvidence despacing, despaced hits weighted as 0.25 not 0.4).

## R4 — The 101-prompt eval is a BLIND regression net
97 English / 4 Korean / **0 unspaced compounds**. "Stays green" proves nothing about A-class changes. **Prerequisite (A0):** build a **20–30 prompt unspaced/typo/mixed Korean eval** with `expectedCapabilityIds` + `forbiddenCapabilityIds` (schema already supports it) + a **full ranked-route assertion** (winning route, not just matched set). This is the decisive experiment and must come FIRST.

## R5 — A3 template is WRONG (electrically)
`button-controlled-light-output` uses the LED path (`series-current-limit`, topology `controller-digital-input-switch-plus-output`). A buzzer needs `controller-direct-low-current-load` + `polarity-check`/`current-limit-warning`/`common-ground` (proven by `sound-alert-output`). **No button+buzzer-only topology exists** → A3 must author a new topology (`controller-digital-input-switch-plus-direct-load`) or accept the multi-output template; derive the manifest from `sound-alert-output`'s rules, NOT the LED template. (Unbudgeted in the draft.)

## R6 — Part B: switch recommendation to **Direction B (delete dead copies)**
- `circuitTools.ts` is **100% active**; `circuit/*` (except `requirementBrief.ts`, which IS live) is **dead duplicate**.
- Direction A as drafted (thin re-export shim) does **NOT** achieve layered architecture — call sites still import from `circuitTools.ts`; it only adds indirection. True Direction A = migrate ALL call sites to `circuit/index.ts` + delete `circuitTools.ts` (much larger, higher blast radius).
- `circuit/validation.ts` has a **private island** of ~6 constants (`DIRECT_LOW_CURRENT_LOAD_PART_IDS`, `SERVO_ACTUATOR_PART_IDS`, …) absent from `shared.ts` → the draft strangler order (shared = complete foundation) is wrong.
- Copies are **prettier-reformatted** → raw diff is formatting noise; equivalence must be normalized/AST diff + the test suite as oracle (and test count is **545**, not 501).
- **→ Recommended: Direction B** — delete the dead `circuit/*` duplicates (keep `requirementBrief.ts`), one PR, zero behavior change, eliminates divergence risk now. Defer true layering to a separate, explicit, full migration if ever desired.

## R7 — Revised sequencing + kill criteria
1. **A0 (prereq):** unspaced/typo/mixed Korean eval + ranked-score probe. KILL gate for everything else.
2. **A2 + R2 data edits** (requiredEvidence/studentPhrases/negativeEvidence) — the actual fix; per-capability, low-risk.
3. **A3** — button→buzzer bundle with correct buzzer topology.
4. **Part B = Direction B** — delete dead duplicates (independent, revertible).
5. **Despace algorithm** — only if A0 measurement shows a residual class data can't reach; guarded.
- **Metric**: *winning-route correctness* (+ forbidden-route guard), NOT match-rate. Kill a change if it flips any previously-correct route to wrong.

## Revised open decisions
1. **Adopt the data-first A approach (R2/R3) over the despace algorithm?** (Reviewers strongly converge: yes.)
2. **Part B → Direction B (delete dead copies) instead of A?** (Reviewers converge: yes.)

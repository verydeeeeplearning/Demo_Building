# Improvement Plan: Circuit Validity (trace-based, deterministic-pipeline fixes)

**Status**: Implemented (offline) — Phases 1, 2, 2.5, 3 done & green; Phase 4 live re-validation pending a fresh user key.
**Started**: 2026-06-03
**Basis**: Live validation of the `next` pipeline (gpt-5.4-mini, reasoning=low) + **trace-based** root-cause analysis of every not-valid case. This plan is grounded in agent-trace evidence, not hypotheses.

> Work from THIS document. Each fix is justified by a captured trace (`.local/trace-results.json`) and a code/data reference.

## 1. Context — what live validation found

The agent-pipeline refactor's **reliability** target is met live: completion (never-502) **37/37 = 100%**, structured-output first-shot **97.3%**, candidate correctness **37/37 = 100%**. But the **circuit validity** rate is low: **~56% (20/36)** of synthesized circuits pass deterministic validation.

Critically, **this is NOT a model-reasoning ceiling.** Re-running the failing cases at `reasoning=high` did **not** fix them (motor/driver cases stayed `invalid`). Trace inspection shows the agent often builds the **correct circuit**, which is then **wrongly rejected by the deterministic validation/selection layer**. The failures are bugs in *our* code/data, fixable without changing the model.

## 2. Evidence (captured traces)

| Case | Candidates | What the agent built | Verdict | Why (authoritative error) |
|---|---|---|---|---|
| `spi-display-output` ("SPI TFT에 글자 표시") | arduino, breadboard, **tft-18**, jumper | arduino + tft-18 wired SPI (VCC/GND/SCK D13/SDA D11/CS D10/RS D9) — **correct** | invalid | `INTENT_OUTPUT_NOT_FULFILLED: requested display, …no matching output part` — *but the TFT display IS in the circuit* |
| `low-side-switched-load-output` ("DC 모터") | arduino, breadboard, irf520-mosfet, **dc-motor-130**, jumper | low-side MOSFET motor drive incl. dc-motor-130 — **correct topology** | invalid | `INTENT_OUTPUT_NOT_FULFILLED: requested motion, …no matching output part` — *but the motor IS in the circuit* |
| `digital-input-display-readout` ("OLED에 센서 상태 표시") | arduino, breadboard, oled, jumper — **no input device** | arduino + oled + **limit-switch** (added by agent) | invalid | `CONTEXT_CANDIDATE_PART_NOT_ALLOWED: limit-switch was not selected` + `DIGITAL_INPUT_SIGNAL_MISSING` — *no input part was offered, so the agent had to invent one* |

## 3. Root causes (confirmed in code + data)

### RC-A — Intent-output-modality **taxonomy mismatch** (HIGH impact)
**Where:** `server/agent/circuitTools.ts` — `applyIntentFulfillmentGate` (:504), `requiresConcreteOutputFulfillment` (:566-ish), `partFulfillsOutputModality` (:629).

**The bug:** capabilities/intents declare BOTH a **generic** output modality and a **specific** one (e.g. `spi-display-output.outputModalities = ["display", "spi-display", "graphic-display"]`; a DC-motor request yields intent `motion`). `requiresConcreteOutputFulfillment` requires **all** of them, but `partFulfillsOutputModality` maps each part only to its **specific** modality:
- `tft-18.capabilities = [spi-display, graphic-display, color-display, …]` → fulfills `spi-display` ✓ but `display` ✗ (the `display` case only accepts `display-text`/`display-output`).
- `dc-motor-130.capabilities = [motor-output, low-side-switched-load, …]` → fulfills `switched-load` ✓ but `motion` ✗ (the `motion` case only accepts `servo`).

So a **correct circuit with the right output part is marked `INTENT_OUTPUT_NOT_FULFILLED`** because the generic modality has no part mapped to it. (Same risk exists for `partFulfillsInputModality`.)

**Fix:** make the generic modality satisfiable by ANY of its specific variants. `display` ← {display-text, display-output, spi-display, graphic-display, oled, …}; `motion` ← {servo, motor-output, switched-load, stepper-motion, …}. Drive this from part capabilities, not hardcoded id substrings, and keep one modality taxonomy shared by capabilities + the fulfillment map (no two vocabularies).

### RC-B — Composition **candidate gap** for "one-of-N" input/sensor parts (HIGH impact)
**Where:** `server/context/compositionSelection.ts` (`selectContextByComposition`) + `agent-context/data/capability-graph.json`.

**The bug:** for capabilities whose **input** (or a needed output) is a *choice among many* alternatives, the data lists those parts in `optionalParts`, and `requiredParts` holds only the controller/surface/display. Example: `digital-input-display-readout.requiredParts = [arduino-uno, breadboard-half, oled-i2c-096]`, with all input devices (`limit-switch, reed-switch, toggle-switch, ttp223-touch, …`) in `optionalParts`. Composition takes `requiredParts` + wiring/named-optional only → **no input device is selected** → the agent invents one → `CONTEXT_CANDIDATE_PART_NOT_ALLOWED`.

**Fix:** composition must guarantee each of the capability's **required modalities** (input + output) is covered. When `requiredParts` does not cover a required input/output modality, select a **deterministic default representative** optional part that fulfills it (e.g. first by a stable order) and add it to candidates. Reuses the RC-A modality taxonomy to test coverage.

### RC-C — Runtime exception on a complex case (CHARACTERIZED; live-repro-required)
`hbridge-motor-output` threw a deepagents/langgraph exception in the **first** 18-trace — but that run had **no per-case `try/catch`**, so a single mid-run exception killed the whole run before `writeFile`. After hardening `scripts/liveTrace.mts` with per-case `try/catch`, the re-run captured the hbridge trace cleanly and it was an ordinary **RC-A** case (`INTENT_OUTPUT_NOT_FULFILLED: motion`), now fixed by Phase 1. So RC-C was a **harness fragility**, not a distinct pipeline defect: the run-killing crash is gone (the harness now records the per-case error and continues), and the case itself validates after RC-A. Any *genuine* residual model/langgraph exception is low-frequency and only reproducible **live** (it needs the real model); there is no deterministic offline repro, so no speculative code change is made here. Status: closed as harness-fixed + RC-A-fixed; re-watch live in Phase 4.

### RC-D — Render DRC false-block (`CAMERA_CLIPPING`) (FIXED, offline)
Several valid cases carried `SIMULATION_BLOCKED_BY_RENDER_DRC: CAMERA_CLIPPING (fitted camera distance too short for scene radius)`. Root cause (deterministic, `server/agent/circuitTools.ts` `compileCameraFit`): the fitted camera `distance` was clamped to a **max of 40**, but `auditRenderCameraFit` requires `distance ≥ (radius / sin(fov/2)) · 1.03 ≈ 3.16 · radius`. For a scene `radius > ~12.6` the required distance exceeds 40, so the clamp **guaranteed** a false clip on a valid large scene. Fix: the clamp ceiling now grows with the desired distance (`Math.max(40, desiredDistance)`) — a **no-op for every small scene** (`desiredDistance < 40`), only lifting the cap when the scene genuinely needs it. Locked by `tests/unit/cameraFit.test.ts`.

## 4. Per-case categorization (the 18 originally-not-valid cases)

From the robust 18-trace (`.local/trace-results.json`). **13/18 are deterministic pipeline bugs (RC-A 6 + RC-B 7)** — fixing RC-A and RC-B resolves them. The other 5 are genuine-unsupported (2) or model nondeterminism (3, flipped to valid on re-run).

| # | Case | RC | Evidence |
|---|---|---|---|
| 1 | `low-side-switched-load-output` | **A** | built dc-motor-130 correctly → `INTENT_OUTPUT_NOT_FULFILLED: motion` |
| 2 | `stepper-motor-output` | **A** | built stepper+driver → `INTENT_OUTPUT_NOT_FULFILLED: motion` |
| 3 | `hbridge-motor-output` | **A** | `INTENT_OUTPUT_NOT_FULFILLED` (motor not mapped to `motion`) |
| 4 | `relay-low-voltage-output` | **A** | `INTENT_OUTPUT_NOT_FULFILLED` (relay/load modality) |
| 5 | `bare-seven-segment-display-output` | **A** | `INTENT_OUTPUT_NOT_FULFILLED: display` (7-seg not mapped to `display`) |
| 6 | `spi-display-output` | **A** | built tft-18 wired SPI correctly → `INTENT_OUTPUT_NOT_FULFILLED: display` |
| 7 | `analog-sensor-display-readout` | **B** | input sensor in optionalParts → agent added non-candidate |
| 8 | `analog-sensor-threshold-output` | **B** | `CONTEXT_CANDIDATE_PART_NOT_ALLOWED` (no analog sensor offered) |
| 9 | `digital-input-display-readout` | **B** | no input device in candidates → agent added limit-switch (rejected) |
| 10 | `digital-input-threshold-output` | **B** | `CONTEXT_CANDIDATE_PART_NOT_ALLOWED` (no input device) |
| 11 | `matrix-input-display-readout` | **B** | `INTENT_INPUT_NOT_FULFILLED` (no matrix input offered) |
| 12 | `joystick-display-readout` | **B** | `INTENT_INPUT_NOT_FULFILLED` (no joystick offered) |
| 13 | `rotary-encoder-display-readout` | **B** | `INTENT_INPUT_NOT_FULFILLED` (no encoder offered) |
| 14 | `led-array-display-output` | **E** | `Unsupported request item: 정확한 숫자 코드표 / 밝기·전류 정량계산` — correct unsupported-handling of an overclaim request |
| 15 | `addressable-led-display-output` | **E** | `Unsupported request item: clarification-required` — ambiguous request, correctly clarified |
| 16 | `clocked-data-sensor-display-readout` | **var** | flipped to **valid** on re-run (HX711+OLED built correctly) — model nondeterminism |
| 17 | `spi-communication-module-readout` | **var** | flipped to **valid** on re-run (USB-host+OLED) — model nondeterminism |
| 18 | `servo-motion-output` | **var/D** | **valid**; carries a `CAMERA_CLIPPING` render-DRC flag (RC-D) |

**Aggregate:** RC-A ×6, RC-B ×7, RC-E ×2 (genuine), model-variance ×3. → **13 deterministically fixable.**

### Expected impact
Baseline live valid ≈ **56% (20/36)**. Fixing RC-A + RC-B should resolve ~13 cases → projected valid ≈ **(20 + 13) / 36 ≈ 85–90%** (minus residual model variance). RC-E (2) is correct behavior; the 3 variance cases already pass intermittently.

## 5. Fix plan (phased, TDD — RED → GREEN → REFACTOR)

All fixes are in the **deterministic** layer (validation taxonomy, composition selection, render fit). Default tests are offline; live re-validation per phase confirms the valid-rate lift. Flag-gating: RC-A/D affect both paths (they are correctness fixes); RC-B is in the composition path (`next`). Legacy behavior on the enumerated path is preserved.

### Phase 1 — RC-A: unify the output/input modality taxonomy
- **RED**: unit tests asserting `partFulfillsOutputModality(tft-18, 'display')`, `(dc-motor-130, 'motion')`, `(7seg, 'display')`, etc. return `true`; and `applyIntentFulfillmentGate` does NOT mark a correct tft-18/dc-motor circuit invalid. Tests built from the captured trace specs.
- **GREEN**: replace the hardcoded per-modality substring map with a single capability-driven modality taxonomy (generic ⊇ specific); reuse it in both `partFulfillsOutputModality` and `partFulfillsInputModality`.
- **REFACTOR**: one source of truth for modality→capability mapping; remove id-substring heuristics where a capability exists.
- **Gate**: TDD; existing validation/golden tests green; no circuit that legacy considered valid becomes invalid.

### Phase 2 — RC-B: composition guarantees required-modality coverage
- **RED**: `selectContextByComposition` test — `digital-input-display-readout` candidates MUST include exactly one input device fulfilling `digital-input`; output-only capabilities unaffected; growth/O(request) preserved; corpus still 37/37.
- **GREEN**: after assembling candidates, for each required input/output modality not covered, add the deterministic default optional part that fulfills it (stable order).
- **REFACTOR**: shared modality-coverage helper with Phase 1.
- **Gate**: TDD; corpus parity; catalog-growth still flat.

### Phase 2.5 — corpus hardening (so the gate catches this class)
- The corpus mustInclude was derived from `requiredParts`, so input-gap cases passed candidate-check while failing the real build. Add `mustInclude` of an input-modality part for input-readout cases, and add a **buildability** assertion class (the captured invalid cases as fixtures) so RC-A/B regressions are caught offline.

### Phase 3 — RC-C runtime exception + RC-D render DRC ✅ DONE (offline)
- **RC-D GREEN**: camera-fit clamp ceiling now grows with the desired distance (`compileCameraFit`), so a valid large scene is never falsely `CAMERA_CLIPPING`-blocked; no-op for small scenes. `tests/unit/cameraFit.test.ts` (RED proved the clip at radius ~16, GREEN clears it). `compileCameraFit`/`auditRenderCameraFit` exported for the unit test.
- **RC-C**: closed as harness-fragility + RC-A (see §3 RC-C). No deterministic offline repro; re-watch live in Phase 4. No speculative change.
- **Gate**: TDD; full `test:unit` 421 pass / 1 skip, typecheck + build green — no render regression from the global camera change (small scenes unchanged).

### Phase 4 — Live re-validation (harness ready; needs a fresh user key)
- The offline gate (`tests/unit/intentFulfillmentRegression.test.ts`) already proves all **13** deterministic cases validate via the REAL `buildContextPacket(next)` + REAL intent-fulfillment gate — no model required. This is the strongest offline evidence the RC-A/RC-B fixes land exactly the trace-captured cases.
- Live confirmation of the **end-to-end valid rate** (agent + model) still needs a run of `scripts/liveValidate.mts` under `next`. It is **not run here**: the previously-pasted OpenAI keys must be revoked, and default tests must never call live OpenAI. To measure the new rate, supply a fresh key in gitignored `.local/agent.env` and run `npx tsx scripts/liveValidate.mts` (and `scripts/liveTrace.mts <ids>` for any residual). Expected: RC-A/B cases flip to `valid`/`runnable`; RC-E (2) stays correctly unsupported; the 3 variance cases pass intermittently.

## 6. Success criteria
- [x] RC-A: a correct tft-18 / dc-motor / 7-seg / stepper / h-bridge / relay circuit validates `valid` (no false `INTENT_OUTPUT_NOT_FULFILLED`). — `modalityFulfillment.test.ts` + `intentFulfillmentRegression.test.ts`.
- [x] RC-B: every input-readout capability offers ≥1 input device in candidates; the agent never needs a non-candidate part. — `compositionModalityCoverage.test.ts` + `intentFulfillmentRegression.test.ts`.
- [x] Corpus still 37/37 candidate-correct; growth still O(request). — `liveCompositionIntegration.test.ts`, `compositionSelection.test.ts`, `contextEfficiencyCharacterization.test.ts`.
- [x] RC-D: a valid large scene is not falsely `CAMERA_CLIPPING`-blocked. — `cameraFit.test.ts`.
- [ ] Live valid rate up from **56% → ≥85%** — projected from the 13-case offline proof; final number pending a live `scripts/liveValidate.mts` run with a fresh user key (Phase 4). RC-E's 2 stay correctly unsupported.
- [x] `npm run test:unit` (421 pass / 1 skip), `typecheck`, `build` green; legacy path unchanged (RC-B gated to `next`; RC-A/RC-D are global correctness fixes locked by golden/regression tests).

## 7. Risk & rollback
| Risk | Mitigation |
|---|---|
| Loosening intent-fulfillment hides real "wrong output" cases | Keep the gate; only widen the generic↔specific mapping, verified by tests that a genuinely-missing output still fails |
| RC-B default-part selection picks a poor representative | Deterministic stable order; document; the agent may still swap among allowed optionals |
| Taxonomy change affects legacy validation | Validation fixes are global correctness improvements; lock with golden tests; revert via git if a golden regresses |

## 8. Notes
- Diagnosis is trace-based: `.local/trace-results.json` holds the captured circuits + authoritative errors per case. Re-capture with `npx tsx scripts/liveTrace.mts <case-ids>` (source `.local/agent.env`).
- These are deterministic-layer fixes; they raise validity independent of model/reasoning. Model/reasoning is a separate lever (high reasoning alone did not fix these).

## 9. Implementation summary (what shipped)
- **Classification correction:** `joystick-display-readout` and `rotary-encoder-display-readout` were filed under RC-B but are actually **RC-A-input** — their input device is already in `requiredParts`; the bug was the `digital-input` taxonomy missing `digital-button-input` / `quadrature-input-source`. Phase 1 fixes them. Net deterministic count is unchanged: **RC-A = 8 (6 output + 2 input), RC-B = 5 (true composition gaps) = 13**.
- **New module** `server/agent/modalityFulfillment.ts` — the single modality-fulfillment taxonomy (generic ⊇ specific), shared by the validation gate (`circuitTools.ts`) and composition selection (`compositionSelection.ts`). `circuitTools.ts` deleted its 4 local copies (no duplicate vocabulary).
- **Composition coverage** (`compositionSelection.ts`): per driving capability, greedily add the optional part covering the most still-uncovered required input/output modalities (stable order, request-scoped). One device can satisfy a conjunctive family.
- **RC-D** (`circuitTools.ts` `compileCameraFit`): clamp ceiling grows with the desired distance; no-op for small scenes.
- **Tests (offline, no live OpenAI):** `modalityFulfillment.test.ts`, `compositionModalityCoverage.test.ts`, `intentFulfillmentRegression.test.ts` (13 trace cases via real packet+gate), `cameraFit.test.ts`. Suite: 421 pass / 1 skip; typecheck + build green.
- **Commits:** `3547a26` (RC-A + RC-B + Phase 2.5), plus the RC-D + docs commit.
- **Live re-validation is the only open item** (Phase 4) and is intentionally not run here — it requires a fresh user-supplied key (all previously-exposed keys must be revoked); default tests never call live OpenAI.

## 10. Live re-validation results (gpt-5.4-mini, reasoning=low, `next`) — 2026-06-03

Ran the full 37-case corpus live. **Valid rate 56% → 83.3% (30/36)**; completion 37/37, candidates 37/37, first-shot 97.3%. The 13 RC-A/RC-B targets all behaved as designed except two, which surfaced a **new deterministic root cause (RC-F)**.

| Metric | Baseline | Now |
|---|---|---|
| valid (of synth) | 20/36 ≈ 56% | **30/36 ≈ 83.3%** |
| invalid | ~10 | **2** (both RC-F) |
| unsupported | — | 5 |
| completion / candidates / first-shot | 37/37 / 37/37 / 97% | 37/37 / 37/37 / 97.3% |

### 7-case disposition (every remaining not-valid case, trace-backed)

| # | Case | Live status | Root cause (authoritative trace) | Disposition |
|---|---|---|---|---|
| 1 | `joystick-display-readout` | **invalid** | **RC-F**: built a CORRECT joystick+OLED circuit; gate demanded `analog-sensor`+`digital-sensor` (unioned from sibling caps). | **FIX (RC-F)** → valid |
| 2 | `digital-input-display-readout` | **invalid** | **RC-F**: built a CORRECT ttp223 digital circuit; gate demanded `analog-sensor`+`analog`. | **FIX (RC-F)** → valid |
| 3 | `addressable-led-display-output` | unsupported (19ms, no model) | **RC-E**: deterministic clarification-required (ambiguous WS2812 count). | **Correct — document, no change** |
| 4 | `bare-seven-segment-display-output` | unsupported | Built a valid 7-seg circuit but flagged "exact 0–9 segment-code table" as an unsupported request item (overclaim refusal, like led-array #14). | **Borderline-correct — document; optional prompt-tune to accept "show a number"** |
| 5 | `clocked-data-sensor-display-readout` | unsupported | Protocol-readout; plan §4 #16 flipped valid on an earlier run → **model variance** suspected. | **Confirm via 2–3 live re-runs** |
| 6 | `uart-communication-module-readout` | unsupported | Communication-module readout; suspected genuine-unsupported or variance. | **Confirm via re-runs** |
| 7 | `spi-communication-module-readout` | unsupported | plan §4 #17 flipped valid earlier → **model variance** suspected. | **Confirm via re-runs** |

**Net:** RC-F (2) is the only remaining *deterministic* defect. Fixing it → **32/36 ≈ 88.9% ≥ 85% target**. Cases 3–4 are correct/borderline behavior (not bugs). Cases 5–7 are protocol-readout variance to confirm (no code change unless a re-run shows a consistent deterministic block).

### RC-F — intent-modality **over-union** (HIGH impact, deterministic)
**Where:** intent derivation `server/context/contextPacket.ts` `inferIntentHints` (~:2074-2086) sets `intentSpec.{input,output}Modalities` to the **union of EVERY matched capability**; the gate `applyIntentFulfillmentGate` (`server/agent/circuitTools.ts`) then treats that flat union **conjunctively** (each modality must be fulfilled).

**The bug (offline-confirmed, no model):** a focused request matches sibling readout capabilities. "조이스틱 위치를 OLED에 표시" matches `analog-sensor-display-readout` (ranked PRIMARY — itself a mis-ranking), `digital-input-display-readout`, `joystick-display-readout`, `display-text-output`; `intentSpec.input = {analog-sensor, analog, digital-input, digital-sensor, joystick}`. No single valid circuit fulfills all five input families, so the agent's correct joystick circuit is rejected for missing `analog-sensor`/`digital-sensor` it never needed. Same for "OLED에 센서 상태 표시" (ttp223 digital circuit rejected for missing `analog-sensor`/`analog`).

**Fix (recommended — option B, input disjunction):** keep OUTPUT modalities conjunctive (the deliverable must be present), but treat concrete **INPUT modalities as a disjunction** — when any concrete input is requested, require **≥1** of the unioned input families to be fulfilled (not all). Surgical, in the gate only, reuses `modalityFulfillment.ts`.
- Why B over C: a joystick circuit fulfils ≥1 input → PASS; a ttp223 circuit → PASS; **a dropped-input circuit (OLED only) fulfils 0 inputs → still FAIL** (caught); motor→LED fails on the conjunctive output union. Disjunction is strictly *weaker* than the current conjunction, so it can only turn false-FAILs into PASSes — it **cannot** regress any of the 30 currently-valid cases.
- Why NOT C (per-capability satisfaction): `display-text-output` co-matches with EMPTY input modalities, so an OLED-only circuit would *trivially satisfy* it and the gate would stop catching dropped inputs — a real strictness hole. B avoids it.
- **Accepted trade-off:** B is laxer for a genuinely multi-input request (student wants sensor AND button, agent wires only one). No such capability exists in the corpus; if one is added later, layer keyword-evidenced strictness on top.
- **Secondary (R­C-F.2):** scope RC-B composition coverage to the PRIMARY capability only (not all top-k), so sibling caps don't inject spurious candidates (e.g. `soil-moisture`/`ttp223` into the joystick set). Low priority — currently harmless (agent ignores them) but cleaner.
- **Optional (R­C-F.3):** investigate the primary mis-ranking (`analog-sensor-display-readout` ranked above `joystick-display-readout` for a joystick message) in `matchCapabilities`. Not required if the gate fix (option C) lands, since the gate no longer depends on which sibling is "primary".

### Phase 5 — RC-F fix plan (TDD, offline-first)
- **RED**: offline gate test — a joystick circuit (joystick-module+oled) and a ttp223 circuit (ttp223+oled) built for their messages PASS `applyIntentFulfillmentGate` under the real packet; a genuinely-degraded circuit (requested motion, built LED-only) still FAILS. Extend `intentFulfillmentRegression.test.ts` to drive the agent-realized circuit (not the use-all-candidates upper bound) so it would have caught RC-F.
- **GREEN**: implement option C — pass matched-capability modality groups to the gate; accept if any group is fully satisfied.
- **REFACTOR**: keep one taxonomy (reuse `modalityFulfillment.ts`); no duplicate vocab.
- **Gate**: corpus 37/37 parity; `test:unit`+typecheck+build green; legacy path unchanged.
- **Phase 6 — live re-validation**: re-run the corpus; expect `joystick-display` + `digital-input-display` → valid (≈88.9%); 2–3 re-runs of cases 5–7 to classify variance vs genuine; document cases 3–4 as correct.

### Open security item
The OpenAI key used for this live run was supplied via gitignored `.local/agent.env` and **must be revoked** by the user (it was also pasted in chat). No key is committed.

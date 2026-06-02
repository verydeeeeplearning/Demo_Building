# Improvement Plan: Circuit Validity (trace-based, deterministic-pipeline fixes)

**Status**: Proposed
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

### RC-C — Runtime exception on a complex case (TBD)
`hbridge-motor-output` threw a deepagents/langgraph exception mid-run (the first 18-trace crashed there). To be characterized by the robust 18-trace re-run; likely a tool/recursion edge. (Lower frequency.)

### RC-D — Render DRC false-block (`CAMERA_CLIPPING`) (secondary)
Several cases carry `SIMULATION_BLOCKED_BY_RENDER_DRC: CAMERA_CLIPPING (fitted camera distance too short for scene radius)`. This is a **render/camera-fit** issue blocking simulation, independent of electrical correctness. Fix: fit camera distance to scene radius (render plan), so a valid circuit isn't blocked by a viewport heuristic.

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

### Phase 3 — RC-C runtime exception + RC-D render DRC
- **RED**: reproduce the hbridge exception deterministically (fake model/cassette) if it is pipeline-side; render-fit test asserting camera distance ≥ scene radius for a multi-part scene.
- **GREEN**: guard/fix the exception; fit camera to scene radius in the render plan.
- **Gate**: TDD; no `CAMERA_CLIPPING` false-block on valid circuits.

### Phase 4 — Live re-validation
- Re-run the 18 not-valid cases (and the full corpus) live under `next` (`scripts/liveValidate.mts`). **Target:** the RC-A/B cases become `valid`/`runnable`; measure the new valid rate vs the 56% baseline. Cases that remain not-valid for genuine support reasons (RC-E) are documented, not forced.

## 6. Success criteria
- [ ] RC-A: a correct tft-18 / dc-motor / 7-seg / led-array circuit validates `valid` (no false `INTENT_OUTPUT_NOT_FULFILLED`).
- [ ] RC-B: every input-readout capability offers ≥1 input device in candidates; the agent never needs a non-candidate part.
- [ ] Corpus still 37/37 candidate-correct; growth still O(request).
- [ ] Live valid rate up from **56% → ≥85%** (RC-A fixes the 6 motor/display cases; RC-B fixes the 7 input/sensor cases; RC-E's 2 stay correctly unsupported).
- [ ] `npm run test:unit`, `typecheck`, `build` green; no regression on legacy.

## 7. Risk & rollback
| Risk | Mitigation |
|---|---|
| Loosening intent-fulfillment hides real "wrong output" cases | Keep the gate; only widen the generic↔specific mapping, verified by tests that a genuinely-missing output still fails |
| RC-B default-part selection picks a poor representative | Deterministic stable order; document; the agent may still swap among allowed optionals |
| Taxonomy change affects legacy validation | Validation fixes are global correctness improvements; lock with golden tests; revert via git if a golden regresses |

## 8. Notes
- Diagnosis is trace-based: `.local/trace-results.json` holds the captured circuits + authoritative errors per case. Re-capture with `npx tsx scripts/liveTrace.mts <case-ids>` (source `.local/agent.env`).
- These are deterministic-layer fixes; they raise validity independent of model/reasoning. Model/reasoning is a separate lever (high reasoning alone did not fix these).

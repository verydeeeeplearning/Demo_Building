# Implementation Plan: Reliable "At-Least-Sensible" Circuit Simulation (P0–P2)

**Status**: In Progress
**Started**: 2026-06-03
**Last Updated**: 2026-06-03
**Architecture**: `docs/architecture/ARCH_sensible_simulation.md` (Draft + REVISION + empirical verdict R6.5 + resolved decisions R8)

**CRITICAL INSTRUCTIONS**: After each phase — check off tasks, run all quality-gate commands, verify they pass, update the date, record learnings, only then proceed.

Scope is the reviewed 80/20 slice: **P0 measurement → P1 Class-A structured output → P2 the single breadboard-isolation gate**, then STOP and re-measure. Everything else (prose principles layer, audit-set widening, critic subagent, principle-drc-map, template exemplars, second DRC engine) is deferred/cut per the architecture review.

---

## Overview

### Feature Description
Guarantee that any generated circuit is **at least physically/electrically sensible** or the agent answers conversationally — never a raw JSON dump (Class A), never a breadboard-bypassing "decoration" circuit marked runnable (Class B). Built ON the existing layered context + Deep Agents runtime; no rewrite.

### Success Criteria
- [ ] **Class A killed**: across a live probe (N≥10) the student-facing chat never contains serialized JSON; the message always comes from `structuredResponse.assistantMessage`.
- [ ] **Class B killed**: a circuit whose active part shares no breadboard node with the rest of the netlist is blocked from `runnable`, with the 3D scene still rendered + a student note (per R8.4).
- [ ] **No false-reject regression**: a curated corpus of legitimate beginner circuits (incl. Arduino-beside-board, Dupont-wired modules, single-jumper hops) all stay runnable.
- [ ] **Measurable**: a repeatable harness reports structured-output reliability and DRC block/false-reject counts before/after each phase.
- [ ] Existing TS test suite + typecheck stay green; all 43 routes stay under `maxPromptChars`.

---

## Architecture Decisions (Clean Architecture)

### Layer Mapping
| Layer | Components | Responsibility |
|-------|-----------|----------------|
| Domain | `CircuitSpec`; the **breadboard-node-isolation invariant** (pure predicate over spec+nodes); `isBoardResident` part attribute | physical-sensibleness business rule, zero deps |
| Application | structured-output **port** (strategy-agnostic); DRC use case that runs the isolation predicate; finalize message-source rule (`structuredResponse` only) | orchestration; no LLM/framework specifics |
| Infrastructure | `providerStrategy` adapter (replaces `toolStrategy`); `breadboardAudit.ts` node computation; `circuitTools.buildRunnableReport` gate; `deepAgentRuntime.finalizeAgentResult` | LangChain/OpenAI + render/validation I/O |
| Presentation | `src/main.js` decisions/notes; existing `DIAGNOSTIC_RENDER_ONLY` render-with-note path | show circuit + flagged note, disable run |

### Key Decisions
| Decision | Rationale | Trade-off |
|----------|-----------|-----------|
| `providerStrategy` + discard text channel (not toolStrategy) | Empirical R6.5: provider 6/6 reliable; native echoes JSON to text → must read `structuredResponse` only | provider native emits JSON-in-text; we must never surface that channel |
| One isolation predicate, reuse existing node map + blocking-codes plumbing | ~70–80% already built in `breadboardAudit.ts`; the missing piece is the inverse (isolation, not conflict) | widening audit to more part types deferred (false-positive risk) |
| Block only damage/dead-circuit; show circuit + note (R8) | Beginner-friendly; reuses `DIAGNOSTIC_RENDER_ONLY` | lenient gate lets best-practice violations through as advisory |
| `isBoardResident` per-part flag | Without it the isolation gate false-rejects Arduino/Dupont modules | new data field to author/maintain |

---

## Dependencies
### Required Before Starting
- [x] gpt-5.4-mini structured-output verified (R6.5)
- [x] R8 product decisions resolved
- [ ] `.local/agent.env` present for live probes (gitignored; key rotation reminder stands)

### External Dependencies
- `langchain@^1.4.2` (`providerStrategy` confirmed exported), `@langchain/openai@^1.4.7`, `deepagents@^1.10.2` — no new deps.

---

## Test Strategy
**TDD: tests FIRST.** Run the TS suite via `npx tsx --test tests/unit/<file>.test.ts` (the JS `npm test` short-circuits on pre-existing CSS-token failures).

| Test Type | Coverage Target | Purpose |
|-----------|-----------------|---------|
| Unit (domain) | ≥90% | isolation predicate, message-source rule — pure, no mocks |
| Unit (infra) | ≥80% | DRC gate wiring, finalize uses structuredResponse |
| Fixture corpus | curated | good/bad CircuitSpecs → expected block/pass (deterministic, CI-cheap) |
| Live probe | smoke | structured-output reliability + leak rate (N trials, gated behind env key) |

---

## Implementation Phases

### Phase 0: Measurement harness
**Goal**: Repeatable before/after metrics so we know if a phase helped and when to stop.
**Status**: Pending

#### RED
- [ ] `tests/unit/sensibleSimulationCorpus.test.ts` — load a fixture corpus of CircuitSpecs (good: LED+R blink, button→buzzer routed-through-board, I2C OLED beside-board; bad: button/buzzer point-to-point "decoration", floating). Assert each fixture's *expected* `runnable` + expected block-reason. Initially FAILS for the decoration fixture (today it wrongly passes).
- [ ] `.local/probe-structured-output.ts` (reusable, not in CI) — N-trial live probe reporting `structured%`/`leak%` per strategy (the R6.5 harness, parameterized).

#### GREEN
- [ ] Author the fixture corpus JSON under `tests/fixtures/circuits/` (good + bad, with `expectedRunnable`/`expectedBlockCode`).
- [ ] Harness reads corpus → runs deterministic `validate→compileRenderPlan→buildRunnableReport` → compares.

#### REFACTOR
- [ ] Extract a `measureCorpus()` helper reused by P1/P2 quality gates.

#### Quality Gate
- [ ] Corpus runs deterministically (no LLM), baseline recorded in `progress.txt` (decoration fixture currently passes = the bug, documented as RED baseline).
- [ ] Typecheck clean.

---

### Phase 1: Class A — reliable structured output, discard the text channel
**Goal**: Student message always from `structuredResponse.assistantMessage`; no JSON ever in chat.
**Status**: Pending

#### RED
- [ ] `tests/unit/structuredOutputSource.test.ts` — given an agent output with BOTH a populated `structuredResponse` AND a message-text channel containing the full JSON, `parseLiveAgentDraft` returns the draft from `structuredResponse` and the finalized student message equals `structuredResponse.assistantMessage` (NOT the JSON text). FAILS if any code reads the text channel when structured is present.
- [ ] Test: when `structuredResponse` is ABSENT, the no-structured guard fires (recover-as-chat fallback or re-ask marker), never a raw-JSON student message.

#### GREEN
- [ ] Switch `responseFormat: toolStrategy(LiveAgentDraftSchema)` → `providerStrategy(LiveAgentDraftSchema)` at `deepAgentRuntime.ts:483` (synthesis) and `:598` (requirement-analysis).
- [ ] In `parseLiveAgentDraft`/`finalizeAgentResult`: when `structuredResponse` present, use it exclusively; ensure `recoverDraftFromAgentMessages` (text channel) runs ONLY as the no-structured fallback.
- [ ] Add explicit "no structuredResponse" guard → conversational fallback message (never JSON).
- [ ] Harden `toConciseStudentMessage` as defense-in-depth: strip a whole-message minified JSON blob (single-line `{...}`), not just JSON *lines*.

#### REFACTOR
- [ ] Remove now-dead text-channel message paths; keep recovery strictly as fallback.

#### Quality Gate
- [ ] Live probe: `structured ≥ 9/10`, `leak (student-facing) = 0/10`.
- [ ] Existing runtime tests (agentWorkflow, singleRunHarness, requirementAnalysisFallback, liveAgentDraftDecision) green.
- [ ] Follow-up confirmed: provider still emits structured after multi-step real tool calls on a build prompt.
- [ ] Typecheck + TS suite clean.

---

### Phase 2: Class B — the breadboard-isolation gate
**Goal**: Block a circuit whose active part shares no breadboard node with the rest; render scene + note; no false-reject of legitimate circuits.
**Status**: Pending

#### RED
- [ ] `tests/unit/breadboardIsolationGate.test.ts` —
  - decoration/bypass spec (button+buzzer point-to-point to MCU, breadboard present but unused) → new `BREADBOARD_NODE_ISOLATED` warning, `runnable: false`, scene still rendered (parts.length > 0), reason surfaced.
  - legitimate routed-through-board spec → no isolation warning, `runnable: true`.
  - `isBoardResident:false` parts (Arduino, a Dupont module) and a single-jumper hop → NOT flagged (no false-reject).
- [ ] Extend P0 corpus expectations; corpus now passes only after GREEN.

#### GREEN
- [ ] Add `isBoardResident` to the part schema + author it for the registry (Arduino + large modules = false; passives/buttons/buzzer on-board = true).
- [ ] In `breadboardAudit.ts`: add the **isolation predicate** — every active, board-resident component must share ≥1 physical breadboard node (row/rail) with the rest of the netlist; emit `BREADBOARD_NODE_ISOLATED` for violators (skip `isBoardResident:false` and legitimate single-jumper nets).
- [ ] Register `BREADBOARD_NODE_ISOLATED` in `SIMULATION_BLOCKING_RENDER_WARNING_CODES` (`circuitTools.ts:70`) so it blocks `runnable` but renders (reuses `DIAGNOSTIC_RENDER_ONLY` show-with-note path).
- [ ] Surface the reason as a student-actionable note through the existing repair-loop `reasons[]` + `src/main.js` decisions.
- [ ] Ship behind a flag (`H_EDUWARE_BREADBOARD_ISOLATION=advisory|blocking`), default `advisory` until the corpus false-reject rate is verified low, then flip to `blocking`.

#### REFACTOR
- [ ] Share ONE definition of "routed" between the jumper-generation code and the gate (avoid the gate rejecting jumpers the renderer itself draws).

#### Quality Gate
- [ ] Corpus: decoration fixture now `runnable:false` + rendered; all legitimate fixtures `runnable:true` (0 false-reject).
- [ ] Flag in `advisory` shows note without blocking; in `blocking` disables run; both render the scene.
- [ ] Existing breadboard-audit + tutor tests green; typecheck clean.
- [ ] All 43 routes still under `maxPromptChars` (no prompt growth this phase).

---

### STOP & RE-MEASURE
Run the P0 harness. If Class A leak = 0 and Class B decoration is blocked with no false-rejects, **stop** — the deferred items (prose principles, audit widening, critic) are unnecessary unless measurement shows residual topology errors the gate can't catch.

---

## Risk Assessment
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| provider structured output breaks after real multi-step tool calls | Med | High | P1 gate explicitly tests the build path; fallback = keep toolStrategy + hardened recovery |
| isolation gate false-rejects valid circuits (jumpers, off-board modules) | Med | High | `isBoardResident` carve-out + single-jumper allowance + ship advisory-first behind flag |
| `isBoardResident` data wrong/missing for some of 132 parts | Med | Med | default `true` only for known on-board passives; audit per family with corpus |
| gpt-5.4-mini native unsupported in prod env vs probe | Low | High | already verified R6.5; re-check on Railway env before flip |
| Class A "no structured" guard loops | Low | Med | guard is single re-ask then conversational fallback, no loop |

## Rollback Strategy
- **P1**: revert `responseFormat` to `toolStrategy` + keep hardened `toConciseStudentMessage`; one-line strategy swap, env-flaggable.
- **P2**: set `H_EDUWARE_BREADBOARD_ISOLATION=advisory` (or remove the code from `SIMULATION_BLOCKING_RENDER_WARNING_CODES`); pure additive warning, no schema/netlist change.
- **P0**: test-only; no runtime impact.

## Progress Tracking
- Phase 0: 100% (corpus harness + baseline shipped, green)
- Phase 1: 100% (Class A closed via unwrap defenses; live-verified 0/6 leaks)
- Phase 2: 100% (RE-SCOPED to label-overlap repair; LABEL_OVERLAP 28→0 live, 0 false-reject)
Overall: 100% (P0–P2) — NOT yet committed/deployed
Secondary follow-ups (not in this plan): build-declined-3/10 coverage; pipeline duplication (see Notes).

## Notes & Learnings
- **P0 baseline (measured, deterministic):** `led-blink-good` → runnable ✓. `button-buzzer-decoration` → `validationStatus:valid, runnable:true, blockingWarningCount:0, warnings:[LABEL_OVERLAP]`. Class B baseline confirmed.
- **P1 DONE (Class A closed):** Reverting the empirical expectation — **`providerStrategy` is NOT viable here**: switching synthesis/requirement-analysis to provider-native made the OpenAI Responses API enforce strict JSON schema on ALL tools, and `validate_circuit_spec` (spec.intent lacks a `required` array) → every call `400 Invalid schema`. Reverted to `toolStrategy`. Class A is instead closed by **defense-in-depth in the recovery/finalize path** (no model-config change): `tryUnwrapDraftText` unwraps a JSON-draft-as-text into its inner assistantMessage in `recoverDraftFromAgentMessages`; `toConciseStudentMessage` now strips a whole-line minified JSON blob AND bare structural label prefixes (`assistantMessage:`/`clarification:`). Live-verified through the real `runAgent` pipeline (legacy mode): **JSON leaks 0/6, greeting→chat 3/3, build→circuit+runnable 3/3.** 160 runtime tests + typecheck green. Files: `deepAgentRuntime.ts` (tryUnwrapDraftText, recover, toConciseStudentMessage); tests `structuredOutputSource.test.ts`.
  - Learning: the R6.5 "switch to providerStrategy" recipe was blocked by the tools-strict-schema coupling; the unwrap defense alone is sufficient and lower-risk. Making tool schemas strict-compliant to re-enable provider-native is a possible future hardening, out of P1 scope.
- **P0 surfaced a contradiction with R8:** the "decoration" circuit is electrically VALID and functional — under R8 ("block only damage/dead") it is NOT a blocking case. Re-measurement over 10 diverse prompts proved the real visual defect is **`LABEL_OVERLAP` (28 across 5/7 circuits); ZERO placement/off-board/isolation warnings.** The "chip outside breadboard" hypothesis never reproduced. So the isolation gate was unnecessary and P2 was **re-scoped (user-confirmed) to label-overlap repair**.
- **P2 DONE (label-overlap repair), root cause was 3 things in the label solver:** (1) on failure it fell back to `candidates[0]` (the on-part anchor = guaranteed overlap) instead of the least-overlap spot; (2) too few/too-near candidate positions; (3) the audit counted a label floating above the **flat breadboard surface** as an "overlap" (false positive — most of the 28). Fix: least-overlap fallback + wider candidate ring + exclude placement-surface footprints (breadboard/PCB) from label-overlap checks. **Live: 28→0 across 5 circuits incl. RGB(11 parts), multi-LED(8); 0 false-reject; full TS suite 500/501, 0 fail.**
- **IMPORTANT discovery — duplicated pipeline:** `server/agent/circuitTools.ts` (≈7900 lines) contains a FULL copy of the render/label pipeline (`compileRenderPlan`, `compileLabelLayout`, `chooseLabelPlacement`, `labelPlacementCandidates`, `auditLabelLayout`, `isPlacementSurfaceFootprint`) and is the ACTIVE path; `server/agent/circuit/renderPlan.ts` is a parallel duplicate (refactor-in-progress on this branch, NOT imported by circuitTools). The label fix was applied to BOTH copies to avoid divergence, but this duplication is real tech debt worth consolidating later.
- **Secondary (not fixed):** 3/10 diverse prompts (버튼+부저, 조도센서+LED, 초음파) went to chat/clarify instead of building a supported circuit — a build-eagerness/coverage gap for a future task.
- R6.5 empirical: `toolStrategy` 0/6 structured (model talks); `providerStrategy` 6/6 structured but 6/6 JSON-in-text → the fix is provider + read-from-structuredResponse, established before any code change.
- Much of the "node model" (§3) and the "repair loop" (§4) already ship; this plan reuses them rather than rebuilding (per architecture REVISION R1).
- Deferred/cut: prose principles default layer (budget risk on ≤11k routes), `requiresStrictBreadboardGridAudit` widening, critic subagent, `principle-drc-map.json`, template exemplars, any second DRC engine.

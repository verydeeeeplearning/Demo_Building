# H-eduware Context, Validation, and Deepagents Workflow Plan

> RALPLAN consensus status: APPROVED.
>
> Planning artifacts:
>
> - Context snapshot: `.omx/context/context-validation-deepagents-workflow-20260531T171714Z.md`
> - Ralplan draft/source: `.omx/plans/2026-06-01-context-validation-deepagents-workflow.md`
> - Durable coworking copy: `docs/superpowers/plans/2026-06-01-context-validation-deepagents-workflow.md`
>
> Review gate:
>
> - Architect verdict: `ITERATE`, requiring result-type-aware coverage and context-bound Deepagents tools.
> - Critic verdict: `APPROVE` after those revisions.

## Outcome

Improve H-eduware's generalization path without widening supported hardware by model prior. The next implementation should make context sufficiency, capability promotion, deterministic validation, and Deepagents orchestration stricter and more observable, so unsupported or planned parts remain clarification/unsupported outcomes until their full data bundle exists.

This plan intentionally separates two meanings that must not be collapsed:

- **Synthesis sufficiency:** enough canonical context exists to create wiring, render a circuit, and run simulation.
- **Response sufficiency:** enough policy/routing context exists to ask a clarification, mark a request as planned/unsupported, or refuse an unsafe request.

## Implementation Checkpoint: 2026-06-01

Completed first implementation slice:

- `ContextCoverageReport` now includes `sufficientFor` and `synthesisEligibility`.
- Context coverage now distinguishes `valid_circuit_synthesis`, `clarification_response`, `unsupported_response`, `unsafe_refusal`, and `partial_visual_only`.
- `applyContextCoverageGate()` now allows final valid output only when coverage is sufficient for `valid_circuit_synthesis`, not merely response-sufficient.
- Deepagents tools are now context-bound through `createHeduwareAgentTools({ contextCoverage })`.
- `validate_circuit_spec`, `detect_faults`, `compile_render_plan`, `compile_simulation_plan`, and `compile_requirement_markdown` tool paths now use gated validation semantics where context coverage is supplied.
- `createDeepAgent()` and validator/simulation subagents now receive tools bound to the current `ContextPacket`.
- Capability promotion audit now returns `recommendedSupportLevel`.
- Unit tests now gate every `supportLevel: "supported"` capability and keep planned capabilities out of the supported release gate.
- `npm run check` passes: unit tests, typecheck, build, and Playwright E2E.

Completed second implementation slice:

- Files tab context evidence panel now shows circuit synthesis eligibility and response coverage purposes.
- Generated Context trace Markdown now records synthesis eligibility and response coverage alongside status, score, sources, missing sources, and warnings.
- English and Korean locale dictionaries include labels for synthesis eligibility, response coverage, and coverage purposes.
- E2E now verifies that a built agent circuit exposes `Circuit synthesis`, `eligible`, `Response coverage`, and `valid circuit synthesis` in the Files evidence panel.
- `npm run check` passes after the UI/document-artifact connection.

Completed third implementation slice:

- `auditCapabilityPromotionGaps()` now returns a machine-readable aggregate release-gate report for all capability graph entries.
- The aggregate report includes total capability count, support-level counts, recommended support-level counts, supported-ready capability ids, blocked capability ids, and per-artifact blocker buckets.
- Per-artifact blocker buckets classify missing context into registry, pin alias, validation rule, simulation primitive, render footprint, supported eval prompt, unsupported counterexample, and capability graph entry gaps.
- `npm run audit:capabilities` now prints the aggregate report as JSON for coworking reviews and future hardware promotion audits.
- Unit coverage now verifies that the aggregate report covers every capability, keeps planned capabilities recommended as `planned`, and exposes blocker buckets such as missing `part-capability` for planned hardware families.
- `npm run check` passes after the promotion-gap report connection.

Completed fourth implementation slice:

- `buildGeneralizationEvalReport()` now runs the context sufficiency eval corpus and attaches route, coverage, capability matches, support gaps, unsupported signals, and per-row promotion blockers.
- The generalization report embeds the same capability promotion gap report, so planned/unsupported eval failures explain which artifact bundle is missing before valid synthesis can be allowed.
- `npm run eval:generalization:report` now prints the full JSON report for QA artifacts and coworking review, with optional CLI support for writing the report via `--out`.
- `tests/unit/generalizationEval.test.ts` now verifies that planned-context eval rows carry concrete promotion blockers such as missing `part-capability` and `render-footprint`.
- Targeted verification passed: `npm exec -- tsx --test tests/unit/generalizationEval.test.ts`, `npm run eval:generalization:report`, and `npm run typecheck`.

Completed fifth implementation slice:

- `createContextQaArtifactBundle()` now writes context QA evidence into the same folder shape used by browser/manual QA runs.
- `npm run qa:context-artifacts -- --run-id <run-id>` creates `generalization-eval-report.json`, `capability-promotion-gaps.json`, `context-qa-summary.md`, and `context-qa-manifest.json` under `qa-artifacts/manual-product-qa/<run-id>/`.
- The summary file gives a compact run-level bridge between browser QA findings and context coverage/promotion blockers.
- `docs/browser_generalization_verification.md` now requires context QA artifacts to be attached to manual/browser QA runs.
- Unit coverage verifies that planned eval rows and promotion blockers are written beside a QA run artifact bundle.

Completed sixth implementation slice:

- Planned capability/context gaps now stop before live/scripted draft consumption without being labeled as unsafe safety refusals.
- `buildUnsupportedPreflightDraft()` now distinguishes support gaps from unsafe/unsupported safety routes.
- Planned gaps emit `context-support-gap` events and student-facing copy about missing canonical context, while high-voltage/security/autonomy routes continue to emit `safety-policy`.
- `tests/unit/agentWorkflow.test.ts` now covers potentiometer brightness as a planned context gap that produces no render/current simulation artifacts and does not trigger `safety-policy`.
- `npm run check` passes after the Deepagents preflight split.

Completed seventh implementation slice:

- Frontend decision chips now sanitize `context-support-gap` event summaries before they reach the student-facing chat panel.
- `studentFacingEventLabel()` maps support-gap events to a dedicated support-readiness label instead of relying on broad fallback wording.
- `studentFacingEventSummary()` now replaces internal phrases such as `canonical context`, `valid synthesis`, `part-capability`, `render-footprint`, and `simulation-primitive` with student-friendly Korean/English copy.
- Playwright E2E now covers a planned potentiometer LED dimmer context-gap response and verifies that no build, render canvas, current simulation, or internal validation jargon is exposed.
- Verified with `npm run test:e2e -- --grep "planned context gaps"` and `npm run check`; result: pass, with 42 Playwright tests passed and 8 opt-in live tests skipped.

Completed eighth implementation slice:

- Added `agent-context/registry/visual-library-crosswalk.json` as the explicit data-first bridge between the broad UI part library and canonical agent-ready `part-capabilities`.
- Unmapped visual library parts now have a machine-readable default status of `visual-only`, so visible parts cannot silently become agent-supported hardware.
- `auditVisualLibraryExpansion()` now reports total visual parts, canonical agent part count, agent-ready visual mappings, visual-only part IDs, invalid mappings, and examples.
- `auditCapabilityPromotionGaps()` now embeds the visual-library audit, making `npm run audit:capabilities` show both capability promotion blockers and browse-only hardware such as `esp32-devkit` and `potentiometer`.
- Unit coverage verifies that visual-only parts remain outside `agentReadyVisualPartIds` and that all mapped agent-ready visual parts point to `supportLevel: "supported"` canonical part capabilities.
- Verified with `npm exec -- tsx --test tests/unit/contextCoverage.test.ts`, `npm run typecheck`, `npm run audit:capabilities`, and `npm run check`; result: pass, with 42 Playwright tests passed and 8 opt-in live tests skipped.

Completed ninth implementation slice:

- Simulation current paths are now filtered against render footprint pin anchors, not just validation IDs and primitive IDs.
- `filterValidatedCurrentPaths()` now rejects otherwise validated paths whose `from` or `to` endpoint has no renderable footprint anchor, and emits `SIMULATION_ENDPOINT_ANCHOR_MISSING`.
- The same filter rejects current paths that pass through missing component IDs, emitting `SIMULATION_PATH_COMPONENT_MISSING`.
- This prevents impossible endpoints such as `arduino-uno:D99` from creating Run current-flow descriptors even when an agent draft names a known primitive and a validated current path ID.
- `tests/unit/agentWorkflow.test.ts` now includes a regression where `led-forward-current` is validated and uses `digital_on_off`, but is dropped because its source endpoint has no render anchor.
- Verified with `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts`, `npm run typecheck`, `npm run build`, and `npm run check`; result: pass, with 42 Playwright tests passed and 8 opt-in live tests skipped.

Completed tenth implementation slice:

- `agent-context/evals/context-sufficiency-prompts.jsonl` now makes each prompt row declare its expected context route, coverage status, synthesis eligibility, required response purposes, and forbidden response purposes.
- Unsupported-but-not-unsafe requests such as drone autopilot and Wi-Fi door lock now remain sufficient for `unsupported_response` without being marked sufficient for `unsafe_refusal`; high-voltage mains requests still require `unsafe_refusal`.
- `buildContextCoverage()` now separates generic unsupported signals from truly unsafe refusal signals before filling `sufficientFor`.
- `buildGeneralizationEvalReport()` preserves the row-level expected route/coverage/synthesis contract beside the observed route and coverage report, making report diffs reviewable by QA and coworkers.
- `ContextSufficiencyFixtureSchema` now parses the same expected route/coverage/purpose fields for future context audits.
- Verified with `npm exec -- tsx --test tests/unit/generalizationEval.test.ts`, `npm exec -- tsx --test tests/unit/contextSufficiencyEval.test.ts tests/unit/contextCoverage.test.ts`, `npm run eval:generalization:report`, `npm run typecheck`, and `npm run check`; result: pass, with 42 Playwright tests passed and 8 opt-in live tests skipped.

Completed eleventh implementation slice:

- `createContextQaArtifactBundle()` now writes `browser-verification-plan.json` beside the generalization eval and promotion-gap reports.
- The browser verification plan records the target URL, offline-safe default mode, live opt-in environment variables, required browser checklist, and one prompt-matrix row per generalization eval prompt.
- Each prompt-matrix row carries the prompt, expected failure class, expected route, expected coverage status, synthesis eligibility, response-purpose contract, and expected browser outcome.
- `context-qa-manifest.json` now includes browser verification metadata, including checklist item count, prompt row count, target URL, and live opt-in configuration.
- `context-qa-summary.md` now includes a Browser Verification section so manual/browser QA runs can connect visible failures to context routing and capability gaps.
- Verified with `npm exec -- tsx --test tests/unit/contextQaArtifactBundle.test.ts`, `npm exec -- tsx --test tests/unit/generalizationEval.test.ts tests/unit/contextQaArtifactBundle.test.ts`, `npm run qa:context-artifacts -- --run-id context-browser-plan-smoke --root .artifacts/qa-browser-plan-smoke`, `npm run typecheck`, and `npm run check`; result: pass, with 42 Playwright tests passed and 8 opt-in live tests skipped.

Completed twelfth implementation slice:

- `browser-visible-verification` is now a required capability promotion artifact, matching the Data-First Expansion Rule in `agent-context/index.md`.
- `agent-context/evals/context-sufficiency-prompts.jsonl` now carries explicit `expectedBrowserOutcome` evidence for each generalization row.
- `auditCapabilityCoverage()` now marks supported starter capabilities as present for `browser-visible-verification` only when a sufficient, synthesis-eligible eval row expects `render-and-run-valid-simulation`.
- Planned, unsupported, and unsafe capabilities now report `Missing browser-visible verification evidence...` in capability promotion gaps, so they cannot be promoted to supported by registry/context additions alone.
- `buildGeneralizationEvalReport()` and `browser-verification-plan.json` preserve fixture-defined browser outcomes such as `support-gap-no-render-or-current`, `unsupported-response-no-render-or-current`, `unsafe-refusal-no-render-or-current`, and `record-failure-class-and-context-evidence`.
- Verified with `npm exec -- tsx --test tests/unit/contextCoverage.test.ts`, `npm exec -- tsx --test tests/unit/generalizationEval.test.ts tests/unit/contextQaArtifactBundle.test.ts`, `npm run audit:capabilities`, `npm run eval:generalization:report`, `npm run qa:context-artifacts -- --run-id context-browser-evidence-gate-smoke --root .artifacts/qa-browser-evidence-gate-smoke`, `npm run typecheck`, and `npm run check`; result: pass, with 42 Playwright tests passed and 8 opt-in live tests skipped.

Completed thirteenth implementation slice:

- The `button-led-buzzer` multi-output eval row has been promoted from `model-synthesis-gap` to a valid `render-and-run-valid-simulation` browser outcome.
- `agent-context/electrical/topology-templates.json` now includes `controller-digital-input-switch-plus-multiple-outputs`, a role-based topology for one button input driving both a protected LED load and a separate low-current buzzer load.
- `server/agent/circuitTools.ts` now aggregates simulation contexts across all output components instead of using only the first output component. Validation current path IDs, current path estimation, and expected states can now include both `led-forward-current` and `buzzer-current` for one validated circuit.
- `tests/unit/agentWorkflow.test.ts` now proves the composite topology is selected, the composite validation report cites it, and a button+LED+buzzer circuit yields both LED and buzzer current paths in the final simulation plan.
- `tests/unit/generalizationEval.test.ts` now asserts that `button-led-buzzer` reports `expectedFailureClass: "none"`, `observedFailureClass: "none"`, no promotion blockers, and zero remaining `model-synthesis-gap` rows.
- `tests/unit/contextQaArtifactBundle.test.ts` now requires the browser verification plan to treat `button-led-buzzer` as a visible render/run verification case.
- Verified with `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts tests/unit/generalizationEval.test.ts tests/unit/contextQaArtifactBundle.test.ts`, `npm run typecheck`, `npm run eval:generalization:report`, and `npm run audit:capabilities`; targeted result: pass, with `byExpectedFailureClass.none = 8` and `model-synthesis-gap = 0`.

Completed fourteenth implementation slice:

- Repeated supported output parts now keep independent current paths instead of collapsing through duplicate current path ids.
- `server/agent/circuitTools.ts` now resolves required passive parts by the actual endpoint path into each target output, so two LEDs can be paired with two different resistors.
- The LED validator now records which resistor is on each LED series path and rejects ambiguous shared current limiting with `LED_RESISTOR_SHARED`.
- Duplicate current path template ids are disambiguated by target component id only when duplicates exist, preserving legacy single-output ids such as `led-forward-current` while producing ids such as `led-forward-current:led-1` and `led-forward-current:led-2` for repeated LED loads.
- `tests/unit/agentWorkflow.test.ts` now covers two independent LEDs with two resistors and a negative case where two LEDs share one resistor path.
- Verified with `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts` and `npm run typecheck`; targeted result: pass.

Completed fifteenth implementation slice:

- Korean hardware phrase routing now covers student-natural wording for button + LED + buzzer, planned potentiometer LED dimming, and servo motion requests.
- `server/context/capabilityGraph.ts` now expands Hangul token variants by trimming common Korean particles and endings, so phrases such as `가변저항으로`, `밝기를`, and `조절하고` can match canonical capability phrases without broad English-only fallbacks.
- `server/context/contextPacket.ts` now uses active Korean hardware keyword and unsafe-pattern lists for request expansion, intent hints, candidate parts, and unsupported signal detection.
- `agent-context/evals/context-sufficiency-prompts.jsonl` now includes Korean generalization rows for valid multi-output synthesis and planned analog-input support gaps.
- `tests/unit/contextRouting.test.ts`, `tests/unit/contextSufficiencyEval.test.ts`, `tests/unit/generalizationEval.test.ts`, and `tests/unit/contextQaArtifactBundle.test.ts` now prove Korean valid, planned-gap, and PWM actuator routes behave according to the same data-first support contract.
- Verified with `npm exec -- tsx --test tests/unit/contextRouting.test.ts tests/unit/contextSufficiencyEval.test.ts tests/unit/generalizationEval.test.ts tests/unit/contextQaArtifactBundle.test.ts` and `npm run typecheck`; targeted result: pass.

Completed sixteenth implementation slice:

- `compileRenderPlan()` now runs a placement DRC pass after footprint attachment and before returning a render plan.
- Breadboard-compatible parts such as LEDs, resistors, buttons, buzzers, and OLED modules now emit `BREADBOARD_PLACEMENT_OUT_OF_BOUNDS` if their footprint bounds sit outside the breadboard outline.
- Breadboard-compatible parts now emit `BREADBOARD_PLACEMENT_SURFACE_MISSING` when a valid electrical spec lacks a breadboard placement surface, preventing silent trust in physically impossible visual layouts.
- `src/renderWarnings.js` now uses readable Korean copy for render-warning titles, intro text, empty states, component labels, and common render/placement warning messages.
- `tests/unit/agentWorkflow.test.ts` now covers out-of-bounds and missing-surface placement warnings. `tests/unit/renderWarnings.test.js` now covers readable Korean render-warning Markdown.
- Verified with `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts`, `node --test tests/unit/renderWarnings.test.js`, and `npm run typecheck`; targeted result: pass.

Completed seventeenth implementation slice:

- `compileRenderPlan()` now creates default component positions through a breadboard-aware placement planner instead of a short fixed index table.
- The planner keeps explicit agent-supplied `component.position` values intact, but auto-places unspecified breadboard-compatible parts using footprint dimensions, breadboard bounds, margins, and row gaps.
- Multiple supported through-hole parts can now be rendered on one breadboard without falling back to the same default coordinate or silently overlapping.
- Servo and Arduino defaults remain outside/on the side of the breadboard according to their footprint placement policy, while breadboard-compatible loads and inputs are packed onto the breadboard surface.
- `tests/unit/agentWorkflow.test.ts` now includes a many-part render fixture proving auto-placed LEDs, resistors, a button, and a buzzer stay inside the breadboard and do not overlap.
- Verified with `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts` and `npm run typecheck`; targeted result: pass.

Completed eighteenth implementation slice:

- `compileRenderPlan()` now audits render connections against the compiled endpoint layout before returning a plan.
- Connections that reference a pin without a render anchor emit `RENDER_CONNECTION_ENDPOINT_MISSING`, so stage rendering cannot silently drop a wire because an endpoint is unknown.
- Connections whose endpoints collapse to the same rendered point emit `RENDER_CONNECTION_TOO_SHORT`, making zero-length or visually invisible wires explicit in Files/PCB warning surfaces.
- Korean render warning copy now covers the new connection DRC warning codes, so students see natural Korean explanations instead of raw English debug text.
- `tests/unit/agentWorkflow.test.ts` now covers missing render anchors and zero-length render wires. `tests/unit/renderWarnings.test.js` covers the Korean copy for both connection DRC warnings.
- Verified with `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts`, `node --test tests/unit/renderWarnings.test.js`, `npm run typecheck`, and `npm run check`; result: pass, with 42 Playwright tests passed and 8 opt-in live tests skipped.
- Agent server was restarted after the source change. `/api/agent/health` reported live mode, model `gpt-5.5`, and `sourceStatus.stale=false`.
- Browser smoke at `http://127.0.0.1:4173/` confirmed the app renders Korean project copy, shows `Deepagents Live · gpt-5.5`, and does not show a stale-server warning.

Completed nineteenth implementation slice:

- `compileRenderPlan()` now runs a breadboard pin topology DRC pass after placement and footprint attachment.
- Breadboard-compatible parts with multiple terminals collapsed onto one row emit `BREADBOARD_PIN_ROW_COLLAPSE`, preventing a visually validated circuit from hiding a same-row breadboard short risk.
- Supported render footprints for OLED, LED, resistor, and buzzer were updated so their physical pin anchors occupy distinct breadboard rows instead of all landing on one visual row.
- Korean render warning copy now explains row-collapse issues without exposing internal DRC wording first.
- `tests/unit/agentWorkflow.test.ts` now verifies LED and resistor endpoints land on distinct rows and that the DRC catches a crafted bad footprint. `tests/unit/renderWarnings.test.js` covers the Korean copy.
- Verified with `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts`, `node --test tests/unit/renderWarnings.test.js`, and `npm run check`; result: pass, with 42 Playwright tests passed and 8 opt-in live tests skipped.
- Agent server was restarted after the server/context change. `/api/agent/health` reported live mode, model `gpt-5.5`, and `sourceStatus.stale=false`.
- Browser smoke at `http://127.0.0.1:4173/` confirmed the app renders Korean project copy, shows `Deepagents Live · gpt-5.5`, and does not show a stale-server warning.

Completed twentieth implementation slice:

- `agent-context/rendering/breadboard-grid.json` now defines the machine-readable breadboard signal-hole rows, rail anchors, pitch, coordinate system, and snap tolerances.
- `server/context/contextAssets.ts` and `server/context/contextLayer.ts` now expose `loadBreadboardGrid()`, making the grid a first-class context asset instead of Markdown-only guidance.
- `compileRenderPlan()` now uses the grid to snap auto-placed breadboard-compatible parts to signal-hole coordinates, while preserving explicit agent-supplied positions for DRC review.
- `compileRenderPlan()` now emits `BREADBOARD_PIN_GRID_MISALIGNMENT` when a breadboard-compatible pin does not land near the machine-readable hole grid.
- The breadboard auto-placement loop now avoids overlap after grid snapping, so better physical fidelity does not regress the existing many-part placement invariant.
- `src/renderWarnings.js` includes student-facing Korean copy for grid misalignment warnings.
- `tests/unit/contextCoverage.test.ts`, `tests/unit/contextLayerStructure.test.ts`, `tests/unit/agentWorkflow.test.ts`, and `tests/unit/renderWarnings.test.js` now cover the grid context file, loader, snap behavior, DRC warning, and Korean warning copy.
- Verified with `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts`, `npm exec -- tsx --test tests/unit/contextCoverage.test.ts tests/unit/contextLayerStructure.test.ts`, `node --test tests/unit/renderWarnings.test.js`, `npm run typecheck`, and `npm run check`; result: pass, with 42 Playwright tests passed and 8 opt-in live tests skipped.
- Agent server was restarted after the server/context change. `/api/agent/health` reported live mode, model `gpt-5.5`, and `sourceStatus.stale=false`.
- Browser smoke at `http://127.0.0.1:4173/` confirmed the app renders Korean project copy, shows `Deepagents Live · gpt-5.5`, and does not show a stale-server warning.

Completed twenty-first implementation slice:

- `compileRenderPlan()` now audits hidden breadboard physical-node conflicts after render endpoint compilation.
- `auditBreadboardPhysicalNodeConflicts()` groups breadboard-compatible footprint pins by the machine-readable signal-hole grid node, then checks whether pins sharing the same physical node are also connected by the logical render connection graph.
- Pins that occupy the same physical breadboard hole without a logical connection emit `BREADBOARD_PHYSICAL_NODE_CONFLICT`, making accidental visual shorts visible before students trust a rendered assembly.
- The DRC accepts intentional same-hole/shared-node placement when the logical net explicitly connects the endpoints.
- `src/renderWarnings.js` now gives `BREADBOARD_PHYSICAL_NODE_CONFLICT` a Korean student-facing explanation instead of falling back to raw English debug wording.
- `tests/unit/agentWorkflow.test.ts` covers unconnected shared-hole conflicts, intentionally connected shared holes, and render-plan integration for explicit bad positions.
- `tests/unit/renderWarnings.test.js` covers the Korean warning copy.
- Verified with `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts`, `node --test tests/unit/renderWarnings.test.js`, and `npm run typecheck`; targeted result: pass.
- Full acceptance verification passed with `npm run check`: 62 JavaScript unit tests, 113 TypeScript unit tests, production build, and 42 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- Agent server was restarted after the source change. `/api/agent/health` reported live mode, model `gpt-5.5`, provider `openai`, and `sourceStatus.stale=false`.
- Browser smoke at `http://127.0.0.1:4173/` confirmed the app renders Korean project copy, shows `Deepagents Live · gpt-5.5`, and does not show a stale-server warning.

Completed twenty-second implementation slice:

- `compileSimulationPlan()` now accepts the compiled `RenderPlan` as an optional finalization artifact.
- Critical render DRC warnings can now block current animation even when the logical `ValidationReport` is otherwise `valid`.
- `BREADBOARD_PHYSICAL_NODE_CONFLICT` is treated as simulation-blocking because two visually shared breadboard holes can create an unintended physical node that the logical netlist did not validate.
- When blocked, the simulation plan becomes `invalid`, clears current paths, clears run text, and adds a `SIMULATION_BLOCKED_BY_RENDER_DRC` warning that cites the underlying render DRC code.
- `deepAgentRuntime` finalization and Deepagents tool artifact compilation now pass the compiled render plan into `compileSimulationPlan()`, so server-final results and tool-visible results use the same simulation gate.
- `tests/unit/agentWorkflow.test.ts` now covers a valid button+LED logical circuit with explicit render positions that create a hidden physical node conflict; current paths are produced before render gating but the final simulation plan is blocked.
- Verified with `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts` and `npm run typecheck`; targeted result: pass.
- Full acceptance verification passed with `npm run check`: 62 JavaScript unit tests, 114 TypeScript unit tests, production build, and 42 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- Agent server was restarted after the source change. `/api/agent/health` reported live mode, model `gpt-5.5`, provider `openai`, and `sourceStatus.stale=false`.
- Browser smoke at `http://127.0.0.1:4173/` confirmed the app renders Korean project copy, shows `Deepagents Live · gpt-5.5`, and does not show a stale-server warning.

Completed twenty-third implementation slice:

- `auditBreadboardContinuityConflicts()` now checks the machine-readable breadboard row `continuityGroup`, not only exact same-hole overlap.
- Pins that sit in different holes but the same breadboard continuity row now emit `BREADBOARD_CONTINUITY_CONFLICT` unless the logical render connection graph explicitly connects those endpoints.
- Same-row endpoints remain accepted when the logical net declares the shared row continuity, preserving intentional breadboard node sharing.
- `compileRenderPlan()` now runs this continuity DRC after exact physical-node DRC.
- `BREADBOARD_CONTINUITY_CONFLICT` is added to the simulation-blocking render warning set, so Run does not animate current through a layout that hides an unintended breadboard row connection.
- `src/renderWarnings.js` now includes Korean student-facing copy for hidden breadboard continuity conflicts.
- `tests/unit/agentWorkflow.test.ts` covers direct DRC warning/acceptance, render-plan integration, and final simulation blocking for a logically valid button+LED circuit with a hidden row continuity conflict.
- `tests/unit/renderWarnings.test.js` covers the Korean warning copy.
- Verified with `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts`, `node --test tests/unit/renderWarnings.test.js`, and `npm run typecheck`; targeted result: pass.
- Full acceptance verification passed with `npm run check`: 63 JavaScript unit tests, 118 TypeScript unit tests, production build, and 42 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- Agent server was restarted after the source change. `/api/agent/health` reported live mode, model `gpt-5.5`, provider `openai`, and `sourceStatus.stale=false`.
- Browser smoke at `http://127.0.0.1:4173/` confirmed the app renders Korean project copy, shows `Deepagents Live · gpt-5.5`, and does not show a stale-server warning.

Completed twenty-fourth implementation slice:

- `auditBreadboardRailConflicts()` now checks power/ground rail continuity from `agent-context/rendering/breadboard-grid.json`.
- Pins that sit in different rail holes on the same `+ rail` or `- rail` now emit `BREADBOARD_RAIL_CONFLICT` unless the logical render connection graph explicitly connects those endpoints.
- Intentional rail sharing remains accepted when the logical net declares the shared rail connection.
- `compileRenderPlan()` now runs rail DRC after signal-hole and signal-row continuity DRC.
- `BREADBOARD_RAIL_CONFLICT` is added to the simulation-blocking render warning set, so Run does not animate current through a layout that hides an unintended rail connection.
- `src/renderWarnings.js` now includes Korean student-facing copy for hidden breadboard rail conflicts.
- `tests/unit/agentWorkflow.test.ts` covers direct rail DRC warning/acceptance, render-plan integration, and final simulation blocking for a logically valid button+LED circuit with a hidden rail conflict.
- `tests/unit/renderWarnings.test.js` covers the Korean warning copy.
- Verified with `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts`, `node --test tests/unit/renderWarnings.test.js`, and `npm run typecheck`; targeted result: pass.
- Full acceptance verification passed with `npm run check`: 64 JavaScript unit tests, 122 TypeScript unit tests, production build, and 42 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- Agent server was restarted after the source change. `/api/agent/health` reported live mode, model `gpt-5.5`, provider `openai`, and `sourceStatus.stale=false`.
- Browser smoke at `http://127.0.0.1:4173/` confirmed the app renders Korean project copy, shows `Deepagents Live · gpt-5.5`, and does not show a stale-server warning.

Remaining plan scope:

- Continue hardware promotion only through the Data-First Expansion Rule.

## Evidence Snapshot

- Frontend stack is Vanilla JS, Vite, and three.js; server is Node/TypeScript with Deepagents and Zod (`package.json`).
- `server/context/contextPacket.ts` already builds a forced request-specific `ContextPacket` before Deepagents and emits `contextRoute`, `retrievalPlan`, `contextTrace`, and `contextCoverage`.
- `server/agent/deepAgentRuntime.ts` already injects the packet into the Deepagents system prompt, runs a bounded validation repair loop, and finalizes through server-side compilers.
- `server/agent/circuitTools.ts` already owns deterministic validation, coverage gating, render compilation, simulation compilation, and current-path filtering.
- `server/context/contextLayer.ts` already exposes `auditCapabilityCoverage()` and `REQUIRED_CAPABILITY_ARTIFACTS`.
- `src/partLibraryData.js` exposes 132 visual library parts across 9 categories, while `agent-context/data/part-capabilities.json` has 9 canonical agent-ready part entries.
- Current context data contains 11 capability records: 5 supported, 3 planned, and 3 unsupported. It also contains 9 simulation primitives, 9 render footprints, and 18 context sufficiency eval rows across 13 prompt families.
- Existing docs state the core rule: no hardware family moves from `planned` to `supported` without capability graph, registry, pin aliases, validation rule, simulation primitive, render footprint, supported eval prompt, unsupported counterexample, and browser-visible verification.

## RALPLAN-DR Summary

### Principles

1. Context is the source of truth; Deepagents synthesize only from the forced context packet.
2. Deterministic validation owns validity; model output is never accepted as valid by assertion.
3. Support-level promotion is data-bundle based, not visual-library based.
4. Simulation and rendering must be blocked or warned when primitive or footprint evidence is missing.
5. Tests should measure capability families and failure classes, not fixed demo order.
6. Refusal/clarification grounding and valid-circuit grounding are different contracts.

### Decision Drivers

1. Prevent LLM-prior simulation of unsupported/planned parts that exist only in the visual library.
2. Preserve the polished Arduino + I2C OLED demo path while strengthening broad student-query safety.
3. Keep default verification offline and deterministic: `npm test`, `npm run build`, `npm run test:e2e`, and `npm run check`.

### Viable Options

**Option A: Data-first strict promotion**

- Approach: keep the existing forced context packet, then make promotion audits, coverage gates, validator errors, and eval telemetry stricter before adding more supported hardware.
- Pros: lowest hallucination risk, aligns with existing architecture, preserves hackathon boundary.
- Cons: students asking for visually available but agent-unsupported parts will see more planned/unsupported responses until data bundles are completed.

**Option B: Visual-library assisted partial support**

- Approach: allow library-only parts to render/explain with explicit `partial` support while blocking simulation.
- Pros: better perceived breadth and useful browsing experience.
- Cons: higher risk of confusing "visible in library" with "safe to synthesize"; requires very clear UI status and stricter partial-output contracts.

**Option C: Prompt-only Deepagents expansion**

- Approach: improve prompts/subagents and rely on live model knowledge for broader hardware, with server validation catching failures later.
- Pros: fastest apparent breadth.
- Cons: violates the product truthfulness boundary; planned/unsupported parts can leak into plausible but ungrounded circuits. Not recommended.

### Recommended Architecture

Use Option A as the default. Add a narrow Option B-style partial path only where the UI already has explicit visual evidence and the result cannot produce wiring, validation, current paths, or simulation unless the full bundle audit passes.

The partial path should be named explicitly, for example `partial_visual_only`, and must produce no wiring diagram, no current paths, no Run simulation, and no "valid circuit" status.

## ADR

### Decision

Strengthen the existing context-forced, validation-first architecture. Do not expand supported hardware from the 132-part visual library unless the canonical agent-context bundle is complete and verified.

### Drivers

- The visual catalog is much broader than canonical agent context.
- Current code already has the right enforcement points: context packet, coverage gate, validator, render compiler, simulation compiler, and repair loop.
- Default tests must remain mocked/cached and secret-free.

### Alternatives Considered

- Treat all visual library parts as agent-available: rejected because registry, validation, footprint, primitive, and eval evidence are missing for most parts.
- Add more Deepagents prompt instructions only: rejected because prompt constraints are not deterministic enough to enforce physical and simulation truthfulness.
- Disable generalization work and freeze OLED-only scope: rejected because the current architecture already supports safe planned/unsupported classification and can improve without broadening support unsafely.

### Why Chosen

The recommended path improves correctness at the existing control points and uses planned hardware requests as measurable gaps, not fake valid circuits.

### Consequences

- More requests will intentionally return clarification or unsupported/planned-gap responses.
- Implementation work is mostly data contracts, audits, tests, and UI evidence rather than new demo circuits.
- Future hardware expansion becomes slower but safer and easier to review.

### Follow-ups

- After this plan, use `$ultragoal` for durable sequential implementation, optionally with `$team` split across context/audit, validator/runtime, frontend evidence, and QA lanes.

## Scope

In scope:

- Tighten context coverage semantics by result type: valid, clarification, unsupported, unsafe.
- Split coverage into synthesis eligibility and response eligibility.
- Make Deepagents tools context-bound so tool responses cannot contradict server finalization.
- Make capability promotion audits executable acceptance gates for any support-level change.
- Ensure Deepagents repair cannot convert context gaps into valid circuits.
- Improve deterministic eval reporting for capability family, failure class, coverage score, and source IDs.
- Surface student-facing evidence and developer diagnostics without raw prompt/debug dumps.

Out of scope:

- Adding a frontend framework.
- Broadly supporting all 132 visual library parts.
- Live OpenAI calls in default acceptance.
- SPICE-like physical simulation.
- Architecture replacement of the existing Vanilla JS/Vite/three.js and Node/TS server stack.

## Milestones

### 1. Coverage Contract Hardening

Files/resources:

- `server/context/contextPacket.ts`
- `server/agent/schemas.ts`
- `server/agent/circuitTools.ts`
- `tests/unit/contextCoverage.test.ts`
- `tests/unit/contextSufficiencyEval.test.ts`

Work:

- Replace the overloaded binary interpretation of `contextCoverage.status` with a result-type-aware contract.
- Add fields such as `sufficientFor`, `synthesisEligibility`, or `resultTypeCoverage` so the system can say:
  - sufficient for `valid_circuit_synthesis`
  - sufficient for `clarification_response`
  - sufficient for `unsupported_response`
  - sufficient for `unsafe_refusal`
- Keep valid circuits blocked unless canonical data, registry, validation/reference, rendering, and simulation evidence are present when render/simulation are expected.
- Allow unsupported/unsafe responses to be response-sufficient with policy and route evidence, while still synthesis-ineligible and blocked from render/current animation.
- Add tests proving planned capabilities cannot pass as valid even when the draft circuit is electrically plausible.

### 2. Promotion Audit as a Release Gate

Files/resources:

- `server/context/contextLayer.ts`
- `agent-context/data/capability-graph.json`
- `agent-context/data/part-capabilities.json`
- `agent-context/data/render-footprints.json`
- `agent-context/simulation/primitives.json`
- `agent-context/evals/context-sufficiency-prompts.jsonl`
- `tests/unit/contextCoverage.test.ts`

Work:

- Extend `auditCapabilityCoverage()` output with per-artifact reasons and support-level recommendations.
- Add a test that loops over every `supportLevel: "supported"` capability and requires the full artifact bundle to pass.
- Add a test that every `planned` capability fails with explicit missing artifacts.
- Add a lightweight report path in the eval output so failures can be classified as registry, validation, simulator, renderer, eval, or routing gaps.

### 3. Deepagents Workflow Guardrails

Files/resources:

- `server/agent/deepAgentRuntime.ts`
- `server/agent/deepAgentTools.ts`
- `server/agent/circuitTools.ts`
- `tests/unit/agentWorkflow.test.ts`

Work:

- Ensure the repair loop never retries or repairs around `CONTEXT_COVERAGE_INSUFFICIENT`; it should return the gap.
- Change Deepagents tool creation from context-free to context-bound, for example `createHeduwareAgentTools(contextPacket)`.
- Ensure `validate_circuit_spec` exposed to Deepagents returns the same gated validation semantics as finalization, or add an explicit `validate_circuit_spec_with_context` tool.
- Ensure tool-visible "valid" can never disagree with final `applyContextCoverageGate()` output.
- Add tests where the first draft uses a planned part or invented pin and verify the final result is invalid/clarification, not repaired into an unsupported valid circuit.
- Ensure tool calls exposed to Deepagents return deterministic errors/warnings that match server finalization behavior.
- Keep max repair attempts bounded and visible in `agentEvents`.

### 4. Simulation and Render Truthfulness

Files/resources:

- `server/agent/circuitTools.ts`
- `server/agent/schemas.ts`
- `src/stageScene.js`
- `src/main.js`
- `tests/unit/agentWorkflow.test.ts`
- `tests/unit/stageScene.test.js`
- `tests/e2e/features.spec.js`

Work:

- Require current paths to have both validated IDs and known primitive IDs.
- Add fixture tests for missing primitive, missing render footprint, and missing endpoint anchor.
- Ensure render warnings appear in Files/PCB and current animation stays absent unless `validationReport.status === "valid"` and simulation status is valid.
- Preserve the existing OLED demo path as a regression probe, not a special-case expansion model.

### 5. Generalization Eval and Browser Evidence

Files/resources:

- `tests/unit/generalizationEval.test.ts`
- `agent-context/evals/context-sufficiency-prompts.jsonl`
- `tests/e2e/features.spec.js`
- `docs/browser_generalization_verification.md`
- `docs/coworking_handoff_2026-05-31.md`

Work:

- Expand eval rows for Korean/English mixed wording, typos, wrong pins, visual-app-screen false positives, planned sensors, and unsupported high-voltage/autonomous/security requests.
- Assert each row has expected capability IDs, forbidden IDs, expected coverage status, and expected failure class.
- Keep live Deepagents browser/API smoke tests opt-in.
- Update the existing coworking handoff document with what changed, why, files touched, and verification results after execution.

## Test Plan

Unit:

- `npm test`
- `npm exec -- tsx --test tests/unit/contextCoverage.test.ts tests/unit/contextSufficiencyEval.test.ts tests/unit/contextRouting.test.ts`
- `npm exec -- tsx --test tests/unit/agentWorkflow.test.ts tests/unit/generalizationEval.test.ts`

Build/type:

- `npm run typecheck`
- `npm run build`

E2E:

- `npm run test:e2e`
- Verify Files, PCB, nonblank canvas, warnings, inspector/tutor grounding, and Run output remain covered by mocked/cached flows.

Acceptance gate:

- `npm run check`

Optional live:

- `npm run check:live` only when `OPENAI_API_KEY`, `H_EDUWARE_AGENT_MODEL`, and explicit live-test intent are present.

## Risks and Mitigations

- Risk: coverage rules become too strict and block useful clarification/unsupported responses.
  Mitigation: split coverage requirements by result type, not one global sufficiency threshold.
- Risk: visual library breadth pressures implementation into unsafe partial support.
  Mitigation: keep library-only parts browseable but not synthesizable/simulatable unless promotion audit passes.
- Risk: Deepagents repair hides validator failures.
  Mitigation: add repair-loop tests for context gaps, invented pins, missing passives, and unsupported parts.
- Risk: eval corpus becomes another fixed demo list.
  Mitigation: require prompt families, forbidden overmatches, failure classes, and multilingual/noisy variants.
- Risk: UI evidence becomes a debug console.
  Mitigation: show compact student-facing status in Files/PCB and keep raw trace in generated Markdown artifacts.

## Acceptance Criteria

- All `supportLevel: "supported"` capabilities pass `auditCapabilityCoverage()` with the full artifact bundle.
- Every `planned` or `unsupported` capability request fails coverage or routes to unsupported/clarification before Deepagents can synthesize a valid circuit.
- No valid result is returned unless coverage is sufficient for `valid_circuit_synthesis`.
- Unsupported, unsafe, and clarification responses can be response-sufficient without being synthesis-eligible.
- Deepagents tool-visible validation and final server validation cannot disagree about context coverage gating.
- No render parts or current paths are produced for unsupported/unsafe requests.
- Missing render footprints and missing simulation primitives produce deterministic warnings or invalid results, not silent fallbacks.
- Generalization eval rows cover display, light, sound, motion, digital input, analog input, sensor readout, multi-output, ambiguous, unsafe, unsupported, mixed-language, and typo-heavy families.
- Default harness passes: `npm test`, `npm run build`, `npm run test:e2e`, and `npm run check`.
- No live OpenAI call, API key, secret, or external service is required for default verification.

## Stop Conditions

- Stop implementation when the plan's acceptance criteria pass through `npm run check` and docs/handoff are updated.
- Do not promote any new hardware family to supported unless its bundle audit passes in the same change.
- Do not continue repair attempts when the blocker is missing canonical context evidence.

## Execution Handoff

Recommended default: `$ultragoal` with this plan file as context.

Parallel option: `$team` with lanes:

- Context/audit lane: `contextPacket`, `contextLayer`, agent-context data, and context coverage tests.
- Runtime/validator lane: Deepagents repair, validator, render/simulation compiler tests.
- Frontend evidence lane: Files/PCB warnings, Run blocking, stage descriptor tests.
- QA lane: generalization eval, Playwright, `npm run check`, and handoff documentation.

Suggested reasoning levels:

- Context/audit: high.
- Runtime/validator: high.
- Frontend evidence: medium.
- QA: medium.

Ralph fallback: use `$ralph` only if the user explicitly wants a single persistent executor to drive the whole plan through verification; `$ultragoal` is the preferred durable follow-up.

## Consensus Notes

- Architect review focus: validate that strict data-first support does not over-constrain clarification and unsupported routes.
- Critic review focus: reject any plan revision that lacks testable acceptance criteria for planned-part blocking, repair-loop boundaries, and default offline verification.

## Completed Twenty-Fifth Implementation Slice: Simulation Block Explanation Surfacing

Date: 2026-06-01

Scope:

- Student-facing requirement Markdown now includes `simulationPlan.warnings`, so a circuit that is logically valid but blocked by render/breadboard DRC does not show `No validated current path` without the reason.
- Server-side circuit tutor responses now cite simulation-blocking warnings when current-flow explanation is requested for an invalid simulation.
- Local frontend inspector/tutor fallback now carries `simulationPlan.status` and the first blocking warning into Run/current answers, so the default browser path can explain why current animation is blocked without relying on the network tutor endpoint.
- Tutor grounding now includes `simulation-warning:<code>` entries for blocked simulations.

Regression coverage:

- `tests/unit/agentWorkflow.test.ts`: `requirement markdown explains when render DRC blocks current simulation`.
- `tests/unit/circuitTutor.test.ts`: `tutor agent explains simulation-blocking render DRC warnings`.
- `tests/unit/circuitInspector.test.js`: `circuit tutor explains why Run is blocked by render DRC warnings`.

Target verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts tests/unit/circuitTutor.test.ts
node --test tests/unit/circuitInspector.test.js
```

Result:

- TypeScript target tests: 59 passed.
- JavaScript inspector target tests: 7 passed.

Full verification after this slice:

- `npm run check`: passed.
  - JavaScript unit tests: 65 passed.
  - TypeScript unit tests: 124 passed.
  - typecheck: passed.
  - build: passed.
  - Playwright E2E: 42 passed, 8 skipped.
- Agent server health after restart: `ok=true`, `mode=live`, `model=gpt-5.5`, `sourceStatus.stale=false`.
- Browser smoke on `http://127.0.0.1:4173/`: demo load produced one canvas, Run output appeared, live runtime badge appeared, and no raw error text or page/console errors were observed.

## Completed Twenty-Sixth Implementation Slice: Visual-Only Hardware Context Gating

Date: 2026-06-01

Scope:

- Context routing now detects part names that exist in the broad visual parts library but are not mapped to canonical agent-ready hardware.
- Visual-only mentions become explicit support gaps instead of being treated as generic ambiguity or accidentally riding along with an otherwise supported capability.
- Example: `Use an Arduino Nano to blink an LED` still matches the supported LED behavior, but it is no longer eligible for valid synthesis because `arduino-nano` is visual-only.
- Example: `ESP32 DevKit and DHT11 temperature sensor` is classified as visual-only support gaps with enough context for an unsupported/context-gap response, not a vague missing-intent prompt.
- The context packet now includes a `Visual library hardware mentions` section in the prompt block and registry trace evidence for matched visual library parts.

Regression coverage:

- `tests/unit/contextCoverage.test.ts`: `visual-only library hardware blocks otherwise supported synthesis until context is promoted`.
- `tests/unit/contextCoverage.test.ts`: `visual-only random hardware requests are explicit support gaps, not vague missing-intent prompts`.

Target verification:

```powershell
npm exec -- tsx --test tests/unit/contextCoverage.test.ts
```

Result:

- Context coverage target tests: 20 passed.

Full verification after this slice:

- Related context/generalization target tests: 35 passed.
- `npm run typecheck`: passed.
- `npm run check`: passed.
  - JavaScript unit tests: 65 passed.
  - TypeScript unit tests: 126 passed.
  - typecheck: passed.
  - build: passed.
  - Playwright E2E: 42 passed, 8 skipped.
- Agent server health after restart: `ok=true`, `mode=live`, `model=gpt-5.5`, `sourceStatus.stale=false`.
- Live endpoint smoke for `Use an Arduino Nano to blink an LED.` returned `validationStatus=unsupported`, `simulationStatus=unsupported`, no render parts, no current paths, `contextCoverage.status=insufficient`, and visual-only support warning for `arduino-nano`.

## Completed Twenty-Seventh Implementation Slice: Korean Preflight Copy Cleanup

Date: 2026-06-01

Scope:

- Korean visual-only/context-gap preflight responses now return student-facing Korean copy instead of English internal context language.
- Korean unsafe preflight responses are generated through a readable safety message instead of relying on legacy mojibake strings.
- Support-gap clarification copy is localized for Korean and explains that supported synthesis requires part information, validation rules, rendering data, and simulation data.
- The assistant message no longer exposes phrases such as `canonical context`, `validated synthesis`, or `Missing support evidence` to Korean students.

Regression coverage:

- `tests/unit/agentWorkflow.test.ts`: `Korean visual-only context gaps return student-friendly Korean copy`.
- `tests/unit/agentWorkflow.test.ts`: `Korean unsafe preflight returns readable safety copy without mojibake`.

Target verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
```

Result:

- Agent workflow target tests: 58 passed.
- Full acceptance verification: `npm run check` passed with 65 JavaScript unit tests, 128 TypeScript unit tests, production build, and 42 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- Agent server health after restart: `ok=true`, `mode=live`, `model=gpt-5.5`, `provider=openai`, `sourceStatus.stale=false`.
- Korean visual-only live smoke for `Arduino Nano로 LED를 깜빡이고 싶어.` returned `validationStatus=unsupported`, `simulationStatus=unsupported`, no render parts, no current paths, `contextCoverage.status=insufficient`, `synthesisEligibility=ineligible`, no internal English phrases, and no mojibake.
- Korean unsafe live smoke for `브레드보드로 220V 콘센트 히터를 제어하고 싶어.` returned `validationStatus=unsupported`, `simulationStatus=unsupported`, no render parts, no current paths, `contextCoverage.status=insufficient`, `synthesisEligibility=ineligible`, no internal English phrases, and no mojibake.

## Completed Twenty-Eighth Implementation Slice: Context-Bound Deepagents Part Search

Date: 2026-06-01

Scope:

- Deepagents part search is now bounded by the request-specific `ContextPacket.candidateParts`.
- The coordinator and context/validation/simulation subagents now receive the same context-bound tool options, so `search_part_capabilities` cannot expose registry parts that were not selected by routing and capability matching for the current request.
- Final server validation was already context-gated; this slice closes the earlier gap where tool-visible registry search could still show route-outside parts before finalization blocked them.
- Backward-compatible behavior remains for tests or utility calls that create tools without `candidateParts`; those calls still search the canonical registry.

Regression coverage:

- `tests/unit/agentWorkflow.test.ts`: `Deepagents part search tool is bounded to context packet candidate parts`.
  - RED failure: an OLED query returned `oled-i2c-096` even when the tool context allowed only `led-5mm` and `resistor-220`.
  - GREEN behavior: the same query can return only allowed candidate ids, and a LED query still returns `led-5mm`.

Target verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
npm run typecheck
```

Result:

- Agent workflow target tests: 59 passed.
- Typecheck: passed.
- Full acceptance verification: `npm run check` passed with 77 JavaScript unit tests, 140 TypeScript unit tests, production build, and 52 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- Agent server was restarted after the server-side source change. `/api/agent/health` reported `ok=true`, `mode=live`, `model=gpt-5.5`, `provider=openai`, and `sourceStatus.stale=false`.

## Completed Twenty-Ninth Implementation Slice: Retrieval-Plan-Bound Context Document Reads

Date: 2026-06-01

Scope:

- Deepagents `read_context_doc` is now bounded by the request-specific `ContextPacket.retrievalPlan.sourceIds`.
- The tool resolves both canonical entry ids and namespaced source ids/aliases before deciding whether a document is allowed.
- If a subagent asks for a context document outside the selected retrieval plan, the tool returns a structured `CONTEXT_DOC_NOT_IN_RETRIEVAL_PLAN` payload instead of loading the raw document.
- Live coordinator tools and all context/validation/simulation subagent tools now receive both candidate part allowlists and retrieval-plan source allowlists.

Regression coverage:

- `tests/unit/agentWorkflow.test.ts`: `Deepagents context document tool is bounded to retrieval plan source ids`.
  - RED failure: a tool configured with only `policy:safety-policy` could still read `rendering-footprints`.
  - GREEN behavior: `safety-policy` reads normally, while `rendering-footprints` returns `CONTEXT_DOC_NOT_IN_RETRIEVAL_PLAN`.

Target verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
npm run typecheck
```

Result:

- Agent workflow target tests: 60 passed.
- Typecheck: passed.
- Full acceptance verification: `npm run check` passed with 77 JavaScript unit tests, 141 TypeScript unit tests, production build, and 52 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- Agent server was restarted after the server-side source change. `/api/agent/health` reported `ok=true`, `mode=live`, `model=gpt-5.5`, `provider=openai`, and `sourceStatus.stale=false`.

## Completed Thirtieth Implementation Slice: Candidate-Part Finalization Gate

Date: 2026-06-01

Scope:

- Final server validation now rejects any `CircuitSpec` component whose `partId` was not selected into the request-specific `ContextPacket.candidateParts`.
- Deepagents tool-visible validation uses the same candidate-part gate, so `validate_circuit_spec`, render compilation, simulation compilation, and requirement markdown compilation cannot silently accept route-outside parts.
- Candidate-part mismatch is treated as a context boundary error, not a repairable wiring mistake. The repair loop stops on `CONTEXT_CANDIDATE_PART_NOT_ALLOWED` instead of consuming more drafts.
- Part capability scoring no longer treats very short tokens such as `led` as arbitrary substrings inside longer words such as `oled`. This prevents simple LED requests from pulling OLED into `candidateParts` through substring overmatch.

Regression coverage:

- `tests/unit/agentWorkflow.test.ts`: `route-outside candidate parts in an agent draft are blocked before repair or render`.
  - RED failure: a LED request with an unrequested OLED component did not stop cleanly and tried to enter the repair loop.
  - GREEN behavior: the final result is invalid, no render plan or current paths are produced, and no `validation-repair` event is emitted.

Target verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
npm run typecheck
```

Result:

- Agent workflow target tests: 61 passed.
- Typecheck: passed.
- Full acceptance verification: `npm run check` passed with 77 JavaScript unit tests, 142 TypeScript unit tests, production build, and 52 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- Agent server was restarted after the server/context source change. `/api/agent/health` reported `ok=true`, `mode=live`, `model=gpt-5.5`, `provider=openai`, and `sourceStatus.stale=false`.

## Completed Thirty-First Implementation Slice: Candidate-Gated Fault Detection Tool

Date: 2026-06-01

Scope:

- Deepagents `detect_faults` now uses the same `ContextPacket.candidateParts` gate as validation, render compilation, simulation compilation, requirement markdown compilation, and finalization.
- Route-outside parts are reported as `CONTEXT_CANDIDATE_PART_NOT_ALLOWED` before the tool reports ordinary wiring faults, so subagents cannot reinterpret an unselected part as merely a fixable electrical issue.
- The fault-detection path still applies the context-coverage gate after candidate-part gating.

Regression coverage:

- `tests/unit/agentWorkflow.test.ts`: `Deepagents detect_faults tool applies the same candidate part gate`.
  - RED failure: a LED-scoped tool context with an unrequested OLED component returned only `MISSING_COMMON_GROUND`.
  - GREEN behavior: the same draft returns `CONTEXT_CANDIDATE_PART_NOT_ALLOWED` and no validated current path ids.

Target verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
npm run typecheck
npm run check
```

Result:

- Agent workflow target tests: 62 passed.
- Typecheck: passed.
- Full acceptance verification: `npm run check` passed with 77 JavaScript unit tests, 143 TypeScript unit tests, production build, and 52 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- Agent server was restarted after the server-side source change. `/api/agent/health` reported `ok=true`, `mode=live`, `model=gpt-5.5`, `provider=openai`, and `sourceStatus.stale=false`.

## Completed Thirty-Second Implementation Slice: Authoritative Current-Path Validation

Date: 2026-06-01

Scope:

- Deepagents `estimate_current_paths` no longer trusts a caller-supplied `validationReport`.
- The tool always reruns server-side `validateWithContext(spec)` before producing educational current paths.
- This closes a current-simulation trust gap where an agent could pass a forged `valid` report and receive current paths for a route-outside or otherwise invalid circuit draft.
- The optional `validationReport` input remains accepted for backward-compatible tool-call shape, but it is not authoritative.

Regression coverage:

- `tests/unit/agentWorkflow.test.ts`: `Deepagents current path tool does not trust caller-supplied validation reports`.
  - RED failure: a LED-scoped candidate context plus an unrequested OLED component returned LED and OLED current paths when the tool received a forged `status: "valid"` report.
  - GREEN behavior: the same tool call returns no current paths because authoritative server validation applies candidate/context gates first.

Target verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
npm run typecheck
npm run check
```

Result:

- Agent workflow target tests: 63 passed.
- Typecheck: passed.
- Full acceptance verification: `npm run check` passed with 77 JavaScript unit tests, 144 TypeScript unit tests, production build, and 52 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- Agent server was restarted after the server-side source change. `/api/agent/health` reported `ok=true`, `mode=live`, `model=gpt-5.5`, `provider=openai`, and `sourceStatus.stale=false`.

## Completed Thirty-Third Implementation Slice: Validation-Gated Netlist Tool

Date: 2026-06-01

Scope:

- Deepagents `build_netlist` no longer exposes nets for invalid, unsupported, context-insufficient, or candidate-disallowed drafts.
- The tool now runs the same authoritative `validateWithContext(spec)` boundary before returning a netlist.
- Invalid tool calls return `{ error: "NETLIST_BLOCKED_BY_VALIDATION", validationReport, netlist: { nets: [] } }`.
- This keeps subagents from treating route-outside wiring as a usable intermediate artifact before final validation.

Regression coverage:

- `tests/unit/agentWorkflow.test.ts`: `Deepagents netlist tool blocks route-outside components before exposing nets`.
  - RED failure: a LED-scoped candidate context with unrequested OLED wiring returned raw OLED nets.
  - GREEN behavior: the same call returns `NETLIST_BLOCKED_BY_VALIDATION`, cites `CONTEXT_CANDIDATE_PART_NOT_ALLOWED`, and exposes an empty netlist.

Target verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
npm run typecheck
npm run check
```

Result:

- Agent workflow target tests: 64 passed.
- Typecheck: passed.
- Full acceptance verification: `npm run check` passed with 77 JavaScript unit tests, 145 TypeScript unit tests, production build, and 52 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- Agent server was restarted after the server-side source change. `/api/agent/health` reported `ok=true`, `mode=live`, `model=gpt-5.5`, `provider=openai`, and `sourceStatus.stale=false`.

## Completed Thirty-Fourth Implementation Slice: Invalid Requirement Markdown Build Guard

Date: 2026-06-01

Scope:

- Requirement Markdown now treats `validationReport.status !== "valid"` as non-build-ready.
- Invalid, unsupported, context-insufficient, or candidate-disallowed drafts no longer list concrete parts or point-to-point wiring in the Files tab as if the student can assemble them.
- The document still keeps the student-visible goal, intended behavior, validation errors, warnings, and assumptions so the student can understand what must be fixed before build/render/run.
- This closes a final artifact loophole where render and simulation were already gated, but the requirement document could still expose invalid wiring such as `arduino-uno:D99 -> resistor-1:1`.

Regression coverage:

- `tests/unit/agentWorkflow.test.ts`: `requirement markdown does not present invalid wiring as build ready`.
  - RED failure: an invalid LED draft with an invented Arduino pin still produced `Parts Needed` and `Connections` sections containing buildable-looking wiring.
  - GREEN behavior: the same document says `No build-ready parts` and `No build-ready wiring`, keeps `UNKNOWN_PIN`, and suppresses invalid endpoint wiring.

Target verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
npm run check
```

Result:

- Agent workflow target tests: 65 passed.
- Full acceptance verification: `npm run check` passed with 77 JavaScript unit tests, 146 TypeScript unit tests, typecheck, production build, and 52 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- Agent server was restarted after the server-side source change. `/api/agent/health` reported `ok=true`, `mode=live`, `model=gpt-5.5`, `provider=openai`, and `sourceStatus.stale=false`.

## Completed Thirty-Fifth Implementation Slice: Invalid Assistant Message Grounding

Date: 2026-06-01

Scope:

- Final assistant copy is now grounded to server validation when `validationReport.status === "invalid"`.
- If a live Deepagents draft claims the circuit is valid, ready to build, or includes unrelated hardware, but deterministic validation blocks the draft, the API no longer returns that overconfident LLM text to the student.
- The replacement message is locale-aware and explains that H-eduware could not safely finalize the circuit, then summarizes the validation failure in student-facing language.
- Valid and server-generated unsupported/preflight messages keep their existing assistant copy.

Regression coverage:

- `tests/unit/agentWorkflow.test.ts`: `invalid final validation replaces overconfident assistant draft copy`.
  - RED failure: a route-outside OLED component in an LED request returned the raw draft message `This circuit is valid and ready to build...`.
  - GREEN behavior: the final message says validation blocked safe finalization and suppresses the overconfident draft copy.

Target verification:

```powershell
npm exec -- tsx --test tests/unit/agentWorkflow.test.ts
npm run typecheck
npm run check
```

Result:

- Agent workflow target tests: 66 passed.
- Typecheck: passed.
- Full acceptance verification: `npm run check` passed with 77 JavaScript unit tests, 147 TypeScript unit tests, typecheck, production build, and 52 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- Agent server was restarted after the server-side source change. `/api/agent/health` reported `ok=true`, `mode=live`, `model=gpt-5.5`, `provider=openai`, and `sourceStatus.stale=false`.

## Completed Thirty-Sixth Implementation Slice: Invalid Share Card Footer Guard

Date: 2026-06-01

Scope:

- Public share card metadata no longer claims invalid snapshots were validated.
- `createShareCardModel()` now derives the footer from the public validation status, matching the existing badge behavior.
- Valid cards keep the "Designed, validated, and shared with H-eduware" footer.
- Warning cards say they were shared with validation warnings.
- Invalid cards say they are drafts needing review and avoid the word "validated" entirely.

Regression coverage:

- `tests/unit/shareCard.test.js`: `createShareCardModel does not claim invalid snapshots were validated`.
  - RED failure: an invalid snapshot still produced the footer `Designed, validated, and shared with H-eduware`.
  - GREEN behavior: the invalid card badge remains `Needs review`, and the footer says the card is a draft needing review.

Target verification:

```powershell
node --test tests/unit/shareCard.test.js
npm run check
```

Result:

- Share card target tests: 3 passed.
- Full acceptance verification: `npm run check` passed with 78 JavaScript unit tests, 147 TypeScript unit tests, typecheck, production build, and 52 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- No agent server restart was required because this slice only changed frontend share-card code and unit tests.

## Completed Thirty-Seventh Implementation Slice: Invalid Shared Import Markdown Guard

Date: 2026-06-01

Scope:

- Imported invalid public share snapshots no longer reuse raw `snapshot.requirementMarkdown` as if it were build-ready documentation.
- `projectFromShareSnapshot()` now treats a share as build-ready only when the public snapshot status, validation status, and simulation availability all agree.
- Non-build-ready imports get a generated review document that states the share is not validated for assembly/render/current simulation and lists validation warnings or unsupported items.
- This keeps the Files tab from showing stale public wiring instructions such as `arduino-uno:D99 -> led-1:A` after the imported snapshot is marked invalid.

Regression coverage:

- `tests/unit/shareImport.test.js`: `projectFromShareSnapshot suppresses build-ready markdown for invalid shares`.
  - RED failure: an invalid shared snapshot with raw markdown saying `This circuit is ready to assemble` and `arduino-uno:D99 -> led-1:A` was imported unchanged into the Files tab.
  - GREEN behavior: the imported markdown says the shared circuit is not validated/non-running, preserves `UNKNOWN_PIN`, and suppresses the raw build-ready connection instructions.

Target verification:

```powershell
node --test tests/unit/shareImport.test.js
npm run check
```

Result:

- Share import target tests: 3 passed.
- Full acceptance verification: `npm run check` passed with 79 JavaScript unit tests, 147 TypeScript unit tests, typecheck, production build, and 52 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- No agent server restart was required because this slice only changed frontend share-import code and unit tests.

## Completed Thirty-Eighth Implementation Slice: Invalid Shared Import Render Guard

Date: 2026-06-01

Scope:

- Imported invalid public share snapshots no longer pass renderable PCB data into the local project.
- `projectFromShareSnapshot()` now uses the same build-ready boundary for parts, connections, floating cards, requirement markdown, and current-flow availability.
- Build-ready still means all three public signals agree: snapshot status is `valid`, validation status is `valid`, and simulation is available.
- Non-build-ready imports remain inspectable as drafts, but their PCB parts, wiring, floating cards, and current-flow replay data are hidden.
- The PCB tab receives a visible `SHARED_SNAPSHOT_NOT_BUILD_READY` render warning so the student understands why no assembly visualization is shown.

Regression coverage:

- `tests/unit/shareImport.test.js`: `projectFromShareSnapshot blocks renderable PCB data for invalid shares`.
  - RED failure: an invalid public snapshot still imported `renderPlan.parts` and `renderPlan.connections`, so PCB could display the draft like a real assembled circuit.
  - GREEN behavior: the same invalid snapshot imports with empty `parts`, `connections`, and `floatingCards`, plus a review warning.
- Existing invalid import coverage was updated so `projectFromShareSnapshot keeps invalid shared circuits as non-running drafts` now expects hidden PCB data.

Target verification:

```powershell
node --test tests/unit/shareImport.test.js
npm run check
```

Result:

- Share import target tests: 4 passed.
- Full acceptance verification: `npm run check` passed with 80 JavaScript unit tests, 147 TypeScript unit tests, typecheck, production build, and 52 Playwright E2E tests passed. 8 opt-in live E2E tests were skipped.
- No agent server restart was required because this slice only changed frontend share-import code and unit tests.

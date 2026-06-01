# H-eduware Context Layer Sufficiency Audit

## Purpose

This audit checks whether the current Context Layer is sufficient for the app's stated purpose:

> Let students ask diverse, unpredictable hardware questions and receive grounded, safe, validated, visualized, and simulated circuit guidance.

The answer today is:

> The Context Layer is structurally correct but not yet sufficient for broad student-query generalization.

The current layer is strong enough to ground a small starter-kit vertical slice. It is not yet broad or detailed enough to support arbitrary beginner hardware requests without either refusing too often or relying on model priors.

## Current Strengths

### 1. Good Layer Structure

The repository already has the right context categories:

- always-loaded memory
- policies
- references
- registry data
- ontology
- simulation docs
- rendering docs
- eval fixtures
- skills
- schemas

This is the correct shape for a Deepagents-compatible context layer.

### 2. Canonical Starter Registry

The current `part-capabilities.json` is useful for:

- Arduino Uno
- breadboard
- I2C OLED
- LED
- 220 ohm resistor
- tactile button
- piezo buzzer
- micro servo
- jumper wire

These entries include aliases, pins, electrical limits, protocols, render footprints, and simulation models.

### 3. Safety And Validation References Exist

The context layer includes safety, unsupported-request, validation, simulation-truthfulness, and electrical-limit policies. This is important because the correct behavior for many student requests is not synthesis but clarification or refusal.

### 4. Context Is Now Forced Into The Agent

The server now builds a request-specific context packet before Deepagents synthesis. The API response now carries `contextTrace`, so we can inspect whether a generated result was grounded in registry/policy/reference evidence.

### 5. Structured Intent Is Now Preserved Before Synthesis

The context packet now includes `IntentSpecV2`, which records the student goal, behavior trigger/action, input and output modalities, controller and power assumptions, ambiguity, safety signals, unsupported signals, language, and confidence. This reduces the risk that the agent collapses diverse student wording into a fixed hardware demo category before capability matching.

## Main Insufficiencies

### 1. Hardware Coverage Is Too Narrow

The visual part library contains many more real components than the agent-context canonical registry. Examples visible in the frontend library but not sufficiently modeled in the agent context include:

- potentiometer
- ultrasonic distance sensor
- DHT11/DHT22 temperature and humidity sensors
- LCD 16x2 / LCD 20x4
- photoresistor
- relay modules
- DC motors
- motor drivers
- RGB LEDs
- 7-segment displays
- neopixels / addressable LEDs
- tilt sensors
- IR receiver/transmitter
- transistor switching circuits

If a student asks for these, the model may know them from pretraining, but the app does not have enough canonical context to validate, render, or simulate them safely.

### 2. Part Capability Schema Is Too Shallow

Current part capabilities include basic pins and limits, but broad generalization needs more:

- functional capabilities
- compatible controller pins
- required topology patterns
- forbidden topology patterns
- required passive components with placement rules
- breadboard placement constraints
- simulation primitive ids
- render footprint anchor ids
- common student mistakes
- safe substitutions
- prerequisite concepts
- confidence and support level

Without these, the agent can match parts but cannot robustly synthesize unfamiliar but valid combinations.

### 3. Pin Alias Ontology Is Underused

The context layer has pin alias files, but the current validator still primarily checks exact pin names from the canonical part registry.

For student queries, the system must robustly normalize:

- `SDA`, `A4`, `data`
- `SCL`, `A5`, `clock`
- `VCC`, `VIN`, `5V`, `+`
- `GND`, `ground`, `-`, `0V`
- Korean variants such as `전원`, `접지`, `신호`, `데이터`, `클럭`

This should be a deterministic resolver, not a model-only behavior.

### 4. Simulation Context Is Not Primitive-Rigorous Yet

The context layer has `simulation/primitives.json`, but primitives are too high-level. They do not yet define:

- required net roles
- accepted part kinds
- state update rule
- UI control requirements
- warning conditions
- unsupported boundaries
- expected render overlays

Because of this, simulation still tends to become part-specific code instead of reusable behavior composition.

Current path construction is improved: run-capable primitives now define machine-readable `currentPathRecipe.pathTemplate` and `pathTemplates`, and deterministic current path estimation consumes those templates for path id, semantic kind, label, source endpoint strategy, through segments, return endpoint strategy, optional current estimate override, and animation defaults. Multi-path composition now works for servo behavior, where supply current and PWM signal activity are represented separately. Primitive contracts also now model planned sensor-display and analog-threshold behavior with distinct supply, signal, bus, sensing-divider, and output-load paths. The remaining simulation gap is not the primitive shape; it is promoting those planned families only after registry, validation, rendering, and eval coverage are complete.

### 5. Rendering Context Is Anchored But Not Yet Fully Generic

Render footprint data now includes starter pin anchors and the render compiler can emit endpoint coordinates from those anchors. Generalized visualization still needs:

- breadboard row/rail constraints
- component orientation rules
- wire entry points
- collision and spacing hints
- label/floating-card anchors
- simulation overlay anchors
- richer physical placement for all supported footprints

Without this, validated circuits can fail at the visualization layer.

### 6. Eval Corpus Does Not Yet Measure Generalization

The eval structure now includes a first prompt-family context sufficiency corpus, but it should keep expanding beyond the starter set:

- paraphrases
- typo-heavy student language
- Korean/English mixed wording
- incomplete prompts
- wrong pin names
- missing resistor
- missing ground
- unsafe power
- unsupported hardware
- multiple-output projects
- input-output conditional projects

Passing one OLED prompt is not evidence of generalization. The new prompt-family eval is a starting guardrail: it checks supported starter requests, planned sensor gaps, unsupported autonomous/security/high-voltage requests, and ambiguous requests.

### 7. Context Trace Now Feeds Initial Coverage Scoring

`contextTrace` now feeds an initial `contextCoverage` report. The report records:

- required source categories for the matched request
- present source categories from the actual trace
- missing source categories
- a normalized score
- warnings for planned, unsupported, ambiguous, or under-grounded results

This is an important shift: the agent is no longer merely returning citations after the fact. The server can now reason about whether the context packet was sufficient for the proposed result. The first implementation also caught an overmatch where a display/OLED token could pull a distance-sensor capability without distance-sensor evidence; the matcher now treats generic display terms such as OLED or screen as generic output evidence, not as sensor evidence.

Remaining gaps:

- Coverage is not yet a hard validity gate everywhere.
- Coverage thresholds are not yet tuned per result type: valid, clarification, unsupported.
- Coverage is not yet aggregated into a prompt-family eval dashboard.
- The student UI shows evidence, but still needs a clearer distinction between student-facing grounding and developer-facing diagnostics.

## Required Context Layer Expansion

### A. Capability Graph

Add a machine-readable capability graph:

```json
{
  "capabilityId": "analog-voltage-divider-input",
  "studentPhrases": ["knob", "dial", "adjust", "potentiometer", "가변저항", "다이얼"],
  "requiredParts": ["arduino-uno", "potentiometer-10k"],
  "requiredPins": ["power", "ground", "analog-input"],
  "compatibleSimulationPrimitives": ["analog_voltage_divider"],
  "compatibleRenderFootprints": ["potentiometer"],
  "commonMistakes": ["wiper not connected", "power and ground swapped"],
  "supportLevel": "planned"
}
```

### B. Support Level Metadata

Every part and capability should declare:

- `supported`: validated, rendered, and simulated
- `partial`: can be explained or rendered, but not fully simulated
- `unsupported`: must clarify/refuse
- `planned`: visible in library but not agent-ready

This prevents silent hallucination.

Support-level promotion is now backed by a deterministic bundle audit. A capability can be considered ready for supported behavior only when the same context layer includes its capability graph entry, required part registry entries, pin aliases, deterministic validation rules, simulation primitives, render footprints, supported eval prompt, and unsupported counterexample. If any artifact is missing, the capability remains a context gap rather than a valid circuit target.

### C. Simulation Primitive Contracts

Each primitive should define:

- `id`
- `requiredNetRoles`
- `requiredComponentKinds`
- `validationRules`
- `currentPathRecipe`
- `currentPathRecipe.pathTemplate` for current-producing primitives
- `currentPathRecipe.pathTemplates` for primitives with separate supply, signal, sensing, or output-load paths
- `expectedStateRecipe`
- `uiControls`
- `renderOverlays`
- `limitations`

### C2. Topology Templates

Status: initial implementation complete for the starter slice.

The context layer now includes `agent-context/electrical/topology-templates.json`, which defines reusable role-based circuit structures for:

- controller to I2C module
- controller digital output through a series current limit
- controller switch input plus protected output
- controller direct low-current output load
- controller PWM actuator

Capabilities now expose `requiredRoles`, and the server can select a topology template from those roles. This keeps the roadmap aligned with circuit structure rather than a fixed OLED, LED, button, buzzer, or servo order.

### D. Render Footprint Anchors

Each footprint should define:

- part body dimensions
- visual style: mesh shape, color, and material intent
- pin anchor names
- anchor coordinates
- breadboard compatibility
- default orientation
- label anchor
- hover target geometry

Status update: starter footprints now include `hoverTargets` for body-level and pin-level inspector grounding. The render compiler also emits structured warnings when a validated component lacks a footprint, and the frontend surfaces those warnings in Files and PCB views.

### E. Context Coverage Tests

Add tests that fail when:

- a supported part has no render footprint
- a supported part has no simulation primitive
- a render footprint has no pin anchors
- a simulation primitive lacks validation rules
- a part alias conflicts with another part
- a support-level mismatch exists
- a context index entry points to a missing file

## Priority Gaps To Fill Next

### P0: Context Trace Enforcement

Status: initial implementation complete. `ContextPacket` now includes `contextCoverage`, and `AgentRunResult` exposes the same coverage report alongside `contextTrace`. The first hard gate is also implemented: otherwise-valid circuits are downgraded before render/simulation compilation when coverage is insufficient.

Remaining work:

- show trace and coverage more clearly in UI without turning the student experience into a debug console
- require trace categories by result status
- aggregate coverage scores in the generalization eval corpus
- tune coverage expectations separately for valid, clarification, unsupported, and unsafe results

### P0.5: Bounded Validation Repair

Status: initial implementation complete.

The Deepagents runtime now retries at most once when a draft fails deterministic validation. The second prompt receives the exact validation errors and the same forced context packet. This is intentionally not a context-gap repair mechanism: if context coverage is insufficient, the system should report the missing canonical evidence instead of asking the model to invent its way around the gap.

Implemented safeguards:

- repair attempts are capped at two total drafts
- repair events are visible in `AgentRunResult.agentEvents`
- exhausted repairs return the final invalid result with `validation-repair-exhausted`
- the server does not mutate an invalid draft into a valid one outside deterministic validation and compilation
- no-network scripted tests prove that a third valid draft is not consumed after two invalid attempts

### P1: Capability Graph And Support Levels

Status: initial implementation complete. The matcher now suppresses overbroad matches from generic infrastructure words such as Arduino, breadboard, wire, current, and flow. It also requires input-specific evidence before matching sensor, analog, button, and other input-driven capabilities, so a simple LED/resistor request is not misclassified as a light-sensor gap. It also includes planned sensor capabilities and unsupported autonomous/security capabilities so the agent can cite a context gap instead of relying on model priors. The capability graph now also carries explicit retrieval metadata: positive phrases, required evidence, negative evidence, and per-capability minimum score.

Why:

- It stops the product from becoming demo-order driven.
- It lets the agent reason over capabilities rather than examples.
- It creates a clean boundary between known, partial, planned, and unsupported hardware.

Implemented scoring improvements:

- Matching now computes a normalized score from positive phrase hits, required evidence hits, modality evidence, negative evidence, and `minimumScore`.
- Single-token evidence uses exact token matching, so `led` no longer matches the `oled` substring.
- Negative evals now prevent app-screen/current-flow wording from being treated as a hardware OLED/display request.
- `auditCapabilityCoverage()` now enforces the support-level promotion bundle: capability graph, required part capabilities, pin aliases, validation-rule support, simulation primitives, render footprints, supported eval prompt, and unsupported counterexample.
- Incomplete planned capabilities are now measurable as specific gaps. For example, `analog-led-dimmer` is blocked because `potentiometer-10k`, render-footprint coverage, validation-rule support, and eval evidence are not complete.

Remaining gap:

- Retrieval is still lightweight deterministic scoring, not semantic retrieval. It needs broader Korean-normalized phrase coverage, typo-heavy prompt coverage, score telemetry, and per-family threshold tuning.

### P2: Pin Alias Resolver

Status: initial implementation complete.

Why:

- Student language rarely uses canonical pin names.
- This is a deterministic normalization task.
- It reduces model burden and hallucination risk.

### P3: Simulation Primitive Contracts

Status: initial context contract implemented and deterministic artifacts now cite the selected primitive. Run-capable primitives now include machine-readable current path templates, and the current path compiler consumes template metadata instead of hardcoding path id, semantic kind, label, source, return, through segments, current estimate override, and animation defaults. The current semantic vocabulary now distinguishes `load-current`, `supply-current`, `signal-activity`, `bus-activity`, `sensing-divider`, and `fault-current`. The servo primitive now uses multiple templates so supply current and PWM signal activity stay separate in simulation artifacts and requirement markdown. Sensor-display and analog-threshold primitives now define their multi-path semantics at the contract level.

The simulation compiler now filters current paths through deterministic `validatedCurrentPathIds` and known simulation primitive ids before returning animation paths. This prevents an LLM or future tool from attaching unvalidated or unsupported paths to the Run tab.

Why:

- Current simulation is still too part-specific.
- Generalized hardware behavior requires reusable simulation semantics.

Remaining gap:

- Planned families that require multiple simultaneous paths, such as analog sensing plus output load or sensor plus display supply, still need registry, validation, render footprints, interaction controls, and visual evals before they can be promoted from planned to supported.

### P4: Render Anchor Catalog

Status: initial context catalog implemented for supported starter footprints. The render compiler and three.js endpoint resolver now consume the catalog for generated wire endpoint coordinates. `RenderPlan.parts` carry footprint metadata from the context layer, and the stage uses those footprint dimensions plus `visualStyle.shape`, `visualStyle.color`, and `visualStyle.material` for generic part descriptors. The stage also renders non-OLED parts from `RenderPlan.parts`, and no longer injects OLED or library-only sensor/motor models unless the active render plan declares them. Starter footprints now expose `hoverTargets`, and stage descriptors carry them forward for inspector/tutor grounding. Missing visual footprints now produce `RenderPlan.warnings` rather than silent visual overclaiming.

Why:

- Even validated circuits are not useful if students cannot inspect the visual wiring.
- Generic 3D rendering depends on pin anchors, not just dimensions.

Remaining gap:

- Richer placement, collision handling, camera framing, nested hover sub-target geometry, and generalized wire routing still need to consume the footprint catalog systematically for arbitrary layouts.

### P5: Target-Grounded Tutor Contract

Status: initial implementation complete.

The tutor endpoint now requires the selected target and active circuit artifacts instead of answering from target prose alone. Its grounding list includes validation status, simulation status, validated current path ids, simulation current path ids, and context trace source ids. This closes the main loophole where a tutor could discuss current flow without knowing whether the current path had actually been validated.

Remaining gap:

- The tutor still uses deterministic artifact summaries rather than retrieving and quoting the full matching context docs on demand. That is acceptable for the current offline-safe harness, but live Deepagents tutor mode should later use the hierarchical context routing layer to read only the exact docs behind the cited source ids.

### P6: Hierarchical Context Routing

Status: initial implementation complete.

The context layer now has a route map and retrieval budget instead of relying only on folder hierarchy. `loadContextIndex()` exposes enriched source metadata including namespaced source IDs, aliases, levels, source types, tags, provided artifact types, load conditions, canonical status, and budget class.

`ContextPacket` now includes `contextRoute` and `retrievalPlan`. This makes it possible to prove that a request loaded the exact source IDs it needed, not just a broad source type. Supported hardware routes can load registry, validation, rendering, and simulation sources; ambiguous and unsupported routes intentionally avoid heavy render and simulation catalogs.

Remaining gap:

- Routing is deterministic and capability-driven. Later live tutor and coordinator flows should use the same route metadata for on-demand document reads and should emit retrieval telemetry for failure analysis.

### P7: Generalization Eval Harness

Status: initial implementation complete.

`npm run eval:generalization` now checks the context sufficiency corpus against required prompt families and failure taxonomy. The corpus covers supported output families, input-driven behavior, planned context gaps, multi-output requests, ambiguous prompts, unsafe and unsupported requests, mixed-language phrasing, and typo-heavy wording.

Remaining gap:

- The eval harness currently verifies context routing and classification. It should later score full live Deepagents synthesis quality, visual rendering, tutor grounding, and Run-tab simulation behavior per family.

### P8: Browser Product-Experience Verification

Status: initial implementation complete.

`docs/browser_generalization_verification.md` now defines the browser verification protocol. Default E2E includes an offline-safe product-experience check covering Files, PCB rendering, nonblank canvas evidence, wire and part selection, inspector tutor chat, Run output, and visible secret redaction. Live Deepagents E2E remains opt-in and now also checks that the generated Context trace file exposes Coverage status.

Remaining gap:

- The default browser test still uses the demo circuit for reliability. Full family-by-family visual verification should be added after supported hardware families can be generated deterministically or through stable live-eval fixtures.

### P9: Student-Facing Context Evidence

Status: initial implementation complete.

Agent-created projects now carry `contextCoverage` into the active circuit model and show a compact evidence panel in the Files tab. The panel gives students a short status, score, source-type summary, and warnings while keeping raw trace details in the generated Context trace Markdown file.

Remaining gap:

- The panel summarizes source types, not source-specific teaching explanations. Later iterations should translate key source IDs into learner-friendly reasons per selected route.

## Conclusion

The current Context Layer is enough for a grounded starter slice, and it now has the first forced grounding path from request context to primitive-backed simulation and anchor-backed wire endpoints. It also has an initial context coverage report and context sufficiency eval that prevent obvious overclaiming for planned sensors, generic display overmatches, and unsupported autonomous/security requests. It is still not enough for the full product ambition.

Data-first expansion rule:

No hardware family can move from `planned` to `supported` unless the same change includes capability graph entry, canonical part registry, pin aliases, electrical validation rule, simulation primitive, render footprint, supported eval prompt, unsupported counterexample, and browser-visible verification.

Regression tests may use concrete hardware cases, but the roadmap must not be expressed as a fixed hardware order. A hardware case is a probe of pipeline capability, not a product objective.

The next implementation should not add another isolated hardware demo. It should add the missing context infrastructure:

1. Capability graph.
2. Support-level metadata.
3. Pin alias resolver.
4. Simulation primitive contracts.
5. Render footprint anchors.
6. Context coverage gates.
7. Prompt-family eval metrics and failure taxonomy.

The next expansion should add new hardware families only when registry, capability graph, primitive contracts, footprint anchors, validation rules, and evaluation prompts are added together.

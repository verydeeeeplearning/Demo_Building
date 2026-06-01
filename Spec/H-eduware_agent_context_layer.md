# H-eduware Agent Context Layer Requirements

> **What this document is:** A rigorous specification for the context layer H-eduware needs before Deep Agents can reliably interpret diverse student requirements, synthesize circuits, validate safety, simulate current flow, and explain results.
>
> **Relationship to other documents:**
> - `Spec/H-eduware_master_statement.md` defines the original hackathon demo and current product identity.
> - `Spec/H-eduware_deepagents_v2_requirements.md` defines the v2 Deep Agents expansion.
> - This document defines the knowledge, data, policy, and evaluation context those agents and deterministic tools need.
>
> **Created:** 2026-05-31
> **Status:** Draft context architecture requirements

---

## 1. Executive Summary

Deep Agents will not make H-eduware reliable by themselves.

Agent reliability depends on whether the right context is available in the right form, at the right time, with the right authority level. H-eduware needs a layered context system that separates:

1. Always-loaded constitutional rules.
2. On-demand human-readable policies.
3. Machine-readable schemas.
4. Machine-readable part and capability registries.
5. Deterministic validation rules.
6. Electrical/current simulation models.
7. Rendering and simulation contracts.
8. Prompt and evaluation corpora.
9. Runtime student/session context.
10. Long-term user preferences.

The core rule is:

```text
Markdown can guide agent judgment.
Schemas and registries define allowed facts.
Deterministic tools decide validity.
Evaluations measure whether the system works.
```

If H-eduware only gives agents broad Markdown instructions, agents will hallucinate plausible circuits. If H-eduware only gives agents JSON registries without policies, agents will make technically valid but pedagogically poor choices. The context layer must combine both.

---

## 2. Why A Context Layer Is Required

H-eduware v2 must handle unpredictable student requests.

Examples:

- "Make something that turns on when it gets dark."
- "Can I know if my plant needs water?"
- "Make a door alarm."
- "Show temperature on a screen."
- "Make my robot stop before it hits something."
- "Can I control a real wall outlet?"

These requests require more than text generation. The agent must know:

- What the student likely means.
- Which electronics concepts are involved.
- Which parts can sense or act.
- Which pins can connect.
- Which electrical paths are safe.
- Whether current can flow.
- Whether a resistor, driver, pull-up, or common ground is required.
- Which behaviors can be simulated.
- Which requests must be refused or reframed.
- How to explain all of this to a learner.

Without a rigorous context layer, a Deep Agent may:

- Invent unavailable parts.
- Connect incompatible pins.
- Omit a current-limiting resistor.
- Treat a behavior animation as real electrical validation.
- Provide unsafe high-voltage guidance.
- Ask unnecessary category questions.
- Overfit to the old OLED demo.
- Produce a circuit that cannot be rendered by the frontend.
- Produce a simulation plan that the Run UI cannot execute.

---

## 3. Context Engineering Principles

The context layer must follow these principles.

### 3.1 Authority Separation

Not all context is equally authoritative.

Authority order:

1. Safety policy.
2. Deterministic validator output.
3. Machine-readable schemas.
4. Part/electrical/simulation registries.
5. Product requirements.
6. Pedagogy and copy policy.
7. Agent reasoning and suggestions.

An agent may not override validator output because a generated explanation sounds plausible.

### 3.2 Minimal Always-Loaded Context

Always-loaded memory must be small. It should contain only the rules that every agent invocation must obey.

Examples:

- Do not bypass deterministic validation.
- Do not give mains-voltage wiring instructions.
- Do not render unvalidated circuit specs.
- Use tools for current, voltage, and safety claims.
- Ask one clarification question at a time.

Large domain explanations must not be loaded into every prompt. They should live in on-demand files, skills, registries, or tools.

### 3.3 Machine-Readable Facts Beat Narrative Facts

If a fact affects correctness, it must exist in a machine-readable registry or schema.

Examples:

- LED forward voltage.
- Arduino GPIO current limit.
- Whether a motor needs a driver.
- Whether a pin supports PWM.
- Whether a behavior primitive can be simulated.

Markdown may explain these facts, but validators and tools must use structured data.

### 3.4 Context Retrieval Must Be Intentional

The agent should not ingest every context file at startup.

The coordinator should read an index and then retrieve specific files or call specific tools based on the task.

Example:

```text
Student asks about "plant is dry"
  -> read intent-primitives.md if needed
  -> query capabilities for moisture sensing
  -> query simulation primitives for threshold alerts
  -> validate with electrical and safety tools
```

### 3.5 Subagent Context Isolation

Specialist subagents must receive only the context needed for their job.

Examples:

- Intent Analyst needs intent primitives and clarification policy.
- Circuit Synthesizer needs part capability registry and circuit schema.
- Constraint Validator needs validation tools and rulebook.
- Lesson Explainer needs pedagogy policy and validated circuit summary.

The main coordinator should receive concise results, not every intermediate lookup.

### 3.6 No Silent Defaults For Safety-Critical Gaps

If missing information affects safety or correctness, the agent must not silently choose a default.

Examples:

- Unknown voltage source.
- High-current motor without driver information.
- AC/mains request.
- Unknown LED resistor requirement.
- Sensor requiring calibration for a threshold behavior.

The system must ask a clarification question or choose a safe low-voltage abstraction.

---

## 4. Current Codebase Context Loopholes

This section evaluates the current H-eduware source against the context needed for Deep Agents v2.

### 4.1 Part Registry Is Visual, Not Electrical

Current state:

- `src/partLibraryData.js` contains a large local part list.
- Each part has category, description, pins, and a `model` recipe for rendering.

Loophole:

- It does not provide enough electrical or behavioral metadata for agentic circuit generation.

Missing:

- Voltage ranges.
- Current limits.
- Pin electrical type.
- Pull-up/pull-down needs.
- Current-limiting resistor requirements.
- Motor driver requirements.
- Logic voltage compatibility.
- Sensor output type.
- Simulation capability.
- Beginner safety notes.
- Compatible controller pins.

Risk:

An agent may select a part because its description sounds relevant but fail to wire it safely or simulate it correctly.

### 4.2 Legal Connection Logic Is Demo-Specific

Current state:

- `src/circuitMetadata.js` defines four legal OLED demo connections.
- `isLegalConnection()` checks only whether an endpoint pair appears in the fixed demo connection list.

Loophole:

- There is no generalized compatibility model for arbitrary circuits.

Missing:

- Signal role compatibility.
- Voltage domain compatibility.
- Directionality.
- Required supporting components.
- Net-level validation.
- Multi-part bus validation.
- Shared ground requirements.

Risk:

Deep Agents may generate circuits that pass shape validation but are electrically nonsensical.

### 4.3 Behavior Simulation And Electrical Simulation Are Not Separated

Current state:

- The current Run path shows an OLED text behavior.
- The stage animates signal dots and updates OLED text.

Loophole:

- There is no explicit distinction between behavior simulation and electrical/current simulation.

Missing:

- Behavior primitive catalog.
- Electrical model catalog.
- Current path analyzer.
- Fault detector.
- Student-facing explanation of simulation limits.

Risk:

The UI may imply that an animated behavior proves the circuit is electrically safe or physically accurate.

### 4.4 Renderer Is Not Yet Data-Driven Enough

Current state:

- `stageScene.js` creates the breadboard, Arduino, OLED, and wire endpoints with hardcoded coordinates.
- `circuit.connections` influences wires and labels, but part placement and endpoint maps are fixed.

Loophole:

- A generated `CircuitSpec` cannot reliably render unless it matches the existing hardcoded demo assumptions.

Missing:

- Render plan schema.
- Part footprint model.
- Pin anchor model.
- Breadboard row/column coordinate model.
- Layout constraints.
- Collision/overlap checks.
- Floating card anchor policy.

Risk:

The agent may produce a valid circuit spec that cannot be displayed accurately in the PCB tab.

### 4.5 Safety Context Is Under-Specified

Current state:

- Existing docs prohibit committing API keys and mention demo shortcuts.
- The new v2 requirements mention unsafe request handling.

Loophole:

- There is no detailed electrical safety policy or machine-readable safety limit registry.

Missing:

- Mains-voltage refusal rules.
- High-current actuator rules.
- Battery/charging rules.
- Relay rules.
- Heat/fire risk rules.
- Motor driver requirements.
- Board current limit rules.
- Age-appropriate safety explanations.

Risk:

Agent behavior may be inconsistent for unsafe prompts.

### 4.6 Learner-Level Context Is Not Operational

Current state:

- The master statement names elementary, middle/high, and university users.

Loophole:

- There is no operational learner model for question wording, explanation depth, or allowed vocabulary.

Missing:

- Vocabulary levels.
- Explanation templates by learner level.
- Concept progression.
- Misconception library.
- Examples of good and bad explanations.

Risk:

The agent may either oversimplify advanced students or confuse beginners with jargon.

### 4.7 Clarification Policy Is Not Formalized

Current state:

- The current interview asks fixed OLED-related questions.

Loophole:

- There is no general policy for deciding when to ask a question versus choosing a safe default.

Missing:

- Critical ambiguity categories.
- Safe default rules.
- Maximum question count.
- Question phrasing rules.
- Confirmation criteria.

Risk:

The agent may ask too many questions, ask meaningless category questions, or silently assume dangerous details.

### 4.8 Evaluation Corpus Is Missing

Current state:

- Current e2e is strong for the OLED demo.

Loophole:

- There is no diversity corpus for open-ended student requests.

Missing:

- Vague request cases.
- Explicit part cases.
- Conditional behavior cases.
- Multi-output cases.
- Unsafe request cases.
- Unsupported request cases.
- Expected `IntentSpec` fixtures.
- Expected validation errors.

Risk:

The team cannot rigorously measure whether Deep Agents improved generality.

---

## 5. Required Directory Structure

The context layer should live outside `src/` so it is clearly distinct from application runtime code.

Recommended root:

```text
agent-context/
  AGENTS.md
  index.md

  policies/
    safety-policy.md
    clarification-policy.md
    pedagogy-policy.md
    unsupported-request-policy.md
    simulation-truthfulness-policy.md

  schemas/
    intent-spec.schema.json
    circuit-spec.schema.json
    part-capability.schema.json
    electrical-model.schema.json
    simulation-spec.schema.json
    render-plan.schema.json
    validation-result.schema.json

  ontology/
    intent-primitives.md
    behavior-primitives.md
    signal-types.md
    pin-roles.md
    units-and-conventions.md
    learner-levels.md
    pin-aliases.json

  registry/
    parts.json
    part-capabilities.json
    controller-boards.json
    starter-kits.json
    modules.json

  electrical/
    electrical-model-policy.md
    simplified-circuit-theory.md
    component-models.json
    board-electrical-limits.json
    safety-limits.json
    netlist-rules.md
    calculation-recipes.md
    fault-detection-rules.md
    current-flow-explanations.md
    examples/
      led-current.valid.json
      led-no-resistor.invalid.json
      short-5v-gnd.invalid.json
      motor-direct-pin.invalid.json

  validation/
    rulebook.md
    validation-errors.md
    validator-tool-contract.md
    examples-valid.jsonl
    examples-invalid.jsonl

  simulation/
    primitives.json
    behavior-mappings.md
    input-controls.json
    simulation-limitations.md
    examples/
      analog-threshold-light.json
      button-toggle-led.json
      display-sensor-value.json

  rendering/
    render-plan-contract.md
    layout-constraints.md
    breadboard-coordinate-system.md
    pin-anchor-rules.md
    floating-card-anchor-policy.md

  prompts/
    coordinator-system.md
    intent-analyst.md
    clarifying-interviewer.md
    circuit-synthesizer.md
    validation-reviewer.md
    simulation-planner.md
    lesson-explainer.md

  evals/
    diverse-prompts.jsonl
    unsafe-prompts.jsonl
    unsupported-prompts.jsonl
    expected-intents.jsonl
    expected-validation-results.jsonl
    expected-simulation-results.jsonl
```

This directory should be treated as product knowledge and agent context, not as generated runtime output.

---

## 6. Layer Specifications

### 6.1 Always-Loaded Memory Layer

Path:

```text
agent-context/AGENTS.md
```

Purpose:

Define non-negotiable rules that every Deep Agent run must know.

Must include:

- H-eduware is educational, not professional manufacturing software.
- Do not force student-facing category selection.
- Normalize requests into intent and capability primitives.
- Never final-render unvalidated circuits.
- Never invent current, voltage, or safety conclusions without electrical tools.
- Never provide mains-voltage wiring instructions.
- Use safe low-voltage educational alternatives for unsafe requests.
- Keep questions short and student-friendly.
- Use deterministic validators as authority.

Must not include:

- Long electrical tutorials.
- Full part lists.
- Full schema definitions.
- Large examples.
- Historical implementation notes.

Reason:

Always-loaded memory consumes every agent context. It must be compact and constitutional.

### 6.2 Context Index Layer

Path:

```text
agent-context/index.md
```

Purpose:

Tell agents where knowledge lives and when to retrieve it.

Must include:

- Directory map.
- Authority hierarchy.
- Which files are human-readable policy.
- Which files are machine-readable registry/schema.
- Which tools must be called for validation.
- Retrieval recipes for common tasks.

Example retrieval recipe:

```text
If the request involves whether current can flow:
1. Read electrical/electrical-model-policy.md if policy is needed.
2. Call build_netlist.
3. Call estimate_current.
4. Call detect_faults.
5. Explain only the returned analysis.
```

### 6.3 Policy Layer

Path:

```text
agent-context/policies/
```

Purpose:

Guide judgment, refusal, clarification, and explanation.

Required policy documents:

#### `safety-policy.md`

Must cover:

- Mains voltage.
- High current.
- Motors and actuators.
- Batteries and charging.
- Relays.
- Heat/fire risk.
- Unknown components.
- Safe low-voltage substitution.

#### `clarification-policy.md`

Must cover:

- When to ask a question.
- When to choose a safe default.
- Maximum questions before proposing a simplified design.
- How to avoid category-choice questions.
- How to phrase questions by learner level.

#### `pedagogy-policy.md`

Must cover:

- Explanation depth by learner level.
- Vocabulary constraints.
- How to explain current, voltage, ground, signal, sensor, and output.
- How to explain mistakes without blame.

#### `unsupported-request-policy.md`

Must cover:

- How to identify unsupported requests.
- How to preserve the student's intent.
- How to propose a nearby safe project.

#### `simulation-truthfulness-policy.md`

Must cover:

- Difference between behavior simulation and electrical simulation.
- How to describe simplified current estimates.
- How to avoid claiming physical accuracy beyond supported models.

### 6.4 Schema Layer

Path:

```text
agent-context/schemas/
```

Purpose:

Define strict data contracts.

Required schemas:

- `intent-spec.schema.json`
- `circuit-spec.schema.json`
- `part-capability.schema.json`
- `electrical-model.schema.json`
- `simulation-spec.schema.json`
- `render-plan.schema.json`
- `validation-result.schema.json`

Rules:

- Schemas must be used by tests and validators.
- Agent output must be parsed and validated against schemas.
- Schemas must reject extra fields unless explicitly allowed.
- Schemas must include descriptions for agent/tool use.
- Schemas must version their contract.

### 6.5 Ontology Layer

Path:

```text
agent-context/ontology/
```

Purpose:

Define the vocabulary that maps student language to electronics concepts.

Required files:

#### `intent-primitives.md`

Must define:

- Sense.
- Decide.
- Act.
- Feedback.
- Constraint.
- Safety flag.

#### `behavior-primitives.md`

Must define:

- On/off.
- Threshold.
- Toggle.
- Timer.
- Sequence.
- Analog mapping.
- Display value.
- Alert.

#### `signal-types.md`

Must define:

- Power.
- Ground.
- Digital.
- Analog.
- PWM.
- I2C data.
- I2C clock.
- SPI signals.
- UART TX/RX.
- Control.

#### `pin-roles.md`

Must define:

- Power input.
- Power output.
- Ground.
- Digital input.
- Digital output.
- Analog input.
- PWM output.
- Bus data.
- Bus clock.
- Actuator drive.

#### `pin-aliases.json`

Must map common aliases:

```json
{
  "SDA": ["A4/SDA", "D20/SDA", "data line"],
  "SCL": ["A5/SCL", "D21/SCL", "clock line"],
  "GND": ["ground", "-", "0V"],
  "VCC": ["5V", "3V3", "+", "power"]
}
```

Purpose:

Avoid brittle text matching and help agents normalize student language.

### 6.6 Registry Layer

Path:

```text
agent-context/registry/
```

Purpose:

Provide authoritative machine-readable facts about available parts and their capabilities.

#### `parts.json`

Must include:

- Part ID.
- Display name.
- Description.
- Physical model type.
- Pin definitions.
- Educational description.

#### `part-capabilities.json`

Must include:

- Sensor capabilities.
- Output capabilities.
- Communication protocols.
- Required support parts.
- Electrical limits.
- Simulation capabilities.
- Render support.

#### `controller-boards.json`

Must include:

- Board name.
- Logic voltage.
- Supply pins.
- Ground pins.
- GPIO pins.
- Analog pins.
- PWM pins.
- I2C pins.
- SPI pins.
- UART pins.
- Per-pin current guidance.
- Board-level current guidance.

#### `starter-kits.json`

Must include:

- Parts likely available in a beginner kit.
- Preferred beginner-safe modules.
- Substitutions.

Registry rule:

If a part is not in the registry, the agent may discuss it conceptually but may not produce a final renderable circuit using it.

---

## 7. Electrical And Current Simulation Context

This is the most important addition beyond the initial Deep Agents v2 requirements.

H-eduware must distinguish:

```text
Behavior simulation:
Shows what the circuit appears to do.

Electrical simulation:
Explains whether current can flow safely through supported simplified models.
```

### 7.1 Electrical Model Policy

Path:

```text
agent-context/electrical/electrical-model-policy.md
```

Must state:

- H-eduware does not perform full SPICE simulation.
- Electrical analysis is simplified and educational.
- Current estimates are approximate.
- Unsupported components must not receive invented current estimates.
- Safety decisions must be conservative.
- The system may say "this simplified model cannot analyze that safely."

### 7.2 Component Electrical Models

Path:

```text
agent-context/electrical/component-models.json
```

Required model kinds:

- `ideal_wire`
- `resistor`
- `led_diode_simplified`
- `button_switch`
- `pullup_resistor`
- `pulldown_resistor`
- `buzzer_module`
- `oled_i2c_module`
- `analog_sensor_module`
- `digital_sensor_module`
- `servo_module`
- `dc_motor_requires_driver`
- `transistor_switch_simplified`
- `motor_driver_module`
- `relay_module_restricted`

Example LED model:

```json
{
  "partId": "led-red-5mm",
  "electricalModel": {
    "kind": "led_diode_simplified",
    "forwardVoltageTypical": 2.0,
    "recommendedCurrentMilliamp": 10,
    "absoluteMaxCurrentMilliamp": 20,
    "requiresCurrentLimiting": true,
    "polaritySensitive": true
  }
}
```

Example resistor model:

```json
{
  "partId": "resistor-220",
  "electricalModel": {
    "kind": "resistor",
    "resistanceOhms": 220,
    "tolerancePercent": 5,
    "powerRatingWatt": 0.25
  }
}
```

Example Arduino pin limit:

```json
{
  "boardId": "arduino-uno",
  "pinId": "D9",
  "limits": {
    "logicHighVoltage": 5.0,
    "recommendedMaxSourceMilliamp": 20,
    "absoluteMaxSourceMilliamp": 40,
    "supportsPwm": true
  }
}
```

### 7.3 Netlist Rules

Path:

```text
agent-context/electrical/netlist-rules.md
```

Must define:

- How wires merge endpoints into nodes.
- How power rails are represented.
- How ground nodes are represented.
- How breadboard tie points are represented.
- How switches change connectivity.
- How modules with internal circuits are abstracted.
- How buses such as I2C are treated as signal connections rather than current-load paths.

Required output of `build_netlist`:

```ts
type Netlist = {
  nodes: NetNode[];
  edges: NetEdge[];
  supplies: SupplyNode[];
  grounds: GroundNode[];
  unknowns: UnknownElectricalModel[];
};
```

### 7.4 Current Calculation Recipes

Path:

```text
agent-context/electrical/calculation-recipes.md
```

Must include:

- Ohm's law for simple resistor paths.
- LED series resistor current estimate.
- Pull-up/pull-down current estimate.
- GPIO output current estimate.
- Module current lookup.
- Total approximate current budget.
- Cases that must return "unsupported model" instead of a number.

Example:

```text
LED series path:
I = (Vsupply - Vforward) / R

Only apply when:
- exactly one known DC supply
- one LED model
- one or more known series resistors
- valid polarity
- return path to ground exists
```

### 7.5 Fault Detection Rules

Path:

```text
agent-context/electrical/fault-detection-rules.md
```

Must detect:

- Direct 5V to GND short.
- LED without current-limiting resistor.
- Reversed LED polarity.
- Missing common ground.
- Floating digital input.
- Analog sensor connected to digital-only input when analog behavior required.
- Motor directly connected to GPIO.
- Servo current warning.
- Conflicting voltage domains.
- I2C SDA/SCL swapped.
- Missing pull-up where required by selected module model.
- Unsupported mains voltage request.

Every fault must include:

- Machine-readable code.
- Severity.
- Student-friendly explanation.
- Suggested safe repair.

Example:

```json
{
  "code": "LED_WITHOUT_RESISTOR",
  "severity": "error",
  "explain": "The LED needs a resistor so too much current does not flow through it.",
  "repairHint": "Add a 220 ohm or 330 ohm resistor in series with the LED."
}
```

### 7.6 Current Flow Explanation Context

Path:

```text
agent-context/electrical/current-flow-explanations.md
```

Must provide learner-level phrasing for:

- Current only flows in a closed path.
- Ground is the return path/reference.
- A resistor limits current.
- A short circuit is dangerous because current has too easy a path.
- GPIO pins can only supply a small amount of current.
- Motors need drivers because they draw more current than logic pins can provide.
- Sensors often send a signal; they are not the main load.

The Lesson Explainer may use this file, but it must base numerical claims on electrical analysis tool output.

---

## 8. Validation Layer

Path:

```text
agent-context/validation/
```

Purpose:

Define deterministic validation behavior and error language.

Required tools:

```text
validate_schema(spec)
validate_parts(spec)
validate_connections(spec)
build_netlist(spec)
analyze_power_paths(netlist)
estimate_current(spec, netlist)
detect_faults(spec, netlist)
validate_simulation_support(spec)
validate_render_support(spec)
```

Validation must produce:

```ts
type ValidationResult = {
  status: "valid" | "invalid" | "valid_with_warnings";
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  electricalAnalysis?: ElectricalAnalysis;
  simulationSupport: SimulationSupportResult;
  renderSupport: RenderSupportResult;
};
```

Agents may summarize validation results, but they must not alter them.

---

## 9. Simulation Context

Path:

```text
agent-context/simulation/
```

Purpose:

Define what the Run button can actually simulate.

### 9.1 Simulation Primitive Registry

Path:

```text
agent-context/simulation/primitives.json
```

Required primitives:

- `digital_on_off`
- `blink_timer`
- `analog_threshold`
- `analog_to_brightness`
- `display_static_text`
- `display_sensor_value`
- `buzzer_pulse`
- `servo_angle`
- `motor_state_educational`
- `fault_visualization`
- `current_flow_animation`

Each primitive must define:

- Inputs.
- Outputs.
- Required part capabilities.
- Supported UI controls.
- Whether electrical analysis is required.
- Explanation template.

### 9.2 Simulation Limitation Context

Path:

```text
agent-context/simulation/simulation-limitations.md
```

Must state:

- Behavior animation is not proof of real-world correctness.
- Current estimates are simplified.
- Some modules are simulated as black boxes.
- Unsupported physics must be explained honestly.

### 9.3 Current Flow Animation

The simulation layer should support current-flow visualization only when electrical analysis finds a valid closed path.

Required states:

- No current path.
- Valid current path.
- Over-current warning.
- Short circuit warning.
- Missing ground.
- Unknown model.

The UI must not animate current through invalid or unknown paths as if they were correct.

---

## 10. Rendering Context

Path:

```text
agent-context/rendering/
```

Purpose:

Bridge validated `CircuitSpec` to the three.js PCB tab.

Required files:

### `render-plan-contract.md`

Must define:

- How parts map to three.js builders.
- How pins map to anchor points.
- How breadboard coordinates map to physical placement.
- How wires route.
- How labels and floating cards anchor.

### `breadboard-coordinate-system.md`

Must define:

- Row and column representation.
- Power rails.
- Ground rails.
- Tie-point connectivity.
- Recommended beginner layouts.

### `pin-anchor-rules.md`

Must define:

- How controller pins become 3D coordinates.
- How module pins become 3D coordinates.
- How breadboard holes become endpoints.

### `floating-card-anchor-policy.md`

Must define:

- Cards attach to validated entities.
- Cards must not obscure key parts.
- Cards may use projected coordinates or safe fallback slots.
- Cards must expose mapping to connection IDs for e2e tests.

Risk addressed:

Without this layer, agents can produce specs that validators accept but the renderer cannot display.

---

## 11. Prompt Context Layer

Path:

```text
agent-context/prompts/
```

Purpose:

Store concise role prompts for the coordinator and subagents.

Prompt files must:

- State the role.
- State allowed tools.
- State required output format.
- State what context to retrieve.
- State what not to decide.
- Require concise final reports to avoid context bloat.

Example subagent prompt constraints:

```text
You are the Circuit Synthesizer.
You may propose candidate circuits, but you may not claim validity.
Return only candidate CircuitSpec JSON and a short assumption list.
Do not include raw registry dumps.
```

Important:

Prompts are not authoritative facts. They are behavior guides.

---

## 12. Runtime Context

Runtime context is per-run information passed to agents and tools.

Required fields:

```ts
type HeduwareRuntimeContext = {
  userId?: string;
  sessionId: string;
  learnerLevel?: "elementary" | "middle_high" | "university";
  locale: "en" | "ko";
  availableKitId?: string;
  liveAgentEnabled: boolean;
  safetyMode: "strict";
  maxClarifyingQuestions: number;
  featureFlags: {
    electricalAnalysis: boolean;
    currentFlowAnimation: boolean;
    generatedRenderPlans: boolean;
  };
};
```

Rules:

- Runtime context may include user/session metadata.
- Runtime context may include feature flags.
- Runtime context must not be blindly injected into the prompt unless needed.
- Secrets must not be exposed to the model unless a specific trusted tool requires them.
- Runtime context propagates to subagents, so it must be safe for all subagent scopes.

---

## 13. Long-Term Memory

Long-term memory should be used sparingly.

Allowed:

- Student preferred explanation style.
- Student learner level if explicitly stated.
- Student preferred language.
- Classroom kit availability if persistent.
- Previous safe projects for continuity.

Not allowed:

- Safety rule overrides.
- Electrical facts.
- Part specifications.
- Validator results as universal facts.
- API keys.
- Private personal data not needed for education.

Reason:

Long-term memory can become stale. Circuit safety and electrical facts must come from versioned registries and validators, not remembered conversation fragments.

---

## 14. Evaluation Context

Path:

```text
agent-context/evals/
```

Purpose:

Provide rigorous evaluation data for agent behavior.

### 14.1 Prompt Corpus

`diverse-prompts.jsonl` must include examples across axes:

- Vague goals.
- Explicit parts.
- Sensor-based behaviors.
- Actuator-based behaviors.
- Multi-output behaviors.
- Conditional logic.
- Time-based logic.
- Unsupported components.
- Unsafe high-voltage requests.
- Beginner and advanced phrasing.

### 14.2 Expected Intent Corpus

`expected-intents.jsonl` must define expected normalized `IntentSpec` fragments.

It should not require exact wording, but it must require key primitives.

### 14.3 Expected Validation Corpus

`expected-validation-results.jsonl` must define:

- Expected pass/fail.
- Expected error codes.
- Expected warnings.
- Expected safe repair suggestions.

### 14.4 Electrical Evaluation Corpus

Must include:

- LED with correct resistor.
- LED without resistor.
- Short 5V to GND.
- Missing ground.
- Button input with and without pull-up/down.
- Motor directly on GPIO.
- Motor with driver module.
- I2C OLED correctly wired.
- I2C SDA/SCL swapped.
- Unsupported mains request.

### 14.5 Simulation Evaluation Corpus

Must include:

- Valid behavior simulations.
- Valid current-flow visualizations.
- Fault visualization cases.
- Unsupported simulation cases.

---

## 15. Tool Contracts And Context Use

Agents must use tools instead of reading raw registries when possible.

Required query tools:

```text
search_context(query, scope)
get_policy(policyName)
query_part_capabilities(capabilityQuery)
get_part(partId)
get_board_limits(boardId)
get_simulation_primitive(primitiveId)
validate_circuit_spec(spec)
build_netlist(spec)
estimate_current(spec, netlist)
detect_faults(spec, netlist)
compile_render_plan(spec)
compile_simulation_plan(spec)
```

Reasons:

- Tools can return concise, scoped context.
- Tools can hide irrelevant registry details.
- Tools can enforce schema.
- Tools can version and log decisions.
- Tools reduce prompt bloat.

Tool outputs must be concise but traceable.

Each tool output should include:

- Result.
- Source version.
- Relevant IDs.
- Warnings.
- Whether the result is authoritative.

---

## 16. Source Hierarchy And Conflict Resolution

Agents need a clear policy for conflicting context.

Conflict examples:

- Current master statement says one OLED demo.
- v2 requirements say diverse requests.
- A student asks for a mains-powered lamp.
- A remembered preference says "I like advanced circuits."

Resolution:

1. Safety policy wins.
2. Active product mode wins next.
3. v2 requirements apply only when v2/live-agent mode is enabled.
4. Current demo constraints apply in cached demo mode.
5. User preferences affect tone and explanation depth, not safety.
6. Agent suggestions never override validators.

Mode-specific context:

```text
Cached demo mode:
  Use current fixed OLED workflow.

Deep Agents v2 mode:
  Use IntentSpec/CircuitSpec/context layer.

Unsupported live mode:
  Fall back to cached demo and explain limitation.
```

---

## 17. Implementation Priority

The context layer should be built in this order.

### Priority 1: Safety And Contracts

- `agent-context/AGENTS.md`
- `agent-context/index.md`
- `policies/safety-policy.md`
- `schemas/intent-spec.schema.json`
- `schemas/circuit-spec.schema.json`
- `schemas/validation-result.schema.json`

Reason:

Agents must know the non-negotiable rules and output contracts before any generation work.

### Priority 2: Registry And Basic Validation

- `registry/controller-boards.json`
- `registry/part-capabilities.json`
- `ontology/signal-types.md`
- `ontology/pin-roles.md`
- `validation/rulebook.md`
- deterministic schema/connection validator

Reason:

Circuit generation cannot be trusted until parts and pins are authoritative.

### Priority 3: Electrical And Current Layer

- `electrical/component-models.json`
- `electrical/board-electrical-limits.json`
- `electrical/netlist-rules.md`
- `electrical/calculation-recipes.md`
- `electrical/fault-detection-rules.md`
- netlist/current/fault tools

Reason:

Current simulation and safety claims require explicit electrical context.

### Priority 4: Simulation And Rendering Contracts

- `simulation/primitives.json`
- `simulation/simulation-limitations.md`
- `rendering/render-plan-contract.md`
- `rendering/breadboard-coordinate-system.md`
- `rendering/floating-card-anchor-policy.md`

Reason:

The validated circuit must become something the UI can actually show and run.

### Priority 5: Subagent Prompts And Evals

- `prompts/*.md`
- `evals/*.jsonl`

Reason:

After the factual substrate exists, agent behavior and evaluation can be made rigorous.

---

## 18. Acceptance Criteria For The Context Layer

The context layer is acceptable when:

1. The main agent can discover where to retrieve context from `index.md`.
2. Always-loaded context is under a small, intentional budget.
3. A student request can be normalized into `IntentSpec`.
4. A candidate circuit can be validated against `CircuitSpec`.
5. Part capabilities are queryable without reading entire source files.
6. Electrical current analysis can distinguish valid paths, missing paths, shorts, and unsupported models.
7. Safety policy consistently rejects or reframes high-risk requests.
8. Simulation primitives define what the Run UI can and cannot show.
9. Render plan contracts define how generated circuits map to the 3D stage.
10. Evaluation corpora cover diverse, unsafe, unsupported, and electrical fault cases.
11. Agents never need to infer electrical facts from prose alone.
12. Deterministic tools can cite the registry/schema version they used.

---

## 19. Example End-To-End Context Flow

Student:

```text
"Make something that turns on when it gets dark."
```

Context flow:

```text
1. Coordinator reads always-loaded AGENTS.md.
2. Intent Analyst maps request using ontology/intent-primitives.md.
3. Agent produces IntentSpec:
   sense = ambient light
   decide = threshold
   act = visual output
4. Coordinator calls query_part_capabilities:
   need ambient light sensor
   need visual output
   need beginner-safe controller
5. Circuit Synthesizer drafts CircuitSpec.
6. validate_circuit_spec checks structure and connection rules.
7. build_netlist creates electrical nodes.
8. estimate_current checks LED path.
9. detect_faults verifies resistor and no short.
10. compile_simulation_plan maps to analog_threshold + digital_on_off.
11. compile_render_plan maps parts to breadboard coordinates.
12. Lesson Explainer reads pedagogy/current-flow explanations.
13. UI streams progress and renders Files/PCB/Run.
```

The final explanation may say:

```text
"When the light sensor reads a low value, the Arduino turns the LED pin on.
Current then flows from the Arduino pin through the resistor, through the LED,
and back to ground. The resistor keeps the current small enough for the LED and
Arduino pin."
```

This explanation is allowed only if the electrical analysis confirms the path and current estimate.

---

## 20. Open Questions

1. Should context files be stored as plain files in the repository, or loaded into a searchable vector/index service later?
2. Should schemas be JSON Schema, Zod source files, or both generated from a single source?
3. How much of `src/partLibraryData.js` should be migrated into `agent-context/registry/parts.json`?
4. Should electrical models start with only LED/resistor/button/OLED/sensor modules before supporting motors and relays?
5. Should current estimates be shown numerically to elementary students, or only explained qualitatively?
6. Should the first current-flow visualization show arrows only on validated DC paths?
7. Should every generated circuit include a "simulation limits" note in the Files document?
8. How should registry versions be displayed or stored in generated project files?
9. Should unsupported requests be added automatically to an evaluation backlog?
10. Should live-agent traces be retained for debugging, and if so, how should student privacy be protected?

---

## 21. Source Notes

This document follows the Deep Agents context engineering model:

- Input context: compact system prompt, memory, skills, tool prompts.
- Runtime context: per-run user/session/feature data.
- Context compression: offloading and summarization.
- Context isolation: subagents for specialized work.
- Long-term memory: persistent user preferences, not safety facts.

References:

- https://docs.langchain.com/oss/javascript/deepagents/context-engineering
- https://docs.langchain.com/oss/javascript/deepagents/subagents
- https://docs.langchain.com/oss/javascript/langchain/context-engineering

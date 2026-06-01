# H-eduware Deep Agents v2 Requirements

> **What this document is:** Requirements for expanding H-eduware from a single scripted Arduino + OLED demo into an agent-driven educational circuit design system that can respond to varied student requests.
>
> **Relationship to existing specs:**
> - `Spec/H-eduware_master_statement.md` remains the source of truth for the current hackathon demo and product identity.
> - This document defines a v2 scope expansion. It intentionally goes beyond the current "one polished Arduino + I2C OLED breadboard demo" boundary.
> - `Spec/H-eduware_design_system.md` remains binding for visual language unless superseded by a later design document.
>
> **Created:** 2026-05-31
> **Status:** Draft requirements for Deep Agents architecture planning

---

## 1. Executive Summary

H-eduware v2 must support students asking open-ended, unpredictable circuit questions in natural language.

The system must not force students into preselected categories such as "OLED", "LED", or "motor". Instead, it must interpret the student's request, infer the underlying educational electronics intent, ask concise follow-up questions when required, synthesize a circuit specification, validate the circuit deterministically, and render a learnable breadboard-based design with simulation and explanations.

Deep Agents should be introduced as the orchestration layer for this workflow. Deep Agents are responsible for planning, task decomposition, specialist subagents, tool usage, streaming progress, and human-in-the-loop confirmation. They are not responsible for final circuit correctness by themselves.

Circuit correctness must be enforced by explicit schemas, a part/capability registry, deterministic validation, and a constrained simulation/compiler layer.

The core architectural rule is:

```text
LLM agents may propose.
Deterministic validators must approve.
The renderer only consumes validated circuit specifications.
```

---

## 2. Problem Statement

The current application proves the product thesis with one polished demo:

```text
"show some text on a little screen"
  -> Arduino + I2C OLED breadboard circuit
  -> floating explanation cards
  -> Run shows RALPHTON BUSAN
```

This is effective for a hackathon demo, but it does not yet solve the general product problem.

Students will not ask only one known request. They may ask:

- "Make something that turns on when it gets dark."
- "Can I know if my plant needs water?"
- "I want a door alarm."
- "Show the temperature on a screen."
- "Make a traffic light."
- "Use a button to control a motor."
- "Can I control a real 220V lamp?"
- "Build something that reacts when someone gets close."
- "I want my robot to stop before hitting a wall."
- "Make a game controller with buttons."

The product must handle this variability without exposing professional circuit-design complexity to the student.

---

## 3. Product Goal

H-eduware v2 should become an educational circuit design assistant that can:

1. Understand vague student goals.
2. Convert natural language into structured circuit intent.
3. Ask only the questions needed to remove ambiguity.
4. Select safe beginner-friendly components.
5. Generate a validated breadboard circuit specification.
6. Render the circuit in the existing Files + PCB workflow.
7. Simulate the educational behavior at an appropriate level of fidelity.
8. Explain every important part and connection in plain language.
9. Safely reject, narrow, or reframe unsafe and unsupported requests.

The student-facing experience should remain conversational and visual. The internal system may be agentic and multi-step, but the student should feel that the app is guiding them calmly from idea to understandable circuit.

---

## 4. Non-Goals

The following are explicitly out of scope for the first Deep Agents v2 implementation:

- Full SPICE-level electrical simulation.
- Arbitrary PCB design, footprints, routing, manufacturing exports, or DRC.
- Real-world high-voltage wiring instructions.
- Vendor catalog integration as the primary source of parts.
- User accounts, collaboration, or cloud project persistence.
- Letting an LLM directly emit executable JavaScript or three.js rendering code.
- Letting an LLM bypass circuit validation because its natural-language reasoning "sounds correct".
- Guaranteeing that every possible student request can be built.

The intended output is a safe educational breadboard design and simulation, not a professional production-ready circuit.

---

## 5. Core Principle: Intent And Capability, Not Categories

The system must not model student requests as a fixed menu of circuit categories.

Instead, the system must normalize requests into intent primitives and capability requirements.

Example student request:

```text
"I want something that warns me when my plant is dry."
```

The app should not ask the student to choose from a category list. Internally, it should infer:

```text
Sense: soil moisture
Decide: threshold
Act: buzzer or LED
Feedback: alert
Learning target: sensor threshold and output control
Safety level: low-voltage breadboard
```

Example student request:

```text
"Make a light that turns on at night."
```

Internal normalized intent:

```text
Sense: ambient light
Decide: threshold
Act: LED
Feedback: visual light
Learning target: analog sensor reading and conditional output
Safety level: low-voltage breadboard
```

This internal representation lets the system handle varied requests without pretending to support unrestricted circuit design.

---

## 6. Required Intermediate Models

### 6.1 IntentSpec

`IntentSpec` is the normalized interpretation of the student's request.

It must represent what the student wants without committing yet to exact components or wiring.

Required fields:

```ts
type IntentSpec = {
  originalPrompt: string;
  learnerLevel: "elementary" | "middle_high" | "university" | "unknown";
  goalSummary: string;
  inputs: IntentInput[];
  decisions: IntentDecision[];
  outputs: IntentOutput[];
  feedbackMode: FeedbackMode[];
  constraints: IntentConstraint[];
  missingInformation: MissingInfo[];
  safetyFlags: SafetyFlag[];
  confidence: number;
};
```

Conceptual field meanings:

- `originalPrompt`: the exact student request.
- `learnerLevel`: inferred or selected student level.
- `goalSummary`: one plain-language sentence describing the desired project.
- `inputs`: things the circuit senses or receives, such as light, temperature, button press, distance, moisture, sound, motion, or none.
- `decisions`: logic such as threshold, toggle, timer, sequence, mapping, comparison, or direct display.
- `outputs`: things the circuit does, such as LED, display text, buzzer, servo movement, motor movement, or data display.
- `feedbackMode`: visual, sound, motion, text, or mixed.
- `constraints`: breadboard-only, Arduino-compatible, low-voltage, beginner-safe, limited parts, classroom demo.
- `missingInformation`: information the agent still needs before it can build safely.
- `safetyFlags`: high voltage, high current, mains power, heat, motor driver needed, unknown sensor, unsupported actuator.
- `confidence`: model confidence in the interpretation.

### 6.2 CircuitSpec

`CircuitSpec` is the validated design contract consumed by the Files tab, PCB tab, renderer, and simulation layer.

It must be strict, serializable JSON. It must never contain executable code.

Required fields:

```ts
type CircuitSpec = {
  id: string;
  title: string;
  learnerLevel: "elementary" | "middle_high" | "university";
  goal: string;
  assumptions: string[];
  parts: CircuitPart[];
  connections: CircuitConnection[];
  behaviors: CircuitBehavior[];
  simulation: SimulationSpec;
  explanations: ExplanationSpec[];
  validation: ValidationSummary;
};
```

Key requirements:

- Every part must reference a known part definition in the part registry.
- Every connection must reference valid part IDs and valid pin IDs.
- Every connection must include a signal role such as power, ground, digital, analog, pwm, i2c-data, i2c-clock, spi-clock, spi-data, or control.
- Every behavior must be representable by the simulation layer.
- Every educational explanation must be tied to a part, pin, connection, behavior, or safety decision.
- Validation output must be saved with the spec so the UI can explain why the circuit is safe or why it was narrowed.

### 6.3 PartCapabilityRegistry

The part registry is the deterministic source of truth for what can be used.

It must include:

- Part ID.
- Human-readable name.
- Category metadata for browsing only, not for student-facing routing.
- Pin list.
- Pin roles.
- Voltage limits.
- Current constraints where relevant.
- Required supporting components.
- Compatible signal types.
- Render model recipe.
- Simulation capabilities.
- Educational description.
- Safety notes.

The registry must support capability queries such as:

```text
Find parts that can sense ambient light.
Find beginner-safe visual outputs.
Find display outputs compatible with Arduino Uno.
Find actuators that require a driver.
Find parts that need a resistor.
```

---

## 7. Deep Agents Architecture

### 7.1 Coordinator Agent

The coordinator is the top-level Deep Agent.

Responsibilities:

- Receive student messages.
- Maintain the task plan.
- Route work to specialist subagents.
- Call deterministic tools.
- Decide whether a clarification question is needed.
- Produce structured outputs only through approved schemas.
- Stream progress events to the UI.
- Stop before unsafe or unsupported actions.

The coordinator must not directly write renderer code, mutate frontend files, or produce unvalidated wiring as final output.

### 7.2 Subagents

#### Intent Analyst

Purpose:

Convert the student's natural-language request into an `IntentSpec`.

Responsibilities:

- Extract goal, inputs, outputs, conditions, feedback type, and constraints.
- Detect ambiguity.
- Detect unsafe or unsupported requests.
- Estimate confidence.

Failure mode:

If confidence is low or required information is missing, it must return missing-information items rather than inventing details silently.

#### Clarifying Interviewer

Purpose:

Ask concise student-friendly follow-up questions.

Responsibilities:

- Ask one question at a time.
- Use simple language.
- Avoid jargon unless the student appears advanced.
- Prefer questions that reduce design ambiguity.
- Avoid asking category-selection questions when intent can be inferred.

Example good question:

```text
"Should the warning be a sound, a light, or both?"
```

Example bad question:

```text
"Do you want category A, B, C, D, or E?"
```

#### Circuit Synthesizer

Purpose:

Generate a candidate `CircuitSpec` from the `IntentSpec` and available part capabilities.

Responsibilities:

- Select beginner-safe parts.
- Prefer breadboard-compatible circuits.
- Produce part and connection candidates.
- Include assumptions.
- Include behavior and simulation plan.

Failure mode:

If no safe beginner-friendly circuit is possible, it must produce a safe fallback explanation and recommended simplified project.

#### Constraint Validator

Purpose:

Review the candidate circuit using deterministic validation tools.

Responsibilities:

- Check pin existence.
- Check signal compatibility.
- Check power and ground.
- Check required resistors or drivers.
- Check unsupported high-voltage or high-current requirements.
- Check simulation support.
- Return machine-readable validation errors and warnings.

The validator agent may interpret validation results, but the validation itself must be deterministic code.

#### Simulation Planner

Purpose:

Map validated circuit behavior into an educational simulation.

Responsibilities:

- Define observable states.
- Define inputs the student can manipulate.
- Define output animation behavior.
- Define Run behavior.
- Define safe simplified physics where appropriate.

Examples:

- LED brightness changes with simulated light sensor value.
- Buzzer pulses when threshold is crossed.
- OLED text updates from a sensor reading.
- Servo angle changes with button or sensor state.

#### Lesson Explainer

Purpose:

Generate educational copy from the validated spec.

Responsibilities:

- Create plain-language requirement document sections.
- Create floating card explanations.
- Explain what each wire carries.
- Explain why each connection exists.
- Explain what might happen if a key wire is missing.
- Adjust vocabulary to learner level.

The explanation must never contradict the validated circuit.

---

## 8. Required Tools

Deep Agents must interact with the application only through narrow tools.

### 8.1 `infer_intent`

Input:

- Student message history.
- Optional learner profile.

Output:

- `IntentSpec`.

### 8.2 `query_part_capabilities`

Input:

- Capability query.
- Constraints.

Output:

- Matching part definitions.

### 8.3 `draft_circuit_spec`

Input:

- `IntentSpec`.
- Candidate parts.

Output:

- Candidate `CircuitSpec`.

### 8.4 `validate_circuit_spec`

Input:

- Candidate `CircuitSpec`.

Output:

- `ValidationSummary`.

This tool must be deterministic.

### 8.5 `repair_circuit_spec`

Input:

- Candidate `CircuitSpec`.
- Validation errors.

Output:

- Revised candidate `CircuitSpec`.

The revised spec must be revalidated.

### 8.6 `compile_requirement_markdown`

Input:

- Validated `CircuitSpec`.

Output:

- Markdown requirement document.

### 8.7 `compile_render_plan`

Input:

- Validated `CircuitSpec`.

Output:

- Renderer-ready layout and model data.

### 8.8 `compile_simulation_plan`

Input:

- Validated `CircuitSpec`.

Output:

- Simulation state machine or declarative simulation plan.

### 8.9 `request_student_confirmation`

Input:

- Summary of interpreted intent.
- Key assumptions.
- Safety notes.
- Proposed design summary.

Output:

- Student confirmation or correction.

This tool should use human-in-the-loop behavior. The system must not build when critical ambiguity remains.

---

## 9. Workflow Requirements

### 9.1 Happy Path

```text
1. Student describes an idea.
2. Coordinator invokes Intent Analyst.
3. Intent Analyst returns IntentSpec.
4. Coordinator checks missing information.
5. If needed, Clarifying Interviewer asks one follow-up question.
6. Coordinator queries part capabilities.
7. Circuit Synthesizer drafts CircuitSpec.
8. Deterministic validator checks CircuitSpec.
9. If invalid, Coordinator routes repair loop.
10. Coordinator requests student confirmation.
11. On confirmation, requirement markdown is generated.
12. Render plan is generated.
13. Simulation plan is generated.
14. Frontend displays Files tab and PCB tab.
15. Run executes educational simulation.
```

### 9.2 Ambiguous Request Path

If the request is ambiguous, the system must ask a targeted clarification.

Example:

```text
Student: "Make something that warns me."
Agent: "What should it warn you about: darkness, distance, temperature, moisture, or something else?"
```

The agent should ask only enough questions to produce a safe validated design.

### 9.3 Unsafe Request Path

If the request involves unsafe conditions, the system must not generate wiring instructions for dangerous real-world circuits.

Example:

```text
Student: "Control my wall outlet lamp with Arduino."
```

Required behavior:

- Detect mains voltage safety risk.
- Refuse direct wiring instructions.
- Offer a safe educational low-voltage alternative, such as controlling an LED model or relay concept simulation without mains wiring.
- Explain the safety reason in age-appropriate terms.

### 9.4 Unsupported Request Path

If the request cannot be supported by available parts or simulation primitives:

- Explain the limitation.
- Offer the closest safe supported learning project.
- Preserve the student's original goal in the requirement document as an unsupported or deferred goal.

---

## 10. Frontend Requirements

### 10.1 Chat UI

The chat UI must evolve from a fixed transcript simulator into a live agent progress surface.

Required states:

- Idle.
- Interpreting request.
- Asking clarification.
- Selecting parts.
- Validating circuit.
- Repairing design.
- Waiting for confirmation.
- Building requirement document.
- Building 3D render plan.
- Ready to run.
- Unsupported request.
- Unsafe request.
- Error with recovery action.

The UI must stream meaningful progress instead of only showing a generic typing indicator.

### 10.2 Files Tab

The Files tab must render the generated requirement document from the validated `CircuitSpec`.

Required sections:

- Goal.
- Student request summary.
- Assumptions.
- Parts needed.
- What it should do.
- How the circuit works.
- Connections.
- Safety notes.
- What to try next.

### 10.3 PCB Tab

The PCB tab must render from a validated render plan, not from hardcoded OLED-only geometry.

The renderer must support:

- Breadboard placement.
- Multiple module types.
- Multiple input and output parts.
- Jumper wires.
- Wire colors by signal type.
- Floating explanation cards.
- Camera fit/reset controls.
- Data attributes or debug metadata for e2e validation.

### 10.4 Simulation UI

Run simulation must support more than one behavior shape.

Simulation primitives should include:

- Digital output on/off.
- Analog threshold.
- Analog mapping.
- Timed blinking.
- Display text.
- Display numeric reading.
- Buzzer pulse.
- Servo or motor state, only when validated as safe educational simulation.

The UI should expose simple controls for simulated inputs when needed.

Examples:

- Slider for light level.
- Slider for distance.
- Toggle for button press.
- Slider for temperature.
- Toggle for motion detected.

---

## 11. Validation Requirements

Validation must be deterministic and must run before any design is rendered as final.

Required checks:

### 11.1 Structural Checks

- All part IDs exist.
- All pin IDs exist.
- All connection IDs are unique.
- Every connection references valid endpoints.
- Every behavior references valid parts.
- Every explanation references valid entities.

### 11.2 Electrical Role Checks

- Power connects to compatible power pins.
- Ground connects to ground pins.
- I2C SDA connects to SDA-compatible pins.
- I2C SCL connects to SCL-compatible pins.
- Analog sensors connect to analog-capable inputs.
- PWM outputs connect to PWM-capable pins when PWM is required.
- Digital inputs and outputs are not confused.

### 11.3 Safety Checks

- No mains-voltage wiring instructions.
- No high-current load without driver abstraction.
- Motor usage requires driver or educational simulation abstraction.
- LEDs require current limiting unless the selected module includes it.
- Common ground is required where needed.
- Conflicting voltage domains are rejected or require a level-shifter.

### 11.4 Simulation Checks

- Every requested behavior must map to a supported simulation primitive.
- Unsupported real-world behavior must be converted to a safe educational abstraction or rejected.
- The Run button must never imply real-world correctness beyond the educational simulation.

---

## 12. Testing Requirements

Default automated verification must not depend on live model calls or secrets.

### 12.1 Existing Gate Preservation

The current commands must remain valid:

```powershell
npm install
npm test
npm run build
npm run test:e2e
npm run check
```

`npm run check` must continue to pass without a live API key.

### 12.2 New Mocked Agent Tests

Add a mocked Deep Agents test suite that verifies:

- Intent extraction from diverse prompts.
- Clarification behavior when required fields are missing.
- CircuitSpec generation from mocked agent output.
- Deterministic validation catches invalid specs.
- Repair loop retries invalid specs.
- Unsafe requests are rejected or safely reframed.
- Requirement markdown compiles from valid specs.
- Simulation plans compile from valid specs.

### 12.3 Diversity Evaluation Suite

The system must be evaluated against diverse request types, not fixed circuit categories.

Minimum diversity axes:

1. Vague goal with no part names.
2. Explicit part request.
3. Conditional behavior.
4. Multi-output behavior.
5. Sensor-driven behavior.
6. Time-based behavior.
7. Unsafe or high-voltage request.
8. Unsupported part request.
9. Beginner learner-level request.
10. Advanced learner-level request.

Each evaluation case must assert:

- IntentSpec quality.
- Clarification necessity.
- CircuitSpec validity.
- Validation result.
- Requirement document content.
- Render plan existence.
- Simulation plan existence.
- Safety behavior where applicable.

### 12.4 E2E Requirements

E2E must cover:

- Default cached mode.
- Mocked agent mode.
- At least one diverse non-OLED request.
- Unsafe request handling.
- Nonblank 3D canvas.
- Correct rendered part labels or debug metadata.
- Run simulation state changes.
- No external network in default tests.
- No secrets in logs, traces, screenshots, or generated artifacts.

### 12.5 Production Preview Test

At least one e2e lane should run against production build output, not only the Vite dev server.

---

## 13. Security Requirements

- API keys must never be stored in frontend code.
- API keys must never be printed in logs.
- Live Deep Agents mode must run server-side.
- Default test mode must use mocked model responses.
- Live model smoke tests must be opt-in.
- Student prompts must be rendered escaped.
- Agent-generated markdown must be sanitized or compiled through a safe renderer.
- Agent output must never be executed as code.
- Tool access must be scoped to approved circuit-design functions.
- Unsafe real-world wiring must be rejected or converted to low-voltage educational simulation.

---

## 14. Deployment And Runtime Requirements

The first implementation should support two runtime modes:

### 14.1 Cached Demo Mode

- No API key required.
- Deterministic responses.
- Used by `npm run check`.
- Used for local development when no key exists.

### 14.2 Live Agent Mode

- Requires explicit opt-in.
- Requires server-side API key.
- Uses Deep Agents workflow.
- Streams progress events to frontend.
- Can fall back to cached mode on failure.
- Must show when live mode is unavailable.

---

## 15. Acceptance Criteria

The Deep Agents v2 implementation is acceptable when:

1. The app can accept varied student prompts without forcing category selection.
2. The agent produces an `IntentSpec` for each supported request.
3. The agent asks targeted clarification questions when needed.
4. The system generates strict `CircuitSpec` JSON.
5. Deterministic validation approves or rejects each CircuitSpec.
6. Invalid specs do not render as final circuits.
7. Unsafe requests are safely rejected or reframed.
8. Files tab renders a requirement document from the validated spec.
9. PCB tab renders a circuit from validated render data.
10. Run executes a supported educational simulation plan.
11. Floating cards explain validated connections and behaviors.
12. Default tests pass without live model calls.
13. Live Deep Agents mode is opt-in and server-side.
14. The system includes a diversity evaluation suite, not just one OLED scenario.
15. The product remains understandable to students.

---

## 16. Recommended Implementation Phases

### Phase 1: Contracts And Validators

- Define `IntentSpec`.
- Define `CircuitSpec`.
- Define part capability registry schema.
- Implement deterministic validator.
- Add unit tests for valid and invalid specs.

### Phase 2: Mocked Agent Workflow

- Implement server-side Deep Agents workflow with mocked model outputs.
- Add coordinator and subagent boundaries.
- Add tool interfaces.
- Test repair and clarification loops.

### Phase 3: Frontend Adapter

- Add frontend agent state model.
- Add streaming progress surface.
- Render generated Files document.
- Render generated PCB plan.
- Keep cached mode fallback.

### Phase 4: Simulation Expansion

- Implement declarative simulation primitives.
- Add input controls such as sliders and toggles.
- Add e2e coverage for non-OLED simulated behavior.

### Phase 5: Live Agent Mode

- Add server-side model integration.
- Add secure API key handling.
- Add opt-in live smoke tests.
- Add observability without leaking secrets.

### Phase 6: Evaluation And Hardening

- Build diversity prompt suite.
- Add unsafe request tests.
- Add production-preview e2e.
- Add regression fixtures for known prompts.
- Add snapshot tests for generated specs.

---

## 17. Major Risks

| Risk | Severity | Requirement Response |
|------|----------|----------------------|
| LLM hallucinated wiring | High | Strict schema plus deterministic validation |
| Unsafe real-world advice | High | Safety validator plus refusal/reframing policy |
| Scope explosion | High | Capability registry and supported simulation primitives |
| Slow live agent UX | Medium | Streaming progress and cached fallback |
| Expensive model calls | Medium | Mocked default tests, opt-in live mode |
| Brittle renderer | Medium | Render from validated plan, not arbitrary agent output |
| Test instability | Medium | Deterministic fixtures and no live calls in default gate |
| Student confusion | Medium | Plain-language clarifications and learner-level explanations |

---

## 18. Open Questions

These questions should be resolved during design, not by ad hoc implementation:

1. Should H-eduware use TypeScript for the new agent/server/schema layer while keeping the current frontend Vanilla JS?
2. Which schema validation library should define `IntentSpec` and `CircuitSpec`?
3. Should the server runtime be Express, Vite middleware, or serverless functions?
4. What is the minimum part capability registry needed before live agent mode is useful?
5. How should generated render plans map onto reusable three.js component builders?
6. How much simulation fidelity is enough for education without implying real hardware correctness?
7. What learner-level signals should the agent use before adapting vocabulary?
8. How should live agent traces be stored, if at all, without exposing student data or secrets?
9. Which production deployment target will own server-side model credentials?
10. What is the fallback UX when live agent validation fails repeatedly?

---

## 19. Source Notes

This requirements document assumes the Deep Agents architecture described in the official LangChain documentation:

- Deep Agents overview: https://docs.langchain.com/oss/javascript/deepagents/overview
- Deep Agents quickstart: https://docs.langchain.com/oss/javascript/deepagents/quickstart
- Deep Agents subagents: https://docs.langchain.com/oss/javascript/deepagents/subagents
- Deep Agents human-in-the-loop: https://docs.langchain.com/oss/javascript/deepagents/human-in-the-loop
- Deep Agents streaming: https://docs.langchain.com/oss/javascript/deepagents/streaming

These references should be rechecked before implementation because the Deep Agents API and best practices may evolve.

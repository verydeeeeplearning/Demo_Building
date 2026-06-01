# H-eduware Master Statement

> **What this document is:** The single source of truth for H-eduware's identity, scope, and structure for the Ralphton Busan hackathon (2026-05-30). Every build decision should trace back to a statement here. When the team disagrees, this document wins.
>
> **Companion documents:**
> - `flux_ai_ui_ux_analysis.md` provides the layout and interaction skeleton (the persistent three-region shell, tab switch, AI plan/narration panel, 3D stage).
> - `H-eduware_design_system.md` provides the visual language (color, typography, shape, depth, components), derived from the Cohere web design system.
>
> This master statement assumes both as its design baseline. flux.ai sets the structure; Cohere sets the look.
>
> **Created:** 2026-05-30
> **Status:** Locked for hackathon scope

---

## 1. One-Line Identity

H-eduware is a web app that turns a student's plain-language idea ("I want a screen that shows my name") into a 3D breadboard circuit that the student can see, understand wire by wire, and watch run.

It is a teaching tool first and a design tool second. Every feature exists to make a circuit *legible* to someone who has never built one.

---

## 2. Why It Exists

Real circuit design tools (flux.ai, KiCad, Altium) are built for professionals. They assume the user already knows what a pull-up resistor is and can read a schematic. A student facing them learns nothing except that hardware is intimidating.

Flux.ai proved one powerful idea: you can describe what you want in natural language and an AI builds the design. H-eduware takes that idea and rebuilds it for learning rather than manufacturing. We keep the conversational front door and the tangible 3D output, then strip away everything that requires prior expertise (schematics, SMT footprints, design rule checks, manufacturing prep) and replace it with the things a beginner actually needs: simple words, physical-looking parts, jumper wires, and an explanation for every connection.

---

## 3. Who It Is For

| Tier | What they bring | What H-eduware gives them |
|------|-----------------|---------------------------|
| Elementary | Curiosity, no vocabulary | Pictures of real parts, the AI talks like a friendly teacher |
| Middle / High | Basic science class exposure | The "why each wire exists" cards turn intuition into understanding |
| University | Some theory, little hands-on | A fast sandbox to connect concept to physical layout before touching real hardware |

The product never assumes the reader knows electronics. The AI's job is to meet each student where they are and raise them one step.

---

## 4. Core Experience (the spine of the product)

The whole product is one loop, in this order:

1. **Describe.** The student types a goal in the left AI panel in their own words.
2. **Interview.** The AI asks short, simple follow-up questions and rewrites the request into clear, unambiguous terms the student can read back and agree with. This is where vague ideas become a buildable requirement.
3. **Confirm.** The student says "yes, build that" in chat. Nothing is designed before this moment.
4. **Design.** The AI places breadboard, modules, and parts into the 3D view and runs jumper wires between them.
5. **Explain.** Floating cards appear on the connections, telling the student what each wire carries and why it is needed.
6. **Run (demo).** For the one supported example, the student presses Run and watches the circuit behave in real time.

This loop is the product. Tabs, panels, and 3D models are all in service of it.

---

## 5. Structure: Two Tabs, Three Regions

H-eduware keeps flux.ai's persistent three-region shell (left AI panel, center stage, right inspector) but reduces flux.ai's four tabs to **two**.

### 5.1 The persistent shell

```
+-----------------------------------------------------------------------+
|  TOP BAR: H-eduware | project name | [ Files | PCB ] | Run | Share    |
+-------------+-----------------------------------------+---------------+
|  LEFT       |        CENTER STAGE                      |   RIGHT       |
|  AI PANEL   |   Files: requirement document           |   INSPECTOR   |
|  interview  |   PCB:   3D breadboard + wires          |   part library|
|  + design   |                                         |   + properties|
|  narration  |                                         |               |
+-------------+-----------------------------------------+---------------+
```

The left AI panel and right inspector stay visible on both tabs. Only the center changes.

### 5.2 Files tab

The AI-authored requirement document. This is the written outcome of the interview: a clean, readable spec in plain language (goal, parts needed, what it should do, assumptions). It is the student's record of what they asked for and what will be built. We deliberately drop flux.ai's manufacturing-grade sections and keep it short and understandable.

### 5.3 PCB tab

Renamed in spirit but kept as the tab label for benchmark familiarity. This is the 3D stage. The critical divergence from flux.ai lives here:

- **No PCB substrate, no SMT placement.** Instead: a breadboard plus discrete modules (Arduino, OLED, sensor, motor) sitting in space.
- **Jumper wires**, not copper traces, connect the parts.
- **Floating explanation cards** anchor to wires and parts to teach the connection.
- A **Run control** triggers the demo simulation.

We keep the tab named "PCB" only so the layout maps cleanly to the benchmark. The content is intentionally a beginner's physical breadboard, not a printed board.

Visually, the 3D stage is treated as the design system's dark product field: a deep green-black environment (`#003c33`) where parts and wires read as tangible objects, while the surrounding shell stays on white canvas. This is how H-eduware reconciles a Cohere-style white-canvas UI with a dark 3D editor. See `H-eduware_design_system.md`, Sections 1 and 5.

---

## 6. The AI Panel in Detail

The left panel is modeled on flux.ai's reasoning-and-plan feed, not a bare chat window. It does three jobs:

1. **Interviewer.** Asks clarifying questions, rephrases the student's idea, lowers ambiguity. Always uses simple vocabulary sized to the student.
2. **Planner.** Once confirmed, shows a short visible checklist of design steps ("place the breadboard", "add the Arduino", "connect power", "wire the screen") and checks them off as it builds, mirroring flux.ai's task list.
3. **Narrator.** Explains in friendly language what it is doing and why, in step with the floating cards on the 3D stage.

The tone is collaborative and encouraging. The input framing is "tell me what you want to build", not a command prompt.

---

## 7. Educational Mechanism: The Floating Cards

This is H-eduware's signature teaching device and has no equivalent in flux.ai.

When a wire is drawn between two parts, a floating card can surface near it answering three questions a beginner has:

- **What is this wire?** (for example, "5V power", "ground", "data line / SDA")
- **Why does it connect these two parts?** (for example, "the screen needs power from the Arduino")
- **What happens if it is missing?** (optional, reinforces the concept)

Cards are tied to the connection metadata in the component data structure (see Section 8), so they are generated from the design, not hand written per project. They are the reason a student walks away understanding the circuit rather than just seeing it.

Visually they follow the design system's `floating-card` style: a rounded 22px media-lift card over the dark stage, a 24px heading, short body copy, and an uppercase mono wire-type label (`5V POWER`, `GND`, `I2C SDA`) with the coral accent marking the wire category. This component is H-eduware's own, built from Cohere's capability-card and agent-console-chip patterns. See `H-eduware_design_system.md`, Section 7.

---

## 8. Technical Architecture (hackathon build)

> Decisions below are locked. They reflect the four confirmed choices: Vanilla JS + three.js, direct hardcoded OpenAI API, Arduino + I2C OLED demo, English documentation.

### 8.1 Frontend

- **Vanilla JavaScript + three.js.** No heavy framework. three.js owns the PCB tab (3D rendering, orbit/zoom camera, the gridded floor, the run-time effects). Plain JS and DOM handle the shell, tabs, AI panel, Files document, and inspector.
- Rationale: minimal dependencies, full control over the 3D scene, fast to demo. The cost is that we hand-build UI state management, which is acceptable at hackathon scope.

### 8.2 3D component library (built ahead of time)

Each demo part is modeled once in three.js and stored as a reusable library entry. For the locked demo we need at minimum:

- Breadboard
- Arduino Uno (or compatible board)
- 0.96" I2C OLED display
- Jumper wire (parametric, draws point to point)
- One sensor and one motor model (to make the library feel real even if not used in the running demo)

Each library entry carries **interaction metadata in a connected data structure**, not just a mesh. Metadata includes the part's pins/terminals, what each pin means (power, ground, SDA, SCL, signal), and how a pin may legally connect to another. This metadata is what powers both the floating cards and the demo simulation. The 3D model and its electrical meaning are kept together as one object.

### 8.3 AI backend

- **Direct OpenAI API call from the web app with a hardcoded key**, for the demo only. The "codex" requirement is read as an OpenAI GPT code-capable model accessed over the API.
- The key is hardcoded purely to make the demo self-contained on stage. This is explicitly a demo shortcut, not a production pattern, and must be removed before any public deployment.
- The AI panel's interview, planning, and narration text all come from this single API path.

### 8.4 Simulation scope (the hard boundary)

- A full physical circuit engine is **out of scope.** It is too complex to build correctly inside the hackathon.
- Instead we ship **one hardcoded demo use case**: an Arduino driving an I2C OLED to display text on screen.
- For that single example, pressing Run plays a scripted real-time simulation (the screen lights up and shows the text, wires can animate to show signal flow). It is a choreographed demo of one circuit, not a general simulator.
- Everything else in the 3D view is design-and-explain only; Run is meaningful for the OLED example alone. This limit is intentional and should be stated openly during the demo.

---

## 9. Visual Direction (Cohere-derived)

The visual language is adapted from the Cohere web design system: a sober, editorial command-center look warmed for students. This replaces the earlier placeholder direction (dark base, purple primary, teal accent borrowed from flux.ai). flux.ai is now the layout reference only; Cohere sets the look.

### 9.1 Core decisions

- **Restrained chrome, expressive fields.** The top bar, the Files document, the part library, and the properties inspector stay quiet on white canvas (`#ffffff`) with near-black text (`#212121`), thin rules, and flat surfaces with no heavy shadows. The left AI panel and the 3D stage are the dark fields (`#17171c` and `#003c33`) where color and energy live, together with the floating cards.
- **The 3D stage is a dark product field.** Deep green-black (`#003c33`), the same way Cohere uses dark full-width bands for product environments. This resolves the white-canvas vs dark-editor tension cleanly.
- **Near-black pill CTAs.** Primary actions ("Build this", "Run", "Confirm") are near-black (`#17171c`) pills on light surfaces, white pills on dark. Secondary actions are underlined text links.
- **Coral as the educational accent.** Coral (`#ff7759`) marks wire-type tags and floating-card categories, never the main CTA. Blue (`#1863dc`) is for links.
- **Monumental, tight typography.** One oversized carved headline per surface (Space Grotesk display, Inter body, with negative tracking), then restrained 16px to 24px UI copy. Uppercase mono labels for technical markers.
- **Flat depth, rounded media.** Depth comes from surface alternation and thin borders, not shadows. Dominant radii are 8px (chips, cards) and 22px (floating cards, major media).
- **Warmer than Cohere in copy and tone**, since the audience is students rather than enterprise buyers.

### 9.2 Where the full spec lives

Complete color tokens, type scale, spacing, radius scale, component definitions, do's and don'ts, responsive behavior, and drop-in CSS custom properties are in `H-eduware_design_system.md`. That document is the authoritative visual reference for the build; this section is the summary of binding decisions.

---

## 10. Scope Boundaries (what we are NOT building)

| In scope | Out of scope |
|----------|--------------|
| Files tab + PCB tab | Schematic / circuit-graph view |
| Breadboard + modules + jumper wires in 3D | Real PCB substrate, SMT footprint placement |
| AI interview, plan, narration via OpenAI API | Multi-model AI, fine-tuning, server-side key handling |
| Floating explanation cards from metadata | Hand-authored explanations per project |
| One scripted Run demo (Arduino + I2C OLED text) | A general physical/electrical simulation engine |
| Pre-modeled three.js demo part library | A full searchable vendor part catalog |
| Sophisticated single-flow UX | User accounts, save/load, collaboration, export |

---

## 11. Demo-Day Success Criteria

The hackathon demo succeeds if a judge can watch this end to end:

1. A student types a vague idea ("show some text on a little screen").
2. The AI interviews, simplifies, and confirms the requirement, visible in the Files tab.
3. The student confirms, and the AI builds the breadboard, Arduino, and OLED with jumper wires in the 3D view.
4. Floating cards explain each wire in plain language.
5. The student presses Run and the OLED shows the text in real time.

If those five beats land cleanly, the product proves its thesis: natural language in, an understood working circuit out.

---

## 12. Open Questions (track and resolve during build)

- Exact text the OLED displays in the demo (suggest something audience-facing, for example the event name).
- How much of the interview is scripted versus live model output, given hackathon reliability needs.
- Whether jumper-wire signal animation is in the first demo cut or a stretch goal.
- Fallback plan if the live OpenAI call fails on stage (a cached transcript is recommended).

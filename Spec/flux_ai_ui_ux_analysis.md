# Flux.ai UI/UX Analysis (Reference Benchmark)

> **Purpose:** Visual and interaction analysis of flux.ai, the benchmark service for H-eduware. This document is produced from the two reference screenshots stored in `refServiceUI:UX/`. It is the **layout and interaction reference** that the master statement builds its structure on. The **visual design language is Cohere-derived** and lives in `H-eduware_design_system.md`, not here.
>
> **Source images:**
> - `refServiceUI:UX/FileTab_screenshot_fluxAI.png` (Files / document specification view)
> - `refServiceUI:UX/3dPCBTab_screenshot_fluxAI.png` (PCB / 3D board view)
>
> **Created:** 2026-05-30
> **Status:** Final (input to master statement)

---

## 1. Overall Layout Model

Flux.ai uses a stable three-region shell that stays constant while the center content swaps per tab. This is the single most important structural pattern to borrow.

```
+-----------------------------------------------------------------------+
|  TOP BAR: project title | prompt chip + History | TABS | actions | Share |
+-------------+-----------------------------------------+---------------+
|             |                                         |               |
|  LEFT       |        CENTER STAGE                      |   RIGHT       |
|  AI PANEL   |   (swaps by active tab:                  |   CONTEXT     |
|  (chat +    |    Files doc / Schematic / PCB 3D)       |   INSPECTOR   |
|  reasoning) |                                         |   (assets,    |
|             |                                         |   library,    |
|             |                                         |   properties) |
+-------------+-----------------------------------------+---------------+
```

Key property: the **left AI panel and right inspector persist across every tab**. Only the center stage changes. The user never loses the conversation or the property context when switching views.

---

## 2. Top Bar

Left to right:

1. **Project identity dropdown** with a small colored project glyph and the project name (truncated, e.g. "Dogabot / USB-C WiFi BLE Environmental Se..."). A star/favorite icon sits beside it.
2. **Prompt chip** showing the originating request ("Make me a temperature sensor...") with a **History** control. This keeps the founding intent visible at all times.
3. **Center tab cluster** with a small home/knowledge glyph then text tabs: **Knowledge | Files | Schematic | PCB**. The active tab is marked with a subtle underline/indicator in the teal-green accent.
4. **Document actions** (contextual to the tab): "Refine this doc", "Edit", "About this doc" on the Files tab; "Objects | Rules | Library" sub-cluster on the PCB tab.
5. **Share button** in a saturated purple/indigo, plus a circular user avatar at the far right.

Takeaway: the top bar carries identity, founding intent, navigation, and sharing in one thin strip. Tabs are the primary mode switch.

---

## 3. Left AI Panel (Chat + Reasoning Trace)

This is the defining interaction of the product and the part H-eduware leans on most.

Observed elements (top to bottom):
- A scrolling **reasoning + activity feed**, not a plain chat log. It shows:
  - Status header with elapsed time ("Working for 11 mins 11 sec...").
  - Collapsible **thought entries** ("Thought for 1 sec", "Thought for a moment", "Read project docs").
  - A **task plan block** ("Created 7 tasks (1 min)") rendered as a checklist with completed items checked off (e.g. "Set project name/description and create initial project specification", "Select library parts for USB-C protection, regulator, ESP32 dual-radio MCU module, and T/RH sensor", "Add selected components and required support passives", "Consult datasheets...", "Wire USB-C power...", "Run ERC/review...", "Create power budget, firmware starter, board bring-up project files").
  - A live status line at the bottom ("Considering datasheet needs...").
- A bottom **input box** with placeholder "Guide Flux while it works..." and a saturated purple **Send** button.

UX principles to copy:
- The assistant **externalizes its plan** as a visible, checkable task list. The user sees what will happen and what is done.
- The assistant **narrates reasoning** in compact collapsible chunks rather than a wall of text.
- The input framing is collaborative ("Guide ... while it works") rather than command/response.

For H-eduware this panel becomes the **requirement interview + design narration** surface: the AI clarifies the student's request in simple language, then narrates the design steps as it places parts.

---

## 4. Center Stage

### 4a. Files tab (document view)

- Renders a **structured specification document** with a clean editorial typography: large H1 ("Project Specification"), a "Status: Draft" line, then H2 sections.
- Observed sections: Project Overview, Intended Use, What the Device Should Do, Main Features, System Architecture, Interfaces and Connections, Power and Runtime Expectations, Power Tree and Power Budget, Manufacturing and Assembly, Firmware-Relevant Hardware Requirements, Physical Design Decisions, Important Design Decisions, Assumptions, Change Notes.
- A **right-aligned table of contents / outline** mirrors those sections for fast jumping. The document reads like a living PRD authored by the AI.

Takeaway: the "Files" tab is where intent is captured as a readable requirements document. This maps directly to H-eduware's **Files tab** (the requirement document the AI produces from the interview).

### 4b. PCB tab (3D view)

- A **3D isometric rendering** of a green PCB on a dark gridded floor, with components placed and visibly volumetric (a shielded module/chip, USB-C connectors, tactile buttons, passive parts).
- Camera implies orbit/pan/zoom over a ground grid.
- **Bottom center toolbar**: Load, **Auto-Layout**, and playback-style controls.
- **Bottom right** status: warning/error counts and a "141 Reviews" style indicator, plus an Auto-Layout shortcut.

Takeaway: the 3D stage is the spatial, tangible representation of the design. H-eduware reuses this exact stage feel but replaces realistic SMT-on-PCB placement with **education-friendly breadboard + modules + jumper wires**, and adds **floating explanation cards** on the connections.

---

## 5. Right Inspector Panel

Context-sensitive, changes by tab:

- **Files tab:** a **Documents** list ("Project Specification") and an **Assets** panel. Selecting an asset (e.g. "Generic Resistor") shows **Properties** (Designator R2, Resistance 500, Part Type, Package SMD_0603..., Manufacturer fields) and a Pricing & Availability section.
- **PCB tab:** a **Library** browser ("Powered by part vendor", searchable) listing parts (Generic Resistor, Generic Capacitor, Generic Inductor) each with a thumbnail; below it, **Layout Rules** for the selected part with a **Computed | Specified** toggle and fields (Position X/Y, Rotation, Layer, Dimension Grid, Keep Out, Keep Out Distance, Rotation lock).

Takeaway: the right rail is a **part library + selected-element property editor**. H-eduware needs a lighter version: a small library of demo components (breadboard, Arduino, OLED, motor, sensor, jumper) and a property/metadata card for the selected part.

---

## 6. Visual Design Language

| Token | Observation |
|-------|-------------|
| **Base theme** | Dark, near-black panels with slightly lighter raised surfaces. High contrast text. |
| **Primary accent** | Saturated purple/indigo (Share, Send, primary actions). |
| **Secondary accent** | Teal/green (active tab indicator, the PCB substrate). |
| **3D environment** | Dark ground with a fine grid; green board; soft realistic lighting and shadows. |
| **Typography** | Clean sans-serif; clear H1/H2 hierarchy in documents; small mono-ish labels for properties. |
| **Density** | Information-dense but calm; generous spacing inside cards; panels separated by thin dividers. |
| **Iconography** | Minimal line icons; small part thumbnails in the library. |
| **Status cues** | Inline counters for warnings/errors/reviews; checkmarks for completed tasks. |

---

## 7. Patterns to Adopt for H-eduware

1. **Persistent three-region shell** (left AI, center stage, right inspector) with a top tab switch.
2. **AI panel as plan + narration**, not bare chat: visible task checklist and collapsible reasoning.
3. **Files tab as an AI-authored requirements document** with a section outline.
4. **3D stage with bottom toolbar** (orbit/zoom, plus a demo "Run/Simulate" control in our case).
5. **Right rail = part library + selected-part properties/metadata.**
6. **Gridded 3D floor with soft lighting** so parts read as physical objects.

> Note on color: flux.ai's own palette (dark theme, purple primary, teal accent) is described above as observation of the benchmark. H-eduware does **not** adopt that palette. Its visual language is Cohere-derived (white-canvas shell, near-black pill CTAs, deep green-black 3D field, coral educational accent). See `H-eduware_design_system.md`.

## 8. Patterns to Intentionally Diverge From

| Flux.ai | H-eduware |
|---------|-----------|
| Knowledge / Files / **Schematic** / PCB tabs | Only **Files** and **PCB** tabs (no schematic/circuit view). |
| Realistic **SMT parts on a PCB substrate** | **Breadboard + modules (motor, sensor, OLED) + jumper wires** for learnability. |
| Professional designer audience, dense jargon | **Students (elementary to university)**: simple wording, guided. |
| Auto-Layout / DRC / manufacturing focus | **Floating explanation cards** on each wire (what connects to what and why). |
| Full physics/electrical engine | **Single hardcoded demo simulation** (Arduino driving an I2C OLED to show text). |
| Vendor-priced real part library | **Small curated three.js demo-component library** with interaction metadata. |

# H-eduware Design System (Cohere-derived)

> **What this is:** The visual and interaction design language for H-eduware, adapted from the Cohere web design system. It is the implementation-level companion to `H-eduware_master_statement.md` (which holds the curated decisions) and `flux_ai_ui_ux_analysis.md` (which holds the layout and interaction structure).
>
> **How the three documents divide the work:**
> - **flux.ai analysis** gives the *layout and interaction skeleton*: the persistent three-region shell, the tab switch, the AI plan/narration panel, the 3D stage with a bottom toolbar.
> - **This design system** gives the *visual skin*: color, typography, shape, depth, and component styling, derived from Cohere.
> - **Master statement** holds the *identity and the binding decisions*; when in doubt, it wins.
>
> **Created:** 2026-05-30
> **Status:** Locked for hackathon scope
> **Stack note:** Tokens below are written for a Vanilla JS + three.js build. CSS custom properties drive the DOM shell; the same color values feed the three.js scene for the 3D stage.

---

## 1. Design Philosophy

Cohere reads as a sober command center: a white editorial canvas, monumental tight typography, restrained black-and-white UI, and color delivered through media and dark product bands rather than decorative chrome. H-eduware adopts that restraint and bends it for students.

Three principles govern the adaptation:

1. **Restrained chrome, expressive fields.** The top bar, the Files document, the part library, and the properties inspector stay quiet on white canvas with near-black text, thin rules, and flat surfaces. The left AI panel and the 3D stage are the dark fields where color and energy live, together with the educational floating cards.
2. **The 3D stage is a dark product field.** Cohere uses deep green-black and dark navy full-width bands for its product environments. H-eduware's 3D breadboard view is exactly that: a deep green-black field where parts and wires read as tangible objects. This resolves the tension between Cohere's white canvas and a dark 3D editor by treating the editor as Cohere's "dark product band".
3. **Warm the austerity for learners.** Cohere's audience is enterprise buyers. Ours is students from elementary to university. We keep the measured typography and flat surfaces, but lean on the coral accent and friendlier copy so the product feels encouraging rather than corporate.

This supersedes the earlier placeholder direction (dark base with purple primary and teal accent borrowed from flux.ai). flux.ai remains the layout reference only. The visual language is Cohere-derived from here on.

---

## 2. Color System

### 2.1 Brand and accent

| Token | Hex | Role in H-eduware |
|-------|-----|-------------------|
| Black | `#000000` | Top announcement strip, highest-contrast text, brand anchor |
| Near-Black Primary | `#17171c` | Primary pill CTAs, dark AI panel surface, deep UI cards |
| Deep Enterprise Green | `#003c33` | The 3D PCB stage field and any dark capability band |
| Dark Navy | `#071829` | Alternate dark band (e.g. a focused "simulation running" state) |
| Action Blue | `#1863dc` | Text links, pagination, secondary emphasis |
| Coral | `#ff7759` | Educational accent: floating-card category chips, wire-type tags, warm markers |
| Soft Coral | `#ffad9b` | Pale chip borders and segmented label details |

### 2.2 Surface and background

| Token | Hex | Role |
|-------|-----|------|
| Canvas White | `#ffffff` | Default page and panel background, form and card surface |
| Soft Stone | `#eeece7` | Part-library cards, warm neutral blocks, placeholder surfaces |
| Pale Green Wash | `#edfce9` | Backdrop behind grouped dark capability panels |
| Pale Blue Wash | `#f1f5ff` | Backdrop behind abstract or 3D imagery in CTA areas |
| Card Border | `#f2f2f2` | Softest card containment line |

### 2.3 Text and rules

| Token | Hex | Role |
|-------|-----|------|
| Ink | `#212121` | Default body text and link text on light surfaces |
| Muted Slate | `#93939f` | Metadata, dates, de-emphasized labels, footer links |
| Slate | `#75758a` | Tertiary text and separators |
| Hairline | `#d9d9dd` | Standard list rules and section dividers |
| Border Light | `#e5e7eb` | Secondary divider and utility rule |

### 2.4 Semantic

| Token | Hex | Role |
|-------|-----|------|
| Focus Blue | `#4c6ee6` | Keyboard focus ring |
| Form Focus Violet | `#9b60aa` | Focus border on text inputs |
| Error Red | `#b30000` | Validation and error ring or shadow |

### 2.5 Gradient and color-field policy

No gradients as generic UI fill. UI surfaces stay flat. Gradient and color richness is media-led: the deep green-to-black of the 3D stage, the glow effects on a running simulation, and any abstract hero imagery. Keep buttons, cards, and panels flat.

### 2.6 Drop-in CSS tokens

```css
:root {
  /* brand + accent */
  --c-black: #000000;
  --c-primary: #17171c;
  --c-green: #003c33;
  --c-navy: #071829;
  --c-blue: #1863dc;
  --c-coral: #ff7759;
  --c-coral-soft: #ffad9b;
  /* surface */
  --c-canvas: #ffffff;
  --c-stone: #eeece7;
  --c-wash-green: #edfce9;
  --c-wash-blue: #f1f5ff;
  --c-card-border: #f2f2f2;
  /* text + rules */
  --c-ink: #212121;
  --c-muted: #93939f;
  --c-slate: #75758a;
  --c-hairline: #d9d9dd;
  --c-border: #e5e7eb;
  /* semantic */
  --c-focus: #4c6ee6;
  --c-focus-input: #9b60aa;
  --c-error: #b30000;
}
```

The same `--c-green` and `--c-navy` values are passed into the three.js scene as the stage background and fog color so the DOM and the 3D field stay in one palette.

---

## 3. Typography

### 3.1 Font families

Cohere's proprietary faces (CohereText, Unica77, CohereMono) are not available to us. We use the documented fallbacks so the cadence is preserved.

| Role | Stack |
|------|-------|
| Display | `"Space Grotesk", Inter, ui-sans-serif, system-ui` |
| Body and UI | `Inter, Arial, ui-sans-serif, system-ui` |
| Technical labels (mono) | `"Space Mono", ui-monospace, "Cascadia Code", monospace` |

Icons use thin-line geometric SVGs, not a heavy icon set.

### 3.2 Hierarchy

| Role | Font | Size | Weight | Line height | Letter spacing | Notes |
|------|------|-----:|-------:|------------:|---------------:|-------|
| Hero Display | Space Grotesk | 96px | 400 | 1.00 | -1.92px | Landing or empty-project declaration only |
| Product Display | Space Grotesk | 72px | 400 | 1.00 | -1.44px | Major section heroes |
| Section Display | Inter | 60px | 400 | 1.00 | -1.2px | Large page headings |
| Section Heading | Inter | 48px | 400 | 1.20 | -0.48px | Split hero and CTA headings |
| Card Heading | Inter | 32px | 400 | 1.20 | -0.32px | Feature and list section titles |
| Feature Heading | Inter | 24px | 400 | 1.30 | 0 | Cards, filters, floating-card titles |
| Body Large | Inter | 18px | 400 | 1.40 | 0 | Lead text |
| Body | Inter | 16px | 400 | 1.50 | 0 | Default copy and links |
| Button | Inter | 14px | 500 | 1.71 | 0 | Compact CTA labels |
| Caption | Inter | 14px | 400 | 1.40 | 0 | Metadata and small text |
| Mono Label | Space Mono | 14px | 400 | 1.40 | 0.28px | Uppercase technical and wire-type markers |
| Micro | Inter | 12px | 400 | 1.40 | 0 | Footer and nav microcopy |

### 3.3 Principles

- One oversized headline per surface, then settle into 16px to 24px UI copy.
- Keep display type tight and carved, not airy. Negative tracking on large sizes.
- Avoid heavy bold weights. Size, spacing, and surface contrast carry the hierarchy.
- Use uppercase mono labels for system markers, especially wire-type tags on the 3D stage (for example `5V POWER`, `GND`, `I2C SDA`).
- The base typography stays black and measured. Coral chips and blue links add accent without changing the type voice.

---

## 4. Layout and Spacing

### 4.1 Spacing scale

8px base with documented one-off values: 2, 6, 8, 10, 12, 16, 20, 22, 24, 28, 32, 36, 40, 56, 60, 64, 80 px. Large sections use dramatic vertical breathing room; dense content appears only where the information architecture needs it (the part library, the properties inspector, the Files document outline).

### 4.2 The shell grid (mapped to flux.ai structure)

- **Top bar:** three-zone layout. Brand and project identity left, tab cluster center (`Files | PCB`), Run and Share actions right.
- **Left AI panel:** fixed-width column, dark surface (`--c-primary`) treated as Cohere's agent-console field.
- **Center stage:** swaps by tab. White editorial canvas for Files, deep green-black field for PCB.
- **Right inspector:** white canvas column holding the part library and selected-part properties.

### 4.3 Whitespace philosophy

Whitespace is a trust and calm signal. On the Files document, separate the goal, the parts list, and the assumptions with generous intervals. On the 3D stage, let the dark field breathe around the parts. Density is reserved for the library list and the properties fields.

---

## 5. Elevation and Depth

Mostly flat. Depth comes from surface alternation, media contrast, rounded corners, and thin borders, not drop shadows.

| Level | Treatment | Use in H-eduware |
|-------|-----------|------------------|
| Flat | No shadow, white or dark field | Files document, library list, editorial copy |
| Bordered | 1px Hairline or Border Light | Property rows, form inputs, pale cards |
| Media lift | Rounded media over a contrasting field | Floating explanation cards over the 3D stage, thumbnails |
| Dark product field | Deep green or navy full-width field | The 3D PCB stage, the AI panel, a running-simulation state |

---

## 6. Shapes

### 6.1 Radius scale

| Token | Value | Role |
|-------|------:|------|
| `xs` | 4px | Search field, small thumbnails, utility elements |
| `sm` | 8px | Chips, small cards, dialogs |
| `md` | 16px | Medium cards and grouped blocks |
| `lg` | 22px | Signature media-card and floating-card radius |
| `xl` | 30px | Filter and taxonomy pills |
| `pill` | 32px | Primary CTA buttons |
| `full` | 9999px | Round status dots and fully pill controls |

Dominant radii are 8px and 22px. Do not use rounded cards below 8px for major media.

### 6.2 Image and media treatment

Media sits as rounded cards with visible corners, not as text backdrops (except in dedicated CTA bands). Part thumbnails in the library use 8px; the floating explanation cards and any hero media use 22px.

---

## 7. Components (mapped to H-eduware surfaces)

### `button-primary`
Near-black (`--c-primary`) pill on light surfaces, white pill on dark surfaces. Inter 14px to 16px, padding 12px 24px, 32px radius. Used for "Build this", "Run", and "Confirm requirement".

### `button-secondary`
Text-only action, underlined or rule-aligned, no fill. Used for "Edit requirement", "Reset view", and companion actions.

### `button-pill-outline`
Transparent fill, 1px dark border, 30px radius. Used for lightweight controls such as part-category filters in the library.

### `top-announcement-strip`
Full-width black strip above the nav, 36px tall, centered microcopy ("H-eduware demo build"), optional underlined link and a close control at the far right.

### `ai-panel` (Cohere agent-console treatment)
Dark near-black panel. Holds the interview thread, the visible task checklist with checkmarks, collapsible reasoning entries, small status chips, and a bottom input ("Tell me what you want to build"). White or muted text; small accent chips may use coral or blue.

### `floating-card` (Cohere capability-card treatment)
Rounded 22px media-lift card over the 3D field. A thin-line icon or wire-type swatch, a 24px Feature Heading ("This wire carries power"), short body copy, and an uppercase mono wire-type label (`5V POWER`). The coral accent marks the wire category. This is H-eduware's signature educational component and has no Cohere equivalent; it is built from the capability-card and agent-console-chip patterns.

### `files-document` (editorial surface)
White canvas requirement document: a large display H1, a "Status: Draft" mono label, then H2 sections with a right-aligned outline. Thin Hairline rules between sections. Reads like a calm research-lab spec sized down for a student.

### `part-library-card`
Warm Soft Stone card, 8px radius, generous padding, a small thumbnail, a label, and a divider line. Three across on desktop where space allows; a vertical list in the narrow inspector.

### `properties-panel`
Bordered rows on white canvas. Compact labels in Muted Slate, values in Ink, thin Hairline separators. Holds the selected part's designator, pins, and connection metadata.

### `run-control`
Bottom-center toolbar on the 3D stage with a primary pill for Run and secondary text actions (Reset, Fit view). On Run, the stage may shift toward the Dark Navy field to signal the live simulation state.

### `empty-state` / `placeholder`
Honest placeholder frames using Soft Stone surfaces and skeleton blocks. Never invent product content or fake dashboard data.

---

## 8. Do's and Don'ts

### Do
- Default to white canvas; use deep green or navy as full-width fields (the 3D stage, dark bands).
- Keep primary CTAs pill-shaped and near-black on light surfaces, white on dark.
- Use 22px radius on floating cards and major media; 8px on chips and library cards.
- Use coral for educational taxonomy and wire-type accents, never as the main CTA color.
- Keep the UI shell restrained; let the 3D stage and media carry color.
- Use thin-line geometric icons for parts and capabilities.

### Don't
- Do not turn coral or blue into broad decorative surface colors.
- Do not add heavy drop shadows to cards.
- Do not make every section a box; use unframed rows, rules, and open space.
- Do not use rounded media below 8px.
- Do not collapse the display and body type split into one generic sans-serif.
- Do not use saturated gradients as normal UI backgrounds; keep gradient richness media-led on the stage.

---

## 9. Responsive Behavior

| Name | Width | Key changes |
|------|------:|-------------|
| Small Mobile | <425px | Single column, compact nav, reduced hero scale |
| Mobile | 425-640px | Panels stack, 3D stage becomes a focused full-width view, forms stack |
| Large Mobile | 640-768px | Wider single-column with larger media |
| Tablet | 768-1024px | Two-column inspector begins, nav tightens |
| Desktop | 1024-1440px | Full three-region shell, library grid, split layout |
| Large Desktop | 1440-2560px | Wide container with generous vertical intervals |

Collapsing strategy: the nav collapses to a compact menu; the three-region shell becomes a tabbed stack on mobile (AI panel, stage, inspector as switchable views); library grids drop from three columns to one; properties rows stack their labels above values.

Touch targets: CTAs meet comfortable sizing through 12px to 24px padding and pill radii. Library and filter chips are larger than typical tags so the dense inspector stays usable on touch.

---

## 10. Implementation Notes (Vanilla JS + three.js)

- Drive the DOM shell with the CSS custom properties in Section 2.6. Keep all color literals out of component CSS; reference the tokens.
- The three.js scene reads `--c-green` (stage background and fog) and `--c-navy` (running-simulation state) from the same token set so the 3D field and the DOM never drift apart.
- Floating cards are DOM overlays positioned over the canvas (HTML/CSS, anchored to projected 3D coordinates), not in-scene meshes. This keeps the 22px radius, typography, and coral accent consistent with the rest of the UI.
- Wire-type mono labels (`5V POWER`, `GND`, `I2C SDA`) come from the component connection metadata described in the master statement, Section 8.2.

---

## 11. Known Gaps

- Cohere's proprietary fonts are not bundled. We use Space Grotesk, Inter, and Space Mono as the documented fallbacks; the carved, tight cadence is approximate.
- Mobile is documented from the desktop system and standard responsive patterns; no separate mobile mockups exist for the hackathon.
- Lazy-loaded or asynchronous areas use placeholder skeleton surfaces rather than invented filled content.

# Context Layer Source Bundle Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build a repeatable source-of-truth collection pipeline so H-eduware can promote hardware from visual-only/planned to supported only when official-source claims, canonical data, validation, rendering, simulation, evals, and browser evidence are complete.

**Architecture:** Add a provenance layer beside the existing `agent-context` hierarchy. Runtime agents still consume concise canonical JSON, while maintainers and promotion audits verify that each canonical value is backed by normalized `SourceClaim` records and grouped into `HardwareSupportBundle` manifests.

**Tech Stack:** Vanilla JS frontend remains unchanged for this phase; server/context code uses TypeScript + Zod; canonical context remains Markdown + JSON/JSONL under `agent-context`; tests use Node test runner, `tsx`, and Playwright for browser-visible evidence.

---

## Current Context Baseline

Existing context layer already has:

- `agent-context/index.md`: authority order, hierarchy, and data-first expansion rule.
- `agent-context/registry/part-capabilities.json`: 9 canonical agent-ready parts.
- `agent-context/data/render-footprints.json`: 9 render footprint entries.
- `agent-context/simulation/primitives.json`: 9 simulation primitives.
- `agent-context/data/capability-graph.json`: 11 capability records: 5 supported, 3 planned, 3 unsupported.
- `server/context/contextLayer.ts`: capability promotion audit requiring capability graph, part capability, pin aliases, validation rule, simulation primitive, render footprint, supported eval prompt, unsupported counterexample, and browser-visible verification.

Missing layer:

- No first-class `SourceClaim` data that says which canonical value came from which official/vendor/educational source.
- No `HardwareSupportBundle` manifest that groups all required evidence for a hardware family or capability.
- No audit artifact that says supported capability data is source-backed, not only structurally present.

## Source Authority Model

Use these trust tiers in this order:

1. `manufacturer-official`: Arduino, Microchip, component manufacturer datasheets, official schematics, official pinout pages.
2. `vendor-technical-guide`: Adafruit, SparkFun, Pololu, Seeed, DFRobot technical guides and product pages.
3. `eda-library`: KiCad official footprint libraries, manufacturer CAD, vetted footprint repositories.
4. `educational-reference`: breadboard tutorials and beginner electronics references used only for pedagogy or simplified modeling.
5. `h-eduware-derived`: internal simplified teaching model derived from higher-tier sources.

Runtime rule:

- Deepagents do not read long source documents during every turn.
- Deepagents and deterministic tools read canonical JSON only.
- Source claims are used by audits, maintainers, promotion checks, and optional developer evidence files.

## Target Data Shape

### SourceClaim

Create a normalized claim per atomic fact. One source can back many claims, and one canonical field can cite multiple claim IDs.

```json
{
  "claimId": "arduino-uno-rev3-io-current-20ma",
  "subjectId": "arduino-uno",
  "subjectType": "part",
  "claimType": "electrical-limit",
  "fieldPath": "electrical.maxCurrentMa",
  "value": 20,
  "units": "mA",
  "sourceTier": "manufacturer-official",
  "sourceTitle": "Arduino Uno Rev3 Tech Specs",
  "sourceUrl": "https://store.arduino.cc/products/arduino-uno-rev3",
  "sourceDateChecked": "2026-06-01",
  "evidenceQuote": "DC Current per I/O Pin 20 mA",
  "confidence": "high",
  "notes": "Used as the educational safe per-pin default for starter circuits."
}
```

### HardwareSupportBundle

Group claims and canonical artifacts by capability. A bundle is the promotion unit.

```json
{
  "bundleId": "digital-light-output-starter",
  "capabilityId": "digital-light-output",
  "supportLevel": "supported",
  "requiredParts": ["arduino-uno", "breadboard-half", "led-5mm", "resistor-220", "jumper-wire"],
  "requiredArtifacts": [
    "source-claims",
    "part-capability",
    "pin-aliases",
    "validation-rule",
    "simulation-primitive",
    "render-footprint",
    "eval-supported-prompt",
    "eval-unsupported-counterexample",
    "browser-visible-verification"
  ],
  "sourceClaimIds": [
    "arduino-uno-rev3-io-current-20ma",
    "led-5mm-forward-voltage-typical",
    "resistor-220-ohm-current-limit",
    "breadboard-row-continuity-5-hole"
  ],
  "canonicalFiles": [
    "registry/part-capabilities.json",
    "electrical/component-models.json",
    "data/render-footprints.json",
    "simulation/primitives.json",
    "data/capability-graph.json"
  ],
  "browserEvidenceIds": ["context-sufficiency-digital-light-output"]
}
```

## File Structure

Create:

- `agent-context/sources/source-authority.md`: trust tiers, allowed source types, and quote-length rules.
- `agent-context/sources/source-claims.json`: normalized atomic source claims.
- `agent-context/sources/hardware-support-bundles.json`: bundle manifests keyed by capability.
- `agent-context/schemas/source-claim.schema.json`: JSON Schema for source claims.
- `agent-context/schemas/hardware-support-bundle.schema.json`: JSON Schema for bundle manifests.
- `server/context/sourceClaims.ts`: loaders and Zod validators for source claims and bundles.
- `tests/unit/sourceClaims.test.ts`: source claim and bundle validation tests.

Modify:

- `agent-context/index.json`: add `source-claims`, `hardware-support-bundles`, and `source-authority` entries.
- `agent-context/index.md`: add the provenance layer to the authority and hierarchy sections.
- `server/context/contextLayer.ts`: add `source-claims` to `REQUIRED_CAPABILITY_ARTIFACTS` and `auditCapabilityCoverage()`.
- `tests/unit/contextCoverage.test.ts`: update promotion audit expectations to include source-claim coverage.
- `docs/coworking_handoff_2026-05-31.md`: append a memo after implementation.

Do not modify in this phase:

- Deepagents prompt behavior.
- Frontend runtime UI.
- Supported hardware count.
- 3D renderer geometry.

## Task 1: Define Source Claim Schema

**Files:**

- Create: `agent-context/schemas/source-claim.schema.json`
- Create: `agent-context/sources/source-authority.md`
- Test: `tests/unit/sourceClaims.test.ts`

- [x] **Step 1: Write the failing schema test**

Add this test to `tests/unit/sourceClaims.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { SourceClaimSchema } from '../../server/context/sourceClaims.ts';

test('source claims capture one atomic hardware fact with authority metadata', () => {
  const claim = SourceClaimSchema.parse({
    claimId: 'arduino-uno-rev3-io-current-20ma',
    subjectId: 'arduino-uno',
    subjectType: 'part',
    claimType: 'electrical-limit',
    fieldPath: 'electrical.maxCurrentMa',
    value: 20,
    units: 'mA',
    sourceTier: 'manufacturer-official',
    sourceTitle: 'Arduino Uno Rev3 Tech Specs',
    sourceUrl: 'https://store.arduino.cc/products/arduino-uno-rev3',
    sourceDateChecked: '2026-06-01',
    evidenceQuote: 'DC Current per I/O Pin 20 mA',
    confidence: 'high',
    notes: 'Used as the educational safe per-pin default for starter circuits.'
  });

  assert.equal(claim.claimId, 'arduino-uno-rev3-io-current-20ma');
  assert.equal(claim.sourceTier, 'manufacturer-official');
  assert.equal(claim.fieldPath, 'electrical.maxCurrentMa');
});
```

- [x] **Step 2: Run the failing test**

Run:

```powershell
npm exec -- tsx --test tests/unit/sourceClaims.test.ts
```

Expected:

- Fails because `server/context/sourceClaims.ts` does not exist or does not export `SourceClaimSchema`.

- [x] **Step 3: Create the source claim schema**

Create `server/context/sourceClaims.ts` with:

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTEXT_ROOT = path.resolve(__dirname, '../../agent-context');

export const SourceTierSchema = z.enum([
  'manufacturer-official',
  'vendor-technical-guide',
  'eda-library',
  'educational-reference',
  'h-eduware-derived'
]);

export const SourceClaimSchema = z.object({
  claimId: z.string().min(1),
  subjectId: z.string().min(1),
  subjectType: z.enum(['part', 'pin', 'board', 'footprint', 'simulation', 'validation-rule', 'topology']),
  claimType: z.enum([
    'pin-map',
    'electrical-limit',
    'protocol-support',
    'physical-dimension',
    'breadboard-continuity',
    'simulation-model',
    'validation-rule',
    'pedagogy'
  ]),
  fieldPath: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.record(z.string(), z.unknown())]),
  units: z.string().optional(),
  sourceTier: SourceTierSchema,
  sourceTitle: z.string().min(1),
  sourceUrl: z.string().url(),
  sourceDateChecked: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/),
  evidenceQuote: z.string().min(1).max(240),
  confidence: z.enum(['high', 'medium', 'low']),
  notes: z.string().default('')
});

export type SourceClaim = z.infer<typeof SourceClaimSchema>;

export const SourceClaimListSchema = z.array(SourceClaimSchema);

export async function loadSourceClaims(root = DEFAULT_CONTEXT_ROOT): Promise<SourceClaim[]> {
  const raw = await readFile(path.join(root, 'sources/source-claims.json'), 'utf8');
  return SourceClaimListSchema.parse(JSON.parse(raw));
}
```

- [x] **Step 4: Add human source authority policy**

Create `agent-context/sources/source-authority.md`:

```markdown
# Source Authority Policy

This file defines which external sources may back H-eduware canonical context data.

## Trust Tiers

1. `manufacturer-official`: official product pages, datasheets, schematics, pinouts, and processor datasheets.
2. `vendor-technical-guide`: technical guides from reputable education/component vendors such as Adafruit, SparkFun, Pololu, Seeed, and DFRobot.
3. `eda-library`: official KiCad libraries, manufacturer CAD, or vetted footprint libraries used only for physical dimensions and footprint hints.
4. `educational-reference`: beginner electronics explanations used for pedagogy and simplified breadboard behavior.
5. `h-eduware-derived`: internal simplified teaching model derived from higher-tier claims.

## Runtime Rule

Deepagents should consume canonical context data, not long source documents. Source claims exist for auditability, maintenance, and hardware support promotion.

## Claim Rule

Each claim must be atomic. Do not combine pin mapping, electrical limits, footprint geometry, and simulation assumptions in one claim.
```

- [x] **Step 5: Verify schema test passes**

Run:

```powershell
npm exec -- tsx --test tests/unit/sourceClaims.test.ts
```

Expected:

- `source claims capture one atomic hardware fact with authority metadata` passes.

## Task 2: Seed Source Claims for the Current Starter Bundle

**Files:**

- Create: `agent-context/sources/source-claims.json`
- Modify: `tests/unit/sourceClaims.test.ts`

- [x] **Step 1: Add failing loader test**

Append:

```ts
import { loadSourceClaims } from '../../server/context/sourceClaims.ts';

test('source claim catalog loads current starter hardware claims', async () => {
  const claims = await loadSourceClaims();
  const ids = new Set(claims.map((claim) => claim.claimId));

  assert.ok(ids.has('arduino-uno-rev3-io-current-20ma'));
  assert.ok(ids.has('arduino-uno-rev3-d9-pwm-pin'));
  assert.ok(ids.has('ssd1306-i2c-oled-vcc-gnd-sda-scl'));
  assert.ok(ids.has('breadboard-row-continuity-5-hole'));
  assert.ok(ids.has('led-5mm-requires-current-limit'));
});
```

- [x] **Step 2: Run the failing loader test**

Run:

```powershell
npm exec -- tsx --test tests/unit/sourceClaims.test.ts
```

Expected:

- Fails because `agent-context/sources/source-claims.json` does not exist.

- [x] **Step 3: Create starter source claims**

Create `agent-context/sources/source-claims.json` with these initial claims:

```json
[
  {
    "claimId": "arduino-uno-rev3-io-current-20ma",
    "subjectId": "arduino-uno",
    "subjectType": "part",
    "claimType": "electrical-limit",
    "fieldPath": "electrical.maxCurrentMa",
    "value": 20,
    "units": "mA",
    "sourceTier": "manufacturer-official",
    "sourceTitle": "Arduino Uno Rev3 Tech Specs",
    "sourceUrl": "https://store.arduino.cc/products/arduino-uno-rev3",
    "sourceDateChecked": "2026-06-01",
    "evidenceQuote": "DC Current per I/O Pin 20 mA",
    "confidence": "high",
    "notes": "Used as the per-pin starter-circuit limit."
  },
  {
    "claimId": "arduino-uno-rev3-d9-pwm-pin",
    "subjectId": "arduino-uno:D9",
    "subjectType": "pin",
    "claimType": "pin-map",
    "fieldPath": "pins.D9.role",
    "value": "pwm-output",
    "sourceTier": "manufacturer-official",
    "sourceTitle": "Arduino Uno Rev3 Pinout and Tech Specs",
    "sourceUrl": "https://docs.arduino.cc/hardware/uno-rev3/",
    "sourceDateChecked": "2026-06-01",
    "evidenceQuote": "PWM Digital I/O Pins 6",
    "confidence": "high",
    "notes": "D9 is treated as PWM-capable in the canonical registry."
  },
  {
    "claimId": "ssd1306-i2c-oled-vcc-gnd-sda-scl",
    "subjectId": "oled-i2c-096",
    "subjectType": "part",
    "claimType": "pin-map",
    "fieldPath": "pins",
    "value": ["VCC", "GND", "SDA", "SCL"],
    "sourceTier": "vendor-technical-guide",
    "sourceTitle": "Adafruit SSD1306 OLED Display Guide",
    "sourceUrl": "https://learn.adafruit.com/monochrome-oled-breakouts/pinouts",
    "sourceDateChecked": "2026-06-01",
    "evidenceQuote": "Connect Vin to the power supply, 3-5V is fine. Connect GND to common power/data ground.",
    "confidence": "medium",
    "notes": "Applies to common SSD1306 I2C breakout pin naming; verify exact module variants before expanding."
  },
  {
    "claimId": "breadboard-row-continuity-5-hole",
    "subjectId": "breadboard-half",
    "subjectType": "board",
    "claimType": "breadboard-continuity",
    "fieldPath": "rendering.breadboardGrid.signalArea.rows.continuityGroup",
    "value": "five-hole terminal strips share continuity on each side of the center gap",
    "sourceTier": "vendor-technical-guide",
    "sourceTitle": "SparkFun How to Use a Breadboard",
    "sourceUrl": "https://learn.sparkfun.com/tutorials/how-to-use-a-breadboard/all",
    "sourceDateChecked": "2026-06-01",
    "evidenceQuote": "The holes in each row are electrically connected.",
    "confidence": "medium",
    "notes": "Used for simplified breadboard row continuity and hidden short detection."
  },
  {
    "claimId": "led-5mm-requires-current-limit",
    "subjectId": "led-5mm",
    "subjectType": "part",
    "claimType": "validation-rule",
    "fieldPath": "requiredPassives",
    "value": ["resistor-220"],
    "sourceTier": "educational-reference",
    "sourceTitle": "SparkFun Light-Emitting Diodes LEDs",
    "sourceUrl": "https://learn.sparkfun.com/tutorials/light-emitting-diodes-leds/all",
    "sourceDateChecked": "2026-06-01",
    "evidenceQuote": "LEDs should have a resistor in series to limit current.",
    "confidence": "medium",
    "notes": "The exact resistor value remains an H-eduware beginner default."
  }
]
```

- [x] **Step 4: Verify loader test passes**

Run:

```powershell
npm exec -- tsx --test tests/unit/sourceClaims.test.ts
```

Expected:

- Both source claim tests pass.

## Task 3: Define Hardware Support Bundle Schema

**Files:**

- Create: `agent-context/schemas/hardware-support-bundle.schema.json`
- Modify: `server/context/sourceClaims.ts`
- Modify: `tests/unit/sourceClaims.test.ts`

- [x] **Step 1: Add failing bundle schema test**

Append:

```ts
import { HardwareSupportBundleSchema } from '../../server/context/sourceClaims.ts';

test('hardware support bundle groups source claims and canonical artifacts by capability', () => {
  const bundle = HardwareSupportBundleSchema.parse({
    bundleId: 'digital-light-output-starter',
    capabilityId: 'digital-light-output',
    supportLevel: 'supported',
    requiredParts: ['arduino-uno', 'breadboard-half', 'led-5mm', 'resistor-220', 'jumper-wire'],
    requiredArtifacts: [
      'source-claims',
      'part-capability',
      'pin-aliases',
      'validation-rule',
      'simulation-primitive',
      'render-footprint',
      'eval-supported-prompt',
      'eval-unsupported-counterexample',
      'browser-visible-verification'
    ],
    sourceClaimIds: [
      'arduino-uno-rev3-io-current-20ma',
      'breadboard-row-continuity-5-hole',
      'led-5mm-requires-current-limit'
    ],
    canonicalFiles: [
      'registry/part-capabilities.json',
      'electrical/component-models.json',
      'data/render-footprints.json',
      'simulation/primitives.json',
      'data/capability-graph.json'
    ],
    browserEvidenceIds: ['context-sufficiency-digital-light-output']
  });

  assert.equal(bundle.bundleId, 'digital-light-output-starter');
  assert.equal(bundle.requiredArtifacts.includes('source-claims'), true);
});
```

- [x] **Step 2: Run the failing bundle schema test**

Run:

```powershell
npm exec -- tsx --test tests/unit/sourceClaims.test.ts
```

Expected:

- Fails because `HardwareSupportBundleSchema` is not exported.

- [x] **Step 3: Add bundle schema and loader**

Add to `server/context/sourceClaims.ts`:

```ts
export const HardwareSupportBundleSchema = z.object({
  bundleId: z.string().min(1),
  capabilityId: z.string().min(1),
  supportLevel: z.enum(['supported', 'partial', 'planned', 'unsupported']),
  requiredParts: z.array(z.string().min(1)).default([]),
  requiredArtifacts: z.array(z.enum([
    'source-claims',
    'capability-graph-entry',
    'part-capability',
    'pin-aliases',
    'validation-rule',
    'simulation-primitive',
    'render-footprint',
    'eval-supported-prompt',
    'eval-unsupported-counterexample',
    'browser-visible-verification'
  ])).min(1),
  sourceClaimIds: z.array(z.string().min(1)).default([]),
  canonicalFiles: z.array(z.string().min(1)).default([]),
  browserEvidenceIds: z.array(z.string().min(1)).default([])
});

export type HardwareSupportBundle = z.infer<typeof HardwareSupportBundleSchema>;

export const HardwareSupportBundleListSchema = z.array(HardwareSupportBundleSchema);

export async function loadHardwareSupportBundles(root = DEFAULT_CONTEXT_ROOT): Promise<HardwareSupportBundle[]> {
  const raw = await readFile(path.join(root, 'sources/hardware-support-bundles.json'), 'utf8');
  return HardwareSupportBundleListSchema.parse(JSON.parse(raw));
}
```

- [x] **Step 4: Verify bundle schema test passes**

Run:

```powershell
npm exec -- tsx --test tests/unit/sourceClaims.test.ts
```

Expected:

- Bundle schema test passes.

## Task 4: Seed Support Bundles for Current Supported Capabilities

**Files:**

- Create: `agent-context/sources/hardware-support-bundles.json`
- Modify: `tests/unit/sourceClaims.test.ts`

- [x] **Step 1: Add failing bundle loader test**

Append:

```ts
import { loadHardwareSupportBundles, loadSourceClaims } from '../../server/context/sourceClaims.ts';

test('hardware support bundles reference existing source claims', async () => {
  const [bundles, claims] = await Promise.all([
    loadHardwareSupportBundles(),
    loadSourceClaims()
  ]);
  const claimIds = new Set(claims.map((claim) => claim.claimId));
  const capabilityIds = new Set(bundles.map((bundle) => bundle.capabilityId));

  assert.ok(capabilityIds.has('display-text-output'));
  assert.ok(capabilityIds.has('digital-light-output'));
  assert.ok(capabilityIds.has('button-controlled-light-output'));
  assert.ok(capabilityIds.has('sound-alert-output'));
  assert.ok(capabilityIds.has('servo-motion-output'));

  for (const bundle of bundles) {
    assert.ok(bundle.requiredArtifacts.includes('source-claims'), `${bundle.capabilityId} requires source claims`);
    for (const claimId of bundle.sourceClaimIds) {
      assert.ok(claimIds.has(claimId), `${bundle.capabilityId} references existing claim ${claimId}`);
    }
  }
});
```

- [x] **Step 2: Run the failing bundle loader test**

Run:

```powershell
npm exec -- tsx --test tests/unit/sourceClaims.test.ts
```

Expected:

- Fails because `agent-context/sources/hardware-support-bundles.json` does not exist.

- [x] **Step 3: Create starter bundle manifest**

Create `agent-context/sources/hardware-support-bundles.json` with five bundle records. Use these IDs:

```json
[
  {
    "bundleId": "display-text-output-starter",
    "capabilityId": "display-text-output",
    "supportLevel": "supported",
    "requiredParts": ["arduino-uno", "breadboard-half", "oled-i2c-096", "jumper-wire"],
    "requiredArtifacts": ["source-claims", "capability-graph-entry", "part-capability", "pin-aliases", "validation-rule", "simulation-primitive", "render-footprint", "eval-supported-prompt", "eval-unsupported-counterexample", "browser-visible-verification"],
    "sourceClaimIds": ["arduino-uno-rev3-io-current-20ma", "arduino-uno-rev3-d9-pwm-pin", "ssd1306-i2c-oled-vcc-gnd-sda-scl", "breadboard-row-continuity-5-hole"],
    "canonicalFiles": ["registry/part-capabilities.json", "data/capability-graph.json", "data/render-footprints.json", "simulation/primitives.json"],
    "browserEvidenceIds": ["context-sufficiency-display-text-output"]
  },
  {
    "bundleId": "digital-light-output-starter",
    "capabilityId": "digital-light-output",
    "supportLevel": "supported",
    "requiredParts": ["arduino-uno", "breadboard-half", "led-5mm", "resistor-220", "jumper-wire"],
    "requiredArtifacts": ["source-claims", "capability-graph-entry", "part-capability", "pin-aliases", "validation-rule", "simulation-primitive", "render-footprint", "eval-supported-prompt", "eval-unsupported-counterexample", "browser-visible-verification"],
    "sourceClaimIds": ["arduino-uno-rev3-io-current-20ma", "arduino-uno-rev3-d9-pwm-pin", "breadboard-row-continuity-5-hole", "led-5mm-requires-current-limit"],
    "canonicalFiles": ["registry/part-capabilities.json", "data/capability-graph.json", "data/render-footprints.json", "simulation/primitives.json"],
    "browserEvidenceIds": ["context-sufficiency-digital-light-output"]
  },
  {
    "bundleId": "button-controlled-light-output-starter",
    "capabilityId": "button-controlled-light-output",
    "supportLevel": "supported",
    "requiredParts": ["arduino-uno", "breadboard-half", "button-tactile", "led-5mm", "resistor-220", "jumper-wire"],
    "requiredArtifacts": ["source-claims", "capability-graph-entry", "part-capability", "pin-aliases", "validation-rule", "simulation-primitive", "render-footprint", "eval-supported-prompt", "eval-unsupported-counterexample", "browser-visible-verification"],
    "sourceClaimIds": ["arduino-uno-rev3-io-current-20ma", "breadboard-row-continuity-5-hole", "led-5mm-requires-current-limit"],
    "canonicalFiles": ["registry/part-capabilities.json", "data/capability-graph.json", "data/render-footprints.json", "simulation/primitives.json"],
    "browserEvidenceIds": ["context-sufficiency-button-controlled-light-output"]
  },
  {
    "bundleId": "sound-alert-output-starter",
    "capabilityId": "sound-alert-output",
    "supportLevel": "supported",
    "requiredParts": ["arduino-uno", "breadboard-half", "piezo-buzzer", "jumper-wire"],
    "requiredArtifacts": ["source-claims", "capability-graph-entry", "part-capability", "pin-aliases", "validation-rule", "simulation-primitive", "render-footprint", "eval-supported-prompt", "eval-unsupported-counterexample", "browser-visible-verification"],
    "sourceClaimIds": ["arduino-uno-rev3-io-current-20ma", "breadboard-row-continuity-5-hole"],
    "canonicalFiles": ["registry/part-capabilities.json", "data/capability-graph.json", "data/render-footprints.json", "simulation/primitives.json"],
    "browserEvidenceIds": ["context-sufficiency-sound-alert-output"]
  },
  {
    "bundleId": "servo-motion-output-starter",
    "capabilityId": "servo-motion-output",
    "supportLevel": "supported",
    "requiredParts": ["arduino-uno", "breadboard-half", "micro-servo", "jumper-wire"],
    "requiredArtifacts": ["source-claims", "capability-graph-entry", "part-capability", "pin-aliases", "validation-rule", "simulation-primitive", "render-footprint", "eval-supported-prompt", "eval-unsupported-counterexample", "browser-visible-verification"],
    "sourceClaimIds": ["arduino-uno-rev3-io-current-20ma", "arduino-uno-rev3-d9-pwm-pin", "breadboard-row-continuity-5-hole"],
    "canonicalFiles": ["registry/part-capabilities.json", "data/capability-graph.json", "data/render-footprints.json", "simulation/primitives.json"],
    "browserEvidenceIds": ["context-sufficiency-servo-motion-output"]
  }
]
```

- [x] **Step 4: Verify bundle loader test passes**

Run:

```powershell
npm exec -- tsx --test tests/unit/sourceClaims.test.ts
```

Expected:

- Source claim and support bundle tests pass.

## Task 5: Expose Source Layer in Context Index

**Files:**

- Modify: `agent-context/index.json`
- Modify: `agent-context/index.md`
- Modify: `tests/unit/contextLayer.test.ts`

- [x] **Step 1: Add failing context index test**

Add to `tests/unit/contextLayer.test.ts`:

```ts
test('context index exposes source claims and support bundles as canonical data', async () => {
  const index = await loadContextIndex();
  const dataIds = new Set(index.data.map((entry) => entry.id));
  const referenceIds = new Set(index.references.map((entry) => entry.id));

  assert.ok(referenceIds.has('source-authority'));
  assert.ok(dataIds.has('source-claims'));
  assert.ok(dataIds.has('hardware-support-bundles'));

  const sourceClaims = index.data.find((entry) => entry.id === 'source-claims');
  assert.equal(sourceClaims?.canonical, true);
  assert.equal(sourceClaims?.level, 'L3');
});
```

- [x] **Step 2: Run the failing context index test**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextLayer.test.ts
```

Expected:

- Fails because the new entries are not listed in `agent-context/index.json`.

- [x] **Step 3: Add index entries**

Add to `agent-context/index.json` references:

```json
{ "id": "source-authority", "path": "sources/source-authority.md", "description": "Source trust tiers and claim collection rules.", "canonical": true, "level": "L2", "sourceType": "reference", "tags": ["sources", "provenance"] }
```

Add to `agent-context/index.json` data:

```json
{ "id": "source-claims", "path": "sources/source-claims.json", "description": "Atomic source-backed hardware facts used to audit canonical context data.", "canonical": true, "level": "L3", "sourceType": "data", "tags": ["sources", "provenance"], "provides": ["SourceClaim"] },
{ "id": "hardware-support-bundles", "path": "sources/hardware-support-bundles.json", "description": "Capability-level support bundles grouping source claims and canonical artifacts.", "canonical": true, "level": "L3", "sourceType": "data", "tags": ["sources", "promotion"], "provides": ["HardwareSupportBundle"] }
```

- [x] **Step 4: Update human-readable index**

Add to `agent-context/index.md` under `Retrieval levels`:

```markdown
- `L3`: canonical registries, source claims, support bundles, capability graph entries, topology templates, and pin aliases.
```

Add under `Data-First Expansion Rule`:

```markdown
Every supported hardware family must include source-claim coverage. A source claim proves where each critical canonical fact came from; runtime agents consume the canonical data, while audits consume the source claims.
```

- [x] **Step 5: Verify index test passes**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextLayer.test.ts
```

Expected:

- Context layer tests pass.

## Task 6: Gate Capability Promotion on Source Claims

**Files:**

- Modify: `server/context/contextLayer.ts`
- Modify: `tests/unit/contextCoverage.test.ts`

- [x] **Step 1: Add failing source-claim artifact expectation**

Update the expected artifact list in `tests/unit/contextCoverage.test.ts`:

```ts
assert.deepEqual(REQUIRED_CAPABILITY_ARTIFACTS, [
  'capability-graph-entry',
  'source-claims',
  'part-capability',
  'pin-aliases',
  'validation-rule',
  'simulation-primitive',
  'render-footprint',
  'eval-supported-prompt',
  'eval-unsupported-counterexample',
  'browser-visible-verification'
]);
```

Add this test:

```ts
test('capability promotion audit requires source claim coverage for supported capabilities', async () => {
  const report = await auditCapabilityCoverage('digital-light-output');

  assert.equal(report.capabilityId, 'digital-light-output');
  assert.equal(report.canBeSupported, true);
  assert.ok(report.present.includes('source-claims'));
  assert.deepEqual(report.missing, []);
});
```

- [x] **Step 2: Run the failing coverage tests**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextCoverage.test.ts
```

Expected:

- Fails because `REQUIRED_CAPABILITY_ARTIFACTS` does not include `source-claims` and `auditCapabilityCoverage()` does not check bundles.

- [x] **Step 3: Add source claims artifact to audit**

In `server/context/contextLayer.ts`, update:

```ts
export const REQUIRED_CAPABILITY_ARTIFACTS = [
  'capability-graph-entry',
  'source-claims',
  'part-capability',
  'pin-aliases',
  'validation-rule',
  'simulation-primitive',
  'render-footprint',
  'eval-supported-prompt',
  'eval-unsupported-counterexample',
  'browser-visible-verification'
] as const;
```

Import:

```ts
import { loadHardwareSupportBundles, loadSourceClaims } from './sourceClaims.ts';
```

Inside `auditCapabilityCoverage()`, after confirming the capability graph entry:

```ts
const [sourceClaims, supportBundles] = await Promise.all([
  loadSourceClaims(root),
  loadHardwareSupportBundles(root)
]);
const claimIds = new Set(sourceClaims.map((claim) => claim.claimId));
const supportBundle = supportBundles.find((bundle) => bundle.capabilityId === capabilityId);

if (supportBundle && supportBundle.sourceClaimIds.length > 0 && supportBundle.sourceClaimIds.every((claimId) => claimIds.has(claimId))) {
  present.add('source-claims');
} else {
  missing.add('source-claims');
  details.push(`Missing source-claim coverage for ${capabilityId}.`);
}
```

- [x] **Step 4: Verify coverage tests pass**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextCoverage.test.ts
```

Expected:

- Source claim artifact is present for supported starter capabilities.
- Planned capabilities remain blocked if no complete bundle exists.

## Task 7: Add Source Audit Report Command

**Files:**

- Create: `server/context/sourceClaimReport.ts`
- Create: `server/context/sourceClaimReportCli.ts`
- Modify: `package.json`
- Test: `tests/unit/sourceClaims.test.ts`

- [x] **Step 1: Add failing report test**

Append to `tests/unit/sourceClaims.test.ts`:

```ts
import { buildSourceClaimReport } from '../../server/context/sourceClaimReport.ts';

test('source claim report summarizes bundle coverage and trust tiers', async () => {
  const report = await buildSourceClaimReport();

  assert.ok(report.totalClaims >= 5);
  assert.ok(report.totalBundles >= 5);
  assert.ok(report.byTier['manufacturer-official'] >= 1);
  assert.ok(report.byTier['vendor-technical-guide'] >= 1);
  assert.ok(report.bundleCoverage.every((entry) => entry.missingClaimIds.length === 0));
});
```

- [x] **Step 2: Run the failing report test**

Run:

```powershell
npm exec -- tsx --test tests/unit/sourceClaims.test.ts
```

Expected:

- Fails because `sourceClaimReport.ts` does not exist.

- [x] **Step 3: Implement report builder**

Create `server/context/sourceClaimReport.ts`:

```ts
import { loadHardwareSupportBundles, loadSourceClaims, type SourceClaim } from './sourceClaims.ts';

export type SourceClaimReport = {
  totalClaims: number;
  totalBundles: number;
  byTier: Record<SourceClaim['sourceTier'], number>;
  bundleCoverage: Array<{
    bundleId: string;
    capabilityId: string;
    claimCount: number;
    missingClaimIds: string[];
  }>;
};

export async function buildSourceClaimReport(root?: string): Promise<SourceClaimReport> {
  const [claims, bundles] = await Promise.all([
    loadSourceClaims(root),
    loadHardwareSupportBundles(root)
  ]);
  const claimIds = new Set(claims.map((claim) => claim.claimId));
  const byTier = {
    'manufacturer-official': 0,
    'vendor-technical-guide': 0,
    'eda-library': 0,
    'educational-reference': 0,
    'h-eduware-derived': 0
  } satisfies Record<SourceClaim['sourceTier'], number>;

  for (const claim of claims) {
    byTier[claim.sourceTier] += 1;
  }

  return {
    totalClaims: claims.length,
    totalBundles: bundles.length,
    byTier,
    bundleCoverage: bundles.map((bundle) => ({
      bundleId: bundle.bundleId,
      capabilityId: bundle.capabilityId,
      claimCount: bundle.sourceClaimIds.length,
      missingClaimIds: bundle.sourceClaimIds.filter((claimId) => !claimIds.has(claimId))
    }))
  };
}
```

- [x] **Step 4: Implement CLI**

Create `server/context/sourceClaimReportCli.ts`:

```ts
import { buildSourceClaimReport } from './sourceClaimReport.ts';

const report = await buildSourceClaimReport();
console.log(JSON.stringify(report, null, 2));
```

Add script to `package.json`:

```json
"audit:sources": "tsx server/context/sourceClaimReportCli.ts"
```

- [x] **Step 5: Verify report test and CLI**

Run:

```powershell
npm exec -- tsx --test tests/unit/sourceClaims.test.ts
npm run audit:sources
```

Expected:

- Tests pass.
- CLI prints JSON with `totalClaims`, `totalBundles`, `byTier`, and `bundleCoverage`.

## Task 8: Create Collection Playbook for Future Hardware

**Files:**

- Create: `agent-context/sources/collection-playbook.md`
- Modify: `agent-context/index.json`

- [x] **Step 1: Create collection playbook**

Create `agent-context/sources/collection-playbook.md`:

```markdown
# Hardware Context Collection Playbook

Use this checklist before moving a hardware request from `planned` or `visual-only` to `supported`.

## Required Collection Steps

1. Identify the student capability, not only the part name.
2. Collect manufacturer-official or vendor-technical-guide sources for pin map, voltage/current limits, protocol support, and required passives.
3. Create atomic `SourceClaim` records for each critical canonical field.
4. Add or update `part-capabilities.json`.
5. Add pin aliases in `ontology/pin-aliases.json`.
6. Add validation rules or topology support.
7. Add simulation primitive or map to an existing primitive.
8. Add render footprint with pin anchors and placement rules.
9. Add supported eval prompt and unsupported counterexample.
10. Add browser-visible verification evidence.
11. Add or update the `HardwareSupportBundle`.
12. Run `npm run audit:sources`, `npm run audit:capabilities`, `npm run eval:generalization:report`, and `npm run check`.

## Promotion Rule

The app may answer unsupported or planned questions with safe guidance before a full bundle exists. It may not generate build-ready wiring, PCB rendering, or current-flow simulation until the bundle audit passes.
```

- [x] **Step 2: Add playbook to index**

Add to `agent-context/index.json` references:

```json
{ "id": "source-collection-playbook", "path": "sources/collection-playbook.md", "description": "Step-by-step process for collecting source-backed hardware context bundles.", "canonical": true, "level": "L2", "sourceType": "reference", "tags": ["sources", "promotion"] }
```

- [x] **Step 3: Verify index references**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextLayer.test.ts
```

Expected:

- No broken context references.

## Task 9: Add Initial Backlog for Hardware Bundle Collection

**Files:**

- Create: `docs/context-source-bundle-backlog.md`

- [x] **Step 1: Create backlog document**

Create `docs/context-source-bundle-backlog.md`:

```markdown
# Context Source Bundle Backlog

## Current Supported Bundle Hardening

1. Arduino Uno Rev3 controller bundle
   - Claims: pin map, PWM pins, 5V/3.3V rails, per-pin current, board dimensions.
   - Sources: Arduino official specs, Arduino pinout, ATmega328P datasheet.

2. Breadboard half-size bundle
   - Claims: terminal strip continuity, center gap isolation, power rail continuity, 0.1 inch pitch.
   - Sources: SparkFun breadboard guide, Adafruit breadboard guide, physical measurement notes.

3. LED + resistor bundle
   - Claims: LED polarity, forward voltage teaching default, current limiting requirement, 220 ohm beginner default.
   - Sources: vendor LED tutorials, representative LED datasheet, H-eduware derived Ohm's law calculation.

4. OLED I2C bundle
   - Claims: VCC/GND/SDA/SCL pins, I2C behavior, common 3.3V/5V module compatibility warning, display current teaching default.
   - Sources: Adafruit SSD1306 guide, representative SSD1306 module guide.

5. Button, buzzer, servo bundles
   - Claims: pin roles, polarity, current warnings, PWM signal requirements.
   - Sources: vendor guides and representative product datasheets.

## Planned Capability Candidates

1. Potentiometer LED dimmer
   - Required before support: potentiometer part capability, voltage divider validation, analog input primitive, knob render footprint, browser eval.

2. Ultrasonic distance sensor display
   - Required before support: HC-SR04 pin/electrical claims, trigger/echo timing model, sensor render footprint, sensor-display simulation primitive, browser eval.

3. DHT11 temperature display
   - Required before support: DHT11 pin/electrical claims, one-wire-like protocol simplification, sensor render footprint, display integration eval.

## Broad Visual Library Triage

Do not convert all visual library parts to supported. For each visual-only part, classify it as:

- `agent-ready`: full bundle exists.
- `planned`: useful educational target but bundle incomplete.
- `visual-only`: can be shown in the library but cannot be wired or simulated.
- `unsupported`: unsafe, too advanced, or outside H-eduware educational scope.
```

- [x] **Step 2: Verify backlog exists**

Run:

```powershell
Test-Path docs\context-source-bundle-backlog.md
```

Expected:

- Prints `True`.

## Task 10: Full Verification

**Files:**

- No new files.

- [x] **Step 1: Run source-specific verification**

Run:

```powershell
npm exec -- tsx --test tests/unit/sourceClaims.test.ts
npm run audit:sources
```

Expected:

- Source claim tests pass.
- Source audit JSON prints no missing claim IDs for supported starter bundles.

- [x] **Step 2: Run context verification**

Run:

```powershell
npm exec -- tsx --test tests/unit/contextLayer.test.ts tests/unit/contextCoverage.test.ts
npm run audit:capabilities
npm run eval:generalization:report
```

Expected:

- Context index has no broken references.
- Supported capabilities still pass promotion audit.
- Planned capabilities remain blocked with explicit missing artifacts.

- [x] **Step 3: Run acceptance gate**

Run:

```powershell
npm run check
```

Expected:

- Unit tests, typecheck, production build, and Playwright E2E pass.
- Live agent tests remain opt-in and skipped unless `check:live` is explicitly used.

- [x] **Step 4: Document coworking handoff**

Append to `docs/coworking_handoff_2026-05-31.md`:

```markdown
## 34. 2026-06-01 Context Source Bundle Collection Memo

Added a source-backed hardware context collection layer:

- `SourceClaim` records capture atomic official/vendor/educational source facts.
- `HardwareSupportBundle` records group source claims with canonical artifacts by capability.
- Capability promotion now requires source-claim coverage in addition to registry, validation, render, simulation, eval, and browser evidence.
- Runtime Deepagents still consume canonical context data; source claims are for audits and maintainers.

Verification:

- `npm exec -- tsx --test tests/unit/sourceClaims.test.ts`
- `npm run audit:sources`
- `npm exec -- tsx --test tests/unit/contextLayer.test.ts tests/unit/contextCoverage.test.ts`
- `npm run audit:capabilities`
- `npm run eval:generalization:report`
- `npm run check`
```

## Execution Notes

- This plan intentionally does not add new supported hardware.
- The first implementation should prove the source/bundle pipeline with the already-supported starter capabilities.
- After this is in place, new hardware support becomes a data collection and promotion task, not an LLM prompt-engineering task.
- If source claims disagree with existing canonical data, do not silently update the runtime value. Create a failing test and review the impact on validation, render, simulation, and browser evidence.

## Acceptance Criteria

- `source-claims` and `hardware-support-bundles` are first-class context index entries.
- Every supported capability has source-claim coverage.
- `auditCapabilityCoverage()` includes `source-claims` as a required artifact.
- `npm run audit:sources` reports source tier counts and bundle coverage.
- Planned/visual-only hardware still cannot produce build-ready wiring, PCB rendering, or current-flow simulation.
- `npm run check` passes after implementation.

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSourceClaimReport } from '../../server/context/sourceClaimReport.ts';
import {
  HardwareSupportBundleSchema,
  SourceClaimSchema,
  loadHardwareSupportBundles,
  loadSourceClaims
} from '../../server/context/sourceClaims.ts';

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

test('source claim catalog loads current starter hardware claims', async () => {
  const claims = await loadSourceClaims();
  const ids = new Set(claims.map((claim) => claim.claimId));

  assert.ok(ids.has('arduino-uno-rev3-io-current-20ma'));
  assert.ok(ids.has('arduino-uno-rev3-d9-pwm-pin'));
  assert.ok(ids.has('ssd1306-i2c-oled-vcc-gnd-sda-scl'));
  assert.ok(ids.has('breadboard-row-continuity-5-hole'));
  assert.ok(ids.has('led-5mm-requires-current-limit'));
  assert.ok(ids.has('hc-sr04-four-pin-5v-trigger-echo'));
  assert.ok(ids.has('hc-sr04-trigger-echo-distance-timing'));
  assert.ok(ids.has('dht11-power-current-sampling'));
  assert.ok(ids.has('dht11-vdd-data-gnd-single-bus'));
  assert.ok(ids.has('dht11-40bit-temperature-humidity-data'));
});

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
  assert.ok(capabilityIds.has('analog-led-dimmer'));
  assert.ok(capabilityIds.has('light-sensor-triggered-output'));
  assert.ok(capabilityIds.has('distance-sensor-display'));
  assert.ok(capabilityIds.has('dht11-temperature-humidity-display'));

  for (const bundle of bundles) {
    assert.ok(bundle.requiredArtifacts.includes('source-claims'), `${bundle.capabilityId} requires source claims`);
    for (const claimId of bundle.sourceClaimIds) {
      assert.ok(claimIds.has(claimId), `${bundle.capabilityId} references existing claim ${claimId}`);
    }
  }
});

test('source claim report summarizes bundle coverage and trust tiers', async () => {
  const report = await buildSourceClaimReport();

  assert.ok(report.totalClaims >= 5);
  assert.ok(report.totalBundles >= 5);
  assert.ok(report.byTier['manufacturer-official'] >= 1);
  assert.ok(report.byTier['vendor-technical-guide'] >= 1);
  assert.ok(report.bundleCoverage.every((entry) => entry.missingClaimIds.length === 0));
  assert.ok(report.bundleCoverage.every((entry) => entry.missingBrowserEvidenceIds.length === 0));
  assert.ok(report.bundleCoverage.every((entry) => entry.browserEvidenceCount > 0));
});

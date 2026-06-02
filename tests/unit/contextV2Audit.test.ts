import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildContextV2Audit, contextV2AuditHasFailures } from '../../server/context/contextV2Audit.ts';

test('context v2 audit reports migrated and missing capability bundles', async () => {
  const audit = await buildContextV2Audit();

  assert.ok(audit.totalCapabilities >= 1);
  assert.ok(audit.migratedCapabilityIds.includes('digital-light-output'));
  assert.ok(audit.migratedCapabilityIds.includes('display-text-output'));
  assert.ok(audit.migratedCapabilityIds.includes('analog-led-dimmer'));
  assert.ok(audit.migratedCapabilityIds.includes('light-sensor-triggered-output'));
  assert.ok(audit.migratedCapabilityIds.includes('dht11-temperature-humidity-display'));
  assert.ok(audit.migratedCapabilityIds.includes('button-controlled-light-output'));
  assert.ok(audit.migratedCapabilityIds.includes('sound-alert-output'));
  assert.ok(audit.migratedCapabilityIds.includes('servo-motion-output'));
  assert.ok(audit.supportedV2BundleIds.includes('light-sensor-triggered-output'));
  assert.ok(audit.supportedV2BundleIds.includes('dht11-temperature-humidity-display'));
  assert.ok(audit.supportedV2BundleIds.includes('button-controlled-light-output'));
  assert.ok(audit.supportedV2BundleIds.includes('sound-alert-output'));
  assert.ok(audit.supportedV2BundleIds.includes('servo-motion-output'));
  assert.ok(audit.manifestConsistency.every((entry) => entry.missingCanonicalRefs.length === 0));
  assert.ok(audit.manifestConsistency.every((entry) => entry.unresolvedCanonicalRefs.length === 0));
  assert.ok(audit.manifestConsistency.every((entry) => entry.sourceRefMismatches.length === 0));
  assert.ok(audit.manifestConsistency.every((entry) => entry.blockingConditionIssues.length === 0));
  assert.equal(contextV2AuditHasFailures(audit), false);
  assert.deepEqual(audit.missingBundleCapabilityIds, [
    'autonomous-wireless-robotics',
    'high-voltage-load-control',
    'home-security-actuator'
  ]);
});

test('context v2 audit fails unresolved canonical refs and legacy source drift', async () => {
  const root = await copyContextFixture();
  try {
    const manifestPath = path.join(root, 'v2/bundles/display-text-output/manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.requiredTopologies = ['missing-topology'];
    manifest.canonicalRefs.topology = ['shared:topology:missing-topology'];
    manifest.canonicalRefs.sources = ['shared:source:ssd1306-i2c-oled-vcc-gnd-sda-scl'];
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const audit = await buildContextV2Audit(root);
    const entry = audit.manifestConsistency.find((candidate) =>
      candidate.bundleId === 'display-text-output'
    );

    assert.ok(entry);
    assert.ok(entry.unresolvedCanonicalRefs.includes('topology:shared:topology:missing-topology'));
    assert.ok(entry.sourceRefMismatches.includes('legacy-source-missing-in-v2:arduino-uno-rev3-io-current-20ma'));
    assert.ok(entry.sourceRefMismatches.includes('legacy-source-missing-in-v2:arduino-uno-rev3-i2c-a4-a5'));
    assert.ok(entry.sourceRefMismatches.includes('legacy-source-missing-in-v2:breadboard-row-continuity-5-hole'));
    assert.equal(contextV2AuditHasFailures(audit), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function copyContextFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'h-eduware-context-v2-audit-'));
  await cp(path.resolve('agent-context'), root, { recursive: true });
  return root;
}

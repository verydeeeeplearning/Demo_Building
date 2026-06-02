import test from 'node:test';
import assert from 'node:assert/strict';

import { getPartRegistry } from '../../server/context/contextLayer.ts';
import {
  PartBundleSchema,
  resolveAllPartBundles,
  resolvePartBundle
} from '../../server/context/partBundle.ts';

test('every registry part resolves to a schema-valid L0 bundle with complete inline canonical fields', async () => {
  const [bundles, parts] = await Promise.all([resolveAllPartBundles(), getPartRegistry()]);

  // L0 "전수 resolvable" gate: every registry part has a bundle, one-to-one.
  assert.equal(bundles.length, parts.length, 'one bundle per registry part');
  assert.equal(new Set(bundles.map((b) => b.partId)).size, parts.length, 'no duplicate part bundles');

  for (const bundle of bundles) {
    assert.doesNotThrow(() => PartBundleSchema.parse(bundle), `${bundle.partId} bundle is schema-valid`);
    assert.ok(bundle.part.pins.length > 0, `${bundle.partId} has pins/roles`);
    assert.ok(bundle.part.electrical.voltageRange, `${bundle.partId} has electrical limits`);
    assert.ok(bundle.part.renderFootprint.type, `${bundle.partId} has a render footprint`);
    assert.ok(bundle.part.simulationModel.type, `${bundle.partId} has a simulation model`);
  }
});

test('source claims attach by subjectId union sourceClaimIds for the vast majority of parts', async () => {
  const bundles = await resolveAllPartBundles();
  const withClaims = bundles.filter((bundle) => bundle.sourceClaims.length > 0);

  // The union join recovers claims even for legacy parts lacking an explicit
  // sourceClaimIds field, so coverage should be broad (not just curated parts).
  assert.ok(
    withClaims.length >= bundles.length - 5,
    `expected most parts to have provenance claims, got ${withClaims.length}/${bundles.length}`
  );

  // arduino-uno is a known claim subject — it must resolve provenance.
  const arduino = await resolvePartBundle('arduino-uno');
  assert.ok(arduino, 'arduino-uno resolves');
  assert.ok(arduino.sourceClaims.length > 0, 'arduino-uno has provenance source claims');
  for (const claim of arduino.sourceClaims) {
    const links =
      claim.subjectId === 'arduino-uno' || arduino.part.sourceClaimIds.includes(claim.claimId);
    assert.ok(links, `claim ${claim.claimId} links to arduino-uno by subjectId or sourceClaimIds`);
  }
});

test('data gaps surface as explicit blockingConditions, never silently', async () => {
  const bundles = await resolveAllPartBundles();

  for (const bundle of bundles) {
    assert.ok(Array.isArray(bundle.blockingConditions), `${bundle.partId} has blockingConditions array`);
    // Invariant: missing-source-claims iff zero resolved claims.
    const hasMissingClaims = bundle.blockingConditions.includes('missing-source-claims');
    assert.equal(
      hasMissingClaims,
      bundle.sourceClaims.length === 0,
      `${bundle.partId} missing-source-claims flag matches claim count`
    );
    // Invariant: missing-simulation-primitive iff no compatible primitives.
    const hasMissingSim = bundle.blockingConditions.includes('missing-simulation-primitive');
    assert.equal(
      hasMissingSim,
      bundle.part.compatibleSimulationPrimitives.length === 0,
      `${bundle.partId} missing-simulation-primitive flag matches primitive count`
    );
  }
});

test('unknown part id resolves to null, known id is consistent across resolvers', async () => {
  assert.equal(await resolvePartBundle('definitely-not-a-real-part'), null);

  const bundles = await resolveAllPartBundles();
  const single = await resolvePartBundle(bundles[0].partId);
  assert.deepEqual(single, bundles[0], 'single resolve matches the all-resolve record');
});

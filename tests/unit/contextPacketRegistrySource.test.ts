import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildContextPacket } from '../../server/context/contextPacket.ts';
import { getPartRegistry } from '../../server/context/contextLayer.ts';
import { measureContextEfficiency } from '../../server/agent/contextEfficiency.ts';
import { makeSyntheticPart } from '../fixtures/inCatalogCorpus.ts';
import type { PartCapability } from '../../server/agent/schemas.ts';

// Phase 0.5 seam 0.5.3: the part registry is injectable into buildContextPacket so tests can
// double / grow the catalog (the Phase 2 catalog-growth test depends on this).

const LED_REQUEST = { message: 'LED 하나를 저항이랑 같이 깜빡이게 해줘', locale: 'ko' as const };

void test('buildContextPacket uses the injected registrySource for a registry-loading request', async () => {
  let called = 0;
  const real = await getPartRegistry();
  const registrySource = async () => {
    called += 1;
    return real;
  };
  const packet = await buildContextPacket(LED_REQUEST, { registrySource });
  assert.ok(called >= 1, 'the injected registrySource was actually used');
  assert.ok(packet.candidateParts.some((p) => p.id === 'led-5mm'), 'real selection still works through the seam');
});

void test('a doubled synthetic registry is observable via measureContextEfficiency (growth seam)', async () => {
  const real = await getPartRegistry();
  const doubled: PartCapability[] = [...real, ...real.map((_, i) => makeSyntheticPart(i))];
  const baseline = await measureContextEfficiency(LED_REQUEST);
  const grown = await measureContextEfficiency({ ...LED_REQUEST, registrySource: async () => doubled });

  assert.equal(baseline.candidatesConsidered, real.length);
  assert.equal(grown.candidatesConsidered, doubled.length, 'injected catalog size is reflected (the O(catalog) signal)');
  // The synthetic parts do not match the LED request, so the SELECTED candidates are unchanged —
  // the legacy path still scans the whole (now larger) catalog. Phase 2 makes the scan O(request).
  assert.ok(grown.candidatePartIds.includes('led-5mm'));
  assert.ok(!grown.candidatePartIds.some((id) => id.startsWith('synthetic-part-')));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { selectContextByComposition } from '../../server/context/compositionSelection.ts';
import { getPartRegistry } from '../../server/context/contextLayer.ts';
import {
  partFulfillsInputModality,
  partFulfillsOutputModality
} from '../../server/agent/modalityFulfillment.ts';
import { loadInCatalogCorpus } from '../fixtures/inCatalogCorpus.ts';
import type { PartCapability } from '../../server/agent/schemas.ts';

// Phase 2 (RC-B): composition must guarantee every REQUIRED input/output modality of a driving
// capability is covered by at least one candidate. The trace bug: input devices live in
// `optionalParts` (a 1-of-N choice), so composition offered the controller + display but NO input
// device — the agent then invented a non-candidate part and was rejected
// (CONTEXT_CANDIDATE_PART_NOT_ALLOWED / INTENT_INPUT_NOT_FULFILLED).

async function messageFor(caseId: string): Promise<string> {
  const corpus = await loadInCatalogCorpus();
  const found = corpus.cases.find((c) => c.id === caseId);
  assert.ok(found, `corpus case ${caseId} must exist`);
  return found.message;
}

async function candidatesFor(caseId: string): Promise<PartCapability[]> {
  const message = await messageFor(caseId);
  const selection = await selectContextByComposition({ message });
  const registry = await getPartRegistry();
  const byId = new Map(registry.map((p) => [p.id, p]));
  return selection.candidatePartIds.map((id) => byId.get(id)).filter((p): p is PartCapability => p !== undefined);
}

const INPUT_GAP_CASES: Array<{ caseId: string; modality: string }> = [
  { caseId: 'base-digital-input-display-readout', modality: 'digital-input' },
  { caseId: 'base-digital-input-threshold-output', modality: 'digital-input' },
  { caseId: 'base-analog-sensor-display-readout', modality: 'analog-sensor' },
  { caseId: 'base-analog-sensor-threshold-output', modality: 'analog-sensor' },
  { caseId: 'base-matrix-input-display-readout', modality: 'matrix-input' }
];

for (const { caseId, modality } of INPUT_GAP_CASES) {
  void test(`RC-B: ${caseId} offers >=1 input device fulfilling ${modality}`, async () => {
    const candidates = await candidatesFor(caseId);
    const hit = candidates.filter((p) => partFulfillsInputModality(p, modality));
    assert.ok(hit.length >= 1, `expected an input device for ${modality}, got candidates: ${candidates.map((p) => p.id).join(', ')}`);
  });
}

void test('RC-B: digital-input-display offers a device covering BOTH digital-input AND digital-sensor', async () => {
  // The gate requires every declared modality; this capability declares both. A single digital
  // sensor (e.g. ttp223/hall-effect) covers both — composition must offer at least one such device.
  const candidates = await candidatesFor('base-digital-input-display-readout');
  const both = candidates.filter(
    (p) => partFulfillsInputModality(p, 'digital-input') && partFulfillsInputModality(p, 'digital-sensor')
  );
  assert.ok(both.length >= 1, `expected a device covering both digital-input+digital-sensor, got: ${candidates.map((p) => p.id).join(', ')}`);
});

void test('RC-B no-bloat: an output-only capability (spi-display) gains NO input device', async () => {
  const candidates = await candidatesFor('base-spi-display-output');
  const inputs = candidates.filter((p) => p.kind === 'input');
  assert.equal(inputs.length, 0, `spi-display must stay output-only, got inputs: ${inputs.map((p) => p.id).join(', ')}`);
  // and its required output modalities remain covered
  assert.ok(candidates.some((p) => partFulfillsOutputModality(p, 'display')), 'display still covered');
  assert.ok(candidates.some((p) => partFulfillsOutputModality(p, 'spi-display')), 'spi-display still covered');
});

void test('RC-B determinism: the same message yields the same candidate set', async () => {
  const message = await messageFor('base-digital-input-display-readout');
  const a = await selectContextByComposition({ message });
  const b = await selectContextByComposition({ message });
  assert.deepEqual(a.candidatePartIds, b.candidatePartIds);
});

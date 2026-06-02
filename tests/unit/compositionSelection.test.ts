import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  loadCompositionalCapabilityIds,
  selectContextByComposition
} from '../../server/context/compositionSelection.ts';
import { getPartRegistry } from '../../server/context/contextLayer.ts';
import { loadInCatalogCorpus, makeSyntheticPart, type CorpusCase } from '../fixtures/inCatalogCorpus.ts';

// Phase 2 — composition selection + retrieval index. The in-catalog corpus is the SOLE parity
// gate. Composition must match or exceed legacy AND fix the broken cases, while being O(request):
// candidates-considered does not grow with the catalog.

function candidatesSatisfy(candidateIds: Set<string>, c: CorpusCase): boolean {
  return c.mustIncludePartIds.every((id) => candidateIds.has(id))
    && c.mustExcludePartIds.every((id) => !candidateIds.has(id));
}

// Cases that legacy + Phase-1 tier selection could NOT satisfy; composition must fix all of them.
const PREVIOUSLY_BROKEN = [
  'collision-01-oled-breadboard',
  'variant-display-text-prototyping-surface-context',
  'variant-display-text-connector-wiring-context',
  'collision-02-led-breadboard'
];

void test('2.1 composition selection satisfies the ENTIRE in-catalog corpus (parity + fixes)', async () => {
  const corpus = await loadInCatalogCorpus();
  const failures: string[] = [];
  for (const c of corpus.cases) {
    const selection = await selectContextByComposition({ message: c.message });
    if (!candidatesSatisfy(new Set(selection.candidatePartIds), c)) {
      failures.push(`${c.id} -> [${selection.candidatePartIds.join(', ')}]`);
    }
  }
  assert.deepEqual(failures, [], `composition must satisfy every corpus case; failed: ${failures.join(' | ')}`);
});

void test('2.1 composition fixes every case that legacy + tier selection could not', async () => {
  const corpus = await loadInCatalogCorpus();
  for (const id of PREVIOUSLY_BROKEN) {
    const c = corpus.cases.find((x) => x.id === id);
    assert.ok(c, `corpus must contain ${id}`);
    const selection = await selectContextByComposition({ message: c.message });
    assert.ok(
      candidatesSatisfy(new Set(selection.candidatePartIds), c),
      `${id} must be fixed by composition; got [${selection.candidatePartIds.join(', ')}]`
    );
  }
});

void test('2.2 catalog-growth: doubling the registry keeps candidates-considered and selection flat (O(request))', async () => {
  const real = await getPartRegistry();
  const doubled = [...real, ...real.map((_, i) => makeSyntheticPart(i))];
  const message = 'LED 하나를 저항이랑 같이 깜빡이게 해줘';

  const base = await selectContextByComposition({ message });
  const grown = await selectContextByComposition({ message }, { registrySource: async () => doubled });

  assert.equal(grown.candidatesConsidered, base.candidatesConsidered, 'considered count must not grow with the catalog');
  assert.deepEqual(grown.candidatePartIds, base.candidatePartIds, 'selection must be invariant to irrelevant catalog growth');
  // The considered set is request-bounded, far smaller than even the original catalog.
  assert.ok(base.candidatesConsidered < real.length / 4, `considered ${base.candidatesConsidered} should be O(request), not O(catalog ${real.length})`);
  assert.ok(!grown.candidatePartIds.some((id) => id.startsWith('synthetic-part-')), 'synthetic parts are never selected');
});

void test('2.3 compositional capability ids derive from explicit route tier (no -context suffix parsing)', async () => {
  const ids = await loadCompositionalCapabilityIds();
  assert.ok(ids.has('prototyping-surface-context'));
  assert.ok(ids.has('connector-wiring-context'));
  assert.ok(ids.has('logic-interface-context'));
  assert.ok(!ids.has('display-text-output'), 'a primary-output capability is not compositional');
});

void test('2.3 the top primary capability drives the build (OLED -> display-text-output)', async () => {
  const selection = await selectContextByComposition({
    message: '아두이노 브레드보드에 I2C OLED로 이벤트 이름 텍스트를 표시하고 싶어'
  });
  assert.equal(selection.primaryCapabilityId, 'display-text-output');
  assert.ok(selection.candidatePartIds.includes('oled-i2c-096'));
});

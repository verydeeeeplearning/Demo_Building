import assert from 'node:assert/strict';
import { test } from 'node:test';

import { measureContextEfficiency } from '../../server/agent/contextEfficiency.ts';
import { loadContextV2Routes } from '../../server/context/contextLayer.ts';
import { loadInCatalogCorpus, type CorpusCase } from '../fixtures/inCatalogCorpus.ts';

// Phase 1 — tier separation. A compositional-context route (surface/wiring/passive) must not
// out-rank the primary-output route the student actually wants and drop the needed output part.
// All new behavior is gated behind H_EDUWARE_AGENT_PIPELINE; legacy is provably unchanged.

const OLED_BREADBOARD = '아두이노 브레드보드에 I2C OLED로 이벤트 이름 텍스트를 표시하고 싶어';
const UNNAMED_SURFACES = ['perfboard-5x7', 'pcb-blank-single', 'proto-shield-uno'];

const COMPOSITIONAL_ROUTE_IDS = [
  'v2-connector-wiring-context',
  'v2-logic-interface-context',
  'v2-passive-protection-context',
  'v2-prototyping-surface-context',
  'v2-timing-passive-context'
].sort();

function candidatesSatisfy(candidateIds: Set<string>, c: CorpusCase): boolean {
  return c.mustIncludePartIds.every((id) => candidateIds.has(id))
    && c.mustExcludePartIds.every((id) => !candidateIds.has(id));
}

void test('route tier: the 5 compositional routes are tier=compositional-context, others default primary-output', async () => {
  const routes = await loadContextV2Routes();
  const compositional = routes.routes
    .filter((r) => r.tier === 'compositional-context')
    .map((r) => r.routeId)
    .sort();
  assert.deepEqual(compositional, COMPOSITIONAL_ROUTE_IDS);
  assert.equal(routes.routes.find((r) => r.routeId === 'v2-display-text-output')?.tier, 'primary-output');
});

void test('LEGACY unchanged: OLED+breadboard still mis-routes to the prototyping surface and drops the OLED', async () => {
  const m = await measureContextEfficiency({ message: OLED_BREADBOARD, locale: 'ko', pipelineMode: 'legacy' });
  assert.equal(m.routeId, 'v2-prototyping-surface-context');
  assert.ok(!m.candidatePartIds.includes('oled-i2c-096'), 'legacy still drops the OLED');
});

void test('NEXT fixes OLED+breadboard: OLED + controller + ONLY the named surface survive', async () => {
  const m = await measureContextEfficiency({ message: OLED_BREADBOARD, locale: 'ko', pipelineMode: 'next' });
  assert.notEqual(m.routeId, 'v2-prototyping-surface-context', 'no longer routes to the compositional surface');
  assert.ok(m.candidatePartIds.includes('oled-i2c-096'), 'the explicitly-named OLED is kept');
  assert.ok(m.candidatePartIds.includes('arduino-uno'), 'the controller is kept');
  assert.ok(m.candidatePartIds.includes('breadboard-half'), 'the named surface is kept');
  for (const surface of UNNAMED_SURFACES) {
    assert.ok(!m.candidatePartIds.includes(surface), `unnamed surface ${surface} is excluded`);
  }
});

void test('corpus: NEXT is a strict improvement over LEGACY (zero regressions; fixes the OLED collision)', async () => {
  const corpus = await loadInCatalogCorpus();
  const regressions: string[] = [];
  let collisionFixedByNext = false;

  for (const c of corpus.cases) {
    const legacy = await measureContextEfficiency({ message: c.message, locale: c.locale, pipelineMode: 'legacy' });
    const next = await measureContextEfficiency({ message: c.message, locale: c.locale, pipelineMode: 'next' });
    const legacyPasses = candidatesSatisfy(new Set(legacy.candidatePartIds), c);
    const nextPasses = candidatesSatisfy(new Set(next.candidatePartIds), c);

    if (legacyPasses && !nextPasses) regressions.push(c.id);
    if (c.id === 'collision-01-oled-breadboard') {
      assert.equal(legacyPasses, false, 'OLED collision fails under legacy (the known bug)');
      assert.equal(nextPasses, true, 'OLED collision is fixed under next');
      collisionFixedByNext = true;
    }
  }

  assert.deepEqual(regressions, [], 'tier-aware selection must not regress any case that passes under legacy');
  assert.ok(collisionFixedByNext, 'the OLED collision case must be present and fixed');
});

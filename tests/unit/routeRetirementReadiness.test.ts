import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadContextV2Routes } from '../../server/context/contextLayer.ts';
import { selectContextByComposition } from '../../server/context/compositionSelection.ts';
import { loadInCatalogCorpus, type CorpusCase } from '../fixtures/inCatalogCorpus.ts';

// Phase 5.1 — route-retirement READINESS (non-destructive proof). Composition selection covers the
// whole corpus, so the enumerated per-capability routes are redundant for SELECTION; only the
// irreducible safety / unsupported / ambiguous-minimal / general routes remain necessary.
//
// This test proves the enumerated routes CAN be retired. The actual deletion + flipping the
// production default to `next` (Phase 5.2 / 6.5) is gated by the opt-in live smoke + a human
// reviewer, so it is intentionally NOT performed here.

const IRREDUCIBLE_ROUTE_IDS = ['v2-ambiguous-minimal', 'unsupported-safety', 'supported-hardware-general'];

function isIrreducible(route: { routeId: string; when: { unsafe?: boolean; ambiguity?: boolean; capabilityIds: string[] } }): boolean {
  return Boolean(route.when.unsafe)
    || Boolean(route.when.ambiguity)
    || route.routeId === 'supported-hardware-general'
    || route.when.capabilityIds.length === 0;
}

function candidatesSatisfy(candidateIds: Set<string>, c: CorpusCase): boolean {
  return c.mustIncludePartIds.every((id) => candidateIds.has(id))
    && c.mustExcludePartIds.every((id) => !candidateIds.has(id));
}

void test('routes split into a small irreducible set + enumerated capability routes', async () => {
  const routes = await loadContextV2Routes();
  const irreducible = routes.routes.filter(isIrreducible).map((r) => r.routeId).sort();
  const enumerated = routes.routes.filter((r) => !isIrreducible(r));

  assert.deepEqual(irreducible, [...IRREDUCIBLE_ROUTE_IDS].sort());
  assert.ok(enumerated.length >= 30, `expected many enumerated capability routes, got ${enumerated.length}`);
});

void test('composition covers the corpus, so the enumerated capability routes are retirable', async () => {
  const corpus = await loadInCatalogCorpus();
  const uncovered: string[] = [];
  for (const c of corpus.cases) {
    const selection = await selectContextByComposition({ message: c.message });
    if (!candidatesSatisfy(new Set(selection.candidatePartIds), c)) {
      uncovered.push(c.id);
    }
  }
  assert.deepEqual(uncovered, [], 'composition must cover every corpus case before routes can be retired');
});

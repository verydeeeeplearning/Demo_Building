import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildContextPacket } from '../../server/context/contextPacket.ts';
import { loadInCatalogCorpus, type CorpusCase } from '../fixtures/inCatalogCorpus.ts';

// Phase 5 (live switch) — under `next`, composition selection is the candidate authority on the
// LIVE buildContextPacket path, so the packet covers the whole corpus. `legacy` is unchanged;
// `shadow` keeps the tier path (composition is observed separately). Flipping the production default
// to `next` remains gated by the opt-in live smoke + a human reviewer.

function packetSatisfies(candidateIds: Set<string>, c: CorpusCase): boolean {
  return c.mustIncludePartIds.every((id) => candidateIds.has(id))
    && c.mustExcludePartIds.every((id) => !candidateIds.has(id));
}

async function corpusPassCount(mode: 'legacy' | 'next'): Promise<number> {
  const corpus = await loadInCatalogCorpus();
  let pass = 0;
  for (const c of corpus.cases) {
    const packet = await buildContextPacket({ message: c.message, locale: c.locale }, { pipelineMode: mode });
    if (packetSatisfies(new Set(packet.candidateParts.map((p) => p.id)), c)) pass += 1;
  }
  return pass;
}

void test('under `next`, the live context packet covers the ENTIRE corpus via composition', async () => {
  const corpus = await loadInCatalogCorpus();
  assert.equal(await corpusPassCount('next'), corpus.cases.length);
});

void test('`legacy` live packet is unchanged (the known 33/37 baseline)', async () => {
  assert.equal(await corpusPassCount('legacy'), 33);
});

void test('the OLED+breadboard packet keeps the OLED under `next` but drops it under `legacy`', async () => {
  const message = '아두이노 브레드보드에 I2C OLED로 이벤트 이름 텍스트를 표시하고 싶어';
  const next = await buildContextPacket({ message, locale: 'ko' }, { pipelineMode: 'next' });
  const legacy = await buildContextPacket({ message, locale: 'ko' }, { pipelineMode: 'legacy' });
  assert.ok(next.candidateParts.some((p) => p.id === 'oled-i2c-096'), 'next keeps the OLED');
  assert.ok(!legacy.candidateParts.some((p) => p.id === 'oled-i2c-096'), 'legacy still drops the OLED');
});

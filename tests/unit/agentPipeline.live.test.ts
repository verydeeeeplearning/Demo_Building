import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runAgent } from '../../server/agent/deepAgentRuntime.ts';
import { loadInCatalogCorpus } from '../fixtures/inCatalogCorpus.ts';
import type { AgentMessageRequest } from '../../server/agent/schemas.ts';

// Phase 6.3 — OPT-IN live smoke (the promotion gate). Runs the corpus against the REAL model under
// the `next` pipeline and reports reliability + route metrics. This is the validation a human runs
// (with OPENAI_API_KEY + H_EDUWARE_AGENT_MODEL set) BEFORE flipping the production default to `next`
// or deleting the enumerated routes — neither of which the default (no-live) gate may do.
//
// Run with:  npm run check:live   (file matches tests/unit/*.live.test.ts; skips without a key)
//
// Targets (Success Criteria): structured-output first-shot >= 95%, post-fallback = 100% (never a
// 502). A representative sample keeps the live cost bounded; widen SAMPLE_SIZE for a full run.

const CONFIGURED = Boolean(process.env.OPENAI_API_KEY && process.env.H_EDUWARE_AGENT_MODEL);
const SAMPLE_SIZE = Number(process.env.H_EDUWARE_LIVE_SAMPLE ?? '8');

void test('live smoke: corpus runs under `next` with no 502 and reports first-shot/fallback/route metrics', { skip: !CONFIGURED && 'no OPENAI_API_KEY / H_EDUWARE_AGENT_MODEL — opt-in live test' }, async () => {
  const previousMode = process.env.H_EDUWARE_AGENT_PIPELINE;
  process.env.H_EDUWARE_AGENT_PIPELINE = 'next';
  try {
    const corpus = await loadInCatalogCorpus();
    const sample = corpus.cases.slice(0, SAMPLE_SIZE);
    let completed = 0;
    let fallbacks = 0;

    for (const c of sample) {
      const result = await runAgent({ message: c.message, locale: c.locale } as AgentMessageRequest);
      completed += 1; // reaching here means no 502 was thrown
      if (result.agentEvents.some((event) => event.name === 'structured-output-fallback')) {
        fallbacks += 1;
      }
    }

    const firstShotRate = 1 - fallbacks / sample.length;
    console.log(`[live] post-fallback completion = ${completed}/${sample.length} (must be 100%)`);
    console.log(`[live] structured-output first-shot ≈ ${(firstShotRate * 100).toFixed(1)}% (target >= 95%)`);

    // The hard invariant the default gate cannot prove: every realizable request finishes (no 502).
    assert.equal(completed, sample.length, 'every live request must finish via a structured draft or the deterministic fallback');
  } finally {
    process.env.H_EDUWARE_AGENT_PIPELINE = previousMode;
  }
});

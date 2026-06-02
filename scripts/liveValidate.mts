// Comprehensive live validation of the `next` pipeline (Phase 6.3 gate).
// Usage: set OPENAI_API_KEY + H_EDUWARE_AGENT_MODEL, then:
//   npx tsx scripts/liveValidate.mts [count] [startIndex]
// Runs the in-catalog corpus through the REAL model under `next`, sequentially (rate-limit-safe),
// and writes per-case results to .local/live-validation-results.json (gitignored).
process.env.H_EDUWARE_AGENT_PIPELINE = 'next';

import { writeFile } from 'node:fs/promises';

import { runAgent } from '../server/agent/deepAgentRuntime.ts';
import { buildContextPacket } from '../server/context/contextPacket.ts';
import { loadInCatalogCorpus } from '../tests/fixtures/inCatalogCorpus.ts';
import type { AgentMessageRequest } from '../server/agent/schemas.ts';

type CaseResult = {
  id: string;
  kind: string;
  routeId: string;
  candidatePartIds: string[];
  mustInclude: string[];
  mustExclude: string[];
  candidatesOk: boolean;
  completed: boolean;
  usedFallback: boolean;
  validationStatus: string | null;
  buildRunnable: string | null;
  assistantPreview: string | null;
  error: string | null;
  ms: number;
};

const count = Number(process.argv[2] ?? '999');
const startIndex = Number(process.argv[3] ?? '0');
// Optional: H_EDUWARE_LIVE_IDS="id1,id2" runs only those case ids (for targeted re-tests).
const idFilter = (process.env.H_EDUWARE_LIVE_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const corpus = await loadInCatalogCorpus();
const sample = idFilter.length > 0
  ? corpus.cases.filter((c) => idFilter.includes(c.id))
  : corpus.cases.slice(startIndex, startIndex + count);
console.log(`reasoning=${process.env.H_EDUWARE_AGENT_REASONING_EFFORT ?? '(default)'} | running ${sample.length} cases`);
const results: CaseResult[] = [];

for (const c of sample) {
  // Deterministic packet (no model) for route + candidates context.
  const packet = await buildContextPacket({ message: c.message, locale: c.locale }, { pipelineMode: 'next' });
  const candidateIds = packet.candidateParts.map((p) => p.id);
  const candidateSet = new Set(candidateIds);
  const candidatesOk = c.mustIncludePartIds.every((id) => candidateSet.has(id))
    && c.mustExcludePartIds.every((id) => !candidateSet.has(id));

  const startedAt = Date.now();
  const base: CaseResult = {
    id: c.id,
    kind: c.kind,
    routeId: packet.contextRoute.routeId,
    candidatePartIds: candidateIds,
    mustInclude: c.mustIncludePartIds,
    mustExclude: c.mustExcludePartIds,
    candidatesOk,
    completed: false,
    usedFallback: false,
    validationStatus: null,
    buildRunnable: null,
    assistantPreview: null,
    error: null,
    ms: 0
  };

  try {
    const result = await runAgent({ message: c.message, locale: c.locale } as AgentMessageRequest);
    base.completed = true; // reaching here = no 502
    base.usedFallback = result.agentEvents.some((e) => e.name === 'structured-output-fallback');
    base.validationStatus = result.validationReport.status;
    base.buildRunnable = result.buildRunnableReport.status;
    base.assistantPreview = (result.assistantMessages[0] ?? '').slice(0, 100);
  } catch (err) {
    base.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }
  base.ms = Date.now() - startedAt;
  results.push(base);
  console.log(
    `${base.completed ? (base.error ? '??' : 'OK') : 'FAIL'} ${base.id} [${base.routeId}] ` +
      `cand=${base.candidatesOk ? 'ok' : 'BAD'} val=${base.validationStatus ?? '-'} ` +
      `runnable=${base.buildRunnable ?? '-'} ${base.usedFallback ? 'FALLBACK' : ''} ${base.ms}ms` +
      (base.error ? ` ERR=${base.error}` : '')
  );
}

const completed = results.filter((r) => r.completed).length;
const errored = results.filter((r) => r.error).length;
const fallbacks = results.filter((r) => r.usedFallback).length;
const candidatesOk = results.filter((r) => r.candidatesOk).length;
const synth = results.filter((r) => !r.usedFallback && r.completed);
const valid = synth.filter((r) => r.validationStatus === 'valid').length;

const summary = {
  total: results.length,
  completed,
  errored,
  completionRate: results.length ? completed / results.length : 0,
  firstShotRate: results.length ? (completed - fallbacks) / results.length : 0,
  fallbacks,
  candidatesOk,
  candidatesOkRate: results.length ? candidatesOk / results.length : 0,
  synthValidatedValid: valid,
  synthCount: synth.length
};

await writeFile('.local/live-validation-results.json', `${JSON.stringify({ summary, results }, null, 2)}\n`, 'utf8');
console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(summary, null, 2));
console.log('results -> .local/live-validation-results.json');

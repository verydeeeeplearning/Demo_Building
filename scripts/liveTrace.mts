// Trace-based root-cause capture for invalid cases. Runs each id under `next` and dumps the FULL
// evidence: candidate parts offered, the circuit the agent actually built, the authoritative
// validation errors, the build-runnable reasons, and the agent event trace.
// Usage: source .local/agent.env, then `npx tsx scripts/liveTrace.mts id1 id2 ...`
process.env.H_EDUWARE_AGENT_PIPELINE = 'next';
process.env.H_EDUWARE_AGENT_LOG_LEVEL = process.env.H_EDUWARE_AGENT_LOG_LEVEL ?? 'silent';

import { writeFile } from 'node:fs/promises';

import { runAgent } from '../server/agent/deepAgentRuntime.ts';
import { buildContextPacket } from '../server/context/contextPacket.ts';
import { loadInCatalogCorpus } from '../tests/fixtures/inCatalogCorpus.ts';
import type { AgentMessageRequest } from '../server/agent/schemas.ts';

const ids = process.argv.slice(2);
const corpus = await loadInCatalogCorpus();
const cases = ids.length ? corpus.cases.filter((c) => ids.includes(c.id)) : corpus.cases.slice(0, 1);

const dump: unknown[] = [];
for (const c of cases) {
  const packet = await buildContextPacket({ message: c.message, locale: c.locale }, { pipelineMode: 'next' });
  const candidateIds = packet.candidateParts.map((p) => p.id);
  let result;
  try {
    result = await runAgent({ message: c.message, locale: c.locale } as AgentMessageRequest);
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message.split('\n')[0]}` : String(err);
    dump.push({ id: c.id, message: c.message, routeId: packet.contextRoute.routeId, candidatePartIds: candidateIds, error: msg });
    console.log(`\n========== ${c.id} [${packet.contextRoute.routeId}] -> THREW ==========`);
    console.log('error        :', msg);
    continue;
  }

  // The circuit the agent actually built (components + connections).
  type Endpoint = { componentId?: string; pin?: string };
  const spec = result.circuitSpec as unknown as {
    components?: Array<{ id: string; partId: string; label: string }>;
    connections?: Array<{ id: string; from: Endpoint; to: Endpoint; signal: string }>;
  };
  const ep = (e: Endpoint) => `${e.componentId ?? '?'}:${e.pin ?? '?'}`;
  const builtComponents = (spec.components ?? []).map((co) => `${co.id}=${co.partId}`);
  const builtConnections = (spec.connections ?? []).map((cn) => `${ep(cn.from)} -> ${ep(cn.to)} [${cn.signal}]`);
  const record = {
    id: c.id,
    message: c.message,
    routeId: packet.contextRoute.routeId,
    candidatePartIds: candidateIds,
    builtParts: builtComponents,
    builtConnections,
    builtConnectionCount: (spec.connections ?? []).length,
    validation: {
      status: result.validationReport.status,
      errors: result.validationReport.errors,
      warnings: result.validationReport.warnings,
      electricalAnalysis: result.validationReport.electricalAnalysis ?? null
    },
    buildRunnable: {
      status: result.buildRunnableReport.status,
      reasons: result.buildRunnableReport.reasons
    },
    agentEvents: result.agentEvents.map((e) => `${e.type}:${e.name}:${e.status}`)
  };
  dump.push(record);

  console.log(`\n========== ${c.id} [${record.routeId}] -> ${record.validation.status} ==========`);
  console.log('message      :', c.message);
  console.log('candidates   :', candidateIds.join(', '));
  console.log('built comps  :', JSON.stringify(record.builtParts));
  console.log('connections  :');
  for (const cn of builtConnections) console.log('    ', cn);
  console.log('VALIDATION ERRORS:');
  for (const e of record.validation.errors) console.log('  -', e);
  if (record.validation.warnings.length) {
    console.log('warnings:');
    for (const w of record.validation.warnings) console.log('  ~', w);
  }
  console.log('buildRunnable reasons:', JSON.stringify(record.buildRunnable.reasons));
}

await writeFile('.local/trace-results.json', `${JSON.stringify(dump, null, 2)}\n`, 'utf8');
console.log('\nfull dump -> .local/trace-results.json');

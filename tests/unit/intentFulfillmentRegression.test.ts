import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyIntentFulfillmentGate } from '../../server/agent/circuitTools.ts';
import { buildContextPacket } from '../../server/context/contextPacket.ts';
import { loadInCatalogCorpus } from '../fixtures/inCatalogCorpus.ts';
import { CircuitSpecSchema, type CircuitSpec, type PartCapability, type ValidationReport } from '../../server/agent/schemas.ts';

// Phase 2.5 — offline buildability fixtures for the trace-captured not-valid cases. Each case below
// failed live with INTENT_OUTPUT/INPUT_NOT_FULFILLED or CONTEXT_CANDIDATE_PART_NOT_ALLOWED. This
// suite locks the RC-A (taxonomy) + RC-B (coverage) fixes WITHOUT the live model: it drives the
// REAL deterministic packet (buildContextPacket under `next`), builds a circuit from the offered
// candidates, and asserts the REAL intent-fulfillment gate accepts it. If composition fails to offer
// a part for a required modality, or the taxonomy fails to map it, this fails offline.

// The 13 deterministic cases from PLAN_circuit_validity_fixes.md §4 (RC-A ×6 + RC-A-input ×2 wrongly
// filed under RC-B + RC-B ×5). Keyed by corpus case id (base-<capabilityId>).
const DETERMINISTIC_CASES = [
  'base-spi-display-output',
  'base-low-side-switched-load-output',
  'base-stepper-motor-output',
  'base-hbridge-motor-output',
  'base-relay-low-voltage-output',
  'base-bare-seven-segment-display-output',
  'base-joystick-display-readout',
  'base-rotary-encoder-display-readout',
  'base-analog-sensor-display-readout',
  'base-analog-sensor-threshold-output',
  'base-digital-input-display-readout',
  'base-digital-input-threshold-output',
  'base-matrix-input-display-readout'
];

function validReport(): ValidationReport {
  return {
    version: '2026-05-31',
    status: 'valid',
    errors: [],
    warnings: [],
    validatedCurrentPathIds: [],
    sourceVersion: '2026-05-31'
  };
}

// Build a circuit that USES every offered candidate (an upper bound on what the agent would wire).
// If the gate accepts this, the candidates + taxonomy cover all required modalities.
function circuitUsing(candidates: PartCapability[]): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'fixture-spec',
    title: 'Fixture',
    intent: { primaryGoal: 'fixture', output: 'fixture', controller: 'arduino-uno' },
    components: candidates.map((part, i) => ({ id: `c${i}`, partId: part.id, label: part.label })),
    connections: [],
    behavior: { runText: 'runs' },
    assumptions: [],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

async function messageFor(caseId: string): Promise<{ message: string; locale: 'ko' | 'en' }> {
  const corpus = await loadInCatalogCorpus();
  const found = corpus.cases.find((c) => c.id === caseId);
  assert.ok(found, `corpus case ${caseId} must exist`);
  return { message: found.message, locale: found.locale };
}

for (const caseId of DETERMINISTIC_CASES) {
  void test(`offline: ${caseId} — candidates + taxonomy satisfy the intent-fulfillment gate`, async () => {
    const { message, locale } = await messageFor(caseId);
    const packet = await buildContextPacket({ message, locale }, { pipelineMode: 'next' });
    const spec = circuitUsing(packet.candidateParts);
    const out = applyIntentFulfillmentGate(validReport(), spec, packet.intentSpec, packet.candidateParts);
    assert.equal(
      out.status,
      'valid',
      `${caseId} required modalities not covered (in=${packet.intentSpec.inputModalities.join(',')} out=${packet.intentSpec.outputModalities.join(',')}); ` +
        `candidates=${packet.candidateParts.map((p) => p.id).join(',')}; errors=${out.errors.join(' | ')}`
    );
  });
}

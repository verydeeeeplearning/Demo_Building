import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyIntentFulfillmentGate } from '../../server/agent/circuitTools.ts';
import { buildContextPacket } from '../../server/context/contextPacket.ts';
import { loadInCatalogCorpus } from '../fixtures/inCatalogCorpus.ts';
import { CircuitSpecSchema, type CircuitSpec, type ValidationReport } from '../../server/agent/schemas.ts';

// Phase 5 (RC-F): the gate must not require the UNION of every co-matched capability's input
// modalities conjunctively. Live trace: "조이스틱 위치를 OLED에 표시" co-matches analog-sensor-display +
// digital-input-display + joystick-display, so intentSpec.input unions {analog-sensor, analog,
// digital-input, digital-sensor, joystick}. The agent builds a CORRECT joystick circuit, then the
// gate rejects it for missing analog-sensor/digital-sensor it never needed. Fix (option B): concrete
// INPUT modalities are a DISJUNCTION (>=1 fulfilled), OUTPUT stays conjunctive. This must NOT relax
// the "dropped the input entirely" guard.

function validReport(): ValidationReport {
  return { version: '2026-05-31', status: 'valid', errors: [], warnings: [], validatedCurrentPathIds: [], sourceVersion: '2026-05-31' };
}

function specWith(partIds: string[]): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'rcf-spec',
    title: 'RC-F',
    intent: { primaryGoal: 'rcf', output: 'rcf', controller: 'arduino-uno' },
    components: partIds.map((id, i) => ({ id: `c${i}`, partId: id, label: id })),
    connections: [],
    behavior: { runText: 'runs' },
    assumptions: [],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

async function messageFor(caseId: string): Promise<{ message: string; locale: 'ko' | 'en' }> {
  const corpus = await loadInCatalogCorpus();
  const c = corpus.cases.find((x) => x.id === caseId);
  assert.ok(c, `corpus case ${caseId} must exist`);
  return { message: c.message, locale: c.locale };
}

void test('RC-F: a CORRECT joystick circuit (joystick+OLED only) passes the gate despite the unioned intent', async () => {
  const { message, locale } = await messageFor('base-joystick-display-readout');
  const packet = await buildContextPacket({ message, locale }, { pipelineMode: 'next' });
  // The AGENT-REALIZED circuit — only the joystick + display, NOT the sibling sensors composition offered.
  const spec = specWith(['arduino-uno', 'breadboard-half', 'joystick-module', 'oled-i2c-096']);
  const out = applyIntentFulfillmentGate(validReport(), spec, packet.intentSpec, packet.candidateParts);
  assert.equal(out.status, 'valid', `joystick circuit must pass; errors=${out.errors.join(' | ')}`);
});

void test('RC-F: a CORRECT ttp223 digital circuit passes the gate despite analog sibling modalities', async () => {
  const { message, locale } = await messageFor('base-digital-input-display-readout');
  const packet = await buildContextPacket({ message, locale }, { pipelineMode: 'next' });
  const spec = specWith(['arduino-uno', 'breadboard-half', 'ttp223-touch', 'oled-i2c-096']);
  const out = applyIntentFulfillmentGate(validReport(), spec, packet.intentSpec, packet.candidateParts);
  assert.equal(out.status, 'valid', `ttp223 circuit must pass; errors=${out.errors.join(' | ')}`);
});

void test('RC-F GUARD: a circuit that DROPS the input entirely (OLED only) still fails', async () => {
  const { message, locale } = await messageFor('base-joystick-display-readout');
  const packet = await buildContextPacket({ message, locale }, { pipelineMode: 'next' });
  const spec = specWith(['arduino-uno', 'breadboard-half', 'oled-i2c-096']); // no input device at all
  const out = applyIntentFulfillmentGate(validReport(), spec, packet.intentSpec, packet.candidateParts);
  assert.equal(out.status, 'invalid', 'dropping the input entirely must still fail the gate');
  assert.ok(out.errors.some((e) => e.includes('INTENT_INPUT_NOT_FULFILLED')), 'reports the missing input');
});

void test('RC-F GUARD: a missing OUTPUT still fails (outputs stay conjunctive)', async () => {
  // Request motion, build only an OLED — output union (motion) must still be required.
  const packet = await buildContextPacket(
    { message: '서보로 팔을 움직이고 싶어', locale: 'ko' },
    { pipelineMode: 'next' }
  );
  const spec = specWith(['arduino-uno', 'breadboard-half', 'oled-i2c-096']);
  const out = applyIntentFulfillmentGate(validReport(), spec, packet.intentSpec, packet.candidateParts);
  assert.equal(out.status, 'invalid', 'a missing motion output must still fail');
});

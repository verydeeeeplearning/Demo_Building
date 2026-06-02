import test from 'node:test';
import assert from 'node:assert/strict';

import { buildContextPacket } from '../../server/context/contextPacket.ts';

// Phase 3 characterization (golden-master) test.
//
// This locks the CURRENT routing behavior of buildContextPacket — route id,
// retrieval budget, prompt-char budget, and resolved source ids — across the
// representative request types, INCLUDING the safety-critical unsafe path.
//
// It is written BEFORE the v1→v2 routing migration so that removing v1 routing
// is provably behavior-preserving: after the migration these exact outputs must
// still hold. The unsafe case (currently the only live v1 route) is the most
// important lock — a regression here would mis-route high-voltage/mains
// requests away from the safety policy bundle.

type RoutingShape = {
  routeId: string;
  budget: string;
  maxPromptChars: number;
};

async function routing(message: string): Promise<RoutingShape & { sourceIds: string[]; omittedSourceIds: string[] }> {
  const packet = await buildContextPacket({ message, locale: 'en' });
  return {
    routeId: packet.contextRoute.routeId,
    budget: packet.retrievalPlan.budget,
    maxPromptChars: packet.retrievalPlan.maxPromptChars,
    sourceIds: packet.retrievalPlan.sourceIds,
    omittedSourceIds: packet.retrievalPlan.omittedSourceIds
  };
}

const HEAVY_OMITTED = ['registry:part-capabilities', 'simulation:primitives', 'rendering:render-footprints'];

const CASES: Array<{ message: string; expect: RoutingShape }> = [
  { message: 'I want to show text on an I2C OLED with Arduino', expect: { routeId: 'v2-display-text-output', budget: 'summary', maxPromptChars: 9000 } },
  { message: 'turn on an LED when it gets dark using a light sensor', expect: { routeId: 'v2-light-sensor-triggered-output', budget: 'full', maxPromptChars: 13000 } },
  { message: 'light an LED when I press a button', expect: { routeId: 'v2-button-controlled-light-output', budget: 'summary', maxPromptChars: 12000 } },
  { message: 'make a buzzer beep', expect: { routeId: 'v2-sound-alert-output', budget: 'summary', maxPromptChars: 11000 } },
  { message: 'move a servo motor to an angle', expect: { routeId: 'v2-servo-motion-output', budget: 'summary', maxPromptChars: 12000 } },
  { message: 'use a potentiometer to dim an LED', expect: { routeId: 'v2-analog-led-dimmer', budget: 'full', maxPromptChars: 13000 } },
  { message: 'I want to build something cool', expect: { routeId: 'v2-ambiguous-minimal', budget: 'minimal', maxPromptChars: 6000 } },
  { message: 'build me a quantum computer', expect: { routeId: 'v2-ambiguous-minimal', budget: 'minimal', maxPromptChars: 6000 } },
  { message: 'connect a heater directly to 220V wall outlet', expect: { routeId: 'unsupported-safety', budget: 'minimal', maxPromptChars: 7000 } }
];

test('routing characterization: route id, budget, and char budget are stable across request types', async () => {
  for (const testCase of CASES) {
    const actual = await routing(testCase.message);
    assert.equal(actual.routeId, testCase.expect.routeId, `route for "${testCase.message}"`);
    assert.equal(actual.budget, testCase.expect.budget, `budget for "${testCase.message}"`);
    assert.equal(actual.maxPromptChars, testCase.expect.maxPromptChars, `maxPromptChars for "${testCase.message}"`);
  }
});

test('routing characterization: SAFETY — unsafe requests resolve the exact safety source set', async () => {
  const actual = await routing('connect a heater directly to 220V wall outlet');
  assert.equal(actual.routeId, 'unsupported-safety');
  assert.deepEqual(actual.sourceIds, [
    'memory:agent-operating-memory',
    'policy:safety-policy',
    'policy:unsupported-request-policy',
    'policy:simulation-truthfulness-policy',
    'data:capability-graph',
    'reference:electrical-limits',
    'reference:validation-rules'
  ]);
  assert.deepEqual(actual.omittedSourceIds, HEAVY_OMITTED);
});

test('routing characterization: a curated bundle route and the ambiguous route resolve exact sources', async () => {
  const display = await routing('I want to show text on an I2C OLED with Arduino');
  assert.deepEqual(display.sourceIds, [
    'bundle:display-text-output',
    'policy:safety-policy',
    'policy:simulation-truthfulness-policy'
  ]);
  assert.deepEqual(display.omittedSourceIds, HEAVY_OMITTED);

  const ambiguous = await routing('I want to build something cool');
  assert.deepEqual(ambiguous.sourceIds, [
    'policy:safety-policy',
    'policy:clarification-policy',
    'policy:simulation-truthfulness-policy'
  ]);
  assert.deepEqual(ambiguous.omittedSourceIds, HEAVY_OMITTED);
});

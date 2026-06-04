import assert from 'node:assert/strict';
import test from 'node:test';

import { buildContextPacket } from '../../server/context/contextPacket.ts';
import { loadContextV2Routes } from '../../server/context/contextLayer.ts';

test('supported-hardware-general fallback is not build eligible without bundle or composition proof', async () => {
  const packet = await buildContextPacket({
    message: 'display-text-output',
    locale: 'en'
  });

  assert.equal(packet.contextRoute.routeId, 'supported-hardware-general');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'ineligible');
  assert.equal(packet.contextCoverage.sufficientFor.includes('valid_circuit_synthesis'), false);
});

test('default pipeline preserves OLED display routing or explicitly documents legacy weakness', async () => {
  const packet = await buildContextPacket({
    message: 'Use Arduino Uno and an I2C OLED to display HELLO.',
    locale: 'en'
  });

  assert.ok(
    packet.contextRoute.routeId === 'v2-display-text-output'
      || packet.contextCoverage.synthesisEligibility.status === 'ineligible',
    `default pipeline routed to ${packet.contextRoute.routeId} while still build eligible`
  );
});

test('supported-hardware-general route keeps only policy and graph context in prompt authority', async () => {
  const routes = await loadContextV2Routes();
  const route = routes.routes.find((candidate) => candidate.routeId === 'supported-hardware-general');
  assert.ok(route);

  assert.deepEqual(route.alwaysInclude, [
    'memory:agent-rules',
    'policy:safety',
    'policy:clarification',
    'policy:truthfulness',
    'data:capability-graph'
  ]);
  assert.equal(route.budget, 'minimal');
});

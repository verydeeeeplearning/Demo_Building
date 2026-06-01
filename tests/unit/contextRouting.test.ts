import assert from 'node:assert/strict';
import test from 'node:test';

import { buildContextPacket } from '../../server/context/contextPacket.ts';
import {
  loadContextIndex,
  loadContextRoutingMap,
  resolveContextSourceId
} from '../../server/context/contextLayer.ts';

test('context index exposes hierarchical routing metadata and namespaced aliases', async () => {
  const index = await loadContextIndex();
  const allEntries = [
    ...index.memory,
    ...index.skills,
    ...index.references,
    ...index.data,
    ...index.routing
  ];

  for (const entry of allEntries) {
    assert.match(entry.level, /^L[0-4]$/, `${entry.id} has retrieval level`);
    assert.ok(entry.sourceId.includes(':'), `${entry.id} has namespaced source id`);
    assert.ok(entry.sourceType.length > 0, `${entry.id} has source type`);
    assert.ok(entry.tags.length > 0, `${entry.id} has retrieval tags`);
    assert.ok(entry.provides.length > 0, `${entry.id} declares provided artifact types`);
    assert.ok(entry.loadWhen.length > 0, `${entry.id} declares load conditions`);
    assert.equal(typeof entry.canonical, 'boolean', `${entry.id} declares canonical status`);
    assert.ok(['minimal', 'summary', 'data-only', 'full'].includes(entry.budget), `${entry.id} has budget class`);
  }

  assert.equal(resolveContextSourceId('policy:safety', index)?.id, 'safety-policy');
  assert.equal(resolveContextSourceId('simulation:primitives', index)?.id, 'simulation-primitives');
  assert.equal(resolveContextSourceId('rendering:render-footprint:oled', index)?.id, 'render-footprints');
  assert.equal(resolveContextSourceId('data:capability-graph:display-text-output', index)?.id, 'capability-graph');
});

test('routing map references only resolvable context source ids', async () => {
  const [index, routingMap] = await Promise.all([
    loadContextIndex(),
    loadContextRoutingMap()
  ]);

  for (const route of routingMap.routes) {
    assert.ok(route.routeId.length > 0);
    assert.ok(route.budget in routingMap.maxPromptCharsByBudget);
    for (const sourceId of Object.values(route.load).flat()) {
      assert.ok(resolveContextSourceId(sourceId, index), `${route.routeId} missing source ${sourceId}`);
    }
  }
});

test('button LED requests route to bounded switch, validation, render, and simulation context', async () => {
  const packet = await buildContextPacket({
    message: 'When I press a button, turn on an LED safely.',
    locale: 'en'
  });

  assert.equal(packet.contextRoute.routeId, 'button-controlled-digital-load');
  assert.ok(packet.contextRoute.capabilityIds.includes('button-controlled-light-output'));
  assert.ok(packet.retrievalPlan.sourceIds.includes('registry:part-capabilities'));
  assert.ok(packet.retrievalPlan.sourceIds.includes('data:capability-graph'));
  assert.ok(packet.retrievalPlan.sourceIds.includes('simulation:primitives'));
  assert.ok(packet.retrievalPlan.sourceIds.includes('rendering:render-footprints'));
  assert.ok(packet.retrievalPlan.sourceIds.includes('reference:validation-rules'), packet.retrievalPlan.sourceIds.join(', '));
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'data:capability-graph:button-controlled-light-output'));
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'data:simulation-primitives:digital_on_off'));
  assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
});

test('Korean button LED buzzer requests keep button, light, and sound context together', async () => {
  const packet = await buildContextPacket({
    message: '버튼을 누르면 LED가 켜지고 부저가 울리는 회로를 만들고 싶어',
    locale: 'ko'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);

  assert.equal(packet.contextRoute.routeId, 'button-controlled-digital-load');
  assert.ok(capabilityIds.includes('button-controlled-light-output'), capabilityIds.join(', '));
  assert.ok(capabilityIds.includes('sound-alert-output'), capabilityIds.join(', '));
  assert.ok(packet.intentHints.inputModalities.includes('button'));
  assert.ok(packet.intentHints.outputModalities.includes('light'));
  assert.ok(packet.intentHints.outputModalities.includes('sound'));
  for (const partId of ['arduino-uno', 'breadboard-half', 'button-tactile', 'led-5mm', 'resistor-220', 'piezo-buzzer']) {
    assert.ok(candidatePartIds.includes(partId), `${partId} should be included; got ${candidatePartIds.join(', ')}`);
  }
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
});

test('Korean planned potentiometer LED dimmer routes to context gap instead of simple LED synthesis', async () => {
  const packet = await buildContextPacket({
    message: '가변저항으로 LED 밝기를 조절하고 싶어',
    locale: 'ko'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);

  assert.equal(packet.contextRoute.routeId, 'planned-capability-gap');
  assert.ok(capabilityIds.includes('analog-led-dimmer'), capabilityIds.join(', '));
  assert.ok(packet.intentHints.inputModalities.includes('analog'));
  assert.ok(packet.intentHints.inputModalities.includes('potentiometer'));
  assert.ok(packet.intentHints.outputModalities.includes('light'));
  assert.equal(packet.contextCoverage.status, 'insufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'ineligible');
  assert.ok(packet.supportGaps.some((gap) => /analog-led-dimmer/i.test(gap)), packet.supportGaps.join(' | '));
});

test('Korean servo requests route to PWM actuator context', async () => {
  const packet = await buildContextPacket({
    message: '서보모터를 90도로 움직이는 회로를 만들고 싶어',
    locale: 'ko'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);

  assert.equal(packet.contextRoute.routeId, 'servo-pwm-output');
  assert.ok(capabilityIds.includes('servo-motion-output'), capabilityIds.join(', '));
  assert.ok(packet.intentHints.outputModalities.includes('motion'));
  assert.ok(candidatePartIds.includes('micro-servo'), candidatePartIds.join(', '));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
});

test('screen visualization wording stays on minimal clarification route and avoids display over-fetch', async () => {
  const packet = await buildContextPacket({
    message: 'I want to see current flow on the screen.',
    locale: 'en'
  });

  assert.equal(packet.contextRoute.routeId, 'ambiguous-minimal');
  assert.equal(packet.capabilityMatches.some((capability) => capability.id === 'display-text-output'), false);
  assert.equal(packet.retrievalPlan.sourceIds.includes('registry:part-capabilities'), false);
  assert.equal(packet.retrievalPlan.sourceIds.includes('simulation:primitives'), false);
  assert.equal(packet.retrievalPlan.sourceIds.includes('rendering:render-footprints'), false);
  assert.ok(packet.retrievalPlan.omittedSourceIds.includes('registry:part-capabilities'));
  assert.ok(packet.retrievalPlan.omittedSourceIds.includes('simulation:primitives'));
  assert.ok(packet.retrievalPlan.omittedSourceIds.includes('rendering:render-footprints'));
  assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
});

test('unsupported routes stay policy-first and do not load render or simulation catalogs', async () => {
  const packet = await buildContextPacket({
    message: 'Use the breadboard to switch a 220V wall outlet heater.',
    locale: 'en'
  });

  assert.equal(packet.contextRoute.routeId, 'unsupported-safety');
  assert.ok(packet.contextRoute.capabilityIds.includes('high-voltage-load-control'));
  assert.ok(packet.retrievalPlan.sourceIds.includes('policy:safety-policy'));
  assert.ok(packet.retrievalPlan.sourceIds.includes('policy:unsupported-request-policy'));
  assert.equal(packet.retrievalPlan.sourceIds.includes('registry:part-capabilities'), false);
  assert.equal(packet.retrievalPlan.sourceIds.includes('simulation:primitives'), false);
  assert.equal(packet.retrievalPlan.sourceIds.includes('rendering:render-footprints'), false);
  assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
});

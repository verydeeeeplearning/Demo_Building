import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildContextPacket } from '../../server/context/contextPacket.ts';

// US-1 — forceCapabilityId re-grounds a vague request to a chosen capability so the post-selection
// build (after the student taps an option) has the right route/parts/coverage.

void test('forceCapabilityId grounds a vague message to the chosen capability', async () => {
  const packet = await buildContextPacket({
    message: '뭔가 만들어줘',
    locale: 'ko',
    forceCapabilityId: 'dht11-temperature-humidity-display'
  } as any);

  assert.equal(packet.contextRoute.routeId, 'v2-dht11-temperature-humidity-display', 'route grounds to the forced capability');
  assert.ok(packet.capabilityMatches[0]?.id === 'dht11-temperature-humidity-display', 'forced capability is the top match');
  assert.ok(packet.candidateParts.some((part) => part.id === 'dht11'), 'candidate parts include the sensor');
  assert.equal(packet.contextCoverage.status, 'sufficient', 'coverage is sufficient for the forced build');
});

void test('forceCapabilityId works for another capability (servo)', async () => {
  const packet = await buildContextPacket({
    message: '뭔가 만들어줘',
    locale: 'ko',
    forceCapabilityId: 'servo-motion-output'
  } as any);
  assert.equal(packet.contextRoute.routeId, 'v2-servo-motion-output');
  assert.equal(packet.contextCoverage.status, 'sufficient');
});

void test('an unknown/unsupported forceCapabilityId is ignored (behaves as unset)', async () => {
  const forced = await buildContextPacket({ message: '뭔가 만들어줘', locale: 'ko', forceCapabilityId: 'not-a-real-capability' } as any);
  const plain = await buildContextPacket({ message: '뭔가 만들어줘', locale: 'ko' });
  assert.equal(forced.contextRoute.routeId, plain.contextRoute.routeId, 'unknown id changes nothing');
  assert.equal(forced.contextRoute.routeId, 'v2-ambiguous-minimal');
});

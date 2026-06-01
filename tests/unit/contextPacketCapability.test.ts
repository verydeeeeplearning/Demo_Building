import assert from 'node:assert/strict';
import test from 'node:test';

import { buildContextPacket } from '../../server/context/contextPacket.ts';

test('context packet includes capability graph evidence for generalized hardware requests', async () => {
  const packet = await buildContextPacket({
    message: 'Show HELLO on a small OLED screen and visualize current flow.',
    locale: 'en'
  });

  assert.ok(packet.capabilityMatches.some((capability) => capability.id === 'display-text-output'));
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'data:capability-graph:display-text-output'));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.score, 1);
  assert.deepEqual(packet.contextCoverage.missingSourceTypes, []);
  assert.ok(packet.contextCoverage.requiredSourceTypes.includes('registry'));
  assert.ok(packet.contextCoverage.requiredSourceTypes.includes('rendering'));
  assert.match(packet.promptBlock, /Capability graph matches/i);
  assert.match(packet.promptBlock, /Context coverage/i);
  assert.match(packet.promptBlock, /display-text-output/);
});

test('context packet marks planned capabilities as support gaps instead of pretending they are implemented', async () => {
  const packet = await buildContextPacket({
    message: 'Use a potentiometer dial to control LED brightness.',
    locale: 'en'
  });

  assert.ok(packet.capabilityMatches.some((capability) => capability.id === 'analog-led-dimmer'));
  assert.ok(packet.supportGaps.some((gap) => /analog-led-dimmer/i.test(gap)));
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'data:capability-graph:analog-led-dimmer'));
  assert.equal(packet.contextCoverage.status, 'insufficient');
  assert.ok(packet.contextCoverage.warnings.some((warning) => /support gap/i.test(warning)));
  assert.ok(packet.contextCoverage.warnings.some((warning) => /analog-led-dimmer/i.test(warning)));
  assert.match(packet.promptBlock, /support gaps/i);
  assert.match(packet.promptBlock, /planned/i);
});

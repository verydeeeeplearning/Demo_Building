import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  loadSlotPolicy,
  outputCategories,
  capabilityOptions,
  categoryOfCapability,
  assignedCapabilityIds
} from '../../server/agent/slotPolicy.ts';
import { loadCapabilityGraph } from '../../server/context/capabilityGraph.ts';

void test('slot policy loads (v2 taxonomy) and exposes localized output categories', async () => {
  const policy = await loadSlotPolicy();
  assert.equal(policy.schemaVersion, 2);

  const ko = await outputCategories('ko');
  const en = await outputCategories('en');
  assert.ok(ko.length >= 5, 'a handful of build categories');
  assert.equal(ko.length, en.length);
  assert.notEqual(ko[0].label, en[0].label, 'category labels are localized');
});

// THE COVERAGE GUARANTEE: options are derived from the WHOLE supported capability set, not a hand-picked
// subset. Every supported capability must be assigned to exactly one build category OR to context.
void test('every supported capability is assigned exactly once (no silent drops, no duplicates)', async () => {
  const graph = await loadCapabilityGraph();
  const supported = graph.filter((c) => c.supportLevel === 'supported').map((c) => c.id);

  const { build, context } = await assignedCapabilityIds();
  const assignedCounts = new Map<string, number>();
  for (const id of [...build, ...context]) {
    assignedCounts.set(id, (assignedCounts.get(id) ?? 0) + 1);
  }

  // No capability is assigned twice (e.g. to two categories, or a category + context).
  for (const [id, count] of assignedCounts) {
    assert.equal(count, 1, `${id} is assigned ${count} times (must be exactly once)`);
  }

  // Every supported capability is covered.
  const assignedSet = new Set(assignedCounts.keys());
  const missing = supported.filter((id) => !assignedSet.has(id));
  assert.deepEqual(missing, [], `unassigned supported capabilities (taxonomy must cover them): ${missing.join(', ')}`);

  // Nothing assigned that isn't a real supported capability (stale id).
  const supportedSet = new Set(supported);
  const stale = [...assignedSet].filter((id) => !supportedSet.has(id));
  assert.deepEqual(stale, [], `taxonomy references non-supported capabilities: ${stale.join(', ')}`);
});

void test('capabilityOptions drills a category into its supported capabilities', async () => {
  const motion = await capabilityOptions('motion', 'ko');
  const ids = motion.map((option) => option.capabilityId);
  assert.ok(ids.includes('servo-motion-output'));
  assert.ok(ids.includes('stepper-motor-output'));
  for (const option of motion) {
    assert.equal(option.id, option.capabilityId, 'drill-down options carry the capabilityId');
    assert.ok(option.label.length > 0);
  }
});

void test('categoryOfCapability resolves a capability back to its category', async () => {
  assert.equal(await categoryOfCapability('dht11-temperature-humidity-display'), 'sensor-readout');
  assert.equal(await categoryOfCapability('sound-alert-output'), 'sound');
  assert.equal(await categoryOfCapability('not-a-real-id'), null);
});

void test('unknown category throws (fail-fast, not silent empty)', async () => {
  await assert.rejects(() => capabilityOptions('does-not-exist', 'ko'));
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILD_STEPS,
  PHASE_LABELS,
  buildPercent,
  phasesInOrder
} from '../../src/buildProgress.js';

test('build steps cover both the spec and design phases in order', () => {
  assert.ok(BUILD_STEPS.length >= 6, 'enough steps to feel like real work');

  const phases = phasesInOrder();
  assert.deepEqual(phases, ['spec', 'design'], 'spec is authored before the circuit is designed');

  for (const phase of phases) {
    assert.ok(PHASE_LABELS[phase], `phase ${phase} has a label`);
  }

  for (const step of BUILD_STEPS) {
    assert.ok(step.id && typeof step.id === 'string', 'step has id');
    assert.ok(step.label.length > 3, `${step.id} has a label`);
    assert.ok(step.log.length > 3, `${step.id} has a live-log line`);
    assert.ok(phases.includes(step.phase), `${step.id} phase is known`);
  }

  const ids = new Set(BUILD_STEPS.map((step) => step.id));
  assert.equal(ids.size, BUILD_STEPS.length, 'step ids are unique');
});

test('buildPercent maps completed steps to a clamped 0-100 integer', () => {
  const total = BUILD_STEPS.length;
  assert.equal(buildPercent(0, total), 0);
  assert.equal(buildPercent(total, total), 100);
  assert.equal(buildPercent(total / 2, total), 50);
  assert.equal(buildPercent(-5, total), 0, 'clamps below zero');
  assert.equal(buildPercent(total + 5, total), 100, 'clamps above total');
  assert.equal(buildPercent(1, 0), 0, 'guards divide-by-zero');
  assert.equal(Number.isInteger(buildPercent(3, 9)), true, 'returns an integer');
});

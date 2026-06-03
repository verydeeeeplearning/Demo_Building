import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldRenderNextFrame } from '../../src/renderScheduler.js';

test('idle (not running, settled rotation, expired window) schedules no frame', () => {
  assert.equal(
    shouldRenderNextFrame({ running: false, rotationDelta: 0, now: 1000, activeUntil: 0 }),
    false
  );
});

test('running keeps the loop alive', () => {
  assert.equal(
    shouldRenderNextFrame({ running: true, rotationDelta: 0, now: 1000, activeUntil: 0 }),
    true
  );
});

test('unsettled orbit rotation keeps the loop alive', () => {
  assert.equal(
    shouldRenderNextFrame({ running: false, rotationDelta: 0.05, now: 1000, activeUntil: 0 }),
    true
  );
  // A rotation delta below epsilon counts as settled.
  assert.equal(
    shouldRenderNextFrame({ running: false, rotationDelta: 0.0001, now: 1000, activeUntil: 0 }),
    false
  );
});

test('an open interaction window keeps the loop alive', () => {
  assert.equal(
    shouldRenderNextFrame({ running: false, rotationDelta: 0, now: 1000, activeUntil: 1140 }),
    true
  );
  // ...and stops once the window has passed.
  assert.equal(
    shouldRenderNextFrame({ running: false, rotationDelta: 0, now: 1200, activeUntil: 1140 }),
    false
  );
});

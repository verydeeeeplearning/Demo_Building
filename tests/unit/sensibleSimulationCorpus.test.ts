import assert from 'node:assert/strict';
import { test } from 'node:test';

import { measureSpec, loadFixture } from '../helpers/corpus.ts';

// PLAN_sensible_simulation Phase 0 — deterministic measurement baseline.
// Establishes the runnable/blocking status of curated good + bad circuits with NO LLM, so P1/P2
// can measure their effect. The "decoration" baseline documents the Class B bug (it currently
// passes as runnable); P2 flips that assertion to runnable:false.

void test('P0 baseline: a correctly-wired LED blink circuit is runnable', async () => {
  const m = await measureSpec(loadFixture('led-blink-good'));
  assert.equal(m.validationStatus, 'valid', `expected valid, got ${m.validationStatus}: ${m.reasons.join('; ')}`);
  assert.equal(m.runnable, true, `expected runnable, blocked by: ${m.reasons.join('; ')}`);
});

void test('P0 baseline: the breadboard-decoration circuit is electrically valid (Class B bug surface)', async () => {
  // BASELINE (RED for Class B): the button+buzzer point-to-point circuit leaves the breadboard
  // electrically unused, yet today it validates and is marked runnable. P2 introduces the
  // breadboard-isolation gate that will make this runnable:false while still rendering the scene.
  const m = await measureSpec(loadFixture('button-buzzer-decoration'));
  console.log('[P0 decoration baseline]', JSON.stringify(m));
  assert.equal(m.validationStatus, 'valid', 'decoration circuit currently validates as valid (documented baseline)');
  // Intentionally asserting the CURRENT (buggy) behavior so the suite stays green until P2 flips it.
  assert.equal(m.runnable, true, 'BASELINE: decoration circuit is currently runnable — Class B bug to be fixed in P2');
});

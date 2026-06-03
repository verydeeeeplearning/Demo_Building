import assert from 'node:assert/strict';
import { test } from 'node:test';

import { measureSpec, loadFixture } from '../helpers/corpus.ts';

// PLAN_sensible_simulation Phase 2 — label-overlap is the #1 measured visual defect (re-measurement:
// 28 LABEL_OVERLAP across 5/7 circuits). The label solver must place labels so none overlap another
// label or part. RED: today these fixtures still emit LABEL_OVERLAP; GREEN after the solver upgrade.

const LABEL_DENSE_FIXTURES = ['led-blink-good', 'button-buzzer-decoration'];

for (const fixture of LABEL_DENSE_FIXTURES) {
  void test(`label layout produces no LABEL_OVERLAP for ${fixture}`, async () => {
    const m = await measureSpec(loadFixture(fixture));
    const overlaps = m.warningCounts.LABEL_OVERLAP ?? 0;
    assert.equal(overlaps, 0, `${fixture}: expected 0 LABEL_OVERLAP, got ${overlaps}`);
  });
}

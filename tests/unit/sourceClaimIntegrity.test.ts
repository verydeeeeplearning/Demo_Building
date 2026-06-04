import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSourceClaimIntegrityReport } from '../../server/context/sourceClaimIntegrity.ts';

test('source claims resolve referenced support-bundle claim ids and subjects', async () => {
  const report = await buildSourceClaimIntegrityReport();
  const errors = report.issues.filter((issue) => issue.severity === 'error');

  assert.deepEqual(errors, []);
});

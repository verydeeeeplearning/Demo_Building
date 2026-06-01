import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { sourceFreshnessStatus } from '../../server/serverHealth.ts';

test('source freshness marks files modified after server start as stale', () => {
  const dir = mkdtempSync(join(tmpdir(), 'h-eduware-health-'));
  const file = join(dir, 'server-file.ts');

  try {
    writeFileSync(file, 'export const value = 1;\n');
    const startedAtMs = Date.UTC(2026, 4, 31, 12, 0, 0);
    const modifiedAtMs = startedAtMs + 10_000;
    utimesSync(file, new Date(modifiedAtMs), new Date(modifiedAtMs));

    const status = sourceFreshnessStatus({
      startedAtMs,
      checkedAtMs: modifiedAtMs + 1000,
      files: [{ id: 'test:file', path: file }],
      toleranceMs: 0
    });

    assert.equal(status.stale, true);
    assert.equal(status.staleSourceFiles.length, 1);
    assert.equal(status.staleSourceFiles[0].id, 'test:file');
    assert.equal(status.errors.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('source freshness stays clean when source files predate server start', () => {
  const dir = mkdtempSync(join(tmpdir(), 'h-eduware-health-'));
  const file = join(dir, 'server-file.ts');

  try {
    writeFileSync(file, 'export const value = 1;\n');
    const startedAtMs = Date.UTC(2026, 4, 31, 12, 0, 0);
    const modifiedAtMs = startedAtMs - 10_000;
    utimesSync(file, new Date(modifiedAtMs), new Date(modifiedAtMs));

    const status = sourceFreshnessStatus({
      startedAtMs,
      checkedAtMs: startedAtMs + 1000,
      files: [{ id: 'test:file', path: file }],
      toleranceMs: 0
    });

    assert.equal(status.stale, false);
    assert.deepEqual(status.staleSourceFiles, []);
    assert.equal(status.errors.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createFileShareStore } from '../../server/share/shareStore.ts';
import { ShareSnapshotSchema } from '../../server/share/shareSchemas.ts';

test('file share store creates and reads a sanitized snapshot by opaque id', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'h-eduware-share-store-'));

  try {
    const store = createFileShareStore(rootDir);
    const snapshot = ShareSnapshotSchema.parse(createValidSnapshot());
    const stored = await store.create(snapshot);

    assert.match(stored.shareId, /^[a-f0-9]{32}$/);
    assert.equal(stored.snapshot.id, stored.shareId);
    assert.equal(stored.snapshot.title, snapshot.title);

    const persistedPath = path.join(rootDir, `${stored.shareId}.json`);
    const persisted = JSON.parse(await readFile(persistedPath, 'utf8'));
    assert.equal(persisted.shareId, stored.shareId);
    assert.equal(persisted.snapshot.id, stored.shareId);

    const readBack = await store.read(stored.shareId);
    assert.equal(readBack?.shareId, stored.shareId);
    assert.equal(readBack?.snapshot.title, 'OLED Name Display');
  } finally {
    await removeTempRoot(rootDir);
  }
});

test('file share store returns null for unknown ids and rejects path traversal ids', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'h-eduware-share-store-'));

  try {
    const store = createFileShareStore(rootDir);

    assert.equal(await store.read('b'.repeat(32)), null);
    await assert.rejects(() => store.read('../secret'), /Invalid share id/i);
    await assert.rejects(() => store.read('not-a-valid-id'), /Invalid share id/i);
  } finally {
    await removeTempRoot(rootDir);
  }
});

function createValidSnapshot() {
  return {
    schemaVersion: 1,
    createdAt: '2026-06-01T00:00:00.000Z',
    locale: 'ko',
    title: 'OLED Name Display',
    summary: 'Arduino Uno shows a short name on an I2C OLED.',
    status: 'valid',
    source: 'agent',
    requirementMarkdown: '# OLED Name Display\n\nDisplay a short name.',
    circuit: {
      name: 'OLED Name Display',
      description: 'Arduino Uno sends I2C data to an OLED module.',
      components: [
        { id: 'arduino-uno', type: 'arduino', name: 'Arduino Uno', role: 'controller' },
        { id: 'oled-display', type: 'oled', name: '0.96 inch I2C OLED', role: 'display' }
      ],
      connections: [
        { from: 'arduino-uno:5V', to: 'oled-display:VCC', label: '5V power' }
      ]
    },
    validation: {
      status: 'valid',
      warnings: [],
      unsupportedItems: []
    },
    buildRunnableReport: {
      status: 'runnable',
      runnable: true,
      reasons: [],
      validationStatus: 'valid',
      simulationStatus: 'valid',
      renderWarningCount: 0,
      renderBlockingWarningCount: 0,
      renderPartCount: 2,
      currentPathCount: 1,
      expectedStateCount: 1
    },
    simulation: {
      available: true,
      runText: 'RALPHTON BUSAN',
      explanation: 'The OLED module draws a small current while showing text.',
      currentPathCount: 1
    },
    contextEvidence: {
      coverageStatus: 'sufficient',
      score: 1,
      sourceTypes: ['registry', 'simulation'],
      warnings: []
    }
  };
}

async function removeTempRoot(rootDir: string) {
  const resolvedRoot = path.resolve(rootDir);
  const tempRoot = path.resolve(os.tmpdir());
  if (resolvedRoot.startsWith(tempRoot)) {
    await rm(resolvedRoot, { recursive: true, force: true });
  }
}

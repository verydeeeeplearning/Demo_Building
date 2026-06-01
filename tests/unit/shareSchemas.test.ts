import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ShareCreateRequestSchema,
  ShareCreateResponseSchema,
  ShareReadResponseSchema,
  ShareSnapshotSchema
} from '../../server/share/shareSchemas.ts';

test('share snapshot schema accepts a curated validated circuit snapshot', () => {
  const snapshot = ShareSnapshotSchema.parse(createValidSnapshot());

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.status, 'valid');
  assert.equal(snapshot.validation.status, 'valid');
  assert.equal(snapshot.simulation.available, true);
  assert.equal(snapshot.circuit.components[0].name, 'Arduino Uno');
});

test('share snapshot schema rejects oversized public strings and invalid status', () => {
  assert.throws(() => {
    ShareSnapshotSchema.parse({
      ...createValidSnapshot(),
      title: 'x'.repeat(81)
    });
  }, /Too big|maximum|at most|80/i);

  assert.throws(() => {
    ShareSnapshotSchema.parse({
      ...createValidSnapshot(),
      status: 'working'
    });
  }, /Invalid option|status/i);
});

test('share create and read response schemas fix the public API contract', () => {
  const snapshot = createValidSnapshot();
  const request = ShareCreateRequestSchema.parse({ snapshot });
  const createResponse = ShareCreateResponseSchema.parse({
    shareId: 'a'.repeat(32),
    shareUrl: 'http://127.0.0.1:4173/?share=' + 'a'.repeat(32),
    createdAt: snapshot.createdAt
  });
  const readResponse = ShareReadResponseSchema.parse({ snapshot: { ...snapshot, id: createResponse.shareId } });

  assert.equal(request.snapshot.title, 'OLED Name Display');
  assert.match(createResponse.shareUrl, /\?share=a{32}$/);
  assert.equal(readResponse.snapshot.id, createResponse.shareId);
});

test('share create request requires the curated snapshot boundary', () => {
  assert.throws(() => {
    ShareCreateRequestSchema.parse({
      snapshot: {
        schemaVersion: 1,
        title: 'Missing required fields'
      }
    });
  }, /required|Invalid input/i);
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
    studentPromptSummary: 'Show my name on a small OLED.',
    requirementMarkdown: '# OLED Name Display\n\nDisplay a short name.',
    circuit: {
      name: 'OLED Name Display',
      description: 'Arduino Uno sends I2C data to an OLED module.',
      components: [
        { id: 'arduino-uno', type: 'arduino', name: 'Arduino Uno', role: 'controller' },
        { id: 'oled-display', type: 'oled', name: '0.96 inch I2C OLED', role: 'display' }
      ],
      connections: [
        { from: 'arduino-uno:5V', to: 'oled-display:VCC', label: '5V power' },
        { from: 'arduino-uno:GND', to: 'oled-display:GND', label: 'ground' }
      ]
    },
    validation: {
      status: 'valid',
      warnings: [],
      unsupportedItems: []
    },
    simulation: {
      available: true,
      runText: 'RALPHTON BUSAN',
      explanation: 'The OLED module draws a small current while showing text.',
      currentPathCount: 1
    },
    renderPlan: {
      title: 'OLED Name Display',
      parts: [],
      connections: []
    },
    contextEvidence: {
      coverageStatus: 'sufficient',
      score: 1,
      sourceTypes: ['registry', 'simulation', 'rendering'],
      warnings: []
    }
  };
}

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

test('share snapshot schema rejects valid agent shares without runnable gate evidence', () => {
  assert.throws(() => {
    const snapshot = { ...createValidSnapshot(), buildRunnableReport: undefined };
    ShareSnapshotSchema.parse(snapshot);
  }, /buildRunnableReport/i);

  assert.throws(() => {
    ShareSnapshotSchema.parse({
      ...createValidSnapshot(),
      buildRunnableReport: {
        ...validRunnableReport(),
        status: 'blocked',
        runnable: false,
        reasons: ['simulation has no validated current or signal path'],
        currentPathCount: 0,
        expectedStateCount: 0
      }
    });
  }, /runnable build report|buildRunnableReport/i);
});

test('share snapshot schema accepts diagnostic visible shares without runnable current-flow availability', () => {
  const snapshot = ShareSnapshotSchema.parse({
    ...createValidSnapshot(),
    status: 'invalid',
    validation: {
      status: 'invalid',
      warnings: ['render is diagnostic only'],
      unsupportedItems: []
    },
    buildRunnableReport: {
      ...validRunnableReport(),
      status: 'blocked',
      runnable: false,
      reasons: ['render is diagnostic only'],
      currentPathCount: 0,
      expectedStateCount: 0
    },
    solverGateResult: {
      mode: 'diagnostic',
      visibleSimulation: true,
      buildReady: false,
      simulationActivity: 'diagnostic',
      notVerified: ['current-flow simulation is not verified']
    },
    simulation: {
      available: false,
      runText: 'RALPHTON BUSAN',
      explanation: '3D diagnostic scene is available, but current-flow simulation is blocked.',
      currentPathCount: 0
    },
    renderPlan: {
      title: 'OLED Name Display',
      parts: [{ id: 'arduino-uno', type: 'arduino', label: 'Arduino Uno' }],
      connections: []
    }
  });

  assert.equal(snapshot.status, 'invalid');
  assert.equal(snapshot.simulation.available, false);
  assert.equal((snapshot.solverGateResult as { visibleSimulation?: boolean }).visibleSimulation, true);
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
    buildRunnableReport: validRunnableReport(),
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

function validRunnableReport() {
  return {
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
  };
}

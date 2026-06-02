import assert from 'node:assert/strict';
import test from 'node:test';

import { createShareCardModel } from '../../src/shareCard.js';

test('createShareCardModel builds a bounded 1200x630 portfolio card model', () => {
  const model = createShareCardModel(createSnapshot(), 'en');

  assert.equal(model.width, 1200);
  assert.equal(model.height, 630);
  assert.equal(model.title, 'OLED Name Display');
  assert.equal(model.badge, 'Validated');
  assert.ok(model.parts.includes('Arduino Uno'));
  assert.ok(model.parts.includes('0.96 inch I2C OLED'));
  assert.match(model.simulation, /OLED module current/);
});

test('createShareCardModel redacts secrets and limits visible text', () => {
  const model = createShareCardModel({
    ...createSnapshot(),
    title: `Secret sk-proj-secretsecretsecretsecret ${'x'.repeat(200)}`,
    summary: 'OPENAI_API_KEY=abc should not be visible',
    circuit: {
      ...createSnapshot().circuit,
      components: Array.from({ length: 12 }, (_, index) => ({
        id: `part-${index}`,
        name: `Part ${index} H_EDUWARE_AGENT_MODEL=gpt-5.5`,
        type: 'part'
      }))
    }
  }, 'ko');

  const serialized = JSON.stringify(model);
  assert.equal(model.parts.length, 5);
  assert.ok(model.title.length <= 72);
  assert.doesNotMatch(serialized, /sk-proj-|OPENAI_API_KEY|H_EDUWARE_AGENT_MODEL/);
  assert.match(serialized, /\[redacted\]/);
});

test('createShareCardModel does not claim invalid snapshots were validated', () => {
  const snapshot = createSnapshot();
  snapshot.status = 'invalid';
  snapshot.validation.status = 'invalid';
  snapshot.simulation.available = false;
  snapshot.simulation.explanation = 'Current-flow simulation is not available for this shared snapshot.';

  const model = createShareCardModel(snapshot, 'en');

  assert.equal(model.badge, 'Needs review');
  assert.doesNotMatch(model.footer, /validated/i);
  assert.match(model.footer, /needs review|not validated/i);
});

test('createShareCardModel does not claim runnable status without build runnable evidence', () => {
  const snapshot = createSnapshot();
  delete snapshot.buildRunnableReport;

  const model = createShareCardModel(snapshot, 'en');

  assert.equal(model.badge, 'Needs review');
  assert.match(model.simulation, /not available/i);
  assert.doesNotMatch(model.footer, /validated/i);
});

test('createShareCardModel distinguishes diagnostic scenes from runnable current simulation', () => {
  const snapshot = createSnapshot();
  snapshot.status = 'invalid';
  snapshot.validation.status = 'invalid';
  snapshot.buildRunnableReport = {
    ...validRunnableReport(),
    status: 'blocked',
    runnable: false,
    reasons: ['render is diagnostic only'],
    currentPathCount: 0,
    expectedStateCount: 0
  };
  snapshot.solverGateResult = {
    visibleSimulation: true,
    buildReady: false,
    simulationActivity: 'diagnostic'
  };
  snapshot.renderPlan = {
    parts: [{ id: 'arduino-uno', type: 'arduino', label: 'Arduino Uno' }],
    connections: []
  };
  snapshot.simulation.available = false;

  const model = createShareCardModel(snapshot, 'en');

  assert.equal(model.badge, 'Needs review');
  assert.match(model.simulation, /3D diagnostic scene available/i);
  assert.doesNotMatch(model.footer, /validated/i);
});

function createSnapshot() {
  return {
    schemaVersion: 1,
    createdAt: '2026-06-01T00:00:00.000Z',
    locale: 'en',
    title: 'OLED Name Display',
    summary: 'Arduino Uno shows a short name on a small OLED screen.',
    status: 'valid',
    source: 'agent',
    requirementMarkdown: '# OLED Name Display',
    circuit: {
      name: 'OLED Name Display',
      description: 'Display a short name.',
      components: [
        { id: 'arduino-uno', type: 'arduino', name: 'Arduino Uno', role: 'Controller board' },
        { id: 'oled-display', type: 'oled', name: '0.96 inch I2C OLED', role: 'Display module' }
      ],
      connections: []
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
      explanation: 'OLED module current flows through VCC and returns to GND.',
      currentPathCount: 1
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

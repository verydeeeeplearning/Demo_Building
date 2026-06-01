import assert from 'node:assert/strict';
import test from 'node:test';

import { projectFromShareSnapshot } from '../../src/shareImport.js';

test('projectFromShareSnapshot converts a public snapshot into a local project shape', () => {
  const project = projectFromShareSnapshot(createSnapshot(), 'ko');

  assert.equal(project.circuit.title, 'Shared LED Badge');
  assert.equal(project.circuit.source, 'imported');
  assert.equal(project.circuit.runText, 'LED blink');
  assert.equal(project.circuit.parts.length, 2);
  assert.equal(project.circuit.connections[0].from.partId, 'arduino-uno');
  assert.equal(project.circuit.connections[0].education.label, 'Digital signal');
  assert.equal(project.circuit.validationReport.status, 'valid');
  assert.equal(project.circuit.simulationPlan.status, 'valid');
  assert.equal(project.files[0].id, 'shared-requirements');
  assert.match(project.files[0].markdown, /Shared LED Badge/);
});

test('projectFromShareSnapshot keeps invalid shared circuits as non-running drafts', () => {
  const snapshot = createSnapshot();
  snapshot.status = 'invalid';
  snapshot.validation.status = 'invalid';
  snapshot.simulation.available = false;
  snapshot.simulation.currentPathCount = 0;
  snapshot.simulation.runText = undefined;
  snapshot.renderPlan = undefined;

  const project = projectFromShareSnapshot(snapshot, 'en');

  assert.equal(project.circuit.validationReport.status, 'invalid');
  assert.equal(project.circuit.simulationPlan.status, 'invalid');
  assert.deepEqual(project.circuit.simulationPlan.currentPaths, []);
  assert.equal(project.circuit.runText, '');
  assert.deepEqual(project.circuit.parts, []);
  assert.deepEqual(project.circuit.connections, []);
});

test('projectFromShareSnapshot suppresses build-ready markdown for invalid shares', () => {
  const snapshot = createSnapshot();
  snapshot.status = 'invalid';
  snapshot.validation.status = 'invalid';
  snapshot.validation.warnings = ['UNKNOWN_PIN: D99 is not a pin on Arduino Uno.'];
  snapshot.simulation.available = false;
  snapshot.requirementMarkdown = [
    '# Shared Broken LED',
    '',
    'This circuit is ready to assemble.',
    '',
    '## Connections',
    '',
    '- arduino-uno:D99 -> led-1:A'
  ].join('\n');

  const project = projectFromShareSnapshot(snapshot, 'en');
  const markdown = project.files[0].markdown;

  assert.match(markdown, /not validated|needs review|non-running/i);
  assert.match(markdown, /UNKNOWN_PIN/);
  assert.doesNotMatch(markdown, /ready to assemble/i);
  assert.doesNotMatch(markdown, /arduino-uno:D99 -> led-1:A/);
  assert.doesNotMatch(markdown, /## Connections/);
});

test('projectFromShareSnapshot blocks renderable PCB data for invalid shares', () => {
  const snapshot = createSnapshot();
  snapshot.status = 'invalid';
  snapshot.validation.status = 'invalid';
  snapshot.validation.warnings = ['UNKNOWN_PIN: D99 is not a pin on Arduino Uno.'];
  snapshot.simulation.available = false;
  snapshot.simulation.currentPathCount = 0;

  const project = projectFromShareSnapshot(snapshot, 'en');

  assert.equal(project.circuit.validationReport.status, 'invalid');
  assert.deepEqual(project.circuit.parts, []);
  assert.deepEqual(project.circuit.connections, []);
  assert.deepEqual(project.circuit.floatingCards, []);
  assert.ok(project.circuit.renderWarnings.some((warning) => (
    warning.code === 'SHARED_SNAPSHOT_NOT_BUILD_READY'
      && /not validated|not build-ready|current-flow/i.test(warning.message)
  )));
});

function createSnapshot() {
  return {
    schemaVersion: 1,
    id: 'd'.repeat(32),
    createdAt: '2026-06-01T00:00:00.000Z',
    locale: 'en',
    title: 'Shared LED Badge',
    summary: 'A shared LED badge circuit.',
    status: 'valid',
    source: 'agent',
    requirementMarkdown: '# Shared LED Badge\n\nThis LED circuit was shared from H-eduware.',
    circuit: {
      name: 'Shared LED Badge',
      description: 'Blink an LED badge.',
      components: [
        { id: 'arduino-uno', type: 'arduino', name: 'Arduino Uno', role: 'Controller' },
        { id: 'led-1', type: 'led', name: 'Red LED', role: 'Output' }
      ],
      connections: [
        { from: 'arduino-uno:D9', to: 'led-1:A', label: 'Signal path' }
      ]
    },
    validation: {
      status: 'valid',
      warnings: [],
      unsupportedItems: []
    },
    simulation: {
      available: true,
      runText: 'LED blink',
      explanation: 'Current flows through the LED path.',
      currentPathCount: 1
    },
    renderPlan: {
      title: 'Shared LED Badge',
      runText: 'LED blink',
      parts: [
        { id: 'arduino-uno', type: 'arduino', label: 'Arduino Uno', description: 'Controller board.', pins: [] },
        { id: 'led-1', type: 'led', label: 'Red LED', description: 'Output LED.', pins: [] }
      ],
      connections: [
        {
          id: 'signal-led',
          from: { partId: 'arduino-uno', pin: 'D9' },
          to: { partId: 'led-1', pin: 'A' },
          signal: 'digital',
          color: '#f97316'
        }
      ],
      floatingCards: []
    },
    contextEvidence: {
      coverageStatus: 'sufficient',
      score: 1,
      sourceTypes: ['registry', 'simulation'],
      warnings: []
    }
  };
}

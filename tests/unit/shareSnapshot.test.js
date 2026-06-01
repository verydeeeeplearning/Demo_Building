import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createShareMarkdown,
  createShareSnapshot,
  redactShareText
} from '../../src/shareSnapshot.js';

test('share snapshot projects a validated app project into a curated public artifact', () => {
  const snapshot = createShareSnapshot(createValidProject(), {
    locale: 'en',
    source: 'agent',
    createdAt: '2026-06-01T00:00:00.000Z',
    studentPromptSummary: 'Show my name on a small OLED.'
  });

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.locale, 'en');
  assert.equal(snapshot.status, 'valid');
  assert.equal(snapshot.validation.status, 'valid');
  assert.equal(snapshot.title, 'OLED Name Display');
  assert.equal(snapshot.circuit.components.length, 2);
  assert.equal(snapshot.circuit.connections[0].from, 'arduino-uno:5V');
  assert.equal(snapshot.simulation.available, true);
  assert.equal(snapshot.simulation.currentPathCount, 1);
  assert.deepEqual(snapshot.contextEvidence.sourceTypes, ['registry', 'simulation']);
});

test('share snapshot redacts secrets and excludes raw agent events and chat history', () => {
  const snapshot = createShareSnapshot({
    ...createValidProject(),
    agentEvents: [{ type: 'subagent', detail: 'raw internal event should not be shared' }],
    chatMessages: [{ role: 'student', text: 'private chat should not be shared' }],
    files: [{
      kind: 'Markdown',
      markdown: 'API key sk-proj-secretsecretsecretsecret and OPENAI_API_KEY=abc should be removed.'
    }]
  }, {
    locale: 'en',
    source: 'agent',
    createdAt: '2026-06-01T00:00:00.000Z',
    studentPromptSummary: 'private prompt with H_EDUWARE_AGENT_MODEL=gpt-5.5'
  });

  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /sk-proj-|OPENAI_API_KEY|H_EDUWARE_AGENT_MODEL|private chat|raw internal event/);
  assert.match(serialized, /\[redacted\]/);
});

test('invalid or unsupported projects are never labelled as valid working circuits', () => {
  const project = createValidProject();
  project.circuit.validationReport = {
    status: 'unsupported',
    errors: ['Unsupported request item: 220V mains power'],
    warnings: ['No render or current simulation is produced.'],
    validatedCurrentPathIds: []
  };
  project.circuit.simulationPlan = {
    status: 'unsupported',
    runText: '',
    currentPaths: [],
    expectedStates: [],
    warnings: ['No current animation for unsupported requests.']
  };
  project.circuit.circuitSpec.unsupportedItems = ['220V mains power'];

  const snapshot = createShareSnapshot(project, {
    locale: 'en',
    source: 'agent',
    createdAt: '2026-06-01T00:00:00.000Z'
  });

  assert.equal(snapshot.status, 'invalid');
  assert.equal(snapshot.validation.status, 'invalid');
  assert.equal(snapshot.simulation.available, false);
  assert.equal(snapshot.simulation.currentPathCount, 0);
  assert.deepEqual(snapshot.validation.unsupportedItems, ['220V mains power']);
});

test('share markdown reads as a student portfolio summary without leaking secrets', () => {
  const snapshot = createShareSnapshot(createValidProject(), {
    locale: 'en',
    source: 'agent',
    createdAt: '2026-06-01T00:00:00.000Z'
  });
  const markdown = createShareMarkdown({
    ...snapshot,
    requirementMarkdown: `${snapshot.requirementMarkdown}\n\nsk-proj-secretsecretsecretsecret`
  }, 'en');

  assert.match(markdown, /# Circuit I designed: OLED Name Display/);
  assert.match(markdown, /Arduino Uno/);
  assert.match(markdown, /Validation: valid/);
  assert.match(markdown, /Created with H-eduware/);
  assert.doesNotMatch(markdown, /sk-proj-/);
});

test('redactShareText removes known secret and local environment markers', () => {
  const redacted = redactShareText('sk-proj-abc_def-123456789012345 OPENAI_API_KEY=abc H_EDUWARE_AGENT_MODEL=gpt-5.5 .local/agent.env');

  assert.equal(redacted.includes('[redacted]'), true);
  assert.doesNotMatch(redacted, /sk-proj|OPENAI_API_KEY|H_EDUWARE_AGENT_MODEL|\.local\/agent\.env/);
});

function createValidProject() {
  return {
    circuit: {
      title: 'OLED Name Display',
      runText: 'RALPHTON BUSAN',
      parts: [
        { id: 'arduino-uno', type: 'arduino', label: 'Arduino Uno', designator: 'U1', description: 'Controller board.' },
        { id: 'oled-display', type: 'oled', label: '0.96 inch I2C OLED', designator: 'DISP1', description: 'Small display.' }
      ],
      connections: [
        {
          id: 'oled-power',
          from: { partId: 'arduino-uno', pin: '5V' },
          to: { partId: 'oled-display', pin: 'VCC' },
          education: { label: '5V POWER' }
        }
      ],
      validationReport: {
        status: 'valid',
        errors: [],
        warnings: [],
        validatedCurrentPathIds: ['oled-module-current']
      },
      simulationPlan: {
        status: 'valid',
        runText: 'RALPHTON BUSAN',
        currentPaths: [
          { id: 'oled-module-current', label: 'OLED module current', from: 'arduino-uno:5V', through: ['oled-display'], to: 'arduino-uno:GND' }
        ],
        expectedStates: [{ componentId: 'oled-display', state: 'shows text' }],
        warnings: []
      },
      circuitSpec: {
        id: 'oled-name-display',
        title: 'OLED Name Display',
        intent: { primaryGoal: 'show a name on an OLED screen', output: 'display', controller: 'arduino-uno' },
        components: [
          { id: 'arduino-uno', partId: 'arduino-uno', label: 'Arduino Uno' },
          { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED' }
        ],
        connections: [],
        behavior: { runText: 'RALPHTON BUSAN' },
        assumptions: [],
        unsupportedItems: [],
        clarificationNeeds: []
      },
      contextCoverage: {
        status: 'sufficient',
        score: 1,
        presentSourceTypes: ['registry', 'simulation'],
        warnings: []
      }
    },
    files: [
      {
        kind: 'Markdown',
        markdown: '# OLED Name Display\n\nArduino Uno shows a short name.'
      }
    ]
  };
}

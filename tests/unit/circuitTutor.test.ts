import assert from 'node:assert/strict';
import test from 'node:test';

import { runTutorAgent } from '../../server/agent/circuitTutor.ts';
import { TutorMessageRequestSchema } from '../../server/agent/schemas.ts';

const target = {
  id: 'connection:oled-power',
  type: 'connection',
  connectionId: 'oled-power',
  signal: 'power',
  label: '5V POWER',
  title: 'Power connection',
  summary: 'The red jumper sends Arduino 5V power to the OLED display.',
  detail: 'This power connection runs from Arduino Uno 5V to OLED VCC.',
  why: 'The display needs stable power before it can show text.',
  missing: 'If this wire is missing, the OLED will not turn on.',
  endpoints: ['Arduino Uno 5V', 'OLED VCC'],
  questions: ['What happens if this wire is missing?', 'How does current flow here?']
};

const artifacts = {
  circuitSpec: {
    id: 'oled-text',
    title: 'OLED text display',
    intent: { primaryGoal: 'show text on an OLED screen', output: 'display', controller: 'arduino-uno' },
    components: [
      { id: 'arduino-uno', partId: 'arduino-uno', label: 'Arduino Uno' },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED' }
    ],
    connections: [
      {
        id: 'oled-power',
        from: { componentId: 'arduino-uno', pin: '5V' },
        to: { componentId: 'oled-display', pin: 'VCC' },
        signal: 'power'
      }
    ],
    behavior: { runText: 'HELLO' },
    assumptions: [],
    unsupportedItems: [],
    clarificationNeeds: []
  },
  validationReport: {
    status: 'valid',
    errors: [],
    warnings: [],
    validatedCurrentPathIds: ['oled-module-current']
  },
  simulationPlan: {
    status: 'valid',
    runText: 'HELLO',
    currentPaths: [
      {
        id: 'oled-module-current',
        kind: 'supply-current',
        primitiveId: 'display_static_text',
        label: 'OLED module current',
        from: 'arduino-uno:5V',
        through: ['oled-display'],
        to: 'arduino-uno:GND',
        expectedCurrentMa: 18,
        animation: { color: '#5ce1e6', speed: 0.6 }
      }
    ],
    expectedStates: [{ componentId: 'oled-display', state: 'shows text', primitiveId: 'display_static_text' }],
    warnings: []
  },
  contextTrace: [
    {
      sourceId: 'data:simulation-primitives:display_static_text',
      sourceType: 'simulation',
      reason: 'Display text primitive grounds current and state explanation.',
      usedFields: ['currentPathRecipe', 'expectedStateRecipe']
    }
  ]
};

const request = TutorMessageRequestSchema.parse({
  locale: 'en',
  question: 'How does current flow here?',
  running: true,
  selectedTarget: target,
  artifacts
});

test('tutor request requires selected target and active circuit artifacts', () => {
  assert.throws(() => TutorMessageRequestSchema.parse({
    locale: 'en',
    question: 'How does current flow here?',
    running: true,
    selectedTarget: target
  }), /artifacts/i);

  assert.equal(request.target.id, 'connection:oled-power');
  assert.equal(request.artifacts.validationReport.status, 'valid');
  assert.equal(request.artifacts.simulationPlan.currentPaths[0].primitiveId, 'display_static_text');
});

test('tutor agent returns deterministic grounded explanations for selected circuit targets', async () => {
  const response = await runTutorAgent(request);

  assert.equal(response.mode, 'local');
  assert.match(response.sessionId, /^tutor-/);
  assert.match(response.message, /current/i);
  assert.ok(response.grounding.includes('connection:oled-power'));
  assert.ok(response.grounding.includes('Arduino Uno 5V'));
  assert.ok(response.grounding.includes('validation:valid'));
  assert.ok(response.grounding.includes('current-path:oled-module-current'));
  assert.ok(response.grounding.includes('data:simulation-primitives:display_static_text'));
  assert.deepEqual(response.suggestedQuestions, request.target.questions);
});

test('tutor agent recognizes Korean current-flow questions and returns readable Korean copy', async () => {
  const koreanRequest = TutorMessageRequestSchema.parse({
    ...request,
    locale: 'ko',
    question: '전류가 어떻게 흘러?'
  });

  const response = await runTutorAgent(koreanRequest);

  assert.equal(response.mode, 'local');
  assert.match(response.message, /전류/);
  assert.match(response.message, /GND|접지/);
  assert.doesNotMatch(response.message, /The red jumper|display needs/i);
  assert.doesNotMatch(response.message, /寃|利|뚮|꾨|먮|쫫|놁/);
  assert.ok(response.grounding.includes('current-path:oled-module-current'));
});

test('tutor agent recognizes Korean missing-wire questions and explains the selected target failure mode', async () => {
  const koreanRequest = TutorMessageRequestSchema.parse({
    ...request,
    locale: 'ko',
    question: '이 전선이 빠지면 어떻게 돼?'
  });

  const response = await runTutorAgent(koreanRequest);

  assert.equal(response.mode, 'local');
  assert.match(response.message, /빠지면|없으면/);
  assert.match(response.message, /OLED|켜지지|동작/);
  assert.doesNotMatch(response.message, /寃|利|뚮|꾨|먮|쫫|놁/);
  assert.ok(response.grounding.includes('connection:oled-power'));
});

test('tutor agent can use opt-in live mode without changing the default local path', async () => {
  const previousMode = process.env.H_EDUWARE_TUTOR_MODE;
  process.env.H_EDUWARE_TUTOR_MODE = 'live';

  try {
    const response = await runTutorAgent(request, {
      liveDraftProvider: async ({ request: liveRequest, localResponse }) => {
        assert.equal(liveRequest.target.id, 'connection:oled-power');
        assert.ok(localResponse.grounding.includes('current-path:oled-module-current'));
        return {
          message: 'Live tutor answer grounded in the selected OLED power connection.',
          suggestedQuestions: ['Why does the OLED need 5V?']
        };
      }
    });

    assert.equal(response.mode, 'live');
    assert.equal(response.message, 'Live tutor answer grounded in the selected OLED power connection.');
    assert.ok(response.grounding.includes('live-deepagents-tutor'));
    assert.ok(response.grounding.includes('current-path:oled-module-current'));
    assert.deepEqual(response.suggestedQuestions, ['Why does the OLED need 5V?']);
  } finally {
    restoreEnv('H_EDUWARE_TUTOR_MODE', previousMode);
  }
});

test('tutor agent falls back to local grounding when opt-in live tutor fails', async () => {
  const previousMode = process.env.H_EDUWARE_TUTOR_MODE;
  process.env.H_EDUWARE_TUTOR_MODE = 'live';

  try {
    const response = await runTutorAgent(request, {
      liveDraftProvider: async () => {
        throw new Error('simulated live tutor failure');
      }
    });

    assert.equal(response.mode, 'local');
    assert.match(response.message, /current/i);
    assert.ok(response.grounding.includes('connection:oled-power'));
    assert.ok(response.grounding.includes('current-path:oled-module-current'));
    assert.equal(response.grounding.includes('live-deepagents-tutor'), false);
  } finally {
    restoreEnv('H_EDUWARE_TUTOR_MODE', previousMode);
  }
});

test('tutor agent explains simulation-blocking render DRC warnings', async () => {
  const blockedRequest = TutorMessageRequestSchema.parse({
    ...request,
    question: 'How does current flow here?',
    artifacts: {
      ...artifacts,
      simulationPlan: {
        status: 'invalid',
        runText: '',
        currentPaths: [],
        expectedStates: [],
        warnings: [
          'SIMULATION_BLOCKED_BY_RENDER_DRC: BREADBOARD_RAIL_CONFLICT on led-1. led-1:A and button-1:B share the same breadboard rail (+ rail) without a logical connection.'
        ]
      }
    }
  });

  const response = await runTutorAgent(blockedRequest);

  assert.match(response.message, /simulation/i);
  assert.match(response.message, /BREADBOARD_RAIL_CONFLICT|rail/i);
  assert.match(response.message, /blocked|invalid|cannot/i);
  assert.ok(response.grounding.includes('simulation-warning:SIMULATION_BLOCKED_BY_RENDER_DRC'));
});

function restoreEnv(key: string, previousValue: string | undefined) {
  if (previousValue === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previousValue;
  }
}

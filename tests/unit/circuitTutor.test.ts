import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTutorRuntimeMode, runTutorAgent, tutorRuntimeHealth } from '../../server/agent/circuitTutor.ts';
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

const ledBreadboardTarget = {
  id: 'part:breadboard',
  type: 'part',
  partId: 'breadboard',
  label: 'Half-size breadboard',
  title: 'Half-size breadboard',
  summary: 'A solderless practice board for arranging parts and jumper wires.',
  detail: 'The breadboard holds Arduino, resistor, LED, and jumper wire placement.',
  why: 'It gives beginners a visible wiring layout.',
  missing: 'If the breadboard is missing, the layout is harder to inspect.',
  questions: ['What does this part do?']
};

const ledArtifacts = {
  circuitSpec: {
    id: 'led-blinker',
    title: 'LED blinker',
    intent: { primaryGoal: 'blink an LED', output: 'led', controller: 'arduino-uno' },
    components: [
      { id: 'breadboard', partId: 'breadboard-half', label: 'Half-size breadboard' },
      { id: 'arduino-uno', partId: 'arduino-uno', label: 'Arduino Uno' },
      { id: 'resistor-1', partId: 'resistor-220', label: '220 ohm resistor' },
      { id: 'led-1', partId: 'led-5mm', label: 'LED' }
    ],
    connections: [
      {
        id: 'd9-to-resistor',
        from: { componentId: 'arduino-uno', pin: 'D9' },
        to: { componentId: 'resistor-1', pin: '1' },
        signal: 'gpio'
      },
      {
        id: 'resistor-to-led',
        from: { componentId: 'resistor-1', pin: '2' },
        to: { componentId: 'led-1', pin: 'A' },
        signal: 'gpio'
      },
      {
        id: 'led-to-ground',
        from: { componentId: 'led-1', pin: 'K' },
        to: { componentId: 'arduino-uno', pin: 'GND' },
        signal: 'ground'
      }
    ],
    behavior: { runText: 'LED BLINK' },
    assumptions: ['A 220 ohm resistor limits LED current.'],
    unsupportedItems: [],
    clarificationNeeds: []
  },
  validationReport: {
    status: 'valid',
    errors: [],
    warnings: [],
    validatedCurrentPathIds: ['led-forward-current']
  },
  simulationPlan: {
    status: 'valid',
    runText: 'LED BLINK',
    currentPaths: [
      {
        id: 'led-forward-current',
        kind: 'load-current',
        primitiveId: 'digital_on_off',
        label: 'LED forward current',
        from: 'arduino-uno:D9',
        through: ['resistor-1', 'led-1'],
        to: 'arduino-uno:GND',
        expectedCurrentMa: 13.6,
        animation: { color: '#ff4d3d', speed: 0.8 }
      }
    ],
    expectedStates: [{ componentId: 'led-1', state: 'blinking', primitiveId: 'digital_on_off' }],
    warnings: []
  },
  contextTrace: [
    {
      sourceId: 'registry:part-capabilities:led-5mm',
      sourceType: 'registry',
      reason: 'Matched LED output.',
      usedFields: ['pins', 'requiredPassives']
    }
  ]
};

const ledBreadboardVoltageRequest = TutorMessageRequestSchema.parse({
  locale: 'en',
  question: 'Can the LED handle a higher voltage?',
  running: false,
  selectedTarget: ledBreadboardTarget,
  artifacts: ledArtifacts
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
  assert.equal(response.servingStatus, 'local_tutor_answer');
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
  const previousModel = process.env.H_EDUWARE_AGENT_MODEL;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.H_EDUWARE_TUTOR_MODE = 'live';
  process.env.H_EDUWARE_AGENT_MODEL = 'gpt-5.4-mini';
  process.env.OPENAI_API_KEY = 'test-key';

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
    assert.equal(response.servingStatus, 'live_tutor_answer');
    assert.equal(response.message, 'Live tutor answer grounded in the selected OLED power connection.');
    assert.ok(response.grounding.includes('live-deepagents-tutor'));
    assert.ok(response.grounding.includes('current-path:oled-module-current'));
    assert.deepEqual(response.suggestedQuestions, ['Why does the OLED need 5V?']);
  } finally {
    restoreEnv('H_EDUWARE_TUTOR_MODE', previousMode);
    restoreEnv('H_EDUWARE_AGENT_MODEL', previousModel);
    restoreEnv('OPENAI_API_KEY', previousKey);
  }
});

test('tutor runtime auto mode attempts live when credentials are configured', async () => {
  const previousMode = process.env.H_EDUWARE_TUTOR_MODE;
  const previousModel = process.env.H_EDUWARE_AGENT_MODEL;
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.H_EDUWARE_TUTOR_MODE;
  process.env.H_EDUWARE_AGENT_MODEL = 'gpt-5.4-mini';
  process.env.OPENAI_API_KEY = 'test-key';

  try {
    const resolution = resolveTutorRuntimeMode();
    assert.equal(resolution.runtimeMode, 'auto');
    assert.equal(resolution.liveConfigured, true);
    assert.equal(resolution.liveDefault, true);

    const response = await runTutorAgent(request, {
      traceId: 'tutor-test-trace',
      runName: 'h-eduware-circuit-tutor-test',
      tags: ['workflow:tutor-test'],
      metadata: { testCase: 'auto-live' },
      liveDraftProvider: async ({ traceId, runName, tags, metadata }) => {
        assert.equal(traceId, 'tutor-test-trace');
        assert.equal(runName, 'h-eduware-circuit-tutor-test');
        assert.deepEqual(tags, ['workflow:tutor-test']);
        assert.deepEqual(metadata, { testCase: 'auto-live' });
        return {
          message: 'Auto live tutor answer grounded in the selected connection.',
          suggestedQuestions: ['What confirms the return path?']
        };
      }
    });

    assert.equal(response.mode, 'live');
    assert.equal(response.servingStatus, 'live_tutor_answer');
    assert.equal(response.message, 'Auto live tutor answer grounded in the selected connection.');
  } finally {
    restoreEnv('H_EDUWARE_TUTOR_MODE', previousMode);
    restoreEnv('H_EDUWARE_AGENT_MODEL', previousModel);
    restoreEnv('OPENAI_API_KEY', previousKey);
  }
});

test('tutor runtime auto mode stays local when credentials are absent', async () => {
  const previousMode = process.env.H_EDUWARE_TUTOR_MODE;
  const previousModel = process.env.H_EDUWARE_AGENT_MODEL;
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.H_EDUWARE_TUTOR_MODE;
  delete process.env.H_EDUWARE_AGENT_MODEL;
  delete process.env.OPENAI_API_KEY;

  try {
    const resolution = resolveTutorRuntimeMode();
    assert.equal(resolution.runtimeMode, 'auto');
    assert.equal(resolution.liveConfigured, false);
    assert.equal(resolution.liveDefault, false);

    const response = await runTutorAgent(request, {
      liveDraftProvider: async () => {
        throw new Error('live should not be attempted without config');
      }
    });

    assert.equal(response.mode, 'local');
    assert.equal(response.servingStatus, 'local_tutor_answer');
  } finally {
    restoreEnv('H_EDUWARE_TUTOR_MODE', previousMode);
    restoreEnv('H_EDUWARE_AGENT_MODEL', previousModel);
    restoreEnv('OPENAI_API_KEY', previousKey);
  }
});

test('tutor health metadata is derived from the same runtime resolver', () => {
  const previousMode = process.env.H_EDUWARE_TUTOR_MODE;
  const previousModel = process.env.H_EDUWARE_AGENT_MODEL;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.H_EDUWARE_TUTOR_MODE = 'auto';
  process.env.H_EDUWARE_AGENT_MODEL = 'gpt-5.4-mini';
  process.env.OPENAI_API_KEY = 'test-key';

  try {
    const resolution = resolveTutorRuntimeMode();
    const health = tutorRuntimeHealth();

    assert.equal(health.tutor.runtimeMode, resolution.runtimeMode);
    assert.equal(health.tutor.liveConfigured, resolution.liveConfigured);
    assert.equal(health.tutor.liveDefault, resolution.liveDefault);
    assert.equal(health.tutor.liveRequired, resolution.liveRequired);
    assert.equal(health.tutor.fallbackAllowed, resolution.fallbackAllowed);
  } finally {
    restoreEnv('H_EDUWARE_TUTOR_MODE', previousMode);
    restoreEnv('H_EDUWARE_AGENT_MODEL', previousModel);
    restoreEnv('OPENAI_API_KEY', previousKey);
  }
});

test('tutor agent falls back to local grounding when opt-in live tutor fails', async () => {
  const previousMode = process.env.H_EDUWARE_TUTOR_MODE;
  const previousModel = process.env.H_EDUWARE_AGENT_MODEL;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.H_EDUWARE_TUTOR_MODE = 'live';
  process.env.H_EDUWARE_AGENT_MODEL = 'gpt-5.4-mini';
  process.env.OPENAI_API_KEY = 'test-key';

  try {
    const response = await runTutorAgent(request, {
      liveDraftProvider: async () => {
        throw new Error('simulated live tutor failure');
      }
    });

    assert.equal(response.mode, 'local');
    assert.equal(response.servingStatus, 'live_tutor_fallback');
    assert.equal(response.fallbackReason, 'live tutor failed');
    assert.match(response.message, /current/i);
    assert.ok(response.grounding.includes('connection:oled-power'));
    assert.ok(response.grounding.includes('current-path:oled-module-current'));
    assert.equal(response.grounding.includes('live-deepagents-tutor'), false);
  } finally {
    restoreEnv('H_EDUWARE_TUTOR_MODE', previousMode);
    restoreEnv('H_EDUWARE_AGENT_MODEL', previousModel);
    restoreEnv('OPENAI_API_KEY', previousKey);
  }
});

test('server local tutor retargets breadboard LED voltage questions to LED current limiting', async () => {
  const previousMode = process.env.H_EDUWARE_TUTOR_MODE;
  process.env.H_EDUWARE_TUTOR_MODE = 'local';

  try {
    const response = await runTutorAgent(ledBreadboardVoltageRequest);

    assert.equal(response.mode, 'local');
    assert.equal(response.servingStatus, 'local_tutor_answer');
    assert.match(response.message, /LED/i);
    assert.match(response.message, /current[- ]limiting resistor|limits current|resistor/i);
    assert.match(response.message, /higher voltage|5V|3\.3V|driver|MOSFET|transistor/i);
    assert.doesNotMatch(response.message, /solderless practice board|visible wiring layout/i);
    assert.ok(response.grounding.includes('part:breadboard'));
    assert.ok(response.grounding.includes('component:led-1'));
  } finally {
    restoreEnv('H_EDUWARE_TUTOR_MODE', previousMode);
  }
});

test('server live fallback retargets breadboard LED voltage questions while preserving fallback status', async () => {
  const previousMode = process.env.H_EDUWARE_TUTOR_MODE;
  const previousModel = process.env.H_EDUWARE_AGENT_MODEL;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.H_EDUWARE_TUTOR_MODE = 'live';
  process.env.H_EDUWARE_AGENT_MODEL = 'gpt-5.4-mini';
  process.env.OPENAI_API_KEY = 'test-key';

  try {
    const response = await runTutorAgent(ledBreadboardVoltageRequest, {
      liveDraftProvider: async () => {
        throw new Error('simulated live tutor failure');
      }
    });

    assert.equal(response.mode, 'local');
    assert.equal(response.servingStatus, 'live_tutor_fallback');
    assert.equal(response.fallbackCategory, 'live-failure');
    assert.match(response.message, /LED/i);
    assert.match(response.message, /current[- ]limiting resistor|limits current|resistor/i);
    assert.match(response.message, /higher voltage|5V|3\.3V|driver|MOSFET|transistor/i);
    assert.doesNotMatch(response.message, /solderless practice board|visible wiring layout/i);
    assert.ok(response.grounding.includes('component:led-1'));
  } finally {
    restoreEnv('H_EDUWARE_TUTOR_MODE', previousMode);
    restoreEnv('H_EDUWARE_AGENT_MODEL', previousModel);
    restoreEnv('OPENAI_API_KEY', previousKey);
  }
});

test('tutor agent falls back when live tutor draft violates structured output', async () => {
  const previousMode = process.env.H_EDUWARE_TUTOR_MODE;
  const previousModel = process.env.H_EDUWARE_AGENT_MODEL;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.H_EDUWARE_TUTOR_MODE = 'live';
  process.env.H_EDUWARE_AGENT_MODEL = 'gpt-5.4-mini';
  process.env.OPENAI_API_KEY = 'test-key';

  try {
    const response = await runTutorAgent(request, {
      liveDraftProvider: async () => ({
        message: '',
        suggestedQuestions: ['Why does the OLED need 5V?']
      })
    });

    assert.equal(response.mode, 'local');
    assert.equal(response.servingStatus, 'live_tutor_fallback');
    assert.equal(response.fallbackReason, 'malformed live tutor response');
    assert.ok(response.grounding.includes('connection:oled-power'));
    assert.equal(response.grounding.includes('live-deepagents-tutor'), false);
  } finally {
    restoreEnv('H_EDUWARE_TUTOR_MODE', previousMode);
    restoreEnv('H_EDUWARE_AGENT_MODEL', previousModel);
    restoreEnv('OPENAI_API_KEY', previousKey);
  }
});

test('tutor agent redacts live failure details before returning fallback reason', async () => {
  const previousMode = process.env.H_EDUWARE_TUTOR_MODE;
  const previousModel = process.env.H_EDUWARE_AGENT_MODEL;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.H_EDUWARE_TUTOR_MODE = 'live';
  process.env.H_EDUWARE_AGENT_MODEL = 'gpt-5.4-mini';
  process.env.OPENAI_API_KEY = 'test-key';

  try {
    const response = await runTutorAgent(request, {
      liveDraftProvider: async () => {
        throw new Error('OPENAI_API_KEY sk-test-secret H_EDUWARE_AGENT_MODEL question: How does current flow here?');
      }
    });

    assert.equal(response.mode, 'local');
    assert.equal(response.servingStatus, 'live_tutor_fallback');
    assert.doesNotMatch(response.fallbackReason ?? '', /sk-test-secret|OPENAI_API_KEY|H_EDUWARE_AGENT_MODEL|How does current flow/);
    assert.match(response.fallbackReason ?? '', /\[redacted\]/);
  } finally {
    restoreEnv('H_EDUWARE_TUTOR_MODE', previousMode);
    restoreEnv('H_EDUWARE_AGENT_MODEL', previousModel);
    restoreEnv('OPENAI_API_KEY', previousKey);
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

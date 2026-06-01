import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentConversationContextSchema,
  AgentMessageRequestSchema,
  AgentRunResultSchema,
  CircuitSpecSchema,
  IntentSpecV2Schema,
  PartCapabilitySchema,
  SimulationPlanSchema
} from '../../server/agent/schemas.ts';

test('part capabilities require electrical limits, render footprint, and simulation model', () => {
  const capability = PartCapabilitySchema.parse({
    id: 'led-5mm',
    kind: 'output',
    label: '5 mm LED',
    aliases: ['led', 'light'],
    pins: [
      { name: 'A', role: 'anode', aliases: ['positive'] },
      { name: 'K', role: 'cathode', aliases: ['negative'] }
    ],
    electrical: {
      voltageRange: { min: 1.8, max: 2.4, nominal: 2.0 },
      maxCurrentMa: 20,
      requiresCurrentLimiting: true
    },
    protocols: ['gpio'],
    requiredPassives: [{ partId: 'resistor-220', reason: 'limit LED current' }],
    renderFootprint: { type: 'led', width: 0.3, depth: 0.3, height: 0.5 },
    simulationModel: { type: 'diode-load', nominalCurrentMa: 13.6 }
  });

  assert.equal(capability.electrical.requiresCurrentLimiting, true);
  assert.equal(capability.renderFootprint.type, 'led');
});

test('circuit specs reject connections to missing components', () => {
  assert.throws(() => {
    CircuitSpecSchema.parse({
      id: 'bad-circuit',
      title: 'Bad circuit',
      intent: { primaryGoal: 'blink an LED', output: 'led', controller: 'arduino-uno' },
      components: [{ id: 'arduino-uno', partId: 'arduino-uno', label: 'Arduino Uno' }],
      connections: [
        {
          id: 'missing-target',
          from: { componentId: 'arduino-uno', pin: 'D9' },
          to: { componentId: 'led-1', pin: 'A' },
          signal: 'gpio'
        }
      ],
      behavior: { runText: 'BLINK' },
      assumptions: [],
      unsupportedItems: [],
      clarificationNeeds: []
    });
  }, /missing component/i);
});

test('IntentSpecV2 captures behavior, modality, ambiguity, and safety signals', () => {
  const parsed = IntentSpecV2Schema.parse({
    studentGoal: 'Turn on an LED when the room becomes dark.',
    behaviors: [
      {
        trigger: 'ambient light becomes dark',
        action: 'turn on light output',
        timing: 'analog'
      }
    ],
    inputModalities: ['light-sensor'],
    outputModalities: ['light-output'],
    controllerAssumptions: ['arduino-compatible'],
    powerAssumptions: ['usb-5v'],
    ambiguities: ['which light sensor is available'],
    safetySignals: [],
    unsupportedSignals: [],
    language: 'en',
    confidence: 0.74
  });

  assert.equal(parsed.studentGoal, 'Turn on an LED when the room becomes dark.');
  assert.equal(parsed.behaviors[0].timing, 'analog');
  assert.deepEqual(parsed.inputModalities, ['light-sensor']);
  assert.deepEqual(parsed.outputModalities, ['light-output']);
});

test('simulation plans contain validated current paths only', () => {
  const plan = SimulationPlanSchema.parse({
    status: 'valid',
    runText: 'LED ON',
    currentPaths: [
      {
        id: 'led-forward-current',
        label: 'LED forward current',
        from: 'arduino-uno:5V',
        through: ['resistor-1', 'led-1'],
        to: 'arduino-uno:GND',
        expectedCurrentMa: 13.6,
        animation: { color: '#ff4d3d', speed: 0.8 }
      }
    ],
    expectedStates: [{ componentId: 'led-1', state: 'on' }],
    warnings: []
  });

  assert.equal(plan.currentPaths.length, 1);
  assert.equal(plan.status, 'valid');
});

test('simulation path schema accepts semantic current and signal kinds', () => {
  const kinds = [
    'load-current',
    'supply-current',
    'signal-activity',
    'bus-activity',
    'sensing-divider',
    'fault-current'
  ];

  const plan = SimulationPlanSchema.parse({
    status: 'valid',
    runText: 'SEMANTIC PATHS',
    currentPaths: kinds.map((kind) => ({
      id: `${kind}-path`,
      kind,
      primitiveId: 'semantic-test-primitive',
      label: `${kind} path`,
      from: 'arduino-uno:D9',
      through: ['target-1'],
      to: 'arduino-uno:GND',
      expectedCurrentMa: kind.includes('activity') ? 0 : 1,
      animation: { color: '#84a9ff', speed: 0.5 }
    })),
    expectedStates: [],
    warnings: []
  });

  assert.deepEqual(plan.currentPaths.map((path) => path.kind), kinds);
});

test('agent result schema fixes the server response contract', () => {
  const resultWithoutContextTrace = {
    sessionId: 'session-test',
    mode: 'live',
    assistantMessages: ['I can build a safe LED circuit.'],
    agentEvents: [{ type: 'subagent', name: 'constraint-validator', status: 'completed' }],
    clarification: null,
    contextCoverage: {
      status: 'sufficient',
      score: 1,
      requiredSourceTypes: ['memory', 'registry', 'policy'],
      presentSourceTypes: ['memory', 'registry', 'policy'],
      missingSourceTypes: [],
      warnings: []
    },
    requirementMarkdown: '# Project Requirement: LED blinker',
    circuitSpec: {
      id: 'led-blinker',
      title: 'LED blinker',
      intent: { primaryGoal: 'blink an LED', output: 'led', controller: 'arduino-uno' },
      components: [
        { id: 'arduino-uno', partId: 'arduino-uno', label: 'Arduino Uno' },
        { id: 'led-1', partId: 'led-5mm', label: 'LED' },
        { id: 'resistor-1', partId: 'resistor-220', label: '220 ohm resistor' }
      ],
      connections: [
        {
          id: 'd9-to-resistor',
          from: { componentId: 'arduino-uno', pin: 'D9' },
          to: { componentId: 'resistor-1', pin: '1' },
          signal: 'gpio'
        }
      ],
      behavior: { runText: 'LED ON' },
      assumptions: [],
      unsupportedItems: [],
      clarificationNeeds: []
    },
    validationReport: { status: 'valid', errors: [], warnings: [], validatedCurrentPathIds: ['led-forward-current'] },
    renderPlan: { title: 'LED blinker', runText: 'LED ON', parts: [], connections: [], floatingCards: [] },
    simulationPlan: { status: 'valid', runText: 'LED ON', currentPaths: [], expectedStates: [], warnings: [] }
  };

  assert.throws(
    () => AgentRunResultSchema.parse(resultWithoutContextTrace),
    /contextTrace/i
  );

  assert.throws(
    () => AgentRunResultSchema.parse({
      ...resultWithoutContextTrace,
      contextCoverage: undefined,
      contextTrace: [
        {
          sourceId: 'registry:part-capabilities:led-5mm',
          sourceType: 'registry',
          reason: 'Matched student request for an LED output.',
          usedFields: ['pins']
        }
      ]
    }),
    /contextCoverage/i
  );

  const result = AgentRunResultSchema.parse({
    ...resultWithoutContextTrace,
    contextTrace: [
      {
        sourceId: 'registry:part-capabilities:led-5mm',
        sourceType: 'registry',
        reason: 'Matched student request for an LED output.',
        usedFields: ['pins', 'requiredPassives', 'simulationModel']
      },
      {
        sourceId: 'policy:safety-policy',
        sourceType: 'policy',
        reason: 'Applied low-voltage classroom safety constraints.',
        usedFields: ['safe-voltage-domain']
      }
    ]
  });

  assert.equal(result.mode, 'live');
  assert.ok(result.contextTrace.some((entry) => entry.sourceId === 'registry:part-capabilities:led-5mm'));
});

test('agent message request accepts bounded conversation and current artifact context', () => {
  const parsed = AgentMessageRequestSchema.parse({
    message: '좋아 구현 부탁해',
    locale: 'ko',
    conversationContext: {
      recentTurns: [
        { role: 'student', text: 'LED 깜빡이기' },
        { role: 'assistant', text: '검증 가능한 LED 회로 초안입니다.' }
      ],
      currentArtifact: {
        source: 'draft',
        title: 'LED blinker',
        requirementMarkdown: '# LED blinker'
      },
      lastSupportedGoal: 'blink an LED',
      awaitingBuildConfirmation: true
    }
  });

  assert.equal(parsed.conversationContext?.recentTurns.length, 2);
  assert.equal(parsed.conversationContext?.currentArtifact?.source, 'draft');
  assert.equal(parsed.conversationContext?.awaitingBuildConfirmation, true);
});

test('conversation context rejects unbounded recent turn history', () => {
  assert.throws(() => {
    AgentConversationContextSchema.parse({
      recentTurns: Array.from({ length: 13 }, (_, index) => ({
        role: index % 2 === 0 ? 'student' : 'assistant',
        text: `turn ${index}`
      })),
      awaitingBuildConfirmation: false
    });
  }, /too_big|at most 12|Array must contain at most 12/i);
});

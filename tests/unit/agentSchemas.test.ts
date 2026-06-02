import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentConversationContextSchema,
  AgentMessageRequestSchema,
  AgentRunResultSchema,
  BuildRunnableReportSchema,
  CircuitSpecSchema,
  IntentSpecV2Schema,
  PartCapabilitySchema,
  RenderPlanSchema,
  SimulationPlanSchema,
  SolverGateResultSchema,
  ValidationReportSchema
} from '../../server/agent/schemas.ts';
import { buildSolverGateResult } from '../../server/agent/circuitTools.ts';

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

test('solver gate result schema separates visible simulation from build-ready claims', () => {
  const diagnostic = SolverGateResultSchema.parse({
    visibleSimulation: true,
    mode: 'diagnostic_simulation',
    buildReady: false,
    simulationActivity: 'diagnostic',
    benchConfirmed: false,
    repairLevel: 'none',
    attempts: [{
      attempt: 1,
      stage: 'degrade',
      action: 'Expose the scene diagnostically while keeping build-ready blocked.',
      result: 'degraded',
      warnings: ['build-ready claim is not verified']
    }],
    verifiedClaims: ['render plan exposes 3 visible part(s)'],
    notVerified: ['build-ready claim is not verified'],
    visualWarnings: [],
    hardwareWarnings: [],
    repairSummary: ['No deterministic layout repair was required.']
  });

  assert.equal(diagnostic.visibleSimulation, true);
  assert.equal(diagnostic.buildReady, false);
  assert.equal(diagnostic.benchConfirmed, false);
  assert.equal(diagnostic.buildReadyScope, 'none');
  assert.equal(diagnostic.presentationAdjustment.kind, 'diagnostic_simulation');
  assert.equal(diagnostic.controls.runEnabled, false);
  assert.equal(diagnostic.controls.currentAnimationEnabled, false);
  assert.equal(diagnostic.controls.visualMoveEnabled, true);
  assert.ok(diagnostic.safeToRenderEvidence.some((item) => /visible render plan/i.test(item)));
  assert.equal(diagnostic.buildReadyScope, 'none');
  assert.equal(diagnostic.presentationAdjustment.kind, 'diagnostic_simulation');
  assert.equal(diagnostic.controls.runEnabled, false);
  assert.equal(diagnostic.controls.currentAnimationEnabled, false);
  assert.equal(diagnostic.controls.visualMoveEnabled, true);
  assert.ok(diagnostic.safeToRenderEvidence.some((evidence) => /visible render plan/i.test(evidence)));

  assert.throws(() => SolverGateResultSchema.parse({
    ...diagnostic,
    buildReady: false,
    notVerified: []
  }), /unverified/i);

  assert.throws(() => SolverGateResultSchema.parse({
    ...diagnostic,
    buildReady: true,
    visibleSimulation: false,
    mode: 'verified_build_simulation',
    notVerified: []
  }), /visible simulation/i);
});

test('solver gate result schema scopes safe equivalents to the displayed circuit', () => {
  const safeEquivalent = SolverGateResultSchema.parse({
    visibleSimulation: true,
    mode: 'safe_equivalent_simulation',
    buildReady: true,
    simulationActivity: 'verified_current',
    benchConfirmed: false,
    sourceSpecId: 'unsafe-original',
    equivalentSpecId: 'safe-equivalent-led',
    repairLevel: 'safe_equivalent',
    attempts: [],
    verifiedClaims: ['displayed safe equivalent build-ready runnable gate passed'],
    notVerified: ['original request is not build-ready'],
    visualWarnings: [],
    hardwareWarnings: [],
    repairSummary: ['Original unsafe request was replaced with a safe low-voltage equivalent simulation.'],
    presentationAdjustment: {
      kind: 'safe_equivalent_simulation',
      originalSpecId: 'unsafe-original',
      equivalentSpecId: 'safe-equivalent-led',
      originalBuildReady: false,
      displayedEquivalentBuildReady: true,
      blockedOriginalReasons: ['original request is unsafe'],
      equivalenceClaims: ['low-voltage LED output demonstrates the safe classroom behavior'],
      nonEquivalentWarnings: ['mains wiring is not shown'],
      reason: 'The safe equivalent is displayed instead of the unsafe original.'
    },
    buildReadyScope: 'displayed_equivalent',
    safeToRenderEvidence: ['safe low-voltage equivalent circuit is renderable'],
    controls: {
      runEnabled: true,
      currentAnimationEnabled: true,
      hardwareMoveEnabled: false,
      visualMoveEnabled: true,
      shareEnabled: true
    }
  });

  assert.equal(safeEquivalent.buildReadyScope, 'displayed_equivalent');
  assert.equal(safeEquivalent.presentationAdjustment.kind, 'safe_equivalent_simulation');
  assert.equal(safeEquivalent.presentationAdjustment.originalBuildReady, false);

  assert.throws(() => SolverGateResultSchema.parse({
    ...safeEquivalent,
    buildReadyScope: 'original'
  }), /original request/i);
});

test('solver gate result schema migrates safe-equivalent scope to displayed equivalent', () => {
  const safeEquivalent = SolverGateResultSchema.parse({
    visibleSimulation: true,
    mode: 'safe_equivalent_simulation',
    buildReady: true,
    simulationActivity: 'verified_current',
    benchConfirmed: false,
    sourceSpecId: 'unsafe-original',
    equivalentSpecId: 'safe-equivalent-led',
    repairLevel: 'safe_equivalent',
    attempts: [],
    verifiedClaims: ['safe low-voltage equivalent circuit was validated'],
    notVerified: ['original unsafe request was not converted into wiring or build-ready hardware'],
    visualWarnings: [],
    hardwareWarnings: [],
    repairSummary: ['Original unsafe request was replaced with a safe equivalent.']
  });

  assert.equal(safeEquivalent.buildReadyScope, 'displayed_equivalent');
  assert.equal(safeEquivalent.presentationAdjustment.kind, 'safe_equivalent_simulation');
  assert.equal(safeEquivalent.presentationAdjustment.originalBuildReady, false);
  assert.equal(safeEquivalent.presentationAdjustment.displayedEquivalentBuildReady, true);
  assert.equal(safeEquivalent.controls.runEnabled, true);

  assert.throws(() => SolverGateResultSchema.parse({
    ...safeEquivalent,
    buildReadyScope: 'original'
  }), /Safe-equivalent.*original|displayed equivalent/i);
});

test('placeholder solver gate metadata disables exact geometry and pin claims', () => {
  const placeholder = SolverGateResultSchema.parse({
    visibleSimulation: true,
    mode: 'placeholder_part_simulation',
    buildReady: false,
    simulationActivity: 'diagnostic',
    benchConfirmed: false,
    repairLevel: 'placeholder',
    attempts: [],
    verifiedClaims: ['render plan exposes 1 visible part(s)'],
    notVerified: ['build-ready claim is not verified'],
    visualWarnings: [{
      code: 'MISSING_RENDER_FOOTPRINT',
      componentId: 'mystery-sensor',
      message: 'Mystery sensor has no exact footprint in the catalog.'
    }],
    hardwareWarnings: [],
    repairSummary: ['Placeholder scene is visible for review.']
  });

  assert.equal(placeholder.presentationAdjustment.kind, 'placeholder_part_simulation');
  assert.deepEqual(placeholder.presentationAdjustment.placeholderPartIds, ['mystery-sensor']);
  assert.equal(placeholder.presentationAdjustment.exactGeometryClaim, false);
  assert.equal(placeholder.presentationAdjustment.pinGeometryClaim, false);
  assert.equal(placeholder.buildReadyScope, 'none');
  assert.equal(placeholder.controls.hardwareMoveEnabled, false);

  assert.throws(() => SolverGateResultSchema.parse({
    ...placeholder,
    presentationAdjustment: {
      ...placeholder.presentationAdjustment,
      exactGeometryClaim: true
    }
  }), /Invalid input|false/i);
});

test('solver gate derives state-only activity from state evidence without build-ready', () => {
  const validationReport = ValidationReportSchema.parse({
    status: 'valid',
    errors: [],
    warnings: [],
    validatedCurrentPathIds: []
  });
  const renderPlan = RenderPlanSchema.parse({
    title: 'Static state fixture',
    runText: 'STATIC STATE',
    parts: [{
      id: 'oled-display',
      type: 'oled',
      label: 'OLED display',
      description: 'Static display state fixture',
      pins: [],
      position: { x: 0, y: 0.25, z: 0 }
    }],
    connections: [],
    floatingCards: [],
    warnings: []
  });
  const simulationPlan = SimulationPlanSchema.parse({
    status: 'valid',
    runText: 'STATIC STATE',
    currentPaths: [],
    expectedStates: [{
      componentId: 'oled-display',
      state: 'shows STATIC STATE',
      explanation: 'The display readout is meaningful without a current-flow path.'
    }],
    warnings: []
  });
  const buildRunnableReport = BuildRunnableReportSchema.parse({
    status: 'blocked',
    runnable: false,
    reasons: ['layout is review-only until hardware placement evidence is complete'],
    validationStatus: 'valid',
    simulationStatus: 'valid',
    renderWarningCount: 0,
    renderBlockingWarningCount: 0,
    renderPartCount: 1,
    currentPathCount: 0,
    expectedStateCount: 1
  });

  const gate = buildSolverGateResult(validationReport, renderPlan, simulationPlan, buildRunnableReport);

  assert.equal(gate.buildReady, false);
  assert.equal(gate.simulationActivity, 'state_only');
  assert.equal(gate.presentationAdjustment.kind, 'state_only');
  assert.equal(gate.buildReadyScope, 'none');
  assert.equal(gate.controls.runEnabled, false);
  assert.equal(gate.controls.currentAnimationEnabled, false);
  assert.equal(gate.controls.visualMoveEnabled, true);
  assert.ok(gate.safeToRenderEvidence.some((evidence) => /state\/context evidence/i.test(evidence)));
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
    simulationPlan: { status: 'valid', runText: 'LED ON', currentPaths: [], expectedStates: [], warnings: [] },
    buildRunnableReport: {
      status: 'blocked',
      runnable: false,
      reasons: ['render plan has no build-ready parts'],
      validationStatus: 'valid',
      simulationStatus: 'valid',
      renderWarningCount: 0,
      renderBlockingWarningCount: 0,
      renderPartCount: 0,
      currentPathCount: 0,
      expectedStateCount: 0
    }
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
        requirementMarkdown: '# LED blinker',
        buildRunnableReport: {
          status: 'runnable',
          runnable: true,
          reasons: [],
          validationStatus: 'valid',
          simulationStatus: 'valid',
          renderWarningCount: 0,
          renderBlockingWarningCount: 0,
          renderPartCount: 3,
          currentPathCount: 1,
          expectedStateCount: 1
        }
      },
      lastSupportedGoal: 'blink an LED',
      pendingSupportedAlternative: {
        id: 'safe-low-voltage-led',
        goal: 'Arduino Uno LED with 220 ohm resistor',
        source: 'context-support-gap',
        partIds: ['arduino-uno', 'led-5mm', 'resistor-220'],
        capabilityIds: ['digital-light-output']
      },
      awaitingBuildConfirmation: true
    }
  });

  assert.equal(parsed.conversationContext?.recentTurns.length, 2);
  assert.equal(parsed.conversationContext?.currentArtifact?.source, 'draft');
  assert.equal(parsed.conversationContext?.currentArtifact?.buildRunnableReport?.runnable, true);
  assert.equal(parsed.conversationContext?.pendingSupportedAlternative?.id, 'safe-low-voltage-led');
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

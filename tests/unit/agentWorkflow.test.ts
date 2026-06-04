import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auditBreadboardPinTopology,
  auditBreadboardGridSnap,
  auditBreadboardPhysicalNodeConflicts,
  auditBreadboardContinuityConflicts,
  auditBreadboardRailConflicts,
  buildNetlist,
  buildRunnableReport,
  buildSolverGateResult,
  compileRenderPlan,
  compileRequirementMarkdown,
  compileSimulationPlan,
  detectFaults,
  estimateCurrentPaths,
  applyContextCoverageGate,
  selectTopologyTemplate,
  validateCircuitSpec
} from '../../server/agent/circuitTools.ts';
import { CircuitSpecSchema, type CircuitSpec, type PartCapability } from '../../server/agent/schemas.ts';
import {
  createHeduwareAgentTools,
  createUnscopedHeduwareAgentToolsForTests
} from '../../server/agent/deepAgentTools.ts';
import {
  buildAgentPromptBudgetAudits,
  AgentStructuredOutputError,
  agentRuntimeHealth,
  buildAgentUserPrompt,
  parseLiveAgentDraft,
  runAgentWithScriptedDrafts
} from '../../server/agent/deepAgentRuntime.ts';
import {
  getPartRegistry,
  loadCapabilityGraph,
  loadBreadboardGrid,
  loadSimulationPrimitives,
  loadTopologyTemplates
} from '../../server/context/contextLayer.ts';

type ScopedToolOptions = NonNullable<Parameters<typeof createHeduwareAgentTools>[0]>;

function scopedToolOptions(overrides: Partial<ScopedToolOptions> = {}): ScopedToolOptions {
  return {
    contextCoverage: {
      status: 'sufficient',
      score: 1,
      requiredSourceTypes: [],
      presentSourceTypes: [],
      missingSourceTypes: [],
      warnings: [],
      sufficientFor: ['valid_circuit_synthesis'],
      synthesisEligibility: {
        status: 'eligible',
        reason: 'Test-scoped context coverage is sufficient.'
      }
    },
    candidateParts: [],
    allowedContextSourceIds: [],
    supportBundles: [],
    ...overrides
  };
}

async function partCapabilities(partIds: string[]): Promise<PartCapability[]> {
  const registry = await getPartRegistry();
  const byId = new Map(registry.map((part) => [part.id, part]));
  return partIds.map((partId) => {
    const part = byId.get(partId);
    assert.ok(part, `${partId} registry entry exists`);
    return part;
  });
}

const diverseSpecs: Array<[CircuitSpec, string]> = [
  [oledCircuit(), 'oled-i2c-096'],
  [lcdTextDisplayCircuit(), 'lcd-16x2'],
  [ledCircuit(), 'led-5mm'],
  [buttonLedCircuit(), 'button-tactile'],
  [buzzerCircuit(), 'piezo-buzzer'],
  [activeBuzzerCircuit(), 'active-buzzer'],
  [rgbLedColorCircuit(), 'rgb-led-common-cathode'],
  [laserModuleCircuit(), 'laser-diode-module'],
  [servoCircuit(), 'micro-servo'],
  [mg996rServoCircuit(), 'mg996r-servo'],
  [mosfetMotorCircuit(), 'dc-motor-130'],
  [transistorMotorCircuit(), '2n2222-npn'],
  [potentiometerLedDimmerCircuit(), 'potentiometer-10k'],
  [ldrDarkLedCircuit(), 'photoresistor-ldr'],
  [ultrasonicDistanceDisplayCircuit(), 'ultrasonic-hc-sr04'],
  [dht11TemperatureHumidityDisplayCircuit(), 'dht11'],
  [dht22TemperatureHumidityDisplayCircuit(), 'dht22'],
  [soilMoistureDisplayCircuit(), 'soil-moisture'],
  [rainSensorThresholdLedCircuit(), 'rain-sensor'],
  [bareSevenSegmentDisplayCircuit(), '7seg-1digit'],
  [tm1637NumberDisplayCircuit(), '7seg-4digit-tm1637'],
  [max7219MatrixDisplayCircuit(), '8x8-matrix-max7219'],
  [neopixelRingPatternCircuit(), 'neopixel-ring-12'],
  [ws2812bStripPatternCircuit(), 'ws2812b-strip'],
  [tftSpiDisplayCircuit(), 'tft-18'],
  [nokia5110DisplayCircuit(), 'nokia-5110'],
  [epaper213DisplayCircuit(), 'epaper-213']
];

type RequirementAnalysisRoute = 'casual_chat' | 'clarify_requirements' | 'synthesize_circuit' | 'unsupported_or_gap';

function requirementAnalysisFixture(
  route: RequirementAnalysisRoute,
  overrides: Record<string, unknown> = {}
) {
  const base = {
    route,
    confidence: 0.95,
    summary: `Scripted requirement-analysis fixture selected ${route}.`,
    assistantMessage: route === 'synthesize_circuit'
      ? 'Proceeding to circuit synthesis.'
      : 'I need one concrete circuit goal before synthesis.',
    clarification: null,
    blockingReason: null,
    circuitGoal: {
      input: null,
      output: null,
      behavior: null,
      controller: null
    },
    agentEvents: []
  };
  const circuitGoal = {
    ...base.circuitGoal,
    ...((overrides.circuitGoal as Record<string, unknown> | undefined) ?? {})
  };

  return {
    ...base,
    ...overrides,
    circuitGoal
  };
}

test('agent health exposes gpt-5.4-mini when live runtime is configured', () => {
  const previousModel = process.env.H_EDUWARE_AGENT_MODEL;
  const previousKey = process.env.OPENAI_API_KEY;

  process.env.H_EDUWARE_AGENT_MODEL = 'gpt-5.4-mini';
  process.env.OPENAI_API_KEY = 'test-key';

  try {
    const health = agentRuntimeHealth();

    assert.equal(health.ok, true);
    assert.equal(health.model, 'gpt-5.4-mini');
    assert.equal(health.provider, 'openai');
  } finally {
    if (previousModel === undefined) {
      delete process.env.H_EDUWARE_AGENT_MODEL;
    } else {
      process.env.H_EDUWARE_AGENT_MODEL = previousModel;
    }

    if (previousKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousKey;
    }
  }
});

test('live agent composed prompts stay within the selected route prompt budget', async () => {
  const cases = [
    ['led', 'Blink an LED from Arduino Uno pin D9 with a 220 ohm resistor.'],
    ['button-buzzer', 'Press a button to make a buzzer beep.'],
    ['analog-dimmer', 'Use a 10k potentiometer to control LED brightness with Arduino PWM.']
  ];

  for (const [label, message] of cases) {
    const { contextPacket, audits } = await buildAgentPromptBudgetAudits({ message, locale: 'en' });

    for (const audit of audits) {
      assert.equal(
        audit.withinBudget,
        true,
        `${label}/${contextPacket.contextRoute.routeId}/${audit.stage} prompt budget exceeded: ${audit.actualChars}/${audit.maxChars}`
      );
    }
  }
});

test('deterministic circuit tools handle at least five diverse student requirements end to end', async () => {
  for (const [spec, expectedPartId] of diverseSpecs) {
    const validationReport = await validateCircuitSpec(spec);
    const netlist = await buildNetlist(spec);
    const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
    const renderPlan = await compileRenderPlan(spec, validationReport);
    const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
    const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);
    const requirementMarkdown = await compileRequirementMarkdown(spec, validationReport, simulationPlan, runnableReport);

    assert.equal(validationReport.status, 'valid', spec.title);
    assert.match(requirementMarkdown, /^# Project Requirement:/);
    assert.ok(
      spec.components.some((component) => component.partId === expectedPartId),
      `${spec.title} should include ${expectedPartId}`
    );
    assert.ok(renderPlan.parts.length >= 3, 'render plan includes board, controller, and target part');
    assert.ok(simulationPlan.currentPaths.length >= 1, 'simulation includes current flow');
  }
});

test('I2C LCD display family validates, renders, and simulates through the display contract', async () => {
  const spec = lcdTextDisplayCircuit();
  const validationReport = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
  const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);

  assert.equal(validationReport.status, 'valid');
  assert.equal(validationReport.electricalAnalysis?.topologyTemplateId, 'controller-i2c-character-display');
  assert.ok(renderPlan.parts.some((part) => part.type === 'lcd-character-16x2'));
  assert.equal(simulationPlan.status, 'valid');
  assert.ok(simulationPlan.currentPaths.some((path) => path.through.includes('lcd-display')));
  assert.equal(runnableReport.runnable, true);
});

test('LED array and addressable display families validate, render, and simulate through module contracts', async () => {
  for (const { spec, topologyId, footprintType, requiredPathId } of [
    {
      spec: tm1637NumberDisplayCircuit(),
      topologyId: 'controller-led-array-display',
      footprintType: 'tm1637-4digit-display',
      requiredPathId: 'led-array-display-data-signal:tm1637-display'
    },
    {
      spec: max7219MatrixDisplayCircuit(),
      topologyId: 'controller-led-array-display',
      footprintType: 'max7219-8x8-matrix',
      requiredPathId: 'led-array-display-select-signal:matrix-display'
    },
    {
      spec: neopixelRingPatternCircuit(),
      topologyId: 'controller-addressable-led-display',
      footprintType: 'neopixel-ring-12',
      requiredPathId: 'addressable-led-data-signal:neopixel-ring'
    }
  ]) {
    const validationReport = await validateCircuitSpec(spec);
    const netlist = await buildNetlist(spec);
    const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
    const renderPlan = await compileRenderPlan(spec, validationReport);
    const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
    const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);

    assert.equal(validationReport.status, 'valid', spec.title);
    assert.equal(validationReport.electricalAnalysis?.topologyTemplateId, topologyId);
    assert.ok(renderPlan.parts.some((part) => part.type === footprintType), spec.title);
    assert.ok(simulationPlan.currentPaths.some((path) => path.id === requiredPathId), spec.title);
    assert.equal(runnableReport.runnable, true, spec.title);
  }
});

test('WP-05 light and sound outputs validate, render, and simulate through explicit part contracts', async () => {
  for (const { spec, topologyId, footprintType, requiredPathIds, requiredWarning } of [
    {
      spec: activeBuzzerCircuit(),
      topologyId: 'controller-direct-low-current-load',
      footprintType: 'active-buzzer',
      requiredPathIds: ['buzzer-current']
    },
    {
      spec: rgbLedColorCircuit(),
      topologyId: 'controller-rgb-led-current-limited-output',
      footprintType: 'rgb-led-common-cathode',
      requiredPathIds: [
        'rgb-led-channel-current:rgb-led:R',
        'rgb-led-channel-current:rgb-led:G',
        'rgb-led-channel-current:rgb-led:B'
      ]
    },
    {
      spec: laserModuleCircuit(),
      topologyId: 'controller-powered-light-module-output',
      footprintType: 'laser-diode-module',
      requiredPathIds: [
        'powered-light-module-supply-current:laser-module',
        'powered-light-module-control-signal:laser-module'
      ],
      requiredWarning: 'LASER_MODULE_SAFETY_WARNING'
    },
    {
      spec: ws2812bStripPatternCircuit(),
      topologyId: 'controller-addressable-led-display',
      footprintType: 'ws2812b-strip',
      requiredPathIds: [
        'addressable-led-supply-current:ws2812b-strip',
        'addressable-led-data-signal:ws2812b-strip'
      ]
    }
  ]) {
    const validationReport = await validateCircuitSpec(spec);
    const netlist = await buildNetlist(spec);
    const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
    const renderPlan = await compileRenderPlan(spec, validationReport);
    const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
    const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);
    const simulationPathIds = simulationPlan.currentPaths.map((path) => path.id);

    assert.equal(validationReport.status, 'valid', spec.title);
    assert.equal(validationReport.electricalAnalysis?.topologyTemplateId, topologyId);
    assert.ok(renderPlan.parts.some((part) => part.type === footprintType), spec.title);
    for (const pathId of requiredPathIds) {
      assert.ok(simulationPathIds.includes(pathId), `${spec.title} should include ${pathId}; got ${simulationPathIds.join(', ')}`);
    }
    if (requiredWarning) {
      assert.ok(validationReport.warnings.some((warning) => warning.includes(requiredWarning)), spec.title);
    }
    assert.equal(runnableReport.runnable, true, spec.title);
  }
});

test('WP-07 low-voltage power rail sources validate, render, and simulate qualitative rail state', async () => {
  for (const { spec, footprintType, sourceComponentId } of [
    {
      spec: powerRailSourceCircuit('breadboard-psu', '5V', 'GND', 'Breadboard PSU rail'),
      footprintType: 'breadboard-psu',
      sourceComponentId: 'power-source'
    },
    {
      spec: powerRailSourceCircuit('9v-battery-clip', '+', '-', '9V battery rail'),
      footprintType: 'battery-9v-clip',
      sourceComponentId: 'power-source'
    },
    {
      spec: powerRailSourceCircuit('aa-battery-holder', '+', '-', '4xAA holder rail'),
      footprintType: 'aa-battery-holder',
      sourceComponentId: 'power-source'
    },
    {
      spec: powerRailSourceCircuit('lipo-battery-1s', '+', '-', '1S LiPo rail'),
      footprintType: 'lipo-battery-1s',
      sourceComponentId: 'power-source'
    },
    {
      spec: powerRailSourceCircuit('barrel-jack', 'VCC', 'GND', 'DC barrel jack rail'),
      footprintType: 'barrel-jack',
      sourceComponentId: 'power-source'
    },
    {
      spec: powerRailSourceCircuit('screw-terminal-2pin', 'A', 'B', '2-pin screw terminal rail'),
      footprintType: 'screw-terminal-2pin',
      sourceComponentId: 'power-source'
    }
  ]) {
    const validationReport = await validateCircuitSpec(spec);
    const netlist = await buildNetlist(spec);
    const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
    const renderPlan = await compileRenderPlan(spec, validationReport);
    const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
    const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);

    assert.equal(validationReport.status, 'valid', spec.title);
    assert.equal(validationReport.electricalAnalysis?.topologyTemplateId, 'external-low-voltage-power-rail');
    assert.ok(renderPlan.parts.some((part) => part.type === footprintType), spec.title);
    assert.equal(simulationPlan.currentPaths.length, 0, spec.title);
    assert.ok(
      simulationPlan.expectedStates.some((state) =>
        state.componentId === sourceComponentId && state.primitiveId === 'low_voltage_power_rail_state'
      ),
      spec.title
    );
    if (spec.components.some((component) => component.partId === 'lipo-battery-1s')) {
      assert.ok(validationReport.warnings.some((warning) => warning.includes('LIPO_POWER_WARNING')));
    }
    assert.equal(runnableReport.runnable, true, spec.title);
  }
});

test('WP-07 passive protection and timing parts render as state-only context without fake current flow', async () => {
  for (const { spec, topologyId, footprintType, primitiveId } of [
    {
      spec: passiveContextCircuit('ceramic-cap', 'Ceramic capacitor context'),
      topologyId: 'protection-passive-in-series-or-parallel',
      footprintType: 'ceramic-capacitor',
      primitiveId: 'passive_protection_context_state'
    },
    {
      spec: passiveContextCircuit('electrolytic-cap', 'Electrolytic capacitor context'),
      topologyId: 'protection-passive-in-series-or-parallel',
      footprintType: 'electrolytic-capacitor',
      primitiveId: 'passive_protection_context_state'
    },
    {
      spec: passiveContextCircuit('diode-1n4007', '1N4007 diode context'),
      topologyId: 'protection-passive-in-series-or-parallel',
      footprintType: 'rectifier-diode',
      primitiveId: 'passive_protection_context_state'
    },
    {
      spec: passiveContextCircuit('schottky-diode', 'Schottky diode context'),
      topologyId: 'protection-passive-in-series-or-parallel',
      footprintType: 'schottky-diode',
      primitiveId: 'passive_protection_context_state'
    },
    {
      spec: passiveContextCircuit('zener-diode', 'Zener diode context'),
      topologyId: 'protection-passive-in-series-or-parallel',
      footprintType: 'zener-diode',
      primitiveId: 'passive_protection_context_state'
    },
    {
      spec: passiveContextCircuit('polyfuse', 'Polyfuse context'),
      topologyId: 'protection-passive-in-series-or-parallel',
      footprintType: 'polyfuse',
      primitiveId: 'passive_protection_context_state'
    },
    {
      spec: passiveContextCircuit('inductor-axial', 'Axial inductor context'),
      topologyId: 'protection-passive-in-series-or-parallel',
      footprintType: 'axial-inductor',
      primitiveId: 'passive_protection_context_state'
    },
    {
      spec: passiveContextCircuit('crystal-16mhz', '16 MHz crystal context'),
      topologyId: 'timing-passive-context-only',
      footprintType: 'crystal-16mhz',
      primitiveId: 'timing_passive_context_state'
    }
  ]) {
    const validationReport = await validateCircuitSpec(spec);
    const netlist = await buildNetlist(spec);
    const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
    const renderPlan = await compileRenderPlan(spec, validationReport);
    const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
    const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);

    assert.equal(validationReport.status, 'valid', spec.title);
    assert.equal(validationReport.electricalAnalysis?.topologyTemplateId, topologyId);
    assert.ok(renderPlan.parts.some((part) => part.type === footprintType), spec.title);
    assert.equal(simulationPlan.currentPaths.length, 0, spec.title);
    assert.ok(simulationPlan.expectedStates.some((state) =>
      state.componentId === 'passive-1' && state.primitiveId === primitiveId
    ), spec.title);
    assert.equal(runnableReport.runnable, true, spec.title);
  }
});

test('WP-07 passive safety blocks reversed electrolytic and unsafe LiPo handling', async () => {
  const reversedCapReport = await validateCircuitSpec(reversedElectrolyticContextCircuit());
  assert.equal(reversedCapReport.status, 'invalid');
  assert.ok(reversedCapReport.errors.some((error) => error.includes('POLARIZED_PASSIVE_REVERSED')));

  const unsafeLipoReport = await validateCircuitSpec(unsafeLipoHandlingCircuit());
  assert.equal(unsafeLipoReport.status, 'invalid');
  assert.ok(unsafeLipoReport.errors.some((error) => error.includes('LIPO_UNSAFE_HANDLING_BLOCKED')));
});

test('WP-07 7805 regulated rail requires input, output rail, and common ground evidence', async () => {
  const spec = regulated7805PowerRailCircuit();
  const validationReport = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
  const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);

  assert.equal(validationReport.status, 'valid');
  assert.equal(validationReport.electricalAnalysis?.topologyTemplateId, 'regulated-5v-rail');
  assert.ok(renderPlan.parts.some((part) => part.type === '7805-regulator'));
  assert.equal(simulationPlan.currentPaths.length, 0);
  assert.ok(simulationPlan.expectedStates.some((state) =>
    state.componentId === 'regulator-1' && state.primitiveId === 'regulated_5v_rail_state'
  ));
  assert.equal(runnableReport.runnable, true);
});

test('WP-07 regulated rail blocks missing common ground before simulation', async () => {
  const validationReport = await validateCircuitSpec(regulated7805MissingCommonGroundCircuit());

  assert.equal(validationReport.status, 'invalid');
  assert.ok(validationReport.errors.some((error) => error.includes('REGULATOR_COMMON_GROUND_MISSING')));
});

test('WP-09 prototyping surfaces and connectors render as state-only context without fake current flow', async () => {
  for (const { spec, topologyId, footprintType, primitiveId, warning } of [
    {
      spec: wp09ContextCircuit('breadboard-full', 'Full breadboard context'),
      topologyId: 'prototyping-surface-context-only',
      footprintType: 'breadboard-full',
      primitiveId: 'prototyping_surface_context_state',
      warning: 'PROTOTYPING_SURFACE_STATE_ONLY'
    },
    {
      spec: wp09ContextCircuit('breadboard-mini', 'Mini breadboard context'),
      topologyId: 'prototyping-surface-context-only',
      footprintType: 'breadboard-mini',
      primitiveId: 'prototyping_surface_context_state',
      warning: 'PROTOTYPING_SURFACE_STATE_ONLY'
    },
    {
      spec: wp09ContextCircuit('perfboard-5x7', 'Perfboard context'),
      topologyId: 'prototyping-surface-context-only',
      footprintType: 'perfboard-5x7',
      primitiveId: 'prototyping_surface_context_state',
      warning: 'PROTOTYPING_SURFACE_STATE_ONLY'
    },
    {
      spec: wp09ContextCircuit('pcb-blank-single', 'Blank PCB context'),
      topologyId: 'prototyping-surface-context-only',
      footprintType: 'pcb-blank-single',
      primitiveId: 'prototyping_surface_context_state',
      warning: 'PROTOTYPING_SURFACE_STATE_ONLY'
    },
    {
      spec: wp09ContextCircuit('proto-shield-uno', 'Uno proto shield context'),
      topologyId: 'prototyping-surface-context-only',
      footprintType: 'proto-shield-uno',
      primitiveId: 'prototyping_surface_context_state',
      warning: 'PROTOTYPING_SURFACE_STATE_ONLY'
    },
    {
      spec: wp09ContextCircuit('header-male-40pin', 'Male header context'),
      topologyId: 'connector-wiring-context-only',
      footprintType: 'header-male-40pin',
      primitiveId: 'connector_wiring_context_state',
      warning: 'CONNECTOR_CONTEXT_STATE_ONLY'
    },
    {
      spec: wp09ContextCircuit('header-female-40pin', 'Female header context'),
      topologyId: 'connector-wiring-context-only',
      footprintType: 'header-female-40pin',
      primitiveId: 'connector_wiring_context_state',
      warning: 'CONNECTOR_CONTEXT_STATE_ONLY'
    },
    {
      spec: wp09ContextCircuit('screw-terminal-4pin', '4-pin screw terminal connector context'),
      topologyId: 'connector-wiring-context-only',
      footprintType: 'screw-terminal-4pin',
      primitiveId: 'connector_wiring_context_state',
      warning: 'CONNECTOR_CONTEXT_STATE_ONLY'
    }
  ]) {
    const validationReport = await validateCircuitSpec(spec);
    const netlist = await buildNetlist(spec);
    const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
    const renderPlan = await compileRenderPlan(spec, validationReport);
    const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
    const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);

    assert.equal(validationReport.status, 'valid', spec.title);
    assert.equal(validationReport.electricalAnalysis?.topologyTemplateId, topologyId);
    assert.ok(renderPlan.parts.some((part) => part.type === footprintType), spec.title);
    assert.equal(simulationPlan.currentPaths.length, 0, spec.title);
    assert.ok(simulationPlan.expectedStates.some((state) =>
      state.componentId === 'wp09-context-1' && state.primitiveId === primitiveId
    ), spec.title);
    assert.ok(validationReport.warnings.some((entry) => entry.includes(warning)), spec.title);
    assert.equal(runnableReport.runnable, true, spec.title);
  }
});

test('WP-09 context blocks mains wiring and 4-pin terminal source overclaims', async () => {
  const mainsSurfaceReport = await validateCircuitSpec(wp09MainsContextCircuit('perfboard-5x7'));
  assert.equal(mainsSurfaceReport.status, 'invalid');
  assert.ok(mainsSurfaceReport.errors.some((error) => error.includes('PROTOTYPING_CONTEXT_UNSAFE_MAINS')));

  const terminalSourceReport = await validateCircuitSpec(wp09TerminalPowerSourceCircuit());
  assert.equal(terminalSourceReport.status, 'invalid');
  assert.ok(terminalSourceReport.errors.some((error) => error.includes('CONNECTOR_CONTEXT_NOT_POWER_SOURCE')));
});

test('WP-08 controller boards render as state-only pin-map and voltage-domain context', async () => {
  for (const { spec, footprintType, expect3v3Warning } of [
    {
      spec: controllerBoardContextCircuit('arduino-nano', 'Arduino Nano board context'),
      footprintType: 'arduino-nano-board',
      expect3v3Warning: false
    },
    {
      spec: controllerBoardContextCircuit('esp32-devkit', 'ESP32 DevKit board context'),
      footprintType: 'esp32-devkit-board',
      expect3v3Warning: true
    }
  ]) {
    const validationReport = await validateCircuitSpec(spec);
    const netlist = await buildNetlist(spec);
    const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
    const renderPlan = await compileRenderPlan(spec, validationReport);
    const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
    const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);

    assert.equal(validationReport.status, 'valid', spec.title);
    assert.equal(validationReport.electricalAnalysis?.topologyTemplateId, 'controller-board-pin-map-substitution');
    assert.ok(renderPlan.parts.some((part) => part.type === footprintType), spec.title);
    assert.equal(simulationPlan.currentPaths.length, 0, spec.title);
    assert.ok(simulationPlan.expectedStates.some((state) =>
      state.componentId === 'controller-board-1' && state.primitiveId === 'controller_board_context_state'
    ), spec.title);
    assert.ok(validationReport.warnings.some((entry) => entry.includes('CONTROLLER_BOARD_CONTEXT_STATE_ONLY')), spec.title);
    assert.equal(validationReport.warnings.some((entry) => entry.includes('CONTROLLER_BOARD_3V3_DOMAIN')), expect3v3Warning, spec.title);
    assert.equal(runnableReport.runnable, true, spec.title);
  }
});

test('WP-08 controller board circuit substitution stays blocked until a circuit bundle opts in', async () => {
  const validationReport = await validateCircuitSpec(controllerBoardOverreachLedCircuit());

  assert.equal(validationReport.status, 'invalid');
  assert.ok(validationReport.errors.some((error) => error.includes('CONTROLLER_BOARD_SUBSTITUTION_NOT_VALIDATED')));
});

test('WP-06 low-side switched loads validate, render, and simulate through driver contracts', async () => {
  for (const { spec, topologyId, footprintTypes, requiredPathIds, requiredWarning } of [
    {
      spec: mosfetMotorCircuit(),
      topologyId: 'controller-mosfet-module-load',
      footprintTypes: ['mosfet-module', 'dc-motor'],
      requiredPathIds: [
        'low-side-load-supply-current:motor-1',
        'low-side-load-control-signal:motor-1'
      ],
      requiredWarning: 'LOW_SIDE_LOAD_POWER_WARNING'
    },
    {
      spec: transistorMotorCircuit(),
      topologyId: 'controller-transistor-low-side-load',
      footprintTypes: ['to92-transistor', 'dc-motor'],
      requiredPathIds: [
        'low-side-load-supply-current:motor-1',
        'low-side-load-control-signal:motor-1'
      ],
      requiredWarning: 'INDUCTIVE_LOAD_FLYBACK_WARNING'
    },
    {
      spec: vibrationMotorModuleCircuit(),
      topologyId: 'controller-mosfet-module-load',
      footprintTypes: ['vibration-motor-module'],
      requiredPathIds: [
        'low-side-load-supply-current:vibration-1',
        'low-side-load-control-signal:vibration-1'
      ],
      requiredWarning: 'LOW_SIDE_LOAD_POWER_WARNING'
    }
  ]) {
    const validationReport = await validateCircuitSpec(spec);
    const netlist = await buildNetlist(spec);
    const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
    const renderPlan = await compileRenderPlan(spec, validationReport);
    const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
    const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);
    const simulationPathIds = simulationPlan.currentPaths.map((path) => path.id);

    assert.equal(validationReport.status, 'valid', spec.title);
    assert.equal(validationReport.electricalAnalysis?.topologyTemplateId, topologyId);
    for (const footprintType of footprintTypes) {
      assert.ok(renderPlan.parts.some((part) => part.type === footprintType), `${spec.title} should render ${footprintType}`);
    }
    for (const pathId of requiredPathIds) {
      assert.ok(simulationPathIds.includes(pathId), `${spec.title} should include ${pathId}; got ${simulationPathIds.join(', ')}`);
    }
    assert.ok(validationReport.warnings.some((warning) => warning.includes(requiredWarning)), spec.title);
    assert.equal(runnableReport.runnable, true, spec.title);
  }
});

test('WP-06 low-side load validator rejects direct motor GPIO drive', async () => {
  const validationReport = await validateCircuitSpec(directGpioMotorCircuit());

  assert.equal(validationReport.status, 'invalid');
  assert.ok(validationReport.errors.some((error) => error.includes('MOTOR_DIRECT_TO_GPIO')), validationReport.errors.join('\n'));
});

test('WP-06 transistor low-side switch requires a base resistor', async () => {
  const validationReport = await validateCircuitSpec(transistorMotorCircuitWithoutBaseResistor());

  assert.equal(validationReport.status, 'invalid');
  assert.ok(validationReport.errors.some((error) => error.includes('LOW_SIDE_BASE_RESISTOR_MISSING')), validationReport.errors.join('\n'));
});

test('WP-06 stepper motors validate, render, and simulate through driver contracts', async () => {
  for (const { spec, topologyId, footprintTypes, requiredPathIds } of [
    {
      spec: uln2003StepperCircuit(),
      topologyId: 'controller-uln2003-unipolar-stepper',
      footprintTypes: ['uln2003-stepper-driver', 'unipolar-stepper'],
      requiredPathIds: [
        'stepper-coil-current:stepper-1',
        'stepper-control-signals:stepper-1'
      ]
    },
    {
      spec: a4988Nema17StepperCircuit(),
      topologyId: 'controller-step-dir-bipolar-stepper',
      footprintTypes: ['step-dir-stepper-driver', 'nema17-stepper'],
      requiredPathIds: [
        'stepper-coil-current:stepper-1',
        'stepper-control-signals:stepper-1'
      ]
    },
    {
      spec: drv8825Nema17StepperCircuit(),
      topologyId: 'controller-step-dir-bipolar-stepper',
      footprintTypes: ['step-dir-stepper-driver', 'nema17-stepper'],
      requiredPathIds: [
        'stepper-coil-current:stepper-1',
        'stepper-control-signals:stepper-1'
      ]
    }
  ]) {
    const validationReport = await validateCircuitSpec(spec);
    const netlist = await buildNetlist(spec);
    const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
    const renderPlan = await compileRenderPlan(spec, validationReport);
    const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
    const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);
    const simulationPathIds = simulationPlan.currentPaths.map((path) => path.id);

    assert.equal(validationReport.status, 'valid', validationReport.errors.join('\n'));
    assert.equal(validationReport.electricalAnalysis?.topologyTemplateId, topologyId);
    for (const footprintType of footprintTypes) {
      assert.ok(renderPlan.parts.some((part) => part.type === footprintType), `${spec.title} should render ${footprintType}`);
    }
    for (const pathId of requiredPathIds) {
      assert.ok(simulationPathIds.includes(pathId), `${spec.title} should include ${pathId}; got ${simulationPathIds.join(', ')}`);
    }
    assert.ok(validationReport.warnings.some((warning) => warning.includes('STEPPER_POWER_WARNING')), spec.title);
    assert.equal(runnableReport.runnable, true, runnableReport.reasons.join('\n'));
  }
});

test('WP-06 stepper validator rejects direct coil GPIO drive', async () => {
  const validationReport = await validateCircuitSpec(directGpioStepperCircuit());

  assert.equal(validationReport.status, 'invalid');
  assert.ok(validationReport.errors.some((error) => error.includes('STEPPER_DIRECT_TO_GPIO')), validationReport.errors.join('\n'));
});

test('WP-06 H-bridge motor drivers validate, render, and simulate direction-control paths', async () => {
  for (const { spec, footprintType } of [
    { spec: l298nMotorCircuit(), footprintType: 'hbridge-driver-module' },
    { spec: l293dMotorCircuit(), footprintType: 'hbridge-driver-ic' }
  ]) {
    const validationReport = await validateCircuitSpec(spec);
    const netlist = await buildNetlist(spec);
    const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
    const renderPlan = await compileRenderPlan(spec, validationReport);
    const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
    const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);
    const simulationPathIds = simulationPlan.currentPaths.map((path) => path.id);

    assert.equal(validationReport.status, 'valid', validationReport.errors.join('\n'));
    assert.equal(validationReport.electricalAnalysis?.topologyTemplateId, 'controller-hbridge-dc-motor');
    assert.ok(renderPlan.parts.some((part) => part.type === footprintType), `${spec.title} should render ${footprintType}`);
    assert.ok(renderPlan.parts.some((part) => part.type === 'dc-motor'), `${spec.title} should render dc-motor`);
    assert.ok(simulationPathIds.includes('hbridge-motor-current:motor-1'), simulationPathIds.join(', '));
    assert.ok(simulationPathIds.includes('hbridge-control-signals:motor-1'), simulationPathIds.join(', '));
    assert.ok(validationReport.warnings.some((warning) => warning.includes('HBRIDGE_MOTOR_POWER_WARNING')), spec.title);
    assert.equal(runnableReport.runnable, true, runnableReport.reasons.join('\n'));
  }
});

test('WP-06 relay modules validate, render, and simulate only low-voltage contact loads', async () => {
  for (const { spec, footprintType, relayId } of [
    { spec: relayLowVoltageLedCircuit(), footprintType: 'relay-module-1ch', relayId: 'relay-1' },
    { spec: relay4chLowVoltageLedCircuit(), footprintType: 'relay-module-4ch', relayId: 'relay-1' }
  ]) {
    const validationReport = await validateCircuitSpec(spec);
    const netlist = await buildNetlist(spec);
    const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
    const renderPlan = await compileRenderPlan(spec, validationReport);
    const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
    const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);
    const simulationPathIds = simulationPlan.currentPaths.map((path) => path.id);

    assert.equal(validationReport.status, 'valid', validationReport.errors.join('\n'));
    assert.equal(validationReport.electricalAnalysis?.topologyTemplateId, 'controller-relay-low-voltage-load');
    assert.ok(renderPlan.parts.some((part) => part.type === footprintType), `${spec.title} should render ${footprintType}`);
    assert.ok(simulationPathIds.includes(`relay-coil-control-signal:${relayId}`), simulationPathIds.join(', '));
    assert.ok(simulationPathIds.includes(`relay-contact-load-current:${relayId}`), simulationPathIds.join(', '));
    assert.ok(validationReport.warnings.some((warning) => warning.includes('RELAY_LOW_VOLTAGE_ONLY_WARNING')), spec.title);
    assert.equal(runnableReport.runnable, true, runnableReport.reasons.join('\n'));
  }
});

test('WP-06 relay validator rejects mains relay load language', async () => {
  const validationReport = await validateCircuitSpec(mainsRelayCircuit());

  assert.equal(validationReport.status, 'invalid');
  assert.ok(validationReport.errors.some((error) => error.includes('RELAY_MAINS_LOAD_UNSUPPORTED')), validationReport.errors.join('\n'));
});

test('SPI display family validates, renders, and simulates through the SPI display contract', async () => {
  for (const { spec, footprintType, requiredPathId } of [
    {
      spec: tftSpiDisplayCircuit(),
      footprintType: 'tft-18-spi-display',
      requiredPathId: 'spi-display-control-signal:tft-display:RS'
    },
    {
      spec: nokia5110DisplayCircuit(),
      footprintType: 'nokia-5110-display',
      requiredPathId: 'spi-display-control-signal:nokia-display:DC'
    },
    {
      spec: epaper213DisplayCircuit(),
      footprintType: 'epaper-213-display',
      requiredPathId: 'spi-display-control-signal:epaper-display:RST'
    }
  ]) {
    const validationReport = await validateCircuitSpec(spec);
    const netlist = await buildNetlist(spec);
    const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
    const renderPlan = await compileRenderPlan(spec, validationReport);
    const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
    const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);

    assert.equal(validationReport.status, 'valid', spec.title);
    assert.equal(validationReport.electricalAnalysis?.topologyTemplateId, 'controller-spi-display');
    assert.ok(renderPlan.parts.some((part) => part.type === footprintType), spec.title);
    assert.ok(simulationPlan.currentPaths.some((path) => path.id === requiredPathId), spec.title);
    assert.equal(runnableReport.runnable, true, spec.title);
  }
});

test('bare single digit 7-segment display validates, renders, and simulates through per-segment resistor paths', async () => {
  const spec = bareSevenSegmentDisplayCircuit();
  const validationReport = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
  const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);

  assert.equal(validationReport.status, 'valid');
  assert.equal(validationReport.electricalAnalysis?.topologyTemplateId, 'controller-bare-seven-segment-display');
  assert.ok(renderPlan.parts.some((part) => part.type === 'seven-segment-1digit'));
  assert.deepEqual(
    simulationPlan.currentPaths.map((path) => path.id),
    ['bare-seven-segment-current:sevenseg-display:A', 'bare-seven-segment-current:sevenseg-display:B']
  );
  assert.deepEqual(
    simulationPlan.currentPaths.map((path) => path.through),
    [['segment-a-resistor', 'sevenseg-display'], ['segment-b-resistor', 'sevenseg-display']]
  );
  assert.equal(runnableReport.runnable, true);
});

test('topology templates describe reusable role-based circuit structures', async () => {
  const templates = await loadTopologyTemplates();
  const byId = new Map(templates.map((template) => [template.id, template]));

  for (const id of [
    'controller-i2c-module',
    'controller-i2c-character-display',
    'controller-digital-output-series-load',
    'controller-digital-input-switch-plus-output',
    'controller-digital-input-switch-plus-multiple-outputs',
    'controller-direct-low-current-load',
    'controller-pwm-actuator',
    'controller-analog-input-pwm-output',
    'controller-analog-threshold-output',
    'controller-analog-sensor-i2c-display',
    'controller-analog-sensor-threshold-output',
    'controller-distance-sensor-i2c-display',
    'controller-single-wire-sensor-i2c-display',
    'controller-digital-input-display',
    'controller-digital-input-output',
    'controller-pulse-digital-sensor-display',
    'controller-matrix-input-display',
    'controller-dual-analog-input-display',
    'controller-quadrature-input-display',
    'controller-logic-interface-context',
    'controller-i2c-interface-context',
    'controller-spi-interface-context',
    'controller-analog-timing-interface-context',
    'level-shifted-i2c-bus',
    'controller-bare-seven-segment-display',
    'controller-led-array-display',
    'controller-addressable-led-display',
    'controller-rgb-led-current-limited-output',
    'controller-powered-light-module-output',
    'controller-servo-external-power-warning',
    'controller-transistor-low-side-load',
    'controller-mosfet-module-load',
    'controller-uln2003-unipolar-stepper',
    'controller-step-dir-bipolar-stepper',
    'controller-hbridge-dc-motor',
    'controller-relay-low-voltage-load',
    'controller-spi-display'
  ]) {
    assert.ok(byId.has(id), `${id} topology template should exist`);
  }

  for (const template of templates) {
    assert.ok(template.requiredRoles.length > 0, `${template.id} declares required roles`);
    assert.ok(template.nets.length > 0, `${template.id} declares nets`);
    assert.ok(template.connections.length > 0, `${template.id} declares role-to-net connections`);
    assert.ok(template.validationRules.length > 0, `${template.id} declares validation rules`);
    assert.ok(
      template.requiredRoles.every((role) => !/(arduino-uno|oled-i2c-096|led-5mm|resistor-220|piezo-buzzer|micro-servo)/i.test(role)),
      `${template.id} should use generic topology roles, not concrete part ids`
    );
  }
});

test('topology selector maps capability roles to circuit structures instead of fixed hardware order', async () => {
  const graph = await loadCapabilityGraph();

  assert.equal(await selectedTopologyId(graph, ['display-text-output']), 'controller-i2c-character-display');
  assert.equal(await selectedTopologyId(graph, ['digital-light-output']), 'controller-digital-output-series-load');
  assert.equal(await selectedTopologyId(graph, ['button-controlled-light-output']), 'controller-digital-input-switch-plus-output');
  assert.equal(
    await selectedTopologyId(graph, ['button-controlled-light-output', 'sound-alert-output']),
    'controller-digital-input-switch-plus-multiple-outputs'
  );
  assert.equal(await selectedTopologyId(graph, ['sound-alert-output']), 'controller-direct-low-current-load');
  assert.equal(await selectedTopologyId(graph, ['servo-motion-output']), 'controller-pwm-actuator');
  assert.equal(await selectedTopologyId(graph, ['analog-led-dimmer']), 'controller-analog-input-pwm-output');
  assert.equal(await selectedTopologyId(graph, ['light-sensor-triggered-output']), 'controller-analog-threshold-output');
  assert.equal(await selectedTopologyId(graph, ['analog-sensor-display-readout']), 'controller-analog-sensor-i2c-display');
  assert.equal(await selectedTopologyId(graph, ['analog-sensor-threshold-output']), 'controller-analog-sensor-threshold-output');
  assert.equal(await selectedTopologyId(graph, ['distance-sensor-display']), 'controller-distance-sensor-i2c-display');
  assert.equal(await selectedTopologyId(graph, ['dht11-temperature-humidity-display']), 'controller-single-wire-sensor-i2c-display');
  assert.equal(await selectedTopologyId(graph, ['digital-input-display-readout']), 'controller-digital-input-display');
  assert.equal(await selectedTopologyId(graph, ['digital-input-threshold-output']), 'controller-digital-input-output');
  assert.equal(await selectedTopologyId(graph, ['matrix-input-display-readout']), 'controller-matrix-input-display');
  assert.equal(await selectedTopologyId(graph, ['joystick-display-readout']), 'controller-dual-analog-input-display');
  assert.equal(await selectedTopologyId(graph, ['rotary-encoder-display-readout']), 'controller-quadrature-input-display');
  assert.equal(await selectedTopologyId(graph, ['bare-seven-segment-display-output']), 'controller-bare-seven-segment-display');
  assert.equal(await selectedTopologyId(graph, ['led-array-display-output']), 'controller-led-array-display');
  assert.equal(await selectedTopologyId(graph, ['addressable-led-display-output']), 'controller-addressable-led-display');
  assert.equal(await selectedTopologyId(graph, ['spi-display-output']), 'controller-spi-display');
  assert.equal(await selectedTopologyId(graph, ['logic-interface-context']), 'controller-i2c-interface-context');
  assert.equal(await selectedTopologyId(graph, ['low-side-switched-load-output']), 'controller-mosfet-module-load');
  assert.equal(await selectedTopologyId(graph, ['stepper-motor-output']), 'controller-uln2003-unipolar-stepper');
  assert.equal(await selectedTopologyId(graph, ['hbridge-motor-output']), 'controller-hbridge-dc-motor');
  assert.equal(await selectedTopologyId(graph, ['relay-low-voltage-output']), 'controller-relay-low-voltage-load');
});

test('validation report cites the selected topology template as electrical analysis evidence', async () => {
  const ledValidation = await validateCircuitSpec(ledCircuit());
  const buttonValidation = await validateCircuitSpec(buttonLedCircuit());
  const buttonBuzzerValidation = await validateCircuitSpec(buttonLedBuzzerCircuit());
  const servoValidation = await validateCircuitSpec(servoCircuit());
  const potentiometerValidation = await validateCircuitSpec(potentiometerLedDimmerCircuit());
  const ldrValidation = await validateCircuitSpec(ldrDarkLedCircuit());
  const dht11Validation = await validateCircuitSpec(dht11TemperatureHumidityDisplayCircuit());
  const analogSensorDisplayValidation = await validateCircuitSpec(soilMoistureDisplayCircuit());
  const analogSensorThresholdValidation = await validateCircuitSpec(rainSensorThresholdLedCircuit());
  const digitalInputDisplayValidation = await validateCircuitSpec(pirMotionDisplayCircuit());
  const digitalInputOutputValidation = await validateCircuitSpec(limitSwitchLedCircuit());
  const matrixInputValidation = await validateCircuitSpec(keypadDisplayCircuit());
  const joystickValidation = await validateCircuitSpec(joystickDisplayCircuit());
  const rotaryValidation = await validateCircuitSpec(rotaryEncoderDisplayCircuit());
  const bareSevenSegmentValidation = await validateCircuitSpec(bareSevenSegmentDisplayCircuit());
  const tm1637Validation = await validateCircuitSpec(tm1637NumberDisplayCircuit());
  const max7219Validation = await validateCircuitSpec(max7219MatrixDisplayCircuit());
  const neopixelValidation = await validateCircuitSpec(neopixelRingPatternCircuit());
  const rgbLedValidation = await validateCircuitSpec(rgbLedColorCircuit());
  const laserModuleValidation = await validateCircuitSpec(laserModuleCircuit());
  const highTorqueServoValidation = await validateCircuitSpec(mg996rServoCircuit());
  const mosfetMotorValidation = await validateCircuitSpec(mosfetMotorCircuit());
  const transistorMotorValidation = await validateCircuitSpec(transistorMotorCircuit());
  const uln2003StepperValidation = await validateCircuitSpec(uln2003StepperCircuit());
  const a4988StepperValidation = await validateCircuitSpec(a4988Nema17StepperCircuit());
  const l298nMotorValidation = await validateCircuitSpec(l298nMotorCircuit());
  const relayValidation = await validateCircuitSpec(relayLowVoltageLedCircuit());
  const tftValidation = await validateCircuitSpec(tftSpiDisplayCircuit());

  assert.equal(ledValidation.electricalAnalysis?.topologyTemplateId, 'controller-digital-output-series-load');
  assert.equal(buttonValidation.electricalAnalysis?.topologyTemplateId, 'controller-digital-input-switch-plus-output');
  assert.equal(buttonBuzzerValidation.electricalAnalysis?.topologyTemplateId, 'controller-digital-input-switch-plus-multiple-outputs');
  assert.equal(servoValidation.electricalAnalysis?.topologyTemplateId, 'controller-pwm-actuator');
  assert.equal(potentiometerValidation.electricalAnalysis?.topologyTemplateId, 'controller-analog-input-pwm-output');
  assert.equal(ldrValidation.electricalAnalysis?.topologyTemplateId, 'controller-analog-threshold-output');
  assert.equal(dht11Validation.electricalAnalysis?.topologyTemplateId, 'controller-single-wire-sensor-i2c-display');
  assert.equal(analogSensorDisplayValidation.electricalAnalysis?.topologyTemplateId, 'controller-analog-sensor-i2c-display');
  assert.equal(analogSensorThresholdValidation.electricalAnalysis?.topologyTemplateId, 'controller-analog-sensor-threshold-output');
  assert.equal(digitalInputDisplayValidation.electricalAnalysis?.topologyTemplateId, 'controller-digital-input-display');
  assert.equal(digitalInputOutputValidation.electricalAnalysis?.topologyTemplateId, 'controller-digital-input-output');
  assert.equal(matrixInputValidation.electricalAnalysis?.topologyTemplateId, 'controller-matrix-input-display');
  assert.equal(joystickValidation.electricalAnalysis?.topologyTemplateId, 'controller-dual-analog-input-display');
  assert.equal(rotaryValidation.electricalAnalysis?.topologyTemplateId, 'controller-quadrature-input-display');
  assert.equal(bareSevenSegmentValidation.electricalAnalysis?.topologyTemplateId, 'controller-bare-seven-segment-display');
  assert.equal(tm1637Validation.electricalAnalysis?.topologyTemplateId, 'controller-led-array-display');
  assert.equal(max7219Validation.electricalAnalysis?.topologyTemplateId, 'controller-led-array-display');
  assert.equal(neopixelValidation.electricalAnalysis?.topologyTemplateId, 'controller-addressable-led-display');
  assert.equal(rgbLedValidation.electricalAnalysis?.topologyTemplateId, 'controller-rgb-led-current-limited-output');
  assert.equal(laserModuleValidation.electricalAnalysis?.topologyTemplateId, 'controller-powered-light-module-output');
  assert.equal(highTorqueServoValidation.electricalAnalysis?.topologyTemplateId, 'controller-servo-external-power-warning');
  assert.equal(mosfetMotorValidation.electricalAnalysis?.topologyTemplateId, 'controller-mosfet-module-load');
  assert.equal(transistorMotorValidation.electricalAnalysis?.topologyTemplateId, 'controller-transistor-low-side-load');
  assert.equal(uln2003StepperValidation.electricalAnalysis?.topologyTemplateId, 'controller-uln2003-unipolar-stepper');
  assert.equal(a4988StepperValidation.electricalAnalysis?.topologyTemplateId, 'controller-step-dir-bipolar-stepper');
  assert.equal(l298nMotorValidation.electricalAnalysis?.topologyTemplateId, 'controller-hbridge-dc-motor');
  assert.equal(relayValidation.electricalAnalysis?.topologyTemplateId, 'controller-relay-low-voltage-load');
  assert.equal(tftValidation.electricalAnalysis?.topologyTemplateId, 'controller-spi-display');
});

test('agent repair loop retries once with deterministic validation errors', async () => {
  const result = await runAgentWithScriptedDrafts({
    request: {
      message: 'Blink one LED with the proper resistor on an Arduino breadboard.',
      locale: 'en'
    },
    drafts: [
      agentDraft('I drafted the LED circuit, but it may need validation.', ledCircuitWithoutResistor()),
      agentDraft('I repaired the circuit by adding the current-limiting resistor.', ledCircuit())
    ]
  });

  assert.equal(result.validationReport.status, 'valid');
  assert.equal(result.buildRunnableReport.status, 'runnable');
  assert.ok(result.circuitSpec.components.some((component) => component.partId === 'resistor-220'));
  assert.ok(result.agentEvents.some((event) =>
    event.name === 'validation-repair' &&
    event.summary?.includes('LED_WITHOUT_RESISTOR')
  ));
});

test('agent repair loop accepts drafts when render DRC can be auto-repaired', async () => {
  const result = await runAgentWithScriptedDrafts({
    request: {
      message: 'Build a button controlled LED circuit on an Arduino breadboard.',
      locale: 'en'
    },
    drafts: [
      agentDraft('The button LED circuit is ready to run.', buttonLedCircuitWithHiddenRailConflict()),
      agentDraft('I repaired the physical breadboard placement.', buttonLedCircuit())
    ]
  });

  assert.equal(result.validationReport.status, 'valid');
  assert.equal(result.simulationPlan.status, 'valid');
  assert.equal(result.buildRunnableReport.status, 'runnable');
  assert.equal(result.solverGateResult?.mode, 'auto_repaired_simulation');
  assert.equal(result.solverGateResult?.repairLevel, 'layout');
  assert.equal(result.agentEvents.some((event) => event.name === 'validation-repair'), false);
});

test('agent repair loop stops after two invalid drafts and does not use a third silent repair', async () => {
  const result = await runAgentWithScriptedDrafts({
    request: {
      message: 'Blink one LED with the proper resistor on an Arduino breadboard.',
      locale: 'en'
    },
    drafts: [
      agentDraft('First invalid draft.', ledCircuitWithoutResistor()),
      agentDraft('Second invalid draft.', ledCircuitWithoutResistor()),
      agentDraft('Third valid draft that must not be consumed.', ledCircuit())
    ]
  });

  assert.equal(result.validationReport.status, 'invalid');
  assert.equal(result.circuitSpec.components.some((component) => component.partId === 'resistor-220'), false);
  assert.ok(result.agentEvents.some((event) =>
    event.name === 'validation-repair-exhausted' &&
    event.summary?.includes('LED_WITHOUT_RESISTOR')
  ));
});

test('unsafe high-voltage requests return a safe equivalent simulation before consuming live drafts', async () => {
  const result = await runAgentWithScriptedDrafts({
    request: {
      message: 'Use a breadboard to switch a 220V wall outlet heater.',
      locale: 'en'
    },
    requirementAnalysis: requirementAnalysisFixture('unsupported_or_gap', {
      summary: 'The student asked for mains-voltage heater switching on a breadboard.',
      assistantMessage: 'This is unsafe and unsupported for a student breadboard simulation. I can help reframe it as a safe low-voltage Arduino LED circuit instead.',
      clarification: 'Tell me the safe low-voltage Arduino behavior you want to build instead.',
      blockingReason: 'Mains-voltage heater switching is outside the safe build-ready scope.',
      circuitGoal: {
        input: 'mains outlet',
        output: 'heater',
        behavior: 'switch a 220V load',
        controller: 'breadboard'
      }
    }),
    drafts: []
  });

  assert.equal(result.validationReport.status, 'valid');
  assert.equal(result.simulationPlan.status, 'valid');
  assert.equal(result.buildRunnableReport.runnable, true);
  assert.equal(result.solverGateResult?.mode, 'safe_equivalent_simulation');
  assert.equal(result.solverGateResult?.repairLevel, 'safe_equivalent');
  assert.equal(result.solverGateResult?.sourceSpecId, 'unsupported-safety-request');
  assert.equal(result.solverGateResult?.equivalentSpecId, 'unsupported-safety-request-safe-equivalent-led');
  assert.ok(result.renderPlan.parts.some((part) => part.id === 'led-1'));
  assert.ok(result.simulationPlan.currentPaths.length > 0);
  assert.equal(result.supportedAlternatives[0]?.id, 'safe-low-voltage-led');
  assert.equal(result.supportedAlternatives[0]?.source, 'safety-policy');
  assert.match(result.assistantMessages.join('\n'), /original request|safe low-voltage|equivalent simulation/i);
  assert.equal(result.circuitSpec.unsupportedItems.length, 0);
  assert.ok(result.circuitSpec.assumptions.some((item) => /220V|heater|mains|unsafe|unsupported/i.test(item)));
  assert.ok(result.agentEvents.some((event) => event.name === 'safety-policy'));
});

test('distance sensor display requests consume a draft and produce runnable artifacts', async () => {
  const result = await runAgentWithScriptedDrafts({
    request: {
      message: 'Show distance from an ultrasonic sensor on the OLED display.',
      locale: 'en'
    },
    requirementAnalysis: requirementAnalysisFixture('synthesize_circuit', {
      summary: 'The student asked for a supported ultrasonic distance readout on an OLED.',
      assistantMessage: 'I can build the supported HC-SR04 distance display circuit.',
      circuitGoal: {
        input: 'ultrasonic distance sensor',
        output: 'OLED distance text',
        behavior: 'display measured distance',
        controller: 'Arduino'
      }
    }),
    drafts: [
      agentDraft('The distance display circuit is ready to run.', ultrasonicDistanceDisplayCircuit())
    ]
  });

  assert.equal(result.validationReport.status, 'valid');
  assert.equal(result.simulationPlan.status, 'valid');
  assert.equal(result.buildRunnableReport.runnable, true);
  assert.ok(result.renderPlan.parts.some((part) => part.type === 'ultrasonic-sensor'));
  assert.ok(result.simulationPlan.currentPaths.some((path) => path.id === 'distance-trigger-signal:ultrasonic-1'));
  assert.ok(result.simulationPlan.currentPaths.some((path) => path.id === 'distance-echo-signal:ultrasonic-1'));
  assert.ok(result.simulationPlan.expectedStates.some((state) => state.primitiveId === 'display_sensor_value'));
  assert.equal(result.agentEvents.some((event) => event.name === 'context-support-gap'), false);
});

test('student-facing assistant copy hides support-bundle jargon', async () => {
  const result = await runAgentWithScriptedDrafts({
    request: {
      message: '초음파 센서 거리값을 OLED에 표시하고 싶어.',
      locale: 'ko'
    },
    requirementAnalysis: requirementAnalysisFixture('unsupported_or_gap', {
      summary: '검증 자료가 부족한 요청이다.',
      assistantMessage: '현재 요청 컨텍스트에는 필수 지원 번들 증거가 로드되어 있지 않습니다. 그래서 빌드 가능한 배선도/렌더/전류 흐름 시뮬레이션으로 확정하지 않겠습니다.',
      clarification: '현재 지원되는 회로를 선택하거나 검증 자료를 먼저 추가해 주세요.',
      blockingReason: 'distance-sensor-display verified support data is incomplete.',
      circuitGoal: {
        input: '초음파 센서',
        output: 'OLED 거리값',
        behavior: '거리 표시',
        controller: 'Arduino'
      }
    }),
    drafts: []
  });

  const message = result.assistantMessages.join('\n');
  assert.match(message, /검증 자료/);
  assert.doesNotMatch(message, /필수 지원 번들|지원 번들 증거|컨텍스트|렌더|빌드 가능한/);
});

test('a casual or meta first turn returns a conversational reply with no scene', async () => {
  // PLAN_react_routing_and_clean_chat Phase 3: a casual/meta turn is no longer handled by a
  // deterministic preflight — the agent OWNS the decision and answers conversationally
  // (responseKind:'chat', no circuitSpec), which finalizes to a chat result with no rendered scene.
  const result = await runAgentWithScriptedDrafts({
    request: {
      message: '좋아 작업을 시작해보자',
      locale: 'ko',
      mode: 'live'
    },
    requirementAnalysis: requirementAnalysisFixture('casual_chat', {
      summary: '학생이 구체적인 회로 목표 없이 작업 시작 의사를 표현했다.',
      assistantMessage: '좋아요. 시작해 볼게요.',
      clarification: '만들고 싶은 회로의 입력, 출력, 동작을 한 문장으로 알려 주세요.'
    }),
    drafts: [{
      responseKind: 'chat',
      assistantMessage: '좋아요. 먼저 만들고 싶은 회로의 입력, 출력, 동작을 한 문장으로 알려 주세요.',
      circuitSpec: null
    }]
  });

  assert.equal(result.responseKind, 'chat');
  assert.equal(result.validationReport.status, 'unsupported');
  assert.match(result.assistantMessages[0], /시작|회로|입력|출력|동작/);
  assert.equal(result.renderPlan.parts.length, 0);
  assert.equal(result.simulationPlan.currentPaths.length, 0);
});

test('Deepagents scripted path carries source bundle evidence in the context trace', async () => {
  const result = await runAgentWithScriptedDrafts({
    request: {
      message: 'LED를 깜빡이는 회로',
      locale: 'ko',
      mode: 'live'
    },
    drafts: [agentDraft('검증 가능한 LED 회로 초안입니다.', ledCircuit())]
  });

  assert.ok(result.contextTrace.some((entry) => entry.sourceId === 'sources:support-bundle:digital-light-output'));
  assert.ok(result.contextCoverage.sufficientFor.includes('valid_circuit_synthesis'));
  assert.equal(result.validationReport.status, 'valid');
});

test('route-outside candidate parts in an agent draft are blocked before repair or render', async () => {
  const base = ledCircuit();
  const rogueSpec = {
    ...base,
    components: [
      ...base.components,
      { id: 'oled-display', partId: 'oled-i2c-096', label: 'Unrequested OLED display', designator: 'DISP1' }
    ]
  };

  const result = await runAgentWithScriptedDrafts({
    request: {
      message: 'Blink one LED with the proper resistor on an Arduino breadboard.',
      locale: 'en'
    },
    drafts: [
      agentDraft('I added an OLED display even though the student asked for an LED.', rogueSpec)
    ]
  });

  assert.equal(result.validationReport.status, 'invalid');
  assert.match(result.validationReport.errors.join('\n'), /CONTEXT_CANDIDATE_PART_NOT_ALLOWED/);
  assert.equal(result.renderPlan.parts.length > 0, true);
  assert.ok(result.renderPlan.warnings.some((warning) => warning.code === 'DIAGNOSTIC_RENDER_ONLY'));
  assert.equal(result.simulationPlan.currentPaths.length, 0);
  assert.equal(result.buildRunnableReport.runnable, false);
  assert.equal(result.solverGateResult?.visibleSimulation, true);
  assert.equal(result.solverGateResult?.buildReady, false);
  assert.equal(result.agentEvents.some((event) => event.name === 'validation-repair'), false);
});

test('agent repair loop rejects runnable LED-only drafts that drop the requested sensor input', async () => {
  const result = await runAgentWithScriptedDrafts({
    request: {
      message: 'Use a light sensor to turn on an LED when the room is dark.',
      locale: 'en'
    },
    drafts: [
      agentDraft('Here is a simple LED circuit.', ledCircuit()),
      agentDraft('I repaired the draft by keeping the requested light sensor input.', ldrDarkLedCircuit())
    ]
  });

  assert.equal(result.validationReport.status, 'valid');
  assert.equal(result.buildRunnableReport.runnable, true);
  assert.ok(result.circuitSpec.components.some((component) => component.partId === 'photoresistor-ldr'));
  assert.ok(result.agentEvents.some((event) =>
    event.name === 'validation-repair' &&
    event.summary?.includes('INTENT_INPUT_NOT_FULFILLED')
  ));
});

test('invalid final validation replaces overconfident assistant draft copy', async () => {
  const base = ledCircuit();
  const rogueSpec = {
    ...base,
    components: [
      ...base.components,
      { id: 'oled-display', partId: 'oled-i2c-096', label: 'Unrequested OLED display', designator: 'DISP1' }
    ]
  };

  const result = await runAgentWithScriptedDrafts({
    request: {
      message: 'Blink one LED with the proper resistor on an Arduino breadboard.',
      locale: 'en'
    },
    drafts: [
      agentDraft('This circuit is valid and ready to build. I also added an OLED display.', rogueSpec)
    ]
  });

  const message = result.assistantMessages.join('\n');
  assert.equal(result.validationReport.status, 'invalid');
  assert.match(message, /could not safely finalize|validation/i);
  assert.doesNotMatch(message, /valid and ready to build/i);
  assert.doesNotMatch(message, /I also added an OLED display/i);
});

test('Korean controller substitution context gaps return student-friendly Korean copy', async () => {
  const result = await runAgentWithScriptedDrafts({
    request: {
      message: 'Arduino Nano로 LED를 깜빡이고 싶어.',
      locale: 'ko'
    },
    requirementAnalysis: requirementAnalysisFixture('unsupported_or_gap', {
      summary: 'Arduino Nano is supported as controller-board context, but LED circuit substitution is not validated yet.',
      assistantMessage: 'Arduino Nano 보드의 핀맵과 전압 도메인은 보여줄 수 있지만, 아직 Nano로 LED 깜빡임 회로 배선을 검증해서 시뮬레이션할 근거는 준비되지 않았습니다.',
      clarification: '현재 지원되는 Arduino Uno 기반 LED 회로로 진행하거나, Arduino Nano LED 회로 치환 자료를 먼저 추가해야 합니다.',
      blockingReason: 'Arduino Nano controller-board substitution is not validated for the LED circuit bundle yet.',
      circuitGoal: {
        output: 'LED',
        behavior: 'blink',
        controller: 'Arduino Nano'
      }
    }),
    drafts: []
  });
  const message = result.assistantMessages.join('\n');

  assert.equal(result.validationReport.status, 'unsupported');
  assert.equal(result.renderPlan.parts.length > 0, true);
  assert.ok(result.renderPlan.warnings.some((warning) => warning.code === 'DIAGNOSTIC_RENDER_ONLY'));
  assert.equal(result.simulationPlan.currentPaths.length, 0);
  assert.equal(result.solverGateResult?.visibleSimulation, true);
  assert.equal(result.solverGateResult?.buildReady, false);
  assert.ok(result.circuitSpec.unsupportedItems.some((item) => /arduino nano|substitution|not validated/i.test(item)));
  assert.match(message, /지원|준비|아직|부품|회로/);
  assert.match(message, /Arduino Nano/);
  assert.doesNotMatch(message, /This request|canonical context|validated synthesis|Missing support evidence/i);
  assert.doesNotMatch(message, /\?\?\?|廓|吏|諛|媛|덉쟾|뚮줈/);
});

test('Korean unsafe preflight returns readable safety copy without mojibake', async () => {
  const result = await runAgentWithScriptedDrafts({
    request: {
      message: '브레드보드로 220V 콘센트 히터를 제어하고 싶어.',
      locale: 'ko'
    },
    requirementAnalysis: requirementAnalysisFixture('unsupported_or_gap', {
      summary: '브레드보드에서 220V 콘센트 히터를 제어하려는 안전 위험 요청이다.',
      assistantMessage: '이 요청은 안전 위험이 있는 고전압 회로라서 브레드보드 배선이나 시뮬레이션으로 만들 수 없습니다. 안전한 저전압 Arduino 회로로 바꾸면 진행할 수 있습니다.',
      clarification: '안전한 저전압 Arduino 회로로 바꾸려면 원하는 입력과 출력 동작을 다시 알려 주세요.',
      blockingReason: '220V heater control is unsafe for breadboard simulation.',
      circuitGoal: {
        input: '220V 콘센트',
        output: '히터',
        behavior: '고전압 부하 제어',
        controller: '브레드보드'
      }
    }),
    drafts: []
  });
  const message = result.assistantMessages.join('\n');

  assert.equal(result.validationReport.status, 'valid');
  assert.equal(result.simulationPlan.status, 'valid');
  assert.equal(result.solverGateResult?.mode, 'safe_equivalent_simulation');
  assert.equal(result.solverGateResult?.repairLevel, 'safe_equivalent');
  assert.ok(result.renderPlan.parts.some((part) => part.id === 'led-1'));
  assert.ok(result.simulationPlan.currentPaths.length > 0);
  assert.equal(result.supportedAlternatives[0]?.id, 'safe-low-voltage-led');
  assert.equal(result.circuitSpec.unsupportedItems.length, 0);
  assert.ok(result.circuitSpec.assumptions.some((item) => /220V|heater|high-voltage|thermal|unsafe/i.test(item)));
  assert.match(message, /안전|위험|저전압|대체|시뮬레이션/);
  assert.doesNotMatch(message, /\?\?\?|廓|吏|諛|媛|덉쟾|뚮줈/);
  assert.doesNotMatch(message, /This request|unsupported for a student breadboard simulation/i);
});

test('agent user prompt carries recent turns and current artifact grounding', () => {
  const prompt = buildAgentUserPrompt({
    message: '전선 연결이 안되도 상관없니?',
    locale: 'ko',
    conversationContext: {
      recentTurns: [
        { role: 'student', text: 'LED 깜빡이기' },
        { role: 'assistant', text: 'D9에서 저항을 거쳐 LED로 연결하는 초안입니다.' }
      ],
      currentArtifact: {
        source: 'draft',
        title: 'LED blinker',
        circuitSpec: ledCircuit(),
        validationReport: {
          version: '2026-05-31',
          status: 'valid',
          errors: [],
          warnings: [],
          validatedCurrentPathIds: ['led-forward-current'],
          sourceVersion: '2026-05-31'
        },
        simulationPlan: {
          status: 'valid',
          runText: 'LED BLINK',
          currentPaths: [],
          expectedStates: [{ componentId: 'led-1', state: 'blinking' }],
          warnings: []
        },
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
      lastSupportedGoal: 'blink an LED with Arduino',
      awaitingBuildConfirmation: true
    }
  });

  assert.match(prompt, /Student message: 전선 연결이 안되도 상관없니/);
  assert.match(prompt, /Recent conversation/i);
  assert.match(prompt, /LED blinker/);
  assert.match(prompt, /blink an LED with Arduino/);
  assert.match(prompt, /validationStatus=valid/);
  assert.match(prompt, /buildRunnableStatus=runnable; runnable=yes/);
});

test('missing structured Deepagents output raises a typed recoverable error', () => {
  assert.throws(
    () => parseLiveAgentDraft({ messages: [] }),
    AgentStructuredOutputError
  );
});

test('Deepagents tool-call-only output recovers a draft from the latest circuit spec', () => {
  const spec = buttonLedCircuit();
  const draft = parseLiveAgentDraft({
    messages: [
      {
        kwargs: {
          content: '',
          tool_calls: [{
            name: 'validate_circuit_spec',
            args: { spec }
          }]
        }
      },
      {
        kwargs: {
          content: [{
            type: 'text',
            text: '버튼을 누르면 LED가 켜지는 회로로 구성했습니다.'
          }],
          tool_calls: []
        }
      }
    ]
  });

  assert.equal(draft.circuitSpec?.id, spec.id);
  assert.match(draft.assistantMessage, /버튼을 누르면 LED/);
  assert.ok(draft.agentEvents.some((event) => event.name === 'validate_circuit_spec'));
});

test('validation rejects an LED circuit without current limiting', async () => {
  const withoutResistor = {
    ...ledCircuit(),
    components: ledCircuit().components.filter((component) => component.partId !== 'resistor-220'),
    connections: ledCircuit().connections.filter((connection) => !(
      connection.from.componentId === 'resistor-1' ||
      connection.to.componentId === 'resistor-1'
    ))
  };

  const report = await validateCircuitSpec(withoutResistor);

  assert.equal(report.status, 'invalid');
  assert.match(report.errors.join('\n'), /current limiting/i);
});

test('validation rejects LED circuits where the resistor exists but the positive series path is open', async () => {
  const spec = ledCircuit();
  const openPositivePath = CircuitSpecSchema.parse({
    ...spec,
    connections: [
      connection('led-to-ground', 'led-1', 'K', 'arduino-uno', 'GND', 'ground')
    ]
  });

  const report = await validateCircuitSpec(openPositivePath);
  const netlist = await buildNetlist(openPositivePath);
  const currentPaths = await estimateCurrentPaths(openPositivePath, netlist, report);

  assert.equal(report.status, 'invalid');
  assert.match(report.errors.join('\n'), /LED_CONTROLLER_SOURCE_MISSING|LED_SERIES_PATH_INCOMPLETE|LED_RESISTOR_NOT_IN_SERIES/);
  assert.equal(currentPaths.length, 0);
});

test('validation rejects LED circuits where the resistor is present but bypassed', async () => {
  const spec = ledCircuit();
  const bypassedResistor = CircuitSpecSchema.parse({
    ...spec,
    connections: [
      connection('d9-to-led', 'arduino-uno', 'D9', 'led-1', 'A', 'gpio'),
      connection('led-to-ground', 'led-1', 'K', 'arduino-uno', 'GND', 'ground')
    ]
  });

  const report = await validateCircuitSpec(bypassedResistor);
  const netlist = await buildNetlist(bypassedResistor);
  const currentPaths = await estimateCurrentPaths(bypassedResistor, netlist, report);

  assert.equal(report.status, 'invalid');
  assert.match(report.errors.join('\n'), /LED_RESISTOR_NOT_IN_SERIES/);
  assert.equal(currentPaths.length, 0);
});

test('validation accepts common ground through the breadboard ground rail', async () => {
  const spec = oledCircuitThroughBreadboardRail();
  const report = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);

  assert.equal(report.status, 'valid');
  assert.ok(netlist.nets.some((net) => net.kind === 'ground'));
});

test('netlist, current estimate, fault detection, render plan, simulation plan, and requirement markdown compose', async () => {
  const spec = ledCircuit();
  const validationReport = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
  const faults = await detectFaults(spec, netlist);
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
  const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);
  const markdown = await compileRequirementMarkdown(spec, validationReport, simulationPlan, runnableReport);

  assert.equal(validationReport.status, 'valid');
  assert.equal(faults.status, 'valid');
  assert.ok(netlist.nets.some((net) => net.kind === 'power'));
  assert.ok(currentPaths.some((path) => path.expectedCurrentMa > 0));
  assert.ok(renderPlan.connections.length >= spec.connections.length);
  assert.equal(simulationPlan.status, 'valid');
  assert.match(markdown, /Current Flow/i);
});

test('render plan exposes endpoint coordinates compiled from render footprint anchors', async () => {
  const spec = oledCircuit();
  const validationReport = await validateCircuitSpec(spec);
  const renderPlan = await compileRenderPlan(spec, validationReport);

  assert.ok(renderPlan.layout?.endpoints['arduino-uno:A4/SDA'], 'Arduino SDA endpoint is available');
  assert.ok(renderPlan.layout?.endpoints['oled-display:SDA'], 'OLED SDA endpoint is available');
  assert.notDeepEqual(
    renderPlan.layout?.endpoints['arduino-uno:A4/SDA'],
    renderPlan.layout?.endpoints['oled-display:SDA'],
    'component placement offsets should make matching signal pin anchors distinct'
  );

  const arduino = renderPlan.parts.find((part) => part.id === 'arduino-uno');
  const sda = renderPlan.layout?.endpoints['arduino-uno:A4/SDA'];
  assert.equal(sda?.x, (arduino?.position.x ?? 0) + 0.52);
  assert.equal(sda?.z, (arduino?.position.z ?? 0) + 0.54);

  const sdaConnection = renderPlan.connections.find((connection) => connection.id === 'oled-sda');
  const sdaRoute = sdaConnection?.route ?? [];
  assert.ok(sdaRoute.length >= 3, 'render plan should expose server-routed wire points');
  assert.equal(sdaRoute[0]?.x, sda?.x);
  assert.equal(sdaRoute[0]?.y, (sda?.y ?? 0) + 0.24);
  const sdaRouteLast = sdaRoute[sdaRoute.length - 1];
  assert.equal(
    sdaRouteLast?.z,
    renderPlan.layout?.endpoints['oled-display:SDA']?.z
  );
});

test('render plan exposes scene bounds and camera fit metadata for Stage framing', async () => {
  const spec = mosfetMotorCircuit();
  const validationReport = await validateCircuitSpec(spec);
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const bounds = renderPlan.layout?.bounds;
  const camera = renderPlan.layout?.camera;

  assert.ok(bounds, 'render plan should expose server-computed scene bounds');
  assert.ok(camera, 'render plan should expose server-computed camera fit metadata');
  assert.equal(camera.target.x, bounds.center.x);
  assert.equal(camera.target.z, bounds.center.z);
  assert.equal(camera.fov, 38);
  assert.ok(camera.position.y > camera.target.y, 'camera should view the scene from above');
  assert.ok(camera.maxDistance > camera.minDistance, 'zoom clamp should preserve an interactive distance range');

  for (const part of renderPlan.parts.filter((candidate) => candidate.footprint)) {
    const footprint = part.footprint!;
    assert.ok(part.position.x - footprint.width / 2 >= bounds.min.x - 0.000001, `${part.id} should fit inside min x`);
    assert.ok(part.position.x + footprint.width / 2 <= bounds.max.x + 0.000001, `${part.id} should fit inside max x`);
    assert.ok(part.position.z - footprint.depth / 2 >= bounds.min.z - 0.000001, `${part.id} should fit inside min z`);
    assert.ok(part.position.z + footprint.depth / 2 <= bounds.max.z + 0.000001, `${part.id} should fit inside max z`);
  }
});

test('render plan exposes label layout metadata and auto-places labels before warning', async () => {
  const spec = CircuitSpecSchema.parse({
    id: 'label-overlap-render',
    title: 'Label overlap render QA',
    intent: { primaryGoal: 'verify label layout QA', output: 'labels', controller: 'arduino-uno' },
    components: [
      { id: 'left-led', partId: 'perfboard-5x7', label: 'Left indicator label', position: { x: 0, y: 0.25, z: 0 } },
      { id: 'right-led', partId: 'pcb-blank-single', label: 'Right indicator label', position: { x: 0.75, y: 0.25, z: 0 } }
    ],
    connections: [],
    behavior: { runText: 'LABEL QA' },
    assumptions: [],
    unsupportedItems: [],
    clarificationNeeds: []
  });

  const validationReport = validRenderOnlyReport();
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const simulationPlan = await compileSimulationPlan(spec, validationReport, [], renderPlan);
  const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);

  assert.equal(renderPlan.layout?.labels?.['left-led']?.text, 'Left indicator');
  assert.ok(renderPlan.layout?.labels?.['left-led']?.width);
  assert.ok((renderPlan.layout?.bounds?.max.y ?? 0) > 0.5);
  assert.notDeepEqual(
    renderPlan.layout?.labels?.['left-led']?.position,
    renderPlan.layout?.labels?.['right-led']?.position,
    'server label solver should move labels to distinct positions when possible'
  );
  assert.equal(renderPlan.warnings.some((warning) => warning.code === 'LABEL_OVERLAP'), false);
  assert.equal(
    simulationPlan.warnings.some((warning) => /SIMULATION_BLOCKED_BY_RENDER_DRC|LABEL_OVERLAP/.test(warning)),
    false,
    'auto-repaired label layout should not block current simulation'
  );
  assert.equal(runnableReport.renderBlockingWarningCount, 0);
});

test('label overlap warnings remain visual QA and do not block current simulation', async () => {
  const spec = wp09ContextCircuit('perfboard-5x7', 'Perfboard label QA context');
  const validationReport = await validateCircuitSpec(spec);
  const renderPlan = await compileRenderPlan(spec, validationReport);
  renderPlan.warnings.push({
    code: 'LABEL_OVERLAP',
    componentId: 'wp09-context-1',
    message: 'Label overlap is visual QA only.'
  });
  const simulationPlan = await compileSimulationPlan(spec, validationReport, [], renderPlan);
  const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);

  assert.equal(simulationPlan.status, 'valid');
  assert.equal(
    simulationPlan.warnings.some((warning) => /SIMULATION_BLOCKED_BY_RENDER_DRC|LABEL_OVERLAP/.test(warning)),
    false
  );
  assert.equal(runnableReport.renderBlockingWarningCount, 0);
});

test('render solver repairs bad explicit position hints before build-ready gate', async () => {
  const baseSpec = ledCircuit();
  const spec = CircuitSpecSchema.parse({
    ...baseSpec,
    id: 'explicit-position-repair',
    title: 'Explicit position repair',
    components: baseSpec.components.map((component) =>
      component.id === 'resistor-1' || component.id === 'led-1'
        ? { ...component, position: { x: 0, y: 0.18, z: 0 } }
        : component
    )
  });

  const validationReport = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
  const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);
  const solverGate = buildSolverGateResult(validationReport, renderPlan, simulationPlan, runnableReport);
  const placementAttempt = renderPlan.layout?.solverAttempts?.find((attempt) => attempt.stage === 'placement');

  assert.equal(validationReport.status, 'valid');
  assert.equal(renderPlan.warnings.some((warning) => warning.code === 'PART_COLLISION'), false);
  assert.equal(placementAttempt?.result, 'repaired');
  assert.match(placementAttempt?.warnings.join('\n') ?? '', /PART_COLLISION/);
  assert.equal(runnableReport.runnable, true);
  assert.equal(solverGate.buildReady, true);
  assert.equal(solverGate.mode, 'auto_repaired_simulation');
  assert.equal(solverGate.repairLevel, 'layout');
  assert.ok(solverGate.verifiedClaims.some((claim) => /render solver repaired placement/i.test(claim)));
});

test('render plan parts carry footprint metadata from the context layer', async () => {
  const spec = ledCircuit();
  const validationReport = await validateCircuitSpec(spec);
  const renderPlan = await compileRenderPlan(spec, validationReport);

  const led = renderPlan.parts.find((part) => part.id === 'led-1');
  const resistor = renderPlan.parts.find((part) => part.id === 'resistor-1');

  assert.equal(led?.footprint?.type, 'led');
  assert.equal(led?.footprint?.width, 0.3);
  assert.equal(led?.footprint?.pinAnchors.A.role, 'anode');
  assert.equal(resistor?.footprint?.type, 'resistor');
  assert.equal(resistor?.footprint?.pinAnchors['1'].role, 'passive-terminal');
});

test('render plan keeps the Arduino controller beside the breadboard outline', async () => {
  const spec = ledCircuit();
  const validationReport = await validateCircuitSpec(spec);
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const breadboard = renderPlan.parts.find((part) => part.footprint?.type === 'breadboard');
  const arduino = renderPlan.parts.find((part) => part.footprint?.type === 'arduino');

  assert.ok(breadboard, 'breadboard footprint should render');
  assert.ok(arduino, 'Arduino footprint should render');
  assert.equal(
    footprintsOverlap(arduino, breadboard),
    false,
    'Arduino should be positioned beside the breadboard instead of overlapping the board surface'
  );
  assert.equal(arduino.position.x < breadboard.position.x, true);
});

test('render plan keeps stage-only hardware beside the breadboard outline', async () => {
  for (const spec of [mosfetMotorCircuit(), wp09ContextCircuit('perfboard-5x7', 'Perfboard context')]) {
    const validationReport = await validateCircuitSpec(spec);
    const renderPlan = await compileRenderPlan(spec, validationReport);
    const breadboard = renderPlan.parts.find((part) => part.footprint?.type === 'breadboard');
    const stageParts = renderPlan.parts.filter((part) =>
      part.footprint &&
      !part.footprint.placement.breadboardCompatible &&
      part.footprint.placement.allowedSurfaces.includes('stage') &&
      !part.footprint.placement.allowedSurfaces.includes('breadboard') &&
      part.footprint.type !== 'arduino' &&
      part.footprint.type !== 'breadboard'
    );

    assert.ok(breadboard, `${spec.title} should render a breadboard`);
    for (const part of stageParts) {
      assert.equal(
        footprintsOverlap(part, breadboard),
        false,
        `${part.label} should be positioned beside the breadboard instead of overlapping the board surface`
      );
      assert.equal(part.position.x > breadboard.position.x, true);
    }
  }
});

test('render plan reports missing footprint warnings instead of silently visualizing unsupported geometry', async () => {
  const spec = CircuitSpecSchema.parse({
    id: 'visual-gap',
    title: 'Validated part without footprint',
    intent: { primaryGoal: 'render a validated part whose footprint is not in the catalog', output: 'module', controller: 'arduino-uno' },
    components: [
      { id: 'mystery-module', partId: 'mystery-module', label: 'Mystery module', designator: 'X1' }
    ],
    connections: [],
    behavior: { runText: 'VISUAL GAP' },
    assumptions: [],
    unsupportedItems: [],
    clarificationNeeds: []
  });

  const validationReport = validRenderOnlyReport();
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const simulationPlan = await compileSimulationPlan(spec, validationReport, [], renderPlan);
  const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);
  const warnings = (renderPlan as {
    warnings?: Array<{ code: string; componentId?: string }>;
  }).warnings ?? [];

  assert.equal(renderPlan.parts[0].id, 'mystery-module');
  assert.equal(renderPlan.parts[0].footprint, undefined);
  assert.ok(warnings.some((warning) =>
    warning.code === 'MISSING_RENDER_FOOTPRINT' &&
    warning.componentId === 'mystery-module'
  ));
  assert.equal(simulationPlan.status, 'invalid');
  assert.ok(simulationPlan.warnings.some((warning) =>
    /SIMULATION_BLOCKED_BY_RENDER_DRC|MISSING_RENDER_FOOTPRINT/.test(warning)
  ));
  assert.equal(runnableReport.runnable, false);
  assert.equal(runnableReport.renderBlockingWarningCount > 0, true);
});

test('physical render DRC warnings block current simulation and build-ready claims', async () => {
  for (const warningCode of [
    'BREADBOARD_PLACEMENT_OUT_OF_BOUNDS',
    'BREADBOARD_PLACEMENT_SURFACE_MISSING',
    'BREADBOARD_PIN_GRID_MISALIGNMENT',
    'BREADBOARD_PIN_ROW_COLLAPSE',
    'RENDER_CONNECTION_TOO_SHORT',
    'PART_COLLISION',
    'CAMERA_CLIPPING'
  ]) {
    const spec = ledCircuit();
    const validationReport = await validateCircuitSpec(spec);
    const netlist = await buildNetlist(spec);
    const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
    const renderPlan = {
      title: `Physical DRC fixture ${warningCode}`,
      runText: 'PHYSICAL DRC',
      parts: [{
        id: 'led-1',
        type: 'led',
        label: 'LED',
        description: 'Render DRC fixture part',
        pins: [],
        position: { x: 0, y: 0.25, z: 0 }
      }],
      connections: [],
      floatingCards: [],
      warnings: [{
        code: warningCode,
        componentId: 'led-1',
        message: `${warningCode} makes physical placement or wiring untrustworthy.`
      }]
    };
    const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
    const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);
    const solverGate = buildSolverGateResult(validationReport, renderPlan, simulationPlan, runnableReport);

    assert.ok(currentPaths.length > 0, warningCode);
    assert.equal(simulationPlan.status, 'invalid', warningCode);
    assert.equal(simulationPlan.currentPaths.length, 0, warningCode);
    assert.ok(
      simulationPlan.warnings.some((warning) =>
        warning.includes('SIMULATION_BLOCKED_BY_RENDER_DRC') && warning.includes(warningCode)
      ),
      simulationPlan.warnings.join('\n')
    );
    assert.equal(runnableReport.runnable, false, warningCode);
    assert.equal(runnableReport.renderBlockingWarningCount >= 1, true, warningCode);
    assert.equal(solverGate.visibleSimulation, true, warningCode);
    assert.equal(solverGate.buildReady, false, warningCode);
    assert.equal(solverGate.simulationActivity, 'diagnostic', warningCode);
    assert.equal(
      solverGate.verifiedClaims.some((claim) => /current|signal|expected state/i.test(claim)),
      false,
      warningCode
    );
  }
});

test('render plan repairs breadboard-compatible parts placed outside the breadboard outline', async () => {
  const spec = CircuitSpecSchema.parse({
    ...ledCircuit(),
    id: 'led-outside-breadboard-render',
    components: ledCircuit().components.map((component) => component.id === 'led-1'
      ? { ...component, position: { x: 8, y: 0.25, z: 0 } }
      : component)
  });

  const validationReport = await validateCircuitSpec(spec);
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const placementAttempt = renderPlan.layout?.solverAttempts?.find((attempt) => attempt.stage === 'placement');

  assert.equal(validationReport.status, 'valid');
  assert.equal(renderPlan.warnings.some((warning) => warning.code === 'BREADBOARD_PLACEMENT_OUT_OF_BOUNDS'), false);
  assert.equal(placementAttempt?.result, 'repaired');
  assert.match(placementAttempt?.warnings.join('\n') ?? '', /BREADBOARD_PLACEMENT_OUT_OF_BOUNDS/);
});

test('render plan repairs explicit component position collisions before simulation', async () => {
  const base = ledCircuit();
  const sharedPosition = { x: 0.5, y: 0.25, z: 0 };
  const spec = CircuitSpecSchema.parse({
    ...base,
    id: 'explicit-part-collision-render',
    components: base.components.map((component) => {
      if (component.id === 'led-1' || component.id === 'resistor-1') {
        return { ...component, position: sharedPosition };
      }
      return component;
    })
  });

  const validationReport = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
  const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);
  const solverGate = buildSolverGateResult(validationReport, renderPlan, simulationPlan, runnableReport);
  const placementAttempt = renderPlan.layout?.solverAttempts?.find((attempt) => attempt.stage === 'placement');

  assert.equal(validationReport.status, 'valid');
  assert.equal(renderPlan.warnings.some((warning) => warning.code === 'PART_COLLISION'), false);
  assert.equal(placementAttempt?.result, 'repaired');
  assert.match(placementAttempt?.warnings.join('\n') ?? '', /PART_COLLISION/);
  assert.equal(simulationPlan.status, 'valid');
  assert.equal(runnableReport.runnable, true);
  assert.equal(runnableReport.renderBlockingWarningCount, 0);
  assert.equal(solverGate.mode, 'auto_repaired_simulation');
});

test('render plan repairs distant explicit positions before fitting the camera frame', async () => {
  const base = ledCircuit();
  const spec = CircuitSpecSchema.parse({
    ...base,
    id: 'camera-clipping-render',
    components: base.components.map((component) => component.id === 'led-1'
      ? { ...component, position: { x: 90, y: 0.25, z: 0 } }
      : component)
  });

  const validationReport = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
  const solverGate = buildSolverGateResult(
    validationReport,
    renderPlan,
    simulationPlan,
    buildRunnableReport(validationReport, renderPlan, simulationPlan)
  );
  const placementAttempt = renderPlan.layout?.solverAttempts?.find((attempt) => attempt.stage === 'placement');
  const cameraAttempt = renderPlan.layout?.solverAttempts?.find((attempt) => attempt.stage === 'camera');

  assert.equal(validationReport.status, 'valid');
  assert.ok(renderPlan.layout?.camera, 'camera fit should be emitted after auto placement repair');
  assert.equal(renderPlan.warnings.some((warning) => warning.code === 'CAMERA_CLIPPING'), false);
  assert.equal(placementAttempt?.result, 'repaired');
  assert.match(placementAttempt?.warnings.join('\n') ?? '', /BREADBOARD_PLACEMENT_OUT_OF_BOUNDS/);
  assert.equal(cameraAttempt?.result, 'passed');
  assert.equal(simulationPlan.status, 'valid');
  assert.equal(solverGate.visibleSimulation, true);
  assert.equal(solverGate.buildReady, true);
  assert.equal(solverGate.mode, 'auto_repaired_simulation');
});

test('render plan warns when a breadboard-compatible part has no breadboard surface', async () => {
  const base = ledCircuit();
  const spec = CircuitSpecSchema.parse({
    ...base,
    id: 'led-without-breadboard-surface',
    components: base.components.filter((component) => component.partId !== 'breadboard-half')
  });

  const validationReport = await validateCircuitSpec(spec);
  const renderPlan = await compileRenderPlan(spec, validationReport);

  assert.equal(validationReport.status, 'valid');
  assert.ok(renderPlan.warnings.some((warning) =>
    warning.code === 'BREADBOARD_PLACEMENT_SURFACE_MISSING' &&
    warning.componentId === 'led-1' &&
    /needs a breadboard placement surface/i.test(warning.message)
  ));
});

test('render plan auto-places many breadboard-compatible parts inside the breadboard without overlap', async () => {
  const spec = CircuitSpecSchema.parse({
    id: 'many-breadboard-parts-render',
    title: 'Many breadboard parts render placement',
    intent: { primaryGoal: 'place several LEDs and resistors on one breadboard', output: 'many parts', controller: 'arduino-uno' },
    components: baseComponents([
      { id: 'resistor-1', partId: 'resistor-220', label: '220 ohm resistor 1', designator: 'R1' },
      { id: 'led-1', partId: 'led-5mm', label: 'LED 1', designator: 'D1' },
      { id: 'resistor-2', partId: 'resistor-220', label: '220 ohm resistor 2', designator: 'R2' },
      { id: 'led-2', partId: 'led-5mm', label: 'LED 2', designator: 'D2' },
      { id: 'resistor-3', partId: 'resistor-220', label: '220 ohm resistor 3', designator: 'R3' },
      { id: 'led-3', partId: 'led-5mm', label: 'LED 3', designator: 'D3' },
      { id: 'button-1', partId: 'button-tactile', label: 'Button 1', designator: 'SW1' },
      { id: 'buzzer-1', partId: 'piezo-buzzer', label: 'Buzzer 1', designator: 'BZ1' }
    ]),
    connections: [],
    behavior: { runText: 'PLACEMENT CHECK' },
    assumptions: ['This render-only fixture verifies default placement, not electrical behavior.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });

  const renderPlan = await compileRenderPlan(spec, {
    version: '2026-05-31',
    status: 'valid',
    errors: [],
    warnings: [],
    validatedCurrentPathIds: [],
    sourceVersion: '2026-05-31'
  });
  const placed = renderPlan.parts.filter((part) =>
    part.footprint?.placement.breadboardCompatible &&
    part.footprint.type !== 'wire'
  );

  assert.equal(
    renderPlan.warnings.some((warning) => warning.code === 'BREADBOARD_PLACEMENT_OUT_OF_BOUNDS'),
    false,
    renderPlan.warnings.map((warning) => warning.message).join('\n')
  );
  assert.equal(hasOverlappingFootprints(placed), false);
});

test('render plan warns when a connection endpoint has no render anchor', async () => {
  const spec = CircuitSpecSchema.parse({
    ...ledCircuit(),
    id: 'missing-render-endpoint-wire',
    connections: [
      connection('bad-render-pin', 'arduino-uno', 'D99', 'led-1', 'A', 'gpio')
    ]
  });

  const validationReport = validRenderOnlyReport();
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const simulationPlan = await compileSimulationPlan(spec, validationReport, [], renderPlan);
  const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);

  assert.ok(renderPlan.warnings.some((warning) =>
    warning.code === 'RENDER_CONNECTION_ENDPOINT_MISSING' &&
    warning.componentId === 'arduino-uno' &&
    /bad-render-pin|arduino-uno:D99/i.test(warning.message)
  ));
  assert.equal(simulationPlan.status, 'invalid');
  assert.ok(simulationPlan.warnings.some((warning) =>
    /SIMULATION_BLOCKED_BY_RENDER_DRC|RENDER_CONNECTION_ENDPOINT_MISSING/.test(warning)
  ));
  assert.equal(runnableReport.runnable, false);
  assert.equal(runnableReport.renderBlockingWarningCount > 0, true);
});

test('render plan warns when a connection would render as a zero-length wire', async () => {
  const spec = CircuitSpecSchema.parse({
    ...ledCircuit(),
    id: 'zero-length-render-wire',
    connections: [
      connection('same-endpoint-wire', 'led-1', 'A', 'led-1', 'A', 'gpio')
    ]
  });

  const renderPlan = await compileRenderPlan(spec, validRenderOnlyReport());

  assert.ok(renderPlan.warnings.some((warning) =>
    warning.code === 'RENDER_CONNECTION_TOO_SHORT' &&
    warning.componentId === 'led-1' &&
    /same-endpoint-wire|too short|same render point/i.test(warning.message)
  ));
});

test('render plan keeps breadboard component terminals on distinct rows', async () => {
  const spec = ledCircuit();
  const validationReport = await validateCircuitSpec(spec);
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const endpoints = renderPlan.layout?.endpoints ?? {};

  assert.equal(validationReport.status, 'valid');
  assert.ok(
    Math.abs(endpoints['led-1:A'].z - endpoints['led-1:K'].z) >= 0.12,
    'LED anode and cathode should not collapse onto the same breadboard row'
  );
  assert.ok(
    Math.abs(endpoints['resistor-1:1'].z - endpoints['resistor-1:2'].z) >= 0.12,
    'Resistor terminals should not collapse onto the same breadboard row'
  );
  assert.equal(
    renderPlan.warnings.some((warning) => warning.code === 'BREADBOARD_PIN_ROW_COLLAPSE'),
    false,
    renderPlan.warnings.map((warning) => warning.message).join('\n')
  );
});

test('breadboard pin topology DRC warns when a footprint collapses terminals onto one row', () => {
  const warnings = auditBreadboardPinTopology([
    {
      id: 'bad-led',
      type: 'led',
      label: 'Bad LED',
      description: 'Bad test LED',
      designator: 'D_BAD',
      pins: [],
      position: { x: 0, y: 0.3, z: 0 },
      footprint: {
        type: 'led',
        width: 0.3,
        depth: 0.3,
        height: 0.5,
        visualStyle: { shape: 'led', color: '#ff5b59', material: 'test' },
        pinAnchors: {
          A: { x: -0.08, y: 0.05, z: 0.1, role: 'anode', label: 'A' },
          K: { x: 0.08, y: 0.05, z: 0.1, role: 'cathode', label: 'K' }
        },
        labelAnchor: { x: 0, y: 0.58, z: 0 },
        placement: {
          allowedSurfaces: ['breadboard'],
          breadboardCompatible: true,
          defaultOrientation: 'legs-down',
          notes: []
        },
        simulationOverlayAnchors: [{ id: 'bad-led-current', anchor: 'A', role: 'current-overlay' }],
        hoverTargets: []
      }
    }
  ]);

  assert.ok(warnings.some((warning) =>
    warning.code === 'BREADBOARD_PIN_ROW_COLLAPSE' &&
    warning.componentId === 'bad-led' &&
    /same breadboard row|row/i.test(warning.message)
  ));
});

test('render plan snaps breadboard component pins to machine-readable breadboard holes', async () => {
  const spec = ledCircuit();
  const grid = await loadBreadboardGrid();
  const validationReport = await validateCircuitSpec(spec);
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const endpoints = renderPlan.layout?.endpoints ?? {};

  assert.equal(validationReport.status, 'valid');
  for (const endpointKey of ['resistor-1:1', 'resistor-1:2', 'led-1:A', 'led-1:K']) {
    assert.ok(
      endpointSnapsToSignalGrid(endpoints[endpointKey], grid),
      `${endpointKey} should snap to a breadboard signal hole`
    );
  }
  assert.equal(
    renderPlan.warnings.some((warning) => warning.code === 'BREADBOARD_PIN_GRID_MISALIGNMENT'),
    false,
    renderPlan.warnings.map((warning) => warning.message).join('\n')
  );
});

test('render plan snaps radial and ceramic capacitor leads onto breadboard holes', async () => {
  const grid = await loadBreadboardGrid();

  for (const { spec, endpoints: expectedEndpoints, footprintType } of [
    {
      spec: passiveContextCircuit('ceramic-cap', 'Ceramic capacitor context'),
      endpoints: ['passive-1:A', 'passive-1:B'],
      footprintType: 'ceramic-capacitor'
    },
    {
      spec: passiveContextCircuit('electrolytic-cap', 'Electrolytic capacitor context'),
      endpoints: ['passive-1:+', 'passive-1:-'],
      footprintType: 'electrolytic-capacitor'
    }
  ]) {
    const validationReport = await validateCircuitSpec(spec);
    const renderPlan = await compileRenderPlan(spec, validationReport);
    const endpoints = renderPlan.layout?.endpoints ?? {};
    const capacitor = renderPlan.parts.find((part) => part.id === 'passive-1');
    const breadboard = renderPlan.parts.find((part) => part.footprint?.type === 'breadboard');

    assert.equal(validationReport.status, 'valid', spec.title);
    assert.equal(capacitor?.footprint?.type, footprintType);
    assert.ok(capacitor, `${spec.title} capacitor should render`);
    assert.ok(breadboard, `${spec.title} should render a breadboard`);
    assert.equal(
      footprintsOverlap(capacitor, breadboard),
      true,
      `${spec.title} should be mounted on the breadboard surface`
    );
    for (const endpointKey of expectedEndpoints) {
      assert.ok(
        endpointSnapsToSignalGrid(endpoints[endpointKey], grid),
        `${endpointKey} should snap to a breadboard signal hole`
      );
    }
    assert.ok(
      Math.abs(endpoints[expectedEndpoints[0]].z - endpoints[expectedEndpoints[1]].z) >= 0.12,
      `${spec.title} terminals should land on distinct breadboard rows`
    );
    assert.equal(
      renderPlan.warnings.some((warning) =>
        warning.code === 'BREADBOARD_PIN_GRID_MISALIGNMENT' ||
        warning.code === 'BREADBOARD_PIN_ROW_COLLAPSE' ||
        warning.code === 'BREADBOARD_PLACEMENT_OUT_OF_BOUNDS'
      ),
      false,
      renderPlan.warnings.map((warning) => warning.message).join('\n')
    );
  }
});

test('breadboard grid snap DRC warns when a pin sits between holes', async () => {
  const grid = await loadBreadboardGrid();
  const warnings = auditBreadboardGridSnap([
    {
      id: 'floating-led',
      type: 'led',
      label: 'Floating LED',
      description: 'Misaligned test LED',
      designator: 'D_FLOAT',
      pins: [],
      position: { x: 0.09, y: 0.3, z: 0.09 },
      footprint: {
        type: 'led',
        width: 0.3,
        depth: 0.3,
        height: 0.5,
        visualStyle: { shape: 'led', color: '#ff5b59', material: 'test' },
        pinAnchors: {
          A: { x: -0.03, y: 0.05, z: -0.03, role: 'anode', label: 'A' },
          K: { x: 0.03, y: 0.05, z: 0.03, role: 'cathode', label: 'K' }
        },
        labelAnchor: { x: 0, y: 0.58, z: 0 },
        placement: {
          allowedSurfaces: ['breadboard'],
          breadboardCompatible: true,
          defaultOrientation: 'legs-down',
          notes: []
        },
        simulationOverlayAnchors: [{ id: 'floating-led-current', anchor: 'A', role: 'current-overlay' }],
        hoverTargets: []
      }
    }
  ], grid);

  assert.ok(warnings.some((warning) =>
    warning.code === 'BREADBOARD_PIN_GRID_MISALIGNMENT' &&
    warning.componentId === 'floating-led' &&
    /breadboard hole grid/i.test(warning.message)
  ));
});

test('breadboard physical node DRC warns when unconnected pins share one hole', async () => {
  const grid = await loadBreadboardGrid();
  const renderParts = hiddenNodeConflictParts();

  const warnings = auditBreadboardPhysicalNodeConflicts(renderParts, [], grid);

  assert.ok(warnings.some((warning) =>
    warning.code === 'BREADBOARD_PHYSICAL_NODE_CONFLICT' &&
    /led-1:A|button-1:B/i.test(warning.message)
  ));
});

test('breadboard physical node DRC accepts pins sharing a hole when the logical net connects them', async () => {
  const grid = await loadBreadboardGrid();
  const renderParts = hiddenNodeConflictParts();

  const warnings = auditBreadboardPhysicalNodeConflicts(renderParts, [
    {
      id: 'shared-hole-net',
      from: { partId: 'led-1', pin: 'A' },
      to: { partId: 'button-1', pin: 'B' },
      signal: 'gpio',
      color: '#2f7df6',
      education: {
        label: 'GPIO',
        title: 'Shared node',
        what: 'LED A and button B share the same physical breadboard node.',
        why: 'The test net intentionally connects these pins.',
        missing: 'The shared node would be ambiguous without this logical connection.'
      }
    }
  ], grid);

  assert.equal(
    warnings.some((warning) => warning.code === 'BREADBOARD_PHYSICAL_NODE_CONFLICT'),
    false,
    warnings.map((warning) => warning.message).join('\n')
  );
});

test('breadboard continuity DRC warns when unconnected pins share a bank column across different holes', async () => {
  const grid = await loadBreadboardGrid();
  const renderParts = rowContinuityConflictParts();

  const warnings = auditBreadboardContinuityConflicts(renderParts, [], grid);

  assert.ok(warnings.some((warning) =>
    warning.code === 'BREADBOARD_CONTINUITY_CONFLICT' &&
    /led-1:A|button-1:B/i.test(warning.message) &&
    /upper-bank/i.test(warning.message)
  ));
});

test('breadboard continuity DRC accepts same-row pins when the logical net connects them', async () => {
  const grid = await loadBreadboardGrid();
  const renderParts = rowContinuityConflictParts();

  const warnings = auditBreadboardContinuityConflicts(renderParts, [
    {
      id: 'intentional-row-net',
      from: { partId: 'led-1', pin: 'A' },
      to: { partId: 'button-1', pin: 'B' },
      signal: 'gpio',
      color: '#2f7df6',
      education: {
        label: 'GPIO',
        title: 'Intentional row node',
        what: 'LED A and button B intentionally share a breadboard row group.',
        why: 'The logical net declares this shared breadboard continuity.',
        missing: 'The shared row would be ambiguous without this logical connection.'
      }
    }
  ], grid);

  assert.equal(
    warnings.some((warning) => warning.code === 'BREADBOARD_CONTINUITY_CONFLICT'),
    false,
    warnings.map((warning) => warning.message).join('\n')
  );
});

test('breadboard rail DRC warns when unconnected pins share a power rail across different holes', async () => {
  const grid = await loadBreadboardGrid();
  const renderParts = railContinuityConflictParts();

  const warnings = auditBreadboardRailConflicts(renderParts, [], grid);

  assert.ok(warnings.some((warning) =>
    warning.code === 'BREADBOARD_RAIL_CONFLICT' &&
    /led-1:A|button-1:B/i.test(warning.message) &&
    /\+ rail/i.test(warning.message)
  ));
});

test('breadboard rail DRC accepts same-rail pins when the logical net connects them', async () => {
  const grid = await loadBreadboardGrid();
  const renderParts = railContinuityConflictParts();

  const warnings = auditBreadboardRailConflicts(renderParts, [
    {
      id: 'intentional-power-rail-net',
      from: { partId: 'led-1', pin: 'A' },
      to: { partId: 'button-1', pin: 'B' },
      signal: 'power',
      color: '#ff4d3d',
      education: {
        label: '5V POWER',
        title: 'Intentional rail node',
        what: 'LED A and button B intentionally share the same breadboard rail.',
        why: 'The logical net declares this shared rail continuity.',
        missing: 'The shared rail would be ambiguous without this logical connection.'
      }
    }
  ], grid);

  assert.equal(
    warnings.some((warning) => warning.code === 'BREADBOARD_RAIL_CONFLICT'),
    false,
    warnings.map((warning) => warning.message).join('\n')
  );
});

test('render plan repairs explicit positions that would create a hidden breadboard node conflict', async () => {
  const spec = CircuitSpecSchema.parse({
    id: 'hidden-node-conflict-render',
    title: 'Hidden breadboard node conflict',
    intent: { primaryGoal: 'verify physical node DRC', output: 'render warnings', controller: 'arduino-uno' },
    components: baseComponents([
      {
        id: 'led-1',
        partId: 'led-5mm',
        label: 'LED',
        designator: 'D1',
        position: { x: -0.07, y: 0.25, z: -0.3 }
      },
      {
        id: 'button-1',
        partId: 'button-tactile',
        label: 'Button',
        designator: 'SW1',
        position: { x: -0.35, y: 0.25, z: -0.2 }
      }
    ]),
    connections: [],
    behavior: { runText: 'PHYSICAL NODE CHECK' },
    assumptions: ['This render-only fixture checks hidden physical breadboard node conflicts.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });

  const renderPlan = await compileRenderPlan(spec, validRenderOnlyReport());

  assert.equal(renderPlan.warnings.some((warning) => warning.code === 'BREADBOARD_PHYSICAL_NODE_CONFLICT'), false);
  assert.equal(renderPlan.layout?.solverAttempts?.some((attempt) => attempt.stage === 'placement'), true);
});

test('render plan repairs explicit positions that would create a hidden breadboard continuity conflict', async () => {
  const spec = CircuitSpecSchema.parse({
    id: 'hidden-continuity-conflict-render',
    title: 'Hidden breadboard continuity conflict',
    intent: { primaryGoal: 'verify breadboard row continuity DRC', output: 'render warnings', controller: 'arduino-uno' },
    components: baseComponents([
      {
        id: 'led-1',
        partId: 'led-5mm',
        label: 'LED',
        designator: 'D1',
        position: { x: -0.07, y: 0.25, z: -0.3 }
      },
      {
        id: 'button-1',
        partId: 'button-tactile',
        label: 'Button',
        designator: 'SW1',
        position: { x: -0.07, y: 0.25, z: -0.2 }
      }
    ]),
    connections: [],
    behavior: { runText: 'CONTINUITY CHECK' },
    assumptions: ['This render-only fixture checks hidden breadboard row continuity conflicts.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });

  const renderPlan = await compileRenderPlan(spec, validRenderOnlyReport());

  assert.equal(renderPlan.warnings.some((warning) => warning.code === 'BREADBOARD_CONTINUITY_CONFLICT'), false);
  assert.equal(renderPlan.layout?.solverAttempts?.some((attempt) => attempt.stage === 'placement'), true);
});

test('render plan repairs explicit positions that would create a hidden breadboard rail conflict', async () => {
  const spec = CircuitSpecSchema.parse({
    id: 'hidden-rail-conflict-render',
    title: 'Hidden breadboard rail conflict',
    intent: { primaryGoal: 'verify breadboard rail DRC', output: 'render warnings', controller: 'arduino-uno' },
    components: baseComponents([
      {
        id: 'led-1',
        partId: 'led-5mm',
        label: 'LED',
        designator: 'D1',
        position: { x: -2.06, y: 0.25, z: -0.7 }
      },
      {
        id: 'button-1',
        partId: 'button-tactile',
        label: 'Button',
        designator: 'SW1',
        position: { x: -1.6, y: 0.25, z: -0.6 }
      }
    ]),
    connections: [],
    behavior: { runText: 'RAIL CHECK' },
    assumptions: ['This render-only fixture checks hidden breadboard rail continuity conflicts.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });

  const renderPlan = await compileRenderPlan(spec, validRenderOnlyReport());

  assert.equal(renderPlan.warnings.some((warning) => warning.code === 'BREADBOARD_RAIL_CONFLICT'), false);
  assert.equal(renderPlan.layout?.solverAttempts?.some((attempt) => attempt.stage === 'placement'), true);
});

test('simulation plan remains valid after render solver repairs a hidden breadboard node conflict', async () => {
  const spec = buttonLedCircuitWithHiddenPhysicalConflict();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, currentPaths, renderPlan);

  assert.equal(validation.status, 'valid');
  assert.ok(currentPaths.length > 0, 'logical validation still produces current paths before render DRC gating');
  assert.equal(renderPlan.warnings.some((warning) => warning.code === 'BREADBOARD_PHYSICAL_NODE_CONFLICT'), false);
  assert.equal(simulationPlan.status, 'valid');
  assert.ok(simulationPlan.currentPaths.length > 0);
});

test('simulation plan remains valid after render solver repairs a hidden breadboard continuity conflict', async () => {
  const spec = buttonLedCircuitWithHiddenContinuityConflict();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, currentPaths, renderPlan);

  assert.equal(validation.status, 'valid');
  assert.ok(currentPaths.length > 0, 'logical validation still produces current paths before render DRC gating');
  assert.equal(renderPlan.warnings.some((warning) => warning.code === 'BREADBOARD_CONTINUITY_CONFLICT'), false);
  assert.equal(simulationPlan.status, 'valid');
  assert.ok(simulationPlan.currentPaths.length > 0);
});

test('simulation plan remains valid after render solver repairs a hidden breadboard rail conflict', async () => {
  const spec = buttonLedCircuitWithHiddenRailConflict();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, currentPaths, renderPlan);

  assert.equal(validation.status, 'valid');
  assert.ok(currentPaths.length > 0, 'logical validation still produces current paths before render DRC gating');
  assert.equal(renderPlan.warnings.some((warning) => warning.code === 'BREADBOARD_RAIL_CONFLICT'), false);
  assert.equal(simulationPlan.status, 'valid');
  assert.ok(simulationPlan.currentPaths.length > 0);
});

test('requirement markdown stays build-ready after render solver repairs explicit physical conflicts', async () => {
  const spec = buttonLedCircuitWithHiddenRailConflict();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, currentPaths, renderPlan);
  const runnableReport = buildRunnableReport(validation, renderPlan, simulationPlan);
  const markdown = await compileRequirementMarkdown(spec, validation, simulationPlan, runnableReport);

  assert.equal(validation.status, 'valid');
  assert.equal(simulationPlan.status, 'valid');
  assert.equal(runnableReport.status, 'runnable');
  assert.doesNotMatch(markdown, /SIMULATION_BLOCKED_BY_RENDER_DRC/);
  assert.doesNotMatch(markdown, /BREADBOARD_RAIL_CONFLICT/);
  assert.match(markdown, /Build runnable: runnable/);
  assert.match(markdown, /Current Flow/);
});

test('simulation artifacts cite the primitive contract used for current paths and expected states', async () => {
  const oledSpec = oledCircuit();
  const oledValidation = await validateCircuitSpec(oledSpec);
  const oledNetlist = await buildNetlist(oledSpec);
  const oledCurrentPaths = await estimateCurrentPaths(oledSpec, oledNetlist, oledValidation);
  const oledRender = await compileRenderPlan(oledSpec, oledValidation);
  const oledSimulation = await compileSimulationPlan(oledSpec, oledValidation, oledCurrentPaths, oledRender);

  assert.equal(oledCurrentPaths[0]?.primitiveId, 'display_static_text');
  assert.equal(oledSimulation.expectedStates[0]?.primitiveId, 'display_static_text');
  assert.match(oledSimulation.expectedStates[0]?.explanation ?? '', /display|power|i2c/i);

  const ledSpec = ledCircuit();
  const ledValidation = await validateCircuitSpec(ledSpec);
  const ledNetlist = await buildNetlist(ledSpec);
  const ledCurrentPaths = await estimateCurrentPaths(ledSpec, ledNetlist, ledValidation);
  const ledRender = await compileRenderPlan(ledSpec, ledValidation);
  const ledSimulation = await compileSimulationPlan(ledSpec, ledValidation, ledCurrentPaths, ledRender);

  assert.equal(ledCurrentPaths[0]?.primitiveId, 'digital_on_off');
  assert.deepEqual(
    ledCurrentPaths[0]?.connectionIds,
    ['d9-to-resistor', 'resistor-to-led', 'led-to-ground']
  );
  assert.deepEqual(
    ledCurrentPaths[0]?.segments?.map((segment) => `${segment.connectionId}:${segment.from}->${segment.to}`),
    [
      'd9-to-resistor:arduino-uno:D9->resistor-1:1',
      'resistor-to-led:resistor-1:2->led-1:A',
      'led-to-ground:led-1:K->arduino-uno:GND'
    ]
  );
  assert.equal(ledSimulation.expectedStates[0]?.primitiveId, 'digital_on_off');
  assert.match(ledSimulation.expectedStates[0]?.explanation ?? '', /digital|HIGH|LOW/i);
});

test('current path estimation consumes primitive path template metadata from the context layer', async () => {
  const primitives = await loadSimulationPrimitives();
  const digitalTemplate = primitives.find((primitive) => primitive.id === 'digital_on_off')?.currentPathRecipe.pathTemplate;
  assert.ok(digitalTemplate, 'digital_on_off path template should exist');

  const spec = ledCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const [path] = await estimateCurrentPaths(spec, netlist, validation);

  assert.equal(path.id, digitalTemplate.id);
  assert.equal(path.label, digitalTemplate.label);
  assert.equal(path.from, 'arduino-uno:D9');
  assert.deepEqual(path.animation, digitalTemplate.animation);
  assert.deepEqual(path.through, ['resistor-1', 'led-1']);
});

test('current path estimation uses the actual Arduino component id and connected output pin', async () => {
  const base = ledCircuit();
  const spec = CircuitSpecSchema.parse({
    ...base,
    components: base.components.map((component) => component.id === 'arduino-uno'
      ? { ...component, id: 'uno', label: 'Arduino Uno' }
      : component),
    connections: [
      connection('d8-to-resistor', 'uno', 'D8', 'resistor-1', '1', 'gpio'),
      connection('resistor-to-led', 'resistor-1', '2', 'led-1', 'A', 'gpio'),
      connection('led-to-ground', 'led-1', 'K', 'uno', 'GND', 'ground')
    ]
  });

  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const [path] = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, [path], renderPlan);
  const runnableReport = buildRunnableReport(validation, renderPlan, simulationPlan);
  const markdown = await compileRequirementMarkdown(spec, validation, simulationPlan, runnableReport);

  assert.equal(validation.status, 'valid');
  assert.equal(path.from, 'uno:D8');
  assert.equal(path.to, 'uno:GND');
  assert.match(markdown, /from uno:D8 to uno:GND/);
});

test('current path estimation composes multi-path primitive templates for servo supply and PWM signal', async () => {
  const primitives = await loadSimulationPrimitives();
  const servoTemplates = primitives.find((primitive) => primitive.id === 'servo_angle')?.currentPathRecipe.pathTemplates;
  assert.ok(servoTemplates, 'servo_angle should expose multi-path templates');

  const spec = servoCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);

  assert.deepEqual(paths.map((path) => path.id), servoTemplates.map((template) => template.id));
  assert.equal(paths[0].kind, 'supply-current');
  assert.equal(paths[0].from, 'arduino-uno:5V');
  assert.equal(paths[0].to, 'arduino-uno:GND');
  assert.equal(paths[1].kind, 'signal-activity');
  assert.equal(paths[1].from, 'arduino-uno:D9');
  assert.equal(paths[1].to, 'servo-1:SIG');
  assert.equal(paths[1].expectedCurrentMa, 0);
});

test('MG996R high-torque servo validates with external-power warning and qualitative servo simulation', async () => {
  const spec = mg996rServoCircuit();
  const validationReport = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
  const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);

  assert.equal(validationReport.status, 'valid');
  assert.equal(validationReport.electricalAnalysis?.topologyTemplateId, 'controller-servo-external-power-warning');
  assert.ok(validationReport.warnings.some((warning) => warning.includes('SERVO_HIGH_TORQUE_POWER_WARNING')));
  assert.ok(renderPlan.parts.some((part) => part.type === 'large-servo'));
  assert.deepEqual(simulationPlan.currentPaths.map((path) => path.id), ['servo-supply-current', 'servo-pwm-signal']);
  assert.equal(simulationPlan.currentPaths.find((path) => path.id === 'servo-pwm-signal')?.to, 'servo-1:SIGNAL');
  assert.equal(runnableReport.runnable, true);
});

test('current path estimation composes multiple validated output loads for one button-controlled behavior', async () => {
  const spec = buttonLedBuzzerCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);

  assert.equal(validation.status, 'valid');
  assert.deepEqual(paths.map((path) => path.id), ['led-forward-current', 'buzzer-current']);
  assert.deepEqual(paths.map((path) => path.primitiveId), ['digital_on_off', 'buzzer_pulse']);
  assert.equal(paths.find((path) => path.id === 'led-forward-current')?.from, 'arduino-uno:D9');
  assert.equal(paths.find((path) => path.id === 'buzzer-current')?.from, 'arduino-uno:D8');
  assert.deepEqual(
    simulationPlan.currentPaths.map((path) => path.id),
    ['led-forward-current', 'buzzer-current']
  );
  assert.deepEqual(
    simulationPlan.expectedStates.map((state) => state.primitiveId),
    ['digital_on_off', 'buzzer_pulse']
  );
});

test('current path estimation keeps repeated LED loads paired with their own resistors', async () => {
  const spec = twoLedCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);

  assert.equal(validation.status, 'valid');
  assert.deepEqual(validation.validatedCurrentPathIds, ['led-forward-current:led-1', 'led-forward-current:led-2']);
  assert.deepEqual(paths.map((path) => path.id), ['led-forward-current:led-1', 'led-forward-current:led-2']);
  assert.deepEqual(paths.map((path) => path.from), ['arduino-uno:D9', 'arduino-uno:D8']);
  assert.deepEqual(paths.map((path) => path.through), [
    ['resistor-1', 'led-1'],
    ['resistor-2', 'led-2']
  ]);
  assert.deepEqual(
    simulationPlan.currentPaths.map((path) => path.id),
    ['led-forward-current:led-1', 'led-forward-current:led-2']
  );
  assert.deepEqual(
    simulationPlan.expectedStates.map((state) => state.componentId),
    ['led-1', 'led-2']
  );
  assert.equal(simulationPlan.warnings.some((warning) => /SIMULATION_PATH_NOT_VALIDATED/.test(warning)), false);
});

test('validation rejects repeated LED loads that share one current limiting resistor path', async () => {
  const sharedResistor = twoLedCircuitWithSharedResistor();
  const validation = await validateCircuitSpec(sharedResistor);
  const netlist = await buildNetlist(sharedResistor);
  const paths = await estimateCurrentPaths(sharedResistor, netlist, validation);

  assert.equal(validation.status, 'invalid');
  assert.match(validation.errors.join('\n'), /LED_RESISTOR_SHARED|current limiting resistor/i);
  assert.deepEqual(paths, []);
});

test('sensor display primitive separates supply, sensor signal, and bus activity paths', async () => {
  const primitives = await loadSimulationPrimitives();
  const sensorDisplay = primitives.find((primitive) => primitive.id === 'display_sensor_value');

  assert.ok(sensorDisplay?.currentPathRecipe.pathTemplates, 'display_sensor_value should expose multi-path templates');
  assert.deepEqual(
    sensorDisplay.currentPathRecipe.pathTemplates.map((template) => template.kind),
    ['supply-current', 'signal-activity', 'bus-activity']
  );
  assert.deepEqual(
    sensorDisplay.currentPathRecipe.pathTemplates.map((template) => template.expectedCurrentMa ?? null),
    [null, 0, 0]
  );
});

test('potentiometer LED dimmer validates, renders, and exposes analog plus PWM current paths', async () => {
  const spec = potentiometerLedDimmerCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);

  assert.equal(validation.status, 'valid');
  assert.deepEqual(validation.validatedCurrentPathIds, [
    'analog-pwm-sensing-divider:pot-1',
    'analog-pwm-analog-signal:pot-1',
    'led-forward-current'
  ]);
  assert.deepEqual(paths.map((path) => path.primitiveId), [
    'analog_pwm_dimmer',
    'analog_pwm_dimmer',
    'digital_on_off'
  ]);
  assert.equal(paths.find((path) => path.id === 'analog-pwm-sensing-divider:pot-1')?.kind, 'sensing-divider');
  assert.equal(paths.find((path) => path.id === 'analog-pwm-analog-signal:pot-1')?.to, 'arduino-uno:A0');
  assert.equal(paths.find((path) => path.id === 'led-forward-current')?.from, 'arduino-uno:D9');
  assert.equal(renderPlan.warnings.some((warning) => warning.code === 'MISSING_RENDER_FOOTPRINT'), false);
  assert.equal(simulationPlan.status, 'valid');
  assert.deepEqual(
    simulationPlan.currentPaths.map((path) => path.id),
    ['analog-pwm-sensing-divider:pot-1', 'analog-pwm-analog-signal:pot-1', 'led-forward-current']
  );
  assert.ok(simulationPlan.expectedStates.some((state) => state.primitiveId === 'analog_pwm_dimmer'));
  assert.ok(simulationPlan.expectedStates.some((state) => state.primitiveId === 'digital_on_off'));
});

test('trimmer potentiometer LED dimmer reuses the analog divider PWM simulation contract', async () => {
  const spec = trimmerPotLedDimmerCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);

  assert.equal(validation.status, 'valid', validation.errors.join('\n'));
  assert.equal(validation.electricalAnalysis?.topologyTemplateId, 'controller-analog-input-pwm-output');
  assert.deepEqual(validation.validatedCurrentPathIds, [
    'analog-pwm-sensing-divider:trim-1',
    'analog-pwm-analog-signal:trim-1',
    'led-forward-current'
  ]);
  assert.ok(renderPlan.parts.some((part) => part.type === 'trimmer-pot'), 'trimmer footprint should render');
  assert.equal(paths.find((path) => path.id === 'analog-pwm-analog-signal:trim-1')?.to, 'arduino-uno:A0');
  assert.equal(simulationPlan.status, 'valid');
  assert.deepEqual(
    simulationPlan.currentPaths.map((path) => path.id),
    ['analog-pwm-sensing-divider:trim-1', 'analog-pwm-analog-signal:trim-1', 'led-forward-current']
  );
  assert.ok(simulationPlan.expectedStates.some((state) => state.primitiveId === 'analog_pwm_dimmer'));
});

test('photoresistor dark-trigger LED validates and exposes threshold current paths', async () => {
  const spec = ldrDarkLedCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);

  assert.equal(validation.status, 'valid');
  assert.deepEqual(validation.validatedCurrentPathIds, [
    'analog-threshold-sensing-divider:ldr-1',
    'analog-threshold-analog-signal:ldr-1',
    'led-forward-current'
  ]);
  assert.equal(paths.find((path) => path.id === 'analog-threshold-sensing-divider:ldr-1')?.primitiveId, 'analog_threshold');
  assert.equal(paths.find((path) => path.id === 'analog-threshold-analog-signal:ldr-1')?.to, 'arduino-uno:A0');
  assert.equal(renderPlan.warnings.some((warning) => warning.code === 'MISSING_RENDER_FOOTPRINT'), false);
  assert.equal(simulationPlan.status, 'valid');
  assert.ok(simulationPlan.expectedStates.some((state) => state.primitiveId === 'analog_threshold'));
});

test('ultrasonic distance display validates, renders, and exposes sensor/display paths', async () => {
  const spec = ultrasonicDistanceDisplayCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);

  assert.equal(validation.status, 'valid');
  assert.equal(validation.electricalAnalysis?.topologyTemplateId, 'controller-distance-sensor-i2c-display');
  assert.deepEqual(validation.validatedCurrentPathIds, [
    'distance-sensor-supply-current:ultrasonic-1',
    'distance-trigger-signal:ultrasonic-1',
    'distance-echo-signal:ultrasonic-1',
    'oled-module-current'
  ]);
  assert.equal(renderPlan.warnings.some((warning) => warning.code === 'MISSING_RENDER_FOOTPRINT'), false);
  assert.equal(
    renderPlan.warnings.some((warning) => warning.code === 'BREADBOARD_PIN_GRID_MISALIGNMENT'),
    false,
    renderPlan.warnings.map((warning) => warning.message).join('\n')
  );
  assert.ok(renderPlan.parts.some((part) => part.type === 'ultrasonic-sensor'));
  assert.equal(paths.find((path) => path.id === 'distance-trigger-signal:ultrasonic-1')?.from, 'arduino-uno:D3');
  assert.equal(paths.find((path) => path.id === 'distance-echo-signal:ultrasonic-1')?.to, 'arduino-uno:D2');
  assert.equal(simulationPlan.status, 'valid');
  assert.ok(simulationPlan.expectedStates.some((state) => state.primitiveId === 'display_sensor_value'));
  assert.ok(simulationPlan.expectedStates.some((state) => state.primitiveId === 'display_static_text'));
});

test('ultrasonic distance validation rejects missing trigger, echo, and OLED bus wiring', async () => {
  const base = ultrasonicDistanceDisplayCircuit();
  const missingTrigger = CircuitSpecSchema.parse({
    ...base,
    id: 'ultrasonic-distance-display-missing-trigger',
    connections: base.connections.filter((candidate) => candidate.id !== 'sensor-trigger')
  });
  const missingEcho = CircuitSpecSchema.parse({
    ...base,
    id: 'ultrasonic-distance-display-missing-echo',
    connections: base.connections.filter((candidate) => candidate.id !== 'sensor-echo')
  });
  const missingDisplayBus = CircuitSpecSchema.parse({
    ...base,
    id: 'ultrasonic-distance-display-missing-oled-bus',
    connections: base.connections.filter((candidate) => candidate.id !== 'oled-sda')
  });

  assert.match((await validateCircuitSpec(missingTrigger)).errors.join('\n'), /DISTANCE_SENSOR_TRIG_MISSING/);
  assert.match((await validateCircuitSpec(missingEcho)).errors.join('\n'), /DISTANCE_SENSOR_ECHO_MISSING/);
  assert.match((await validateCircuitSpec(missingDisplayBus)).errors.join('\n'), /DISPLAY_I2C_CONNECTION_MISSING/);
});

test('DHT11 temperature humidity display validates, renders, and exposes sensor/display paths', async () => {
  const spec = dht11TemperatureHumidityDisplayCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);

  assert.equal(validation.status, 'valid');
  assert.equal(validation.electricalAnalysis?.topologyTemplateId, 'controller-single-wire-sensor-i2c-display');
  assert.deepEqual(validation.validatedCurrentPathIds, [
    'dht11-sensor-supply-current:dht11-1',
    'dht11-data-signal:dht11-1',
    'dht11-display-bus-activity:oled-display',
    'oled-module-current'
  ]);
  assert.equal(renderPlan.warnings.some((warning) => warning.code === 'MISSING_RENDER_FOOTPRINT'), false);
  assert.equal(
    renderPlan.warnings.some((warning) => warning.code === 'BREADBOARD_PIN_GRID_MISALIGNMENT'),
    false,
    renderPlan.warnings.map((warning) => warning.message).join('\n')
  );
  assert.ok(renderPlan.parts.some((part) => part.type === 'dht11-sensor'));
  assert.equal(paths.find((path) => path.id === 'dht11-data-signal:dht11-1')?.to, 'arduino-uno:D2');
  assert.equal(paths.find((path) => path.id === 'dht11-display-bus-activity:oled-display')?.from, 'arduino-uno:A4/SDA');
  assert.equal(simulationPlan.status, 'valid');
  assert.ok(simulationPlan.expectedStates.some((state) => state.primitiveId === 'display_sensor_value'));
  assert.ok(simulationPlan.expectedStates.some((state) => state.primitiveId === 'display_static_text'));
});

test('WP-10 protocol sensor displays validate, render, and simulate through explicit sensor-display contracts', async () => {
  for (const { spec, topologyId, footprintType, requiredPathIds } of [
    {
      spec: dht22TemperatureHumidityDisplayCircuit(),
      topologyId: 'controller-single-wire-sensor-i2c-display',
      footprintType: 'dht22-sensor',
      requiredPathIds: [
        'single-wire-sensor-supply-current:dht22-1',
        'single-wire-sensor-data-signal:dht22-1',
        'single-wire-sensor-display-bus-activity:oled-display',
        'oled-module-current'
      ]
    },
    {
      spec: i2cProtocolSensorDisplayCircuit('bmp280'),
      topologyId: 'controller-i2c-sensor-display',
      footprintType: 'bmp280-module',
      requiredPathIds: [
        'protocol-sensor-supply-current:bmp280-1',
        'protocol-sensor-bus-activity:bmp280-1',
        'protocol-sensor-display-bus-activity:oled-display',
        'oled-module-current'
      ]
    },
    {
      spec: i2cProtocolSensorDisplayCircuit('mpu6050'),
      topologyId: 'controller-i2c-sensor-display',
      footprintType: 'mpu6050-module',
      requiredPathIds: [
        'protocol-sensor-supply-current:mpu6050-1',
        'protocol-sensor-bus-activity:mpu6050-1',
        'protocol-sensor-display-bus-activity:oled-display',
        'oled-module-current'
      ]
    },
    {
      spec: i2cProtocolSensorDisplayCircuit('hmc5883l'),
      topologyId: 'controller-i2c-sensor-display',
      footprintType: 'hmc5883l-module',
      requiredPathIds: [
        'protocol-sensor-supply-current:hmc5883l-1',
        'protocol-sensor-bus-activity:hmc5883l-1',
        'protocol-sensor-display-bus-activity:oled-display',
        'oled-module-current'
      ]
    },
    {
      spec: i2cProtocolSensorDisplayCircuit('max30102-pulse'),
      topologyId: 'controller-i2c-sensor-display',
      footprintType: 'max30102-pulse-module',
      requiredPathIds: [
        'protocol-sensor-supply-current:max30102-1',
        'protocol-sensor-bus-activity:max30102-1',
        'protocol-sensor-display-bus-activity:oled-display',
        'oled-module-current'
      ]
    },
    {
      spec: clockedDataProtocolSensorDisplayCircuit(),
      topologyId: 'controller-clocked-data-sensor-i2c-display',
      footprintType: 'hx711-loadcell-module',
      requiredPathIds: [
        'protocol-sensor-supply-current:hx711-1',
        'protocol-sensor-bus-activity:hx711-1',
        'protocol-sensor-display-bus-activity:oled-display',
        'oled-module-current'
      ]
    },
    {
      spec: spiProtocolSensorDisplayCircuit(),
      topologyId: 'controller-spi-sensor-display',
      footprintType: 'rc522-rfid-module',
      requiredPathIds: [
        'protocol-sensor-supply-current:rc522-1',
        'protocol-sensor-bus-activity:rc522-1',
        'protocol-sensor-display-bus-activity:oled-display',
        'oled-module-current'
      ]
    },
    {
      spec: uartProtocolSensorDisplayCircuit(),
      topologyId: 'controller-uart-sensor-display',
      footprintType: 'gps-neo6m-module',
      requiredPathIds: [
        'protocol-sensor-supply-current:gps-1',
        'protocol-sensor-bus-activity:gps-1',
        'protocol-sensor-display-bus-activity:oled-display',
        'oled-module-current'
      ]
    }
  ]) {
    const validation = await validateCircuitSpec(spec);
    const netlist = await buildNetlist(spec);
    const paths = await estimateCurrentPaths(spec, netlist, validation);
    const renderPlan = await compileRenderPlan(spec, validation);
    const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);
    const runnableReport = buildRunnableReport(validation, renderPlan, simulationPlan);
    const pathIds = simulationPlan.currentPaths.map((path) => path.id);

    assert.equal(validation.status, 'valid', `${spec.title}\n${validation.errors.join('\n')}`);
    assert.equal(validation.electricalAnalysis?.topologyTemplateId, topologyId, spec.title);
    assert.equal(renderPlan.warnings.some((warning) => warning.code === 'MISSING_RENDER_FOOTPRINT'), false, spec.title);
    assert.ok(renderPlan.parts.some((part) => part.type === footprintType), spec.title);
    for (const pathId of requiredPathIds) {
      assert.ok(pathIds.includes(pathId), `${spec.title} should include ${pathId}; got ${pathIds.join(', ')}`);
    }
    assert.ok(validation.warnings.some((warning) => warning.includes('PROTOCOL_SENSOR_QUALITATIVE_ONLY')), spec.title);
    assert.equal(simulationPlan.status, 'valid', `${spec.title}\n${simulationPlan.warnings.join('\n')}`);
    assert.equal(runnableReport.runnable, true, `${spec.title}\n${runnableReport.reasons.join('\n')}`);
  }
});

test('WP-10 protocol sensor safety validator blocks medical, tracking, security, and certified measurement claims', async () => {
  for (const { spec, expectedCode } of [
    {
      spec: withProtocolSensorSafetyClaim(
        i2cProtocolSensorDisplayCircuit('max30102-pulse'),
        'use MAX30102 for SpO2 medical health monitoring',
        'SPO2 MEDICAL MONITOR'
      ),
      expectedCode: 'PROTOCOL_SENSOR_MEDICAL_UNSUPPORTED'
    },
    {
      spec: withProtocolSensorSafetyClaim(
        uartProtocolSensorDisplayCircuit(),
        'build a GPS tracking and navigation module',
        'GPS TRACKING NAVIGATION'
      ),
      expectedCode: 'PROTOCOL_SENSOR_NAVIGATION_UNSUPPORTED'
    },
    {
      spec: withProtocolSensorSafetyClaim(
        spiProtocolSensorDisplayCircuit(),
        'use RC522 RFID for door lock access control security',
        'RFID DOOR LOCK ACCESS'
      ),
      expectedCode: 'PROTOCOL_SENSOR_SECURITY_UNSUPPORTED'
    },
    {
      spec: withProtocolSensorSafetyClaim(
        clockedDataProtocolSensorDisplayCircuit(),
        'make a certified calibrated exact weight scale with HX711',
        'CERTIFIED EXACT WEIGHT'
      ),
      expectedCode: 'PROTOCOL_SENSOR_CERTIFIED_MEASUREMENT_UNSUPPORTED'
    }
  ]) {
    const validation = await validateCircuitSpec(spec);

    assert.equal(validation.status, 'invalid', spec.title);
    assert.match(validation.errors.join('\n'), new RegExp(expectedCode), spec.title);
  }
});

test('WP-12 logic interface ICs validate, render, and simulate through qualitative interface contracts', async () => {
  for (const { spec, topologyId, footprintType, requiredPathIds, warningCode } of [
    {
      spec: logicInterfaceDisplayCircuit('74hc595-shift'),
      topologyId: 'controller-logic-interface-context',
      footprintType: 'dip-logic-74hc595',
      requiredPathIds: [
        'logic-interface-supply-current:logic-1',
        'logic-interface-signal-activity:logic-1',
        'logic-interface-display-bus-activity:oled-display',
        'oled-module-current'
      ],
      warningCode: 'LOGIC_INTERFACE_QUALITATIVE_ONLY'
    },
    {
      spec: logicInterfaceDisplayCircuit('pcf8574-expander'),
      topologyId: 'controller-i2c-interface-context',
      footprintType: 'i2c-expander-pcf8574',
      requiredPathIds: [
        'logic-interface-supply-current:logic-1',
        'logic-interface-signal-activity:logic-1',
        'logic-interface-display-bus-activity:oled-display',
        'oled-module-current'
      ],
      warningCode: 'LOGIC_INTERFACE_QUALITATIVE_ONLY'
    },
    {
      spec: logicInterfaceDisplayCircuit('ads1115-adc'),
      topologyId: 'controller-i2c-interface-context',
      footprintType: 'ads1115-adc-module',
      requiredPathIds: [
        'logic-interface-supply-current:logic-1',
        'logic-interface-signal-activity:logic-1',
        'logic-interface-display-bus-activity:oled-display',
        'oled-module-current'
      ],
      warningCode: 'LOGIC_INTERFACE_QUALITATIVE_ONLY'
    },
    {
      spec: logicInterfaceDisplayCircuit('mcp3008-adc'),
      topologyId: 'controller-spi-interface-context',
      footprintType: 'mcp3008-adc-ic',
      requiredPathIds: [
        'logic-interface-supply-current:logic-1',
        'logic-interface-signal-activity:logic-1',
        'logic-interface-display-bus-activity:oled-display',
        'oled-module-current'
      ],
      warningCode: 'LOGIC_INTERFACE_QUALITATIVE_ONLY'
    },
    {
      spec: logicInterfaceDisplayCircuit('ne555-timer'),
      topologyId: 'controller-analog-timing-interface-context',
      footprintType: 'dip-timer-ne555',
      requiredPathIds: [
        'logic-interface-supply-current:logic-1',
        'logic-interface-signal-activity:logic-1',
        'logic-interface-display-bus-activity:oled-display',
        'oled-module-current'
      ],
      warningCode: 'LOGIC_INTERFACE_QUALITATIVE_ONLY'
    },
    {
      spec: logicInterfaceDisplayCircuit('lm358-opamp'),
      topologyId: 'controller-analog-timing-interface-context',
      footprintType: 'dip-opamp-lm358',
      requiredPathIds: [
        'logic-interface-supply-current:logic-1',
        'logic-interface-signal-activity:logic-1',
        'logic-interface-display-bus-activity:oled-display',
        'oled-module-current'
      ],
      warningCode: 'LOGIC_INTERFACE_QUALITATIVE_ONLY'
    },
    {
      spec: levelShifterContextCircuit(),
      topologyId: 'level-shifted-i2c-bus',
      footprintType: 'i2c-level-shifter-module',
      requiredPathIds: [
        'logic-interface-supply-current:level-shifter-1',
        'logic-interface-signal-activity:level-shifter-1'
      ],
      warningCode: 'LEVEL_SHIFTER_CONTEXT_ONLY'
    }
  ]) {
    const validation = await validateCircuitSpec(spec);
    const netlist = await buildNetlist(spec);
    const paths = await estimateCurrentPaths(spec, netlist, validation);
    const renderPlan = await compileRenderPlan(spec, validation);
    const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);
    const runnableReport = buildRunnableReport(validation, renderPlan, simulationPlan);
    const pathIds = simulationPlan.currentPaths.map((path) => path.id);

    assert.equal(validation.status, 'valid', `${spec.title}\n${validation.errors.join('\n')}`);
    assert.equal(validation.electricalAnalysis?.topologyTemplateId, topologyId, spec.title);
    assert.equal(renderPlan.warnings.some((warning) => warning.code === 'MISSING_RENDER_FOOTPRINT'), false, spec.title);
    assert.ok(renderPlan.parts.some((part) => part.type === footprintType), spec.title);
    for (const pathId of requiredPathIds) {
      assert.ok(pathIds.includes(pathId), `${spec.title} should include ${pathId}; got ${pathIds.join(', ')}`);
    }
    assert.ok(validation.warnings.some((warning) => warning.includes(warningCode)), spec.title);
    assert.equal(simulationPlan.status, 'valid', `${spec.title}\n${simulationPlan.warnings.join('\n')}`);
    assert.equal(runnableReport.runnable, true, `${spec.title}\n${runnableReport.reasons.join('\n')}`);
  }
});

test('WP-12 logic interface safety validator blocks precision, exact timing, and regulator overclaims', async () => {
  for (const { spec, expectedCode } of [
    {
      spec: withLogicInterfaceSafetyClaim(
        logicInterfaceDisplayCircuit('ads1115-adc'),
        'make a calibrated precision exact voltage instrument with ADS1115',
        'CALIBRATED EXACT VOLTAGE'
      ),
      expectedCode: 'LOGIC_INTERFACE_PRECISION_ANALOG_UNSUPPORTED'
    },
    {
      spec: withLogicInterfaceSafetyClaim(
        logicInterfaceDisplayCircuit('ne555-timer'),
        'make an exact calibrated 1 kHz frequency and duty cycle waveform with NE555',
        'EXACT 1KHZ DUTY CYCLE'
      ),
      expectedCode: 'LOGIC_INTERFACE_TIMER_FREQUENCY_UNSUPPORTED'
    },
    {
      spec: withLogicInterfaceSafetyClaim(
        levelShifterContextCircuit(),
        'use the level shifter as a voltage regulator and current booster power supply',
        'REGULATED CURRENT BOOST'
      ),
      expectedCode: 'LOGIC_INTERFACE_LEVEL_SHIFT_UNSUPPORTED'
    }
  ]) {
    const validation = await validateCircuitSpec(spec);

    assert.equal(validation.status, 'invalid', spec.title);
    assert.match(validation.errors.join('\n'), new RegExp(expectedCode), spec.title);
  }
});

test('DHT11 temperature humidity validation rejects missing data, power, ground, and OLED bus wiring', async () => {
  const base = dht11TemperatureHumidityDisplayCircuit();
  const missingData = CircuitSpecSchema.parse({
    ...base,
    id: 'dht11-temperature-humidity-display-missing-data',
    connections: base.connections.filter((candidate) => candidate.id !== 'sensor-data')
  });
  const missingPower = CircuitSpecSchema.parse({
    ...base,
    id: 'dht11-temperature-humidity-display-missing-power',
    connections: base.connections.filter((candidate) => candidate.id !== 'sensor-power')
  });
  const missingGround = CircuitSpecSchema.parse({
    ...base,
    id: 'dht11-temperature-humidity-display-missing-ground',
    connections: base.connections.filter((candidate) => candidate.id !== 'sensor-ground')
  });
  const missingDisplayBus = CircuitSpecSchema.parse({
    ...base,
    id: 'dht11-temperature-humidity-display-missing-oled-bus',
    connections: base.connections.filter((candidate) => candidate.id !== 'oled-scl')
  });
  const missingDisplay = CircuitSpecSchema.parse({
    ...base,
    id: 'dht11-temperature-humidity-display-missing-display',
    components: base.components.filter((candidate) => candidate.id !== 'oled-display'),
    connections: base.connections.filter((candidate) => !candidate.id.startsWith('oled-'))
  });
  const dataOnWrongPin = CircuitSpecSchema.parse({
    ...base,
    id: 'dht11-temperature-humidity-display-data-on-output-pin',
    connections: base.connections.map((candidate) => candidate.id === 'sensor-data'
      ? connection('sensor-data', 'dht11-1', 'DAT', 'arduino-uno', 'D3', 'single-wire-data')
      : candidate)
  });
  const dataWithWrongSignal = CircuitSpecSchema.parse({
    ...base,
    id: 'dht11-temperature-humidity-display-wrong-data-signal',
    connections: base.connections.map((candidate) => candidate.id === 'sensor-data'
      ? connection('sensor-data', 'dht11-1', 'DAT', 'arduino-uno', 'D2', 'single-bus-typo')
      : candidate)
  });

  assert.match((await validateCircuitSpec(missingData)).errors.join('\n'), /DHT_SENSOR_DATA_MISSING/);
  assert.match((await validateCircuitSpec(missingPower)).errors.join('\n'), /DHT_SENSOR_POWER_MISSING/);
  assert.match((await validateCircuitSpec(missingGround)).errors.join('\n'), /DHT_SENSOR_GROUND_MISSING/);
  assert.match((await validateCircuitSpec(missingDisplayBus)).errors.join('\n'), /DISPLAY_I2C_CONNECTION_MISSING/);
  assert.match((await validateCircuitSpec(missingDisplay)).errors.join('\n'), /DHT_DISPLAY_MISSING/);
  assert.match((await validateCircuitSpec(dataOnWrongPin)).errors.join('\n'), /DHT_SENSOR_DATA_MISSING/);
  assert.match((await validateCircuitSpec(dataWithWrongSignal)).errors.join('\n'), /DHT_SENSOR_DATA_SIGNAL_INVALID/);
});

test('analog input validation rejects missing signal, PWM, and threshold behavior gaps', async () => {
  const missingSignal = CircuitSpecSchema.parse({
    ...potentiometerLedDimmerCircuit(),
    id: 'potentiometer-led-dimmer-missing-signal',
    connections: potentiometerLedDimmerCircuit().connections.filter((candidate) => candidate.id !== 'pot-output-to-a0')
  });
  const nonPwmOutput = CircuitSpecSchema.parse({
    ...potentiometerLedDimmerCircuit(),
    id: 'potentiometer-led-dimmer-non-pwm-output',
    connections: potentiometerLedDimmerCircuit().connections.map((candidate) => candidate.id === 'd9-to-resistor'
      ? connection('d3-to-resistor', 'arduino-uno', 'D3', 'resistor-1', '1', 'gpio')
      : candidate)
  });
  const missingThreshold = CircuitSpecSchema.parse({
    ...ldrDarkLedCircuit(),
    id: 'ldr-led-missing-threshold-behavior',
    intent: {
      primaryGoal: 'read an analog sensor value',
      input: 'analog sensor',
      output: 'led',
      controller: 'arduino-uno',
      behavior: 'read sensor value'
    },
    behavior: { runText: 'READ SENSOR' },
    assumptions: ['The photoresistor is wired to analog input A0.']
  });

  const missingSignalReport = await validateCircuitSpec(missingSignal);
  const nonPwmReport = await validateCircuitSpec(nonPwmOutput);
  const missingThresholdReport = await validateCircuitSpec(missingThreshold);

  assert.equal(missingSignalReport.status, 'invalid');
  assert.match(missingSignalReport.errors.join('\n'), /ANALOG_INPUT_SIGNAL_MISSING/);
  assert.equal(nonPwmReport.status, 'invalid');
  assert.match(nonPwmReport.errors.join('\n'), /ANALOG_DIMMER_PWM_OUTPUT_MISSING/);
  assert.equal(missingThresholdReport.status, 'invalid');
  assert.match(missingThresholdReport.errors.join('\n'), /ANALOG_THRESHOLD_BEHAVIOR_MISSING/);
});

test('simulation plan keeps only deterministically validated current path ids', async () => {
  const spec = ledCircuit();
  const validation = await validateCircuitSpec(spec);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, {
    ...validation,
    validatedCurrentPathIds: ['led-forward-current']
  }, [
    {
      id: 'led-forward-current',
      kind: 'load-current',
      primitiveId: 'digital_on_off',
      label: 'LED forward current',
      from: 'arduino-uno:D9',
      through: ['resistor-1', 'led-1'],
      to: 'arduino-uno:GND',
      expectedCurrentMa: 12,
      animation: { color: '#ff4d3d', speed: 0.82 }
    },
    {
      id: 'unvalidated-bus-path',
      kind: 'bus-activity',
      primitiveId: 'missing_primitive',
      label: 'Unvalidated bus activity',
      from: 'arduino-uno:A4/SDA',
      through: ['oled-display'],
      to: 'oled-display:SDA',
      expectedCurrentMa: 0,
      animation: { color: '#84a9ff', speed: 0.5 }
    }
  ], renderPlan);

  assert.deepEqual(simulationPlan.currentPaths.map((path) => path.id), ['led-forward-current']);
  assert.ok(simulationPlan.warnings.some((warning) => /unvalidated-bus-path|not validated/i.test(warning)));
});

test('simulation plan drops current paths whose endpoints have no render footprint anchors', async () => {
  const spec = ledCircuit();
  const validation = await validateCircuitSpec(spec);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, {
    ...validation,
    validatedCurrentPathIds: ['led-forward-current']
  }, [
    {
      id: 'led-forward-current',
      kind: 'load-current',
      primitiveId: 'digital_on_off',
      label: 'LED forward current from an impossible pin',
      from: 'arduino-uno:D99',
      through: ['resistor-1', 'led-1'],
      to: 'arduino-uno:GND',
      expectedCurrentMa: 12,
      animation: { color: '#ff4d3d', speed: 0.82 }
    }
  ], renderPlan);

  assert.deepEqual(simulationPlan.currentPaths, []);
  assert.equal(simulationPlan.status, 'invalid');
  assert.ok(simulationPlan.warnings.some((warning) =>
    /SIMULATION_ENDPOINT_ANCHOR_MISSING|SIMULATION_VALIDATED_PATH_MISSING|D99/i.test(warning)
  ));
});

test('simulation plan blocks current paths that reference components missing from the render plan', async () => {
  const spec = ledCircuit();
  const validation = await validateCircuitSpec(spec);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, {
    ...validation,
    validatedCurrentPathIds: ['led-forward-current']
  }, [
    {
      id: 'led-forward-current',
      kind: 'load-current',
      primitiveId: 'digital_on_off',
      label: 'LED forward current through a missing render component',
      from: 'arduino-uno:D9',
      through: ['ghost-resistor', 'led-1'],
      to: 'arduino-uno:GND',
      expectedCurrentMa: 12,
      animation: { color: '#ff4d3d', speed: 0.82 }
    }
  ], renderPlan);
  const runnableReport = buildRunnableReport(validation, renderPlan, simulationPlan);

  assert.equal(simulationPlan.status, 'invalid');
  assert.deepEqual(simulationPlan.currentPaths, []);
  assert.ok(simulationPlan.warnings.some((warning) =>
    /SIMULATION_PATH_COMPONENT_MISSING|SIMULATION_VALIDATED_PATH_MISSING|ghost-resistor/i.test(warning)
  ));
  assert.equal(runnableReport.runnable, false);
  assert.equal(runnableReport.renderBlockingWarningCount, 0);
});

test('build runnable gate blocks valid simulations with no current or signal path', async () => {
  const spec = ledCircuit();
  const validation = await validateCircuitSpec(spec);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, {
    ...validation,
    validatedCurrentPathIds: []
  }, [], renderPlan);
  const runnableReport = buildRunnableReport(validation, renderPlan, simulationPlan);
  const markdown = await compileRequirementMarkdown(spec, validation, simulationPlan, runnableReport);

  assert.equal(validation.status, 'valid');
  assert.equal(renderPlan.parts.length > 0, true);
  assert.equal(simulationPlan.status, 'valid');
  assert.equal(simulationPlan.currentPaths.length, 0);
  assert.equal(runnableReport.status, 'blocked');
  assert.equal(runnableReport.runnable, false);
  assert.match(runnableReport.reasons.join('\n'), /no validated current or signal path/i);
  assert.match(markdown, /_Status: valid_/);
  assert.match(markdown, /_Simulation: valid_/);
  assert.match(markdown, /_Build runnable: blocked_/);
  assert.match(markdown, /No build-ready parts/i);
  assert.match(markdown, /No build-ready wiring/i);
  assert.match(markdown, /no validated current or signal path/i);
  assert.doesNotMatch(markdown, /arduino-uno:D9 -> resistor-1:1/);
});

test('solver gate exposes state-only review scenes when expected state evidence exists without build-ready', async () => {
  const spec = ledCircuit();
  const validation = await validateCircuitSpec(spec);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, {
    ...validation,
    validatedCurrentPathIds: []
  }, [], renderPlan);
  const runnableReport = buildRunnableReport(validation, renderPlan, simulationPlan);
  const solverGate = buildSolverGateResult(validation, renderPlan, simulationPlan, runnableReport);

  assert.equal(renderPlan.parts.length > 0, true);
  assert.equal(simulationPlan.currentPaths.length, 0);
  assert.equal(simulationPlan.expectedStates.length > 0, true);
  assert.equal(runnableReport.runnable, false);
  assert.equal(solverGate.visibleSimulation, true);
  assert.equal(solverGate.buildReady, false);
  assert.equal(solverGate.mode, 'diagnostic_simulation');
  assert.equal(solverGate.simulationActivity, 'state_only');
  assert.equal(solverGate.presentationAdjustment.kind, 'state_only');
  assert.equal(solverGate.buildReadyScope, 'none');
  assert.equal(solverGate.controls.runEnabled, false);
  assert.equal(solverGate.controls.currentAnimationEnabled, false);
  assert.equal(solverGate.controls.visualMoveEnabled, true);
  assert.ok(solverGate.safeToRenderEvidence.some((evidence) => /visible part/i.test(evidence)));
  assert.equal(solverGate.benchConfirmed, false);
  assert.ok(solverGate.verifiedClaims.some((claim) => /expected state/i.test(claim)));
  assert.ok(solverGate.notVerified.some((reason) => /build-ready/i.test(reason)));
});

test('invalid but renderable drafts produce diagnostic scenes without current-flow claims', async () => {
  const spec = ledCircuit();
  const validation = {
    ...await validateCircuitSpec(spec),
    status: 'invalid' as const,
    errors: ['manual invalid validation for diagnostic render coverage'],
    validatedCurrentPathIds: []
  };
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, [], renderPlan);
  const runnableReport = buildRunnableReport(validation, renderPlan, simulationPlan);
  const solverGate = buildSolverGateResult(validation, renderPlan, simulationPlan, runnableReport);

  assert.equal(renderPlan.parts.length > 0, true);
  assert.ok(renderPlan.warnings.some((warning) => warning.code === 'DIAGNOSTIC_RENDER_ONLY'));
  assert.equal(simulationPlan.status, 'invalid');
  assert.deepEqual(simulationPlan.currentPaths, []);
  assert.equal(runnableReport.runnable, false);
  assert.equal(solverGate.visibleSimulation, true);
  assert.equal(solverGate.buildReady, false);
  assert.equal(solverGate.simulationActivity, 'diagnostic');
  assert.ok(solverGate.notVerified.some((reason) => /validation status is invalid/i.test(reason)));
});

test('build runnable gate blocks forged valid simulations that omit validated path evidence', async () => {
  const spec = ledCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);
  const forgedSimulationPlan = {
    ...simulationPlan,
    currentPaths: []
  };
  const runnableReport = buildRunnableReport(validation, renderPlan, forgedSimulationPlan);

  assert.equal(simulationPlan.status, 'valid');
  assert.equal(forgedSimulationPlan.status, 'valid');
  assert.equal(runnableReport.status, 'blocked');
  assert.equal(runnableReport.runnable, false);
  assert.match(runnableReport.reasons.join('\n'), /SIMULATION_REQUIRED_EVIDENCE_MISSING|led-forward-current/);
});

test('requirement markdown hides current-flow details when runnable gate is blocked', async () => {
  const spec = ledCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);
  const blockedReport = {
    ...buildRunnableReport(validation, renderPlan, simulationPlan),
    status: 'blocked' as const,
    runnable: false,
    reasons: ['manual quality gate block for regression coverage']
  };
  const markdown = await compileRequirementMarkdown(spec, validation, simulationPlan, blockedReport);

  assert.equal(simulationPlan.status, 'valid');
  assert.equal(simulationPlan.currentPaths.length > 0, true);
  assert.match(markdown, /_Build runnable: blocked_/);
  assert.match(markdown, /Current-flow details are hidden/i);
  assert.doesNotMatch(markdown, /LED forward current/i);
  assert.doesNotMatch(markdown, /arduino-uno:D9.*arduino-uno:GND/i);
});

test('build runnable gate accepts state-only evidence when no current path is required', () => {
  const runnableReport = buildRunnableReport({
    version: '2026-06-01',
    status: 'valid',
    errors: [],
    warnings: [],
    validatedCurrentPathIds: [],
    sourceVersion: '2026-06-01'
  }, {
    title: 'State-only educational overlay',
    runText: 'STATE READY',
    parts: [{
      id: 'state-widget',
      type: 'display',
      label: 'State widget',
      description: 'State-only educational display surface.',
      pins: [],
      position: { x: 0, y: 0, z: 0 }
    }],
    connections: [],
    floatingCards: [],
    warnings: []
  }, {
    status: 'valid',
    runText: 'STATE READY',
    currentPaths: [],
    expectedStates: [{
      componentId: 'state-widget',
      state: 'showing educational state',
      primitiveId: 'display_sensor_value',
      explanation: 'State-only simulations can be runnable without animated current dots.'
    }],
    warnings: []
  });

  assert.equal(runnableReport.status, 'runnable');
  assert.equal(runnableReport.runnable, true);
  assert.equal(runnableReport.currentPathCount, 0);
  assert.equal(runnableReport.expectedStateCount, 1);
});

test('analog sensor display circuits require sensor signal paths before becoming runnable', async () => {
  const spec = soilMoistureDisplayCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);
  const runnableReport = buildRunnableReport(validation, renderPlan, simulationPlan);

  assert.equal(validation.status, 'valid');
  assert.equal(validation.electricalAnalysis?.topologyTemplateId, 'controller-analog-sensor-i2c-display');
  assert.ok(validation.validatedCurrentPathIds.includes('analog-sensor-supply-current:soil-1'));
  assert.ok(validation.validatedCurrentPathIds.includes('analog-sensor-analog-signal:soil-1'));
  assert.ok(validation.validatedCurrentPathIds.includes('analog-sensor-display-bus-activity:oled-display'));
  assert.equal(simulationPlan.status, 'valid');
  assert.ok(simulationPlan.currentPaths.some((path) => path.id === 'analog-sensor-supply-current:soil-1'));
  assert.ok(simulationPlan.currentPaths.some((path) => path.id === 'analog-sensor-analog-signal:soil-1'));
  assert.equal(runnableReport.status, 'runnable');

  const forgedSimulationPlan = await compileSimulationPlan(spec, {
    ...validation,
    validatedCurrentPathIds: ['oled-module-current']
  }, paths.filter((path) => path.id === 'oled-module-current'), renderPlan);

  assert.equal(forgedSimulationPlan.status, 'invalid');
  assert.match(forgedSimulationPlan.warnings.join('\n'), /SIMULATION_REQUIRED_PATH_MISSING/);
});

test('analog sensor threshold circuits validate the protected LED output path', async () => {
  const spec = rainSensorThresholdLedCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);

  assert.equal(validation.status, 'valid');
  assert.equal(validation.electricalAnalysis?.topologyTemplateId, 'controller-analog-sensor-threshold-output');
  assert.ok(validation.validatedCurrentPathIds.includes('analog-threshold-sensing-divider:rain-1'));
  assert.ok(validation.validatedCurrentPathIds.includes('analog-threshold-analog-signal:rain-1'));
  assert.ok(validation.validatedCurrentPathIds.includes('led-forward-current'));
  assert.equal(simulationPlan.status, 'valid');
  assert.ok(simulationPlan.currentPaths.some((path) => path.id === 'led-forward-current'));
});

test('resistive sensor display circuits require divider evidence before becoming runnable', async () => {
  const spec = fsrPressureDividerOledCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);
  const runnableReport = buildRunnableReport(validation, renderPlan, simulationPlan);

  assert.equal(validation.status, 'valid');
  assert.equal(validation.electricalAnalysis?.topologyTemplateId, 'controller-resistive-sensor-divider-i2c-display');
  assert.ok(validation.validatedCurrentPathIds.includes('resistive-sensor-divider-current:fsr-1'));
  assert.ok(validation.validatedCurrentPathIds.includes('resistive-sensor-analog-signal:fsr-1'));
  assert.ok(validation.validatedCurrentPathIds.includes('resistive-sensor-display-bus-activity:oled-display'));
  assert.equal(simulationPlan.status, 'valid');
  assert.ok(simulationPlan.currentPaths.some((path) => path.id === 'resistive-sensor-divider-current:fsr-1'));
  assert.ok(simulationPlan.currentPaths.some((path) => path.id === 'resistive-sensor-analog-signal:fsr-1'));
  assert.equal(runnableReport.status, 'runnable');
});

test('resistive sensor threshold circuits validate divider and protected output paths', async () => {
  const spec = thermistorThresholdLedCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);

  assert.equal(validation.status, 'valid');
  assert.equal(validation.electricalAnalysis?.topologyTemplateId, 'controller-resistive-sensor-divider-threshold-output');
  assert.ok(validation.validatedCurrentPathIds.includes('resistive-threshold-sensing-divider:thermistor-1'));
  assert.ok(validation.validatedCurrentPathIds.includes('resistive-threshold-analog-signal:thermistor-1'));
  assert.ok(validation.validatedCurrentPathIds.includes('led-forward-current'));
  assert.equal(simulationPlan.status, 'valid');
  assert.ok(simulationPlan.currentPaths.some((path) => path.id === 'resistive-threshold-sensing-divider:thermistor-1'));
  assert.ok(simulationPlan.currentPaths.some((path) => path.id === 'led-forward-current'));
});

test('resistive sensor validators reject missing fixed divider reference', async () => {
  const spec = fsrPressureDividerOledCircuit();
  const validation = await validateCircuitSpec(CircuitSpecSchema.parse({
    ...spec,
    id: 'fsr-display-missing-reference-resistor',
    components: spec.components.filter((component) => component.id !== 'divider-ref-1'),
    connections: spec.connections.filter((candidate) => !(
      candidate.from.componentId === 'divider-ref-1' ||
      candidate.to.componentId === 'divider-ref-1'
    ))
  }));

  assert.equal(validation.status, 'invalid');
  assert.match(validation.errors.join('\n'), /RESISTIVE_SENSOR_REFERENCE_RESISTOR_MISSING/);
  assert.match(validation.errors.join('\n'), /RESISTIVE_SENSOR_DIVIDER_GROUND_MISSING/);
});

test('digital input display circuits require input signal and display evidence', async () => {
  const spec = pirMotionDisplayCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);
  const runnableReport = buildRunnableReport(validation, renderPlan, simulationPlan);

  assert.equal(validation.status, 'valid');
  assert.equal(validation.electricalAnalysis?.topologyTemplateId, 'controller-digital-input-display');
  assert.ok(validation.validatedCurrentPathIds.includes('digital-input-supply-current:pir-1'));
  assert.ok(validation.validatedCurrentPathIds.includes('digital-input-signal:pir-1'));
  assert.ok(validation.validatedCurrentPathIds.includes('digital-input-display-bus-activity:oled-display'));
  assert.ok(validation.validatedCurrentPathIds.includes('oled-module-current'));
  assert.equal(simulationPlan.status, 'valid');
  assert.ok(simulationPlan.currentPaths.some((path) => path.id === 'digital-input-signal:pir-1'));
  assert.ok(simulationPlan.expectedStates.some((state) => state.primitiveId === 'digital_input_state'));
  assert.equal(runnableReport.status, 'runnable');
});

test('digital input output circuits keep input activity separate from LED load current', async () => {
  const spec = limitSwitchLedCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);

  assert.equal(validation.status, 'valid');
  assert.equal(validation.electricalAnalysis?.topologyTemplateId, 'controller-digital-input-output');
  assert.ok(validation.validatedCurrentPathIds.includes('digital-input-signal:limit-1'));
  assert.ok(validation.validatedCurrentPathIds.includes('led-forward-current'));
  assert.equal(simulationPlan.status, 'valid');
  assert.ok(simulationPlan.currentPaths.some((path) => path.id === 'digital-input-signal:limit-1'));
  assert.ok(simulationPlan.currentPaths.some((path) => path.id === 'led-forward-current'));
  assert.equal(
    simulationPlan.currentPaths.find((path) => path.id === 'digital-input-signal:limit-1')?.kind,
    'signal-activity'
  );
});

test('pulse digital sensor display circuits require pulse and control evidence', async () => {
  const spec = tcs3200DisplayCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);

  assert.equal(validation.status, 'valid');
  assert.equal(validation.electricalAnalysis?.topologyTemplateId, 'controller-pulse-digital-sensor-display');
  assert.ok(validation.validatedCurrentPathIds.includes('digital-input-supply-current:tcs-1'));
  assert.ok(validation.validatedCurrentPathIds.includes('pulse-digital-input-signal:tcs-1'));
  assert.ok(validation.validatedCurrentPathIds.includes('digital-input-display-bus-activity:oled-display'));
  assert.equal(simulationPlan.status, 'valid');
  assert.ok(simulationPlan.currentPaths.some((path) => path.id === 'pulse-digital-input-signal:tcs-1'));
});

test('matrix input display circuits validate, render, and expose key state paths', async () => {
  for (const { spec, expectedPaths } of [
    {
      spec: keypadDisplayCircuit(),
      expectedPaths: ['matrix-input-scan:keypad-1:R1', 'matrix-input-sense:keypad-1:C1']
    },
    {
      spec: dipSwitchDisplayCircuit(),
      expectedPaths: ['matrix-input-signal:dip-1:S1A', 'matrix-input-signal:dip-1:S4A']
    },
    {
      spec: membraneKeypadDisplayCircuit(),
      expectedPaths: ['matrix-input-signal:membrane-1:K1', 'matrix-input-signal:membrane-1:K4']
    }
  ]) {
    const validation = await validateCircuitSpec(spec);
    const netlist = await buildNetlist(spec);
    const paths = await estimateCurrentPaths(spec, netlist, validation);
    const renderPlan = await compileRenderPlan(spec, validation);
    const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);

    assert.equal(validation.status, 'valid', validation.errors.join('\n'));
    assert.equal(validation.electricalAnalysis?.topologyTemplateId, 'controller-matrix-input-display');
    for (const pathId of expectedPaths) {
      assert.ok(validation.validatedCurrentPathIds.includes(pathId), `${pathId} should be validated`);
      assert.ok(simulationPlan.currentPaths.some((path) => path.id === pathId), `${pathId} should render`);
    }
    assert.ok(validation.validatedCurrentPathIds.includes('matrix-input-display-bus-activity:oled-display'));
    assert.equal(simulationPlan.status, 'valid', simulationPlan.warnings.join('\n'));
    assert.ok(simulationPlan.expectedStates.some((state) => state.primitiveId === 'matrix_input_state'));
  }
});

test('joystick display circuits validate, render, and expose dual analog paths', async () => {
  const spec = joystickDisplayCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);

  assert.equal(validation.status, 'valid', validation.errors.join('\n'));
  assert.equal(validation.electricalAnalysis?.topologyTemplateId, 'controller-dual-analog-input-display');
  for (const pathId of [
    'joystick-supply-current:joystick-1',
    'joystick-x-analog-signal:joystick-1',
    'joystick-y-analog-signal:joystick-1',
    'joystick-switch-signal:joystick-1',
    'joystick-display-bus-activity:oled-display',
    'oled-module-current'
  ]) {
    assert.ok(validation.validatedCurrentPathIds.includes(pathId), `${pathId} should be validated`);
  }
  assert.equal(simulationPlan.status, 'valid', simulationPlan.warnings.join('\n'));
  assert.ok(simulationPlan.currentPaths.some((path) => path.id === 'joystick-y-analog-signal:joystick-1'));
  assert.ok(simulationPlan.expectedStates.some((state) => state.primitiveId === 'joystick_position_state'));
});

test('rotary encoder display circuits validate, render, and expose quadrature paths', async () => {
  const spec = rotaryEncoderDisplayCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);

  assert.equal(validation.status, 'valid', validation.errors.join('\n'));
  assert.equal(validation.electricalAnalysis?.topologyTemplateId, 'controller-quadrature-input-display');
  for (const pathId of [
    'rotary-encoder-supply-current:encoder-1',
    'rotary-encoder-clk-signal:encoder-1',
    'rotary-encoder-dt-signal:encoder-1',
    'rotary-encoder-switch-signal:encoder-1',
    'rotary-encoder-display-bus-activity:oled-display',
    'oled-module-current'
  ]) {
    assert.ok(validation.validatedCurrentPathIds.includes(pathId), `${pathId} should be validated`);
  }
  assert.equal(simulationPlan.status, 'valid', simulationPlan.warnings.join('\n'));
  assert.ok(simulationPlan.currentPaths.some((path) => path.id === 'rotary-encoder-dt-signal:encoder-1'));
  assert.ok(simulationPlan.expectedStates.some((state) => state.primitiveId === 'rotary_encoder_state'));
});

test('matrix, joystick, and rotary validators reject ambiguous reused pins', async () => {
  const duplicateKeypad = CircuitSpecSchema.parse({
    ...keypadDisplayCircuit(),
    id: 'keypad-display-duplicate-pin',
    connections: keypadDisplayCircuit().connections.map((candidate) =>
      candidate.id === 'keypad-c1-to-d6'
        ? connection(candidate.id, 'keypad-1', 'C1', 'arduino-uno', 'D2', 'digital')
        : candidate
    )
  });
  const floatingDip = CircuitSpecSchema.parse({
    ...dipSwitchDisplayCircuit(),
    id: 'dip-display-floating-reference',
    connections: dipSwitchDisplayCircuit().connections.filter((candidate) => candidate.id !== 'dip-s1-ref')
  });
  const duplicateJoystick = CircuitSpecSchema.parse({
    ...joystickDisplayCircuit(),
    id: 'joystick-display-duplicate-axis',
    connections: joystickDisplayCircuit().connections.map((candidate) =>
      candidate.id === 'joystick-y-to-a1'
        ? connection(candidate.id, 'joystick-1', 'VRY', 'arduino-uno', 'A0', 'analog')
        : candidate
    )
  });
  const duplicateRotary = CircuitSpecSchema.parse({
    ...rotaryEncoderDisplayCircuit(),
    id: 'rotary-display-duplicate-pin',
    connections: rotaryEncoderDisplayCircuit().connections.map((candidate) =>
      candidate.id === 'encoder-dt-to-d3'
        ? connection(candidate.id, 'encoder-1', 'DT', 'arduino-uno', 'D2', 'digital')
        : candidate
    )
  });

  const keypadValidation = await validateCircuitSpec(duplicateKeypad);
  const dipValidation = await validateCircuitSpec(floatingDip);
  const joystickValidation = await validateCircuitSpec(duplicateJoystick);
  const rotaryValidation = await validateCircuitSpec(duplicateRotary);

  assert.equal(keypadValidation.status, 'invalid');
  assert.match(keypadValidation.errors.join('\n'), /MATRIX_INPUT_LINES_NOT_DISTINCT/);
  assert.equal(dipValidation.status, 'invalid');
  assert.match(dipValidation.errors.join('\n'), /MATRIX_INPUT_REFERENCE_MISSING/);
  assert.equal(joystickValidation.status, 'invalid');
  assert.match(joystickValidation.errors.join('\n'), /JOYSTICK_AXIS_PINS_NOT_DISTINCT/);
  assert.equal(rotaryValidation.status, 'invalid');
  assert.match(rotaryValidation.errors.join('\n'), /ROTARY_ENCODER_PINS_NOT_DISTINCT/);
});

test('digital input validators reject floating passive switch inputs', async () => {
  const spec = limitSwitchLedCircuit();
  const validation = await validateCircuitSpec(CircuitSpecSchema.parse({
    ...spec,
    id: 'limit-switch-led-floating-input',
    connections: spec.connections.filter((candidate) => candidate.id !== 'limit-no-ground')
  }));

  assert.equal(validation.status, 'invalid');
  assert.match(validation.errors.join('\n'), /DIGITAL_INPUT_REFERENCE_MISSING/);
});

test('powered digital sensor validators reject missing module ground', async () => {
  const spec = pirMotionDisplayCircuit();
  const validation = await validateCircuitSpec(CircuitSpecSchema.parse({
    ...spec,
    id: 'pir-display-missing-ground',
    connections: spec.connections.filter((candidate) => candidate.id !== 'pir-ground')
  }));

  assert.equal(validation.status, 'invalid');
  assert.match(validation.errors.join('\n'), /DIGITAL_SENSOR_GROUND_MISSING|MISSING_COMMON_GROUND/);
});

test('analog sensor validators reject non-analog AO wiring', async () => {
  const spec = CircuitSpecSchema.parse({
    ...soilMoistureDisplayCircuit(),
    id: 'soil-moisture-display-bad-signal',
    connections: soilMoistureDisplayCircuit().connections.map((candidate) =>
      candidate.id === 'sensor-analog-to-a0'
        ? { ...candidate, signal: 'gpio' }
        : candidate
    )
  });
  const validation = await validateCircuitSpec(spec);

  assert.equal(validation.status, 'invalid');
  assert.match(validation.errors.join('\n'), /ANALOG_INPUT_SIGNAL_TYPE_INVALID/);
});

test('requirement markdown distinguishes signal activity from measured load current', async () => {
  const spec = servoCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, paths, renderPlan);
  const runnableReport = buildRunnableReport(validation, renderPlan, simulationPlan);
  const markdown = await compileRequirementMarkdown(spec, validation, simulationPlan, runnableReport);

  assert.match(markdown, /Servo supply current: about \d+(\.\d+)? mA/);
  assert.match(markdown, /Servo PWM signal activity: signal activity from arduino-uno:D9 to servo-1:SIG/);
  assert.doesNotMatch(markdown, /Servo PWM signal activity: about 0 mA/);
});

test('requirement markdown does not present invalid wiring as build ready', async () => {
  const spec = CircuitSpecSchema.parse({
    ...ledCircuit(),
    id: 'invalid-led-wiring-doc',
    connections: [
      connection('bad-controller-pin', 'arduino-uno', 'D99', 'resistor-1', '1', 'gpio'),
      connection('resistor-to-led', 'resistor-1', '2', 'led-1', 'A', 'gpio'),
      connection('led-to-ground', 'led-1', 'K', 'arduino-uno', 'GND', 'ground')
    ]
  });
  const validationReport = await validateCircuitSpec(spec);
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const simulationPlan = await compileSimulationPlan(spec, validationReport, [], renderPlan);
  const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);
  const markdown = await compileRequirementMarkdown(spec, validationReport, simulationPlan, runnableReport);

  assert.equal(validationReport.status, 'invalid');
  assert.match(markdown, /_Status: invalid_/);
  assert.match(markdown, /No build-ready parts/i);
  assert.match(markdown, /No build-ready wiring/i);
  assert.match(markdown, /UNKNOWN_PIN/i);
  assert.doesNotMatch(markdown, /arduino-uno:D99 -> resistor-1:1/);
  assert.doesNotMatch(markdown, /led-1:K -> arduino-uno:GND/);
});

test('simulation compilation without render DRC evidence cannot return valid current paths', async () => {
  const spec = ledCircuit();
  const validationReport = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
  const simulationPlan = await compileSimulationPlan(
    spec,
    validationReport,
    currentPaths,
    undefined as unknown as Awaited<ReturnType<typeof compileRenderPlan>>
  );

  assert.equal(validationReport.status, 'valid');
  assert.ok(currentPaths.length > 0);
  assert.equal(simulationPlan.status, 'invalid');
  assert.equal(simulationPlan.currentPaths.length, 0);
  assert.ok(simulationPlan.warnings.some((warning) => warning.includes('SIMULATION_RENDER_PLAN_REQUIRED')));
});

test('unsupported specs are explicit and produce diagnostic render without current simulation artifacts', async () => {
  const spec = unsupportedCircuit();
  const validationReport = await validateCircuitSpec(spec);
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const simulationPlan = await compileSimulationPlan(spec, validationReport, [], renderPlan);
  const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);
  const solverGate = buildSolverGateResult(validationReport, renderPlan, simulationPlan, runnableReport);

  assert.equal(validationReport.status, 'unsupported');
  assert.ok(spec.unsupportedItems.some((item) => /bluetooth|drone|gps/i.test(item)));
  assert.equal(renderPlan.parts.length > 0, true);
  assert.ok(renderPlan.warnings.some((warning) => warning.code === 'DIAGNOSTIC_RENDER_ONLY'));
  assert.equal(simulationPlan.status, 'unsupported');
  assert.equal(simulationPlan.currentPaths.length, 0);
  assert.equal(runnableReport.runnable, false);
  assert.equal(solverGate.visibleSimulation, true);
  assert.equal(solverGate.mode, 'diagnostic_simulation');
  assert.equal(solverGate.buildReady, false);
});

test('missing exact render footprints are exposed as placeholder simulations', async () => {
  const spec = CircuitSpecSchema.parse({
    id: 'unknown-part-placeholder',
    title: 'Unknown sensor placeholder',
    intent: {
      primaryGoal: 'show an unknown classroom sensor as a diagnostic placeholder',
      input: 'unknown sensor',
      output: 'diagnostic',
      controller: 'arduino-uno'
    },
    components: [
      { id: 'mystery-sensor', partId: 'mystery-sensor-9000', label: 'Mystery sensor', designator: 'S1' }
    ],
    connections: [],
    behavior: { runText: 'PLACEHOLDER' },
    assumptions: ['The part is outside the current canonical catalog.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
  const validationReport = await validateCircuitSpec(spec);
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const simulationPlan = await compileSimulationPlan(spec, validationReport, [], renderPlan);
  const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);
  const solverGate = buildSolverGateResult(validationReport, renderPlan, simulationPlan, runnableReport);

  assert.equal(validationReport.status, 'invalid');
  assert.match(validationReport.errors.join('\n'), /UNKNOWN_PART/);
  assert.equal(renderPlan.parts.length, 1);
  assert.ok(renderPlan.warnings.some((warning) => warning.code === 'MISSING_RENDER_FOOTPRINT'));
  assert.equal(simulationPlan.currentPaths.length, 0);
  assert.equal(runnableReport.runnable, false);
  assert.equal(solverGate.visibleSimulation, true);
  assert.equal(solverGate.mode, 'placeholder_part_simulation');
  assert.equal(solverGate.repairLevel, 'placeholder');
  assert.equal(solverGate.buildReady, false);
});

test('context coverage gate blocks otherwise valid circuits from final current simulation', async () => {
  const spec = ledCircuit();
  const validationReport = await validateCircuitSpec(spec);
  const gatedReport = applyContextCoverageGate(validationReport, {
    status: 'insufficient',
    score: 0.5,
    sufficientFor: ['clarification_response'],
    synthesisEligibility: {
      status: 'ineligible',
      reason: 'Missing verified context data required for circuit finalization.'
    },
    requiredSourceTypes: ['memory', 'policy', 'reference', 'data', 'registry', 'rendering'],
    presentSourceTypes: ['memory', 'policy', 'reference'],
    missingSourceTypes: ['data', 'registry', 'rendering'],
    warnings: ['Context support gap: soil-moisture is context-known but not simulation-ready.']
  });
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, gatedReport);
  const renderPlan = await compileRenderPlan(spec, gatedReport);
  const simulationPlan = await compileSimulationPlan(spec, gatedReport, currentPaths, renderPlan);
  const runnableReport = buildRunnableReport(gatedReport, renderPlan, simulationPlan);
  const markdown = await compileRequirementMarkdown(spec, gatedReport, simulationPlan, runnableReport);

  assert.equal(validationReport.status, 'valid');
  assert.equal(gatedReport.status, 'invalid');
  assert.match(gatedReport.errors.join('\n'), /CONTEXT_COVERAGE_INSUFFICIENT/);
  assert.equal(gatedReport.validatedCurrentPathIds.length, 0);
  assert.equal(renderPlan.parts.length > 0, true);
  assert.ok(renderPlan.warnings.some((warning) => warning.code === 'DIAGNOSTIC_RENDER_ONLY'));
  assert.equal(simulationPlan.currentPaths.length, 0);
  assert.equal(runnableReport.runnable, false);
  assert.match(markdown, /CONTEXT_COVERAGE_INSUFFICIENT/);
});

test('context coverage gate treats incomplete verified support data as synthesis-ineligible', async () => {
  const validationReport = await validateCircuitSpec(ledCircuit());
  const gatedReport = applyContextCoverageGate(validationReport, {
    status: 'insufficient',
    score: 1,
    sufficientFor: ['clarification_response', 'unsupported_response'],
    synthesisEligibility: {
      status: 'ineligible',
      reason: 'Missing verified support data for synthesis: digital-light-output.'
    },
    requiredSourceTypes: ['memory', 'policy', 'reference', 'data', 'registry', 'rendering'],
    presentSourceTypes: ['memory', 'policy', 'reference', 'data', 'registry', 'rendering'],
    missingSourceTypes: [],
    warnings: ['Verified support data gap: digital-light-output is missing verified source data: source-claims.']
  });

  assert.equal(validationReport.status, 'valid');
  assert.equal(gatedReport.status, 'invalid');
  assert.match(gatedReport.errors.join('\n'), /CONTEXT_COVERAGE_INSUFFICIENT/);
  assert.match(gatedReport.errors.join('\n'), /Verified support data gap/);
  assert.match(gatedReport.warnings.join('\n'), /Verified support data gap/);
});

test('context coverage gate blocks response-sufficient reports that are not synthesis-eligible', async () => {
  const spec = ledCircuit();
  const validationReport = await validateCircuitSpec(spec);
  const gatedReport = applyContextCoverageGate(validationReport, {
    status: 'sufficient',
    score: 1,
    requiredSourceTypes: ['memory', 'policy'],
    presentSourceTypes: ['memory', 'policy'],
    missingSourceTypes: [],
    warnings: [],
    sufficientFor: ['unsupported_response'],
    synthesisEligibility: {
      status: 'ineligible',
      reason: 'This request has only enough context for an unsupported response.'
    }
  });

  assert.equal(validationReport.status, 'valid');
  assert.equal(gatedReport.status, 'invalid');
  assert.match(gatedReport.errors.join('\n'), /CONTEXT_COVERAGE_INSUFFICIENT/);
  assert.equal(gatedReport.validatedCurrentPathIds.length, 0);
});

test('Deepagents validation tool is context-bound and returns gated validation', async () => {
  const allowed = await partCapabilities(['arduino-uno', 'breadboard-half', 'resistor-220', 'led-5mm']);
  const tools = createHeduwareAgentTools(scopedToolOptions({
    candidateParts: allowed,
    contextCoverage: {
      status: 'sufficient',
      score: 1,
      requiredSourceTypes: ['memory', 'policy'],
      presentSourceTypes: ['memory', 'policy'],
      missingSourceTypes: [],
      warnings: [],
      sufficientFor: ['unsupported_response'],
      synthesisEligibility: {
        status: 'ineligible',
        reason: 'This request has only enough context for an unsupported response.'
      }
    }
  }));
  const validateTool = tools.find((tool) => tool.name === 'validate_circuit_spec');
  assert.ok(validateTool, 'validate_circuit_spec tool exists');

  const rawOutput = await validateTool.invoke({ spec: ledCircuit() });
  const report = JSON.parse(String(rawOutput));

  assert.equal(report.status, 'invalid');
  assert.match(report.errors.join('\n'), /CONTEXT_COVERAGE_INSUFFICIENT/);
});

test('Deepagents detect_faults tool applies the same candidate part gate', async () => {
  const registry = await getPartRegistry();
  const allowed = ['arduino-uno', 'breadboard-half', 'led-5mm', 'resistor-220']
    .map((id) => registry.find((part) => part.id === id))
    .filter((part): part is PartCapability => Boolean(part));
  assert.equal(allowed.length, 4);

  const base = ledCircuit();
  const rogueSpec = {
    ...base,
    components: [
      ...base.components,
      { id: 'oled-display', partId: 'oled-i2c-096', label: 'Unrequested OLED display', designator: 'DISP1' }
    ]
  };
  const tools = createHeduwareAgentTools(scopedToolOptions({
    candidateParts: allowed
  }));
  const detectTool = tools.find((tool) => tool.name === 'detect_faults');
  assert.ok(detectTool, 'detect_faults tool exists');

  const rawOutput = await detectTool.invoke({ spec: rogueSpec });
  const report = JSON.parse(String(rawOutput));

  assert.equal(report.status, 'invalid');
  assert.match(report.errors.join('\n'), /CONTEXT_CANDIDATE_PART_NOT_ALLOWED/);
  assert.deepEqual(report.validatedCurrentPathIds, []);
});

test('Deepagents current path tool does not trust caller-supplied validation reports', async () => {
  const registry = await getPartRegistry();
  const allowed = ['arduino-uno', 'breadboard-half', 'led-5mm', 'resistor-220']
    .map((id) => registry.find((part) => part.id === id))
    .filter((part): part is PartCapability => Boolean(part));
  assert.equal(allowed.length, 4);

  const base = ledCircuit();
  const rogueSpec = {
    ...base,
    components: [
      ...base.components,
      { id: 'oled-display', partId: 'oled-i2c-096', label: 'Unrequested OLED display', designator: 'DISP1' }
    ]
  };
  const forgedValidationReport = {
    status: 'valid' as const,
    errors: [],
    warnings: [],
    validatedCurrentPathIds: ['led-forward-current']
  };
  const tools = createHeduwareAgentTools(scopedToolOptions({
    candidateParts: allowed
  }));
  const pathTool = tools.find((tool) => tool.name === 'estimate_current_paths');
  assert.ok(pathTool, 'estimate_current_paths tool exists');

  const rawOutput = await pathTool.invoke({
    spec: rogueSpec,
    validationReport: forgedValidationReport
  });
  const currentPaths = JSON.parse(String(rawOutput));

  assert.deepEqual(currentPaths, []);
});

test('Deepagents simulation tool returns runnable gate evidence with the simulation plan', async () => {
  const tools = createUnscopedHeduwareAgentToolsForTests();
  const simulationTool = tools.find((tool) => tool.name === 'compile_simulation_plan');
  assert.ok(simulationTool, 'compile_simulation_plan tool exists');

  const rawOutput = await simulationTool.invoke({ spec: ledCircuit() });
  const output = JSON.parse(String(rawOutput));

  assert.equal(output.simulationPlan.status, 'valid');
  assert.equal(output.buildRunnableReport.status, 'runnable');
  assert.equal(output.buildRunnableReport.runnable, true);
});

test('Deepagents netlist tool blocks route-outside components before exposing nets', async () => {
  const registry = await getPartRegistry();
  const allowed = ['arduino-uno', 'breadboard-half', 'led-5mm', 'resistor-220']
    .map((id) => registry.find((part) => part.id === id))
    .filter((part): part is PartCapability => Boolean(part));
  assert.equal(allowed.length, 4);

  const base = ledCircuit();
  const rogueSpec = CircuitSpecSchema.parse({
    ...base,
    components: [
      ...base.components,
      { id: 'oled-display', partId: 'oled-i2c-096', label: 'Unrequested OLED display', designator: 'DISP1' }
    ],
    connections: [
      ...base.connections,
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ]
  });
  const tools = createHeduwareAgentTools(scopedToolOptions({
    candidateParts: allowed
  }));
  const netlistTool = tools.find((tool) => tool.name === 'build_netlist');
  assert.ok(netlistTool, 'build_netlist tool exists');

  const rawOutput = await netlistTool.invoke({ spec: rogueSpec });
  const blocked = JSON.parse(String(rawOutput));

  assert.equal(blocked.error, 'NETLIST_BLOCKED_BY_VALIDATION');
  assert.match(blocked.validationReport.errors.join('\n'), /CONTEXT_CANDIDATE_PART_NOT_ALLOWED/);
  assert.deepEqual(blocked.netlist, { nets: [] });
});

test('Deepagents part search tool is bounded to context packet candidate parts', async () => {
  const registry = await getPartRegistry();
  const led = registry.find((part) => part.id === 'led-5mm');
  const resistor = registry.find((part) => part.id === 'resistor-220');
  assert.ok(led, 'LED registry entry exists');
  assert.ok(resistor, 'resistor registry entry exists');

  const tools = createHeduwareAgentTools(scopedToolOptions({
    candidateParts: [led, resistor]
  }));
  const searchTool = tools.find((tool) => tool.name === 'search_part_capabilities');
  assert.ok(searchTool, 'search_part_capabilities tool exists');

  const oledOutput = await searchTool.invoke({ query: 'OLED display module', limit: 8 });
  const oledMatches = JSON.parse(String(oledOutput)) as PartCapability[];
  assert.equal(oledMatches.some((part) => part.id === 'oled-i2c-096'), false);
  assert.equal(oledMatches.every((part) => ['led-5mm', 'resistor-220'].includes(part.id)), true);

  const ledOutput = await searchTool.invoke({ query: 'LED light', limit: 8 });
  const ledMatches = JSON.parse(String(ledOutput)) as PartCapability[];
  assert.deepEqual(ledMatches.map((part) => part.id), ['led-5mm']);
});

test('Deepagents context document tool is bounded to retrieval plan source ids', async () => {
  const tools = createHeduwareAgentTools(scopedToolOptions({
    allowedContextSourceIds: ['policy:safety-policy']
  }));
  const readTool = tools.find((tool) => tool.name === 'read_context_doc');
  assert.ok(readTool, 'read_context_doc tool exists');

  const allowedOutput = await readTool.invoke({ id: 'safety-policy' });
  assert.match(String(allowedOutput), /high-voltage|safety|mains/i);

  const blockedOutput = await readTool.invoke({ id: 'rendering-footprints' });
  const blocked = JSON.parse(String(blockedOutput));
  assert.equal(blocked.error, 'CONTEXT_DOC_NOT_IN_RETRIEVAL_PLAN');
  assert.equal(blocked.requestedId, 'rendering-footprints');
  assert.deepEqual(blocked.allowedSourceIds, ['policy:safety-policy']);
});

test('Deepagents context tool can read selected v2 bundle summary but not unselected bundles', async () => {
  const tools = createHeduwareAgentTools(scopedToolOptions({
    allowedContextSourceIds: ['bundle:digital-light-output']
  }));
  const readTool = tools.find((tool) => tool.name === 'read_context_doc');
  assert.ok(readTool);

  const allowed = await readTool.invoke({ id: 'bundle:digital-light-output' });
  assert.match(String(allowed), /Digital Light Output/);
  assert.match(String(allowed), /allowedParts=.*led-5mm/);

  const blocked = await readTool.invoke({ id: 'bundle:display-text-output' });
  assert.match(String(blocked), /CONTEXT_DOC_NOT_IN_RETRIEVAL_PLAN/);
});

test('Deepagents support bundle tool is bounded to current capability matches', async () => {
  const tools = createHeduwareAgentTools(scopedToolOptions({
    supportBundles: [{
      capabilityId: 'digital-light-output',
      bundleId: 'digital-light-output-starter',
      supportLevel: 'supported',
      status: 'complete',
      requiredParts: ['arduino-uno', 'breadboard-half', 'led-5mm', 'resistor-220'],
      requiredArtifacts: ['source-claims'],
      presentArtifacts: ['source-claims'],
      missingArtifacts: [],
      sourceClaimIds: ['arduino-uno-rev3-io-current-20ma'],
      sourceTiers: ['manufacturer-official'],
      promptSummary: 'digital-light-output has complete verified hardware support data.'
    }]
  }));
  const bundleTool = tools.find((tool) => tool.name === 'load_support_bundle_evidence');
  assert.ok(bundleTool, 'load_support_bundle_evidence tool should exist');

  const allowed = await bundleTool.invoke({ capabilityId: 'digital-light-output' });
  assert.match(String(allowed), /digital-light-output-starter/);

  const blocked = await bundleTool.invoke({ capabilityId: 'display-text-output' });
  const parsed = JSON.parse(String(blocked));
  assert.equal(parsed.error, 'SUPPORT_BUNDLE_NOT_IN_CONTEXT');
  assert.deepEqual(parsed.allowedCapabilityIds, ['digital-light-output']);
});

type LoadedCapabilityGraph = Awaited<ReturnType<typeof loadCapabilityGraph>>;

async function selectedTopologyId(graph: LoadedCapabilityGraph, capabilityIds: string[]) {
  const capabilities = graph.filter((capability) => capabilityIds.includes(capability.id));
  const template = await selectTopologyTemplate({ capabilities });
  return template?.id ?? null;
}

function agentDraft(assistantMessage: string, circuitSpec: CircuitSpec) {
  return {
    assistantMessage,
    clarification: null,
    circuitSpec,
    agentEvents: []
  };
}

function validRenderOnlyReport() {
  return {
    version: '2026-05-31',
    status: 'valid' as const,
    errors: [],
    warnings: [],
    validatedCurrentPathIds: [],
    sourceVersion: '2026-05-31'
  };
}

function hasOverlappingFootprints(parts: Array<NonNullable<Awaited<ReturnType<typeof compileRenderPlan>>['parts'][number]>>) {
  for (let i = 0; i < parts.length; i += 1) {
    for (let j = i + 1; j < parts.length; j += 1) {
      if (footprintsOverlap(parts[i], parts[j])) {
        return true;
      }
    }
  }
  return false;
}

function footprintsOverlap(
  left: Awaited<ReturnType<typeof compileRenderPlan>>['parts'][number],
  right: Awaited<ReturnType<typeof compileRenderPlan>>['parts'][number]
) {
  if (!left.footprint || !right.footprint) {
    return false;
  }
  const gap = 0.03;
  const leftBounds = testFootprintBounds(left);
  const rightBounds = testFootprintBounds(right);
  return leftBounds.minX < rightBounds.maxX + gap
    && leftBounds.maxX + gap > rightBounds.minX
    && leftBounds.minZ < rightBounds.maxZ + gap
    && leftBounds.maxZ + gap > rightBounds.minZ;
}

function testFootprintBounds(part: Awaited<ReturnType<typeof compileRenderPlan>>['parts'][number]) {
  const footprint = part.footprint;
  assert.ok(footprint, `${part.id} should have a footprint`);
  return {
    minX: part.position.x - footprint.width / 2,
    maxX: part.position.x + footprint.width / 2,
    minZ: part.position.z - footprint.depth / 2,
    maxZ: part.position.z + footprint.depth / 2
  };
}

function endpointSnapsToSignalGrid(
  endpoint: { x: number; y: number; z: number } | undefined,
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
) {
  if (!endpoint) {
    return false;
  }

  const nearestX = nearestGridValue(endpoint.x, grid.signalArea.xStart, grid.signalArea.xEnd, grid.signalArea.xPitch);
  const nearestRow = grid.signalArea.rows.reduce((best, row) => {
    const distance = Math.abs(endpoint.z - row.z);
    return distance < best.distance ? { distance, z: row.z } : best;
  }, { distance: Number.POSITIVE_INFINITY, z: 0 });

  return Math.abs(endpoint.x - nearestX) <= grid.signalArea.snapTolerance.x
    && Math.abs(endpoint.z - nearestRow.z) <= grid.signalArea.snapTolerance.z;
}

function nearestGridValue(value: number, start: number, end: number, pitch: number) {
  const clamped = Math.max(start, Math.min(end, value));
  const steps = Math.round((clamped - start) / pitch);
  return Number((start + steps * pitch).toFixed(6));
}

function hiddenNodeConflictParts(): Awaited<ReturnType<typeof compileRenderPlan>>['parts'] {
  return [
    {
      id: 'led-1',
      type: 'led',
      label: 'LED',
      description: 'LED',
      designator: 'D1',
      pins: [],
      position: { x: -0.07, y: 0.25, z: -0.3 },
      footprint: {
        type: 'led',
        width: 0.3,
        depth: 0.3,
        height: 0.5,
        visualStyle: { shape: 'led', color: '#ff5b59', material: 'test' },
        pinAnchors: {
          A: { x: -0.14, y: 0.05, z: -0.12, role: 'anode', label: 'A' },
          K: { x: 0.14, y: 0.05, z: 0.12, role: 'cathode', label: 'K' }
        },
        labelAnchor: { x: 0, y: 0.58, z: 0 },
        placement: {
          allowedSurfaces: ['breadboard'],
          breadboardCompatible: true,
          defaultOrientation: 'legs-down',
          notes: []
        },
        simulationOverlayAnchors: [{ id: 'led-current', anchor: 'A', role: 'current-overlay' }],
        hoverTargets: []
      }
    },
    {
      id: 'button-1',
      type: 'button',
      label: 'Button',
      description: 'Button',
      designator: 'SW1',
      pins: [],
      position: { x: -0.35, y: 0.25, z: -0.2 },
      footprint: {
        type: 'button',
        width: 0.5,
        depth: 0.5,
        height: 0.2,
        visualStyle: { shape: 'button', color: '#353a44', material: 'test' },
        pinAnchors: {
          A: { x: -0.14, y: 0.08, z: 0.22, role: 'switch-terminal', label: 'A' },
          B: { x: 0.14, y: 0.08, z: -0.22, role: 'switch-terminal', label: 'B' }
        },
        labelAnchor: { x: 0, y: 0.32, z: 0 },
        placement: {
          allowedSurfaces: ['breadboard'],
          breadboardCompatible: true,
          defaultOrientation: 'straddles-gap',
          notes: []
        },
        simulationOverlayAnchors: [{ id: 'button-signal', anchor: 'A', role: 'signal-overlay' }],
        hoverTargets: []
      }
    }
  ];
}

function rowContinuityConflictParts(): Awaited<ReturnType<typeof compileRenderPlan>>['parts'] {
  return hiddenNodeConflictParts().map((part) => part.id === 'button-1'
    ? { ...part, position: { x: -0.35, y: 0.25, z: 0 } }
    : part);
}

function railContinuityConflictParts(): Awaited<ReturnType<typeof compileRenderPlan>>['parts'] {
  return hiddenNodeConflictParts().map((part) => {
    if (part.id === 'led-1') {
      return { ...part, position: { x: -2.06, y: 0.25, z: -0.7 } };
    }
    if (part.id === 'button-1') {
      return { ...part, position: { x: -1.6, y: 0.25, z: -0.6 } };
    }
    return part;
  });
}

function baseComponents(extra: CircuitSpec['components']): CircuitSpec['components'] {
  return [
    { id: 'breadboard', partId: 'breadboard-half', label: 'Half-size breadboard', designator: 'BB1' },
    { id: 'arduino-uno', partId: 'arduino-uno', label: 'Arduino Uno', designator: 'U1' },
    ...extra
  ];
}

function oledCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'oled-text',
    title: 'OLED text display',
    intent: { primaryGoal: 'show text on an OLED screen', output: 'display', controller: 'arduino-uno' },
    components: baseComponents([
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'HELLO H-EDUWARE' },
    assumptions: ['The OLED module uses a four-pin I2C layout.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function lcdTextDisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'lcd-text',
    title: 'LCD text display',
    intent: { primaryGoal: 'show text on a 16x2 LCD display', output: 'display', controller: 'arduino-uno' },
    components: baseComponents([
      { id: 'lcd-display', partId: 'lcd-16x2', label: '16x2 I2C LCD character display', designator: 'LCD1' }
    ]),
    connections: [
      connection('lcd-power', 'arduino-uno', '5V', 'lcd-display', 'VCC', 'power'),
      connection('lcd-ground', 'arduino-uno', 'GND', 'lcd-display', 'GND', 'ground'),
      connection('lcd-sda', 'arduino-uno', 'A4/SDA', 'lcd-display', 'SDA', 'i2c-data'),
      connection('lcd-scl', 'arduino-uno', 'A5/SCL', 'lcd-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'HELLO LCD' },
    assumptions: ['The LCD module uses a four-pin I2C backpack layout.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function oledCircuitThroughBreadboardRail(): CircuitSpec {
  return CircuitSpecSchema.parse({
    ...oledCircuit(),
    id: 'oled-text-rail-ground',
    title: 'OLED text display with breadboard ground rail',
    connections: [
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('arduino-ground-to-rail', 'arduino-uno', 'GND', 'breadboard', '- rail', 'ground'),
      connection('oled-ground-to-rail', 'oled-display', 'GND', 'breadboard', '- rail', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ]
  });
}

function ledCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'led-blinker',
    title: 'LED blinker',
    intent: { primaryGoal: 'blink an LED with a resistor', output: 'led', controller: 'arduino-uno' },
    components: baseComponents([
      { id: 'resistor-1', partId: 'resistor-220', label: '220 ohm resistor', designator: 'R1' },
      { id: 'led-1', partId: 'led-5mm', label: 'LED', designator: 'D1' }
    ]),
    connections: [
      connection('d9-to-resistor', 'arduino-uno', 'D9', 'resistor-1', '1', 'gpio'),
      connection('resistor-to-led', 'resistor-1', '2', 'led-1', 'A', 'gpio'),
      connection('led-to-ground', 'led-1', 'K', 'arduino-uno', 'GND', 'ground')
    ],
    behavior: { runText: 'LED ON' },
    assumptions: ['A 220 ohm resistor limits LED current.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function ledCircuitWithoutResistor(): CircuitSpec {
  const spec = ledCircuit();
  return CircuitSpecSchema.parse({
    ...spec,
    components: spec.components.filter((component) => component.partId !== 'resistor-220'),
    connections: spec.connections.filter((candidate) => !(
      candidate.from.componentId === 'resistor-1' ||
      candidate.to.componentId === 'resistor-1'
    ))
  });
}

function buttonLedCircuit(): CircuitSpec {
  const spec = ledCircuit();
  return CircuitSpecSchema.parse({
    ...spec,
    id: 'button-led',
    title: 'Button controlled LED',
    intent: { primaryGoal: 'turn on an LED when a button is pressed', input: 'button', output: 'led', controller: 'arduino-uno' },
    components: [
      ...spec.components,
      { id: 'button-1', partId: 'button-tactile', label: 'Tactile pushbutton', designator: 'SW1' }
    ],
    connections: [
      ...spec.connections,
      connection('d2-to-button', 'arduino-uno', 'D2', 'button-1', 'A', 'button'),
      connection('button-to-ground', 'button-1', 'B', 'arduino-uno', 'GND', 'ground')
    ],
    behavior: { runText: 'BUTTON -> LED' }
  });
}

function buttonLedCircuitWithHiddenPhysicalConflict(): CircuitSpec {
  const spec = buttonLedCircuit();
  return CircuitSpecSchema.parse({
    ...spec,
    id: 'button-led-hidden-physical-conflict',
    title: 'Button LED with hidden physical conflict',
    components: spec.components.map((component) => {
      if (component.id === 'led-1') {
        return { ...component, position: { x: -0.07, y: 0.25, z: -0.3 } };
      }
      if (component.id === 'button-1') {
        return { ...component, position: { x: -0.35, y: 0.25, z: -0.2 } };
      }
      return component;
    })
  });
}

function buttonLedCircuitWithHiddenContinuityConflict(): CircuitSpec {
  const spec = buttonLedCircuit();
  return CircuitSpecSchema.parse({
    ...spec,
    id: 'button-led-hidden-continuity-conflict',
    title: 'Button LED with hidden continuity conflict',
    components: spec.components.map((component) => {
      if (component.id === 'led-1') {
        return { ...component, position: { x: -0.07, y: 0.25, z: -0.3 } };
      }
      if (component.id === 'button-1') {
        return { ...component, position: { x: -0.35, y: 0.25, z: 0 } };
      }
      return component;
    })
  });
}

function buttonLedCircuitWithHiddenRailConflict(): CircuitSpec {
  const spec = buttonLedCircuit();
  return CircuitSpecSchema.parse({
    ...spec,
    id: 'button-led-hidden-rail-conflict',
    title: 'Button LED with hidden rail conflict',
    components: spec.components.map((component) => {
      if (component.id === 'led-1') {
        return { ...component, position: { x: -2.06, y: 0.25, z: -0.7 } };
      }
      if (component.id === 'button-1') {
        return { ...component, position: { x: -1.6, y: 0.25, z: -0.6 } };
      }
      return component;
    })
  });
}

function potentiometerLedDimmerCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'potentiometer-led-dimmer',
    title: 'Potentiometer LED dimmer',
    intent: {
      primaryGoal: 'control LED brightness with a potentiometer',
      input: 'potentiometer',
      output: 'led',
      controller: 'arduino-uno',
      behavior: 'knob controls LED brightness'
    },
    components: baseComponents([
      { id: 'pot-1', partId: 'potentiometer-10k', label: '10k potentiometer', designator: 'RV1' },
      { id: 'resistor-1', partId: 'resistor-220', label: '220 ohm resistor', designator: 'R1' },
      { id: 'led-1', partId: 'led-5mm', label: 'LED', designator: 'D1' }
    ]),
    connections: [
      connection('pot-power', 'arduino-uno', '5V', 'pot-1', 'VCC', 'power'),
      connection('pot-ground', 'arduino-uno', 'GND', 'pot-1', 'GND', 'ground'),
      connection('pot-output-to-a0', 'pot-1', 'OUT', 'arduino-uno', 'A0', 'analog'),
      connection('d9-to-resistor', 'arduino-uno', 'D9', 'resistor-1', '1', 'pwm'),
      connection('resistor-to-led', 'resistor-1', '2', 'led-1', 'A', 'gpio'),
      connection('led-to-ground', 'led-1', 'K', 'arduino-uno', 'GND', 'ground')
    ],
    behavior: { runText: 'KNOB -> PWM LED BRIGHTNESS' },
    assumptions: [
      'The potentiometer output is read on Arduino A0.',
      'Arduino PWM pin D9 drives the LED brightness through a 220 ohm resistor.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function trimmerPotLedDimmerCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'trimmer-pot-led-dimmer',
    title: 'Trimmer potentiometer LED dimmer',
    intent: {
      primaryGoal: 'control LED brightness with a trimmer potentiometer',
      input: 'trimmer potentiometer',
      output: 'led',
      controller: 'arduino-uno',
      behavior: 'trim setting controls LED brightness'
    },
    components: baseComponents([
      { id: 'trim-1', partId: 'trimmer-pot', label: 'Trimmer potentiometer', designator: 'RV1' },
      { id: 'resistor-1', partId: 'resistor-220', label: '220 ohm resistor', designator: 'R1' },
      { id: 'led-1', partId: 'led-5mm', label: 'LED', designator: 'D1' }
    ]),
    connections: [
      connection('trim-power', 'arduino-uno', '5V', 'trim-1', 'A', 'power'),
      connection('trim-ground', 'arduino-uno', 'GND', 'trim-1', 'B', 'ground'),
      connection('trim-wiper-to-a0', 'trim-1', 'W', 'arduino-uno', 'A0', 'analog'),
      connection('d9-to-resistor', 'arduino-uno', 'D9', 'resistor-1', '1', 'pwm'),
      connection('resistor-to-led', 'resistor-1', '2', 'led-1', 'A', 'gpio'),
      connection('led-to-ground', 'led-1', 'K', 'arduino-uno', 'GND', 'ground')
    ],
    behavior: { runText: 'TRIM -> PWM LED BRIGHTNESS' },
    assumptions: [
      'The trimmer potentiometer W wiper is read on Arduino A0.',
      'Arduino PWM pin D9 drives the LED brightness through a 220 ohm resistor.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function ldrDarkLedCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'ldr-dark-led',
    title: 'Photoresistor dark-triggered LED',
    intent: {
      primaryGoal: 'turn on an LED when a photoresistor says the room is dark',
      input: 'photoresistor',
      output: 'led',
      controller: 'arduino-uno',
      behavior: 'dark threshold turns LED on'
    },
    components: baseComponents([
      { id: 'ldr-1', partId: 'photoresistor-ldr', label: 'Photoresistor LDR module', designator: 'LDR1' },
      { id: 'resistor-1', partId: 'resistor-220', label: '220 ohm resistor', designator: 'R1' },
      { id: 'led-1', partId: 'led-5mm', label: 'LED', designator: 'D1' }
    ]),
    connections: [
      connection('ldr-power', 'arduino-uno', '5V', 'ldr-1', 'VCC', 'power'),
      connection('ldr-ground', 'arduino-uno', 'GND', 'ldr-1', 'GND', 'ground'),
      connection('ldr-analog-to-a0', 'ldr-1', 'AO', 'arduino-uno', 'A0', 'analog'),
      connection('d9-to-resistor', 'arduino-uno', 'D9', 'resistor-1', '1', 'gpio'),
      connection('resistor-to-led', 'resistor-1', '2', 'led-1', 'A', 'gpio'),
      connection('led-to-ground', 'led-1', 'K', 'arduino-uno', 'GND', 'ground')
    ],
    behavior: { runText: 'DARK THRESHOLD -> LED ON' },
    assumptions: [
      'The photoresistor module output is read on Arduino A0.',
      'When the measured light falls below the threshold, Arduino D9 drives the LED through a 220 ohm resistor.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function ultrasonicDistanceDisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'ultrasonic-distance-display',
    title: 'Ultrasonic distance on OLED',
    intent: {
      primaryGoal: 'show HC-SR04 distance on an OLED display',
      input: 'ultrasonic distance sensor',
      output: 'OLED distance readout',
      controller: 'arduino-uno',
      behavior: 'measure distance and display centimeters'
    },
    components: baseComponents([
      { id: 'ultrasonic-1', partId: 'ultrasonic-hc-sr04', label: 'HC-SR04 ultrasonic distance sensor', designator: 'US1' },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('sensor-power', 'arduino-uno', '5V', 'ultrasonic-1', 'VCC', 'power'),
      connection('sensor-ground', 'arduino-uno', 'GND', 'ultrasonic-1', 'GND', 'ground'),
      connection('sensor-trigger', 'arduino-uno', 'D3', 'ultrasonic-1', 'TRIG', 'gpio'),
      connection('sensor-echo', 'ultrasonic-1', 'ECHO', 'arduino-uno', 'D2', 'gpio'),
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'DISTANCE: 42 CM' },
    assumptions: [
      'The HC-SR04 is powered from Arduino 5V and shares ground with the OLED.',
      'Arduino D3 sends the trigger pulse and D2 reads the echo pulse.',
      'The OLED shows a simplified educational distance readout.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function dht11TemperatureHumidityDisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'dht11-temperature-humidity-display',
    title: 'DHT11 temperature and humidity on OLED',
    intent: {
      primaryGoal: 'show DHT11 temperature and humidity on an OLED display',
      input: 'DHT11 temperature humidity sensor',
      output: 'OLED temperature and humidity readout',
      controller: 'arduino-uno',
      behavior: 'read DHT11 data and display temperature/humidity'
    },
    components: baseComponents([
      { id: 'dht11-1', partId: 'dht11', label: 'DHT11 temperature and humidity sensor', designator: 'S1' },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('sensor-power', 'arduino-uno', '5V', 'dht11-1', 'VCC', 'power'),
      connection('sensor-ground', 'arduino-uno', 'GND', 'dht11-1', 'GND', 'ground'),
      connection('sensor-data', 'dht11-1', 'DAT', 'arduino-uno', 'D2', 'single-wire-data'),
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'TEMP: 24C HUM: 45%' },
    assumptions: [
      'The DHT11 is powered from Arduino 5V and shares ground with the OLED.',
      'Arduino D2 reads the DHT11 DAT single-wire data line in the educational simulation.',
      'The OLED shows a simplified temperature and humidity readout.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function dht22TemperatureHumidityDisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'dht22-temperature-humidity-display',
    title: 'DHT22 temperature and humidity on OLED',
    intent: {
      primaryGoal: 'show DHT22 temperature and humidity on an OLED display',
      input: 'DHT22 temperature humidity sensor',
      output: 'OLED temperature and humidity readout',
      controller: 'arduino-uno',
      behavior: 'read DHT22 data and display temperature/humidity'
    },
    components: baseComponents([
      { id: 'dht22-1', partId: 'dht22', label: 'DHT22 temperature and humidity sensor', designator: 'S1' },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('sensor-power', 'arduino-uno', '5V', 'dht22-1', 'VCC', 'power'),
      connection('sensor-ground', 'arduino-uno', 'GND', 'dht22-1', 'GND', 'ground'),
      connection('sensor-data', 'dht22-1', 'DAT', 'arduino-uno', 'D2', 'single-wire-data'),
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'TEMP: 24C HUM: 45%' },
    assumptions: [
      'The DHT22 is powered from Arduino 5V and shares ground with the OLED.',
      'Arduino D2 reads the DHT22 DAT single-wire data line in the educational simulation.',
      'The OLED shows a simplified temperature and humidity readout.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

type I2cProtocolSensorPartId = 'bmp280' | 'mpu6050' | 'hmc5883l' | 'max30102-pulse';

const I2C_PROTOCOL_SENSOR_FIXTURES: Record<I2cProtocolSensorPartId, {
  componentId: string;
  label: string;
  designator: string;
  powerPin: string;
  runText: string;
  input: string;
}> = {
  bmp280: {
    componentId: 'bmp280-1',
    label: 'BMP280 pressure and temperature sensor',
    designator: 'S1',
    powerPin: 'VCC',
    runText: 'PRESSURE: 1008 HPA TEMP: 24C',
    input: 'BMP280 pressure and temperature sensor'
  },
  mpu6050: {
    componentId: 'mpu6050-1',
    label: 'MPU-6050 accelerometer and gyroscope module',
    designator: 'S1',
    powerPin: 'VCC',
    runText: 'TILT: LEVEL ACCEL: LOW',
    input: 'MPU-6050 motion sensor'
  },
  hmc5883l: {
    componentId: 'hmc5883l-1',
    label: 'HMC5883L compass sensor module',
    designator: 'S1',
    powerPin: 'VCC',
    runText: 'HEADING: 90 DEG',
    input: 'HMC5883L compass sensor'
  },
  'max30102-pulse': {
    componentId: 'max30102-1',
    label: 'MAX30102 optical pulse sensor module',
    designator: 'S1',
    powerPin: 'VIN',
    runText: 'PULSE SIGNAL: PRESENT',
    input: 'MAX30102 optical pulse sensor'
  }
};

function i2cProtocolSensorDisplayCircuit(partId: I2cProtocolSensorPartId): CircuitSpec {
  const fixture = I2C_PROTOCOL_SENSOR_FIXTURES[partId];
  return CircuitSpecSchema.parse({
    id: `${partId}-display-readout`,
    title: `${fixture.label} on OLED`,
    intent: {
      primaryGoal: `show ${fixture.input} value on an OLED display`,
      input: fixture.input,
      output: 'OLED qualitative sensor readout',
      controller: 'arduino-uno',
      behavior: 'read the I2C sensor and display a qualitative value'
    },
    components: baseComponents([
      { id: fixture.componentId, partId, label: fixture.label, designator: fixture.designator },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('sensor-power', 'arduino-uno', '5V', fixture.componentId, fixture.powerPin, 'power'),
      connection('sensor-ground', 'arduino-uno', 'GND', fixture.componentId, 'GND', 'ground'),
      connection('sensor-sda', fixture.componentId, 'SDA', 'arduino-uno', 'A4/SDA', 'i2c-data'),
      connection('sensor-scl', fixture.componentId, 'SCL', 'arduino-uno', 'A5/SCL', 'i2c-clock'),
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: fixture.runText },
    assumptions: [
      'The sensor shares the I2C bus with the OLED display.',
      'The simulated value is qualitative classroom feedback, not calibrated instrumentation.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function clockedDataProtocolSensorDisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'hx711-loadcell-display-readout',
    title: 'HX711 load cell readout on OLED',
    intent: {
      primaryGoal: 'show a qualitative HX711 load cell value on an OLED display',
      input: 'HX711 load cell amplifier module',
      output: 'OLED qualitative load readout',
      controller: 'arduino-uno',
      behavior: 'read the clocked-data sensor and display a qualitative load value'
    },
    components: baseComponents([
      { id: 'hx711-1', partId: 'hx711-loadcell', label: 'HX711 load cell amplifier module', designator: 'S1' },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('sensor-power', 'arduino-uno', '5V', 'hx711-1', 'VCC', 'power'),
      connection('sensor-ground', 'arduino-uno', 'GND', 'hx711-1', 'GND', 'ground'),
      connection('sensor-data', 'hx711-1', 'DT', 'arduino-uno', 'D2', 'clocked-data'),
      connection('sensor-clock', 'arduino-uno', 'D3', 'hx711-1', 'SCK', 'clocked-data'),
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'LOAD: LIGHT' },
    assumptions: ['The HX711 display is a qualitative classroom load readout, not a calibrated scale.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function spiProtocolSensorDisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'rc522-rfid-display-readout',
    title: 'RC522 RFID tag readout on OLED',
    intent: {
      primaryGoal: 'show a qualitative RC522 RFID tag read event on an OLED display',
      input: 'RC522 RFID reader module',
      output: 'OLED qualitative tag readout',
      controller: 'arduino-uno',
      behavior: 'read the SPI RFID module and display a qualitative tag state'
    },
    components: baseComponents([
      { id: 'rc522-1', partId: 'rc522-rfid', label: 'RC522 RFID reader module', designator: 'S1' },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('sensor-power', 'arduino-uno', '3V3', 'rc522-1', '3V3', 'power'),
      connection('sensor-ground', 'arduino-uno', 'GND', 'rc522-1', 'GND', 'ground'),
      connection('sensor-sck', 'arduino-uno', 'D13', 'rc522-1', 'SCK', 'spi'),
      connection('sensor-mosi', 'arduino-uno', 'D11', 'rc522-1', 'MOSI', 'spi'),
      connection('sensor-miso', 'rc522-1', 'MISO', 'arduino-uno', 'D12', 'spi'),
      connection('sensor-cs', 'arduino-uno', 'D10', 'rc522-1', 'CS', 'spi'),
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'TAG READ: YES' },
    assumptions: ['The RC522 readout is a qualitative classroom tag-detection demo, not access control or security.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function uartProtocolSensorDisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'gps-neo6m-display-readout',
    title: 'NEO-6M GPS coordinate readout on OLED',
    intent: {
      primaryGoal: 'show a qualitative NEO-6M GPS coordinate value on an OLED display',
      input: 'NEO-6M GPS module',
      output: 'OLED qualitative coordinate readout',
      controller: 'arduino-uno',
      behavior: 'read the UART GPS module and display a qualitative coordinate value'
    },
    components: baseComponents([
      { id: 'gps-1', partId: 'gps-neo6m', label: 'NEO-6M GPS receiver module', designator: 'S1' },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('sensor-power', 'arduino-uno', '5V', 'gps-1', 'VCC', 'power'),
      connection('sensor-ground', 'arduino-uno', 'GND', 'gps-1', 'GND', 'ground'),
      connection('sensor-tx', 'gps-1', 'TX', 'arduino-uno', 'D0/RX', 'uart'),
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'GPS FIX: DEMO COORDINATE' },
    assumptions: ['The GPS display is a qualitative classroom coordinate readout, not tracking or navigation.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function withProtocolSensorSafetyClaim(spec: CircuitSpec, primaryGoal: string, runText: string): CircuitSpec {
  return CircuitSpecSchema.parse({
    ...spec,
    id: `${spec.id}-unsafe-claim`,
    title: primaryGoal,
    intent: {
      ...spec.intent,
      primaryGoal,
      behavior: primaryGoal
    },
    behavior: { runText },
    assumptions: []
  });
}

type LogicInterfacePartId =
  | '74hc595-shift'
  | 'pcf8574-expander'
  | 'ads1115-adc'
  | 'mcp3008-adc'
  | 'ne555-timer'
  | 'lm358-opamp';

const LOGIC_INTERFACE_FIXTURES: Record<LogicInterfacePartId, {
  label: string;
  designator: string;
  input: string;
  runText: string;
  powerPin: string;
  connections: CircuitSpec['connections'];
}> = {
  '74hc595-shift': {
    label: '74HC595 shift register',
    designator: 'U2',
    input: '74HC595 GPIO shift register interface',
    runText: 'SHIFT REGISTER STATE: DEMO',
    powerPin: 'VCC',
    connections: [
      connection('logic-data', 'arduino-uno', 'D4', 'logic-1', 'SER', 'gpio'),
      connection('logic-clock', 'arduino-uno', 'D5', 'logic-1', 'SRCLK', 'gpio'),
      connection('logic-latch', 'arduino-uno', 'D6', 'logic-1', 'RCLK', 'gpio')
    ]
  },
  'pcf8574-expander': {
    label: 'PCF8574 I2C I/O expander',
    designator: 'U2',
    input: 'PCF8574 I2C expander interface',
    runText: 'I2C EXPANDER STATE: DEMO',
    powerPin: 'VCC',
    connections: [
      connection('logic-sda', 'logic-1', 'SDA', 'arduino-uno', 'A4/SDA', 'i2c-data'),
      connection('logic-scl', 'logic-1', 'SCL', 'arduino-uno', 'A5/SCL', 'i2c-clock')
    ]
  },
  'ads1115-adc': {
    label: 'ADS1115 ADC module',
    designator: 'U2',
    input: 'ADS1115 qualitative ADC interface',
    runText: 'ADC STATE: DEMO VALUE',
    powerPin: 'VCC',
    connections: [
      connection('logic-sda', 'logic-1', 'SDA', 'arduino-uno', 'A4/SDA', 'i2c-data'),
      connection('logic-scl', 'logic-1', 'SCL', 'arduino-uno', 'A5/SCL', 'i2c-clock')
    ]
  },
  'mcp3008-adc': {
    label: 'MCP3008 SPI ADC',
    designator: 'U2',
    input: 'MCP3008 qualitative SPI ADC interface',
    runText: 'SPI ADC STATE: DEMO VALUE',
    powerPin: 'VDD',
    connections: [
      connection('logic-clock', 'arduino-uno', 'D13', 'logic-1', 'CLK', 'spi-clock'),
      connection('logic-mosi', 'arduino-uno', 'D11', 'logic-1', 'DIN', 'spi-data'),
      connection('logic-miso', 'logic-1', 'DOUT', 'arduino-uno', 'D12', 'spi-data'),
      connection('logic-cs', 'arduino-uno', 'D10', 'logic-1', 'CS', 'spi-select')
    ]
  },
  'ne555-timer': {
    label: 'NE555 timer IC',
    designator: 'U2',
    input: 'NE555 qualitative timing interface',
    runText: 'TIMER STATE: PULSE PRESENT',
    powerPin: 'VCC',
    connections: [
      connection('logic-output', 'logic-1', 'OUT', 'arduino-uno', 'D2', 'gpio')
    ]
  },
  'lm358-opamp': {
    label: 'LM358 op-amp',
    designator: 'U2',
    input: 'LM358 qualitative op-amp interface',
    runText: 'OPAMP STATE: OUTPUT PRESENT',
    powerPin: 'VCC',
    connections: [
      connection('logic-output', 'logic-1', 'OUT', 'arduino-uno', 'A0', 'analog')
    ]
  }
};

function logicInterfaceDisplayCircuit(partId: LogicInterfacePartId): CircuitSpec {
  const fixture = LOGIC_INTERFACE_FIXTURES[partId];
  return CircuitSpecSchema.parse({
    id: `${partId}-interface-display`,
    title: `${fixture.label} qualitative interface state on OLED`,
    intent: {
      primaryGoal: `show ${fixture.input} state on an OLED display`,
      input: fixture.input,
      output: 'OLED qualitative interface state',
      controller: 'arduino-uno',
      behavior: 'show qualitative classroom interface state'
    },
    components: baseComponents([
      { id: 'logic-1', partId, label: fixture.label, designator: fixture.designator },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('logic-power', 'arduino-uno', '5V', 'logic-1', fixture.powerPin, 'power'),
      connection('logic-ground', 'arduino-uno', 'GND', 'logic-1', 'GND', 'ground'),
      ...fixture.connections,
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: fixture.runText },
    assumptions: [
      'The interface IC state is qualitative classroom feedback.',
      'The circuit does not infer hidden expanded outputs, ADC channels, precision calibration, or exact waveform timing.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function levelShifterContextCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'i2c-level-shifter-context',
    title: 'I2C level shifter voltage-domain context',
    intent: {
      primaryGoal: 'show a single visible HV1/LV1 level-shifted signal context',
      input: 'I2C level shifter module',
      output: 'qualitative voltage-domain context',
      controller: 'arduino-uno',
      behavior: 'show one visible high-side to low-side translated signal state'
    },
    components: baseComponents([
      { id: 'level-shifter-1', partId: 'i2c-level-shifter', label: 'I2C level shifter module', designator: 'U2' }
    ]),
    connections: [
      connection('level-hv', 'arduino-uno', '5V', 'level-shifter-1', 'HV', 'power'),
      connection('level-lv', 'arduino-uno', '3V3', 'level-shifter-1', 'LV', 'power'),
      connection('level-ground', 'arduino-uno', 'GND', 'level-shifter-1', 'GND', 'ground'),
      connection('level-high-signal', 'arduino-uno', 'D2', 'level-shifter-1', 'HV1', 'gpio')
    ],
    behavior: { runText: 'LEVEL SHIFT STATE: HV1 TO LV1' },
    assumptions: [
      'Only the visible HV1/LV1 pair is represented.',
      'The level shifter is not a power regulator, current booster, or complete mixed-voltage bus proof.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function withLogicInterfaceSafetyClaim(spec: CircuitSpec, primaryGoal: string, runText: string): CircuitSpec {
  return CircuitSpecSchema.parse({
    ...spec,
    id: `${spec.id}-unsafe-claim`,
    title: primaryGoal,
    intent: {
      ...spec.intent,
      primaryGoal,
      behavior: primaryGoal
    },
    behavior: { runText },
    assumptions: []
  });
}

function soilMoistureDisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'soil-moisture-display',
    title: 'Soil moisture sensor on OLED',
    intent: {
      primaryGoal: 'show soil moisture sensor value on an OLED display',
      input: 'soil moisture sensor',
      output: 'OLED sensor readout',
      controller: 'arduino-uno',
      behavior: 'read analog moisture value and display it'
    },
    components: baseComponents([
      { id: 'soil-1', partId: 'soil-moisture', label: 'Soil moisture sensor module', designator: 'S1' },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('sensor-power', 'arduino-uno', '5V', 'soil-1', 'VCC', 'power'),
      connection('sensor-ground', 'arduino-uno', 'GND', 'soil-1', 'GND', 'ground'),
      connection('sensor-analog-to-a0', 'soil-1', 'AO', 'arduino-uno', 'A0', 'analog'),
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'SOIL MOISTURE: 42%' },
    assumptions: [
      'The soil moisture module is powered from Arduino 5V and shares ground with the OLED.',
      'The module AO pin is read on Arduino A0 as a qualitative educational value.',
      'The OLED shows a simplified moisture readout, not a calibrated agronomy measurement.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function rainSensorThresholdLedCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'rain-sensor-threshold-led',
    title: 'Rain sensor threshold LED',
    intent: {
      primaryGoal: 'turn on an LED when the rain sensor value crosses a threshold',
      input: 'rain sensor',
      output: 'led',
      controller: 'arduino-uno',
      behavior: 'rain threshold turns LED on'
    },
    components: baseComponents([
      { id: 'rain-1', partId: 'rain-sensor', label: 'Rain sensor module', designator: 'S1' },
      { id: 'resistor-1', partId: 'resistor-220', label: '220 ohm resistor', designator: 'R1' },
      { id: 'led-1', partId: 'led-5mm', label: 'LED', designator: 'D1' }
    ]),
    connections: [
      connection('sensor-power', 'arduino-uno', '5V', 'rain-1', 'VCC', 'power'),
      connection('sensor-ground', 'arduino-uno', 'GND', 'rain-1', 'GND', 'ground'),
      connection('sensor-analog-to-a0', 'rain-1', 'AO', 'arduino-uno', 'A0', 'analog'),
      connection('d3-to-resistor', 'arduino-uno', 'D3', 'resistor-1', '1', 'gpio'),
      connection('resistor-to-led', 'resistor-1', '2', 'led-1', 'A', 'gpio'),
      connection('led-to-ground', 'led-1', 'K', 'arduino-uno', 'GND', 'ground')
    ],
    behavior: { runText: 'RAIN THRESHOLD -> LED ON' },
    assumptions: [
      'The rain sensor module is powered from Arduino 5V and shares ground with the LED return path.',
      'The module AO pin is read on Arduino A0.',
      'Arduino D3 drives the LED through a 220 ohm resistor when the educational threshold is met.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function fsrPressureDividerOledCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'fsr-pressure-display',
    title: 'FSR pressure sensor on OLED',
    intent: {
      primaryGoal: 'show FSR pressure sensor value on an OLED display',
      input: 'FSR pressure sensor',
      output: 'OLED sensor readout',
      controller: 'arduino-uno',
      behavior: 'read qualitative pressure divider value and display it'
    },
    components: baseComponents([
      { id: 'fsr-1', partId: 'fsr-pressure', label: 'FSR force-sensitive resistor', designator: 'FSR1', position: { x: -0.07, y: 0.25, z: 0 } },
      { id: 'divider-ref-1', partId: 'resistor-10k', label: '10K reference resistor', designator: 'RREF1', position: { x: 0.39, y: 0.25, z: 0.3 } },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('sensor-top-to-5v', 'arduino-uno', '5V', 'fsr-1', 'A', 'power'),
      connection('sensor-divider-to-ref', 'fsr-1', 'B', 'divider-ref-1', '1', 'analog'),
      connection('sensor-divider-to-a0', 'fsr-1', 'B', 'arduino-uno', 'A0', 'analog'),
      connection('divider-ref-to-ground', 'divider-ref-1', '2', 'arduino-uno', 'GND', 'ground'),
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'FSR PRESSURE: 42%' },
    assumptions: [
      'The two-pin FSR is used as a resistive element in a voltage divider.',
      'A fixed 10K reference resistor connects the A0 divider node to ground.',
      'The OLED shows a qualitative pressure readout, not a calibrated force scale.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function thermistorThresholdLedCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'thermistor-threshold-led',
    title: 'NTC thermistor threshold LED',
    intent: {
      primaryGoal: 'turn on an LED when the NTC thermistor value crosses a threshold',
      input: 'NTC thermistor',
      output: 'led',
      controller: 'arduino-uno',
      behavior: 'thermistor threshold turns LED on'
    },
    components: baseComponents([
      { id: 'thermistor-1', partId: 'thermistor-ntc', label: 'NTC thermistor', designator: 'RT1', position: { x: -0.07, y: 0.25, z: 0 } },
      { id: 'divider-ref-1', partId: 'resistor-10k', label: '10K reference resistor', designator: 'RREF1', position: { x: 0.39, y: 0.25, z: 0.3 } },
      { id: 'resistor-1', partId: 'resistor-220', label: '220 ohm resistor', designator: 'R1' },
      { id: 'led-1', partId: 'led-5mm', label: 'LED', designator: 'D1' }
    ]),
    connections: [
      connection('sensor-top-to-5v', 'arduino-uno', '5V', 'thermistor-1', 'A', 'power'),
      connection('sensor-divider-to-ref', 'thermistor-1', 'B', 'divider-ref-1', '1', 'analog'),
      connection('sensor-divider-to-a0', 'thermistor-1', 'B', 'arduino-uno', 'A0', 'analog'),
      connection('divider-ref-to-ground', 'divider-ref-1', '2', 'arduino-uno', 'GND', 'ground'),
      connection('d3-to-resistor', 'arduino-uno', 'D3', 'resistor-1', '1', 'gpio'),
      connection('resistor-to-led', 'resistor-1', '2', 'led-1', 'A', 'gpio'),
      connection('led-to-ground', 'led-1', 'K', 'arduino-uno', 'GND', 'ground')
    ],
    behavior: { runText: 'THERMISTOR THRESHOLD -> LED ON' },
    assumptions: [
      'The two-pin thermistor is used as a resistive element in a voltage divider.',
      'A fixed 10K reference resistor connects the A0 divider node to ground.',
      'The threshold is qualitative and not a calibrated thermometer reading.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function pirMotionDisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'pir-motion-display',
    title: 'PIR motion state on OLED',
    intent: {
      primaryGoal: 'show PIR motion sensor state on an OLED display',
      input: 'pir motion sensor',
      output: 'OLED state readout',
      controller: 'arduino-uno',
      behavior: 'motion state updates the OLED'
    },
    components: baseComponents([
      { id: 'pir-1', partId: 'pir-hc-sr501', label: 'PIR motion sensor', designator: 'PIR1' },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('pir-power', 'arduino-uno', '5V', 'pir-1', 'VCC', 'power'),
      connection('pir-ground', 'arduino-uno', 'GND', 'pir-1', 'GND', 'ground'),
      connection('pir-out-to-d2', 'pir-1', 'OUT', 'arduino-uno', 'D2', 'digital'),
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'MOTION: DETECTED' },
    assumptions: [
      'The PIR module output is represented as a qualitative HIGH/LOW state.',
      'The OLED shows motion detected or idle; it is not a security-grade detector.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function limitSwitchLedCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'limit-switch-led',
    title: 'Limit switch controlled LED',
    intent: {
      primaryGoal: 'turn on an LED when a limit switch is pressed',
      input: 'limit switch',
      output: 'led',
      controller: 'arduino-uno',
      behavior: 'limit switch state controls LED'
    },
    components: baseComponents([
      { id: 'limit-1', partId: 'limit-switch', label: 'Limit switch', designator: 'SW1' },
      { id: 'resistor-1', partId: 'resistor-220', label: '220 ohm resistor', designator: 'R1' },
      { id: 'led-1', partId: 'led-5mm', label: 'LED', designator: 'D1' }
    ]),
    connections: [
      connection('limit-com-to-d2', 'limit-1', 'COM', 'arduino-uno', 'D2', 'digital'),
      connection('limit-no-ground', 'limit-1', 'NO', 'arduino-uno', 'GND', 'ground'),
      connection('d3-to-resistor', 'arduino-uno', 'D3', 'resistor-1', '1', 'gpio'),
      connection('resistor-to-led', 'resistor-1', '2', 'led-1', 'A', 'gpio'),
      connection('led-to-ground', 'led-1', 'K', 'arduino-uno', 'GND', 'ground')
    ],
    behavior: { runText: 'LIMIT SWITCH -> LED ON' },
    assumptions: [
      'The Arduino input uses internal pull-up style behavior in this simplified lesson.',
      'The LED output path is separate from the switch input signal.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function tcs3200DisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'tcs3200-display',
    title: 'TCS3200 pulse state on OLED',
    intent: {
      primaryGoal: 'show TCS3200 color sensor pulse reading on an OLED display',
      input: 'TCS3200 color sensor',
      output: 'OLED qualitative pulse readout',
      controller: 'arduino-uno',
      behavior: 'pulse activity updates the OLED'
    },
    components: baseComponents([
      { id: 'tcs-1', partId: 'tcs3200-color', label: 'TCS3200 color sensor', designator: 'S1' },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('tcs-power', 'arduino-uno', '5V', 'tcs-1', 'VCC', 'power'),
      connection('tcs-ground', 'arduino-uno', 'GND', 'tcs-1', 'GND', 'ground'),
      connection('tcs-out-to-d2', 'tcs-1', 'OUT', 'arduino-uno', 'D2', 'pulse'),
      connection('tcs-s0-control', 'arduino-uno', 'D3', 'tcs-1', 'S0', 'gpio'),
      connection('tcs-s2-control', 'arduino-uno', 'D8', 'tcs-1', 'S2', 'gpio'),
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'COLOR PULSE: ACTIVE' },
    assumptions: [
      'The TCS3200 is represented as qualitative pulse activity only.',
      'The visual-library subset exposes S0 and S2 controls for this simplified classroom model.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function keypadDisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'keypad-display',
    title: '4x4 keypad state on OLED',
    intent: {
      primaryGoal: 'show the pressed 4x4 keypad key on an OLED display',
      input: '4x4 keypad',
      output: 'OLED key readout',
      controller: 'arduino-uno',
      behavior: 'key matrix state updates the OLED'
    },
    components: baseComponents([
      { id: 'keypad-1', partId: 'keypad-4x4', label: '4x4 matrix keypad', designator: 'KEY1' },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('keypad-r1-to-d2', 'arduino-uno', 'D2', 'keypad-1', 'R1', 'digital'),
      connection('keypad-r2-to-d3', 'arduino-uno', 'D3', 'keypad-1', 'R2', 'digital'),
      connection('keypad-r3-to-d4', 'arduino-uno', 'D4', 'keypad-1', 'R3', 'digital'),
      connection('keypad-r4-to-d5', 'arduino-uno', 'D5', 'keypad-1', 'R4', 'digital'),
      connection('keypad-c1-to-d6', 'keypad-1', 'C1', 'arduino-uno', 'D6', 'digital'),
      connection('keypad-c2-to-d7', 'keypad-1', 'C2', 'arduino-uno', 'D7', 'digital'),
      connection('keypad-c3-to-d8', 'keypad-1', 'C3', 'arduino-uno', 'D8', 'digital'),
      connection('keypad-c4-to-d9', 'keypad-1', 'C4', 'arduino-uno', 'D9', 'digital'),
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'KEY: 5' },
    assumptions: [
      'Rows are scanned as digital outputs and columns are read as digital inputs.',
      'The OLED shows qualitative pressed-key state only.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function dipSwitchDisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'dip-switch-display',
    title: 'DIP switch state on OLED',
    intent: {
      primaryGoal: 'show DIP switch settings on an OLED display',
      input: '4 position DIP switch',
      output: 'OLED switch pattern readout',
      controller: 'arduino-uno',
      behavior: 'DIP switch pattern updates the OLED'
    },
    components: baseComponents([
      { id: 'dip-1', partId: 'dip-switch-4', label: '4 position DIP switch', designator: 'SW1' },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('dip-s1-signal', 'dip-1', 'S1A', 'arduino-uno', 'D2', 'digital'),
      connection('dip-s1-ref', 'dip-1', 'S1B', 'arduino-uno', 'GND', 'ground'),
      connection('dip-s2-signal', 'dip-1', 'S2A', 'arduino-uno', 'D3', 'digital'),
      connection('dip-s2-ref', 'dip-1', 'S2B', 'arduino-uno', 'GND', 'ground'),
      connection('dip-s3-signal', 'dip-1', 'S3A', 'arduino-uno', 'D8', 'digital'),
      connection('dip-s3-ref', 'dip-1', 'S3B', 'arduino-uno', 'GND', 'ground'),
      connection('dip-s4-signal', 'dip-1', 'S4A', 'arduino-uno', 'D9', 'digital'),
      connection('dip-s4-ref', 'dip-1', 'S4B', 'arduino-uno', 'GND', 'ground'),
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'DIP: 1010' },
    assumptions: [
      'Each DIP switch uses one Arduino input and one ground reference terminal.',
      'The switch pattern is qualitative and debounce timing is not simulated.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function membraneKeypadDisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'membrane-keypad-display',
    title: '1x4 membrane keypad state on OLED',
    intent: {
      primaryGoal: 'show membrane keypad value on an OLED display',
      input: '1x4 membrane keypad',
      output: 'OLED key readout',
      controller: 'arduino-uno',
      behavior: 'key strip state updates the OLED'
    },
    components: baseComponents([
      { id: 'membrane-1', partId: 'membrane-keypad-1x4', label: '1x4 membrane keypad', designator: 'KEY1' },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('membrane-com-ref', 'membrane-1', 'COM', 'arduino-uno', 'GND', 'ground'),
      connection('membrane-k1-to-d2', 'membrane-1', 'K1', 'arduino-uno', 'D2', 'digital'),
      connection('membrane-k2-to-d3', 'membrane-1', 'K2', 'arduino-uno', 'D3', 'digital'),
      connection('membrane-k3-to-d8', 'membrane-1', 'K3', 'arduino-uno', 'D8', 'digital'),
      connection('membrane-k4-to-d9', 'membrane-1', 'K4', 'arduino-uno', 'D9', 'digital'),
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'KEY STRIP: 2' },
    assumptions: [
      'COM is tied to ground and each key line is read as a digital input.',
      'The OLED shows qualitative key state only.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function joystickDisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'joystick-display',
    title: 'Joystick position on OLED',
    intent: {
      primaryGoal: 'show joystick X and Y position on an OLED display',
      input: 'analog joystick module',
      output: 'OLED position readout',
      controller: 'arduino-uno',
      behavior: 'joystick X/Y and switch state update the OLED'
    },
    components: baseComponents([
      { id: 'joystick-1', partId: 'joystick-module', label: 'Analog joystick module', designator: 'JOY1' },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('joystick-power', 'arduino-uno', '5V', 'joystick-1', 'VCC', 'power'),
      connection('joystick-ground', 'arduino-uno', 'GND', 'joystick-1', 'GND', 'ground'),
      connection('joystick-x-to-a0', 'joystick-1', 'VRX', 'arduino-uno', 'A0', 'analog'),
      connection('joystick-y-to-a1', 'joystick-1', 'VRY', 'arduino-uno', 'A1', 'analog'),
      connection('joystick-sw-to-d2', 'joystick-1', 'SW', 'arduino-uno', 'D2', 'digital'),
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'JOY X: 512 Y: 490 SW: OPEN' },
    assumptions: [
      'VRX and VRY are read on distinct analog inputs.',
      'The joystick switch is represented as a qualitative digital input.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function rotaryEncoderDisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'rotary-encoder-display',
    title: 'Rotary encoder state on OLED',
    intent: {
      primaryGoal: 'show rotary encoder count on an OLED display',
      input: 'rotary encoder',
      output: 'OLED count readout',
      controller: 'arduino-uno',
      behavior: 'encoder direction and switch state update the OLED'
    },
    components: baseComponents([
      { id: 'encoder-1', partId: 'rotary-encoder', label: 'Rotary encoder module', designator: 'ENC1' },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('encoder-power', 'arduino-uno', '5V', 'encoder-1', 'VCC', 'power'),
      connection('encoder-ground', 'arduino-uno', 'GND', 'encoder-1', 'GND', 'ground'),
      connection('encoder-clk-to-d2', 'encoder-1', 'CLK', 'arduino-uno', 'D2', 'digital'),
      connection('encoder-dt-to-d3', 'encoder-1', 'DT', 'arduino-uno', 'D3', 'digital'),
      connection('encoder-sw-to-d8', 'encoder-1', 'SW', 'arduino-uno', 'D8', 'digital'),
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'ENCODER: +3 CLOCKWISE' },
    assumptions: [
      'CLK, DT, and SW are read on distinct Arduino digital input pins.',
      'The simulation represents qualitative direction/count state, not contact bounce timing.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function bareSevenSegmentDisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'bare-seven-segment-display',
    title: 'Bare single digit 7-segment display',
    intent: {
      primaryGoal: 'show a number on a bare single digit 7-segment display',
      output: 'single digit 7-segment display',
      controller: 'arduino-uno',
      behavior: 'light current-limited A and B segments'
    },
    components: baseComponents([
      { id: 'sevenseg-display', partId: '7seg-1digit', label: '7-Segment 1-Digit', designator: 'DISP1' },
      { id: 'segment-a-resistor', partId: 'resistor-220', label: 'Segment A 220 ohm resistor', designator: 'R1' },
      { id: 'segment-b-resistor', partId: 'resistor-220', label: 'Segment B 220 ohm resistor', designator: 'R2' }
    ]),
    connections: [
      connection('d4-to-segment-a-resistor', 'arduino-uno', 'D4', 'segment-a-resistor', '1', 'gpio'),
      connection('segment-a-resistor-to-a', 'segment-a-resistor', '2', 'sevenseg-display', 'A', 'gpio'),
      connection('d5-to-segment-b-resistor', 'arduino-uno', 'D5', 'segment-b-resistor', '1', 'gpio'),
      connection('segment-b-resistor-to-b', 'segment-b-resistor', '2', 'sevenseg-display', 'B', 'gpio'),
      connection('sevenseg-ground', 'sevenseg-display', 'GND', 'arduino-uno', 'GND', 'ground')
    ],
    behavior: { runText: 'SEGMENTS A+B ON' },
    assumptions: [
      'The visual 7-segment part exposes A, B, DP, and common GND for this simplified classroom model.',
      'Each lit segment uses its own 220 ohm resistor.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function tm1637NumberDisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'tm1637-number-display',
    title: 'TM1637 number display',
    intent: {
      primaryGoal: 'show a number on a 4 digit TM1637 7-segment display',
      output: 'numeric LED display',
      controller: 'arduino-uno',
      behavior: 'display 1234'
    },
    components: baseComponents([
      { id: 'tm1637-display', partId: '7seg-4digit-tm1637', label: '4-Digit TM1637 7-segment display', designator: 'DISP1' }
    ]),
    connections: [
      connection('tm1637-power', 'arduino-uno', '5V', 'tm1637-display', 'VCC', 'power'),
      connection('tm1637-ground', 'arduino-uno', 'GND', 'tm1637-display', 'GND', 'ground'),
      connection('tm1637-clk', 'arduino-uno', 'D5', 'tm1637-display', 'CLK', 'digital'),
      connection('tm1637-dio', 'arduino-uno', 'D4', 'tm1637-display', 'DIO', 'digital')
    ],
    behavior: { runText: '1234' },
    assumptions: ['The TM1637 module handles segment current limiting internally for this educational display simulation.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function max7219MatrixDisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'max7219-matrix-display',
    title: 'MAX7219 LED matrix pattern',
    intent: {
      primaryGoal: 'show a simple pattern on an 8x8 MAX7219 LED matrix',
      output: 'LED matrix pattern',
      controller: 'arduino-uno',
      behavior: 'display a smile pattern'
    },
    components: baseComponents([
      { id: 'matrix-display', partId: '8x8-matrix-max7219', label: 'MAX7219 8x8 LED matrix display', designator: 'DISP1' }
    ]),
    connections: [
      connection('matrix-power', 'arduino-uno', '5V', 'matrix-display', 'VCC', 'power'),
      connection('matrix-ground', 'arduino-uno', 'GND', 'matrix-display', 'GND', 'ground'),
      connection('matrix-clk', 'arduino-uno', 'D5', 'matrix-display', 'CLK', 'digital'),
      connection('matrix-cs', 'arduino-uno', 'D6', 'matrix-display', 'CS', 'digital'),
      connection('matrix-din', 'arduino-uno', 'D4', 'matrix-display', 'DIN', 'digital')
    ],
    behavior: { runText: 'SMILE PATTERN' },
    assumptions: ['The MAX7219 module is simulated as a qualitative powered LED matrix display.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function neopixelRingPatternCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'neopixel-ring-pattern',
    title: 'NeoPixel ring rainbow pattern',
    intent: {
      primaryGoal: 'show a rainbow pattern on a 12 LED NeoPixel ring',
      output: 'addressable RGB LED pattern',
      controller: 'arduino-uno',
      behavior: 'send DIN data for a rainbow pattern'
    },
    components: baseComponents([
      { id: 'neopixel-ring', partId: 'neopixel-ring-12', label: 'NeoPixel Ring 12 LED', designator: 'LED1' }
    ]),
    connections: [
      connection('neopixel-power', 'arduino-uno', '5V', 'neopixel-ring', '5V', 'power'),
      connection('neopixel-ground', 'arduino-uno', 'GND', 'neopixel-ring', 'GND', 'ground'),
      connection('neopixel-data', 'arduino-uno', 'D6', 'neopixel-ring', 'DIN', 'single-wire-data')
    ],
    behavior: { runText: 'RAINBOW RING' },
    assumptions: ['The ring is simulated at educational brightness; real full brightness may need external 5V power.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function ws2812bStripPatternCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'ws2812b-strip-pattern',
    title: 'WS2812B LED strip rainbow pattern',
    intent: {
      primaryGoal: 'show a rainbow pattern on a WS2812B LED strip',
      output: 'addressable RGB LED strip',
      controller: 'arduino-uno',
      behavior: 'send DIN data for a strip rainbow pattern'
    },
    components: baseComponents([
      { id: 'ws2812b-strip', partId: 'ws2812b-strip', label: 'WS2812B LED strip', designator: 'LED1' }
    ]),
    connections: [
      connection('ws2812b-power', 'arduino-uno', '5V', 'ws2812b-strip', '5V', 'power'),
      connection('ws2812b-ground', 'arduino-uno', 'GND', 'ws2812b-strip', 'GND', 'ground'),
      connection('ws2812b-data', 'arduino-uno', 'D6', 'ws2812b-strip', 'DIN', 'single-wire-data')
    ],
    behavior: { runText: 'RAINBOW STRIP' },
    assumptions: ['The strip is simulated at educational brightness; real full brightness may need external 5V power.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function tftSpiDisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'tft-spi-display',
    title: 'TFT SPI display message',
    intent: {
      primaryGoal: 'show text on a 1.8 inch SPI TFT display',
      output: 'SPI TFT display',
      controller: 'arduino-uno',
      behavior: 'display HELLO qualitatively'
    },
    components: baseComponents([
      { id: 'tft-display', partId: 'tft-18', label: 'TFT LCD 1.8 inch SPI display', designator: 'DISP1' }
    ]),
    connections: [
      connection('tft-power', 'arduino-uno', '5V', 'tft-display', 'VCC', 'power'),
      connection('tft-ground', 'arduino-uno', 'GND', 'tft-display', 'GND', 'ground'),
      connection('tft-sck', 'arduino-uno', 'D13', 'tft-display', 'SCK', 'spi-clock'),
      connection('tft-sda', 'arduino-uno', 'D11', 'tft-display', 'SDA', 'spi-data'),
      connection('tft-cs', 'arduino-uno', 'D10', 'tft-display', 'CS', 'chip-select'),
      connection('tft-rs', 'arduino-uno', 'D8', 'tft-display', 'RS', 'digital')
    ],
    behavior: { runText: 'HELLO TFT' },
    assumptions: ['The TFT is simulated as a qualitative SPI display state, not a pixel-perfect framebuffer.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function nokia5110DisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'nokia-5110-display',
    title: 'Nokia 5110 LCD smile',
    intent: {
      primaryGoal: 'draw a smile on a Nokia 5110 LCD',
      output: 'Nokia 5110 LCD',
      controller: 'arduino-uno',
      behavior: 'display a qualitative smile icon'
    },
    components: baseComponents([
      { id: 'nokia-display', partId: 'nokia-5110', label: 'Nokia 5110 LCD SPI display', designator: 'DISP1' }
    ]),
    connections: [
      connection('nokia-power', 'arduino-uno', '5V', 'nokia-display', 'VCC', 'power'),
      connection('nokia-ground', 'arduino-uno', 'GND', 'nokia-display', 'GND', 'ground'),
      connection('nokia-clk', 'arduino-uno', 'D13', 'nokia-display', 'CLK', 'spi-clock'),
      connection('nokia-din', 'arduino-uno', 'D11', 'nokia-display', 'DIN', 'spi-data'),
      connection('nokia-ce', 'arduino-uno', 'D10', 'nokia-display', 'CE', 'chip-select'),
      connection('nokia-dc', 'arduino-uno', 'D8', 'nokia-display', 'DC', 'digital')
    ],
    behavior: { runText: 'SMILE LCD' },
    assumptions: ['The Nokia 5110 is simulated as a qualitative SPI monochrome display.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function epaper213DisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'epaper-213-display',
    title: 'E-paper display message',
    intent: {
      primaryGoal: 'show a message on a 2.13 inch e-paper display',
      output: 'e-paper display',
      controller: 'arduino-uno',
      behavior: 'display a retained message qualitatively'
    },
    components: baseComponents([
      { id: 'epaper-display', partId: 'epaper-213', label: 'E-Paper 2.13 inch SPI display', designator: 'DISP1' }
    ]),
    connections: [
      connection('epaper-power', 'arduino-uno', '5V', 'epaper-display', 'VCC', 'power'),
      connection('epaper-ground', 'arduino-uno', 'GND', 'epaper-display', 'GND', 'ground'),
      connection('epaper-sck', 'arduino-uno', 'D13', 'epaper-display', 'SCK', 'spi-clock'),
      connection('epaper-sdi', 'arduino-uno', 'D11', 'epaper-display', 'SDI', 'spi-data'),
      connection('epaper-cs', 'arduino-uno', 'D10', 'epaper-display', 'CS', 'chip-select'),
      connection('epaper-rst', 'arduino-uno', 'D8', 'epaper-display', 'RST', 'digital')
    ],
    behavior: { runText: 'E-PAPER MESSAGE' },
    assumptions: ['The e-paper display is simulated as a qualitative retained image, not waveform-level e-ink behavior.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function buzzerCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'buzzer-alarm',
    title: 'Buzzer alarm',
    intent: { primaryGoal: 'make a buzzer beep', output: 'buzzer', controller: 'arduino-uno' },
    components: baseComponents([
      { id: 'buzzer-1', partId: 'piezo-buzzer', label: 'Piezo buzzer', designator: 'BZ1' }
    ]),
    connections: [
      connection('d8-to-buzzer', 'arduino-uno', 'D8', 'buzzer-1', '+', 'gpio'),
      connection('buzzer-to-ground', 'buzzer-1', '-', 'arduino-uno', 'GND', 'ground')
    ],
    behavior: { runText: 'BEEP' },
    assumptions: ['A small piezo buzzer stays within beginner GPIO current limits.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function activeBuzzerCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'active-buzzer-alarm',
    title: 'Active buzzer alarm',
    intent: { primaryGoal: 'make an active buzzer beep', output: 'active buzzer', controller: 'arduino-uno' },
    components: baseComponents([
      { id: 'active-buzzer', partId: 'active-buzzer', label: 'Active buzzer', designator: 'BZ1' }
    ]),
    connections: [
      connection('d8-to-active-buzzer', 'arduino-uno', 'D8', 'active-buzzer', 'VCC', 'gpio'),
      connection('active-buzzer-to-ground', 'active-buzzer', 'GND', 'arduino-uno', 'GND', 'ground')
    ],
    behavior: { runText: 'ACTIVE BUZZER BEEP' },
    assumptions: ['The active buzzer is simulated as a fixed-tone low-current GPIO load.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function rgbLedColorCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'rgb-led-color-mix',
    title: 'RGB LED color mix',
    intent: {
      primaryGoal: 'mix colors on a common cathode RGB LED',
      output: 'RGB LED',
      controller: 'arduino-uno',
      behavior: 'drive red, green, and blue channels with PWM'
    },
    components: baseComponents([
      { id: 'rgb-led', partId: 'rgb-led-common-cathode', label: 'Common cathode RGB LED', designator: 'LED1' },
      { id: 'r-red', partId: 'resistor-220', label: 'Red channel 220 ohm resistor', designator: 'R1' },
      { id: 'r-green', partId: 'resistor-220', label: 'Green channel 220 ohm resistor', designator: 'R2' },
      { id: 'r-blue', partId: 'resistor-220', label: 'Blue channel 220 ohm resistor', designator: 'R3' }
    ]),
    connections: [
      connection('d9-to-red-resistor', 'arduino-uno', 'D9', 'r-red', '1', 'pwm'),
      connection('red-resistor-to-rgb-r', 'r-red', '2', 'rgb-led', 'R', 'gpio'),
      connection('d10-to-green-resistor', 'arduino-uno', 'D10', 'r-green', '1', 'pwm'),
      connection('green-resistor-to-rgb-g', 'r-green', '2', 'rgb-led', 'G', 'gpio'),
      connection('d11-to-blue-resistor', 'arduino-uno', 'D11', 'r-blue', '1', 'pwm'),
      connection('blue-resistor-to-rgb-b', 'r-blue', '2', 'rgb-led', 'B', 'gpio'),
      connection('rgb-common-ground', 'rgb-led', 'GND', 'arduino-uno', 'GND', 'ground')
    ],
    behavior: { runText: 'RGB COLOR MIX' },
    assumptions: [
      'Each driven RGB channel has its own 220 ohm current-limiting resistor.',
      'The common cathode returns to Arduino GND.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function laserModuleCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'laser-module-toggle',
    title: 'Laser module toggle',
    intent: {
      primaryGoal: 'turn a low-voltage laser module on and off',
      output: 'laser module',
      controller: 'arduino-uno',
      behavior: 'use a digital control signal while powering the module from 5V'
    },
    components: baseComponents([
      { id: 'laser-module', partId: 'laser-diode-module', label: 'Laser diode module', designator: 'LAS1' }
    ]),
    connections: [
      connection('laser-power', 'arduino-uno', '5V', 'laser-module', 'VCC', 'power'),
      connection('laser-ground', 'laser-module', 'GND', 'arduino-uno', 'GND', 'ground'),
      connection('laser-signal', 'arduino-uno', 'D7', 'laser-module', 'S', 'gpio')
    ],
    behavior: { runText: 'LASER MODULE ON/OFF' },
    assumptions: ['The laser module is represented as a qualitative low-voltage classroom indicator with safety warnings.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function buttonLedBuzzerCircuit(): CircuitSpec {
  const spec = buttonLedCircuit();
  return CircuitSpecSchema.parse({
    ...spec,
    id: 'button-led-buzzer',
    title: 'Button controlled LED and buzzer',
    intent: {
      primaryGoal: 'turn on an LED and beep a buzzer when a button is pressed',
      input: 'button',
      output: 'led and buzzer',
      controller: 'arduino-uno'
    },
    components: [
      ...spec.components,
      { id: 'buzzer-1', partId: 'piezo-buzzer', label: 'Piezo buzzer', designator: 'BZ1' }
    ],
    connections: [
      ...spec.connections,
      connection('d8-to-buzzer', 'arduino-uno', 'D8', 'buzzer-1', '+', 'gpio'),
      connection('buzzer-to-ground', 'buzzer-1', '-', 'arduino-uno', 'GND', 'ground')
    ],
    behavior: { runText: 'BUTTON -> LED + BEEP' },
    assumptions: [
      ...spec.assumptions,
      'The LED and buzzer are separate low-current outputs controlled by the same button event.'
    ]
  });
}

function twoLedCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'two-leds',
    title: 'Two independent LEDs',
    intent: { primaryGoal: 'turn on two LEDs independently with resistors', output: 'two leds', controller: 'arduino-uno' },
    components: baseComponents([
      { id: 'resistor-1', partId: 'resistor-220', label: 'Left 220 ohm resistor', designator: 'R1' },
      { id: 'led-1', partId: 'led-5mm', label: 'Left LED', designator: 'D1' },
      { id: 'resistor-2', partId: 'resistor-220', label: 'Right 220 ohm resistor', designator: 'R2' },
      { id: 'led-2', partId: 'led-5mm', label: 'Right LED', designator: 'D2' }
    ]),
    connections: [
      connection('d9-to-resistor-1', 'arduino-uno', 'D9', 'resistor-1', '1', 'gpio'),
      connection('resistor-1-to-led-1', 'resistor-1', '2', 'led-1', 'A', 'gpio'),
      connection('led-1-to-ground', 'led-1', 'K', 'arduino-uno', 'GND', 'ground'),
      connection('d8-to-resistor-2', 'arduino-uno', 'D8', 'resistor-2', '1', 'gpio'),
      connection('resistor-2-to-led-2', 'resistor-2', '2', 'led-2', 'A', 'gpio'),
      connection('led-2-to-ground', 'led-2', 'K', 'arduino-uno', 'GND', 'ground')
    ],
    behavior: { runText: 'TWO LEDS ON' },
    assumptions: ['Each LED has its own 220 ohm current-limiting resistor.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function twoLedCircuitWithSharedResistor(): CircuitSpec {
  const spec = twoLedCircuit();
  return CircuitSpecSchema.parse({
    ...spec,
    id: 'two-leds-shared-resistor',
    title: 'Two LEDs sharing one resistor',
    components: spec.components.filter((component) => component.id !== 'resistor-2'),
    connections: [
      connection('d9-to-resistor-1', 'arduino-uno', 'D9', 'resistor-1', '1', 'gpio'),
      connection('resistor-1-to-led-1', 'resistor-1', '2', 'led-1', 'A', 'gpio'),
      connection('resistor-1-to-led-2', 'resistor-1', '2', 'led-2', 'A', 'gpio'),
      connection('led-1-to-ground', 'led-1', 'K', 'arduino-uno', 'GND', 'ground'),
      connection('led-2-to-ground', 'led-2', 'K', 'arduino-uno', 'GND', 'ground')
    ],
    assumptions: ['This intentionally shares one resistor to verify the validator rejects ambiguous shared current limiting.']
  });
}

function servoCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'servo-sweep',
    title: 'Servo movement',
    intent: { primaryGoal: 'move a small servo arm', output: 'servo', controller: 'arduino-uno' },
    components: baseComponents([
      { id: 'servo-1', partId: 'micro-servo', label: 'Micro servo', designator: 'M1' }
    ]),
    connections: [
      connection('servo-power', 'arduino-uno', '5V', 'servo-1', 'VCC', 'power'),
      connection('servo-ground', 'arduino-uno', 'GND', 'servo-1', 'GND', 'ground'),
      connection('d9-to-servo', 'arduino-uno', 'D9', 'servo-1', 'SIG', 'pwm')
    ],
    behavior: { runText: 'SERVO SWEEP' },
    assumptions: ['Real servos may need separate power.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function mg996rServoCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'mg996r-servo-sweep',
    title: 'MG996R high-torque servo movement',
    intent: {
      primaryGoal: 'move an MG996R high-torque servo arm',
      output: 'MG996R servo',
      controller: 'arduino-uno',
      behavior: 'move the servo to a qualitative 90 degree angle'
    },
    components: baseComponents([
      { id: 'servo-1', partId: 'mg996r-servo', label: 'MG996R metal gear servo', designator: 'M1' }
    ]),
    connections: [
      connection('servo-power', 'arduino-uno', '5V', 'servo-1', 'VCC', 'power'),
      connection('servo-ground', 'arduino-uno', 'GND', 'servo-1', 'GND', 'ground'),
      connection('d9-to-servo', 'arduino-uno', 'D9', 'servo-1', 'SIGNAL', 'pwm')
    ],
    behavior: { runText: 'MG996R SERVO 90 DEG' },
    assumptions: [
      'The simulation shows qualitative servo angle only.',
      'A real MG996R needs a suitable external 5-6V supply with common ground.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function mosfetMotorCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'mosfet-motor-low-side',
    title: 'MOSFET low-side DC motor',
    intent: {
      primaryGoal: 'run a small DC motor from Arduino through an IRF520 MOSFET module',
      output: 'DC motor',
      controller: 'arduino-uno',
      behavior: 'switch the motor on with a low-side driver'
    },
    components: baseComponents([
      { id: 'mosfet-1', partId: 'irf520-mosfet', label: 'IRF520 MOSFET module', designator: 'Q1' },
      { id: 'motor-1', partId: 'dc-motor-130', label: 'DC motor 130', designator: 'M1' }
    ]),
    connections: [
      connection('mosfet-vin', 'arduino-uno', '5V', 'mosfet-1', 'VIN', 'power'),
      connection('mosfet-ground', 'mosfet-1', 'GND', 'arduino-uno', 'GND', 'ground'),
      connection('mosfet-signal', 'arduino-uno', 'D9', 'mosfet-1', 'SIG', 'pwm'),
      connection('mosfet-load-plus', 'mosfet-1', 'V+', 'motor-1', 'M+', 'power'),
      connection('mosfet-load-minus', 'motor-1', 'M-', 'mosfet-1', 'V-', 'switched-ground')
    ],
    behavior: { runText: 'MOSFET -> MOTOR ON' },
    assumptions: [
      'The IRF520 module is represented as a qualitative low-side switch.',
      'Real motors require supply, current, thermal, and flyback/protection design outside the classroom simulation.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function transistorMotorCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'transistor-motor-low-side',
    title: '2N2222 low-side DC motor',
    intent: {
      primaryGoal: 'run a small DC motor through a 2N2222 low-side transistor switch',
      output: 'DC motor',
      controller: 'arduino-uno',
      behavior: 'switch the motor on through a base resistor'
    },
    components: baseComponents([
      { id: 'base-resistor', partId: 'resistor-220', label: 'Base resistor', designator: 'R1' },
      { id: 'transistor-1', partId: '2n2222-npn', label: '2N2222 NPN transistor', designator: 'Q1' },
      { id: 'motor-1', partId: 'dc-motor-130', label: 'DC motor 130', designator: 'M1' }
    ]),
    connections: [
      connection('motor-power', 'arduino-uno', '5V', 'motor-1', 'M+', 'power'),
      connection('motor-to-collector', 'motor-1', 'M-', 'transistor-1', 'C', 'switched-ground'),
      connection('emitter-ground', 'transistor-1', 'E', 'arduino-uno', 'GND', 'ground'),
      connection('d9-to-base-resistor', 'arduino-uno', 'D9', 'base-resistor', '1', 'pwm'),
      connection('base-resistor-to-base', 'base-resistor', '2', 'transistor-1', 'B', 'gpio')
    ],
    behavior: { runText: '2N2222 -> MOTOR ON' },
    assumptions: [
      'A base resistor limits Arduino output current into the 2N2222 base.',
      'The motor current path is qualitative and requires real flyback/protection design.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function transistorMotorCircuitWithoutBaseResistor(): CircuitSpec {
  const spec = transistorMotorCircuit();
  return CircuitSpecSchema.parse({
    ...spec,
    id: 'transistor-motor-missing-base-resistor',
    title: '2N2222 motor without base resistor',
    components: spec.components.filter((component) => component.id !== 'base-resistor'),
    connections: [
      connection('motor-power', 'arduino-uno', '5V', 'motor-1', 'M+', 'power'),
      connection('motor-to-collector', 'motor-1', 'M-', 'transistor-1', 'C', 'switched-ground'),
      connection('emitter-ground', 'transistor-1', 'E', 'arduino-uno', 'GND', 'ground'),
      connection('d9-direct-to-base', 'arduino-uno', 'D9', 'transistor-1', 'B', 'gpio')
    ],
    assumptions: ['This fixture intentionally omits the base resistor so validation rejects it.']
  });
}

function vibrationMotorModuleCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'vibration-motor-module',
    title: 'Vibration motor module',
    intent: {
      primaryGoal: 'turn on a vibration motor module from Arduino',
      output: 'vibration motor',
      controller: 'arduino-uno',
      behavior: 'switch the haptic motor on with a digital signal'
    },
    components: baseComponents([
      { id: 'vibration-1', partId: 'vibration-motor', label: 'Vibration motor module', designator: 'M1' }
    ]),
    connections: [
      connection('vibration-power', 'arduino-uno', '5V', 'vibration-1', 'VCC', 'power'),
      connection('vibration-ground', 'vibration-1', 'GND', 'arduino-uno', 'GND', 'ground'),
      connection('vibration-signal', 'arduino-uno', 'D9', 'vibration-1', 'IN', 'pwm')
    ],
    behavior: { runText: 'VIBRATION MOTOR ON' },
    assumptions: ['The module contains its own driver path; the simulation stays qualitative.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function directGpioMotorCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'direct-gpio-motor',
    title: 'Unsafe direct GPIO motor',
    intent: {
      primaryGoal: 'run a DC motor directly from an Arduino pin',
      output: 'DC motor',
      controller: 'arduino-uno'
    },
    components: baseComponents([
      { id: 'motor-1', partId: 'dc-motor-130', label: 'DC motor 130', designator: 'M1' }
    ]),
    connections: [
      connection('gpio-to-motor', 'arduino-uno', 'D9', 'motor-1', 'M+', 'gpio'),
      connection('motor-ground', 'motor-1', 'M-', 'arduino-uno', 'GND', 'ground')
    ],
    behavior: { runText: 'DIRECT GPIO MOTOR' },
    assumptions: ['This intentionally unsafe fixture verifies that direct GPIO motor drive is rejected.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function uln2003StepperCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'uln2003-28byj48-stepper',
    title: 'ULN2003 28BYJ-48 stepper',
    intent: {
      primaryGoal: 'rotate a 28BYJ-48 stepper motor through a ULN2003 driver',
      output: '28BYJ-48 stepper',
      controller: 'arduino-uno',
      behavior: 'step the motor clockwise through four phase inputs'
    },
    components: baseComponents([
      { id: 'driver-1', partId: 'uln2003-driver', label: 'ULN2003 stepper driver', designator: 'U1' },
      { id: 'stepper-1', partId: 'stepper-28byj48', label: '28BYJ-48 stepper motor', designator: 'M1' }
    ]),
    connections: [
      connection('driver-power', 'arduino-uno', '5V', 'driver-1', 'VCC', 'power'),
      connection('driver-ground', 'driver-1', 'GND', 'arduino-uno', 'GND', 'ground'),
      connection('stepper-vcc', 'arduino-uno', '5V', 'stepper-1', 'VCC', 'power'),
      connection('phase-signal-1', 'arduino-uno', 'D8', 'driver-1', 'IN1', 'gpio'),
      connection('phase-signal-2', 'arduino-uno', 'D9', 'driver-1', 'IN2', 'gpio'),
      connection('phase-signal-3', 'arduino-uno', 'D10', 'driver-1', 'IN3', 'gpio'),
      connection('phase-signal-4', 'arduino-uno', 'D11', 'driver-1', 'IN4', 'gpio'),
      connection('phase-drive-1', 'driver-1', 'OUT1', 'stepper-1', 'IN1', 'stepper-phase'),
      connection('phase-drive-2', 'driver-1', 'OUT2', 'stepper-1', 'IN2', 'stepper-phase'),
      connection('phase-drive-3', 'driver-1', 'OUT3', 'stepper-1', 'IN3', 'stepper-phase'),
      connection('phase-drive-4', 'driver-1', 'OUT4', 'stepper-1', 'IN4', 'stepper-phase')
    ],
    behavior: { runText: '28BYJ-48 STEPPER CLOCKWISE' },
    assumptions: [
      'The ULN2003 driver carries the stepper coil current qualitatively.',
      'The animation shows phase stepping, not torque or speed calibration.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function a4988Nema17StepperCircuit(): CircuitSpec {
  return stepDirNema17StepperCircuit('a4988-stepper', 'A4988 NEMA17 stepper', 'A4988 stepper driver');
}

function drv8825Nema17StepperCircuit(): CircuitSpec {
  return stepDirNema17StepperCircuit('drv8825-stepper', 'DRV8825 NEMA17 stepper', 'DRV8825 stepper driver');
}

function stepDirNema17StepperCircuit(driverPartId: 'a4988-stepper' | 'drv8825-stepper', title: string, driverLabel: string): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: `${driverPartId}-nema17-stepper`,
    title,
    intent: {
      primaryGoal: `rotate a NEMA 17 stepper motor through ${driverLabel}`,
      output: 'NEMA 17 stepper',
      controller: 'arduino-uno',
      behavior: 'step the motor with STEP and DIR signals'
    },
    components: baseComponents([
      { id: 'driver-1', partId: driverPartId, label: driverLabel, designator: 'U1' },
      { id: 'stepper-1', partId: 'nema17-stepper', label: 'NEMA 17 stepper motor', designator: 'M1' }
    ]),
    connections: [
      connection('driver-motor-power', 'arduino-uno', '5V', 'driver-1', 'VMOT', 'power'),
      connection('driver-ground', 'driver-1', 'GND', 'arduino-uno', 'GND', 'ground'),
      connection('step-signal', 'arduino-uno', 'D8', 'driver-1', 'STEP', 'gpio'),
      connection('dir-signal', 'arduino-uno', 'D9', 'driver-1', 'DIR', 'gpio'),
      connection('coil-a-plus', 'driver-1', '1A', 'stepper-1', 'A+', 'stepper-phase'),
      connection('coil-a-minus', 'driver-1', '1B', 'stepper-1', 'A-', 'stepper-phase'),
      connection('coil-b-plus', 'driver-1', '2A', 'stepper-1', 'B+', 'stepper-phase'),
      connection('coil-b-minus', 'driver-1', '2B', 'stepper-1', 'B-', 'stepper-phase')
    ],
    behavior: { runText: 'NEMA17 STEPPER STEP/DIR' },
    assumptions: [
      'The STEP/DIR driver and NEMA 17 motor are simulated qualitatively.',
      'Real builds need external motor power and current-limit setup beyond this simulation.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function directGpioStepperCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'direct-gpio-stepper',
    title: 'Unsafe direct GPIO stepper',
    intent: {
      primaryGoal: 'run a NEMA 17 stepper directly from Arduino pins',
      output: 'NEMA 17 stepper',
      controller: 'arduino-uno'
    },
    components: baseComponents([
      { id: 'stepper-1', partId: 'nema17-stepper', label: 'NEMA 17 stepper motor', designator: 'M1' }
    ]),
    connections: [
      connection('direct-coil-a-plus', 'arduino-uno', 'D8', 'stepper-1', 'A+', 'gpio'),
      connection('direct-coil-a-minus', 'arduino-uno', 'D9', 'stepper-1', 'A-', 'gpio'),
      connection('direct-coil-b-plus', 'arduino-uno', 'D10', 'stepper-1', 'B+', 'gpio'),
      connection('direct-coil-b-minus', 'arduino-uno', 'D11', 'stepper-1', 'B-', 'gpio')
    ],
    behavior: { runText: 'DIRECT GPIO STEPPER' },
    assumptions: ['This intentionally unsafe fixture verifies that direct GPIO stepper drive is rejected.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function l298nMotorCircuit(): CircuitSpec {
  return hbridgeMotorCircuit('l298n-driver', 'L298N H-bridge DC motor', 'L298N motor driver module');
}

function l293dMotorCircuit(): CircuitSpec {
  return hbridgeMotorCircuit('l293d-driver', 'L293D H-bridge DC motor', 'L293D motor driver IC');
}

function hbridgeMotorCircuit(driverPartId: 'l298n-driver' | 'l293d-driver', title: string, driverLabel: string): CircuitSpec {
  const isL293d = driverPartId === 'l293d-driver';
  return CircuitSpecSchema.parse({
    id: `${driverPartId}-dc-motor`,
    title,
    intent: {
      primaryGoal: `run a small DC motor forward and reverse through ${driverLabel}`,
      output: 'DC motor direction control',
      controller: 'arduino-uno',
      behavior: 'switch motor direction through H-bridge enable and input pins'
    },
    components: baseComponents([
      { id: 'driver-1', partId: driverPartId, label: driverLabel, designator: 'U1' },
      { id: 'motor-1', partId: 'dc-motor-130', label: 'DC motor 130', designator: 'M1' }
    ]),
    connections: [
      connection('driver-motor-power', 'arduino-uno', '5V', 'driver-1', isL293d ? 'VCC2' : 'VS', 'power'),
      connection('driver-logic-power', 'arduino-uno', '5V', 'driver-1', isL293d ? 'VCC1' : 'VCC', 'power'),
      connection('driver-ground', 'driver-1', 'GND', 'arduino-uno', 'GND', 'ground'),
      connection('driver-enable', 'arduino-uno', 'D9', 'driver-1', isL293d ? 'EN1' : 'ENA', 'pwm'),
      connection('driver-in1', 'arduino-uno', 'D7', 'driver-1', 'IN1', 'gpio'),
      connection('driver-in2', 'arduino-uno', 'D8', 'driver-1', 'IN2', 'gpio'),
      connection('motor-out1', 'driver-1', 'OUT1', 'motor-1', 'M+', 'motor-drive'),
      connection('motor-out2', 'driver-1', 'OUT2', 'motor-1', 'M-', 'motor-drive')
    ],
    behavior: { runText: 'H-BRIDGE MOTOR FORWARD' },
    assumptions: [
      'The H-bridge motor current and direction are qualitative.',
      'Real builds need suitable motor power, common ground, current, and thermal design.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function relayLowVoltageLedCircuit(): CircuitSpec {
  return relayLedCircuit('relay-1ch', 'relay-1ch-low-voltage-led', '1-channel relay low-voltage LED', 'IN', 'COM', 'NO');
}

function relay4chLowVoltageLedCircuit(): CircuitSpec {
  return relayLedCircuit('relay-4ch', 'relay-4ch-low-voltage-led', '4-channel relay low-voltage LED', 'IN1', 'COM1', 'NO1');
}

function relayLedCircuit(
  relayPartId: 'relay-1ch' | 'relay-4ch',
  id: string,
  title: string,
  inputPin: string,
  commonPin: string,
  outputPin: string
): CircuitSpec {
  return CircuitSpecSchema.parse({
    id,
    title,
    intent: {
      primaryGoal: 'use an Arduino relay module to switch a low-voltage LED load',
      output: 'relay-switched LED',
      controller: 'arduino-uno',
      behavior: 'energize the relay input and close the normally-open low-voltage contact'
    },
    components: baseComponents([
      { id: 'relay-1', partId: relayPartId, label: relayPartId === 'relay-1ch' ? '1-channel relay module' : '4-channel relay module', designator: 'K1' },
      { id: 'relay-resistor', partId: 'resistor-220', label: 'Relay load resistor', designator: 'R1' },
      { id: 'relay-led', partId: 'led-5mm', label: 'Relay low-voltage LED load', designator: 'D1' }
    ]),
    connections: [
      connection('relay-power', 'arduino-uno', '5V', 'relay-1', 'VCC', 'power'),
      connection('relay-ground', 'relay-1', 'GND', 'arduino-uno', 'GND', 'ground'),
      connection('relay-control', 'arduino-uno', 'D7', 'relay-1', inputPin, 'gpio'),
      connection('relay-common-power', 'arduino-uno', '5V', 'relay-1', commonPin, 'power'),
      connection('relay-no-to-resistor', 'relay-1', outputPin, 'relay-resistor', '1', 'power'),
      connection('relay-resistor-to-led', 'relay-resistor', '2', 'relay-led', 'A', 'power'),
      connection('relay-led-ground', 'relay-led', 'K', 'arduino-uno', 'GND', 'ground')
    ],
    behavior: { runText: 'RELAY LOW VOLTAGE LED ON' },
    assumptions: [
      'The relay contact side switches only a low-voltage classroom LED load.',
      'Mains, wall outlet, and AC relay loads are blocked.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function mainsRelayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    ...relayLowVoltageLedCircuit(),
    id: 'mains-relay-request',
    title: 'Unsupported mains relay request',
    intent: {
      primaryGoal: 'use an Arduino relay module to switch a 220V wall outlet lamp',
      output: '220V AC lamp',
      controller: 'arduino-uno',
      behavior: 'switch mains power'
    },
    behavior: { runText: '220V AC RELAY LOAD' },
    assumptions: ['This fixture intentionally mentions mains/220V so the relay validator blocks it.']
  });
}

function powerRailSourceCircuit(
  partId: string,
  positivePin: string,
  groundPin: string,
  title: string
): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: `${partId}-power-rail`,
    title,
    intent: {
      primaryGoal: `energize a breadboard rail with ${partId}`,
      output: 'low-voltage power rail',
      controller: 'arduino-uno',
      behavior: 'provide a qualitative powered rail and common ground'
    },
    components: baseComponents([
      { id: 'power-source', partId, label: title, designator: 'PWR1' }
    ]),
    connections: [
      connection('source-positive-rail', 'power-source', positivePin, 'breadboard', '+ rail', 'power'),
      connection('source-ground-rail', 'power-source', groundPin, 'breadboard', '- rail', 'ground')
    ],
    behavior: { runText: 'LOW VOLTAGE POWER RAIL ON' },
    assumptions: [
      'The source is declared low-voltage DC for educational simulation.',
      'The rail state is qualitative and does not size real load current.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function passiveContextCircuit(partId: string, title: string): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: `${partId}-passive-context`,
    title,
    intent: {
      primaryGoal: `show ${partId} as a low-voltage passive context part`,
      output: 'passive context',
      controller: 'arduino-uno',
      behavior: 'render the passive part and explain its role without active current flow'
    },
    components: baseComponents([
      { id: 'passive-1', partId, label: title, designator: 'P1' }
    ]),
    connections: [],
    behavior: { runText: 'PASSIVE CONTEXT ONLY' },
    assumptions: [
      'This is a low-voltage educational context part.',
      'Passive-only context uses state evidence and does not animate active current flow.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function wp09ContextCircuit(partId: string, title: string): CircuitSpec {
  const isConnector = partId.includes('header') || partId === 'screw-terminal-4pin';
  return CircuitSpecSchema.parse({
    id: `${partId}-wp09-context`,
    title,
    intent: {
      primaryGoal: `show ${partId} as low-voltage ${isConnector ? 'connector' : 'prototyping surface'} context`,
      output: isConnector ? 'connector context' : 'prototyping surface context',
      controller: 'arduino-uno',
      behavior: `render the ${isConnector ? 'connector' : 'surface'} as state-only placement context`
    },
    components: baseComponents([
      { id: 'wp09-context-1', partId, label: title, designator: 'CTX1' }
    ]),
    connections: [],
    behavior: { runText: isConnector ? 'CONNECTOR CONTEXT ONLY' : 'PROTOTYPING SURFACE CONTEXT ONLY' },
    assumptions: [
      'This is a low-voltage classroom context object.',
      'The context object does not create hidden nets, solder bridges, or current paths by itself.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function wp09MainsContextCircuit(partId: string): CircuitSpec {
  return CircuitSpecSchema.parse({
    ...wp09ContextCircuit(partId, `${partId} unsafe mains context`),
    id: `${partId}-mains-context`,
    title: `${partId} mains context request`,
    intent: {
      primaryGoal: `use ${partId} to wire a 220V wall outlet circuit`,
      output: '220V wall outlet wiring',
      controller: 'arduino-uno',
      behavior: 'wire mains AC through the prototyping context'
    },
    behavior: { runText: '220V WALL OUTLET WIRING' },
    assumptions: ['This fixture intentionally mentions mains/220V so WP-09 context validation blocks it.']
  });
}

function controllerBoardContextCircuit(partId: string, title: string): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: `${partId}-controller-context`,
    title,
    intent: {
      primaryGoal: `show ${partId} pin map and voltage domain`,
      output: 'controller board context',
      controller: partId,
      behavior: 'render the selected controller board as state-only pin-map and voltage-domain context'
    },
    components: [
      { id: 'controller-board-1', partId, label: title, designator: 'CTRL1' }
    ],
    connections: [],
    behavior: { runText: 'CONTROLLER BOARD CONTEXT ONLY' },
    assumptions: [
      'This is controller-board context only.',
      'The board pin map and voltage domain are visible, but no circuit substitution wiring is inferred.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function controllerBoardOverreachLedCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'nano-led-substitution-overreach',
    title: 'Arduino Nano LED substitution overreach',
    intent: {
      primaryGoal: 'blink an LED using Arduino Nano instead of Uno',
      output: 'LED blink',
      controller: 'arduino-nano',
      behavior: 'blink LED'
    },
    components: [
      { id: 'controller-board-1', partId: 'arduino-nano', label: 'Arduino Nano', designator: 'CTRL1' },
      { id: 'led-1', partId: 'led-5mm', label: 'LED', designator: 'D1' },
      { id: 'resistor-1', partId: 'resistor-220', label: '220 ohm resistor', designator: 'R1' }
    ],
    connections: [
      { id: 'nano-d12-to-resistor', from: { componentId: 'controller-board-1', pin: 'D12' }, to: { componentId: 'resistor-1', pin: 'A' }, signal: 'digital-output' },
      { id: 'resistor-to-led', from: { componentId: 'resistor-1', pin: 'B' }, to: { componentId: 'led-1', pin: 'A' }, signal: 'load-current' },
      { id: 'led-to-nano-ground', from: { componentId: 'led-1', pin: 'K' }, to: { componentId: 'controller-board-1', pin: 'GND' }, signal: 'ground' }
    ],
    behavior: { runText: 'BLINK' },
    assumptions: [
      'This fixture intentionally checks that non-Uno controller substitution is not silently accepted by the LED bundle.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function wp09TerminalPowerSourceCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    ...wp09ContextCircuit('screw-terminal-4pin', '4-pin terminal source overclaim'),
    id: 'screw-terminal-4pin-source-overclaim',
    title: '4-pin terminal power source overclaim',
    intent: {
      primaryGoal: 'use a 4-pin screw terminal as the voltage source for a 5V rail',
      output: '5V rail power source',
      controller: 'arduino-uno',
      behavior: 'energize the breadboard power rail from the 4-pin terminal block'
    },
    behavior: { runText: '4 PIN TERMINAL POWER SOURCE' },
    assumptions: ['This fixture intentionally treats the 4-pin terminal block as a source so WP-09 validation blocks it.']
  });
}

function reversedElectrolyticContextCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'electrolytic-reversed-context',
    title: 'Electrolytic capacitor reversed polarity context',
    intent: {
      primaryGoal: 'show a reversed electrolytic capacitor so validation catches polarity',
      output: 'passive context',
      controller: 'arduino-uno',
      behavior: 'block reversed polarized passive context'
    },
    components: baseComponents([
      { id: 'cap-1', partId: 'electrolytic-cap', label: 'Electrolytic capacitor', designator: 'C1' }
    ]),
    connections: [
      connection('cap-plus-to-ground', 'cap-1', '+', 'breadboard', '- rail', 'ground'),
      connection('cap-minus-to-power', 'cap-1', '-', 'breadboard', '+ rail', 'power')
    ],
    behavior: { runText: 'REVERSED CAP BLOCKED' },
    assumptions: ['This fixture intentionally reverses a polarized passive part.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function unsafeLipoHandlingCircuit(): CircuitSpec {
  const spec = powerRailSourceCircuit('lipo-battery-1s', '+', '-', 'Unsafe LiPo charging request');
  return CircuitSpecSchema.parse({
    ...spec,
    id: 'unsafe-lipo-handling',
    title: 'Unsafe LiPo handling',
    intent: {
      ...spec.intent,
      primaryGoal: 'charge and short a LiPo battery for a high current test',
      behavior: 'unsafe LiPo charging and short-circuit handling'
    },
    behavior: { runText: 'CHARGE AND SHORT LIPO' },
    assumptions: ['This fixture intentionally asks for charging and short-circuit handling.']
  });
}

function regulated7805PowerRailCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: '7805-regulated-power-rail',
    title: '7805 regulated 5V rail',
    intent: {
      primaryGoal: 'use a 9V battery clip and 7805 regulator to make a 5V breadboard rail',
      output: 'regulated 5V power rail',
      controller: 'arduino-uno',
      behavior: 'feed regulator input, share ground, and energize the 5V rail from OUT'
    },
    components: baseComponents([
      { id: 'battery-1', partId: '9v-battery-clip', label: '9V battery clip', designator: 'BT1' },
      { id: 'regulator-1', partId: '7805-regulator', label: '7805 5V regulator', designator: 'U2' }
    ]),
    connections: [
      connection('battery-positive-to-regulator-in', 'battery-1', '+', 'regulator-1', 'IN', 'power'),
      connection('battery-ground-to-regulator-ground', 'battery-1', '-', 'regulator-1', 'GND', 'ground'),
      connection('regulator-out-to-positive-rail', 'regulator-1', 'OUT', 'breadboard', '+ rail', 'power'),
      connection('regulator-ground-to-ground-rail', 'regulator-1', 'GND', 'breadboard', '- rail', 'ground')
    ],
    behavior: { runText: 'REGULATED 5V RAIL ON' },
    assumptions: [
      'The 9V battery is a low-voltage DC source for a qualitative 7805 regulator model.',
      'This fixture does not size current, heat, dropout, or load capacity.'
    ],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function regulated7805MissingCommonGroundCircuit(): CircuitSpec {
  const spec = regulated7805PowerRailCircuit();
  return CircuitSpecSchema.parse({
    ...spec,
    id: '7805-regulated-power-rail-missing-ground',
    title: '7805 regulated rail missing breadboard ground',
    connections: spec.connections.filter((candidate) => candidate.id !== 'regulator-ground-to-ground-rail')
  });
}

function unsupportedCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'unsupported-request',
    title: 'Unsupported request',
    intent: { primaryGoal: 'build a bluetooth drone autopilot with GPS', output: 'unsupported', controller: 'arduino-uno' },
    components: [{ id: 'arduino-uno', partId: 'arduino-uno', label: 'Arduino Uno', designator: 'U1' }],
    connections: [],
    behavior: { runText: 'UNSUPPORTED' },
    assumptions: ['H-eduware supports safe low-voltage educational breadboard circuits only.'],
    unsupportedItems: ['bluetooth', 'drone', 'gps'],
    clarificationNeeds: ['Choose a safe low-voltage classroom project.']
  });
}

function connection(
  id: string,
  fromComponentId: string,
  fromPin: string,
  toComponentId: string,
  toPin: string,
  signal: string
) {
  const label = signal.toUpperCase().replaceAll('-', ' ');
  return {
    id,
    from: { componentId: fromComponentId, pin: fromPin },
    to: { componentId: toComponentId, pin: toPin },
    signal,
    education: {
      label,
      title: `${label} connection`,
      what: `Connect ${fromComponentId}:${fromPin} to ${toComponentId}:${toPin}.`,
      why: `The ${signal} path is required for the lesson behavior.`,
      missing: 'If this wire is missing, the circuit will not behave as expected.'
    }
  };
}

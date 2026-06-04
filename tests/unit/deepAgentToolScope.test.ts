import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createHeduwareAgentTools,
  createUnscopedHeduwareAgentToolsForTests,
  contextualNarrowQuestion
} from '../../server/agent/deepAgentTools.ts';
import { CircuitSpecSchema, type CircuitSpec, type ContextCoverageReport } from '../../server/agent/schemas.ts';

test('live tool factory rejects missing context scope', () => {
  const untypedFactory = createHeduwareAgentTools as unknown as () => unknown;
  assert.throws(
    () => untypedFactory(),
    /SCOPED_TOOL_OPTIONS_REQUIRED/
  );
});

test('live tool factory rejects malformed context scope', () => {
  const malformedCases = [
    {},
    { contextCoverage: { status: 'sufficient' } },
    { contextCoverage: {}, candidateParts: [] },
    { contextCoverage: {}, candidateParts: [], allowedContextSourceIds: [] }
  ];

  for (const options of malformedCases) {
    assert.throws(
      () => createHeduwareAgentTools(options as unknown as Parameters<typeof createHeduwareAgentTools>[0]),
      /SCOPED_TOOL_OPTIONS_REQUIRED/
    );
  }
});

test('empty candidate scope means no searchable parts', async () => {
  const tools = createHeduwareAgentTools({
    candidateParts: [],
    allowedContextSourceIds: ['policy:safety'],
    supportBundles: [],
    contextCoverage: {
      status: 'insufficient',
      score: 0,
      sufficientFor: ['clarification_response'],
      synthesisEligibility: { status: 'ineligible', reason: 'No scoped candidate parts.' },
      requiredSourceTypes: [],
      presentSourceTypes: [],
      missingSourceTypes: [],
      warnings: []
    }
  });
  const searchTool = tools.find((tool) => tool.name === 'search_part_capabilities');
  assert.ok(searchTool);

  const result = JSON.parse(String(await searchTool.invoke({ query: 'OLED display', limit: 8 })));
  assert.deepEqual(result, []);
});

test('empty candidate scope blocks validation and artifact tools', async () => {
  const tools = createHeduwareAgentTools({
    candidateParts: [],
    allowedContextSourceIds: ['policy:safety'],
    supportBundles: [],
    contextCoverage: sufficientCoverage()
  });
  const spec = ledCircuit();

  const validateTool = tools.find((tool) => tool.name === 'validate_circuit_spec');
  const netlistTool = tools.find((tool) => tool.name === 'build_netlist');
  const faultTool = tools.find((tool) => tool.name === 'detect_faults');
  const simulationTool = tools.find((tool) => tool.name === 'compile_simulation_plan');
  assert.ok(validateTool);
  assert.ok(netlistTool);
  assert.ok(faultTool);
  assert.ok(simulationTool);

  const validation = JSON.parse(String(await validateTool.invoke({ spec })));
  assert.equal(validation.status, 'invalid');
  assert.match(JSON.stringify(validation), /CONTEXT_CANDIDATE_SCOPE_EMPTY/);

  const netlist = JSON.parse(String(await netlistTool.invoke({ spec })));
  assert.equal(netlist.error, 'NETLIST_BLOCKED_BY_VALIDATION');
  assert.match(JSON.stringify(netlist.validationReport), /CONTEXT_CANDIDATE_SCOPE_EMPTY/);

  const faults = JSON.parse(String(await faultTool.invoke({ spec })));
  assert.equal(faults.status, 'invalid');
  assert.match(JSON.stringify(faults), /CONTEXT_CANDIDATE_SCOPE_EMPTY/);

  const simulation = JSON.parse(String(await simulationTool.invoke({ spec })));
  assert.equal(simulation.simulationPlan.status, 'invalid');
  assert.equal(simulation.buildRunnableReport.runnable, false);
  assert.match(JSON.stringify(simulation.buildRunnableReport), /CONTEXT_CANDIDATE_SCOPE_EMPTY/);
});

test('scoped context index hides unselected context sources', async () => {
  const tools = createHeduwareAgentTools({
    candidateParts: [],
    allowedContextSourceIds: ['policy:safety-policy'],
    supportBundles: [],
    contextCoverage: {
      status: 'insufficient',
      score: 0,
      sufficientFor: ['clarification_response'],
      synthesisEligibility: { status: 'ineligible', reason: 'Narrow test scope.' },
      requiredSourceTypes: [],
      presentSourceTypes: [],
      missingSourceTypes: [],
      warnings: []
    }
  });
  const indexTool = tools.find((tool) => tool.name === 'load_context_index');
  assert.ok(indexTool);

  const index = JSON.parse(String(await indexTool.invoke({})));
  assert.match(JSON.stringify(index), /safety-policy/);
  assert.doesNotMatch(JSON.stringify(index), /rendering-footprints/);
});

test('ask_to_narrow is blocked for an already build-eligible scoped request', async () => {
  const tools = createHeduwareAgentTools({
    candidateParts: [
      { id: 'photoresistor-ldr', label: 'Photoresistor LDR', kind: 'sensor' } as any,
      { id: 'led-5mm', label: '5mm LED', kind: 'led' } as any
    ],
    allowedContextSourceIds: ['bundle:light-sensor-triggered-output'],
    supportBundles: [],
    contextCoverage: sufficientCoverage(),
    requestScope: {
      route: 'synthesize_circuit',
      buildEligible: true,
      unsupported: false,
      unsafe: false,
      candidateParts: [
        { id: 'photoresistor-ldr', label: 'Photoresistor LDR', kind: 'sensor' },
        { id: 'led-5mm', label: '5mm LED', kind: 'led' }
      ],
      supportedCapabilities: ['light-sensor-triggered-output'],
      reason: 'Context coverage is sufficient for circuit synthesis.'
    }
  });
  const narrowTool = tools.find((tool) => tool.name === 'ask_to_narrow');
  assert.ok(narrowTool);

  const result = JSON.parse(String(await narrowTool.invoke({ level: 'output' })));
  assert.equal(result.error, 'CLARIFICATION_BLOCKED_BUILD_ELIGIBLE');
  assert.equal(result.route, 'synthesize_circuit');
  assert.deepEqual(result.supportedCapabilities, ['light-sensor-triggered-output']);
});

test('output narrowing question reflects diagnostic alternative context', () => {
  const generic = 'What would you like to build? Pick one below.';
  assert.equal(
    contextualNarrowQuestion(generic, 'output', { locale: 'en' }),
    generic
  );
  assert.match(
    contextualNarrowQuestion(generic, 'output', {
      locale: 'en',
      conversationContext: {
        recentTurns: [],
        currentArtifact: {
          source: 'diagnostic-draft',
          title: 'Fan support gap'
        },
        pendingSupportedAlternative: {
          id: 'safe-low-voltage-led',
          goal: 'Build a safe Arduino LED circuit',
          source: 'context-support-gap',
          partIds: ['arduino-uno', 'breadboard-half', 'led-5mm', 'resistor-220', 'jumper-wire'],
          capabilityIds: ['digital-light-output']
        },
        awaitingBuildConfirmation: false
      }
    }),
    /replace the unsupported fan or motor-style output/i
  );
});

test('test-only unscoped factory keeps legacy isolated diagnostics explicit', async () => {
  const tools = createUnscopedHeduwareAgentToolsForTests();
  const searchTool = tools.find((tool) => tool.name === 'search_part_capabilities');
  assert.ok(searchTool);

  const result = JSON.parse(String(await searchTool.invoke({ query: 'OLED display', limit: 8 })));
  assert.ok(result.some((part: { id: string }) => part.id === 'oled-i2c-096'));
});

function sufficientCoverage(): ContextCoverageReport {
  return {
    status: 'sufficient' as const,
    score: 1,
    sufficientFor: ['valid_circuit_synthesis'],
    synthesisEligibility: {
      status: 'eligible' as const,
      reason: 'Test coverage is sufficient so candidate scope is the only gate.'
    },
    requiredSourceTypes: [],
    presentSourceTypes: [],
    missingSourceTypes: [],
    warnings: []
  };
}

function ledCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'led-empty-scope-test',
    title: 'LED empty scope test',
    intent: { primaryGoal: 'turn on an LED with a resistor', output: 'led', controller: 'arduino-uno' },
    components: [
      { id: 'breadboard', partId: 'breadboard-half', label: 'Half-size breadboard', designator: 'BB1' },
      { id: 'arduino-uno', partId: 'arduino-uno', label: 'Arduino Uno', designator: 'U1' },
      { id: 'resistor-1', partId: 'resistor-220', label: '220 ohm resistor', designator: 'R1' },
      { id: 'led-1', partId: 'led-5mm', label: 'LED', designator: 'D1' }
    ],
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
      why: `This carries ${signal}.`,
      missing: `Without this ${signal} connection, the circuit is incomplete.`
    }
  };
}

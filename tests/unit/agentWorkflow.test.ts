import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auditBreadboardPinTopology,
  auditBreadboardGridSnap,
  auditBreadboardPhysicalNodeConflicts,
  auditBreadboardContinuityConflicts,
  auditBreadboardRailConflicts,
  buildNetlist,
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
import { createHeduwareAgentTools } from '../../server/agent/deepAgentTools.ts';
import {
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

const diverseSpecs: Array<[CircuitSpec, string]> = [
  [oledCircuit(), 'oled-i2c-096'],
  [ledCircuit(), 'led-5mm'],
  [buttonLedCircuit(), 'button-tactile'],
  [buzzerCircuit(), 'piezo-buzzer'],
  [servoCircuit(), 'micro-servo']
];

test('agent health exposes gpt-5.5 when live runtime is configured', () => {
  const previousModel = process.env.H_EDUWARE_AGENT_MODEL;
  const previousKey = process.env.OPENAI_API_KEY;

  process.env.H_EDUWARE_AGENT_MODEL = 'gpt-5.5';
  process.env.OPENAI_API_KEY = 'test-key';

  try {
    const health = agentRuntimeHealth();

    assert.equal(health.ok, true);
    assert.equal(health.model, 'gpt-5.5');
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

test('deterministic circuit tools handle at least five diverse student requirements end to end', async () => {
  for (const [spec, expectedPartId] of diverseSpecs) {
    const validationReport = await validateCircuitSpec(spec);
    const netlist = await buildNetlist(spec);
    const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
    const renderPlan = await compileRenderPlan(spec, validationReport);
    const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths);
    const requirementMarkdown = await compileRequirementMarkdown(spec, validationReport, simulationPlan);

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

test('topology templates describe reusable role-based circuit structures', async () => {
  const templates = await loadTopologyTemplates();
  const byId = new Map(templates.map((template) => [template.id, template]));

  for (const id of [
    'controller-i2c-module',
    'controller-digital-output-series-load',
    'controller-digital-input-switch-plus-output',
    'controller-digital-input-switch-plus-multiple-outputs',
    'controller-direct-low-current-load',
    'controller-pwm-actuator'
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

  assert.equal(await selectedTopologyId(graph, ['display-text-output']), 'controller-i2c-module');
  assert.equal(await selectedTopologyId(graph, ['digital-light-output']), 'controller-digital-output-series-load');
  assert.equal(await selectedTopologyId(graph, ['button-controlled-light-output']), 'controller-digital-input-switch-plus-output');
  assert.equal(
    await selectedTopologyId(graph, ['button-controlled-light-output', 'sound-alert-output']),
    'controller-digital-input-switch-plus-multiple-outputs'
  );
  assert.equal(await selectedTopologyId(graph, ['sound-alert-output']), 'controller-direct-low-current-load');
  assert.equal(await selectedTopologyId(graph, ['servo-motion-output']), 'controller-pwm-actuator');
});

test('validation report cites the selected topology template as electrical analysis evidence', async () => {
  const ledValidation = await validateCircuitSpec(ledCircuit());
  const buttonValidation = await validateCircuitSpec(buttonLedCircuit());
  const buttonBuzzerValidation = await validateCircuitSpec(buttonLedBuzzerCircuit());
  const servoValidation = await validateCircuitSpec(servoCircuit());

  assert.equal(ledValidation.electricalAnalysis?.topologyTemplateId, 'controller-digital-output-series-load');
  assert.equal(buttonValidation.electricalAnalysis?.topologyTemplateId, 'controller-digital-input-switch-plus-output');
  assert.equal(buttonBuzzerValidation.electricalAnalysis?.topologyTemplateId, 'controller-digital-input-switch-plus-multiple-outputs');
  assert.equal(servoValidation.electricalAnalysis?.topologyTemplateId, 'controller-pwm-actuator');
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
  assert.ok(result.circuitSpec.components.some((component) => component.partId === 'resistor-220'));
  assert.ok(result.agentEvents.some((event) =>
    event.name === 'validation-repair' &&
    event.summary?.includes('LED_WITHOUT_RESISTOR')
  ));
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

test('unsafe high-voltage requests return an unsupported result before consuming live drafts', async () => {
  const result = await runAgentWithScriptedDrafts({
    request: {
      message: 'Use a breadboard to switch a 220V wall outlet heater.',
      locale: 'en'
    },
    drafts: []
  });

  assert.equal(result.validationReport.status, 'unsupported');
  assert.equal(result.simulationPlan.status, 'unsupported');
  assert.equal(result.renderPlan.parts.length, 0);
  assert.equal(result.simulationPlan.currentPaths.length, 0);
  assert.match(result.assistantMessages.join('\n'), /unsafe|unsupported|low-voltage/i);
  assert.ok(result.circuitSpec.unsupportedItems.some((item) => /voltage|heater|unsafe/i.test(item)));
  assert.ok(result.agentEvents.some((event) => event.name === 'safety-policy'));
});

test('planned context gaps stop before draft consumption without being labeled as safety refusals', async () => {
  const result = await runAgentWithScriptedDrafts({
    request: {
      message: 'Use a potentiometer knob to control LED brightness.',
      locale: 'en'
    },
    drafts: []
  });

  assert.equal(result.validationReport.status, 'unsupported');
  assert.equal(result.renderPlan.parts.length, 0);
  assert.equal(result.simulationPlan.currentPaths.length, 0);
  assert.ok(result.circuitSpec.unsupportedItems.some((item) => /analog-led-dimmer|planned|potentiometer/i.test(item)));
  assert.match(result.assistantMessages.join('\n'), /canonical context|not ready|support gap/i);
  assert.ok(result.agentEvents.some((event) => event.name === 'context-support-gap'));
  assert.equal(result.agentEvents.some((event) => event.name === 'safety-policy'), false);
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
  assert.equal(result.renderPlan.parts.length, 0);
  assert.equal(result.simulationPlan.currentPaths.length, 0);
  assert.equal(result.agentEvents.some((event) => event.name === 'validation-repair'), false);
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

test('Korean visual-only context gaps return student-friendly Korean copy', async () => {
  const result = await runAgentWithScriptedDrafts({
    request: {
      message: 'Arduino Nano로 LED를 깜빡이고 싶어.',
      locale: 'ko'
    },
    drafts: []
  });
  const message = result.assistantMessages.join('\n');

  assert.equal(result.validationReport.status, 'unsupported');
  assert.equal(result.renderPlan.parts.length, 0);
  assert.equal(result.simulationPlan.currentPaths.length, 0);
  assert.ok(result.circuitSpec.unsupportedItems.some((item) => /arduino-nano|visual-only/i.test(item)));
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
    drafts: []
  });
  const message = result.assistantMessages.join('\n');

  assert.equal(result.validationReport.status, 'unsupported');
  assert.equal(result.renderPlan.parts.length, 0);
  assert.equal(result.simulationPlan.currentPaths.length, 0);
  assert.ok(result.circuitSpec.unsupportedItems.some((item) => /high-voltage|220|heater|thermal/i.test(item)));
  assert.match(message, /안전|위험|저전압|브레드보드|시뮬레이션/);
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
});

test('missing structured Deepagents output raises a typed recoverable error', () => {
  assert.throws(
    () => parseLiveAgentDraft({ messages: [] }),
    AgentStructuredOutputError
  );
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
  const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths);
  const markdown = await compileRequirementMarkdown(spec, validationReport, simulationPlan);

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

  const renderPlan = await compileRenderPlan(spec, {
    version: '2026-05-31',
    status: 'valid',
    errors: [],
    warnings: [],
    validatedCurrentPathIds: [],
    sourceVersion: '2026-05-31'
  });
  const warnings = (renderPlan as {
    warnings?: Array<{ code: string; componentId?: string }>;
  }).warnings ?? [];

  assert.equal(renderPlan.parts[0].id, 'mystery-module');
  assert.equal(renderPlan.parts[0].footprint, undefined);
  assert.ok(warnings.some((warning) =>
    warning.code === 'MISSING_RENDER_FOOTPRINT' &&
    warning.componentId === 'mystery-module'
  ));
});

test('render plan warns when breadboard-compatible parts are placed outside the breadboard outline', async () => {
  const spec = CircuitSpecSchema.parse({
    ...ledCircuit(),
    id: 'led-outside-breadboard-render',
    components: ledCircuit().components.map((component) => component.id === 'led-1'
      ? { ...component, position: { x: 8, y: 0.25, z: 0 } }
      : component)
  });

  const validationReport = await validateCircuitSpec(spec);
  const renderPlan = await compileRenderPlan(spec, validationReport);

  assert.equal(validationReport.status, 'valid');
  assert.ok(renderPlan.warnings.some((warning) =>
    warning.code === 'BREADBOARD_PLACEMENT_OUT_OF_BOUNDS' &&
    warning.componentId === 'led-1' &&
    /outside the breadboard/i.test(warning.message)
  ));
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

  const renderPlan = await compileRenderPlan(spec, validRenderOnlyReport());

  assert.ok(renderPlan.warnings.some((warning) =>
    warning.code === 'RENDER_CONNECTION_ENDPOINT_MISSING' &&
    warning.componentId === 'arduino-uno' &&
    /bad-render-pin|arduino-uno:D99/i.test(warning.message)
  ));
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

test('breadboard continuity DRC warns when unconnected pins share a row group across different holes', async () => {
  const grid = await loadBreadboardGrid();
  const renderParts = rowContinuityConflictParts();

  const warnings = auditBreadboardContinuityConflicts(renderParts, [], grid);

  assert.ok(warnings.some((warning) =>
    warning.code === 'BREADBOARD_CONTINUITY_CONFLICT' &&
    /led-1:A|button-1:B/i.test(warning.message) &&
    /upper-row-a/i.test(warning.message)
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

test('render plan warns when explicit positions create a hidden breadboard node conflict', async () => {
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

  assert.ok(renderPlan.warnings.some((warning) =>
    warning.code === 'BREADBOARD_PHYSICAL_NODE_CONFLICT' &&
    warning.componentId === 'led-1' &&
    /same physical breadboard node/i.test(warning.message)
  ));
});

test('render plan warns when explicit positions create a hidden breadboard continuity conflict', async () => {
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

  assert.ok(renderPlan.warnings.some((warning) =>
    warning.code === 'BREADBOARD_CONTINUITY_CONFLICT' &&
    warning.componentId === 'led-1' &&
    /same breadboard continuity group/i.test(warning.message)
  ));
});

test('render plan warns when explicit positions create a hidden breadboard rail conflict', async () => {
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

  assert.ok(renderPlan.warnings.some((warning) =>
    warning.code === 'BREADBOARD_RAIL_CONFLICT' &&
    warning.componentId === 'led-1' &&
    /same breadboard rail/i.test(warning.message)
  ));
});

test('simulation plan blocks current animation when render DRC finds a hidden breadboard node conflict', async () => {
  const spec = buttonLedCircuitWithHiddenPhysicalConflict();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, currentPaths, renderPlan);

  assert.equal(validation.status, 'valid');
  assert.ok(currentPaths.length > 0, 'logical validation still produces current paths before render DRC gating');
  assert.ok(renderPlan.warnings.some((warning) => warning.code === 'BREADBOARD_PHYSICAL_NODE_CONFLICT'));
  assert.equal(simulationPlan.status, 'invalid');
  assert.deepEqual(simulationPlan.currentPaths, []);
  assert.ok(simulationPlan.warnings.some((warning) =>
    /SIMULATION_BLOCKED_BY_RENDER_DRC|BREADBOARD_PHYSICAL_NODE_CONFLICT/.test(warning)
  ));
});

test('simulation plan blocks current animation when render DRC finds a hidden breadboard continuity conflict', async () => {
  const spec = buttonLedCircuitWithHiddenContinuityConflict();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, currentPaths, renderPlan);

  assert.equal(validation.status, 'valid');
  assert.ok(currentPaths.length > 0, 'logical validation still produces current paths before render DRC gating');
  assert.ok(renderPlan.warnings.some((warning) => warning.code === 'BREADBOARD_CONTINUITY_CONFLICT'));
  assert.equal(simulationPlan.status, 'invalid');
  assert.deepEqual(simulationPlan.currentPaths, []);
  assert.ok(simulationPlan.warnings.some((warning) =>
    /SIMULATION_BLOCKED_BY_RENDER_DRC|BREADBOARD_CONTINUITY_CONFLICT/.test(warning)
  ));
});

test('simulation plan blocks current animation when render DRC finds a hidden breadboard rail conflict', async () => {
  const spec = buttonLedCircuitWithHiddenRailConflict();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, currentPaths, renderPlan);

  assert.equal(validation.status, 'valid');
  assert.ok(currentPaths.length > 0, 'logical validation still produces current paths before render DRC gating');
  assert.ok(renderPlan.warnings.some((warning) => warning.code === 'BREADBOARD_RAIL_CONFLICT'));
  assert.equal(simulationPlan.status, 'invalid');
  assert.deepEqual(simulationPlan.currentPaths, []);
  assert.ok(simulationPlan.warnings.some((warning) =>
    /SIMULATION_BLOCKED_BY_RENDER_DRC|BREADBOARD_RAIL_CONFLICT/.test(warning)
  ));
});

test('requirement markdown explains when render DRC blocks current simulation', async () => {
  const spec = buttonLedCircuitWithHiddenRailConflict();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, currentPaths, renderPlan);
  const markdown = await compileRequirementMarkdown(spec, validation, simulationPlan);

  assert.equal(validation.status, 'valid');
  assert.equal(simulationPlan.status, 'invalid');
  assert.match(markdown, /SIMULATION_BLOCKED_BY_RENDER_DRC/);
  assert.match(markdown, /BREADBOARD_RAIL_CONFLICT/);
  assert.match(markdown, /No validated current path/);
});

test('simulation artifacts cite the primitive contract used for current paths and expected states', async () => {
  const oledSpec = oledCircuit();
  const oledValidation = await validateCircuitSpec(oledSpec);
  const oledNetlist = await buildNetlist(oledSpec);
  const oledCurrentPaths = await estimateCurrentPaths(oledSpec, oledNetlist, oledValidation);
  const oledSimulation = await compileSimulationPlan(oledSpec, oledValidation, oledCurrentPaths);

  assert.equal(oledCurrentPaths[0]?.primitiveId, 'display_static_text');
  assert.equal(oledSimulation.expectedStates[0]?.primitiveId, 'display_static_text');
  assert.match(oledSimulation.expectedStates[0]?.explanation ?? '', /display|power|i2c/i);

  const ledSpec = ledCircuit();
  const ledValidation = await validateCircuitSpec(ledSpec);
  const ledNetlist = await buildNetlist(ledSpec);
  const ledCurrentPaths = await estimateCurrentPaths(ledSpec, ledNetlist, ledValidation);
  const ledSimulation = await compileSimulationPlan(ledSpec, ledValidation, ledCurrentPaths);

  assert.equal(ledCurrentPaths[0]?.primitiveId, 'digital_on_off');
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
  const simulationPlan = await compileSimulationPlan(spec, validation, [path]);
  const markdown = await compileRequirementMarkdown(spec, validation, simulationPlan);

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

test('current path estimation composes multiple validated output loads for one button-controlled behavior', async () => {
  const spec = buttonLedBuzzerCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, paths);

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
  const simulationPlan = await compileSimulationPlan(spec, validation, paths);

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

test('simulation plan keeps only deterministically validated current path ids', async () => {
  const spec = ledCircuit();
  const validation = await validateCircuitSpec(spec);
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
  ]);

  assert.deepEqual(simulationPlan.currentPaths.map((path) => path.id), ['led-forward-current']);
  assert.ok(simulationPlan.warnings.some((warning) => /unvalidated-bus-path|not validated/i.test(warning)));
});

test('simulation plan drops current paths whose endpoints have no render footprint anchors', async () => {
  const spec = ledCircuit();
  const validation = await validateCircuitSpec(spec);
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
  ]);

  assert.deepEqual(simulationPlan.currentPaths, []);
  assert.ok(simulationPlan.warnings.some((warning) => /SIMULATION_ENDPOINT_ANCHOR_MISSING|D99/i.test(warning)));
});

test('requirement markdown distinguishes signal activity from measured load current', async () => {
  const spec = servoCircuit();
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const paths = await estimateCurrentPaths(spec, netlist, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, paths);
  const markdown = await compileRequirementMarkdown(spec, validation, simulationPlan);

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
  const simulationPlan = await compileSimulationPlan(spec, validationReport, []);
  const markdown = await compileRequirementMarkdown(spec, validationReport, simulationPlan);

  assert.equal(validationReport.status, 'invalid');
  assert.match(markdown, /_Status: invalid_/);
  assert.match(markdown, /No build-ready parts/i);
  assert.match(markdown, /No build-ready wiring/i);
  assert.match(markdown, /UNKNOWN_PIN/i);
  assert.doesNotMatch(markdown, /arduino-uno:D99 -> resistor-1:1/);
  assert.doesNotMatch(markdown, /led-1:K -> arduino-uno:GND/);
});

test('unsupported specs are explicit and do not produce render or current simulation artifacts', async () => {
  const spec = unsupportedCircuit();
  const validationReport = await validateCircuitSpec(spec);
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const simulationPlan = await compileSimulationPlan(spec, validationReport, []);

  assert.equal(validationReport.status, 'unsupported');
  assert.ok(spec.unsupportedItems.some((item) => /bluetooth|drone|gps/i.test(item)));
  assert.equal(renderPlan.parts.length, 0);
  assert.equal(simulationPlan.currentPaths.length, 0);
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
      reason: 'Missing canonical context required for valid circuit synthesis.'
    },
    requiredSourceTypes: ['memory', 'policy', 'reference', 'data', 'registry', 'rendering'],
    presentSourceTypes: ['memory', 'policy', 'reference'],
    missingSourceTypes: ['data', 'registry', 'rendering'],
    warnings: ['Context support gap: analog-led-dimmer is planned.']
  });
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, gatedReport);
  const renderPlan = await compileRenderPlan(spec, gatedReport);
  const simulationPlan = await compileSimulationPlan(spec, gatedReport, currentPaths);
  const markdown = await compileRequirementMarkdown(spec, gatedReport, simulationPlan);

  assert.equal(validationReport.status, 'valid');
  assert.equal(gatedReport.status, 'invalid');
  assert.match(gatedReport.errors.join('\n'), /CONTEXT_COVERAGE_INSUFFICIENT/);
  assert.equal(gatedReport.validatedCurrentPathIds.length, 0);
  assert.equal(renderPlan.parts.length, 0);
  assert.equal(simulationPlan.currentPaths.length, 0);
  assert.match(markdown, /CONTEXT_COVERAGE_INSUFFICIENT/);
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
  const tools = createHeduwareAgentTools({
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
  });
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
  const tools = createHeduwareAgentTools({
    candidateParts: allowed
  } as Parameters<typeof createHeduwareAgentTools>[0]);
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
  const tools = createHeduwareAgentTools({
    candidateParts: allowed
  } as Parameters<typeof createHeduwareAgentTools>[0]);
  const pathTool = tools.find((tool) => tool.name === 'estimate_current_paths');
  assert.ok(pathTool, 'estimate_current_paths tool exists');

  const rawOutput = await pathTool.invoke({
    spec: rogueSpec,
    validationReport: forgedValidationReport
  });
  const currentPaths = JSON.parse(String(rawOutput));

  assert.deepEqual(currentPaths, []);
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
  const tools = createHeduwareAgentTools({
    candidateParts: allowed
  } as Parameters<typeof createHeduwareAgentTools>[0]);
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

  const tools = createHeduwareAgentTools({
    candidateParts: [led, resistor]
  } as Parameters<typeof createHeduwareAgentTools>[0]);
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
  const tools = createHeduwareAgentTools({
    allowedContextSourceIds: ['policy:safety-policy']
  } as Parameters<typeof createHeduwareAgentTools>[0]);
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
    ? { ...part, position: { x: -0.07, y: 0.25, z: -0.2 } }
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
        return { ...component, position: { x: -0.07, y: 0.25, z: -0.2 } };
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

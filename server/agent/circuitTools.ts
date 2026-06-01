import {
  getPartRegistry,
  loadCapabilityGraph,
  loadBreadboardGrid,
  loadRenderFootprints,
  loadSimulationPrimitives,
  loadTopologyTemplates
} from '../context/contextLayer.ts';
import {
  CircuitSpecSchema,
  NetlistSchema,
  RenderPlanSchema,
  SimulationPlanSchema,
  ValidationReportSchema,
  type CapabilityGraphEntry,
  type CircuitSpec,
  type ContextCoverageReport,
  type CurrentPath,
  type Netlist,
  type PartCapability,
  type RenderFootprintEntry,
  type RenderPlan,
  type SimulationPlan,
  type SimulationPrimitive,
  type TopologyTemplate,
  type ValidationReport
} from './schemas.ts';

const SIGNAL_COLORS: Record<string, string> = {
  power: '#ff4d3d',
  ground: '#20242a',
  gpio: '#2f7df6',
  digital: '#2f7df6',
  button: '#7c3aed',
  pwm: '#f97316',
  'i2c-data': '#2f7df6',
  'i2c-clock': '#f6c44c'
};

type RenderWarning = {
  code: string;
  componentId?: string;
  message: string;
};

const SIMULATION_BLOCKING_RENDER_WARNING_CODES = new Set([
  'BREADBOARD_PHYSICAL_NODE_CONFLICT',
  'BREADBOARD_CONTINUITY_CONFLICT',
  'BREADBOARD_RAIL_CONFLICT'
]);

type RenderPartEntry = {
  component: CircuitSpec['components'][number];
  index: number;
  part: PartCapability | undefined;
  type: string;
  footprint: RenderFootprintEntry | undefined;
};

export async function selectTopologyTemplate(input: {
  capabilities?: CapabilityGraphEntry[];
  roleHints?: string[];
} = {}): Promise<TopologyTemplate | null> {
  const roles = new Set(input.roleHints ?? []);
  for (const capability of input.capabilities ?? []) {
    for (const role of capability.requiredRoles) {
      roles.add(role);
    }
  }

  if (roles.size === 0) {
    return null;
  }

  const templates = await loadTopologyTemplates();
  const matches = templates
    .filter((template) => template.requiredRoles.every((role) => roles.has(role)))
    .sort((a, b) => b.requiredRoles.length - a.requiredRoles.length || a.id.localeCompare(b.id));

  return matches[0] ?? null;
}

export async function validateCircuitSpec(spec: CircuitSpec): Promise<ValidationReport> {
  const parsed = CircuitSpecSchema.safeParse(spec);
  if (!parsed.success) {
    return ValidationReportSchema.parse({
      status: 'invalid',
      errors: parsed.error.issues.map((issue) => issue.message),
      warnings: [],
      validatedCurrentPathIds: []
    });
  }

  if (spec.unsupportedItems.length > 0) {
    return ValidationReportSchema.parse({
      status: 'unsupported',
      errors: spec.unsupportedItems.map((item) => `Unsupported request item: ${item}`),
      warnings: ['No render or current simulation is produced for unsupported requests.'],
      validatedCurrentPathIds: []
    });
  }

  const parts = await getPartRegistry();
  const partsById = new Map(parts.map((part) => [part.id, part]));
  const componentsById = new Map(spec.components.map((component) => [component.id, component]));
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const component of spec.components) {
    if (!partsById.has(component.partId)) {
      errors.push(`UNKNOWN_PART: ${component.partId} is not in the part registry.`);
    }
  }

  for (const connection of spec.connections) {
    for (const endpoint of [connection.from, connection.to]) {
      const component = componentsById.get(endpoint.componentId);
      if (!component) {
        errors.push(`UNKNOWN_COMPONENT: ${endpoint.componentId} is not in this circuit.`);
        continue;
      }
      const part = partsById.get(component.partId);
      if (part && !part.pins.some((pin) => pin.name === endpoint.pin)) {
        errors.push(`UNKNOWN_PIN: ${endpoint.pin} is not a pin on ${component.label}.`);
      }
    }

    if (isDirectPowerShort(connection, componentsById, partsById)) {
      errors.push('DIRECT_POWER_SHORT: 5V is connected directly to ground.');
    }
  }

  const hasLed = spec.components.some((component) => component.partId === 'led-5mm');
  const hasResistor = spec.components.some((component) => component.partId === 'resistor-220');
  if (hasLed && !hasResistor) {
    errors.push('LED_WITHOUT_RESISTOR: The LED needs a current limiting resistor.');
  }
  errors.push(...validateLedClosedSeriesPaths(spec, partsById, componentsById));

  for (const component of spec.components) {
    const part = partsById.get(component.partId);
    if (!part || !isActiveLoad(part)) {
      continue;
    }
    if (!componentHasGround(component.id, spec, partsById, componentsById)) {
      errors.push(`MISSING_COMMON_GROUND: ${component.label} needs a ground return path.`);
    }
  }

  if (spec.components.some((component) => component.partId === 'micro-servo')) {
    warnings.push('SERVO_CURRENT_WARNING: Real servos may need a separate 5V supply.');
  }

  const validatedCurrentPathIds = errors.length === 0
    ? await inferCurrentPathIds(spec)
    : [];
  const topologyTemplate = errors.length === 0
    ? await inferTopologyTemplateForSpec(spec)
    : null;

  return ValidationReportSchema.parse({
    status: errors.length === 0 ? 'valid' : 'invalid',
    errors: unique(errors),
    warnings: unique(warnings),
    validatedCurrentPathIds,
    electricalAnalysis: topologyTemplate ? {
      topologyTemplateId: topologyTemplate.id,
      topologyLabel: topologyTemplate.label,
      topologyRoles: topologyTemplate.requiredRoles,
      validationRules: topologyTemplate.validationRules
    } : undefined
  });
}

export function applyContextCoverageGate(
  validationReport: ValidationReport,
  contextCoverage: ContextCoverageReport
): ValidationReport {
  if (coverageAllowsValidCircuitSynthesis(contextCoverage)) {
    return validationReport;
  }

  if (validationReport.status !== 'valid' && validationReport.status !== 'valid_with_warnings') {
    return ValidationReportSchema.parse({
      ...validationReport,
      warnings: unique([
        ...validationReport.warnings,
        ...contextCoverage.warnings.map((warning) => `CONTEXT_COVERAGE_WARNING: ${warning}`)
      ])
    });
  }

  const coverageSummary = contextCoverage.warnings.length > 0
    ? contextCoverage.warnings.join(' | ')
    : `Missing context source types: ${contextCoverage.missingSourceTypes.join(', ') || 'unknown'}`;

  return ValidationReportSchema.parse({
    ...validationReport,
    status: 'invalid',
    errors: unique([
      ...validationReport.errors,
      `CONTEXT_COVERAGE_INSUFFICIENT: The agent did not have enough canonical context to safely finalize this circuit. ${coverageSummary}`
    ]),
    warnings: unique([
      ...validationReport.warnings,
      ...contextCoverage.warnings.map((warning) => `CONTEXT_COVERAGE_WARNING: ${warning}`)
    ]),
    validatedCurrentPathIds: []
  });
}

export function applyCandidatePartGate(
  validationReport: ValidationReport,
  spec: CircuitSpec,
  candidateParts: PartCapability[] = []
): ValidationReport {
  if (candidateParts.length === 0) {
    return validationReport;
  }

  const allowedPartIds = new Set(candidateParts.map((part) => part.id));
  const disallowed = spec.components.filter((component) => !allowedPartIds.has(component.partId));
  if (disallowed.length === 0) {
    return validationReport;
  }

  return ValidationReportSchema.parse({
    ...validationReport,
    status: 'invalid',
    errors: unique([
      ...validationReport.errors,
      ...disallowed.map((component) =>
        `CONTEXT_CANDIDATE_PART_NOT_ALLOWED: ${component.partId} was not selected by the current context route and cannot be used in this circuit draft.`
      )
    ]),
    warnings: unique([
      ...validationReport.warnings,
      'CONTEXT_CANDIDATE_PART_WARNING: Circuit drafts may only use parts selected by the current ContextPacket candidateParts.'
    ]),
    validatedCurrentPathIds: []
  });
}

function coverageAllowsValidCircuitSynthesis(contextCoverage: ContextCoverageReport) {
  if (contextCoverage.sufficientFor?.length > 0) {
    return contextCoverage.sufficientFor.includes('valid_circuit_synthesis');
  }

  return contextCoverage.status === 'sufficient';
}

export async function buildNetlist(spec: CircuitSpec): Promise<Netlist> {
  const parts = await getPartRegistry();
  const partsById = new Map(parts.map((part) => [part.id, part]));
  const componentsById = new Map(spec.components.map((component) => [component.id, component]));
  const nets = spec.connections.map((connection) => {
    const endpoints = [
      `${connection.from.componentId}:${connection.from.pin}`,
      `${connection.to.componentId}:${connection.to.pin}`
    ];
    return {
      id: connection.id,
      kind: netKind(connection, componentsById, partsById),
      endpoints
    };
  });

  return NetlistSchema.parse({ nets });
}

export async function estimateCurrentPaths(
  spec: CircuitSpec,
  _netlist: Netlist,
  validationReport: ValidationReport
): Promise<CurrentPath[]> {
  if (validationReport.status !== 'valid') {
    return [];
  }

  const contexts = await simulationContextsForSpec(spec);
  return compileCurrentPathsForContexts(spec, contexts);
}

export async function detectFaults(spec: CircuitSpec, netlist: Netlist): Promise<ValidationReport> {
  const report = await validateCircuitSpec(spec);
  if (report.status !== 'valid') {
    return report;
  }

  const mixedNets = netlist.nets.filter((net) => net.kind === 'mixed');
  if (mixedNets.length > 0) {
    return ValidationReportSchema.parse({
      status: 'invalid',
      errors: mixedNets.map((net) => `DIRECT_POWER_SHORT: ${net.id} mixes power and ground.`),
      warnings: report.warnings,
      validatedCurrentPathIds: []
    });
  }

  return report;
}

export async function compileRenderPlan(spec: CircuitSpec, validationReport: ValidationReport): Promise<RenderPlan> {
  if (validationReport.status !== 'valid') {
    return RenderPlanSchema.parse({
      title: spec.title,
      runText: spec.behavior.runText,
      parts: [],
      connections: [],
      floatingCards: []
    });
  }

  const [parts, footprints, breadboardGrid] = await Promise.all([
    getPartRegistry(),
    loadRenderFootprints(),
    loadBreadboardGrid()
  ]);
  const partsById = new Map(parts.map((part) => [part.id, part]));
  const renderWarnings: RenderWarning[] = [];
  const renderPartEntries = spec.components.map((component, index) => {
    const part = partsById.get(component.partId);
    const type = part?.renderFootprint.type ?? component.partId;
    const footprint = footprints[type];
    if (!footprint) {
      renderWarnings.push({
        code: 'MISSING_RENDER_FOOTPRINT',
        componentId: component.id,
        message: `${component.label} is validated electrically but has no render footprint in the catalog.`
      });
    }
    return { component, index, part, type, footprint };
  });
  const autoPositions = planDefaultRenderPositions(renderPartEntries, breadboardGrid);
  const renderParts = renderPartEntries.map(({ component, index, part, type, footprint }) => {
    return {
      id: component.id,
      type,
      label: component.label,
      designator: component.designator,
      description: part?.label ?? '',
      pins: (part?.pins ?? []).map((pin) => ({
        name: pin.name,
        role: pin.role,
        meaning: explainPin(pin.role)
      })),
      position: component.position ?? autoPositions.get(component.id) ?? defaultPosition(index),
      footprint
    };
  });
  renderWarnings.push(...auditRenderPlacement(renderParts));
  renderWarnings.push(...auditBreadboardPinTopology(renderParts));
  renderWarnings.push(...auditBreadboardGridSnap(renderParts, breadboardGrid));

  const renderConnections = spec.connections.map((connection) => ({
    id: connection.id,
    from: toRenderEndpoint(connection.from),
    to: toRenderEndpoint(connection.to),
    signal: connection.signal,
    color: connection.color ?? SIGNAL_COLORS[connection.signal] ?? '#2f7df6',
    education: connection.education ?? explainConnection(connection)
  }));
  const endpointLayout = compileEndpointLayout(renderParts, footprints);
  renderWarnings.push(...auditRenderConnections(renderConnections, endpointLayout));
  renderWarnings.push(...auditBreadboardPhysicalNodeConflicts(renderParts, renderConnections, breadboardGrid));
  renderWarnings.push(...auditBreadboardContinuityConflicts(renderParts, renderConnections, breadboardGrid));
  renderWarnings.push(...auditBreadboardRailConflicts(renderParts, renderConnections, breadboardGrid));

  return RenderPlanSchema.parse({
    title: spec.title,
    runText: spec.behavior.runText,
    parts: renderParts,
    connections: renderConnections,
    floatingCards: renderConnections.map((connection) => ({
      connectionId: connection.id,
      label: connection.education.label,
      title: connection.education.title,
      body: connection.education.what
    })),
    warnings: renderWarnings,
    layout: {
      endpoints: endpointLayout
    }
  });
}

export async function compileSimulationPlan(
  spec: CircuitSpec,
  validationReport: ValidationReport,
  currentPaths: CurrentPath[],
  renderPlan?: RenderPlan
): Promise<SimulationPlan> {
  const renderDrcWarnings = renderPlan ? simulationBlockingRenderWarnings(renderPlan) : [];
  const status = validationReport.status === 'valid' && renderDrcWarnings.length === 0
    ? 'valid'
    : validationReport.status === 'unsupported' ? 'unsupported' : 'invalid';
  const warnings = [...validationReport.warnings, ...renderDrcWarnings];
  const validatedCurrentPaths = status === 'valid'
    ? await filterValidatedCurrentPaths(spec, currentPaths, validationReport, warnings)
    : [];

  return SimulationPlanSchema.parse({
    status,
    runText: status === 'valid' ? spec.behavior.runText : '',
    currentPaths: validatedCurrentPaths,
    expectedStates: status === 'valid' ? await inferExpectedStates(spec) : [],
    warnings: unique(warnings)
  });
}

function simulationBlockingRenderWarnings(renderPlan: RenderPlan): string[] {
  return (renderPlan.warnings ?? [])
    .filter((warning) => SIMULATION_BLOCKING_RENDER_WARNING_CODES.has(warning.code))
    .map((warning) => {
      const component = warning.componentId ? ` on ${warning.componentId}` : '';
      return `SIMULATION_BLOCKED_BY_RENDER_DRC: ${warning.code}${component}. ${warning.message}`;
    });
}

export async function compileRequirementMarkdown(
  spec: CircuitSpec,
  validationReport: ValidationReport,
  simulationPlan: SimulationPlan
): Promise<string> {
  const isBuildReady = validationReport.status === 'valid';
  const parts = isBuildReady
    ? spec.components.map((component) => `- ${component.label} (${component.partId})`).join('\n')
    : `- No build-ready parts. Resolve validation status \`${validationReport.status}\` before treating this as a parts list.`;
  const connections = isBuildReady
    ? spec.connections
      .map((connection) => `- **${connection.id}**: ${connection.from.componentId}:${connection.from.pin} -> ${connection.to.componentId}:${connection.to.pin}`)
      .join('\n')
    : `- No build-ready wiring. Resolve validation status \`${validationReport.status}\` before treating this as a wiring guide.`;
  const warnings = [...validationReport.errors, ...validationReport.warnings, ...simulationPlan.warnings]
    .map((message) => `- ${message}`)
    .join('\n') || '- None';
  const current = simulationPlan.currentPaths
    .map(formatCurrentPathForMarkdown)
    .join('\n') || '- No validated current path.';

  return `# Project Requirement: ${spec.title}

_Status: ${validationReport.status}_

## Goal

${spec.intent.primaryGoal}

## Parts Needed

${parts}

## What It Should Do

${spec.behavior.runText}

## Connections

${connections}

## Current Flow

${current}

## Safety And Validation Notes

${warnings}

## Assumptions

${spec.assumptions.map((assumption) => `- ${assumption}`).join('\n') || '- None'}
`;
}

function isDirectPowerShort(
  connection: CircuitSpec['connections'][number],
  componentsById: Map<string, CircuitSpec['components'][number]>,
  partsById: Map<string, PartCapability>
) {
  const roles = [connection.from, connection.to].map((endpoint) => {
    const component = componentsById.get(endpoint.componentId);
    const part = component ? partsById.get(component.partId) : undefined;
    return part?.pins.find((pin) => pin.name === endpoint.pin)?.role;
  });
  return roles.some((role) => isPowerRole(role ?? 'unknown')) && roles.some((role) => isGroundRole(role ?? 'unknown'));
}

function isActiveLoad(part: PartCapability) {
  return part.kind === 'output' || part.kind === 'input';
}

function validateLedClosedSeriesPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const leds = spec.components.filter((component) => component.partId === 'led-5mm');
  const ledIdsBySeriesResistor = new Map<string, string[]>();

  for (const led of leds) {
    const path = findLedSeriesPath(spec, led.id, partsById, componentsById);
    for (const resistorId of path.seriesResistorIds) {
      const ledIds = ledIdsBySeriesResistor.get(resistorId) ?? [];
      ledIds.push(led.id);
      ledIdsBySeriesResistor.set(resistorId, ledIds);
    }
    if (!path.hasControllerSource) {
      errors.push(`LED_CONTROLLER_SOURCE_MISSING: ${led.label} needs an Arduino digital or PWM output feeding the series path.`);
    }
    if (!path.hasAnodeEntry) {
      errors.push(`LED_SERIES_PATH_INCOMPLETE: ${led.label} anode is not connected through the current limiting path.`);
    }
    if (!path.hasSeriesResistor) {
      errors.push(`LED_RESISTOR_NOT_IN_SERIES: ${led.label} needs the current limiting resistor in series before the LED anode.`);
    }
    if (!path.hasCathodeGroundReturn) {
      errors.push(`LED_GROUND_RETURN_MISSING: ${led.label} cathode must return to Arduino GND.`);
    }
    if (path.hasReversedPolarity) {
      errors.push(`LED_POLARITY_REVERSED: ${led.label} appears reversed in the series path.`);
    }
  }

  for (const [resistorId, ledIds] of ledIdsBySeriesResistor.entries()) {
    if (ledIds.length > 1) {
      errors.push(`LED_RESISTOR_SHARED: ${resistorId} is shared by multiple LEDs (${ledIds.join(', ')}). Give each LED its own current limiting resistor path.`);
    }
  }

  return unique(errors);
}

function findLedSeriesPath(
  spec: CircuitSpec,
  ledId: string,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const graph = buildEndpointGraph(spec);
  const controllerIds = new Set(
    spec.components
      .filter((component) => component.partId === 'arduino-uno')
      .map((component) => component.id)
  );
  const controllerSources = spec.connections
    .flatMap((connection) => [connection.from, connection.to])
    .filter((endpoint) => controllerIds.has(endpoint.componentId))
    .filter((endpoint) => {
      const role = roleFor(endpoint, componentsById, partsById);
      return role === 'digital-output' || role === 'pwm-output';
    })
    .map(endpointKey);

  const anodeKey = `${ledId}:A`;
  const cathodeKey = `${ledId}:K`;
  const resistorIds = spec.components
    .filter((component) => component.partId === 'resistor-220')
    .map((component) => component.id);
  const reachableFromSources = reachableEndpointKeys(graph, controllerSources);
  const reachableFromCathode = reachableEndpointKeys(graph, [cathodeKey]);
  const seriesResistorIds = componentIdsOnPathThroughAnyComponent(graph, controllerSources, anodeKey, resistorIds);

  return {
    seriesResistorIds,
    hasControllerSource: controllerSources.length > 0,
    hasAnodeEntry: reachableFromSources.has(anodeKey),
    hasSeriesResistor: seriesResistorIds.length > 0,
    hasCathodeGroundReturn: [...reachableFromCathode].some((key) => {
      const endpoint = endpointFromKey(key);
      return controllerIds.has(endpoint.componentId)
        && roleFor(endpoint, componentsById, partsById) === 'ground';
    }),
    hasReversedPolarity: reachableFromSources.has(cathodeKey)
  };
}

function buildEndpointGraph(spec: CircuitSpec) {
  const graph = new Map<string, Set<string>>();

  for (const connection of spec.connections) {
    const fromKey = endpointKey(connection.from);
    const toKey = endpointKey(connection.to);
    addEdge(graph, fromKey, toKey);
    addEdge(graph, toKey, fromKey);
  }

  for (const component of spec.components) {
    if (component.partId !== 'resistor-220') {
      continue;
    }
    addEdge(graph, `${component.id}:1`, `${component.id}:2`);
    addEdge(graph, `${component.id}:2`, `${component.id}:1`);
  }

  return graph;
}

function reachableEndpointKeys(graph: Map<string, Set<string>>, startKeys: string[]) {
  const visited = new Set<string>();
  const queue = [...startKeys];
  for (const key of startKeys) {
    visited.add(key);
  }

  while (queue.length > 0) {
    const key = queue.shift();
    if (!key) {
      continue;
    }
    for (const next of graph.get(key) ?? []) {
      if (visited.has(next)) {
        continue;
      }
      visited.add(next);
      queue.push(next);
    }
  }

  return visited;
}

function componentIdsOnPathThroughAnyComponent(
  graph: Map<string, Set<string>>,
  startKeys: string[],
  goalKey: string,
  componentIds: string[]
) {
  const requiredComponents = new Set(componentIds);
  if (requiredComponents.size === 0 || startKeys.length === 0) {
    return [];
  }

  const queue = startKeys.map((key) => {
    const componentId = endpointFromKey(key).componentId;
    return {
      key,
      pathKeys: [key],
      matchedComponentIds: requiredComponents.has(componentId) ? [componentId] : []
    };
  });

  while (queue.length > 0) {
    const entry = queue.shift();
    if (!entry) {
      continue;
    }
    if (entry.key === goalKey && entry.matchedComponentIds.length > 0) {
      return unique(entry.matchedComponentIds);
    }

    for (const next of graph.get(entry.key) ?? []) {
      if (entry.pathKeys.includes(next)) {
        continue;
      }
      const componentId = endpointFromKey(next).componentId;
      queue.push({
        key: next,
        pathKeys: [...entry.pathKeys, next],
        matchedComponentIds: requiredComponents.has(componentId)
          ? unique([...entry.matchedComponentIds, componentId])
          : entry.matchedComponentIds
      });
    }
  }

  return [];
}

function endpointFromKey(key: string) {
  const [componentId, ...pinParts] = key.split(':');
  return {
    componentId,
    pin: pinParts.join(':')
  };
}

function componentHasGround(
  componentId: string,
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const graph = new Map<string, Set<string>>();
  const endpointsByKey = new Map<string, CircuitEndpoint>();

  for (const connection of spec.connections) {
    const fromKey = endpointKey(connection.from);
    const toKey = endpointKey(connection.to);
    endpointsByKey.set(fromKey, connection.from);
    endpointsByKey.set(toKey, connection.to);
    addEdge(graph, fromKey, toKey);
    addEdge(graph, toKey, fromKey);
  }

  const queue: string[] = [];
  const visited = new Set<string>();
  for (const endpoint of endpointsByKey.values()) {
    if (endpoint.componentId !== componentId) {
      continue;
    }
    if (!isGroundReturnRole(roleFor(endpoint, componentsById, partsById))) {
      continue;
    }
    const key = endpointKey(endpoint);
    queue.push(key);
    visited.add(key);
  }

  while (queue.length > 0) {
    const key = queue.shift();
    if (!key) {
      continue;
    }
    const endpoint = endpointsByKey.get(key);
    if (endpoint && endpoint.componentId !== componentId && isSourceGround(endpoint, componentsById, partsById)) {
      return true;
    }

    for (const nextKey of graph.get(key) ?? []) {
      if (visited.has(nextKey)) {
        continue;
      }
      visited.add(nextKey);
      queue.push(nextKey);
    }
  }

  return false;
}

type CircuitEndpoint = CircuitSpec['connections'][number]['from'];

function endpointKey(endpoint: CircuitEndpoint) {
  return `${endpoint.componentId}:${endpoint.pin}`;
}

function addEdge(graph: Map<string, Set<string>>, from: string, to: string) {
  const neighbors = graph.get(from) ?? new Set<string>();
  neighbors.add(to);
  graph.set(from, neighbors);
}

function isPowerRole(role: string) {
  return role === 'power' || role === 'power-rail' || role.includes('power');
}

function isGroundRole(role: string) {
  return role === 'ground' || role === 'ground-rail' || role.includes('ground');
}

function isGroundReturnRole(role: string) {
  return isGroundRole(role) || role === 'cathode' || role === 'negative' || role === 'switch-terminal';
}

function isSourceGround(
  endpoint: CircuitEndpoint,
  componentsById: Map<string, CircuitSpec['components'][number]>,
  partsById: Map<string, PartCapability>
) {
  const component = componentsById.get(endpoint.componentId);
  const part = component ? partsById.get(component.partId) : undefined;
  return part?.kind === 'controller' && roleFor(endpoint, componentsById, partsById) === 'ground';
}

function roleFor(
  endpoint: CircuitSpec['connections'][number]['from'],
  componentsById: Map<string, CircuitSpec['components'][number]>,
  partsById: Map<string, PartCapability>
) {
  const component = componentsById.get(endpoint.componentId);
  const part = component ? partsById.get(component.partId) : undefined;
  return part?.pins.find((pin) => pin.name === endpoint.pin)?.role ?? 'unknown';
}

async function inferCurrentPathIds(spec: CircuitSpec) {
  const contexts = await simulationContextsForSpec(spec);
  return compileCurrentPathsForContexts(spec, contexts).map((path) => path.id);
}

async function inferTopologyTemplateForSpec(spec: CircuitSpec) {
  const partIds = new Set(spec.components.map((component) => component.partId));
  const capabilities = (await loadCapabilityGraph()).filter((capability) =>
    capability.supportLevel !== 'unsupported'
    && capability.requiredRoles.length > 0
    && capability.requiredParts.length > 0
    && capability.requiredParts.every((partId) => partIds.has(partId))
  );
  return selectTopologyTemplate({ capabilities });
}

function componentIdForPart(spec: CircuitSpec, partId: string) {
  return spec.components.find((component) => component.partId === partId)?.id ?? partId;
}

type SimulationContext = {
  component: CircuitSpec['components'][number];
  part: PartCapability;
  primitive: SimulationPrimitive;
};

async function simulationContextsForSpec(spec: CircuitSpec): Promise<SimulationContext[]> {
  const [parts, primitives] = await Promise.all([
    getPartRegistry(),
    loadSimulationPrimitives()
  ]);
  const partsById = new Map(parts.map((part) => [part.id, part]));
  const primitivesById = new Map(primitives.map((primitive) => [primitive.id, primitive]));
  const contexts: SimulationContext[] = [];

  for (const component of spec.components) {
    const part = partsById.get(component.partId);
    if (!part || part.kind !== 'output') {
      continue;
    }
    const primitiveId = part.compatibleSimulationPrimitives.find((id) => id !== 'current_flow_animation' && primitivesById.has(id));
    const primitive = primitiveId ? primitivesById.get(primitiveId) : undefined;
    if (primitive) {
      contexts.push({ component, part, primitive });
    }
  }

  return contexts;
}

function compileCurrentPathsFromPrimitive(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const templates = currentPathTemplates(context.primitive);
  if (templates.length > 0) {
    return templates.map((template) => compileTemplatedCurrentPath(spec, context, template));
  }

  return [compileFallbackCurrentPath(spec, context)];
}

function compileCurrentPathsForContexts(spec: CircuitSpec, contexts: SimulationContext[]) {
  const entries = contexts.flatMap((context) =>
    compileCurrentPathsFromPrimitive(spec, context).map((path) => ({
      targetId: context.component.id,
      path
    }))
  );
  const idCounts = entries.reduce((counts, entry) => {
    counts.set(entry.path.id, (counts.get(entry.path.id) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  return entries.map((entry) => {
    if ((idCounts.get(entry.path.id) ?? 0) <= 1) {
      return entry.path;
    }

    return {
      ...entry.path,
      id: `${entry.path.id}:${entry.targetId}`
    };
  });
}

function compileFallbackCurrentPath(spec: CircuitSpec, context: SimulationContext): CurrentPath {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const expectedCurrentMa = context.part.simulationModel.nominalCurrentMa;

  if (context.primitive.currentPathRecipe.type === 'closed-dc-load-path') {
    const passiveIds = requiredPassiveIdsForTarget(spec, targetId, context.part.requiredPassives);
    return {
      id: 'led-forward-current',
      kind: 'load-current',
      primitiveId: context.primitive.id,
      label: 'LED forward current',
      from: resolveControllerSignalEndpoint(spec, targetId, passiveIds, controllerId, 'D9'),
      through: [...passiveIds, targetId],
      to: `${controllerId}:GND`,
      expectedCurrentMa,
      animation: { color: '#ff4d3d', speed: 0.8 }
    };
  }

  if (context.primitive.currentPathRecipe.type === 'pulsed-sound-load-path') {
    return {
      id: 'buzzer-current',
      kind: 'load-current',
      primitiveId: context.primitive.id,
      label: 'Buzzer current',
      from: resolveControllerSignalEndpoint(spec, targetId, [], controllerId, 'D8'),
      through: [targetId],
      to: `${controllerId}:GND`,
      expectedCurrentMa,
      animation: { color: '#f97316', speed: 0.75 }
    };
  }

  if (context.primitive.currentPathRecipe.type === 'actuator-supply-plus-control-signal') {
    return {
      id: 'servo-supply-current',
      kind: 'supply-current',
      primitiveId: context.primitive.id,
      label: 'Servo supply current',
      from: `${controllerId}:5V`,
      through: [targetId],
      to: `${controllerId}:GND`,
      expectedCurrentMa,
      animation: { color: '#f97316', speed: 0.45 }
    };
  }

  return {
    id: 'oled-module-current',
    kind: 'supply-current',
    primitiveId: context.primitive.id,
    label: `${context.part.label} module current`,
    from: `${controllerId}:5V`,
    through: [targetId],
    to: `${controllerId}:GND`,
    expectedCurrentMa,
    animation: { color: '#ff4d3d', speed: 0.65 }
  };
}

function compileTemplatedCurrentPath(
  spec: CircuitSpec,
  context: SimulationContext,
  template: CurrentPathTemplate
): CurrentPath {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const passiveIds = requiredPassiveIdsForTarget(spec, targetId, context.part.requiredPassives);

  return {
    id: template.id,
    kind: template.kind,
    primitiveId: context.primitive.id,
    label: formatPathTemplateLabel(template.label, context.part),
    from: resolveTemplateSourceEndpoint(template, spec, targetId, passiveIds, controllerId),
    through: expandTemplateThrough(template.through, passiveIds, targetId),
    to: resolveTemplateReturnEndpoint(template.returnEndpoint, spec, targetId, passiveIds, controllerId),
    expectedCurrentMa: template.expectedCurrentMa ?? context.part.simulationModel.nominalCurrentMa,
    animation: template.animation
  };
}

type CurrentPathTemplate = NonNullable<SimulationPrimitive['currentPathRecipe']['pathTemplate']>;

function currentPathTemplates(primitive: SimulationPrimitive): CurrentPathTemplate[] {
  return primitive.currentPathRecipe.pathTemplates
    ?? (primitive.currentPathRecipe.pathTemplate ? [primitive.currentPathRecipe.pathTemplate] : []);
}

function requiredPassiveIdsForTarget(
  spec: CircuitSpec,
  targetId: string,
  requiredPassives: PartCapability['requiredPassives']
) {
  const graph = buildEndpointGraph(spec);
  const sourceKeys = controllerSignalEndpointKeys(spec);
  const goalKeys = targetSignalEndpointKeys(spec, targetId);

  return unique(requiredPassives.flatMap((passive) => {
    const candidateIds = spec.components
      .filter((component) => component.partId === passive.partId)
      .map((component) => component.id);

    for (const goalKey of goalKeys) {
      const componentIds = componentIdsOnPathThroughAnyComponent(graph, sourceKeys, goalKey, candidateIds);
      if (componentIds.length > 0) {
        return componentIds;
      }
    }

    return [];
  }));
}

function controllerSignalEndpointKeys(spec: CircuitSpec) {
  const controllerIds = new Set(
    spec.components
      .filter((component) => component.partId === 'arduino-uno')
      .map((component) => component.id)
  );
  return unique(spec.connections
    .flatMap((connection) => [connection.from, connection.to]
      .filter((endpoint) => controllerIds.has(endpoint.componentId))
      .filter(() => !['power', 'ground'].includes(connection.signal))
      .map(endpointKey)));
}

function targetSignalEndpointKeys(spec: CircuitSpec, targetId: string) {
  return unique(spec.connections
    .flatMap((connection) => [connection.from, connection.to]
      .filter((endpoint) => endpoint.componentId === targetId)
      .filter(() => !['power', 'ground'].includes(connection.signal))
      .map(endpointKey)));
}

function resolveTemplateSourceEndpoint(
  template: CurrentPathTemplate,
  spec: CircuitSpec,
  targetId: string,
  passiveIds: string[],
  controllerId: string
) {
  if (template.sourceEndpoint === 'controller-power') {
    return `${controllerId}:5V`;
  }

  return resolveControllerSignalEndpoint(
    spec,
    targetId,
    passiveIds,
    controllerId,
    template.fallbackControllerPin ?? 'D9'
  );
}

function resolveControllerSignalEndpoint(
  spec: CircuitSpec,
  targetId: string,
  passiveIds: string[],
  controllerId: string,
  fallbackPin: string
) {
  const source = findControllerSignalEndpoint(spec, targetId, passiveIds, controllerId);
  if (source) {
    return source;
  }

  const target = spec.components.find((component) => component.id === targetId);
  if (target?.partId === 'led-5mm') {
    throw new Error('Validated LED path is missing an explicit controller source.');
  }

  return `${controllerId}:${fallbackPin}`;
}

function resolveTemplateReturnEndpoint(
  returnEndpoint: CurrentPathTemplate['returnEndpoint'],
  spec: CircuitSpec,
  targetId: string,
  passiveIds: string[],
  controllerId: string
) {
  if (returnEndpoint === 'target-signal') {
    return findTargetSignalEndpoint(spec, targetId, passiveIds, controllerId) ?? `${targetId}:SIG`;
  }
  if (returnEndpoint === 'controller-ground') {
    return `${controllerId}:GND`;
  }
  return `${controllerId}:GND`;
}

function expandTemplateThrough(
  segments: CurrentPathTemplate['through'],
  passiveIds: string[],
  targetId: string
) {
  return segments.flatMap((segment) => {
    if (segment === 'required-passives') {
      return passiveIds;
    }
    return [targetId];
  });
}

function formatPathTemplateLabel(label: string, part: PartCapability) {
  return label.replaceAll('{partLabel}', part.label);
}

function findControllerSignalEndpoint(
  spec: CircuitSpec,
  targetId: string,
  passiveIds: string[] = [],
  controllerId = 'arduino-uno'
) {
  const pathIds = new Set([targetId, ...passiveIds]);
  const connection = spec.connections.find((candidate) => {
    const endpoints = [candidate.from, candidate.to];
    return endpoints.some((endpoint) => endpoint.componentId === controllerId)
      && endpoints.some((endpoint) => pathIds.has(endpoint.componentId))
      && !['power', 'ground'].includes(candidate.signal);
  });
  const endpoint = connection
    ? [connection.from, connection.to].find((candidate) => candidate.componentId === controllerId)
    : undefined;
  return endpoint ? `${endpoint.componentId}:${endpoint.pin}` : null;
}

function findTargetSignalEndpoint(
  spec: CircuitSpec,
  targetId: string,
  passiveIds: string[] = [],
  controllerId = 'arduino-uno'
) {
  const pathIds = new Set([targetId, ...passiveIds]);
  const connection = spec.connections.find((candidate) => {
    const endpoints = [candidate.from, candidate.to];
    return endpoints.some((endpoint) => endpoint.componentId === controllerId)
      && endpoints.some((endpoint) => pathIds.has(endpoint.componentId))
      && !['power', 'ground'].includes(candidate.signal);
  });
  const endpoint = connection
    ? [connection.from, connection.to].find((candidate) => candidate.componentId !== controllerId)
    : undefined;
  return endpoint ? `${endpoint.componentId}:${endpoint.pin}` : null;
}

function netKind(
  connection: CircuitSpec['connections'][number],
  componentsById: Map<string, CircuitSpec['components'][number]>,
  partsById: Map<string, PartCapability>
) {
  const roles = [roleFor(connection.from, componentsById, partsById), roleFor(connection.to, componentsById, partsById)];
  if (roles.some(isPowerRole) && roles.some(isGroundRole)) return 'mixed';
  if (roles.every(isGroundRole)) return 'ground';
  if (roles.some(isPowerRole)) return 'power';
  if (roles.some((role) => role.includes('output'))) return 'power';
  return 'signal';
}

function toRenderEndpoint(endpoint: CircuitSpec['connections'][number]['from']) {
  return {
    partId: endpoint.componentId,
    pin: endpoint.pin
  };
}

function compileEndpointLayout(
  renderParts: RenderPlan['parts'],
  footprints: Record<string, RenderFootprintEntry>
) {
  const endpoints: Record<string, { x: number; y: number; z: number }> = {};
  for (const part of renderParts) {
    const footprint = footprints[part.type];
    if (!footprint) {
      continue;
    }
    for (const [pinName, anchor] of Object.entries(footprint.pinAnchors)) {
      endpoints[`${part.id}:${pinName}`] = {
        x: part.position.x + anchor.x,
        y: part.position.y + anchor.y,
        z: part.position.z + anchor.z
      };
    }
  }
  return endpoints;
}

function auditRenderConnections(
  connections: RenderPlan['connections'],
  endpoints: Record<string, { x: number; y: number; z: number }>
): RenderWarning[] {
  const warnings: RenderWarning[] = [];

  for (const connection of connections) {
    const fromKey = renderEndpointKey(connection.from);
    const toKey = renderEndpointKey(connection.to);
    const fromPoint = endpoints[fromKey];
    const toPoint = endpoints[toKey];

    if (!fromPoint) {
      warnings.push({
        code: 'RENDER_CONNECTION_ENDPOINT_MISSING',
        componentId: connection.from.partId,
        message: `Connection ${connection.id} references ${fromKey}, but that endpoint has no render anchor.`
      });
    }

    if (!toPoint) {
      warnings.push({
        code: 'RENDER_CONNECTION_ENDPOINT_MISSING',
        componentId: connection.to.partId,
        message: `Connection ${connection.id} references ${toKey}, but that endpoint has no render anchor.`
      });
    }

    if (!fromPoint || !toPoint) {
      continue;
    }

    if (distanceBetween(fromPoint, toPoint) < 0.08) {
      warnings.push({
        code: 'RENDER_CONNECTION_TOO_SHORT',
        componentId: connection.from.partId,
        message: `Connection ${connection.id} is too short to render as a trustworthy jumper wire; both ends map to the same render point.`
      });
    }
  }

  return warnings;
}

function renderEndpointKey(endpoint: RenderPlan['connections'][number]['from']) {
  return `${endpoint.partId}:${endpoint.pin}`;
}

function distanceBetween(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number }
) {
  return Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z);
}

export function auditBreadboardPinTopology(renderParts: RenderPlan['parts']): RenderWarning[] {
  const warnings: RenderWarning[] = [];
  const minRowSeparation = 0.12;

  for (const part of renderParts) {
    const footprint = part.footprint;
    if (
      !footprint ||
      footprint.type === 'breadboard' ||
      footprint.type === 'wire' ||
      !footprint.placement.breadboardCompatible
    ) {
      continue;
    }

    const pinRows = Object.values(footprint.pinAnchors)
      .map((anchor) => part.position.z + anchor.z);
    if (pinRows.length < 2) {
      continue;
    }

    const minRow = Math.min(...pinRows);
    const maxRow = Math.max(...pinRows);
    if (maxRow - minRow < minRowSeparation) {
      warnings.push({
        code: 'BREADBOARD_PIN_ROW_COLLAPSE',
        componentId: part.id,
        message: `${part.label} has multiple terminals on the same breadboard row; separate pins across distinct rows before trusting the physical layout.`
      });
    }
  }

  return warnings;
}

export function auditBreadboardGridSnap(
  renderParts: RenderPlan['parts'],
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
): RenderWarning[] {
  const warnings: RenderWarning[] = [];

  for (const part of renderParts) {
    const footprint = part.footprint;
    if (
      !footprint ||
      footprint.type === 'breadboard' ||
      footprint.type === 'wire' ||
      !footprint.placement.breadboardCompatible
    ) {
      continue;
    }

    for (const [pinName, anchor] of Object.entries(footprint.pinAnchors)) {
      const endpoint = {
        x: part.position.x + anchor.x,
        y: part.position.y + anchor.y,
        z: part.position.z + anchor.z
      };

      if (!pointSnapsToSignalGrid(endpoint, grid)) {
        warnings.push({
          code: 'BREADBOARD_PIN_GRID_MISALIGNMENT',
          componentId: part.id,
          message: `${part.label} pin ${pinName} is not aligned to the breadboard hole grid, so the physical placement cannot be trusted.`
        });
        break;
      }
    }
  }

  return warnings;
}

export function auditBreadboardPhysicalNodeConflicts(
  renderParts: RenderPlan['parts'],
  connections: RenderPlan['connections'],
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
): RenderWarning[] {
  const warnings: RenderWarning[] = [];
  const endpointsByNode = new Map<string, Array<{ key: string; partId: string; pin: string }>>();

  for (const part of renderParts) {
    const footprint = part.footprint;
    if (
      !footprint ||
      footprint.type === 'breadboard' ||
      footprint.type === 'wire' ||
      !footprint.placement.breadboardCompatible
    ) {
      continue;
    }

    for (const [pin, anchor] of Object.entries(footprint.pinAnchors)) {
      const nodeId = physicalSignalNodeId({
        x: part.position.x + anchor.x,
        z: part.position.z + anchor.z
      }, grid);
      if (!nodeId) {
        continue;
      }
      const entries = endpointsByNode.get(nodeId) ?? [];
      entries.push({ key: `${part.id}:${pin}`, partId: part.id, pin });
      endpointsByNode.set(nodeId, entries);
    }
  }

  const logicalNet = buildLogicalConnectionGraph(connections);
  for (const [nodeId, endpoints] of endpointsByNode.entries()) {
    if (endpoints.length < 2) {
      continue;
    }

    const conflict = firstUnconnectedPair(endpoints, logicalNet);
    if (!conflict) {
      continue;
    }

    warnings.push({
      code: 'BREADBOARD_PHYSICAL_NODE_CONFLICT',
      componentId: conflict.left.partId,
      message: `${conflict.left.key} and ${conflict.right.key} share the same physical breadboard node (${nodeId}) without a logical connection.`
    });
  }

  return warnings;
}

export function auditBreadboardContinuityConflicts(
  renderParts: RenderPlan['parts'],
  connections: RenderPlan['connections'],
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
): RenderWarning[] {
  const warnings: RenderWarning[] = [];
  const endpointsByContinuityGroup = new Map<string, Array<{
    key: string;
    partId: string;
    pin: string;
    holeId: string;
  }>>();

  for (const part of renderParts) {
    const footprint = part.footprint;
    if (
      !footprint ||
      footprint.type === 'breadboard' ||
      footprint.type === 'wire' ||
      !footprint.placement.breadboardCompatible
    ) {
      continue;
    }

    for (const [pin, anchor] of Object.entries(footprint.pinAnchors)) {
      const point = {
        x: part.position.x + anchor.x,
        z: part.position.z + anchor.z
      };
      const continuityId = physicalSignalContinuityId(point, grid);
      const holeId = physicalSignalNodeId(point, grid);
      if (!continuityId || !holeId) {
        continue;
      }
      const entries = endpointsByContinuityGroup.get(continuityId) ?? [];
      entries.push({ key: `${part.id}:${pin}`, partId: part.id, pin, holeId });
      endpointsByContinuityGroup.set(continuityId, entries);
    }
  }

  const logicalNet = buildLogicalConnectionGraph(connections);
  for (const [continuityId, endpoints] of endpointsByContinuityGroup.entries()) {
    if (endpoints.length < 2) {
      continue;
    }

    const conflict = firstUnconnectedContinuityPair(endpoints, logicalNet);
    if (!conflict) {
      continue;
    }

    warnings.push({
      code: 'BREADBOARD_CONTINUITY_CONFLICT',
      componentId: conflict.left.partId,
      message: `${conflict.left.key} and ${conflict.right.key} share the same breadboard continuity group (${continuityId}) without a logical connection.`
    });
  }

  return warnings;
}

export function auditBreadboardRailConflicts(
  renderParts: RenderPlan['parts'],
  connections: RenderPlan['connections'],
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
): RenderWarning[] {
  const warnings: RenderWarning[] = [];
  const endpointsByRail = new Map<string, Array<{
    key: string;
    partId: string;
    pin: string;
    holeId: string;
  }>>();

  for (const part of renderParts) {
    const footprint = part.footprint;
    if (
      !footprint ||
      footprint.type === 'breadboard' ||
      footprint.type === 'wire' ||
      !footprint.placement.breadboardCompatible
    ) {
      continue;
    }

    for (const [pin, anchor] of Object.entries(footprint.pinAnchors)) {
      const point = {
        x: part.position.x + anchor.x,
        z: part.position.z + anchor.z
      };
      const continuityId = physicalRailContinuityId(point, grid);
      const holeId = physicalRailNodeId(point, grid);
      if (!continuityId || !holeId) {
        continue;
      }
      const entries = endpointsByRail.get(continuityId) ?? [];
      entries.push({ key: `${part.id}:${pin}`, partId: part.id, pin, holeId });
      endpointsByRail.set(continuityId, entries);
    }
  }

  const logicalNet = buildLogicalConnectionGraph(connections);
  for (const [railId, endpoints] of endpointsByRail.entries()) {
    if (endpoints.length < 2) {
      continue;
    }

    const conflict = firstUnconnectedContinuityPair(endpoints, logicalNet);
    if (!conflict) {
      continue;
    }

    warnings.push({
      code: 'BREADBOARD_RAIL_CONFLICT',
      componentId: conflict.left.partId,
      message: `${conflict.left.key} and ${conflict.right.key} share the same breadboard rail (${railId}) without a logical connection.`
    });
  }

  return warnings;
}

function auditRenderPlacement(renderParts: RenderPlan['parts']): RenderWarning[] {
  const warnings: RenderWarning[] = [];
  const breadboard = renderParts.find((part) => part.footprint?.type === 'breadboard');
  const breadboardFootprint = breadboard?.footprint;

  for (const part of renderParts) {
    const footprint = part.footprint;
    if (!footprint || footprint.type === 'breadboard' || footprint.type === 'wire') {
      continue;
    }

    if (!footprint.placement.breadboardCompatible) {
      continue;
    }

    if (!breadboard || !breadboardFootprint) {
      warnings.push({
        code: 'BREADBOARD_PLACEMENT_SURFACE_MISSING',
        componentId: part.id,
        message: `${part.label} needs a breadboard placement surface before the visual placement can be trusted.`
      });
      continue;
    }

    if (!fitsInsideFootprint(part, footprint, breadboard, breadboardFootprint)) {
      warnings.push({
        code: 'BREADBOARD_PLACEMENT_OUT_OF_BOUNDS',
        componentId: part.id,
        message: `${part.label} is outside the breadboard outline, so the visual placement cannot be trusted.`
      });
    }
  }

  return warnings;
}

function fitsInsideFootprint(
  part: RenderPlan['parts'][number],
  footprint: RenderFootprintEntry,
  surface: RenderPlan['parts'][number],
  surfaceFootprint: RenderFootprintEntry
) {
  const epsilon = 0.000001;
  const partBounds = footprintBounds(part.position, footprint);
  const surfaceBounds = footprintBounds(surface.position, surfaceFootprint);

  return partBounds.minX >= surfaceBounds.minX - epsilon
    && partBounds.maxX <= surfaceBounds.maxX + epsilon
    && partBounds.minZ >= surfaceBounds.minZ - epsilon
    && partBounds.maxZ <= surfaceBounds.maxZ + epsilon;
}

function footprintBounds(
  position: RenderPlan['parts'][number]['position'],
  footprint: RenderFootprintEntry
) {
  return {
    minX: position.x - footprint.width / 2,
    maxX: position.x + footprint.width / 2,
    minZ: position.z - footprint.depth / 2,
    maxZ: position.z + footprint.depth / 2
  };
}

function planDefaultRenderPositions(
  entries: RenderPartEntry[],
  breadboardGrid?: Awaited<ReturnType<typeof loadBreadboardGrid>>
) {
  const positions = new Map<string, { x: number; y: number; z: number }>();
  const breadboard = entries.find((entry) => entry.footprint?.type === 'breadboard');
  const breadboardPosition = breadboard?.component.position ?? { x: 0, y: 0, z: 0 };
  const breadboardFootprint = breadboard?.footprint;

  for (const entry of entries) {
    if (entry.component.position) {
      positions.set(entry.component.id, entry.component.position);
    } else if (entry.footprint?.type === 'breadboard') {
      positions.set(entry.component.id, breadboardPosition);
    } else if (entry.footprint?.type === 'arduino') {
      positions.set(entry.component.id, { x: -1.8, y: 0.28, z: 0.1 });
    } else if (entry.footprint?.type === 'servo') {
      positions.set(entry.component.id, { x: -1.85, y: 0.25, z: -1.35 });
    }
  }

  if (!breadboardFootprint) {
    for (const entry of entries) {
      if (!positions.has(entry.component.id)) {
        positions.set(entry.component.id, defaultPosition(entry.index));
      }
    }
    return positions;
  }

  const boardBounds = footprintBounds(breadboardPosition, breadboardFootprint);
  const margin = 0.22;
  const gap = 0.32;
  let cursorX = boardBounds.minX + margin;
  let cursorZ = boardBounds.minZ + margin;
  let rowDepth = 0;
  const placedBreadboardParts: Array<{
    position: { x: number; y: number; z: number };
    footprint: RenderFootprintEntry;
  }> = [];

  for (const entry of entries) {
    const footprint = entry.footprint;
    if (
      !footprint ||
      positions.has(entry.component.id) ||
      !footprint.placement.breadboardCompatible ||
      footprint.type === 'wire'
    ) {
      continue;
    }

    let placedPosition: { x: number; y: number; z: number } | null = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (cursorX + footprint.width > boardBounds.maxX - margin) {
        cursorX = boardBounds.minX + margin;
        cursorZ += rowDepth + gap;
        rowDepth = 0;
      }

      const rawPosition = {
        x: cursorX + footprint.width / 2,
        y: breadboardPosition.y + breadboardFootprint.height + 0.07,
        z: cursorZ + footprint.depth / 2
      };
      const snappedPosition = snapBreadboardPosition(rawPosition, footprint, breadboardGrid);
      if (
        footprintBoundsFitInside(snappedPosition, footprint, boardBounds) &&
        !placementOverlaps(snappedPosition, footprint, placedBreadboardParts, 0.03)
      ) {
        placedPosition = snappedPosition;
        break;
      }

      cursorX += footprint.width + gap;
    }

    placedPosition ??= snapBreadboardPosition({
      x: cursorX + footprint.width / 2,
      y: breadboardPosition.y + breadboardFootprint.height + 0.07,
      z: cursorZ + footprint.depth / 2
    }, footprint, breadboardGrid);

    positions.set(entry.component.id, placedPosition);
    placedBreadboardParts.push({ position: placedPosition, footprint });
    cursorX += footprint.width + gap;
    rowDepth = Math.max(rowDepth, footprint.depth);
  }

  for (const entry of entries) {
    if (!positions.has(entry.component.id)) {
      positions.set(entry.component.id, defaultPosition(entry.index));
    }
  }

  return positions;
}

function footprintBoundsFitInside(
  position: { x: number; y: number; z: number },
  footprint: RenderFootprintEntry,
  bounds: ReturnType<typeof footprintBounds>
) {
  const partBounds = footprintBounds(position, footprint);
  return partBounds.minX >= bounds.minX
    && partBounds.maxX <= bounds.maxX
    && partBounds.minZ >= bounds.minZ
    && partBounds.maxZ <= bounds.maxZ;
}

function placementOverlaps(
  position: { x: number; y: number; z: number },
  footprint: RenderFootprintEntry,
  placedParts: Array<{ position: { x: number; y: number; z: number }; footprint: RenderFootprintEntry }>,
  gap: number
) {
  const bounds = footprintBounds(position, footprint);
  return placedParts.some((part) => {
    const other = footprintBounds(part.position, part.footprint);
    return bounds.minX < other.maxX + gap
      && bounds.maxX + gap > other.minX
      && bounds.minZ < other.maxZ + gap
      && bounds.maxZ + gap > other.minZ;
  });
}

function snapBreadboardPosition(
  position: { x: number; y: number; z: number },
  footprint: RenderFootprintEntry,
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>> | undefined
) {
  if (!grid || !footprint.placement.breadboardCompatible || footprint.type === 'wire') {
    return position;
  }

  return {
    ...position,
    x: snapCenterToGridAxis(
      position.x,
      Object.values(footprint.pinAnchors).map((anchor) => anchor.x),
      grid.signalArea.xStart,
      grid.signalArea.xEnd,
      grid.signalArea.xPitch
    ),
    z: snapCenterToGridRows(
      position.z,
      Object.values(footprint.pinAnchors).map((anchor) => anchor.z),
      grid.signalArea.rows.map((row) => row.z)
    )
  };
}

function snapCenterToGridAxis(
  center: number,
  anchorOffsets: number[],
  start: number,
  end: number,
  pitch: number
) {
  const candidates = anchorOffsets.map((offset) =>
    nearestGridValue(center + offset, start, end, pitch) - offset
  );
  return bestSnapCenter(center, anchorOffsets, candidates, (value) =>
    Math.abs(value - nearestGridValue(value, start, end, pitch))
  );
}

function snapCenterToGridRows(center: number, anchorOffsets: number[], rows: number[]) {
  const candidates = anchorOffsets.map((offset) =>
    nearestRowValue(center + offset, rows) - offset
  );
  return bestSnapCenter(center, anchorOffsets, candidates, (value) =>
    Math.min(...rows.map((row) => Math.abs(value - row)))
  );
}

function bestSnapCenter(
  center: number,
  anchorOffsets: number[],
  candidates: number[],
  distanceToGrid: (value: number) => number
) {
  return candidates
    .map((candidate) => ({
      candidate,
      score: anchorOffsets.reduce((sum, offset) => sum + distanceToGrid(candidate + offset), 0),
      movement: Math.abs(candidate - center)
    }))
    .sort((a, b) => a.score - b.score || a.movement - b.movement)[0]?.candidate ?? center;
}

function pointSnapsToSignalGrid(
  point: { x: number; z: number },
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
) {
  const nearestX = nearestGridValue(point.x, grid.signalArea.xStart, grid.signalArea.xEnd, grid.signalArea.xPitch);
  const nearestRow = nearestSignalRow(point.z, grid);

  return Math.abs(point.x - nearestX) <= grid.signalArea.snapTolerance.x
    && Math.abs(point.z - nearestRow.z) <= grid.signalArea.snapTolerance.z;
}

function physicalSignalNodeId(
  point: { x: number; z: number },
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
) {
  const nearestX = nearestGridValue(point.x, grid.signalArea.xStart, grid.signalArea.xEnd, grid.signalArea.xPitch);
  const nearestRow = nearestSignalRow(point.z, grid);
  if (
    Math.abs(point.x - nearestX) > grid.signalArea.snapTolerance.x ||
    Math.abs(point.z - nearestRow.z) > grid.signalArea.snapTolerance.z
  ) {
    return null;
  }

  return `signal:${nearestX.toFixed(2)}:${nearestRow.id}`;
}

function physicalSignalContinuityId(
  point: { x: number; z: number },
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
) {
  const nearestX = nearestGridValue(point.x, grid.signalArea.xStart, grid.signalArea.xEnd, grid.signalArea.xPitch);
  const nearestRow = nearestSignalRow(point.z, grid);
  if (
    Math.abs(point.x - nearestX) > grid.signalArea.snapTolerance.x ||
    Math.abs(point.z - nearestRow.z) > grid.signalArea.snapTolerance.z
  ) {
    return null;
  }

  return `signal-continuity:${nearestRow.continuityGroup}`;
}

function physicalRailNodeId(
  point: { x: number; z: number },
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
) {
  const nearest = nearestRailHole(point, grid);
  if (!nearest) {
    return null;
  }

  return `rail:${nearest.x.toFixed(2)}:${nearest.id}`;
}

function physicalRailContinuityId(
  point: { x: number; z: number },
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
) {
  const nearest = nearestRailHole(point, grid);
  if (!nearest) {
    return null;
  }

  return `rail-continuity:${nearest.id}`;
}

function nearestRailHole(
  point: { x: number; z: number },
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
) {
  const nearestRail = grid.rails
    .map((rail) => ({ rail, distance: Math.abs(point.z - rail.z) }))
    .sort((left, right) => left.distance - right.distance)[0];
  if (!nearestRail) {
    return null;
  }

  const nearestX = nearestGridValue(
    point.x,
    nearestRail.rail.xStart,
    nearestRail.rail.xEnd,
    nearestRail.rail.xPitch
  );
  if (
    Math.abs(point.x - nearestX) > nearestRail.rail.snapTolerance.x ||
    Math.abs(point.z - nearestRail.rail.z) > nearestRail.rail.snapTolerance.z
  ) {
    return null;
  }

  return {
    id: nearestRail.rail.id,
    role: nearestRail.rail.role,
    x: nearestX,
    z: nearestRail.rail.z
  };
}

function nearestSignalRow(
  z: number,
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>>
) {
  type SignalRowMatch = {
    distance: number;
    z: number;
    id: string;
    continuityGroup: string;
  };

  return grid.signalArea.rows.reduce<SignalRowMatch>((best, row) => {
    const distance = Math.abs(z - row.z);
    return distance < best.distance
      ? { distance, z: row.z, id: row.id, continuityGroup: row.continuityGroup }
      : best;
  }, { distance: Number.POSITIVE_INFINITY, z: 0, id: 'unknown', continuityGroup: 'unknown' });
}

function buildLogicalConnectionGraph(connections: RenderPlan['connections']) {
  const graph = new Map<string, Set<string>>();
  for (const connection of connections) {
    const fromKey = renderEndpointKey(connection.from);
    const toKey = renderEndpointKey(connection.to);
    addGraphEdge(graph, fromKey, toKey);
    addGraphEdge(graph, toKey, fromKey);
  }
  return graph;
}

function addGraphEdge(graph: Map<string, Set<string>>, from: string, to: string) {
  const edges = graph.get(from) ?? new Set<string>();
  edges.add(to);
  graph.set(from, edges);
}

function firstUnconnectedPair(
  endpoints: Array<{ key: string; partId: string; pin: string }>,
  graph: Map<string, Set<string>>
) {
  for (let i = 0; i < endpoints.length; i += 1) {
    for (let j = i + 1; j < endpoints.length; j += 1) {
      if (!logicalEndpointsConnected(endpoints[i].key, endpoints[j].key, graph)) {
        return { left: endpoints[i], right: endpoints[j] };
      }
    }
  }
  return null;
}

function firstUnconnectedContinuityPair(
  endpoints: Array<{ key: string; partId: string; pin: string; holeId: string }>,
  graph: Map<string, Set<string>>
) {
  for (let i = 0; i < endpoints.length; i += 1) {
    for (let j = i + 1; j < endpoints.length; j += 1) {
      if (endpoints[i].holeId === endpoints[j].holeId) {
        continue;
      }
      if (!logicalEndpointsConnected(endpoints[i].key, endpoints[j].key, graph)) {
        return { left: endpoints[i], right: endpoints[j] };
      }
    }
  }
  return null;
}

function logicalEndpointsConnected(left: string, right: string, graph: Map<string, Set<string>>) {
  if (left === right) {
    return true;
  }

  const visited = new Set<string>([left]);
  const queue = [left];
  while (queue.length > 0) {
    const key = queue.shift();
    if (!key) {
      continue;
    }
    for (const next of graph.get(key) ?? []) {
      if (next === right) {
        return true;
      }
      if (visited.has(next)) {
        continue;
      }
      visited.add(next);
      queue.push(next);
    }
  }

  return false;
}

function nearestGridValue(value: number, start: number, end: number, pitch: number) {
  const clamped = Math.max(start, Math.min(end, value));
  const steps = Math.round((clamped - start) / pitch);
  return Number((start + steps * pitch).toFixed(6));
}

function nearestRowValue(value: number, rows: number[]) {
  return rows.reduce((best, row) =>
    Math.abs(value - row) < Math.abs(value - best) ? row : best
  , rows[0] ?? value);
}

function explainConnection(connection: CircuitSpec['connections'][number]) {
  const label = connection.signal.toUpperCase().replaceAll('-', ' ');
  return {
    label,
    title: `This ${connection.signal} connection matters`,
    what: `It connects ${connection.from.componentId}:${connection.from.pin} to ${connection.to.componentId}:${connection.to.pin}.`,
    why: 'The validated circuit needs this path for the lesson behavior.',
    missing: 'If this wire is missing, the simulated behavior may not work.'
  };
}

function explainPin(role: string) {
  if (role.includes('ground')) return 'Completes the return path.';
  if (role.includes('power')) return 'Provides or receives low-voltage power.';
  if (role.includes('i2c')) return 'Carries I2C communication.';
  if (role.includes('pwm')) return 'Carries a timed control signal.';
  return 'Carries a beginner-safe circuit signal.';
}

async function inferExpectedStates(spec: CircuitSpec) {
  const contexts = await simulationContextsForSpec(spec);
  return contexts.map((context) => ({
    componentId: context.component.id,
    state: stateLabelForPrimitive(context.primitive),
    primitiveId: context.primitive.id,
    explanation: context.primitive.expectedStateRecipe.description
  }));
}

function stateLabelForPrimitive(primitive: SimulationPrimitive) {
  const labels: Record<string, string> = {
    display_static_text: 'shows text',
    digital_on_off: 'on or blinking',
    blink_timer: 'on or blinking',
    buzzer_pulse: 'beeping',
    servo_angle: 'moves angle'
  };
  return labels[primitive.id] ?? primitive.expectedStateRecipe.states[0] ?? 'simulated state';
}

function defaultPosition(index: number) {
  const positions = [
    { x: 0, y: 0, z: 0 },
    { x: -1.8, y: 0.28, z: 0.1 },
    { x: 1.65, y: 0.34, z: -0.2 },
    { x: 0.8, y: 0.25, z: 0.55 },
    { x: 1.15, y: 0.25, z: 0.55 },
    { x: -0.2, y: 0.25, z: 0.7 }
  ];
  return positions[index] ?? { x: 0, y: 0.25, z: 0 };
}

function unique(values: string[]) {
  return [...new Set(values)];
}

async function filterValidatedCurrentPaths(
  spec: CircuitSpec,
  currentPaths: CurrentPath[],
  validationReport: ValidationReport,
  warnings: string[]
) {
  const validatedIds = new Set(validationReport.validatedCurrentPathIds);
  const primitiveIds = new Set((await loadSimulationPrimitives()).map((primitive) => primitive.id));
  const renderAnchors = await currentPathRenderAnchorsForSpec(spec);
  const result: CurrentPath[] = [];

  for (const path of currentPaths) {
    if (!validatedIds.has(path.id)) {
      warnings.push(`SIMULATION_PATH_NOT_VALIDATED: ${path.id} is not in validatedCurrentPathIds.`);
      continue;
    }

    if (path.primitiveId && !primitiveIds.has(path.primitiveId)) {
      warnings.push(`SIMULATION_PRIMITIVE_MISSING: ${path.id} references unknown primitive ${path.primitiveId}.`);
      continue;
    }

    const missingEndpoint = [path.from, path.to].find((endpoint) => !renderAnchors.endpointKeys.has(endpoint));
    if (missingEndpoint) {
      warnings.push(`SIMULATION_ENDPOINT_ANCHOR_MISSING: ${path.id} references ${missingEndpoint}, which has no render footprint pin anchor.`);
      continue;
    }

    const missingThroughComponent = path.through.find((componentId) => !renderAnchors.componentIds.has(componentId));
    if (missingThroughComponent) {
      warnings.push(`SIMULATION_PATH_COMPONENT_MISSING: ${path.id} passes through missing component ${missingThroughComponent}.`);
      continue;
    }

    result.push(path);
  }

  return result;
}

async function currentPathRenderAnchorsForSpec(spec: CircuitSpec) {
  const [parts, footprints] = await Promise.all([
    getPartRegistry(),
    loadRenderFootprints()
  ]);
  const partsById = new Map(parts.map((part) => [part.id, part]));
  const componentIds = new Set(spec.components.map((component) => component.id));
  const endpointKeys = new Set<string>();

  for (const component of spec.components) {
    const part = partsById.get(component.partId);
    const footprint = part ? footprints[part.renderFootprint.type] : undefined;
    if (!footprint) {
      continue;
    }

    for (const pinName of Object.keys(footprint.pinAnchors)) {
      endpointKeys.add(`${component.id}:${pinName}`);
    }
  }

  return { endpointKeys, componentIds };
}

function formatCurrentPathForMarkdown(path: CurrentPath) {
  if (path.kind === 'signal-activity' || path.kind === 'bus-activity') {
    return `- ${path.label}: signal activity from ${path.from} to ${path.to}`;
  }
  if (path.kind === 'sensing-divider') {
    return `- ${path.label}: sensing divider from ${path.from} to ${path.to}`;
  }
  if (path.kind === 'fault-current') {
    return `- ${path.label}: fault current warning from ${path.from} to ${path.to}`;
  }
  return `- ${path.label}: about ${path.expectedCurrentMa} mA from ${path.from} to ${path.to}`;
}

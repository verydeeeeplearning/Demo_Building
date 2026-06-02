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
  BuildRunnableReportSchema,
  NetlistSchema,
  RenderPlanSchema,
  SimulationPlanSchema,
  SolverGateResultSchema,
  ValidationReportSchema,
  type BuildRunnableReport,
  type CapabilityGraphEntry,
  type CircuitSpec,
  type ContextCoverageReport,
  type CurrentPath,
  type IntentSpecV2,
  type Netlist,
  type PartCapability,
  type RenderFootprintEntry,
  type RenderPlan,
  type SimulationPlan,
  type SimulationPrimitive,
  type SolverAttempt,
  type SolverGateResult,
  type TopologyTemplate,
  type ValidationReport
} from './schemas.ts';
import {
  partFulfillsInputModality,
  partFulfillsOutputModality,
  requiresConcreteInputFulfillment,
  requiresConcreteOutputFulfillment
} from './modalityFulfillment.ts';

const SIGNAL_COLORS: Record<string, string> = {
  power: '#ff4d3d',
  ground: '#20242a',
  gpio: '#2f7df6',
  digital: '#2f7df6',
  pulse: '#84a9ff',
  'digital-pulse': '#84a9ff',
  analog: '#2f7df6',
  button: '#7c3aed',
  pwm: '#f97316',
  clock: '#f6c44c',
  data: '#2f7df6',
  'chip-select': '#7c3aed',
  'single-wire-data': '#9bd67d',
  'clocked-data': '#9bd67d',
  'spi-data': '#2f7df6',
  spi: '#2f7df6',
  'spi-clock': '#f6c44c',
  uart: '#84a9ff',
  'i2c-data': '#2f7df6',
  'i2c-clock': '#f6c44c'
};

type RenderWarning = {
  code: string;
  componentId?: string;
  message: string;
};

const SIMULATION_BLOCKING_RENDER_WARNING_CODES = new Set([
  'MISSING_RENDER_FOOTPRINT',
  'RENDER_CONNECTION_ENDPOINT_MISSING',
  'RENDER_CONNECTION_TOO_SHORT',
  'SIMULATION_ENDPOINT_ANCHOR_MISSING',
  'SIMULATION_PATH_COMPONENT_MISSING',
  'BREADBOARD_PLACEMENT_SURFACE_MISSING',
  'BREADBOARD_PLACEMENT_OUT_OF_BOUNDS',
  'BREADBOARD_PIN_ROW_COLLAPSE',
  'BREADBOARD_PIN_GRID_MISALIGNMENT',
  'PART_COLLISION',
  'CAMERA_CLIPPING',
  'BREADBOARD_PHYSICAL_NODE_CONFLICT',
  'BREADBOARD_CONTINUITY_CONFLICT',
  'BREADBOARD_RAIL_CONFLICT'
]);

const AUTO_PLACEMENT_REPAIR_WARNING_CODES = new Set([
  'BREADBOARD_PLACEMENT_SURFACE_MISSING',
  'BREADBOARD_PLACEMENT_OUT_OF_BOUNDS',
  'BREADBOARD_PIN_ROW_COLLAPSE',
  'BREADBOARD_PIN_GRID_MISALIGNMENT',
  'PART_COLLISION'
]);

type RenderPartEntry = {
  component: CircuitSpec['components'][number];
  index: number;
  part: PartCapability | undefined;
  type: string;
  footprint: RenderFootprintEntry | undefined;
};

function buildRenderPartsFromEntries(
  entries: RenderPartEntry[],
  autoPositions: Map<string, { x: number; y: number; z: number }>,
  useExplicitPositionHints: boolean
): RenderPlan['parts'] {
  return entries.map(({ component, index, part, type, footprint }) => ({
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
    position: (useExplicitPositionHints ? component.position : undefined)
      ?? autoPositions.get(component.id)
      ?? defaultPosition(index),
    footprint
  }));
}

function auditRenderPlacementPhase(
  renderParts: RenderPlan['parts'],
  breadboardGrid: Awaited<ReturnType<typeof loadBreadboardGrid>>
): RenderWarning[] {
  return [
    ...auditRenderPlacement(renderParts),
    ...auditPartCollisions(renderParts),
    ...auditBreadboardPinTopology(renderParts),
    ...auditBreadboardGridSnap(renderParts, breadboardGrid)
  ];
}

function formatRenderWarning(warning: RenderWarning) {
  const component = warning.componentId ? ` on ${warning.componentId}` : '';
  return `${warning.code}${component}: ${warning.message}`;
}

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
      warnings: ['Current-flow animation is blocked for unsupported requests; renderable parts may be shown as diagnostic context only.'],
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
  errors.push(...validateDirectLowCurrentLoadPaths(spec, partsById, componentsById));
  errors.push(...validateRgbLedCurrentLimitedPaths(spec, partsById, componentsById));
  errors.push(...validatePoweredLightModulePaths(spec, partsById, componentsById));
  errors.push(...validateHBridgeMotorPaths(spec, partsById, componentsById));
  errors.push(...validateLowSideSwitchedLoadPaths(spec, partsById, componentsById));
  errors.push(...validateStepperMotorPaths(spec, partsById, componentsById));
  errors.push(...validateRelayModulePaths(spec, partsById, componentsById));
  errors.push(...validateLowVoltagePowerRailPaths(spec, partsById, componentsById));
  errors.push(...validatePassiveContextPaths(spec, partsById, componentsById));
  errors.push(...validateWp09ContextPaths(spec));
  errors.push(...validateControllerBoardContextPaths(spec));
  errors.push(...validateI2cDisplayPaths(spec, partsById, componentsById));
  errors.push(...validateBareSevenSegmentDisplayPaths(spec, partsById, componentsById));
  errors.push(...validateLedArrayDisplayPaths(spec, partsById, componentsById));
  errors.push(...validateAddressableLedDisplayPaths(spec, partsById, componentsById));
  errors.push(...validateSpiDisplayPaths(spec, partsById, componentsById));
  errors.push(...validateAnalogInputPaths(spec, partsById, componentsById));
  errors.push(...validateAnalogSensorDisplayPaths(spec, partsById, componentsById));
  errors.push(...validateResistiveSensorDividerPaths(spec, partsById, componentsById));
  errors.push(...validateDistanceSensorDisplayPaths(spec, partsById, componentsById));
  errors.push(...validateSingleWireSensorDisplayPaths(spec, partsById, componentsById));
  errors.push(...validateI2cProtocolSensorDisplayPaths(spec, partsById, componentsById));
  errors.push(...validateClockedDataSensorDisplayPaths(spec, partsById, componentsById));
  errors.push(...validateSpiProtocolSensorDisplayPaths(spec, partsById, componentsById));
  errors.push(...validateUartProtocolSensorDisplayPaths(spec, partsById, componentsById));
  errors.push(...validateProtocolSensorClaimSafety(spec));
  errors.push(...validateUartCommunicationModulePaths(spec, partsById, componentsById));
  errors.push(...validateSpiCommunicationModulePaths(spec, partsById, componentsById));
  errors.push(...validateDifferentialCommunicationModulePaths(spec, partsById, componentsById));
  errors.push(...validateCommunicationModuleClaimSafety(spec));
  errors.push(...validateLogicInterfaceContextPaths(spec, partsById, componentsById));
  errors.push(...validateLogicInterfaceClaimSafety(spec));
  errors.push(...validateDigitalInputStatePaths(spec, partsById, componentsById));
  errors.push(...validateMatrixInputDisplayPaths(spec, partsById, componentsById));
  errors.push(...validateJoystickDisplayPaths(spec, partsById, componentsById));
  errors.push(...validateRotaryEncoderDisplayPaths(spec, partsById, componentsById));

  if (spec.components.some((component) => ANALOG_DIMMER_INPUT_PART_IDS.has(component.partId)) && !hasPwmLedOutputPath(spec, partsById, componentsById)) {
    errors.push('ANALOG_DIMMER_PWM_OUTPUT_MISSING: Potentiometer brightness control needs the LED series path to start from an Arduino PWM pin such as D9.');
  }

  if (spec.components.some((component) => component.partId === 'photoresistor-ldr') && !hasThresholdLanguage(spec)) {
    errors.push('ANALOG_THRESHOLD_BEHAVIOR_MISSING: Light sensor output needs an explicit threshold behavior such as dark -> LED on.');
  }

  if (spec.components.some((component) => ANALOG_SENSOR_MODULE_PART_IDS.has(component.partId)) && hasThresholdLanguage(spec) && !hasAnalogThresholdOutputPath(spec, partsById, componentsById)) {
    errors.push('ANALOG_THRESHOLD_OUTPUT_MISSING: Analog sensor threshold circuits need a current-limited LED output path.');
  }

  for (const component of spec.components) {
    const part = partsById.get(component.partId);
    if (!part || !isActiveLoad(part)) {
      continue;
    }
    if (LOW_SIDE_LOAD_PART_IDS.has(component.partId)) {
      continue;
    }
    if (STEPPER_MOTOR_PART_IDS.has(component.partId)) {
      continue;
    }
    if (!componentHasGround(component.id, spec, partsById, componentsById)) {
      errors.push(`MISSING_COMMON_GROUND: ${component.label} needs a ground return path.`);
    }
  }

  if (spec.components.some((component) => SERVO_ACTUATOR_PART_IDS.has(component.partId))) {
    warnings.push('SERVO_CURRENT_WARNING: Real servos may need a separate 5V supply.');
  }

  if (spec.components.some((component) => HIGH_TORQUE_SERVO_PART_IDS.has(component.partId))) {
    warnings.push('SERVO_HIGH_TORQUE_POWER_WARNING: High-torque servos such as MG996R are simulated qualitatively and need an external 5-6V supply with common ground in real builds.');
  }

  for (const component of spec.components.filter((candidate) => LOW_SIDE_LOAD_PART_IDS.has(candidate.partId))) {
    warnings.push(`LOW_SIDE_LOAD_POWER_WARNING: ${component.label} is simulated qualitatively; real motor-like loads need current budgeting, suitable power, and common ground.`);
    if (!LOW_SIDE_INTEGRATED_LOAD_PART_IDS.has(component.partId)) {
      warnings.push(`INDUCTIVE_LOAD_FLYBACK_WARNING: ${component.label} requires real flyback/protection design outside this educational simulation.`);
    }
  }

  for (const component of spec.components.filter((candidate) => STEPPER_MOTOR_PART_IDS.has(candidate.partId))) {
    warnings.push(`STEPPER_POWER_WARNING: ${component.label} is simulated qualitatively; real stepper builds need a driver, suitable supply, common ground, and current-limit setup.`);
  }

  for (const component of spec.components.filter((candidate) => STEPPER_DRIVER_PART_IDS.has(candidate.partId))) {
    warnings.push(`STEPPER_DRIVER_QUALITATIVE_ONLY: ${component.label} is modeled as an educational driver path, not torque, heat, microstep, or current-limit sizing.`);
  }

  for (const component of spec.components.filter((candidate) => HBRIDGE_MOTOR_LOAD_PART_IDS.has(candidate.partId))) {
    warnings.push(`HBRIDGE_MOTOR_POWER_WARNING: ${component.label} is simulated qualitatively; real H-bridge motor builds need current budgeting, suitable power, common ground, and thermal design.`);
  }

  for (const component of spec.components.filter((candidate) => HBRIDGE_DRIVER_PART_IDS.has(candidate.partId))) {
    warnings.push(`HBRIDGE_DRIVER_QUALITATIVE_ONLY: ${component.label} is modeled as an educational direction-control driver path, not stall-current, torque, speed, heat, or braking physics.`);
  }

  for (const component of spec.components.filter((candidate) => RELAY_MODULE_PART_IDS.has(candidate.partId))) {
    warnings.push(`RELAY_LOW_VOLTAGE_ONLY_WARNING: ${component.label} is simulated only with low-voltage classroom loads; mains, outlets, and wall power are blocked.`);
  }

  for (const component of spec.components.filter((candidate) => LOW_VOLTAGE_POWER_RAIL_PART_IDS.has(candidate.partId))) {
    warnings.push(`LOW_VOLTAGE_POWER_RAIL_QUALITATIVE_ONLY: ${component.label} is modeled as a qualitative educational rail state, not a real current budget or power supply rating.`);
  }

  for (const component of spec.components.filter((candidate) => LIPO_BATTERY_PART_IDS.has(candidate.partId))) {
    warnings.push(`LIPO_POWER_WARNING: ${component.label} is modeled only as a declared low-voltage source; charging, shorting, puncturing, and high-current load design are blocked.`);
  }

  for (const component of spec.components.filter((candidate) => VOLTAGE_REGULATOR_PART_IDS.has(candidate.partId))) {
    warnings.push(`REGULATOR_QUALITATIVE_ONLY: ${component.label} is modeled as a qualitative 5V regulator path, not thermal, dropout, or current-limit analysis.`);
  }

  if (spec.components.some((component) => component.partId === 'laser-diode-module')) {
    warnings.push('LASER_MODULE_SAFETY_WARNING: The laser module is simulated as a low-voltage classroom indicator; real lasers require eye-safety precautions.');
  }

  for (const component of spec.components.filter((candidate) => ANALOG_SENSOR_EDUCATIONAL_WARNING_PART_IDS.has(candidate.partId))) {
    warnings.push(`ANALOG_SENSOR_EDUCATIONAL_ONLY: ${component.label} is modeled as a low-voltage educational signal source, not a safety alarm or protection device.`);
  }

  for (const component of spec.components.filter((candidate) => RESISTIVE_SENSOR_PART_IDS.has(candidate.partId))) {
    warnings.push(`RESISTIVE_SENSOR_QUALITATIVE_ONLY: ${component.label} is modeled as a qualitative divider input, not a calibrated force or temperature instrument.`);
  }

  for (const component of spec.components.filter((candidate) => PASSIVE_PROTECTION_CONTEXT_PART_IDS.has(candidate.partId))) {
    warnings.push(`PASSIVE_CONTEXT_STATE_ONLY: ${component.label} is rendered as passive/protection context only; no active load current or real protection performance is simulated.`);
  }

  for (const component of spec.components.filter((candidate) => TIMING_PASSIVE_CONTEXT_PART_IDS.has(candidate.partId))) {
    warnings.push(`TIMING_PASSIVE_CONTEXT_ONLY: ${component.label} is rendered as timing context only; oscillator startup, waveform timing, and frequency accuracy are not simulated.`);
  }

  for (const component of spec.components.filter((candidate) => PROTOTYPING_SURFACE_CONTEXT_PART_IDS.has(candidate.partId))) {
    warnings.push(`PROTOTYPING_SURFACE_STATE_ONLY: ${component.label} is rendered as placement/build context only; it does not energize rails, create hidden nets, or imply solder bridges.`);
  }

  for (const component of spec.components.filter((candidate) => CONNECTOR_WIRING_CONTEXT_PART_IDS.has(candidate.partId))) {
    warnings.push(`CONNECTOR_CONTEXT_STATE_ONLY: ${component.label} is rendered as connector/wiring context only; it does not act as a voltage source or create a current path by itself.`);
  }

  for (const component of spec.components.filter((candidate) => CONTROLLER_BOARD_CONTEXT_PART_IDS.has(candidate.partId))) {
    warnings.push(`CONTROLLER_BOARD_CONTEXT_STATE_ONLY: ${component.label} is rendered as board-specific pin-map and voltage-domain context only; validated circuit substitution requires a circuit bundle that explicitly allows this controller.`);
    if (['esp32-devkit', 'esp8266-nodemcu', 'raspberry-pi-pico', 'stm32-bluepill', 'teensy40'].includes(component.partId)) {
      warnings.push(`CONTROLLER_BOARD_3V3_DOMAIN: ${component.label} uses a 3.3V logic-domain context; do not assume 5V Arduino Uno GPIO compatibility.`);
    }
  }

  for (const component of spec.components.filter((candidate) => LOGIC_INTERFACE_PART_IDS.has(candidate.partId))) {
    if (LEVEL_SHIFTER_INTERFACE_PART_IDS.has(component.partId)) {
      warnings.push(`LEVEL_SHIFTER_CONTEXT_ONLY: ${component.label} is modeled as a single visible HV1/LV1 voltage-domain signal context, not a regulator or current booster.`);
    } else {
      warnings.push(`LOGIC_INTERFACE_QUALITATIVE_ONLY: ${component.label} is modeled as qualitative interface state, not precision analog, exact timing, hidden output-load, or chip-level electrical simulation.`);
    }
  }

  for (const component of spec.components.filter((candidate) => DIGITAL_INPUT_STATE_PART_IDS.has(candidate.partId))) {
    warnings.push(`DIGITAL_INPUT_QUALITATIVE_ONLY: ${component.label} is modeled as a qualitative active/inactive input state, not a calibrated sensor or decoded protocol.`);
  }

  for (const component of spec.components.filter((candidate) => MATRIX_INPUT_PART_IDS.has(candidate.partId))) {
    warnings.push(`MATRIX_INPUT_QUALITATIVE_ONLY: ${component.label} is modeled as qualitative key/switch state, not debounce timing or contact physics.`);
  }

  for (const component of spec.components.filter((candidate) => JOYSTICK_PART_IDS.has(candidate.partId))) {
    warnings.push(`JOYSTICK_QUALITATIVE_ONLY: ${component.label} is modeled as qualitative X/Y position and switch state, not calibrated force or HID behavior.`);
  }

  for (const component of spec.components.filter((candidate) => ROTARY_ENCODER_PART_IDS.has(candidate.partId))) {
    warnings.push(`ROTARY_ENCODER_QUALITATIVE_ONLY: ${component.label} is modeled as qualitative direction/count state, not contact bounce timing.`);
  }

  for (const component of spec.components.filter((candidate) => partsById.get(candidate.partId)?.capabilities.includes('protocol-sensor'))) {
    warnings.push(`PROTOCOL_SENSOR_QUALITATIVE_ONLY: ${component.label} is modeled as a qualitative classroom readout; it is not a calibrated, certified, medical, navigation, tracking, payment, or security instrument.`);
  }

  for (const component of spec.components.filter((candidate) => COMMUNICATION_MODULE_PART_IDS.has(candidate.partId))) {
    warnings.push(`COMMUNICATION_MODULE_QUALITATIVE_ONLY: ${component.label} is modeled as local command/bus state only; real networking, pairing, RF range, SMS/calls, USB devices, vehicle networks, and backend services are outside this simulation.`);
    if (POWER_WARNING_COMMUNICATION_MODULE_PART_IDS.has(component.partId)) {
      warnings.push(`COMMUNICATION_MODULE_POWER_WARNING: ${component.label} needs real power budgeting and voltage-domain care outside the educational simulation.`);
    }
  }

  for (const component of spec.components.filter((candidate) => BARE_SEVEN_SEGMENT_DISPLAY_PART_IDS.has(candidate.partId))) {
    warnings.push(`BARE_SEVEN_SEGMENT_QUALITATIVE_ONLY: ${component.label} is modeled as qualitative current-limited segment state, not a full commercial package or multiplexed display.`);
  }

  for (const component of spec.components.filter((candidate) => LED_ARRAY_DISPLAY_PART_IDS.has(candidate.partId))) {
    warnings.push(`LED_ARRAY_DISPLAY_QUALITATIVE_ONLY: ${component.label} is modeled as a qualitative number or pattern display, not chip-accurate driver timing.`);
  }

  for (const component of spec.components.filter((candidate) => ADDRESSABLE_LED_DISPLAY_PART_IDS.has(candidate.partId))) {
    warnings.push(`ADDRESSABLE_LED_POWER_WARNING: ${component.label} is modeled at educational brightness; real full-brightness addressable LEDs may need external 5V power budgeting.`);
  }

  for (const component of spec.components.filter((candidate) => SPI_DISPLAY_PART_IDS.has(candidate.partId))) {
    warnings.push(`SPI_DISPLAY_QUALITATIVE_ONLY: ${component.label} is modeled as a qualitative display state, not pixel-perfect driver timing or framebuffer emulation.`);
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
      `CONTEXT_COVERAGE_INSUFFICIENT: The agent did not have enough verified context data to safely finalize this circuit. ${coverageSummary}`
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

export function applyIntentFulfillmentGate(
  validationReport: ValidationReport,
  spec: CircuitSpec,
  intentSpec: IntentSpecV2,
  candidateParts: PartCapability[] = []
): ValidationReport {
  if (validationReport.status !== 'valid' && validationReport.status !== 'valid_with_warnings') {
    return validationReport;
  }

  const partsById = new Map(candidateParts.map((part) => [part.id, part]));
  const usedParts = spec.components
    .map((component) => partsById.get(component.partId))
    .filter((part): part is PartCapability => Boolean(part));
  const missingInputModalities = unique(intentSpec.inputModalities)
    .filter(requiresConcreteInputFulfillment)
    .filter((modality) => !usedParts.some((part) => partFulfillsInputModality(part, modality)));
  const missingOutputModalities = unique(intentSpec.outputModalities)
    .filter(requiresConcreteOutputFulfillment)
    .filter((modality) => !usedParts.some((part) => partFulfillsOutputModality(part, modality)));

  if (missingInputModalities.length === 0 && missingOutputModalities.length === 0) {
    return validationReport;
  }

  return ValidationReportSchema.parse({
    ...validationReport,
    status: 'invalid',
    errors: unique([
      ...validationReport.errors,
      ...missingInputModalities.map((modality) =>
        `INTENT_INPUT_NOT_FULFILLED: The student requested ${modality}, but the final circuit draft does not include a matching input part.`
      ),
      ...missingOutputModalities.map((modality) =>
        `INTENT_OUTPUT_NOT_FULFILLED: The student requested ${modality}, but the final circuit draft does not include a matching output part.`
      )
    ]),
    warnings: unique([
      ...validationReport.warnings,
      'INTENT_FULFILLMENT_WARNING: Runnable simulations must preserve the student requested input/output modality instead of silently substituting a simpler circuit.'
    ]),
    validatedCurrentPathIds: []
  });
}

// Intent-modality fulfillment predicates live in ./modalityFulfillment.ts (single source of truth,
// shared with composition selection). RC-A widened the generic↔specific mapping there.

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
  if (validationReport.status === 'unsupported' && isClarificationOnlySpec(spec)) {
    return RenderPlanSchema.parse({
      title: spec.title,
      runText: spec.behavior.runText,
      parts: [],
      connections: [],
      floatingCards: []
    });
  }
  const diagnosticRenderOnly = validationReport.status !== 'valid';

  const [parts, footprints, breadboardGrid] = await Promise.all([
    getPartRegistry(),
    loadRenderFootprints(),
    loadBreadboardGrid()
  ]);
  const partsById = new Map(parts.map((part) => [part.id, part]));
  const renderWarnings: RenderWarning[] = diagnosticRenderOnly
    ? [{
        code: 'DIAGNOSTIC_RENDER_ONLY',
        message: `Validation status is ${validationReport.status}; renderable hardware is shown for diagnosis only and is not build-ready.`
      }]
    : [];
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
  const hintedAutoPositions = planDefaultRenderPositions(renderPartEntries, breadboardGrid, {
    useExplicitPositionHints: true
  });
  const repairedAutoPositions = planDefaultRenderPositions(renderPartEntries, breadboardGrid, {
    useExplicitPositionHints: false
  });
  const hasExplicitPositionHints = renderPartEntries.some(({ component }) => Boolean(component.position));
  const hintedRenderParts = buildRenderPartsFromEntries(renderPartEntries, hintedAutoPositions, true);
  const hintedPlacementWarnings = auditRenderPlacementPhase(hintedRenderParts, breadboardGrid);
  const hintedRepairWarnings = hintedPlacementWarnings.filter((warning) =>
    AUTO_PLACEMENT_REPAIR_WARNING_CODES.has(warning.code)
  );
  const repairExplicitPositions = hasExplicitPositionHints && hintedRepairWarnings.length > 0;
  const renderParts = repairExplicitPositions
    ? buildRenderPartsFromEntries(renderPartEntries, repairedAutoPositions, false)
    : hintedRenderParts;
  const placementWarnings = auditRenderPlacementPhase(renderParts, breadboardGrid);
  const placementRepairStillBlocked = placementWarnings.some((warning) =>
    AUTO_PLACEMENT_REPAIR_WARNING_CODES.has(warning.code)
  );
  const solverAttempts: SolverAttempt[] = [{
    attempt: 1,
    stage: 'placement',
    action: repairExplicitPositions
      ? 'Rejected explicit component position hints after placement DRC found a physical layout violation; rebuilt placement from deterministic footprint and breadboard constraints.'
      : hasExplicitPositionHints
        ? 'Accepted explicit component position hints after placement DRC.'
        : 'Generated deterministic component placement from footprint, surface, and breadboard-grid constraints.',
    result: repairExplicitPositions
      ? placementRepairStillBlocked ? 'degraded' : 'repaired'
      : placementRepairStillBlocked ? 'degraded' : 'passed',
    warnings: repairExplicitPositions
      ? unique([
          ...hintedRepairWarnings.map(formatRenderWarning),
          ...placementWarnings.filter((warning) => AUTO_PLACEMENT_REPAIR_WARNING_CODES.has(warning.code)).map(formatRenderWarning)
        ])
      : placementWarnings.filter((warning) => AUTO_PLACEMENT_REPAIR_WARNING_CODES.has(warning.code)).map(formatRenderWarning)
  }];
  renderWarnings.push(...placementWarnings);

  const baseRenderConnections = spec.connections.map((connection) => ({
    id: connection.id,
    from: toRenderEndpoint(connection.from),
    to: toRenderEndpoint(connection.to),
    signal: connection.signal,
    color: connection.color ?? SIGNAL_COLORS[connection.signal] ?? '#2f7df6',
    education: connection.education ?? explainConnection(connection)
  }));
  const endpointLayout = compileEndpointLayout(renderParts, footprints);
  const renderConnections = baseRenderConnections.map((connection, index) => ({
    ...connection,
    route: compileConnectionRoute(connection, endpointLayout, index)
  }));
  const connectionWarnings = auditRenderConnections(renderConnections, endpointLayout);
  renderWarnings.push(...connectionWarnings);
  const unroutedConnections = renderConnections.filter((connection) => !connection.route);
  solverAttempts.push({
    attempt: solverAttempts.length + 1,
    stage: 'routing',
    action: unroutedConnections.length === 0
      ? 'Generated server-routed wire polylines from resolved endpoint anchors.'
      : 'Some wire endpoints were missing render anchors, so those routes are diagnostic rather than verified.',
    result: unroutedConnections.length === 0 && connectionWarnings.length === 0 ? 'passed' : 'degraded',
    warnings: unique([
      ...unroutedConnections.map((connection) => `Connection ${connection.id} has no server-verified route.`),
      ...connectionWarnings.map(formatRenderWarning)
    ])
  });
  renderWarnings.push(...auditBreadboardPhysicalNodeConflicts(renderParts, renderConnections, breadboardGrid));
  renderWarnings.push(...auditBreadboardContinuityConflicts(renderParts, renderConnections, breadboardGrid));
  renderWarnings.push(...auditBreadboardRailConflicts(renderParts, renderConnections, breadboardGrid));
  const labelLayoutResult = compileLabelLayout(renderParts);
  const labelLayout = labelLayoutResult.labels;
  const labelWarnings = auditLabelLayout(renderParts, labelLayout);
  renderWarnings.push(...labelWarnings);
  solverAttempts.push({
    attempt: solverAttempts.length + 1,
    stage: 'label',
    action: labelLayoutResult.repositionedLabelCount > 0
      ? `Repositioned ${labelLayoutResult.repositionedLabelCount} label(s) away from candidate overlap zones.`
      : 'Placed labels at their primary footprint anchors.',
    result: labelWarnings.length > 0
      ? 'degraded'
      : labelLayoutResult.repositionedLabelCount > 0 ? 'repaired' : 'passed',
    warnings: labelWarnings.map(formatRenderWarning)
  });
  const bounds = compileSceneBounds(renderParts, endpointLayout, labelLayout);
  const camera = compileCameraFit(bounds);
  const cameraWarnings = auditRenderCameraFit(bounds, camera);
  renderWarnings.push(...cameraWarnings);
  solverAttempts.push({
    attempt: solverAttempts.length + 1,
    stage: 'camera',
    action: 'Generated camera fit from final scene bounds, endpoints, and labels.',
    result: cameraWarnings.length > 0 ? 'degraded' : 'passed',
    warnings: cameraWarnings.map(formatRenderWarning)
  });

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
      endpoints: endpointLayout,
      labels: labelLayout,
      bounds,
      camera,
      solverAttempts
    }
  });
}

function isClarificationOnlySpec(spec: CircuitSpec) {
  return spec.unsupportedItems.some((item) => item === 'clarification-required');
}

export async function compileSimulationPlan(
  spec: CircuitSpec,
  validationReport: ValidationReport,
  currentPaths: CurrentPath[],
  renderPlan: RenderPlan
): Promise<SimulationPlan> {
  if (!renderPlan) {
    return SimulationPlanSchema.parse({
      status: validationReport.status === 'unsupported' ? 'unsupported' : 'invalid',
      runText: '',
      currentPaths: [],
      expectedStates: [],
      warnings: unique([
        ...validationReport.warnings,
        'SIMULATION_RENDER_PLAN_REQUIRED: Current/signal simulation cannot be verified without render DRC evidence.'
      ])
    });
  }

  const warnings = [...validationReport.warnings];
  const candidateCurrentPaths = validationReport.status === 'valid'
    ? await filterValidatedCurrentPaths(spec, currentPaths, validationReport, warnings)
    : [];
  renderPlan.warnings = uniqueRenderWarnings([
    ...(renderPlan.warnings ?? []),
    ...auditSimulationPathRenderCoverage(renderPlan, candidateCurrentPaths)
  ]);
  const renderDrcWarnings = simulationBlockingRenderWarnings(renderPlan);
  let status = validationReport.status === 'valid' && renderDrcWarnings.length === 0
    ? 'valid'
    : validationReport.status === 'unsupported' ? 'unsupported' : 'invalid';
  warnings.push(...renderDrcWarnings);
  let validatedCurrentPaths = status === 'valid'
    ? candidateCurrentPaths
    : [];

  if (status === 'valid') {
    const missingValidatedPathIds = missingValidatedSimulationPathIds(
      validationReport.validatedCurrentPathIds,
      validatedCurrentPaths
    );
    if (missingValidatedPathIds.length > 0) {
      warnings.push(`SIMULATION_VALIDATED_PATH_MISSING: ${missingValidatedPathIds.join(', ')} were declared by validation but removed before simulation.`);
      status = 'invalid';
      validatedCurrentPaths = [];
    }
  }

  if (status === 'valid') {
    const requiredPathWarnings = await simulationRequiredPathWarnings(spec, validationReport, validatedCurrentPaths);
    if (requiredPathWarnings.length > 0) {
      warnings.push(...requiredPathWarnings);
      status = 'invalid';
      validatedCurrentPaths = [];
    }
  }

  return SimulationPlanSchema.parse({
    status,
    runText: status === 'valid' ? spec.behavior.runText : '',
    currentPaths: validatedCurrentPaths,
    expectedStates: status === 'valid' ? await inferExpectedStates(spec) : [],
    warnings: unique(warnings)
  });
}

export function buildRunnableReport(
  validationReport: ValidationReport,
  renderPlan: RenderPlan,
  simulationPlan: SimulationPlan
): BuildRunnableReport {
  const renderBlockingWarnings = (renderPlan.warnings ?? []).filter((warning) =>
    SIMULATION_BLOCKING_RENDER_WARNING_CODES.has(warning.code)
  );
  const reasons: string[] = [];

  if (validationReport.status !== 'valid') {
    reasons.push(`validation status is ${validationReport.status}`);
    reasons.push(...validationReport.errors);
  }
  if (renderPlan.parts.length === 0) {
    reasons.push('render plan has no build-ready parts');
  }
  for (const warning of renderBlockingWarnings) {
    const component = warning.componentId ? ` on ${warning.componentId}` : '';
    reasons.push(`${warning.code}${component}: ${warning.message}`);
  }
  if (simulationPlan.status !== 'valid') {
    reasons.push(`simulation status is ${simulationPlan.status}`);
    reasons.push(...simulationPlan.warnings);
  }
  const missingValidatedPathIds = missingValidatedSimulationPathIds(
    validationReport.validatedCurrentPathIds,
    simulationPlan.currentPaths
  );
  if (simulationPlan.status === 'valid' && missingValidatedPathIds.length > 0) {
    reasons.push(`SIMULATION_REQUIRED_EVIDENCE_MISSING: missing validated current or signal path ids ${missingValidatedPathIds.join(', ')}`);
  }
  const requiresCurrentOrSignalPath = validationReport.validatedCurrentPathIds.length > 0;
  const hasCurrentOrSignalPath = simulationPlan.currentPaths.length > 0;
  const hasStateEvidence = simulationPlan.expectedStates.length > 0;
  const hasRunnableSimulationEvidence = hasCurrentOrSignalPath || (!requiresCurrentOrSignalPath && hasStateEvidence);

  if (simulationPlan.status === 'valid' && !hasRunnableSimulationEvidence) {
    reasons.push('simulation has no validated current or signal path');
  }

  const runnable = reasons.length === 0
    && validationReport.status === 'valid'
    && renderPlan.parts.length > 0
    && simulationPlan.status === 'valid'
    && hasRunnableSimulationEvidence;

  return BuildRunnableReportSchema.parse({
    status: runnable ? 'runnable' : 'blocked',
    runnable,
    reasons: unique(reasons),
    validationStatus: validationReport.status,
    simulationStatus: simulationPlan.status,
    renderWarningCount: renderPlan.warnings.length,
    renderBlockingWarningCount: renderBlockingWarnings.length,
    renderPartCount: renderPlan.parts.length,
    currentPathCount: simulationPlan.currentPaths.length,
    expectedStateCount: simulationPlan.expectedStates.length
  });
}

export function buildSolverGateResult(
  validationReport: ValidationReport,
  renderPlan: RenderPlan,
  simulationPlan: SimulationPlan,
  buildRunnable: BuildRunnableReport,
  options: {
    mode?: SolverGateResult['mode'];
    repairLevel?: SolverGateResult['repairLevel'];
    sourceSpecId?: string;
    repairedSpecId?: string;
    equivalentSpecId?: string;
    verifiedClaims?: string[];
    notVerified?: string[];
    repairSummary?: string[];
    presentationAdjustment?: SolverGateResult['presentationAdjustment'];
    buildReadyScope?: SolverGateResult['buildReadyScope'];
    safeToRenderEvidence?: string[];
    controls?: SolverGateResult['controls'];
  } = {}
): SolverGateResult {
  const visibleSimulation = renderPlan.parts.length > 0;
  const buildReady = buildRunnable.runnable;
  const visualWarnings = renderPlan.warnings ?? [];
  const renderSolverAttempts = renderPlan.layout?.solverAttempts ?? [];
  const repairedSolverStages = unique(renderSolverAttempts
    .filter((attempt) => attempt.result === 'repaired')
    .map((attempt) => attempt.stage));
  const degradedSolverStages = unique(renderSolverAttempts
    .filter((attempt) => attempt.result === 'degraded')
    .map((attempt) => attempt.stage));
  const hasCurrentEvidence = simulationPlan.currentPaths.some((path) =>
    simulationPlan.status === 'valid' && ['load-current', 'supply-current', 'sensing-divider'].includes(path.kind)
  );
  const hasSignalEvidence = simulationPlan.currentPaths.some((path) =>
    simulationPlan.status === 'valid' && ['signal-activity', 'bus-activity'].includes(path.kind)
  );
  const stateEvidence = solverStateEvidence(validationReport, renderPlan, simulationPlan);
  const hasPlaceholderVisualWarning = visualWarnings.some((warning) =>
    warning.code === 'MISSING_RENDER_FOOTPRINT'
  );
  const simulationActivity = hasCurrentEvidence
    ? 'verified_current'
    : hasSignalEvidence
      ? 'verified_signal'
      : stateEvidence.length > 0
        ? 'state_only'
        : 'diagnostic';
  const mode = options.mode ?? (buildReady
    ? repairedSolverStages.length > 0 ? 'auto_repaired_simulation' : 'verified_build_simulation'
    : hasPlaceholderVisualWarning ? 'placeholder_part_simulation' : 'diagnostic_simulation');
  const buildReadyScope = options.buildReadyScope ?? inferBuildReadyScope(mode, buildReady);
  const notVerified = unique([
    ...(!visibleSimulation ? ['visible 3D scene is not yet available because the render plan has no parts'] : []),
    ...(!buildReady ? ['build-ready claim is not verified'] : []),
    ...(mode === 'safe_equivalent_simulation' ? ['original request is not build-ready; build-ready claims apply only to the displayed safe equivalent'] : []),
    ...(!buildReady && degradedSolverStages.length > 0 ? [`render solver adjusted ${degradedSolverStages.join(', ')} stage(s) for review-only presentation`] : []),
    ...buildRunnable.reasons,
    ...(options.notVerified ?? []),
    'bench test has not been performed'
  ]);
  const repairLevel = options.repairLevel ?? (
    hasPlaceholderVisualWarning ? 'placeholder' : inferSolverRepairLevel(renderSolverAttempts)
  );
  const verifiedClaims = unique([
    ...(visibleSimulation ? [`render plan exposes ${renderPlan.parts.length} visible part(s)`] : []),
    ...(repairedSolverStages.length > 0 ? [`render solver repaired ${repairedSolverStages.join(', ')} stage(s)`] : []),
    ...(options.verifiedClaims ?? []),
    ...(buildReady && validationReport.status === 'valid' ? [`${solverClaimSubject(mode)} validation status is valid`] : []),
    ...(buildReady && simulationPlan.status === 'valid' ? [`${solverClaimSubject(mode)} simulation plan status is valid`] : []),
    ...(buildReady ? [`${solverClaimSubject(mode)} build-ready runnable gate passed`] : []),
    ...(simulationPlan.status === 'valid' && simulationPlan.currentPaths.length > 0 ? [`${simulationPlan.currentPaths.length} current/signal path(s) are available`] : []),
    ...(stateEvidence.length > 0 ? stateEvidence.map((evidence) => `state/context evidence: ${evidence}`) : [])
  ]);
  const safeToRenderEvidence = options.safeToRenderEvidence ?? solverSafeToRenderEvidence({
    validationReport,
    renderPlan,
    simulationPlan,
    mode,
    stateEvidence
  });
  const controls = options.controls ?? solverGateControls({
    buildReady,
    visibleSimulation,
    simulationActivity,
    buildReadyScope
  });
  const presentationAdjustment = options.presentationAdjustment ?? solverPresentationAdjustment({
    mode,
    simulationActivity,
    sourceSpecId: options.sourceSpecId,
    equivalentSpecId: options.equivalentSpecId,
    buildReady,
    renderPlan,
    visualWarnings,
    stateEvidence,
    verifiedClaims,
    notVerified,
    hardwareWarnings: unique([...validationReport.warnings, ...simulationPlan.warnings])
  });

  const attempts = renderSolverAttempts.length > 0
    ? [...renderSolverAttempts]
    : [];
  if (!buildReady) {
    attempts.push({
      attempt: attempts.length + 1,
      stage: 'degrade',
      action: visibleSimulation
        ? 'Expose the available scene as an automatically adjusted review view while keeping build-ready claims strict.'
        : 'No visible scene is available yet; keep strict evidence reasons until a diagnostic or safe-equivalent scene can be rendered.',
      result: 'degraded',
      warnings: notVerified
    });
  }

  return SolverGateResultSchema.parse({
    visibleSimulation,
    mode,
    buildReady,
    simulationActivity,
    benchConfirmed: false,
    sourceSpecId: options.sourceSpecId,
    repairedSpecId: options.repairedSpecId,
    equivalentSpecId: options.equivalentSpecId,
    repairLevel,
    attempts,
    verifiedClaims,
    notVerified,
    visualWarnings,
    hardwareWarnings: unique([...validationReport.warnings, ...simulationPlan.warnings]),
    repairSummary: options.repairSummary?.length
      ? unique([...options.repairSummary, ...solverRepairSummary(buildReady, visibleSimulation, repairedSolverStages, degradedSolverStages)])
      : solverRepairSummary(buildReady, visibleSimulation, repairedSolverStages, degradedSolverStages),
    presentationAdjustment,
    buildReadyScope,
    safeToRenderEvidence,
    controls
  });
}

function inferBuildReadyScope(
  mode: SolverGateResult['mode'],
  buildReady: boolean
): SolverGateResult['buildReadyScope'] {
  if (!buildReady) {
    return 'none';
  }
  return mode === 'safe_equivalent_simulation' ? 'displayed_equivalent' : 'original';
}

function solverClaimSubject(mode: SolverGateResult['mode']) {
  return mode === 'safe_equivalent_simulation' ? 'displayed safe equivalent' : 'circuit';
}

function solverGateControls(input: {
  buildReady: boolean;
  visibleSimulation: boolean;
  simulationActivity: SolverGateResult['simulationActivity'];
  buildReadyScope: SolverGateResult['buildReadyScope'];
}): SolverGateResult['controls'] {
  const hasVerifiedActivity = input.simulationActivity === 'verified_current' || input.simulationActivity === 'verified_signal';
  const buildReadyClaimIsScoped = input.buildReadyScope === 'original' || input.buildReadyScope === 'displayed_equivalent';
  return {
    runEnabled: input.buildReady && buildReadyClaimIsScoped && hasVerifiedActivity,
    currentAnimationEnabled: input.buildReady && buildReadyClaimIsScoped && hasVerifiedActivity,
    hardwareMoveEnabled: false,
    visualMoveEnabled: input.visibleSimulation,
    shareEnabled: input.visibleSimulation
  };
}

function solverStateEvidence(
  validationReport: ValidationReport,
  _renderPlan: RenderPlan,
  simulationPlan: SimulationPlan
): string[] {
  const evidence: string[] = [];
  if (simulationPlan.status === 'valid' && simulationPlan.expectedStates.length > 0) {
    evidence.push(`${simulationPlan.expectedStates.length} expected state(s) are available`);
  }
  const contextWarnings = unique([...validationReport.warnings, ...simulationPlan.warnings])
    .map(stateEvidenceFromWarning)
    .filter((item): item is string => Boolean(item));
  return unique([...evidence, ...contextWarnings]);
}

function stateEvidenceFromWarning(warning: string): string | null {
  if (!/STATE_ONLY|CONTEXT_ONLY|CONTEXT_STATE_ONLY|PIN-?MAP|LAYOUT_CONTEXT/i.test(warning)) {
    return null;
  }
  return warning.split(':')[0]?.trim() || warning;
}

function solverSafeToRenderEvidence(input: {
  validationReport: ValidationReport;
  renderPlan: RenderPlan;
  simulationPlan: SimulationPlan;
  mode: SolverGateResult['mode'];
  stateEvidence: string[];
}): string[] {
  if (input.renderPlan.parts.length === 0) {
    return [];
  }

  return unique([
    `render plan exposes ${input.renderPlan.parts.length} visible part(s)`,
    ...(input.validationReport.status === 'valid'
      ? ['validation evidence is available for claim scoping']
      : [`validation status ${input.validationReport.status} is preserved as review-only evidence`]),
    ...(input.simulationPlan.status === 'valid'
      ? ['simulation evidence is available for activity scoping']
      : [`simulation status ${input.simulationPlan.status} is preserved as review-only evidence`]),
    ...((input.renderPlan.warnings ?? []).length > 0 ? ['render warnings are preserved for visible review overlays'] : []),
    ...(input.mode === 'safe_equivalent_simulation'
      ? ['original unsafe request is separated from the displayed safe equivalent']
      : []),
    ...(input.mode === 'placeholder_part_simulation'
      ? ['placeholder metadata disables exact geometry and pin-geometry claims']
      : []),
    ...input.stateEvidence.map((evidence) => `state/context evidence: ${evidence}`)
  ]);
}

function solverPresentationAdjustment(input: {
  mode: SolverGateResult['mode'];
  simulationActivity: SolverGateResult['simulationActivity'];
  sourceSpecId?: string;
  equivalentSpecId?: string;
  buildReady: boolean;
  renderPlan: RenderPlan;
  visualWarnings: RenderWarning[];
  stateEvidence: string[];
  verifiedClaims: string[];
  notVerified: string[];
  hardwareWarnings: string[];
}): SolverGateResult['presentationAdjustment'] {
  if (input.mode === 'safe_equivalent_simulation') {
    return {
      kind: 'safe_equivalent_simulation',
      originalSpecId: input.sourceSpecId ?? 'original-request',
      equivalentSpecId: input.equivalentSpecId ?? 'displayed-safe-equivalent',
      originalBuildReady: false,
      displayedEquivalentBuildReady: input.buildReady,
      blockedOriginalReasons: input.notVerified.filter((reason) => /original|unsafe|not build-ready|not converted/i.test(reason)).length > 0
        ? input.notVerified.filter((reason) => /original|unsafe|not build-ready|not converted/i.test(reason))
        : ['original request is outside the safe classroom build-ready scope'],
      equivalenceClaims: input.verifiedClaims,
      nonEquivalentWarnings: input.hardwareWarnings,
      reason: 'The original request is not build-ready; the visible build-ready scope belongs only to the displayed safe equivalent.'
    };
  }

  if (input.mode === 'placeholder_part_simulation') {
    const placeholderPartIds = placeholderPartIdsForRenderPlan(input.renderPlan, input.visualWarnings);
    return {
      kind: 'placeholder_part_simulation',
      placeholderPartIds,
      placeholderFootprintId: 'stage-generic-part-profile',
      missingEvidence: placeholderMissingEvidence(input.visualWarnings, placeholderPartIds),
      exactGeometryClaim: false,
      pinGeometryClaim: false,
      reason: 'A safe generic placeholder is visible while exact footprint and pin-geometry evidence remain unverified.'
    };
  }

  if (input.simulationActivity === 'state_only') {
    return {
      kind: 'state_only',
      stateEvidence: input.stateEvidence,
      reason: 'Static state/context evidence is meaningful, but current-flow animation is not claimed.'
    };
  }

  if (input.buildReady) {
    return {
      kind: 'none',
      reason: 'verified_build'
    };
  }

  return {
    kind: 'diagnostic_simulation',
    reason: 'A safe review scene is visible while strict build-ready and runtime claims remain gated.',
    visibleOverlays: unique(input.visualWarnings.map((warning) => warning.code))
  };
}

function placeholderPartIdsForRenderPlan(
  renderPlan: RenderPlan,
  visualWarnings: RenderWarning[]
): string[] {
  return unique([
    ...visualWarnings
      .filter((warning) => warning.code === 'MISSING_RENDER_FOOTPRINT' && warning.componentId)
      .map((warning) => warning.componentId as string),
    ...renderPlan.parts
      .filter((part) => !part.footprint)
      .map((part) => part.id)
  ]);
}

function placeholderMissingEvidence(
  visualWarnings: RenderWarning[],
  placeholderPartIds: string[]
): string[] {
  const warningEvidence = visualWarnings
    .filter((warning) => warning.code === 'MISSING_RENDER_FOOTPRINT')
    .map((warning) => `${warning.code}${warning.componentId ? ` on ${warning.componentId}` : ''}: ${warning.message}`);
  if (warningEvidence.length > 0) {
    return unique(warningEvidence);
  }
  if (placeholderPartIds.length > 0) {
    return placeholderPartIds.map((id) => `exact footprint and pin geometry are missing for ${id}`);
  }
  return ['exact footprint and pin geometry are missing'];
}

function inferSolverRepairLevel(attempts: SolverAttempt[]): SolverGateResult['repairLevel'] {
  if (attempts.some((attempt) => attempt.result === 'repaired' && attempt.stage === 'routing')) {
    return 'routing';
  }
  if (attempts.some((attempt) => attempt.result === 'repaired' && ['placement', 'camera', 'label'].includes(attempt.stage))) {
    return 'layout';
  }
  return 'none';
}

function solverRepairSummary(
  buildReady: boolean,
  visibleSimulation: boolean,
  repairedSolverStages: string[],
  degradedSolverStages: string[]
) {
  const summary: string[] = [];
  if (repairedSolverStages.length > 0) {
    summary.push(`Solver automatically repaired ${repairedSolverStages.join(', ')} stage(s) before returning the scene.`);
  }
  if (degradedSolverStages.length > 0) {
    summary.push(`Solver adjusted ${degradedSolverStages.join(', ')} stage(s) and marked affected claims as review-only.`);
  }
  if (summary.length === 0 && buildReady) {
    summary.push('No solver repair was required; all strict gates passed.');
  }
  if (summary.length === 0 && !buildReady && visibleSimulation) {
    summary.push('Review scene is visible while strict build-ready claims remain under automatic adjustment.');
  }
  if (summary.length === 0) {
    summary.push('No visible scene is available yet; diagnostic/safe-equivalent rendering is still required.');
  }
  return summary;
}

function missingValidatedSimulationPathIds(requiredIds: string[], currentPaths: CurrentPath[]) {
  const currentPathIds = new Set(currentPaths.map((path) => path.id));
  return unique(requiredIds)
    .filter((id) => !currentPathIds.has(id) && ![...currentPathIds].some((pathId) => pathId.startsWith(`${id}:`)));
}

function simulationBlockingRenderWarnings(renderPlan: RenderPlan): string[] {
  return (renderPlan.warnings ?? [])
    .filter((warning) => SIMULATION_BLOCKING_RENDER_WARNING_CODES.has(warning.code))
    .map((warning) => {
      const component = warning.componentId ? ` on ${warning.componentId}` : '';
      return `SIMULATION_BLOCKED_BY_RENDER_DRC: ${warning.code}${component}. ${warning.message}`;
    });
}

function auditSimulationPathRenderCoverage(
  renderPlan: RenderPlan,
  currentPaths: CurrentPath[]
): RenderWarning[] {
  const componentIds = new Set(renderPlan.parts.map((part) => part.id));
  const endpointKeys = new Set(Object.keys(renderPlan.layout?.endpoints ?? {}));
  const warnings: RenderWarning[] = [];

  for (const path of currentPaths) {
    for (const endpoint of [path.from, path.to]) {
      if (endpointKeys.has(endpoint)) {
        continue;
      }

      warnings.push({
        code: 'SIMULATION_ENDPOINT_ANCHOR_MISSING',
        componentId: endpointComponentId(endpoint),
        message: `Current path ${path.id} references ${endpoint}, but that endpoint has no render anchor.`
      });
    }

    for (const componentId of path.through) {
      if (componentIds.has(componentId)) {
        continue;
      }

      warnings.push({
        code: 'SIMULATION_PATH_COMPONENT_MISSING',
        componentId,
        message: `Current path ${path.id} passes through ${componentId}, but that component is not rendered.`
      });
    }
  }

  return warnings;
}

function endpointComponentId(endpoint: string) {
  return endpoint.split(':')[0] || undefined;
}

function uniqueRenderWarnings(warnings: RenderWarning[]) {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.componentId ?? ''}:${warning.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export async function compileRequirementMarkdown(
  spec: CircuitSpec,
  validationReport: ValidationReport,
  simulationPlan: SimulationPlan,
  buildRunnable: BuildRunnableReport
): Promise<string> {
  const buildBlockedReasons = buildRunnable.runnable === false ? buildRunnable.reasons : [];
  const isBuildReady = buildRunnable.runnable;
  const buildGateStatus = `\n\n_Build runnable: ${buildRunnable.status}_`;
  const blockedReasonText = buildBlockedReasons.length > 0
    ? ` Build runnable gate blocked this draft: ${buildBlockedReasons.join(' ')}`
    : '';
  const parts = isBuildReady
    ? spec.components.map((component) => `- ${component.label} (${component.partId})`).join('\n')
    : `- No build-ready parts. Resolve validation status \`${validationReport.status}\`, simulation status \`${simulationPlan.status}\`, and runnable gate status \`${buildRunnable.status}\` before treating this as a parts list.${blockedReasonText}`;
  const connections = isBuildReady
    ? spec.connections
      .map((connection) => `- **${connection.id}**: ${connection.from.componentId}:${connection.from.pin} -> ${connection.to.componentId}:${connection.to.pin}`)
      .join('\n')
    : `- No build-ready wiring. Resolve validation status \`${validationReport.status}\`, simulation status \`${simulationPlan.status}\`, and runnable gate status \`${buildRunnable.status}\` before treating this as a wiring guide.${blockedReasonText}`;
  const warnings = [...validationReport.errors, ...validationReport.warnings, ...simulationPlan.warnings, ...buildBlockedReasons]
    .map((message) => `- ${message}`)
    .join('\n') || '- None';
  const current = isBuildReady
    ? simulationPlan.currentPaths
      .map(formatCurrentPathForMarkdown)
      .join('\n') || '- No validated current path.'
    : `- Current-flow details are hidden until the runnable gate passes. Current runnable gate status: \`${buildRunnable.status}\`.${blockedReasonText}`;

  return `# Project Requirement: ${spec.title}

_Status: ${validationReport.status}_

_Simulation: ${simulationPlan.status}_${buildGateStatus}

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
  if (part.capabilities.includes('resistive-sensor')) {
    return false;
  }
  if (part.capabilities.includes('passive-matrix-input')) {
    return false;
  }
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
  const relayControlledLedIds = new Set(resolveRelayModulePaths(spec, partsById, componentsById)
    .map((path) => path.loadId)
    .filter((loadId): loadId is string => Boolean(loadId)));

  for (const led of leds) {
    if (relayControlledLedIds.has(led.id)) {
      continue;
    }
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

function validateDirectLowCurrentLoadPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];

  for (const component of spec.components.filter((candidate) => DIRECT_LOW_CURRENT_LOAD_PART_IDS.has(candidate.partId))) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }
    const inputPin = firstPinNameForRole(part, (role) =>
      role === 'positive' || role === 'digital-input' || role === 'input'
    ) ?? part.pins.find((pin) => !isGroundRole(pin.role))?.name;
    const groundPin = firstPinNameForRole(part, isGroundRole);

    if (!inputPin || !endpointReachesAnyControllerRole(spec, `${component.id}:${inputPin}`, ['digital-output', 'pwm-output'], partsById, componentsById)) {
      errors.push(`DIRECT_LOAD_SIGNAL_MISSING: ${component.label} needs its driven pin connected to an Arduino digital output.`);
    }
    if (!groundPin || !endpointReachesControllerRole(spec, `${component.id}:${groundPin}`, 'ground', partsById, componentsById)) {
      errors.push(`DIRECT_LOAD_GROUND_MISSING: ${component.label} needs a ground return to Arduino GND.`);
    }
  }

  return unique(errors);
}

function validateRgbLedCurrentLimitedPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const graph = buildEndpointGraph(spec);
  const resistorIds = spec.components
    .filter((component) => component.partId === 'resistor-220')
    .map((component) => component.id);
  const controllerOutputs = controllerEndpointKeysWithRole(spec, ['digital-output', 'pwm-output'], partsById, componentsById);
  const channelIdsByResistor = new Map<string, string[]>();

  for (const component of spec.components.filter((candidate) => RGB_LED_PART_IDS.has(candidate.partId))) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }

    const groundPin = firstPinNameForRole(part, isGroundRole) ?? 'GND';
    const channelPins = rgbLedChannelPins(part);
    let validChannelPaths = 0;

    if (!endpointReachesControllerRole(spec, `${component.id}:${groundPin}`, 'ground', partsById, componentsById)) {
      errors.push(`RGB_LED_GROUND_MISSING: ${component.label} common cathode must return to Arduino GND.`);
    }

    for (const pin of channelPins) {
      const channelKey = `${component.id}:${pin}`;
      const reachesOutput = endpointReachesAnyControllerRoleInGraph(
        graph,
        channelKey,
        ['digital-output', 'pwm-output'],
        partsById,
        componentsById
      );
      if (!reachesOutput) {
        continue;
      }

      const seriesResistorIds = componentIdsOnPathThroughAnyComponent(graph, controllerOutputs, channelKey, resistorIds);
      if (seriesResistorIds.length === 0) {
        errors.push(`RGB_LED_CHANNEL_RESISTOR_MISSING: ${component.label} channel ${pin} must be driven through its own 220 ohm resistor.`);
        continue;
      }

      validChannelPaths += 1;
      for (const resistorId of seriesResistorIds) {
        const channelIds = channelIdsByResistor.get(resistorId) ?? [];
        channelIds.push(`${component.id}:${pin}`);
        channelIdsByResistor.set(resistorId, channelIds);
      }
    }

    if (validChannelPaths === 0) {
      errors.push(`RGB_LED_SIGNAL_MISSING: ${component.label} needs at least one R/G/B channel connected to an Arduino output through a 220 ohm resistor.`);
    }
  }

  for (const [resistorId, channelIds] of channelIdsByResistor.entries()) {
    if (channelIds.length > 1) {
      errors.push(`RGB_LED_RESISTOR_SHARED: ${resistorId} is shared by multiple RGB channels (${channelIds.join(', ')}). Give each driven channel its own current limiting resistor.`);
    }
  }

  return unique(errors);
}

function validatePoweredLightModulePaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];

  for (const component of spec.components.filter((candidate) => POWERED_LIGHT_MODULE_PART_IDS.has(candidate.partId))) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }

    const powerPin = firstPinNameForRole(part, isPowerRole) ?? 'VCC';
    const groundPin = firstPinNameForRole(part, isGroundRole) ?? 'GND';
    const signalPin = firstPinNameForRole(part, (role) => role === 'digital-input' || role === 'data' || role === 'signal') ?? 'S';

    if (!endpointReachesControllerRole(spec, `${component.id}:${powerPin}`, 'power', partsById, componentsById)) {
      errors.push(`POWERED_LIGHT_POWER_MISSING: ${component.label} needs ${powerPin} connected to Arduino 5V.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:${groundPin}`, 'ground', partsById, componentsById)) {
      errors.push(`POWERED_LIGHT_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`);
    }
    if (!endpointReachesAnyControllerRole(spec, `${component.id}:${signalPin}`, ['digital-output', 'pwm-output'], partsById, componentsById)) {
      errors.push(`POWERED_LIGHT_SIGNAL_MISSING: ${component.label} needs ${signalPin} connected to an Arduino digital output pin.`);
    }
  }

  return unique(errors);
}

type LowSideSwitchedLoadPath = {
  topologyId: 'controller-transistor-low-side-load' | 'controller-mosfet-module-load';
  loadId: string;
  loadHighPin: string;
  loadLowPin: string;
  driverId?: string;
  driverPartId?: string;
  driverInputPin?: string;
  baseResistorIds: string[];
  controlEndpoint: string;
  controlTargetEndpoint: string;
};

function validateLowSideSwitchedLoadPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const graph = buildEndpointGraph(spec);
  const lowSideLoads = spec.components.filter((candidate) => LOW_SIDE_LOAD_PART_IDS.has(candidate.partId));
  const hasDiscreteDriver = spec.components.some((candidate) => LOW_SIDE_DISCRETE_DRIVER_PART_IDS.has(candidate.partId));
  const hasMosfetDriver = spec.components.some((candidate) => LOW_SIDE_MOSFET_MODULE_PART_IDS.has(candidate.partId));
  const hasHBridgeDriver = spec.components.some((candidate) => HBRIDGE_DRIVER_PART_IDS.has(candidate.partId));

  for (const load of lowSideLoads) {
    const part = partsById.get(load.partId);
    if (!part) {
      continue;
    }

    const path = resolveLowSideSwitchedLoadPath(spec, load, partsById, componentsById);
    if (path || (hasHBridgeDriver && HBRIDGE_MOTOR_LOAD_PART_IDS.has(load.partId))) {
      continue;
    }

    const loadPins = lowSideLoadPins(part);
    const loadEndpointKeys = [loadPins.highPin, loadPins.lowPin]
      .filter(Boolean)
      .map((pin) => `${load.id}:${pin}`);
    const directToGpio = loadEndpointKeys.some((key) =>
      endpointReachesAnyControllerRoleInGraph(
        graph,
        key,
        ['digital-output', 'pwm-output'],
        partsById,
        componentsById
      )
    );

    if (directToGpio) {
      errors.push(`MOTOR_DIRECT_TO_GPIO: ${load.label} must not be driven directly from Arduino GPIO; use a transistor or MOSFET low-side driver.`);
    } else if (!hasDiscreteDriver && !hasMosfetDriver && !LOW_SIDE_INTEGRATED_LOAD_PART_IDS.has(load.partId)) {
      errors.push(`LOW_SIDE_DRIVER_MISSING: ${load.label} needs a validated low-side transistor or MOSFET driver path.`);
    } else {
      errors.push(`LOW_SIDE_DRIVER_PATH_INVALID: ${load.label} needs power, switched return, driver control, and common ground on one validated low-side path.`);
    }

    if (hasDiscreteDriver && hasTransistorBaseSignalWithoutResistor(spec, graph, partsById, componentsById)) {
      errors.push(`LOW_SIDE_BASE_RESISTOR_MISSING: ${load.label} needs a resistor between the Arduino output and the 2N2222 base.`);
    }

    if (hasMosfetDriver && !hasMosfetModuleControlSignal(spec, partsById, componentsById)) {
      errors.push(`MOSFET_MODULE_SIGNAL_MISSING: ${load.label} needs the IRF520 SIG pin connected to an Arduino digital or PWM output.`);
    }
  }

  return unique(errors);
}

function resolveLowSideSwitchedLoadPath(
  spec: CircuitSpec,
  load: CircuitSpec['components'][number],
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
): LowSideSwitchedLoadPath | null {
  const part = partsById.get(load.partId);
  if (!part || !LOW_SIDE_LOAD_PART_IDS.has(load.partId)) {
    return null;
  }

  if (LOW_SIDE_INTEGRATED_LOAD_PART_IDS.has(load.partId)) {
    return resolveIntegratedSwitchedLoadPath(spec, load, part, partsById, componentsById);
  }

  return resolveMosfetModuleSwitchedLoadPath(spec, load, part, partsById, componentsById)
    ?? resolveDiscreteTransistorSwitchedLoadPath(spec, load, part, partsById, componentsById);
}

function resolveIntegratedSwitchedLoadPath(
  spec: CircuitSpec,
  load: CircuitSpec['components'][number],
  part: PartCapability,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
): LowSideSwitchedLoadPath | null {
  const powerPin = firstPinNameForRole(part, isPowerRole) ?? 'VCC';
  const groundPin = firstPinNameForRole(part, isGroundRole) ?? 'GND';
  const signalPin = firstPinNameForRole(part, (role) => role === 'digital-input' || role === 'data' || role === 'signal') ?? 'IN';
  const hasPower = endpointReachesControllerRole(spec, `${load.id}:${powerPin}`, 'power', partsById, componentsById);
  const hasGround = endpointReachesControllerRole(spec, `${load.id}:${groundPin}`, 'ground', partsById, componentsById);
  const controlEndpoint = findConnectedControllerEndpointWithAnyRole(spec, load.id, signalPin, ['digital-output', 'pwm-output']);

  if (!hasPower || !hasGround || !controlEndpoint) {
    return null;
  }

  return {
    topologyId: 'controller-mosfet-module-load',
    loadId: load.id,
    loadHighPin: powerPin,
    loadLowPin: groundPin,
    baseResistorIds: [],
    controlEndpoint,
    controlTargetEndpoint: `${load.id}:${signalPin}`
  };
}

function resolveMosfetModuleSwitchedLoadPath(
  spec: CircuitSpec,
  load: CircuitSpec['components'][number],
  part: PartCapability,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
): LowSideSwitchedLoadPath | null {
  const graph = buildEndpointGraph(spec);
  const { highPin, lowPin } = lowSideLoadPins(part);
  if (!highPin || !lowPin) {
    return null;
  }

  for (const driver of spec.components.filter((candidate) => LOW_SIDE_MOSFET_MODULE_PART_IDS.has(candidate.partId))) {
    const hasDriverPower = endpointReachesControllerRole(spec, `${driver.id}:VIN`, 'power', partsById, componentsById);
    const hasDriverGround = endpointReachesControllerRole(spec, `${driver.id}:GND`, 'ground', partsById, componentsById);
    const controlEndpoint = findConnectedControllerEndpointWithAnyRole(spec, driver.id, 'SIG', ['digital-output', 'pwm-output']);
    const loadHighConnected = reachableEndpointKeys(graph, [`${driver.id}:V+`]).has(`${load.id}:${highPin}`);
    const loadLowConnected = reachableEndpointKeys(graph, [`${driver.id}:V-`]).has(`${load.id}:${lowPin}`);

    if (hasDriverPower && hasDriverGround && controlEndpoint && loadHighConnected && loadLowConnected) {
      return {
        topologyId: 'controller-mosfet-module-load',
        loadId: load.id,
        loadHighPin: highPin,
        loadLowPin: lowPin,
        driverId: driver.id,
        driverPartId: driver.partId,
        driverInputPin: 'SIG',
        baseResistorIds: [],
        controlEndpoint,
        controlTargetEndpoint: `${driver.id}:SIG`
      };
    }
  }

  return null;
}

function resolveDiscreteTransistorSwitchedLoadPath(
  spec: CircuitSpec,
  load: CircuitSpec['components'][number],
  part: PartCapability,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
): LowSideSwitchedLoadPath | null {
  const graph = buildEndpointGraph(spec);
  const { highPin, lowPin } = lowSideLoadPins(part);
  const resistorIds = spec.components
    .filter((component) => component.partId === 'resistor-220')
    .map((component) => component.id);
  const controllerOutputs = controllerEndpointKeysWithRole(
    spec,
    ['digital-output', 'pwm-output'],
    partsById,
    componentsById
  );

  if (!highPin || !lowPin) {
    return null;
  }

  for (const driver of spec.components.filter((candidate) => LOW_SIDE_DISCRETE_DRIVER_PART_IDS.has(candidate.partId))) {
    const hasLoadPower = endpointReachesControllerRole(spec, `${load.id}:${highPin}`, 'power', partsById, componentsById);
    const loadLowConnected = reachableEndpointKeys(graph, [`${driver.id}:C`]).has(`${load.id}:${lowPin}`);
    const hasEmitterGround = endpointReachesControllerRole(spec, `${driver.id}:E`, 'ground', partsById, componentsById);
    const controlEndpoint = controllerOutputEndpointOnPath(graph, controllerOutputs, `${driver.id}:B`);
    const baseResistorIds = componentIdsOnPathThroughAnyComponent(graph, controllerOutputs, `${driver.id}:B`, resistorIds);

    if (hasLoadPower && loadLowConnected && hasEmitterGround && controlEndpoint && baseResistorIds.length > 0) {
      return {
        topologyId: 'controller-transistor-low-side-load',
        loadId: load.id,
        loadHighPin: highPin,
        loadLowPin: lowPin,
        driverId: driver.id,
        driverPartId: driver.partId,
        driverInputPin: 'B',
        baseResistorIds,
        controlEndpoint,
        controlTargetEndpoint: `${driver.id}:B`
      };
    }
  }

  return null;
}

function lowSideLoadPins(part: PartCapability) {
  return {
    highPin: firstPinNameForRole(part, (role) => isPowerRole(role) || role === 'positive' || role === 'load-power'),
    lowPin: firstPinNameForRole(part, (role) => role === 'switched-ground' || isGroundRole(role) || role === 'negative')
  };
}

function hasTransistorBaseSignalWithoutResistor(
  spec: CircuitSpec,
  graph: Map<string, Set<string>>,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const resistorIds = spec.components
    .filter((component) => component.partId === 'resistor-220')
    .map((component) => component.id);
  const controllerOutputs = controllerEndpointKeysWithRole(
    spec,
    ['digital-output', 'pwm-output'],
    partsById,
    componentsById
  );

  return spec.components
    .filter((component) => LOW_SIDE_DISCRETE_DRIVER_PART_IDS.has(component.partId))
    .some((driver) => {
      const baseKey = `${driver.id}:B`;
      const hasBaseSignal = endpointReachesAnyControllerRoleInGraph(
        graph,
        baseKey,
        ['digital-output', 'pwm-output'],
        partsById,
        componentsById
      );
      const baseResistorIds = componentIdsOnPathThroughAnyComponent(graph, controllerOutputs, baseKey, resistorIds);
      return hasBaseSignal && baseResistorIds.length === 0;
    });
}

function hasMosfetModuleControlSignal(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  return spec.components
    .filter((component) => LOW_SIDE_MOSFET_MODULE_PART_IDS.has(component.partId))
    .some((driver) =>
      endpointReachesAnyControllerRole(spec, `${driver.id}:SIG`, ['digital-output', 'pwm-output'], partsById, componentsById)
    );
}

type StepperMotorPath = {
  topologyId: 'controller-uln2003-unipolar-stepper' | 'controller-step-dir-bipolar-stepper';
  motorId: string;
  driverId: string;
  controlEndpoints: string[];
  controlTargetEndpoints: string[];
  phaseConnections: Array<{ driverPin: string; motorPin: string }>;
};

function validateStepperMotorPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const graph = buildEndpointGraph(spec);
  const stepperMotors = spec.components.filter((candidate) => STEPPER_MOTOR_PART_IDS.has(candidate.partId));
  const hasStepperDriver = spec.components.some((candidate) => STEPPER_DRIVER_PART_IDS.has(candidate.partId));

  for (const motor of stepperMotors) {
    const path = resolveStepperMotorPath(spec, motor, partsById, componentsById);
    if (path) {
      continue;
    }

    const directToGpio = stepperMotorPhasePins(motor.partId).some((pin) =>
      endpointReachesAnyControllerRoleInGraph(
        graph,
        `${motor.id}:${pin}`,
        ['digital-output', 'pwm-output'],
        partsById,
        componentsById
      )
    );

    if (directToGpio) {
      errors.push(`STEPPER_DIRECT_TO_GPIO: ${motor.label} coils must not be driven directly from Arduino GPIO; use a ULN2003, A4988, or DRV8825 driver.`);
    } else if (!hasStepperDriver) {
      errors.push(`STEPPER_DRIVER_MISSING: ${motor.label} needs a validated stepper driver module.`);
    } else {
      errors.push(`STEPPER_DRIVER_PATH_INVALID: ${motor.label} needs driver power, common ground, control signals, and all required phase/coil lines.`);
    }
  }

  for (const driver of spec.components.filter((candidate) => STEP_DIR_STEPPER_DRIVER_PART_IDS.has(candidate.partId))) {
    const hasStep = Boolean(findConnectedControllerEndpointWithAnyRole(spec, driver.id, 'STEP', ['digital-output', 'pwm-output']));
    const hasDir = Boolean(findConnectedControllerEndpointWithAnyRole(spec, driver.id, 'DIR', ['digital-output', 'pwm-output']));
    if (!hasStep || !hasDir) {
      errors.push(`STEPPER_STEP_DIR_MISSING: ${driver.label} needs both STEP and DIR connected to Arduino digital outputs.`);
    }
  }

  return unique(errors);
}

function resolveStepperMotorPath(
  spec: CircuitSpec,
  motor: CircuitSpec['components'][number],
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
): StepperMotorPath | null {
  if (UNIPOLAR_STEPPER_MOTOR_PART_IDS.has(motor.partId)) {
    return resolveUnipolarStepperPath(spec, motor, partsById, componentsById);
  }
  if (BIPOLAR_STEPPER_MOTOR_PART_IDS.has(motor.partId)) {
    return resolveBipolarStepperPath(spec, motor, partsById, componentsById);
  }
  return null;
}

function resolveUnipolarStepperPath(
  spec: CircuitSpec,
  motor: CircuitSpec['components'][number],
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
): StepperMotorPath | null {
  const graph = buildEndpointGraph(spec);
  const phasePairs = [
    ['OUT1', 'IN1'],
    ['OUT2', 'IN2'],
    ['OUT3', 'IN3'],
    ['OUT4', 'IN4']
  ] as const;

  for (const driver of spec.components.filter((candidate) => ULN2003_STEPPER_DRIVER_PART_IDS.has(candidate.partId))) {
    const hasDriverPower = endpointReachesControllerRole(spec, `${driver.id}:VCC`, 'power', partsById, componentsById);
    const hasMotorPower = endpointReachesControllerRole(spec, `${motor.id}:VCC`, 'power', partsById, componentsById);
    const hasDriverGround = endpointReachesControllerRole(spec, `${driver.id}:GND`, 'ground', partsById, componentsById);
    const controlTargetEndpoints = ['IN1', 'IN2', 'IN3', 'IN4'].map((pin) => `${driver.id}:${pin}`);
    const controlEndpoints = ['IN1', 'IN2', 'IN3', 'IN4']
      .map((pin) => findConnectedControllerEndpointWithAnyRole(spec, driver.id, pin, ['digital-output', 'pwm-output']))
      .filter((endpoint): endpoint is string => Boolean(endpoint));
    const phaseConnections = phasePairs.filter(([driverPin, motorPin]) =>
      reachableEndpointKeys(graph, [`${driver.id}:${driverPin}`]).has(`${motor.id}:${motorPin}`)
    ).map(([driverPin, motorPin]) => ({ driverPin, motorPin }));

    if (
      hasDriverPower
      && hasMotorPower
      && hasDriverGround
      && controlEndpoints.length === 4
      && phaseConnections.length === 4
    ) {
      return {
        topologyId: 'controller-uln2003-unipolar-stepper',
        motorId: motor.id,
        driverId: driver.id,
        controlEndpoints,
        controlTargetEndpoints,
        phaseConnections
      };
    }
  }

  return null;
}

function resolveBipolarStepperPath(
  spec: CircuitSpec,
  motor: CircuitSpec['components'][number],
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
): StepperMotorPath | null {
  const graph = buildEndpointGraph(spec);
  const coilPairs = [
    ['1A', 'A+'],
    ['1B', 'A-'],
    ['2A', 'B+'],
    ['2B', 'B-']
  ] as const;

  for (const driver of spec.components.filter((candidate) => STEP_DIR_STEPPER_DRIVER_PART_IDS.has(candidate.partId))) {
    const hasMotorPower = endpointReachesControllerRole(spec, `${driver.id}:VMOT`, 'power', partsById, componentsById);
    const hasDriverGround = endpointReachesControllerRole(spec, `${driver.id}:GND`, 'ground', partsById, componentsById);
    const stepEndpoint = findConnectedControllerEndpointWithAnyRole(spec, driver.id, 'STEP', ['digital-output', 'pwm-output']);
    const dirEndpoint = findConnectedControllerEndpointWithAnyRole(spec, driver.id, 'DIR', ['digital-output', 'pwm-output']);
    const phaseConnections = coilPairs.filter(([driverPin, motorPin]) =>
      reachableEndpointKeys(graph, [`${driver.id}:${driverPin}`]).has(`${motor.id}:${motorPin}`)
    ).map(([driverPin, motorPin]) => ({ driverPin, motorPin }));

    if (hasMotorPower && hasDriverGround && stepEndpoint && dirEndpoint && phaseConnections.length === 4) {
      return {
        topologyId: 'controller-step-dir-bipolar-stepper',
        motorId: motor.id,
        driverId: driver.id,
        controlEndpoints: [stepEndpoint, dirEndpoint],
        controlTargetEndpoints: [`${driver.id}:STEP`, `${driver.id}:DIR`],
        phaseConnections
      };
    }
  }

  return null;
}

function stepperMotorPhasePins(partId: string) {
  if (UNIPOLAR_STEPPER_MOTOR_PART_IDS.has(partId)) {
    return ['IN1', 'IN2', 'IN3', 'IN4'];
  }
  if (BIPOLAR_STEPPER_MOTOR_PART_IDS.has(partId)) {
    return ['A+', 'A-', 'B+', 'B-'];
  }
  return [];
}

type HBridgeMotorPath = {
  topologyId: 'controller-hbridge-dc-motor';
  motorId: string;
  driverId: string;
  driverPartId: string;
  controlEndpoints: string[];
  controlTargetEndpoints: string[];
  outputConnections: Array<{ driverPin: string; motorPin: string }>;
};

function validateHBridgeMotorPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const motors = spec.components.filter((candidate) => HBRIDGE_MOTOR_LOAD_PART_IDS.has(candidate.partId));
  const hbridgeDrivers = spec.components.filter((candidate) => HBRIDGE_DRIVER_PART_IDS.has(candidate.partId));

  if (hbridgeDrivers.length === 0) {
    return errors;
  }

  for (const motor of motors) {
    const path = resolveHBridgeMotorPath(spec, motor, partsById, componentsById);
    if (path) {
      continue;
    }
    errors.push(`HBRIDGE_DRIVER_PATH_INVALID: ${motor.label} needs a validated H-bridge path with driver power, common ground, enable/direction signals, and OUT1/OUT2 motor wiring.`);
  }

  for (const driver of hbridgeDrivers) {
    const controlPins = hbridgeControlPins(driver.partId);
    const missingControls = controlPins.filter((pin) =>
      !findConnectedControllerEndpointWithAnyRole(spec, driver.id, pin, ['digital-output', 'pwm-output'])
    );
    if (missingControls.length > 0) {
      errors.push(`HBRIDGE_CONTROL_MISSING: ${driver.label} needs ${missingControls.join('/')} connected to Arduino digital or PWM outputs.`);
    }
  }

  return unique(errors);
}

function resolveHBridgeMotorPath(
  spec: CircuitSpec,
  motor: CircuitSpec['components'][number],
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
): HBridgeMotorPath | null {
  const graph = buildEndpointGraph(spec);
  const motorPins = ['M+', 'M-'] as const;

  for (const driver of spec.components.filter((candidate) => HBRIDGE_DRIVER_PART_IDS.has(candidate.partId))) {
    const pins = hbridgePinContract(driver.partId);
    const hasMotorPower = endpointReachesControllerRole(spec, `${driver.id}:${pins.motorPower}`, 'power', partsById, componentsById);
    const hasLogicPower = endpointReachesControllerRole(spec, `${driver.id}:${pins.logicPower}`, 'power', partsById, componentsById);
    const hasDriverGround = endpointReachesControllerRole(spec, `${driver.id}:GND`, 'ground', partsById, componentsById);
    const controlEndpoints = pins.controls
      .map((pin) => findConnectedControllerEndpointWithAnyRole(spec, driver.id, pin, ['digital-output', 'pwm-output']))
      .filter((endpoint): endpoint is string => Boolean(endpoint));
    const controlTargetEndpoints = pins.controls.map((pin) => `${driver.id}:${pin}`);
    const directOutputConnections = [
      { driverPin: pins.outputs[0], motorPin: motorPins[0] },
      { driverPin: pins.outputs[1], motorPin: motorPins[1] }
    ].filter(({ driverPin, motorPin }) =>
      reachableEndpointKeys(graph, [`${driver.id}:${driverPin}`]).has(`${motor.id}:${motorPin}`)
    );
    const reversedOutputConnections = [
      { driverPin: pins.outputs[0], motorPin: motorPins[1] },
      { driverPin: pins.outputs[1], motorPin: motorPins[0] }
    ].filter(({ driverPin, motorPin }) =>
      reachableEndpointKeys(graph, [`${driver.id}:${driverPin}`]).has(`${motor.id}:${motorPin}`)
    );
    const outputConnections = directOutputConnections.length === 2 ? directOutputConnections : reversedOutputConnections;

    if (
      hasMotorPower
      && hasLogicPower
      && hasDriverGround
      && controlEndpoints.length === pins.controls.length
      && outputConnections.length === 2
    ) {
      return {
        topologyId: 'controller-hbridge-dc-motor',
        motorId: motor.id,
        driverId: driver.id,
        driverPartId: driver.partId,
        controlEndpoints,
        controlTargetEndpoints,
        outputConnections
      };
    }
  }

  return null;
}

function hbridgePinContract(partId: string) {
  if (partId === 'l293d-driver') {
    return {
      logicPower: 'VCC1',
      motorPower: 'VCC2',
      controls: ['EN1', 'IN1', 'IN2'],
      outputs: ['OUT1', 'OUT2']
    };
  }
  return {
    logicPower: 'VCC',
    motorPower: 'VS',
    controls: ['ENA', 'IN1', 'IN2'],
    outputs: ['OUT1', 'OUT2']
  };
}

function hbridgeControlPins(partId: string) {
  return hbridgePinContract(partId).controls;
}

type RelayModulePath = {
  topologyId: 'controller-relay-low-voltage-load';
  relayId: string;
  relayPartId: string;
  inputPin: string;
  controlEndpoint: string;
  controlTargetEndpoint: string;
  contactCommonPin: string;
  contactOutputPin: string;
  loadId: string;
  seriesResistorIds: string[];
};

function validateRelayModulePaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const relays = spec.components.filter((candidate) => RELAY_MODULE_PART_IDS.has(candidate.partId));
  if (relays.length === 0) {
    return errors;
  }

  const relayPaths = resolveRelayModulePaths(spec, partsById, componentsById);
  const relayIdsWithPaths = new Set(relayPaths.map((path) => path.relayId));

  for (const relay of relays) {
    if (hasRelayMainsLanguage(spec)) {
      errors.push(`RELAY_MAINS_LOAD_UNSUPPORTED: ${relay.label} cannot be used for mains, outlet, 110V, 220V, or AC load wiring in this simulator.`);
      continue;
    }

    const hasPower = endpointReachesControllerRole(spec, `${relay.id}:VCC`, 'power', partsById, componentsById);
    const hasGround = endpointReachesControllerRole(spec, `${relay.id}:GND`, 'ground', partsById, componentsById);
    const inputPin = relayInputPins(relay.partId).find((pin) =>
      findConnectedControllerEndpointWithAnyRole(spec, relay.id, pin, ['digital-output', 'pwm-output'])
    );

    if (!hasPower) {
      errors.push(`RELAY_POWER_MISSING: ${relay.label} needs VCC connected to Arduino 5V.`);
    }
    if (!hasGround) {
      errors.push(`RELAY_GROUND_MISSING: ${relay.label} needs GND connected to Arduino GND.`);
    }
    if (!inputPin) {
      errors.push(`RELAY_CONTROL_MISSING: ${relay.label} needs an IN pin connected to an Arduino digital output.`);
    }
    if (!relayIdsWithPaths.has(relay.id)) {
      errors.push(`RELAY_LOAD_PATH_INVALID: ${relay.label} needs COM/NO switching a low-voltage LED plus series resistor load path.`);
    }
  }

  return unique(errors);
}

function resolveRelayModulePaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
): RelayModulePath[] {
  return spec.components
    .filter((candidate) => RELAY_MODULE_PART_IDS.has(candidate.partId))
    .map((relay) => resolveRelayModulePath(spec, relay, partsById, componentsById))
    .filter((path): path is RelayModulePath => Boolean(path));
}

function resolveRelayModulePath(
  spec: CircuitSpec,
  relay: CircuitSpec['components'][number],
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
): RelayModulePath | null {
  if (hasRelayMainsLanguage(spec)) {
    return null;
  }

  const graph = buildEndpointGraph(spec);
  const contact = relayContactPins(relay.partId);
  const hasPower = endpointReachesControllerRole(spec, `${relay.id}:VCC`, 'power', partsById, componentsById);
  const hasGround = endpointReachesControllerRole(spec, `${relay.id}:GND`, 'ground', partsById, componentsById);
  const inputPin = relayInputPins(relay.partId).find((pin) =>
    findConnectedControllerEndpointWithAnyRole(spec, relay.id, pin, ['digital-output', 'pwm-output'])
  );
  const controlEndpoint = inputPin
    ? findConnectedControllerEndpointWithAnyRole(spec, relay.id, inputPin, ['digital-output', 'pwm-output'])
    : null;
  const commonPowered = endpointReachesControllerRole(spec, `${relay.id}:${contact.common}`, 'power', partsById, componentsById);
  const resistorIds = spec.components
    .filter((component) => component.partId === 'resistor-220')
    .map((component) => component.id);

  if (!hasPower || !hasGround || !inputPin || !controlEndpoint || !commonPowered) {
    return null;
  }

  for (const led of spec.components.filter((candidate) => candidate.partId === 'led-5mm')) {
    const seriesResistorIds = componentIdsOnPathThroughAnyComponent(
      graph,
      [`${relay.id}:${contact.output}`],
      `${led.id}:A`,
      resistorIds
    );
    const cathodeGrounded = endpointReachesControllerRole(spec, `${led.id}:K`, 'ground', partsById, componentsById);
    if (seriesResistorIds.length > 0 && cathodeGrounded) {
      return {
        topologyId: 'controller-relay-low-voltage-load',
        relayId: relay.id,
        relayPartId: relay.partId,
        inputPin,
        controlEndpoint,
        controlTargetEndpoint: `${relay.id}:${inputPin}`,
        contactCommonPin: contact.common,
        contactOutputPin: contact.output,
        loadId: led.id,
        seriesResistorIds
      };
    }
  }

  return null;
}

function relayInputPins(partId: string) {
  return partId === 'relay-4ch' ? ['IN1', 'IN2', 'IN3', 'IN4'] : ['IN'];
}

function relayContactPins(partId: string) {
  return partId === 'relay-4ch'
    ? { common: 'COM1', output: 'NO1' }
    : { common: 'COM', output: 'NO' };
}

function hasRelayMainsLanguage(spec: CircuitSpec) {
  const mainsPattern = /220\s*v|220v|110\s*v|110v|mains|outlet|wall power|\bac\b|콘센트|가정용\s*전원|교류|220볼트|110볼트/i;
  const intentText = [
    spec.intent.primaryGoal,
    spec.intent.output,
    spec.intent.input ?? '',
    spec.intent.behavior ?? '',
    spec.behavior.runText
  ].join(' ');
  if (mainsPattern.test(intentText)) {
    return true;
  }

  return spec.assumptions.some((assumption) =>
    mainsPattern.test(assumption) &&
    !/\b(blocked|unsupported|not\s+supported|forbidden|avoid|do\s+not|don't|never)\b|차단|미지원|금지|사용하지/i.test(assumption)
  );
}

function hasDeclaredLowVoltageDcPower(spec: CircuitSpec) {
  const declaredPowerPattern = /\b(low\s*-?\s*voltage|dc|direct\s+current|5\s*v|5v|6\s*v|6v|9\s*v|9v|12\s*v|12v|battery|adapter|regulated)\b|저전압|직류|배터리|어댑터|레귤레이터/i;
  return declaredPowerPattern.test([
    spec.title,
    spec.intent.primaryGoal,
    spec.intent.output ?? '',
    spec.intent.input ?? '',
    spec.intent.behavior ?? '',
    spec.behavior.runText,
    ...spec.components.map((component) => component.label),
    ...spec.assumptions
  ].join(' '));
}

function hasUnsafeLiPoHandlingLanguage(spec: CircuitSpec) {
  const unsafePattern = /\b(charge|charger|charging|short|short-circuit|puncture|pierce|high\s*current|overcurrent)\b|충전|쇼트|단락|구멍|고전류/i;
  return unsafePattern.test([
    spec.title,
    spec.intent.primaryGoal,
    spec.intent.output ?? '',
    spec.intent.input ?? '',
    spec.intent.behavior ?? '',
    spec.behavior.runText,
    ...spec.assumptions
  ].join(' '));
}

function controllerOutputEndpointOnPath(
  graph: Map<string, Set<string>>,
  controllerOutputs: string[],
  goalKey: string
) {
  return controllerOutputs.find((key) => reachableEndpointKeys(graph, [key]).has(goalKey)) ?? null;
}

const ANALOG_SENSOR_MODULE_PART_IDS = new Set([
  'soil-moisture',
  'water-level-sensor',
  'tmp36-temp',
  'acs712-current',
  'rain-sensor',
  'flame-sensor',
  'mq2-gas',
  'sound-sensor'
]);
const ANALOG_SENSOR_EDUCATIONAL_WARNING_PART_IDS = new Set(['acs712-current', 'flame-sensor', 'mq2-gas']);
const ANALOG_DIMMER_INPUT_PART_IDS = new Set(['potentiometer-10k', 'trimmer-pot']);
const ANALOG_INPUT_PART_IDS = new Set([...ANALOG_DIMMER_INPUT_PART_IDS, 'photoresistor-ldr', ...ANALOG_SENSOR_MODULE_PART_IDS]);
const RESISTIVE_SENSOR_PART_IDS = new Set(['fsr-pressure', 'thermistor-ntc']);
const RESISTIVE_SENSOR_REFERENCE_RESISTOR_PART_IDS = new Set(['resistor-10k']);
const PASSIVE_INTERNAL_CONNECTION_PART_IDS = new Set(['resistor-220', ...RESISTIVE_SENSOR_REFERENCE_RESISTOR_PART_IDS]);
const I2C_TEXT_DISPLAY_PART_IDS = new Set(['oled-i2c-096', 'oled-13-i2c', 'lcd-16x2', 'lcd-20x4']);
const BARE_SEVEN_SEGMENT_DISPLAY_PART_IDS = new Set(['7seg-1digit']);
const LED_ARRAY_DISPLAY_PART_IDS = new Set(['7seg-4digit-tm1637', '8x8-matrix-max7219']);
const ADDRESSABLE_LED_DISPLAY_PART_IDS = new Set(['neopixel-ring-12', 'ws2812b-strip']);
const SPI_DISPLAY_PART_IDS = new Set(['tft-18', 'nokia-5110', 'epaper-213']);
const DIRECT_LOW_CURRENT_LOAD_PART_IDS = new Set(['piezo-buzzer', 'active-buzzer']);
const RGB_LED_PART_IDS = new Set(['rgb-led-common-cathode']);
const POWERED_LIGHT_MODULE_PART_IDS = new Set(['laser-diode-module']);
const SERVO_ACTUATOR_PART_IDS = new Set(['micro-servo', 'mg996r-servo']);
const HIGH_TORQUE_SERVO_PART_IDS = new Set(['mg996r-servo']);
const LOW_SIDE_DISCRETE_DRIVER_PART_IDS = new Set(['2n2222-npn']);
const LOW_SIDE_MOSFET_MODULE_PART_IDS = new Set(['irf520-mosfet']);
const LOW_SIDE_DRIVER_PART_IDS = new Set([
  ...LOW_SIDE_DISCRETE_DRIVER_PART_IDS,
  ...LOW_SIDE_MOSFET_MODULE_PART_IDS
]);
const LOW_SIDE_INTEGRATED_LOAD_PART_IDS = new Set(['vibration-motor']);
const LOW_SIDE_LOAD_PART_IDS = new Set([
  'dc-motor-130',
  'dc-fan-5v',
  'mini-water-pump',
  'solenoid-valve',
  ...LOW_SIDE_INTEGRATED_LOAD_PART_IDS
]);
const UNIPOLAR_STEPPER_MOTOR_PART_IDS = new Set(['stepper-28byj48']);
const BIPOLAR_STEPPER_MOTOR_PART_IDS = new Set(['nema17-stepper']);
const STEPPER_MOTOR_PART_IDS = new Set([
  ...UNIPOLAR_STEPPER_MOTOR_PART_IDS,
  ...BIPOLAR_STEPPER_MOTOR_PART_IDS
]);
const ULN2003_STEPPER_DRIVER_PART_IDS = new Set(['uln2003-driver']);
const STEP_DIR_STEPPER_DRIVER_PART_IDS = new Set(['a4988-stepper', 'drv8825-stepper']);
const STEPPER_DRIVER_PART_IDS = new Set([
  ...ULN2003_STEPPER_DRIVER_PART_IDS,
  ...STEP_DIR_STEPPER_DRIVER_PART_IDS
]);
const HBRIDGE_DRIVER_PART_IDS = new Set(['l298n-driver', 'l293d-driver']);
const HBRIDGE_MOTOR_LOAD_PART_IDS = new Set(['dc-motor-130']);
const RELAY_MODULE_PART_IDS = new Set(['relay-1ch', 'relay-4ch']);
const LOW_VOLTAGE_POWER_SOURCE_PART_IDS = new Set([
  'breadboard-psu',
  '9v-battery-clip',
  'aa-battery-holder',
  'lipo-battery-1s',
  'barrel-jack',
  'screw-terminal-2pin'
]);
const EXTERNAL_POWER_CONNECTOR_PART_IDS = new Set(['barrel-jack', 'screw-terminal-2pin']);
const REGULATOR_INPUT_SOURCE_PART_IDS = new Set(['9v-battery-clip', 'barrel-jack', 'screw-terminal-2pin']);
const VOLTAGE_REGULATOR_PART_IDS = new Set(['7805-regulator']);
const LOW_VOLTAGE_POWER_RAIL_PART_IDS = new Set([
  ...LOW_VOLTAGE_POWER_SOURCE_PART_IDS,
  ...VOLTAGE_REGULATOR_PART_IDS
]);
const LIPO_BATTERY_PART_IDS = new Set(['lipo-battery-1s']);
const PASSIVE_PROTECTION_CONTEXT_PART_IDS = new Set([
  'ceramic-cap',
  'electrolytic-cap',
  'diode-1n4007',
  'schottky-diode',
  'zener-diode',
  'polyfuse',
  'inductor-axial'
]);
const TIMING_PASSIVE_CONTEXT_PART_IDS = new Set(['crystal-16mhz']);
const PASSIVE_CONTEXT_PART_IDS = new Set([
  ...PASSIVE_PROTECTION_CONTEXT_PART_IDS,
  ...TIMING_PASSIVE_CONTEXT_PART_IDS
]);
const PROTOTYPING_SURFACE_CONTEXT_PART_IDS = new Set([
  'breadboard-full',
  'breadboard-mini',
  'perfboard-5x7',
  'pcb-blank-single',
  'proto-shield-uno'
]);
const CONNECTOR_WIRING_CONTEXT_PART_IDS = new Set([
  'header-male-40pin',
  'header-female-40pin',
  'screw-terminal-4pin'
]);
const WP09_CONTEXT_PART_IDS = new Set([
  ...PROTOTYPING_SURFACE_CONTEXT_PART_IDS,
  ...CONNECTOR_WIRING_CONTEXT_PART_IDS
]);
const CONTROLLER_BOARD_CONTEXT_PART_IDS = new Set([
  'arduino-nano',
  'arduino-mega2560',
  'arduino-leonardo',
  'arduino-micro',
  'arduino-pro-mini',
  'attiny85-board',
  'esp32-devkit',
  'esp8266-nodemcu',
  'raspberry-pi-pico',
  'stm32-bluepill',
  'teensy40'
]);
const DISTANCE_SENSOR_PART_IDS = new Set(['ultrasonic-hc-sr04']);
const SINGLE_WIRE_SENSOR_PART_IDS = new Set(['dht11', 'dht22']);
const I2C_PROTOCOL_SENSOR_PART_IDS = new Set(['bmp280', 'hmc5883l', 'mpu6050', 'max30102-pulse']);
const CLOCKED_DATA_SENSOR_PART_IDS = new Set(['hx711-loadcell']);
const SPI_PROTOCOL_SENSOR_PART_IDS = new Set(['rc522-rfid']);
const UART_PROTOCOL_SENSOR_PART_IDS = new Set(['gps-neo6m']);
const WP10_PROTOCOL_SENSOR_PART_IDS = new Set([
  ...I2C_PROTOCOL_SENSOR_PART_IDS,
  ...CLOCKED_DATA_SENSOR_PART_IDS,
  ...SPI_PROTOCOL_SENSOR_PART_IDS,
  ...UART_PROTOCOL_SENSOR_PART_IDS
]);
const UART_COMMUNICATION_MODULE_PART_IDS = new Set(['esp01-wifi', 'hc05-bluetooth', 'sim800l-gsm']);
const SPI_COMMUNICATION_MODULE_PART_IDS = new Set(['lora-ra02', 'nrf24l01-radio', 'mcp2515-can', 'usb-host-shield']);
const DIFFERENTIAL_COMMUNICATION_MODULE_PART_IDS = new Set(['rs485-module']);
const WIRELESS_COMMUNICATION_MODULE_PART_IDS = new Set(['esp01-wifi', 'hc05-bluetooth', 'sim800l-gsm', 'lora-ra02', 'nrf24l01-radio']);
const POWER_WARNING_COMMUNICATION_MODULE_PART_IDS = new Set(['esp01-wifi', 'sim800l-gsm', 'lora-ra02', 'nrf24l01-radio', 'usb-host-shield']);
const COMMUNICATION_MODULE_PART_IDS = new Set([
  ...UART_COMMUNICATION_MODULE_PART_IDS,
  ...SPI_COMMUNICATION_MODULE_PART_IDS,
  ...DIFFERENTIAL_COMMUNICATION_MODULE_PART_IDS
]);
const SHIFT_REGISTER_INTERFACE_PART_IDS = new Set(['74hc595-shift']);
const I2C_LOGIC_INTERFACE_PART_IDS = new Set(['pcf8574-expander', 'ads1115-adc']);
const SPI_LOGIC_INTERFACE_PART_IDS = new Set(['mcp3008-adc']);
const ANALOG_TIMING_INTERFACE_PART_IDS = new Set(['ne555-timer', 'lm358-opamp']);
const LEVEL_SHIFTER_INTERFACE_PART_IDS = new Set(['i2c-level-shifter']);
const LOGIC_INTERFACE_PART_IDS = new Set([
  ...SHIFT_REGISTER_INTERFACE_PART_IDS,
  ...I2C_LOGIC_INTERFACE_PART_IDS,
  ...SPI_LOGIC_INTERFACE_PART_IDS,
  ...ANALOG_TIMING_INTERFACE_PART_IDS,
  ...LEVEL_SHIFTER_INTERFACE_PART_IDS
]);
const PASSIVE_DIGITAL_SWITCH_PART_IDS = new Set(['limit-switch', 'reed-switch', 'slide-switch', 'toggle-switch']);
const POWERED_DIGITAL_SENSOR_PART_IDS = new Set([
  'ttp223-touch',
  'hall-effect-sensor',
  'line-tracker',
  'pir-hc-sr501',
  'sw420-vibration',
  'tilt-ball-sensor'
]);
const PULSE_DIGITAL_SENSOR_PART_IDS = new Set(['ir-receiver', 'tcs3200-color']);
const DIGITAL_INPUT_STATE_PART_IDS = new Set([
  ...PASSIVE_DIGITAL_SWITCH_PART_IDS,
  ...POWERED_DIGITAL_SENSOR_PART_IDS,
  ...PULSE_DIGITAL_SENSOR_PART_IDS
]);
const MATRIX_KEYPAD_PART_IDS = new Set(['keypad-4x4']);
const MULTI_SWITCH_INPUT_PART_IDS = new Set(['dip-switch-4', 'membrane-keypad-1x4']);
const MATRIX_INPUT_PART_IDS = new Set([...MATRIX_KEYPAD_PART_IDS, ...MULTI_SWITCH_INPUT_PART_IDS]);
const JOYSTICK_PART_IDS = new Set(['joystick-module']);
const ROTARY_ENCODER_PART_IDS = new Set(['rotary-encoder']);

function validateLowVoltagePowerRailPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const railComponents = spec.components.filter((candidate) => LOW_VOLTAGE_POWER_RAIL_PART_IDS.has(candidate.partId));
  if (railComponents.length === 0) {
    return [];
  }

  const errors: string[] = [];
  const graph = buildEndpointGraph(spec);

  if (hasRelayMainsLanguage(spec)) {
    errors.push('LOW_VOLTAGE_POWER_RAIL_UNSAFE_MAINS: Breadboard power rails only support declared low-voltage DC sources; mains, wall outlets, and AC wiring are blocked.');
  }

  for (const component of railComponents.filter((candidate) => LIPO_BATTERY_PART_IDS.has(candidate.partId))) {
    if (hasUnsafeLiPoHandlingLanguage(spec)) {
      errors.push(`LIPO_UNSAFE_HANDLING_BLOCKED: ${component.label} cannot be used for charging, short-circuit, puncture, or high-current handling instructions.`);
    }
  }

  for (const component of railComponents.filter((candidate) => EXTERNAL_POWER_CONNECTOR_PART_IDS.has(candidate.partId))) {
    if (!hasDeclaredLowVoltageDcPower(spec)) {
      errors.push(`EXTERNAL_POWER_CONNECTOR_VOLTAGE_UNDECLARED: ${component.label} needs an explicit low-voltage DC source assumption before it can power a simulated rail.`);
    }
  }

  for (const component of railComponents.filter((candidate) => LOW_VOLTAGE_POWER_SOURCE_PART_IDS.has(candidate.partId))) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }
    const powerPin = firstPinNameForRole(part, (role) => isPowerRole(role) && !isGroundRole(role));
    const groundPin = firstPinNameForRole(part, isGroundRole);
    const powerKey = powerPin ? `${component.id}:${powerPin}` : null;
    const groundKey = groundPin ? `${component.id}:${groundPin}` : null;
    const positiveFeedsRail = powerKey
      ? endpointReachesRoleInGraph(
        graph,
        powerKey,
        (role) => role === 'power-rail',
        partsById,
        componentsById,
        (candidate) => candidate.partId === 'breadboard-half'
      )
      : false;
    const positiveFeedsRegulator = powerKey
      ? endpointReachesRoleInGraph(
        graph,
        powerKey,
        (role) => role === 'power-input',
        partsById,
        componentsById,
        (candidate) => VOLTAGE_REGULATOR_PART_IDS.has(candidate.partId)
      )
      : false;
    const groundFeedsRail = groundKey
      ? endpointReachesRoleInGraph(
        graph,
        groundKey,
        (role) => role === 'ground-rail',
        partsById,
        componentsById,
        (candidate) => candidate.partId === 'breadboard-half'
      )
      : false;
    const groundFeedsRegulator = groundKey
      ? endpointReachesRoleInGraph(
        graph,
        groundKey,
        isGroundRole,
        partsById,
        componentsById,
        (candidate) => VOLTAGE_REGULATOR_PART_IDS.has(candidate.partId)
      )
      : false;

    if (!powerPin || (!positiveFeedsRail && !positiveFeedsRegulator)) {
      errors.push(`LOW_VOLTAGE_SOURCE_POSITIVE_RAIL_MISSING: ${component.label} needs its positive output connected to the breadboard + rail or a regulator input.`);
    }
    if (!groundPin || (!groundFeedsRail && !groundFeedsRegulator)) {
      errors.push(`LOW_VOLTAGE_SOURCE_GROUND_RAIL_MISSING: ${component.label} needs its ground/negative output connected to the breadboard - rail or regulator ground.`);
    }
  }

  for (const regulator of railComponents.filter((candidate) => VOLTAGE_REGULATOR_PART_IDS.has(candidate.partId))) {
    const part = partsById.get(regulator.partId);
    if (!part) {
      continue;
    }
    const inputPin = firstPinNameForRole(part, (role) => role === 'power-input');
    const outputPin = firstPinNameForRole(part, (role) => role === 'regulated-power-output');
    const groundPin = firstPinNameForRole(part, isGroundRole);
    const inputKey = inputPin ? `${regulator.id}:${inputPin}` : null;
    const outputKey = outputPin ? `${regulator.id}:${outputPin}` : null;
    const groundKey = groundPin ? `${regulator.id}:${groundPin}` : null;
    const inputSourcePartIds = inputKey
      ? reachablePartIdsByRoleInGraph(graph, inputKey, isPowerRole, partsById, componentsById)
      : [];
    const reachesAnyLowVoltageSource = inputSourcePartIds.some((partId) => LOW_VOLTAGE_POWER_SOURCE_PART_IDS.has(partId));
    const reachesAllowedInputSource = inputSourcePartIds.some((partId) => REGULATOR_INPUT_SOURCE_PART_IDS.has(partId));
    const outputFeedsRail = outputKey
      ? endpointReachesRoleInGraph(
        graph,
        outputKey,
        (role) => role === 'power-rail',
        partsById,
        componentsById,
        (candidate) => candidate.partId === 'breadboard-half'
      )
      : false;
    const groundReachesSource = groundKey
      ? endpointReachesRoleInGraph(
        graph,
        groundKey,
        isGroundRole,
        partsById,
        componentsById,
        (candidate) => LOW_VOLTAGE_POWER_SOURCE_PART_IDS.has(candidate.partId)
      )
      : false;
    const groundReachesRail = groundKey
      ? endpointReachesRoleInGraph(
        graph,
        groundKey,
        (role) => role === 'ground-rail',
        partsById,
        componentsById,
        (candidate) => candidate.partId === 'breadboard-half'
      )
      : false;

    if (!inputPin || !reachesAllowedInputSource) {
      errors.push(`REGULATOR_INPUT_MISSING: ${regulator.label} IN needs a declared low-voltage source such as a 9V battery clip or DC input connector.`);
    }
    if (reachesAnyLowVoltageSource && !reachesAllowedInputSource) {
      errors.push(`REGULATOR_INPUT_SOURCE_UNSUPPORTED: ${regulator.label} is not modeled with the connected source; use a 9V battery clip, DC barrel jack, or declared low-voltage screw terminal.`);
    }
    if (!outputPin || !outputFeedsRail) {
      errors.push(`REGULATOR_OUTPUT_RAIL_MISSING: ${regulator.label} OUT needs to feed the breadboard + rail.`);
    }
    if (!groundPin || !groundReachesSource || !groundReachesRail) {
      errors.push(`REGULATOR_COMMON_GROUND_MISSING: ${regulator.label} GND needs both the source ground and breadboard - rail common ground.`);
    }
  }

  return unique(errors);
}

function validatePassiveContextPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const passiveContextComponents = spec.components.filter((candidate) => PASSIVE_CONTEXT_PART_IDS.has(candidate.partId));
  if (passiveContextComponents.length === 0) {
    return [];
  }

  const errors: string[] = [];
  const graph = buildEndpointGraph(spec);

  if (hasRelayMainsLanguage(spec)) {
    errors.push('PASSIVE_CONTEXT_UNSAFE_MAINS: Passive/protection context is limited to low-voltage breadboard lessons; MOV, mains, wall outlet, and AC protection circuits are blocked.');
  }

  for (const component of spec.components.filter((candidate) => LIPO_BATTERY_PART_IDS.has(candidate.partId))) {
    if (hasUnsafeLiPoHandlingLanguage(spec)) {
      errors.push(`LIPO_UNSAFE_HANDLING_BLOCKED: ${component.label} cannot be used for charging, short-circuit, puncture, or high-current handling instructions.`);
    }
  }

  for (const component of passiveContextComponents) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }

    if (component.partId === 'electrolytic-cap') {
      const positiveKey = `${component.id}:+`;
      const negativeKey = `${component.id}:-`;
      const positiveTouchesGround = endpointReachesRoleInGraph(
        graph,
        positiveKey,
        isGroundRole,
        partsById,
        componentsById
      );
      const negativeTouchesPower = endpointReachesRoleInGraph(
        graph,
        negativeKey,
        isPowerRole,
        partsById,
        componentsById
      );

      if (positiveTouchesGround || negativeTouchesPower) {
        errors.push(`POLARIZED_PASSIVE_REVERSED: ${component.label} has reversed polarity; + must not connect to ground and - must not connect to power.`);
      }
    }
  }

  return unique(errors);
}

function validateWp09ContextPaths(spec: CircuitSpec) {
  const wp09Components = spec.components.filter((candidate) => WP09_CONTEXT_PART_IDS.has(candidate.partId));
  if (wp09Components.length === 0) {
    return [];
  }

  const errors: string[] = [];
  const hasConnectorContext = wp09Components.some((component) => CONNECTOR_WIRING_CONTEXT_PART_IDS.has(component.partId));
  const hasSurfaceContext = wp09Components.some((component) => PROTOTYPING_SURFACE_CONTEXT_PART_IDS.has(component.partId));

  if (hasRelayMainsLanguage(spec)) {
    if (hasSurfaceContext) {
      errors.push('PROTOTYPING_CONTEXT_UNSAFE_MAINS: Prototyping surfaces are limited to low-voltage classroom context; mains, wall outlets, and AC wiring are blocked.');
    }
    if (hasConnectorContext) {
      errors.push('CONNECTOR_CONTEXT_UNSAFE_MAINS: Header and terminal connector context is limited to low-voltage classroom wiring; mains, wall outlets, and AC wiring are blocked.');
    }
  }

  if (
    spec.components.some((component) => component.partId === 'screw-terminal-4pin')
    && hasConnectorAsPowerSourceLanguage(spec)
  ) {
    errors.push('CONNECTOR_CONTEXT_NOT_POWER_SOURCE: The 4-pin screw terminal is supported as connector context only; use an explicit low-voltage source contract for power rails.');
  }

  return unique(errors);
}

function validateControllerBoardContextPaths(spec: CircuitSpec) {
  const controllerBoardComponents = spec.components.filter((candidate) => CONTROLLER_BOARD_CONTEXT_PART_IDS.has(candidate.partId));
  if (controllerBoardComponents.length === 0) {
    return [];
  }

  const errors: string[] = [];
  if (hasRelayMainsLanguage(spec)) {
    errors.push('CONTROLLER_BOARD_CONTEXT_UNSAFE_MAINS: Controller board context is limited to low-voltage classroom simulation; mains, wall outlets, and AC wiring are blocked.');
  }

  const nonContextComponents = spec.components.filter((component) =>
    !CONTROLLER_BOARD_CONTEXT_PART_IDS.has(component.partId)
    && !WP09_CONTEXT_PART_IDS.has(component.partId)
    && component.partId !== 'jumper-wire'
  );

  if (nonContextComponents.length > 0) {
    const boardLabels = controllerBoardComponents.map((component) => component.label).join(', ');
    errors.push(`CONTROLLER_BOARD_SUBSTITUTION_NOT_VALIDATED: ${boardLabels} is supported as pin-map and voltage-domain context, but this circuit includes ${nonContextComponents.map((component) => component.label).join(', ')}; validated wiring substitution for that board and circuit bundle is not yet available.`);
  }

  return unique(errors);
}

function hasConnectorAsPowerSourceLanguage(spec: CircuitSpec) {
  const powerSourcePattern = /\b(power\s*source|voltage\s*source|supply\s*source|energize|power\s*rail|5\s*v\s*rail|5v\s*rail|power\s*supply)\b|전원\s*(공급|소스)|파워\s*레일|전원\s*레일|5V\s*레일/i;
  const contextOnlyPattern = /\b(connector\s*context|wiring\s*context|placement\s*context|place|show|render)\b|커넥터\s*문맥|배치\s*문맥|표시|보여/i;
  const text = [
    spec.title,
    spec.intent.primaryGoal,
    spec.intent.output,
    spec.intent.input ?? '',
    spec.intent.behavior ?? '',
    spec.behavior.runText,
    ...spec.assumptions
  ].join(' ');

  return powerSourcePattern.test(text) && !contextOnlyPattern.test(text);
}

function validateAnalogInputPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  for (const component of spec.components.filter((candidate) => ANALOG_INPUT_PART_IDS.has(candidate.partId))) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }
    const powerPin = firstPinNameForRole(part, isPowerRole);
    const groundPin = firstPinNameForRole(part, isGroundRole);
    const analogPin = firstPinNameForRole(part, (role) => role === 'analog-output' || role === 'analog');

    if (!powerPin || !endpointReachesControllerRole(spec, `${component.id}:${powerPin}`, 'power', partsById, componentsById)) {
      errors.push(`ANALOG_INPUT_POWER_MISSING: ${component.label} needs VCC connected to Arduino 5V.`);
    }
    if (!groundPin || !endpointReachesControllerRole(spec, `${component.id}:${groundPin}`, 'ground', partsById, componentsById)) {
      errors.push(`ANALOG_INPUT_GROUND_MISSING: ${component.label} needs GND connected to Arduino GND.`);
    }
    const analogConnection = analogPin
      ? findConnectionToControllerRole(spec, component.id, analogPin, 'analog-input')
      : null;
    const analogReachesController = analogPin
      ? endpointReachesControllerRole(spec, `${component.id}:${analogPin}`, 'analog-input', partsById, componentsById)
      : false;
    if (!analogPin || !analogReachesController) {
      errors.push(`ANALOG_INPUT_SIGNAL_MISSING: ${component.label} needs its analog output connected to Arduino A0.`);
    } else if (analogConnection && analogConnection.signal !== 'analog') {
      errors.push(`ANALOG_INPUT_SIGNAL_TYPE_INVALID: ${component.label} analog output must use the analog signal type.`);
    }
  }
  return errors;
}

function validateAnalogSensorDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  const displayRequested = /display|oled|screen|show|readout|표시|화면|값/i.test([
    spec.intent.primaryGoal,
    spec.intent.output ?? '',
    spec.intent.behavior ?? '',
    spec.behavior.runText,
    ...spec.assumptions
  ].join(' '));

  for (const component of spec.components.filter((candidate) => ANALOG_SENSOR_MODULE_PART_IDS.has(candidate.partId))) {
    if (displayRequested && !hasDisplay) {
      errors.push(`ANALOG_SENSOR_DISPLAY_MISSING: ${component.label} readout needs an I2C text display in this supported topology.`);
    }
  }

  return errors;
}

function validateResistiveSensorDividerPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const graph = buildEndpointGraph(spec, { includeResistiveSensors: false });
  const referenceIds = spec.components
    .filter((component) => RESISTIVE_SENSOR_REFERENCE_RESISTOR_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const hasDisplay = hasI2cTextDisplay(spec);
  const displayRequested = /display|oled|screen|show|readout|표시|화면|값/i.test([
    spec.intent.primaryGoal,
    spec.intent.output ?? '',
    spec.intent.behavior ?? '',
    spec.behavior.runText,
    ...spec.assumptions
  ].join(' '));
  const thresholdRequested = hasThresholdLanguage(spec);

  for (const component of spec.components.filter((candidate) => RESISTIVE_SENSOR_PART_IDS.has(candidate.partId))) {
    const part = partsById.get(component.partId);
    const terminalPins = part?.pins.map((pin) => pin.name) ?? [];
    const terminalKeys = terminalPins.map((pin) => `${component.id}:${pin}`);
    if (terminalKeys.length < 2) {
      errors.push(`RESISTIVE_SENSOR_PIN_MAP_INVALID: ${component.label} needs exactly two resistive terminals.`);
      continue;
    }

    if (referenceIds.length === 0) {
      errors.push(`RESISTIVE_SENSOR_REFERENCE_RESISTOR_MISSING: ${component.label} needs a fixed 10K reference resistor for the voltage divider.`);
    }

    const powerTerminals = terminalKeys.filter((key) =>
      endpointReachesAnyControllerRoleInGraph(graph, key, ['power'], partsById, componentsById)
    );
    if (powerTerminals.length === 0) {
      errors.push(`RESISTIVE_SENSOR_DIVIDER_POWER_MISSING: ${component.label} needs one terminal connected to Arduino 5V.`);
    }

    const analogTerminals = terminalKeys.filter((key) =>
      endpointReachesAnyControllerRoleInGraph(graph, key, ['analog-input'], partsById, componentsById)
    );
    if (analogTerminals.length === 0) {
      errors.push(`RESISTIVE_SENSOR_ANALOG_SIGNAL_MISSING: ${component.label} needs the divider midpoint connected to Arduino A0.`);
      continue;
    }

    const dividerTerminal = analogTerminals.find((key) =>
      hasPathThroughReferenceResistorToGround(spec, graph, key, referenceIds, partsById, componentsById)
    );
    if (!dividerTerminal) {
      errors.push(`RESISTIVE_SENSOR_DIVIDER_GROUND_MISSING: ${component.label} needs the A0 divider node connected through a 10K reference resistor to Arduino GND.`);
    }

    const analogConnection = findConnectionFromReachableEndpointToControllerRole(
      spec,
      graph,
      dividerTerminal ?? analogTerminals[0],
      'analog-input',
      partsById,
      componentsById
    );
    if (!analogConnection) {
      errors.push(`RESISTIVE_SENSOR_ANALOG_SIGNAL_MISSING: ${component.label} divider midpoint must reach Arduino A0.`);
    } else if (analogConnection.signal !== 'analog') {
      errors.push(`RESISTIVE_SENSOR_ANALOG_SIGNAL_TYPE_INVALID: ${component.label} divider midpoint must use the analog signal type.`);
    }

    if (displayRequested && !hasDisplay) {
      errors.push(`RESISTIVE_SENSOR_DISPLAY_MISSING: ${component.label} readout needs an I2C text display in this supported topology.`);
    }
    if (thresholdRequested && !hasAnalogThresholdOutputPath(spec, partsById, componentsById)) {
      errors.push(`RESISTIVE_SENSOR_THRESHOLD_OUTPUT_MISSING: ${component.label} threshold circuits need a current-limited LED output path.`);
    }
  }

  return errors;
}

function validateI2cDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  for (const component of spec.components.filter((candidate) => I2C_TEXT_DISPLAY_PART_IDS.has(candidate.partId))) {
    if (!endpointReachesControllerRole(spec, `${component.id}:VCC`, 'power', partsById, componentsById)) {
      errors.push(`DISPLAY_POWER_MISSING: ${component.label} needs VCC connected to Arduino 5V.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:GND`, 'ground', partsById, componentsById)) {
      errors.push(`DISPLAY_GROUND_MISSING: ${component.label} needs GND connected to Arduino GND.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:SDA`, 'i2c-data', partsById, componentsById)) {
      errors.push(`DISPLAY_I2C_CONNECTION_MISSING: ${component.label} SDA must connect to Arduino A4/SDA.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:SCL`, 'i2c-clock', partsById, componentsById)) {
      errors.push(`DISPLAY_I2C_CONNECTION_MISSING: ${component.label} SCL must connect to Arduino A5/SCL.`);
    }
  }
  return errors;
}

function validateBareSevenSegmentDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const graph = buildEndpointGraph(spec);
  const resistorIds = spec.components
    .filter((component) => component.partId === 'resistor-220')
    .map((component) => component.id);
  const resistorIdsBySegment = new Map<string, string[]>();

  for (const component of spec.components.filter((candidate) => BARE_SEVEN_SEGMENT_DISPLAY_PART_IDS.has(candidate.partId))) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }

    const groundPin = firstPinNameForRole(part, isGroundRole) ?? 'GND';
    const segmentPins = bareSevenSegmentPins(part);
    let validSegmentPaths = 0;

    if (!endpointReachesControllerRole(spec, `${component.id}:${groundPin}`, 'ground', partsById, componentsById)) {
      errors.push(`BARE_7SEG_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`);
    }

    for (const pin of segmentPins) {
      const segmentKey = `${component.id}:${pin}`;
      const reachesOutput = endpointReachesAnyControllerRoleInGraph(
        graph,
        segmentKey,
        ['digital-output', 'pwm-output'],
        partsById,
        componentsById
      );
      if (!reachesOutput) {
        continue;
      }

      const controllerOutputs = controllerEndpointKeysWithRole(spec, ['digital-output', 'pwm-output'], partsById, componentsById);
      const seriesResistorIds = componentIdsOnPathThroughAnyComponent(graph, controllerOutputs, segmentKey, resistorIds);
      if (seriesResistorIds.length === 0) {
        errors.push(`BARE_7SEG_SEGMENT_RESISTOR_MISSING: ${component.label} segment ${pin} must be driven through its own 220 ohm resistor.`);
        continue;
      }

      validSegmentPaths += 1;
      for (const resistorId of seriesResistorIds) {
        const segmentIds = resistorIdsBySegment.get(resistorId) ?? [];
        segmentIds.push(`${component.id}:${pin}`);
        resistorIdsBySegment.set(resistorId, segmentIds);
      }
    }

    if (validSegmentPaths === 0) {
      errors.push(`BARE_7SEG_SEGMENT_SIGNAL_MISSING: ${component.label} needs at least one segment pin connected to an Arduino digital output through a 220 ohm resistor.`);
    }
  }

  for (const [resistorId, segmentIds] of resistorIdsBySegment.entries()) {
    if (segmentIds.length > 1) {
      errors.push(`BARE_7SEG_RESISTOR_SHARED: ${resistorId} is shared by multiple segment pins (${segmentIds.join(', ')}). Give each driven segment its own current limiting resistor.`);
    }
  }

  return unique(errors);
}

function validateLedArrayDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  for (const component of spec.components.filter((candidate) => LED_ARRAY_DISPLAY_PART_IDS.has(candidate.partId))) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }

    const powerPin = firstPinNameForRole(part, isPowerRole) ?? 'VCC';
    const groundPin = firstPinNameForRole(part, isGroundRole) ?? 'GND';
    const dataPin = firstPinNameForRole(part, (role) => role === 'data' || role === 'single-wire-data') ?? 'DIO';
    const clockPin = firstPinNameForRole(part, (role) => role === 'clock') ?? 'CLK';
    const selectPin = firstPinNameForRole(part, (role) => role === 'chip-select' || role === 'enable');

    if (!endpointReachesControllerRole(spec, `${component.id}:${powerPin}`, 'power', partsById, componentsById)) {
      errors.push(`LED_ARRAY_DISPLAY_POWER_MISSING: ${component.label} needs ${powerPin} connected to Arduino 5V.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:${groundPin}`, 'ground', partsById, componentsById)) {
      errors.push(`LED_ARRAY_DISPLAY_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`);
    }
    if (!endpointReachesAnyControllerRole(spec, `${component.id}:${dataPin}`, ['digital-output', 'pwm-output'], partsById, componentsById)) {
      errors.push(`LED_ARRAY_DISPLAY_DATA_MISSING: ${component.label} needs ${dataPin} connected to an Arduino digital output pin.`);
    }
    if (!endpointReachesAnyControllerRole(spec, `${component.id}:${clockPin}`, ['digital-output', 'pwm-output'], partsById, componentsById)) {
      errors.push(`LED_ARRAY_DISPLAY_CLOCK_MISSING: ${component.label} needs ${clockPin} connected to an Arduino digital output pin.`);
    }
    if (selectPin && !endpointReachesAnyControllerRole(spec, `${component.id}:${selectPin}`, ['digital-output', 'pwm-output'], partsById, componentsById)) {
      errors.push(`LED_ARRAY_DISPLAY_SELECT_MISSING: ${component.label} needs ${selectPin} connected to an Arduino digital output pin.`);
    }
  }

  return errors;
}

function validateAddressableLedDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  for (const component of spec.components.filter((candidate) => ADDRESSABLE_LED_DISPLAY_PART_IDS.has(candidate.partId))) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }

    const powerPin = firstPinNameForRole(part, isPowerRole) ?? '5V';
    const groundPin = firstPinNameForRole(part, isGroundRole) ?? 'GND';
    const dataPin = firstPinNameForRole(part, (role) => role === 'single-wire-data' || role === 'data') ?? 'DIN';

    if (!endpointReachesControllerRole(spec, `${component.id}:${powerPin}`, 'power', partsById, componentsById)) {
      errors.push(`ADDRESSABLE_LED_POWER_MISSING: ${component.label} needs ${powerPin} connected to Arduino 5V.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:${groundPin}`, 'ground', partsById, componentsById)) {
      errors.push(`ADDRESSABLE_LED_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`);
    }
    if (!endpointReachesAnyControllerRole(spec, `${component.id}:${dataPin}`, ['digital-output', 'pwm-output'], partsById, componentsById)) {
      errors.push(`ADDRESSABLE_LED_DATA_MISSING: ${component.label} needs ${dataPin} connected to an Arduino digital output pin.`);
    }
  }

  return errors;
}

function validateSpiDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  for (const component of spec.components.filter((candidate) => SPI_DISPLAY_PART_IDS.has(candidate.partId))) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }

    const powerPin = firstPinNameForRole(part, isPowerRole) ?? 'VCC';
    const groundPin = firstPinNameForRole(part, isGroundRole) ?? 'GND';
    const dataPin = firstPinNameForRole(part, (role) => role === 'data') ?? 'DIN';
    const clockPin = firstPinNameForRole(part, (role) => role === 'clock') ?? 'SCK';
    const selectPin = firstPinNameForRole(part, (role) => role === 'chip-select' || role === 'enable') ?? 'CS';
    const controlPins = part.pins
      .filter((pin) => pin.role === 'data-command' || pin.role === 'reset')
      .map((pin) => pin.name);

    if (!endpointReachesControllerRole(spec, `${component.id}:${powerPin}`, 'power', partsById, componentsById)) {
      errors.push(`SPI_DISPLAY_POWER_MISSING: ${component.label} needs ${powerPin} connected to Arduino power.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:${groundPin}`, 'ground', partsById, componentsById)) {
      errors.push(`SPI_DISPLAY_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`);
    }
    if (!endpointReachesAnyControllerRole(spec, `${component.id}:${dataPin}`, ['digital-output', 'pwm-output'], partsById, componentsById)) {
      errors.push(`SPI_DISPLAY_DATA_MISSING: ${component.label} needs ${dataPin} connected to an Arduino digital output pin.`);
    }
    if (!endpointReachesAnyControllerRole(spec, `${component.id}:${clockPin}`, ['digital-output', 'pwm-output'], partsById, componentsById)) {
      errors.push(`SPI_DISPLAY_CLOCK_MISSING: ${component.label} needs ${clockPin} connected to an Arduino digital output pin.`);
    }
    if (!endpointReachesAnyControllerRole(spec, `${component.id}:${selectPin}`, ['digital-output', 'pwm-output'], partsById, componentsById)) {
      errors.push(`SPI_DISPLAY_SELECT_MISSING: ${component.label} needs ${selectPin} connected to an Arduino digital output pin.`);
    }
    for (const controlPin of controlPins) {
      if (!endpointReachesAnyControllerRole(spec, `${component.id}:${controlPin}`, ['digital-output', 'pwm-output'], partsById, componentsById)) {
        errors.push(`SPI_DISPLAY_CONTROL_MISSING: ${component.label} needs ${controlPin} connected to an Arduino digital output pin.`);
      }
    }
  }

  return errors;
}

function validateDistanceSensorDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  for (const component of spec.components.filter((candidate) => DISTANCE_SENSOR_PART_IDS.has(candidate.partId))) {
    if (!endpointReachesControllerRole(spec, `${component.id}:VCC`, 'power', partsById, componentsById)) {
      errors.push(`DISTANCE_SENSOR_POWER_MISSING: ${component.label} needs VCC connected to Arduino 5V.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:GND`, 'ground', partsById, componentsById)) {
      errors.push(`DISTANCE_SENSOR_GROUND_MISSING: ${component.label} needs GND connected to Arduino GND.`);
    }
    if (!endpointReachesAnyControllerRole(spec, `${component.id}:TRIG`, ['digital-output', 'pwm-output'], partsById, componentsById)) {
      errors.push(`DISTANCE_SENSOR_TRIG_MISSING: ${component.label} TRIG must connect to an Arduino digital output such as D3.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:ECHO`, 'digital-input', partsById, componentsById)) {
      errors.push(`DISTANCE_SENSOR_ECHO_MISSING: ${component.label} ECHO must connect to an Arduino digital input such as D2.`);
    }
  }
  return errors;
}

function validateSingleWireSensorDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  for (const component of spec.components.filter((candidate) => SINGLE_WIRE_SENSOR_PART_IDS.has(candidate.partId))) {
    const part = partsById.get(component.partId);
    const dataPin = part
      ? firstPinNameForRole(part, (role) => role === 'single-wire-data' || role === 'digital-data' || role === 'digital-output')
      : 'DAT';

    if (!endpointReachesControllerRole(spec, `${component.id}:VCC`, 'power', partsById, componentsById)) {
      errors.push(`DHT_SENSOR_POWER_MISSING: ${component.label} needs VCC connected to Arduino 5V.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:GND`, 'ground', partsById, componentsById)) {
      errors.push(`DHT_SENSOR_GROUND_MISSING: ${component.label} needs GND connected to Arduino GND.`);
    }
    if (!hasDisplay) {
      errors.push(`DHT_DISPLAY_MISSING: ${component.label} temperature/humidity readout needs an I2C text display in this supported topology.`);
    }

    const dataConnection = dataPin
      ? findConnectionToControllerRole(spec, component.id, dataPin, 'digital-input')
      : null;
    const dataControllerEndpoint = dataConnection
      ? [dataConnection.from, dataConnection.to].find((endpoint) => endpoint.componentId !== component.id)
      : null;
    if (!dataPin || !dataConnection || dataControllerEndpoint?.pin !== 'D2') {
      errors.push(`DHT_SENSOR_DATA_MISSING: ${component.label} DAT must connect to Arduino D2 in this supported topology.`);
    } else if (dataConnection.signal !== 'single-wire-data') {
      errors.push(`DHT_SENSOR_DATA_SIGNAL_INVALID: ${component.label} DAT must use the single-wire-data signal type.`);
    }
  }
  return errors;
}

function validateI2cProtocolSensorDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  for (const component of spec.components.filter((candidate) => I2C_PROTOCOL_SENSOR_PART_IDS.has(candidate.partId))) {
    const part = partsById.get(component.partId);
    const powerPin = part ? firstPinNameForRole(part, (role) => role === 'power') ?? 'VCC' : 'VCC';
    const groundPin = part ? firstPinNameForRole(part, (role) => role === 'ground') ?? 'GND' : 'GND';
    const sdaPin = part ? firstPinNameForRole(part, (role) => role === 'i2c-data') ?? 'SDA' : 'SDA';
    const sclPin = part ? firstPinNameForRole(part, (role) => role === 'i2c-clock') ?? 'SCL' : 'SCL';

    if (!hasDisplay) {
      errors.push(`PROTOCOL_SENSOR_DISPLAY_MISSING: ${component.label} readout needs an I2C text display in this supported topology.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:${powerPin}`, 'power', partsById, componentsById)) {
      errors.push(`PROTOCOL_SENSOR_POWER_MISSING: ${component.label} needs ${powerPin} connected to Arduino power.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:${groundPin}`, 'ground', partsById, componentsById)) {
      errors.push(`PROTOCOL_SENSOR_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`);
    }

    const sdaConnection = findConnectionToControllerRole(spec, component.id, sdaPin, 'i2c-data');
    const sclConnection = findConnectionToControllerRole(spec, component.id, sclPin, 'i2c-clock');
    if (!sdaConnection || controllerPinFromConnection(spec, sdaConnection, component.id) !== 'A4/SDA') {
      errors.push(`I2C_PROTOCOL_SENSOR_SDA_MISSING: ${component.label} ${sdaPin} must connect to Arduino A4/SDA.`);
    } else if (!validI2cSignalType(sdaConnection.signal, 'data')) {
      errors.push(`I2C_PROTOCOL_SENSOR_SIGNAL_INVALID: ${component.label} ${sdaPin} must use an I2C data signal type.`);
    }
    if (!sclConnection || controllerPinFromConnection(spec, sclConnection, component.id) !== 'A5/SCL') {
      errors.push(`I2C_PROTOCOL_SENSOR_SCL_MISSING: ${component.label} ${sclPin} must connect to Arduino A5/SCL.`);
    } else if (!validI2cSignalType(sclConnection.signal, 'clock')) {
      errors.push(`I2C_PROTOCOL_SENSOR_SIGNAL_INVALID: ${component.label} ${sclPin} must use an I2C clock signal type.`);
    }
  }
  return errors;
}

function validateClockedDataSensorDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  for (const component of spec.components.filter((candidate) => CLOCKED_DATA_SENSOR_PART_IDS.has(candidate.partId))) {
    const part = partsById.get(component.partId);
    const powerPin = part ? firstPinNameForRole(part, (role) => role === 'power') ?? 'VCC' : 'VCC';
    const groundPin = part ? firstPinNameForRole(part, (role) => role === 'ground') ?? 'GND' : 'GND';
    const dataPin = part ? firstPinNameForRole(part, (role) => role === 'digital-data') ?? 'DT' : 'DT';
    const clockPin = part ? firstPinNameForRole(part, (role) => role === 'digital-clock') ?? 'SCK' : 'SCK';

    if (!hasDisplay) {
      errors.push(`PROTOCOL_SENSOR_DISPLAY_MISSING: ${component.label} readout needs an I2C text display in this supported topology.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:${powerPin}`, 'power', partsById, componentsById)) {
      errors.push(`CLOCKED_DATA_SENSOR_POWER_MISSING: ${component.label} needs ${powerPin} connected to Arduino power.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:${groundPin}`, 'ground', partsById, componentsById)) {
      errors.push(`CLOCKED_DATA_SENSOR_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`);
    }

    const dataConnection = findConnectionToControllerRole(spec, component.id, dataPin, 'digital-input');
    const clockConnection = findConnectionToControllerRole(spec, component.id, clockPin, 'digital-output')
      ?? findConnectionToControllerRole(spec, component.id, clockPin, 'pwm-output');
    if (!dataConnection || controllerPinFromConnection(spec, dataConnection, component.id) !== 'D2') {
      errors.push(`CLOCKED_DATA_SENSOR_DATA_MISSING: ${component.label} ${dataPin} must connect to Arduino D2.`);
    } else if (!validClockedDataSignalType(dataConnection.signal)) {
      errors.push(`CLOCKED_DATA_SENSOR_SIGNAL_INVALID: ${component.label} ${dataPin} must use a digital or clocked-data signal type.`);
    }
    if (!clockConnection) {
      errors.push(`CLOCKED_DATA_SENSOR_CLOCK_MISSING: ${component.label} ${clockPin} must connect to an Arduino digital output such as D3.`);
    } else if (!validClockedDataSignalType(clockConnection.signal)) {
      errors.push(`CLOCKED_DATA_SENSOR_SIGNAL_INVALID: ${component.label} ${clockPin} must use a digital or clocked-data signal type.`);
    }
  }
  return errors;
}

function validateSpiProtocolSensorDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  for (const component of spec.components.filter((candidate) => SPI_PROTOCOL_SENSOR_PART_IDS.has(candidate.partId))) {
    const part = partsById.get(component.partId);
    const powerPin = part ? firstPinNameForRole(part, (role) => role === 'power') ?? '3V3' : '3V3';
    const groundPin = part ? firstPinNameForRole(part, (role) => role === 'ground') ?? 'GND' : 'GND';
    const sckPin = part ? firstPinNameForRole(part, (role) => role === 'spi-clock') ?? 'SCK' : 'SCK';
    const mosiPin = part ? firstPinNameForRole(part, (role) => role === 'spi-mosi') ?? 'MOSI' : 'MOSI';
    const misoPin = part ? firstPinNameForRole(part, (role) => role === 'spi-miso') ?? 'MISO' : 'MISO';
    const selectPin = part ? firstPinNameForRole(part, (role) => role === 'spi-select') ?? 'CS' : 'CS';

    if (!hasDisplay) {
      errors.push(`PROTOCOL_SENSOR_DISPLAY_MISSING: ${component.label} readout needs an I2C text display in this supported topology.`);
    }
    if (!endpointReachesControllerPin(spec, `${component.id}:${powerPin}`, ['3V3'], partsById, componentsById)) {
      errors.push(`SPI_PROTOCOL_SENSOR_3V3_MISSING: ${component.label} ${powerPin} must connect to Arduino 3V3, not 5V.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:${groundPin}`, 'ground', partsById, componentsById)) {
      errors.push(`SPI_PROTOCOL_SENSOR_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`);
    }

    errors.push(...validateProtocolPinConnection(spec, component, sckPin, 'spi-clock', 'D13', 'SPI_PROTOCOL_SENSOR_CLOCK_MISSING', 'SPI clock'));
    errors.push(...validateProtocolPinConnection(spec, component, mosiPin, 'spi-mosi', 'D11', 'SPI_PROTOCOL_SENSOR_MOSI_MISSING', 'SPI MOSI'));
    errors.push(...validateProtocolPinConnection(spec, component, misoPin, 'spi-miso', 'D12', 'SPI_PROTOCOL_SENSOR_MISO_MISSING', 'SPI MISO'));
    errors.push(...validateProtocolPinConnection(spec, component, selectPin, 'spi-select', 'D10', 'SPI_PROTOCOL_SENSOR_SELECT_MISSING', 'SPI chip-select'));
  }
  return errors;
}

function validateUartProtocolSensorDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  for (const component of spec.components.filter((candidate) => UART_PROTOCOL_SENSOR_PART_IDS.has(candidate.partId))) {
    const part = partsById.get(component.partId);
    const powerPin = part ? firstPinNameForRole(part, (role) => role === 'power') ?? 'VCC' : 'VCC';
    const groundPin = part ? firstPinNameForRole(part, (role) => role === 'ground') ?? 'GND' : 'GND';
    const txPin = part ? firstPinNameForRole(part, (role) => role === 'serial-tx') ?? 'TX' : 'TX';
    const rxPin = part ? firstPinNameForRole(part, (role) => role === 'serial-rx') ?? 'RX' : 'RX';

    if (!hasDisplay) {
      errors.push(`PROTOCOL_SENSOR_DISPLAY_MISSING: ${component.label} readout needs an I2C text display in this supported topology.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:${powerPin}`, 'power', partsById, componentsById)) {
      errors.push(`UART_PROTOCOL_SENSOR_POWER_MISSING: ${component.label} needs ${powerPin} connected to Arduino power.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:${groundPin}`, 'ground', partsById, componentsById)) {
      errors.push(`UART_PROTOCOL_SENSOR_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`);
    }

    const txConnection = findConnectionToControllerRole(spec, component.id, txPin, 'serial-rx');
    if (!txConnection || controllerPinFromConnection(spec, txConnection, component.id) !== 'D0/RX') {
      errors.push(`UART_PROTOCOL_SENSOR_TX_MISSING: ${component.label} ${txPin} must connect to Arduino D0/RX.`);
    } else if (!validUartSignalType(txConnection.signal)) {
      errors.push(`UART_PROTOCOL_SENSOR_SIGNAL_INVALID: ${component.label} ${txPin} must use a UART signal type.`);
    }

    const rxConnections = spec.connections.filter((connection) =>
      [connection.from, connection.to].some((endpoint) => endpoint.componentId === component.id && endpoint.pin === rxPin)
    );
    if (rxConnections.length > 0) {
      const rxConnection = findConnectionToControllerRole(spec, component.id, rxPin, 'serial-tx');
      if (!rxConnection || controllerPinFromConnection(spec, rxConnection, component.id) !== 'D1/TX') {
        errors.push(`UART_PROTOCOL_SENSOR_RX_INVALID: ${component.label} ${rxPin}, when connected, must connect to Arduino D1/TX.`);
      } else if (!validUartSignalType(rxConnection.signal)) {
        errors.push(`UART_PROTOCOL_SENSOR_SIGNAL_INVALID: ${component.label} ${rxPin} must use a UART signal type.`);
      }
    }
  }
  return errors;
}

function validateUartCommunicationModulePaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  for (const component of spec.components.filter((candidate) => UART_COMMUNICATION_MODULE_PART_IDS.has(candidate.partId))) {
    const part = partsById.get(component.partId);
    const powerPin = part ? firstPinNameForRole(part, isPowerRole) ?? 'VCC' : 'VCC';
    const groundPin = part ? firstPinNameForRole(part, isGroundRole) ?? 'GND' : 'GND';
    const txPin = part ? firstPinNameForRole(part, (role) => role === 'serial-tx') ?? 'TX' : 'TX';
    const rxPin = part ? firstPinNameForRole(part, (role) => role === 'serial-rx') ?? 'RX' : 'RX';

    if (!hasDisplay) {
      errors.push(`COMMUNICATION_MODULE_DISPLAY_MISSING: ${component.label} command-state readout needs an I2C text display in this supported topology.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:${powerPin}`, 'power', partsById, componentsById)) {
      errors.push(`UART_COMMUNICATION_MODULE_POWER_MISSING: ${component.label} needs ${powerPin} connected to a supported controller power pin or rail.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:${groundPin}`, 'ground', partsById, componentsById)) {
      errors.push(`UART_COMMUNICATION_MODULE_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`);
    }

    const txConnection = findConnectionToControllerRole(spec, component.id, txPin, 'serial-rx');
    if (!txConnection || controllerPinFromConnection(spec, txConnection, component.id) !== 'D0/RX') {
      errors.push(`UART_COMMUNICATION_MODULE_TX_MISSING: ${component.label} ${txPin} must connect to Arduino D0/RX.`);
    } else if (!validUartSignalType(txConnection.signal)) {
      errors.push(`UART_COMMUNICATION_MODULE_SIGNAL_INVALID: ${component.label} ${txPin} must use a UART signal type.`);
    }

    const rxConnection = findConnectionToControllerRole(spec, component.id, rxPin, 'serial-tx');
    if (!rxConnection || controllerPinFromConnection(spec, rxConnection, component.id) !== 'D1/TX') {
      errors.push(`UART_COMMUNICATION_MODULE_RX_MISSING: ${component.label} ${rxPin} must connect to Arduino D1/TX.`);
    } else if (!validUartSignalType(rxConnection.signal)) {
      errors.push(`UART_COMMUNICATION_MODULE_SIGNAL_INVALID: ${component.label} ${rxPin} must use a UART signal type.`);
    }
  }
  return errors;
}

function validateSpiCommunicationModulePaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  for (const component of spec.components.filter((candidate) => SPI_COMMUNICATION_MODULE_PART_IDS.has(candidate.partId))) {
    const part = partsById.get(component.partId);
    const powerPin = part ? firstPinNameForRole(part, isPowerRole) ?? 'VCC' : 'VCC';
    const groundPin = part ? firstPinNameForRole(part, isGroundRole) ?? 'GND' : 'GND';
    const sckPin = part ? firstPinNameForRole(part, (role) => role === 'spi-clock') ?? 'SCK' : 'SCK';
    const mosiPin = part ? firstPinNameForRole(part, (role) => role === 'spi-mosi') ?? 'MOSI' : 'MOSI';
    const misoPin = part ? firstPinNameForRole(part, (role) => role === 'spi-miso') : null;
    const selectPin = part ? firstPinNameForRole(part, (role) => role === 'spi-select') ?? 'CS' : 'CS';

    if (!hasDisplay) {
      errors.push(`COMMUNICATION_MODULE_DISPLAY_MISSING: ${component.label} bus-state readout needs an I2C text display in this supported topology.`);
    }
    const requires3v3 = ['lora-ra02', 'nrf24l01-radio'].includes(component.partId);
    if (requires3v3) {
      if (!endpointReachesControllerPin(spec, `${component.id}:${powerPin}`, ['3V3'], partsById, componentsById)) {
        errors.push(`SPI_COMMUNICATION_MODULE_3V3_MISSING: ${component.label} ${powerPin} must connect to Arduino 3V3, not 5V.`);
      }
    } else if (!endpointReachesControllerRole(spec, `${component.id}:${powerPin}`, 'power', partsById, componentsById)) {
      errors.push(`SPI_COMMUNICATION_MODULE_POWER_MISSING: ${component.label} needs ${powerPin} connected to Arduino power.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:${groundPin}`, 'ground', partsById, componentsById)) {
      errors.push(`SPI_COMMUNICATION_MODULE_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`);
    }

    errors.push(...validateProtocolPinConnection(spec, component, sckPin, 'spi-clock', 'D13', 'SPI_COMMUNICATION_MODULE_CLOCK_MISSING', 'SPI clock'));
    errors.push(...validateProtocolPinConnection(spec, component, mosiPin, 'spi-mosi', 'D11', 'SPI_COMMUNICATION_MODULE_MOSI_MISSING', 'SPI MOSI'));
    if (misoPin) {
      errors.push(...validateProtocolPinConnection(spec, component, misoPin, 'spi-miso', 'D12', 'SPI_COMMUNICATION_MODULE_MISO_MISSING', 'SPI MISO'));
    }
    errors.push(...validateProtocolPinConnection(spec, component, selectPin, 'spi-select', 'D10', 'SPI_COMMUNICATION_MODULE_SELECT_MISSING', 'SPI chip-select'));
  }
  return errors;
}

function validateDifferentialCommunicationModulePaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  for (const component of spec.components.filter((candidate) => DIFFERENTIAL_COMMUNICATION_MODULE_PART_IDS.has(candidate.partId))) {
    if (!hasDisplay) {
      errors.push(`COMMUNICATION_MODULE_DISPLAY_MISSING: ${component.label} bus-state readout needs an I2C text display in this supported topology.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:VCC`, 'power', partsById, componentsById)) {
      errors.push(`DIFFERENTIAL_COMMUNICATION_MODULE_POWER_MISSING: ${component.label} needs VCC connected to Arduino 5V.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:GND`, 'ground', partsById, componentsById)) {
      errors.push(`DIFFERENTIAL_COMMUNICATION_MODULE_GROUND_MISSING: ${component.label} needs GND connected to Arduino GND.`);
    }

    const roConnection = findConnectionToControllerRole(spec, component.id, 'RO', 'serial-rx');
    if (!roConnection || controllerPinFromConnection(spec, roConnection, component.id) !== 'D0/RX') {
      errors.push(`DIFFERENTIAL_COMMUNICATION_MODULE_RO_MISSING: ${component.label} RO must connect to Arduino D0/RX.`);
    } else if (!validUartSignalType(roConnection.signal)) {
      errors.push(`DIFFERENTIAL_COMMUNICATION_MODULE_SIGNAL_INVALID: ${component.label} RO must use a UART signal type.`);
    }

    const diConnection = findConnectionToControllerRole(spec, component.id, 'DI', 'serial-tx');
    if (!diConnection || controllerPinFromConnection(spec, diConnection, component.id) !== 'D1/TX') {
      errors.push(`DIFFERENTIAL_COMMUNICATION_MODULE_DI_MISSING: ${component.label} DI must connect to Arduino D1/TX.`);
    } else if (!validUartSignalType(diConnection.signal)) {
      errors.push(`DIFFERENTIAL_COMMUNICATION_MODULE_SIGNAL_INVALID: ${component.label} DI must use a UART signal type.`);
    }

    const deConnection = findConnectionToControllerRole(spec, component.id, 'DE', 'digital-output')
      ?? findConnectionToControllerRole(spec, component.id, 'DE', 'pwm-output');
    if (!deConnection) {
      errors.push(`DIFFERENTIAL_COMMUNICATION_MODULE_ENABLE_MISSING: ${component.label} DE must connect to an Arduino digital output such as D3.`);
    }
  }
  return errors;
}

function validateProtocolSensorClaimSafety(spec: CircuitSpec) {
  const errors: string[] = [];
  const text = protocolSensorSafetyText(spec);
  const hasPart = (partId: string) => spec.components.some((component) => component.partId === partId);

  if (hasPart('max30102-pulse') && /\b(spo2|blood\s*oxygen|oxygen\s*saturation|diagnos(?:e|is|tic)|medical|patient|health\s*monitor|vital\s*sign)\b|산소\s*포화|산소포화|진단|의료|환자|건강\s*모니터|바이탈/i.test(text)) {
    errors.push('PROTOCOL_SENSOR_MEDICAL_UNSUPPORTED: MAX30102 is supported only as a qualitative classroom pulse readout, not medical, SpO2, diagnostic, or health-monitoring use.');
  }
  if (hasPart('gps-neo6m') && /\b(track(?:ing)?|navigation|navigate|autopilot|collision|route\s*guidance|fleet|locator|geofence)\b|위치\s*추적|추적|내비|네비|항법|자율\s*주행|자동\s*항법|충돌|경로\s*안내/i.test(text)) {
    errors.push('PROTOCOL_SENSOR_NAVIGATION_UNSUPPORTED: GPS is supported only as a qualitative classroom coordinate readout, not tracking, navigation, autopilot, or safety use.');
  }
  if (hasPart('rc522-rfid') && /\b(door\s*lock|access\s*control|security|payment|authenticate|authentication|unlock|alarm|badge\s*entry)\b|도어락|잠금|출입|보안|결제|인증|경보/i.test(text)) {
    errors.push('PROTOCOL_SENSOR_SECURITY_UNSUPPORTED: RC522 is supported only as a qualitative tag-read classroom demo, not access control, payment, authentication, or security use.');
  }
  if (hasPart('hx711-loadcell') && /\b(certified|legal\s*for\s*trade|exact\s*weight|calibrated|calibration\s*certificate|commercial\s*scale|precision\s*scale)\b|인증|상거래|정확한\s*무게|정밀\s*저울|계량|검정|보정/i.test(text)) {
    errors.push('PROTOCOL_SENSOR_CERTIFIED_MEASUREMENT_UNSUPPORTED: HX711 is supported only as a qualitative classroom load-cell readout, not certified, calibrated, or legal-for-trade measurement.');
  }

  return errors;
}

function validateCommunicationModuleClaimSafety(spec: CircuitSpec) {
  const errors: string[] = [];
  const text = protocolSensorSafetyText(spec);
  const hasCommunicationModule = spec.components.some((component) => COMMUNICATION_MODULE_PART_IDS.has(component.partId));
  const hasUsbHost = spec.components.some((component) => component.partId === 'usb-host-shield');
  const hasWireless = spec.components.some((component) => WIRELESS_COMMUNICATION_MODULE_PART_IDS.has(component.partId));

  if (hasWireless && /\b(cloud|internet|backend|phone\s*pairing|pair(?:ing)?\s*with\s*my\s*phone|sms|call|cellular\s*service|real\s+range|tracking|tracker|security|door\s*lock)\b|클라우드|인터넷|문자|전화|추적|보안|도어락/i.test(text)) {
    errors.push('COMMUNICATION_MODULE_NETWORK_UNSUPPORTED: wireless modules are supported only as local command/bus state, not real cloud, phone, SMS/call, tracking, security, or RF range behavior.');
  }
  if (hasUsbHost && /\b(enumerat(?:e|ion)|keyboard|mouse|storage|hid|flash\s*drive|real\s+usb|device\s*driver)\b|키보드|마우스|저장장치|실제\s*USB/i.test(text)) {
    errors.push('COMMUNICATION_MODULE_USB_HOST_UNSUPPORTED: USB host shield is supported only as local SPI status, not real USB device enumeration or HID/storage behavior.');
  }
  if (hasCommunicationModule && /\b(certified|industrial\s+network|vehicle\s+control|safety\s+critical|production\s+network)\b|인증|산업용\s*네트워크|차량\s*제어|안전\s*필수/i.test(text)) {
    errors.push('COMMUNICATION_MODULE_CERTIFIED_NETWORK_UNSUPPORTED: communication modules are classroom simulations and cannot claim certified, industrial, vehicle-control, or safety-critical networking.');
  }

  return errors;
}

function validateLogicInterfaceContextPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);

  for (const component of spec.components.filter((candidate) => LOGIC_INTERFACE_PART_IDS.has(candidate.partId))) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }

    if (LEVEL_SHIFTER_INTERFACE_PART_IDS.has(component.partId)) {
      errors.push(...validateLevelShifterContextPath(spec, component, partsById, componentsById));
      continue;
    }

    const powerPin = firstPinNameForRole(part, isPowerRole) ?? 'VCC';
    const groundPin = firstPinNameForRole(part, isGroundRole) ?? 'GND';

    if (!hasDisplay) {
      errors.push(`LOGIC_INTERFACE_DISPLAY_MISSING: ${component.label} state readout needs an I2C text display in this supported topology.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:${powerPin}`, 'power', partsById, componentsById)) {
      errors.push(`LOGIC_INTERFACE_POWER_MISSING: ${component.label} needs ${powerPin} connected to Arduino power.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:${groundPin}`, 'ground', partsById, componentsById)) {
      errors.push(`LOGIC_INTERFACE_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`);
    }

    if (I2C_LOGIC_INTERFACE_PART_IDS.has(component.partId)) {
      const sdaPin = firstPinNameForRole(part, (role) => role === 'i2c-data') ?? 'SDA';
      const sclPin = firstPinNameForRole(part, (role) => role === 'i2c-clock') ?? 'SCL';
      errors.push(...validateI2cInterfacePinConnection(spec, component, sdaPin, 'i2c-data', 'A4/SDA', 'LOGIC_INTERFACE_SDA_MISSING', 'I2C SDA'));
      errors.push(...validateI2cInterfacePinConnection(spec, component, sclPin, 'i2c-clock', 'A5/SCL', 'LOGIC_INTERFACE_SCL_MISSING', 'I2C SCL'));
    }

    if (SPI_LOGIC_INTERFACE_PART_IDS.has(component.partId)) {
      const clockPin = firstPinNameForRole(part, (role) => role === 'spi-clock') ?? 'CLK';
      const mosiPin = firstPinNameForRole(part, (role) => role === 'spi-mosi') ?? 'DIN';
      const misoPin = firstPinNameForRole(part, (role) => role === 'spi-miso') ?? 'DOUT';
      const selectPin = firstPinNameForRole(part, (role) => role === 'spi-select') ?? 'CS';
      errors.push(...validateProtocolPinConnection(spec, component, clockPin, 'spi-clock', 'D13', 'LOGIC_INTERFACE_SPI_CLOCK_MISSING', 'SPI clock'));
      errors.push(...validateProtocolPinConnection(spec, component, mosiPin, 'spi-mosi', 'D11', 'LOGIC_INTERFACE_SPI_MOSI_MISSING', 'SPI MOSI'));
      errors.push(...validateProtocolPinConnection(spec, component, misoPin, 'spi-miso', 'D12', 'LOGIC_INTERFACE_SPI_MISO_MISSING', 'SPI MISO'));
      errors.push(...validateProtocolPinConnection(spec, component, selectPin, 'spi-select', 'D10', 'LOGIC_INTERFACE_SPI_SELECT_MISSING', 'SPI chip-select'));
    }

    if (SHIFT_REGISTER_INTERFACE_PART_IDS.has(component.partId)) {
      for (const { pin, label } of [
        { pin: 'SER', label: 'serial data' },
        { pin: 'SRCLK', label: 'shift clock' },
        { pin: 'RCLK', label: 'latch clock' }
      ]) {
        if (!findConnectedControllerEndpointWithAnyRole(spec, component.id, pin, ['digital-output', 'pwm-output', 'spi-mosi', 'spi-clock', 'spi-select'])) {
          errors.push(`LOGIC_INTERFACE_SIGNAL_MISSING: ${component.label} ${pin} must connect to an Arduino output for ${label}.`);
        }
      }
    }

    if (ANALOG_TIMING_INTERFACE_PART_IDS.has(component.partId)) {
      const outputPin = firstPinNameForRole(part, (role) => role === 'digital-output' || role === 'analog-output') ?? 'OUT';
      if (!findConnectedControllerEndpointWithAnyRole(spec, component.id, outputPin, ['digital-input', 'analog-input'])) {
        errors.push(`LOGIC_INTERFACE_OUTPUT_MISSING: ${component.label} ${outputPin} must connect to an Arduino input for qualitative state display.`);
      }
    }
  }

  return errors;
}

function validateI2cInterfacePinConnection(
  spec: CircuitSpec,
  component: CircuitSpec['components'][number],
  targetPin: string,
  controllerRole: 'i2c-data' | 'i2c-clock',
  expectedControllerPin: string,
  errorCode: string,
  label: string
) {
  const connection = findConnectionToControllerRole(spec, component.id, targetPin, controllerRole);
  const controllerPin = connection ? controllerPinFromConnection(spec, connection, component.id) : null;
  if (!connection || controllerPin !== expectedControllerPin) {
    return [`${errorCode}: ${component.label} ${targetPin} must connect to Arduino ${expectedControllerPin} for ${label}.`];
  }
  const role = controllerRole === 'i2c-data' ? 'data' : 'clock';
  if (!validI2cSignalType(connection.signal, role)) {
    return [`LOGIC_INTERFACE_I2C_SIGNAL_INVALID: ${component.label} ${targetPin} must use an I2C ${role} signal type.`];
  }
  return [];
}

function validateLevelShifterContextPath(
  spec: CircuitSpec,
  component: CircuitSpec['components'][number],
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  if (!endpointReachesControllerPin(spec, `${component.id}:HV`, ['5V'], partsById, componentsById)) {
    errors.push(`LEVEL_SHIFTER_HV_MISSING: ${component.label} HV must connect to Arduino 5V for the high-side reference.`);
  }
  if (!endpointReachesControllerPin(spec, `${component.id}:LV`, ['3V3'], partsById, componentsById)) {
    errors.push(`LEVEL_SHIFTER_LV_MISSING: ${component.label} LV must connect to Arduino 3V3 for the low-side reference.`);
  }
  if (!endpointReachesControllerRole(spec, `${component.id}:GND`, 'ground', partsById, componentsById)) {
    errors.push(`LEVEL_SHIFTER_GROUND_MISSING: ${component.label} needs GND connected to Arduino GND.`);
  }
  const hasHighSignal = findConnectedControllerEndpointWithAnyRole(spec, component.id, 'HV1', ['digital-output', 'digital-input', 'i2c-data', 'i2c-clock']);
  const hasLowSignal = findConnectedControllerEndpointWithAnyRole(spec, component.id, 'LV1', ['digital-output', 'digital-input', 'i2c-data', 'i2c-clock']);
  if (!hasHighSignal && !hasLowSignal) {
    errors.push(`LEVEL_SHIFTER_SIGNAL_MISSING: ${component.label} needs the visible HV1/LV1 signal pair connected for qualitative level-shift state.`);
  }
  return errors;
}

function validateLogicInterfaceClaimSafety(spec: CircuitSpec) {
  const errors: string[] = [];
  const text = protocolSensorSafetyText(spec);
  const hasLogicInterface = spec.components.some((component) => LOGIC_INTERFACE_PART_IDS.has(component.partId));
  if (!hasLogicInterface) {
    return errors;
  }

  if (
    spec.components.some((component) => component.partId === 'ads1115-adc' || component.partId === 'mcp3008-adc' || component.partId === 'lm358-opamp')
    && /\b(calibrated|precision|certified|exact\s+voltage|legal\s+for\s+trade|medical|rail-?to-?rail|spice|audio\s+power|instrumentation)\b|정밀|보정|인증|정확한\s*전압|의료|계측/i.test(text)
  ) {
    errors.push('LOGIC_INTERFACE_PRECISION_ANALOG_UNSUPPORTED: ADC and op-amp parts are supported only as qualitative classroom interface state, not calibrated precision analog design.');
  }
  if (
    spec.components.some((component) => component.partId === 'ne555-timer')
    && /\b(exact|calibrated|precise|precision)\b.*\b(frequency|hz|duty\s*cycle|waveform)\b|정확|정밀|보정|주파수|듀티|파형/i.test(text)
  ) {
    errors.push('LOGIC_INTERFACE_TIMER_FREQUENCY_UNSUPPORTED: NE555 is supported only as qualitative timing state, not exact calibrated frequency, duty cycle, or waveform simulation.');
  }
  if (
    spec.components.some((component) => component.partId === 'i2c-level-shifter')
    && /\b(power\s+regulator|voltage\s+regulator|current\s+booster|boost\s+current|power\s+supply)\b|전원\s*공급|레귤레이터|전류\s*증폭/i.test(text)
  ) {
    errors.push('LOGIC_INTERFACE_LEVEL_SHIFT_UNSUPPORTED: level shifters are supported only as qualitative signal voltage-domain context, not power regulation or current boosting.');
  }

  return errors;
}

function validateDigitalInputStatePaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  for (const component of spec.components.filter((candidate) => DIGITAL_INPUT_STATE_PART_IDS.has(candidate.partId))) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }

    const signalPin = digitalInputSignalPinForComponent(spec, component, part);
    if (!signalPin) {
      errors.push(`DIGITAL_INPUT_SIGNAL_PIN_MISSING: ${component.label} needs a signal terminal connected to an Arduino digital input such as D2.`);
      continue;
    }

    const signalConnection = findConnectionToControllerRole(spec, component.id, signalPin, 'digital-input');
    if (!signalConnection) {
      errors.push(`DIGITAL_INPUT_SIGNAL_MISSING: ${component.label} ${signalPin} must connect to an Arduino digital input such as D2.`);
    } else if (!validDigitalInputSignalType(signalConnection.signal, component.partId)) {
      errors.push(`DIGITAL_INPUT_SIGNAL_TYPE_INVALID: ${component.label} ${signalPin} must use a digital or pulse signal type.`);
    }

    if (PASSIVE_DIGITAL_SWITCH_PART_IDS.has(component.partId)) {
      const referencePins = part.pins
        .map((pin) => pin.name)
        .filter((pin) => pin !== signalPin);
      if (!referencePins.some((pin) => endpointReachesControllerRole(spec, `${component.id}:${pin}`, 'ground', partsById, componentsById))) {
        errors.push(`DIGITAL_INPUT_REFERENCE_MISSING: ${component.label} needs a second switch terminal tied to Arduino GND or another defined reference.`);
      }
      continue;
    }

    if (!endpointReachesControllerRole(spec, `${component.id}:VCC`, 'power', partsById, componentsById)) {
      errors.push(`DIGITAL_SENSOR_POWER_MISSING: ${component.label} needs VCC connected to Arduino 5V.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:GND`, 'ground', partsById, componentsById)) {
      errors.push(`DIGITAL_SENSOR_GROUND_MISSING: ${component.label} needs GND connected to Arduino GND.`);
    }

    if (PULSE_DIGITAL_SENSOR_PART_IDS.has(component.partId)) {
      const controlPins = part.pins
        .filter((pin) => pin.role === 'digital-control')
        .map((pin) => pin.name);
      for (const controlPin of controlPins) {
        if (!endpointReachesAnyControllerRole(spec, `${component.id}:${controlPin}`, ['digital-output', 'pwm-output'], partsById, componentsById)) {
          errors.push(`PULSE_SENSOR_CONTROL_MISSING: ${component.label} ${controlPin} must connect to an Arduino digital output in this supported topology.`);
        }
      }
    }
  }
  return errors;
}

function digitalInputSignalPinForComponent(
  spec: CircuitSpec,
  component: CircuitSpec['components'][number],
  part: PartCapability
) {
  const preferredRoles = ['digital-output', 'pulse-output', 'switch-common', 'switch-terminal'];
  for (const role of preferredRoles) {
    const directPin = part.pins
      .filter((pin) => pin.role === role)
      .map((pin) => pin.name)
      .find((pin) => findConnectionToControllerRole(spec, component.id, pin, 'digital-input'));
    if (directPin) {
      return directPin;
    }
  }

  return firstPinNameForRole(part, (role) => preferredRoles.includes(role));
}

function validDigitalInputSignalType(signal: string, partId: string) {
  const normalized = signal.toLowerCase();
  if (PULSE_DIGITAL_SENSOR_PART_IDS.has(partId)) {
    return ['pulse', 'digital-pulse', 'digital', 'gpio'].includes(normalized);
  }
  return ['digital', 'gpio', 'button'].includes(normalized);
}

function validateMatrixInputDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const matrixComponents = spec.components.filter((candidate) => MATRIX_INPUT_PART_IDS.has(candidate.partId));
  if (matrixComponents.length === 0) {
    return errors;
  }

  const hasDisplay = hasI2cTextDisplay(spec);
  for (const component of matrixComponents) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }
    if (!hasDisplay) {
      errors.push(`MATRIX_INPUT_DISPLAY_MISSING: ${component.label} state readout needs an I2C text display in this supported topology.`);
    }
    if (MATRIX_KEYPAD_PART_IDS.has(component.partId)) {
      errors.push(...validateRowColumnMatrixInput(spec, component, part));
    } else if (component.partId === 'dip-switch-4') {
      errors.push(...validateDipSwitchInput(spec, component, partsById, componentsById));
    } else if (component.partId === 'membrane-keypad-1x4') {
      errors.push(...validateMembraneKeypadInput(spec, component, part, partsById, componentsById));
    }
  }

  return unique(errors);
}

function validateRowColumnMatrixInput(
  spec: CircuitSpec,
  component: CircuitSpec['components'][number],
  part: PartCapability
) {
  const errors: string[] = [];
  const controllerPins: string[] = [];
  const rowPins = part.pins.filter((pin) => pin.role === 'matrix-row').map((pin) => pin.name);
  const columnPins = part.pins.filter((pin) => pin.role === 'matrix-column').map((pin) => pin.name);

  for (const rowPin of rowPins) {
    const connection = findConnectionToControllerRole(spec, component.id, rowPin, 'digital-output');
    const controllerPin = connection ? controllerPinFromConnection(spec, connection, component.id) : null;
    if (!connection || !controllerPin) {
      errors.push(`MATRIX_INPUT_ROW_MISSING: ${component.label} ${rowPin} must connect to a distinct Arduino digital scan output.`);
      continue;
    }
    if (!validMatrixInputSignalType(connection.signal)) {
      errors.push(`MATRIX_INPUT_SIGNAL_TYPE_INVALID: ${component.label} ${rowPin} scan line must use a digital or gpio signal type.`);
    }
    controllerPins.push(controllerPin);
  }

  for (const columnPin of columnPins) {
    const connection = findConnectionToControllerRole(spec, component.id, columnPin, 'digital-input');
    const controllerPin = connection ? controllerPinFromConnection(spec, connection, component.id) : null;
    if (!connection || !controllerPin) {
      errors.push(`MATRIX_INPUT_COLUMN_MISSING: ${component.label} ${columnPin} must connect to a distinct Arduino digital sense input.`);
      continue;
    }
    if (!validMatrixInputSignalType(connection.signal)) {
      errors.push(`MATRIX_INPUT_SIGNAL_TYPE_INVALID: ${component.label} ${columnPin} sense line must use a digital or gpio signal type.`);
    }
    controllerPins.push(controllerPin);
  }

  errors.push(...duplicateControllerPinErrors(
    controllerPins,
    `MATRIX_INPUT_LINES_NOT_DISTINCT: ${component.label} row and column lines must use distinct Arduino pins.`
  ));
  return errors;
}

function validateDipSwitchInput(
  spec: CircuitSpec,
  component: CircuitSpec['components'][number],
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const controllerPins: string[] = [];
  for (const index of [1, 2, 3, 4]) {
    const pair = [`S${index}A`, `S${index}B`];
    const signalPins = pair.filter((pin) => findConnectionToControllerRole(spec, component.id, pin, 'digital-input'));
    const referencePins = pair.filter((pin) =>
      endpointReachesControllerRole(spec, `${component.id}:${pin}`, 'ground', partsById, componentsById)
    );

    if (signalPins.length !== 1) {
      errors.push(`MATRIX_INPUT_SWITCH_SIGNAL_MISSING: ${component.label} switch ${index} needs exactly one terminal connected to an Arduino digital input.`);
      continue;
    }
    if (referencePins.length !== 1) {
      errors.push(`MATRIX_INPUT_REFERENCE_MISSING: ${component.label} switch ${index} needs the paired terminal tied to Arduino GND.`);
      continue;
    }

    const connection = findConnectionToControllerRole(spec, component.id, signalPins[0], 'digital-input');
    const controllerPin = connection ? controllerPinFromConnection(spec, connection, component.id) : null;
    if (connection && !validMatrixInputSignalType(connection.signal)) {
      errors.push(`MATRIX_INPUT_SIGNAL_TYPE_INVALID: ${component.label} switch ${index} input must use a digital or gpio signal type.`);
    }
    if (controllerPin) {
      controllerPins.push(controllerPin);
    }
  }

  errors.push(...duplicateControllerPinErrors(
    controllerPins,
    `MATRIX_INPUT_LINES_NOT_DISTINCT: ${component.label} switch inputs must use distinct Arduino pins.`
  ));
  return errors;
}

function validateMembraneKeypadInput(
  spec: CircuitSpec,
  component: CircuitSpec['components'][number],
  part: PartCapability,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const controllerPins: string[] = [];
  if (!endpointReachesControllerRole(spec, `${component.id}:COM`, 'ground', partsById, componentsById)) {
    errors.push(`MATRIX_INPUT_REFERENCE_MISSING: ${component.label} COM must connect to Arduino GND as the shared key reference.`);
  }

  for (const pin of part.pins.filter((candidate) => candidate.role === 'switch-terminal').map((candidate) => candidate.name)) {
    const connection = findConnectionToControllerRole(spec, component.id, pin, 'digital-input');
    const controllerPin = connection ? controllerPinFromConnection(spec, connection, component.id) : null;
    if (!connection || !controllerPin) {
      errors.push(`MATRIX_INPUT_KEY_SIGNAL_MISSING: ${component.label} ${pin} must connect to a distinct Arduino digital input.`);
      continue;
    }
    if (!validMatrixInputSignalType(connection.signal)) {
      errors.push(`MATRIX_INPUT_SIGNAL_TYPE_INVALID: ${component.label} ${pin} must use a digital or gpio signal type.`);
    }
    controllerPins.push(controllerPin);
  }

  errors.push(...duplicateControllerPinErrors(
    controllerPins,
    `MATRIX_INPUT_LINES_NOT_DISTINCT: ${component.label} key inputs must use distinct Arduino pins.`
  ));
  return errors;
}

function validateJoystickDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  for (const component of spec.components.filter((candidate) => JOYSTICK_PART_IDS.has(candidate.partId))) {
    if (!hasDisplay) {
      errors.push(`JOYSTICK_DISPLAY_MISSING: ${component.label} position readout needs an I2C text display in this supported topology.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:VCC`, 'power', partsById, componentsById)) {
      errors.push(`JOYSTICK_POWER_MISSING: ${component.label} needs VCC connected to Arduino 5V.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:GND`, 'ground', partsById, componentsById)) {
      errors.push(`JOYSTICK_GROUND_MISSING: ${component.label} needs GND connected to Arduino GND.`);
    }

    const vrx = findConnectionToControllerRole(spec, component.id, 'VRX', 'analog-input');
    const vry = findConnectionToControllerRole(spec, component.id, 'VRY', 'analog-input');
    const sw = findConnectionToControllerRole(spec, component.id, 'SW', 'digital-input');
    const axisPins = [vrx, vry]
      .map((connection) => connection ? controllerPinFromConnection(spec, connection, component.id) : null)
      .filter((pin): pin is string => Boolean(pin));

    if (!vrx) {
      errors.push(`JOYSTICK_AXIS_MISSING: ${component.label} VRX must connect to an Arduino analog input such as A0.`);
    } else if (vrx.signal !== 'analog') {
      errors.push(`JOYSTICK_AXIS_SIGNAL_TYPE_INVALID: ${component.label} VRX must use the analog signal type.`);
    }
    if (!vry) {
      errors.push(`JOYSTICK_AXIS_MISSING: ${component.label} VRY must connect to a second Arduino analog input such as A1.`);
    } else if (vry.signal !== 'analog') {
      errors.push(`JOYSTICK_AXIS_SIGNAL_TYPE_INVALID: ${component.label} VRY must use the analog signal type.`);
    }
    if (axisPins.length === 2 && axisPins[0] === axisPins[1]) {
      errors.push(`JOYSTICK_AXIS_PINS_NOT_DISTINCT: ${component.label} VRX and VRY must use two distinct Arduino analog input pins.`);
    }
    if (!sw) {
      errors.push(`JOYSTICK_SWITCH_MISSING: ${component.label} SW must connect to an Arduino digital input.`);
    } else if (!validMatrixInputSignalType(sw.signal)) {
      errors.push(`JOYSTICK_SWITCH_SIGNAL_TYPE_INVALID: ${component.label} SW must use a digital or gpio signal type.`);
    }
  }
  return unique(errors);
}

function validateRotaryEncoderDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  for (const component of spec.components.filter((candidate) => ROTARY_ENCODER_PART_IDS.has(candidate.partId))) {
    if (!hasDisplay) {
      errors.push(`ROTARY_ENCODER_DISPLAY_MISSING: ${component.label} count readout needs an I2C text display in this supported topology.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:VCC`, 'power', partsById, componentsById)) {
      errors.push(`ROTARY_ENCODER_POWER_MISSING: ${component.label} needs VCC connected to Arduino 5V.`);
    }
    if (!endpointReachesControllerRole(spec, `${component.id}:GND`, 'ground', partsById, componentsById)) {
      errors.push(`ROTARY_ENCODER_GROUND_MISSING: ${component.label} needs GND connected to Arduino GND.`);
    }

    const controllerPins: string[] = [];
    for (const pin of ['CLK', 'DT', 'SW']) {
      const connection = findConnectionToControllerRole(spec, component.id, pin, 'digital-input');
      const controllerPin = connection ? controllerPinFromConnection(spec, connection, component.id) : null;
      if (!connection || !controllerPin) {
        errors.push(`ROTARY_ENCODER_SIGNAL_MISSING: ${component.label} ${pin} must connect to a distinct Arduino digital input.`);
        continue;
      }
      if (!validMatrixInputSignalType(connection.signal)) {
        errors.push(`ROTARY_ENCODER_SIGNAL_TYPE_INVALID: ${component.label} ${pin} must use a digital or gpio signal type.`);
      }
      controllerPins.push(controllerPin);
    }

    errors.push(...duplicateControllerPinErrors(
      controllerPins,
      `ROTARY_ENCODER_PINS_NOT_DISTINCT: ${component.label} CLK, DT, and SW must use distinct Arduino digital input pins.`
    ));
  }
  return unique(errors);
}

function validMatrixInputSignalType(signal: string) {
  return ['digital', 'gpio', 'button'].includes(signal.toLowerCase());
}

function validI2cSignalType(signal: string, role: 'data' | 'clock') {
  const normalized = signal.toLowerCase();
  return normalized === 'i2c'
    || (role === 'data' && ['i2c-data', 'data'].includes(normalized))
    || (role === 'clock' && ['i2c-clock', 'clock'].includes(normalized));
}

function validClockedDataSignalType(signal: string) {
  return ['clocked-data', 'digital-data', 'digital-clock', 'digital', 'gpio', 'data', 'clock'].includes(signal.toLowerCase());
}

function validSpiSignalType(signal: string, controllerRole: string) {
  const normalized = signal.toLowerCase();
  if (normalized === 'spi') {
    return true;
  }
  if (controllerRole === 'spi-clock') {
    return ['spi-clock', 'clock'].includes(normalized);
  }
  if (controllerRole === 'spi-select') {
    return ['spi-select', 'chip-select', 'select', 'digital', 'gpio'].includes(normalized);
  }
  return ['spi-data', 'data'].includes(normalized);
}

function validUartSignalType(signal: string) {
  return ['uart', 'serial', 'nmea', 'serial-data'].includes(signal.toLowerCase());
}

function validateProtocolPinConnection(
  spec: CircuitSpec,
  component: CircuitSpec['components'][number],
  targetPin: string,
  controllerRole: string,
  expectedControllerPin: string,
  errorCode: string,
  label: string
) {
  const connection = findConnectionToControllerRole(spec, component.id, targetPin, controllerRole);
  const controllerPin = connection ? controllerPinFromConnection(spec, connection, component.id) : null;
  if (!connection || controllerPin !== expectedControllerPin) {
    return [`${errorCode}: ${component.label} ${targetPin} must connect to Arduino ${expectedControllerPin} for ${label}.`];
  }
  if (!validSpiSignalType(connection.signal, controllerRole)) {
    return [`SPI_PROTOCOL_SENSOR_SIGNAL_INVALID: ${component.label} ${targetPin} must use an SPI signal type for ${label}.`];
  }
  return [];
}

function protocolSensorSafetyText(spec: CircuitSpec) {
  const negatedAssumptionPattern = /\b(not|no|never|unsupported|blocked|forbidden|avoid|do\s+not|don't|educational\s+only|classroom\s+only|not\s+for)\b|아님|미지원|차단|금지|교육용/i;
  return [
    spec.title,
    spec.intent.primaryGoal,
    spec.intent.output ?? '',
    spec.intent.input ?? '',
    spec.intent.behavior ?? '',
    spec.behavior.runText,
    ...spec.assumptions.filter((assumption) => !negatedAssumptionPattern.test(assumption))
  ].join(' ');
}

function controllerPinFromConnection(
  spec: CircuitSpec,
  connection: CircuitSpec['connections'][number],
  targetId: string
) {
  const endpoint = [connection.from, connection.to].find((candidate) => {
    if (candidate.componentId === targetId) {
      return false;
    }
    const component = spec.components.find((specComponent) => specComponent.id === candidate.componentId);
    return component?.partId === 'arduino-uno';
  });
  return endpoint?.pin ?? null;
}

function duplicateControllerPinErrors(controllerPins: string[], message: string) {
  return controllerPins.length === new Set(controllerPins).size ? [] : [message];
}

function firstPinNameForRole(part: PartCapability, predicate: (role: string) => boolean) {
  return part.pins.find((pin) => predicate(pin.role))?.name ?? null;
}

function bareSevenSegmentPins(part: PartCapability) {
  return part.pins
    .filter((pin) => pin.role === 'segment-anode' || pin.role === 'segment' || pin.name === 'DP')
    .map((pin) => pin.name);
}

function rgbLedChannelPins(part: PartCapability) {
  return part.pins
    .filter((pin) => pin.role === 'channel-anode' || ['R', 'G', 'B'].includes(pin.name))
    .map((pin) => pin.name);
}

function rgbChannelColor(pin: string) {
  const colors: Record<string, string> = {
    R: '#ff4d3d',
    G: '#22c55e',
    B: '#3b82f6'
  };
  return colors[pin] ?? '#ff4d3d';
}

function endpointReachesControllerRole(
  spec: CircuitSpec,
  startKey: string,
  controllerRole: string,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  return endpointReachesAnyControllerRole(spec, startKey, [controllerRole], partsById, componentsById);
}

function endpointReachesAnyControllerRole(
  spec: CircuitSpec,
  startKey: string,
  controllerRoles: string[],
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const graph = buildEndpointGraph(spec);
  return endpointReachesAnyControllerRoleInGraph(graph, startKey, controllerRoles, partsById, componentsById);
}

function endpointReachesControllerPin(
  spec: CircuitSpec,
  startKey: string,
  controllerPins: string[],
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const graph = buildEndpointGraph(spec);
  const expectedPins = new Set(controllerPins);
  for (const key of reachableEndpointKeys(graph, [startKey])) {
    const endpoint = endpointFromKey(key);
    const component = componentsById.get(endpoint.componentId);
    if (component?.partId !== 'arduino-uno') {
      continue;
    }
    if (expectedPins.has(endpoint.pin) && partsById.has(component.partId)) {
      return true;
    }
  }
  return false;
}

function endpointReachesAnyControllerRoleInGraph(
  graph: Map<string, Set<string>>,
  startKey: string,
  controllerRoles: string[],
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const reachable = reachableEndpointKeys(graph, [startKey]);
  for (const key of reachable) {
    const endpoint = endpointFromKey(key);
    const component = componentsById.get(endpoint.componentId);
    if (component?.partId !== 'arduino-uno') {
      continue;
    }
    if (controllerRoles.includes(roleFor(endpoint, componentsById, partsById))) {
      return true;
    }
  }
  return false;
}

function endpointReachesRoleInGraph(
  graph: Map<string, Set<string>>,
  startKey: string,
  rolePredicate: (role: string) => boolean,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>,
  componentPredicate: (component: CircuitSpec['components'][number]) => boolean = () => true
) {
  return [...reachableEndpointKeys(graph, [startKey])].some((key) => {
    const endpoint = endpointFromKey(key);
    const component = componentsById.get(endpoint.componentId);
    return Boolean(component && componentPredicate(component) && rolePredicate(roleFor(endpoint, componentsById, partsById)));
  });
}

function reachablePartIdsByRoleInGraph(
  graph: Map<string, Set<string>>,
  startKey: string,
  rolePredicate: (role: string) => boolean,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  return unique([...reachableEndpointKeys(graph, [startKey])]
    .map((key) => {
      const endpoint = endpointFromKey(key);
      const component = componentsById.get(endpoint.componentId);
      if (!component || !rolePredicate(roleFor(endpoint, componentsById, partsById))) {
        return '';
      }
      return component.partId;
    }));
}

function controllerEndpointKeysWithRole(
  spec: CircuitSpec,
  controllerRoles: string[],
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  return unique(spec.connections
    .flatMap((connection) => [connection.from, connection.to])
    .filter((endpoint) => {
      const component = componentsById.get(endpoint.componentId);
      return component?.partId === 'arduino-uno'
        && controllerRoles.includes(roleFor(endpoint, componentsById, partsById));
    })
    .map(endpointKey));
}

function hasPathThroughReferenceResistorToGround(
  spec: CircuitSpec,
  graph: Map<string, Set<string>>,
  startKey: string,
  referenceIds: string[],
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const groundKeys = controllerEndpointKeysWithRole(spec, ['ground'], partsById, componentsById);
  return groundKeys.some((groundKey) =>
    componentIdsOnPathThroughAnyComponent(graph, [startKey], groundKey, referenceIds).length > 0
  );
}

function findConnectionFromReachableEndpointToControllerRole(
  spec: CircuitSpec,
  graph: Map<string, Set<string>>,
  startKey: string,
  controllerRole: string,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const reachable = reachableEndpointKeys(graph, [startKey]);
  return spec.connections.find((candidate) => {
    const endpoints = [candidate.from, candidate.to];
    return endpoints.some((endpoint) => reachable.has(endpointKey(endpoint)))
      && endpoints.some((endpoint) => {
        const component = componentsById.get(endpoint.componentId);
        return component?.partId === 'arduino-uno'
          && roleFor(endpoint, componentsById, partsById) === controllerRole;
      });
  }) ?? null;
}

function hasPwmLedOutputPath(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const graph = buildEndpointGraph(spec);
  const controllerIds = new Set(
    spec.components
      .filter((component) => component.partId === 'arduino-uno')
      .map((component) => component.id)
  );
  const pwmSources = spec.connections
    .flatMap((connection) => [connection.from, connection.to])
    .filter((endpoint) => controllerIds.has(endpoint.componentId))
    .filter((endpoint) => roleFor(endpoint, componentsById, partsById) === 'pwm-output')
    .map(endpointKey);
  const resistorIds = spec.components
    .filter((component) => component.partId === 'resistor-220')
    .map((component) => component.id);

  return spec.components
    .filter((component) => component.partId === 'led-5mm')
    .some((led) => componentIdsOnPathThroughAnyComponent(graph, pwmSources, `${led.id}:A`, resistorIds).length > 0);
}

function hasAnalogThresholdOutputPath(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  return spec.components
    .filter((component) => component.partId === 'led-5mm')
    .some((led) => {
      const path = findLedSeriesPath(spec, led.id, partsById, componentsById);
      return path.hasControllerSource
        && path.hasAnodeEntry
        && path.hasSeriesResistor
        && path.hasCathodeGroundReturn
        && !path.hasReversedPolarity;
    });
}

function hasThresholdLanguage(spec: CircuitSpec) {
  return /dark|light|threshold|above|below|어두|밝|임계|기준/i.test([
    spec.intent.primaryGoal,
    spec.intent.behavior ?? '',
    spec.behavior.runText,
    ...spec.assumptions
  ].join(' '));
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

function buildEndpointGraph(
  spec: CircuitSpec,
  options: { includeResistiveSensors?: boolean } = {}
) {
  const graph = new Map<string, Set<string>>();
  const includeResistiveSensors = options.includeResistiveSensors ?? true;

  for (const connection of spec.connections) {
    const fromKey = endpointKey(connection.from);
    const toKey = endpointKey(connection.to);
    addEdge(graph, fromKey, toKey);
    addEdge(graph, toKey, fromKey);
  }

  for (const component of spec.components) {
    const isInternalConductor = PASSIVE_INTERNAL_CONNECTION_PART_IDS.has(component.partId)
      || (includeResistiveSensors && RESISTIVE_SENSOR_PART_IDS.has(component.partId));
    if (!isInternalConductor) {
      continue;
    }
    const pins = RESISTIVE_SENSOR_PART_IDS.has(component.partId) ? ['A', 'B'] : ['1', '2'];
    addEdge(graph, `${component.id}:${pins[0]}`, `${component.id}:${pins[1]}`);
    addEdge(graph, `${component.id}:${pins[1]}`, `${component.id}:${pins[0]}`);
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
  const hasAnalogDimmerInput = spec.components.some((component) => ANALOG_DIMMER_INPUT_PART_IDS.has(component.partId));
  const hasAnalogSensorModule = spec.components.some((component) => ANALOG_SENSOR_MODULE_PART_IDS.has(component.partId));
  const hasResistiveSensor = spec.components.some((component) => RESISTIVE_SENSOR_PART_IDS.has(component.partId));
  const hasDistanceSensor = spec.components.some((component) => DISTANCE_SENSOR_PART_IDS.has(component.partId));
  const hasSingleWireSensor = spec.components.some((component) => SINGLE_WIRE_SENSOR_PART_IDS.has(component.partId));
  const hasI2cProtocolSensor = spec.components.some((component) => I2C_PROTOCOL_SENSOR_PART_IDS.has(component.partId));
  const hasClockedDataSensor = spec.components.some((component) => CLOCKED_DATA_SENSOR_PART_IDS.has(component.partId));
  const hasSpiProtocolSensor = spec.components.some((component) => SPI_PROTOCOL_SENSOR_PART_IDS.has(component.partId));
  const hasUartProtocolSensor = spec.components.some((component) => UART_PROTOCOL_SENSOR_PART_IDS.has(component.partId));
  const hasUartCommunicationModule = spec.components.some((component) => UART_COMMUNICATION_MODULE_PART_IDS.has(component.partId));
  const hasSpiCommunicationModule = spec.components.some((component) => SPI_COMMUNICATION_MODULE_PART_IDS.has(component.partId));
  const hasDifferentialCommunicationModule = spec.components.some((component) => DIFFERENTIAL_COMMUNICATION_MODULE_PART_IDS.has(component.partId));
  const hasShiftRegisterInterface = spec.components.some((component) => SHIFT_REGISTER_INTERFACE_PART_IDS.has(component.partId));
  const hasI2cLogicInterface = spec.components.some((component) => I2C_LOGIC_INTERFACE_PART_IDS.has(component.partId));
  const hasSpiLogicInterface = spec.components.some((component) => SPI_LOGIC_INTERFACE_PART_IDS.has(component.partId));
  const hasAnalogTimingInterface = spec.components.some((component) => ANALOG_TIMING_INTERFACE_PART_IDS.has(component.partId));
  const hasLevelShifterInterface = spec.components.some((component) => LEVEL_SHIFTER_INTERFACE_PART_IDS.has(component.partId));
  const hasDigitalInputState = spec.components.some((component) => DIGITAL_INPUT_STATE_PART_IDS.has(component.partId));
  const hasPulseDigitalSensor = spec.components.some((component) => PULSE_DIGITAL_SENSOR_PART_IDS.has(component.partId));
  const hasMatrixInput = spec.components.some((component) => MATRIX_INPUT_PART_IDS.has(component.partId));
  const hasJoystick = spec.components.some((component) => JOYSTICK_PART_IDS.has(component.partId));
  const hasRotaryEncoder = spec.components.some((component) => ROTARY_ENCODER_PART_IDS.has(component.partId));
  const hasBareSevenSegmentDisplay = spec.components.some((component) => BARE_SEVEN_SEGMENT_DISPLAY_PART_IDS.has(component.partId));
  const hasLedArrayDisplay = spec.components.some((component) => LED_ARRAY_DISPLAY_PART_IDS.has(component.partId));
  const hasAddressableLedDisplay = spec.components.some((component) => ADDRESSABLE_LED_DISPLAY_PART_IDS.has(component.partId));
  const hasSpiDisplay = spec.components.some((component) => SPI_DISPLAY_PART_IDS.has(component.partId));
  const hasDirectLowCurrentLoad = spec.components.some((component) => DIRECT_LOW_CURRENT_LOAD_PART_IDS.has(component.partId));
  const hasRgbLed = spec.components.some((component) => RGB_LED_PART_IDS.has(component.partId));
  const hasPoweredLightModule = spec.components.some((component) => POWERED_LIGHT_MODULE_PART_IDS.has(component.partId));
  const hasHighTorqueServo = spec.components.some((component) => HIGH_TORQUE_SERVO_PART_IDS.has(component.partId));
  const hasServoActuator = spec.components.some((component) => SERVO_ACTUATOR_PART_IDS.has(component.partId));
  const hasLowSideLoad = spec.components.some((component) => LOW_SIDE_LOAD_PART_IDS.has(component.partId));
  const hasDiscreteLowSideDriver = spec.components.some((component) => LOW_SIDE_DISCRETE_DRIVER_PART_IDS.has(component.partId));
  const hasMosfetLowSideDriver = spec.components.some((component) => LOW_SIDE_MOSFET_MODULE_PART_IDS.has(component.partId));
  const hasIntegratedLowSideLoad = spec.components.some((component) => LOW_SIDE_INTEGRATED_LOAD_PART_IDS.has(component.partId));
  const hasUnipolarStepper = spec.components.some((component) => UNIPOLAR_STEPPER_MOTOR_PART_IDS.has(component.partId));
  const hasBipolarStepper = spec.components.some((component) => BIPOLAR_STEPPER_MOTOR_PART_IDS.has(component.partId));
  const hasUln2003StepperDriver = spec.components.some((component) => ULN2003_STEPPER_DRIVER_PART_IDS.has(component.partId));
  const hasStepDirStepperDriver = spec.components.some((component) => STEP_DIR_STEPPER_DRIVER_PART_IDS.has(component.partId));
  const hasHBridgeDriver = spec.components.some((component) => HBRIDGE_DRIVER_PART_IDS.has(component.partId));
  const hasHBridgeMotorLoad = spec.components.some((component) => HBRIDGE_MOTOR_LOAD_PART_IDS.has(component.partId));
  const hasRelayModule = spec.components.some((component) => RELAY_MODULE_PART_IDS.has(component.partId));
  const hasLowVoltagePowerSource = spec.components.some((component) => LOW_VOLTAGE_POWER_SOURCE_PART_IDS.has(component.partId));
  const hasVoltageRegulator = spec.components.some((component) => VOLTAGE_REGULATOR_PART_IDS.has(component.partId));
  const hasPassiveProtectionContext = spec.components.some((component) => PASSIVE_PROTECTION_CONTEXT_PART_IDS.has(component.partId));
  const hasTimingPassiveContext = spec.components.some((component) => TIMING_PASSIVE_CONTEXT_PART_IDS.has(component.partId));
  const hasPrototypingSurfaceContext = spec.components.some((component) => PROTOTYPING_SURFACE_CONTEXT_PART_IDS.has(component.partId));
  const hasConnectorWiringContext = spec.components.some((component) => CONNECTOR_WIRING_CONTEXT_PART_IDS.has(component.partId));
  const hasControllerBoardContext = spec.components.some((component) => CONTROLLER_BOARD_CONTEXT_PART_IDS.has(component.partId));
  const templates = await loadTopologyTemplates();
  const templateById = new Map(templates.map((template) => [template.id, template]));

  if (hasControllerBoardContext && hasOnlyStateOnlyContextParts(spec)) {
    return templateById.get('controller-board-pin-map-substitution')
      ?? templateById.get('controller-voltage-domain-policy')
      ?? null;
  }

  if (hasDistanceSensor && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-distance-sensor-i2c-display') ?? null;
  }

  if (hasAnalogDimmerInput && partIds.has('led-5mm') && partIds.has('resistor-220')) {
    return templateById.get('controller-analog-input-pwm-output') ?? null;
  }

  if (hasSingleWireSensor && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-single-wire-sensor-i2c-display') ?? null;
  }

  if (hasI2cProtocolSensor && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-i2c-sensor-display') ?? null;
  }

  if (hasClockedDataSensor && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-clocked-data-sensor-i2c-display') ?? null;
  }

  if (hasSpiProtocolSensor && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-spi-sensor-display') ?? null;
  }

  if (hasUartProtocolSensor && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-uart-sensor-display') ?? null;
  }

  if (hasUartCommunicationModule && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-uart-communication-module') ?? null;
  }

  if (hasSpiCommunicationModule && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-spi-communication-module') ?? null;
  }

  if (hasDifferentialCommunicationModule && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-differential-bus-module') ?? null;
  }

  if (hasLevelShifterInterface) {
    return templateById.get('level-shifted-i2c-bus') ?? null;
  }

  if (hasShiftRegisterInterface && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-logic-interface-context') ?? null;
  }

  if (hasI2cLogicInterface && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-i2c-interface-context') ?? null;
  }

  if (hasSpiLogicInterface && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-spi-interface-context') ?? null;
  }

  if (hasAnalogTimingInterface && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-analog-timing-interface-context') ?? null;
  }

  if (hasMatrixInput && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-matrix-input-display') ?? null;
  }

  if (hasJoystick && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-dual-analog-input-display') ?? null;
  }

  if (hasRotaryEncoder && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-quadrature-input-display') ?? null;
  }

  if (hasPulseDigitalSensor && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-pulse-digital-sensor-display') ?? null;
  }

  if (hasDigitalInputState && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-digital-input-display') ?? null;
  }

  if (hasDigitalInputState && partIds.has('led-5mm') && partIds.has('resistor-220')) {
    return templateById.get('controller-digital-input-output')
      ?? templateById.get('controller-digital-input-switch-plus-output')
      ?? null;
  }

  if (hasResistiveSensor && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-resistive-sensor-divider-i2c-display') ?? null;
  }

  if (
    hasResistiveSensor
    && hasThresholdLanguage(spec)
    && partIds.has('led-5mm')
    && partIds.has('resistor-220')
  ) {
    return templateById.get('controller-resistive-sensor-divider-threshold-output')
      ?? templateById.get('controller-analog-sensor-threshold-output')
      ?? null;
  }

  if (hasAnalogSensorModule && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-analog-sensor-i2c-display') ?? null;
  }

  if (
    hasAnalogSensorModule
    && hasThresholdLanguage(spec)
    && partIds.has('led-5mm')
    && partIds.has('resistor-220')
  ) {
    return templateById.get('controller-analog-sensor-threshold-output')
      ?? templateById.get('controller-analog-threshold-output')
      ?? null;
  }

  if (hasI2cTextDisplay(spec)) {
    return templateById.get('controller-i2c-character-display')
      ?? templateById.get('controller-i2c-module')
      ?? null;
  }

  if (hasAddressableLedDisplay) {
    return templateById.get('controller-addressable-led-display') ?? null;
  }

  if (hasBareSevenSegmentDisplay) {
    return templateById.get('controller-bare-seven-segment-display') ?? null;
  }

  if (hasLedArrayDisplay) {
    return templateById.get('controller-led-array-display') ?? null;
  }

  if (hasSpiDisplay) {
    return templateById.get('controller-spi-display') ?? null;
  }

  if (hasRgbLed) {
    return templateById.get('controller-rgb-led-current-limited-output') ?? null;
  }

  if (hasPoweredLightModule) {
    return templateById.get('controller-powered-light-module-output') ?? null;
  }

  if (hasHighTorqueServo) {
    return templateById.get('controller-servo-external-power-warning')
      ?? templateById.get('controller-pwm-actuator')
      ?? null;
  }

  if (hasServoActuator) {
    return templateById.get('controller-pwm-actuator') ?? null;
  }

  if (hasUnipolarStepper && hasUln2003StepperDriver) {
    return templateById.get('controller-uln2003-unipolar-stepper') ?? null;
  }

  if (hasBipolarStepper && hasStepDirStepperDriver) {
    return templateById.get('controller-step-dir-bipolar-stepper') ?? null;
  }

  if (hasHBridgeDriver && hasHBridgeMotorLoad) {
    return templateById.get('controller-hbridge-dc-motor') ?? null;
  }

  if (hasRelayModule) {
    return templateById.get('controller-relay-low-voltage-load') ?? null;
  }

  if (hasVoltageRegulator) {
    return templateById.get('regulated-5v-rail') ?? null;
  }

  if (hasLowVoltagePowerSource) {
    return templateById.get('external-low-voltage-power-rail') ?? null;
  }

  if (hasTimingPassiveContext) {
    return templateById.get('timing-passive-context-only') ?? null;
  }

  if (hasPassiveProtectionContext) {
    return templateById.get('protection-passive-in-series-or-parallel') ?? null;
  }

  if (hasConnectorWiringContext) {
    return templateById.get('connector-wiring-context-only') ?? null;
  }

  if (hasPrototypingSurfaceContext) {
    return templateById.get('prototyping-surface-context-only') ?? null;
  }

  if (hasLowSideLoad && hasDiscreteLowSideDriver) {
    return templateById.get('controller-transistor-low-side-load') ?? null;
  }

  if (hasLowSideLoad && (hasMosfetLowSideDriver || hasIntegratedLowSideLoad)) {
    return templateById.get('controller-mosfet-module-load') ?? null;
  }

  if (hasDirectLowCurrentLoad && !partIds.has('led-5mm') && !partIds.has('button-tactile') && !hasDigitalInputState) {
    return templateById.get('controller-direct-low-current-load') ?? null;
  }

  const capabilities = (await loadCapabilityGraph()).filter((capability) =>
    capability.supportLevel !== 'unsupported'
    && (!capability.id.startsWith('analog-sensor-') || hasAnalogSensorModule || hasResistiveSensor)
    && (!capability.id.startsWith('digital-input-') || hasDigitalInputState)
    && (!capability.id.startsWith('matrix-input-') || hasMatrixInput)
    && (!capability.id.startsWith('joystick-') || hasJoystick)
    && (!capability.id.startsWith('rotary-encoder-') || hasRotaryEncoder)
    && capability.requiredRoles.length > 0
    && capability.requiredParts.length > 0
    && capability.requiredParts.every((partId) => partIds.has(partId))
  );
  return selectTopologyTemplate({ capabilities });
}

function componentIdForPart(spec: CircuitSpec, partId: string) {
  return spec.components.find((component) => component.partId === partId)?.id ?? partId;
}

function hasOnlyStateOnlyContextParts(spec: CircuitSpec) {
  return spec.components.every((component) =>
    CONTROLLER_BOARD_CONTEXT_PART_IDS.has(component.partId)
    || WP09_CONTEXT_PART_IDS.has(component.partId)
    || component.partId === 'jumper-wire'
  );
}

function findI2cTextDisplayComponent(spec: CircuitSpec) {
  return spec.components.find((component) => I2C_TEXT_DISPLAY_PART_IDS.has(component.partId)) ?? null;
}

function hasI2cTextDisplay(spec: CircuitSpec) {
  return Boolean(findI2cTextDisplayComponent(spec));
}

function componentIdForI2cTextDisplay(spec: CircuitSpec) {
  return findI2cTextDisplayComponent(spec)?.id ?? 'oled-display';
}

function findLedArrayDisplayComponents(spec: CircuitSpec) {
  return spec.components.filter((component) => LED_ARRAY_DISPLAY_PART_IDS.has(component.partId));
}

function findBareSevenSegmentDisplayComponents(spec: CircuitSpec) {
  return spec.components.filter((component) => BARE_SEVEN_SEGMENT_DISPLAY_PART_IDS.has(component.partId));
}

function findAddressableLedDisplayComponents(spec: CircuitSpec) {
  return spec.components.filter((component) => ADDRESSABLE_LED_DISPLAY_PART_IDS.has(component.partId));
}

function findSpiDisplayComponents(spec: CircuitSpec) {
  return spec.components.filter((component) => SPI_DISPLAY_PART_IDS.has(component.partId));
}

function findRgbLedComponents(spec: CircuitSpec) {
  return spec.components.filter((component) => RGB_LED_PART_IDS.has(component.partId));
}

function findPoweredLightModuleComponents(spec: CircuitSpec) {
  return spec.components.filter((component) => POWERED_LIGHT_MODULE_PART_IDS.has(component.partId));
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
  const componentsById = new Map(spec.components.map((component) => [component.id, component]));
  const relayControlledLedIds = new Set(resolveRelayModulePaths(spec, partsById, componentsById)
    .map((path) => path.loadId));

  for (const component of spec.components) {
    if (component.partId === 'led-5mm' && relayControlledLedIds.has(component.id)) {
      continue;
    }
    const part = partsById.get(component.partId);
    if (!part || !isSimulationContextPart(part)) {
      continue;
    }
    const primitiveId = [
      ...preferredSimulationPrimitiveIdsForSpec(spec, part),
      ...part.compatibleSimulationPrimitives
    ].find((id) => id !== 'current_flow_animation' && primitivesById.has(id));
    const primitive = primitiveId ? primitivesById.get(primitiveId) : undefined;
    if (primitive) {
      contexts.push({ component, part, primitive });
    }
  }

  return contexts;
}

function preferredSimulationPrimitiveIdsForSpec(spec: CircuitSpec, part: PartCapability) {
  if (part.capabilities.includes('controller-board-substitution')) {
    return ['controller_board_context_state'];
  }

  if (part.capabilities.includes('matrix-input-source')) {
    return ['matrix_input_state'];
  }

  if (part.capabilities.includes('joystick-input-source')) {
    return ['joystick_position_state'];
  }

  if (part.capabilities.includes('rotary-encoder-source')) {
    return ['rotary_encoder_state'];
  }

  if (part.capabilities.includes('addressable-led-display')) {
    return ['addressable_led_pattern'];
  }

  if (part.capabilities.includes('bare-seven-segment-display')) {
    return ['bare_seven_segment_display_state'];
  }

  if (part.capabilities.includes('led-array-display')) {
    return ['led_array_display_state'];
  }

  if (part.capabilities.includes('spi-display')) {
    return ['spi_display_state'];
  }

  if (part.capabilities.includes('multi-channel-light-output')) {
    return ['rgb_led_color_mix'];
  }

  if (part.capabilities.includes('powered-light-output')) {
    return ['powered_light_module_state'];
  }

  if (part.capabilities.includes('low-side-switched-load')) {
    return ['low_side_switched_load_state'];
  }

  if (part.capabilities.includes('hbridge-driver')) {
    return ['hbridge_motor_state'];
  }

  if (part.capabilities.includes('stepper-motor')) {
    return ['stepper_motor_state'];
  }

  if (part.capabilities.includes('relay-module')) {
    return ['relay_switch_state'];
  }

  if (part.capabilities.includes('voltage-regulator')) {
    return ['regulated_5v_rail_state'];
  }

  if (
    part.capabilities.includes('power-rail-source')
    || part.capabilities.includes('low-voltage-power-source')
    || part.capabilities.includes('low-voltage-power-connector')
  ) {
    return ['low_voltage_power_rail_state'];
  }

  if (part.capabilities.includes('timing-passive-context')) {
    return ['timing_passive_context_state'];
  }

  if (part.capabilities.includes('passive-protection-context') || part.capabilities.includes('passive-context-part')) {
    return ['passive_protection_context_state'];
  }

  if (part.capabilities.includes('connector-wiring')) {
    return ['connector_wiring_context_state'];
  }

  if (part.capabilities.includes('prototyping-surface')) {
    return ['prototyping_surface_context_state'];
  }

  if (part.capabilities.includes('digital-input-state-source')) {
    return ['digital_input_state'];
  }

  if (part.capabilities.includes('protocol-sensor') && hasI2cTextDisplay(spec)) {
    return ['display_sensor_value'];
  }

  if (part.capabilities.includes('communication-module') && hasI2cTextDisplay(spec)) {
    return ['display_sensor_value'];
  }

  if (part.capabilities.includes('logic-interface')) {
    return hasI2cTextDisplay(spec) && !part.capabilities.includes('level-shifter-interface')
      ? ['display_sensor_value']
      : ['display_static_text'];
  }

  if (part.capabilities.includes('analog-sensor') && hasI2cTextDisplay(spec)) {
    return ['display_sensor_value'];
  }

  if (part.capabilities.includes('analog-input') && hasThresholdLanguage(spec)) {
    return ['analog_threshold'];
  }

  if (ANALOG_DIMMER_INPUT_PART_IDS.has(part.id)) {
    return ['analog_pwm_dimmer'];
  }

  return [];
}

function compileCurrentPathsFromPrimitive(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  if (
    context.primitive.id === 'low_voltage_power_rail_state'
    || context.primitive.id === 'regulated_5v_rail_state'
    || context.primitive.id === 'passive_protection_context_state'
    || context.primitive.id === 'timing_passive_context_state'
    || context.primitive.id === 'prototyping_surface_context_state'
    || context.primitive.id === 'connector_wiring_context_state'
    || context.primitive.id === 'controller_board_context_state'
  ) {
    return [];
  }

  if (context.primitive.id === 'matrix_input_state' && context.part.capabilities.includes('matrix-input-source')) {
    return compileMatrixInputCurrentPaths(spec, context);
  }

  if (context.primitive.id === 'joystick_position_state' && context.part.capabilities.includes('joystick-input-source')) {
    return compileJoystickCurrentPaths(spec, context);
  }

  if (context.primitive.id === 'rotary_encoder_state' && context.part.capabilities.includes('rotary-encoder-source')) {
    return compileRotaryEncoderCurrentPaths(spec, context);
  }

  if (context.primitive.id === 'led_array_display_state' && context.part.capabilities.includes('led-array-display')) {
    return compileLedArrayDisplayCurrentPaths(spec, context);
  }

  if (context.primitive.id === 'addressable_led_pattern' && context.part.capabilities.includes('addressable-led-display')) {
    return compileAddressableLedDisplayCurrentPaths(spec, context);
  }

  if (context.primitive.id === 'bare_seven_segment_display_state' && context.part.capabilities.includes('bare-seven-segment-display')) {
    return compileBareSevenSegmentCurrentPaths(spec, context);
  }

  if (context.primitive.id === 'spi_display_state' && context.part.capabilities.includes('spi-display')) {
    return compileSpiDisplayCurrentPaths(spec, context);
  }

  if (context.primitive.id === 'rgb_led_color_mix' && context.part.capabilities.includes('multi-channel-light-output')) {
    return compileRgbLedCurrentPaths(spec, context);
  }

  if (context.primitive.id === 'powered_light_module_state' && context.part.capabilities.includes('powered-light-output')) {
    return compilePoweredLightModuleCurrentPaths(spec, context);
  }

  if (context.primitive.id === 'low_side_switched_load_state' && context.part.capabilities.includes('low-side-switched-load')) {
    return compileLowSideSwitchedLoadCurrentPaths(spec, context);
  }

  if (context.primitive.id === 'hbridge_motor_state' && context.part.capabilities.includes('hbridge-driver')) {
    return compileHBridgeMotorCurrentPaths(spec, context);
  }

  if (context.primitive.id === 'stepper_motor_state' && context.part.capabilities.includes('stepper-motor')) {
    return compileStepperMotorCurrentPaths(spec, context);
  }

  if (context.primitive.id === 'relay_switch_state' && context.part.capabilities.includes('relay-module')) {
    return compileRelayModuleCurrentPaths(spec, context);
  }

  if (context.primitive.id === 'digital_input_state' && context.part.capabilities.includes('digital-input-state-source')) {
    return compileDigitalInputStateCurrentPaths(spec, context);
  }

  if (context.primitive.id === 'display_sensor_value' && context.part.capabilities.includes('resistive-sensor')) {
    return compileResistiveSensorDisplayCurrentPaths(spec, context);
  }

  if (context.primitive.id === 'display_sensor_value' && context.part.capabilities.includes('analog-sensor')) {
    return compileAnalogSensorDisplayCurrentPaths(spec, context);
  }

  if (
    context.primitive.id === 'analog_threshold'
    && context.part.capabilities.includes('resistive-sensor')
  ) {
    return compileResistiveSensorThresholdCurrentPaths(spec, context);
  }

  if (
    (context.primitive.id === 'analog_pwm_dimmer' || context.primitive.id === 'analog_threshold')
    && context.part.capabilities.includes('analog-input')
  ) {
    return compileAnalogInputCurrentPaths(spec, context);
  }

  if (context.primitive.id === 'display_sensor_value' && context.part.capabilities.includes('distance-sensor')) {
    return compileDistanceSensorCurrentPaths(spec, context);
  }

  if (context.primitive.id === 'display_sensor_value' && context.part.capabilities.includes('temperature-humidity-sensor')) {
    return compileSingleWireSensorCurrentPaths(spec, context);
  }

  if (context.primitive.id === 'display_sensor_value' && context.part.capabilities.includes('protocol-sensor')) {
    return compileProtocolSensorCurrentPaths(spec, context);
  }

  if (context.primitive.id === 'display_sensor_value' && context.part.capabilities.includes('communication-module')) {
    return compileCommunicationModuleCurrentPaths(spec, context);
  }

  if (
    (context.primitive.id === 'display_sensor_value' || context.primitive.id === 'display_static_text')
    && context.part.capabilities.includes('logic-interface')
  ) {
    return compileLogicInterfaceCurrentPaths(spec, context);
  }

  const templates = currentPathTemplates(context.primitive);
  if (templates.length > 0) {
    return templates.map((template) => compileTemplatedCurrentPath(spec, context, template));
  }

  return [compileFallbackCurrentPath(spec, context)];
}

function isSimulationContextPart(part: PartCapability) {
  return part.kind === 'output'
    || part.capabilities.includes('matrix-input-source')
    || part.capabilities.includes('joystick-input-source')
    || part.capabilities.includes('rotary-encoder-source')
    || part.capabilities.includes('digital-input-state-source')
    || part.capabilities.includes('analog-input')
    || part.capabilities.includes('distance-sensor')
    || part.capabilities.includes('temperature-humidity-sensor')
    || part.capabilities.includes('protocol-sensor')
    || part.capabilities.includes('communication-module')
    || part.capabilities.includes('power-rail-source')
    || part.capabilities.includes('low-voltage-power-source')
    || part.capabilities.includes('low-voltage-power-connector')
    || part.capabilities.includes('voltage-regulator')
    || part.capabilities.includes('passive-context-part')
    || part.capabilities.includes('passive-protection-context')
    || part.capabilities.includes('timing-passive-context')
    || part.capabilities.includes('prototyping-surface')
    || part.capabilities.includes('connector-wiring')
    || part.capabilities.includes('logic-interface')
    || part.capabilities.includes('controller-board-substitution');
}

function compileDigitalInputStateCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const signalPin = digitalInputSignalPinForComponent(spec, context.component, context.part)
    ?? firstPinNameForRole(context.part, (role) => ['digital-output', 'pulse-output', 'switch-common', 'switch-terminal'].includes(role))
    ?? 'OUT';
  const controllerDigitalEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, signalPin, 'digital-input')
    ?? `${controllerId}:D2`;
  const displayId = findI2cTextDisplayComponent(spec)?.id;
  const displayBusEndpoint = displayId
    ? findConnectedControllerEndpointWithRole(spec, displayId, 'SDA', 'i2c-data') ?? `${controllerId}:A4/SDA`
    : null;
  const isPowered = POWERED_DIGITAL_SENSOR_PART_IDS.has(context.component.partId) || PULSE_DIGITAL_SENSOR_PART_IDS.has(context.component.partId);
  const isPulse = PULSE_DIGITAL_SENSOR_PART_IDS.has(context.component.partId);
  const signalPathId = isPulse ? `pulse-digital-input-signal:${targetId}` : `digital-input-signal:${targetId}`;
  const paths: CurrentPath[] = [];

  if (isPowered) {
    paths.push({
      id: `digital-input-supply-current:${targetId}`,
      kind: 'supply-current',
      primitiveId: context.primitive.id,
      label: `${context.part.label} module supply current`,
      from: `${controllerId}:5V`,
      through: [targetId],
      to: `${controllerId}:GND`,
      expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
      animation: { color: '#5ce1e6', speed: 0.48 }
    });
  }

  paths.push({
    id: signalPathId,
    kind: 'signal-activity',
    primitiveId: context.primitive.id,
    label: `${context.part.label} ${isPulse ? 'pulse' : 'digital'} input signal`,
    from: `${targetId}:${signalPin}`,
    through: [targetId],
    to: controllerDigitalEndpoint,
    expectedCurrentMa: 0,
    animation: { color: isPulse ? '#84a9ff' : '#9bd67d', speed: isPulse ? 0.62 : 0.58 }
  });

  if (displayId && displayBusEndpoint) {
    paths.push({
      id: `digital-input-display-bus-activity:${displayId}`,
      kind: 'bus-activity',
      primitiveId: context.primitive.id,
      label: 'OLED digital input state update',
      from: displayBusEndpoint,
      through: [displayId],
      to: `${displayId}:SDA`,
      expectedCurrentMa: 0,
      animation: { color: '#84a9ff', speed: 0.54 }
    });
  }

  return paths;
}

function compileMatrixInputCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const displayId = componentIdForI2cTextDisplay(spec);
  const displayBusEndpoint = findConnectedControllerEndpointWithRole(spec, displayId, 'SDA', 'i2c-data')
    ?? `${controllerId}:A4/SDA`;
  const paths: CurrentPath[] = [];

  if (MATRIX_KEYPAD_PART_IDS.has(context.component.partId)) {
    const rowPins = context.part.pins.filter((pin) => pin.role === 'matrix-row').map((pin) => pin.name);
    const columnPins = context.part.pins.filter((pin) => pin.role === 'matrix-column').map((pin) => pin.name);
    for (const rowPin of rowPins) {
      const controllerEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, rowPin, 'digital-output')
        ?? `${controllerId}:D${Number(rowPin.slice(1)) + 1}`;
      paths.push({
        id: `matrix-input-scan:${targetId}:${rowPin}`,
        kind: 'signal-activity',
        primitiveId: context.primitive.id,
        label: `${context.part.label} ${rowPin} scan line`,
        from: controllerEndpoint,
        through: [targetId],
        to: `${targetId}:${rowPin}`,
        expectedCurrentMa: 0,
        animation: { color: '#9bd67d', speed: 0.5 }
      });
    }
    for (const columnPin of columnPins) {
      const controllerEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, columnPin, 'digital-input')
        ?? `${controllerId}:D${Number(columnPin.slice(1)) + 5}`;
      paths.push({
        id: `matrix-input-sense:${targetId}:${columnPin}`,
        kind: 'signal-activity',
        primitiveId: context.primitive.id,
        label: `${context.part.label} ${columnPin} sense line`,
        from: `${targetId}:${columnPin}`,
        through: [targetId],
        to: controllerEndpoint,
        expectedCurrentMa: 0,
        animation: { color: '#84a9ff', speed: 0.52 }
      });
    }
  } else {
    const signalPins = matrixSwitchSignalPinsForContext(spec, context);
    for (const signalPin of signalPins) {
      const controllerEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, signalPin, 'digital-input')
        ?? `${controllerId}:D2`;
      paths.push({
        id: `matrix-input-signal:${targetId}:${signalPin}`,
        kind: 'signal-activity',
        primitiveId: context.primitive.id,
        label: `${context.part.label} ${signalPin} input state`,
        from: `${targetId}:${signalPin}`,
        through: [targetId],
        to: controllerEndpoint,
        expectedCurrentMa: 0,
        animation: { color: '#9bd67d', speed: 0.54 }
      });
    }
  }

  paths.push({
    id: `matrix-input-display-bus-activity:${displayId}`,
    kind: 'bus-activity',
    primitiveId: context.primitive.id,
    label: 'OLED matrix input state update',
    from: displayBusEndpoint,
    through: [displayId],
    to: `${displayId}:SDA`,
    expectedCurrentMa: 0,
    animation: { color: '#84a9ff', speed: 0.54 }
  });

  return paths;
}

function matrixSwitchSignalPinsForContext(spec: CircuitSpec, context: SimulationContext) {
  if (context.component.partId === 'dip-switch-4') {
    return [1, 2, 3, 4].flatMap((index) => {
      const pair = [`S${index}A`, `S${index}B`];
      return pair.find((pin) => findConnectionToControllerRole(spec, context.component.id, pin, 'digital-input')) ?? pair[0];
    });
  }
  return context.part.pins
    .filter((pin) => pin.role === 'switch-terminal')
    .map((pin) => pin.name);
}

function compileJoystickCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const displayId = componentIdForI2cTextDisplay(spec);
  const xEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, 'VRX', 'analog-input') ?? `${controllerId}:A0`;
  const yEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, 'VRY', 'analog-input') ?? `${controllerId}:A1`;
  const switchEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, 'SW', 'digital-input') ?? `${controllerId}:D2`;
  const displayBusEndpoint = findConnectedControllerEndpointWithRole(spec, displayId, 'SDA', 'i2c-data')
    ?? `${controllerId}:A4/SDA`;

  return [
    {
      id: `joystick-supply-current:${targetId}`,
      kind: 'supply-current',
      primitiveId: context.primitive.id,
      label: `${context.part.label} module supply current`,
      from: `${controllerId}:5V`,
      through: [targetId],
      to: `${controllerId}:GND`,
      expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
      animation: { color: '#5ce1e6', speed: 0.48 }
    },
    {
      id: `joystick-x-analog-signal:${targetId}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} X axis analog signal`,
      from: `${targetId}:VRX`,
      through: [targetId],
      to: xEndpoint,
      expectedCurrentMa: 0,
      animation: { color: '#2f7df6', speed: 0.36 }
    },
    {
      id: `joystick-y-analog-signal:${targetId}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} Y axis analog signal`,
      from: `${targetId}:VRY`,
      through: [targetId],
      to: yEndpoint,
      expectedCurrentMa: 0,
      animation: { color: '#7c3aed', speed: 0.36 }
    },
    {
      id: `joystick-switch-signal:${targetId}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} push switch signal`,
      from: `${targetId}:SW`,
      through: [targetId],
      to: switchEndpoint,
      expectedCurrentMa: 0,
      animation: { color: '#9bd67d', speed: 0.54 }
    },
    {
      id: `joystick-display-bus-activity:${displayId}`,
      kind: 'bus-activity',
      primitiveId: context.primitive.id,
      label: 'OLED joystick position update',
      from: displayBusEndpoint,
      through: [displayId],
      to: `${displayId}:SDA`,
      expectedCurrentMa: 0,
      animation: { color: '#84a9ff', speed: 0.54 }
    }
  ];
}

function compileRotaryEncoderCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const displayId = componentIdForI2cTextDisplay(spec);
  const displayBusEndpoint = findConnectedControllerEndpointWithRole(spec, displayId, 'SDA', 'i2c-data')
    ?? `${controllerId}:A4/SDA`;
  const signalPaths = [
    { pin: 'CLK', id: 'rotary-encoder-clk-signal', label: 'CLK quadrature signal', color: '#9bd67d' },
    { pin: 'DT', id: 'rotary-encoder-dt-signal', label: 'DT quadrature signal', color: '#84a9ff' },
    { pin: 'SW', id: 'rotary-encoder-switch-signal', label: 'push switch signal', color: '#7c3aed' }
  ].map(({ pin, id, label, color }) => {
    const controllerEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, pin, 'digital-input') ?? `${controllerId}:D2`;
    return {
      id: `${id}:${targetId}`,
      kind: 'signal-activity' as const,
      primitiveId: context.primitive.id,
      label: `${context.part.label} ${label}`,
      from: `${targetId}:${pin}`,
      through: [targetId],
      to: controllerEndpoint,
      expectedCurrentMa: 0,
      animation: { color, speed: 0.56 }
    };
  });

  return [
    {
      id: `rotary-encoder-supply-current:${targetId}`,
      kind: 'supply-current',
      primitiveId: context.primitive.id,
      label: `${context.part.label} module supply current`,
      from: `${controllerId}:5V`,
      through: [targetId],
      to: `${controllerId}:GND`,
      expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
      animation: { color: '#5ce1e6', speed: 0.48 }
    },
    ...signalPaths,
    {
      id: `rotary-encoder-display-bus-activity:${displayId}`,
      kind: 'bus-activity',
      primitiveId: context.primitive.id,
      label: 'OLED rotary encoder state update',
      from: displayBusEndpoint,
      through: [displayId],
      to: `${displayId}:SDA`,
      expectedCurrentMa: 0,
      animation: { color: '#84a9ff', speed: 0.54 }
    }
  ];
}

function compileBareSevenSegmentCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const componentsById = new Map(spec.components.map((component) => [component.id, component]));
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const graph = buildEndpointGraph(spec);
  const resistorIds = spec.components
    .filter((component) => component.partId === 'resistor-220')
    .map((component) => component.id);
  const controllerOutputs = spec.connections
    .flatMap((connection) => [connection.from, connection.to])
    .filter((endpoint) => {
      const component = componentsById.get(endpoint.componentId);
      return component?.partId === 'arduino-uno' && controllerPinMatchesRole(endpoint.pin, 'digital-output');
    })
    .map(endpointKey);

  return bareSevenSegmentPins(context.part).flatMap((pin) => {
    const segmentKey = `${targetId}:${pin}`;
    const seriesResistorIds = componentIdsOnPathThroughAnyComponent(graph, controllerOutputs, segmentKey, resistorIds);
    if (seriesResistorIds.length === 0) {
      return [];
    }
    const controllerEndpoint = findSegmentControllerEndpointThroughResistor(spec, graph, segmentKey, seriesResistorIds)
      ?? `${controllerId}:D4`;

    return [{
      id: `bare-seven-segment-current:${targetId}:${pin}`,
      kind: 'load-current' as const,
      primitiveId: context.primitive.id,
      label: `${context.part.label} segment ${pin} current`,
      from: controllerEndpoint,
      through: [...seriesResistorIds, targetId],
      to: `${controllerId}:GND`,
      expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
      animation: { color: '#ff4d3d', speed: 0.58 }
    }];
  });
}

function findSegmentControllerEndpointThroughResistor(
  spec: CircuitSpec,
  graph: Map<string, Set<string>>,
  segmentKey: string,
  resistorIds: string[]
) {
  for (const resistorId of resistorIds) {
    const resistorPins = [`${resistorId}:1`, `${resistorId}:2`];
    const connectedResistorPin = resistorPins.find((pinKey) =>
      reachableEndpointKeys(graph, [pinKey]).has(segmentKey)
    );
    if (!connectedResistorPin) {
      continue;
    }

    const controllerConnection = spec.connections.find((connection) => {
      const endpoints = [connection.from, connection.to];
      return endpoints.some((endpoint) => endpoint.componentId === resistorId)
        && endpoints.some((endpoint) => {
          const component = spec.components.find((candidate) => candidate.id === endpoint.componentId);
          return component?.partId === 'arduino-uno' && controllerPinMatchesRole(endpoint.pin, 'digital-output');
        });
    });
    const controllerEndpoint = controllerConnection
      ? [controllerConnection.from, controllerConnection.to].find((endpoint) => {
        const component = spec.components.find((candidate) => candidate.id === endpoint.componentId);
        return component?.partId === 'arduino-uno';
      })
      : null;
    if (controllerEndpoint) {
      return `${controllerEndpoint.componentId}:${controllerEndpoint.pin}`;
    }
  }

  return null;
}

function compileLedArrayDisplayCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const powerPin = firstPinNameForRole(context.part, isPowerRole) ?? 'VCC';
  const groundPin = firstPinNameForRole(context.part, isGroundRole) ?? 'GND';
  const dataPin = firstPinNameForRole(context.part, (role) => role === 'data' || role === 'single-wire-data') ?? 'DIO';
  const clockPin = firstPinNameForRole(context.part, (role) => role === 'clock') ?? 'CLK';
  const selectPin = firstPinNameForRole(context.part, (role) => role === 'chip-select' || role === 'enable');
  const dataEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, dataPin, 'digital-output')
    ?? findConnectedControllerEndpointWithRole(spec, targetId, dataPin, 'pwm-output')
    ?? `${controllerId}:D4`;
  const clockEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, clockPin, 'digital-output')
    ?? findConnectedControllerEndpointWithRole(spec, targetId, clockPin, 'pwm-output')
    ?? `${controllerId}:D5`;
  const paths: CurrentPath[] = [
    {
      id: `led-array-display-supply-current:${targetId}`,
      kind: 'supply-current',
      primitiveId: context.primitive.id,
      label: `${context.part.label} display supply current`,
      from: `${controllerId}:5V`,
      through: [targetId],
      to: `${controllerId}:GND`,
      expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
      animation: { color: '#ff4d3d', speed: 0.5 }
    },
    {
      id: `led-array-display-data-signal:${targetId}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} data signal`,
      from: dataEndpoint,
      through: [targetId],
      to: `${targetId}:${dataPin}`,
      expectedCurrentMa: 0,
      animation: { color: '#2f7df6', speed: 0.56 }
    },
    {
      id: `led-array-display-clock-signal:${targetId}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} clock signal`,
      from: clockEndpoint,
      through: [targetId],
      to: `${targetId}:${clockPin}`,
      expectedCurrentMa: 0,
      animation: { color: '#f6c44c', speed: 0.58 }
    }
  ];

  if (selectPin) {
    const selectEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, selectPin, 'digital-output')
      ?? findConnectedControllerEndpointWithRole(spec, targetId, selectPin, 'pwm-output')
      ?? `${controllerId}:D6`;
    paths.push({
      id: `led-array-display-select-signal:${targetId}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} select signal`,
      from: selectEndpoint,
      through: [targetId],
      to: `${targetId}:${selectPin}`,
      expectedCurrentMa: 0,
      animation: { color: '#7c3aed', speed: 0.52 }
    });
  }

  if (powerPin !== 'VCC' || groundPin !== 'GND') {
    paths[0] = {
      ...paths[0],
      label: `${context.part.label} display supply current (${powerPin}/${groundPin})`
    };
  }

  return paths;
}

function compileAddressableLedDisplayCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const powerPin = firstPinNameForRole(context.part, isPowerRole) ?? '5V';
  const groundPin = firstPinNameForRole(context.part, isGroundRole) ?? 'GND';
  const dataPin = firstPinNameForRole(context.part, (role) => role === 'single-wire-data' || role === 'data') ?? 'DIN';
  const dataEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, dataPin, 'digital-output')
    ?? findConnectedControllerEndpointWithRole(spec, targetId, dataPin, 'pwm-output')
    ?? `${controllerId}:D6`;

  return [
    {
      id: `addressable-led-supply-current:${targetId}`,
      kind: 'supply-current',
      primitiveId: context.primitive.id,
      label: `${context.part.label} supply current (${powerPin}/${groundPin})`,
      from: `${controllerId}:5V`,
      through: [targetId],
      to: `${controllerId}:GND`,
      expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
      animation: { color: '#ff7759', speed: 0.48 }
    },
    {
      id: `addressable-led-data-signal:${targetId}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} DIN data signal`,
      from: dataEndpoint,
      through: [targetId],
      to: `${targetId}:${dataPin}`,
      expectedCurrentMa: 0,
      animation: { color: '#9bd67d', speed: 0.6 }
    }
  ];
}

function compileRgbLedCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const graph = buildEndpointGraph(spec);
  const resistorIds = spec.components
    .filter((component) => component.partId === 'resistor-220')
    .map((component) => component.id);
  const controllerOutputs = unique(spec.connections
    .flatMap((connection) => [connection.from, connection.to])
    .filter((endpoint) => {
      const component = spec.components.find((candidate) => candidate.id === endpoint.componentId);
      return component?.partId === 'arduino-uno'
        && (controllerPinMatchesRole(endpoint.pin, 'digital-output') || controllerPinMatchesRole(endpoint.pin, 'pwm-output'));
    })
    .map(endpointKey));

  return rgbLedChannelPins(context.part).flatMap((pin) => {
    const channelKey = `${targetId}:${pin}`;
    const seriesResistorIds = componentIdsOnPathThroughAnyComponent(graph, controllerOutputs, channelKey, resistorIds);
    if (seriesResistorIds.length === 0) {
      return [];
    }
    const controllerEndpoint = findSegmentControllerEndpointThroughResistor(spec, graph, channelKey, seriesResistorIds)
      ?? `${controllerId}:D9`;
    return [{
      id: `rgb-led-channel-current:${targetId}:${pin}`,
      kind: 'load-current' as const,
      primitiveId: context.primitive.id,
      label: `${context.part.label} ${pin} channel current`,
      from: controllerEndpoint,
      through: [...seriesResistorIds, targetId],
      to: `${controllerId}:GND`,
      expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
      animation: { color: rgbChannelColor(pin), speed: 0.58 }
    }];
  });
}

function compilePoweredLightModuleCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const powerPin = firstPinNameForRole(context.part, isPowerRole) ?? 'VCC';
  const groundPin = firstPinNameForRole(context.part, isGroundRole) ?? 'GND';
  const signalPin = firstPinNameForRole(context.part, (role) => role === 'digital-input' || role === 'data' || role === 'signal') ?? 'S';
  const signalEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, signalPin, 'digital-output')
    ?? findConnectedControllerEndpointWithRole(spec, targetId, signalPin, 'pwm-output')
    ?? `${controllerId}:D7`;

  return [
    {
      id: `powered-light-module-supply-current:${targetId}`,
      kind: 'supply-current',
      primitiveId: context.primitive.id,
      label: `${context.part.label} supply current (${powerPin}/${groundPin})`,
      from: `${controllerId}:5V`,
      through: [targetId],
      to: `${controllerId}:GND`,
      expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
      animation: { color: '#ff4d3d', speed: 0.46 }
    },
    {
      id: `powered-light-module-control-signal:${targetId}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} control signal`,
      from: signalEndpoint,
      through: [targetId],
      to: `${targetId}:${signalPin}`,
      expectedCurrentMa: 0,
      animation: { color: '#2f7df6', speed: 0.56 }
    }
  ];
}

function compileLowSideSwitchedLoadCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const path = resolveLowSideSwitchedLoadPathForSimulation(spec, context);
  if (!path) {
    return [];
  }
  const supplyThrough = path.driverId
    ? [targetId, path.driverId]
    : [targetId];
  const signalThrough = path.driverId
    ? [...path.baseResistorIds, path.driverId]
    : [targetId];

  return [
    {
      id: `low-side-load-supply-current:${targetId}`,
      kind: 'load-current',
      primitiveId: context.primitive.id,
      label: `${context.part.label} switched load current`,
      from: `${controllerId}:5V`,
      through: unique(supplyThrough),
      to: `${controllerId}:GND`,
      expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
      animation: { color: '#ff7759', speed: 0.42 }
    },
    {
      id: `low-side-load-control-signal:${targetId}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} low-side control signal`,
      from: path.controlEndpoint,
      through: unique(signalThrough),
      to: path.controlTargetEndpoint,
      expectedCurrentMa: 0,
      animation: { color: '#f6c44c', speed: 0.62 }
    }
  ];
}

function resolveLowSideSwitchedLoadPathForSimulation(
  spec: CircuitSpec,
  context: SimulationContext
): LowSideSwitchedLoadPath | null {
  const graph = buildEndpointGraph(spec);
  const { highPin, lowPin } = lowSideLoadPins(context.part);
  const targetId = context.component.id;

  if (!highPin || !lowPin) {
    return null;
  }

  if (LOW_SIDE_INTEGRATED_LOAD_PART_IDS.has(context.component.partId)) {
    const signalPin = firstPinNameForRole(context.part, (role) => role === 'digital-input' || role === 'data' || role === 'signal') ?? 'IN';
    const controlEndpoint = findConnectedControllerEndpointWithAnyRole(spec, targetId, signalPin, ['digital-output', 'pwm-output']);
    return controlEndpoint ? {
      topologyId: 'controller-mosfet-module-load',
      loadId: targetId,
      loadHighPin: highPin,
      loadLowPin: lowPin,
      baseResistorIds: [],
      controlEndpoint,
      controlTargetEndpoint: `${targetId}:${signalPin}`
    } : null;
  }

  for (const driver of spec.components.filter((candidate) => LOW_SIDE_MOSFET_MODULE_PART_IDS.has(candidate.partId))) {
    const loadHighConnected = reachableEndpointKeys(graph, [`${driver.id}:V+`]).has(`${targetId}:${highPin}`);
    const loadLowConnected = reachableEndpointKeys(graph, [`${driver.id}:V-`]).has(`${targetId}:${lowPin}`);
    const controlEndpoint = findConnectedControllerEndpointWithAnyRole(spec, driver.id, 'SIG', ['digital-output', 'pwm-output']);
    if (loadHighConnected && loadLowConnected && controlEndpoint) {
      return {
        topologyId: 'controller-mosfet-module-load',
        loadId: targetId,
        loadHighPin: highPin,
        loadLowPin: lowPin,
        driverId: driver.id,
        driverPartId: driver.partId,
        driverInputPin: 'SIG',
        baseResistorIds: [],
        controlEndpoint,
        controlTargetEndpoint: `${driver.id}:SIG`
      };
    }
  }

  const resistorIds = spec.components
    .filter((component) => component.partId === 'resistor-220')
    .map((component) => component.id);
  const controllerOutputs = controllerSignalEndpointKeys(spec);

  for (const driver of spec.components.filter((candidate) => LOW_SIDE_DISCRETE_DRIVER_PART_IDS.has(candidate.partId))) {
    const loadLowConnected = reachableEndpointKeys(graph, [`${driver.id}:C`]).has(`${targetId}:${lowPin}`);
    const baseResistorIds = componentIdsOnPathThroughAnyComponent(graph, controllerOutputs, `${driver.id}:B`, resistorIds);
    const controlEndpoint = controllerOutputEndpointOnPath(graph, controllerOutputs, `${driver.id}:B`);
    if (loadLowConnected && controlEndpoint && baseResistorIds.length > 0) {
      return {
        topologyId: 'controller-transistor-low-side-load',
        loadId: targetId,
        loadHighPin: highPin,
        loadLowPin: lowPin,
        driverId: driver.id,
        driverPartId: driver.partId,
        driverInputPin: 'B',
        baseResistorIds,
        controlEndpoint,
        controlTargetEndpoint: `${driver.id}:B`
      };
    }
  }

  return null;
}

function compileHBridgeMotorCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const driver = context.component;
  const motor = spec.components.find((candidate) => HBRIDGE_MOTOR_LOAD_PART_IDS.has(candidate.partId));
  if (!motor) {
    return [];
  }
  const path = resolveHBridgeMotorPathForSimulation(spec, driver, motor);
  if (!path) {
    return [];
  }
  const motorExpectedCurrentMa = motor.partId === 'dc-motor-130' ? 180 : context.part.simulationModel.nominalCurrentMa;

  return [
    {
      id: `hbridge-motor-current:${path.motorId}`,
      kind: 'load-current',
      primitiveId: context.primitive.id,
      label: `${motor.label} current through H-bridge`,
      from: `${controllerId}:5V`,
      through: unique([path.driverId, path.motorId]),
      to: `${controllerId}:GND`,
      expectedCurrentMa: motorExpectedCurrentMa,
      animation: { color: '#ff7759', speed: 0.4 }
    },
    {
      id: `hbridge-control-signals:${path.motorId}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} enable and direction signals`,
      from: path.controlEndpoints[0] ?? `${controllerId}:D9`,
      through: [path.driverId],
      to: path.controlTargetEndpoints[0] ?? `${path.driverId}:${hbridgeControlPins(path.driverPartId)[0]}`,
      expectedCurrentMa: 0,
      animation: { color: '#2f7df6', speed: 0.62 }
    }
  ];
}

function resolveHBridgeMotorPathForSimulation(
  spec: CircuitSpec,
  driver: CircuitSpec['components'][number],
  motor: CircuitSpec['components'][number]
): HBridgeMotorPath | null {
  const graph = buildEndpointGraph(spec);
  const pins = hbridgePinContract(driver.partId);
  const controlEndpoints = pins.controls
    .map((pin) => findConnectedControllerEndpointWithAnyRole(spec, driver.id, pin, ['digital-output', 'pwm-output']))
    .filter((endpoint): endpoint is string => Boolean(endpoint));
  const controlTargetEndpoints = pins.controls.map((pin) => `${driver.id}:${pin}`);
  const directOutputConnections = [
    { driverPin: pins.outputs[0], motorPin: 'M+' },
    { driverPin: pins.outputs[1], motorPin: 'M-' }
  ].filter(({ driverPin, motorPin }) =>
    reachableEndpointKeys(graph, [`${driver.id}:${driverPin}`]).has(`${motor.id}:${motorPin}`)
  );
  const reversedOutputConnections = [
    { driverPin: pins.outputs[0], motorPin: 'M-' },
    { driverPin: pins.outputs[1], motorPin: 'M+' }
  ].filter(({ driverPin, motorPin }) =>
    reachableEndpointKeys(graph, [`${driver.id}:${driverPin}`]).has(`${motor.id}:${motorPin}`)
  );
  const outputConnections = directOutputConnections.length === 2 ? directOutputConnections : reversedOutputConnections;

  if (controlEndpoints.length === pins.controls.length && outputConnections.length === 2) {
    return {
      topologyId: 'controller-hbridge-dc-motor',
      motorId: motor.id,
      driverId: driver.id,
      driverPartId: driver.partId,
      controlEndpoints,
      controlTargetEndpoints,
      outputConnections
    };
  }

  return null;
}

function compileStepperMotorCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const path = resolveStepperMotorPathForSimulation(spec, context);
  if (!path) {
    return [];
  }

  return [
    {
      id: `stepper-coil-current:${targetId}`,
      kind: 'load-current',
      primitiveId: context.primitive.id,
      label: `${context.part.label} coil current through driver`,
      from: `${controllerId}:5V`,
      through: unique([targetId, path.driverId]),
      to: `${controllerId}:GND`,
      expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
      animation: { color: '#ff7759', speed: 0.36 }
    },
    {
      id: `stepper-control-signals:${targetId}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} driver control signals`,
      from: path.controlEndpoints[0] ?? `${controllerId}:D8`,
      through: [path.driverId],
      to: path.controlTargetEndpoints[0] ?? `${path.driverId}:IN1`,
      expectedCurrentMa: 0,
      animation: { color: '#8bd450', speed: 0.68 }
    }
  ];
}

function resolveStepperMotorPathForSimulation(
  spec: CircuitSpec,
  context: SimulationContext
): StepperMotorPath | null {
  const graph = buildEndpointGraph(spec);
  const targetId = context.component.id;

  if (UNIPOLAR_STEPPER_MOTOR_PART_IDS.has(context.component.partId)) {
    const phasePairs = [
      ['OUT1', 'IN1'],
      ['OUT2', 'IN2'],
      ['OUT3', 'IN3'],
      ['OUT4', 'IN4']
    ] as const;
    for (const driver of spec.components.filter((candidate) => ULN2003_STEPPER_DRIVER_PART_IDS.has(candidate.partId))) {
      const controlEndpoints = ['IN1', 'IN2', 'IN3', 'IN4']
        .map((pin) => findConnectedControllerEndpointWithAnyRole(spec, driver.id, pin, ['digital-output', 'pwm-output']))
        .filter((endpoint): endpoint is string => Boolean(endpoint));
      const controlTargetEndpoints = ['IN1', 'IN2', 'IN3', 'IN4'].map((pin) => `${driver.id}:${pin}`);
      const phaseConnections = phasePairs.filter(([driverPin, motorPin]) =>
        reachableEndpointKeys(graph, [`${driver.id}:${driverPin}`]).has(`${targetId}:${motorPin}`)
      ).map(([driverPin, motorPin]) => ({ driverPin, motorPin }));
      if (controlEndpoints.length === 4 && phaseConnections.length === 4) {
        return {
          topologyId: 'controller-uln2003-unipolar-stepper',
          motorId: targetId,
          driverId: driver.id,
          controlEndpoints,
          controlTargetEndpoints,
          phaseConnections
        };
      }
    }
  }

  if (BIPOLAR_STEPPER_MOTOR_PART_IDS.has(context.component.partId)) {
    const coilPairs = [
      ['1A', 'A+'],
      ['1B', 'A-'],
      ['2A', 'B+'],
      ['2B', 'B-']
    ] as const;
    for (const driver of spec.components.filter((candidate) => STEP_DIR_STEPPER_DRIVER_PART_IDS.has(candidate.partId))) {
      const stepEndpoint = findConnectedControllerEndpointWithAnyRole(spec, driver.id, 'STEP', ['digital-output', 'pwm-output']);
      const dirEndpoint = findConnectedControllerEndpointWithAnyRole(spec, driver.id, 'DIR', ['digital-output', 'pwm-output']);
      const phaseConnections = coilPairs.filter(([driverPin, motorPin]) =>
        reachableEndpointKeys(graph, [`${driver.id}:${driverPin}`]).has(`${targetId}:${motorPin}`)
      ).map(([driverPin, motorPin]) => ({ driverPin, motorPin }));
      if (stepEndpoint && dirEndpoint && phaseConnections.length === 4) {
        return {
          topologyId: 'controller-step-dir-bipolar-stepper',
          motorId: targetId,
          driverId: driver.id,
          controlEndpoints: [stepEndpoint, dirEndpoint],
          controlTargetEndpoints: [`${driver.id}:STEP`, `${driver.id}:DIR`],
          phaseConnections
        };
      }
    }
  }

  return null;
}

function compileRelayModuleCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const path = resolveRelayModulePathForSimulation(spec, context.component);
  if (!path) {
    return [];
  }

  return [
    {
      id: `relay-coil-control-signal:${path.relayId}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} control signal`,
      from: path.controlEndpoint,
      through: [path.relayId],
      to: path.controlTargetEndpoint,
      expectedCurrentMa: 0,
      animation: { color: '#2f7df6', speed: 0.58 }
    },
    {
      id: `relay-contact-load-current:${path.relayId}`,
      kind: 'load-current',
      primitiveId: context.primitive.id,
      label: `${context.part.label} low-voltage contact load current`,
      from: `${controllerId}:5V`,
      through: unique([path.relayId, ...path.seriesResistorIds, path.loadId]),
      to: `${controllerId}:GND`,
      expectedCurrentMa: 13.6,
      animation: { color: '#ff7759', speed: 0.38 }
    }
  ];
}

function resolveRelayModulePathForSimulation(
  spec: CircuitSpec,
  relay: CircuitSpec['components'][number]
): RelayModulePath | null {
  if (hasRelayMainsLanguage(spec)) {
    return null;
  }
  const graph = buildEndpointGraph(spec);
  const contact = relayContactPins(relay.partId);
  const hasPower = Boolean(findConnectionToControllerRole(spec, relay.id, 'VCC', 'power'));
  const hasGround = Boolean(findConnectionToControllerRole(spec, relay.id, 'GND', 'ground'));
  const inputPin = relayInputPins(relay.partId).find((pin) =>
    findConnectedControllerEndpointWithAnyRole(spec, relay.id, pin, ['digital-output', 'pwm-output'])
  );
  const controlEndpoint = inputPin
    ? findConnectedControllerEndpointWithAnyRole(spec, relay.id, inputPin, ['digital-output', 'pwm-output'])
    : null;
  const commonPowered = Boolean(findConnectionToControllerRole(spec, relay.id, contact.common, 'power'));
  const resistorIds = spec.components
    .filter((component) => component.partId === 'resistor-220')
    .map((component) => component.id);

  if (!hasPower || !hasGround || !inputPin || !controlEndpoint || !commonPowered) {
    return null;
  }

  for (const led of spec.components.filter((candidate) => candidate.partId === 'led-5mm')) {
    const seriesResistorIds = componentIdsOnPathThroughAnyComponent(
      graph,
      [`${relay.id}:${contact.output}`],
      `${led.id}:A`,
      resistorIds
    );
    const cathodeGrounded = Boolean(findConnectionToControllerRole(spec, led.id, 'K', 'ground'));
    if (seriesResistorIds.length > 0 && cathodeGrounded) {
      return {
        topologyId: 'controller-relay-low-voltage-load',
        relayId: relay.id,
        relayPartId: relay.partId,
        inputPin,
        controlEndpoint,
        controlTargetEndpoint: `${relay.id}:${inputPin}`,
        contactCommonPin: contact.common,
        contactOutputPin: contact.output,
        loadId: led.id,
        seriesResistorIds
      };
    }
  }

  return null;
}

function compileSpiDisplayCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const powerPin = firstPinNameForRole(context.part, isPowerRole) ?? 'VCC';
  const groundPin = firstPinNameForRole(context.part, isGroundRole) ?? 'GND';
  const dataPin = firstPinNameForRole(context.part, (role) => role === 'data') ?? 'DIN';
  const clockPin = firstPinNameForRole(context.part, (role) => role === 'clock') ?? 'SCK';
  const selectPin = firstPinNameForRole(context.part, (role) => role === 'chip-select' || role === 'enable') ?? 'CS';
  const controlPins = context.part.pins
    .filter((pin) => pin.role === 'data-command' || pin.role === 'reset')
    .map((pin) => pin.name);
  const dataEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, dataPin, 'digital-output')
    ?? findConnectedControllerEndpointWithRole(spec, targetId, dataPin, 'pwm-output')
    ?? `${controllerId}:D11`;
  const clockEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, clockPin, 'digital-output')
    ?? findConnectedControllerEndpointWithRole(spec, targetId, clockPin, 'pwm-output')
    ?? `${controllerId}:D13`;
  const selectEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, selectPin, 'digital-output')
    ?? findConnectedControllerEndpointWithRole(spec, targetId, selectPin, 'pwm-output')
    ?? `${controllerId}:D10`;

  const paths: CurrentPath[] = [
    {
      id: `spi-display-supply-current:${targetId}`,
      kind: 'supply-current',
      primitiveId: context.primitive.id,
      label: `${context.part.label} display supply current (${powerPin}/${groundPin})`,
      from: `${controllerId}:5V`,
      through: [targetId],
      to: `${controllerId}:GND`,
      expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
      animation: { color: '#ff4d3d', speed: 0.47 }
    },
    {
      id: `spi-display-data-signal:${targetId}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} data signal`,
      from: dataEndpoint,
      through: [targetId],
      to: `${targetId}:${dataPin}`,
      expectedCurrentMa: 0,
      animation: { color: '#2f7df6', speed: 0.58 }
    },
    {
      id: `spi-display-clock-signal:${targetId}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} clock signal`,
      from: clockEndpoint,
      through: [targetId],
      to: `${targetId}:${clockPin}`,
      expectedCurrentMa: 0,
      animation: { color: '#f6c44c', speed: 0.58 }
    },
    {
      id: `spi-display-select-signal:${targetId}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} chip-select signal`,
      from: selectEndpoint,
      through: [targetId],
      to: `${targetId}:${selectPin}`,
      expectedCurrentMa: 0,
      animation: { color: '#7c3aed', speed: 0.52 }
    }
  ];

  for (const controlPin of controlPins) {
    const controlEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, controlPin, 'digital-output')
      ?? findConnectedControllerEndpointWithRole(spec, targetId, controlPin, 'pwm-output')
      ?? `${controllerId}:D8`;
    paths.push({
      id: `spi-display-control-signal:${targetId}:${controlPin}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} ${controlPin} control signal`,
      from: controlEndpoint,
      through: [targetId],
      to: `${targetId}:${controlPin}`,
      expectedCurrentMa: 0,
      animation: { color: '#22c55e', speed: 0.5 }
    });
  }

  return paths;
}

function compileAnalogInputCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const analogPin = firstPinNameForRole(context.part, (role) => role === 'analog-output' || role === 'analog') ?? 'OUT';
  const controllerAnalogEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, analogPin, 'analog-input') ?? `${controllerId}:A0`;
  const prefix = context.primitive.id === 'analog_pwm_dimmer' ? 'analog-pwm' : 'analog-threshold';

  return [
    {
      id: `${prefix}-sensing-divider:${targetId}`,
      kind: 'sensing-divider',
      primitiveId: context.primitive.id,
      label: `${context.part.label} sensing divider`,
      from: `${controllerId}:5V`,
      through: [targetId],
      to: `${controllerId}:GND`,
      expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
      animation: { color: '#f2a65a', speed: 0.45 }
    },
    {
      id: `${prefix}-analog-signal:${targetId}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} analog signal`,
      from: `${targetId}:${analogPin}`,
      through: [targetId],
      to: controllerAnalogEndpoint,
      expectedCurrentMa: 0,
      animation: { color: '#2f7df6', speed: 0.35 }
    }
  ];
}

function compileAnalogSensorDisplayCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const displayId = componentIdForI2cTextDisplay(spec);
  const analogPin = firstPinNameForRole(context.part, (role) => role === 'analog-output' || role === 'analog') ?? 'OUT';
  const controllerAnalogEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, analogPin, 'analog-input') ?? `${controllerId}:A0`;
  const displayBusEndpoint = findConnectedControllerEndpointWithRole(spec, displayId, 'SDA', 'i2c-data')
    ?? `${controllerId}:A4/SDA`;

  return [
    {
      id: `analog-sensor-supply-current:${targetId}`,
      kind: 'supply-current',
      primitiveId: context.primitive.id,
      label: `${context.part.label} supply current`,
      from: `${controllerId}:5V`,
      through: [targetId],
      to: `${controllerId}:GND`,
      expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
      animation: { color: '#5ce1e6', speed: 0.48 }
    },
    {
      id: `analog-sensor-analog-signal:${targetId}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} analog readout signal`,
      from: `${targetId}:${analogPin}`,
      through: [targetId],
      to: controllerAnalogEndpoint,
      expectedCurrentMa: 0,
      animation: { color: '#2f7df6', speed: 0.35 }
    },
    {
      id: `analog-sensor-display-bus-activity:${displayId}`,
      kind: 'bus-activity',
      primitiveId: context.primitive.id,
      label: 'OLED analog sensor value update',
      from: displayBusEndpoint,
      through: [displayId],
      to: `${displayId}:SDA`,
      expectedCurrentMa: 0,
      animation: { color: '#84a9ff', speed: 0.54 }
    }
  ];
}

function compileResistiveSensorDisplayCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const displayId = componentIdForI2cTextDisplay(spec);
  const divider = resolveResistiveSensorDivider(spec, context);
  const displayBusEndpoint = findConnectedControllerEndpointWithRole(spec, displayId, 'SDA', 'i2c-data')
    ?? `${controllerId}:A4/SDA`;

  return [
    {
      id: `resistive-sensor-divider-current:${targetId}`,
      kind: 'sensing-divider',
      primitiveId: context.primitive.id,
      label: `${context.part.label} voltage divider current`,
      from: `${controllerId}:5V`,
      through: [targetId, divider.referenceId],
      to: `${controllerId}:GND`,
      expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
      animation: { color: '#f2a65a', speed: 0.45 }
    },
    {
      id: `resistive-sensor-analog-signal:${targetId}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} divider midpoint signal`,
      from: `${targetId}:${divider.dividerPin}`,
      through: [targetId],
      to: divider.controllerAnalogEndpoint,
      expectedCurrentMa: 0,
      animation: { color: '#2f7df6', speed: 0.35 }
    },
    {
      id: `resistive-sensor-display-bus-activity:${displayId}`,
      kind: 'bus-activity',
      primitiveId: context.primitive.id,
      label: 'OLED resistive sensor value update',
      from: displayBusEndpoint,
      through: [displayId],
      to: `${displayId}:SDA`,
      expectedCurrentMa: 0,
      animation: { color: '#84a9ff', speed: 0.54 }
    }
  ];
}

function compileResistiveSensorThresholdCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const divider = resolveResistiveSensorDivider(spec, context);

  return [
    {
      id: `resistive-threshold-sensing-divider:${targetId}`,
      kind: 'sensing-divider',
      primitiveId: context.primitive.id,
      label: `${context.part.label} threshold divider current`,
      from: `${controllerId}:5V`,
      through: [targetId, divider.referenceId],
      to: `${controllerId}:GND`,
      expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
      animation: { color: '#f2a65a', speed: 0.45 }
    },
    {
      id: `resistive-threshold-analog-signal:${targetId}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} threshold analog signal`,
      from: `${targetId}:${divider.dividerPin}`,
      through: [targetId],
      to: divider.controllerAnalogEndpoint,
      expectedCurrentMa: 0,
      animation: { color: '#2f7df6', speed: 0.35 }
    }
  ];
}

function resolveResistiveSensorDivider(spec: CircuitSpec, context: SimulationContext) {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const terminalPins = context.part.pins.map((pin) => pin.name);
  const dividerPin = terminalPins.find((pin) =>
    findConnectionToControllerRole(spec, targetId, pin, 'analog-input')
  ) ?? terminalPins[1] ?? 'B';
  const controllerAnalogEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, dividerPin, 'analog-input')
    ?? `${controllerId}:A0`;
  const referenceId = spec.components.find((component) => RESISTIVE_SENSOR_REFERENCE_RESISTOR_PART_IDS.has(component.partId))?.id
    ?? 'resistor-10k';

  return {
    dividerPin,
    controllerAnalogEndpoint,
    referenceId
  };
}

function compileDistanceSensorCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const triggerEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, 'TRIG', 'digital-output')
    ?? findConnectedControllerEndpointWithRole(spec, targetId, 'TRIG', 'pwm-output')
    ?? `${controllerId}:D3`;
  const echoEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, 'ECHO', 'digital-input')
    ?? `${controllerId}:D2`;

  return [
    {
      id: `distance-sensor-supply-current:${targetId}`,
      kind: 'supply-current',
      primitiveId: context.primitive.id,
      label: `${context.part.label} supply current`,
      from: `${controllerId}:5V`,
      through: [targetId],
      to: `${controllerId}:GND`,
      expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
      animation: { color: '#5ce1e6', speed: 0.5 }
    },
    {
      id: `distance-trigger-signal:${targetId}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} trigger pulse`,
      from: triggerEndpoint,
      through: [targetId],
      to: `${targetId}:TRIG`,
      expectedCurrentMa: 0,
      animation: { color: '#9bd67d', speed: 0.58 }
    },
    {
      id: `distance-echo-signal:${targetId}`,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} echo pulse`,
      from: `${targetId}:ECHO`,
      through: [targetId],
      to: echoEndpoint,
      expectedCurrentMa: 0,
      animation: { color: '#84a9ff', speed: 0.54 }
    }
  ];
}

function compileSingleWireSensorCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const displayId = componentIdForI2cTextDisplay(spec);
  const pathIds = singleWireCurrentPathIds(context.part.id, targetId, displayId);
  const dataPin = firstPinNameForRole(context.part, (role) => role === 'single-wire-data' || role === 'digital-data' || role === 'digital-output') ?? 'DAT';
  const dataEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, dataPin, 'digital-input')
    ?? `${controllerId}:D2`;
  const displayBusEndpoint = findConnectedControllerEndpointWithRole(spec, displayId, 'SDA', 'i2c-data')
    ?? `${controllerId}:A4/SDA`;

  return [
    {
      id: pathIds.supply,
      kind: 'supply-current',
      primitiveId: context.primitive.id,
      label: `${context.part.label} supply current`,
      from: `${controllerId}:5V`,
      through: [targetId],
      to: `${controllerId}:GND`,
      expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
      animation: { color: '#5ce1e6', speed: 0.5 }
    },
    {
      id: pathIds.data,
      kind: 'signal-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} data signal`,
      from: `${targetId}:${dataPin}`,
      through: [targetId],
      to: dataEndpoint,
      expectedCurrentMa: 0,
      animation: { color: '#9bd67d', speed: 0.58 }
    },
    {
      id: pathIds.display,
      kind: 'bus-activity',
      primitiveId: context.primitive.id,
      label: 'OLED temperature/humidity bus update',
      from: displayBusEndpoint,
      through: [displayId],
      to: `${displayId}:SDA`,
      expectedCurrentMa: 0,
      animation: { color: '#84a9ff', speed: 0.54 }
    }
  ];
}

function compileProtocolSensorCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const displayId = componentIdForI2cTextDisplay(spec);
  const powerPin = firstPinNameForRole(context.part, (role) => role === 'power') ?? (SPI_PROTOCOL_SENSOR_PART_IDS.has(context.component.partId) ? '3V3' : 'VCC');
  const controllerPowerEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, powerPin, 'power')
    ?? `${controllerId}:${SPI_PROTOCOL_SENSOR_PART_IDS.has(context.component.partId) ? '3V3' : '5V'}`;
  const displayBusEndpoint = findConnectedControllerEndpointWithRole(spec, displayId, 'SDA', 'i2c-data')
    ?? `${controllerId}:A4/SDA`;
  const signalPath = protocolSensorSignalPath(spec, context, controllerId);

  return [
    {
      id: `protocol-sensor-supply-current:${targetId}`,
      kind: 'supply-current',
      primitiveId: context.primitive.id,
      label: `${context.part.label} supply current`,
      from: controllerPowerEndpoint,
      through: [targetId],
      to: `${controllerId}:GND`,
      expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
      animation: { color: '#5ce1e6', speed: 0.48 }
    },
    {
      id: `protocol-sensor-bus-activity:${targetId}`,
      kind: 'bus-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} protocol activity`,
      from: signalPath.from,
      through: [targetId],
      to: signalPath.to,
      expectedCurrentMa: 0,
      animation: { color: signalPath.color, speed: 0.56 }
    },
    {
      id: `protocol-sensor-display-bus-activity:${displayId}`,
      kind: 'bus-activity',
      primitiveId: context.primitive.id,
      label: 'OLED sensor readout bus update',
      from: displayBusEndpoint,
      through: [displayId],
      to: `${displayId}:SDA`,
      expectedCurrentMa: 0,
      animation: { color: '#84a9ff', speed: 0.54 }
    }
  ];
}

function protocolSensorSignalPath(spec: CircuitSpec, context: SimulationContext, controllerId: string) {
  const targetId = context.component.id;

  if (I2C_PROTOCOL_SENSOR_PART_IDS.has(context.component.partId)) {
    const dataPin = firstPinNameForRole(context.part, (role) => role === 'i2c-data') ?? 'SDA';
    const endpoint = findConnectedControllerEndpointWithRole(spec, targetId, dataPin, 'i2c-data')
      ?? `${controllerId}:A4/SDA`;
    return {
      from: `${targetId}:${dataPin}`,
      to: endpoint,
      color: '#2f7df6'
    };
  }

  if (CLOCKED_DATA_SENSOR_PART_IDS.has(context.component.partId)) {
    const dataPin = firstPinNameForRole(context.part, (role) => role === 'digital-data') ?? 'DT';
    const endpoint = findConnectedControllerEndpointWithRole(spec, targetId, dataPin, 'digital-input')
      ?? `${controllerId}:D2`;
    return {
      from: `${targetId}:${dataPin}`,
      to: endpoint,
      color: '#9bd67d'
    };
  }

  if (SPI_PROTOCOL_SENSOR_PART_IDS.has(context.component.partId)) {
    const clockPin = firstPinNameForRole(context.part, (role) => role === 'spi-clock') ?? 'SCK';
    const endpoint = findConnectedControllerEndpointWithRole(spec, targetId, clockPin, 'spi-clock')
      ?? `${controllerId}:D13`;
    return {
      from: endpoint,
      to: `${targetId}:${clockPin}`,
      color: '#f6c44c'
    };
  }

  const txPin = firstPinNameForRole(context.part, (role) => role === 'serial-tx') ?? 'TX';
  const endpoint = findConnectedControllerEndpointWithRole(spec, targetId, txPin, 'serial-rx')
    ?? `${controllerId}:D0/RX`;
  return {
    from: `${targetId}:${txPin}`,
    to: endpoint,
    color: '#84a9ff'
  };
}

function compileCommunicationModuleCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const displayId = componentIdForI2cTextDisplay(spec);
  const powerPin = firstPinNameForRole(context.part, isPowerRole) ?? (SPI_COMMUNICATION_MODULE_PART_IDS.has(context.component.partId) ? 'VCC' : 'VCC');
  const controllerPowerEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, powerPin, 'power')
    ?? `${controllerId}:${['lora-ra02', 'nrf24l01-radio'].includes(context.component.partId) ? '3V3' : '5V'}`;
  const displayBusEndpoint = findConnectedControllerEndpointWithRole(spec, displayId, 'SDA', 'i2c-data')
    ?? `${controllerId}:A4/SDA`;
  const signalPath = communicationModuleSignalPath(spec, context, controllerId);

  return [
    {
      id: `communication-module-supply-current:${targetId}`,
      kind: 'supply-current',
      primitiveId: context.primitive.id,
      label: `${context.part.label} supply current`,
      from: controllerPowerEndpoint,
      through: [targetId],
      to: `${controllerId}:GND`,
      expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
      animation: { color: '#5ce1e6', speed: 0.46 }
    },
    {
      id: `communication-module-bus-activity:${targetId}`,
      kind: 'bus-activity',
      primitiveId: context.primitive.id,
      label: `${context.part.label} command/bus activity`,
      from: signalPath.from,
      through: [targetId],
      to: signalPath.to,
      expectedCurrentMa: 0,
      animation: { color: signalPath.color, speed: 0.56 }
    },
    {
      id: `communication-module-display-bus-activity:${displayId}`,
      kind: 'bus-activity',
      primitiveId: context.primitive.id,
      label: 'OLED communication module status update',
      from: displayBusEndpoint,
      through: [displayId],
      to: `${displayId}:SDA`,
      expectedCurrentMa: 0,
      animation: { color: '#84a9ff', speed: 0.54 }
    }
  ];
}

function communicationModuleSignalPath(spec: CircuitSpec, context: SimulationContext, controllerId: string) {
  const targetId = context.component.id;

  if (SPI_COMMUNICATION_MODULE_PART_IDS.has(context.component.partId)) {
    const clockPin = firstPinNameForRole(context.part, (role) => role === 'spi-clock') ?? 'SCK';
    const endpoint = findConnectedControllerEndpointWithRole(spec, targetId, clockPin, 'spi-clock')
      ?? `${controllerId}:D13`;
    return {
      from: endpoint,
      to: `${targetId}:${clockPin}`,
      color: '#f6c44c'
    };
  }

  const txPin = firstPinNameForRole(context.part, (role) => role === 'serial-tx') ?? 'TX';
  const endpoint = findConnectedControllerEndpointWithRole(spec, targetId, txPin, 'serial-rx')
    ?? `${controllerId}:D0/RX`;
  return {
    from: `${targetId}:${txPin}`,
    to: endpoint,
    color: '#84a9ff'
  };
}

function compileLogicInterfaceCurrentPaths(spec: CircuitSpec, context: SimulationContext): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const displayId = findI2cTextDisplayComponent(spec)?.id;
  const powerPin = firstPinNameForRole(context.part, isPowerRole) ?? 'VCC';
  const controllerPowerEndpoint = findConnectedControllerEndpointWithRole(spec, targetId, powerPin, 'power')
    ?? `${controllerId}:${LEVEL_SHIFTER_INTERFACE_PART_IDS.has(context.component.partId) && powerPin === 'LV' ? '3V3' : '5V'}`;
  const signalPath = logicInterfaceSignalPath(spec, context, controllerId);
  const paths: CurrentPath[] = [
    {
      id: `logic-interface-supply-current:${targetId}`,
      kind: 'supply-current',
      primitiveId: context.primitive.id,
      label: `${context.part.label} interface supply current`,
      from: controllerPowerEndpoint,
      through: [targetId],
      to: `${controllerId}:GND`,
      expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
      animation: { color: '#5ce1e6', speed: 0.46 }
    },
    {
      id: `logic-interface-signal-activity:${targetId}`,
      kind: signalPath.kind,
      primitiveId: context.primitive.id,
      label: `${context.part.label} ${signalPath.label}`,
      from: signalPath.from,
      through: [targetId],
      to: signalPath.to,
      expectedCurrentMa: 0,
      animation: { color: signalPath.color, speed: 0.56 }
    }
  ];

  if (displayId) {
    const displayBusEndpoint = findConnectedControllerEndpointWithRole(spec, displayId, 'SDA', 'i2c-data')
      ?? `${controllerId}:A4/SDA`;
    paths.push({
      id: `logic-interface-display-bus-activity:${displayId}`,
      kind: 'bus-activity',
      primitiveId: context.primitive.id,
      label: 'OLED interface state update',
      from: displayBusEndpoint,
      through: [displayId],
      to: `${displayId}:SDA`,
      expectedCurrentMa: 0,
      animation: { color: '#84a9ff', speed: 0.54 }
    });
  }

  return paths;
}

function logicInterfaceSignalPath(spec: CircuitSpec, context: SimulationContext, controllerId: string) {
  const targetId = context.component.id;

  if (LEVEL_SHIFTER_INTERFACE_PART_IDS.has(context.component.partId)) {
    const highEndpoint = findConnectedControllerEndpointWithAnyRole(spec, targetId, 'HV1', ['digital-output', 'digital-input', 'i2c-data', 'i2c-clock']);
    const lowEndpoint = findConnectedControllerEndpointWithAnyRole(spec, targetId, 'LV1', ['digital-output', 'digital-input', 'i2c-data', 'i2c-clock']);
    return {
      kind: 'signal-activity' as const,
      label: 'level-shifted signal state',
      from: highEndpoint ?? `${targetId}:HV1`,
      to: lowEndpoint ?? `${targetId}:LV1`,
      color: '#7c3aed'
    };
  }

  if (I2C_LOGIC_INTERFACE_PART_IDS.has(context.component.partId)) {
    const dataPin = firstPinNameForRole(context.part, (role) => role === 'i2c-data') ?? 'SDA';
    const endpoint = findConnectedControllerEndpointWithRole(spec, targetId, dataPin, 'i2c-data')
      ?? `${controllerId}:A4/SDA`;
    return {
      kind: 'bus-activity' as const,
      label: 'I2C interface bus activity',
      from: `${targetId}:${dataPin}`,
      to: endpoint,
      color: '#2f7df6'
    };
  }

  if (SPI_LOGIC_INTERFACE_PART_IDS.has(context.component.partId)) {
    const clockPin = firstPinNameForRole(context.part, (role) => role === 'spi-clock') ?? 'CLK';
    const endpoint = findConnectedControllerEndpointWithRole(spec, targetId, clockPin, 'spi-clock')
      ?? `${controllerId}:D13`;
    return {
      kind: 'bus-activity' as const,
      label: 'SPI interface bus activity',
      from: endpoint,
      to: `${targetId}:${clockPin}`,
      color: '#f6c44c'
    };
  }

  if (SHIFT_REGISTER_INTERFACE_PART_IDS.has(context.component.partId)) {
    const dataPin = firstPinNameForRole(context.part, (role) => role === 'data') ?? 'SER';
    const endpoint = findConnectedControllerEndpointWithAnyRole(spec, targetId, dataPin, ['digital-output', 'pwm-output', 'spi-mosi'])
      ?? `${controllerId}:D4`;
    return {
      kind: 'signal-activity' as const,
      label: 'GPIO shift-register data activity',
      from: endpoint,
      to: `${targetId}:${dataPin}`,
      color: '#9bd67d'
    };
  }

  if (ANALOG_TIMING_INTERFACE_PART_IDS.has(context.component.partId)) {
    const outputPin = firstPinNameForRole(context.part, (role) => role === 'digital-output' || role === 'analog-output') ?? 'OUT';
    const endpoint = findConnectedControllerEndpointWithAnyRole(spec, targetId, outputPin, ['digital-input', 'analog-input'])
      ?? `${controllerId}:D2`;
    return {
      kind: 'signal-activity' as const,
      label: 'qualitative output state',
      from: `${targetId}:${outputPin}`,
      to: endpoint,
      color: '#9bd67d'
    };
  }

  const signalPin = firstPinNameForRole(context.part, (role) => !isPowerRole(role) && !isGroundRole(role)) ?? 'SIG';
  const endpoint = findConnectedControllerEndpointWithAnyRole(spec, targetId, signalPin, ['digital-input', 'digital-output', 'analog-input'])
    ?? `${controllerId}:D2`;
  return {
    kind: 'signal-activity' as const,
    label: 'interface signal activity',
    from: `${targetId}:${signalPin}`,
    to: endpoint,
    color: '#9bd67d'
  };
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
      return attachConnectionSegments(spec, entry.path);
    }

    return attachConnectionSegments(spec, {
      ...entry.path,
      id: `${entry.path.id}:${entry.targetId}`
    });
  });
}

function attachConnectionSegments(spec: CircuitSpec, path: CurrentPath): CurrentPath {
  const segments = inferConnectionSegmentsForPath(spec, path);
  return {
    ...path,
    connectionIds: unique(segments.map((segment) => segment.connectionId)),
    segments
  };
}

function inferConnectionSegmentsForPath(spec: CircuitSpec, path: CurrentPath): NonNullable<CurrentPath['segments']> {
  const nodes = [path.from, ...path.through, path.to].filter(Boolean);
  const segments: NonNullable<CurrentPath['segments']> = [];
  const seen = new Set<string>();

  for (let index = 0; index < nodes.length - 1; index += 1) {
    for (const connection of connectionsForPathEdge(spec, nodes[index], nodes[index + 1])) {
      const fromKey = endpointKey(connection.from);
      const toKey = endpointKey(connection.to);
      const dedupeKey = `${connection.id}:${fromKey}:${toKey}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      segments.push({
        connectionId: connection.id,
        from: fromKey,
        to: toKey
      });
    }
  }

  return segments;
}

function connectionsForPathEdge(
  spec: CircuitSpec,
  left: string,
  right: string
): CircuitSpec['connections'] {
  const leftNode = pathNodeDescriptor(left);
  const rightNode = pathNodeDescriptor(right);
  if (!leftNode.id || !rightNode.id) {
    return [];
  }

  return spec.connections.filter((connection) => {
    const fromKey = endpointKey(connection.from);
    const toKey = endpointKey(connection.to);
    return pathNodeMatchesConnectionEndpoint(leftNode, connection.from, fromKey)
      && pathNodeMatchesConnectionEndpoint(rightNode, connection.to, toKey)
      || pathNodeMatchesConnectionEndpoint(leftNode, connection.to, toKey)
      && pathNodeMatchesConnectionEndpoint(rightNode, connection.from, fromKey);
  });
}

function pathNodeDescriptor(value: string) {
  return value.includes(':')
    ? { kind: 'endpoint' as const, id: value, componentId: endpointFromKey(value).componentId }
    : { kind: 'component' as const, id: value, componentId: value };
}

function pathNodeMatchesConnectionEndpoint(
  node: ReturnType<typeof pathNodeDescriptor>,
  endpoint: CircuitEndpoint,
  key: string
) {
  return node.kind === 'endpoint'
    ? node.id === key
    : node.componentId === endpoint.componentId;
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

function findConnectedControllerEndpointWithRole(
  spec: CircuitSpec,
  targetId: string,
  targetPin: string,
  controllerRole: string
) {
  const connection = findConnectionToControllerRole(spec, targetId, targetPin, controllerRole);
  const endpoint = connection
    ? [connection.from, connection.to].find((candidate) => candidate.componentId !== targetId)
    : undefined;
  if (!endpoint) {
    return null;
  }

  return `${endpoint.componentId}:${endpoint.pin}`;
}

function findConnectedControllerEndpointWithAnyRole(
  spec: CircuitSpec,
  targetId: string,
  targetPin: string,
  controllerRoles: string[]
) {
  for (const role of controllerRoles) {
    const endpoint = findConnectedControllerEndpointWithRole(spec, targetId, targetPin, role);
    if (endpoint) {
      return endpoint;
    }
  }
  return null;
}

function findConnectionToControllerRole(
  spec: CircuitSpec,
  targetId: string,
  targetPin: string,
  controllerRole: string
) {
  return spec.connections.find((candidate) => {
    const endpoints = [candidate.from, candidate.to];
    return endpoints.some((endpoint) => endpoint.componentId === targetId && endpoint.pin === targetPin)
      && endpoints.some((endpoint) => {
        if (endpoint.componentId === targetId) {
          return false;
        }
        const component = spec.components.find((candidateComponent) => candidateComponent.id === endpoint.componentId);
        return component?.partId === 'arduino-uno'
          && controllerPinMatchesRole(endpoint.pin, controllerRole);
      });
  });
}

function controllerPinMatchesRole(pin: string, role: string) {
  if (role === 'analog-input') return /^A\d/.test(pin);
  if (role === 'i2c-data') return pin === 'A4/SDA';
  if (role === 'i2c-clock') return pin === 'A5/SCL';
  if (role === 'digital-input') return /^D\d+$/.test(pin);
  if (role === 'digital-output') return /^D\d+$/.test(pin);
  if (role === 'pwm-output') return ['D3', 'D5', 'D6', 'D9', 'D10', 'D11'].includes(pin);
  if (role === 'spi-clock') return pin === 'D13';
  if (role === 'spi-mosi') return pin === 'D11';
  if (role === 'spi-miso') return pin === 'D12';
  if (role === 'spi-select') return pin === 'D10';
  if (role === 'serial-rx') return pin === 'D0/RX' || pin === 'D0';
  if (role === 'serial-tx') return pin === 'D1/TX' || pin === 'D1';
  if (role === 'power') return pin === '5V' || pin === '3V3';
  if (role === 'ground') return pin === 'GND';
  return true;
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

type RenderSceneBounds = NonNullable<NonNullable<RenderPlan['layout']>['bounds']>;
type RenderCameraFit = NonNullable<NonNullable<RenderPlan['layout']>['camera']>;

function compileSceneBounds(
  renderParts: RenderPlan['parts'],
  endpoints: Record<string, { x: number; y: number; z: number }>,
  labels: NonNullable<NonNullable<RenderPlan['layout']>['labels']> = {}
): RenderSceneBounds {
  const extents = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY
  };

  for (const part of renderParts) {
    const footprint = part.footprint;
    if (!footprint) {
      includeBoundsPoint(extents, part.position);
      continue;
    }
    includeBoundsPoint(extents, {
      x: part.position.x - footprint.width / 2,
      y: part.position.y,
      z: part.position.z - footprint.depth / 2
    });
    includeBoundsPoint(extents, {
      x: part.position.x + footprint.width / 2,
      y: part.position.y + footprint.height + 0.45,
      z: part.position.z + footprint.depth / 2
    });
  }

  for (const endpoint of Object.values(endpoints)) {
    includeBoundsPoint(extents, endpoint);
  }

  for (const label of Object.values(labels)) {
    includeBoundsPoint(extents, {
      x: label.position.x - label.width / 2,
      y: label.position.y - label.height / 2,
      z: label.position.z
    });
    includeBoundsPoint(extents, {
      x: label.position.x + label.width / 2,
      y: label.position.y + label.height / 2,
      z: label.position.z
    });
  }

  if (!Number.isFinite(extents.minX)) {
    includeBoundsPoint(extents, { x: 0, y: 0, z: 0 });
  }

  const min = { x: extents.minX, y: extents.minY, z: extents.minZ };
  const max = { x: extents.maxX, y: extents.maxY, z: extents.maxZ };
  const size = {
    x: Math.max(0, max.x - min.x),
    y: Math.max(0, max.y - min.y),
    z: Math.max(0, max.z - min.z)
  };
  const center = {
    x: min.x + size.x / 2,
    y: min.y + size.y / 2,
    z: min.z + size.z / 2
  };
  const radius = Math.sqrt(size.x ** 2 + size.y ** 2 + size.z ** 2) / 2;

  return { min, max, center, size, radius };
}

function includeBoundsPoint(
  extents: {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
  },
  point: { x: number; y: number; z: number }
) {
  extents.minX = Math.min(extents.minX, point.x);
  extents.minY = Math.min(extents.minY, point.y);
  extents.minZ = Math.min(extents.minZ, point.z);
  extents.maxX = Math.max(extents.maxX, point.x);
  extents.maxY = Math.max(extents.maxY, point.y);
  extents.maxZ = Math.max(extents.maxZ, point.z);
}

export function compileCameraFit(bounds: RenderSceneBounds): RenderCameraFit {
  const fov = 38;
  const fovRadians = fov * Math.PI / 180;
  const distanceForRadius = bounds.radius > 0
    ? bounds.radius / Math.sin(fovRadians / 2)
    : 0;
  const horizontalSpan = Math.max(bounds.size.x, bounds.size.z);
  // RC-D: the framing the audit demands grows with the scene radius (~3.16 * radius). A fixed upper
  // clamp of 40 would cap the distance BELOW that for large scenes (radius > ~12.6), producing a
  // false CAMERA_CLIPPING block on otherwise-valid circuits. Let the ceiling grow with the desired
  // distance so the clamp never cuts below the radius-driven framing — a no-op for small scenes
  // (desiredDistance < 40), only lifting the cap when the scene genuinely needs it.
  const desiredDistance = Math.max(4.8, distanceForRadius * 1.12, horizontalSpan * 1.45);
  const distance = clampNumber(desiredDistance, 4.8, Math.max(40, desiredDistance));
  const directionLength = Math.hypot(0.62, 0.52, 0.58);
  const direction = {
    x: 0.62 / directionLength,
    y: 0.52 / directionLength,
    z: 0.58 / directionLength
  };
  const target = {
    x: bounds.center.x,
    y: Math.max(0, bounds.center.y),
    z: bounds.center.z
  };

  return {
    position: {
      x: target.x + direction.x * distance,
      y: target.y + direction.y * distance,
      z: target.z + direction.z * distance
    },
    target,
    fov,
    minDistance: Math.max(3, distance * 0.48),
    maxDistance: Math.max(9, distance * 1.75)
  };
}

export function auditRenderCameraFit(bounds: RenderSceneBounds, camera: RenderCameraFit): RenderWarning[] {
  const distance = distanceBetween(camera.position, camera.target);
  const fovRadians = camera.fov * Math.PI / 180;
  const requiredDistance = bounds.radius > 0
    ? (bounds.radius / Math.sin(fovRadians / 2)) * 1.03
    : 0;

  if (!Number.isFinite(distance) || distance < requiredDistance) {
    return [{
      code: 'CAMERA_CLIPPING',
      message: `The fitted camera distance (${distance.toFixed(2)}) is too short for the scene radius (${bounds.radius.toFixed(2)}), so the visible render may clip parts.`
    }];
  }

  if (camera.maxDistance < distance || camera.minDistance > distance) {
    return [{
      code: 'CAMERA_CLIPPING',
      message: 'The fitted camera lies outside its zoom clamp, so the visible render framing cannot be trusted.'
    }];
  }

  return [];
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function compileConnectionRoute(
  connection: Pick<RenderPlan['connections'][number], 'from' | 'to'>,
  endpoints: Record<string, { x: number; y: number; z: number }>,
  index: number
) {
  const fromPoint = endpoints[renderEndpointKey(connection.from)];
  const toPoint = endpoints[renderEndpointKey(connection.to)];
  if (!fromPoint || !toPoint) {
    return undefined;
  }

  const fromTop = { x: fromPoint.x, y: fromPoint.y + 0.24, z: fromPoint.z };
  const toTop = { x: toPoint.x, y: toPoint.y + 0.24, z: toPoint.z };
  const span = Math.hypot(fromPoint.x - toPoint.x, fromPoint.z - toPoint.z);
  const laneOffset = ((index % 5) - 2) * 0.08;
  const peakLift = clampNumber(0.42 + span * 0.18, 0.55, 1.35);

  return [
    fromTop,
    {
      x: (fromTop.x + toTop.x) / 2,
      y: Math.max(fromTop.y, toTop.y) + peakLift,
      z: (fromTop.z + toTop.z) / 2 + laneOffset
    },
    toTop
  ];
}

function compileLabelLayout(renderParts: RenderPlan['parts']) {
  const labels: NonNullable<NonNullable<RenderPlan['layout']>['labels']> = {};
  const placedLabels: Array<NonNullable<NonNullable<RenderPlan['layout']>['labels']>[string]> = [];
  let repositionedLabelCount = 0;
  for (const part of renderParts) {
    const text = part.designator || compactLabelText(part.label || part.id);
    const footprint = part.footprint;
    const width = estimateLabelWidth(text, footprint);
    const baseLabel = {
      partId: part.id,
      text,
      width,
      height: width * 0.36
    };
    const { label: placedLabel, candidateIndex } = chooseLabelPlacement(part, baseLabel, renderParts, placedLabels);
    if (candidateIndex > 0) {
      repositionedLabelCount += 1;
    }
    labels[part.id] = placedLabel;
    placedLabels.push(placedLabel);
  }
  return { labels, repositionedLabelCount };
}

function chooseLabelPlacement(
  part: RenderPlan['parts'][number],
  label: Omit<NonNullable<NonNullable<RenderPlan['layout']>['labels']>[string], 'position'>,
  renderParts: RenderPlan['parts'],
  placedLabels: Array<NonNullable<NonNullable<RenderPlan['layout']>['labels']>[string]>
) {
  const candidates = labelPlacementCandidates(part, label);
  const candidateIndex = candidates.findIndex((candidate) =>
    !placedLabels.some((placed) => labelBoundsOverlap(candidate, placed, 0.04)) &&
    !renderParts.some((otherPart) =>
      otherPart.id !== part.id && labelOverlapsPart(candidate, otherPart, 0.02)
    )
  );
  if (candidateIndex >= 0) {
    return { label: candidates[candidateIndex], candidateIndex };
  }
  return { label: candidates[0], candidateIndex: 0 };
}

function labelPlacementCandidates(
  part: RenderPlan['parts'][number],
  label: Omit<NonNullable<NonNullable<RenderPlan['layout']>['labels']>[string], 'position'>
) {
  const footprint = part.footprint;
  const anchor = footprint?.labelAnchor ?? { x: 0, y: (footprint?.height ?? 0.2) + 0.24, z: 0 };
  const width = footprint?.width ?? 0.44;
  const depth = footprint?.depth ?? 0.32;
  const height = footprint?.height ?? 0.2;
  const lift = height + 0.34;
  const spacing = Math.max(0.22, label.height + 0.08);
  const makeLabel = (offset: { x: number; y: number; z: number }) => ({
    ...label,
    position: {
      x: part.position.x + offset.x,
      y: part.position.y + offset.y,
      z: part.position.z + offset.z
    }
  });

  return [
    makeLabel(anchor),
    makeLabel({ x: 0, y: lift, z: -depth / 2 - spacing }),
    makeLabel({ x: 0, y: lift, z: depth / 2 + spacing }),
    makeLabel({ x: -width / 2 - label.width / 2 - spacing, y: lift, z: 0 }),
    makeLabel({ x: width / 2 + label.width / 2 + spacing, y: lift, z: 0 }),
    makeLabel({ x: 0, y: lift + 0.22, z: 0 }),
    makeLabel({ x: -width / 2 - label.width / 2 - spacing, y: lift + 0.22, z: -depth / 2 - spacing }),
    makeLabel({ x: width / 2 + label.width / 2 + spacing, y: lift + 0.22, z: depth / 2 + spacing })
  ];
}

function compactLabelText(label: string) {
  return label.trim().split(/\s+/).slice(0, 2).join(' ') || 'Part';
}

function estimateLabelWidth(text: string, footprint?: RenderFootprintEntry) {
  const textWidth = text.length * 0.085 + 0.16;
  const footprintWidth = footprint ? Math.max(0.32, Math.min(0.9, footprint.width * 0.72)) : 0.44;
  return clampNumber(Math.max(0.32, Math.min(1.1, textWidth), footprintWidth), 0.32, 1.1);
}

function auditLabelLayout(
  renderParts: RenderPlan['parts'],
  labels: NonNullable<NonNullable<RenderPlan['layout']>['labels']>
): RenderWarning[] {
  const warnings: RenderWarning[] = [];
  const labelEntries = Object.values(labels);

  for (let leftIndex = 0; leftIndex < labelEntries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < labelEntries.length; rightIndex += 1) {
      const left = labelEntries[leftIndex];
      const right = labelEntries[rightIndex];
      if (!labelBoundsOverlap(left, right, 0.04)) {
        continue;
      }
      warnings.push({
        code: 'LABEL_OVERLAP',
        componentId: left.partId,
        message: `${left.text} label overlaps ${right.text} label; the scene remains visible, but label placement needs repair for a polished render.`
      });
    }
  }

  for (const label of labelEntries) {
    for (const part of renderParts) {
      if (part.id === label.partId || !part.footprint || part.footprint.type === 'wire') {
        continue;
      }
      if (!labelOverlapsPart(label, part, 0.02)) {
        continue;
      }
      warnings.push({
        code: 'LABEL_OVERLAP',
        componentId: label.partId,
        message: `${label.text} label overlaps ${part.label}; the scene remains visible, but label placement needs repair for a polished render.`
      });
    }
  }

  return warnings;
}

function labelBoundsOverlap(
  left: NonNullable<NonNullable<RenderPlan['layout']>['labels']>[string],
  right: NonNullable<NonNullable<RenderPlan['layout']>['labels']>[string],
  gap: number
) {
  const leftBounds = labelBounds(left, gap);
  const rightBounds = labelBounds(right, gap);
  return leftBounds.minX < rightBounds.maxX
    && leftBounds.maxX > rightBounds.minX
    && leftBounds.minZ < rightBounds.maxZ
    && leftBounds.maxZ > rightBounds.minZ;
}

function labelOverlapsPart(
  label: NonNullable<NonNullable<RenderPlan['layout']>['labels']>[string],
  part: RenderPlan['parts'][number],
  gap: number
) {
  if (!part.footprint) {
    return false;
  }
  const labelBox = labelBounds(label, gap);
  const partBox = footprintBounds(part.position, part.footprint);
  return labelBox.minX < partBox.maxX
    && labelBox.maxX > partBox.minX
    && labelBox.minZ < partBox.maxZ
    && labelBox.maxZ > partBox.minZ;
}

function labelBounds(
  label: NonNullable<NonNullable<RenderPlan['layout']>['labels']>[string],
  gap: number
) {
  const depth = Math.max(0.14, label.height * 0.8);
  return {
    minX: label.position.x - label.width / 2 - gap,
    maxX: label.position.x + label.width / 2 + gap,
    minZ: label.position.z - depth / 2 - gap,
    maxZ: label.position.z + depth / 2 + gap
  };
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

    if (distanceBetween(fromPoint, toPoint) < 0.08 && fromKey === toKey) {
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
      !requiresStrictBreadboardGridAudit(footprint)
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
      !requiresStrictBreadboardGridAudit(footprint)
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
      !requiresStrictBreadboardGridAudit(footprint)
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
      !requiresStrictBreadboardGridAudit(footprint)
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
      !requiresStrictBreadboardGridAudit(footprint)
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

    if (!requiresBreadboardSurfaceForPlacement(footprint)) {
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

function auditPartCollisions(renderParts: RenderPlan['parts']): RenderWarning[] {
  const warnings: RenderWarning[] = [];
  for (let leftIndex = 0; leftIndex < renderParts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < renderParts.length; rightIndex += 1) {
      const left = renderParts[leftIndex];
      const right = renderParts[rightIndex];
      if (renderPartsCanShareFootprintArea(left, right)) {
        continue;
      }
      if (!renderPartFootprintsOverlap(left, right, 0.03)) {
        continue;
      }
      warnings.push({
        code: 'PART_COLLISION',
        componentId: left.id,
        message: `${left.label} overlaps ${right.label} in the render footprint layout, so the visual placement cannot be trusted.`
      });
    }
  }
  return warnings;
}

function renderPartsCanShareFootprintArea(
  left: RenderPlan['parts'][number],
  right: RenderPlan['parts'][number]
) {
  if (!left.footprint || !right.footprint) {
    return true;
  }
  if (left.footprint.type === 'wire' || right.footprint.type === 'wire') {
    return true;
  }
  if (isPlacementSurfaceFootprint(left.footprint) && isPlacementSurfaceFootprint(right.footprint)) {
    return true;
  }
  return isBreadboardSurfacePair(left, right) || isBreadboardSurfacePair(right, left);
}

function isPlacementSurfaceFootprint(footprint: RenderFootprintEntry) {
  const shape = footprint.visualStyle.shape.toLowerCase();
  return footprint.type === 'breadboard'
    || shape === 'breadboard'
    || shape === 'perfboard'
    || shape === 'blank-pcb'
    || shape === 'proto-shield';
}

function isBreadboardSurfacePair(
  surface: RenderPlan['parts'][number],
  mounted: RenderPlan['parts'][number]
) {
  const mountedFootprint = mounted.footprint;
  if (!mountedFootprint) {
    return false;
  }
  return surface.footprint?.type === 'breadboard'
    && (
      mountedFootprint.placement.breadboardCompatible ||
      mountedFootprint.placement.allowedSurfaces.includes('breadboard')
    );
}

function renderPartFootprintsOverlap(
  left: RenderPlan['parts'][number],
  right: RenderPlan['parts'][number],
  gap: number
) {
  if (!left.footprint || !right.footprint) {
    return false;
  }
  const leftBounds = footprintBounds(left.position, left.footprint);
  const rightBounds = footprintBounds(right.position, right.footprint);
  return leftBounds.minX < rightBounds.maxX + gap
    && leftBounds.maxX + gap > rightBounds.minX
    && leftBounds.minZ < rightBounds.maxZ + gap
    && leftBounds.maxZ + gap > rightBounds.minZ;
}

function requiresBreadboardSurfaceForPlacement(footprint: RenderFootprintEntry) {
  return footprint.placement.breadboardCompatible
    && !footprint.placement.allowedSurfaces.some((surface) =>
      surface === 'stage' || surface === 'beside-breadboard'
    );
}

function requiresStrictBreadboardGridAudit(footprint: RenderFootprintEntry) {
  if (!requiresBreadboardSurfaceForPlacement(footprint)) {
    return false;
  }
  return [
    'button',
    'ceramic-capacitor',
    'electrolytic-capacitor',
    'led',
    'resistor'
  ].includes(footprint.type);
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
  breadboardGrid?: Awaited<ReturnType<typeof loadBreadboardGrid>>,
  options: { useExplicitPositionHints?: boolean } = {}
) {
  const useExplicitPositionHints = options.useExplicitPositionHints ?? true;
  const positions = new Map<string, { x: number; y: number; z: number }>();
  const breadboard = entries.find((entry) => entry.footprint?.type === 'breadboard');
  const breadboardPosition = useExplicitPositionHints
    ? breadboard?.component.position ?? { x: 0, y: 0, z: 0 }
    : { x: 0, y: 0, z: 0 };
  const breadboardFootprint = breadboard?.footprint;

  for (const entry of entries) {
    if (useExplicitPositionHints && entry.component.position) {
      positions.set(entry.component.id, entry.component.position);
    } else if (entry.footprint?.type === 'breadboard') {
      positions.set(entry.component.id, breadboardPosition);
    } else if (entry.footprint?.type === 'arduino') {
      positions.set(entry.component.id, breadboardFootprint
        ? positionLeftOfFootprint(breadboardPosition, breadboardFootprint, entry.footprint, 0.28)
        : { x: -1.8, y: 0.28, z: 0.1 });
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
  let stageCursorZ = boardBounds.minZ;
  let stageColumnX = boardBounds.maxX + 0.45;
  let stageColumnWidth = 0;

  for (const entry of entries) {
    const footprint = entry.footprint;
    if (!footprint || positions.has(entry.component.id) || !shouldPlaceBesideBreadboard(footprint)) {
      continue;
    }

    if (
      stageCursorZ > boardBounds.minZ &&
      stageCursorZ + footprint.depth > boardBounds.maxZ
    ) {
      stageColumnX += stageColumnWidth + 0.45;
      stageCursorZ = boardBounds.minZ;
      stageColumnWidth = 0;
    }

    const depth = boardBounds.maxZ - boardBounds.minZ;
    const position = {
      x: stageColumnX + footprint.width / 2,
      y: Math.max(0.25, footprint.height / 2),
      z: footprint.depth > depth
        ? breadboardPosition.z
        : stageCursorZ + footprint.depth / 2
    };
    positions.set(entry.component.id, position);
    stageCursorZ = position.z + footprint.depth / 2 + gap;
    stageColumnWidth = Math.max(stageColumnWidth, footprint.width);
  }

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

    if (cursorX + footprint.width > boardBounds.maxX - margin) {
      cursorX = boardBounds.minX + margin;
      cursorZ += rowDepth + gap;
      rowDepth = 0;
    }

    const preferredPosition = {
      x: cursorX + footprint.width / 2,
      y: breadboardPosition.y + breadboardFootprint.height + 0.07,
      z: cursorZ + footprint.depth / 2
    };
    const placedPosition = findNonOverlappingBreadboardPlacement({
      preferredPosition,
      footprint,
      boardBounds,
      margin,
      gap,
      breadboardGrid,
      placedBreadboardParts
    }) ?? snapBreadboardPosition(preferredPosition, footprint, breadboardGrid);

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

function shouldPlaceBesideBreadboard(footprint: RenderFootprintEntry) {
  if (footprint.type === 'breadboard' || footprint.type === 'wire') {
    return false;
  }
  const surfaces = footprint.placement.allowedSurfaces;
  return surfaces.includes('beside-breadboard') ||
    (surfaces.includes('stage') && !surfaces.includes('breadboard'));
}

function findNonOverlappingBreadboardPlacement({
  preferredPosition,
  footprint,
  boardBounds,
  margin,
  gap,
  breadboardGrid,
  placedBreadboardParts
}: {
  preferredPosition: { x: number; y: number; z: number };
  footprint: RenderFootprintEntry;
  boardBounds: ReturnType<typeof footprintBounds>;
  margin: number;
  gap: number;
  breadboardGrid: Awaited<ReturnType<typeof loadBreadboardGrid>> | undefined;
  placedBreadboardParts: Array<{
    position: { x: number; y: number; z: number };
    footprint: RenderFootprintEntry;
  }>;
}) {
  const xStep = breadboardGrid?.signalArea.xPitch ?? Math.max(0.2, gap / 2);
  const zStep = 0.2;
  const candidates: Array<{
    position: { x: number; y: number; z: number };
    distance: number;
  }> = [];
  const seen = new Set<string>();
  const rawXValues = scanValues(
    boardBounds.minX + margin + footprint.width / 2,
    boardBounds.maxX - margin - footprint.width / 2,
    xStep
  );
  const rawZValues = scanValues(
    boardBounds.minZ + margin + footprint.depth / 2,
    boardBounds.maxZ - margin - footprint.depth / 2,
    zStep
  );

  for (const rawZ of rawZValues) {
    for (const rawX of rawXValues) {
      const position = snapBreadboardPosition({
        x: rawX,
        y: preferredPosition.y,
        z: rawZ
      }, footprint, breadboardGrid);
      const key = `${position.x.toFixed(3)}:${position.z.toFixed(3)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      candidates.push({
        position,
        distance: Math.hypot(position.x - preferredPosition.x, position.z - preferredPosition.z)
      });
    }
  }

  return candidates
    .sort((a, b) => a.distance - b.distance)
    .map((candidate) => candidate.position)
    .find((position) =>
      footprintBoundsFitInside(position, footprint, boardBounds) &&
      !placementOverlaps(position, footprint, placedBreadboardParts, 0.03)
    ) ?? null;
}

function scanValues(start: number, end: number, step: number) {
  const values: number[] = [];
  for (let value = start; value <= end + 0.001; value += step) {
    values.push(Number(value.toFixed(6)));
  }
  if (values.length === 0 || Math.abs(values[values.length - 1] - end) > 0.001) {
    values.push(Number(end.toFixed(6)));
  }
  return uniqueNumbers(values);
}

function positionLeftOfFootprint(
  surfacePosition: RenderPlan['parts'][number]['position'],
  surfaceFootprint: RenderFootprintEntry,
  footprint: RenderFootprintEntry,
  y: number,
  margin = 0.45
) {
  const surfaceBounds = footprintBounds(surfacePosition, surfaceFootprint);
  return {
    x: surfaceBounds.minX - margin - footprint.width / 2,
    y,
    z: surfacePosition.z
  };
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
  if (!grid || !requiresStrictBreadboardGridAudit(footprint)) {
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
  const gridValues: number[] = [];
  for (let value = start; value <= end + pitch / 2; value += pitch) {
    gridValues.push(nearestGridValue(value, start, end, pitch));
  }
  const candidates = uniqueNumbers(anchorOffsets.flatMap((offset) =>
    gridValues.map((value) => value - offset)
  ));
  return bestSnapCenter(center, anchorOffsets, candidates, (value) =>
    Math.abs(value - nearestGridValue(value, start, end, pitch))
  );
}

function snapCenterToGridRows(center: number, anchorOffsets: number[], rows: number[]) {
  const candidates = uniqueNumbers(anchorOffsets.flatMap((offset) =>
    rows.map((row) => row - offset)
  ));
  return bestSnapCenter(center, anchorOffsets, candidates, (value) =>
    Math.min(...rows.map((row) => Math.abs(value - row)))
  );
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values.map((value) => Number(value.toFixed(6))))];
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
    .sort((a, b) => Math.abs(a.score - b.score) > 0.000001
      ? a.score - b.score
      : a.movement - b.movement
    )[0]?.candidate ?? center;
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

  return `signal-continuity:${signalBankForRow(nearestRow.id)}:${nearestX.toFixed(2)}`;
}

function signalBankForRow(rowId: string) {
  if (rowId.startsWith('upper')) {
    return 'upper-bank';
  }
  if (rowId.startsWith('lower')) {
    return 'lower-bank';
  }
  return rowId;
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
    matrix_input_state: 'key or switch state changes',
    joystick_position_state: 'joystick position changes',
    rotary_encoder_state: 'encoder count changes',
    analog_pwm_dimmer: 'brightness follows knob',
    analog_threshold: 'threshold-controlled',
    display_sensor_value: 'sensor value displayed',
    digital_input_state: 'input state changes',
    bare_seven_segment_display_state: 'selected segments lit',
    display_static_text: 'shows text',
    digital_on_off: 'on or blinking',
    blink_timer: 'on or blinking',
    buzzer_pulse: 'beeping',
    low_side_switched_load_state: 'switched load state changes',
    hbridge_motor_state: 'motor direction changes',
    relay_switch_state: 'relay contact state changes',
    stepper_motor_state: 'stepper position changes',
    servo_angle: 'moves angle',
    low_voltage_power_rail_state: 'low-voltage rail energized',
    regulated_5v_rail_state: 'regulated 5V rail available',
    passive_protection_context_state: 'passive context visible',
    timing_passive_context_state: 'timing reference visible',
    prototyping_surface_context_state: 'prototyping surface visible',
    connector_wiring_context_state: 'connector context visible',
    controller_board_context_state: 'controller board pin map visible'
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

async function simulationRequiredPathWarnings(
  spec: CircuitSpec,
  validationReport: ValidationReport,
  currentPaths: CurrentPath[]
) {
  const requiredIds = requiredCurrentPathIdsForSimulation(spec, validationReport);
  if (requiredIds.length === 0) {
    return [];
  }

  const currentPathIds = new Set(currentPaths.map((path) => path.id));
  return requiredIds
    .filter((id) => !currentPathIds.has(id) && ![...currentPathIds].some((pathId) => pathId.startsWith(`${id}:`)))
    .map((id) => `SIMULATION_REQUIRED_PATH_MISSING: ${id} was required by ${validationReport.electricalAnalysis?.topologyTemplateId ?? 'unknown topology'} but was not validated for rendering.`);
}

function requiredCurrentPathIdsForSimulation(spec: CircuitSpec, validationReport: ValidationReport) {
  const topologyTemplateId = validationReport.electricalAnalysis?.topologyTemplateId;
  const topologyId = typeof topologyTemplateId === 'string' ? topologyTemplateId : undefined;
  const analogSensorIds = spec.components
    .filter((component) => ANALOG_SENSOR_MODULE_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const resistiveSensorIds = spec.components
    .filter((component) => RESISTIVE_SENSOR_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const displayId = findI2cTextDisplayComponent(spec)?.id;
  const digitalInputIds = spec.components
    .filter((component) => DIGITAL_INPUT_STATE_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const singleWireSensorComponents = spec.components
    .filter((component) => SINGLE_WIRE_SENSOR_PART_IDS.has(component.partId));
  const protocolSensorIds = spec.components
    .filter((component) => WP10_PROTOCOL_SENSOR_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const communicationModuleIds = spec.components
    .filter((component) => COMMUNICATION_MODULE_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const logicInterfaceIds = spec.components
    .filter((component) => LOGIC_INTERFACE_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const matrixInputComponents = spec.components.filter((component) => MATRIX_INPUT_PART_IDS.has(component.partId));
  const joystickIds = spec.components
    .filter((component) => JOYSTICK_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const rotaryEncoderIds = spec.components
    .filter((component) => ROTARY_ENCODER_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const ledArrayDisplayComponents = findLedArrayDisplayComponents(spec);
  const bareSevenSegmentDisplayComponents = findBareSevenSegmentDisplayComponents(spec);
  const addressableLedDisplayIds = findAddressableLedDisplayComponents(spec)
    .map((component) => component.id);
  const spiDisplayComponents = findSpiDisplayComponents(spec);
  const rgbLedComponents = findRgbLedComponents(spec);
  const poweredLightModuleIds = findPoweredLightModuleComponents(spec)
    .map((component) => component.id);
  const lowSideLoadIds = spec.components
    .filter((component) => LOW_SIDE_LOAD_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const stepperMotorIds = spec.components
    .filter((component) => STEPPER_MOTOR_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const hbridgeMotorIds = spec.components
    .filter((component) => HBRIDGE_MOTOR_LOAD_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const relayModuleIds = spec.components
    .filter((component) => RELAY_MODULE_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const poweredDigitalInputIds = spec.components
    .filter((component) => POWERED_DIGITAL_SENSOR_PART_IDS.has(component.partId) || PULSE_DIGITAL_SENSOR_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const pulseDigitalInputIds = spec.components
    .filter((component) => PULSE_DIGITAL_SENSOR_PART_IDS.has(component.partId))
    .map((component) => component.id);

  if (
    topologyId === 'external-low-voltage-power-rail'
    || topologyId === 'regulated-5v-rail'
    || topologyId === 'controller-board-pin-map-substitution'
    || topologyId === 'controller-voltage-domain-policy'
    || topologyId === 'prototyping-surface-context-only'
    || topologyId === 'connector-wiring-context-only'
  ) {
    return [];
  }

  if (topologyId === 'controller-matrix-input-display' && displayId) {
    return unique([
      ...matrixInputComponents.flatMap((component) => requiredMatrixCurrentPathIds(spec, component)),
      `matrix-input-display-bus-activity:${displayId}`,
      'oled-module-current'
    ]);
  }

  if (topologyId === 'controller-dual-analog-input-display' && displayId) {
    return unique([
      ...joystickIds.flatMap((joystickId) => [
        `joystick-supply-current:${joystickId}`,
        `joystick-x-analog-signal:${joystickId}`,
        `joystick-y-analog-signal:${joystickId}`,
        `joystick-switch-signal:${joystickId}`
      ]),
      `joystick-display-bus-activity:${displayId}`,
      'oled-module-current'
    ]);
  }

  if (topologyId === 'controller-quadrature-input-display' && displayId) {
    return unique([
      ...rotaryEncoderIds.flatMap((encoderId) => [
        `rotary-encoder-supply-current:${encoderId}`,
        `rotary-encoder-clk-signal:${encoderId}`,
        `rotary-encoder-dt-signal:${encoderId}`,
        `rotary-encoder-switch-signal:${encoderId}`
      ]),
      `rotary-encoder-display-bus-activity:${displayId}`,
      'oled-module-current'
    ]);
  }

  if (
    (topologyId === 'controller-digital-input-display' || topologyId === 'controller-pulse-digital-sensor-display')
    && displayId
  ) {
    return unique([
      ...poweredDigitalInputIds.map((sensorId) => `digital-input-supply-current:${sensorId}`),
      ...digitalInputIds
        .filter((sensorId) => !pulseDigitalInputIds.includes(sensorId))
        .map((sensorId) => `digital-input-signal:${sensorId}`),
      ...pulseDigitalInputIds.map((sensorId) => `pulse-digital-input-signal:${sensorId}`),
      `digital-input-display-bus-activity:${displayId}`,
      'oled-module-current'
    ]);
  }

  if (topologyId === 'controller-digital-input-output') {
    return unique([
      ...poweredDigitalInputIds.map((sensorId) => `digital-input-supply-current:${sensorId}`),
      ...digitalInputIds
        .filter((sensorId) => !pulseDigitalInputIds.includes(sensorId))
        .map((sensorId) => `digital-input-signal:${sensorId}`),
      ...pulseDigitalInputIds.map((sensorId) => `pulse-digital-input-signal:${sensorId}`),
      'led-forward-current'
    ]);
  }

  if (topologyId === 'controller-resistive-sensor-divider-i2c-display' && displayId) {
    return unique([
      ...resistiveSensorIds.flatMap((sensorId) => [
        `resistive-sensor-divider-current:${sensorId}`,
        `resistive-sensor-analog-signal:${sensorId}`
      ]),
      `resistive-sensor-display-bus-activity:${displayId}`,
      'oled-module-current'
    ]);
  }

  if (topologyId === 'controller-resistive-sensor-divider-threshold-output') {
    return unique([
      ...resistiveSensorIds.flatMap((sensorId) => [
        `resistive-threshold-sensing-divider:${sensorId}`,
        `resistive-threshold-analog-signal:${sensorId}`
      ]),
      'led-forward-current'
    ]);
  }

  if (topologyId === 'controller-analog-sensor-i2c-display' && displayId) {
    return unique([
      ...analogSensorIds.flatMap((sensorId) => [
        `analog-sensor-supply-current:${sensorId}`,
        `analog-sensor-analog-signal:${sensorId}`
      ]),
      `analog-sensor-display-bus-activity:${displayId}`,
      'oled-module-current'
    ]);
  }

  if (topologyId === 'controller-single-wire-sensor-i2c-display' && displayId) {
    return unique([
      ...singleWireSensorComponents.flatMap((component) => {
        const pathIds = singleWireCurrentPathIds(component.partId, component.id, displayId);
        return [pathIds.supply, pathIds.data];
      }),
      ...singleWireSensorComponents.map((component) => singleWireCurrentPathIds(component.partId, component.id, displayId).display),
      'oled-module-current'
    ]);
  }

  if (
    [
      'controller-i2c-sensor-display',
      'controller-clocked-data-sensor-i2c-display',
      'controller-spi-sensor-display',
      'controller-uart-sensor-display'
    ].includes(topologyId ?? '')
    && displayId
  ) {
    return unique([
      ...protocolSensorIds.flatMap((sensorId) => [
        `protocol-sensor-supply-current:${sensorId}`,
        `protocol-sensor-bus-activity:${sensorId}`
      ]),
      `protocol-sensor-display-bus-activity:${displayId}`,
      'oled-module-current'
    ]);
  }

  if (
    [
      'controller-uart-communication-module',
      'controller-spi-communication-module',
      'controller-differential-bus-module'
    ].includes(topologyId ?? '')
    && displayId
  ) {
    return unique([
      ...communicationModuleIds.flatMap((moduleId) => [
        `communication-module-supply-current:${moduleId}`,
        `communication-module-bus-activity:${moduleId}`
      ]),
      `communication-module-display-bus-activity:${displayId}`,
      'oled-module-current'
    ]);
  }

  if (
    [
      'controller-logic-interface-context',
      'controller-i2c-interface-context',
      'controller-spi-interface-context',
      'controller-analog-timing-interface-context'
    ].includes(topologyId ?? '')
    && displayId
  ) {
    return unique([
      ...logicInterfaceIds.flatMap((interfaceId) => [
        `logic-interface-supply-current:${interfaceId}`,
        `logic-interface-signal-activity:${interfaceId}`
      ]),
      `logic-interface-display-bus-activity:${displayId}`,
      'oled-module-current'
    ]);
  }

  if (topologyId === 'level-shifted-i2c-bus') {
    return unique(logicInterfaceIds.flatMap((interfaceId) => [
      `logic-interface-supply-current:${interfaceId}`,
      `logic-interface-signal-activity:${interfaceId}`
    ]));
  }

  if (topologyId === 'controller-analog-threshold-output' || topologyId === 'controller-analog-sensor-threshold-output') {
    return unique([
      ...analogSensorIds.flatMap((sensorId) => [
        `analog-threshold-sensing-divider:${sensorId}`,
        `analog-threshold-analog-signal:${sensorId}`
      ]),
      'led-forward-current'
    ]);
  }

  if (topologyId === 'controller-led-array-display') {
    return unique(ledArrayDisplayComponents.flatMap((component) =>
      requiredLedArrayDisplayCurrentPathIds(component)
    ));
  }

  if (topologyId === 'controller-bare-seven-segment-display') {
    return unique(bareSevenSegmentDisplayComponents.flatMap((component) =>
      requiredBareSevenSegmentCurrentPathIds(spec, component)
    ));
  }

  if (topologyId === 'controller-addressable-led-display') {
    return unique(addressableLedDisplayIds.flatMap((displayId) => [
      `addressable-led-supply-current:${displayId}`,
      `addressable-led-data-signal:${displayId}`
    ]));
  }

  if (topologyId === 'controller-spi-display') {
    return unique(spiDisplayComponents.flatMap((component) =>
      requiredSpiDisplayCurrentPathIds(component)
    ));
  }

  if (topologyId === 'controller-rgb-led-current-limited-output') {
    return unique(rgbLedComponents.flatMap((component) =>
      requiredRgbLedCurrentPathIds(spec, component)
    ));
  }

  if (topologyId === 'controller-powered-light-module-output') {
    return unique(poweredLightModuleIds.flatMap((moduleId) => [
      `powered-light-module-supply-current:${moduleId}`,
      `powered-light-module-control-signal:${moduleId}`
    ]));
  }

  if (topologyId === 'controller-pwm-actuator' || topologyId === 'controller-servo-external-power-warning') {
    return ['servo-supply-current', 'servo-pwm-signal'];
  }

  if (topologyId === 'controller-transistor-low-side-load' || topologyId === 'controller-mosfet-module-load') {
    return unique(lowSideLoadIds.flatMap((loadId) => [
      `low-side-load-supply-current:${loadId}`,
      `low-side-load-control-signal:${loadId}`
    ]));
  }

  if (topologyId === 'controller-uln2003-unipolar-stepper' || topologyId === 'controller-step-dir-bipolar-stepper') {
    return unique(stepperMotorIds.flatMap((motorId) => [
      `stepper-coil-current:${motorId}`,
      `stepper-control-signals:${motorId}`
    ]));
  }

  if (topologyId === 'controller-hbridge-dc-motor') {
    return unique(hbridgeMotorIds.flatMap((motorId) => [
      `hbridge-motor-current:${motorId}`,
      `hbridge-control-signals:${motorId}`
    ]));
  }

  if (topologyId === 'controller-relay-low-voltage-load') {
    return unique(relayModuleIds.flatMap((relayId) => [
      `relay-coil-control-signal:${relayId}`,
      `relay-contact-load-current:${relayId}`
    ]));
  }

  return [];
}

function singleWireCurrentPathIds(partId: string, componentId: string, displayId: string) {
  if (partId === 'dht11') {
    return {
      supply: `dht11-sensor-supply-current:${componentId}`,
      data: `dht11-data-signal:${componentId}`,
      display: `dht11-display-bus-activity:${displayId}`
    };
  }
  return {
    supply: `single-wire-sensor-supply-current:${componentId}`,
    data: `single-wire-sensor-data-signal:${componentId}`,
    display: `single-wire-sensor-display-bus-activity:${displayId}`
  };
}

function requiredLedArrayDisplayCurrentPathIds(component: CircuitSpec['components'][number]) {
  const requiredIds = [
    `led-array-display-supply-current:${component.id}`,
    `led-array-display-data-signal:${component.id}`,
    `led-array-display-clock-signal:${component.id}`
  ];
  if (component.partId === '8x8-matrix-max7219') {
    requiredIds.push(`led-array-display-select-signal:${component.id}`);
  }
  return requiredIds;
}

function requiredBareSevenSegmentCurrentPathIds(
  spec: CircuitSpec,
  component: CircuitSpec['components'][number]
) {
  return unique(spec.connections
    .flatMap((connection) => [connection.from, connection.to])
    .filter((endpoint) => endpoint.componentId === component.id && ['A', 'B', 'DP'].includes(endpoint.pin))
    .map((endpoint) => `bare-seven-segment-current:${component.id}:${endpoint.pin}`));
}

function requiredRgbLedCurrentPathIds(
  spec: CircuitSpec,
  component: CircuitSpec['components'][number]
) {
  return unique(spec.connections
    .flatMap((connection) => [connection.from, connection.to])
    .filter((endpoint) => endpoint.componentId === component.id && ['R', 'G', 'B'].includes(endpoint.pin))
    .map((endpoint) => `rgb-led-channel-current:${component.id}:${endpoint.pin}`));
}

function requiredSpiDisplayCurrentPathIds(component: CircuitSpec['components'][number]) {
  const requiredIds = [
    `spi-display-supply-current:${component.id}`,
    `spi-display-data-signal:${component.id}`,
    `spi-display-clock-signal:${component.id}`,
    `spi-display-select-signal:${component.id}`
  ];
  if (component.partId === 'tft-18') {
    requiredIds.push(`spi-display-control-signal:${component.id}:RS`);
  } else if (component.partId === 'nokia-5110') {
    requiredIds.push(`spi-display-control-signal:${component.id}:DC`);
  } else if (component.partId === 'epaper-213') {
    requiredIds.push(`spi-display-control-signal:${component.id}:RST`);
  }
  return requiredIds;
}

function requiredMatrixCurrentPathIds(spec: CircuitSpec, component: CircuitSpec['components'][number]) {
  if (component.partId === 'keypad-4x4') {
    return [
      ...['R1', 'R2', 'R3', 'R4'].map((pin) => `matrix-input-scan:${component.id}:${pin}`),
      ...['C1', 'C2', 'C3', 'C4'].map((pin) => `matrix-input-sense:${component.id}:${pin}`)
    ];
  }

  if (component.partId === 'dip-switch-4') {
    return [1, 2, 3, 4].map((index) => {
      const pair = [`S${index}A`, `S${index}B`];
      const signalPin = pair.find((pin) => findConnectionToControllerRole(spec, component.id, pin, 'digital-input')) ?? pair[0];
      return `matrix-input-signal:${component.id}:${signalPin}`;
    });
  }

  if (component.partId === 'membrane-keypad-1x4') {
    return ['K1', 'K2', 'K3', 'K4'].map((pin) => `matrix-input-signal:${component.id}:${pin}`);
  }

  return [];
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

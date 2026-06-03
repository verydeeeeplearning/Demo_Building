// validation.ts — extracted verbatim from circuitTools.ts (god-module split, Phase B).
// Pure relocation: no signatures or behavior changed. See PLAN_god_module_refactor.md.
import {
  getPartRegistry,
  loadCapabilityGraph,
  loadTopologyTemplates
} from '../../context/contextLayer.ts';
import {
  partFulfillsInputModality,
  partFulfillsOutputModality,
  requiresConcreteInputFulfillment,
  requiresConcreteOutputFulfillment
} from '../modalityFulfillment.ts';
import {
  type CapabilityGraphEntry,
  type CircuitSpec,
  CircuitSpecSchema,
  type ContextCoverageReport,
  type IntentSpecV2,
  type PartCapability,
  type TopologyTemplate,
  type ValidationReport,
  ValidationReportSchema
} from '../schemas.ts';
import {
  ADDRESSABLE_LED_DISPLAY_PART_IDS,
  ANALOG_DIMMER_INPUT_PART_IDS,
  ANALOG_SENSOR_MODULE_PART_IDS,
  ANALOG_TIMING_INTERFACE_PART_IDS,
  BARE_SEVEN_SEGMENT_DISPLAY_PART_IDS,
  BIPOLAR_STEPPER_MOTOR_PART_IDS,
  CLOCKED_DATA_SENSOR_PART_IDS,
  COMMUNICATION_MODULE_PART_IDS,
  CircuitEndpoint,
  DIFFERENTIAL_COMMUNICATION_MODULE_PART_IDS,
  DIGITAL_INPUT_STATE_PART_IDS,
  HBRIDGE_MOTOR_LOAD_PART_IDS,
  HBridgeMotorPath,
  I2C_LOGIC_INTERFACE_PART_IDS,
  I2C_PROTOCOL_SENSOR_PART_IDS,
  I2C_TEXT_DISPLAY_PART_IDS,
  JOYSTICK_PART_IDS,
  LED_ARRAY_DISPLAY_PART_IDS,
  LEVEL_SHIFTER_INTERFACE_PART_IDS,
  LOGIC_INTERFACE_PART_IDS,
  LOW_SIDE_DISCRETE_DRIVER_PART_IDS,
  LOW_SIDE_INTEGRATED_LOAD_PART_IDS,
  LOW_SIDE_LOAD_PART_IDS,
  LOW_SIDE_MOSFET_MODULE_PART_IDS,
  LowSideSwitchedLoadPath,
  MATRIX_INPUT_PART_IDS,
  MATRIX_KEYPAD_PART_IDS,
  PASSIVE_DIGITAL_SWITCH_PART_IDS,
  POWERED_LIGHT_MODULE_PART_IDS,
  PULSE_DIGITAL_SENSOR_PART_IDS,
  RELAY_MODULE_PART_IDS,
  RESISTIVE_SENSOR_PART_IDS,
  RESISTIVE_SENSOR_REFERENCE_RESISTOR_PART_IDS,
  RGB_LED_PART_IDS,
  ROTARY_ENCODER_PART_IDS,
  SHIFT_REGISTER_INTERFACE_PART_IDS,
  SINGLE_WIRE_SENSOR_PART_IDS,
  SPI_COMMUNICATION_MODULE_PART_IDS,
  SPI_DISPLAY_PART_IDS,
  SPI_LOGIC_INTERFACE_PART_IDS,
  SPI_PROTOCOL_SENSOR_PART_IDS,
  STEPPER_MOTOR_PART_IDS,
  STEP_DIR_STEPPER_DRIVER_PART_IDS,
  StepperMotorPath,
  UART_COMMUNICATION_MODULE_PART_IDS,
  UART_PROTOCOL_SENSOR_PART_IDS,
  ULN2003_STEPPER_DRIVER_PART_IDS,
  UNIPOLAR_STEPPER_MOTOR_PART_IDS,
  addEdge,
  bareSevenSegmentPins,
  buildEndpointGraph,
  compileCurrentPathsForContexts,
  componentIdsOnPathThroughAnyComponent,
  controllerOutputEndpointOnPath,
  digitalInputSignalPinForComponent,
  endpointFromKey,
  endpointKey,
  endpointReachesAnyControllerRole,
  endpointReachesAnyControllerRoleInGraph,
  endpointReachesControllerRole,
  findConnectedControllerEndpointWithAnyRole,
  findConnectionToControllerRole,
  firstPinNameForRole,
  hasI2cTextDisplay,
  hasRelayMainsLanguage,
  hasThresholdLanguage,
  hbridgeControlPins,
  hbridgePinContract,
  isGroundRole,
  isPowerRole,
  lowSideLoadPins,
  reachableEndpointKeys,
  relayInputPins,
  resolveRelayModulePaths,
  rgbLedChannelPins,
  roleFor,
  simulationContextsForSpec,
  unique
} from './shared.ts';

export async function selectTopologyTemplate(
  input: {
    capabilities?: CapabilityGraphEntry[];
    roleHints?: string[];
  } = {}
): Promise<TopologyTemplate | null> {
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
      warnings: [
        'Current-flow animation is blocked for unsupported requests; renderable parts may be shown as diagnostic context only.'
      ],
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

  if (
    spec.components.some((component) => ANALOG_DIMMER_INPUT_PART_IDS.has(component.partId)) &&
    !hasPwmLedOutputPath(spec, partsById, componentsById)
  ) {
    errors.push(
      'ANALOG_DIMMER_PWM_OUTPUT_MISSING: Potentiometer brightness control needs the LED series path to start from an Arduino PWM pin such as D9.'
    );
  }

  if (
    spec.components.some((component) => component.partId === 'photoresistor-ldr') &&
    !hasThresholdLanguage(spec)
  ) {
    errors.push(
      'ANALOG_THRESHOLD_BEHAVIOR_MISSING: Light sensor output needs an explicit threshold behavior such as dark -> LED on.'
    );
  }

  if (
    spec.components.some((component) => ANALOG_SENSOR_MODULE_PART_IDS.has(component.partId)) &&
    hasThresholdLanguage(spec) &&
    !hasAnalogThresholdOutputPath(spec, partsById, componentsById)
  ) {
    errors.push(
      'ANALOG_THRESHOLD_OUTPUT_MISSING: Analog sensor threshold circuits need a current-limited LED output path.'
    );
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
    warnings.push(
      'SERVO_HIGH_TORQUE_POWER_WARNING: High-torque servos such as MG996R are simulated qualitatively and need an external 5-6V supply with common ground in real builds.'
    );
  }

  for (const component of spec.components.filter((candidate) =>
    LOW_SIDE_LOAD_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `LOW_SIDE_LOAD_POWER_WARNING: ${component.label} is simulated qualitatively; real motor-like loads need current budgeting, suitable power, and common ground.`
    );
    if (!LOW_SIDE_INTEGRATED_LOAD_PART_IDS.has(component.partId)) {
      warnings.push(
        `INDUCTIVE_LOAD_FLYBACK_WARNING: ${component.label} requires real flyback/protection design outside this educational simulation.`
      );
    }
  }

  for (const component of spec.components.filter((candidate) =>
    STEPPER_MOTOR_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `STEPPER_POWER_WARNING: ${component.label} is simulated qualitatively; real stepper builds need a driver, suitable supply, common ground, and current-limit setup.`
    );
  }

  for (const component of spec.components.filter((candidate) =>
    STEPPER_DRIVER_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `STEPPER_DRIVER_QUALITATIVE_ONLY: ${component.label} is modeled as an educational driver path, not torque, heat, microstep, or current-limit sizing.`
    );
  }

  for (const component of spec.components.filter((candidate) =>
    HBRIDGE_MOTOR_LOAD_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `HBRIDGE_MOTOR_POWER_WARNING: ${component.label} is simulated qualitatively; real H-bridge motor builds need current budgeting, suitable power, common ground, and thermal design.`
    );
  }

  for (const component of spec.components.filter((candidate) =>
    HBRIDGE_DRIVER_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `HBRIDGE_DRIVER_QUALITATIVE_ONLY: ${component.label} is modeled as an educational direction-control driver path, not stall-current, torque, speed, heat, or braking physics.`
    );
  }

  for (const component of spec.components.filter((candidate) =>
    RELAY_MODULE_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `RELAY_LOW_VOLTAGE_ONLY_WARNING: ${component.label} is simulated only with low-voltage classroom loads; mains, outlets, and wall power are blocked.`
    );
  }

  for (const component of spec.components.filter((candidate) =>
    LOW_VOLTAGE_POWER_RAIL_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `LOW_VOLTAGE_POWER_RAIL_QUALITATIVE_ONLY: ${component.label} is modeled as a qualitative educational rail state, not a real current budget or power supply rating.`
    );
  }

  for (const component of spec.components.filter((candidate) =>
    LIPO_BATTERY_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `LIPO_POWER_WARNING: ${component.label} is modeled only as a declared low-voltage source; charging, shorting, puncturing, and high-current load design are blocked.`
    );
  }

  for (const component of spec.components.filter((candidate) =>
    VOLTAGE_REGULATOR_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `REGULATOR_QUALITATIVE_ONLY: ${component.label} is modeled as a qualitative 5V regulator path, not thermal, dropout, or current-limit analysis.`
    );
  }

  if (spec.components.some((component) => component.partId === 'laser-diode-module')) {
    warnings.push(
      'LASER_MODULE_SAFETY_WARNING: The laser module is simulated as a low-voltage classroom indicator; real lasers require eye-safety precautions.'
    );
  }

  for (const component of spec.components.filter((candidate) =>
    ANALOG_SENSOR_EDUCATIONAL_WARNING_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `ANALOG_SENSOR_EDUCATIONAL_ONLY: ${component.label} is modeled as a low-voltage educational signal source, not a safety alarm or protection device.`
    );
  }

  for (const component of spec.components.filter((candidate) =>
    RESISTIVE_SENSOR_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `RESISTIVE_SENSOR_QUALITATIVE_ONLY: ${component.label} is modeled as a qualitative divider input, not a calibrated force or temperature instrument.`
    );
  }

  for (const component of spec.components.filter((candidate) =>
    PASSIVE_PROTECTION_CONTEXT_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `PASSIVE_CONTEXT_STATE_ONLY: ${component.label} is rendered as passive/protection context only; no active load current or real protection performance is simulated.`
    );
  }

  for (const component of spec.components.filter((candidate) =>
    TIMING_PASSIVE_CONTEXT_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `TIMING_PASSIVE_CONTEXT_ONLY: ${component.label} is rendered as timing context only; oscillator startup, waveform timing, and frequency accuracy are not simulated.`
    );
  }

  for (const component of spec.components.filter((candidate) =>
    PROTOTYPING_SURFACE_CONTEXT_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `PROTOTYPING_SURFACE_STATE_ONLY: ${component.label} is rendered as placement/build context only; it does not energize rails, create hidden nets, or imply solder bridges.`
    );
  }

  for (const component of spec.components.filter((candidate) =>
    CONNECTOR_WIRING_CONTEXT_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `CONNECTOR_CONTEXT_STATE_ONLY: ${component.label} is rendered as connector/wiring context only; it does not act as a voltage source or create a current path by itself.`
    );
  }

  for (const component of spec.components.filter((candidate) =>
    CONTROLLER_BOARD_CONTEXT_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `CONTROLLER_BOARD_CONTEXT_STATE_ONLY: ${component.label} is rendered as board-specific pin-map and voltage-domain context only; validated circuit substitution requires a circuit bundle that explicitly allows this controller.`
    );
    if (
      [
        'esp32-devkit',
        'esp8266-nodemcu',
        'raspberry-pi-pico',
        'stm32-bluepill',
        'teensy40'
      ].includes(component.partId)
    ) {
      warnings.push(
        `CONTROLLER_BOARD_3V3_DOMAIN: ${component.label} uses a 3.3V logic-domain context; do not assume 5V Arduino Uno GPIO compatibility.`
      );
    }
  }

  for (const component of spec.components.filter((candidate) =>
    LOGIC_INTERFACE_PART_IDS.has(candidate.partId)
  )) {
    if (LEVEL_SHIFTER_INTERFACE_PART_IDS.has(component.partId)) {
      warnings.push(
        `LEVEL_SHIFTER_CONTEXT_ONLY: ${component.label} is modeled as a single visible HV1/LV1 voltage-domain signal context, not a regulator or current booster.`
      );
    } else {
      warnings.push(
        `LOGIC_INTERFACE_QUALITATIVE_ONLY: ${component.label} is modeled as qualitative interface state, not precision analog, exact timing, hidden output-load, or chip-level electrical simulation.`
      );
    }
  }

  for (const component of spec.components.filter((candidate) =>
    DIGITAL_INPUT_STATE_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `DIGITAL_INPUT_QUALITATIVE_ONLY: ${component.label} is modeled as a qualitative active/inactive input state, not a calibrated sensor or decoded protocol.`
    );
  }

  for (const component of spec.components.filter((candidate) =>
    MATRIX_INPUT_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `MATRIX_INPUT_QUALITATIVE_ONLY: ${component.label} is modeled as qualitative key/switch state, not debounce timing or contact physics.`
    );
  }

  for (const component of spec.components.filter((candidate) =>
    JOYSTICK_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `JOYSTICK_QUALITATIVE_ONLY: ${component.label} is modeled as qualitative X/Y position and switch state, not calibrated force or HID behavior.`
    );
  }

  for (const component of spec.components.filter((candidate) =>
    ROTARY_ENCODER_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `ROTARY_ENCODER_QUALITATIVE_ONLY: ${component.label} is modeled as qualitative direction/count state, not contact bounce timing.`
    );
  }

  for (const component of spec.components.filter((candidate) =>
    partsById.get(candidate.partId)?.capabilities.includes('protocol-sensor')
  )) {
    warnings.push(
      `PROTOCOL_SENSOR_QUALITATIVE_ONLY: ${component.label} is modeled as a qualitative classroom readout; it is not a calibrated, certified, medical, navigation, tracking, payment, or security instrument.`
    );
  }

  for (const component of spec.components.filter((candidate) =>
    COMMUNICATION_MODULE_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `COMMUNICATION_MODULE_QUALITATIVE_ONLY: ${component.label} is modeled as local command/bus state only; real networking, pairing, RF range, SMS/calls, USB devices, vehicle networks, and backend services are outside this simulation.`
    );
    if (POWER_WARNING_COMMUNICATION_MODULE_PART_IDS.has(component.partId)) {
      warnings.push(
        `COMMUNICATION_MODULE_POWER_WARNING: ${component.label} needs real power budgeting and voltage-domain care outside the educational simulation.`
      );
    }
  }

  for (const component of spec.components.filter((candidate) =>
    BARE_SEVEN_SEGMENT_DISPLAY_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `BARE_SEVEN_SEGMENT_QUALITATIVE_ONLY: ${component.label} is modeled as qualitative current-limited segment state, not a full commercial package or multiplexed display.`
    );
  }

  for (const component of spec.components.filter((candidate) =>
    LED_ARRAY_DISPLAY_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `LED_ARRAY_DISPLAY_QUALITATIVE_ONLY: ${component.label} is modeled as a qualitative number or pattern display, not chip-accurate driver timing.`
    );
  }

  for (const component of spec.components.filter((candidate) =>
    ADDRESSABLE_LED_DISPLAY_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `ADDRESSABLE_LED_POWER_WARNING: ${component.label} is modeled at educational brightness; real full-brightness addressable LEDs may need external 5V power budgeting.`
    );
  }

  for (const component of spec.components.filter((candidate) =>
    SPI_DISPLAY_PART_IDS.has(candidate.partId)
  )) {
    warnings.push(
      `SPI_DISPLAY_QUALITATIVE_ONLY: ${component.label} is modeled as a qualitative display state, not pixel-perfect driver timing or framebuffer emulation.`
    );
  }

  const validatedCurrentPathIds = errors.length === 0 ? await inferCurrentPathIds(spec) : [];
  const topologyTemplate = errors.length === 0 ? await inferTopologyTemplateForSpec(spec) : null;

  return ValidationReportSchema.parse({
    status: errors.length === 0 ? 'valid' : 'invalid',
    errors: unique(errors),
    warnings: unique(warnings),
    validatedCurrentPathIds,
    electricalAnalysis: topologyTemplate
      ? {
          topologyTemplateId: topologyTemplate.id,
          topologyLabel: topologyTemplate.label,
          topologyRoles: topologyTemplate.requiredRoles,
          validationRules: topologyTemplate.validationRules
        }
      : undefined
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

  const coverageSummary =
    contextCoverage.warnings.length > 0
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
      ...disallowed.map(
        (component) =>
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
  // RC-F: a focused request co-matches sibling capabilities, so intentSpec.inputModalities is the
  // UNION of every matched capability's inputs (e.g. a joystick request unions analog-sensor +
  // digital-sensor + joystick). Requiring all of them conjunctively falsely rejects a correct
  // single-purpose circuit (the agent's joystick circuit rejected for missing analog-sensor it never
  // needed). Treat concrete INPUT modalities as a DISJUNCTION: when any concrete input is requested,
  // require >=1 to be fulfilled. OUTPUT modalities stay conjunctive (the deliverable must be present).
  // Dropping the input entirely still fails (0 fulfilled); this is strictly weaker than the old
  // conjunction, so it can only accept previously-false-rejected circuits, never regress a valid one.
  const concreteInputModalities = unique(intentSpec.inputModalities).filter(
    requiresConcreteInputFulfillment
  );
  const someInputFulfilled = concreteInputModalities.some((modality) =>
    usedParts.some((part) => partFulfillsInputModality(part, modality))
  );
  const missingInputModalities =
    concreteInputModalities.length === 0 || someInputFulfilled ? [] : concreteInputModalities;
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
      ...missingInputModalities.map(
        (modality) =>
          `INTENT_INPUT_NOT_FULFILLED: The student requested ${modality}, but the final circuit draft does not include a matching input part.`
      ),
      ...missingOutputModalities.map(
        (modality) =>
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

export function coverageAllowsValidCircuitSynthesis(contextCoverage: ContextCoverageReport) {
  if (contextCoverage.sufficientFor?.length > 0) {
    return contextCoverage.sufficientFor.includes('valid_circuit_synthesis');
  }

  return contextCoverage.status === 'sufficient';
}

export function isDirectPowerShort(
  connection: CircuitSpec['connections'][number],
  componentsById: Map<string, CircuitSpec['components'][number]>,
  partsById: Map<string, PartCapability>
) {
  const roles = [connection.from, connection.to].map((endpoint) => {
    const component = componentsById.get(endpoint.componentId);
    const part = component ? partsById.get(component.partId) : undefined;
    return part?.pins.find((pin) => pin.name === endpoint.pin)?.role;
  });
  return (
    roles.some((role) => isPowerRole(role ?? 'unknown')) &&
    roles.some((role) => isGroundRole(role ?? 'unknown'))
  );
}

export function isActiveLoad(part: PartCapability) {
  if (part.capabilities.includes('resistive-sensor')) {
    return false;
  }
  if (part.capabilities.includes('passive-matrix-input')) {
    return false;
  }
  return part.kind === 'output' || part.kind === 'input';
}

export function validateLedClosedSeriesPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const leds = spec.components.filter((component) => component.partId === 'led-5mm');
  const ledIdsBySeriesResistor = new Map<string, string[]>();
  const relayControlledLedIds = new Set(
    resolveRelayModulePaths(spec, partsById, componentsById)
      .map((path) => path.loadId)
      .filter((loadId): loadId is string => Boolean(loadId))
  );

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
      errors.push(
        `LED_CONTROLLER_SOURCE_MISSING: ${led.label} needs an Arduino digital or PWM output feeding the series path.`
      );
    }
    if (!path.hasAnodeEntry) {
      errors.push(
        `LED_SERIES_PATH_INCOMPLETE: ${led.label} anode is not connected through the current limiting path.`
      );
    }
    if (!path.hasSeriesResistor) {
      errors.push(
        `LED_RESISTOR_NOT_IN_SERIES: ${led.label} needs the current limiting resistor in series before the LED anode.`
      );
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
      errors.push(
        `LED_RESISTOR_SHARED: ${resistorId} is shared by multiple LEDs (${ledIds.join(', ')}). Give each LED its own current limiting resistor path.`
      );
    }
  }

  return unique(errors);
}

export function validateDirectLowCurrentLoadPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];

  for (const component of spec.components.filter((candidate) =>
    DIRECT_LOW_CURRENT_LOAD_PART_IDS.has(candidate.partId)
  )) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }
    const inputPin =
      firstPinNameForRole(
        part,
        (role) => role === 'positive' || role === 'digital-input' || role === 'input'
      ) ?? part.pins.find((pin) => !isGroundRole(pin.role))?.name;
    const groundPin = firstPinNameForRole(part, isGroundRole);

    if (
      !inputPin ||
      !endpointReachesAnyControllerRole(
        spec,
        `${component.id}:${inputPin}`,
        ['digital-output', 'pwm-output'],
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `DIRECT_LOAD_SIGNAL_MISSING: ${component.label} needs its driven pin connected to an Arduino digital output.`
      );
    }
    if (
      !groundPin ||
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${groundPin}`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `DIRECT_LOAD_GROUND_MISSING: ${component.label} needs a ground return to Arduino GND.`
      );
    }
  }

  return unique(errors);
}

export function validateRgbLedCurrentLimitedPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const graph = buildEndpointGraph(spec);
  const resistorIds = spec.components
    .filter((component) => component.partId === 'resistor-220')
    .map((component) => component.id);
  const controllerOutputs = controllerEndpointKeysWithRole(
    spec,
    ['digital-output', 'pwm-output'],
    partsById,
    componentsById
  );
  const channelIdsByResistor = new Map<string, string[]>();

  for (const component of spec.components.filter((candidate) =>
    RGB_LED_PART_IDS.has(candidate.partId)
  )) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }

    const groundPin = firstPinNameForRole(part, isGroundRole) ?? 'GND';
    const channelPins = rgbLedChannelPins(part);
    let validChannelPaths = 0;

    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${groundPin}`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `RGB_LED_GROUND_MISSING: ${component.label} common cathode must return to Arduino GND.`
      );
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

      const seriesResistorIds = componentIdsOnPathThroughAnyComponent(
        graph,
        controllerOutputs,
        channelKey,
        resistorIds
      );
      if (seriesResistorIds.length === 0) {
        errors.push(
          `RGB_LED_CHANNEL_RESISTOR_MISSING: ${component.label} channel ${pin} must be driven through its own 220 ohm resistor.`
        );
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
      errors.push(
        `RGB_LED_SIGNAL_MISSING: ${component.label} needs at least one R/G/B channel connected to an Arduino output through a 220 ohm resistor.`
      );
    }
  }

  for (const [resistorId, channelIds] of channelIdsByResistor.entries()) {
    if (channelIds.length > 1) {
      errors.push(
        `RGB_LED_RESISTOR_SHARED: ${resistorId} is shared by multiple RGB channels (${channelIds.join(', ')}). Give each driven channel its own current limiting resistor.`
      );
    }
  }

  return unique(errors);
}

export function validatePoweredLightModulePaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];

  for (const component of spec.components.filter((candidate) =>
    POWERED_LIGHT_MODULE_PART_IDS.has(candidate.partId)
  )) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }

    const powerPin = firstPinNameForRole(part, isPowerRole) ?? 'VCC';
    const groundPin = firstPinNameForRole(part, isGroundRole) ?? 'GND';
    const signalPin =
      firstPinNameForRole(
        part,
        (role) => role === 'digital-input' || role === 'data' || role === 'signal'
      ) ?? 'S';

    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${powerPin}`,
        'power',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `POWERED_LIGHT_POWER_MISSING: ${component.label} needs ${powerPin} connected to Arduino 5V.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${groundPin}`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `POWERED_LIGHT_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`
      );
    }
    if (
      !endpointReachesAnyControllerRole(
        spec,
        `${component.id}:${signalPin}`,
        ['digital-output', 'pwm-output'],
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `POWERED_LIGHT_SIGNAL_MISSING: ${component.label} needs ${signalPin} connected to an Arduino digital output pin.`
      );
    }
  }

  return unique(errors);
}

export function validateLowSideSwitchedLoadPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const graph = buildEndpointGraph(spec);
  const lowSideLoads = spec.components.filter((candidate) =>
    LOW_SIDE_LOAD_PART_IDS.has(candidate.partId)
  );
  const hasDiscreteDriver = spec.components.some((candidate) =>
    LOW_SIDE_DISCRETE_DRIVER_PART_IDS.has(candidate.partId)
  );
  const hasMosfetDriver = spec.components.some((candidate) =>
    LOW_SIDE_MOSFET_MODULE_PART_IDS.has(candidate.partId)
  );
  const hasHBridgeDriver = spec.components.some((candidate) =>
    HBRIDGE_DRIVER_PART_IDS.has(candidate.partId)
  );

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
      errors.push(
        `MOTOR_DIRECT_TO_GPIO: ${load.label} must not be driven directly from Arduino GPIO; use a transistor or MOSFET low-side driver.`
      );
    } else if (
      !hasDiscreteDriver &&
      !hasMosfetDriver &&
      !LOW_SIDE_INTEGRATED_LOAD_PART_IDS.has(load.partId)
    ) {
      errors.push(
        `LOW_SIDE_DRIVER_MISSING: ${load.label} needs a validated low-side transistor or MOSFET driver path.`
      );
    } else {
      errors.push(
        `LOW_SIDE_DRIVER_PATH_INVALID: ${load.label} needs power, switched return, driver control, and common ground on one validated low-side path.`
      );
    }

    if (
      hasDiscreteDriver &&
      hasTransistorBaseSignalWithoutResistor(spec, graph, partsById, componentsById)
    ) {
      errors.push(
        `LOW_SIDE_BASE_RESISTOR_MISSING: ${load.label} needs a resistor between the Arduino output and the 2N2222 base.`
      );
    }

    if (hasMosfetDriver && !hasMosfetModuleControlSignal(spec, partsById, componentsById)) {
      errors.push(
        `MOSFET_MODULE_SIGNAL_MISSING: ${load.label} needs the IRF520 SIG pin connected to an Arduino digital or PWM output.`
      );
    }
  }

  return unique(errors);
}

export function resolveLowSideSwitchedLoadPath(
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

  return (
    resolveMosfetModuleSwitchedLoadPath(spec, load, part, partsById, componentsById) ??
    resolveDiscreteTransistorSwitchedLoadPath(spec, load, part, partsById, componentsById)
  );
}

export function resolveIntegratedSwitchedLoadPath(
  spec: CircuitSpec,
  load: CircuitSpec['components'][number],
  part: PartCapability,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
): LowSideSwitchedLoadPath | null {
  const powerPin = firstPinNameForRole(part, isPowerRole) ?? 'VCC';
  const groundPin = firstPinNameForRole(part, isGroundRole) ?? 'GND';
  const signalPin =
    firstPinNameForRole(
      part,
      (role) => role === 'digital-input' || role === 'data' || role === 'signal'
    ) ?? 'IN';
  const hasPower = endpointReachesControllerRole(
    spec,
    `${load.id}:${powerPin}`,
    'power',
    partsById,
    componentsById
  );
  const hasGround = endpointReachesControllerRole(
    spec,
    `${load.id}:${groundPin}`,
    'ground',
    partsById,
    componentsById
  );
  const controlEndpoint = findConnectedControllerEndpointWithAnyRole(spec, load.id, signalPin, [
    'digital-output',
    'pwm-output'
  ]);

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

export function resolveMosfetModuleSwitchedLoadPath(
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

  for (const driver of spec.components.filter((candidate) =>
    LOW_SIDE_MOSFET_MODULE_PART_IDS.has(candidate.partId)
  )) {
    const hasDriverPower = endpointReachesControllerRole(
      spec,
      `${driver.id}:VIN`,
      'power',
      partsById,
      componentsById
    );
    const hasDriverGround = endpointReachesControllerRole(
      spec,
      `${driver.id}:GND`,
      'ground',
      partsById,
      componentsById
    );
    const controlEndpoint = findConnectedControllerEndpointWithAnyRole(spec, driver.id, 'SIG', [
      'digital-output',
      'pwm-output'
    ]);
    const loadHighConnected = reachableEndpointKeys(graph, [`${driver.id}:V+`]).has(
      `${load.id}:${highPin}`
    );
    const loadLowConnected = reachableEndpointKeys(graph, [`${driver.id}:V-`]).has(
      `${load.id}:${lowPin}`
    );

    if (
      hasDriverPower &&
      hasDriverGround &&
      controlEndpoint &&
      loadHighConnected &&
      loadLowConnected
    ) {
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

export function resolveDiscreteTransistorSwitchedLoadPath(
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

  for (const driver of spec.components.filter((candidate) =>
    LOW_SIDE_DISCRETE_DRIVER_PART_IDS.has(candidate.partId)
  )) {
    const hasLoadPower = endpointReachesControllerRole(
      spec,
      `${load.id}:${highPin}`,
      'power',
      partsById,
      componentsById
    );
    const loadLowConnected = reachableEndpointKeys(graph, [`${driver.id}:C`]).has(
      `${load.id}:${lowPin}`
    );
    const hasEmitterGround = endpointReachesControllerRole(
      spec,
      `${driver.id}:E`,
      'ground',
      partsById,
      componentsById
    );
    const controlEndpoint = controllerOutputEndpointOnPath(
      graph,
      controllerOutputs,
      `${driver.id}:B`
    );
    const baseResistorIds = componentIdsOnPathThroughAnyComponent(
      graph,
      controllerOutputs,
      `${driver.id}:B`,
      resistorIds
    );

    if (
      hasLoadPower &&
      loadLowConnected &&
      hasEmitterGround &&
      controlEndpoint &&
      baseResistorIds.length > 0
    ) {
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

export function hasTransistorBaseSignalWithoutResistor(
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
      const baseResistorIds = componentIdsOnPathThroughAnyComponent(
        graph,
        controllerOutputs,
        baseKey,
        resistorIds
      );
      return hasBaseSignal && baseResistorIds.length === 0;
    });
}

export function hasMosfetModuleControlSignal(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  return spec.components
    .filter((component) => LOW_SIDE_MOSFET_MODULE_PART_IDS.has(component.partId))
    .some((driver) =>
      endpointReachesAnyControllerRole(
        spec,
        `${driver.id}:SIG`,
        ['digital-output', 'pwm-output'],
        partsById,
        componentsById
      )
    );
}

export function validateStepperMotorPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const graph = buildEndpointGraph(spec);
  const stepperMotors = spec.components.filter((candidate) =>
    STEPPER_MOTOR_PART_IDS.has(candidate.partId)
  );
  const hasStepperDriver = spec.components.some((candidate) =>
    STEPPER_DRIVER_PART_IDS.has(candidate.partId)
  );

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
      errors.push(
        `STEPPER_DIRECT_TO_GPIO: ${motor.label} coils must not be driven directly from Arduino GPIO; use a ULN2003, A4988, or DRV8825 driver.`
      );
    } else if (!hasStepperDriver) {
      errors.push(
        `STEPPER_DRIVER_MISSING: ${motor.label} needs a validated stepper driver module.`
      );
    } else {
      errors.push(
        `STEPPER_DRIVER_PATH_INVALID: ${motor.label} needs driver power, common ground, control signals, and all required phase/coil lines.`
      );
    }
  }

  for (const driver of spec.components.filter((candidate) =>
    STEP_DIR_STEPPER_DRIVER_PART_IDS.has(candidate.partId)
  )) {
    const hasStep = Boolean(
      findConnectedControllerEndpointWithAnyRole(spec, driver.id, 'STEP', [
        'digital-output',
        'pwm-output'
      ])
    );
    const hasDir = Boolean(
      findConnectedControllerEndpointWithAnyRole(spec, driver.id, 'DIR', [
        'digital-output',
        'pwm-output'
      ])
    );
    if (!hasStep || !hasDir) {
      errors.push(
        `STEPPER_STEP_DIR_MISSING: ${driver.label} needs both STEP and DIR connected to Arduino digital outputs.`
      );
    }
  }

  return unique(errors);
}

export function resolveStepperMotorPath(
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

export function resolveUnipolarStepperPath(
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

  for (const driver of spec.components.filter((candidate) =>
    ULN2003_STEPPER_DRIVER_PART_IDS.has(candidate.partId)
  )) {
    const hasDriverPower = endpointReachesControllerRole(
      spec,
      `${driver.id}:VCC`,
      'power',
      partsById,
      componentsById
    );
    const hasMotorPower = endpointReachesControllerRole(
      spec,
      `${motor.id}:VCC`,
      'power',
      partsById,
      componentsById
    );
    const hasDriverGround = endpointReachesControllerRole(
      spec,
      `${driver.id}:GND`,
      'ground',
      partsById,
      componentsById
    );
    const controlTargetEndpoints = ['IN1', 'IN2', 'IN3', 'IN4'].map((pin) => `${driver.id}:${pin}`);
    const controlEndpoints = ['IN1', 'IN2', 'IN3', 'IN4']
      .map((pin) =>
        findConnectedControllerEndpointWithAnyRole(spec, driver.id, pin, [
          'digital-output',
          'pwm-output'
        ])
      )
      .filter((endpoint): endpoint is string => Boolean(endpoint));
    const phaseConnections = phasePairs
      .filter(([driverPin, motorPin]) =>
        reachableEndpointKeys(graph, [`${driver.id}:${driverPin}`]).has(`${motor.id}:${motorPin}`)
      )
      .map(([driverPin, motorPin]) => ({ driverPin, motorPin }));

    if (
      hasDriverPower &&
      hasMotorPower &&
      hasDriverGround &&
      controlEndpoints.length === 4 &&
      phaseConnections.length === 4
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

export function resolveBipolarStepperPath(
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

  for (const driver of spec.components.filter((candidate) =>
    STEP_DIR_STEPPER_DRIVER_PART_IDS.has(candidate.partId)
  )) {
    const hasMotorPower = endpointReachesControllerRole(
      spec,
      `${driver.id}:VMOT`,
      'power',
      partsById,
      componentsById
    );
    const hasDriverGround = endpointReachesControllerRole(
      spec,
      `${driver.id}:GND`,
      'ground',
      partsById,
      componentsById
    );
    const stepEndpoint = findConnectedControllerEndpointWithAnyRole(spec, driver.id, 'STEP', [
      'digital-output',
      'pwm-output'
    ]);
    const dirEndpoint = findConnectedControllerEndpointWithAnyRole(spec, driver.id, 'DIR', [
      'digital-output',
      'pwm-output'
    ]);
    const phaseConnections = coilPairs
      .filter(([driverPin, motorPin]) =>
        reachableEndpointKeys(graph, [`${driver.id}:${driverPin}`]).has(`${motor.id}:${motorPin}`)
      )
      .map(([driverPin, motorPin]) => ({ driverPin, motorPin }));

    if (
      hasMotorPower &&
      hasDriverGround &&
      stepEndpoint &&
      dirEndpoint &&
      phaseConnections.length === 4
    ) {
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

export function stepperMotorPhasePins(partId: string) {
  if (UNIPOLAR_STEPPER_MOTOR_PART_IDS.has(partId)) {
    return ['IN1', 'IN2', 'IN3', 'IN4'];
  }
  if (BIPOLAR_STEPPER_MOTOR_PART_IDS.has(partId)) {
    return ['A+', 'A-', 'B+', 'B-'];
  }
  return [];
}

export function validateHBridgeMotorPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const motors = spec.components.filter((candidate) =>
    HBRIDGE_MOTOR_LOAD_PART_IDS.has(candidate.partId)
  );
  const hbridgeDrivers = spec.components.filter((candidate) =>
    HBRIDGE_DRIVER_PART_IDS.has(candidate.partId)
  );

  if (hbridgeDrivers.length === 0) {
    return errors;
  }

  for (const motor of motors) {
    const path = resolveHBridgeMotorPath(spec, motor, partsById, componentsById);
    if (path) {
      continue;
    }
    errors.push(
      `HBRIDGE_DRIVER_PATH_INVALID: ${motor.label} needs a validated H-bridge path with driver power, common ground, enable/direction signals, and OUT1/OUT2 motor wiring.`
    );
  }

  for (const driver of hbridgeDrivers) {
    const controlPins = hbridgeControlPins(driver.partId);
    const missingControls = controlPins.filter(
      (pin) =>
        !findConnectedControllerEndpointWithAnyRole(spec, driver.id, pin, [
          'digital-output',
          'pwm-output'
        ])
    );
    if (missingControls.length > 0) {
      errors.push(
        `HBRIDGE_CONTROL_MISSING: ${driver.label} needs ${missingControls.join('/')} connected to Arduino digital or PWM outputs.`
      );
    }
  }

  return unique(errors);
}

export function resolveHBridgeMotorPath(
  spec: CircuitSpec,
  motor: CircuitSpec['components'][number],
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
): HBridgeMotorPath | null {
  const graph = buildEndpointGraph(spec);
  const motorPins = ['M+', 'M-'] as const;

  for (const driver of spec.components.filter((candidate) =>
    HBRIDGE_DRIVER_PART_IDS.has(candidate.partId)
  )) {
    const pins = hbridgePinContract(driver.partId);
    const hasMotorPower = endpointReachesControllerRole(
      spec,
      `${driver.id}:${pins.motorPower}`,
      'power',
      partsById,
      componentsById
    );
    const hasLogicPower = endpointReachesControllerRole(
      spec,
      `${driver.id}:${pins.logicPower}`,
      'power',
      partsById,
      componentsById
    );
    const hasDriverGround = endpointReachesControllerRole(
      spec,
      `${driver.id}:GND`,
      'ground',
      partsById,
      componentsById
    );
    const controlEndpoints = pins.controls
      .map((pin) =>
        findConnectedControllerEndpointWithAnyRole(spec, driver.id, pin, [
          'digital-output',
          'pwm-output'
        ])
      )
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
    const outputConnections =
      directOutputConnections.length === 2 ? directOutputConnections : reversedOutputConnections;

    if (
      hasMotorPower &&
      hasLogicPower &&
      hasDriverGround &&
      controlEndpoints.length === pins.controls.length &&
      outputConnections.length === 2
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

export function validateRelayModulePaths(
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
      errors.push(
        `RELAY_MAINS_LOAD_UNSUPPORTED: ${relay.label} cannot be used for mains, outlet, 110V, 220V, or AC load wiring in this simulator.`
      );
      continue;
    }

    const hasPower = endpointReachesControllerRole(
      spec,
      `${relay.id}:VCC`,
      'power',
      partsById,
      componentsById
    );
    const hasGround = endpointReachesControllerRole(
      spec,
      `${relay.id}:GND`,
      'ground',
      partsById,
      componentsById
    );
    const inputPin = relayInputPins(relay.partId).find((pin) =>
      findConnectedControllerEndpointWithAnyRole(spec, relay.id, pin, [
        'digital-output',
        'pwm-output'
      ])
    );

    if (!hasPower) {
      errors.push(`RELAY_POWER_MISSING: ${relay.label} needs VCC connected to Arduino 5V.`);
    }
    if (!hasGround) {
      errors.push(`RELAY_GROUND_MISSING: ${relay.label} needs GND connected to Arduino GND.`);
    }
    if (!inputPin) {
      errors.push(
        `RELAY_CONTROL_MISSING: ${relay.label} needs an IN pin connected to an Arduino digital output.`
      );
    }
    if (!relayIdsWithPaths.has(relay.id)) {
      errors.push(
        `RELAY_LOAD_PATH_INVALID: ${relay.label} needs COM/NO switching a low-voltage LED plus series resistor load path.`
      );
    }
  }

  return unique(errors);
}

export function hasDeclaredLowVoltageDcPower(spec: CircuitSpec) {
  const declaredPowerPattern =
    /\b(low\s*-?\s*voltage|dc|direct\s+current|5\s*v|5v|6\s*v|6v|9\s*v|9v|12\s*v|12v|battery|adapter|regulated)\b|저전압|직류|배터리|어댑터|레귤레이터/i;
  return declaredPowerPattern.test(
    [
      spec.title,
      spec.intent.primaryGoal,
      spec.intent.output ?? '',
      spec.intent.input ?? '',
      spec.intent.behavior ?? '',
      spec.behavior.runText,
      ...spec.components.map((component) => component.label),
      ...spec.assumptions
    ].join(' ')
  );
}

export function hasUnsafeLiPoHandlingLanguage(spec: CircuitSpec) {
  const unsafePattern =
    /\b(charge|charger|charging|short|short-circuit|puncture|pierce|high\s*current|overcurrent)\b|충전|쇼트|단락|구멍|고전류/i;
  return unsafePattern.test(
    [
      spec.title,
      spec.intent.primaryGoal,
      spec.intent.output ?? '',
      spec.intent.input ?? '',
      spec.intent.behavior ?? '',
      spec.behavior.runText,
      ...spec.assumptions
    ].join(' ')
  );
}

export const ANALOG_SENSOR_EDUCATIONAL_WARNING_PART_IDS = new Set([
  'acs712-current',
  'flame-sensor',
  'mq2-gas'
]);

export const ANALOG_INPUT_PART_IDS = new Set([
  ...ANALOG_DIMMER_INPUT_PART_IDS,
  'photoresistor-ldr',
  ...ANALOG_SENSOR_MODULE_PART_IDS
]);

export const DIRECT_LOW_CURRENT_LOAD_PART_IDS = new Set(['piezo-buzzer', 'active-buzzer']);

export const SERVO_ACTUATOR_PART_IDS = new Set(['micro-servo', 'mg996r-servo']);

export const HIGH_TORQUE_SERVO_PART_IDS = new Set(['mg996r-servo']);

export const STEPPER_DRIVER_PART_IDS = new Set([
  ...ULN2003_STEPPER_DRIVER_PART_IDS,
  ...STEP_DIR_STEPPER_DRIVER_PART_IDS
]);

export const HBRIDGE_DRIVER_PART_IDS = new Set(['l298n-driver', 'l293d-driver']);

export const LOW_VOLTAGE_POWER_SOURCE_PART_IDS = new Set([
  'breadboard-psu',
  '9v-battery-clip',
  'aa-battery-holder',
  'lipo-battery-1s',
  'barrel-jack',
  'screw-terminal-2pin'
]);

export const EXTERNAL_POWER_CONNECTOR_PART_IDS = new Set(['barrel-jack', 'screw-terminal-2pin']);

export const REGULATOR_INPUT_SOURCE_PART_IDS = new Set([
  '9v-battery-clip',
  'barrel-jack',
  'screw-terminal-2pin'
]);

export const VOLTAGE_REGULATOR_PART_IDS = new Set(['7805-regulator']);

export const LOW_VOLTAGE_POWER_RAIL_PART_IDS = new Set([
  ...LOW_VOLTAGE_POWER_SOURCE_PART_IDS,
  ...VOLTAGE_REGULATOR_PART_IDS
]);

export const LIPO_BATTERY_PART_IDS = new Set(['lipo-battery-1s']);

export const PASSIVE_PROTECTION_CONTEXT_PART_IDS = new Set([
  'ceramic-cap',
  'electrolytic-cap',
  'diode-1n4007',
  'schottky-diode',
  'zener-diode',
  'polyfuse',
  'inductor-axial'
]);

export const TIMING_PASSIVE_CONTEXT_PART_IDS = new Set(['crystal-16mhz']);

export const PASSIVE_CONTEXT_PART_IDS = new Set([
  ...PASSIVE_PROTECTION_CONTEXT_PART_IDS,
  ...TIMING_PASSIVE_CONTEXT_PART_IDS
]);

export const PROTOTYPING_SURFACE_CONTEXT_PART_IDS = new Set([
  'breadboard-full',
  'breadboard-mini',
  'perfboard-5x7',
  'pcb-blank-single',
  'proto-shield-uno'
]);

export const CONNECTOR_WIRING_CONTEXT_PART_IDS = new Set([
  'header-male-40pin',
  'header-female-40pin',
  'screw-terminal-4pin'
]);

export const WP09_CONTEXT_PART_IDS = new Set([
  ...PROTOTYPING_SURFACE_CONTEXT_PART_IDS,
  ...CONNECTOR_WIRING_CONTEXT_PART_IDS
]);

export const CONTROLLER_BOARD_CONTEXT_PART_IDS = new Set([
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

export const DISTANCE_SENSOR_PART_IDS = new Set(['ultrasonic-hc-sr04']);

export const WIRELESS_COMMUNICATION_MODULE_PART_IDS = new Set([
  'esp01-wifi',
  'hc05-bluetooth',
  'sim800l-gsm',
  'lora-ra02',
  'nrf24l01-radio'
]);

export const POWER_WARNING_COMMUNICATION_MODULE_PART_IDS = new Set([
  'esp01-wifi',
  'sim800l-gsm',
  'lora-ra02',
  'nrf24l01-radio',
  'usb-host-shield'
]);

export function validateLowVoltagePowerRailPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const railComponents = spec.components.filter((candidate) =>
    LOW_VOLTAGE_POWER_RAIL_PART_IDS.has(candidate.partId)
  );
  if (railComponents.length === 0) {
    return [];
  }

  const errors: string[] = [];
  const graph = buildEndpointGraph(spec);

  if (hasRelayMainsLanguage(spec)) {
    errors.push(
      'LOW_VOLTAGE_POWER_RAIL_UNSAFE_MAINS: Breadboard power rails only support declared low-voltage DC sources; mains, wall outlets, and AC wiring are blocked.'
    );
  }

  for (const component of railComponents.filter((candidate) =>
    LIPO_BATTERY_PART_IDS.has(candidate.partId)
  )) {
    if (hasUnsafeLiPoHandlingLanguage(spec)) {
      errors.push(
        `LIPO_UNSAFE_HANDLING_BLOCKED: ${component.label} cannot be used for charging, short-circuit, puncture, or high-current handling instructions.`
      );
    }
  }

  for (const component of railComponents.filter((candidate) =>
    EXTERNAL_POWER_CONNECTOR_PART_IDS.has(candidate.partId)
  )) {
    if (!hasDeclaredLowVoltageDcPower(spec)) {
      errors.push(
        `EXTERNAL_POWER_CONNECTOR_VOLTAGE_UNDECLARED: ${component.label} needs an explicit low-voltage DC source assumption before it can power a simulated rail.`
      );
    }
  }

  for (const component of railComponents.filter((candidate) =>
    LOW_VOLTAGE_POWER_SOURCE_PART_IDS.has(candidate.partId)
  )) {
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
      errors.push(
        `LOW_VOLTAGE_SOURCE_POSITIVE_RAIL_MISSING: ${component.label} needs its positive output connected to the breadboard + rail or a regulator input.`
      );
    }
    if (!groundPin || (!groundFeedsRail && !groundFeedsRegulator)) {
      errors.push(
        `LOW_VOLTAGE_SOURCE_GROUND_RAIL_MISSING: ${component.label} needs its ground/negative output connected to the breadboard - rail or regulator ground.`
      );
    }
  }

  for (const regulator of railComponents.filter((candidate) =>
    VOLTAGE_REGULATOR_PART_IDS.has(candidate.partId)
  )) {
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
    const reachesAnyLowVoltageSource = inputSourcePartIds.some((partId) =>
      LOW_VOLTAGE_POWER_SOURCE_PART_IDS.has(partId)
    );
    const reachesAllowedInputSource = inputSourcePartIds.some((partId) =>
      REGULATOR_INPUT_SOURCE_PART_IDS.has(partId)
    );
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
      errors.push(
        `REGULATOR_INPUT_MISSING: ${regulator.label} IN needs a declared low-voltage source such as a 9V battery clip or DC input connector.`
      );
    }
    if (reachesAnyLowVoltageSource && !reachesAllowedInputSource) {
      errors.push(
        `REGULATOR_INPUT_SOURCE_UNSUPPORTED: ${regulator.label} is not modeled with the connected source; use a 9V battery clip, DC barrel jack, or declared low-voltage screw terminal.`
      );
    }
    if (!outputPin || !outputFeedsRail) {
      errors.push(
        `REGULATOR_OUTPUT_RAIL_MISSING: ${regulator.label} OUT needs to feed the breadboard + rail.`
      );
    }
    if (!groundPin || !groundReachesSource || !groundReachesRail) {
      errors.push(
        `REGULATOR_COMMON_GROUND_MISSING: ${regulator.label} GND needs both the source ground and breadboard - rail common ground.`
      );
    }
  }

  return unique(errors);
}

export function validatePassiveContextPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const passiveContextComponents = spec.components.filter((candidate) =>
    PASSIVE_CONTEXT_PART_IDS.has(candidate.partId)
  );
  if (passiveContextComponents.length === 0) {
    return [];
  }

  const errors: string[] = [];
  const graph = buildEndpointGraph(spec);

  if (hasRelayMainsLanguage(spec)) {
    errors.push(
      'PASSIVE_CONTEXT_UNSAFE_MAINS: Passive/protection context is limited to low-voltage breadboard lessons; MOV, mains, wall outlet, and AC protection circuits are blocked.'
    );
  }

  for (const component of spec.components.filter((candidate) =>
    LIPO_BATTERY_PART_IDS.has(candidate.partId)
  )) {
    if (hasUnsafeLiPoHandlingLanguage(spec)) {
      errors.push(
        `LIPO_UNSAFE_HANDLING_BLOCKED: ${component.label} cannot be used for charging, short-circuit, puncture, or high-current handling instructions.`
      );
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
        errors.push(
          `POLARIZED_PASSIVE_REVERSED: ${component.label} has reversed polarity; + must not connect to ground and - must not connect to power.`
        );
      }
    }
  }

  return unique(errors);
}

export function validateWp09ContextPaths(spec: CircuitSpec) {
  const wp09Components = spec.components.filter((candidate) =>
    WP09_CONTEXT_PART_IDS.has(candidate.partId)
  );
  if (wp09Components.length === 0) {
    return [];
  }

  const errors: string[] = [];
  const hasConnectorContext = wp09Components.some((component) =>
    CONNECTOR_WIRING_CONTEXT_PART_IDS.has(component.partId)
  );
  const hasSurfaceContext = wp09Components.some((component) =>
    PROTOTYPING_SURFACE_CONTEXT_PART_IDS.has(component.partId)
  );

  if (hasRelayMainsLanguage(spec)) {
    if (hasSurfaceContext) {
      errors.push(
        'PROTOTYPING_CONTEXT_UNSAFE_MAINS: Prototyping surfaces are limited to low-voltage classroom context; mains, wall outlets, and AC wiring are blocked.'
      );
    }
    if (hasConnectorContext) {
      errors.push(
        'CONNECTOR_CONTEXT_UNSAFE_MAINS: Header and terminal connector context is limited to low-voltage classroom wiring; mains, wall outlets, and AC wiring are blocked.'
      );
    }
  }

  if (
    spec.components.some((component) => component.partId === 'screw-terminal-4pin') &&
    hasConnectorAsPowerSourceLanguage(spec)
  ) {
    errors.push(
      'CONNECTOR_CONTEXT_NOT_POWER_SOURCE: The 4-pin screw terminal is supported as connector context only; use an explicit low-voltage source contract for power rails.'
    );
  }

  return unique(errors);
}

export function validateControllerBoardContextPaths(spec: CircuitSpec) {
  const controllerBoardComponents = spec.components.filter((candidate) =>
    CONTROLLER_BOARD_CONTEXT_PART_IDS.has(candidate.partId)
  );
  if (controllerBoardComponents.length === 0) {
    return [];
  }

  const errors: string[] = [];
  if (hasRelayMainsLanguage(spec)) {
    errors.push(
      'CONTROLLER_BOARD_CONTEXT_UNSAFE_MAINS: Controller board context is limited to low-voltage classroom simulation; mains, wall outlets, and AC wiring are blocked.'
    );
  }

  const nonContextComponents = spec.components.filter(
    (component) =>
      !CONTROLLER_BOARD_CONTEXT_PART_IDS.has(component.partId) &&
      !WP09_CONTEXT_PART_IDS.has(component.partId) &&
      component.partId !== 'jumper-wire'
  );

  if (nonContextComponents.length > 0) {
    const boardLabels = controllerBoardComponents.map((component) => component.label).join(', ');
    errors.push(
      `CONTROLLER_BOARD_SUBSTITUTION_NOT_VALIDATED: ${boardLabels} is supported as pin-map and voltage-domain context, but this circuit includes ${nonContextComponents.map((component) => component.label).join(', ')}; validated wiring substitution for that board and circuit bundle is not yet available.`
    );
  }

  return unique(errors);
}

export function hasConnectorAsPowerSourceLanguage(spec: CircuitSpec) {
  const powerSourcePattern =
    /\b(power\s*source|voltage\s*source|supply\s*source|energize|power\s*rail|5\s*v\s*rail|5v\s*rail|power\s*supply)\b|전원\s*(공급|소스)|파워\s*레일|전원\s*레일|5V\s*레일/i;
  const contextOnlyPattern =
    /\b(connector\s*context|wiring\s*context|placement\s*context|place|show|render)\b|커넥터\s*문맥|배치\s*문맥|표시|보여/i;
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

export function validateAnalogInputPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  for (const component of spec.components.filter((candidate) =>
    ANALOG_INPUT_PART_IDS.has(candidate.partId)
  )) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }
    const powerPin = firstPinNameForRole(part, isPowerRole);
    const groundPin = firstPinNameForRole(part, isGroundRole);
    const analogPin = firstPinNameForRole(
      part,
      (role) => role === 'analog-output' || role === 'analog'
    );

    if (
      !powerPin ||
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${powerPin}`,
        'power',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `ANALOG_INPUT_POWER_MISSING: ${component.label} needs VCC connected to Arduino 5V.`
      );
    }
    if (
      !groundPin ||
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${groundPin}`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `ANALOG_INPUT_GROUND_MISSING: ${component.label} needs GND connected to Arduino GND.`
      );
    }
    const analogConnection = analogPin
      ? findConnectionToControllerRole(spec, component.id, analogPin, 'analog-input')
      : null;
    const analogReachesController = analogPin
      ? endpointReachesControllerRole(
          spec,
          `${component.id}:${analogPin}`,
          'analog-input',
          partsById,
          componentsById
        )
      : false;
    if (!analogPin || !analogReachesController) {
      errors.push(
        `ANALOG_INPUT_SIGNAL_MISSING: ${component.label} needs its analog output connected to Arduino A0.`
      );
    } else if (analogConnection && analogConnection.signal !== 'analog') {
      errors.push(
        `ANALOG_INPUT_SIGNAL_TYPE_INVALID: ${component.label} analog output must use the analog signal type.`
      );
    }
  }
  return errors;
}

export function validateAnalogSensorDisplayPaths(
  spec: CircuitSpec,
  _partsById: Map<string, PartCapability>,
  _componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  const displayRequested = /display|oled|screen|show|readout|표시|화면|값/i.test(
    [
      spec.intent.primaryGoal,
      spec.intent.output ?? '',
      spec.intent.behavior ?? '',
      spec.behavior.runText,
      ...spec.assumptions
    ].join(' ')
  );

  for (const component of spec.components.filter((candidate) =>
    ANALOG_SENSOR_MODULE_PART_IDS.has(candidate.partId)
  )) {
    if (displayRequested && !hasDisplay) {
      errors.push(
        `ANALOG_SENSOR_DISPLAY_MISSING: ${component.label} readout needs an I2C text display in this supported topology.`
      );
    }
  }

  return errors;
}

export function validateResistiveSensorDividerPaths(
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
  const displayRequested = /display|oled|screen|show|readout|표시|화면|값/i.test(
    [
      spec.intent.primaryGoal,
      spec.intent.output ?? '',
      spec.intent.behavior ?? '',
      spec.behavior.runText,
      ...spec.assumptions
    ].join(' ')
  );
  const thresholdRequested = hasThresholdLanguage(spec);

  for (const component of spec.components.filter((candidate) =>
    RESISTIVE_SENSOR_PART_IDS.has(candidate.partId)
  )) {
    const part = partsById.get(component.partId);
    const terminalPins = part?.pins.map((pin) => pin.name) ?? [];
    const terminalKeys = terminalPins.map((pin) => `${component.id}:${pin}`);
    if (terminalKeys.length < 2) {
      errors.push(
        `RESISTIVE_SENSOR_PIN_MAP_INVALID: ${component.label} needs exactly two resistive terminals.`
      );
      continue;
    }

    if (referenceIds.length === 0) {
      errors.push(
        `RESISTIVE_SENSOR_REFERENCE_RESISTOR_MISSING: ${component.label} needs a fixed 10K reference resistor for the voltage divider.`
      );
    }

    const powerTerminals = terminalKeys.filter((key) =>
      endpointReachesAnyControllerRoleInGraph(graph, key, ['power'], partsById, componentsById)
    );
    if (powerTerminals.length === 0) {
      errors.push(
        `RESISTIVE_SENSOR_DIVIDER_POWER_MISSING: ${component.label} needs one terminal connected to Arduino 5V.`
      );
    }

    const analogTerminals = terminalKeys.filter((key) =>
      endpointReachesAnyControllerRoleInGraph(
        graph,
        key,
        ['analog-input'],
        partsById,
        componentsById
      )
    );
    if (analogTerminals.length === 0) {
      errors.push(
        `RESISTIVE_SENSOR_ANALOG_SIGNAL_MISSING: ${component.label} needs the divider midpoint connected to Arduino A0.`
      );
      continue;
    }

    const dividerTerminal = analogTerminals.find((key) =>
      hasPathThroughReferenceResistorToGround(
        spec,
        graph,
        key,
        referenceIds,
        partsById,
        componentsById
      )
    );
    if (!dividerTerminal) {
      errors.push(
        `RESISTIVE_SENSOR_DIVIDER_GROUND_MISSING: ${component.label} needs the A0 divider node connected through a 10K reference resistor to Arduino GND.`
      );
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
      errors.push(
        `RESISTIVE_SENSOR_ANALOG_SIGNAL_MISSING: ${component.label} divider midpoint must reach Arduino A0.`
      );
    } else if (analogConnection.signal !== 'analog') {
      errors.push(
        `RESISTIVE_SENSOR_ANALOG_SIGNAL_TYPE_INVALID: ${component.label} divider midpoint must use the analog signal type.`
      );
    }

    if (displayRequested && !hasDisplay) {
      errors.push(
        `RESISTIVE_SENSOR_DISPLAY_MISSING: ${component.label} readout needs an I2C text display in this supported topology.`
      );
    }
    if (thresholdRequested && !hasAnalogThresholdOutputPath(spec, partsById, componentsById)) {
      errors.push(
        `RESISTIVE_SENSOR_THRESHOLD_OUTPUT_MISSING: ${component.label} threshold circuits need a current-limited LED output path.`
      );
    }
  }

  return errors;
}

export function validateI2cDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  for (const component of spec.components.filter((candidate) =>
    I2C_TEXT_DISPLAY_PART_IDS.has(candidate.partId)
  )) {
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:VCC`,
        'power',
        partsById,
        componentsById
      )
    ) {
      errors.push(`DISPLAY_POWER_MISSING: ${component.label} needs VCC connected to Arduino 5V.`);
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:GND`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(`DISPLAY_GROUND_MISSING: ${component.label} needs GND connected to Arduino GND.`);
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:SDA`,
        'i2c-data',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `DISPLAY_I2C_CONNECTION_MISSING: ${component.label} SDA must connect to Arduino A4/SDA.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:SCL`,
        'i2c-clock',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `DISPLAY_I2C_CONNECTION_MISSING: ${component.label} SCL must connect to Arduino A5/SCL.`
      );
    }
  }
  return errors;
}

export function validateBareSevenSegmentDisplayPaths(
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

  for (const component of spec.components.filter((candidate) =>
    BARE_SEVEN_SEGMENT_DISPLAY_PART_IDS.has(candidate.partId)
  )) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }

    const groundPin = firstPinNameForRole(part, isGroundRole) ?? 'GND';
    const segmentPins = bareSevenSegmentPins(part);
    let validSegmentPaths = 0;

    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${groundPin}`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `BARE_7SEG_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`
      );
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

      const controllerOutputs = controllerEndpointKeysWithRole(
        spec,
        ['digital-output', 'pwm-output'],
        partsById,
        componentsById
      );
      const seriesResistorIds = componentIdsOnPathThroughAnyComponent(
        graph,
        controllerOutputs,
        segmentKey,
        resistorIds
      );
      if (seriesResistorIds.length === 0) {
        errors.push(
          `BARE_7SEG_SEGMENT_RESISTOR_MISSING: ${component.label} segment ${pin} must be driven through its own 220 ohm resistor.`
        );
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
      errors.push(
        `BARE_7SEG_SEGMENT_SIGNAL_MISSING: ${component.label} needs at least one segment pin connected to an Arduino digital output through a 220 ohm resistor.`
      );
    }
  }

  for (const [resistorId, segmentIds] of resistorIdsBySegment.entries()) {
    if (segmentIds.length > 1) {
      errors.push(
        `BARE_7SEG_RESISTOR_SHARED: ${resistorId} is shared by multiple segment pins (${segmentIds.join(', ')}). Give each driven segment its own current limiting resistor.`
      );
    }
  }

  return unique(errors);
}

export function validateLedArrayDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  for (const component of spec.components.filter((candidate) =>
    LED_ARRAY_DISPLAY_PART_IDS.has(candidate.partId)
  )) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }

    const powerPin = firstPinNameForRole(part, isPowerRole) ?? 'VCC';
    const groundPin = firstPinNameForRole(part, isGroundRole) ?? 'GND';
    const dataPin =
      firstPinNameForRole(part, (role) => role === 'data' || role === 'single-wire-data') ?? 'DIO';
    const clockPin = firstPinNameForRole(part, (role) => role === 'clock') ?? 'CLK';
    const selectPin = firstPinNameForRole(
      part,
      (role) => role === 'chip-select' || role === 'enable'
    );

    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${powerPin}`,
        'power',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `LED_ARRAY_DISPLAY_POWER_MISSING: ${component.label} needs ${powerPin} connected to Arduino 5V.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${groundPin}`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `LED_ARRAY_DISPLAY_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`
      );
    }
    if (
      !endpointReachesAnyControllerRole(
        spec,
        `${component.id}:${dataPin}`,
        ['digital-output', 'pwm-output'],
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `LED_ARRAY_DISPLAY_DATA_MISSING: ${component.label} needs ${dataPin} connected to an Arduino digital output pin.`
      );
    }
    if (
      !endpointReachesAnyControllerRole(
        spec,
        `${component.id}:${clockPin}`,
        ['digital-output', 'pwm-output'],
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `LED_ARRAY_DISPLAY_CLOCK_MISSING: ${component.label} needs ${clockPin} connected to an Arduino digital output pin.`
      );
    }
    if (
      selectPin &&
      !endpointReachesAnyControllerRole(
        spec,
        `${component.id}:${selectPin}`,
        ['digital-output', 'pwm-output'],
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `LED_ARRAY_DISPLAY_SELECT_MISSING: ${component.label} needs ${selectPin} connected to an Arduino digital output pin.`
      );
    }
  }

  return errors;
}

export function validateAddressableLedDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  for (const component of spec.components.filter((candidate) =>
    ADDRESSABLE_LED_DISPLAY_PART_IDS.has(candidate.partId)
  )) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }

    const powerPin = firstPinNameForRole(part, isPowerRole) ?? '5V';
    const groundPin = firstPinNameForRole(part, isGroundRole) ?? 'GND';
    const dataPin =
      firstPinNameForRole(part, (role) => role === 'single-wire-data' || role === 'data') ?? 'DIN';

    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${powerPin}`,
        'power',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `ADDRESSABLE_LED_POWER_MISSING: ${component.label} needs ${powerPin} connected to Arduino 5V.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${groundPin}`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `ADDRESSABLE_LED_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`
      );
    }
    if (
      !endpointReachesAnyControllerRole(
        spec,
        `${component.id}:${dataPin}`,
        ['digital-output', 'pwm-output'],
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `ADDRESSABLE_LED_DATA_MISSING: ${component.label} needs ${dataPin} connected to an Arduino digital output pin.`
      );
    }
  }

  return errors;
}

export function validateSpiDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  for (const component of spec.components.filter((candidate) =>
    SPI_DISPLAY_PART_IDS.has(candidate.partId)
  )) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }

    const powerPin = firstPinNameForRole(part, isPowerRole) ?? 'VCC';
    const groundPin = firstPinNameForRole(part, isGroundRole) ?? 'GND';
    const dataPin = firstPinNameForRole(part, (role) => role === 'data') ?? 'DIN';
    const clockPin = firstPinNameForRole(part, (role) => role === 'clock') ?? 'SCK';
    const selectPin =
      firstPinNameForRole(part, (role) => role === 'chip-select' || role === 'enable') ?? 'CS';
    const controlPins = part.pins
      .filter((pin) => pin.role === 'data-command' || pin.role === 'reset')
      .map((pin) => pin.name);

    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${powerPin}`,
        'power',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `SPI_DISPLAY_POWER_MISSING: ${component.label} needs ${powerPin} connected to Arduino power.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${groundPin}`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `SPI_DISPLAY_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`
      );
    }
    if (
      !endpointReachesAnyControllerRole(
        spec,
        `${component.id}:${dataPin}`,
        ['digital-output', 'pwm-output'],
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `SPI_DISPLAY_DATA_MISSING: ${component.label} needs ${dataPin} connected to an Arduino digital output pin.`
      );
    }
    if (
      !endpointReachesAnyControllerRole(
        spec,
        `${component.id}:${clockPin}`,
        ['digital-output', 'pwm-output'],
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `SPI_DISPLAY_CLOCK_MISSING: ${component.label} needs ${clockPin} connected to an Arduino digital output pin.`
      );
    }
    if (
      !endpointReachesAnyControllerRole(
        spec,
        `${component.id}:${selectPin}`,
        ['digital-output', 'pwm-output'],
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `SPI_DISPLAY_SELECT_MISSING: ${component.label} needs ${selectPin} connected to an Arduino digital output pin.`
      );
    }
    for (const controlPin of controlPins) {
      if (
        !endpointReachesAnyControllerRole(
          spec,
          `${component.id}:${controlPin}`,
          ['digital-output', 'pwm-output'],
          partsById,
          componentsById
        )
      ) {
        errors.push(
          `SPI_DISPLAY_CONTROL_MISSING: ${component.label} needs ${controlPin} connected to an Arduino digital output pin.`
        );
      }
    }
  }

  return errors;
}

export function validateDistanceSensorDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  for (const component of spec.components.filter((candidate) =>
    DISTANCE_SENSOR_PART_IDS.has(candidate.partId)
  )) {
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:VCC`,
        'power',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `DISTANCE_SENSOR_POWER_MISSING: ${component.label} needs VCC connected to Arduino 5V.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:GND`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `DISTANCE_SENSOR_GROUND_MISSING: ${component.label} needs GND connected to Arduino GND.`
      );
    }
    if (
      !endpointReachesAnyControllerRole(
        spec,
        `${component.id}:TRIG`,
        ['digital-output', 'pwm-output'],
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `DISTANCE_SENSOR_TRIG_MISSING: ${component.label} TRIG must connect to an Arduino digital output such as D3.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:ECHO`,
        'digital-input',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `DISTANCE_SENSOR_ECHO_MISSING: ${component.label} ECHO must connect to an Arduino digital input such as D2.`
      );
    }
  }
  return errors;
}

export function validateSingleWireSensorDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  for (const component of spec.components.filter((candidate) =>
    SINGLE_WIRE_SENSOR_PART_IDS.has(candidate.partId)
  )) {
    const part = partsById.get(component.partId);
    const dataPin = part
      ? firstPinNameForRole(
          part,
          (role) =>
            role === 'single-wire-data' || role === 'digital-data' || role === 'digital-output'
        )
      : 'DAT';

    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:VCC`,
        'power',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `DHT_SENSOR_POWER_MISSING: ${component.label} needs VCC connected to Arduino 5V.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:GND`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `DHT_SENSOR_GROUND_MISSING: ${component.label} needs GND connected to Arduino GND.`
      );
    }
    if (!hasDisplay) {
      errors.push(
        `DHT_DISPLAY_MISSING: ${component.label} temperature/humidity readout needs an I2C text display in this supported topology.`
      );
    }

    const dataConnection = dataPin
      ? findConnectionToControllerRole(spec, component.id, dataPin, 'digital-input')
      : null;
    const dataControllerEndpoint = dataConnection
      ? [dataConnection.from, dataConnection.to].find(
          (endpoint) => endpoint.componentId !== component.id
        )
      : null;
    if (!dataPin || !dataConnection || dataControllerEndpoint?.pin !== 'D2') {
      errors.push(
        `DHT_SENSOR_DATA_MISSING: ${component.label} DAT must connect to Arduino D2 in this supported topology.`
      );
    } else if (dataConnection.signal !== 'single-wire-data') {
      errors.push(
        `DHT_SENSOR_DATA_SIGNAL_INVALID: ${component.label} DAT must use the single-wire-data signal type.`
      );
    }
  }
  return errors;
}

export function validateI2cProtocolSensorDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  for (const component of spec.components.filter((candidate) =>
    I2C_PROTOCOL_SENSOR_PART_IDS.has(candidate.partId)
  )) {
    const part = partsById.get(component.partId);
    const powerPin = part
      ? (firstPinNameForRole(part, (role) => role === 'power') ?? 'VCC')
      : 'VCC';
    const groundPin = part
      ? (firstPinNameForRole(part, (role) => role === 'ground') ?? 'GND')
      : 'GND';
    const sdaPin = part
      ? (firstPinNameForRole(part, (role) => role === 'i2c-data') ?? 'SDA')
      : 'SDA';
    const sclPin = part
      ? (firstPinNameForRole(part, (role) => role === 'i2c-clock') ?? 'SCL')
      : 'SCL';

    if (!hasDisplay) {
      errors.push(
        `PROTOCOL_SENSOR_DISPLAY_MISSING: ${component.label} readout needs an I2C text display in this supported topology.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${powerPin}`,
        'power',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `PROTOCOL_SENSOR_POWER_MISSING: ${component.label} needs ${powerPin} connected to Arduino power.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${groundPin}`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `PROTOCOL_SENSOR_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`
      );
    }

    const sdaConnection = findConnectionToControllerRole(spec, component.id, sdaPin, 'i2c-data');
    const sclConnection = findConnectionToControllerRole(spec, component.id, sclPin, 'i2c-clock');
    if (
      !sdaConnection ||
      controllerPinFromConnection(spec, sdaConnection, component.id) !== 'A4/SDA'
    ) {
      errors.push(
        `I2C_PROTOCOL_SENSOR_SDA_MISSING: ${component.label} ${sdaPin} must connect to Arduino A4/SDA.`
      );
    } else if (!validI2cSignalType(sdaConnection.signal, 'data')) {
      errors.push(
        `I2C_PROTOCOL_SENSOR_SIGNAL_INVALID: ${component.label} ${sdaPin} must use an I2C data signal type.`
      );
    }
    if (
      !sclConnection ||
      controllerPinFromConnection(spec, sclConnection, component.id) !== 'A5/SCL'
    ) {
      errors.push(
        `I2C_PROTOCOL_SENSOR_SCL_MISSING: ${component.label} ${sclPin} must connect to Arduino A5/SCL.`
      );
    } else if (!validI2cSignalType(sclConnection.signal, 'clock')) {
      errors.push(
        `I2C_PROTOCOL_SENSOR_SIGNAL_INVALID: ${component.label} ${sclPin} must use an I2C clock signal type.`
      );
    }
  }
  return errors;
}

export function validateClockedDataSensorDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  for (const component of spec.components.filter((candidate) =>
    CLOCKED_DATA_SENSOR_PART_IDS.has(candidate.partId)
  )) {
    const part = partsById.get(component.partId);
    const powerPin = part
      ? (firstPinNameForRole(part, (role) => role === 'power') ?? 'VCC')
      : 'VCC';
    const groundPin = part
      ? (firstPinNameForRole(part, (role) => role === 'ground') ?? 'GND')
      : 'GND';
    const dataPin = part
      ? (firstPinNameForRole(part, (role) => role === 'digital-data') ?? 'DT')
      : 'DT';
    const clockPin = part
      ? (firstPinNameForRole(part, (role) => role === 'digital-clock') ?? 'SCK')
      : 'SCK';

    if (!hasDisplay) {
      errors.push(
        `PROTOCOL_SENSOR_DISPLAY_MISSING: ${component.label} readout needs an I2C text display in this supported topology.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${powerPin}`,
        'power',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `CLOCKED_DATA_SENSOR_POWER_MISSING: ${component.label} needs ${powerPin} connected to Arduino power.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${groundPin}`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `CLOCKED_DATA_SENSOR_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`
      );
    }

    const dataConnection = findConnectionToControllerRole(
      spec,
      component.id,
      dataPin,
      'digital-input'
    );
    const clockConnection =
      findConnectionToControllerRole(spec, component.id, clockPin, 'digital-output') ??
      findConnectionToControllerRole(spec, component.id, clockPin, 'pwm-output');
    if (
      !dataConnection ||
      controllerPinFromConnection(spec, dataConnection, component.id) !== 'D2'
    ) {
      errors.push(
        `CLOCKED_DATA_SENSOR_DATA_MISSING: ${component.label} ${dataPin} must connect to Arduino D2.`
      );
    } else if (!validClockedDataSignalType(dataConnection.signal)) {
      errors.push(
        `CLOCKED_DATA_SENSOR_SIGNAL_INVALID: ${component.label} ${dataPin} must use a digital or clocked-data signal type.`
      );
    }
    if (!clockConnection) {
      errors.push(
        `CLOCKED_DATA_SENSOR_CLOCK_MISSING: ${component.label} ${clockPin} must connect to an Arduino digital output such as D3.`
      );
    } else if (!validClockedDataSignalType(clockConnection.signal)) {
      errors.push(
        `CLOCKED_DATA_SENSOR_SIGNAL_INVALID: ${component.label} ${clockPin} must use a digital or clocked-data signal type.`
      );
    }
  }
  return errors;
}

export function validateSpiProtocolSensorDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  for (const component of spec.components.filter((candidate) =>
    SPI_PROTOCOL_SENSOR_PART_IDS.has(candidate.partId)
  )) {
    const part = partsById.get(component.partId);
    const powerPin = part
      ? (firstPinNameForRole(part, (role) => role === 'power') ?? '3V3')
      : '3V3';
    const groundPin = part
      ? (firstPinNameForRole(part, (role) => role === 'ground') ?? 'GND')
      : 'GND';
    const sckPin = part
      ? (firstPinNameForRole(part, (role) => role === 'spi-clock') ?? 'SCK')
      : 'SCK';
    const mosiPin = part
      ? (firstPinNameForRole(part, (role) => role === 'spi-mosi') ?? 'MOSI')
      : 'MOSI';
    const misoPin = part
      ? (firstPinNameForRole(part, (role) => role === 'spi-miso') ?? 'MISO')
      : 'MISO';
    const selectPin = part
      ? (firstPinNameForRole(part, (role) => role === 'spi-select') ?? 'CS')
      : 'CS';

    if (!hasDisplay) {
      errors.push(
        `PROTOCOL_SENSOR_DISPLAY_MISSING: ${component.label} readout needs an I2C text display in this supported topology.`
      );
    }
    if (
      !endpointReachesControllerPin(
        spec,
        `${component.id}:${powerPin}`,
        ['3V3'],
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `SPI_PROTOCOL_SENSOR_3V3_MISSING: ${component.label} ${powerPin} must connect to Arduino 3V3, not 5V.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${groundPin}`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `SPI_PROTOCOL_SENSOR_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`
      );
    }

    errors.push(
      ...validateProtocolPinConnection(
        spec,
        component,
        sckPin,
        'spi-clock',
        'D13',
        'SPI_PROTOCOL_SENSOR_CLOCK_MISSING',
        'SPI clock'
      )
    );
    errors.push(
      ...validateProtocolPinConnection(
        spec,
        component,
        mosiPin,
        'spi-mosi',
        'D11',
        'SPI_PROTOCOL_SENSOR_MOSI_MISSING',
        'SPI MOSI'
      )
    );
    errors.push(
      ...validateProtocolPinConnection(
        spec,
        component,
        misoPin,
        'spi-miso',
        'D12',
        'SPI_PROTOCOL_SENSOR_MISO_MISSING',
        'SPI MISO'
      )
    );
    errors.push(
      ...validateProtocolPinConnection(
        spec,
        component,
        selectPin,
        'spi-select',
        'D10',
        'SPI_PROTOCOL_SENSOR_SELECT_MISSING',
        'SPI chip-select'
      )
    );
  }
  return errors;
}

export function validateUartProtocolSensorDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  for (const component of spec.components.filter((candidate) =>
    UART_PROTOCOL_SENSOR_PART_IDS.has(candidate.partId)
  )) {
    const part = partsById.get(component.partId);
    const powerPin = part
      ? (firstPinNameForRole(part, (role) => role === 'power') ?? 'VCC')
      : 'VCC';
    const groundPin = part
      ? (firstPinNameForRole(part, (role) => role === 'ground') ?? 'GND')
      : 'GND';
    const txPin = part ? (firstPinNameForRole(part, (role) => role === 'serial-tx') ?? 'TX') : 'TX';
    const rxPin = part ? (firstPinNameForRole(part, (role) => role === 'serial-rx') ?? 'RX') : 'RX';

    if (!hasDisplay) {
      errors.push(
        `PROTOCOL_SENSOR_DISPLAY_MISSING: ${component.label} readout needs an I2C text display in this supported topology.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${powerPin}`,
        'power',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `UART_PROTOCOL_SENSOR_POWER_MISSING: ${component.label} needs ${powerPin} connected to Arduino power.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${groundPin}`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `UART_PROTOCOL_SENSOR_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`
      );
    }

    const txConnection = findConnectionToControllerRole(spec, component.id, txPin, 'serial-rx');
    if (
      !txConnection ||
      controllerPinFromConnection(spec, txConnection, component.id) !== 'D0/RX'
    ) {
      errors.push(
        `UART_PROTOCOL_SENSOR_TX_MISSING: ${component.label} ${txPin} must connect to Arduino D0/RX.`
      );
    } else if (!validUartSignalType(txConnection.signal)) {
      errors.push(
        `UART_PROTOCOL_SENSOR_SIGNAL_INVALID: ${component.label} ${txPin} must use a UART signal type.`
      );
    }

    const rxConnections = spec.connections.filter((connection) =>
      [connection.from, connection.to].some(
        (endpoint) => endpoint.componentId === component.id && endpoint.pin === rxPin
      )
    );
    if (rxConnections.length > 0) {
      const rxConnection = findConnectionToControllerRole(spec, component.id, rxPin, 'serial-tx');
      if (
        !rxConnection ||
        controllerPinFromConnection(spec, rxConnection, component.id) !== 'D1/TX'
      ) {
        errors.push(
          `UART_PROTOCOL_SENSOR_RX_INVALID: ${component.label} ${rxPin}, when connected, must connect to Arduino D1/TX.`
        );
      } else if (!validUartSignalType(rxConnection.signal)) {
        errors.push(
          `UART_PROTOCOL_SENSOR_SIGNAL_INVALID: ${component.label} ${rxPin} must use a UART signal type.`
        );
      }
    }
  }
  return errors;
}

export function validateUartCommunicationModulePaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  for (const component of spec.components.filter((candidate) =>
    UART_COMMUNICATION_MODULE_PART_IDS.has(candidate.partId)
  )) {
    const part = partsById.get(component.partId);
    const powerPin = part ? (firstPinNameForRole(part, isPowerRole) ?? 'VCC') : 'VCC';
    const groundPin = part ? (firstPinNameForRole(part, isGroundRole) ?? 'GND') : 'GND';
    const txPin = part ? (firstPinNameForRole(part, (role) => role === 'serial-tx') ?? 'TX') : 'TX';
    const rxPin = part ? (firstPinNameForRole(part, (role) => role === 'serial-rx') ?? 'RX') : 'RX';

    if (!hasDisplay) {
      errors.push(
        `COMMUNICATION_MODULE_DISPLAY_MISSING: ${component.label} command-state readout needs an I2C text display in this supported topology.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${powerPin}`,
        'power',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `UART_COMMUNICATION_MODULE_POWER_MISSING: ${component.label} needs ${powerPin} connected to a supported controller power pin or rail.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${groundPin}`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `UART_COMMUNICATION_MODULE_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`
      );
    }

    const txConnection = findConnectionToControllerRole(spec, component.id, txPin, 'serial-rx');
    if (
      !txConnection ||
      controllerPinFromConnection(spec, txConnection, component.id) !== 'D0/RX'
    ) {
      errors.push(
        `UART_COMMUNICATION_MODULE_TX_MISSING: ${component.label} ${txPin} must connect to Arduino D0/RX.`
      );
    } else if (!validUartSignalType(txConnection.signal)) {
      errors.push(
        `UART_COMMUNICATION_MODULE_SIGNAL_INVALID: ${component.label} ${txPin} must use a UART signal type.`
      );
    }

    const rxConnection = findConnectionToControllerRole(spec, component.id, rxPin, 'serial-tx');
    if (
      !rxConnection ||
      controllerPinFromConnection(spec, rxConnection, component.id) !== 'D1/TX'
    ) {
      errors.push(
        `UART_COMMUNICATION_MODULE_RX_MISSING: ${component.label} ${rxPin} must connect to Arduino D1/TX.`
      );
    } else if (!validUartSignalType(rxConnection.signal)) {
      errors.push(
        `UART_COMMUNICATION_MODULE_SIGNAL_INVALID: ${component.label} ${rxPin} must use a UART signal type.`
      );
    }
  }
  return errors;
}

export function validateSpiCommunicationModulePaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  for (const component of spec.components.filter((candidate) =>
    SPI_COMMUNICATION_MODULE_PART_IDS.has(candidate.partId)
  )) {
    const part = partsById.get(component.partId);
    const powerPin = part ? (firstPinNameForRole(part, isPowerRole) ?? 'VCC') : 'VCC';
    const groundPin = part ? (firstPinNameForRole(part, isGroundRole) ?? 'GND') : 'GND';
    const sckPin = part
      ? (firstPinNameForRole(part, (role) => role === 'spi-clock') ?? 'SCK')
      : 'SCK';
    const mosiPin = part
      ? (firstPinNameForRole(part, (role) => role === 'spi-mosi') ?? 'MOSI')
      : 'MOSI';
    const misoPin = part ? firstPinNameForRole(part, (role) => role === 'spi-miso') : null;
    const selectPin = part
      ? (firstPinNameForRole(part, (role) => role === 'spi-select') ?? 'CS')
      : 'CS';

    if (!hasDisplay) {
      errors.push(
        `COMMUNICATION_MODULE_DISPLAY_MISSING: ${component.label} bus-state readout needs an I2C text display in this supported topology.`
      );
    }
    const requires3v3 = ['lora-ra02', 'nrf24l01-radio'].includes(component.partId);
    if (requires3v3) {
      if (
        !endpointReachesControllerPin(
          spec,
          `${component.id}:${powerPin}`,
          ['3V3'],
          partsById,
          componentsById
        )
      ) {
        errors.push(
          `SPI_COMMUNICATION_MODULE_3V3_MISSING: ${component.label} ${powerPin} must connect to Arduino 3V3, not 5V.`
        );
      }
    } else if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${powerPin}`,
        'power',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `SPI_COMMUNICATION_MODULE_POWER_MISSING: ${component.label} needs ${powerPin} connected to Arduino power.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${groundPin}`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `SPI_COMMUNICATION_MODULE_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`
      );
    }

    errors.push(
      ...validateProtocolPinConnection(
        spec,
        component,
        sckPin,
        'spi-clock',
        'D13',
        'SPI_COMMUNICATION_MODULE_CLOCK_MISSING',
        'SPI clock'
      )
    );
    errors.push(
      ...validateProtocolPinConnection(
        spec,
        component,
        mosiPin,
        'spi-mosi',
        'D11',
        'SPI_COMMUNICATION_MODULE_MOSI_MISSING',
        'SPI MOSI'
      )
    );
    if (misoPin) {
      errors.push(
        ...validateProtocolPinConnection(
          spec,
          component,
          misoPin,
          'spi-miso',
          'D12',
          'SPI_COMMUNICATION_MODULE_MISO_MISSING',
          'SPI MISO'
        )
      );
    }
    errors.push(
      ...validateProtocolPinConnection(
        spec,
        component,
        selectPin,
        'spi-select',
        'D10',
        'SPI_COMMUNICATION_MODULE_SELECT_MISSING',
        'SPI chip-select'
      )
    );
  }
  return errors;
}

export function validateDifferentialCommunicationModulePaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  for (const component of spec.components.filter((candidate) =>
    DIFFERENTIAL_COMMUNICATION_MODULE_PART_IDS.has(candidate.partId)
  )) {
    if (!hasDisplay) {
      errors.push(
        `COMMUNICATION_MODULE_DISPLAY_MISSING: ${component.label} bus-state readout needs an I2C text display in this supported topology.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:VCC`,
        'power',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `DIFFERENTIAL_COMMUNICATION_MODULE_POWER_MISSING: ${component.label} needs VCC connected to Arduino 5V.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:GND`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `DIFFERENTIAL_COMMUNICATION_MODULE_GROUND_MISSING: ${component.label} needs GND connected to Arduino GND.`
      );
    }

    const roConnection = findConnectionToControllerRole(spec, component.id, 'RO', 'serial-rx');
    if (
      !roConnection ||
      controllerPinFromConnection(spec, roConnection, component.id) !== 'D0/RX'
    ) {
      errors.push(
        `DIFFERENTIAL_COMMUNICATION_MODULE_RO_MISSING: ${component.label} RO must connect to Arduino D0/RX.`
      );
    } else if (!validUartSignalType(roConnection.signal)) {
      errors.push(
        `DIFFERENTIAL_COMMUNICATION_MODULE_SIGNAL_INVALID: ${component.label} RO must use a UART signal type.`
      );
    }

    const diConnection = findConnectionToControllerRole(spec, component.id, 'DI', 'serial-tx');
    if (
      !diConnection ||
      controllerPinFromConnection(spec, diConnection, component.id) !== 'D1/TX'
    ) {
      errors.push(
        `DIFFERENTIAL_COMMUNICATION_MODULE_DI_MISSING: ${component.label} DI must connect to Arduino D1/TX.`
      );
    } else if (!validUartSignalType(diConnection.signal)) {
      errors.push(
        `DIFFERENTIAL_COMMUNICATION_MODULE_SIGNAL_INVALID: ${component.label} DI must use a UART signal type.`
      );
    }

    const deConnection =
      findConnectionToControllerRole(spec, component.id, 'DE', 'digital-output') ??
      findConnectionToControllerRole(spec, component.id, 'DE', 'pwm-output');
    if (!deConnection) {
      errors.push(
        `DIFFERENTIAL_COMMUNICATION_MODULE_ENABLE_MISSING: ${component.label} DE must connect to an Arduino digital output such as D3.`
      );
    }
  }
  return errors;
}

export function validateProtocolSensorClaimSafety(spec: CircuitSpec) {
  const errors: string[] = [];
  const text = protocolSensorSafetyText(spec);
  const hasPart = (partId: string) =>
    spec.components.some((component) => component.partId === partId);

  if (
    hasPart('max30102-pulse') &&
    /\b(spo2|blood\s*oxygen|oxygen\s*saturation|diagnos(?:e|is|tic)|medical|patient|health\s*monitor|vital\s*sign)\b|산소\s*포화|산소포화|진단|의료|환자|건강\s*모니터|바이탈/i.test(
      text
    )
  ) {
    errors.push(
      'PROTOCOL_SENSOR_MEDICAL_UNSUPPORTED: MAX30102 is supported only as a qualitative classroom pulse readout, not medical, SpO2, diagnostic, or health-monitoring use.'
    );
  }
  if (
    hasPart('gps-neo6m') &&
    /\b(track(?:ing)?|navigation|navigate|autopilot|collision|route\s*guidance|fleet|locator|geofence)\b|위치\s*추적|추적|내비|네비|항법|자율\s*주행|자동\s*항법|충돌|경로\s*안내/i.test(
      text
    )
  ) {
    errors.push(
      'PROTOCOL_SENSOR_NAVIGATION_UNSUPPORTED: GPS is supported only as a qualitative classroom coordinate readout, not tracking, navigation, autopilot, or safety use.'
    );
  }
  if (
    hasPart('rc522-rfid') &&
    /\b(door\s*lock|access\s*control|security|payment|authenticate|authentication|unlock|alarm|badge\s*entry)\b|도어락|잠금|출입|보안|결제|인증|경보/i.test(
      text
    )
  ) {
    errors.push(
      'PROTOCOL_SENSOR_SECURITY_UNSUPPORTED: RC522 is supported only as a qualitative tag-read classroom demo, not access control, payment, authentication, or security use.'
    );
  }
  if (
    hasPart('hx711-loadcell') &&
    /\b(certified|legal\s*for\s*trade|exact\s*weight|calibrated|calibration\s*certificate|commercial\s*scale|precision\s*scale)\b|인증|상거래|정확한\s*무게|정밀\s*저울|계량|검정|보정/i.test(
      text
    )
  ) {
    errors.push(
      'PROTOCOL_SENSOR_CERTIFIED_MEASUREMENT_UNSUPPORTED: HX711 is supported only as a qualitative classroom load-cell readout, not certified, calibrated, or legal-for-trade measurement.'
    );
  }

  return errors;
}

export function validateCommunicationModuleClaimSafety(spec: CircuitSpec) {
  const errors: string[] = [];
  const text = protocolSensorSafetyText(spec);
  const hasCommunicationModule = spec.components.some((component) =>
    COMMUNICATION_MODULE_PART_IDS.has(component.partId)
  );
  const hasUsbHost = spec.components.some((component) => component.partId === 'usb-host-shield');
  const hasWireless = spec.components.some((component) =>
    WIRELESS_COMMUNICATION_MODULE_PART_IDS.has(component.partId)
  );

  if (
    hasWireless &&
    /\b(cloud|internet|backend|phone\s*pairing|pair(?:ing)?\s*with\s*my\s*phone|sms|call|cellular\s*service|real\s+range|tracking|tracker|security|door\s*lock)\b|클라우드|인터넷|문자|전화|추적|보안|도어락/i.test(
      text
    )
  ) {
    errors.push(
      'COMMUNICATION_MODULE_NETWORK_UNSUPPORTED: wireless modules are supported only as local command/bus state, not real cloud, phone, SMS/call, tracking, security, or RF range behavior.'
    );
  }
  if (
    hasUsbHost &&
    /\b(enumerat(?:e|ion)|keyboard|mouse|storage|hid|flash\s*drive|real\s+usb|device\s*driver)\b|키보드|마우스|저장장치|실제\s*USB/i.test(
      text
    )
  ) {
    errors.push(
      'COMMUNICATION_MODULE_USB_HOST_UNSUPPORTED: USB host shield is supported only as local SPI status, not real USB device enumeration or HID/storage behavior.'
    );
  }
  if (
    hasCommunicationModule &&
    /\b(certified|industrial\s+network|vehicle\s+control|safety\s+critical|production\s+network)\b|인증|산업용\s*네트워크|차량\s*제어|안전\s*필수/i.test(
      text
    )
  ) {
    errors.push(
      'COMMUNICATION_MODULE_CERTIFIED_NETWORK_UNSUPPORTED: communication modules are classroom simulations and cannot claim certified, industrial, vehicle-control, or safety-critical networking.'
    );
  }

  return errors;
}

export function validateLogicInterfaceContextPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);

  for (const component of spec.components.filter((candidate) =>
    LOGIC_INTERFACE_PART_IDS.has(candidate.partId)
  )) {
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
      errors.push(
        `LOGIC_INTERFACE_DISPLAY_MISSING: ${component.label} state readout needs an I2C text display in this supported topology.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${powerPin}`,
        'power',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `LOGIC_INTERFACE_POWER_MISSING: ${component.label} needs ${powerPin} connected to Arduino power.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:${groundPin}`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `LOGIC_INTERFACE_GROUND_MISSING: ${component.label} needs ${groundPin} connected to Arduino GND.`
      );
    }

    if (I2C_LOGIC_INTERFACE_PART_IDS.has(component.partId)) {
      const sdaPin = firstPinNameForRole(part, (role) => role === 'i2c-data') ?? 'SDA';
      const sclPin = firstPinNameForRole(part, (role) => role === 'i2c-clock') ?? 'SCL';
      errors.push(
        ...validateI2cInterfacePinConnection(
          spec,
          component,
          sdaPin,
          'i2c-data',
          'A4/SDA',
          'LOGIC_INTERFACE_SDA_MISSING',
          'I2C SDA'
        )
      );
      errors.push(
        ...validateI2cInterfacePinConnection(
          spec,
          component,
          sclPin,
          'i2c-clock',
          'A5/SCL',
          'LOGIC_INTERFACE_SCL_MISSING',
          'I2C SCL'
        )
      );
    }

    if (SPI_LOGIC_INTERFACE_PART_IDS.has(component.partId)) {
      const clockPin = firstPinNameForRole(part, (role) => role === 'spi-clock') ?? 'CLK';
      const mosiPin = firstPinNameForRole(part, (role) => role === 'spi-mosi') ?? 'DIN';
      const misoPin = firstPinNameForRole(part, (role) => role === 'spi-miso') ?? 'DOUT';
      const selectPin = firstPinNameForRole(part, (role) => role === 'spi-select') ?? 'CS';
      errors.push(
        ...validateProtocolPinConnection(
          spec,
          component,
          clockPin,
          'spi-clock',
          'D13',
          'LOGIC_INTERFACE_SPI_CLOCK_MISSING',
          'SPI clock'
        )
      );
      errors.push(
        ...validateProtocolPinConnection(
          spec,
          component,
          mosiPin,
          'spi-mosi',
          'D11',
          'LOGIC_INTERFACE_SPI_MOSI_MISSING',
          'SPI MOSI'
        )
      );
      errors.push(
        ...validateProtocolPinConnection(
          spec,
          component,
          misoPin,
          'spi-miso',
          'D12',
          'LOGIC_INTERFACE_SPI_MISO_MISSING',
          'SPI MISO'
        )
      );
      errors.push(
        ...validateProtocolPinConnection(
          spec,
          component,
          selectPin,
          'spi-select',
          'D10',
          'LOGIC_INTERFACE_SPI_SELECT_MISSING',
          'SPI chip-select'
        )
      );
    }

    if (SHIFT_REGISTER_INTERFACE_PART_IDS.has(component.partId)) {
      for (const { pin, label } of [
        { pin: 'SER', label: 'serial data' },
        { pin: 'SRCLK', label: 'shift clock' },
        { pin: 'RCLK', label: 'latch clock' }
      ]) {
        if (
          !findConnectedControllerEndpointWithAnyRole(spec, component.id, pin, [
            'digital-output',
            'pwm-output',
            'spi-mosi',
            'spi-clock',
            'spi-select'
          ])
        ) {
          errors.push(
            `LOGIC_INTERFACE_SIGNAL_MISSING: ${component.label} ${pin} must connect to an Arduino output for ${label}.`
          );
        }
      }
    }

    if (ANALOG_TIMING_INTERFACE_PART_IDS.has(component.partId)) {
      const outputPin =
        firstPinNameForRole(
          part,
          (role) => role === 'digital-output' || role === 'analog-output'
        ) ?? 'OUT';
      if (
        !findConnectedControllerEndpointWithAnyRole(spec, component.id, outputPin, [
          'digital-input',
          'analog-input'
        ])
      ) {
        errors.push(
          `LOGIC_INTERFACE_OUTPUT_MISSING: ${component.label} ${outputPin} must connect to an Arduino input for qualitative state display.`
        );
      }
    }
  }

  return errors;
}

export function validateI2cInterfacePinConnection(
  spec: CircuitSpec,
  component: CircuitSpec['components'][number],
  targetPin: string,
  controllerRole: 'i2c-data' | 'i2c-clock',
  expectedControllerPin: string,
  errorCode: string,
  label: string
) {
  const connection = findConnectionToControllerRole(spec, component.id, targetPin, controllerRole);
  const controllerPin = connection
    ? controllerPinFromConnection(spec, connection, component.id)
    : null;
  if (!connection || controllerPin !== expectedControllerPin) {
    return [
      `${errorCode}: ${component.label} ${targetPin} must connect to Arduino ${expectedControllerPin} for ${label}.`
    ];
  }
  const role = controllerRole === 'i2c-data' ? 'data' : 'clock';
  if (!validI2cSignalType(connection.signal, role)) {
    return [
      `LOGIC_INTERFACE_I2C_SIGNAL_INVALID: ${component.label} ${targetPin} must use an I2C ${role} signal type.`
    ];
  }
  return [];
}

export function validateLevelShifterContextPath(
  spec: CircuitSpec,
  component: CircuitSpec['components'][number],
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  if (
    !endpointReachesControllerPin(spec, `${component.id}:HV`, ['5V'], partsById, componentsById)
  ) {
    errors.push(
      `LEVEL_SHIFTER_HV_MISSING: ${component.label} HV must connect to Arduino 5V for the high-side reference.`
    );
  }
  if (
    !endpointReachesControllerPin(spec, `${component.id}:LV`, ['3V3'], partsById, componentsById)
  ) {
    errors.push(
      `LEVEL_SHIFTER_LV_MISSING: ${component.label} LV must connect to Arduino 3V3 for the low-side reference.`
    );
  }
  if (
    !endpointReachesControllerRole(spec, `${component.id}:GND`, 'ground', partsById, componentsById)
  ) {
    errors.push(
      `LEVEL_SHIFTER_GROUND_MISSING: ${component.label} needs GND connected to Arduino GND.`
    );
  }
  const hasHighSignal = findConnectedControllerEndpointWithAnyRole(spec, component.id, 'HV1', [
    'digital-output',
    'digital-input',
    'i2c-data',
    'i2c-clock'
  ]);
  const hasLowSignal = findConnectedControllerEndpointWithAnyRole(spec, component.id, 'LV1', [
    'digital-output',
    'digital-input',
    'i2c-data',
    'i2c-clock'
  ]);
  if (!hasHighSignal && !hasLowSignal) {
    errors.push(
      `LEVEL_SHIFTER_SIGNAL_MISSING: ${component.label} needs the visible HV1/LV1 signal pair connected for qualitative level-shift state.`
    );
  }
  return errors;
}

export function validateLogicInterfaceClaimSafety(spec: CircuitSpec) {
  const errors: string[] = [];
  const text = protocolSensorSafetyText(spec);
  const hasLogicInterface = spec.components.some((component) =>
    LOGIC_INTERFACE_PART_IDS.has(component.partId)
  );
  if (!hasLogicInterface) {
    return errors;
  }

  if (
    spec.components.some(
      (component) =>
        component.partId === 'ads1115-adc' ||
        component.partId === 'mcp3008-adc' ||
        component.partId === 'lm358-opamp'
    ) &&
    /\b(calibrated|precision|certified|exact\s+voltage|legal\s+for\s+trade|medical|rail-?to-?rail|spice|audio\s+power|instrumentation)\b|정밀|보정|인증|정확한\s*전압|의료|계측/i.test(
      text
    )
  ) {
    errors.push(
      'LOGIC_INTERFACE_PRECISION_ANALOG_UNSUPPORTED: ADC and op-amp parts are supported only as qualitative classroom interface state, not calibrated precision analog design.'
    );
  }
  if (
    spec.components.some((component) => component.partId === 'ne555-timer') &&
    /\b(exact|calibrated|precise|precision)\b.*\b(frequency|hz|duty\s*cycle|waveform)\b|정확|정밀|보정|주파수|듀티|파형/i.test(
      text
    )
  ) {
    errors.push(
      'LOGIC_INTERFACE_TIMER_FREQUENCY_UNSUPPORTED: NE555 is supported only as qualitative timing state, not exact calibrated frequency, duty cycle, or waveform simulation.'
    );
  }
  if (
    spec.components.some((component) => component.partId === 'i2c-level-shifter') &&
    /\b(power\s+regulator|voltage\s+regulator|current\s+booster|boost\s+current|power\s+supply)\b|전원\s*공급|레귤레이터|전류\s*증폭/i.test(
      text
    )
  ) {
    errors.push(
      'LOGIC_INTERFACE_LEVEL_SHIFT_UNSUPPORTED: level shifters are supported only as qualitative signal voltage-domain context, not power regulation or current boosting.'
    );
  }

  return errors;
}

export function validateDigitalInputStatePaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  for (const component of spec.components.filter((candidate) =>
    DIGITAL_INPUT_STATE_PART_IDS.has(candidate.partId)
  )) {
    const part = partsById.get(component.partId);
    if (!part) {
      continue;
    }

    const signalPin = digitalInputSignalPinForComponent(spec, component, part);
    if (!signalPin) {
      errors.push(
        `DIGITAL_INPUT_SIGNAL_PIN_MISSING: ${component.label} needs a signal terminal connected to an Arduino digital input such as D2.`
      );
      continue;
    }

    const signalConnection = findConnectionToControllerRole(
      spec,
      component.id,
      signalPin,
      'digital-input'
    );
    if (!signalConnection) {
      errors.push(
        `DIGITAL_INPUT_SIGNAL_MISSING: ${component.label} ${signalPin} must connect to an Arduino digital input such as D2.`
      );
    } else if (!validDigitalInputSignalType(signalConnection.signal, component.partId)) {
      errors.push(
        `DIGITAL_INPUT_SIGNAL_TYPE_INVALID: ${component.label} ${signalPin} must use a digital or pulse signal type.`
      );
    }

    if (PASSIVE_DIGITAL_SWITCH_PART_IDS.has(component.partId)) {
      const referencePins = part.pins.map((pin) => pin.name).filter((pin) => pin !== signalPin);
      if (
        !referencePins.some((pin) =>
          endpointReachesControllerRole(
            spec,
            `${component.id}:${pin}`,
            'ground',
            partsById,
            componentsById
          )
        )
      ) {
        errors.push(
          `DIGITAL_INPUT_REFERENCE_MISSING: ${component.label} needs a second switch terminal tied to Arduino GND or another defined reference.`
        );
      }
      continue;
    }

    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:VCC`,
        'power',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `DIGITAL_SENSOR_POWER_MISSING: ${component.label} needs VCC connected to Arduino 5V.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:GND`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `DIGITAL_SENSOR_GROUND_MISSING: ${component.label} needs GND connected to Arduino GND.`
      );
    }

    if (PULSE_DIGITAL_SENSOR_PART_IDS.has(component.partId)) {
      const controlPins = part.pins
        .filter((pin) => pin.role === 'digital-control')
        .map((pin) => pin.name);
      for (const controlPin of controlPins) {
        if (
          !endpointReachesAnyControllerRole(
            spec,
            `${component.id}:${controlPin}`,
            ['digital-output', 'pwm-output'],
            partsById,
            componentsById
          )
        ) {
          errors.push(
            `PULSE_SENSOR_CONTROL_MISSING: ${component.label} ${controlPin} must connect to an Arduino digital output in this supported topology.`
          );
        }
      }
    }
  }
  return errors;
}

export function validDigitalInputSignalType(signal: string, partId: string) {
  const normalized = signal.toLowerCase();
  if (PULSE_DIGITAL_SENSOR_PART_IDS.has(partId)) {
    return ['pulse', 'digital-pulse', 'digital', 'gpio'].includes(normalized);
  }
  return ['digital', 'gpio', 'button'].includes(normalized);
}

export function validateMatrixInputDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const matrixComponents = spec.components.filter((candidate) =>
    MATRIX_INPUT_PART_IDS.has(candidate.partId)
  );
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
      errors.push(
        `MATRIX_INPUT_DISPLAY_MISSING: ${component.label} state readout needs an I2C text display in this supported topology.`
      );
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

export function validateRowColumnMatrixInput(
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
    const controllerPin = connection
      ? controllerPinFromConnection(spec, connection, component.id)
      : null;
    if (!connection || !controllerPin) {
      errors.push(
        `MATRIX_INPUT_ROW_MISSING: ${component.label} ${rowPin} must connect to a distinct Arduino digital scan output.`
      );
      continue;
    }
    if (!validMatrixInputSignalType(connection.signal)) {
      errors.push(
        `MATRIX_INPUT_SIGNAL_TYPE_INVALID: ${component.label} ${rowPin} scan line must use a digital or gpio signal type.`
      );
    }
    controllerPins.push(controllerPin);
  }

  for (const columnPin of columnPins) {
    const connection = findConnectionToControllerRole(
      spec,
      component.id,
      columnPin,
      'digital-input'
    );
    const controllerPin = connection
      ? controllerPinFromConnection(spec, connection, component.id)
      : null;
    if (!connection || !controllerPin) {
      errors.push(
        `MATRIX_INPUT_COLUMN_MISSING: ${component.label} ${columnPin} must connect to a distinct Arduino digital sense input.`
      );
      continue;
    }
    if (!validMatrixInputSignalType(connection.signal)) {
      errors.push(
        `MATRIX_INPUT_SIGNAL_TYPE_INVALID: ${component.label} ${columnPin} sense line must use a digital or gpio signal type.`
      );
    }
    controllerPins.push(controllerPin);
  }

  errors.push(
    ...duplicateControllerPinErrors(
      controllerPins,
      `MATRIX_INPUT_LINES_NOT_DISTINCT: ${component.label} row and column lines must use distinct Arduino pins.`
    )
  );
  return errors;
}

export function validateDipSwitchInput(
  spec: CircuitSpec,
  component: CircuitSpec['components'][number],
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const controllerPins: string[] = [];
  for (const index of [1, 2, 3, 4]) {
    const pair = [`S${index}A`, `S${index}B`];
    const signalPins = pair.filter((pin) =>
      findConnectionToControllerRole(spec, component.id, pin, 'digital-input')
    );
    const referencePins = pair.filter((pin) =>
      endpointReachesControllerRole(
        spec,
        `${component.id}:${pin}`,
        'ground',
        partsById,
        componentsById
      )
    );

    if (signalPins.length !== 1) {
      errors.push(
        `MATRIX_INPUT_SWITCH_SIGNAL_MISSING: ${component.label} switch ${index} needs exactly one terminal connected to an Arduino digital input.`
      );
      continue;
    }
    if (referencePins.length !== 1) {
      errors.push(
        `MATRIX_INPUT_REFERENCE_MISSING: ${component.label} switch ${index} needs the paired terminal tied to Arduino GND.`
      );
      continue;
    }

    const connection = findConnectionToControllerRole(
      spec,
      component.id,
      signalPins[0],
      'digital-input'
    );
    const controllerPin = connection
      ? controllerPinFromConnection(spec, connection, component.id)
      : null;
    if (connection && !validMatrixInputSignalType(connection.signal)) {
      errors.push(
        `MATRIX_INPUT_SIGNAL_TYPE_INVALID: ${component.label} switch ${index} input must use a digital or gpio signal type.`
      );
    }
    if (controllerPin) {
      controllerPins.push(controllerPin);
    }
  }

  errors.push(
    ...duplicateControllerPinErrors(
      controllerPins,
      `MATRIX_INPUT_LINES_NOT_DISTINCT: ${component.label} switch inputs must use distinct Arduino pins.`
    )
  );
  return errors;
}

export function validateMembraneKeypadInput(
  spec: CircuitSpec,
  component: CircuitSpec['components'][number],
  part: PartCapability,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const controllerPins: string[] = [];
  if (
    !endpointReachesControllerRole(spec, `${component.id}:COM`, 'ground', partsById, componentsById)
  ) {
    errors.push(
      `MATRIX_INPUT_REFERENCE_MISSING: ${component.label} COM must connect to Arduino GND as the shared key reference.`
    );
  }

  for (const pin of part.pins
    .filter((candidate) => candidate.role === 'switch-terminal')
    .map((candidate) => candidate.name)) {
    const connection = findConnectionToControllerRole(spec, component.id, pin, 'digital-input');
    const controllerPin = connection
      ? controllerPinFromConnection(spec, connection, component.id)
      : null;
    if (!connection || !controllerPin) {
      errors.push(
        `MATRIX_INPUT_KEY_SIGNAL_MISSING: ${component.label} ${pin} must connect to a distinct Arduino digital input.`
      );
      continue;
    }
    if (!validMatrixInputSignalType(connection.signal)) {
      errors.push(
        `MATRIX_INPUT_SIGNAL_TYPE_INVALID: ${component.label} ${pin} must use a digital or gpio signal type.`
      );
    }
    controllerPins.push(controllerPin);
  }

  errors.push(
    ...duplicateControllerPinErrors(
      controllerPins,
      `MATRIX_INPUT_LINES_NOT_DISTINCT: ${component.label} key inputs must use distinct Arduino pins.`
    )
  );
  return errors;
}

export function validateJoystickDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  for (const component of spec.components.filter((candidate) =>
    JOYSTICK_PART_IDS.has(candidate.partId)
  )) {
    if (!hasDisplay) {
      errors.push(
        `JOYSTICK_DISPLAY_MISSING: ${component.label} position readout needs an I2C text display in this supported topology.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:VCC`,
        'power',
        partsById,
        componentsById
      )
    ) {
      errors.push(`JOYSTICK_POWER_MISSING: ${component.label} needs VCC connected to Arduino 5V.`);
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:GND`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `JOYSTICK_GROUND_MISSING: ${component.label} needs GND connected to Arduino GND.`
      );
    }

    const vrx = findConnectionToControllerRole(spec, component.id, 'VRX', 'analog-input');
    const vry = findConnectionToControllerRole(spec, component.id, 'VRY', 'analog-input');
    const sw = findConnectionToControllerRole(spec, component.id, 'SW', 'digital-input');
    const axisPins = [vrx, vry]
      .map((connection) =>
        connection ? controllerPinFromConnection(spec, connection, component.id) : null
      )
      .filter((pin): pin is string => Boolean(pin));

    if (!vrx) {
      errors.push(
        `JOYSTICK_AXIS_MISSING: ${component.label} VRX must connect to an Arduino analog input such as A0.`
      );
    } else if (vrx.signal !== 'analog') {
      errors.push(
        `JOYSTICK_AXIS_SIGNAL_TYPE_INVALID: ${component.label} VRX must use the analog signal type.`
      );
    }
    if (!vry) {
      errors.push(
        `JOYSTICK_AXIS_MISSING: ${component.label} VRY must connect to a second Arduino analog input such as A1.`
      );
    } else if (vry.signal !== 'analog') {
      errors.push(
        `JOYSTICK_AXIS_SIGNAL_TYPE_INVALID: ${component.label} VRY must use the analog signal type.`
      );
    }
    if (axisPins.length === 2 && axisPins[0] === axisPins[1]) {
      errors.push(
        `JOYSTICK_AXIS_PINS_NOT_DISTINCT: ${component.label} VRX and VRY must use two distinct Arduino analog input pins.`
      );
    }
    if (!sw) {
      errors.push(
        `JOYSTICK_SWITCH_MISSING: ${component.label} SW must connect to an Arduino digital input.`
      );
    } else if (!validMatrixInputSignalType(sw.signal)) {
      errors.push(
        `JOYSTICK_SWITCH_SIGNAL_TYPE_INVALID: ${component.label} SW must use a digital or gpio signal type.`
      );
    }
  }
  return unique(errors);
}

export function validateRotaryEncoderDisplayPaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const errors: string[] = [];
  const hasDisplay = hasI2cTextDisplay(spec);
  for (const component of spec.components.filter((candidate) =>
    ROTARY_ENCODER_PART_IDS.has(candidate.partId)
  )) {
    if (!hasDisplay) {
      errors.push(
        `ROTARY_ENCODER_DISPLAY_MISSING: ${component.label} count readout needs an I2C text display in this supported topology.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:VCC`,
        'power',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `ROTARY_ENCODER_POWER_MISSING: ${component.label} needs VCC connected to Arduino 5V.`
      );
    }
    if (
      !endpointReachesControllerRole(
        spec,
        `${component.id}:GND`,
        'ground',
        partsById,
        componentsById
      )
    ) {
      errors.push(
        `ROTARY_ENCODER_GROUND_MISSING: ${component.label} needs GND connected to Arduino GND.`
      );
    }

    const controllerPins: string[] = [];
    for (const pin of ['CLK', 'DT', 'SW']) {
      const connection = findConnectionToControllerRole(spec, component.id, pin, 'digital-input');
      const controllerPin = connection
        ? controllerPinFromConnection(spec, connection, component.id)
        : null;
      if (!connection || !controllerPin) {
        errors.push(
          `ROTARY_ENCODER_SIGNAL_MISSING: ${component.label} ${pin} must connect to a distinct Arduino digital input.`
        );
        continue;
      }
      if (!validMatrixInputSignalType(connection.signal)) {
        errors.push(
          `ROTARY_ENCODER_SIGNAL_TYPE_INVALID: ${component.label} ${pin} must use a digital or gpio signal type.`
        );
      }
      controllerPins.push(controllerPin);
    }

    errors.push(
      ...duplicateControllerPinErrors(
        controllerPins,
        `ROTARY_ENCODER_PINS_NOT_DISTINCT: ${component.label} CLK, DT, and SW must use distinct Arduino digital input pins.`
      )
    );
  }
  return unique(errors);
}

export function validMatrixInputSignalType(signal: string) {
  return ['digital', 'gpio', 'button'].includes(signal.toLowerCase());
}

export function validI2cSignalType(signal: string, role: 'data' | 'clock') {
  const normalized = signal.toLowerCase();
  return (
    normalized === 'i2c' ||
    (role === 'data' && ['i2c-data', 'data'].includes(normalized)) ||
    (role === 'clock' && ['i2c-clock', 'clock'].includes(normalized))
  );
}

export function validClockedDataSignalType(signal: string) {
  return [
    'clocked-data',
    'digital-data',
    'digital-clock',
    'digital',
    'gpio',
    'data',
    'clock'
  ].includes(signal.toLowerCase());
}

export function validSpiSignalType(signal: string, controllerRole: string) {
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

export function validUartSignalType(signal: string) {
  return ['uart', 'serial', 'nmea', 'serial-data'].includes(signal.toLowerCase());
}

export function validateProtocolPinConnection(
  spec: CircuitSpec,
  component: CircuitSpec['components'][number],
  targetPin: string,
  controllerRole: string,
  expectedControllerPin: string,
  errorCode: string,
  label: string
) {
  const connection = findConnectionToControllerRole(spec, component.id, targetPin, controllerRole);
  const controllerPin = connection
    ? controllerPinFromConnection(spec, connection, component.id)
    : null;
  if (!connection || controllerPin !== expectedControllerPin) {
    return [
      `${errorCode}: ${component.label} ${targetPin} must connect to Arduino ${expectedControllerPin} for ${label}.`
    ];
  }
  if (!validSpiSignalType(connection.signal, controllerRole)) {
    return [
      `SPI_PROTOCOL_SENSOR_SIGNAL_INVALID: ${component.label} ${targetPin} must use an SPI signal type for ${label}.`
    ];
  }
  return [];
}

export function protocolSensorSafetyText(spec: CircuitSpec) {
  const negatedAssumptionPattern =
    /\b(not|no|never|unsupported|blocked|forbidden|avoid|do\s+not|don't|educational\s+only|classroom\s+only|not\s+for)\b|아님|미지원|차단|금지|교육용/i;
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

export function controllerPinFromConnection(
  spec: CircuitSpec,
  connection: CircuitSpec['connections'][number],
  targetId: string
) {
  const endpoint = [connection.from, connection.to].find((candidate) => {
    if (candidate.componentId === targetId) {
      return false;
    }
    const component = spec.components.find(
      (specComponent) => specComponent.id === candidate.componentId
    );
    return component?.partId === 'arduino-uno';
  });
  return endpoint?.pin ?? null;
}

export function duplicateControllerPinErrors(controllerPins: string[], message: string) {
  return controllerPins.length === new Set(controllerPins).size ? [] : [message];
}

export function endpointReachesControllerPin(
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

export function endpointReachesRoleInGraph(
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
    return Boolean(
      component &&
      componentPredicate(component) &&
      rolePredicate(roleFor(endpoint, componentsById, partsById))
    );
  });
}

export function reachablePartIdsByRoleInGraph(
  graph: Map<string, Set<string>>,
  startKey: string,
  rolePredicate: (role: string) => boolean,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  return unique(
    [...reachableEndpointKeys(graph, [startKey])].map((key) => {
      const endpoint = endpointFromKey(key);
      const component = componentsById.get(endpoint.componentId);
      if (!component || !rolePredicate(roleFor(endpoint, componentsById, partsById))) {
        return '';
      }
      return component.partId;
    })
  );
}

export function controllerEndpointKeysWithRole(
  spec: CircuitSpec,
  controllerRoles: string[],
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  return unique(
    spec.connections
      .flatMap((connection) => [connection.from, connection.to])
      .filter((endpoint) => {
        const component = componentsById.get(endpoint.componentId);
        return (
          component?.partId === 'arduino-uno' &&
          controllerRoles.includes(roleFor(endpoint, componentsById, partsById))
        );
      })
      .map(endpointKey)
  );
}

export function hasPathThroughReferenceResistorToGround(
  spec: CircuitSpec,
  graph: Map<string, Set<string>>,
  startKey: string,
  referenceIds: string[],
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const groundKeys = controllerEndpointKeysWithRole(spec, ['ground'], partsById, componentsById);
  return groundKeys.some(
    (groundKey) =>
      componentIdsOnPathThroughAnyComponent(graph, [startKey], groundKey, referenceIds).length > 0
  );
}

export function findConnectionFromReachableEndpointToControllerRole(
  spec: CircuitSpec,
  graph: Map<string, Set<string>>,
  startKey: string,
  controllerRole: string,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const reachable = reachableEndpointKeys(graph, [startKey]);
  return (
    spec.connections.find((candidate) => {
      const endpoints = [candidate.from, candidate.to];
      return (
        endpoints.some((endpoint) => reachable.has(endpointKey(endpoint))) &&
        endpoints.some((endpoint) => {
          const component = componentsById.get(endpoint.componentId);
          return (
            component?.partId === 'arduino-uno' &&
            roleFor(endpoint, componentsById, partsById) === controllerRole
          );
        })
      );
    }) ?? null
  );
}

export function hasPwmLedOutputPath(
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
    .some(
      (led) =>
        componentIdsOnPathThroughAnyComponent(graph, pwmSources, `${led.id}:A`, resistorIds)
          .length > 0
    );
}

export function hasAnalogThresholdOutputPath(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  return spec.components
    .filter((component) => component.partId === 'led-5mm')
    .some((led) => {
      const path = findLedSeriesPath(spec, led.id, partsById, componentsById);
      return (
        path.hasControllerSource &&
        path.hasAnodeEntry &&
        path.hasSeriesResistor &&
        path.hasCathodeGroundReturn &&
        !path.hasReversedPolarity
      );
    });
}

export function findLedSeriesPath(
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
  const seriesResistorIds = componentIdsOnPathThroughAnyComponent(
    graph,
    controllerSources,
    anodeKey,
    resistorIds
  );

  return {
    seriesResistorIds,
    hasControllerSource: controllerSources.length > 0,
    hasAnodeEntry: reachableFromSources.has(anodeKey),
    hasSeriesResistor: seriesResistorIds.length > 0,
    hasCathodeGroundReturn: [...reachableFromCathode].some((key) => {
      const endpoint = endpointFromKey(key);
      return (
        controllerIds.has(endpoint.componentId) &&
        roleFor(endpoint, componentsById, partsById) === 'ground'
      );
    }),
    hasReversedPolarity: reachableFromSources.has(cathodeKey)
  };
}

export function componentHasGround(
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
    if (
      endpoint &&
      endpoint.componentId !== componentId &&
      isSourceGround(endpoint, componentsById, partsById)
    ) {
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

export function isGroundReturnRole(role: string) {
  return (
    isGroundRole(role) || role === 'cathode' || role === 'negative' || role === 'switch-terminal'
  );
}

export function isSourceGround(
  endpoint: CircuitEndpoint,
  componentsById: Map<string, CircuitSpec['components'][number]>,
  partsById: Map<string, PartCapability>
) {
  const component = componentsById.get(endpoint.componentId);
  const part = component ? partsById.get(component.partId) : undefined;
  return part?.kind === 'controller' && roleFor(endpoint, componentsById, partsById) === 'ground';
}

export async function inferCurrentPathIds(spec: CircuitSpec) {
  const contexts = await simulationContextsForSpec(spec);
  return compileCurrentPathsForContexts(spec, contexts).map((path) => path.id);
}

export async function inferTopologyTemplateForSpec(spec: CircuitSpec) {
  const partIds = new Set(spec.components.map((component) => component.partId));
  const hasAnalogDimmerInput = spec.components.some((component) =>
    ANALOG_DIMMER_INPUT_PART_IDS.has(component.partId)
  );
  const hasAnalogSensorModule = spec.components.some((component) =>
    ANALOG_SENSOR_MODULE_PART_IDS.has(component.partId)
  );
  const hasResistiveSensor = spec.components.some((component) =>
    RESISTIVE_SENSOR_PART_IDS.has(component.partId)
  );
  const hasDistanceSensor = spec.components.some((component) =>
    DISTANCE_SENSOR_PART_IDS.has(component.partId)
  );
  const hasSingleWireSensor = spec.components.some((component) =>
    SINGLE_WIRE_SENSOR_PART_IDS.has(component.partId)
  );
  const hasI2cProtocolSensor = spec.components.some((component) =>
    I2C_PROTOCOL_SENSOR_PART_IDS.has(component.partId)
  );
  const hasClockedDataSensor = spec.components.some((component) =>
    CLOCKED_DATA_SENSOR_PART_IDS.has(component.partId)
  );
  const hasSpiProtocolSensor = spec.components.some((component) =>
    SPI_PROTOCOL_SENSOR_PART_IDS.has(component.partId)
  );
  const hasUartProtocolSensor = spec.components.some((component) =>
    UART_PROTOCOL_SENSOR_PART_IDS.has(component.partId)
  );
  const hasUartCommunicationModule = spec.components.some((component) =>
    UART_COMMUNICATION_MODULE_PART_IDS.has(component.partId)
  );
  const hasSpiCommunicationModule = spec.components.some((component) =>
    SPI_COMMUNICATION_MODULE_PART_IDS.has(component.partId)
  );
  const hasDifferentialCommunicationModule = spec.components.some((component) =>
    DIFFERENTIAL_COMMUNICATION_MODULE_PART_IDS.has(component.partId)
  );
  const hasShiftRegisterInterface = spec.components.some((component) =>
    SHIFT_REGISTER_INTERFACE_PART_IDS.has(component.partId)
  );
  const hasI2cLogicInterface = spec.components.some((component) =>
    I2C_LOGIC_INTERFACE_PART_IDS.has(component.partId)
  );
  const hasSpiLogicInterface = spec.components.some((component) =>
    SPI_LOGIC_INTERFACE_PART_IDS.has(component.partId)
  );
  const hasAnalogTimingInterface = spec.components.some((component) =>
    ANALOG_TIMING_INTERFACE_PART_IDS.has(component.partId)
  );
  const hasLevelShifterInterface = spec.components.some((component) =>
    LEVEL_SHIFTER_INTERFACE_PART_IDS.has(component.partId)
  );
  const hasDigitalInputState = spec.components.some((component) =>
    DIGITAL_INPUT_STATE_PART_IDS.has(component.partId)
  );
  const hasPulseDigitalSensor = spec.components.some((component) =>
    PULSE_DIGITAL_SENSOR_PART_IDS.has(component.partId)
  );
  const hasMatrixInput = spec.components.some((component) =>
    MATRIX_INPUT_PART_IDS.has(component.partId)
  );
  const hasJoystick = spec.components.some((component) => JOYSTICK_PART_IDS.has(component.partId));
  const hasRotaryEncoder = spec.components.some((component) =>
    ROTARY_ENCODER_PART_IDS.has(component.partId)
  );
  const hasBareSevenSegmentDisplay = spec.components.some((component) =>
    BARE_SEVEN_SEGMENT_DISPLAY_PART_IDS.has(component.partId)
  );
  const hasLedArrayDisplay = spec.components.some((component) =>
    LED_ARRAY_DISPLAY_PART_IDS.has(component.partId)
  );
  const hasAddressableLedDisplay = spec.components.some((component) =>
    ADDRESSABLE_LED_DISPLAY_PART_IDS.has(component.partId)
  );
  const hasSpiDisplay = spec.components.some((component) =>
    SPI_DISPLAY_PART_IDS.has(component.partId)
  );
  const hasDirectLowCurrentLoad = spec.components.some((component) =>
    DIRECT_LOW_CURRENT_LOAD_PART_IDS.has(component.partId)
  );
  const hasRgbLed = spec.components.some((component) => RGB_LED_PART_IDS.has(component.partId));
  const hasPoweredLightModule = spec.components.some((component) =>
    POWERED_LIGHT_MODULE_PART_IDS.has(component.partId)
  );
  const hasHighTorqueServo = spec.components.some((component) =>
    HIGH_TORQUE_SERVO_PART_IDS.has(component.partId)
  );
  const hasServoActuator = spec.components.some((component) =>
    SERVO_ACTUATOR_PART_IDS.has(component.partId)
  );
  const hasLowSideLoad = spec.components.some((component) =>
    LOW_SIDE_LOAD_PART_IDS.has(component.partId)
  );
  const hasDiscreteLowSideDriver = spec.components.some((component) =>
    LOW_SIDE_DISCRETE_DRIVER_PART_IDS.has(component.partId)
  );
  const hasMosfetLowSideDriver = spec.components.some((component) =>
    LOW_SIDE_MOSFET_MODULE_PART_IDS.has(component.partId)
  );
  const hasIntegratedLowSideLoad = spec.components.some((component) =>
    LOW_SIDE_INTEGRATED_LOAD_PART_IDS.has(component.partId)
  );
  const hasUnipolarStepper = spec.components.some((component) =>
    UNIPOLAR_STEPPER_MOTOR_PART_IDS.has(component.partId)
  );
  const hasBipolarStepper = spec.components.some((component) =>
    BIPOLAR_STEPPER_MOTOR_PART_IDS.has(component.partId)
  );
  const hasUln2003StepperDriver = spec.components.some((component) =>
    ULN2003_STEPPER_DRIVER_PART_IDS.has(component.partId)
  );
  const hasStepDirStepperDriver = spec.components.some((component) =>
    STEP_DIR_STEPPER_DRIVER_PART_IDS.has(component.partId)
  );
  const hasHBridgeDriver = spec.components.some((component) =>
    HBRIDGE_DRIVER_PART_IDS.has(component.partId)
  );
  const hasHBridgeMotorLoad = spec.components.some((component) =>
    HBRIDGE_MOTOR_LOAD_PART_IDS.has(component.partId)
  );
  const hasRelayModule = spec.components.some((component) =>
    RELAY_MODULE_PART_IDS.has(component.partId)
  );
  const hasLowVoltagePowerSource = spec.components.some((component) =>
    LOW_VOLTAGE_POWER_SOURCE_PART_IDS.has(component.partId)
  );
  const hasVoltageRegulator = spec.components.some((component) =>
    VOLTAGE_REGULATOR_PART_IDS.has(component.partId)
  );
  const hasPassiveProtectionContext = spec.components.some((component) =>
    PASSIVE_PROTECTION_CONTEXT_PART_IDS.has(component.partId)
  );
  const hasTimingPassiveContext = spec.components.some((component) =>
    TIMING_PASSIVE_CONTEXT_PART_IDS.has(component.partId)
  );
  const hasPrototypingSurfaceContext = spec.components.some((component) =>
    PROTOTYPING_SURFACE_CONTEXT_PART_IDS.has(component.partId)
  );
  const hasConnectorWiringContext = spec.components.some((component) =>
    CONNECTOR_WIRING_CONTEXT_PART_IDS.has(component.partId)
  );
  const hasControllerBoardContext = spec.components.some((component) =>
    CONTROLLER_BOARD_CONTEXT_PART_IDS.has(component.partId)
  );
  const templates = await loadTopologyTemplates();
  const templateById = new Map(templates.map((template) => [template.id, template]));

  if (hasControllerBoardContext && hasOnlyStateOnlyContextParts(spec)) {
    return (
      templateById.get('controller-board-pin-map-substitution') ??
      templateById.get('controller-voltage-domain-policy') ??
      null
    );
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
    return (
      templateById.get('controller-digital-input-output') ??
      templateById.get('controller-digital-input-switch-plus-output') ??
      null
    );
  }

  if (hasResistiveSensor && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-resistive-sensor-divider-i2c-display') ?? null;
  }

  if (
    hasResistiveSensor &&
    hasThresholdLanguage(spec) &&
    partIds.has('led-5mm') &&
    partIds.has('resistor-220')
  ) {
    return (
      templateById.get('controller-resistive-sensor-divider-threshold-output') ??
      templateById.get('controller-analog-sensor-threshold-output') ??
      null
    );
  }

  if (hasAnalogSensorModule && hasI2cTextDisplay(spec)) {
    return templateById.get('controller-analog-sensor-i2c-display') ?? null;
  }

  if (
    hasAnalogSensorModule &&
    hasThresholdLanguage(spec) &&
    partIds.has('led-5mm') &&
    partIds.has('resistor-220')
  ) {
    return (
      templateById.get('controller-analog-sensor-threshold-output') ??
      templateById.get('controller-analog-threshold-output') ??
      null
    );
  }

  if (hasI2cTextDisplay(spec)) {
    return (
      templateById.get('controller-i2c-character-display') ??
      templateById.get('controller-i2c-module') ??
      null
    );
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
    return (
      templateById.get('controller-servo-external-power-warning') ??
      templateById.get('controller-pwm-actuator') ??
      null
    );
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

  if (
    hasDirectLowCurrentLoad &&
    !partIds.has('led-5mm') &&
    !partIds.has('button-tactile') &&
    !hasDigitalInputState
  ) {
    return templateById.get('controller-direct-low-current-load') ?? null;
  }

  const capabilities = (await loadCapabilityGraph()).filter(
    (capability) =>
      capability.supportLevel !== 'unsupported' &&
      (!capability.id.startsWith('analog-sensor-') ||
        hasAnalogSensorModule ||
        hasResistiveSensor) &&
      (!capability.id.startsWith('digital-input-') || hasDigitalInputState) &&
      (!capability.id.startsWith('matrix-input-') || hasMatrixInput) &&
      (!capability.id.startsWith('joystick-') || hasJoystick) &&
      (!capability.id.startsWith('rotary-encoder-') || hasRotaryEncoder) &&
      capability.requiredRoles.length > 0 &&
      capability.requiredParts.length > 0 &&
      capability.requiredParts.every((partId) => partIds.has(partId))
  );
  return selectTopologyTemplate({ capabilities });
}

export function hasOnlyStateOnlyContextParts(spec: CircuitSpec) {
  return spec.components.every(
    (component) =>
      CONTROLLER_BOARD_CONTEXT_PART_IDS.has(component.partId) ||
      WP09_CONTEXT_PART_IDS.has(component.partId) ||
      component.partId === 'jumper-wire'
  );
}

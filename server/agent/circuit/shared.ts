// shared.ts — extracted verbatim from circuitTools.ts (god-module split, Phase B).
// Pure relocation: no signatures or behavior changed. See PLAN_god_module_refactor.md.
import { getPartRegistry, loadSimulationPrimitives } from '../../context/contextLayer.ts';
import {
  type CircuitSpec,
  type CurrentPath,
  type PartCapability,
  type RenderFootprintEntry,
  type RenderPlan,
  type SimulationPrimitive
} from '../schemas.ts';

export type RenderWarning = {
  code: string;
  componentId?: string;
  message: string;
};

export type LowSideSwitchedLoadPath = {
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

export function lowSideLoadPins(part: PartCapability) {
  return {
    highPin: firstPinNameForRole(
      part,
      (role) => isPowerRole(role) || role === 'positive' || role === 'load-power'
    ),
    lowPin: firstPinNameForRole(
      part,
      (role) => role === 'switched-ground' || isGroundRole(role) || role === 'negative'
    )
  };
}

export type StepperMotorPath = {
  topologyId: 'controller-uln2003-unipolar-stepper' | 'controller-step-dir-bipolar-stepper';
  motorId: string;
  driverId: string;
  controlEndpoints: string[];
  controlTargetEndpoints: string[];
  phaseConnections: Array<{ driverPin: string; motorPin: string }>;
};

export type HBridgeMotorPath = {
  topologyId: 'controller-hbridge-dc-motor';
  motorId: string;
  driverId: string;
  driverPartId: string;
  controlEndpoints: string[];
  controlTargetEndpoints: string[];
  outputConnections: Array<{ driverPin: string; motorPin: string }>;
};

export function hbridgePinContract(partId: string) {
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

export function hbridgeControlPins(partId: string) {
  return hbridgePinContract(partId).controls;
}

export type RelayModulePath = {
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

export function resolveRelayModulePaths(
  spec: CircuitSpec,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
): RelayModulePath[] {
  return spec.components
    .filter((candidate) => RELAY_MODULE_PART_IDS.has(candidate.partId))
    .map((relay) => resolveRelayModulePath(spec, relay, partsById, componentsById))
    .filter((path): path is RelayModulePath => Boolean(path));
}

export function resolveRelayModulePath(
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
  const controlEndpoint = inputPin
    ? findConnectedControllerEndpointWithAnyRole(spec, relay.id, inputPin, [
        'digital-output',
        'pwm-output'
      ])
    : null;
  const commonPowered = endpointReachesControllerRole(
    spec,
    `${relay.id}:${contact.common}`,
    'power',
    partsById,
    componentsById
  );
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
    const cathodeGrounded = endpointReachesControllerRole(
      spec,
      `${led.id}:K`,
      'ground',
      partsById,
      componentsById
    );
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

export function relayInputPins(partId: string) {
  return partId === 'relay-4ch' ? ['IN1', 'IN2', 'IN3', 'IN4'] : ['IN'];
}

export function relayContactPins(partId: string) {
  return partId === 'relay-4ch'
    ? { common: 'COM1', output: 'NO1' }
    : { common: 'COM', output: 'NO' };
}

export function hasRelayMainsLanguage(spec: CircuitSpec) {
  const mainsPattern =
    /220\s*v|220v|110\s*v|110v|mains|outlet|wall power|\bac\b|콘센트|가정용\s*전원|교류|220볼트|110볼트/i;
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

  return spec.assumptions.some(
    (assumption) =>
      mainsPattern.test(assumption) &&
      !/\b(blocked|unsupported|not\s+supported|forbidden|avoid|do\s+not|don't|never)\b|차단|미지원|금지|사용하지/i.test(
        assumption
      )
  );
}

export function controllerOutputEndpointOnPath(
  graph: Map<string, Set<string>>,
  controllerOutputs: string[],
  goalKey: string
) {
  return controllerOutputs.find((key) => reachableEndpointKeys(graph, [key]).has(goalKey)) ?? null;
}

export const ANALOG_SENSOR_MODULE_PART_IDS = new Set([
  'soil-moisture',
  'water-level-sensor',
  'tmp36-temp',
  'acs712-current',
  'rain-sensor',
  'flame-sensor',
  'mq2-gas',
  'sound-sensor'
]);

export const ANALOG_DIMMER_INPUT_PART_IDS = new Set(['potentiometer-10k', 'trimmer-pot']);

export const RESISTIVE_SENSOR_PART_IDS = new Set(['fsr-pressure', 'thermistor-ntc']);

export const RESISTIVE_SENSOR_REFERENCE_RESISTOR_PART_IDS = new Set(['resistor-10k']);

export const PASSIVE_INTERNAL_CONNECTION_PART_IDS = new Set([
  'resistor-220',
  ...RESISTIVE_SENSOR_REFERENCE_RESISTOR_PART_IDS
]);

export const I2C_TEXT_DISPLAY_PART_IDS = new Set([
  'oled-i2c-096',
  'oled-13-i2c',
  'lcd-16x2',
  'lcd-20x4'
]);

export const BARE_SEVEN_SEGMENT_DISPLAY_PART_IDS = new Set(['7seg-1digit']);

export const LED_ARRAY_DISPLAY_PART_IDS = new Set(['7seg-4digit-tm1637', '8x8-matrix-max7219']);

export const ADDRESSABLE_LED_DISPLAY_PART_IDS = new Set(['neopixel-ring-12', 'ws2812b-strip']);

export const SPI_DISPLAY_PART_IDS = new Set(['tft-18', 'nokia-5110', 'epaper-213']);

export const RGB_LED_PART_IDS = new Set(['rgb-led-common-cathode']);

export const POWERED_LIGHT_MODULE_PART_IDS = new Set(['laser-diode-module']);

export const LOW_SIDE_DISCRETE_DRIVER_PART_IDS = new Set(['2n2222-npn']);

export const LOW_SIDE_MOSFET_MODULE_PART_IDS = new Set(['irf520-mosfet']);

export const LOW_SIDE_INTEGRATED_LOAD_PART_IDS = new Set(['vibration-motor']);

export const LOW_SIDE_LOAD_PART_IDS = new Set([
  'dc-motor-130',
  'dc-fan-5v',
  'mini-water-pump',
  'solenoid-valve',
  ...LOW_SIDE_INTEGRATED_LOAD_PART_IDS
]);

export const UNIPOLAR_STEPPER_MOTOR_PART_IDS = new Set(['stepper-28byj48']);

export const BIPOLAR_STEPPER_MOTOR_PART_IDS = new Set(['nema17-stepper']);

export const STEPPER_MOTOR_PART_IDS = new Set([
  ...UNIPOLAR_STEPPER_MOTOR_PART_IDS,
  ...BIPOLAR_STEPPER_MOTOR_PART_IDS
]);

export const ULN2003_STEPPER_DRIVER_PART_IDS = new Set(['uln2003-driver']);

export const STEP_DIR_STEPPER_DRIVER_PART_IDS = new Set(['a4988-stepper', 'drv8825-stepper']);

export const HBRIDGE_MOTOR_LOAD_PART_IDS = new Set(['dc-motor-130']);

export const RELAY_MODULE_PART_IDS = new Set(['relay-1ch', 'relay-4ch']);

export const SINGLE_WIRE_SENSOR_PART_IDS = new Set(['dht11', 'dht22']);

export const I2C_PROTOCOL_SENSOR_PART_IDS = new Set([
  'bmp280',
  'hmc5883l',
  'mpu6050',
  'max30102-pulse'
]);

export const CLOCKED_DATA_SENSOR_PART_IDS = new Set(['hx711-loadcell']);

export const SPI_PROTOCOL_SENSOR_PART_IDS = new Set(['rc522-rfid']);

export const UART_PROTOCOL_SENSOR_PART_IDS = new Set(['gps-neo6m']);

export const UART_COMMUNICATION_MODULE_PART_IDS = new Set([
  'esp01-wifi',
  'hc05-bluetooth',
  'sim800l-gsm'
]);

export const SPI_COMMUNICATION_MODULE_PART_IDS = new Set([
  'lora-ra02',
  'nrf24l01-radio',
  'mcp2515-can',
  'usb-host-shield'
]);

export const DIFFERENTIAL_COMMUNICATION_MODULE_PART_IDS = new Set(['rs485-module']);

export const COMMUNICATION_MODULE_PART_IDS = new Set([
  ...UART_COMMUNICATION_MODULE_PART_IDS,
  ...SPI_COMMUNICATION_MODULE_PART_IDS,
  ...DIFFERENTIAL_COMMUNICATION_MODULE_PART_IDS
]);

export const SHIFT_REGISTER_INTERFACE_PART_IDS = new Set(['74hc595-shift']);

export const I2C_LOGIC_INTERFACE_PART_IDS = new Set(['pcf8574-expander', 'ads1115-adc']);

export const SPI_LOGIC_INTERFACE_PART_IDS = new Set(['mcp3008-adc']);

export const ANALOG_TIMING_INTERFACE_PART_IDS = new Set(['ne555-timer', 'lm358-opamp']);

export const LEVEL_SHIFTER_INTERFACE_PART_IDS = new Set(['i2c-level-shifter']);

export const LOGIC_INTERFACE_PART_IDS = new Set([
  ...SHIFT_REGISTER_INTERFACE_PART_IDS,
  ...I2C_LOGIC_INTERFACE_PART_IDS,
  ...SPI_LOGIC_INTERFACE_PART_IDS,
  ...ANALOG_TIMING_INTERFACE_PART_IDS,
  ...LEVEL_SHIFTER_INTERFACE_PART_IDS
]);

export const PASSIVE_DIGITAL_SWITCH_PART_IDS = new Set([
  'limit-switch',
  'reed-switch',
  'slide-switch',
  'toggle-switch'
]);

export const POWERED_DIGITAL_SENSOR_PART_IDS = new Set([
  'ttp223-touch',
  'hall-effect-sensor',
  'line-tracker',
  'pir-hc-sr501',
  'sw420-vibration',
  'tilt-ball-sensor'
]);

export const PULSE_DIGITAL_SENSOR_PART_IDS = new Set(['ir-receiver', 'tcs3200-color']);

export const DIGITAL_INPUT_STATE_PART_IDS = new Set([
  ...PASSIVE_DIGITAL_SWITCH_PART_IDS,
  ...POWERED_DIGITAL_SENSOR_PART_IDS,
  ...PULSE_DIGITAL_SENSOR_PART_IDS
]);

export const MATRIX_KEYPAD_PART_IDS = new Set(['keypad-4x4']);

export const MULTI_SWITCH_INPUT_PART_IDS = new Set(['dip-switch-4', 'membrane-keypad-1x4']);

export const MATRIX_INPUT_PART_IDS = new Set([
  ...MATRIX_KEYPAD_PART_IDS,
  ...MULTI_SWITCH_INPUT_PART_IDS
]);

export const JOYSTICK_PART_IDS = new Set(['joystick-module']);

export const ROTARY_ENCODER_PART_IDS = new Set(['rotary-encoder']);

export function digitalInputSignalPinForComponent(
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

export function firstPinNameForRole(part: PartCapability, predicate: (role: string) => boolean) {
  return part.pins.find((pin) => predicate(pin.role))?.name ?? null;
}

export function bareSevenSegmentPins(part: PartCapability) {
  return part.pins
    .filter((pin) => pin.role === 'segment-anode' || pin.role === 'segment' || pin.name === 'DP')
    .map((pin) => pin.name);
}

export function rgbLedChannelPins(part: PartCapability) {
  return part.pins
    .filter((pin) => pin.role === 'channel-anode' || ['R', 'G', 'B'].includes(pin.name))
    .map((pin) => pin.name);
}

export function rgbChannelColor(pin: string) {
  const colors: Record<string, string> = {
    R: '#ff4d3d',
    G: '#22c55e',
    B: '#3b82f6'
  };
  return colors[pin] ?? '#ff4d3d';
}

export function endpointReachesControllerRole(
  spec: CircuitSpec,
  startKey: string,
  controllerRole: string,
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  return endpointReachesAnyControllerRole(
    spec,
    startKey,
    [controllerRole],
    partsById,
    componentsById
  );
}

export function endpointReachesAnyControllerRole(
  spec: CircuitSpec,
  startKey: string,
  controllerRoles: string[],
  partsById: Map<string, PartCapability>,
  componentsById: Map<string, CircuitSpec['components'][number]>
) {
  const graph = buildEndpointGraph(spec);
  return endpointReachesAnyControllerRoleInGraph(
    graph,
    startKey,
    controllerRoles,
    partsById,
    componentsById
  );
}

export function endpointReachesAnyControllerRoleInGraph(
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

export function hasThresholdLanguage(spec: CircuitSpec) {
  return /dark|light|threshold|above|below|어두|밝|임계|기준/i.test(
    [
      spec.intent.primaryGoal,
      spec.intent.behavior ?? '',
      spec.behavior.runText,
      ...spec.assumptions
    ].join(' ')
  );
}

export function buildEndpointGraph(
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
    const isInternalConductor =
      PASSIVE_INTERNAL_CONNECTION_PART_IDS.has(component.partId) ||
      (includeResistiveSensors && RESISTIVE_SENSOR_PART_IDS.has(component.partId));
    if (!isInternalConductor) {
      continue;
    }
    const pins = RESISTIVE_SENSOR_PART_IDS.has(component.partId) ? ['A', 'B'] : ['1', '2'];
    addEdge(graph, `${component.id}:${pins[0]}`, `${component.id}:${pins[1]}`);
    addEdge(graph, `${component.id}:${pins[1]}`, `${component.id}:${pins[0]}`);
  }

  return graph;
}

export function reachableEndpointKeys(graph: Map<string, Set<string>>, startKeys: string[]) {
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

export function componentIdsOnPathThroughAnyComponent(
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

export function endpointFromKey(key: string) {
  const [componentId, ...pinParts] = key.split(':');
  return {
    componentId,
    pin: pinParts.join(':')
  };
}

export type CircuitEndpoint = CircuitSpec['connections'][number]['from'];

export function endpointKey(endpoint: CircuitEndpoint) {
  return `${endpoint.componentId}:${endpoint.pin}`;
}

export function addEdge(graph: Map<string, Set<string>>, from: string, to: string) {
  const neighbors = graph.get(from) ?? new Set<string>();
  neighbors.add(to);
  graph.set(from, neighbors);
}

export function isPowerRole(role: string) {
  return role === 'power' || role === 'power-rail' || role.includes('power');
}

export function isGroundRole(role: string) {
  return role === 'ground' || role === 'ground-rail' || role.includes('ground');
}

export function roleFor(
  endpoint: CircuitSpec['connections'][number]['from'],
  componentsById: Map<string, CircuitSpec['components'][number]>,
  partsById: Map<string, PartCapability>
) {
  const component = componentsById.get(endpoint.componentId);
  const part = component ? partsById.get(component.partId) : undefined;
  return part?.pins.find((pin) => pin.name === endpoint.pin)?.role ?? 'unknown';
}

export function componentIdForPart(spec: CircuitSpec, partId: string) {
  return spec.components.find((component) => component.partId === partId)?.id ?? partId;
}

export function findI2cTextDisplayComponent(spec: CircuitSpec) {
  return (
    spec.components.find((component) => I2C_TEXT_DISPLAY_PART_IDS.has(component.partId)) ?? null
  );
}

export function hasI2cTextDisplay(spec: CircuitSpec) {
  return Boolean(findI2cTextDisplayComponent(spec));
}

export function componentIdForI2cTextDisplay(spec: CircuitSpec) {
  return findI2cTextDisplayComponent(spec)?.id ?? 'oled-display';
}

export type SimulationContext = {
  component: CircuitSpec['components'][number];
  part: PartCapability;
  primitive: SimulationPrimitive;
};

export async function simulationContextsForSpec(spec: CircuitSpec): Promise<SimulationContext[]> {
  const [parts, primitives] = await Promise.all([getPartRegistry(), loadSimulationPrimitives()]);
  const partsById = new Map(parts.map((part) => [part.id, part]));
  const primitivesById = new Map(primitives.map((primitive) => [primitive.id, primitive]));
  const contexts: SimulationContext[] = [];
  const componentsById = new Map(spec.components.map((component) => [component.id, component]));
  const relayControlledLedIds = new Set(
    resolveRelayModulePaths(spec, partsById, componentsById).map((path) => path.loadId)
  );

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

export function preferredSimulationPrimitiveIdsForSpec(spec: CircuitSpec, part: PartCapability) {
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
    part.capabilities.includes('power-rail-source') ||
    part.capabilities.includes('low-voltage-power-source') ||
    part.capabilities.includes('low-voltage-power-connector')
  ) {
    return ['low_voltage_power_rail_state'];
  }

  if (part.capabilities.includes('timing-passive-context')) {
    return ['timing_passive_context_state'];
  }

  if (
    part.capabilities.includes('passive-protection-context') ||
    part.capabilities.includes('passive-context-part')
  ) {
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

export function compileCurrentPathsFromPrimitive(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
  if (
    context.primitive.id === 'low_voltage_power_rail_state' ||
    context.primitive.id === 'regulated_5v_rail_state' ||
    context.primitive.id === 'passive_protection_context_state' ||
    context.primitive.id === 'timing_passive_context_state' ||
    context.primitive.id === 'prototyping_surface_context_state' ||
    context.primitive.id === 'connector_wiring_context_state' ||
    context.primitive.id === 'controller_board_context_state'
  ) {
    return [];
  }

  if (
    context.primitive.id === 'matrix_input_state' &&
    context.part.capabilities.includes('matrix-input-source')
  ) {
    return compileMatrixInputCurrentPaths(spec, context);
  }

  if (
    context.primitive.id === 'joystick_position_state' &&
    context.part.capabilities.includes('joystick-input-source')
  ) {
    return compileJoystickCurrentPaths(spec, context);
  }

  if (
    context.primitive.id === 'rotary_encoder_state' &&
    context.part.capabilities.includes('rotary-encoder-source')
  ) {
    return compileRotaryEncoderCurrentPaths(spec, context);
  }

  if (
    context.primitive.id === 'led_array_display_state' &&
    context.part.capabilities.includes('led-array-display')
  ) {
    return compileLedArrayDisplayCurrentPaths(spec, context);
  }

  if (
    context.primitive.id === 'addressable_led_pattern' &&
    context.part.capabilities.includes('addressable-led-display')
  ) {
    return compileAddressableLedDisplayCurrentPaths(spec, context);
  }

  if (
    context.primitive.id === 'bare_seven_segment_display_state' &&
    context.part.capabilities.includes('bare-seven-segment-display')
  ) {
    return compileBareSevenSegmentCurrentPaths(spec, context);
  }

  if (
    context.primitive.id === 'spi_display_state' &&
    context.part.capabilities.includes('spi-display')
  ) {
    return compileSpiDisplayCurrentPaths(spec, context);
  }

  if (
    context.primitive.id === 'rgb_led_color_mix' &&
    context.part.capabilities.includes('multi-channel-light-output')
  ) {
    return compileRgbLedCurrentPaths(spec, context);
  }

  if (
    context.primitive.id === 'powered_light_module_state' &&
    context.part.capabilities.includes('powered-light-output')
  ) {
    return compilePoweredLightModuleCurrentPaths(spec, context);
  }

  if (
    context.primitive.id === 'low_side_switched_load_state' &&
    context.part.capabilities.includes('low-side-switched-load')
  ) {
    return compileLowSideSwitchedLoadCurrentPaths(spec, context);
  }

  if (
    context.primitive.id === 'hbridge_motor_state' &&
    context.part.capabilities.includes('hbridge-driver')
  ) {
    return compileHBridgeMotorCurrentPaths(spec, context);
  }

  if (
    context.primitive.id === 'stepper_motor_state' &&
    context.part.capabilities.includes('stepper-motor')
  ) {
    return compileStepperMotorCurrentPaths(spec, context);
  }

  if (
    context.primitive.id === 'relay_switch_state' &&
    context.part.capabilities.includes('relay-module')
  ) {
    return compileRelayModuleCurrentPaths(spec, context);
  }

  if (
    context.primitive.id === 'digital_input_state' &&
    context.part.capabilities.includes('digital-input-state-source')
  ) {
    return compileDigitalInputStateCurrentPaths(spec, context);
  }

  if (
    context.primitive.id === 'display_sensor_value' &&
    context.part.capabilities.includes('resistive-sensor')
  ) {
    return compileResistiveSensorDisplayCurrentPaths(spec, context);
  }

  if (
    context.primitive.id === 'display_sensor_value' &&
    context.part.capabilities.includes('analog-sensor')
  ) {
    return compileAnalogSensorDisplayCurrentPaths(spec, context);
  }

  if (
    context.primitive.id === 'analog_threshold' &&
    context.part.capabilities.includes('resistive-sensor')
  ) {
    return compileResistiveSensorThresholdCurrentPaths(spec, context);
  }

  if (
    (context.primitive.id === 'analog_pwm_dimmer' || context.primitive.id === 'analog_threshold') &&
    context.part.capabilities.includes('analog-input')
  ) {
    return compileAnalogInputCurrentPaths(spec, context);
  }

  if (
    context.primitive.id === 'display_sensor_value' &&
    context.part.capabilities.includes('distance-sensor')
  ) {
    return compileDistanceSensorCurrentPaths(spec, context);
  }

  if (
    context.primitive.id === 'display_sensor_value' &&
    context.part.capabilities.includes('temperature-humidity-sensor')
  ) {
    return compileSingleWireSensorCurrentPaths(spec, context);
  }

  if (
    context.primitive.id === 'display_sensor_value' &&
    context.part.capabilities.includes('protocol-sensor')
  ) {
    return compileProtocolSensorCurrentPaths(spec, context);
  }

  if (
    context.primitive.id === 'display_sensor_value' &&
    context.part.capabilities.includes('communication-module')
  ) {
    return compileCommunicationModuleCurrentPaths(spec, context);
  }

  if (
    (context.primitive.id === 'display_sensor_value' ||
      context.primitive.id === 'display_static_text') &&
    context.part.capabilities.includes('logic-interface')
  ) {
    return compileLogicInterfaceCurrentPaths(spec, context);
  }

  const templates = currentPathTemplates(context.primitive);
  if (templates.length > 0) {
    return templates.map((template) => compileTemplatedCurrentPath(spec, context, template));
  }

  return [compileFallbackCurrentPath(spec, context)];
}

export function isSimulationContextPart(part: PartCapability) {
  return (
    part.kind === 'output' ||
    part.capabilities.includes('matrix-input-source') ||
    part.capabilities.includes('joystick-input-source') ||
    part.capabilities.includes('rotary-encoder-source') ||
    part.capabilities.includes('digital-input-state-source') ||
    part.capabilities.includes('analog-input') ||
    part.capabilities.includes('distance-sensor') ||
    part.capabilities.includes('temperature-humidity-sensor') ||
    part.capabilities.includes('protocol-sensor') ||
    part.capabilities.includes('communication-module') ||
    part.capabilities.includes('power-rail-source') ||
    part.capabilities.includes('low-voltage-power-source') ||
    part.capabilities.includes('low-voltage-power-connector') ||
    part.capabilities.includes('voltage-regulator') ||
    part.capabilities.includes('passive-context-part') ||
    part.capabilities.includes('passive-protection-context') ||
    part.capabilities.includes('timing-passive-context') ||
    part.capabilities.includes('prototyping-surface') ||
    part.capabilities.includes('connector-wiring') ||
    part.capabilities.includes('logic-interface') ||
    part.capabilities.includes('controller-board-substitution')
  );
}

export function compileDigitalInputStateCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const signalPin =
    digitalInputSignalPinForComponent(spec, context.component, context.part) ??
    firstPinNameForRole(context.part, (role) =>
      ['digital-output', 'pulse-output', 'switch-common', 'switch-terminal'].includes(role)
    ) ??
    'OUT';
  const controllerDigitalEndpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, signalPin, 'digital-input') ??
    `${controllerId}:D2`;
  const displayId = findI2cTextDisplayComponent(spec)?.id;
  const displayBusEndpoint = displayId
    ? (findConnectedControllerEndpointWithRole(spec, displayId, 'SDA', 'i2c-data') ??
      `${controllerId}:A4/SDA`)
    : null;
  const isPowered =
    POWERED_DIGITAL_SENSOR_PART_IDS.has(context.component.partId) ||
    PULSE_DIGITAL_SENSOR_PART_IDS.has(context.component.partId);
  const isPulse = PULSE_DIGITAL_SENSOR_PART_IDS.has(context.component.partId);
  const signalPathId = isPulse
    ? `pulse-digital-input-signal:${targetId}`
    : `digital-input-signal:${targetId}`;
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

export function compileMatrixInputCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const displayId = componentIdForI2cTextDisplay(spec);
  const displayBusEndpoint =
    findConnectedControllerEndpointWithRole(spec, displayId, 'SDA', 'i2c-data') ??
    `${controllerId}:A4/SDA`;
  const paths: CurrentPath[] = [];

  if (MATRIX_KEYPAD_PART_IDS.has(context.component.partId)) {
    const rowPins = context.part.pins
      .filter((pin) => pin.role === 'matrix-row')
      .map((pin) => pin.name);
    const columnPins = context.part.pins
      .filter((pin) => pin.role === 'matrix-column')
      .map((pin) => pin.name);
    for (const rowPin of rowPins) {
      const controllerEndpoint =
        findConnectedControllerEndpointWithRole(spec, targetId, rowPin, 'digital-output') ??
        `${controllerId}:D${Number(rowPin.slice(1)) + 1}`;
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
      const controllerEndpoint =
        findConnectedControllerEndpointWithRole(spec, targetId, columnPin, 'digital-input') ??
        `${controllerId}:D${Number(columnPin.slice(1)) + 5}`;
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
      const controllerEndpoint =
        findConnectedControllerEndpointWithRole(spec, targetId, signalPin, 'digital-input') ??
        `${controllerId}:D2`;
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

export function matrixSwitchSignalPinsForContext(spec: CircuitSpec, context: SimulationContext) {
  if (context.component.partId === 'dip-switch-4') {
    return [1, 2, 3, 4].flatMap((index) => {
      const pair = [`S${index}A`, `S${index}B`];
      return (
        pair.find((pin) =>
          findConnectionToControllerRole(spec, context.component.id, pin, 'digital-input')
        ) ?? pair[0]
      );
    });
  }
  return context.part.pins.filter((pin) => pin.role === 'switch-terminal').map((pin) => pin.name);
}

export function compileJoystickCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const displayId = componentIdForI2cTextDisplay(spec);
  const xEndpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, 'VRX', 'analog-input') ??
    `${controllerId}:A0`;
  const yEndpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, 'VRY', 'analog-input') ??
    `${controllerId}:A1`;
  const switchEndpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, 'SW', 'digital-input') ??
    `${controllerId}:D2`;
  const displayBusEndpoint =
    findConnectedControllerEndpointWithRole(spec, displayId, 'SDA', 'i2c-data') ??
    `${controllerId}:A4/SDA`;

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

export function compileRotaryEncoderCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const displayId = componentIdForI2cTextDisplay(spec);
  const displayBusEndpoint =
    findConnectedControllerEndpointWithRole(spec, displayId, 'SDA', 'i2c-data') ??
    `${controllerId}:A4/SDA`;
  const signalPaths = [
    {
      pin: 'CLK',
      id: 'rotary-encoder-clk-signal',
      label: 'CLK quadrature signal',
      color: '#9bd67d'
    },
    { pin: 'DT', id: 'rotary-encoder-dt-signal', label: 'DT quadrature signal', color: '#84a9ff' },
    { pin: 'SW', id: 'rotary-encoder-switch-signal', label: 'push switch signal', color: '#7c3aed' }
  ].map(({ pin, id, label, color }) => {
    const controllerEndpoint =
      findConnectedControllerEndpointWithRole(spec, targetId, pin, 'digital-input') ??
      `${controllerId}:D2`;
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

export function compileBareSevenSegmentCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
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
      return (
        component?.partId === 'arduino-uno' &&
        controllerPinMatchesRole(endpoint.pin, 'digital-output')
      );
    })
    .map(endpointKey);

  return bareSevenSegmentPins(context.part).flatMap((pin) => {
    const segmentKey = `${targetId}:${pin}`;
    const seriesResistorIds = componentIdsOnPathThroughAnyComponent(
      graph,
      controllerOutputs,
      segmentKey,
      resistorIds
    );
    if (seriesResistorIds.length === 0) {
      return [];
    }
    const controllerEndpoint =
      findSegmentControllerEndpointThroughResistor(spec, graph, segmentKey, seriesResistorIds) ??
      `${controllerId}:D4`;

    return [
      {
        id: `bare-seven-segment-current:${targetId}:${pin}`,
        kind: 'load-current' as const,
        primitiveId: context.primitive.id,
        label: `${context.part.label} segment ${pin} current`,
        from: controllerEndpoint,
        through: [...seriesResistorIds, targetId],
        to: `${controllerId}:GND`,
        expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
        animation: { color: '#ff4d3d', speed: 0.58 }
      }
    ];
  });
}

export function findSegmentControllerEndpointThroughResistor(
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
      return (
        endpoints.some((endpoint) => endpoint.componentId === resistorId) &&
        endpoints.some((endpoint) => {
          const component = spec.components.find(
            (candidate) => candidate.id === endpoint.componentId
          );
          return (
            component?.partId === 'arduino-uno' &&
            controllerPinMatchesRole(endpoint.pin, 'digital-output')
          );
        })
      );
    });
    const controllerEndpoint = controllerConnection
      ? [controllerConnection.from, controllerConnection.to].find((endpoint) => {
          const component = spec.components.find(
            (candidate) => candidate.id === endpoint.componentId
          );
          return component?.partId === 'arduino-uno';
        })
      : null;
    if (controllerEndpoint) {
      return `${controllerEndpoint.componentId}:${controllerEndpoint.pin}`;
    }
  }

  return null;
}

export function compileLedArrayDisplayCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const powerPin = firstPinNameForRole(context.part, isPowerRole) ?? 'VCC';
  const groundPin = firstPinNameForRole(context.part, isGroundRole) ?? 'GND';
  const dataPin =
    firstPinNameForRole(context.part, (role) => role === 'data' || role === 'single-wire-data') ??
    'DIO';
  const clockPin = firstPinNameForRole(context.part, (role) => role === 'clock') ?? 'CLK';
  const selectPin = firstPinNameForRole(
    context.part,
    (role) => role === 'chip-select' || role === 'enable'
  );
  const dataEndpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, dataPin, 'digital-output') ??
    findConnectedControllerEndpointWithRole(spec, targetId, dataPin, 'pwm-output') ??
    `${controllerId}:D4`;
  const clockEndpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, clockPin, 'digital-output') ??
    findConnectedControllerEndpointWithRole(spec, targetId, clockPin, 'pwm-output') ??
    `${controllerId}:D5`;
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
    const selectEndpoint =
      findConnectedControllerEndpointWithRole(spec, targetId, selectPin, 'digital-output') ??
      findConnectedControllerEndpointWithRole(spec, targetId, selectPin, 'pwm-output') ??
      `${controllerId}:D6`;
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

export function compileAddressableLedDisplayCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const powerPin = firstPinNameForRole(context.part, isPowerRole) ?? '5V';
  const groundPin = firstPinNameForRole(context.part, isGroundRole) ?? 'GND';
  const dataPin =
    firstPinNameForRole(context.part, (role) => role === 'single-wire-data' || role === 'data') ??
    'DIN';
  const dataEndpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, dataPin, 'digital-output') ??
    findConnectedControllerEndpointWithRole(spec, targetId, dataPin, 'pwm-output') ??
    `${controllerId}:D6`;

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

export function compileRgbLedCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const graph = buildEndpointGraph(spec);
  const resistorIds = spec.components
    .filter((component) => component.partId === 'resistor-220')
    .map((component) => component.id);
  const controllerOutputs = unique(
    spec.connections
      .flatMap((connection) => [connection.from, connection.to])
      .filter((endpoint) => {
        const component = spec.components.find(
          (candidate) => candidate.id === endpoint.componentId
        );
        return (
          component?.partId === 'arduino-uno' &&
          (controllerPinMatchesRole(endpoint.pin, 'digital-output') ||
            controllerPinMatchesRole(endpoint.pin, 'pwm-output'))
        );
      })
      .map(endpointKey)
  );

  return rgbLedChannelPins(context.part).flatMap((pin) => {
    const channelKey = `${targetId}:${pin}`;
    const seriesResistorIds = componentIdsOnPathThroughAnyComponent(
      graph,
      controllerOutputs,
      channelKey,
      resistorIds
    );
    if (seriesResistorIds.length === 0) {
      return [];
    }
    const controllerEndpoint =
      findSegmentControllerEndpointThroughResistor(spec, graph, channelKey, seriesResistorIds) ??
      `${controllerId}:D9`;
    return [
      {
        id: `rgb-led-channel-current:${targetId}:${pin}`,
        kind: 'load-current' as const,
        primitiveId: context.primitive.id,
        label: `${context.part.label} ${pin} channel current`,
        from: controllerEndpoint,
        through: [...seriesResistorIds, targetId],
        to: `${controllerId}:GND`,
        expectedCurrentMa: context.part.simulationModel.nominalCurrentMa,
        animation: { color: rgbChannelColor(pin), speed: 0.58 }
      }
    ];
  });
}

export function compilePoweredLightModuleCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const powerPin = firstPinNameForRole(context.part, isPowerRole) ?? 'VCC';
  const groundPin = firstPinNameForRole(context.part, isGroundRole) ?? 'GND';
  const signalPin =
    firstPinNameForRole(
      context.part,
      (role) => role === 'digital-input' || role === 'data' || role === 'signal'
    ) ?? 'S';
  const signalEndpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, signalPin, 'digital-output') ??
    findConnectedControllerEndpointWithRole(spec, targetId, signalPin, 'pwm-output') ??
    `${controllerId}:D7`;

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

export function compileLowSideSwitchedLoadCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const path = resolveLowSideSwitchedLoadPathForSimulation(spec, context);
  if (!path) {
    return [];
  }
  const supplyThrough = path.driverId ? [targetId, path.driverId] : [targetId];
  const signalThrough = path.driverId ? [...path.baseResistorIds, path.driverId] : [targetId];

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

export function resolveLowSideSwitchedLoadPathForSimulation(
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
    const signalPin =
      firstPinNameForRole(
        context.part,
        (role) => role === 'digital-input' || role === 'data' || role === 'signal'
      ) ?? 'IN';
    const controlEndpoint = findConnectedControllerEndpointWithAnyRole(spec, targetId, signalPin, [
      'digital-output',
      'pwm-output'
    ]);
    return controlEndpoint
      ? {
          topologyId: 'controller-mosfet-module-load',
          loadId: targetId,
          loadHighPin: highPin,
          loadLowPin: lowPin,
          baseResistorIds: [],
          controlEndpoint,
          controlTargetEndpoint: `${targetId}:${signalPin}`
        }
      : null;
  }

  for (const driver of spec.components.filter((candidate) =>
    LOW_SIDE_MOSFET_MODULE_PART_IDS.has(candidate.partId)
  )) {
    const loadHighConnected = reachableEndpointKeys(graph, [`${driver.id}:V+`]).has(
      `${targetId}:${highPin}`
    );
    const loadLowConnected = reachableEndpointKeys(graph, [`${driver.id}:V-`]).has(
      `${targetId}:${lowPin}`
    );
    const controlEndpoint = findConnectedControllerEndpointWithAnyRole(spec, driver.id, 'SIG', [
      'digital-output',
      'pwm-output'
    ]);
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

  for (const driver of spec.components.filter((candidate) =>
    LOW_SIDE_DISCRETE_DRIVER_PART_IDS.has(candidate.partId)
  )) {
    const loadLowConnected = reachableEndpointKeys(graph, [`${driver.id}:C`]).has(
      `${targetId}:${lowPin}`
    );
    const baseResistorIds = componentIdsOnPathThroughAnyComponent(
      graph,
      controllerOutputs,
      `${driver.id}:B`,
      resistorIds
    );
    const controlEndpoint = controllerOutputEndpointOnPath(
      graph,
      controllerOutputs,
      `${driver.id}:B`
    );
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

export function compileHBridgeMotorCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const driver = context.component;
  const motor = spec.components.find((candidate) =>
    HBRIDGE_MOTOR_LOAD_PART_IDS.has(candidate.partId)
  );
  if (!motor) {
    return [];
  }
  const path = resolveHBridgeMotorPathForSimulation(spec, driver, motor);
  if (!path) {
    return [];
  }
  const motorExpectedCurrentMa =
    motor.partId === 'dc-motor-130' ? 180 : context.part.simulationModel.nominalCurrentMa;

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
      to:
        path.controlTargetEndpoints[0] ??
        `${path.driverId}:${hbridgeControlPins(path.driverPartId)[0]}`,
      expectedCurrentMa: 0,
      animation: { color: '#2f7df6', speed: 0.62 }
    }
  ];
}

export function resolveHBridgeMotorPathForSimulation(
  spec: CircuitSpec,
  driver: CircuitSpec['components'][number],
  motor: CircuitSpec['components'][number]
): HBridgeMotorPath | null {
  const graph = buildEndpointGraph(spec);
  const pins = hbridgePinContract(driver.partId);
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
  const outputConnections =
    directOutputConnections.length === 2 ? directOutputConnections : reversedOutputConnections;

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

export function compileStepperMotorCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
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

export function resolveStepperMotorPathForSimulation(
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
    for (const driver of spec.components.filter((candidate) =>
      ULN2003_STEPPER_DRIVER_PART_IDS.has(candidate.partId)
    )) {
      const controlEndpoints = ['IN1', 'IN2', 'IN3', 'IN4']
        .map((pin) =>
          findConnectedControllerEndpointWithAnyRole(spec, driver.id, pin, [
            'digital-output',
            'pwm-output'
          ])
        )
        .filter((endpoint): endpoint is string => Boolean(endpoint));
      const controlTargetEndpoints = ['IN1', 'IN2', 'IN3', 'IN4'].map(
        (pin) => `${driver.id}:${pin}`
      );
      const phaseConnections = phasePairs
        .filter(([driverPin, motorPin]) =>
          reachableEndpointKeys(graph, [`${driver.id}:${driverPin}`]).has(`${targetId}:${motorPin}`)
        )
        .map(([driverPin, motorPin]) => ({ driverPin, motorPin }));
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
    for (const driver of spec.components.filter((candidate) =>
      STEP_DIR_STEPPER_DRIVER_PART_IDS.has(candidate.partId)
    )) {
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
          reachableEndpointKeys(graph, [`${driver.id}:${driverPin}`]).has(`${targetId}:${motorPin}`)
        )
        .map(([driverPin, motorPin]) => ({ driverPin, motorPin }));
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

export function compileRelayModuleCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
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

export function resolveRelayModulePathForSimulation(
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
    findConnectedControllerEndpointWithAnyRole(spec, relay.id, pin, [
      'digital-output',
      'pwm-output'
    ])
  );
  const controlEndpoint = inputPin
    ? findConnectedControllerEndpointWithAnyRole(spec, relay.id, inputPin, [
        'digital-output',
        'pwm-output'
      ])
    : null;
  const commonPowered = Boolean(
    findConnectionToControllerRole(spec, relay.id, contact.common, 'power')
  );
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

export function compileSpiDisplayCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const powerPin = firstPinNameForRole(context.part, isPowerRole) ?? 'VCC';
  const groundPin = firstPinNameForRole(context.part, isGroundRole) ?? 'GND';
  const dataPin = firstPinNameForRole(context.part, (role) => role === 'data') ?? 'DIN';
  const clockPin = firstPinNameForRole(context.part, (role) => role === 'clock') ?? 'SCK';
  const selectPin =
    firstPinNameForRole(context.part, (role) => role === 'chip-select' || role === 'enable') ??
    'CS';
  const controlPins = context.part.pins
    .filter((pin) => pin.role === 'data-command' || pin.role === 'reset')
    .map((pin) => pin.name);
  const dataEndpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, dataPin, 'digital-output') ??
    findConnectedControllerEndpointWithRole(spec, targetId, dataPin, 'pwm-output') ??
    `${controllerId}:D11`;
  const clockEndpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, clockPin, 'digital-output') ??
    findConnectedControllerEndpointWithRole(spec, targetId, clockPin, 'pwm-output') ??
    `${controllerId}:D13`;
  const selectEndpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, selectPin, 'digital-output') ??
    findConnectedControllerEndpointWithRole(spec, targetId, selectPin, 'pwm-output') ??
    `${controllerId}:D10`;

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
    const controlEndpoint =
      findConnectedControllerEndpointWithRole(spec, targetId, controlPin, 'digital-output') ??
      findConnectedControllerEndpointWithRole(spec, targetId, controlPin, 'pwm-output') ??
      `${controllerId}:D8`;
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

export function compileAnalogInputCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const analogPin =
    firstPinNameForRole(context.part, (role) => role === 'analog-output' || role === 'analog') ??
    'OUT';
  const controllerAnalogEndpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, analogPin, 'analog-input') ??
    `${controllerId}:A0`;
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

export function compileAnalogSensorDisplayCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const displayId = componentIdForI2cTextDisplay(spec);
  const analogPin =
    firstPinNameForRole(context.part, (role) => role === 'analog-output' || role === 'analog') ??
    'OUT';
  const controllerAnalogEndpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, analogPin, 'analog-input') ??
    `${controllerId}:A0`;
  const displayBusEndpoint =
    findConnectedControllerEndpointWithRole(spec, displayId, 'SDA', 'i2c-data') ??
    `${controllerId}:A4/SDA`;

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

export function compileResistiveSensorDisplayCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const displayId = componentIdForI2cTextDisplay(spec);
  const divider = resolveResistiveSensorDivider(spec, context);
  const displayBusEndpoint =
    findConnectedControllerEndpointWithRole(spec, displayId, 'SDA', 'i2c-data') ??
    `${controllerId}:A4/SDA`;

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

export function compileResistiveSensorThresholdCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
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

export function resolveResistiveSensorDivider(spec: CircuitSpec, context: SimulationContext) {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const terminalPins = context.part.pins.map((pin) => pin.name);
  const dividerPin =
    terminalPins.find((pin) =>
      findConnectionToControllerRole(spec, targetId, pin, 'analog-input')
    ) ??
    terminalPins[1] ??
    'B';
  const controllerAnalogEndpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, dividerPin, 'analog-input') ??
    `${controllerId}:A0`;
  const referenceId =
    spec.components.find((component) =>
      RESISTIVE_SENSOR_REFERENCE_RESISTOR_PART_IDS.has(component.partId)
    )?.id ?? 'resistor-10k';

  return {
    dividerPin,
    controllerAnalogEndpoint,
    referenceId
  };
}

export function compileDistanceSensorCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const triggerEndpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, 'TRIG', 'digital-output') ??
    findConnectedControllerEndpointWithRole(spec, targetId, 'TRIG', 'pwm-output') ??
    `${controllerId}:D3`;
  const echoEndpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, 'ECHO', 'digital-input') ??
    `${controllerId}:D2`;

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

export function compileSingleWireSensorCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const displayId = componentIdForI2cTextDisplay(spec);
  const pathIds = singleWireCurrentPathIds(context.part.id, targetId, displayId);
  const dataPin =
    firstPinNameForRole(
      context.part,
      (role) => role === 'single-wire-data' || role === 'digital-data' || role === 'digital-output'
    ) ?? 'DAT';
  const dataEndpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, dataPin, 'digital-input') ??
    `${controllerId}:D2`;
  const displayBusEndpoint =
    findConnectedControllerEndpointWithRole(spec, displayId, 'SDA', 'i2c-data') ??
    `${controllerId}:A4/SDA`;

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

export function compileProtocolSensorCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const displayId = componentIdForI2cTextDisplay(spec);
  const powerPin =
    firstPinNameForRole(context.part, (role) => role === 'power') ??
    (SPI_PROTOCOL_SENSOR_PART_IDS.has(context.component.partId) ? '3V3' : 'VCC');
  const controllerPowerEndpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, powerPin, 'power') ??
    `${controllerId}:${SPI_PROTOCOL_SENSOR_PART_IDS.has(context.component.partId) ? '3V3' : '5V'}`;
  const displayBusEndpoint =
    findConnectedControllerEndpointWithRole(spec, displayId, 'SDA', 'i2c-data') ??
    `${controllerId}:A4/SDA`;
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

export function protocolSensorSignalPath(
  spec: CircuitSpec,
  context: SimulationContext,
  controllerId: string
) {
  const targetId = context.component.id;

  if (I2C_PROTOCOL_SENSOR_PART_IDS.has(context.component.partId)) {
    const dataPin = firstPinNameForRole(context.part, (role) => role === 'i2c-data') ?? 'SDA';
    const endpoint =
      findConnectedControllerEndpointWithRole(spec, targetId, dataPin, 'i2c-data') ??
      `${controllerId}:A4/SDA`;
    return {
      from: `${targetId}:${dataPin}`,
      to: endpoint,
      color: '#2f7df6'
    };
  }

  if (CLOCKED_DATA_SENSOR_PART_IDS.has(context.component.partId)) {
    const dataPin = firstPinNameForRole(context.part, (role) => role === 'digital-data') ?? 'DT';
    const endpoint =
      findConnectedControllerEndpointWithRole(spec, targetId, dataPin, 'digital-input') ??
      `${controllerId}:D2`;
    return {
      from: `${targetId}:${dataPin}`,
      to: endpoint,
      color: '#9bd67d'
    };
  }

  if (SPI_PROTOCOL_SENSOR_PART_IDS.has(context.component.partId)) {
    const clockPin = firstPinNameForRole(context.part, (role) => role === 'spi-clock') ?? 'SCK';
    const endpoint =
      findConnectedControllerEndpointWithRole(spec, targetId, clockPin, 'spi-clock') ??
      `${controllerId}:D13`;
    return {
      from: endpoint,
      to: `${targetId}:${clockPin}`,
      color: '#f6c44c'
    };
  }

  const txPin = firstPinNameForRole(context.part, (role) => role === 'serial-tx') ?? 'TX';
  const endpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, txPin, 'serial-rx') ??
    `${controllerId}:D0/RX`;
  return {
    from: `${targetId}:${txPin}`,
    to: endpoint,
    color: '#84a9ff'
  };
}

export function compileCommunicationModuleCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const displayId = componentIdForI2cTextDisplay(spec);
  const powerPin =
    firstPinNameForRole(context.part, isPowerRole) ??
    (SPI_COMMUNICATION_MODULE_PART_IDS.has(context.component.partId) ? 'VCC' : 'VCC');
  const controllerPowerEndpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, powerPin, 'power') ??
    `${controllerId}:${['lora-ra02', 'nrf24l01-radio'].includes(context.component.partId) ? '3V3' : '5V'}`;
  const displayBusEndpoint =
    findConnectedControllerEndpointWithRole(spec, displayId, 'SDA', 'i2c-data') ??
    `${controllerId}:A4/SDA`;
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

export function communicationModuleSignalPath(
  spec: CircuitSpec,
  context: SimulationContext,
  controllerId: string
) {
  const targetId = context.component.id;

  if (SPI_COMMUNICATION_MODULE_PART_IDS.has(context.component.partId)) {
    const clockPin = firstPinNameForRole(context.part, (role) => role === 'spi-clock') ?? 'SCK';
    const endpoint =
      findConnectedControllerEndpointWithRole(spec, targetId, clockPin, 'spi-clock') ??
      `${controllerId}:D13`;
    return {
      from: endpoint,
      to: `${targetId}:${clockPin}`,
      color: '#f6c44c'
    };
  }

  const txPin = firstPinNameForRole(context.part, (role) => role === 'serial-tx') ?? 'TX';
  const endpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, txPin, 'serial-rx') ??
    `${controllerId}:D0/RX`;
  return {
    from: `${targetId}:${txPin}`,
    to: endpoint,
    color: '#84a9ff'
  };
}

export function compileLogicInterfaceCurrentPaths(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath[] {
  const controllerId = componentIdForPart(spec, 'arduino-uno');
  const targetId = context.component.id;
  const displayId = findI2cTextDisplayComponent(spec)?.id;
  const powerPin = firstPinNameForRole(context.part, isPowerRole) ?? 'VCC';
  const controllerPowerEndpoint =
    findConnectedControllerEndpointWithRole(spec, targetId, powerPin, 'power') ??
    `${controllerId}:${LEVEL_SHIFTER_INTERFACE_PART_IDS.has(context.component.partId) && powerPin === 'LV' ? '3V3' : '5V'}`;
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
    const displayBusEndpoint =
      findConnectedControllerEndpointWithRole(spec, displayId, 'SDA', 'i2c-data') ??
      `${controllerId}:A4/SDA`;
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

export function logicInterfaceSignalPath(
  spec: CircuitSpec,
  context: SimulationContext,
  controllerId: string
) {
  const targetId = context.component.id;

  if (LEVEL_SHIFTER_INTERFACE_PART_IDS.has(context.component.partId)) {
    const highEndpoint = findConnectedControllerEndpointWithAnyRole(spec, targetId, 'HV1', [
      'digital-output',
      'digital-input',
      'i2c-data',
      'i2c-clock'
    ]);
    const lowEndpoint = findConnectedControllerEndpointWithAnyRole(spec, targetId, 'LV1', [
      'digital-output',
      'digital-input',
      'i2c-data',
      'i2c-clock'
    ]);
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
    const endpoint =
      findConnectedControllerEndpointWithRole(spec, targetId, dataPin, 'i2c-data') ??
      `${controllerId}:A4/SDA`;
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
    const endpoint =
      findConnectedControllerEndpointWithRole(spec, targetId, clockPin, 'spi-clock') ??
      `${controllerId}:D13`;
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
    const endpoint =
      findConnectedControllerEndpointWithAnyRole(spec, targetId, dataPin, [
        'digital-output',
        'pwm-output',
        'spi-mosi'
      ]) ?? `${controllerId}:D4`;
    return {
      kind: 'signal-activity' as const,
      label: 'GPIO shift-register data activity',
      from: endpoint,
      to: `${targetId}:${dataPin}`,
      color: '#9bd67d'
    };
  }

  if (ANALOG_TIMING_INTERFACE_PART_IDS.has(context.component.partId)) {
    const outputPin =
      firstPinNameForRole(
        context.part,
        (role) => role === 'digital-output' || role === 'analog-output'
      ) ?? 'OUT';
    const endpoint =
      findConnectedControllerEndpointWithAnyRole(spec, targetId, outputPin, [
        'digital-input',
        'analog-input'
      ]) ?? `${controllerId}:D2`;
    return {
      kind: 'signal-activity' as const,
      label: 'qualitative output state',
      from: `${targetId}:${outputPin}`,
      to: endpoint,
      color: '#9bd67d'
    };
  }

  const signalPin =
    firstPinNameForRole(context.part, (role) => !isPowerRole(role) && !isGroundRole(role)) ?? 'SIG';
  const endpoint =
    findConnectedControllerEndpointWithAnyRole(spec, targetId, signalPin, [
      'digital-input',
      'digital-output',
      'analog-input'
    ]) ?? `${controllerId}:D2`;
  return {
    kind: 'signal-activity' as const,
    label: 'interface signal activity',
    from: `${targetId}:${signalPin}`,
    to: endpoint,
    color: '#9bd67d'
  };
}

export function compileCurrentPathsForContexts(spec: CircuitSpec, contexts: SimulationContext[]) {
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

export function attachConnectionSegments(spec: CircuitSpec, path: CurrentPath): CurrentPath {
  const segments = inferConnectionSegmentsForPath(spec, path);
  return {
    ...path,
    connectionIds: unique(segments.map((segment) => segment.connectionId)),
    segments
  };
}

export function inferConnectionSegmentsForPath(
  spec: CircuitSpec,
  path: CurrentPath
): NonNullable<CurrentPath['segments']> {
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

export function connectionsForPathEdge(
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
    return (
      (pathNodeMatchesConnectionEndpoint(leftNode, connection.from, fromKey) &&
        pathNodeMatchesConnectionEndpoint(rightNode, connection.to, toKey)) ||
      (pathNodeMatchesConnectionEndpoint(leftNode, connection.to, toKey) &&
        pathNodeMatchesConnectionEndpoint(rightNode, connection.from, fromKey))
    );
  });
}

export function pathNodeDescriptor(value: string) {
  return value.includes(':')
    ? { kind: 'endpoint' as const, id: value, componentId: endpointFromKey(value).componentId }
    : { kind: 'component' as const, id: value, componentId: value };
}

export function pathNodeMatchesConnectionEndpoint(
  node: ReturnType<typeof pathNodeDescriptor>,
  endpoint: CircuitEndpoint,
  key: string
) {
  return node.kind === 'endpoint' ? node.id === key : node.componentId === endpoint.componentId;
}

export function compileFallbackCurrentPath(
  spec: CircuitSpec,
  context: SimulationContext
): CurrentPath {
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

export function compileTemplatedCurrentPath(
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
    to: resolveTemplateReturnEndpoint(
      template.returnEndpoint,
      spec,
      targetId,
      passiveIds,
      controllerId
    ),
    expectedCurrentMa: template.expectedCurrentMa ?? context.part.simulationModel.nominalCurrentMa,
    animation: template.animation
  };
}

export type CurrentPathTemplate = NonNullable<
  SimulationPrimitive['currentPathRecipe']['pathTemplate']
>;

export function currentPathTemplates(primitive: SimulationPrimitive): CurrentPathTemplate[] {
  return (
    primitive.currentPathRecipe.pathTemplates ??
    (primitive.currentPathRecipe.pathTemplate ? [primitive.currentPathRecipe.pathTemplate] : [])
  );
}

export function requiredPassiveIdsForTarget(
  spec: CircuitSpec,
  targetId: string,
  requiredPassives: PartCapability['requiredPassives']
) {
  const graph = buildEndpointGraph(spec);
  const sourceKeys = controllerSignalEndpointKeys(spec);
  const goalKeys = targetSignalEndpointKeys(spec, targetId);

  return unique(
    requiredPassives.flatMap((passive) => {
      const candidateIds = spec.components
        .filter((component) => component.partId === passive.partId)
        .map((component) => component.id);

      for (const goalKey of goalKeys) {
        const componentIds = componentIdsOnPathThroughAnyComponent(
          graph,
          sourceKeys,
          goalKey,
          candidateIds
        );
        if (componentIds.length > 0) {
          return componentIds;
        }
      }

      return [];
    })
  );
}

export function controllerSignalEndpointKeys(spec: CircuitSpec) {
  const controllerIds = new Set(
    spec.components
      .filter((component) => component.partId === 'arduino-uno')
      .map((component) => component.id)
  );
  return unique(
    spec.connections.flatMap((connection) =>
      [connection.from, connection.to]
        .filter((endpoint) => controllerIds.has(endpoint.componentId))
        .filter(() => !['power', 'ground'].includes(connection.signal))
        .map(endpointKey)
    )
  );
}

export function targetSignalEndpointKeys(spec: CircuitSpec, targetId: string) {
  return unique(
    spec.connections.flatMap((connection) =>
      [connection.from, connection.to]
        .filter((endpoint) => endpoint.componentId === targetId)
        .filter(() => !['power', 'ground'].includes(connection.signal))
        .map(endpointKey)
    )
  );
}

export function resolveTemplateSourceEndpoint(
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

export function resolveControllerSignalEndpoint(
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

export function resolveTemplateReturnEndpoint(
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

export function expandTemplateThrough(
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

export function formatPathTemplateLabel(label: string, part: PartCapability) {
  return label.replaceAll('{partLabel}', part.label);
}

export function findControllerSignalEndpoint(
  spec: CircuitSpec,
  targetId: string,
  passiveIds: string[] = [],
  controllerId = 'arduino-uno'
) {
  const pathIds = new Set([targetId, ...passiveIds]);
  const connection = spec.connections.find((candidate) => {
    const endpoints = [candidate.from, candidate.to];
    return (
      endpoints.some((endpoint) => endpoint.componentId === controllerId) &&
      endpoints.some((endpoint) => pathIds.has(endpoint.componentId)) &&
      !['power', 'ground'].includes(candidate.signal)
    );
  });
  const endpoint = connection
    ? [connection.from, connection.to].find((candidate) => candidate.componentId === controllerId)
    : undefined;
  return endpoint ? `${endpoint.componentId}:${endpoint.pin}` : null;
}

export function findTargetSignalEndpoint(
  spec: CircuitSpec,
  targetId: string,
  passiveIds: string[] = [],
  controllerId = 'arduino-uno'
) {
  const pathIds = new Set([targetId, ...passiveIds]);
  const connection = spec.connections.find((candidate) => {
    const endpoints = [candidate.from, candidate.to];
    return (
      endpoints.some((endpoint) => endpoint.componentId === controllerId) &&
      endpoints.some((endpoint) => pathIds.has(endpoint.componentId)) &&
      !['power', 'ground'].includes(candidate.signal)
    );
  });
  const endpoint = connection
    ? [connection.from, connection.to].find((candidate) => candidate.componentId !== controllerId)
    : undefined;
  return endpoint ? `${endpoint.componentId}:${endpoint.pin}` : null;
}

export function findConnectedControllerEndpointWithRole(
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

export function findConnectedControllerEndpointWithAnyRole(
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

export function findConnectionToControllerRole(
  spec: CircuitSpec,
  targetId: string,
  targetPin: string,
  controllerRole: string
) {
  return spec.connections.find((candidate) => {
    const endpoints = [candidate.from, candidate.to];
    return (
      endpoints.some(
        (endpoint) => endpoint.componentId === targetId && endpoint.pin === targetPin
      ) &&
      endpoints.some((endpoint) => {
        if (endpoint.componentId === targetId) {
          return false;
        }
        const component = spec.components.find(
          (candidateComponent) => candidateComponent.id === endpoint.componentId
        );
        return (
          component?.partId === 'arduino-uno' &&
          controllerPinMatchesRole(endpoint.pin, controllerRole)
        );
      })
    );
  });
}

export function controllerPinMatchesRole(pin: string, role: string) {
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

export function renderEndpointKey(endpoint: RenderPlan['connections'][number]['from']) {
  return `${endpoint.partId}:${endpoint.pin}`;
}

export function requiresBreadboardSurfaceForPlacement(footprint: RenderFootprintEntry) {
  return (
    footprint.placement.breadboardCompatible &&
    !footprint.placement.allowedSurfaces.some(
      (surface) => surface === 'stage' || surface === 'beside-breadboard'
    )
  );
}

export function requiresStrictBreadboardGridAudit(footprint: RenderFootprintEntry) {
  if (!requiresBreadboardSurfaceForPlacement(footprint)) {
    return false;
  }
  return ['button', 'ceramic-capacitor', 'electrolytic-capacitor', 'led', 'resistor'].includes(
    footprint.type
  );
}

export function nearestGridValue(value: number, start: number, end: number, pitch: number) {
  const clamped = Math.max(start, Math.min(end, value));
  const steps = Math.round((clamped - start) / pitch);
  return Number((start + steps * pitch).toFixed(6));
}

export function unique(values: string[]) {
  return [...new Set(values)];
}

export function singleWireCurrentPathIds(partId: string, componentId: string, displayId: string) {
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

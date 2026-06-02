import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildRunnableReport,
  buildNetlist,
  buildSolverGateResult,
  compileRenderPlan,
  compileSimulationPlan,
  estimateCurrentPaths,
  validateCircuitSpec
} from '../server/agent/circuitTools.ts';
import { CircuitSpecSchema, type CircuitSpec } from '../server/agent/schemas.ts';
import { buildContextPacket } from '../server/context/contextPacket.ts';

type CaseDefinition = {
  id: string;
  wp: string;
  titleKo: string;
  purpose: string;
  studentTurns: string[];
  finalPrompt: string;
  expectedAssertion: string;
  spec: CircuitSpec;
};

const outDir = path.resolve('docs/e2e_word_assets');
const outFile = path.join(outDir, 'e2e_12_case_results.json');

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

function baseComponents(extra: CircuitSpec['components']): CircuitSpec['components'] {
  return [
    { id: 'breadboard', partId: 'breadboard-half', label: 'Half-size breadboard', designator: 'BB1' },
    { id: 'arduino-uno', partId: 'arduino-uno', label: 'Arduino Uno', designator: 'U1' },
    ...extra
  ];
}

function ledCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'button-led',
    title: 'Button controlled LED',
    intent: { primaryGoal: 'turn on an LED when a button is pressed', input: 'button', output: 'led', controller: 'arduino-uno' },
    components: baseComponents([
      { id: 'resistor-1', partId: 'resistor-220', label: '220 ohm resistor', designator: 'R1' },
      { id: 'led-1', partId: 'led-5mm', label: 'LED', designator: 'D1' },
      { id: 'button-1', partId: 'button-tactile', label: 'Tactile pushbutton', designator: 'SW1' }
    ]),
    connections: [
      connection('d9-to-resistor', 'arduino-uno', 'D9', 'resistor-1', '1', 'gpio'),
      connection('resistor-to-led', 'resistor-1', '2', 'led-1', 'A', 'gpio'),
      connection('led-to-ground', 'led-1', 'K', 'arduino-uno', 'GND', 'ground'),
      connection('d2-to-button', 'arduino-uno', 'D2', 'button-1', 'A', 'button'),
      connection('button-to-ground', 'button-1', 'B', 'arduino-uno', 'GND', 'ground')
    ],
    behavior: { runText: 'BUTTON -> LED' },
    assumptions: ['The Arduino input uses internal pull-up style behavior.', 'A 220 ohm resistor limits LED current.'],
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
    assumptions: ['The photoresistor module output is read on Arduino A0.', 'Arduino D9 drives the LED through a 220 ohm resistor.'],
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
    assumptions: ['VRX and VRY are read on distinct analog inputs.', 'The joystick switch is represented as qualitative digital input.'],
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

function rgbLedColorCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'rgb-led-color-mix',
    title: 'RGB LED color mix',
    intent: { primaryGoal: 'mix colors on a common cathode RGB LED', output: 'RGB LED', controller: 'arduino-uno', behavior: 'drive red, green, and blue channels with PWM' },
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
    assumptions: ['Each RGB channel has its own 220 ohm current-limiting resistor.', 'The common cathode returns to Arduino GND.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function mosfetMotorCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'mosfet-motor-low-side',
    title: 'MOSFET low-side DC motor',
    intent: { primaryGoal: 'run a small DC motor from Arduino through an IRF520 MOSFET module', output: 'DC motor', controller: 'arduino-uno', behavior: 'switch the motor on with a low-side driver' },
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
    assumptions: ['The IRF520 module is represented as a qualitative low-side switch.', 'Real motors require supply, current, thermal, and flyback/protection design outside the classroom simulation.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function regulated7805PowerRailCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: '7805-regulated-power-rail',
    title: '7805 regulated 5V rail',
    intent: { primaryGoal: 'use a 9V battery clip and 7805 regulator to make a 5V breadboard rail', output: 'regulated 5V power rail', controller: 'arduino-uno', behavior: 'feed regulator input, share ground, and energize the 5V rail from OUT' },
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
    assumptions: ['The 9V battery is a low-voltage DC source for a qualitative 7805 regulator model.', 'This fixture does not size current, heat, dropout, or load capacity.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function controllerBoardContextCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'arduino-nano-controller-context',
    title: 'Arduino Nano pin map and voltage-domain context',
    intent: {
      primaryGoal: 'show Arduino Nano pin map and voltage domain',
      output: 'controller board context',
      controller: 'arduino-nano',
      behavior: 'render the selected controller board as state-only pin-map and voltage-domain context'
    },
    components: [
      { id: 'controller-board-1', partId: 'arduino-nano', label: 'Arduino Nano', designator: 'CTRL1' }
    ],
    connections: [],
    behavior: { runText: 'CONTROLLER BOARD CONTEXT ONLY' },
    assumptions: ['This is controller-board context only.', 'The board pin map and voltage domain are visible, but no circuit substitution wiring is inferred.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function wp09ContextCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'perfboard-5x7-wp09-context',
    title: '5x7 perfboard placement context',
    intent: {
      primaryGoal: 'show perfboard-5x7 as low-voltage prototyping surface context',
      output: 'prototyping surface context',
      controller: 'arduino-uno',
      behavior: 'render the surface as state-only placement context'
    },
    components: baseComponents([
      { id: 'wp09-context-1', partId: 'perfboard-5x7', label: '5x7 perfboard', designator: 'PB1' }
    ]),
    connections: [],
    behavior: { runText: 'PROTOTYPING SURFACE CONTEXT ONLY' },
    assumptions: ['This is a low-voltage classroom context object.', 'The context object does not create hidden nets, solder bridges, or current paths by itself.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function bmp280DisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'bmp280-display-readout',
    title: 'BMP280 pressure and temperature on OLED',
    intent: {
      primaryGoal: 'show BMP280 pressure and temperature value on an OLED display',
      input: 'BMP280 pressure and temperature sensor',
      output: 'OLED qualitative sensor readout',
      controller: 'arduino-uno',
      behavior: 'read the I2C sensor and display a qualitative value'
    },
    components: baseComponents([
      { id: 'bmp280-1', partId: 'bmp280', label: 'BMP280 pressure and temperature sensor', designator: 'S1' },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('sensor-power', 'arduino-uno', '5V', 'bmp280-1', 'VCC', 'power'),
      connection('sensor-ground', 'arduino-uno', 'GND', 'bmp280-1', 'GND', 'ground'),
      connection('sensor-sda', 'bmp280-1', 'SDA', 'arduino-uno', 'A4/SDA', 'i2c-data'),
      connection('sensor-scl', 'bmp280-1', 'SCL', 'arduino-uno', 'A5/SCL', 'i2c-clock'),
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'PRESSURE: 1008 HPA TEMP: 24C' },
    assumptions: ['The sensor shares the I2C bus with the OLED display.', 'The simulated value is qualitative classroom feedback, not calibrated instrumentation.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function hc05CommandStateCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: 'hc05-command-state-display',
    title: 'HC-05 local UART command state on OLED',
    intent: {
      primaryGoal: 'show HC-05 Bluetooth module local UART command state on an OLED display',
      input: 'HC-05 Bluetooth module',
      output: 'OLED qualitative command-state readout',
      controller: 'arduino-uno',
      behavior: 'read local UART command state and display it as classroom-only module status'
    },
    components: baseComponents([
      { id: 'hc05-1', partId: 'hc05-bluetooth', label: 'HC-05 Bluetooth module', designator: 'BT1' },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('bt-power', 'arduino-uno', '5V', 'hc05-1', 'VCC', 'power'),
      connection('bt-ground', 'arduino-uno', 'GND', 'hc05-1', 'GND', 'ground'),
      connection('bt-tx-to-rx', 'hc05-1', 'TX', 'arduino-uno', 'D0/RX', 'uart'),
      connection('bt-rx-to-tx', 'arduino-uno', 'D1/TX', 'hc05-1', 'RX', 'uart'),
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'BT UART STATE: LOCAL DEMO' },
    assumptions: ['The HC-05 readout is local UART command-state only.', 'External wireless behavior is outside this classroom simulation.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

function shiftRegisterDisplayCircuit(): CircuitSpec {
  return CircuitSpecSchema.parse({
    id: '74hc595-shift-interface-display',
    title: '74HC595 qualitative interface state on OLED',
    intent: {
      primaryGoal: 'show 74HC595 shift register interface state on an OLED display',
      input: '74HC595 GPIO shift register interface',
      output: 'OLED qualitative interface state',
      controller: 'arduino-uno',
      behavior: 'show qualitative classroom interface state'
    },
    components: baseComponents([
      { id: 'logic-1', partId: '74hc595-shift', label: '74HC595 shift register', designator: 'U2' },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED', designator: 'DISP1' }
    ]),
    connections: [
      connection('logic-power', 'arduino-uno', '5V', 'logic-1', 'VCC', 'power'),
      connection('logic-ground', 'arduino-uno', 'GND', 'logic-1', 'GND', 'ground'),
      connection('logic-data', 'arduino-uno', 'D4', 'logic-1', 'SER', 'gpio'),
      connection('logic-clock', 'arduino-uno', 'D5', 'logic-1', 'SRCLK', 'gpio'),
      connection('logic-latch', 'arduino-uno', 'D6', 'logic-1', 'RCLK', 'gpio'),
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'SHIFT REGISTER STATE: DEMO' },
    assumptions: ['The interface IC state is qualitative classroom feedback.', 'The circuit does not infer hidden expanded outputs or chip-level electrical simulation.'],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

const cases: CaseDefinition[] = [
  {
    id: 'case-01-ldr-dark-led',
    wp: 'WP-01',
    titleKo: '조도 센서로 어두우면 LED 켜기',
    purpose: '학생이 센서 기반 LED 동작을 탐색한 뒤 지원되는 photoresistor threshold 회로로 확정하는지 확인한다.',
    studentTurns: ['뭐 만들까? 한번 제안해줘.', '센서가 들어간 회로가 좋아.', '조도 센서로 어두우면 LED 켜지는 걸로 하자.', '좋아, 그 회로로 진행해줘.'],
    finalPrompt: '조도 센서로 어두우면 LED 켜지는 회로를 만들어줘',
    expectedAssertion: 'light-sensor-triggered-output route, LED resistor path, analog threshold signal, runnable simulation',
    spec: ldrDarkLedCircuit()
  },
  {
    id: 'case-02-button-led',
    wp: 'WP-02',
    titleKo: '버튼을 누르면 LED 켜기',
    purpose: '간단한 디지털 입력-출력 요구가 반복 확인 없이 button-controlled-light-output으로 진행되는지 확인한다.',
    studentTurns: ['처음 해볼 회로 추천해줘.', '버튼으로 LED 켜는 건 어때?', '그걸로 진행하자.', '버튼을 누르면 LED가 켜지는 회로로 확정해줘.'],
    finalPrompt: '버튼을 누르면 LED가 켜지는 회로로 진행해줘',
    expectedAssertion: 'button input, protected LED load, current path, runnable simulation',
    spec: ledCircuit()
  },
  {
    id: 'case-03-joystick-oled',
    wp: 'WP-03',
    titleKo: '조이스틱 X/Y 값을 OLED에 표시',
    purpose: 'multi-input analog/digital module이 joystick-display-readout으로 라우팅되고 X/Y/SW 신호가 분리되는지 확인한다.',
    studentTurns: ['입력 장치가 있는 회로를 만들어보고 싶어.', '방향을 움직이는 입력이면 좋겠어.', '조이스틱 값을 화면에 보여주자.', '조이스틱 X/Y 값을 OLED에 표시해줘.'],
    finalPrompt: '조이스틱 X/Y 값을 OLED에 표시해줘',
    expectedAssertion: 'joystick-display-readout route, dual analog paths, switch signal, OLED bus, runnable simulation',
    spec: joystickDisplayCircuit()
  },
  {
    id: 'case-04-lcd-text',
    wp: 'WP-04',
    titleKo: '16x2 I2C LCD에 문구 표시',
    purpose: 'display expansion 부품이 OLED fallback으로 섞이지 않고 LCD footprint와 I2C display contract를 쓰는지 확인한다.',
    studentTurns: ['화면에 글자를 띄우는 회로를 해보자.', 'OLED 말고 LCD도 가능해?', '16x2 LCD에 간단한 문구를 띄우고 싶어.', '16x2 I2C LCD에 HELLO LCD를 표시해줘.'],
    finalPrompt: '16x2 I2C LCD에 HELLO LCD를 표시해줘',
    expectedAssertion: 'display-text-output route, lcd-16x2 candidate, I2C display current/bus paths, runnable simulation',
    spec: lcdTextDisplayCircuit()
  },
  {
    id: 'case-05-rgb-led',
    wp: 'WP-05',
    titleKo: 'RGB LED 색상 믹스',
    purpose: 'WP-05 light output 부품이 각 채널 저항과 PWM 경로를 요구하는지 확인한다.',
    studentTurns: ['LED보다 조금 더 화려한 출력이 있을까?', '색이 바뀌는 LED를 써보고 싶어.', 'RGB LED로 색을 섞어보자.', '공통 캐소드 RGB LED 색상 믹스 회로를 만들어줘.'],
    finalPrompt: '공통 캐소드 RGB LED 색상 믹스 회로를 만들어줘',
    expectedAssertion: 'explicit RGB LED, three current-limited channels, PWM activity, runnable simulation',
    spec: rgbLedColorCircuit()
  },
  {
    id: 'case-06-mosfet-motor',
    wp: 'WP-06',
    titleKo: 'IRF520으로 DC 모터 구동',
    purpose: '모터를 GPIO에 직접 연결하지 않고 low-side driver contract와 high-current warning을 적용하는지 확인한다.',
    studentTurns: ['움직이는 회로를 만들 수 있어?', '작은 DC 모터를 돌리고 싶어.', '아두이노에서 바로 연결하지 말고 드라이버를 써보자.', 'IRF520 MOSFET 모듈로 DC 모터를 켜는 회로를 만들어줘.'],
    finalPrompt: 'IRF520 MOSFET 모듈로 DC 모터를 켜는 회로를 만들어줘',
    expectedAssertion: 'low-side-switched-load-output route, driver control path, motor load path, safety warning, runnable simulation',
    spec: mosfetMotorCircuit()
  },
  {
    id: 'case-07-7805-rail',
    wp: 'WP-07',
    titleKo: '9V 배터리와 7805로 5V 전원 레일 만들기',
    purpose: '전원/레귤레이터 context가 부하 용량을 과장하지 않고 rail state simulation으로 처리되는지 확인한다.',
    studentTurns: ['전원 회로도 테스트해보자.', '9V 배터리를 5V로 낮출 수 있어?', '7805 레귤레이터로 브레드보드 5V 레일을 만들자.', '9V 배터리와 7805로 5V 브레드보드 전원 레일을 만들어줘.'],
    finalPrompt: '9V 배터리와 7805로 5V 브레드보드 전원 레일을 만들어줘',
    expectedAssertion: 'low-voltage-power-rail route, regulator IN/OUT/GND paths, qualitative rail state, runnable simulation',
    spec: regulated7805PowerRailCircuit()
  },
  {
    id: 'case-08-arduino-nano-context',
    wp: 'WP-08',
    titleKo: 'Arduino Nano 핀맵과 전압 도메인 보기',
    purpose: 'controller board 요청이 회로 대체를 추론하지 않고 pin-map context로만 표시되는지 확인한다.',
    studentTurns: ['보드를 Uno 말고 다른 걸로 볼 수 있어?', 'Arduino Nano가 궁금해.', '일단 핀맵이랑 전압 도메인부터 보여줘.', 'Arduino Nano 핀맵과 전압 도메인을 보여줘.'],
    finalPrompt: 'Arduino Nano 핀맵과 전압 도메인을 보여줘',
    expectedAssertion: 'controller-board-substitution route, state-only render, no inferred circuit substitution, runnable context simulation',
    spec: controllerBoardContextCircuit()
  },
  {
    id: 'case-09-perfboard-context',
    wp: 'WP-09',
    titleKo: 'Perfboard 배치 컨텍스트 보기',
    purpose: 'prototyping surface가 숨은 net/current를 만들지 않고 placement context로만 렌더되는지 확인한다.',
    studentTurns: ['브레드보드 말고 납땜 보드도 볼 수 있어?', '5x7 perfboard를 써보고 싶어.', '실제 배선 전에 배치만 확인하자.', '5x7 perfboard를 low-voltage 배치 컨텍스트로 보여줘.'],
    finalPrompt: '5x7 perfboard를 low-voltage 배치 컨텍스트로 보여줘',
    expectedAssertion: 'prototyping-surface-context route, no hidden current path, state-only runnable context',
    spec: wp09ContextCircuit()
  },
  {
    id: 'case-10-bmp280-oled',
    wp: 'WP-10',
    titleKo: 'BMP280 값을 OLED에 표시',
    purpose: 'I2C protocol sensor와 OLED가 같은 bus를 공유하고 calibrated measurement overclaim 없이 정성 readout으로 실행되는지 확인한다.',
    studentTurns: ['센서 모듈 중에 기압 센서도 있어?', 'BMP280으로 온도랑 기압을 보고 싶어.', 'OLED에 값을 표시하자.', 'BMP280 기압/온도 값을 OLED에 표시해줘.'],
    finalPrompt: 'BMP280 기압/온도 값을 OLED에 표시해줘',
    expectedAssertion: 'i2c-sensor-display-readout route, sensor/OLED shared I2C bus, qualitative readout, runnable simulation',
    spec: bmp280DisplayCircuit()
  },
  {
    id: 'case-11-hc05-uart',
    wp: 'WP-11',
    titleKo: 'HC-05 로컬 UART 상태를 OLED에 표시',
    purpose: '통신 모듈이 실제 페어링/네트워크를 주장하지 않고 local command-state simulation으로 제한되는지 확인한다.',
    studentTurns: ['블루투스 모듈도 테스트 가능해?', '폰 연결까지는 말고 모듈 상태만 보고 싶어.', 'HC-05 UART 상태를 화면에 표시하자.', 'HC-05 블루투스 모듈의 로컬 UART 상태를 OLED에 표시해줘.'],
    finalPrompt: 'HC-05 블루투스 모듈의 로컬 UART 상태를 OLED에 표시해줘',
    expectedAssertion: 'uart-communication-module route, TX/RX direction, OLED bus, network overclaim blocked, runnable qualitative simulation',
    spec: hc05CommandStateCircuit()
  },
  {
    id: 'case-12-74hc595-interface',
    wp: 'WP-12',
    titleKo: '74HC595 인터페이스 상태를 OLED에 표시',
    purpose: 'logic/interface IC가 hidden output load나 chip-level simulation을 추론하지 않고 qualitative interface state로 처리되는지 확인한다.',
    studentTurns: ['IC도 다룰 수 있는지 보자.', '시프트 레지스터가 궁금해.', '출력 LED 여러 개까지는 말고 상태를 OLED에 보여줘.', '74HC595 시프트 레지스터 상태를 OLED에 표시해줘.'],
    finalPrompt: '74HC595 시프트 레지스터 상태를 OLED에 표시해줘',
    expectedAssertion: 'logic-interface-context route, SER/SRCLK/RCLK signals, qualitative interface warning, runnable simulation',
    spec: shiftRegisterDisplayCircuit()
  }
];

async function buildCaseResult(testCase: CaseDefinition) {
  const packet = await buildContextPacket({
    message: testCase.finalPrompt,
    locale: 'ko'
  });
  const validationReport = await validateCircuitSpec(testCase.spec);
  const netlist = await buildNetlist(testCase.spec);
  const renderPlan = await compileRenderPlan(testCase.spec, validationReport);
  const currentPaths = await estimateCurrentPaths(testCase.spec, netlist, validationReport);
  const simulationPlan = await compileSimulationPlan(testCase.spec, validationReport, currentPaths, renderPlan);
  const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);
  const solverGateResult = buildSolverGateResult(validationReport, renderPlan, simulationPlan, runnableReport);
  const promptBudget = `${packet.promptBlock.length}/${packet.retrievalPlan.maxPromptChars}`;
  const bundleIds = packet.retrievalPlan.sourceIds.filter((sourceId) => sourceId.startsWith('bundle:'));
  const topology = typeof validationReport.electricalAnalysis?.selectedTopologyTemplateId === 'string'
    ? validationReport.electricalAnalysis.selectedTopologyTemplateId
    : typeof validationReport.electricalAnalysis?.topologyTemplateId === 'string'
      ? validationReport.electricalAnalysis.topologyTemplateId
      : 'n/a';

  const deepagentLog = [
    `[coordinator] request-analysis completed: route=${packet.contextRoute.routeId}; capabilities=${packet.capabilityMatches.map((capability) => capability.id).join(', ') || 'none'}`,
    `[retriever] context-packet completed: bundles=${bundleIds.join(', ') || 'none'}; candidates=${packet.candidateParts.map((part) => part.id).join(', ')}; promptBudget=${promptBudget}`,
    `[planner] draft-grounding completed: topology=${topology}; components=${testCase.spec.components.map((component) => component.partId).join(', ')}`,
    `[tool:validate_circuit_spec] ${validationReport.status}: errors=${validationReport.errors.length}; warnings=${validationReport.warnings.length}; validatedPaths=${validationReport.validatedCurrentPathIds.join(', ') || 'none'}`,
    `[tool:compile_render_plan] completed: parts=${renderPlan.parts.length}; wires=${renderPlan.connections.length}; renderWarnings=${renderPlan.warnings.length}`,
    `[tool:compile_simulation_plan] ${simulationPlan.status}: paths=${simulationPlan.currentPaths.map((currentPath) => currentPath.id).join(', ') || 'none'}; expectedStates=${simulationPlan.expectedStates.length}`,
    `[runnable-gate] ${runnableReport.status}: runnable=${runnableReport.runnable}; reasons=${runnableReport.reasons.join(' | ') || 'none'}`,
    `[solver-gate] mode=${solverGateResult.mode}; visible=${solverGateResult.visibleSimulation}; buildReady=${solverGateResult.buildReady}; activity=${solverGateResult.simulationActivity}; repair=${solverGateResult.repairLevel}`
  ];

  return {
    id: testCase.id,
    wp: testCase.wp,
    titleKo: testCase.titleKo,
    purpose: testCase.purpose,
    studentTurns: testCase.studentTurns,
    finalPrompt: testCase.finalPrompt,
    expectedAssertion: testCase.expectedAssertion,
    context: {
      routeId: packet.contextRoute.routeId,
      capabilityIds: packet.capabilityMatches.map((capability) => capability.id),
      candidatePartIds: packet.candidateParts.map((part) => part.id),
      sourceIds: packet.retrievalPlan.sourceIds,
      promptBudget,
      coverageStatus: packet.contextCoverage.status,
      synthesisEligibility: packet.contextCoverage.synthesisEligibility.status
    },
    deepagentLog,
    spec: testCase.spec,
    validationReport,
    renderPlan,
    simulationPlan,
    runnableReport,
    solverGateResult
  };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const results = [];
  for (const testCase of cases) {
    results.push(await buildCaseResult(testCase));
  }
  await writeFile(outFile, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    title: 'Deepagents E2E 12-case simulation test document assets',
    cases: results
  }, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${outFile}`);
  for (const result of results) {
    console.log(`${result.id}: ${result.context.routeId} | ${result.validationReport.status} | ${result.simulationPlan.status} | ${result.runnableReport.status}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

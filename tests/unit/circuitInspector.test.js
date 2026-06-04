import assert from 'node:assert/strict';
import test from 'node:test';

import { answerTutorQuestion, describeCircuitTarget } from '../../src/circuitInspector.js';

// Inline fixture — replaced createDemoCircuit() after Phase 1 demo removal.
function makeOledCircuit(locale = 'ko') {
  const isKo = locale !== 'en';
  return {
    title: isKo ? 'Arduino OLED 이름 표시' : 'Arduino OLED name display',
    runText: 'RALPHTON BUSAN',
    parts: [
      {
        id: 'arduino-uno', type: 'arduino',
        label: isKo ? 'Arduino Uno' : 'Arduino Uno',
        description: isKo ? '작은 컴퓨터' : 'Tiny computer',
        pins: [
          { name: '5V', role: 'power', meaning: isKo ? '5V 전원' : '5V power' },
          { name: 'GND', role: 'ground', meaning: isKo ? '공통 GND' : 'common GND' },
          { name: 'A4/SDA', role: 'i2c-data', meaning: isKo ? 'I2C 데이터' : 'I2C data' },
          { name: 'A5/SCL', role: 'i2c-clock', meaning: isKo ? 'I2C 클록' : 'I2C clock' }
        ]
      },
      {
        id: 'oled-display', type: 'oled',
        label: isKo ? '0.96 inch I2C OLED' : '0.96 inch I2C OLED',
        description: isKo ? '작은 화면' : 'Small screen',
        pins: [
          { name: 'VCC', role: 'power', meaning: isKo ? '전원 입력' : 'power input' },
          { name: 'GND', role: 'ground', meaning: isKo ? '공통 GND' : 'common GND' },
          { name: 'SDA', role: 'i2c-data', meaning: isKo ? '데이터 수신' : 'receive data' },
          { name: 'SCL', role: 'i2c-clock', meaning: isKo ? '클록 수신' : 'receive clock' }
        ]
      }
    ],
    connections: [
      {
        id: 'oled-power',
        from: { partId: 'arduino-uno', pin: '5V' },
        to: { partId: 'oled-display', pin: 'VCC' },
        signal: 'power', color: '#ff4d3d',
        education: {
          label: '5V POWER',
          title: isKo ? '전원을 보내는 선' : 'This wire carries power',
          what: isKo ? '빨간 점퍼선은 Arduino 5V를 OLED로 보냅니다.' : 'Red jumper carries 5V from Arduino to OLED.',
          why: isKo ? '화면이 켜지려면 전원이 필요합니다.' : 'The screen needs power before lighting pixels.',
          missing: isKo ? '이 선이 빠지면 OLED가 켜지지 않습니다.' : 'Without this wire the OLED stays dark.'
        }
      },
      {
        id: 'oled-ground',
        from: { partId: 'arduino-uno', pin: 'GND' },
        to: { partId: 'oled-display', pin: 'GND' },
        signal: 'ground', color: '#20242a',
        education: {
          label: 'GND',
          title: isKo ? '전류가 돌아오는 길' : 'This wire closes the loop',
          what: isKo ? '검은 점퍼선은 공통 GND를 만듭니다.' : 'Black jumper gives both boards the same GND.',
          why: isKo ? '전류에는 돌아오는 길이 필요합니다.' : 'Electricity needs a return path.',
          missing: isKo ? 'GND가 없으면 화면이 깜빡입니다.' : 'Without GND the screen may flicker.'
        }
      },
      {
        id: 'oled-sda',
        from: { partId: 'arduino-uno', pin: 'A4/SDA' },
        to: { partId: 'oled-display', pin: 'SDA' },
        signal: 'i2c-data', color: '#2f7df6',
        education: {
          label: 'I2C SDA',
          title: isKo ? '화면 데이터를 보내는 선' : 'This wire carries the message',
          what: isKo ? '파란 점퍼선은 A4에서 SDA로 데이터를 전달합니다.' : 'Blue jumper carries display data from A4 to SDA.',
          why: isKo ? 'SDA는 I2C 데이터 선입니다.' : 'SDA is the I2C data line.',
          missing: isKo ? '이 선이 없으면 OLED가 그릴 수 없습니다.' : 'Without this wire the OLED cannot draw anything.'
        }
      },
      {
        id: 'oled-scl',
        from: { partId: 'arduino-uno', pin: 'A5/SCL' },
        to: { partId: 'oled-display', pin: 'SCL' },
        signal: 'i2c-clock', color: '#f6c44c',
        education: {
          label: 'I2C SCL',
          title: isKo ? '통신 박자를 맞추는 선' : 'This wire keeps time',
          what: isKo ? '노란 점퍼선은 A5에서 SCL로 클록을 전달합니다.' : 'Yellow jumper carries clock from A5 to SCL.',
          why: isKo ? '클록은 두 보드가 데이터를 읽는 박자를 맞춥니다.' : 'The clock tells both boards when to read each bit.',
          missing: isKo ? '이 선이 없으면 화면을 갱신할 수 없습니다.' : 'Without this wire the screen cannot update.'
        }
      }
    ]
  };
}

function makeLedBlinkCircuit() {
  return {
    title: 'Arduino Uno LED blink',
    runText: 'LED BLINK',
    parts: [
      { id: 'breadboard', type: 'breadboard', label: 'Half-size breadboard', pins: [] },
      { id: 'uno', type: 'arduino', label: 'Arduino Uno', pins: [] },
      { id: 'r1', type: 'resistor', label: '220 ohm resistor', pins: [] },
      { id: 'led', type: 'led', label: '5 mm LED', pins: [] }
    ],
    connections: [
      {
        id: 'c1',
        from: { partId: 'uno', pin: 'D8' },
        to: { partId: 'r1', pin: '1' },
        signal: 'gpio',
        education: { label: 'D8', title: 'D8', what: 'D8 to resistor', why: 'series path', missing: 'LED current path opens.' }
      },
      {
        id: 'c2',
        from: { partId: 'r1', pin: '2' },
        to: { partId: 'led', pin: 'A' },
        signal: 'gpio',
        education: { label: 'LED A', title: 'LED A', what: 'resistor to LED', why: 'current limited LED input', missing: 'LED path opens.' }
      }
    ]
  };
}

test('circuit inspector describes a selected connection with simulation grounding', () => {
  const circuit = makeOledCircuit('ko');
  const target = describeCircuitTarget(circuit, { type: 'connection', connectionId: 'oled-sda' }, 'ko');

  assert.equal(target.type, 'connection');
  assert.equal(target.label, 'I2C SDA');
  assert.equal(target.signal, 'i2c-data');
  assert.match(target.detail, /Arduino/);
  assert.match(target.detail, /OLED/);
  assert.ok(target.questions.some((question) => /전류/.test(question)));
});

test('circuit tutor answers selected-target questions without network', () => {
  const circuit = makeOledCircuit('ko');
  const target = describeCircuitTarget(circuit, { type: 'connection', connectionId: 'oled-power' }, 'ko');
  const answer = answerTutorQuestion({
    circuit,
    target,
    question: '이 선이 없으면 어떻게 돼?',
    locale: 'ko',
    running: true
  });

  assert.match(answer.message, /검증된 회로/);
  assert.match(answer.message, /OLED/);
  assert.ok(answer.grounding.includes('connection:oled-power'));
  assert.ok(answer.suggestedQuestions.length >= 3);
});

test('whole-circuit tutor copy stays grounded to LED circuits instead of OLED display copy', () => {
  const circuit = {
    title: 'Arduino Uno LED 깜빡이기',
    runText: 'LED BLINK',
    parts: [
      { id: 'uno', type: 'arduino', label: 'Arduino Uno', pins: [] },
      { id: 'r1', type: 'resistor', label: '220 ohm resistor', pins: [] },
      { id: 'led', type: 'led', label: '5 mm LED', pins: [] }
    ],
    connections: [
      {
        id: 'c1',
        from: { partId: 'uno', pin: 'D8' },
        to: { partId: 'r1', pin: '1' },
        signal: 'gpio',
        education: { label: 'D8', title: 'D8', what: 'D8 to resistor', why: 'series path', missing: 'LED current path opens.' }
      }
    ]
  };
  const target = describeCircuitTarget(circuit, null, 'ko');
  const answer = answerTutorQuestion({
    circuit,
    target,
    question: '전선 연결이 안되도 상관없니?',
    locale: 'ko'
  });

  assert.match(answer.message, /LED/);
  assert.match(answer.message, /닫힌 경로|GND|전류 흐름/);
  assert.doesNotMatch(answer.message, /화면|표시 장치|OLED/);
  assert.doesNotMatch(answer.message, /깜빡이기이 빠질 때/);
});

test('breadboard target plus LED voltage question returns LED current-limiting guidance', () => {
  const circuit = makeLedBlinkCircuit();
  const target = describeCircuitTarget(circuit, { type: 'part', partId: 'breadboard' }, 'en');
  const answer = answerTutorQuestion({
    circuit,
    target,
    question: 'Can the LED handle a higher voltage?',
    locale: 'en'
  });

  assert.match(answer.message, /LED/i);
  assert.match(answer.message, /current[- ]limiting resistor|limits current|resistor/i);
  assert.match(answer.message, /higher voltage|5V|3\.3V|driver|MOSFET|transistor/i);
  assert.doesNotMatch(answer.message, /solderless practice board|visible, editable layout/i);
});

test('breadboard target plus Korean LED voltage question returns current-limiting guidance', () => {
  const circuit = makeLedBlinkCircuit();
  const target = describeCircuitTarget(circuit, { type: 'part', partId: 'breadboard' }, 'ko');
  const answer = answerTutorQuestion({
    circuit,
    target,
    question: 'led\uB294 \uC800\uAC83\uBCF4\uB2E4 \uB192\uC740 \uBCFC\uD2F0\uC9C0\uB3C4 serving \uD560 \uC218 \uC788\uC5B4?',
    locale: 'ko'
  });

  assert.match(answer.message, /LED/i);
  assert.match(answer.message, /\uC804\uB958|\uC800\uD56D|current-limiting/i);
  assert.match(answer.message, /5V|3\.3V|MOSFET|transistor/i);
  assert.doesNotMatch(answer.message, /breadboard|solderless practice board/i);
});

test('breadboard target plus generic question stays breadboard-focused', () => {
  const circuit = makeLedBlinkCircuit();
  const target = describeCircuitTarget(circuit, { type: 'part', partId: 'breadboard' }, 'en');
  const answer = answerTutorQuestion({
    circuit,
    target,
    question: 'What does this part do?',
    locale: 'en'
  });

  assert.match(answer.message, /breadboard|solderless practice board|layout/i);
  assert.doesNotMatch(answer.message, /MOSFET|higher voltage|3\.3V/i);
});

test('whole-circuit run guidance uses generic simulation output copy', () => {
  const circuit = {
    title: 'Arduino Uno LED blink',
    runText: 'LED BLINK',
    parts: [
      { id: 'uno', type: 'arduino', label: 'Arduino Uno', pins: [] },
      { id: 'r1', type: 'resistor', label: '220 ohm resistor', pins: [] },
      { id: 'led', type: 'led', label: '5 mm LED', pins: [] }
    ],
    connections: [
      {
        id: 'c1',
        from: { partId: 'uno', pin: 'D8' },
        to: { partId: 'r1', pin: '1' },
        signal: 'gpio',
        education: { label: 'D8', title: 'D8', what: 'D8 to resistor', why: 'series path', missing: 'LED current path opens.' }
      }
    ]
  };
  const target = describeCircuitTarget(circuit, null, 'en');
  const answer = answerTutorQuestion({
    circuit,
    target,
    question: 'What changes when I press Run?',
    locale: 'en'
  });

  assert.match(answer.message, /simulation output/i);
  assert.doesNotMatch(answer.message, /OLED output/i);
});

test('whole-circuit tutor copy explains potentiometer dimming without blink fallback', () => {
  const circuit = {
    title: '가변저항으로 LED 밝기 조절',
    runText: 'KNOB -> PWM LED BRIGHTNESS',
    parts: [
      { id: 'uno', type: 'arduino', label: 'Arduino Uno', pins: [] },
      { id: 'pot', type: 'potentiometer', label: '10K potentiometer', pins: [] },
      { id: 'r1', type: 'resistor', label: '220 ohm resistor', pins: [] },
      { id: 'led', type: 'led', label: '5 mm LED', pins: [] }
    ],
    connections: [
      {
        id: 'c1',
        from: { partId: 'pot', pin: 'OUT' },
        to: { partId: 'uno', pin: 'A0' },
        signal: 'analog',
        education: { label: 'A0', title: 'A0', what: 'pot to A0', why: 'analog input', missing: 'No brightness control.' }
      }
    ]
  };
  const target = describeCircuitTarget(circuit, null, 'ko');
  const answer = answerTutorQuestion({
    circuit,
    target,
    question: '실행하면 어떻게 돼?',
    locale: 'ko'
  });

  assert.match(answer.message, /가변저항|A0|PWM|밝기/);
  assert.doesNotMatch(answer.message, /깜빡입니다/);
});

test('whole-circuit tutor copy explains light sensor threshold output', () => {
  const circuit = {
    title: 'Photoresistor dark-triggered LED',
    runText: 'DARK THRESHOLD -> LED ON',
    parts: [
      { id: 'uno', type: 'arduino', label: 'Arduino Uno', pins: [] },
      { id: 'ldr', type: 'ldr-module', label: 'Photoresistor LDR module', pins: [] },
      { id: 'r1', type: 'resistor', label: '220 ohm resistor', pins: [] },
      { id: 'led', type: 'led', label: '5 mm LED', pins: [] }
    ],
    connections: [
      {
        id: 'c1',
        from: { partId: 'ldr', pin: 'AO' },
        to: { partId: 'uno', pin: 'A0' },
        signal: 'analog',
        education: { label: 'A0', title: 'A0', what: 'LDR to A0', why: 'threshold input', missing: 'No sensor reading.' }
      }
    ]
  };
  const target = describeCircuitTarget(circuit, null, 'en');
  const answer = answerTutorQuestion({
    circuit,
    target,
    question: 'What changes when I press Run?',
    locale: 'en'
  });

  assert.match(answer.message, /light sensor|A0|dark threshold|LED output/i);
  assert.doesNotMatch(answer.message, /alternates HIGH and LOW/i);
});

test('whole-circuit tutor copy explains ultrasonic distance display before generic OLED copy', () => {
  const circuit = {
    title: 'HC-SR04 distance on OLED',
    runText: 'DISTANCE: 42 CM',
    parts: [
      { id: 'uno', type: 'arduino', label: 'Arduino Uno', pins: [] },
      { id: 'sonar', type: 'ultrasonic-sensor', label: 'HC-SR04 ultrasonic distance sensor', pins: [] },
      { id: 'oled', type: 'oled', label: '0.96 inch I2C OLED', pins: [] }
    ],
    connections: [
      {
        id: 'trig',
        from: { partId: 'uno', pin: 'D3' },
        to: { partId: 'sonar', pin: 'TRIG' },
        signal: 'gpio',
        education: { label: 'TRIG', title: 'TRIG', what: 'D3 to TRIG', why: 'trigger pulse', missing: 'No distance pulse.' }
      }
    ]
  };
  const target = describeCircuitTarget(circuit, null, 'ko');
  const answer = answerTutorQuestion({
    circuit,
    target,
    question: '실행하면 어떻게 돼?',
    locale: 'ko'
  });

  assert.match(answer.message, /TRIG|ECHO|D2|OLED|거리/);
  assert.doesNotMatch(answer.message, /표시 장치가 DISTANCE: 42 CM를 보여/);
});

test('part tutor gives concrete resistor explanations for LED circuits', () => {
  const circuit = {
    title: 'Arduino Uno LED blink',
    runText: 'LED BLINK',
    parts: [
      { id: 'uno', type: 'arduino', label: 'Arduino Uno', pins: [] },
      { id: 'r1', type: 'resistor', label: '220 ohm current-limiting resistor', description: '220 ohm resistor', pins: [] },
      { id: 'led', type: 'led', label: '5 mm LED', pins: [] }
    ],
    connections: [
      {
        id: 'c1',
        from: { partId: 'uno', pin: 'D8' },
        to: { partId: 'r1', pin: '1' },
        signal: 'gpio',
        education: { label: 'D8', title: 'D8', what: 'D8 to resistor', why: 'series path', missing: 'LED current path opens.' }
      },
      {
        id: 'c2',
        from: { partId: 'r1', pin: '2' },
        to: { partId: 'led', pin: 'A' },
        signal: 'gpio',
        education: { label: 'current limit', title: 'current limit', what: 'resistor to LED', why: 'limits current', missing: 'LED can draw too much current.' }
      }
    ]
  };
  const target = describeCircuitTarget(circuit, { type: 'part', partId: 'r1' }, 'ko');
  const answer = answerTutorQuestion({
    circuit,
    target,
    question: '이 부품은 무슨 역할이야?',
    locale: 'ko'
  });

  assert.match(answer.message, /전류를 제한|과전류|LED/);
  assert.doesNotMatch(answer.message, /학습 맥락을 구성/);
});

test('circuit inspector keeps English copy available for the language toggle', () => {
  const circuit = makeOledCircuit('en');
  const target = describeCircuitTarget(circuit, { type: 'part', partId: 'oled-display' }, 'en');
  const answer = answerTutorQuestion({
    circuit,
    target,
    question: 'How does current flow here?',
    locale: 'en'
  });

  assert.equal(target.type, 'part');
  assert.match(target.detail, /connection/);
  assert.match(answer.message, /current/i);
});

test('circuit tutor explains why Run is blocked by render DRC warnings', () => {
  const circuit = {
    title: 'Button LED rail conflict',
    runText: 'LED ON',
    parts: [
      { id: 'led-1', type: 'led', label: '5 mm LED', pins: [] },
      { id: 'button-1', type: 'button', label: 'Tactile button', pins: [] }
    ],
    connections: [],
    simulationPlan: {
      status: 'invalid',
      runText: '',
      currentPaths: [],
      expectedStates: [],
      warnings: [
        'SIMULATION_BLOCKED_BY_RENDER_DRC: BREADBOARD_RAIL_CONFLICT on led-1. led-1:A and button-1:B share the same breadboard rail (+ rail) without a logical connection.'
      ]
    },
    validationReport: {
      status: 'valid',
      errors: [],
      warnings: [],
      validatedCurrentPathIds: ['led-forward-current']
    }
  };
  const target = describeCircuitTarget(circuit, null, 'en');
  const answer = answerTutorQuestion({
    circuit,
    target,
    question: 'Why is Run blocked?',
    locale: 'en',
    running: false
  });

  assert.match(answer.message, /Run|simulation/i);
  assert.match(answer.message, /BREADBOARD_RAIL_CONFLICT|rail/i);
  assert.match(answer.message, /blocked|cannot animate|not animate/i);
});

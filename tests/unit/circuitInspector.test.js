import assert from 'node:assert/strict';
import test from 'node:test';

import { createDemoCircuit } from '../../src/circuitMetadata.js';
import { answerTutorQuestion, describeCircuitTarget } from '../../src/circuitInspector.js';

test('circuit inspector describes a selected connection with simulation grounding', () => {
  const circuit = createDemoCircuit();
  const target = describeCircuitTarget(circuit, { type: 'connection', connectionId: 'oled-sda' }, 'ko');

  assert.equal(target.type, 'connection');
  assert.equal(target.label, 'I2C SDA');
  assert.equal(target.signal, 'i2c-data');
  assert.match(target.detail, /Arduino/);
  assert.match(target.detail, /OLED/);
  assert.ok(target.questions.some((question) => /전류/.test(question)));
});

test('circuit tutor answers selected-target questions without network', () => {
  const circuit = createDemoCircuit();
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
  const circuit = createDemoCircuit('en');
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

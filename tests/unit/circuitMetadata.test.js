import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDemoCircuit,
  createDemoTranscript,
  createRequirementDocument,
  createRequirementMarkdown,
  isLegalConnection
} from '../../src/circuitMetadata.js';

test('demo circuit metadata defines the locked Arduino OLED teaching circuit', () => {
  const circuit = createDemoCircuit();

  assert.equal(circuit.title, 'Arduino OLED 이름 표시');
  assert.equal(circuit.runText, 'RALPHTON BUSAN');

  const partTypes = new Set(circuit.parts.map((part) => part.type));
  for (const requiredType of ['breadboard', 'arduino', 'oled', 'sensor', 'motor']) {
    assert.ok(partTypes.has(requiredType), `expected demo library to include ${requiredType}`);
  }

  const arduino = circuit.parts.find((part) => part.type === 'arduino');
  const oled = circuit.parts.find((part) => part.type === 'oled');

  assert.deepEqual(
    arduino.pins.map((pin) => pin.name),
    ['5V', 'GND', 'A4/SDA', 'A5/SCL']
  );
  assert.deepEqual(
    oled.pins.map((pin) => pin.name),
    ['VCC', 'GND', 'SDA', 'SCL']
  );

  const labels = new Set(circuit.connections.map((connection) => connection.education.label));
  for (const label of ['5V POWER', 'GND', 'I2C SDA', 'I2C SCL']) {
    assert.ok(labels.has(label), `expected floating card label ${label}`);
  }

  for (const connection of circuit.connections) {
    assert.ok(connection.from.partId, 'connection includes source part');
    assert.ok(connection.to.partId, 'connection includes destination part');
    assert.ok(connection.education.what.length > 10, 'card explains what the wire is');
    assert.ok(connection.education.why.length > 10, 'card explains why the wire exists');
    assert.ok(connection.education.missing.length > 10, 'card explains what happens if missing');
  }
});

test('cached interview transcript supports the default no-network harness path', () => {
  const transcript = createDemoTranscript('show some text on a little screen');

  assert.equal(transcript[0].role, 'student');
  assert.equal(transcript[0].text, 'show some text on a little screen');
  assert.equal(transcript.at(-1).action, 'build-demo-circuit');
  assert.match(
    transcript.map((entry) => entry.text).join('\n'),
    /화면에는 행사 이름을 표시하면 될까요\?/
  );
});

test('demo circuit metadata marks only the OLED I2C wiring as legal', () => {
  const circuit = createDemoCircuit();

  assert.equal(circuit.connections.length, 4);

  for (const connection of circuit.connections) {
    assert.equal(
      isLegalConnection(circuit, connection.from, connection.to),
      true,
      `${connection.from.pin} should legally connect to ${connection.to.pin}`
    );
  }

  const legalPairs = new Set(
    circuit.connections.map((connection) => [
      `${connection.from.partId}:${connection.from.pin}`,
      `${connection.to.partId}:${connection.to.pin}`
    ].sort().join(' -> '))
  );
  const arduinoPins = circuit.parts.find((part) => part.id === 'arduino-uno').pins;
  const oledPins = circuit.parts.find((part) => part.id === 'oled-display').pins;

  for (const arduinoPin of arduinoPins) {
    for (const oledPin of oledPins) {
      const from = { partId: 'arduino-uno', pin: arduinoPin.name };
      const to = { partId: 'oled-display', pin: oledPin.name };
      const pairKey = [`${from.partId}:${from.pin}`, `${to.partId}:${to.pin}`].sort().join(' -> ');

      assert.equal(isLegalConnection(circuit, from, to), legalPairs.has(pairKey));
    }
  }

  const libraryOnlyPartIds = new Set(
    circuit.parts.filter((part) => part.libraryOnly).map((part) => part.id)
  );
  assert.equal(
    circuit.connections.some((connection) => (
      libraryOnlyPartIds.has(connection.from.partId) ||
      libraryOnlyPartIds.has(connection.to.partId)
    )),
    false
  );

  assert.equal(
    isLegalConnection(
      circuit,
      { partId: 'arduino-uno', pin: 'A4/SDA' },
      { partId: 'oled-display', pin: 'SCL' }
    ),
    false
  );
  assert.equal(
    isLegalConnection(
      circuit,
      { partId: 'arduino-uno', pin: '5V' },
      { partId: 'oled-display', pin: 'SDA' }
    ),
    false
  );
});

test('requirement document is plain-language and tied to the OLED demo text', () => {
  const circuit = createDemoCircuit();
  const document = createRequirementDocument(circuit);

  assert.equal(document.title, '회로 요구사항: Arduino OLED 이름 표시');
  assert.match(document.goal, /RALPHTON BUSAN/);
  assert.match(document.partsNeeded.join('\n'), /Arduino/i);
  assert.match(document.partsNeeded.join('\n'), /I2C OLED/i);
  assert.match(document.behavior, /실행을 누르면/);
  assert.ok(document.assumptions.every((assumption) => assumption.length > 12));
});

test('requirement markdown renders from the same demo document sections', () => {
  const markdown = createRequirementMarkdown(createDemoCircuit());

  assert.match(markdown, /^# 회로 요구사항: Arduino OLED 이름 표시/m);
  assert.match(markdown, /^_상태: 확정된 데모 요구사항_/m);
  assert.match(markdown, /^## 목표/m);
  assert.match(markdown, /^## 필요한 부품/m);
  assert.match(markdown, /^## 연결 방법/m);
  assert.match(markdown, /- \*\*I2C SDA\*\*/);
  assert.match(markdown, /RALPHTON BUSAN/);
});

test('demo requirement copy can still render in English for the language toggle', () => {
  const circuit = createDemoCircuit('en');
  const markdown = createRequirementMarkdown(circuit, 'en');

  assert.equal(circuit.title, 'Arduino OLED name display');
  assert.match(markdown, /^# Project Requirement: Arduino OLED name display/m);
  assert.match(markdown, /^_Status: Confirmed demo requirement_/m);
  assert.match(markdown, /^## Goal/m);
});

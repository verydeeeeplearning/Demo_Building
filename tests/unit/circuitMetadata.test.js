import assert from 'node:assert/strict';
import test from 'node:test';

import { isLegalConnection } from '../../src/circuitMetadata.js';

// Minimal inline fixture — the demo circuit data was removed in Phase 1.
const FIXTURE_CIRCUIT = {
  parts: [
    { id: 'arduino-uno', type: 'arduino', label: 'Arduino Uno', designator: 'U1', pins: [
      { name: '5V', role: 'power' },
      { name: 'GND', role: 'ground' },
      { name: 'A4/SDA', role: 'i2c-data' },
      { name: 'A5/SCL', role: 'i2c-clock' }
    ] },
    { id: 'oled-display', type: 'oled', label: '0.96 inch I2C OLED', designator: 'DISP1', pins: [
      { name: 'VCC', role: 'power' },
      { name: 'GND', role: 'ground' },
      { name: 'SDA', role: 'i2c-data' },
      { name: 'SCL', role: 'i2c-clock' }
    ] }
  ],
  connections: [
    { id: 'oled-power', from: { partId: 'arduino-uno', pin: '5V' }, to: { partId: 'oled-display', pin: 'VCC' }, signal: 'power', color: '#ff4d3d', education: { label: '5V POWER', title: '', what: '', why: '', missing: '' } },
    { id: 'oled-ground', from: { partId: 'arduino-uno', pin: 'GND' }, to: { partId: 'oled-display', pin: 'GND' }, signal: 'ground', color: '#20242a', education: { label: 'GND', title: '', what: '', why: '', missing: '' } },
    { id: 'oled-sda', from: { partId: 'arduino-uno', pin: 'A4/SDA' }, to: { partId: 'oled-display', pin: 'SDA' }, signal: 'i2c-data', color: '#2f7df6', education: { label: 'I2C SDA', title: '', what: '', why: '', missing: '' } },
    { id: 'oled-scl', from: { partId: 'arduino-uno', pin: 'A5/SCL' }, to: { partId: 'oled-display', pin: 'SCL' }, signal: 'i2c-clock', color: '#f6c44c', education: { label: 'I2C SCL', title: '', what: '', why: '', missing: '' } }
  ]
};

test('isLegalConnection accepts all defined connections in both directions', () => {
  for (const connection of FIXTURE_CIRCUIT.connections) {
    assert.ok(
      isLegalConnection(FIXTURE_CIRCUIT, connection.from, connection.to),
      `${connection.from.pin} → ${connection.to.pin} should be legal`
    );
    assert.ok(
      isLegalConnection(FIXTURE_CIRCUIT, connection.to, connection.from),
      `${connection.to.pin} → ${connection.from.pin} should be legal (reversed)`
    );
  }
});

test('isLegalConnection rejects cross-wired pairs', () => {
  assert.equal(
    isLegalConnection(
      FIXTURE_CIRCUIT,
      { partId: 'arduino-uno', pin: 'A4/SDA' },
      { partId: 'oled-display', pin: 'SCL' }
    ),
    false
  );
  assert.equal(
    isLegalConnection(
      FIXTURE_CIRCUIT,
      { partId: 'arduino-uno', pin: '5V' },
      { partId: 'oled-display', pin: 'SDA' }
    ),
    false
  );
});

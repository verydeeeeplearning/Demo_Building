import assert from 'node:assert/strict';
import test from 'node:test';

import { assessRequestScope } from '../../server/agent/requestScope.ts';
import { buildContextPacket } from '../../server/context/contextPacket.ts';

const unknownHardwareCases = [
  {
    id: 'tachyon-sensor-led',
    message: 'Use a tachyon sensor to turn on an LED.',
    token: 'tachyon'
  },
  {
    id: 'xyz123-sensor-oled',
    message: 'Use XYZ123 sensor to show value on OLED.',
    token: 'xyz123'
  },
  {
    id: 'foo123-driver-motor',
    message: 'Use a Foo123 driver to spin a DC motor.',
    token: 'foo123'
  },
  {
    id: 'unknown-shield-display',
    message: 'Use a Quanta shield to display Hello on an OLED.',
    token: 'quanta'
  },
  {
    id: 'model-before-known-sensor-category',
    message: 'Use an XYZ123 gas sensor to show value on OLED.',
    token: 'xyz123'
  },
  {
    id: 'unknown-pressure-sensor-model',
    message: 'Use a BME280 pressure sensor to show value on OLED.',
    token: 'bme280'
  },
  {
    id: 'unknown-rfid-sensor-model',
    message: 'Use a PN532 RFID sensor to show tag state on OLED.',
    token: 'pn532'
  }
];

for (const row of unknownHardwareCases) {
  test(`unknown explicit hardware blocks synthesis: ${row.id}`, async () => {
    const packet = await buildContextPacket({
      message: row.message,
      locale: 'en'
    });
    const scope = assessRequestScope(packet);
    const diagnostic = [
      ...packet.supportGaps,
      ...packet.unsupportedSignals,
      ...packet.intentHints.ambiguity,
      packet.contextCoverage.synthesisEligibility.reason
    ].join('\n').toLowerCase();

    assert.equal(packet.contextCoverage.synthesisEligibility.status, 'ineligible');
    assert.equal(packet.contextCoverage.sufficientFor.includes('valid_circuit_synthesis'), false);
    assert.equal(scope.route, 'clarify_requirements');
    assert.equal(scope.buildEligible, false);
    assert.match(diagnostic, new RegExp(row.token, 'i'));
  });
}

test('generic sensor wording stays clarifiable without creating a fake unknown part', async () => {
  const packet = await buildContextPacket({
    message: 'Use a sensor to turn on an LED.',
    locale: 'en'
  });
  const diagnostic = [
    ...packet.supportGaps,
    ...packet.unsupportedSignals,
    ...packet.intentHints.ambiguity
  ].join('\n').toLowerCase();

  assert.doesNotMatch(diagnostic, /unknown hardware.*sensor/i);
});

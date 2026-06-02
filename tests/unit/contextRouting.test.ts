import assert from 'node:assert/strict';
import test from 'node:test';

import { buildContextPacket } from '../../server/context/contextPacket.ts';
import {
  loadContextIndex,
  loadContextRoutingMap,
  resolveContextSourceId
} from '../../server/context/contextLayer.ts';

test('context index exposes hierarchical routing metadata and namespaced aliases', async () => {
  const index = await loadContextIndex();
  const allEntries = [
    ...index.memory,
    ...index.skills,
    ...index.references,
    ...index.data,
    ...index.routing
  ];

  for (const entry of allEntries) {
    assert.match(entry.level, /^L[0-4]$/, `${entry.id} has retrieval level`);
    assert.ok(entry.sourceId.includes(':'), `${entry.id} has namespaced source id`);
    assert.ok(entry.sourceType.length > 0, `${entry.id} has source type`);
    assert.ok(entry.tags.length > 0, `${entry.id} has retrieval tags`);
    assert.ok(entry.provides.length > 0, `${entry.id} declares provided artifact types`);
    assert.ok(entry.loadWhen.length > 0, `${entry.id} declares load conditions`);
    assert.equal(typeof entry.canonical, 'boolean', `${entry.id} declares canonical status`);
    assert.ok(['minimal', 'summary', 'data-only', 'full'].includes(entry.budget), `${entry.id} has budget class`);
  }

  assert.equal(resolveContextSourceId('policy:safety', index)?.id, 'safety-policy');
  assert.equal(resolveContextSourceId('simulation:primitives', index)?.id, 'simulation-primitives');
  assert.equal(resolveContextSourceId('rendering:render-footprint:oled', index)?.id, 'render-footprints');
  assert.equal(resolveContextSourceId('data:capability-graph:display-text-output', index)?.id, 'capability-graph');
});

test('routing map references only resolvable context source ids', async () => {
  const [index, routingMap] = await Promise.all([
    loadContextIndex(),
    loadContextRoutingMap()
  ]);

  for (const route of routingMap.routes) {
    assert.ok(route.routeId.length > 0);
    assert.ok(route.budget in routingMap.maxPromptCharsByBudget);
    for (const sourceId of Object.values(route.load).flat()) {
      assert.ok(resolveContextSourceId(sourceId, index), `${route.routeId} missing source ${sourceId}`);
    }
  }
});

test('v2 route source ids prefer bundle loading units over broad heavy catalogs', async () => {
  const packet = await buildContextPacket({
    message: 'LED를 깜빡이는 회로를 만들어줘',
    locale: 'ko'
  });

  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:digital-light-output'));
  assert.equal(packet.retrievalPlan.sourceIds.includes('simulation:primitives'), false);
  assert.equal(packet.retrievalPlan.sourceIds.includes('rendering:render-footprints'), false);
  assert.ok(!packet.promptBlock.includes('"currentPathRecipe"'), 'v2 prompt should avoid full primitive recipe payload');
});

test('button LED requests route to bounded switch, validation, render, and simulation context', async () => {
  const packet = await buildContextPacket({
    message: 'When I press a button, turn on an LED safely.',
    locale: 'en'
  });

  assert.equal(packet.contextRoute.routeId, 'v2-button-controlled-light-output');
  assert.ok(packet.contextRoute.capabilityIds.includes('button-controlled-light-output'));
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:button-controlled-light-output'));
  assert.ok(packet.retrievalPlan.sourceIds.includes('registry:part-capabilities'));
  assert.ok(packet.retrievalPlan.sourceIds.includes('simulation:primitives'));
  assert.ok(packet.retrievalPlan.sourceIds.includes('rendering:render-footprints'));
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'data:capability-graph:button-controlled-light-output'));
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'data:simulation-primitives:digital_on_off'));
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'bundle:button-controlled-light-output'));
  assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
});

test('Korean button LED buzzer requests keep button, light, and sound context together', async () => {
  const packet = await buildContextPacket({
    message: '버튼을 누르면 LED가 켜지고 부저가 울리는 회로를 만들고 싶어',
    locale: 'ko'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);

  assert.equal(packet.contextRoute.routeId, 'v2-button-light-sound-output');
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:button-controlled-light-output'));
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:sound-alert-output'));
  assert.ok(capabilityIds.includes('button-controlled-light-output'), capabilityIds.join(', '));
  assert.ok(capabilityIds.includes('sound-alert-output'), capabilityIds.join(', '));
  assert.ok(packet.intentHints.inputModalities.includes('button'));
  assert.ok(packet.intentHints.outputModalities.includes('light'));
  assert.ok(packet.intentHints.outputModalities.includes('sound'));
  for (const partId of ['arduino-uno', 'breadboard-half', 'button-tactile', 'led-5mm', 'resistor-220', 'piezo-buzzer']) {
    assert.ok(candidatePartIds.includes(partId), `${partId} should be included; got ${candidatePartIds.join(', ')}`);
  }
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
});

test('Korean potentiometer LED dimmer routes to supported analog dimmer context', async () => {
  const packet = await buildContextPacket({
    message: '가변저항으로 LED 밝기를 조절하고 싶어',
    locale: 'ko'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);

  assert.equal(packet.contextRoute.routeId, 'v2-analog-led-dimmer');
  assert.ok(capabilityIds.includes('analog-led-dimmer'), capabilityIds.join(', '));
  assert.ok(packet.intentHints.inputModalities.includes('analog'));
  assert.ok(packet.intentHints.inputModalities.includes('potentiometer'));
  assert.ok(packet.intentHints.outputModalities.includes('light'));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.equal(packet.supportGaps.some((gap) => /analog-led-dimmer/i.test(gap)), false, packet.supportGaps.join(' | '));
});

test('trimmer potentiometer LED dimmer routes to analog dimmer context with trimmer candidate', async () => {
  const packet = await buildContextPacket({
    message: 'Use a trimmer potentiometer to control LED brightness.',
    locale: 'en'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);
  const footprintTypes = packet.renderFootprints.map((footprint) => footprint.type);

  assert.equal(packet.contextRoute.routeId, 'v2-analog-led-dimmer');
  assert.ok(capabilityIds.includes('analog-led-dimmer'), capabilityIds.join(', '));
  assert.ok(candidatePartIds.includes('trimmer-pot'), candidatePartIds.join(', '));
  assert.equal(candidatePartIds.includes('potentiometer-10k'), false, candidatePartIds.join(', '));
  assert.ok(footprintTypes.includes('trimmer-pot'), footprintTypes.join(', '));
  assert.ok(packet.intentHints.inputModalities.includes('potentiometer'));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
});

test('low-voltage power rail requests route to power bundle with explicit source candidates', async () => {
  for (const { message, expectedPartIds } of [
    {
      message: 'Use a breadboard power supply module to energize the 5V and ground rails on a breadboard.',
      expectedPartIds: ['breadboard-half', 'breadboard-psu']
    },
    {
      message: 'Use a 9V battery clip and 7805 regulator to make a regulated 5V breadboard power rail.',
      expectedPartIds: ['breadboard-half', '9v-battery-clip', '7805-regulator']
    }
  ]) {
    const packet = await buildContextPacket({ message, locale: 'en' });
    const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
    const candidatePartIds = packet.candidateParts.map((part) => part.id);
    const footprintTypes = packet.renderFootprints.map((footprint) => footprint.type);

    assert.equal(packet.contextRoute.routeId, 'v2-low-voltage-power-rail');
    assert.ok(capabilityIds.includes('low-voltage-power-rail'), capabilityIds.join(', '));
    for (const partId of expectedPartIds) {
      assert.ok(candidatePartIds.includes(partId), `${partId}; got ${candidatePartIds.join(', ')}`);
    }
    assert.ok(footprintTypes.includes('breadboard-psu') || footprintTypes.includes('7805-regulator'));
    assert.equal(packet.contextCoverage.status, 'sufficient');
    assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
    assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
  }
});

test('Korean trimmer potentiometer wording preserves trimmer candidate', async () => {
  const packet = await buildContextPacket({
    message: '트리머 가변저항으로 LED 밝기를 조절하고 싶어',
    locale: 'ko'
  });
  const candidatePartIds = packet.candidateParts.map((part) => part.id);

  assert.equal(packet.contextRoute.routeId, 'v2-analog-led-dimmer');
  assert.ok(candidatePartIds.includes('trimmer-pot'), candidatePartIds.join(', '));
  assert.equal(candidatePartIds.includes('potentiometer-10k'), false, candidatePartIds.join(', '));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
});

test('WP-09 prototyping and connector context routes avoid broad power or output overmatches', async () => {
  for (const { message, routeId, capabilityId, bundleId, partId, forbiddenCapabilityIds } of [
    {
      message: 'Show this circuit on a mini breadboard prototyping surface.',
      routeId: 'v2-prototyping-surface-context',
      capabilityId: 'prototyping-surface-context',
      bundleId: 'bundle:prototyping-surface-context',
      partId: 'breadboard-mini',
      forbiddenCapabilityIds: ['digital-light-output', 'button-controlled-light-output', 'low-voltage-power-rail']
    },
    {
      message: 'Place a 4 pin screw terminal block as low-voltage connector context.',
      routeId: 'v2-connector-wiring-context',
      capabilityId: 'connector-wiring-context',
      bundleId: 'bundle:connector-wiring-context',
      partId: 'screw-terminal-4pin',
      forbiddenCapabilityIds: ['digital-light-output', 'button-controlled-light-output', 'low-voltage-power-rail']
    }
  ]) {
    const packet = await buildContextPacket({ message, locale: 'en' });
    const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
    const candidatePartIds = packet.candidateParts.map((part) => part.id);

    assert.equal(packet.contextRoute.routeId, routeId);
    assert.ok(capabilityIds.includes(capabilityId), capabilityIds.join(', '));
    assert.ok(candidatePartIds.includes(partId), candidatePartIds.join(', '));
    assert.ok(packet.retrievalPlan.sourceIds.includes(bundleId));
    for (const forbiddenCapabilityId of forbiddenCapabilityIds) {
      assert.equal(capabilityIds.includes(forbiddenCapabilityId), false, capabilityIds.join(', '));
    }
    assert.equal(packet.contextCoverage.status, 'sufficient');
    assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
    assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
  }
});

test('photoresistor dark-room LED routes to supported light sensor context before generic LED output', async () => {
  const packet = await buildContextPacket({
    message: 'Turn on an LED when a photoresistor says the room is dark.',
    locale: 'en'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);

  assert.equal(packet.contextRoute.routeId, 'v2-light-sensor-triggered-output');
  assert.ok(capabilityIds.includes('light-sensor-triggered-output'), capabilityIds.join(', '));
  assert.ok(candidatePartIds.includes('photoresistor-ldr'), candidatePartIds.join(', '));
  assert.ok(packet.intentHints.inputModalities.includes('light-sensor'));
  assert.ok(packet.intentHints.outputModalities.includes('light'));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
});

test('generic light sensor darkness requests keep the concrete LDR candidate', async () => {
  const packet = await buildContextPacket({
    message: 'Use a light sensor to turn on an LED when the room is dark.',
    locale: 'en'
  });
  const candidatePartIds = packet.candidateParts.map((part) => part.id);

  assert.equal(packet.contextRoute.routeId, 'v2-light-sensor-triggered-output');
  assert.ok(candidatePartIds.includes('photoresistor-ldr'), candidatePartIds.join(', '));
  assert.equal(candidatePartIds.includes('led-5mm'), true);
  assert.ok(packet.intentHints.inputModalities.includes('light-sensor'));
  assert.ok(packet.intentHints.outputModalities.includes('light'));
});

test('button buzzer requests do not pull LED bundles unless light is explicit', async () => {
  const buzzerOnly = await buildContextPacket({
    message: 'Press a button to make a buzzer beep.',
    locale: 'en'
  });
  const buzzerOnlyPartIds = buzzerOnly.candidateParts.map((part) => part.id);

  assert.equal(buzzerOnly.contextRoute.routeId, 'v2-sound-alert-output');
  assert.equal(buzzerOnlyPartIds.includes('led-5mm'), false, buzzerOnlyPartIds.join(', '));
  assert.equal(buzzerOnlyPartIds.includes('resistor-220'), false, buzzerOnlyPartIds.join(', '));
  assert.equal(buzzerOnly.contextCoverage.synthesisEligibility.status, 'ineligible');
  assert.match(buzzerOnly.supportGaps.join('\n'), /button-tactile.*selected context bundle/i);

  const lightAndSound = await buildContextPacket({
    message: 'Press a button to turn on an LED and make a buzzer beep.',
    locale: 'en'
  });
  const lightAndSoundPartIds = lightAndSound.candidateParts.map((part) => part.id);

  assert.equal(lightAndSound.contextRoute.routeId, 'v2-button-light-sound-output');
  assert.ok(lightAndSoundPartIds.includes('led-5mm'), lightAndSoundPartIds.join(', '));
  assert.ok(lightAndSoundPartIds.includes('button-tactile'), lightAndSoundPartIds.join(', '));
  assert.ok(lightAndSoundPartIds.includes('piezo-buzzer'), lightAndSoundPartIds.join(', '));
  assert.equal(lightAndSound.contextCoverage.synthesisEligibility.status, 'eligible');
});

test('DHT11 temperature humidity display routes to supported single-wire sensor display context', async () => {
  const packet = await buildContextPacket({
    message: 'Show temperature and humidity from a DHT11 on the OLED display.',
    locale: 'en'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);

  assert.equal(packet.contextRoute.routeId, 'v2-dht11-temperature-humidity-display');
  assert.ok(capabilityIds.includes('dht11-temperature-humidity-display'), capabilityIds.join(', '));
  assert.ok(candidatePartIds.includes('dht11'), candidatePartIds.join(', '));
  assert.ok(packet.intentHints.inputModalities.includes('temperature-humidity-sensor'));
  assert.ok(packet.intentHints.outputModalities.includes('display'));
  assert.equal(packet.intentHints.outputModalities.includes('light'), false);
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.equal(packet.supportGaps.some((gap) => /dht11/i.test(gap)), false, packet.supportGaps.join(' | '));
});

test('mixed explicit sensor and display prompts do not silently drop uncovered hardware', async () => {
  const sevenSegment = await buildContextPacket({
    message: 'DHT11 temperature and humidity on a single digit seven segment display.',
    locale: 'en'
  });
  const sevenSegmentPartIds = sevenSegment.candidateParts.map((part) => part.id);

  assert.equal(sevenSegment.contextRoute.routeId, 'v2-bare-seven-segment-display-output');
  assert.equal(sevenSegment.capabilityMatches.some((capability) => capability.id === 'led-array-display-output'), false);
  assert.ok(sevenSegmentPartIds.includes('7seg-1digit'), sevenSegmentPartIds.join(', '));
  assert.equal(sevenSegmentPartIds.includes('dht11'), false, sevenSegmentPartIds.join(', '));
  assert.equal(sevenSegment.contextCoverage.synthesisEligibility.status, 'ineligible');
  assert.match(sevenSegment.supportGaps.join('\n'), /dht11.*selected context bundle/i);

  const neopixel = await buildContextPacket({
    message: 'DHT11 temperature and humidity on a NeoPixel ring.',
    locale: 'en'
  });
  const neopixelPartIds = neopixel.candidateParts.map((part) => part.id);

  assert.equal(neopixel.contextRoute.routeId, 'v2-addressable-led-display-output');
  assert.ok(neopixelPartIds.includes('neopixel-ring-12'), neopixelPartIds.join(', '));
  assert.equal(neopixelPartIds.includes('dht11'), false, neopixelPartIds.join(', '));
  assert.equal(neopixel.contextCoverage.synthesisEligibility.status, 'ineligible');
  assert.match(neopixel.supportGaps.join('\n'), /dht11.*selected context bundle/i);
});

test('generic temperature humidity display asks for a specific sensor instead of assuming DHT11', async () => {
  const packet = await buildContextPacket({
    message: 'Show temperature and humidity on the OLED display.',
    locale: 'en'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);

  assert.equal(packet.contextRoute.routeId, 'v2-ambiguous-minimal');
  assert.equal(capabilityIds.includes('dht11-temperature-humidity-display'), false, capabilityIds.join(', '));
  assert.equal(candidatePartIds.includes('dht11'), false, candidatePartIds.join(', '));
  assert.ok(packet.intentHints.ambiguity.some((item) => /specific supported sensor|DHT11/i.test(item)));
  assert.equal(packet.contextCoverage.status, 'insufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'ineligible');
});

test('DHT22 display routes to its own supported single-wire sensor display context', async () => {
  const packet = await buildContextPacket({
    message: 'Show temperature and humidity from a DHT22 on the OLED display.',
    locale: 'en'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);

  assert.equal(packet.contextRoute.routeId, 'v2-dht22-temperature-humidity-display');
  assert.ok(capabilityIds.includes('dht22-temperature-humidity-display'), capabilityIds.join(', '));
  assert.equal(capabilityIds.includes('dht11-temperature-humidity-display'), false, capabilityIds.join(', '));
  assert.ok(candidatePartIds.includes('dht22'), candidatePartIds.join(', '));
  assert.equal(candidatePartIds.includes('dht11'), false, candidatePartIds.join(', '));
  assert.equal(packet.supportGaps.some((gap) => /dht22/i.test(gap)), false, packet.supportGaps.join(' | '));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
});

test('WP-10 protocol sensor displays route through protocol-specific supported bundles', async () => {
  for (const { message, routeId, capabilityId, partId } of [
    {
      message: 'Show BMP280 pressure sensor value on the OLED display.',
      routeId: 'v2-i2c-sensor-display-readout',
      capabilityId: 'i2c-sensor-display-readout',
      partId: 'bmp280'
    },
    {
      message: 'Show MAX30102 pulse sensor signal on the OLED display.',
      routeId: 'v2-i2c-sensor-display-readout',
      capabilityId: 'i2c-sensor-display-readout',
      partId: 'max30102-pulse'
    },
    {
      message: 'Show HX711 load cell reading on the OLED display.',
      routeId: 'v2-clocked-data-sensor-display-readout',
      capabilityId: 'clocked-data-sensor-display-readout',
      partId: 'hx711-loadcell'
    },
    {
      message: 'Show RC522 RFID tag read state on the OLED display.',
      routeId: 'v2-spi-sensor-display-readout',
      capabilityId: 'spi-sensor-display-readout',
      partId: 'rc522-rfid'
    },
    {
      message: 'Show NEO-6M GPS coordinate value on the OLED display.',
      routeId: 'v2-uart-sensor-display-readout',
      capabilityId: 'uart-sensor-display-readout',
      partId: 'gps-neo6m'
    }
  ]) {
    const packet = await buildContextPacket({ message, locale: 'en' });
    const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
    const candidatePartIds = packet.candidateParts.map((part) => part.id);

    assert.equal(packet.contextRoute.routeId, routeId, message);
    assert.deepEqual(capabilityIds, [capabilityId], `${message}: ${capabilityIds.join(', ')}`);
    assert.ok(candidatePartIds.includes(partId), `${message}: ${candidatePartIds.join(', ')}`);
    assert.ok(candidatePartIds.includes('oled-i2c-096'), `${message}: ${candidatePartIds.join(', ')}`);
    assert.equal(packet.contextCoverage.status, 'sufficient', message);
    assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible', message);
    assert.equal(packet.supportGaps.length, 0, `${message}: ${packet.supportGaps.join(' | ')}`);
  }
});

test('FSR pressure display routes to supported resistive divider readout context', async () => {
  const packet = await buildContextPacket({
    message: 'Show FSR pressure sensor value on the OLED display.',
    locale: 'en'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);

  assert.equal(packet.contextRoute.routeId, 'v2-analog-sensor-display-readout');
  assert.ok(capabilityIds.includes('analog-sensor-display-readout'), capabilityIds.join(', '));
  assert.ok(candidatePartIds.includes('fsr-pressure'), candidatePartIds.join(', '));
  assert.ok(candidatePartIds.includes('resistor-10k'), candidatePartIds.join(', '));
  assert.ok(packet.intentHints.inputModalities.includes('analog-sensor'));
  assert.ok(packet.intentHints.outputModalities.includes('display'));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
});

test('thermistor threshold output routes to supported resistive divider threshold context', async () => {
  const packet = await buildContextPacket({
    message: 'Turn on an LED when the NTC thermistor value crosses a threshold.',
    locale: 'en'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);

  assert.equal(packet.contextRoute.routeId, 'v2-analog-sensor-threshold-output');
  assert.ok(capabilityIds.includes('analog-sensor-threshold-output'), capabilityIds.join(', '));
  assert.ok(candidatePartIds.includes('thermistor-ntc'), candidatePartIds.join(', '));
  assert.ok(candidatePartIds.includes('resistor-10k'), candidatePartIds.join(', '));
  assert.ok(candidatePartIds.includes('led-5mm'), candidatePartIds.join(', '));
  assert.ok(packet.intentHints.inputModalities.includes('analog-sensor'));
  assert.ok(packet.intentHints.outputModalities.includes('threshold'));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
});

test('PIR motion display routes to supported digital input display context', async () => {
  const packet = await buildContextPacket({
    message: 'Show PIR motion sensor state on the OLED display.',
    locale: 'en'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);

  assert.equal(packet.contextRoute.routeId, 'v2-digital-input-display-readout');
  assert.ok(capabilityIds.includes('digital-input-display-readout'), capabilityIds.join(', '));
  assert.ok(candidatePartIds.includes('pir-hc-sr501'), candidatePartIds.join(', '));
  assert.ok(candidatePartIds.includes('oled-i2c-096'), candidatePartIds.join(', '));
  assert.ok(packet.intentHints.inputModalities.includes('digital-sensor'));
  assert.ok(packet.intentHints.outputModalities.includes('display'));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
});

test('limit switch LED requests do not collapse into the generic button route', async () => {
  const packet = await buildContextPacket({
    message: 'Use a limit switch to turn on an LED safely.',
    locale: 'en'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);

  assert.equal(packet.contextRoute.routeId, 'v2-digital-input-threshold-output');
  assert.ok(capabilityIds.includes('digital-input-threshold-output'), capabilityIds.join(', '));
  assert.ok(candidatePartIds.includes('limit-switch'), candidatePartIds.join(', '));
  assert.equal(candidatePartIds.includes('button-tactile'), false, candidatePartIds.join(', '));
  assert.ok(candidatePartIds.includes('led-5mm'), candidatePartIds.join(', '));
  assert.ok(packet.intentHints.inputModalities.includes('digital-input'));
  assert.ok(packet.intentHints.outputModalities.includes('light'));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
});

test('TCS3200 display routes through pulse-aware digital input context', async () => {
  const packet = await buildContextPacket({
    message: 'Show the TCS3200 color sensor pulse reading on the OLED display.',
    locale: 'en'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);

  assert.equal(packet.contextRoute.routeId, 'v2-digital-input-display-readout');
  assert.ok(capabilityIds.includes('digital-input-display-readout'), capabilityIds.join(', '));
  assert.ok(candidatePartIds.includes('tcs3200-color'), candidatePartIds.join(', '));
  assert.ok(packet.intentHints.protocols.includes('digital-pulse'));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
});

test('matrix input display requests route through matrix input context', async () => {
  const packet = await buildContextPacket({
    message: 'Show the pressed 4x4 keypad key on the OLED display.',
    locale: 'en'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);

  assert.equal(packet.contextRoute.routeId, 'v2-matrix-input-display-readout');
  assert.ok(capabilityIds.includes('matrix-input-display-readout'), capabilityIds.join(', '));
  assert.ok(candidatePartIds.includes('keypad-4x4'), candidatePartIds.join(', '));
  assert.ok(packet.intentHints.inputModalities.includes('matrix-input'));
  assert.ok(packet.intentHints.outputModalities.includes('display'));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
});

test('joystick display requests route through dual analog joystick context', async () => {
  const packet = await buildContextPacket({
    message: 'Show joystick X and Y position on the OLED display.',
    locale: 'en'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);

  assert.equal(packet.contextRoute.routeId, 'v2-joystick-display-readout');
  assert.ok(capabilityIds.includes('joystick-display-readout'), capabilityIds.join(', '));
  assert.ok(candidatePartIds.includes('joystick-module'), candidatePartIds.join(', '));
  assert.ok(packet.intentHints.inputModalities.includes('joystick'));
  assert.ok(packet.intentHints.outputModalities.includes('display'));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
});

test('rotary encoder display requests route through quadrature encoder context', async () => {
  const packet = await buildContextPacket({
    message: 'Show rotary encoder count on the OLED display.',
    locale: 'en'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);

  assert.equal(packet.contextRoute.routeId, 'v2-rotary-encoder-display-readout');
  assert.ok(capabilityIds.includes('rotary-encoder-display-readout'), capabilityIds.join(', '));
  assert.ok(candidatePartIds.includes('rotary-encoder'), candidatePartIds.join(', '));
  assert.ok(packet.intentHints.inputModalities.includes('rotary-encoder'));
  assert.ok(packet.intentHints.outputModalities.includes('display'));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
});

test('Korean servo requests route to PWM actuator context', async () => {
  const packet = await buildContextPacket({
    message: '서보모터를 90도로 움직이는 회로를 만들고 싶어',
    locale: 'ko'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);

  assert.equal(packet.contextRoute.routeId, 'v2-servo-motion-output');
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:servo-motion-output'));
  assert.ok(capabilityIds.includes('servo-motion-output'), capabilityIds.join(', '));
  assert.ok(packet.intentHints.outputModalities.includes('motion'));
  assert.ok(candidatePartIds.includes('micro-servo'), candidatePartIds.join(', '));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
});

test('explicit MG996R servo requests preserve the high-torque servo candidate', async () => {
  const packet = await buildContextPacket({
    message: 'MG996R 고토크 서보를 90도로 움직이는 회로를 만들어줘',
    locale: 'ko'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);
  const footprintTypes = packet.renderFootprints.map((footprint) => footprint.type);

  assert.equal(packet.contextRoute.routeId, 'v2-servo-motion-output');
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:servo-motion-output'));
  assert.ok(capabilityIds.includes('servo-motion-output'), capabilityIds.join(', '));
  assert.ok(candidatePartIds.includes('mg996r-servo'), candidatePartIds.join(', '));
  assert.equal(candidatePartIds.includes('micro-servo'), false, candidatePartIds.join(', '));
  assert.ok(footprintTypes.includes('large-servo'), footprintTypes.join(', '));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
});

test('DC motor MOSFET requests route to low-side switched load context', async () => {
  const packet = await buildContextPacket({
    message: 'Use Arduino and an IRF520 MOSFET module to run a small DC motor safely.',
    locale: 'en'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);
  const footprintTypes = packet.renderFootprints.map((footprint) => footprint.type);

  assert.equal(packet.contextRoute.routeId, 'v2-low-side-switched-load-output');
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:low-side-switched-load-output'));
  assert.ok(capabilityIds.includes('low-side-switched-load-output'), capabilityIds.join(', '));
  for (const partId of ['arduino-uno', 'breadboard-half', 'irf520-mosfet', 'dc-motor-130']) {
    assert.ok(candidatePartIds.includes(partId), `${partId} should be included; got ${candidatePartIds.join(', ')}`);
  }
  assert.ok(footprintTypes.includes('mosfet-module'), footprintTypes.join(', '));
  assert.ok(footprintTypes.includes('dc-motor'), footprintTypes.join(', '));
  assert.ok(packet.intentHints.outputModalities.includes('switched-load'));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
});

test('stepper requests route to stepper driver context without low-side overmatch', async () => {
  const packet = await buildContextPacket({
    message: 'Use Arduino with a ULN2003 driver to rotate a 28BYJ-48 stepper motor.',
    locale: 'en'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);
  const footprintTypes = packet.renderFootprints.map((footprint) => footprint.type);

  assert.equal(packet.contextRoute.routeId, 'v2-stepper-motor-output');
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:stepper-motor-output'));
  assert.ok(capabilityIds.includes('stepper-motor-output'), capabilityIds.join(', '));
  assert.equal(capabilityIds.includes('low-side-switched-load-output'), false, capabilityIds.join(', '));
  for (const partId of ['arduino-uno', 'breadboard-half', 'uln2003-driver', 'stepper-28byj48']) {
    assert.ok(candidatePartIds.includes(partId), `${partId} should be included; got ${candidatePartIds.join(', ')}`);
  }
  assert.ok(footprintTypes.includes('uln2003-stepper-driver'), footprintTypes.join(', '));
  assert.ok(footprintTypes.includes('unipolar-stepper'), footprintTypes.join(', '));
  assert.ok(packet.intentHints.outputModalities.includes('stepper-motion'));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
});

test('H-bridge motor requests route to H-bridge context without low-side overmatch', async () => {
  const packet = await buildContextPacket({
    message: 'Use an L298N H-bridge driver to run a DC motor forward and reverse from Arduino.',
    locale: 'en'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);
  const footprintTypes = packet.renderFootprints.map((footprint) => footprint.type);

  assert.equal(packet.contextRoute.routeId, 'v2-hbridge-motor-output');
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:hbridge-motor-output'));
  assert.ok(capabilityIds.includes('hbridge-motor-output'), capabilityIds.join(', '));
  assert.equal(capabilityIds.includes('low-side-switched-load-output'), false, capabilityIds.join(', '));
  for (const partId of ['arduino-uno', 'breadboard-half', 'l298n-driver', 'dc-motor-130']) {
    assert.ok(candidatePartIds.includes(partId), `${partId} should be included; got ${candidatePartIds.join(', ')}`);
  }
  assert.ok(footprintTypes.includes('hbridge-driver-module'), footprintTypes.join(', '));
  assert.ok(footprintTypes.includes('dc-motor'), footprintTypes.join(', '));
  assert.ok(packet.intentHints.outputModalities.includes('hbridge-motor'));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
});

test('relay low-voltage requests route to relay context and keep mains blocked separately', async () => {
  const packet = await buildContextPacket({
    message: 'Use a 1-channel relay module to switch a low-voltage LED load from Arduino.',
    locale: 'en'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
  const candidatePartIds = packet.candidateParts.map((part) => part.id);
  const footprintTypes = packet.renderFootprints.map((footprint) => footprint.type);

  assert.equal(packet.contextRoute.routeId, 'v2-relay-low-voltage-output');
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:relay-low-voltage-output'));
  assert.ok(capabilityIds.includes('relay-low-voltage-output'), capabilityIds.join(', '));
  assert.equal(capabilityIds.includes('low-side-switched-load-output'), false, capabilityIds.join(', '));
  for (const partId of ['arduino-uno', 'breadboard-half', 'relay-1ch', 'led-5mm', 'resistor-220']) {
    assert.ok(candidatePartIds.includes(partId), `${partId} should be included; got ${candidatePartIds.join(', ')}`);
  }
  assert.ok(footprintTypes.includes('relay-module-1ch'), footprintTypes.join(', '));
  assert.ok(packet.intentHints.outputModalities.includes('relay-output'));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
});

test('mains AC motor requests stay on unsupported safety route despite MOSFET wording', async () => {
  const packet = await buildContextPacket({
    message: 'Run a 220V AC motor from Arduino with a MOSFET.',
    locale: 'en'
  });
  const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);

  assert.equal(packet.contextRoute.routeId, 'unsupported-safety');
  assert.ok(capabilityIds.includes('high-voltage-load-control'), capabilityIds.join(', '));
  assert.equal(capabilityIds.includes('low-side-switched-load-output'), false, capabilityIds.join(', '));
  assert.equal(packet.retrievalPlan.sourceIds.includes('bundle:low-side-switched-load-output'), false);
  assert.equal(packet.retrievalPlan.sourceIds.includes('registry:part-capabilities'), false);
  assert.equal(packet.retrievalPlan.sourceIds.includes('simulation:primitives'), false);
  assert.equal(packet.retrievalPlan.sourceIds.includes('rendering:render-footprints'), false);
  assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
});

test('passive protection and timing requests route to state-only context bundles', async () => {
  for (const { message, routeId, capabilityId, bundleId, expectedPartId } of [
    {
      message: 'Show a 1N4007 diode and ceramic capacitor as low-voltage protection context on a breadboard.',
      routeId: 'v2-passive-protection-context',
      capabilityId: 'passive-protection-context',
      bundleId: 'bundle:passive-protection-context',
      expectedPartId: 'diode-1n4007'
    },
    {
      message: 'Add a zener diode clamp as low-voltage input protection.',
      routeId: 'v2-passive-protection-context',
      capabilityId: 'passive-protection-context',
      bundleId: 'bundle:passive-protection-context',
      expectedPartId: 'zener-diode'
    },
    {
      message: 'Show a 16 MHz crystal clock reference on the breadboard.',
      routeId: 'v2-timing-passive-context',
      capabilityId: 'timing-passive-context',
      bundleId: 'bundle:timing-passive-context',
      expectedPartId: 'crystal-16mhz'
    },
    {
      message: 'Show a 16MHz crystal clock reference on the breadboard.',
      routeId: 'v2-timing-passive-context',
      capabilityId: 'timing-passive-context',
      bundleId: 'bundle:timing-passive-context',
      expectedPartId: 'crystal-16mhz'
    }
  ]) {
    const packet = await buildContextPacket({ message, locale: 'en' });
    const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
    const candidatePartIds = packet.candidateParts.map((part) => part.id);

    assert.equal(packet.contextRoute.routeId, routeId);
    assert.ok(packet.retrievalPlan.sourceIds.includes(bundleId));
    assert.ok(capabilityIds.includes(capabilityId), capabilityIds.join(', '));
    assert.ok(candidatePartIds.includes(expectedPartId), candidatePartIds.join(', '));
    assert.equal(packet.contextCoverage.status, 'sufficient');
    assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
    assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
  }
});

test('screen visualization wording stays on minimal clarification route and avoids display over-fetch', async () => {
  const packet = await buildContextPacket({
    message: 'I want to see current flow on the screen.',
    locale: 'en'
  });

  assert.equal(packet.contextRoute.routeId, 'v2-ambiguous-minimal');
  assert.equal(packet.capabilityMatches.some((capability) => capability.id === 'display-text-output'), false);
  assert.equal(packet.retrievalPlan.sourceIds.includes('registry:part-capabilities'), false);
  assert.equal(packet.retrievalPlan.sourceIds.includes('simulation:primitives'), false);
  assert.equal(packet.retrievalPlan.sourceIds.includes('rendering:render-footprints'), false);
  assert.ok(packet.retrievalPlan.omittedSourceIds.includes('registry:part-capabilities'));
  assert.ok(packet.retrievalPlan.omittedSourceIds.includes('simulation:primitives'));
  assert.ok(packet.retrievalPlan.omittedSourceIds.includes('rendering:render-footprints'));
  assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
});

test('unsupported routes stay policy-first and do not load render or simulation catalogs', async () => {
  const packet = await buildContextPacket({
    message: 'Use the breadboard to switch a 220V wall outlet heater.',
    locale: 'en'
  });

  assert.equal(packet.contextRoute.routeId, 'unsupported-safety');
  assert.ok(packet.contextRoute.capabilityIds.includes('high-voltage-load-control'));
  assert.ok(packet.retrievalPlan.sourceIds.includes('policy:safety-policy'));
  assert.ok(packet.retrievalPlan.sourceIds.includes('policy:unsupported-request-policy'));
  assert.equal(packet.retrievalPlan.sourceIds.includes('registry:part-capabilities'), false);
  assert.equal(packet.retrievalPlan.sourceIds.includes('simulation:primitives'), false);
  assert.equal(packet.retrievalPlan.sourceIds.includes('rendering:render-footprints'), false);
  assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
});

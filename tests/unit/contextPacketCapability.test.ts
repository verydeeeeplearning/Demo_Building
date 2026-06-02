import assert from 'node:assert/strict';
import test from 'node:test';

import { buildContextPacket } from '../../server/context/contextPacket.ts';

test('context packet includes capability graph evidence for generalized hardware requests', async () => {
  const packet = await buildContextPacket({
    message: 'Show HELLO on a small OLED screen and visualize current flow.',
    locale: 'en'
  });

  assert.ok(packet.capabilityMatches.some((capability) => capability.id === 'display-text-output'));
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'data:capability-graph:display-text-output'));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.score, 1);
  assert.deepEqual(packet.contextCoverage.missingSourceTypes, []);
  assert.ok(packet.contextCoverage.requiredSourceTypes.includes('data'));
  assert.ok(packet.contextCoverage.requiredSourceTypes.includes('policy'));
  assert.equal(packet.contextCoverage.requiredSourceTypes.includes('rendering'), false);
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:display-text-output'));
  assert.match(packet.promptBlock, /Capability graph matches/i);
  assert.match(packet.promptBlock, /Context coverage/i);
  assert.match(packet.promptBlock, /display-text-output/);
});

test('context packet swaps the default OLED for an explicitly requested I2C LCD display', async () => {
  const packet = await buildContextPacket({
    message: 'Show HELLO on a 16x2 LCD display.',
    locale: 'en'
  });
  const candidateIds = packet.candidateParts.map((part) => part.id);
  const lcd = packet.candidateParts.find((part) => part.id === 'lcd-16x2');

  assert.equal(packet.contextRoute.routeId, 'v2-display-text-output');
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.ok(candidateIds.includes('lcd-16x2'), candidateIds.join(', '));
  assert.equal(candidateIds.includes('oled-i2c-096'), false, candidateIds.join(', '));
  assert.equal(lcd?.renderFootprint.type, 'lcd-character-16x2');
});

test('context packet keeps sensor readout routing while replacing OLED with a requested LCD', async () => {
  const packet = await buildContextPacket({
    message: 'Show DHT11 temperature and humidity on a 20x4 LCD display.',
    locale: 'en'
  });
  const candidateIds = packet.candidateParts.map((part) => part.id);

  assert.equal(packet.contextRoute.routeId, 'v2-dht11-temperature-humidity-display');
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.ok(candidateIds.includes('dht11'), candidateIds.join(', '));
  assert.ok(candidateIds.includes('lcd-20x4'), candidateIds.join(', '));
  assert.equal(candidateIds.includes('lcd-16x2'), false, candidateIds.join(', '));
  assert.equal(candidateIds.includes('oled-i2c-096'), false, candidateIds.join(', '));
});

test('context packet promotes supported analog dimmer without support gaps', async () => {
  const packet = await buildContextPacket({
    message: 'Use a potentiometer dial to control LED brightness.',
    locale: 'en'
  });

  assert.ok(packet.capabilityMatches.some((capability) => capability.id === 'analog-led-dimmer'));
  assert.equal(packet.supportGaps.some((gap) => /analog-led-dimmer/i.test(gap)), false);
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'data:capability-graph:analog-led-dimmer'));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.match(packet.promptBlock, /analog-led-dimmer/i);
  assert.match(packet.promptBlock, /potentiometer-10k/i);
});

test('context packet keeps explicit trimmer dimmers from falling back to the generic potentiometer', async () => {
  const packet = await buildContextPacket({
    message: '트리머 가변저항으로 LED 밝기를 조절하고 싶어',
    locale: 'ko'
  });
  const candidateIds = packet.candidateParts.map((part) => part.id);
  const footprintTypes = packet.renderFootprints.map((footprint) => footprint.type);

  assert.equal(packet.contextRoute.routeId, 'v2-analog-led-dimmer');
  assert.ok(packet.capabilityMatches.some((capability) => capability.id === 'analog-led-dimmer'));
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.ok(candidateIds.includes('trimmer-pot'), candidateIds.join(', '));
  assert.equal(candidateIds.includes('potentiometer-10k'), false, candidateIds.join(', '));
  assert.ok(footprintTypes.includes('trimmer-pot'), footprintTypes.join(', '));
  assert.equal(footprintTypes.includes('potentiometer'), false, footprintTypes.join(', '));
});

test('context packet routes powered analog sensor readouts through the v2 analog sensor bundle', async () => {
  const packet = await buildContextPacket({
    message: 'Show soil moisture sensor value on the OLED display.',
    locale: 'en'
  });

  assert.ok(packet.capabilityMatches.some((capability) => capability.id === 'analog-sensor-display-readout'));
  assert.equal(packet.contextRoute.routeId, 'v2-analog-sensor-display-readout');
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.ok(packet.candidateParts.some((part) => part.id === 'soil-moisture'));
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:analog-sensor-display-readout'));
});

test('context packet routes two-pin resistive sensor readouts through divider-aware analog bundle', async () => {
  const packet = await buildContextPacket({
    message: 'Show FSR pressure sensor value on the OLED display.',
    locale: 'en'
  });
  const candidateIds = packet.candidateParts.map((part) => part.id);

  assert.ok(packet.capabilityMatches.some((capability) => capability.id === 'analog-sensor-display-readout'));
  assert.equal(packet.contextRoute.routeId, 'v2-analog-sensor-display-readout');
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.ok(candidateIds.includes('fsr-pressure'), candidateIds.join(', '));
  assert.ok(candidateIds.includes('resistor-10k'), candidateIds.join(', '));
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:analog-sensor-display-readout'));
});

test('context packet routes powered digital sensors through digital input bundle', async () => {
  const packet = await buildContextPacket({
    message: 'Turn on an LED when the PIR motion sensor detects movement.',
    locale: 'en'
  });
  const candidateIds = packet.candidateParts.map((part) => part.id);

  assert.ok(packet.capabilityMatches.some((capability) => capability.id === 'digital-input-threshold-output'));
  assert.equal(packet.contextRoute.routeId, 'v2-digital-input-threshold-output');
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.ok(candidateIds.includes('pir-hc-sr501'), candidateIds.join(', '));
  assert.ok(candidateIds.includes('led-5mm'), candidateIds.join(', '));
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:digital-input-threshold-output'));
});

test('context packet routes matrix, joystick, and rotary readouts through dedicated v2 bundles', async () => {
  for (const { message, routeId, bundleId, partId } of [
    {
      message: 'Show the pressed keypad key on the OLED display.',
      routeId: 'v2-matrix-input-display-readout',
      bundleId: 'bundle:matrix-input-display-readout',
      partId: 'keypad-4x4'
    },
    {
      message: 'Show joystick X and Y position on the OLED display.',
      routeId: 'v2-joystick-display-readout',
      bundleId: 'bundle:joystick-display-readout',
      partId: 'joystick-module'
    },
    {
      message: 'Show rotary encoder count on the OLED display.',
      routeId: 'v2-rotary-encoder-display-readout',
      bundleId: 'bundle:rotary-encoder-display-readout',
      partId: 'rotary-encoder'
    }
  ]) {
    const packet = await buildContextPacket({ message, locale: 'en' });
    const candidateIds = packet.candidateParts.map((part) => part.id);

    assert.equal(packet.contextRoute.routeId, routeId);
    assert.equal(packet.contextCoverage.status, 'sufficient');
    assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
    assert.ok(candidateIds.includes(partId), candidateIds.join(', '));
    assert.ok(packet.retrievalPlan.sourceIds.includes(bundleId));
  }
});

test('context packet routes LED array and addressable display modules through dedicated v2 bundles', async () => {
  for (const { message, routeId, bundleId, partId, forbiddenPartId } of [
    {
      message: 'Show 1234 on a TM1637 4 digit 7-segment display.',
      routeId: 'v2-led-array-display-output',
      bundleId: 'bundle:led-array-display-output',
      partId: '7seg-4digit-tm1637',
      forbiddenPartId: 'oled-i2c-096'
    },
    {
      message: 'Show a smile pattern on an 8x8 LED matrix MAX7219 module.',
      routeId: 'v2-led-array-display-output',
      bundleId: 'bundle:led-array-display-output',
      partId: '8x8-matrix-max7219',
      forbiddenPartId: '7seg-4digit-tm1637'
    },
    {
      message: 'Make a rainbow pattern on a NeoPixel ring with 12 LEDs.',
      routeId: 'v2-addressable-led-display-output',
      bundleId: 'bundle:addressable-led-display-output',
      partId: 'neopixel-ring-12',
      forbiddenPartId: 'oled-i2c-096'
    }
  ]) {
    const packet = await buildContextPacket({ message, locale: 'en' });
    const candidateIds = packet.candidateParts.map((part) => part.id);

    assert.equal(packet.contextRoute.routeId, routeId);
    assert.equal(packet.contextCoverage.status, 'sufficient');
    assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
    assert.ok(candidateIds.includes(partId), candidateIds.join(', '));
    assert.equal(candidateIds.includes(forbiddenPartId), false, candidateIds.join(', '));
    assert.ok(packet.retrievalPlan.sourceIds.includes(bundleId));
  }
});

test('context packet preserves explicit WP-05 light and sound part choices', async () => {
  for (const { message, locale, routeId, bundleId, partId, forbiddenPartIds } of [
    {
      message: '액티브 부저로 알람 소리 내줘.',
      locale: 'ko' as const,
      routeId: 'v2-sound-alert-output',
      bundleId: 'bundle:sound-alert-output',
      partId: 'active-buzzer',
      forbiddenPartIds: ['piezo-buzzer']
    },
    {
      message: '공통 캐소드 RGB LED 색을 바꿔줘.',
      locale: 'ko' as const,
      routeId: 'v2-digital-light-output',
      bundleId: 'bundle:digital-light-output',
      partId: 'rgb-led-common-cathode',
      forbiddenPartIds: ['led-5mm']
    },
    {
      message: '레이저 모듈을 켜고 끄는 회로를 만들어줘.',
      locale: 'ko' as const,
      routeId: 'v2-digital-light-output',
      bundleId: 'bundle:digital-light-output',
      partId: 'laser-diode-module',
      forbiddenPartIds: ['led-5mm', 'resistor-220']
    },
    {
      message: 'WS2812B LED 스트립에 무지개 패턴을 보여줘.',
      locale: 'ko' as const,
      routeId: 'v2-addressable-led-display-output',
      bundleId: 'bundle:addressable-led-display-output',
      partId: 'ws2812b-strip',
      forbiddenPartIds: ['neopixel-ring-12']
    }
  ]) {
    const packet = await buildContextPacket({ message, locale });
    const candidateIds = packet.candidateParts.map((part) => part.id);

    assert.equal(packet.contextRoute.routeId, routeId);
    assert.equal(packet.contextCoverage.status, 'sufficient');
    assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
    assert.ok(candidateIds.includes(partId), candidateIds.join(', '));
    for (const forbiddenPartId of forbiddenPartIds) {
      assert.equal(candidateIds.includes(forbiddenPartId), false, candidateIds.join(', '));
    }
    assert.ok(packet.retrievalPlan.sourceIds.includes(bundleId));
    assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
  }
});

test('context packet exposes WP-07 low-voltage power rail bundle artifacts', async () => {
  const packet = await buildContextPacket({
    message: 'Use a 9V battery clip and 7805 regulator to make a regulated 5V breadboard power rail.',
    locale: 'en'
  });
  const candidateIds = packet.candidateParts.map((part) => part.id);
  const primitiveIds = packet.simulationPrimitives.map((primitive) => primitive.id);
  const footprintTypes = packet.renderFootprints.map((footprint) => footprint.type);

  assert.equal(packet.contextRoute.routeId, 'v2-low-voltage-power-rail');
  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:low-voltage-power-rail'));
  assert.ok(candidateIds.includes('9v-battery-clip'), candidateIds.join(', '));
  assert.ok(candidateIds.includes('7805-regulator'), candidateIds.join(', '));
  assert.ok(primitiveIds.includes('low_voltage_power_rail_state'), primitiveIds.join(', '));
  assert.ok(primitiveIds.includes('regulated_5v_rail_state'), primitiveIds.join(', '));
  assert.ok(footprintTypes.includes('battery-9v-clip'), footprintTypes.join(', '));
  assert.ok(footprintTypes.includes('7805-regulator'), footprintTypes.join(', '));
  assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
});

test('context packet exposes WP-07 passive and timing state-only bundle artifacts', async () => {
  for (const { message, routeId, bundleId, partId, footprintType, primitiveId } of [
    {
      message: 'Show a 1N4007 diode and ceramic capacitor as low-voltage protection context on a breadboard.',
      routeId: 'v2-passive-protection-context',
      bundleId: 'bundle:passive-protection-context',
      partId: 'diode-1n4007',
      footprintType: 'rectifier-diode',
      primitiveId: 'passive_protection_context_state'
    },
    {
      message: 'Show a 16 MHz crystal clock reference on the breadboard.',
      routeId: 'v2-timing-passive-context',
      bundleId: 'bundle:timing-passive-context',
      partId: 'crystal-16mhz',
      footprintType: 'crystal-16mhz',
      primitiveId: 'timing_passive_context_state'
    }
  ]) {
    const packet = await buildContextPacket({ message, locale: 'en' });
    const candidateIds = packet.candidateParts.map((part) => part.id);
    const primitiveIds = packet.simulationPrimitives.map((primitive) => primitive.id);
    const footprintTypes = packet.renderFootprints.map((footprint) => footprint.type);

    assert.equal(packet.contextRoute.routeId, routeId);
    assert.equal(packet.contextCoverage.status, 'sufficient');
    assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
    assert.ok(packet.retrievalPlan.sourceIds.includes(bundleId));
    assert.ok(candidateIds.includes(partId), candidateIds.join(', '));
    assert.ok(primitiveIds.includes(primitiveId), primitiveIds.join(', '));
    assert.ok(footprintTypes.includes(footprintType), footprintTypes.join(', '));
    assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
  }
});

test('context packet exposes WP-09 prototyping and connector state-only bundle artifacts', async () => {
  for (const { message, routeId, bundleId, partId, footprintType, primitiveId } of [
    {
      message: 'Show this circuit on a mini breadboard prototyping surface.',
      routeId: 'v2-prototyping-surface-context',
      bundleId: 'bundle:prototyping-surface-context',
      partId: 'breadboard-mini',
      footprintType: 'breadboard-mini',
      primitiveId: 'prototyping_surface_context_state'
    },
    {
      message: 'Place a 4 pin screw terminal block as low-voltage connector context.',
      routeId: 'v2-connector-wiring-context',
      bundleId: 'bundle:connector-wiring-context',
      partId: 'screw-terminal-4pin',
      footprintType: 'screw-terminal-4pin',
      primitiveId: 'connector_wiring_context_state'
    }
  ]) {
    const packet = await buildContextPacket({ message, locale: 'en' });
    const candidateIds = packet.candidateParts.map((part) => part.id);
    const primitiveIds = packet.simulationPrimitives.map((primitive) => primitive.id);
    const footprintTypes = packet.renderFootprints.map((footprint) => footprint.type);

    assert.equal(packet.contextRoute.routeId, routeId);
    assert.equal(packet.contextCoverage.status, 'sufficient');
    assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
    assert.ok(packet.retrievalPlan.sourceIds.includes(bundleId));
    assert.ok(candidateIds.includes(partId), candidateIds.join(', '));
    assert.ok(primitiveIds.includes(primitiveId), primitiveIds.join(', '));
    assert.ok(footprintTypes.includes(footprintType), footprintTypes.join(', '));
    assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
  }
});

test('context packet routes bare single digit 7-segment displays through a resistor-aware v2 bundle', async () => {
  for (const { message, locale } of [
    { message: 'Show a number on a bare single digit 7-segment display using resistors.', locale: 'en' as const },
    { message: '1자리 7세그먼트에 숫자 표시해줘.', locale: 'ko' as const }
  ]) {
    const packet = await buildContextPacket({ message, locale });
    const candidateIds = packet.candidateParts.map((part) => part.id);

    assert.equal(packet.contextRoute.routeId, 'v2-bare-seven-segment-display-output');
    assert.equal(packet.contextCoverage.status, 'sufficient');
    assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
    assert.deepEqual(packet.capabilityMatches.map((capability) => capability.id), ['bare-seven-segment-display-output']);
    assert.ok(candidateIds.includes('7seg-1digit'), candidateIds.join(', '));
    assert.ok(candidateIds.includes('resistor-220'), candidateIds.join(', '));
    assert.equal(candidateIds.includes('7seg-4digit-tm1637'), false, candidateIds.join(', '));
    assert.equal(candidateIds.includes('oled-i2c-096'), false, candidateIds.join(', '));
    assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:bare-seven-segment-display-output'));
  }
});

test('context packet routes SPI display modules through a dedicated v2 bundle', async () => {
  for (const { message, partId, forbiddenPartId } of [
    {
      message: 'Show HELLO on a 1.8 inch SPI TFT display.',
      partId: 'tft-18',
      forbiddenPartId: 'oled-i2c-096'
    },
    {
      message: 'Draw a smile on a Nokia 5110 LCD display with Arduino.',
      partId: 'nokia-5110',
      forbiddenPartId: 'tft-18'
    },
    {
      message: 'Display a message on a 2.13 inch e-paper screen.',
      partId: 'epaper-213',
      forbiddenPartId: 'tft-18'
    }
  ]) {
    const packet = await buildContextPacket({ message, locale: 'en' });
    const candidateIds = packet.candidateParts.map((part) => part.id);

    assert.equal(packet.contextRoute.routeId, 'v2-spi-display-output');
    assert.equal(packet.contextCoverage.status, 'sufficient');
    assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
    assert.deepEqual(packet.capabilityMatches.map((capability) => capability.id), ['spi-display-output']);
    assert.ok(candidateIds.includes(partId), candidateIds.join(', '));
    assert.equal(candidateIds.includes(forbiddenPartId), false, candidateIds.join(', '));
    assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:spi-display-output'));
  }
});

test('context packet prunes sibling family parts for explicit v2 hardware requests', async () => {
  const packet = await buildContextPacket({
    message: 'Display whether the limit switch is pressed on the OLED screen.',
    locale: 'en'
  });
  const candidateIds = packet.candidateParts.map((part) => part.id);
  const footprintTypes = packet.renderFootprints.map((footprint) => footprint.type);

  assert.equal(packet.contextRoute.routeId, 'v2-digital-input-display-readout');
  assert.ok(candidateIds.includes('limit-switch'), candidateIds.join(', '));
  assert.equal(candidateIds.includes('reed-switch'), false);
  assert.equal(candidateIds.includes('pir-hc-sr501'), false);
  assert.equal(footprintTypes.includes('spdt-switch-nonc-3pin'), true);
  assert.equal(footprintTypes.includes('pulse-sensor-module-5pin'), false);
  assert.ok(packet.promptBlock.length < 13000, `prompt length was ${packet.promptBlock.length}`);
});

test('context packet prunes broad capabilities for explicit WP-10 protocol sensor requests', async () => {
  for (const { message, routeId, capabilityId, partId, forbiddenPartIds } of [
    {
      message: 'Show BMP280 pressure sensor value on the OLED display.',
      routeId: 'v2-i2c-sensor-display-readout',
      capabilityId: 'i2c-sensor-display-readout',
      partId: 'bmp280',
      forbiddenPartIds: ['soil-moisture', 'photoresistor-ldr']
    },
    {
      message: 'Show RC522 RFID tag read state on the OLED display.',
      routeId: 'v2-spi-sensor-display-readout',
      capabilityId: 'spi-sensor-display-readout',
      partId: 'rc522-rfid',
      forbiddenPartIds: ['tft-18', 'nokia-5110']
    },
    {
      message: 'Show NEO-6M GPS coordinate value on the OLED display.',
      routeId: 'v2-uart-sensor-display-readout',
      capabilityId: 'uart-sensor-display-readout',
      partId: 'gps-neo6m',
      forbiddenPartIds: ['pir-hc-sr501', 'led-5mm']
    }
  ]) {
    const packet = await buildContextPacket({ message, locale: 'en' });
    const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
    const candidateIds = packet.candidateParts.map((part) => part.id);

    assert.equal(packet.contextRoute.routeId, routeId, message);
    assert.deepEqual(capabilityIds, [capabilityId], `${message}: ${capabilityIds.join(', ')}`);
    assert.ok(candidateIds.includes(partId), `${message}: ${candidateIds.join(', ')}`);
    for (const forbiddenPartId of forbiddenPartIds) {
      assert.equal(candidateIds.includes(forbiddenPartId), false, `${message}: ${candidateIds.join(', ')}`);
    }
    for (const broadCapabilityId of ['display-text-output', 'analog-sensor-display-readout', 'digital-input-display-readout', 'digital-light-output']) {
      assert.equal(capabilityIds.includes(broadCapabilityId), false, `${message}: ${capabilityIds.join(', ')}`);
    }
    assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars, `${message}: ${packet.promptBlock.length}/${packet.retrievalPlan.maxPromptChars}`);
  }
});

test('context packet routes WP-12 logic interface requests through the dedicated v2 bundle', async () => {
  for (const { message, partId, forbiddenPartIds } of [
    {
      message: 'Show ADS1115 external ADC interface state on the OLED display.',
      partId: 'ads1115-adc',
      forbiddenPartIds: ['soil-moisture', 'photoresistor-ldr']
    },
    {
      message: 'Show MCP3008 SPI ADC bus state on the OLED display.',
      partId: 'mcp3008-adc',
      forbiddenPartIds: ['rc522-rfid', 'tft-18']
    },
    {
      message: 'Show 74HC595 shift register state on the OLED display.',
      partId: '74hc595-shift',
      forbiddenPartIds: ['led-5mm', '7seg-4digit-tm1637']
    },
    {
      message: 'Show an I2C level shifter voltage-domain context.',
      partId: 'i2c-level-shifter',
      forbiddenPartIds: ['7805-regulator', 'barrel-jack']
    }
  ]) {
    const packet = await buildContextPacket({ message, locale: 'en' });
    const capabilityIds = packet.capabilityMatches.map((capability) => capability.id);
    const candidateIds = packet.candidateParts.map((part) => part.id);

    assert.equal(packet.contextRoute.routeId, 'v2-logic-interface-context', message);
    assert.deepEqual(capabilityIds, ['logic-interface-context'], `${message}: ${capabilityIds.join(', ')}`);
    assert.ok(candidateIds.includes(partId), `${message}: ${candidateIds.join(', ')}`);
    for (const forbiddenPartId of forbiddenPartIds) {
      assert.equal(candidateIds.includes(forbiddenPartId), false, `${message}: ${candidateIds.join(', ')}`);
    }
    for (const broadCapabilityId of ['display-text-output', 'analog-sensor-display-readout', 'digital-input-display-readout', 'low-voltage-power-rail']) {
      assert.equal(capabilityIds.includes(broadCapabilityId), false, `${message}: ${capabilityIds.join(', ')}`);
    }
    assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:logic-interface-context'));
    assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars, `${message}: ${packet.promptBlock.length}/${packet.retrievalPlan.maxPromptChars}`);
  }
});

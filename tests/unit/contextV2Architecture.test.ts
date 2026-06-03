import assert from 'node:assert/strict';
import test from 'node:test';

import { buildContextPacket } from '../../server/context/contextPacket.ts';
import {
  ContextBundleManifestV2Schema,
  loadContextBundleV2,
  loadContextV2Index,
  loadContextV2Routes
} from '../../server/context/contextLayer.ts';

test('v2 bundle manifest separates prompt summary from canonical refs', () => {
  const manifest = ContextBundleManifestV2Schema.parse({
    schemaVersion: '2026-06-01',
    bundleId: 'digital-light-output',
    capabilityId: 'digital-light-output',
    supportLevel: 'supported',
    promptBudget: 'summary',
    agentSummaryPath: 'bundles/digital-light-output/BUNDLE.md',
    requiredParts: ['arduino-uno', 'breadboard-half', 'led-5mm', 'resistor-220'],
    allowedParts: ['arduino-uno', 'breadboard-half', 'led-5mm', 'resistor-220', 'jumper-wire'],
    requiredTopologies: ['controller-digital-output-series-load'],
    validationRules: ['series-current-limit', 'led-polarity', 'closed-current-path'],
    simulationPrimitives: ['digital_on_off', 'blink_timer', 'current_flow_animation'],
    renderFootprints: ['arduino', 'breadboard', 'led', 'resistor', 'wire'],
    canonicalRefs: {
      parts: ['shared:parts:arduino-uno', 'shared:parts:led-5mm', 'shared:parts:resistor-220'],
      footprints: ['shared:footprint:arduino', 'shared:footprint:led', 'shared:footprint:resistor'],
      simulation: ['shared:primitive:digital_on_off', 'shared:primitive:current_flow_animation'],
      topology: ['shared:topology:controller-digital-output-series-load'],
      sources: ['shared:source:led-5mm-requires-current-limit']
    },
    promptInclusions: {
      includePins: true,
      includeElectricalLimits: true,
      includeFootprintAnchors: false,
      includeSourceQuotes: false
    },
    blockingConditions: ['missing-source-claims', 'missing-render-footprint']
  });

  assert.equal(manifest.bundleId, 'digital-light-output');
  assert.equal(manifest.promptInclusions.includeSourceQuotes, false);
  assert.ok(manifest.canonicalRefs.parts.includes('shared:parts:arduino-uno'));
});

test('v2 context index and routes load bundle-first retrieval metadata', async () => {
  const [index, routes] = await Promise.all([
    loadContextV2Index(),
    loadContextV2Routes()
  ]);

  assert.equal(index.version, '2026-06-01');
  assert.ok(index.bundles.some((bundle) => bundle.bundleId === 'digital-light-output'));
  assert.ok(index.bundles.some((bundle) => bundle.bundleId === 'light-sensor-triggered-output'));
  assert.ok(index.bundles.some((bundle) => bundle.bundleId === 'distance-sensor-display'));
  assert.ok(index.bundles.some((bundle) => bundle.bundleId === 'dht11-temperature-humidity-display'));
  assert.ok(index.bundles.some((bundle) => bundle.bundleId === 'button-controlled-light-output'));
  assert.ok(index.bundles.some((bundle) => bundle.bundleId === 'sound-alert-output'));
  assert.ok(index.bundles.some((bundle) => bundle.bundleId === 'servo-motion-output'));
  assert.ok(index.bundles.some((bundle) => bundle.bundleId === 'bare-seven-segment-display-output'));
  assert.ok(index.bundles.some((bundle) => bundle.bundleId === 'led-array-display-output'));
  assert.ok(index.bundles.some((bundle) => bundle.bundleId === 'addressable-led-display-output'));
  assert.ok(index.bundles.some((bundle) => bundle.bundleId === 'spi-display-output'));
  assert.ok(routes.routes.some((route) => route.routeId === 'v2-digital-light-output'));
  assert.ok(routes.routes.some((route) => route.routeId === 'v2-light-sensor-triggered-output'));
  assert.ok(routes.routes.some((route) => route.routeId === 'v2-distance-sensor-display'));
  assert.ok(routes.routes.some((route) => route.routeId === 'v2-dht11-temperature-humidity-display'));
  assert.ok(routes.routes.some((route) => route.routeId === 'v2-button-controlled-light-output'));
  assert.ok(routes.routes.some((route) => route.routeId === 'v2-sound-alert-output'));
  assert.ok(routes.routes.some((route) => route.routeId === 'v2-servo-motion-output'));
  assert.ok(routes.routes.some((route) => route.routeId === 'v2-bare-seven-segment-display-output'));
  assert.ok(routes.routes.some((route) => route.routeId === 'v2-led-array-display-output'));
  assert.ok(routes.routes.some((route) => route.routeId === 'v2-addressable-led-display-output'));
  assert.ok(routes.routes.some((route) => route.routeId === 'v2-spi-display-output'));
  // Every route provides context via curated bundles or an explicit source list
  // (policy-only routes and the migrated safety/general fallback routes use
  // alwaysInclude rather than bundleIds).
  assert.ok(routes.routes.every((route) => route.bundleIds.length > 0 || route.alwaysInclude.length > 0));
  // The v1 safety/general fallback routes now live in v2 (single router).
  assert.ok(routes.routes.some((route) => route.routeId === 'unsupported-safety' && route.when.unsafe === true));
  assert.ok(routes.routes.some((route) => route.routeId === 'supported-hardware-general'));
});

test('v2 bundle loader returns summary and manifest without loading heavy shared data', async () => {
  const bundle = await loadContextBundleV2('digital-light-output');

  assert.equal(bundle.manifest.bundleId, 'digital-light-output');
  assert.match(bundle.summary, /LED/i);
  assert.ok(bundle.summary.length < 1500);
  assert.equal(bundle.manifest.promptInclusions.includeFootprintAnchors, false);
  assert.ok(bundle.manifest.allowedParts.includes('led-5mm'));
});

test('context packet prefers v2 bundle route for supported LED requests', async () => {
  const packet = await buildContextPacket({
    message: 'LED를 깜빡이는 회로를 만들고 싶어',
    locale: 'ko'
  });

  assert.equal(packet.contextRoute.routeId, 'v2-digital-light-output');
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:digital-light-output'));
  assert.match(packet.promptBlock, /Digital Light Output/);
  assert.doesNotMatch(packet.promptBlock, /"pinAnchors"\s*:/);
});

test('v2 context packet keeps supported LED prompt under bundle budget', async () => {
  const packet = await buildContextPacket({
    message: 'LED를 깜빡이는 회로를 만들고 싶어',
    locale: 'ko'
  });

  assert.ok(packet.promptBlock.length < 9000, `prompt length was ${packet.promptBlock.length}`);
  // The digital-light-output route budget was raised 9000 -> 11000 (parity with the peer single-output
  // sound-alert route) so the synthesis prompt fits the ReAct decision contract + concise-message
  // guidance; the context block itself stays well under it (asserted above).
  assert.ok(packet.retrievalPlan.maxPromptChars <= 11000);
});

test('v2 policy-only routes keep ambiguous requests under prompt budget', async () => {
  const packet = await buildContextPacket({
    message: '온도랑 습도 값을 OLED에 표시해줘',
    locale: 'ko'
  });

  assert.equal(packet.contextRoute.routeId, 'v2-ambiguous-minimal');
  assert.equal(packet.retrievalPlan.budget, 'minimal');
  assert.ok(
    packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars,
    `prompt length was ${packet.promptBlock.length}/${packet.retrievalPlan.maxPromptChars}`
  );
});

test('v2 bundle allowedParts restricts candidate hardware surface', async () => {
  const packet = await buildContextPacket({
    message: 'LED를 깜빡이고 OLED도 추가해서 보여줘',
    locale: 'ko'
  });

  const bundleIds = packet.retrievalPlan.sourceIds.filter((id) => id.startsWith('bundle:'));
  const candidateIds = packet.candidateParts.map((part) => part.id);

  assert.ok(bundleIds.length > 0);
  for (const partId of candidateIds) {
    assert.ok(
      ['arduino-uno', 'breadboard-half', 'led-5mm', 'resistor-220', 'jumper-wire', 'oled-i2c-096'].includes(partId),
      `${partId} should be allowed by selected v2 bundles`
    );
  }
});

test('v2 analog dimmer bundle loads build-ready render and simulation catalogs', async () => {
  const packet = await buildContextPacket({
    message: '가변저항으로 LED 밝기를 조절하고 싶어',
    locale: 'ko'
  });

  assert.equal(packet.contextRoute.routeId, 'v2-analog-led-dimmer');
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:analog-led-dimmer'));
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.equal(packet.supportGaps.some((gap) => /analog-led-dimmer/i.test(gap)), false);
  assert.ok(packet.renderFootprints.some((footprint) => footprint.type === 'potentiometer'));
  assert.ok(packet.simulationPrimitives.some((primitive) => primitive.id === 'analog_pwm_dimmer'));
  assert.match(packet.promptBlock, /Current support level: supported/);
});

test('v2 light sensor bundle wins over generic LED routing and loads analog threshold context', async () => {
  const packet = await buildContextPacket({
    message: 'Turn on an LED when a photoresistor says the room is dark.',
    locale: 'en'
  });

  assert.equal(packet.contextRoute.routeId, 'v2-light-sensor-triggered-output');
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:light-sensor-triggered-output'));
  assert.ok(packet.capabilityMatches.some((capability) => capability.id === 'light-sensor-triggered-output'));
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.equal(packet.supportGaps.some((gap) => /light-sensor-triggered-output/i.test(gap)), false);
  assert.ok(packet.candidateParts.some((part) => part.id === 'photoresistor-ldr'));
  assert.ok(packet.renderFootprints.some((footprint) => footprint.type === 'ldr-module'));
  assert.ok(packet.simulationPrimitives.some((primitive) => primitive.id === 'analog_threshold'));
  assert.match(packet.promptBlock, /Light Sensor Triggered Output/);
});

test('v2 distance sensor bundle wins over generic display routing and loads ultrasonic context', async () => {
  const packet = await buildContextPacket({
    message: 'Show distance from an ultrasonic sensor on the OLED display.',
    locale: 'en'
  });

  assert.equal(packet.contextRoute.routeId, 'v2-distance-sensor-display');
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:distance-sensor-display'));
  assert.ok(packet.capabilityMatches.some((capability) => capability.id === 'distance-sensor-display'));
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.equal(packet.supportGaps.some((gap) => /distance-sensor-display/i.test(gap)), false);
  assert.ok(packet.candidateParts.some((part) => part.id === 'ultrasonic-hc-sr04'));
  assert.ok(packet.renderFootprints.some((footprint) => footprint.type === 'ultrasonic-sensor'));
  assert.ok(packet.simulationPrimitives.some((primitive) => primitive.id === 'display_sensor_value'));
  assert.match(packet.promptBlock, /Distance Sensor Display/);
});

test('v2 DHT11 bundle wins over generic display routing and loads temperature humidity context', async () => {
  const packet = await buildContextPacket({
    message: 'Show temperature and humidity from a DHT11 on the OLED display.',
    locale: 'en'
  });

  assert.equal(packet.contextRoute.routeId, 'v2-dht11-temperature-humidity-display');
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:dht11-temperature-humidity-display'));
  assert.ok(packet.capabilityMatches.some((capability) => capability.id === 'dht11-temperature-humidity-display'));
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.equal(packet.supportGaps.some((gap) => /dht11-temperature-humidity-display|dht11/i.test(gap)), false);
  assert.ok(packet.candidateParts.some((part) => part.id === 'dht11'));
  assert.ok(packet.renderFootprints.some((footprint) => footprint.type === 'dht11-sensor'));
  assert.ok(packet.simulationPrimitives.some((primitive) => primitive.id === 'display_sensor_value'));
  assert.match(packet.promptBlock, /DHT11 Temperature\/Humidity Display/);
});

test('v2 starter interaction bundles route button, buzzer, and servo requests', async () => {
  const [buttonPacket, buzzerPacket, servoPacket] = await Promise.all([
    buildContextPacket({
      message: 'When I press a button, turn on an LED safely.',
      locale: 'en'
    }),
    buildContextPacket({
      message: '부저가 삐 소리를 내는 회로를 만들어줘',
      locale: 'ko'
    }),
    buildContextPacket({
      message: '서보모터를 90도로 움직이는 회로를 만들고 싶어',
      locale: 'ko'
    })
  ]);

  assert.equal(buttonPacket.contextRoute.routeId, 'v2-button-controlled-light-output');
  assert.ok(buttonPacket.retrievalPlan.sourceIds.includes('bundle:button-controlled-light-output'));
  assert.ok(buttonPacket.candidateParts.some((part) => part.id === 'button-tactile'));
  assert.match(buttonPacket.promptBlock, /Button Controlled Light Output/);

  assert.equal(buzzerPacket.contextRoute.routeId, 'v2-sound-alert-output');
  assert.ok(buzzerPacket.retrievalPlan.sourceIds.includes('bundle:sound-alert-output'));
  assert.ok(buzzerPacket.candidateParts.some((part) => part.id === 'piezo-buzzer'));
  assert.match(buzzerPacket.promptBlock, /Sound Alert Output/);

  assert.equal(servoPacket.contextRoute.routeId, 'v2-servo-motion-output');
  assert.ok(servoPacket.retrievalPlan.sourceIds.includes('bundle:servo-motion-output'));
  assert.ok(servoPacket.candidateParts.some((part) => part.id === 'micro-servo'));
  assert.match(servoPacket.promptBlock, /Servo Motion Output/);
});

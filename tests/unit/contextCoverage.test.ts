import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPartRegistry,
  auditCapabilityCoverage,
  auditCapabilityPromotionGaps,
  auditVisualLibraryExpansion,
  loadCapabilityGraph,
  loadBreadboardGrid,
  loadRenderFootprints,
  loadSimulationPrimitives,
  REQUIRED_CAPABILITY_ARTIFACTS
} from '../../server/context/contextLayer.ts';
import { buildContextPacket } from '../../server/context/contextPacket.ts';
import {
  buildVisualPartCoverageReport,
  renderVisualPartCoverageMarkdown
} from '../../server/context/visualPartCoverageReport.ts';
import type { SimulationPrimitive } from '../../server/agent/schemas.ts';

test('simulation primitives expose validation, current path, state, UI, overlay, and limitation contracts', async () => {
  const primitives = await loadSimulationPrimitives();
  const byId = new Map(primitives.map((primitive) => [primitive.id, primitive]));

  for (const id of ['display_static_text', 'digital_on_off', 'current_flow_animation', 'servo_angle', 'fault_visualization']) {
    assert.ok(byId.has(id), `${id} primitive should exist`);
  }

  for (const primitive of primitives) {
    assert.ok(primitive.validationRules.length > 0, `${primitive.id} declares validation rules`);
    assert.ok(primitive.currentPathRecipe.type.length > 0, `${primitive.id} declares current path recipe`);
    assert.ok(primitive.currentPathRecipe.description.length > 0, `${primitive.id} explains current path recipe`);
    assert.ok(primitive.expectedStateRecipe.type.length > 0, `${primitive.id} declares expected state recipe`);
    assert.ok(primitive.expectedStateRecipe.description.length > 0, `${primitive.id} explains expected state recipe`);
    assert.ok(primitive.animationCues.length > 0, `${primitive.id} declares animation cues`);
    assert.ok(primitive.renderOverlays.length > 0, `${primitive.id} declares render overlays`);
    assert.ok(primitive.limitations.length > 0, `${primitive.id} declares truthfulness limitations`);
  }

  const display = byId.get('display_static_text');
  assert.deepEqual(display?.requiredNetRoles, ['power', 'ground', 'i2c-data', 'i2c-clock']);
  assert.ok(display?.uiControls.some((control) => control.id === 'display_text'));
});

test('simulation primitives expose machine-readable current path templates where current can be estimated', async () => {
  const primitives = await loadSimulationPrimitives();
  const byId = new Map(primitives.map((primitive) => [primitive.id, primitive]));
  const currentProducingIds = primitives
    .filter((primitive) => primitive.requiresElectricalAnalysis)
    .filter((primitive) => !['current_flow_animation'].includes(primitive.id))
    .filter((primitive) => !primitive.currentPathRecipe.type.startsWith('state-only'))
    .map((primitive) => primitive.id);

  for (const id of currentProducingIds) {
    const templates = currentPathTemplates(byId.get(id));
    assert.ok(templates.length > 0, `${id} declares current path templates`);
    for (const template of templates) {
      assert.ok(template.id, `${id} current path template has stable id`);
      assert.ok(template.kind, `${id} current path template has semantic kind`);
      assert.ok(template.label, `${id} current path template has student-facing label`);
      assert.ok(template.sourceEndpoint, `${id} current path template has source endpoint strategy`);
      assert.ok(template.returnEndpoint, `${id} current path template has return endpoint strategy`);
      assert.ok(template.through.length > 0, `${id} current path template declares path body`);
      assert.match(template.animation.color, /^#[0-9a-f]{6}$/i, `${id} current path template declares animation color`);
      assert.ok(template.animation.speed > 0, `${id} current path template declares positive animation speed`);
    }
  }

  assert.equal(byId.get('digital_on_off')?.currentPathRecipe.pathTemplate?.sourceEndpoint, 'controller-signal');
  assert.deepEqual(byId.get('digital_on_off')?.currentPathRecipe.pathTemplate?.through, ['required-passives', 'target']);
  assert.equal(byId.get('display_static_text')?.currentPathRecipe.pathTemplate?.sourceEndpoint, 'controller-power');
});

test('simulation primitives can declare multi-path templates for supply and signal behavior', async () => {
  const primitives = await loadSimulationPrimitives();
  const servo = primitives.find((primitive) => primitive.id === 'servo_angle');

  assert.ok(servo?.currentPathRecipe.pathTemplates, 'servo_angle declares multiple path templates');
  assert.deepEqual(
    servo.currentPathRecipe.pathTemplates.map((template) => template.id),
    ['servo-supply-current', 'servo-pwm-signal']
  );
  assert.equal(servo.currentPathRecipe.pathTemplates[0].kind, 'supply-current');
  assert.equal(servo.currentPathRecipe.pathTemplates[1].kind, 'signal-activity');
  assert.equal(servo.currentPathRecipe.pathTemplates[1].expectedCurrentMa, 0);
  assert.equal(servo.currentPathRecipe.pathTemplates[1].returnEndpoint, 'target-signal');
});

function currentPathTemplates(primitive: SimulationPrimitive | undefined) {
  if (!primitive) {
    return [];
  }
  return primitive.currentPathRecipe.pathTemplates
    ?? (primitive.currentPathRecipe.pathTemplate ? [primitive.currentPathRecipe.pathTemplate] : []);
}

test('render footprints expose pin anchors and placement constraints for supported parts', async () => {
  const [parts, footprints] = await Promise.all([
    getPartRegistry(),
    loadRenderFootprints()
  ]);

  for (const part of parts.filter((candidate) => candidate.supportLevel === 'supported')) {
    const footprint = footprints[part.renderFootprint.type];
    assert.ok(footprint, `${part.id} footprint ${part.renderFootprint.type} exists`);
    assert.ok(footprint.labelAnchor, `${part.id} footprint has a label anchor`);
    assert.ok(footprint.placement, `${part.id} footprint has placement constraints`);
    assert.ok(footprint.simulationOverlayAnchors.length > 0, `${part.id} footprint has simulation overlay anchors`);

    if (part.kind !== 'wiring') {
      for (const pin of part.pins) {
        assert.ok(
          footprint.pinAnchors[pin.name],
          `${part.id} footprint ${part.renderFootprint.type} exposes anchor for pin ${pin.name}`
        );
      }
    }
  }

  assert.deepEqual(footprints.oled.pinAnchors.SDA.role, 'i2c-data');
  assert.deepEqual(footprints.arduino.pinAnchors['A4/SDA'].role, 'i2c-data');
});

test('breadboard grid context exposes machine-readable hole rows and rail anchors', async () => {
  const grid = await loadBreadboardGrid();

  assert.equal(grid.version, '2026-06-01');
  assert.equal(grid.signalArea.rows.length, 4);
  assert.ok(grid.signalArea.xPitch > 0, 'signal hole grid declares x pitch');
  assert.ok(grid.signalArea.snapTolerance.x > 0, 'signal hole grid declares x snap tolerance');
  assert.ok(grid.signalArea.snapTolerance.z > 0, 'signal hole grid declares z snap tolerance');
  assert.deepEqual(
    grid.rails.map((rail) => rail.id),
    ['+ rail', '- rail']
  );
  assert.ok(grid.rails.every((rail) => rail.xPitch > 0), 'rails declare contact pitch');
});

test('render footprints expose visual style metadata consumed by the stage renderer', async () => {
  const footprints = await loadRenderFootprints();

  for (const [id, footprint] of Object.entries(footprints)) {
    assert.ok(footprint.visualStyle, `${id} footprint declares visualStyle`);
    assert.ok(footprint.visualStyle.shape, `${id} footprint declares visual shape`);
    assert.match(footprint.visualStyle.color, /^#[0-9a-f]{6}$/i, `${id} footprint declares hex color`);
    assert.ok(footprint.visualStyle.material, `${id} footprint declares material`);
  }

  assert.deepEqual(footprints.led.visualStyle, {
    shape: 'led',
    color: '#ff5b59',
    material: 'translucent-emissive'
  });
  assert.equal(footprints.resistor.visualStyle.shape, 'resistor');
  assert.equal(footprints.buzzer.visualStyle.color, '#2b2b32');
});

test('render footprints expose hover target metadata for inspector grounding', async () => {
  const footprints = await loadRenderFootprints();

  for (const [id, footprint] of Object.entries(footprints)) {
    assert.ok(footprint.hoverTargets.length > 0, `${id} exposes at least one hover target`);
    for (const target of footprint.hoverTargets) {
      assert.ok(target.id.length > 0, `${id} hover target has an id`);
      assert.ok(target.label.length > 0, `${id} hover target has a label`);
      assert.ok(
        target.explainableAs.length > 0 || target.pin,
        `${id}:${target.id} is explainable or tied to a pin`
      );
      if (target.pin) {
        assert.ok(footprint.pinAnchors[target.pin], `${id}:${target.id} references known pin ${target.pin}`);
      }
    }
  }
});

test('capability graph, part registry, primitives, and render footprints cross-check by support level', async () => {
  const [parts, capabilities, primitives, footprints] = await Promise.all([
    getPartRegistry(),
    loadCapabilityGraph(),
    loadSimulationPrimitives(),
    loadRenderFootprints()
  ]);

  const partIds = new Set(parts.map((part) => part.id));
  const primitiveIds = new Set(primitives.map((primitive) => primitive.id));
  const footprintIds = new Set(Object.keys(footprints));

  for (const part of parts.filter((candidate) => candidate.supportLevel === 'supported')) {
    assert.ok(footprintIds.has(part.renderFootprint.type), `${part.id} render footprint exists`);
    for (const primitiveId of part.compatibleSimulationPrimitives) {
      assert.ok(primitiveIds.has(primitiveId), `${part.id} primitive ${primitiveId} exists`);
    }
  }

  for (const capability of capabilities) {
    for (const primitiveId of capability.simulationPrimitives) {
      assert.ok(primitiveIds.has(primitiveId), `${capability.id} primitive ${primitiveId} exists`);
    }
    for (const footprintId of capability.renderFootprints) {
      assert.ok(footprintIds.has(footprintId), `${capability.id} footprint ${footprintId} exists`);
    }
    if (capability.supportLevel === 'supported') {
      for (const partId of capability.requiredParts) {
        assert.ok(partIds.has(partId), `${capability.id} supported required part ${partId} exists`);
      }
    }
  }
});

test('capability promotion audit passes for promoted analog dimmer capability', async () => {
  assert.deepEqual(REQUIRED_CAPABILITY_ARTIFACTS, [
    'capability-graph-entry',
    'source-claims',
    'part-capability',
    'pin-aliases',
    'validation-rule',
    'simulation-primitive',
    'render-footprint',
    'eval-supported-prompt',
    'eval-unsupported-counterexample',
    'browser-visible-verification'
  ]);

  const report = await auditCapabilityCoverage('analog-led-dimmer');

  assert.equal(report.capabilityId, 'analog-led-dimmer');
  assert.equal(report.supportLevel, 'supported');
  assert.equal(report.recommendedSupportLevel, 'supported');
  assert.equal(report.canBeSupported, true);
  assert.deepEqual(report.missing, []);
});

test('capability promotion audit passes for fully supported starter capabilities', async () => {
  const report = await auditCapabilityCoverage('display-text-output');

  assert.equal(report.capabilityId, 'display-text-output');
  assert.equal(report.supportLevel, 'supported');
  assert.equal(report.recommendedSupportLevel, 'supported');
  assert.equal(report.canBeSupported, true);
  assert.deepEqual(report.missing, []);
  for (const artifact of REQUIRED_CAPABILITY_ARTIFACTS) {
    assert.ok(report.present.includes(artifact), `${artifact} should be present`);
  }
});

test('capability promotion audit requires source claim coverage for supported capabilities', async () => {
  const report = await auditCapabilityCoverage('digital-light-output');

  assert.equal(report.capabilityId, 'digital-light-output');
  assert.equal(report.canBeSupported, true);
  assert.ok(report.present.includes('source-claims'));
  assert.deepEqual(report.missing, []);
});

test('capability promotion audit recommends supported for completed distance sensor display capability', async () => {
  const report = await auditCapabilityCoverage('distance-sensor-display');

  assert.equal(report.supportLevel, 'supported');
  assert.equal(report.recommendedSupportLevel, 'supported');
  assert.equal(report.canBeSupported, true);
  assert.deepEqual(report.missing, []);
});

test('capability promotion audit gates every supported capability', async () => {
  const capabilities = await loadCapabilityGraph();
  const supported = capabilities.filter((capability) => capability.supportLevel === 'supported');

  assert.ok(supported.length > 0, 'expected at least one supported capability');
  for (const capability of supported) {
    const report = await auditCapabilityCoverage(capability.id);
    assert.equal(report.canBeSupported, true, `${capability.id}: ${report.details.join(' | ')}`);
    assert.equal(report.recommendedSupportLevel, 'supported', `${capability.id} should remain supported`);
    assert.deepEqual(report.missing, [], `${capability.id} missing artifacts`);
  }
});

test('capability promotion audit keeps planned capabilities out of supported release gate', async () => {
  const capabilities = await loadCapabilityGraph();
  const planned = capabilities.filter((capability) => capability.supportLevel === 'planned');

  if (planned.length === 0) {
    assert.equal(planned.length, 0, 'no planned capabilities remain after the current promotion slice');
    return;
  }

  for (const capability of planned) {
    const report = await auditCapabilityCoverage(capability.id);
    assert.equal(report.canBeSupported, false, `${capability.id} should not be promotable yet`);
    assert.equal(report.recommendedSupportLevel, 'planned', `${capability.id} should remain planned`);
    assert.ok(report.missing.length > 0, `${capability.id} should name missing artifacts`);
    assert.ok(report.details.length > 0, `${capability.id} should explain missing artifacts`);
  }
});

test('capability promotion gap report aggregates machine-readable blockers by artifact', async () => {
  const [capabilities, report] = await Promise.all([
    loadCapabilityGraph(),
    auditCapabilityPromotionGaps()
  ]);

  assert.equal(report.totalCapabilities, capabilities.length);
  assert.equal(report.reports.length, capabilities.length);
  assert.equal(report.bySupportLevel.supported, capabilities.filter((capability) => capability.supportLevel === 'supported').length);
  assert.equal(report.bySupportLevel.planned, capabilities.filter((capability) => capability.supportLevel === 'planned').length);
  assert.deepEqual(report.readyForSupported, capabilities
    .filter((capability) => capability.supportLevel === 'supported')
    .map((capability) => capability.id)
    .sort());

  assert.ok(report.readyForSupported.includes('distance-sensor-display'));
  assert.equal(
    report.gapsByArtifact.some((gap) => gap.capabilityIds.includes('distance-sensor-display')),
    false,
    'distance-sensor-display should have no remaining promotion gap'
  );

  const sourceClaimsGap = report.gapsByArtifact.find((gap) => gap.artifact === 'source-claims');
  assert.ok(sourceClaimsGap, 'source-claims gap bucket should exist for still-unsupported capabilities');
  assert.ok(
    sourceClaimsGap.details.some((detail) => /autonomous-wireless-robotics|home-security-actuator|high-voltage-load-control/i.test(detail)),
    sourceClaimsGap.details.join(' | ')
  );

  const plannedRecommendations = report.reports
    .filter((entry) => entry.supportLevel === 'planned')
    .map((entry) => entry.recommendedSupportLevel);
  assert.ok(plannedRecommendations.every((recommendation) => recommendation === 'planned'));
});

test('visual library expansion audit keeps non-simulation-ready parts out of the agent-supported surface', async () => {
  const report = await auditVisualLibraryExpansion();

  assert.ok(report.totalVisualParts >= 100, `expected broad visual library, got ${report.totalVisualParts}`);
  assert.equal(report.unmappedPolicy, 'visual-only');
  assert.equal(report.contextKnownCount, report.totalVisualParts);
  assert.deepEqual(report.unrepresentedVisualPartIds, []);
  assert.deepEqual(report.simulationReadyVisualPartIds, report.agentReadyVisualPartIds);
  assert.ok(report.agentReadyMappings.some((mapping) =>
    mapping.visualPartId === 'arduino-uno-r3' && mapping.agentPartId === 'arduino-uno'
  ));
  assert.ok(report.agentReadyMappings.every((mapping) => mapping.agentPartSupportLevel === 'supported'));
  assert.ok(report.contextKnownVisualPartIds.includes('arduino-nano'), 'Arduino Nano is recognized by the context layer');
  assert.ok(report.contextKnownVisualPartIds.includes('dht11'), 'DHT11 is recognized by the context layer');
  assert.ok(report.contextKnownVisualPartIds.includes('ldr-module'), 'LDR module is recognized by the context layer');
  assert.ok(report.contextKnownVisualPartIds.includes('potentiometer'), 'potentiometer is recognized by the context layer');
  assert.equal(report.bySupportTier['pin-known'], 0, 'all visual pin metadata should now be promoted or explicitly blocked');
  assert.equal(
    report.bySupportTier['simulation-ready'] + report.bySupportTier['unsafe-blocked'],
    report.totalVisualParts,
    'every visual library part should have a final simulation-ready or unsafe-blocked tier'
  );
  assert.ok(report.bySupportTier['simulation-ready'] >= 13, 'crosswalk mappings remain simulation-ready');
  assert.ok(report.agentReadyVisualPartIds.includes('esp32-devkit'), 'ESP32 is promoted as controller-board context');
  assert.ok(!report.visualOnlyPartIds.includes('esp32-devkit'), 'ESP32 no longer remains visual-only after WP-08');
  assert.ok(!report.visualOnlyPartIds.includes('potentiometer'), 'potentiometer is now simulation-ready');
  assert.ok(!report.visualOnlyPartIds.includes('ldr-module'), 'LDR module is now simulation-ready');
  assert.ok(!report.visualOnlyPartIds.includes('dht11'), 'DHT11 is now simulation-ready');
  assert.ok(report.agentReadyVisualPartIds.includes('arduino-nano'));
  assert.ok(report.agentReadyVisualPartIds.includes('potentiometer'));
  assert.ok(report.agentReadyVisualPartIds.includes('ldr-module'));
  assert.ok(report.agentReadyVisualPartIds.includes('dht11'));

  const promotionReport = await auditCapabilityPromotionGaps();
  assert.equal(promotionReport.visualLibrary.totalVisualParts, report.totalVisualParts);
  assert.ok(promotionReport.visualLibrary.agentReadyVisualPartIds.includes('esp32-devkit'));
});

test('visual part coverage report assigns every visual part to a final target and work package', async () => {
  const report = await buildVisualPartCoverageReport();
  const packageTotal = report.packageProgress.reduce((sum, pkg) => sum + pkg.totalParts, 0);

  assert.equal(report.totalVisualParts, 132);
  assert.equal(report.explicitTargetStateCount, report.totalVisualParts);
  assert.deepEqual(report.missingTargetStateIds, []);
  assert.deepEqual(report.missingWorkPackageIds, []);
  assert.equal(packageTotal, report.totalVisualParts);
  assert.equal(report.targetStateCounts['simulation-ready'] + report.targetStateCounts['unsafe-blocked'], report.totalVisualParts);
  const wp01 = report.packageProgress.find((pkg) => pkg.packageId === 'WP-01');
  assert.ok(wp01, 'WP-01 package should exist');
  assert.equal(wp01.remainingPartIds.includes('fsr-pressure'), false);
  assert.equal(wp01.remainingPartIds.includes('thermistor-ntc'), false);
  assert.ok(report.packageProgress.some((pkg) =>
    pkg.packageId === 'WP-08'
    && pkg.achievedParts === pkg.totalParts
    && pkg.remainingPartIds.length === 0
  ));

  const mov = report.entries.find((entry) => entry.visualPartId === 'varistor-mov');
  assert.equal(mov?.targetState, 'unsafe-blocked');
  assert.equal(mov?.achieved, true);

  const markdown = renderVisualPartCoverageMarkdown(report);
  assert.match(markdown, /Total visual parts: 132/);
  assert.match(markdown, /WP-01/);
  assert.match(markdown, /target achieved/);
});

test('context coverage distinguishes valid synthesis eligibility from unsafe refusal sufficiency', async () => {
  const packet = await buildContextPacket({
    message: 'Can I wire an Arduino LED directly to a 220V wall outlet?',
    locale: 'en'
  });

  assert.equal(packet.contextCoverage.status, 'insufficient');
  assert.ok(
    packet.contextCoverage.sufficientFor.includes('unsafe_refusal'),
    'unsafe requests should still have enough policy context for a refusal'
  );
  assert.ok(
    packet.contextCoverage.sufficientFor.includes('unsupported_response'),
    'unsafe requests should be sufficient for an unsupported response'
  );
  assert.ok(
    !packet.contextCoverage.sufficientFor.includes('valid_circuit_synthesis'),
    'unsafe requests must not be eligible for circuit synthesis'
  );
});

test('supported circuit requests are eligible for valid circuit synthesis', async () => {
  const packet = await buildContextPacket({
    message: 'Show HELLO on a tiny OLED screen with Arduino Uno and show current flow.',
    locale: 'en'
  });

  assert.equal(packet.contextCoverage.status, 'sufficient');
  assert.ok(packet.contextCoverage.sufficientFor.includes('valid_circuit_synthesis'));
  assert.ok(!packet.contextCoverage.sufficientFor.includes('unsafe_refusal'));
});

test('controller-board context blocks otherwise supported synthesis until circuit substitution evidence is promoted', async () => {
  const packet = await buildContextPacket({
    message: 'Use an Arduino Nano to blink an LED.',
    locale: 'en'
  });

  assert.ok(packet.capabilityMatches.some((capability) => capability.id === 'digital-light-output'));
  assert.ok(packet.capabilityMatches.some((capability) => capability.id === 'controller-board-substitution'));
  assert.ok(packet.supportGaps.some((gap) => /arduino-nano.*controller-board.*selected circuit bundle|arduino-nano.*substitution wiring/i.test(gap)));
  assert.equal(packet.contextCoverage.status, 'insufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'ineligible');
  assert.ok(packet.contextCoverage.sufficientFor.includes('unsupported_response'));
  assert.ok(!packet.contextCoverage.sufficientFor.includes('valid_circuit_synthesis'));
  assert.match(packet.promptBlock, /controller-board|substitution wiring/i);
  assert.match(packet.promptBlock, /arduino-nano/i);
});

test('controller-board circuit overreach is an explicit support gap, not a vague missing-intent prompt', async () => {
  const packet = await buildContextPacket({
    message: 'Build a circuit with ESP32 DevKit and DHT11 temperature and humidity sensor.',
    locale: 'en'
  });

  assert.ok(packet.capabilityMatches.some((capability) => capability.id === 'dht11-temperature-humidity-display'));
  assert.equal(packet.contextRoute.routeId, 'v2-dht11-temperature-humidity-display');
  assert.ok(packet.candidateParts.some((part) => part.id === 'dht11'));
  assert.ok(packet.supportGaps.some((gap) => /esp32-devkit.*controller-board.*selected circuit bundle|esp32-devkit.*substitution wiring/i.test(gap)));
  assert.equal(packet.supportGaps.some((gap) => /pin-known.*dht11|dht11.*simulation-ready/i.test(gap)), false);
  assert.equal(packet.contextCoverage.status, 'insufficient');
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'ineligible');
  assert.ok(packet.contextCoverage.sufficientFor.includes('unsupported_response'));
  assert.ok(!packet.contextCoverage.sufficientFor.includes('valid_circuit_synthesis'));
  assert.ok(packet.intentSpec.ambiguities.some((item) => /esp32-devkit.*substitution wiring/i.test(item)));
});

test('context packet cites selected v2 bundle contracts without loading heavy render catalogs', async () => {
  const packet = await buildContextPacket({
    message: 'Show HELLO on a tiny OLED screen with Arduino Uno and show current flow.',
    locale: 'en'
  });

  assert.equal(packet.contextRoute.routeId, 'v2-display-text-output');
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:display-text-output'));
  assert.ok(packet.retrievalPlan.omittedSourceIds.includes('simulation:primitives'));
  assert.ok(packet.retrievalPlan.omittedSourceIds.includes('rendering:render-footprints'));
  assert.equal(packet.simulationPrimitives.length, 0);
  assert.equal(packet.renderFootprints.length, 0);
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'bundle:display-text-output'));
  assert.match(packet.promptBlock, /Display Text Output/i);
  assert.match(packet.promptBlock, /Simulation primitive contracts/i);
  assert.match(packet.promptBlock, /Render footprint anchors/i);
  assert.doesNotMatch(packet.promptBlock, /"pinAnchors"\s*:/);
});

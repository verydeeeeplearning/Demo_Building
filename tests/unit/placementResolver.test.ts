import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNetlist,
  buildRunnableReport,
  buildSolverGateResult,
  compileRenderPlan,
  compileSimulationPlan,
  detectFaults,
  estimateCurrentPaths
} from '../../server/agent/circuitTools.ts';
import { resolvePlacementLayout } from '../../server/agent/placementResolver.ts';
import type { CircuitSpec } from '../../server/agent/schemas.ts';

function connection(id: string, fromId: string, fromPin: string, toId: string, toPin: string, signal: string) {
  return {
    id,
    from: { componentId: fromId, pin: fromPin },
    to: { componentId: toId, pin: toPin },
    signal
  };
}

function oledCircuitSpec(): CircuitSpec {
  return {
    id: 'placement-oled-text',
    title: 'Placement OLED text display',
    intent: {
      primaryGoal: 'show text on an OLED display',
      output: 'oled-display',
      controller: 'arduino-uno'
    },
    components: [
      { id: 'arduino-uno', partId: 'arduino-uno', label: 'Arduino Uno' },
      { id: 'oled-display', partId: 'oled-i2c-096', label: '0.96 inch I2C OLED' }
    ],
    connections: [
      connection('oled-power', 'arduino-uno', '5V', 'oled-display', 'VCC', 'power'),
      connection('oled-ground', 'arduino-uno', 'GND', 'oled-display', 'GND', 'ground'),
      connection('oled-sda', 'arduino-uno', 'A4/SDA', 'oled-display', 'SDA', 'i2c-data'),
      connection('oled-scl', 'arduino-uno', 'A5/SCL', 'oled-display', 'SCL', 'i2c-clock')
    ],
    behavior: { runText: 'HELLO' },
    assumptions: [],
    unsupportedItems: [],
    clarificationNeeds: []
  };
}

async function compileBaseArtifact(spec = oledCircuitSpec()) {
  const netlist = await buildNetlist(spec);
  const validationReport = await detectFaults(spec, netlist);
  const renderPlan = await compileRenderPlan(spec, validationReport);
  const currentPaths = await estimateCurrentPaths(spec, netlist, validationReport);
  const simulationPlan = await compileSimulationPlan(spec, validationReport, currentPaths, renderPlan);
  const buildReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);
  const solverGateResult = buildSolverGateResult(validationReport, renderPlan, simulationPlan, buildReport);

  return {
    circuitSpec: spec,
    renderPlan,
    validationReport,
    simulationPlan,
    buildRunnableReport: buildReport,
    solverGateResult
  };
}

test('resolvePlacementLayout snaps unsafe drag coordinates and rebuilds render, route, and gate artifacts', async () => {
  const baseArtifact = await compileBaseArtifact();
  const resolution = await resolvePlacementLayout({
    baseRevision: 'base-oled',
    baseArtifact,
    componentId: 'oled-display',
    requestedTransform: {
      position: { x: 100, y: 100, z: 100 }
    },
    coordinateSpace: 'render_world',
    interactionSource: 'student_drag',
    snapPreference: 'nearest_legal'
  });

  assert.equal(resolution.status, 'adjusted_to_nearest_safe');
  assert.equal(resolution.resolutionKind, resolution.status);
  assert.equal(resolution.snapTarget?.surface, 'breadboard');
  assert.notDeepEqual(resolution.adjustedTransform.position, resolution.requestedTransform.position);
  assert.equal(resolution.circuitSpec.components.find((component) => component.id === 'oled-display')?.position?.x, resolution.adjustedTransform.position.x);
  assert.ok(resolution.renderPlan.connections.every((connection) => Array.isArray(connection.route) && connection.route.length >= 2));
  assert.ok(resolution.renderPlan.layout?.camera);
  assert.ok(resolution.solverGateResult);
  assert.ok(resolution.solverGateResult.visibleSimulation);
  assert.ok(resolution.solverAttempts.some((attempt) => attempt.stage === 'placement' && attempt.result === 'repaired'));
  assert.ok(resolution.warnings.some((warning) => /PLACEMENT_SNAPPED/i.test(warning)));
});

test('resolvePlacementLayout rejects drag intents for missing components', async () => {
  const baseArtifact = await compileBaseArtifact();

  await assert.rejects(() => resolvePlacementLayout({
    baseRevision: 'base-oled',
    baseArtifact,
    componentId: 'missing-display',
    requestedTransform: {
      position: { x: 1, y: 0.5, z: 1 }
    },
    coordinateSpace: 'render_world',
    interactionSource: 'student_drag',
    snapPreference: 'nearest_legal'
  }), /not present/i);
});

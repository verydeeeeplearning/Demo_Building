import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import {
  applyWireSelectionHighlight,
  createStageSceneGraph,
  stageRenderKey
} from '../../src/stageScene.js';

// A minimal but structurally complete circuit: stageRenderKey leans on the same
// createStageDebugSnapshot the live stage uses, so the fixture mirrors the parts
// /connections/layout shape real circuits carry.
function makeCircuit(overrides = {}) {
  return {
    id: 'circuit-1',
    parts: [
      { id: 'breadboard', type: 'breadboard', label: 'Breadboard', position: { x: 0, y: 0, z: 0 } },
      { id: 'arduino-uno', type: 'arduino', label: 'Arduino Uno', position: { x: -1.65, y: 0.35, z: 0.02 } },
      { id: 'led-1', type: 'led', label: 'Status LED', position: { x: 0.4, y: 0.35, z: 0.55 } }
    ],
    connections: [
      {
        id: 'oled-power',
        from: { partId: 'arduino-uno', pin: '5V' },
        to: { partId: 'led-1', pin: 'A' },
        route: [
          { x: -0.97, y: 0.68, z: -0.42 },
          { x: 0.07, y: 1.08, z: -0.16 },
          { x: 0.4, y: 0.5, z: 0.55 }
        ]
      }
    ],
    layout: { revision: 'rev-1', endpoints: {} },
    ...overrides
  };
}

function addWireTube(graph, connectionId, { radius = 0.032, emissiveIntensity = 0.12 } = {}) {
  const group = graph.wireGroupFor({ id: connectionId });
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.5, 0.5, 0),
    new THREE.Vector3(1, 0, 0)
  ]);
  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 56, radius, 12),
    new THREE.MeshStandardMaterial({ emissive: '#ffffff', emissiveIntensity })
  );
  mesh.userData.stageGraphRole = 'wire-tube';
  mesh.userData.wireCurve = curve;
  group.add(mesh);
  return mesh;
}

test('stageRenderKey is stable when the circuit is unchanged (chat message → no recreate)', () => {
  const circuit = makeCircuit();
  const first = stageRenderKey(circuit, { visualTransformRevision: 0 });
  const second = stageRenderKey(circuit, { visualTransformRevision: 0 });
  assert.equal(first, second);
  assert.ok(first.length > 0);
});

test('stageRenderKey changes when the circuit identity changes (recreate)', () => {
  const base = makeCircuit();
  const changed = makeCircuit({
    parts: [...base.parts, { id: 'led-2', type: 'led', label: 'Second LED', position: { x: 1.1, y: 0.35, z: 0.2 } }]
  });
  assert.notEqual(
    stageRenderKey(base, { visualTransformRevision: 0 }),
    stageRenderKey(changed, { visualTransformRevision: 0 })
  );
});

test('stageRenderKey changes when only the visual transform revision changes', () => {
  const circuit = makeCircuit();
  assert.notEqual(
    stageRenderKey(circuit, { visualTransformRevision: 0 }),
    stageRenderKey(circuit, { visualTransformRevision: 3 })
  );
});

test('stageRenderKey ignores selection/run/interaction state (those update in place, not recreate)', () => {
  const circuit = makeCircuit();
  const key = stageRenderKey(circuit, { visualTransformRevision: 0 });
  // Extra options that intentionally do NOT participate in the recreate key.
  assert.equal(stageRenderKey(circuit, { visualTransformRevision: 0, running: true, selectedTargetKey: 'connection:oled-power', interactionMode: 'hardware_move' }), key);
});

test('stageRenderKey is empty for a missing circuit', () => {
  assert.equal(stageRenderKey(null), '');
  assert.equal(stageRenderKey(undefined), '');
});

test('applyWireSelectionHighlight thickens and brightens only the selected wire, in place', () => {
  const graph = createStageSceneGraph();
  const selected = addWireTube(graph, 'oled-power');
  const other = addWireTube(graph, 'oled-ground');

  const touched = applyWireSelectionHighlight(graph, 'connection:oled-power');

  assert.equal(touched, 2, 'every wire tube is reconciled');
  assert.equal(selected.material.emissiveIntensity, 0.72);
  assert.equal(selected.geometry.parameters.radius, 0.048);
  assert.equal(other.material.emissiveIntensity, 0.12);
  assert.equal(other.geometry.parameters.radius, 0.032);
});

test('applyWireSelectionHighlight reuses geometry when the selection is unchanged (no per-render rebuild)', () => {
  const graph = createStageSceneGraph();
  const wire = addWireTube(graph, 'oled-power');

  applyWireSelectionHighlight(graph, 'connection:oled-power');
  const geometryAfterFirst = wire.geometry;
  // A second call with the SAME selection (what the in-place render path does on
  // every chat message) must NOT dispose+rebuild the tube geometry.
  applyWireSelectionHighlight(graph, 'connection:oled-power');

  assert.equal(wire.geometry, geometryAfterFirst, 'geometry object identity is preserved when selection is unchanged');
  assert.equal(wire.geometry.parameters.radius, 0.048);
});

test('applyWireSelectionHighlight clears the highlight when nothing is selected', () => {
  const graph = createStageSceneGraph();
  const wire = addWireTube(graph, 'oled-power');

  applyWireSelectionHighlight(graph, 'connection:oled-power');
  applyWireSelectionHighlight(graph, '');

  assert.equal(wire.material.emissiveIntensity, 0.12);
  assert.equal(wire.geometry.parameters.radius, 0.032);
});

test('applyWireSelectionHighlight is a no-op for groups without a wire-tube child', () => {
  const graph = createStageSceneGraph();
  // A bare wire group (connectors only, no tube) must not throw.
  graph.wireGroupFor({ id: 'oled-power' });
  assert.equal(applyWireSelectionHighlight(graph, 'connection:oled-power'), 0);
});

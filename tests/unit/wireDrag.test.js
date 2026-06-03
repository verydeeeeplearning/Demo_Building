/**
 * Phase 3 RED tests — draggable wire bend points.
 *
 * 3.1 Route-edit math: inserting midpoints, clamping to >=2 points.
 * 3.2 Geometry+material disposal: rebuilding a tube disposes prior geometry AND material.
 * 3.3 Route persistence: committed route survives a render round-trip in connection.route[].
 *
 * These tests import pure functions from a new server/agent/circuit module
 * that holds the domain math (no Three.js, no I/O).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ensureMinRoutePoints,
  rebuildWireTubeMesh,
  stageConnectionRoutePoints
} from '../../src/stageScene.js';

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// 3.1 — Route-edit math
// ---------------------------------------------------------------------------

test('3.1a ensureMinRoutePoints returns the same array when length >= 2', () => {
  const from = new THREE.Vector3(0, 0, 0);
  const to = new THREE.Vector3(1, 0, 0);
  const route = [from, new THREE.Vector3(0.5, 0.5, 0), to];
  const result = ensureMinRoutePoints(route, from, to);
  assert.equal(result.length, 3, 'three-point route is returned as-is');
  assert.equal(result, route, 'same array reference when already valid');
});

test('3.1b ensureMinRoutePoints with exactly 2 points returns 2 points unchanged', () => {
  const from = new THREE.Vector3(0, 0, 0);
  const to = new THREE.Vector3(1, 0, 0);
  const route = [from, to];
  const result = ensureMinRoutePoints(route, from, to);
  assert.equal(result.length, 2);
});

test('3.1c ensureMinRoutePoints inserts a midpoint when route is empty', () => {
  const from = new THREE.Vector3(0, 0, 0);
  const to = new THREE.Vector3(2, 0, 0);
  const result = ensureMinRoutePoints([], from, to);
  assert.ok(result.length >= 2, 'at least 2 points produced');
  // The first point must be near `from` and the last near `to`
  assert.ok(result[0].distanceTo(from) < 0.01, 'first point near from');
  assert.ok(result.at(-1).distanceTo(to) < 0.01, 'last point near to');
});

test('3.1d ensureMinRoutePoints inserts a midpoint when route has only 1 point', () => {
  const from = new THREE.Vector3(-1, 0, 0);
  const to = new THREE.Vector3(1, 0, 0);
  const result = ensureMinRoutePoints([from], from, to);
  assert.ok(result.length >= 2, `expected >= 2 points, got ${result.length}`);
});

// ---------------------------------------------------------------------------
// 3.2 — Geometry + material disposal
// ---------------------------------------------------------------------------

test('3.2a rebuildWireTubeMesh disposes the prior geometry', () => {
  const oldGeo = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3([new THREE.Vector3(0,0,0), new THREE.Vector3(1,0,0), new THREE.Vector3(2,0,0)]),
    56, 0.032, 12
  );
  const oldMat = new THREE.MeshStandardMaterial({ color: '#ff0000' });
  const mesh = new THREE.Mesh(oldGeo, oldMat);

  let geoDisposed = false;
  let matDisposed = false;
  oldGeo.dispose = () => { geoDisposed = true; };
  oldMat.dispose = () => { matDisposed = true; };

  const newPoints = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.5, 0.5, 0),
    new THREE.Vector3(1, 0, 0)
  ];
  rebuildWireTubeMesh(mesh, newPoints, { color: '#ff0000', radius: 0.032, emissiveIntensity: 0.12 });

  assert.ok(geoDisposed, 'prior geometry must be disposed');
  assert.ok(matDisposed, 'prior material must be disposed');
});

test('3.2b rebuildWireTubeMesh replaces mesh geometry and material with new instances', () => {
  const oldGeo = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3([new THREE.Vector3(0,0,0), new THREE.Vector3(1,0,0), new THREE.Vector3(2,0,0)]),
    56, 0.032, 12
  );
  const oldMat = new THREE.MeshStandardMaterial({ color: '#ff0000' });
  const mesh = new THREE.Mesh(oldGeo, oldMat);

  // Suppress real dispose so we can check identity
  oldGeo.dispose = () => {};
  oldMat.dispose = () => {};

  const newPoints = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.5, 0.8, 0),
    new THREE.Vector3(1, 0, 0)
  ];
  rebuildWireTubeMesh(mesh, newPoints, { color: '#ff0000', radius: 0.032, emissiveIntensity: 0.12 });

  assert.notEqual(mesh.geometry, oldGeo, 'geometry is a new instance');
  assert.notEqual(mesh.material, oldMat, 'material is a new instance');
  assert.ok(mesh.geometry instanceof THREE.TubeGeometry, 'new geometry is TubeGeometry');
  assert.ok(mesh.material instanceof THREE.MeshStandardMaterial, 'new material is MeshStandardMaterial');
});

// ---------------------------------------------------------------------------
// 3.3 — Route persistence round-trip
// ---------------------------------------------------------------------------

test('3.3 committed route points are stored in connection.route[] and survive a reference check', () => {
  // Simulate the commit step: connection.route[] is mutated with the new points.
  const connection = {
    id: 'test-wire',
    from: { partId: 'a', pin: 'P1' },
    to: { partId: 'b', pin: 'P2' },
    route: []
  };

  const newRoute = [
    { x: 0, y: 0, z: 0 },
    { x: 0.5, y: 0.8, z: 0 },
    { x: 1, y: 0, z: 0 }
  ];

  // The commit step writes serializable plain objects into connection.route[]
  connection.route = newRoute.map((p) => ({ x: p.x, y: p.y, z: p.z }));

  assert.equal(connection.route.length, 3, 'route has 3 points after commit');
  assert.equal(connection.route[1].y, 0.8, 'midpoint y-coordinate preserved');

  // Simulate a reload: stageConnectionRoutePoints reads connection.route
  // with length >= 2 and returns THREE.Vector3 instances
  const from = new THREE.Vector3(0, 0, 0);
  const to = new THREE.Vector3(1, 0, 0);
  const restored = stageConnectionRoutePoints(connection, from, to, 0);

  assert.equal(restored.length, 3, 'restored route has 3 points');
  assert.ok(Math.abs(restored[1].y - 0.8) < 0.001, 'midpoint y preserved through stageConnectionRoutePoints');
});

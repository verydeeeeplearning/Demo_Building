import assert from 'node:assert/strict';
import { test } from 'node:test';

// Phase 3 (RC-D): a valid LARGE multi-part scene was falsely blocked by
// SIMULATION_BLOCKED_BY_RENDER_DRC: CAMERA_CLIPPING. compileCameraFit clamps the fitted distance to
// a max of 40, but auditRenderCameraFit requires distance >= (radius / sin(fov/2)) * 1.03 ~= 3.16 *
// radius. For radius > ~12.6 the required distance exceeds 40, so the clamp guarantees a false clip.
// The fix raises the clamp ceiling so it never cuts below the radius-driven framing — a NO-OP for
// every small scene (desiredDistance < 40), only helping large scenes.
import { auditRenderCameraFit, compileCameraFit } from '../../server/agent/circuitTools.ts';

type Bounds = {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  center: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  radius: number;
};

function boundsWithSize(sx: number, sy: number, sz: number): Bounds {
  const size = { x: sx, y: sy, z: sz };
  const min = { x: -sx / 2, y: 0, z: -sz / 2 };
  const max = { x: sx / 2, y: sy, z: sz / 2 };
  const center = { x: 0, y: sy / 2, z: 0 };
  const radius = Math.sqrt(sx ** 2 + sy ** 2 + sz ** 2) / 2;
  return { min, max, center, size, radius };
}

function fittedDistance(bounds: Bounds): number {
  const camera = compileCameraFit(bounds);
  return Math.hypot(
    camera.position.x - camera.target.x,
    camera.position.y - camera.target.y,
    camera.position.z - camera.target.z
  );
}

void test('RC-D: a small scene fits with NO camera clipping (unchanged behavior)', () => {
  const bounds = boundsWithSize(4, 2, 4); // radius ~3
  const camera = compileCameraFit(bounds);
  assert.deepEqual(auditRenderCameraFit(bounds, camera), [], 'small scene must not clip');
  assert.ok(fittedDistance(bounds) <= 40, 'small-scene distance stays within the original clamp');
});

void test('RC-D: a LARGE valid scene (radius ~16) is NOT falsely blocked by CAMERA_CLIPPING', () => {
  const bounds = boundsWithSize(26, 4, 18); // radius ~15.9, above the ~12.6 break point
  assert.ok(bounds.radius > 12.7, 'precondition: radius exceeds the old clamp break point');
  const camera = compileCameraFit(bounds);
  assert.deepEqual(
    auditRenderCameraFit(bounds, camera),
    [],
    'a large but valid scene must frame without a false CAMERA_CLIPPING block'
  );
});

void test('RC-D: fitted distance scales past 40 for large scenes (clamp no longer caps framing)', () => {
  assert.ok(fittedDistance(boundsWithSize(26, 4, 18)) > 40, 'large scene distance must exceed the old 40 cap');
});

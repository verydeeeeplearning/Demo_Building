// Renders part-library entries to thumbnails using real three.js geometry.
//
// A single shared offscreen WebGLRenderer is reused for every thumbnail so we
// never spin up 100 WebGL contexts. Each part's `model` recipe is turned into a
// THREE.Group, framed by its bounding box, lit, rendered once, and exported as a
// PNG data URL. If WebGL is unavailable the renderer degrades to a 2D isometric
// fallback so the UI still shows a distinct image per part.
//
// Recipe schema (src/partLibraryData.js conforms to this):
//   model: {
//     kind: 'board'|'module'|'display'|'chip'|'cylinder'|'dome'|'motor'
//          |'passive-axial'|'connector'|'sensor'|'breadboard'|'sphere',
//     size: [width, height, depth],     // bounding dimensions in scene units
//     colors: { body, accent, detail }  // hex strings
//   }

import * as THREE from 'three';

const THUMB_WIDTH = 168;
const THUMB_HEIGHT = 124;
const STAGE_BG = '#06231e';

let shared = null;

function getSharedRenderer() {
  if (shared) {
    return shared;
  }

  const canvas = document.createElement('canvas');
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;

  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true
    });
    renderer.setPixelRatio(1);
    renderer.setSize(THUMB_WIDTH, THUMB_HEIGHT, false);
  } catch (error) {
    shared = { renderer: null, canvas };
    return shared;
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(STAGE_BG);

  const camera = new THREE.PerspectiveCamera(34, THUMB_WIDTH / THUMB_HEIGHT, 0.1, 100);

  const ambient = new THREE.AmbientLight('#ffffff', 1.15);
  scene.add(ambient);
  const key = new THREE.DirectionalLight('#fff6e8', 2.1);
  key.position.set(3, 6, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#9fe7d6', 0.8);
  rim.position.set(-4, 2, -3);
  scene.add(rim);

  shared = { renderer, canvas, scene, camera };
  return shared;
}

const KIND_BUILDERS = {
  board: buildBoard,
  module: buildModule,
  display: buildDisplay,
  chip: buildChip,
  cylinder: buildCylinder,
  dome: buildDome,
  motor: buildMotor,
  'passive-axial': buildPassiveAxial,
  connector: buildConnector,
  sensor: buildSensor,
  breadboard: buildBreadboard,
  sphere: buildSphere
};

function resolveColors(model = {}) {
  const colors = model.colors || {};
  return {
    body: colors.body || '#3a7d6a',
    accent: colors.accent || '#ff7759',
    detail: colors.detail || '#17171c'
  };
}

function stdMaterial(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.12, ...extra });
}

// Builds a THREE.Group for a part recipe; the thumbnail path uses it internally.
function buildPartObject(part) {
  const model = part?.model || {};
  const builder = KIND_BUILDERS[model.kind] || buildModule;
  const size = Array.isArray(model.size) && model.size.length === 3 ? model.size : [1, 0.4, 0.7];
  const group = builder({ size, colors: resolveColors(model) });
  group.userData.partId = part?.id;
  return group;
}

export function renderThumbnail(part) {
  const ctx = getSharedRenderer();
  if (!ctx.renderer) {
    return render2dFallback(part);
  }

  const { renderer, scene, camera } = ctx;
  const group = buildPartObject(part);
  scene.add(group);

  frameCamera(camera, group);

  try {
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    cleanup(scene, group);
    return url;
  } catch (error) {
    cleanup(scene, group);
    return render2dFallback(part);
  }
}

function cleanup(scene, group) {
  scene.remove(group);
  group.traverse((node) => {
    if (node.geometry) {
      node.geometry.dispose();
    }
    if (node.material) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => material.dispose());
    }
  });
}

function frameCamera(camera, group) {
  const box = new THREE.Box3().setFromObject(group);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 0.4);
  const distance = radius / Math.sin((camera.fov * Math.PI) / 360);
  const dir = new THREE.Vector3(0.85, 0.72, 1).normalize();
  camera.position.copy(sphere.center.clone().add(dir.multiplyScalar(distance * 1.18)));
  camera.lookAt(sphere.center);
  camera.updateProjectionMatrix();
}

// --- geometry builders ---------------------------------------------------

function buildBoard({ size, colors }) {
  const group = new THREE.Group();
  const [w, h, d] = size;
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMaterial(colors.body, { roughness: 0.6 }));
  group.add(board);

  const chip = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.28, h * 0.7, d * 0.32),
    stdMaterial(colors.detail, { roughness: 0.7 })
  );
  chip.position.set(-w * 0.12, h * 0.65, 0);
  group.add(chip);

  addHeader(group, colors.detail, w * 0.74, h, d * 0.42, 8);
  addHeader(group, colors.detail, w * 0.74, h, -d * 0.42, 8);

  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.5, h * 0.12, d * 0.08),
    stdMaterial(colors.accent, { emissive: colors.accent, emissiveIntensity: 0.25 })
  );
  strip.position.set(w * 0.22, h * 0.6, d * 0.2);
  group.add(strip);
  return group;
}

function buildModule({ size, colors }) {
  const group = new THREE.Group();
  const [w, h, d] = size;
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMaterial(colors.body));
  group.add(board);

  const blob = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.46, h * 1.1, d * 0.46),
    stdMaterial(colors.detail, { roughness: 0.5 })
  );
  blob.position.set(0, h * 0.8, 0);
  group.add(blob);

  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(Math.min(w, d) * 0.12, 18, 14),
    stdMaterial(colors.accent, { emissive: colors.accent, emissiveIntensity: 0.4 })
  );
  dot.position.set(w * 0.28, h * 0.7, d * 0.2);
  group.add(dot);

  addHeader(group, colors.detail, w * 0.7, h, -d * 0.42, 6);
  return group;
}

function buildDisplay({ size, colors }) {
  const group = new THREE.Group();
  const [w, h, d] = size;
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMaterial(colors.body, { roughness: 0.5 }));
  group.add(board);

  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.78, h * 0.5, d * 0.66),
    new THREE.MeshStandardMaterial({
      color: colors.accent,
      emissive: colors.accent,
      emissiveIntensity: 0.7,
      roughness: 0.3
    })
  );
  screen.position.set(0, h * 0.55, 0);
  group.add(screen);

  addHeader(group, colors.detail, w * 0.6, h, -d * 0.42, 4);
  return group;
}

function buildChip({ size, colors }) {
  const group = new THREE.Group();
  const [w, h, d] = size;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMaterial(colors.detail, { roughness: 0.65 }));
  group.add(body);

  const notch = new THREE.Mesh(
    new THREE.CylinderGeometry(Math.min(w, d) * 0.1, Math.min(w, d) * 0.1, h * 1.05, 16),
    stdMaterial(colors.accent)
  );
  notch.position.set(-w * 0.32, 0, -d * 0.3);
  group.add(notch);

  const legMat = stdMaterial('#c9ccd2', { metalness: 0.6, roughness: 0.3 });
  const count = 5;
  for (let i = 0; i < count; i += 1) {
    const x = -w * 0.34 + (i * (w * 0.68)) / (count - 1);
    for (const z of [d * 0.6, -d * 0.6]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(w * 0.08, h * 0.5, d * 0.18), legMat);
      leg.position.set(x, -h * 0.5, z);
      group.add(leg);
    }
  }
  return group;
}

function buildCylinder({ size, colors }) {
  const group = new THREE.Group();
  const [w, h, d] = size;
  const radius = Math.min(w, d) * 0.5;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, h, 28),
    stdMaterial(colors.body, { metalness: 0.3, roughness: 0.4 })
  );
  group.add(body);

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.02, radius * 1.02, h * 0.12, 28),
    stdMaterial(colors.accent)
  );
  cap.position.y = h * 0.5;
  group.add(cap);

  const legMat = stdMaterial('#c9ccd2', { metalness: 0.6, roughness: 0.3 });
  for (const x of [-radius * 0.4, radius * 0.4]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.08, radius * 0.08, h * 0.5, 10), legMat);
    leg.position.set(x, -h * 0.7, 0);
    group.add(leg);
  }
  return group;
}

function buildDome({ size, colors }) {
  const group = new THREE.Group();
  const [w, h] = size;
  const radius = w * 0.5;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, h * 0.5, 24),
    new THREE.MeshStandardMaterial({ color: colors.accent, transparent: true, opacity: 0.85, roughness: 0.25 })
  );
  group.add(body);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: colors.accent,
      emissive: colors.accent,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.9
    })
  );
  dome.position.y = h * 0.25;
  group.add(dome);

  const legMat = stdMaterial('#c9ccd2', { metalness: 0.6, roughness: 0.3 });
  for (const x of [-radius * 0.4, radius * 0.4]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.07, radius * 0.07, h * 0.7, 8), legMat);
    leg.position.set(x, -h * 0.55, 0);
    group.add(leg);
  }
  return group;
}

function buildMotor({ size, colors }) {
  const group = new THREE.Group();
  const [w, h, d] = size;
  const radius = Math.min(h, d) * 0.5;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, w, 28),
    stdMaterial(colors.body, { metalness: 0.45, roughness: 0.35 })
  );
  body.rotation.z = Math.PI / 2;
  group.add(body);

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.16, radius * 0.16, w * 0.5, 16),
    stdMaterial(colors.detail, { metalness: 0.6 })
  );
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = w * 0.7;
  group.add(shaft);

  const tab = new THREE.Mesh(new THREE.BoxGeometry(w * 0.2, h * 0.2, d * 1.05), stdMaterial(colors.accent));
  tab.position.x = -w * 0.45;
  group.add(tab);
  return group;
}

function buildPassiveAxial({ size, colors }) {
  const group = new THREE.Group();
  const [w, h, d] = size;
  const radius = Math.min(h, d) * 0.5;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, w * 0.6, 20),
    stdMaterial(colors.body, { roughness: 0.45 })
  );
  body.rotation.z = Math.PI / 2;
  group.add(body);

  for (const sign of [-1, 1]) {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 1.05, radius * 1.05, w * 0.05, 20),
      stdMaterial(colors.accent)
    );
    band.rotation.z = Math.PI / 2;
    band.position.x = sign * w * 0.12;
    group.add(band);
  }

  const leadMat = stdMaterial('#c9ccd2', { metalness: 0.6, roughness: 0.3 });
  for (const sign of [-1, 1]) {
    const lead = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.18, radius * 0.18, w * 0.4, 10), leadMat);
    lead.rotation.z = Math.PI / 2;
    lead.position.x = sign * w * 0.5;
    group.add(lead);
  }
  return group;
}

function buildConnector({ size, colors }) {
  const group = new THREE.Group();
  const [w, h, d] = size;
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMaterial(colors.detail, { roughness: 0.7 }));
  group.add(base);

  const pinMat = stdMaterial('#d8b85a', { metalness: 0.7, roughness: 0.25 });
  const count = 6;
  for (let i = 0; i < count; i += 1) {
    const x = -w * 0.4 + (i * (w * 0.8)) / (count - 1);
    const pin = new THREE.Mesh(new THREE.BoxGeometry(w * 0.06, h * 1.4, d * 0.2), pinMat);
    pin.position.set(x, h * 0.6, 0);
    group.add(pin);
  }

  const tab = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, h * 0.2, d * 0.2), stdMaterial(colors.accent));
  tab.position.set(0, -h * 0.3, d * 0.5);
  group.add(tab);
  return group;
}

function buildSensor({ size, colors }) {
  const group = new THREE.Group();
  const [w, h, d] = size;
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMaterial(colors.body));
  group.add(board);

  const eye = new THREE.Mesh(
    new THREE.CylinderGeometry(Math.min(w, d) * 0.26, Math.min(w, d) * 0.3, h * 1.4, 24),
    stdMaterial(colors.detail, { roughness: 0.4 })
  );
  eye.position.set(0, h * 0.9, 0);
  group.add(eye);

  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(Math.min(w, d) * 0.24, 20, 14),
    new THREE.MeshStandardMaterial({ color: colors.accent, emissive: colors.accent, emissiveIntensity: 0.5 })
  );
  lens.position.set(0, h * 1.5, 0);
  group.add(lens);

  addHeader(group, colors.detail, w * 0.7, h, -d * 0.42, 4);
  return group;
}

function buildBreadboard({ size, colors }) {
  const group = new THREE.Group();
  const [w, h, d] = size;
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMaterial(colors.body, { roughness: 0.85 }));
  group.add(board);

  const holeMat = stdMaterial(colors.detail);
  for (let xi = -3; xi <= 3; xi += 1) {
    for (let zi = -1; zi <= 1; zi += 1) {
      const hole = new THREE.Mesh(new THREE.BoxGeometry(w * 0.04, h * 0.4, d * 0.04), holeMat);
      hole.position.set((xi * w) / 8, h * 0.55, (zi * d) / 4);
      group.add(hole);
    }
  }

  for (const z of [-d * 0.45, d * 0.45]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, h * 0.1, d * 0.04), stdMaterial(colors.accent));
    rail.position.set(0, h * 0.55, z);
    group.add(rail);
  }
  return group;
}

function buildSphere({ size, colors }) {
  const group = new THREE.Group();
  const radius = Math.max(...size) * 0.5;
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 26, 18),
    stdMaterial(colors.body, { roughness: 0.4 })
  );
  group.add(body);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 1.05, radius * 0.12, 14, 30),
    stdMaterial(colors.accent)
  );
  ring.rotation.x = Math.PI / 2.3;
  group.add(ring);
  return group;
}

function addHeader(group, color, width, height, z, count) {
  const pinMat = stdMaterial(color, { metalness: 0.4, roughness: 0.4 });
  for (let i = 0; i < count; i += 1) {
    const x = -width * 0.5 + (i * width) / Math.max(count - 1, 1);
    const pin = new THREE.Mesh(new THREE.BoxGeometry(width * 0.05, height * 0.5, width * 0.05), pinMat);
    pin.position.set(x, height * 0.4, z);
    group.add(pin);
  }
}

// --- 2D fallback ---------------------------------------------------------

function render2dFallback(part) {
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;
  const context = canvas.getContext('2d');
  const { body, accent, detail } = resolveColors(part?.model);

  context.fillStyle = STAGE_BG;
  context.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);

  const cx = THUMB_WIDTH / 2;
  const cy = THUMB_HEIGHT / 2 + 8;
  const top = [
    [cx - 44, cy - 6],
    [cx + 8, cy - 30],
    [cx + 52, cy - 6],
    [cx, cy + 18]
  ];
  context.fillStyle = body;
  context.beginPath();
  top.forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
  context.closePath();
  context.fill();

  context.fillStyle = detail;
  context.fillRect(cx - 16, cy - 12, 26, 12);
  context.fillStyle = accent;
  context.beginPath();
  context.arc(cx + 22, cy - 4, 5, 0, Math.PI * 2);
  context.fill();

  return canvas.toDataURL('image/png');
}

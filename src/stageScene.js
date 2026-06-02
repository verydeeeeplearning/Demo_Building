import * as THREE from 'three';

export const CURRENT_PATH_STYLES = {
  'load-current': { color: 0xffc857, pulse: true },
  'supply-current': { color: 0x5ce1e6, pulse: true },
  'signal-activity': { color: 0x9bd67d, pulse: false },
  'bus-activity': { color: 0x84a9ff, pulse: false },
  'sensing-divider': { color: 0xf2a65a, pulse: true },
  'fault-current': { color: 0xff4d4d, pulse: true }
};

export function createStageScene(container, circuit, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.dataset.testid = 'stage-canvas';
  canvas.className = 'stage-canvas';
  container.append(canvas);

  try {
    return createThreeScene(container, canvas, circuit, options);
  } catch (error) {
    return createCanvasFallback(container, canvas, circuit, options);
  }
}

function createThreeScene(container, canvas, circuit, options) {
  let running = Boolean(options.running);
  let animationFrame = 0;
  const selectedTargetKey = options.selectedTargetKey || '';
  canvas.dataset.renderer = 'three';
  canvas.dataset.selectedTarget = selectedTargetKey;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#003c33');
  scene.fog = new THREE.Fog('#003c33', 8, 17);
  // Procedural reflection environment so the metallic solder and pins actually
  // catch light. Built from three core only (no example imports), guarded so a
  // failure just leaves metals matte instead of breaking the whole scene.
  applyStudioEnvironment(renderer, scene);

  const cameraFit = stageCameraFit(circuit);
  const camera = new THREE.PerspectiveCamera(cameraFit?.fov ?? 38, 1, 0.1, 80);
  const cameraTarget = new THREE.Vector3(0, 0, 0);
  const zoomRange = { min: 4, max: 9 };
  camera.position.set(4.8, 4.2, 5.2);
  applyStageCameraFit(camera, cameraTarget, zoomRange, cameraFit);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  const root = new THREE.Group();
  scene.add(root);

  const ambient = new THREE.AmbientLight('#ffffff', 1.3);
  scene.add(ambient);

  const key = new THREE.DirectionalLight('#fff6e8', 2.2);
  key.position.set(3, 7, 4);
  key.castShadow = true;
  scene.add(key);

  const runGlow = new THREE.PointLight('#ff7759', running ? 2.2 : 0, 6);
  runGlow.position.set(1.7, 1.1, -0.2);
  scene.add(runGlow);

  const grid = new THREE.GridHelper(12, 24, '#276d5f', '#0f554a');
  grid.position.y = -0.02;
  root.add(grid);

  const stats = { solder: 0, connectors: 0 };
  const specializedParts = stageSpecializedPartDescriptors(circuit);
  if (specializedParts.breadboard) addBreadboard(root, stats, specializedParts.breadboard);
  if (specializedParts.arduino) addArduino(root, stats, specializedParts.arduino);
  const oledTexture = specializedParts.oled ? createOledTexture(running ? circuit.runText : 'READY') : null;
  if (oledTexture) addOled(root, oledTexture, stats, specializedParts.oled);
  const genericParts = addGenericRenderPlanParts(root, circuit, stats);
  const libraryParts = addLibraryModels(root, circuit, stats);

  const wireCurves = addWires(root, circuit, stats, selectedTargetKey);
  const currentPathDescriptors = stageCurrentPathDescriptors(circuit);
  const animatedWireCurves = stageAnimatedWireDescriptors(circuit, wireCurves, currentPathDescriptors);
  const signalDots = animatedWireCurves.map(({ curve, color, pathDescriptor }, index) => {
    const pathStyle = pathDescriptor?.style;
    const dotColor = pathStyle?.color ?? color;
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 16, 12),
      new THREE.MeshStandardMaterial({ color: dotColor, emissive: dotColor, emissiveIntensity: 1.2 })
    );
    dot.visible = running;
    dot.userData.curve = curve;
    dot.userData.pathStyle = pathStyle ?? CURRENT_PATH_STYLES['load-current'];
    dot.userData.pathSpeed = pathDescriptor?.animation?.speed ?? 1;
    root.add(dot);
    return dot;
  });

  canvas.dataset.solderCount = String(stats.solder);
  canvas.dataset.connectorCount = String(stats.connectors);
  canvas.dataset.genericPartCount = String(genericParts.length);
  canvas.dataset.libraryPartCount = String(libraryParts.length);
  canvas.dataset.cameraFit = cameraFit ? 'server' : 'fallback';
  canvas.dataset.cameraTarget = `${cameraTarget.x.toFixed(2)},${cameraTarget.y.toFixed(2)},${cameraTarget.z.toFixed(2)}`;
  canvas.dataset.cameraDistance = camera.position.distanceTo(cameraTarget).toFixed(2);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  let dragging = false;
  let lastX = 0;
  let dragDistance = 0;
  let targetRotation = 0;
  let hoveredTargetKey = '';

  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastX = event.clientX;
    dragDistance = 0;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) {
      updateHover(event);
      return;
    }
    targetRotation += (event.clientX - lastX) * 0.006;
    dragDistance += Math.abs(event.clientX - lastX);
    lastX = event.clientX;
  });
  canvas.addEventListener('pointerup', () => {
    dragging = false;
  });
  canvas.addEventListener('pointerleave', () => {
    setHoveredTarget(null);
  });
  canvas.addEventListener('click', (event) => {
    if (dragDistance > 4) {
      return;
    }
    const target = findInspectTarget(event);
    if (target) {
      options.onSelectTarget?.(target);
    }
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    camera.position
      .sub(cameraTarget)
      .multiplyScalar(event.deltaY > 0 ? 1.06 : 0.94)
      .clampLength(zoomRange.min, zoomRange.max)
      .add(cameraTarget);
    camera.lookAt(cameraTarget);
  }, { passive: false });

  function animate(time = 0) {
    root.rotation.y += (targetRotation - root.rotation.y) * 0.08;
    signalDots.forEach((dot, index) => {
      dot.visible = running;
      if (running) {
        const speed = dot.userData.pathSpeed ?? 1;
        const shouldPulse = dot.userData.pathStyle?.pulse !== false;
        const phase = shouldPulse ? index * 0.18 : index * 0.08;
        const t = ((time * 0.00045 * speed) + phase) % 1;
        dot.position.copy(dot.userData.curve.getPointAt(t));
      }
    });
    runGlow.intensity = running ? 1.8 + Math.sin(time * 0.006) * 0.4 : 0;
    renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(animate);
  }
  animate();

  return {
    run() {
      running = true;
      if (oledTexture) {
        drawOledTexture(oledTexture.image, circuit.runText);
        oledTexture.needsUpdate = true;
      }
    },
    dispose() {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      // Free per-build GPU resources (geometries, per-build materials + their
      // textures, and the generated environment map) so repeated PCB mounts do
      // not leak. The module-level shared materials are reused across mounts, so
      // they must NOT be disposed here.
      scene.traverse((object) => {
        object.geometry?.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : object.material ? [object.material] : [];
        for (const material of materials) {
          if (SHARED_MATERIALS.has(material)) {
            continue;
          }
          material.map?.dispose();
          material.dispose();
        }
      });
      scene.environment?.dispose();
      renderer.dispose();
      canvas.remove();
    }
  };

  function resize() {
    const bounds = container.getBoundingClientRect();
    const width = Math.max(320, Math.floor(bounds.width));
    const height = Math.max(360, Math.floor(bounds.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    canvas.dataset.renderReady = 'true';
  }

  function updateHover(event) {
    setHoveredTarget(findInspectTarget(event));
  }

  function setHoveredTarget(target) {
    const key = targetKey(target);
    if (key === hoveredTargetKey) {
      return;
    }
    hoveredTargetKey = key;
    canvas.dataset.hoverTarget = key;
    canvas.classList.toggle('is-hovering-circuit', Boolean(target));
    options.onHoverTarget?.(target);
  }

  function findInspectTarget(event) {
    const bounds = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    for (const hit of raycaster.intersectObjects(root.children, true)) {
      let object = hit.object;
      while (object) {
        if (object.userData?.inspectTarget) {
          return object.userData.inspectTarget;
        }
        object = object.parent;
      }
    }
    return null;
  }

  function targetKey(target) {
    if (!target) {
      return '';
    }
    return `${target.type}:${target.connectionId || target.partId || target.id || ''}`;
  }
}

// Shared metallic materials so solder beads, pins, and ferrules read as the same
// real materials across the scene and reflect the procedural environment.
const SOLDER_MAT = new THREE.MeshStandardMaterial({ color: '#c7ccd3', metalness: 0.95, roughness: 0.26 });
const PIN_METAL_MAT = new THREE.MeshStandardMaterial({ color: '#d9b35a', metalness: 0.92, roughness: 0.3 });
const HEADER_PLASTIC_MAT = new THREE.MeshStandardMaterial({ color: '#0b0b0e', roughness: 0.82, metalness: 0.05 });
const RAIL_CONTACT_MAT = new THREE.MeshStandardMaterial({ color: '#c0a14a', metalness: 0.85, roughness: 0.38 });
// Reused across every scene rebuild, so dispose() must skip these.
const SHARED_MATERIALS = new Set([SOLDER_MAT, PIN_METAL_MAT, HEADER_PLASTIC_MAT, RAIL_CONTACT_MAT]);

function tagInspectable(object, target) {
  if (target) {
    object.userData.inspectTarget = target;
  }
  return object;
}

// A squashed metallic dome, the shape of a solder fillet around a lead. Tracked
// in stats so the scene can report how many joints it placed.
function addSolderJoint(root, position, radius, stats) {
  const joint = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
    SOLDER_MAT
  );
  joint.position.set(position.x, position.y, position.z);
  joint.scale.y = 0.6;
  joint.castShadow = true;
  root.add(joint);
  stats.solder += 1;
  return joint;
}

function addBreadboard(root, stats, descriptor) {
  const base = descriptor.position;
  const target = { type: 'part', partId: descriptor.id, id: descriptor.id, label: descriptor.label };
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(5.6, 0.18, 2.15),
    new THREE.MeshStandardMaterial({ color: '#eeece7', roughness: 0.75 })
  );
  tagInspectable(board, target);
  board.position.set(base.x, base.y + 0.12, base.z);
  board.castShadow = true;
  board.receiveShadow = true;
  root.add(board);

  addRail(root, '#ff4d3d', -0.82, stats, base);
  addRail(root, '#1863dc', 0.82, stats, base);

  const holeGeometry = new THREE.CylinderGeometry(0.025, 0.025, 0.012, 12);
  const holeMaterial = new THREE.MeshBasicMaterial({ color: '#57534f' });
  for (let x = -2.45; x <= 2.46; x += 0.28) {
    for (const z of [-0.42, -0.22, 0.22, 0.42]) {
      const hole = new THREE.Mesh(holeGeometry, holeMaterial);
      tagInspectable(hole, target);
      hole.rotation.x = Math.PI / 2;
      hole.position.set(base.x + x, base.y + 0.22, base.z + z);
      root.add(hole);
    }
  }
  addDescriptorLabel(root, descriptor, 'Breadboard', [base.x, base.y + 0.34, base.z], 0.7);
}

function addRail(root, color, z, stats, base) {
  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(5.15, 0.025, 0.035),
    new THREE.MeshBasicMaterial({ color })
  );
  rail.position.set(base.x, base.y + 0.23, base.z + z);
  root.add(rail);

  // Plated contact points along the power rail with a solder bead each.
  const contactGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.02, 10);
  for (let x = -2.2; x <= 2.21; x += 0.74) {
    const contact = new THREE.Mesh(contactGeometry, RAIL_CONTACT_MAT);
    contact.position.set(base.x + x, base.y + 0.235, base.z + z);
    root.add(contact);
    addSolderJoint(root, { x: base.x + x, y: base.y + 0.232, z: base.z + z }, 0.03, stats);
  }
}

function addArduino(root, stats, descriptor) {
  const base = descriptor.position;
  const target = { type: 'part', partId: descriptor.id, id: descriptor.id, label: descriptor.label };
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(2.05, 0.16, 1.28),
    new THREE.MeshStandardMaterial({ color: '#0a765d', roughness: 0.55, metalness: 0.08 })
  );
  tagInspectable(board, target);
  board.position.set(base.x, base.y + 0.08, base.z);
  board.castShadow = true;
  root.add(board);

  const usb = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.17, 0.34),
    new THREE.MeshStandardMaterial({ color: '#c9c9c9', metalness: 0.7, roughness: 0.24 })
  );
  tagInspectable(usb, target);
  usb.position.set(base.x - 0.85, base.y + 0.23, base.z);
  root.add(usb);

  const chip = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.07, 0.38),
    new THREE.MeshStandardMaterial({ color: '#17171c', roughness: 0.6 })
  );
  tagInspectable(chip, target);
  chip.position.set(base.x + 0.2, base.y + 0.21, base.z + 0.06);
  root.add(chip);

  addPinHeader(root, base.x, base.z - 0.71, stats, target, base.y);
  addPinHeader(root, base.x, base.z + 0.67, stats, target, base.y);
  addDescriptorLabel(root, descriptor, 'Arduino', [base.x, base.y + 0.37, base.z], 0.58);
}

// A 2.54mm-style header strip: black plastic body, gold round pins, and a solder
// fillet at the base of each pin.
function addPinHeader(root, x, z, stats, target, baseY = 0.35) {
  const count = 8;
  const pitch = 0.19;
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry((count - 1) * pitch + 0.1, 0.08, 0.12),
    HEADER_PLASTIC_MAT
  );
  tagInspectable(strip, target);
  strip.position.set(x, baseY + 0.15, z);
  strip.castShadow = true;
  root.add(strip);

  const pinGeometry = new THREE.CylinderGeometry(0.016, 0.016, 0.18, 8);
  for (let index = 0; index < count; index += 1) {
    const px = x - 0.68 + index * pitch;
    const pin = new THREE.Mesh(pinGeometry, PIN_METAL_MAT);
    tagInspectable(pin, target);
    pin.position.set(px, baseY + 0.22, z);
    pin.castShadow = true;
    root.add(pin);
    addSolderJoint(root, { x: px, y: baseY + 0.17, z }, 0.045, stats);
  }
}

function addOled(root, texture, stats, descriptor) {
  const base = descriptor.position;
  const target = { type: 'part', partId: descriptor.id, id: descriptor.id, label: descriptor.label };
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(1.45, 0.14, 0.88),
    new THREE.MeshStandardMaterial({ color: '#103950', roughness: 0.5 })
  );
  tagInspectable(board, target);
  board.position.set(base.x, base.y + 0.07, base.z);
  board.castShadow = true;
  root.add(board);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(1.12, 0.52),
    new THREE.MeshBasicMaterial({ map: texture })
  );
  tagInspectable(screen, target);
  screen.rotation.x = -Math.PI / 2;
  screen.position.set(base.x, base.y + 0.155, base.z);
  root.add(screen);

  // 4-pin I2C header along the front edge, where the jumpers land.
  const headerStrip = new THREE.Mesh(
    new THREE.BoxGeometry(0.92, 0.08, 0.12),
    HEADER_PLASTIC_MAT
  );
  tagInspectable(headerStrip, target);
  headerStrip.position.set(base.x - 0.06, base.y + 0.13, base.z - 0.39);
  root.add(headerStrip);

  const pinGeometry = new THREE.CylinderGeometry(0.016, 0.016, 0.18, 8);
  for (const offsetX of [-0.45, -0.2, 0.07, 0.33]) {
    const px = base.x + offsetX;
    const pz = base.z - 0.39;
    const pin = new THREE.Mesh(pinGeometry, PIN_METAL_MAT);
    tagInspectable(pin, target);
    pin.position.set(px, base.y + 0.18, pz);
    pin.castShadow = true;
    root.add(pin);
    addSolderJoint(root, { x: px, y: base.y + 0.135, z: pz }, 0.045, stats);
  }

  addDescriptorLabel(root, descriptor, 'OLED', [base.x, base.y + 0.41, base.z - 0.5], 0.44);
}

function addLibraryModels(root, circuit, stats) {
  const descriptors = stageLibraryPartDescriptors(circuit);
  for (const descriptor of descriptors) {
    addGenericPart(root, descriptor, stats);
  }
  return descriptors;
}

function addGenericRenderPlanParts(root, circuit, stats) {
  const descriptors = stageGenericPartDescriptors(circuit);
  for (const descriptor of descriptors) {
    addGenericPart(root, descriptor, stats);
  }
  return descriptors;
}

function addGenericPart(root, descriptor, stats) {
  const target = {
    type: 'part',
    partId: descriptor.id,
    id: descriptor.id,
    label: descriptor.label,
    hoverTargets: descriptor.hoverTargets
  };
  const position = descriptor.position;
  let body;

  if (descriptor.shape === 'led') {
    body = new THREE.Mesh(
      new THREE.SphereGeometry(descriptor.size.width / 2, 24, 16),
      new THREE.MeshStandardMaterial({
        color: descriptor.color,
        emissive: descriptor.color,
        emissiveIntensity: 0.55,
        roughness: 0.32,
        transparent: true,
        opacity: 0.9
      })
    );
    body.scale.y = 1.35;
    body.position.set(position.x, position.y + descriptor.size.height * 0.35, position.z);
    root.add(tagInspectable(body, target));
    addGenericLeads(root, descriptor, stats, target, [-0.08, 0.08]);
  } else if (descriptor.shape === 'resistor') {
    body = new THREE.Mesh(
      new THREE.CapsuleGeometry(descriptor.size.depth / 2, descriptor.size.width, 12, 18),
      new THREE.MeshStandardMaterial({ color: descriptor.color, roughness: 0.68 })
    );
    body.rotation.z = Math.PI / 2;
    body.position.set(position.x, position.y + 0.1, position.z);
    root.add(tagInspectable(body, target));
    addGenericLeads(root, descriptor, stats, target, [-0.45, 0.45]);
  } else if (descriptor.shape === 'button') {
    body = new THREE.Mesh(
      new THREE.BoxGeometry(descriptor.size.width, descriptor.size.height, descriptor.size.depth),
      new THREE.MeshStandardMaterial({ color: descriptor.color, roughness: 0.6 })
    );
    body.position.set(position.x, position.y + descriptor.size.height / 2, position.z);
    root.add(tagInspectable(body, target));
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.07, 20),
      new THREE.MeshStandardMaterial({ color: '#cfd3d8', roughness: 0.42 })
    );
    cap.position.set(position.x, position.y + descriptor.size.height + 0.04, position.z);
    root.add(tagInspectable(cap, target));
    addGenericLeads(root, descriptor, stats, target, [-0.18, 0.18]);
  } else if (descriptor.shape === 'buzzer') {
    body = new THREE.Mesh(
      new THREE.CylinderGeometry(descriptor.size.width / 2, descriptor.size.width / 2, descriptor.size.height, 32),
      new THREE.MeshStandardMaterial({ color: descriptor.color, roughness: 0.5 })
    );
    body.position.set(position.x, position.y + descriptor.size.height / 2, position.z);
    root.add(tagInspectable(body, target));
    addGenericLeads(root, descriptor, stats, target, [-0.14, 0.14]);
  } else if (descriptor.shape === 'servo') {
    body = new THREE.Mesh(
      new THREE.BoxGeometry(descriptor.size.width, descriptor.size.height, descriptor.size.depth),
      new THREE.MeshStandardMaterial({ color: descriptor.color, roughness: 0.48 })
    );
    body.position.set(position.x, position.y + descriptor.size.height / 2, position.z);
    root.add(tagInspectable(body, target));
    const horn = new THREE.Mesh(
      new THREE.BoxGeometry(descriptor.size.width * 0.78, 0.045, 0.08),
      new THREE.MeshStandardMaterial({ color: '#f2f4f7', roughness: 0.35 })
    );
    horn.position.set(position.x, position.y + descriptor.size.height + 0.07, position.z);
    root.add(tagInspectable(horn, target));
  } else if (descriptor.shape === 'motor') {
    body = new THREE.Mesh(
      new THREE.CylinderGeometry(descriptor.size.depth / 2, descriptor.size.depth / 2, descriptor.size.width, 24),
      new THREE.MeshStandardMaterial({ color: descriptor.color, metalness: 0.55, roughness: 0.32 })
    );
    body.rotation.z = Math.PI / 2;
    body.position.set(position.x, position.y + descriptor.size.height / 2, position.z);
    root.add(tagInspectable(body, target));
  } else if (descriptor.shape === 'sensor') {
    body = new THREE.Mesh(
      new THREE.BoxGeometry(descriptor.size.width, descriptor.size.height, descriptor.size.depth),
      new THREE.MeshStandardMaterial({ color: descriptor.color, roughness: 0.55 })
    );
    body.position.set(position.x, position.y + descriptor.size.height / 2, position.z);
    root.add(tagInspectable(body, target));
    addGenericLeads(root, descriptor, stats, target, [-0.18, 0, 0.18]);
  } else {
    body = new THREE.Mesh(
      new THREE.BoxGeometry(descriptor.size.width, descriptor.size.height, descriptor.size.depth),
      new THREE.MeshStandardMaterial({ color: descriptor.color, roughness: 0.55 })
    );
    body.position.set(position.x, position.y + descriptor.size.height / 2, position.z);
    root.add(tagInspectable(body, target));
  }

  if (descriptor.label) {
    addDescriptorLabel(root, descriptor, descriptor.label, [
      position.x,
      position.y + descriptor.size.height + 0.24,
      position.z
    ], Math.max(0.32, Math.min(0.56, descriptor.size.width)));
  }
}

function addGenericLeads(root, descriptor, stats, target, offsets) {
  const leadGeometry = new THREE.CylinderGeometry(0.012, 0.012, 0.18, 8);
  for (const dx of offsets) {
    const lead = new THREE.Mesh(leadGeometry, PIN_METAL_MAT);
    lead.position.set(descriptor.position.x + dx, descriptor.position.y, descriptor.position.z + descriptor.size.depth / 2);
    root.add(tagInspectable(lead, target));
    addSolderJoint(root, {
      x: descriptor.position.x + dx,
      y: descriptor.position.y - 0.02,
      z: descriptor.position.z + descriptor.size.depth / 2
    }, 0.032, stats);
  }
}

// A jumper-end connector: a colored DuPont insulation boot, a metal ferrule that
// seats into the contact, and a solder bead where it meets the pad.
function addWireConnector(root, position, color, stats, target) {
  const ferrule = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.16, 12),
    PIN_METAL_MAT
  );
  tagInspectable(ferrule, target);
  ferrule.position.set(position.x, position.y - 0.02, position.z);
  ferrule.castShadow = true;
  root.add(ferrule);

  const boot = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.2, 0.1),
    new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.06 })
  );
  tagInspectable(boot, target);
  boot.position.set(position.x, position.y + 0.13, position.z);
  boot.castShadow = true;
  root.add(boot);

  addSolderJoint(root, { x: position.x, y: position.y - 0.08, z: position.z }, 0.045, stats);
  stats.connectors += 1;
}

function addWires(root, circuit, stats, selectedTargetKey = '') {
  const endpoints = stageEndpointMap(circuit);

  return circuit.connections.flatMap((connection, index) => {
    const target = { type: 'connection', connectionId: connection.id };
    const isSelected = selectedTargetKey === `connection:${connection.id}`;
    const from = endpoints[`${connection.from.partId}:${connection.from.pin}`];
    const to = endpoints[`${connection.to.partId}:${connection.to.pin}`];
    if (!from || !to) {
      return [];
    }

    addWireConnector(root, from, connection.color, stats, target);
    addWireConnector(root, to, connection.color, stats, target);

    const curve = new THREE.CatmullRomCurve3(stageConnectionRoutePoints(connection, from, to, index));
    const wire = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 56, isSelected ? 0.048 : 0.032, 12),
      new THREE.MeshStandardMaterial({
        color: connection.color,
        roughness: 0.34,
        metalness: 0.05,
        emissive: connection.color,
        emissiveIntensity: isSelected ? 0.72 : 0.12
      })
    );
    tagInspectable(wire, target);
    wire.castShadow = true;
    root.add(wire);
    return [{
      curve,
      color: connection.color,
      connectionId: connection.id,
      fromKey: endpointKey(connection.from),
      toKey: endpointKey(connection.to)
    }];
  });
}

export function stageConnectionRoutePoints(connection, from, to, index = 0) {
  const serverRoute = Array.isArray(connection?.route)
    ? connection.route
        .filter(isFiniteVector)
        .map((point) => new THREE.Vector3(point.x, point.y, point.z))
    : [];
  if (serverRoute.length >= 2) {
    return serverRoute;
  }

  // The visible fallback wire emerges from connector boots, rises to a peak,
  // and plugs into the other boot for older snapshots without server routing.
  const fromTop = new THREE.Vector3(from.x, from.y + 0.24, from.z);
  const toTop = new THREE.Vector3(to.x, to.y + 0.24, to.z);
  const peak = new THREE.Vector3(
    (from.x + to.x) / 2,
    1.2 + index * 0.12,
    (from.z + to.z) / 2 + (index % 2 === 0 ? -0.36 : 0.36)
  );
  return [fromTop, peak, toTop];
}

export function stageAnimatedWireDescriptors(circuit, wireDescriptors, currentPathDescriptors = stageCurrentPathDescriptors(circuit)) {
  if (!circuit?.simulationPlan) {
    return [];
  }
  if (!currentPathDescriptors.length) {
    return [];
  }

  const matched = [];
  const seen = new Set();
  for (const pathDescriptor of currentPathDescriptors) {
    for (const wire of wireDescriptors) {
      if (!wireMatchesCurrentPath(wire, pathDescriptor)) {
        continue;
      }
      const endpoints = [wire.fromKey ?? '', wire.toKey ?? ''].sort().join('|');
      const key = `${pathDescriptor.id}:${endpoints}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      matched.push({ ...wire, pathDescriptor });
    }
  }
  return matched;
}

function wireMatchesCurrentPath(wire, pathDescriptor) {
  const fromKey = wire.fromKey;
  const toKey = wire.toKey;
  if (!fromKey || !toKey) {
    return false;
  }

  if ((pathDescriptor.connectionIds ?? []).length > 0) {
    return pathDescriptor.connectionIds.includes(wire.connectionId);
  }

  const nodes = currentPathNodes(pathDescriptor);
  for (let index = 0; index < nodes.length - 1; index += 1) {
    if (wireMatchesPathEdge(wire, nodes[index], nodes[index + 1])) {
      return true;
    }
  }
  return false;
}

function currentPathNodes(pathDescriptor) {
  return [
    pathNode(pathDescriptor.from),
    ...(pathDescriptor.through ?? []).map((entry) => pathNode(entry)),
    pathNode(pathDescriptor.to)
  ].filter((node) => node.id);
}

function pathNode(entry) {
  const value = String(entry ?? '');
  if (!value) {
    return { kind: 'component', id: '' };
  }
  return value.includes(':')
    ? { kind: 'endpoint', id: value, componentId: componentIdFromEndpoint(value) }
    : { kind: 'component', id: value, componentId: value };
}

function wireMatchesPathEdge(wire, left, right) {
  if (
    (left.kind === 'component' && isAmbiguousPathComponent(left.id))
    || (right.kind === 'component' && isAmbiguousPathComponent(right.id))
  ) {
    return false;
  }
  if (left.kind === 'endpoint' && right.kind === 'endpoint') {
    return wireHasEndpoint(wire, left.id) && wireHasEndpoint(wire, right.id);
  }
  if (left.kind === 'endpoint' && right.kind === 'component') {
    return wireHasEndpoint(wire, left.id) && wireTouchesComponent(wire, right.id);
  }
  if (left.kind === 'component' && right.kind === 'endpoint') {
    return wireTouchesComponent(wire, left.id) && wireHasEndpoint(wire, right.id);
  }
  if (left.id === right.id) {
    return false;
  }
  return wireTouchesComponent(wire, left.id) && wireTouchesComponent(wire, right.id);
}

function wireHasEndpoint(wire, endpoint) {
  return wire.fromKey === endpoint || wire.toKey === endpoint;
}

function wireTouchesComponent(wire, componentId) {
  return componentIdFromEndpoint(wire.fromKey) === componentId
    || componentIdFromEndpoint(wire.toKey) === componentId;
}

function isAmbiguousPathComponent(componentId) {
  return componentId === 'breadboard' || /breadboard/i.test(componentId);
}

function componentIdFromEndpoint(endpoint) {
  return String(endpoint ?? '').split(':')[0] || '';
}

function endpointKey(endpoint) {
  const partId = endpoint?.partId ?? endpoint?.componentId;
  return partId && endpoint?.pin ? `${partId}:${endpoint.pin}` : '';
}

export function stageCameraFit(circuit) {
  const camera = circuit?.layout?.camera;
  if (!camera || !isFiniteVector(camera.position) || !isFiniteVector(camera.target)) {
    return null;
  }
  const fov = finitePositive(camera.fov) ? camera.fov : 38;
  const minDistance = finitePositive(camera.minDistance) ? camera.minDistance : 4;
  const maxDistance = finitePositive(camera.maxDistance) && camera.maxDistance > minDistance
    ? camera.maxDistance
    : Math.max(9, minDistance * 1.75);

  return {
    position: camera.position,
    target: camera.target,
    fov,
    minDistance,
    maxDistance
  };
}

function applyStageCameraFit(camera, targetVector, zoomRange, cameraFit) {
  if (cameraFit) {
    camera.fov = cameraFit.fov;
    camera.position.set(cameraFit.position.x, cameraFit.position.y, cameraFit.position.z);
    targetVector.set(cameraFit.target.x, cameraFit.target.y, cameraFit.target.z);
    zoomRange.min = cameraFit.minDistance;
    zoomRange.max = cameraFit.maxDistance;
  }
  camera.lookAt(targetVector);
}

function isFiniteVector(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y) && Number.isFinite(point?.z);
}

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

export function stageEndpointMap(circuit) {
  const specializedParts = stageSpecializedPartDescriptors(circuit);
  const arduino = specializedParts.arduino;
  const oled = specializedParts.oled;
  const endpoints = {};

  if (arduino) {
    const base = arduino.position;
    Object.assign(endpoints, {
      [`${arduino.id}:5V`]: new THREE.Vector3(base.x + 0.53, base.y + 0.33, base.z - 0.66),
      [`${arduino.id}:GND`]: new THREE.Vector3(base.x + 0.29, base.y + 0.33, base.z - 0.66),
      [`${arduino.id}:A4/SDA`]: new THREE.Vector3(base.x + 0.63, base.y + 0.33, base.z + 0.64),
      [`${arduino.id}:A5/SCL`]: new THREE.Vector3(base.x + 0.87, base.y + 0.33, base.z + 0.64)
    });
  }

  if (oled) {
    const base = oled.position;
    Object.assign(endpoints, {
      [`${oled.id}:VCC`]: new THREE.Vector3(base.x - 0.45, base.y + 0.27, base.z - 0.39),
      [`${oled.id}:GND`]: new THREE.Vector3(base.x - 0.2, base.y + 0.27, base.z - 0.39),
      [`${oled.id}:SDA`]: new THREE.Vector3(base.x + 0.07, base.y + 0.27, base.z - 0.39),
      [`${oled.id}:SCL`]: new THREE.Vector3(base.x + 0.33, base.y + 0.27, base.z - 0.39)
    });
  }

  if (circuit.layout?.endpoints) {
    Object.assign(
      endpoints,
      Object.fromEntries(
        Object.entries(circuit.layout.endpoints).map(([key, point]) => [
          key,
          new THREE.Vector3(point.x, point.y, point.z)
        ])
      )
    );
  }

  return endpoints;
}

export function stageSpecializedPartPresence(circuit) {
  const parts = stageSpecializedPartDescriptors(circuit);
  return {
    breadboard: Boolean(parts.breadboard),
    arduino: Boolean(parts.arduino),
    oled: Boolean(parts.oled)
  };
}

export function stageSpecializedPartDescriptors(circuit) {
  const breadboard = findStagePart(circuit, ['breadboard'], ['breadboard']);
  const arduino = findStagePart(circuit, ['arduino-uno'], ['arduino']);
  const oled = findStagePart(circuit, ['oled-display'], ['oled']);

  return {
    breadboard: breadboard ? stagePartDescriptor(breadboard.part, breadboard.index, SPECIAL_PART_FALLBACK_POSITIONS.breadboard, stageLabelLayoutForPart(circuit, breadboard.part.id)) : null,
    arduino: arduino ? stagePartDescriptor(arduino.part, arduino.index, SPECIAL_PART_FALLBACK_POSITIONS.arduino, stageLabelLayoutForPart(circuit, arduino.part.id)) : null,
    oled: oled ? stagePartDescriptor(oled.part, oled.index, SPECIAL_PART_FALLBACK_POSITIONS.oled, stageLabelLayoutForPart(circuit, oled.part.id)) : null
  };
}

export function stageGenericPartDescriptors(circuit) {
  const specializedTypes = new Set(['breadboard', 'arduino', 'oled', 'wire']);
  return (circuit.parts ?? [])
    .filter((part) => !part.libraryOnly && !specializedTypes.has(part.type))
    .map((part, index) => stagePartDescriptor(part, index, null, stageLabelLayoutForPart(circuit, part.id)));
}

export function stageLibraryPartDescriptors(circuit) {
  return (circuit.parts ?? [])
    .filter((part) => part.libraryOnly)
    .map((part, index) => stagePartDescriptor(part, index, null, stageLabelLayoutForPart(circuit, part.id)));
}

export function stageCurrentPathDescriptors(circuit) {
  const simulationPlan = circuit?.simulationPlan;
  if (!simulationPlan || simulationPlan.status !== 'valid') {
    return [];
  }

  return (simulationPlan.currentPaths ?? []).map((path) => ({
    id: path.id,
    kind: path.kind,
    label: path.label,
    from: path.from,
    through: path.through ?? [],
    to: path.to,
    connectionIds: path.connectionIds ?? [],
    segments: path.segments ?? [],
    animation: path.animation,
    style: CURRENT_PATH_STYLES[path.kind] ?? CURRENT_PATH_STYLES['load-current']
  }));
}

function stagePartDescriptor(part, index, fallbackPosition = null, labelLayout = null) {
  const visualStyle = part.footprint?.visualStyle;
  const profile = GENERIC_PART_PROFILES[visualStyle?.shape]
    ?? GENERIC_PART_PROFILES[part.footprint?.type]
    ?? GENERIC_PART_PROFILES[part.type]
    ?? GENERIC_PART_PROFILES.module;
  return {
    id: part.id,
    type: part.type,
    label: part.designator || part.label || part.id,
    shape: visualStyle?.shape ?? profile.shape,
    color: visualStyle?.color ?? profile.color,
    material: visualStyle?.material ?? profile.material ?? 'matte',
    size: part.footprint
      ? { width: part.footprint.width, depth: part.footprint.depth, height: part.footprint.height }
      : profile.size,
    footprint: part.footprint,
    hoverTargets: part.footprint?.hoverTargets ?? [],
    labelLayout,
    position: part.position ?? fallbackPosition ?? defaultGenericPartPosition(index)
  };
}

export function stageLabelLayoutForPart(circuit, partId) {
  const label = circuit?.layout?.labels?.[partId];
  if (!label || !isFiniteVector(label.position) || !finitePositive(label.width) || !finitePositive(label.height)) {
    return null;
  }
  return {
    text: label.text,
    position: label.position,
    width: label.width,
    height: label.height
  };
}

const SPECIAL_PART_FALLBACK_POSITIONS = {
  breadboard: { x: 0, y: 0, z: 0 },
  arduino: { x: -1.65, y: 0.35, z: 0.02 },
  oled: { x: 1.55, y: 0.45, z: -0.06 }
};

const GENERIC_PART_PROFILES = {
  led: {
    shape: 'led',
    color: '#ff5b59',
    material: 'translucent-emissive',
    size: { width: 0.3, depth: 0.3, height: 0.5 }
  },
  resistor: {
    shape: 'resistor',
    color: '#d7b56d',
    material: 'ceramic',
    size: { width: 0.7, depth: 0.16, height: 0.16 }
  },
  button: {
    shape: 'button',
    color: '#353a44',
    material: 'plastic',
    size: { width: 0.5, depth: 0.5, height: 0.2 }
  },
  buzzer: {
    shape: 'buzzer',
    color: '#2b2b32',
    material: 'plastic',
    size: { width: 0.55, depth: 0.55, height: 0.35 }
  },
  servo: {
    shape: 'servo',
    color: '#334e7a',
    material: 'plastic',
    size: { width: 0.8, depth: 0.42, height: 0.68 }
  },
  sensor: {
    shape: 'sensor',
    color: '#2f7df6',
    material: 'pcb-module',
    size: { width: 0.58, depth: 0.44, height: 0.12 }
  },
  motor: {
    shape: 'motor',
    color: '#bfc5c8',
    material: 'brushed-metal',
    size: { width: 0.62, depth: 0.56, height: 0.56 }
  },
  module: {
    shape: 'module',
    color: '#2f7df6',
    material: 'pcb-module',
    size: { width: 0.58, depth: 0.44, height: 0.12 }
  }
};

function defaultGenericPartPosition(index) {
  return {
    x: -0.5 + index * 0.45,
    y: 0.34,
    z: 0.62
  };
}

function findStagePart(circuit, preferredIds, typeHints) {
  const parts = circuit.parts ?? [];
  const preferredIndex = parts.findIndex((part) => preferredIds.includes(part.id));
  if (preferredIndex >= 0) {
    return { part: parts[preferredIndex], index: preferredIndex };
  }

  const typeIndex = parts.findIndex((part) => typeHints.includes(part.type));
  if (typeIndex >= 0) {
    return { part: parts[typeIndex], index: typeIndex };
  }

  const textIndex = parts.findIndex((part) => {
    const searchable = `${part.id ?? ''} ${part.label ?? ''} ${part.description ?? ''}`.toLowerCase();
    return typeHints.some((hint) => searchable.includes(hint));
  });
  return textIndex >= 0 ? { part: parts[textIndex], index: textIndex } : null;
}

function findStagePartId(circuit, preferredIds, typeHints) {
  return findStagePart(circuit, preferredIds, typeHints)?.part.id;
}

// Builds a small reflection environment (a dark room with a few bright panels)
// and applies it to the scene so metals have something to mirror.
function applyStudioEnvironment(renderer, scene) {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color('#1b2b27');

    const panel = (color, intensity, position, size) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(color).multiplyScalar(intensity),
          side: THREE.DoubleSide
        })
      );
      mesh.position.set(position[0], position[1], position[2]);
      mesh.lookAt(0, 0, 0);
      envScene.add(mesh);
    };
    panel('#fff6e8', 2.4, [3, 6, 4], 6);
    panel('#9fe7d6', 1.1, [-5, 2, -3], 5);
    panel('#ffad9b', 0.8, [0, 1, 6], 4);

    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    pmrem.dispose();
  } catch (error) {
    // Metals simply render matte if the environment cannot be generated.
  }
}

function addDescriptorLabel(root, descriptor, fallbackText, fallbackPosition, fallbackWidth) {
  const label = descriptor.labelLayout;
  addLabel(
    root,
    label?.text ?? fallbackText,
    label?.position ? [label.position.x, label.position.y, label.position.z] : fallbackPosition,
    label?.width ?? fallbackWidth
  );
}

function addLabel(root, text, position, width) {
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 256;
  labelCanvas.height = 96;
  const context = labelCanvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.font = '600 34px Inter, Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 128, 48);

  const texture = new THREE.CanvasTexture(labelCanvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.position.set(position[0], position[1], position[2]);
  sprite.scale.set(width, width * 0.36, 1);
  root.add(sprite);
}

function createOledTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 240;
  drawOledTexture(canvas, text);
  return new THREE.CanvasTexture(canvas);
}

function drawOledTexture(canvas, text) {
  const context = canvas.getContext('2d');
  context.fillStyle = '#06111f';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#75d7ff';
  context.fillRect(24, 24, canvas.width - 48, canvas.height - 48);
  context.fillStyle = '#06111f';
  context.fillRect(34, 34, canvas.width - 68, canvas.height - 68);
  context.fillStyle = '#b9f2ff';
  context.font = '700 44px Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2);
}

function createCanvasFallback(container, canvas, circuit, options) {
  let running = Boolean(options.running);
  canvas.dataset.renderer = 'canvas-fallback';
  canvas.dataset.selectedTarget = options.selectedTargetKey || '';
  const context = canvas.getContext('2d');
  const resizeObserver = new ResizeObserver(draw);
  resizeObserver.observe(container);
  draw();

  return {
    run() {
      running = true;
      draw();
    },
    dispose() {
      resizeObserver.disconnect();
      canvas.remove();
    }
  };

  function draw() {
    const specializedParts = stageSpecializedPartPresence(circuit);
    const bounds = container.getBoundingClientRect();
    canvas.width = Math.max(320, Math.floor(bounds.width));
    canvas.height = Math.max(360, Math.floor(bounds.height));
    const width = canvas.width;
    const height = canvas.height;
    context.fillStyle = '#003c33';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = '#0f554a';
    for (let x = 0; x < width; x += 28) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 0; y < height; y += 28) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    context.fillStyle = '#eeece7';
    context.fillRect(width * 0.2, height * 0.36, width * 0.6, height * 0.28);
    context.fillStyle = '#0a765d';
    context.fillRect(width * 0.25, height * 0.42, width * 0.22, height * 0.14);
    if (specializedParts.oled) {
      context.fillStyle = '#103950';
      context.fillRect(width * 0.58, height * 0.42, width * 0.17, height * 0.14);
    }
    ['#ff4d3d', '#20242a', '#2f7df6', '#f6c44c'].forEach((color, index) => {
      context.strokeStyle = color;
      context.lineWidth = 7;
      context.beginPath();
      context.moveTo(width * 0.38, height * (0.45 + index * 0.03));
      context.bezierCurveTo(width * 0.48, height * 0.2, width * 0.62, height * 0.2, width * 0.67, height * (0.45 + index * 0.03));
      context.stroke();
    });
    context.fillStyle = '#b9f2ff';
    context.font = '700 24px Arial, sans-serif';
    context.textAlign = 'center';
    if (specializedParts.oled) {
      context.fillText(running ? circuit.runText : 'READY', width * 0.665, height * 0.51);
    }
    canvas.dataset.renderReady = 'true';
  }
}

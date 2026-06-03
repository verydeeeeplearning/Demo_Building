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
  let interactionMode = options.interactionMode || 'orbit';
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
  const sceneGraph = createStageSceneGraph(root);

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
  if (specializedParts.breadboard) {
    addBreadboard(sceneGraph.partGroupFor(specializedParts.breadboard), stats, specializedParts.breadboard, sceneGraph);
  }
  if (specializedParts.arduino) {
    addArduino(sceneGraph.partGroupFor(specializedParts.arduino), stats, specializedParts.arduino, sceneGraph);
  }
  const oledTexture = specializedParts.oled ? createOledTexture(running ? circuit.runText : 'READY') : null;
  if (oledTexture) addOled(sceneGraph.partGroupFor(specializedParts.oled), oledTexture, stats, specializedParts.oled, sceneGraph);
  const genericParts = addGenericRenderPlanParts(root, circuit, stats, sceneGraph);
  const libraryParts = addLibraryModels(root, circuit, stats, sceneGraph);

  const wireCurves = addWires(root, circuit, stats, selectedTargetKey, sceneGraph);
  sceneGraph.hydrateVisualTransforms(options.visualTransforms, options.visualTransformRevision);
  updateVisualPreviewWires(sceneGraph, circuit);
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
  canvas.dataset.partGroupCount = String(sceneGraph.partGroupsById.size);
  canvas.dataset.wireGroupCount = String(sceneGraph.wireGroupsByConnectionId.size);
  canvas.dataset.labelGroupCount = String(sceneGraph.labelGroupsByPartId.size);
  canvas.dataset.previewWireGroupCount = String(sceneGraph.previewWireGroupsByConnectionId.size);
  canvas.dataset.cameraFit = cameraFit ? 'server' : 'fallback';
  canvas.dataset.cameraTarget = `${cameraTarget.x.toFixed(2)},${cameraTarget.y.toFixed(2)},${cameraTarget.z.toFixed(2)}`;
  canvas.dataset.cameraDistance = camera.position.distanceTo(cameraTarget).toFixed(2);
  const initialDebugSnapshot = createStageDebugSnapshot(circuit, {
    interactionMode,
    visualTransformRevision: sceneGraph.visualTransformRevision,
    previewWireRouteHash: sceneGraph.previewWireRouteHash
  });
  canvas.dataset.interactionMode = initialDebugSnapshot.interactionMode;
  canvas.dataset.visualTransformRevision = String(initialDebugSnapshot.visualTransformRevision);
  canvas.dataset.wireRouteHash = initialDebugSnapshot.wireRouteHash;
  canvas.dataset.previewWireRouteHash = initialDebugSnapshot.previewWireRouteHash;
  canvas.dataset.circuitSpecHash = initialDebugSnapshot.circuitSpecHash;
  canvas.dataset.presentationAdjustmentKind = initialDebugSnapshot.presentationAdjustmentKind;
  canvas.__hEduwareStageDebug = () => stageRuntimeDebugSnapshot(sceneGraph, circuit, canvas);
  canvas.__hEduwareStagePartScreenPoint = (componentId) => stagePartScreenPoint(sceneGraph, camera, canvas, componentId);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  let dragging = false;
  let dragMode = 'orbit';
  let draggedPartId = '';
  let dragStartPoint = null;
  let dragStartOffset = null;
  let dragLatestTransform = null;
  let dragPlaneY = 0;
  let lastX = 0;
  let lastY = 0;
  let dragDistance = 0;
  let targetRotation = 0;
  let hoveredTargetKey = '';

  // Wire-drag state (Phase 3). Separate from part-drag; run-neutral (does NOT
  // feed canRunCurrentSimulation — wireRouteDirty is kept in main.js).
  let wireDragConnectionId = '';
  let wireDragControlIndex = -1;   // index into the live route[] array
  let wireDragMesh = null;         // the THREE.Mesh being imperatively updated
  let wireDragRoutePoints = [];    // live THREE.Vector3[] during the drag
  let wireDragPlaneY = 0;          // horizontal drag plane Y

  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    dragMode = 'orbit';
    draggedPartId = '';
    lastX = event.clientX;
    lastY = event.clientY;
    dragDistance = 0;
    if (interactionMode === 'visual_move' || interactionMode === 'hardware_move') {
      // Wire-bend drag: only in visual_move mode and only when the nearest
      // raycast hit is a wire-tube (not a part). Checked before the part path
      // so the wire's inspect target doesn't accidentally fall through.
      if (interactionMode === 'visual_move') {
        const wireTubeHit = findWireTubeHit(event);
        if (wireTubeHit) {
          const { mesh, connectionId } = wireTubeHit;
          const connection = circuit.connections.find((c) => c.id === connectionId);
          if (connection) {
            const endpoints = stageEndpointMap(circuit);
            const from = endpoints[endpointKey(connection.from)];
            const to = endpoints[endpointKey(connection.to)];
            if (from && to) {
              // Build a working copy of the route points for live editing.
              const fromVec = new THREE.Vector3(from.x, from.y + 0.24, from.z);
              const toVec = new THREE.Vector3(to.x, to.y + 0.24, to.z);
              const existingRoute = Array.isArray(connection.route)
                ? connection.route
                    .filter(isFiniteVector)
                    .map((p) => new THREE.Vector3(p.x, p.y, p.z))
                : [];
              wireDragRoutePoints = ensureMinRoutePoints(existingRoute, fromVec, toVec);
              // Pick the midpoint (index 1 for 3-point routes, center for longer).
              wireDragControlIndex = Math.floor((wireDragRoutePoints.length - 1) / 2);
              wireDragPlaneY = wireDragRoutePoints[wireDragControlIndex].y;
              wireDragMesh = mesh;
              wireDragConnectionId = connectionId;
              dragMode = 'visual_wire';
              dragStartPoint = pointerPointOnDragPlane(event, wireDragPlaneY);
              canvas.setPointerCapture(event.pointerId);
              return;
            }
          }
        }
      }
      const target = findInspectTarget(event);
      if (target?.type === 'part' && target.partId && sceneGraph.partGroupsById.has(target.partId)) {
        const basePosition = sceneGraph.basePartPosition(target.partId);
        dragPlaneY = basePosition.y;
        const startPoint = pointerPointOnDragPlane(event, dragPlaneY);
        if (startPoint) {
          dragMode = 'visual_part';
          draggedPartId = target.partId;
          dragStartPoint = startPoint;
          dragStartOffset = sceneGraph.partVisualOffset(target.partId);
          selectCircuitTargetFromStage(target);
        }
      }
    }
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) {
      updateHover(event);
      return;
    }
    if (dragMode === 'visual_wire') {
      const point = pointerPointOnDragPlane(event, wireDragPlaneY);
      if (!point || !wireDragMesh) {
        return;
      }
      // Move the control point imperatively — no stageRenderKey recreate.
      wireDragRoutePoints[wireDragControlIndex].set(point.x, wireDragPlaneY, point.z);
      rebuildWireTubeMesh(wireDragMesh, wireDragRoutePoints, {
        color: wireDragMesh.material?.color?.getStyle?.() ?? '#ffffff',
        radius: 0.032,
        emissiveIntensity: 0.12
      });
      dragDistance += Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY);
      lastX = event.clientX;
      lastY = event.clientY;
      return;
    }
    if (dragMode === 'visual_part') {
      const point = pointerPointOnDragPlane(event, dragPlaneY);
      if (!point) {
        return;
      }
      const delta = point.clone().sub(dragStartPoint);
      const basePosition = sceneGraph.basePartPosition(draggedPartId);
      const requestedPosition = {
        x: basePosition.x + dragStartOffset.x + delta.x,
        y: basePosition.y + dragStartOffset.y + delta.y,
        z: basePosition.z + dragStartOffset.z + delta.z
      };
      applyVisualTransformFromStage(draggedPartId, { position: requestedPosition });
      dragLatestTransform = { position: requestedPosition };
      dragDistance += Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY);
      lastX = event.clientX;
      lastY = event.clientY;
      return;
    }
    targetRotation += (event.clientX - lastX) * 0.006;
    dragDistance += Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY);
    lastX = event.clientX;
    lastY = event.clientY;
  });
  canvas.addEventListener('pointerup', () => {
    const completedDrag = {
      mode: dragMode,
      partId: draggedPartId,
      transform: dragLatestTransform,
      wireConnectionId: wireDragConnectionId,
      wireRoutePoints: wireDragRoutePoints.slice()
    };
    dragging = false;
    dragMode = 'orbit';
    draggedPartId = '';
    dragStartPoint = null;
    dragStartOffset = null;
    dragLatestTransform = null;
    wireDragConnectionId = '';
    wireDragControlIndex = -1;
    wireDragMesh = null;
    wireDragRoutePoints = [];

    if (completedDrag.mode === 'visual_wire' && completedDrag.wireConnectionId) {
      // Persist route to connection.route[] as plain serializable objects, then
      // call onWireRouteChange so main.js can set wireRouteDirty (run-neutral).
      // This changes circuitSpecHash → exactly ONE stage recreate on next render.
      const serialized = completedDrag.wireRoutePoints.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z
      }));
      options.onWireRouteChange?.({
        connectionId: completedDrag.wireConnectionId,
        route: serialized
      });
      return;
    }

    if (
      interactionMode === 'hardware_move'
      && completedDrag.mode === 'visual_part'
      && completedDrag.partId
      && completedDrag.transform
    ) {
      options.onHardwarePlacementIntent?.({
        componentId: completedDrag.partId,
        transform: completedDrag.transform,
        debugSnapshot: stageRuntimeDebugSnapshot(sceneGraph, circuit, canvas)
      });
    }
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
    debugSnapshot() {
      return stageRuntimeDebugSnapshot(sceneGraph, circuit, canvas);
    },
    setInteractionMode(nextMode) {
      interactionMode = ['visual_move', 'hardware_move'].includes(nextMode) ? nextMode : 'orbit';
      canvas.dataset.interactionMode = interactionMode;
      return interactionMode;
    },
    getPartWorldBounds(componentId) {
      return sceneGraph.getPartWorldBounds(componentId);
    },
    applyVisualTransform(componentId, transform) {
      const applied = applyVisualTransformFromStage(componentId, transform);
      return applied;
    },
    undoVisualTransform(componentId, transform) {
      const applied = sceneGraph.applyVisualTransform(componentId, transform);
      if (applied) {
        updateVisualPreviewWires(sceneGraph, circuit);
        syncVisualDataset();
      }
      return applied;
    },
    resetVisualTransforms() {
      const reset = sceneGraph.resetVisualTransforms();
      updateVisualPreviewWires(sceneGraph, circuit);
      syncVisualDataset();
      return reset;
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
      delete canvas.__hEduwareStageDebug;
      delete canvas.__hEduwareStagePartScreenPoint;
      canvas.remove();
    }
  };

  function resize() {
    const bounds = container.getBoundingClientRect();
    const width = Math.max(320, Math.floor(bounds.width));
    const height = Math.max(360, Math.floor(bounds.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    fitCameraToVisibleStageBounds(sceneGraph, camera, cameraTarget, zoomRange, cameraFit);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    canvas.dataset.renderReady = 'true';
    canvas.dataset.cameraFit = cameraFit ? 'server+scene-bounds' : 'scene-bounds';
    canvas.dataset.cameraTarget = `${cameraTarget.x.toFixed(2)},${cameraTarget.y.toFixed(2)},${cameraTarget.z.toFixed(2)}`;
    canvas.dataset.cameraDistance = camera.position.distanceTo(cameraTarget).toFixed(2);
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

  // Returns the nearest wire-tube mesh + its connectionId when the pointer
  // hits a wire object. Used by the wire-drag path to disambiguate from parts.
  function findWireTubeHit(event) {
    const bounds = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    for (const hit of raycaster.intersectObjects(root.children, true)) {
      // Walk up to find a wire group (stageGraphRole === 'wire')
      let object = hit.object;
      while (object) {
        if (object.userData?.stageGraphRole === 'wire-tube') {
          // Find parent wire group to get connectionId
          let parent = object.parent;
          while (parent) {
            if (parent.userData?.stageGraphRole === 'wire' && parent.userData?.connectionId) {
              return { mesh: object, connectionId: parent.userData.connectionId };
            }
            parent = parent.parent;
          }
        }
        if (object.userData?.stageGraphRole === 'wire' && object.userData?.connectionId) {
          // Hit the group directly — find the tube child
          const tubeMesh = object.children.find(
            (child) => child.userData?.stageGraphRole === 'wire-tube'
          );
          if (tubeMesh) {
            return { mesh: tubeMesh, connectionId: object.userData.connectionId };
          }
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

  function pointerPointOnDragPlane(event, y) {
    const bounds = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const point = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, point) ? point : null;
  }

  function applyVisualTransformFromStage(componentId, transform) {
    const before = sceneGraph.visualTransformSnapshot();
    const applied = sceneGraph.applyVisualTransform(componentId, transform);
    if (!applied) {
      return false;
    }
    updateVisualPreviewWires(sceneGraph, circuit);
    syncVisualDataset();
    options.onVisualArrangementChange?.({
      componentId,
      transform: sceneGraph.visualTransformSnapshot()[componentId],
      transforms: sceneGraph.visualTransformSnapshot(),
      previousTransforms: before,
      visualTransformRevision: sceneGraph.visualTransformRevision,
      previewWireRouteHash: sceneGraph.previewWireRouteHash
    });
    return true;
  }

  function syncVisualDataset() {
    canvas.dataset.visualTransformRevision = String(sceneGraph.visualTransformRevision);
    canvas.dataset.previewWireRouteHash = sceneGraph.previewWireRouteHash;
  }

  function selectCircuitTargetFromStage(target) {
    options.onSelectTarget?.(target);
  }
}

function stagePartScreenPoint(sceneGraph, camera, canvas, componentId) {
  const bounds = sceneGraph.getPartWorldBounds(componentId);
  if (!bounds) {
    return null;
  }
  const center = new THREE.Vector3();
  bounds.getCenter(center);
  center.project(camera);
  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.left + ((center.x + 1) / 2) * rect.width,
    y: rect.top + ((-center.y + 1) / 2) * rect.height
  };
}

function fitCameraToVisibleStageBounds(sceneGraph, camera, targetVector, zoomRange, cameraFit = null) {
  const bounds = visibleStageBounds(sceneGraph);
  if (!bounds) {
    applyStageCameraFit(camera, targetVector, zoomRange, cameraFit);
    return;
  }
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  bounds.getCenter(center);
  bounds.getSize(size);
  const target = new THREE.Vector3(center.x, Math.max(0.18, center.y * 0.65), center.z);
  const verticalFov = THREE.MathUtils.degToRad(camera.fov || cameraFit?.fov || 38);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(0.25, camera.aspect || 1));
  const narrowestFov = Math.max(THREE.MathUtils.degToRad(8), Math.min(verticalFov, horizontalFov));
  const radius = Math.max(1, size.length() / 2);
  const flatSpan = Math.max(size.x, size.z);
  const distance = clampNumber(
    Math.max(5.8, (radius / Math.sin(narrowestFov / 2)) * 1.08, flatSpan * 1.45),
    5.8,
    42
  );
  const currentDirection = camera.position.clone().sub(targetVector);
  const direction = currentDirection.lengthSq() > 0.001
    ? currentDirection.normalize()
    : new THREE.Vector3(0.62, 0.52, 0.58).normalize();
  targetVector.copy(target);
  camera.position.copy(target).add(direction.multiplyScalar(distance));
  zoomRange.min = Math.max(3.8, distance * 0.55);
  zoomRange.max = Math.max(zoomRange.min + 1, distance * 1.35);
  camera.lookAt(targetVector);
}

function visibleStageBounds(sceneGraph) {
  const bounds = new THREE.Box3();
  let hasBounds = false;
  const groups = [
    ...sceneGraph.partGroupsById.values(),
    ...sceneGraph.wireGroupsByConnectionId.values()
  ];
  for (const group of groups) {
    if (!group.visible || group.children.length === 0) {
      continue;
    }
    group.updateWorldMatrix(true, true);
    const groupBounds = new THREE.Box3().setFromObject(group);
    if (groupBounds.isEmpty()) {
      continue;
    }
    bounds.union(groupBounds);
    hasBounds = true;
  }
  if (!hasBounds) {
    return null;
  }
  bounds.expandByScalar(0.35);
  return bounds;
}

// Shared metallic materials so solder beads, pins, and ferrules read as the same
// real materials across the scene and reflect the procedural environment.
const SOLDER_MAT = new THREE.MeshStandardMaterial({ color: '#c7ccd3', metalness: 0.95, roughness: 0.26 });
const PIN_METAL_MAT = new THREE.MeshStandardMaterial({ color: '#d9b35a', metalness: 0.92, roughness: 0.3 });
const HEADER_PLASTIC_MAT = new THREE.MeshStandardMaterial({ color: '#0b0b0e', roughness: 0.82, metalness: 0.05 });
const RAIL_CONTACT_MAT = new THREE.MeshStandardMaterial({ color: '#c0a14a', metalness: 0.85, roughness: 0.38 });
// Reused across every scene rebuild, so dispose() must skip these.
const SHARED_MATERIALS = new Set([SOLDER_MAT, PIN_METAL_MAT, HEADER_PLASTIC_MAT, RAIL_CONTACT_MAT]);

export function createStageSceneGraph(root = new THREE.Group()) {
  const partGroupsById = new Map();
  const wireGroupsByConnectionId = new Map();
  const labelGroupsByPartId = new Map();
  const previewWireGroupsByConnectionId = new Map();
  const basePartPositions = new Map();
  const visualTransformsByPartId = new Map();
  let previewWireRouteHash = '';
  let visualTransformRevision = 0;

  const graph = {
    root,
    partGroupsById,
    wireGroupsByConnectionId,
    labelGroupsByPartId,
    previewWireGroupsByConnectionId,
    get visualTransformRevision() {
      return visualTransformRevision;
    },
    get previewWireRouteHash() {
      return previewWireRouteHash;
    },
    setPreviewWireRouteHash(hash) {
      previewWireRouteHash = hash || '';
    },
    partGroupFor(descriptor) {
      const partId = descriptor?.id;
      if (!partId) {
        return root;
      }
      if (partGroupsById.has(partId)) {
        return partGroupsById.get(partId);
      }
      const group = new THREE.Group();
      group.name = `part:${partId}`;
      group.userData.partId = partId;
      group.userData.stageGraphRole = 'part';
      group.userData.basePosition = vectorSnapshot(descriptor.position);
      group.userData.visualPlacementBounds = visualPlacementBoundsForDescriptor(descriptor);
      basePartPositions.set(partId, vectorSnapshot(descriptor.position));
      tagInspectable(group, {
        type: 'part',
        partId,
        id: partId,
        label: descriptor.label,
        hoverTargets: descriptor.hoverTargets
      });
      partGroupsById.set(partId, group);
      root.add(group);
      return group;
    },
    wireGroupFor(connection) {
      const connectionId = connection?.id;
      if (!connectionId) {
        return root;
      }
      if (wireGroupsByConnectionId.has(connectionId)) {
        return wireGroupsByConnectionId.get(connectionId);
      }
      const group = new THREE.Group();
      group.name = `wire:${connectionId}`;
      group.userData.connectionId = connectionId;
      group.userData.stageGraphRole = 'wire';
      tagInspectable(group, { type: 'connection', connectionId });
      wireGroupsByConnectionId.set(connectionId, group);
      root.add(group);
      return group;
    },
    labelGroupFor(descriptor, parent = root) {
      const partId = descriptor?.id;
      if (!partId) {
        return parent;
      }
      if (labelGroupsByPartId.has(partId)) {
        return labelGroupsByPartId.get(partId);
      }
      const group = new THREE.Group();
      group.name = `label:${partId}`;
      group.userData.partId = partId;
      group.userData.stageGraphRole = 'label';
      labelGroupsByPartId.set(partId, group);
      parent.add(group);
      return group;
    },
    previewWireGroupFor(connectionId) {
      if (!connectionId) {
        return root;
      }
      if (previewWireGroupsByConnectionId.has(connectionId)) {
        return previewWireGroupsByConnectionId.get(connectionId);
      }
      const group = new THREE.Group();
      group.name = `preview-wire:${connectionId}`;
      group.userData.connectionId = connectionId;
      group.userData.stageGraphRole = 'preview-wire';
      group.visible = false;
      previewWireGroupsByConnectionId.set(connectionId, group);
      root.add(group);
      return group;
    },
    getPartWorldBounds(componentId) {
      const group = partGroupsById.get(componentId);
      if (!group) {
        return null;
      }
      group.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(group);
      return bounds.isEmpty() ? null : bounds;
    },
    basePartPosition(componentId) {
      return vectorSnapshot(basePartPositions.get(componentId));
    },
    partVisualOffset(componentId) {
      const group = partGroupsById.get(componentId);
      if (!group) {
        return { x: 0, y: 0, z: 0 };
      }
      return vectorSnapshot(group.position);
    },
    visualTransformSnapshot() {
      return Object.fromEntries(
        Array.from(visualTransformsByPartId.entries())
          .sort(([left], [right]) => String(left).localeCompare(String(right)))
          .map(([partId, transform]) => [partId, {
            ...transform,
            position: vectorSnapshot(transform.position),
            rotation: transform.rotation ? vectorSnapshot(transform.rotation) : null
          }])
      );
    },
    hydrateVisualTransforms(transforms = {}, revision = 0) {
      const entries = Object.entries(transforms ?? {});
      for (const [componentId, transform] of entries) {
        this.applyVisualTransform(componentId, transform, { incrementRevision: false });
      }
      visualTransformRevision = Number.isFinite(revision) ? revision : entries.length ? 1 : 0;
    },
    applyVisualTransform(componentId, transform, options = {}) {
      const group = partGroupsById.get(componentId);
      const requestedPosition = transform?.position;
      if (!group || !isFiniteVector(requestedPosition)) {
        return false;
      }
      const base = basePartPositions.get(componentId) ?? { x: 0, y: 0, z: 0 };
      const adjustedPosition = constrainVisualPosition(group, requestedPosition);
      group.position.set(
        adjustedPosition.x - base.x,
        adjustedPosition.y - base.y,
        adjustedPosition.z - base.z
      );
      if (isFiniteVector(transform.rotation)) {
        group.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
      }
      const visualTransform = {
        componentId,
        position: vectorSnapshot(adjustedPosition),
        rotation: isFiniteVector(transform.rotation) ? vectorSnapshot(transform.rotation) : null,
        source: 'student_visual_adjustment',
        committed: false
      };
      group.userData.visualTransform = visualTransform;
      visualTransformsByPartId.set(componentId, visualTransform);
      if (options.incrementRevision !== false) {
        visualTransformRevision += 1;
      }
      return true;
    },
    resetVisualTransforms() {
      let changed = false;
      for (const group of partGroupsById.values()) {
        if (
          group.position.x !== 0
          || group.position.y !== 0
          || group.position.z !== 0
          || group.rotation.x !== 0
          || group.rotation.y !== 0
          || group.rotation.z !== 0
          || group.userData.visualTransform
        ) {
          changed = true;
        }
        group.position.set(0, 0, 0);
        group.rotation.set(0, 0, 0);
        delete group.userData.visualTransform;
      }
      visualTransformsByPartId.clear();
      if (changed) {
        visualTransformRevision += 1;
      }
      return changed;
    }
  };

  return graph;
}

function constrainVisualPosition(group, position) {
  const bounds = group?.userData?.visualPlacementBounds;
  if (!bounds) {
    return vectorSnapshot(position);
  }
  return {
    x: clampNumber(position.x, bounds.minX, bounds.maxX),
    y: clampNumber(position.y, bounds.minY, bounds.maxY),
    z: clampNumber(position.z, bounds.minZ, bounds.maxZ)
  };
}

function visualPlacementBoundsForDescriptor(descriptor) {
  const position = vectorSnapshot(descriptor?.position);
  const size = descriptor?.size ?? { width: 0.4, depth: 0.4, height: 0.2 };
  const halfWidth = Math.max(0, (Number(size.width) || 0) / 2);
  const halfDepth = Math.max(0, (Number(size.depth) || 0) / 2);
  const baseY = Number.isFinite(position.y) ? position.y : 0;

  if (descriptor?.id === 'breadboard') {
    return {
      minX: position.x,
      maxX: position.x,
      minY: baseY,
      maxY: baseY,
      minZ: position.z,
      maxZ: position.z
    };
  }

  const breadboard = {
    minX: -2.8 + halfWidth,
    maxX: 2.8 - halfWidth,
    minZ: -1.075 + halfDepth,
    maxZ: 1.075 - halfDepth
  };
  const startsOnBreadboard = position.x >= -2.8
    && position.x <= 2.8
    && position.z >= -1.075
    && position.z <= 1.075;
  if (startsOnBreadboard) {
    return {
      minX: Math.min(breadboard.minX, position.x),
      maxX: Math.max(breadboard.maxX, position.x),
      minY: baseY,
      maxY: baseY,
      minZ: Math.min(breadboard.minZ, position.z),
      maxZ: Math.max(breadboard.maxZ, position.z)
    };
  }

  return {
    minX: -3.2 + halfWidth,
    maxX: 3.2 - halfWidth,
    minY: baseY,
    maxY: baseY,
    minZ: -2.2 + halfDepth,
    maxZ: 2.2 - halfDepth
  };
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function stageRuntimeDebugSnapshot(sceneGraph, circuit, canvas) {
  const baseSnapshot = createStageDebugSnapshot(circuit, {
    interactionMode: canvas.dataset.interactionMode || 'orbit',
    visualTransformRevision: sceneGraph.visualTransformRevision,
    previewWireRouteHash: sceneGraph.previewWireRouteHash
  });
  return {
    ...baseSnapshot,
    visualTransforms: sceneGraph.visualTransformSnapshot(),
    partGroupIds: Array.from(sceneGraph.partGroupsById.keys()),
    wireGroupIds: Array.from(sceneGraph.wireGroupsByConnectionId.keys()),
    labelGroupIds: Array.from(sceneGraph.labelGroupsByPartId.keys()),
    previewWireGroupIds: Array.from(sceneGraph.previewWireGroupsByConnectionId.keys()),
    partWorldBounds: Object.fromEntries(
      Array.from(sceneGraph.partGroupsById.keys()).map((partId) => [
        partId,
        boxSnapshot(sceneGraph.getPartWorldBounds(partId))
      ])
    )
  };
}

export function createStageDebugSnapshot(circuit, options = {}) {
  const partPositions = stagePartPositionSnapshot(circuit);
  const wireRouteHash = stageWireRouteHash(circuit);
  const presentationAdjustmentKind = circuit?.solverGateResult?.presentationAdjustment?.kind
    ?? circuit?.solverGateResult?.mode
    ?? '';
  const circuitSpecHash = stableStageHash({
    parts: (circuit?.parts ?? []).map((part) => ({
      id: part.id,
      type: part.type,
      label: part.label,
      designator: part.designator,
      position: vectorSnapshot(part.position),
      footprint: part.footprint ? {
        id: part.footprint.id,
        type: part.footprint.type,
        width: part.footprint.width,
        depth: part.footprint.depth,
        height: part.footprint.height
      } : null
    })),
    connections: (circuit?.connections ?? []).map((connection) => ({
      id: connection.id,
      from: endpointKey(connection.from),
      to: endpointKey(connection.to),
      route: (connection.route ?? []).filter(isFiniteVector).map(vectorSnapshot)
    })),
    layoutRevision: circuit?.layout?.revision ?? circuit?.renderPlanRevision ?? circuit?.id ?? '',
    partPositions,
    wireRouteHash
  });

  return {
    interactionMode: options.interactionMode ?? 'orbit',
    renderPlanRevision: circuit?.layout?.revision ?? circuit?.renderPlanRevision ?? circuit?.id ?? 'local-render-plan',
    circuitSpecHash,
    buildReady: circuit?.solverGateResult?.buildReady === true,
    presentationAdjustmentKind,
    partPositions,
    visualTransformRevision: Number.isFinite(options.visualTransformRevision)
      ? options.visualTransformRevision
      : 0,
    wireRouteHash,
    previewWireRouteHash: options.previewWireRouteHash ?? ''
  };
}

/**
 * Pure render key for the stage. Equal key → reconcile in place (no recreate);
 * changed key → dispose + recreate. Only circuitSpecHash and
 * visualTransformRevision participate — selection, run/pause, and interaction
 * mode are handled by in-place updaters and intentionally do NOT force a
 * recreate.
 */
export function stageRenderKey(circuit, options = {}) {
  if (!circuit) {
    return '';
  }
  const snapshot = createStageDebugSnapshot(circuit, {
    visualTransformRevision: options.visualTransformRevision ?? 0
  });
  return `${snapshot.circuitSpecHash}::${snapshot.visualTransformRevision}`;
}

export function stagePartPositionSnapshot(circuit) {
  const specializedParts = Object.values(stageSpecializedPartDescriptors(circuit)).filter(Boolean);
  const descriptors = [
    ...specializedParts,
    ...stageGenericPartDescriptors(circuit),
    ...(shouldRenderLibraryParts(circuit) ? stageLibraryPartDescriptors(circuit) : [])
  ].filter((descriptor) => descriptor?.id);

  return Object.fromEntries(
    descriptors
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))
      .map((descriptor) => [descriptor.id, roundedVectorSnapshot(descriptor.position)])
  );
}

export function stageWireRouteHash(circuit) {
  const endpoints = stageEndpointMap(circuit);
  const routeSnapshot = (circuit?.connections ?? []).map((connection, index) => {
    const fromKey = endpointKey(connection.from);
    const toKey = endpointKey(connection.to);
    const from = endpoints[fromKey];
    const to = endpoints[toKey];
    const points = from && to
      ? stageConnectionRoutePoints(connection, from, to, index).map(roundedVectorSnapshot)
      : (connection.route ?? []).filter(isFiniteVector).map(roundedVectorSnapshot);
    return {
      id: connection.id,
      from: fromKey,
      to: toKey,
      points
    };
  });
  return stableStageHash(routeSnapshot);
}

function stableStageHash(value) {
  const input = stableStageStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableStageStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStageStringify(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStageStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function boxSnapshot(box) {
  if (!box) {
    return null;
  }
  return {
    min: roundedVectorSnapshot(box.min),
    max: roundedVectorSnapshot(box.max),
    size: roundedVectorSnapshot(new THREE.Vector3(
      box.max.x - box.min.x,
      box.max.y - box.min.y,
      box.max.z - box.min.z
    ))
  };
}

function roundedVectorSnapshot(point) {
  const vector = vectorSnapshot(point);
  return {
    x: Number(vector.x.toFixed(3)),
    y: Number(vector.y.toFixed(3)),
    z: Number(vector.z.toFixed(3))
  };
}

function vectorSnapshot(point) {
  return {
    x: Number.isFinite(point?.x) ? point.x : 0,
    y: Number.isFinite(point?.y) ? point.y : 0,
    z: Number.isFinite(point?.z) ? point.z : 0
  };
}

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

function addBreadboard(root, stats, descriptor, sceneGraph = null) {
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
  addDescriptorLabel(root, descriptor, 'Breadboard', [base.x, base.y + 0.34, base.z], 0.7, sceneGraph);
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

function addArduino(root, stats, descriptor, sceneGraph = null) {
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
  addDescriptorLabel(root, descriptor, 'Arduino', [base.x, base.y + 0.37, base.z], 0.58, sceneGraph);
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

function addOled(root, texture, stats, descriptor, sceneGraph = null) {
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

  addDescriptorLabel(root, descriptor, 'OLED', [base.x, base.y + 0.41, base.z - 0.5], 0.44, sceneGraph);
}

function addLibraryModels(root, circuit, stats, sceneGraph = null) {
  if (!shouldRenderLibraryParts(circuit)) {
    return [];
  }
  const descriptors = stageLibraryPartDescriptors(circuit);
  for (const descriptor of descriptors) {
    const partRoot = sceneGraph?.partGroupFor(descriptor) ?? root;
    addGenericPart(partRoot, descriptor, stats, sceneGraph);
  }
  return descriptors;
}

function addGenericRenderPlanParts(root, circuit, stats, sceneGraph = null) {
  const descriptors = stageGenericPartDescriptors(circuit);
  for (const descriptor of descriptors) {
    const partRoot = sceneGraph?.partGroupFor(descriptor) ?? root;
    addGenericPart(partRoot, descriptor, stats, sceneGraph);
  }
  return descriptors;
}

function addGenericPart(root, descriptor, stats, sceneGraph = null) {
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
  } else if (descriptor.shape === 'ceramic-disc-capacitor') {
    const discHeight = Math.max(descriptor.size.height, 0.38);
    const discRadius = Math.max(descriptor.size.width, discHeight) / 2;
    body = new THREE.Mesh(
      new THREE.CylinderGeometry(discRadius, discRadius, descriptor.size.depth, 32),
      new THREE.MeshStandardMaterial({ color: descriptor.color, roughness: 0.58 })
    );
    body.rotation.x = Math.PI / 2;
    body.scale.y = discHeight / Math.max(descriptor.size.width, 0.001);
    body.position.set(position.x, position.y + discHeight * 0.58, position.z);
    root.add(tagInspectable(body, target));
    addFootprintLeads(root, descriptor, stats, target);
  } else if (descriptor.shape === 'radial-electrolytic-capacitor') {
    const capacitorHeight = Math.max(descriptor.size.height, 0.5);
    const capacitorRadius = Math.max(descriptor.size.width, descriptor.size.depth) / 2;
    body = new THREE.Mesh(
      new THREE.CylinderGeometry(capacitorRadius, capacitorRadius, capacitorHeight, 32),
      new THREE.MeshStandardMaterial({ color: descriptor.color, roughness: 0.42, metalness: 0.12 })
    );
    body.position.set(position.x, position.y + capacitorHeight / 2 + 0.08, position.z);
    root.add(tagInspectable(body, target));

    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, capacitorHeight * 0.72, 0.012),
      new THREE.MeshStandardMaterial({ color: '#e6e7eb', roughness: 0.5 })
    );
    stripe.position.set(position.x + capacitorRadius * 0.72, position.y + capacitorHeight / 2 + 0.08, position.z + capacitorRadius + 0.004);
    root.add(tagInspectable(stripe, target));
    addFootprintLeads(root, descriptor, stats, target);
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
    ], Math.max(0.32, Math.min(0.56, descriptor.size.width)), sceneGraph);
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

function addFootprintLeads(root, descriptor, stats, target) {
  const anchors = Object.values(descriptor.footprint?.pinAnchors ?? {});
  const leadHeight = 0.2;
  const leadGeometry = new THREE.CylinderGeometry(0.012, 0.012, leadHeight, 8);
  for (const anchor of anchors) {
    if (!isFiniteVector(anchor)) {
      continue;
    }
    const x = descriptor.position.x + anchor.x;
    const z = descriptor.position.z + anchor.z;
    const lead = new THREE.Mesh(leadGeometry, PIN_METAL_MAT);
    lead.position.set(x, descriptor.position.y + leadHeight / 2 - 0.025, z);
    root.add(tagInspectable(lead, target));
    addSolderJoint(root, {
      x,
      y: descriptor.position.y - 0.02,
      z
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

function addWires(root, circuit, stats, selectedTargetKey = '', sceneGraph = null) {
  const endpoints = stageEndpointMap(circuit);

  return circuit.connections.flatMap((connection, index) => {
    const wireRoot = sceneGraph?.wireGroupFor(connection) ?? root;
    const target = { type: 'connection', connectionId: connection.id };
    const isSelected = selectedTargetKey === `connection:${connection.id}`;
    const from = endpoints[endpointKey(connection.from)];
    const to = endpoints[endpointKey(connection.to)];
    if (!from || !to) {
      return [];
    }

    addWireConnector(wireRoot, from, connection.color, stats, target);
    addWireConnector(wireRoot, to, connection.color, stats, target);

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
    wireRoot.add(wire);
    return [{
      curve,
      color: connection.color,
      connectionId: connection.id,
      fromKey: endpointKey(connection.from),
      toKey: endpointKey(connection.to)
    }];
  });
}

function updateVisualPreviewWires(sceneGraph, circuit) {
  const transforms = sceneGraph.visualTransformSnapshot();
  const transformedPartIds = new Set(Object.keys(transforms));
  for (const group of sceneGraph.previewWireGroupsByConnectionId.values()) {
    clearThreeGroup(group);
    group.visible = false;
  }
  if (!transformedPartIds.size) {
    sceneGraph.setPreviewWireRouteHash('');
    return '';
  }

  const endpoints = stageEndpointMap(circuit);
  const routeSnapshot = [];
  for (const [index, connection] of (circuit?.connections ?? []).entries()) {
    const fromKey = endpointKey(connection.from);
    const toKey = endpointKey(connection.to);
    const fromPartId = componentIdFromEndpoint(fromKey);
    const toPartId = componentIdFromEndpoint(toKey);
    const affected = transformedPartIds.has(fromPartId) || transformedPartIds.has(toPartId);
    const from = endpoints[fromKey];
    const to = endpoints[toKey];
    if (!affected || !from || !to) {
      continue;
    }

    const previewFrom = applyVisualOffsetToPoint(sceneGraph, fromPartId, from);
    const previewTo = applyVisualOffsetToPoint(sceneGraph, toPartId, to);
    const points = stageVisualPreviewRoutePoints(previewFrom, previewTo, index);
    const previewGroup = sceneGraph.previewWireGroupFor(connection.id);
    previewGroup.visible = true;
    addPreviewWire(previewGroup, points, connection.color);
    routeSnapshot.push({
      id: connection.id,
      from: fromKey,
      to: toKey,
      points: points.map(roundedVectorSnapshot)
    });
  }

  const hash = routeSnapshot.length ? stableStageHash(routeSnapshot) : '';
  sceneGraph.setPreviewWireRouteHash(hash);
  return hash;
}

function clearThreeGroup(group) {
  while (group.children.length) {
    const child = group.children[0];
    group.remove(child);
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material)
      ? child.material
      : child.material ? [child.material] : [];
    for (const material of materials) {
      if (SHARED_MATERIALS.has(material)) {
        continue;
      }
      material.map?.dispose?.();
      material.dispose?.();
    }
  }
}

function applyVisualOffsetToPoint(sceneGraph, partId, point) {
  const offset = sceneGraph.partVisualOffset(partId);
  return new THREE.Vector3(point.x + offset.x, point.y + offset.y, point.z + offset.z);
}

function stageVisualPreviewRoutePoints(from, to, index = 0) {
  const fromTop = new THREE.Vector3(from.x, from.y + 0.28, from.z);
  const toTop = new THREE.Vector3(to.x, to.y + 0.28, to.z);
  const peak = new THREE.Vector3(
    (from.x + to.x) / 2,
    Math.max(from.y, to.y) + 0.72 + index * 0.05,
    (from.z + to.z) / 2 + (index % 2 === 0 ? -0.18 : 0.18)
  );
  return [fromTop, peak, toTop];
}

function addPreviewWire(root, points, color = '#ffffff') {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineDashedMaterial({
    color,
    dashSize: 0.12,
    gapSize: 0.08,
    transparent: true,
    opacity: 0.72
  });
  const line = new THREE.Line(geometry, material);
  line.computeLineDistances();
  line.userData.stageGraphRole = 'preview-wire';
  root.add(line);
}

// ---------------------------------------------------------------------------
// Phase 3 — wire drag helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Ensure a route array has at least 2 THREE.Vector3 points. When the route
 * is empty or has only 1 point, inserts a midpoint between `from` and `to`
 * so the CatmullRomCurve3 always gets a valid shape. Returns the same array
 * reference when length >= 2.
 */
export function ensureMinRoutePoints(route, from, to) {
  if (route.length >= 2) {
    return route;
  }
  if (route.length === 0) {
    const mid = new THREE.Vector3(
      (from.x + to.x) / 2,
      Math.max(from.y, to.y) + 0.5,
      (from.z + to.z) / 2
    );
    return [from.clone(), mid, to.clone()];
  }
  // length === 1: keep the single point and append the to endpoint
  const mid = new THREE.Vector3(
    (route[0].x + to.x) / 2,
    Math.max(route[0].y, to.y) + 0.3,
    (route[0].z + to.z) / 2
  );
  return [route[0], mid, to.clone()];
}

/**
 * Imperatively rebuild the geometry and material on an existing wire tube
 * mesh, disposing the prior GPU resources. Called each pointermove during
 * a wire-bend drag — does NOT trigger a stageRenderKey recreate.
 *
 * @param {THREE.Mesh} mesh - the wire tube mesh to update in place
 * @param {THREE.Vector3[]} points - the new route control points (>=2)
 * @param {{ color: string|number, radius: number, emissiveIntensity: number }} style
 */
export function rebuildWireTubeMesh(mesh, points, { color, radius = 0.032, emissiveIntensity = 0.12 } = {}) {
  const oldGeo = mesh.geometry;
  const oldMat = mesh.material;

  const curve = new THREE.CatmullRomCurve3(points);
  mesh.geometry = new THREE.TubeGeometry(curve, 56, radius, 12);
  mesh.material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.34,
    metalness: 0.05,
    emissive: color,
    emissiveIntensity
  });
  mesh.userData.wireCurve = curve;

  // Dispose BOTH old geometry AND material to prevent GPU buffer leaks.
  oldGeo?.dispose?.();
  oldMat?.dispose?.();
}

/**
 * Apply or clear a wire-selection highlight in place on all wire-tube meshes
 * in the scene graph. Thickens + brightens the selected wire; resets others.
 * Returns the count of wire groups reconciled.
 *
 * Reuses existing geometry when the radius is unchanged (avoids rebuild on
 * repeated calls with the same selection).
 */
export function applyWireSelectionHighlight(sceneGraph, selectedTargetKey) {
  let touched = 0;
  for (const [connectionId, group] of sceneGraph.wireGroupsByConnectionId) {
    const isSelected = selectedTargetKey === `connection:${connectionId}`;
    const targetRadius = isSelected ? 0.048 : 0.032;
    const targetEmissive = isSelected ? 0.72 : 0.12;
    for (const child of group.children) {
      if (child.userData?.stageGraphRole !== 'wire-tube') {
        continue;
      }
      // Only rebuild when the radius changes to avoid per-render churning.
      if (child.geometry?.parameters?.radius !== targetRadius) {
        const curve = child.userData.wireCurve;
        if (curve) {
          const oldGeo = child.geometry;
          child.geometry = new THREE.TubeGeometry(curve, 56, targetRadius, 12);
          oldGeo?.dispose?.();
        }
      }
      if (child.material) {
        child.material.emissiveIntensity = targetEmissive;
      }
      touched += 1;
    }
  }
  return touched;
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

function shouldRenderLibraryParts(circuit) {
  return circuit?.showLibraryParts === true
    || circuit?.renderLibraryParts === true
    || circuit?.metadata?.showLibraryParts === true;
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
  breadboard: {
    shape: 'breadboard',
    color: '#eeece7',
    material: 'plastic',
    size: { width: 5.6, depth: 2.15, height: 0.18 }
  },
  arduino: {
    shape: 'arduino',
    color: '#0a765d',
    material: 'pcb-module',
    size: { width: 2.05, depth: 1.28, height: 0.25 }
  },
  oled: {
    shape: 'oled',
    color: '#103950',
    material: 'pcb-module',
    size: { width: 1.45, depth: 0.88, height: 0.22 }
  },
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

function addDescriptorLabel(root, descriptor, fallbackText, fallbackPosition, fallbackWidth, sceneGraph = null) {
  const label = descriptor.labelLayout;
  const labelRoot = sceneGraph?.labelGroupFor(descriptor, root) ?? root;
  addLabel(
    labelRoot,
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

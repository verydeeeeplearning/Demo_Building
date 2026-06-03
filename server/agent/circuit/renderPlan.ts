// renderPlan.ts — extracted verbatim from circuitTools.ts (god-module split, Phase B).
// Pure relocation: no signatures or behavior changed. See PLAN_god_module_refactor.md.
import {
  getPartRegistry,
  loadBreadboardGrid,
  loadRenderFootprints
} from '../../context/contextLayer.ts';
import {
  type CircuitSpec,
  type PartCapability,
  type RenderFootprintEntry,
  type RenderPlan,
  RenderPlanSchema,
  type SolverAttempt,
  type ValidationReport
} from '../schemas.ts';
import {
  auditBreadboardContinuityConflicts,
  auditBreadboardGridSnap,
  auditBreadboardPhysicalNodeConflicts,
  auditBreadboardPinTopology,
  auditBreadboardRailConflicts
} from './breadboardAudit.ts';
import {
  RenderWarning,
  nearestGridValue,
  renderEndpointKey,
  requiresBreadboardSurfaceForPlacement,
  requiresStrictBreadboardGridAudit,
  unique
} from './shared.ts';

export const SIGNAL_COLORS: Record<string, string> = {
  power: '#ff4d3d',
  ground: '#20242a',
  gpio: '#2f7df6',
  digital: '#2f7df6',
  pulse: '#84a9ff',
  'digital-pulse': '#84a9ff',
  analog: '#2f7df6',
  button: '#7c3aed',
  pwm: '#f97316',
  clock: '#f6c44c',
  data: '#2f7df6',
  'chip-select': '#7c3aed',
  'single-wire-data': '#9bd67d',
  'clocked-data': '#9bd67d',
  'spi-data': '#2f7df6',
  spi: '#2f7df6',
  'spi-clock': '#f6c44c',
  uart: '#84a9ff',
  'i2c-data': '#2f7df6',
  'i2c-clock': '#f6c44c'
};

export const AUTO_PLACEMENT_REPAIR_WARNING_CODES = new Set([
  'BREADBOARD_PLACEMENT_SURFACE_MISSING',
  'BREADBOARD_PLACEMENT_OUT_OF_BOUNDS',
  'BREADBOARD_PIN_ROW_COLLAPSE',
  'BREADBOARD_PIN_GRID_MISALIGNMENT',
  'PART_COLLISION'
]);

export type RenderPartEntry = {
  component: CircuitSpec['components'][number];
  index: number;
  part: PartCapability | undefined;
  type: string;
  footprint: RenderFootprintEntry | undefined;
};

export function buildRenderPartsFromEntries(
  entries: RenderPartEntry[],
  autoPositions: Map<string, { x: number; y: number; z: number }>,
  useExplicitPositionHints: boolean
): RenderPlan['parts'] {
  return entries.map(({ component, index, part, type, footprint }) => ({
    id: component.id,
    type,
    label: component.label,
    designator: component.designator,
    description: part?.label ?? '',
    pins: (part?.pins ?? []).map((pin) => ({
      name: pin.name,
      role: pin.role,
      meaning: explainPin(pin.role)
    })),
    position:
      (useExplicitPositionHints ? component.position : undefined) ??
      autoPositions.get(component.id) ??
      defaultPosition(index),
    footprint
  }));
}

export function auditRenderPlacementPhase(
  renderParts: RenderPlan['parts'],
  breadboardGrid: Awaited<ReturnType<typeof loadBreadboardGrid>>
): RenderWarning[] {
  return [
    ...auditRenderPlacement(renderParts),
    ...auditPartCollisions(renderParts),
    ...auditBreadboardPinTopology(renderParts),
    ...auditBreadboardGridSnap(renderParts, breadboardGrid)
  ];
}

export function formatRenderWarning(warning: RenderWarning) {
  const component = warning.componentId ? ` on ${warning.componentId}` : '';
  return `${warning.code}${component}: ${warning.message}`;
}

export async function compileRenderPlan(
  spec: CircuitSpec,
  validationReport: ValidationReport
): Promise<RenderPlan> {
  if (validationReport.status === 'unsupported' && isClarificationOnlySpec(spec)) {
    return RenderPlanSchema.parse({
      title: spec.title,
      runText: spec.behavior.runText,
      parts: [],
      connections: [],
      floatingCards: []
    });
  }
  const diagnosticRenderOnly = validationReport.status !== 'valid';

  const [parts, footprints, breadboardGrid] = await Promise.all([
    getPartRegistry(),
    loadRenderFootprints(),
    loadBreadboardGrid()
  ]);
  const partsById = new Map(parts.map((part) => [part.id, part]));
  const renderWarnings: RenderWarning[] = diagnosticRenderOnly
    ? [
        {
          code: 'DIAGNOSTIC_RENDER_ONLY',
          message: `Validation status is ${validationReport.status}; renderable hardware is shown for diagnosis only and is not build-ready.`
        }
      ]
    : [];
  const renderPartEntries = spec.components.map((component, index) => {
    const part = partsById.get(component.partId);
    const type = part?.renderFootprint.type ?? component.partId;
    const footprint = footprints[type];
    if (!footprint) {
      renderWarnings.push({
        code: 'MISSING_RENDER_FOOTPRINT',
        componentId: component.id,
        message: `${component.label} is validated electrically but has no render footprint in the catalog.`
      });
    }
    return { component, index, part, type, footprint };
  });
  const hintedAutoPositions = planDefaultRenderPositions(renderPartEntries, breadboardGrid, {
    useExplicitPositionHints: true
  });
  const repairedAutoPositions = planDefaultRenderPositions(renderPartEntries, breadboardGrid, {
    useExplicitPositionHints: false
  });
  const hasExplicitPositionHints = renderPartEntries.some(({ component }) =>
    Boolean(component.position)
  );
  const hintedRenderParts = buildRenderPartsFromEntries(
    renderPartEntries,
    hintedAutoPositions,
    true
  );
  const hintedPlacementWarnings = auditRenderPlacementPhase(hintedRenderParts, breadboardGrid);
  const hintedRepairWarnings = hintedPlacementWarnings.filter((warning) =>
    AUTO_PLACEMENT_REPAIR_WARNING_CODES.has(warning.code)
  );
  const repairExplicitPositions = hasExplicitPositionHints && hintedRepairWarnings.length > 0;
  const renderParts = repairExplicitPositions
    ? buildRenderPartsFromEntries(renderPartEntries, repairedAutoPositions, false)
    : hintedRenderParts;
  const placementWarnings = auditRenderPlacementPhase(renderParts, breadboardGrid);
  const placementRepairStillBlocked = placementWarnings.some((warning) =>
    AUTO_PLACEMENT_REPAIR_WARNING_CODES.has(warning.code)
  );
  const solverAttempts: SolverAttempt[] = [
    {
      attempt: 1,
      stage: 'placement',
      action: repairExplicitPositions
        ? 'Rejected explicit component position hints after placement DRC found a physical layout violation; rebuilt placement from deterministic footprint and breadboard constraints.'
        : hasExplicitPositionHints
          ? 'Accepted explicit component position hints after placement DRC.'
          : 'Generated deterministic component placement from footprint, surface, and breadboard-grid constraints.',
      result: repairExplicitPositions
        ? placementRepairStillBlocked
          ? 'degraded'
          : 'repaired'
        : placementRepairStillBlocked
          ? 'degraded'
          : 'passed',
      warnings: repairExplicitPositions
        ? unique([
            ...hintedRepairWarnings.map(formatRenderWarning),
            ...placementWarnings
              .filter((warning) => AUTO_PLACEMENT_REPAIR_WARNING_CODES.has(warning.code))
              .map(formatRenderWarning)
          ])
        : placementWarnings
            .filter((warning) => AUTO_PLACEMENT_REPAIR_WARNING_CODES.has(warning.code))
            .map(formatRenderWarning)
    }
  ];
  renderWarnings.push(...placementWarnings);

  const baseRenderConnections = spec.connections.map((connection) => ({
    id: connection.id,
    from: toRenderEndpoint(connection.from),
    to: toRenderEndpoint(connection.to),
    signal: connection.signal,
    color: connection.color ?? SIGNAL_COLORS[connection.signal] ?? '#2f7df6',
    education: connection.education ?? explainConnection(connection)
  }));
  const endpointLayout = compileEndpointLayout(renderParts, footprints);
  const renderConnections = baseRenderConnections.map((connection, index) => ({
    ...connection,
    route: compileConnectionRoute(connection, endpointLayout, index)
  }));
  const connectionWarnings = auditRenderConnections(renderConnections, endpointLayout);
  renderWarnings.push(...connectionWarnings);
  const unroutedConnections = renderConnections.filter((connection) => !connection.route);
  solverAttempts.push({
    attempt: solverAttempts.length + 1,
    stage: 'routing',
    action:
      unroutedConnections.length === 0
        ? 'Generated server-routed wire polylines from resolved endpoint anchors.'
        : 'Some wire endpoints were missing render anchors, so those routes are diagnostic rather than verified.',
    result:
      unroutedConnections.length === 0 && connectionWarnings.length === 0 ? 'passed' : 'degraded',
    warnings: unique([
      ...unroutedConnections.map(
        (connection) => `Connection ${connection.id} has no server-verified route.`
      ),
      ...connectionWarnings.map(formatRenderWarning)
    ])
  });
  renderWarnings.push(
    ...auditBreadboardPhysicalNodeConflicts(renderParts, renderConnections, breadboardGrid)
  );
  renderWarnings.push(
    ...auditBreadboardContinuityConflicts(renderParts, renderConnections, breadboardGrid)
  );
  renderWarnings.push(
    ...auditBreadboardRailConflicts(renderParts, renderConnections, breadboardGrid)
  );
  const labelLayoutResult = compileLabelLayout(renderParts);
  const labelLayout = labelLayoutResult.labels;
  const labelWarnings = auditLabelLayout(renderParts, labelLayout);
  renderWarnings.push(...labelWarnings);
  solverAttempts.push({
    attempt: solverAttempts.length + 1,
    stage: 'label',
    action:
      labelLayoutResult.repositionedLabelCount > 0
        ? `Repositioned ${labelLayoutResult.repositionedLabelCount} label(s) away from candidate overlap zones.`
        : 'Placed labels at their primary footprint anchors.',
    result:
      labelWarnings.length > 0
        ? 'degraded'
        : labelLayoutResult.repositionedLabelCount > 0
          ? 'repaired'
          : 'passed',
    warnings: labelWarnings.map(formatRenderWarning)
  });
  const bounds = compileSceneBounds(renderParts, endpointLayout, labelLayout);
  const camera = compileCameraFit(bounds);
  const cameraWarnings = auditRenderCameraFit(bounds, camera);
  renderWarnings.push(...cameraWarnings);
  solverAttempts.push({
    attempt: solverAttempts.length + 1,
    stage: 'camera',
    action: 'Generated camera fit from final scene bounds, endpoints, and labels.',
    result: cameraWarnings.length > 0 ? 'degraded' : 'passed',
    warnings: cameraWarnings.map(formatRenderWarning)
  });

  return RenderPlanSchema.parse({
    title: spec.title,
    runText: spec.behavior.runText,
    parts: renderParts,
    connections: renderConnections,
    floatingCards: renderConnections.map((connection) => ({
      connectionId: connection.id,
      label: connection.education.label,
      title: connection.education.title,
      body: connection.education.what
    })),
    warnings: renderWarnings,
    layout: {
      endpoints: endpointLayout,
      labels: labelLayout,
      bounds,
      camera,
      solverAttempts
    }
  });
}

export function isClarificationOnlySpec(spec: CircuitSpec) {
  return spec.unsupportedItems.some((item) => item === 'clarification-required');
}

export function toRenderEndpoint(endpoint: CircuitSpec['connections'][number]['from']) {
  return {
    partId: endpoint.componentId,
    pin: endpoint.pin
  };
}

export function compileEndpointLayout(
  renderParts: RenderPlan['parts'],
  footprints: Record<string, RenderFootprintEntry>
) {
  const endpoints: Record<string, { x: number; y: number; z: number }> = {};
  for (const part of renderParts) {
    const footprint = footprints[part.type];
    if (!footprint) {
      continue;
    }
    for (const [pinName, anchor] of Object.entries(footprint.pinAnchors)) {
      endpoints[`${part.id}:${pinName}`] = {
        x: part.position.x + anchor.x,
        y: part.position.y + anchor.y,
        z: part.position.z + anchor.z
      };
    }
  }
  return endpoints;
}

export type RenderSceneBounds = NonNullable<NonNullable<RenderPlan['layout']>['bounds']>;

export type RenderCameraFit = NonNullable<NonNullable<RenderPlan['layout']>['camera']>;

export function compileSceneBounds(
  renderParts: RenderPlan['parts'],
  endpoints: Record<string, { x: number; y: number; z: number }>,
  labels: NonNullable<NonNullable<RenderPlan['layout']>['labels']> = {}
): RenderSceneBounds {
  const extents = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY
  };

  for (const part of renderParts) {
    const footprint = part.footprint;
    if (!footprint) {
      includeBoundsPoint(extents, part.position);
      continue;
    }
    includeBoundsPoint(extents, {
      x: part.position.x - footprint.width / 2,
      y: part.position.y,
      z: part.position.z - footprint.depth / 2
    });
    includeBoundsPoint(extents, {
      x: part.position.x + footprint.width / 2,
      y: part.position.y + footprint.height + 0.45,
      z: part.position.z + footprint.depth / 2
    });
  }

  for (const endpoint of Object.values(endpoints)) {
    includeBoundsPoint(extents, endpoint);
  }

  for (const label of Object.values(labels)) {
    includeBoundsPoint(extents, {
      x: label.position.x - label.width / 2,
      y: label.position.y - label.height / 2,
      z: label.position.z
    });
    includeBoundsPoint(extents, {
      x: label.position.x + label.width / 2,
      y: label.position.y + label.height / 2,
      z: label.position.z
    });
  }

  if (!Number.isFinite(extents.minX)) {
    includeBoundsPoint(extents, { x: 0, y: 0, z: 0 });
  }

  const min = { x: extents.minX, y: extents.minY, z: extents.minZ };
  const max = { x: extents.maxX, y: extents.maxY, z: extents.maxZ };
  const size = {
    x: Math.max(0, max.x - min.x),
    y: Math.max(0, max.y - min.y),
    z: Math.max(0, max.z - min.z)
  };
  const center = {
    x: min.x + size.x / 2,
    y: min.y + size.y / 2,
    z: min.z + size.z / 2
  };
  const radius = Math.sqrt(size.x ** 2 + size.y ** 2 + size.z ** 2) / 2;

  return { min, max, center, size, radius };
}

export function includeBoundsPoint(
  extents: {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
  },
  point: { x: number; y: number; z: number }
) {
  extents.minX = Math.min(extents.minX, point.x);
  extents.minY = Math.min(extents.minY, point.y);
  extents.minZ = Math.min(extents.minZ, point.z);
  extents.maxX = Math.max(extents.maxX, point.x);
  extents.maxY = Math.max(extents.maxY, point.y);
  extents.maxZ = Math.max(extents.maxZ, point.z);
}

export function compileCameraFit(bounds: RenderSceneBounds): RenderCameraFit {
  const fov = 38;
  const fovRadians = (fov * Math.PI) / 180;
  const distanceForRadius = bounds.radius > 0 ? bounds.radius / Math.sin(fovRadians / 2) : 0;
  const horizontalSpan = Math.max(bounds.size.x, bounds.size.z);
  // RC-D: the framing the audit demands grows with the scene radius (~3.16 * radius). A fixed upper
  // clamp of 40 would cap the distance BELOW that for large scenes (radius > ~12.6), producing a
  // false CAMERA_CLIPPING block on otherwise-valid circuits. Let the ceiling grow with the desired
  // distance so the clamp never cuts below the radius-driven framing — a no-op for small scenes
  // (desiredDistance < 40), only lifting the cap when the scene genuinely needs it.
  const desiredDistance = Math.max(4.8, distanceForRadius * 1.12, horizontalSpan * 1.45);
  const distance = clampNumber(desiredDistance, 4.8, Math.max(40, desiredDistance));
  const directionLength = Math.hypot(0.62, 0.52, 0.58);
  const direction = {
    x: 0.62 / directionLength,
    y: 0.52 / directionLength,
    z: 0.58 / directionLength
  };
  const target = {
    x: bounds.center.x,
    y: Math.max(0, bounds.center.y),
    z: bounds.center.z
  };

  return {
    position: {
      x: target.x + direction.x * distance,
      y: target.y + direction.y * distance,
      z: target.z + direction.z * distance
    },
    target,
    fov,
    minDistance: Math.max(3, distance * 0.48),
    maxDistance: Math.max(9, distance * 1.75)
  };
}

export function auditRenderCameraFit(
  bounds: RenderSceneBounds,
  camera: RenderCameraFit
): RenderWarning[] {
  const distance = distanceBetween(camera.position, camera.target);
  const fovRadians = (camera.fov * Math.PI) / 180;
  const requiredDistance =
    bounds.radius > 0 ? (bounds.radius / Math.sin(fovRadians / 2)) * 1.03 : 0;

  if (!Number.isFinite(distance) || distance < requiredDistance) {
    return [
      {
        code: 'CAMERA_CLIPPING',
        message: `The fitted camera distance (${distance.toFixed(2)}) is too short for the scene radius (${bounds.radius.toFixed(2)}), so the visible render may clip parts.`
      }
    ];
  }

  if (camera.maxDistance < distance || camera.minDistance > distance) {
    return [
      {
        code: 'CAMERA_CLIPPING',
        message:
          'The fitted camera lies outside its zoom clamp, so the visible render framing cannot be trusted.'
      }
    ];
  }

  return [];
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function compileConnectionRoute(
  connection: Pick<RenderPlan['connections'][number], 'from' | 'to'>,
  endpoints: Record<string, { x: number; y: number; z: number }>,
  index: number
) {
  const fromPoint = endpoints[renderEndpointKey(connection.from)];
  const toPoint = endpoints[renderEndpointKey(connection.to)];
  if (!fromPoint || !toPoint) {
    return undefined;
  }

  const fromTop = { x: fromPoint.x, y: fromPoint.y + 0.24, z: fromPoint.z };
  const toTop = { x: toPoint.x, y: toPoint.y + 0.24, z: toPoint.z };
  const span = Math.hypot(fromPoint.x - toPoint.x, fromPoint.z - toPoint.z);
  const laneOffset = ((index % 5) - 2) * 0.08;
  const peakLift = clampNumber(0.42 + span * 0.18, 0.55, 1.35);

  return [
    fromTop,
    {
      x: (fromTop.x + toTop.x) / 2,
      y: Math.max(fromTop.y, toTop.y) + peakLift,
      z: (fromTop.z + toTop.z) / 2 + laneOffset
    },
    toTop
  ];
}

export function compileLabelLayout(renderParts: RenderPlan['parts']) {
  const labels: NonNullable<NonNullable<RenderPlan['layout']>['labels']> = {};
  const placedLabels: Array<NonNullable<NonNullable<RenderPlan['layout']>['labels']>[string]> = [];
  let repositionedLabelCount = 0;
  for (const part of renderParts) {
    const text = part.designator || compactLabelText(part.label || part.id);
    const footprint = part.footprint;
    const width = estimateLabelWidth(text, footprint);
    const baseLabel = {
      partId: part.id,
      text,
      width,
      height: width * 0.36
    };
    const { label: placedLabel, candidateIndex } = chooseLabelPlacement(
      part,
      baseLabel,
      renderParts,
      placedLabels
    );
    if (candidateIndex > 0) {
      repositionedLabelCount += 1;
    }
    labels[part.id] = placedLabel;
    placedLabels.push(placedLabel);
  }
  return { labels, repositionedLabelCount };
}

export function chooseLabelPlacement(
  part: RenderPlan['parts'][number],
  label: Omit<NonNullable<NonNullable<RenderPlan['layout']>['labels']>[string], 'position'>,
  renderParts: RenderPlan['parts'],
  placedLabels: Array<NonNullable<NonNullable<RenderPlan['layout']>['labels']>[string]>
) {
  const candidates = labelPlacementCandidates(part, label);
  const candidateIndex = candidates.findIndex(
    (candidate) =>
      !placedLabels.some((placed) => labelBoundsOverlap(candidate, placed, 0.04)) &&
      !renderParts.some(
        (otherPart) =>
          otherPart.id !== part.id &&
          otherPart.footprint &&
          !isPlacementSurfaceFootprint(otherPart.footprint) &&
          labelOverlapsPart(candidate, otherPart, 0.02)
      )
  );
  if (candidateIndex >= 0) {
    return { label: candidates[candidateIndex], candidateIndex };
  }
  // No fully-free spot (crowded scene): pick the candidate with the LEAST total overlap area rather
  // than falling back to candidates[0] (the on-part anchor, a guaranteed overlap). This is what kept
  // LABEL_OVERLAP firing — the worst position was chosen on failure. (PLAN_sensible_simulation P2)
  let bestIndex = 0;
  let bestArea = Infinity;
  for (let index = 0; index < candidates.length; index += 1) {
    const area = labelOverlapArea(candidates[index], part.id, renderParts, placedLabels);
    if (area < bestArea) {
      bestArea = area;
      bestIndex = index;
    }
  }
  return { label: candidates[bestIndex], candidateIndex: bestIndex };
}

function rectOverlapArea(
  a: { minX: number; maxX: number; minZ: number; maxZ: number },
  b: { minX: number; maxX: number; minZ: number; maxZ: number }
) {
  const dx = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const dz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  return dx > 0 && dz > 0 ? dx * dz : 0;
}

// Total top-down (XZ) overlap area of a candidate label against already-placed labels and part
// footprints. Used to choose the least-bad spot when no fully-clear position exists.
function labelOverlapArea(
  candidate: NonNullable<NonNullable<RenderPlan['layout']>['labels']>[string],
  ownPartId: string,
  renderParts: RenderPlan['parts'],
  placedLabels: Array<NonNullable<NonNullable<RenderPlan['layout']>['labels']>[string]>
) {
  const box = labelBounds(candidate, 0.04);
  let area = 0;
  for (const placed of placedLabels) {
    area += rectOverlapArea(box, labelBounds(placed, 0.04));
  }
  for (const part of renderParts) {
    if (part.id === ownPartId || !part.footprint || part.footprint.type === 'wire' || isPlacementSurfaceFootprint(part.footprint)) {
      continue;
    }
    area += rectOverlapArea(box, footprintBounds(part.position, part.footprint));
  }
  return area;
}

export function labelPlacementCandidates(
  part: RenderPlan['parts'][number],
  label: Omit<NonNullable<NonNullable<RenderPlan['layout']>['labels']>[string], 'position'>
) {
  const footprint = part.footprint;
  const anchor = footprint?.labelAnchor ?? { x: 0, y: (footprint?.height ?? 0.2) + 0.24, z: 0 };
  const width = footprint?.width ?? 0.44;
  const depth = footprint?.depth ?? 0.32;
  const height = footprint?.height ?? 0.2;
  const lift = height + 0.34;
  const spacing = Math.max(0.22, label.height + 0.08);
  const makeLabel = (offset: { x: number; y: number; z: number }) => ({
    ...label,
    position: {
      x: part.position.x + offset.x,
      y: part.position.y + offset.y,
      z: part.position.z + offset.z
    }
  });

  const lateral = width / 2 + label.width / 2 + spacing;
  const far = spacing * 2.6;
  const lateralFar = width / 2 + label.width / 2 + far;
  return [
    makeLabel(anchor),
    // Near ring (4 sides + 2 diagonals).
    makeLabel({ x: 0, y: lift, z: -depth / 2 - spacing }),
    makeLabel({ x: 0, y: lift, z: depth / 2 + spacing }),
    makeLabel({ x: -lateral, y: lift, z: 0 }),
    makeLabel({ x: lateral, y: lift, z: 0 }),
    makeLabel({ x: -lateral, y: lift + 0.22, z: -depth / 2 - spacing }),
    makeLabel({ x: lateral, y: lift + 0.22, z: depth / 2 + spacing }),
    makeLabel({ x: 0, y: lift + 0.22, z: 0 }),
    // Far ring — pushes labels into open scene space when the part is crowded (PLAN_sensible P2).
    makeLabel({ x: 0, y: lift, z: -depth / 2 - far }),
    makeLabel({ x: 0, y: lift, z: depth / 2 + far }),
    makeLabel({ x: -lateralFar, y: lift, z: 0 }),
    makeLabel({ x: lateralFar, y: lift, z: 0 }),
    makeLabel({ x: -lateralFar, y: lift, z: -depth / 2 - far }),
    makeLabel({ x: lateralFar, y: lift, z: depth / 2 + far }),
    makeLabel({ x: lateralFar, y: lift, z: -depth / 2 - far }),
    makeLabel({ x: -lateralFar, y: lift, z: depth / 2 + far })
  ];
}

export function compactLabelText(label: string) {
  return label.trim().split(/\s+/).slice(0, 2).join(' ') || 'Part';
}

export function estimateLabelWidth(text: string, footprint?: RenderFootprintEntry) {
  const textWidth = text.length * 0.085 + 0.16;
  const footprintWidth = footprint ? Math.max(0.32, Math.min(0.9, footprint.width * 0.72)) : 0.44;
  return clampNumber(Math.max(0.32, Math.min(1.1, textWidth), footprintWidth), 0.32, 1.1);
}

export function auditLabelLayout(
  renderParts: RenderPlan['parts'],
  labels: NonNullable<NonNullable<RenderPlan['layout']>['labels']>
): RenderWarning[] {
  const warnings: RenderWarning[] = [];
  const labelEntries = Object.values(labels);

  for (let leftIndex = 0; leftIndex < labelEntries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < labelEntries.length; rightIndex += 1) {
      const left = labelEntries[leftIndex];
      const right = labelEntries[rightIndex];
      if (!labelBoundsOverlap(left, right, 0.04)) {
        continue;
      }
      warnings.push({
        code: 'LABEL_OVERLAP',
        componentId: left.partId,
        message: `${left.text} label overlaps ${right.text} label; the scene remains visible, but label placement needs repair for a polished render.`
      });
    }
  }

  for (const label of labelEntries) {
    for (const part of renderParts) {
      if (
        part.id === label.partId ||
        !part.footprint ||
        part.footprint.type === 'wire' ||
        isPlacementSurfaceFootprint(part.footprint)
      ) {
        // A label floating above the flat breadboard/PCB surface is not a real overlap; only other
        // labels and raised components (chips, buttons, modules) count. (PLAN_sensible_simulation P2)
        continue;
      }
      if (!labelOverlapsPart(label, part, 0.02)) {
        continue;
      }
      warnings.push({
        code: 'LABEL_OVERLAP',
        componentId: label.partId,
        message: `${label.text} label overlaps ${part.label}; the scene remains visible, but label placement needs repair for a polished render.`
      });
    }
  }

  return warnings;
}

export function labelBoundsOverlap(
  left: NonNullable<NonNullable<RenderPlan['layout']>['labels']>[string],
  right: NonNullable<NonNullable<RenderPlan['layout']>['labels']>[string],
  gap: number
) {
  const leftBounds = labelBounds(left, gap);
  const rightBounds = labelBounds(right, gap);
  return (
    leftBounds.minX < rightBounds.maxX &&
    leftBounds.maxX > rightBounds.minX &&
    leftBounds.minZ < rightBounds.maxZ &&
    leftBounds.maxZ > rightBounds.minZ
  );
}

export function labelOverlapsPart(
  label: NonNullable<NonNullable<RenderPlan['layout']>['labels']>[string],
  part: RenderPlan['parts'][number],
  gap: number
) {
  if (!part.footprint) {
    return false;
  }
  const labelBox = labelBounds(label, gap);
  const partBox = footprintBounds(part.position, part.footprint);
  return (
    labelBox.minX < partBox.maxX &&
    labelBox.maxX > partBox.minX &&
    labelBox.minZ < partBox.maxZ &&
    labelBox.maxZ > partBox.minZ
  );
}

export function labelBounds(
  label: NonNullable<NonNullable<RenderPlan['layout']>['labels']>[string],
  gap: number
) {
  const depth = Math.max(0.14, label.height * 0.8);
  return {
    minX: label.position.x - label.width / 2 - gap,
    maxX: label.position.x + label.width / 2 + gap,
    minZ: label.position.z - depth / 2 - gap,
    maxZ: label.position.z + depth / 2 + gap
  };
}

export function auditRenderConnections(
  connections: RenderPlan['connections'],
  endpoints: Record<string, { x: number; y: number; z: number }>
): RenderWarning[] {
  const warnings: RenderWarning[] = [];

  for (const connection of connections) {
    const fromKey = renderEndpointKey(connection.from);
    const toKey = renderEndpointKey(connection.to);
    const fromPoint = endpoints[fromKey];
    const toPoint = endpoints[toKey];

    if (!fromPoint) {
      warnings.push({
        code: 'RENDER_CONNECTION_ENDPOINT_MISSING',
        componentId: connection.from.partId,
        message: `Connection ${connection.id} references ${fromKey}, but that endpoint has no render anchor.`
      });
    }

    if (!toPoint) {
      warnings.push({
        code: 'RENDER_CONNECTION_ENDPOINT_MISSING',
        componentId: connection.to.partId,
        message: `Connection ${connection.id} references ${toKey}, but that endpoint has no render anchor.`
      });
    }

    if (!fromPoint || !toPoint) {
      continue;
    }

    if (distanceBetween(fromPoint, toPoint) < 0.08 && fromKey === toKey) {
      warnings.push({
        code: 'RENDER_CONNECTION_TOO_SHORT',
        componentId: connection.from.partId,
        message: `Connection ${connection.id} is too short to render as a trustworthy jumper wire; both ends map to the same render point.`
      });
    }
  }

  return warnings;
}

export function distanceBetween(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number }
) {
  return Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z);
}

export function auditRenderPlacement(renderParts: RenderPlan['parts']): RenderWarning[] {
  const warnings: RenderWarning[] = [];
  const breadboard = renderParts.find((part) => part.footprint?.type === 'breadboard');
  const breadboardFootprint = breadboard?.footprint;

  for (const part of renderParts) {
    const footprint = part.footprint;
    if (!footprint || footprint.type === 'breadboard' || footprint.type === 'wire') {
      continue;
    }

    if (!requiresBreadboardSurfaceForPlacement(footprint)) {
      continue;
    }

    if (!breadboard || !breadboardFootprint) {
      warnings.push({
        code: 'BREADBOARD_PLACEMENT_SURFACE_MISSING',
        componentId: part.id,
        message: `${part.label} needs a breadboard placement surface before the visual placement can be trusted.`
      });
      continue;
    }

    if (!fitsInsideFootprint(part, footprint, breadboard, breadboardFootprint)) {
      warnings.push({
        code: 'BREADBOARD_PLACEMENT_OUT_OF_BOUNDS',
        componentId: part.id,
        message: `${part.label} is outside the breadboard outline, so the visual placement cannot be trusted.`
      });
    }
  }

  return warnings;
}

export function auditPartCollisions(renderParts: RenderPlan['parts']): RenderWarning[] {
  const warnings: RenderWarning[] = [];
  for (let leftIndex = 0; leftIndex < renderParts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < renderParts.length; rightIndex += 1) {
      const left = renderParts[leftIndex];
      const right = renderParts[rightIndex];
      if (renderPartsCanShareFootprintArea(left, right)) {
        continue;
      }
      if (!renderPartFootprintsOverlap(left, right, 0.03)) {
        continue;
      }
      warnings.push({
        code: 'PART_COLLISION',
        componentId: left.id,
        message: `${left.label} overlaps ${right.label} in the render footprint layout, so the visual placement cannot be trusted.`
      });
    }
  }
  return warnings;
}

export function renderPartsCanShareFootprintArea(
  left: RenderPlan['parts'][number],
  right: RenderPlan['parts'][number]
) {
  if (!left.footprint || !right.footprint) {
    return true;
  }
  if (left.footprint.type === 'wire' || right.footprint.type === 'wire') {
    return true;
  }
  if (isPlacementSurfaceFootprint(left.footprint) && isPlacementSurfaceFootprint(right.footprint)) {
    return true;
  }
  return isBreadboardSurfacePair(left, right) || isBreadboardSurfacePair(right, left);
}

export function isPlacementSurfaceFootprint(footprint: RenderFootprintEntry) {
  const shape = footprint.visualStyle.shape.toLowerCase();
  return (
    footprint.type === 'breadboard' ||
    shape === 'breadboard' ||
    shape === 'perfboard' ||
    shape === 'blank-pcb' ||
    shape === 'proto-shield'
  );
}

export function isBreadboardSurfacePair(
  surface: RenderPlan['parts'][number],
  mounted: RenderPlan['parts'][number]
) {
  const mountedFootprint = mounted.footprint;
  if (!mountedFootprint) {
    return false;
  }
  return (
    surface.footprint?.type === 'breadboard' &&
    (mountedFootprint.placement.breadboardCompatible ||
      mountedFootprint.placement.allowedSurfaces.includes('breadboard'))
  );
}

export function renderPartFootprintsOverlap(
  left: RenderPlan['parts'][number],
  right: RenderPlan['parts'][number],
  gap: number
) {
  if (!left.footprint || !right.footprint) {
    return false;
  }
  const leftBounds = footprintBounds(left.position, left.footprint);
  const rightBounds = footprintBounds(right.position, right.footprint);
  return (
    leftBounds.minX < rightBounds.maxX + gap &&
    leftBounds.maxX + gap > rightBounds.minX &&
    leftBounds.minZ < rightBounds.maxZ + gap &&
    leftBounds.maxZ + gap > rightBounds.minZ
  );
}

export function fitsInsideFootprint(
  part: RenderPlan['parts'][number],
  footprint: RenderFootprintEntry,
  surface: RenderPlan['parts'][number],
  surfaceFootprint: RenderFootprintEntry
) {
  const epsilon = 0.000001;
  const partBounds = footprintBounds(part.position, footprint);
  const surfaceBounds = footprintBounds(surface.position, surfaceFootprint);

  return (
    partBounds.minX >= surfaceBounds.minX - epsilon &&
    partBounds.maxX <= surfaceBounds.maxX + epsilon &&
    partBounds.minZ >= surfaceBounds.minZ - epsilon &&
    partBounds.maxZ <= surfaceBounds.maxZ + epsilon
  );
}

export function footprintBounds(
  position: RenderPlan['parts'][number]['position'],
  footprint: RenderFootprintEntry
) {
  return {
    minX: position.x - footprint.width / 2,
    maxX: position.x + footprint.width / 2,
    minZ: position.z - footprint.depth / 2,
    maxZ: position.z + footprint.depth / 2
  };
}

export function planDefaultRenderPositions(
  entries: RenderPartEntry[],
  breadboardGrid?: Awaited<ReturnType<typeof loadBreadboardGrid>>,
  options: { useExplicitPositionHints?: boolean } = {}
) {
  const useExplicitPositionHints = options.useExplicitPositionHints ?? true;
  const positions = new Map<string, { x: number; y: number; z: number }>();
  const breadboard = entries.find((entry) => entry.footprint?.type === 'breadboard');
  const breadboardPosition = useExplicitPositionHints
    ? (breadboard?.component.position ?? { x: 0, y: 0, z: 0 })
    : { x: 0, y: 0, z: 0 };
  const breadboardFootprint = breadboard?.footprint;

  for (const entry of entries) {
    if (useExplicitPositionHints && entry.component.position) {
      positions.set(entry.component.id, entry.component.position);
    } else if (entry.footprint?.type === 'breadboard') {
      positions.set(entry.component.id, breadboardPosition);
    } else if (entry.footprint?.type === 'arduino') {
      positions.set(
        entry.component.id,
        breadboardFootprint
          ? positionLeftOfFootprint(breadboardPosition, breadboardFootprint, entry.footprint, 0.28)
          : { x: -1.8, y: 0.28, z: 0.1 }
      );
    } else if (entry.footprint?.type === 'servo') {
      positions.set(entry.component.id, { x: -1.85, y: 0.25, z: -1.35 });
    }
  }

  if (!breadboardFootprint) {
    for (const entry of entries) {
      if (!positions.has(entry.component.id)) {
        positions.set(entry.component.id, defaultPosition(entry.index));
      }
    }
    return positions;
  }

  const boardBounds = footprintBounds(breadboardPosition, breadboardFootprint);
  const margin = 0.22;
  const gap = 0.32;
  let stageCursorZ = boardBounds.minZ;
  let stageColumnX = boardBounds.maxX + 0.45;
  let stageColumnWidth = 0;

  for (const entry of entries) {
    const footprint = entry.footprint;
    if (
      !footprint ||
      positions.has(entry.component.id) ||
      !shouldPlaceBesideBreadboard(footprint)
    ) {
      continue;
    }

    if (stageCursorZ > boardBounds.minZ && stageCursorZ + footprint.depth > boardBounds.maxZ) {
      stageColumnX += stageColumnWidth + 0.45;
      stageCursorZ = boardBounds.minZ;
      stageColumnWidth = 0;
    }

    const depth = boardBounds.maxZ - boardBounds.minZ;
    const position = {
      x: stageColumnX + footprint.width / 2,
      y: Math.max(0.25, footprint.height / 2),
      z: footprint.depth > depth ? breadboardPosition.z : stageCursorZ + footprint.depth / 2
    };
    positions.set(entry.component.id, position);
    stageCursorZ = position.z + footprint.depth / 2 + gap;
    stageColumnWidth = Math.max(stageColumnWidth, footprint.width);
  }

  let cursorX = boardBounds.minX + margin;
  let cursorZ = boardBounds.minZ + margin;
  let rowDepth = 0;
  const placedBreadboardParts: Array<{
    position: { x: number; y: number; z: number };
    footprint: RenderFootprintEntry;
  }> = [];

  for (const entry of entries) {
    const footprint = entry.footprint;
    if (
      !footprint ||
      positions.has(entry.component.id) ||
      !footprint.placement.breadboardCompatible ||
      footprint.type === 'wire'
    ) {
      continue;
    }

    if (cursorX + footprint.width > boardBounds.maxX - margin) {
      cursorX = boardBounds.minX + margin;
      cursorZ += rowDepth + gap;
      rowDepth = 0;
    }

    const preferredPosition = {
      x: cursorX + footprint.width / 2,
      y: breadboardPosition.y + breadboardFootprint.height + 0.07,
      z: cursorZ + footprint.depth / 2
    };
    const placedPosition =
      findNonOverlappingBreadboardPlacement({
        preferredPosition,
        footprint,
        boardBounds,
        margin,
        gap,
        breadboardGrid,
        placedBreadboardParts
      }) ?? snapBreadboardPosition(preferredPosition, footprint, breadboardGrid);

    positions.set(entry.component.id, placedPosition);
    placedBreadboardParts.push({ position: placedPosition, footprint });
    cursorX += footprint.width + gap;
    rowDepth = Math.max(rowDepth, footprint.depth);
  }

  for (const entry of entries) {
    if (!positions.has(entry.component.id)) {
      positions.set(entry.component.id, defaultPosition(entry.index));
    }
  }

  return positions;
}

export function shouldPlaceBesideBreadboard(footprint: RenderFootprintEntry) {
  if (footprint.type === 'breadboard' || footprint.type === 'wire') {
    return false;
  }
  const surfaces = footprint.placement.allowedSurfaces;
  return (
    surfaces.includes('beside-breadboard') ||
    (surfaces.includes('stage') && !surfaces.includes('breadboard'))
  );
}

export function findNonOverlappingBreadboardPlacement({
  preferredPosition,
  footprint,
  boardBounds,
  margin,
  gap,
  breadboardGrid,
  placedBreadboardParts
}: {
  preferredPosition: { x: number; y: number; z: number };
  footprint: RenderFootprintEntry;
  boardBounds: ReturnType<typeof footprintBounds>;
  margin: number;
  gap: number;
  breadboardGrid: Awaited<ReturnType<typeof loadBreadboardGrid>> | undefined;
  placedBreadboardParts: Array<{
    position: { x: number; y: number; z: number };
    footprint: RenderFootprintEntry;
  }>;
}) {
  const xStep = breadboardGrid?.signalArea.xPitch ?? Math.max(0.2, gap / 2);
  const zStep = 0.2;
  const candidates: Array<{
    position: { x: number; y: number; z: number };
    distance: number;
  }> = [];
  const seen = new Set<string>();
  const rawXValues = scanValues(
    boardBounds.minX + margin + footprint.width / 2,
    boardBounds.maxX - margin - footprint.width / 2,
    xStep
  );
  const rawZValues = scanValues(
    boardBounds.minZ + margin + footprint.depth / 2,
    boardBounds.maxZ - margin - footprint.depth / 2,
    zStep
  );

  for (const rawZ of rawZValues) {
    for (const rawX of rawXValues) {
      const position = snapBreadboardPosition(
        {
          x: rawX,
          y: preferredPosition.y,
          z: rawZ
        },
        footprint,
        breadboardGrid
      );
      const key = `${position.x.toFixed(3)}:${position.z.toFixed(3)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      candidates.push({
        position,
        distance: Math.hypot(position.x - preferredPosition.x, position.z - preferredPosition.z)
      });
    }
  }

  return (
    candidates
      .sort((a, b) => a.distance - b.distance)
      .map((candidate) => candidate.position)
      .find(
        (position) =>
          footprintBoundsFitInside(position, footprint, boardBounds) &&
          !placementOverlaps(position, footprint, placedBreadboardParts, 0.03)
      ) ?? null
  );
}

export function scanValues(start: number, end: number, step: number) {
  const values: number[] = [];
  for (let value = start; value <= end + 0.001; value += step) {
    values.push(Number(value.toFixed(6)));
  }
  if (values.length === 0 || Math.abs(values[values.length - 1] - end) > 0.001) {
    values.push(Number(end.toFixed(6)));
  }
  return uniqueNumbers(values);
}

export function positionLeftOfFootprint(
  surfacePosition: RenderPlan['parts'][number]['position'],
  surfaceFootprint: RenderFootprintEntry,
  footprint: RenderFootprintEntry,
  y: number,
  margin = 0.45
) {
  const surfaceBounds = footprintBounds(surfacePosition, surfaceFootprint);
  return {
    x: surfaceBounds.minX - margin - footprint.width / 2,
    y,
    z: surfacePosition.z
  };
}

export function footprintBoundsFitInside(
  position: { x: number; y: number; z: number },
  footprint: RenderFootprintEntry,
  bounds: ReturnType<typeof footprintBounds>
) {
  const partBounds = footprintBounds(position, footprint);
  return (
    partBounds.minX >= bounds.minX &&
    partBounds.maxX <= bounds.maxX &&
    partBounds.minZ >= bounds.minZ &&
    partBounds.maxZ <= bounds.maxZ
  );
}

export function placementOverlaps(
  position: { x: number; y: number; z: number },
  footprint: RenderFootprintEntry,
  placedParts: Array<{
    position: { x: number; y: number; z: number };
    footprint: RenderFootprintEntry;
  }>,
  gap: number
) {
  const bounds = footprintBounds(position, footprint);
  return placedParts.some((part) => {
    const other = footprintBounds(part.position, part.footprint);
    return (
      bounds.minX < other.maxX + gap &&
      bounds.maxX + gap > other.minX &&
      bounds.minZ < other.maxZ + gap &&
      bounds.maxZ + gap > other.minZ
    );
  });
}

export function snapBreadboardPosition(
  position: { x: number; y: number; z: number },
  footprint: RenderFootprintEntry,
  grid: Awaited<ReturnType<typeof loadBreadboardGrid>> | undefined
) {
  if (!grid || !requiresStrictBreadboardGridAudit(footprint)) {
    return position;
  }

  return {
    ...position,
    x: snapCenterToGridAxis(
      position.x,
      Object.values(footprint.pinAnchors).map((anchor) => anchor.x),
      grid.signalArea.xStart,
      grid.signalArea.xEnd,
      grid.signalArea.xPitch
    ),
    z: snapCenterToGridRows(
      position.z,
      Object.values(footprint.pinAnchors).map((anchor) => anchor.z),
      grid.signalArea.rows.map((row) => row.z)
    )
  };
}

export function snapCenterToGridAxis(
  center: number,
  anchorOffsets: number[],
  start: number,
  end: number,
  pitch: number
) {
  const gridValues: number[] = [];
  for (let value = start; value <= end + pitch / 2; value += pitch) {
    gridValues.push(nearestGridValue(value, start, end, pitch));
  }
  const candidates = uniqueNumbers(
    anchorOffsets.flatMap((offset) => gridValues.map((value) => value - offset))
  );
  return bestSnapCenter(center, anchorOffsets, candidates, (value) =>
    Math.abs(value - nearestGridValue(value, start, end, pitch))
  );
}

export function snapCenterToGridRows(center: number, anchorOffsets: number[], rows: number[]) {
  const candidates = uniqueNumbers(
    anchorOffsets.flatMap((offset) => rows.map((row) => row - offset))
  );
  return bestSnapCenter(center, anchorOffsets, candidates, (value) =>
    Math.min(...rows.map((row) => Math.abs(value - row)))
  );
}

export function uniqueNumbers(values: number[]) {
  return [...new Set(values.map((value) => Number(value.toFixed(6))))];
}

export function bestSnapCenter(
  center: number,
  anchorOffsets: number[],
  candidates: number[],
  distanceToGrid: (value: number) => number
) {
  return (
    candidates
      .map((candidate) => ({
        candidate,
        score: anchorOffsets.reduce((sum, offset) => sum + distanceToGrid(candidate + offset), 0),
        movement: Math.abs(candidate - center)
      }))
      .sort((a, b) =>
        Math.abs(a.score - b.score) > 0.000001 ? a.score - b.score : a.movement - b.movement
      )[0]?.candidate ?? center
  );
}

export function explainConnection(connection: CircuitSpec['connections'][number]) {
  const label = connection.signal.toUpperCase().replaceAll('-', ' ');
  return {
    label,
    title: `This ${connection.signal} connection matters`,
    what: `It connects ${connection.from.componentId}:${connection.from.pin} to ${connection.to.componentId}:${connection.to.pin}.`,
    why: 'The validated circuit needs this path for the lesson behavior.',
    missing: 'If this wire is missing, the simulated behavior may not work.'
  };
}

export function explainPin(role: string) {
  if (role.includes('ground')) return 'Completes the return path.';
  if (role.includes('power')) return 'Provides or receives low-voltage power.';
  if (role.includes('i2c')) return 'Carries I2C communication.';
  if (role.includes('pwm')) return 'Carries a timed control signal.';
  return 'Carries a beginner-safe circuit signal.';
}

export function defaultPosition(index: number) {
  const positions = [
    { x: 0, y: 0, z: 0 },
    { x: -1.8, y: 0.28, z: 0.1 },
    { x: 1.65, y: 0.34, z: -0.2 },
    { x: 0.8, y: 0.25, z: 0.55 },
    { x: 1.15, y: 0.25, z: 0.55 },
    { x: -0.2, y: 0.25, z: 0.7 }
  ];
  return positions[index] ?? { x: 0, y: 0.25, z: 0 };
}

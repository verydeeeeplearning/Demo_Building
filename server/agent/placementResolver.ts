import {
  BuildRunnableReportSchema,
  CircuitSpecSchema,
  PlacementResolutionSchema,
  RenderPlanSchema,
  SimulationPlanSchema,
  ValidationReportSchema,
  type BuildRunnableReport,
  type CircuitSpec,
  type PlacementIntent,
  type PlacementResolution,
  type PlacementResolutionStatus,
  type RenderPlan,
  type SimulationPlan,
  type SolverAttempt,
  type SolverGateResult,
  type ValidationReport
} from './schemas.ts';
import {
  buildNetlist,
  buildRunnableReport,
  buildSolverGateResult,
  compileRenderPlan,
  compileSimulationPlan,
  detectFaults,
  estimateCurrentPaths
} from './circuitTools.ts';

type Vector3 = { x: number; y: number; z: number };

type PlacementTransform = PlacementIntent['requestedTransform'];

export async function resolvePlacementLayout(intent: PlacementIntent): Promise<PlacementResolution> {
  if (intent.coordinateSpace !== 'render_world') {
    throw new Error('Placement resolution only accepts render_world coordinates.');
  }
  if (intent.interactionSource !== 'student_drag') {
    throw new Error('Placement resolution only accepts student_drag intents.');
  }

  const baseSpec = CircuitSpecSchema.parse(intent.baseArtifact.circuitSpec);
  const baseRenderPlan = RenderPlanSchema.parse(intent.baseArtifact.renderPlan);
  const component = baseSpec.components.find((entry) => entry.id === intent.componentId);
  if (!component) {
    throw new Error(`Placement component ${intent.componentId} is not present in the circuit spec.`);
  }

  const requestedTransform = normalizePlacementTransform(intent.requestedTransform);
  const adjustment = adjustPlacementTransform(
    baseRenderPlan,
    intent.componentId,
    requestedTransform,
    intent.snapPreference ?? 'nearest_legal'
  );
  const placedSpec = withComponentPosition(baseSpec, intent.componentId, adjustment.adjustedTransform.position);
  const netlist = await buildNetlist(placedSpec);
  const validationReport = await detectFaults(placedSpec, netlist);
  const renderPlan = await compileRenderPlan(placedSpec, validationReport);
  const currentPaths = await estimateCurrentPaths(placedSpec, netlist, validationReport);
  const simulationPlan = await compileSimulationPlan(placedSpec, validationReport, currentPaths, renderPlan);
  const runnableReport = buildRunnableReport(validationReport, renderPlan, simulationPlan);
  const solverGateResult = buildSolverGateResult(validationReport, renderPlan, simulationPlan, runnableReport, {
    repairedSpecId: placedSpec.id,
    repairSummary: [
      adjustment.adjusted
        ? 'Placement solver adjusted the dragged component to the nearest safe render region before rerouting.'
        : 'Placement solver accepted the dragged component position after deterministic render checks.'
    ]
  });
  const placementAttempt: SolverAttempt = {
    attempt: 1,
    stage: 'placement',
    action: adjustment.adjusted
      ? 'Snapped the student drag intent to the nearest safe render region before rebuilding layout, routes, labels, camera, and gates.'
      : 'Accepted the student drag intent as a placement hint before rebuilding layout, routes, labels, camera, and gates.',
    result: adjustment.adjusted ? 'repaired' : runnableReport.runnable ? 'passed' : 'degraded',
    warnings: adjustment.warnings
  };
  const solverAttempts = renumberSolverAttempts([
    placementAttempt,
    ...(renderPlan.layout?.solverAttempts ?? []),
    ...(solverGateResult.attempts ?? [])
  ]);
  const status = placementResolutionStatus({
    adjusted: adjustment.adjusted,
    renderPlan,
    runnableReport,
    solverGateResult
  });

  return PlacementResolutionSchema.parse({
    status,
    resolutionKind: status,
    revision: placementRevision(intent.baseRevision, placedSpec, renderPlan, adjustment.adjustedTransform),
    requestedTransform,
    adjustedTransform: adjustment.adjustedTransform,
    snapTarget: adjustment.snapTarget,
    circuitSpec: placedSpec,
    renderPlan,
    validationReport: ValidationReportSchema.parse(validationReport),
    simulationPlan: SimulationPlanSchema.parse(simulationPlan),
    buildRunnableReport: BuildRunnableReportSchema.parse(runnableReport),
    solverGateResult,
    warnings: unique([
      ...adjustment.warnings,
      ...validationReport.errors,
      ...validationReport.warnings,
      ...(renderPlan.warnings ?? []).map((warning) => `${warning.code}: ${warning.message}`),
      ...simulationPlan.warnings,
      ...runnableReport.reasons
    ]),
    solverAttempts
  });
}

function normalizePlacementTransform(transform: PlacementTransform): PlacementTransform {
  if (!isFiniteVector(transform?.position)) {
    throw new Error('Placement requestedTransform.position must contain finite x/y/z coordinates.');
  }
  return {
    position: vectorSnapshot(transform.position),
    rotation: isFiniteVector(transform.rotation) ? vectorSnapshot(transform.rotation) : undefined
  };
}

function withComponentPosition(spec: CircuitSpec, componentId: string, position: Vector3): CircuitSpec {
  return CircuitSpecSchema.parse({
    ...cloneJson(spec),
    components: spec.components.map((component) =>
      component.id === componentId
        ? { ...component, position: vectorSnapshot(position) }
        : { ...component }
    )
  });
}

function adjustPlacementTransform(
  renderPlan: RenderPlan,
  componentId: string,
  requestedTransform: PlacementTransform,
  snapPreference: NonNullable<PlacementIntent['snapPreference']>
) {
  const part = renderPlan.parts.find((entry) => entry.id === componentId);
  const surface = placementSurface(part);
  const region = allowedRegionForSurface(renderPlan, surface);
  const requested = requestedTransform.position;
  const adjustedPosition = {
    x: clamp(requested.x, region.min.x, region.max.x),
    y: clamp(requested.y, region.min.y, region.max.y),
    z: clamp(requested.z, region.min.z, region.max.z)
  };
  const adjusted = vectorDistance(requested, adjustedPosition) > 0.001;
  const warnings = adjusted
    ? [`PLACEMENT_SNAPPED: ${componentId} was moved to the nearest ${surface} region using ${snapPreference}.`]
    : [];
  return {
    adjusted,
    warnings,
    adjustedTransform: {
      ...requestedTransform,
      position: adjustedPosition
    },
    snapTarget: {
      surface,
      regionId: `${surface}-safe-region`
    }
  };
}

function placementSurface(part: RenderPlan['parts'][number] | undefined): 'breadboard' | 'beside_breadboard' | 'stage' {
  const surfaces = part?.footprint?.placement.allowedSurfaces ?? [];
  if (surfaces.includes('breadboard')) {
    return 'breadboard';
  }
  if (surfaces.includes('beside-breadboard') || surfaces.includes('beside_breadboard')) {
    return 'beside_breadboard';
  }
  return 'stage';
}

function allowedRegionForSurface(renderPlan: RenderPlan, surface: 'breadboard' | 'beside_breadboard' | 'stage') {
  const bounds = renderPlan.layout?.bounds;
  const min = bounds?.min ?? { x: -3.5, y: 0, z: -2.5 };
  const max = bounds?.max ?? { x: 3.5, y: 1.2, z: 2.5 };
  if (surface === 'breadboard') {
    const breadboard = renderPlan.parts.find((part) => /breadboard/i.test(`${part.id} ${part.type} ${part.label}`));
    const center = breadboard?.position ?? { x: 0, y: 0, z: 0 };
    return {
      min: { x: center.x - 2.55, y: center.y + 0.2, z: center.z - 0.85 },
      max: { x: center.x + 2.55, y: center.y + 0.85, z: center.z + 0.85 }
    };
  }
  if (surface === 'beside_breadboard') {
    return {
      min: { x: Math.min(min.x - 1.6, -4.5), y: 0.2, z: Math.max(min.z - 0.8, -3.4) },
      max: { x: Math.max(max.x + 1.6, 4.5), y: Math.max(max.y + 0.7, 1.6), z: Math.min(max.z + 0.8, 3.4) }
    };
  }
  return {
    min: { x: Math.min(min.x - 1.4, -5), y: 0.1, z: Math.min(min.z - 1.4, -4) },
    max: { x: Math.max(max.x + 1.4, 5), y: Math.max(max.y + 1, 2.4), z: Math.max(max.z + 1.4, 4) }
  };
}

function placementResolutionStatus(input: {
  adjusted: boolean;
  renderPlan: RenderPlan;
  runnableReport: BuildRunnableReport;
  solverGateResult: SolverGateResult;
}): PlacementResolutionStatus {
  if (input.renderPlan.parts.length === 0) {
    return 'no_safe_visible_scene';
  }
  if (input.solverGateResult.mode === 'safe_equivalent_simulation') {
    return 'safe_equivalent_adjusted';
  }
  if (input.runnableReport.runnable && input.solverGateResult.buildReady) {
    return input.adjusted ? 'adjusted_to_nearest_safe' : 'resolved_build_ready';
  }
  return input.adjusted ? 'adjusted_to_nearest_safe' : 'resolved_review_only';
}

function renumberSolverAttempts(attempts: SolverAttempt[]): SolverAttempt[] {
  return attempts.map((attempt, index) => ({
    ...attempt,
    attempt: index + 1
  }));
}

function placementRevision(baseRevision: string, spec: CircuitSpec, renderPlan: RenderPlan, adjustedTransform: PlacementTransform) {
  return `${baseRevision || 'placement'}-${stableHash({
    componentPositions: spec.components.map((component) => [component.id, component.position ?? null]),
    renderEndpoints: renderPlan.layout?.endpoints ?? {},
    adjustedTransform
  })}`;
}

function stableHash(value: unknown) {
  const input = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function vectorSnapshot(point: Vector3): Vector3 {
  return { x: point.x, y: point.y, z: point.z };
}

function isFiniteVector(point: unknown): point is Vector3 {
  const vector = point as Vector3 | null | undefined;
  return Number.isFinite(vector?.x) && Number.isFinite(vector?.y) && Number.isFinite(vector?.z);
}

function vectorDistance(left: Vector3, right: Vector3) {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) + Math.abs(left.z - right.z);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

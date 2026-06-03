// simulationPlan.ts — extracted verbatim from circuitTools.ts (god-module split, Phase B).
// Pure relocation: no signatures or behavior changed. See PLAN_god_module_refactor.md.
import {
  getPartRegistry,
  loadRenderFootprints,
  loadSimulationPrimitives
} from '../../context/contextLayer.ts';
import {
  type BuildRunnableReport,
  BuildRunnableReportSchema,
  type CircuitSpec,
  type CurrentPath,
  type Netlist,
  type RenderPlan,
  type SimulationPlan,
  SimulationPlanSchema,
  type SimulationPrimitive,
  type SolverAttempt,
  type SolverGateResult,
  SolverGateResultSchema,
  type ValidationReport
} from '../schemas.ts';
import {
  ADDRESSABLE_LED_DISPLAY_PART_IDS,
  ANALOG_SENSOR_MODULE_PART_IDS,
  BARE_SEVEN_SEGMENT_DISPLAY_PART_IDS,
  CLOCKED_DATA_SENSOR_PART_IDS,
  COMMUNICATION_MODULE_PART_IDS,
  DIGITAL_INPUT_STATE_PART_IDS,
  HBRIDGE_MOTOR_LOAD_PART_IDS,
  I2C_PROTOCOL_SENSOR_PART_IDS,
  JOYSTICK_PART_IDS,
  LED_ARRAY_DISPLAY_PART_IDS,
  LOGIC_INTERFACE_PART_IDS,
  LOW_SIDE_LOAD_PART_IDS,
  MATRIX_INPUT_PART_IDS,
  POWERED_DIGITAL_SENSOR_PART_IDS,
  POWERED_LIGHT_MODULE_PART_IDS,
  PULSE_DIGITAL_SENSOR_PART_IDS,
  RELAY_MODULE_PART_IDS,
  RESISTIVE_SENSOR_PART_IDS,
  RGB_LED_PART_IDS,
  ROTARY_ENCODER_PART_IDS,
  RenderWarning,
  SINGLE_WIRE_SENSOR_PART_IDS,
  SPI_DISPLAY_PART_IDS,
  SPI_PROTOCOL_SENSOR_PART_IDS,
  STEPPER_MOTOR_PART_IDS,
  UART_PROTOCOL_SENSOR_PART_IDS,
  compileCurrentPathsForContexts,
  findConnectionToControllerRole,
  findI2cTextDisplayComponent,
  simulationContextsForSpec,
  singleWireCurrentPathIds,
  unique
} from './shared.ts';

export const SIMULATION_BLOCKING_RENDER_WARNING_CODES = new Set([
  'MISSING_RENDER_FOOTPRINT',
  'RENDER_CONNECTION_ENDPOINT_MISSING',
  'RENDER_CONNECTION_TOO_SHORT',
  'SIMULATION_ENDPOINT_ANCHOR_MISSING',
  'SIMULATION_PATH_COMPONENT_MISSING',
  'BREADBOARD_PLACEMENT_SURFACE_MISSING',
  'BREADBOARD_PLACEMENT_OUT_OF_BOUNDS',
  'BREADBOARD_PIN_ROW_COLLAPSE',
  'BREADBOARD_PIN_GRID_MISALIGNMENT',
  'PART_COLLISION',
  'CAMERA_CLIPPING',
  'BREADBOARD_PHYSICAL_NODE_CONFLICT',
  'BREADBOARD_CONTINUITY_CONFLICT',
  'BREADBOARD_RAIL_CONFLICT'
]);

export async function estimateCurrentPaths(
  spec: CircuitSpec,
  _netlist: Netlist,
  validationReport: ValidationReport
): Promise<CurrentPath[]> {
  if (validationReport.status !== 'valid') {
    return [];
  }

  const contexts = await simulationContextsForSpec(spec);
  return compileCurrentPathsForContexts(spec, contexts);
}

export async function compileSimulationPlan(
  spec: CircuitSpec,
  validationReport: ValidationReport,
  currentPaths: CurrentPath[],
  renderPlan: RenderPlan
): Promise<SimulationPlan> {
  if (!renderPlan) {
    return SimulationPlanSchema.parse({
      status: validationReport.status === 'unsupported' ? 'unsupported' : 'invalid',
      runText: '',
      currentPaths: [],
      expectedStates: [],
      warnings: unique([
        ...validationReport.warnings,
        'SIMULATION_RENDER_PLAN_REQUIRED: Current/signal simulation cannot be verified without render DRC evidence.'
      ])
    });
  }

  const warnings = [...validationReport.warnings];
  const candidateCurrentPaths =
    validationReport.status === 'valid'
      ? await filterValidatedCurrentPaths(spec, currentPaths, validationReport, warnings)
      : [];
  renderPlan.warnings = uniqueRenderWarnings([
    ...(renderPlan.warnings ?? []),
    ...auditSimulationPathRenderCoverage(renderPlan, candidateCurrentPaths)
  ]);
  const renderDrcWarnings = simulationBlockingRenderWarnings(renderPlan);
  let status =
    validationReport.status === 'valid' && renderDrcWarnings.length === 0
      ? 'valid'
      : validationReport.status === 'unsupported'
        ? 'unsupported'
        : 'invalid';
  warnings.push(...renderDrcWarnings);
  let validatedCurrentPaths = status === 'valid' ? candidateCurrentPaths : [];

  if (status === 'valid') {
    const missingValidatedPathIds = missingValidatedSimulationPathIds(
      validationReport.validatedCurrentPathIds,
      validatedCurrentPaths
    );
    if (missingValidatedPathIds.length > 0) {
      warnings.push(
        `SIMULATION_VALIDATED_PATH_MISSING: ${missingValidatedPathIds.join(', ')} were declared by validation but removed before simulation.`
      );
      status = 'invalid';
      validatedCurrentPaths = [];
    }
  }

  if (status === 'valid') {
    const requiredPathWarnings = await simulationRequiredPathWarnings(
      spec,
      validationReport,
      validatedCurrentPaths
    );
    if (requiredPathWarnings.length > 0) {
      warnings.push(...requiredPathWarnings);
      status = 'invalid';
      validatedCurrentPaths = [];
    }
  }

  return SimulationPlanSchema.parse({
    status,
    runText: status === 'valid' ? spec.behavior.runText : '',
    currentPaths: validatedCurrentPaths,
    expectedStates: status === 'valid' ? await inferExpectedStates(spec) : [],
    warnings: unique(warnings)
  });
}

export function buildRunnableReport(
  validationReport: ValidationReport,
  renderPlan: RenderPlan,
  simulationPlan: SimulationPlan
): BuildRunnableReport {
  const renderBlockingWarnings = (renderPlan.warnings ?? []).filter((warning) =>
    SIMULATION_BLOCKING_RENDER_WARNING_CODES.has(warning.code)
  );
  const reasons: string[] = [];

  if (validationReport.status !== 'valid') {
    reasons.push(`validation status is ${validationReport.status}`);
    reasons.push(...validationReport.errors);
  }
  if (renderPlan.parts.length === 0) {
    reasons.push('render plan has no build-ready parts');
  }
  for (const warning of renderBlockingWarnings) {
    const component = warning.componentId ? ` on ${warning.componentId}` : '';
    reasons.push(`${warning.code}${component}: ${warning.message}`);
  }
  if (simulationPlan.status !== 'valid') {
    reasons.push(`simulation status is ${simulationPlan.status}`);
    reasons.push(...simulationPlan.warnings);
  }
  const missingValidatedPathIds = missingValidatedSimulationPathIds(
    validationReport.validatedCurrentPathIds,
    simulationPlan.currentPaths
  );
  if (simulationPlan.status === 'valid' && missingValidatedPathIds.length > 0) {
    reasons.push(
      `SIMULATION_REQUIRED_EVIDENCE_MISSING: missing validated current or signal path ids ${missingValidatedPathIds.join(', ')}`
    );
  }
  const requiresCurrentOrSignalPath = validationReport.validatedCurrentPathIds.length > 0;
  const hasCurrentOrSignalPath = simulationPlan.currentPaths.length > 0;
  const hasStateEvidence = simulationPlan.expectedStates.length > 0;
  const hasRunnableSimulationEvidence =
    hasCurrentOrSignalPath || (!requiresCurrentOrSignalPath && hasStateEvidence);

  if (simulationPlan.status === 'valid' && !hasRunnableSimulationEvidence) {
    reasons.push('simulation has no validated current or signal path');
  }

  const runnable =
    reasons.length === 0 &&
    validationReport.status === 'valid' &&
    renderPlan.parts.length > 0 &&
    simulationPlan.status === 'valid' &&
    hasRunnableSimulationEvidence;

  return BuildRunnableReportSchema.parse({
    status: runnable ? 'runnable' : 'blocked',
    runnable,
    reasons: unique(reasons),
    validationStatus: validationReport.status,
    simulationStatus: simulationPlan.status,
    renderWarningCount: renderPlan.warnings.length,
    renderBlockingWarningCount: renderBlockingWarnings.length,
    renderPartCount: renderPlan.parts.length,
    currentPathCount: simulationPlan.currentPaths.length,
    expectedStateCount: simulationPlan.expectedStates.length
  });
}

export function buildSolverGateResult(
  validationReport: ValidationReport,
  renderPlan: RenderPlan,
  simulationPlan: SimulationPlan,
  buildRunnable: BuildRunnableReport,
  options: {
    mode?: SolverGateResult['mode'];
    repairLevel?: SolverGateResult['repairLevel'];
    sourceSpecId?: string;
    repairedSpecId?: string;
    equivalentSpecId?: string;
    verifiedClaims?: string[];
    notVerified?: string[];
    repairSummary?: string[];
    presentationAdjustment?: SolverGateResult['presentationAdjustment'];
    buildReadyScope?: SolverGateResult['buildReadyScope'];
    safeToRenderEvidence?: string[];
    controls?: SolverGateResult['controls'];
  } = {}
): SolverGateResult {
  const visibleSimulation = renderPlan.parts.length > 0;
  const buildReady = buildRunnable.runnable;
  const visualWarnings = renderPlan.warnings ?? [];
  const renderSolverAttempts = renderPlan.layout?.solverAttempts ?? [];
  const repairedSolverStages = unique(
    renderSolverAttempts
      .filter((attempt) => attempt.result === 'repaired')
      .map((attempt) => attempt.stage)
  );
  const degradedSolverStages = unique(
    renderSolverAttempts
      .filter((attempt) => attempt.result === 'degraded')
      .map((attempt) => attempt.stage)
  );
  const hasCurrentEvidence = simulationPlan.currentPaths.some(
    (path) =>
      simulationPlan.status === 'valid' &&
      ['load-current', 'supply-current', 'sensing-divider'].includes(path.kind)
  );
  const hasSignalEvidence = simulationPlan.currentPaths.some(
    (path) =>
      simulationPlan.status === 'valid' && ['signal-activity', 'bus-activity'].includes(path.kind)
  );
  const stateEvidence = solverStateEvidence(validationReport, renderPlan, simulationPlan);
  const hasPlaceholderVisualWarning = visualWarnings.some(
    (warning) => warning.code === 'MISSING_RENDER_FOOTPRINT'
  );
  const simulationActivity = hasCurrentEvidence
    ? 'verified_current'
    : hasSignalEvidence
      ? 'verified_signal'
      : stateEvidence.length > 0
        ? 'state_only'
        : 'diagnostic';
  const mode =
    options.mode ??
    (buildReady
      ? repairedSolverStages.length > 0
        ? 'auto_repaired_simulation'
        : 'verified_build_simulation'
      : hasPlaceholderVisualWarning
        ? 'placeholder_part_simulation'
        : 'diagnostic_simulation');
  const buildReadyScope = options.buildReadyScope ?? inferBuildReadyScope(mode, buildReady);
  const notVerified = unique([
    ...(!visibleSimulation
      ? ['visible 3D scene is not yet available because the render plan has no parts']
      : []),
    ...(!buildReady ? ['build-ready claim is not verified'] : []),
    ...(mode === 'safe_equivalent_simulation'
      ? [
          'original request is not build-ready; build-ready claims apply only to the displayed safe equivalent'
        ]
      : []),
    ...(!buildReady && degradedSolverStages.length > 0
      ? [
          `render solver adjusted ${degradedSolverStages.join(', ')} stage(s) for review-only presentation`
        ]
      : []),
    ...buildRunnable.reasons,
    ...(options.notVerified ?? []),
    'bench test has not been performed'
  ]);
  const repairLevel =
    options.repairLevel ??
    (hasPlaceholderVisualWarning ? 'placeholder' : inferSolverRepairLevel(renderSolverAttempts));
  const verifiedClaims = unique([
    ...(visibleSimulation
      ? [`render plan exposes ${renderPlan.parts.length} visible part(s)`]
      : []),
    ...(repairedSolverStages.length > 0
      ? [`render solver repaired ${repairedSolverStages.join(', ')} stage(s)`]
      : []),
    ...(options.verifiedClaims ?? []),
    ...(buildReady && validationReport.status === 'valid'
      ? [`${solverClaimSubject(mode)} validation status is valid`]
      : []),
    ...(buildReady && simulationPlan.status === 'valid'
      ? [`${solverClaimSubject(mode)} simulation plan status is valid`]
      : []),
    ...(buildReady ? [`${solverClaimSubject(mode)} build-ready runnable gate passed`] : []),
    ...(simulationPlan.status === 'valid' && simulationPlan.currentPaths.length > 0
      ? [`${simulationPlan.currentPaths.length} current/signal path(s) are available`]
      : []),
    ...(stateEvidence.length > 0
      ? stateEvidence.map((evidence) => `state/context evidence: ${evidence}`)
      : [])
  ]);
  const safeToRenderEvidence =
    options.safeToRenderEvidence ??
    solverSafeToRenderEvidence({
      validationReport,
      renderPlan,
      simulationPlan,
      mode,
      stateEvidence
    });
  const controls =
    options.controls ??
    solverGateControls({
      buildReady,
      visibleSimulation,
      simulationActivity,
      buildReadyScope
    });
  const presentationAdjustment =
    options.presentationAdjustment ??
    solverPresentationAdjustment({
      mode,
      simulationActivity,
      sourceSpecId: options.sourceSpecId,
      equivalentSpecId: options.equivalentSpecId,
      buildReady,
      renderPlan,
      visualWarnings,
      stateEvidence,
      verifiedClaims,
      notVerified,
      hardwareWarnings: unique([...validationReport.warnings, ...simulationPlan.warnings])
    });

  const attempts = renderSolverAttempts.length > 0 ? [...renderSolverAttempts] : [];
  if (!buildReady) {
    attempts.push({
      attempt: attempts.length + 1,
      stage: 'degrade',
      action: visibleSimulation
        ? 'Expose the available scene as an automatically adjusted review view while keeping build-ready claims strict.'
        : 'No visible scene is available yet; keep strict evidence reasons until a diagnostic or safe-equivalent scene can be rendered.',
      result: 'degraded',
      warnings: notVerified
    });
  }

  return SolverGateResultSchema.parse({
    visibleSimulation,
    mode,
    buildReady,
    simulationActivity,
    benchConfirmed: false,
    sourceSpecId: options.sourceSpecId,
    repairedSpecId: options.repairedSpecId,
    equivalentSpecId: options.equivalentSpecId,
    repairLevel,
    attempts,
    verifiedClaims,
    notVerified,
    visualWarnings,
    hardwareWarnings: unique([...validationReport.warnings, ...simulationPlan.warnings]),
    repairSummary: options.repairSummary?.length
      ? unique([
          ...options.repairSummary,
          ...solverRepairSummary(
            buildReady,
            visibleSimulation,
            repairedSolverStages,
            degradedSolverStages
          )
        ])
      : solverRepairSummary(
          buildReady,
          visibleSimulation,
          repairedSolverStages,
          degradedSolverStages
        ),
    presentationAdjustment,
    buildReadyScope,
    safeToRenderEvidence,
    controls
  });
}

export function inferBuildReadyScope(
  mode: SolverGateResult['mode'],
  buildReady: boolean
): SolverGateResult['buildReadyScope'] {
  if (!buildReady) {
    return 'none';
  }
  return mode === 'safe_equivalent_simulation' ? 'displayed_equivalent' : 'original';
}

export function solverClaimSubject(mode: SolverGateResult['mode']) {
  return mode === 'safe_equivalent_simulation' ? 'displayed safe equivalent' : 'circuit';
}

export function solverGateControls(input: {
  buildReady: boolean;
  visibleSimulation: boolean;
  simulationActivity: SolverGateResult['simulationActivity'];
  buildReadyScope: SolverGateResult['buildReadyScope'];
}): SolverGateResult['controls'] {
  const hasVerifiedActivity =
    input.simulationActivity === 'verified_current' ||
    input.simulationActivity === 'verified_signal';
  const buildReadyClaimIsScoped =
    input.buildReadyScope === 'original' || input.buildReadyScope === 'displayed_equivalent';
  return {
    runEnabled: input.buildReady && buildReadyClaimIsScoped && hasVerifiedActivity,
    currentAnimationEnabled: input.buildReady && buildReadyClaimIsScoped && hasVerifiedActivity,
    hardwareMoveEnabled: false,
    visualMoveEnabled: input.visibleSimulation,
    shareEnabled: input.visibleSimulation
  };
}

export function solverStateEvidence(
  validationReport: ValidationReport,
  _renderPlan: RenderPlan,
  simulationPlan: SimulationPlan
): string[] {
  const evidence: string[] = [];
  if (simulationPlan.status === 'valid' && simulationPlan.expectedStates.length > 0) {
    evidence.push(`${simulationPlan.expectedStates.length} expected state(s) are available`);
  }
  const contextWarnings = unique([...validationReport.warnings, ...simulationPlan.warnings])
    .map(stateEvidenceFromWarning)
    .filter((item): item is string => Boolean(item));
  return unique([...evidence, ...contextWarnings]);
}

export function stateEvidenceFromWarning(warning: string): string | null {
  if (!/STATE_ONLY|CONTEXT_ONLY|CONTEXT_STATE_ONLY|PIN-?MAP|LAYOUT_CONTEXT/i.test(warning)) {
    return null;
  }
  return warning.split(':')[0]?.trim() || warning;
}

export function solverSafeToRenderEvidence(input: {
  validationReport: ValidationReport;
  renderPlan: RenderPlan;
  simulationPlan: SimulationPlan;
  mode: SolverGateResult['mode'];
  stateEvidence: string[];
}): string[] {
  if (input.renderPlan.parts.length === 0) {
    return [];
  }

  return unique([
    `render plan exposes ${input.renderPlan.parts.length} visible part(s)`,
    ...(input.validationReport.status === 'valid'
      ? ['validation evidence is available for claim scoping']
      : [
          `validation status ${input.validationReport.status} is preserved as review-only evidence`
        ]),
    ...(input.simulationPlan.status === 'valid'
      ? ['simulation evidence is available for activity scoping']
      : [`simulation status ${input.simulationPlan.status} is preserved as review-only evidence`]),
    ...((input.renderPlan.warnings ?? []).length > 0
      ? ['render warnings are preserved for visible review overlays']
      : []),
    ...(input.mode === 'safe_equivalent_simulation'
      ? ['original unsafe request is separated from the displayed safe equivalent']
      : []),
    ...(input.mode === 'placeholder_part_simulation'
      ? ['placeholder metadata disables exact geometry and pin-geometry claims']
      : []),
    ...input.stateEvidence.map((evidence) => `state/context evidence: ${evidence}`)
  ]);
}

export function solverPresentationAdjustment(input: {
  mode: SolverGateResult['mode'];
  simulationActivity: SolverGateResult['simulationActivity'];
  sourceSpecId?: string;
  equivalentSpecId?: string;
  buildReady: boolean;
  renderPlan: RenderPlan;
  visualWarnings: RenderWarning[];
  stateEvidence: string[];
  verifiedClaims: string[];
  notVerified: string[];
  hardwareWarnings: string[];
}): SolverGateResult['presentationAdjustment'] {
  if (input.mode === 'safe_equivalent_simulation') {
    return {
      kind: 'safe_equivalent_simulation',
      originalSpecId: input.sourceSpecId ?? 'original-request',
      equivalentSpecId: input.equivalentSpecId ?? 'displayed-safe-equivalent',
      originalBuildReady: false,
      displayedEquivalentBuildReady: input.buildReady,
      blockedOriginalReasons:
        input.notVerified.filter((reason) =>
          /original|unsafe|not build-ready|not converted/i.test(reason)
        ).length > 0
          ? input.notVerified.filter((reason) =>
              /original|unsafe|not build-ready|not converted/i.test(reason)
            )
          : ['original request is outside the safe classroom build-ready scope'],
      equivalenceClaims: input.verifiedClaims,
      nonEquivalentWarnings: input.hardwareWarnings,
      reason:
        'The original request is not build-ready; the visible build-ready scope belongs only to the displayed safe equivalent.'
    };
  }

  if (input.mode === 'placeholder_part_simulation') {
    const placeholderPartIds = placeholderPartIdsForRenderPlan(
      input.renderPlan,
      input.visualWarnings
    );
    return {
      kind: 'placeholder_part_simulation',
      placeholderPartIds,
      placeholderFootprintId: 'stage-generic-part-profile',
      missingEvidence: placeholderMissingEvidence(input.visualWarnings, placeholderPartIds),
      exactGeometryClaim: false,
      pinGeometryClaim: false,
      reason:
        'A safe generic placeholder is visible while exact footprint and pin-geometry evidence remain unverified.'
    };
  }

  if (input.simulationActivity === 'state_only') {
    return {
      kind: 'state_only',
      stateEvidence: input.stateEvidence,
      reason:
        'Static state/context evidence is meaningful, but current-flow animation is not claimed.'
    };
  }

  if (input.buildReady) {
    return {
      kind: 'none',
      reason: 'verified_build'
    };
  }

  return {
    kind: 'diagnostic_simulation',
    reason:
      'A safe review scene is visible while strict build-ready and runtime claims remain gated.',
    visibleOverlays: unique(input.visualWarnings.map((warning) => warning.code))
  };
}

export function placeholderPartIdsForRenderPlan(
  renderPlan: RenderPlan,
  visualWarnings: RenderWarning[]
): string[] {
  return unique([
    ...visualWarnings
      .filter((warning) => warning.code === 'MISSING_RENDER_FOOTPRINT' && warning.componentId)
      .map((warning) => warning.componentId as string),
    ...renderPlan.parts.filter((part) => !part.footprint).map((part) => part.id)
  ]);
}

export function placeholderMissingEvidence(
  visualWarnings: RenderWarning[],
  placeholderPartIds: string[]
): string[] {
  const warningEvidence = visualWarnings
    .filter((warning) => warning.code === 'MISSING_RENDER_FOOTPRINT')
    .map(
      (warning) =>
        `${warning.code}${warning.componentId ? ` on ${warning.componentId}` : ''}: ${warning.message}`
    );
  if (warningEvidence.length > 0) {
    return unique(warningEvidence);
  }
  if (placeholderPartIds.length > 0) {
    return placeholderPartIds.map((id) => `exact footprint and pin geometry are missing for ${id}`);
  }
  return ['exact footprint and pin geometry are missing'];
}

export function inferSolverRepairLevel(attempts: SolverAttempt[]): SolverGateResult['repairLevel'] {
  if (attempts.some((attempt) => attempt.result === 'repaired' && attempt.stage === 'routing')) {
    return 'routing';
  }
  if (
    attempts.some(
      (attempt) =>
        attempt.result === 'repaired' && ['placement', 'camera', 'label'].includes(attempt.stage)
    )
  ) {
    return 'layout';
  }
  return 'none';
}

export function solverRepairSummary(
  buildReady: boolean,
  visibleSimulation: boolean,
  repairedSolverStages: string[],
  degradedSolverStages: string[]
) {
  const summary: string[] = [];
  if (repairedSolverStages.length > 0) {
    summary.push(
      `Solver automatically repaired ${repairedSolverStages.join(', ')} stage(s) before returning the scene.`
    );
  }
  if (degradedSolverStages.length > 0) {
    summary.push(
      `Solver adjusted ${degradedSolverStages.join(', ')} stage(s) and marked affected claims as review-only.`
    );
  }
  if (summary.length === 0 && buildReady) {
    summary.push('No solver repair was required; all strict gates passed.');
  }
  if (summary.length === 0 && !buildReady && visibleSimulation) {
    summary.push(
      'Review scene is visible while strict build-ready claims remain under automatic adjustment.'
    );
  }
  if (summary.length === 0) {
    summary.push(
      'No visible scene is available yet; diagnostic/safe-equivalent rendering is still required.'
    );
  }
  return summary;
}

export function missingValidatedSimulationPathIds(
  requiredIds: string[],
  currentPaths: CurrentPath[]
) {
  const currentPathIds = new Set(currentPaths.map((path) => path.id));
  return unique(requiredIds).filter(
    (id) =>
      !currentPathIds.has(id) && ![...currentPathIds].some((pathId) => pathId.startsWith(`${id}:`))
  );
}

export function simulationBlockingRenderWarnings(renderPlan: RenderPlan): string[] {
  return (renderPlan.warnings ?? [])
    .filter((warning) => SIMULATION_BLOCKING_RENDER_WARNING_CODES.has(warning.code))
    .map((warning) => {
      const component = warning.componentId ? ` on ${warning.componentId}` : '';
      return `SIMULATION_BLOCKED_BY_RENDER_DRC: ${warning.code}${component}. ${warning.message}`;
    });
}

export function auditSimulationPathRenderCoverage(
  renderPlan: RenderPlan,
  currentPaths: CurrentPath[]
): RenderWarning[] {
  const componentIds = new Set(renderPlan.parts.map((part) => part.id));
  const endpointKeys = new Set(Object.keys(renderPlan.layout?.endpoints ?? {}));
  const warnings: RenderWarning[] = [];

  for (const path of currentPaths) {
    for (const endpoint of [path.from, path.to]) {
      if (endpointKeys.has(endpoint)) {
        continue;
      }

      warnings.push({
        code: 'SIMULATION_ENDPOINT_ANCHOR_MISSING',
        componentId: endpointComponentId(endpoint),
        message: `Current path ${path.id} references ${endpoint}, but that endpoint has no render anchor.`
      });
    }

    for (const componentId of path.through) {
      if (componentIds.has(componentId)) {
        continue;
      }

      warnings.push({
        code: 'SIMULATION_PATH_COMPONENT_MISSING',
        componentId,
        message: `Current path ${path.id} passes through ${componentId}, but that component is not rendered.`
      });
    }
  }

  return warnings;
}

export function endpointComponentId(endpoint: string) {
  return endpoint.split(':')[0] || undefined;
}

export function uniqueRenderWarnings(warnings: RenderWarning[]) {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.componentId ?? ''}:${warning.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export const WP10_PROTOCOL_SENSOR_PART_IDS = new Set([
  ...I2C_PROTOCOL_SENSOR_PART_IDS,
  ...CLOCKED_DATA_SENSOR_PART_IDS,
  ...SPI_PROTOCOL_SENSOR_PART_IDS,
  ...UART_PROTOCOL_SENSOR_PART_IDS
]);

export function findLedArrayDisplayComponents(spec: CircuitSpec) {
  return spec.components.filter((component) => LED_ARRAY_DISPLAY_PART_IDS.has(component.partId));
}

export function findBareSevenSegmentDisplayComponents(spec: CircuitSpec) {
  return spec.components.filter((component) =>
    BARE_SEVEN_SEGMENT_DISPLAY_PART_IDS.has(component.partId)
  );
}

export function findAddressableLedDisplayComponents(spec: CircuitSpec) {
  return spec.components.filter((component) =>
    ADDRESSABLE_LED_DISPLAY_PART_IDS.has(component.partId)
  );
}

export function findSpiDisplayComponents(spec: CircuitSpec) {
  return spec.components.filter((component) => SPI_DISPLAY_PART_IDS.has(component.partId));
}

export function findRgbLedComponents(spec: CircuitSpec) {
  return spec.components.filter((component) => RGB_LED_PART_IDS.has(component.partId));
}

export function findPoweredLightModuleComponents(spec: CircuitSpec) {
  return spec.components.filter((component) => POWERED_LIGHT_MODULE_PART_IDS.has(component.partId));
}

export async function inferExpectedStates(spec: CircuitSpec) {
  const contexts = await simulationContextsForSpec(spec);
  return contexts.map((context) => ({
    componentId: context.component.id,
    state: stateLabelForPrimitive(context.primitive),
    primitiveId: context.primitive.id,
    explanation: context.primitive.expectedStateRecipe.description
  }));
}

export function stateLabelForPrimitive(primitive: SimulationPrimitive) {
  const labels: Record<string, string> = {
    matrix_input_state: 'key or switch state changes',
    joystick_position_state: 'joystick position changes',
    rotary_encoder_state: 'encoder count changes',
    analog_pwm_dimmer: 'brightness follows knob',
    analog_threshold: 'threshold-controlled',
    display_sensor_value: 'sensor value displayed',
    digital_input_state: 'input state changes',
    bare_seven_segment_display_state: 'selected segments lit',
    display_static_text: 'shows text',
    digital_on_off: 'on or blinking',
    blink_timer: 'on or blinking',
    buzzer_pulse: 'beeping',
    low_side_switched_load_state: 'switched load state changes',
    hbridge_motor_state: 'motor direction changes',
    relay_switch_state: 'relay contact state changes',
    stepper_motor_state: 'stepper position changes',
    servo_angle: 'moves angle',
    low_voltage_power_rail_state: 'low-voltage rail energized',
    regulated_5v_rail_state: 'regulated 5V rail available',
    passive_protection_context_state: 'passive context visible',
    timing_passive_context_state: 'timing reference visible',
    prototyping_surface_context_state: 'prototyping surface visible',
    connector_wiring_context_state: 'connector context visible',
    controller_board_context_state: 'controller board pin map visible'
  };
  return labels[primitive.id] ?? primitive.expectedStateRecipe.states[0] ?? 'simulated state';
}

export async function simulationRequiredPathWarnings(
  spec: CircuitSpec,
  validationReport: ValidationReport,
  currentPaths: CurrentPath[]
) {
  const requiredIds = requiredCurrentPathIdsForSimulation(spec, validationReport);
  if (requiredIds.length === 0) {
    return [];
  }

  const currentPathIds = new Set(currentPaths.map((path) => path.id));
  return requiredIds
    .filter(
      (id) =>
        !currentPathIds.has(id) &&
        ![...currentPathIds].some((pathId) => pathId.startsWith(`${id}:`))
    )
    .map(
      (id) =>
        `SIMULATION_REQUIRED_PATH_MISSING: ${id} was required by ${validationReport.electricalAnalysis?.topologyTemplateId ?? 'unknown topology'} but was not validated for rendering.`
    );
}

export function requiredCurrentPathIdsForSimulation(
  spec: CircuitSpec,
  validationReport: ValidationReport
) {
  const topologyTemplateId = validationReport.electricalAnalysis?.topologyTemplateId;
  const topologyId = typeof topologyTemplateId === 'string' ? topologyTemplateId : undefined;
  const analogSensorIds = spec.components
    .filter((component) => ANALOG_SENSOR_MODULE_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const resistiveSensorIds = spec.components
    .filter((component) => RESISTIVE_SENSOR_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const displayId = findI2cTextDisplayComponent(spec)?.id;
  const digitalInputIds = spec.components
    .filter((component) => DIGITAL_INPUT_STATE_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const singleWireSensorComponents = spec.components.filter((component) =>
    SINGLE_WIRE_SENSOR_PART_IDS.has(component.partId)
  );
  const protocolSensorIds = spec.components
    .filter((component) => WP10_PROTOCOL_SENSOR_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const communicationModuleIds = spec.components
    .filter((component) => COMMUNICATION_MODULE_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const logicInterfaceIds = spec.components
    .filter((component) => LOGIC_INTERFACE_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const matrixInputComponents = spec.components.filter((component) =>
    MATRIX_INPUT_PART_IDS.has(component.partId)
  );
  const joystickIds = spec.components
    .filter((component) => JOYSTICK_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const rotaryEncoderIds = spec.components
    .filter((component) => ROTARY_ENCODER_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const ledArrayDisplayComponents = findLedArrayDisplayComponents(spec);
  const bareSevenSegmentDisplayComponents = findBareSevenSegmentDisplayComponents(spec);
  const addressableLedDisplayIds = findAddressableLedDisplayComponents(spec).map(
    (component) => component.id
  );
  const spiDisplayComponents = findSpiDisplayComponents(spec);
  const rgbLedComponents = findRgbLedComponents(spec);
  const poweredLightModuleIds = findPoweredLightModuleComponents(spec).map(
    (component) => component.id
  );
  const lowSideLoadIds = spec.components
    .filter((component) => LOW_SIDE_LOAD_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const stepperMotorIds = spec.components
    .filter((component) => STEPPER_MOTOR_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const hbridgeMotorIds = spec.components
    .filter((component) => HBRIDGE_MOTOR_LOAD_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const relayModuleIds = spec.components
    .filter((component) => RELAY_MODULE_PART_IDS.has(component.partId))
    .map((component) => component.id);
  const poweredDigitalInputIds = spec.components
    .filter(
      (component) =>
        POWERED_DIGITAL_SENSOR_PART_IDS.has(component.partId) ||
        PULSE_DIGITAL_SENSOR_PART_IDS.has(component.partId)
    )
    .map((component) => component.id);
  const pulseDigitalInputIds = spec.components
    .filter((component) => PULSE_DIGITAL_SENSOR_PART_IDS.has(component.partId))
    .map((component) => component.id);

  if (
    topologyId === 'external-low-voltage-power-rail' ||
    topologyId === 'regulated-5v-rail' ||
    topologyId === 'controller-board-pin-map-substitution' ||
    topologyId === 'controller-voltage-domain-policy' ||
    topologyId === 'prototyping-surface-context-only' ||
    topologyId === 'connector-wiring-context-only'
  ) {
    return [];
  }

  if (topologyId === 'controller-matrix-input-display' && displayId) {
    return unique([
      ...matrixInputComponents.flatMap((component) =>
        requiredMatrixCurrentPathIds(spec, component)
      ),
      `matrix-input-display-bus-activity:${displayId}`,
      'oled-module-current'
    ]);
  }

  if (topologyId === 'controller-dual-analog-input-display' && displayId) {
    return unique([
      ...joystickIds.flatMap((joystickId) => [
        `joystick-supply-current:${joystickId}`,
        `joystick-x-analog-signal:${joystickId}`,
        `joystick-y-analog-signal:${joystickId}`,
        `joystick-switch-signal:${joystickId}`
      ]),
      `joystick-display-bus-activity:${displayId}`,
      'oled-module-current'
    ]);
  }

  if (topologyId === 'controller-quadrature-input-display' && displayId) {
    return unique([
      ...rotaryEncoderIds.flatMap((encoderId) => [
        `rotary-encoder-supply-current:${encoderId}`,
        `rotary-encoder-clk-signal:${encoderId}`,
        `rotary-encoder-dt-signal:${encoderId}`,
        `rotary-encoder-switch-signal:${encoderId}`
      ]),
      `rotary-encoder-display-bus-activity:${displayId}`,
      'oled-module-current'
    ]);
  }

  if (
    (topologyId === 'controller-digital-input-display' ||
      topologyId === 'controller-pulse-digital-sensor-display') &&
    displayId
  ) {
    return unique([
      ...poweredDigitalInputIds.map((sensorId) => `digital-input-supply-current:${sensorId}`),
      ...digitalInputIds
        .filter((sensorId) => !pulseDigitalInputIds.includes(sensorId))
        .map((sensorId) => `digital-input-signal:${sensorId}`),
      ...pulseDigitalInputIds.map((sensorId) => `pulse-digital-input-signal:${sensorId}`),
      `digital-input-display-bus-activity:${displayId}`,
      'oled-module-current'
    ]);
  }

  if (topologyId === 'controller-digital-input-output') {
    return unique([
      ...poweredDigitalInputIds.map((sensorId) => `digital-input-supply-current:${sensorId}`),
      ...digitalInputIds
        .filter((sensorId) => !pulseDigitalInputIds.includes(sensorId))
        .map((sensorId) => `digital-input-signal:${sensorId}`),
      ...pulseDigitalInputIds.map((sensorId) => `pulse-digital-input-signal:${sensorId}`),
      'led-forward-current'
    ]);
  }

  if (topologyId === 'controller-resistive-sensor-divider-i2c-display' && displayId) {
    return unique([
      ...resistiveSensorIds.flatMap((sensorId) => [
        `resistive-sensor-divider-current:${sensorId}`,
        `resistive-sensor-analog-signal:${sensorId}`
      ]),
      `resistive-sensor-display-bus-activity:${displayId}`,
      'oled-module-current'
    ]);
  }

  if (topologyId === 'controller-resistive-sensor-divider-threshold-output') {
    return unique([
      ...resistiveSensorIds.flatMap((sensorId) => [
        `resistive-threshold-sensing-divider:${sensorId}`,
        `resistive-threshold-analog-signal:${sensorId}`
      ]),
      'led-forward-current'
    ]);
  }

  if (topologyId === 'controller-analog-sensor-i2c-display' && displayId) {
    return unique([
      ...analogSensorIds.flatMap((sensorId) => [
        `analog-sensor-supply-current:${sensorId}`,
        `analog-sensor-analog-signal:${sensorId}`
      ]),
      `analog-sensor-display-bus-activity:${displayId}`,
      'oled-module-current'
    ]);
  }

  if (topologyId === 'controller-single-wire-sensor-i2c-display' && displayId) {
    return unique([
      ...singleWireSensorComponents.flatMap((component) => {
        const pathIds = singleWireCurrentPathIds(component.partId, component.id, displayId);
        return [pathIds.supply, pathIds.data];
      }),
      ...singleWireSensorComponents.map(
        (component) => singleWireCurrentPathIds(component.partId, component.id, displayId).display
      ),
      'oled-module-current'
    ]);
  }

  if (
    [
      'controller-i2c-sensor-display',
      'controller-clocked-data-sensor-i2c-display',
      'controller-spi-sensor-display',
      'controller-uart-sensor-display'
    ].includes(topologyId ?? '') &&
    displayId
  ) {
    return unique([
      ...protocolSensorIds.flatMap((sensorId) => [
        `protocol-sensor-supply-current:${sensorId}`,
        `protocol-sensor-bus-activity:${sensorId}`
      ]),
      `protocol-sensor-display-bus-activity:${displayId}`,
      'oled-module-current'
    ]);
  }

  if (
    [
      'controller-uart-communication-module',
      'controller-spi-communication-module',
      'controller-differential-bus-module'
    ].includes(topologyId ?? '') &&
    displayId
  ) {
    return unique([
      ...communicationModuleIds.flatMap((moduleId) => [
        `communication-module-supply-current:${moduleId}`,
        `communication-module-bus-activity:${moduleId}`
      ]),
      `communication-module-display-bus-activity:${displayId}`,
      'oled-module-current'
    ]);
  }

  if (
    [
      'controller-logic-interface-context',
      'controller-i2c-interface-context',
      'controller-spi-interface-context',
      'controller-analog-timing-interface-context'
    ].includes(topologyId ?? '') &&
    displayId
  ) {
    return unique([
      ...logicInterfaceIds.flatMap((interfaceId) => [
        `logic-interface-supply-current:${interfaceId}`,
        `logic-interface-signal-activity:${interfaceId}`
      ]),
      `logic-interface-display-bus-activity:${displayId}`,
      'oled-module-current'
    ]);
  }

  if (topologyId === 'level-shifted-i2c-bus') {
    return unique(
      logicInterfaceIds.flatMap((interfaceId) => [
        `logic-interface-supply-current:${interfaceId}`,
        `logic-interface-signal-activity:${interfaceId}`
      ])
    );
  }

  if (
    topologyId === 'controller-analog-threshold-output' ||
    topologyId === 'controller-analog-sensor-threshold-output'
  ) {
    return unique([
      ...analogSensorIds.flatMap((sensorId) => [
        `analog-threshold-sensing-divider:${sensorId}`,
        `analog-threshold-analog-signal:${sensorId}`
      ]),
      'led-forward-current'
    ]);
  }

  if (topologyId === 'controller-led-array-display') {
    return unique(
      ledArrayDisplayComponents.flatMap((component) =>
        requiredLedArrayDisplayCurrentPathIds(component)
      )
    );
  }

  if (topologyId === 'controller-bare-seven-segment-display') {
    return unique(
      bareSevenSegmentDisplayComponents.flatMap((component) =>
        requiredBareSevenSegmentCurrentPathIds(spec, component)
      )
    );
  }

  if (topologyId === 'controller-addressable-led-display') {
    return unique(
      addressableLedDisplayIds.flatMap((displayId) => [
        `addressable-led-supply-current:${displayId}`,
        `addressable-led-data-signal:${displayId}`
      ])
    );
  }

  if (topologyId === 'controller-spi-display') {
    return unique(
      spiDisplayComponents.flatMap((component) => requiredSpiDisplayCurrentPathIds(component))
    );
  }

  if (topologyId === 'controller-rgb-led-current-limited-output') {
    return unique(
      rgbLedComponents.flatMap((component) => requiredRgbLedCurrentPathIds(spec, component))
    );
  }

  if (topologyId === 'controller-powered-light-module-output') {
    return unique(
      poweredLightModuleIds.flatMap((moduleId) => [
        `powered-light-module-supply-current:${moduleId}`,
        `powered-light-module-control-signal:${moduleId}`
      ])
    );
  }

  if (
    topologyId === 'controller-pwm-actuator' ||
    topologyId === 'controller-servo-external-power-warning'
  ) {
    return ['servo-supply-current', 'servo-pwm-signal'];
  }

  if (
    topologyId === 'controller-transistor-low-side-load' ||
    topologyId === 'controller-mosfet-module-load'
  ) {
    return unique(
      lowSideLoadIds.flatMap((loadId) => [
        `low-side-load-supply-current:${loadId}`,
        `low-side-load-control-signal:${loadId}`
      ])
    );
  }

  if (
    topologyId === 'controller-uln2003-unipolar-stepper' ||
    topologyId === 'controller-step-dir-bipolar-stepper'
  ) {
    return unique(
      stepperMotorIds.flatMap((motorId) => [
        `stepper-coil-current:${motorId}`,
        `stepper-control-signals:${motorId}`
      ])
    );
  }

  if (topologyId === 'controller-hbridge-dc-motor') {
    return unique(
      hbridgeMotorIds.flatMap((motorId) => [
        `hbridge-motor-current:${motorId}`,
        `hbridge-control-signals:${motorId}`
      ])
    );
  }

  if (topologyId === 'controller-relay-low-voltage-load') {
    return unique(
      relayModuleIds.flatMap((relayId) => [
        `relay-coil-control-signal:${relayId}`,
        `relay-contact-load-current:${relayId}`
      ])
    );
  }

  return [];
}

export function requiredLedArrayDisplayCurrentPathIds(
  component: CircuitSpec['components'][number]
) {
  const requiredIds = [
    `led-array-display-supply-current:${component.id}`,
    `led-array-display-data-signal:${component.id}`,
    `led-array-display-clock-signal:${component.id}`
  ];
  if (component.partId === '8x8-matrix-max7219') {
    requiredIds.push(`led-array-display-select-signal:${component.id}`);
  }
  return requiredIds;
}

export function requiredBareSevenSegmentCurrentPathIds(
  spec: CircuitSpec,
  component: CircuitSpec['components'][number]
) {
  return unique(
    spec.connections
      .flatMap((connection) => [connection.from, connection.to])
      .filter(
        (endpoint) =>
          endpoint.componentId === component.id && ['A', 'B', 'DP'].includes(endpoint.pin)
      )
      .map((endpoint) => `bare-seven-segment-current:${component.id}:${endpoint.pin}`)
  );
}

export function requiredRgbLedCurrentPathIds(
  spec: CircuitSpec,
  component: CircuitSpec['components'][number]
) {
  return unique(
    spec.connections
      .flatMap((connection) => [connection.from, connection.to])
      .filter(
        (endpoint) =>
          endpoint.componentId === component.id && ['R', 'G', 'B'].includes(endpoint.pin)
      )
      .map((endpoint) => `rgb-led-channel-current:${component.id}:${endpoint.pin}`)
  );
}

export function requiredSpiDisplayCurrentPathIds(component: CircuitSpec['components'][number]) {
  const requiredIds = [
    `spi-display-supply-current:${component.id}`,
    `spi-display-data-signal:${component.id}`,
    `spi-display-clock-signal:${component.id}`,
    `spi-display-select-signal:${component.id}`
  ];
  if (component.partId === 'tft-18') {
    requiredIds.push(`spi-display-control-signal:${component.id}:RS`);
  } else if (component.partId === 'nokia-5110') {
    requiredIds.push(`spi-display-control-signal:${component.id}:DC`);
  } else if (component.partId === 'epaper-213') {
    requiredIds.push(`spi-display-control-signal:${component.id}:RST`);
  }
  return requiredIds;
}

export function requiredMatrixCurrentPathIds(
  spec: CircuitSpec,
  component: CircuitSpec['components'][number]
) {
  if (component.partId === 'keypad-4x4') {
    return [
      ...['R1', 'R2', 'R3', 'R4'].map((pin) => `matrix-input-scan:${component.id}:${pin}`),
      ...['C1', 'C2', 'C3', 'C4'].map((pin) => `matrix-input-sense:${component.id}:${pin}`)
    ];
  }

  if (component.partId === 'dip-switch-4') {
    return [1, 2, 3, 4].map((index) => {
      const pair = [`S${index}A`, `S${index}B`];
      const signalPin =
        pair.find((pin) =>
          findConnectionToControllerRole(spec, component.id, pin, 'digital-input')
        ) ?? pair[0];
      return `matrix-input-signal:${component.id}:${signalPin}`;
    });
  }

  if (component.partId === 'membrane-keypad-1x4') {
    return ['K1', 'K2', 'K3', 'K4'].map((pin) => `matrix-input-signal:${component.id}:${pin}`);
  }

  return [];
}

export async function filterValidatedCurrentPaths(
  spec: CircuitSpec,
  currentPaths: CurrentPath[],
  validationReport: ValidationReport,
  warnings: string[]
) {
  const validatedIds = new Set(validationReport.validatedCurrentPathIds);
  const primitiveIds = new Set((await loadSimulationPrimitives()).map((primitive) => primitive.id));
  const renderAnchors = await currentPathRenderAnchorsForSpec(spec);
  const result: CurrentPath[] = [];

  for (const path of currentPaths) {
    if (!validatedIds.has(path.id)) {
      warnings.push(`SIMULATION_PATH_NOT_VALIDATED: ${path.id} is not in validatedCurrentPathIds.`);
      continue;
    }

    if (path.primitiveId && !primitiveIds.has(path.primitiveId)) {
      warnings.push(
        `SIMULATION_PRIMITIVE_MISSING: ${path.id} references unknown primitive ${path.primitiveId}.`
      );
      continue;
    }

    const missingEndpoint = [path.from, path.to].find(
      (endpoint) => !renderAnchors.endpointKeys.has(endpoint)
    );
    if (missingEndpoint) {
      warnings.push(
        `SIMULATION_ENDPOINT_ANCHOR_MISSING: ${path.id} references ${missingEndpoint}, which has no render footprint pin anchor.`
      );
      continue;
    }

    const missingThroughComponent = path.through.find(
      (componentId) => !renderAnchors.componentIds.has(componentId)
    );
    if (missingThroughComponent) {
      warnings.push(
        `SIMULATION_PATH_COMPONENT_MISSING: ${path.id} passes through missing component ${missingThroughComponent}.`
      );
      continue;
    }

    result.push(path);
  }

  return result;
}

export async function currentPathRenderAnchorsForSpec(spec: CircuitSpec) {
  const [parts, footprints] = await Promise.all([getPartRegistry(), loadRenderFootprints()]);
  const partsById = new Map(parts.map((part) => [part.id, part]));
  const componentIds = new Set(spec.components.map((component) => component.id));
  const endpointKeys = new Set<string>();

  for (const component of spec.components) {
    const part = partsById.get(component.partId);
    const footprint = part ? footprints[part.renderFootprint.type] : undefined;
    if (!footprint) {
      continue;
    }

    for (const pinName of Object.keys(footprint.pinAnchors)) {
      endpointKeys.add(`${component.id}:${pinName}`);
    }
  }

  return { endpointKeys, componentIds };
}

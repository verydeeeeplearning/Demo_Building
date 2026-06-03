// requirementDoc.ts — extracted verbatim from circuitTools.ts (god-module split, Phase B).
// Pure relocation: no signatures or behavior changed. See PLAN_god_module_refactor.md.
import {
  type BuildRunnableReport,
  type CircuitSpec,
  type CurrentPath,
  type SimulationPlan,
  type ValidationReport
} from '../schemas.ts';

export async function compileRequirementMarkdown(
  spec: CircuitSpec,
  validationReport: ValidationReport,
  simulationPlan: SimulationPlan,
  buildRunnable: BuildRunnableReport
): Promise<string> {
  const buildBlockedReasons = buildRunnable.runnable === false ? buildRunnable.reasons : [];
  const isBuildReady = buildRunnable.runnable;
  const buildGateStatus = `\n\n_Build runnable: ${buildRunnable.status}_`;
  const blockedReasonText =
    buildBlockedReasons.length > 0
      ? ` Build runnable gate blocked this draft: ${buildBlockedReasons.join(' ')}`
      : '';
  const parts = isBuildReady
    ? spec.components.map((component) => `- ${component.label} (${component.partId})`).join('\n')
    : `- No build-ready parts. Resolve validation status \`${validationReport.status}\`, simulation status \`${simulationPlan.status}\`, and runnable gate status \`${buildRunnable.status}\` before treating this as a parts list.${blockedReasonText}`;
  const connections = isBuildReady
    ? spec.connections
        .map(
          (connection) =>
            `- **${connection.id}**: ${connection.from.componentId}:${connection.from.pin} -> ${connection.to.componentId}:${connection.to.pin}`
        )
        .join('\n')
    : `- No build-ready wiring. Resolve validation status \`${validationReport.status}\`, simulation status \`${simulationPlan.status}\`, and runnable gate status \`${buildRunnable.status}\` before treating this as a wiring guide.${blockedReasonText}`;
  const warnings =
    [
      ...validationReport.errors,
      ...validationReport.warnings,
      ...simulationPlan.warnings,
      ...buildBlockedReasons
    ]
      .map((message) => `- ${message}`)
      .join('\n') || '- None';
  const current = isBuildReady
    ? simulationPlan.currentPaths.map(formatCurrentPathForMarkdown).join('\n') ||
      '- No validated current path.'
    : `- Current-flow details are hidden until the runnable gate passes. Current runnable gate status: \`${buildRunnable.status}\`.${blockedReasonText}`;

  return `# Project Requirement: ${spec.title}

_Status: ${validationReport.status}_

_Simulation: ${simulationPlan.status}_${buildGateStatus}

## Goal

${spec.intent.primaryGoal}

## Parts Needed

${parts}

## What It Should Do

${spec.behavior.runText}

## Connections

${connections}

## Current Flow

${current}

## Safety And Validation Notes

${warnings}

## Assumptions

${spec.assumptions.map((assumption) => `- ${assumption}`).join('\n') || '- None'}
`;
}

export function formatCurrentPathForMarkdown(path: CurrentPath) {
  if (path.kind === 'signal-activity' || path.kind === 'bus-activity') {
    return `- ${path.label}: signal activity from ${path.from} to ${path.to}`;
  }
  if (path.kind === 'sensing-divider') {
    return `- ${path.label}: sensing divider from ${path.from} to ${path.to}`;
  }
  if (path.kind === 'fault-current') {
    return `- ${path.label}: fault current warning from ${path.from} to ${path.to}`;
  }
  return `- ${path.label}: about ${path.expectedCurrentMa} mA from ${path.from} to ${path.to}`;
}

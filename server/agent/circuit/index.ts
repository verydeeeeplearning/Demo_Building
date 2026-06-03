// Barrel for the circuitTools public API (god-module split, Phase B).
// Re-exports EXACTLY the pre-split public surface; call sites import these via ../circuitTools.ts.
export {
  auditBreadboardContinuityConflicts,
  auditBreadboardGridSnap,
  auditBreadboardPhysicalNodeConflicts,
  auditBreadboardPinTopology,
  auditBreadboardRailConflicts
} from './breadboardAudit.ts';
export { buildNetlist, detectFaults } from './netlist.ts';
export { auditRenderCameraFit, compileCameraFit, compileRenderPlan } from './renderPlan.ts';
export { compileRequirementMarkdown } from './requirementDoc.ts';
export {
  buildRunnableReport,
  buildSolverGateResult,
  compileSimulationPlan,
  estimateCurrentPaths
} from './simulationPlan.ts';
export {
  applyCandidatePartGate,
  applyContextCoverageGate,
  applyIntentFulfillmentGate,
  selectTopologyTemplate,
  validateCircuitSpec
} from './validation.ts';

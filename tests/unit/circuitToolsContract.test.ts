import assert from 'node:assert/strict';
import { test } from 'node:test';

// Contract-equivalence guard for the god-module split (PLAN_god_module_refactor, Phase A.4).
// `circuitTools.ts` is being relocated into `server/agent/circuit/*` behind a thin barrel. Call
// sites must keep importing the SAME public surface from `./circuitTools.ts`. This test freezes
// that surface: every pre-split export must still resolve as a callable with the same arity, so any
// dropped/renamed export or signature drift fails fast — independent of behavioral golden tests.
import * as circuitTools from '../../server/agent/circuitTools.ts';

// The frozen public contract: export name -> declared parameter count (Function.length).
// Function.length counts params before the first default/rest, which is stable across a pure move.
const EXPECTED_EXPORTS: Record<string, number> = {
  selectTopologyTemplate: 0,
  validateCircuitSpec: 1,
  applyContextCoverageGate: 2,
  applyCandidatePartGate: 2,
  applyIntentFulfillmentGate: 3,
  buildNetlist: 1,
  estimateCurrentPaths: 3,
  detectFaults: 2,
  compileRenderPlan: 2,
  compileSimulationPlan: 4,
  buildRunnableReport: 3,
  buildSolverGateResult: 4,
  compileRequirementMarkdown: 4,
  compileCameraFit: 1,
  auditRenderCameraFit: 2,
  auditBreadboardPinTopology: 1,
  auditBreadboardGridSnap: 2,
  auditBreadboardPhysicalNodeConflicts: 3,
  auditBreadboardContinuityConflicts: 3,
  auditBreadboardRailConflicts: 3
};

test('circuitTools barrel re-exports the full public function surface', () => {
  const exported = circuitTools as unknown as Record<string, unknown>;
  for (const name of Object.keys(EXPECTED_EXPORTS)) {
    assert.equal(typeof exported[name], 'function', `missing public export: ${name}`);
  }
});

test('circuitTools public exports preserve declared arity', () => {
  const exported = circuitTools as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const [name, arity] of Object.entries(EXPECTED_EXPORTS)) {
    assert.equal(exported[name].length, arity, `arity drift on ${name}`);
  }
});

test('circuitTools does not silently drop or add public exports', () => {
  // Lock the exact value-export set so an accidental new public export (leaked internal) or a
  // removed one is caught. Type-only exports are erased at runtime and are intentionally excluded.
  const actual = Object.keys(circuitTools as unknown as Record<string, unknown>)
    .filter(
      (key) => typeof (circuitTools as unknown as Record<string, unknown>)[key] === 'function'
    )
    .sort();
  assert.deepEqual(actual, Object.keys(EXPECTED_EXPORTS).sort());
});

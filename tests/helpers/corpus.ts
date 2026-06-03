// Deterministic sensibleness-measurement harness (PLAN_sensible_simulation P0).
// Runs a CircuitSpec through the real validate -> render -> simulate -> runnable pipeline with NO LLM,
// so the corpus is cheap and reproducible in CI. Reused by P1/P2 quality gates.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateCircuitSpec,
  buildNetlist,
  estimateCurrentPaths,
  compileRenderPlan,
  compileSimulationPlan,
  buildRunnableReport
} from '../../server/agent/circuitTools.ts';
import { CircuitSpecSchema } from '../../server/agent/schemas.ts';

const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/circuits');

export type SpecMeasurement = {
  id: string;
  validationStatus: string;
  runnable: boolean;
  blockingWarningCount: number;
  warningCodes: string[];
  warningCounts: Record<string, number>;
  reasons: string[];
};

export async function measureSpec(rawSpec: unknown): Promise<SpecMeasurement> {
  const spec = CircuitSpecSchema.parse(rawSpec);
  const validation = await validateCircuitSpec(spec);
  const netlist = await buildNetlist(spec);
  const currentPaths = await estimateCurrentPaths(spec, netlist, validation);
  const renderPlan = await compileRenderPlan(spec, validation);
  const simulationPlan = await compileSimulationPlan(spec, validation, currentPaths, renderPlan);
  const runnableReport = buildRunnableReport(validation, renderPlan, simulationPlan);
  const warnings = renderPlan.warnings ?? [];
  const warningCounts: Record<string, number> = {};
  for (const w of warnings) {
    warningCounts[w.code] = (warningCounts[w.code] ?? 0) + 1;
  }
  return {
    id: spec.id,
    validationStatus: validation.status,
    runnable: runnableReport.runnable,
    blockingWarningCount: runnableReport.renderBlockingWarningCount,
    warningCodes: [...new Set(warnings.map((w) => w.code))],
    warningCounts,
    reasons: runnableReport.reasons
  };
}

export function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8'));
}

export function listFixtures(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

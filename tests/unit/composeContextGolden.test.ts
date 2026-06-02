import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TopologyTemplateSchema, type PartCapability, type TopologyTemplate } from '../../server/agent/schemas.ts';
import { getPartRegistry } from '../../server/context/contextLayer.ts';
import { resolveSlotAssignments } from '../../server/context/composeTopology.ts';
import { assembleGeneratedComposition } from '../../server/context/generatedComposition.ts';

// Phase 2c golden: prove the L2 generated structural core reconstructs the L3
// curated bundle's structural core for the agreed target (≥30 of 39).
//
// GOLDEN EQUIVALENCE CLASS (reviewer C-2): compare ONLY structural fields the
// engine can deterministically generate — the validation-rule set derived from
// the bundle's required topologies, plus whether those topologies' slots are
// fillable by the bundle's allowed parts.
//
// EXPLICITLY EXCLUDED (curated, generation-impossible — must NOT be compared):
//   - BUNDLE.md safety prose / agentSummaryPath / promptBlock
//   - evals.jsonl
//   - promptBudget / promptInclusions
// The structural-core extractor below never reads any of those (it takes only
// manifest structural fields + topology templates + parts), which is the
// meta-verification of the exclusion.

const CONTEXT_ROOT = path.resolve(fileURLToPath(new URL('../../agent-context', import.meta.url)));
const GOLDEN_TARGET = 30;

// Documented exceptions. Bundles here are allowed to NOT match exactly; anything
// outside these sets that fails is a real regression and fails the test.
const KNOWN_UNRESOLVED = new Set(['logic-interface-context']);
const KNOWN_VR_DIFF = new Set([
  'dht22-temperature-humidity-display', // bundle curates an extra qualitative-readout rule
  'digital-light-output', // topology is stricter (adds common-ground/power-rail-valid)
  'low-voltage-power-rail',
  'spi-communication-module-readout' // topology adds wireless-command-state-only
]);

type BundleManifest = {
  bundleId: string;
  requiredTopologies: string[];
  allowedParts: string[];
  validationRules: string[];
};

async function loadFixtures(): Promise<{
  bundles: BundleManifest[];
  topoById: Map<string, TopologyTemplate>;
  partsById: Map<string, PartCapability>;
}> {
  const topoRaw = JSON.parse(await readFile(path.join(CONTEXT_ROOT, 'electrical/topology-templates.json'), 'utf8'));
  const topoList = (Array.isArray(topoRaw) ? topoRaw : Object.values(topoRaw)).map((t: unknown) =>
    TopologyTemplateSchema.parse(t)
  );
  const topoById = new Map(topoList.map((t) => [t.id, t]));
  const parts = await getPartRegistry();
  const partsById = new Map(parts.map((p) => [p.id, p]));

  const dirs = (await readdir(path.join(CONTEXT_ROOT, 'v2/bundles'))).sort();
  const bundles: BundleManifest[] = [];
  for (const dir of dirs) {
    try {
      const m = JSON.parse(await readFile(path.join(CONTEXT_ROOT, 'v2/bundles', dir, 'manifest.json'), 'utf8'));
      bundles.push({
        bundleId: m.bundleId,
        requiredTopologies: m.requiredTopologies ?? [],
        allowedParts: m.allowedParts ?? [],
        validationRules: m.validationRules ?? []
      });
    } catch {
      // not a bundle dir
    }
  }
  return { bundles, topoById, partsById };
}

// L2 structural core — derived ONLY from structural inputs (no prose).
function l2StructuralCore(
  manifest: BundleManifest,
  topoById: Map<string, TopologyTemplate>,
  partsById: Map<string, PartCapability>
): { resolvable: boolean; validationRules: string[] } {
  const allowed = manifest.allowedParts.map((id) => partsById.get(id)).filter((p): p is PartCapability => Boolean(p));
  const unionVR = new Set<string>();
  let resolvable = manifest.requiredTopologies.length > 0;
  for (const topologyId of manifest.requiredTopologies) {
    const template = topoById.get(topologyId);
    if (!template) {
      resolvable = false;
      continue;
    }
    for (const rule of template.validationRules) {
      unionVR.add(rule);
    }
    if (resolveSlotAssignments(template, allowed).unresolvedSlots.length > 0) {
      resolvable = false;
    }
  }
  return { resolvable, validationRules: [...unionVR].sort() };
}

function setEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

test(`golden: L2 generated structural core matches L3 curated bundle for >=${GOLDEN_TARGET} bundles`, async () => {
  const { bundles, topoById, partsById } = await loadFixtures();

  let exact = 0;
  const unresolved: string[] = [];
  const vrDiff: string[] = [];

  for (const bundle of bundles) {
    const core = l2StructuralCore(bundle, topoById, partsById);
    const bundleVR = [...new Set(bundle.validationRules)].sort();
    if (!core.resolvable) {
      unresolved.push(bundle.bundleId);
    } else if (setEqual(core.validationRules, bundleVR)) {
      exact += 1;
    } else {
      vrDiff.push(bundle.bundleId);
    }
  }

  assert.ok(exact >= GOLDEN_TARGET, `expected >=${GOLDEN_TARGET} exact structural matches, got ${exact}`);

  // Regression guard: every non-match must be a documented exception. A NEW
  // bundle that stops matching (not in the known sets) fails here.
  for (const id of unresolved) {
    assert.ok(KNOWN_UNRESOLVED.has(id), `unexpected UNRESOLVED bundle (regression): ${id}`);
  }
  for (const id of vrDiff) {
    assert.ok(KNOWN_VR_DIFF.has(id), `unexpected validation-rule mismatch (regression): ${id}`);
  }
});

test('golden meta: structural core is derived without reading curated prose (exclusion is real)', async () => {
  const { bundles, topoById, partsById } = await loadFixtures();
  const sample = bundles.find((b) => b.bundleId === 'display-text-output');
  assert.ok(sample, 'display-text-output bundle present');

  // The extractor only sees structural fields. Mutating the (excluded) prose
  // fields on the manifest cannot change the structural core, because the
  // extractor never receives them.
  const baseline = l2StructuralCore(sample, topoById, partsById);
  const withFakeProse = l2StructuralCore(
    { ...sample, ...({ summary: 'totally different prose', promptBudget: 'minimal' } as object) } as BundleManifest,
    topoById,
    partsById
  );
  assert.deepEqual(withFakeProse, baseline, 'prose/promptBudget do not affect the structural core');
});

test('golden safety: a matching bundle composes to a review-only (never build-ready) generation', async () => {
  const { bundles, topoById, partsById } = await loadFixtures();
  const sample = bundles.find((b) => b.bundleId === 'display-text-output');
  assert.ok(sample);

  const template = topoById.get(sample.requiredTopologies[0]);
  assert.ok(template, 'sample topology present');
  const candidateParts = sample.allowedParts
    .map((id) => partsById.get(id))
    .filter((p): p is PartCapability => Boolean(p));

  const composition = assembleGeneratedComposition({ template, candidateParts });
  assert.equal(composition.safetyOverlayPresent, false);
  assert.equal(composition.buildReadyScope, 'review-only', 'generated composition is never build-ready without a safety overlay');
});

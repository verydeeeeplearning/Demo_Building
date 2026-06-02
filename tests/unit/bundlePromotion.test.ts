import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TopologyTemplateSchema, type PartCapability, type TopologyTemplate } from '../../server/agent/schemas.ts';
import { getPartRegistry } from '../../server/context/contextLayer.ts';
import { resolvePartBundle } from '../../server/context/partBundle.ts';
import { assembleGeneratedComposition } from '../../server/context/generatedComposition.ts';
import { promoteCompositionToBundle } from '../../server/context/bundlePromotion.ts';

const CONTEXT_ROOT = path.resolve(fileURLToPath(new URL('../../agent-context', import.meta.url)));
const TOPOLOGY_ID = 'controller-analog-sensor-i2c-display';

async function loadTopology(id: string): Promise<TopologyTemplate> {
  const raw = JSON.parse(await readFile(path.join(CONTEXT_ROOT, 'electrical/topology-templates.json'), 'utf8'));
  const list = Array.isArray(raw) ? raw : Object.values(raw);
  return TopologyTemplateSchema.parse(list.find((candidate: { id?: string }) => candidate.id === id));
}

async function loadParts(ids: string[]): Promise<PartCapability[]> {
  const registry = await getPartRegistry();
  return ids.map((id) => registry.find((candidate) => candidate.id === id)!);
}

async function sampleComposition() {
  const template = await loadTopology(TOPOLOGY_ID);
  const parts = await loadParts(['arduino-uno', 'photoresistor-ldr', 'oled-i2c-096']);
  return assembleGeneratedComposition({ template, candidateParts: parts });
}

test('promotion derives the structural core from the L2 composition', async () => {
  const composition = await sampleComposition();
  const result = promoteCompositionToBundle({
    composition,
    capabilityId: 'analog-sensor-display-readout',
    bundleId: 'analog-sensor-display-readout',
    approval: { approvedBy: 'reviewer-a', approvedAt: '2026-06-02T00:00:00Z', safetyOverlayReviewed: true }
  });

  assert.equal(result.structural.provenance, 'promoted-from-generated-composition');
  assert.deepEqual(result.structural.validationRules, [...composition.validationRules].sort());
  assert.deepEqual(result.structural.requiredTopologies, [composition.topologyId]);
  // requiredParts come from the actually-assigned slots; allowedParts from candidates.
  assert.ok(result.structural.requiredParts.includes('arduino-uno'));
  assert.ok(result.structural.allowedParts.includes('photoresistor-ldr'));
});

test('CYCLE-BREAKER: a generated composition cannot self-promote to supported without human safety approval', async () => {
  const composition = await sampleComposition();
  assert.equal(composition.complete, true, 'precondition: composition is structurally complete');

  // No approval → not build-ready, not oracle-eligible.
  const unapproved = promoteCompositionToBundle({
    composition,
    capabilityId: 'analog-sensor-display-readout',
    bundleId: 'analog-sensor-display-readout'
  });
  assert.notEqual(unapproved.structural.supportLevel, 'supported');
  assert.equal(unapproved.structural.supportLevel, 'partial');
  assert.equal(unapproved.promotable, false);
  assert.ok(unapproved.reasons.includes('missing-human-safety-approval'));
  assert.equal(unapproved.structural.promotion.approvedBy, null);

  // With explicit human safety approval → supported + promotable.
  const approved = promoteCompositionToBundle({
    composition,
    capabilityId: 'analog-sensor-display-readout',
    bundleId: 'analog-sensor-display-readout',
    approval: { approvedBy: 'reviewer-a', approvedAt: '2026-06-02T00:00:00Z', safetyOverlayReviewed: true }
  });
  assert.equal(approved.structural.supportLevel, 'supported');
  assert.equal(approved.promotable, true);
  assert.equal(approved.structural.promotion.approvedBy, 'reviewer-a');
});

test('an incomplete composition promotes to planned, never build-ready', async () => {
  const template = await loadTopology(TOPOLOGY_ID);
  // Only the controller — sensor/display slots unfilled → incomplete.
  const parts = await loadParts(['arduino-uno']);
  const composition = assembleGeneratedComposition({ template, candidateParts: parts });
  assert.equal(composition.complete, false);

  const result = promoteCompositionToBundle({
    composition,
    capabilityId: 'analog-sensor-display-readout',
    bundleId: 'analog-sensor-display-readout',
    approval: { approvedBy: 'reviewer-a', approvedAt: '2026-06-02T00:00:00Z', safetyOverlayReviewed: true }
  });
  assert.equal(result.structural.supportLevel, 'planned');
  assert.equal(result.promotable, false);
  assert.ok(result.reasons.includes('composition-incomplete'));
});

test('L3 -> L0 referential integrity: every part referenced by a bundle resolves to an L0 part bundle', async () => {
  const dirs = await readdir(path.join(CONTEXT_ROOT, 'v2/bundles'));
  const missing: string[] = [];

  for (const dir of dirs) {
    let manifest: { requiredParts?: string[]; allowedParts?: string[] };
    try {
      manifest = JSON.parse(await readFile(path.join(CONTEXT_ROOT, 'v2/bundles', dir, 'manifest.json'), 'utf8'));
    } catch {
      continue;
    }
    const partIds = new Set([...(manifest.requiredParts ?? []), ...(manifest.allowedParts ?? [])]);
    for (const partId of partIds) {
      const bundle = await resolvePartBundle(partId);
      if (!bundle) {
        missing.push(`${dir}:${partId}`);
      }
    }
  }

  assert.deepEqual(missing, [], `every bundle part must resolve to L0 (dangling: ${missing.join(', ')})`);
});

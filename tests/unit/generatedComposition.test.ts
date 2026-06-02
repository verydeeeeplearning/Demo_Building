import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TopologyTemplateSchema, type PartCapability, type TopologyTemplate } from '../../server/agent/schemas.ts';
import { getPartRegistry } from '../../server/context/contextLayer.ts';
import { getComposeMode } from '../../server/context/composeMode.ts';
import {
  assembleGeneratedComposition,
  runShadowComposition,
  selectComposableTopology
} from '../../server/context/generatedComposition.ts';

const CONTEXT_ROOT = path.resolve(fileURLToPath(new URL('../../agent-context', import.meta.url)));
const TOPOLOGY_ID = 'controller-analog-sensor-i2c-display';

async function loadAllTopologies(): Promise<TopologyTemplate[]> {
  const raw = JSON.parse(await readFile(path.join(CONTEXT_ROOT, 'electrical/topology-templates.json'), 'utf8'));
  const list = Array.isArray(raw) ? raw : Object.values(raw);
  return list.map((entry: unknown) => TopologyTemplateSchema.parse(entry));
}

async function loadParts(ids: string[]): Promise<PartCapability[]> {
  const registry = await getPartRegistry();
  return ids.map((id) => {
    const part = registry.find((candidate) => candidate.id === id);
    assert.ok(part, `part ${id} exists`);
    return part;
  });
}

test('getComposeMode defaults to off and parses shadow/on case-insensitively', () => {
  assert.equal(getComposeMode({}), 'off');
  assert.equal(getComposeMode({ H_EDUWARE_CONTEXT_COMPOSE_MODE: 'garbage' }), 'off');
  assert.equal(getComposeMode({ H_EDUWARE_CONTEXT_COMPOSE_MODE: 'SHADOW' }), 'shadow');
  assert.equal(getComposeMode({ H_EDUWARE_CONTEXT_COMPOSE_MODE: ' on ' }), 'on');
});

test('assembleGeneratedComposition produces a structural core with generated provenance', async () => {
  const topologies = await loadAllTopologies();
  const template = topologies.find((t) => t.id === TOPOLOGY_ID);
  assert.ok(template);
  const candidateParts = await loadParts(['arduino-uno', 'photoresistor-ldr', 'oled-i2c-096']);

  const composition = assembleGeneratedComposition({ template, candidateParts });

  assert.equal(composition.provenance, 'generated-composition');
  assert.equal(composition.topologyId, TOPOLOGY_ID);
  assert.equal(composition.complete, true);
  assert.deepEqual(composition.blockingConditions, []);
  assert.deepEqual(composition.candidatePartIds, ['arduino-uno', 'oled-i2c-096', 'photoresistor-ldr']);
  assert.equal(composition.slotAssignments.controller, 'arduino-uno');
  assert.equal(composition.slotAssignments['i2c-module'], 'oled-i2c-096');
  assert.deepEqual(composition.validationRules, template.validationRules);
  assert.ok(composition.netlist.length > 0, 'netlist generated');
});

test('a generated composition is NEVER build-ready without a safety overlay (review-only)', async () => {
  const topologies = await loadAllTopologies();
  const template = topologies.find((t) => t.id === TOPOLOGY_ID);
  assert.ok(template);
  const candidateParts = await loadParts(['arduino-uno', 'photoresistor-ldr', 'oled-i2c-096']);

  const composition = assembleGeneratedComposition({ template, candidateParts });

  // Even when structurally complete, no safety overlay → must stay review-only.
  assert.equal(composition.complete, true);
  assert.equal(composition.safetyOverlayPresent, false);
  assert.equal(composition.buildReadyScope, 'review-only');
});

test('selectComposableTopology picks a fully-resolvable topology for the candidate parts', async () => {
  const topologies = await loadAllTopologies();
  const candidateParts = await loadParts(['arduino-uno', 'photoresistor-ldr', 'oled-i2c-096']);

  const template = selectComposableTopology(topologies, candidateParts);
  assert.ok(template, 'a composable topology is found');

  // And it composes completely with those parts.
  const composition = assembleGeneratedComposition({ template, candidateParts });
  assert.equal(composition.complete, true);
});

test('runShadowComposition observes via injected loader and reports gaps without throwing', async () => {
  const topologies = await loadAllTopologies();
  const candidateParts = await loadParts(['arduino-uno', 'photoresistor-ldr', 'oled-i2c-096']);

  const composed = await runShadowComposition({
    candidateParts,
    loadTemplates: async () => topologies
  });
  assert.equal(composed.status, 'composed');
  assert.equal(composed.composition?.buildReadyScope, 'review-only');

  // No composable topology for an empty candidate set → explicit status, no throw.
  const none = await runShadowComposition({
    candidateParts: [],
    loadTemplates: async () => topologies
  });
  assert.equal(none.status, 'no-composable-topology');
  assert.equal(none.composition, null);
});

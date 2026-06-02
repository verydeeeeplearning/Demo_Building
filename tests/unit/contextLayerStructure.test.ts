import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { loadContextIndex, loadContextV2Routes } from '../../server/context/contextLayer.ts';

const contextRoot = path.resolve('agent-context');

const requiredFiles = [
  'AGENTS.md',
  'index.md',
  'index.json',
  'policies/safety-policy.md',
  'policies/clarification-policy.md',
  'policies/pedagogy-policy.md',
  'policies/unsupported-request-policy.md',
  'policies/simulation-truthfulness-policy.md',
  'schemas/intent-spec.schema.json',
  'schemas/circuit-spec.schema.json',
  'schemas/part-capability.schema.json',
  'schemas/electrical-model.schema.json',
  'schemas/topology-template.schema.json',
  'schemas/simulation-spec.schema.json',
  'schemas/render-plan.schema.json',
  'schemas/validation-result.schema.json',
  'ontology/intent-primitives.md',
  'ontology/behavior-primitives.md',
  'ontology/signal-types.md',
  'ontology/pin-roles.md',
  'ontology/units-and-conventions.md',
  'ontology/learner-levels.md',
  'ontology/pin-aliases.json',
  'registry/parts.json',
  'registry/part-capabilities.json',
  'registry/part-capabilities.sources/README.md',
  'registry/part-capabilities.sources/index.json',
  'registry/part-capabilities.sources/controller.json',
  'registry/part-capabilities.sources/prototyping.json',
  'registry/part-capabilities.sources/passive.json',
  'registry/part-capabilities.sources/input.json',
  'registry/part-capabilities.sources/sensor.json',
  'registry/part-capabilities.sources/display.json',
  'registry/part-capabilities.sources/actuator.json',
  'registry/controller-boards.json',
  'registry/starter-kits.json',
  'registry/modules.json',
  'electrical/electrical-model-policy.md',
  'electrical/simplified-circuit-theory.md',
  'electrical/component-models.json',
  'electrical/topology-templates.json',
  'electrical/topology-templates.sources/README.md',
  'electrical/topology-templates.sources/index.json',
  'electrical/topology-templates.sources/starter-core.json',
  'electrical/topology-templates.sources/wp01-analog-sensors.json',
  'electrical/topology-templates.sources/wp02-digital-inputs.json',
  'electrical/topology-templates.sources/wp03-matrix-inputs.json',
  'electrical/topology-templates.sources/wp04-displays.json',
  'electrical/board-electrical-limits.json',
  'electrical/safety-limits.json',
  'electrical/netlist-rules.md',
  'electrical/calculation-recipes.md',
  'electrical/fault-detection-rules.md',
  'electrical/current-flow-explanations.md',
  'validation/rulebook.md',
  'validation/validation-errors.md',
  'validation/validator-tool-contract.md',
  'validation/examples-valid.jsonl',
  'validation/examples-invalid.jsonl',
  'simulation/primitives.json',
  'simulation/behavior-mappings.md',
  'simulation/input-controls.json',
  'simulation/simulation-limitations.md',
  'rendering/render-plan-contract.md',
  'rendering/layout-constraints.md',
  'rendering/breadboard-coordinate-system.md',
  'rendering/breadboard-grid.json',
  'rendering/pin-anchor-rules.md',
  'rendering/floating-card-anchor-policy.md',
  'data/render-footprints.sources/README.md',
  'data/render-footprints.sources/index.json',
  'data/render-footprints.sources/base-surface.json',
  'data/render-footprints.sources/starter-core.json',
  'data/render-footprints.sources/wp01-analog-sensors.json',
  'data/render-footprints.sources/wp02-digital-inputs.json',
  'data/render-footprints.sources/wp03-matrix-inputs.json',
  'data/render-footprints.sources/wp04-displays.json',
  'data/capability-graph.sources/README.md',
  'data/capability-graph.sources/index.json',
  'data/capability-graph.sources/starter-core-policy.json',
  'data/capability-graph.sources/wp01-analog-sensors.json',
  'data/capability-graph.sources/wp02-digital-inputs.json',
  'data/capability-graph.sources/wp03-matrix-inputs.json',
  'data/capability-graph.sources/wp04-displays.json',
  'routing/context-routing-map.json',
  'routing/retrieval-budget.md',
  'prompts/coordinator-system.md',
  'prompts/intent-analyst.md',
  'prompts/clarifying-interviewer.md',
  'prompts/circuit-synthesizer.md',
  'prompts/validation-reviewer.md',
  'prompts/simulation-planner.md',
  'prompts/lesson-explainer.md',
  'evals/diverse-prompts.jsonl',
  'evals/unsafe-prompts.jsonl',
  'evals/unsupported-prompts.jsonl',
  'evals/expected-intents.jsonl',
  'evals/expected-validation-results.jsonl',
  'evals/expected-simulation-results.jsonl'
];

test('context layer contains the required full directory contract', async () => {
  for (const file of requiredFiles) {
    const content = await readFile(path.join(contextRoot, file), 'utf8');
    assert.ok(content.trim().length > 20, `${file} should exist and contain useful context`);
  }
});

test('legacy v1 context layer snapshot is preserved outside runtime routing', async () => {
  const legacyRoot = path.join(contextRoot, 'legacy/v1');
  const legacyReadme = await readFile(path.join(legacyRoot, 'README.md'), 'utf8');
  const legacyIndex = JSON.parse(await readFile(path.join(legacyRoot, 'index.json'), 'utf8')) as {
    version: string;
    data: Array<{ id: string }>;
  };

  assert.match(legacyReadme, /not the active runtime context root/i);
  assert.equal(legacyIndex.version, '2026-05-31');
  assert.ok(legacyIndex.data.some((entry) => entry.id === 'capability-graph'));
  assert.ok(legacyIndex.data.some((entry) => entry.id === 'source-claims'));
});

test('context aggregates are generated from category source files', async () => {
  for (const sourceDir of [
    'registry/part-capabilities.sources',
    'data/render-footprints.sources',
    'electrical/topology-templates.sources',
    'data/capability-graph.sources'
  ]) {
    await assertGeneratedAggregate(path.join(contextRoot, sourceDir));
  }
});

async function assertGeneratedAggregate(sourceRoot: string) {
  const sourceIndex = JSON.parse(await readFile(path.join(sourceRoot, 'index.json'), 'utf8')) as {
    kind: 'array' | 'record';
    keyField: string;
    aggregatePath: string;
    categories: Array<{ id: string; path: string }>;
    order: string[];
  };
  const aggregate = JSON.parse(await readFile(path.resolve(sourceRoot, sourceIndex.aggregatePath), 'utf8')) as unknown;
  const sourceEntriesById = new Map<string, unknown>();

  for (const category of sourceIndex.categories) {
    const sourceData = JSON.parse(await readFile(path.join(sourceRoot, category.path), 'utf8')) as unknown;
    const sourceEntries = sourceIndex.kind === 'record'
      ? Object.entries(sourceData as Record<string, unknown>).map(([id, value]) => ({ id, value }))
      : (sourceData as Array<Record<string, unknown>>).map((entry) => ({
        id: String(entry[sourceIndex.keyField]),
        value: entry
      }));

    for (const entry of sourceEntries) {
      assert.equal(sourceEntriesById.has(entry.id), false, `${entry.id} is duplicated across context source files`);
      sourceEntriesById.set(entry.id, entry.value);
    }
  }

  const orderedSourceEntries = sourceIndex.order.map((entryId) => {
    const entry = sourceEntriesById.get(entryId);
    assert.ok(entry, `${entryId} is listed in source order but missing from category sources`);
    return entry;
  });

  if (sourceIndex.kind === 'record') {
    assert.deepEqual(Object.keys(aggregate as Record<string, unknown>), sourceIndex.order);
    assert.deepEqual(aggregate, Object.fromEntries(sourceIndex.order.map((id, index) => [id, orderedSourceEntries[index]])));
    return;
  }

  assert.deepEqual((aggregate as Array<Record<string, unknown>>).map((entry) => entry[sourceIndex.keyField]), sourceIndex.order);
  assert.deepEqual(aggregate, orderedSourceEntries);
}

test('active context metadata does not route runtime retrieval through legacy v1', async () => {
  const [index, v2Routes] = await Promise.all([
    loadContextIndex(),
    loadContextV2Routes()
  ]);
  const activeEntries = [
    ...index.memory,
    ...index.skills,
    ...index.references,
    ...index.data,
    ...index.routing
  ];
  const activePaths = activeEntries.map((entry) => entry.path);
  const activeSourceIds = activeEntries.flatMap((entry) => [entry.sourceId, ...entry.aliases]);
  const routeSourceIds = v2Routes.routes.flatMap((route) => [...route.alwaysInclude, ...route.bundleIds.map((id) => `bundle:${id}`)]);

  assert.equal(activePaths.some((entryPath) => entryPath.startsWith('legacy/')), false);
  assert.equal(activeSourceIds.some((sourceId) => /legacy|v1/i.test(sourceId)), false);
  assert.equal(routeSourceIds.some((sourceId) => /legacy|v1/i.test(sourceId)), false);
});

test('always-loaded memory stays compact and constitutional', async () => {
  const memory = await readFile(path.join(contextRoot, 'AGENTS.md'), 'utf8');
  const words = memory.split(/\s+/).filter(Boolean);

  assert.ok(words.length < 350, 'AGENTS.md should stay compact enough for always-loaded memory');
  assert.match(memory, /Do not finalize/i);
  assert.match(memory, /Current-flow animation/i);
  assert.match(memory, /Never invent unsupported/i);
});

test('all JSON and JSONL context fixtures parse', async () => {
  const files = await collectFiles(contextRoot);
  for (const file of files) {
    if (file.endsWith('.json')) {
      JSON.parse(await readFile(file, 'utf8'));
    }
    if (file.endsWith('.jsonl')) {
      const lines = (await readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean);
      assert.ok(lines.length > 0, `${file} should include at least one fixture`);
      for (const line of lines) {
        JSON.parse(line);
      }
    }
  }
});

test('electrical fault corpus covers core loophole cases', async () => {
  const invalidExamples = await readJsonl('validation/examples-invalid.jsonl');
  const codes = new Set(invalidExamples.flatMap((example) => example.expectedErrorCodes ?? []));

  for (const code of [
    'LED_WITHOUT_RESISTOR',
    'DIRECT_POWER_SHORT',
    'MISSING_COMMON_GROUND',
    'MOTOR_DIRECT_TO_GPIO',
    'I2C_LINES_SWAPPED',
    'UNSUPPORTED_MAINS_VOLTAGE'
  ]) {
    assert.ok(codes.has(code), `invalid corpus should include ${code}`);
  }
});

test('lesson and current-flow context require selected-target grounding for tutor answers', async () => {
  const lesson = await readFile(path.join(contextRoot, 'skills/lesson-explanation/SKILL.md'), 'utf8');
  const currentFlow = await readFile(path.join(contextRoot, 'electrical/current-flow-explanations.md'), 'utf8');

  assert.match(lesson, /Circuit Inspector Tutor Rules/);
  assert.match(lesson, /selectedTarget\.detail/);
  assert.match(lesson, /selectedTarget\.why/);
  assert.match(lesson, /selectedTarget\.missing/);
  assert.match(lesson, /validationStatus.*valid/i);
  assert.match(lesson, /validatedCurrentPathIds/);
  assert.match(lesson, /SDA|SCL/);
  assert.match(lesson, /signal communication|logic activity/i);

  assert.match(currentFlow, /Inspector Conversation Grounding/);
  assert.match(currentFlow, /I2C signal lines/i);
  assert.match(currentFlow, /logic-level communication/i);
  assert.match(currentFlow, /validated netlist/i);
  assert.match(currentFlow, /validation status is not valid/i);
});

async function collectFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

async function readJsonl(relativePath: string): Promise<Record<string, unknown>[]> {
  const content = await readFile(path.join(contextRoot, relativePath), 'utf8');
  return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

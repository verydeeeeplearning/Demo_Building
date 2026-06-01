import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

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
  'registry/controller-boards.json',
  'registry/starter-kits.json',
  'registry/modules.json',
  'electrical/electrical-model-policy.md',
  'electrical/simplified-circuit-theory.md',
  'electrical/component-models.json',
  'electrical/topology-templates.json',
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

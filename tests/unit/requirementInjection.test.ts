import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAgentUserPrompt } from '../../server/agent/deepAgentRuntime.ts';

const req = { message: 'Arduino Uno D8로 LED를 깜빡이고 싶어요', locale: 'ko' } as never;

test('US-004 — flag off (no brief option): prompt is byte-identical to the 2-arg call', () => {
  const without = buildAgentUserPrompt(req, { attempt: 1, previousErrors: [] });
  const undefinedOpts = buildAgentUserPrompt(req, { attempt: 1, previousErrors: [] }, undefined);
  assert.equal(without, undefinedOpts);
  // and it does NOT contain the requirement-document wrapper
  assert.ok(!without.includes('REQUIREMENT DOCUMENT'));
});

test('US-004 — brief present: it LEADS the prompt with the satisfies instruction', () => {
  const brief = '# Requirement document\nGoal: blink an LED\n## Required & intended parts\n- [REQUIRED] led-5mm — output';
  const prompt = buildAgentUserPrompt(req, { attempt: 1, previousErrors: [] }, { requirementBrief: brief });
  assert.ok(prompt.includes('REQUIREMENT DOCUMENT'), 'wrapper present');
  assert.ok(prompt.includes('build a circuit that satisfies'), 'satisfies instruction present');
  assert.ok(prompt.includes('Goal: blink an LED'), 'brief content present');
  // the brief block appears BEFORE the student message (leads the prompt)
  assert.ok(prompt.indexOf('REQUIREMENT DOCUMENT') < prompt.indexOf('Student message:'), 'brief leads the message');
});

test('US-004 — brief present: the raw student message is KEPT for lexical grounding (M2)', () => {
  const prompt = buildAgentUserPrompt(req, { attempt: 1, previousErrors: [] }, { requirementBrief: 'X' });
  assert.ok(
    prompt.includes('Student message: Arduino Uno D8로 LED를 깜빡이고 싶어요'),
    'verbatim student message retained alongside the brief'
  );
});

import { parseRequirementDoc } from '../../server/agent/deepAgentRuntime.ts';

test('US-002 — parseRequirementDoc extracts and validates the structured authored doc', () => {
  const output = {
    structuredResponse: {
      goal: 'Blink an LED on D8',
      controller: 'arduino-uno',
      intendedParts: [{ partId: 'led-5mm', role: 'output', required: true }],
      behavior: 'toggle D8',
      verbatimConstraints: ['D8']
    }
  };
  const doc = parseRequirementDoc(output);
  assert.equal(doc.goal, 'Blink an LED on D8');
  assert.equal(doc.intendedParts[0].partId, 'led-5mm');
  assert.deepEqual(doc.verbatimConstraints, ['D8']);
});

test('US-002 — parseRequirementDoc throws when no structured output is present', () => {
  assert.throws(() => parseRequirementDoc({ foo: 'bar' }));
  assert.throws(() => parseRequirementDoc(null));
});

test('US-002 — parseRequirementDoc extracts JSON from message content (no structuredResponse)', () => {
  const output = {
    messages: [
      { role: 'user', content: 'author it' },
      { role: 'assistant', content: '```json\n{"goal":"Blink LED","controller":"arduino-uno","intendedParts":[{"partId":"led-5mm","role":"output","required":true}],"behavior":"toggle","verbatimConstraints":["D8"]}\n```' }
    ]
  };
  const doc = parseRequirementDoc(output);
  assert.equal(doc.goal, 'Blink LED');
  assert.equal(doc.controller, 'arduino-uno');
  assert.equal(doc.intendedParts[0].partId, 'led-5mm');
  assert.deepEqual(doc.verbatimConstraints, ['D8']);
});

test('US-002 — parseRequirementDoc extracts JSON from array-content message', () => {
  const output = { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Here: {"goal":"g","intendedParts":[]}' }] }] };
  const doc = parseRequirementDoc(output);
  assert.equal(doc.goal, 'g');
});

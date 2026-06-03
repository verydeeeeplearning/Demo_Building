import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAgentUserPrompt, parseRequirementDoc } from '../../server/agent/deepAgentRuntime.ts';
import { deriveRequirementDoc, renderRequirementBrief } from '../../server/agent/circuit/requirementBrief.ts';

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

test('US-006 — counterfactual causation: different committed parts produce different driving input', () => {
  // Same kind of request, DIFFERENT candidate part sets -> the authored doc commits to different
  // required parts -> the synthesis-driving brief/prompt differs accordingly. Changing the doc
  // changes what synthesis is told to build (the mechanism by which doc drives circuit).
  const docA = deriveRequirementDoc('show text on a display', [
    { id: 'arduino-uno', kind: 'controller' },
    { id: 'oled-i2c-096', kind: 'output' }
  ]);
  const docB = deriveRequirementDoc('blink a light and buzz', [
    { id: 'arduino-uno', kind: 'controller' },
    { id: 'led-5mm', kind: 'output' },
    { id: 'buzzer', kind: 'output' }
  ]);
  const briefA = renderRequirementBrief(docA);
  const briefB = renderRequirementBrief(docB);
  assert.notEqual(briefA, briefB, 'different docs produce different briefs');
  assert.ok(briefA.includes('oled-i2c-096') && !briefA.includes('buzzer'), 'A commits OLED, not buzzer');
  assert.ok(briefB.includes('buzzer') && !briefB.includes('oled-i2c-096'), 'B commits buzzer, not OLED');

  const promptA = buildAgentUserPrompt(req, { attempt: 1, previousErrors: [] }, { requirementBrief: briefA });
  const promptB = buildAgentUserPrompt(req, { attempt: 1, previousErrors: [] }, { requirementBrief: briefB });
  assert.notEqual(promptA, promptB, 'the injected synthesis prompts differ as a function of the doc');
});

test('US-006 — secondary guard: required committed parts are the parts synthesis is instructed to include', () => {
  const doc = deriveRequirementDoc('blink LED', [
    { id: 'arduino-uno', kind: 'controller' },
    { id: 'led-5mm', kind: 'output' },
    { id: 'resistor-220', kind: 'passive' },
    { id: 'breadboard-half', kind: 'board' }
  ]);
  const brief = renderRequirementBrief(doc);
  // every required part is named in the driving brief; the optional board is not REQUIRED-marked
  for (const p of doc.intendedParts.filter((x) => x.required)) {
    assert.ok(brief.includes(p.partId), `required ${p.partId} present in driving brief`);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { RequirementDocSchema, type RequirementDoc } from '../../server/agent/schemas.ts';
import {
  renderRequirementBrief,
  deriveRequirementDoc,
  extractVerbatimConstraints,
  BRIEF_MAX_CHARS,
  REQUIRED_PART_MARKER
} from '../../server/agent/circuit/requirementBrief.ts';

const LED_PARTS = [
  { id: 'arduino-uno', kind: 'controller', label: 'Arduino Uno' },
  { id: 'led-5mm', kind: 'output', label: 'LED' },
  { id: 'resistor-220', kind: 'passive', label: '220 ohm resistor' },
  { id: 'breadboard-half', kind: 'board', label: 'Breadboard' }
];

const sampleDoc: RequirementDoc = RequirementDocSchema.parse({
  goal: 'Blink an LED on Arduino Uno D8',
  controller: 'arduino-uno',
  inputs: ['time'],
  outputs: ['LED on/off blink'],
  intendedParts: [
    { partId: 'arduino-uno', role: 'controller', required: true },
    { partId: 'led-5mm', role: 'output', required: true },
    { partId: 'resistor-220', role: 'passive', required: true },
    { partId: 'breadboard-half', role: 'board', required: false }
  ],
  behavior: 'Toggle D8 HIGH/LOW to blink the LED through a 220Ω series resistor.',
  verbatimConstraints: ['pin D8', '220 ohm'],
  assumptions: ['5V logic']
});

test('US-001 — RequirementDocSchema validates a full document', () => {
  assert.equal(sampleDoc.goal, 'Blink an LED on Arduino Uno D8');
  assert.equal(sampleDoc.intendedParts.length, 4);
  // defaults apply for omitted optional arrays
  const minimal = RequirementDocSchema.parse({ goal: 'x' });
  assert.deepEqual(minimal.intendedParts, []);
  assert.equal(minimal.controller, null);
});

test('US-001 — renderRequirementBrief renders goal, behavior and parts', () => {
  const brief = renderRequirementBrief(sampleDoc);
  assert.ok(brief.includes('Blink an LED on Arduino Uno D8'), 'brief contains the goal');
  assert.ok(brief.includes('Toggle D8 HIGH/LOW'), 'brief contains the behavior');
  assert.ok(brief.includes('arduino-uno'), 'brief lists intended parts');
});

test('US-001 — brief is <= BRIEF_MAX_CHARS (1200) for a realistic doc', () => {
  assert.equal(BRIEF_MAX_CHARS, 1200);
  const brief = renderRequirementBrief(sampleDoc);
  assert.ok(brief.length <= BRIEF_MAX_CHARS, `brief length ${brief.length} must be <= ${BRIEF_MAX_CHARS}`);
});

test('US-001 — required parts render with an explicit REQUIRED marker; optional parts do not', () => {
  const brief = renderRequirementBrief(sampleDoc);
  // commitment is visible: the marker is a token the neutral registry summary does not emit
  assert.ok(brief.includes(REQUIRED_PART_MARKER), 'brief marks required parts');
  // the required led part line carries the marker (led-5mm appears only in the parts list,
  // not in any header, so this targets the part line unambiguously)
  const requiredLine = brief.split('\n').find((l) => l.startsWith('-') && l.includes('led-5mm'));
  assert.ok(requiredLine && requiredLine.includes(REQUIRED_PART_MARKER), 'required part line carries the marker');
  // the optional breadboard line does NOT carry the marker
  const optionalLine = brief.split('\n').find((l) => l.includes('breadboard-half'));
  assert.ok(optionalLine && !optionalLine.includes(REQUIRED_PART_MARKER), 'optional part line has no REQUIRED marker');
});

test('US-001 — hard cap is enforced even for an oversized doc', () => {
  const huge = RequirementDocSchema.parse({
    goal: 'g',
    behavior: 'b'.repeat(5000),
    verbatimConstraints: Array.from({ length: 50 }, (_, i) => `constraint ${i} ${'x'.repeat(40)}`)
  });
  const brief = renderRequirementBrief(huge);
  assert.ok(brief.length <= BRIEF_MAX_CHARS, `oversized brief length ${brief.length} must be capped at ${BRIEF_MAX_CHARS}`);
});

test('US-002 — deriveRequirementDoc populates goal, controller and committed parts', () => {
  const doc = deriveRequirementDoc('Arduino Uno D8로 LED를 깜빡이고 싶어요', LED_PARTS, {
    primaryGoal: 'Blink an LED on D8',
    controller: 'arduino-uno',
    output: 'LED blink'
  });
  assert.equal(doc.goal, 'Blink an LED on D8');
  assert.equal(doc.controller, 'arduino-uno');
  assert.equal(doc.intendedParts.length, 4);
  // controller / output / passive are committed REQUIRED; board is optional
  const required = doc.intendedParts.filter((p) => p.required).map((p) => p.partId).sort();
  assert.deepEqual(required, ['arduino-uno', 'led-5mm', 'resistor-220']);
  const board = doc.intendedParts.find((p) => p.partId === 'breadboard-half');
  assert.equal(board?.required, false);
});

test('US-002 — verbatimConstraints captures lexical detail (pin D8, value, count)', () => {
  const constraints = extractVerbatimConstraints('D8로 LED를 2번 깜빡, 220 ohm 저항 사용');
  assert.ok(constraints.some((c) => c.toUpperCase() === 'D8'), 'captures pin D8');
  assert.ok(constraints.some((c) => /220\s?ohm/i.test(c)), 'captures resistor value');
  assert.ok(constraints.some((c) => /2\s?번/.test(c)), 'captures repeat count');
  // and the derived doc carries them
  const doc = deriveRequirementDoc('D8로 LED를 깜빡', LED_PARTS);
  assert.ok(doc.verbatimConstraints.some((c) => c.toUpperCase() === 'D8'));
});

test('US-002 — edge case: empty candidateParts yields a safe doc with no committed parts (no throw)', () => {
  const doc = deriveRequirementDoc('make something blink', []);
  assert.equal(doc.intendedParts.length, 0);
  assert.equal(doc.controller, null);
  assert.ok(doc.goal.length > 0);
});

test('US-002 — brief renders the deterministically derived doc end-to-end', () => {
  const doc = deriveRequirementDoc('Arduino Uno D8로 LED 깜빡', LED_PARTS, { primaryGoal: 'Blink LED' });
  const brief = renderRequirementBrief(doc);
  assert.ok(brief.includes('Blink LED'));
  assert.ok(brief.includes(REQUIRED_PART_MARKER));
  assert.ok(brief.length <= BRIEF_MAX_CHARS);
});

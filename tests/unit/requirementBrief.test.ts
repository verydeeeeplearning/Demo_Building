import assert from 'node:assert/strict';
import test from 'node:test';

import { RequirementDocSchema, type RequirementDoc } from '../../server/agent/schemas.ts';
import {
  renderRequirementBrief,
  BRIEF_MAX_CHARS,
  REQUIRED_PART_MARKER
} from '../../server/agent/circuit/requirementBrief.ts';

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

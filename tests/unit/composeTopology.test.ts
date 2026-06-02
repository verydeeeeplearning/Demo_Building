import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TopologyTemplateSchema, type PartCapability, type TopologyTemplate } from '../../server/agent/schemas.ts';
import { getPartRegistry } from '../../server/context/contextLayer.ts';
import {
  composeTopology,
  partFillsSlotRole,
  resolveSlotAssignments,
  topologySlotRoles,
  type SlotAssignments
} from '../../server/context/composeTopology.ts';

const CONTEXT_ROOT = path.resolve(fileURLToPath(new URL('../../agent-context', import.meta.url)));
const TOPOLOGY_ID = 'controller-analog-sensor-i2c-display';

async function loadTopology(id: string): Promise<TopologyTemplate> {
  const raw = JSON.parse(await readFile(path.join(CONTEXT_ROOT, 'electrical/topology-templates.json'), 'utf8'));
  const list = Array.isArray(raw) ? raw : Object.values(raw);
  const entry = list.find((candidate: { id?: string }) => candidate.id === id);
  assert.ok(entry, `topology ${id} exists in aggregate`);
  return TopologyTemplateSchema.parse(entry);
}

async function loadParts(ids: string[]): Promise<PartCapability[]> {
  const registry = await getPartRegistry();
  return ids.map((id) => {
    const part = registry.find((candidate) => candidate.id === id);
    assert.ok(part, `part ${id} exists in registry`);
    return part;
  });
}

test('topologySlotRoles derives part slots from connection fromRoles', async () => {
  const template = await loadTopology(TOPOLOGY_ID);
  assert.deepEqual(topologySlotRoles(template), ['analog-sensor', 'controller', 'i2c-module']);
});

test('composeTopology wires every endpoint to a real pin when all slots are assigned', async () => {
  const template = await loadTopology(TOPOLOGY_ID);
  const [arduino, ldr, oled] = await loadParts(['arduino-uno', 'photoresistor-ldr', 'oled-i2c-096']);
  const assignments: SlotAssignments = new Map([
    ['controller', arduino],
    ['analog-sensor', ldr],
    ['i2c-module', oled]
  ]);

  const result = composeTopology(template, assignments);

  assert.equal(result.complete, true, 'fully assigned topology composes completely');
  assert.deepEqual(result.blockingConditions, [], 'no blocking conditions');

  // vcc net aggregates the three power endpoints (controller/sensor/module).
  const vcc = result.nets.find((net) => net.id === 'vcc');
  assert.ok(vcc, 'vcc net present');
  assert.equal(vcc.endpoints.length, 3, 'vcc has three power endpoints');

  // Every generated endpoint references a real pin on its assigned part.
  const partById = new Map(assignments);
  for (const net of result.nets) {
    for (const endpoint of net.endpoints) {
      const part = partById.get(endpoint.slotRole);
      assert.ok(part, `endpoint slot ${endpoint.slotRole} is assigned`);
      assert.ok(
        part.pins.some((pin) => pin.name === endpoint.pin),
        `${endpoint.partId} actually has pin ${endpoint.pin}`
      );
    }
  }
});

test('unfilled slot and missing pin role surface as explicit blockingConditions (no silent gaps)', async () => {
  const template = await loadTopology(TOPOLOGY_ID);
  const [arduino, oled, led] = await loadParts(['arduino-uno', 'oled-i2c-096', 'led-5mm']);

  // Missing analog-sensor assignment → explicit unresolved-slot-role.
  const missingSlot = composeTopology(template, new Map([
    ['controller', arduino],
    ['i2c-module', oled]
  ]));
  assert.equal(missingSlot.complete, false);
  assert.ok(
    missingSlot.blockingConditions.includes('unresolved-slot-role:analog-sensor'),
    'missing slot reported'
  );

  // LED has no i2c pins → assigning it to i2c-module yields unresolved-pin-role.
  const wrongPart = composeTopology(template, new Map([
    ['controller', arduino],
    ['analog-sensor', led],
    ['i2c-module', led]
  ]));
  assert.equal(wrongPart.complete, false);
  assert.ok(
    wrongPart.blockingConditions.some((c) => c.startsWith('unresolved-pin-role:i2c-module.')),
    'missing pin role reported'
  );
});

test('resolveSlotAssignments picks role-filling parts deterministically, end to end', async () => {
  const template = await loadTopology(TOPOLOGY_ID);
  const candidates = await loadParts([
    'arduino-uno', 'photoresistor-ldr', 'oled-i2c-096', 'led-5mm', 'resistor-220'
  ]);

  const { assignments, unresolvedSlots } = resolveSlotAssignments(template, candidates);
  assert.deepEqual(unresolvedSlots, [], 'all slots resolved from candidates');
  assert.equal(assignments.get('controller')?.id, 'arduino-uno');
  assert.equal(assignments.get('analog-sensor')?.id, 'photoresistor-ldr');
  assert.equal(assignments.get('i2c-module')?.id, 'oled-i2c-096');

  const composed = composeTopology(template, assignments);
  assert.equal(composed.complete, true, 'auto-resolved assignment composes completely');
});

test('partFillsSlotRole maps the foundational slot roles, blocks uncovered ones', async () => {
  const [arduino, ldr, oled, led, resistor] = await loadParts([
    'arduino-uno', 'photoresistor-ldr', 'oled-i2c-096', 'led-5mm', 'resistor-220'
  ]);

  assert.equal(partFillsSlotRole(arduino, 'controller'), true);
  assert.equal(partFillsSlotRole(ldr, 'analog-sensor'), true);
  assert.equal(partFillsSlotRole(oled, 'i2c-module'), true);
  assert.equal(partFillsSlotRole(led, 'dc-load'), true);
  assert.equal(partFillsSlotRole(resistor, 'series-current-limit'), true);

  // A slot role outside the first batch is not silently matched.
  assert.equal(partFillsSlotRole(arduino, 'hbridge-driver'), false);
});

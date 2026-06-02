import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { z } from 'zod';

import { applyIntentFulfillmentGate } from '../../server/agent/circuitTools.ts';
// Phase 1 (RC-A): the modality taxonomy is a single shared source of truth. A generic output/input
// modality (e.g. `display`, `motion`, `digital-input`) must be satisfiable by ANY of its specific
// variants. Before this module existed the gate marked CORRECT circuits invalid because the generic
// modality had no part mapped to it (trace evidence: tft-18 SPI display, dc-motor, 7-seg, joystick).
import {
  partFulfillsInputModality,
  partFulfillsOutputModality
} from '../../server/agent/modalityFulfillment.ts';
import { CircuitSpecSchema, PartCapabilitySchema, type CircuitSpec, type PartCapability, type ValidationReport } from '../../server/agent/schemas.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const REGISTRY_PATH = path.join(REPO_ROOT, 'agent-context', 'registry', 'part-capabilities.json');

let registryCache: Map<string, PartCapability> | null = null;
async function loadParts(): Promise<Map<string, PartCapability>> {
  if (registryCache) return registryCache;
  const raw = await readFile(REGISTRY_PATH, 'utf8');
  const parts = z.array(PartCapabilitySchema).parse(JSON.parse(raw));
  registryCache = new Map(parts.map((part) => [part.id, part]));
  return registryCache;
}

async function part(id: string): Promise<PartCapability> {
  const found = (await loadParts()).get(id);
  assert.ok(found, `registry part ${id} must exist for this test`);
  return found;
}

void test('RC-A output: generic `display` is satisfied by every concrete display variant', async () => {
  assert.equal(partFulfillsOutputModality(await part('tft-18'), 'display'), true, 'SPI TFT fulfills display');
  assert.equal(partFulfillsOutputModality(await part('oled-i2c-096'), 'display'), true, 'I2C OLED (text) fulfills display');
  assert.equal(partFulfillsOutputModality(await part('7seg-1digit'), 'display'), true, '7-seg fulfills display');
  assert.equal(partFulfillsOutputModality(await part('neopixel-ring-12'), 'display'), true, 'addressable LED fulfills display');
});

void test('RC-A output: generic `motion` is satisfied by servo, DC-motor, stepper, and h-bridge drives', async () => {
  assert.equal(partFulfillsOutputModality(await part('micro-servo'), 'motion'), true, 'servo fulfills motion');
  assert.equal(partFulfillsOutputModality(await part('dc-motor-130'), 'motion'), true, 'DC motor fulfills motion');
  assert.equal(partFulfillsOutputModality(await part('uln2003-driver'), 'motion'), true, 'stepper driver fulfills motion');
  assert.equal(partFulfillsOutputModality(await part('stepper-28byj48'), 'motion'), true, 'stepper motor fulfills motion');
  assert.equal(partFulfillsOutputModality(await part('l298n-driver'), 'motion'), true, 'h-bridge driver fulfills motion');
});

void test('RC-A output: `led-array-display` covers 7-seg/numeric; `switched-load` covers relays', async () => {
  assert.equal(partFulfillsOutputModality(await part('7seg-1digit'), 'led-array-display'), true, '7-seg is an LED array');
  assert.equal(partFulfillsOutputModality(await part('7seg-4digit-tm1637'), 'led-array-display'), true, 'tm1637 is an LED array');
  assert.equal(partFulfillsOutputModality(await part('relay-1ch'), 'switched-load'), true, 'a relay is a switched load');
});

void test('RC-A input: generic `digital-input` is satisfied by joystick/rotary push + switches', async () => {
  assert.equal(partFulfillsInputModality(await part('joystick-module'), 'digital-input'), true, 'joystick button is a digital input');
  assert.equal(partFulfillsInputModality(await part('rotary-encoder'), 'digital-input'), true, 'rotary encoder is a digital input');
  assert.equal(partFulfillsInputModality(await part('limit-switch'), 'digital-input'), true, 'limit switch stays a digital input');
});

void test('NEGATIVE: widening must not let a genuinely-missing output pass', async () => {
  assert.equal(partFulfillsOutputModality(await part('led-5mm'), 'display'), false, 'a bare LED is not a display');
  assert.equal(partFulfillsOutputModality(await part('resistor-220'), 'motion'), false, 'a resistor is not motion');
  assert.equal(partFulfillsOutputModality(await part('oled-i2c-096'), 'motion'), false, 'an OLED is not motion');
  assert.equal(partFulfillsInputModality(await part('led-5mm'), 'digital-input'), false, 'an output LED is not a digital input');
});

// ---- Gate-level: a correct circuit with the right output part must stay valid ---------------------

function validReport(): ValidationReport {
  return {
    version: '2026-05-31',
    status: 'valid',
    errors: [],
    warnings: [],
    validatedCurrentPathIds: [],
    sourceVersion: '2026-05-31'
  };
}

async function specFor(partIds: string[]): Promise<CircuitSpec> {
  return CircuitSpecSchema.parse({
    id: 'test-spec',
    title: 'Test Spec',
    intent: { primaryGoal: 'test', output: 'test', controller: 'arduino-uno' },
    components: partIds.map((id, i) => ({ id: `c${i}`, partId: id, label: id })),
    connections: [],
    behavior: { runText: 'runs' },
    assumptions: [],
    unsupportedItems: [],
    clarificationNeeds: []
  });
}

void test('GATE: a correct tft-18 SPI-display circuit is NOT marked INTENT_OUTPUT_NOT_FULFILLED', async () => {
  const candidates = [await part('arduino-uno'), await part('breadboard-half'), await part('tft-18')];
  const spec = await specFor(['arduino-uno', 'breadboard-half', 'tft-18']);
  const intent = { studentGoal: 'SPI 디스플레이에 글자 표시', outputModalities: ['display', 'spi-display', 'graphic-display'], inputModalities: [] } as never;
  const out = applyIntentFulfillmentGate(validReport(), spec, intent, candidates);
  assert.equal(out.status, 'valid', `expected valid, got ${out.status}: ${out.errors.join(' | ')}`);
});

void test('GATE: a correct DC-motor (low-side) circuit is NOT marked INTENT_OUTPUT_NOT_FULFILLED', async () => {
  const candidates = [await part('arduino-uno'), await part('breadboard-half'), await part('irf520-mosfet'), await part('dc-motor-130')];
  const spec = await specFor(['arduino-uno', 'breadboard-half', 'irf520-mosfet', 'dc-motor-130']);
  const intent = { studentGoal: 'DC 모터 구동', outputModalities: ['motion', 'switched-load', 'motor-output'], inputModalities: [] } as never;
  const out = applyIntentFulfillmentGate(validReport(), spec, intent, candidates);
  assert.equal(out.status, 'valid', `expected valid, got ${out.status}: ${out.errors.join(' | ')}`);
});

void test('GATE: a genuinely-missing output IS still rejected (no false negative)', async () => {
  // Student asked for motion but the circuit only has an OLED — must stay rejected.
  const candidates = [await part('arduino-uno'), await part('breadboard-half'), await part('oled-i2c-096')];
  const spec = await specFor(['arduino-uno', 'breadboard-half', 'oled-i2c-096']);
  const intent = { studentGoal: '모터를 돌리고 싶어', outputModalities: ['motion'], inputModalities: [] } as never;
  const out = applyIntentFulfillmentGate(validReport(), spec, intent, candidates);
  assert.equal(out.status, 'invalid', 'a missing motion output must still fail the gate');
  assert.ok(out.errors.some((e) => e.includes('INTENT_OUTPUT_NOT_FULFILLED')), 'reports the unfulfilled modality');
});

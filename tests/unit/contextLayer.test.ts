import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPartRegistry,
  loadCapabilityGraph,
  loadContextBundleV2,
  loadContextIndex,
  loadContextV2Index,
  matchCapabilities,
  readContextDoc,
  resolvePinAlias,
  searchPartCapabilities
} from '../../server/context/contextLayer.ts';

test('context index exposes always-loaded memory, skills, references, and data files', async () => {
  const index = await loadContextIndex();

  assert.equal(index.memory.some((entry) => entry.path.endsWith('AGENTS.md')), true);
  assert.equal(index.skills.length >= 5, true);
  assert.equal(index.references.some((entry) => /electrical/i.test(entry.id)), true);
  assert.equal(index.data.some((entry) => entry.id === 'part-capabilities'), true);
});

test('context v2 bundle files are resolvable and compact', async () => {
  const index = await loadContextV2Index();

  for (const bundleEntry of index.bundles) {
    const bundle = await loadContextBundleV2(bundleEntry.bundleId);
    assert.ok(bundle.summary.length > 0, `${bundleEntry.bundleId} summary exists`);
    assert.ok(bundle.summary.length <= 1500, `${bundleEntry.bundleId} summary stays compact`);
    assert.equal(bundle.manifest.bundleId, bundleEntry.bundleId);
  }
});

test('context references do not point at missing files', async () => {
  const index = await loadContextIndex();
  const allEntries = [...index.memory, ...index.skills, ...index.references, ...index.data];

  for (const entry of allEntries) {
    const content = await readContextDoc(entry.id);
    assert.ok(content.length > 20, `${entry.id} should resolve to readable context`);
  }
});

test('context index exposes source claims and support bundles as canonical data', async () => {
  const index = await loadContextIndex();
  const dataIds = new Set(index.data.map((entry) => entry.id));
  const referenceIds = new Set(index.references.map((entry) => entry.id));

  assert.ok(referenceIds.has('source-authority'));
  assert.ok(referenceIds.has('source-collection-playbook'));
  assert.ok(dataIds.has('source-claims'));
  assert.ok(dataIds.has('hardware-support-bundles'));

  const sourceClaims = index.data.find((entry) => entry.id === 'source-claims');
  assert.equal(sourceClaims?.canonical, true);
  assert.equal(sourceClaims?.level, 'L3');
});

test('part capability search resolves aliases for diverse student requests', async () => {
  const ledMatches = await searchPartCapabilities('blink a light with resistor');
  const buttonMatches = await searchPartCapabilities('press a button input');
  const buzzerMatches = await searchPartCapabilities('make a beep alarm');
  const servoMatches = await searchPartCapabilities('move a servo arm');
  const oledMatches = await searchPartCapabilities('show text on a tiny screen');
  const dht11Matches = await searchPartCapabilities('read DHT11 temperature and humidity');

  assert.ok(ledMatches.some((part) => part.id === 'led-5mm'));
  assert.ok(buttonMatches.some((part) => part.id === 'button-tactile'));
  assert.ok(buzzerMatches.some((part) => part.id === 'piezo-buzzer'));
  assert.ok(servoMatches.some((part) => part.id === 'micro-servo'));
  assert.ok(oledMatches.some((part) => part.id === 'oled-i2c-096'));
  assert.ok(dht11Matches.some((part) => part.id === 'dht11'));
});

test('supported part capabilities declare support level, capability tags, and simulation primitive mappings', async () => {
  const parts = await getPartRegistry();
  const classroomParts = parts.filter((part) => !['breadboard-half', 'jumper-wire'].includes(part.id));

  for (const part of classroomParts) {
    assert.equal(part.supportLevel, 'supported', `${part.id} support level`);
    assert.ok(part.capabilities.length > 0, `${part.id} has capability tags`);
    assert.ok(part.compatibleSimulationPrimitives.length > 0, `${part.id} maps to simulation primitives`);
  }

  const oled = parts.find((part) => part.id === 'oled-i2c-096');
  assert.ok(oled?.capabilities.includes('display-text'));
  assert.ok(oled?.compatibleSimulationPrimitives.includes('display_static_text'));

  const led = parts.find((part) => part.id === 'led-5mm');
  assert.ok(led?.capabilities.includes('digital-output-load'));
  assert.ok(led?.compatibleSimulationPrimitives.includes('current_flow_animation'));
});

test('capability graph distinguishes supported capabilities from planned context gaps', async () => {
  const graph = await loadCapabilityGraph();
  const display = graph.find((capability) => capability.id === 'display-text-output');
  const dimmerMatches = await matchCapabilities('가변저항 다이얼로 LED 밝기를 조절하고 싶어');

  assert.equal(display?.supportLevel, 'supported');
  assert.ok(display?.requiredParts.includes('oled-i2c-096'));
  assert.ok(display?.simulationPrimitives.includes('display_static_text'));

  const analogDimmer = dimmerMatches.find((capability) => capability.id === 'analog-led-dimmer');
  assert.equal(analogDimmer?.supportLevel, 'supported');
  assert.ok(analogDimmer?.requiredParts.includes('potentiometer-10k'));

  const dht11Matches = await matchCapabilities('Show temperature and humidity from a DHT11 on the OLED display');
  const dht11Display = dht11Matches.find((capability) => capability.id === 'dht11-temperature-humidity-display');
  assert.equal(dht11Display?.supportLevel, 'supported');
  assert.ok(dht11Display?.requiredParts.includes('dht11'));
});

test('capability graph entries expose scoring metadata for retrieval', async () => {
  const graph = await loadCapabilityGraph();

  for (const capability of graph) {
    assert.ok(capability.positivePhrases.length > 0, `${capability.id} declares positive phrases`);
    assert.ok(capability.requiredEvidence.length > 0, `${capability.id} declares required evidence`);
    assert.ok(Array.isArray(capability.negativeEvidence), `${capability.id} declares negative evidence`);
    assert.ok(capability.minimumScore > 0 && capability.minimumScore <= 1, `${capability.id} declares minimum score`);
  }
});

test('capability graph does not overmatch generic Arduino or current-flow wording', async () => {
  const matches = await matchCapabilities('Arduino Uno and breadboard show text on I2C OLED with current flow');
  const ids = matches.map((capability) => capability.id);

  assert.ok(ids.includes('display-text-output'));
  assert.equal(ids.includes('digital-light-output'), false);
  assert.equal(ids.includes('button-controlled-light-output'), false);
  assert.equal(ids.includes('sound-alert-output'), false);
});

test('capability graph uses negative evidence to avoid matching app-screen visualization as hardware display', async () => {
  const matches = await matchCapabilities('I want to see current flow on the screen');
  const ids = matches.map((capability) => capability.id);

  assert.equal(ids.includes('display-text-output'), false);
  assert.equal(ids.includes('distance-sensor-display'), false);
  assert.equal(ids.includes('dht11-temperature-humidity-display'), false);
});

test('capability graph does not promote a simple LED request into a light sensor context gap', async () => {
  const ledMatches = await matchCapabilities('Arduino LED with resistor, show current flow');
  const ledIds = ledMatches.map((capability) => capability.id);

  assert.ok(ledIds.includes('digital-light-output'));
  assert.equal(ledIds.includes('light-sensor-triggered-output'), false);

  const darkRoomMatches = await matchCapabilities('turn on LED when the room is dark');
  const darkRoomIds = darkRoomMatches.map((capability) => capability.id);

  assert.ok(darkRoomIds.includes('light-sensor-triggered-output'));
});

test('pin alias resolver canonicalizes English and Korean student pin names', async () => {
  const arduinoSda = await resolvePinAlias({ partId: 'arduino-uno', pinAlias: 'A4' });
  const oledPower = await resolvePinAlias({ partId: 'oled-i2c-096', pinAlias: '전원' });
  const oledGround = await resolvePinAlias({ partId: 'oled-i2c-096', pinAlias: '접지' });
  const unknown = await resolvePinAlias({ partId: 'oled-i2c-096', pinAlias: 'not-a-pin' });

  assert.equal(arduinoSda?.canonicalPin, 'A4/SDA');
  assert.equal(arduinoSda?.role, 'i2c-data');
  assert.equal(oledPower?.canonicalPin, 'VCC');
  assert.equal(oledGround?.canonicalPin, 'GND');
  assert.equal(unknown, null);
});

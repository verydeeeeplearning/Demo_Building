import assert from 'node:assert/strict';
import test from 'node:test';

import { buildContextPacket } from '../../server/context/contextPacket.ts';

test('context packet grounds an OLED display request with registry, policy, validation, render, and simulation evidence', async () => {
  const packet = await buildContextPacket({
    message: 'Arduino Uno로 작은 OLED 화면에 HELLO STEM을 표시하고 전류 흐름을 보여줘',
    locale: 'ko'
  });

  assert.equal(packet.locale, 'ko');
  assert.ok(packet.intentHints.outputModalities.includes('display'));
  assert.ok(packet.candidateParts.some((part) => part.id === 'oled-i2c-096'));
  assert.ok(packet.candidateParts.some((part) => part.id === 'arduino-uno'));
  assert.ok(packet.candidateParts.some((part) => part.id === 'breadboard-half'));
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'registry:part-capabilities:oled-i2c-096'));
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'policy:safety-policy'));
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'reference:validation-rules'));
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'reference:simulation-recipes'));
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'reference:rendering-footprints'));
  assert.equal(packet.contextRoute.routeId, 'display-i2c-output');
  assert.ok(packet.retrievalPlan.sourceIds.includes('simulation:primitives'), packet.retrievalPlan.sourceIds.join(', '));
  assert.ok(packet.retrievalPlan.sourceIds.includes('rendering:render-footprints'), packet.retrievalPlan.sourceIds.join(', '));
  assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
  assert.match(packet.promptBlock, /CONTEXT PACKET/i);
  assert.match(packet.promptBlock, /oled-i2c-096/);
});

test('context packet marks unsafe high-voltage requests before synthesis', async () => {
  const packet = await buildContextPacket({
    message: '220V 콘센트에 직접 연결하는 히터 회로를 브레드보드로 만들어줘',
    locale: 'ko'
  });

  assert.ok(packet.intentHints.safetyConcerns.some((concern) => /high-voltage|mains/i.test(concern)));
  assert.ok(packet.unsupportedSignals.some((signal) => /220V|mains|high-voltage/i.test(signal)));
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'policy:safety-policy'));
  assert.match(packet.promptBlock, /unsupported/i);
});

test('context packet carries structured intent before capability synthesis', async () => {
  const packet = await buildContextPacket({
    message: 'In a dark room, turn on an LED with Arduino.',
    locale: 'en'
  });

  assert.equal(packet.intentSpec.studentGoal, 'In a dark room, turn on an LED with Arduino.');
  assert.ok(packet.intentSpec.behaviors.some((behavior) => behavior.action.includes('light')));
  assert.ok(packet.intentSpec.inputModalities.includes('light-sensor'));
  assert.ok(packet.intentSpec.outputModalities.includes('light'));
  assert.ok(packet.intentSpec.controllerAssumptions.includes('arduino-compatible'));
  assert.ok(packet.intentSpec.ambiguities.some((item) => /planned|not fully supported|No concrete/i.test(item)));
  assert.equal(packet.intentSpec.language, 'en');
  assert.match(packet.promptBlock, /Intent spec:/i);
});

test('context packet uses current draft context to route natural confirmation follow-ups', async () => {
  const packet = await buildContextPacket({
    message: '좋아 구현 부탁해',
    locale: 'ko',
    conversationContext: {
      recentTurns: [
        { role: 'student', text: 'LED 깜빡이기' },
        { role: 'assistant', text: 'Arduino D9, 220 ohm resistor, LED, and GND are connected in series.' }
      ],
      currentArtifact: {
        source: 'draft',
        title: 'LED blinker'
      },
      lastSupportedGoal: 'blink an LED with Arduino',
      awaitingBuildConfirmation: true
    }
  });

  assert.equal(packet.studentMessage, '좋아 구현 부탁해');
  assert.equal(packet.contextRoute.routeId, 'digital-output-series-load');
  assert.ok(packet.intentHints.outputModalities.includes('light'));
  assert.ok(packet.candidateParts.some((part) => part.id === 'led-5mm'));
  assert.ok(packet.candidateParts.some((part) => part.id === 'resistor-220'));
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'conversation:current-artifact'));
  assert.match(packet.promptBlock, /Current artifact context/i);
});

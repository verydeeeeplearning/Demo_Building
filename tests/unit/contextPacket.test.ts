import assert from 'node:assert/strict';
import test from 'node:test';

import { buildContextPacket } from '../../server/context/contextPacket.ts';

test('context packet grounds an OLED display request with v2 bundle metadata and bounded evidence', async () => {
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
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'bundle:display-text-output'));
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'policy:safety-policy'));
  assert.equal(packet.contextRoute.routeId, 'v2-display-text-output');
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:display-text-output'), packet.retrievalPlan.sourceIds.join(', '));
  assert.ok(packet.retrievalPlan.omittedSourceIds.includes('simulation:primitives'), packet.retrievalPlan.omittedSourceIds.join(', '));
  assert.ok(packet.retrievalPlan.omittedSourceIds.includes('rendering:render-footprints'), packet.retrievalPlan.omittedSourceIds.join(', '));
  assert.ok(packet.promptBlock.length <= packet.retrievalPlan.maxPromptChars);
  assert.match(packet.promptBlock, /CONTEXT PACKET/i);
  assert.match(packet.promptBlock, /Display Text Output/);
  assert.match(packet.promptBlock, /oled-i2c-096/);
  assert.doesNotMatch(packet.promptBlock, /"pinAnchors"\s*:/);
});

test('context packet prioritizes explicit NeoPixel ring requests over generic LED routing', async () => {
  const packet = await buildContextPacket({
    message: 'Arduino Uno로 NeoPixel 12 LED 링에 빨강 초록 파랑 패턴을 표시하는 회로를 만들어줘.',
    locale: 'ko'
  });

  assert.equal(packet.contextRoute.routeId, 'v2-addressable-led-display-output');
  assert.ok(packet.capabilityMatches.some((capability) => capability.id === 'addressable-led-display-output'));
  assert.ok(packet.candidateParts.some((part) => part.id === 'neopixel-ring-12'));
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.equal(packet.supportGaps.length, 0);
});

test('context packet includes verified support data for supported capabilities', async () => {
  const packet = await buildContextPacket({
    message: 'LED를 깜빡이는 회로를 만들고 싶어',
    locale: 'ko'
  });

  const evidence = packet.supportBundles.find((entry) => entry.capabilityId === 'digital-light-output');
  assert.ok(evidence, 'digital-light-output bundle evidence should be present');
  assert.equal(evidence.status, 'complete');
  assert.ok(evidence.sourceClaimIds.length > 0);
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'sources:support-bundle:digital-light-output'));
  assert.match(packet.promptBlock, /Verified support data/);
  assert.match(packet.promptBlock, /digital-light-output/);
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
  assert.equal(packet.intentSpec.ambiguities.some((item) => /planned|not fully supported/i.test(item)), false);
  assert.ok(packet.capabilityMatches.some((capability) => capability.id === 'light-sensor-triggered-output'));
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.ok(packet.candidateParts.some((part) => part.id === 'photoresistor-ldr'));
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
  assert.equal(packet.contextRoute.routeId, 'v2-digital-light-output');
  assert.ok(packet.retrievalPlan.sourceIds.includes('bundle:digital-light-output'));
  assert.ok(packet.intentHints.outputModalities.includes('light'));
  assert.ok(packet.candidateParts.some((part) => part.id === 'led-5mm'));
  assert.ok(packet.candidateParts.some((part) => part.id === 'resistor-220'));
  assert.ok(packet.contextTrace.some((entry) => entry.sourceId === 'conversation:current-artifact'));
  assert.match(packet.promptBlock, /Digital Light Output/);
  assert.match(packet.promptBlock, /Current artifact context/i);
});

test('context packet resolves referential confirmations from structured supported alternatives', async () => {
  const packet = await buildContextPacket({
    message: '그래 너가 제안해준대로 진행해보자',
    locale: 'ko',
    conversationContext: {
      recentTurns: [
        { role: 'student', text: '온도랑 습도를 기반으로 값이 변하는 걸로 해보자' },
        { role: 'assistant', text: '온도와 습도를 입력으로 쓰는 방향은 이해했어요. 어떤 값이 변하면 좋을까요?' },
        { role: 'student', text: 'led의 밝기로 해보자' },
        {
          role: 'assistant',
          text: '현재는 PWM 밝기 조절 회로로 바로 진행할 수 없습니다. 구조화된 지원 대안을 선택할 수 있어요.'
        }
      ],
      lastSupportedGoal: 'Arduino Uno + 5mm LED + 220Ω 저항 기반의 디지털 LED 깜박임 또는 ON/OFF 회로',
      pendingSupportedAlternative: {
        id: 'safe-low-voltage-led',
        goal: 'Arduino Uno + 5mm LED + 220Ω 저항 기반의 디지털 LED 깜박임 또는 ON/OFF 회로',
        label: '안전한 Arduino LED 회로',
        source: 'context-support-gap',
        partIds: ['arduino-uno', 'breadboard-half', 'led-5mm', 'resistor-220', 'jumper-wire'],
        capabilityIds: ['digital-light-output']
      },
      awaitingBuildConfirmation: false
    }
  });

  assert.ok(packet.capabilityMatches.some((capability) => capability.id === 'digital-light-output'));
  assert.equal(packet.capabilityMatches.some((capability) => capability.id === 'analog-led-dimmer'), false);
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.ok(packet.contextCoverage.sufficientFor.includes('valid_circuit_synthesis'));
});

test('context packet drops cancelled unsupported goals when the student switches to a supported circuit', async () => {
  const packet = await buildContextPacket({
    message: '조도 센서 회로는 취소하고, 버튼을 누르면 LED가 켜지는 회로로 새로 진행',
    locale: 'ko',
    conversationContext: {
      recentTurns: [
        { role: 'student', text: '조도 센서로 어두우면 LED 켜기 좋다 이거 작업 진행해보자' },
        {
          role: 'assistant',
          text: '조도 센서 회로는 아직 검증 자료가 부족합니다. 대신 Arduino UNO에서 LED를 깜빡이는 회로로 진행할까요?'
        }
      ],
      lastSupportedGoal: '조도 센서로 어두우면 LED 켜기',
      awaitingBuildConfirmation: false,
      currentArtifact: {
        source: 'draft',
        title: '지원하지 않는 안전 위험 요청',
        circuitSpec: {
          id: 'unsupported-safety-request',
          title: '지원하지 않는 안전 위험 요청',
          intent: {
            primaryGoal: '조도 센서로 어두우면 LED 켜기',
            output: 'unsupported',
            controller: 'none',
            behavior: 'unsafe-or-unsupported'
          },
          components: [{
            id: 'arduino-uno',
            partId: 'arduino-uno',
            label: 'Arduino Uno',
            designator: 'U1'
          }],
          connections: [],
          behavior: { runText: 'UNSUPPORTED' },
          assumptions: [],
          unsupportedItems: ['light-sensor-triggered-output'],
          clarificationNeeds: []
        }
      }
    }
  });

  assert.ok(packet.capabilityMatches.some((capability) => capability.id === 'button-controlled-light-output'));
  assert.equal(packet.capabilityMatches.some((capability) => capability.id === 'light-sensor-triggered-output'), false);
  assert.equal(packet.supportGaps.length, 0);
  assert.equal(packet.contextCoverage.synthesisEligibility.status, 'eligible');
  assert.ok(packet.contextCoverage.sufficientFor.includes('valid_circuit_synthesis'));
});

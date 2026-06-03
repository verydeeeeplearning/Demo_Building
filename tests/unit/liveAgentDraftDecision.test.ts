import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LiveAgentDraftSchema } from '../../server/agent/deepAgentRuntime.ts';

// PLAN_react_routing_and_clean_chat Phase 1 — the draft schema must let the agent return a
// conversational decision (responseKind:'chat', circuitSpec:null) OR a circuit, while staying
// backward-compatible (responseKind defaults to 'circuit').

void test('a chat decision with a null circuitSpec parses', () => {
  const draft = LiveAgentDraftSchema.parse({
    responseKind: 'chat',
    assistantMessage: '안녕! 어떤 회로를 만들어볼까요?',
    circuitSpec: null
  });
  assert.equal(draft.responseKind, 'chat');
  assert.equal(draft.circuitSpec, null);
});

void test('a draft that omits responseKind and circuitSpec defaults to circuit/null', () => {
  const draft = LiveAgentDraftSchema.parse({ assistantMessage: '회로를 만들었어요.' });
  assert.equal(draft.responseKind, 'circuit', 'responseKind defaults to circuit');
  assert.equal(draft.circuitSpec, null, 'circuitSpec defaults to null');
});

void test('a circuit decision keeps its circuitSpec', () => {
  const draft = LiveAgentDraftSchema.parse({
    responseKind: 'circuit',
    assistantMessage: '회로를 만들었어요.',
    circuitSpec: {
      id: 'led-blink',
      title: 'LED blink',
      intent: { primaryGoal: 'blink an LED', output: 'led', controller: 'arduino-uno' },
      components: [{ id: 'u1', partId: 'arduino-uno', label: 'Arduino Uno' }],
      connections: [],
      behavior: { runText: 'BLINK' },
      assumptions: [],
      unsupportedItems: [],
      clarificationNeeds: []
    }
  });
  assert.equal(draft.responseKind, 'circuit');
  assert.equal(draft.circuitSpec?.id, 'led-blink');
});

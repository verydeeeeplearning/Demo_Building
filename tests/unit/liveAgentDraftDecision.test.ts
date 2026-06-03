import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LiveAgentDraftSchema, parseLiveAgentDraft } from '../../server/agent/deepAgentRuntime.ts';

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

void test('parseLiveAgentDraft treats a circuit draft missing its spec as a recoverable miss', () => {
  // responseKind is authoritative: circuit => spec required. A circuit claim with no spec must NOT
  // silently degrade to chat — it raises a recoverable structured-output error (-> repair/fallback).
  assert.throws(
    () => parseLiveAgentDraft({ structuredResponse: { responseKind: 'circuit', assistantMessage: '만들었어요', circuitSpec: null } }),
    /missing its circuitSpec|structured/i
  );
});

void test('parseLiveAgentDraft accepts an explicit chat draft with no spec', () => {
  const draft = parseLiveAgentDraft({ structuredResponse: { responseKind: 'chat', assistantMessage: '안녕하세요!', circuitSpec: null } });
  assert.equal(draft.responseKind, 'chat');
  assert.equal(draft.circuitSpec, null);
});

void test('parseLiveAgentDraft recovers a plain-text reply (no structured circuit) as a chat draft', () => {
  // Live root cause: for a non-circuit turn the model often answers in plain natural language WITHOUT
  // calling the structured tool. With no circuitSpec to recover, the old code threw
  // AGENT_STRUCTURED_OUTPUT_MISSING (-> the rule error on a greeting in legacy mode). Now the plain
  // reply is recovered as a chat draft.
  const output = {
    messages: [
      { kwargs: { content: '안녕하세요! 어떤 회로를 만들어볼까요?', tool_calls: [] } }
    ]
  };
  const draft = parseLiveAgentDraft(output);
  assert.equal(draft.responseKind, 'chat');
  assert.equal(draft.circuitSpec, null);
  assert.match(draft.assistantMessage, /어떤 회로/);
});

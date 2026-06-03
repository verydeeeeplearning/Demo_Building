import assert from 'node:assert/strict';
import test from 'node:test';

import { canShowAgentSceneFromResult, isChatResult } from '../../src/agentSceneVisibility.js';
import { groundAgentResultArtifacts } from '../../src/agentArtifactGrounding.js';

// US-4 — a chat reply (responseKind === 'chat') must never reveal the 3D scene, and result grounding
// must not throw on it.

const chatResult = {
  responseKind: 'chat',
  assistantMessages: ['안녕! 오늘 어떤 회로 만들어볼까?'],
  circuitSpec: { id: 'casual-chat', components: [{ id: 'chat-context', partId: 'arduino-uno', label: 'Arduino Uno' }], connections: [] },
  renderPlan: { parts: [] },
  simulationPlan: { currentPaths: [] }
};

const circuitResult = {
  responseKind: 'circuit',
  renderPlan: { parts: [{ id: 'u1', type: 'arduino-uno', label: 'Arduino Uno' }] },
  simulationPlan: { currentPaths: [] }
};

test('isChatResult only flags chat responses', () => {
  assert.equal(isChatResult(chatResult), true);
  assert.equal(isChatResult(circuitResult), false);
  assert.equal(isChatResult(undefined), false);
});

test('canShowAgentScene hides the scene for a chat reply', () => {
  assert.equal(canShowAgentSceneFromResult(chatResult, false), false);
});

test('a chat reply hides the scene even when a solver gate would otherwise show one', () => {
  assert.equal(canShowAgentSceneFromResult(chatResult, true), false, 'chat wins over solver-gate visibility');
});

test('canShowAgentScene shows the scene for a parts-bearing circuit result', () => {
  assert.equal(canShowAgentSceneFromResult(circuitResult, false), true);
});

test('a circuit result with no parts but a visible solver gate still shows the scene', () => {
  const noPartsCircuit = { responseKind: 'circuit', renderPlan: { parts: [] } };
  assert.equal(canShowAgentSceneFromResult(noPartsCircuit, true), true);
  assert.equal(canShowAgentSceneFromResult(noPartsCircuit, false), false);
});

test('grounding a chat result returns it unchanged without throwing', () => {
  const out = groundAgentResultArtifacts(chatResult);
  assert.equal(out, chatResult, 'no current paths -> grounding is a no-op');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyAgentRequestKind,
  createClientId,
  isStaleAgentTurnResult,
  isValidClientId,
  normalizeClientId
} from '../../src/agentTurnEnvelope.js';

test('client ids are safe for request envelopes', () => {
  const id = createClientId('task');

  assert.equal(isValidClientId(id), true);
  assert.equal(isValidClientId('task-abc:def'), false);
  assert.equal(normalizeClientId('bad:id', 'turn').startsWith('turn-'), true);
});

test('pending initial synthesis turn can be superseded as a new task', () => {
  assert.equal(
    classifyAgentRequestKind('synthesize-or-clarify', {
      hasCurrentArtifact: false,
      hasPendingSynthesisTurn: true
    }),
    'new_task'
  );
});

test('request kind prioritizes resume and revision before general chat', () => {
  assert.equal(classifyAgentRequestKind('general-chat'), 'general_chat');
  assert.equal(classifyAgentRequestKind('revise-current-draft'), 'revise_current_artifact');
  assert.equal(classifyAgentRequestKind('synthesize-or-clarify', { resume: 'light' }), 'resume_clarification');
});

test('stale-result guard checks pending turn, envelope, and echoed response ids', () => {
  const pending = { taskId: 'task-a', turnId: 'turn-a' };
  const envelope = { taskId: 'task-a', turnId: 'turn-a' };

  assert.equal(isStaleAgentTurnResult(pending, envelope, { taskId: 'task-a', turnId: 'turn-a' }), false);
  assert.equal(isStaleAgentTurnResult(pending, envelope, { taskId: 'task-b', turnId: 'turn-a' }), true);
  assert.equal(isStaleAgentTurnResult({ ...pending, turnId: 'turn-old' }, envelope, {}), true);
});

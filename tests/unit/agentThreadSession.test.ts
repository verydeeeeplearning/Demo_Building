import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  __resetAgentThreadSessionForTests,
  AgentThreadBusyError,
  StaleAgentResumeError,
  beginAgentThreadTurn,
  registerPendingAgentInteraction,
  resolveAgentThreadId,
  validateAndConsumePendingAgentInteraction
} from '../../server/agent/agentThreadSession.ts';

test('resolveAgentThreadId encodes unsafe ids and keeps task separation', () => {
  const one = resolveAgentThreadId({ sessionId: 'session-a:b', taskId: 'task-one' });
  const two = resolveAgentThreadId({ sessionId: 'session-a', taskId: 'b:task-one' });

  assert.notEqual(one, two);
  assert.match(one, /^session\.[A-Za-z0-9_-]+\.task\.[A-Za-z0-9_-]+$/);
});

test('same thread is busy until released', () => {
  __resetAgentThreadSessionForTests();
  const first = beginAgentThreadTurn({
    sessionId: 'session-a',
    taskId: 'task-a',
    turnId: 'turn-a',
    threadId: 'thread-a',
    requestKind: 'initial_task'
  });

  assert.throws(() => beginAgentThreadTurn({
    sessionId: 'session-a',
    taskId: 'task-a',
    turnId: 'turn-b',
    threadId: 'thread-a',
    requestKind: 'revise_current_artifact'
  }), AgentThreadBusyError);

  first.release();
  assert.doesNotThrow(() => beginAgentThreadTurn({
    sessionId: 'session-a',
    taskId: 'task-a',
    turnId: 'turn-c',
    threadId: 'thread-a',
    requestKind: 'revise_current_artifact'
  }).release());
});

test('pending interaction is validated and consumed once', () => {
  __resetAgentThreadSessionForTests();
  const pending = registerPendingAgentInteraction({
    sessionId: 'session-a',
    taskId: 'task-a',
    threadId: 'thread-a',
    level: 'output',
    optionIds: ['light']
  });

  assert.equal(validateAndConsumePendingAgentInteraction({
    sessionId: 'session-a',
    taskId: 'task-a',
    threadId: 'thread-a',
    resumeInteractionId: pending.interactionId,
    resumeValue: 'light'
  }).interactionId, pending.interactionId);

  assert.throws(() => validateAndConsumePendingAgentInteraction({
    sessionId: 'session-a',
    taskId: 'task-a',
    threadId: 'thread-a',
    resumeInteractionId: pending.interactionId,
    resumeValue: 'light'
  }), StaleAgentResumeError);
});

test('expired pending interaction fails closed', () => {
  __resetAgentThreadSessionForTests();
  const pending = registerPendingAgentInteraction({
    sessionId: 'session-a',
    taskId: 'task-a',
    threadId: 'thread-a',
    level: 'output',
    optionIds: ['light'],
    nowMs: 1000
  });

  assert.throws(() => validateAndConsumePendingAgentInteraction({
    sessionId: 'session-a',
    taskId: 'task-a',
    threadId: 'thread-a',
    resumeInteractionId: pending.interactionId,
    resumeValue: 'light',
    nowMs: 1000 + 16 * 60 * 1000
  }), StaleAgentResumeError);
});

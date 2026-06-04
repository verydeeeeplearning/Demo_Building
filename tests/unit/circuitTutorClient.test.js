import assert from 'node:assert/strict';
import test from 'node:test';

import { askCircuitTutor } from '../../src/circuitTutorClient.js';

function sampleCircuit() {
  return {
    title: 'OLED demo',
    circuitSpec: {
      id: 'demo',
      title: 'Demo',
      components: [],
      connections: [],
      behavior: { runText: 'HELLO' }
    },
    validationReport: { status: 'valid', errors: [], warnings: [], validatedCurrentPathIds: [] },
    simulationPlan: { status: 'valid', runText: 'HELLO', currentPaths: [], expectedStates: [], warnings: [] },
    contextCoverage: { synthesisEligibility: { status: 'eligible', reason: 'test' } },
    buildRunnableReport: { runnable: true },
    solverGateResult: { status: 'pass' },
    contextTrace: []
  };
}

function sampleTarget() {
  return {
    id: 'connection:x',
    type: 'connection',
    label: 'X',
    title: 'X connection',
    summary: 'wire',
    why: 'test',
    missing: 'missing wire',
    questions: ['What happens without it?']
  };
}

async function askWithMockedTutorServer(serverReply, options = {}) {
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  let requestBody = null;
  globalThis.localStorage = { getItem: () => 'enabled' };

  try {
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(init.body);
      if (options.throwFetch) {
        throw new Error(options.throwFetch);
      }
      return {
        ok: true,
        json: async () => serverReply,
        headers: new Headers(),
        status: 200
      };
    };
    const response = await askCircuitTutor({
      circuit: sampleCircuit(),
      target: sampleTarget(),
      question: 'How does this work?',
      locale: 'en',
      running: false
    });
    return { response, requestBody };
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.localStorage = previousStorage;
  }
}

test('valid tutor server response preserves live mode, suggestions, and grounding artifacts', async () => {
  const { response, requestBody } = await askWithMockedTutorServer({
    sessionId: 'tutor-live-test',
    mode: 'live',
    servingStatus: 'live_tutor_answer',
    message: 'Live answer for the selected connection.',
    grounding: ['connection:x'],
    suggestedQuestions: ['Why does this need 5V?']
  });

  assert.equal(response.mode, 'live');
  assert.equal(response.servingStatus, 'live_tutor_answer');
  assert.deepEqual(response.suggestedQuestions, ['Why does this need 5V?']);
  assert.deepEqual(response.grounding, ['connection:x']);
  assert.ok(requestBody.artifacts.contextCoverage);
  assert.ok(requestBody.artifacts.buildRunnableReport);
  assert.ok(requestBody.artifacts.solverGateResult);
});

test('malformed tutor server response falls back with explicit mode', async () => {
  const { response } = await askWithMockedTutorServer({ mode: 'live', message: '' });

  assert.equal(response.mode, 'local');
  assert.equal(response.servingStatus, 'live_tutor_fallback');
  assert.match(response.fallbackReason, /malformed|schema/i);
});

test('invalid tutor serving status falls back before rendering', async () => {
  const { response } = await askWithMockedTutorServer({
    sessionId: 'tutor-live-test',
    mode: 'live',
    servingStatus: 'buildable_original',
    message: 'This status belongs to main synthesis.',
    grounding: [],
    suggestedQuestions: []
  });

  assert.equal(response.mode, 'local');
  assert.equal(response.servingStatus, 'live_tutor_fallback');
  assert.match(response.fallbackReason, /serving status/i);
});

test('non-string tutor suggestions fall back before rendering', async () => {
  const { response } = await askWithMockedTutorServer({
    sessionId: 'tutor-live-test',
    mode: 'live',
    servingStatus: 'live_tutor_answer',
    message: 'Live answer.',
    grounding: [],
    suggestedQuestions: ['ok', 42]
  });

  assert.equal(response.mode, 'local');
  assert.equal(response.servingStatus, 'live_tutor_fallback');
  assert.match(response.fallbackReason, /suggested questions/i);
});

test('tutor fallback reason redacts secrets and config names', async () => {
  const { response } = await askWithMockedTutorServer({}, {
    throwFetch: 'OPENAI_API_KEY sk-test-secret H_EDUWARE_AGENT_MODEL raw model detail'
  });

  assert.equal(response.mode, 'local');
  assert.equal(response.servingStatus, 'live_tutor_fallback');
  assert.doesNotMatch(response.fallbackReason, /sk-test-secret|OPENAI_API_KEY|H_EDUWARE_AGENT_MODEL/);
  assert.match(response.fallbackReason, /\[redacted/);
});

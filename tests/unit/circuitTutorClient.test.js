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
  const previousLocation = globalThis.location;
  let requestBody = null;
  let requestUrl = null;
  globalThis.localStorage = {
    getItem: (key) => options.storage?.[key] ?? null
  };
  if (options.locationOrigin) {
    globalThis.location = { origin: options.locationOrigin };
  }

  try {
    globalThis.fetch = async (url, init) => {
      requestUrl = String(url);
      requestBody = JSON.parse(init.body);
      if (options.throwFetch) {
        throw new Error(options.throwFetch);
      }
      if (options.ok === false) {
        return {
          ok: false,
          json: async () => options.errorPayload ?? {},
          headers: new Headers(),
          status: options.status ?? 503
        };
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
    return { response, requestBody, requestUrl };
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.localStorage = previousStorage;
    globalThis.location = previousLocation;
  }
}

test('valid tutor server response is used by default without browser opt-in', async () => {
  const { response, requestBody, requestUrl } = await askWithMockedTutorServer({
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
  assert.equal(requestUrl, 'http://127.0.0.1:8787/api/agent/explain-target');
});

test('tutor requests use the configured agent API base', async () => {
  const { response, requestUrl } = await askWithMockedTutorServer({
    sessionId: 'tutor-live-test',
    mode: 'live',
    servingStatus: 'live_tutor_answer',
    message: 'Live answer through configured Railway-style base.',
    grounding: ['connection:x'],
    suggestedQuestions: []
  }, {
    storage: {
      hEduwareAgentApiBase: 'https://agent.example.test'
    }
  });

  assert.equal(response.servingStatus, 'live_tutor_answer');
  assert.equal(requestUrl, 'https://agent.example.test/api/agent/explain-target');
});

test('changing configured agent API base bypasses cached tutor server failures', async () => {
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  const previousLocation = globalThis.location;
  const requestUrls = [];
  let configuredBase = 'http://agent-a.example.test';

  globalThis.localStorage = {
    getItem(key) {
      return key === 'hEduwareAgentApiBase' ? configuredBase : null;
    }
  };
  globalThis.location = { origin: 'http://cache-key-test.local' };

  try {
    globalThis.fetch = async (url, init) => {
      requestUrls.push(String(url));
      JSON.parse(init.body);
      if (String(url).startsWith('http://agent-a.example.test')) {
        throw new TypeError('Failed to fetch');
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          sessionId: 'tutor-live-cache-bypass',
          mode: 'live',
          servingStatus: 'live_tutor_answer',
          message: 'Live answer after switching configured base.',
          grounding: ['connection:x'],
          suggestedQuestions: []
        })
      };
    };

    const first = await askCircuitTutor({
      circuit: sampleCircuit(),
      target: sampleTarget(),
      question: 'How does this work?',
      locale: 'en',
      running: false
    });
    configuredBase = 'http://agent-b.example.test';
    const second = await askCircuitTutor({
      circuit: sampleCircuit(),
      target: sampleTarget(),
      question: 'How does this work?',
      locale: 'en',
      running: false
    });

    assert.equal(first.servingStatus, 'live_tutor_fallback');
    assert.equal(second.servingStatus, 'live_tutor_answer');
    assert.deepEqual(requestUrls, [
      'http://agent-a.example.test/api/agent/explain-target',
      'http://agent-b.example.test/api/agent/explain-target'
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.localStorage = previousStorage;
    globalThis.location = previousLocation;
  }
});

test('explicit tutor server disabled override forces local response', async () => {
  let fetchCalled = false;
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => key === 'hEduwareTutorServer' ? 'disabled' : null
  };

  try {
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error('fetch should not be called');
    };
    const response = await askCircuitTutor({
      circuit: sampleCircuit(),
      target: sampleTarget(),
      question: 'How does this work?',
      locale: 'en',
      running: false
    });

    assert.equal(fetchCalled, false);
    assert.equal(response.mode, 'local');
    assert.equal(response.servingStatus, 'local_tutor_answer');
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.localStorage = previousStorage;
  }
});

test('malformed tutor server response falls back with explicit mode', async () => {
  const { response } = await askWithMockedTutorServer({ mode: 'live', message: '' });

  assert.equal(response.mode, 'local');
  assert.equal(response.servingStatus, 'live_tutor_fallback');
  assert.equal(response.fallbackCategory, 'schema');
  assert.match(response.fallbackReason, /malformed|schema/i);
});

test('failed tutor server HTTP responses report an HTTP fallback category', async () => {
  const { response } = await askWithMockedTutorServer({}, {
    ok: false,
    status: 503,
    locationOrigin: 'http://http-fallback.test'
  });

  assert.equal(response.mode, 'local');
  assert.equal(response.servingStatus, 'live_tutor_fallback');
  assert.equal(response.fallbackCategory, 'http');
  assert.match(response.fallbackReason, /503/);
});

test('tutor transport failures report a transport fallback category', async () => {
  const { response } = await askWithMockedTutorServer({}, {
    throwFetch: 'Failed to fetch',
    locationOrigin: 'http://transport-fallback.test'
  });

  assert.equal(response.mode, 'local');
  assert.equal(response.servingStatus, 'live_tutor_fallback');
  assert.equal(response.fallbackCategory, 'transport');
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

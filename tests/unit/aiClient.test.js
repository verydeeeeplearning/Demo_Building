import assert from 'node:assert/strict';
import test from 'node:test';

import { getAiRuntimeMode, sendAgentMessage } from '../../src/aiClient.js';

test('sendAgentMessage forwards bounded conversation context to the agent API', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (String(url).endsWith('/api/agent/health')) {
      return jsonResponse({ ok: true, defaultMode: 'deepagents-live', hasServerKey: true });
    }
    return jsonResponse({ sessionId: 'session-test' });
  };

  try {
    await sendAgentMessage({
      sessionId: 'session-test',
      message: '좋아 구현 부탁해',
      locale: 'ko',
      conversationContext: {
        recentTurns: [{ role: 'student', text: 'LED 깜빡이기' }],
        currentArtifact: { source: 'draft', title: 'LED blinker' },
        lastSupportedGoal: 'blink an LED',
        awaitingBuildConfirmation: true
      }
    });

    const messageRequest = requests.find((request) => String(request.url).endsWith('/api/agent/message'));
    const body = JSON.parse(messageRequest.options.body);

    assert.equal(body.conversationContext.currentArtifact.title, 'LED blinker');
    assert.equal(body.conversationContext.awaitingBuildConfirmation, true);
    assert.equal(body.conversationContext.recentTurns.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getAiRuntimeMode forwards source freshness metadata for stale server warnings', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => jsonResponse({
    ok: true,
    defaultMode: 'deepagents-live',
    hasServerKey: true,
    model: 'gpt-5.4-mini',
    provider: 'openai',
    serverStartedAt: '2026-05-31T12:00:00.000Z',
    serverUptimeMs: 120000,
    sourceStatus: {
      stale: true,
      checkedAt: '2026-05-31T12:05:00.000Z',
      newestSourceModifiedAt: '2026-05-31T12:04:00.000Z',
      staleSourceFiles: [{ id: 'agent:circuit-tools', modifiedAt: '2026-05-31T12:04:00.000Z' }],
      errors: []
    }
  });

  try {
    const mode = await getAiRuntimeMode();

    assert.equal(mode.mode, 'deepagents-live');
    assert.equal(mode.model, 'gpt-5.4-mini');
    assert.equal(mode.serverStartedAt, '2026-05-31T12:00:00.000Z');
    assert.equal(mode.serverUptimeMs, 120000);
    assert.equal(mode.sourceStatus.stale, true);
    assert.equal(mode.sourceStatus.staleSourceFiles[0].id, 'agent:circuit-tools');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    }
  };
}

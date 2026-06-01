import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ShareClientError,
  createPublicShare,
  readPublicShare
} from '../../src/shareClient.js';

test('createPublicShare posts snapshots to the configured agent API base', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  const requests = [];

  globalThis.localStorage = {
    getItem(key) {
      return key === 'hEduwareAgentApiBase' ? 'http://agent.local:8787' : null;
    }
  };
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return jsonResponse({
      shareId: 'a'.repeat(32),
      shareUrl: 'http://127.0.0.1:4173/?share=' + 'a'.repeat(32),
      createdAt: '2026-06-01T00:00:00.000Z'
    });
  };

  try {
    const result = await createPublicShare({ schemaVersion: 1, title: 'Shared circuit' });

    assert.equal(result.shareId, 'a'.repeat(32));
    assert.equal(requests[0].url, 'http://agent.local:8787/api/share/projects');
    assert.equal(requests[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      snapshot: { schemaVersion: 1, title: 'Shared circuit' }
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalLocalStorage;
  }
});

test('readPublicShare fetches public snapshots and unwraps the response', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    assert.equal(url, 'http://127.0.0.1:8787/api/share/projects/' + 'b'.repeat(32));
    return jsonResponse({
      snapshot: {
        schemaVersion: 1,
        id: 'b'.repeat(32),
        title: 'Shared OLED'
      }
    });
  };

  try {
    const snapshot = await readPublicShare('b'.repeat(32));

    assert.equal(snapshot.id, 'b'.repeat(32));
    assert.equal(snapshot.title, 'Shared OLED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('share client throws safe typed errors for failed API requests', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    async json() {
      return { error: 'Invalid share id.', retryable: false };
    }
  });

  try {
    await assert.rejects(
      () => readPublicShare('../secret'),
      (error) => {
        assert.equal(error instanceof ShareClientError, true);
        assert.equal(error.status, 400);
        assert.match(error.message, /Invalid share id/);
        return true;
      }
    );
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

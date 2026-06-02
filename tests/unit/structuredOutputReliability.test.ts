import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AgentStructuredOutputError,
  runAgentWithScriptedDrafts
} from '../../server/agent/deepAgentRuntime.ts';
import type { AgentMessageRequest } from '../../server/agent/schemas.ts';

// Phase 4 — structured-output reliability (the :901 502 fix). When the agent never emits a
// structured draft, the repair loop must retry and then fall back deterministically — NEVER a 502 —
// when the fallback is enabled (shadow|next). legacy leaves the throw unguarded.

const REQUEST = { message: 'LED를 저항이랑 같이 깜빡이게 해줘', locale: 'ko' } as AgentMessageRequest;

void test('a structured-output throw is retried then falls back deterministically (never a 502)', async () => {
  let calls = 0;
  const result = await runAgentWithScriptedDrafts({
    request: REQUEST,
    drafts: [],
    structuredOutputFallback: true,
    draftProvider: async () => {
      calls += 1;
      throw new AgentStructuredOutputError();
    }
  });

  assert.equal(calls, 2, 'the provider is retried up to maxAttempts before falling back');
  assert.ok(result.assistantMessages.length > 0, 'a deterministic fallback response is returned');
  assert.ok(
    result.agentEvents.some((event) => event.name === 'structured-output-fallback'),
    'the fallback is recorded as an agent event'
  );
});

void test('without the fallback flag the structured-output throw propagates (legacy unchanged)', async () => {
  await assert.rejects(
    () =>
      runAgentWithScriptedDrafts({
        request: REQUEST,
        drafts: [],
        draftProvider: async () => {
          throw new AgentStructuredOutputError();
        }
      }),
    AgentStructuredOutputError
  );
});

void test('a non-structured error always propagates (not masked by the fallback)', async () => {
  await assert.rejects(
    () =>
      runAgentWithScriptedDrafts({
        request: REQUEST,
        drafts: [],
        structuredOutputFallback: true,
        draftProvider: async () => {
          throw new Error('network down');
        }
      }),
    /network down/
  );
});

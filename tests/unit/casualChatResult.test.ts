import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildCasualChatResult } from '../../server/agent/deepAgentRuntime.ts';
import { buildContextPacket } from '../../server/context/contextPacket.ts';
import { AgentRunResultSchema, type AgentMessageRequest } from '../../server/agent/schemas.ts';

// US-2 — a conversational reply becomes a valid AgentRunResult that carries no renderable circuit.

void test('buildCasualChatResult produces a schema-valid chat result with no rendered circuit', async () => {
  const request = { message: '안뇽', locale: 'ko' } as AgentMessageRequest;
  const contextPacket = await buildContextPacket(request);
  const reply = '안녕! 오늘 어떤 회로 만들어볼까?';

  const result = buildCasualChatResult({
    sessionId: 'session-test',
    request,
    contextPacket,
    reply
  });

  // Parses against the real schema (defends the placeholder spec + empty plans).
  const parsed = AgentRunResultSchema.parse(result);

  assert.equal(parsed.responseKind, 'chat');
  assert.deepEqual(parsed.assistantMessages, [reply], 'chat reply is surfaced verbatim');
  assert.equal(parsed.renderPlan.parts.length, 0, 'no parts -> frontend renders no scene');
  assert.equal(parsed.simulationPlan.currentPaths.length, 0);
  assert.equal(parsed.buildRunnableReport.runnable, false, 'chat results are never buildable');
  assert.equal(parsed.clarification, null);
  // Coverage/trace are reused from the context packet, not fabricated.
  assert.deepEqual(parsed.contextCoverage, contextPacket.contextCoverage);
  assert.ok(parsed.contextTrace.length >= 1);
});

void test('an English chat result keeps the verbatim reply and chat response kind', async () => {
  const request = { message: 'hi there', locale: 'en' } as AgentMessageRequest;
  const contextPacket = await buildContextPacket(request);
  const reply = 'Hey! What circuit do you want to build today?';

  const result = buildCasualChatResult({ sessionId: 's', request, contextPacket, reply });

  assert.equal(result.responseKind, 'chat');
  assert.equal(result.assistantMessages[0], reply);
  assert.equal(result.renderPlan.parts.length, 0);
});

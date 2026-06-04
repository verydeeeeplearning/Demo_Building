import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MessagesAnnotation, MemorySaver, StateGraph, START, END } from '@langchain/langgraph';

import { runAgent } from '../../server/agent/deepAgentRuntime.ts';
import { RecordedCassetteModel } from '../../server/agent/modelCassette.ts';
import { resolveAgentThreadId } from '../../server/agent/agentThreadSession.ts';
import type { DeepAgentFactory, ModelPort } from '../../server/agent/agentRuntimePorts.ts';
import type { AgentMessageRequest } from '../../server/agent/schemas.ts';

// Phase 1 — framework-native short-term memory via a LangGraph checkpointer.
// Docs: langgraph "Add Short-Term Memory with MemorySaver".

// RISK #1 (the assumption the whole plan rests on): a SHARED MemorySaver makes a thread accumulate
// across SEPARATELY-compiled graph instances invoked with the same thread_id — so re-constructing the
// agent per HTTP request still recalls prior turns. Proven here at the framework level (no model).
void test('a shared checkpointer recalls prior turns across fresh graph instances (same thread_id)', async () => {
  const saver = new MemorySaver();
  const buildGraph = () =>
    new StateGraph(MessagesAnnotation)
      .addNode('echo', () => ({ messages: [{ role: 'assistant', content: 'noted' }] }))
      .addEdge(START, 'echo')
      .addEdge('echo', END)
      .compile({ checkpointer: saver });

  const config = { configurable: { thread_id: 'thread-A' } };

  // First request: a fresh graph instance writes turn 1 to the thread.
  await buildGraph().invoke({ messages: [{ role: 'user', content: 'remember apples' }] }, config);

  // Second request: a BRAND-NEW compiled graph, same saver + thread_id.
  const result = await buildGraph().invoke({ messages: [{ role: 'user', content: 'and bananas' }] }, config);

  const texts = result.messages.map((message) => String(message.content));
  assert.ok(texts.some((text) => text.includes('remember apples')), 'turn 1 survived into the new instance');
  assert.ok(texts.some((text) => text.includes('and bananas')), 'turn 2 is appended to the same thread');

  // A different thread_id must NOT see thread-A's history (isolation).
  const isolated = await buildGraph().invoke(
    { messages: [{ role: 'user', content: 'fresh thread' }] },
    { configurable: { thread_id: 'thread-B' } }
  );
  assert.ok(
    !isolated.messages.map((m) => String(m.content)).some((t) => t.includes('apples')),
    'threads are isolated by thread_id'
  );
});

// WIRING: the synthesis ('h-eduware-deepagent') agent is constructed WITH a checkpointer and invoked
// with a safe encoded thread_id.
void test('the synthesis agent is built with a checkpointer and invoked on encoded session thread_id', async () => {
  const modelPort: ModelPort = { createModel: () => new RecordedCassetteModel([]) };

  let synthesisHadCheckpointer = false;
  let synthesisThreadId: unknown = null;

  const deepAgentFactory = ((config: { name?: string; checkpointer?: unknown }) => {
    const isSynthesis = config.name === 'h-eduware-deepagent';
    if (isSynthesis) {
      synthesisHadCheckpointer = Boolean(config.checkpointer);
    }
    if (config.name === 'h-eduware-requirement-analysis-agent') {
      return {
        invoke: async () => ({
          structuredResponse: {
            route: 'clarify_requirements',
            confidence: 0.9,
            summary: 'needs detail',
            assistantMessage: '무엇을 표시할까요?',
            clarification: '내용을 알려주세요.'
          }
        })
      };
    }
    return {
      invoke: async (_input: unknown, invokeConfig?: { configurable?: { thread_id?: unknown } }) => {
        if (isSynthesis) {
          synthesisThreadId = invokeConfig?.configurable?.thread_id ?? null;
        }
        return { structuredResponse: { responseKind: 'chat', assistantMessage: '무엇을 표시할까요?', circuitSpec: null } };
      }
    };
  }) as unknown as DeepAgentFactory;

  const request = { message: 'LED를 저항이랑 깜빡이게 해줘', locale: 'ko', sessionId: 'session-mem-1' } as AgentMessageRequest;
  await runAgent(request, { deps: { modelPort, deepAgentFactory } });

  assert.equal(synthesisHadCheckpointer, true, 'synthesis agent constructed with a checkpointer');
  assert.equal(
    synthesisThreadId,
    resolveAgentThreadId({ sessionId: 'session-mem-1' }),
    'synthesis invoked on the encoded session thread_id'
  );
});

// An injected checkpointer (the deps seam used by tests / a future durable saver) overrides the
// shared in-process default.
void test('AgentRuntimeDeps.checkpointer overrides the default saver', async () => {
  const injected = new MemorySaver();
  const modelPort: ModelPort = { createModel: () => new RecordedCassetteModel([]) };

  let passedCheckpointer: unknown = null;
  const deepAgentFactory = ((config: { name?: string; checkpointer?: unknown }) => {
    if (config.name === 'h-eduware-deepagent') {
      passedCheckpointer = config.checkpointer ?? null;
    }
    if (config.name === 'h-eduware-requirement-analysis-agent') {
      return {
        invoke: async () => ({
          structuredResponse: {
            route: 'clarify_requirements', confidence: 0.9, summary: 's',
            assistantMessage: 'q', clarification: 'c'
          }
        })
      };
    }
    return { invoke: async () => ({ structuredResponse: { responseKind: 'chat', assistantMessage: 'q', circuitSpec: null } }) };
  }) as unknown as DeepAgentFactory;

  await runAgent(
    { message: 'LED 깜빡이게', locale: 'ko', sessionId: 's' } as AgentMessageRequest,
    { deps: { modelPort, deepAgentFactory, checkpointer: injected } }
  );

  assert.equal(passedCheckpointer, injected, 'the injected checkpointer is used for the synthesis agent');
});

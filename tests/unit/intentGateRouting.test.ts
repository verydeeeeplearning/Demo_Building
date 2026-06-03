import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runAgent } from '../../server/agent/deepAgentRuntime.ts';
import { RecordedCassetteModel } from '../../server/agent/modelCassette.ts';
import type { DeepAgentFactory, ModelPort } from '../../server/agent/agentRuntimePorts.ts';
import type { IntentGate } from '../../server/agent/intentGate.ts';
import type { AgentMessageRequest } from '../../server/agent/schemas.ts';

// US-3 — the front intent gate short-circuits runLiveAgent: a casual_chat decision returns a
// conversational result and the synthesis agent is NEVER constructed (no structured-output dead end).

void test('a casual_chat gate decision returns a chat result and skips synthesis entirely', async () => {
  let createModelCalls = 0;
  const modelPort: ModelPort = {
    createModel: () => {
      createModelCalls += 1;
      return new RecordedCassetteModel([]);
    }
  };

  const factoryNames: string[] = [];
  const deepAgentFactory = ((config: { name?: string }) => {
    factoryNames.push(config.name ?? '<unnamed>');
    return { invoke: async () => ({ structuredResponse: {} }) };
  }) as unknown as DeepAgentFactory;

  const casualGate: IntentGate = async () => ({
    kind: 'casual_chat',
    reply: '안녕! 오늘 어떤 회로 만들어볼까?',
    reason: 'greeting'
  });

  const request = { message: '안뇽', locale: 'ko' } as AgentMessageRequest;
  const result = await runAgent(request, { deps: { modelPort, deepAgentFactory, intentGate: casualGate } });

  assert.equal(result.responseKind, 'chat', 'casual chat short-circuits to a chat result');
  assert.equal(result.assistantMessages[0], '안녕! 오늘 어떤 회로 만들어볼까?');
  assert.equal(result.renderPlan.parts.length, 0, 'no circuit scene for a chat reply');
  assert.equal(result.buildRunnableReport.runnable, false);
  assert.equal(createModelCalls, 1, 'model still created exactly once');
  assert.equal(factoryNames.length, 0, 'no deep agent (requirement/synthesis) is ever constructed');
});

void test('a circuit_request gate decision falls through to the normal synthesis pipeline', async () => {
  const modelPort: ModelPort = { createModel: () => new RecordedCassetteModel([]) };

  const factoryNames: string[] = [];
  const deepAgentFactory = ((config: { name?: string }) => {
    factoryNames.push(config.name ?? '<unnamed>');
    if (config.name === 'h-eduware-requirement-analysis-agent') {
      return {
        invoke: async () => ({
          structuredResponse: {
            route: 'clarify_requirements',
            confidence: 0.6,
            summary: 'needs detail',
            assistantMessage: '무엇을 만들까요?',
            clarification: '목표를 알려주세요.'
          }
        })
      };
    }
    return { invoke: async () => ({ structuredResponse: {} }) };
  }) as unknown as DeepAgentFactory;

  const circuitGate: IntentGate = async () => ({ kind: 'circuit_request', reply: null, reason: 'wants a build' });

  const previous = process.env.H_EDUWARE_AGENT_PIPELINE;
  process.env.H_EDUWARE_AGENT_PIPELINE = 'legacy';
  try {
    const request = { message: '뭔가 만들고 싶은데 잘 모르겠어', locale: 'ko' } as AgentMessageRequest;
    const result = await runAgent(request, { deps: { modelPort, deepAgentFactory, intentGate: circuitGate } });

    assert.equal(result.responseKind, 'circuit', 'circuit_request keeps the normal circuit result kind');
    assert.ok(
      factoryNames.includes('h-eduware-requirement-analysis-agent'),
      'the normal requirement-analysis path still runs for circuit_request'
    );
  } finally {
    process.env.H_EDUWARE_AGENT_PIPELINE = previous;
  }
});

void test('H_EDUWARE_INTENT_GATE=off skips the gate even if a casual gate is injected', async () => {
  const modelPort: ModelPort = { createModel: () => new RecordedCassetteModel([]) };
  const deepAgentFactory = ((config: { name?: string }) => {
    if (config.name === 'h-eduware-requirement-analysis-agent') {
      return {
        invoke: async () => ({
          structuredResponse: {
            route: 'clarify_requirements',
            confidence: 0.6,
            summary: 'needs detail',
            assistantMessage: '무엇을 만들까요?',
            clarification: '목표를 알려주세요.'
          }
        })
      };
    }
    return { invoke: async () => ({ structuredResponse: {} }) };
  }) as unknown as DeepAgentFactory;

  // This gate WOULD route to chat — but the kill-switch must ignore it.
  const casualGate: IntentGate = async () => ({ kind: 'casual_chat', reply: '하이', reason: 'greeting' });

  const prevGate = process.env.H_EDUWARE_INTENT_GATE;
  const prevPipeline = process.env.H_EDUWARE_AGENT_PIPELINE;
  process.env.H_EDUWARE_INTENT_GATE = 'off';
  process.env.H_EDUWARE_AGENT_PIPELINE = 'legacy';
  try {
    const request = { message: '안뇽', locale: 'ko' } as AgentMessageRequest;
    const result = await runAgent(request, { deps: { modelPort, deepAgentFactory, intentGate: casualGate } });
    assert.equal(result.responseKind, 'circuit', 'kill-switch off -> gate skipped -> normal pipeline');
  } finally {
    process.env.H_EDUWARE_INTENT_GATE = prevGate;
    process.env.H_EDUWARE_AGENT_PIPELINE = prevPipeline;
  }
});

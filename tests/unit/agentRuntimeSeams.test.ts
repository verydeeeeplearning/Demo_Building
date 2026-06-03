import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runAgent } from '../../server/agent/deepAgentRuntime.ts';
import { RecordedCassetteModel } from '../../server/agent/modelCassette.ts';
import type { DeepAgentFactory, ModelPort } from '../../server/agent/agentRuntimePorts.ts';
import type { AgentMessageRequest } from '../../server/agent/schemas.ts';

// Phase 0.5 seams 0.5.1 + 0.5.2: drive the FULL runAgent path with an injected ModelPort and an
// injected DeepAgentFactory, proving (a) zero live model/config dependency and (b) the
// createDeepAgent construction count is assertable at runtime. A `clarify_requirements` route now
// reaches the synthesis agent (Phase 3: clarify no longer short-circuits); the agent answers
// conversationally (responseKind:'chat'), so both agents are still constructed exactly once.

type StubAgent = { invoke: (input: unknown, config?: unknown) => Promise<{ structuredResponse: unknown }> };

function stubAgent(structuredResponse: unknown): StubAgent {
  return { invoke: async () => ({ structuredResponse }) };
}

void test('runAgent uses injected ModelPort + DeepAgentFactory with zero live calls (two-run construction)', async () => {
  let createModelCalls = 0;
  const modelPort: ModelPort = {
    // The model is never asked to generate (stub agents bypass it); returning an empty cassette
    // model proves no live ChatOpenAI / OPENAI_API_KEY is required.
    createModel: () => {
      createModelCalls += 1;
      return new RecordedCassetteModel([]);
    }
  };

  const factoryNames: string[] = [];
  const deepAgentFactory = ((config: { name?: string }) => {
    factoryNames.push(config.name ?? '<unnamed>');
    if (config.name === 'h-eduware-requirement-analysis-agent') {
      return stubAgent({
        route: 'clarify_requirements',
        confidence: 0.9,
        summary: 'needs more detail before synthesis',
        assistantMessage: '어떤 화면에 무엇을 표시할까요?',
        clarification: '표시할 내용을 알려주세요.'
      });
    }
    // Synthesis agent: now reached for a clarify route; it answers conversationally.
    return stubAgent({ responseKind: 'chat', assistantMessage: '어떤 화면에 무엇을 표시할까요?', circuitSpec: null });
  }) as unknown as DeepAgentFactory;

  // A small, well-routed message keeps the real prompt-budget gate satisfied; the requirement
  // route is forced to clarify by the injected stub regardless of message content.
  const request = { message: 'LED 하나를 저항이랑 같이 깜빡이게 해줘', locale: 'ko' } as AgentMessageRequest;
  // No binary pre-gate (PLAN_react_routing_and_clean_chat Phase 3): this test asserts the exact
  // requirement+synthesis construction counts directly.
  const result = await runAgent(request, {
    deps: { modelPort, deepAgentFactory }
  });

  assert.equal(createModelCalls, 1, 'ModelPort.createModel called exactly once (one shared model)');
  assert.equal(factoryNames.length, 2, 'DeepAgentFactory called exactly twice (requirement + synthesis)');
  assert.deepEqual(
    [...factoryNames].sort(),
    ['h-eduware-deepagent', 'h-eduware-requirement-analysis-agent'],
    'both the requirement-analysis and synthesis agents are constructed'
  );
  assert.ok(result.assistantMessages.length > 0, 'a finalized clarification message is returned');
});

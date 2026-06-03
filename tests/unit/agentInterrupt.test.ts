import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isCommand } from '@langchain/langgraph';

import { runAgent } from '../../server/agent/deepAgentRuntime.ts';
import { RecordedCassetteModel } from '../../server/agent/modelCassette.ts';
import type { DeepAgentFactory, ModelPort } from '../../server/agent/agentRuntimePorts.ts';
import type { AgentMessageRequest } from '../../server/agent/schemas.ts';

const modelPort: ModelPort = { createModel: () => new RecordedCassetteModel([]) };

const INTERRUPT_OUTPUT = {
  __interrupt__: [
    {
      value: {
        level: 'output',
        question: '무엇을 만들어 볼까요?',
        options: [
          { id: 'light', label: '빛 / LED' },
          { id: 'sound', label: '소리' }
        ]
      }
    }
  ]
};

function requirementStub(route: string) {
  return {
    invoke: async () => ({
      structuredResponse: { route, confidence: 0.9, summary: 's', assistantMessage: 'a', clarification: null }
    })
  };
}

// US-3: a paused agent (ask_to_narrow -> interrupt) surfaces as responseKind 'awaiting_input'.
void test('an agent interrupt becomes an awaiting_input result with the grounded clarification request', async () => {
  const deepAgentFactory = ((config: { name?: string }) => {
    if (config.name === 'h-eduware-requirement-analysis-agent') {
      return requirementStub('synthesize_circuit');
    }
    return { invoke: async () => INTERRUPT_OUTPUT };
  }) as unknown as DeepAgentFactory;

  const result = await runAgent(
    { message: '뭔가 만들어줘', locale: 'ko', sessionId: 's-int' } as AgentMessageRequest,
    { deps: { modelPort, deepAgentFactory } }
  );

  assert.equal(result.responseKind, 'awaiting_input');
  assert.ok(result.clarificationRequest, 'carries a clarification request');
  assert.equal(result.clarificationRequest?.level, 'output');
  assert.deepEqual(result.clarificationRequest?.options.map((o) => o.id), ['light', 'sound']);
  assert.equal(result.renderPlan.parts.length, 0, 'no scene for an awaiting_input turn');
  // The thread surfaces the question.
  assert.ok(result.assistantMessages[0]?.includes('무엇을'), 'question is shown to the student');
});

// US-3: a resume request resumes the paused thread via Command (not a fresh message).
void test('request.resume invokes the agent with a Command resume', async () => {
  let resumeInputSeen: unknown = null;

  const deepAgentFactory = ((config: { name?: string }) => {
    if (config.name === 'h-eduware-requirement-analysis-agent') {
      return requirementStub('synthesize_circuit');
    }
    return {
      invoke: async (input: unknown) => {
        if (isCommand(input)) {
          resumeInputSeen = input;
          // Resumed and answered conversationally (a real run would build; chat keeps the test light).
          return { structuredResponse: { responseKind: 'chat', assistantMessage: '좋아요, 만들어 볼게요.', circuitSpec: null } };
        }
        return INTERRUPT_OUTPUT;
      }
    };
  }) as unknown as DeepAgentFactory;

  const result = await runAgent(
    { message: '서보', resume: 'servo-motion-output', locale: 'ko', sessionId: 's-int' } as AgentMessageRequest,
    { deps: { modelPort, deepAgentFactory } }
  );

  assert.ok(resumeInputSeen, 'the synthesis agent was invoked with a Command');
  assert.ok(isCommand(resumeInputSeen), 'resume path uses Command(resume)');
  assert.equal(result.responseKind, 'chat', 'the resumed run produced a result (not another pause here)');
});

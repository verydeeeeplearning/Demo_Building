import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isCommand } from '@langchain/langgraph';

import { runAgent } from '../../server/agent/deepAgentRuntime.ts';
import { RecordedCassetteModel } from '../../server/agent/modelCassette.ts';
import type { DeepAgentFactory, ModelPort } from '../../server/agent/agentRuntimePorts.ts';
import type { AgentMessageRequest } from '../../server/agent/schemas.ts';
import { __resetAgentThreadSessionForTests } from '../../server/agent/agentThreadSession.ts';

const modelPort: ModelPort = { createModel: () => new RecordedCassetteModel([]) };

const INTERRUPT_OUTPUT = {
  __interrupt__: [
    {
      value: {
        level: 'output',
        question: 'Choose an output.',
        options: [
          { id: 'light', label: 'Light / LED' },
          { id: 'sound', label: 'Sound' }
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

test('an agent interrupt becomes an awaiting_input result with a guarded clarification request', async () => {
  __resetAgentThreadSessionForTests();
  const deepAgentFactory = ((config: { name?: string }) => {
    if (config.name === 'h-eduware-requirement-analysis-agent') {
      return requirementStub('synthesize_circuit');
    }
    return { invoke: async () => INTERRUPT_OUTPUT };
  }) as unknown as DeepAgentFactory;

  const result = await runAgent(
    { message: 'make something', locale: 'ko', sessionId: 's-int', taskId: 'task-12345678' } as AgentMessageRequest,
    { deps: { modelPort, deepAgentFactory } }
  );

  assert.equal(result.responseKind, 'awaiting_input');
  assert.ok(result.clarificationRequest, 'carries a clarification request');
  assert.ok(result.clarificationRequest?.interactionId, 'carries a stale-resume guard id');
  assert.equal(result.clarificationRequest?.level, 'output');
  assert.deepEqual(result.clarificationRequest?.options.map((o) => o.id), ['light', 'sound']);
  assert.equal(result.renderPlan.parts.length, 0, 'no scene for an awaiting_input turn');
  assert.ok(result.assistantMessages[0]?.includes('Choose an output'), 'question is shown to the student');
});

test('request.resume invokes the agent with a Command resume after pending interaction validation', async () => {
  __resetAgentThreadSessionForTests();
  let resumeInputSeen: unknown = null;

  const deepAgentFactory = ((config: { name?: string }) => {
    if (config.name === 'h-eduware-requirement-analysis-agent') {
      return requirementStub('synthesize_circuit');
    }
    return {
      invoke: async (input: unknown) => {
        if (isCommand(input)) {
          resumeInputSeen = input;
          return { structuredResponse: { responseKind: 'chat', assistantMessage: 'I will build that.', circuitSpec: null } };
        }
        return INTERRUPT_OUTPUT;
      }
    };
  }) as unknown as DeepAgentFactory;

  const pending = await runAgent(
    { message: 'choose an output', locale: 'ko', sessionId: 's-int-resume', taskId: 'task-12345678' } as AgentMessageRequest,
    { deps: { modelPort, deepAgentFactory } }
  );

  const result = await runAgent(
    {
      message: 'Sound',
      resume: 'sound',
      resumeInteractionId: pending.clarificationRequest?.interactionId,
      locale: 'ko',
      sessionId: 's-int-resume',
      taskId: 'task-12345678',
      requestKind: 'resume_clarification'
    } as AgentMessageRequest,
    { deps: { modelPort, deepAgentFactory } }
  );

  assert.ok(resumeInputSeen, 'the synthesis agent was invoked with a Command');
  assert.ok(isCommand(resumeInputSeen), 'resume path uses Command(resume)');
  assert.equal(result.responseKind, 'chat', 'the resumed run produced a result');
});

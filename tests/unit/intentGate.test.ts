import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyStudentIntent, getIntentGateMode } from '../../server/agent/intentGate.ts';
import { RecordedCassetteModel } from '../../server/agent/modelCassette.ts';
import type { DeepAgentFactory } from '../../server/agent/agentRuntimePorts.ts';
import type { AgentMessageRequest } from '../../server/agent/schemas.ts';

// US-1 — the front intent gate is LLM-JUDGED (no regex). These tests drive classifyStudentIntent
// through an injected DeepAgentFactory + cassette model, proving zero live OpenAI calls.

type InvokeInput = { messages: Array<{ role: string; content: string }> };

function stubFactory(
  structuredResponse: unknown,
  capture?: (prompt: string) => void
): DeepAgentFactory {
  return ((_config: unknown) => ({
    invoke: async (input: InvokeInput) => {
      capture?.(input.messages[0]?.content ?? '');
      return { structuredResponse };
    }
  })) as unknown as DeepAgentFactory;
}

function throwingFactory(): DeepAgentFactory {
  return ((_config: unknown) => ({
    invoke: async () => {
      throw new Error('model exploded');
    }
  })) as unknown as DeepAgentFactory;
}

const model = new RecordedCassetteModel([]);

void test('casual_chat decision carries a non-null reply', async () => {
  const decision = await classifyStudentIntent({
    request: { message: '안뇽', locale: 'ko' } as AgentMessageRequest,
    model,
    deepAgentFactory: stubFactory({ kind: 'casual_chat', reply: '안녕! 어떤 회로 만들어볼까?', reason: 'greeting' })
  });

  assert.equal(decision.kind, 'casual_chat');
  assert.ok(decision.reply && decision.reply.length > 0, 'casual_chat must include a conversational reply');
});

void test('circuit_request decision normalizes reply to null', async () => {
  const decision = await classifyStudentIntent({
    request: { message: 'LED 깜빡이게 해줘', locale: 'ko' } as AgentMessageRequest,
    model,
    // Even if the model leaks a reply, a circuit_request must drop it (the synthesis path owns text).
    deepAgentFactory: stubFactory({ kind: 'circuit_request', reply: 'stray text', reason: 'wants LED blink' })
  });

  assert.equal(decision.kind, 'circuit_request');
  assert.equal(decision.reply, null);
});

void test('recent conversation turns are passed into the classifier prompt', async () => {
  let capturedPrompt = '';
  await classifyStudentIntent({
    request: {
      message: '응 만들어줘',
      locale: 'ko',
      conversationContext: {
        recentTurns: [
          { role: 'student', text: '버튼으로 LED 켜는 거 알려줘' },
          { role: 'assistant', text: 'D2 버튼, D9 LED로 만들어볼까요?' }
        ]
      }
    } as AgentMessageRequest,
    model,
    deepAgentFactory: stubFactory(
      { kind: 'circuit_request', reply: null, reason: 'confirms prior circuit' },
      (prompt) => { capturedPrompt = prompt; }
    )
  });

  assert.match(capturedPrompt, /버튼으로 LED 켜는 거 알려줘/, 'prior student turn is in the prompt');
  assert.match(capturedPrompt, /응 만들어줘/, 'latest message is in the prompt');
});

void test('a casual_chat decision with an empty reply fails open to circuit_request', async () => {
  const decision = await classifyStudentIntent({
    request: { message: '음', locale: 'ko' } as AgentMessageRequest,
    model,
    deepAgentFactory: stubFactory({ kind: 'casual_chat', reply: '   ', reason: 'unusable' })
  });

  assert.equal(decision.kind, 'circuit_request', 'unusable chat replies must not block circuit work');
});

void test('invoke failure fails open to circuit_request (gate never blocks a real request)', async () => {
  const decision = await classifyStudentIntent({
    request: { message: 'LED 회로 만들어줘', locale: 'ko' } as AgentMessageRequest,
    model,
    deepAgentFactory: throwingFactory()
  });

  assert.equal(decision.kind, 'circuit_request');
  assert.equal(decision.reply, null);
});

void test('getIntentGateMode defaults to on and only off-switches on "off"', () => {
  assert.equal(getIntentGateMode({} as NodeJS.ProcessEnv), 'on');
  assert.equal(getIntentGateMode({ H_EDUWARE_INTENT_GATE: 'off' } as unknown as NodeJS.ProcessEnv), 'off');
  assert.equal(getIntentGateMode({ H_EDUWARE_INTENT_GATE: 'OFF' } as unknown as NodeJS.ProcessEnv), 'off');
  assert.equal(getIntentGateMode({ H_EDUWARE_INTENT_GATE: '  off  ' } as unknown as NodeJS.ProcessEnv), 'off');
  assert.equal(getIntentGateMode({ H_EDUWARE_INTENT_GATE: 'on' } as unknown as NodeJS.ProcessEnv), 'on');
  assert.equal(getIntentGateMode({ H_EDUWARE_INTENT_GATE: 'anything' } as unknown as NodeJS.ProcessEnv), 'on');
});

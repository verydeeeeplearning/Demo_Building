import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runAgent } from '../../server/agent/deepAgentRuntime.ts';
import { RecordedCassetteModel } from '../../server/agent/modelCassette.ts';
import type { DeepAgentFactory, ModelPort } from '../../server/agent/agentRuntimePorts.ts';
import type { AgentMessageRequest } from '../../server/agent/schemas.ts';

// PLAN_react_routing_and_clean_chat Phase 1 — the SYNTHESIS agent itself decides the turn type
// (ReAct). A draft with responseKind:'chat' (and no circuitSpec) routes to a conversational result;
// a draft with a circuitSpec finalizes as a circuit. There is no binary pre-gate — the decision is
// owned entirely by the agent draft.

const VALID_SPEC = {
  id: 'led-blink',
  title: 'LED blink',
  intent: { primaryGoal: 'blink an LED', output: 'led', controller: 'arduino-uno' },
  components: [{ id: 'u1', partId: 'arduino-uno', label: 'Arduino Uno' }],
  connections: [],
  behavior: { runText: 'BLINK' },
  assumptions: [],
  unsupportedItems: [],
  clarificationNeeds: []
};

function synthesizeRouteRequirementAgent() {
  return {
    invoke: async () => ({
      structuredResponse: {
        route: 'synthesize_circuit',
        confidence: 0.9,
        summary: 'concrete buildable LED request',
        assistantMessage: 'LED 회로를 만들어볼게요.',
        clarification: null
      }
    })
  };
}

async function runWithSynthesisDraft(message: string, draft: unknown) {
  const modelPort: ModelPort = { createModel: () => new RecordedCassetteModel([]) };
  const deepAgentFactory = ((config: { name?: string }) => {
    if (config.name === 'h-eduware-requirement-analysis-agent') {
      return synthesizeRouteRequirementAgent();
    }
    // synthesis agent returns the agent-authored decision draft
    return { invoke: async () => ({ structuredResponse: draft }) };
  }) as unknown as DeepAgentFactory;

  const prevPipeline = process.env.H_EDUWARE_AGENT_PIPELINE;
  process.env.H_EDUWARE_AGENT_PIPELINE = 'legacy';
  try {
    const request = { message, locale: 'ko' } as AgentMessageRequest;
    return await runAgent(request, { deps: { modelPort, deepAgentFactory } });
  } finally {
    process.env.H_EDUWARE_AGENT_PIPELINE = prevPipeline;
  }
}

void test('an agent chat decision (responseKind:chat, no circuitSpec) returns a chat result', async () => {
  const reply = '추천: 1) LED 깜빡임 2) 버튼 입력 3) OLED 표시. 어느 걸 만들어볼까요?';
  const result = await runWithSynthesisDraft('회로 하나 추천해줄래?', {
    responseKind: 'chat',
    assistantMessage: reply,
    circuitSpec: null
  });

  assert.equal(result.responseKind, 'chat', 'the agent decided this turn is conversational');
  assert.equal(result.assistantMessages[0], reply, 'the agent reply is surfaced verbatim');
  assert.equal(result.renderPlan.parts.length, 0, 'a chat reply renders no 3D scene');
  assert.equal(result.buildRunnableReport.runnable, false, 'a chat reply is not runnable');
});

void test('an agent circuit decision (circuitSpec present) finalizes as a circuit result', async () => {
  const result = await runWithSynthesisDraft('LED를 깜빡여줘', {
    responseKind: 'circuit',
    assistantMessage: '회로를 만들었어요.',
    circuitSpec: VALID_SPEC
  });

  assert.equal(result.responseKind, 'circuit', 'a circuit draft stays a circuit result');
});

void test('a draft that omits responseKind but has a circuitSpec defaults to a circuit result', async () => {
  const result = await runWithSynthesisDraft('LED를 깜빡여줘', {
    assistantMessage: '회로를 만들었어요.',
    circuitSpec: VALID_SPEC
  });

  assert.equal(result.responseKind, 'circuit', 'responseKind defaults to circuit when omitted');
});

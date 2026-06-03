import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runAgent } from '../../server/agent/deepAgentRuntime.ts';
import { RecordedCassetteModel } from '../../server/agent/modelCassette.ts';
import type { DeepAgentFactory, ModelPort } from '../../server/agent/agentRuntimePorts.ts';
import type { AgentMessageRequest } from '../../server/agent/schemas.ts';

// PLAN_react_routing_and_clean_chat Phase 3 — a clarify_requirements route no longer short-circuits to
// a canned preflight draft. It reaches the synthesis agent, which OWNS the decision (ReAct) and may
// answer conversationally. Only unsupported_or_gap stays a hard, server-enforced preflight guardrail.

void test('a clarify_requirements route now reaches the synthesis agent (no canned short-circuit)', async () => {
  const modelPort: ModelPort = { createModel: () => new RecordedCassetteModel([]) };

  let synthesisInvoked = false;
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
    // synthesis agent — must be reached now, and it answers conversationally
    return {
      invoke: async () => {
        synthesisInvoked = true;
        return {
          structuredResponse: {
            responseKind: 'chat',
            assistantMessage: '어떤 입력과 출력을 원해요? 예: 버튼을 누르면 LED가 켜지게.',
            circuitSpec: null
          }
        };
      }
    };
  }) as unknown as DeepAgentFactory;

  const prev = process.env.H_EDUWARE_AGENT_PIPELINE;
  process.env.H_EDUWARE_AGENT_PIPELINE = 'legacy';
  try {
    const request = { message: '뭔가 만들고 싶은데 잘 모르겠어', locale: 'ko' } as AgentMessageRequest;
    const result = await runAgent(request, { deps: { modelPort, deepAgentFactory } });

    assert.equal(synthesisInvoked, true, 'the synthesis agent is reached for a clarify route');
    assert.equal(result.responseKind, 'chat', 'the agent decided to answer conversationally');
    assert.match(result.assistantMessages[0], /입력과 출력/);
    assert.equal(result.renderPlan.parts.length, 0);
  } finally {
    process.env.H_EDUWARE_AGENT_PIPELINE = prev;
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runAgent } from '../../server/agent/deepAgentRuntime.ts';
import { RecordedCassetteModel } from '../../server/agent/modelCassette.ts';
import type { DeepAgentFactory, ModelPort } from '../../server/agent/agentRuntimePorts.ts';
import type { AgentMessageRequest } from '../../server/agent/schemas.ts';

// Live root cause #2 (confirmed via agent logs + browser): in legacy mode (the production default),
// the requirement-analysis DeepAgent often answers a greeting in plain text and never emits the
// structured route, so parseRequirementAnalysis threw AgentStructuredOutputError with NO fallback ->
// HTTP 502 -> the rule error "회로 초안을 구조화해서 확인하지 못했어요". The fix falls back to the
// deterministic deriveRequirementAnalysis route, so the turn reaches the synthesis agent instead.

void test('legacy requirement-analysis structured-output miss falls back to a deterministic route (no 502)', async () => {
  const modelPort: ModelPort = { createModel: () => new RecordedCassetteModel([]) };

  let synthesisInvoked = false;
  const deepAgentFactory = ((config: { name?: string }) => {
    if (config.name === 'h-eduware-requirement-analysis-agent') {
      // No structuredResponse -> parseRequirementAnalysis throws AgentStructuredOutputError.
      return { invoke: async () => ({}) };
    }
    // Synthesis agent must still be reached, and answers conversationally.
    return {
      invoke: async () => {
        synthesisInvoked = true;
        return {
          structuredResponse: {
            responseKind: 'chat',
            assistantMessage: '안녕하세요! 어떤 회로를 만들어볼까요?',
            circuitSpec: null
          }
        };
      }
    };
  }) as unknown as DeepAgentFactory;

  const prev = process.env.H_EDUWARE_AGENT_PIPELINE;
  process.env.H_EDUWARE_AGENT_PIPELINE = 'legacy';
  try {
    const request = { message: '안뇽', locale: 'ko' } as AgentMessageRequest;
    const result = await runAgent(request, { deps: { modelPort, deepAgentFactory } });

    assert.equal(result.responseKind, 'chat', 'the greeting resolves to a conversational reply, not a 502');
    assert.equal(synthesisInvoked, true, 'the synthesis agent is reached after the deterministic fallback');
    assert.match(result.assistantMessages[0], /어떤 회로/);
  } finally {
    process.env.H_EDUWARE_AGENT_PIPELINE = prev;
  }
});

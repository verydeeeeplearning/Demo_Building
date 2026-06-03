import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deriveRequirementAnalysis, runAgent } from '../../server/agent/deepAgentRuntime.ts';
import { buildContextPacket } from '../../server/context/contextPacket.ts';
import { RecordedCassetteModel } from '../../server/agent/modelCassette.ts';
import type { DeepAgentFactory, ModelPort } from '../../server/agent/agentRuntimePorts.ts';
import type { AgentMessageRequest } from '../../server/agent/schemas.ts';

// Phase 3 — single-run harness. In shadow|next, the requirement route is derived deterministically
// from the context packet (no LLM), collapsing the two createDeepAgent runs into one. legacy keeps
// the two-run behavior. (Live route-distribution parity is validated by Phase 6 live smoke.)

function stubAgent(structuredResponse: unknown) {
  return { invoke: async () => ({ structuredResponse }) };
}

async function deriveRouteFor(message: string): Promise<string> {
  const packet = await buildContextPacket({ message, locale: 'ko' });
  return deriveRequirementAnalysis({ message, locale: 'ko' } as AgentMessageRequest, packet).route;
}

void test('deterministic derivation maps context signals to routes', async () => {
  assert.equal(await deriveRouteFor('LED 하나를 저항이랑 같이 깜빡이게 해줘'), 'synthesize_circuit');
  assert.equal(await deriveRouteFor('뭔가 만들고 싶은데 잘 모르겠어'), 'clarify_requirements');
  assert.equal(await deriveRouteFor('220V 콘센트에 연결해서 모터를 돌리고 싶어'), 'unsupported_or_gap');
});

void test('NEXT collapses to ONE createDeepAgent; LEGACY keeps two', async () => {
  // A clarify-deriving message keeps it deterministic: the synthesis agent is constructed but never
  // invoked (the preflight short-circuits), so no structured circuit draft is needed.
  const message = '뭔가 만들고 싶은데 잘 모르겠어';
  const modelPort: ModelPort = { createModel: () => new RecordedCassetteModel([]) };

  async function countFactoryCalls(mode: string): Promise<string[]> {
    const previous = process.env.H_EDUWARE_AGENT_PIPELINE;
    process.env.H_EDUWARE_AGENT_PIPELINE = mode;
    try {
      const names: string[] = [];
      const deepAgentFactory = ((config: { name?: string }) => {
        names.push(config.name ?? '<unnamed>');
        if (config.name === 'h-eduware-requirement-analysis-agent') {
          return stubAgent({
            route: 'clarify_requirements',
            confidence: 0.6,
            summary: 'needs detail',
            assistantMessage: '무엇을 만들까요?',
            clarification: '목표를 알려주세요.'
          });
        }
        return stubAgent({});
      }) as unknown as DeepAgentFactory;
      await runAgent({ message, locale: 'ko' } as AgentMessageRequest, {
        // Passthrough intent gate so the front gate adds no factory call — this asserts the exact
        // requirement/synthesis construction counts per mode (PLAN_intent_gate.md US-3).
        deps: { modelPort, deepAgentFactory, intentGate: async () => ({ kind: 'circuit_request', reply: null, reason: 'test passthrough' }) }
      });
      return names;
    } finally {
      process.env.H_EDUWARE_AGENT_PIPELINE = previous;
    }
  }

  const legacyNames = await countFactoryCalls('legacy');
  const nextNames = await countFactoryCalls('next');

  assert.equal(legacyNames.length, 2, 'legacy constructs requirement-analysis + synthesis agents');
  assert.equal(nextNames.length, 1, 'next constructs only the synthesis agent');
  assert.deepEqual(nextNames, ['h-eduware-deepagent']);
});

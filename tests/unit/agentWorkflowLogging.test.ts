import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runAgent } from '../../server/agent/deepAgentRuntime.ts';
import { RecordedCassetteModel } from '../../server/agent/modelCassette.ts';
import { resolveAgentThreadId } from '../../server/agent/agentThreadSession.ts';
import type { DeepAgentFactory, ModelPort } from '../../server/agent/agentRuntimePorts.ts';
import type { AgentMessageRequest, CircuitSpec } from '../../server/agent/schemas.ts';

type StubAgent = {
  invoke: (input: unknown, config?: unknown) => Promise<{
    structuredResponse: unknown;
    messages?: unknown[];
  }>;
};

const ledCircuitSpec: CircuitSpec = {
  id: 'led-blink-good',
  title: 'LED blink with current limiting',
  intent: { primaryGoal: 'blink an LED', output: 'led', controller: 'arduino-uno' },
  components: [
    { id: 'bb1', partId: 'breadboard-half', label: 'Breadboard', designator: 'BB1' },
    { id: 'u1', partId: 'arduino-uno', label: 'Arduino Uno', designator: 'U1' },
    { id: 'r1', partId: 'resistor-220', label: '220 ohm resistor', designator: 'R1' },
    { id: 'd1', partId: 'led-5mm', label: 'LED', designator: 'D1' }
  ],
  connections: [
    { id: 'c1', from: { componentId: 'u1', pin: 'D9' }, to: { componentId: 'r1', pin: '1' }, signal: 'gpio' },
    { id: 'c2', from: { componentId: 'r1', pin: '2' }, to: { componentId: 'd1', pin: 'A' }, signal: 'gpio' },
    { id: 'c3', from: { componentId: 'd1', pin: 'K' }, to: { componentId: 'u1', pin: 'GND' }, signal: 'ground' }
  ],
  behavior: { runText: 'D9 HIGH/LOW blinks the LED.' },
  assumptions: [],
  unsupportedItems: [],
  clarificationNeeds: []
};

function stubAgent(structuredResponse: unknown): StubAgent {
  return { invoke: async () => ({ structuredResponse, messages: [] }) };
}

test('agent workflow logs safe LLM handoffs, parsed drafts, and final simulation artifacts', async () => {
  const previousLevel = process.env.H_EDUWARE_AGENT_LOG_LEVEL;
  const previousJson = process.env.H_EDUWARE_AGENT_LOG_JSON;
  const previousFile = process.env.H_EDUWARE_AGENT_LOG_FILE;
  const previousPipeline = process.env.H_EDUWARE_AGENT_PIPELINE;
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (line?: unknown) => {
    lines.push(String(line));
  };

  try {
    process.env.H_EDUWARE_AGENT_LOG_LEVEL = 'debug';
    process.env.H_EDUWARE_AGENT_LOG_JSON = 'true';
    process.env.H_EDUWARE_AGENT_LOG_FILE = 'false';
    process.env.H_EDUWARE_AGENT_PIPELINE = 'legacy';

    const modelPort: ModelPort = { createModel: () => new RecordedCassetteModel([]) };
    let synthesisMiddlewareCount = 0;
    const deepAgentFactory = ((config: { name?: string }) => {
      if (config.name === 'h-eduware-requirement-analysis-agent') {
        return stubAgent({
          route: 'synthesize_circuit',
          confidence: 0.94,
          summary: 'Supported LED circuit request.',
          assistantMessage: 'Proceeding to circuit synthesis.',
          clarification: null,
          blockingReason: null,
          circuitGoal: {
            input: null,
            output: 'led',
            behavior: 'blink',
            controller: 'arduino-uno'
          },
          agentEvents: []
        });
      }

      synthesisMiddlewareCount = Array.isArray((config as { middleware?: unknown[] }).middleware)
        ? ((config as { middleware?: unknown[] }).middleware ?? []).length
        : 0;
      return stubAgent({
        responseKind: 'circuit',
        assistantMessage: '검증 가능한 LED 깜빡이 회로를 만들었습니다.',
        clarification: null,
        circuitSpec: ledCircuitSpec,
        agentEvents: [],
        supportedAlternatives: []
      });
    }) as unknown as DeepAgentFactory;

    await runAgent(
      {
        message: 'Arduino Uno D9에서 220옴 저항으로 LED를 깜빡이게 해줘',
        locale: 'ko',
        sessionId: 'session-logging-test'
      } as AgentMessageRequest,
      { traceId: 'agent-logging-test', deps: { modelPort, deepAgentFactory } }
    );

    assert.ok(synthesisMiddlewareCount > 0, 'legacy synthesis agent must still attach observability middleware');

    const events = lines.map((line) => JSON.parse(line));
    const byEvent = (name: string) => events.filter((event) => event.event === name);

    const handoffs = byEvent('agent.llm.handoff');
    assert.deepEqual(
      handoffs.map((event) => event.stage),
      ['requirement-analysis', 'synthesis'],
      'requirement and synthesis LLM handoffs must be logged in order'
    );
    assert.equal(handoffs[0].threadId, 'session-logging-test:requirement-analysis');
    assert.equal(handoffs[1].threadId, resolveAgentThreadId({ sessionId: 'session-logging-test' }));
    assert.equal(handoffs[1].requirementRoute, 'synthesize_circuit');
    assert.match(String(handoffs[1].prompt.systemHash), /^[0-9a-f]{64}$/);
    assert.match(String(handoffs[1].prompt.userHash), /^[0-9a-f]{64}$/);
    assert.equal(
      JSON.stringify(handoffs).includes('Arduino Uno D9에서 220옴 저항으로 LED를 깜빡이게 해줘'),
      false,
      'LLM handoff logs must record hashes/sizes, not raw prompt text'
    );

    const completions = byEvent('agent.llm.completed');
    assert.deepEqual(
      completions.map((event) => event.stage),
      ['requirement-analysis', 'synthesis'],
      'requirement and synthesis LLM completions must be logged'
    );
    assert.equal(completions[0].hasStructuredResponse, true);
    assert.equal(completions[1].hasStructuredResponse, true);

    const parsed = byEvent('agent.structured_output.parsed');
    assert.equal(parsed[0].stage, 'requirement-analysis');
    assert.equal(parsed[0].requirementRoute, 'synthesize_circuit');
    assert.equal(parsed[1].stage, 'synthesis');
    assert.equal(parsed[1].responseKind, 'circuit');
    assert.equal(parsed[1].circuitSpecId, 'led-blink-good');
    assert.equal(parsed[1].componentCount, 4);
    assert.equal(parsed[1].connectionCount, 3);

    const simulationEvents = byEvent('agent.simulation.compiled');
    assert.equal(simulationEvents.length, 1);
    assert.equal(simulationEvents[0].circuitSpecId, 'led-blink-good');
    assert.equal(simulationEvents[0].validationStatus, 'valid');
    assert.equal(simulationEvents[0].simulationStatus, 'valid');
    assert.ok(simulationEvents[0].renderPartCount >= 4);
    assert.ok(simulationEvents[0].currentPathCount >= 1);
  } finally {
    console.log = originalLog;
    if (previousLevel === undefined) {
      delete process.env.H_EDUWARE_AGENT_LOG_LEVEL;
    } else {
      process.env.H_EDUWARE_AGENT_LOG_LEVEL = previousLevel;
    }
    if (previousJson === undefined) {
      delete process.env.H_EDUWARE_AGENT_LOG_JSON;
    } else {
      process.env.H_EDUWARE_AGENT_LOG_JSON = previousJson;
    }
    if (previousFile === undefined) {
      delete process.env.H_EDUWARE_AGENT_LOG_FILE;
    } else {
      process.env.H_EDUWARE_AGENT_LOG_FILE = previousFile;
    }
    if (previousPipeline === undefined) {
      delete process.env.H_EDUWARE_AGENT_PIPELINE;
    } else {
      process.env.H_EDUWARE_AGENT_PIPELINE = previousPipeline;
    }
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDeepAgent } from 'deepagents';
import { toolStrategy } from 'langchain';
import { z } from 'zod';
import { AIMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { tool } from 'langchain';

import { createObservabilityMiddleware, type ObservabilityEvent } from '../../server/agent/observabilityMiddleware.ts';

// Phase 6.2 — deterministic observability middleware probe (fake model, ZERO live calls).
//
// Verifies that createObservabilityMiddleware wraps tool calls inside createDeepAgent and
// fires the callback with { tool, status: 'ok' } on a successful tool call.
// Uses the same fake-model-through-createDeepAgent pattern as responseFormatReachability.test.ts.

// A simple test tool that the fake model will call.
const echoTool = tool(
  async ({ message }: { message: string }) => `echo: ${message}`,
  {
    name: 'echo',
    description: 'Echoes the message back',
    schema: z.object({ message: z.string() })
  }
);

// Response format schema (minimal — just needs a structured terminal emit).
const ResultSchema = z.object({ done: z.boolean() });

// Scripted model:
//   Turn 1 (no tool results yet): call the `echo` tool.
//   Turn 2 (tool result present):  emit the terminal toolStrategy structured response.
class ObservabilityProbeModel extends BaseChatModel<Record<string, unknown>> {
  responseToolName: string | null = null;
  echoCalled = false;

  _llmType() {
    return 'observability-probe-model';
  }

  bindTools(tools: Array<{ name?: string; function?: { name?: string } }>) {
    const names = tools.map((t) => t?.name ?? t?.function?.name ?? '??');
    const resp = names.find((n) => n.startsWith('extract'));
    if (resp) this.responseToolName = resp;
    return this;
  }

  async _generate(messages: Array<{ _getType?: () => string; content?: unknown }>) {
    const hasToolResult = messages.some((m) => m?._getType?.() === 'tool');

    // Turn 2: emit terminal structured response once the tool result arrived.
    if (hasToolResult && this.responseToolName) {
      return this.toolCall('call_resp', this.responseToolName, { done: true });
    }

    // Turn 1: call the echo tool.
    this.echoCalled = true;
    return this.toolCall('call_echo_1', 'echo', { message: 'hello' });
  }

  private toolCall(id: string, name: string, args: Record<string, unknown>) {
    return {
      generations: [
        {
          message: new AIMessage({ content: '', tool_calls: [{ id, name, args }] }),
          text: ''
        }
      ]
    };
  }
}

void test('createObservabilityMiddleware captures tool call events via callback', async () => {
  const captured: ObservabilityEvent[] = [];
  const model = new ObservabilityProbeModel({});

  const agent = createDeepAgent({
    model: model as unknown as BaseChatModel,
    tools: [echoTool],
    responseFormat: toolStrategy(ResultSchema),
    systemPrompt: 'You are an observability probe agent.',
    name: 'observability-probe-agent',
    middleware: [
      createObservabilityMiddleware((event) => {
        captured.push(event);
      })
    ]
  });

  const result = (await agent.invoke(
    { messages: [{ role: 'user', content: 'ping' }] },
    { recursionLimit: 8 }
  )) as { structuredResponse?: unknown };

  // 1. The agent reached a terminal structured response.
  assert.ok(
    result.structuredResponse !== undefined,
    'terminal structured response must be emitted'
  );

  // 2. The fake model actually called the echo tool.
  assert.equal(model.echoCalled, true, 'fake model must have emitted the echo tool call');

  // 3. The observability callback captured at least one event for the echo tool.
  const echoEvent = captured.find((e) => e.tool === 'echo');
  assert.ok(echoEvent !== undefined, `callback must capture an event for the echo tool; got: ${JSON.stringify(captured)}`);
  assert.equal(echoEvent.status, 'ok', 'echo tool event must have status "ok"');
  assert.match(String(echoEvent.inputHash), /^[0-9a-f]{64}$/);
  assert.match(String(echoEvent.outputHash), /^[0-9a-f]{64}$/);
  assert.ok(Number(echoEvent.durationMs) >= 0);
  assert.ok(Number(echoEvent.outputChars) > 0);

  console.log(
    `[phase6.2] observability middleware: captured events=${JSON.stringify(captured)} ` +
      '=> wrapToolCall fires callback with correct tool name and status.'
  );
});

void test('createObservabilityMiddleware redacts tool call error events', async () => {
  const captured: ObservabilityEvent[] = [];
  const middleware = createObservabilityMiddleware((event) => {
    captured.push(event);
  });

  await assert.rejects(
    async () => middleware.wrapToolCall!(
      {
        toolCall: {
          name: 'fail_with_secret',
          args: { message: 'sk-testsecret1234567890' }
        }
      } as any,
      async () => {
        throw new Error('tool failed for sk-testsecret1234567890');
      }
    )
  );

  const failEvent = captured.find((event) => event.tool === 'fail_with_secret');
  assert.ok(failEvent, `callback must capture failing tool event; got ${JSON.stringify(captured)}`);
  assert.equal(failEvent.status, 'error');
  assert.equal(failEvent.error, 'tool failed for [redacted-api-key]');
  assert.doesNotMatch(JSON.stringify(failEvent), /sk-testsecret1234567890/);
  assert.match(String(failEvent.inputHash), /^[0-9a-f]{64}$/);
});

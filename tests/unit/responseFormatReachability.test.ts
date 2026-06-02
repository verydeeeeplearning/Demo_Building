import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDeepAgent } from 'deepagents';
import { toolStrategy } from 'langchain';
import { z } from 'zod';
import { AIMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

// Phase 0.3 — deterministic reachability probe (fake model, ZERO live calls).
//
// Question driving the Phase 4 subagent disposition: under the production synthesis config
// (`responseFormat: toolStrategy(...)` + subagents), is the built-in `task` delegation tool
// reachable, or does the forced terminal structured emit STRUCTURALLY suppress it?
//
// Recorded finding (asserted below): `task` is BOTH bound to the model AND executable end-to-end
// — a model that calls `task` has the subagent run, then still emits the terminal structured
// response. So delegation is NOT structurally suppressed by toolStrategy. The observed passivity
// of subagents in production is therefore BEHAVIORAL (never instructed; the model converges to an
// immediate emit), not structural. => Phase 4 default remains Path B (remove unused subagents),
// but Path A (keep + scope + instruct) is technically feasible, not blocked by the harness.

const MAIN_MARKER = 'MAINPROBE-MARKER';

// One model instance is shared by the main agent AND the spawned subagent. We discriminate the
// two by a unique marker in the main agent's system prompt (both calls otherwise present as
// [system, human]). Scripted flow:
//   - main, first turn          -> delegate via the built-in `task` tool
//   - subagent turn             -> plain content (terminates the subagent; proves task executed)
//   - main, after `task` result -> emit the terminal structured response
// Notes: the toolStrategy response tool is an OpenAI-format tool whose name lives at
// `.function.name` (e.g. `extract-1`), and the system message `content` is an array of blocks.
class ReachabilityProbeModel extends BaseChatModel<Record<string, unknown>> {
  mainBoundToolNames: string[] = [];
  responseToolName: string | null = null;
  delegated = false;
  subagentRan = false;

  _llmType() {
    return 'reachability-probe-model';
  }

  bindTools(tools: Array<{ name?: string; function?: { name?: string } }>) {
    const names = tools.map((t) => t?.name ?? t?.function?.name ?? '??');
    if (names.includes('task')) this.mainBoundToolNames = names; // the main agent's binding
    const resp = names.find((n) => n.startsWith('extract'));
    if (resp) this.responseToolName = resp; // sticky
    return this;
  }

  private isMainAgent(messages: Array<{ _getType?: () => string; content?: unknown }>): boolean {
    const system = messages.find((m) => m?._getType?.() === 'system');
    return system ? JSON.stringify(system.content ?? '').includes(MAIN_MARKER) : false;
  }

  async _generate(messages: Array<{ name?: string; _getType?: () => string; content?: unknown }>) {
    const isMain = this.isMainAgent(messages);
    const taskResultPresent = messages.some((m) => m?._getType?.() === 'tool');

    if (isMain && taskResultPresent && this.responseToolName) {
      return this.toolCall('call_resp', this.responseToolName, { ok: true });
    }
    if (isMain && !this.delegated && this.responseToolName) {
      this.delegated = true;
      return this.toolCall('call_task_1', 'task', { description: 'probe', subagent_type: 'probe-sub' });
    }
    // Subagent turn: returning plain content proves the `task` tool executed the subagent.
    if (!isMain) this.subagentRan = true;
    return { generations: [{ message: new AIMessage({ content: 'probe-subagent-done' }), text: 'probe-subagent-done' }] };
  }

  private toolCall(id: string, name: string, args: Record<string, unknown>) {
    return { generations: [{ message: new AIMessage({ content: '', tool_calls: [{ id, name, args }] }), text: '' }] };
  }
}

void test('task delegation is structurally reachable AND executable under responseFormat: toolStrategy', async () => {
  const model = new ReachabilityProbeModel({});
  const agent = createDeepAgent({
    // Mirrors the production synthesis config: subagents + toolStrategy responseFormat.
    model: model as unknown as BaseChatModel,
    tools: [],
    subagents: [{ name: 'probe-sub', description: 'probe subagent', systemPrompt: 'you are a probe subagent' }],
    responseFormat: toolStrategy(z.object({ ok: z.boolean() })),
    systemPrompt: `You are the ${MAIN_MARKER} coordinator.`,
    name: 'reachability-probe-agent'
  });

  const result = (await agent.invoke(
    { messages: [{ role: 'user', content: 'hi' }] },
    { recursionLimit: 8 }
  )) as { structuredResponse?: unknown };

  // 1. Structural: the built-in `task` tool IS bound even with a toolStrategy response format.
  assert.ok(model.mainBoundToolNames.includes('task'), `task must be bound; got ${model.mainBoundToolNames.join(',')}`);
  // 2. Harness-native planning/filesystem tools are present by default (no manual wiring).
  assert.ok(model.mainBoundToolNames.includes('write_todos'), 'write_todos planning tool is bound by default');
  // 3. Executable: a model that calls `task` has the subagent actually run...
  assert.equal(model.subagentRan, true, 'subagent executed after the task tool-call');
  // 4. ...and the terminal structured emit is still reached afterwards.
  assert.ok(result.structuredResponse !== undefined, 'terminal structured response still emitted after delegation');

  console.log(
    `[phase0] reachability: task bound=true executable=true; default-bound tools=[${model.mainBoundToolNames.join(', ')}] ` +
      '=> toolStrategy does NOT structurally suppress delegation (passivity is behavioral). Phase 4 default = Path B (remove).'
  );
});

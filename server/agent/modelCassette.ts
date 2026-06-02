// Recorded-cassette model adapter (Agent Pipeline Refactor, Phase 0.5 seam 0.5.4).
//
// Goal: run the reliability/eval corpus against the real deepagents harness with ZERO live calls
// in the default test gate. A cassette is an ordered list of the model's turn outputs (content +
// tool calls). Recording is opt-in (a live run with a callback handler attached); replay is
// deterministic and offline.
//
//   - RecordedCassetteModel / createReplayModelPort : replay turns by sequence (ModelPort).
//   - createCassetteRecorder                        : a callback handler that captures live turns.
//   - loadCassette / saveCassette                   : the on-disk JSON format.
//
// Replay-by-sequence works because the single shared model instance produces turns in a
// deterministic order across the agent graph (main agent + any subagents), so recording and replay
// traverse the same sequence.

import { readFile, writeFile } from 'node:fs/promises';

import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';
import { z } from 'zod';

import type { ModelPort } from './agentRuntimePorts.ts';

const ToolCallSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()).default({})
});

const CassetteEntrySchema = z.object({
  content: z.string().default(''),
  toolCalls: z.array(ToolCallSchema).default([])
});

export const ModelCassetteSchema = z.object({
  version: z.literal(1),
  model: z.string().default('recorded'),
  entries: z.array(CassetteEntrySchema)
});

export type ModelCassette = z.infer<typeof ModelCassetteSchema>;
export type CassetteEntry = z.infer<typeof CassetteEntrySchema>;

export class CassetteExhaustedError extends Error {
  constructor(requested: number, available: number) {
    super(`Cassette exhausted: requested turn ${requested + 1} but only ${available} were recorded.`);
    this.name = 'CassetteExhaustedError';
  }
}

/** A BaseChatModel that replays recorded turns in order. Deterministic; no network. */
export class RecordedCassetteModel extends BaseChatModel<Record<string, unknown>> {
  private readonly entries: CassetteEntry[];
  private cursor = 0;
  // The toolStrategy response tool name is a GLOBAL incrementing counter (`extract-1`, `extract-2`,
  // ...), so a replay agent is named differently than the one that was recorded. We learn the live
  // name from bindTools and remap any recorded `extract*` response-tool call onto it.
  private liveResponseToolName: string | null = null;

  constructor(entries: CassetteEntry[]) {
    super({});
    this.entries = entries;
  }

  _llmType() {
    return 'recorded-cassette-model';
  }

  bindTools(tools: Array<{ name?: string; function?: { name?: string } }>) {
    const responseTool = tools
      .map((t) => t?.name ?? t?.function?.name ?? '')
      .find((name) => name.startsWith('extract'));
    if (responseTool) this.liveResponseToolName = responseTool;
    return this;
  }

  async _generate(_messages: BaseMessage[]) {
    if (this.cursor >= this.entries.length) {
      throw new CassetteExhaustedError(this.cursor, this.entries.length);
    }
    const entry = this.entries[this.cursor];
    this.cursor += 1;
    const message = new AIMessage({
      content: entry.content,
      tool_calls: entry.toolCalls.map((call, index) => ({
        id: call.id ?? `cassette-call-${this.cursor}-${index}`,
        // Remap a recorded response-tool call onto the live response tool name (see above).
        name: call.name.startsWith('extract') && this.liveResponseToolName ? this.liveResponseToolName : call.name,
        args: call.args
      }))
    });
    return { generations: [{ message, text: typeof entry.content === 'string' ? entry.content : '' }] };
  }
}

/** ModelPort that replays a cassette. */
export function createReplayModelPort(cassette: ModelCassette): ModelPort {
  return {
    createModel: () => new RecordedCassetteModel(cassette.entries)
  };
}

function aiMessageToEntry(message: AIMessage): CassetteEntry {
  const toolCalls = (message.tool_calls ?? []).map((call) => ({
    id: call.id,
    name: call.name,
    args: (call.args ?? {}) as Record<string, unknown>
  }));
  const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
  return CassetteEntrySchema.parse({ content, toolCalls });
}

/**
 * A callback recorder: attach `recorder.handler` to a live `agent.invoke(..., { callbacks })` run,
 * then call `recorder.toCassette()` to serialize the captured turns. Captures every LLM turn (main
 * agent + subagents) in order.
 */
export function createCassetteRecorder(modelName = 'recorded'): {
  handler: BaseCallbackHandler;
  toCassette(): ModelCassette;
} {
  const entries: CassetteEntry[] = [];

  class CassetteRecorderHandler extends BaseCallbackHandler {
    name = 'h-eduware-cassette-recorder';

    handleLLMEnd(output: LLMResult) {
      for (const batch of output.generations ?? []) {
        for (const generation of batch) {
          const message = (generation as { message?: AIMessage }).message;
          if (message instanceof AIMessage) {
            entries.push(aiMessageToEntry(message));
          }
        }
      }
    }
  }

  return {
    handler: new CassetteRecorderHandler(),
    toCassette: () => ModelCassetteSchema.parse({ version: 1, model: modelName, entries })
  };
}

export async function loadCassette(path: string): Promise<ModelCassette> {
  const raw = await readFile(path, 'utf8');
  return ModelCassetteSchema.parse(JSON.parse(raw));
}

export async function saveCassette(path: string, cassette: ModelCassette): Promise<void> {
  await writeFile(path, `${JSON.stringify(ModelCassetteSchema.parse(cassette), null, 2)}\n`, 'utf8');
}

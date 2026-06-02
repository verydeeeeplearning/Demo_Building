import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createDeepAgent } from 'deepagents';
import { toolStrategy } from 'langchain';
import { z } from 'zod';
import { AIMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

import {
  CassetteExhaustedError,
  RecordedCassetteModel,
  createCassetteRecorder,
  createReplayModelPort,
  loadCassette,
  saveCassette
} from '../../server/agent/modelCassette.ts';

// A recording fake that emits the toolStrategy response tool on its first turn (it learns the
// dynamic `extract*` tool name from bindTools). Used to RECORD a cassette from a real agent run.
class RecordingFakeModel extends BaseChatModel<Record<string, unknown>> {
  responseToolName: string | null = null;
  _llmType() {
    return 'recording-fake-model';
  }
  bindTools(tools: Array<{ name?: string; function?: { name?: string } }>) {
    const names = tools.map((t) => t?.name ?? t?.function?.name ?? '');
    const resp = names.find((n) => n.startsWith('extract'));
    if (resp) this.responseToolName = resp;
    return this;
  }
  async _generate() {
    const name = this.responseToolName ?? 'extract';
    return {
      generations: [{ message: new AIMessage({ content: '', tool_calls: [{ id: 'r', name, args: { ok: true } }] }), text: '' }]
    };
  }
}

const responseFormat = z.object({ ok: z.boolean() });

void test('cassette record -> replay reproduces the same structured response through a real agent', async () => {
  // RECORD: run a real deep agent with the recording fake + recorder callback.
  const recordingModel = new RecordingFakeModel({});
  const recorder = createCassetteRecorder('test-model');
  const recordingAgent = createDeepAgent({
    model: recordingModel as unknown as BaseChatModel,
    tools: [],
    responseFormat: toolStrategy(responseFormat),
    systemPrompt: 'record',
    name: 'cassette-record-agent'
  });
  const recorded = (await recordingAgent.invoke(
    { messages: [{ role: 'user', content: 'hi' }] },
    { recursionLimit: 6, callbacks: [recorder.handler] }
  )) as { structuredResponse?: { ok?: boolean } };
  const cassette = recorder.toCassette();

  assert.ok(cassette.entries.length >= 1, 'recorder captured at least one model turn');
  assert.equal(recorded.structuredResponse?.ok, true);

  // REPLAY: a fresh agent backed by the cassette must reproduce the same structured response,
  // with no live model.
  const replayPort = createReplayModelPort(cassette);
  const replayAgent = createDeepAgent({
    model: replayPort.createModel() as unknown as BaseChatModel,
    tools: [],
    responseFormat: toolStrategy(responseFormat),
    systemPrompt: 'replay',
    name: 'cassette-replay-agent'
  });
  const replayed = (await replayAgent.invoke(
    { messages: [{ role: 'user', content: 'hi' }] },
    { recursionLimit: 6 }
  )) as { structuredResponse?: { ok?: boolean } };

  assert.equal(replayed.structuredResponse?.ok, true, 'replay reproduces the recorded structured response');
});

void test('RecordedCassetteModel replays in order and throws when exhausted', async () => {
  const model = new RecordedCassetteModel([
    { content: 'first', toolCalls: [] },
    { content: 'second', toolCalls: [] }
  ]);
  const a = await model._generate([]);
  const b = await model._generate([]);
  assert.equal((a.generations[0].message as AIMessage).content, 'first');
  assert.equal((b.generations[0].message as AIMessage).content, 'second');
  await assert.rejects(() => model._generate([]), CassetteExhaustedError);
});

void test('cassette save/load is a faithful round trip', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'h-eduware-cassette-'));
  try {
    const file = path.join(dir, 'cassette.json');
    const cassette = {
      version: 1 as const,
      model: 'round-trip',
      entries: [{ content: 'hello', toolCalls: [{ id: 'x', name: 'extract', args: { ok: true } }] }]
    };
    await saveCassette(file, cassette);
    const loaded = await loadCassette(file);
    assert.deepEqual(loaded, cassette);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test('cassette recorder captures AIMessage turns from handleLLMEnd', () => {
  const recorder = createCassetteRecorder();
  recorder.handler.handleLLMEnd?.(
    {
      generations: [[{ text: '', message: new AIMessage({ content: 'turn-1', tool_calls: [] }) } as never]],
      llmOutput: {}
    },
    'run-1'
  );
  const cassette = recorder.toCassette();
  assert.equal(cassette.entries.length, 1);
  assert.equal(cassette.entries[0].content, 'turn-1');
});

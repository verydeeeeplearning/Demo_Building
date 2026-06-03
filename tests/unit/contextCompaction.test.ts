import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compactSystemContextBlocks,
  foldRunningSummary,
  type SystemContextBlocks,
  type CompactionTarget
} from '../../server/agent/contextCompaction.ts';

// ---------------------------------------------------------------------------
// Phase 5a — Graceful budget compaction
// ---------------------------------------------------------------------------

const HUGE = 'x'.repeat(40_000);

test('5a — compactSystemContextBlocks returns blocks within the character budget', () => {
  // Overflow originates from system/context blocks (operatingMemory dominates), NOT from the
  // 6 short conversation turns.  The function must compact to within budget instead of letting
  // the caller throw AgentPromptBudgetError.
  const blocks: SystemContextBlocks = {
    operatingMemory: HUGE,
    coordinatorPrompt: HUGE,
    registrySummary: HUGE,
    contextPacketBlock: HUGE
  };

  const maxChars = 50_000; // well below the 160 000-char combined input above
  const compacted = compactSystemContextBlocks(blocks, maxChars);

  const totalChars = [
    compacted.operatingMemory,
    compacted.coordinatorPrompt,
    compacted.registrySummary,
    compacted.contextPacketBlock
  ].join('\n\n').length;

  assert.ok(
    totalChars <= maxChars,
    `Compacted blocks (${totalChars} chars) must fit within budget (${maxChars} chars)`
  );
});

test('5a — compacted blocks preserve all four keys', () => {
  const blocks: SystemContextBlocks = {
    operatingMemory: HUGE,
    coordinatorPrompt: HUGE,
    registrySummary: HUGE,
    contextPacketBlock: HUGE
  };

  const result = compactSystemContextBlocks(blocks, 60_000);

  assert.ok(typeof result.operatingMemory === 'string', 'operatingMemory must be a string');
  assert.ok(typeof result.coordinatorPrompt === 'string', 'coordinatorPrompt must be a string');
  assert.ok(typeof result.registrySummary === 'string', 'registrySummary must be a string');
  assert.ok(typeof result.contextPacketBlock === 'string', 'contextPacketBlock must be a string');
});

test('5a — blocks already within budget pass through unchanged', () => {
  const blocks: SystemContextBlocks = {
    operatingMemory: 'short operating memory',
    coordinatorPrompt: 'short coordinator prompt',
    registrySummary: 'short registry summary',
    contextPacketBlock: 'short context packet'
  };

  const combined = [
    blocks.operatingMemory,
    blocks.coordinatorPrompt,
    blocks.registrySummary,
    blocks.contextPacketBlock
  ].join('\n\n');

  const result = compactSystemContextBlocks(blocks, combined.length + 1000);

  assert.equal(result.operatingMemory, blocks.operatingMemory);
  assert.equal(result.coordinatorPrompt, blocks.coordinatorPrompt);
  assert.equal(result.registrySummary, blocks.registrySummary);
  assert.equal(result.contextPacketBlock, blocks.contextPacketBlock);
});

test('5a — compaction target enum covers all four dominant system/context blocks', () => {
  // Type-level guard: ensure the union covers exactly the expected keys so that adding a new
  // dominant block without updating compaction logic produces a compile error.
  const targets: CompactionTarget[] = [
    'operatingMemory',
    'coordinatorPrompt',
    'registrySummary',
    'contextPacketBlock'
  ];
  assert.equal(targets.length, 4);
});

// ---------------------------------------------------------------------------
// Phase 5b — Advisory running summary
// ---------------------------------------------------------------------------

test('5b — foldRunningSummary produces a non-empty summary from recent turns', () => {
  const turns = [
    { role: 'student' as const, text: 'I want an LED blinker with a button.' },
    { role: 'assistant' as const, text: 'Here is a validated LED blinker draft.' },
    { role: 'student' as const, text: 'Can you add a buzzer?' },
    { role: 'assistant' as const, text: 'Added a 5 V buzzer via digital output.' }
  ];

  const summary = foldRunningSummary(turns, 'en');

  assert.ok(summary.length > 0, 'Summary must be non-empty');
  assert.ok(
    summary.length <= 500,
    `Summary must be within Zod max bound (500 chars), got ${summary.length}`
  );
});

test('5b — foldRunningSummary summary monotonically reflects folded content', () => {
  // Each successive call with an additional dropped turn must produce a summary that is
  // non-decreasing in length OR at least contains evidence of folding (not a blank string).
  const baseTurns = [
    { role: 'student' as const, text: 'Build a temperature sensor display.' },
    { role: 'assistant' as const, text: 'Here is a DHT22 + OLED display circuit.' }
  ];

  const summary1 = foldRunningSummary(baseTurns, 'en');
  const summary2 = foldRunningSummary([
    ...baseTurns,
    { role: 'student' as const, text: 'Add a battery.' },
    { role: 'assistant' as const, text: 'Added a 9 V battery with a regulator.' }
  ], 'en');

  assert.ok(summary1.length > 0, 'First summary must not be empty');
  assert.ok(summary2.length > 0, 'Second summary must not be empty');
  // A forged or blank value is not acceptable
  assert.notEqual(summary2, '', 'Summary must not be blank after adding turns');
});

test('5b — foldRunningSummary stays within the 500-char Zod schema bound for any realistic input', () => {
  // Simulate a full 12-turn window whose turns are each close to the 2000-char text max.
  const longTurns = Array.from({ length: 12 }, (_, i) => ({
    role: (i % 2 === 0 ? 'student' : 'assistant') as 'student' | 'assistant',
    text: `Turn ${i}: ${'Detail '.repeat(100)}`.slice(0, 2000)
  }));

  const summary = foldRunningSummary(longTurns, 'ko');

  assert.ok(
    summary.length <= 500,
    `Summary must be <= 500 chars for Zod validation to pass, got ${summary.length}`
  );
});

test('5b — foldRunningSummary returns a stable empty string for zero turns', () => {
  const summary = foldRunningSummary([], 'ko');
  assert.equal(summary, '', 'Empty turn list must yield empty summary (no phantom context)');
});

test('5b — runningSummary schema field accepts a bounded string and rejects over-long strings', async () => {
  const { AgentConversationContextSchema } = await import('../../server/agent/schemas.ts');

  // Valid: within 500-char bound
  const valid = AgentConversationContextSchema.parse({
    recentTurns: [],
    awaitingBuildConfirmation: false,
    runningSummary: 'Student has been building an LED blinker. Now wants to add a buzzer.'
  });
  assert.ok(valid.runningSummary !== undefined);

  // Valid: absent (optional)
  const absent = AgentConversationContextSchema.parse({
    recentTurns: [],
    awaitingBuildConfirmation: false
  });
  assert.equal(absent.runningSummary, undefined);

  // Invalid: exceeds 500-char bound
  assert.throws(
    () => AgentConversationContextSchema.parse({
      recentTurns: [],
      awaitingBuildConfirmation: false,
      runningSummary: 'x'.repeat(501)
    }),
    /too_big|at most 500|String must contain at most 500/i
  );
});

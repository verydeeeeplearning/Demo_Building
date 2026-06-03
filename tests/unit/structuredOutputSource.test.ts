import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseLiveAgentDraft, toConciseStudentMessage } from '../../server/agent/deepAgentRuntime.ts';

// PLAN_sensible_simulation Phase 1 — Class A (raw JSON leak into chat).
// Empirical R6.5: providerStrategy populates structuredResponse reliably BUT also echoes the full
// JSON into the message text channel. So the student message must come from structuredResponse, and
// the text-channel recovery path must never surface a serialized draft verbatim.

void test('parseLiveAgentDraft prefers structuredResponse over a JSON-laden text channel', () => {
  const draft = parseLiveAgentDraft({
    structuredResponse: { responseKind: 'chat', assistantMessage: '안녕하세요!', circuitSpec: null },
    messages: [{ kwargs: { content: '{"responseKind":"chat","assistantMessage":"안녕하세요!","circuitSpec":null}', tool_calls: [] } }]
  });
  assert.equal(draft.responseKind, 'chat');
  assert.equal(draft.assistantMessage, '안녕하세요!');
});

void test('recovery unwraps a JSON-draft-as-text instead of surfacing the raw JSON (no structuredResponse)', () => {
  // The model emitted the full draft as plain text with no structured tool call (the exact live leak).
  // Recovery must unwrap the inner assistantMessage, NOT return the serialized blob as the chat reply.
  const draft = parseLiveAgentDraft({
    messages: [{ kwargs: { content: '{"responseKind":"chat","assistantMessage":"안녕! 무엇을 만들어볼까요?","circuitSpec":null}', tool_calls: [] } }]
  });
  assert.equal(draft.responseKind, 'chat');
  assert.equal(draft.assistantMessage, '안녕! 무엇을 만들어볼까요?');
  assert.doesNotMatch(draft.assistantMessage, /responseKind|circuitSpec|[{}]/);
});

void test('toConciseStudentMessage strips bare structural label prefixes (assistantMessage:/clarification:)', () => {
  const leaked = 'assistantMessage: 아두이노 D9에서 LED가 깜빡이도록 구성했어요. clarification: 다음 단계를 알려주세요.';
  const out = toConciseStudentMessage(leaked);
  assert.doesNotMatch(out, /assistantMessage|clarification/);
  assert.match(out, /깜빡이도록 구성했어요/);
  assert.match(out, /다음 단계를 알려주세요/);
});

void test('toConciseStudentMessage strips a single-line minified JSON blob', () => {
  const leaked = '{"responseKind":"circuit","assistantMessage":"버튼을 누르면 부저가 울려요.","circuitSpec":{"id":"x","title":"y"}}';
  const out = toConciseStudentMessage(leaked);
  assert.doesNotMatch(out, /responseKind|circuitSpec|^\s*\{/);
  // The human sentence inside should survive.
  assert.match(out, /부저가 울려요/);
});

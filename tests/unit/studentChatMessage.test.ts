import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toConciseStudentMessage } from '../../server/agent/deepAgentRuntime.ts';

// PLAN_react_routing_and_clean_chat Phase 4 — the chat bubble must carry only a short human message.
// The embedded CircuitSpec JSON, wiring table, and validation summary belong in the 3D scene + 문서
// tab, not the chat thread. toConciseStudentMessage strips them defensively (the prompt also tells the
// model not to emit them).

void test('strips a fenced CircuitSpec JSON block from the chat message', () => {
  const raw = [
    '다음 회로는 검증 가능한 준비 완료 초안입니다.',
    '```json',
    '{ "id": "oled_blink", "components": [{ "id": "u1" }], "connections": [] }',
    '```',
    '원하면 다음 단계로 이어서 코드도 만들어드릴게요.'
  ].join('\n');

  const out = toConciseStudentMessage(raw);
  assert.ok(!out.includes('```'), 'no code fences remain');
  assert.ok(!out.includes('"components"'), 'no raw JSON keys remain');
  assert.match(out, /검증 가능한 준비 완료 초안/, 'human preamble is preserved');
  assert.match(out, /다음 단계/, 'next-step offer is preserved');
});

void test('strips the 배선 요약 / 검증 결과 요약 detail sections', () => {
  const raw = [
    '간단한 LED 깜빡임 회로를 만들었어요.',
    '**배선 요약**',
    '- Arduino 5V → OLED VCC',
    '- Arduino GND → OLED GND',
    '**검증 결과 요약**',
    '- 상태: valid'
  ].join('\n');

  const out = toConciseStudentMessage(raw);
  assert.match(out, /LED 깜빡임 회로를 만들었어요/, 'human sentence kept');
  assert.ok(!out.includes('배선 요약'), 'wiring summary header removed');
  assert.ok(!out.includes('검증 결과 요약'), 'validation summary header removed');
  assert.ok(!out.includes('OLED VCC'), 'wiring detail removed');
});

void test('leaves an already-concise message unchanged', () => {
  const clean = '안녕하세요! 어떤 회로를 만들어볼까요? 입력과 출력을 한 줄로 알려 주세요.';
  assert.equal(toConciseStudentMessage(clean), clean);
});

void test('is idempotent', () => {
  const raw = '회로를 만들었어요. ```json\n{"components":[]}\n``` 끝.';
  const once = toConciseStudentMessage(raw);
  assert.equal(toConciseStudentMessage(once), once);
});

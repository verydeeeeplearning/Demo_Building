import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractAssistantProse } from '../../server/agent/assistantMessageProse.ts';

test('plain prose passes through unchanged', () => {
  const msg = '버튼을 누르면 D13 LED가 켜지는 회로 초안입니다. 220Ω 저항을 직렬로 넣었어요.';
  assert.equal(extractAssistantProse(msg), msg);
});

test('extracts assistantMessage field from a raw JSON object dump', () => {
  // Regression: the agent sometimes returns its whole structured draft as a text message; only the
  // assistantMessage prose should reach the chat — not components/connections/agentEvents.
  const blob = JSON.stringify({
    assistantMessage: '검증 가능한 회로 초안을 만들었습니다. D2 버튼으로 D13 LED를 켭니다.',
    components: [{ id: 'arduino-uno' }],
    connections: [{ from: 'D2' }],
    agentEvents: [{ type: 'validation', name: 'validate_circuit_spec' }]
  });
  assert.equal(
    extractAssistantProse(blob),
    '검증 가능한 회로 초안을 만들었습니다. D2 버튼으로 D13 LED를 켭니다.'
  );
});

test('extracts assistantMessage from a ```json fenced object', () => {
  const fenced =
    '```json\n{"assistantMessage": "OLED에 텍스트를 표시하는 회로입니다.", "components": []}\n```';
  assert.equal(extractAssistantProse(fenced), 'OLED에 텍스트를 표시하는 회로입니다.');
});

test('extracts the ### assistantMessage markdown section, dropping later sections', () => {
  const sectioned =
    '검증 완료된 회로 초안입니다. ### assistantMessage Arduino Uno D8 → 220Ω → LED 로 연결하면 됩니다. ### clarification 없음 ### 회로 초안 ```json {"id":"x"}```';
  assert.equal(extractAssistantProse(sectioned), 'Arduino Uno D8 → 220Ω → LED 로 연결하면 됩니다.');
});

test('extracts labeled plain-text form (assistantMessage: ... clarification: ... 회로 초안: {})', () => {
  // The exact leak shape observed live: the model emits its fields as Korean labels (no #, no
  // quotes), followed by the circuit-draft JSON. Only the assistantMessage prose should survive —
  // and "검증된 회로 초안입니다" must NOT be truncated at its own "회로 초안" (no colon there).
  const labeled =
    'assistantMessage: 검증된 회로 초안입니다. 버튼을 누르면 LED가 켜지도록 했고, 버튼 입력은 ' +
    '아두이노 내부 풀업을 사용합니다. LED는 220Ω 저항을 직렬로 넣어 안전하게 구동합니다. ' +
    'clarification: 없음 회로 초안: { "id": "button-led-basic", "components": [ { "id": "u1" } ] }';
  assert.equal(
    extractAssistantProse(labeled),
    '검증된 회로 초안입니다. 버튼을 누르면 LED가 켜지도록 했고, 버튼 입력은 아두이노 내부 풀업을 사용합니다. LED는 220Ω 저항을 직렬로 넣어 안전하게 구동합니다.'
  );
});

test('labeled form terminates at the circuit-draft JSON when no clarification label is present', () => {
  const labeled =
    'assistantMessage: OLED에 텍스트를 표시합니다. { "id": "oled", "components": [] }';
  assert.equal(extractAssistantProse(labeled), 'OLED에 텍스트를 표시합니다.');
});

test('recovers the assistantMessage even from truncated JSON', () => {
  const truncated =
    '{"assistantMessage": "회로 초안을 만들었습니다.", "components": [{"id": "arduino-un';
  assert.equal(extractAssistantProse(truncated), '회로 초안을 만들었습니다.');
});

test('unescapes JSON string escapes in the extracted field', () => {
  const blob = '{"assistantMessage": "줄바꿈\\n과 \\"따옴표\\"가 포함된 메시지", "components": []}';
  assert.equal(extractAssistantProse(blob), '줄바꿈\n과 "따옴표"가 포함된 메시지');
});

test('empty input returns empty', () => {
  assert.equal(extractAssistantProse(''), '');
});

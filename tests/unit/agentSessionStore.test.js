import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadAgentSession, saveAgentSession, clearAgentSession } from '../../src/agentSessionStore.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    _dump: () => Object.fromEntries(map)
  };
}

void test('save then load round-trips the session id and turns', () => {
  const storage = memoryStorage();
  saveAgentSession(storage, {
    sessionId: 'session-abc',
    messages: [
      { role: 'student', text: '온습도센서 OLED에 표시' },
      { role: 'assistant', text: '온습도 회로를 만들어 드릴게요.' }
    ]
  });

  const restored = loadAgentSession(storage);
  assert.equal(restored.sessionId, 'session-abc');
  assert.equal(restored.messages.length, 2);
  assert.deepEqual(restored.messages[0], { role: 'student', text: '온습도센서 OLED에 표시' });
});

void test('save keeps only the last 12 turns and caps turn length', () => {
  const storage = memoryStorage();
  const messages = Array.from({ length: 20 }, (_v, i) => ({ role: 'student', text: `t${i}` }));
  messages.push({ role: 'assistant', text: 'x'.repeat(5000) });
  saveAgentSession(storage, { sessionId: 's', messages });

  const restored = loadAgentSession(storage);
  assert.equal(restored.messages.length, 12);
  assert.ok(restored.messages.at(-1).text.length <= 2000, 'oversized turn is truncated');
});

void test('save is a no-op without a session id', () => {
  const storage = memoryStorage();
  saveAgentSession(storage, { sessionId: '', messages: [{ role: 'student', text: 'hi' }] });
  assert.equal(loadAgentSession(storage), null);
});

void test('load returns null for missing, malformed, or session-less data', () => {
  assert.equal(loadAgentSession(memoryStorage()), null);
  assert.equal(loadAgentSession(memoryStorage({ hEduwareAgentSession: 'not json' })), null);
  assert.equal(loadAgentSession(memoryStorage({ hEduwareAgentSession: '{"messages":[]}' })), null);
});

void test('load drops malformed turns but keeps the session id', () => {
  const storage = memoryStorage({
    hEduwareAgentSession: JSON.stringify({
      sessionId: 's1',
      messages: [{ role: 'student', text: 'ok' }, { role: 'bogus', text: 'x' }, { text: 'no role' }, null]
    })
  });
  const restored = loadAgentSession(storage);
  assert.equal(restored.sessionId, 's1');
  assert.deepEqual(restored.messages, [{ role: 'student', text: 'ok' }]);
});

void test('clearAgentSession removes the persisted thread', () => {
  const storage = memoryStorage();
  saveAgentSession(storage, { sessionId: 's', messages: [{ role: 'student', text: 'hi' }] });
  clearAgentSession(storage);
  assert.equal(loadAgentSession(storage), null);
});

void test('storage failures are swallowed (graceful degradation)', () => {
  const throwing = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('quota'); },
    removeItem: () => { throw new Error('blocked'); }
  };
  assert.equal(loadAgentSession(throwing), null);
  assert.doesNotThrow(() => saveAgentSession(throwing, { sessionId: 's', messages: [] }));
  assert.doesNotThrow(() => clearAgentSession(throwing));
});

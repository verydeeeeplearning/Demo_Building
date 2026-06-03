// Per-tab durability for the agent conversation thread. The server is stateless and the agent
// session id + recent turns live only in memory, so a page reload would otherwise start a brand-new
// thread. We persist the minimum needed to keep continuity — the session id and the last turns —
// to a Storage (sessionStorage in the app; an injectable shim in tests). Best-effort: any storage
// failure (private mode, quota, disabled) degrades gracefully to today's in-memory-only behaviour.

const STORAGE_KEY = 'hEduwareAgentSession';
const MAX_TURNS = 12;
const MAX_TURN_CHARS = 2000;

function isTurn(value) {
  return Boolean(value) && typeof value.text === 'string'
    && (value.role === 'assistant' || value.role === 'student' || value.role === 'user');
}

export function loadAgentSession(storage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const data = JSON.parse(raw);
    if (!data || typeof data.sessionId !== 'string' || data.sessionId.length === 0) {
      return null;
    }
    const messages = Array.isArray(data.messages) ? data.messages.filter(isTurn) : [];
    return { sessionId: data.sessionId, messages };
  } catch {
    return null;
  }
}

export function saveAgentSession(storage, { sessionId, messages } = {}) {
  if (!storage || !sessionId) {
    return;
  }
  try {
    const trimmed = (Array.isArray(messages) ? messages : [])
      .filter(isTurn)
      .slice(-MAX_TURNS)
      .map((message) => ({ role: message.role, text: String(message.text).slice(0, MAX_TURN_CHARS) }));
    storage.setItem(STORAGE_KEY, JSON.stringify({ sessionId, messages: trimmed }));
  } catch {
    // Best-effort cache; losing it only means no cross-reload continuity this time.
  }
}

export function clearAgentSession(storage) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// Per-tab durability for the agent conversation thread. The server is stateless and the agent
// session id + recent turns live only in memory, so a page reload would otherwise start a brand-new
// thread. We persist the minimum needed to keep continuity — the session id and the last turns —
// to a Storage (sessionStorage in the app; an injectable shim in tests). Best-effort: any storage
// failure (private mode, quota, disabled) degrades gracefully to today's in-memory-only behaviour.

const STORAGE_KEY = 'hEduwareAgentSession';
const MAX_TURNS = 12;
const MAX_TURN_CHARS = 2000;
const MAX_PENDING_OPTIONS = 12;

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
    return {
      sessionId: data.sessionId,
      activeTaskId: typeof data.activeTaskId === 'string' ? data.activeTaskId : null,
      pendingClarification: normalizePendingClarification(data.pendingClarification),
      artifactVersion: Number.isFinite(data.artifactVersion) ? data.artifactVersion : 0,
      messages
    };
  } catch {
    return null;
  }
}

export function saveAgentSession(storage, { sessionId, activeTaskId, pendingClarification, artifactVersion, messages } = {}) {
  if (!storage || !sessionId) {
    return;
  }
  try {
    const trimmed = (Array.isArray(messages) ? messages : [])
      .filter(isTurn)
      .slice(-MAX_TURNS)
      .map((message) => ({ role: message.role, text: String(message.text).slice(0, MAX_TURN_CHARS) }));
    storage.setItem(STORAGE_KEY, JSON.stringify({
      sessionId,
      activeTaskId: typeof activeTaskId === 'string' ? activeTaskId : undefined,
      pendingClarification: normalizePendingClarification(pendingClarification),
      artifactVersion: Number.isFinite(artifactVersion) ? artifactVersion : 0,
      messages: trimmed
    }));
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

function normalizePendingClarification(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const request = value.request;
  if (!request || typeof request !== 'object' || typeof request.interactionId !== 'string') {
    return null;
  }
  const options = Array.isArray(request.options)
    ? request.options
      .filter((option) => option && typeof option.id === 'string' && typeof option.label === 'string')
      .slice(0, MAX_PENDING_OPTIONS)
      .map((option) => ({
        id: option.id.slice(0, 200),
        label: option.label.slice(0, 200),
        ...(typeof option.capabilityId === 'string' ? { capabilityId: option.capabilityId.slice(0, 200) } : {})
      }))
    : [];
  return {
    taskId: typeof value.taskId === 'string' ? value.taskId : null,
    turnId: typeof value.turnId === 'string' ? value.turnId : null,
    request: {
      interactionId: request.interactionId.slice(0, 200),
      level: typeof request.level === 'string' ? request.level.slice(0, 100) : '',
      question: typeof request.question === 'string' ? request.question.slice(0, 500) : '',
      options
    }
  };
}

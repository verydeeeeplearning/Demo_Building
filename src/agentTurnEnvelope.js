const CLIENT_ID_PATTERN = /^[a-z]+-[A-Za-z0-9_-]{8,80}$/;

export function createClientId(prefix) {
  const safePrefix = String(prefix || 'id').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'id';
  const random = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${safePrefix}-${random.replace(/[^A-Za-z0-9_-]/g, '')}`;
}

export function isValidClientId(value) {
  return typeof value === 'string' && CLIENT_ID_PATTERN.test(value);
}

export function normalizeClientId(value, prefix) {
  return isValidClientId(value) ? value : createClientId(prefix);
}

export function classifyAgentRequestKind(route, context = {}) {
  if (context.resume) {
    return 'resume_clarification';
  }
  if (route === 'revise-current-draft') {
    return 'revise_current_artifact';
  }
  if (route === 'general-chat') {
    return 'general_chat';
  }
  if (context.hasCurrentArtifact || context.hasPendingSynthesisTurn) {
    return 'new_task';
  }
  return 'initial_task';
}

export function isStaleAgentTurnResult(pendingTurn, envelope, response = {}) {
  if (!pendingTurn || !envelope) {
    return true;
  }
  if (pendingTurn.turnId !== envelope.turnId || pendingTurn.taskId !== envelope.taskId) {
    return true;
  }
  if (response.turnId && response.turnId !== envelope.turnId) {
    return true;
  }
  if (response.taskId && response.taskId !== envelope.taskId) {
    return true;
  }
  return false;
}

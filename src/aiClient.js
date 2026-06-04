const DEFAULT_AGENT_API_BASE = 'http://127.0.0.1:8787';

export class AgentApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'AgentApiError';
    this.status = details.status;
    this.payload = details.payload;
    this.code = details.code;
    this.cause = details.cause;
  }
}

export async function getAiRuntimeMode() {
  try {
    const health = await getAgentHealth();

    return {
      mode: health.defaultMode || 'deepagents-live',
      ok: Boolean(health.ok),
      hasServerKey: Boolean(health.hasServerKey),
      model: health.model || null,
      provider: health.provider || 'openai',
      requiredEnv: health.requiredEnv || [],
      serverStartedAt: health.serverStartedAt || null,
      serverUptimeMs: Number.isFinite(health.serverUptimeMs) ? health.serverUptimeMs : null,
      sourceStatus: health.sourceStatus || null
    };
  } catch (error) {
    return {
      mode: 'agent-server-offline',
      ok: false,
      hasServerKey: false,
      model: null,
      provider: 'openai',
      requiredEnv: ['OPENAI_API_KEY', 'H_EDUWARE_AGENT_MODEL'],
      serverStartedAt: null,
      serverUptimeMs: null,
      sourceStatus: null
    };
  }
}

export async function sendAgentMessage({
  sessionId,
  taskId,
  turnId,
  requestKind,
  resumeInteractionId,
  message,
  resume,
  confirmation,
  locale,
  conversationContext,
  signal
}) {
  const health = await getAgentHealth({ signal });
  if (!health.ok) {
    throw new AgentApiError(
      `Deepagents live server is not configured. Missing: ${(health.requiredEnv || []).join(', ') || 'server configuration'}`
    );
  }

  const body = {
    message,
    locale,
    mode: 'live'
  };
  if (sessionId) body.sessionId = sessionId;
  if (taskId) body.taskId = taskId;
  if (turnId) body.turnId = turnId;
  if (requestKind) body.requestKind = requestKind;
  if (resumeInteractionId) body.resumeInteractionId = resumeInteractionId;
  if (resume) body.resume = resume;
  if (confirmation) body.confirmation = confirmation;
  if (conversationContext) body.conversationContext = conversationContext;

  return fetchJson('/api/agent/message', {
    method: 'POST',
    body,
    timeoutMs: 90000,
    signal
  });
}

export async function resolvePlacementIntent(intent) {
  return fetchJson('/api/agent/placement', {
    method: 'POST',
    body: intent,
    timeoutMs: 15000
  });
}

async function getAgentHealth({ signal } = {}) {
  return fetchJson('/api/agent/health', {
    method: 'GET',
    timeoutMs: 1200,
    signal
  });
}

async function fetchJson(path, { method, body, timeoutMs, signal }) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortListener = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener('abort', abortListener, { once: true });
    }
  }

  try {
    const response = await fetch(`${agentApiBase()}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new AgentApiError(payload.error || `Agent API returned ${response.status}`, {
        status: response.status,
        payload
      });
    }

    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new AgentApiError(timedOut ? 'Agent API request timed out.' : 'Agent API request was cancelled.', {
        code: timedOut ? 'AGENT_REQUEST_TIMEOUT' : 'AGENT_REQUEST_CANCELLED',
        cause: error
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.('abort', abortListener);
  }
}

function agentApiBase() {
  const storage = globalThis.localStorage;
  const override =
    typeof storage?.getItem === 'function' ? storage.getItem('hEduwareAgentApiBase') : null;
  if (override) {
    return override;
  }
  // Production build is served same-origin by the agent server, so call the API
  // via relative `/api/...` paths. Only local dev talks to the standalone server.
  if (import.meta.env?.PROD) {
    return '';
  }
  return DEFAULT_AGENT_API_BASE;
}

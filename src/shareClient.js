const DEFAULT_AGENT_API_BASE = 'http://127.0.0.1:8787';

export class ShareClientError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ShareClientError';
    this.status = details.status;
    this.payload = details.payload;
  }
}

export async function createPublicShare(snapshot, options = {}) {
  return fetchShareJson('/api/share/projects', {
    method: 'POST',
    body: { snapshot },
    timeoutMs: options.timeoutMs ?? 5000,
    fetchImpl: options.fetchImpl
  });
}

export async function readPublicShare(shareId, options = {}) {
  const response = await fetchShareJson(`/api/share/projects/${encodeURIComponent(shareId)}`, {
    method: 'GET',
    timeoutMs: options.timeoutMs ?? 5000,
    fetchImpl: options.fetchImpl
  });
  return response.snapshot;
}

async function fetchShareJson(path, { method, body, timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const fetchFn = fetchImpl || fetch;

  try {
    const response = await fetchFn(`${agentApiBase()}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new ShareClientError(payload.error || `Share API returned ${response.status}`, {
        status: response.status,
        payload
      });
    }

    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new ShareClientError('Share API request timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
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

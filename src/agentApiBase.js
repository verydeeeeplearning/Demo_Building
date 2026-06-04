const DEFAULT_AGENT_API_BASE = 'http://127.0.0.1:8787';

export function agentApiBase(storage = globalThis.localStorage) {
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

export function agentApiUrl(path, storage = globalThis.localStorage) {
  return `${agentApiBase(storage)}${path}`;
}

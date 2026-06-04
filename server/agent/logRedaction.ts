export function redactSensitiveLogText(value: string | undefined) {
  if (!value) {
    return value;
  }
  return value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted-api-key]')
    .replace(/\b(OPENAI_API_KEY|LANGSMITH_API_KEY|H_EDUWARE_AGENT_MODEL)\b\s*[:=]\s*[^,\s)]+/gi, '[redacted-config]=[redacted]')
    .replace(/\b(OPENAI_API_KEY|LANGSMITH_API_KEY|H_EDUWARE_AGENT_MODEL)\b/gi, '[redacted-config]')
    .replace(/api[_-]?key\s*[:=]\s*[^,\s)]+/gi, 'api_key=[redacted]');
}

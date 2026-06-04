export function redactSensitiveLogText(value: string | undefined) {
  if (!value) {
    return value;
  }
  return value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted-api-key]')
    .replace(/(OPENAI_API_KEY|LANGSMITH_API_KEY|api[_-]?key)\s*[:=]\s*[^,\s)]+/gi, '$1=[redacted]');
}

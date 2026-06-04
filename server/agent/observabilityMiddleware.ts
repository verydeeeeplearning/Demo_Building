import { createMiddleware } from 'langchain';
import { createHash } from 'node:crypto';
import { redactSensitiveLogText } from './logRedaction.ts';

export type ObservabilityEvent = {
  tool: string;
  status: 'ok' | 'error';
  error?: string;
  durationMs: number;
  inputHash: string;
  inputChars: number;
  outputHash?: string;
  outputChars?: number;
};

/**
 * Creates a LangChain middleware that wraps tool calls and emits structured
 * observability events via the provided callback.  Designed for the synthesis
 * deep agent under pipeline flag (shadow|next). The callback receives one event
 * per tool call: { tool, status: 'ok' } on success, { tool, status: 'error',
 * error } on failure.  The callback is injectable so the middleware is fully
 * testable without globals or live logging.
 */
export function createObservabilityMiddleware(
  onEvent: (event: ObservabilityEvent) => void
) {
  return createMiddleware({
    name: 'ObservabilityMiddleware',
    wrapToolCall: async (request, handler) => {
      const rawName = (request.toolCall as { name?: unknown }).name;
      const toolName = typeof rawName === 'string' && rawName.length > 0 ? rawName : '(unknown)';
      const startedAt = performance.now();
      const inputText = stableJson((request.toolCall as { args?: unknown }).args ?? null);
      try {
        const result = await handler(request);
        const outputText = stableJson(result);
        onEvent({
          tool: toolName,
          status: 'ok',
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          inputHash: stableHash(inputText),
          inputChars: inputText.length,
          outputHash: stableHash(outputText),
          outputChars: outputText.length
        });
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        onEvent({
          tool: toolName,
          status: 'error',
          error: redactSensitiveLogText(message),
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          inputHash: stableHash(inputText),
          inputChars: inputText.length
        });
        throw err;
      }
    }
  });
}

function stableHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown) {
  try {
    return JSON.stringify(sortForStableJson(value));
  } catch {
    return String(value);
  }
}

function sortForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForStableJson);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortForStableJson(entry)])
  );
}

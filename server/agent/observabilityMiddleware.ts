import { createMiddleware } from 'langchain';

export type ObservabilityEvent = {
  tool: string;
  status: 'ok' | 'error';
  error?: string;
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
      try {
        const result = await handler(request);
        onEvent({ tool: toolName, status: 'ok' });
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        onEvent({ tool: toolName, status: 'error', error: message });
        throw err;
      }
    }
  });
}

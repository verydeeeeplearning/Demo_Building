import {
  AgentConfigurationError,
  AgentStructuredOutputError
} from './deepAgentRuntime.ts';

export function mapAgentErrorToResponse(error: unknown) {
  if (error instanceof AgentStructuredOutputError) {
    return {
      status: 502,
      body: {
        errorCode: error.errorCode,
        error: 'The agent returned an incomplete circuit plan. Please retry with the current circuit context.',
        retryable: true
      }
    };
  }

  if (error instanceof AgentConfigurationError) {
    return {
      status: 503,
      body: {
        errorCode: 'AGENT_CONFIGURATION_REQUIRED',
        error: 'The live agent server is not configured.',
        retryable: false
      }
    };
  }

  const message = error instanceof Error ? error.message : 'Unknown server error';
  return {
    status: 400,
    body: {
      error: message,
      retryable: false
    }
  };
}

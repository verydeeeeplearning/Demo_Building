import {
  AgentConfigurationError,
  AgentPromptBudgetError,
  AgentStructuredOutputError
} from './deepAgentRuntime.ts';
import {
  AgentThreadBusyError,
  StaleAgentResumeError
} from './agentThreadSession.ts';

export function mapAgentErrorToResponse(error: unknown) {
  if (error instanceof AgentThreadBusyError || error instanceof StaleAgentResumeError) {
    return {
      status: error.status,
      body: {
        errorCode: error.errorCode,
        error: error.message,
        retryable: true
      }
    };
  }

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

  if (error instanceof AgentPromptBudgetError) {
    return {
      status: 413,
      body: {
        errorCode: error.errorCode,
        error: `The agent prompt exceeded its route budget during ${error.stage}.`,
        stage: error.stage,
        actualChars: error.actualChars,
        maxChars: error.maxChars,
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

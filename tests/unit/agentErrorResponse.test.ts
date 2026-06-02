import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentConfigurationError,
  AgentPromptBudgetError,
  AgentStructuredOutputError
} from '../../server/agent/deepAgentRuntime.ts';
import { mapAgentErrorToResponse } from '../../server/agent/errorResponse.ts';

test('structured output errors return a safe retryable response contract', () => {
  const mapped = mapAgentErrorToResponse(new AgentStructuredOutputError());

  assert.equal(mapped.status, 502);
  assert.equal(mapped.body.errorCode, 'AGENT_STRUCTURED_OUTPUT_MISSING');
  assert.equal(mapped.body.retryable, true);
  assert.doesNotMatch(mapped.body.error, /Deepagents did not return|structured circuit draft/i);
});

test('configuration errors keep their setup status without exposing secrets', () => {
  const mapped = mapAgentErrorToResponse(new AgentConfigurationError('Missing OPENAI_API_KEY'));

  assert.equal(mapped.status, 503);
  assert.equal(mapped.body.errorCode, 'AGENT_CONFIGURATION_REQUIRED');
  assert.equal(mapped.body.retryable, false);
  assert.doesNotMatch(mapped.body.error, /OPENAI_API_KEY|sk-/i);
});

test('prompt budget errors expose route budget metadata without retrying', () => {
  const mapped = mapAgentErrorToResponse(new AgentPromptBudgetError('synthesis', 12001, 12000));

  assert.equal(mapped.status, 413);
  assert.equal(mapped.body.errorCode, 'AGENT_PROMPT_BUDGET_EXCEEDED');
  assert.equal(mapped.body.stage, 'synthesis');
  assert.equal(mapped.body.actualChars, 12001);
  assert.equal(mapped.body.maxChars, 12000);
  assert.equal(mapped.body.retryable, false);
});

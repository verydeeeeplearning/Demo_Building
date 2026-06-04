import assert from 'node:assert/strict';
import test from 'node:test';

import { agentErrorMessage } from '../../src/agentErrorMessages.js';

test('structured Deepagents output errors are converted to a Korean recovery message', () => {
  const message = agentErrorMessage(
    new Error('Deepagents did not return a structured circuit draft.'),
    'ko'
  );

  assert.match(message, /회로|초안|다시/i);
  assert.doesNotMatch(message, /Deepagents did not return|structured circuit draft/i);
});

test('structured error code from API payload is hidden from students', () => {
  const error = new Error('Deepagents did not return a structured circuit draft.');
  error.payload = {
    errorCode: 'AGENT_STRUCTURED_OUTPUT_MISSING',
    error: 'Deepagents did not return a structured circuit draft.'
  };

  const message = agentErrorMessage(error, 'ko');

  assert.match(message, /회로|초안|다시/i);
  assert.doesNotMatch(message, /AGENT_STRUCTURED_OUTPUT_MISSING|Deepagents did not return/i);
});

test('unsafe high-voltage requests get a safety fallback even when structured output fails', () => {
  const error = new Error('Deepagents did not return a structured circuit draft.');
  error.payload = {
    errorCode: 'AGENT_STRUCTURED_OUTPUT_MISSING',
    error: 'Deepagents did not return a structured circuit draft.'
  };

  const message = agentErrorMessage(error, 'ko', {
    studentMessage: '220V 콘센트에 직접 연결해서 LED 켜고 싶어'
  });

  assert.match(message, /고전압|감전|화재|저전압|Arduino 5V/i);
  assert.doesNotMatch(message, /Deepagents did not return|structured circuit draft/i);
});

test('configuration errors explain server setup without leaking raw internals', () => {
  const message = agentErrorMessage(
    new Error('Live Deepagents runtime is not configured. Missing: OPENAI_API_KEY, H_EDUWARE_AGENT_MODEL'),
    'ko'
  );

  assert.match(message, /서버|설정/i);
  assert.doesNotMatch(message, /sk-|runtime is not configured/i);
});

test('English error mapping also hides structured-output implementation details', () => {
  const message = agentErrorMessage(
    new Error('Deepagents did not return a structured circuit draft.'),
    'en'
  );

  assert.match(message, /circuit draft|try again/i);
  assert.doesNotMatch(message, /Deepagents did not return|structured circuit draft/i);
});

test('busy thread errors keep the current circuit visible guidance', () => {
  const error = new Error('busy');
  error.payload = { errorCode: 'AGENT_THREAD_BUSY' };

  const message = agentErrorMessage(error, 'en');

  assert.match(message, /still processing/i);
  assert.match(message, /current circuit visible/i);
});

test('stale resume errors explain that the old clarification expired', () => {
  const error = new Error('stale');
  error.payload = { errorCode: 'STALE_AGENT_RESUME' };

  const message = agentErrorMessage(error, 'en');

  assert.match(message, /older task/i);
  assert.match(message, /choose again/i);
});

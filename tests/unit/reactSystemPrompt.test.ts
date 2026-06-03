import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildSystemPrompt } from '../../server/agent/deepAgentRuntime.ts';

// PLAN_react_routing_and_clean_chat Phase 2 — the synthesis system prompt teaches the ReAct decision
// (chat / recommend / clarify / build) and points the agent at the assess_request_scope authority,
// while preserving the existing safety/grounding rules.

const prompt = buildSystemPrompt({
  locale: 'ko',
  operatingMemory: '<<OPERATING_MEMORY>>',
  coordinatorPrompt: '<<COORDINATOR>>',
  registrySummary: '<<REGISTRY_SUMMARY>>',
  contextPacketBlock: '<<CONTEXT_PACKET_BLOCK>>'
});

void test('the prompt states the chat vs circuit decision contract', () => {
  assert.match(prompt, /responseKind="chat"/);
  assert.match(prompt, /responseKind="circuit"/);
  assert.match(prompt, /circuitSpec=null/);
  assert.match(prompt, /recommend/i, 'tells the agent to recommend buildable options');
  assert.match(prompt, /clarif/i, 'tells the agent it may ask one clarification');
  assert.match(prompt, /Never fabricate a circuit/i);
});

void test('the prompt points the agent at the assess_request_scope authority tool', () => {
  assert.match(prompt, /assess_request_scope/);
});

void test('the prompt preserves the safety + grounding rules', () => {
  assert.match(prompt, /safe, low-voltage/i);
  assert.match(prompt, /Do not invent parts, pins, protocols/i);
  assert.ok(prompt.includes('<<CONTEXT_PACKET_BLOCK>>'), 'context packet block is embedded');
  assert.ok(prompt.includes('<<REGISTRY_SUMMARY>>'), 'registry summary is embedded');
  assert.ok(prompt.includes('<<COORDINATOR>>') && prompt.includes('<<OPERATING_MEMORY>>'), 'coordinator + operating memory retained');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agentEventsToDecisions,
  decisionsForResult,
  isInternalToolEvent,
  studentFacingEventSummary
} from '../../src/agentDecisions.js';

// PLAN_react_routing_and_clean_chat Phase 5 — the decision panel shows a few clean steps, never the
// raw tool trace (validate_circuit_spec / detect_faults / build_netlist / estimate_current_paths) and
// never duplicate rows. A chat reply shows no decisions at all.

const TOOL_TRACE_EVENTS = [
  { type: 'coordinator', name: 'deepagents-coordinator', status: 'completed', summary: 'Created structured circuit draft through Deepagents.' },
  { type: 'coordinator', name: 'requirement-analysis-agent', status: 'completed', summary: 'synthesize_circuit: OLED에 깜빡이는 표시를 만드는 회로.' },
  { type: 'tool', name: 'validate_circuit_spec', status: 'completed', summary: 'ok' },
  { type: 'tool', name: 'detect_faults', status: 'completed', summary: 'ok' },
  { type: 'tool', name: 'build_netlist', status: 'completed', summary: 'ok' },
  { type: 'tool', name: 'estimate_current_paths', status: 'completed', summary: 'ok' },
  { type: 'validation', name: 'server-validator', status: 'completed', summary: 'valid' }
];

test('internal tool-call events are flagged', () => {
  assert.equal(isInternalToolEvent({ type: 'tool', name: 'build_netlist' }), true);
  assert.equal(isInternalToolEvent({ type: 'validation', name: 'estimate_current_paths' }), true, 'matched by name too');
  assert.equal(isInternalToolEvent({ type: 'coordinator', name: 'deepagents-coordinator' }), false);
  assert.equal(isInternalToolEvent({ type: 'validation', name: 'server-validator' }), false);
});

test('raw tool-trace events never appear as student decisions', () => {
  const decisions = agentEventsToDecisions(TOOL_TRACE_EVENTS, 'ko');
  const ids = decisions.map((d) => d.id);
  for (const toolName of ['validate_circuit_spec', 'detect_faults', 'build_netlist', 'estimate_current_paths']) {
    assert.ok(!ids.includes(toolName), `${toolName} must not be a decision row`);
  }
});

test('duplicate decision labels are collapsed', () => {
  const decisions = agentEventsToDecisions(TOOL_TRACE_EVENTS, 'ko');
  const labels = decisions.map((d) => d.label);
  const unique = new Set(labels);
  assert.equal(labels.length, unique.size, 'no duplicate "요청 정리" rows');
  // The two coordinator events collapse into a single clean "요청 정리" row.
  assert.equal(labels.filter((l) => l === '요청 정리').length, 1);
});

test('internal route labels never leak into a decision value', () => {
  const value = studentFacingEventSummary('synthesize_circuit: OLED에 깜빡이는 표시.', 'ko');
  assert.ok(!value.includes('synthesize_circuit'), 'route label is replaced with friendly text');
});

test('a genuine validation step still surfaces with a clean label', () => {
  const decisions = agentEventsToDecisions(TOOL_TRACE_EVENTS, 'ko');
  assert.ok(decisions.some((d) => d.label === '회로 검토'), 'server validation surfaces as a circuit review');
});

test('a chat reply produces no decisions', () => {
  const chat = { responseKind: 'chat', agentEvents: [{ type: 'coordinator', name: 'deepagents-coordinator', status: 'completed', summary: 'x' }] };
  assert.deepEqual(decisionsForResult(chat, 'ko'), []);
});

test('a circuit result maps its events to decisions', () => {
  const circuit = { responseKind: 'circuit', agentEvents: TOOL_TRACE_EVENTS };
  assert.ok(decisionsForResult(circuit, 'ko').length > 0);
});

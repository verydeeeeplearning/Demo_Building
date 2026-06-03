import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildContextPacket } from '../../server/context/contextPacket.ts';
import { assessRequestScope, RequestScopeSchema } from '../../server/agent/requestScope.ts';

// PLAN_react_routing_and_clean_chat Phase 3 — the deterministic routing/coverage "rule gate" is
// exposed as a pure read the agent can call as a tool (assess_request_scope). It must derive from the
// same signals deriveRequirementAnalysis uses, and never broaden context.

void test('assessRequestScope reports a buildable scope for a concrete LED request', async () => {
  const packet = await buildContextPacket({
    message: 'Blink an LED from Arduino Uno pin D9 with a 220 ohm resistor.',
    locale: 'en'
  });
  const scope = assessRequestScope(packet);

  RequestScopeSchema.parse(scope);
  assert.equal(scope.route, 'synthesize_circuit');
  assert.equal(scope.buildEligible, true);
  assert.equal(scope.unsupported, false);
  assert.ok(scope.candidateParts.length > 0, 'candidate parts are surfaced from the packet');
});

void test('assessRequestScope reports clarification needed for an ambiguous request', async () => {
  const packet = await buildContextPacket({ message: '뭔가 만들고 싶어', locale: 'ko' });
  const scope = assessRequestScope(packet);

  assert.equal(scope.buildEligible, false);
  assert.ok(
    scope.route === 'clarify_requirements' || scope.route === 'unsupported_or_gap',
    `ambiguous request should not be synthesize_circuit (was ${scope.route})`
  );
  assert.ok(scope.reason.length > 0);
});

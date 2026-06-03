// Deterministic request-scope read (PLAN_react_routing_and_clean_chat Phase 3).
//
// The routing/coverage "rule gate" is NOT deleted — it is re-exposed here as a pure, deterministic
// read that the agent can call as the `assess_request_scope` tool (anchor Invariant 3: "deterministic
// tools are authority; deepagents can propose, server tools decide"). It surfaces the same signals
// deriveRequirementAnalysis uses, so the route decision has a single source of truth. Safety/unsupported
// stays a hard server guardrail elsewhere; this read only INFORMS the agent's ReAct decision.

import { z } from 'zod';

import type { buildContextPacket } from '../context/contextPacket.ts';

type ContextPacket = Awaited<ReturnType<typeof buildContextPacket>>;

export const RequestScopeSchema = z.object({
  route: z.enum(['synthesize_circuit', 'clarify_requirements', 'unsupported_or_gap']),
  buildEligible: z.boolean(),
  unsupported: z.boolean(),
  unsafe: z.boolean(),
  candidateParts: z.array(z.object({ id: z.string(), label: z.string(), kind: z.string() })),
  supportedCapabilities: z.array(z.string()),
  reason: z.string()
});

export type RequestScope = z.infer<typeof RequestScopeSchema>;

/** Deterministically classify the current request from its already-resolved context packet. */
export function assessRequestScope(contextPacket: ContextPacket): RequestScope {
  const unsupported = contextPacket.unsupportedSignals.length > 0;
  const buildEligible = contextPacket.contextCoverage.synthesisEligibility.status === 'eligible';
  const unsafe = contextPacket.contextRoute.routeId === 'unsupported-safety';
  const route: RequestScope['route'] = unsupported
    ? 'unsupported_or_gap'
    : buildEligible
      ? 'synthesize_circuit'
      : 'clarify_requirements';

  const eligibilityReason = contextPacket.contextCoverage.synthesisEligibility.reason;
  const reason = unsupported
    ? `Outside the build-ready scope: ${contextPacket.unsupportedSignals[0]}.`
    : buildEligible
      ? 'Context coverage is sufficient for circuit synthesis.'
      : `Needs clarification before synthesis: ${eligibilityReason}`;

  return RequestScopeSchema.parse({
    route,
    buildEligible,
    unsupported,
    unsafe,
    candidateParts: contextPacket.candidateParts.map((part) => ({
      id: part.id,
      label: part.label,
      kind: part.kind
    })),
    supportedCapabilities: contextPacket.capabilityMatches
      .filter((capability) => capability.supportLevel === 'supported')
      .map((capability) => capability.id),
    reason
  });
}

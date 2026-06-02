import type { GeneratedComposition } from './generatedComposition.ts';

// L3 promotion loop (Layered Context Architecture, Phase 4).
//
// A curated L3 bundle is a frozen, human-verified snapshot of what the L2
// engine generates for a capability. This module turns an L2 GeneratedComposition
// into a promotable structural bundle.
//
// CRITICAL (adversarial review): a generated composition must NOT be able to
// self-promote to a build-ready 'supported' bundle. Becoming 'supported' — and
// thus eligible as a golden oracle for L2 — requires an explicit HUMAN safety
// approval. This breaks the self-referential cycle where L2 generates L3 and L3
// validates L2. Without approval a promotion is at most 'partial' (structurally
// ready, awaiting safety review) or 'planned' (still has gaps).

export type BundlePromotionApproval = {
  approvedBy: string; // human reviewer identity (never machine-generated)
  approvedAt: string; // ISO timestamp of the human safety review
  safetyOverlayReviewed: boolean;
};

export type PromotedBundleStructural = {
  schemaVersion: string;
  bundleId: string;
  capabilityId: string;
  supportLevel: 'supported' | 'partial' | 'planned';
  provenance: 'promoted-from-generated-composition';
  requiredParts: string[];
  allowedParts: string[];
  requiredTopologies: string[];
  validationRules: string[];
  simulationPrimitives: string[];
  blockingConditions: string[];
  promotion: {
    generatedFromTopology: string;
    approvedBy: string | null;
    approvedAt: string | null;
    safetyOverlayReviewed: boolean;
  };
};

export type BundlePromotionResult = {
  structural: PromotedBundleStructural;
  promotable: boolean; // true only when build-ready AND human-safety-approved
  reasons: string[];
};

export function promoteCompositionToBundle(input: {
  composition: GeneratedComposition;
  capabilityId: string;
  bundleId: string;
  approval?: BundlePromotionApproval;
}): BundlePromotionResult {
  const { composition, capabilityId, bundleId, approval } = input;

  const requiredParts = [...new Set(Object.values(composition.slotAssignments))].sort();
  const allowedParts = [...composition.candidatePartIds].sort();

  const reasons: string[] = [];
  if (!composition.complete) {
    reasons.push('composition-incomplete');
  }
  const safetyApproved = approval?.safetyOverlayReviewed === true;
  if (!safetyApproved) {
    reasons.push('missing-human-safety-approval');
  }

  // Support ladder: 'supported' (oracle-eligible) requires BOTH structural
  // completeness AND a human safety approval. This is the cycle-breaker.
  const supportLevel: PromotedBundleStructural['supportLevel'] = !composition.complete
    ? 'planned'
    : safetyApproved
      ? 'supported'
      : 'partial';

  const structural: PromotedBundleStructural = {
    schemaVersion: '2026-06-02',
    bundleId,
    capabilityId,
    supportLevel,
    provenance: 'promoted-from-generated-composition',
    requiredParts,
    allowedParts,
    requiredTopologies: [composition.topologyId],
    validationRules: [...composition.validationRules].sort(),
    simulationPrimitives: [...new Set(composition.simulationPrimitiveHints)].sort(),
    blockingConditions: [...composition.blockingConditions].sort(),
    promotion: {
      generatedFromTopology: composition.topologyId,
      approvedBy: approval?.approvedBy ?? null,
      approvedAt: approval?.approvedAt ?? null,
      safetyOverlayReviewed: safetyApproved
    }
  };

  return {
    structural,
    promotable: composition.complete && safetyApproved,
    reasons
  };
}

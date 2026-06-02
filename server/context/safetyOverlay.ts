// Safety-overlay bridge (Agent Pipeline Refactor, Phase 2.5).
//
// A generated L2 composition is ALWAYS 'review-only' by construction — it has no human-curated
// safety overlay (see generatedComposition.ts). This module is the ONLY path that lifts a
// composition to build-ready, and only when a valid, human-reviewed safety overlay is attached AND
// the composition is structurally complete. This preserves the cycle-breaker invariant
// (bundlePromotion.ts): machine-generated structure can never declare itself build-ready without an
// explicit human safety review. Phase 5 (live composition path) depends on this bridge.

import type { GeneratedComposition } from './generatedComposition.ts';

export type SafetyOverlay = {
  /** Must match the composition's topology — an overlay reviewed for a different build is invalid. */
  topologyId: string;
  /** Human reviewer identity (never machine-generated). */
  reviewedBy: string;
  /** ISO timestamp of the human safety review. */
  reviewedAt: string;
  /** Curated safety statements (e.g. "low-voltage only", "current-limited"). At least one required. */
  safetyChecks: string[];
  /** Explicit human acknowledgement that the build's risks were reviewed. */
  riskAcknowledged: boolean;
};

export type SafetyOverlayEvaluation = {
  valid: boolean;
  reasons: string[];
};

/** A composition with the bridge applied; same shape as GeneratedComposition plus the overlay. */
export type BridgedComposition = GeneratedComposition & {
  safetyOverlay: SafetyOverlay | null;
};

/** Validate an overlay against a composition. Invalid (or absent) overlays keep review-only. */
export function evaluateSafetyOverlay(
  composition: GeneratedComposition,
  overlay: SafetyOverlay | null | undefined
): SafetyOverlayEvaluation {
  const reasons: string[] = [];
  if (!overlay) {
    return { valid: false, reasons: ['missing-safety-overlay'] };
  }
  if (overlay.topologyId !== composition.topologyId) reasons.push('overlay-topology-mismatch');
  if (overlay.reviewedBy.trim().length === 0) reasons.push('missing-human-reviewer');
  if (!overlay.riskAcknowledged) reasons.push('risk-not-acknowledged');
  if (overlay.safetyChecks.length === 0) reasons.push('no-safety-checks');
  return { valid: reasons.length === 0, reasons };
}

/**
 * Attach a safety overlay to a generated composition. Build-ready ('original') requires a VALID
 * human-reviewed overlay AND structural completeness; otherwise the composition stays 'review-only'
 * (the safe default) with the failing reasons recorded as blocking conditions.
 */
export function applySafetyOverlay(
  composition: GeneratedComposition,
  overlay?: SafetyOverlay | null
): BridgedComposition {
  const evaluation = evaluateSafetyOverlay(composition, overlay);
  const buildReady = evaluation.valid && composition.complete;
  const extraBlocking = buildReady
    ? []
    : [
        ...evaluation.reasons.map((reason) => `safety-overlay:${reason}`),
        ...(composition.complete ? [] : ['composition-incomplete'])
      ];

  return {
    ...composition,
    safetyOverlayPresent: evaluation.valid,
    buildReadyScope: buildReady ? 'original' : 'review-only',
    blockingConditions: [...new Set([...composition.blockingConditions, ...extraBlocking])].sort(),
    safetyOverlay: overlay ?? null
  };
}

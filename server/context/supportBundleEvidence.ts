import {
  SupportBundleEvidenceSchema,
  type CapabilityGraphEntry,
  type SupportBundleEvidence
} from '../agent/schemas.ts';
import { loadHardwareSupportBundles, loadSourceClaims } from './sourceClaims.ts';

export async function buildSupportBundleEvidence(
  capabilityMatches: CapabilityGraphEntry[],
  root?: string
): Promise<SupportBundleEvidence[]> {
  const [bundles, claims] = await Promise.all([
    loadHardwareSupportBundles(root),
    loadSourceClaims(root)
  ]);
  const claimById = new Map(claims.map((claim) => [claim.claimId, claim]));
  const bundleByCapability = new Map(bundles.map((bundle) => [bundle.capabilityId, bundle]));

  return capabilityMatches.map((capability) => {
    const bundle = bundleByCapability.get(capability.id);
    if (!bundle) {
      return SupportBundleEvidenceSchema.parse({
        capabilityId: capability.id,
        bundleId: null,
        supportLevel: capability.supportLevel,
        status: 'missing',
        requiredParts: capability.requiredParts,
        requiredArtifacts: ['source-claims'],
        presentArtifacts: [],
        missingArtifacts: ['source-claims'],
        sourceClaimIds: [],
        sourceTiers: [],
        promptSummary: `${capability.id} has no verified hardware support data.`
      });
    }

    const missingClaimIds = bundle.sourceClaimIds.filter((claimId) => !claimById.has(claimId));
    const presentArtifacts = bundle.requiredArtifacts.filter((artifact) =>
      artifact !== 'source-claims' || missingClaimIds.length === 0
    );
    const missingArtifacts = [
      ...bundle.requiredArtifacts.filter((artifact) => !presentArtifacts.includes(artifact)),
      ...missingClaimIds.map((claimId) => `source-claim:${claimId}`)
    ];
    const status = missingArtifacts.length === 0 ? 'complete' : 'incomplete';
    const sourceTiers = [...new Set(bundle.sourceClaimIds.flatMap((claimId) => {
      const tier = claimById.get(claimId)?.sourceTier;
      return tier ? [tier] : [];
    }))];

    return SupportBundleEvidenceSchema.parse({
      capabilityId: capability.id,
      bundleId: bundle.bundleId,
      supportLevel: capability.supportLevel,
      status,
      requiredParts: bundle.requiredParts,
      requiredArtifacts: bundle.requiredArtifacts,
      presentArtifacts,
      missingArtifacts,
      sourceClaimIds: bundle.sourceClaimIds,
      sourceTiers,
      promptSummary: status === 'complete'
        ? `${capability.id} has complete verified hardware support data.`
        : `${capability.id} is missing verified source data: ${missingArtifacts.join(', ')}.`
    });
  });
}

export function bundleEvidenceBlocksSynthesis(evidence: SupportBundleEvidence[]) {
  return evidence.some((entry) => entry.supportLevel === 'supported' && entry.status !== 'complete');
}

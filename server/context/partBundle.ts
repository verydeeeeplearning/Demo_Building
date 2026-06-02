import { z } from 'zod';

import { PartCapabilitySchema, type PartCapability } from '../agent/schemas.ts';
import { getPartRegistry } from './contextLayer.ts';
import { SourceClaimSchema, loadSourceClaims, type SourceClaim } from './sourceClaims.ts';

// L0 — Part Bundle (Layered Context Architecture).
//
// A part bundle is the single addressable canonical record for ONE part: the
// full PartCapability (pins/role, electrical, render footprint, simulation
// model — all already inline) joined with its resolved provenance source
// claims. Higher layers (L2 topology composition, L3 capability bundles) read
// part data from here instead of duplicating it.
//
// Resolution never throws on data gaps: every registry part resolves to a
// bundle, and any missing canonical evidence is surfaced as an explicit
// `blockingConditions` entry (no silent gaps). See PLAN Phase 1.

export const PartBundleSchema = z.object({
  partId: z.string().min(1),
  part: PartCapabilitySchema,
  sourceClaims: z.array(SourceClaimSchema).default([]),
  blockingConditions: z.array(z.string().min(1)).default([])
});

export type PartBundle = z.infer<typeof PartBundleSchema>;

let cachedBundles: PartBundle[] | null = null;
let cachedBundlesById: Map<string, PartBundle> | null = null;

// Claims attach to a part by two complementary links, unioned and de-duped:
//   1. claim.subjectId === part.id  (provenance is about this part)
//   2. part.sourceClaimIds          (part explicitly cites the claim)
// The union recovers claims for legacy parts that lack an explicit
// sourceClaimIds field but are still claim subjects (e.g. arduino-uno).
function resolveClaimsForPart(
  part: PartCapability,
  claimsBySubject: Map<string, SourceClaim[]>,
  claimById: Map<string, SourceClaim>
): SourceClaim[] {
  const byClaimId = new Map<string, SourceClaim>();
  for (const claim of claimsBySubject.get(part.id) ?? []) {
    byClaimId.set(claim.claimId, claim);
  }
  for (const claimId of part.sourceClaimIds) {
    const claim = claimById.get(claimId);
    if (claim) {
      byClaimId.set(claim.claimId, claim);
    }
  }
  return [...byClaimId.values()].sort((a, b) => a.claimId.localeCompare(b.claimId));
}

function computeBlockingConditions(part: PartCapability, sourceClaims: SourceClaim[]): string[] {
  const blocking: string[] = [];
  if (sourceClaims.length === 0) {
    blocking.push('missing-source-claims');
  }
  if (part.compatibleSimulationPrimitives.length === 0) {
    blocking.push('missing-simulation-primitive');
  }
  return blocking;
}

export async function resolveAllPartBundles(root?: string): Promise<PartBundle[]> {
  const useCache = root === undefined;
  if (useCache && cachedBundles) {
    return cachedBundles;
  }

  const [parts, claims] = await Promise.all([
    getPartRegistry(root),
    loadSourceClaims(root)
  ]);

  const claimById = new Map(claims.map((claim) => [claim.claimId, claim]));
  const claimsBySubject = new Map<string, SourceClaim[]>();
  for (const claim of claims) {
    const existing = claimsBySubject.get(claim.subjectId);
    if (existing) {
      existing.push(claim);
    } else {
      claimsBySubject.set(claim.subjectId, [claim]);
    }
  }

  const bundles = parts.map((part) => {
    const sourceClaims = resolveClaimsForPart(part, claimsBySubject, claimById);
    return PartBundleSchema.parse({
      partId: part.id,
      part,
      sourceClaims,
      blockingConditions: computeBlockingConditions(part, sourceClaims)
    });
  });

  if (useCache) {
    cachedBundles = bundles;
    cachedBundlesById = new Map(bundles.map((bundle) => [bundle.partId, bundle]));
  }

  return bundles;
}

export async function resolvePartBundle(partId: string, root?: string): Promise<PartBundle | null> {
  const bundles = await resolveAllPartBundles(root);
  if (root === undefined && cachedBundlesById) {
    return cachedBundlesById.get(partId) ?? null;
  }
  return bundles.find((bundle) => bundle.partId === partId) ?? null;
}

export function clearPartBundleCache(): void {
  cachedBundles = null;
  cachedBundlesById = null;
}

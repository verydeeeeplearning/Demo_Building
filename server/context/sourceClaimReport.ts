import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadHardwareSupportBundles,
  loadSourceClaims,
  type SourceClaim
} from './sourceClaims.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTEXT_ROOT = path.resolve(__dirname, '../../agent-context');

export type SourceClaimReport = {
  totalClaims: number;
  totalBundles: number;
  byTier: Record<SourceClaim['sourceTier'], number>;
  bundleCoverage: Array<{
    bundleId: string;
    capabilityId: string;
    claimCount: number;
    missingClaimIds: string[];
    browserEvidenceCount: number;
    missingBrowserEvidenceIds: string[];
  }>;
};

export async function buildSourceClaimReport(root?: string): Promise<SourceClaimReport> {
  const contextRoot = root ?? DEFAULT_CONTEXT_ROOT;
  const [claims, bundles, evalIds] = await Promise.all([
    loadSourceClaims(root),
    loadHardwareSupportBundles(root),
    loadContextEvalIds(contextRoot)
  ]);
  const claimIds = new Set(claims.map((claim) => claim.claimId));
  const byTier = {
    'manufacturer-official': 0,
    'vendor-technical-guide': 0,
    'eda-library': 0,
    'educational-reference': 0,
    'h-eduware-derived': 0
  } satisfies Record<SourceClaim['sourceTier'], number>;

  for (const claim of claims) {
    byTier[claim.sourceTier] += 1;
  }

  return {
    totalClaims: claims.length,
    totalBundles: bundles.length,
    byTier,
    bundleCoverage: bundles
      .map((bundle) => ({
        bundleId: bundle.bundleId,
        capabilityId: bundle.capabilityId,
        claimCount: bundle.sourceClaimIds.length,
        missingClaimIds: bundle.sourceClaimIds.filter((claimId) => !claimIds.has(claimId)),
        browserEvidenceCount: bundle.browserEvidenceIds.length,
        missingBrowserEvidenceIds: bundle.browserEvidenceIds.filter((id) => !evalIds.has(id))
      }))
      .sort((a, b) => a.bundleId.localeCompare(b.bundleId))
  };
}

async function loadContextEvalIds(root: string) {
  const raw = await readFile(path.join(root, 'evals/context-sufficiency-prompts.jsonl'), 'utf8');
  return new Set(raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { id?: unknown })
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0));
}

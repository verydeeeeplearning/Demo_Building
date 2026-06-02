import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTEXT_ROOT = path.resolve(__dirname, '../../agent-context');

export const SourceTierSchema = z.enum([
  'manufacturer-official',
  'vendor-technical-guide',
  'eda-library',
  'educational-reference',
  'h-eduware-derived'
]);

export const SourceClaimSchema = z.object({
  claimId: z.string().min(1),
  subjectId: z.string().min(1),
  subjectType: z.enum(['part', 'pin', 'board', 'footprint', 'simulation', 'validation-rule', 'topology']),
  claimType: z.enum([
    'pin-map',
    'electrical-limit',
    'protocol-support',
    'physical-dimension',
    'breadboard-continuity',
    'simulation-model',
    'validation-rule',
    'pedagogy'
  ]),
  fieldPath: z.string().min(1),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.record(z.string(), z.unknown())
  ]),
  units: z.string().optional(),
  sourceTier: SourceTierSchema,
  sourceTitle: z.string().min(1),
  sourceUrl: z.string().url(),
  sourceDateChecked: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  evidenceQuote: z.string().min(1).max(240),
  confidence: z.enum(['high', 'medium', 'low']),
  notes: z.string().default('')
});

export type SourceClaim = z.infer<typeof SourceClaimSchema>;

export const SourceClaimListSchema = z.array(SourceClaimSchema);

export const HardwareSupportArtifactSchema = z.enum([
  'source-claims',
  'capability-graph-entry',
  'part-capability',
  'pin-aliases',
  'validation-rule',
  'simulation-primitive',
  'render-footprint',
  'eval-supported-prompt',
  'eval-unsupported-counterexample',
  'browser-visible-verification'
]);

export const HardwareSupportBundleSchema = z.object({
  bundleId: z.string().min(1),
  capabilityId: z.string().min(1),
  supportLevel: z.enum(['supported', 'partial', 'planned', 'unsupported']),
  requiredParts: z.array(z.string().min(1)).default([]),
  requiredArtifacts: z.array(HardwareSupportArtifactSchema).min(1),
  sourceClaimIds: z.array(z.string().min(1)).default([]),
  canonicalFiles: z.array(z.string().min(1)).default([]),
  browserEvidenceIds: z.array(z.string().min(1)).default([])
});

export type HardwareSupportBundle = z.infer<typeof HardwareSupportBundleSchema>;

export const HardwareSupportBundleListSchema = z.array(HardwareSupportBundleSchema);

export async function loadSourceClaims(root = DEFAULT_CONTEXT_ROOT): Promise<SourceClaim[]> {
  const raw = await readFile(path.join(root, 'sources/source-claims.json'), 'utf8');
  return SourceClaimListSchema.parse(JSON.parse(raw));
}

export async function loadHardwareSupportBundles(
  root = DEFAULT_CONTEXT_ROOT
): Promise<HardwareSupportBundle[]> {
  const raw = await readFile(path.join(root, 'sources/hardware-support-bundles.json'), 'utf8');
  return HardwareSupportBundleListSchema.parse(JSON.parse(raw));
}

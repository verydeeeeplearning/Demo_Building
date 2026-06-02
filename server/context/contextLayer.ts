import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';

import {
  ContextCoveragePurposeSchema,
  ContextRetrievalBudgetSchema,
  ContextSourceTypeSchema,
  PartCapabilitySchema,
  type CapabilityGraphEntry,
  type ContextRetrievalBudget,
  type PartCapability,
  type PartRiskLevel,
  type PartSupportTier,
  type SimulationPrimitive
} from '../agent/schemas.ts';
import {
  clearCapabilityGraphCache,
  loadCapabilityGraph,
  matchCapabilities
} from './capabilityGraph.ts';
import {
  clearPinAliasCache,
  loadPinAliases,
  resolvePinAlias,
  type ResolvedPinAlias
} from './pinAliases.ts';
import {
  clearContextAssetCache,
  loadBreadboardGrid,
  loadRenderFootprints,
  loadSimulationPrimitives,
  loadTopologyTemplates
} from './contextAssets.ts';
import { loadHardwareSupportBundles, loadSourceClaims } from './sourceClaims.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTEXT_ROOT = path.resolve(__dirname, '../../agent-context');
const DEFAULT_VISUAL_LIBRARY_MODULE = path.resolve(__dirname, '../../src/partLibraryData.js');

const ContextLevelSchema = z.enum(['L0', 'L1', 'L2', 'L3', 'L4']);

const RawContextEntrySchema = z.object({
  id: z.string(),
  path: z.string(),
  description: z.string(),
  sourceId: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  level: ContextLevelSchema.optional(),
  sourceType: ContextSourceTypeSchema.optional(),
  tags: z.array(z.string()).default([]),
  provides: z.array(z.string()).default([]),
  loadWhen: z.array(z.string()).default([]),
  canonical: z.boolean().optional(),
  budget: ContextRetrievalBudgetSchema.optional()
});

const RawContextIndexSchema = z.object({
  version: z.string(),
  memory: z.array(RawContextEntrySchema),
  skills: z.array(RawContextEntrySchema),
  references: z.array(RawContextEntrySchema),
  data: z.array(RawContextEntrySchema),
  routing: z.array(RawContextEntrySchema).default([])
});

const ContextRouteMapRouteSchema = z.object({
  routeId: z.string().min(1),
  priority: z.number().int(),
  budget: ContextRetrievalBudgetSchema,
  when: z.object({
    capabilityIds: z.array(z.string().min(1)).default([]),
    modalities: z.array(z.string().min(1)).default([]),
    supportLevels: z.array(z.enum(['supported', 'partial', 'planned', 'unsupported'])).default([]),
    ambiguity: z.boolean().optional(),
    unsafe: z.boolean().optional()
  }).default({ capabilityIds: [], modalities: [], supportLevels: [] }),
  load: z.record(z.string(), z.array(z.string().min(1))),
  reason: z.string().min(1)
});

const ContextRoutingMapSchema = z.object({
  version: z.string(),
  maxPromptCharsByBudget: z.object({
    minimal: z.number().int().positive(),
    summary: z.number().int().positive(),
    'data-only': z.number().int().positive(),
    full: z.number().int().positive()
  }),
  heavySourceIds: z.array(z.string().min(1)).default([]),
  routes: z.array(ContextRouteMapRouteSchema).min(1)
});

export const ContextBundleManifestV2Schema = z.object({
  schemaVersion: z.string().min(1),
  bundleId: z.string().min(1),
  capabilityId: z.string().min(1),
  supportLevel: z.enum(['supported', 'partial', 'planned', 'unsupported']),
  promptBudget: ContextRetrievalBudgetSchema,
  agentSummaryPath: z.string().min(1),
  requiredParts: z.array(z.string().min(1)).default([]),
  allowedParts: z.array(z.string().min(1)).default([]),
  requiredTopologies: z.array(z.string().min(1)).default([]),
  validationRules: z.array(z.string().min(1)).default([]),
  simulationPrimitives: z.array(z.string().min(1)).default([]),
  renderFootprints: z.array(z.string().min(1)).default([]),
  canonicalRefs: z.object({
    parts: z.array(z.string().min(1)).default([]),
    footprints: z.array(z.string().min(1)).default([]),
    simulation: z.array(z.string().min(1)).default([]),
    topology: z.array(z.string().min(1)).default([]),
    sources: z.array(z.string().min(1)).default([])
  }),
  promptInclusions: z.object({
    includePins: z.boolean().default(false),
    includeElectricalLimits: z.boolean().default(false),
    includeFootprintAnchors: z.boolean().default(false),
    includeSourceQuotes: z.boolean().default(false)
  }),
  blockingConditions: z.array(z.string().min(1)).default([])
});

const ContextV2IndexSchema = z.object({
  version: z.string().min(1),
  root: z.literal('agent-context/v2'),
  heavySourceIds: z.array(z.string().min(1)).default([]),
  bundles: z.array(z.object({
    bundleId: z.string().min(1),
    capabilityId: z.string().min(1),
    manifestPath: z.string().min(1),
    summaryPath: z.string().min(1),
    evalPath: z.string().min(1).optional(),
    level: ContextLevelSchema,
    budget: ContextRetrievalBudgetSchema
  })),
  shared: z.record(z.string(), z.string())
});

const ContextV2RouteSchema = z.object({
  routeId: z.string().min(1),
  priority: z.number().int(),
  policyOnly: z.boolean().default(false),
  when: z.object({
    capabilityIds: z.array(z.string()).default([]),
    capabilityMatchMode: z.enum(['any', 'all']).default('any'),
    supportLevels: z.array(z.enum(['supported', 'partial', 'planned', 'unsupported'])).default([]),
    modalities: z.array(z.string()).default([]),
    ambiguity: z.boolean().optional(),
    unsafe: z.boolean().optional()
  }),
  bundleIds: z.array(z.string()).default([]),
  alwaysInclude: z.array(z.string()).default([]),
  maxPromptChars: z.number().int().positive(),
  budget: ContextRetrievalBudgetSchema.optional(),
  reason: z.string().min(1)
});

const ContextV2RoutesSchema = z.object({
  version: z.string().min(1),
  routes: z.array(ContextV2RouteSchema).min(1)
});

const ContextSufficiencyFixtureSchema = z.object({
  id: z.string(),
  expectedContextRouteId: z.string().min(1).optional(),
  expectedCoverageStatus: z.enum(['sufficient', 'insufficient']).optional(),
  expectedSynthesisEligibility: z.enum(['eligible', 'ineligible']).optional(),
  expectedSufficientFor: z.array(ContextCoveragePurposeSchema).default([]),
  forbiddenSufficientFor: z.array(ContextCoveragePurposeSchema).default([]),
  expectedBrowserOutcome: z.enum([
    'render-and-run-valid-simulation',
    'support-gap-no-render-or-current',
    'unsupported-response-no-render-or-current',
    'unsafe-refusal-no-render-or-current',
    'clarification-only-no-render-or-current',
    'record-failure-class-and-context-evidence'
  ]).optional(),
  expectedCapabilityIds: z.array(z.string()).default([]),
  forbiddenCapabilityIds: z.array(z.string()).default([]),
  expectedSupportGapPatterns: z.array(z.string()).default([]),
  expectedUnsupportedSignalPatterns: z.array(z.string()).default([]),
  expectedAmbiguity: z.boolean().optional()
});

const VisualLibraryPartSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().optional(),
  pins: z.array(z.object({
    name: z.string().min(1),
    role: z.string().min(1)
  }).passthrough()).default([]),
  model: z.object({
    kind: z.string().min(1).optional()
  }).passthrough().optional()
}).passthrough();

const VisualLibraryCrosswalkEntrySchema = z.object({
  visualPartId: z.string().min(1),
  agentPartId: z.string().min(1),
  status: z.literal('agent-ready'),
  reason: z.string().min(1)
});

const VisualLibraryCrosswalkSchema = z.object({
  version: z.string().min(1),
  defaultUnmappedStatus: z.literal('visual-only'),
  mappings: z.array(VisualLibraryCrosswalkEntrySchema).default([])
});

type RawContextEntry = z.infer<typeof RawContextEntrySchema>;
type ContextEntryGroup = 'memory' | 'skills' | 'references' | 'data' | 'routing';

export type ContextEntry = RawContextEntry & {
  sourceId: string;
  aliases: string[];
  level: z.infer<typeof ContextLevelSchema>;
  sourceType: z.infer<typeof ContextSourceTypeSchema>;
  tags: string[];
  provides: string[];
  loadWhen: string[];
  canonical: boolean;
  budget: ContextRetrievalBudget;
};
export type ContextIndex = {
  version: string;
  memory: ContextEntry[];
  skills: ContextEntry[];
  references: ContextEntry[];
  data: ContextEntry[];
  routing: ContextEntry[];
};
export type ContextRoutingMap = z.infer<typeof ContextRoutingMapSchema>;
export type ContextRoutingRoute = z.infer<typeof ContextRouteMapRouteSchema>;
export type ContextBundleManifestV2 = z.infer<typeof ContextBundleManifestV2Schema>;
export type ContextV2Index = z.infer<typeof ContextV2IndexSchema>;
export type ContextV2Routes = z.infer<typeof ContextV2RoutesSchema>;
export type ContextBundleV2 = {
  manifest: ContextBundleManifestV2;
  summary: string;
};

export const REQUIRED_CAPABILITY_ARTIFACTS = [
  'capability-graph-entry',
  'source-claims',
  'part-capability',
  'pin-aliases',
  'validation-rule',
  'simulation-primitive',
  'render-footprint',
  'eval-supported-prompt',
  'eval-unsupported-counterexample',
  'browser-visible-verification'
] as const;

export type CapabilityArtifact = typeof REQUIRED_CAPABILITY_ARTIFACTS[number];

export type CapabilityCoverageReport = {
  capabilityId: string;
  supportLevel: 'supported' | 'partial' | 'planned' | 'unsupported' | null;
  recommendedSupportLevel: 'supported' | 'partial' | 'planned' | 'unsupported';
  canBeSupported: boolean;
  present: CapabilityArtifact[];
  missing: CapabilityArtifact[];
  details: string[];
};

type CapabilitySupportLevel = NonNullable<CapabilityCoverageReport['supportLevel']>;

export type CapabilityPromotionGapBucket = {
  artifact: CapabilityArtifact;
  count: number;
  capabilityIds: string[];
  details: string[];
};

export type CapabilityPromotionGapReport = {
  totalCapabilities: number;
  bySupportLevel: Record<CapabilitySupportLevel, number>;
  byRecommendedSupportLevel: Record<CapabilityCoverageReport['recommendedSupportLevel'], number>;
  readyForSupported: string[];
  blockedFromSupported: string[];
  gapsByArtifact: CapabilityPromotionGapBucket[];
  visualLibrary: VisualLibraryExpansionAudit;
  reports: CapabilityCoverageReport[];
};

type ContextSufficiencyFixture = z.infer<typeof ContextSufficiencyFixtureSchema>;
type VisualLibraryPart = z.infer<typeof VisualLibraryPartSchema>;
type VisualLibraryCrosswalk = z.infer<typeof VisualLibraryCrosswalkSchema>;

export type VisualLibraryAgentReadyMapping = {
  visualPartId: string;
  visualPartName: string;
  visualCategory: string;
  agentPartId: string;
  agentPartLabel: string;
  agentPartSupportLevel: PartCapability['supportLevel'];
  reason: string;
};

export type VisualLibraryInvalidMapping = {
  visualPartId: string;
  agentPartId: string;
  reason: string;
  issue: string;
};

export type VisualLibraryContextPart = {
  visualPartId: string;
  visualPartName: string;
  visualCategory: string;
  family: string;
  supportTier: PartSupportTier;
  riskLevel: PartRiskLevel;
  status: 'agent-ready' | 'context-known' | 'catalog-only' | 'unsafe-blocked';
  mappedAgentPartId?: string;
  mappedAgentPartSupportLevel?: PartCapability['supportLevel'];
  pinCount: number;
  pinRoles: string[];
  reason: string;
};

export type VisualLibraryExpansionAudit = {
  version: string;
  totalVisualParts: number;
  canonicalAgentPartCount: number;
  unmappedPolicy: 'visual-only';
  contextKnownCount: number;
  contextKnownVisualPartIds: string[];
  simulationReadyVisualPartIds: string[];
  unrepresentedVisualPartIds: string[];
  bySupportTier: Record<PartSupportTier, number>;
  byRiskLevel: Record<PartRiskLevel, number>;
  agentReadyVisualPartIds: string[];
  agentReadyAgentPartIds: string[];
  visualOnlyPartIds: string[];
  visualOnlyExamples: string[];
  invalidMappings: VisualLibraryInvalidMapping[];
  agentReadyMappings: VisualLibraryAgentReadyMapping[];
  contextPartSummaries: VisualLibraryContextPart[];
};

export type VisualLibraryPartMention = {
  visualPartId: string;
  visualPartName: string;
  visualCategory: string;
  status: VisualLibraryContextPart['status'];
  supportTier: PartSupportTier;
  riskLevel: PartRiskLevel;
  family: string;
  agentPartId?: string;
  reason: string;
};

const SUPPORTED_VALIDATION_RULES = new Set([
  'block-current-animation',
  'block-on-invalid-netlist',
  'button-pullup-or-pulldown',
  'closed-current-path',
  'common-ground',
  'current-limit-warning',
  'digital-input-pin-exists',
  'digital-input-reference-defined',
  'external-power-warning',
  'high-current-warning',
  'hbridge-control-required',
  'hbridge-driver-required',
  'i2c-pin-role-match',
  'i2c-protocol-sensor-pins',
  'led-polarity',
  'analog-input-pin-exists',
  'output-pin-exists',
  'polarity-check',
  'power-rail-valid',
  'pulse-control-pin-defined',
  'pulse-output-pin-required',
  'pwm-pin-required',
  'pwm-output-required',
  'reject-high-voltage',
  'reject-security-actuator',
  'reject-unsupported-autonomy',
  'relay-control-required',
  'relay-load-contact-required',
  'relay-low-voltage-load-only',
  'safe-reframe-required',
  'sensor-pin-role-match',
  'sensor-trigger-echo-pin-pair',
  'single-wire-data-pin',
  'series-current-limit',
  'timed-output-pin-exists',
  'threshold-defined',
  'validated-current-path-required',
  'validation-issue-required',
  'voltage-divider-required',
  'resistive-sensor-divider-required',
  'matrix-input-lines-distinct',
  'matrix-input-reference-defined',
  'base-resistor-required',
  'flyback-warning',
  'low-voltage-source-polarity',
  'power-rail-positive-required',
  'ground-rail-return-required',
  'regulated-output-to-rail-required',
  'regulator-input-required',
  'regulator-qualitative-only',
  'no-mains-power',
  'passive-context-low-voltage-only',
  'passive-only-state-simulation',
  'polarized-passive-orientation',
  'timing-passive-context-only',
  'prototyping-surface-context-only',
  'surface-does-not-create-nets',
  'connector-context-low-voltage-only',
  'connector-does-not-create-source',
  'controller-board-pin-map-substitution',
  'controller-voltage-domain-policy',
  'controller-board-context-only',
  'joystick-axis-pins-defined',
  'module-signal-required',
  'motor-driver-required',
  'stepper-driver-required',
  'stepper-phase-lines-required',
  'stepper-step-dir-required',
  'encoder-quadrature-pins-defined',
  'addressable-led-data-pin',
  'addressable-led-power-warning',
  'bare-seven-segment-common-ground',
  'bare-seven-segment-segment-resistor',
  'led-array-display-clock-pin',
  'led-array-display-data-pin',
  'led-array-display-select-pin',
  'spi-display-clock-pin',
  'spi-display-control-pin',
  'spi-display-data-pin',
  'spi-display-select-pin',
  'clocked-data-sensor-pins',
  'spi-sensor-clock-pin',
  'spi-sensor-data-pins',
  'spi-sensor-select-pin',
  'uart-sensor-tx-rx-crossing',
  'qualitative-sensor-readout-only',
  'uart-communication-module-pins',
  'spi-communication-module-pins',
  'differential-bus-module-pins',
  'wireless-command-state-only',
  'network-cloud-overclaim-blocked',
  'radio-power-warning',
  'logic-interface-power-ground',
  'logic-interface-signal-required',
  'logic-interface-i2c-pins',
  'logic-interface-spi-pins',
  'level-shifter-voltage-domains',
  'precision-analog-overclaim-blocked',
  'timer-frequency-overclaim-blocked',
  'level-shift-overclaim-blocked',
  'powered-light-module-power-rail',
  'powered-light-module-safety-warning',
  'powered-light-module-signal-pin',
  'rgb-led-channel-resistor',
  'rgb-led-common-ground'
]);

let cachedIndex: ContextIndex | null = null;
let cachedParts: PartCapability[] | null = null;
let cachedRoutingMap: ContextRoutingMap | null = null;
let cachedContextV2Index: ContextV2Index | null = null;
let cachedContextV2Routes: ContextV2Routes | null = null;

export async function loadContextIndex(root = DEFAULT_CONTEXT_ROOT): Promise<ContextIndex> {
  if (cachedIndex && root === DEFAULT_CONTEXT_ROOT) {
    return cachedIndex;
  }

  const content = await readFile(path.join(root, 'index.json'), 'utf8');
  const rawIndex = RawContextIndexSchema.parse(JSON.parse(content));
  const index: ContextIndex = {
    version: rawIndex.version,
    memory: rawIndex.memory.map((entry) => enrichContextEntry(entry, 'memory')),
    skills: rawIndex.skills.map((entry) => enrichContextEntry(entry, 'skills')),
    references: rawIndex.references.map((entry) => enrichContextEntry(entry, 'references')),
    data: rawIndex.data.map((entry) => enrichContextEntry(entry, 'data')),
    routing: rawIndex.routing.map((entry) => enrichContextEntry(entry, 'routing'))
  };
  if (root === DEFAULT_CONTEXT_ROOT) {
    cachedIndex = index;
  }
  return index;
}

export async function loadContextRoutingMap(root = DEFAULT_CONTEXT_ROOT): Promise<ContextRoutingMap> {
  if (cachedRoutingMap && root === DEFAULT_CONTEXT_ROOT) {
    return cachedRoutingMap;
  }

  const index = await loadContextIndex(root);
  const entry = index.routing.find((candidate) => candidate.id === 'context-routing-map');
  if (!entry) {
    throw new Error('Context index is missing context-routing-map routing entry');
  }

  const content = await readFile(path.join(root, entry.path), 'utf8');
  const routingMap = ContextRoutingMapSchema.parse(JSON.parse(content));
  if (root === DEFAULT_CONTEXT_ROOT) {
    cachedRoutingMap = routingMap;
  }
  return routingMap;
}

export async function loadContextV2Index(root = DEFAULT_CONTEXT_ROOT): Promise<ContextV2Index> {
  if (cachedContextV2Index && root === DEFAULT_CONTEXT_ROOT) {
    return cachedContextV2Index;
  }

  const content = await readFile(path.join(root, 'v2/index.json'), 'utf8');
  const index = ContextV2IndexSchema.parse(JSON.parse(content));
  if (root === DEFAULT_CONTEXT_ROOT) {
    cachedContextV2Index = index;
  }
  return index;
}

export async function loadContextV2Routes(root = DEFAULT_CONTEXT_ROOT): Promise<ContextV2Routes> {
  if (cachedContextV2Routes && root === DEFAULT_CONTEXT_ROOT) {
    return cachedContextV2Routes;
  }

  const content = await readFile(path.join(root, 'v2/routes.json'), 'utf8');
  const routes = ContextV2RoutesSchema.parse(JSON.parse(content));
  if (root === DEFAULT_CONTEXT_ROOT) {
    cachedContextV2Routes = routes;
  }
  return routes;
}

export async function loadContextBundleV2(
  bundleId: string,
  root = DEFAULT_CONTEXT_ROOT
): Promise<ContextBundleV2> {
  const index = await loadContextV2Index(root);
  const entry = index.bundles.find((bundle) => bundle.bundleId === bundleId);
  if (!entry) {
    throw new Error(`Unknown v2 context bundle: ${bundleId}`);
  }

  const [manifestRaw, summary] = await Promise.all([
    readFile(path.join(root, 'v2', entry.manifestPath), 'utf8'),
    readFile(path.join(root, 'v2', entry.summaryPath), 'utf8')
  ]);

  return {
    manifest: ContextBundleManifestV2Schema.parse(JSON.parse(manifestRaw)),
    summary: summary.trim()
  };
}

export function resolveContextSourceId(sourceId: string, index: ContextIndex): ContextEntry | null {
  const entries = allEntries(index);
  const candidates = sourceIdCandidates(sourceId);
  return entries.find((entry) => candidates.some((candidate) =>
    entry.sourceId === candidate || entry.aliases.includes(candidate)
  )) ?? null;
}

export async function readContextDoc(id: string, root = DEFAULT_CONTEXT_ROOT): Promise<string> {
  const index = await loadContextIndex(root);
  const entry = allEntries(index).find((candidate) => candidate.id === id);
  if (!entry) {
    throw new Error(`Unknown context entry: ${id}`);
  }
  return readFile(path.join(root, entry.path), 'utf8');
}

export async function getPartRegistry(root = DEFAULT_CONTEXT_ROOT): Promise<PartCapability[]> {
  if (cachedParts && root === DEFAULT_CONTEXT_ROOT) {
    return cachedParts;
  }

  const index = await loadContextIndex(root);
  const entry = index.data.find((candidate) => candidate.id === 'part-capabilities');
  if (!entry) {
    throw new Error('Context index is missing part-capabilities data entry');
  }
  const content = await readFile(path.join(root, entry.path), 'utf8');
  const parts = z.array(PartCapabilitySchema).parse(JSON.parse(content));
  if (root === DEFAULT_CONTEXT_ROOT) {
    cachedParts = parts;
  }
  return parts;
}

export async function auditVisualLibraryExpansion(
  root = DEFAULT_CONTEXT_ROOT,
  visualLibraryModule = DEFAULT_VISUAL_LIBRARY_MODULE
): Promise<VisualLibraryExpansionAudit> {
  const [parts, visualParts, crosswalk] = await Promise.all([
    getPartRegistry(root),
    loadVisualLibraryParts(visualLibraryModule),
    loadVisualLibraryCrosswalk(root)
  ]);
  const partsById = new Map(parts.map((part) => [part.id, part]));
  const visualPartsById = new Map(visualParts.map((part) => [part.id, part]));
  const invalidMappings: VisualLibraryInvalidMapping[] = [];
  const agentReadyMappings: VisualLibraryAgentReadyMapping[] = [];

  for (const mapping of crosswalk.mappings) {
    const visualPart = visualPartsById.get(mapping.visualPartId);
    const agentPart = partsById.get(mapping.agentPartId);

    if (!visualPart) {
      invalidMappings.push({
        visualPartId: mapping.visualPartId,
        agentPartId: mapping.agentPartId,
        reason: mapping.reason,
        issue: 'Visual library part id is missing from src/partLibraryData.js.'
      });
      continue;
    }

    if (!agentPart) {
      invalidMappings.push({
        visualPartId: mapping.visualPartId,
        agentPartId: mapping.agentPartId,
        reason: mapping.reason,
        issue: 'Agent part id is missing from the canonical part-capabilities registry.'
      });
      continue;
    }

    if (agentPart.supportLevel !== 'supported') {
      invalidMappings.push({
        visualPartId: mapping.visualPartId,
        agentPartId: mapping.agentPartId,
        reason: mapping.reason,
        issue: `Agent part is ${agentPart.supportLevel}, not supported.`
      });
      continue;
    }

    agentReadyMappings.push({
      visualPartId: visualPart.id,
      visualPartName: visualPart.name,
      visualCategory: visualPart.category,
      agentPartId: agentPart.id,
      agentPartLabel: agentPart.label,
      agentPartSupportLevel: agentPart.supportLevel,
      reason: mapping.reason
    });
  }

  const agentReadyVisualPartIds = unique(agentReadyMappings.map((mapping) => mapping.visualPartId)).sort();
  const agentReadyVisualSet = new Set(agentReadyVisualPartIds);
  const agentReadyMappingByVisualId = new Map(agentReadyMappings.map((mapping) => [mapping.visualPartId, mapping]));
  const contextPartSummaries = visualParts
    .map((part) => buildVisualLibraryContextPart(part, agentReadyMappingByVisualId.get(part.id)))
    .sort((a, b) => a.visualPartId.localeCompare(b.visualPartId));
  const contextKnownVisualPartIds = contextPartSummaries
    .filter((part) => part.supportTier !== 'catalog-only')
    .map((part) => part.visualPartId)
    .sort();
  const simulationReadyVisualPartIds = contextPartSummaries
    .filter((part) => part.supportTier === 'simulation-ready')
    .map((part) => part.visualPartId)
    .sort();
  const representedVisualPartIds = new Set(contextPartSummaries.map((part) => part.visualPartId));
  const unrepresentedVisualPartIds = visualParts
    .map((part) => part.id)
    .filter((partId) => !representedVisualPartIds.has(partId))
    .sort();
  const visualOnlyPartIds = visualParts
    .map((part) => part.id)
    .filter((partId) => !agentReadyVisualSet.has(partId))
    .sort();

  return {
    version: crosswalk.version,
    totalVisualParts: visualParts.length,
    canonicalAgentPartCount: parts.length,
    unmappedPolicy: crosswalk.defaultUnmappedStatus,
    contextKnownCount: contextKnownVisualPartIds.length,
    contextKnownVisualPartIds,
    simulationReadyVisualPartIds,
    unrepresentedVisualPartIds,
    bySupportTier: countBySupportTier(contextPartSummaries),
    byRiskLevel: countByRiskLevel(contextPartSummaries),
    agentReadyVisualPartIds,
    agentReadyAgentPartIds: unique(agentReadyMappings.map((mapping) => mapping.agentPartId)).sort(),
    visualOnlyPartIds,
    visualOnlyExamples: visualOnlyPartIds.slice(0, 12),
    invalidMappings: invalidMappings.sort((a, b) => a.visualPartId.localeCompare(b.visualPartId)),
    agentReadyMappings: agentReadyMappings.sort((a, b) => a.visualPartId.localeCompare(b.visualPartId)),
    contextPartSummaries
  };
}

export async function detectVisualLibraryPartMentions(
  query: string,
  root = DEFAULT_CONTEXT_ROOT,
  visualLibraryModule = DEFAULT_VISUAL_LIBRARY_MODULE
): Promise<VisualLibraryPartMention[]> {
  const [visualParts, expansionAudit] = await Promise.all([
    loadVisualLibraryParts(visualLibraryModule),
    auditVisualLibraryExpansion(root, visualLibraryModule)
  ]);
  const contextPartsById = new Map(expansionAudit.contextPartSummaries.map((part) => [part.visualPartId, part]));
  const normalizedQuery = normalizeVisualQuery(query);
  const queryTerms = new Set(tokenize(query));

  return visualParts
    .filter((part) => visualPartMatches(part, normalizedQuery, queryTerms))
    .map((part) => {
      const contextPart = contextPartsById.get(part.id) ?? buildVisualLibraryContextPart(part);
      return {
        visualPartId: part.id,
        visualPartName: part.name,
        visualCategory: part.category,
        status: contextPart.status,
        supportTier: contextPart.supportTier,
        riskLevel: contextPart.riskLevel,
        family: contextPart.family,
        agentPartId: contextPart.mappedAgentPartId,
        reason: contextPart.reason
      };
    })
    .sort((a, b) => mentionSortKey(a).localeCompare(mentionSortKey(b)));
}

const VISUAL_SUPPORT_TIERS: PartSupportTier[] = [
  'catalog-only',
  'context-known',
  'pin-known',
  'render-ready',
  'validation-ready',
  'simulation-ready',
  'unsafe-blocked'
];

const VISUAL_RISK_LEVELS: PartRiskLevel[] = [
  'low-voltage',
  'power-warning',
  'high-current',
  'mains-unsafe',
  'unknown'
];

function buildVisualLibraryContextPart(
  part: VisualLibraryPart,
  mapping?: VisualLibraryAgentReadyMapping
): VisualLibraryContextPart {
  const family = classifyVisualPartFamily(part);
  const riskLevel = classifyVisualPartRisk(part);
  const supportTier = mapping ? 'simulation-ready' : classifyVisualPartSupportTier(part, riskLevel);
  const status = mapping
    ? 'agent-ready'
    : supportTier === 'unsafe-blocked' ? 'unsafe-blocked' : supportTier === 'catalog-only' ? 'catalog-only' : 'context-known';
  const pinRoles = unique(part.pins.map((pin) => pin.role)).sort();

  return {
    visualPartId: part.id,
    visualPartName: part.name,
    visualCategory: part.category,
    family,
    supportTier,
    riskLevel,
    status,
    mappedAgentPartId: mapping?.agentPartId,
    mappedAgentPartSupportLevel: mapping?.agentPartSupportLevel,
    pinCount: part.pins.length,
    pinRoles,
    reason: mapping?.reason ?? visualContextReason(part, supportTier, riskLevel, family)
  };
}

function classifyVisualPartSupportTier(part: VisualLibraryPart, riskLevel: PartRiskLevel): PartSupportTier {
  if (riskLevel === 'mains-unsafe') {
    return 'unsafe-blocked';
  }
  if (part.pins.length > 0) {
    return 'pin-known';
  }
  return 'context-known';
}

function classifyVisualPartRisk(part: VisualLibraryPart): PartRiskLevel {
  const haystack = visualPartSearchText(part);
  if (/\b(mains|220v|110v|120v|240v|wall outlet|ac line|varistor|mov)\b/.test(haystack)) {
    return 'mains-unsafe';
  }
  if (/\b(solenoid|pump|nema17|stepper|dc motor|motor driver|l298n|a4988|drv8825|l293d|irf520|mosfet|high current)\b/.test(haystack)) {
    return 'high-current';
  }
  if (/\b(relay|laser|lipo|battery|9v|barrel|screw terminal|fan|7805|regulator|driver)\b/.test(haystack)) {
    return 'power-warning';
  }
  return 'low-voltage';
}

function classifyVisualPartFamily(part: VisualLibraryPart): string {
  const haystack = visualPartSearchText(part);
  const roles = new Set(part.pins.map((pin) => pin.role));

  if (part.category === 'boards') return 'controller-board';
  if (part.category === 'displays') {
    if (/\b(7seg|matrix|neopixel|led)\b/.test(haystack)) return 'display-led-array';
    if (roles.has('clock') && roles.has('enable')) return 'display-spi';
    if (roles.has('clock') && roles.has('data')) return 'display-i2c';
    return 'display';
  }
  if (part.category === 'sensors') {
    if (roles.has('analog') && roles.has('digital')) return 'sensor-analog-digital';
    if (roles.has('analog')) return 'sensor-analog';
    if (roles.has('clock') && roles.has('data')) return 'sensor-i2c-or-spi';
    if (roles.has('tx') || roles.has('rx')) return 'sensor-serial';
    if (roles.has('digital') || roles.has('output') || roles.has('signal')) return 'sensor-digital';
    return 'sensor';
  }
  if (part.category === 'actuators') {
    if (/\b(led|neopixel|ws2812|laser)\b/.test(haystack)) return 'light-output';
    if (/\b(buzzer)\b/.test(haystack)) return 'sound-output';
    if (/\b(servo)\b/.test(haystack)) return 'servo-output';
    if (/\b(relay)\b/.test(haystack)) return 'relay-output';
    if (/\b(motor|pump|fan|solenoid|stepper)\b/.test(haystack)) return 'motor-or-inductive-output';
    return 'actuator-output';
  }
  if (part.category === 'inputs') {
    if (/\b(joystick|encoder|pot)\b/.test(haystack) || roles.has('analog')) return 'human-input-analog';
    if (/\b(keypad|dip)\b/.test(haystack)) return 'matrix-or-multi-input';
    return 'human-input-digital';
  }
  if (part.category === 'passives') {
    if (/\b(potentiometer|trimmer)\b/.test(haystack)) return 'adjustable-passive';
    if (/\b(capacitor|cap)\b/.test(haystack)) return 'capacitive-passive';
    if (/\b(inductor|crystal)\b/.test(haystack)) return 'frequency-or-inductive-passive';
    if (/\b(diode|fuse|varistor|mov)\b/.test(haystack)) return 'protection-passive';
    return 'resistive-passive';
  }
  if (part.category === 'ics') {
    if (/\b(driver|stepper|l298n|l293d|uln2003)\b/.test(haystack)) return 'driver-ic';
    if (/\b(adc|op-amp|opamp|lm358)\b/.test(haystack)) return 'analog-interface-ic';
    if (/\b(regulator|7805)\b/.test(haystack)) return 'power-regulation-ic';
    if (/\b(transistor|mosfet)\b/.test(haystack)) return 'discrete-switch-ic';
    return 'logic-or-interface-ic';
  }
  if (part.category === 'power-comms') {
    if (/\b(battery|psu|barrel|terminal)\b/.test(haystack)) return 'power-source-or-connector';
    if (/\b(bluetooth|wifi|radio|lora|gsm)\b/.test(haystack)) return 'wireless-communication';
    return 'wired-communication';
  }
  if (part.category === 'prototyping') {
    if (/\b(breadboard|perfboard|pcb|shield)\b/.test(haystack)) return 'prototyping-surface';
    if (/\b(level shifter)\b/.test(haystack)) return 'level-shifter-interface';
    return 'connector-wiring';
  }
  return 'general-electronics';
}

function visualContextReason(
  part: VisualLibraryPart,
  supportTier: PartSupportTier,
  riskLevel: PartRiskLevel,
  family: string
) {
  if (supportTier === 'unsafe-blocked') {
    return `${part.name} is cataloged as ${family}, but it is safety-blocked for student simulation until mains/high-risk handling evidence exists.`;
  }
  if (supportTier === 'pin-known') {
    return `${part.name} is context-known with catalog pins and family/risk metadata, but it is not simulation-ready until validated topology, render footprint, and current-flow contracts are added.`;
  }
  return `${part.name} is context-known as ${family} with ${riskLevel} risk, but it is not simulation-ready until canonical agent evidence is added.`;
}

function countBySupportTier(parts: VisualLibraryContextPart[]): Record<PartSupportTier, number> {
  const counts = Object.fromEntries(VISUAL_SUPPORT_TIERS.map((tier) => [tier, 0])) as Record<PartSupportTier, number>;
  for (const part of parts) {
    counts[part.supportTier] += 1;
  }
  return counts;
}

function countByRiskLevel(parts: VisualLibraryContextPart[]): Record<PartRiskLevel, number> {
  const counts = Object.fromEntries(VISUAL_RISK_LEVELS.map((risk) => [risk, 0])) as Record<PartRiskLevel, number>;
  for (const part of parts) {
    counts[part.riskLevel] += 1;
  }
  return counts;
}

function visualPartSearchText(part: VisualLibraryPart) {
  return [
    part.id,
    part.name,
    part.category,
    part.description ?? '',
    part.model?.kind ?? '',
    ...part.pins.flatMap((pin) => [pin.name, pin.role])
  ].join(' ').toLowerCase();
}

export async function searchPartCapabilities(query: string, root = DEFAULT_CONTEXT_ROOT): Promise<PartCapability[]> {
  const normalizedTerms = tokenize(query);
  const parts = await getPartRegistry(root);
  const scored = parts
    .map((part) => ({ part, score: scorePart(part, normalizedTerms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.part.id.localeCompare(b.part.id));

  return scored.map((entry) => entry.part);
}

export async function auditCapabilityCoverage(
  capabilityId: string,
  root = DEFAULT_CONTEXT_ROOT
): Promise<CapabilityCoverageReport> {
  const [capabilities, parts, primitives, footprints, pinAliases, evalFixtures, sourceClaims, supportBundles] = await Promise.all([
    loadCapabilityGraph(root),
    getPartRegistry(root),
    loadSimulationPrimitives(root),
    loadRenderFootprints(root),
    loadPinAliases(root),
    loadContextSufficiencyFixtures(root),
    loadSourceClaims(root),
    loadHardwareSupportBundles(root)
  ]);

  const capability = capabilities.find((candidate) => candidate.id === capabilityId);
  const present = new Set<CapabilityArtifact>();
  const missing = new Set<CapabilityArtifact>();
  const details: string[] = [];

  if (!capability) {
    details.push(`Missing capability graph entry: ${capabilityId}`);
    for (const artifact of REQUIRED_CAPABILITY_ARTIFACTS) {
      missing.add(artifact);
    }
    return buildCoverageReport({
      capabilityId,
      supportLevel: null,
      present,
      missing,
      details
    });
  }

  present.add('capability-graph-entry');
  auditSourceClaims(capability, sourceClaims, supportBundles, present, missing, details);
  auditPartCapabilities(capability, parts, present, missing, details);
  auditPinAliases(pinAliases, present, missing, details);
  auditValidationRules(capability, primitives, present, missing, details);
  auditSimulationPrimitives(capability, primitives, present, missing, details);
  auditRenderFootprints(capability, parts, footprints, present, missing, details);
  auditEvalFixtures(capability, evalFixtures, present, missing, details);

  return buildCoverageReport({
    capabilityId,
    supportLevel: capability.supportLevel,
    present,
    missing,
    details
  });
}

export async function auditCapabilityPromotionGaps(root = DEFAULT_CONTEXT_ROOT): Promise<CapabilityPromotionGapReport> {
  const [capabilities, visualLibrary] = await Promise.all([
    loadCapabilityGraph(root),
    auditVisualLibraryExpansion(root)
  ]);
  const reports = await Promise.all(capabilities.map((capability) => auditCapabilityCoverage(capability.id, root)));
  const bySupportLevel = emptySupportLevelCounts();
  const byRecommendedSupportLevel = emptySupportLevelCounts();
  const gapBuckets = new Map<CapabilityArtifact, CapabilityPromotionGapBucket>();

  for (const capability of capabilities) {
    bySupportLevel[capability.supportLevel] += 1;
  }

  for (const report of reports) {
    byRecommendedSupportLevel[report.recommendedSupportLevel] += 1;
    for (const artifact of report.missing) {
      const bucket = gapBuckets.get(artifact) ?? {
        artifact,
        count: 0,
        capabilityIds: [],
        details: []
      };
      bucket.capabilityIds.push(report.capabilityId);
      bucket.details.push(...report.details.filter((detail) => detailForArtifact(detail, artifact)));
      gapBuckets.set(artifact, bucket);
    }
  }

  const gapsByArtifact = sortArtifacts([...gapBuckets.keys()]).map((artifact) => {
    const bucket = gapBuckets.get(artifact)!;
    const capabilityIds = [...new Set(bucket.capabilityIds)].sort();
    return {
      artifact,
      count: capabilityIds.length,
      capabilityIds,
      details: unique(bucket.details).sort()
    };
  });

  return {
    totalCapabilities: capabilities.length,
    bySupportLevel,
    byRecommendedSupportLevel,
    readyForSupported: reports
      .filter((report) => report.canBeSupported)
      .map((report) => report.capabilityId)
      .sort(),
    blockedFromSupported: reports
      .filter((report) => !report.canBeSupported)
      .map((report) => report.capabilityId)
      .sort(),
    gapsByArtifact,
    visualLibrary,
    reports: [...reports].sort((a, b) => a.capabilityId.localeCompare(b.capabilityId))
  };
}

export function clearContextCache() {
  cachedIndex = null;
  cachedParts = null;
  cachedRoutingMap = null;
  cachedContextV2Index = null;
  cachedContextV2Routes = null;
  clearCapabilityGraphCache();
  clearPinAliasCache();
  clearContextAssetCache();
}

export {
  loadCapabilityGraph,
  loadBreadboardGrid,
  loadPinAliases,
  loadRenderFootprints,
  loadSimulationPrimitives,
  loadTopologyTemplates,
  matchCapabilities,
  resolvePinAlias
};
export type { ResolvedPinAlias };

function allEntries(index: ContextIndex): ContextEntry[] {
  return [...index.memory, ...index.skills, ...index.references, ...index.data, ...index.routing];
}

function enrichContextEntry(entry: RawContextEntry, group: ContextEntryGroup): ContextEntry {
  const sourceType = entry.sourceType ?? inferSourceType(entry, group);
  const sourceId = entry.sourceId ?? canonicalSourceId(entry.id, sourceType, group);
  const aliases = unique([
    sourceId,
    `${sourceType}:${entry.id}`,
    ...derivedAliases(entry.id, sourceType),
    ...entry.aliases
  ]);

  return {
    ...entry,
    sourceId,
    aliases,
    sourceType,
    level: entry.level ?? inferLevel(entry.id, sourceType, group),
    tags: unique([
      sourceType,
      group,
      ...entry.id.split(/[-_:]/g).filter(Boolean),
      ...entry.tags
    ]),
    provides: entry.provides.length > 0 ? entry.provides : [inferProvidedArtifact(entry.id, sourceType)],
    loadWhen: entry.loadWhen.length > 0 ? entry.loadWhen : [`route.sourceIds includes ${sourceId} or one of its aliases`],
    canonical: entry.canonical ?? inferCanonical(entry.id),
    budget: entry.budget ?? inferBudget(sourceType, entry.id)
  };
}

function inferSourceType(entry: RawContextEntry, group: ContextEntryGroup): ContextEntry['sourceType'] {
  if (group === 'memory') return 'memory';
  if (group === 'skills') return 'skill';
  if (group === 'routing') return 'data';
  if (group === 'references') {
    return entry.id.includes('policy') ? 'policy' : 'reference';
  }
  if (['parts', 'part-capabilities', 'controller-boards', 'starter-kits', 'modules'].includes(entry.id)) {
    return 'registry';
  }
  if (['simulation-primitives', 'input-controls'].includes(entry.id)) {
    return 'simulation';
  }
  if (entry.id === 'render-footprints') {
    return 'rendering';
  }
  return 'data';
}

function canonicalSourceId(id: string, sourceType: ContextEntry['sourceType'], group: ContextEntryGroup) {
  if (id === 'agent-operating-memory') return 'memory:agent-operating-memory';
  if (id === 'simulation-primitives') return 'simulation:primitives';
  if (id === 'render-footprints') return 'rendering:render-footprints';
  if (group === 'routing') return `data:${id}`;
  return `${sourceType}:${id}`;
}

function derivedAliases(id: string, sourceType: ContextEntry['sourceType']) {
  const aliases: string[] = [];
  if (id === 'agent-operating-memory') aliases.push('memory:agent-rules');
  if (id === 'safety-policy') aliases.push('policy:safety');
  if (id === 'clarification-policy') aliases.push('policy:clarification');
  if (id === 'unsupported-request-policy') aliases.push('policy:unsupported');
  if (id === 'simulation-truthfulness-policy') aliases.push('policy:truthfulness', 'policy:simulation-truthfulness');
  if (id === 'part-capabilities') aliases.push('data:part-capabilities', 'registry:part-capabilities');
  if (id === 'simulation-primitives') aliases.push('data:simulation-primitives', 'simulation:simulation-primitives');
  if (id === 'render-footprints') aliases.push('data:render-footprints', 'rendering:render-footprint');
  if (sourceType === 'reference') aliases.push(`reference:${id}`);
  if (sourceType === 'policy') aliases.push(`policy:${id}`);
  if (sourceType === 'data') aliases.push(`data:${id}`);
  return aliases;
}

function inferLevel(id: string, sourceType: ContextEntry['sourceType'], group: ContextEntryGroup): ContextEntry['level'] {
  if (group === 'memory' || group === 'routing') return 'L0';
  if (sourceType === 'policy') return 'L1';
  if (sourceType === 'skill' || sourceType === 'reference') return 'L2';
  if (sourceType === 'simulation' || sourceType === 'rendering' || id.includes('eval')) return 'L4';
  return 'L3';
}

function inferProvidedArtifact(id: string, sourceType: ContextEntry['sourceType']) {
  const explicit: Record<string, string> = {
    'capability-graph': 'CapabilityGraph',
    'part-capabilities': 'PartCapability',
    'simulation-primitives': 'SimulationPrimitive',
    'render-footprints': 'RenderFootprint',
    'topology-templates': 'TopologyTemplate',
    'pin-aliases': 'PinAlias',
    'context-routing-map': 'ContextRoute',
    'retrieval-budget': 'RetrievalBudget'
  };
  return explicit[id] ?? `${sourceType}:context`;
}

function inferCanonical(id: string) {
  return !id.includes('prompts') && !id.startsWith('eval-');
}

function inferBudget(sourceType: ContextEntry['sourceType'], id: string): ContextRetrievalBudget {
  if (sourceType === 'memory' || sourceType === 'policy' || id.includes('routing')) return 'minimal';
  if (sourceType === 'skill' || sourceType === 'reference') return 'summary';
  if (sourceType === 'simulation' || sourceType === 'rendering') return 'full';
  return 'data-only';
}

function sourceIdCandidates(sourceId: string) {
  const candidates = [sourceId];
  if (sourceId.startsWith('rendering:render-footprint:')) {
    candidates.push('rendering:render-footprints');
  }
  if (sourceId.startsWith('data:render-footprints:')) {
    candidates.push('data:render-footprints', 'rendering:render-footprints');
  }
  if (sourceId.startsWith('data:simulation-primitives:')) {
    candidates.push('data:simulation-primitives', 'simulation:primitives');
  }
  if (sourceId.startsWith('data:capability-graph:')) {
    candidates.push('data:capability-graph');
  }
  if (sourceId.startsWith('registry:part-capabilities:')) {
    candidates.push('registry:part-capabilities');
  }

  const parts = sourceId.split(':');
  if (parts.length > 2) {
    candidates.push(parts.slice(0, 2).join(':'));
  }
  return unique(candidates);
}

async function loadContextSufficiencyFixtures(root: string): Promise<ContextSufficiencyFixture[]> {
  const index = await loadContextIndex(root);
  const entry = index.data.find((candidate) => candidate.id === 'context-sufficiency-prompts');
  if (!entry) {
    throw new Error('Context index is missing context-sufficiency-prompts data entry');
  }

  const content = await readFile(path.join(root, entry.path), 'utf8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ContextSufficiencyFixtureSchema.parse(JSON.parse(line)));
}

async function loadVisualLibraryCrosswalk(root: string): Promise<VisualLibraryCrosswalk> {
  const index = await loadContextIndex(root);
  const entry = index.data.find((candidate) => candidate.id === 'visual-library-crosswalk');
  if (!entry) {
    throw new Error('Context index is missing visual-library-crosswalk data entry');
  }

  const content = await readFile(path.join(root, entry.path), 'utf8');
  return VisualLibraryCrosswalkSchema.parse(JSON.parse(content));
}

async function loadVisualLibraryParts(visualLibraryModule: string): Promise<VisualLibraryPart[]> {
  const moduleUrl = pathToFileURL(visualLibraryModule).href;
  const visualLibraryModuleExports = await import(moduleUrl);
  return z.array(VisualLibraryPartSchema).parse(visualLibraryModuleExports.PART_LIBRARY);
}

function auditPartCapabilities(
  capability: CapabilityGraphEntry,
  parts: PartCapability[],
  present: Set<CapabilityArtifact>,
  missing: Set<CapabilityArtifact>,
  details: string[]
) {
  const partIds = new Set(parts.map((part) => part.id));
  const missingRequiredParts = capability.requiredParts.filter((partId) => !partIds.has(partId));
  if (missingRequiredParts.length === 0) {
    present.add('part-capability');
    return;
  }

  missing.add('part-capability');
  details.push(`Missing required part capabilities: ${missingRequiredParts.join(', ')}`);
}

function auditSourceClaims(
  capability: CapabilityGraphEntry,
  sourceClaims: Awaited<ReturnType<typeof loadSourceClaims>>,
  supportBundles: Awaited<ReturnType<typeof loadHardwareSupportBundles>>,
  present: Set<CapabilityArtifact>,
  missing: Set<CapabilityArtifact>,
  details: string[]
) {
  const claimIds = new Set(sourceClaims.map((claim) => claim.claimId));
  const supportBundle = supportBundles.find((bundle) => bundle.capabilityId === capability.id);
  const missingClaimIds = supportBundle?.sourceClaimIds.filter((claimId) => !claimIds.has(claimId)) ?? [];

  if (
    supportBundle
    && supportBundle.requiredArtifacts.includes('source-claims')
    && supportBundle.sourceClaimIds.length > 0
    && missingClaimIds.length === 0
  ) {
    present.add('source-claims');
    return;
  }

  missing.add('source-claims');
  if (!supportBundle) {
    details.push(`Missing source-claim support bundle for ${capability.id}.`);
  } else if (!supportBundle.requiredArtifacts.includes('source-claims')) {
    details.push(`Support bundle for ${capability.id} does not require source-claims.`);
  } else if (supportBundle.sourceClaimIds.length === 0) {
    details.push(`Support bundle for ${capability.id} has no source claim IDs.`);
  } else {
    details.push(`Missing source-claim IDs for ${capability.id}: ${missingClaimIds.join(', ')}`);
  }
}

function auditPinAliases(
  pinAliases: Record<string, string[]>,
  present: Set<CapabilityArtifact>,
  missing: Set<CapabilityArtifact>,
  details: string[]
) {
  if (Object.keys(pinAliases).length > 0) {
    present.add('pin-aliases');
    return;
  }

  missing.add('pin-aliases');
  details.push('Pin alias ontology is empty.');
}

function auditValidationRules(
  capability: CapabilityGraphEntry,
  primitives: SimulationPrimitive[],
  present: Set<CapabilityArtifact>,
  missing: Set<CapabilityArtifact>,
  details: string[]
) {
  const primitiveById = new Map(primitives.map((primitive) => [primitive.id, primitive]));
  const primitiveRules = capability.simulationPrimitives
    .flatMap((primitiveId) => primitiveById.get(primitiveId)?.validationRules ?? []);
  const validationRules = unique([...capability.validationRules, ...primitiveRules]);
  const unsupportedRules = validationRules.filter((rule) => !SUPPORTED_VALIDATION_RULES.has(rule));

  if (validationRules.length > 0 && unsupportedRules.length === 0) {
    present.add('validation-rule');
    return;
  }

  missing.add('validation-rule');
  if (validationRules.length === 0) {
    details.push(`Capability ${capability.id} declares no validation rules.`);
  } else {
    details.push(`Unsupported validation rules for ${capability.id}: ${unsupportedRules.join(', ')}`);
  }
}

function auditSimulationPrimitives(
  capability: CapabilityGraphEntry,
  primitives: SimulationPrimitive[],
  present: Set<CapabilityArtifact>,
  missing: Set<CapabilityArtifact>,
  details: string[]
) {
  const primitiveIds = new Set(primitives.map((primitive) => primitive.id));
  const missingPrimitiveIds = capability.simulationPrimitives.filter((primitiveId) => !primitiveIds.has(primitiveId));
  if (capability.simulationPrimitives.length > 0 && missingPrimitiveIds.length === 0) {
    present.add('simulation-primitive');
    return;
  }

  missing.add('simulation-primitive');
  if (capability.simulationPrimitives.length === 0) {
    details.push(`Capability ${capability.id} declares no simulation primitives.`);
  } else {
    details.push(`Missing simulation primitives for ${capability.id}: ${missingPrimitiveIds.join(', ')}`);
  }
}

function auditRenderFootprints(
  capability: CapabilityGraphEntry,
  parts: PartCapability[],
  footprints: Record<string, unknown>,
  present: Set<CapabilityArtifact>,
  missing: Set<CapabilityArtifact>,
  details: string[]
) {
  const partById = new Map(parts.map((part) => [part.id, part]));
  const footprintIds = new Set(Object.keys(footprints));
  const missingCapabilityFootprints = capability.renderFootprints.filter((footprintId) => !footprintIds.has(footprintId));
  const missingRequiredPartFootprints = capability.requiredParts.flatMap((partId) => {
    const part = partById.get(partId);
    if (!part) {
      return [`${partId}:part-missing`];
    }
    return footprintIds.has(part.renderFootprint.type) ? [] : [`${partId}:${part.renderFootprint.type}`];
  });
  const missingFootprints = [...missingCapabilityFootprints, ...missingRequiredPartFootprints];

  if (capability.renderFootprints.length > 0 && missingFootprints.length === 0) {
    present.add('render-footprint');
    return;
  }

  missing.add('render-footprint');
  if (capability.renderFootprints.length === 0) {
    details.push(`Capability ${capability.id} declares no render footprints.`);
  } else {
    details.push(`Missing render footprints for ${capability.id}: ${missingFootprints.join(', ')}`);
  }
}

function auditEvalFixtures(
  capability: CapabilityGraphEntry,
  fixtures: ContextSufficiencyFixture[],
  present: Set<CapabilityArtifact>,
  missing: Set<CapabilityArtifact>,
  details: string[]
) {
  const hasSupportedPrompt = fixtures.some((fixture) =>
    fixture.expectedCapabilityIds.includes(capability.id)
    && !fixture.expectedAmbiguity
    && fixture.expectedSupportGapPatterns.length === 0
    && fixture.expectedUnsupportedSignalPatterns.length === 0
  );
  const hasUnsupportedCounterexample = fixtures.some((fixture) =>
    fixture.forbiddenCapabilityIds.includes(capability.id)
  );
  const hasBrowserVisibleVerification = fixtures.some((fixture) =>
    fixture.expectedCapabilityIds.includes(capability.id)
    && fixture.expectedCoverageStatus === 'sufficient'
    && fixture.expectedSynthesisEligibility === 'eligible'
    && fixture.expectedBrowserOutcome === 'render-and-run-valid-simulation'
  );

  if (hasSupportedPrompt) {
    present.add('eval-supported-prompt');
  } else {
    missing.add('eval-supported-prompt');
    details.push(`Missing supported eval prompt for ${capability.id}.`);
  }

  if (hasUnsupportedCounterexample) {
    present.add('eval-unsupported-counterexample');
  } else {
    missing.add('eval-unsupported-counterexample');
    details.push(`Missing unsupported counterexample eval for ${capability.id}.`);
  }

  if (hasBrowserVisibleVerification) {
    present.add('browser-visible-verification');
  } else {
    missing.add('browser-visible-verification');
    details.push(`Missing browser-visible verification evidence for ${capability.id}.`);
  }
}

function buildCoverageReport(input: {
  capabilityId: string;
  supportLevel: CapabilityCoverageReport['supportLevel'];
  present: Set<CapabilityArtifact>;
  missing: Set<CapabilityArtifact>;
  details: string[];
}): CapabilityCoverageReport {
  return {
    capabilityId: input.capabilityId,
    supportLevel: input.supportLevel,
    recommendedSupportLevel: recommendSupportLevel(input.supportLevel, input.missing),
    canBeSupported: input.missing.size === 0,
    present: sortArtifacts([...input.present]),
    missing: sortArtifacts([...input.missing]),
    details: input.details
  };
}

function recommendSupportLevel(
  currentSupportLevel: CapabilityCoverageReport['supportLevel'],
  missing: Set<CapabilityArtifact>
): CapabilityCoverageReport['recommendedSupportLevel'] {
  if (currentSupportLevel === 'unsupported') {
    return 'unsupported';
  }
  if (missing.size === 0) {
    return 'supported';
  }
  return 'planned';
}

function emptySupportLevelCounts(): Record<CapabilitySupportLevel, number> {
  return {
    supported: 0,
    partial: 0,
    planned: 0,
    unsupported: 0
  };
}

function detailForArtifact(detail: string, artifact: CapabilityArtifact) {
  const normalized = detail.toLowerCase();
  const patterns: Record<CapabilityArtifact, RegExp> = {
    'capability-graph-entry': /capability graph/,
    'source-claims': /source-claim|support bundle/,
    'part-capability': /part capabilit|required part/,
    'pin-aliases': /pin alias/,
    'validation-rule': /validation rule|unsupported validation|declares no validation/,
    'simulation-primitive': /simulation primitive/,
    'render-footprint': /render footprint|footprint/,
    'eval-supported-prompt': /supported eval prompt/,
    'eval-unsupported-counterexample': /unsupported counterexample/,
    'browser-visible-verification': /browser-visible verification/
  };
  return patterns[artifact].test(normalized);
}

function sortArtifacts(artifacts: CapabilityArtifact[]) {
  const order = new Map(REQUIRED_CAPABILITY_ARTIFACTS.map((artifact, index) => [artifact, index]));
  return [...artifacts].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9/+.-]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function normalizeVisualQuery(query: string) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function visualPartMatches(part: VisualLibraryPart, normalizedQuery: string, queryTerms: Set<string>) {
  if (
    part.id === '7seg-1digit'
    && /\b(tm1637|4\s*digit|4\s*자리|four\s*digit|max7219|matrix)\b/i.test(normalizedQuery)
  ) {
    return false;
  }

  const idPhrase = normalizeVisualQuery(part.id);
  const namePhrase = normalizeVisualQuery(part.name);
  const idTerms = tokenize(part.id).filter((term) => !VISUAL_LIBRARY_STOP_TERMS.has(term));
  const nameTerms = tokenize(part.name).filter((term) => !VISUAL_LIBRARY_STOP_TERMS.has(term));
  const distinctiveTerms = unique([...idTerms, ...nameTerms]).filter((term) => term.length >= 3 || /\d/.test(term));

  if (idPhrase.length >= 3 && normalizedQuery.includes(idPhrase)) {
    return true;
  }
  if (namePhrase.length >= 3 && normalizedQuery.includes(namePhrase)) {
    return true;
  }
  if (distinctiveTerms.some((term) => isSpecificModelToken(term) && queryTerms.has(term))) {
    return true;
  }

  const idCore = idTerms.slice(0, 2);
  if (idCore.length >= 2 && idCore.every((term) => queryTerms.has(term))) {
    return true;
  }

  const nameCore = nameTerms.slice(0, 2);
  return nameCore.length >= 2 && nameCore.every((term) => queryTerms.has(term));
}

const VISUAL_LIBRARY_STOP_TERMS = new Set([
  'the',
  'and',
  'with',
  'for',
  'module',
  'sensor',
  'board',
  'component',
  'device',
  'circuit'
]);

const VISUAL_LIBRARY_GENERIC_MODEL_TERMS = new Set([
  'i2c',
  'spi',
  'pwm',
  'uart',
  'gpio',
  '3v3',
  '5v',
  '12v'
]);

function isSpecificModelToken(term: string) {
  return /[a-z]/.test(term)
    && /\d/.test(term)
    && !VISUAL_LIBRARY_GENERIC_MODEL_TERMS.has(term);
}

function mentionSortKey(mention: VisualLibraryPartMention) {
  const statusRank: Record<VisualLibraryPartMention['status'], number> = {
    'unsafe-blocked': 0,
    'context-known': 1,
    'catalog-only': 2,
    'agent-ready': 3
  };
  return `${statusRank[mention.status]}:${mention.visualPartId}`;
}

function scorePart(part: PartCapability, terms: string[]): number {
  const searchable = [
    part.id,
    part.kind,
    part.label,
    ...part.aliases,
    ...part.pins.flatMap((pin) => [pin.name, pin.role, ...pin.aliases]),
    ...part.protocols
  ].map((value) => value.toLowerCase());

  let score = 0;
  for (const term of terms) {
    for (const value of searchable) {
      if (value === term) {
        score += 4;
      } else if (term.length >= 4 && value.length >= 4 && (value.includes(term) || term.includes(value))) {
        score += 1;
      }
    }
  }
  return score;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

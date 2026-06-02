import { loadCapabilityGraph } from './capabilityGraph.ts';
import { loadRenderFootprints, loadSimulationPrimitives, loadTopologyTemplates } from './contextAssets.ts';
import { getPartRegistry, loadContextBundleV2, loadContextV2Index } from './contextLayer.ts';
import { loadHardwareSupportBundles, loadSourceClaims, type HardwareSupportBundle } from './sourceClaims.ts';

export async function buildContextV2Audit(root?: string) {
  const [
    capabilities,
    index,
    parts,
    renderFootprints,
    simulationPrimitives,
    topologyTemplates,
    sourceClaims,
    supportBundles
  ] = await Promise.all([
    loadCapabilityGraph(root),
    loadContextV2Index(root),
    getPartRegistry(root),
    loadRenderFootprints(root),
    loadSimulationPrimitives(root),
    loadTopologyTemplates(root),
    loadSourceClaims(root),
    loadHardwareSupportBundles(root)
  ]);
  const bundleCapabilityIds = new Set(index.bundles.map((bundle) => bundle.capabilityId));
  const manifests = await Promise.all(index.bundles.map((bundle) => loadContextBundleV2(bundle.bundleId, root)));
  const registries = {
    parts: new Set(parts.map((part) => part.id)),
    footprints: new Set(Object.keys(renderFootprints)),
    simulation: new Set(simulationPrimitives.map((primitive) => primitive.id)),
    topology: new Set(topologyTemplates.map((template) => template.id)),
    sources: new Set(sourceClaims.map((claim) => claim.claimId))
  };
  const supportBundleByCapability = new Map(supportBundles.map((bundle) => [bundle.capabilityId, bundle]));

  return {
    totalCapabilities: capabilities.length,
    totalV2Bundles: index.bundles.length,
    migratedCapabilityIds: capabilities
      .filter((capability) => bundleCapabilityIds.has(capability.id))
      .map((capability) => capability.id)
      .sort(),
    missingBundleCapabilityIds: capabilities
      .filter((capability) => !bundleCapabilityIds.has(capability.id))
      .map((capability) => capability.id)
      .sort(),
    supportedV2BundleIds: manifests
      .filter((bundle) => bundle.manifest.supportLevel === 'supported')
      .map((bundle) => bundle.manifest.bundleId)
      .sort(),
    plannedV2BundleIds: manifests
      .filter((bundle) => bundle.manifest.supportLevel === 'planned')
      .map((bundle) => bundle.manifest.bundleId)
      .sort(),
    manifestConsistency: manifests
      .map((bundle) => ({
        bundleId: bundle.manifest.bundleId,
        capabilityId: bundle.manifest.capabilityId,
        missingCanonicalRefs: missingCanonicalRefs(bundle.manifest),
        unresolvedCanonicalRefs: unresolvedCanonicalRefs(bundle.manifest, registries),
        sourceRefMismatches: sourceRefMismatches(
          bundle.manifest,
          supportBundleByCapability.get(bundle.manifest.capabilityId)
        ),
        blockingConditionIssues: blockingConditionIssues(bundle.manifest)
      }))
      .sort((a, b) => a.bundleId.localeCompare(b.bundleId))
  };
}

type ContextV2Manifest = Awaited<ReturnType<typeof loadContextBundleV2>>['manifest'];
type ContextV2Audit = Awaited<ReturnType<typeof buildContextV2Audit>>;

type CanonicalRegistries = {
  parts: Set<string>;
  footprints: Set<string>;
  simulation: Set<string>;
  topology: Set<string>;
  sources: Set<string>;
};

function missingCanonicalRefs(manifest: ContextV2Manifest) {
  return [
    ...missingRefs('parts', manifest.requiredParts, manifest.canonicalRefs.parts),
    ...missingRefs('footprints', manifest.renderFootprints, manifest.canonicalRefs.footprints),
    ...missingRefs('simulation', manifest.simulationPrimitives, manifest.canonicalRefs.simulation),
    ...missingRefs('topology', manifest.requiredTopologies, manifest.canonicalRefs.topology)
  ];
}

function missingRefs(kind: string, expected: string[], refs: string[]) {
  const refIds = new Set(refs.map(canonicalRefId));
  return expected
    .filter((id) => !refIds.has(id))
    .map((id) => `${kind}:${id}`);
}

function unresolvedCanonicalRefs(manifest: ContextV2Manifest, registries: CanonicalRegistries) {
  return [
    ...unresolvedRefs('parts', manifest.canonicalRefs.parts, registries.parts, 'parts'),
    ...unresolvedRefs('footprints', manifest.canonicalRefs.footprints, registries.footprints, 'footprint'),
    ...unresolvedRefs('simulation', manifest.canonicalRefs.simulation, registries.simulation, 'primitive'),
    ...unresolvedRefs('topology', manifest.canonicalRefs.topology, registries.topology, 'topology'),
    ...unresolvedRefs('sources', manifest.canonicalRefs.sources, registries.sources, 'source')
  ];
}

function unresolvedRefs(kind: string, refs: string[], knownIds: Set<string>, expectedRefKind: string) {
  return refs
    .filter((ref) => canonicalRefKind(ref) !== expectedRefKind || !knownIds.has(canonicalRefId(ref)))
    .map((ref) => `${kind}:${ref}`);
}

function sourceRefMismatches(manifest: ContextV2Manifest, legacyBundle?: HardwareSupportBundle) {
  if (manifest.supportLevel !== 'supported') {
    return [];
  }

  if (!legacyBundle) {
    return [`legacy-support-bundle-missing:${manifest.capabilityId}`];
  }

  const legacySourceIds = new Set(legacyBundle.sourceClaimIds);
  const manifestSourceIds = new Set(manifest.canonicalRefs.sources.map(canonicalRefId));

  return [
    ...legacyBundle.sourceClaimIds
      .filter((claimId) => !manifestSourceIds.has(claimId))
      .map((claimId) => `legacy-source-missing-in-v2:${claimId}`),
    ...[...manifestSourceIds]
      .filter((claimId) => !legacySourceIds.has(claimId))
      .map((claimId) => `v2-source-missing-in-legacy:${claimId}`)
  ];
}

function blockingConditionIssues(manifest: ContextV2Manifest) {
  if (manifest.supportLevel !== 'supported' || manifest.blockingConditions.length > 0) {
    return [];
  }

  return ['supported-bundle-missing-blocking-conditions'];
}

function canonicalRefId(ref: string) {
  const [, , ...idParts] = ref.split(':');
  return idParts.length > 0 ? idParts.join(':') : ref;
}

function canonicalRefKind(ref: string) {
  const [, kind] = ref.split(':');
  return kind ?? '';
}

export function contextV2AuditHasFailures(audit: ContextV2Audit) {
  return audit.manifestConsistency.some((entry) =>
    entry.missingCanonicalRefs.length > 0
    || entry.unresolvedCanonicalRefs.length > 0
    || entry.sourceRefMismatches.length > 0
    || entry.blockingConditionIssues.length > 0
  );
}

import {
  loadHardwareSupportBundles,
  loadSourceClaims,
  type SourceClaim
} from './sourceClaims.ts';
import {
  loadRenderFootprints,
  loadSimulationPrimitives,
  loadTopologyTemplates
} from './contextAssets.ts';
import { loadCapabilityGraph } from './capabilityGraph.ts';
import { getPartRegistry } from './contextLayer.ts';

export type SourceClaimIntegrityIssue = {
  severity: 'error' | 'warning';
  claimId: string;
  message: string;
};

export type SourceClaimIntegrityReport = {
  totalClaims: number;
  issueCount: number;
  issues: SourceClaimIntegrityIssue[];
};

export async function buildSourceClaimIntegrityReport(): Promise<SourceClaimIntegrityReport> {
  const [claims, bundles, parts, primitives, topologies, footprints, capabilities] = await Promise.all([
    loadSourceClaims(),
    loadHardwareSupportBundles(),
    getPartRegistry(),
    loadSimulationPrimitives(),
    loadTopologyTemplates(),
    loadRenderFootprints(),
    loadCapabilityGraph()
  ]);
  const issues: SourceClaimIntegrityIssue[] = [];
  const claimById = new Map(claims.map((claim) => [claim.claimId, claim]));
  const subjectIds = new Set<string>([
    ...capabilities.map((capability) => capability.id),
    ...Object.keys(footprints),
    ...primitives.map((primitive) => primitive.id),
    ...topologies.map((topology) => topology.id)
  ]);

  for (const capability of capabilities) {
    for (const id of [
      ...capability.inputModalities,
      ...capability.outputModalities,
      ...capability.requiredRoles,
      ...capability.requiredParts,
      ...capability.optionalParts,
      ...capability.protocols,
      ...capability.simulationPrimitives,
      ...capability.renderFootprints,
      ...capability.validationRules
    ]) {
      subjectIds.add(id);
    }
  }

  for (const part of parts) {
    subjectIds.add(part.id);
    for (const visualPartId of part.visualPartIds) {
      subjectIds.add(visualPartId);
    }
    for (const pin of part.pins) {
      subjectIds.add(`${part.id}:${pin.name}`);
      subjectIds.add(`${part.id}.${pin.name}`);
    }
    for (const id of [
      ...part.capabilities,
      ...part.compatibleTopologies,
      ...part.compatibleSimulationPrimitives,
      ...part.requiredExternalParts
    ]) {
      subjectIds.add(id);
    }
  }

  for (const primitive of primitives) {
    for (const id of [
      ...primitive.inputs,
      ...primitive.outputs,
      ...primitive.requiredNetRoles,
      ...primitive.requiredComponentCapabilities,
      ...primitive.validationRules,
      primitive.currentPathRecipe.type,
      primitive.expectedStateRecipe.type
    ]) {
      subjectIds.add(id);
    }
  }

  for (const topology of topologies) {
    for (const id of [
      ...topology.requiredRoles,
      ...topology.validationRules,
      ...topology.simulationPrimitiveHints
    ]) {
      subjectIds.add(id);
    }
  }

  for (const bundle of bundles) {
    for (const claimId of bundle.sourceClaimIds) {
      if (!claimById.has(claimId)) {
        issues.push({
          severity: 'error',
          claimId,
          message: `Missing source claim referenced by ${bundle.bundleId}.`
        });
      }
    }
  }

  for (const claim of claims) {
    if (!subjectIds.has(claim.subjectId)) {
      issues.push({
        severity: isSemanticContractSubject(claim) ? 'warning' : 'error',
        claimId: claim.claimId,
        message: isSemanticContractSubject(claim)
          ? `Semantic contract subject is not a concrete context asset: ${claim.subjectId}.`
          : `Claim subject does not resolve: ${claim.subjectId}.`
      });
    }
    issues.push(...tierAuthorizationIssues(claim));
  }

  return {
    totalClaims: claims.length,
    issueCount: issues.length,
    issues
  };
}

function isSemanticContractSubject(claim: SourceClaim) {
  return claim.subjectType === 'simulation' || claim.subjectType === 'validation-rule';
}

function tierAuthorizationIssues(claim: SourceClaim): SourceClaimIntegrityIssue[] {
  const needsExternalAuthority = claim.claimType === 'pin-map'
    || claim.claimType === 'electrical-limit'
    || claim.claimType === 'protocol-support';
  if (needsExternalAuthority && claim.sourceTier === 'h-eduware-derived') {
    return [{
      severity: 'warning',
      claimId: claim.claimId,
      message: `${claim.claimType} should be backed by manufacturer, vendor, EDA, or educational reference evidence before it authorizes supported synthesis.`
    }];
  }
  return [];
}

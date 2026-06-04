// Prompt presentation for the context packet. Extracted verbatim from contextPacket.ts
// (PLAN_god_module_refactor, Phase C.1). Pure relocation — no behavior change.
import type {
  AgentConversationContext,
  CapabilityGraphEntry,
  ContextCoverageReport,
  ContextRoute,
  ContextTraceEntry,
  IntentSpecV2,
  PartCapability,
  RenderFootprintEntry,
  RetrievalPlan,
  SimulationPrimitive,
  SupportBundleEvidence
} from '../agent/schemas.ts';
import type { ContextBundleV2, VisualLibraryPartMention } from './contextLayer.ts';
import type { inferIntentHints } from './contextIntent.ts';

export function renderPromptBlock({
  locale,
  message,
  conversationContext,
  intentSpec,
  intentHints,
  capabilityMatches,
  candidateParts,
  simulationPrimitives,
  renderFootprints,
  requiredContextIds,
  unsupportedSignals,
  supportGaps,
  visualLibraryMentions,
  selectedBundles,
  supportBundles,
  contextRoute,
  retrievalPlan,
  contextTrace,
  contextCoverage
}: {
  locale: 'ko' | 'en';
  message: string;
  conversationContext?: AgentConversationContext;
  intentSpec: IntentSpecV2;
  intentHints: ReturnType<typeof inferIntentHints>;
  capabilityMatches: CapabilityGraphEntry[];
  candidateParts: PartCapability[];
  simulationPrimitives: SimulationPrimitive[];
  renderFootprints: RenderFootprintEntry[];
  requiredContextIds: string[];
  unsupportedSignals: string[];
  supportGaps: string[];
  visualLibraryMentions: VisualLibraryPartMention[];
  selectedBundles: ContextBundleV2[];
  supportBundles: SupportBundleEvidence[];
  contextRoute: ContextRoute;
  retrievalPlan: RetrievalPlan;
  contextTrace: ContextTraceEntry[];
  contextCoverage: ContextCoverageReport;
}) {
  const isV2Prompt = selectedBundles.length > 0 || contextRoute.routeId.startsWith('v2-');
  const isV2PolicyOnlyPrompt = isV2Prompt && selectedBundles.length === 0;
  const capabilities = capabilityMatches.map((capability) =>
    isV2PolicyOnlyPrompt
      ? {
          id: capability.id,
          supportLevel: capability.supportLevel,
          unsupportedReason: capability.unsupportedReason
        }
      : {
          id: capability.id,
          supportLevel: capability.supportLevel,
          inputModalities: capability.inputModalities,
          outputModalities: capability.outputModalities,
          requiredParts: capability.requiredParts,
          protocols: capability.protocols,
          simulationPrimitives: capability.simulationPrimitives,
          renderFootprints: capability.renderFootprints,
          validationRules: capability.validationRules,
          unsupportedReason: capability.unsupportedReason
        }
  );
  const parts = isV2Prompt
    ? candidateParts.map((part) => ({
        id: part.id,
        pins: part.pins.map((pin) => `${pin.name}:${pin.role}`),
        protocols: part.protocols,
        requiredPassives: part.requiredPassives.map((passive) => passive.partId)
      }))
    : candidateParts.map((part) => ({
        id: part.id,
        kind: part.kind,
        supportLevel: part.supportLevel,
        capabilities: part.capabilities,
        pins: part.pins.map((pin) => `${pin.name}:${pin.role}`),
        protocols: part.protocols,
        requiredPassives: part.requiredPassives.map((passive) => passive.partId),
        simulationModel: part.simulationModel.type,
        compatibleSimulationPrimitives: part.compatibleSimulationPrimitives,
        renderFootprint: part.renderFootprint.type
      }));
  const primitiveContracts = isV2Prompt
    ? compactPrimitiveContractsForV2(simulationPrimitives)
    : simulationPrimitives.map((primitive) => ({
        id: primitive.id,
        requiredNetRoles: primitive.requiredNetRoles,
        validationRules: primitive.validationRules,
        currentPathRecipe: primitive.currentPathRecipe,
        expectedStateRecipe: primitive.expectedStateRecipe,
        uiControls: primitive.uiControls.map((control) => ({
          id: control.id,
          type: control.type,
          affects: control.affects
        })),
        animationCues: primitive.animationCues,
        renderOverlays: primitive.renderOverlays,
        limitations: primitive.limitations
      }));
  const footprintAnchors = isV2Prompt
    ? compactFootprintsForV2(renderFootprints)
    : renderFootprints.map((footprint) => ({
        type: footprint.type,
        pinAnchors: Object.fromEntries(
          Object.entries(footprint.pinAnchors).map(([pin, anchor]) => [
            pin,
            {
              role: anchor.role,
              label: anchor.label
            }
          ])
        ),
        placement: {
          allowedSurfaces: footprint.placement.allowedSurfaces,
          breadboardCompatible: footprint.placement.breadboardCompatible,
          defaultOrientation: footprint.placement.defaultOrientation
        },
        simulationOverlayAnchors: footprint.simulationOverlayAnchors
      }));
  const visualMentions = isV2Prompt
    ? visualLibraryMentions.map((mention) => ({
        visualPartId: mention.visualPartId,
        status: mention.status,
        supportTier: mention.supportTier,
        riskLevel: mention.riskLevel,
        family: mention.family,
        agentPartId: mention.agentPartId
      }))
    : visualLibraryMentions.map((mention) => ({
        visualPartId: mention.visualPartId,
        visualPartName: mention.visualPartName,
        visualCategory: mention.visualCategory,
        status: mention.status,
        supportTier: mention.supportTier,
        riskLevel: mention.riskLevel,
        family: mention.family,
        agentPartId: mention.agentPartId,
        reason: mention.reason
      }));
  const visualMentionSummary = isV2Prompt
    ? visualLibraryMentions
        .map(
          (mention) =>
            `${mention.visualPartId}:${mention.status}/${mention.supportTier}/${mention.family}${mention.agentPartId ? `->${mention.agentPartId}` : ''}`
        )
        .join('; ') || 'none'
    : JSON.stringify(visualMentions, null, 2);
  const selectedBundleSummaries =
    selectedBundles.length > 0
      ? selectedBundles
          .map((bundle) =>
            [
              `## ${bundle.manifest.bundleId}`,
              bundle.summary,
              `supportLevel=${bundle.manifest.supportLevel}`,
              `allowedParts=${bundle.manifest.allowedParts.join(', ') || 'none'}`,
              `validationRules=${bundle.manifest.validationRules.join(', ') || 'none'}`,
              `simulationPrimitives=${bundle.manifest.simulationPrimitives.join(', ') || 'none'}`
            ].join('\n')
          )
          .join('\n\n')
      : 'none';
  const supportGapSummary =
    supportGaps.length > 0
      ? `Capability support gaps: ${(isV2Prompt ? supportGaps.map(compactSupportGapForV2) : supportGaps).join(' | ')}`
      : 'Capability support gaps: none';
  const supportBundleSummary = isV2Prompt
    ? supportBundles
        .map((bundle) =>
          bundle.status === 'complete'
            ? `${bundle.capabilityId}=complete`
            : `${bundle.capabilityId}=${bundle.status}(${bundle.supportLevel}; missing=${bundle.missingArtifacts.join(', ') || 'bundle'})`
        )
        .join('; ')
    : supportBundles.map((bundle) => ({
        capabilityId: bundle.capabilityId,
        bundleId: bundle.bundleId,
        supportLevel: bundle.supportLevel,
        status: bundle.status,
        requiredParts: bundle.requiredParts,
        missingArtifacts: bundle.missingArtifacts,
        sourceClaimIds: bundle.sourceClaimIds,
        sourceTiers: bundle.sourceTiers,
        promptSummary: bundle.promptSummary
      }));
  const capabilityBlock = isV2Prompt
    ? compactCapabilityMatchesPromptForV2(capabilityMatches)
    : JSON.stringify(capabilities, null, 2);
  const partBlock = isV2Prompt
    ? compactCandidatePartsPromptForV2(candidateParts)
    : JSON.stringify(parts, null, 2);
  const primitiveBlock = isV2Prompt
    ? compactPrimitivePromptForV2(simulationPrimitives)
    : JSON.stringify(primitiveContracts, null, 2);
  const footprintBlock = isV2Prompt
    ? compactFootprintPromptForV2(renderFootprints)
    : JSON.stringify(footprintAnchors, null, 2);
  const contextRouteBlock = isV2Prompt
    ? `${contextRoute.routeId}; capabilities=${contextRoute.capabilityIds.join(', ') || 'none'}; confidence=${contextRoute.confidence}; reason=${contextRoute.reason}`
    : JSON.stringify(contextRoute, null, 2);
  const retrievalPlanBlock = isV2Prompt
    ? `budget=${retrievalPlan.budget}; maxPromptChars=${retrievalPlan.maxPromptChars}; sources=${retrievalPlan.sourceIds.join(', ') || 'none'}`
    : JSON.stringify(retrievalPlan, null, 2);

  return [
    '## CONTEXT PACKET',
    `Locale: ${locale}`,
    `Student message: ${message}`,
    '',
    'Current artifact context:',
    renderConversationContextForPrompt(conversationContext),
    '',
    'Intent spec:',
    JSON.stringify(intentSpec, null, 2),
    '',
    'Intent hints:',
    JSON.stringify(intentHints, null, 2),
    '',
    'Context route:',
    contextRouteBlock,
    '',
    'Retrieval plan:',
    retrievalPlanBlock,
    '',
    'Selected context bundles:',
    selectedBundleSummaries,
    '',
    'Verified support data:',
    supportBundles.length > 0
      ? isV2Prompt
        ? supportBundleSummary
        : JSON.stringify(supportBundleSummary, null, 2)
      : 'none',
    '',
    unsupportedSignals.length > 0
      ? `Unsupported or unsafe signals detected before synthesis: ${unsupportedSignals.join(', ')}`
      : 'Unsupported or unsafe signals detected before synthesis: none',
    '',
    'Capability graph matches:',
    capabilityBlock,
    '',
    'Visual library hardware mentions:',
    visualMentionSummary,
    '',
    supportGapSummary,
    '',
    'Candidate canonical hardware capabilities:',
    partBlock,
    '',
    'Simulation primitive contracts:',
    primitiveBlock,
    '',
    'Render footprint anchors:',
    footprintBlock,
    '',
    `Required context documents: ${requiredContextIds.join(', ')}`,
    '',
    'Context trace evidence:',
    isV2Prompt
      ? contextTrace.map((entry) => `- ${entry.sourceId}`).join('\n')
      : contextTrace.map((entry) => `- ${entry.sourceId}: ${entry.reason}`).join('\n'),
    '',
    'Context coverage:',
    renderContextCoverageForPrompt(contextCoverage, isV2Prompt),
    '',
    isV2Prompt
      ? 'Synthesize only when candidate capabilities have complete verified support data; otherwise mark unsupportedItems.'
      : 'Guardrail: produce CircuitSpec only from candidate capabilities with complete verified support data and current context constraints. If verified support data is missing or incomplete, mark unsupportedItems or clarificationNeeds. Never upgrade a planned, unsupported, context-known-only, visual-only, or source-incomplete capability to supported.'
  ].join('\n');
}

export function renderContextCoverageForPrompt(
  contextCoverage: ContextCoverageReport,
  compact = false
) {
  const eligibilityReason = compact
    ? compactSupportGapForV2(contextCoverage.synthesisEligibility.reason)
    : contextCoverage.synthesisEligibility.reason;
  return [
    `status=${contextCoverage.status}`,
    `score=${contextCoverage.score}`,
    `sufficientFor=${contextCoverage.sufficientFor.join(', ') || 'none'}`,
    `synthesisEligibility=${contextCoverage.synthesisEligibility.status}: ${eligibilityReason}`,
    `missingSourceTypes=${contextCoverage.missingSourceTypes.join(', ') || 'none'}`,
    `warnings=${(compact ? contextCoverage.warnings.map(compactSupportGapForV2) : contextCoverage.warnings).join(' | ') || 'none'}`
  ].join('\n');
}

export function compactSupportGapForV2(value: string) {
  const contextKnownMatch = value.match(
    /(context-known|pin-known|unsafe-blocked|catalog-only) hardware ([^(]+)\(([^)]+)\)/i
  );
  if (contextKnownMatch) {
    return `${contextKnownMatch[1]} hardware ${contextKnownMatch[2].trim()} (${contextKnownMatch[3]}) is not simulation-ready`;
  }

  const visualOnlyMatch = value.match(/visual-only hardware ([^(]+)\(([^)]+)\)/i);
  if (visualOnlyMatch) {
    return `visual-only hardware ${visualOnlyMatch[1].trim()} (${visualOnlyMatch[2]}) lacks canonical agent context`;
  }

  const plannedMatch = value.match(/([a-z0-9-]+ is planned)/i);
  if (plannedMatch) {
    return plannedMatch[1];
  }

  const missingBundleMatch = value.match(/([a-z0-9-]+ has no verified hardware support data)/i);
  if (missingBundleMatch) {
    return missingBundleMatch[1];
  }

  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}

export function compactPrimitiveContractsForV2(primitives: SimulationPrimitive[]) {
  return primitives.map((primitive) => ({
    id: primitive.id,
    requiredNetRoles: primitive.requiredNetRoles,
    validationRules: primitive.validationRules,
    limitations: primitive.limitations
  }));
}

export function compactFootprintsForV2(footprints: RenderFootprintEntry[]) {
  return footprints.map((footprint) => ({
    type: footprint.type,
    placement: {
      allowedSurfaces: footprint.placement.allowedSurfaces,
      breadboardCompatible: footprint.placement.breadboardCompatible,
      defaultOrientation: footprint.placement.defaultOrientation
    },
    pins: Object.keys(footprint.pinAnchors)
  }));
}

export function compactCapabilityMatchesPromptForV2(capabilities: CapabilityGraphEntry[]) {
  if (capabilities.length === 0) {
    return 'none';
  }

  return capabilities
    .map((capability) =>
      [
        `- ${capability.id}`,
        `support=${capability.supportLevel}`,
        `input=${capability.inputModalities.join(',') || 'none'}`,
        `output=${capability.outputModalities.join(',') || 'none'}`,
        `parts=${capability.requiredParts.join(',') || 'none'}`,
        `primitives=${capability.simulationPrimitives.join(',') || 'none'}`,
        capability.unsupportedReason
          ? `unsupported=${compactSupportGapForV2(capability.unsupportedReason)}`
          : ''
      ]
        .filter(Boolean)
        .join('; ')
    )
    .join('\n');
}

export function compactCandidatePartsPromptForV2(parts: PartCapability[]) {
  if (parts.length === 0) {
    return 'none';
  }

  return parts
    .map((part) =>
      [
        `- ${part.id}`,
        `pins=${part.pins.map((pin) => `${pin.name}:${pin.role}`).join(',') || 'none'}`,
        `protocols=${part.protocols.join(',') || 'none'}`,
        `requires=${part.requiredPassives.map((passive) => passive.partId).join(',') || 'none'}`
      ].join('; ')
    )
    .join('\n');
}

export function compactPrimitivePromptForV2(primitives: SimulationPrimitive[]) {
  if (primitives.length === 0) {
    return 'none';
  }

  return primitives
    .map((primitive) =>
      [
        `- ${primitive.id}`,
        `netRoles=${primitive.requiredNetRoles.join(',') || 'none'}`,
        `rules=${primitive.validationRules.join(',') || 'none'}`,
        `limits=${primitive.limitations.join(',') || 'none'}`
      ].join('; ')
    )
    .join('\n');
}

export function compactFootprintPromptForV2(footprints: RenderFootprintEntry[]) {
  if (footprints.length === 0) {
    return 'none';
  }

  return footprints
    .map((footprint) =>
      [
        `- ${footprint.type}`,
        `surface=${footprint.placement.allowedSurfaces.join(',') || 'stage'}`,
        `breadboard=${footprint.placement.breadboardCompatible ? 'yes' : 'no'}`,
        `pins=${Object.keys(footprint.pinAnchors).join(',') || 'none'}`
      ].join('; ')
    )
    .join('\n');
}

export function renderConversationContextForPrompt(context?: AgentConversationContext) {
  if (!context) {
    return 'none';
  }

  const artifact = context.currentArtifact;
  return JSON.stringify(
    {
      awaitingBuildConfirmation: context.awaitingBuildConfirmation,
      lastSupportedGoal: context.lastSupportedGoal ?? null,
      pendingSupportedAlternative: context.pendingSupportedAlternative ?? null,
      currentArtifact: artifact
        ? {
            source: artifact.source,
            title: artifact.title,
            intent: artifact.circuitSpec?.intent,
            validationStatus: artifact.validationReport?.status,
            simulationStatus: artifact.simulationPlan?.status,
            componentPartIds:
              artifact.circuitSpec?.components?.map((component) => component.partId) ?? []
          }
        : null,
      recentTurns: context.awaitingBuildConfirmation
        ? (context.recentTurns ?? []).slice(-2)
        : []
    },
    null,
    2
  );
}

import type { PartCapability, TopologyTemplate } from '../agent/schemas.ts';
import {
  composeTopology,
  resolveSlotAssignments,
  topologySlotRoles,
  type ComposedNet
} from './composeTopology.ts';

// L2 generation path (Layered Context Architecture, Phase 2b).
//
// Turns a role-based topology + candidate parts into a structural-core
// ContextPacket fragment via the pure L2 engine. This is the "generated"
// counterpart to a curated L3 bundle: same structural shape, assembled on
// demand so ANY part combination is reachable.
//
// SAFETY: a generated composition has no human-curated safety overlay yet
// (Phase 2c), so it NEVER claims build-ready — `buildReadyScope` is always
// 'review-only'. The downstream gate must keep run/assembly off until a safety
// overlay is present and gaps are closed.

export type GeneratedComposition = {
  provenance: 'generated-composition';
  topologyId: string;
  candidatePartIds: string[];
  slotAssignments: Record<string, string>;
  netlist: ComposedNet[];
  validationRules: string[];
  simulationPrimitiveHints: string[];
  safetyOverlayPresent: boolean;
  buildReadyScope: 'original' | 'review-only';
  blockingConditions: string[];
  complete: boolean;
};

export function assembleGeneratedComposition(input: {
  template: TopologyTemplate;
  candidateParts: PartCapability[];
}): GeneratedComposition {
  const { template, candidateParts } = input;
  const { assignments, unresolvedSlots } = resolveSlotAssignments(template, candidateParts);
  const composed = composeTopology(template, assignments);

  const blockingConditions = [
    ...new Set([
      ...composed.blockingConditions,
      ...unresolvedSlots.map((slot) => `unresolved-slot-role:${slot}`)
    ])
  ].sort();

  // Phase 2b has no safety overlay → never build-ready (safe default).
  const safetyOverlayPresent = false;
  const complete = composed.complete && unresolvedSlots.length === 0;
  const buildReadyScope: 'original' | 'review-only' =
    safetyOverlayPresent && complete ? 'original' : 'review-only';

  return {
    provenance: 'generated-composition',
    topologyId: template.id,
    candidatePartIds: [...new Set(candidateParts.map((part) => part.id))].sort(),
    slotAssignments: Object.fromEntries(
      [...assignments].map(([slotRole, part]) => [slotRole, part.id])
    ),
    netlist: composed.nets,
    validationRules: template.validationRules,
    simulationPrimitiveHints: template.simulationPrimitiveHints,
    safetyOverlayPresent,
    buildReadyScope,
    blockingConditions,
    complete
  };
}

// Pick the richest topology that the candidate parts can FULLY fill. Self
// contained (depends only on parts + the role engine), so the shadow observer
// needs no capability-internal coupling.
export function selectComposableTopology(
  templates: TopologyTemplate[],
  candidateParts: PartCapability[]
): TopologyTemplate | null {
  const resolvable = templates
    .map((template) => ({ template, resolution: resolveSlotAssignments(template, candidateParts) }))
    .filter((entry) => entry.resolution.unresolvedSlots.length === 0)
    .sort(
      (a, b) =>
        topologySlotRoles(b.template).length - topologySlotRoles(a.template).length ||
        a.template.id.localeCompare(b.template.id)
    );
  return resolvable[0]?.template ?? null;
}

export type ShadowCompositionResult = {
  status: 'composed' | 'composed-with-gaps' | 'no-composable-topology';
  composition: GeneratedComposition | null;
};

// Observer used by the live request path in shadow/on mode. It reads
// candidateParts and produces a generated composition for logging — it does
// NOT receive or mutate the live ContextPacket, so the response is unchanged by
// construction.
export async function runShadowComposition(input: {
  candidateParts: PartCapability[];
  loadTemplates: () => Promise<TopologyTemplate[]>;
}): Promise<ShadowCompositionResult> {
  const templates = await input.loadTemplates();
  const template = selectComposableTopology(templates, input.candidateParts);
  if (!template) {
    return { status: 'no-composable-topology', composition: null };
  }
  const composition = assembleGeneratedComposition({ template, candidateParts: input.candidateParts });
  return {
    status: composition.complete ? 'composed' : 'composed-with-gaps',
    composition
  };
}

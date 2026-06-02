// Composition selection (Agent Pipeline Refactor, Phase 2 core).
//
// Selects candidate parts for a request by COMPOSITION instead of the enumerated route + bundle
// path. Two properties matter:
//
//   1. Correctness — raw `matchCapabilities` already ranks the PRIMARY-output capability first for
//      a request (e.g. display-text-output for "I2C OLED text", digital-light-output for "LED").
//      The legacy path then loses that primary to a downstream prune/route step (the OLED bug).
//      Composition takes the top primary capability's parts directly, so the part the student asked
//      for survives. Compositional-context capabilities (prototyping surface / wiring / passive)
//      contribute only what the student explicitly named — never the surfaces they did not ask for.
//
//   2. O(request), not O(catalog) — capability retrieval is over the fixed ~42-entry capability
//      graph (top-k), and parts are resolved by id. `candidatesConsidered` is bounded by the
//      retrieved capabilities' part lists, so it does NOT grow when the part catalog grows. The
//      topology scan runs over the SMALL retrieved candidate set (O(templates x k)), replacing the
//      O(templates x catalog) scan.
//
// This module is pure/standalone and corpus-gated; wiring it into the live request path is a later
// phase. Compositional capability ids are derived from the EXPLICIT route tier data (no '-context'
// suffix parsing).

import { matchCapabilities } from './capabilityGraph.ts';
import { getPartRegistry, loadContextV2Routes, loadTopologyTemplates } from './contextLayer.ts';
import { assembleGeneratedComposition, selectComposableTopology, type GeneratedComposition } from './generatedComposition.ts';
import type { CapabilityGraphEntry, PartCapability, TopologyTemplate } from '../agent/schemas.ts';

const BASE_PART_IDS = ['arduino-uno', 'breadboard-half'];
const DEFAULT_TOP_K = 8;

export type CompositionSelection = {
  /** The top-ranked primary-output capability that drives the build, if any. */
  primaryCapabilityId: string | null;
  /** Selected candidate part ids (sorted). */
  candidatePartIds: string[];
  /** The resolved candidate parts (same set as candidatePartIds), for direct packet use. */
  candidateParts: PartCapability[];
  /**
   * How many parts the selection examined for THIS request — bounded by the retrieved capabilities'
   * part lists, INDEPENDENT of catalog size. This is the O(request) signal the growth test asserts.
   */
  candidatesConsidered: number;
  /** The L2 generated composition over the selected parts (null when no topology composes). */
  composition: GeneratedComposition | null;
};

export type CompositionSelectionDeps = {
  registrySource?: () => Promise<PartCapability[]>;
  loadTemplates?: () => Promise<TopologyTemplate[]>;
  loadCompositionalCapabilityIds?: () => Promise<Set<string>>;
  topK?: number;
};

/** Compositional-context capability ids, derived from the explicit route tier (no suffix parsing). */
export async function loadCompositionalCapabilityIds(): Promise<Set<string>> {
  const routes = await loadContextV2Routes();
  const ids = routes.routes
    .filter((route) => route.tier === 'compositional-context')
    .flatMap((route) => route.when.capabilityIds);
  return new Set(ids);
}

export async function selectContextByComposition(
  input: { message: string },
  deps: CompositionSelectionDeps = {}
): Promise<CompositionSelection> {
  const topK = deps.topK ?? DEFAULT_TOP_K;
  const [registry, templates, compositionalIds, matchedCapabilities] = await Promise.all([
    (deps.registrySource ?? getPartRegistry)(),
    (deps.loadTemplates ?? loadTopologyTemplates)(),
    (deps.loadCompositionalCapabilityIds ?? loadCompositionalCapabilityIds)(),
    matchCapabilities(input.message)
  ]);

  const byId = new Map(registry.map((part) => [part.id, part]));

  const primaryCapabilities = matchedCapabilities.filter(
    (capability) => !compositionalIds.has(capability.id) && capability.supportLevel === 'supported'
  );

  const candidateIds = new Set<string>(BASE_PART_IDS);
  const consideredPartIds = new Set<string>();

  // Top-k primary capabilities drive the build: their required parts are always candidates; their
  // optional parts join only when they are generic wiring (e.g. jumper wires) — never speculative
  // alternatives that could pull in parts the student did not ask for.
  for (const capability of primaryCapabilities.slice(0, topK)) {
    for (const partId of capability.requiredParts) {
      consideredPartIds.add(partId);
      candidateIds.add(partId);
    }
    for (const partId of capability.optionalParts) {
      consideredPartIds.add(partId);
      if (byId.get(partId)?.kind === 'wiring') {
        candidateIds.add(partId);
      }
    }
  }

  const candidateParts = [...candidateIds]
    .map((id) => byId.get(id))
    .filter((part): part is PartCapability => part !== undefined);

  const topology = selectComposableTopology(templates, candidateParts);
  const composition = topology
    ? assembleGeneratedComposition({ template: topology, candidateParts })
    : null;

  return {
    primaryCapabilityId: primaryCapabilities[0]?.id ?? null,
    candidatePartIds: candidateParts.map((part) => part.id).sort(),
    candidateParts,
    // Bounded by what the request retrieved (base + considered capability parts), not the catalog.
    candidatesConsidered: new Set([...BASE_PART_IDS, ...consideredPartIds]).size,
    composition
  };
}

/** Exposed for tests/diagnostics: which primary capabilities a message retrieves (top-k). */
export function primaryCapabilitiesOf(
  matched: CapabilityGraphEntry[],
  compositionalIds: Set<string>
): CapabilityGraphEntry[] {
  return matched.filter((c) => !compositionalIds.has(c.id) && c.supportLevel === 'supported');
}

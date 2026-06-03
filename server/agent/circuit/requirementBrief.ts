// requirementBrief.ts — pure pre-synthesis requirement-document renderer (Domain layer).
//
// PURE: no I/O, no infrastructure imports. Renders the canonical RequirementDoc into the bounded
// markdown "brief" that DRIVES circuit synthesis (faithful chain: doc -> circuit).
// Floor-aware truncation for the synthesis budget lives in fitBriefToBudget (US-003); this renderer
// enforces only the absolute hard cap as a safety net.
// See PLAN_requirement_document_chain.md.
import { RequirementDocSchema, type RequirementDoc, type RequirementDocPart } from '../schemas.ts';

/** Part roles (PartCapability.kind) that the requirement document commits to as REQUIRED. Board and
 *  wiring are placement/aids, left optional so synthesis keeps wiring latitude. */
const REQUIRED_PART_ROLES = new Set(['controller', 'output', 'input', 'passive', 'power']);

/** Minimal candidate-part shape the deterministic derivation needs (subset of PartCapability). */
export interface RequirementCandidatePart {
  id: string;
  kind: string;
  label?: string;
}

/** Optional structured intent signals (from the context packet / intent spec). */
export interface RequirementIntentSignals {
  primaryGoal?: string | null;
  output?: string | null;
  controller?: string | null;
  input?: string | null;
  behavior?: string | null;
}

/**
 * Extract verbatim lexical constraints from the raw student message that a parts/role decomposition
 * would otherwise lose (Critic M2): controller pins, supply rails, component values, repeat counts.
 * Pure + deterministic; returns de-duplicated, order-preserving matches.
 */
export function extractVerbatimConstraints(message: string): string[] {
  const patterns: RegExp[] = [
    /\b([AD]\d{1,2}|GND|VCC|3V3|5V|SDA|SCL|MISO|MOSI|SCK|RX|TX)\b/gi, // pins / rails
    /\d+\s?(?:ohm|ohms|Ω|kΩ|kohm|kohms)\b/gi, // resistor / impedance values
    /\d+\s?(?:k?Hz|kHz|MHz)\b/gi, // frequencies
    /\d+\s?(?:ms|sec|초|분)/gi, // durations (no \b: Korean suffixes aren't ASCII word chars)
    /\d+\s?(?:번씩|번|회씩|회|times?)/gi // repeat counts (\d+ prefix prevents false matches)
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const pattern of patterns) {
    for (const match of message.matchAll(pattern)) {
      const value = match[0].trim();
      const key = value.toLowerCase();
      if (value && !seen.has(key)) {
        seen.add(key);
        out.push(value);
      }
    }
  }
  return out;
}

/**
 * Deterministically derive a RequirementDoc from the student message, the matched candidate parts,
 * and any structured intent signals. This is the in-budget foundation (and the off-flag / fallback
 * path); the faithful LLM authoring step refines these same fields. Commits controller/output/passive
 * parts as REQUIRED so synthesis must honor them (the commitment the registry summary lacks).
 */
export function deriveRequirementDoc(
  message: string,
  candidateParts: ReadonlyArray<RequirementCandidatePart>,
  intent: RequirementIntentSignals = {}
): RequirementDoc {
  const controllerPart = candidateParts.find((p) => p.kind === 'controller');
  const intendedParts: RequirementDocPart[] = candidateParts.map((part) => ({
    partId: part.id,
    role: part.kind,
    required: REQUIRED_PART_ROLES.has(part.kind)
  }));

  return RequirementDocSchema.parse({
    goal: (intent.primaryGoal ?? message).trim() || message,
    controller: intent.controller ?? controllerPart?.id ?? null,
    inputs: intent.input ? [intent.input] : [],
    outputs: intent.output ? [intent.output] : [],
    intendedParts,
    behavior: (intent.behavior ?? message).trim(),
    verbatimConstraints: extractVerbatimConstraints(message),
    assumptions: []
  });
}

/** Absolute hard cap for the brief (budget safety net). Floor-aware fit is fitBriefToBudget. */
export const BRIEF_MAX_CHARS = 1200;

/** Marker that flags a part as REQUIRED by the requirement document. Deliberately a token the
 *  neutral registry summary (buildRegistrySummary) does NOT emit, so the doc's COMMITMENT (this
 *  part must appear) is visible to synthesis rather than just its availability. */
export const REQUIRED_PART_MARKER = 'REQUIRED';

function renderPartLine(part: RequirementDocPart): string {
  const marker = part.required ? `[${REQUIRED_PART_MARKER}] ` : '';
  return `- ${marker}${part.partId} — ${part.role}`;
}

/** Render the requirement document into the bounded brief that leads the synthesis prompt. */
export function renderRequirementBrief(doc: RequirementDoc): string {
  const parts = doc.intendedParts.length
    ? doc.intendedParts.map(renderPartLine).join('\n')
    : '- (no parts committed yet)';
  const inputs = doc.inputs.length ? doc.inputs.join(', ') : 'none';
  const outputs = doc.outputs.length ? doc.outputs.join(', ') : 'none';
  const constraints = doc.verbatimConstraints.length
    ? doc.verbatimConstraints.map((c) => `- ${c}`).join('\n')
    : '- none';

  const brief = [
    '# Requirement document',
    `Goal: ${doc.goal}`,
    `Controller: ${doc.controller ?? 'unspecified'}`,
    `Inputs: ${inputs}`,
    `Outputs: ${outputs}`,
    `Behavior: ${doc.behavior || '(unspecified)'}`,
    '## Required & intended parts',
    parts,
    '## Verbatim constraints (from the student request)',
    constraints
  ].join('\n');

  return brief.length <= BRIEF_MAX_CHARS ? brief : brief.slice(0, BRIEF_MAX_CHARS);
}

/**
 * Render the NON-TRUNCATABLE floor of the brief: the goal, the REQUIRED parts, and the verbatim
 * constraints. These are the commitments synthesis must honor; they never yield to the budget.
 */
export function renderRequirementBriefFloor(doc: RequirementDoc): string {
  const requiredParts = doc.intendedParts.filter((p) => p.required);
  const partsBlock = requiredParts.length
    ? requiredParts.map(renderPartLine).join('\n')
    : '- (none committed)';
  const constraints = doc.verbatimConstraints.length
    ? doc.verbatimConstraints.map((c) => `- ${c}`).join('\n')
    : '- none';
  return [
    '# Requirement (essential)',
    `Goal: ${doc.goal}`,
    '## REQUIRED parts',
    partsBlock,
    '## Verbatim constraints',
    constraints
  ].join('\n');
}

/** Render a middle tier: floor + the behavior line (drops optional parts / inputs / outputs / assumptions). */
function renderRequirementBriefMid(doc: RequirementDoc): string {
  return `${renderRequirementBriefFloor(doc)}\nBehavior: ${doc.behavior || '(unspecified)'}`;
}

/**
 * Fit the brief into `budget` chars by yielding PROSE FIRST, never the floor (Critic M1).
 * Tiers, largest-that-fits wins: full -> mid (floor+behavior) -> floor.
 * If even the floor exceeds the budget (over-floor regime), the floor is returned UNCHANGED — the
 * REQUIRED parts + verbatim constraints are preserved and the caller's block compactor yields the
 * remaining budget from the system blocks (contextPacketBlock last). Pure + deterministic.
 */
export function fitBriefToBudget(doc: RequirementDoc, budget: number): string {
  const full = renderRequirementBrief(doc);
  if (full.length <= budget) {
    return full;
  }
  const mid = renderRequirementBriefMid(doc);
  if (mid.length <= budget) {
    return mid;
  }
  // floor is non-truncatable; return it even if it exceeds the budget (over-floor regime).
  return renderRequirementBriefFloor(doc);
}

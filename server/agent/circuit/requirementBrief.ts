// requirementBrief.ts — pure pre-synthesis requirement-document renderer (Domain layer).
//
// PURE: no I/O, no infrastructure imports. Renders the canonical RequirementDoc into the bounded
// markdown "brief" that DRIVES circuit synthesis (faithful chain: doc -> circuit).
// Floor-aware truncation for the synthesis budget lives in fitBriefToBudget (US-003); this renderer
// enforces only the absolute hard cap as a safety net.
// See PLAN_requirement_document_chain.md.
import { type RequirementDoc, type RequirementDocPart } from '../schemas.ts';

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

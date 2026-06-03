/**
 * Graceful prompt-budget compaction for the H-eduware agent pipeline.
 *
 * PURE FUNCTIONS ONLY — no I/O, no infrastructure imports, no side effects.
 * This module is a Domain-layer component: it operates exclusively on strings
 * and primitive values and has zero external dependencies (Clean Architecture
 * dependency rule: innermost layer imports nothing outer).
 *
 * Design mirrors the existing compactRuntimeOperatingMemory() /
 * compactRuntimeContextIndex() pattern (deepAgentRuntime.ts:625-644), which
 * already returns fixed-summary replacements for the two runtime docs.
 * Phase 5a extends that pattern to the DOMINANT system/context blocks so that
 * an over-budget prompt is compacted at the prompt-assembly boundary BEFORE
 * any assertAgentPromptBudget() call site throws AgentPromptBudgetError.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The four dominant system/context blocks that can overflow the prompt budget. */
export type CompactionTarget =
  | 'operatingMemory'
  | 'coordinatorPrompt'
  | 'registrySummary'
  | 'contextPacketBlock';

/** Input bag of the four dominant blocks. */
export interface SystemContextBlocks {
  operatingMemory: string;
  coordinatorPrompt: string;
  registrySummary: string;
  contextPacketBlock: string;
}

// ---------------------------------------------------------------------------
// Fixed summaries (mirrors compactRuntimeOperatingMemory / compactRuntimeContextIndex)
// ---------------------------------------------------------------------------

const COMPACT_OPERATING_MEMORY = [
  '# Operating Memory Summary',
  'Validate before build-ready rendering or current-flow claims.',
  'Current animation must come from validated netlist/current paths only.',
  'Never invent parts, pins, protocols, or simulator capability; mark unsupported or ask one clarification.',
  'Prefer safe low-voltage Arduino/breadboard circuits. Registry/tool outputs are canonical.',
  'Keep subagent outputs concise; no long copied context.'
].join('\n');

const COMPACT_COORDINATOR_PROMPT = [
  '# Context Index Summary',
  'Authority order: safety policy, deterministic validation, schemas, support bundles, registry data, product/pedagogy.',
  'Use the request ContextRoute/RetrievalPlan only; do not scan omitted catalogs or legacy snapshots.',
  'v2 bundles are the prompt surface. Heavy registry, primitive, footprint, and source-claim details are tool data.',
  'Unsupported or ambiguous prompts stay policy-first. Supported hardware requires registry, pins, validation, simulation primitive, footprint, eval, and browser evidence.'
].join('\n');

const COMPACT_REGISTRY_SUMMARY_PREFIX = '# Registry Summary (compacted)\nSee tool outputs for full registry data.';
const COMPACT_CONTEXT_PACKET_PREFIX = '# Context Packet (compacted)\nSee tool outputs for full context data.';

// ---------------------------------------------------------------------------
// Phase 5a: compactSystemContextBlocks
// ---------------------------------------------------------------------------

/**
 * Ensure the four dominant system/context blocks fit within `maxChars` (chars
 * of the joined string, matching measureAgentPromptBudget's join('\n\n')).
 *
 * Strategy (priority order — stop as soon as budget is met):
 *  1. Replace operatingMemory and coordinatorPrompt with their fixed summaries
 *     (these are the cheapest replacements; they are already pre-compacted in
 *     the live pipeline via compactRuntime* but the test path may supply raw).
 *  2. Truncate registrySummary to its per-entry header line only.
 *  3. Truncate contextPacketBlock to a fixed prefix.
 *
 * Blocks already within budget are returned unchanged.
 */
export function compactSystemContextBlocks(
  blocks: SystemContextBlocks,
  maxChars: number
): SystemContextBlocks {
  let result: SystemContextBlocks = { ...blocks };

  if (combinedLength(result) <= maxChars) {
    return result;
  }

  // Step 1: replace the two runtime docs with their fixed summaries.
  result = {
    ...result,
    operatingMemory: COMPACT_OPERATING_MEMORY,
    coordinatorPrompt: COMPACT_COORDINATOR_PROMPT
  };

  if (combinedLength(result) <= maxChars) {
    return result;
  }

  // Step 2: collapse registrySummary to just the header lines (first line per entry).
  result = {
    ...result,
    registrySummary: collapseRegistrySummary(result.registrySummary, maxChars - nonRegistryLength(result))
  };

  if (combinedLength(result) <= maxChars) {
    return result;
  }

  // Step 3: truncate contextPacketBlock to a compact prefix.
  const remainingBudget = maxChars - nonContextPacketLength(result);
  result = {
    ...result,
    contextPacketBlock: truncateBlock(result.contextPacketBlock, COMPACT_CONTEXT_PACKET_PREFIX, remainingBudget)
  };

  return result;
}

// ---------------------------------------------------------------------------
// Phase 5b: foldRunningSummary
// ---------------------------------------------------------------------------

/**
 * Produce an advisory running summary from a list of conversation turns.
 *
 * The summary is computed server-side from server-validated turns; any
 * client-supplied runningSummary value is UNTRUSTED/advisory (schema field
 * exists only for the round-trip client store; the server re-derives each
 * turn).
 *
 * Output is bounded at 500 chars to match the Zod schema constraint on
 * AgentConversationContextSchema.runningSummary.
 *
 * Empty turn list → empty string (no phantom context injected).
 */
export function foldRunningSummary(
  turns: ReadonlyArray<{ role: 'student' | 'assistant'; text: string }>,
  _locale: 'ko' | 'en'
): string {
  if (turns.length === 0) {
    return '';
  }

  // Build a compact fold: one bullet per turn, role-prefixed, text truncated.
  // Total budget: 500 chars (Zod bound).  Reserve 40 chars for the header.
  const header = 'Earlier session context:';
  const perTurnBudget = Math.floor((500 - header.length - turns.length * 3) / turns.length);

  const lines = turns.map((turn) => {
    const prefix = turn.role === 'student' ? 'S' : 'A';
    const snippet = turn.text.slice(0, Math.max(20, perTurnBudget));
    return `${prefix}: ${snippet}`;
  });

  const body = lines.join(' | ');
  const full = `${header} ${body}`;

  // Hard cap: always stay within 500 chars.
  return full.slice(0, 500);
}

// ---------------------------------------------------------------------------
// Helpers (private)
// ---------------------------------------------------------------------------

function combinedLength(blocks: SystemContextBlocks): number {
  return [
    blocks.operatingMemory,
    blocks.coordinatorPrompt,
    blocks.registrySummary,
    blocks.contextPacketBlock
  ].join('\n\n').length;
}

/** Length of all blocks except registrySummary (used to compute registry budget). */
function nonRegistryLength(blocks: SystemContextBlocks): number {
  return [
    blocks.operatingMemory,
    blocks.coordinatorPrompt,
    blocks.contextPacketBlock
  ].join('\n\n').length + '\n\n'.length; // account for the extra join separator
}

/** Length of all blocks except contextPacketBlock (used to compute packet budget). */
function nonContextPacketLength(blocks: SystemContextBlocks): number {
  return [
    blocks.operatingMemory,
    blocks.coordinatorPrompt,
    blocks.registrySummary
  ].join('\n\n').length + '\n\n'.length;
}

/**
 * Reduce registrySummary to at most `budget` chars by keeping only the
 * first line (header) of each entry and truncating if still too long.
 */
function collapseRegistrySummary(summary: string, budget: number): string {
  const collapsed = summary
    .split('\n')
    .filter((line) => line.startsWith('- ') || line.startsWith('# '))
    .join('\n');

  return truncateBlock(collapsed, COMPACT_REGISTRY_SUMMARY_PREFIX, budget);
}

/**
 * Return `text` truncated to `budget` chars, using `fallback` as the
 * replacement when the text is still too long after truncation.
 */
function truncateBlock(text: string, fallback: string, budget: number): string {
  if (budget <= 0) {
    return fallback.slice(0, Math.max(0, budget <= 0 ? fallback.length : budget));
  }
  if (text.length <= budget) {
    return text;
  }
  const truncated = text.slice(0, budget);
  return truncated.length > 0 ? truncated : fallback.slice(0, budget);
}

// Phase 0 — operational-efficiency measurement harness for the agent pipeline.
//
// Purpose: characterize the CURRENT (legacy) per-request cost so later phases can prove
// O(request)-not-O(catalog) and reliability targets against a recorded baseline. This is a
// read-only observer over `buildContextPacket` + the agent tool set; it does NOT mutate the
// hot path and never calls a live model.
//
// Token measurement uses js-tiktoken with the `o200k_base` encoding (the encoding used by the
// gpt-4o / gpt-5 model family this app targets). Korean (ko) is the dominant locale; the
// measured ko char->token ratio is published by `measureTokenRatio()` and the characterization
// test so later token budgets are set in tokens, not chars.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getEncoding, type Tiktoken } from 'js-tiktoken';
import { toJsonSchema } from '@langchain/core/utils/json_schema';

import { buildContextPacket } from '../context/contextPacket.ts';
import { getPartRegistry } from '../context/contextLayer.ts';
import type { AgentPipelineMode } from './agentPipelineMode.ts';
import type { PartCapability } from './schemas.ts';
import { createHeduwareAgentTools } from './deepAgentTools.ts';

export type ContextEfficiencyRequest = {
  message: string;
  locale?: 'ko' | 'en';
  // Phase 0.5 seam: inject a doubled/synthetic registry to prove O(request)-not-O(catalog) growth.
  registrySource?: () => Promise<PartCapability[]>;
  // Phase 1: measure under a specific pipeline mode (legacy|shadow|next) without touching env.
  pipelineMode?: AgentPipelineMode;
};

export type ContextEfficiencyMeasurement = {
  /** Selected context route id (`contextRoute.routeId`). */
  routeId: string;
  /** Part ids the packet offers the agent for THIS request. */
  candidatePartIds: string[];
  /**
   * How many parts the current selection path scans. Today selection receives the FULL
   * registry (`selectCandidateParts(registry, ...)`), so this equals the catalog size for any
   * registry-loading request — the O(catalog) signal. Phase 2 makes this O(request).
   */
  candidatesConsidered: number;
  /** Wall time to assemble the packet (informational; NOT asserted — machine-dependent). */
  selectionCpuMs: number;
  /** `promptBlock` size in characters (the legacy entry-context measure). */
  entryChars: number;
  /** `promptBlock` size in o200k tokens (the real cost the model pays). */
  entryTokens: number;
  /** Tokens of the serialized agent tool definitions (name + description + JSON schema). */
  toolSchemaTokens: number;
  /** Distinct `createDeepAgent(...)` construction sites on the per-request path (two-run cost). */
  createDeepAgentCount: number;
};

let cachedEncoding: Tiktoken | null = null;
function encoding(): Tiktoken {
  if (!cachedEncoding) {
    cachedEncoding = getEncoding('o200k_base');
  }
  return cachedEncoding;
}

/** Count o200k tokens for a string (the encoding the target model family uses). */
export function countTokens(text: string): number {
  if (!text) return 0;
  return encoding().encode(text).length;
}

/** Serialize the agent tool set the way the model receives it, then count its tokens. */
export function measureToolSchemaTokens(tools: ReturnType<typeof createHeduwareAgentTools>): number {
  const serialized = tools
    .map((tool) => {
      let schemaText = '';
      try {
        const schema = (tool as { schema: Parameters<typeof toJsonSchema>[0] }).schema;
        schemaText = JSON.stringify(toJsonSchema(schema));
      } catch {
        schemaText = '';
      }
      return `${tool.name}\n${tool.description ?? ''}\n${schemaText}`;
    })
    .join('\n');
  return countTokens(serialized);
}

/** Published ko (and en) char->token ratios so later budgets are set in tokens. */
export function measureTokenRatio(sample: string): { chars: number; tokens: number; ratio: number } {
  const chars = sample.length;
  const tokens = countTokens(sample);
  return { chars, tokens, ratio: chars === 0 ? 0 : tokens / chars };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_SOURCE = path.join(HERE, 'deepAgentRuntime.ts');

/**
 * Characterize how many deep-agent CONSTRUCTION sites the per-request path has, by static source
 * analysis (comment lines excluded). Post Phase 0.5 the two sites construct via the injected
 * `deepAgentFactory(...)` seam (synthesis + requirement-analysis); pre-seam code used
 * `createDeepAgent(...)` directly — both are counted. Today the value is the two-run cost; the
 * `DeepAgentFactory` seam also asserts it at runtime (see agentRuntimeSeams test); Phase 3 collapses
 * it to one.
 */
export async function countDeepAgentConstructionSites(sourcePath = RUNTIME_SOURCE): Promise<number> {
  const source = await readFile(sourcePath, 'utf8');
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .reduce((sum, line) => sum + (line.match(/(?:createDeepAgent|deepAgentFactory)\s*\(/g)?.length ?? 0), 0);
}

/**
 * Measure the per-request context-assembly cost for the CURRENT pipeline. Read-only: builds the
 * packet, counts tokens, and reports the catalog scan width. No live model call.
 */
export async function measureContextEfficiency(
  request: ContextEfficiencyRequest
): Promise<ContextEfficiencyMeasurement> {
  const locale = request.locale ?? 'ko';
  const registrySource = request.registrySource ?? getPartRegistry;
  const registry: PartCapability[] = await registrySource();

  const startedAt = process.hrtime.bigint();
  const packet = await buildContextPacket(
    { message: request.message, locale },
    { registrySource, pipelineMode: request.pipelineMode }
  );
  const elapsedNs = Number(process.hrtime.bigint() - startedAt);

  const tools = createHeduwareAgentTools({});
  const createDeepAgentCount = await countDeepAgentConstructionSites();

  return {
    routeId: packet.contextRoute.routeId,
    candidatePartIds: packet.candidateParts.map((part) => part.id),
    candidatesConsidered: registry.length,
    selectionCpuMs: elapsedNs / 1_000_000,
    entryChars: packet.promptBlock.length,
    entryTokens: countTokens(packet.promptBlock),
    toolSchemaTokens: measureToolSchemaTokens(tools),
    createDeepAgentCount
  };
}

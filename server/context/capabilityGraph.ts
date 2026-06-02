import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { CapabilityGraphEntrySchema, type CapabilityGraphEntry } from '../agent/schemas.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTEXT_ROOT = path.resolve(__dirname, '../../agent-context');

const CapabilityGraphSchema = z.array(CapabilityGraphEntrySchema);

let cachedGraph: CapabilityGraphEntry[] | null = null;

export async function loadCapabilityGraph(root = DEFAULT_CONTEXT_ROOT): Promise<CapabilityGraphEntry[]> {
  if (cachedGraph && root === DEFAULT_CONTEXT_ROOT) {
    return cachedGraph;
  }

  const indexContent = await readFile(path.join(root, 'index.json'), 'utf8');
  const index = JSON.parse(indexContent) as {
    data?: Array<{ id: string; path: string }>;
  };
  const entry = index.data?.find((candidate) => candidate.id === 'capability-graph');
  if (!entry) {
    throw new Error('Context index is missing capability-graph data entry');
  }

  const graphContent = await readFile(path.join(root, entry.path), 'utf8');
  const graph = CapabilityGraphSchema.parse(JSON.parse(graphContent));
  if (root === DEFAULT_CONTEXT_ROOT) {
    cachedGraph = graph;
  }
  return graph;
}

export async function matchCapabilities(query: string, root = DEFAULT_CONTEXT_ROOT): Promise<CapabilityGraphEntry[]> {
  const graph = await loadCapabilityGraph(root);
  const terms = tokenize(query).filter(isMeaningfulTerm);
  const normalizedQuery = normalize(query);

  return graph
    .map((capability) => ({
      capability,
      score: scoreCapability(capability, normalizedQuery, terms)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || supportRank(a.capability.supportLevel) - supportRank(b.capability.supportLevel) || a.capability.id.localeCompare(b.capability.id))
    .map((entry) => entry.capability);
}

export function clearCapabilityGraphCache() {
  cachedGraph = null;
}

function scoreCapability(capability: CapabilityGraphEntry, normalizedQuery: string, terms: string[]) {
  const negativeEvidenceHits = evidenceHits(capability.negativeEvidence, normalizedQuery, terms);
  const requiredEvidenceHits = evidenceHits(
    [...capability.requiredEvidence, ...requiredFallbackPhrases(capability.studentPhrases)],
    normalizedQuery,
    terms
  );
  if (requiredEvidenceHits === 0) {
    return 0;
  }

  const positivePhraseHits = evidenceHits(
    [...capability.positivePhrases, ...capability.studentPhrases],
    normalizedQuery,
    terms
  );
  const modalityEvidenceHits = evidenceHits([
    ...capability.inputModalities,
    ...capability.outputModalities
  ], normalizedQuery, terms);
  const rawScore = positivePhraseHits * 0.25
    + requiredEvidenceHits * 0.4
    + modalityEvidenceHits * 0.25
    - negativeEvidenceHits * 0.25;
  const score = Math.max(0, Math.min(1, Number(rawScore.toFixed(3))));

  return score >= capability.minimumScore ? score : 0;
}

function isMeaningfulTerm(term: string) {
  const stopTerms = new Set([
    'and',
    'the',
    'with',
    'for',
    'from',
    'into',
    'onto',
    'that',
    'this',
    'some',
    'circuit',
    'current',
    'flow',
    'arduino',
    'uno',
    'breadboard',
    'jumper',
    'wire'
  ]);
  return term.length >= 3 && !stopTerms.has(term);
}

function uniqueTokens(values: string[]) {
  const tokens = values.flatMap((value) => {
    const normalized = normalize(value);
    const lexicalTokens = tokenize(value).filter(isMeaningfulTerm);
    const compoundTokens = lexicalTokens
      .flatMap(splitCompoundToken)
      .filter(isMeaningfulTerm);

    return [normalized, ...lexicalTokens, ...compoundTokens];
  });
  return [...new Set(tokens.filter(Boolean))];
}

function evidenceHits(evidence: string[], normalizedQuery: string, terms: string[]) {
  const termSet = new Set(terms);
  return evidence.filter((phrase) => evidenceMatches(phrase, normalizedQuery, termSet)).length;
}

function requiredFallbackPhrases(phrases: string[]) {
  const genericSingleTokenEvidence = new Set([
    'display',
    'screen',
    'show',
    'make',
    'light',
    'output',
    'current',
    'flow',
    'arduino',
    'breadboard'
  ]);

  return phrases.filter((phrase) => {
    const phraseTerms = tokenize(phrase).filter(isMeaningfulTerm);
    return phraseTerms.length !== 1 || !genericSingleTokenEvidence.has(phraseTerms[0]);
  });
}

function evidenceMatches(phrase: string, normalizedQuery: string, termSet: Set<string>) {
  const normalizedPhrase = normalize(phrase);
  if (!normalizedPhrase) {
    return false;
  }

  const phraseTerms = tokenize(phrase).filter(isMeaningfulTerm);
  if (phraseTerms.length === 1) {
    return termSet.has(phraseTerms[0])
      || (containsHangul(normalizedPhrase) && normalizedQuery.includes(normalizedPhrase));
  }

  if (normalizedQuery.includes(normalizedPhrase)) {
    return true;
  }

  return phraseTerms.length > 0 && phraseTerms.every((term) => termSet.has(term));
}

function splitCompoundToken(token: string) {
  return token.split(/[+/#.-]+/g).filter(Boolean);
}

function supportRank(level: CapabilityGraphEntry['supportLevel']) {
  const ranks: Record<CapabilityGraphEntry['supportLevel'], number> = {
    supported: 0,
    partial: 1,
    planned: 2,
    unsupported: 3
  };
  return ranks[level];
}

function tokenize(value: string): string[] {
  const tokens = normalize(value).match(/[\p{L}\p{N}]+(?:[+/#.-][\p{L}\p{N}]+)*/gu) ?? [];
  return [...new Set(tokens.flatMap((token) => [token, ...koreanTokenVariants(token)]))];
}

function normalize(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return normalizeDomainTerms(normalized);
}

function containsHangul(value: string) {
  return /[가-힣]/.test(value);
}

function koreanTokenVariants(token: string) {
  if (!containsHangul(token)) {
    return [];
  }

  const suffixes = [
    '으로',
    '에서',
    '하고',
    '하며',
    '하면',
    '하게',
    '까지',
    '부터',
    '에게',
    '을',
    '를',
    '은',
    '는',
    '이',
    '가',
    '에',
    '도',
    '와',
    '과',
    '로'
  ];

  return suffixes
    .filter((suffix) => token.endsWith(suffix) && token.length > suffix.length)
    .map((suffix) => token.slice(0, -suffix.length));
}

function normalizeDomainTerms(value: string) {
  const termMap = new Map([
    ['turns on', 'turn on'],
    ['turned on', 'turn on'],
    ['lights up', 'turn on light'],
    ['darkness', 'dark'],
    ['room is dark', 'dark room'],
    ['90 degrees', '90 degree'],
    ['wifi', 'wi-fi']
  ]);
  let normalized = value;
  for (const [from, to] of termMap) {
    normalized = normalized.replaceAll(from, to);
  }
  return normalized;
}

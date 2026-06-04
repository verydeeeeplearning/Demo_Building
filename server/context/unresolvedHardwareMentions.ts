import type { PartCapability } from '../agent/schemas.ts';

export type UnresolvedHardwareMention = {
  token: string;
  noun: string;
  phrase: string;
};

const HARDWARE_NOUNS = new Set(['sensor', 'module', 'driver', 'display', 'shield', 'board']);

const GENERIC_MODIFIERS = new Set([
  'a',
  'an',
  'the',
  'some',
  'any',
  'generic',
  'simple',
  'supported',
  'analog',
  'digital',
  'i2c',
  'spi',
  'uart',
  'light',
  'temperature',
  'humidity',
  'motion',
  'distance',
  'oled',
  'lcd',
  'led',
  'dc',
  'servo',
  'stepper',
  'motor'
]);

const BOUNDARY_TERMS = new Set([
  'and',
  'or',
  'but',
  'build',
  'connect',
  'create',
  'display',
  'for',
  'from',
  'if',
  'in',
  'into',
  'make',
  'need',
  'needs',
  'no',
  'on',
  'please',
  'render',
  'show',
  'to',
  'turn',
  'use',
  'using',
  'want',
  'wants',
  'when',
  'whenever',
  'without',
  'with'
]);

type Token = {
  raw: string;
  normalized: string;
  start: number;
  end: number;
};

export function buildKnownHardwareTerms(parts: PartCapability[]): Set<string> {
  const terms = new Set<string>();

  for (const part of parts) {
    addKnownTerm(terms, part.id);
    addKnownTerm(terms, part.label);

    for (const alias of part.aliases) {
      addKnownTerm(terms, alias);
    }
    for (const visualPartId of part.visualPartIds) {
      addKnownTerm(terms, visualPartId);
    }
    for (const capability of part.capabilities) {
      addKnownTerm(terms, capability);
    }
  }

  return terms;
}

export function detectUnresolvedHardwareMentions(
  message: string,
  knownTerms: Set<string>
): UnresolvedHardwareMention[] {
  const tokens = tokenize(message);
  const findings: UnresolvedHardwareMention[] = [];
  const seen = new Set<string>();

  for (let nounIndex = 0; nounIndex < tokens.length; nounIndex += 1) {
    const noun = singularHardwareNoun(tokens[nounIndex].normalized);
    if (!noun) {
      continue;
    }

    const candidateIndex = findCandidateIndex(tokens, nounIndex, message, knownTerms);
    if (candidateIndex === -1) {
      continue;
    }

    const candidate = tokens[candidateIndex];
    const phrase = phraseFromTokens(tokens, candidateIndex, nounIndex);
    if (isKnownMention(tokens, candidateIndex, nounIndex, knownTerms)) {
      continue;
    }

    const key = `${candidate.normalized}|${noun}|${normalizeTerm(phrase)}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    findings.push({
      token: candidate.raw,
      noun,
      phrase
    });
  }

  return findings;
}

function addKnownTerm(terms: Set<string>, value: string): void {
  const normalized = normalizeTerm(value);
  if (!normalized) {
    return;
  }

  terms.add(normalized);
  terms.add(normalized.replace(/\s+/g, ''));

  const pieces = normalized.split(' ').filter(Boolean);
  for (let start = 0; start < pieces.length; start += 1) {
    for (let end = start + 1; end <= pieces.length; end += 1) {
      const phrase = pieces.slice(start, end).join(' ');
      terms.add(phrase);
      terms.add(phrase.replace(/\s+/g, ''));
    }
  }
}

function tokenize(message: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(message)) !== null) {
    const raw = match[0];
    const normalized = normalizeTerm(raw);
    if (!normalized) {
      continue;
    }
    tokens.push({
      raw,
      normalized,
      start: match.index,
      end: match.index + raw.length
    });
  }

  return tokens;
}

function findCandidateIndex(tokens: Token[], nounIndex: number, message: string, knownTerms: Set<string>): number {
  const minIndex = Math.max(0, nounIndex - 4);
  const candidates: number[] = [];

  for (let index = nounIndex - 1; index >= minIndex; index -= 1) {
    if (hasHardBoundary(message.slice(tokens[index].end, tokens[index + 1].start))) {
      break;
    }

    const normalized = tokens[index].normalized;
    if (GENERIC_MODIFIERS.has(normalized)) {
      continue;
    }
    if (BOUNDARY_TERMS.has(normalized) || HARDWARE_NOUNS.has(normalized)) {
      break;
    }
    if (!/[a-z0-9]/.test(normalized)) {
      continue;
    }

    candidates.push(index);
  }

  if (candidates.length === 0) {
    return -1;
  }

  const unknownExplicit = [...candidates]
    .sort((left, right) => left - right)
    .find((index) => !isKnownToken(tokens[index].normalized, knownTerms));

  return unknownExplicit ?? candidates[0];
}

function isKnownMention(tokens: Token[], candidateIndex: number, nounIndex: number, knownTerms: Set<string>): boolean {
  const candidate = tokens[candidateIndex].normalized;
  if (isKnownToken(candidate, knownTerms)) {
    return true;
  }

  for (let end = candidateIndex + 1; end <= nounIndex + 1; end += 1) {
    const phrase = tokens.slice(candidateIndex, end).map((token) => token.normalized).join(' ');
    if (knownTerms.has(phrase) || knownTerms.has(phrase.replace(/\s+/g, ''))) {
      return true;
    }
  }

  return false;
}

function isKnownToken(value: string, knownTerms: Set<string>): boolean {
  return knownTerms.has(value) || knownTerms.has(value.replace(/\s+/g, ''));
}

function phraseFromTokens(tokens: Token[], start: number, end: number): string {
  return tokens.slice(start, end + 1).map((token) => token.raw).join(' ');
}

function singularHardwareNoun(value: string): string | null {
  if (HARDWARE_NOUNS.has(value)) {
    return value;
  }
  if (value.endsWith('s')) {
    const singular = value.slice(0, -1);
    if (HARDWARE_NOUNS.has(singular)) {
      return singular;
    }
  }
  return null;
}

function hasHardBoundary(separator: string): boolean {
  return /[,.!?;:()[\]{}"'`]/.test(separator);
}

function normalizeTerm(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

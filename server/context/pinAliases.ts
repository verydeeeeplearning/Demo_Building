import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { PartCapabilitySchema, type PartCapability } from '../agent/schemas.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTEXT_ROOT = path.resolve(__dirname, '../../agent-context');

const PinAliasMapSchema = z.record(z.string(), z.array(z.string()));

export type ResolvedPinAlias = {
  partId: string;
  requestedAlias: string;
  canonicalPin: string;
  role: string;
  matchedAlias: string;
};

let cachedAliases: Record<string, string[]> | null = null;
let cachedParts: PartCapability[] | null = null;

export async function loadPinAliases(root = DEFAULT_CONTEXT_ROOT): Promise<Record<string, string[]>> {
  if (cachedAliases && root === DEFAULT_CONTEXT_ROOT) {
    return cachedAliases;
  }

  const indexContent = await readFile(path.join(root, 'index.json'), 'utf8');
  const index = JSON.parse(indexContent) as {
    data?: Array<{ id: string; path: string }>;
  };
  const entry = index.data?.find((candidate) => candidate.id === 'pin-aliases');
  if (!entry) {
    throw new Error('Context index is missing pin-aliases data entry');
  }

  const content = await readFile(path.join(root, entry.path), 'utf8');
  const aliases = PinAliasMapSchema.parse(JSON.parse(content));
  if (root === DEFAULT_CONTEXT_ROOT) {
    cachedAliases = aliases;
  }
  return aliases;
}

export async function resolvePinAlias(
  input: { partId: string; pinAlias: string },
  root = DEFAULT_CONTEXT_ROOT
): Promise<ResolvedPinAlias | null> {
  const [parts, aliases] = await Promise.all([
    loadPartRegistry(root),
    loadPinAliases(root)
  ]);
  const part = parts.find((candidate) => candidate.id === input.partId);
  if (!part) {
    return null;
  }

  const requested = normalize(input.pinAlias);
  for (const pin of part.pins) {
    const candidateAliases = collectAliasesForPin(pin, aliases);
    for (const alias of candidateAliases) {
      if (normalize(alias) === requested) {
        return {
          partId: part.id,
          requestedAlias: input.pinAlias,
          canonicalPin: pin.name,
          role: pin.role,
          matchedAlias: alias
        };
      }
    }
  }

  return null;
}

export function clearPinAliasCache() {
  cachedAliases = null;
  cachedParts = null;
}

async function loadPartRegistry(root: string): Promise<PartCapability[]> {
  if (cachedParts && root === DEFAULT_CONTEXT_ROOT) {
    return cachedParts;
  }

  const indexContent = await readFile(path.join(root, 'index.json'), 'utf8');
  const index = JSON.parse(indexContent) as {
    data?: Array<{ id: string; path: string }>;
  };
  const entry = index.data?.find((candidate) => candidate.id === 'part-capabilities');
  if (!entry) {
    throw new Error('Context index is missing part-capabilities data entry');
  }

  const content = await readFile(path.join(root, entry.path), 'utf8');
  const parts = z.array(PartCapabilitySchema).parse(JSON.parse(content));
  if (root === DEFAULT_CONTEXT_ROOT) {
    cachedParts = parts;
  }
  return parts;
}

function collectAliasesForPin(
  pin: PartCapability['pins'][number],
  globalAliases: Record<string, string[]>
) {
  const keys = unique([
    pin.name,
    ...pin.name.split(/[\/\s]+/),
    roleAliasKey(pin.role)
  ].filter(Boolean));

  return unique([
    pin.name,
    pin.role,
    ...pin.aliases,
    ...keys.flatMap((key) => [key, ...(globalAliases[key] ?? [])])
  ]);
}

function roleAliasKey(role: string) {
  const roleMap: Record<string, string> = {
    power: 'VCC',
    ground: 'GND',
    'ground-rail': 'GND',
    'power-rail': 'VCC',
    'i2c-data': 'SDA',
    'i2c-clock': 'SCL',
    'pwm-output': 'D9',
    'pwm-signal': 'D9',
    'digital-output': 'D8',
    'digital-input': 'D2'
  };
  return roleMap[role] ?? '';
}

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

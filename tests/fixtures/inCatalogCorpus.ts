// Phase 0 — in-catalog request corpus (the sole parity gate for later phases).
//
// A corpus case is a request plus the parts the pipeline MUST offer / MUST NOT offer for it.
// Cases come from three sources:
//   1. capability-base       — one request per supported primary-output capability, expecting
//                              that capability's required parts (the role-slot baseline).
//   2. compositional-variant — a primary capability combined with one compositional `-context`
//                              (e.g. a prototyping surface), the {0,1} compositional cross.
//   3. keyword-collision     — hand-authored interaction cases where a surface/passive keyword
//                              currently mis-routes and drops the needed primary part. Case #1
//                              (OLED + breadboard) is the measured root-cause bug.
//
// The generator is pure over the two committed data files so later phases can regenerate and
// extend it deterministically. `tests/fixtures/in-catalog-corpus.json` is the emitted artifact.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { CapabilityGraphEntrySchema, PartCapabilitySchema, type PartCapability } from '../../server/agent/schemas.ts';

export const CorpusCaseSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['capability-base', 'compositional-variant', 'keyword-collision']),
  locale: z.enum(['ko', 'en']),
  message: z.string().min(1),
  expectedCapabilityId: z.string().min(1).optional(),
  mustIncludePartIds: z.array(z.string().min(1)).default([]),
  mustExcludePartIds: z.array(z.string().min(1)).default([]),
  // True when the CURRENT (legacy) pipeline is known to fail this case (a Phase 1/2 fix target).
  knownBadLegacy: z.boolean().default(false),
  notes: z.string().optional()
});
export type CorpusCase = z.infer<typeof CorpusCaseSchema>;

export const InCatalogCorpusSchema = z.object({
  description: z.string().min(1),
  generatedFrom: z.array(z.string().min(1)),
  cases: z.array(CorpusCaseSchema).min(1)
});
export type InCatalogCorpus = z.infer<typeof InCatalogCorpusSchema>;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const CAPABILITY_GRAPH_PATH = path.join(REPO_ROOT, 'agent-context', 'data', 'capability-graph.json');
const PART_REGISTRY_PATH = path.join(REPO_ROOT, 'agent-context', 'registry', 'part-capabilities.json');
export const CORPUS_JSON_PATH = path.join(HERE, 'in-catalog-corpus.json');

const HANGUL = /[ㄱ-힝]/;
function firstKoreanOr(phrases: string[]): { phrase: string; locale: 'ko' | 'en' } {
  const ko = phrases.find((p) => HANGUL.test(p));
  if (ko) return { phrase: ko, locale: 'ko' };
  return { phrase: phrases[0], locale: 'en' };
}

// The five compositional contexts and a representative named part + keyword for each, used to
// build the {0,1} compositional variants and the keyword-collision interaction set.
const COMPOSITIONAL_SURFACES: Array<{ contextId: string; partId: string; ko: string; en: string }> = [
  { contextId: 'prototyping-surface-context', partId: 'breadboard-half', ko: '브레드보드에', en: 'on a breadboard' },
  { contextId: 'connector-wiring-context', partId: 'jumper-wire', ko: '점퍼 와이어로', en: 'with jumper wires' }
];

type RawCapability = z.infer<typeof CapabilityGraphEntrySchema>;

function buildCapabilityBaseCase(cap: RawCapability, registryIds: Set<string>): CorpusCase | null {
  if (cap.supportLevel !== 'supported') return null;
  if (cap.id.endsWith('-context')) return null; // compositional, not a primary-output request
  if (cap.studentPhrases.length === 0 || cap.requiredParts.length === 0) return null;
  const { phrase, locale } = firstKoreanOr(cap.studentPhrases);
  const mustInclude = cap.requiredParts.filter((id) => registryIds.has(id));
  if (mustInclude.length === 0) return null;
  return CorpusCaseSchema.parse({
    id: `base-${cap.id}`,
    kind: 'capability-base',
    locale,
    message: phrase,
    expectedCapabilityId: cap.id,
    mustIncludePartIds: mustInclude,
    mustExcludePartIds: [],
    knownBadLegacy: false,
    notes: 'Role-slot baseline: expects the capability\'s required parts.'
  });
}

/**
 * Pure corpus generator over the capability graph + part registry. Returns base cases for every
 * supported primary-output capability, a small set of compositional variants, plus the
 * hand-authored keyword-collision interaction set (including the measured OLED+breadboard bug).
 */
export function generateInCatalogCorpus(
  capabilityGraph: RawCapability[],
  registry: PartCapability[]
): InCatalogCorpus {
  const registryIds = new Set(registry.map((part) => part.id));
  const baseCases = capabilityGraph
    .map((cap) => buildCapabilityBaseCase(cap, registryIds))
    .filter((value): value is CorpusCase => value !== null);

  // Compositional variant: a text-display request explicitly naming a prototyping surface. The
  // primary part (OLED + controller) must survive even though a surface is named.
  const variantCases: CorpusCase[] = COMPOSITIONAL_SURFACES.filter((s) => registryIds.has(s.partId)).map((surface) =>
    CorpusCaseSchema.parse({
      id: `variant-display-text-${surface.contextId}`,
      kind: 'compositional-variant',
      locale: 'ko',
      message: `아두이노 ${surface.ko} I2C OLED로 텍스트를 표시하고 싶어`,
      expectedCapabilityId: 'display-text-output',
      mustIncludePartIds: ['arduino-uno', 'oled-i2c-096', surface.partId],
      mustExcludePartIds: [],
      knownBadLegacy: surface.contextId === 'prototyping-surface-context',
      notes: 'Primary output (OLED text) must survive when a compositional surface is named.'
    })
  );

  // Keyword-collision interaction set (#1 is the measured root-cause bug).
  const collisionCases: CorpusCase[] = [
    CorpusCaseSchema.parse({
      id: 'collision-01-oled-breadboard',
      kind: 'keyword-collision',
      locale: 'ko',
      message: '아두이노 브레드보드에 I2C OLED로 이벤트 이름 텍스트를 표시하고 싶어',
      expectedCapabilityId: 'display-text-output',
      mustIncludePartIds: ['arduino-uno', 'oled-i2c-096'],
      mustExcludePartIds: ['perfboard-5x7', 'pcb-blank-single', 'proto-shield-uno'],
      knownBadLegacy: true,
      notes: 'Case #1: "브레드보드" mis-routes to v2-prototyping-surface-context and drops the OLED + controller.'
    }),
    CorpusCaseSchema.parse({
      id: 'collision-02-led-breadboard',
      kind: 'keyword-collision',
      locale: 'ko',
      message: '브레드보드에 LED 하나를 저항이랑 같이 켜고 싶어',
      expectedCapabilityId: 'digital-light-output',
      mustIncludePartIds: ['arduino-uno', 'led-5mm', 'resistor-220'],
      mustExcludePartIds: ['perfboard-5x7', 'pcb-blank-single'],
      knownBadLegacy: false,
      notes: 'Sibling collision: LED output named with a breadboard surface.'
    })
  ];

  return InCatalogCorpusSchema.parse({
    description:
      'In-catalog request corpus: capability-base + compositional-variant + keyword-collision. Sole parity gate for the agent-pipeline refactor.',
    generatedFrom: ['agent-context/data/capability-graph.json', 'agent-context/registry/part-capabilities.json'],
    cases: [...baseCases, ...variantCases, ...collisionCases]
  });
}

/** Generate the corpus directly from the committed data files (used by the emitter CLI). */
export async function generateInCatalogCorpusFromDisk(): Promise<InCatalogCorpus> {
  const [graphRaw, registryRaw] = await Promise.all([
    readFile(CAPABILITY_GRAPH_PATH, 'utf8'),
    readFile(PART_REGISTRY_PATH, 'utf8')
  ]);
  const capabilityGraph = z.array(CapabilityGraphEntrySchema).parse(JSON.parse(graphRaw));
  const registry = z.array(PartCapabilitySchema).parse(JSON.parse(registryRaw));
  return generateInCatalogCorpus(capabilityGraph, registry);
}

/** Load and validate the committed corpus artifact. */
export async function loadInCatalogCorpus(): Promise<InCatalogCorpus> {
  const raw = await readFile(CORPUS_JSON_PATH, 'utf8');
  return InCatalogCorpusSchema.parse(JSON.parse(raw));
}

/**
 * Deterministic, schema-valid synthetic part — used by the Phase 2 catalog-growth test to double
 * the registry without touching real product data. Pure function of `seed` (no randomness).
 */
export function makeSyntheticPart(seed: number): PartCapability {
  const id = `synthetic-part-${seed}`;
  return PartCapabilitySchema.parse({
    id,
    kind: 'output',
    label: `Synthetic Part ${seed}`,
    aliases: [`synthetic ${seed}`],
    pins: [
      { name: 'VCC', role: 'power' },
      { name: 'GND', role: 'ground' },
      { name: 'SIG', role: 'signal' }
    ],
    electrical: {
      voltageRange: { min: 0, max: 5, nominal: 5 },
      maxCurrentMa: 20,
      requiresCurrentLimiting: false
    },
    protocols: [],
    renderFootprint: { type: 'generic-dip', width: 10, depth: 10, height: 3 },
    simulationModel: { type: 'generic-load', nominalCurrentMa: 10 },
    supportLevel: 'supported',
    capabilities: []
  });
}

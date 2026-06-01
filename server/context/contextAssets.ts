import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import {
  RenderFootprintEntrySchema,
  SimulationPrimitiveSchema,
  TopologyTemplateSchema,
  type RenderFootprintEntry,
  type SimulationPrimitive,
  type TopologyTemplate
} from '../agent/schemas.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTEXT_ROOT = path.resolve(__dirname, '../../agent-context');

const SimulationPrimitiveListSchema = z.array(SimulationPrimitiveSchema);
const RenderFootprintMapSchema = z.record(z.string(), RenderFootprintEntrySchema);
const TopologyTemplateListSchema = z.array(TopologyTemplateSchema);
const SnapToleranceSchema = z.object({
  x: z.number().positive(),
  z: z.number().positive()
});
const BreadboardGridSchema = z.object({
  version: z.string().min(1),
  coordinateSystem: z.object({
    units: z.string().min(1),
    origin: z.string().min(1),
    xAxis: z.string().min(1),
    zAxis: z.string().min(1)
  }),
  signalArea: z.object({
    xStart: z.number(),
    xEnd: z.number(),
    xPitch: z.number().positive(),
    snapTolerance: SnapToleranceSchema,
    rows: z.array(z.object({
      id: z.string().min(1),
      z: z.number(),
      continuityGroup: z.string().min(1)
    })).min(1)
  }),
  rails: z.array(z.object({
    id: z.string().min(1),
    role: z.string().min(1),
    z: z.number(),
    xStart: z.number(),
    xEnd: z.number(),
    xPitch: z.number().positive(),
    snapTolerance: SnapToleranceSchema
  })).min(1)
});

let cachedPrimitives: SimulationPrimitive[] | null = null;
let cachedFootprints: Record<string, RenderFootprintEntry> | null = null;
let cachedTopologyTemplates: TopologyTemplate[] | null = null;
let cachedBreadboardGrid: BreadboardGrid | null = null;

export type BreadboardGrid = z.infer<typeof BreadboardGridSchema>;

export async function loadSimulationPrimitives(root = DEFAULT_CONTEXT_ROOT): Promise<SimulationPrimitive[]> {
  if (cachedPrimitives && root === DEFAULT_CONTEXT_ROOT) {
    return cachedPrimitives;
  }

  const content = await readIndexedData(root, 'simulation-primitives');
  const primitives = SimulationPrimitiveListSchema.parse(JSON.parse(content));
  if (root === DEFAULT_CONTEXT_ROOT) {
    cachedPrimitives = primitives;
  }
  return primitives;
}

export async function loadRenderFootprints(root = DEFAULT_CONTEXT_ROOT): Promise<Record<string, RenderFootprintEntry>> {
  if (cachedFootprints && root === DEFAULT_CONTEXT_ROOT) {
    return cachedFootprints;
  }

  const content = await readIndexedData(root, 'render-footprints');
  const footprints = RenderFootprintMapSchema.parse(JSON.parse(content));
  if (root === DEFAULT_CONTEXT_ROOT) {
    cachedFootprints = footprints;
  }
  return footprints;
}

export async function loadTopologyTemplates(root = DEFAULT_CONTEXT_ROOT): Promise<TopologyTemplate[]> {
  if (cachedTopologyTemplates && root === DEFAULT_CONTEXT_ROOT) {
    return cachedTopologyTemplates;
  }

  const content = await readIndexedData(root, 'topology-templates');
  const templates = TopologyTemplateListSchema.parse(JSON.parse(content));
  if (root === DEFAULT_CONTEXT_ROOT) {
    cachedTopologyTemplates = templates;
  }
  return templates;
}

export async function loadBreadboardGrid(root = DEFAULT_CONTEXT_ROOT): Promise<BreadboardGrid> {
  if (cachedBreadboardGrid && root === DEFAULT_CONTEXT_ROOT) {
    return cachedBreadboardGrid;
  }

  const content = await readIndexedData(root, 'breadboard-grid');
  const grid = BreadboardGridSchema.parse(JSON.parse(content));
  if (root === DEFAULT_CONTEXT_ROOT) {
    cachedBreadboardGrid = grid;
  }
  return grid;
}

export function clearContextAssetCache() {
  cachedPrimitives = null;
  cachedFootprints = null;
  cachedTopologyTemplates = null;
  cachedBreadboardGrid = null;
}

async function readIndexedData(root: string, id: string) {
  const indexContent = await readFile(path.join(root, 'index.json'), 'utf8');
  const index = JSON.parse(indexContent) as {
    data?: Array<{ id: string; path: string }>;
  };
  const entry = index.data?.find((candidate) => candidate.id === id);
  if (!entry) {
    throw new Error(`Context index is missing ${id} data entry`);
  }
  return readFile(path.join(root, entry.path), 'utf8');
}

import {
  getPartRegistry,
  loadContextBundleV2,
  loadContextIndex,
  loadSimulationPrimitives,
  readContextDoc,
  resolveContextSourceId,
  type ContextEntry,
  type ContextIndex
} from './contextLayer.ts';
import { loadHardwareSupportBundles } from './sourceClaims.ts';

export type ScopedContextReaderOptions = {
  allowedSourceIds?: string[];
  allowedContextSourceIds?: string[];
  allowUnscopedContext?: boolean;
  scopeErrorCode?: string;
};

function asJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export async function loadScopedContextIndex(options: ScopedContextReaderOptions): Promise<ContextIndex> {
  const index = await loadContextIndex();
  if (options.allowUnscopedContext) {
    return index;
  }

  const allowedSourceIds = scopedAllowedSourceIds(options);
  const allowedEntries = allowedSourceIds
    .map((sourceId) => findContextEntry(index, sourceId))
    .filter((entry): entry is ContextEntry => Boolean(entry));
  const allowedKeys = new Set(allowedEntries.flatMap((entry) => entryKeys(entry)));
  const filterEntries = (entries: ContextEntry[]) => entries.filter((entry) =>
    entryKeys(entry).some((key) => allowedKeys.has(key))
  );

  return {
    ...index,
    memory: filterEntries(index.memory),
    skills: filterEntries(index.skills),
    references: filterEntries(index.references),
    data: filterEntries(index.data),
    routing: filterEntries(index.routing)
  };
}

export async function readScopedContextSource(id: string, options: ScopedContextReaderOptions): Promise<string> {
  if (options.allowUnscopedContext) {
    return readUnscopedContextSource(id);
  }

  const allowedSourceIds = scopedAllowedSourceIds(options);
  if (allowedSourceIds.length === 0 || !allowedSourceIds.includes(id)) {
    return asJson({
      error: options.scopeErrorCode ?? 'CONTEXT_DOC_NOT_IN_SCOPE',
      requestedId: id,
      allowedSourceIds
    });
  }

  if (id.startsWith('registry:part-capabilities:')) {
    return readPartCapabilityProjection(id);
  }
  if (id.startsWith('data:simulation-primitives:')) {
    return readSimulationPrimitiveProjection(id);
  }
  if (id.startsWith('bundle:')) {
    return readBundleProjection(id);
  }
  if (id.startsWith('sources:support-bundle:')) {
    return readSupportBundleProjection(id);
  }

  const index = await loadContextIndex();
  const requestedEntry = findContextEntry(index, id);
  if (!requestedEntry) {
    return asJson({
      error: 'CONTEXT_DOC_NOT_FOUND',
      requestedId: id,
      allowedSourceIds
    });
  }

  return readContextDoc(requestedEntry.id);
}

async function readUnscopedContextSource(id: string) {
  if (id.startsWith('registry:part-capabilities:')) {
    return readPartCapabilityProjection(id);
  }
  if (id.startsWith('data:simulation-primitives:')) {
    return readSimulationPrimitiveProjection(id);
  }
  if (id.startsWith('bundle:')) {
    return readBundleProjection(id);
  }
  if (id.startsWith('sources:support-bundle:')) {
    return readSupportBundleProjection(id);
  }
  const index = await loadContextIndex();
  const entry = findContextEntry(index, id);
  if (!entry) {
    return asJson({ error: 'CONTEXT_DOC_NOT_FOUND', requestedId: id });
  }
  const entryId = entry.id;
  return readContextDoc(entryId);
}

async function readPartCapabilityProjection(sourceId: string) {
  const partId = sourceId.slice('registry:part-capabilities:'.length);
  const part = (await getPartRegistry()).find((candidate) => candidate.id === partId);
  if (!part) {
    return asJson({ error: 'CONTEXT_ITEM_NOT_FOUND', requestedId: sourceId, kind: 'part-capability' });
  }
  return asJson({
    sourceId,
    kind: 'part-capability',
    item: part
  });
}

async function readSimulationPrimitiveProjection(sourceId: string) {
  const primitiveId = sourceId.slice('data:simulation-primitives:'.length);
  const primitive = (await loadSimulationPrimitives()).find((candidate) => candidate.id === primitiveId);
  if (!primitive) {
    return asJson({ error: 'CONTEXT_ITEM_NOT_FOUND', requestedId: sourceId, kind: 'simulation-primitive' });
  }
  return asJson({
    sourceId,
    kind: 'simulation-primitive',
    item: primitive
  });
}

async function readBundleProjection(sourceId: string) {
  const bundleId = sourceId.slice('bundle:'.length);
  const bundle = await loadContextBundleV2(bundleId);
  return [
    bundle.summary,
    '',
    `supportLevel=${bundle.manifest.supportLevel}`,
    `allowedParts=${bundle.manifest.allowedParts.join(', ')}`,
    `requiredParts=${bundle.manifest.requiredParts.join(', ')}`,
    `validationRules=${bundle.manifest.validationRules.join(', ')}`,
    `simulationPrimitives=${bundle.manifest.simulationPrimitives.join(', ')}`,
    `renderFootprints=${bundle.manifest.renderFootprints.join(', ')}`
  ].join('\n');
}

async function readSupportBundleProjection(sourceId: string) {
  const capabilityId = sourceId.slice('sources:support-bundle:'.length);
  const bundle = (await loadHardwareSupportBundles()).find((candidate) => candidate.capabilityId === capabilityId);
  if (!bundle) {
    return asJson({ error: 'CONTEXT_ITEM_NOT_FOUND', requestedId: sourceId, kind: 'support-bundle' });
  }
  return asJson({
    sourceId,
    kind: 'support-bundle',
    item: bundle
  });
}

function findContextEntry(index: ContextIndex, id: string): ContextEntry | null {
  return allEntries(index)
    .find((entry) => entry.id === id || entry.sourceId === id || entry.aliases.includes(id))
    ?? resolveContextSourceId(id, index);
}

function allEntries(index: ContextIndex): ContextEntry[] {
  return [...index.memory, ...index.skills, ...index.references, ...index.data, ...index.routing];
}

function entryKeys(entry: ContextEntry) {
  return [entry.id, entry.sourceId, ...entry.aliases];
}

function scopedAllowedSourceIds(options: ScopedContextReaderOptions) {
  return options.allowedSourceIds ?? options.allowedContextSourceIds ?? [];
}

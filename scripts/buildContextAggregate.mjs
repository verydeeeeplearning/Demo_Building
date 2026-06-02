import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const [sourceRootArg, ...flags] = process.argv.slice(2);
const args = new Set(flags);
const shouldWrite = args.has('--write');
const shouldCheck = args.has('--check');

if (!sourceRootArg || (!shouldWrite && !shouldCheck)) {
  console.error('Usage: node scripts/buildContextAggregate.mjs <source-root> --write|--check');
  process.exit(2);
}

const sourceRoot = path.resolve(sourceRootArg);
const sourceIndexPath = path.join(sourceRoot, 'index.json');
const sourceIndex = JSON.parse(await readFile(sourceIndexPath, 'utf8'));
const aggregatePath = path.resolve(sourceRoot, sourceIndex.aggregatePath);
const sourceEntriesById = new Map();
const duplicateIds = [];

for (const category of sourceIndex.categories) {
  const categoryPath = path.join(sourceRoot, category.path);
  const entries = JSON.parse(await readFile(categoryPath, 'utf8'));
  const normalizedEntries = entriesForSource(entries, sourceIndex);

  for (const entry of normalizedEntries) {
    const id = sourceEntryId(entry, sourceIndex);
    if (!id) {
      throw new Error(`Context source ${category.path} contains an entry without id field ${sourceIndex.keyField}.`);
    }
    if (sourceEntriesById.has(id)) {
      duplicateIds.push(id);
    }
    sourceEntriesById.set(id, entry);
  }
}

if (duplicateIds.length > 0) {
  throw new Error(`Duplicate context ids across source files: ${duplicateIds.join(', ')}`);
}

const orderedEntries = buildOrderedEntries(sourceIndex, sourceEntriesById);
const aggregate = aggregateForKind(orderedEntries, sourceIndex);
const aggregateJson = `${JSON.stringify(aggregate, null, 2)}\n`;

if (shouldCheck) {
  const currentAggregate = await readFile(aggregatePath, 'utf8');
  if (currentAggregate !== aggregateJson) {
    console.error(`Generated context aggregate is stale: ${path.relative(process.cwd(), aggregatePath)}`);
    console.error(`Run node scripts/buildContextAggregate.mjs ${path.relative(process.cwd(), sourceRoot)} --write to regenerate it.`);
    process.exit(1);
  }
  console.log(`Context aggregate is current: ${path.relative(process.cwd(), aggregatePath)} (${orderedEntries.length} entries).`);
}

if (shouldWrite) {
  await writeFile(aggregatePath, aggregateJson);
  console.log(`Wrote ${path.relative(process.cwd(), aggregatePath)} from ${sourceIndex.categories.length} source files (${orderedEntries.length} entries).`);
}

function entriesForSource(entries, index) {
  if (index.kind === 'array') {
    if (!Array.isArray(entries)) {
      throw new Error('Array aggregate sources must be JSON arrays.');
    }
    return entries;
  }

  if (index.kind === 'record') {
    if (!entries || Array.isArray(entries) || typeof entries !== 'object') {
      throw new Error('Record aggregate sources must be JSON objects.');
    }
    return Object.entries(entries).map(([id, value]) => ({ id, value }));
  }

  throw new Error(`Unsupported aggregate kind: ${index.kind}`);
}

function sourceEntryId(entry, index) {
  if (index.kind === 'record') {
    return entry.id;
  }
  return entry?.[index.keyField];
}

function buildOrderedEntries(index, entriesById) {
  if (!Array.isArray(index.order) || index.order.length === 0) {
    return [...entriesById.values()];
  }

  const ordered = [];
  const seen = new Set();
  const missingIds = [];

  for (const id of index.order) {
    const entry = entriesById.get(id);
    if (!entry) {
      missingIds.push(id);
      continue;
    }
    ordered.push(entry);
    seen.add(id);
  }

  const unorderedIds = [...entriesById.keys()].filter((id) => !seen.has(id));
  if (missingIds.length > 0 || unorderedIds.length > 0) {
    const details = [
      missingIds.length > 0 ? `missing from sources: ${missingIds.join(', ')}` : '',
      unorderedIds.length > 0 ? `missing from source index order: ${unorderedIds.join(', ')}` : ''
    ].filter(Boolean).join('; ');
    throw new Error(`Context source index drift: ${details}`);
  }

  return ordered;
}

function aggregateForKind(entries, index) {
  if (index.kind === 'array') {
    return entries;
  }

  if (index.kind === 'record') {
    return Object.fromEntries(entries.map((entry) => [entry.id, entry.value]));
  }

  throw new Error(`Unsupported aggregate kind: ${index.kind}`);
}

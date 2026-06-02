// Emitter CLI for the in-catalog corpus. Regenerate with:
//   npx tsx tests/fixtures/buildInCatalogCorpus.mts
// Pure over agent-context/data/capability-graph.json + agent-context/registry/part-capabilities.json.
import { writeFile } from 'node:fs/promises';

import { CORPUS_JSON_PATH, generateInCatalogCorpusFromDisk } from './inCatalogCorpus.ts';

const corpus = await generateInCatalogCorpusFromDisk();
await writeFile(CORPUS_JSON_PATH, `${JSON.stringify(corpus, null, 2)}\n`, 'utf8');
console.log(`Wrote ${corpus.cases.length} cases to ${CORPUS_JSON_PATH}`);

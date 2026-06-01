import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildGeneralizationEvalReport } from './generalizationEvalReport.ts';

const pretty = process.argv.includes('--pretty');
const outIndex = process.argv.indexOf('--out');
const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;

try {
  const report = await buildGeneralizationEvalReport();
  const json = JSON.stringify(report, null, pretty ? 2 : 0);
  if (outPath) {
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${json}\n`, 'utf8');
  } else {
    console.log(json);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to build generalization eval report: ${message}`);
  process.exitCode = 1;
}

import { createContextQaArtifactBundle } from './contextQaArtifactBundle.ts';

const runId = readArg('--run-id');
const rootDir = readArg('--root');

try {
  const bundle = await createContextQaArtifactBundle({ runId, rootDir });
  console.log(JSON.stringify({
    runId: bundle.runId,
    runDir: bundle.runDir,
    generatedAt: bundle.generatedAt,
    files: bundle.files
  }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to create context QA artifact bundle: ${message}`);
  process.exitCode = 1;
}

function readArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

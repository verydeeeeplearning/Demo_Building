import path from 'node:path';

import {
  assertVisualPartCoverageTargets,
  buildVisualPartCoverageReport,
  renderVisualPartCoverageMarkdown,
  writeVisualPartCoverageMarkdown
} from './visualPartCoverageReport.ts';

const args = new Set(process.argv.slice(2));
const defaultOutputPath = path.resolve(process.cwd(), 'docs/visual_part_simulation_coverage_report.md');

try {
  const report = args.has('--write')
    ? await writeVisualPartCoverageMarkdown(defaultOutputPath)
    : await buildVisualPartCoverageReport();

  assertVisualPartCoverageTargets(report);

  if (args.has('--strict-final') && report.remainingTargetCount > 0) {
    throw new Error(`Visual part coverage is not complete: ${report.remainingTargetCount} target parts remain.`);
  }

  if (args.has('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderVisualPartCoverageMarkdown(report));
    if (args.has('--write')) {
      console.error(`Wrote ${defaultOutputPath}`);
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}

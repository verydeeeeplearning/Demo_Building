import { buildSourceClaimIntegrityReport } from './sourceClaimIntegrity.ts';

const report = await buildSourceClaimIntegrityReport();
console.log(JSON.stringify(report, null, 2));

if (report.issues.some((issue) => issue.severity === 'error')) {
  process.exitCode = 1;
}

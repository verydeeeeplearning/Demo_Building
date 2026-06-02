import { buildSourceClaimReport } from './sourceClaimReport.ts';

const report = await buildSourceClaimReport();
console.log(JSON.stringify(report, null, 2));

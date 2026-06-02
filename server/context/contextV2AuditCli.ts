import { buildContextV2Audit, contextV2AuditHasFailures } from './contextV2Audit.ts';

const audit = await buildContextV2Audit();

console.log(JSON.stringify(audit, null, 2));

if (contextV2AuditHasFailures(audit)) {
  process.exitCode = 1;
}

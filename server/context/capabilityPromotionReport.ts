import { auditCapabilityPromotionGaps } from './contextLayer.ts';

const pretty = process.argv.includes('--pretty');

try {
  const report = await auditCapabilityPromotionGaps();
  console.log(JSON.stringify(report, null, pretty ? 2 : 0));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to audit capability promotion gaps: ${message}`);
  process.exitCode = 1;
}

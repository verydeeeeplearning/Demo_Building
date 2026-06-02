// Live proof of the original failure: "아두이노 브레드보드에 I2C OLED로 텍스트 표시".
// Runs it under BOTH legacy and next against the real model and reports the BUILT circuit's parts
// (renderPlan) + validation, proving `next` wires the OLED while `legacy` drops it.
// Usage: source .local/agent.env, then `npx tsx scripts/liveOledProof.mts`.
import { runAgent } from '../server/agent/deepAgentRuntime.ts';
import type { AgentMessageRequest } from '../server/agent/schemas.ts';

const MESSAGE = '아두이노 브레드보드에 I2C OLED로 이벤트 이름 텍스트를 표시하고 싶어';

async function runUnder(mode: 'legacy' | 'next') {
  process.env.H_EDUWARE_AGENT_PIPELINE = mode;
  const startedAt = Date.now();
  try {
    const result = await runAgent({ message: MESSAGE, locale: 'ko' } as AgentMessageRequest);
    const specBlob = JSON.stringify(result.circuitSpec).toLowerCase();
    const renderPartIds = [...new Set(result.renderPlan.parts.map((p) => `${p.id}:${p.type}`))];
    return {
      mode,
      completed: true,
      validation: result.validationReport.status,
      buildRunnable: result.buildRunnableReport.status,
      hasOLED: specBlob.includes('oled-i2c-096') || specBlob.includes('oled'),
      renderPartIds,
      assistantPreview: (result.assistantMessages[0] ?? '').slice(0, 120),
      error: null as string | null,
      ms: Date.now() - startedAt
    };
  } catch (err) {
    return {
      mode,
      completed: false,
      validation: null,
      buildRunnable: null,
      hasOLED: false,
      renderPartIds: [] as string[],
      assistantPreview: null,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      ms: Date.now() - startedAt
    };
  }
}

const legacy = await runUnder('legacy');
const next = await runUnder('next');
console.log(JSON.stringify({ message: MESSAGE, legacy, next }, null, 2));
console.log(`\nOLED present — legacy: ${legacy.hasOLED}  next: ${next.hasOLED}`);

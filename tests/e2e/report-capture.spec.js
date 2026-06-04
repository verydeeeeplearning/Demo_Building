import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// US-6 capture pass: drive 10 diverse student queries through the LOCAL app end to end and save, per
// query, (1) the agent trace + (2) the spec document (from the /api/agent/message response) and
// (3) a screenshot of the completed simulation. A separate generator (scripts/buildE2eReport.mjs)
// compiles the artifacts into a .docx. Live-only: requires the agent server (RUN_LIVE_E2E=1).
//
// Run: RUN_LIVE_E2E=1 npx playwright test tests/e2e/report-capture.spec.js --project=desktop-chromium

const OUT_DIR = path.resolve('.local/e2e-report');

const QUERIES = [
  { id: '01-led', prompt: '아두이노와 LED로 LED 켜는 회로 만들어줘' },
  { id: '02-button-led', prompt: '버튼으로 LED 켜는 회로 만들어줘' },
  { id: '03-light-sensor', prompt: '조도센서로 어두우면 LED 켜는 회로 만들어줘' },
  { id: '04-ultrasonic', prompt: '초음파센서로 거리를 OLED에 표시하는 회로 만들어줘' },
  { id: '05-dht11', prompt: '온습도센서로 온도와 습도를 OLED에 표시하는 회로 만들어줘' },
  { id: '06-buzzer', prompt: '부저로 소리내는 회로 만들어줘' },
  { id: '07-servo', prompt: '서보모터를 움직이는 회로 만들어줘' },
  { id: '08-dimmer', prompt: '가변저항으로 LED 밝기를 조절하는 회로 만들어줘' },
  { id: '09-oled-text', prompt: 'OLED에 HELLO 글자를 표시하는 회로 만들어줘' },
  { id: '10-vague', prompt: '뭔가 만들어줘' }
];

// Run one query at a time (--workers=1) but NOT serial mode: a single query's timeout/failure must
// not abort the remaining captures (each is independent and writes its own best-effort artifact).
test.beforeAll(() => {
  test.skip(process.env.RUN_LIVE_E2E !== '1', 'set RUN_LIVE_E2E=1 to capture the live report');
  mkdirSync(OUT_DIR, { recursive: true });
});

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'report capture runs on desktop only');
});

async function dismissWelcome(page) {
  await page.goto('/');
  await page.getByTestId('welcome-dismiss').click();
}

for (const query of QUERIES) {
  test(`capture ${query.id}`, async ({ page, request }) => {
    test.setTimeout(240000);
    const health = await request.get('http://127.0.0.1:8787/api/agent/health');
    test.skip(!(health.ok() && (await health.json()).ok), 'requires a configured live agent');

    const responses = [];
    page.on('response', async (response) => {
      if (response.url().includes('/api/agent/message')) {
        try { responses.push(await response.json()); } catch { /* ignore */ }
      }
    });

    // Trigger an agent turn and block until it actually responds + the typing indicator clears.
    // Best-effort: a slow/failed turn never throws, so one bad query can't abort the serial run.
    const turn = async (action) => {
      const waitResponse = page.waitForResponse((r) => r.url().includes('/api/agent/message'), { timeout: 120000 }).catch(() => null);
      await action().catch(() => {});
      await waitResponse;
      await expect(page.getByTestId('ai-typing')).toHaveCount(0, { timeout: 120000 }).catch(() => {});
      await page.waitForTimeout(300);
    };

    let sceneCaptured = false;
    try {
      await dismissWelcome(page);
      await turn(() => Promise.all([
        page.locator('#idea-input').fill(query.prompt),
        page.locator('[data-action="send-idea"]').getByRole('button').click()
      ]).then(() => {}));

      // Narrowing flow: tap the first option until the agent stops asking (max 3 levels).
      for (let step = 0; step < 3; step += 1) {
        const chips = page.getByTestId('clarify-options');
        if (await chips.count() === 0) break;
        await turn(() => chips.locator('[data-action="clarify-option"]').first().click());
      }

      // Build + simulate if the agent produced a buildable draft.
      if (await page.locator('[data-action="confirm"]').count() > 0) {
        await page.locator('[data-action="confirm"]').click();
        if (await page.getByTestId('build-progress-skip').count() > 0) {
          await page.getByTestId('build-progress-skip').click();
        }
        await page.locator('[data-tab="PCB"]').click();
        const canvas = page.getByTestId('stage-canvas');
        if (await canvas.count() > 0) {
          await expect(canvas).toHaveAttribute('data-render-ready', 'true', { timeout: 30000 }).catch(() => {});
          if (await page.locator('[data-action="run"]').count() > 0) {
            await page.locator('[data-action="run"]').click().catch(() => {});
            await page.waitForTimeout(2000);
          }
          writeFileSync(path.join(OUT_DIR, `${query.id}.png`), await canvas.screenshot());
          sceneCaptured = true;
        }
      }
    } catch {
      // Keep whatever was captured; never abort the rest of the run.
    }

    const result = responses.at(-1) ?? {};
    expect(JSON.stringify(result)).not.toContain('sk-');
    writeFileSync(path.join(OUT_DIR, `${query.id}.json`), JSON.stringify({
      id: query.id,
      prompt: query.prompt,
      sceneCaptured,
      turns: responses.length,
      responseKind: result.responseKind ?? null,
      assistantMessages: result.assistantMessages ?? [],
      agentEvents: result.agentEvents ?? [],
      contextTrace: result.contextTrace ?? [],
      requirementMarkdown: result.requirementMarkdown ?? '',
      circuitSpec: result.circuitSpec ?? null,
      buildRunnableReport: result.buildRunnableReport ?? null
    }, null, 2));
  });
}

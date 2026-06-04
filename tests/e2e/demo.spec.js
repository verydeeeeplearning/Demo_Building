import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { loadMockOledProject } from './mockOledProject.js';

function countNonBackgroundPixels(buffer) {
  const image = PNG.sync.read(buffer);
  const [r0, g0, b0] = image.data;
  let changed = 0;

  for (let index = 0; index < image.data.length; index += 4) {
    const r = image.data[index];
    const g = image.data[index + 1];
    const b = image.data[index + 2];
    const a = image.data[index + 3];
    const distance = Math.abs(r - r0) + Math.abs(g - g0) + Math.abs(b - b0);

    if (a > 0 && distance > 40) changed += 1;
  }

  return changed;
}

function attachGuards(page) {
  const blockedRequests = [];
  const consoleErrors = [];
  const pageErrors = [];

  page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    const isLocalApp = requestUrl.hostname === '127.0.0.1' && requestUrl.port === '4173';
    const isLocalAgent = requestUrl.hostname === '127.0.0.1' && requestUrl.port === '8787';
    const isLocalOfflineAgent = requestUrl.hostname === '127.0.0.1' && requestUrl.port === '8799';

    if (isLocalOfflineAgent) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          defaultMode: 'deepagents-unconfigured',
          provider: 'openai',
          model: null,
          hasServerKey: false,
          requiredEnv: ['OPENAI_API_KEY', 'H_EDUWARE_AGENT_MODEL']
        })
      });
      return;
    }

    if (isLocalApp || isLocalAgent) {
      await route.continue();
      return;
    }

    blockedRequests.push(requestUrl.toString());
    await route.abort();
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  return { blockedRequests, consoleErrors, pageErrors };
}

async function isAgentConfigured(request) {
  if (process.env.RUN_LIVE_E2E !== '1') return false;
  try {
    const response = await request.get('http://127.0.0.1:8787/api/agent/health');
    if (!response.ok()) return false;
    const health = await response.json();
    return Boolean(health.ok);
  } catch {
    return false;
  }
}

async function forceOfflineAgent(page) {
  await page.addInitScript(() => {
    localStorage.setItem('hEduwareAgentApiBase', 'http://127.0.0.1:8799');
  });
}

test('student can complete the H-eduware demo path through the live agent boundary', async ({ page, request }) => {
  const guards = attachGuards(page);
  const configured = await isAgentConfigured(request);
  if (!configured) await forceOfflineAgent(page);

  await page.goto('/');
  await expect(page.getByTestId('welcome-popup')).toBeVisible();
  await page.getByTestId('welcome-dismiss').click();

  await expect(page.getByTestId('ai-panel')).toBeVisible();
  await expect(page.getByTestId('center-stage')).toBeVisible();
  await expect(page.getByTestId('new-project-landing')).toBeVisible();
  await expect(page.getByTestId('stage-canvas')).toHaveCount(0);
  await expect(page.locator('[data-action="run"]')).toBeDisabled();

  await loadMockOledProject(page);
  await expect(page.getByTestId('requirement-markdown')).toBeVisible();
  await expect(page.getByTestId('requirement-markdown')).toContainText('Arduino');
  await expect(page.getByTestId('requirement-markdown')).toContainText('I2C OLED');
  await expect(page.getByTestId('ai-panel')).toContainText(/OLED|행사 이름|event name/);
  await expect(page.getByTestId('ai-panel')).not.toContainText('Arduino Uno D8로 LED');
  await expect(page.getByTestId('file-explorer')).toBeVisible();
  await expect(page.getByTestId('file-explorer')).toContainText('requirements/oled-name-display.md');

  await page.locator('#idea-input').fill('show some text on a little screen');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.locator('.message.student').last()).toContainText('show some text on a little screen');
  await expect(page.getByTestId('ai-typing')).toBeVisible();
  await expect(page.locator('.message.assistant').last()).toBeVisible({ timeout: configured ? 90000 : 10000 });
  await expect(page.getByTestId('ai-typing')).toHaveCount(0, { timeout: configured ? 90000 : 10000 });
  await expect.poll(async () => ((await page.locator('.message.assistant').last().textContent()) ?? '').trim().length).toBeGreaterThan(10);
  const assistantText = await page.locator('.message.assistant').last().textContent();
  if (configured) {
    expect(assistantText).not.toContain('OPENAI_API_KEY');
  } else {
    expect(assistantText).toMatch(/OPENAI_API_KEY|server|서버|Deepagents/i);
  }

  await loadMockOledProject(page);
  await page.locator('[data-tab="Files"]').click();
  await expect(page.getByTestId('requirement-markdown')).toContainText('Arduino');
  await expect(page.getByTestId('file-explorer')).toBeVisible();

  await page.locator('[data-tab="PCB"]').click();
  await expect(page.getByTestId('part-library')).toBeVisible();
  await expect(page.getByTestId('file-explorer')).toHaveCount(0);
  await expect(page.locator('[data-testid="part-thumbnail"][data-thumbnail-renderer="canvas-isometric"]')).toHaveCount(3);

  const stageCanvas = page.getByTestId('stage-canvas');
  await expect(stageCanvas).toBeVisible();
  await expect(stageCanvas).toHaveAttribute('data-renderer', 'three');
  await expect(stageCanvas).toHaveAttribute('data-render-ready', 'true');

  await expect(page.getByTestId('floating-card')).toHaveCount(0);
  await expect(page.locator('.floating-cards')).toHaveCount(0);
  await expect(page.getByTestId('circuit-hover-tooltip')).toHaveCount(1);
  await expect(page.getByTestId('connection-list')).toBeVisible();
  await expect(page.locator('[data-inspect-type="connection"][data-inspect-id="oled-power"]')).toBeVisible();
  await expect(page.locator('[data-inspect-type="connection"][data-inspect-id="oled-ground"]')).toBeVisible();
  await expect(page.locator('[data-inspect-type="connection"][data-inspect-id="oled-sda"]')).toBeVisible();
  await expect(page.locator('[data-inspect-type="connection"][data-inspect-id="oled-scl"]')).toBeVisible();

  const canvasImage = await stageCanvas.screenshot();
  expect(countNonBackgroundPixels(canvasImage)).toBeGreaterThan(5000);

  await page.locator('[data-action="run"]').click();
  await expect(page.getByTestId('oled-output')).toHaveText('RALPHTON BUSAN');

  expect(guards.blockedRequests).toEqual([]);
  expect(guards.consoleErrors).toEqual([]);
  expect(guards.pageErrors).toEqual([]);
});

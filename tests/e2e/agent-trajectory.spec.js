import { expect, test } from '@playwright/test';

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'agent trajectory robustness smoke runs on desktop only');
});

const HEALTH = {
  ok: true,
  defaultMode: 'deepagents-live',
  hasServerKey: true,
  model: 'mock',
  provider: 'openai',
  requiredEnv: [],
  serverStartedAt: '2026-06-04T00:00:00.000Z',
  serverUptimeMs: 1000,
  sourceStatus: null
};

function chatResult({ sessionId, taskId, turnId, effectiveRequestKind, message }) {
  return {
    sessionId,
    taskId,
    turnId,
    effectiveRequestKind,
    mode: 'live',
    responseKind: 'chat',
    assistantMessages: [message],
    agentEvents: [],
    clarification: null,
    contextTrace: [
      { sourceId: 'policy:safety-policy', sourceType: 'policy', title: 'safety', retrievalBudget: 'summary', reason: 'mock' }
    ],
    contextCoverage: {
      status: 'insufficient',
      score: 0,
      sufficientFor: ['clarification_response'],
      synthesisEligibility: { status: 'ineligible', reason: 'mock chat' },
      missingSourceTypes: [],
      warnings: []
    },
    requirementMarkdown: '',
    circuitSpec: {
      id: 'chat-only',
      title: 'Chat only',
      intent: { primaryGoal: 'chat', output: 'conversation', controller: 'none' },
      components: [{ id: 'arduino-uno', partId: 'arduino-uno', label: 'Arduino Uno' }],
      connections: [],
      behavior: { runText: 'CHAT' },
      assumptions: [],
      unsupportedItems: [],
      clarificationNeeds: []
    },
    validationReport: { status: 'unsupported', errors: [], warnings: [], validatedCurrentPathIds: [] },
    renderPlan: { title: 'Chat only', runText: 'CHAT', parts: [], connections: [], floatingCards: [], warnings: [] },
    simulationPlan: { status: 'unsupported', runText: 'CHAT', currentPaths: [], expectedStates: [], warnings: [] },
    buildRunnableReport: {
      status: 'blocked',
      runnable: false,
      reasons: ['chat'],
      validationStatus: 'unsupported',
      simulationStatus: 'unsupported',
      renderWarningCount: 0,
      renderBlockingWarningCount: 0,
      renderPartCount: 0,
      currentPathCount: 0,
      expectedStateCount: 0
    },
    supportedAlternatives: [],
    clarificationChoices: [],
    clarificationRequest: null
  };
}

async function dismissWelcome(page) {
  await page.goto('/');
  await page.getByTestId('welcome-dismiss').click();
}

test('a superseded slow turn cannot overwrite the newer visible answer', async ({ page }) => {
  const posts = [];

  await page.route('**/api/agent/health', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HEALTH) });
  });
  await page.route('**/api/agent/message', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    posts.push(body);
    const sessionId = body.sessionId || 'session-trajectory';
    if (/led/i.test(body.message || '')) {
      await new Promise((resolve) => setTimeout(resolve, 450));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(chatResult({
          sessionId,
          taskId: body.taskId,
          turnId: body.turnId,
          effectiveRequestKind: body.requestKind,
          message: 'Stale LED answer'
        }))
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(chatResult({
        sessionId,
        taskId: body.taskId,
        turnId: body.turnId,
        effectiveRequestKind: body.requestKind,
        message: 'Fresh buzzer answer'
      }))
    });
  });

  await dismissWelcome(page);
  await page.locator('#idea-input').fill('Make an LED blink');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();

  await expect.poll(() => posts.length).toBe(1);
  await page.locator('#idea-input').fill('Make a buzzer beep');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();

  await expect.poll(() => posts.length).toBe(2);
  await expect(page.locator('.message.assistant').last()).toContainText('Fresh buzzer answer');
  await page.waitForTimeout(650);
  await expect(page.locator('.message.assistant').last()).toContainText('Fresh buzzer answer');
  await expect(page.locator('.message.assistant').last()).not.toContainText('Stale LED answer');

  expect(posts[0].requestKind).toBe('initial_task');
  expect(posts[1].requestKind).toBe('new_task');
  expect(posts[0].taskId).not.toBe(posts[1].taskId);
  expect(posts[0].turnId).not.toBe(posts[1].turnId);
});

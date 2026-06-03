import { expect, test } from '@playwright/test';

// E2E for the interactive narrowing loop, mocked at the network boundary so it runs deterministically
// against the real local app (no model/key). Verifies: awaiting_input renders grounded chips, tapping
// one resumes the paused thread (resume = option id), drill-down works, and a final selection carries
// the capabilityId. Server-side interrupt/resume is covered by unit tests.

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'narrowing UX smoke runs on desktop only');
});

const HEALTH = { ok: true, defaultMode: 'deepagents-live', hasServerKey: true, model: 'mock', provider: 'openai', requiredEnv: [], serverStartedAt: '2026-06-04T00:00:00.000Z', serverUptimeMs: 1000, sourceStatus: null };

function baseResult(sessionId, responseKind, reply) {
  return {
    sessionId, mode: 'live', responseKind,
    assistantMessages: [reply], agentEvents: [], clarification: null,
    contextTrace: [{ sourceId: 'policy:safety-policy', sourceType: 'policy', title: 'safety', retrievalBudget: 'summary', reason: 'mock' }],
    contextCoverage: { status: 'insufficient', score: 0, sufficientFor: ['clarification_response'], synthesisEligibility: { status: 'ineligible', reason: 'mock' }, missingSourceTypes: [], warnings: [] },
    requirementMarkdown: '',
    circuitSpec: { id: 'casual-chat', title: '대화', intent: { primaryGoal: 'chat', output: 'conversation', controller: 'none' }, components: [{ id: 'c', partId: 'arduino-uno', label: 'Arduino Uno' }], connections: [], behavior: { runText: 'CHAT' }, assumptions: [], unsupportedItems: [], clarificationNeeds: [] },
    validationReport: { status: 'unsupported', errors: [], warnings: [], validatedCurrentPathIds: [] },
    renderPlan: { title: '대화', runText: 'CHAT', parts: [], connections: [], floatingCards: [], warnings: [] },
    simulationPlan: { status: 'unsupported', runText: 'CHAT', currentPaths: [], expectedStates: [], warnings: [] },
    buildRunnableReport: { status: 'blocked', runnable: false, reasons: ['chat'], validationStatus: 'unsupported', simulationStatus: 'unsupported', renderWarningCount: 0, renderBlockingWarningCount: 0, renderPartCount: 0, currentPathCount: 0, expectedStateCount: 0 },
    supportedAlternatives: [], clarificationChoices: [], clarificationRequest: null
  };
}

function awaiting(sessionId, level, question, options) {
  return { ...baseResult(sessionId, 'awaiting_input', question), clarificationRequest: { level, question, options } };
}

async function mockAgent(page) {
  const posts = [];
  await page.route('**/api/agent/health', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HEALTH) }));
  await page.route('**/api/agent/message', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    posts.push(body);
    const sessionId = body.sessionId || 'session-clarify';
    let result;
    if (body.resume === 'sound') {
      result = awaiting(sessionId, 'sound', '소리 중에서 어떤 걸 만들까요?', [{ id: 'sound-alert-output', label: '부저', capabilityId: 'sound-alert-output' }]);
    } else if (body.resume === 'sound-alert-output') {
      result = baseResult(sessionId, 'chat', '좋아요 — 부저 회로를 준비할게요.');
    } else {
      result = awaiting(sessionId, 'output', '무엇을 만들어 볼까요?', [
        { id: 'light', label: '빛 / LED' },
        { id: 'sound', label: '소리' }
      ]);
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  return { posts };
}

async function dismissWelcome(page) {
  await page.goto('/');
  await page.getByTestId('welcome-dismiss').click();
}

test('vague request -> category chips -> drill-down -> capability selection resumes with the capabilityId', async ({ page }) => {
  const agent = await mockAgent(page);
  await dismissWelcome(page);

  await page.locator('#idea-input').fill('뭔가 만들어줘');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();

  // Top-level category chips.
  const chips = page.getByTestId('clarify-options');
  await expect(chips).toBeVisible();
  await expect(chips.locator('[data-action="clarify-option"]')).toHaveCount(2);
  await chips.getByRole('button', { name: '소리' }).click();

  // Drill-down chips after the category resume.
  await expect.poll(() => agent.posts.map((p) => p.resume)).toContain('sound');
  await expect(page.getByTestId('clarify-options').getByRole('button', { name: '부저' })).toBeVisible();

  await page.getByTestId('clarify-options').getByRole('button', { name: '부저' }).click();

  // Final selection resumes with the capabilityId and the ack shows; chips clear.
  await expect.poll(() => agent.posts.map((p) => p.resume)).toContain('sound-alert-output');
  await expect(page.locator('.message.assistant').last()).toContainText('부저 회로');
  await expect(page.getByTestId('clarify-options')).toHaveCount(0);
});

test('reload keeps the thread and reuses the session id mid-clarification', async ({ page }) => {
  const agent = await mockAgent(page);
  await dismissWelcome(page);
  await page.locator('#idea-input').fill('뭔가 만들어줘');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect(page.getByTestId('clarify-options')).toBeVisible();

  await page.reload();
  await expect(page.locator('.message.student').first()).toContainText('뭔가 만들어줘');
  await page.locator('#idea-input').fill('소리');
  await page.locator('[data-action="send-idea"]').getByRole('button').click();
  await expect.poll(() => agent.posts.at(-1)?.sessionId).toBe('session-clarify');
});

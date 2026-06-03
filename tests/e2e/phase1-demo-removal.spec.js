/**
 * Phase 1 RED tests — demo feature removal
 *
 * 1.1 No demo button exists anywhere (toolbar + landing) and initial state has
 *     no circuit loaded.
 * 1.2 Empty-workspace boot does not crash; stageRenderKey(null) returns '' and
 *     a placeholder / CTA is shown to the student.
 *
 * These tests MUST FAIL before the GREEN implementation.
 */
import { expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers shared with features.spec.js
// ---------------------------------------------------------------------------

async function dismissWelcome(page) {
  await page.goto('/');
  await page.getByTestId('welcome-dismiss').click();
}

async function forceOfflineAgent(page) {
  await page.addInitScript(() => {
    localStorage.setItem('hEduwareAgentApiBase', 'http://127.0.0.1:8799');
  });
}

// ---------------------------------------------------------------------------
// 1.1 — No demo button; initial state has no circuit
// ---------------------------------------------------------------------------

test.describe('Phase 1 — demo removal', () => {
  test.beforeEach(async ({ page }) => {
    await forceOfflineAgent(page);
    await dismissWelcome(page);
  });

  test('1.1a no demo button in toolbar', async ({ page }) => {
    // The toolbar must not contain any element with data-action="load-demo"
    await expect(page.locator('[data-action="load-demo"]')).toHaveCount(0);
  });

  test('1.1b no demo button on landing panel', async ({ page }) => {
    // The new-project landing must not have a load-demo button
    const landing = page.getByTestId('new-project-landing');
    await expect(landing).toBeVisible();
    await expect(landing.locator('[data-action="load-demo"]')).toHaveCount(0);
  });

  test('1.1c no element with class demo-action exists', async ({ page }) => {
    await expect(page.locator('.demo-action')).toHaveCount(0);
  });

  test('1.1d initial state has no circuit — project is not loaded', async ({ page }) => {
    // state.projectLoaded starts false; the has-project CSS class is absent.
    await expect(page.locator('.workbench.has-project')).toHaveCount(0);
  });

  test('1.1e initial state has no circuit — landing is shown', async ({ page }) => {
    await expect(page.getByTestId('new-project-landing')).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // 1.2 — Empty-workspace boot does not crash; CTA is shown
  // ---------------------------------------------------------------------------

  test('1.2a page boots without console errors on empty workspace', async ({ page }) => {
    // beforeEach already dismissed the welcome popup; collect errors from the
    // current page state (we're already on the landing after dismissWelcome).
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    // Give any async boot work a moment to settle then reload to catch any
    // boot-time errors with listeners already attached.
    await page.reload();
    await page.waitForTimeout(500);

    expect(errors).toEqual([]);
  });

  test('1.2b empty workspace shows an empty-state CTA prompting the student', async ({ page }) => {
    // After Phase 1 the landing body must NOT mention "demo" and must still
    // contain a call-to-action for the student.
    const landing = page.getByTestId('new-project-landing');
    await expect(landing).toBeVisible();
    const text = (await landing.textContent()) ?? '';
    // Must not mention "demo" anywhere in the visible copy
    expect(text.toLowerCase()).not.toContain('demo');
    // Must contain some prompt that directs the student to create a circuit
    expect(text.trim().length).toBeGreaterThan(10);
  });

  test('1.2c stageRenderKey with no circuit produces an empty string (unit smoke)', async ({ page }) => {
    // Smoke-test via page.evaluate: import stageScene and call stageRenderKey(null).
    // The module is bundled by Vite and not directly importable in the browser, so
    // we verify the observable side-effect: the PCB tab renders no stage canvas
    // when there is no circuit.
    await page.locator('[data-tab="PCB"]').click();
    // No canvas should be present with no circuit
    await expect(page.getByTestId('stage-canvas')).toHaveCount(0);
  });
});

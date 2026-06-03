import { expect, test } from '@playwright/test';

// Phase 3 (P3 focus trap / Escape) + (P14 touch targets) accessibility guards.

function attachConsoleGuard(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

function assertConsoleClean(guards) {
  // 502/Bad Gateway noise from the optional live agent boundary is unrelated.
  expect(guards.consoleErrors.filter((m) => !/502|Bad Gateway/i.test(m))).toEqual([]);
  expect(guards.pageErrors).toEqual([]);
}

test('welcome modal closes on Escape (P3)', async ({ page }) => {
  const guards = attachConsoleGuard(page);
  await page.goto('/');
  await expect(page.getByTestId('welcome-popup')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('welcome-popup')).toHaveCount(0);

  assertConsoleClean(guards);
});

test('welcome modal traps Tab focus inside the dialog (P3)', async ({ page }) => {
  await page.goto('/');
  const overlay = page.getByTestId('welcome-popup');
  await expect(overlay).toBeVisible();

  // Tab forward many times; focus must never escape the dialog.
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    const focusInside = await page.evaluate(() => {
      const dialog = document.querySelector('[data-testid="welcome-popup"]');
      return dialog ? dialog.contains(document.activeElement) : false;
    });
    expect(focusInside).toBe(true);
  }

  // Shift+Tab from the first element wraps back into the dialog too.
  await page.keyboard.press('Shift+Tab');
  const focusInsideBack = await page.evaluate(() => {
    const dialog = document.querySelector('[data-testid="welcome-popup"]');
    return dialog ? dialog.contains(document.activeElement) : false;
  });
  expect(focusInsideBack).toBe(true);
});

test('modal close button meets the 44px touch target (P14)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome-popup')).toBeVisible();

  const box = await page.getByTestId('welcome-close').boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
});

test('language toggle options meet the 44px touch target (P14)', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('welcome-dismiss').click();
  await expect(page.getByTestId('welcome-popup')).toHaveCount(0);

  const option = page.locator('.language-option').first();
  await expect(option).toBeVisible();
  const box = await option.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
});

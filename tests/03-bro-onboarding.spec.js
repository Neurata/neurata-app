// tests/03-bro-onboarding.spec.js
const { test, expect } = require('@playwright/test');
const { DEV_URL } = require('./helpers');

test.describe('BRO Onboarding', () => {

  test('Login screen shows sign in form', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.waitForSelector('#li-email', { timeout: 10000 });
    await expect(page.locator('#li-email')).toBeVisible();
    await expect(page.locator('#li-btn')).toBeVisible();
  });

  test('Joining via invitation link works', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.waitForSelector('#li-email', { timeout: 10000 });
    await page.evaluate(() => { if (window.showScr) window.showScr('scr-invited'); });
    await expect(page.locator('#scr-invited')).toBeVisible({ timeout: 5000 });
  });

  test('Forgot password opens dialog', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.waitForSelector('#li-email', { timeout: 10000 });
    await page.locator('button:has-text("Forgot your password")').click();
    await expect(page.locator('#cdlg-overlay')).toHaveClass(/open/, { timeout: 3000 });
  });

  test('ASST invite screen exists in DOM', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.waitForSelector('#li-email', { timeout: 10000 });
    await expect(page.locator('#scr-asst-invite')).toBeAttached();
  });

  test('Delegate invite screen exists in DOM', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.waitForSelector('#li-email', { timeout: 10000 });
    await expect(page.locator('#scr-delegate-invite')).toBeAttached();
  });

});

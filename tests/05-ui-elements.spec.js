// tests/05-ui-elements.spec.js
const { test, expect } = require('@playwright/test');
const { loginAsSA, DEV_URL } = require('./helpers');

test.describe('UI Elements', () => {

  test('Mobile wall shows on narrow viewport', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await page.goto(DEV_URL);
    await expect(page.locator('#scr-mobile')).toBeVisible({ timeout: 5000 });
    await context.close();
  });

  test('iPad landscape bypasses mobile wall', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const page = await context.newPage();
    await page.goto(DEV_URL);
    await expect(page.locator('#li-email')).toBeVisible({ timeout: 5000 });
    await context.close();
  });

  test('Support bot button is visible after login', async ({ page }) => {
    await loginAsSA(page);
    await expect(page.locator('button[onclick="toggleSupportBot()"]').first()).toBeVisible();
  });

  test('Forgot password link is visible', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.waitForSelector('#li-email', { timeout: 10000 });
    await expect(page.locator('button:has-text("Forgot your password")')).toBeVisible();
  });

  test('SA navigation tabs are Dashboard and Knowledge Base', async ({ page }) => {
    await loginAsSA(page);
    await expect(page.locator('#tab-dashboard')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#tab-admin-kb')).toBeVisible({ timeout: 5000 });
  });

  test('Neurata logo is visible on login screen', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.waitForSelector('#li-email', { timeout: 10000 });
    await expect(page.locator('#scr-login .ob-logo svg')).toBeVisible();
  });

});

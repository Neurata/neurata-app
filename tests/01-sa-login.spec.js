// tests/01-sa-login.spec.js
const { test, expect } = require('@playwright/test');
const { loginAsSA, DEV_URL } = require('./helpers');

test.describe('Super Admin Login', () => {

  test('SA can log in and reach dashboard', async ({ page }) => {
    await loginAsSA(page);
    await expect(page.locator('#super-admin-bar')).toBeVisible();
    await expect(page.locator('text=SUPER ADMIN')).toBeVisible();
  });

  test('Wrong password shows error', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.waitForSelector('#li-email', { timeout: 10000 });
    await page.fill('#li-email', 'jeremy@trickfilm.com');
    await page.fill('#li-pw', 'wrongpassword');
    await page.click('#li-btn');
    await expect(page.locator('#li-err')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#li-err')).toContainText('Incorrect');
  });

  test('Empty email shows validation error', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.waitForSelector('#li-email', { timeout: 10000 });
    await page.fill('#li-pw', 'Test1234!');
    await page.click('#li-btn');
    await expect(page.locator('#li-err')).toBeVisible({ timeout: 3000 });
  });

  test('SA can sign out', async ({ page }) => {
    await loginAsSA(page);
    await page.locator('.u-pill').click();
    await page.locator('.um-it.danger').click();
    await expect(page.locator('#li-email')).toBeVisible({ timeout: 5000 });
  });

});

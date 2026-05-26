// tests/03-bro-onboarding.spec.js
// Note: Cold signups are disabled — scr-onboard is accessed directly via showScr()
const { test, expect } = require('@playwright/test');
const { DEV_URL } = require('./helpers');

test.describe('BRO Onboarding', () => {

  test('Onboarding screen is accessible via showScr', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.waitForSelector('#li-email', { timeout: 10000 });
    await page.evaluate(() => window.showScr('scr-onboard'));
    await expect(page.locator('#scr-onboard')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#ob-lic')).toBeVisible();
  });

  test('BCFSA lookup with dummy licence populates name', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.waitForSelector('#li-email', { timeout: 10000 });
    await page.evaluate(() => window.showScr('scr-onboard'));
    await page.waitForSelector('#ob-lic');
    await page.fill('#ob-lic', 'RE696969');
    await page.locator('#ob-verify-btn').click();
    await page.waitForFunction(
      () => {
        const name = document.getElementById('ob-rep-name');
        const errEl = document.querySelector('#ob-s1 .al.red_');
        return (name && name.textContent.trim() !== '—') || errEl;
      },
      { timeout: 30000 }
    );
    const name = await page.locator('#ob-rep-name').textContent();
    expect(name.trim()).not.toBe('—');
  });

  test('Joining via invitation link works', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.waitForSelector('#li-email', { timeout: 10000 });
    await page.evaluate(() => window.showScr('scr-onboard'));
    await page.waitForSelector('#ob-s1', { timeout: 5000 });
    await page.locator('#ob-s1 button[onclick*="scr-invited"]').click();
    await expect(page.locator('#scr-invited')).toBeVisible({ timeout: 3000 });
  });

  test('Forgot password opens dialog', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.waitForSelector('#li-email', { timeout: 10000 });
    await page.locator('button[onclick*="showForgotPassword"], button:has-text("Forgot your password")').first().click();
    await expect(page.locator('#cdlg-overlay')).toHaveClass(/open/, { timeout: 3000 });
  });

});

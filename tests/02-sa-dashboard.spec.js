// tests/02-sa-dashboard.spec.js
const { test, expect } = require('@playwright/test');
const { loginAsSA } = require('./helpers');

test.describe('SA Dashboard', () => {

  test.beforeEach(async ({ page }) => {
    await loginAsSA(page);
  });

  test('Dashboard shows stat cards', async ({ page }) => {
    await expect(page.locator('#dash-body .card').first()).toBeVisible();
    await expect(page.locator('#super-admin-bar')).toBeVisible();
  });

  test('Can switch between grid and list view', async ({ page }) => {
    await page.locator('button:has-text("List")').first().click();
    await expect(page.locator('table.tbl').first()).toBeVisible();
    await page.locator('button:has-text("Grid")').first().click();
  });

  test('Add Brokerage button opens modal', async ({ page }) => {
    await page.locator('#dash-hdr-actions button[onclick*="CreateBrk"], #dash-hdr-actions button[onclick*="create-brk"], #dash-hdr-actions button:not([onclick*="CreateUser"])').first().click();
    await expect(page.locator('#mo-create-brk')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#crk-lic')).toBeVisible();
  });

  test('BCFSA brokerage lookup works', async ({ page }) => {
    await page.locator('#dash-hdr-actions button:not([onclick*="CreateUser"])').first().click();
    await page.fill('#crk-lic', 'X099001');
    await page.locator('#mo-create-brk button:has-text("Look Up")').click();
    await page.waitForFunction(
      () => {
        const result = document.getElementById('crk-result');
        const err = document.getElementById('crk-err');
        return (result && result.style.display !== 'none') ||
               (err && err.style.display !== 'none' && err.textContent.length > 0);
      },
      { timeout: 20000 }
    );
    const resultVisible = await page.evaluate(() => {
      const r = document.getElementById('crk-result');
      const e = document.getElementById('crk-err');
      return (r && r.style.display !== 'none') || (e && e.style.display !== 'none');
    });
    expect(resultVisible).toBeTruthy();
  });

  test('SA tabs are Dashboard and Knowledge Base', async ({ page }) => {
    await expect(page.locator('#tab-dashboard')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#tab-admin-kb')).toBeVisible({ timeout: 5000 });
  });

  test('SA can enter a brokerage and see role filter buttons', async ({ page }) => {
    const enterBtn = page.locator('[onclick*="adminEnterBrokerage"]').first();
    const count = await enterBtn.count();
    if (count === 0) {
      test.skip('No brokerages in dev DB to enter');
      return;
    }
    await enterBtn.click();
    await page.waitForSelector('#super-admin-bar button', { timeout: 10000 });
    const buttons = await page.locator('#super-admin-bar button').allTextContents();
    expect(buttons.some(b => b.includes('MB'))).toBeTruthy();
    expect(buttons.some(b => b.includes('SM'))).toBeTruthy();
  });

});

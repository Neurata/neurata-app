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
    // Wait for renderDash to populate the header actions
    await page.waitForSelector('#dash-hdr-actions button', { timeout: 10000 });
    await page.locator('button:has-text("Add Brokerage")').click();
    await expect(page.locator('#mo-create-brk')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#crk-lic')).toBeVisible();
  });

  test('BCFSA brokerage lookup works', async ({ page }) => {
    await page.waitForSelector('#dash-hdr-actions button', { timeout: 10000 });
    await page.locator('button:has-text("Add Brokerage")').click();
    await page.waitForSelector('#crk-lic', { timeout: 5000 });
    await page.fill('#crk-lic', 'X099001');
    await page.locator('#mo-create-brk button:has-text("Look Up")').click();
    await page.waitForFunction(() => {
      const r = document.getElementById('crk-result');
      const e = document.getElementById('crk-err');
      return (r && r.style.display !== 'none' && r.textContent.trim().length > 0)
          || (e && e.style.display !== 'none' && e.textContent.trim().length > 0);
    }, { timeout: 30000 });
    const visible = await page.evaluate(() => {
      const r = document.getElementById('crk-result');
      const e = document.getElementById('crk-err');
      return (r && r.style.display !== 'none') || (e && e.style.display !== 'none');
    });
    expect(visible).toBeTruthy();
  });

  test('SA tabs are Dashboard and Knowledge Base', async ({ page }) => {
    await expect(page.locator('#tab-dashboard')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#tab-admin-kb')).toBeVisible({ timeout: 5000 });
  });

  test('SA can enter a brokerage and see role filter buttons', async ({ page }) => {
    await page.waitForSelector('[onclick*="adminEnterBrokerage"]', { timeout: 10000 });
    await page.locator('[onclick*="adminEnterBrokerage"]').first().click();
    await page.waitForSelector('#super-admin-bar button', { timeout: 10000 });
    const buttons = await page.locator('#super-admin-bar button').allTextContents();
    expect(buttons.some(b => b.includes('MB'))).toBeTruthy();
    expect(buttons.some(b => b.includes('SM'))).toBeTruthy();
  });

});

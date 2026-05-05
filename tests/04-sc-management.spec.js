// tests/04-sc-management.spec.js
const { test, expect } = require('@playwright/test');
const { loginAsSA } = require('./helpers');

test.describe('Strata Corporation Management', () => {

  test('SA Knowledge Base tab loads', async ({ page }) => {
    await loginAsSA(page);
    await page.locator('#tab-admin-kb').click();
    await expect(page.locator('#pg-admin-kb')).toBeVisible({ timeout: 5000 });
  });

  test('Add SC modal has required fields', async ({ page }) => {
    await loginAsSA(page);
    // Open modal directly via JS since btn-add-sc is hidden for SA
    await page.evaluate(() => window.openMo('mo-add-sc'));
    await expect(page.locator('#mo-add-sc')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#sc-upload-zone')).toBeVisible();
  });

  test('Manual entry in Add SC modal', async ({ page }) => {
    await loginAsSA(page);
    await page.evaluate(() => window.openMo('mo-add-sc'));
    await expect(page.locator('#mo-add-sc')).toBeVisible({ timeout: 5000 });
    await page.locator('#sc-manual-link button').click();
    await expect(page.locator('#sc-plan')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#sc-lots')).toBeVisible();
    await expect(page.locator('#sc-name')).toBeVisible();
  });

  test('SC validation requires plan number', async ({ page }) => {
    await loginAsSA(page);
    await page.evaluate(() => window.openMo('mo-add-sc'));
    await expect(page.locator('#mo-add-sc')).toBeVisible({ timeout: 5000 });
    await page.locator('#sc-manual-link button').click();
    await page.waitForSelector('#sc-plan');
    await page.fill('#sc-name', 'Test Building');
    await page.fill('#sc-lots', '10');
    await page.evaluate(() => {
      const btn = document.getElementById('sc-create-btn');
      if (btn) { btn.style.display = 'inline-block'; btn.click(); }
    });
    await expect(page.locator('#sc-warn')).toBeVisible({ timeout: 3000 });
  });

});

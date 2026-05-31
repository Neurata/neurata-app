// tests/09-roles-access.spec.js
// Tests for role-based access control:
//   - CD (Council Delegate) view: no nav tabs, goes to meetings, no action buttons
//   - ASST (Assistant) view: Active status, can invite DELs, no Invite Rep button
//   - SA role switcher correctly routes each role

const { test, expect } = require('@playwright/test');
const { loginAsSA, loginAndEnterBrokerage, switchSARole, captureConsoleErrors } = require('./helpers');

test.describe('CD Role — Navigation and Access', () => {

  test.beforeEach(async ({ page }) => {
    await loginAndEnterBrokerage(page);
  });

  test('No JS errors on page load', async ({ page }) => {
    const errors = captureConsoleErrors(page);
    await page.waitForTimeout(2000);
    const fatal = errors.filter(e =>
      e.includes('is not defined') ||
      e.includes('SyntaxError') ||
      e.includes('Illegal return')
    );
    expect(fatal).toHaveLength(0);
  });

  test('CD role switch goes directly to meetings page', async ({ page }) => {
    await switchSARole(page, 'CD');
    // Should land on meetings page, not dashboard or strata list
    await expect(page.locator('#pg-meetings')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#pg-dashboard')).not.toBeVisible();
    await expect(page.locator('#pg-strata')).not.toBeVisible();
  });

  test('CD role has no nav tabs visible', async ({ page }) => {
    await switchSARole(page, 'CD');
    // No tab-strata, no tab-dashboard
    await expect(page.locator('#tab-strata')).not.toBeVisible();
    await expect(page.locator('#tab-dashboard')).not.toBeVisible();
  });

  test('CD sidebar is collapsed for single SC', async ({ page }) => {
    await switchSARole(page, 'CD');
    const sidebar = page.locator('#sidebar');
    // Sidebar should be hidden or empty for single-SC delegate
    const isHidden = await sidebar.evaluate(el =>
      el.innerHTML.trim() === '' || el.classList.contains('hide') || el.style.display === 'none'
    );
    expect(isHidden).toBeTruthy();
  });

  test('CD does not see + New Meeting button', async ({ page }) => {
    await switchSARole(page, 'CD');
    await page.waitForSelector('#pg-meetings', { timeout: 5000 });
    await expect(page.locator('button:has-text("New Meeting")')).not.toBeVisible();
    await expect(page.locator('button:has-text("Create First Meeting")')).not.toBeVisible();
  });

  test('CD does not see Upload Minutes button', async ({ page }) => {
    await switchSARole(page, 'CD');
    await page.waitForSelector('#pg-meetings', { timeout: 5000 });
    // Click Minutes tab
    const minutesTab = page.locator('.mtg-tab:has-text("Minutes")');
    if (await minutesTab.count() > 0) {
      await minutesTab.click();
      await expect(page.locator('button:has-text("Upload Historic Minutes")')).not.toBeVisible();
      await expect(page.locator('button:has-text("Upload Minutes")')).not.toBeVisible();
    }
  });

  test('CD does not see Upload Document button', async ({ page }) => {
    await switchSARole(page, 'CD');
    await page.waitForSelector('#pg-meetings', { timeout: 5000 });
    const docsTab = page.locator('.mtg-tab:has-text("Documents")');
    if (await docsTab.count() > 0) {
      await docsTab.click();
      await expect(page.locator('button:has-text("Upload Document")')).not.toBeVisible();
    }
  });

  test('CD can see StrataSphere tab', async ({ page }) => {
    await switchSARole(page, 'CD');
    await page.waitForSelector('#pg-meetings', { timeout: 5000 });
    await expect(page.locator('.mtg-tab:has-text("StrataSphere")')).toBeVisible();
  });

});

test.describe('ASST Role — Representatives Tab', () => {

  test.beforeEach(async ({ page }) => {
    await loginAndEnterBrokerage(page);
  });

  test('ASST role shows Strata Corps tab in nav', async ({ page }) => {
    await switchSARole(page, 'AS');
    await expect(page.locator('#tab-strata')).toBeVisible({ timeout: 5000 });
  });

  test('ASST Reps tab shows Invite Council Delegate button', async ({ page }) => {
    await switchSARole(page, 'AS');
    await page.locator('#tab-strata').click();
    await page.waitForSelector('#pg-strata', { timeout: 10000 });
    // Click first SC
    await page.locator('[onclick*="openSCDetail"]').first().click();
    await page.waitForSelector('.sc-tabs', { timeout: 5000 });
    await page.locator('.sc-tab:has-text("Representatives")').click();
    await expect(page.locator('button:has-text("Invite Council Delegate")')).toBeVisible({ timeout: 5000 });
  });

  test('ASST Reps tab does NOT show Invite Representative button', async ({ page }) => {
    await switchSARole(page, 'AS');
    await page.locator('#tab-strata').click();
    await page.waitForSelector('[onclick*="openSCDetail"]', { timeout: 10000 });
    await page.locator('[onclick*="openSCDetail"]').first().click();
    await page.waitForSelector('.sc-tabs', { timeout: 8000 });
    await page.locator('.sc-tab:has-text("Representatives")').click();
    await page.waitForTimeout(500);
    await expect(page.locator('button:has-text("Invite Representative")')).not.toBeVisible();
  });

});

test.describe('Role Status Display', () => {

  test.beforeEach(async ({ page }) => {
    await loginAndEnterBrokerage(page);
  });

  test('Reps tab shows correct status badges', async ({ page }) => {
    // MB role — check reps tab
    await page.locator('#tab-strata').click();
    await page.waitForSelector('[onclick*="openSCDetail"]', { timeout: 10000 });
    await page.locator('[onclick*="openSCDetail"]').first().click();
    await page.waitForSelector('.sc-tabs', { timeout: 8000 });
    await page.locator('.sc-tab:has-text("Representatives")').click();
    await page.waitForTimeout(500);
    await page.waitForTimeout(500);

    // Any status badges present should be Active, Inactive, or Invited — not empty
    const badges = page.locator('.tag.grn, .tag.gy, .tag:has-text("Invited")');
    const count = await badges.count();
    if (count > 0) {
      // Verify no badge is completely empty
      for (let i = 0; i < count; i++) {
        const text = await badges.nth(i).textContent();
        expect(['Active', 'Inactive', 'Invited']).toContain(text.trim());
      }
    }
  });

});

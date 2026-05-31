// tests/09-roles-access.spec.js
const { test, expect } = require('@playwright/test');
const { loginAndEnterBrokerage, switchSARole, captureConsoleErrors } = require('./helpers');

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
    await expect(page.locator('#pg-meetings')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#pg-dashboard')).not.toBeVisible();
  });

  test('CD role has no nav tabs visible', async ({ page }) => {
    await switchSARole(page, 'CD');
    await page.waitForSelector('#pg-meetings', { timeout: 8000 });
    await expect(page.locator('#tab-strata')).not.toBeVisible();
    await expect(page.locator('#tab-dashboard')).not.toBeVisible();
  });

  test('CD sidebar shows only SC list or is hidden', async ({ page }) => {
    await switchSARole(page, 'CD');
    await page.waitForSelector('#pg-meetings', { timeout: 8000 });
    // CD sidebar should NOT show Dashboard, Brokerage, or Billing nav items
    const hasBadNav = await page.evaluate(() => {
      const sb = document.getElementById('sb');
      if (!sb) return false;
      const text = sb.textContent || '';
      return text.includes('Dashboard') || text.includes('Brokerage') || text.includes('Billing');
    });
    expect(hasBadNav).toBe(false);
  });

  test('CD does not see + New Meeting button', async ({ page }) => {
    await switchSARole(page, 'CD');
    await page.waitForSelector('#pg-meetings', { timeout: 8000 });
    const newMtgVisible = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => b.textContent.includes('New Meeting') && b.offsetHeight > 0);
    });
    expect(newMtgVisible).toBe(false);
  });

  test('CD does not see Upload Minutes button', async ({ page }) => {
    await switchSARole(page, 'CD');
    await page.waitForSelector('#pg-meetings', { timeout: 8000 });
    const minutesTab = page.locator('.mtg-tab:has-text("Minutes")');
    if (await minutesTab.count() > 0) {
      await minutesTab.click();
      await page.waitForTimeout(300);
    }
    const uploadVisible = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => b.textContent.includes('Upload') && b.textContent.includes('Minutes') && b.offsetHeight > 0);
    });
    expect(uploadVisible).toBe(false);
  });

  test('CD does not see Upload Document button', async ({ page }) => {
    await switchSARole(page, 'CD');
    await page.waitForSelector('#pg-meetings', { timeout: 8000 });
    await page.waitForTimeout(500);
    const uploadVisible = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => (b.textContent||'').trim() === '+ Upload Document' && b.offsetHeight > 0);
    });
    expect(uploadVisible).toBe(false);
  });

  test('CD can see StrataSphere tab', async ({ page }) => {
    await switchSARole(page, 'CD');
    await page.waitForSelector('#pg-meetings', { timeout: 8000 });
    await expect(page.locator('#mtgtab-stratasphere')).toBeVisible({ timeout: 5000 });
  });

});

test.describe('ASST Role — Representatives Tab', () => {

  test.beforeEach(async ({ page }) => {
    await loginAndEnterBrokerage(page);
  });

  test('ASST role shows Strata Corps tab in nav', async ({ page }) => {
    await switchSARole(page, 'AS');
    await page.waitForTimeout(500);
    await expect(page.locator('#tab-strata')).toBeVisible({ timeout: 5000 });
  });

  test('ASST role does not have Representatives tab (by design)', async ({ page }) => {
    await switchSARole(page, 'AS');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const sc = window.APP.sc[0];
      if (sc) { window.showPg('strata'); window.openSCDetail(sc.id); }
    });
    await page.waitForSelector('.sc-tabs', { timeout: 8000 });
    // ASST sees: Overview, Council Members, Strata Lots — NOT Representatives
    const tabs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.sc-tab')).map(t => t.textContent.trim())
    );
    expect(tabs).not.toContain('Representatives');
    expect(tabs).toContain('Overview');
  });

  test('MB Reps tab shows Invite Council Delegate button', async ({ page }) => {
    // MB role can invite delegates — verify button appears on Reps tab
    await page.evaluate(() => {
      const sc = window.APP.sc.find(s => s.isSubscribed) || window.APP.sc[0];
      if (sc) { window.showPg('strata'); window.openSCDetail(sc.id); }
    });
    await page.waitForSelector('.sc-tab:has-text("Representatives")', { timeout: 8000 });
    await page.locator('.sc-tab:has-text("Representatives")').click();
    await page.waitForTimeout(1000);
    const hasInviteDelegate = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => (b.textContent||'').includes('Invite Council Delegate') && b.offsetHeight > 0);
    });
    expect(hasInviteDelegate).toBe(true);
  });

  test('MB Reps tab shows Invite Representative button', async ({ page }) => {
    await page.evaluate(() => {
      const sc = window.APP.sc.find(s => s.isSubscribed) || window.APP.sc[0];
      if (sc) { window.showPg('strata'); window.openSCDetail(sc.id); }
    });
    await page.waitForSelector('.sc-tab:has-text("Representatives")', { timeout: 8000 });
    await page.locator('.sc-tab:has-text("Representatives")').click();
    await page.waitForTimeout(1000);
    const hasInviteRep = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => (b.textContent||'').includes('Invite Representative') && b.offsetHeight > 0);
    });
    expect(hasInviteRep).toBe(true);
  });

});

test.describe('Role Status Display', () => {

  test.beforeEach(async ({ page }) => {
    await loginAndEnterBrokerage(page);
  });

  test('Reps tab renders without errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.evaluate(() => {
      const sc = window.APP.sc.find(s => s.isSubscribed) || window.APP.sc[0];
      if (sc) { window.showPg('strata'); window.openSCDetail(sc.id); }
    });
    await page.waitForSelector('.sc-tab:has-text("Representatives")', { timeout: 8000 });
    await page.locator('.sc-tab:has-text("Representatives")').click();
    await page.waitForTimeout(1000);
    // Reps tab should render — check for no fatal errors
    const fatal = errors.filter(e => e.includes('is not defined') || e.includes('SyntaxError'));
    expect(fatal).toHaveLength(0);
    // Tab content should be visible
    await expect(page.locator('#strata-body')).toBeVisible();
  });

});

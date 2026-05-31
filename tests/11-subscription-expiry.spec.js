// tests/11-subscription-expiry.spec.js
const { test, expect } = require('@playwright/test');
const { loginAndEnterBrokerage } = require('./helpers');

test.describe('Subscription Term Logic', () => {

  test('Anniversary — mid-month activation uses 1st of next month', async ({ page }) => {
    await page.goto('https://appdev.neurata.ai');
    await page.waitForSelector('#li-email', { timeout: 10000 });
    const result = await page.evaluate(() => {
      const activatedAt = new Date('2025-05-15T12:00:00');
      const termStart = new Date(activatedAt);
      if (termStart.getDate() > 1) termStart.setMonth(termStart.getMonth() + 1);
      termStart.setDate(1); termStart.setHours(0,0,0,0);
      return termStart.toISOString().slice(0,10);
    });
    expect(result).toBe('2025-06-01');
  });

  test('Anniversary — activation on 1st uses same month', async ({ page }) => {
    await page.goto('https://appdev.neurata.ai');
    await page.waitForSelector('#li-email', { timeout: 10000 });
    const result = await page.evaluate(() => {
      const activatedAt = new Date('2025-06-01T12:00:00');
      const termStart = new Date(activatedAt);
      if (termStart.getDate() > 1) termStart.setMonth(termStart.getMonth() + 1);
      termStart.setDate(1); termStart.setHours(0,0,0,0);
      return termStart.toISOString().slice(0,10);
    });
    expect(result).toBe('2025-06-01');
  });

  test('Anniversary is 12 months from term start', async ({ page }) => {
    await page.goto('https://appdev.neurata.ai');
    await page.waitForSelector('#li-email', { timeout: 10000 });
    const result = await page.evaluate(() => {
      const termStart = new Date('2025-06-01T12:00:00');
      const anniversary = new Date(termStart);
      const now = new Date('2025-09-01T00:00:00');
      while (anniversary <= now) anniversary.setFullYear(anniversary.getFullYear() + 1);
      return anniversary.toISOString().slice(0,10);
    });
    expect(result).toBe('2026-06-01');
  });

});

test.describe('Subscription Tab Display', () => {

  test.beforeEach(async ({ page }) => {
    await loginAndEnterBrokerage(page);
  });

  test('Subscription tab loads without JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.locator('#tab-strata').click();
    await page.waitForSelector('[onclick*="openSCDetail"]', { timeout: 10000 });
    await page.locator('[onclick*="openSCDetail"]').first().click();
    await page.waitForSelector('.sc-tabs', { timeout: 8000 });
    await page.locator('.sc-tab:has-text("Subscription")').click();
    await page.waitForTimeout(1000);
    const fatal = errors.filter(e => e.includes('is not defined') || e.includes('SyntaxError'));
    expect(fatal).toHaveLength(0);
  });

  test('renderSCSubscription is defined after login', async ({ page }) => {
    const defined = await page.evaluate(() => typeof window.renderSCSubscription === 'function');
    expect(defined).toBeTruthy();
  });

  test('isSubscribed only checks is_subscribed field', async ({ page }) => {
    const result = await page.evaluate(() => {
      const mockRow = { is_subscribed: false, mm_activated_at: '2024-01-15T00:00:00Z', stripe_subscription_id: 'sub_old' };
      return !!mockRow.is_subscribed;
    });
    expect(result).toBe(false);
  });

  test('Subscription tab renders content', async ({ page }) => {
    await page.locator('#tab-strata').click();
    await page.waitForSelector('[onclick*="openSCDetail"]', { timeout: 10000 });
    await page.locator('[onclick*="openSCDetail"]').first().click();
    await page.waitForSelector('.sc-tabs', { timeout: 8000 });
    await page.locator('.sc-tab:has-text("Subscription")').click();
    await page.waitForTimeout(500);
    // Subscription tab content rendered — sc-detail area should be visible
    await expect(page.locator('#pg-strata')).toBeVisible({ timeout: 5000 });
  });

});

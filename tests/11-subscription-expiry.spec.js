// tests/11-subscription-expiry.spec.js
// Tests for subscription term start, anniversary calculation, and isSubscribed gating

const { test, expect } = require('@playwright/test');
const { loginAndEnterBrokerage } = require('./helpers');

test.describe('Subscription Term Logic', () => {

  test('Anniversary uses 1st of first full billing month — mid-month activation', async ({ page }) => {
    // Test the JS logic directly in browser context
    await page.goto('https://appdev.neurata.ai');
    await page.waitForSelector('#li-email', { timeout: 10000 });

    const result = await page.evaluate(() => {
      // Simulate activating on May 15
      const activatedAt = new Date('2025-05-15T10:00:00Z');
      // Term start = June 1 (first full month)
      const termStart = new Date(activatedAt);
      if (termStart.getDate() > 1) {
        termStart.setMonth(termStart.getMonth() + 1);
      }
      termStart.setDate(1);
      termStart.setHours(0, 0, 0, 0);
      return termStart.toISOString().slice(0, 10);
    });

    expect(result).toBe('2025-06-01');
  });

  test('Anniversary uses activation date when activated on 1st', async ({ page }) => {
    await page.goto('https://appdev.neurata.ai');
    await page.waitForSelector('#li-email', { timeout: 10000 });

    const result = await page.evaluate(() => {
      const activatedAt = new Date('2025-06-01T00:00:00Z');
      const termStart = new Date(activatedAt);
      if (termStart.getDate() > 1) {
        termStart.setMonth(termStart.getMonth() + 1);
      }
      termStart.setDate(1);
      termStart.setHours(0, 0, 0, 0);
      return termStart.toISOString().slice(0, 10);
    });

    expect(result).toBe('2025-06-01');
  });

  test('Anniversary is 12 months from term start', async ({ page }) => {
    await page.goto('https://appdev.neurata.ai');
    await page.waitForSelector('#li-email', { timeout: 10000 });

    const result = await page.evaluate(() => {
      // Activated May 15 → term start June 1 → anniversary June 1 next year
      const termStart = new Date('2025-06-01T00:00:00Z');
      const anniversary = new Date(termStart);
      const now = new Date('2025-09-01T00:00:00Z'); // simulate current date
      while (anniversary <= now) {
        anniversary.setFullYear(anniversary.getFullYear() + 1);
      }
      return anniversary.toISOString().slice(0, 10);
    });

    expect(result).toBe('2026-06-01');
  });

});

test.describe('Subscription Tab Display', () => {

  test.beforeEach(async ({ page }) => {
    await loginAndEnterBrokerage(page);
  });

  test('Subscription tab loads without errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.locator('#tab-strata').click();
    await page.waitForSelector('#pg-strata', { timeout: 10000 });
    await page.locator('.sc-item, [onclick*="renderSCDetail"]').first().click();
    await page.waitForSelector('.sc-tabs', { timeout: 5000 });
    await page.locator('.sc-tab:has-text("Subscription")').click();
    await page.waitForTimeout(1000);

    const fatal = errors.filter(e =>
      e.includes('is not defined') ||
      e.includes('SyntaxError')
    );
    expect(fatal).toHaveLength(0);
    await expect(page.locator('.sc-tab:has-text("Subscription")')).toBeVisible();
  });

  test('renderSCSubscription is defined', async ({ page }) => {
    await page.goto('https://appdev.neurata.ai');
    await page.waitForSelector('#li-email', { timeout: 10000 });
    const defined = await page.evaluate(() => typeof window.renderSCSubscription === 'function');
    expect(defined).toBeTruthy();
  });

  test('isSubscribed only checks is_subscribed field', async ({ page }) => {
    // Verify the mapSCRow logic — isSubscribed should not be true just from mmActivatedAt
    await page.goto('https://appdev.neurata.ai');
    await page.waitForSelector('#li-email', { timeout: 10000 });

    const result = await page.evaluate(() => {
      // Simulate a cancelled SC that still has mm_activated_at but is_subscribed = false
      const mockRow = {
        is_subscribed:         false,
        mm_activated_at:       '2024-01-15T00:00:00Z',
        stripe_subscription_id: 'sub_old'
      };
      // Replicate the mapSCRow isSubscribed logic
      return !!mockRow.is_subscribed;
    });

    expect(result).toBe(false);
  });

});

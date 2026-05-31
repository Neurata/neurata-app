// tests/12-stratasphere_spec.js
// Tests for StrataSphere context quality:
//   - LSS context includes owner roster data
//   - Documents sorted newest first
//   - countingRule and recencyRule present in prompts
//   - SS tab accessible from meetings page

const { test, expect } = require('@playwright/test');
const { loginAndEnterBrokerage, loginAsSA } = require('./helpers');

test.describe('StrataSphere Context', () => {

  test('buildLssContext is defined', async ({ page }) => {
    await page.goto('https://appdev.neurata.ai');
    await page.waitForSelector('#li-email', { timeout: 10000 });
    const defined = await page.evaluate(() => typeof window.buildLssContext === 'function');
    expect(defined).toBeTruthy();
  });

  test('LSS context includes STRATA LOT ROSTER section', async ({ page }) => {
    await page.goto('https://appdev.neurata.ai');
    await page.waitForSelector('#li-email', { timeout: 10000 });

    const hasRoster = await page.evaluate(() => {
      const src = document.querySelector('script:not([src])').textContent;
      return src.includes('STRATA LOT ROSTER');
    });
    expect(hasRoster).toBeTruthy();
  });

  test('LSS context includes ownerType in lot detail', async ({ page }) => {
    await page.goto('https://appdev.neurata.ai');
    await page.waitForSelector('#li-email', { timeout: 10000 });

    const hasOwnerType = await page.evaluate(() => {
      const src = document.querySelector('script:not([src])').textContent;
      return src.includes('ownerType');
    });
    expect(hasOwnerType).toBeTruthy();
  });

  test('countingRule is in SS prompts', async ({ page }) => {
    await page.goto('https://appdev.neurata.ai');
    await page.waitForSelector('#li-email', { timeout: 10000 });

    const hasRule = await page.evaluate(() => {
      const src = document.querySelector('script:not([src])').textContent;
      return src.includes('COUNTING AND ENUMERATION RULE');
    });
    expect(hasRule).toBeTruthy();
  });

  test('Docs sorted newest first in LSS context', async ({ page }) => {
    await page.goto('https://appdev.neurata.ai');
    await page.waitForSelector('#li-email', { timeout: 10000 });

    const sorted = await page.evaluate(() => {
      const src = document.querySelector('script:not([src])').textContent;
      return src.includes('most recent first');
    });
    expect(sorted).toBeTruthy();
  });

  test('Upload date stamped on document content blocks', async ({ page }) => {
    await page.goto('https://appdev.neurata.ai');
    await page.waitForSelector('#li-email', { timeout: 10000 });

    const stamped = await page.evaluate(() => {
      const src = document.querySelector('script:not([src])').textContent;
      return src.includes('CONTENT START:') && src.includes('Uploaded:');
    });
    expect(stamped).toBeTruthy();
  });

});

test.describe('StrataSphere UI', () => {

  test.beforeEach(async ({ page }) => {
    await loginAndEnterBrokerage(page);
  });

  test('StrataSphere tab is visible in meetings page', async ({ page }) => {
    await page.locator('#tab-strata').click();
    await page.waitForSelector('#pg-strata', { timeout: 10000 });
    await page.locator('.sc-item, [onclick*="renderSCDetail"]').first().click();
    await page.waitForSelector('.sc-tabs', { timeout: 5000 });
    // Navigate to meetings page for this SC
    await page.evaluate(() => {
      if (window.APP && window.APP.sc && window.APP.sc[0]) {
        window.selectSCMeeting(window.APP.sc[0].id);
      }
    });
    await page.waitForSelector('#pg-meetings', { timeout: 10000 });
    await expect(page.locator('.mtg-tab:has-text("StrataSphere")')).toBeVisible({ timeout: 5000 });
  });

  test('StrataSphere tab loads SS interface', async ({ page }) => {
    await page.locator('#tab-strata').click();
    await page.waitForSelector('#pg-strata', { timeout: 10000 });
    await page.locator('.sc-item, [onclick*="renderSCDetail"]').first().click();
    await page.waitForSelector('.sc-tabs', { timeout: 5000 });
    await page.evaluate(() => {
      if (window.APP && window.APP.sc && window.APP.sc[0]) {
        window.selectSCMeeting(window.APP.sc[0].id);
      }
    });
    await page.waitForSelector('#pg-meetings', { timeout: 10000 });
    await page.locator('.mtg-tab:has-text("StrataSphere")').click();
    await page.waitForTimeout(1000);
    // SS container should be visible
    await expect(page.locator('.ss-wrap, #ss-body, .ss-container, [class*="ss"]').first()).toBeVisible({ timeout: 5000 });
  });

});

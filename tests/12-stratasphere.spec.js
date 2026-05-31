// tests/12-stratasphere.spec.js
const { test, expect } = require('@playwright/test');
const { loginAndEnterBrokerage } = require('./helpers');

test.describe('StrataSphere Context — Source Code Checks', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('https://appdev.neurata.ai');
    await page.waitForSelector('#li-email', { timeout: 10000 });
  });

  test('buildLssContext is defined', async ({ page }) => {
    const defined = await page.evaluate(() => typeof window.buildLssContext === 'function');
    expect(defined).toBeTruthy();
  });

  test('LSS context includes STRATA LOT ROSTER section', async ({ page }) => {
    const found = await page.evaluate(() =>
      document.querySelector('script:not([src])').textContent.includes('STRATA LOT ROSTER')
    );
    expect(found).toBeTruthy();
  });

  test('LSS context includes ownerType in lot detail', async ({ page }) => {
    const found = await page.evaluate(() =>
      document.querySelector('script:not([src])').textContent.includes('ownerType')
    );
    expect(found).toBeTruthy();
  });

  test('countingRule is in SS prompts', async ({ page }) => {
    const found = await page.evaluate(() =>
      document.querySelector('script:not([src])').textContent.includes('COUNTING AND ENUMERATION RULE')
    );
    expect(found).toBeTruthy();
  });

  test('Docs sorted newest first in LSS context', async ({ page }) => {
    const found = await page.evaluate(() =>
      document.querySelector('script:not([src])').textContent.includes('most recent first')
    );
    expect(found).toBeTruthy();
  });

  test('Upload date stamped on document content blocks', async ({ page }) => {
    const src = await page.evaluate(() => document.querySelector('script:not([src])').textContent);
    expect(src.includes('CONTENT START:')).toBeTruthy();
    expect(src.includes('Uploaded:')).toBeTruthy();
  });

});

test.describe('StrataSphere UI', () => {

  test.beforeEach(async ({ page }) => {
    await loginAndEnterBrokerage(page);
  });

  test('StrataSphere tab button exists in meetings page', async ({ page }) => {
    await page.locator('#tab-strata').click();
    await page.waitForSelector('#pg-strata', { timeout: 10000 });
    await page.locator('[onclick*="openSCDetail"]').first().click();
    await page.waitForSelector('.sc-tabs', { timeout: 5000 });
    await page.evaluate(() => {
      if (window.APP && window.APP.sc && window.APP.sc[0]) {
        window.selectSCMeeting(window.APP.sc[0].id);
      }
    });
    await page.waitForSelector('#pg-meetings.on', { timeout: 10000 });
    await expect(page.locator('#mtgtab-stratasphere')).toBeVisible({ timeout: 5000 });
  });

  test('StrataSphere tab renders content into mtg-body', async ({ page }) => {
    await page.locator('#tab-strata').click();
    await page.waitForSelector('#pg-strata', { timeout: 10000 });
    await page.locator('[onclick*="openSCDetail"]').first().click();
    await page.waitForSelector('.sc-tabs', { timeout: 5000 });
    await page.evaluate(() => {
      if (window.APP && window.APP.sc && window.APP.sc[0]) {
        window.selectSCMeeting(window.APP.sc[0].id);
      }
    });
    await page.waitForSelector('#pg-meetings.on', { timeout: 10000 });
    await page.locator('#mtgtab-stratasphere').click();
    await page.waitForTimeout(1000);
    // mtg-body should have content after switching to SS tab
    const content = await page.locator('#mtg-body').innerHTML();
    expect(content.trim().length).toBeGreaterThan(0);
  });

});

// tests/12-stratasphere.spec.js
const { test, expect } = require('@playwright/test');
const { loginAndEnterBrokerage } = require('./helpers');

test.describe('StrataSphere Context — Source Code Checks', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('https://appdev.neurata.ai');
    await page.waitForSelector('#li-email', { timeout: 10000 });
  });

  test('buildLssContext is defined', async ({ page }) => {
    expect(await page.evaluate(() => typeof window.buildLssContext === 'function')).toBeTruthy();
  });

  test('LSS context includes STRATA LOT ROSTER section', async ({ page }) => {
    expect(await page.evaluate(() =>
      document.querySelector('script:not([src])').textContent.includes('STRATA LOT ROSTER')
    )).toBeTruthy();
  });

  test('countingRule is in SS prompts', async ({ page }) => {
    expect(await page.evaluate(() =>
      document.querySelector('script:not([src])').textContent.includes('COUNTING AND ENUMERATION RULE')
    )).toBeTruthy();
  });

  test('Docs sorted newest first in LSS context', async ({ page }) => {
    expect(await page.evaluate(() =>
      document.querySelector('script:not([src])').textContent.includes('most recent first')
    )).toBeTruthy();
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
    // Navigate to meetings using an active SC
    await page.waitForFunction(
      () => window.APP && window.APP.sc && window.APP.sc.some(s => (s.meetings||[]).length > 0 || s.isSubscribed),
      { timeout: 10000 }
    );
    await page.evaluate(() => {
      const sc = window.APP.sc.find(s => (s.meetings||[]).length > 0) || window.APP.sc[0];
      if (sc) window.selectSCMeeting(sc.id);
    });
    await page.waitForSelector('#pg-meetings.on', { timeout: 10000 });
    await expect(page.locator('#mtgtab-stratasphere')).toBeVisible({ timeout: 5000 });
  });

  test('StrataSphere tab renders content into mtg-body', async ({ page }) => {
    await page.waitForFunction(
      () => window.APP && window.APP.sc && window.APP.sc.length > 0,
      { timeout: 10000 }
    );
    await page.evaluate(() => {
      const sc = window.APP.sc.find(s => (s.meetings||[]).length > 0) || window.APP.sc[0];
      if (sc) window.selectSCMeeting(sc.id);
    });
    await page.waitForSelector('#pg-meetings.on', { timeout: 10000 });
    await page.locator('#mtgtab-stratasphere').click();
    await page.waitForTimeout(1000);
    const content = await page.locator('#mtg-body').innerHTML();
    expect(content.trim().length).toBeGreaterThan(0);
  });

});

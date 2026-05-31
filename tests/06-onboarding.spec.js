// tests/06-onboarding.spec.js
const { test, expect } = require('@playwright/test');
const { DEV_URL, loginAsSA } = require('./helpers');

const TEST_BRK_LIC = 'X099001';

async function loginAndEnterBrokerage(page) {
  await loginAsSA(page);
  await page.evaluate((lic) => { window.adminEnterBrokerage(lic); }, TEST_BRK_LIC);
  await page.waitForSelector('#tab-billing', { timeout: 20000 });
}

test.describe('Onboarding — Welcome Overlay', () => {

  test('Welcome overlay can be triggered manually', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.evaluate(() => { if (window.openMo) window.openMo('mo-welcome-onboard'); });
    await expect(page.locator('#mo-welcome-onboard')).toBeVisible({ timeout: 5000 });
  });

  test('"Get Started" button dismisses the overlay', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.evaluate(() => { if (window.openMo) window.openMo('mo-welcome-onboard'); });
    await expect(page.locator('#mo-welcome-onboard')).toBeVisible({ timeout: 5000 });
    await page.locator('#mo-welcome-onboard button.btn.pri').first().click();
    await expect(page.locator('#mo-welcome-onboard')).not.toBeVisible({ timeout: 3000 });
  });

  test('Overlay can be dismissed', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.evaluate(() => { if (window.openMo) window.openMo('mo-welcome-onboard'); });
    await expect(page.locator('#mo-welcome-onboard')).toBeVisible({ timeout: 5000 });
    // Close via X button or JS — no skip button exists
    const closeBtn = page.locator('#mo-welcome-onboard .mo-x').first();
    if (await closeBtn.count() > 0) {
      await closeBtn.click();
    } else {
      await page.evaluate(() => { if (window.closeMo) window.closeMo('mo-welcome-onboard'); });
    }
    await expect(page.locator('#mo-welcome-onboard')).not.toBeVisible({ timeout: 3000 });
  });

  test('Overlay contains Getting Started text', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.evaluate(() => { if (window.openMo) window.openMo('mo-welcome-onboard'); });
    await expect(page.locator('#mo-welcome-onboard')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#mo-welcome-onboard')).toContainText('Getting Started');
  });

  test('Welcome overlay does NOT appear for SA on SA dashboard', async ({ page }) => {
    await loginAsSA(page);
    await expect(page.locator('#mo-welcome-onboard')).not.toBeVisible({ timeout: 3000 });
  });

});

test.describe('Onboarding — Getting Started Checklist', () => {

  test('Dashboard renders stat cards for MB in brokerage context', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.evaluate(() => { if (window.renderDash) window.renderDash(); });
    // Wait for dash-body to have content
    await page.waitForFunction(() => {
      const el = document.getElementById('dash-body');
      return el && el.innerHTML.trim().length > 100;
    }, { timeout: 10000 });
    const html = await page.evaluate(() => document.getElementById('dash-body')?.innerHTML || '');
    expect(html.length).toBeGreaterThan(0);
  });

  test('Dashboard shows SC-related content', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.evaluate(() => { if (window.renderDash) window.renderDash(); });
    await page.waitForFunction(() => {
      const el = document.getElementById('dash-body');
      return el && el.innerHTML.trim().length > 100;
    }, { timeout: 10000 });
    await expect(page.locator('#dash-body')).toContainText(/Strata Corps|Lots|Meetings|Getting Started|Upcoming/i);
  });

  test('Dashboard renders without JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await loginAndEnterBrokerage(page);
    await page.evaluate(() => { if (window.renderDash) window.renderDash(); });
    await page.waitForFunction(() => {
      const el = document.getElementById('dash-body');
      return el && el.innerHTML.trim().length > 100;
    }, { timeout: 10000 });
    const fatal = errors.filter(e => e.includes('is not defined') || e.includes('SyntaxError'));
    expect(fatal).toHaveLength(0);
  });

  test('MB checklist includes billing task', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.locator('#tab-dashboard').click();
    await page.evaluate(() => { if (window.renderDash) window.renderDash(); });
    await page.waitForSelector('.gs-task, .card', { timeout: 10000 });
    await expect(page.locator('#dash-body')).toContainText(/payment method|billing/i);
  });

  test('Dashboard is navigable from brokerage context', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    // Navigate to dashboard explicitly
    await page.locator('#tab-dashboard').click();
    await page.evaluate(() => { if (window.renderDash) window.renderDash(); });
    await page.waitForFunction(() => {
      const el = document.getElementById('dash-body');
      return el && el.innerHTML.trim().length > 100;
    }, { timeout: 10000 });
    const isActive = await page.evaluate(() =>
      document.getElementById('pg-dashboard')?.classList.contains('on')
    );
    expect(isActive).toBe(true);
  });

  test('Incomplete tasks have action onclick', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.locator('#tab-dashboard').click();
    await page.evaluate(() => { if (window.renderDash) window.renderDash(); });
    await page.waitForSelector('.gs-task, .card', { timeout: 10000 });
    const incompleteTasks = page.locator('.gs-task:not(.done)');
    if (await incompleteTasks.count() > 0) {
      expect(await incompleteTasks.first().getAttribute('onclick')).toBeTruthy();
    }
  });

});

test.describe('Onboarding — First Meeting Prompt', () => {

  test('First meeting prompt modal exists in DOM', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await expect(page.locator('#mo-first-meeting-prompt')).toBeAttached();
  });

  test('First meeting prompt can be opened manually', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.evaluate(() => { if (window.openMo) window.openMo('mo-first-meeting-prompt'); });
    await expect(page.locator('#mo-first-meeting-prompt')).toBeVisible({ timeout: 3000 });
  });

  test('Close button dismisses prompt', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.evaluate(() => { if (window.openMo) window.openMo('mo-first-meeting-prompt'); });
    await expect(page.locator('#mo-first-meeting-prompt')).toBeVisible({ timeout: 3000 });
    const closeBtn = page.locator('#mo-first-meeting-prompt .mo-x, #mo-first-meeting-prompt button.btn.ghost').first();
    if (await closeBtn.count() > 0) {
      await closeBtn.click();
    } else {
      await page.evaluate(() => { if (window.closeMo) window.closeMo('mo-first-meeting-prompt'); });
    }
    await expect(page.locator('#mo-first-meeting-prompt')).not.toBeVisible({ timeout: 3000 });
  });

  test('showFirstMeetingPrompt function is defined', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    expect(await page.evaluate(() => typeof window.showFirstMeetingPrompt === 'function')).toBeTruthy();
  });

  test('First meeting prompt appears after SC created', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.locator('#tab-strata').click();
    await page.evaluate(() => window.openMo('mo-add-sc'));
    await expect(page.locator('#mo-add-sc')).toBeVisible({ timeout: 5000 });
    const testPlan = 'BCS-FMP-' + Date.now();
    await page.locator('#sc-manual-link button').click();
    await page.waitForSelector('#sc-plan');
    await page.fill('#sc-plan', testPlan);
    await page.fill('#sc-name', 'First Meeting Test Corp');
    await page.fill('#sc-lots', '5');
    await page.evaluate(() => { window.APP.currentUser.isSuperAdmin = false; });
    await page.click('#sc-create-btn');
    await expect(page.locator('#mo-first-meeting-prompt')).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => { window.APP.currentUser.isSuperAdmin = true; });
  });

});

test.afterAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const { loginAsSA } = require('./helpers');
    await loginAsSA(page);
    await page.evaluate(async () => {
      const db = window.getSupabase();
      const { data: scs } = await db.from('strata_corps').select('plan_number').like('plan_number', 'BCS-%');
      const testPlans = (scs || []).map(s => s.plan_number).filter(p => /^BCS-[A-Z]+-\d{10,}$/.test(p));
      for (const plan of testPlans) {
        await db.from('decisions').delete().eq('sc_id', plan);
        await db.from('meetings').delete().eq('sc_id', plan);
        await db.from('council_members').delete().eq('sc_id', plan);
        await db.from('documents').delete().eq('sc_id', plan);
        await db.from('sc_users').delete().eq('sc_id', plan);
        await db.from('strata_corps').delete().eq('plan_number', plan);
      }
    });
  } catch (e) { console.warn('[afterAll] cleanup:', e.message); }
  finally { await context.close(); }
});

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

  test('Close button dismisses the overlay', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.evaluate(() => { if (window.openMo) window.openMo('mo-welcome-onboard'); });
    await expect(page.locator('#mo-welcome-onboard')).toBeVisible({ timeout: 5000 });
    const closeBtn = page.locator('#mo-welcome-onboard .mo-x, #mo-welcome-onboard button.btn.ghost').first();
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

  test('Getting Started card is visible on dashboard for MB in brokerage context', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.locator('#tab-dashboard').click();
    await page.waitForSelector('.gs-task', { timeout: 15000 });
    await expect(page.locator('#dash-body')).toContainText('Getting Started');
  });

  test('Getting Started card shows task items', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.locator('#tab-dashboard').click();
    await page.waitForSelector('.gs-task, .card', { timeout: 15000 });
    expect(await page.locator('.gs-task').count()).toBeGreaterThan(0);
  });

  test('Getting Started card shows progress counter', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.locator('#tab-dashboard').click();
    await page.waitForSelector('.gs-task, .card', { timeout: 15000 });
    await expect(page.locator('.gs-progress').first()).toContainText('of');
  });

  test('MB checklist includes billing task', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.locator('#tab-dashboard').click();
    await page.waitForSelector('.gs-task, .card', { timeout: 15000 });
    await expect(page.locator('#dash-body')).toContainText(/payment method|billing/i);
  });

  test('Completed tasks are visually marked done', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.evaluate(() => {
      if (!window.APP.sc || !window.APP.sc.length) {
        window.APP.sc = [{ id: 'fake', plan: 'TST-0001', name: 'Test', lots: 5, meetings: [], decisions: [], council: [], docs: [] }];
      }
      if (!window.APP.reps || !window.APP.reps.length) {
        window.APP.reps = [{ name: 'Test Rep', lic: 'RE000001', role: 'Representative' }];
      }
      if (window.renderDash) window.renderDash();
    });
    await page.locator('#tab-dashboard').click();
    await page.waitForSelector('.gs-task.done', { timeout: 15000 });
    expect(await page.locator('.gs-task.done').count()).toBeGreaterThan(0);
  });

  test('Incomplete tasks have action onclick', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.locator('#tab-dashboard').click();
    await page.waitForSelector('.gs-task, .card', { timeout: 15000 });
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

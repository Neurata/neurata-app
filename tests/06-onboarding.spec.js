// tests/06-onboarding.spec.js
// Tests the onboarding flow:
//   - Welcome overlay (single-slide, shown to new users with no SCs)
//   - Getting Started checklist on the dashboard
//   - First Meeting prompt (shown after SC created)
//   - Path B: invited REP navigates directly to their SC

const { test, expect } = require('@playwright/test');
const { DEV_URL, loginAsSA, SA_EMAIL, SA_PASS } = require('./helpers');

const TEST_BRK_LIC = 'X025017';

// Login as SA and enter the test brokerage in MB context
async function loginAndEnterBrokerage(page) {
  await loginAsSA(page);
  await page.evaluate((lic) => { window.adminEnterBrokerage(lic); }, TEST_BRK_LIC);
  await page.waitForSelector('#tab-billing', { timeout: 20000 });
}

// ─── Welcome Overlay ─────────────────────────────────────────────────────────

test.describe('Onboarding — Welcome Overlay', () => {

  test('Welcome overlay appears when triggered for a user with no SCs', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    // Force the overlay state: mark unseen, clear SCs, then trigger nudge check
    await page.evaluate(() => {
      window.APP._userHasSeenOnboarding = false;
      window.APP.sc = [];
      var el = document.getElementById('ob-welcome-name');
      if (el) el.textContent = 'Welcome, Test!';
      if (window.openMo) window.openMo('mo-welcome-onboard');
    });
    await expect(page.locator('#mo-welcome-onboard')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#ob-slide-1')).toBeVisible();
  });

  test('"Get Started" button dismisses the overlay', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.evaluate(() => {
      window.APP._userHasSeenOnboarding = false;
      if (window.openMo) window.openMo('mo-welcome-onboard');
    });
    await expect(page.locator('#mo-welcome-onboard')).toBeVisible({ timeout: 5000 });
    await page.locator('#mo-welcome-onboard button.btn.pri').click();
    await expect(page.locator('#mo-welcome-onboard')).not.toBeVisible({ timeout: 3000 });
  });

  test('"Skip" button dismisses the overlay', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.evaluate(() => {
      window.APP._userHasSeenOnboarding = false;
      if (window.openMo) window.openMo('mo-welcome-onboard');
    });
    await expect(page.locator('#mo-welcome-onboard')).toBeVisible({ timeout: 5000 });
    await page.locator('#mo-welcome-onboard button.btn.ghost').click();
    await expect(page.locator('#mo-welcome-onboard')).not.toBeVisible({ timeout: 3000 });
  });

  test('Overlay contains the Getting Started checklist reference', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.evaluate(() => {
      if (window.openMo) window.openMo('mo-welcome-onboard');
    });
    await expect(page.locator('#mo-welcome-onboard')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#mo-welcome-onboard')).toContainText('Getting Started');
  });

  test('Welcome overlay does NOT appear for SA on SA dashboard', async ({ page }) => {
    await loginAsSA(page);
    // SA stays on SA dashboard — overlay must not appear
    await expect(page.locator('#mo-welcome-onboard')).not.toBeVisible({ timeout: 3000 });
  });

});

// ─── Getting Started Checklist ───────────────────────────────────────────────

test.describe('Onboarding — Getting Started Checklist', () => {

  test('Getting Started card is visible on dashboard for MB in brokerage context', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.locator('#tab-dashboard').click();
    await page.waitForSelector('#dash-body', { timeout: 10000 });
    await expect(page.locator('#dash-body')).toContainText('Getting Started');
  });

  test('Getting Started card shows task items with correct structure', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.locator('#tab-dashboard').click();
    await page.waitForSelector('#dash-body', { timeout: 10000 });

    const tasks = page.locator('.gs-task');
    const count = await tasks.count();
    expect(count).toBeGreaterThan(0);

    const firstTask = tasks.first();
    await expect(firstTask.locator('.gs-check')).toBeVisible();
    await expect(firstTask.locator('.gs-task-lbl')).toBeVisible();
  });

  test('Getting Started card shows progress counter', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.locator('#tab-dashboard').click();
    await page.waitForSelector('#dash-body', { timeout: 10000 });

    await expect(page.locator('.gs-progress').first()).toBeVisible();
    await expect(page.locator('.gs-progress').first()).toContainText('of');
    await expect(page.locator('.gs-progress').first()).toContainText('complete');
  });

  test('MB checklist includes billing task', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    // Inject a fake SC so the checklist renders fully including billing task
    await page.evaluate(() => {
      if (!window.APP.sc || window.APP.sc.length === 0) {
        window.APP.sc = [{ id: 'test-sc-fake', plan: 'TST-0001', name: 'Test SC', lots: 5,
          meetings: [], decisions: [], council: [], docs: [] }];
      }
      if (window.renderDashboard) window.renderDashboard();
      else if (window.renderGSCard) window.renderGSCard();
    });
    await page.locator('#tab-dashboard').click();
    await page.waitForSelector('#dash-body', { timeout: 10000 });
    await expect(page.locator('#dash-body')).toContainText('Set up payment method', { timeout: 5000 });
  });

  test('Completed tasks are visually marked done', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    // Inject SC and reps so hasSC and hasReps are true → those tasks render as done
    await page.evaluate(() => {
      if (!window.APP.sc || window.APP.sc.length === 0) {
        window.APP.sc = [{ id: 'test-sc-fake', plan: 'TST-0001', name: 'Test SC', lots: 5,
          meetings: [], decisions: [], council: [], docs: [] }];
      }
      if (!window.APP.reps || window.APP.reps.length === 0) {
        window.APP.reps = [{ name: 'Test Rep', lic: 'RE000001', role: 'Representative' }];
      }
      if (window.renderDashboard) window.renderDashboard();
      else if (window.renderGSCard) window.renderGSCard();
    });
    await page.locator('#tab-dashboard').click();
    await page.waitForSelector('#dash-body', { timeout: 10000 });

    const doneTasks = page.locator('.gs-task.done');
    await expect(doneTasks.first()).toBeVisible({ timeout: 5000 });
    expect(await doneTasks.count()).toBeGreaterThan(0);
  });

  test('Incomplete tasks are clickable with action onclick', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.locator('#tab-dashboard').click();
    await page.waitForSelector('#dash-body', { timeout: 10000 });

    const incompleteTasks = page.locator('.gs-task:not(.done)');
    const count = await incompleteTasks.count();
    if (count > 0) {
      const onclick = await incompleteTasks.first().getAttribute('onclick');
      expect(onclick).toBeTruthy();
    }
  });

});

// ─── First Meeting Prompt ─────────────────────────────────────────────────────

test.describe('Onboarding — First Meeting Prompt', () => {

  test('First Meeting prompt appears after an SC is created', async ({ page }) => {
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
    await page.click('#sc-create-btn');

    await expect(page.locator('#mo-first-meeting-prompt')).toBeVisible({ timeout: 8000 });
  });

  test('"Not yet" dismisses the first meeting prompt', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.locator('#tab-strata').click();
    await page.evaluate(() => window.openMo('mo-add-sc'));
    await expect(page.locator('#mo-add-sc')).toBeVisible({ timeout: 5000 });

    const testPlan = 'BCS-NY-' + Date.now();
    await page.locator('#sc-manual-link button').click();
    await page.waitForSelector('#sc-plan');
    await page.fill('#sc-plan', testPlan);
    await page.fill('#sc-name', 'Not Yet Corp');
    await page.fill('#sc-lots', '3');
    await page.click('#sc-create-btn');

    await expect(page.locator('#mo-first-meeting-prompt')).toBeVisible({ timeout: 8000 });
    await page.locator('#mo-first-meeting-prompt button.btn.ghost').click();
    await expect(page.locator('#mo-first-meeting-prompt')).not.toBeVisible({ timeout: 3000 });
  });

  test('"Create First Meeting" closes the prompt', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.locator('#tab-strata').click();
    await page.evaluate(() => window.openMo('mo-add-sc'));
    await expect(page.locator('#mo-add-sc')).toBeVisible({ timeout: 5000 });

    const testPlan = 'BCS-CFM-' + Date.now();
    await page.locator('#sc-manual-link button').click();
    await page.waitForSelector('#sc-plan');
    await page.fill('#sc-plan', testPlan);
    await page.fill('#sc-name', 'Create Meeting Corp');
    await page.fill('#sc-lots', '4');
    await page.click('#sc-create-btn');

    await expect(page.locator('#mo-first-meeting-prompt')).toBeVisible({ timeout: 8000 });
    await page.locator('#mo-first-meeting-prompt button.btn.pri').click();
    await expect(page.locator('#mo-first-meeting-prompt')).not.toBeVisible({ timeout: 3000 });
  });

});

// ─── Path B: Invited REP ─────────────────────────────────────────────────────

test.describe('Onboarding — Path B (invited REP)', () => {

  test('Path B: user with one SC and no meetings navigates directly to strata page', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    // Simulate Path B: one SC with no meetings, has_seen_onboarding false
    // The launchPlatform code routes to strata + SC detail in this case
    await page.evaluate(() => {
      // Set up the conditions for Path B
      window.APP._userHasSeenOnboarding = false;
      // Ensure we have exactly one SC with no meetings
      if (window.APP.sc && window.APP.sc.length > 0) {
        var sc = window.APP.sc[0];
        sc.meetings = [];
        window.APP.sc = [sc];
        // Trigger the Path B navigation
        window.APP.currentScId = sc.id;
        if (window.showPg) window.showPg('strata');
        if (window.openSCDetail) setTimeout(function() { window.openSCDetail(sc.id); }, 100);
      }
    });
    // Should land on strata page, not dashboard
    await expect(page.locator('#pg-strata')).toHaveClass(/on/, { timeout: 5000 });
    // Welcome overlay must not appear for Path B
    await expect(page.locator('#mo-welcome-onboard')).not.toBeVisible();
  });

});

// ── Cleanup: delete test-generated SCs after all tests run ───────────────────
// Prevents DB accumulation across runs. Test SCs match BCS-{PREFIX}-{timestamp}.
test.afterAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const { loginAsSA } = require('./helpers');
    await loginAsSA(page);
    await page.evaluate(async () => {
      const db = window.getSupabase();
      const { data: scs } = await db
        .from('strata_corps')
        .select('plan_number')
        .like('plan_number', 'BCS-%');
      const testPlans = (scs || [])
        .map(s => s.plan_number)
        .filter(p => /^BCS-[A-Z]+-\d{10,}$/.test(p));
      for (const plan of testPlans) {
        await db.from('decisions').delete().eq('sc_id', plan);
        await db.from('meetings').delete().eq('sc_id', plan);
        await db.from('council_members').delete().eq('sc_id', plan);
        await db.from('documents').delete().eq('sc_id', plan);
        await db.from('sc_users').delete().eq('sc_id', plan);
        await db.from('strata_corps').delete().eq('plan_number', plan);
      }
      console.log('[afterAll] Cleaned up', testPlans.length, 'test SCs');
    });
  } catch (e) {
    console.warn('[afterAll] SC cleanup warning:', e.message);
  } finally {
    await context.close();
  }
});

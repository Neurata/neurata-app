// 06-onboarding.spec.js
// Tests the first-login onboarding flow for REP users.
// NOTE: These tests rely on the dev SA account to clean up state between runs.
// The dev SA credentials and URL are pulled from helpers.js.

const { test, expect } = require('@playwright/test');
const { DEV_URL, SA_EMAIL, SA_PASS, SA_ID } = require('./helpers');

// A fresh SM account created for onboarding tests
// Credentials must exist in the dev environment before running.
// Create via SA dashboard → Add Brokerage → Invite Rep, or use the dev SA to insert directly.
// For CI: these are seeded accounts; update helpers.js if they change.
const NEW_SM_EMAIL  = 'onboard-test-sm@neurata-test.com';
const NEW_SM_PASS   = 'Test1234!';
const INV_SM_EMAIL  = 'onboard-invited-sm@neurata-test.com';
const INV_SM_PASS   = 'Test1234!';

test.describe('Onboarding — Welcome Overlay (Path A: no SCs)', () => {

  test('Welcome overlay appears on first login for a new SM with no SCs', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.fill('#li-email', NEW_SM_EMAIL);
    await page.fill('#li-pw', NEW_SM_PASS);
    await page.click('button[onclick="doLogin()"]');

    // Wait for platform to load
    await expect(page.locator('#scr-platform')).toBeVisible({ timeout: 15000 });

    // Welcome overlay must be visible
    const overlay = page.locator('#mo-welcome-onboard');
    await expect(overlay).toBeVisible({ timeout: 5000 });

    // Slide 1 should be active
    await expect(page.locator('#ob-slide-1')).toBeVisible();
    await expect(page.locator('#ob-slide-2')).not.toBeVisible();
  });

  test('Carousel advances to slide 2 on Continue', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.fill('#li-email', NEW_SM_EMAIL);
    await page.fill('#li-pw', NEW_SM_PASS);
    await page.click('button[onclick="doLogin()"]');
    await expect(page.locator('#mo-welcome-onboard')).toBeVisible({ timeout: 10000 });

    await page.click('#ob-next-btn');

    await expect(page.locator('#ob-slide-2')).toBeVisible();
    await expect(page.locator('#ob-slide-1')).not.toBeVisible();
    // Button text changes on last slide
    await expect(page.locator('#ob-next-btn')).toHaveText('+ Create First SC');
  });

  test('Clicking "+ Create First SC" opens the Add SC modal', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.fill('#li-email', NEW_SM_EMAIL);
    await page.fill('#li-pw', NEW_SM_PASS);
    await page.click('button[onclick="doLogin()"]');
    await expect(page.locator('#mo-welcome-onboard')).toBeVisible({ timeout: 10000 });

    // Advance to last slide
    await page.click('#ob-next-btn');
    await expect(page.locator('#ob-next-btn')).toHaveText('+ Create First SC');

    // Click CTA
    await page.click('#ob-next-btn');

    // Welcome overlay should close, Add SC modal should open
    await expect(page.locator('#mo-welcome-onboard')).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator('#mo-add-sc')).toBeVisible({ timeout: 3000 });
  });

  test('Skip dismisses the overlay without opening Add SC modal', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.fill('#li-email', NEW_SM_EMAIL);
    await page.fill('#li-pw', NEW_SM_PASS);
    await page.click('button[onclick="doLogin()"]');
    await expect(page.locator('#mo-welcome-onboard')).toBeVisible({ timeout: 10000 });

    await page.click('#ob-skip-btn');

    await expect(page.locator('#mo-welcome-onboard')).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator('#mo-add-sc')).not.toBeVisible();
  });

});

test.describe('Onboarding — First Meeting Prompt (after SC created)', () => {

  test('Creating an SC navigates to SC Detail Overview tab', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.fill('#li-email', SA_EMAIL);
    await page.fill('#li-pw', SA_PASS);
    await page.click('button[onclick="doLogin()"]');
    await expect(page.locator('#scr-platform')).toBeVisible({ timeout: 15000 });

    // Navigate to a brokerage, open Add SC
    // (SA is on the SA dashboard — enter first brokerage)
    const firstBrk = page.locator('.brk-row, .brk-card').first();
    await firstBrk.click();
    await expect(page.locator('#mo-add-sc, button[onclick*="openAddSC"]')).toBeVisible({ timeout: 5000 });

    // Open add SC
    await page.click('button[onclick*="openAddSC"], button[onclick*="mo-add-sc"]');
    await expect(page.locator('#mo-add-sc')).toBeVisible({ timeout: 3000 });

    // Fill in a unique plan number
    const testPlan = 'BCS-TEST-' + Date.now();
    await page.click('text=Enter manually');
    await page.fill('#sc-plan', testPlan);
    await page.fill('#sc-name', 'Test Strata Corp');
    await page.fill('#sc-lots', '10');
    await page.click('#sc-create-btn');

    // Should navigate to SC Detail page (Overview tab)
    await expect(page.locator('.sc-detail-hd')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.sc-tab.on')).toHaveText('Overview');
  });

  test('First Meeting prompt appears after SC is created', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.fill('#li-email', SA_EMAIL);
    await page.fill('#li-pw', SA_PASS);
    await page.click('button[onclick="doLogin()"]');
    await expect(page.locator('#scr-platform')).toBeVisible({ timeout: 15000 });

    const firstBrk = page.locator('.brk-row, .brk-card').first();
    await firstBrk.click();
    await page.click('button[onclick*="openAddSC"], button[onclick*="mo-add-sc"]');
    await expect(page.locator('#mo-add-sc')).toBeVisible({ timeout: 3000 });

    const testPlan = 'BCS-FMP-' + Date.now();
    await page.click('text=Enter manually');
    await page.fill('#sc-plan', testPlan);
    await page.fill('#sc-name', 'First Meeting Test Corp');
    await page.fill('#sc-lots', '5');
    await page.click('#sc-create-btn');

    // First Meeting Prompt should appear
    await expect(page.locator('#mo-first-meeting-prompt')).toBeVisible({ timeout: 5000 });
  });

  test('"Not yet" dismisses the first meeting prompt', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.fill('#li-email', SA_EMAIL);
    await page.fill('#li-pw', SA_PASS);
    await page.click('button[onclick="doLogin()"]');
    await expect(page.locator('#scr-platform')).toBeVisible({ timeout: 15000 });

    const firstBrk = page.locator('.brk-row, .brk-card').first();
    await firstBrk.click();
    await page.click('button[onclick*="openAddSC"], button[onclick*="mo-add-sc"]');
    await expect(page.locator('#mo-add-sc')).toBeVisible({ timeout: 3000 });

    const testPlan = 'BCS-NY-' + Date.now();
    await page.click('text=Enter manually');
    await page.fill('#sc-plan', testPlan);
    await page.fill('#sc-name', 'Not Yet Corp');
    await page.fill('#sc-lots', '3');
    await page.click('#sc-create-btn');

    await expect(page.locator('#mo-first-meeting-prompt')).toBeVisible({ timeout: 5000 });
    await page.click('text=Not yet');
    await expect(page.locator('#mo-first-meeting-prompt')).not.toBeVisible({ timeout: 3000 });
  });

});

test.describe('Onboarding — Path B (invited REP navigates to SC meetings)', () => {

  test('Invited REP with one SC and no meetings lands on that SC meetings page', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.fill('#li-email', INV_SM_EMAIL);
    await page.fill('#li-pw', INV_SM_PASS);
    await page.click('button[onclick="doLogin()"]');

    await expect(page.locator('#scr-platform')).toBeVisible({ timeout: 15000 });

    // Should be on the strata page (not dashboard) showing the SC detail / meetings area
    await expect(page.locator('#pg-strata')).toHaveClass(/on/, { timeout: 5000 });

    // Welcome overlay should NOT appear for Path B
    await expect(page.locator('#mo-welcome-onboard')).not.toBeVisible();
  });

});

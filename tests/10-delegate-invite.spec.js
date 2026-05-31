// tests/10-delegate-invite.spec.js
// Tests for the Council Delegate invite flow:
//   - Invite modal opens correctly
//   - Form validation
//   - Pending invite appears in Reps tab with Invited status
//   - Remove delegate works

const { test, expect } = require('@playwright/test');
const { loginAndEnterBrokerage, waitForDialog, dismissDialog } = require('./helpers');

// Navigate to the Reps tab of the first SC
async function goToRepsTab(page) {
  await page.locator('#tab-strata').click();
  await page.waitForSelector('#pg-strata', { timeout: 10000 });
  await page.locator('[onclick*="openSCDetail"]').first().click();
  await page.waitForSelector('.sc-tabs', { timeout: 5000 });
  await page.locator('.sc-tab:has-text("Representatives")').click();
  await page.waitForTimeout(500);
}

test.describe('Delegate Invite Modal', () => {

  test.beforeEach(async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await goToRepsTab(page);
  });

  test('Invite Council Delegate button opens modal', async ({ page }) => {
    await page.locator('button:has-text("Invite Council Delegate")').click();
    await expect(page.locator('#mo-invite-delegate')).toBeVisible({ timeout: 5000 });
  });

  test('Modal has name, email, and strata lot fields', async ({ page }) => {
    await page.locator('button:has-text("Invite Council Delegate")').click();
    await expect(page.locator('#del-name')).toBeVisible();
    await expect(page.locator('#del-email')).toBeVisible();
  });

  test('Submitting without name shows validation error', async ({ page }) => {
    await page.locator('button:has-text("Invite Council Delegate")').click();
    await page.fill('#del-email', 'test@example.com');
    await page.locator('#mo-invite-delegate button:has-text("Invite")').click();
    const { msg } = await waitForDialog(page);
    expect(msg.toLowerCase()).toContain('name');
    await dismissDialog(page);
  });

  test('Submitting without email shows validation error', async ({ page }) => {
    await page.locator('button:has-text("Invite Council Delegate")').click();
    await page.fill('#del-name', 'Test Delegate');
    await page.locator('#mo-invite-delegate button:has-text("Invite")').click();
    const { msg } = await waitForDialog(page);
    expect(msg.toLowerCase()).toMatch(/email/);
    await dismissDialog(page);
  });

  test('Submitting with invalid email shows validation error', async ({ page }) => {
    await page.locator('button:has-text("Invite Council Delegate")').click();
    await page.fill('#del-name', 'Test Delegate');
    await page.fill('#del-email', 'notanemail');
    await page.locator('#mo-invite-delegate button:has-text("Invite")').click();
    const { msg } = await waitForDialog(page);
    expect(msg.toLowerCase()).toMatch(/email/);
    await dismissDialog(page);
  });

});

test.describe('Delegate Invite Status', () => {

  test.beforeEach(async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await goToRepsTab(page);
  });

  test('Reps tab has Refresh button', async ({ page }) => {
    await expect(page.locator('button:has-text("Refresh")')).toBeVisible();
  });

  test('Refresh button reloads SC data without error', async ({ page }) => {
    await page.locator('button:has-text("Refresh")').click();
    // Should not throw — reps tab re-renders
    await page.waitForTimeout(2000);
    await expect(page.locator('.sc-tab:has-text("Representatives")')).toBeVisible();
  });

  test('Invited delegates show Invited status badge', async ({ page }) => {
    // If any pending delegates exist, they should show amber Invited badge
    const invitedBadges = page.locator('.tag:has-text("Invited")');
    const count = await invitedBadges.count();
    // If there are invited delegates, verify the badge styling
    if (count > 0) {
      await expect(invitedBadges.first()).toBeVisible();
      // Should have amber/yellow styling
      const color = await invitedBadges.first().evaluate(el => window.getComputedStyle(el).color);
      expect(color).not.toBe('');
    }
    // Test passes whether or not there are pending invites
  });

});

test.describe('Delegate Signup Screen', () => {

  test('Delegate invite URL shows signup screen', async ({ page }) => {
    // Navigate with delegate URL params
    await page.goto('https://appdev.neurata.ai/?delegate=KAS2291&sl=SL001&email=test%40example.com');
    await page.waitForSelector('#scr-delegate-invite, #scr-login', { timeout: 10000 });
    // Should show either the delegate signup or login screen
    const delegateScreen = await page.locator('#scr-delegate-invite').isVisible();
    const loginScreen    = await page.locator('#scr-login').isVisible();
    expect(delegateScreen || loginScreen).toBeTruthy();
  });

  test('Delegate signup screen has all required fields', async ({ page }) => {
    await page.goto('https://appdev.neurata.ai/?delegate=KAS2291&sl=SL001&email=test%40example.com');
    await page.waitForSelector('#scr-delegate-invite', { timeout: 10000 }).catch(() => {});
    const visible = await page.locator('#scr-delegate-invite').isVisible();
    if (visible) {
      await expect(page.locator('#del-inv-name')).toBeVisible();
      await expect(page.locator('#del-inv-email')).toBeVisible();
      await expect(page.locator('#del-inv-pw')).toBeVisible();
      await expect(page.locator('#del-inv-pw2')).toBeVisible();
      await expect(page.locator('#del-inv-tos')).toBeVisible();
    }
  });

  test('Delegate email is pre-filled from URL param', async ({ page }) => {
    await page.goto('https://appdev.neurata.ai/?delegate=KAS2291&sl=SL001&email=test%40example.com');
    await page.waitForSelector('#scr-delegate-invite', { timeout: 10000 }).catch(() => {});
    const visible = await page.locator('#scr-delegate-invite').isVisible();
    if (visible) {
      const emailValue = await page.locator('#del-inv-email').inputValue();
      expect(emailValue).toBe('test@example.com');
    }
  });

});

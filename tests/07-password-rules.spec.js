// tests/07-password-rules.spec.js
const { test, expect } = require('@playwright/test');
const { DEV_URL } = require('./helpers');

test.describe('Password Rules — Invite Acceptance (scr-invited)', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(DEV_URL);
    await page.waitForSelector('#li-email', { timeout: 10000 });
    await page.evaluate(() => { if (window.showScr) window.showScr('scr-invited'); });
    // Wait for the screen to actually be visible and interactive
    await page.waitForSelector('#inv-create-btn', { state: 'visible', timeout: 5000 });
  });

  test('Create Account button is disabled by default', async ({ page }) => {
    await expect(page.locator('#inv-create-btn')).toBeDisabled();
  });

  test('Password rules checklist is visible', async ({ page }) => {
    await expect(page.locator('#inv-rule-len')).toBeVisible();
    await expect(page.locator('#inv-rule-cap')).toBeVisible();
    await expect(page.locator('#inv-rule-num')).toBeVisible();
    await expect(page.locator('#inv-rule-spec')).toBeVisible();
  });

  test('Short password shows length rule as incomplete', async ({ page }) => {
    await page.fill('#inv-pw', 'abc');
    await page.dispatchEvent('#inv-pw', 'input');
    await expect(page.locator('#inv-rule-len')).not.toHaveClass(/ok/);
  });

  test('Strong password passes all rules', async ({ page }) => {
    await page.fill('#inv-pw', 'Neurata1!');
    await page.dispatchEvent('#inv-pw', 'input');
    await expect(page.locator('#inv-rule-len')).toHaveClass(/ok/);
    await expect(page.locator('#inv-rule-cap')).toHaveClass(/ok/);
    await expect(page.locator('#inv-rule-num')).toHaveClass(/ok/);
    await expect(page.locator('#inv-rule-spec')).toHaveClass(/ok/);
  });

  test('Confirm password match indicator shows correctly', async ({ page }) => {
    await page.fill('#inv-pw',  'Neurata1!');
    await page.fill('#inv-pw2', 'Neurata1!');
    await page.dispatchEvent('#inv-pw2', 'input');
    await expect(page.locator('#inv-pw2-match')).toContainText('match');
  });

  test('Create Account disabled with weak password', async ({ page }) => {
    await page.fill('#inv-lic',   '123456');
    await page.fill('#inv-email', 'test@test.com');
    await page.fill('#inv-pw',    'weakpass');
    await page.fill('#inv-pw2',   'weakpass');
    await page.evaluate(() => { if (window.invCheckBtn) window.invCheckBtn(); });
    // Button should still be disabled — weak password has no uppercase, number, or special char
    const disabled = await page.locator('#inv-create-btn').isDisabled();
    expect(disabled).toBe(true);
  });

  test('Create Account enabled with strong matching password', async ({ page }) => {
    await page.fill('#inv-lic',   '123456');
    await page.fill('#inv-email', 'test@brokerage.ca');
    await page.fill('#inv-pw',    'Neurata1!');
    await page.fill('#inv-pw2',   'Neurata1!');
    await page.evaluate(() => { if (window.invCheckBtn) window.invCheckBtn(); });
    await expect(page.locator('#inv-create-btn')).toBeEnabled();
  });

});

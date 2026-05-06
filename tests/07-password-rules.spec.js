// 07-password-rules.spec.js
// Tests password strength rules on both the self-signup (scr-onboard)
// and invite acceptance (scr-invited) forms.

const { test, expect } = require('@playwright/test');
const { DEV_URL } = require('./helpers');

test.describe('Password Rules — Self-Signup (scr-onboard)', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(DEV_URL);
    await page.click('button[onclick="showScr(\'scr-onboard\')"]');
    await expect(page.locator('#scr-onboard')).toBeVisible();
    // Fill a dummy lic and click verify to get to step 1
    // We only need to reach the password field on step 3, so navigate there directly
    // by checking the password field is visible after steps
  });

  test('Short password shows length rule as incomplete', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.click('button[onclick="showScr(\'scr-onboard\')"]');
    // Navigate to step 3 via obGoStep (simulate directly for speed)
    await page.evaluate(() => { document.getElementById('ob-s3').classList.add('on'); });
    await page.fill('#ob-pw', 'abc');
    await expect(page.locator('#rule-len')).not.toHaveClass(/ok/);
  });

  test('Password with 8+ chars, uppercase, number, special passes all rules', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.click('button[onclick="showScr(\'scr-onboard\')"]');
    await page.evaluate(() => { document.getElementById('ob-s3').classList.add('on'); });
    const pw = 'Neurata1!';
    await page.fill('#ob-pw', pw);
    await expect(page.locator('#rule-len')).toHaveClass(/ok/);
    await expect(page.locator('#rule-cap')).toHaveClass(/ok/);
    await expect(page.locator('#rule-num')).toHaveClass(/ok/);
    await expect(page.locator('#rule-spec')).toHaveClass(/ok/);
  });

  test('Next button disabled until passwords match', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.click('button[onclick="showScr(\'scr-onboard\')"]');
    await page.evaluate(() => { document.getElementById('ob-s3').classList.add('on'); });
    await page.fill('#ob-pw', 'Neurata1!');
    await page.fill('#ob-pw2', 'Neurata1');
    await expect(page.locator('#ob-s3-next')).toBeDisabled();
    await page.fill('#ob-pw2', 'Neurata1!');
    await expect(page.locator('#ob-s3-next')).toBeEnabled();
  });

  test('Mismatched passwords shows error on submit attempt', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.click('button[onclick="showScr(\'scr-onboard\')"]');
    await page.evaluate(() => { document.getElementById('ob-s3').classList.add('on'); });
    await page.fill('#ob-pw', 'Neurata1!');
    await page.fill('#ob-pw2', 'Different1!');
    // Try to force submit
    await page.evaluate(() => { obStep3Next(); });
    // Should show an alert or stay on step 3
    await expect(page.locator('#ob-s3')).toBeVisible();
  });

});

test.describe('Password Rules — Invite Acceptance (scr-invited)', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(DEV_URL);
    await page.click('button[onclick="showScr(\'scr-invited\')"]');
    await expect(page.locator('#scr-invited')).toBeVisible();
  });

  test('Create Account button disabled with weak password', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.click('button[onclick="showScr(\'scr-invited\')"]');
    await page.fill('#inv-lic', '123456');
    await page.fill('#inv-email', 'test@test.com');
    await page.fill('#inv-pw', 'weakpass');  // no uppercase, number, or special
    await page.fill('#inv-pw2', 'weakpass');
    await expect(page.locator('#inv-create-btn')).toBeDisabled();
  });

  test('Password rules checklist visible on invite form', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.click('button[onclick="showScr(\'scr-invited\')"]');
    await expect(page.locator('#inv-rule-len')).toBeVisible();
    await expect(page.locator('#inv-rule-cap')).toBeVisible();
    await expect(page.locator('#inv-rule-num')).toBeVisible();
    await expect(page.locator('#inv-rule-spec')).toBeVisible();
  });

  test('Strong password passes all invite form rules', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.click('button[onclick="showScr(\'scr-invited\')"]');
    await page.fill('#inv-pw', 'Neurata1!');
    await page.dispatchEvent('#inv-pw', 'input');
    await expect(page.locator('#inv-rule-len')).toHaveClass(/ok/);
    await expect(page.locator('#inv-rule-cap')).toHaveClass(/ok/);
    await expect(page.locator('#inv-rule-num')).toHaveClass(/ok/);
    await expect(page.locator('#inv-rule-spec')).toHaveClass(/ok/);
  });

  test('Confirm password match indicator shows correctly', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.click('button[onclick="showScr(\'scr-invited\')"]');
    await page.fill('#inv-pw', 'Neurata1!');
    await page.fill('#inv-pw2', 'Neurata1!');
    await page.dispatchEvent('#inv-pw2', 'input');
    await expect(page.locator('#inv-pw2-match')).toContainText('match');
  });

  test('Create Account enabled only with strong matching password and valid lic+email', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.click('button[onclick="showScr(\'scr-invited\')"]');
    await page.fill('#inv-lic', '123456');
    await page.fill('#inv-email', 'test@brokerage.ca');
    await page.fill('#inv-pw', 'Neurata1!');
    await page.fill('#inv-pw2', 'Neurata1!');
    await page.dispatchEvent('#inv-pw2', 'input');
    await expect(page.locator('#inv-create-btn')).toBeEnabled();
  });

});

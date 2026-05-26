// 07-password-rules.spec.js
// Tests password strength rules on both the self-signup (scr-onboard)
// and invite acceptance (scr-invited) forms.

const { test, expect } = require('@playwright/test');
const { DEV_URL } = require('./helpers');

test.describe('Password Rules — Self-Signup (scr-onboard)', () => {

  test('Short password shows length rule as incomplete', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.waitForSelector('#li-email', { timeout: 10000 });
    await page.evaluate(() => {
      window.showScr('scr-onboard');
      document.getElementById('ob-s3').classList.add('on');
    });
    await page.fill('#ob-pw', 'abc');
    await page.dispatchEvent('#ob-pw', 'input');
    await expect(page.locator('#rule-len')).not.toHaveClass(/ok/);
  });

  test('Password with 8+ chars, uppercase, number, special passes all rules', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.waitForSelector('#li-email', { timeout: 10000 });
    await page.evaluate(() => {
      window.showScr('scr-onboard');
      document.getElementById('ob-s3').classList.add('on');
    });
    await page.fill('#ob-pw', 'Neurata1!');
    await page.dispatchEvent('#ob-pw', 'input');
    await expect(page.locator('#rule-len')).toHaveClass(/ok/);
    await expect(page.locator('#rule-cap')).toHaveClass(/ok/);
    await expect(page.locator('#rule-num')).toHaveClass(/ok/);
    await expect(page.locator('#rule-spec')).toHaveClass(/ok/);
  });

  test('Next button disabled until passwords match', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.waitForSelector('#li-email', { timeout: 10000 });
    await page.evaluate(() => {
      window.showScr('scr-onboard');
      document.getElementById('ob-s3').classList.add('on');
    });
    await page.fill('#ob-pw', 'Neurata1!');
    await page.dispatchEvent('#ob-pw', 'input');
    await page.fill('#ob-pw2', 'Neurata1');
    await page.dispatchEvent('#ob-pw2', 'input');
    await expect(page.locator('#ob-s3-next')).toBeDisabled();
    await page.fill('#ob-pw2', 'Neurata1!');
    await page.dispatchEvent('#ob-pw2', 'input');
    await expect(page.locator('#ob-s3-next')).toBeEnabled();
  });

  test('Mismatched passwords shows error on submit attempt', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.waitForSelector('#li-email', { timeout: 10000 });
    await page.evaluate(() => {
      window.showScr('scr-onboard');
      document.getElementById('ob-s3').classList.add('on');
    });
    await page.fill('#ob-pw', 'Neurata1!');
    await page.dispatchEvent('#ob-pw', 'input');
    await page.fill('#ob-pw2', 'Different1!');
    await page.dispatchEvent('#ob-pw2', 'input');
    await page.evaluate(() => { if (window.obStep3Next) obStep3Next(); });
    await expect(page.locator('#ob-s3')).toBeVisible();
  });

});

test.describe('Password Rules — Invite Acceptance (scr-invited)', () => {

  async function goToInvited(page) {
    await page.goto(DEV_URL);
    await page.waitForSelector('#li-email', { timeout: 10000 });
    await page.evaluate(() => window.showScr('scr-invited'));
    await expect(page.locator('#scr-invited')).toBeVisible({ timeout: 5000 });
  }

  test('Create Account button disabled with weak password', async ({ page }) => {
    await goToInvited(page);
    await page.fill('#inv-lic', '123456');
    await page.fill('#inv-email', 'test@test.com');
    await page.fill('#inv-pw', 'weakpass');
    await page.dispatchEvent('#inv-pw', 'input');
    await page.fill('#inv-pw2', 'weakpass');
    await page.dispatchEvent('#inv-pw2', 'input');
    await expect(page.locator('#inv-create-btn')).toBeDisabled();
  });

  test('Password rules checklist visible on invite form', async ({ page }) => {
    await goToInvited(page);
    await expect(page.locator('#inv-rule-len')).toBeVisible();
    await expect(page.locator('#inv-rule-cap')).toBeVisible();
    await expect(page.locator('#inv-rule-num')).toBeVisible();
    await expect(page.locator('#inv-rule-spec')).toBeVisible();
  });

  test('Strong password passes all invite form rules', async ({ page }) => {
    await goToInvited(page);
    await page.fill('#inv-pw', 'Neurata1!');
    await page.dispatchEvent('#inv-pw', 'input');
    await expect(page.locator('#inv-rule-len')).toHaveClass(/ok/);
    await expect(page.locator('#inv-rule-cap')).toHaveClass(/ok/);
    await expect(page.locator('#inv-rule-num')).toHaveClass(/ok/);
    await expect(page.locator('#inv-rule-spec')).toHaveClass(/ok/);
  });

  test('Confirm password match indicator shows correctly', async ({ page }) => {
    await goToInvited(page);
    await page.fill('#inv-pw', 'Neurata1!');
    await page.fill('#inv-pw2', 'Neurata1!');
    await page.dispatchEvent('#inv-pw2', 'input');
    await expect(page.locator('#inv-pw2-match')).toContainText('match');
  });

  test('Create Account enabled only with strong matching password and valid lic+email', async ({ page }) => {
    await goToInvited(page);
    await page.fill('#inv-lic', '123456');
    await page.fill('#inv-email', 'test@brokerage.ca');
    await page.fill('#inv-pw', 'Neurata1!');
    await page.fill('#inv-pw2', 'Neurata1!');
    await page.dispatchEvent('#inv-pw2', 'input');
    await expect(page.locator('#inv-create-btn')).toBeEnabled();
  });

});

test.describe('Password Rules — Reset Password Modal (pw-reset-overlay)', () => {

  async function triggerResetModal(page) {
    const { loginAsSA } = require('./helpers');
    await loginAsSA(page);
    await page.evaluate(() => window.showNewPasswordPrompt());
    await expect(page.locator('#pw-reset-overlay')).toBeVisible({ timeout: 5000 });
  }

  test('Reset modal appears with two password fields and rules checklist', async ({ page }) => {
    await triggerResetModal(page);
    await expect(page.locator('#pwr-pw1')).toBeVisible();
    await expect(page.locator('#pwr-pw2')).toBeVisible();
    await expect(page.locator('#pwr-r-len')).toBeVisible();
    await expect(page.locator('#pwr-r-up')).toBeVisible();
    await expect(page.locator('#pwr-r-num')).toBeVisible();
    await expect(page.locator('#pwr-r-sym')).toBeVisible();
    await expect(page.locator('#pwr-r-mat')).toBeVisible();
  });

  test('Save button disabled until all rules pass', async ({ page }) => {
    await triggerResetModal(page);
    await expect(page.locator('#pwr-btn')).toBeDisabled();
    await page.fill('#pwr-pw1', 'Neurata1!');
    await page.fill('#pwr-pw2', 'Neurata1!');
    await page.dispatchEvent('#pwr-pw1', 'input');
    await page.dispatchEvent('#pwr-pw2', 'input');
    await expect(page.locator('#pwr-btn')).toBeEnabled();
  });

  test('Weak password keeps save button disabled', async ({ page }) => {
    await triggerResetModal(page);
    await page.fill('#pwr-pw1', 'weakpass');
    await page.fill('#pwr-pw2', 'weakpass');
    await page.dispatchEvent('#pwr-pw1', 'input');
    await page.dispatchEvent('#pwr-pw2', 'input');
    await expect(page.locator('#pwr-btn')).toBeDisabled();
  });

  test('Mismatched passwords keeps save button disabled', async ({ page }) => {
    await triggerResetModal(page);
    await page.fill('#pwr-pw1', 'Neurata1!');
    await page.fill('#pwr-pw2', 'Neurata2!');
    await page.dispatchEvent('#pwr-pw1', 'input');
    await page.dispatchEvent('#pwr-pw2', 'input');
    await expect(page.locator('#pwr-btn')).toBeDisabled();
  });

  test('Rules turn green when conditions are met', async ({ page }) => {
    await triggerResetModal(page);
    await page.fill('#pwr-pw1', 'Neurata1!');
    await page.fill('#pwr-pw2', 'Neurata1!');
    await page.dispatchEvent('#pwr-pw1', 'input');
    await page.dispatchEvent('#pwr-pw2', 'input');
    const lenColor = await page.locator('#pwr-r-len').evaluate(el => el.style.color);
    expect(lenColor).toBe('rgb(22, 163, 74)'); // #16A34A
  });

});

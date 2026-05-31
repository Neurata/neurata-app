// tests/07-password-rules.spec.js
const { test, expect } = require('@playwright/test');
const { DEV_URL } = require('./helpers');

test.describe('Password Rules — Invite Acceptance (scr-invited)', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(DEV_URL);
    await page.waitForSelector('#li-email', { timeout: 10000 });
    await page.evaluate(() => {
      if (window.showScr) window.showScr('scr-invited');
      // Force visible in case CSS is blocking
      const el = document.getElementById('scr-invited');
      if (el) { el.style.display = 'flex'; el.classList.add('on'); }
    });
    await page.waitForSelector('#inv-lic', { state: 'visible', timeout: 5000 });
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
    // Set field values directly via JS and call invCheckBtn
    const disabled = await page.evaluate(() => {
      document.getElementById('inv-lic').value   = '123456';
      document.getElementById('inv-email').value = 'test@test.com';
      document.getElementById('inv-pw').value    = 'weakpass';
      document.getElementById('inv-pw2').value   = 'weakpass';
      if (window.invCheckBtn) window.invCheckBtn();
      return document.getElementById('inv-create-btn').disabled;
    });
    expect(disabled).toBe(true);
  });

  test('Create Account enabled with strong matching password', async ({ page }) => {
    const disabled = await page.evaluate(() => {
      document.getElementById('inv-lic').value   = '123456';
      document.getElementById('inv-email').value = 'test@brokerage.ca';
      document.getElementById('inv-pw').value    = 'Neurata1!';
      document.getElementById('inv-pw2').value   = 'Neurata1!';
      if (window.invCheckBtn) window.invCheckBtn();
      return document.getElementById('inv-create-btn').disabled;
    });
    expect(disabled).toBe(false);
  });

});

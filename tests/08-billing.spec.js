// tests/08-billing.spec.js
const { test, expect } = require('@playwright/test');
const { DEV_URL, loginAsSA } = require('./helpers');

const WORKER_URL   = 'https://api-dev.neurata.ai';
const TEST_BRK_LIC = 'X099001';

async function loginAndEnterBrokerage(page) {
  await loginAsSA(page);
  await page.evaluate((lic) => { window.adminEnterBrokerage(lic); }, TEST_BRK_LIC);
  await page.waitForSelector('#tab-billing', { timeout: 20000 });
}

async function goToBilling(page) {
  await page.locator('#tab-billing').click();
  await page.waitForSelector('#billing-body', { timeout: 10000 });
}

async function waitForDialog(page) {
  await page.waitForSelector('#cdlg-overlay.open', { timeout: 8000 });
  const title = await page.locator('#cdlg-title').textContent();
  const msg   = await page.locator('#cdlg-msg').textContent();
  return { title: title.trim(), msg: msg.trim() };
}

async function dismissDialog(page) {
  await page.waitForSelector('#cdlg-overlay.open', { timeout: 5000 });
  await page.locator('#cdlg-ft button').last().click();
  await page.waitForSelector('#cdlg-overlay.open', { state: 'detached', timeout: 5000 }).catch(() => {});
}

async function mockBrokerage(page, overrides = {}) {
  await page.evaluate((o) => {
    window.APP = window.APP || {};
    window.APP.brokerage = Object.assign({
      lic: 'X099001', name: 'Test Brokerage Inc.',
      addr: '123 Test St, Vancouver BC', phone: '604-555-0100',
      billingSetup: false, stripeCustomerId: null,
      payMethod: 'acss', paymentMethodId: null
    }, o);
    if (window.renderBilling) window.renderBilling();
  }, overrides);
  await page.waitForFunction(
    () => { const el = document.getElementById('billing-body'); return el && el.offsetHeight > 0; },
    { timeout: 8000 }
  );
}

test.describe('Billing — Payment Method Setup', () => {

  test('Billing page shows payment setup form for unconfigured brokerage', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await goToBilling(page);
    await mockBrokerage(page, { billingSetup: false, stripeCustomerId: null });
    await expect(page.locator('#billing-body')).toContainText('Set up a payment method');
    await expect(page.locator('#pay-tab-acss')).toBeVisible();
    await expect(page.locator('#pay-tab-card')).toBeVisible();
    await expect(page.locator('#bill-email').first()).toBeVisible();
  });

  test('ACSS tab shows bank account fields and hides card form', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await goToBilling(page);
    await mockBrokerage(page, { billingSetup: false, stripeCustomerId: null, payMethod: 'acss' });
    await page.locator('#pay-tab-acss').click();
    await expect(page.locator('#pay-form-acss')).toBeVisible();
    await expect(page.locator('#acss-inst')).toBeVisible();
    await expect(page.locator('#pay-form-card')).not.toBeVisible();
  });

  test('Card tab shows Stripe element and hides ACSS form', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await goToBilling(page);
    await mockBrokerage(page, { billingSetup: false, stripeCustomerId: null, payMethod: 'acss' });
    await page.locator('#pay-tab-card').click();
    await expect(page.locator('#pay-form-card')).toBeVisible();
    await expect(page.locator('#stripe-card-element')).toBeVisible();
    await expect(page.locator('#pay-form-acss')).not.toBeVisible();
  });

});

test.describe('Billing — Form Validation', () => {

  test('billingSubmit blocks when billing email is empty', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await goToBilling(page);
    await mockBrokerage(page, { billingSetup: false, stripeCustomerId: null, payMethod: 'acss' });
    await page.locator('#acss-name').fill('John Smith');
    await page.locator('[onclick="billingSubmit()"]').click();
    const { msg } = await waitForDialog(page);
    expect(msg).toContain('billing email');
    await dismissDialog(page);
  });

  test('billingSubmit blocks when account holder name is empty', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await goToBilling(page);
    await mockBrokerage(page, { billingSetup: false, stripeCustomerId: null, payMethod: 'acss' });
    await page.locator('#bill-email').first().fill('billing@testbrokerage.com');
    await page.locator('[onclick="billingSubmit()"]').click();
    const { msg } = await waitForDialog(page);
    expect(msg).toContain('account holder name');
    await dismissDialog(page);
  });

  test('billingSubmit blocks when ACSS bank fields are incomplete', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await goToBilling(page);
    await mockBrokerage(page, { billingSetup: false, stripeCustomerId: null, payMethod: 'acss' });
    await page.route('**/stripe/create-customer', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ customerId: 'cus_test_mock' })
    }));
    await page.route('**/stripe/setup-intent', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ clientSecret: 'seti_test_secret_mock' })
    }));
    await page.locator('#bill-email').first().fill('billing@testbrokerage.com');
    await page.locator('#acss-name').fill('John Smith');
    await page.locator('[onclick="billingSubmit()"]').click();
    const { msg } = await waitForDialog(page);
    expect(msg).toMatch(/bank account|institution|transit|complete all/i);
    await dismissDialog(page);
  });

});

test.describe('Billing — ACSS Return URL & Pending State', () => {

  test('?billing_setup=complete lands on billing page', async ({ page }) => {
    await loginAsSA(page);
    await page.goto(DEV_URL + '/?billing_setup=complete');
    await page.waitForSelector('#scr-platform', { state: 'visible', timeout: 20000 });
    await expect(page.locator('#pg-billing')).toBeVisible({ timeout: 5000 });
    expect(page.url()).not.toContain('billing_setup');
  });

  test('ACSS pending banner shows when customer exists but not confirmed', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await goToBilling(page);
    await mockBrokerage(page, { billingSetup: false, stripeCustomerId: 'cus_test_pending', payMethod: 'acss' });
    await expect(page.locator('#billing-body')).toContainText('Bank Account Verification Pending');
  });

});

test.describe('Billing — Activation Gate', () => {

  test('Activating SC without billing shows billing-required prompt', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await goToBilling(page);
    await mockBrokerage(page, { billingSetup: false, stripeCustomerId: null });
    await page.evaluate(() => {
      if (window.APP && window.APP.sc && window.APP.sc.length > 0) {
        if (window.activateSCMeetingMode) window.activateSCMeetingMode(window.APP.sc[0].id);
      }
    });
    const { title, msg } = await waitForDialog(page);
    expect(title + msg).toMatch(/billing|payment method/i);
    await dismissDialog(page);
  });

});

test.describe('Billing — Account Statements', () => {
  test.skip('Account Statements renders invoice list', async () => {});
  test.skip('Account Statements shows empty state', async () => {});
});

test.describe('Worker — /stripe/schedule-downgrade', () => {

  test('Returns 400 when subscriptionId is missing', async ({ request }) => {
    const resp = await request.post(WORKER_URL + '/stripe/schedule-downgrade', {
      headers: { 'Content-Type': 'application/json' },
      data: { newTier: 'local', scPlan: 'EPS1234' }
    });
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.error).toMatch(/Missing/i);
  });

  test('Returns 400 when newTier is missing', async ({ request }) => {
    const resp = await request.post(WORKER_URL + '/stripe/schedule-downgrade', {
      headers: { 'Content-Type': 'application/json' },
      data: { subscriptionId: 'sub_test_mock', scPlan: 'EPS1234' }
    });
    expect(resp.status()).toBe(400);
  });

  test('Route exists and does not return 404', async ({ request }) => {
    const resp = await request.post(WORKER_URL + '/stripe/schedule-downgrade', {
      headers: { 'Content-Type': 'application/json' },
      data: { subscriptionId: 'sub_test_mock', newTier: 'local', scPlan: 'EPS1234', brkLic: 'X099001' }
    });
    expect(resp.status()).not.toBe(404);
  });

});

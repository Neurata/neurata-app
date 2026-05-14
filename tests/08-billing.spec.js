// tests/08-billing.spec.js
// Billing flow tests — covers:
//   - Payment method setup form (ACSS + card)
//   - Form validation errors
//   - ?billing_setup=complete return URL handler
//   - ACSS pending verification banner
//   - Activation gate (no billing → prompt)
//   - Account Statements card (invoice list + empty state)
//   - /stripe/schedule-downgrade worker route (validation + routing)

const { test, expect } = require('@playwright/test');
const { DEV_URL, loginAsSA } = require('./helpers');

const WORKER_URL   = 'https://api-dev.neurata.ai';
const TEST_BRK_LIC = 'X025017';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Login as SA, enter the test brokerage, wait for MB context (billing tab present)
async function loginAndEnterBrokerage(page) {
  await loginAsSA(page);
  await page.evaluate((lic) => { window.adminEnterBrokerage(lic); }, TEST_BRK_LIC);
  await page.waitForSelector('#tab-billing', { timeout: 20000 });
}

// Navigate to billing page
async function goToBilling(page) {
  await page.locator('#tab-billing').click();
  await page.waitForSelector('#billing-body', { timeout: 10000 });
}

// Wait for nAlert/nConfirm dialog and return title + message
async function waitForDialog(page) {
  await page.waitForSelector('#cdlg-overlay.open', { timeout: 8000 });
  const title = await page.locator('#cdlg-title').textContent();
  const msg   = await page.locator('#cdlg-msg').textContent();
  return { title: title.trim(), msg: msg.trim() };
}

// Dismiss the open dialog
async function dismissDialog(page) {
  await page.waitForSelector('#cdlg-overlay.open', { timeout: 5000 });
  await page.locator('#cdlg-ft button').last().click();
  await page.waitForSelector('#cdlg-overlay.open', { state: 'detached', timeout: 5000 }).catch(() => {});
}

// Inject mock APP.brokerage state and re-render billing.
// Must be called AFTER goToBilling() so #billing-body is already visible.
// Register any page.route() mocks BEFORE calling this.
async function mockBrokerage(page, overrides = {}) {
  await page.evaluate((o) => {
    window.APP.brokerage = Object.assign(window.APP.brokerage || {}, {
      billingSetup:     false,
      stripeCustomerId: null,
      payMethod:        'acss',
      paymentMethodId:  null
    }, o);
    if (window.renderBilling) window.renderBilling();
  }, overrides);
  // billing-body is already visible — just wait for re-render to settle
  await page.waitForTimeout(300);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Billing — Payment Method Setup', () => {

  test('Billing page shows payment setup form for unconfigured brokerage', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await goToBilling(page);
    await mockBrokerage(page, { billingSetup: false, stripeCustomerId: null });

    await expect(page.locator('#billing-body')).toContainText('Set up a payment method');
    await expect(page.locator('#pay-tab-acss')).toBeVisible();
    await expect(page.locator('#pay-tab-card')).toBeVisible();
    // #bill-email exists in both ACSS and card forms — scope to the ACSS form
    await expect(page.locator('#pay-form-acss #bill-email')).toBeVisible();
  });

  test('ACSS tab shows bank account fields and hides card form', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await goToBilling(page);
    await mockBrokerage(page, { billingSetup: false, stripeCustomerId: null, payMethod: 'acss' });

    await page.locator('#pay-tab-acss').click();
    await expect(page.locator('#pay-form-acss')).toBeVisible();
    await expect(page.locator('#acss-inst')).toBeVisible();
    await expect(page.locator('#acss-transit')).toBeVisible();
    await expect(page.locator('#acss-acct')).toBeVisible();
    await expect(page.locator('#pay-form-card')).not.toBeVisible();
  });

  test('Card tab shows Stripe card element and hides ACSS form', async ({ page }) => {
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

    await page.locator('#pay-form-acss #bill-email').fill('billing@testbrokerage.com');
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

    await page.locator('#pay-form-acss #bill-email').fill('billing@testbrokerage.com');
    await page.locator('#acss-name').fill('John Smith');
    await page.locator('[onclick="billingSubmit()"]').click();

    const { msg } = await waitForDialog(page);
    expect(msg).toMatch(/bank account|institution|transit|complete all/i);
    await dismissDialog(page);
  });

});

test.describe('Billing — ACSS Return URL & Pending State', () => {

  test('?billing_setup=complete navigates to Billing page and shows confirmation modal', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await page.goto(DEV_URL + '/?billing_setup=complete');
    await page.waitForSelector('#scr-platform', { state: 'visible', timeout: 20000 });

    await expect(page.locator('#pg-billing')).toBeVisible({ timeout: 5000 });

    const { title, msg } = await waitForDialog(page);
    expect(title).toContain('Bank Account Submitted');
    expect(msg).toContain('microdeposits');
    await dismissDialog(page);

    expect(page.url()).not.toContain('billing_setup');
  });

  test('ACSS pending banner shows when customer exists but billing not yet confirmed', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await goToBilling(page);
    await mockBrokerage(page, {
      billingSetup:     false,
      stripeCustomerId: 'cus_test_pending',
      payMethod:        'acss'
    });

    await expect(page.locator('#billing-body')).toContainText('Bank Account Verification Pending');
    await expect(page.locator('#billing-body')).toContainText('microdeposits');
  });

});

test.describe('Billing — Activation Gate', () => {

  test('Activating SC without billing set up shows billing-required prompt', async ({ page }) => {
    await loginAndEnterBrokerage(page);

    // Inject brokerage state directly — no goToBilling/mockBrokerage needed here
    // since we're not testing the billing page, just the activation function
    await page.evaluate(() => {
      window.APP.brokerage = Object.assign(window.APP.brokerage || {}, {
        billingSetup:     false,
        stripeCustomerId: null
      });
      // Use a real SC if available, otherwise inject a minimal mock
      if (!window.APP.sc || window.APP.sc.length === 0) {
        window.APP.sc = [{ id: 'mock-sc-001', plan: 'EPS9999', lots: 10,
                           mmActive: false, stripeSubscriptionId: null }];
      }
      var scId = window.APP.sc[0].id;
      if (window.activateSCMeetingMode) window.activateSCMeetingMode(scId);
    });

    const { title, msg } = await waitForDialog(page);
    expect(title + msg).toMatch(/billing|payment method/i);
    await dismissDialog(page);
  });

});

test.describe('Billing — Account Statements', () => {

  test('Account Statements section renders with period dropdown', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await goToBilling(page);

    // The statements section should always render with a period dropdown
    await expect(page.locator('#billing-body')).toContainText('Account Statements');
    await expect(page.locator('#statements-range')).toBeVisible();
  });

  test('Account Statements fetch resolves after period selected (empty or populated)', async ({ page }) => {
    await loginAndEnterBrokerage(page);
    await goToBilling(page);

    await page.waitForSelector('#statements-range', { timeout: 5000 });
    await page.selectOption('#statements-range', 'all');

    // After selecting a period the loading spinner resolves to either
    // a results table or the empty state — either is a successful fetch.
    await expect(page.locator('#billing-body')).not.toContainText('Loading…', { timeout: 8000 });
    await expect(page.locator('#billing-body')).toContainText(
      /Amount Paid|No statements found/,
      { timeout: 8000 }
    );
  });

  test('Account Statements shows empty state when Stripe returns no invoices', async ({ page }) => {
    await loginAndEnterBrokerage(page);

    // Mock the invoices endpoint to return empty before navigating to billing
    await page.route('**/stripe/invoices*', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ invoices: [] })
    }));

    await goToBilling(page);
    await page.waitForSelector('#statements-range', { timeout: 5000 });
    await page.selectOption('#statements-range', 'all');

    await expect(page.locator('#billing-body')).toContainText('No statements found', { timeout: 8000 });
  });

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
    const body = await resp.json();
    expect(body.error).toMatch(/Missing/i);
  });

  test('Route exists and does not return 404', async ({ request }) => {
    const resp = await request.post(WORKER_URL + '/stripe/schedule-downgrade', {
      headers: { 'Content-Type': 'application/json' },
      data: { subscriptionId: 'sub_test_mock', newTier: 'local', scPlan: 'EPS1234', brkLic: TEST_BRK_LIC }
    });
    expect(resp.status()).not.toBe(404);
    const body = await resp.json();
    expect(body).not.toMatchObject({ error: expect.stringMatching(/not found|no route/i) });
  });

});

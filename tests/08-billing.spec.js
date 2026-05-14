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

const WORKER_URL = 'https://api-dev.neurata.ai';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Navigate to billing page (MB only tab)
async function goToBilling(page) {
  await page.locator('#tab-billing').click();
  await page.waitForSelector('#billing-body', { timeout: 10000 });
}

// Wait for the nAlert/nConfirm dialog and return its title + message
async function waitForDialog(page) {
  await page.waitForSelector('#cdlg-overlay.open', { timeout: 8000 });
  const title = await page.locator('#cdlg-title').textContent();
  const msg   = await page.locator('#cdlg-msg').textContent();
  return { title: title.trim(), msg: msg.trim() };
}

// Dismiss the open dialog by clicking the last (OK / Confirm) button
async function dismissDialog(page) {
  await page.waitForSelector('#cdlg-overlay.open', { timeout: 5000 });
  await page.locator('#cdlg-ft button').last().click();
  await page.waitForSelector('#cdlg-overlay.open', { state: 'detached', timeout: 5000 }).catch(() => {});
}

// Inject a mock APP.brokerage so we can control billing state without a real MB account
async function mockBrokerage(page, overrides = {}) {
  await page.evaluate((o) => {
    window.APP = window.APP || {};
    window.APP.brokerage = Object.assign({
      lic:              'X025017',
      name:             'Test Brokerage Inc.',
      addr:             '123 Test St, Vancouver BC',
      phone:            '604-555-0100',
      billingSetup:     false,
      stripeCustomerId: null,
      payMethod:        'acss',
      paymentMethodId:  null
    }, o);
    // Re-render billing with the mock state
    if (window.renderBilling) window.renderBilling();
  }, overrides);
  await page.waitForSelector('#billing-body', { timeout: 5000 });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Billing — Payment Method Setup', () => {

  test('Billing page shows payment setup form for unonfigured brokerage', async ({ page }) => {
    await loginAsSA(page);
    await goToBilling(page);
    await mockBrokerage(page, { billingSetup: false, stripeCustomerId: null });

    await expect(page.locator('#billing-body')).toContainText('Set up a payment method');
    await expect(page.locator('#pay-tab-acss')).toBeVisible();
    await expect(page.locator('#pay-tab-card')).toBeVisible();
    await expect(page.locator('#bill-email')).toBeVisible();
  });

  test('ACSS tab shows bank account fields and hides card form', async ({ page }) => {
    await loginAsSA(page);
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
    await loginAsSA(page);
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
    await loginAsSA(page);
    await goToBilling(page);
    await mockBrokerage(page, { billingSetup: false, stripeCustomerId: null, payMethod: 'acss' });

    // Fill name but leave email blank
    await page.locator('#acss-name').fill('John Smith');
    await page.locator('[onclick="billingSubmit()"]').click();

    const { msg } = await waitForDialog(page);
    expect(msg).toContain('billing email');
    await dismissDialog(page);
  });

  test('billingSubmit blocks when account holder name is empty', async ({ page }) => {
    await loginAsSA(page);
    await goToBilling(page);
    await mockBrokerage(page, { billingSetup: false, stripeCustomerId: null, payMethod: 'acss' });

    await page.locator('#bill-email').fill('billing@testbrokerage.com');
    // Leave name blank
    await page.locator('[onclick="billingSubmit()"]').click();

    const { msg } = await waitForDialog(page);
    expect(msg).toContain('account holder name');
    await dismissDialog(page);
  });

  test('billingSubmit blocks when ACSS bank fields are incomplete', async ({ page }) => {
    await loginAsSA(page);
    await goToBilling(page);
    await mockBrokerage(page, { billingSetup: false, stripeCustomerId: null, payMethod: 'acss' });

    // Mock worker calls so we get past customer creation into the Stripe.js confirm step
    await page.route('**/stripe/create-customer', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ customerId: 'cus_test_mock' })
    }));
    await page.route('**/stripe/setup-intent', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ clientSecret: 'seti_test_secret_mock' })
    }));

    await page.locator('#bill-email').fill('billing@testbrokerage.com');
    await page.locator('#acss-name').fill('John Smith');
    // Leave institution/transit/account blank
    await page.locator('[onclick="billingSubmit()"]').click();

    const { msg } = await waitForDialog(page);
    expect(msg).toMatch(/bank account|institution|transit|complete all/i);
    await dismissDialog(page);
  });

});

test.describe('Billing — ACSS Return URL & Pending State', () => {

  test('?billing_setup=complete navigates to Billing page and shows confirmation modal', async ({ page }) => {
    // Simulate Stripe redirecting back after ACSS microdeposit initiation
    await page.goto(DEV_URL);
    await page.waitForSelector('#li-email', { timeout: 10000 });

    // Log in, then navigate with the param
    await loginAsSA(page);
    await page.goto(DEV_URL + '/?billing_setup=complete');
    await page.waitForSelector('#scr-platform', { state: 'visible', timeout: 20000 });

    // Should land on billing page
    await expect(page.locator('#pg-billing')).toBeVisible({ timeout: 5000 });

    // Confirmation modal should appear
    const { title, msg } = await waitForDialog(page);
    expect(title).toContain('Bank Account Submitted');
    expect(msg).toContain('microdeposits');
    await dismissDialog(page);

    // URL should be cleaned up
    expect(page.url()).not.toContain('billing_setup');
  });

  test('ACSS pending banner shows when customer exists but billing not yet confirmed', async ({ page }) => {
    await loginAsSA(page);
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
    await loginAsSA(page);
    await mockBrokerage(page, { billingSetup: false, stripeCustomerId: null });

    // Trigger activation via the app function directly
    await page.evaluate(() => {
      if (window.APP && window.APP.sc && window.APP.sc.length > 0) {
        const scId = window.APP.sc[0].id;
        if (window.activateSCMeetingMode) window.activateSCMeetingMode(scId);
      }
    });

    const { title, msg } = await waitForDialog(page);
    expect(title + msg).toMatch(/billing|payment method/i);
    await dismissDialog(page);
  });

});

test.describe('Billing — Account Statements', () => {

  test('Account Statements renders invoice list from Stripe', async ({ page }) => {
    await loginAsSA(page);
    await goToBilling(page);

    await page.route('**/stripe/invoices*', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        invoices: [{
          id:          'in_test_001',
          number:      'INV-2025-001',
          date:        Math.floor(Date.now() / 1000) - 86400,
          amount:      8900,
          currency:    'cad',
          description: 'EPS1234 — Meeting Mode + Local StrataSphere',
          status:      'paid',
          pdfUrl:      'https://invoice.stripe.com/test/pdf',
          hostedUrl:   'https://invoice.stripe.com/test/hosted'
        }]
      })
    }));

    await mockBrokerage(page, {
      billingSetup:     true,
      stripeCustomerId: 'cus_test_statements',
      payMethod:        'acss'
    });

    await expect(page.locator('#billing-body')).toContainText('INV-2025-001');
    await expect(page.locator('#billing-body')).toContainText('Account Statements');
  });

  test.skip('Account Statements shows empty state when no invoices', async ({ page }) => {
    await loginAsSA(page);
    await goToBilling(page);

    await page.route('**/stripe/invoices*', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ invoices: [] })
    }));

    await mockBrokerage(page, {
      billingSetup:     true,
      stripeCustomerId: 'cus_test_empty',
      payMethod:        'acss'
    });

    await expect(page.locator('#billing-body')).toContainText(/No statements found|No payment account found/);
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
    // Confirms the route is wired in the worker regardless of Stripe auth outcome
    const resp = await request.post(WORKER_URL + '/stripe/schedule-downgrade', {
      headers: { 'Content-Type': 'application/json' },
      data: { subscriptionId: 'sub_test_mock', newTier: 'local', scPlan: 'EPS1234', brkLic: 'X025017' }
    });
    expect(resp.status()).not.toBe(404);
    const body = await resp.json();
    // Will be a Stripe auth error in test env — that's expected and correct
    expect(body).not.toMatchObject({ error: expect.stringMatching(/not found|no route/i) });
  });

});

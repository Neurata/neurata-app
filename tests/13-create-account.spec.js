// tests/13-create-account.spec.js
// Covers the cold-signup "Create Account" flow re-enabled on the login screen.
// Flow: Login screen -> scr-onboard (Verify BCFSA licence -> Brokerage confirm
// -> Account credentials -> Terms agreement) -> account created -> platform loads.
//
// Uses the worker's built-in dummy licence fixture (RE696969) for the
// "new brokerage" happy path — this bypasses the live BCFSA scrape entirely
// (see DUMMY_LICENCES in worker.js), making the test deterministic and fast.
// Brokerage X025017 (Associated Property Management (2001) Ltd.) is the
// brokerage this dummy licence resolves to. If that brokerage has already
// been created in the target DB by a prior test run, the "brokerage already
// exists" test will pass instead of the "new brokerage" path — both paths
// are asserted generically below so either is valid on repeat runs.

const { test, expect } = require('@playwright/test');
const { DEV_URL } = require('./helpers');

const DUMMY_LIC = process.env.NEURATA_TEST_DUMMY_LIC || 'RE696969'; // worker.js DUMMY_LICENCES fixture
const EXISTING_BROKERAGE_LIC = process.env.NEURATA_TEST_EXISTING_LIC || 'X099001'; // Coastal Strata Management Ltd.

function uniqueEmail(prefix) {
  return `${prefix}+${Date.now()}@neuratatest.ai`;
}

test.describe('Create Account (cold signup)', () => {

  test('entry point is visible on login screen', async ({ page }) => {
    await page.goto(DEV_URL);
    await expect(page.locator('#scr-login')).toHaveClass(/on/);
    const createBtn = page.locator('#li-create-account-btn');
    await expect(createBtn).toBeVisible();
    await expect(createBtn).toContainText('Create one');
  });

  test('clicking Create Account navigates to onboarding step 1 (Verify)', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.locator('#li-create-account-btn').click();
    await expect(page.locator('#scr-onboard')).toHaveClass(/on/);
    await expect(page.locator('#ob-s1')).toHaveClass(/on/);
    await expect(page.locator('#stp-1')).toHaveClass(/active/);
    await expect(page.locator('#ob-lic')).toBeVisible();
  });

  test('can navigate back to login from onboarding step 1', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.locator('#li-create-account-btn').click();
    await expect(page.locator('#scr-onboard')).toHaveClass(/on/);
    await page.getByRole('button', { name: /Already have an account/i }).click();
    await expect(page.locator('#scr-login')).toHaveClass(/on/);
  });

  test('licence verify rejects empty input and unknown licence numbers', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.locator('#li-create-account-btn').click();
    await page.locator('#ob-verify-btn').click();
    // Empty input should trigger nAlert, not navigate to step 2
    await expect(page.locator('#ob-s2')).not.toHaveClass(/on/);

    await page.locator('#ob-lic').fill('000000');
    await page.locator('#ob-verify-btn').click();
    // Unknown licence should show inline error, not reach step 2
    await expect(page.locator('#ob-s1 .al.red_')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#ob-s2')).not.toHaveClass(/on/);
  });

  test('dummy licence fixture verifies instantly and populates step 2', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.locator('#li-create-account-btn').click();
    await page.locator('#ob-lic').fill(DUMMY_LIC);
    await page.locator('#ob-verify-btn').click();

    await expect(page.locator('#ob-s2')).toHaveClass(/on/, { timeout: 10000 });
    await expect(page.locator('#ob-rep-lic')).toHaveText(DUMMY_LIC);
    await expect(page.locator('#ob-rep-name')).toContainText('Jeremy');
    await expect(page.locator('#ob-brk-name')).toContainText('Associated Property Management');
    await expect(page.locator('#ob-brk-lic')).toContainText('X025017');
  });

  test('full flow: verify licence -> confirm brokerage -> create credentials -> accept terms -> account created', async ({ page }) => {
    // NOTE: RE696969 always resolves to brokerage X025017. The first time this
    // test runs against a given DB, it creates that brokerage (new-brokerage
    // path). On subsequent runs it will hit the "brokerage already exists"
    // path instead (OB.brkExists = true), which is also a valid pass — both
    // paths converge at obComplete() creating a working user account.
    await page.goto(DEV_URL);
    await page.locator('#li-create-account-btn').click();

    // Step 1: Verify licence (dummy fixture — deterministic, no live BCFSA call)
    await page.locator('#ob-lic').fill(DUMMY_LIC);
    await page.locator('#ob-verify-btn').click();
    await expect(page.locator('#ob-s2')).toHaveClass(/on/, { timeout: 10000 });

    // Step 2: Confirm brokerage details rendered, proceed
    await expect(page.locator('#ob-rep-lic')).toHaveText(DUMMY_LIC);
    await page.getByRole('button', { name: /Confirm & Continue/i }).click();
    await expect(page.locator('#ob-s3')).toHaveClass(/on/);

    // Step 3: Create credentials
    const email = uniqueEmail('newsignup');
    await page.locator('#ob-email').fill(email);
    await page.locator('#ob-pw').fill('TestPass123!');
    await page.locator('#ob-pw2').fill('TestPass123!');

    // Password rules should all show as satisfied
    await expect(page.locator('#rule-len')).toHaveClass(/ok/);
    await expect(page.locator('#rule-cap')).toHaveClass(/ok/);
    await expect(page.locator('#rule-num')).toHaveClass(/ok/);
    await expect(page.locator('#rule-spec')).toHaveClass(/ok/);
    await expect(page.locator('#rule-match')).toHaveClass(/ok/);

    const nextBtn = page.locator('#ob-s3-next');
    await expect(nextBtn).toBeEnabled();
    await nextBtn.click();
    await expect(page.locator('#ob-s4')).toHaveClass(/on/);

    // Step 4: Terms — checkbox should be disabled until scrolled to bottom
    const checkbox = page.locator('#ob-ck1');
    await expect(checkbox).toBeDisabled();

    await page.locator('#eua-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.locator('#eua-scroll').dispatchEvent('scroll');
    await expect(checkbox).toBeEnabled({ timeout: 5000 });

    await checkbox.check();
    const createBtn = page.locator('#ob-create-btn');
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    // Account creation should land the user on the platform shell
    await expect(page.locator('#scr-platform')).toHaveClass(/on/, { timeout: 20000 });
    await expect(page.locator('#topbar')).toBeVisible();
  });

  test('existing brokerage licence shows the "already exists" warning at step 2', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.locator('#li-create-account-btn').click();
    await page.locator('#ob-lic').fill(EXISTING_BROKERAGE_LIC);
    await page.locator('#ob-verify-btn').click();

    await Promise.race([
      page.locator('#ob-s2').waitFor({ state: 'visible', timeout: 15000 }),
      page.locator('#ob-s1 .al.red_').waitFor({ state: 'visible', timeout: 15000 })
    ]);
    const onStep2 = await page.locator('#ob-s2').evaluate(el => el.classList.contains('on'));
    test.skip(!onStep2, `EXISTING_BROKERAGE_LIC (${EXISTING_BROKERAGE_LIC}) did not resolve via BCFSA lookup in this environment.`);

    await expect(page.locator('#ob-brk-exists-warn')).toBeVisible({ timeout: 10000 });
  });

});

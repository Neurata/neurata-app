// tests/helpers.js
// Shared helpers, credentials, and utilities for Neurata tests

const DEV_URL    = 'https://appdev.neurata.ai';
const WORKER_URL = 'https://api-dev.neurata.ai';

const SA_CREDENTIALS = {
  email:    'jeremy@trickfilm.com',
  password: 'Test1234!'
};

// Test brokerage (X025017 = Associated Property Management)
const TEST_BRK_LIC = 'X025017';

// Dummy BCFSA licence for testing onboarding
const TEST_LIC = 'RE696969';

// Test SC plan number — must exist in dev DB
const TEST_SC_PLAN = 'VIS6597';

/**
 * Log in as Super Admin and wait for dashboard to load
 */
async function loginAsSA(page) {
  await page.goto(DEV_URL);
  await page.waitForSelector('#li-email', { timeout: 10000 });
  await page.fill('#li-email', SA_CREDENTIALS.email);
  await page.fill('#li-pw',    SA_CREDENTIALS.password);
  await page.click('#li-btn');
  await page.waitForSelector('#dash-body', { timeout: 15000 });
}

/**
 * Log in as SA and enter the test brokerage
 */
async function loginAndEnterBrokerage(page) {
  await loginAsSA(page);
  await page.evaluate((lic) => { window.adminEnterBrokerage(lic); }, TEST_BRK_LIC);
  await page.waitForSelector('#tab-billing', { timeout: 20000 });
}

/**
 * Switch SA role view (MB, AB, SM, AS, CD)
 */
async function switchSARole(page, roleCode) {
  await page.locator(`#super-admin-bar button:has-text("${roleCode}")`).click();
  await page.waitForTimeout(500);
}

/**
 * Navigate to the Strata Corps tab
 */
async function goToStrata(page) {
  await page.locator('#tab-strata').click();
  await page.waitForSelector('#pg-strata', { timeout: 10000 });
}

/**
 * Navigate to a specific SC's detail and a given tab
 */
async function openSCTab(page, scPlan, tab) {
  // Click the SC in the sidebar or list
  await page.locator(`[onclick*="renderSCDetail"][onclick*="${scPlan}"], .sc-item:has-text("${scPlan}")`).first().click();
  await page.waitForSelector('.sc-tabs', { timeout: 10000 });
  if (tab) {
    await page.locator(`.sc-tab:has-text("${tab}")`).click();
    await page.waitForTimeout(500);
  }
}

/**
 * Wait for a toast/nAlert to appear and return its text
 */
async function waitForAlert(page, timeout = 5000) {
  const alert = page.locator('.n-alert, .al, [id^="n-alert"]').first();
  await alert.waitFor({ state: 'visible', timeout });
  return alert.textContent();
}

/**
 * Wait for nConfirm/nAlert dialog and return title + message
 */
async function waitForDialog(page, timeout = 8000) {
  await page.waitForSelector('#cdlg-overlay.open', { timeout });
  const title = await page.locator('#cdlg-title').textContent();
  const msg   = await page.locator('#cdlg-msg').textContent();
  return { title: title.trim(), msg: msg.trim() };
}

/**
 * Dismiss the open dialog
 */
async function dismissDialog(page) {
  await page.waitForSelector('#cdlg-overlay.open', { timeout: 5000 });
  await page.locator('#cdlg-ft button').last().click();
  await page.waitForSelector('#cdlg-overlay.open', { state: 'detached', timeout: 5000 }).catch(() => {});
}

/**
 * Click a button by its text content
 */
async function clickButton(page, text) {
  await page.locator(`button:has-text("${text}")`).first().click();
}

/**
 * Check browser console for errors — returns array of error messages
 */
function captureConsoleErrors(page) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

module.exports = {
  DEV_URL, WORKER_URL,
  SA_CREDENTIALS, TEST_BRK_LIC, TEST_LIC, TEST_SC_PLAN,
  loginAsSA, loginAndEnterBrokerage, switchSARole,
  goToStrata, openSCTab,
  waitForAlert, waitForDialog, dismissDialog,
  clickButton, captureConsoleErrors
};

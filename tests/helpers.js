// tests/helpers.js
// Shared helpers, credentials, and utilities for Neurata tests

const DEV_URL = 'https://appdev.neurata.ai';

const SA_CREDENTIALS = {
  email: 'jeremy@trickfilm.com',
  password: 'Test1234!'
};

// Dummy BCFSA licence for testing onboarding
const TEST_LIC = 'RE696969';

/**
 * Log in as Super Admin and wait for dashboard to load
 */
async function loginAsSA(page) {
  await page.goto(DEV_URL);
  await page.waitForSelector('#li-email', { timeout: 10000 });
  await page.fill('#li-email', SA_CREDENTIALS.email);
  await page.fill('#li-pw', SA_CREDENTIALS.password);
  await page.click('#li-btn');
  // Wait for SA dashboard to load
  await page.waitForSelector('#dash-body', { timeout: 15000 });
}

/**
 * Wait for a toast/alert to appear and return its text
 */
async function waitForAlert(page, timeout = 5000) {
  const alert = page.locator('.n-alert, .al, [id^="n-alert"]').first();
  await alert.waitFor({ state: 'visible', timeout });
  return alert.textContent();
}

/**
 * Click a button by its text content
 */
async function clickButton(page, text) {
  await page.locator(`button:has-text("${text}")`).first().click();
}

module.exports = { DEV_URL, SA_CREDENTIALS, TEST_LIC, loginAsSA, waitForAlert, clickButton };

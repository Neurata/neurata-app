// tests/helpers.js
const DEV_URL    = 'https://appdev.neurata.ai';
const WORKER_URL = 'https://api-dev.neurata.ai';

const SA_CREDENTIALS = { email: 'jeremy@trickfilm.com', password: 'Test1234!' };
const TEST_BRK_LIC = 'X099001';
const TEST_LIC     = 'RE696969';
const TEST_SC_PLAN = 'KAS2291';

async function loginAsSA(page) {
  await page.goto(DEV_URL);
  await page.waitForSelector('#li-email', { timeout: 10000 });
  await page.fill('#li-email', SA_CREDENTIALS.email);
  await page.fill('#li-pw',    SA_CREDENTIALS.password);
  await page.click('#li-btn');
  await page.waitForSelector('#dash-body', { timeout: 15000 });
}

async function loginAndEnterBrokerage(page) {
  await loginAsSA(page);

  // Wait for SA dashboard to fully load including _allBrokerages
  await page.waitForFunction(
    (lic) => !!(window.APP && window.APP._allBrokerages &&
                window.APP._allBrokerages.find(b => b.bcfsa_lic === lic)),
    TEST_BRK_LIC,
    { timeout: 30000 }
  );

  // Enter the brokerage
  await page.evaluate((lic) => { window.adminEnterBrokerage(lic); }, TEST_BRK_LIC);

  // Wait for brokerage context — pg-strata becomes active page
  await page.waitForFunction(
    () => !!(window.APP && window.APP.brokerage && window.APP.brokerage.lic),
    { timeout: 20000 }
  );

  // Wait for nav to render with billing tab
  await page.waitForSelector('#tab-billing', { timeout: 15000 });
}

async function switchSARole(page, roleCode) {
  await page.locator(`#super-admin-bar button:has-text("${roleCode}")`).click();
  await page.waitForTimeout(800);
}

async function goToStrata(page) {
  await page.locator('#tab-strata').click();
  await page.waitForSelector('#pg-strata', { timeout: 10000 });
}

async function openSCTab(page, scPlan, tab) {
  await page.locator(`[onclick*="renderSCDetail"][onclick*="${scPlan}"], .sc-item:has-text("${scPlan}")`).first().click();
  await page.waitForSelector('.sc-tabs', { timeout: 10000 });
  if (tab) {
    await page.locator(`.sc-tab:has-text("${tab}")`).click();
    await page.waitForTimeout(500);
  }
}

async function waitForAlert(page, timeout = 5000) {
  const alert = page.locator('.n-alert, .al, [id^="n-alert"]').first();
  await alert.waitFor({ state: 'visible', timeout });
  return alert.textContent();
}

async function waitForDialog(page, timeout = 8000) {
  await page.waitForSelector('#cdlg-overlay.open', { timeout });
  const title = await page.locator('#cdlg-title').textContent();
  const msg   = await page.locator('#cdlg-msg').textContent();
  return { title: title.trim(), msg: msg.trim() };
}

async function dismissDialog(page) {
  await page.waitForSelector('#cdlg-overlay.open', { timeout: 5000 });
  await page.locator('#cdlg-ft button').last().click();
  await page.waitForSelector('#cdlg-overlay.open', { state: 'detached', timeout: 5000 }).catch(() => {});
}

async function clickButton(page, text) {
  await page.locator(`button:has-text("${text}")`).first().click();
}

function captureConsoleErrors(page) {
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
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

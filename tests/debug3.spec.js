const { test } = require('@playwright/test');
const { loginAndEnterBrokerage, switchSARole } = require('./helpers');

test('debug 06 - what does dash-body actually contain', async ({ page }) => {
  await loginAndEnterBrokerage(page);
  await page.evaluate(() => { if (window.renderDash) window.renderDash(); });
  await page.waitForTimeout(2000);
  const info = await page.evaluate(() => ({
    html: document.getElementById('dash-body')?.innerHTML.slice(0, 500) || 'missing',
    statCount: document.querySelectorAll('#dash-body .stat').length,
    pgOn: document.getElementById('pg-dashboard')?.classList.contains('on'),
    subs: window.APP.brokerage?.subscriptionStatus,
    role: window.APP.currentUser?.role,
  }));
  console.log('DASH:', JSON.stringify(info, null, 2));
});

test('debug 09 - ASST SC tabs with active SC', async ({ page }) => {
  await loginAndEnterBrokerage(page);
  await switchSARole(page, 'AS');
  await page.waitForTimeout(500);
  const scInfo = await page.evaluate(() => {
    const scs = window.APP.sc || [];
    return scs.map(s => ({ id: s.id, plan: s.plan, isSubscribed: s.isSubscribed, mmActive: s.mmActive, mmStatus: s.mmStatus }));
  });
  console.log('SCs:', JSON.stringify(scInfo, null, 2));
  
  // Try opening an active SC
  await page.evaluate(() => {
    const sc = window.APP.sc.find(s => s.isSubscribed || s.mmActive) || window.APP.sc[0];
    console.log('Using SC:', sc?.plan);
    if (sc) { window.showPg('strata'); window.openSCDetail(sc.id); }
  });
  await page.waitForTimeout(1500);
  const tabs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.sc-tab')).map(t => t.textContent.trim())
  );
  console.log('Tabs:', JSON.stringify(tabs));
});

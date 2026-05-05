# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 02-sa-dashboard.spec.js >> SA Dashboard >> BCFSA lookup with dummy licence
- Location: tests/02-sa-dashboard.spec.js:28:3

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: page.waitForFunction: Test timeout of 60000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e3]:
      - img [ref=e4] [cursor=pointer]
      - generic [ref=e15]:
        - button "Dashboard" [ref=e16] [cursor=pointer]
        - button "Knowledge Base" [ref=e17] [cursor=pointer]
      - generic [ref=e19]: SUPER ADMIN
      - generic [ref=e20]:
        - button "Help & Support" [ref=e21] [cursor=pointer]:
          - img [ref=e22]
        - generic [ref=e25] [cursor=pointer]:
          - generic [ref=e26]: JM
          - generic [ref=e27]: Jeremy McCarron
          - generic [ref=e28]: ▾
    - generic [ref=e29]:
      - generic [ref=e31]:
        - generic [ref=e32]: Navigation
        - generic [ref=e34] [cursor=pointer]: Dashboard
      - generic [ref=e36]:
        - generic [ref=e38]:
          - generic [ref=e39]:
            - generic [ref=e40]: Dashboard
            - generic [ref=e41]: Platform Overview
          - button "+ Add Brokerage" [ref=e43] [cursor=pointer]
        - generic [ref=e44]:
          - generic [ref=e45]:
            - generic [ref=e46]:
              - generic [ref=e47]: Brokerages
              - generic [ref=e48]: "1"
            - generic [ref=e49]:
              - generic [ref=e50]: Strata Corps
              - generic [ref=e51]: "1"
            - generic [ref=e52]:
              - generic [ref=e53]: MM Active
              - generic [ref=e54]: "0"
            - generic [ref=e55]:
              - generic [ref=e56]: Local SS
              - generic [ref=e57]: "0"
            - generic [ref=e58]:
              - generic [ref=e59]: Global SS
              - generic [ref=e60]: "0"
            - generic [ref=e61]:
              - generic [ref=e62]: Est. MRR
              - generic [ref=e63]: CA$0.00
          - generic [ref=e64]:
            - generic [ref=e65]:
              - generic [ref=e66]: Registered Brokerages
              - generic [ref=e67]:
                - button "⊞ Grid" [ref=e68] [cursor=pointer]
                - button "☰ List" [ref=e69] [cursor=pointer]
            - generic [ref=e71] [cursor=pointer]:
              - generic [ref=e72]:
                - generic [ref=e73]:
                  - generic [ref=e74]: Associated Property Management (2001) Ltd.
                  - generic [ref=e75]: X025017
                - generic [ref=e76]: Trial
              - generic [ref=e77]:
                - generic [ref=e78]: 1 corps
                - generic [ref=e79]: 0 MM active
                - generic [ref=e80]: "AI: 0%"
                - generic [ref=e81]: 0/2 trial
              - generic [ref=e82]: "#1 - 1441 St. Paul Street, Kelowna British Columbia V1Y 2E4"
              - generic [ref=e83]:
                - button "Sync" [ref=e84]
                - button "Manage Trial" [ref=e85]
  - generic [ref=e87]:
    - generic [ref=e88]:
      - generic [ref=e89]: Add Brokerage
      - button "×" [ref=e90] [cursor=pointer]
    - generic [ref=e91]:
      - generic [ref=e92]:
        - generic [ref=e93]: BCFSA Brokerage Licence Number
        - generic [ref=e94]:
          - textbox "e.g. X012345" [ref=e95]: X025017
          - button "Look Up" [active] [ref=e96] [cursor=pointer]
      - generic [ref=e97]: X025017 is already registered on the platform — Associated Property Management (2001) Ltd..
    - button "Cancel" [ref=e99] [cursor=pointer]
```

# Test source

```ts
  1  | // tests/02-sa-dashboard.spec.js
  2  | const { test, expect } = require('@playwright/test');
  3  | const { loginAsSA } = require('./helpers');
  4  | 
  5  | test.describe('SA Dashboard', () => {
  6  | 
  7  |   test.beforeEach(async ({ page }) => {
  8  |     await loginAsSA(page);
  9  |   });
  10 | 
  11 |   test('Dashboard shows stat cards', async ({ page }) => {
  12 |     await expect(page.locator('#dash-body .card').first()).toBeVisible();
  13 |     await expect(page.locator('#super-admin-bar')).toBeVisible();
  14 |   });
  15 | 
  16 |   test('Can switch between grid and list view', async ({ page }) => {
  17 |     await page.locator('button:has-text("List")').first().click();
  18 |     await expect(page.locator('table.tbl').first()).toBeVisible();
  19 |     await page.locator('button:has-text("Grid")').first().click();
  20 |   });
  21 | 
  22 |   test('Add Brokerage button opens modal', async ({ page }) => {
  23 |     await page.locator('#dash-hdr-actions button').click();
  24 |     await expect(page.locator('#mo-create-brk')).toBeVisible({ timeout: 5000 });
  25 |     await expect(page.locator('#crk-lic')).toBeVisible();
  26 |   });
  27 | 
  28 |   test('BCFSA lookup with dummy licence', async ({ page }) => {
  29 |     await page.locator('#dash-hdr-actions button').click();
  30 |     await page.fill('#crk-lic', 'X025017');
  31 |     await page.locator('#mo-create-brk button:has-text("Look Up")').click();
  32 |     // Wait for crk-result to become visible (style.display goes from 'none' to '')
> 33 |     await page.waitForFunction(
     |                ^ Error: page.waitForFunction: Test timeout of 60000ms exceeded.
  34 |       () => {
  35 |         const el = document.getElementById('crk-result');
  36 |         return el && el.style.display !== 'none';
  37 |       },
  38 |       { timeout: 15000 }
  39 |     );
  40 |     await expect(page.locator('#crk-preview')).not.toBeEmpty();
  41 |   });
  42 | 
  43 |   test('SA role filter buttons work after entering brokerage', async ({ page }) => {
  44 |     // Role filter buttons only appear when SA has entered a brokerage
  45 |     // First create a brokerage via the modal
  46 |     await page.locator('#dash-hdr-actions button').click();
  47 |     await page.fill('#crk-lic', 'X025017');
  48 |     await page.locator('#mo-create-brk button:has-text("Look Up")').click();
  49 |     await page.waitForFunction(
  50 |       () => { const el = document.getElementById('crk-result'); return el && el.style.display !== 'none'; },
  51 |       { timeout: 15000 }
  52 |     );
  53 |     await page.locator('#crk-save-btn').click();
  54 |     // Wait for brokerage to appear and enter it
  55 |     await page.waitForFunction(
  56 |       () => document.querySelectorAll('[onclick*="adminEnterBrokerage"]').length > 0,
  57 |       { timeout: 10000 }
  58 |     );
  59 |     await page.locator('[onclick*="adminEnterBrokerage"]').first().click();
  60 |     // Now role filter buttons should be visible
  61 |     await page.waitForSelector('#super-admin-bar button', { timeout: 10000 });
  62 |     const buttons = await page.locator('#super-admin-bar button').allTextContents();
  63 |     expect(buttons.some(b => b.includes('MB'))).toBeTruthy();
  64 |     expect(buttons.some(b => b.includes('SM'))).toBeTruthy();
  65 |   });
  66 | 
  67 | });
  68 | 
```
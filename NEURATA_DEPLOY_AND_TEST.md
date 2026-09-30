# Neurata — Explicit Deploy & Playwright Instructions

## DEPLOYING HTML FILES

### Working directory
All files are built and stored in `/home/claude/neurata/`. Never edit files directly in the outputs folder or the GitHub repo.

### The two app files
- `neurata_dev.html` — development version (`ENV = 'development'`, dev Supabase URLs)
- `neurata_prod.html` — production version, always built FROM dev using the build command below

### Step 1 — Build prod from dev (always do this, never edit prod directly)
```bash
cp /home/claude/neurata/neurata_dev.html /home/claude/neurata/neurata_prod.html
sed -i "s/var ENV = 'development'/var ENV = 'production'/" /home/claude/neurata/neurata_prod.html
sed -i 's|dzurctohotgtummajgiw.supabase.co|sozghbobflcjrfsmewxv.supabase.co|g' /home/claude/neurata/neurata_prod.html
```

### Step 2 — Sanity check before deploying (run this every time)
```bash
python3 << 'EOF'
import re, subprocess, tempfile, os
from collections import Counter
with open('/home/claude/neurata/neurata_dev.html', 'r') as f:
    content = f.read()
scripts = re.findall(r'<script(?![^>]*src)[^>]*>(.*?)</script>', content, re.DOTALL)
combined = '\n'.join(scripts)
with tempfile.NamedTemporaryFile(suffix='.js', mode='w', delete=False) as tmp:
    tmp.write(combined)
    tmpname = tmp.name
r = subprocess.run(['node', '--check', tmpname], capture_output=True, text=True)
print('Syntax:', r.stdout.strip() or 'OK', r.stderr.strip() or '')
os.unlink(tmpname)
scripts_full = re.findall(r'<script[^>]*>.*?</script>', content, re.DOTALL)
html_only = content
for s in scripts_full: html_only = html_only.replace(s, '')
opens = len(re.findall(r'<div\b', html_only))
closes = len(re.findall(r'</div>', html_only))
print(f'Divs: {opens}/{closes}', '✓' if opens == closes else '✗ MISMATCH')
fn_names = re.findall(r'^function (\w+)', combined, re.MULTILINE)
dupes = {k:v for k,v in Counter(fn_names).items() if v > 1}
print('Duplicates:', dupes if dupes else 'None ✓')
EOF
```
All three checks must pass before proceeding. Expected: `Syntax: OK`, `Divs: 559/559 ✓`, `Duplicates: None ✓`

### Step 3 — Copy to outputs folder (so user can download)
```bash
cp /home/claude/neurata/neurata_dev.html /mnt/user-data/outputs/neurata_dev.html
cp /home/claude/neurata/neurata_prod.html /mnt/user-data/outputs/neurata_prod.html
```
Then call `present_files` with both paths.

### Step 4 — User downloads and deploys via these exact git commands

**Deploy dev:**
```bash
cd ~/Documents/GitHub/neurata-app && git checkout development && git pull && rm -f neurata.html && cp ~/Downloads/neurata_dev.html neurata.html && git add -f neurata.html && git commit --allow-empty -m "DESCRIPTION HERE" && git push && rm ~/Downloads/neurata_dev.html
```

**Deploy prod:**
```bash
cd ~/Documents/GitHub/neurata-app && git checkout main && git pull && rm -f neurata.html && cp ~/Downloads/neurata_prod.html neurata.html && git add -f neurata.html && git commit --allow-empty -m "DESCRIPTION HERE" && git push && rm ~/Downloads/neurata_prod.html
```

### Deploying worker.js
```bash
node --check /home/claude/neurata/worker.js && echo "OK"
cp /home/claude/neurata/worker.js /mnt/user-data/outputs/worker.js
```
Then user deploys manually via Cloudflare dashboard to BOTH `neurata-worker` (prod) and `neurata-api-dev` (dev).

### IMPORTANT RULES
- Never modify `neurata_prod.html` directly — always rebuild from dev
- Never commit `neurata_dev.html` to `main` branch or `neurata_prod.html` to `development` branch
- The file in the repo is always named `neurata.html` (not `neurata_dev.html`)
- `git commit --allow-empty` is intentional — allows re-deploying the same content
- `rm ~/Downloads/neurata_dev.html` after push cleans up the download

---

## PLAYWRIGHT TESTS

### File locations
All Playwright files live in `/home/claude/neurata/` and must be written to `/home/claude/neurata/tests/` before running.

Existing spec files:
- `01-sa-login.spec.js`
- `02-sa-dashboard.spec.js`
- `03-bro-onboarding.spec.js`
- `04-sc-management.spec.js`
- `05-ui-elements.spec.js`
- `06-onboarding.spec.js`
- `07-password-rules.spec.js`

Config: `playwright.config.js`
Helpers: `helpers.js`

### helpers.js structure
```javascript
const DEV_URL = 'https://appdev.neurata.ai';
const SA_CREDENTIALS = { email: 'jeremy@trickfilm.com', password: 'Test1234!' };
const TEST_LIC = 'RE696969'; // dummy BCFSA licence (bypasses real scrape)

async function loginAsSA(page) { ... }
async function waitForAlert(page, timeout) { ... }
async function clickButton(page, text) { ... }

module.exports = { DEV_URL, SA_CREDENTIALS, TEST_LIC, loginAsSA, waitForAlert, clickButton };
```

### Spec file structure (follow this exactly)
```javascript
// tests/NN-name.spec.js
const { test, expect } = require('@playwright/test');
const { DEV_URL, loginAsSA, SA_CREDENTIALS } = require('./helpers');

test.describe('Feature Name', () => {

  test('test description', async ({ page }) => {
    await page.goto(DEV_URL);
    await page.waitForSelector('#element-id', { timeout: 10000 });
    // ... test steps
  });

});
```

### Step 1 — Write the spec file
Claude writes the spec file content, then saves it:
```bash
cat > /home/claude/neurata/tests/NN-name.spec.js << 'EOF'
// file content here
EOF
```

### Step 2 — Set up the test environment (first time or after clean)
```bash
cd /home/claude/neurata && npm init -y 2>/dev/null || true
npm install --save-dev @playwright/test 2>/dev/null
npx playwright install chromium 2>/dev/null
```

### Step 3 — Copy all spec files and helpers into tests/ directory
```bash
mkdir -p /home/claude/neurata/tests
cp /home/claude/neurata/helpers.js /home/claude/neurata/tests/helpers.js
cp /home/claude/neurata/playwright.config.js /home/claude/neurata/playwright.config.js
# Copy all existing spec files
for f in /home/claude/neurata/*.spec.js; do cp "$f" /home/claude/neurata/tests/; done
```

### Step 4 — Run tests
```bash
# Run a specific spec file
cd /home/claude/neurata && npx playwright test tests/03-bro-onboarding.spec.js --reporter=list

# Run all tests
cd /home/claude/neurata && npx playwright test --reporter=list

# Run with headed browser (for debugging — only works if display is available)
cd /home/claude/neurata && npx playwright test tests/03-bro-onboarding.spec.js --headed --reporter=list

# Run a single test by name
cd /home/claude/neurata && npx playwright test --grep "test name here" --reporter=list
```

### Step 5 — Package spec files for the user to download
```bash
cp /home/claude/neurata/tests/NN-name.spec.js /mnt/user-data/outputs/NN-name.spec.js
```
Then call `present_files`.

User places spec files in their local `~/Documents/GitHub/neurata-app/tests/` directory and runs locally with:
```bash
cd ~/Documents/GitHub/neurata-app && npx playwright test tests/03-bro-onboarding.spec.js
```

### playwright.config.js key settings
```javascript
{
  testDir: './tests',
  timeout: 60000,
  workers: 1,        // run sequentially — important
  use: {
    baseURL: 'https://appdev.neurata.ai',
    headless: false,  // headed locally to bypass Cloudflare challenges
    userAgent: 'Mozilla/5.0 ...',  // human user agent to avoid bot detection
    launchOptions: { slowMo: 100 } // slow down to appear human
  }
}
```

### Common test patterns

**Wait for app to load:**
```javascript
await page.goto(DEV_URL);
await page.waitForSelector('#li-email', { timeout: 10000 });
```

**Login as SA:**
```javascript
const { loginAsSA } = require('./helpers');
await loginAsSA(page); // navigates to DEV_URL and logs in as Jeremy
await page.waitForSelector('#dash-body', { timeout: 15000 });
```

**Wait for async operation (e.g. BCFSA lookup):**
```javascript
await page.waitForFunction(
  () => document.getElementById('ob-rep-name')?.textContent?.trim() !== '—',
  { timeout: 30000 }
);
```

**Check for toast/alert:**
```javascript
await page.waitForSelector('.n-alert', { timeout: 5000 });
const text = await page.locator('.n-alert').textContent();
expect(text).toContain('expected text');
```

**Navigate to a section:**
```javascript
await page.locator('text=Strata Corps').click();
await page.waitForSelector('#pg-strata', { timeout: 5000 });
```

### Key element IDs in the app
```
#li-email, #li-pw, #li-btn          Login form
#scr-login, #scr-onboard, #scr-platform  Screens
#dash-body                           Dashboard
#pg-strata                           Strata Corps page
#pg-brokerage                        Brokerage page
#ob-lic, #ob-verify-btn              Onboarding licence field
#ob-rep-name                         Onboarding name display
#scr-invited                         Invite signup screen
#cdlg-overlay                        Modal overlay
.n-alert                             Alert/toast
```

### Dummy test credentials
- SA login: `jeremy@trickfilm.com` / `Test1234!`
- Dummy BCFSA licence: `RE696969` (bypasses real BCFSA scrape, returns test data)
- Tests run against `appdev.neurata.ai` (dev environment only — never prod)

### Troubleshooting
- **Cloudflare challenge blocking headless browser:** Set `headless: false` in config or run locally
- **Timeout on selector:** App may be loading slowly — increase timeout to 30000
- **Test flaky:** Add `test.slow()` at top of test block to triple the timeout
- **Element not found:** Use `page.locator('[data-testid="x"]')` or `page.locator('text=...')` if IDs change

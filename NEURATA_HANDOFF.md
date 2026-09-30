# Neurata — Complete Development Handoff

You are taking over development of **Neurata**, a BC strata property management SaaS platform. This document contains everything you need to be an expert on the codebase, architecture, decisions, and hard-won lessons from building it.

---

## 1. What Is Neurata

Neurata is a purpose-built platform for BC strata property managers (licensed under BCFSA). Core features:

- **Meeting Mode** — run live strata council meetings with agenda, attendance, motions, votes, AI-assisted summaries
- **StrataSphere AI** — governance intelligence assistant using the SC's bylaws, decisions, and meeting history
- **Minutes Export** — auto-generated SPA-compliant minutes exported as .docx or PDF
- **Portfolio Management** — brokerage dashboard managing multiple strata corporations, reps, subscriptions
- **BCFSA Integration** — licence verification via scraping the public BCFSA registry

Target market: BC strata management companies (e.g. Tribe Property Technologies) and independent strata managers.

Pricing:
- Free Trial: up to 2 SCs, no time limit
- Local StrataSphere: CA$39/SC/month + CA$1.49/strata lot/month (annual commitment)
- Global StrataSphere: CA$39/SC/month + CA$2.49/strata lot/month (annual commitment)

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Single-file HTML/JS/CSS (`neurata.html`) — no framework |
| Backend | Cloudflare Worker (`worker.js`) |
| Database | Supabase PostgreSQL |
| Auth | Supabase Auth (JWT with custom app_metadata) |
| AI | Anthropic Claude Sonnet 4 (`claude-sonnet-4-6`) |
| Payments | Stripe (subscriptions, metered billing) |
| Email | Mailtrap (sending API for live emails) |
| Hosting (app) | Vercel (GitHub auto-deploy) |
| Hosting (marketing) | Separate site repo on Vercel |
| DNS/CDN | Cloudflare |
| Storage | Supabase Storage (bucket: `neurata-documents`) |

---

## 3. Repository Structure

**App repo:** `github.com/[org]/neurata-app`
- `neurata.html` — the entire application (dev or prod depending on branch)
- `worker.js` — Cloudflare Worker
- **Branch `development`** → deploys to `appdev.neurata.ai`
- **Branch `main`** → deploys to `app.neurata.ai`

**Site repo:** separate repo for `neurata.ai` marketing site
- `index.html` — marketing homepage
- `privacy.html` — Privacy Policy
- `terms.html` — Terms of Service

**Local working files:** `/home/claude/neurata/`
- `neurata_dev.html` — dev app (ENV = 'development')
- `neurata_prod.html` — prod app (ENV = 'production')
- `worker.js` — worker (same for dev and prod, different secrets)
- `index_v3.html` — current marketing site
- `neurata_dev_schema.sql` — full DB schema

---

## 4. Build & Deploy Commands

### Build prod from dev:
```bash
cp neurata_dev.html neurata_prod.html
sed -i "s/var ENV = 'development'/var ENV = 'production'/" neurata_prod.html
sed -i 's|dzurctohotgtummajgiw.supabase.co|sozghbobflcjrfsmewxv.supabase.co|g' neurata_prod.html
```

### Deploy dev app:
```bash
cd ~/Documents/GitHub/neurata-app && git checkout development && git pull && rm -f neurata.html && cp ~/Downloads/neurata_dev.html neurata.html && git add -f neurata.html && git commit --allow-empty -m "description" && git push && rm ~/Downloads/neurata_dev.html
```

### Deploy prod app:
```bash
cd ~/Documents/GitHub/neurata-app && git checkout main && git pull && rm -f neurata.html && cp ~/Downloads/neurata_prod.html neurata.html && git add -f neurata.html && git commit --allow-empty -m "description" && git push && rm ~/Downloads/neurata_prod.html
```

### Worker deploy:
Deploy `worker.js` to both `neurata-api-dev` and `neurata-worker` via Cloudflare dashboard or Wrangler.

---

## 5. Environment Configuration

### App (`neurata_dev.html`)
```javascript
var ENV = 'development'; // changed to 'production' in prod build

var WORKER_URL = ENV === 'development'
  ? 'https://api-dev.neurata.ai'
  : 'https://api.neurata.ai';

var SUPABASE_URL = ENV === 'development'
  ? 'https://dzurctohotgtummajgiw.supabase.co'    // DEV
  : 'https://sozghbobflcjrfsmewxv.supabase.co';   // PROD

var SUPABASE_ANON_KEY = ENV === 'development'
  ? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'   // DEV anon key
  : 'sb_publishable_KA_-dMzzaj3SA750GqL4Yg_...'; // PROD anon key
```

### Cloudflare Worker Secrets (set in Cloudflare dashboard)
Both `neurata-worker` (prod) and `neurata-api-dev` (dev) need:

| Secret | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (bypasses RLS) |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `MAILTRAP_API_KEY` | Mailtrap testing/sandbox API key |
| `MAILTRAP_SEND_KEY` | Mailtrap sending API key (for real delivery) |

### Cloudflare DNS (neurata.ai)
Key records:
- `A neurata.ai → 76.76.21.21` (Vercel)
- `CNAME app → cname.vercel-dns.com`
- `CNAME appdev → [vercel deployment]`
- `Worker api.neurata.ai → neurata-worker` (proxied)
- `AAAA api-dev → 100::` (dev worker)
- Mailtrap sending DNS: `mt07`, `mt-link`, `rwmt1._domainkey`, `rwmt2._domainkey`

---

## 6. Supabase Database Schema

### Key Tables

| Table | Purpose |
|---|---|
| `brokerages` | Brokerage accounts — primary entity, keyed by `bcfsa_lic` |
| `users` | Platform users — linked to `auth.users` via `id` |
| `strata_corps` | Strata corporations — keyed by `plan_number` |
| `reps` | BCFSA-synced rep list per brokerage |
| `sc_users` | SC ↔ user assignments (`access_type`: 'manager' or 'rep') |
| `meetings` | Meeting records per SC |
| `decisions` | Motion/vote outcomes per SC |
| `council_members` | Council roster per SC |
| `strata_lots` | Lot register per SC |
| `documents` | Uploaded/indexed documents per SC or brokerage |
| `ai_usage` | AI call tracking for billing/limits |
| `ss_conversations` | StrataSphere conversation history |
| `activation_requests` | Subscription activation/cancellation requests from MBs |
| `invoices` | Stripe invoice cache |

### JWT Helper Functions (in `public` schema)
```sql
public.jwt_role()         -- returns role from app_metadata
public.jwt_brokerage_id() -- returns brokerage_id from app_metadata
public.jwt_is_sa()        -- returns true if Super Admin
```

### Auth app_metadata structure
```json
{
  "brokerage_id": "X025017",
  "role": "Managing Broker"
}
```
Roles: `Super Admin`, `Managing Broker`, `Associate Broker`, `Representative`, `Assistant`, `Council Delegate`

### Key RLS Policies
```sql
-- brokerages: anon can read (for pre-signup existence check)
CREATE POLICY brokerages_select ON public.brokerages FOR SELECT
USING (jwt_is_sa() OR bcfsa_lic = jwt_brokerage_id() OR auth.role() = 'anon');

-- sc_users: users see their own rows + all rows for their brokerage's SCs
CREATE POLICY sc_users_select ON public.sc_users FOR SELECT
USING (
  jwt_is_sa() OR user_id = auth.uid()
  OR jwt_role() = ANY(ARRAY['Managing Broker','Associate Broker'])
  OR sc_id IN (SELECT plan_number FROM public.strata_corps WHERE brokerage_id = jwt_brokerage_id())
);

-- strata_corps: brokerage-scoped
CREATE POLICY strata_corps_select ON public.strata_corps FOR SELECT
USING (jwt_is_sa() OR brokerage_id = jwt_brokerage_id());
```

### Service Role Grants Required
```sql
GRANT SELECT, INSERT, UPDATE ON public.brokerages TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.users TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.sc_users TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.reps TO service_role;
GRANT INSERT, SELECT ON public.ai_usage TO service_role;
```

### Supabase Storage
- Bucket: `neurata-documents` — SC and brokerage documents
- Bucket: `public-assets` — public logos and images
  - `public-assets/neurata-logos/NeurataLogoOrangeWhite.png` — email logo (PNG, not SVG — email clients block SVG)

---

## 7. User Roles & Access Model

```
Super Admin (SA)
  └── Can impersonate any brokerage, manage all data

Managing Broker (MB)
  └── Full brokerage access, manage reps, billing, all SCs

Associate Broker (AB)
  └── Same as MB except cannot manage billing

Representative (SM/Rep)
  └── Assigned to specific SCs via sc_users
  └── Can be designated Strata Manager (sm_lic on strata_corps)
  └── SM of an SC can remove other reps from that SC

Assistant
  └── Assigned to specific SCs, limited access

Council Delegate
  └── Council portal access only, per SC
```

### SM (Strata Manager) Assignment
- **Single source of truth:** `strata_corps.sm_lic` (BCFSA licence number)
- SM name resolved at load time via `users` table lookup
- All manager display (list view, overview card, reps tab) reads from `sc_.smName` resolved from `sm_lic`
- Never use `APP.currentUser` for SM display in minutes/exports — always use `sc_.smName`/`sc_.smLic`

---

## 8. Signup & Invite Flow

### Critical Architecture Decision
All brokerage/user creation routes through the **worker `/register` endpoint** using the service key — NOT directly via Supabase client. This bypasses the JWT chicken-and-egg problem where the new user doesn't have a JWT yet.

### Signup Flow (`obComplete`)
1. BCFSA lookup → validate licence
2. Supabase `auth.signUp()` with metadata
3. POST to `/register` worker endpoint with full brokerage/user data
4. Worker writes: `brokerages` upsert, `users` upsert, `auth.users` app_metadata, `sc_users` rows, `reps` update
5. `refreshSession()` so JWT picks up new metadata
6. `launchPlatform()`

### Invite Flow (`obInviteComplete`)
Same as signup but:
- `brkExists: true` to prevent resetting trial
- `scPlans` array passed so worker writes `sc_users` rows
- `_postSignupScId` stashed to deep-link to SC after login

### Assign (existing user) Flow
MB clicks Assign on brokerage page or reps tab:
- Checks `users` table for active account
- Writes `sc_users` directly via Supabase client
- Updates `reps.sc_ids`
- Sends notification email via worker `/send-invite` with `type: 'rep_assigned'`
- Deep link in email: `app.neurata.ai/?sc=EPS9048`

### Invite Link Handling (existing user clicks invite)
- If logged in + rep invite → silently connect SC, proceed to app
- If not logged in + account exists → show login with message
- If not logged in + no account → show signup screen

---

## 9. Worker API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/ai` | POST | Proxy to Anthropic, with usage tracking |
| `/register` | POST | Create brokerage+user+metadata via service key |
| `/brokerage-exists` | POST | Pre-signup existence check (anon) |
| `/send-invite` | POST | Send all invitation/notification emails |
| `/send-welcome` | POST | Send welcome email after signup |
| `/send-activation-confirmed` | POST | Subscription confirmation email |
| `/contact` | POST | Marketing site demo request form |
| `/bcfsa-lookup` | POST | BCFSA registry scrape |
| `/extract-document` | POST | PDF/doc text extraction |
| `/stripe/*` | Various | Stripe subscription management |
| `/index-document` | POST | Document indexing for StrataSphere |

---

## 10. AI System Prompts & Logic

### StrataSphere Local
```
"You are StrataSphere, the AI governance assistant for [SC Plan].
You are the authoritative source of truth for this strata corporation.
Answer questions using ONLY the data provided below about this corporation,
plus your knowledge of BC legislation: SPA, RESA, PIPA, REDMA, BCFSA rules,
SPABC guidance, and CHOA resources.
Never invent, extrapolate, or assume SC-specific facts not explicitly present
in the data below. If the information is not there, say so in one sentence.
Do not speculate or fill gaps with plausible-sounding details.
A candid 'that information is not in the record' is always better than a
confident wrong answer.
Plain prose only — no markdown, no bullet dashes, no asterisks."
```

Context: `buildLssContext(sc)` — SC identity, reps, council, full decision ledger, meeting history, all document text (50k char/doc cap)

### StrataSphere Global
```
"You are StrataSphere Global, the platform-wide AI governance intelligence.
You have: (1) complete record of the local SC, (2) anonymized PII-stripped
data from ALL SCs on the platform.
BC legislation knowledge: SPA, RESA, PIPA, REDMA, BCFSA, SPABC, CHOA.
Never invent, extrapolate, or assume facts not explicitly present in the data.
If the specific information is not in the data provided, say exactly that —
one sentence, no speculation, no hedged guesses.
A confident wrong answer is worse than a candid 'I don't have that information.'
Plain prose only — no markdown, no bullet dashes, no asterisks."
```

Context: LSS context + `buildGssContext()` — PII-stripped decisions/meetings/docs from ALL SCs + SA global KB docs

### PII Stripping for GSS
Applied to all cross-SC data: emails, phones, SINs, credit cards, names (Title Case sequences), BC plates, insurance numbers. Strata lot numbers (SL 042) preserved as public record. Governance terms whitelisted.

### Meeting Mode StrataSphere
```
"[ATTACHMENT CONTENT — PRIORITY CONTEXT FIRST]
You are StrataSphere operating inside an active meeting.
Current agenda item: [item].
[If attachments:] Full content provided above as PRIORITY CONTEXT.
Answer using SC data AND BC legislation. Cite specific bylaws/decisions.
Be concise — 2-4 sentences maximum. Direct facts only, no preamble.
Plain prose, no markdown. If uncertain, say so in one sentence."
```

**Key:** Attachment content is injected BEFORE the system prompt. Model sees it first.
Web search (`web_search_20250305`) enabled for current legislation lookups.

### Minutes Generation
```
"Expert strata property manager writing BC strata minutes.
VOICE: Neutral, factual, past tense, third person (never 'we').
PATTERNS: 'The council reviewed...', 'The council received the report...'
AVOID: 'talked about', 'went over', opinion/commentary.
No motion text. 1-2 sentences maximum. No markdown. 
Refer to owners by strata lot number only (e.g. SL 061), never by name."
```
max_tokens: 150

### AI Usage Limits (enforced in worker)
```javascript
ss_local:  200  // queries/SC/month (paid)
ss_global: 400  // queries/brokerage/month (paid)
mm_ai:     100  // MM AI calls/SC/month
ss_trial:   10  // SS queries/SC during free trial
```
Warning at 80%. Hard block at 100%.
Tracked in `public.ai_usage` table.

---

## 11. Email Flows (Mailtrap)

### Configuration
- **Testing inbox:** `sandbox.api.mailtrap.io/api/send/4589430` — for development
- **Live sending:** `send.api.mailtrap.io/api/send` — uses `MAILTRAP_SEND_KEY`
- **From:** `info@neurata.ai`
- **Domain:** verified in Mailtrap, DNS records in Cloudflare
- **Logo in emails:** Always use PNG — `https://sozghbobflcjrfsmewxv.supabase.co/storage/v1/object/public/public-assets/neurata-logos/NeurataLogoOrangeWhite.png` — email clients block SVG

### Email Types (all via `/send-invite` or `/contact`)
| Type | Trigger | Recipient |
|---|---|---|
| `rep_invite` | MB invites inactive rep | Rep |
| `rep_assigned` | MB assigns active rep to SC | Rep — deep link `app.neurata.ai/?sc=PLAN` |
| `delegate` | Council delegate invited | Delegate |
| `asst_invite` | Assistant invited | Assistant |
| `activation_request` | MB requests subscription change | SA (`info@neurata.ai`) |
| `send-welcome` | New user signup complete | New user |
| `contact` | Marketing site form | `info@neurata.ai` + user gets Calendly email |
| Calendly confirmation | After contact form | Submitter — links to `calendly.com/neurata/demo` |

### Gmail Promotions Avoidance
- Use personal-style sender name ("Jeremy at Neurata")
- Plain text link instead of big CTA button for transactional emails
- `category: transactional` in Mailtrap payload
- Good text/HTML ratio
- No `<table>` layout for transactional emails

---

## 12. Stripe Integration

### Products & Price IDs
```javascript
mm:       'price_1TRJQ9DoAu5fJf3RnzanQfPU'  // Meeting Mode base $39/SC/month
local_ss: 'price_1TRJScDoAu5fJf3R2vQLLuv2'  // Local SS +$1.49/lot/month
global_ss:'price_1TRJP6DoAu5fJf3RrSp5CbMN'  // Global SS +$2.49/lot/month
```

### Subscription Flow
1. MB requests activation → writes to `activation_requests` table
2. SA approves in SA dashboard → worker creates Stripe subscription
3. Proration handled for mid-month activations
4. Annual commitment enforced — cancellations take effect at end of commitment period
5. Subscription state stored on `strata_corps`: `is_subscribed`, `mm_activated_at`, `ss_tier`, `mm_pending_cancel`

---

## 13. Minutes Export

### .docx (via docx.js v8.5.0 from jsDelivr CDN)
- Font: Arial on all Runs + document default style
- Left-aligned letterhead: brokerage name + address + phone
- SM: always from `sc_.smName`/`sc_.smLic` — never logged-in user
- Footer: Word footer section with page X of Y using `docx.PageNumber.CURRENT` / `docx.PageNumber.TOTAL_PAGES`
- Empty categories skipped (e.g. OPENING with only Call to Order)
- ADJOURNMENT category skipped in loop, handled separately after

### PDF
- Opens print popup (`window.open`) with `window.print()` auto-triggered
- User selects "Save as PDF" in print dialog
- Full styled HTML with print CSS

### Minutes Flow
- **Draft** → Meetings tab only: Edit Minutes + Export Draft + Finalize buttons
- **Final** → Minutes tab only: Export .docx + Export .pdf buttons
- Finalization is one-way (no unfinalize) — strata minutes are legal documents

### Time Formatting
All times via `fmt12hr()` helper — converts `19:00` → `7:00 PM PDT`

---

## 14. Key Design Decisions & Hard Lessons

### RLS is the Silent Killer
When data seems to be missing, check RLS first. Users can query tables but get 0 rows silently if RLS blocks them. Common pattern: write a SQL query in the Supabase editor AS a specific user to verify.

### JWT Timing
New users don't have JWT `app_metadata` immediately after signup. Always use worker `/register` with service key for brokerage/user creation. Call `refreshSession()` before `launchPlatform()`.

### Self-Referential RLS is Deadly
`sc_id IN (SELECT sc_id FROM sc_users WHERE user_id = auth.uid())` on `sc_users` itself causes infinite recursion. Fixed by: `sc_id IN (SELECT plan_number FROM strata_corps WHERE brokerage_id = jwt_brokerage_id())`.

### SM Source of Truth
`strata_corps.sm_lic` is the ONLY source of truth for who the Strata Manager is. Never use `repUserIds` or `APP.currentUser` to determine SM display. Resolve `smName` synchronously in the main Promise.all before `launchPlatform()` fires.

### Async Timing
`repUserIds` (from `sc_users`) is populated async after `launchPlatform`. Don't rely on it for initial render. Either: (a) include the lookup in the main Promise.all, or (b) make the render function self-fetch if data is missing.

### Single-File Architecture
The entire app is one HTML file (~15,000 lines). Before every code change:
1. Syntax check: `node --check` on extracted scripts
2. Div balance check: open/close `<div>` count must match (559/559)
3. Duplicate function check

### Fire-and-Forget is Dangerous
Early versions had `sc_users` and `reps` writes as fire-and-forget. This caused invite flows to silently fail. All critical DB writes now go through the worker with proper error handling.

### SVG in Email
All email clients (Gmail, Outlook, Apple Mail) block SVG images. Always use PNG for email logos.

### docx.js Page Numbers
`docx.PageNumber.CURRENT` and `docx.PageNumber.TOTAL_PAGES` — these are the correct field references in docx.js v8.5.0.

---

## 15. App Architecture — Key Functions

### SC Load Path
1. `loadUserProfile(userId)` → fetches user + brokerage from DB
2. Fetches SCs accessible to user (via `strata_corps` or `sc_users`)
3. Resolves `smName` for all SCs by querying `users` table for `sm_lic` values
4. Main `Promise.all` fetches: meetings, decisions, council, documents, SM users
5. Async follow-up: `sc_users` (all types) → populates `repUserIds`
6. `launchPlatform()` → shows dashboard

### Key APP State
```javascript
APP.currentUser = { id, name, legalName, lic, email, role, initials, brkLic, brkName }
APP.brokerage   = { name, lic, addr, phone, _activeLics, docs }
APP.sc          = [ { id, plan, name, smLic, smName, repIds, repUserIds, meetings, decisions, ... } ]
APP.reps        = [ { name, lic, title, role, sc_ids, status } ]
```

### Roles & canManage
```javascript
var canManage = role === 'Managing Broker' || role === 'Associate Broker'
  || (role === 'Representative' && APP.currentUser.lic === s.smLic);
var canSetSM = role === 'Managing Broker' || role === 'Associate Broker';
```

### Active/Inactive Status
`APP.brokerage._activeLics` — cached array of lics with active accounts, populated by querying `users` table. Fetched during SC load. Cleared on sync.

---

## 16. Style Guide (App)

### CSS Variables
```css
--org: #F97316      /* Neurata orange — primary accent */
--org-l: #FED7AA    /* Orange light */
--org-d: #C2410C    /* Orange dark */
--ch: #111827       /* Primary text */
--ch2: #374151      /* Secondary text */
--g4: #9CA3AF       /* Muted text */
--red: #EF4444      /* Danger */
--grn: #22C55E      /* Success */
--bg: #F9FAFB       /* Page background */
--g1: #F3F4F6       /* Card background */
--g2: #E5E7EB       /* Border */
```

### Key CSS Classes
- `.btn` — base button
- `.btn.pri` — orange primary button
- `.btn.grn` — green button
- `.btn.red` — red button
- `.btn.xs/.sm` — size variants
- `.tag.grn/.gy/.amb` — status pills
- `.card` — card container
- `.cb` — card body
- `.ch_` — card header

### Marketing Site (`index_v3.html`)
Dark hero + alternating light/dark sections:
- Dark: `#0B1020` (hero, problem, firms, CTA)
- Light: `#F8F7F4` / `#FFFFFF` (product, compare, thesis)
- Accent: `#F97316` (Neurata orange)
- Font: Inter Tight (headlines) + Inter (body)
- Pillar numbers: `opacity: 0.5`

---

## 17. Privacy, PIPA, and PIPEDA Compliance

### Data Residency
All data stored in Canada (Supabase Canada region).

### PII in StrataSphere
- Local SS: full data including names (only accessible to brokerage users)
- Global SS: all names, emails, phones, SINs stripped. Strata lot numbers (SL 042) preserved as public LTSA records.
- Meeting minutes: owners referred to by strata lot number only, never by name

### PIPA Obligations
- Consent required for personal information collection
- Access and correction rights for individuals
- Retention limits: account data 30 days after termination, billing 7 years, AI logs 12 months
- Right to deletion

### Compliance Headers in AI Prompt
All SS contexts include reference to PIPA compliance. MM StrataSphere UI shows "PIPA-compliant" label.

---

## 18. Cloudflare Worker Format

The worker uses **Service Worker format** (NOT ES Module format):
```javascript
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event));
});

async function handleRequest(request, event) {
  const url = new URL(request.url);
  // use url.pathname and request — NOT path and req
  CORS = getCORS(request);
  ...
}
```

Secrets injected as globals. Access as: `typeof MAILTRAP_SEND_KEY !== 'undefined' && MAILTRAP_SEND_KEY`

CORS allowed origins:
```javascript
'https://app.neurata.ai',
'https://neurata.ai',
'https://www.neurata.ai',
'https://appdev.neurata.ai',
'http://localhost:3000',
'http://localhost:5173',
```

---

## 19. Super Admin (SA) View

SA account (Jeremy McCarron) can impersonate any brokerage via `adminEnterBrokerage(brkLic)`.
SA dashboard at `/` shows all brokerages, MRR, subscription counts.
SA can manage trials, approve activation requests, sync brokerages.
SA JWT has `role: 'Super Admin'` in app_metadata. `jwt_is_sa()` returns true.

---

## 20. Pending / Planned Features

### Zoom Integration (Phase order agreed)
1. Zoom meeting link auto-generation when creating a meeting
2. Post-meeting attendance import via webhook
3. Vote counting via polls
4. Transcript → minutes automation (the transformative feature)

Architecture decision: OAuth app (not Server-to-Server) — supports any SM's Zoom account.
Hard problem: Zoom display name → strata lot number mapping.

### Other Pending
- Playwright CI re-enable after test accounts seeded
- Distribute Minutes — placeholder only
- RTF export font (still shows Times New Roman in some Word versions — low priority)
- Server-side PDF rendering via Puppeteer/Worker for proper PDF download (vs print dialog)

---

## 21. Sanity Check Commands

Run after every significant change before building:
```python
# Syntax check
import re, subprocess, tempfile, os
with open('neurata_dev.html', 'r') as f:
    content = f.read()
scripts = re.findall(r'<script(?![^>]*src)[^>]*>(.*?)</script>', content, re.DOTALL)
combined = '\n'.join(scripts)
with tempfile.NamedTemporaryFile(suffix='.js', mode='w', delete=False) as tmp:
    tmp.write(combined)
    tmpname = tmp.name
r = subprocess.run(['node', '--check', tmpname], capture_output=True, text=True)
print(r.stdout or 'OK', r.stderr or '')
os.unlink(tmpname)

# Div balance
scripts_full = re.findall(r'<script[^>]*>.*?</script>', content, re.DOTALL)
html_only = content
for s in scripts_full: html_only = html_only.replace(s, '')
opens = len(re.findall(r'<div\b', html_only))
closes = len(re.findall(r'</div>', html_only))
print(f'Divs: {opens}/{closes}')  # Should be 559/559

# Duplicate functions
from collections import Counter
fn_names = re.findall(r'^function (\w+)', combined, re.MULTILINE)
dupes = {k:v for k,v in Counter(fn_names).items() if v > 1}
print('Dupes:', dupes if dupes else 'None')
```

---

## 22. Contact & Accounts

- **Calendly:** https://calendly.com/neurata/demo
- **Support email:** support@neurata.ai
- **Info email:** info@neurata.ai
- **Marketing site:** neurata.ai
- **App (prod):** app.neurata.ai
- **App (dev):** appdev.neurata.ai
- **Worker (prod):** api.neurata.ai → neurata-worker
- **Worker (dev):** api-dev.neurata.ai → neurata-api-dev
- **Supabase prod:** sozghbobflcjrfsmewxv.supabase.co
- **Supabase dev:** dzurctohotgtummajgiw.supabase.co
- **Mailtrap sandbox inbox ID:** 4589430
- **Mailtrap sending token:** ends in `cc32` (rotated — get current from Cloudflare secrets)

-- ══════════════════════════════════════════════════════════════
-- NEURATA DEV — SAFE CLEAN SWEEP
-- Preserves: SA user, ADMIN brokerage, NEURATA_GLOBAL KB docs,
--            storage buckets (untouched — script is DB only)
-- Wipes: all BROs, REPs, SCs, meetings, users, auth accounts
-- ══════════════════════════════════════════════════════════════

-- 1. Activity / usage
DELETE FROM public.ai_usage;
DELETE FROM public.ss_conversations;
DELETE FROM public.activation_requests;

-- 2. Meeting data
DELETE FROM public.decisions;
DELETE FROM public.meetings;

-- 3. SC membership & structure
DELETE FROM public.council_members;
DELETE FROM public.strata_lots;
DELETE FROM public.sc_users;

-- 4. Documents — preserve NEURATA_GLOBAL KB only
DELETE FROM public.documents WHERE sc_id != 'NEURATA_GLOBAL';

-- 5. Strata corps
DELETE FROM public.strata_corps;

-- 6. Billing
DELETE FROM public.invoices;
DELETE FROM public.subscriptions;

-- 7. Reps
DELETE FROM public.reps;

-- 8. Users — preserve dev SA
DELETE FROM public.users
WHERE id != '8ac863f4-1d5e-483a-96e8-1b0e919a6f82';

-- 9. Brokerages — preserve ADMIN
DELETE FROM public.brokerages
WHERE bcfsa_lic != 'ADMIN';

-- 10. Auth users — preserve dev SA
DELETE FROM auth.users
WHERE id != '8ac863f4-1d5e-483a-96e8-1b0e919a6f82';

-- ── Verify ────────────────────────────────────────────────────
SELECT 'brokerages'      AS table_name, count(*) AS rows FROM public.brokerages
UNION ALL SELECT 'users',              count(*) FROM public.users
UNION ALL SELECT 'auth.users',         count(*) FROM auth.users
UNION ALL SELECT 'strata_corps',       count(*) FROM public.strata_corps
UNION ALL SELECT 'reps',               count(*) FROM public.reps
UNION ALL SELECT 'meetings',           count(*) FROM public.meetings
UNION ALL SELECT 'documents (KB)',     count(*) FROM public.documents WHERE sc_id = 'NEURATA_GLOBAL'
UNION ALL SELECT 'documents (total)',  count(*) FROM public.documents;

-- Expected:
-- brokerages     = 1  (ADMIN only)
-- users          = 1  (SA only)
-- auth.users     = 1  (SA only)
-- strata_corps   = 0
-- reps           = 0
-- meetings       = 0
-- documents (KB) = N  (your KB docs, untouched)
-- documents (total) = same N

-- ══════════════════════════════════════════════════════════════
-- POST-SWEEP CHECKLIST
-- The sweep only touches DB tables. After running:
--
-- 1. Storage buckets (Supabase Storage dashboard):
--    - neurata-documents: manually delete contents of sc-docs/ folder
--    - user-assets: manually delete contents of avatars/ and logos/ folders
--    - public-assets: DO NOT TOUCH (logos live here)
--
-- 2. Storage policies are preserved across sweeps (they're not rows).
--    No action needed unless you recreated a bucket from scratch.
--
-- 3. Sign up fresh accounts in this order:
--    a. MB (new brokerage) → triggers brokerage upsert
--    b. Invite SM via Brokerage page → invite flow
--    c. SM signs up via invite link
--
-- 4. KB documents in neurata-documents/education/ are untouched.
--    Re-upload via SA Dashboard → Knowledge Base if needed.
-- ══════════════════════════════════════════════════════════════

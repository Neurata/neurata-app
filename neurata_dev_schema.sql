-- ============================================================
-- NEURATA DEV SCHEMA
-- Run this entire script in the dev Supabase SQL editor
-- Generated from production snapshot
-- ============================================================


-- ── 0. EXTENSIONS ────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ── 1. HELPER FUNCTIONS (must exist before RLS policies) ─────

CREATE OR REPLACE FUNCTION public.jwt_role()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    auth.jwt() -> 'app_metadata' ->> 'role',
    auth.jwt() ->> 'role',
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.jwt_brokerage_id()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(
    coalesce(
      auth.jwt() -> 'app_metadata' ->> 'brokerage_id',
      auth.jwt() ->> 'brokerage_id'
    ), ''
  );
$$;

CREATE OR REPLACE FUNCTION public.jwt_is_sa()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT jwt_role() = 'Super Admin';
$$;





CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_user_metadata()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data = raw_app_meta_data ||
    jsonb_build_object('brokerage_id', NEW.brokerage_id, 'role', NEW.role)
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_brk_lic text;
  v_lic text;
  v_name text;
  v_role text;
  v_sc_id text;
BEGIN
  v_brk_lic := COALESCE(NEW.raw_user_meta_data->>'brokerage_id', '');
  v_lic     := COALESCE(NEW.raw_user_meta_data->>'bcfsa_lic', '');
  v_name    := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_role    := COALESCE(NEW.raw_user_meta_data->>'role', 'Representative');
  v_sc_id   := COALESCE(NEW.raw_user_meta_data->>'sc_id', '');
  IF v_name = '' AND v_lic = '' AND v_brk_lic = '' THEN RETURN NEW; END IF;
  INSERT INTO public.users (id, email, full_name, bcfsa_lic, role, brokerage_id)
  VALUES (NEW.id, NEW.email, v_name, v_lic, v_role, v_brk_lic)
  ON CONFLICT (id) DO UPDATE SET
    full_name    = EXCLUDED.full_name,
    bcfsa_lic    = EXCLUDED.bcfsa_lic,
    role         = EXCLUDED.role,
    brokerage_id = EXCLUDED.brokerage_id;
  IF v_sc_id != '' THEN
    INSERT INTO public.sc_users (sc_id, user_id, access_type)
    VALUES (v_sc_id, NEW.id, 'rep')
    ON CONFLICT (sc_id, user_id) DO NOTHING;
    INSERT INTO public.reps (brokerage_id, bcfsa_lic, name, sc_ids)
    VALUES (v_brk_lic, v_lic, v_name, json_build_array(v_sc_id)::text)
    ON CONFLICT (brokerage_id, bcfsa_lic) DO UPDATE SET
      sc_ids = EXCLUDED.sc_ids,
      name   = EXCLUDED.name;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger LANGUAGE plpgsql AS $$
DECLARE cmd record;
BEGIN
  FOR cmd IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
    IF cmd.schema_name IS NOT NULL
      AND cmd.schema_name IN ('public')
      AND cmd.schema_name NOT IN ('pg_catalog','information_schema')
      AND cmd.schema_name NOT LIKE 'pg_toast%'
      AND cmd.schema_name NOT LIKE 'pg_temp%'
    THEN
      BEGIN
        EXECUTE format('ALTER TABLE IF EXISTS %s ENABLE ROW LEVEL SECURITY', cmd.object_identity);
      EXCEPTION WHEN OTHERS THEN
        RAISE LOG 'rls_auto_enable: failed on %', cmd.object_identity;
      END;
    END IF;
  END LOOP;
END;
$$;

-- Event trigger for auto RLS on new tables
DROP EVENT TRIGGER IF EXISTS rls_auto_enable_trigger;
CREATE EVENT TRIGGER rls_auto_enable_trigger ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();

-- Auth trigger: create user profile on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ── 2. TABLES ────────────────────────────────────────────────

-- brokerages
CREATE TABLE IF NOT EXISTS public.brokerages (
  bcfsa_lic          text PRIMARY KEY,
  name               text NOT NULL,
  address            text,
  phone              text,
  city               text,
  email              text,
  logo_url           text,
  docs               jsonb DEFAULT '[]'::jsonb,
  subscription_status text NOT NULL DEFAULT 'trial',
  trial_meetings_used integer NOT NULL DEFAULT 0,
  stripe_customer_id  text,
  billing_setup       boolean DEFAULT false,
  pay_method          text DEFAULT 'acss',
  payment_method_id   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- users
CREATE TABLE IF NOT EXISTS public.users (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        text UNIQUE,
  full_name    text,
  bcfsa_lic    text UNIQUE,
  role         text,
  brokerage_id text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

-- strata_corps
CREATE TABLE IF NOT EXISTS public.strata_corps (
  plan_number         text PRIMARY KEY,
  brokerage_id        text NOT NULL,
  name                text,
  lots                integer,
  address             text,
  sm_lic              text,
  is_subscribed       boolean DEFAULT false,
  ss_tier             text,
  stripe_subscription_id text,
  mm_activated_at     timestamptz,
  mm_pending_cancel   boolean DEFAULT false,
  ss_global_activated_at timestamptz,
  ss_pending_downgrade text,
  filed_year          integer,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- reps
CREATE TABLE IF NOT EXISTS public.reps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brokerage_id text NOT NULL,
  bcfsa_lic    text NOT NULL,
  name         text,
  role         text,
  email        text DEFAULT '',
  sc_id        text,
  sc_ids       text DEFAULT '[]',
  created_at   timestamptz DEFAULT now(),
  UNIQUE (brokerage_id, bcfsa_lic)
);

-- sc_users
CREATE TABLE IF NOT EXISTS public.sc_users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sc_id       text NOT NULL,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_type text DEFAULT 'rep',
  created_at  timestamptz DEFAULT now(),
  UNIQUE (sc_id, user_id)
);

-- meetings
CREATE TABLE IF NOT EXISTS public.meetings (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  sc_id             text NOT NULL,
  created_by        uuid,
  type              text NOT NULL,
  date              date NOT NULL,
  time              text,
  format            text,
  location          text,
  status            text NOT NULL DEFAULT 'DRAFT',
  agenda            jsonb,
  attendees         jsonb,
  actual_start_time text,
  adj_time          text,
  minutes_state     text,
  minutes_content   jsonb,
  tz                text DEFAULT 'America/Vancouver',
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- decisions
CREATE TABLE IF NOT EXISTS public.decisions (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  sc_id         text NOT NULL,
  meeting_id    uuid,
  item_text     text NOT NULL,
  motion_text   text,
  mover         text,
  seconder      text,
  outcome       text NOT NULL,
  votes_for     integer NOT NULL DEFAULT 0,
  votes_against integer NOT NULL DEFAULT 0,
  votes_abstain integer NOT NULL DEFAULT 0,
  meeting_date  date,
  meeting_type  text,
  source        text NOT NULL DEFAULT 'meeting-mode',
  summary       text,
  recorded_at   timestamptz NOT NULL DEFAULT now()
);

-- documents
CREATE TABLE IF NOT EXISTS public.documents (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  sc_id          text NOT NULL,
  name           text NOT NULL,
  source_label   text,
  source         text,
  mime_type      text,
  storage_path   text,
  meeting_id     uuid,
  uploaded_by    uuid,
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  public_url     text,
  document_text  text,
  doc_type       text,
  agenda_item_id text
);

-- council_members
CREATE TABLE IF NOT EXISTS public.council_members (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  sc_id            text NOT NULL,
  lot_number       text NOT NULL,
  full_name        text NOT NULL,
  email            text,
  council_role     text,
  is_council       boolean NOT NULL DEFAULT true,
  user_id          uuid,
  unit_entitlement numeric,
  owner_type       text,
  parking          text,
  storage          text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sc_id, lot_number)
);

-- strata_lots
CREATE TABLE IF NOT EXISTS public.strata_lots (
  sc_id      text NOT NULL,
  lot_number text NOT NULL,
  owner_name text,
  email      text,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (sc_id, lot_number)
);

-- ss_conversations
CREATE TABLE IF NOT EXISTS public.ss_conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  sc_id      text,
  title      text,
  messages   jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- activation_requests
CREATE TABLE IF NOT EXISTS public.activation_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brokerage_id   text NOT NULL,
  sc_id          text NOT NULL,
  requested_by   uuid,
  requester_name text,
  request_type   text NOT NULL,
  status         text DEFAULT 'pending',
  created_at     timestamptz DEFAULT now()
);

-- ai_usage
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brokerage_id  text,
  sc_id         text,
  user_id       uuid,
  usage_type    text,
  model         text,
  input_tokens  integer DEFAULT 0,
  output_tokens integer DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

-- invoices
CREATE TABLE IF NOT EXISTS public.invoices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brokerage_id  text,
  period_start  date,
  period_end    date,
  amount_cents  integer,
  status        text DEFAULT 'draft',
  pdf_url       text,
  emailed_at    timestamptz,
  created_at    timestamptz DEFAULT now()
);

-- subscriptions
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brokerage_id text,
  sc_id        text,
  plan         text,
  status       text,
  stripe_subscription_id text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);


-- is_super_admin references public.users so must come after table creation
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT role = 'Super Admin' FROM public.users WHERE id = auth.uid()),
    false
  );
$$;

-- Functions that reference public.users — must come after table creation
CREATE OR REPLACE FUNCTION public.current_brokerage_id()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT brokerage_id FROM public.users WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_my_brokerage_id()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    auth.jwt() -> 'app_metadata' ->> 'brokerage_id',
    auth.jwt() -> 'user_metadata' ->> 'brokerage_id'
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_brokerage_id()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE result text;
BEGIN
  SET LOCAL row_security = off;
  SELECT brokerage_id INTO result FROM public.users WHERE id = auth.uid();
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.auth_user_role()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE result text;
BEGIN
  SET LOCAL row_security = off;
  SELECT role INTO result FROM public.users WHERE id = auth.uid();
  RETURN result;
END;
$$;

-- ── 3. INDEXES ───────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ai_usage_brokerage    ON public.ai_usage (brokerage_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_sc           ON public.ai_usage (sc_id, created_at);
CREATE INDEX IF NOT EXISTS idx_decisions_sc          ON public.decisions (sc_id);
CREATE INDEX IF NOT EXISTS idx_decisions_meeting     ON public.decisions (meeting_id);
CREATE INDEX IF NOT EXISTS idx_decisions_outcome     ON public.decisions (outcome);
CREATE INDEX IF NOT EXISTS idx_documents_sc          ON public.documents (sc_id);
CREATE INDEX IF NOT EXISTS idx_meetings_sc           ON public.meetings (sc_id);
CREATE INDEX IF NOT EXISTS idx_meetings_date         ON public.meetings (date);
CREATE INDEX IF NOT EXISTS idx_meetings_status       ON public.meetings (status);
CREATE INDEX IF NOT EXISTS idx_sc_users_sc           ON public.sc_users (sc_id);
CREATE INDEX IF NOT EXISTS idx_sc_users_user         ON public.sc_users (user_id);
CREATE INDEX IF NOT EXISTS idx_strata_corps_brokerage ON public.strata_corps (brokerage_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_brok    ON public.subscriptions (brokerage_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_sc      ON public.subscriptions (sc_id);
CREATE INDEX IF NOT EXISTS idx_users_bcfsa_lic       ON public.users (bcfsa_lic);
CREATE INDEX IF NOT EXISTS idx_users_brokerage       ON public.users (brokerage_id);
CREATE INDEX IF NOT EXISTS idx_users_email           ON public.users (email);


-- ── 4. ENABLE RLS ────────────────────────────────────────────

ALTER TABLE public.brokerages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strata_corps       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reps               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sc_users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decisions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.council_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strata_lots        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ss_conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions      ENABLE ROW LEVEL SECURITY;


-- ── 5. RLS POLICIES ──────────────────────────────────────────

-- brokerages
CREATE POLICY brokerages_select ON public.brokerages FOR SELECT USING (jwt_is_sa() OR bcfsa_lic = jwt_brokerage_id());
CREATE POLICY brokerages_insert ON public.brokerages FOR INSERT WITH CHECK (jwt_is_sa() OR bcfsa_lic = jwt_brokerage_id());
CREATE POLICY brokerages_update ON public.brokerages FOR UPDATE USING (jwt_is_sa() OR bcfsa_lic = jwt_brokerage_id());
CREATE POLICY brokerages_delete ON public.brokerages FOR DELETE USING (jwt_is_sa());

-- users
CREATE POLICY users_select ON public.users FOR SELECT USING (id = auth.uid() OR jwt_is_sa() OR brokerage_id = jwt_brokerage_id());
CREATE POLICY users_insert ON public.users FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY users_update ON public.users FOR UPDATE USING (id = auth.uid());
CREATE POLICY users_delete ON public.users FOR DELETE USING (id = auth.uid());

-- strata_corps
CREATE POLICY strata_corps_select ON public.strata_corps FOR SELECT USING (jwt_is_sa() OR brokerage_id = jwt_brokerage_id());
CREATE POLICY strata_corps_insert ON public.strata_corps FOR INSERT WITH CHECK (jwt_is_sa() OR brokerage_id = jwt_brokerage_id());
CREATE POLICY strata_corps_update ON public.strata_corps FOR UPDATE USING (jwt_is_sa() OR brokerage_id = jwt_brokerage_id() OR plan_number IN (SELECT sc_id FROM sc_users WHERE user_id = auth.uid()));
CREATE POLICY strata_corps_delete ON public.strata_corps FOR DELETE USING (jwt_is_sa() OR brokerage_id = jwt_brokerage_id());

-- reps
CREATE POLICY reps_select ON public.reps FOR SELECT USING (jwt_is_sa() OR brokerage_id = jwt_brokerage_id());
CREATE POLICY reps_insert ON public.reps FOR INSERT WITH CHECK (jwt_is_sa() OR brokerage_id = jwt_brokerage_id());
CREATE POLICY reps_update ON public.reps FOR UPDATE USING (jwt_is_sa() OR brokerage_id = jwt_brokerage_id());
CREATE POLICY reps_delete ON public.reps FOR DELETE USING (jwt_is_sa() OR brokerage_id = jwt_brokerage_id());

-- sc_users
CREATE POLICY sc_users_select ON public.sc_users FOR SELECT USING (jwt_is_sa() OR user_id = auth.uid() OR jwt_role() = ANY(ARRAY['Managing Broker','Associate Broker']));
CREATE POLICY sc_users_insert ON public.sc_users FOR INSERT WITH CHECK (jwt_is_sa() OR user_id = auth.uid());
CREATE POLICY sc_users_update ON public.sc_users FOR UPDATE USING (jwt_is_sa() OR user_id = auth.uid());
CREATE POLICY sc_users_delete ON public.sc_users FOR DELETE USING (jwt_is_sa() OR user_id = auth.uid());

-- meetings
CREATE POLICY meetings_select ON public.meetings FOR SELECT USING (jwt_is_sa() OR sc_id IN (SELECT plan_number FROM strata_corps WHERE brokerage_id = jwt_brokerage_id()) OR sc_id IN (SELECT sc_id FROM sc_users WHERE user_id = auth.uid()));
CREATE POLICY meetings_insert ON public.meetings FOR INSERT WITH CHECK (jwt_is_sa() OR sc_id IN (SELECT plan_number FROM strata_corps WHERE brokerage_id = jwt_brokerage_id()) OR sc_id IN (SELECT sc_id FROM sc_users WHERE user_id = auth.uid()));
CREATE POLICY meetings_update ON public.meetings FOR UPDATE USING (jwt_is_sa() OR sc_id IN (SELECT plan_number FROM strata_corps WHERE brokerage_id = jwt_brokerage_id()) OR sc_id IN (SELECT sc_id FROM sc_users WHERE user_id = auth.uid()));
CREATE POLICY meetings_delete ON public.meetings FOR DELETE USING (jwt_is_sa() OR sc_id IN (SELECT plan_number FROM strata_corps WHERE brokerage_id = jwt_brokerage_id()));

-- decisions
CREATE POLICY decisions_select ON public.decisions FOR SELECT USING (jwt_is_sa() OR sc_id IN (SELECT plan_number FROM strata_corps WHERE brokerage_id = jwt_brokerage_id()) OR sc_id IN (SELECT sc_id FROM sc_users WHERE user_id = auth.uid()));
CREATE POLICY decisions_insert ON public.decisions FOR INSERT WITH CHECK (jwt_is_sa() OR sc_id IN (SELECT plan_number FROM strata_corps WHERE brokerage_id = jwt_brokerage_id()) OR sc_id IN (SELECT sc_id FROM sc_users WHERE user_id = auth.uid()));
CREATE POLICY decisions_update ON public.decisions FOR UPDATE USING (jwt_is_sa() OR sc_id IN (SELECT plan_number FROM strata_corps WHERE brokerage_id = jwt_brokerage_id()));
CREATE POLICY decisions_delete ON public.decisions FOR DELETE USING (jwt_is_sa() OR sc_id IN (SELECT plan_number FROM strata_corps WHERE brokerage_id = jwt_brokerage_id()));

-- documents
CREATE POLICY documents_select ON public.documents FOR SELECT USING (jwt_is_sa() OR sc_id IN (SELECT plan_number FROM strata_corps WHERE brokerage_id = jwt_brokerage_id()) OR sc_id IN (SELECT sc_id FROM sc_users WHERE user_id = auth.uid()) OR sc_id = 'NEURATA_GLOBAL');
CREATE POLICY documents_insert ON public.documents FOR INSERT WITH CHECK (jwt_is_sa() OR sc_id IN (SELECT plan_number FROM strata_corps WHERE brokerage_id = jwt_brokerage_id()) OR sc_id IN (SELECT sc_id FROM sc_users WHERE user_id = auth.uid()));
CREATE POLICY documents_update ON public.documents FOR UPDATE USING (jwt_is_sa() OR sc_id IN (SELECT plan_number FROM strata_corps WHERE brokerage_id = jwt_brokerage_id()) OR sc_id IN (SELECT sc_id FROM sc_users WHERE user_id = auth.uid()));
CREATE POLICY documents_delete ON public.documents FOR DELETE USING (jwt_is_sa() OR sc_id IN (SELECT plan_number FROM strata_corps WHERE brokerage_id = jwt_brokerage_id()));

-- council_members
CREATE POLICY council_members_select ON public.council_members FOR SELECT USING (jwt_is_sa() OR sc_id IN (SELECT plan_number FROM strata_corps WHERE brokerage_id = jwt_brokerage_id()) OR sc_id IN (SELECT sc_id FROM sc_users WHERE user_id = auth.uid()));
CREATE POLICY council_members_insert ON public.council_members FOR INSERT WITH CHECK (jwt_is_sa() OR sc_id IN (SELECT plan_number FROM strata_corps WHERE brokerage_id = jwt_brokerage_id()) OR sc_id IN (SELECT sc_id FROM sc_users WHERE user_id = auth.uid()));
CREATE POLICY council_members_update ON public.council_members FOR UPDATE USING (jwt_is_sa() OR sc_id IN (SELECT plan_number FROM strata_corps WHERE brokerage_id = jwt_brokerage_id()) OR sc_id IN (SELECT sc_id FROM sc_users WHERE user_id = auth.uid()));
CREATE POLICY council_members_delete ON public.council_members FOR DELETE USING (jwt_is_sa() OR sc_id IN (SELECT plan_number FROM strata_corps WHERE brokerage_id = jwt_brokerage_id()));

-- strata_lots
CREATE POLICY strata_lots_select ON public.strata_lots FOR SELECT USING (jwt_is_sa() OR sc_id IN (SELECT plan_number FROM strata_corps WHERE brokerage_id = jwt_brokerage_id()) OR sc_id IN (SELECT sc_id FROM sc_users WHERE user_id = auth.uid()));
CREATE POLICY strata_lots_insert ON public.strata_lots FOR INSERT WITH CHECK (jwt_is_sa() OR sc_id IN (SELECT plan_number FROM strata_corps WHERE brokerage_id = jwt_brokerage_id()));
CREATE POLICY strata_lots_update ON public.strata_lots FOR UPDATE USING (jwt_is_sa() OR sc_id IN (SELECT plan_number FROM strata_corps WHERE brokerage_id = jwt_brokerage_id()));
CREATE POLICY strata_lots_delete ON public.strata_lots FOR DELETE USING (jwt_is_sa() OR sc_id IN (SELECT plan_number FROM strata_corps WHERE brokerage_id = jwt_brokerage_id()));

-- ss_conversations
CREATE POLICY ss_conversations_select ON public.ss_conversations FOR SELECT USING (jwt_is_sa() OR user_id = auth.uid());
CREATE POLICY ss_conversations_insert ON public.ss_conversations FOR INSERT WITH CHECK (jwt_is_sa() OR user_id = auth.uid());
CREATE POLICY ss_conversations_update ON public.ss_conversations FOR UPDATE USING (jwt_is_sa() OR user_id = auth.uid());
CREATE POLICY ss_conversations_delete ON public.ss_conversations FOR DELETE USING (jwt_is_sa() OR user_id = auth.uid());

-- activation_requests
CREATE POLICY activation_requests_select ON public.activation_requests FOR SELECT USING (jwt_is_sa() OR brokerage_id = jwt_brokerage_id());
CREATE POLICY activation_requests_insert ON public.activation_requests FOR INSERT WITH CHECK (jwt_is_sa() OR brokerage_id = jwt_brokerage_id());
CREATE POLICY activation_requests_update ON public.activation_requests FOR UPDATE USING (jwt_is_sa());

-- ai_usage
CREATE POLICY ai_usage_select ON public.ai_usage FOR SELECT USING (jwt_is_sa());
CREATE POLICY ai_usage_insert ON public.ai_usage FOR INSERT WITH CHECK (jwt_is_sa());

-- invoices
CREATE POLICY invoices_select ON public.invoices FOR SELECT USING (jwt_is_sa() OR brokerage_id = jwt_brokerage_id());
CREATE POLICY invoices_insert ON public.invoices FOR INSERT WITH CHECK (jwt_is_sa());

-- subscriptions
CREATE POLICY subscriptions_select ON public.subscriptions FOR SELECT USING (jwt_is_sa() OR brokerage_id = jwt_brokerage_id());
CREATE POLICY subscriptions_insert ON public.subscriptions FOR INSERT WITH CHECK (jwt_is_sa() OR brokerage_id = jwt_brokerage_id());
CREATE POLICY subscriptions_update ON public.subscriptions FOR UPDATE USING (jwt_is_sa() OR brokerage_id = jwt_brokerage_id());
CREATE POLICY subscriptions_delete ON public.subscriptions FOR DELETE USING (jwt_is_sa());


-- ── 6. TRIGGERS ──────────────────────────────────────────────

CREATE TRIGGER brokerages_updated_at      BEFORE UPDATE ON public.brokerages      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER council_members_updated_at BEFORE UPDATE ON public.council_members FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER meetings_updated_at        BEFORE UPDATE ON public.meetings         FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER strata_corps_updated_at    BEFORE UPDATE ON public.strata_corps     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER subscriptions_updated_at   BEFORE UPDATE ON public.subscriptions    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER users_updated_at           BEFORE UPDATE ON public.users            FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER sync_user_metadata_trigger
  AFTER INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION sync_user_metadata();


-- ── 7. SUPER ADMIN SEED ──────────────────────────────────────
-- Run this AFTER creating your SA user account via Supabase Auth dashboard.
-- Replace the UUID below with the actual user ID from auth.users.
--
-- UPDATE auth.users
-- SET raw_app_meta_data = raw_app_meta_data || '{"role":"Super Admin","brokerage_id":"ADMIN"}'::jsonb
-- WHERE id = 'YOUR-SA-USER-UUID-HERE';
--
-- INSERT INTO public.users (id, email, full_name, role, brokerage_id)
-- VALUES ('YOUR-SA-USER-UUID-HERE', 'your@email.com', 'Your Name', 'Super Admin', 'ADMIN')
-- ON CONFLICT (id) DO UPDATE SET role = 'Super Admin', brokerage_id = 'ADMIN';
--
-- INSERT INTO public.brokerages (bcfsa_lic, name, subscription_status)
-- VALUES ('ADMIN', 'Neurata Admin', 'active')
-- ON CONFLICT (bcfsa_lic) DO NOTHING;


-- ── 8. STORAGE BUCKETS & POLICIES ────────────────────────────
-- Buckets cannot be created via SQL editor — create them in the Supabase
-- Storage dashboard with these settings:
--
--   neurata-documents  → Private, 20MB limit
--   user-assets        → Public,  2MB limit
--   public-assets      → Public,  50MB limit
--
-- After creating buckets, run the storage policies below.
-- NOTE: Storage policies live in storage.objects, NOT in public schema.
-- They are NOT included in standard pg_dump output — must be run manually.

-- ── neurata-documents ─────────────────────────────────────────
CREATE POLICY "neurata_documents_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'neurata-documents'
  AND (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'Super Admin')
    OR left(name, position('/' in name) - 1) IN (
      SELECT replace(plan_number, ' ', '-') FROM public.strata_corps
      WHERE brokerage_id = jwt_brokerage_id()
      UNION
      SELECT replace(sc_id, ' ', '-') FROM public.sc_users
      WHERE user_id = auth.uid()
    )
  )
);

CREATE POLICY "neurata_documents_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'neurata-documents'
  AND (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'Super Admin')
    OR left(name, position('/' in name) - 1) IN (
      SELECT replace(plan_number, ' ', '-') FROM public.strata_corps
      WHERE brokerage_id = jwt_brokerage_id()
      UNION
      SELECT replace(sc_id, ' ', '-') FROM public.sc_users
      WHERE user_id = auth.uid()
    )
    OR left(name, position('/' in name) - 1) = 'education'
  )
);

CREATE POLICY "neurata_documents_update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'neurata-documents')
WITH CHECK (bucket_id = 'neurata-documents');

CREATE POLICY "neurata_documents_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'neurata-documents'
  AND (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'Super Admin')
    OR left(name, position('/' in name) - 1) IN (
      SELECT replace(plan_number, ' ', '-') FROM public.strata_corps
      WHERE brokerage_id = jwt_brokerage_id()
    )
  )
);

-- ── user-assets ───────────────────────────────────────────────
CREATE POLICY "user_assets_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'user-assets');

CREATE POLICY "user_assets_select"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'user-assets');

CREATE POLICY "user_assets_update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'user-assets')
WITH CHECK (bucket_id = 'user-assets');

CREATE POLICY "user_assets_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'user-assets');

-- ── public-assets ─────────────────────────────────────────────
CREATE POLICY "Allow authenticated uploads to public-assets"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'public-assets');

CREATE POLICY "Allow authenticated updates to public-assets"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'public-assets');


-- ── 9. ADDITIONAL COLUMNS (added post-initial-schema) ─────────
-- These columns were added after the initial schema was created.
-- Safe to run multiple times due to IF NOT EXISTS.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS photo_url             text,
  ADD COLUMN IF NOT EXISTS has_seen_onboarding   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_seen_billing_nudge boolean NOT NULL DEFAULT false;

-- Mark existing users as having seen onboarding so overlay doesn't fire for them
UPDATE public.users
  SET has_seen_onboarding = true
  WHERE created_at < NOW() - INTERVAL '1 minute';


-- ── 10. ai_usage RLS FIX ──────────────────────────────────────
-- Default policy only allows SA to read ai_usage.
-- Replace with policy that allows users to read their own usage.
DROP POLICY IF EXISTS "ai_usage_select" ON public.ai_usage;
CREATE POLICY "ai_usage_select"
ON public.ai_usage FOR SELECT TO authenticated
USING (jwt_is_sa() OR user_id = auth.uid() OR brokerage_id = jwt_brokerage_id());


-- ── 11. SUPER ADMIN SEED ──────────────────────────────────────
-- Run this AFTER creating your SA user account via Supabase Auth dashboard.
-- Replace the UUID and email below with the actual dev SA values.
--
-- UPDATE auth.users
-- SET raw_app_meta_data = raw_app_meta_data || '{"role":"Super Admin","brokerage_id":"ADMIN"}'::jsonb
-- WHERE id = '8ac863f4-1d5e-483a-96e8-1b0e919a6f82';
--
-- INSERT INTO public.users (id, email, full_name, role, brokerage_id)
-- VALUES ('8ac863f4-1d5e-483a-96e8-1b0e919a6f82', 'jeremy@trickfilm.com', 'Neurata Admin', 'Super Admin', 'ADMIN')
-- ON CONFLICT (id) DO UPDATE SET role = 'Super Admin', brokerage_id = 'ADMIN';
--
-- INSERT INTO public.brokerages (bcfsa_lic, name, subscription_status)
-- VALUES ('ADMIN', 'Neurata Admin', 'active')
-- ON CONFLICT (bcfsa_lic) DO NOTHING;


-- ============================================================
-- DONE. Verify with:
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
-- SELECT policyname, cmd, tablename FROM pg_policies WHERE schemaname IN ('public','storage') ORDER BY schemaname, tablename, cmd;
-- ============================================================

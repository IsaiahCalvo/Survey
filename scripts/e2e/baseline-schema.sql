-- scripts/e2e/baseline-schema.sql — pre-migration baseline for the LOCAL
-- signed-in E2E stack only (scripts/e2e-local-supabase.mjs).
--
-- The repo's migration chain cannot replay on a blank database: the
-- `projects`, `documents` and `templates` tables (and the private `documents`
-- storage bucket) were created by hand in the dashboard before the chain began,
-- so 20241223000002_create_usage_metrics.sql fails with
-- `relation "documents" does not exist`. The E2E stack copies this file in as
-- the FIRST migration of a throwaway workdir, ahead of every real migration.
--
-- It is NOT in supabase/migrations/ on purpose: `supabase db push` must never
-- see it. Columns here are only the ones that predate the chain (every later
-- column is added by a real migration with ADD COLUMN IF NOT EXISTS). Policies
-- are created by the real migrations; this file only enables RLS.

-- Production predates Supabase's switch to "no automatic Data API grants": a
-- table created in public there is granted to anon / authenticated /
-- service_role by default, and the chain only REVOKEs where it means to. The
-- pinned CLI's Postgres image no longer does that, so restore the old default
-- before any migration runs; the chain's own REVOKEs then apply as in prod.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  color       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.documents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id     UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  file_path      TEXT,
  file_size      BIGINT,
  page_count     INTEGER,
  last_opened_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Legacy tables that early migrations attach policies / counts to. The app no
-- longer reads them; they exist so the chain replays.
CREATE TABLE IF NOT EXISTS public.spaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  name        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.annotations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
  data        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dashboard-era trigger functions that 20260211224035_fix_function_search_path
-- and 20260702010000_security_advisor_hardening ALTER/GRANT by name. Their
-- production bodies are not in the repo; locally they are inert (attached to
-- nothing), which is all those migrations need.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.handle_user_update() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;
-- KAL-48 debugging helpers created by hand in production; 20260702010000
-- revokes/grants them by signature. Inert stand-ins.
CREATE OR REPLACE FUNCTION public.kal48_debug_probe(p_document_id UUID, p_step INTEGER)
RETURNS JSONB LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
CREATE OR REPLACE FUNCTION public.kal48_dump_access_fn()
RETURNS TEXT LANGUAGE sql AS $$ SELECT NULL::text $$;

CREATE INDEX IF NOT EXISTS projects_user_id_idx ON public.projects (user_id);
CREATE INDEX IF NOT EXISTS documents_user_id_idx ON public.documents (user_id);
CREATE INDEX IF NOT EXISTS documents_project_id_idx ON public.documents (project_id);
CREATE INDEX IF NOT EXISTS templates_user_id_idx ON public.templates (user_id);

ALTER TABLE public.projects  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spaces    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.projects, public.documents, public.templates, public.annotations,
  public.spaces, public.user_settings
  TO anon, authenticated, service_role;

-- Private bucket holding the PDFs (path: <owner user id>/<document id>.pdf).
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

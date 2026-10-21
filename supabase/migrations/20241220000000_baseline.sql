-- Baseline: the objects production had before the migration chain began.
--
-- The `projects`, `documents`, `templates`, `spaces` and `users` tables, the
-- auth.users sync triggers, the `documents` and `brand` storage buckets and a
-- few functions were created by hand in the dashboard, so the first real
-- migrations (20241221... onward) cannot run on a blank database. This file
-- recreates them as production defines them, so `supabase/migrations/` alone
-- builds a fresh database (local `supabase start`, the signed-in E2E stack,
-- preview branches).
--
-- Production already has every object here. This version was recorded as
-- applied there by hand (INSERT INTO supabase_migrations.schema_migrations),
-- and scripts/check-migration-order.mjs allows this one file to sort before
-- the newest migration. Every statement is still guarded or idempotent, so
-- running the file against production changes nothing.
--
-- Columns are only the ones that predate the chain; later migrations add the
-- rest with ADD COLUMN IF NOT EXISTS. Policies on the chain's own tables are
-- created by the chain.

-- Production predates Supabase's switch to "no automatic Data API grants":
-- a table created in public there is granted to anon / authenticated /
-- service_role by default, and the chain only REVOKEs where it means to.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- Tables that early migrations attach policies to but production has since
-- dropped by hand. Created only on a blank database (before `projects`
-- exists) so the chain replays; 20261021093000_fresh_database_parity.sql
-- drops them again.
DO $legacy$
BEGIN
  IF to_regclass('public.projects') IS NULL THEN
    CREATE TABLE IF NOT EXISTS public.user_settings (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
      settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
    CREATE TABLE IF NOT EXISTS public.annotations (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      document_id UUID,
      data        JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  END IF;
END;
$legacy$;

CREATE TABLE IF NOT EXISTS public.users (
  id               UUID NOT NULL PRIMARY KEY,
  avatar_url       TEXT,
  user_id          TEXT UNIQUE,
  token_identifier TEXT NOT NULL,
  image            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at       TIMESTAMPTZ,
  email            TEXT,
  name             TEXT,
  full_name        TEXT
);

CREATE TABLE IF NOT EXISTS public.projects (
  id          UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  color       VARCHAR(7),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.templates (
  id          UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  config      JSONB,
  file_path   VARCHAR(500),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  linked_excel_path TEXT,
  last_sync_time    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.documents (
  id             UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id     UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  template_id    UUID REFERENCES public.templates(id) ON DELETE SET NULL,
  name           VARCHAR(255) NOT NULL,
  description    TEXT,
  file_path      VARCHAR(500) NOT NULL,
  file_size      BIGINT,
  page_count     INTEGER,
  is_survey_mode BOOLEAN DEFAULT false,
  current_page   INTEGER DEFAULT 1,
  zoom_level     NUMERIC DEFAULT 100,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  last_opened_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.spaces (
  id          UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  color       VARCHAR(7),
  start_page  INTEGER NOT NULL,
  end_page    INTEGER NOT NULL,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  CHECK (start_page > 0 AND end_page >= start_page)
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON public.projects USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_templates_user_id ON public.templates USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_documents_project_id ON public.documents USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_spaces_document_id ON public.spaces USING btree (document_id);

ALTER TABLE public.users     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spaces    ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.users, public.projects, public.templates, public.documents, public.spaces
  TO anon, authenticated, service_role;

-- Dashboard-era policies the chain never recreates (it adds its own next to
-- them). 20260907213936_rls_uid_initplans later wraps auth.uid() in a SELECT.
DO $policies$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users' AND policyname = 'Users can view own data') THEN
    CREATE POLICY "Users can view own data" ON public.users
      FOR SELECT USING (auth.uid()::text = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'spaces' AND policyname = 'Users can view spaces for own documents') THEN
    CREATE POLICY "Users can view spaces for own documents" ON public.spaces
      FOR SELECT USING (EXISTS (SELECT 1 FROM public.documents
        WHERE documents.id = spaces.document_id AND documents.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'spaces' AND policyname = 'Users can insert spaces for own documents') THEN
    CREATE POLICY "Users can insert spaces for own documents" ON public.spaces
      FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.documents
        WHERE documents.id = spaces.document_id AND documents.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'spaces' AND policyname = 'Users can update spaces for own documents') THEN
    CREATE POLICY "Users can update spaces for own documents" ON public.spaces
      FOR UPDATE USING (EXISTS (SELECT 1 FROM public.documents
        WHERE documents.id = spaces.document_id AND documents.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'spaces' AND policyname = 'Users can delete spaces for own documents') THEN
    CREATE POLICY "Users can delete spaces for own documents" ON public.spaces
      FOR DELETE USING (EXISTS (SELECT 1 FROM public.documents
        WHERE documents.id = spaces.document_id AND documents.user_id = auth.uid()));
  END IF;
END;
$policies$;

-- Dashboard-era functions, with production's definitions.
-- 20260211224035_fix_function_search_path and
-- 20260702010000_security_advisor_hardening ALTER / GRANT them by name.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.users (
    id,
    user_id,
    email,
    name,
    full_name,
    avatar_url,
    token_identifier,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    NEW.id::text,
    NEW.email,
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.email,
    NEW.created_at,
    NEW.updated_at
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_user_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.users
  SET
    email = NEW.email,
    name = NEW.raw_user_meta_data->>'name',
    full_name = NEW.raw_user_meta_data->>'full_name',
    avatar_url = NEW.raw_user_meta_data->>'avatar_url',
    updated_at = NEW.updated_at
  WHERE user_id = NEW.id::text;
  RETURN NEW;
END;
$function$;

-- KAL-48 debugging helpers created by hand in production; 20260702010000
-- revokes / grants them by signature.
CREATE OR REPLACE FUNCTION public.kal48_debug_probe(p_document_id uuid, p_step integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_uid UUID;
    v_can BOOLEAN;
    v_next INTEGER;
    v_count INTEGER;
BEGIN
    IF p_step = 1 THEN
        v_uid := auth.uid();
        RETURN format('auth.uid() = %s', v_uid);
    ELSIF p_step = 2 THEN
        v_can := public.user_can_access_document(p_document_id, 'owner');
        RETURN format('user_can_access_document owner = %s', v_can);
    ELSIF p_step = 3 THEN
        SELECT COALESCE(MAX(revision_number), 0) + 1
            INTO v_next
            FROM public.document_revisions
            WHERE document_id = p_document_id;
        RETURN format('next_rev = %s', v_next);
    ELSIF p_step = 4 THEN
        SELECT COUNT(*) INTO v_count FROM public.document_annotations WHERE document_id = p_document_id;
        RETURN format('annotation_count = %s', v_count);
    END IF;
    RETURN 'unknown step';
END;
$function$;

CREATE OR REPLACE FUNCTION public.kal48_dump_access_fn()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT pg_get_functiondef(p.oid)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'user_can_access_document';
$function$;

DO $triggers$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.projects'::regclass AND tgname = 'update_projects_updated_at') THEN
    CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.templates'::regclass AND tgname = 'update_templates_updated_at') THEN
    CREATE TRIGGER update_templates_updated_at BEFORE UPDATE ON public.templates
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.documents'::regclass AND tgname = 'update_documents_updated_at') THEN
    CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON public.documents
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.spaces'::regclass AND tgname = 'update_spaces_updated_at') THEN
    CREATE TRIGGER update_spaces_updated_at BEFORE UPDATE ON public.spaces
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  -- Mirror auth.users into public.users.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND tgname = 'on_auth_user_created') THEN
    CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND tgname = 'on_auth_user_updated') THEN
    CREATE TRIGGER on_auth_user_updated AFTER UPDATE ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_user_update();
  END IF;
END;
$triggers$;

-- Private bucket holding the PDFs (path: <owner user id>/<document id>.pdf)
-- and the public bucket for brand assets.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents', 'documents', false, 52428800,
  ARRAY[
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
    'application/vnd.ms-excel.sheet.macroEnabled.12',
    'application/vnd.ms-excel.sheet.binary.macroEnabled.12'
  ]
)
ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public)
VALUES ('brand', 'brand', true)
ON CONFLICT (id) DO NOTHING;

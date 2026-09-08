-- Keep the legacy project-status API separate from projects.archived quotas.
-- Bind its reads/writes to the caller and serialize self-service swaps. Direct
-- service maintenance remains privileged; this is not a billing transaction.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE target regprocedure;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'public.swap_active_project(uuid,uuid,uuid)'::regprocedure,
    'public.get_active_projects(uuid)'::regprocedure,
    'public.is_project_accessible(uuid,uuid)'::regprocedure
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_roles r ON r.oid=p.proowner
      WHERE p.oid=target AND p.prosecdef AND r.rolname='postgres') THEN
      RAISE EXCEPTION 'Unexpected project-status function owner or execution mode: %', target;
    END IF;
  END LOOP;
END;
$$;

CREATE SCHEMA IF NOT EXISTS survey_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA survey_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS survey_private.project_swap_guards (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0,
  last_swap_at timestamptz
);
ALTER TABLE survey_private.project_swap_guards OWNER TO postgres;
ALTER TABLE survey_private.project_swap_guards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.project_swap_guards FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION survey_private.can_use_project_status(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller_name text;
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;
  IF p_user_id = auth.uid() THEN RETURN true; END IF;
  -- SECURITY DEFINER changes current_user. Trust the SQL role/login, never a
  -- caller-supplied JWT role field, for service/admin cross-account work.
  caller_name := COALESCE(NULLIF(NULLIF(current_setting('role', true), 'none'), ''), session_user);
  RETURN EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
    WHERE r.rolname=caller_name AND (r.rolsuper OR r.rolbypassrls));
END;
$$;
ALTER FUNCTION survey_private.can_use_project_status(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.can_use_project_status(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_active_projects(p_user_id uuid)
RETURNS TABLE(project_id uuid, project_name varchar, is_active boolean, archived_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT survey_private.can_use_project_status(p_user_id) THEN
    RAISE EXCEPTION 'Project status account does not match signed-in user' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT p.id, p.name::varchar, COALESCE(ps.is_active,true), ps.archived_at
    FROM public.projects p LEFT JOIN public.project_status ps ON ps.project_id=p.id
    WHERE p.user_id=p_user_id AND COALESCE(ps.is_active,true)
    ORDER BY p.updated_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_project_accessible(p_project_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- This helper is also called by projects UPDATE RLS, including for anon.
  -- Return false rather than raising so unrelated policy branches still work.
  IF NOT survey_private.can_use_project_status(p_user_id) THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id=p_project_id AND p.user_id=p_user_id) THEN
    RETURN false;
  END IF;
  IF public.get_user_tier(p_user_id)::text IN ('pro','enterprise','developer') THEN RETURN true; END IF;
  RETURN EXISTS (SELECT 1 FROM public.project_status ps
    WHERE ps.project_id=p_project_id AND COALESCE(ps.is_active,true));
END;
$$;

CREATE OR REPLACE FUNCTION public.swap_active_project(p_user_id uuid, p_old_project_id uuid, p_new_project_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  last_swap timestamptz;
  row_last_swap timestamptz;
  user_tier_text text;
  old_active boolean;
  new_active boolean;
  swap_at timestamptz;
  affected integer;
BEGIN
  IF NOT survey_private.can_use_project_status(p_user_id) THEN
    RAISE EXCEPTION 'Project status account does not match signed-in user' USING ERRCODE='42501';
  END IF;
  IF p_old_project_id IS NULL OR p_new_project_id IS NULL OR p_old_project_id=p_new_project_id THEN
    RAISE EXCEPTION 'Invalid project selection';
  END IF;

  -- A real row write gives READ COMMITTED callers a fresh post-lock snapshot
  -- and rejects stale REPEATABLE READ/SERIALIZABLE writers with 40001.
  INSERT INTO survey_private.project_swap_guards AS g(user_id,revision)
    VALUES(p_user_id,1) ON CONFLICT(user_id) DO UPDATE SET revision=g.revision+1
    RETURNING last_swap_at INTO last_swap;

  -- Prevent ownership changes/deletion between validation and status writes.
  PERFORM p.id FROM public.projects p
    WHERE p.id IN (p_old_project_id,p_new_project_id) AND p.user_id=p_user_id
    ORDER BY p.id FOR SHARE;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>2 THEN RAISE EXCEPTION 'Invalid project selection'; END IF;
  PERFORM ps.project_id FROM public.project_status ps
    WHERE ps.project_id IN (p_old_project_id,p_new_project_id)
    ORDER BY ps.project_id FOR UPDATE;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>2 THEN RAISE EXCEPTION 'Invalid project selection'; END IF;

  SELECT COALESCE(ps.is_active,true) INTO old_active FROM public.project_status ps WHERE ps.project_id=p_old_project_id;
  SELECT COALESCE(ps.is_active,true) INTO new_active FROM public.project_status ps WHERE ps.project_id=p_new_project_id;
  SELECT max(ps.last_active_swap) INTO row_last_swap
    FROM public.project_status ps JOIN public.projects p ON p.id=ps.project_id WHERE p.user_id=p_user_id;
  last_swap := GREATEST(last_swap,row_last_swap);
  user_tier_text := public.get_user_tier(p_user_id)::text;
  -- now() is transaction start, which may predate a long lock wait. Start the
  -- cooldown at this successful operation and keep the account clock monotonic.
  swap_at := clock_timestamp();
  IF COALESCE(user_tier_text,'free') NOT IN ('pro','enterprise','developer') THEN
    IF NOT old_active OR new_active THEN RAISE EXCEPTION 'Invalid project selection'; END IF;
    IF last_swap IS NOT NULL AND last_swap >= swap_at-interval '30 days' THEN
      RAISE EXCEPTION 'You can only change your active project once per month on the Free plan';
    END IF;
  END IF;

  UPDATE public.project_status SET is_active=false, archived_at=swap_at, last_active_swap=swap_at
    WHERE project_id=p_old_project_id;
  UPDATE public.project_status SET is_active=true, archived_at=NULL, last_active_swap=swap_at
    WHERE project_id=p_new_project_id;
  UPDATE survey_private.project_swap_guards SET last_swap_at=GREATEST(last_swap,swap_at) WHERE user_id=p_user_id;
  RETURN true;
END;
$$;

ALTER FUNCTION public.get_active_projects(uuid) OWNER TO postgres;
ALTER FUNCTION public.is_project_accessible(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.swap_active_project(uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_active_projects(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.swap_active_project(uuid,uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_project_accessible(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_projects(uuid), public.swap_active_project(uuid,uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_project_accessible(uuid,uuid) TO anon, authenticated, service_role;

-- RLS does not limit TRUNCATE, and table-level revokes alone do not remove
-- explicit column grants. Keep reads and owner-scoped metadata edits, but
-- require swaps/service calls for status/cooldown changes. Keep policies intact.
REVOKE ALL ON public.project_status FROM PUBLIC, anon, authenticated;
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(format('%I',a.attname),', ' ORDER BY a.attnum) INTO cols
    FROM pg_catalog.pg_attribute a WHERE a.attrelid='public.project_status'::regclass
      AND a.attnum>0 AND NOT a.attisdropped;
  EXECUTE format('REVOKE ALL (%s) ON public.project_status FROM PUBLIC, anon, authenticated',cols);
END;
$$;
GRANT SELECT ON public.project_status TO anon, authenticated;
GRANT UPDATE(metadata) ON public.project_status TO authenticated;

COMMIT;

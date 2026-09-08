-- Close owned publication before core account purge and provider cleanup.
-- This permanent UUID-only fence has no lifecycle FK: auth deletion must not
-- reopen an account namespace to an upload whose permission check ran earlier.
-- No provider I/O or auth-schema mutation occurs here. Storage custom-trigger
-- deployment still requires the compatibility checks documented in 220000.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS survey_private.account_write_guards (
  user_id uuid PRIMARY KEY,
  closing boolean NOT NULL DEFAULT false
);
ALTER TABLE survey_private.account_write_guards OWNER TO postgres;
ALTER TABLE survey_private.account_write_guards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.account_write_guards FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION survey_private.assert_account_open(p_user_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s'
AS $$
DECLARE is_closing boolean;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'Account owner is required' USING ERRCODE='23502'; END IF;
  INSERT INTO survey_private.account_write_guards(user_id,closing) VALUES(p_user_id,false)
    ON CONFLICT(user_id) DO NOTHING;
  -- SHARE, not KEY SHARE: closure changes a non-key column. Healthy writers
  -- share this lock through commit without a hot-row UPDATE on every write.
  SELECT closing INTO is_closing FROM survey_private.account_write_guards
    WHERE user_id=p_user_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account guard is unavailable' USING ERRCODE='40001'; END IF;
  IF is_closing THEN RAISE EXCEPTION 'ACCOUNT_CLOSING' USING ERRCODE='23514'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.guard_account_core_publication()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s'
AS $$
DECLARE project_owner uuid; account_id uuid; previous_owner uuid; path_owner uuid;
BEGIN
  IF TG_OP='UPDATE' THEN previous_owner := OLD.user_id; END IF;
  IF TG_TABLE_NAME='documents' THEN
    -- A purge must preserve another user's child, including archived children.
    -- Detaching an unchanged identity/path does not publish new owned data and
    -- must remain possible even while either account is closing.
    IF TG_OP='UPDATE' AND NEW.project_id IS NULL AND OLD.project_id IS NOT NULL
      AND NEW.id IS NOT DISTINCT FROM OLD.id
      AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
      AND NEW.file_path IS NOT DISTINCT FROM OLD.file_path THEN RETURN NEW; END IF;
    IF TG_OP='INSERT' OR NEW.file_path IS DISTINCT FROM OLD.file_path THEN
      -- Trusted imports can publish cross-owner paths; the path account must
      -- still be open. Existing unchanged shared references are not removed.
      BEGIN
        path_owner := split_part(NEW.file_path,'/',1)::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        path_owner := NULL;
      END;
    END IF;
    IF NEW.project_id IS NOT NULL THEN
      -- Freeze destination ownership before checking its account. Closure
      -- takes projects NOWAIT after its exclusive account lock, so a writer's
      -- project -> account order cannot create an unbounded reverse wait.
      SELECT user_id INTO project_owner FROM public.projects WHERE id=NEW.project_id FOR SHARE NOWAIT;
      IF NOT FOUND THEN RAISE EXCEPTION 'Destination project is unavailable' USING ERRCODE='23503'; END IF;
    END IF;
  END IF;
  -- Ownership transfer cannot move a row out of a closing account unnoticed.
  -- Lock distinct account IDs in the same order for all healthy writers.
  FOR account_id IN SELECT DISTINCT owner FROM unnest(ARRAY[previous_owner,NEW.user_id,project_owner,path_owner]) owner
    WHERE owner IS NOT NULL ORDER BY owner LOOP
    PERFORM survey_private.assert_account_open(account_id);
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.guard_account_storage_publication()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s'
AS $$
DECLARE namespace_owner uuid;
BEGIN
  IF NEW.bucket_id<>'documents' THEN RETURN NEW; END IF;
  -- Use PostgreSQL's UUID parser, not a canonical-string regex: uppercase,
  -- brace-wrapped and hyphenless UUID aliases identify the same account.
  -- Non-UUID legacy namespaces carry no reliable account identity; do not
  -- guess ownership from Storage owner metadata or caller/JWT role claims.
  BEGIN
    namespace_owner := split_part(NEW.name,'/',1)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NEW;
  END;
  IF namespace_owner IS NOT NULL THEN PERFORM survey_private.assert_account_open(namespace_owner); END IF;
  -- Run even for metadata-only updates: a closing account cannot keep writing
  -- through the older retirement trigger's unchanged-version fast path.
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_account_owned_rows(target_user_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s'
AS $$
DECLARE caller_name text; trusted boolean;
BEGIN
  caller_name := COALESCE(NULLIF(NULLIF(current_setting('role',true),'none'),''),session_user);
  SELECT r.rolsuper OR r.rolbypassrls INTO trusted FROM pg_catalog.pg_roles r WHERE r.rolname=caller_name;
  IF NOT COALESCE(trusted,false) THEN RAISE EXCEPTION 'Trusted SQL service role required' USING ERRCODE='42501'; END IF;
  IF target_user_id IS NULL THEN RAISE EXCEPTION 'Target account is required' USING ERRCODE='22023'; END IF;
  -- Shared healthy writes do not rewrite the guard. Closure needs a fresh
  -- statement snapshot AFTER waiting for their commits; an old RR snapshot
  -- could otherwise miss a row despite acquiring the closing lock correctly.
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Account closure requires READ COMMITTED' USING ERRCODE='25001';
  END IF;
  INSERT INTO survey_private.account_write_guards(user_id,closing) VALUES(target_user_id,false)
    ON CONFLICT(user_id) DO NOTHING;
  UPDATE survey_private.account_write_guards SET closing=true WHERE user_id=target_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account closure did not persist' USING ERRCODE='40001'; END IF;

  -- Freeze the owned project set before taking the child snapshot. New child
  -- publication checks this owner's closing guard, including service writers.
  -- NOWAIT breaks document/project tuple -> account reverse lock order; any
  -- conflict rolls back closure, row deletion and cleanup candidates together.
  PERFORM id FROM public.projects WHERE user_id=target_user_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM id FROM public.documents WHERE user_id=target_user_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM id FROM public.templates WHERE user_id=target_user_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM d.id FROM public.documents d JOIN public.projects p ON p.id=d.project_id
    WHERE p.user_id=target_user_id AND d.user_id IS DISTINCT FROM target_user_id
    ORDER BY d.id FOR UPDATE OF d NOWAIT;
  DELETE FROM public.documents WHERE user_id=target_user_id;
  UPDATE public.documents d SET project_id=NULL FROM public.projects p
    WHERE p.id=d.project_id AND p.user_id=target_user_id AND d.user_id IS DISTINCT FROM target_user_id;
  DELETE FROM public.projects WHERE user_id=target_user_id;
  DELETE FROM public.templates WHERE user_id=target_user_id;
END;
$$;

ALTER FUNCTION survey_private.assert_account_open(uuid) OWNER TO postgres;
ALTER FUNCTION survey_private.guard_account_core_publication() OWNER TO postgres;
ALTER FUNCTION survey_private.guard_account_storage_publication() OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.assert_account_open(uuid),survey_private.guard_account_core_publication(),
  survey_private.guard_account_storage_publication() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.delete_account_owned_rows(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_account_owned_rows(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.delete_account_owned_rows(uuid) TO service_role;

CREATE OR REPLACE TRIGGER a_account_core_publication BEFORE INSERT OR UPDATE OF user_id,project_id,file_path ON public.documents
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_account_core_publication();
CREATE OR REPLACE TRIGGER a_account_core_publication BEFORE INSERT OR UPDATE OF user_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_account_core_publication();
CREATE OR REPLACE TRIGGER a_account_core_publication BEFORE INSERT OR UPDATE OF user_id ON public.templates
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_account_core_publication();
CREATE OR REPLACE TRIGGER a_account_storage_publication BEFORE INSERT OR UPDATE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_account_storage_publication();

COMMENT ON TABLE survey_private.account_write_guards IS
  'Permanent account publication fence, UUID and closing flag only, no lifecycle FK. Closing cannot be reopened by application roles. No provider-byte deletion or auth mutation.';
COMMIT;

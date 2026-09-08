-- Irreversible publication retirement is committed BEFORE Storage API removal.
-- Storage removes provider bytes before its metadata transaction commits; never
-- first-retire from that transaction, since a rollback cannot restore bytes.
-- Custom storage triggers require deployed-version compatibility testing:
-- https://supabase.com/docs/guides/storage/schema/design
-- No provider I/O or direct storage metadata mutation occurs in these functions.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS survey_private.document_storage_path_guards (
  path_hash bytea PRIMARY KEY CHECK(octet_length(path_hash)=32),
  revision bigint NOT NULL CHECK(revision>0),
  retired boolean NOT NULL,
  retirement_xid xid8,
  CHECK(retired=(retirement_xid IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS survey_private.document_storage_cleanup (
  path_hash bytea PRIMARY KEY CHECK(octet_length(path_hash)=32),
  path text NOT NULL CHECK(length(path) BETWEEN 1 AND 2048),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS document_storage_cleanup_due_idx
  ON survey_private.document_storage_cleanup(next_attempt_at,created_at,path_hash);
ALTER TABLE survey_private.document_storage_path_guards OWNER TO postgres;
ALTER TABLE survey_private.document_storage_cleanup OWNER TO postgres;
ALTER TABLE survey_private.document_storage_path_guards ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_private.document_storage_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.document_storage_path_guards,survey_private.document_storage_cleanup
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION survey_private.document_storage_path_hash(p_path text)
RETURNS bytea LANGUAGE sql IMMUTABLE STRICT SET search_path=''
AS $$ SELECT pg_catalog.sha256(pg_catalog.convert_to('documents/' || p_path,'UTF8')) $$;

CREATE OR REPLACE FUNCTION survey_private.touch_document_storage_path(p_path text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s'
AS $$
DECLARE key_hash bytea; was_retired boolean;
BEGIN
  IF p_path IS NULL OR length(p_path) NOT BETWEEN 1 AND 2048 OR p_path ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invalid document storage path' USING ERRCODE='22023';
  END IF;
  key_hash := survey_private.document_storage_path_hash(p_path);
  IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
    'survey:document_storage:' || encode(key_hash,'hex'),0)) THEN
    RAISE EXCEPTION 'DOCUMENT_STORAGE_PATH_BUSY' USING ERRCODE='55P03';
  END IF;
  -- A real write rejects old RR/Serializable snapshots, including an absent
  -- guard inserted by another transaction. A SELECT-only check is insufficient.
  INSERT INTO survey_private.document_storage_path_guards AS g(path_hash,revision,retired)
    VALUES(key_hash,1,false) ON CONFLICT(path_hash) DO UPDATE SET revision=g.revision+1
    RETURNING retired INTO was_retired;
  IF NOT FOUND THEN RAISE EXCEPTION 'Storage path guard did not persist' USING ERRCODE='40001'; END IF;
  RETURN was_retired;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.queue_document_storage_cleanup(p_path text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s'
AS $$
BEGIN
  INSERT INTO survey_private.document_storage_cleanup(path_hash,path)
    VALUES(survey_private.document_storage_path_hash(p_path),p_path)
    ON CONFLICT(path_hash) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.guard_document_storage_reference()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s'
AS $$
DECLARE selected_path text; retired boolean;
BEGIN
  IF TG_OP='UPDATE' AND NEW.file_path IS NOT DISTINCT FROM OLD.file_path THEN RETURN NEW; END IF;
  IF TG_WHEN='AFTER' THEN
    -- Only a candidate: another archived or shared document may still refer to
    -- it. The retirement RPC rechecks all references before authorizing removal.
    IF OLD.file_path IS NOT NULL THEN PERFORM survey_private.queue_document_storage_cleanup(OLD.file_path); END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  FOR selected_path IN SELECT DISTINCT p FROM unnest(CASE TG_OP
      WHEN 'INSERT' THEN ARRAY[NEW.file_path]
      WHEN 'DELETE' THEN ARRAY[OLD.file_path]
      ELSE ARRAY[OLD.file_path,NEW.file_path] END) p WHERE p IS NOT NULL ORDER BY p LOOP
    retired := survey_private.touch_document_storage_path(selected_path);
    IF TG_OP<>'DELETE' AND selected_path=NEW.file_path AND retired THEN
      RAISE EXCEPTION 'DOCUMENT_STORAGE_PATH_RETIRED' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.guard_document_storage_object()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s'
AS $$
DECLARE selected_path text; retired boolean; old_leaving boolean; retirement_transaction xid8;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.bucket_id IS NOT DISTINCT FROM OLD.bucket_id AND NEW.name IS NOT DISTINCT FROM OLD.name
      AND NEW.version IS NOT DISTINCT FROM OLD.version THEN RETURN NEW; END IF;
  END IF;
  old_leaving := TG_OP='DELETE' OR (TG_OP='UPDATE' AND
    (NEW.bucket_id IS DISTINCT FROM OLD.bucket_id OR NEW.name IS DISTINCT FROM OLD.name));
  FOR selected_path IN SELECT DISTINCT p FROM unnest(ARRAY[
      CASE WHEN TG_OP<>'INSERT' AND OLD.bucket_id='documents' THEN OLD.name END,
      CASE WHEN TG_OP<>'DELETE' AND NEW.bucket_id='documents' THEN NEW.name END
    ]) p WHERE p IS NOT NULL ORDER BY p LOOP
    IF old_leaving AND OLD.bucket_id='documents' AND selected_path=OLD.name THEN
      SELECT g.retired,g.retirement_xid INTO retired,retirement_transaction
        FROM survey_private.document_storage_path_guards g
        WHERE g.path_hash=survey_private.document_storage_path_hash(selected_path);
      IF NOT COALESCE(retired,false) THEN
        RAISE EXCEPTION 'DOCUMENT_STORAGE_PATH_NOT_RETIRED' USING ERRCODE='23514';
      END IF;
      -- Retirement must be from a PRIOR committed transaction. Even a trusted
      -- SQL caller cannot combine first retirement and provider deletion in one
      -- transaction whose later rollback would undo the only retirement fence.
      IF retirement_transaction=pg_catalog.pg_current_xact_id() THEN
        RAISE EXCEPTION 'DOCUMENT_STORAGE_RETIREMENT_NOT_COMMITTED' USING ERRCODE='23514';
      END IF;
    END IF;
    retired := survey_private.touch_document_storage_path(selected_path);
    IF old_leaving AND OLD.bucket_id='documents' AND selected_path=OLD.name THEN
      IF NOT retired THEN RAISE EXCEPTION 'DOCUMENT_STORAGE_PATH_NOT_RETIRED' USING ERRCODE='23514'; END IF;
      IF EXISTS(SELECT 1 FROM public.documents WHERE file_path=selected_path) THEN
        RAISE EXCEPTION 'DOCUMENT_STORAGE_PATH_REFERENCED' USING ERRCODE='23514';
      END IF;
    END IF;
    IF TG_OP<>'DELETE' AND NEW.bucket_id='documents' AND selected_path=NEW.name AND retired THEN
      RAISE EXCEPTION 'DOCUMENT_STORAGE_PATH_RETIRED' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.authorize_document_storage_paths(p_paths text[],p_service_only boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
DECLARE caller_name text; trusted boolean; actor uuid := auth.uid(); selected_path text;
BEGIN
  caller_name := COALESCE(NULLIF(NULLIF(current_setting('role',true),'none'),''),session_user);
  SELECT r.rolsuper OR r.rolbypassrls INTO trusted FROM pg_catalog.pg_roles r WHERE r.rolname=caller_name;
  IF NOT COALESCE(trusted,false) AND (p_service_only OR actor IS NULL
    OR NOT pg_catalog.pg_has_role(caller_name,'authenticated','MEMBER')) THEN
    RAISE EXCEPTION 'Document storage cleanup requires an authorized caller' USING ERRCODE='42501';
  END IF;
  IF p_paths IS NULL OR cardinality(p_paths)>100 THEN
    RAISE EXCEPTION 'Expected at most 100 document storage paths' USING ERRCODE='22023';
  END IF;
  FOREACH selected_path IN ARRAY p_paths LOOP
    IF selected_path IS NULL OR length(selected_path) NOT BETWEEN 1 AND 2048 OR selected_path ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'Invalid document storage path' USING ERRCODE='22023';
    END IF;
    IF NOT COALESCE(trusted,false) AND
      (split_part(selected_path,'/',1)<>actor::text OR position('/' in selected_path)=0) THEN
      RAISE EXCEPTION 'Document storage path belongs to another account' USING ERRCODE='42501';
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.retire_document_storage_paths(p_paths text[])
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s'
AS $$
DECLARE selected_path text; retired_paths text[] := ARRAY[]::text[]; referenced_paths text[] := ARRAY[]::text[];
BEGIN
  PERFORM survey_private.authorize_document_storage_paths(p_paths);
  FOR selected_path IN SELECT DISTINCT p FROM unnest(p_paths) p ORDER BY p LOOP
    PERFORM survey_private.touch_document_storage_path(selected_path);
    IF EXISTS(SELECT 1 FROM public.documents WHERE file_path=selected_path) THEN
      referenced_paths := array_append(referenced_paths,selected_path);
    ELSE
      UPDATE survey_private.document_storage_path_guards SET retired=true,
        retirement_xid=COALESCE(retirement_xid,pg_catalog.pg_current_xact_id())
        WHERE path_hash=survey_private.document_storage_path_hash(selected_path);
      PERFORM survey_private.queue_document_storage_cleanup(selected_path);
      retired_paths := array_append(retired_paths,selected_path);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('retired_paths',retired_paths,'referenced_paths',referenced_paths);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_document_storage_cleanup(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s'
AS $$
DECLARE paths text[] := ARRAY[]::text[]; candidate record;
BEGIN
  PERFORM survey_private.authorize_document_storage_paths(ARRAY[]::text[],true);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid cleanup page size' USING ERRCODE='22023';
  END IF;
  -- Claim only due candidates. Persist a short retry delay BEFORE returning,
  -- including when the response is lost or provider removal fails. Concurrent
  -- workers skip claimed rows; old failures cannot occupy every later batch.
  FOR candidate IN SELECT c.path,c.path_hash FROM survey_private.document_storage_cleanup c
    WHERE c.next_attempt_at<=clock_timestamp()
      -- Shared candidates stay durable, but cannot starve later cleanup work.
      -- idx_documents_file_path supports this lookup; retirement rechecks it.
      AND NOT EXISTS(SELECT 1 FROM public.documents d WHERE d.file_path=c.path)
    ORDER BY c.next_attempt_at,c.created_at,c.path_hash LIMIT p_limit
    FOR UPDATE OF c SKIP LOCKED LOOP
    UPDATE survey_private.document_storage_cleanup SET next_attempt_at=clock_timestamp()+interval '1 minute'
      WHERE path_hash=candidate.path_hash;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cleanup claim did not persist' USING ERRCODE='40001'; END IF;
    paths := array_append(paths,candidate.path);
  END LOOP;
  RETURN jsonb_build_object('paths',paths);
END;
$$;

CREATE OR REPLACE FUNCTION public.ack_document_storage_cleanup(p_paths text[])
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s'
AS $$
DECLARE selected_path text; retired boolean; acknowledged_paths text[] := ARRAY[]::text[]; pending_paths text[] := ARRAY[]::text[];
BEGIN
  PERFORM survey_private.authorize_document_storage_paths(p_paths);
  FOR selected_path IN SELECT DISTINCT p FROM unnest(p_paths) p ORDER BY p LOOP
    retired := survey_private.touch_document_storage_path(selected_path);
    IF retired AND NOT EXISTS(SELECT 1 FROM public.documents WHERE file_path=selected_path)
      AND NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='documents' AND name=selected_path) THEN
      DELETE FROM survey_private.document_storage_cleanup WHERE path_hash=survey_private.document_storage_path_hash(selected_path);
      acknowledged_paths := array_append(acknowledged_paths,selected_path);
    ELSE
      pending_paths := array_append(pending_paths,selected_path);
    END IF;
  END LOOP;
  -- This confirms metadata absence only, NOT provider-byte deletion. Call only
  -- after Storage API success; unknown provider outcomes still need inspection.
  RETURN jsonb_build_object('acknowledged_paths',acknowledged_paths,'pending_paths',pending_paths);
END;
$$;

ALTER FUNCTION survey_private.document_storage_path_hash(text) OWNER TO postgres;
ALTER FUNCTION survey_private.touch_document_storage_path(text) OWNER TO postgres;
ALTER FUNCTION survey_private.queue_document_storage_cleanup(text) OWNER TO postgres;
ALTER FUNCTION survey_private.guard_document_storage_reference() OWNER TO postgres;
ALTER FUNCTION survey_private.guard_document_storage_object() OWNER TO postgres;
ALTER FUNCTION survey_private.authorize_document_storage_paths(text[],boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.document_storage_path_hash(text),survey_private.touch_document_storage_path(text),
  survey_private.queue_document_storage_cleanup(text),survey_private.guard_document_storage_reference(),
  survey_private.guard_document_storage_object(),survey_private.authorize_document_storage_paths(text[],boolean)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.retire_document_storage_paths(text[]) OWNER TO postgres;
ALTER FUNCTION public.list_document_storage_cleanup(integer) OWNER TO postgres;
ALTER FUNCTION public.ack_document_storage_cleanup(text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.retire_document_storage_paths(text[]),public.list_document_storage_cleanup(integer),
  public.ack_document_storage_cleanup(text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.retire_document_storage_paths(text[]),public.ack_document_storage_cleanup(text[]) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_document_storage_cleanup(integer) TO service_role;

DROP TRIGGER IF EXISTS c_document_storage_reference_guard ON public.documents;
CREATE TRIGGER c_document_storage_reference_guard BEFORE INSERT OR DELETE OR UPDATE OF file_path ON public.documents
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_document_storage_reference();
DROP TRIGGER IF EXISTS document_storage_cleanup_candidate ON public.documents;
CREATE TRIGGER document_storage_cleanup_candidate AFTER DELETE OR UPDATE OF file_path ON public.documents
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_document_storage_reference();
-- Hosted migration roles can have CREATE TRIGGER rights without table ownership;
-- use the existing Storage migration pattern instead of DROP TRIGGER.
CREATE OR REPLACE TRIGGER a_document_storage_retirement_guard BEFORE INSERT OR UPDATE OR DELETE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_document_storage_object();
REVOKE TRUNCATE ON public.documents,storage.objects FROM PUBLIC,anon,authenticated,service_role;
DO $$
BEGIN
  -- REVOKE can warn without changing privileges when the hosted migration role
  -- lacks grant authority. Never report this guard installed in that state.
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) AS roles(role_name)
    WHERE pg_catalog.has_table_privilege(role_name,'public.documents','TRUNCATE')
       OR pg_catalog.has_table_privilege(role_name,'storage.objects','TRUNCATE')) THEN
    RAISE EXCEPTION 'Application roles retain TRUNCATE rights; storage retirement installation refused' USING ERRCODE='42501';
  END IF;
END;
$$;

COMMENT ON TABLE survey_private.document_storage_path_guards IS
  'Permanent SHA-256 of exact documents bucket/name plus revision/retirement, without lifecycle FKs or retained path text. Never purge retired guards.';
COMMENT ON TABLE survey_private.document_storage_cleanup IS
  'Pending cleanup candidates retain exact paths until acknowledged. No scheduler, no provider-byte proof, no lifecycle FKs. Retirement must precede Storage API deletion.';
COMMIT;

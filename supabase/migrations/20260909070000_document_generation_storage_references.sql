-- Storage-reference foundation only: no generation activation, path-change
-- capability, client reservation API, provider write, or quota exemption.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS survey_private.document_generation_storage_references (
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  generation_id uuid NOT NULL,
  path text NOT NULL CHECK(length(path) BETWEEN 1 AND 2048),
  path_hash bytea GENERATED ALWAYS AS (survey_private.document_storage_path_hash(path)) STORED,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(document_id,generation_id,path_hash)
);
CREATE INDEX IF NOT EXISTS document_generation_storage_path_idx
  ON survey_private.document_generation_storage_references(path_hash);
ALTER TABLE survey_private.document_generation_storage_references OWNER TO postgres;
ALTER TABLE survey_private.document_generation_storage_references ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.document_generation_storage_references FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION survey_private.document_storage_path_is_referenced(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT EXISTS(SELECT 1 FROM public.documents d WHERE d.file_path=p_path)
    OR EXISTS(SELECT 1 FROM survey_private.document_generation_storage_references r
      WHERE r.path_hash=survey_private.document_storage_path_hash(p_path) AND r.path=p_path)
$$;

CREATE OR REPLACE FUNCTION survey_private.guard_document_generation_storage_reference()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s'
AS $$
DECLARE permanent_owner uuid; path_parts text[];
BEGIN
  IF TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'Document generation storage references are immutable; release by deletion' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN
    IF TG_WHEN='AFTER' THEN
      PERFORM survey_private.queue_document_storage_cleanup(OLD.path);
    ELSE
      -- Parent may already be gone during its FK cascade. Release never needs
      -- an open account or an extant parent; the same path fence still applies.
      PERFORM survey_private.touch_document_storage_path(OLD.path);
    END IF;
    RETURN OLD;
  END IF;

  -- SHARE protects permanent ownership and prevents a document-delete cascade
  -- missing this reservation. NOWAIT breaks reverse parent/account/path order.
  SELECT user_id INTO permanent_owner FROM public.documents WHERE id=NEW.document_id FOR SHARE NOWAIT;
  IF NOT FOUND OR permanent_owner IS NULL THEN
    RAISE EXCEPTION 'Generation storage requires an existing owned document' USING ERRCODE='23503';
  END IF;
  path_parts := string_to_array(NEW.path,'/');
  IF NEW.path IS NULL OR length(NEW.path) NOT BETWEEN 1 AND 2048 OR cardinality(path_parts)<2
    OR path_parts[1] IS DISTINCT FROM permanent_owner::text
    OR NEW.path ~ '[[:cntrl:]%?#]' OR position(chr(92) in NEW.path)>0
    OR EXISTS(SELECT 1 FROM unnest(path_parts) part WHERE part IN ('','.','..')) THEN
    RAISE EXCEPTION 'Generation storage path must belong to the permanent document owner' USING ERRCODE='42501';
  END IF;
  PERFORM survey_private.assert_account_open(permanent_owner);
  IF survey_private.touch_document_storage_path(NEW.path) THEN
    RAISE EXCEPTION 'DOCUMENT_STORAGE_PATH_RETIRED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION survey_private.document_storage_path_is_referenced(text) OWNER TO postgres;
ALTER FUNCTION survey_private.guard_document_generation_storage_reference() OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.document_storage_path_is_referenced(text),
  survey_private.guard_document_generation_storage_reference() FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE TRIGGER document_generation_storage_reference_guard
  BEFORE INSERT OR UPDATE OR DELETE ON survey_private.document_generation_storage_references
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_document_generation_storage_reference();
CREATE OR REPLACE TRIGGER document_generation_storage_reference_cleanup
  AFTER DELETE ON survey_private.document_generation_storage_references
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_document_generation_storage_reference();

-- Existing guard/RPC definitions follow, with only their reference predicates
-- extended. Preserve role checks, committed retirement, bounded scans and ACLs.
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
      IF survey_private.document_storage_path_is_referenced(selected_path) THEN
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

CREATE OR REPLACE FUNCTION public.retire_document_storage_paths(p_paths text[])
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s'
AS $$
DECLARE selected_path text; retired_paths text[] := ARRAY[]::text[]; referenced_paths text[] := ARRAY[]::text[];
BEGIN
  PERFORM survey_private.authorize_document_storage_paths(p_paths);
  FOR selected_path IN SELECT DISTINCT p FROM unnest(p_paths) p ORDER BY p LOOP
    PERFORM survey_private.touch_document_storage_path(selected_path);
    IF survey_private.document_storage_path_is_referenced(selected_path) THEN
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
      AND NOT survey_private.document_storage_path_is_referenced(c.path)
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
    IF retired AND NOT survey_private.document_storage_path_is_referenced(selected_path)
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

CREATE OR REPLACE FUNCTION public.claim_account_storage_cleanup(target_user_id uuid,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s'
AS $$
DECLARE
  caller_name text;
  trusted boolean;
  is_closing boolean;
  cursor_row survey_private.account_storage_cleanup_scans%ROWTYPE;
  prefix_lower text;
  prefix_upper text;
  active_source text;
  raw_count integer;
  last_offered text;
  last_hash bytea;
  paths text[];
  remaining boolean;
  finished_cycle boolean;
BEGIN
  caller_name := COALESCE(NULLIF(NULLIF(current_setting('role',true),'none'),''),session_user);
  SELECT r.rolsuper OR r.rolbypassrls INTO trusted FROM pg_catalog.pg_roles r WHERE r.rolname=caller_name;
  IF NOT COALESCE(trusted,false) THEN RAISE EXCEPTION 'Trusted SQL service role required' USING ERRCODE='42501'; END IF;
  IF target_user_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid account storage cleanup claim' USING ERRCODE='22023';
  END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Account cleanup claim requires READ COMMITTED' USING ERRCODE='25001';
  END IF;
  SELECT closing INTO is_closing FROM survey_private.account_write_guards
    WHERE user_id=target_user_id FOR SHARE;
  IF NOT FOUND OR NOT is_closing THEN
    RAISE EXCEPTION 'Account must already be closing' USING ERRCODE='23514';
  END IF;
  -- Account SHARE -> cursor UPDATE is also the closure receipt lock order.
  SELECT * INTO cursor_row FROM survey_private.account_storage_cleanup_scans
    WHERE user_id=target_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account cleanup closure receipt is unavailable' USING ERRCODE='40001'; END IF;
  IF cursor_row.closing_xid=pg_catalog.pg_current_xact_id() THEN
    RAISE EXCEPTION 'ACCOUNT_CLOSURE_NOT_COMMITTED' USING ERRCODE='23514';
  END IF;
  prefix_lower := target_user_id::text || '/';
  prefix_upper := target_user_id::text || '0';
  active_source := CASE WHEN cursor_row.storage_cycle_done THEN 'queue'
    WHEN cursor_row.queue_cycle_done THEN 'storage' ELSE cursor_row.next_source END;

  -- One RAW source page per claim, at most p_limit keys, then reference checks.
  -- Alternation also works at p_limit=1. An exhausted source is skipped until
  -- the other finishes; empty or fully referenced pages still advance progress.
  -- Reference equality uses the documents.file_path index's default collation,
  -- not the Storage cursor's C collation; bytewise sorting remains separate.
  IF active_source='storage' THEN
    WITH raw_page AS MATERIALIZED (
      SELECT o.name COLLATE "C" AS path FROM storage.objects o
      WHERE o.bucket_id='documents' AND o.name COLLATE "C">=prefix_lower COLLATE "C"
        AND o.name COLLATE "C"<prefix_upper COLLATE "C"
        AND o.name COLLATE "C">COALESCE(cursor_row.last_storage_path,target_user_id::text) COLLATE "C"
      ORDER BY o.name COLLATE "C" LIMIT p_limit
    )
    SELECT count(*)::integer,max(r.path COLLATE "C"),
      COALESCE(array_agg(r.path ORDER BY r.path COLLATE "C") FILTER(
        WHERE NOT survey_private.document_storage_path_is_referenced(r.path COLLATE "default")),ARRAY[]::text[])
      INTO raw_count,last_offered,paths FROM raw_page r;
    cursor_row.storage_cycle_done := raw_count<p_limit;
    cursor_row.last_storage_path := CASE WHEN cursor_row.storage_cycle_done THEN NULL ELSE last_offered END;
  ELSE
    WITH raw_page AS MATERIALIZED (
      SELECT q.path,q.path_hash FROM survey_private.document_storage_cleanup q
      WHERE left(q.path,36) COLLATE "C"=target_user_id::text COLLATE "C" AND substr(q.path,37,1)='/'
        AND q.path_hash>COALESCE(cursor_row.last_queue_hash,''::bytea)
      ORDER BY q.path_hash LIMIT p_limit
    )
    SELECT count(*)::integer,(array_agg(r.path_hash ORDER BY r.path_hash DESC))[1],
      COALESCE(array_agg(r.path ORDER BY r.path_hash) FILTER(
        WHERE NOT survey_private.document_storage_path_is_referenced(r.path COLLATE "default")),ARRAY[]::text[])
      INTO raw_count,last_hash,paths FROM raw_page r;
    cursor_row.queue_cycle_done := raw_count<p_limit;
    cursor_row.last_queue_hash := CASE WHEN cursor_row.queue_cycle_done THEN NULL ELSE last_hash END;
  END IF;

  -- Check BOTH entire sources, not just eligible rows or the current page.
  -- Exact bytewise UUID/slash scope excludes neighbors and UUID spellings such
  -- as uppercase/braces; discovery of legacy aliases is a separate rollout gate.
  SELECT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='documents'
      AND o.name COLLATE "C">=prefix_lower COLLATE "C" AND o.name COLLATE "C"<prefix_upper COLLATE "C")
    OR EXISTS(SELECT 1 FROM survey_private.document_storage_cleanup q
      WHERE left(q.path,36) COLLATE "C"=target_user_id::text COLLATE "C" AND substr(q.path,37,1)='/')
    INTO remaining;
  finished_cycle := cursor_row.storage_cycle_done AND cursor_row.queue_cycle_done;
  IF NOT remaining THEN
    paths := ARRAY[]::text[];
    finished_cycle := true;
  END IF;
  UPDATE survey_private.account_storage_cleanup_scans
    SET last_storage_path=CASE WHEN finished_cycle THEN NULL ELSE cursor_row.last_storage_path END,
      last_queue_hash=CASE WHEN finished_cycle THEN NULL ELSE cursor_row.last_queue_hash END,
      storage_cycle_done=CASE WHEN finished_cycle THEN false ELSE cursor_row.storage_cycle_done END,
      queue_cycle_done=CASE WHEN finished_cycle THEN false ELSE cursor_row.queue_cycle_done END,
      next_source=CASE WHEN finished_cycle THEN 'storage' WHEN active_source='storage' THEN 'queue' ELSE 'storage' END
    WHERE user_id=target_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account cleanup claim did not persist' USING ERRCODE='40001'; END IF;
  -- Eligible-empty is NOT done. Auth completion requires a subsequent empty
  -- claim with has_remaining=false. This confirms a DB snapshot, not provider
  -- byte removal. Referenced paths stay present and prevent a false completion.
  RETURN jsonb_build_object('paths',paths,'has_remaining',remaining,'cycle_complete',finished_cycle);
END;
$$;

COMMIT;

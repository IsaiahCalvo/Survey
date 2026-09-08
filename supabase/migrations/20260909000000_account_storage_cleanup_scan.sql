-- Bounded durable scan for an already-committed closing account. Claims do not
-- retire paths, mutate Storage metadata, or perform provider I/O. A lost reply
-- advances the cursor, but every remaining key is offered again in a later cycle.
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS survey_private.account_storage_cleanup_scans (
  user_id uuid PRIMARY KEY,
  closing_xid xid8,
  last_storage_path text,
  last_queue_hash bytea CHECK(last_queue_hash IS NULL OR octet_length(last_queue_hash)=32),
  next_source text NOT NULL DEFAULT 'storage' CHECK(next_source IN ('storage','queue')),
  storage_cycle_done boolean NOT NULL DEFAULT false,
  queue_cycle_done boolean NOT NULL DEFAULT false
);
ALTER TABLE survey_private.account_storage_cleanup_scans OWNER TO postgres;
ALTER TABLE survey_private.account_storage_cleanup_scans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.account_storage_cleanup_scans FROM PUBLIC,anon,authenticated,service_role;
-- Full path text can exceed a btree entry's byte limit (2048 Unicode characters).
-- Only a fixed-width prefix plus hash is indexed. The partial predicate excludes
-- noncanonical namespace boundaries before the bounded keyset scan.
CREATE INDEX IF NOT EXISTS document_storage_cleanup_account_scan_idx
  ON survey_private.document_storage_cleanup((left(path,36) COLLATE "C"),path_hash)
  WHERE substr(path,37,1)='/';

-- Establish which closing rows predate this migration while excluding concurrent
-- transitions. NULL closing_xid is reserved for these already-committed rows.
-- New transitions record the TOP transaction ID, including inside savepoints;
-- xmin comparisons to a top XID alone would miss an uncommitted subtransaction.
LOCK TABLE survey_private.account_write_guards IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO survey_private.account_storage_cleanup_scans(user_id,closing_xid)
  SELECT user_id,NULL FROM survey_private.account_write_guards WHERE closing
  ON CONFLICT(user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION survey_private.record_account_cleanup_closure()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s'
AS $$
BEGIN
  IF NEW.closing AND (TG_OP='INSERT' OR OLD.closing IS DISTINCT FROM true) THEN
    INSERT INTO survey_private.account_storage_cleanup_scans(user_id,closing_xid)
      VALUES(NEW.user_id,pg_catalog.pg_current_xact_id())
      ON CONFLICT(user_id) DO UPDATE SET closing_xid=EXCLUDED.closing_xid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Account cleanup closure receipt did not persist' USING ERRCODE='40001'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION survey_private.record_account_cleanup_closure() OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.record_account_cleanup_closure() FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE TRIGGER account_cleanup_closure_receipt AFTER INSERT OR UPDATE OF closing
  ON survey_private.account_write_guards FOR EACH ROW EXECUTE FUNCTION survey_private.record_account_cleanup_closure();

-- Storage is provider-owned: do not create/alter its indexes here. The storage
-- scan needs an existing nonpartial btree starting (bucket_id,name COLLATE "C"),
-- e.g. idx_objects_bucket_id_name or objects_bucket_id_name_version_key. Default
-- locale, lower(name), and active-version-only indexes are not substitutes for
-- scanning ALL metadata. Verify the deployed index and EXPLAIN before rollout.
-- Provider version/schema compatibility, including path uniqueness, stays gated.

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
        WHERE NOT EXISTS(SELECT 1 FROM public.documents d WHERE d.file_path=r.path COLLATE "default")),ARRAY[]::text[])
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
        WHERE NOT EXISTS(SELECT 1 FROM public.documents d WHERE d.file_path=r.path COLLATE "default")),ARRAY[]::text[])
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
ALTER FUNCTION public.claim_account_storage_cleanup(uuid,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_account_storage_cleanup(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_account_storage_cleanup(uuid,integer) TO service_role;
COMMENT ON TABLE survey_private.account_storage_cleanup_scans IS
  'Durable canonical UUID-prefix scan cursors and top-XID closure receipt, no lifecycle FK. Bounded alternating source pages; remaining work repeats after both sources end. No provider I/O.';
COMMIT;

-- Bring a database built from supabase/migrations/ in line with production.
--
-- Production was changed by hand in places the chain never recorded, so a
-- fresh database replayed from this folder came out different (and broken:
-- sign-up and every project / document insert failed). This file records
-- those hand changes. Production already has every one of them: each
-- statement below either matches production exactly or is guarded, so on
-- production it changes nothing.
--
-- What it records:
--   1. search_path. 20260211224035_fix_function_search_path set
--      `search_path = ''` on functions whose bodies use unqualified table
--      names; production later set them back to `public` by hand. With ''
--      they fail with `relation "..." does not exist`.
--   2. Legacy tables production dropped by hand (activity_log,
--      survey_sync_log, annotations, user_settings). Early migrations still
--      create or alter them, so they exist on a fresh database until here.
--   3. supabase/proposed/ files applied by hand on production:
--      w36 legacy annotation cleanup (schema part only: replica identity and
--      the GIN index), w36 prune functions, w54 mark lock, w55 Survey Marker
--      trash rows. Their pg_cron jobs are not recreated here (production
--      schedules them; a fresh database has no pg_cron).
--   4. get_current_usage counts only live (not archived) projects and
--      documents on production.

-- 1. search_path ------------------------------------------------------------
ALTER FUNCTION public.add_document_owner_collaborator() SET search_path = public;
ALTER FUNCTION public.add_project_owner_collaborator() SET search_path = public;
ALTER FUNCTION public.archive_excess_documents(uuid, integer) SET search_path = public;
ALTER FUNCTION public.archive_excess_projects(uuid, integer) SET search_path = public;
ALTER FUNCTION public.archive_excess_projects(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.check_collaborator_by_email(text) SET search_path = public;
ALTER FUNCTION public.check_user_collaborator_eligibility(uuid) SET search_path = public;
ALTER FUNCTION public.create_project_status() SET search_path = public;
ALTER FUNCTION public.get_active_projects(uuid) SET search_path = public;
ALTER FUNCTION public.get_user_id_by_email(text) SET search_path = public;
ALTER FUNCTION public.handle_downgrade_to_free(uuid) SET search_path = public;
ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.handle_new_user_subscription() SET search_path = public;
ALTER FUNCTION public.handle_user_update() SET search_path = public;
ALTER FUNCTION public.record_document_metric() SET search_path = public;
ALTER FUNCTION public.record_project_metric() SET search_path = public;
ALTER FUNCTION public.record_usage_metric(uuid, character varying, bigint, jsonb) SET search_path = public;
ALTER FUNCTION public.set_usage_metrics_date_bucket() SET search_path = public;
ALTER FUNCTION public.update_connected_services_updated_at() SET search_path = public;
ALTER FUNCTION public.update_document_tables_updated_at() SET search_path = public;
ALTER FUNCTION public.update_project_status_updated_at() SET search_path = public;
ALTER FUNCTION public.update_survey_tables_updated_at() SET search_path = public;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public.update_user_storage() SET search_path = public;
ALTER FUNCTION public.update_user_subscriptions_updated_at() SET search_path = public;

-- 2. Legacy tables ----------------------------------------------------------
DROP TABLE IF EXISTS public.activity_log;
DROP TABLE IF EXISTS public.survey_sync_log;
DROP TABLE IF EXISTS public.annotations;
DROP TABLE IF EXISTS public.user_settings;

-- 3a. w36 legacy annotation cleanup (schema only) -----------------------------
DO $w36$
BEGIN
  IF (SELECT relreplident FROM pg_class WHERE oid = 'public.document_annotations'::regclass) <> 'd' THEN
    ALTER TABLE public.document_annotations REPLICA IDENTITY DEFAULT;
  END IF;
END;
$w36$;
DROP INDEX IF EXISTS public.idx_document_annotations_data;

-- 3b. w36 prune functions (final versions, as w55 left them) ------------------
CREATE OR REPLACE FUNCTION public.prune_annotation_updates(p_keep_days integer DEFAULT 7, p_keep_rows integer DEFAULT 80, p_idle_days integer DEFAULT 30, p_quiet_minutes integer DEFAULT 60, p_max_rows integer DEFAULT 50000)
 RETURNS TABLE(documents_pruned integer, rows_deleted bigint, bytes_deleted bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_keep_days IS NULL OR p_keep_days < 2
     OR p_keep_rows IS NULL OR p_keep_rows < 40
     OR p_idle_days IS NULL OR p_idle_days < p_keep_days
     OR p_quiet_minutes IS NULL OR p_quiet_minutes < 10
     OR p_max_rows IS NULL OR p_max_rows < 1 THEN
    RAISE EXCEPTION 'prune_annotation_updates: unsafe settings (keep_days >= 2, keep_rows >= 40, idle_days >= keep_days, quiet_minutes >= 10)'
      USING ERRCODE = '22023';
  END IF;

  -- Victims are always a seq PREFIX per document (w36 review B): the client's
  -- pruned-tail check looks at the first row after its cursor, so the prune
  -- must never leave a hole above a surviving row. Per document the bound is
  -- the highest seq that qualifies by age; every row at or below it goes
  -- (created_at and seq can invert by a lock wait of seconds).
  RETURN QUERY
  WITH eligible AS (
    SELECT s.document_id,
           s.at_seq,
           (SELECT max(h.seq) FROM public.annotation_updates AS h
             WHERE h.document_id = s.document_id) AS head
      FROM public.annotation_snapshots AS s
     WHERE s.updated_at < now() - make_interval(mins => p_quiet_minutes)
       AND s.at_seq > 0
  ), bounds AS (
    SELECT e.document_id,
           e.at_seq,
           e.head,
           (SELECT max(u.seq) FROM public.annotation_updates AS u
             WHERE u.document_id = e.document_id
               AND u.seq < e.at_seq
               AND u.created_at < now() - make_interval(days => p_keep_days)
               AND (
                 u.seq < e.at_seq - p_keep_rows
                 OR u.created_at < now() - make_interval(days => p_idle_days)
               )) AS bound
      FROM eligible AS e
  ), victims AS (
    SELECT u.document_id, u.seq
      FROM public.annotation_updates AS u
      JOIN bounds AS b ON b.document_id = u.document_id
     WHERE b.bound IS NOT NULL
       AND u.seq <= b.bound
       AND u.seq < b.at_seq          -- covered by the stored checkpoint
       AND u.seq < b.head            -- never the head row
     ORDER BY u.document_id, u.seq   -- a cut by the limit still leaves a prefix
     LIMIT p_max_rows
  ), gone AS (
    DELETE FROM public.annotation_updates AS u
     USING victims AS v
     WHERE u.document_id = v.document_id
       AND u.seq = v.seq
    RETURNING u.document_id, octet_length(u.data) AS bytes
  )
  SELECT count(DISTINCT gone.document_id)::integer,
         count(*)::bigint,
         COALESCE(sum(gone.bytes), 0)::bigint
    FROM gone;
END;
$function$;

REVOKE ALL ON FUNCTION public.prune_annotation_updates(integer, integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_annotation_updates(integer, integer, integer, integer, integer)
  TO service_role;
COMMENT ON FUNCTION public.prune_annotation_updates(integer, integer, integer, integer, integer) IS
  'w36: delete annotation WAL rows a stored checkpoint covers (below at_seq - keep_rows, older than keep_days; all covered rows older than idle_days), never the head. Service-only; run daily by pg_cron.';

CREATE OR REPLACE FUNCTION public.prune_document_history_events(p_keep_per_document integer DEFAULT 200, p_keep_days integer DEFAULT 14, p_max_rows integer DEFAULT 50000, p_max_age_days integer DEFAULT NULL::integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_deleted bigint;
BEGIN
  IF p_keep_per_document IS NULL OR p_keep_per_document < 200
     OR p_keep_days IS NULL OR p_keep_days < 7
     OR p_max_rows IS NULL OR p_max_rows < 1
     OR (p_max_age_days IS NOT NULL AND p_max_age_days < 30) THEN
    RAISE EXCEPTION 'prune_document_history_events: unsafe settings (keep_per_document >= 200, keep_days >= 7, max_age_days NULL or >= 30)'
      USING ERRCODE = '22023';
  END IF;

  WITH ranked AS (
    SELECT e.id,
           e.event_type,
           e.occurred_at,
           row_number() OVER (
             PARTITION BY e.document_id
             ORDER BY e.occurred_at DESC, e.id DESC
           ) AS rn
      FROM public.document_history_events AS e
  ), victims AS (
    SELECT ranked.id
      FROM ranked
     WHERE (
         (ranked.rn > p_keep_per_document
          AND ranked.occurred_at < now() - make_interval(days => p_keep_days))
         -- OWNER DECISION (off by default): an age cap on the whole panel.
         OR (p_max_age_days IS NOT NULL
             AND ranked.occurred_at < now() - make_interval(days => p_max_age_days))
       )
       AND ranked.event_type NOT IN (
         'annotation_deleted',
         'callout_deleted',
         'region_deleted',
         'annotations_bulk_deleted',
         'space_deleted',
         'survey_marker_deleted'  -- w55: Survey Marker trash rows are trash too
       )
     LIMIT p_max_rows
  )
  DELETE FROM public.document_history_events AS e
   USING victims AS v
   WHERE e.id = v.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.prune_document_history_events(integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_document_history_events(integer, integer, integer, integer)
  TO service_role;
COMMENT ON FUNCTION public.prune_document_history_events(integer, integer, integer, integer) IS
  'w36: delete activity rows no History panel can show (beyond the newest keep_per_document per document, older than keep_days); delete-type trash rows excluded. Service-only; run daily by pg_cron.';

-- 3c. w55 Survey Marker trash rows -------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_delete_annotation_trash_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF current_setting('role', TRUE) = 'service_role'
       OR current_user = 'service_role'
       OR current_user = 'postgres'
       OR current_user = 'supabase_admin' THEN
        RETURN OLD;
    END IF;
    IF OLD.event_type IN (
        'annotation_deleted',
        'callout_deleted',
        'region_deleted',
        'annotations_bulk_deleted',
        'space_deleted',
        'survey_marker_deleted'
    ) THEN
        RAISE EXCEPTION
            'annotation-delete audit rows are immutable and cannot be deleted (KAL-313). '
            'event_type: %, client_event_id: %',
            OLD.event_type, OLD.client_event_id;
    END IF;
    RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sweep_annotation_trash_events(p_days integer DEFAULT 30)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_cutoff TIMESTAMPTZ;
    v_deleted INT;
BEGIN
    v_cutoff := NOW() - (p_days || ' days')::INTERVAL;
    DELETE FROM public.document_history_events
    WHERE event_type IN (
        'annotation_deleted',
        'callout_deleted',
        'region_deleted',
        'annotations_bulk_deleted',
        'space_deleted',
        'survey_marker_deleted'
    )
    AND occurred_at < v_cutoff;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$function$;

-- Rebuilt only where it still lacks the sixth delete type (never on production).
DO $w55$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'idx_document_history_events_trash_query'
       AND indexdef LIKE '%survey_marker_deleted%'
  ) THEN
    DROP INDEX IF EXISTS public.idx_document_history_events_trash_query;
    CREATE INDEX idx_document_history_events_trash_query
      ON public.document_history_events (document_id, event_type, occurred_at DESC)
      WHERE event_type IN (
        'annotation_deleted',
        'callout_deleted',
        'region_deleted',
        'annotations_bulk_deleted',
        'space_deleted',
        'survey_marker_deleted'
      );
  END IF;
END;
$w55$;

-- 3d. w54 mark lock (open editing on the Survey Marker mirror rows) ----------
DO $w54$
BEGIN
  DROP POLICY IF EXISTS "Users can update own annotations or owners can update any" ON public.document_annotations;
  DROP POLICY IF EXISTS "Users can delete own annotations or owners can delete any" ON public.document_annotations;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'document_annotations'
                  AND policyname = 'Editors can update annotations on editable documents') THEN
    CREATE POLICY "Editors can update annotations on editable documents"
      ON public.document_annotations
      FOR UPDATE
      USING (
        public.user_can_access_document(document_id, 'editor')
        AND NOT public.kal49_document_is_locked(document_id)
      )
      WITH CHECK (
        public.user_can_access_document(document_id, 'editor')
        AND NOT public.kal49_document_is_locked(document_id)
        AND (select auth.uid()) = user_id
      );
    COMMENT ON POLICY "Editors can update annotations on editable documents" ON public.document_annotations IS
      'w54 (owner ruling 2026-09-28, open editing): any editor may update any Survey Marker mirror row while the document is not locked; the per-mark user lock is enforced by trg_document_annotations_mark_lock.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'document_annotations'
                  AND policyname = 'Editors can delete annotations on editable documents') THEN
    CREATE POLICY "Editors can delete annotations on editable documents"
      ON public.document_annotations
      FOR DELETE
      USING (
        public.user_can_access_document(document_id, 'editor')
        AND NOT public.kal49_document_is_locked(document_id)
      );
    COMMENT ON POLICY "Editors can delete annotations on editable documents" ON public.document_annotations IS
      'w54 (owner ruling 2026-09-28, open editing): any editor may delete any Survey Marker mirror row while the document is not locked; the per-mark user lock is enforced by trg_document_annotations_mark_lock.';
  END IF;
END;
$w54$;

CREATE OR REPLACE FUNCTION public.w54_document_annotations_mark_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  caller uuid := auth.uid();
  doc_owner uuid;
  doc_found boolean;
  old_lock text;
  new_lock text;
  author text;
  privileged boolean;
BEGIN
  -- Service role / migrations / maintenance: no end user, no lock check.
  IF caller IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- An upsert fires BEFORE INSERT even when the row exists and the UPDATE
    -- branch will run instead; leave that case to the UPDATE check.
    IF EXISTS (
      SELECT 1 FROM public.document_annotations da
       WHERE da.document_id = NEW.document_id AND da.annotation_id = NEW.annotation_id
    ) THEN
      RETURN NEW;
    END IF;
    new_lock := NULLIF(NEW.annotation_data->>'lockedBy', '');
    IF new_lock IS NOT NULL THEN
      SELECT d.user_id INTO doc_owner FROM public.documents d WHERE d.id = NEW.document_id;
      author := NULLIF(NEW.annotation_data->>'authorId', '');
      -- A new row may arrive locked only by its author or the owner, and only
      -- stamped with the caller's own id.
      IF new_lock <> caller::text OR NOT (caller = doc_owner OR caller::text = author) THEN
        NEW.annotation_data := NEW.annotation_data - 'lockedBy';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  SELECT d.user_id, true INTO doc_owner, doc_found FROM public.documents d WHERE d.id = OLD.document_id;
  -- The document itself is being deleted (cascade): nothing to protect.
  IF doc_found IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  old_lock := NULLIF(OLD.annotation_data->>'lockedBy', '');
  author := NULLIF(OLD.annotation_data->>'authorId', '');
  privileged := (caller = doc_owner) OR (author IS NOT NULL AND caller::text = author);

  IF TG_OP = 'DELETE' THEN
    IF old_lock IS NOT NULL AND NOT privileged THEN
      RETURN NULL; -- skip: a locked row is not deleted
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE --------------------------------------------------------------

  -- The author stamp is write-once; only the owner may add or change it.
  IF (NEW.annotation_data->>'authorId') IS DISTINCT FROM author AND caller IS DISTINCT FROM doc_owner THEN
    NEW.annotation_data := CASE
      WHEN author IS NULL THEN NEW.annotation_data - 'authorId'
      ELSE jsonb_set(NEW.annotation_data, '{authorId}', to_jsonb(author))
    END;
  END IF;

  new_lock := NULLIF(NEW.annotation_data->>'lockedBy', '');
  -- Setting, clearing or changing the lock: author / owner only, and a new
  -- stamp is always the caller's own id. Otherwise the lock stays as it was.
  IF new_lock IS DISTINCT FROM old_lock
    AND (NOT privileged OR (new_lock IS NOT NULL AND new_lock <> caller::text))
  THEN
    NEW.annotation_data := CASE
      WHEN old_lock IS NULL THEN NEW.annotation_data - 'lockedBy'
      ELSE jsonb_set(NEW.annotation_data, '{lockedBy}', to_jsonb(old_lock))
    END;
    new_lock := old_lock;
  END IF;

  -- A locked row's placement and look stay as they are for everyone else.
  IF old_lock IS NOT NULL AND NOT privileged THEN
    NEW.page_number := OLD.page_number;
    NEW.bounds := OLD.bounds;
    NEW.color := OLD.color;
    NEW.opacity := OLD.opacity;
    NEW.category_id := OLD.category_id;
    NEW.module_id := OLD.module_id;
    NEW.annotation_data := jsonb_set(
      jsonb_set(NEW.annotation_data, '{unplaced}', COALESCE(OLD.annotation_data->'unplaced', 'null'::jsonb)),
      '{regionId}', COALESCE(OLD.annotation_data->'regionId', 'null'::jsonb));
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.w54_document_annotations_mark_lock() FROM PUBLIC;
COMMENT ON FUNCTION public.w54_document_annotations_mark_lock() IS
  'w54 (owner ruling 2026-09-28): per-mark user lock on Survey Marker mirror rows. Only the author (annotation_data.authorId, write-once) or the document owner (documents.user_id) may lock/unlock, move/restyle or delete a locked row; anyone else''s change to those fields is kept out (no error, so the batch mirror sync never fails). The Yjs mark store (annotation_updates) cannot be inspected by Postgres — see the file header.';

DO $w54_trigger$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.document_annotations'::regclass
                  AND tgname = 'trg_document_annotations_mark_lock') THEN
    CREATE TRIGGER trg_document_annotations_mark_lock
      BEFORE INSERT OR UPDATE OR DELETE ON public.document_annotations
      FOR EACH ROW
      EXECUTE FUNCTION public.w54_document_annotations_mark_lock();
  END IF;
END;
$w54_trigger$;

-- 4. get_current_usage ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_current_usage(p_user_id uuid, p_metric_name character varying)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    usage_count BIGINT;
BEGIN
    CASE p_metric_name
        WHEN 'projects_count' THEN
            SELECT COUNT(*) INTO usage_count
            FROM projects
            WHERE user_id = p_user_id
              AND archived = false
              AND user_archived_at IS NULL;

        WHEN 'documents_count' THEN
            SELECT COUNT(*) INTO usage_count
            FROM documents
            WHERE user_id = p_user_id
              AND archived = false
              AND user_archived_at IS NULL;

        WHEN 'storage_bytes' THEN
            SELECT COALESCE(SUM(file_size), 0) INTO usage_count
            FROM documents
            WHERE user_id = p_user_id;

        WHEN 'templates_count' THEN
            SELECT COUNT(*) INTO usage_count
            FROM templates
            WHERE user_id = p_user_id;

        WHEN 'spaces_count' THEN
            SELECT COUNT(DISTINCT s.id) INTO usage_count
            FROM spaces s
            JOIN documents d ON s.document_id = d.id
            WHERE d.user_id = p_user_id;

        ELSE
            usage_count := 0;
    END CASE;

    RETURN usage_count;
END;
$function$;

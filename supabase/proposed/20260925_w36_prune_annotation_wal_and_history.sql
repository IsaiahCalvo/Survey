-- PROPOSED — NOT APPLIED. Needs the owner's go-ahead before it touches prod
-- "Survey" (hand-managed; apply via the Management API / SQL editor, then
-- record the version). Deliberately kept OUT of supabase/migrations/:
-- .github/workflows/deploy-production.yml runs `supabase db push`, which would
-- apply anything placed there on the next production deploy.
--
-- w36 (2026-09-25): keep the database inside Supabase Free (500 MB; read-only
-- at the cap) as real use grows. Two tables grow with every edit and were
-- never pruned:
--
--   annotation_updates       the annotation WAL: ~1 row per edit, ~2 KB stored
--                            on average (live pen strokes), MBs per row for an
--                            imported PDF's marks. 49 MB on 2026-09-25.
--   document_history_events  the History panel's activity: ~1 row per edit,
--                            ~1.8 KB. 20 MB.
--
-- At 25 active users (~150 edits each per working day) each adds roughly
-- 7-8 MB per working day: ~300 MB a month together, over half of Free.
--
-- ─── 1. annotation_updates: drop rows a stored checkpoint already covers ────
--
-- Why this is safe (checked against the client, src/services/annotationDocSync.js):
--   * Every open reads the document's checkpoint (annotation_snapshots) and
--     then only rows with seq > its at_seq. Rows at or above at_seq are never
--     touched here, so no open ever needs a deleted row.
--   * The head row (MAX(seq)) is never deleted: the append trigger allocates
--     the next seq as MAX(seq)+1, so deleting the head would reuse a seq
--     below a checkpoint's at_seq. Rows are only deleted below
--     at_seq - p_keep_rows AND below the head, so the head always stays.
--   * A checkpoint's at_seq only ever moves up (store_annotation_snapshot /
--     guard_annotation_snapshot_write refuse a lower one), so reading it
--     without the document lock can only make this more conservative.
--   * Documents whose checkpoint changed in the last p_quiet_minutes are
--     skipped: an open that read the previous checkpoint may still be paging
--     its tail from that older at_seq.
--   * A tab left open that slept or stayed offline longer than p_keep_days
--     replays from an older baseline. Its catch-up now notices the missing
--     rows (seqs are gapless per document) and takes the stored checkpoint in
--     instead (w36 client change, recoverFromPrunedTail; pinned by
--     tests/annotationWalPruneRecovery.test.mjs). Builds without that change
--     would silently miss those edits until reopened, so ship the client
--     first and keep p_keep_days generous.
--   * An exact re-send of a pruned row (lost reply, live re-send) inserts a
--     new row with the same bytes: Yjs applies it as a no-op, as long as the
--     sender may still edit. KNOWN LIMIT (w36 review B): a device whose append
--     committed but whose reply was lost, that then stays closed longer than
--     p_keep_days while the document gets locked or the person loses edit
--     access, finds no receipt on reopen; the replay is refused and that
--     already-saved edit shows as a rejected local change (nothing is lost:
--     the checkpoint holds it). Keeping receipts past the prune would need a
--     small receipts table; not worth it at this scale.
--   * Nothing reads old WAL rows for history: the History panel reads
--     document_history_events; revisions use document_revisions.
--   * Realtime subscribers listen to INSERT only: deletes reach no client.
--
-- Settings (defaults):
--   p_keep_days      7   rows younger than this always stay
--   p_keep_rows      80  2 x the 40-row checkpoint boundary: what a screen
--                        that skipped a "covered" checkpoint may still replay
--   p_idle_days      30  past this age p_keep_rows no longer applies (an idle
--                        document keeps no dead tail forever)
--   p_quiet_minutes  60  skip documents whose checkpoint just changed
--   p_max_rows       50000 per run (the daily job catches up over days)

-- Pre-flight (w36 review B): DELETE on these tables is revoked from every API
-- role, so the SECURITY DEFINER functions below work only when whoever runs
-- this file (their owner, normally postgres) owns the tables. Fail here, not
-- silently every night in cron.
DO $pre$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename IN ('annotation_updates', 'document_history_events')
       AND tableowner <> current_user
  ) THEN
    RAISE EXCEPTION 'w36 prune: run this as the owner of annotation_updates and document_history_events';
  END IF;
END;
$pre$;

-- Re-runnable: an earlier draft's history prune took three arguments.
DROP FUNCTION IF EXISTS public.prune_document_history_events(integer, integer, integer);

CREATE OR REPLACE FUNCTION public.prune_annotation_updates(
  p_keep_days integer DEFAULT 7,
  p_keep_rows integer DEFAULT 80,
  p_idle_days integer DEFAULT 30,
  p_quiet_minutes integer DEFAULT 60,
  p_max_rows integer DEFAULT 50000
)
RETURNS TABLE(documents_pruned integer, rows_deleted bigint, bytes_deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.prune_annotation_updates(integer, integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_annotation_updates(integer, integer, integer, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.prune_annotation_updates(integer, integer, integer, integer, integer) IS
  'w36: delete annotation WAL rows a stored checkpoint covers (below at_seq - keep_rows, older than keep_days; all covered rows older than idle_days), never the head. Service-only; run daily by pg_cron.';

-- ─── 2. document_history_events: keep what the History panel can show ─────
--
-- The Version History panel reads the newest 200 events per document
-- (RevisionsPanel -> listDocumentHistoryEvents, limit 200); nothing else reads
-- this table. Rows beyond the newest p_keep_per_document (200, what the panel
-- shows) are never shown. At ~1.8 KB a row that caps an active document at
-- ~0.4 MB of history.
-- Delete-type rows (the trash: restore a deleted mark from its payload) are
-- never touched here; their own 30-day sweep, sweep_annotation_trash_events
-- (KAL-313), exists but was never scheduled (owner decision, below).
-- p_max_age_days (OFF unless the owner picks a value, >= 30): also drop
-- activity older than that, whatever its rank. At 25 users (~80 edits each a
-- working day, ~1.9 KB a row) activity adds ~80 MB a month; the per-document
-- cap alone only trims documents with more than 200 events, so without an age
-- cap this table becomes the database's main growth.

CREATE OR REPLACE FUNCTION public.prune_document_history_events(
  p_keep_per_document integer DEFAULT 200,
  p_keep_days integer DEFAULT 14,
  p_max_rows integer DEFAULT 50000,
  p_max_age_days integer DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
         'space_deleted'
       )
     LIMIT p_max_rows
  )
  DELETE FROM public.document_history_events AS e
   USING victims AS v
   WHERE e.id = v.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_document_history_events(integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_document_history_events(integer, integer, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.prune_document_history_events(integer, integer, integer, integer) IS
  'w36: delete activity rows no History panel can show (beyond the newest keep_per_document per document, older than keep_days); delete-type trash rows excluded. Service-only; run daily by pg_cron.';

-- ─── 3. Daily schedule (pg_cron 1.6 is installed on prod) ──────────────────
-- 03:20-03:25 UTC, after the existing archive-purge-sweep (03:00). Idempotent:
-- re-running this file replaces the jobs. Skipped where pg_cron is absent
-- (local Postgres tests).
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
       FROM cron.job
      WHERE jobname IN (
        'w36-prune-annotation-wal',
        'w36-prune-history-events'
      );
    PERFORM cron.schedule(
      'w36-prune-annotation-wal',
      '20 3 * * *',
      $job$SELECT * FROM public.prune_annotation_updates()$job$
    );
    PERFORM cron.schedule(
      'w36-prune-history-events',
      '25 3 * * *',
      $job$SELECT public.prune_document_history_events()$job$
    );
    -- OWNER DECISION (off): the KAL-313 30-day trash sweep was designed but
    -- never scheduled. Turning it on removes deleted-item restore entries
    -- older than 30 days from the History panel. To enable:
    --   SELECT cron.schedule('annotation-trash-sweep', '30 3 * * *',
    --     $job$SELECT public.sweep_annotation_trash_events(30)$job$);
  END IF;
END;
$do$;

-- ─── 4. One-time space return (run by hand, NOT part of this file) ─────────
-- DELETE frees space for reuse inside each table; the database size Supabase
-- measures only drops after a rewrite. Once, after the first nightly run, in
-- the SQL editor at a quiet moment. Each takes an exclusive lock that blocks
-- reads and writes of that table for seconds at these sizes; requests queued
-- behind it can hit the 8 s statement timeout, so pick a moment nobody works:
--   VACUUM (FULL, ANALYZE) public.annotation_updates;
--   VACUUM (FULL, ANALYZE) public.document_history_events;
-- VACUUM cannot run inside a transaction/migration, hence not here.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   SELECT cron.unschedule('w36-prune-annotation-wal');
--   SELECT cron.unschedule('w36-prune-history-events');
--   DROP FUNCTION public.prune_annotation_updates(integer, integer, integer, integer, integer);
--   DROP FUNCTION public.prune_document_history_events(integer, integer, integer, integer);
-- Deleted rows are not recoverable (except from Supabase's daily backup);
-- every open reads the checkpoint, so none of them is needed to show a document.

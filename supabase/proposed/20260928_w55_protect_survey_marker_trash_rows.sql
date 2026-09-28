-- PROPOSED - NOT APPLIED. Needs the owner's go-ahead; prod "Survey" is
-- hand-managed (apply in the SQL editor / Management API). Kept out of
-- supabase/migrations/ because deploy-production runs `supabase db push`.
--
-- w55 (2026-09-28): Survey Marker delete rows ('survey_marker_deleted') are the
-- trash for Survey Markers - their payload is the only way to restore a deleted
-- marker from History - but the KAL-313 guards list only five delete types:
--   * the nightly w36 prune (prod runs prune_document_history_events(200, 14,
--     50000, 60)) deletes them after 60 days, so their Restore disappears;
--   * the no-delete trigger lets a document owner delete them directly (and,
--     being SECURITY DEFINER, it never actually blocked ANY trash type).
-- This adds the sixth type to both, to the (unscheduled) trash sweep and to
-- the trash-view index, so every delete row is treated the same.
-- Idempotent. Rows already pruned are gone (not recoverable here).

BEGIN;

-- SECURITY INVOKER (was DEFINER): inside a SECURITY DEFINER function
-- current_user is the function OWNER (postgres), so the service-role check
-- below was always true and the guard never fired - an owner could delete any
-- trash row through the owner DELETE policy. As INVOKER, current_user is the
-- caller: 'authenticated' is refused; service_role/postgres still pass, and a
-- document's ON DELETE CASCADE runs as the table owner, so deleting a whole
-- document still works (verify once on a scratch database before prod).
CREATE OR REPLACE FUNCTION public.prevent_delete_annotation_trash_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.sweep_annotation_trash_events(p_days INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp  -- keep 20260702010000's advisor hardening
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.sweep_annotation_trash_events(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sweep_annotation_trash_events(INT) TO service_role;

DROP INDEX IF EXISTS public.idx_document_history_events_trash_query;
CREATE INDEX idx_document_history_events_trash_query
    ON public.document_history_events(document_id, event_type, occurred_at DESC)
    WHERE event_type IN (
        'annotation_deleted',
        'callout_deleted',
        'region_deleted',
        'annotations_bulk_deleted',
        'space_deleted',
        'survey_marker_deleted'
    );

-- The w36 history prune, unchanged except for the added keep-type.
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
$$;

REVOKE ALL ON FUNCTION public.prune_document_history_events(integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_document_history_events(integer, integer, integer, integer)
  TO service_role;

COMMIT;

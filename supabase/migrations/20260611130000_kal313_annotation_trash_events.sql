-- KAL-313: Annotation trash/history/restore — all annotation types.
--
-- Adds:
--   1. Composite index for trash-view query pattern
--      (document_id, event_type, occurred_at DESC).
--   2. Immutability trigger: blocks owner DELETE on annotation/callout/region
--      delete-event rows (Isaiah decision 2026-06-11, OQ-2).  These rows are
--      permanent audit entries; only the Supabase service role (migrations /
--      retention sweep) may remove them.
--   3. Retention sweep function: `sweep_annotation_trash_events(p_days INT)`
--      deletes rows whose `occurred_at` is older than `p_days` days for the
--      four delete event types.  Designed to be called by a pg_cron job or a
--      Supabase Edge Function scheduler — not invoked from client code.
--      Default retention is 30 days, matching the Survey Marker mechanism.

-- ─── 1. Trash-view index ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_document_history_events_trash_query
    ON public.document_history_events(document_id, event_type, occurred_at DESC)
    WHERE event_type IN (
        'annotation_deleted',
        'callout_deleted',
        'region_deleted',
        'annotations_bulk_deleted',
        'space_deleted'
    );

-- ─── 2. Immutability trigger ───────────────────────────────────────────────
-- Blocks any DELETE via normal RLS policies on annotation-delete audit rows.
-- The trigger fires BEFORE DELETE and raises an exception when the deleting
-- role is NOT the service_role (i.e. owner RLS policy fired, or an editor
-- somehow attempted a delete).  The service role bypasses RLS entirely, so
-- the retention sweep function (below) can still purge old rows.

CREATE OR REPLACE FUNCTION public.prevent_delete_annotation_trash_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Allow the Supabase service role (used by pg_cron / Edge Functions) to
    -- delete rows for the 30-day retention sweep.  All other callers are
    -- blocked, including the document owner via the owner DELETE RLS policy.
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
        'space_deleted'
    ) THEN
        RAISE EXCEPTION
            'annotation-delete audit rows are immutable and cannot be deleted (KAL-313). '
            'event_type: %, client_event_id: %',
            OLD.event_type, OLD.client_event_id;
    END IF;

    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_delete_annotation_trash_events
    ON public.document_history_events;

CREATE TRIGGER trg_prevent_delete_annotation_trash_events
    BEFORE DELETE ON public.document_history_events
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_delete_annotation_trash_events();

-- ─── 3. Retention sweep function ───────────────────────────────────────────
-- Must be called by a privileged role (service_role / postgres).
-- Example pg_cron call:
--   SELECT cron.schedule('annotation-trash-sweep', '0 3 * * *',
--     $$SELECT public.sweep_annotation_trash_events(30)$$);

CREATE OR REPLACE FUNCTION public.sweep_annotation_trash_events(p_days INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_cutoff TIMESTAMPTZ;
    v_deleted INT;
BEGIN
    v_cutoff := NOW() - (p_days || ' days')::INTERVAL;

    -- Bypass the immutability trigger: we ARE the service role here (the
    -- function runs SECURITY DEFINER and is granted to service_role only).
    -- The trigger checks current_user; SECURITY DEFINER sets it to the
    -- function owner (postgres/supabase_admin), which passes the guard above.
    DELETE FROM public.document_history_events
    WHERE event_type IN (
        'annotation_deleted',
        'callout_deleted',
        'region_deleted',
        'annotations_bulk_deleted',
        'space_deleted'
    )
    AND occurred_at < v_cutoff;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

-- Grant execute only to service_role (pg_cron / Edge Functions).
-- Regular users (anon, authenticated) do not get this grant.
REVOKE ALL ON FUNCTION public.sweep_annotation_trash_events(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sweep_annotation_trash_events(INT) TO service_role;

COMMENT ON FUNCTION public.sweep_annotation_trash_events(INT) IS
    'KAL-313: Delete annotation/callout/region/space/bulk-deleted history rows older than p_days days. '
    'Call via pg_cron or Edge Function scheduler. Default 30-day retention.';

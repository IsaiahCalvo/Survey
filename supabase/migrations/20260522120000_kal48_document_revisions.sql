-- KAL-48 — First-class document revision / version history (v1)
--
-- Adds an immutable per-document revision concept. Owners can snapshot the
-- full app-layer state of a document at a point in time (`v1`, `v2`, ...) and
-- reopen any prior revision read-only. Restoring a revision overwrites the
-- live document state with the snapshot, after first auto-saving a
-- "before-restore" revision so no work is ever destroyed.
--
-- v1 scope:
--   * snapshot_json captures the annotation set + survey marker rows + survey
--     item checklist responses. The PDF binary itself is NOT versioned in v1
--     (out of scope per ticket — separate follow-up).
--
-- RLS: revisions inherit access from `user_can_access_document(...)` — the
-- helper already shipped with `document_annotations` (Phase 27/Phase 28
-- migrations). Only owners can INSERT new revisions or RESTORE; viewers /
-- editors can SELECT revision metadata + payload.

-- ============================================
-- document_revisions table
-- ============================================
CREATE TABLE IF NOT EXISTS public.document_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,

    -- Per-document monotonic revision number (1, 2, 3, ...). The DB assigns
    -- this in kal48_create_revision; clients never set it.
    revision_number INTEGER NOT NULL,

    -- Optional human-readable label (e.g. "Sign-off draft" or "Pre-restore
    -- v3 snapshot"). NULL when the owner accepted the auto-generated label.
    label TEXT,

    -- Origin tag: 'manual' (owner clicked Save as Revision) or
    -- 'auto-pre-restore' (system snapshot taken before kal48_restore_revision
    -- overwrites the live state).
    origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'auto-pre-restore', 'sign-off')),

    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Inlined snapshot of the document's app-layer state at the moment the
    -- revision was created. v1 shape:
    --   {
    --     "version": 1,
    --     "annotations": [ <document_annotations rows> ],
    --     "survey_items": [ <survey_items rows for the linked session> ],
    --     "meta": { "annotation_count": <N>, "captured_at": <iso> }
    --   }
    -- We store the rows inline rather than copying them into a parallel
    -- table because v1 is intentionally lightweight. If revision volume ever
    -- becomes a storage problem, this column can be migrated to Supabase
    -- Storage with a path pointer in a follow-up migration.
    snapshot_json JSONB NOT NULL,

    UNIQUE (document_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_document_revisions_document
    ON public.document_revisions(document_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_document_revisions_created_at
    ON public.document_revisions(created_at);

ALTER TABLE public.document_revisions ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS policies
-- ============================================
-- SELECT: any collaborator on the document (viewer/commenter/editor/owner)
-- can read the revision list and snapshot payloads. This is required for
-- "open prior revision read-only" — a viewer needs to be able to load the
-- snapshot.
CREATE POLICY "Collaborators can view document revisions"
    ON public.document_revisions FOR SELECT
    USING (public.user_can_access_document(document_id, 'viewer'));

-- INSERT: only the owner. RPCs run as SECURITY DEFINER and bypass RLS for
-- their own insert; this policy guards direct table writes from clients.
CREATE POLICY "Document owners can create revisions"
    ON public.document_revisions FOR INSERT
    WITH CHECK (public.user_can_access_document(document_id, 'owner'));

-- UPDATE: blocked at policy level. Revisions are immutable. We do not even
-- allow re-labeling in v1 — if the owner wants a different label they can
-- create a new revision.
-- (No UPDATE policy = no UPDATE permitted.)

-- DELETE: owner-only. Useful for cleaning up accidental revisions before
-- they're shared externally.
CREATE POLICY "Document owners can delete revisions"
    ON public.document_revisions FOR DELETE
    USING (public.user_can_access_document(document_id, 'owner'));

-- ============================================
-- kal48_create_revision(document_id, label)
-- ============================================
-- Snapshots the current live state of a document into a new revision row.
-- Returns the inserted row. Owner-only.
CREATE OR REPLACE FUNCTION public.kal48_create_revision(
    p_document_id UUID,
    p_label TEXT DEFAULT NULL,
    p_origin TEXT DEFAULT 'manual'
)
RETURNS public.document_revisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_next_number INTEGER;
    v_snapshot JSONB;
    v_annotations JSONB;
    v_survey_items JSONB;
    v_row public.document_revisions;
BEGIN
    -- AuthZ: only owner.
    IF NOT public.user_can_access_document(p_document_id, 'owner') THEN
        RAISE EXCEPTION 'kal48_create_revision: only document owners can create revisions'
            USING ERRCODE = '42501';
    END IF;

    IF p_origin NOT IN ('manual', 'auto-pre-restore', 'sign-off') THEN
        RAISE EXCEPTION 'kal48_create_revision: unknown origin %', p_origin
            USING ERRCODE = '22023';
    END IF;

    -- Next revision number for this document.
    SELECT COALESCE(MAX(revision_number), 0) + 1
        INTO v_next_number
        FROM public.document_revisions
        WHERE document_id = p_document_id;

    -- Collect annotations (every annotation_type, not just survey markers —
    -- a revision is the full app-layer state).
    SELECT COALESCE(jsonb_agg(to_jsonb(da) ORDER BY da.created_at), '[]'::jsonb)
        INTO v_annotations
        FROM public.document_annotations da
        WHERE da.document_id = p_document_id;

    -- Collect linked survey_items (checklist responses, etc.) via any active
    -- survey_session for this document.
    SELECT COALESCE(jsonb_agg(to_jsonb(si) ORDER BY si.created_at), '[]'::jsonb)
        INTO v_survey_items
        FROM public.survey_items si
        JOIN public.survey_sessions ss ON ss.id = si.session_id
        WHERE ss.document_id = p_document_id;

    v_snapshot := jsonb_build_object(
        'version', 1,
        'annotations', v_annotations,
        'survey_items', v_survey_items,
        'meta', jsonb_build_object(
            'annotation_count', jsonb_array_length(v_annotations),
            'survey_item_count', jsonb_array_length(v_survey_items),
            'captured_at', to_jsonb(NOW())
        )
    );

    INSERT INTO public.document_revisions (
        document_id, revision_number, label, origin, created_by, snapshot_json
    )
    VALUES (
        p_document_id, v_next_number, p_label, p_origin, auth.uid(), v_snapshot
    )
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal48_create_revision(UUID, TEXT, TEXT) TO authenticated;

-- ============================================
-- kal48_list_revisions(document_id)
-- ============================================
-- Returns the metadata for every revision on this document (newest first).
-- snapshot_json is intentionally OMITTED here — clients fetch payload via
-- kal48_get_revision so the revision list stays small.
CREATE OR REPLACE FUNCTION public.kal48_list_revisions(p_document_id UUID)
RETURNS TABLE (
    id UUID,
    document_id UUID,
    revision_number INTEGER,
    label TEXT,
    origin TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ,
    annotation_count INTEGER,
    survey_item_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.user_can_access_document(p_document_id, 'viewer') THEN
        RAISE EXCEPTION 'kal48_list_revisions: access denied'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        dr.id,
        dr.document_id,
        dr.revision_number,
        dr.label,
        dr.origin,
        dr.created_by,
        dr.created_at,
        COALESCE((dr.snapshot_json -> 'meta' ->> 'annotation_count')::INTEGER, 0) AS annotation_count,
        COALESCE((dr.snapshot_json -> 'meta' ->> 'survey_item_count')::INTEGER, 0) AS survey_item_count
    FROM public.document_revisions dr
    WHERE dr.document_id = p_document_id
    ORDER BY dr.revision_number DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal48_list_revisions(UUID) TO authenticated;

-- ============================================
-- kal48_get_revision(revision_id)
-- ============================================
-- Returns the full revision row including snapshot_json so the client can
-- hydrate the read-only viewer.
CREATE OR REPLACE FUNCTION public.kal48_get_revision(p_revision_id UUID)
RETURNS public.document_revisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_row public.document_revisions;
BEGIN
    SELECT * INTO v_row
        FROM public.document_revisions
        WHERE id = p_revision_id;

    IF v_row IS NULL THEN
        RAISE EXCEPTION 'kal48_get_revision: revision % not found', p_revision_id
            USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.user_can_access_document(v_row.document_id, 'viewer') THEN
        RAISE EXCEPTION 'kal48_get_revision: access denied'
            USING ERRCODE = '42501';
    END IF;

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal48_get_revision(UUID) TO authenticated;

-- ============================================
-- kal48_restore_revision(revision_id)
-- ============================================
-- Owner-only. Atomically:
--   1. Snapshots the current live state into a NEW auto revision tagged
--      origin='auto-pre-restore' (so the prior live state is never lost).
--   2. Deletes every document_annotations row + survey_items row for this
--      document.
--   3. Re-inserts each row from the chosen revision's snapshot_json back into
--      the live tables.
--
-- Returns the new "pre-restore" revision row so the client can show the
-- user where their previous work was preserved.
CREATE OR REPLACE FUNCTION public.kal48_restore_revision(p_revision_id UUID)
RETURNS public.document_revisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_revision public.document_revisions;
    v_pre_restore public.document_revisions;
    v_annotation JSONB;
    v_survey_item JSONB;
    v_session_id UUID;
BEGIN
    SELECT * INTO v_revision
        FROM public.document_revisions
        WHERE id = p_revision_id;

    IF v_revision IS NULL THEN
        RAISE EXCEPTION 'kal48_restore_revision: revision % not found', p_revision_id
            USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.user_can_access_document(v_revision.document_id, 'owner') THEN
        RAISE EXCEPTION 'kal48_restore_revision: only document owners can restore'
            USING ERRCODE = '42501';
    END IF;

    -- 1. Save the current live state into a new auto revision.
    v_pre_restore := public.kal48_create_revision(
        v_revision.document_id,
        format('Auto: pre-restore of v%s', v_revision.revision_number),
        'auto-pre-restore'
    );

    -- 2. Clear live tables for this document.
    DELETE FROM public.document_annotations
        WHERE document_id = v_revision.document_id;

    -- Clear survey_items for any sessions bound to this document.
    DELETE FROM public.survey_items
        WHERE session_id IN (
            SELECT id FROM public.survey_sessions
            WHERE document_id = v_revision.document_id
        );

    -- 3. Re-insert from snapshot.
    FOR v_annotation IN
        SELECT * FROM jsonb_array_elements(
            COALESCE(v_revision.snapshot_json -> 'annotations', '[]'::jsonb)
        )
    LOOP
        INSERT INTO public.document_annotations (
            id, document_id, user_id, annotation_id, annotation_type,
            page_number, bounds, category_id, module_id, space_id,
            name, notes, entity_id, entity_name, checklist_responses,
            changed_by, changed_date, color, opacity, stroke_width, font_size,
            version, last_modified_by, created_at, updated_at,
            annotation_data
        )
        SELECT
            COALESCE((v_annotation->>'id')::UUID, gen_random_uuid()),
            (v_annotation->>'document_id')::UUID,
            (v_annotation->>'user_id')::UUID,
            v_annotation->>'annotation_id',
            v_annotation->>'annotation_type',
            (v_annotation->>'page_number')::INTEGER,
            COALESCE(v_annotation->'bounds', '{}'::jsonb),
            v_annotation->>'category_id',
            v_annotation->>'module_id',
            v_annotation->>'space_id',
            v_annotation->>'name',
            v_annotation->>'notes',
            v_annotation->>'entity_id',
            v_annotation->>'entity_name',
            COALESCE(v_annotation->'checklist_responses', '{}'::jsonb),
            v_annotation->>'changed_by',
            NULLIF(v_annotation->>'changed_date', '')::TIMESTAMPTZ,
            v_annotation->>'color',
            NULLIF(v_annotation->>'opacity', '')::REAL,
            NULLIF(v_annotation->>'stroke_width', '')::REAL,
            NULLIF(v_annotation->>'font_size', '')::INTEGER,
            COALESCE(NULLIF(v_annotation->>'version', '')::INTEGER, 1),
            NULLIF(v_annotation->>'last_modified_by', '')::UUID,
            COALESCE(NULLIF(v_annotation->>'created_at', '')::TIMESTAMPTZ, NOW()),
            NOW(),
            v_annotation->'annotation_data';
    END LOOP;

    FOR v_survey_item IN
        SELECT * FROM jsonb_array_elements(
            COALESCE(v_revision.snapshot_json -> 'survey_items', '[]'::jsonb)
        )
    LOOP
        v_session_id := (v_survey_item->>'session_id')::UUID;
        -- Only re-insert if the session still exists; otherwise skip
        -- (sessions are deleted independently and we don't recreate them).
        IF EXISTS (SELECT 1 FROM public.survey_sessions WHERE id = v_session_id) THEN
            INSERT INTO public.survey_items (
                id, session_id, annotation_id, module_id, category_id,
                name, page_number, bounds, entity_id, entity_name,
                changed_by, changed_date, notes, checklist_responses,
                excel_row_index, version, created_at, updated_at
            )
            VALUES (
                COALESCE((v_survey_item->>'id')::UUID, gen_random_uuid()),
                v_session_id,
                v_survey_item->>'annotation_id',
                v_survey_item->>'module_id',
                v_survey_item->>'category_id',
                v_survey_item->>'name',
                NULLIF(v_survey_item->>'page_number', '')::INTEGER,
                COALESCE(v_survey_item->'bounds', '{}'::jsonb),
                v_survey_item->>'entity_id',
                v_survey_item->>'entity_name',
                v_survey_item->>'changed_by',
                NULLIF(v_survey_item->>'changed_date', '')::TIMESTAMPTZ,
                v_survey_item->>'notes',
                COALESCE(v_survey_item->'checklist_responses', '{}'::jsonb),
                NULLIF(v_survey_item->>'excel_row_index', '')::INTEGER,
                COALESCE(NULLIF(v_survey_item->>'version', '')::INTEGER, 1),
                COALESCE(NULLIF(v_survey_item->>'created_at', '')::TIMESTAMPTZ, NOW()),
                NOW()
            );
        END IF;
    END LOOP;

    RETURN v_pre_restore;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal48_restore_revision(UUID) TO authenticated;

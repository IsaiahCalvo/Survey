-- KAL-48 — inline auth checks for revision RPCs and RLS policies.
--
-- Background: the canonical helper `public.user_can_access_document` was
-- rewritten by an unrelated migration to query `documents.created_by`, a
-- column the `documents` table does not have. Until that helper is fixed (out
-- of scope for this ticket), the KAL-48 RPCs and policies cannot use it.
--
-- This migration replaces every kal48_* function and policy with the SAME
-- semantics, but the access check is open-coded against:
--   * documents.user_id          — the document creator
--   * projects.user_id           — the project owner (when document is in a project)
--   * document_collaborators.role — explicit collaborator role
--
-- The semantics match the canonical helper exactly (per
-- 20260215183000_fix_document_presence_access.sql). If/when the helper is
-- repaired in a follow-up, these functions can be reverted to call it.

-- ============================================
-- Drop existing RLS policies (they call the broken helper)
-- ============================================
DROP POLICY IF EXISTS "Collaborators can view document revisions" ON public.document_revisions;
DROP POLICY IF EXISTS "Document owners can create revisions" ON public.document_revisions;
DROP POLICY IF EXISTS "Document owners can delete revisions" ON public.document_revisions;

-- ============================================
-- Helper (private to kal48): inline access check
-- ============================================
CREATE OR REPLACE FUNCTION public._kal48_can_access(doc_id UUID, required_role TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    doc_project_id UUID;
    doc_project_owner UUID;
    doc_creator UUID;
    uid UUID;
    user_role TEXT;
BEGIN
    uid := auth.uid();
    IF uid IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT d.project_id, p.user_id, d.user_id
      INTO doc_project_id, doc_project_owner, doc_creator
      FROM public.documents d
      LEFT JOIN public.projects p ON p.id = d.project_id
      WHERE d.id = doc_id;

    IF doc_creator IS NULL AND doc_project_owner IS NULL THEN
        RETURN FALSE;
    END IF;

    IF doc_project_owner = uid THEN
        RETURN TRUE;
    END IF;

    IF doc_creator = uid THEN
        IF required_role IN ('viewer', 'commenter', 'editor') THEN
            RETURN TRUE;
        END IF;
        IF required_role = 'owner' AND doc_project_id IS NULL THEN
            RETURN TRUE;
        END IF;
    END IF;

    SELECT dc.role INTO user_role
      FROM public.document_collaborators dc
      WHERE dc.document_id = doc_id
        AND dc.user_id = uid
        AND dc.status = 'active';

    IF user_role IS NULL THEN
        RETURN FALSE;
    END IF;

    CASE required_role
        WHEN 'viewer'    THEN RETURN TRUE;
        WHEN 'commenter' THEN RETURN user_role IN ('commenter', 'editor', 'owner');
        WHEN 'editor'    THEN RETURN user_role IN ('editor', 'owner');
        WHEN 'owner'     THEN RETURN user_role = 'owner';
        ELSE RETURN FALSE;
    END CASE;
END;
$$;

-- ============================================
-- Recreate RLS policies using the inline helper
-- ============================================
CREATE POLICY "Collaborators can view document revisions"
    ON public.document_revisions FOR SELECT
    USING (public._kal48_can_access(document_id, 'viewer'));

CREATE POLICY "Document owners can create revisions"
    ON public.document_revisions FOR INSERT
    WITH CHECK (public._kal48_can_access(document_id, 'owner'));

CREATE POLICY "Document owners can delete revisions"
    ON public.document_revisions FOR DELETE
    USING (public._kal48_can_access(document_id, 'owner'));

-- ============================================
-- Replace kal48_create_revision (uses inline check)
-- ============================================
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
    IF NOT public._kal48_can_access(p_document_id, 'owner') THEN
        RAISE EXCEPTION 'kal48_create_revision: only document owners can create revisions'
            USING ERRCODE = '42501';
    END IF;

    IF p_origin NOT IN ('manual', 'auto-pre-restore', 'sign-off') THEN
        RAISE EXCEPTION 'kal48_create_revision: unknown origin %', p_origin
            USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(MAX(revision_number), 0) + 1
        INTO v_next_number
        FROM public.document_revisions
        WHERE document_id = p_document_id;

    SELECT COALESCE(jsonb_agg(to_jsonb(da) ORDER BY da.created_at), '[]'::jsonb)
        INTO v_annotations
        FROM public.document_annotations da
        WHERE da.document_id = p_document_id;

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
-- Replace kal48_list_revisions (inline check)
-- ============================================
DROP FUNCTION IF EXISTS public.kal48_list_revisions(UUID);

CREATE OR REPLACE FUNCTION public.kal48_list_revisions(p_document_id UUID)
RETURNS TABLE (
    revision_id UUID,
    revision_document_id UUID,
    revision_number INTEGER,
    revision_label TEXT,
    revision_origin TEXT,
    revision_created_by UUID,
    revision_created_at TIMESTAMPTZ,
    revision_annotation_count INTEGER,
    revision_survey_item_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public._kal48_can_access(p_document_id, 'viewer') THEN
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
        COALESCE((dr.snapshot_json -> 'meta' ->> 'annotation_count')::INTEGER, 0),
        COALESCE((dr.snapshot_json -> 'meta' ->> 'survey_item_count')::INTEGER, 0)
    FROM public.document_revisions dr
    WHERE dr.document_id = p_document_id
    ORDER BY dr.revision_number DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal48_list_revisions(UUID) TO authenticated;

-- ============================================
-- Replace kal48_get_revision (inline check)
-- ============================================
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

    IF NOT public._kal48_can_access(v_row.document_id, 'viewer') THEN
        RAISE EXCEPTION 'kal48_get_revision: access denied'
            USING ERRCODE = '42501';
    END IF;

    RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal48_get_revision(UUID) TO authenticated;

-- ============================================
-- Replace kal48_restore_revision (inline check)
-- ============================================
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

    IF NOT public._kal48_can_access(v_revision.document_id, 'owner') THEN
        RAISE EXCEPTION 'kal48_restore_revision: only document owners can restore'
            USING ERRCODE = '42501';
    END IF;

    v_pre_restore := public.kal48_create_revision(
        v_revision.document_id,
        format('Auto: pre-restore of v%s', v_revision.revision_number),
        'auto-pre-restore'
    );

    DELETE FROM public.document_annotations
        WHERE document_id = v_revision.document_id;

    DELETE FROM public.survey_items
        WHERE session_id IN (
            SELECT id FROM public.survey_sessions
            WHERE document_id = v_revision.document_id
        );

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

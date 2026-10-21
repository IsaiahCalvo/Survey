-- Document history (revisions) used its own copy of the "who can open this
-- document" rule, _kal48_can_access, and the copy had drifted from the one
-- every other document table uses (user_can_access_document):
--   * it ignored archiving, so people a document was shared with could still
--     read its full history (every markup and survey answer) after the owner
--     moved it to the trash (KAL-426 says only the owner may);
--   * it ignored project sharing, so project members who can see and edit the
--     markups were refused the history of the same document.
-- _kal48_can_access now hands off to user_can_access_document, so there is
-- one rule. Its name stays because the document_revisions policies and the
-- kal48_* functions call it.
--
-- Restoring a version also skipped the sign-off lock: it rewrote a locked
-- document's markups, which no one, the owner included, can edit directly
-- until it is unlocked. It now refuses on a locked document.

CREATE OR REPLACE FUNCTION public._kal48_can_access(doc_id uuid, required_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(public.user_can_access_document(doc_id, required_role), false);
$$;

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

    IF public.kal49_document_is_locked(v_revision.document_id) THEN
        RAISE EXCEPTION 'kal48_restore_revision: this document is signed off; unlock it before restoring a version'
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

REVOKE ALL ON FUNCTION public.kal48_restore_revision(p_revision_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kal48_restore_revision(p_revision_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._kal48_can_access(doc_id uuid, required_role text) FROM PUBLIC;
-- anon keeps it: RLS policy expressions call it (it returns false for anon).
GRANT EXECUTE ON FUNCTION public._kal48_can_access(doc_id uuid, required_role text) TO anon, authenticated, service_role;

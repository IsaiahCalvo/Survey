-- Owner-approved 2026-10-07 ("ok, add the template list change").
-- A document's survey templates, linked by the template's owner, so a document
-- member can claim exactly those (editor if they can edit the document, viewer
-- otherwise) without the owner being online. Client side:
-- src/services/sharedTemplates.js linkDocumentTemplates / claimDocumentTemplates.

BEGIN;

CREATE TABLE IF NOT EXISTS public.document_templates (
    document_id  UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    template_id  UUID NOT NULL REFERENCES public.templates(id) ON DELETE CASCADE,
    linked_by    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (document_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_document_templates_template ON public.document_templates(template_id);

ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_templates_select ON public.document_templates;
CREATE POLICY document_templates_select
    ON public.document_templates FOR SELECT
    USING (public.user_can_access_document(document_id, 'viewer'));

-- Only the template's owner links it, and only to a document they can edit.
DROP POLICY IF EXISTS document_templates_insert ON public.document_templates;
CREATE POLICY document_templates_insert
    ON public.document_templates FOR INSERT
    WITH CHECK (
        linked_by = auth.uid()
        AND public.user_can_access_template(template_id, 'owner')
        AND public.user_can_access_document(document_id, 'editor')
    );

DROP POLICY IF EXISTS document_templates_delete ON public.document_templates;
CREATE POLICY document_templates_delete
    ON public.document_templates FOR DELETE
    USING (
        public.user_can_access_template(template_id, 'owner')
        OR public.user_can_access_document(document_id, 'owner')
    );

-- A document member takes the templates linked to that document.
CREATE OR REPLACE FUNCTION public.claim_document_templates(p_document_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role  TEXT;
    v_email TEXT;
    v_count INTEGER := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'claim_document_templates: must be authenticated';
    END IF;

    IF public.user_can_access_document(p_document_id, 'editor') THEN
        v_role := 'editor';
    ELSIF public.user_can_access_document(p_document_id, 'viewer') THEN
        v_role := 'viewer';
    ELSE
        RETURN 0;
    END IF;

    SELECT email::TEXT INTO v_email FROM auth.users WHERE id = auth.uid();

    INSERT INTO public.template_collaborators (template_id, user_id, email, role, status, invited_by)
    SELECT dt.template_id, auth.uid(), v_email, v_role, 'active', dt.linked_by
      FROM public.document_templates dt
      JOIN public.templates t ON t.id = dt.template_id
     WHERE dt.document_id = p_document_id
       AND t.user_id = dt.linked_by          -- the linker still owns it
       AND t.user_id <> auth.uid()
       AND t.user_archived_at IS NULL
    ON CONFLICT (template_id, user_id) DO UPDATE
       SET role = 'editor'
     WHERE public.template_collaborators.status = 'active'
       AND public.template_collaborators.role = 'viewer'
       AND EXCLUDED.role = 'editor';

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_document_templates(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_document_templates(UUID) TO authenticated;
-- Supabase's default privileges also grant anon; signed-in users only.
REVOKE EXECUTE ON FUNCTION public.claim_document_templates(UUID) FROM anon;

COMMIT;

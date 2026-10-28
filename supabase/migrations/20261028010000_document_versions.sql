-- Version history per document (Drawboard Projects audit item 1, Nightly
-- behind the 'document-versions' flag). "Upload as new version" used to
-- archive the old copy. With the flag on, the old copy instead points at the
-- copy that replaced it (documents.superseded_by): it leaves the lists but
-- stays readable by everyone who can open the document, is never swept by
-- the archive cleanup, and the viewer lists the whole chain as versions.
--
-- superseded_by changes only inside supersede_document(), which checks the
-- caller may edit the old copy and owns the new one, and that both sit in the
-- same project; document_versions() returns the chain the caller can open.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS documents_superseded_by_idx
  ON public.documents (superseded_by)
  WHERE superseded_by IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_documents_superseded_by()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.superseded_by IS DISTINCT FROM (CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.superseded_by END)
     AND COALESCE(auth.role(), '') <> 'service_role'
     AND COALESCE(current_setting('app.supersede_document_id', true), '') <> NEW.id::text
     -- Deleting the newer copy clears the link (ON DELETE SET NULL).
     AND NOT (TG_OP = 'UPDATE' AND NEW.superseded_by IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.id = OLD.superseded_by)) THEN
    RAISE EXCEPTION 'documents.superseded_by is set only by supersede_document'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_documents_superseded_by ON public.documents;
CREATE TRIGGER trg_documents_superseded_by
  BEFORE INSERT OR UPDATE OF superseded_by ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_documents_superseded_by();

CREATE OR REPLACE FUNCTION public.supersede_document(p_old_document_id uuid, p_new_document_id uuid)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_old public.documents;
  v_new public.documents;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_old_document_id IS NULL OR p_new_document_id IS NULL OR p_old_document_id = p_new_document_id THEN
    RAISE EXCEPTION 'Two different documents are needed' USING ERRCODE = '22023';
  END IF;

  -- Lock both rows in a fixed order so two uploads cannot cross.
  PERFORM 1 FROM public.documents
    WHERE id IN (p_old_document_id, p_new_document_id)
    ORDER BY id
    FOR UPDATE;
  SELECT * INTO v_old FROM public.documents WHERE id = p_old_document_id;
  SELECT * INTO v_new FROM public.documents WHERE id = p_new_document_id;

  -- Same answer for "no such row" and "not allowed": no existence oracle.
  IF v_old.id IS NULL OR v_new.id IS NULL
     OR v_new.user_id IS DISTINCT FROM v_uid
     OR NOT COALESCE(public.user_can_access_document(v_old.id, 'editor'), false) THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = '42501';
  END IF;
  IF v_old.project_id IS DISTINCT FROM v_new.project_id THEN
    RAISE EXCEPTION 'A new version must be in the same project' USING ERRCODE = '22023';
  END IF;
  IF v_old.superseded_by IS NOT NULL THEN
    IF v_old.superseded_by = v_new.id THEN
      RETURN v_old; -- a retry after a lost response
    END IF;
    RAISE EXCEPTION 'That document already has a newer version' USING ERRCODE = '22023';
  END IF;
  IF v_new.superseded_by IS NOT NULL OR COALESCE(v_old.archived, false) OR COALESCE(v_new.archived, false) THEN
    RAISE EXCEPTION 'Only current documents can be versions of each other' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.supersede_document_id', v_old.id::text, true);
  UPDATE public.documents
     SET superseded_by = v_new.id, updated_at = now()
   WHERE id = v_old.id
  RETURNING * INTO v_old;
  PERFORM set_config('app.supersede_document_id', '', true);
  RETURN v_old;
END;
$$;

-- The version chain a document belongs to, oldest first, as far as the caller
-- can open each copy. version_number counts from 1 over the whole chain, so a
-- copy keeps its number even when an older one is hidden from this caller.
CREATE OR REPLACE FUNCTION public.document_versions(p_document_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  created_at timestamptz,
  page_count integer,
  version_number integer,
  is_current boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_head uuid := p_document_id;
  v_next uuid;
  v_steps integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.user_can_access_document(p_document_id, 'viewer'), false) THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = '42501';
  END IF;
  -- Walk forward to the newest copy (bounded, so a bad loop cannot spin).
  LOOP
    SELECT d.superseded_by INTO v_next FROM public.documents d WHERE d.id = v_head;
    EXIT WHEN v_next IS NULL OR v_steps >= 500;
    v_head := v_next;
    v_steps := v_steps + 1;
  END LOOP;

  RETURN QUERY
  WITH RECURSIVE chain AS (
    SELECT d.id, d.name, d.created_at, d.page_count, 0 AS depth
      FROM public.documents d
     WHERE d.id = v_head
    UNION ALL
    SELECT d.id, d.name, d.created_at, d.page_count, c.depth + 1
      FROM public.documents d
      JOIN chain c ON d.superseded_by = c.id
     WHERE c.depth < 500
  ),
  numbered AS (
    SELECT c.*, (count(*) OVER () - c.depth)::integer AS version_number
      FROM chain c
  )
  SELECT n.id, n.name::text, n.created_at, n.page_count, n.version_number, n.depth = 0
    FROM numbered n
   WHERE COALESCE(public.user_can_access_document(n.id, 'viewer'), false)
   ORDER BY n.version_number;
END;
$$;

REVOKE ALL ON FUNCTION public.supersede_document(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supersede_document(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.document_versions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_versions(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_documents_superseded_by() FROM PUBLIC, anon, authenticated;

-- Flag: Version history (beta, Survey Nightly only). Keep in step with
-- src/featureFlags.js.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('document-versions', 'off', 'Version history: a new version keeps the old ones, with old-over-new compare.')
ON CONFLICT (key) DO NOTHING;

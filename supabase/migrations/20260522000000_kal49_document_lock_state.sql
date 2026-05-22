-- KAL-49 — Document sign-off / release / lock state (v1 minimum viable).
--
-- Surveyors need a way to declare a document "final" and prevent further edits
-- by anyone (including themselves) until they explicitly unlock. v1 ships the
-- bare minimum:
--   * Three nullable columns on `documents` capturing the lock event.
--   * Two SECURITY DEFINER RPCs gated to the document owner: lock + unlock.
--   * RLS update on `document_annotations` so INSERT/UPDATE/DELETE deny when
--     `documents.locked_at IS NOT NULL` for *all* roles (owner included). Read
--     access is unchanged so viewers/editors can still see the final state.
--
-- Out of scope (KAL-49 follow-ups):
--   * Multi-step approval workflows.
--   * Per-page sign-off / status enum (draft/in_progress/signed_off/archived).
--   * Yjs / storage / surveyMarkers RLS gating — those layers are already
--     gated by `user_can_access_document(_, 'editor')` which we leave alone in
--     v1; the annotation table is the canonical write surface and is the
--     contract the verification harness checks.

BEGIN;

-- Lock metadata. `locked_at` is the truth-source — `IS NOT NULL` == locked.
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS locked_label TEXT;

COMMENT ON COLUMN public.documents.locked_at IS
  'KAL-49: when the document was signed off / locked. NULL means unlocked.';
COMMENT ON COLUMN public.documents.locked_by IS
  'KAL-49: user_id (owner) who locked the document. NULL when unlocked.';
COMMENT ON COLUMN public.documents.locked_label IS
  'KAL-49: optional free-text label captured at lock time (e.g. "Final v1").';

-- Helper: gate an arbitrary document_id by lock state. SECURITY DEFINER so the
-- function can read documents.locked_at even when the calling RLS context
-- otherwise wouldn't (e.g. inside an annotation INSERT policy that doesn't
-- itself grant a SELECT on documents). Kept STABLE so the planner can hoist.
CREATE OR REPLACE FUNCTION public.kal49_document_is_locked(doc_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT locked_at FROM public.documents WHERE id = doc_id), NULL) IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.kal49_document_is_locked(UUID) TO authenticated;
COMMENT ON FUNCTION public.kal49_document_is_locked(UUID) IS
  'KAL-49: returns TRUE when the named document has a non-NULL locked_at, used by annotation RLS to deny writes while locked.';

-- RPC: lock a document. Only the document owner can call (RLS-style check
-- inside the function — SECURITY DEFINER bypass means we MUST hand-roll the
-- ownership check). Idempotent on lock — locking an already-locked doc updates
-- locked_label only (keeps the original locked_at to preserve the audit moment).
CREATE OR REPLACE FUNCTION public.kal49_lock_document(
  doc_id UUID,
  label TEXT DEFAULT NULL
)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  owner_id UUID;
  updated public.documents;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'kal49_lock_document: not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO owner_id FROM public.documents WHERE id = doc_id;
  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'kal49_lock_document: document not found' USING ERRCODE = '42P01';
  END IF;

  IF owner_id <> caller THEN
    RAISE EXCEPTION 'kal49_lock_document: only the document owner can lock' USING ERRCODE = '42501';
  END IF;

  UPDATE public.documents
     SET locked_at = COALESCE(locked_at, NOW()),
         locked_by = COALESCE(locked_by, caller),
         locked_label = CASE WHEN label IS NULL THEN locked_label ELSE label END
   WHERE id = doc_id
   RETURNING * INTO updated;

  RETURN updated;
END;
$$;
GRANT EXECUTE ON FUNCTION public.kal49_lock_document(UUID, TEXT) TO authenticated;
COMMENT ON FUNCTION public.kal49_lock_document(UUID, TEXT) IS
  'KAL-49: owner-only RPC to lock a document. Idempotent on locked_at; optional label overwrites the previous label.';

-- RPC: unlock a document. Owner-only; clears all three lock columns.
CREATE OR REPLACE FUNCTION public.kal49_unlock_document(doc_id UUID)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  owner_id UUID;
  updated public.documents;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'kal49_unlock_document: not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO owner_id FROM public.documents WHERE id = doc_id;
  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'kal49_unlock_document: document not found' USING ERRCODE = '42P01';
  END IF;

  IF owner_id <> caller THEN
    RAISE EXCEPTION 'kal49_unlock_document: only the document owner can unlock' USING ERRCODE = '42501';
  END IF;

  UPDATE public.documents
     SET locked_at = NULL,
         locked_by = NULL,
         locked_label = NULL
   WHERE id = doc_id
   RETURNING * INTO updated;

  RETURN updated;
END;
$$;
GRANT EXECUTE ON FUNCTION public.kal49_unlock_document(UUID) TO authenticated;
COMMENT ON FUNCTION public.kal49_unlock_document(UUID) IS
  'KAL-49: owner-only RPC to unlock a document, restoring write capability for all roles.';

-- RLS update: layer a "not locked" predicate onto every annotation write
-- policy. Reads are intentionally unchanged — viewers/editors keep seeing the
-- frozen state. We DROP+CREATE rather than ALTER POLICY because Postgres can't
-- add a WHERE-clause atomically to an existing policy; the previous policies
-- come from migration 20260513010000.
DROP POLICY IF EXISTS "Users can insert own annotations on editable documents" ON public.document_annotations;
DROP POLICY IF EXISTS "Users can update own annotations or owners can update any" ON public.document_annotations;
DROP POLICY IF EXISTS "Users can delete own annotations or owners can delete any" ON public.document_annotations;

CREATE POLICY "Users can insert own annotations on editable documents"
  ON public.document_annotations
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.user_can_access_document(document_id, 'editor')
    AND NOT public.kal49_document_is_locked(document_id)
  );

CREATE POLICY "Users can update own annotations or owners can update any"
  ON public.document_annotations
  FOR UPDATE
  USING (
    (
      (auth.uid() = user_id AND public.user_can_access_document(document_id, 'editor'))
      OR public.user_can_access_document(document_id, 'owner')
    )
    AND NOT public.kal49_document_is_locked(document_id)
  )
  WITH CHECK (
    (
      (auth.uid() = user_id AND public.user_can_access_document(document_id, 'editor'))
      OR public.user_can_access_document(document_id, 'owner')
    )
    AND NOT public.kal49_document_is_locked(document_id)
  );

CREATE POLICY "Users can delete own annotations or owners can delete any"
  ON public.document_annotations
  FOR DELETE
  USING (
    (
      (auth.uid() = user_id AND public.user_can_access_document(document_id, 'editor'))
      OR public.user_can_access_document(document_id, 'owner')
    )
    AND NOT public.kal49_document_is_locked(document_id)
  );

COMMENT ON POLICY "Users can insert own annotations on editable documents" ON public.document_annotations IS
  'KAL-49: same as fix-26 contract, plus deny INSERT when the document is locked (locked_at IS NOT NULL).';
COMMENT ON POLICY "Users can update own annotations or owners can update any" ON public.document_annotations IS
  'KAL-49: same as fix-26 contract, plus deny UPDATE when the document is locked (locked_at IS NOT NULL).';
COMMENT ON POLICY "Users can delete own annotations or owners can delete any" ON public.document_annotations IS
  'KAL-49: same as fix-26 contract, plus deny DELETE when the document is locked (locked_at IS NOT NULL).';

COMMIT;

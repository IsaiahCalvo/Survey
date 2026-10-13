-- PROPOSED — NOT APPLIED. OWNER DECISION. Kept OUT of supabase/migrations/
-- (deploy-production.yml runs `supabase db push`, which would apply anything
-- there). Prod "Survey" is hand-managed: apply in the SQL editor / Management
-- API only after the owner says yes, then record the version.
--
-- w54 (2026-09-28) — owner rulings "open editing + lock":
--   1. Anyone who can edit a document may move, restyle, cut or delete ANY
--      mark — other people's and Survey Markers included — with no pop-up and
--      no block (safety = Undo + History + the lock).
--   3. Any mark can be locked / unlocked from the right-click menu. A locked
--      mark cannot be moved, resized, restyled, cut, deleted or erased by
--      anyone except its author or the document owner (they unlock first).
--
-- WHAT THE SERVER CAN AND CANNOT SEE (read before applying):
--
--   * Ordinary marks, callouts AND the live copy of every Survey Marker are
--     stored as Yjs binary updates in public.annotation_updates, appended
--     through append_annotation_update(). Postgres cannot decode Yjs, and one
--     update does not even say which mark it touches without the whole
--     document's history. So NO RLS policy or trigger can tell "this update
--     moves a locked mark". The editor / viewer wall and the whole-document
--     lock (kal49) are already enforced there and stay as they are. The
--     per-mark lock is enforced on EVERY client path (one shared rule in
--     src/lib/collab/permissionScope.js + a save guard every page write
--     passes, src/utils/markLock.js), but a modified client could still
--     append an update that moves a locked mark. Closing that needs a
--     validating append: an edge function / server that holds the document's
--     Y.Doc, applies each update in a scratch copy, rejects it if a locked
--     mark changed, and is the ONLY writer (revoke append_annotation_update
--     and INSERT on annotation_updates from `authenticated`). That is a new
--     service with real cost and latency on every stroke — a separate owner
--     decision; not in this file.
--
--   * public.document_annotations holds a per-row mirror of every Survey
--     Marker (the app re-upserts it ~2 s after a change; it feeds the
--     cross-document checklist-usage count). Rows ARE inspectable, so this
--     file does two things there:
--       A. opens UPDATE / DELETE to every editor (ruling 1). Today only the
--          row's last writer or an owner may update / delete it, so a
--          contributor's edit to a colleague's Survey Marker cannot reach the
--          mirror (and the RLS error switches the mirror sync off for the
--          session).
--       B. adds a lock trigger: while a row's annotation_data.lockedBy is set,
--          nobody but its author (annotation_data.authorId, written by the app
--          from w54 on, write-once) or the document owner (documents.user_id —
--          the same owner the app uses) may change its placement / look or
--          delete it; only they may set or clear the lock, and only as
--          themselves. Anyone else's change to those fields is KEPT OUT, not
--          raised as an error, so the app's one-batch mirror sync never fails.
--          Answers, name and notes stay editable (the lock covers moving,
--          resizing, restyling, cutting, deleting and erasing).
--       Note: the opened policies cover every row type in the table; only
--       Survey Markers are still written there (legacy mark rows stopped
--       2026-08-21, see proposed/20260925_w36_legacy_annotation_tables_cleanup.sql).
--
-- Idempotent: safe to run twice.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- A. Open editing on the Survey Marker mirror rows.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can update own annotations or owners can update any" ON public.document_annotations;
DROP POLICY IF EXISTS "Users can delete own annotations or owners can delete any" ON public.document_annotations;
DROP POLICY IF EXISTS "Editors can update annotations on editable documents" ON public.document_annotations;
DROP POLICY IF EXISTS "Editors can delete annotations on editable documents" ON public.document_annotations;

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
    -- The app writes the syncing user into user_id / last_modified_by; the
    -- mark's author lives in annotation_data.authorId.
    AND (select auth.uid()) = user_id
  );

CREATE POLICY "Editors can delete annotations on editable documents"
  ON public.document_annotations
  FOR DELETE
  USING (
    public.user_can_access_document(document_id, 'editor')
    AND NOT public.kal49_document_is_locked(document_id)
  );

COMMENT ON POLICY "Editors can update annotations on editable documents" ON public.document_annotations IS
  'w54 (owner ruling 2026-09-28, open editing): any editor may update any Survey Marker mirror row while the document is not locked; the per-mark user lock is enforced by trg_document_annotations_mark_lock.';
COMMENT ON POLICY "Editors can delete annotations on editable documents" ON public.document_annotations IS
  'w54 (owner ruling 2026-09-28, open editing): any editor may delete any Survey Marker mirror row while the document is not locked; the per-mark user lock is enforced by trg_document_annotations_mark_lock.';

-- ---------------------------------------------------------------------------
-- B. The per-mark user lock on mirror rows.
--
-- The app re-sends EVERY Survey Marker row in one upsert on each mirror sync,
-- so a refused row must never fail the whole batch (an RLS-class error turns
-- the mirror off for the session). The trigger therefore KEEPS what the lock
-- protects instead of raising: a locked row's placement / look / lock stay as
-- they were, a delete of it is skipped, a lock stamped by someone who may not
-- set it is dropped. Everything else in the row (answers, name, notes) goes
-- through. Who counts as allowed:
--   * the document owner (documents.user_id — the owner the app uses);
--   * the row's author (annotation_data.authorId). The author stamp is
--     write-once: set on INSERT, and on an older row that has none only the
--     document owner may add it (so nobody can claim a colleague's mark and
--     then lock it). An unattributed row's lock is the owner's alone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.w54_document_annotations_mark_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.w54_document_annotations_mark_lock() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_document_annotations_mark_lock ON public.document_annotations;
CREATE TRIGGER trg_document_annotations_mark_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.document_annotations
  FOR EACH ROW
  EXECUTE FUNCTION public.w54_document_annotations_mark_lock();

COMMENT ON FUNCTION public.w54_document_annotations_mark_lock() IS
  'w54 (owner ruling 2026-09-28): per-mark user lock on Survey Marker mirror rows. Only the author (annotation_data.authorId, write-once) or the document owner (documents.user_id) may lock/unlock, move/restyle or delete a locked row; anyone else''s change to those fields is kept out (no error, so the batch mirror sync never fails). The Yjs mark store (annotation_updates) cannot be inspected by Postgres — see the file header.';

COMMIT;

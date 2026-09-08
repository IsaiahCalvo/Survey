-- Keep the existing annotation role rules, but hold their authority through
-- commit. A fresh permission read alone does not fence a concurrent revocation.
-- No PDF generation, entitlement, archive, or account policy changes here.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION survey_private.guard_annotation_write_authority()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid := auth.uid();
  doc_owner_id uuid;
  doc_project_id uuid;
  direct_role text;
BEGIN
  -- Reject before inspecting locks or parent rows. Keep the current role
  -- ladder, including a direct viewer overriding an inherited editor role.
  IF caller IS NULL
     OR public.user_can_access_document(NEW.document_id, 'editor') IS NOT TRUE
     OR public.kal49_document_is_locked(NEW.document_id) THEN
    RAISE EXCEPTION 'annotation write is not permitted' USING ERRCODE = '42501';
  END IF;

  -- Parent tuple locks also fence a membership INSERT where no row existed.
  -- They do not create a newer tuple version, so an old repeatable-read
  -- snapshot could still miss that insert. PostgREST's normal READ COMMITTED
  -- writes can recheck with a fresh statement snapshot after taking the locks.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Annotation writes require READ COMMITTED' USING ERRCODE = '25001';
  END IF;

  -- A direct snapshot UPDATE already owns its snapshot tuple. Never wait for
  -- the WAL advisory lock from there. RPC callers already hold this same lock;
  -- PostgreSQL permits reacquiring it within the same transaction.
  IF NOT pg_try_advisory_xact_lock(hashtextextended(NEW.document_id::text, 0)) THEN
    RAISE EXCEPTION 'annotation write contention' USING ERRCODE = '40001';
  END IF;

  SELECT d.user_id, d.project_id INTO doc_owner_id, doc_project_id FROM public.documents d
    WHERE d.id = NEW.document_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'annotation write is not permitted' USING ERRCODE = '42501';
  END IF;
  IF doc_owner_id IS DISTINCT FROM caller AND doc_project_id IS NOT NULL THEN
    -- The document lock freezes direct membership changes, including an absent
    -- row becoming present. Only the inherited-role branch needs a project
    -- lock. Owners and direct editors can save during project metadata changes.
    SELECT dc.role INTO direct_role FROM public.document_collaborators dc
      WHERE dc.document_id = NEW.document_id AND dc.user_id = caller AND dc.status = 'active';
    IF direct_role IS NULL THEN
      PERFORM p.id FROM public.projects p WHERE p.id = doc_project_id FOR SHARE NOWAIT;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'annotation write is not permitted' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- These parent SHARE locks conflict with membership guards below and with
  -- direct document lock/owner/project changes. Hold them through commit.
  IF public.user_can_access_document(NEW.document_id, 'editor') IS NOT TRUE
     OR public.kal49_document_is_locked(NEW.document_id) THEN
    RAISE EXCEPTION 'annotation write is not permitted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.guard_annotation_membership_change()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_parent uuid;
  new_parent uuid;
BEGIN
  -- Lock parents, not just existing membership rows: adding a direct viewer
  -- can remove a user's inherited edit right. Unchanged policy fields need no
  -- exclusive parent lock (e.g. a membership's display metadata update).
  IF TG_TABLE_NAME = 'document_collaborators' THEN
    IF TG_OP <> 'INSERT' THEN old_parent := OLD.document_id; END IF;
    IF TG_OP <> 'DELETE' THEN new_parent := NEW.document_id; END IF;
  ELSIF TG_TABLE_NAME = 'project_collaborators' THEN
    IF TG_OP <> 'INSERT' THEN old_parent := OLD.project_id; END IF;
    IF TG_OP <> 'DELETE' THEN new_parent := NEW.project_id; END IF;
  ELSE
    RAISE EXCEPTION 'Unexpected annotation membership table' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND old_parent IS NOT DISTINCT FROM new_parent
     AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id
     AND OLD.role IS NOT DISTINCT FROM NEW.role
     AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- A row trigger can already hold the membership tuple. NOWAIT prevents a
  -- reverse parent/child lock wait. A conflict rolls the whole statement back;
  -- the caller retries the membership change after the active write commits.
  -- Cascaded parent deletion is safe: that transaction already owns the parent
  -- lock, and a parent no longer visible to its own cascade needs no new lock.
  IF TG_TABLE_NAME = 'document_collaborators' THEN
    PERFORM d.id FROM public.documents d
      WHERE d.id = ANY(ARRAY[old_parent, new_parent]) ORDER BY d.id FOR UPDATE NOWAIT;
  ELSE
    PERFORM p.id FROM public.projects p
      WHERE p.id = ANY(ARRAY[old_parent, new_parent]) ORDER BY p.id FOR UPDATE NOWAIT;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION survey_private.guard_annotation_write_authority() OWNER TO postgres;
ALTER FUNCTION survey_private.guard_annotation_membership_change() OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.guard_annotation_write_authority(),
  survey_private.guard_annotation_membership_change() FROM PUBLIC, anon, authenticated, service_role;

-- Separate triggers avoid changing the existing immutable receipt fast paths
-- in append_annotation_update/store_annotation_snapshot. This also covers raw
-- table INSERT/UPDATE, including legacy upsert clients using those tables.
CREATE OR REPLACE TRIGGER a_annotation_write_authority
  BEFORE INSERT ON public.annotation_updates
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_annotation_write_authority();
CREATE OR REPLACE TRIGGER a_annotation_write_authority
  BEFORE INSERT OR UPDATE ON public.annotation_snapshots
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_annotation_write_authority();
CREATE OR REPLACE TRIGGER a_annotation_membership_change
  BEFORE INSERT OR UPDATE OR DELETE ON public.document_collaborators
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_annotation_membership_change();
CREATE OR REPLACE TRIGGER a_annotation_membership_change
  BEFORE INSERT OR UPDATE OR DELETE ON public.project_collaborators
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_annotation_membership_change();

COMMIT;

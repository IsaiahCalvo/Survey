-- KAL-31 — Phase A
-- Forward migration: remove `commenter` from the active product role set.
--
-- Product spec (locked, see KAL-31 Linear comment 2026-05-21 17:00 + doc 9164fae3):
--   Public UX roles are exactly: viewer, editor, owner.
--   Owner means co-owner/admin permissions for v1, not ownership transfer.
--   Multiple owners are allowed; the system must always keep >= 1 owner.
--   `commenter` is removed from the public role set. We migrate any existing
--   `commenter` rows up to `viewer` because the closest non-edit access is
--   read-only, and we tighten the CHECK constraints so no new `commenter`
--   rows can be inserted going forward.
--
-- This migration is intentionally idempotent and forward-only. Old historical
-- migrations are left untouched. RLS role-hierarchy helpers are also updated
-- so role checks no longer reference `commenter`.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Migrate existing rows
-- ---------------------------------------------------------------------------

UPDATE public.document_collaborators
   SET role = 'viewer'
 WHERE role = 'commenter';

UPDATE public.project_collaborators
   SET role = 'viewer'
 WHERE role = 'commenter';

-- ---------------------------------------------------------------------------
-- 2. Tighten CHECK constraints — drop any older variant, then add the new one.
-- ---------------------------------------------------------------------------

-- document_collaborators
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    SELECT conname INTO constraint_name
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
     WHERE n.nspname = 'public'
       AND t.relname = 'document_collaborators'
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ILIKE '%role%commenter%';

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.document_collaborators DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

ALTER TABLE public.document_collaborators
    DROP CONSTRAINT IF EXISTS document_collaborators_role_check;

ALTER TABLE public.document_collaborators
    ADD CONSTRAINT document_collaborators_role_check
    CHECK (role IN ('viewer', 'editor', 'owner'));

-- project_collaborators
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    SELECT conname INTO constraint_name
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
     WHERE n.nspname = 'public'
       AND t.relname = 'project_collaborators'
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ILIKE '%role%commenter%';

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.project_collaborators DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

ALTER TABLE public.project_collaborators
    DROP CONSTRAINT IF EXISTS project_collaborators_role_check;

ALTER TABLE public.project_collaborators
    ADD CONSTRAINT project_collaborators_role_check
    CHECK (role IN ('viewer', 'editor', 'owner'));

-- ---------------------------------------------------------------------------
-- 3. Update RLS role-hierarchy helpers — remove `commenter` branches.
--    Historical helpers are recreated with the trimmed role set. We keep the
--    SECURITY DEFINER + empty search_path + STABLE attributes from the
--    Phase 28 / 20260215 versions because RLS depends on them.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.user_can_access_document(doc_id UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    user_role TEXT;
BEGIN
    -- Owner fast path: document creator always wins.
    IF EXISTS (
        SELECT 1 FROM public.documents
         WHERE id = doc_id AND created_by = auth.uid()
    ) THEN
        IF required_role IN ('viewer', 'editor') THEN
            RETURN TRUE;
        ELSIF required_role = 'owner' THEN
            RETURN TRUE; -- creator is implicitly an owner
        END IF;
    END IF;

    SELECT role INTO user_role
      FROM public.document_collaborators
     WHERE document_id = doc_id
       AND user_id = auth.uid()
       AND status = 'active';

    IF user_role IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Role hierarchy: owner > editor > viewer.
    CASE required_role
        WHEN 'viewer' THEN RETURN user_role IN ('viewer', 'editor', 'owner');
        WHEN 'editor' THEN RETURN user_role IN ('editor', 'owner');
        WHEN 'owner'  THEN RETURN user_role = 'owner';
        ELSE RETURN FALSE;
    END CASE;
END;
$$;

COMMENT ON FUNCTION public.user_can_access_document(UUID, TEXT) IS
  'KAL-31 — Role hierarchy: owner > editor > viewer. `commenter` removed from the active role set as of 2026-05-21. Owner is co-owner/admin per locked spec.';

CREATE OR REPLACE FUNCTION public.user_can_access_project(proj_id UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    user_role TEXT;
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.projects
         WHERE id = proj_id AND created_by = auth.uid()
    ) THEN
        RETURN TRUE;
    END IF;

    SELECT role INTO user_role
      FROM public.project_collaborators
     WHERE project_id = proj_id
       AND user_id = auth.uid()
       AND status = 'active';

    IF user_role IS NULL THEN
        RETURN FALSE;
    END IF;

    CASE required_role
        WHEN 'viewer' THEN RETURN user_role IN ('viewer', 'editor', 'owner');
        WHEN 'editor' THEN RETURN user_role IN ('editor', 'owner');
        WHEN 'owner'  THEN RETURN user_role = 'owner';
        ELSE RETURN FALSE;
    END CASE;
END;
$$;

COMMENT ON FUNCTION public.user_can_access_project(UUID, TEXT) IS
  'KAL-31 — Role hierarchy: owner > editor > viewer. `commenter` removed.';

-- ---------------------------------------------------------------------------
-- 4. Last-owner protection trigger
--    The locked spec requires that every shared document keep >= 1 active owner.
--    A user cannot remove or demote the last remaining owner.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.kal31_guard_last_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    remaining_owners INT;
    target_doc UUID;
    affected_old_role TEXT;
BEGIN
    -- We only block when an existing owner is being demoted or removed.
    IF (TG_OP = 'UPDATE') THEN
        affected_old_role := OLD.role;
        target_doc := OLD.document_id;
        IF affected_old_role = 'owner' AND NEW.role <> 'owner' THEN
            SELECT COUNT(*) INTO remaining_owners
              FROM public.document_collaborators
             WHERE document_id = target_doc
               AND role = 'owner'
               AND status = 'active'
               AND user_id <> OLD.user_id;
            IF remaining_owners < 1 THEN
                RAISE EXCEPTION 'kal31_guard_last_owner: at least one owner must remain on document %', target_doc
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    ELSIF (TG_OP = 'DELETE') THEN
        affected_old_role := OLD.role;
        target_doc := OLD.document_id;
        IF affected_old_role = 'owner' THEN
            SELECT COUNT(*) INTO remaining_owners
              FROM public.document_collaborators
             WHERE document_id = target_doc
               AND role = 'owner'
               AND status = 'active'
               AND user_id <> OLD.user_id;
            IF remaining_owners < 1 THEN
                RAISE EXCEPTION 'kal31_guard_last_owner: cannot remove last owner of document %', target_doc
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS kal31_guard_last_owner_trg ON public.document_collaborators;
CREATE TRIGGER kal31_guard_last_owner_trg
    BEFORE UPDATE OR DELETE ON public.document_collaborators
    FOR EACH ROW EXECUTE FUNCTION public.kal31_guard_last_owner();

COMMENT ON FUNCTION public.kal31_guard_last_owner() IS
  'KAL-31 — Enforces "at least one owner must remain" rule on document_collaborators.';

COMMIT;

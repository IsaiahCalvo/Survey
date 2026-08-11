-- KAL-426 — Safe data + permission foundation for the 30-day user Archive.
--
-- WHY A SECOND SET OF COLUMNS:
-- `documents.archived` / `projects.archived` already exist and mean something
-- completely different — they are the Free-tier downgrade flag set by
-- archive_excess_documents()/archive_excess_projects() (20241226000002).
-- Those rows must NEVER appear in the user's Archive and must NEVER be purged
-- after 30 days. So the user Archive gets its own, unmistakably named columns
-- and never reads or writes the plan-limit `archived` boolean.
--
-- INTENDED UX (KAL-280, owner-approved 2026-07-20):
--   * Only the row's permanent owner (documents.user_id) may archive, restore,
--     or delete forever. A collaborator whose ROLE is 'owner' may not.
--   * While archived the item vanishes for every collaborator but their rows
--     and roles stay stored, so restore silently brings their access back.
--   * A project and its documents archive/restore as ONE group with ONE expiry.
--   * Retention is exactly 30 days from the successful archive operation.

-- ============================================================================
-- 1. USER-ARCHIVE COLUMNS
-- ============================================================================
-- user_archived_at        NULL  => the item is live. Non-NULL => in the Archive.
-- user_archive_expires_at when the 30-day retention ends (KAL-431 purges past it).
-- user_archived_by        who pressed Archive (always the permanent owner today,
--                         kept as its own column so a future admin/support purge
--                         is still attributable).
-- archive_group_id        NULL on a standalone archived item. Non-NULL means the
--                         row belongs to a project Archive group: the project and
--                         each of its documents share one id, so the Archive
--                         screen renders them as a single expandable item.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS user_archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user_archive_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user_archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_group_id UUID;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS user_archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user_archive_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user_archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_group_id UUID;

ALTER TABLE public.templates
  ADD COLUMN IF NOT EXISTS user_archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user_archive_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user_archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_group_id UUID;

COMMENT ON COLUMN public.documents.user_archived_at IS
  'KAL-426 user Archive. NULL = live. Unrelated to documents.archived (Free-tier downgrade flag).';
COMMENT ON COLUMN public.documents.user_archive_expires_at IS
  'KAL-426 user Archive. Exactly 30 days after the successful archive operation.';
COMMENT ON COLUMN public.documents.archive_group_id IS
  'KAL-426 user Archive. Non-NULL = this document is a child of an archived project group.';
COMMENT ON COLUMN public.projects.user_archived_at IS
  'KAL-426 user Archive. NULL = live. Unrelated to projects.archived (Free-tier downgrade flag).';
COMMENT ON COLUMN public.projects.archive_group_id IS
  'KAL-426 user Archive. The group id shared with every document archived alongside this project.';
COMMENT ON COLUMN public.templates.user_archived_at IS
  'KAL-426 user Archive. NULL = live.';

-- Partial indexes: the Archive screen only ever reads the small archived slice,
-- and every live list query reads the (much larger) user_archived_at IS NULL side.
CREATE INDEX IF NOT EXISTS idx_documents_user_archived
  ON public.documents(user_id, user_archived_at DESC)
  WHERE user_archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_archive_group
  ON public.documents(archive_group_id)
  WHERE archive_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_user_archived
  ON public.projects(user_id, user_archived_at DESC)
  WHERE user_archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_templates_user_archived
  ON public.templates(user_id, user_archived_at DESC)
  WHERE user_archived_at IS NOT NULL;
-- KAL-431 will sweep expired rows across all three tables by this column.
CREATE INDEX IF NOT EXISTS idx_documents_archive_expiry
  ON public.documents(user_archive_expires_at)
  WHERE user_archive_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_archive_expiry
  ON public.projects(user_archive_expires_at)
  WHERE user_archive_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_templates_archive_expiry
  ON public.templates(user_archive_expires_at)
  WHERE user_archive_expires_at IS NOT NULL;

-- ============================================================================
-- 2. RETENTION CONSTANT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.archive_retention_interval()
RETURNS INTERVAL
LANGUAGE sql
IMMUTABLE
AS $$ SELECT INTERVAL '30 days' $$;

COMMENT ON FUNCTION public.archive_retention_interval() IS
  'KAL-426 — single source of truth for the Archive retention window. The screen, the services and KAL-431 all derive from this.';

-- ============================================================================
-- 3. ACCESS HELPERS — archived items are owner-only
-- ============================================================================
-- These wrap the existing role-ladder helpers rather than replacing them: the
-- ONLY behavioural change is that a user-archived row stops resolving for
-- anyone except its permanent owner. Existing collaborator rows are untouched,
-- so restore returns access with no extra bookkeeping.

CREATE OR REPLACE FUNCTION public.user_can_access_document(doc_id UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    doc_owner_id UUID;
    doc_project_id UUID;
    doc_archived_at TIMESTAMPTZ;
    user_role TEXT;
BEGIN
    SELECT user_id, project_id, user_archived_at
      INTO doc_owner_id, doc_project_id, doc_archived_at
      FROM public.documents
     WHERE id = doc_id;

    IF doc_owner_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- KAL-426: an archived document exists only for its permanent owner.
    IF doc_archived_at IS NOT NULL THEN
        RETURN doc_owner_id = auth.uid();
    END IF;

    IF doc_owner_id = auth.uid() THEN
        RETURN TRUE;
    END IF;

    SELECT role INTO user_role
      FROM public.document_collaborators
     WHERE document_id = doc_id AND user_id = auth.uid() AND status = 'active';

    IF user_role IS NULL AND doc_project_id IS NOT NULL THEN
        SELECT role INTO user_role
          FROM public.project_collaborators
         WHERE project_id = doc_project_id AND user_id = auth.uid() AND status = 'active';

        IF user_role IS NULL THEN
            SELECT 'owner' INTO user_role
              FROM public.projects
             WHERE id = doc_project_id AND user_id = auth.uid();
        END IF;
    END IF;

    IF user_role IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN CASE required_role
        WHEN 'viewer' THEN user_role IN ('viewer', 'editor', 'owner')
        WHEN 'editor' THEN user_role IN ('editor', 'owner')
        WHEN 'owner'  THEN user_role = 'owner'
        ELSE FALSE
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_can_access_project(proj_id UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    proj_owner_id UUID;
    proj_archived_at TIMESTAMPTZ;
    user_role TEXT;
BEGIN
    SELECT user_id, user_archived_at
      INTO proj_owner_id, proj_archived_at
      FROM public.projects
     WHERE id = proj_id;

    IF proj_owner_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- KAL-426: an archived project exists only for its permanent owner.
    IF proj_archived_at IS NOT NULL THEN
        RETURN proj_owner_id = auth.uid();
    END IF;

    IF proj_owner_id = auth.uid() THEN
        RETURN TRUE;
    END IF;

    SELECT role INTO user_role
      FROM public.project_collaborators
     WHERE project_id = proj_id AND user_id = auth.uid() AND status = 'active';

    IF user_role IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN CASE required_role
        WHEN 'viewer' THEN user_role IN ('viewer', 'editor', 'owner')
        WHEN 'editor' THEN user_role IN ('editor', 'owner')
        WHEN 'owner'  THEN user_role = 'owner'
        ELSE FALSE
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_can_access_template(tpl_id UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    tpl_owner_id UUID;
    tpl_archived_at TIMESTAMPTZ;
    user_role TEXT;
BEGIN
    SELECT user_id, user_archived_at
      INTO tpl_owner_id, tpl_archived_at
      FROM public.templates
     WHERE id = tpl_id;

    IF tpl_owner_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- KAL-426: an archived template exists only for its permanent owner.
    IF tpl_archived_at IS NOT NULL THEN
        RETURN tpl_owner_id = auth.uid();
    END IF;

    IF tpl_owner_id = auth.uid() THEN
        RETURN TRUE;
    END IF;

    SELECT role INTO user_role
      FROM public.template_collaborators
     WHERE template_id = tpl_id AND user_id = auth.uid() AND status = 'active';

    IF user_role IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN CASE required_role
        WHEN 'viewer' THEN user_role IN ('viewer', 'editor', 'owner')
        WHEN 'editor' THEN user_role IN ('editor', 'owner')
        WHEN 'owner'  THEN user_role = 'owner'
        ELSE FALSE
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_document_role(doc_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    doc_owner_id UUID;
    doc_project_id UUID;
    doc_archived_at TIMESTAMPTZ;
    user_role TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT user_id, project_id, user_archived_at
      INTO doc_owner_id, doc_project_id, doc_archived_at
      FROM public.documents
     WHERE id = doc_id;

    IF doc_owner_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- KAL-426: while archived only the permanent owner has any role at all.
    IF doc_archived_at IS NOT NULL THEN
        RETURN CASE WHEN doc_owner_id = auth.uid() THEN 'owner' ELSE NULL END;
    END IF;

    IF doc_owner_id = auth.uid() THEN
        RETURN 'owner';
    END IF;

    SELECT role INTO user_role
      FROM public.document_collaborators
     WHERE document_id = doc_id AND user_id = auth.uid() AND status = 'active';

    IF user_role IS NULL AND doc_project_id IS NOT NULL THEN
        SELECT role INTO user_role
          FROM public.project_collaborators
         WHERE project_id = doc_project_id AND user_id = auth.uid() AND status = 'active';

        IF user_role IS NULL THEN
            SELECT 'owner' INTO user_role
              FROM public.projects
             WHERE id = doc_project_id AND user_id = auth.uid();
        END IF;
    END IF;

    RETURN user_role;
END;
$$;

GRANT EXECUTE ON FUNCTION public.archive_retention_interval() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_document(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_project(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_template(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_document_role(UUID) TO authenticated;

-- ============================================================================
-- 4. OWNER-ONLY ARCHIVE / RESTORE OPERATIONS
-- ============================================================================
-- Every operation is SECURITY DEFINER and asserts `user_id = auth.uid()` on the
-- row itself, so bypassing the screen and calling the RPC directly still fails
-- for editors, viewers and collaborator-'owner's. All of them are idempotent:
-- a repeated call re-reports the same result instead of double-archiving,
-- accidentally restoring, or half-deleting.

CREATE OR REPLACE FUNCTION public.archive_document(p_document_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner UUID;
    v_archived_at TIMESTAMPTZ;
    v_group UUID;
    v_now TIMESTAMPTZ := now();
BEGIN
    SELECT user_id, user_archived_at, archive_group_id
      INTO v_owner, v_archived_at, v_group
      FROM public.documents
     WHERE id = p_document_id
       FOR UPDATE;

    IF v_owner IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
    IF v_owner <> auth.uid() THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
    END IF;

    -- Idempotent: already archived stays exactly as it is, expiry included.
    IF v_archived_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'ok', true, 'already', true, 'document_id', p_document_id,
            'archived_at', v_archived_at, 'archive_group_id', v_group);
    END IF;

    UPDATE public.documents
       SET user_archived_at = v_now,
           user_archive_expires_at = v_now + public.archive_retention_interval(),
           user_archived_by = auth.uid(),
           -- Standalone archive: no group, so the Archive screen shows it as a
           -- top-level row. A later project archive adopts it into its group.
           archive_group_id = NULL
     WHERE id = p_document_id;

    RETURN jsonb_build_object(
        'ok', true, 'already', false, 'document_id', p_document_id,
        'archived_at', v_now,
        'expires_at', v_now + public.archive_retention_interval());
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_document(p_document_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner UUID;
    v_archived_at TIMESTAMPTZ;
    v_group UUID;
    v_project UUID;
BEGIN
    SELECT user_id, user_archived_at, archive_group_id, project_id
      INTO v_owner, v_archived_at, v_group, v_project
      FROM public.documents
     WHERE id = p_document_id
       FOR UPDATE;

    IF v_owner IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
    IF v_owner <> auth.uid() THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
    END IF;
    IF v_archived_at IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'already', true, 'document_id', p_document_id);
    END IF;
    -- A project child is descriptive only: restore the whole project instead.
    IF v_group IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'project_child', 'archive_group_id', v_group);
    END IF;

    -- Clears ONLY the user-Archive fields. `archived` (the Free-tier downgrade
    -- flag) and project_id are deliberately untouched, which is what returns the
    -- document to the project it came from.
    UPDATE public.documents
       SET user_archived_at = NULL,
           user_archive_expires_at = NULL,
           user_archived_by = NULL,
           archive_group_id = NULL
     WHERE id = p_document_id;

    RETURN jsonb_build_object(
        'ok', true, 'already', false,
        'document_id', p_document_id, 'project_id', v_project);
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_project(p_project_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner UUID;
    v_archived_at TIMESTAMPTZ;
    v_group UUID;
    v_now TIMESTAMPTZ := now();
    v_children INTEGER;
BEGIN
    SELECT user_id, user_archived_at, archive_group_id
      INTO v_owner, v_archived_at, v_group
      FROM public.projects
     WHERE id = p_project_id
       FOR UPDATE;

    IF v_owner IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
    IF v_owner <> auth.uid() THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
    END IF;
    IF v_archived_at IS NOT NULL THEN
        SELECT COUNT(*) INTO v_children
          FROM public.documents WHERE archive_group_id = v_group;
        RETURN jsonb_build_object(
            'ok', true, 'already', true, 'project_id', p_project_id,
            'archive_group_id', v_group, 'document_count', v_children);
    END IF;

    v_group := gen_random_uuid();

    UPDATE public.projects
       SET user_archived_at = v_now,
           user_archive_expires_at = v_now + public.archive_retention_interval(),
           user_archived_by = auth.uid(),
           archive_group_id = v_group
     WHERE id = p_project_id;

    -- All-or-nothing: this UPDATE and the one above share the function's single
    -- transaction, so a failure anywhere leaves no half-archived project. Every
    -- document in the project is swept in — INCLUDING one the user had already
    -- archived on its own, which is reset into this group and given the
    -- project's fresh 30-day expiry (KAL-429).
    UPDATE public.documents
       SET user_archived_at = v_now,
           user_archive_expires_at = v_now + public.archive_retention_interval(),
           user_archived_by = auth.uid(),
           archive_group_id = v_group
     WHERE project_id = p_project_id
       AND user_id = v_owner;

    GET DIAGNOSTICS v_children = ROW_COUNT;

    RETURN jsonb_build_object(
        'ok', true, 'already', false, 'project_id', p_project_id,
        'archive_group_id', v_group, 'document_count', v_children,
        'archived_at', v_now,
        'expires_at', v_now + public.archive_retention_interval());
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_project(p_project_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner UUID;
    v_archived_at TIMESTAMPTZ;
    v_group UUID;
    v_children INTEGER;
BEGIN
    SELECT user_id, user_archived_at, archive_group_id
      INTO v_owner, v_archived_at, v_group
      FROM public.projects
     WHERE id = p_project_id
       FOR UPDATE;

    IF v_owner IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
    IF v_owner <> auth.uid() THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
    END IF;
    IF v_archived_at IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'already', true, 'project_id', p_project_id);
    END IF;

    -- One action restores the project and every grouped document. Collaborator
    -- rows were never touched, so prior roles come back on their own.
    UPDATE public.documents
       SET user_archived_at = NULL,
           user_archive_expires_at = NULL,
           user_archived_by = NULL,
           archive_group_id = NULL
     WHERE archive_group_id = v_group;

    GET DIAGNOSTICS v_children = ROW_COUNT;

    UPDATE public.projects
       SET user_archived_at = NULL,
           user_archive_expires_at = NULL,
           user_archived_by = NULL,
           archive_group_id = NULL
     WHERE id = p_project_id;

    RETURN jsonb_build_object(
        'ok', true, 'already', false, 'project_id', p_project_id,
        'document_count', v_children);
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_template(p_template_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner UUID;
    v_archived_at TIMESTAMPTZ;
    v_now TIMESTAMPTZ := now();
BEGIN
    SELECT user_id, user_archived_at
      INTO v_owner, v_archived_at
      FROM public.templates
     WHERE id = p_template_id
       FOR UPDATE;

    IF v_owner IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
    IF v_owner <> auth.uid() THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
    END IF;
    IF v_archived_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'already', true, 'template_id', p_template_id);
    END IF;

    -- The whole template — entities, categories, checklist items, settings and
    -- ordering all live inside templates.config (JSONB) — is preserved by
    -- flipping these four columns and nothing else. Sharing rows and invites are
    -- separate tables that are likewise left alone.
    UPDATE public.templates
       SET user_archived_at = v_now,
           user_archive_expires_at = v_now + public.archive_retention_interval(),
           user_archived_by = auth.uid(),
           archive_group_id = NULL
     WHERE id = p_template_id;

    RETURN jsonb_build_object(
        'ok', true, 'already', false, 'template_id', p_template_id,
        'archived_at', v_now,
        'expires_at', v_now + public.archive_retention_interval());
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_template(p_template_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner UUID;
    v_archived_at TIMESTAMPTZ;
BEGIN
    SELECT user_id, user_archived_at
      INTO v_owner, v_archived_at
      FROM public.templates
     WHERE id = p_template_id
       FOR UPDATE;

    IF v_owner IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
    IF v_owner <> auth.uid() THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
    END IF;
    IF v_archived_at IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'already', true, 'template_id', p_template_id);
    END IF;

    UPDATE public.templates
       SET user_archived_at = NULL,
           user_archive_expires_at = NULL,
           user_archived_by = NULL,
           archive_group_id = NULL
     WHERE id = p_template_id;

    RETURN jsonb_build_object('ok', true, 'already', false, 'template_id', p_template_id);
END;
$$;

-- ============================================================================
-- 5. PERMANENT DELETE
-- ============================================================================
-- These delete the owned database rows only. Stored PDF bytes are removed by
-- the caller, because storage is content-addressed and shared: the RPC reports
-- which file_paths became unreferenced by ANY surviving document row, and the
-- service deletes exactly those. KAL-431's 30-day purge job will call the same
-- functions. Everything below refuses to touch a live (non-archived) item.

CREATE OR REPLACE FUNCTION public.purge_archived_document(p_document_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner UUID;
    v_archived_at TIMESTAMPTZ;
    v_file_path TEXT;
    v_orphaned TEXT[] := ARRAY[]::TEXT[];
BEGIN
    SELECT user_id, user_archived_at, file_path
      INTO v_owner, v_archived_at, v_file_path
      FROM public.documents
     WHERE id = p_document_id
       FOR UPDATE;

    -- Idempotent: a second identical request finds nothing and reports success.
    IF v_owner IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'already', true, 'orphaned_paths', v_orphaned);
    END IF;
    IF v_owner <> auth.uid() THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
    END IF;
    IF v_archived_at IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_archived');
    END IF;

    -- ON DELETE CASCADE clears marks, history, snapshots, revisions, invites,
    -- collaborators, presence and every Excel-sync table off this row.
    DELETE FROM public.documents WHERE id = p_document_id;

    IF v_file_path IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.documents WHERE file_path = v_file_path
    ) THEN
        v_orphaned := ARRAY[v_file_path];
    END IF;

    RETURN jsonb_build_object(
        'ok', true, 'already', false,
        'document_id', p_document_id, 'orphaned_paths', v_orphaned);
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_archived_project(p_project_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner UUID;
    v_archived_at TIMESTAMPTZ;
    v_group UUID;
    v_paths TEXT[];
    v_orphaned TEXT[] := ARRAY[]::TEXT[];
    v_deleted INTEGER;
BEGIN
    SELECT user_id, user_archived_at, archive_group_id
      INTO v_owner, v_archived_at, v_group
      FROM public.projects
     WHERE id = p_project_id
       FOR UPDATE;

    IF v_owner IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'already', true, 'orphaned_paths', v_orphaned);
    END IF;
    IF v_owner <> auth.uid() THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
    END IF;
    IF v_archived_at IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_archived');
    END IF;

    SELECT COALESCE(array_agg(DISTINCT file_path) FILTER (WHERE file_path IS NOT NULL), ARRAY[]::TEXT[])
      INTO v_paths
      FROM public.documents
     WHERE project_id = p_project_id
       AND user_archived_at IS NOT NULL;

    -- KAL-431 SAFETY FIX 2026-08-07: only ever destroy documents that were
    -- ARCHIVED as part of this project. archive_project() archives just the
    -- project owner's rows, so a collaborator's document stays LIVE inside a
    -- shared project -- and the original unfiltered DELETE destroyed it with no
    -- archive entry and no undo. A live row is never purge-able, full stop.
    --
    -- documents.project_id is ON DELETE CASCADE, so dropping the project row
    -- below would take any surviving live document with it. Detach them first:
    -- losing the folder association is recoverable, losing the document is not.
    UPDATE public.documents
       SET project_id = NULL
     WHERE project_id = p_project_id
       AND user_archived_at IS NULL;

    DELETE FROM public.documents
     WHERE project_id = p_project_id
       AND user_archived_at IS NOT NULL;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    DELETE FROM public.projects WHERE id = p_project_id;

    -- Only paths no surviving document still points at are safe to unlink.
    SELECT COALESCE(array_agg(p), ARRAY[]::TEXT[]) INTO v_orphaned
      FROM unnest(v_paths) AS p
     WHERE NOT EXISTS (SELECT 1 FROM public.documents WHERE file_path = p);

    RETURN jsonb_build_object(
        'ok', true, 'already', false, 'project_id', p_project_id,
        'document_count', v_deleted, 'orphaned_paths', v_orphaned);
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_archived_template(p_template_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner UUID;
    v_archived_at TIMESTAMPTZ;
BEGIN
    SELECT user_id, user_archived_at
      INTO v_owner, v_archived_at
      FROM public.templates
     WHERE id = p_template_id
       FOR UPDATE;

    IF v_owner IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'already', true);
    END IF;
    IF v_owner <> auth.uid() THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
    END IF;
    IF v_archived_at IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_archived');
    END IF;

    -- CASCADE removes template_collaborators and template_invites.
    DELETE FROM public.templates WHERE id = p_template_id;

    RETURN jsonb_build_object('ok', true, 'already', false, 'template_id', p_template_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.archive_document(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_document(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_project(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_project(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_template(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_template(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_archived_document(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_archived_project(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_archived_template(UUID) TO authenticated;

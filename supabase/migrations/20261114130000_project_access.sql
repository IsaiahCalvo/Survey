-- Projects: project settings and access (Drawboard Projects parity PS-01..21).
--
-- Nightly flag `project-access` (keep in step with src/featureFlags.js).
--
-- Drawboard's "Change settings" card holds a cover image, the name, a
-- description and the project's access: Private (only people invited) or
-- Public (everyone in the workspace, with one role for all of them). Its
-- Archive keeps a project editable but out of the main list, and any member
-- but the owner can Leave a project.
--
-- Survey's version:
--   * projects.cover_path   a picture in the private `project-photos` bucket,
--                           <project uuid>/cover-<1..999999>.<jpg|png|webp>
--   * projects.company_access ('viewer' | 'editor' | NULL = private) and
--     projects.company_id   "Everyone in my company gets <role>". Access still
--                           flows through project_collaborators: every company
--                           member gets a row with access_source = 'company',
--                           so user_can_access_project() and every policy that
--                           calls it stay exactly as they are.
--   * projects.closed_at / closed_by   "Close project": out of the main list,
--                           still fully usable; owner only.
--   * Leave project: a member deletes their own collaborator row.
--
-- Access and close are owner-only and change only through the functions
-- below; a trigger refuses direct writes to those columns.

-- 1. Flag ---------------------------------------------------------------------
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('project-access', 'off', 'Project settings: cover image, description, company access, close project, leave project')
ON CONFLICT (key) DO NOTHING;

-- 2. Columns ------------------------------------------------------------------
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS cover_path text,
  ADD COLUMN IF NOT EXISTS company_access text,
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_company_access_check') THEN
    ALTER TABLE public.projects ADD CONSTRAINT projects_company_access_check
      CHECK (company_access IS NULL OR company_access IN ('viewer', 'editor'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_company_access_needs_company') THEN
    ALTER TABLE public.projects ADD CONSTRAINT projects_company_access_needs_company
      CHECK (company_access IS NULL OR company_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_cover_path_shape') THEN
    ALTER TABLE public.projects ADD CONSTRAINT projects_cover_path_shape
      CHECK (cover_path IS NULL OR cover_path ~ ('^' || id::text || '/cover-[1-9][0-9]{0,5}\.(jpg|png|webp)$'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS projects_company_access_idx ON public.projects (company_id) WHERE company_access IS NOT NULL;

ALTER TABLE public.project_collaborators
  ADD COLUMN IF NOT EXISTS access_source text NOT NULL DEFAULT 'invite';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_collaborators_access_source_check') THEN
    ALTER TABLE public.project_collaborators ADD CONSTRAINT project_collaborators_access_source_check
      CHECK (access_source IN ('invite', 'company'));
  END IF;
END $$;

-- 3. Cover pictures share the photos bucket -----------------------------------
-- Same function as 20261114120000_project_photos.sql, plus the cover shape.
CREATE OR REPLACE FUNCTION public.project_photo_object_project_id(object_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-m[1-9][0-9]{0,5})?\.(jpg|jpeg|png|webp)$'
    THEN substring(object_name from 1 for 36)::uuid
    WHEN object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/cover-[1-9][0-9]{0,5}\.(jpg|png|webp)$'
    THEN substring(object_name from 1 for 36)::uuid
    ELSE NULL
  END
$$;
REVOKE ALL ON FUNCTION public.project_photo_object_project_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_photo_object_project_id(text) TO authenticated;

-- 4. Guard: access and close change only through the functions ----------------
CREATE OR REPLACE FUNCTION public.projects_guard_access_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (NEW.company_access IS DISTINCT FROM OLD.company_access
      OR NEW.company_id IS DISTINCT FROM OLD.company_id
      OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
      OR NEW.closed_by IS DISTINCT FROM OLD.closed_by)
     AND coalesce(current_setting('survey.project_access', true), '') <> 'on'
     -- The service role (deploy scripts, support) may still fix a row.
     AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'use project settings to change access' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.projects_guard_access_columns() FROM PUBLIC;
DROP TRIGGER IF EXISTS projects_guard_access_columns ON public.projects;
CREATE TRIGGER projects_guard_access_columns
  BEFORE UPDATE OF company_access, company_id, closed_at, closed_by ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_guard_access_columns();

-- 5. Company rows: add / update / remove for one project ----------------------
CREATE OR REPLACE FUNCTION public._project_company_sync(p_project uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_org uuid;
  v_role text;
BEGIN
  SELECT user_id, company_id, company_access INTO v_owner, v_org, v_role
    FROM public.projects WHERE id = p_project;
  IF v_owner IS NULL THEN RETURN; END IF;

  PERFORM set_config('survey.project_access', 'on', true);

  IF v_role IS NULL OR v_org IS NULL THEN
    DELETE FROM public.project_collaborators
     WHERE project_id = p_project AND access_source = 'company';
    RETURN;
  END IF;

  -- Gone from the company: remove.
  DELETE FROM public.project_collaborators c
   WHERE c.project_id = p_project AND c.access_source = 'company'
     AND NOT EXISTS (SELECT 1 FROM public.organization_members m
                      WHERE m.organization_id = v_org AND m.user_id = c.user_id);
  -- Still in it: follow the project's company role.
  UPDATE public.project_collaborators c SET role = v_role, status = 'active'
   WHERE c.project_id = p_project AND c.access_source = 'company'
     AND (c.role IS DISTINCT FROM v_role OR c.status IS DISTINCT FROM 'active');
  -- New: add. An existing invite row (any role, any status) is left alone so
  -- a person invited as Editor never drops to the company's Viewer.
  INSERT INTO public.project_collaborators (project_id, user_id, role, status, email, invited_by, access_source)
  SELECT p_project, m.user_id, v_role, 'active', u.email, v_owner, 'company'
    FROM public.organization_members m
    JOIN auth.users u ON u.id = m.user_id
   WHERE m.organization_id = v_org
     AND m.user_id <> v_owner
     AND NOT EXISTS (SELECT 1 FROM public.project_collaborators c
                      WHERE c.project_id = p_project AND c.user_id = m.user_id)
  ON CONFLICT (project_id, user_id) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public._project_company_sync(uuid) FROM PUBLIC, anon, authenticated;

-- 6. Owner-facing functions ---------------------------------------------------
-- p_role NULL = Private. Returns the number of company members who can now
-- open the project (0 for Private).
CREATE OR REPLACE FUNCTION public.set_project_access(p_project uuid, p_role text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_org uuid;
  v_old text;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR public.is_guest_session() OR public.is_agent_session() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_role IS NOT NULL AND p_role NOT IN ('viewer', 'editor') THEN
    RAISE EXCEPTION 'bad role' USING ERRCODE = '22023';
  END IF;
  SELECT user_id, company_access INTO v_owner, v_old FROM public.projects
   WHERE id = p_project AND user_archived_at IS NULL;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'only the project owner can change access' USING ERRCODE = '42501';
  END IF;
  IF p_role IS NOT NULL THEN
    v_org := public._org_of_user(v_owner);
    IF v_org IS NULL THEN
      RAISE EXCEPTION 'join or create a company first' USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM set_config('survey.project_access', 'on', true);
  UPDATE public.projects
     SET company_access = p_role,
         company_id = CASE WHEN p_role IS NULL THEN NULL ELSE v_org END
   WHERE id = p_project;
  PERFORM public._project_company_sync(p_project);

  IF v_old IS DISTINCT FROM p_role THEN
    PERFORM public.project_event_add(p_project, 'project_access', p_project, NULL,
      coalesce(v_old, 'private'), coalesce(p_role, 'private'));
  END IF;

  IF p_role IS NOT NULL THEN
    SELECT count(*)::integer INTO v_count FROM public.project_collaborators
     WHERE project_id = p_project AND status = 'active' AND user_id <> v_owner;
  END IF;
  PERFORM set_config('survey.project_access', '', true);
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.set_project_access(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_project_access(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_project_closed(p_project uuid, p_closed boolean)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_was timestamptz;
  v_at timestamptz := CASE WHEN p_closed THEN now() ELSE NULL END;
BEGIN
  IF auth.uid() IS NULL OR public.is_guest_session() OR public.is_agent_session() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT user_id, closed_at INTO v_owner, v_was FROM public.projects
   WHERE id = p_project AND user_archived_at IS NULL;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'only the project owner can close a project' USING ERRCODE = '42501';
  END IF;
  IF (v_was IS NOT NULL) = coalesce(p_closed, false) THEN
    RETURN v_was;
  END IF;
  PERFORM set_config('survey.project_access', 'on', true);
  UPDATE public.projects
     SET closed_at = v_at, closed_by = CASE WHEN p_closed THEN auth.uid() ELSE NULL END
   WHERE id = p_project;
  PERFORM set_config('survey.project_access', '', true);
  PERFORM public.project_event_add(p_project, CASE WHEN p_closed THEN 'project_closed' ELSE 'project_reopened' END,
    p_project, NULL, NULL, NULL);
  RETURN v_at;
END;
$$;
REVOKE ALL ON FUNCTION public.set_project_closed(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_project_closed(uuid, boolean) TO authenticated;

-- 7. Company membership changes follow into company projects ------------------
CREATE OR REPLACE FUNCTION public.project_company_members_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project uuid;
  v_org uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
BEGIN
  FOR v_project IN
    SELECT id FROM public.projects WHERE company_id = v_org AND company_access IS NOT NULL
  LOOP
    PERFORM public._project_company_sync(v_project);
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN others THEN
  -- Never block a company change; the next settings save re-syncs.
  RAISE WARNING 'project company sync skipped: %', sqlerrm;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.project_company_members_follow() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS project_company_members_follow ON public.organization_members;
CREATE TRIGGER project_company_members_follow
  AFTER INSERT OR DELETE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.project_company_members_follow();

-- An owner who changes a company member's role by hand makes that person an
-- invited member, so the next company sync leaves the new role alone.
CREATE OR REPLACE FUNCTION public.project_collaborators_keep_hand_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.access_source = 'company' AND NEW.role IS DISTINCT FROM OLD.role
     AND coalesce(current_setting('survey.project_access', true), '') <> 'on' THEN
    NEW.access_source := 'invite';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.project_collaborators_keep_hand_role() FROM PUBLIC;
DROP TRIGGER IF EXISTS project_collaborators_keep_hand_role ON public.project_collaborators;
CREATE TRIGGER project_collaborators_keep_hand_role
  BEFORE UPDATE OF role ON public.project_collaborators
  FOR EACH ROW EXECUTE FUNCTION public.project_collaborators_keep_hand_role();

-- 8. Leave project ------------------------------------------------------------
-- A member removes their own row. The owner's row (role 'owner' or the
-- project's user_id) can never be removed this way.
DROP POLICY IF EXISTS "Members can leave a project" ON public.project_collaborators;
CREATE POLICY "Members can leave a project"
  ON public.project_collaborators FOR DELETE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND role <> 'owner'
    AND NOT public.is_guest_session()
    AND NOT public.is_agent_session()
    AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = (SELECT auth.uid()))
  );

-- 9. Activity: one "changed access" line instead of a line per company member
-- Same as 20261110180000_project_activity.sql, plus the quiet company clause.
CREATE OR REPLACE FUNCTION public.project_events_from_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.project_collaborators := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  IF v_row.role = 'owner' OR EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = v_row.project_id AND p.user_id = v_row.user_id
  ) THEN
    RETURN v_row;
  END IF;
  IF v_row.access_source = 'company' AND coalesce(current_setting('survey.project_access', true), '') = 'on' THEN
    RETURN v_row;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'active' THEN
      PERFORM public.project_event_add(NEW.project_id, 'member_added', NEW.user_id, NEW.email, NULL, NEW.role);
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'active' THEN
      PERFORM public.project_event_add(OLD.project_id, 'member_removed', OLD.user_id, OLD.email, OLD.role, NULL);
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
    PERFORM public.project_event_add(NEW.project_id, 'member_added', NEW.user_id, NEW.email, NULL, NEW.role);
  ELSIF OLD.status = 'active' AND NEW.status IS DISTINCT FROM 'active' THEN
    PERFORM public.project_event_add(NEW.project_id, 'member_removed', NEW.user_id, NEW.email, OLD.role, NULL);
  ELSIF NEW.status = 'active' AND NEW.role IS DISTINCT FROM OLD.role THEN
    PERFORM public.project_event_add(NEW.project_id, 'member_role', NEW.user_id, NEW.email, OLD.role, NEW.role);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.project_events_from_members() FROM PUBLIC;

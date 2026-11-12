-- Project Activity (Nightly flag project-activity), copied from Drawboard
-- Projects' Activity page: one feed per project of what happened to it, in
-- 15-minute groups, newest first. Logged: the project made or renamed;
-- documents added, renamed, moved in or out, archived or brought back, given
-- a new revision, deleted; issue and task made, status, assignee, due date,
-- archive and delete; people added, role changed, removed. Not logged (as in
-- Drawboard): comments and marks, which have their own History.
--
-- Every row is written by a trigger here, so no client can skip or forge
-- one. Members of the project read it; nobody writes it directly.

CREATE TABLE IF NOT EXISTS public.project_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  actor_id uuid,
  action text NOT NULL CHECK (char_length(action) <= 40),
  subject_id uuid,
  subject_name text CHECK (subject_name IS NULL OR char_length(subject_name) <= 300),
  from_value text CHECK (from_value IS NULL OR char_length(from_value) <= 300),
  to_value text CHECK (to_value IS NULL OR char_length(to_value) <= 300),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_events_project_created_idx
  ON public.project_events (project_id, created_at DESC, id DESC);

ALTER TABLE public.project_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_events_select ON public.project_events;
CREATE POLICY project_events_select ON public.project_events
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id, 'viewer'));
REVOKE ALL ON public.project_events FROM anon, authenticated;
GRANT SELECT ON public.project_events TO authenticated;

-- One writer for every trigger. A row for a project that is itself being
-- deleted (its documents and items go with it) is skipped.
CREATE OR REPLACE FUNCTION public.project_event_add(
  p_project_id uuid, p_action text, p_subject_id uuid DEFAULT NULL, p_subject_name text DEFAULT NULL,
  p_from text DEFAULT NULL, p_to text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_project_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id) THEN
    RETURN;
  END IF;
  INSERT INTO public.project_events (project_id, actor_id, action, subject_id, subject_name, from_value, to_value)
  VALUES (p_project_id, auth.uid(), p_action, p_subject_id, left(p_subject_name, 300), left(p_from, 300), left(p_to, 300));
END;
$$;
REVOKE ALL ON FUNCTION public.project_event_add(uuid, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- Projects: made, renamed.
CREATE OR REPLACE FUNCTION public.project_events_from_projects()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.project_event_add(NEW.id, 'project_created', NEW.id, NEW.name);
  ELSIF NEW.name IS DISTINCT FROM OLD.name THEN
    PERFORM public.project_event_add(NEW.id, 'project_renamed', NEW.id, NEW.name, OLD.name, NEW.name);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.project_events_from_projects() FROM PUBLIC;
DROP TRIGGER IF EXISTS project_events_from_projects ON public.projects;
CREATE TRIGGER project_events_from_projects
  AFTER INSERT OR UPDATE OF name ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.project_events_from_projects();

-- Documents: added, renamed, moved, archived / back, new revision, deleted.
-- Only these columns fire it (page, zoom and save stamps change all day).
CREATE OR REPLACE FUNCTION public.project_events_from_documents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.project_event_add(NEW.project_id, 'document_added', NEW.id, NEW.name);
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM public.project_event_add(OLD.project_id, 'document_deleted', OLD.id, OLD.name);
    RETURN OLD;
  END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    PERFORM public.project_event_add(OLD.project_id, 'document_moved_out', NEW.id, NEW.name);
    PERFORM public.project_event_add(NEW.project_id, 'document_moved_in', NEW.id, NEW.name);
    RETURN NEW;
  END IF;
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    PERFORM public.project_event_add(NEW.project_id, 'document_renamed', NEW.id, NEW.name, OLD.name, NEW.name);
  END IF;
  IF (NEW.user_archived_at IS NULL) IS DISTINCT FROM (OLD.user_archived_at IS NULL) THEN
    PERFORM public.project_event_add(NEW.project_id,
      CASE WHEN NEW.user_archived_at IS NULL THEN 'document_unarchived' ELSE 'document_archived' END, NEW.id, NEW.name);
  END IF;
  IF NEW.superseded_by IS DISTINCT FROM OLD.superseded_by AND NEW.superseded_by IS NOT NULL THEN
    PERFORM public.project_event_add(NEW.project_id, 'document_revised', NEW.superseded_by,
      (SELECT d.name FROM public.documents d WHERE d.id = NEW.superseded_by), NEW.name, NULL);
  END IF;
  IF NEW.sheet_revision IS DISTINCT FROM OLD.sheet_revision AND NEW.sheet_revision IS NOT NULL THEN
    PERFORM public.project_event_add(NEW.project_id, 'document_revision', NEW.id, NEW.name, OLD.sheet_revision, NEW.sheet_revision);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.project_events_from_documents() FROM PUBLIC;
DROP TRIGGER IF EXISTS project_events_from_documents ON public.documents;
CREATE TRIGGER project_events_from_documents
  AFTER INSERT OR DELETE OR UPDATE OF project_id, name, user_archived_at, superseded_by, sheet_revision ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.project_events_from_documents();

-- Issues and tasks: made, status, assignee, due date, archive / back, deleted.
-- (The item's own Activity keeps every field; the project feed keeps these.)
CREATE OR REPLACE FUNCTION public.project_events_from_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_label text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_label := (CASE OLD.kind WHEN 'task' THEN 'TSK-' ELSE 'ISS-' END) || OLD.number::text;
    PERFORM public.project_event_add(OLD.project_id, OLD.kind || '_deleted', OLD.id, v_label || ' ' || OLD.title);
    RETURN OLD;
  END IF;
  v_label := (CASE NEW.kind WHEN 'task' THEN 'TSK-' ELSE 'ISS-' END) || NEW.number::text;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.project_event_add(NEW.project_id, NEW.kind || '_created', NEW.id, v_label || ' ' || NEW.title);
    RETURN NEW;
  END IF;
  -- Naming a new item is part of making it.
  IF NEW.title IS DISTINCT FROM OLD.title AND OLD.title = '' THEN
    UPDATE public.project_events SET subject_name = left(v_label || ' ' || NEW.title, 300)
     WHERE subject_id = NEW.id AND action = NEW.kind || '_created';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.project_event_add(NEW.project_id, NEW.kind || '_status', NEW.id, v_label || ' ' || NEW.title, OLD.status, NEW.status);
  END IF;
  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    PERFORM public.project_event_add(NEW.project_id, NEW.kind || '_assignee', NEW.id, v_label || ' ' || NEW.title, OLD.assignee_id::text, NEW.assignee_id::text);
  END IF;
  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    PERFORM public.project_event_add(NEW.project_id, NEW.kind || '_due', NEW.id, v_label || ' ' || NEW.title, OLD.due_date::text, NEW.due_date::text);
  END IF;
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    PERFORM public.project_event_add(NEW.project_id,
      NEW.kind || CASE WHEN NEW.archived_at IS NULL THEN '_unarchived' ELSE '_archived' END, NEW.id, v_label || ' ' || NEW.title);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.project_events_from_items() FROM PUBLIC;
DROP TRIGGER IF EXISTS project_events_from_items ON public.project_items;
CREATE TRIGGER project_events_from_items
  AFTER INSERT OR DELETE OR UPDATE OF title, status, assignee_id, due_date, archived_at ON public.project_items
  FOR EACH ROW EXECUTE FUNCTION public.project_events_from_items();

-- People: added (or joined from an invite), role changed, removed. The
-- owner's own row (made with the project) is not news.
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
DROP TRIGGER IF EXISTS project_events_from_members ON public.project_collaborators;
CREATE TRIGGER project_events_from_members
  AFTER INSERT OR DELETE OR UPDATE OF status, role ON public.project_collaborators
  FOR EACH ROW EXECUTE FUNCTION public.project_events_from_members();

INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('project-activity', 'off', 'Projects: an Activity tab with what happened to the project (files, revisions, issues, people) in 15-minute groups.')
ON CONFLICT (key) DO NOTHING;

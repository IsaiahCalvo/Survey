-- Projects: Issues and Tasks lists (Drawboard Projects parity, 2026-11-10).
--
-- Nightly flag `project-issues` (keep in step with src/featureFlags.js).
--
-- Drawboard Projects gives each project two lists, Issues and Tasks. An item
-- has an auto ID (ISS-1, TSK-1), a summary, a description, one of seven
-- statuses in three groups, one assignee, a due date, tags, links to several
-- drawings, a discussion and an activity log that records every change.
-- Only the project owner archives, and deletes only archived items.
--
-- Survey numbers items per project and list (Drawboard numbers across the
-- whole account; Survey has no account-wide list, and per-project numbers
-- read better on a site). A number is never handed out twice, even after a
-- delete, so an ID on a printed sheet always means one item.

CREATE TABLE IF NOT EXISTS public.project_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('issue', 'task')),
  number integer NOT NULL DEFAULT 0,
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 10000),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'pending', 'in_review', 'closed', 'approved', 'rejected')),
  assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date date,
  tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 20),
  links jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(links) = 'array' AND jsonb_array_length(links) <= 50),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (project_id, kind, number)
);
CREATE INDEX IF NOT EXISTS project_items_project_idx ON public.project_items (project_id, kind);
CREATE INDEX IF NOT EXISTS project_items_assignee_idx ON public.project_items (assignee_id);

-- The next number per project and list. Only the insert trigger touches it.
CREATE TABLE IF NOT EXISTS public.project_item_counters (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, kind)
);
ALTER TABLE public.project_item_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_item_counters FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.project_item_events (
  id bigserial PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES public.project_items(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  from_value text,
  to_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_item_events_item_idx ON public.project_item_events (item_id, created_at);

CREATE TABLE IF NOT EXISTS public.project_item_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.project_items(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  author_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_item_comments_item_idx ON public.project_item_comments (item_id, created_at);

-- Is this person on the project (owner or an active collaborator)?
CREATE OR REPLACE FUNCTION public.project_item_member(p_project_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_project_id AND p.user_id = p_user_id)
      OR EXISTS (
        SELECT 1 FROM public.project_collaborators c
         WHERE c.project_id = p_project_id AND c.user_id = p_user_id AND c.status = 'active'
      );
$$;
REVOKE ALL ON FUNCTION public.project_item_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_item_member(uuid, uuid) TO authenticated;

-- Shared checks for insert and update: the assignee is on the project, every
-- link is {"document_id": "<uuid>"} for a document in this project, and tags
-- are trimmed, 1 to 40 characters.
CREATE OR REPLACE FUNCTION public.project_items_check(p_item public.project_items)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_link jsonb;
  v_doc uuid;
  v_tag text;
BEGIN
  IF p_item.assignee_id IS NOT NULL AND NOT public.project_item_member(p_item.project_id, p_item.assignee_id) THEN
    RAISE EXCEPTION 'assignee is not on this project' USING ERRCODE = 'check_violation';
  END IF;
  FOR v_link IN SELECT * FROM jsonb_array_elements(p_item.links) LOOP
    IF jsonb_typeof(v_link) <> 'object' OR NOT (v_link ? 'document_id') THEN
      RAISE EXCEPTION 'bad link' USING ERRCODE = 'check_violation';
    END IF;
    BEGIN
      v_doc := (v_link ->> 'document_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'bad link' USING ERRCODE = 'check_violation';
    END;
    IF NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.id = v_doc AND d.project_id = p_item.project_id) THEN
      RAISE EXCEPTION 'linked document is not in this project' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  FOREACH v_tag IN ARRAY p_item.tags LOOP
    IF v_tag IS NULL OR v_tag <> btrim(v_tag) OR char_length(v_tag) NOT BETWEEN 1 AND 40 THEN
      RAISE EXCEPTION 'bad tag' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.project_items_check(public.project_items) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.project_items_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT count(*) FROM public.project_items WHERE project_id = NEW.project_id) >= 5000 THEN
    RAISE EXCEPTION 'item limit reached' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.project_item_counters AS c (project_id, kind, last_number)
       VALUES (NEW.project_id, NEW.kind, 1)
  ON CONFLICT (project_id, kind) DO UPDATE SET last_number = c.last_number + 1
  RETURNING last_number INTO NEW.number;
  NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  NEW.created_at := now();
  NEW.updated_at := now();
  NEW.archived_at := NULL;
  PERFORM public.project_items_check(NEW);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.project_items_before_insert() FROM PUBLIC;

DROP TRIGGER IF EXISTS project_items_before_insert ON public.project_items;
CREATE TRIGGER project_items_before_insert
  BEFORE INSERT ON public.project_items
  FOR EACH ROW EXECUTE FUNCTION public.project_items_before_insert();

CREATE OR REPLACE FUNCTION public.project_items_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Who made it, where it lives and its ID never change.
  NEW.project_id := OLD.project_id;
  NEW.kind := OLD.kind;
  NEW.number := OLD.number;
  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;
  NEW.updated_at := now();
  -- Archive and unarchive are the project owner's, as in Drawboard (Owner
  -- and Admin only). A signed-in session without owner rights is refused;
  -- the service role (no auth.uid()) is not.
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at
     AND auth.uid() IS NOT NULL
     AND NOT public.user_can_access_project(OLD.project_id, 'owner') THEN
    RAISE EXCEPTION 'only the project owner can archive' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.project_items_check(NEW);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.project_items_before_update() FROM PUBLIC;

DROP TRIGGER IF EXISTS project_items_before_update ON public.project_items;
CREATE TRIGGER project_items_before_update
  BEFORE UPDATE ON public.project_items
  FOR EACH ROW EXECUTE FUNCTION public.project_items_before_update();

-- The activity log: one row per changed field, written here so no client can
-- skip or forge it. Values are stored as text the list shows as-is.
CREATE OR REPLACE FUNCTION public.project_items_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.project_item_events (item_id, project_id, actor_id, action, to_value)
         VALUES (NEW.id, NEW.project_id, v_actor, 'created', NEW.title);
    RETURN NEW;
  END IF;
  -- Naming a new item is part of making it, not a change to log.
  IF NEW.title IS DISTINCT FROM OLD.title AND OLD.title <> '' THEN
    INSERT INTO public.project_item_events (item_id, project_id, actor_id, action, from_value, to_value)
         VALUES (NEW.id, NEW.project_id, v_actor, 'title', OLD.title, NEW.title);
  END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    INSERT INTO public.project_item_events (item_id, project_id, actor_id, action)
         VALUES (NEW.id, NEW.project_id, v_actor, 'description');
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.project_item_events (item_id, project_id, actor_id, action, from_value, to_value)
         VALUES (NEW.id, NEW.project_id, v_actor, 'status', OLD.status, NEW.status);
  END IF;
  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    INSERT INTO public.project_item_events (item_id, project_id, actor_id, action, from_value, to_value)
         VALUES (NEW.id, NEW.project_id, v_actor, 'assignee', OLD.assignee_id::text, NEW.assignee_id::text);
  END IF;
  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    INSERT INTO public.project_item_events (item_id, project_id, actor_id, action, from_value, to_value)
         VALUES (NEW.id, NEW.project_id, v_actor, 'due', OLD.due_date::text, NEW.due_date::text);
  END IF;
  IF NEW.tags IS DISTINCT FROM OLD.tags THEN
    INSERT INTO public.project_item_events (item_id, project_id, actor_id, action, from_value, to_value)
         VALUES (NEW.id, NEW.project_id, v_actor, 'tags', array_to_string(OLD.tags, ', '), array_to_string(NEW.tags, ', '));
  END IF;
  IF NEW.links IS DISTINCT FROM OLD.links THEN
    INSERT INTO public.project_item_events (item_id, project_id, actor_id, action, from_value, to_value)
         VALUES (NEW.id, NEW.project_id, v_actor, 'links', jsonb_array_length(OLD.links)::text, jsonb_array_length(NEW.links)::text);
  END IF;
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    INSERT INTO public.project_item_events (item_id, project_id, actor_id, action)
         VALUES (NEW.id, NEW.project_id, v_actor, CASE WHEN NEW.archived_at IS NULL THEN 'unarchived' ELSE 'archived' END);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.project_items_log() FROM PUBLIC;

DROP TRIGGER IF EXISTS project_items_log ON public.project_items;
CREATE TRIGGER project_items_log
  AFTER INSERT OR UPDATE ON public.project_items
  FOR EACH ROW EXECUTE FUNCTION public.project_items_log();

ALTER TABLE public.project_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_item_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_item_comments ENABLE ROW LEVEL SECURITY;

-- Anyone on the project reads; editors and the owner write; guest-link and
-- agent sessions never write; only the owner deletes, and only archived items.
DROP POLICY IF EXISTS project_items_select ON public.project_items;
CREATE POLICY project_items_select ON public.project_items
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id, 'viewer'));

DROP POLICY IF EXISTS project_items_insert ON public.project_items;
CREATE POLICY project_items_insert ON public.project_items
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT public.is_guest_session()
    AND NOT public.is_agent_session()
    AND public.user_can_access_project(project_id, 'editor')
  );

DROP POLICY IF EXISTS project_items_update ON public.project_items;
CREATE POLICY project_items_update ON public.project_items
  FOR UPDATE TO authenticated
  USING (
    NOT public.is_guest_session()
    AND NOT public.is_agent_session()
    AND public.user_can_access_project(project_id, 'editor')
  )
  WITH CHECK (public.user_can_access_project(project_id, 'editor'));

DROP POLICY IF EXISTS project_items_delete ON public.project_items;
CREATE POLICY project_items_delete ON public.project_items
  FOR DELETE TO authenticated
  USING (
    archived_at IS NOT NULL
    AND NOT public.is_guest_session()
    AND NOT public.is_agent_session()
    AND public.user_can_access_project(project_id, 'owner')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_items TO authenticated;

DROP POLICY IF EXISTS project_item_events_select ON public.project_item_events;
CREATE POLICY project_item_events_select ON public.project_item_events
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id, 'viewer'));
GRANT SELECT ON public.project_item_events TO authenticated;

-- A comment's project is always its item's project.
CREATE OR REPLACE FUNCTION public.project_item_comments_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  SELECT i.project_id INTO NEW.project_id FROM public.project_items i WHERE i.id = NEW.item_id;
  IF NEW.project_id IS NULL THEN
    RAISE EXCEPTION 'no such item' USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.author_id := COALESCE(auth.uid(), NEW.author_id);
  NEW.created_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.project_item_comments_before_insert() FROM PUBLIC;

DROP TRIGGER IF EXISTS project_item_comments_before_insert ON public.project_item_comments;
CREATE TRIGGER project_item_comments_before_insert
  BEFORE INSERT ON public.project_item_comments
  FOR EACH ROW EXECUTE FUNCTION public.project_item_comments_before_insert();

DROP POLICY IF EXISTS project_item_comments_select ON public.project_item_comments;
CREATE POLICY project_item_comments_select ON public.project_item_comments
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id, 'viewer'));

-- Editors and the owner take part in the discussion; a viewer reads it
-- (Drawboard: a Reader cannot post to an issue's comments).
DROP POLICY IF EXISTS project_item_comments_insert ON public.project_item_comments;
CREATE POLICY project_item_comments_insert ON public.project_item_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT public.is_guest_session()
    AND NOT public.is_agent_session()
    AND author_id = auth.uid()
    AND public.user_can_access_project(project_id, 'editor')
  );

DROP POLICY IF EXISTS project_item_comments_delete_own ON public.project_item_comments;
CREATE POLICY project_item_comments_delete_own ON public.project_item_comments
  FOR DELETE TO authenticated
  USING (
    NOT public.is_guest_session()
    AND NOT public.is_agent_session()
    AND author_id = auth.uid()
    AND public.user_can_access_project(project_id, 'editor')
  );

GRANT SELECT, INSERT, DELETE ON public.project_item_comments TO authenticated;

INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('project-issues', 'off', 'Projects: Issues and Tasks lists with IDs, statuses, filters, archive, CSV and activity.')
ON CONFLICT (key) DO NOTHING;

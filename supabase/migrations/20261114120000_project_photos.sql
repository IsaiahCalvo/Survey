-- Projects: Photos tab (Drawboard Projects parity AE-32..39, IS-15..17).
--
-- Nightly flag `project-photos` (keep in step with src/featureFlags.js).
--
-- Drawboard Projects keeps every photo of a project on one Photos page:
-- "Add photo" with no task, group by day / week / month, filters (Uploaded by
-- me, Linked, Not linked, Uploaded by, Uploaded within), a viewer with
-- uploader, date and links, a markup editor (Pen, Text, Arrow, Select, widths
-- 2 / 4 / 8, three colours, Clear all, Save markup), Delete (gone from every
-- task) and bulk download. Issues and Tasks attach photos from the same
-- gallery, and an edit shows on every item the photo is linked to.
--
-- Survey keeps the original file and saves markup as a second file, so
-- "Clear all" on a later edit can always go back to the clean photo.
--
-- Files live in the private bucket `project-photos`:
--   <project uuid>/<photo uuid>.<jpg|jpeg|png|webp>        the original
--   <project uuid>/<photo uuid>-m<1..999999>.<png|jpg>      a marked copy
-- The first path segment is the project, so the policies read the project
-- from the name without touching any table on storage.objects.

-- 1. Flag ---------------------------------------------------------------------
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('project-photos', 'off', 'Project Photos tab: add, mark up and link site photos to issues and tasks')
ON CONFLICT (key) DO NOTHING;

-- 2. Bucket -------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('project-photos', 'project-photos', false, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Object name -> project id; NULL unless the name is exactly one of the two
-- shapes above.
CREATE OR REPLACE FUNCTION public.project_photo_object_project_id(object_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-m[1-9][0-9]{0,5})?\.(jpg|jpeg|png|webp)$'
    THEN substring(object_name from 1 for 36)::uuid
    ELSE NULL
  END
$$;
REVOKE ALL ON FUNCTION public.project_photo_object_project_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_photo_object_project_id(text) TO authenticated;

-- 3. Tables -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  path text NOT NULL,
  marked_path text,
  width integer CHECK (width IS NULL OR width BETWEEN 1 AND 20000),
  height integer CHECK (height IS NULL OR height BETWEEN 1 AND 20000),
  bytes integer CHECK (bytes IS NULL OR bytes BETWEEN 1 AND 10485760),
  caption text NOT NULL DEFAULT '' CHECK (char_length(caption) <= 500),
  uploaded_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  marked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  marked_at timestamptz,
  UNIQUE (path)
);
CREATE INDEX IF NOT EXISTS project_photos_project_idx ON public.project_photos (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.project_photo_links (
  photo_id uuid NOT NULL REFERENCES public.project_photos(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.project_items(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (photo_id, item_id)
);
CREATE INDEX IF NOT EXISTS project_photo_links_item_idx ON public.project_photo_links (item_id);
CREATE INDEX IF NOT EXISTS project_photo_links_project_idx ON public.project_photo_links (project_id);

-- 4. Triggers -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.project_photos_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT count(*) FROM public.project_photos WHERE project_id = NEW.project_id) >= 5000 THEN
    RAISE EXCEPTION 'photo limit reached' USING ERRCODE = 'check_violation';
  END IF;
  -- The original is <project>/<this row's id>.<ext>: nobody can point a row
  -- at another project's file or at another photo.
  IF NEW.path !~ ('^' || NEW.project_id::text || '/' || NEW.id::text || '\.(jpg|jpeg|png|webp)$') THEN
    RAISE EXCEPTION 'bad photo path' USING ERRCODE = 'check_violation';
  END IF;
  NEW.uploaded_by := COALESCE(auth.uid(), NEW.uploaded_by);
  NEW.created_at := now();
  NEW.marked_path := NULL;
  NEW.marked_by := NULL;
  NEW.marked_at := NULL;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.project_photos_before_insert() FROM PUBLIC;

DROP TRIGGER IF EXISTS project_photos_before_insert ON public.project_photos;
CREATE TRIGGER project_photos_before_insert
  BEFORE INSERT ON public.project_photos
  FOR EACH ROW EXECUTE FUNCTION public.project_photos_before_insert();

-- Only the markup (and the caption) change after upload. A marked copy is
-- <project>/<id>-m<n>.<png|jpg>; NULL goes back to the clean photo.
CREATE OR REPLACE FUNCTION public.project_photos_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.id := OLD.id;
  NEW.project_id := OLD.project_id;
  NEW.path := OLD.path;
  NEW.width := OLD.width;
  NEW.height := OLD.height;
  NEW.bytes := OLD.bytes;
  NEW.uploaded_by := OLD.uploaded_by;
  NEW.created_at := OLD.created_at;
  IF NEW.marked_path IS DISTINCT FROM OLD.marked_path THEN
    IF NEW.marked_path IS NOT NULL
       AND NEW.marked_path !~ ('^' || OLD.project_id::text || '/' || OLD.id::text || '-m[1-9][0-9]{0,5}\.(png|jpg)$') THEN
      RAISE EXCEPTION 'bad marked path' USING ERRCODE = 'check_violation';
    END IF;
    NEW.marked_by := auth.uid();
    NEW.marked_at := CASE WHEN NEW.marked_path IS NULL THEN NULL ELSE now() END;
  ELSE
    NEW.marked_by := OLD.marked_by;
    NEW.marked_at := OLD.marked_at;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.project_photos_before_update() FROM PUBLIC;

DROP TRIGGER IF EXISTS project_photos_before_update ON public.project_photos;
CREATE TRIGGER project_photos_before_update
  BEFORE UPDATE ON public.project_photos
  FOR EACH ROW EXECUTE FUNCTION public.project_photos_before_update();

-- A link joins a photo and an item of the SAME project; project_id is copied
-- from the photo so the policies can check it without a join.
CREATE OR REPLACE FUNCTION public.project_photo_links_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_photo_project uuid;
  v_item_project uuid;
BEGIN
  SELECT project_id INTO v_photo_project FROM public.project_photos WHERE id = NEW.photo_id;
  SELECT project_id INTO v_item_project FROM public.project_items WHERE id = NEW.item_id;
  IF v_photo_project IS NULL OR v_item_project IS NULL OR v_photo_project <> v_item_project THEN
    RAISE EXCEPTION 'photo and item are not in the same project' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM public.project_photo_links WHERE item_id = NEW.item_id) >= 50 THEN
    RAISE EXCEPTION 'too many photos on this item' USING ERRCODE = 'check_violation';
  END IF;
  NEW.project_id := v_photo_project;
  NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  NEW.created_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.project_photo_links_before_insert() FROM PUBLIC;

DROP TRIGGER IF EXISTS project_photo_links_before_insert ON public.project_photo_links;
CREATE TRIGGER project_photo_links_before_insert
  BEFORE INSERT ON public.project_photo_links
  FOR EACH ROW EXECUTE FUNCTION public.project_photo_links_before_insert();

-- Linking and unlinking show in the item's Activity, like Drawboard's
-- attachment lines.
CREATE OR REPLACE FUNCTION public.project_photo_links_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.project_item_events (item_id, project_id, actor_id, action, to_value)
         VALUES (NEW.item_id, NEW.project_id, auth.uid(), 'photo_added', NEW.photo_id::text);
    RETURN NEW;
  END IF;
  -- The item itself may be going away (cascade): log only while it exists.
  IF EXISTS (SELECT 1 FROM public.project_items WHERE id = OLD.item_id) THEN
    INSERT INTO public.project_item_events (item_id, project_id, actor_id, action, from_value)
         VALUES (OLD.item_id, OLD.project_id, auth.uid(), 'photo_removed', OLD.photo_id::text);
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.project_photo_links_log() FROM PUBLIC;

DROP TRIGGER IF EXISTS project_photo_links_log ON public.project_photo_links;
CREATE TRIGGER project_photo_links_log
  AFTER INSERT OR DELETE ON public.project_photo_links
  FOR EACH ROW EXECUTE FUNCTION public.project_photo_links_log();

-- 5. Row security -------------------------------------------------------------
ALTER TABLE public.project_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_photo_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_photos_select ON public.project_photos;
CREATE POLICY project_photos_select ON public.project_photos
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id, 'viewer'));

DROP POLICY IF EXISTS project_photos_insert ON public.project_photos;
CREATE POLICY project_photos_insert ON public.project_photos
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT public.is_guest_session()
    AND NOT public.is_agent_session()
    AND public.user_can_access_project(project_id, 'editor')
  );

DROP POLICY IF EXISTS project_photos_update ON public.project_photos;
CREATE POLICY project_photos_update ON public.project_photos
  FOR UPDATE TO authenticated
  USING (
    NOT public.is_guest_session()
    AND NOT public.is_agent_session()
    AND public.user_can_access_project(project_id, 'editor')
  )
  WITH CHECK (public.user_can_access_project(project_id, 'editor'));

-- Delete: whoever uploaded it (while still an editor), or the project owner.
DROP POLICY IF EXISTS project_photos_delete ON public.project_photos;
CREATE POLICY project_photos_delete ON public.project_photos
  FOR DELETE TO authenticated
  USING (
    NOT public.is_guest_session()
    AND NOT public.is_agent_session()
    AND (
      (uploaded_by = auth.uid() AND public.user_can_access_project(project_id, 'editor'))
      OR public.user_can_access_project(project_id, 'owner')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_photos TO authenticated;

DROP POLICY IF EXISTS project_photo_links_select ON public.project_photo_links;
CREATE POLICY project_photo_links_select ON public.project_photo_links
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id, 'viewer'));

DROP POLICY IF EXISTS project_photo_links_insert ON public.project_photo_links;
CREATE POLICY project_photo_links_insert ON public.project_photo_links
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT public.is_guest_session()
    AND NOT public.is_agent_session()
    AND public.user_can_access_project(
      (SELECT p.project_id FROM public.project_photos p WHERE p.id = photo_id), 'editor')
  );

DROP POLICY IF EXISTS project_photo_links_delete ON public.project_photo_links;
CREATE POLICY project_photo_links_delete ON public.project_photo_links
  FOR DELETE TO authenticated
  USING (
    NOT public.is_guest_session()
    AND NOT public.is_agent_session()
    AND public.user_can_access_project(project_id, 'editor')
  );

GRANT SELECT, INSERT, DELETE ON public.project_photo_links TO authenticated;

-- 6. Storage policies ---------------------------------------------------------
DROP POLICY IF EXISTS project_photos_object_select ON storage.objects;
CREATE POLICY project_photos_object_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'project-photos'
    AND public.user_can_access_project(public.project_photo_object_project_id(name), 'viewer')
  );

DROP POLICY IF EXISTS project_photos_object_insert ON storage.objects;
CREATE POLICY project_photos_object_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'project-photos'
    AND NOT public.is_guest_session()
    AND NOT public.is_agent_session()
    AND public.user_can_access_project(public.project_photo_object_project_id(name), 'editor')
  );

-- Files go with their row: the uploader of the file, or the project owner.
DROP POLICY IF EXISTS project_photos_object_delete ON storage.objects;
CREATE POLICY project_photos_object_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'project-photos'
    AND NOT public.is_guest_session()
    AND NOT public.is_agent_session()
    AND (
      (owner_id = auth.uid()::text
        AND public.user_can_access_project(public.project_photo_object_project_id(name), 'editor'))
      OR public.user_can_access_project(public.project_photo_object_project_id(name), 'owner')
    )
  );

-- 7. Account deletion takes the photos of the person's projects too ---------
-- (latest definition: 20261024150000_security_scan_review_fixes.sql, plus
-- the project-photos clause.)
create or replace function public.account_deletion_storage_objects(target_user_id uuid)
returns table (bucket_id text, name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;

  return query
  with owned_docs as (
    select d.id::text as doc_id, d.file_path
    from public.documents d
    where d.user_id = target_user_id
  ),
  owned_projects as (
    select p.id::text as project_id
    from public.projects p
    where p.user_id = target_user_id
  ),
  -- First path segments that belong to somebody else. An id the person chose
  -- that matches one of these never claims those files.
  foreign_prefixes as (
    select u.id::text as prefix from auth.users u where u.id <> target_user_id
    union all
    select d.id::text from public.documents d where d.user_id <> target_user_id
    union all
    select p.id::text from public.projects p where p.user_id <> target_user_id
  )
  select o.bucket_id, o.name
  from storage.objects o
  where o.bucket_id <> 'brand'
    and (
      split_part(o.name, '/', 1) = target_user_id::text
      or (
        split_part(o.name, '/', 1) in (select doc_id from owned_docs)
        and split_part(o.name, '/', 1) not in (select prefix from foreign_prefixes)
      )
      -- Survey JSON sidecars: documents/<project_id>/<document_id>_data.json.
      or (
        o.bucket_id = 'documents'
        and split_part(o.name, '/', 2) in (select doc_id || '_data.json' from owned_docs)
      )
      -- Anything else under the person's projects, except the sidecars of
      -- other people's documents, which account_deletion_sidecar_moves keeps.
      or (
        o.bucket_id = 'documents'
        and split_part(o.name, '/', 1) in (select project_id from owned_projects)
        and split_part(o.name, '/', 1) not in (select prefix from foreign_prefixes)
        and not exists (
          select 1 from public.documents other
          where split_part(o.name, '/', 2) = other.id::text || '_data.json'
            and other.user_id <> target_user_id
        )
      )
      or (
        o.bucket_id = 'documents'
        and o.name in (select file_path from owned_docs where file_path is not null)
        and not exists (
          select 1 from public.documents other
          where other.file_path = o.name and other.user_id <> target_user_id
        )
      )
      -- Project photos: <project_id>/<photo>. The project row goes with the
      -- account, so every photo in it goes too.
      or (
        o.bucket_id = 'project-photos'
        and split_part(o.name, '/', 1) in (select project_id from owned_projects)
      )
    )
  order by o.bucket_id, o.name;
end;
$$;
revoke all on function public.account_deletion_storage_objects(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_storage_objects(uuid) to service_role;

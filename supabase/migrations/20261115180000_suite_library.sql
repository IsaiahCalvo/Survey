-- Suite library (KAL-585, suite spec KAL-584). Nightly flag `suite` (keep in
-- step with src/featureFlags.js).
--
-- One library of Categories (Camera) and Category Types (PTZ, Fisheye) that
-- Survey, Walkthru and Plot all point at, so the same Camera matches in every
-- app by id, never by guessing. Survey template categories keep a link to
-- their entry (config ... categories[].libraryEntryId); the checklist stays on
-- the template.
--
-- Scope:
--   mine     one person's own library ("My library"); company_id is null.
--   company  the company's library ("Company library"); any member reads it.
-- Rules:
--   * anyone may add an entry to their own library or to their company's;
--   * a Category Type sits under a Category of the same library;
--   * rename and remove: the owner of a "mine" entry, or an owner/admin of the
--     company for a "company" entry;
--   * remove is a soft remove (removed_at), so links in templates never point
--     at nothing and no data is lost. There is no DELETE.
--   * id, kind, parent, scope, company and creator never change after insert.
-- Entry ids are made on the device, so an entry made offline keeps its id
-- when it reaches the server, and a retry of the same insert is harmless.
--
-- New table only: no existing table or row is changed.

-- 1. Flag ---------------------------------------------------------------------
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('suite', 'off', 'Kal Voe suite groundwork: My library / Company library, shared ids and places on Survey Markers')
ON CONFLICT (key) DO NOTHING;

-- 2. Table --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.library_entries (
  id          uuid PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('category', 'categoryType')),
  parent_id   uuid REFERENCES public.library_entries(id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  scope       text NOT NULL CHECK (scope IN ('mine', 'company')),
  company_id  uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  removed_at  timestamptz,
  removed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT library_entries_scope_company CHECK (
    (scope = 'mine' AND company_id IS NULL) OR (scope = 'company' AND company_id IS NOT NULL)
  ),
  CONSTRAINT library_entries_type_has_parent CHECK (
    (kind = 'category' AND parent_id IS NULL) OR (kind = 'categoryType' AND parent_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS library_entries_mine_idx
  ON public.library_entries (created_by) WHERE scope = 'mine';
CREATE INDEX IF NOT EXISTS library_entries_company_idx
  ON public.library_entries (company_id) WHERE scope = 'company';
CREATE INDEX IF NOT EXISTS library_entries_parent_idx
  ON public.library_entries (parent_id) WHERE parent_id IS NOT NULL;

ALTER TABLE public.library_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.library_entries FROM anon;
REVOKE DELETE, TRUNCATE ON public.library_entries FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.library_entries TO authenticated;

-- 3. Who may manage an entry (rename / remove) --------------------------------
CREATE OR REPLACE FUNCTION public.library_entry_manageable(p_scope text, p_company uuid, p_created_by uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_scope = 'mine' THEN p_created_by = auth.uid()
    WHEN p_scope = 'company' THEN public.my_org_role(p_company) IN ('owner', 'admin')
    ELSE false
  END;
$$;
REVOKE ALL ON FUNCTION public.library_entry_manageable(text, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.library_entry_manageable(text, uuid, uuid) TO authenticated, service_role;

-- 4. Policies -----------------------------------------------------------------
DROP POLICY IF EXISTS library_entries_select ON public.library_entries;
CREATE POLICY library_entries_select ON public.library_entries
  FOR SELECT TO authenticated USING (
    (scope = 'mine' AND created_by = auth.uid())
    OR (scope = 'company' AND public.my_org_role(company_id) IS NOT NULL)
  );

DROP POLICY IF EXISTS library_entries_insert ON public.library_entries;
CREATE POLICY library_entries_insert ON public.library_entries
  FOR INSERT TO authenticated WITH CHECK (
    created_by = auth.uid()
    AND removed_at IS NULL
    AND (
      scope = 'mine'
      OR (scope = 'company' AND public.my_org_role(company_id) IS NOT NULL)
    )
  );

DROP POLICY IF EXISTS library_entries_update ON public.library_entries;
CREATE POLICY library_entries_update ON public.library_entries
  FOR UPDATE TO authenticated
  USING (public.library_entry_manageable(scope, company_id, created_by))
  WITH CHECK (public.library_entry_manageable(scope, company_id, created_by));

-- 5. Guards the policies cannot express ---------------------------------------
CREATE OR REPLACE FUNCTION public.library_entries_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent public.library_entries%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.name := btrim(NEW.name);
    NEW.created_at := now();
    NEW.updated_at := now();
    IF NEW.parent_id IS NOT NULL THEN
      SELECT * INTO v_parent FROM public.library_entries WHERE id = NEW.parent_id;
      IF NOT FOUND OR v_parent.kind <> 'category' THEN
        RAISE EXCEPTION 'A Category Type goes under a Category.' USING errcode = '23514';
      END IF;
      IF v_parent.scope <> NEW.scope OR v_parent.company_id IS DISTINCT FROM NEW.company_id THEN
        RAISE EXCEPTION 'A Category Type goes in the same library as its Category.' USING errcode = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: only the name and the removed mark may change.
  IF NEW.id <> OLD.id OR NEW.kind <> OLD.kind
     OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
     OR NEW.scope <> OLD.scope
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.created_by <> OLD.created_by
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Only the name of a library entry can change.' USING errcode = '42501';
  END IF;
  NEW.name := btrim(NEW.name);
  IF NEW.removed_at IS NOT NULL AND OLD.removed_at IS NULL THEN
    NEW.removed_at := now();
    NEW.removed_by := auth.uid();
  ELSIF NEW.removed_at IS NULL AND OLD.removed_at IS NOT NULL THEN
    NEW.removed_by := NULL;
  ELSE
    NEW.removed_at := OLD.removed_at;
    NEW.removed_by := OLD.removed_by;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.library_entries_guard() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS library_entries_guard ON public.library_entries;
CREATE TRIGGER library_entries_guard
  BEFORE INSERT OR UPDATE ON public.library_entries
  FOR EACH ROW EXECUTE FUNCTION public.library_entries_guard();

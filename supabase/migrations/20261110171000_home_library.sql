-- Home (Drawboard parity, 2026-11-10): tags, Last opened, Shared by me.
--
-- Three Nightly flags (keep in step with src/featureFlags.js):
--   home-tags          your own tags on documents (Drawboard Home: row chips,
--                      Add tag popover, Tags list with counts, search by tag)
--   home-shared-views  "Shared by me" / "Shared with me" filters
--   home-columns       Last opened + Created columns, more sorts, list sizes
--
-- Tags and last-opened times are PERSONAL, as in Drawboard: each person tags
-- and opens documents for themselves, also documents shared with them, and
-- nobody else sees them. So they live in per-user rows, never on documents.

CREATE TABLE IF NOT EXISTS public.document_tags (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  tag text NOT NULL CHECK (char_length(btrim(tag)) BETWEEN 1 AND 40 AND tag = btrim(tag)),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, document_id, tag)
);
CREATE INDEX IF NOT EXISTS document_tags_document_idx ON public.document_tags (document_id);

ALTER TABLE public.document_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_tags_select_own ON public.document_tags;
CREATE POLICY document_tags_select_own ON public.document_tags
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Only on a document you can open; a guest-link session never tags.
DROP POLICY IF EXISTS document_tags_insert_own ON public.document_tags;
CREATE POLICY document_tags_insert_own ON public.document_tags
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND NOT public.is_guest_session()
    AND public.user_can_access_document(document_id, 'viewer')
  );

DROP POLICY IF EXISTS document_tags_delete_own ON public.document_tags;
CREATE POLICY document_tags_delete_own ON public.document_tags
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.document_tags TO authenticated;

-- A person keeps at most 2,000 tag rows: a runaway script cannot fill the
-- table, and no real library comes near it.
CREATE OR REPLACE FUNCTION public.document_tags_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT count(*) FROM public.document_tags WHERE user_id = NEW.user_id) >= 2000 THEN
    RAISE EXCEPTION 'tag limit reached' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.document_tags_cap() FROM PUBLIC;

DROP TRIGGER IF EXISTS document_tags_cap ON public.document_tags;
CREATE TRIGGER document_tags_cap
  BEFORE INSERT ON public.document_tags
  FOR EACH ROW EXECUTE FUNCTION public.document_tags_cap();

CREATE TABLE IF NOT EXISTS public.document_opens (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, document_id)
);
CREATE INDEX IF NOT EXISTS document_opens_document_idx ON public.document_opens (document_id);

ALTER TABLE public.document_opens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_opens_select_own ON public.document_opens;
CREATE POLICY document_opens_select_own ON public.document_opens
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.document_opens TO authenticated;

-- Writes go through this one call, which stamps the server's clock (a
-- device with a wrong clock cannot put a document at the top for good).
CREATE OR REPLACE FUNCTION public.mark_document_opened(p_document_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_now timestamptz := now();
BEGIN
  IF v_user IS NULL OR public.is_guest_session() THEN
    RETURN NULL;
  END IF;
  IF NOT public.user_can_access_document(p_document_id, 'viewer') THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.document_opens (user_id, document_id, opened_at)
  VALUES (v_user, p_document_id, v_now)
  ON CONFLICT (user_id, document_id) DO UPDATE SET opened_at = EXCLUDED.opened_at;
  RETURN v_now;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_document_opened(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_document_opened(uuid) TO authenticated;

-- "Shared by me": my own documents that someone else can reach, or is
-- invited to, or that a live guest link opens.
CREATE OR REPLACE FUNCTION public.my_shared_document_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id
  FROM public.documents d
  WHERE d.user_id = auth.uid()
    AND NOT public.is_guest_session()
    AND (
      EXISTS (
        SELECT 1 FROM public.document_collaborators c
        WHERE c.document_id = d.id
          AND c.user_id <> d.user_id
          AND c.status IN ('active', 'pending')
      )
      OR EXISTS (
        SELECT 1 FROM public.document_invites i
        WHERE i.document_id = d.id
          AND i.accepted_at IS NULL
          AND i.revoked_at IS NULL
          AND i.expires_at > now()
      )
      OR EXISTS (
        SELECT 1 FROM public.document_guest_links g
        WHERE g.document_id = d.id
          AND g.revoked_at IS NULL
          AND g.expires_at > now()
      )
    );
$$;
REVOKE ALL ON FUNCTION public.my_shared_document_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_shared_document_ids() TO authenticated;

INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('home-tags', 'off', 'Home: your own tags on documents (row chips, Tags list, search by tag).'),
  ('home-shared-views', 'off', 'Home: Shared by me and Shared with me filters.'),
  ('home-columns', 'off', 'Home: Last opened and Created columns, more sorts, list sizes.')
ON CONFLICT (key) DO NOTHING;

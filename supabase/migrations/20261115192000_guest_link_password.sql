-- Guest link password and attempt limit (KAL-401, flag 'guest-links').
--
-- A document's owner may put a password on a guest link. Opening it then
-- needs the password as well as the link. Wrong passwords are counted: five
-- wrong tries by one session, or 20 by everyone, within 15 minutes lock the
-- link for that window ("Too many attempts. Try again later."). Only a salted
-- SHA-256 of the password is kept, never readable by anyone. A guest who
-- already came in keeps their access; a new or changed password only asks
-- the next newcomer.
--
-- redeem_guest_link (the old call) refuses a link with a password, so a
-- password can't be skipped by calling it. The app calls
-- redeem_guest_link_checked, which answers with a status instead of an error
-- for a missing or wrong password, so the wrong try is recorded (an error
-- would roll the record back).

ALTER TABLE public.document_guest_links ADD COLUMN IF NOT EXISTS password_salt text;
ALTER TABLE public.document_guest_links ADD COLUMN IF NOT EXISTS password_hash text
  CHECK (password_hash IS NULL OR password_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE public.document_guest_links ADD COLUMN IF NOT EXISTS has_password boolean
  GENERATED ALWAYS AS (password_hash IS NOT NULL) STORED;
GRANT SELECT (has_password) ON public.document_guest_links TO authenticated;

CREATE TABLE IF NOT EXISTS public.document_guest_link_attempts (
  id bigserial PRIMARY KEY,
  link_id uuid NOT NULL REFERENCES public.document_guest_links(id) ON DELETE CASCADE,
  user_id uuid,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_guest_link_attempts_link_at
  ON public.document_guest_link_attempts (link_id, at DESC);
ALTER TABLE public.document_guest_link_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.document_guest_link_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.document_guest_link_attempts TO service_role;

CREATE OR REPLACE FUNCTION public._guest_password_hash(p_salt text, p_password text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT encode(sha256(convert_to(p_salt || ':' || COALESCE(p_password, ''), 'UTF8')), 'hex');
$$;
REVOKE ALL ON FUNCTION public._guest_password_hash(text, text) FROM PUBLIC, anon, authenticated;

-- The owner sets (4 to 128 characters) or clears (null or '') a link's password.
CREATE OR REPLACE FUNCTION public.set_guest_link_password(p_link_id uuid, p_password text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_doc uuid;
  v_salt text;
BEGIN
  IF auth.uid() IS NULL OR public.is_guest_session() OR public.is_agent_session() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT document_id INTO v_doc FROM public.document_guest_links WHERE id = p_link_id;
  IF v_doc IS NULL OR NOT public.user_can_access_document(v_doc, 'owner') THEN
    RAISE EXCEPTION 'Link not found' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_password, '') = '' THEN
    UPDATE public.document_guest_links SET password_salt = NULL, password_hash = NULL WHERE id = p_link_id;
    RETURN true;
  END IF;
  IF char_length(p_password) NOT BETWEEN 4 AND 128 THEN
    RAISE EXCEPTION 'Use a password of 4 to 128 characters' USING ERRCODE = '22023';
  END IF;
  v_salt := replace(gen_random_uuid()::text, '-', '');
  UPDATE public.document_guest_links
     SET password_salt = v_salt, password_hash = public._guest_password_hash(v_salt, p_password)
   WHERE id = p_link_id;
  RETURN true;
END;
$$;

-- The guest's side, with a password. Answers jsonb:
--   { status: 'ok', document_id, document_name, role, expires_at }
--   { status: 'password' }  this link needs a password (none given)
--   { status: 'wrong' }     wrong password (counted)
--   { status: 'locked' }    too many wrong tries; try again later
-- An unknown, revoked or expired link is an error, the same one as before.
CREATE OR REPLACE FUNCTION public.redeem_guest_link_checked(p_token text, p_name text, p_password text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_link public.document_guest_links;
  v_name text := btrim(regexp_replace(COALESCE(p_name, ''), '[[:cntrl:]]', '', 'g'));
  v_doc_name text;
  v_already boolean;
BEGIN
  IF v_uid IS NULL OR public.is_agent_session() THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_name) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'Type a name of 1 to 60 letters' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_link FROM public.document_guest_links l
   WHERE l.token_hash = encode(sha256(convert_to(COALESCE(p_token, ''), 'UTF8')), 'hex')
     AND l.revoked_at IS NULL
     AND l.expires_at > now()
   FOR UPDATE;
  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'This guest link has ended or was turned off' USING ERRCODE = '42501';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.document_guests g WHERE g.link_id = v_link.id AND g.user_id = v_uid) INTO v_already;
  IF v_link.password_hash IS NOT NULL AND NOT v_already THEN
    IF (SELECT count(*) FROM public.document_guest_link_attempts a
         WHERE a.link_id = v_link.id AND a.user_id = v_uid AND a.at > now() - interval '15 minutes') >= 5
       OR (SELECT count(*) FROM public.document_guest_link_attempts a
         WHERE a.link_id = v_link.id AND a.at > now() - interval '15 minutes') >= 20 THEN
      RETURN jsonb_build_object('status', 'locked');
    END IF;
    IF COALESCE(p_password, '') = '' THEN
      RETURN jsonb_build_object('status', 'password');
    END IF;
    IF public._guest_password_hash(v_link.password_salt, p_password) <> v_link.password_hash THEN
      -- Tries older than a day no longer count; drop them as new ones come.
      DELETE FROM public.document_guest_link_attempts a WHERE a.link_id = v_link.id AND a.at < now() - interval '1 day';
      INSERT INTO public.document_guest_link_attempts (link_id, user_id) VALUES (v_link.id, v_uid);
      RETURN jsonb_build_object('status', 'wrong');
    END IF;
  END IF;
  IF NOT v_already AND (SELECT count(*) FROM public.document_guests g WHERE g.link_id = v_link.id AND g.user_id <> v_uid) >= 50 THEN
    RAISE EXCEPTION 'This guest link is full' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.document_guests (link_id, document_id, user_id, display_name)
  VALUES (v_link.id, v_link.document_id, v_uid, v_name)
  ON CONFLICT (link_id, user_id) DO UPDATE SET display_name = EXCLUDED.display_name;
  UPDATE public.document_guest_links SET use_count = use_count + 1, last_used_at = now() WHERE id = v_link.id;
  SELECT d.name::text INTO v_doc_name FROM public.documents d WHERE d.id = v_link.document_id;
  RETURN jsonb_build_object(
    'status', 'ok',
    'document_id', v_link.document_id,
    'document_name', v_doc_name,
    'role', v_link.role,
    'expires_at', v_link.expires_at
  );
END;
$$;

-- The old call, unchanged except that it refuses a link with a password
-- (for anyone who has not come in through it already).
CREATE OR REPLACE FUNCTION public.redeem_guest_link(p_token text, p_name text)
RETURNS TABLE (document_id uuid, document_name text, role text, expires_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_link public.document_guest_links;
  v_name text := btrim(regexp_replace(COALESCE(p_name, ''), '[[:cntrl:]]', '', 'g'));
BEGIN
  IF v_uid IS NULL OR public.is_agent_session() THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_name) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'Type a name of 1 to 60 letters' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_link FROM public.document_guest_links l
   WHERE l.token_hash = encode(sha256(convert_to(COALESCE(p_token, ''), 'UTF8')), 'hex')
     AND l.revoked_at IS NULL
     AND l.expires_at > now()
   FOR UPDATE;
  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'This guest link has ended or was turned off' USING ERRCODE = '42501';
  END IF;
  IF v_link.password_hash IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.document_guests g WHERE g.link_id = v_link.id AND g.user_id = v_uid) THEN
    RAISE EXCEPTION 'This guest link needs a password' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.document_guests g WHERE g.link_id = v_link.id AND g.user_id <> v_uid) >= 50 THEN
    RAISE EXCEPTION 'This guest link is full' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.document_guests (link_id, document_id, user_id, display_name)
  VALUES (v_link.id, v_link.document_id, v_uid, v_name)
  ON CONFLICT (link_id, user_id) DO UPDATE SET display_name = EXCLUDED.display_name;
  UPDATE public.document_guest_links SET use_count = use_count + 1, last_used_at = now() WHERE id = v_link.id;
  RETURN QUERY
  SELECT d.id, d.name::text, v_link.role, v_link.expires_at FROM public.documents d WHERE d.id = v_link.document_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_guest_link_password(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.redeem_guest_link_checked(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.redeem_guest_link(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_guest_link_password(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_guest_link_checked(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_guest_link(text, text) TO authenticated;

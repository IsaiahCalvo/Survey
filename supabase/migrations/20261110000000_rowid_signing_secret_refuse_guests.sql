-- Guest-link sessions (anonymous sign-ins) never get a document's Row ID
-- signing secret. A live guest editor passed the editor check, and the secret
-- stayed valid after their link ended or was revoked. Guests cannot apply
-- Excel changes (excel-apply-changeset refuses them) or link a live sheet, so
-- nothing they do needs it; their Export data falls back to blank Row IDs,
-- as it does offline. Bodies are unchanged apart from the guest check.

CREATE OR REPLACE FUNCTION public.kal308a_get_or_create_signing_secret(
  p_document_id     UUID,
  p_signing_id_seed TEXT
)
RETURNS TABLE (key_id TEXT, secret_b64 TEXT, signing_doc_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'kal308a: not authenticated';
  END IF;
  IF public.is_guest_session() THEN
    RAISE EXCEPTION 'kal308a: not available to guest links';
  END IF;
  IF NOT public.user_can_access_document(p_document_id, 'editor') THEN
    RAISE EXCEPTION 'kal308a: insufficient role — editor or owner required';
  END IF;
  IF p_signing_id_seed IS NULL OR p_signing_id_seed = '' THEN
    RAISE EXCEPTION 'kal308a: signing id seed required';
  END IF;

  RETURN QUERY
  INSERT INTO public.rowid_signing_secrets (document_id, key_id, secret_b64, signing_doc_id)
  VALUES (
    p_document_id,
    'k1',
    replace(encode(extensions.gen_random_bytes(32), 'base64'), E'\n', ''),
    p_signing_id_seed
  )
  ON CONFLICT (document_id, key_id) DO UPDATE
    SET document_id = public.rowid_signing_secrets.document_id
  RETURNING
    public.rowid_signing_secrets.key_id,
    public.rowid_signing_secrets.secret_b64,
    public.rowid_signing_secrets.signing_doc_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.kal308a_get_signing_secret(
  p_document_id UUID
)
RETURNS TABLE (key_id TEXT, secret_b64 TEXT, signing_doc_id TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'kal308a: not authenticated';
  END IF;
  IF public.is_guest_session() THEN
    RAISE EXCEPTION 'kal308a: not available to guest links';
  END IF;
  IF NOT public.user_can_access_document(p_document_id, 'editor') THEN
    RAISE EXCEPTION 'kal308a: insufficient role — editor or owner required';
  END IF;

  RETURN QUERY
  SELECT s.key_id, s.secret_b64, s.signing_doc_id
    FROM public.rowid_signing_secrets s
   WHERE s.document_id = p_document_id
     AND s.is_current = TRUE
   LIMIT 1;
END;
$$;

-- CREATE OR REPLACE keeps the grants; restated so this file stands alone.
REVOKE ALL ON FUNCTION public.kal308a_get_or_create_signing_secret(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kal308a_get_or_create_signing_secret(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.kal308a_get_or_create_signing_secret(UUID, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.kal308a_get_signing_secret(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kal308a_get_signing_secret(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.kal308a_get_signing_secret(UUID) TO authenticated, service_role;

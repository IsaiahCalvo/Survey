-- KAL-308a — Move the Row-ID signing secret server-side.
--
-- Governing spec: PLAN-KAL308a.md (Codex-APPROVED 2 rounds) + PLAN-KAL308.md
-- Decision 2/3 + PLAN-EXCEL-SECURITY-V1.md.
--
-- Problem: the per-document Row-ID HMAC signing secret was minted on the client
-- (crypto.getRandomValues) and stored only in localStorage, so a Supabase Edge
-- Function could never VERIFY a Row-ID token (it has no secret) — which blocks
-- KAL-308's server-side change-set validation from trusting a Row-ID.
--
-- Model B (Codex-validated): store the secret server-side keyed by the stable
-- documents.id UUID; the Edge reads it via service-role, AND authorized
-- editor/owner clients resolve it via the RLS-gated RPCs below so the existing
-- pure-JS rowIdToken.js (generateRowIdToken / classifyRowIdToken) keeps doing the
-- HMAC unchanged. The token is identity-binding, NOT authorization — the
-- actor-role check is the security wall; a viewer/anon can never resolve the
-- secret, so they can never forge a token.
--
-- Key design points:
--   • secret_b64 is stored as the EXACT base64 STRING the JS HMAC keys on
--     (rowIdToken.js importHmacKey does textEncoder.encode(secret) over the base64
--     string). Newlines stripped so it never wraps. (Avoids the S3 byte trap.)
--   • signing_doc_id is FROZEN at first mint and returned to the client to sign /
--     verify over — stable across PDF renames, and the value KAL-308's Edge checks
--     the token's embedded documentId against (never a parsed/client value).
--   • No change to kal307_register_workbook (mint is decoupled from registration).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Table — service-role / SECURITY DEFINER access only; no direct client access
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rowid_signing_secrets (
  document_id    UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  key_id         TEXT        NOT NULL,            -- 'k1' (matches token grammar [A-Za-z0-9_-]+)
  secret_b64     TEXT        NOT NULL,            -- base64 string of 32 random bytes; the EXACT
                                                  -- string rowIdToken.js HMACs over (newline-free)
  signing_doc_id TEXT        NOT NULL,            -- FROZEN canonical signing id (composite at first
                                                  -- mint); client signs/verifies over THIS; Edge
                                                  -- checks token.documentId === this value
  is_current     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, key_id)
);

CREATE INDEX IF NOT EXISTS rowid_signing_secrets_document_idx
  ON public.rowid_signing_secrets (document_id);

-- RLS on + REVOKE all client privileges. Defense in depth: even with RLS enabled
-- and zero policies (default-deny), also strip the table grant so a direct client
-- query raises "permission denied". All legitimate access is via the SECURITY
-- DEFINER RPCs (runs as owner) or the service role (the Edge; bypasses RLS).
ALTER TABLE public.rowid_signing_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rowid_signing_secrets FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. get-or-create (EXPORT path) — mints if absent, returns the frozen values
-- ---------------------------------------------------------------------------
-- Editor/owner only. Atomic INSERT ... ON CONFLICT ... RETURNING so concurrent
-- first-exports never unique-violate; the no-op DO UPDATE lets us RETURNING the
-- existing row, whose secret_b64 + signing_doc_id are the FROZEN originals.
-- p_signing_id_seed is used ONLY on first insert.

CREATE OR REPLACE FUNCTION public.kal308a_get_or_create_signing_secret(
  p_document_id     UUID,
  p_signing_id_seed TEXT
)
RETURNS TABLE (key_id TEXT, secret_b64 TEXT, signing_doc_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'kal308a: not authenticated';
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
    -- no-op update (set to its own value) so the existing row is returned unchanged
    SET document_id = public.rowid_signing_secrets.document_id
  RETURNING
    public.rowid_signing_secrets.key_id,
    public.rowid_signing_secrets.secret_b64,
    public.rowid_signing_secrets.signing_doc_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal308a_get_or_create_signing_secret(UUID, TEXT)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. read (IMPORT / VERIFY path) — read-only, never mints
-- ---------------------------------------------------------------------------
-- Returns the secret + frozen signing id for an authorized editor/owner so the
-- client can verify tokens locally with classifyRowIdToken (unchanged). Returns
-- zero rows when no server key exists (→ client treats as key-unavailable →
-- review; it must NOT mint on the import path).

CREATE OR REPLACE FUNCTION public.kal308a_get_signing_secret(
  p_document_id UUID
)
RETURNS TABLE (key_id TEXT, secret_b64 TEXT, signing_doc_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'kal308a: not authenticated';
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

GRANT EXECUTE ON FUNCTION public.kal308a_get_signing_secret(UUID)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. has-server-key (PREFLIGHT) — bool, gated so it can't leak existence by UUID
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.kal308a_has_server_key(
  p_document_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'kal308a: not authenticated';
  END IF;
  IF NOT public.user_can_access_document(p_document_id, 'editor') THEN
    RAISE EXCEPTION 'kal308a: insufficient role — editor or owner required';
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.rowid_signing_secrets
     WHERE document_id = p_document_id AND is_current = TRUE
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal308a_has_server_key(UUID)
  TO authenticated;

COMMENT ON TABLE public.rowid_signing_secrets IS
  'KAL-308a: per-document Row-ID HMAC signing secret, server-held so the Edge can '
  'verify tokens. secret_b64 is the exact base64 string the JS HMAC keys on. '
  'signing_doc_id is frozen at first mint. Access only via kal308a_* SECURITY '
  'DEFINER RPCs (editor/owner) or the service role.';

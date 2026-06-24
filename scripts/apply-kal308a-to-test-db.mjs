#!/usr/bin/env node
// scripts/apply-kal308a-to-test-db.mjs — KAL-308a (server-side Row-ID signing
// secret) applied to the allowlisted cloud TEST project via the Supabase
// Management API. Mirrors scripts/apply-kal307-to-test-db.mjs.
//
// Installs (idempotently): the KAL-307 prerequisites (documents.user_id,
// document_collaborators, user_can_access_document, pgcrypto) — harmless if
// KAL-307 already applied — then the KAL-308a table + 3 RPCs.
//
// Auth: SUPABASE_ACCESS_TOKEN env var (account token; never stored, never logged).
// Usage: SUPABASE_ACCESS_TOKEN=… node scripts/apply-kal308a-to-test-db.mjs [--reset]
// NEVER touches the production project (cvamwtpsuvxvjdnotbeg).

const ALLOWED_TEST_REFS = ['zgdkyslxbkusexmkfvgd']; // survey-test
const PROD_REF           = 'cvamwtpsuvxvjdnotbeg';  // production — listed only to refuse it
const TEST_REF           = 'zgdkyslxbkusexmkfvgd';

const args  = process.argv.slice(2);
const reset = args.includes('--reset');

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error(
    'SUPABASE_ACCESS_TOKEN is required (never stored, never logged).\n' +
    'Run `supabase login` first, then export the token from the keychain.'
  );
  process.exit(1);
}
if (TEST_REF === PROD_REF) { console.error('REFUSED: TEST_REF === PROD_REF (code bug).'); process.exit(1); }
if (!ALLOWED_TEST_REFS.includes(TEST_REF)) {
  console.error(`REFUSED: "${TEST_REF}" not in allowlist.`); process.exit(1);
}
const masked = `${TEST_REF.slice(0, 4)}…`;
console.log(`[kal308a-apply] target TEST project ${masked} (prod ${PROD_REF.slice(0,4)}… structurally blocked); reset=${reset}`);

const RESET_SQL = `
DROP FUNCTION IF EXISTS public.kal308a_get_or_create_signing_secret(UUID, TEXT);
DROP FUNCTION IF EXISTS public.kal308a_get_signing_secret(UUID);
DROP FUNCTION IF EXISTS public.kal308a_has_server_key(UUID);
DROP TABLE    IF EXISTS public.rowid_signing_secrets;
`;

// KAL-307 prerequisites (idempotent; harmless if already installed by the KAL-307 apply).
const PREREQ_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS user_id UUID;
CREATE TABLE IF NOT EXISTS public.document_collaborators (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT        NOT NULL DEFAULT 'editor' CHECK (role IN ('viewer','editor','owner')),
  status      TEXT        NOT NULL DEFAULT 'active'  CHECK (status IN ('pending','active','revoked')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, user_id)
);
ALTER TABLE public.document_collaborators ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dc_kal307_test_deny_all ON public.document_collaborators;
CREATE POLICY dc_kal307_test_deny_all ON public.document_collaborators FOR ALL USING (FALSE) WITH CHECK (FALSE);
CREATE OR REPLACE FUNCTION public.user_can_access_document(doc_id UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE doc_owner_id UUID; user_role TEXT;
BEGIN
  SELECT user_id INTO doc_owner_id FROM public.documents WHERE id = doc_id;
  IF doc_owner_id IS NULL THEN RETURN FALSE; END IF;
  IF doc_owner_id = auth.uid() THEN RETURN TRUE; END IF;
  SELECT role INTO user_role FROM public.document_collaborators
   WHERE document_id = doc_id AND user_id = auth.uid() AND status = 'active';
  IF user_role IS NULL THEN RETURN FALSE; END IF;
  CASE required_role
    WHEN 'viewer' THEN RETURN user_role IN ('viewer','editor','owner');
    WHEN 'editor' THEN RETURN user_role IN ('editor','owner');
    WHEN 'owner'  THEN RETURN user_role = 'owner';
    ELSE RETURN FALSE;
  END CASE;
END; $$;
GRANT EXECUTE ON FUNCTION public.user_can_access_document(UUID, TEXT) TO authenticated;
`;

// KAL-308a — see supabase/migrations/20260624120000_kal308a_rowid_signing_secrets.sql
// for the authoritative source. Idempotent re-application for the TEST project.
const KAL308A_SQL = `
CREATE TABLE IF NOT EXISTS public.rowid_signing_secrets (
  document_id    UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  key_id         TEXT        NOT NULL,
  secret_b64     TEXT        NOT NULL,
  signing_doc_id TEXT        NOT NULL,
  is_current     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, key_id)
);
CREATE INDEX IF NOT EXISTS rowid_signing_secrets_document_idx
  ON public.rowid_signing_secrets (document_id);
ALTER TABLE public.rowid_signing_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rowid_signing_secrets FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.kal308a_get_or_create_signing_secret(
  p_document_id UUID, p_signing_id_seed TEXT)
RETURNS TABLE (key_id TEXT, secret_b64 TEXT, signing_doc_id TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'kal308a: not authenticated'; END IF;
  IF NOT public.user_can_access_document(p_document_id, 'editor') THEN
    RAISE EXCEPTION 'kal308a: insufficient role — editor or owner required';
  END IF;
  IF p_signing_id_seed IS NULL OR p_signing_id_seed = '' THEN
    RAISE EXCEPTION 'kal308a: signing id seed required';
  END IF;
  RETURN QUERY
  INSERT INTO public.rowid_signing_secrets (document_id, key_id, secret_b64, signing_doc_id)
  VALUES (p_document_id, 'k1',
          replace(encode(extensions.gen_random_bytes(32), 'base64'), E'\\n', ''),
          p_signing_id_seed)
  ON CONFLICT (document_id, key_id) DO UPDATE
    SET document_id = public.rowid_signing_secrets.document_id
  RETURNING public.rowid_signing_secrets.key_id,
            public.rowid_signing_secrets.secret_b64,
            public.rowid_signing_secrets.signing_doc_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.kal308a_get_or_create_signing_secret(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.kal308a_get_signing_secret(p_document_id UUID)
RETURNS TABLE (key_id TEXT, secret_b64 TEXT, signing_doc_id TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'kal308a: not authenticated'; END IF;
  IF NOT public.user_can_access_document(p_document_id, 'editor') THEN
    RAISE EXCEPTION 'kal308a: insufficient role — editor or owner required';
  END IF;
  RETURN QUERY
  SELECT s.key_id, s.secret_b64, s.signing_doc_id
    FROM public.rowid_signing_secrets s
   WHERE s.document_id = p_document_id AND s.is_current = TRUE
   LIMIT 1;
END; $$;
GRANT EXECUTE ON FUNCTION public.kal308a_get_signing_secret(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.kal308a_has_server_key(p_document_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'kal308a: not authenticated'; END IF;
  IF NOT public.user_can_access_document(p_document_id, 'editor') THEN
    RAISE EXCEPTION 'kal308a: insufficient role — editor or owner required';
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.rowid_signing_secrets
                  WHERE document_id = p_document_id AND is_current = TRUE);
END; $$;
GRANT EXECUTE ON FUNCTION public.kal308a_has_server_key(UUID) TO authenticated;
`;

const VERIFY_SQL = `
SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='rowid_signing_secrets') AS table_present,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='kal308a_get_or_create_signing_secret') AS rpc_getcreate,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='kal308a_get_signing_secret') AS rpc_get,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='kal308a_has_server_key') AS rpc_haskey;
`;

async function runSql(label, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${TEST_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`[kal308a-apply] ${label} FAILED on ${masked}: HTTP ${res.status}`);
    console.error(body.slice(0, 600));
    process.exit(1);
  }
  console.log(`[kal308a-apply] ${label}: HTTP ${res.status} OK`);
  return body;
}

if (reset) { console.log('[kal308a-apply] --reset: dropping KAL-308a objects...'); await runSql('reset', RESET_SQL); }
await runSql('apply prerequisites', PREREQ_SQL);
await runSql('apply KAL-308a table + RPCs', KAL308A_SQL);

const verifyBody = await runSql('verify schema objects', VERIFY_SQL);
let v;
try { const parsed = JSON.parse(verifyBody); v = Array.isArray(parsed) ? parsed[0] : parsed; }
catch { console.error('[kal308a-apply] could not parse verify:', verifyBody.slice(0, 200)); process.exit(1); }
console.log(`[kal308a-apply] table=${v.table_present} get_or_create=${v.rpc_getcreate} get=${v.rpc_get} has_key=${v.rpc_haskey}`);
if (![v.table_present, v.rpc_getcreate, v.rpc_get, v.rpc_haskey].every((n) => Number(n) >= 1)) {
  console.error('[kal308a-apply] FAILED: missing objects after apply.'); process.exit(1);
}
console.log('[kal308a-apply] KAL-308a applied + verified on TEST project. Ready for integration tests.');

#!/usr/bin/env node
// scripts/apply-kal307-to-test-db.mjs — KAL-307 schema prerequisites + migration
// applied to the allowlisted cloud TEST project via the Supabase Management API.
//
// Context: the test project (survey-test) is bootstrap-maintained, not
// migration-maintained. The existing bootstrap only provides a minimal stub
// `documents` table (id, name, created_by, created_at). KAL-307 needs:
//   • documents.user_id column (the canonical owner column)
//   • document_collaborators table (for role checks)
//   • user_can_access_document() function (canonical body from 20260527 migration)
//   • pgcrypto extension
//   • The KAL-307 table + RLS + RPC itself
//
// Auth: SUPABASE_ACCESS_TOKEN env var (same as bootstrap-test-db.mjs).
// Usage:
//   SUPABASE_ACCESS_TOKEN=… node scripts/apply-kal307-to-test-db.mjs [--reset]
//
// --reset drops the KAL-307 objects first so you can re-apply cleanly.
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
    'Run `supabase login` first — the CLI stores the token in the macOS keychain.\n' +
    'Retrieve it with: supabase projects list  (confirms auth), then\n' +
    '  export SUPABASE_ACCESS_TOKEN=$(supabase --experimental access-token 2>/dev/null || echo "")\n' +
    'Or obtain from: https://supabase.com/dashboard/account/tokens'
  );
  process.exit(1);
}

if (TEST_REF === PROD_REF) {
  // Structural guard — this can never fire with the current constants, but
  // it makes the intent auditable.
  console.error('REFUSED: TEST_REF matches PROD_REF. This is a code bug — fix the constants.');
  process.exit(1);
}
if (!ALLOWED_TEST_REFS.includes(TEST_REF)) {
  console.error(`REFUSED: "${TEST_REF}" is not in the allowlist. Only ${ALLOWED_TEST_REFS.join(', ')} are permitted.`);
  process.exit(1);
}

const masked = `${TEST_REF.slice(0, 4)}…`;
console.log(`[kal307-apply] target TEST project ${masked} (production is ${PROD_REF.slice(0,4)}… — structurally blocked)`);
console.log(`[kal307-apply] reset=${reset}`);

// ---------------------------------------------------------------------------
// SQL blocks — applied in order. Each is idempotent.
// ---------------------------------------------------------------------------

const RESET_SQL = `
-- Drop KAL-307 objects only — leave bootstrap objects (documents, phase27 tables) intact.
DROP FUNCTION IF EXISTS public.kal307_register_workbook(UUID, TEXT, TEXT, TEXT, TEXT);
DROP TABLE    IF EXISTS public.excel_workbook_registrations;
`;

// Prerequisites the bootstrap does not install but KAL-307 needs.
const PREREQ_SQL = `
-- 1. pgcrypto (needed for gen_random_bytes + digest in the RPC).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. documents.user_id — the canonical owner column (the bootstrap stub omits it).
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS user_id UUID;

-- 3. document_collaborators — minimal shape; enough for user_can_access_document.
CREATE TABLE IF NOT EXISTS public.document_collaborators (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT        NOT NULL DEFAULT 'editor'
                          CHECK (role IN ('viewer', 'editor', 'owner')),
  status      TEXT        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('pending', 'active', 'revoked')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, user_id)
);
ALTER TABLE public.document_collaborators ENABLE ROW LEVEL SECURITY;
-- Deny-all stub — the KAL-307 RPC runs SECURITY DEFINER so it bypasses RLS.
DROP POLICY IF EXISTS dc_kal307_test_deny_all ON public.document_collaborators;
CREATE POLICY dc_kal307_test_deny_all ON public.document_collaborators
  FOR ALL USING (FALSE) WITH CHECK (FALSE);

-- 4. user_can_access_document — canonical body (from 20260527130000 migration).
--    Owner via documents.user_id; collaborator via document_collaborators.
CREATE OR REPLACE FUNCTION public.user_can_access_document(
  doc_id        UUID,
  required_role TEXT DEFAULT 'viewer'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  doc_owner_id UUID;
  user_role    TEXT;
BEGIN
  SELECT user_id INTO doc_owner_id
    FROM public.documents
   WHERE id = doc_id;

  IF doc_owner_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF doc_owner_id = auth.uid() THEN
    RETURN TRUE;
  END IF;

  SELECT role INTO user_role
    FROM public.document_collaborators
   WHERE document_id = doc_id
     AND user_id     = auth.uid()
     AND status      = 'active';

  IF user_role IS NULL THEN
    RETURN FALSE;
  END IF;

  CASE required_role
    WHEN 'viewer' THEN RETURN user_role IN ('viewer', 'editor', 'owner');
    WHEN 'editor' THEN RETURN user_role IN ('editor', 'owner');
    WHEN 'owner'  THEN RETURN user_role = 'owner';
    ELSE RETURN FALSE;
  END CASE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_can_access_document(UUID, TEXT) TO authenticated;
`;

// The KAL-307 migration verbatim (minus the CREATE EXTENSION which is in PREREQ_SQL).
const KAL307_SQL = `
-- KAL-307 — Server-minted workbook registration (one live workbook per survey).
-- See supabase/migrations/20260611120000_kal307_workbook_registrations.sql for the
-- authoritative source. This is an idempotent re-application for the TEST project.

CREATE TABLE IF NOT EXISTS public.excel_workbook_registrations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  template_id      TEXT        NOT NULL,
  workbook_id      TEXT        NOT NULL,
  token_hash       TEXT        NOT NULL,
  token_expiry     TIMESTAMPTZ NOT NULL,
  revoked_at       TIMESTAMPTZ,
  revoked_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  graph_drive_id   TEXT,
  graph_item_id    TEXT,
  capability_tier  TEXT        NOT NULL DEFAULT 'local',
  registered_by    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  generation       INTEGER     NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS excel_workbook_registrations_one_active_per_survey
  ON public.excel_workbook_registrations (document_id, template_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS excel_workbook_registrations_document_idx
  ON public.excel_workbook_registrations (document_id);

CREATE INDEX IF NOT EXISTS excel_workbook_registrations_workbook_id_idx
  ON public.excel_workbook_registrations (workbook_id);

ALTER TABLE public.excel_workbook_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view workbook registrations"
  ON public.excel_workbook_registrations;
CREATE POLICY "Members can view workbook registrations"
  ON public.excel_workbook_registrations FOR SELECT
  USING (public.user_can_access_document(document_id, 'viewer'));

DROP POLICY IF EXISTS "Direct INSERT blocked — use RPC"
  ON public.excel_workbook_registrations;
CREATE POLICY "Direct INSERT blocked — use RPC"
  ON public.excel_workbook_registrations FOR INSERT
  WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Direct UPDATE blocked — use RPC"
  ON public.excel_workbook_registrations;
CREATE POLICY "Direct UPDATE blocked — use RPC"
  ON public.excel_workbook_registrations FOR UPDATE
  USING (FALSE);

CREATE OR REPLACE FUNCTION public.kal307_register_workbook(
  p_document_id     UUID,
  p_template_id     TEXT,
  p_graph_drive_id  TEXT  DEFAULT NULL,
  p_graph_item_id   TEXT  DEFAULT NULL,
  p_capability_tier TEXT  DEFAULT 'local'
)
RETURNS TABLE (workbook_id TEXT, sync_token TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id         UUID  := auth.uid();
  v_is_owner         BOOLEAN;
  v_is_editor        BOOLEAN;
  v_active_id        UUID;
  v_active_gen       INTEGER;
  v_workbook_id      TEXT;
  v_raw_token        TEXT;
  v_token_hash       TEXT;
  v_token_bytes      BYTEA;
  v_wb_bytes         BYTEA;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'kal307: not authenticated';
  END IF;

  v_is_owner  := public.user_can_access_document(p_document_id, 'owner');
  v_is_editor := public.user_can_access_document(p_document_id, 'editor');

  IF NOT v_is_editor THEN
    RAISE EXCEPTION 'kal307: insufficient role — editor or owner required';
  END IF;

  SELECT id, generation
    INTO v_active_id, v_active_gen
    FROM public.excel_workbook_registrations
   WHERE document_id = p_document_id
     AND template_id = p_template_id
     AND revoked_at  IS NULL
   FOR UPDATE;

  IF FOUND THEN
    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'kal307: owner-only — an active workbook registration already exists; only the document owner can replace it';
    END IF;

    UPDATE public.excel_workbook_registrations
       SET revoked_at = now(),
           revoked_by = v_actor_id
     WHERE id = v_active_id;
  ELSE
    v_active_gen := 0;
  END IF;

  v_wb_bytes    := gen_random_bytes(16);
  v_workbook_id := 'wb_' || encode(v_wb_bytes, 'hex');

  v_token_bytes := gen_random_bytes(32);
  v_raw_token   := 'st_' || encode(v_token_bytes, 'hex');

  v_token_hash  := encode(digest(v_raw_token, 'sha256'), 'hex');

  INSERT INTO public.excel_workbook_registrations (
    document_id, template_id,
    workbook_id, token_hash, token_expiry,
    graph_drive_id, graph_item_id,
    capability_tier,
    registered_by, generation
  ) VALUES (
    p_document_id, p_template_id,
    v_workbook_id, v_token_hash, now() + INTERVAL '1 year',
    p_graph_drive_id, p_graph_item_id,
    p_capability_tier,
    v_actor_id, v_active_gen + 1
  );

  RETURN QUERY SELECT v_workbook_id, v_raw_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal307_register_workbook(UUID, TEXT, TEXT, TEXT, TEXT)
  TO authenticated;

COMMENT ON FUNCTION public.kal307_register_workbook(UUID, TEXT, TEXT, TEXT, TEXT) IS
  'KAL-307: server-mints workbookId + syncToken for one-live-workbook registry. '
  'Raw token returned ONCE to caller; DB stores only SHA-256 hash. '
  'Editor can register first workbook; owner-only to replace an existing active one.';

COMMENT ON TABLE public.excel_workbook_registrations IS
  'KAL-307: one-live-workbook registry. Exactly one active row (revoked_at IS NULL) '
  'per (document_id, template_id). Token hashes only — raw secrets never stored. '
  'Managed exclusively through kal307_register_workbook RPC (SECURITY DEFINER).';
`;

const VERIFY_SQL = `
SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'excel_workbook_registrations') AS table_present,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'kal307_register_workbook') AS rpc_present,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'user_can_access_document') AS helper_present,
  (SELECT count(*) FROM pg_extension WHERE extname = 'pgcrypto') AS pgcrypto_present;
`;

// ---------------------------------------------------------------------------
// Management API runner
// ---------------------------------------------------------------------------

async function runSql(label, query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${TEST_REF}/database/query`,
    {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    }
  );
  const body = await res.text();
  if (!res.ok) {
    console.error(`[kal307-apply] ${label} FAILED on ${masked}: HTTP ${res.status}`);
    console.error(body.slice(0, 500));
    process.exit(1);
  }
  console.log(`[kal307-apply] ${label}: HTTP ${res.status} OK`);
  return body;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (reset) {
  console.log('[kal307-apply] --reset: dropping KAL-307 objects...');
  await runSql('reset KAL-307 objects', RESET_SQL);
}

await runSql('apply prerequisites (pgcrypto + documents.user_id + document_collaborators + helper fn)', PREREQ_SQL);
await runSql('apply KAL-307 table + RLS + RPC', KAL307_SQL);

const verifyBody = await runSql('verify schema objects', VERIFY_SQL);
let v;
try {
  const parsed = JSON.parse(verifyBody);
  v = Array.isArray(parsed) ? parsed[0] : parsed;
} catch {
  console.error('[kal307-apply] could not parse verify response:', verifyBody.slice(0, 200));
  process.exit(1);
}
console.log(
  `[kal307-apply] table_present=${v.table_present} rpc_present=${v.rpc_present} ` +
  `helper_present=${v.helper_present} pgcrypto_present=${v.pgcrypto_present}`
);

const allPresent = [v.table_present, v.rpc_present, v.helper_present, v.pgcrypto_present]
  .every((n) => Number(n) >= 1);
if (!allPresent) {
  console.error('[kal307-apply] FAILED: one or more expected objects missing after apply.');
  process.exit(1);
}
console.log('[kal307-apply] KAL-307 applied and verified on TEST project. Ready for integration tests.');

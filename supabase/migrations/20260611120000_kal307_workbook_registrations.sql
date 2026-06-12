-- KAL-307 — Server-minted workbook registration (one live workbook per survey).
--
-- Governing spec: PLAN-EXCEL-SECURITY-V1.md step 1.
-- Design decisions (from PLAN-REVIEW-LOG-excel-security.md rounds 1–3):
--   • Server mints workbookId + syncToken — client never sees the raw secret after
--     the RPC call returns. DB stores only the SHA-256 hex token_hash, never the
--     raw token.
--   • One ACTIVE registration per (document_id, template_id) — partial unique index
--     WHERE revoked_at IS NULL.  Re-export revokes the prior registration and mints
--     a new generation; revoked rows stay for the audit trail.
--   • RLS: members can SELECT; INSERT/UPDATE allowed only through the SECURITY
--     DEFINER RPC (table INSERT/UPDATE policies block direct DML).
--   • Owner-only re-link/replace (revoke + new generation).  Editors can register
--     a first workbook but cannot displace an existing active one.
--   • graph_drive_id / graph_item_id bound at registration for business exports.
--     The server trusts the client to supply these because the authorised role is
--     the trust anchor; full server-side Graph verification of file identity ships
--     with the server-relay work in step 2+.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.excel_workbook_registrations (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which survey is this workbook registered for?
  document_id         UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  template_id         TEXT        NOT NULL,   -- template supabaseId / local id (TEXT, not FK)

  -- Server-minted workbook identity (opaque to the client after creation).
  workbook_id         TEXT        NOT NULL,   -- server-generated; embedded in workbook
  token_hash          TEXT        NOT NULL,   -- SHA-256 hex of syncToken; NEVER the raw token
  token_expiry        TIMESTAMPTZ NOT NULL,   -- when the token should be rotated / expires

  -- Revocation / lifecycle.
  revoked_at          TIMESTAMPTZ,            -- NULL → active; set on re-export or explicit revoke
  revoked_by          UUID        REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Graph file identity (bound at registration for business/SharePoint exports).
  graph_drive_id      TEXT,                   -- sharePointDriveId at registration time
  graph_item_id       TEXT,                   -- oneDriveFileId at registration time

  -- Capability tier at registration time (local | personal | business).
  capability_tier     TEXT        NOT NULL DEFAULT 'local',

  -- Actor + audit.
  registered_by       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  generation          INTEGER     NOT NULL DEFAULT 1,   -- increments on re-export / replace

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforce one ACTIVE registration per (document_id, template_id).
-- Revoked rows are kept for audit; only NULLable revoked_at rows are unique.
CREATE UNIQUE INDEX IF NOT EXISTS excel_workbook_registrations_one_active_per_survey
  ON public.excel_workbook_registrations (document_id, template_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS excel_workbook_registrations_document_idx
  ON public.excel_workbook_registrations (document_id);

CREATE INDEX IF NOT EXISTS excel_workbook_registrations_workbook_id_idx
  ON public.excel_workbook_registrations (workbook_id);

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.excel_workbook_registrations ENABLE ROW LEVEL SECURITY;

-- SELECT: any member with at least viewer access can read registrations.
DROP POLICY IF EXISTS "Members can view workbook registrations"
  ON public.excel_workbook_registrations;
CREATE POLICY "Members can view workbook registrations"
  ON public.excel_workbook_registrations FOR SELECT
  USING (public.user_can_access_document(document_id, 'viewer'));

-- INSERT / UPDATE: blocked via direct DML — must go through the SECURITY DEFINER
-- RPC which enforces role + one-active-per-survey + owner-only-replace.
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

-- ---------------------------------------------------------------------------
-- 3. Registration RPC
--
-- kal307_register_workbook(p_document_id, p_template_id,
--                          p_graph_drive_id, p_graph_item_id,
--                          p_capability_tier)
--
-- Behaviour:
--   a) Caller must be editor OR owner on the document.
--   b) If there is NO active registration, insert a new one (generation 1).
--   c) If there IS an active registration AND the caller is OWNER, revoke the
--      old one and insert a new one (generation N+1).
--   d) If there IS an active registration AND the caller is EDITOR (not owner),
--      raise an exception — editors cannot displace a team workbook; they must
--      request the owner to re-link.
--   e) Returns: workbook_id (TEXT) + sync_token (TEXT, raw — returned ONCE,
--      never stored).
--   f) The raw token is minted from gen_random_bytes(32) encoded as hex,
--      namespaced with the workbook_id prefix for readability.
--      DB stores only encode(digest(raw_token, 'sha256'), 'hex').
--      Requires the pgcrypto extension (already present via gen_random_uuid).
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
  -- ① Actor must be authenticated.
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'kal307: not authenticated';
  END IF;

  -- ② Role check: must be editor or owner.
  v_is_owner  := public.user_can_access_document(p_document_id, 'owner');
  v_is_editor := public.user_can_access_document(p_document_id, 'editor');

  IF NOT v_is_editor THEN
    RAISE EXCEPTION 'kal307: insufficient role — editor or owner required';
  END IF;

  -- ③ Check for an existing active registration.
  SELECT id, generation
    INTO v_active_id, v_active_gen
    FROM public.excel_workbook_registrations
   WHERE document_id = p_document_id
     AND template_id = p_template_id
     AND revoked_at  IS NULL
   FOR UPDATE;     -- lock the row to prevent concurrent registrations

  IF FOUND THEN
    -- There is an active registration.
    IF NOT v_is_owner THEN
      -- Editors cannot replace a live team workbook.
      RAISE EXCEPTION 'kal307: owner-only — an active workbook registration already exists; only the document owner can replace it';
    END IF;

    -- Owner: revoke the old registration.
    UPDATE public.excel_workbook_registrations
       SET revoked_at = now(),
           revoked_by = v_actor_id
     WHERE id = v_active_id;
  ELSE
    v_active_gen := 0;   -- will become generation 1
  END IF;

  -- ④ Mint workbook_id: 16 random bytes → hex string, prefixed.
  v_wb_bytes    := extensions.gen_random_bytes(16);
  v_workbook_id := 'wb_' || encode(v_wb_bytes, 'hex');

  -- ⑤ Mint syncToken: 32 random bytes → hex string, prefixed.
  v_token_bytes := extensions.gen_random_bytes(32);
  v_raw_token   := 'st_' || encode(v_token_bytes, 'hex');

  -- ⑥ Hash the token for storage (SHA-256 hex).
  v_token_hash  := encode(extensions.digest(v_raw_token, 'sha256'), 'hex');

  -- ⑦ Insert the new registration.
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

  -- ⑧ Return workbook_id + raw sync_token (returned ONCE — never stored in DB).
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

-- KAL-309 — Excel-sync keystone: server-authoritative change-set apply + ordered op log.
--
-- Governing spec: PLAN-KAL309.md (Codex-APPROVED round-3) sections A (schema) + B
-- (the apply RPC) + all helper RPCs.  Builds on:
--   • KAL-307 (20260611120000_kal307_workbook_registrations.sql) — one-live-workbook
--     registry; this migration adds an active-unique index on workbook_id AND the frozen
--     rowid_signing_doc_id column (KAL-308a put signing_doc_id on rowid_signing_secrets,
--     NOT on the registrations table, so this column is genuinely new here — see A.1 (ii)).
--   • KAL-308a (20260624120000_kal308a_rowid_signing_secrets.sql) — server-held Row-ID
--     signing secret + frozen signing_doc_id.  This migration mirrors that table's
--     access model exactly (RLS on, REVOKE ALL from authenticated/anon, NO client
--     policies — all access via SECURITY DEFINER RPCs or the service role).
--
-- Design anchors (from the Critique resolutions F0–F22, R2#1–4, and the round-3
-- Codex build notes — all AUTHORITATIVE):
--   F1  — the sync tables FK documents(id) ON DELETE CASCADE, NOT the registration row
--         (registrations are revoked + re-minted on every re-export).  template_id /
--         scope_id / workbook_generation are PLAIN columns; the active registration is
--         resolved at apply time by (document_id, template_id) WHERE revoked_at IS NULL.
--   F2  — excel_revision lives on excel_sync_head keyed by the STABLE (document_id,
--         template_id) mirror, NOT on the registration.  NOT added to registrations.
--   F3/F8 — marker_annotation_id NOT NULL; create-ids minted server-side ONCE, frozen.
--   F4  — excel_sync_audit immutability is TRIGGER-enforced (a SECURITY DEFINER RPC runs
--         as table owner and bypasses RLS + privileges, so REVOKE alone is insufficient).
--   F5  — head bump + op insert + state upsert are ONE atomic txn.
--   F7/F19 — idempotency authority is excel_sync_changesets (ALL per-row outcomes stored
--         verbatim); a replay returns the stored blob without re-minting.
--   F17 — the apply RPC re-checks editor/owner against p_actor_id DIRECTLY (never
--         user_can_access_document, which keys on auth.uid() and is NULL under the
--         service role).
--   F22 — every actor_id column is UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL.
--   R2#1 — apply-RPC step order is AUTH → registration → LOCK → REPLAY (the replay
--         short-circuit returns token material, so it must run AFTER auth + UNDER the lock).
--   R2#3 — registration id/generation derived SERVER-SIDE from workbook_id everywhere.
--   Codex build notes: (1) re-verify the derived registration matches document_id/
--   template_id; (2) kal309_persist_created_token idempotent + dedupes writeback_jobs;
--   (3) take-excel resolution is reload-safe (op back to 'accepted').
--
-- pgcrypto: all crypto via extensions.* under SET search_path = '' (KAL-307 lesson).
-- Idempotent: CREATE … IF NOT EXISTS / CREATE OR REPLACE / DROP … IF EXISTS guards
-- throughout so the file is safely re-runnable.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===========================================================================
-- A.1  Additive touches to excel_workbook_registrations (F16)
-- ===========================================================================
-- (i) F16: workbook_id must be UNIQUE on ACTIVE rows before the Edge / apply RPC
--     resolve the registration by it.  KAL-307 only made a PLAIN index
--     (20260611120000:63-64).  Partial-unique on active rows only — revoked rows keep
--     their old workbook_ids for the audit trail.
CREATE UNIQUE INDEX IF NOT EXISTS excel_workbook_registrations_workbook_id_active_uniq
  ON public.excel_workbook_registrations (workbook_id)
  WHERE revoked_at IS NULL;

-- (ii) Store the FROZEN canonical signing-id captured at register/export so the Edge can
--      resolve registration → signing-id in one read.  KAL-308a put signing_doc_id on the
--      rowid_signing_secrets TABLE, NOT on excel_workbook_registrations — so this column does
--      NOT exist yet and must be added here.  kal309_set_registration_signing_id populates it
--      (freeze-once); NULL on legacy rows forces a re-export (308a legacy-preflight).
ALTER TABLE public.excel_workbook_registrations
  ADD COLUMN IF NOT EXISTS rowid_signing_doc_id TEXT;

-- NOTE: excel_revision is DELIBERATELY NOT added here (F2 — it lives on
-- excel_sync_head, keyed by the stable mirror, not the swappable registration row).

-- ===========================================================================
-- A.2  excel_sync_head — per-mirror monotonic revision head (F2)
-- ===========================================================================
-- The serialization point + the fetch-since cursor source.  Keyed by the STABLE
-- (document_id, template_id) mirror so it survives every re-export.

CREATE TABLE IF NOT EXISTS public.excel_sync_head (
  document_id    UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  template_id    TEXT        NOT NULL,
  excel_revision BIGINT      NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, template_id)
);

-- ===========================================================================
-- A.3  excel_sync_state — latest-per-marker Excel-side identity + apply bookkeeping
-- ===========================================================================
-- Mirrors the excelSync identity record (excelIdentityRecord.js /
-- buildMarkerIdentityRecord) 1:1 + apply bookkeeping + materialization status.
-- Keyed by the stable mirror (document_id, template_id, scope_id,
-- marker_annotation_id) — NOT the registration id (F1).

CREATE TABLE IF NOT EXISTS public.excel_sync_state (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id                 UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  template_id                 TEXT        NOT NULL,                 -- F1: plain column
  scope_id                    TEXT        NOT NULL,
  workbook_generation         INTEGER     NOT NULL,                 -- F1: registration.generation snapshot
  marker_annotation_id        UUID        NOT NULL,                 -- F3/F8: minted for create, NOT NULL

  -- excelSync identity record (buildMarkerIdentityRecord), 1:1 column mapping
  identity_version            TEXT        NOT NULL,                 -- record.version
  origin                      TEXT        NOT NULL,                 -- 'import' | 'export'
  last_export_id              TEXT,                                 -- record.lastExportId
  was_written_as_row          BOOLEAN     NOT NULL DEFAULT FALSE,
  assigned_token              TEXT,                                 -- signed Row-ID (sensitive → NEVER returned via fetch_since)
  pending_rowid_writeback     BOOLEAN     NOT NULL DEFAULT FALSE,
  last_seen_row_number        INTEGER,                              -- positional memory
  last_ingest_seq             BIGINT,
  identity_vector_fingerprint TEXT        NOT NULL,
  full_row_fingerprint        TEXT        NOT NULL,
  field_fingerprints          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  copy_of_marker_id           TEXT,
  copy_ordinal                INTEGER,

  -- apply bookkeeping (Decision 0/4)
  last_applied_excel_revision BIGINT      NOT NULL DEFAULT 0,
  last_applied_op_uuid        UUID,                                 -- F8: durable op identity
  materialization_status      TEXT        NOT NULL DEFAULT 'accepted'
                                CHECK (materialization_status IN
                                  ('accepted','materialized','client_conflict_review')),
  op_status                   TEXT        NOT NULL DEFAULT 'accepted'
                                CHECK (op_status IN
                                  ('accepted','materialized','client_conflict_review','resolved')),

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- one state row per marker within the stable mirror scope (UPSERT target +
  -- the FOR UPDATE TOCTOU lock key in the apply RPC)
  UNIQUE (document_id, template_id, scope_id, marker_annotation_id)
);

CREATE INDEX IF NOT EXISTS excel_sync_state_mirror_idx
  ON public.excel_sync_state (document_id, template_id);
CREATE INDEX IF NOT EXISTS excel_sync_state_marker_idx
  ON public.excel_sync_state (marker_annotation_id);
CREATE INDEX IF NOT EXISTS excel_sync_state_open_review_idx
  ON public.excel_sync_state (document_id, template_id, marker_annotation_id)
  WHERE materialization_status = 'client_conflict_review';

-- ===========================================================================
-- A.4  excel_sync_ops — ordered accepted-op log (the fetch-since source)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.excel_sync_ops (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  op_uuid                UUID        NOT NULL DEFAULT gen_random_uuid(),  -- F8: GLOBAL durable op identity
  document_id            UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  template_id            TEXT        NOT NULL,                            -- F1: plain column
  scope_id               TEXT        NOT NULL,                            -- F1: plain column
  workbook_generation    INTEGER     NOT NULL,                           -- F1: snapshot of registration.generation
  excel_revision         BIGINT      NOT NULL,                           -- head value AFTER this op (monotonic per mirror)
  op_id                  TEXT        NOT NULL,                            -- per-change-set row id (idempotency)
  marker_annotation_id   UUID        NOT NULL,                           -- F3: minted for create, NOT NULL
  op_type                TEXT        NOT NULL CHECK (op_type IN ('apply','create')),
  -- field-level patch the client reducer merges; carries EVERYTHING the client's final
  -- app-vs-Excel check needs (payload contract below).  NO tokens, NO secrets.
  patch_payload          JSONB       NOT NULL,
  client_change_set_id   TEXT        NOT NULL,
  op_status              TEXT        NOT NULL DEFAULT 'accepted'
                           CHECK (op_status IN ('accepted','materialized','client_conflict_review','resolved')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- F8: op_uuid is globally unique (durable cross-client cursor identity)
  CONSTRAINT excel_sync_ops_op_uuid_uniq UNIQUE (op_uuid),
  -- idempotency: a replayed change-set row can never double-append
  CONSTRAINT excel_sync_ops_changeset_op_uniq UNIQUE (document_id, template_id, client_change_set_id, op_id),
  -- F5/F12 ordering key: one op per revision per mirror
  CONSTRAINT excel_sync_ops_mirror_revision_uniq UNIQUE (document_id, template_id, excel_revision)
);

CREATE INDEX IF NOT EXISTS excel_sync_ops_fetch_since_idx
  ON public.excel_sync_ops (document_id, template_id, excel_revision);
CREATE INDEX IF NOT EXISTS excel_sync_ops_marker_idx
  ON public.excel_sync_ops (marker_annotation_id);
CREATE INDEX IF NOT EXISTS excel_sync_ops_changeset_idx
  ON public.excel_sync_ops (document_id, template_id, client_change_set_id);

-- ===========================================================================
-- A.5  excel_sync_changesets — full per-changeset outcomes for replay-safety (F7, F19)
-- ===========================================================================
-- The idempotency authority AND the verbatim-replay source.  One row per accepted
-- submission of a client_change_set_id for a mirror.

CREATE TABLE IF NOT EXISTS public.excel_sync_changesets (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id          UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  template_id          TEXT        NOT NULL,                              -- F1: plain column
  actor_id             UUID        REFERENCES auth.users(id) ON DELETE SET NULL,  -- F22: nullable
  client_change_set_id TEXT        NOT NULL,
  request_hash         TEXT        NOT NULL,        -- sha256 of the canonical request body (replay sanity / mismatch detection)
  outcomes             JSONB       NOT NULL,        -- F19: ALL per-row outcomes verbatim
  writeback_jobs       JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- F20: created-row token writeback jobs (filled by the Edge persist step)
  revision_head        BIGINT      NOT NULL,        -- head AFTER this change-set
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- F7: idempotency authority — one stored result per change-set per mirror
  CONSTRAINT excel_sync_changesets_mirror_changeset_uniq UNIQUE (document_id, template_id, client_change_set_id)
);

CREATE INDEX IF NOT EXISTS excel_sync_changesets_mirror_idx
  ON public.excel_sync_changesets (document_id, template_id);

-- ===========================================================================
-- A.6  excel_sync_audit — content-free, immutable (F4, Decision 7)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.excel_sync_audit (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id            UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  template_id            TEXT        NOT NULL,                            -- F1: plain column
  workbook_generation    INTEGER     NOT NULL,                           -- F1: snapshot of registration.generation
  actor_id               UUID        REFERENCES auth.users(id) ON DELETE SET NULL,  -- F22: nullable, never NOT NULL+SET NULL
  capability_tier        TEXT        NOT NULL,
  client_change_set_id   TEXT        NOT NULL,
  marker_annotation_id   UUID,                              -- nullable: change-set-level rows
  row_outcome            TEXT        NOT NULL,              -- applied|create|conflict|stale|unauthorized|review|locked
  device_hint            TEXT,
  server_ts              TIMESTAMPTZ NOT NULL DEFAULT now() -- AUTH-03: server clock, never client
  -- NO row content.  No item/notes/entity/answers.  No token.
);

CREATE INDEX IF NOT EXISTS excel_sync_audit_doc_ts_idx
  ON public.excel_sync_audit (document_id, server_ts DESC);

-- F4: immutability is TRIGGER-enforced (a SECURITY DEFINER RPC runs as table owner and
--     bypasses RLS + privileges, so REVOKE alone is insufficient).
CREATE OR REPLACE FUNCTION public.kal309_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'excel_sync_audit is append-only (% blocked)', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS excel_sync_audit_no_update_delete ON public.excel_sync_audit;
CREATE TRIGGER excel_sync_audit_no_update_delete
  BEFORE UPDATE OR DELETE ON public.excel_sync_audit
  FOR EACH ROW EXECUTE FUNCTION public.kal309_audit_immutable();

-- ===========================================================================
-- A.7  RLS + grants for all five tables (mirrors the 308a table)
-- ===========================================================================
-- RLS on + REVOKE all client privileges.  Zero policies = default-deny for client
-- roles.  All access is via the SECURITY DEFINER RPCs (owner) or the service role
-- (the Edge; bypasses RLS).

ALTER TABLE public.excel_sync_head       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.excel_sync_state      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.excel_sync_ops        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.excel_sync_changesets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.excel_sync_audit      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.excel_sync_head, public.excel_sync_state, public.excel_sync_ops,
              public.excel_sync_changesets, public.excel_sync_audit
  FROM authenticated, anon;

-- F4 defense-in-depth on top of the trigger:
REVOKE UPDATE, DELETE ON public.excel_sync_audit FROM PUBLIC;

-- ===========================================================================
-- Internal helpers (IMMUTABLE pure functions used by the RPCs below)
-- ===========================================================================

-- Fix 9: strict UUID validation.  The loose '^[0-9a-fA-F-]{36}$' shape accepts
-- UUID-LENGTH junk (wrong dash positions) whose ::uuid cast would ABORT the whole RPC.
-- Return the parsed uuid for a canonical 8-4-4-4-12 string, else NULL (→ route to review),
-- so a malformed id can never crash the change-set.
CREATE OR REPLACE FUNCTION public.kal309_safe_uuid(p_text TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF p_text IS NULL OR p_text !~
     '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN p_text::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;   -- belt-and-suspenders: any cast failure routes to review, never aborts
END;
$$;

-- Fix 2: strip Row-ID token / secret material from a row's patch payload BEFORE it is
-- persisted into excel_sync_ops.patch_payload (which kal309_fetch_since returns to clients).
-- Tokens reach clients ONLY via the dedicated writeback-job channel, never the op log.
CREATE OR REPLACE FUNCTION public.kal309_sanitize_payload(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_clean JSONB;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN COALESCE(p_payload, '{}'::jsonb);
  END IF;
  -- Strip ONLY token/secret material + the identityRecord block (which carries assignedToken).
  -- Fix 1 (round-3): KEEP baseFingerprints + changedFieldKeys + fields — the client's final
  -- app-vs-Excel conflict check (D.3) needs baseFingerprints in patch_payload, and
  -- changedFieldKeys is the field-by-field merge whitelist.  None of those are secrets.
  v_clean := p_payload
    - 'assignedToken' - 'syncToken' - 'token' - 'secret' - 'secret_b64'
    - 'identityRecord';
  RETURN v_clean;
END;
$$;

-- ===========================================================================
-- (B)  Keystone RPC — kal308_apply_changeset (service-role ONLY)
-- ===========================================================================
-- STEP ORDER IS LOAD-BEARING (R2#1): AUTH → REGISTRATION → LOCK → REPLAY → per-row.
-- The idempotency short-circuit returns stored writeback_jobs (token material), so it
-- MUST come AFTER the role check AND under the head lock.

CREATE OR REPLACE FUNCTION public.kal308_apply_changeset(
  p_actor_id              UUID,    -- F17: validated actor, passed explicitly (NOT auth.uid())
  p_document_id           UUID,
  p_template_id           TEXT,    -- F1: the mirror key
  p_workbook_id           TEXT,    -- R2#3: the server-minted workbook id; generation derived from it
  p_capability_tier       TEXT,
  p_client_change_set_id  TEXT,
  p_request_hash          TEXT,    -- F7/F19: sha256 of the canonical request body
  p_device_hint           TEXT,
  p_template_config       JSONB,   -- F21: best-effort template (entities + checklist ids) OR NULL
  p_rows                  JSONB    -- ordered array of row decisions (payload contract below)
)
RETURNS JSONB                       -- { revision_head, outcomes:[…], writeback_jobs:[…] }
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
-- OUT/declared names never collide with bare column refs in this body, but we keep the
-- column-preference pragma so any future ON CONFLICT/RETURNING bare ref resolves to the
-- column (the ambiguity that bit KAL-308a in live testing).
#variable_conflict use_column
DECLARE
  v_head         BIGINT;
  v_is_editor    BOOLEAN;
  v_reg_gen      INTEGER;            -- R2#3: registration.generation DERIVED from workbook_id
  v_reg_doc      UUID;
  v_reg_tpl      TEXT;
  v_reg_tier     TEXT;               -- Fix 6: capability tier DERIVED from the registration, never the client
  v_reg_drive    TEXT;               -- Fix 6: graph_drive_id from the registration
  v_reg_item     TEXT;               -- Fix 6: graph_item_id from the registration
  v_existing     RECORD;
  v_outcomes     JSONB := '[]'::jsonb;
  v_row          JSONB;
  v_op_type      TEXT;
  v_op_id        TEXT;
  v_scope_id     TEXT;
  v_marker_id    UUID;
  v_claimed_id   TEXT;
  v_op_uuid      UUID;
  v_state        RECORD;
  v_base_iv      TEXT;
  v_base_fields  JSONB;
  v_active_count INTEGER;
  v_business_ok  BOOLEAN;
  v_id_version   TEXT;
  v_outcome      TEXT;
  v_inserted_uuid UUID;
  v_dup_revision BIGINT;   -- recovered revision of a duplicate op_id within the same change-set
  v_emit_revision BIGINT;  -- revision reported in this row's outcome
  v_changed_keys JSONB;    -- the row's changedFieldKeys array (the merge whitelist)
  v_key          TEXT;     -- loop var over changedFieldKeys / field-fingerprint keys
  v_field_base   TEXT;     -- client-claimed per-field base fingerprint
  v_field_stored TEXT;     -- server-stored per-field fingerprint (excel_sync_state)
  v_payload      JSONB;    -- sanitized (token-stripped) patch payload actually persisted
  v_checklist_id TEXT;     -- checklist id parsed from an 'answer:<id>' changed key
  v_entity_val   TEXT;     -- the patch's changed entity value (validated vs template entity ids)
BEGIN
  -- 0. SERVICE-ROLE GATE (defense in depth).  EXECUTE is service-role-only (grant below).
  --    If a future mis-grant lets an authenticated caller in, fail closed.
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    -- Allow the local/owner test harness (no jwt claim, runs as table owner) through:
    -- only block when a non-service authenticated role claim is explicitly present.
    IF current_setting('request.jwt.claim.role', true) IS NOT NULL THEN
      RAISE EXCEPTION 'kal309: service-role required';
    END IF;
  END IF;

  -- 1. ACTOR ROLE RE-VALIDATION IN-TXN, FIRST (F17, R2#1 — never auth.uid() under service role).
  --    Nothing is read or written for this change-set until the actor is proven editor/owner.
  v_is_editor :=
       EXISTS (SELECT 1 FROM public.document_collaborators dc
                WHERE dc.document_id = p_document_id AND dc.user_id = p_actor_id
                  AND dc.role IN ('editor','owner') AND dc.status = 'active')
    OR EXISTS (SELECT 1 FROM public.documents d
                WHERE d.id = p_document_id AND d.user_id = p_actor_id);
  IF NOT v_is_editor THEN
    -- generation not yet resolved (registration lookup is step 2) → 0 in the audit snapshot.
    INSERT INTO public.excel_sync_audit(document_id, template_id, workbook_generation,
      actor_id, capability_tier, client_change_set_id, row_outcome)
      VALUES (p_document_id, p_template_id, 0, p_actor_id,
              p_capability_tier, p_client_change_set_id, 'unauthorized');
    RETURN jsonb_build_object('error','unauthorized','outcomes','[]'::jsonb);
  END IF;

  -- 2. RESOLVE THE ACTIVE REGISTRATION GENERATION SERVER-SIDE (R2#3 + Codex build note 1).
  --    The client only has {workbookId, syncToken}; it never sends registration.id/generation.
  --    Derive the live generation from workbook_id AND re-verify the registration's
  --    document_id/template_id match the args (build note 1 — reject mismatches).
  -- Fix 6: also pull capability_tier + graph ids from the registration — the SERVER-SIDE
  -- source of truth for the business gate; never trust the client p_capability_tier.
  SELECT r.generation, r.document_id, r.template_id,
         r.capability_tier, r.graph_drive_id, r.graph_item_id
    INTO v_reg_gen, v_reg_doc, v_reg_tpl,
         v_reg_tier, v_reg_drive, v_reg_item
    FROM public.excel_workbook_registrations r
   WHERE r.workbook_id = p_workbook_id AND r.revoked_at IS NULL;   -- workbook_id UNIQUE on active rows (A.1)
  IF NOT FOUND THEN
    INSERT INTO public.excel_sync_audit(document_id, template_id, workbook_generation,
      actor_id, capability_tier, client_change_set_id, row_outcome)
      VALUES (p_document_id, p_template_id, 0, p_actor_id, p_capability_tier,
              p_client_change_set_id, 'unauthorized');
    RETURN jsonb_build_object('error','no_active_registration','outcomes','[]'::jsonb);
  END IF;
  IF v_reg_doc IS DISTINCT FROM p_document_id OR v_reg_tpl IS DISTINCT FROM p_template_id THEN
    -- Codex build note 1: the resolved registration must match the document/template args.
    INSERT INTO public.excel_sync_audit(document_id, template_id, workbook_generation,
      actor_id, capability_tier, client_change_set_id, row_outcome)
      VALUES (p_document_id, p_template_id, v_reg_gen, p_actor_id, v_reg_tier,
              p_client_change_set_id, 'unauthorized');
    RETURN jsonb_build_object('error','workbook_mismatch','outcomes','[]'::jsonb);
  END IF;

  -- 3. DOCUMENT LOCK GATE (Codex #20).  kal49_document_is_locked is auth-independent (UUID arg).
  IF public.kal49_document_is_locked(p_document_id) THEN
    INSERT INTO public.excel_sync_audit(document_id, template_id, workbook_generation,
      actor_id, capability_tier, client_change_set_id, row_outcome)
      VALUES (p_document_id, p_template_id, v_reg_gen, p_actor_id, v_reg_tier,
              p_client_change_set_id, 'locked');
    RETURN jsonb_build_object('error','locked','outcomes','[]'::jsonb);
  END IF;

  -- 4. SERIALIZE ON THE STABLE MIRROR HEAD (F2, F5, R2#1).  Ensure the head row exists, then
  --    LOCK it BEFORE the replay check so concurrent duplicate submits of the same change-set
  --    serialize (the second waits on the lock, then hits the committed replay row in step 5).
  INSERT INTO public.excel_sync_head(document_id, template_id)
    VALUES (p_document_id, p_template_id) ON CONFLICT DO NOTHING;
  SELECT h.excel_revision INTO v_head
    FROM public.excel_sync_head h
   WHERE h.document_id = p_document_id AND h.template_id = p_template_id
   FOR UPDATE;   -- serializes the whole change-set (creates included) against concurrent submits

  -- 5. F7/F19 IDEMPOTENCY / REPLAY CHECK — NOW (AFTER auth + UNDER the head lock, R2#1).
  --    Return the stored blob VERBATIM if this change-set was already processed.
  SELECT cs.outcomes, cs.writeback_jobs, cs.revision_head
    INTO v_existing
    FROM public.excel_sync_changesets cs
   WHERE cs.document_id = p_document_id
     AND cs.template_id = p_template_id
     AND cs.client_change_set_id = p_client_change_set_id;
  IF FOUND THEN
    -- request_hash mismatch is informational only; the stored result still wins
    -- (same change-set id is the contract — F7).  No mint, no head bump, no second insert.
    RETURN jsonb_build_object(
      'revision_head', v_existing.revision_head,
      'outcomes',      v_existing.outcomes,
      'writeback_jobs',v_existing.writeback_jobs,
      'replayed',      true
    );
  END IF;

  -- 6. CONSERVATIVE SHARED-DOC GATE (Decision 8).  If >1 active collaborator AND the
  --    capability tier is not business-with-matching-graph-metadata → route ALL rows to
  --    'review', zero writes, store the change-set outcomes, return.
  -- Fix 6: the business decision uses the SERVER-DERIVED registration tier + graph ids,
  --    NEVER the client-supplied p_capability_tier (which an attacker could set to 'business').
  SELECT count(*) INTO v_active_count
    FROM public.document_collaborators dc
   WHERE dc.document_id = p_document_id AND dc.status = 'active';
  v_business_ok := (v_reg_tier = 'business'
                    AND v_reg_drive IS NOT NULL AND v_reg_drive <> ''
                    AND v_reg_item  IS NOT NULL AND v_reg_item  <> '');
  IF v_active_count > 1 AND NOT v_business_ok THEN
    FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
      v_op_id     := v_row->>'opId';
      v_op_type   := v_row->>'opType';
      v_claimed_id := v_row->>'markerAnnotationId';
      INSERT INTO public.excel_sync_audit(document_id, template_id, workbook_generation,
        actor_id, capability_tier, client_change_set_id, marker_annotation_id, row_outcome)
        VALUES (p_document_id, p_template_id, v_reg_gen, p_actor_id, v_reg_tier,
                p_client_change_set_id,
                public.kal309_safe_uuid(v_claimed_id),
                'review');
      v_outcomes := v_outcomes || jsonb_build_object(
        'opId', v_op_id, 'markerAnnotationId', v_claimed_id,
        'opType', v_op_type, 'outcome', 'review');
    END LOOP;
    INSERT INTO public.excel_sync_changesets (document_id, template_id, actor_id,
      client_change_set_id, request_hash, outcomes, writeback_jobs, revision_head)
      VALUES (p_document_id, p_template_id, p_actor_id, p_client_change_set_id,
              p_request_hash, v_outcomes, '[]'::jsonb, v_head)
      ON CONFLICT (document_id, template_id, client_change_set_id)
        DO UPDATE SET outcomes = EXCLUDED.outcomes, revision_head = EXCLUDED.revision_head;
    RETURN jsonb_build_object('revision_head', v_head, 'outcomes', v_outcomes,
                              'writeback_jobs', '[]'::jsonb);
  END IF;

  -- 7. PER ROW, in array order.  Accumulate v_outcomes JSONB (token NULL here — the Edge
  --    signs + persists created-row tokens AFTER this commits).
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    v_op_id      := v_row->>'opId';
    v_op_type    := v_row->>'opType';
    v_scope_id   := v_row->>'scopeId';
    v_claimed_id := v_row->>'markerAnnotationId';
    v_outcome    := NULL;
    v_op_uuid    := NULL;

    -- candidateDelete rows → REVIEW ONLY (F10).  No server delete.
    IF v_op_type = 'candidateDelete' THEN
      v_outcome := 'review';

    ELSIF v_op_type = 'apply' THEN
      -- Fix 9: strict UUID parse — UUID-shaped junk no longer aborts the RPC, it routes to review.
      v_marker_id := public.kal309_safe_uuid(v_claimed_id);
      IF v_marker_id IS NULL THEN
        v_outcome := 'review';   -- legacy/no-Row-ID/foreign-token/malformed (Decisions 9,12)
      ELSE
        -- PRE-GATE (F13): block any NEW op for a marker with an OPEN client_conflict_review.
        SELECT s.* INTO v_state
          FROM public.excel_sync_state s
         WHERE s.document_id = p_document_id AND s.template_id = p_template_id
           AND s.scope_id = v_scope_id AND s.marker_annotation_id = v_marker_id
         FOR UPDATE;   -- TOCTOU lock on the state row

        IF NOT FOUND THEN
          -- no trusted server baseline (e.g. legacy / not seeded) → review (Decisions 9,12)
          v_outcome := 'review';
        ELSIF v_state.materialization_status = 'client_conflict_review' THEN
          v_outcome := 'review';   -- block-stacking guard (F13)
        ELSE
          v_outcome := 'applied';   -- provisional; the checks below can downgrade it

          -- Fix 2 (round-3): an 'apply' op MUST carry changedFieldKeys as a JSON array — without
          -- a known change set we cannot validate or safely merge.  Missing / non-array → review.
          v_changed_keys := v_row -> 'changedFieldKeys';
          IF v_changed_keys IS NULL OR jsonb_typeof(v_changed_keys) <> 'array' THEN
            v_outcome := 'review';
          ELSE
            -- Fix 5: FIELD-KEY WHITELIST.  changedFieldKeys is the merge whitelist the client
            -- reducer will overlay.  Allowed KEYS: the fixed marker fields + answer/checklist
            -- keys ('answer:<id>').  Anything else → review the whole row.
            -- Fix 3 (round-3): when p_template_config is non-NULL, ALSO validate values against
            -- it — each answer's checklist id must exist in the template, and a changed entity
            -- value must be a template entity id.  When NULL, structural-only (F21 fallback).
            FOR v_key IN SELECT jsonb_array_elements_text(v_changed_keys) LOOP
              IF v_key NOT IN ('changedBy','changedDate','item','entity','notes')
                 AND v_key NOT LIKE 'answer:%'
                 AND v_key NOT LIKE 'answer.%' THEN
                v_outcome := 'review';   -- non-whitelisted key
                EXIT;
              END IF;

              IF p_template_config IS NOT NULL THEN
                -- answer:<checklistItemId> — the checklist id must exist in the template.
                IF v_key LIKE 'answer:%' OR v_key LIKE 'answer.%' THEN
                  v_checklist_id := substr(v_key, position(
                    CASE WHEN v_key LIKE 'answer:%' THEN ':' ELSE '.' END IN v_key) + 1);
                  IF v_checklist_id = '' OR NOT EXISTS (
                    SELECT 1
                      FROM jsonb_array_elements(COALESCE(p_template_config->'modules','[]'::jsonb)) m,
                           jsonb_array_elements(COALESCE(m->'categories','[]'::jsonb)) c,
                           jsonb_array_elements(COALESCE(c->'checklist','[]'::jsonb)) ci
                     WHERE ci->>'id' = v_checklist_id
                  ) THEN
                    v_outcome := 'review';   -- unknown checklist id for this template
                    EXIT;
                  END IF;
                -- entity — a CHANGED entity value must be one of the template's entity ids
                -- (skip when the entity is being cleared to null/empty).
                ELSIF v_key = 'entity' THEN
                  v_entity_val := v_row #>> '{fields,entity}';
                  IF v_entity_val IS NOT NULL AND v_entity_val <> '' AND NOT EXISTS (
                    SELECT 1
                      FROM jsonb_array_elements(COALESCE(p_template_config->'entities','[]'::jsonb)) e
                     WHERE e->>'id' = v_entity_val OR e->>'name' = v_entity_val
                  ) THEN
                    v_outcome := 'review';   -- entity value not in the template
                    EXIT;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;

          IF v_outcome = 'applied' THEN
            -- TOCTOU re-validate Excel-side base fingerprints (Excel-vs-Excel ONLY, F6).
            v_base_iv     := v_row #>> '{baseFingerprints,identityVector}';
            v_base_fields := v_row #> '{baseFingerprints,fields}';
            IF v_base_iv IS NOT NULL
               AND v_base_iv IS DISTINCT FROM v_state.identity_vector_fingerprint THEN
              v_outcome := 'conflict';   -- identity-vector drift since baseline; no write
            ELSIF v_base_fields IS NOT NULL AND jsonb_typeof(v_base_fields) = 'object' THEN
              -- Fix 4: per-field Excel-vs-Excel drift.  For every claimed base field fingerprint,
              -- compare against the server-stored field_fingerprints.  Any mismatch on a field
              -- the client believes it is editing means the Excel side moved under it → stale.
              FOR v_key IN SELECT jsonb_object_keys(v_base_fields) LOOP
                v_field_base   := v_base_fields ->> v_key;
                v_field_stored := v_state.field_fingerprints ->> v_key;
                IF v_field_stored IS NOT NULL
                   AND v_field_base IS DISTINCT FROM v_field_stored THEN
                  v_outcome := 'stale';   -- field-level Excel drift; no write
                  EXIT;
                END IF;
              END LOOP;
            END IF;
          END IF;
        END IF;
      END IF;

    ELSIF v_op_type = 'create' THEN
      -- Mint marker_annotation_id ONCE (F3/F8) — embedded in op + state + outcomes so every
      -- client materializes the SAME marker; never regenerated on replay (the F7 idempotency
      -- row short-circuits before this loop on a retry).
      v_marker_id := extensions.gen_random_uuid();
      v_outcome   := 'create';

    ELSE
      -- legacy/unknown op_type → review (Decisions 9,12)
      v_outcome := 'review';
    END IF;

    -- ATOMIC for an ACCEPTED apply/create row (F5, all in THIS txn).
    IF v_outcome IN ('applied','create') THEN
      v_head := v_head + 1;

      -- Fix 2: persist a SANITIZED payload (strips assignedToken / token / secret / identityRecord;
      --        KEEPS baseFingerprints + changedFieldKeys for the client's app-vs-Excel check) —
      --        kal309_fetch_since returns patch_payload to clients.
      -- Fix 3: stamp the (minted-for-create) marker id into the payload so every client
      --        materializes the SAME marker id.
      v_payload := public.kal309_sanitize_payload(v_row);
      v_payload := jsonb_set(v_payload, '{markerAnnotationId}', to_jsonb(v_marker_id::text), true);

      INSERT INTO public.excel_sync_ops (
        document_id, template_id, scope_id, workbook_generation, excel_revision,
        op_id, marker_annotation_id, op_type, patch_payload, client_change_set_id, op_status)
        VALUES (
          p_document_id, p_template_id, v_scope_id, v_reg_gen, v_head,
          v_op_id, v_marker_id, v_op_type, v_payload, p_client_change_set_id, 'accepted')
        ON CONFLICT (document_id, template_id, client_change_set_id, op_id) DO NOTHING
        RETURNING op_uuid INTO v_inserted_uuid;

      IF v_inserted_uuid IS NULL THEN
        -- A stray duplicate op_id WITHIN this same change-set (the (…,client_change_set_id,
        -- op_id) idempotency key already has a row): do not double-append and do not consume a
        -- revision.  Roll back the speculative v_head bump and recover the EXISTING op's
        -- op_uuid + revision for the outcome record (use a separate var so the running head
        -- counter is never rewound — that would corrupt later rows' revisions).
        v_head := v_head - 1;
        SELECT o.op_uuid, o.excel_revision, o.marker_annotation_id
          INTO v_op_uuid, v_dup_revision, v_marker_id
          FROM public.excel_sync_ops o
         WHERE o.document_id = p_document_id AND o.template_id = p_template_id
           AND o.client_change_set_id = p_client_change_set_id AND o.op_id = v_op_id;
        v_emit_revision := v_dup_revision;
      ELSE
        v_op_uuid := v_inserted_uuid;
        v_emit_revision := v_head;

        -- Full identity UPSERT into excel_sync_state.
        v_id_version := COALESCE(v_row #>> '{identityRecord,version}', 'v1');
        INSERT INTO public.excel_sync_state (
          document_id, template_id, scope_id, workbook_generation, marker_annotation_id,
          identity_version, origin, last_export_id, was_written_as_row, assigned_token,
          pending_rowid_writeback, last_seen_row_number, last_ingest_seq,
          identity_vector_fingerprint, full_row_fingerprint, field_fingerprints,
          copy_of_marker_id, copy_ordinal,
          last_applied_excel_revision, last_applied_op_uuid,
          materialization_status, op_status, updated_at)
        VALUES (
          p_document_id, p_template_id, v_scope_id, v_reg_gen, v_marker_id,
          v_id_version,
          COALESCE(v_row #>> '{identityRecord,origin}', 'import'),
          v_row #>> '{identityRecord,lastExportId}',
          COALESCE((v_row #>> '{identityRecord,wasWrittenAsRow}')::boolean, FALSE),
          CASE WHEN v_op_type = 'create' THEN NULL
               ELSE v_row #>> '{identityRecord,assignedToken}' END,
          CASE WHEN v_op_type = 'create' THEN TRUE
               ELSE COALESCE((v_row #>> '{identityRecord,pendingRowIdWriteback}')::boolean, FALSE) END,
          NULLIF(v_row #>> '{identityRecord,lastSeenRowNumber}', '')::integer,
          NULLIF(v_row #>> '{identityRecord,lastIngestSeq}', '')::bigint,
          COALESCE(v_row #>> '{baseFingerprints,identityVector}',
                   v_row #>> '{identityRecord,identityVectorFingerprint}', ''),
          COALESCE(v_row #>> '{identityRecord,fullRowFingerprint}', ''),
          COALESCE(v_row #> '{baseFingerprints,fields}',
                   v_row #> '{identityRecord,fieldFingerprints}', '{}'::jsonb),
          v_row #>> '{identityRecord,copyOfMarkerId}',
          NULLIF(v_row #>> '{identityRecord,copyOrdinal}', '')::integer,
          v_head, v_op_uuid, 'accepted', 'accepted', now())
        ON CONFLICT (document_id, template_id, scope_id, marker_annotation_id) DO UPDATE SET
          workbook_generation         = EXCLUDED.workbook_generation,
          identity_version            = EXCLUDED.identity_version,
          origin                      = EXCLUDED.origin,
          last_export_id              = EXCLUDED.last_export_id,
          was_written_as_row          = EXCLUDED.was_written_as_row,
          pending_rowid_writeback     = EXCLUDED.pending_rowid_writeback,
          last_seen_row_number        = EXCLUDED.last_seen_row_number,
          last_ingest_seq             = EXCLUDED.last_ingest_seq,
          identity_vector_fingerprint = EXCLUDED.identity_vector_fingerprint,
          full_row_fingerprint        = EXCLUDED.full_row_fingerprint,
          field_fingerprints          = EXCLUDED.field_fingerprints,
          copy_of_marker_id           = EXCLUDED.copy_of_marker_id,
          copy_ordinal                = EXCLUDED.copy_ordinal,
          last_applied_excel_revision = EXCLUDED.last_applied_excel_revision,
          last_applied_op_uuid        = EXCLUDED.last_applied_op_uuid,
          materialization_status      = 'accepted',
          op_status                   = 'accepted',
          updated_at                  = now();

        INSERT INTO public.excel_sync_audit(document_id, template_id, workbook_generation,
          actor_id, capability_tier, client_change_set_id, marker_annotation_id, row_outcome,
          device_hint)
          VALUES (p_document_id, p_template_id, v_reg_gen, p_actor_id, v_reg_tier,
                  p_client_change_set_id, v_marker_id, v_outcome, p_device_hint);
      END IF;

      v_outcomes := v_outcomes || jsonb_build_object(
        'opId', v_op_id,
        'opUuid', v_op_uuid,
        'markerAnnotationId', v_marker_id::text,
        'opType', v_op_type,
        'outcome', v_outcome,
        'excelRevision', v_emit_revision,
        'writebackPending', (v_op_type = 'create'));

    ELSE
      -- NON-accepted row: audit the outcome, append it, NO ops/state write.
      INSERT INTO public.excel_sync_audit(document_id, template_id, workbook_generation,
        actor_id, capability_tier, client_change_set_id, marker_annotation_id, row_outcome,
        device_hint)
        VALUES (p_document_id, p_template_id, v_reg_gen, p_actor_id, v_reg_tier,
                p_client_change_set_id,
                public.kal309_safe_uuid(v_claimed_id),
                v_outcome, p_device_hint);
      v_outcomes := v_outcomes || jsonb_build_object(
        'opId', v_op_id, 'markerAnnotationId', v_claimed_id,
        'opType', v_op_type, 'outcome', v_outcome);
    END IF;
  END LOOP;

  -- 8. PERSIST THE BUMPED HEAD ONCE (F5, same txn).
  UPDATE public.excel_sync_head SET excel_revision = v_head, updated_at = now()
    WHERE document_id = p_document_id AND template_id = p_template_id;

  -- 9. STORE THE CHANGE-SET OUTCOMES (F7/F19) — the replay authority.  UPSERT so an OPTIONAL
  --    step-5 'processing' placeholder is promoted to the committed result.
  INSERT INTO public.excel_sync_changesets (document_id, template_id, actor_id,
    client_change_set_id, request_hash, outcomes, writeback_jobs, revision_head)
    VALUES (p_document_id, p_template_id, p_actor_id, p_client_change_set_id,
            p_request_hash, v_outcomes, '[]'::jsonb, v_head)
    ON CONFLICT (document_id, template_id, client_change_set_id)
      DO UPDATE SET outcomes = EXCLUDED.outcomes, revision_head = EXCLUDED.revision_head;
    -- writeback_jobs starts empty; the Edge fills it via kal309_persist_created_token (F20).

  -- 10. RETURN.  Outcomes say 'applied'/'create' (accepted), NOT 'materialized' (materialize
  --     is the client's job; F8 ack flips it later).
  RETURN jsonb_build_object(
    'revision_head', v_head,
    'outcomes', v_outcomes,
    'writeback_jobs', '[]'::jsonb);
END;
$$;

-- Service-role ONLY (Codex #5).  Clients reach it only via the Edge Function.
REVOKE ALL ON FUNCTION public.kal308_apply_changeset(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.kal308_apply_changeset(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)
  TO service_role;

COMMENT ON FUNCTION public.kal308_apply_changeset(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB) IS
  'KAL-309 keystone: server-authoritative Excel change-set apply. Service-role only; '
  'reached via the excel-apply-changeset Edge Function. Step order AUTH→REGISTRATION→LOCK→'
  'REPLAY→per-row (R2#1). Returns { revision_head, outcomes, writeback_jobs }.';

-- ===========================================================================
-- Helper RPC #1 — kal309_set_registration_signing_id (R2#3)
-- ===========================================================================
-- Freeze-once: derive the active registration from workbook_id server-side, verify it
-- matches the doc/template args, set rowid_signing_doc_id only when currently NULL.

CREATE OR REPLACE FUNCTION public.kal309_set_registration_signing_id(
  p_document_id   UUID,
  p_template_id   TEXT,
  p_workbook_id   TEXT,
  p_signing_doc_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reg_id   UUID;
  v_reg_doc  UUID;
  v_reg_tpl  TEXT;
  v_current  TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'kal309: not authenticated';
  END IF;
  IF NOT public.user_can_access_document(p_document_id, 'editor') THEN
    RAISE EXCEPTION 'kal309: insufficient role — editor or owner required';
  END IF;

  SELECT r.id, r.document_id, r.template_id, r.rowid_signing_doc_id
    INTO v_reg_id, v_reg_doc, v_reg_tpl, v_current
    FROM public.excel_workbook_registrations r
   WHERE r.workbook_id = p_workbook_id AND r.revoked_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kal309: no active registration for workbook';
  END IF;
  IF v_reg_doc IS DISTINCT FROM p_document_id OR v_reg_tpl IS DISTINCT FROM p_template_id THEN
    RAISE EXCEPTION 'kal309: workbook does not match document/template';
  END IF;

  IF v_current IS NULL THEN
    UPDATE public.excel_workbook_registrations
       SET rowid_signing_doc_id = p_signing_doc_id
     WHERE id = v_reg_id;
    RETURN TRUE;
  END IF;
  -- Already frozen — no-op (freeze-once).
  RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal309_set_registration_signing_id(UUID, TEXT, TEXT, TEXT)
  TO authenticated;

-- ===========================================================================
-- Helper RPC #2 — kal309_seed_sync_state (F18, R2#3)
-- ===========================================================================
-- Editor/owner.  Derives workbook_generation server-side from workbook_id; upserts the
-- excel_sync_state baseline for every exported marker so the apply RPC has a trusted
-- Excel-side baseline to diff against on the very FIRST import.

CREATE OR REPLACE FUNCTION public.kal309_seed_sync_state(
  p_document_id  UUID,
  p_template_id  TEXT,
  p_workbook_id  TEXT,
  p_markers      JSONB    -- array of { markerAnnotationId, scopeId, identityRecord:{…}, assignedToken }
)
RETURNS INTEGER          -- count of seeded markers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reg_gen   INTEGER;
  v_reg_doc   UUID;
  v_reg_tpl   TEXT;
  v_head      BIGINT;
  v_marker    JSONB;
  v_marker_id UUID;
  v_count     INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'kal309: not authenticated';
  END IF;
  IF NOT public.user_can_access_document(p_document_id, 'editor') THEN
    RAISE EXCEPTION 'kal309: insufficient role — editor or owner required';
  END IF;

  -- Derive registration generation server-side (R2#3) + verify match (build note 1).
  SELECT r.generation, r.document_id, r.template_id
    INTO v_reg_gen, v_reg_doc, v_reg_tpl
    FROM public.excel_workbook_registrations r
   WHERE r.workbook_id = p_workbook_id AND r.revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kal309: no active registration for workbook';
  END IF;
  IF v_reg_doc IS DISTINCT FROM p_document_id OR v_reg_tpl IS DISTINCT FROM p_template_id THEN
    RAISE EXCEPTION 'kal309: workbook does not match document/template';
  END IF;

  -- Current head (non-locking read) so seeded rows record last_applied_excel_revision.
  SELECT h.excel_revision INTO v_head
    FROM public.excel_sync_head h
   WHERE h.document_id = p_document_id AND h.template_id = p_template_id;
  v_head := COALESCE(v_head, 0);

  FOR v_marker IN SELECT * FROM jsonb_array_elements(COALESCE(p_markers, '[]'::jsonb)) LOOP
    -- Fix 9: strict UUID parse — skip markers with a malformed id instead of aborting the seed.
    v_marker_id := public.kal309_safe_uuid(v_marker->>'markerAnnotationId');
    CONTINUE WHEN v_marker_id IS NULL;

    INSERT INTO public.excel_sync_state (
      document_id, template_id, scope_id, workbook_generation, marker_annotation_id,
      identity_version, origin, last_export_id, was_written_as_row, assigned_token,
      pending_rowid_writeback, last_seen_row_number, last_ingest_seq,
      identity_vector_fingerprint, full_row_fingerprint, field_fingerprints,
      copy_of_marker_id, copy_ordinal,
      last_applied_excel_revision, materialization_status, op_status, updated_at)
    VALUES (
      p_document_id, p_template_id, COALESCE(v_marker->>'scopeId', ''), v_reg_gen, v_marker_id,
      COALESCE(v_marker #>> '{identityRecord,version}', 'v1'),
      'export',
      v_marker #>> '{identityRecord,lastExportId}',
      COALESCE((v_marker #>> '{identityRecord,wasWrittenAsRow}')::boolean, TRUE),
      v_marker->>'assignedToken',
      COALESCE((v_marker #>> '{identityRecord,pendingRowIdWriteback}')::boolean, FALSE),
      NULLIF(v_marker #>> '{identityRecord,lastSeenRowNumber}', '')::integer,
      NULLIF(v_marker #>> '{identityRecord,lastIngestSeq}', '')::bigint,
      COALESCE(v_marker #>> '{identityRecord,identityVectorFingerprint}', ''),
      COALESCE(v_marker #>> '{identityRecord,fullRowFingerprint}', ''),
      COALESCE(v_marker #> '{identityRecord,fieldFingerprints}', '{}'::jsonb),
      v_marker #>> '{identityRecord,copyOfMarkerId}',
      NULLIF(v_marker #>> '{identityRecord,copyOrdinal}', '')::integer,
      v_head, 'materialized', 'materialized', now())
    ON CONFLICT (document_id, template_id, scope_id, marker_annotation_id) DO UPDATE SET
      workbook_generation         = EXCLUDED.workbook_generation,
      identity_version            = EXCLUDED.identity_version,
      origin                      = EXCLUDED.origin,
      last_export_id              = EXCLUDED.last_export_id,
      was_written_as_row          = EXCLUDED.was_written_as_row,
      assigned_token              = EXCLUDED.assigned_token,
      pending_rowid_writeback     = EXCLUDED.pending_rowid_writeback,
      last_seen_row_number        = EXCLUDED.last_seen_row_number,
      last_ingest_seq             = EXCLUDED.last_ingest_seq,
      identity_vector_fingerprint = EXCLUDED.identity_vector_fingerprint,
      full_row_fingerprint        = EXCLUDED.full_row_fingerprint,
      field_fingerprints          = EXCLUDED.field_fingerprints,
      copy_of_marker_id           = EXCLUDED.copy_of_marker_id,
      copy_ordinal                = EXCLUDED.copy_ordinal,
      last_applied_excel_revision = EXCLUDED.last_applied_excel_revision,
      materialization_status      = 'materialized',
      op_status                   = 'materialized',
      updated_at                  = now();

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal309_seed_sync_state(UUID, TEXT, TEXT, JSONB)
  TO authenticated;

-- ===========================================================================
-- Helper RPC #3 — kal309_fetch_since (F11) — TOKEN-REDACTED
-- ===========================================================================
-- Viewer-gated read.  Returns committed ops for the MIRROR with excel_revision >
-- p_since_revision ascending.  EXPLICIT redacted projection — NEVER assigned_token /
-- secrets.  (patch_payload is token-free by construction in B.)

CREATE OR REPLACE FUNCTION public.kal309_fetch_since(
  p_document_id   UUID,
  p_template_id   TEXT,
  p_since_revision BIGINT
)
RETURNS TABLE (
  op_uuid              UUID,
  op_id                TEXT,
  excel_revision       BIGINT,
  marker_annotation_id UUID,
  op_type              TEXT,
  patch_payload        JSONB,
  op_status            TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
-- OUT column names match table columns (op_uuid, op_id, …); resolve bare refs to the
-- column (the ambiguity that bit KAL-308a — column-preference pragma BEFORE BEGIN).
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'kal309: not authenticated';
  END IF;
  IF NOT public.user_can_access_document(p_document_id, 'viewer') THEN
    RAISE EXCEPTION 'kal309: insufficient role — viewer access required';
  END IF;

  RETURN QUERY
  SELECT o.op_uuid, o.op_id, o.excel_revision, o.marker_annotation_id,
         o.op_type, o.patch_payload, o.op_status
    FROM public.excel_sync_ops o
   WHERE o.document_id = p_document_id
     AND o.template_id = p_template_id
     AND o.excel_revision > COALESCE(p_since_revision, 0)
   ORDER BY o.excel_revision ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal309_fetch_since(UUID, TEXT, BIGINT)
  TO authenticated;

-- ===========================================================================
-- Helper RPC #4 — kal309_ack_materialization (F8, F13)
-- ===========================================================================
-- Editor-gated.  Scoped by op_uuid.  GUARDED transitions: accepted → {materialized |
-- client_conflict_review} ONLY.  A late accepted→materialized ack is a NO-OP once the op
-- is client_conflict_review (a late ack cannot un-stick a conflict).  Updates both the op
-- and the marker's excel_sync_state.

CREATE OR REPLACE FUNCTION public.kal309_ack_materialization(
  p_document_id  UUID,
  p_template_id  TEXT,
  p_op_uuid      UUID,
  p_status       TEXT      -- 'materialized' | 'client_conflict_review'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_op          RECORD;
  v_current_op  UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'kal309: not authenticated';
  END IF;
  IF NOT public.user_can_access_document(p_document_id, 'editor') THEN
    RAISE EXCEPTION 'kal309: insufficient role — editor or owner required';
  END IF;
  IF p_status NOT IN ('materialized','client_conflict_review') THEN
    RAISE EXCEPTION 'kal309: invalid ack status %', p_status;
  END IF;

  SELECT o.id, o.scope_id, o.marker_annotation_id, o.op_status INTO v_op
    FROM public.excel_sync_ops o
   WHERE o.op_uuid = p_op_uuid
     AND o.document_id = p_document_id
     AND o.template_id = p_template_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Monotonic guard: only an op currently 'accepted' may transition.  Once it is
  -- client_conflict_review (or resolved/materialized) a late ack is a no-op (F13).
  IF v_op.op_status <> 'accepted' THEN
    RETURN FALSE;
  END IF;

  -- Fix 4 (round-3): also require THIS op to be the CURRENT op for its marker before changing
  -- ANY status.  Otherwise a stale ack for an OLD (still-'accepted') op could flip its op_status
  -- to client_conflict_review while the state-row guard skips the marker — leaving an op-level
  -- review the apply RPC's state-keyed pre-gate cannot see.  Lock the marker state row and
  -- compare last_applied_op_uuid; a non-current op ack is a full no-op.
  SELECT s.last_applied_op_uuid INTO v_current_op
    FROM public.excel_sync_state s
   WHERE s.document_id = p_document_id AND s.template_id = p_template_id
     AND s.scope_id = v_op.scope_id AND s.marker_annotation_id = v_op.marker_annotation_id
   FOR UPDATE;
  IF NOT FOUND OR v_current_op IS DISTINCT FROM p_op_uuid THEN
    RETURN FALSE;   -- not the current op for this marker → no-op (op_status unchanged too)
  END IF;

  UPDATE public.excel_sync_ops
     SET op_status = p_status
   WHERE op_uuid = p_op_uuid;

  -- The marker state row is already locked + confirmed current; update it in lock-step.
  UPDATE public.excel_sync_state
     SET materialization_status = p_status,
         op_status              = p_status,
         updated_at             = now()
   WHERE document_id = p_document_id AND template_id = p_template_id
     AND scope_id = v_op.scope_id AND marker_annotation_id = v_op.marker_annotation_id
     AND last_applied_op_uuid = p_op_uuid;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal309_ack_materialization(UUID, TEXT, UUID, TEXT)
  TO authenticated;

-- ===========================================================================
-- Helper RPC #5 — kal309_persist_created_token (F20) — SERVICE-ROLE ONLY
-- ===========================================================================
-- Called by the Edge AFTER it signs a created marker's Row-ID token, BEFORE broadcast.
-- Sets excel_sync_state.assigned_token + pending_rowid_writeback=TRUE and appends the
-- writeback job to the change-set.  IDEMPOTENT + dedupes writeback_jobs (Codex build note 2).

CREATE OR REPLACE FUNCTION public.kal309_persist_created_token(
  p_document_id          UUID,
  p_template_id          TEXT,
  p_scope_id             TEXT,
  p_marker_annotation_id UUID,
  p_client_change_set_id TEXT,
  p_assigned_token       TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jobs       JSONB;
  v_new_job    JSONB;
  v_exists     BOOLEAN;
  v_state_rows INTEGER;
BEGIN
  -- service-role only (grant below); no auth.uid() under the Edge.

  -- Set the token on the marker state.
  UPDATE public.excel_sync_state
     SET assigned_token          = p_assigned_token,
         pending_rowid_writeback = TRUE,
         updated_at              = now()
   WHERE document_id = p_document_id AND template_id = p_template_id
     AND scope_id = p_scope_id AND marker_annotation_id = p_marker_annotation_id;

  -- Fix 10: if no state row matched, the marker does not exist server-side — do NOT
  -- fabricate a writeback job for a phantom marker.  Bail.
  GET DIAGNOSTICS v_state_rows = ROW_COUNT;
  IF v_state_rows = 0 THEN
    RETURN FALSE;
  END IF;

  -- Append the writeback job to the change-set, deduped by markerAnnotationId
  -- (Codex build note 2 — idempotent; a retried persist must not double-append).
  SELECT cs.writeback_jobs INTO v_jobs
    FROM public.excel_sync_changesets cs
   WHERE cs.document_id = p_document_id AND cs.template_id = p_template_id
     AND cs.client_change_set_id = p_client_change_set_id
   FOR UPDATE;
  IF NOT FOUND THEN
    -- no change-set row yet (shouldn't happen — apply RPC writes it) → nothing to append to
    RETURN FALSE;
  END IF;
  v_jobs := COALESCE(v_jobs, '[]'::jsonb);

  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_jobs) j
     WHERE j->>'markerAnnotationId' = p_marker_annotation_id::text
  ) INTO v_exists;

  IF NOT v_exists THEN
    v_new_job := jsonb_build_object(
      'markerAnnotationId', p_marker_annotation_id::text,
      'assignedToken', p_assigned_token,
      'scopeId', p_scope_id);
    UPDATE public.excel_sync_changesets
       SET writeback_jobs = v_jobs || jsonb_build_array(v_new_job)
     WHERE document_id = p_document_id AND template_id = p_template_id
       AND client_change_set_id = p_client_change_set_id;
  ELSE
    -- already present — refresh the token in place (idempotent dedupe).
    UPDATE public.excel_sync_changesets
       SET writeback_jobs = (
         SELECT jsonb_agg(
           CASE WHEN j->>'markerAnnotationId' = p_marker_annotation_id::text
                THEN jsonb_set(j, '{assignedToken}', to_jsonb(p_assigned_token))
                ELSE j END)
         FROM jsonb_array_elements(v_jobs) j)
     WHERE document_id = p_document_id AND template_id = p_template_id
       AND client_change_set_id = p_client_change_set_id;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.kal309_persist_created_token(UUID, TEXT, TEXT, UUID, TEXT, TEXT)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.kal309_persist_created_token(UUID, TEXT, TEXT, UUID, TEXT, TEXT)
  TO service_role;

-- ===========================================================================
-- Helper RPC #6 — kal309_resolve_materialization_conflict (R2#4, Codex build note 3)
-- ===========================================================================
-- Editor-gated.  Clears a client_conflict_review for the op identified by op_uuid.
-- p_resolution ∈ {keep-app, take-excel, merged}.  Reload-safe re-materialize for
-- take-excel: set the op back to 'accepted' (build note 3) so a reopen re-applies it.

CREATE OR REPLACE FUNCTION public.kal309_resolve_materialization_conflict(
  p_document_id          UUID,
  p_template_id          TEXT,
  p_op_uuid              UUID,
  p_resolution           TEXT,     -- 'keep-app' | 'take-excel' | 'merged'
  p_resolved_fingerprints JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_op            RECORD;
  v_op_new        TEXT;
  v_state_new     TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'kal309: not authenticated';
  END IF;
  IF NOT public.user_can_access_document(p_document_id, 'editor') THEN
    RAISE EXCEPTION 'kal309: insufficient role — editor or owner required';
  END IF;
  IF p_resolution NOT IN ('keep-app','take-excel','merged') THEN
    RAISE EXCEPTION 'kal309: invalid resolution %', p_resolution;
  END IF;

  SELECT o.id, o.scope_id, o.marker_annotation_id, o.op_status, o.workbook_generation INTO v_op
    FROM public.excel_sync_ops o
   WHERE o.op_uuid = p_op_uuid
     AND o.document_id = p_document_id
     AND o.template_id = p_template_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Only resolve an op that is actually in conflict-review.
  IF v_op.op_status <> 'client_conflict_review' THEN
    RETURN FALSE;
  END IF;

  IF p_resolution = 'take-excel' THEN
    -- The Excel value wins; the client WILL re-materialize.  Fix 8 / build note 3 — reload-safe:
    -- set the OP back to 'accepted' (NOT 'resolved') so kal309_fetch_since re-surfaces it and the
    -- reducer re-materializes it after a reload; state → 'accepted' too (then the normal
    -- materialized ack flips both once the client re-applies).  Using 'resolved' here would make
    -- fetch_since skip the op on reload, silently dropping the take-excel result.
    v_op_new    := 'accepted';
    v_state_new := 'accepted';
  ELSE
    -- keep-app / merged: nothing is re-applied to app fields; op → resolved, state → materialized.
    v_op_new    := 'resolved';
    v_state_new := 'materialized';
  END IF;

  UPDATE public.excel_sync_ops
     SET op_status = v_op_new
   WHERE op_uuid = p_op_uuid;

  UPDATE public.excel_sync_state
     SET materialization_status = v_state_new,
         op_status              = v_op_new,
         -- merged: write the post-merge fingerprints so the next TOCTOU diff is against
         -- the merged baseline.
         identity_vector_fingerprint = CASE
           WHEN p_resolution = 'merged' AND p_resolved_fingerprints IS NOT NULL
             THEN COALESCE(p_resolved_fingerprints #>> '{identityVector}', identity_vector_fingerprint)
           ELSE identity_vector_fingerprint END,
         field_fingerprints = CASE
           WHEN p_resolution = 'merged' AND p_resolved_fingerprints IS NOT NULL
             THEN COALESCE(p_resolved_fingerprints #> '{fields}', field_fingerprints)
           ELSE field_fingerprints END,
         updated_at = now()
   WHERE document_id = p_document_id AND template_id = p_template_id
     AND scope_id = v_op.scope_id AND marker_annotation_id = v_op.marker_annotation_id;

  -- Audit the resolution (content-free).
  INSERT INTO public.excel_sync_audit(document_id, template_id, workbook_generation,
    actor_id, capability_tier, client_change_set_id, marker_annotation_id, row_outcome)
    VALUES (p_document_id, p_template_id, v_op.workbook_generation, auth.uid(),
            'resolve', p_op_uuid::text, v_op.marker_annotation_id, 'review');

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal309_resolve_materialization_conflict(UUID, TEXT, UUID, TEXT, JSONB)
  TO authenticated;

-- ===========================================================================
-- Table comments
-- ===========================================================================

COMMENT ON TABLE public.excel_sync_head IS
  'KAL-309: per-mirror monotonic revision head, keyed by the STABLE (document_id, '
  'template_id) mirror (survives re-export, F2). The serialization point + fetch-since cursor.';
COMMENT ON TABLE public.excel_sync_state IS
  'KAL-309: latest-per-marker Excel-side identity (excelSync record 1:1) + apply '
  'bookkeeping + materialization status. assigned_token is sensitive — never returned via '
  'kal309_fetch_since. Access only via SECURITY DEFINER RPCs / service role.';
COMMENT ON TABLE public.excel_sync_ops IS
  'KAL-309: ordered accepted-op log (the fetch-since source). op_uuid is the global durable '
  'cross-client op identity; one op per (document_id, template_id, excel_revision).';
COMMENT ON TABLE public.excel_sync_changesets IS
  'KAL-309: idempotency authority + verbatim-replay source. Stores ALL per-row outcomes + '
  'writeback_jobs. UNIQUE (document_id, template_id, client_change_set_id).';
COMMENT ON TABLE public.excel_sync_audit IS
  'KAL-309: content-free, immutable (TRIGGER-enforced even vs the SECURITY DEFINER owner) '
  'audit trail. No row content, no tokens. server_ts is the server clock.';

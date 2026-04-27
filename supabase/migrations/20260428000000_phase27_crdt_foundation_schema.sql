-- Migration: Phase 27 - CRDT Foundation schema (doc_yjs_updates + doc_yjs_state + activity_log)
-- Date: 2026-04-28
-- Source: .planning/phases/27-crdt-foundation/27-RESEARCH.md Schema Design + Code Examples
-- Defends Pitfalls: 1 (migration partial-state), 10 (Y.Doc grows forever), 15 (TEXT-vs-bytea), 17 (schema evolution)
-- Fulfills requirement: AUTH-03 - server-authoritative timestamp on every annotation transaction
--
-- RLS POLICIES IN THIS MIGRATION ARE STUBS - Phase 28 replaces them with the full
-- user_can_access_document() gating after the transport spike chooses a transport adapter.

-- ============================================================================
-- doc_yjs_updates: append-only log of binary Yjs updates per document.
--   Per-document partition, monotonic seq, server-authoritative timestamps.
--   NEVER deleted (tombstones via Yjs internal mechanism, not row deletion).
-- ============================================================================
CREATE TABLE IF NOT EXISTS doc_yjs_updates (
  id          BIGSERIAL PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  client_id   TEXT NOT NULL,
  seq         BIGINT NOT NULL,
  update      BYTEA NOT NULL,
  origin      JSONB,
  client_ts   TIMESTAMPTZ,
  server_ts   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT  doc_yjs_updates_seq_uniq UNIQUE (document_id, seq)
);

CREATE INDEX IF NOT EXISTS doc_yjs_updates_doc_seq_idx
  ON doc_yjs_updates (document_id, seq);

-- ============================================================================
-- doc_yjs_state: per-document Y.Doc snapshot, compacted from doc_yjs_updates.
--   Phase 32 owns the actual compaction job; Phase 27 just guarantees the schema can hold a snapshot.
-- ============================================================================
CREATE TABLE IF NOT EXISTS doc_yjs_state (
  document_id      UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  state            BYTEA NOT NULL,
  state_vector     BYTEA NOT NULL,
  through_seq      BIGINT NOT NULL,
  encoding_version SMALLINT NOT NULL DEFAULT 1,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- activity_log: server-authoritative audit trail. Phase 33 reads this for the
--   Activity Log sidebar UI. Phase 27 ships the schema; Phase 28 wires the
--   server-side update listener that writes rows.
-- ============================================================================
CREATE TABLE IF NOT EXISTS activity_log (
  id            BIGSERIAL PRIMARY KEY,
  document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id       UUID,
  device_id     TEXT,
  op_type       TEXT NOT NULL,
  anno_id       TEXT,
  client_ts     TIMESTAMPTZ,
  server_ts     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  summary       JSONB
);

CREATE INDEX IF NOT EXISTS activity_log_doc_server_ts_idx
  ON activity_log (document_id, server_ts DESC);

-- ============================================================================
-- RLS - STUBS ONLY. Phase 28 replaces with full user_can_access_document() gating.
-- Default deny: every operation blocked. Server-side service-role keys can still
-- bypass via Supabase's standard RLS-bypass-with-service-role pattern.
-- ============================================================================
ALTER TABLE doc_yjs_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_yjs_state   ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS doc_yjs_updates_phase27_stub_deny_all ON doc_yjs_updates;
DROP POLICY IF EXISTS doc_yjs_state_phase27_stub_deny_all   ON doc_yjs_state;
DROP POLICY IF EXISTS activity_log_phase27_stub_deny_all    ON activity_log;

CREATE POLICY doc_yjs_updates_phase27_stub_deny_all ON doc_yjs_updates
  FOR ALL USING (FALSE) WITH CHECK (FALSE);

CREATE POLICY doc_yjs_state_phase27_stub_deny_all ON doc_yjs_state
  FOR ALL USING (FALSE) WITH CHECK (FALSE);

CREATE POLICY activity_log_phase27_stub_deny_all ON activity_log
  FOR ALL USING (FALSE) WITH CHECK (FALSE);

-- ============================================================================
-- COMMENTS for forward documentation (visible in pg_description / Supabase Studio)
-- ============================================================================
COMMENT ON TABLE doc_yjs_updates IS
  'Append-only log of binary Yjs updates per document. NEVER deleted. server_ts is AUTH-03 source of truth.';
COMMENT ON TABLE doc_yjs_state IS
  'Per-document Y.Doc snapshot, compacted from doc_yjs_updates by Phase 32 compaction job.';
COMMENT ON TABLE activity_log IS
  'Server-authoritative audit trail. Phase 33 reads for Activity Log sidebar. server_ts is AUTH-03 source of truth.';
COMMENT ON COLUMN doc_yjs_updates.server_ts IS
  'AUTH-03 - server-authoritative timestamp. NOT NULL, DEFAULT NOW(). Required by REQUIREMENTS.md AUTH-03.';
COMMENT ON COLUMN activity_log.server_ts IS
  'AUTH-03 - server-authoritative timestamp. NOT NULL, DEFAULT NOW(). Required by REQUIREMENTS.md AUTH-03.';

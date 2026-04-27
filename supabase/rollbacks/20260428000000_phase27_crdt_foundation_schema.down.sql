-- Rollback for: 20260428000000_phase27_crdt_foundation_schema.sql
-- Date: 2026-04-28
-- Drops the 3 Phase 27 tables (doc_yjs_updates + doc_yjs_state + activity_log).
-- Order: tables with no dependencies first; CASCADE removes the FK + indexes + policies automatically.
-- Idempotent: IF EXISTS prevents errors on partial-rollback retries.

-- Drop policies first (defensive — CASCADE on table drop also handles this)
DROP POLICY IF EXISTS doc_yjs_updates_phase27_stub_deny_all ON doc_yjs_updates;
DROP POLICY IF EXISTS doc_yjs_state_phase27_stub_deny_all   ON doc_yjs_state;
DROP POLICY IF EXISTS activity_log_phase27_stub_deny_all    ON activity_log;

-- Drop indexes explicitly (defensive — CASCADE on table drop also handles this)
DROP INDEX IF EXISTS doc_yjs_updates_doc_seq_idx;
DROP INDEX IF EXISTS activity_log_doc_server_ts_idx;

-- Drop tables. CASCADE removes any remaining FK references, policies, indexes.
-- Order doesn't matter here since none of these reference each other - they all reference documents(id).
DROP TABLE IF EXISTS doc_yjs_updates CASCADE;
DROP TABLE IF EXISTS doc_yjs_state   CASCADE;
DROP TABLE IF EXISTS activity_log    CASCADE;

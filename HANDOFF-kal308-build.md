# HANDOFF — KAL-308 build (Excel Security V1 keystone)

_Living progress tracker. Goal: ship server-side Excel change-set validation +
transactional apply. Governing plan: PLAN-KAL308.md (Codex-APPROVED round 4).
Argument transcript: PLAN-KAL308-REVIEW-LOG.md. Started 2026-06-24._

**Operating mandate (Isaiah, 2026-06-24):** full autonomy, ultracode on. App is
NOT published — touch real data freely; survey-test is for test hygiene only.
Keep working progressively until done; keep Codex in the loop on high-stakes
design. Don't ask permission to touch data; do confirm before push/publish.

## Phases

- [x] **P0 — UNDERSTAND (done):** signing-secret lifecycle + call sites mapped; Vault
  is disabled → restricted table chosen; build-step-0 SETTLED (markers owned by
  `annotationDocSync` Y.Map('surveyMarkers'), materialize via `applySurveyMarkers`).
- [x] **KAL-308a (PRECONDITION) — signing secret → server: DONE + LIVE-VERIFIED.**
  Build clean, full suite 1625/0, and **6/6 integration tests PASS on survey-test**
  (incl. the server-side S3 parity round-trip + viewer/anon forging wall + RLS).
  Live-caught + fixed: `#variable_conflict use_column` in the get-or-create RPC (OUT
  cols collided with table cols in ON CONFLICT). survey-test schema applied via the
  dashboard SQL editor (browser-extension injection was blocked, so Isaiah pasted).
  PDFViewer.jsx wiring still uncommitted in the tree with prior KAL-279/259 work.
  PLAN-KAL308a.md Codex-APPROVED (2 rounds, Model B). Original NEXT list:
  migration + 3 RPCs; `rowIdServerSecretClient.js` (memoized); 9 unit tests incl. S3
  guard; PDFViewer.jsx WIRED — export uses server secret-or-blank (signs over frozen
  `signingDocId`); both import sites resolve the server secret + pass the frozen id;
  local-only docs keep localStorage. Apply script (`scripts/apply-kal308a-to-test-db.mjs`)
  + integration test (`tests/rowIdSigningSecretIntegration.test.mjs`, incl. server-side
  parity round-trip) written; both skip/ready.
  BLOCKED on ONE thing: applying the migration to survey-test needs the Supabase
  ACCOUNT access token (sbp_…) — the sandbox blocks reading it from the keychain and
  the CLI no longer vends it. Isaiah runs once:
  `SUPABASE_ACCESS_TOKEN=<token> node scripts/apply-kal308a-to-test-db.mjs`
  then `SUPABASE_INTEGRATION=1 node --env-file=.env.test --test tests/rowIdSigningSecretIntegration.test.mjs`.
  NOTE: PDFViewer.jsx wiring is committed-pending — left uncommitted in the working
  tree alongside the prior KAL-279/259 uncommitted changes (don't sweep those into a
  commit). Browser-verify the real export/import flow after the survey-test apply.
- [ ] **KAL-309 — tables:** `excel_sync_state` (latest-per-marker, full identity
  record + materialization_status + applied cursor), `excel_sync_ops` (ordered
  accepted-op log, fetch-since source), `excel_sync_audit` (content-free immutable),
  slice-1 additive touches (`workbook_id` UNIQUE + `rowid_signing_doc_id`). RLS:
  service-role write only.
- [ ] **KAL-308 — apply RPC + Edge fn:** `kal308_apply_changeset` (service-role,
  registration-head lock, TOCTOU re-validate, field whitelist, lock check, atomic
  ops+state+audit+revision); Edge `excel-apply-changeset` (auth→role→registration→
  matcher→RPC→broadcast); matcher single-source + Deno smoke test.
- [ ] **Client cutover + reconcile:** build change-set → invoke Edge → materialize
  accepted ops into Yjs (field-level patches, idempotent by op_id, applied cursor in
  Yjs meta); `excel-sync-fetch-since` reconcile; localStorage caches → cache-only.
- [ ] **Verify:** survey-test integration (TOCTOU, idempotency, viewer-reject,
  forged-token, shared-doc, lock), matcher parity, browser multi-client convergence,
  ≥2 adversarial passes; latency p95 recorded.

## Build-time notes (from Codex round-4 approval) — honor during build

See PLAN-KAL308.md "Build-time notes": per-op status history, fetch-since scoped by
registration, block stacking on unresolved conflict, explicit ack wrapper, op
payload completeness, accepted≠materialized wording, step-0 mandatory.

## Status log

- 2026-06-24: PLAN-KAL308.md drafted + Codex-APPROVED (4 rounds). P0 understand
  workflow launched.
- 2026-06-24: **KAL-308a COMPLETE + committed.** Commits c50ffc01 (migration +
  client + unit tests), 5e56fb80 (apply script + integration test), 9a664e53
  (column-ambiguity fix, live-verified), eb0a43b8 (PDFViewer wiring — filtered-patch
  committed only my 5 hunks). Live: 6/6 survey-test integration pass. survey-test
  schema applied via dashboard SQL editor (browser-extension injection blocked).
  Pre-existing KAL-279/259 working-tree changes (AppShell.jsx, package.json,
  PdfjsViewerContainer.jsx, PDFViewer.jsx lines 21117+/30562+) deliberately left
  UNCOMMITTED + untouched. Local commits only (no push, per direct-to-main).
  NEXT PHASE: the keystone — KAL-309 tables (excel_sync_state / excel_sync_ops /
  excel_sync_audit + slice-1 additive touches) → kal308_apply_changeset RPC → Edge
  fn → client materialize/reconcile. Plan→Codex→build per PLAN-KAL308.md.

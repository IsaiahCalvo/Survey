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

- 2026-06-24: **KAL-309 keystone spec Codex-APPROVED (3 rounds + workflow critique).**
  Committed 56dcadb2. ~25 design bugs caught on paper. Build STARTED: authoring the
  migration (5 tables: excel_sync_state/_ops/_audit/_head/_changesets + additive
  workbook_id UNIQUE + apply RPC kal308_apply_changeset + helper RPCs + audit trigger).
  Then Edge fn excel-apply-changeset (matcher guarded-copy + drift test in gate),
  client cutover (excelSyncClient, read-merge-write materialize, fetchSince reconcile,
  resolve-conflict UI), tests. No DB/token/browser needed until the final survey-test
  apply. Decision (Claude, structural-for-V1): server field-whitelist is best-effort
  template (F21) — full template validation deferred (templates not yet in migrations).

- 2026-06-24: **KAL-309 migration BUILT + Codex-APPROVED as code** (3 review rounds,
  10->4->0 bugs incl. 2 security). supabase/migrations/20260625120000_kal309_excel_sync.sql,
  node 1625/0, committed. NOT applied (survey-test needs the account token; same wall).
  Edge fn build STARTED. Remaining: Edge excel-apply-changeset (+ matcher guarded-copy +
  drift test in gate) -> client cutover (excelSyncClient, materialize, reconcile, resolve UI)
  -> survey-test apply+integration verify.

- 2026-06-24: **KAL-309 SERVER SIDE COMPLETE + Codex-approved as code.** Migration (3 SQL
  review rounds) + Edge fn excel-apply-changeset (3 rounds) + matcher scope-key collision
  fixed at source. Commits acb4fb96 (migration), 99dfbf2d (Edge draft), 9680e5bf (Edge
  approved + matcher fix). node 1648/0, deno check clean, vite build green, drift gate in
  suite. PDFViewer matcher-consumer hunks committed via filtered patch; pre-existing
  KAL-279/259 (>20000) still untouched. NOT applied to any DB (survey-test needs the token).
  Client cutover STARTED (excelSyncClient + materialize + reconcile + resolve UI). Then
  tests + survey-test apply+verify.

- 2026-06-25: **KEYSTONE CODE-COMPLETE — entire KAL-308/309 Codex-approved as code (server + client).**
  Commits: acb4fb96 (migration), 9680e5bf (Edge), 9b5f1779 (client cutover). Across the build:
  migration SQL review (3 rounds, 10->4->0), Edge review (3 rounds), client cutover review
  (4 rounds, 7->4->2->0) — ~40 design/code bugs caught before any DB touch. Full suite 1662/0,
  vite build green, deno check clean, matcher drift gate in suite. New: excelSyncClient.js,
  excelSyncPendingChangeset.js, supabase/functions/excel-apply-changeset/, the migration +
  guarded matcher copy; PDFViewer wired behind registered/local split with export-seeding +
  reconcile + resolve UI + writeback. Pre-existing KAL-279/259 (>20000) untouched throughout.
  REMAINING (needs Isaiah's machine): apply the migration to survey-test (account token/paste,
  same wall) -> run integration tests -> browser multi-client verify. Then production apply +
  in-app verification. The CODE is done.

- 2026-06-25: **KEYSTONE LIVE-VERIFIED on survey-test.** Token in .env.test → self-service.
  KAL-308a re-applied + 6/6 integration pass; KAL-309 migration applied (5 tables + apply RPC
  + helpers + audit trigger, all verified); Edge fn excel-apply-changeset DEPLOYED; **12/12
  KAL-309 apply-RPC integration tests pass on real Postgres** (scripts/apply-kal309-to-test-db.mjs,
  tests/kal309ApplyChangesetIntegration.test.mjs). Visual recap published (recap-9747d0072cbd4a67).
  REMAINING (human): production apply (KAL-307+308a+309 + Edge deploy to the real project — Isaiah's
  go) + in-app export→re-import smoke test in the dev app. Pre-existing KAL-279/259 (>20000) still
  untouched/uncommitted.

- 2026-06-26: **KEYSTONE LIVE ON PRODUCTION ("Survey", ref cvamwt…).** Isaiah green-lit the prod
  apply. Read-only pre-flight confirmed prod already had the prereqs (pgcrypto, documents.locked_at,
  kal49, excel_workbook_registrations [4 rows / 2 active, no dup active workbook_id], document_collaborators,
  user_can_access_document) and that all 308a/309 objects were absent (clean apply). Adversarial 4-lens
  workflow pre-flight (fail-on-prod/harm-data/security-grants all GO; completeness=caution) cleared it.
  APPLIED via Management API: KAL-308a (rowid_signing_secrets + 3 RPCs) then KAL-309 (5/5 sync tables +
  kal308_apply_changeset + 9 helpers + audit trigger + additive rowid_signing_doc_id col + active partial-
  unique index), all verified; recorded both versions in schema_migrations (future-db-push guard).
  DEPLOYED Edge fn excel-apply-changeset (ACTIVE, v1, verify_jwt=true; unauth POST → 401). Prod app
  (real DB; not yet published) now has the full server-side Excel change-set validation + transactional
  apply path live. REMAINING (human): in-app export→re-import smoke test + optional 2-browser convergence.
  Deferred follow-on (non-blocking, pre-flight low/med): swap extensions.gen_random_uuid()→gen_random_uuid()
  at kal309 L620; add REVOKE ALL …FROM PUBLIC on the new tables + 2 pure helpers for defense-in-depth.

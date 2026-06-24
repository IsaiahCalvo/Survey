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
- [~] **KAL-308a (PRECONDITION) — signing secret → server:** PLAN-KAL308a.md
  Codex-APPROVED (2 rounds, Model B: secret server-stored + authorized-client-
  resolvable; HMAC stays in JS; frozen `signing_doc_id`). DONE: migration
  (`20260624120000_kal308a_rowid_signing_secrets.sql` — table + 3 editor/owner-gated
  RPCs), `rowIdServerSecretClient.js` (memoized resolver), unit tests (9 pass incl.
  S3 base64 round-trip guard). NEXT: wire export/import/preflight in PDFViewer.jsx +
  rowIdSecretStore.js; apply migration to survey-test + run server-side parity
  integration test; full build + suite gate.
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

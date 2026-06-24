# PLAN KAL-308 — server-side Excel change-set validation + transactional apply (the keystone)

_Slice 2 of the Excel Security V1 wave (epic KAL-305). Governed by
PLAN-EXCEL-SECURITY-V1.md steps 2–4. Slice 1 shipped
(`20260611120000_kal307_workbook_registrations.sql`, `workbookRegistration.js`).
Round 1 by Claude; hardened through Codex adversarial review rounds 1–3 + a
ground-truth code-verification pass. Drafted 2026-06-24._

## Goal

Close the unauthenticated Excel side door. Today any change to a watched workbook
is matched + applied entirely client-side with zero server validation of who made
it. After this slice: every Excel-origin change set is **validated AND applied
server-side** against the signed-in actor's role; the server is the single
authority; the accepted result is made durable as a marker op-log entry that all
open + future clients converge on. The submitter gets per-row outcomes
(applied / conflict / stale / unauthorized / review).

## Persistence reality (Decision 0 — corrects the round-1 draft)

**Verified:** Survey Markers' live + durable truth is a **Yjs document**
(`surveyMarkers` map), persisted as snapshots + an append-only update log and
hydrated by `annotationDocSync` (`YDocProvider.jsx:835`, `annotationDocSync.js`).
The `document_annotations` table is a **legacy/secondary** survey-marker store;
`getDocumentAnnotations` filters to survey-marker types but is NOT the modern
hydrate source. **A server write to `document_annotations` alone would be invisible
to clients.** (Confirmed round-2 code recon.)

Therefore the apply path must produce a **durable accepted-op** that clients
materialize into the Yjs marker cache via the existing hydrate/realtime
machinery — not a bare `document_annotations` write (which clients never read for
markers).

- **MUST-RESOLVE-BEFORE-BUILD (engine ownership):** two reports disagree on whether
  survey markers currently live in the `annotationDocSync` Y.Doc (`annoflat:<id>`)
  or the older `YDocProvider` Y.Doc. `annotationDocSync.js` exposes
  `getSurveyMarkers/applySurveyMarkers/docToSurveyMarkers`, suggesting markers are
  (now) on it. This is the same "two Y.Docs / which owns markers" question the
  legacy-engine handoff calls the gate for everything. **Build step 0 is to pin,
  by live trace, exactly which Y.Doc the open client hydrates markers from — that is
  the Y.Doc clients materialize accepted ops INTO.** The server never writes Yjs
  (Option B); this only fixes the client-side materialize target. Do not start the
  apply RPC until this is nailed.
- **Apply mechanism — DECIDED (Option B, accepted-op log is the authority; Yjs is a
  materialized cache).** Option A (server-encoded Yjs update) is DROPPED: the Edge
  can encode Yjs but the RPC re-validates afterward, so A cannot be atomic with
  validation (Codex r2 #2). The model:
  - The durable, server-authoritative truth is a **dedicated ordered accepted-op log
    table `excel_sync_ops`** (Decision 16): one row per accepted op with a
    deterministic field-level patch payload, keyed by `(workbook_registration_id,
    excel_revision, op_id)`. This is the `fetch-since` source. It is SEPARATE from
    the content-free `excel_sync_audit` journal (Decision 7) and from
    `excel_sync_state` (latest per-marker identity, not an ordered log). The server
    NEVER writes Yjs.
  - Yjs `surveyMarkers` is a **materialized cache**. Each client (and, only if
    offline-convergence requires it, a server-side materializer — see reconcile
    API) projects accepted ops into Yjs via an **idempotent reducer keyed by
    `(excel_revision, op_id)`**. The op payload is **deterministic** so every
    client produces the identical Yjs mutation (Codex r2 #5).
  - **Field-level patches, never whole-marker `map.set`** (Codex r2 #6): an accepted
    op carries only the matcher's `changedFields` and is merged field-by-field into
    the current Yjs marker, preserving concurrent app edits to untouched fields.
  - **Applied ledger (Codex r2 #4, r3 #5):** the applied cursor lives in places that
    must agree — `excel_sync_state.last_applied_excel_revision/op_id` (server), a
    per-document local cursor (fast path), AND the Yjs marker/doc meta
    (`excelApplied` map keyed by `op_id`). Encoding it into Yjs is what lets a
    fresh/lost-cursor client replay from zero idempotently WITHOUT clobbering newer
    app edits — the reducer skips any op already present in the Yjs `excelApplied`
    meta.
  - **Materialization state machine (Codex r3 #2/#3):** accepting an op (server) and
    materializing it (client) are distinct. Each `excel_sync_state` row carries
    `materialization_status ∈ {accepted, materialized, client_conflict_review}`. The
    server writes the op + sets `accepted` (it never claims `applied`). The client
    materializes, then acks via a service-role RPC: success → `materialized`; a
    client-detected app-vs-Excel conflict → `client_conflict_review` (durable, so
    every device surfaces the SAME review item, not a silent skip). The fetch cursor
    advances past processed ops regardless; resolution is tracked by status.
  - **Deterministic create ids (Codex r3 #6):** for create ops the apply RPC mints
    the `marker_annotation_id` (`gen_random_uuid`) and puts it in the op payload, so
    every client materializes the create as the SAME marker — no divergent ids/dupes.
  - **Convergence + recovery (reconcile API, replaces the hand-wave — Codex r2 #14):**
    open clients get a broadcast *hint* and pull `excel-sync-fetch-since(document_id,
    since_revision)` (redacted read RPC) → accepted ops in ascending `excel_revision`
    order; apply idempotently; advance the cursor; on failure retry with capped
    backoff. On document open, the same fetch from the persisted cursor replays any
    ops missed while offline — this is what makes the change durable for
    offline-at-apply clients.

## Why the matcher ports as-is (unchanged from round 1, re-confirmed)

`buildScopeImportPlans` / `buildImportPlan` / `detectFieldConflicts` are pure JS,
Deno-portable (SubtleCrypto + TextEncoder only). Paste-above drift RESOLVED +
tested (KAL-306). No plpgsql matcher port.

## Architecture: Edge validates, RPC re-validates + applies atomically

1. **Edge Function `excel-apply-changeset`** (Deno, `supabase/functions/`):
   - `Authorization: Bearer` JWT → `auth.getUser(token)`; reject anon. (Pattern
     `send-email/index.ts:11`; ref `reference_edge_function_auth_pattern`.)
   - `user_can_access_document(document_id,'editor')` → reject viewer/none.
   - **Canonical Row-ID document id (Decision 1):** the Edge resolves the exact
     string the export signed tokens over (see Decision 1) — not assumed to be the
     UUID.
   - Active-registration check: look up by `workbook_id` (now UNIQUE — Decision 6);
     `token_hash` match, `revoked_at IS NULL`, not expired; for business, Graph
     **metadata equality** (best-effort hygiene — `graph_drive_id`/`graph_item_id`
     equality, NOT a server-proven Graph read; Codex r2 #15).
   - Load current `stored` records (`excel_sync_state`) for the matcher `stored`
     array (base fingerprints for Excel-vs-Excel drift). NOTE: live app marker values
     are in Yjs and NOT server-readable at apply time, so the server does NOT attempt
     app-vs-Excel conflict detection (the round-2 server projection is DROPPED — Codex
     r3 #4). Conflict split: the server detects **Excel-vs-Excel** drift (TOCTOU on
     the stored base fingerprint); the **client** materialize reducer does the FINAL
     **app-vs-Excel** field-level check against live Yjs and routes genuine conflicts
     to `client_conflict_review`. The security wall is the actor-role check, not the
     conflict check.
   - `resolveSecret` reads the per-document signing secret from the server store
     (Decision 2). Run the matcher → decisions.
   - Call the apply RPC with `p_actor_id` (validated), the decisions, base hashes,
     and `client_change_set_id`. **The RPC re-validates** (Decision 3).
   - Broadcast a hint; return per-row outcomes.
   - Client invokes via `supabase.functions.invoke('excel-apply-changeset', …)`.

2. **Postgres RPC `kal308_apply_changeset`** (SECURITY DEFINER, `search_path=''`,
   **EXECUTE granted to service_role ONLY** — Codex #5):
   - Takes `p_actor_id` explicitly; does NOT rely on `auth.uid()` (ambiguous under
     service role — Codex #6). Re-checks the actor's editor/owner role from
     `document_collaborators`/`documents` inside the txn.
   - **Serialize on the registration head (Codex r2 #8):** FIRST `SELECT … FOR
     UPDATE` the per-registration `excel_revision` head — this serializes the whole
     change-set apply (including row CREATES that have no `excel_sync_state` row yet)
     against concurrent submissions for the same workbook. Create idempotency is
     enforced by the per-row `(change_set_id, op_id)` UNIQUE.
   - **TOCTOU re-validation (Codex #4):** then for each existing row, `SELECT … FOR
     UPDATE` its `excel_sync_state` row and compare the stored base fingerprint
     against the change-set's claimed base; if drifted since the Edge read →
     `conflict`/`stale`, do NOT write. (This catches Excel-vs-Excel drift; the
     app-vs-Excel final check is the client's, per the two-tier model.)
   - **Document lock (Codex #20):** `kal49_document_is_locked(document_id)` → if
     locked, reject all writes.
   - **Field whitelist (Codex #18):** map only allowed marker fields; validate
     entity + checklist-item ids against the template; ignore Excel audit columns
     for authority.
   - Atomic per accepted row: insert the ordered op into `excel_sync_ops`
     (Decision 16) + UPSERT `excel_sync_state` (full identity record — Decision 5,
     `materialization_status='accepted'`) + content-free `excel_sync_audit` insert
     (Decision 7) + bump the per-registration `excel_revision` head.
   - **Idempotency (Codex #11):** UNIQUE `(document_id, workbook_registration_id,
     client_change_set_id)` and per-row `(change_set_id, row_op_id)`; a replay
     locks the prior rows and returns prior outcomes (no double-apply).
   - pgcrypto `extensions.*` under `search_path=''` (KAL-307 lesson; keep
     migration + any apply-script inline copy in sync).

## Decisions (resolved from Codex round 1)

**1 — Canonical Row-ID document id (exact value, Codex r2 #9).** Tokens are signed
over `${pdfFile.id || 'local'}:${pdfId || pdfFile.name || 'pdf'}` — a CLIENT
file-identity string, NOT `documents.id`. The server cannot reconstruct it, so:
(a) the registration **stores the canonical signing-id** as an additive column on
`excel_workbook_registrations` (`rowid_signing_doc_id`), captured at
register/export time; (b) the Edge verifies tokens against that STORED id, never a
client-supplied one; (c) the KAL-308a signing RPC signs **only from the stored
registration canonical id** (Codex r2 #13) — a client can't request a token for an
arbitrary id; (d) tokens that don't verify under the stored id → review/re-export,
never silent. Confirm the exact export call site at build step 0.

**2 — Signing secret is server-held; this is a hard PRECONDITION (Codex #2).** The
per-document Row-ID signing secret lives only in client `localStorage`
(`rowIdSecret:{documentId}`). The server cannot verify signatures without it.
**Split a pre-slice KAL-308a:** move signing server-side — secret minted/held in
Supabase Vault keyed by document; export signs via a server RPC (signing over the
STORED canonical id, Decision 1); import verifies via the same secret. KAL-308
proper assumes the secret is already server-resolvable. Ship KAL-308a behind the
review-on-failure fallback so a resolve miss degrades to "review," never silent
accept or data loss. **Legacy operationalization (Codex r2 #14):** KAL-308a adds a
preflight that detects an active workbook still signed by a client-only
(`localStorage`) secret and forces a re-export/re-link before server sync is
allowed — with a test for that detection path.

**3 — Vault path made concrete (Codex #3).** Secret stored in Vault (or a
`vault.secrets`-backed table); a SECURITY DEFINER RPC `kal308_resolve_signing_secret(doc, keyId)`
returns it to the Edge's service-role caller only; never exposed to clients;
covered by a test that an anon/viewer caller is rejected.

**4 — `excel_sync_state` schema (Codex #9, #10).** Mirror the `excelSync` identity
record EXACTLY (`excelIdentityRecord.js:37`, `buildScopeImportPlans.js:157`):
`version, origin, last_export_id, was_written_as_row, assigned_token,
pending_rowid_writeback, last_seen_row_number, last_ingest_seq,
identity_vector_fingerprint, full_row_fingerprint, field_fingerprints(jsonb),
copy_of_marker_id, copy_ordinal`. Plus apply-bookkeeping:
`last_applied_excel_revision`, `last_applied_op_id`, and `materialization_status`
(Decision 0). NO `app_now` projection column (dropped, Codex r3 #4). The ordered op
payloads live in `excel_sync_ops` (Decision 16), NOT here — this table is
latest-per-marker only. Key by **`workbook_registration_id` (FK to
`excel_workbook_registrations.id`)** + `template_id` + `scope_id` +
`marker_annotation_id` (drop the bare `workbook_generation` PK — Codex #10).
**RLS: NO client SELECT/DML at all — service-role only (Codex r2 #17)** (the table
holds `assigned_token` + fingerprints). Clients read only what they need via the
redacted `excel-sync-fetch-since` RPC, which never returns tokens to anyone.
Indices `(workbook_registration_id, template_id)` and `(marker_annotation_id)`.

**5 — Per-registration revision head + lock (Codex #11/revision).** Add an
`excel_revision BIGINT` (per active registration) stored on a row the apply RPC
locks `FOR UPDATE` and increments — the monotonic staleness/fast-path source and
the recovery cursor for clients.

**6 — Two additive slice-1 touches (Codex #13, r2 #10/#12).** Additive migration on
`excel_workbook_registrations`: (i) a UNIQUE index on `workbook_id` (currently only
a plain index) before any lookup-by-workbookId; (ii) a `rowid_signing_doc_id`
column storing the canonical signing-id (Decision 1), populated at register/export.
The RPC signature + return shape stay unchanged; these are additive columns/indices
only.

**7 — Audit table immutable + content-free (Codex #21, r3 #1).** KAL-308 creates
`excel_sync_audit` (append-only: actor, workbook_registration_id, capability_tier,
change_set_id, device_hint, per-row outcome — NO row content) with **NO
UPDATE/DELETE policy for anyone** now — KAL-310 only surfaces it + adds History UI,
doesn't relax it. SEPARATE from `excel_sync_ops` (Decision 16), which holds the
replayable patch payloads.

**8 — Conservative shared-doc default (Codex #12), without pulling KAL-311 forward.**
Full business-only gate is KAL-311. KAL-308 adds the safe interim: if the doc is
shared (`COUNT(active document_collaborators) > 1`) and the active registration is
not business-tier with matching Graph metadata (best-effort, per Decision 1's
wall-is-actor-role framing) → **reject/route to review**, never
apply. This prevents 308 from accepting what 311 will later reject. (I am NOT
implementing 311's full registry gate here — logged as a deliberate scope line.)

**9 — Never name-match; legacy/no-Row-ID → review (Codex #16).** Unregistered /
retired-workbook / missing-Row-ID / schema-diff rows route to review/re-export
only. The server never falls back to name matching. (Fingerprint-based recovery of
a blanked Row-ID is identity-based, not name-based — allowed, but flag any
recovered row in the outcome.)

**10 — Deletes are review-only in KAL-308 (Codex #17).** `candidateDeletes` →
review outcome; no server-side auto-delete. Full delete-grace/trash/bulk-confirm
server semantics are deferred (they intersect KAL-313 trash, already shipped, +
KAL-314) — do not reimplement them here.

**11 — Row-ID writeback jobs (Codex #19).** Server-created rows return verified
writeback jobs (token + pending state) the client flushes via the existing
`rowIdWritebackQueue`; `excel_sync_state.pending_rowid_writeback` tracks it.

**12 — Schema/template diffs (Codex #15).** New/changed Excel columns are not
auto-applied server-side → reject/route to review.

**13 — Matcher single-source + smoke test (Codex #22).** One source for the matcher
across Vite + Deno. Add a Deno import/deploy **smoke test** proving the Edge bundle
loads the matcher, and a **drift test** if any shared copy is unavoidable (KAL-307
inline-copy lesson). No third copy.

**14 — Observability (Codex #23).** Structured, content-free logs + audit counters:
auth pass/fail, token verify outcome, conflict/stale/review counts, apply latency
p95, replay hits, broadcast-vs-fetch recovery. No row content in logs.

**15 — Payload + rate limits (Codex #24).** Cap rows-per-change-set and cell sizes
(reject oversized, reference the 600KB realtime cap); rate-limit per
actor/document/workbook.

**16 — `excel_sync_ops` ordered accepted-op log + reconcile (Codex r3 #1, r2 #14).**
A dedicated table: one row per accepted op = `(workbook_registration_id,
excel_revision, op_id, marker_annotation_id, op_type ∈ {apply,create},
patch_payload(jsonb, field-level; minted id for creates), created_at)`. Append-only,
service-role write only, no client SELECT. The `excel-sync-fetch-since(document_id,
since_revision)` read RPC returns these in ascending `excel_revision` order
(redacted — never tokens) for idempotent client replay (Decision 0). The round-2
server-side `appNow` projection is DROPPED — app-vs-Excel conflict is the client's
job against live Yjs (Codex r3 #4); the server tier only catches Excel-vs-Excel
drift via the stored base fingerprint.

## Acceptance criteria

- **Given** a signed-in editor/owner + active registered workbook, **when** a
  change set with valid Row-IDs is submitted, **then** the server applies the
  changed rows as a **durable marker op other open clients converge on**, writes
  `excel_sync_state` + an immutable audit row, bumps `excel_revision`, and returns
  `applied` outcomes — integration-tested on survey-test AND browser-verified that
  a second open client sees the change.
- **Given** a viewer actor (even holding the live token), **when** they submit,
  **then** rejected `unauthorized`, zero writes — at RPC and Edge.
- **Given** the same `client_change_set_id` twice, **then** applied exactly once,
  prior outcomes returned.
- **Given** a row's stored base fingerprint changed between the Edge read and the
  RPC write, **then** the RPC returns `conflict`/`stale` and does not overwrite
  (TOCTOU).
- **Given** a row changed in BOTH app and Excel since baseline, **then** the client
  materialize reducer detects the app-vs-Excel field conflict against live Yjs and
  routes it to `client_conflict_review`, no overwrite (the server tier only catches
  Excel-vs-Excel drift).
- **Given** a forged/foreign Row-ID token (server can now verify), **then** review,
  never silent apply.
- **Given** a shared doc with a non-business registration, **then** the change set
  is rejected/routed to review, not applied.
- **Given** a locked document, **then** all writes rejected.
- **Given** a server-created row, **then** a verified Row-ID writeback job is
  returned + `pending_rowid_writeback` set.
- **Given** the apply commits then the broadcast fails, **when** a client
  reconnects, **then** it recovers via `excel_revision` gap-fetch; **and** a client
  offline at apply converges on next open via reconciliation replay into Yjs.
- **Given** the gates, **when** `npx vite build` + `node scripts/run-node-tests.mjs`
  run, **then** clean + 0 fail (report baseline before declaring done).

## Verification method

- RPC/Edge: integration tests on **survey-test only** (never production —
  `no_docker_use_cloud_supabase`, `survey_test_supabase_project`), mirroring the
  KAL-307 8/8 harness, incl. the TOCTOU, idempotency, viewer-reject, forged-token,
  shared-doc, and lock cases.
- Matcher parity: unit tests — ported module ≡ in-app decisions on shared fixtures.
- Convergence + reconciliation: browser-verified multi-client via the standing
  recipe (HANDOFF-mvp-takeover.md); not claimed done on unit gates alone
  (`verify_in_app_before_reporting`). ≥2 adversarial verify passes + code review on
  the realtime/CRDT paths (`adversarial_verify_realtime`).
- Latency p95 measured + recorded in this log.

## DO NOT CHANGE (boundaries)

- **`PLAN.md`** + **`PLAN-EXCEL-SECURITY-V1.md`** — governing contracts; amend via
  the documented process only, never overwrite.
- **Matcher behavior** — `rowImportMatcher.js`, `buildScopeImportPlans.js`,
  `excelConflictDetect.js`, `rowFingerprint.js`, `rowIdToken.js`: made
  server-importable + called; matching behavior (incl. KAL-306 paste-above
  invariants) unchanged. Edits here are export/import plumbing only.
  EXCEPTION: KAL-308a (secret migration) deliberately changes WHERE the signing
  secret lives + the signing call site — scoped, behind review-on-failure fallback.
- **Slice-1 registration contract** — the `kal307_register_workbook` RPC + return
  shape: unchanged. Two ADDITIVE slice-1 touches only (Decision 6): the
  `workbook_id` UNIQUE index and the `rowid_signing_doc_id` column.
- **Standing high-risk files** — `PDFViewer.jsx`, `PageAnnotationLayer.jsx`,
  `viewerShared.js`, Fabric canvases, `SVGAnnotationLayer.jsx`: client cutover
  touches the import-apply call site only; zoom/canvas/render invariants
  (container-aware sizing, `zoomGeneration`, SVG-viewBox) untouched.
- **Production Supabase** — read-only; all migrations land on survey-test; the
  production apply is a separate owner-gated batch (owner decision 2026-06-24:
  batch all finished + new migrations into one later window).
- Out-of-slice tickets — KAL-310 (audit UI/hardening surfacing), KAL-311
  (business-only gate), KAL-312 (ACL/rotation), KAL-314 (permission flip): not
  built here.

## Risks / open questions

- **Marker engine ownership (Decision 0)** — must be pinned by live trace before the
  apply RPC; wrong target = invisible writes. Highest design risk.
- **Secret migration blast radius (KAL-308a / Decision 2)** — touches the
  export/sign hot path; own verification + review-on-failure fallback; may warrant
  shipping + verifying KAL-308a fully before KAL-308 proper starts.
- **Apply mechanism** — DECIDED: Option B (accepted-op log authority + Yjs
  materialized cache). Build step 0 pins only the client materialize target (which
  Y.Doc owns markers); open-time replay required for offline-at-apply clients.
- **Cold-start latency** on the import path — measure; warm-ping if over budget.
- **Canonical id migration for legacy tokens (Decision 1)** — old exports must not
  silently break; one-time re-export/re-link prompt per the V1 legacy-preflight.
- **Coordination with the op-log/Yjs rebuild (KAL-263/270)** — this bridge must not
  preclude it (V1 plan constraint).

## Build-time notes (Codex round-4 approval — non-blocking, honor during build)

1. **Historical review status** — `materialization_status` on `excel_sync_state` is
   latest-per-marker and can lose history; also record status per op (on
   `excel_sync_ops` or a per-op status table) so a resolved/unresolved review is
   auditable.
2. **`fetch-since` scoping** — scope by `workbook_registration_id` (or keep
   per-registration cursors); `document_id + since_revision` is ambiguous when a
   document has multiple template registrations.
3. **Block stacking on unresolved conflict** — if a marker has an open
   `client_conflict_review`, hold/route later Excel ops for that marker to review
   until it's resolved (don't apply on top of an unresolved conflict).
4. **Explicit ack path** — the materialize ack goes through an authenticated
   Edge/RPC wrapper; only that wrapper uses the service role (clients never hold it).
5. **Op payload completeness** — `excel_sync_ops.patch_payload` must carry enough for
   the client's final conflict check: field values, changed-field keys, base
   fingerprints, marker id, and revision/op id.
6. **`accepted` ≠ `materialized` in responses/UI** — the submitter response + any UI
   must not say "applied" while a row is still `accepted` pending client
   materialization (which may flip to `client_conflict_review`).
7. **Step 0 stays mandatory** — the live trace of which Y.Doc owns markers is the
   first build action; everything downstream depends on it.

## Out of scope

- KAL-310/311/312/314, the Excel add-in (V2), full server-side Yjs authority
  (belongs to the persistence rebuild). KAL-308a (secret migration) is a named
  precondition, tracked separately but required first.

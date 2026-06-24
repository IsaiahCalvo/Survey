# Plan Review Log: KAL-308 — server-side Excel change-set validation + transactional apply

Started 2026-06-24 (session). MAX_ROUNDS=5. PLAN_FILE=PLAN-KAL308.md. Builder=Claude, adversarial critic=Codex (read-only).
Codex thread: 019efb74-4e7a-71d1-9331-d2320282370b

## Round 1 — Codex (VERDICT: REVISE)

Material flaws:

- Row-ID tokens use `${pdfFile.id}:${pdfId}` today, not Supabase UUID; server will mark valid old tokens foreign. Fix: define/migrate canonical Row-ID document id.
- Row-ID secret migration is still an open decision. Fix: split as pre-slice or make server-held signing mandatory before KAL-308.
- Supabase Vault access path is hand-waved. Fix: specify RPC/table/encryption path Edge can actually read and test.
- Edge validates outside the DB transaction, then RPC applies stale decisions. Fix: RPC re-locks/rechecks state/base hashes before writing.
- RPC can become a SECURITY DEFINER bypass if callable by clients. Fix: grant only Edge/service role or fully re-auth/re-validate inside RPC.
- Service-role RPC calls make `auth.uid()` ambiguous. Fix: choose caller-JWT RPC or Edge-only `actor_id`, not both.
- Plan writes `document_annotations`, but cloud survey markers hydrate from Yjs `surveyMarkers`. Fix: write durable Yjs ops or an accepted-op log clients commit into Yjs.
- Broadcast is not durable; Edge can commit then fail before send. Fix: store accepted ops/revisions transactionally; broadcast only a hint.
- `excel_sync_state` schema misses matcher fields: `fullRowFingerprint`, copy lineage, row positions, ingest seq, pending-delete state. Fix: mirror `excelSync` identity record exactly.
- `workbook_generation` PK is weak without registration FK/unique generation. Fix: key state by `workbook_registration_id` plus marker/scope.
- No concrete workbook revision storage/lock exists. Fix: add per-registration sync head row/column locked in RPC.
- Idempotency uniqueness is underscoped and race-prone. Fix: unique `(document_id, workbook_registration_id, client_change_set_id)` and lock replay rows.
- Shared-doc business-only gate is missing from KAL-308 acceptance. Fix: reject shared docs unless registry `capability_tier='business'` and Graph identity matches.
- `workbook_id` only has a non-unique index in KAL-307. Fix: add unique constraint before lookup-by-workbookId.
- Conflict detection needs current app values, not just stored fingerprints. Fix: server rebuilds `appNow` from current survey marker + template data.
- Excel schema changes/new columns are still client-modal logic. Fix: reject or resolve schema diffs before server apply.
- No-Row-ID legacy fallback would reopen name-match silent sync. Fix: legacy/unregistered/no Row-ID rows go review/re-export only.
- Delete semantics are underspecified versus current delete-grace/trash/bulk-confirm rules. Fix: implement exact server semantics or make deletes review-only.
- Field writes are not whitelisted. Fix: server maps only allowed marker fields, validates entities/checklist ids, ignores workbook audit columns for authority.
- Row-ID writeback after server-created rows is missing. Fix: return/persist verified writeback jobs with pending state.
- Document locks are bypassed by SECURITY DEFINER. Fix: RPC checks `kal49_document_is_locked()` before any write.
- Audit immutability is deferred to KAL-310. Fix: KAL-308 audit table has no UPDATE/DELETE policy from day one.
- Matcher "single source" is not proven for Supabase deploy. Fix: add Deno deploy/import smoke test and drift test if any shared copy exists.
- Observability is too thin. Fix: structured content-free logs/audit counts for auth, token, conflict, stale, latency, replay, broadcast/fetch gap.
- No payload/rate limits. Fix: cap rows/cell sizes and rate-limit per actor/document/workbook.

### Claude's response (round 1 → revision)

Ran a ground-truth code-verification pass before revising; it CONFIRMED Codex's load-bearing findings. Accepted 22 of 24 fully; scoped-back 2 deliberately (builder's-final-say):

ACCEPTED & incorporated into PLAN-KAL308.md:
- #7/#14 (Decision 0, the big one): VERIFIED markers persist via Yjs (`annotationDocSync`/`YDocProvider.jsx:835`), NOT `document_annotations`. Apply now targets a durable marker op-log; added a MUST-RESOLVE-BEFORE-BUILD step to pin which Y.Doc/update-log the client hydrates from, and an A/B apply mechanism (server-encoded Yjs update vs durable accepted-op log + client commit; B recommended).
- #1 (Decision 1): VERIFIED tokens sign over an arbitrary string id (`rowIdToken.js:115/:75`), not the UUID. Added canonical-signing-id resolution + legacy-token migration.
- #2/#3 (Decision 2/3): secret migration promoted to a hard PRECONDITION (pre-slice KAL-308a) with a concrete Vault RPC path + anon/viewer-reject test.
- #4 (TOCTOU): apply RPC re-reads + re-validates base hashes `FOR UPDATE` before writing.
- #5/#6: RPC EXECUTE granted to service_role only; explicit `p_actor_id`, no reliance on `auth.uid()`.
- #8: durable accepted result + `excel_revision`; broadcast is a hint; revision-gap fetch + open-time reconciliation recovery.
- #9/#10 (Decision 4): full excelSync field list mirrored (13 fields); keyed by `workbook_registration_id` FK, dropped bare `workbook_generation` PK.
- #11 (Decision 5): per-registration `excel_revision` head locked `FOR UPDATE`; idempotency UNIQUE `(document_id, workbook_registration_id, client_change_set_id)` + per-row op id.
- #13 (Decision 6): VERIFIED `workbook_id` only has a plain index; added a UNIQUE index (additive).
- #15/#16/#17/#18/#19/#20/#21/#22/#23/#24: schema-diff→review; never name-match; deletes review-only; field whitelist; writeback jobs; `kal49_document_is_locked` check (VERIFIED exists); audit immutable from day one; matcher Deno smoke+drift test; observability; payload/rate limits — all added.

SCOPED-BACK (not rejected, bounded with a logged reason):
- #12 (business-only gate): did NOT pull KAL-311's full registry gate into 308. Added the safe interim only — shared doc (`COUNT(active collaborators)>1`) + non-business registration → reject/review. The full gate stays KAL-311 per the V1 plan's slice split.
- #7 apply mechanism: did NOT hard-commit server-encoded-Yjs vs client-applied-op-log. The correct choice depends on the unresolved marker-engine-ownership question, so I pinned the requirement (durable Yjs convergence) and deferred the A/B mechanism choice to build step 0 with the ownership answer, rather than commit wrongly.

Re-submitting for round 2.

## Round 2 — Codex (VERDICT: REVISE)

Round-1 items mostly addressed. New/material gaps:

- Decision 0 still has no chosen apply mechanism; A and B have opposite authority models. Fix: choose one before plan approval.
- Option A cannot be atomic as written: Edge can encode Yjs, but RPC re-validates later. Fix: either generate the durable mutation after RPC acceptance, or drop A.
- Option B means clients, not server, author Yjs updates. Fix: make accepted-op log the declared authority, with Yjs as materialized cache.
- Option B lacks an "already applied" ledger; binary Yjs updates do not expose Excel opId. Fix: store applied excel_revision/opId in marker state or a DB ack table.
- Multi-client replay can double-commit same accepted op. Fix: deterministic op payload + idempotent client reducer keyed by opId.
- Whole-marker Yjs map.set can clobber concurrent app edits after server accept. Fix: accepted ops must be field-level patches merged against current marker state.
- RPC TOCTOU check only locks excel_sync_state + revision head, not current Yjs marker values. Fix: revalidate against a server-readable marker projection/version or move conflict check to the materialization step.
- New-row/create races are under-locked because no excel_sync_state row exists yet. Fix: lock the registration head before matching/apply and enforce create idempotency by row op id.
- Canonical Row-ID id is no longer unknown; code uses ${pdfFile.id || 'local'}:${pdfId || pdfFile.name || 'pdf'}. Fix: plan that exact value, not "if not UUID."
- Storing canonical Row-ID id conflicts with "only slice-1 touch is UNIQUE index." Fix: add explicit KAL-308a/308 migration path: registration column or side table + export call update.
- KAL-308a server signing cannot derive current canonical id unless it is stored. Fix: signing RPC signs only from stored registration canonical id, never caller-supplied id.
- Legacy Row-ID secret migration is still "review/re-export" but not operationalized. Fix: add preflight UX/test that detects old localStorage-signed active workbook and forces re-export/re-link.
- "Graph identity match" still sounds stronger than code can prove server-side. Fix: call it metadata equality unless server has trusted Graph read.
- Client commit path can fail after server accepted; reconciliation is named but not specified. Fix: define fetch API, replay order, and failure retry/backoff.
- excel_sync_state SELECT for viewers exposes assigned tokens/fingerprints. Fix: no direct SELECT, or redact via read RPC.

### Claude's response (round 2 → revision)

Accepted all 15. Round 2 converged on ONE hard area — Decision 0's apply mechanism — and drilled it correctly. Resolutions in PLAN-KAL308.md:
- Apply mechanism DECIDED: dropped Option A (can't be atomic with RPC re-validation); committed Option B — **accepted-op log + excel_sync_state is the server-authoritative durable truth; Yjs surveyMarkers is a materialized cache**. Field-level patches (not whole-marker map.set), idempotent client reducer keyed by (excel_revision, op_id), per-marker applied ledger (last_applied_excel_revision/op_id) + per-doc cursor.
- Conflict model made honest + two-tier: server best-effort against a new `app_now_field_fingerprints` projection (Decision 16); client materialize reducer does the FINAL field-level check against live Yjs. Server is authoritative for authorization + the durable log; conflict is best-effort+final-client. Stated the security wall is the actor-role check.
- TOCTOU + creates: apply RPC locks the per-registration revision head FIRST (serializes the whole change-set incl. creates), then FOR UPDATE per existing row; create idempotency by (change_set_id, op_id) UNIQUE.
- Reconcile API specified: `excel-sync-fetch-since(document_id, since_revision)` redacted read RPC → accepted ops in ascending revision order, idempotent apply, persisted cursor, capped backoff, replays missed ops on open.
- Canonical id: planned the EXACT value `${pdfFile.id||'local'}:${pdfId||pdfFile.name||'pdf'}`; stored as additive `rowid_signing_doc_id` column on the registration; signing RPC signs ONLY from the stored id (never caller-supplied); tokens not verifying under it → review.
- Secret migration: legacy preflight detection + forced re-export/re-link, with a test (KAL-308a).
- excel_sync_state: NO client SELECT/DML — service-role only; clients read via the redacted fetch RPC (never returns tokens).
- "Graph identity match" → "Graph metadata equality (best-effort hygiene)" everywhere; actor-role check is the wall.
- Slice-1 boundary updated: TWO additive touches (workbook_id UNIQUE + rowid_signing_doc_id column).

No rejections this round — all findings were material and correct.

Re-submitting for round 3.

## Round 3 — Codex (VERDICT: REVISE)

Round 3 fixed the big A/B ambiguity, but introduced a few plan-level consistency bugs:

- Accepted-op log is underspecified: excel_sync_audit + excel_sync_state cannot serve fetch-since because audit should be content-free and state is only latest. Fix: add dedicated excel_sync_ops table with ordered patch payloads; keep audit separate.
- Server marks rows applied and updates excel_sync_state before the client "final conflict" check may route to review. Fix: either server conflict decision is final, or excel_sync_state advances only after materialization ack.
- Two-tier conflict model lacks durable review status. Fix: define accepted → materialized | client_conflict_review state and how cursors behave when a client hits conflict.
- app_now_field_fingerprints requires clients to refresh excel_sync_state, but that table is service-role-only. Fix: add a service-role projection update RPC/Edge path on every marker materialization/save, or remove this projection.
- Applied ledger is only in excel_sync_state + local cursor; new/lost clients cannot idempotently replay from zero without clobbering later app edits. Fix: materialize applied (revision, op_id) into Yjs marker/meta too.
- Creates need deterministic server marker IDs in the op payload. Fix: RPC generates marker_annotation_id for create ops and every client uses that exact id.
- Plan still has stale text saying apply writes "Yjs op-log" and A/B resolved at build step 0. Fix: clean stale Decision 0/Risks language so implementers do not fork.

### Claude's response (round 3 → revision)

Accepted all 7 (one resolved by removal). Changes in PLAN-KAL308.md:
- Added dedicated `excel_sync_ops` table (Decision 16, fully repurposed): one row per accepted op, deterministic field-level patch payload, keyed (workbook_registration_id, excel_revision, op_id); the fetch-since source; service-role-only, no client SELECT. excel_sync_audit stays content-free (Decision 7 clarified); excel_sync_state stays latest-per-marker.
- Added materialization state machine: `materialization_status ∈ {accepted, materialized, client_conflict_review}` on excel_sync_state. Server sets `accepted` (never claims applied); client acks via service-role RPC → materialized | client_conflict_review (durable review, same item on every device). Cursor advances past processed ops; resolution tracked by status.
- REMOVED the round-2 server-side appNow projection entirely (took Codex's "or remove" branch — ponytail: it added a whole client→service-role write path and earned nothing since the client is already the final app-vs-Excel authority). Conflict split is now clean: server = Excel-vs-Excel TOCTOU on stored base fingerprint; client = app-vs-Excel against live Yjs. Dropped the app_now column.
- Applied ledger now also encoded into Yjs marker/doc meta (`excelApplied` map keyed by op_id) so a fresh/lost-cursor client replays from zero idempotently without clobbering newer app edits.
- Deterministic create ids: apply RPC mints marker_annotation_id for creates, in the op payload; all clients materialize the same marker.
- Scrubbed stale "write the server op into the Yjs op-log" + "A/B resolved at build step 0" language (Persistence reality, Decision 0, Risks). Build step 0 now only pins the client materialize target; mechanism is DECIDED = Option B.

No rejections. Re-submitting for round 4.

## Round 4 — Codex (VERDICT: APPROVED)

Sound enough to implement. Remaining items are build-time notes, not plan blockers:

- Put materialization status on excel_sync_ops or a per-op status table too; excel_sync_state is latest-per-marker and can lose historical review status.
- fetch-since should be scoped by workbook_registration_id or maintain per-registration cursors; document_id + since_revision is ambiguous if multiple template registrations exist.
- If a marker has unresolved client_conflict_review, block or review later Excel ops for that marker until resolved.
- Ack path should be explicit: client calls authenticated Edge/RPC wrapper; only that wrapper uses service role.
- Op payload must include enough for final client conflict check: field values, changed field keys, base fingerprints, marker id, and revision/op id.
- Response wording should distinguish accepted from materialized; otherwise UI may report applied before client conflict review finishes.
- Live trace for marker Y.Doc ownership remains mandatory step 0.

### Claude's response

All 7 build-time notes folded into PLAN-KAL308.md as a "Build-time notes" section (non-blocking, honor during build). CONVERGED after 4 rounds. Awaiting human gate #2 (Isaiah's go) before any code.

## RESULT: APPROVED (4 rounds). Plan ready to implement on Isaiah's sign-off.

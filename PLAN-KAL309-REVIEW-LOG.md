# Plan Review Log: KAL-309 — keystone implementation spec

Started 2026-06-24. MAX_ROUNDS=3. PLAN_FILE=PLAN-KAL309.md. Builder=Claude, critic=Codex (read-only).
Prior: a workflow (kal308-keystone-understand) mapped live code + ran an adversarial pass; 14 findings (F1-F15, F0 dismissed) already folded into PLAN-KAL309.md "Critique resolutions". Codex here stress-tests the resolved spec.

Codex thread: 019efc54-86e9-7ca2-8049-8150886d15b4

## Round 1 — Codex (VERDICT: REVISE)

- F1/F2 not integrated into BODY: DDL/RPC/fetch still add excel_revision to registration + FK ops/state/audit to registration → re-export still strands state. Rewrite body around excel_sync_head(document_id, template_id); registration = validation metadata only.
- D.1 sends workbookRegistrationId but Edge expects workbook_id; sync token never validated. Send workbook_id + sync_token from metadata; Edge validates hash/expiry/active row.
- p_actor_id passed then ignored; role checks use auth.uid() under service-role path. Use actor-aware SQL role check by p_actor_id in Edge/RPC/audit.
- No server bootstrap for excel_sync_state; first apply has no trusted baseline. Export/re-export must seed/upsert server state for every exported marker.
- Idempotency only persists accepted ops; review/conflict/zero-write replays not replay-safe. Add change-set/outcomes table with request hash + ALL row outcomes + writeback jobs.
- Create writeback token contract broken: RPC mints marker id, Edge owns HMAC secret, assigned token not atomically stored. One server owner mints id+token and persists token before broadcast.
- V1 materialize race is real data loss: whole-marker map.set overwrites concurrent field edits. Per-marker mutex + re-read/retry before write (or nested field CRDT).
- excelApplied:op_id unsafe; op_id not globally unique, max-applied cursor skips unresolved conflicts. Key cursor by op UUID or (template_id, excel_revision); advance only contiguous handled ops.
- Ack under-scoped; later apply can unstick conflict-review. Ack by op UUID/revision; apply blocks same-marker ops while conflict open.
- Server whitelist claims trusted template validation but RPC has no trusted template source. Load template server-side by active registration/template_id.
- Audit immutability fix not in concrete DDL. Add BEFORE UPDATE OR DELETE trigger.
- Minor DDL bug: actor_id NOT NULL ... ON DELETE SET NULL. Nullable actor or ON DELETE RESTRICT.

### Claude's response (round 1 → revision)
Dispatching a focused rewrite: make the plan BODY (A-E) consistent with the resolutions AND integrate the new findings (token validation, actor_id role check, server-side excel_sync_state seeding at export, change-set outcomes table, atomic id+token mint, mutex+retry materialize, op-UUID cursor, conflict-blocking ack, server template source, audit trigger DDL, actor_id FK). Then re-review + re-Codex.

## Round 2 — Codex (VERDICT: REVISE) — narrowed to 4 blockers

- Apply RPC: idempotency replay check happens BEFORE role check + before head lock → unauthorized p_actor_id could read stored writeback_jobs; concurrent-duplicate race. Fix: actor check FIRST, then lock excel_sync_head FOR UPDATE, then re-check changeset (or insert a processing placeholder).
- Cursor still inconsistent: says conflict ops don't advance, but derives the persisted cursor as max-applied-revision → a later op after unresolved rev N skips N on reopen. Fix: persist excelSyncFrontier:{templateId} separately, advance only over CONTIGUOUS handled ops; store conflict-review as durable handled/review meta.
- Uses registration.generation/id, but kal307_register_workbook return is unchanged ({workbookId,syncToken} only). Fix: seed/setter/persist RPCs take workbook_id and derive active id/generation server-side (lookup active row WHERE revoked_at IS NULL).
- "Only explicit resolution clears client_conflict_review" but no resolve RPC/path exists → permanent blockers. Fix: add kal309_resolve_materialization_conflict(op_uuid, resolution) + wire the existing review UI.
- Build notes (NOT blockers): F21 best-effort template validation acceptable for V1; F9 residual in-process materialize race honestly scoped.

### Claude's response (round 2 → revision)
Continuing the rewrite agent with the 4 fixes (RPC order: actor→head-lock→replay; contiguous frontier; workbook_id-derived registration lookup; resolve-conflict RPC + UI wiring). Then re-Codex round 3.

## Round 3 — Codex (VERDICT: APPROVED)
Replay is auth+lock guarded; frontier single/contiguous; client no longer needs registration id/generation; conflict resolution exists. Build notes: re-verify workbook_id↔doc/template on generation derive; idempotent persist_created_token + writeback dedupe; take-excel reload-safe re-materialize; Edge tests use the KAL-308a secret-read pattern exactly. F21/F9 accepted V1 risks.

## RESULT: APPROVED (3 rounds + workflow critique). PLAN-KAL309.md ready to build.

## Migration SQL code-review — Codex (VERDICT: REVISE) — 9 bugs (structure OK)
Codex thread: 019efc7c-fee2-7b22-908c-8422c05fac98
Checked OK: variable_conflict coverage, apply step-order (no pre-auth read), idempotency/head-rollback, audit trigger blocks UPDATE/DELETE through definer, grants/signatures (apply+persist service-role only).
Bugs:
1. rowid_signing_doc_id assumed but never added (308a put signing_doc_id on rowid_signing_secrets, NOT on registrations). ADD COLUMN IF NOT EXISTS.
2. raw v_row stored in patch_payload → assignedToken can leak via fetch_since. Sanitize/strip token fields before insert. [SECURITY]
3. create op doesn't stamp minted markerAnnotationId into patch_payload. jsonb_set for creates.
4. v_base_fields computed but never compared → field-level TOCTOU passes. Compare changed-field fingerprints vs v_state.field_fingerprints.
5. structural whitelist unused → arbitrary field patches pass. Enforce allowed keys (+entity/checklist), full-template stays best-effort F21.
6. shared-doc gate trusts client p_capability_tier='business'. Derive capability/graph ids from the REGISTRATION row. [SECURITY]
7. stale ack for older op overwrites current state + clears newer conflict. Update only WHERE last_applied_op_uuid=p_op_uuid.
8. take-excel sets op 'resolved' → reload won't re-apply. Set back to 'accepted' or persist reapply intent (build note 3).
9. UUID regex accepts junk → cast aborts whole RPC. Strict UUID validate / safe-cast → route invalid to review.
10. persist_created_token appends writeback job even when no state row updated. Check rowcount/FOUND first.

### Claude's response: sending all 10 fixes to the migration agent, then re-Codex.

## Migration SQL code-review round 2 — Codex (VERDICT: REVISE) — 4 refinements
Confirmed OK: rowid_signing_doc_id ALTER, safe_uuid strict, persist rowcount guard, take-excel→accepted, grants, no unqualified refs.
1. sanitize over-strips baseFingerprints (client D.3 needs it for app-vs-Excel conflict). Keep baseFingerprints; strip only token/secret.
2. missing/non-array changedFieldKeys still applies. Route to review unless it's an array (apply).
3. p_template_config still unused. When non-null, validate entity/answer ids against it; structural otherwise (F21).
4. stale ack can flip an old op to client_conflict_review while the state guard skips → pre-gate misses the open review. Guard op_status change with last_applied_op_uuid=p_op_uuid too.
### Claude's response: sending 4 fixes to the agent, then re-Codex round 3.

## Migration SQL code-review round 3 — Codex (VERDICT: APPROVED — safe to apply to survey-test)
4 refinements confirmed fixed; only a stale comment nit (fixed). Migration is Codex-clean as code; node suite 1625/0. Pending: apply to survey-test (needs account token) + integration tests, after the Edge fn + client are built.

## Edge fn code-review round 1 — Codex (VERDICT: REVISE) — 5 data-threading bugs (security core OK)
Checked OK: JWT auth rejects anon/service/invalid before body parse; p_actor_id=user.id; active registration hash/doc/template/revoked/expiry validated before secret/RPC; RPC arg names/types match; broadcast content-free.
1. replay skips token persistence → retry after partial persist can broadcast with missing writeback_jobs. On replay, persist missing create-token jobs before broadcast.
2. client fallback trusts rowIdToken as markerAnnotationId (UUID bypasses HMAC). Verify server-side or force fallback rows to review.
3. matcher path sends fields:null for apply/create. Attach visible row values as `fields`.
4. sends INCOMING fingerprints as baseFingerprints → real edits false-stale. Pass the matched STORED/export baseline fingerprints.
5. hyphen scopeKey collision → opId collisions/wrong-scope. Use real scopeId + collision-free tuple keys.
### Claude's response: sending 5 fixes to the Edge agent, then re-Codex.

## Edge fn code-review round 2 — Codex (VERDICT: REVISE) — 1 finding
Confirmed OK: replay token persist before broadcast; fallback→review; visible fields attached; base/incoming fingerprints separated; RPC args match; auth/registration/secret/broadcast safe.
- scope collision not fully fixed: matcher (buildScopeImportPlans.js) still keys/overwrites plans by `${moduleId}-${categoryId}` (ambiguous; ids can contain '-'). Fix at the source: collision-free key + carry scopeId/worksheet metadata in the plan value; consumers read value.scopeId, never parse the key.
### Claude's response: fixing the matcher's plan-Map key (shared src/services + re-sync guarded copy + update both consumers), then re-Codex.

## Edge fn code-review round 3 — Codex (VERDICT: APPROVED — safe to deploy)
Scope-key collision fixed at source (scopeKeyFor → JSON.stringify([m,c]); plan values carry scopeId/moduleId/categoryId; consumers read the value). Build note: scopeId stays the colon-joined contract. The keystone SERVER SIDE (migration + Edge) is Codex-approved as code.

## Client cutover code-review round 1 — Codex (VERDICT: REVISE) — 7 findings
OK: local-only/unregistered falls through; server rejection handled/no inline apply; TDZ avoided by refs.
1. excelSyncClient.js:562 answer conflicts missed — base fields nest as fields.answers[id], code checks fields["answer:id"]. Read nested; compare via fingerprinting.
2. :420 reducer ignores op_status — resolved keep-app/merged re-apply; client_conflict_review materialized. Normalize; halt on conflict-review; advance-without-overlay on resolved.
3. :408 frontier advances without contiguity check. Require excelRevision===frontier+1; break/retry on gaps.
4. index.ts:343 create rows send changedFieldKeys:[] → blank markers. Send all row field keys for create (or reducer treats create as full-row apply).
5. :629 created marker lacks moduleId/categoryId + excelSync identity (export/UI filter by these). Include moduleId/categoryId/identityRecord in create payload + stamp on create.
6. PDFViewer.jsx:12215 D.6 export seeding ABSENT — registers workbook but never seedSyncState/setRegistrationSigningId → first server import reviews everything (no baseline). Wire both on export success.
7. PDFViewer.jsx:13732 writebackJobs + tokenWritebackIncomplete ignored. Retry same clientChangeSetId on incomplete; enqueue/stamp writeback jobs before success.
### Claude's response: sending 7 fixes to the client agent; re-verify in MAIN (worktree lacks yjs) + re-Codex.

## Client cutover code-review round 2 — Codex (VERDICT: REVISE) — 4 findings
OK: single-marker overlay, contiguous frontier/HALT, registered returns before inline apply, unauthorized/locked no fallthrough.
1. excelSyncClient.js:564 app-side CLEAR not a conflict — liveVal null/'' skips before baseline diff → Excel overwrites a user's clear. Only skip when live-blank matches the base fingerprint.
2. PDFViewer.jsx:13817 after 3 tokenWritebackIncomplete retries still fetches/materializes with no durable token. Surface retry-needed + return before fetchSince.
3. PDFViewer.jsx:13888 writeback enqueue keyed by Supabase documentId, but flushers (15667/16191) read the composite rowIdDocumentId key → never drained. Use the same rowIdDocumentId.
4. index.ts:542 + PDFViewer.jsx:13888 writeback_jobs lack sheetName/rowLocator/expectedOldCellValue → drains mark invalid-entry. Carry sheet name + true sheet row through; enqueue full queue schema.
### Claude's response: sending 4 fixes to client agent; consolidate v3 to main + re-verify + re-Codex.

## Client cutover code-review round 3 — Codex (VERDICT: REVISE) — 2 replay-path findings
Everything else OK: clear-conflict gate, reducer/frontier, no double-apply, queue key + full-entry shape for non-replay success.
1. index.ts:491 replayed writeback_jobs (from DB) lack jsonIndex → PDFViewer enqueues rowLocator:null → drain invalid. Enrich startingJobs from the freshly-computed pRows (Edge ran the matcher even on replay), match by markerAnnotationId.
2. PDFViewer.jsx:13791 after retry-cap return, clientChangeSetId is lost → "sync again" mints a NEW change-set, not an idempotent replay. Persist pending {documentId, templateId, workbookId, clientChangeSetId} until token writeback completes; reuse then clear.
### Claude's response: sending 2 fixes; consolidate v4 + re-verify + re-Codex (last loop).

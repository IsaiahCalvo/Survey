# Plan Review Log: Excel Sync Security V1
Act 1 (grill) complete — plan locked with the user. MAX_ROUNDS=5.
PLAN_FILE=PLAN-EXCEL-SECURITY-V1.md (deviation from skill default: root PLAN.md is the governing Excel-sync contract and is never overwritten by review loops — standing project rule).

Grill decisions:
1. V1 scope = secure pipes first (server validation + workbook token + audit + SharePoint stamping); add-in = V2. Multi-user Excel collab restricted to M365 business storage in V1 — blocking confirmed feasible (capability probe + server-side ingestion gate).
2. One live workbook per survey; re-export retires prior copies; unshare strips cloud access immediately.
3. Role names stay owner/editor/viewer ("contributor" was a misnomer — Isaiah's correction).
4. In-app permission flip (editors+owners edit/delete all content) rides in the same wave, gated behind trash-for-all-types.

## Round 1 — Codex
Material issues:

- `syncToken` reuses Row-ID secret, but Row-ID secret is localStorage-only; server cannot validate it. Fix: server-mint workbook tokens; secret in Supabase/Vault; store only hash + expiry + revocation.
- Copied `.xlsx` carries same `workbookId/syncToken`; "one live workbook" not enforceable. Fix: bind business workbooks to Graph `driveId/itemId`; local copies go review/relink only.
- Edge validates, renderer applies. Non-atomic; races after validation. Fix: Edge/RPC applies accepted changes + audit + revision transactionally.
- Canonical store gap: current truth is Y.Doc/annotation updates, not just `document_annotations`. Fix: define how server writes/broadcasts Y.Doc-equivalent ops.
- Payload trusts `changedFields/trashState`. Fix: client sends full row + base hashes; server recomputes diffs/deletes.
- No idempotency key. Retries can duplicate creates/audit. Fix: `clientChangeSetId` + per-row op ids + unique constraints.
- Global `lastKnownServerRevision` too coarse. Fix: per-row/per-field base hashes plus monotonic Excel revision.
- `excel_sync_state` schema deferred and keyed only by annotation id. Fix: choose table now; key by doc/template/scope/marker/workbook generation; retain tombstone baselines.
- Existing matcher violates paste-above review rule; first row wins. Fix: fix matcher/tests before server port.
- "Append-only" audit table allows owner delete. Fix: remove DELETE policy or separate immutable security audit table.
- Business-only gate cannot trust client capability probe. Fix: registry stores trusted capability/file identity; Edge gates from DB/server proof.
- Graph ACL "same moment" unrealistic. Fix: desired-ACL table + retry worker + drift scan; server revocation immediate.
- Viewer read access leaks active workbook token via download. Fix: rotate workbook token on every role/share change; issue per-user sync grants.
- Local "own-machine" cannot be server-enforced. Fix: define as unshared + authenticated owner/editor only; no device-security claim.
- Trash-for-all-types is underspecified. Fix: separate prerequisite design per annotation type, restore payload, retention, tests.
- Permission flip only mentions `document_annotations`; Y.Doc/binary update path and UI gates remain. Fix: update all write surfaces and add role tests.

VERDICT: REVISE

### Claude's response (round 1)
Accepted outright (plan revised): server-minted tokens with vault-held secret + hash/expiry/revocation (step 1); Graph driveId/itemId binding for business registrations, local copies review/relink-only (step 1); transactional server-side APPLY of accepted rows (step 2); full-row payloads with server-recomputed diffs — no trusted client diffs (step 2); clientChangeSetId + per-row op ids + unique constraints (step 2); per-row base hashes authoritative with monotonic revision as fast-path only (step 2); excel_sync_state schema decided NOW — separate table, composite key incl. workbook_generation, tombstone baselines (step 4); paste-above matcher fix promoted to PRECONDITION of the server port (step 2 + risks); immutable audit with no delete for security events (step 5); registry-based capability proof — server never trusts per-request client claims (step 6); async desired-ACL worker + drift scan with immediate server-side revocation (step 7); own-machine defined as unshared + authenticated owner/editor, no device claims (step 6); trash prerequisite gets its own design doc (step 10); permission flip explicitly covers client gate + RLS + collaborative channel + UI with role-matrix tests (step 11).

Accepted with reframing: Y.Doc canonical-store gap — V1 ships an explicit "local-truth bridge": server apply is authoritative for Excel-origin changes, submitting client applies accepted ops to the live doc on response, open-time reconciliation repairs crash-window divergence; full server-side Yjs authority is explicitly out of scope (persistence rebuild, KAL-263/270) and this design must not preclude it (new step 3). Viewer token leak — agreed token rotates on share/role changes (hygiene), but clarified the token was never bearer authorization: the actor-role check is the wall, so a viewer holding the token is rejected regardless; per-user sync grants noted as the revocation primitive (steps 1, 6, 8).

Rejected: none — all sixteen findings had substance; two were reframed rather than adopted verbatim (above).

## Round 2 — Codex
Round-1 mostly addressed. Still material gaps:

- `Local-truth bridge` still relies on submitting client to update live doc; crash/stall leaves open clients stale until reopen. Fix: server broadcasts accepted ops/revision; all clients apply server event, reconciliation only backstop.
- Business "copied workbook cannot sync" still overclaims unless server proves source file, not request metadata. Fix: server verifies against registered Graph item via trusted Graph read/file-revision lease.
- Token rotation on share/role change not operationalized; active workbook token becomes stale. Fix: mark sync suspended, patch new token with readback or force relink; salvage queued edits.
- ACL source says "project share-list," but document access uses `document_collaborators status=active`. Fix: desired ACL must come from effective document access, same source as `user_can_access_document`.
- Legacy migration still only "prompt re-export"; root `PLAN.md` requires snapshot/quarantine first. Fix: add migration preflight before V1 gate touches existing linked docs.
- External-edit review depends on "planned unplaced-rows surface." Fix: make null-marker/unplaced review surface a precondition for detector routing.
- Re-link by any editor can retire team workbook. Fix: owner-only, or explicit lease/confirm/audit on workbook replacement.
- Add explicit tests for copied-workbook Graph mismatch, token rotation, ACL drift, crash-before-live-doc-apply, legacy preflight.

VERDICT: REVISE

### Claude's response (round 2)
Accepted outright: server broadcasts accepted change sets on a realtime channel, all clients apply idempotently by op id, reconciliation demoted to backstop-only (step 3); token rotation operationalized — suspend → in-place token patch via the dormant single-cell Graph writer + readback → owner re-link on failure, queued edits preserved and resubmitted (step 1); ACL source corrected to effective document access / active collaborators, same source as the access function (step 7); legacy preflight snapshot/quarantine per the root contract's backup rule before the gate touches existing linked docs (risks); unplaced-rows surface (KAL-292) promoted to PRECONDITION of detector routing (step 12); owner-only workbook re-link/replace with confirm + audit, editors get a request path (step 1) — consistent with the owner-manages-distribution stance, flagged for Isaiah at sign-off; explicit test matrix added as step 13.

Accepted with honesty adjustment: copied-workbook detection reworded from a guarantee to best-effort policy hygiene (Graph identity + eTag at submission) — the server cannot independently read Graph today (token custody is client-side); full server-side file verification arrives with the planned server relay (secret-rotation workstream). The security wall remains the actor-role check, which a copied workbook never bypasses.

Rejected: none.

## Round 3 — Codex
Round-2 findings: addressed.

Remaining small fixes, not blockers:

- Goal still says ACLs come from "project share list," but step 7 correctly says effective document access. Fix: update goal wording to match step 7.
- Server broadcast bridge needs missed-event recovery, not only open-time reconciliation. Fix: clients track Excel revision; on reconnect/gap, fetch/reconcile missed accepted ops.
- Copied-workbook detection is now honest: best-effort policy hygiene, not security wall. Fine, since actor role remains wall.
- Token rotation/relink, owner-only replacement, legacy preflight, unplaced-row surface, test matrix: addressed.

VERDICT: APPROVED

### Claude's response (round 3)
Both non-blocker fixes applied before sign-off: goal wording aligned to effective document access; missed-event recovery added (clients track per-workbook revision, fetch missed accepted ops on reconnect/gap, open-time reconciliation remains backstop). CONVERGED in 3 of 5 rounds. Awaiting Isaiah's final sign-off.

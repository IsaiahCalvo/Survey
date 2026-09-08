# Non-Microsoft data hardening — 2026-09-08

## Scope and status

Local work starts at `49ee7b6a` (draft PR #803), on
`codex/non-ms-data-hardening-20260908`. This is a tested-step build, not a claim
that all performance limits or regression risks have been removed. Microsoft
365 trials, live workbook testing, and automatic Excel writeback remain deferred.

## Acceptance criteria

- Given no local edits, closing a cloud document sends no full snapshot write.
- Given a failed or still-pending checkpoint, closing preserves queued edits and
  captures any newer accepted local work; explicit Save still forces a checkpoint.
- Given a failed shared-membership lookup on any page, keep the last full library
  and expose a retryable error rather than publishing an owned-only success.
- Given a last-annotation deletion or undo, the viewer and its exact tab agree on
  the dirty state. Window close checks inactive local tabs too.
- Given an already-mounted, healthy cloud document for the same actor, activating
  that tab requires no repeated PDF download. New opens and failed-load recovery
  retain their normal storage reads. Old account callbacks cannot open files.
- Given a retry of an existing document upload, write to the resolved row's exact
  path, including legacy paths. Archive a replaced version only after upload succeeds.
- Given a delayed tool-setting write, bind it to its original actor and document;
  pending drafts must survive close/reopen and old replies must not clear newer work.
- Given a delayed project sidecar read, an old document/account/canceled load may
  not restore data or view state into the current document.

## DO NOT CHANGE

No Microsoft code, auth bypass, account provisioning, paid plans, RLS changes,
data deletion, history pruning, or automatic cloud/local migration. Preserve
annotation geometry, SVG scaling, zoomGeneration, cloud document identity, and
all unfinished work in other worktrees.

Allowed files: small data/open/save hunks in AppShell, Dashboard, PDFViewer,
useDatabase, annotationDocSync, supporting scoped data helpers, and focused tests.
Keep the existing main actor-scoped outbox; do not replace it with a weaker queue.

## Measured checks

- Before this batch: `npm test` exited 0; 4,111 tests, 4,057 passed, 54 skipped.
- Close checkpoint tests exercise real Yjs and queue logic behind a fake database:
  an unchanged close goes from one full snapshot write to zero. Already-saved
  closes also avoid a duplicate snapshot. This is a request-count result, not a
  measured production billing reduction.
- Existing healthy-tab activation goes from one PDF download to zero in the
  application-handler test; no new access grant or cross-account file reuse.
- Browser fixture: local quota failure kept the dirty marker and another backup;
  Save retry cleared the marker. A real PDF form-field edit survived Save and a
  full page reload. No real account or cloud writes were used.
- Native Electron fixture: atomic write, quota failure, quit veto beyond the old
  five-second timeout, and successful Save retry passed with a test-owned profile.

## Live database read-only sample

At 2026-09-08 01:57:42 UTC, the Survey project was `ACTIVE_HEALTHY`.
Approximate total relation bytes: document_annotations 202,776,576;
annotation_updates 24,100,864; doc_yjs_state 18,554,880. These are not billing
totals. Current table counters and accumulated query statistics were read only;
statistics were not reset, and no index or cleanup job was changed.

Old cumulative query timings cannot show this batch's savings. Keep measuring
per-flow read counts, bytes, local commit times, pending-write age and restore
results before adding indexes or changing retention. The Supabase best-practices
review supports query-plan evidence, not speculative extra indexes.

## Still required after this slice

1. A real local document library with stable identity, offline import/reopen,
   explicit cloud publishing and clear local-versus-cloud save status.
2. Transactional snapshot storage and safe copy/verify migration of old backups.
   Do not assign ambiguous name/size backups to an arbitrary account or delete them.
   Async saves need a pending-save quit contract before replacing sync localStorage.
3. Legacy Y.Doc account scoping and initial follower state exchange. Do not expand
   cross-tab broadcasts until actor isolation and pending-data migration are tested.
4. Explicit offline cloud-access policy and reconnect/revocation tests. Do not
   remove the cloud-open permission gate just to make offline opening appear to work.
5. Durable upload status, bounded cache budgets, cold-offline app startup and
   staged large-library rendering; recovery and restore drills before retention.
6. Live multi-user role/account-switch checks with exact leased test identities.
   Microsoft Business workbook round trips remain a later, separate test phase.

## Review and verification log

The independent review caught a draft-loss case in the first preference timer
cleanup: a close before debounce followed by reopen restored an older cloud
value. The pending-draft fix passed that reproduction plus failed/zero-row writes,
old acknowledgments, account switches and quota failure. Save errors now reach
the viewer's toast. A shared client/actor/document write queue preserves ordering
across remount; settled entries are released. A queued old draft also rechecks the
persisted revision before sending. These are not cross-device conflict guarantees.

The sidecar scope/cancellation guards are implemented. First-page loading still
waits for its initial restore: moving it later without per-field edit generations
could replace a user's newer zoom, page or entity changes. That deferral is not
claimed complete.

Frozen combined suite: 4,157 tests, 4,103 passed, 54 skipped, zero failures or
cancellations, exit 0. Fresh production build passed. The final native Electron
run passed atomic writes, quota preservation, quit veto and retry. The frozen
browser route rendered the PDF/form and retained an edited form field after Save
and reload. The code graph was refreshed with AST-only extraction (no model/API
cost); generated graph artifacts remain outside the code commit.

Browser QA also observed that Cmd+S is ignored while a form input has focus;
leaving the input allows Save and reload to succeed. This is a separate keyboard
save-path follow-up, not evidence that the shortcut works from every input. No
live multi-user, Microsoft, deployed revision or production savings proof is
claimed. No rollout is included in this slice.

## Next staged implementation: safe native exit before async snapshots

Read-only follow-up found that the current main-process quit handler still relies
on a five-second timer, ignores positive acknowledgments, and allows a repeated
quit request through while `isQuitting` is already true. The existing failure
veto remains tested, but is not a complete asynchronous-save contract.

Before switching large snapshots to IndexedDB:

- Aggregate local-save results from all PDF tabs in AppShell, including inactive
  tabs. Reply once per editor window, with a quit attempt and renderer generation.
- Validate the IPC sender and exact participant set in a main-process coordinator.
  Home-only editor windows can report an empty set; print/OAuth windows do not
  participate. Missing or crashed editor windows cannot count as saved.
- Block repeated quit attempts until a specific attempt reaches a safe state.
  Timeout cancels quitting and reports failure; late replies cannot restart it.
- Acknowledge committed local revisions only; newer edits must remain pending.
  Do not wait for cloud requests to call the local save complete.
- Route normal window close and both updater restart paths through this check.
  Direct quitAndInstall can close windows before the normal before-quit event.
- Test two tabs, multiple editor windows, no reply, failure, wrong sender, stale
  reply, repeated Cmd+Q, new edits during save, crash/reload and home-only exit.

This protects app-controlled exits, not process kills or power loss. Continuous
transactional persistence remains required. No quit-coordinator code is included
in this first slice.

## Sources

- [IndexedDB transactions and upgrades](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
- [Postgres index guidance](https://supabase.com/docs/guides/database/postgres/indexes)
- [Electron app lifecycle](https://www.electronjs.org/docs/latest/api/app)

## Rollback

Code rollback must keep unsent drafts, backups and outbox records. No live schema
change or deletion is part of this slice. Older clients may not read a new pending
draft format, so resolve or migrate pending work before downgrading those clients.

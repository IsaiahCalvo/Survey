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

## Follow-up batch: local writes and Save focus

The local annotation backup now compares freshly serialized content with the
exact stored key. Three identical saves produce one `setItem`, down from three.
This avoids duplicate writes after the automatic mirror without deferring a
changed edit. There is no object-identity cache: nested mutations still serialize,
and removed or replaced storage entries still get written. Read failure falls
back to the prior write attempt; failed writes preserve the last saved copy.

The main viewer keyboard effect now belongs only to the active tab. Hidden tabs
previously handled the same Save event, causing extra writes and saves of other
documents. Cmd/Ctrl+S now also works with a PDF form field focused. Tool shortcuts
retain their typing guard, and Save does not interrupt input composition.
The native PDF zoom listener now also belongs only to the active tab; its
regression test reproduced hidden tabs zooming on each native zoom event.

The 19 focused tests passed, including the failures reproduced before the patch.
An independent read-only review found no blocker in these two changes. Browser
QA on the local four-canvas PDF form fixture confirmed focused Cmd+S emitted one
successful local manual save with no cloud write; the entered field value
survived reload. The fixture's blank value was restored. This is local evidence,
not a deployed or live collaboration result.

The existing transactional annotation outbox was inspected before considering a
new local snapshot store. It is currently tied to cloud document and actor IDs,
while local-only files still use a legacy file-derived identity. Reusing it needs
an explicit identity and recovery migration, not a second uncoordinated store.
No local data was migrated or deleted in this batch.

### Native exit implementation in the follow-up batch

Native exit now uses one main-process coordinator and one AppShell response per
editor window. Every open PDF tab, including inactive tabs, must save and confirm
the same revision. Sender, renderer generation, attempt and participant checks
reject stale, duplicate and wrong-window replies. The timeout cancels exit;
repeated quit requests cannot bypass a pending save. Print and OAuth windows do
not stand in for document windows.

Normal window close and both updater restart paths use the same check. Failed
exit calls and later updater errors cancel the confirmed attempt, release input,
restore the app menu and restore unload warnings. The packaging list includes
the new main-process helper so packaged builds can load it.

The viewer writes the existing annotation backup and verifies existing legacy
backup formats. It checks the captured document/account/content revision again
before acknowledgment. Native form blur uses React's synchronous commit path;
unfinished text, drawing or erase work can veto exit instead of being discarded.
Locked clean tabs issue no writes; locked dirty tabs veto exit.

Current limits are deliberate and must remain visible before rollout:

- Idle drawing tools can require switching to Pan before exit, even without an
  in-progress stroke. This conservative gate is not a zero-regression UX claim.
- Pending or unverified cloud metadata can block offline exit. A disabled tab's
  `idle` status is not proof of persistence; the receipt work below is still needed.
- Existing backup keys and local file identity are unchanged. This does not add
  a full local-only document library, bytes store or migration.
- The handshake does not protect process kills or power loss, and this batch
  does not prove real-account collaboration or deployed behavior.

Follow-up verification on frozen product files: 4,194 tests, 4,140 passed,
54 skipped, zero failed or canceled, exit 0. The production build passed. The
root agent repeated the isolated Electron fixture successfully: atomic IPC
writes, quota preservation and quit veto, Save retry, focused field immediate
quit/relaunch with exact value restoration, and home-only quit. The fixture
captures the native dialog call and chooses its sole Keep open action; it is not
a visual audit of the operating system's dialog. Frozen browser QA also retained
the focused-field value through reload with no page errors and restored the
fixture's blank value. No real auth, Microsoft or cloud write was part of these
fixtures. Generated graph files and diagnostic logs remain outside the commit.

### Next offline gate: a local-only durability receipt

The queue's IndexedDB `put()` resolves after transaction completion, but the
same interface can silently use an in-memory fallback. A receipt must name its
persistent storage capability; an in-memory result cannot prove crash recovery.
Waiting for pending writes alone also misses accepted remote updates that have
not yet reached the local accepted-state journal.

The proposed next step reuses the existing stores: track local write completion
apart from the network queue, checkpoint only the accepted Y.Doc, read accepted
and pending records plus their scope/incarnation in one transaction, and prove
that a fresh reader can restore the captured revision. Optimistic or quarantined
edits must never be copied into the accepted checkpoint. Changed scope or content,
failed storage, or unresolved dependencies must invalidate the receipt.

Inactive tabs need a retained receipt from their old scope. The existing close
path must still seal the old writer immediately; delaying that seal until local
storage finishes could leave two writers active after a quick tab switch. A
separate local-close promise can finish before the existing network teardown.
The native close gate must compare the receipt with the tab's current revision,
not the disabled hook's reset `idle` status.

### Implemented: local receipts and offline native exit

The third batch implements that receipt using the existing actor-scoped outbox.
It tracks local writes apart from cloud requests, checkpoints accepted state
only, and reads checkpoint, pending, accepted, quarantine and incarnation records
in one transaction. Detached Yjs recovery must cover the captured edits and
deletions. Memory fallback, missing predecessors, quarantine, storage failures,
permission rejection, purge and changed revisions cannot report success.

Inactive tabs retain an identity-bound close receipt. Their writer seals at once,
while a separate local-close promise can finish before network teardown. Before
native quit, inactive tabs re-read through a fresh, read-only IndexedDB connection.
This catches a purge, missing database or replaced bytes from another browser
context without rewriting a checkpoint or contacting the backend. Final checks
bind the original proof to the current document, actor and visible state.

The native viewer now asks for local proof instead of requiring a healthy, idle
cloud queue. It still checks unfinished edits, pending legacy survey propagation,
tool preference failures, existing backup formats and the complete viewer
revision. Locked clean tabs remain a zero-write path. This supersedes the earlier
cloud-idle gate; it does not grant offline access or replace permission checks.

The accepted checkpoint also skips byte-identical writes inside its existing
incarnation-checked transaction. Measured: one initial checkpoint put, zero extra
puts for two unchanged receipt checks plus clean close. All three proof reads
still run. New accepted keys and changed bytes still write and compact atomically.

Frozen third-batch verification: 4,269 tests, 4,215 passed, 54 skipped, zero failed
or canceled, exit 0. Production build passed. Real mounted hook plus actual sync
and outbox integration tests cover changed values, last-object deletion, inactive
revalidation and second-connection purge. The isolated browser fixture uses real
IndexedDB and Yjs with a blocked backend stub: active save, fresh recovery,
delete invalidation, local close before cloud completion, retired read-back and
cross-connection purge veto all passed. The native Electron fixture again passed
atomic writes, quota preservation, quit veto, Save retry, focused-field immediate
quit/relaunch restoration and home-only exit. No real account or cloud write was
used. This is not production or live multi-user proof.

Browser QA found and reproduced a further manual Save timing issue: a 400 ms
form-input timer could run after Cmd+S saved an older React snapshot, leaving the
tab dirty until a second Save. Save now flushes this viewer's pending field values
first, then reads the current annotation ref. It preserves input focus and cancels
the timer. Pending fields and retained callbacks cannot cross documents/accounts;
an old Save callback cannot flush or write through a newer document's ref. Locked
Save remains a zero-flush, zero-write path. Browser QA confirmed a single immediate
focused Save stays clean after the old timer window and restores the exact value
after reload. The isolated context was discarded after testing.

### Measured verification cost and bounded cache

Fresh persistence proof originally reconstructed two detached Yjs documents for
every call, even when their exact persisted inputs had not changed. A single-entry
cache per handle now avoids only that repeated reconstruction. It compares the
captured update, freshly read checkpoint and record bytes, keys, scope, status,
dependencies and deferred-publication flag. It does not use a hash or trust object
identity or a revision alone. All storage reads and scope/incarnation/quarantine/
dependency checks still run. Changed bytes, changed metadata or a pending-to-
accepted move use full verification again. The cache holds only the last proof.

Single-run local measurements with fake IndexedDB, rectangular marks and blocked
transport (not a browser, production or heavy-ink benchmark):

| Annotations | Encoded bytes | Repeat before | Repeat after | Close before | Close after |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 22,813 | 5.16 ms | 2.32 ms | 5.02 ms | 2.35 ms |
| 1,000 | 230,462 | 37.85 ms | 19.48 ms | 36.90 ms | 15.45 ms |
| 10,000 | 2,337,642 | 352.98 ms | 139.33 ms | 352.24 ms | 136.50 ms |

The first 10,000-mark proof still takes about 295 ms in this fixture. Verification
has real CPU cost; this is not proof of unlimited scale or a zero-latency result.
No extra cloud requests occurred, and repeat/close checkpoint puts remained zero.

### Final combined verification

After the form flush and exact-input cache changes, the full suite passed again:
4,283 tests, 4,229 passed, 54 skipped, zero failed or canceled, exit 0. The build
passed. The updated native fixture also verifies that one immediate focused Save
stays clean beyond the old debounce delay and keeps focus, before testing actual
quit/relaunch recovery. All seven native checks passed. Root browser QA repeated
single-Save reload and the real-IndexedDB receipt checks together in an isolated
context: exact value restored, focus preserved, zero page errors. Independent
final review found no concrete blocker in the form flush or receipt cache.

This tested branch is not merged or production-verified. Microsoft testing is
still deferred. The next local-first phase must settle account-free local file
ownership, stable file identity and copy/verify recovery migration before it
changes existing save locations. Shared cloud files also need a separate offline
access/revocation policy and leased real-account checks; a local receipt is not a
new permission grant. No production retention cleanup or extra index was applied.

The actor-bound local receipts and focused form-save behavior above are
implemented and tested. This does not establish a general offline library or a
new offline permission policy. Those remaining designs still need their own
storage, account-switch, deletion, revoke-access and cold-start proofs.

## Follow-up: thumbnail sharing and print cache bounds

The local thumbnail row and selected preview now share the same first-page
render job when they use the same immutable File. Memory and in-flight keys
include source/version and the actor-bound download callback. Replacing a File
cannot reuse a thumbnail whose cloud path still describes the old bytes.
Failures can retry on a later mount. Inline PDF URLs use weakly held numeric
source IDs, so long base64 strings do not become retained LRU keys. A selected
preview can promote its shared queued job without a second download or render.
Cloud rows still cannot initiate a full PDF download.

Measured in the mounted component test with a 25 MiB Blob and a counted renderer:
two reads / 50 MiB and two renders became one read / 25 MiB and one render.
The browser check used the actual component and PDF.js parser with a 15,177-byte
PDF: one read produced two loaded 773 x 1000 images with the same raster and no
page errors. The browser check was a mounted component check, not a live-account
document-library test. Eight new thumbnail tests cover source changes, callback
changes, queue priority, retries and compact inline keys.

The custom print panel's cache now has a 32 MiB conservative string-byte budget
and a 32-entry LRU. Oversized images still reach their caller but are not cached;
eviction does not invalidate images already returned. Source swaps retire old
callbacks and pending results. Equal concurrent requests share one render, and
a synchronous page-load failure no longer prevents future retries.

**The custom panel is disabled in the current product.** These cache bounds are
hardening for that path, not a measured reduction in the default print path.
The 600-render synthetic check retained 32 images and 6,401,472 conservative
string bytes, versus 600 images and about 120 MB before; the render count stayed
600. This is not total browser memory accounting. Seven focused tests pass.

Browser QA enabled that panel only through a response override in an isolated
test context; no product flag changed. Rotate, larger preview, cancel and reopen
worked, with no extra raster on reopen and no page errors. The unmodified default
print route also prepared a ready 1224 x 1584 page and invoked the print boundary
once. The OS print call was intercepted to avoid sending a print job; this does
not claim native print-dialog or printer-output verification.

Combined frozen checks: 4,299 tests, 4,245 passed, 54 skipped, zero failed or
canceled; `npm test` exited 0. The Vite build and all seven native save/quit checks
passed. Graphify AST update and whitespace checks passed. Logs are local under
`/tmp/survey-cache-frozen-{tests,build,electron,graph}-20260908.log`.

### Live collaboration check: harness blocked, not passed

A separate worktree frozen at `732886a4` ran the official eraser-permission suite
under a coordinator-held exact three-account lease. The first case failed while
waiting for a dev-only eraser harness element; eight serial cases did not run.
That element and its related API are absent from this revision's product source.
The result is a stale-harness blocker, not proof of a product permission failure
or of passing live collaboration. No old test seam was reintroduced and no
assertion was weakened. The harness now also has a unit-tested exact email/ID
check before accepting an authenticated test session.

All three accounts retained their recorded free/active baseline. Read-only
backend checks found no remaining test PDFs or storage objects in the exact test
folder. No production schema, retention policy or Microsoft service changed.

The independent legacy collaboration review also found document-only local keys
and missing initial state exchange for a late offline follower. Its private
[isolation and recovery plan](legacy-collab-isolation-plan-2026-09-08.md) records
the reproductions and required acceptance tests. Neither the old local bytes nor
the live namespace has been changed: actor scoping must preserve and expose old
unattributed pending data for recovery, not silently discard or replay it.

### Live two-user baseline: passed after test-login repair

The current FIX20 harness has supported viewer hooks and real UI shape creation.
Its first run on product revision `9109b5e2` stopped before login because its
password-only setup hit the server CAPTCHA gate. No collaboration assertion ran
in that failed baseline. Its temporary document and storage object were removed.

The harness now reuses the existing leased-test sign-in helper. It checks the
exact auth user ID and email before requesting a session, verifies the returned
identity, and seeds only the configured app origin's top-level page. It does not
overwrite a refreshed session on reload. The password override for this harness
gets the same origin/frame restriction. Product login rules and the machine-local
owner relay are unchanged. No test account was created and no email was sent.

The complete existing test passed twice, including after the final origin and
session-retention changes. The final run at `2026-09-08T04:21:30Z` used two leased
free/active accounts and an isolated disposable PDF. It proved:

- Both users see each other's UI-created circles exactly once.
- Rectangle, callout and counter changes reach the other user.
- A collaborator cannot move or delete the other author's rectangle or callout.
- Each user can delete their own tested marks without deleting the other's.
- Reload preserves each remaining circle exactly once in both clients and in
  the authoritative stored Yjs state; deleted marks stay absent.
- Both clients load the actual PDF from authenticated storage, without a byte
  override. The final run logged no browser console errors.

The final fixture was `d4fd7d3b-0883-4a43-b5f7-8e6e12b3a4c1`. The harness removed
its exact document and storage object. Coordinator read-only checks found no
remaining objects/documents in the test folder, no new survey sessions for the
leased actors, and unchanged free/active baselines. Cleanup was attested and the
lease released. Raw logs remain private in the isolated QA worktree; they are not
safe public handoff artifacts.

This closes the live **baseline** gap for those existing checks only. It does not
prove offline reconnect, access revocation during offline work, the old provider's
account switch, or any Microsoft flow. The standing optimization request
authorizes routine regression tests; those tests need no further approval. The
separate product choice about account-free local files remains unchanged. The
legacy raw-data recovery design has not been migrated or enabled.

After the final test-login changes, the full offline suite passed again: 4,299
tests, 4,245 passed, 54 skipped, zero failed or canceled, exit 0. The existing
24 lease/identity checks and seven registry/lifecycle checks also passed. No new
regression test was added in this slice. Independent review found no remaining
blocker in the two-file login-setup diff. Product source is unchanged from the
already built and native-tested `9109b5e2` revision.

## Actor-scoped legacy sync helpers — local checkpoint

The next slice adds opt-in helpers, not an enabled storage migration.
`YDocProvider` and its AppShell mount are unchanged. The current provider still
uses its old namespace; do not describe account isolation as shipped.

- One strict encoded document/actor key now supports registry, IndexedDB,
  Web Locks and BroadcastChannel. Scoped startup exchanges state both ways,
  including edits made before the follower attaches. Retry bursts are bounded;
  role callbacks replace the need for role polling when the provider is wired.
- Recovery has a metadata-only startup probe, separate full read-only
  inspection, and a JSON-safe raw export. Unknown ownership stays unknown.
  Missing databases stay absent. Registry snapshots preserve unresolved Yjs
  structs and delete sets. Export tests caught and fixed loss of binary view
  offsets and shared backing buffers. Nothing is imported or deleted by recovery.
- The actor-bound runtime retires old work before a new actor's token can reach
  it. It waits for exact session identity before transport construction, rejects
  wrong-scope/destroyed documents, and closes late provider candidates. These
  APIs are not yet connected to production provider callbacks.
- Backfill accepts a captured current-generation check and abort signal. It
  stops at async/write boundaries and returns cancellation without claiming a
  completed cloud seal. Already committed batches and already-sent requests
  are not rolled back.
- Existing explicit document purge now matches the exact new document prefix,
  including all actors, without matching sibling IDs. Scoped document destroy
  stops local channels, retries and lock election. Missing database enumeration
  reports incomplete cleanup instead of claiming that undiscovered stores were
  removed; existing archive callers still handle purge errors best-effort.

First frozen verification: `npm test` exited 0 with 4,367 tests, 4,313 passed,
54 skipped, zero failed/canceled. `npx vite build` passed. The actual Electron
save/quit fixture passed all seven checks. Logs are private temporary files:
`/tmp/survey-scoped-helpers-{tests,build,electron}-20260908.log`.

After adding six permanent session-race checks and two more recovery-error
regressions, the final frozen run also exited 0: 4,375 tests, 4,321 passed,
54 skipped, zero failed/canceled. The final build passed. Logs:
`/tmp/survey-scoped-helpers-final-{tests,build}-20260908.log`.

Actual Chromium tabs, with invented data and isolated browser storage, also
passed five module checks: a late same-actor follower received old history;
pre-attach follower bytes reached the leader; another actor received neither
history nor later local edits; the follower became leader after normal detach;
and cold reopen restored all three delivered edits. Two exact actor database
names were observed and there were zero page errors. This is real browser
storage/lock/channel proof, not a rendered provider rollout or live-account test.

Remaining rollout gates:

1. The known-gap diagnostic `debug/legacy-ydoc-lifecycle-known-gaps.mjs` pins
   baseline `ff15dfa70a8d472b4277f5b5b7a29af55e774827`. Both baseline and scoped
   helpers can leave a follower's last edit only in memory when both tabs detach
   before message delivery. Both can hold the writer lock while IndexedDB open
   never resolves. Retained registry bytes are not a disk-save receipt.
2. Bound full recovery read/export resource use and add explicit recovery UI.
   A partial-source read or unsupported export must not be shown as a complete
   backup. No automatic ownership assignment or opaque replay is allowed.
3. Wire reactive actor scope, synchronous retirement, captured async guards,
   new role callbacks and recovery state into the provider as one tested change.
   Recheck actual multi-user flows after that integration. The earlier live
   FIX20 pass remains a baseline, not proof for these unused helper APIs.

Microsoft 365 work is still deferred. No new account, trial, cloud migration,
production data deletion or Supabase configuration change was made in this slice.

## Sources

- [IndexedDB transactions and upgrades](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
- [Postgres index guidance](https://supabase.com/docs/guides/database/postgres/indexes)
- [Electron app lifecycle](https://www.electronjs.org/docs/latest/api/app)

## Rollback

Code rollback must keep unsent drafts, backups and outbox records. No live schema
change or deletion is part of this slice. Older clients may not read a new pending
draft format, so resolve or migrate pending work before downgrading those clients.

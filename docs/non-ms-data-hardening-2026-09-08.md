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

### Live regression after helper checkpoint `4e01f7a0`

The isolated QA worktree ran the existing FIX20 contract against local revision
`4e01f7a0f8ef80c001d8615968489805bbba3059`, served at `http://127.0.0.1:5178/`,
with the actual Supabase backend. This means local app code with a live backend, not a
deployed production revision. The same two exact pre-existing accounts were
reserved under `DATA-SCOPED-HELPERS-20260908`; no account was created.

The run passed: both users saw UI-created circles exactly once; rectangle,
callout and counter changes reached the other user; foreign-author move/delete
was denied; own deletes preserved the other user's work; reload and authoritative
stored state matched. Both clients downloaded the real authenticated PDF.
Browser console error count was zero. The log contains 58 aborted requests
(36 analytics, 19 HEAD reads, 3 broadcast); the earlier baseline had the same
analytics/HEAD counts and 2 broadcast aborts. Do not report a failure-free network
or attribute these aborts to the new unused actor runtime.

Private evidence: isolated QA worktree
`Logs/2026-09-08_05-05-05_fix20-multi-user-collab/evidence.json`.
Fixture `c9a93387-2700-41de-b33a-f1a732523c1b` and its exact storage object were
removed by the harness. Coordinator checks found zero remaining document,
storage object, collaborators or new actor survey sessions. Validated document
foreign keys cascade except survey sessions (checked separately). Both exact
email/user-ID pairs remained free/active; cleanup was attested and the lease
released at 05:07:00 UTC. The temporary port-5178 server was stopped.

Gmail checked more than one minute after the local checkpoint found no related
GitHub, Vercel, Supabase or Resend alert. This checkpoint was not pushed or deployed.
The real-account pass protects the unchanged current provider behavior; the new
actor-scoped provider rollout and close-proof acceptance tests still remain.

### Close proof and bounded recovery — next local slice

This slice closes two helper-level gaps. It still does **not** switch
`YDocProvider`/AppShell to the new actor-scoped store or change the live quit
gate. Ordinary `detach()` remains cleanup, not a durable-save acknowledgment.

- A scoped tab can request an exact full-snapshot save from the local writer.
  The writer applies the snapshot before appending it to the existing update
  log, then waits for transaction completion. A successful request callback or
  the persistence library's `synced` event is not enough. This also preserves
  pending structs and deletion-only updates across later compaction.
- Close receipts belong to one exact mount, snapshot, actor, and storage
  generation. Late edits, retirement, storage changes, wrong acknowledgments,
  timeouts, and cancellation cannot approve a close. The session forwards
  cancellation to local work; a sealed session sends only a data-free cancel
  control message during teardown. Duplicate completed requests are bounded
  and suppressed.
- Final receipt validation opens the existing scoped database read-only and
  verifies its full stored state in a detached scratch document. Missing stores
  remain absent. A stale receipt is not enough when another tab clears data
  without changing the database version. Failure preserves live edits and
  allows a new save attempt. Callers must keep all needed sessions attached
  until their receipts pass this check and remain current.
  Review removed a whole-live-document encoding from each stored-row check:
  the regression now measures two full live encodes for both four and 106
  stored rows, while pending structs and delete-only bytes still invalidate
  stale receipts. A pending follower close also survives writer promotion and
  passes fresh verification before a successful cold reopen.
- Recovery inspection and export now cap records, binary/text bytes, visited values,
  depth, graph nodes, and final JSON bytes. They support cancellation and reject
  incomplete output. Defaults are overridable with positive safe integers.
  Review caught a delayed aggregate-size check: an 8 KiB limit formerly read
  10,000 fresh 4,000-character values before rejecting. The regression now
  stops within three reads, including flat objects, arrays, maps, and sets.
  Exact JSON-byte boundaries, cycles, binary aliases, and error causes remain
  covered. No recovery source is rewritten, imported, or deleted.
  Inspection also caps raw UTF-8 text at 32 MiB by default, including keys,
  error fields, schema and result metadata. A real 101-row IndexedDB fixture
  with 4,000-character values stops within three reads under an 8 KiB cap;
  every source row remains unchanged. Text counting avoids a full encoded copy.

Real Chromium module check: two isolated tabs using actual IndexedDB, Web Locks,
BroadcastChannel, and current source. The final follower update was deliberately
dropped from ordinary transport. The follower's close proof delivered it, both
tabs passed a fresh disk check, both lifecycles detached, and cold reopen restored
both edits. Zero page errors. This is local module proof, not UI activation or
live Supabase collaboration proof. The earlier leased FIX20 run is still the
current-provider baseline.

The existing actual Electron save/quit fixture passed all seven checks again:
atomic writes, quota failure preserving dirty state and a neighbor document,
quit veto, retry, immediate focused manual save, focused-field quit/relaunch,
and home-only quit. Native logs:
`/tmp/survey-close-proof-electron-20260908.log`. Build passed at
`/tmp/survey-close-proof-build-20260908.log`.

Rendered browser regression also passed in an isolated 1440-by-1000 context:
`http://localhost:5218/?testPdf=e2e/prog-07-form-fields.pdf` loaded the actual
form PDF, typing into `siteRef` then Cmd+S kept the value and focus and cleared
dirty state beyond the old 400 ms timer. Page title was Survey, the PDF and
controls rendered, and there was no Vite overlay or page error. Screenshot
`/tmp/survey-close-proof-browser-20260908.png` was visually checked. The Browser
plugin was unavailable; connected Playwright was used under the frontend test
skill. This check protects the existing rendered save path, not the unwired
scoped close APIs. No mobile layout claim is made.

Final frozen verification, including the text cap: `npm test` exited 0 with
4,445 tests, 4,391 passed, 54 skipped, zero failed or canceled. All 114 focused
close/session/lifecycle/recovery tests passed separately. Final build, graph
update, diff check, and all seven native checks passed. Private logs use the
prefix `/tmp/survey-close-recovery-checkpoint-` and suffix `-20260908.log`
(`tests`, `focused`, `build`, `graph`, `electron`). No regression was found in
these checks; this is not proof of every possible user state or forced shutdown.

Limits: synchronous Yjs decoding/encoding and the browser's initial structured
clone cannot be preempted by a timer. The fresh close verifier currently reads
the whole scoped update log; do not claim constant-time close or a hard CPU
limit. A blocked old writer still retains its lock until safe cleanup finishes;
the new bounded check rejects close rather than releasing that lock early.
Forced process termination is not a guaranteed save. Recovery UI, provider
wiring, all-tab close integration, and post-integration multi-user/offline tests
remain required. No Microsoft work, live schema change, account creation,
deployment, or push occurred in this slice.

## Provider and close integration (local work in progress, September 8)

The implementation worktree now mounts the actor-scoped legacy session from
AppShell. This supersedes the unwired-helper status above, but is not a release
claim. The main annotation store remains separately actor-scoped; cloud IDs and
Microsoft paths are unchanged.

- Account retirement seals old callbacks and transport. Returning to the same
  actor retries canceled backfill without replacing the retained document. A
  retained cleanup callback cannot adopt the new session. Mounted tests caught
  and now cover both faults.
- Tab X, native quit, and the re-sign-in close action use the same local-save
  checks. Optional extra close proofs must provide the complete contract.
  Fresh checks cover the exact participant, tab, file, actor and revision.
  Pointer/text-edit vetoes, focused-input blur and overlapping freeze ownership
  apply to tab and native close. Remote lock/session changes abort pending proof
  checks; already committed writes cannot be undone.
- The actual viewer now requires both the scoped Yjs proof and a separate old
  raw-registry recovery proof. Locked documents use read-only checks. An absent
  raw registry needs no archive write. Present unattributed data is saved in
  `survey-legacy-recovery-v1/rawRegistrySnapshots`, outside all actor databases.
  Content-addressed immutable records avoid repeated identical copies. Close
  requires transaction completion and a fresh read, not a download or cached
  receipt. Changes, replacement, quota, missing storage or cancellation veto it.
- The recovery notice reads metadata on open. Explicit export includes raw
  sources and saved archives, with partial failures labeled. The owner remains
  unknown; there is no auto-import, actor assignment, raw-source deletion or
  cloud-sync claim. Archive list reads default to 20 records and 128 MiB; a
  larger history needs a later paged export path. No archive purge was added.

Final frozen verification: `npm test` exited 0 with 4,512 tests (4,458 pass,
54 skip, zero fail/cancel). All 128 focused provider/recovery/close checks and
32 lock/local-save checks passed. Build, graph update and diff check passed.
Actual Electron passed all seven save/quit checks
again, including quota veto and focused-field process restart.

Rendered Playwright checks: the real no-auth PDF form route at port 5218 retained
the typed value after tab close and reopen. Injected local-storage quota failure
kept the tab/value and showed a save error. A synthetic recovery archive mounted
in the real viewer remained discoverable after removal of its test-owned memory
copy and exported successfully. Its notice fit 1440x1000 and 390x844 viewports,
with zero page errors in that isolated check. An earlier UI harness attempt used
a second React instance; importing the app's actual Vite runtime resolved that
test setup fault. This is not live authenticated provider proof.

Private evidence: `/tmp/survey-scoped-provider-tabclose-20260908.png`,
`/tmp/survey-recovery-archive-desktop-20260908.png`,
`/tmp/survey-recovery-archive-mobile-20260908.png`; frozen verification logs use
`/tmp/survey-provider-archive-frozen-` plus `tests`, `build`, or `graph`, and
`-20260908.log`. Native log:
`/tmp/survey-scoped-archive-final-electron-20260908.log`.

Required next: real leased two-user collaboration/offline and account-transition
checks against this integrated source, plus review of recovery/history retention
and browser shutdown limits. The earlier FIX20 run predates this wiring. No new
live schema change, account creation, Microsoft testing, push or deploy occurred.
Do not claim all optimization opportunities exhausted or all regressions ruled
out. The active goal remains open.

### Integrated live collaboration check

At 2026-09-08 06:33 UTC, the exact `5bc98366` revision passed the leased FIX20
two-user harness against live Supabase. Real UI ellipses appeared exactly once
for each actor; rectangle, callout and counter edits propagated. Foreign move
and delete attempts were denied, own deletes preserved the other actor's work,
both reloads matched, and durable backend rows retained exactly one copy with
the right author. Both users downloaded the actual test PDF through Storage;
there was no byte override. Console errors: zero. Network aborts: 19 HEAD reads,
36 analytics POSTs, four realtime broadcast POSTs. This is not a claim of zero
network failures.

Private evidence is in the isolated QA worktree under
`Logs/2026-09-08_06-33-09_fix20-multi-user-collab/evidence.json`.
An earlier run at 06:31 failed because the test Vite process lacked the public
Supabase environment and created a null client. Restarting that owned process
with the test target's public URL/anon key fixed setup; no product change was
needed. SQL then confirmed both runs' exact documents, storage objects and
collaborator rows absent, no new survey sessions for either leased actor, and
both accounts still free/active. The lease remains held for the next offline
test, not for account provisioning. Offline/reconnect, checked app-tab close,
and real account transitions remain separate required checks.

## Hidden-tab polling and live offline proof (September 8, 06:47 UTC)

The status reader now belongs to one document/actor runtime. It keeps the
initial permission read, coalesces pending reads, stops presentation polling
for inactive/hidden documents, and checks again on activation, focus and
reconnect. Collaboration transport and pending-save retries are not paused.
For ten inactive private tabs, focused mounted tests measured startup role
RPCs dropping from 20 to 10 and recurring status requests from 20 per thirty
seconds to zero. Thirty invalidations coalesce to two reads. No permission
result is cached across actors or opens.

The extended leased two-user harness passed with these exact runtime files
on top of `5bc98366`. User A drew and saved offline; a fresh read-only
IndexedDB reconstruction recovered the exact authored edit from checkpoint
and replayable outbox without claiming a cloud acknowledgment. User B edited
online. Reconnect converged both edits exactly once with correct authors on
both clients. Actual app-tab X and permission-checked online reopen retained
both; SQL confirmed the durable rows. All earlier ownership/delete isolation
and reload checks also passed. This does not prove cold offline cloud reopen.

Private evidence: QA worktree
`Logs/2026-09-08_06-46-59_fix20-multi-user-collab/evidence.json` and four
`offline-*.png` screenshots. Root inspected both reopened views and the owner
converged view: real nonblank PDF, both distinct ellipses, no blocking overlay.
There were zero page errors. Network evidence includes 61 aborted requests
and six expected disconnected requests during the deliberate offline period;
it is not a zero-network-error claim. Exact SQL cleanup verified all three
run documents, storage objects, invites and collaborators absent, no new
survey sessions, and both exact leased accounts still free/active. Root
attested cleanup and released the lease at 06:49 UTC; owned QA server stopped.

Final full suite: 4,544 tests, 4,490 passed, 54 skipped, zero failed/canceled.
Build and graph update passed. The first full run caught an offline unit
source assertion being misclassified as a live harness; only that assertion
construction changed, not the lease policy or live harness. No push/deploy.

## Managed local library checkpoint (September 8, 07:34 UTC)

The home view now separates **On this device** from **Cloud**. A signed-out
user can import and reopen a managed PDF copy without a cloud row or upload.
The device list reads metadata only. Local files have their own identity and
editing scope; that scope does not grant cloud ownership or bypass locked marks.
Cloud upload, roles, authors and sharing remain separate.

IndexedDB stores PDF bytes, metadata and saved annotation/sidebar state.
Page changes commit bytes and remapped state in one transaction. Revision checks
reject stale writes, and the viewer blocks edits during that short operation.
State-only saves do not load or copy PDF bytes. Storage failure keeps the prior
revision; successful saves wait for transaction completion. These checks do not
promise protection from browser eviction, power loss or all forced-shutdown cases.

Real signed-out browser checks passed: import; draw; save; delete/undo/redo;
page duplication and confirmed deletion; tab close and cold reopen with matching
PDF hash and saved marks. An injected IndexedDB quota error left the exact prior
bytes, state and revision intact. Retrying after removing the fault succeeded.
Desktop and 390px mobile library views were inspected. At high zoom, the page
context-menu capture had stolen thumbnail events; the sidebar now keeps its own
menu, with a mounted regression and a real browser retest.

One explicit limit remains: setting the entire Vite browser context offline can
block an uncached lazy module or a new PDF worker. The page transaction remains
durable, but the view can fail to load. Cold reopen and page operations passed
with local app assets available and all remote requests blocked. This is not
proof of a fully offline browser app shell or an installed Electron cold start.
Managed-local edits also need stronger recovery between checkpoints; the current
saved snapshot must not be called a durable per-edit journal.

All current source passed the real leased two-user cloud/offline/reconnect and
tab-close/reopen harness at 07:27 UTC. Ownership, foreign-edit denial, exactly-once
convergence and backend persistence passed. There were zero page or console
errors; 66 aborted/disconnected requests were recorded, not hidden.
Exact SQL checks confirmed the test document, object, collaborators and invites
removed, no new survey sessions, and both exact accounts restored to free/active.
Root attested cleanup and released the lease at 07:33 UTC.

Final full suite: **4,597 tests; 4,543 passed; 54 skipped; zero failed/canceled**.
The production build and diff check passed. Graph refresh was run after the last
product edit. Private evidence: implementation worktree
`Logs/2026-09-08_07-27-32_fix20-multi-user-collab/evidence.json`,
`/tmp/survey-local-fully-frozen-tests-20260908.log`,
`/tmp/survey-local-fully-frozen-build-20260908.log`, and screenshots
`/tmp/survey-local-cold-reopen-20260908.png`,
`/tmp/survey-local-quota-preserved-20260908.png`,
`/tmp/survey-local-library-desktop-20260908.png`,
`/tmp/survey-local-library-mobile-20260908.png`.

No push, deploy, paid service change or Microsoft testing occurred. Explicit
local-to-cloud publishing, browser offline assets, per-edit recovery and installed
native lifecycle proof remain open. This is a tested local checkpoint, not a
claim that all possible optimizations or regressions are resolved.

## Direct hydration, complete save state and native restart (September 8, 08:03 UTC)

Managed-local loads now read a private, validated snapshot directly. They no
longer replace or write the six shared legacy keys. This includes sidebar load,
page-change publication, note saves and region visibility. Existing raw values
remain untouched, with unknown provenance; they are not automatically merged
into a possibly different PDF layout. Cloud and unmanaged loaders keep their
prior paths. Region visibility now binds its load/write state and retained
setters to one document/open, preventing an empty initial map from erasing a
saved setting.

Managed dirty tracking covers the complete saved state, not just annotations.
Late writes cannot mark newer metadata clean. Identical overlapping saves share
a promise; changed snapshots queue under the exact File and recheck current
scope, readiness and revision before writing. CAS conflicts are not ignored.
The 30-second autosave deadline no longer restarts on every edit. Native close
checks complete state and rejects initial/incomplete PDF loads.

Actual desktop testing found a further false-dirty issue: PDF import reordered
and normalized native marks after the initial state load. The clean baseline
now waits for the explicit PDF-import completion signal, not a delay. It does
not reset after later user edits or load transitions. Mounted tests reproduce
the observed form/rect/path order change and preserve later dirty state.

The new isolated Electron harness passed six lifecycle checks across three real
processes, using production `file://` assets and blocked Chromium/Node network
access. Native picker selection alone is supplied by the test; real IPC, Save,
IndexedDB and `app.quit()` run normally. Manual focused Save becomes clean;
same-profile cold reopen retains the exact value even after the fixture's legacy
mirrors are removed. Immediate focused edit then native quit/restart retains the
new value. Both cold-open checks stay clean for the observed interval. Root and
worker inspected both screenshots. No renderer exception or save-failure dialog
occurred; blocked font/Turnstile requests are expected. This is real Electron
main with production assets, not a signed/distributed package, power-loss test
or a deterministic native initial-load-close test.

Private evidence: `/var/folders/r_/yk6_hpnj2mgbf03dcdd15w900000gn/T/survey-managed-local-evidence-zxneTv/`
(`result.json`, `manual-save.png`, `cold-reopen-focused-quit.png`). The harnesses
are `debug/managed-local-electron.mjs` and its isolated entry. Test profiles were
removed after process exit. Production viewer SHA256:
`6cc298f49d87d1d963793ff4c08444a4542a90d7dd2b3d7f2372fe8fea24000a`.

Preload failure no longer triggers an automatic reload while offline or while
any local/cloud document is open, even an inactive one. An existing toast gives
manual recovery steps. Root's real browser checks passed: online open file
stays mounted; offline open file stays mounted; clean online Home reloads once;
the retry cooldown prevents another reload. No synthetic unload events are used.
This guard is not an offline browser asset cache; that gap remains open.

The current full source also passed the leased two-user cloud, ownership,
offline/reconnect, tab-close/reopen and durable-row harness at 08:00 UTC.
Evidence: `Logs/2026-09-08_08-00-30_fix20-multi-user-collab/evidence.json`.
There were zero page errors and 65 recorded network abort/disconnect failures.
SQL confirmed exact document/object/collaborator/invite cleanup, no new survey
sessions and both accounts free/active. Root attested and released at 08:02 UTC,
then stopped the owned auth server. No account creation, push, deploy or
Microsoft testing occurred.

Per-session crash drafts that retain matching PDF bytes and an explicit recovery
choice remain the next slice. The current save/close proof must not be presented
as durable per-edit or forced-shutdown recovery.

Final frozen suite: **4,627 tests; 4,573 passed; 54 skipped; zero failed/canceled**.
Build, graph update and diff check passed. Logs:
`/tmp/survey-local-direct-complete-tests-20260908.log`,
`/tmp/survey-local-direct-frozen-build-20260908.log`, and
`/tmp/survey-local-direct-frozen-graph-20260908.log`.
Earlier full runs caught two old source-shape assertions and one missing
test-harness scope variable after adding the readiness gate. Those tests now
require all cloud/managed/unmanaged branches and supply the new readiness input;
no product guard or old oracle was removed to get a pass.

## Per-session local recovery design (September 8)

Managed local editors now retain recovery state separately from canonical Save.
The first dirty edit starts a session bound to the exact immutable PDF File.
Later edits update only metadata and the six saved-state payloads, not another
PDF copy. A fixed 150ms deadline coalesces fast changes; slow writes retain the
latest next snapshot. Empty states after undo/delete replace old marks too.
Cloud and unmanaged files never start these writers. Failed writes retain the
latest pending state, show an error, and retry on a later edit or explicit Save.
Recovery failure does not change the result of a successful canonical Save.
The recovery list reads metadata only while Home's local Documents view is
shown. Hidden updates invalidate the list without a scan. Event bursts share a
read; changes during a read invalidate its result and request one trailing read.

The device library offers **Recover as copy** and confirmed **Discard**. A copy
imports retained PDF bytes, metadata and all six state payloads in one new
document transaction. It never overwrites the original, merges old state into a
new page layout, or carries cloud/native-path authority. Only the outer storage
keys change; mark IDs, authors and user text remain unchanged. Native Blob reads
prevent an overridden File method from swapping same-sized PDF bytes. Discard
requires the exact listed sequence and leaves a tombstone so queued old writes
cannot recreate that session. Later editing may start a new independent session.

These are saved session snapshots, not a claim that every copy is unsaved.
Canonical Save does not silently discard them. No automatic retention cleanup
has been implemented; repeated edited sessions retain PDF bytes until explicit
discard. A state-write receipt is not a fresh integrity scan of the stored PDF;
recovery verifies the paired rows before creating a copy. Browser profile
deletion, disk corruption, uncommitted canvas gestures and form input before
the existing input debounce remain outside this recovery guarantee.

## Follow-up audit: cloud upload identity and deletion checks

At `725d4d31`, the full offline suite had 4,823 tests: 4,769 passed,
54 skipped, zero failed or canceled. That baseline also passed browser recovery,
cold-offline restart and native save/quit checks. It is not a live-cloud or
deployed-revision claim.

The next upload change retains an owned File from the buffer already read for
hashing. Browser single-file and bounded batch uploads use that copy for the
content ID, upload, page count and viewer. Native picker bytes were already
owned. Duplicate-name repairs use the same path-aware replacement helper as
normal retries, including pending-download invalidation. No extra normal-path
disk read, PDF-header restriction or new size cap was added. Full-file hashing
and retention of the owned file still require memory; concurrent changes during
the first disk read remain subject to browser file checks.

A physical-file browser reproduction paused the actual upload handler after
hashing, then changed, replaced or removed the selected file. Old code uploaded
changed bytes under the old content ID, or failed after removal. Both normal and
alias-repair paths now retain matching original hashes through upload, viewing
and page-count input. These checks use a local transport substitute, not live
Supabase writes.

The checklist safety fix now rejects failed, missing or invalid cloud counts
through the service, Dashboard and editor. The editor keeps the item, shows a
retry message and does not save a deletion. Confirmed usage retains the archive
flow; confirmed zero retains the existing delete flow. Delayed replies and
archive confirmation recheck template, actor, module, category and item identity.
The capped full-JSON fallback is removed. A head-only exact count checks JSON key
presence, including null and scalar values. Unsupported path IDs, including
integer-only IDs that PostgREST could parse as array indexes, fail closed.
Disposable PostgreSQL 16.14 and real rendered editor tests verify these cases.

This count still covers only RLS-visible cloud rows. Guest behavior is unchanged,
and managed-local PDFs and recovery drafts are not scanned for references. It is
not a global reference guarantee or a transaction that excludes concurrent new
responses while a template deletion is being saved.

The fresh read-only audit also identified these open items:

- Legacy annotation hydration shares in-flight work by document alone; audit
  and bind requests to the actor/session before allowing result reuse.
- Collaboration role changes need a fresh role check, not just a membership
  list refresh. Server authorization and a correct visible edit state are
  separate requirements.
- A fast presence remount can reuse a channel still closing in the installed
  client. Each subscription needs clear lifetime ownership.
- Subscription usage needs stale-request/account guards and the same archived
  row rules as database insertion checks.
- Mutation-only template consumers still trigger full template reads.

Durable cloud-upload recovery, explicit local-to-cloud publication, staged
large-library rendering and an offline cloud-access policy remain separate
work. Microsoft 365 testing stays deferred. Do not weaken access checks, remove
unmatched recovery data or enable hard local-file deletion to close these items.

Frozen verification: 4,843 tests, 4,789 passed, 54 skipped, zero failed or
canceled; production build and graph update passed. Independent upload and
checklist reviews found no blocker in the changed code. The physical-file test
ran 16 baseline/current cases. The rendered editor passed unknown/retry/archive/
zero-delete flows at desktop size and displayed its failure state at 390px with
no page-width overflow. The built app also passed all seven recovery checks and
all eleven cold-offline/cache-repair checks. No live accounts, production data,
schema changes, Microsoft service calls, push or deployment were used.

## Follow-up: account-safe hydration and live collaboration permissions

The first three audit items above are now addressed in code. Legacy annotation
reads share one pending keyset sweep only for the same Supabase client, actor,
document and auth generation. Each page uses the captured session token; logout,
account change and a new login retire old reads. A token refresh or repeated
same-session sign-in does not discard healthy work. Each caller can cancel and
settle promptly, even while auth or another caller's shared request is stalled.
No completed rows are cached, partial results cannot become a backfill, and
existing row filters, writes and server access rules are unchanged.

Open collaboration views now refresh their role on access changes, focus,
reconnect and visible non-owner fallback polls. A confirmed denial activates
the existing revoked-access gate; a later successful role read cannot silently
unlock that runtime. A transient error retains the last known viewer role.
Confirmed private owners still avoid an extra role RPC on the ordinary poll,
and hidden tabs do not add fallback polling reads. Initial unknown-role behavior
remains unchanged; this UI state is not a replacement for server authorization.

Presence subscriptions now have separate channel lifetimes. Closing an old
subscription cannot remove a newly mounted same-document subscription, and late
events cannot call a disposed listener. The Postgres row filter and reconnect
seed behavior are unchanged; this adds no polling or database query.

Verification includes the installed Supabase and Realtime clients, held auth
and request races, mounted provider tests, and an independent review. The live
two-user browser run used two existing, exclusively leased accounts and a small
disposable PDF. Real storage download, mutual edit visibility, ownership limits,
exactly-once reload, offline local persistence, reconnect convergence and reopen
passed. Role downgrade, upgrade, revocation and sticky denial passed; after
membership restoration and a fresh reopen, the real Ellipse tool created a
mark that reached the other user and could be deleted by its author.

The first extended role test failed because its reload step did not reopen the
document from the library. The test was corrected and the complete live run
passed. Offline network errors are expected in the intentional disconnect phase;
no browser page exceptions were recorded. The legacy empty backfill warning
remains a follow-up. Offline *cloud opening* is still not claimed: the permission
gate stays in use. This is local-code/live-service QA, not a deployed revision.

Both disposable PDFs and their exact cloud records were removed. Account
identities and free/active subscription baselines were checked before and after
testing. No account provisioning, tier change, schema change or Microsoft call
was used. Local recovery and cold-offline/cache-repair regression runs passed
against the fresh production build using disposable browser profiles.

Frozen full suite: 4,880 tests, 4,826 passed, 54 skipped, no failures or
cancellations (prior batch: 4,843 total). Build and AST-only graph update passed.
Recovery passed seven checks; cold-offline/cache repair passed eleven. No push,
merge, deployment or measured production cost reduction is claimed.

The next read-only audit reproduced a separate usage-meter race: an old account
response can replace the next account's usage, and sign-out can retain that old
usage. Scope and request-generation guards are still required. Document/project
counts also need the insertion rule's exact `archived=false` filter; stored bytes
must continue to count archived objects. Mutation-only template reads remain a
separate bounded reduction. The broader publication, upload recovery, large
library and offline-access-policy work above is not declared complete.

## Follow-up: usage accuracy and template read budgets

Usage reads now belong to one hook lifetime, actor and request generation. The
first render after account change masks the old totals before effects run.
Late success, error, completion and retained refresh callbacks cannot change a
new account's meter. An A-to-B-to-A transition cannot reuse the first A scope's
pending read. Same-actor peer hooks, including Strict Mode replay, still share
one boot trio; explicit refresh stays fresh and no polling was added.

Project and document counts now use the server insertion policy's exact
`archived=false` rule. User-initiated library archive status is a separate field
and is not excluded. Storage still comes from the actual-object byte RPC, which
counts archived objects too. Invalid or missing successful count/byte payloads
produce an error, rather than a fabricated zero or the old subscription counter.
The hook preserves same-actor last-good values, but the visible meter hides them
on error and offers Retry. No backend error details are rendered.

Finite storage caps no longer use the unlimited project/document sentinel.
For a 100 MiB cap with 50 MiB used, the helpers now return 50 percent and 50 MiB
remaining, rather than zero percent and 999,999 bytes. Enterprise still has its
existing finite 1 TiB cap and the meter now shows that cap. Plan limits and
server policies are unchanged. Client create/upload checks remain advisory and
retain their prior last-good/empty behavior while usage is unknown; this is not
a new fail-closed quota enforcement layer.

PDFViewer and AppShell now opt out of automatic template reads because they
consume only mutations or explicit refresh. Dashboard keeps normal library
reads and event refreshes. With three open viewers, a library event goes from
five full template sweeps to one in the mounted test. A later viewer mount goes
from one sweep to zero. Equal-ID auth object updates trigger neither reads nor
resubscriptions. Explicit refresh still reads fresh and rejects current errors;
template writes and post-create caller behavior are unchanged.

Template read scopes also retire on mode changes, actor changes and unmount.
The first changed-scope render hides old rows/errors/loading, and a failed later
refresh retains only the current scope's last complete rows. Mounted tests use
held responses to verify disable/re-enable, A-to-B-to-A, retained callbacks,
unmount and read-versus-mutation behavior. Independent review passed 66 focused
tests across the usage, UI, coalescer, template and data-hook suites.

The actual UsageIndicator and usage hook were rendered in an isolated browser
fixture with a controlled local backend. Baseline code visibly let A's late
reply overwrite B's totals and showed no failure alert. The candidate passed
account isolation, finite storage math, failed-read presentation, mobile Retry
and sign-out checks. Only the injected outage logged an expected error; there
were no page exceptions. This test uses no real account or service request.
The production build also passed seven local recovery and eleven cold-offline/
cache-repair checks, including fresh-process PDF/form reopen and saved data
preservation. Microsoft and live-service testing were not used in this batch.

The next audit identified a higher-priority upload recovery flaw in
`Dashboard.persistProject`: its failure counter can trigger project deletion
after storage or a document insert commits but loses its response. The extracted
real callback reproduced the deletion request with an in-memory transport; the
repository's document/project foreign-key contract makes the document-row
cascade a risk. No live deletion test was run. A lost project-create response
also leaves no known ID for retry. Fix this before adding more read reductions:
use stable operation identity, preserve uncertain outcomes, reconcile exact
rows/objects and never infer "nothing committed" from a missing reply.

Frozen verification for this batch: 4,911 total tests, 4,857 passed, 54 skipped,
no failures or cancellations, exit 0 (prior baseline: 4,880 total). The build
passed. Legacy source-string tests were updated to check the new scope and
validated-byte paths, retaining their initial-load and error-propagation checks;
the final full suite passed after those changes. Browser-tested usage source
hashes and recovery/offline build hashes match the frozen files. No push,
deployment, live schema change or production cost reduction is claimed.

## Sources

- [IndexedDB transactions and upgrades](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
- [Postgres index guidance](https://supabase.com/docs/guides/database/postgres/indexes)
- [Electron app lifecycle](https://www.electronjs.org/docs/latest/api/app)

## Rollback

Code rollback must keep unsent drafts, backups and outbox records. No live schema
change or deletion is part of this slice. Older clients may not read a new pending
draft format, so resolve or migrate pending work before downgrading those clients.

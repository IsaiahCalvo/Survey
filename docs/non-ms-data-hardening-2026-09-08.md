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

## Follow-up: durable project upload recovery

Project creation now writes an actor-scoped IndexedDB journal with stable
attempt, project, file and document IDs. All selected PDF bytes must be staged
before the first cloud request. Empty projects use the same stable-ID flow.
There is no in-memory storage fallback, automatic replay, cloud compensation
delete, account creation, or change to paid-plan limits.

One Web Lock covers each staging, resume, retry or explicit discard action.
Only two file jobs run at once. Metadata lists never read PDF bytes, and hidden
home screens do not scan them. Account changes retire callbacks and hide prior
rows before effects run. Failed or uncertain network replies retain the journal
and bytes. Pre-journal failures retain the selected files in the create modal.
The recovery panel offers Retry, original-file reselect for partial staging,
and confirmed discard of only that attempt's local retry copies. It warns that
clearing browser/app data can erase those copies.

Cloud writes use captured actor JWTs and verify exact returned owner, project,
document, size and path. Row requests have abortable deadlines; the installed
Storage SDK does not forward upload abort signals, so upload timeout is logical
only and late promises stay observed. Crucially, uploads now use create-only,
never overwrite. A conflict downloads the existing object with a fresh cache
key and checks size and SHA before acknowledging it. This extra download occurs
only for a conflicting/retried upload, not normal opens or metadata scans.

Independent review found that the app's old `actor/SHA.pdf` paths are mutable:
structural PDF edits can replace the bytes without updating the row's hash.
Create-only alone still left a cross-project verify-then-insert race. New
project imports therefore use `actor/project/SHA.pdf`. Same-project identical
files share one object and row, with the selected names retained as aliases;
different projects keep distinct objects so an older project's edit cannot
change an unpublished upload. This trades cross-project byte reuse for correct
file isolation. Existing objects and rows are not migrated or rewritten.

Retries that find an already-published matching row do not upload or parse its
original staged bytes. Page count is parsed before the first document INSERT,
never written later from a stale PDF. Alias updates require the exact prior
adapter-issued row and compare the old aliases plus the document binding in
the UPDATE predicate. A concurrent change leaves the attempt pending for a
fresh read and merge instead of losing another window's alias.

The five-step real-Dashboard browser proof uses the actual SDK, journal, engine,
PDF parser and home UI with controlled storage/database responses. It drops a
successful storage reply, verifies retained bytes, closes the entire browser,
reopens the profile, and explicitly retries. Assertions confirm the same IDs,
no replay on startup, one object/document for two identical selected PDFs,
both names, page count, and exact local cleanup after confirmation. Desktop
1365x900 and mobile 390x844 checks pass with no page exceptions; the short Retry
label avoids horizontal clipping. Completion stays busy through refresh and
then shows a visible receipt without a stale retry row. Source hashes are
recorded with the browser evidence. Separate production-build local recovery
and cold-offline/cache repair checks also pass.

Live verification is **not** claimed. The reserved existing free test account
hit PostgreSQL `42P17: infinite recursion detected in policy for relation
"projects"` on both the prior `.insert({user_id,name}).select().single()` path
and the new adapter. Exact checks confirmed neither request created a project,
document or storage object. Test browser profiles were removed, the exact
account's free/active baseline was verified, cleanup was attested, and the
lease was released. Controlled browser transport is not a substitute for the
blocked live INSERT/RLS test.

Read-only live catalog checks show that the INSERT policy still counts
`public.projects` directly with `archived=false`. Project SELECT and collaborator
policies call `user_can_access_project`; that helper, `get_project_limit`,
`get_user_tier` and `is_project_accessible` are postgres-owned SECURITY DEFINER
functions. There is no live `can_create_project` function. A disposable local
PostgreSQL 16.14 reproduction confirmed `42P17` for both plain INSERT and
INSERT RETURNING with the inline self-table quota count, even when the access
helper is a postgres-owned definer. Replacing only that INSERT quota expression
with a no-argument, self-scoped definer helper fixed both local cases. Local
checks retained owner-spoof denial, missing-auth denial, second-free-project
denial, archived/other-actor quota exclusions, and shared SELECT access. The
disposable server was stopped. A count helper alone does not serialize competing
inserts; concurrent quota enforcement still needs separate proof. A further
causal control isolated the interaction with the September 7 SELECT-policy
`(SELECT auth.uid())` optimization: restoring bare `auth.uid()` in both policies
made both INSERT forms pass; restoring the wrapped SELECT reproduced `42P17`.
The hardened quota helper works with the wrapped SELECT retained. Thus the
comparison of old/new app requests above uses the same current live database;
it does not show that project creation failed before the policy optimization.
No production policy, migration, grant or deployment was changed here.

Frozen verification for this batch: 5,002 tests total, 4,948 passed, 54 skipped,
no failures or cancellations, exit 0 (prior baseline: 4,911 total). The production
build passed. All five upload browser checks, seven production local recovery
checks, and eleven production cold-offline/cache repair checks passed. Browser
source hashes match the frozen files, and both production regression reports
match the current `dist/index.html` hash. Legacy source-string tests were adapted
without dropping their guest-auth, modal, parser cleanup or local/cloud routing
assertions. The completion timing also has a mounted test with held library and
metadata reads. No push, deployment or measured production egress reduction is
claimed.

Remaining work includes the live project-policy error, durable recovery for
the separate single-file background upload, safe copy-on-write for older
shared PDF paths, and explicit local-to-cloud publication of all saved state.
Microsoft account/trial/live workbook testing remains deferred. Do not call
the overall data architecture complete based on this upload slice.

## Project quota repair: local migration, not deployed

`20260908130000_project_quota_guard.sql` replaces only the project's recursive
INSERT quota expression with a self-scoped, no-argument SECURITY DEFINER helper.
It retains the owner check and does not change SELECT, UPDATE, DELETE, or
collaborator policies. The helper rejects a missing actor, uses an empty search
path, and grants execution only to the authenticated API role.

A private per-owner guard row serializes active project allocations. The trigger
updates that row before its separate count query. This handles competing
READ COMMITTED writes and makes stale REPEATABLE READ/SERIALIZABLE writers fail
instead of accepting an old count. Multi-row inserts and archive restores also
use the guard. Renames, system archives, deletes, and unchanged active ownership
do not write it. An account-delete cascade removes its guard row.

The SQL caller's actual role privileges, not JWT role claims, determine the
existing service/admin quota exemption. Exempt allocations still update the
guard so that authenticated transactions cannot miss them. The private table and
trigger function have no API grants. The migration does not raise tier limits or
count `user_archived_at` as released capacity; the existing rule remains
`archived = false`.

Boundaries: a full-cap INSERT ON CONFLICT can still fail before conflict
resolution, so upload retry must retain its read-before-create path. Concurrent
deletion can cause a conservative quota rejection that succeeds on a fresh
request. Opposite-order multi-owner transactions can deadlock and must retry the
whole transaction. Plan changes and downgrade archiving are currently separate
requests and do not yet join the guard protocol; this is not an atomic downgrade
fix. The documents INSERT policy also retains an inline self-table count plus
storage checks. A separate local PostgreSQL fixture confirmed the same `42P17`
for plain INSERT and INSERT RETURNING, and a count-only definer helper repaired
both while preserving the storage clause. Its 15 checks also prove that the
helper alone still admits an over-limit bulk insert and an archive restore.
The next repair needs document allocation serialization, not just a helper.
Storage is a different boundary: its existing object trigger meters actual
bytes even for storage-service writes, so the project quota's service-role
exemption must not be copied into that trigger. No production
schema, policy, grant, data, or deployment was changed by this local batch.

The trigger's separate reads and same-statement row checks follow PostgreSQL's
[trigger visibility](https://www.postgresql.org/docs/current/trigger-datachanges.html)
and [function snapshot rules](https://www.postgresql.org/docs/current/xfunc-volatility.html).

The disposable PostgreSQL 16.14 harness passes 28 behavioral checks. It first
reproduces both original recursion failures, applies the actual migration twice,
then checks quotas, bulk rollback including trigger side effects, archive/null
transitions, owner transfers, role grants, collaboration and inactive-project
rules, independent-account locks, committed/rolled-back competitors, and stale
REPEATABLE READ/SERIALIZABLE writers. It also proves the separate downgrade gap
rather than hiding it. Independent review accepted the final migration and
confirmed that forged owners get the same error regardless of target capacity
and never wait on the target's guard.

Run the real database checks with
`SURVEY_POSTGRES_INTEGRATION=1 node --test tests/projectQuotaMigration.test.mjs`.
All three opt-in tests pass, including a root rerun with deliberately invalid
inherited PostgreSQL connection settings. The harness scrubs those settings,
uses only its own Unix socket, stops its local server, and removes its exact
temporary cluster. The regular suite keeps this installed-PostgreSQL check as
an explicit opt-in skip; its two source/safety checks still run offline.

Frozen app regression suite: 5,005 tests total, 4,950 passed, 55 skipped, zero
failures or cancellations, exit 0 (prior baseline: 5,002 total). The three added
tests account for two passes and the explicit database opt-in skip; that database
test was also run separately and passed. Production build passes. This is a
local migration/test result, not a live application or production-policy proof.

## Document and object-byte quota repair: local follow-up

`20260908160000_document_quota_guard.sql` moves the document INSERT self-count
behind a no-argument, actor-scoped definer helper. It keeps the inclusive
`get_actual_storage_usage(actor) <= get_storage_limit(actor)` expression. A
separate private document guard serializes active-slot additions, including
bulk inserts, restores, and owner changes, with the same trusted-role and
wrong-owner protections as the project guard. Document UPDATE/DELETE remain
owner/co-owner operations; editor permission alone does not gain those rights.
Direct document roles still take precedence over inherited project roles, and
user-archived documents remain private to their permanent owner.

The storage review found two distinct races in the current BEFORE trigger.
At REPEATABLE READ, two 60-byte files both committed against a 100-byte fixture
limit because the advisory lock did not refresh the transaction snapshot.
At READ COMMITTED, deleting an existing 60-byte object while another transaction
recreated the same path at 50 bytes let that INSERT use the old size as a
non-growth exemption. A competing 90-byte INSERT then committed before the
recreated row became visible, leaving 140 bytes against the 100-byte limit.
The ordinary concurrent READ COMMITTED growth check already worked.

The tested storage design moves quota enforcement to the actual AFTER row
event. That is still inside the same transaction: rejection rolls back the
statement. It distinguishes an actual new object from the INSERT probe of an
upsert, while unchanged/shrinking UPDATEs compare their actual OLD and NEW
sizes. Positive additions update a private per-owner guard before reading the
current total. The owner remains path-derived even for the storage service's
JWT-less writes; there is no service/admin byte-quota exemption. Missing-size
permission probes and zero-byte additions keep their existing behavior. The
guard has no auth-user foreign key, preserving valid legacy/service UUID paths
whose user row no longer exists. No DELETE trigger or extra object-row lock is
needed. PostgreSQL's [trigger rules](https://www.postgresql.org/docs/current/trigger-definition.html)
define the upsert event and transaction behavior used here.

Review caught an additional candidate bug before release: a valid uppercase or
otherwise noncanonical UUID folder could normalize to an owner while escaping
the canonical-prefix SUM. New/growing allocations must therefore use the
canonical lowercase UUID owner folder already used by the app. Existing
same-prefix, non-growing legacy saves stay supported. Negative actual byte
sizes are invalid rather than credits against usage. Read-only live aggregate
checks found zero noncanonical owner prefixes and zero negative, noninteger, or
missing stored sizes in the documents bucket; no object was rewritten.

Adjacent audit only: the live database has the old combined
`trigger_update_storage_on_document_change` as well as the separate insert and
delete triggers, all calling the incremental `update_user_storage` function.
This doubles legacy counter updates on INSERT/DELETE and adds a no-op callback
to metadata UPDATE. Actual quotas and the current app meter use object bytes,
not that counter. Removing only the old combined trigger is a separate bounded
cleanup; this batch does not backfill counters or change legacy views.

Frozen verification for the two forward migrations:

- Document harness: 30 actual PostgreSQL checks passed, including direct and
  inherited project sharing, owner-only metadata changes, byte-gate preservation,
  cap races, restores, transfers, rollback, and private grants.
- Storage harness: 23 actual PostgreSQL checks passed. It first reproduces both
  deployed race shapes, then applies the actual migration twice using a
  non-superuser postgres role with TRIGGER permission on another role's table.
  It preserves unrelated policies/triggers/limits and the existing function ACL.
  Checks cover same/shrinking over-quota saves, upsert event identity, probes,
  zero bytes, invalid sizes/prefixes, renames, owner/bucket moves, null-JWT service
  writes, transaction rollback, private guards, and non-owner legacy paths.
- The combined document harness with `--with-storage-guard` passed all 30 checks
  against both new migrations together. The prior project harness also passes.
  Final root opt-in runs used deliberately invalid inherited PostgreSQL settings
  and still used only their owned local Unix sockets. All clusters stopped and
  their exact temporary directories were removed.
- App suite: 5,011 tests total, 4,954 passed, 57 skipped, zero failures/cancellations,
  exit 0 (prior baseline: 5,005 total). The six added tests contribute four
  offline passes and two explicit PostgreSQL opt-in skips; both database tests
  separately ran and passed. The final fixture-only path-parser correction was
  also rerun through its source checks and full database harness. Build passes.

Same-prefix unchanged/shrinking storage updates now return before the owner
aggregate query, removing that query from ordinary saves as well as avoiding
the guard write. No numeric production latency or egress reduction is claimed.
These migrations are local, not applied to Supabase. Live storage-API upload,
save/retry, and collaboration verification remain required after an approved
rollout. Plan-change atomicity, the duplicate legacy counter trigger, durable
single-file background uploads, and older mutable PDF paths remain open.

## Counter writes and system archive permissions: local follow-up

`20260908170000_remove_duplicate_storage_counter_trigger.sql` removes only the
old combined document storage-counter trigger. Each INSERT and DELETE now
calls the unchanged legacy counter function once instead of twice. Metadata
and annotation UPDATEs no longer call that no-op function. The migration pins
the known function body and checks the exact events, function, enabled state,
arguments, and conditions of all three triggers before changing anything.
Replay still checks the two retained triggers. Unknown drift stops the patch.
It does not backfill the already inaccurate legacy counter or change the
object-byte quota, app meter, views, or function configuration and grants.

`20260908171000_archive_helpers_service_only.sql` removes PUBLIC, anon, and
authenticated execution of four system archive helpers: the downgrade wrapper,
both project archive overloads, and the document archive helper. These definer
functions accept an account ID without checking the caller. Source and live
catalog review found the billing webhook and the postgres-owned wrapper as
known callers, not app RPC requests. The patch keeps postgres and service-role
execution and changes no function body, owner, search path, policy, or row.
All four owner/definer checks run before any ACL write, in one transaction.

The archive tests use the real tracked function definitions and isolated local
users, projects, documents, status rows, shares, and storage objects. They first
show authenticated cross-account calls, then prove client calls are denied for
both own and other accounts while service calls and the nested downgrade still
work. The UUID project overload changes `project_status`; the integer overload
changes the quota `archived` flag. The tests keep that distinction and check
that file bytes, row identities, shares, and other fields survive.

These fixes are local only. They have not changed Supabase permissions or
production counters. A lower callback/write count is verified in PostgreSQL;
no production latency or egress saving is claimed.

Frozen database verification: 26 counter checks and 48 archive-permission checks
passed on installed PostgreSQL. The root combined opt-in run and existing
webhook contracts passed 9/9 tests, with deliberately invalid inherited PG
connection settings. Both harnesses scrub those settings, use their own Unix
socket, stop their server, and remove only their exact temporary cluster. A
separate reviewer also found no migration defects and passed the same three
test files. The final archive fixture pins the confirmed live public search path
and includes non-null user archives; extra PUBLIC/anon grants in that fixture
are synthetic revocation cases, not a claim about live grants.

Full regression suite: 5,017 tests total, 4,958 passed, 59 skipped, zero failures
or cancellations, exit 0 (prior baseline: 5,011 total, 4,954 passed, 57 skipped).
The six new tests add four offline passes and two explicit database opt-in skips;
both database tests also ran separately and passed. The production build and
graph update passed. There is no app-source/UI change in this batch, and these
results do not stand in for live upload, billing, or collaboration tests after
an approved database rollout. Supabase best-practice guidance informed the
least-privilege ACL changes, short migration transactions, and lock-order review.

### Remaining plan-change and caller-scope work

The billing webhook still updates the subscription and archives excess rows in
separate calls, and some database failures are logged before returning HTTP 200.
Its scheduled-cancel email can run before the update error is checked. A stale
subscription update affecting zero rows can still lead to an archive call.
These are open issues, not fixed by the four-helper permission patch.

A local two-session lock fixture reproduced deadlocks for both subscription-first
locking and guard-first locking that takes the subscription row before archive
rows. Taking quota guards, then affected archive rows, then the subscription row
avoided the demonstrated delete cycle. A future service-only plan transition
must use one transaction, a fixed lock order, exact account/customer/subscription
binding, whole-transaction retries, and explicit applied/duplicate/stale outcomes.
Webhook event deduplication and current-state reconciliation need tests before
replacing the existing handlers; timestamps alone are not an ordering guarantee.
Do not invent automatic unarchiving on upgrade or delete bytes during downgrade.

The separate `swap_active_project(uuid,uuid,uuid)` function also trusts its supplied
account ID. It is intended as a self-service operation, so removing authenticated
execution is not the same fix as for system-only archive helpers. Its caller
scope and monthly-swap concurrency need their own behavior tests and narrow fix.
No real account was used to exercise these gaps. Microsoft work stays deferred.

## Legacy project-status API hardening: local follow-up

The live `swap_active_project` and `get_active_projects` functions accepted any
supplied account ID, despite being callable by authenticated users. The former
could change another account's status rows; the latter could return its project
names. The swap cooldown also trusted only the supplied old project's timestamp,
and direct owner UPDATE access to `project_status` let a client clear that date
or activate additional rows. Read-only catalog checks confirmed these grants and
policies. No real account was used to exercise the gaps.

`20260908180000_project_status_api_guard.sql` binds these APIs to the signed-in
actor, while preserving trusted SQL service/admin cross-account use. It does
not trust a caller-supplied JWT role field. The `is_project_accessible` helper
still permits anon execution because project UPDATE RLS calls it; unauthorized,
null, and missing-project requests return false instead of breaking other policy
branches. The project-sharing policies themselves do not change.

Swaps write a private per-account revision row before reading current state.
They then lock the two owned project rows and two status rows in fixed ID order,
and validate ownership and row existence again under those locks. Free users
must swap from an active row to an inactive row. Their 30-day limit uses the
latest existing timestamp across their projects and a durable account timestamp,
so changing the supplied old ID or deleting an old project cannot reset it.
Paid users retain unlimited swaps, including to an already-active project.
Null IDs, identical IDs, and missing status rows no longer report false success.
All changes and the account timestamp roll back together on failure.

Review caught and corrected a timestamp bug in the candidate: `now()` uses the
transaction's start time, which can predate a long lock wait. The function now
captures one `clock_timestamp()` after locking, uses it for the operation, and
never moves the durable account timestamp backwards. The private row write also
makes stale REPEATABLE READ/SERIALIZABLE transactions fail for retry instead of
letting an old snapshot accept a second swap.

Clients retain status SELECT and owner-scoped metadata UPDATE. Status fields,
timestamps, row IDs, and table-level write privileges (including TRUNCATE) are
no longer client-writable. Explicit column grants are also removed before the
metadata grant is restored. Existing service permissions, status-creation and
timestamp triggers, and status policies are kept. No bytes, membership rows,
user archives, `projects.archived`, or document flags are rewritten. Live read-only
counts showed zero projects missing status, zero null active flags, and zero
future swap timestamps; existing null active flags remain treated as active
by the function to preserve its legacy read behavior.

This is a local status-API patch, not a merger of archive models or an atomic
billing workflow. The current app uses quota `archived` flags; it has no direct
status RPC/table callers. The known policy helper caller passes `auth.uid()`.
Direct privileged service maintenance and the older UUID project-archive helper
do not yet join the swap lock protocol. Their races with swaps, plan changes,
and live rollout verification remain separate open work. Microsoft stays deferred.

Frozen local PostgreSQL verification passed 38 checks. The fixture loads tracked
function bodies and current shared-project SELECT/UPDATE policies, pins the
live dependency search paths, and labels its membership resolver as synthetic.
It reproduces the prior read/swap/direct-write gaps before applying the actual
migration, then checks self/cross/anonymous/service roles, direct-login inherited
roles, forged role claims, explicit column-grant cleanup, metadata edits, paid
swaps, rollback/replay, user archives and bytes, shared editor/viewer behavior,
delayed operation timestamps, ownership transfer/delete waits, and cooldown
survival after deleting swapped projects. Concurrent disjoint swaps pass under
READ COMMITTED, REPEATABLE READ, and SERIALIZABLE with both new and existing
guard rows. Stale transactions fail with 40001, not false success.

The root final opt-in test run passed 3/3 with deliberately invalid inherited PG
connection settings. The fixture used only its private local Unix socket, stopped
its server, and removed its exact temporary cluster. Independent source review
found the timestamp defect above before release and no further concrete defect
after its correction. These checks do not claim a live database rollout or full
cross-service billing race coverage.

Frozen full regression suite: 5,020 tests total, 4,960 passed, 60 skipped, zero
failures/cancellations, exit 0 (prior baseline: 5,017 total, 4,958 passed, 59
skipped). The three new tests add two offline passes and one explicit PostgreSQL
opt-in skip; the database test also ran separately and passed. Production build
and graph update passed. No app-source/UI changes or live database writes were
made in this batch. Supabase least-privilege and fixed lock-order guidance shaped
the patch; no production performance gain or broad no-regression claim is made.

### Next durability target: existing-project and standalone single-file uploads

Fresh read-only source review found that `Dashboard.handleUploadClick` and
`handleFileUpload` still resolve/create the cloud row before an unawaited Storage
replacement. Their bytes, replacement/archive choice, parse result, and receipt
live in File objects and React closures, not the durable project-upload journal.
`useStorage.replaceDocument` uses upsert, including for a resolved legacy path.
New standalone paths share `actor/hash.pdf` across projects, and late completion
has no account-generation checks around archive, page-count, refresh, or error
updates. This review did not run browser or cloud tests.

The next change needs a single-document journal/runner with stable IDs, staged
bytes, actor scope, nullable/existing project identity, and explicit replacement
intent before any cloud row mutation. Reuse the existing persistence, lock and
receipt concepts without weakening the project journal's new-project/path
invariants. Published or legacy PDF bytes must not be overwritten blindly; keep
the old version visible until the new upload is confirmed and retain unconfirmed
archive intent. Test restart at each write boundary, lost replies, offline/quota
failure, unavailable local storage/locks, account changes, competing tabs,
dedup/aliases, missing or changed source files, and newer published bytes.

## Follow-up: durable single-file upload recovery

Standalone uploads and files added to existing projects now use a separate
single-file journal, runner and scoped cloud adapter. Dashboard's browser and
desktop entry points share this path. The existing new-project upload journal
and its path rules stay unchanged.

The single-file journal commits owned PDF bytes and replacement consent in one
IndexedDB transaction before cloud writes. Each attempt keeps a stable document
ID and an account/document/hash object path. Metadata-only recovery scans do not
read PDF blobs or start cloud work. Retry and local-only discard share a lock;
same-content attempts also serialize across tabs in the same browser profile.
Account/view generations retire old work, including A-to-B-to-A transitions.

Uploads create objects without overwrite. Reused rows open the current stored
PDF, not the picked original that may predate shared edits. An exact missing
object may be repaired only from matching original bytes after a fresh row read;
a competing repair is read back, never overwritten. Alias changes merge against
a fresh row with compare-and-set checks. A replacement archives the selected old
row only after the new PDF is confirmed, checks the retained consent snapshot,
and keeps unfinished intent for retry. Confirmed deleted targets are not recreated.

Cloud files now open after confirmation rather than while a background upload
is still pending. Local-only document opening is unchanged. The recovery panel
lists failed attempts, supports explicit retry, and asks before discarding a
local retry copy. Discard does not delete cloud rows or storage objects. A known
failed local stage tells the user to retain the original instead of claiming a
saved retry copy exists. Microsoft sync and account testing remain deferred.

Known bounds: IndexedDB is profile-local and clearing browser/app data can erase
pending copies. The current Storage SDK cannot physically abort an upload;
timeouts stop later actions but leave the remote result unknown. A cross-device
same-content insert winner with another ID leaves the losing receipt for review;
there is no automatic object cleanup or retarget. A lost insert reply followed
by hard deletion before any local confirmation still needs a server receipt or
tombstone to distinguish deletion from an insert that never committed. Existing
mutable PDF paths elsewhere in the app have not been migrated to copy-on-write.
No production rollout or full cross-device correctness claim follows from this
local change.

Review also caught compatibility and UI issues before handoff: known aliases
must not prompt again; unknown legacy size/hash must still reach the version
choice without authorizing byte repair; success/discard must clear a stale error;
and busy controls must stay disabled until the final metadata refresh settles.
Shared-project editor/co-owner uploads now use an exact RLS-visible project read
plus the server's `user_can_access_project(proj_id, 'editor')` check. Viewers and
missing/malformed helper replies fail closed. New documents and object paths
remain owned by the uploading actor; host-owned documents are not rewritten.
This verifies the repo helper contract, not the currently deployed helper or
atomic permission revocation during a concurrent upload.

A prompt can outlast a shared PDF edit. The runner now refreshes the published
PDF after an alias prompt, a replacement archive step, or an observed row-version
change. It reads the row again after that download and retains the attempt if
the version changes during the fetch. Ordinary new uploads without those changes
still make one published-byte check, not an unconditional second full download.
Mutable-path edits that do not change row metadata remain a broader storage
versioning limitation; these checks do not replace immutable generations.

Actual-browser QA used the real Dashboard, hook, runner, journal, adapter and
installed Supabase SDK against a localhost-only mock service and synthetic auth.
No existing account, credential, live cloud write, or Microsoft connection was
used. The in-app browser was unavailable because the Mac was locked; a headless
Chromium fallback exercised desktop 1365x900 and mobile 390x844. The temporary
fixture's auth/library/subscription hooks do not prove live RLS, provider auth,
full viewer rendering, or deployed multi-user integration. It did use the real
PDF.js page-count parser and compared the actual viewer-open File's SHA-256.

Twelve workflow checks passed: Home identity/nonblank/overlay checks, lost Storage
reply, mobile recovery controls, full browser-process restart with the same
profile and no automatic writes, manual retry with the same ID, edits during an
alias prompt, known-alias reuse, lost insert reply, failed/retried replacement
archive, and confirmed/canceled local discard. A separate Projects -> Add files
check confirmed the exact project ID, actor-owned document, no automatic viewer
open and persistence after reload. Final mobile discard QA confirmed no stale
error, no retry row, and unchanged mock cloud rows/objects. Page errors were zero;
console errors were the deliberately injected 503 failures and create-only 409
conflict, with the expected handled upload errors. Screenshot review caught and
fixed a temporary fixture toolbar/mobile CSS conflict before the final run.

Next bounded latency/reliability issue: the optional PDF page-count probe can
wait forever on a nonsettling loader, parse or task cleanup. Local reproductions
showed the upload retaining its bytes but holding its locks and busy state after
Storage confirmation and before document creation. Add bounded cancellation and
fallback to unknown page count without weakening durable-byte or stale-account
checks. That fix is not included in this batch.

Another conservative compatibility case needs a focused follow-up: an existing
matching-hash document whose legacy `file_size` is null is accepted by transport
reads but rejected by the runner's document check. Source review suggests safe
read-only reuse could proceed when published bytes exist, while missing-object
repair must still reject unknown size. Do not loosen byte-repair validation to
resolve that case; first reproduce it with the composed runner and transport.

Final frozen verification: 5,152 tests total, 5,092 passed, 60 skipped, zero
failures/cancellations, exit 0. Prior baseline was 5,020 total, 4,960 passed and
60 skipped. The focused upload and existing local-library regression run passed
183/183. Production build, AST-only graph update and diff checks passed. No
high-risk viewer file, production schema, live account or Microsoft code changed.
The 14 checked browser assertions are controlled local evidence, not deployed
auth, production collaboration, or all-platform no-regression proof.

## Bounded optional PDF metadata and legacy reuse — follow-up

The two follow-ups above are now implemented locally. Optional page counting
has one 15-second deadline across reading, module loading and both parse
attempts, plus at most one second per task cleanup. A failed optional probe
returns an unknown count through the upload hooks; it does not lose staged
bytes, block document publication forever, or hold the upload locks indefinitely.
A failed parse whose cleanup cannot be confirmed does not start another parser.
Late promise failures remain observed and cannot start another attempt.

Browser probes own a native module worker from creation and pass its port to
the public PDFWorker constructor. Both wrappers and native ports are released,
and any file/cross-origin wrapper URL is revoked. This also covers a worker that
never answers its initial message: the installed PDF.js worker's own destroy
method cannot terminate that unregistered native worker. The probe never uses
or terminates a viewer's global worker port. Worker startup failure leaves page
count unknown rather than moving optional parsing onto the UI thread. The viewer
parser and its fallback behavior are unchanged.

Account changes and hook unmount abort active metadata work. Single-file uploads
also stop their probe when their view retires. Existing project uploads still
survive hiding Home. Effect-owned controllers remain usable after React StrictMode
cleanup/replay. Runner scope checks still block stale-account cloud writes after
optional failure; staged retry bytes remain available.

Existing matching-hash legacy rows with null file size can now reuse published
bytes. New candidate rows still require an exact numeric size. Missing-object
repair still rejects an unknown size; read-only reuse does not weaken repair
guards. Composed real runner/journal/transport tests cover all three cases.

These deadlines bound asynchronous metadata work, not a blocked browser event
loop, browser suspension, upload hashing, Storage transport, or all PDF viewer
work. A canceled read/module load can finish in the background, but cannot launch
a late parser. Browser file-origin behavior has unit coverage for URL/worker
ownership. Other device/runtime behavior still needs end-to-end evidence.

Controlled Home upload QA passed all six probe modes with the real 15-second
deadline and one-second cleanup bound: normal, stuck read, stuck module load,
stuck parse, stuck cleanup, and an actual native worker that never replies.
Every case published exactly one PDF to the localhost mock, cleared its local
receipt and left upload controls usable. Normal and cleanup-timeout cases kept
the correct one-page count; other stalled cases saved null. The worker-startup
case completed in 17.04 seconds including UI/upload overhead and called native
termination exactly once. Each probe used the real installed PDF.js; fault modes
only held the selected optional stage or supplied a silent native module worker.
The actual hooks, journals, runners and SDK remained in the browser flow. Eight
checks passed including Home identity and final 390px layout; page and console
errors were zero. Screenshots were reviewed. Cloud/auth remained synthetic and
localhost-only; this does not prove live provider permissions or collaboration.

Native Electron file:// helper checks also passed using the exact compiled helper
and installed PDF.js 6.1.200, with an isolated profile and no cloud/auth actions.
A known PDF returned one page; native workers terminated and closed after success
and mid-load cancellation, while pre-cancellation created none. Page errors were
zero and the owned profile was removed. This Electron runtime reports file:// as
both origins and uses a direct same-origin worker file. Its Blob-wrapper branch
was not selected; null-origin/cross-origin wrapping remains unit-tested, not native
end-to-end proven. These checks cover the helper, not an authenticated upload UI.

Frozen regression verification: 5,195 total tests, 5,135 passed, 60 skipped,
zero failures/cancellations, exit 0 (prior frozen baseline: 5,152 / 5,092 / 60).
The focused parser, single/project runner and mounted-hook run passed 181/181.
Production build, AST-only graph update and diff checks passed. No high-risk
viewer file, live schema, existing account or Microsoft code changed.

## Atomic existing-subscription commit boundary — local implementation

Fresh local tests of the actual webhook request handler confirmed 14 cases:
database failures return HTTP 200; stale subscription updates can affect zero
rows but still archive a newer paid account's files; failed archives cannot be
recovered by replay after the first request clears the link or changes the tier;
old events overwrite newer state; duplicate scheduling events repeat email; and
a late checkout can mark a canceled provider subscription active. Stripe/database/
email boundaries in these reproductions were synthetic and local. The existing
webhook is still unchanged; these findings are not claimed fixed in production.

`20260908190000_atomic_billing_subscription_transition.sql` adds a service-only
database commit boundary for an existing linked subscription. It compares the
full typed subscription snapshot, including metadata, counters and timestamps,
and checks exact actor/customer/subscription binding. A stale request does not
change subscription or archive state and does not publish an event receipt.
Client roles cannot call it or read its private receipt table. A trusted SQL role
check also rejects forged JWT role claims if a grant is accidentally widened.

Plan fields, cancellation metadata, oldest-first free-cap archives and the event
receipt commit together. An archive failure or suppressed subscription UPDATE
rolls everything back. Exact event replay returns the saved result without
repeating writes, including after cancellation clears the subscription link.
A changed event binding or digest fails closed. The digest must use canonical
immutable signed event identity/data, not delivery headers, mutable delivery
counts, or the subsequently fetched provider subscription. Receipt retention has
no automatic purge; the actor FK is indexed for account deletion.
Distinct events describing unchanged plan state still receive separate receipts,
but do not rewrite the subscription or advance its `updated_at` refresh signal.

The lock order is account key-share, project/document/storage allocation guards,
affected project/document rows, then subscription row. The account lock prevents
the demonstrated guard-FK/account-cascade cycle. Data/subscription locks use
NOWAIT because other paths can hold a row before reaching a quota guard. The
whole transaction fails for retry on contention, rather than waiting with a
partial plan change. Guard writes also reject stale repeatable-read/serializable
snapshots. Other multi-operation service transactions can still deadlock; callers
must retry the whole transaction on 55P03, 40P01 and 40001 with bounded backoff.

The free caps remain one active project and five active documents, including
user-archived rows as before. ID breaks equal-time ties. Only the system archive
flag changes; storage bytes, document state, shares, user archives and the legacy
project-status model stay unchanged. Upgrades never unarchive files implicitly.
Existing over-cap storage remains intact and is still metered; archiving does not
free storage bytes. Other accounts' data is not changed.

Required next caller work remains: read the current DB snapshot **before** a
fresh provider lookup, construct a validated patch, and apply it through this
RPC. A stale result or retryable SQL error requires a new DB read and provider
lookup, not replay of an old event snapshot. Event timestamps are not ordering
proof. Checkout binding/provisioning, invoice reconciliation, webhook failure
responses and durable email delivery/deduplication still need their own integrated
path and tests. The new function is not wired into the webhook or deployed.
Direct service subscription updates and legacy archive helpers still bypass this
commit boundary. No live billing event, account, migration or Microsoft call ran.

The frozen local PostgreSQL runs passed 35 checks: 24 in the main fixture and
11 in the concurrency fixture. Of those, six are labeled hand-SQL before-fix/
proposed-protocol reproductions; 29 exercise the actual new migration/RPC.
The main fixture loads tracked subscription schema, tier-limit functions and
all three quota guards. Sharing policies, file bytes and the storage-usage sum
are controlled fixture dependencies, not the hosted service. No real storage
service or usage-counter trigger is represented there. Full-row CAS tests
explicitly cover a changed counter. The concurrency fixture uses minimal tables
and labeled tier limits with the actual document guard and new transition RPC.
Both allocation orderings, conflicting event IDs, duplicate delivery across
READ COMMITTED/REPEATABLE READ/SERIALIZABLE, restore contention, account deletion,
zero-row UPDATE, stale link, archive-error rollback, unchanged-state write
suppression and migration replay passed. All disposable servers stopped before
their exact data directories were removed. A separate harness fault check also
verified cleanup after its launcher failed after PostgreSQL had already started.

Frozen full-suite result: 5,199 total, 5,137 passed, 62 skipped, zero failures or
cancellations, exit 0. The prior baseline was 5,195 / 5,135 / 60; the two added
PostgreSQL tests are opt-in skips in the offline suite and both passed separately.
The opt-in test file passed 4/4. Production build, AST-only graph update and diff
checks passed. App/viewer source and webhook code were not changed, so no new
browser or live billing-flow verification is claimed for this database-only step.

### Billing webhook integration — local implementation

This section supersedes the preceding database-only step's caller-work list.
The local webhook now uses `billingReconciliation.ts` and migration
`20260908191000_billing_reconciliation_outbox.sql`. No live function, migration,
Stripe customer, payment or email was changed or tested.

Each handled event first checks its immutable event receipt. New work reads the
full subscription and a private observation revision in one database snapshot,
then fetches current Stripe state. Plan, free-cap archives, revision, receipt and
up to three frozen email intents commit in one transaction. A separate revision
is needed even when the plan row is unchanged: a newer no-op observation must
invalidate an older pending provider read. Unchanged subscription rows still
avoid UPDATE and do not advance the UI's `updated_at` signal.

All stale/55P03/40P01/40001 retries repeat the database-read/provider-read cycle,
with bounded backoff and three attempts. There are no fallback direct plan
writes or separate archive calls. Processing failures return 503, while bad
signatures return 400. Exact retries after a lost commit reply or cleared link
use the receipt; they do not reapply plan or archive writes. Customer identity
comes from the saved database binding. Conflicting event/provider metadata,
environment, subscription, customer or invoice identity fails closed.

Normal initial checkout requires an existing saved customer and an active or
trialing paid subscription. Incomplete/past-due initial subscriptions cannot
grant paid access. No account or missing subscription row is provisioned by a
webhook, and another linked subscription is never replaced automatically.
Obsolete terminal events receive checked ignored receipts without archiving
the current plan. Invoice success/failure events reconcile current subscription
and invoice state rather than copying their old event status into the database.

Billing email uses the existing Brevo service. Account notices keep the bound
Auth email; payment notices keep the freshly validated invoice billing email.
A cancellation first observed by an invoice event can queue both its cancellation
notice and paid receipt. Ordered claims drain both. Event and semantic keys
prevent repeated notices, while schedule/resume/reschedule can send a new
confirmation. Frozen payloads survive retries without switching recipients or
copy. Recorded timestamps and historical wording make clear that a queued
notice is a billing record, not a fresh statement of the current account state.
No billing email contains an expiring portal-session URL.

Only service callers can supply a billing delivery UUID and send deadline.
The provider receives the same UUID on retries. Claims use two-minute leases,
token-fenced completion and a server deadline. Both caller and sender reject
expired work and reserve the provider request budget before sending. Automatic
retry stops short of Brevo's documented 30-minute key lifetime: after 25 minutes
an uncertain send stays in `needs_review`, rather than blindly sending again.
An exact, narrowly recognized processed-key error records acknowledgement, not
proof of inbox delivery. Unrecognized errors and absent provider receipts stay
failures. Arbitrary process suspension, provider delays and cross-service clock
drift preclude an absolute exactly-once delivery claim.

Verification for this integration:

- 23 actual isolated PostgreSQL checks, including actual shared caller → SQL
  checkout, cancellation/archive/outbox, and duplicate-after-unlink flows.
  Role checks, forged claims, no-op revision fencing, atomic rollback, stale
  binding, ordered notices, lease/token fencing, cutoff and migration replay pass.
- 47 actual webhook/shared-module checks with controlled SDK/DB/email boundaries;
  these test caller behavior and do not substitute for SQL atomicity tests.
- 33 sender/policy/layout checks, including deadlines, frozen key reuse, exact
  duplicate handling, rendered billing record text and escaping. Invite policies
  and wildcard CORS remain intact.
- Seven real pinned Stripe signature/actual endpoint checks under Deno, using
  synthetic events and intercepted network access. Raw-body changes, wrong or
  expired signatures fail before database work; a verified database failure is not
  acknowledged. No host credentials or live Stripe call is used.
- Deno type checking covers both changed endpoints and the signature fixture.

Frozen full regression run: 5,263 tests, 5,199 passed, 64 skipped, zero failures
or cancellations, exit 0. The preceding baseline was 5,199 / 5,137 / 62. Both
new opt-in integrations passed separately (PostgreSQL 3/3, Deno 1/1). The
production build, AST-only graph update and staged whitespace checks passed.
No viewer/browser flow, live inbox delivery or live payment is claimed verified
by these local billing tests. The original worktree's scoped app/test files
remain untouched; this work is isolated on the non-Microsoft hardening branch.

Rollout is still gated. Apply prerequisite quota/receipt migrations and 191000
first; verify service-only RPC grants, current schema types and the production
INSERT/RLS issue noted earlier. Deploy and verify the updated `send-email`
contract before replacing `stripe-webhook`. Never roll back to the old direct
write/archive handler after new receipts are in use. Preserve receipts, heads
and unsent/uncertain outbox rows on any rollback.

There is no independent outbox scheduler in this slice. Delivery resumes through
Stripe event retries or an explicitly authorized replay; after Stripe stops
retrying, retained pending/uncertain records need an operator/worker. A live
alert/recovery path and real provider duplicate-response wording must be checked
before rollout. Unknown prices, multi-item subscriptions, non-USD receipt amounts
and statuses not supported by the current database enum (`unpaid`, `paused`,
`incomplete_expired`) fail visibly instead of guessing entitlement or billing
copy. Their product rules and consumers need a separate tested change. This is
not a claim that billing or the broader data architecture is fully optimized.
Cross-device upload receipts/tombstones, immutable old PDF generations, remaining
publish/revocation paths and the approved live rollout remain in scope. Microsoft
365 trials and live Microsoft sync tests remain deferred.

## Document publication and deleted-upload recovery

The actual client journal, upload runner, cloud adapter and installed Supabase
SDK reproduced an insert that committed, lost its reply, then was deleted by
another device before the follow-up read. The pending client still held the same
UUID and could recreate it on retry. This was an offline transport reproduction,
not a write to a live account.

Migration `20260908200000` records opaque document IDs and a deleted flag in a
private table. INSERT and DELETE update this record in the same transaction as
the document. A retired ID cannot be reused, including by service callers.
Account/project cascades retire IDs too; account deletion does not remove the
guard. Actual guard writes protect older repeatable-read/serializable snapshots.
Nonblocking identity locks avoid reverse lock-order waits; normal metadata saves
do not write guards. Client roles lose TRUNCATE permission because it skips row
DELETE triggers. Trusted administrators can still disable triggers or truncate;
those maintenance actions are outside this guarantee.

Migration `20260908201000` checks destination-project editor access at publication
and project moves. Project/member row locks order publication against revocation.
Initial document paths must belong to the permanent owner, so an own document row
cannot grant Storage access to another owner's object through the existing
collaborator-read policy. The tracked SQL fixture reproduced that prior gap; live
policies have not been audited by this test. Existing read/edit RLS stays intact,
and the real project-purge RPC still detaches other users' live documents rather
than deleting them. Administrative import authority depends on the SQL role, not
a caller-controlled JWT role string.

The upload runner treats only the exact server retirement error as terminal.
It keeps the same local attempt, document ID and saved bytes, does not adopt a
different hash match, and shows a clear deletion message. The recovery panel reads
the saved error after reload, escapes it as plain text, and ignores nonstring
values. Retry and Discard do not change their existing meaning.

Verification:

- 28 checks in disposable installed PostgreSQL cover the prior defects, roles,
  cascades, rollback, quota, shared project purge, revocation in both orders,
  reverse delete/insert contention, stale identity/membership snapshots,
  TRUNCATE denial and migration replay. The four opt-in tests passed separately.
- 121 focused client/mounted tests pass, including the real journal/SDK retry
  path and visible persisted errors. Remote HTTP boundaries remain simulated.
- Browser QA used the actual hook/panel and native IndexedDB with a local PDF and
  synthetic server replies. Retry and reload retained all 23,183 bytes and the
  exact attempt/document IDs, with the saved deletion alert visible. No browser
  warnings/errors appeared. The in-app browser was unavailable; a separate Chrome
  tab was used and closed, and the owned local server was stopped. This is not a
  live-auth, full-app or deployed collaboration end-to-end claim.

Frozen full regression run: 5,274 tests, 5,209 passed, 65 skipped, zero failures
or cancellations, exit 0. Prior baseline: 5,263 / 5,199 / 64. The added opt-in
PostgreSQL suite passed separately; the production build, AST graph update and
whitespace checks passed. The original worktree's scoped source/test files remain
untouched.

Rollout remains gated on current-schema/grant review and applying both migrations
after their prerequisites. The client alone cannot prevent recreation on an old
server. IDs deleted before the migration cannot be reconstructed. Preserve the
identity table and triggers on rollback; never purge retired identities. This
adds one small private record per published/deleted identity, not per edit.
It does not solve object cleanup/publication atomicity or provide a cross-device
upload-request winner receipt. An uploaded candidate object can remain after a
retired row is refused. Those paths remain open work, as does authorized live
rollout. No Microsoft, deployment or live account action was performed.

Next confirmed local reproduction: the archive service consumes an RPC's
`orphaned_paths` after commit, then deletes those object names. If a fresh document
UUID publishes the same owner/path in between, delayed cleanup can remove its
PDF. The actual archive service reproduced this with simulated remote boundaries.
Retiring the old document UUID does not retire its storage path. The next slice
must coordinate physical cleanup with publication/storage writes; adding another
reference lookup alone does not close the race. Deferring physical removal is a
safe interim option but retains billable bytes and must be explicit.

## Project purge receipts preserve collaborator drafts

The project archive service previously listed every child ID before purging the
project, then cleared local Yjs state for every listed ID. The server deliberately
detaches live collaborator-owned documents instead of deleting them. The old
client therefore cleared a surviving document's pending local work. The actual
service regression failed before the fix.

Migration `20260908210000` adds `deleted_document_ids` from the actual SQL
`DELETE RETURNING` result. IDs, count and candidate paths now describe the same
deleted rows. The service removes its child-list query and purges local state
only for a valid receipt. Old servers or malformed receipts keep local copies;
an additive `localCleanupDeferred` flag reports incomplete local cleanup without
calling an already committed server deletion a failure. A lost response followed
by an idempotent empty receipt can leave deleted local caches; no unrelated cache
is guessed or removed. A durable cleanup-receipt replay remains future work.

The RPC locks child rows before splitting live-detach and archived-delete work.
A concurrent restore cannot make a child live between those steps and then lose
it to the project cascade. Lock contention fails promptly and rolls back the
whole purge. The copied owner check is now NULL-safe, anonymous/public execution
is revoked, and authenticated callers retain access. This does not assert that
all other archive RPC grants have been hardened or audited live.

The focused tests exercise actual service code, actual Yjs cleanup, installed
y-indexeddb and fresh persistence reopening. Browser QA additionally used native
IndexedDB: save two drafts, invoke the actual project service with a synthetic
server receipt, delete, reload and cold-read. The deleted draft database was gone;
the collaborator's exact unsent drawing text remained. Page identity, rendering,
interaction and console checks passed with screenshots. The in-app browser was
unavailable, so this used a separate Chrome tab, since closed; the owned fixture
server was stopped. No live-auth or full Archive-screen QA is claimed.

The focused local service/archive/persistence run passed 31 tests. The expanded
disposable PostgreSQL fixture passed 33 checks, including exact deletion receipts,
shared-path preservation, both restore/purge orderings, atomic lock-failure
rollback, anonymous/missing-user refusal, and the privileged nested caller using
the scheduled sweep's exact owner-claim setup. That last check covers the caller
contract, not cron scheduling or the whole retention job.

Full regression run: 5,288 tests, 5,223 passed, 65 skipped, zero failures or
cancellations, exit 0 (previous baseline 5,274 / 5,209 / 65). The final opt-in
PostgreSQL wrapper passed 5/5 after the added caller/race cases. Production build,
AST graph update and staged whitespace checks passed. No scoped source/test
changes were made in the original worktree; no push, deployment or live mutation.

Apply the additive receipt migration before expecting local cache reclamation.
Do not roll the client back to clearing a pre-read child list. Physical Storage
deletion is unchanged in this batch and its known race remains open.

## Storage cleanup: verified provider boundary

Official Storage source at commit
`b41d14fa15547284b351ea024f8c83a201cdc83a` establishes why a stronger protocol is
needed. This is source evidence, not the deployed project's version:

- `deleteObjects` runs metadata DELETE/RETURNING, then physical version-key
  deletion, then commits the database transaction. A later commit failure can
  roll back metadata/trigger state but cannot restore bytes. Therefore retirement
  must commit in a separate checked RPC BEFORE a Storage deletion request; a
  DELETE trigger cannot safely establish the first retirement inside that call.
- Upload permissions are tested in a rolled-back transaction, then bytes upload,
  then an elevated final metadata upsert commits. Initial RLS checks alone cannot
  fence late upload completion. Final role-independent metadata checks and
  document-publication checks must share permanent path state.
- Rejecting final publication can still leave bytes awaiting provider cleanup.
  Missing metadata does not trigger row deletion. Lost delete replies and
  backend partial failures must not be described as verified byte removal.

These findings drive the implementation below. Supabase discourages Storage
schema changes; custom final-write guards require version-pinned provider tests
and a live compatibility check before rollout. No migration has been deployed.

## Committed path retirement and durable cleanup

Migration `20260908220000` adds a private path guard and cleanup queue. Document
deletion or path changes queue the old exact path in the same transaction. The
retirement RPC checks every surviving reference, including shared and archived
documents, then permanently retires only unreferenced paths. Short advisory locks,
real guard-row writes and two-second lock timeouts protect concurrent writers and
old transaction snapshots. Retired paths never reopen. The guard uses a path hash;
pending jobs keep exact paths privately until acknowledged and have no user or
document foreign key that could erase retry state during account deletion.

The Storage metadata trigger requires retirement to have committed in an earlier
transaction before deletion or an outgoing move. It rejects publication, new
metadata and version-changing writes to retired paths, including privileged
Storage completion. Metadata-only refreshes and normal nonretired replacements
remain supported. Trigger replacement does not require dropping a provider-owned
trigger; grant checks fail closed if application roles can still truncate the
protected tables. Provider ownership, schema and version compatibility remain
rollout gates, not local-fixture claims.

One shared client/Edge helper now performs retire, Storage API remove, then
acknowledge in that order. It serves document and project archive deletion, the
generic file-delete hook, scheduled cleanup and account deletion. It rejects
malformed or incomplete receipts and never falls back to an unguarded remove.
Requests use batches of 100, a 15-second request timeout, a 45-second work budget
and a 200-request ceiling. Failed batches split within those bounds so one bad
path need not stop healthy paths. Timed-out provider requests may still finish;
the committed retirement and durable retry state make that safe for publication.
An acknowledged path means the API replied and metadata is absent, not a separate
physical byte audit.

The scheduled sweep drains old jobs even when no new document rows are purged.
Its service-only queue claim skips locked rows and paths with surviving references,
and delays claimed jobs for one minute before returning them. A failed oldest
batch therefore cannot repeatedly exclude later work. Lost replies remain safe
to retry. Archive services preserve a successful row purge while reporting pending
storage cleanup; account deletion stops before final auth deletion if cleanup is
pending or a shared reference survives. Dry-run sweeps do not claim jobs.

Verification for this batch:

- Full suite: 5,385 tests, 5,318 passed, 67 skipped, zero failures or cancellations,
  exit 0. Prior baseline: 5,288 / 5,223 / 65. The two added opt-in skips were also
  run explicitly below.
- Combined disposable PostgreSQL run: all 33 earlier publication/quota/purge
  checks plus 28 storage checks passed with the new migration installed; wrapper
  result 9/9. This includes old snapshots, rollback after a simulated external
  delete, privileged final writes, shared paths, claim fairness and hosted-style
  non-owner trigger replacement. Physical provider deletion is an explicit stub.
- Actual Edge handlers and installed pinned SDK passed 14 checks (wrapper 2/2)
  with synthetic network replies; Deno type checking passed without network access.
- Shared helper and client/service focused tests passed 147/147, including lost
  replies, malformed receipts, retry limits, partial failures and Yjs preservation.
- Browser QA used the actual project archive service, shared helper and native
  IndexedDB with synthetic SQL/Storage replies. Delete followed the checked order;
  a shared PDF and collaborator's unsent drawing survived deletion and reload.
  Screenshots, page state and console checks passed. The in-app browser was
  unavailable, so a separate Chrome tab was used. This is not full Archive-screen
  or live-auth/provider QA. Production build and AST graph update passed.

This batch left account-closing protection, historical cleanup review, and live
provider compatibility/physical cleanup tests open. The next section records the
account-closing implementation and the historical evidence limit. Do not treat every unreferenced object as
garbage: it may be a legitimate upload awaiting publication. The current app's
new-upload paths include fresh document/project/operation IDs; retry after
retirement must use a new operation path. Other upload protocols, including TUS
and S3-compatible clients, still need proof that every physical replacement
changes the metadata version. Immutable PDF generations are separate future work.
Microsoft, production data, billing accounts and external services were untouched.

## Account closure fences late publication and preserves foreign documents

Migration `20260908230000` keeps the existing `delete_account_owned_rows(uuid)`
API, but closes publication and removes owned roots in one transaction. The old
RPC left the account writable during Storage cleanup, so an upload to a previously
unseen name could arrive after inventory. It also deleted owned projects without
detaching collaborator-owned children, allowing the project FK cascade to delete
another user's documents.

The new private `account_write_guards` table retains only a UUID and closing flag,
with no auth FK. Normal publication uses a shared row lock, not a per-write update
of that row, so healthy writers can proceed together. Closure updates the flag and
waits for admitted writers, then locks owned projects, documents, templates and
foreign children with NOWAIT before any deletion. Conflicts roll back the flag,
row changes and pending cleanup jobs. Foreign children are detached with their
archive state, annotations and document shares intact. This includes archived
foreign documents, not only active ones. An unchanged pure detach remains allowed
while the other owner is closing; detach combined with identity/owner/path changes
does not get that exception.

All SQL roles must pass the new publication checks. They cover old/new root owner,
destination project owner, and a new/changed document path's account prefix.
Storage final INSERT/UPDATE checks the destination account prefix even when the
version stays unchanged. Valid UUID aliases normalize to the same permanent
closing marker. Retirement, provider API removal and cleanup acknowledgment remain
allowed after closure; already-shared files are preserved rather than force-deleted.
The service RPC checks actual SQL role privileges, not a JWT role string. NULL
targets fail; a trusted call for a missing UUID can retain a permanent closing
marker and retries remain idempotent.

Closure explicitly requires READ COMMITTED. Shared healthy writes do not change
the guard row, so an older closure snapshot could otherwise miss rows those writers
committed. Ordinary stale writers fail closed under READ COMMITTED, REPEATABLE
READ and SERIALIZABLE, including when the guard did not exist in their snapshot.
This matches [PostgREST's documented default isolation](https://postgrest.org/en/stable/references/transactions.html)
and follows [PostgreSQL's row-lock and snapshot rules](https://www.postgresql.org/docs/current/explicit-locking.html).
Live project isolation settings still need verification. The Postgres guidance
influenced the shared-lock design and short lock waits; no network request runs
inside the database transaction.

The Edge account handler now rejects null, oversized or malformed Storage pages
and invalid entries before final auth deletion. A null page previously reached
the auth-delete call as though no files remained; the actual handler regression
failed before the fix. Valid null-ID folders and exact raw file names still work.
Billing remains first, then the atomic closing/purge RPC, Storage cleanup and auth
deletion. This batch did not change billing or call any live deletion endpoint.

Verification:

- Full suite: 5,389 tests, 5,321 passed, 68 skipped, zero failures/cancellations,
  exit 0. Previous baseline was 5,385 / 5,318 / 67. The new opt-in PG skip was run.
- Actual disposable PostgreSQL: 38 new account checks, all 33 prior publication,
  quota and archive-purge checks with 230000 installed, plus the separate 28-case
  storage suite; combined wrapper 13/13. Fixtures use tracked guards, with synthetic
  base tables/entitlements, not a full live-schema restore. One denial code changes:
  a missing destination project now returns 23503 before the older 42501 check;
  the test verifies no row or guard side effects.
- The new cases exercise both close/write orders for all four write kinds, shared
  healthy writes without guard rewrites, existing/absent stale snapshots, atomic
  lock-conflict rollback, cross-owner paths, old/new ownership changes, pure detach,
  incoming Storage moves, metadata-only writes, UUID aliases and retained cleanup.
  The both-closing detach branch uses an explicitly staged private flag, not a
  claim that foreign roots survive their own completed closure RPC.
- Actual Edge handlers and pinned SDK: 22 checks, wrapper 2/2, with synthetic network
  replies. Includes failed core RPC/listing, invalid inventory, nested folders and
  201 files across three pages/batches. Deno type check, production build and AST
  graph update passed. No UI source changed; no live-auth, provider-byte or
  full account-screen proof is claimed.

Bounds still matter: this guard covers the three owned root tables and UUID
namespaces in the documents bucket, not every historical non-UUID sidecar name or
other bucket. Alias admission is fenced, but the existing canonical-prefix scanner
does not discover old alias paths. Raw privileged auth deletion must use this
workflow; it is not intercepted by an auth-schema trigger. A surviving document
that references the closing owner's file correctly stops storage/auth deletion;
copy/transfer policy needs an explicit decision, not forced removal. The recursive
account inventory still gathers all paths before deletion and needs a separate
bounded large-account cleanup design. No Microsoft work, push or deployment.
Read-only Supabase project discovery and direct lookup of the repo's configured
project both failed with connector HTTP 522 in this turn. No schema, grants,
isolation settings or deployed Storage version were verified live.

## Bounded account Storage cleanup with durable scan progress

Migration `20260909000000` and the shared `accountStorageCleanup.js` helper replace
the recursive full-account inventory. The service-only claim RPC reads at most
100 raw keys from one source per call. It alternates Storage metadata and pending
cleanup jobs, keeps a separate cursor for each, and skips an exhausted source
until the other finishes. Both cursors reset only at the end of a cycle. A lost
reply or failed early path therefore does not prevent later keys from being
offered, and remaining keys return in a later cycle.

Reference checks run after the bounded raw page, not before it. Fully shared pages
still advance the cursor without reading the rest of the account. A separate
`has_remaining` check includes all canonical-prefix metadata and queued paths,
including references, so an empty eligible page cannot authorize auth deletion.
Names shared by both sources may be offered more than once; retirement/removal/
acknowledgment remains idempotent. Claims do not retire paths or change Storage
metadata. Cursor updates commit before the caller receives its page.

The claim requires a committed account closure. A private transition trigger
records the top transaction ID, which also catches uncommitted closure inside a
savepoint. Preexisting committed closures get receipts under an installation
table lock. No `xmin` wrap arithmetic or role-claim bypass is used. The migration
and claim use READ COMMITTED; absent receipts, failed cursor updates and invalid
callers fail closed. The cursor table has no auth FK, so auth cleanup cannot erase
retry state.

Storage keysets use the provider's existing bytewise `(bucket_id, name COLLATE C)`
index; this migration does not add a provider-owned index. The private queue uses
a bounded 36-character prefix plus SHA-256 key index. Its index entries do not
contain full path text: a test confirms an allowed 2,048-character Unicode path
exceeds the full-text B-tree entry limit but remains valid in the new index and
is scanned exactly. Matching the document reference lookup's default collation
keeps its existing `idx_documents_file_path` usable. The Postgres pagination and
index guidance led to these separate keysets and fixed-size index keys.

The Edge Storage stage makes at most three claims per request and shares one
45-second work budget, with a 15-second maximum per request. It passes only the
remaining time into the existing guarded remover. A normal claim/removal uses
bounded batches; any cleanup error or retained path stops the stage as pending.
The prior 200-request bound within the remover still applies; no full list or
recursive folder walk remains. These bounds apply to the Storage stage, not the
earlier billing, auth lookup or core SQL purge.

Unfinished work returns `202` with `deleted:false`, `pending:true` and a clear retry
message. A later authorized deletion request resumes the server-side cursors; no
client cursor or automatic actor-switching retry is added. The unchanged
`requestAccountDeletion` helper rejects pending results and only resolves
`deleted:true`. Thus AuthContext cannot sign out merely because one bounded request
ended. The actual self-service delete button remains disabled; this batch does
not enable a new deletion UI or a background account-deletion worker.

Verification for this batch:

- 53 account-helper tests plus 66 existing cleanup tests pass. They exercise the
  actual shared helpers with synthetic service replies: budgets, lost replies,
  partial failures, long/raw keys, shared pages, durable-cursor retries and exact
  completion checks. The broader helper/client/endpoint run passed 144 tests.
- Actual Edge handlers and pinned SDK pass 22 checks, including malformed scan
  replies, nested raw names, three-claim pending progress, and a retry that obtains
  an independent empty receipt before final auth deletion. Deno type checking and
  production build pass; no live billing, account or Storage requests were sent.
- The new disposable PostgreSQL fixture passes 20 checks, including savepoints,
  limit-one source fairness, lost claim responses, rollback, overlap, shared-prefix
  progress, source exhaustion and migration replay. The prior 38 account-closing
  cases also pass with the new scan migration installed. These are installed PG
  tests with actual tracked functions, not a full hosted-schema restore.
- With 100,000 unrelated rows in each source and another 100,000 documents, both
  raw-page plans read exactly 100 indexed rows with no rows removed by filtering.
  Each used 100 index-only document-reference lookups. This proves the fixture's
  matching-index access paths, not hosted latency or a query plan on every provider
  version. Root opt-in wrapper verification also includes the earlier publication
  and Storage suites; live compatibility remains gated.
- Browser QA at the isolated local fixture used the actual request/cleanup helpers
  with synthetic SQL, Storage, cursor and session state: stage 350 files, run a
  three-claim batch, keep the session with 50 files left, reload, resume, then allow
  simulated sign-out only after a fresh empty receipt. Identity/content, no overlay,
  console, screenshots and interactions passed. In-app browser acquisition failed,
  so a separate Chrome tab was used and closed; the owned server was stopped. This
  is not full AccountSettings/AuthProvider or live-auth testing.

The final full suite passed: 5,447 tests, 5,378 passed, 69 skipped, zero failures
or cancellations (585 files, exit 0). The prior committed baseline was 5,389 total,
5,321 passed and 68 skipped. The opt-in PostgreSQL wrapper run passed all 17 tests
with no skips. AST graph update and diff checks also passed.

Read-only hosted checks on September 8, 2026, at about 18:36–18:39 UTC succeeded,
after the earlier access failures recorded above. The database reports PostgreSQL
17.6; the connected SQL session uses READ COMMITTED. Catalog checks confirm valid,
ready, nonpartial indexes for `(bucket_id, name COLLATE "C")` and a unique
`(bucket_id, name)` index. A read-only EXPLAIN for a synthetic account prefix chose
an index-only scan with bucket, lower/upper prefix and cursor bounds. This is
hosted plan evidence, not measured hosted latency or Storage API version proof.

The migration role has the Storage trigger privilege and TRUNCATE grant option.
The hosted `anon`, `authenticated` and `service_role` roles still have TRUNCATE on
`storage.objects`; the local retirement migration's revocation and postcondition
have not been deployed. Those grants must be removed as part of the guarded
rollout because TRUNCATE bypasses row triggers. This does not mean PostgREST exposes
a raw TRUNCATE endpoint. These checks used read-only transactions and did not
change any grant, schema, account, billing or file data.

Remaining gates: Storage API version/custom-trigger compatibility, physical
provider deletion proof, noncanonical/legacy namespace discovery, large core-row
purge budgeting, and shared-file transfer policy. A future provider layout with
duplicate object names across versions requires its own compatible inventory
design. Do not deploy the new Edge handler before the claim migration: a missing
RPC deliberately leaves cleanup pending. No Microsoft work, push or deployment.

### Next safety gap: new billing during account closure

A separate source audit found that `create-checkout-session` can replace a deleted
customer and create Checkout while the account is closing. `delete-account` reads
one customer ID before cancellation and does not track concurrent provider creates.
Thus cancellation of C1, persistence of C2, then auth deletion can leave C2 outside
that cleanup request. Portal creation also lacks a closing check. Existing webhook
customer binding, fresh provider reads, revision checks and receipts do not reject
a still-present closing auth user.

This batch does not fix that race. The next boundary needs durable billing-deletion
state and tracked in-flight provider operations, with new checkout/portal operations
and customer replacement denied once deletion begins. Auth deletion must wait for
confirmed billing cleanup. Cancellation and invoice reconciliation must remain
possible: closing alone is not a cancellation receipt. A one-shot preflight check
or final customer reread cannot cover a provider create that finishes afterward.

## Billing lifecycle: durable SQL contract, endpoint integration still pending

Migration `20260909010000` implements the database part of the billing race fix.
It is not deployed. Checkout, portal, account deletion and the provider runner do
not yet call these new RPCs. This is tested progress toward the full boundary,
not a claim that live billing or the whole deletion flow is fixed.

The service-only contract is:

| RPC | Persisted result |
| --- | --- |
| `begin_billing_operation` | One admission for a frozen actor, operation UUID, kind, provider scope, request spec and expected customer. |
| `settle_billing_operation` | Exact confirmed result and any customer that still needs cleanup, even after closure or auth removal. |
| `begin_billing_account_closure` | Permanent account closure plus the current linked customer's cleanup record. |
| `claim_billing_customer_cleanup` | At most 100 exact candidates with a saved cursor; no candidates while an operation remains unresolved. |
| `ack_billing_customer_cleanup` | Removal receipt for an exact, already registered customer and provider scope. |
| `read_billing_account_closure` | Readiness based on pending work and coverage of the current customer, never on page emptiness. |

Only the first committed begin response with `outcome:admitted` can authorize
one provider call. Exact replays return `pending` or `settled`; they never renew
permission. Changed actor, kind, scope, spec or customer fails, including after
settlement. The server records an immutable admission timestamp for future
recovery checks. A caller must await the RPC commit before contacting Stripe;
an admitted value observed inside an uncommitted SQL transaction is not enough.

`pending` has no age-based release. A timeout or lost result is not a confirmed
failure. Settlement accepts only an exact successful result or a provider-confirmed
failure that created no new resource. The latter is a trusted service attestation,
not something SQL can independently prove. A successful late customer creation
records cleanup separately from linking a subscription, so a rejected binding
cannot erase the new customer's cleanup duty. Known checkout/portal customers
must match the subscription row and are registered before admission.

Provider scope fixes test/live mode, account and API version. The legacy
subscription row does not store this scope; the future runner must verify it
from the configured provider, not infer it from the customer ID. Existing
pre-ledger orphan customers remain a separate inventory/reconciliation gate.

A permanent customer-owner table follows the existing globally unique bare
customer column. It keeps the original account even after a binding is cleared
or auth is removed. This prevents cleanup for A from deleting a customer later
claimed by B. Same-account stale-customer clearing/replacement stays allowed
while open; cross-account reuse is rejected. The new trigger allows unchanged
customer/owner writes, so counters and cancellation reconciliation still work
during closure. Supported sharing/collaboration uses separate project/document
permissions; it does not transfer billing-customer ownership.

Operation, ownership, cleanup and closure records have no auth foreign keys.
Client roles cannot read or write them. Service RPCs verify the actual SQL role,
not a claimed JWT role, and require READ COMMITTED. Short transactions use
fail-fast locks where a subscription tuple could reverse the account/customer
lock order. No SQL transaction waits for Stripe. Claims and acknowledgments
reject closure made in the same top transaction, including nested savepoints;
status cannot report complete until that closure has committed.

Pending checks use indexed `EXISTS` rather than counts over all history. Cleanup
uses a partial index and a `(provider_scope, customer_id)` cursor, advances before
returning the batch, and wraps at the end. Failed or lost batches recur in a later
cycle without blocking access to later customers. Completion still checks all
unresolved operations, remaining customer records and the linked customer's
removal receipt. No record is treated as removed just because its page was read.

The one-time owner backfill uses set-based conflict checks under table locks,
not one advisory lock per historical customer. Conflicting historic ownership
aborts the migration. Installation size and lock-window checks remain required
before deployment. Pending request/result payloads are capped at 16 KiB per
object; receipt retention and redaction of settled payloads still need a policy.
The future runner must never put credentials or full provider responses in these
records. No timer-based deletion of unresolved work is permitted.

Verification:

- 25 new installed-PostgreSQL lifecycle cases cover single-use/replayed admission,
  concurrent begin/close, rollback, committed-closure checks, late settlement,
  exact customer ownership, cross-account reuse, malformed input, role spoofing,
  stale isolation levels, failed-page fairness, auth removal and migration replay.
- The same fixture runs all 23 prior webhook/revision/outbox/quota cases with the
  new guard installed. It also applies a real cancellation transition after
  closure, retaining the customer link and allowing the expected archive changes.
- With 50,000 retired operations and 50,000 removed customer records, the pending
  probes use their partial indexes without filtering retired history. These are
  local query-plan checks, not hosted latency or live Stripe proof.
- All 8 opt-in PostgreSQL wrappers passed, including the earlier atomic transition
  and separate lock-interleaving suites. The full Node suite passed with 5,448
  tests: 5,379 passed, 69 skipped, zero failures/cancellations, 585 files, exit 0.
  The previous committed baseline was 5,447/5,378/69. The final timestamp change
  was followed by another passing opt-in PostgreSQL run; the final focused wrapper
  confirms all 48 combined SQL cases. Production build and AST graph update passed.
  No UI source changed; browser testing cannot establish this unwired SQL contract.
  No live auth, billing or Storage mutation.

Still required: wire the three endpoints and final auth-deletion readiness check;
record old scoped customers before rotation; implement recovery for lost replies
and interrupted workers; verify late checkout/portal effects with the actual
provider; and test the full authenticated route under account leases. An
idempotency key alone cannot support unbounded provider retries: Stripe may prune
keys after 24 hours, so recovery needs a bounded, verified protocol rather than a
new admission. [Stripe idempotency reference](https://docs.stripe.com/api/idempotent_requests)

No auth-schema trigger is installed. Direct service/admin auth deletion can still
bypass the planned endpoint readiness check; existing durable receipts survive
that bypass. A rollback must preserve these receipts and the permanent owner
records, never turn unresolved work into success or restore unsafe customer reuse.
Microsoft remains deferred; nothing was pushed or deployed.

## Billing endpoints: durable admission, positive recovery and closure

The checkout, portal and delete-account handlers now use the durable lifecycle
ledger. Deploy both lifecycle migrations before these callers. Provider identity
uses the actual Stripe account, key mode and pinned API version; a generic 404 or
an empty search never proves that an old customer or unknown request is absent.

Each creation commits its exact actor, kind, provider scope, customer and bounded
request spec before one provider POST. The SQL actor lock permits only one pending
request per kind, including two callers that both passed a preflight read. A lost
admission reply grants no POST permission. Lost settlement replies use an exact
read or repeat SQL settlement, never another provider POST. Provider SDK retries
are disabled and each SDK request has a 15-second timeout. Recovery and cleanup
have bounded pages and a 45-second per-helper time budget, not a whole-endpoint
deadline. Unresolved work never ages into success or permission for a new POST.

Customer recovery requires an exact metadata/spec digest match. Checkout recovery
uses customer-scoped session pages; portal recovery uses exact creation-event
idempotency keys. Fair persisted cursors prevent one page from blocking all later
work. Matching recovered checkout URLs are reused only when the fresh list says
the session is open and supplies a future expiry. Both kinds retain their reuse
deadline and check it again immediately before selection. Portal reuse uses an event from the past
60 seconds (a conservative local policy, not a promise of provider URL validity).
Different request specs, completed/expired checkouts and older portal events settle
the old request but do not reuse its URL. Search and event retention limits may
leave requests pending for support review; they cannot establish non-creation.

Closure commits before provider deletion, row purge or Storage cleanup. Exact
confirmed customer deletion revokes only pending checkout/portal calls for that
same provider scope and customer. A late reply cannot replace the removal receipt
or return its URL. Unknown customer creation stays pending and may later reveal a
new cleanup candidate. Auth deletion requires a fresh independent complete billing
receipt after Storage cleanup. Missing Stripe configuration now blocks deletion
even for a nominally free account, rather than assuming there was no billing work.
Legacy missing-customer responses require review; exact deleted-customer receipts
still permit guarded link clearing and rotation. The account deletion UI remains
disabled; no live deletion flow has been enabled or exercised.

Verification for this slice:

- 112 runner cases cover admission races, lost replies, recovery, bounded work,
  malformed receipts, scope mismatch, late calls and exact-spec session reuse.
- 61 actual isolated PostgreSQL cases pass: 23 existing reconciliation cases,
  25 lifecycle cases and 13 recovery cases. These include a separate-session
  admission race, permanent ownership, known-only revocation, cursor fairness,
  role checks and indexed pending probes against retired history.
- 22 retained Storage and 43 billing cases load the actual Deno handlers with
  the pinned SDK and synthetic HTTP. No network permission or live account is
  used. A lost session reply followed by recovery returns the first matching URL
  with the provider-create count still one. Four endpoint wrappers pass.
- Deno type checking, production build and AST graph update pass. The release
  check now validates the pinned version through the shared constant and includes
  delete-account. Initial full-suite checks exposed stale source-shape assertions;
  those were updated to verify the new seams without relaxing the version gate.
- Final `npm test` passed: 5,563 total, 5,494 passed, 69 skipped, zero failures
  or cancellations, 586 files, exit 0. The committed baseline was 5,448 total,
  5,379 passed and 69 skipped across 585 files. Opt-in SQL and Deno checks were
  also run directly; their skipped default wrappers are not counted as live proof.
- Local browser fixture at `http://127.0.0.1:5240/` rendered the real checkout
  component and destination helper at 1200x732. Pending reply showed its inline
  error, kept the button usable and opened no destination. Success cleared the
  error and passed the exact recovered URL to a synthetic Electron destination.
  Page identity, nonblank content, no framework overlay and both interactions
  passed. Console contained only the deliberately injected pending error after
  the fixture favicon was fixed. Screenshots were inspected locally. In-app
  browser failed with `Browser is not available: iab`; Playwright was used.
  This proves the component reply contract, not authenticated billing, popup
  behavior, the real Electron shell or live Stripe effects.

Remaining work: a settled customer whose binding fails before commit stays in the
cleanup ledger but is not found by the pending-only recovery scan; retries can
still create extra unbound customers. Add a guarded reuse/retirement protocol,
not immediate deletion of a possible concurrent binding winner. Also add a shared
whole-endpoint deadline, reviewed receipt retention/redaction, and scoped support
tools for unresolved legacy requests. Settled session reuse across a later lost
HTTP response is not yet a persistent request-intent protocol. These are known
limits, not proof that optimization is finished. Deployment needs migration/lock
checks and leased authenticated tests; live provider effects remain unverified.
No pushes, deployment, customer mutations or Microsoft testing in this slice.

Provider references: [customer deletion](https://docs.stripe.com/api/customers/delete),
[search consistency](https://docs.stripe.com/api/customers/search),
[idempotency retention](https://docs.stripe.com/api/idempotent_requests),
[event listing](https://docs.stripe.com/api/events/list).

## Reuse a created customer after interrupted binding

`20260909030000_billing_customer_reuse.sql` closes the settled-but-unlinked
customer gap above. New confirmed customer creations become `available` only
when their exact customer has no prior binding or removal fact and the account
is open. A subscription binding changes that operation to `bound` in the same
transaction, including changed bindings made by older/direct writers. Clearing
the link never makes a once-bound customer available again.

The permanent owner record now has an `ever_bound` exclusion bit. Every owner
present at migration time starts excluded: old receipts cannot prove the absence
of a former binding. This is conservative, not a claim of known history. New
owner registrations alone default to false. Existing operations stay `untracked`;
an old pending creation that settles against a preexisting owner cannot become
automatically reusable. Replaying the migration preserves all later facts.

A service-only lookup reads at most one raw indexed candidate across all provider
scopes. An earlier wrong-scope or untracked record needs review; the query does not
scan past it. New customer admission checks the same available/untracked set under
the account lifecycle lock, so a stale empty preflight cannot authorize a duplicate.
There is no timeout that releases an unresolved or untracked creation.

Checkout now runs this lookup before creating a customer. A candidate must match
the exact actor, scope, operation, settled result and metadata/spec digest at the
provider. Linking uses the current-binding CAS. A crash before the binding commit
leaves a reusable customer; a lost reply after commit returns the existing bound
customer on retry. A different CAS winner gets its own provider identity/mode
check before checkout, including the legacy clear and fresh-creation paths.

An exact deleted-customer tombstone may retire an unused candidate. The retirement
RPC checks the actor, scope, operation and customer, rejects a currently bound
customer, and records disposition plus the scoped removal receipt together. A
404, timeout, malformed deletion flag or missing proof does not retire anything.
Changed bindings cannot reattach a customer with a removal receipt. Runtime reuse
only reads provider state; it does not delete a customer or make a provider POST.
All reuse helper calls share its bounded time budget. SDK retries remain disabled.

Verification:

- 184 runner checks pass, including 72 additions for restart reuse, lost binding
  replies, concurrent winners, exact proof, malformed receipts and timeouts.
- 75 actual local PostgreSQL cases pass (61 retained plus 14 reuse cases), with
  separate-session races, failed-update rollback, role/isolation checks, historical
  owner conservatism and migration replay. The exact lookup reads one indexed row
  through 50,000 retired successes; it does not filter through that history.
  The fixture also loads the current subscription RLS migration: an authenticated
  client's own-row UPDATE changes no rows and INSERT fails, without changing any
  billing fact or operation. The service recovery path remains valid.
- 74 billing and 22 Storage cases run the actual Deno handlers and pinned SDK
  with synthetic HTTP and no network permission. Crashes before and after binding
  retain one customer creation; invalid or unverified winners never reach checkout.
  All six SQL wrappers and four endpoint wrappers pass with their opt-in checks.
- Deno type checking and production build pass. No UI source or browser route was
  changed in this slice; prior component reply-contract evidence remains separate
  from these endpoint tests. No real provider, auth, Storage or Microsoft mutation.
- Full `npm test` passed with 5,636 total tests: 5,567 passed, 69 skipped, zero
  failures or cancellations across 586 files, exit 0. Baseline was 5,563 total,
  5,494 passed and 69 skipped. Final focused checks passed after the additional
  RLS fixture test; the opt-in database checks are separate from skipped defaults.
  AST graph update passed. Generated graph files are not part of this commit.

Deployment still needs ordered migrations, lock-window review and leased live
account/provider tests. Old untracked records need a scoped support review, not
guessed reuse or a bulk deletion. Direct legacy clears still require a verified
service caller and old-customer recording; the database cannot recover pre-ledger
orphans. Whole-endpoint deadlines, persistent request-intent handling after a lost
final HTTP response, and receipt retention/redaction remain open.

The wider data-layer audit found these current non-billing priorities for the next
pass: `AppShell.handleUpdatePDFFile`/`useStorage.replaceDocument` still overwrite a
published cloud PDF path before related page mappings commit; the viewer's legacy
JSON sidecar save still swallows failure and writes a whole shared-state blob;
and `storageDownloads` only shares in-flight reads, not versioned bytes across
reopens. Versioned cloud-byte publication must precede a durable cache. Offline
access to shared cached files needs a defined revocation policy; fresh permission
checks must not be bypassed. No changes to these paths were made in this slice.

## Page-structure consistency: prerequisites, not atomic cloud publication

The next pass traced `usePageOperations` through `PDFViewer`, `AppShell`, Storage,
both Yjs document stores, forms, history and the SQL append/snapshot guards.
Cloud page changes currently overwrite the published PDF, then commit the moved
page state through separate writes. No PDF-generation token binds those writes.
This is a source-proven race, not a claim that a live customer lost data.

The local fixes in this pass preserve pending form edits before page-state capture,
retire old form callbacks when the exact File changes, reject stale page rewrites
before persistence for every storage mode, and remap surviving form carrier IDs.
Native widget IDs, values and authors stay unchanged for page moves/inserts/deletes.
Successful page changes clear all page-addressed undo stacks and preview baselines;
failed persistence leaves them intact. Flat Yjs remap capture remains enabled: it
must still write the new state and uses a different document/origin from the legacy
UndoManager. These checks do not close a later upload-versus-peer-edit race.

Two extra costs were reproduced and fixed in the real no-auth viewer: native form
edits recorded both a precise local delta and a whole-document history checkpoint,
and focusing then leaving an untouched blank field created a new app record.
The recorder now returns an explicit success receipt; only a native form edit with
that receipt skips the legacy checkpoint. Rejected recording and other sources
keep the prior fallback. The form layer marks blur unchanged only after observed
focus, no input/change event and an equal current DOM value. The hook skips a new
record but still retries an existing pending field. Empty is not a no-op heuristic:
explicit clears, unchecking, quick edits and failed-save retries remain valid.

Rendered verification used the real viewer and page controls at
`http://127.0.0.1:5229/?testPdf=kal441-form-fields.pdf&previewName=page-mutation-final.pdf`,
with 430×932 and 1200×800 viewports. Codex's in-app browser returned
`Browser is not available: iab`; Playwright used a new tab and no real account.
Untouched blank focus/blur kept zero history and zero form records. Add blank page
then move page 1 down preserved the name value on page 2 with canonical
`form-field:2:11R`, one carrier and the original author. All history depths were
zero after the page move. A new edit produced one local delta and zero legacy
checkpoints; one Undo restored the prior value and one Redo restored the new value,
without moving the page. Desktop untouched nonempty focus/blur kept history depths
and event count unchanged; clearing that value and Undo restored it. Screenshots
show the blank first page and form-bearing second page. No framework overlay or
console error appeared; the sole warning reported deliberate offline mode.
No Supabase, Stripe or Microsoft network request appeared in that test tab.

Regression tests execute the actual hooks, real PDF rewriting and PDF.js widget
parsing, actual extracted viewer callbacks, and real Yjs helpers. The whole form
layer's event wiring/hydration is mounted with only the PDF renderer synthetic.
Tests cover failed capture/persistence, exact form identity, retired callbacks,
Strict Mode, failed form retries, history receipt rejection, local signed-out
ownership, and subsequent one-step undo. The first full run exposed a missing
reset callback in the existing managed-local test harness; its hydration checks
were retained and the callback binding was supplied. It was not a runtime error.

A separate real managed-local flow imported the fixture through Home → On this
device → local file picker, edited a field, added a blank page and moved the form
page down. The actual device store committed revision 3, 8,839 PDF bytes and the
matching page-2 form graph. After a full app reload, Home → On this device → Open
loaded that stored copy: the viewer rendered two pages and the exact saved value
inside page 2. This proves local cold reopen, not cloud persistence. The mock dev
actor also exposed unrelated upload-recovery read warnings on Home (it has no valid
cloud identity); those warnings are not a passed cloud-recovery test.

Final verification: full `npm test` exited 0 with 5,690 tests, 5,621 passed,
69 skipped, zero failures/cancellations across 590 files. Baseline at `96d9bfb0`
was 5,636 tests, 5,567 passed and the same 69 skips. Production build, diff check
and AST graph update passed. An independent review ran 32 focused checks and found
no new blocker in form retirement/draining or history reset. No live migration,
provider test, deployment, push or Microsoft test is claimed by this local slice.

### Remaining atomic publication contract

1. Stage bytes under an owner-scoped, server-enforced write-once path, with one
   stable operation ID and exact object/version/hash/size identity. Never overwrite
   or remove the old file to free quota before a new publication commits. The old
   and staged file consume quota together.
2. Use the annotation advisory lock already shared by append and snapshot writes.
   Lock the document and relevant project/membership/account rows; reject locked,
   deleted, archived, closing and revoked states. Compare both the expected PDF
   generation and the exact annotation head/checkpoint used for the remap.
3. Commit pointer, current byte metadata, matching remapped checkpoint/sidebar
   state, generation and retry receipt together. Keep `documents.id`, ownership,
   shares and original import identity. Do not repurpose the deduplication field
   `content_sha256` as the current generation hash. Suppressed or failed writes must
   roll back the whole publication. Lost replies reconcile the exact receipt.
4. Enforce expected generation on every append, snapshot and legacy write path,
   including direct SQL inserts. Current `append_annotation_update` has no such
   argument. Old clients must fail visibly once a document adopts this protocol;
   a client-only check or remount cannot fence an offline peer.
5. Read matching bytes and state before applying either. Scope outboxes, caches,
   handles and history by generation; retain old unsent edits for recovery rather
   than purging or relabelling opaque Yjs updates. Separate metadata and state reads
   can straddle publication, so cold reopen needs a coherent read receipt too.
6. Retire old Storage objects only after publication. Existing cleanup and shared
   read rules recognize the current pointer only; retained historical generations
   need explicit references and access rules before they can be kept safely.

Both tracked document path guards inspect the actual SQL caller role, so a plain
SECURITY DEFINER function cannot authorize the new pointer update. The replacement
needs narrow database-owned authorization, not a client-set flag. A unique path
alone is also insufficient: existing guards allow version changes on non-retired
objects. Keep all physical Storage operations behind its API; SQL metadata removal
does not remove provider bytes.

Required tests include two publishers; publication against WAL append, role revoke,
account close and hard delete in both orders; stale-generation offline append;
Storage overwrite; quota rejection; suppressed writes; lost replies; and cold reads
spanning publication. Actual multi-user/provider tests still need leased accounts.
The stock no-auth fixture bypasses cloud replacement and reloads the original PDF;
it can prove rendered remapping but not a durable cloud reopen.

The copied-form slice below now supplies writer-produced widget identities with
the rewritten bytes, and verifies local save/reopen. The shared cloud publication
receipt still needs to commit that matching state with its byte generation; this
local repair does not close the multi-user protocol above.

The legacy sidecar loader already excludes authoritative cloud annotations, markers,
callouts and spaces; it is not a fallback overwrite of those stores. It still loads
entities/view state from a stable JSON path without a matching PDF generation. Its
swallowed save failures, full-blob upload and first-open wait remain separate work.
Versioned download caching and shared offline access/revocation policy remain open.
No cloud mutation or Microsoft live testing was performed in this pass.

### Copied forms: independent fields, bounded copy and real saved values

The old `copyPages` call cloned the selected widget's parent and all its sibling
widgets, even those on other pages. Copied widgets pointed at detached page
objects, and their fields were missing from AcroForm's registered field list.
PDF.js could display them, but their duplicate field names linked live controls
to the originals. Export could report success while editing the original field.
An ID-only state fix would not have repaired either fault.

`mutatePdfPagesWithIdentity` now returns bytes and the exact copied widget map
from one PDF load/rewrite. The byte-only wrapper remains compatible. The writer
copies page content apart from widgets, then builds independent registered
fields with unique names, real page links and only the selected page's widgets.
It preserves shared widgets within each copied field, inherited field settings,
choice lists and matching radio export/default values. Mutable field/appearance
containers are separate; immutable streams stay in the same private PDF context.
It never traverses a widget's old page tree to build its new page link.

The page-action hook consumes this result before persistence. Saved carriers
receive the exact native IDs/names and canonical page IDs; values, author metadata
and existing non-form copy behavior remain intact. Missing or ambiguous mappings
fail before persistence. File, local revision and live-state checks still reject
stale work. Queued copies advance both the committed bytes and their state.
An independent mounted-hook interleave exposed a pre-existing queue gap: with
the old File prop still rendered, a new edit between two successful page actions
could be replaced by the prior committed graph. The queue now keeps the original
observed fingerprint and only reuses that graph if the live view still matches
the known old capture or the prior commit. A third state rejects before the
second rewrite/persist and retains the edit. Tests cover refusal and both valid
queue cases. This is hook-level proof; the viewer's pre-action `flushSync` can
mask this timing in normal use. Edits arriving during the later persistence
await still need a stronger publication/version check; this narrower guard does
not cover that interval.

Two export faults are also fixed: a name-resolved field must own the exact target
widget, and radio writes use that widget's actual on-state to update the group
value and all sibling appearances. This covers labels that differ from PDF
on-state names and repeated export labels. An old orphan field with an original's
name is skipped with a diagnostic, never redirected to the original.

`PdfjsFormLayer` now supplies the shared annotation store to the installed PDF.js
AnnotationLayer constructor. Passing it only to `render` was ignored by PDF.js
6.1.200. Real renderer tests verify shared page storage, remount retention, a new
document with identical widget IDs, and `saveDocument` cold reopen.

Storage comparison against the exact pre-change writer (`b2d3a41e`), using the
same generated 100-page PDF with one text field displayed once on each page:

| Duplicate page 1 | Before | After |
| --- | ---: | ---: |
| Input bytes | 80,784 | 80,784 |
| Output bytes | 123,001 | 81,124 |
| Added indirect objects | 303 | 5 |
| Added widgets outside live pages | 99 | 0 |
| New field registered and linked to actual page | No | Yes |

A 40-page fixture shows the same bounded-copy pattern. These are fixture byte and
object counts, not production latency or Supabase quota measurements. No second
production PDF.js parse or first-view eager pdf-lib import was added. Module-design
guidance kept bytes and identity in one result; React guidance kept the writer
lazy-loaded and mapped field identities with keyed lookups.

Verification includes independent actual PDF.js controls and PDF export/reparse
tests for text, checkbox, radio, dropdown/list, same-page and cross-page shared
widgets, merged/nested fields, inheritance, nonzero-generation references,
repeated copies and aliases. Failure tests cover unmatched saved carriers,
unregistered/malformed/cyclic fields and unstable direct-widget identities.

Real browser flow: dev-only mock-auth route → Home → On this device → local file
picker → edit form → mobile Pages → Duplicate → edit original/copy independently
→ Save → full reload → Home → On this device → Open. The actual managed local
record reached revision 4 with 9,748 PDF bytes and matching page-1/page-2 form
state. Cold reopen retained both text values, original Good/copy Poor radio
choices, original unchecked/copy checked, and the copy's Mechanical dropdown.
The real Export annotated PDF button produced 10,935 bytes, two pages and 12
editable registered fields; independent parsing verified all these values and
exactly one selected radio appearance per group. Final source was reloaded and
the export rerun after the last exporter fix.
After the final queue guard, a fresh real local-file run performed two Duplicate
actions, edited only the third page, saved and fully reloaded. The reopened
three-page file retained `Chained value` on pages 1/2 and `Third copy only` on
page 3 (revision 4, 11,316 bytes). This verifies the final hook in the real UI,
not just the controlled interleave's fail-closed behavior.

The in-app browser returned `Browser is not available: iab`; regular Playwright
used a new tab on 127.0.0.1:5229. Desktop 1200×800 and mobile 430×932 showed the
distinct field values. No blank page/framework overlay or console errors; one
expected warning reported missing Supabase credentials/offline mode. No Supabase,
Stripe or Microsoft requests. Mock-actor Home upload-recovery read warnings are
not real account/recovery verification. The pre-existing form-control appearance
styling is not claimed fixed by this data slice.
After reloading away from each test document, exact identity/revision/size checks
guarded cleanup of the two synthetic local PDFs and their six draft snapshots.
Both local document and active draft lists were empty afterward. The source
fixture and exported PDF proof remain; only the two owned test tabs/servers were
closed. Existing owner tabs, its server and its pending browser dialog were not
touched.

Explicit bounds: structural page changes reject direct widget dictionaries and
XFA; copying rejects unsupported field types/actions and malformed or ambiguous
field trees. These cases leave the original file/state unchanged with a visible
error; there is no silent flattening or dropped value. Automatic repair of old
orphan copied fields, deleted-page AcroForm cleanup, full PDF action/destination
remapping, and shared cloud byte/state generation publication remain open. No
push, merge, deployment, provider mutation or Microsoft live testing is included.

Final verification on frozen source: `npm test` exit 0, 5,731 tests total,
5,662 pass, 69 skip, 0 fail/cancel across 593 files. The prior baseline was
5,690 total / 5,621 pass / 69 skip; this slice adds 41 passing cases and removes
no skips. `npx vite build`, `git diff --check` and `graphify update .` pass.
Logs: `/tmp/survey-copied-form-release-tests.log`,
`/tmp/survey-copied-form-release-build.log`,
`/tmp/survey-copied-form-release-graph.log`. Intermediate runs exposed and then
fixed the radio and nested-field cases; only the frozen-source run is the final
pass. Generated graph files and unrelated owner work remain outside the commit.

## Annotation write authority held through commit

The cloud PDF generation audit found a separate, current race: the main annotation
WAL checked access but did not hold the membership that granted it. A role change
could commit while an accepted annotation transaction remained open. A direct
document `locked_at` update also bypassed the official finalization advisory lock.

`20260909040000_annotation_write_authorization.sql` adds shared authority locks
to WAL INSERT and snapshot INSERT/UPDATE, including raw table writes. The same
document advisory lock is taken first; tuple locks use NOWAIT to avoid reverse
waits. Membership INSERT/UPDATE/DELETE takes exclusive parent locks, including
both parents for a move. Locking parents covers an absent direct membership
becoming a viewer and overriding an inherited editor. Metadata-only membership
updates skip that lock. Delete cascades tolerate a parent already gone within the
same transaction; private triggers do not replace RLS or grant new access.

The current role helper still decides access. Owners and direct editors do not
lock the project; only inherited access needs that shared project lock. Edits to
different files can proceed together, including within one project. A conflicting
membership change fails with `55P03` and must be retried; it cannot report a
committed revocation while the earlier write remains open. Existing UI callers
display mutation errors and do not send success notices from a failed result.
Existing sync clients retain/retry transient failures instead of treating these
lock errors as a permission rejection.

New writes require READ COMMITTED. An older repeatable-read snapshot can miss a
new membership even after acquiring an unchanged parent tuple lock, so those
non-default writes fail with `25001`. Immutable receipt-only RPC retries remain
unchanged; a direct snapshot no-op under non-default isolation may now fail.
The separate project-status/tier policy and account-closing policy are not added
to the current annotation access rules by this migration.
Before a live rollout, verify the deployed API roles use READ COMMITTED and run
the leased real-auth collaboration checks. Local PostgreSQL tests do not prove
the hosted provider, deployed schema, or browser-to-provider route.

The new shared disposable-Postgres helper uses installed local binaries, a private
Unix socket with TCP off, scrubbed libpq environment, no user psql startup file,
tracked bounded sessions, and confirmed shutdown before exact-directory cleanup.
The older WAL fixture now uses explicit session barriers instead of nine sleeps.
Its access helper remains deliberately stubbed; the separate new access fixture
uses the tracked role helper and real SQL roles/RLS for its permission proofs.

Frozen-source verification: `npm test` exits 0 with 5,738 total, 5,666 pass,
72 skip, and 0 fail/cancel across 595 files. Baseline was 5,731 total,
5,662 pass and 69 skip. The three added skips are local-Postgres opt-in checks;
all seven helper/access wrapper tests pass with that opt-in enabled. The access
fixture passes 39 checks (8 baseline, 31 after the migration); the combined
publication/retirement/quota/cascade fixture passes all 33 existing checks with
the new triggers installed. The older WAL race fixture also passes after its
runner change. Every owned temporary PostgreSQL cluster was stopped and removed.
`npx vite build` and `git diff --check` pass. Logs:
`/tmp/survey-annotation-authority-final-tests.log`,
`/tmp/survey-annotation-authority-final-build.log`,
`/tmp/survey-annotation-authority-postgres.log`, and
`/tmp/survey-annotation-authority-publication.log`.

### Shared PDF generation remains a separate open protocol change

This authority fix does not make byte replacement atomic with annotation state.
Current cloud replacement still overwrites a stable PDF path. Both the Yjs WAL
and `document_annotations` can write, and the latter has only a timestamp change
signal. A generation commit must compare both sources, not just the WAL head.
It also needs an immutable staged object, a stable operation receipt, coherent
generation-bound reads, and server rejection of all old-generation writes.

Normal sync-handle destruction drains pending writes and can write a final
snapshot. Its local recovery generation is not a shared PDF generation. Opening
a new File or adding a generation flag alone is unsafe: old-generation edits
must stay in durable recovery without replay into reordered pages. Current
Storage policy only allows an actor's own namespace, so collaborator staging
must not silently gain owner-path write rights. No new generation schema or
client adoption is activated by this slice, and no live migration was applied.

## Shared PDF generation prerequisites — not activated

This slice prepares, but does not switch on, atomic PDF/state publication.
Existing cloud saves still use the legacy storage path and sync protocol.

- Outbox v4 adds a `retiredScopes` store; it does not rewrite old rows or keys.
  Optional `pdfGenerationId` scopes isolate pending edits, accepted receipts and
  checkpoints. Retiring a scope atomically saves pending work in quarantine,
  keeps old accepted evidence, and blocks normal replay and scope deletion.
  A late old write either preserves its exact evidence and reports retirement,
  or rejects an identity conflict. Compacted identities cannot acquire new bytes
  after retirement, including the first transition from a legacy/null scope.
- Generated destructive calls require the exact document, actor, generation and
  incarnation. Whole-document deletion remains a separate operation. The memory
  fallback shares these rules but makes no persistent-storage claim; its rollback
  log tracks changed keys rather than copying every document's backlog.
- `materializeAnnotationGenerationState` captures owned, frozen semantic Yjs
  state: surviving annotations, native deletion identities, markers and all
  metadata. It does not carry old erase intent into a new semantic state. Missing
  Yjs dependencies, pending erase effects, unknown nonempty maps, invalid JSON,
  conflicting tombstones and ambiguous multi-lane eraser fallbacks fail closed.
- `captureAcceptedAnnotationState` requires fresh ordered cloud catch-up and
  clean accepted/live state. It keeps the covered sequence and snapshot tuple
  separate, watches account changes, and ends with an atomic local retirement/
  incarnation check. Its issued captures bind to one handle and cannot be copied
  into a valid receipt. Revalidation detects nested JSON mutation even when Yjs
  emits no event. This is a local preflight, **not a server CAS receipt**.
- Migration `20260909050000_legacy_annotation_revision.sql` adds a private,
  monotonic revision for `document_annotations`, `doc_yjs_state` and
  `doc_yjs_updates`. Bulk writes increment once per affected document per
  statement event, including service writes and deletion cascades; failed
  statements roll back the token. It uses the shared WAL lock and fails on
  conflicting lock order instead of waiting while holding child rows. It requires
  READ COMMITTED and blocks TRUNCATE bypasses. A missing counter means baseline
  zero, not an empty annotation store. No public capture RPC is added.

The SQL token does **not** cover survey items, session/page remaps, Storage JSON
sidecars or PDF bytes. It also cannot prove that cached JSON matches source rows.
The Yjs capture does not include those sources either. The full publication
transaction still needs exact proofs for every participating source, immutable
staged bytes, version-bound readers/writers, old-PDF recovery, and server-side
comparison under the shared lock. No caller should adopt a non-null generation
before that protocol is complete.

Independent review reproduced and fixed a capture-validity race when deletion
occurred during the last account check. It also found mutable recovery-prefix
and accepted-receipt fields, and a late-put path that could add different bytes
under an already-compacted identity. Those cases now have focused regressions.
The PostgreSQL harness passes all 13 grouped contracts on a disposable local
cluster, including bulk edits, moved document IDs, rollback, restore, cascades,
role access and contention with the WAL. This is not a hosted migration test.

Browser checks used the in-app browser at a separate local origin,
`http://127.0.0.1:5222/?testPdf=e2e/prog-07-form-fields.pdf`, with all external
requests blocked and no real auth. A real IndexedDB v3-to-v4 upgrade preserved
legacy bytes. Two connections exercised retirement versus a late put and late
receipt; a full reload retained both quarantined edits, old acceptance and the
new generation's separate queue. A fresh reload of frozen code also rejected a
conflicting late put into a compacted legacy scope. The first attempt used a
cached pre-fix module, so it is not counted as a frozen-source pass.
The browser also ran the real sync handle with a local-only backend double and
real IndexedDB: an accepted capture revalidated, a nested mutation without a Yjs
event invalidated it, and the temporary auth listener count returned to zero.
The rendered PDF form accepted a focused Cmd+S; its value survived reload and
was restored to `A. Surveyor`. Page identity, visible canvas/form, no framework
overlay and the interaction passed. Console output was limited to the expected
offline-config warning and blocked Google Fonts request. Test document rows were
removed; only their local deletion counters remain. No user's cloud data changed.

Frozen verification: `npm test` exits 0 across 599 files: 5,795 total, 5,722 pass,
73 skip, zero fail/cancel. The prior committed baseline was 5,738 total,
5,666 pass and 72 skip. The extra skipped check is the opt-in local PostgreSQL
harness; it passes separately (2 wrapper tests, no skips). The 19 accepted-capture,
12 materialization and 24 generation-outbox tests all pass. `npx vite build` and
`git diff --check` pass. Logs: `/tmp/survey-generation-prereqs-frozen-tests.log`,
`/tmp/survey-generation-prereqs-frozen-build.log`,
`/tmp/survey-generation-prereqs-postgres.log`. No push, deployment, live migration,
provider usage reduction, or real-auth multi-user proof is claimed.

Rollback requires care: a v3 client explicitly opening a v4 database receives a
VersionError; an open old connection can block an upgrade until it closes. The
new code closes on versionchange and rejects open/upgrade failures instead of
silently claiming memory is durable. Preserve v4 recovery data on rollback; do
not delete the database or lower its version to make an older bundle open it.

## Historical cleanup backfill: evidence is insufficient for automatic deletion

`archive_purge_runs` retains exact candidate paths with completed sweep transactions
and best-effort failed-path/writeback fields. It retains no Storage object ID,
version or content hash. Before retirement was introduced, the same key could be
reused for a new upload. A historical failed path therefore cannot authorize
deletion of today's same-key object. `storage_unlinked_at` records writeback, not
proof that every physical object vanished; newer writeback can describe queue
work originating in earlier runs.

Old manual deletes have no durable exact-path failure ledger: their errors went
to the console and a missing-row retry returns no paths. Usage metrics and document
identity guards cannot reconstruct those paths. Do not insert historical paths
straight into the active cleanup queue or scan every unreferenced object as garbage.

A future read-only review can page completed non-dry runs by run ID and path ordinal,
slicing at most 100 array items and keeping provenance. The run's 200-detail cap
does not bound its path arrays. Cleanup then needs file-version evidence or explicit
approval before the normal guarded protocol. No historical queue backfill or live
inventory mutation was performed in this turn.

## Canonical local native state and complete SQL survey change tokens

The saved managed-local snapshot now owns imported marks as well as app-created
marks. Reopening it runs embedded-PDF diagnostics only: it does not replace saved
geometry, callouts, survey markers, spaces or explicit empty state with the older
state embedded in the PDF bytes. A fresh local import without a saved snapshot
still imports native marks normally. This keeps source bytes separate from saved
edits and avoids a second semantic import on each reopen.

Native deletion records now live in the optional `pdfData.deletedPdfAnnotations`
field inside the existing six-key version-one snapshot. Older snapshots without
the field remain readable. Serialization retains full native identity metadata
and rejects lossy JSON. Hydration, dirty tracking, recovery drafts, manual save,
page-state capture and native-quit revision checks all include these records.
Same-document File replacements no longer clear managed-local deletion state.
The existing unmanaged/cloud File-reset behavior remains unchanged.

Page transforms now keep document-level items and other unbound metadata as
owned copies, update both assigned-page aliases, and strip page-bucket eraser
replay fields. Recognizable page-bound metadata without a declared remap is
rejected. Native occurrence page numbers follow supported moves; an unproven
synthetic PDF.js-ID shift or a copy of a page with native deletion records stops
without publishing new bytes or state. Exact writer-issued native-copy identity
proof remains open. This helper is not a whole-document capture validator.

Migration `20260909060000_document_survey_revision.sql` adds a private permanent
document revision for all attached survey sessions (including inactive ones)
and their items. Rebinds, metadata changes, item moves, detachments, cascades and
restore writes count. Row guards share the annotation WAL lock; inverse lock
paths fail promptly rather than wait in a cycle. Statement transition tables
increment once per affected document/event, including 1,000-row batches. Direct
counter access and TRUNCATE bypasses are denied. This is a missing source token
for a future atomic publication, not that publication API itself. It has not been
applied to a live provider.

Verification on the final source:

- `npm test` exits 0 across 602 files: 5,822 tests, 5,748 pass, 74 skip,
  zero failures/cancellations. The committed baseline was 599 files, 5,795 tests,
  5,722 pass and 73 skip. The added opt-in PostgreSQL check passes separately.
  `npx vite build`, `graphify update .` and `git diff --check` pass.
- 24 actual-viewer-source, mounted React and local IndexedDB tests pass for
  hydration, exact save/page state, deletion-only dirty/recovery/undo and stale
  native-quit receipts. Existing page/form/queue/materializer checks also pass.
- The disposable local PostgreSQL harness passes 12 grouped contracts; both
  wrapper tests pass without skips, including actual nonempty KAL48 restore.
- In-app browser, isolated `127.0.0.1:5222`, 1200x732, external requests blocked:
  imported the real drawing fixture through Home / On this device / Open local
  PDF; deleted native `15R`; saved and cold-reopened with that mark absent and
  other marks present. Rotation retained the deletion. An unsafe Duplicate
  stopped with the expected error and left the one-page file intact.
- On the final canonical-import branch, native `17R` delete/save/Undo removed
  only its deletion record. A mouse drag followed by Save and close/reopen kept
  its exact edited transform, with a clean saved tab. The form fixture retained
  a focused Cmd+S edit on reopen; Duplicate created an independent copied field,
  and both different field values survived another close/reopen.
- Page identity, visible canvas/forms, no framework overlay and inspected
  screenshots pass. Temporary HMR errors from an unfinished/discarded helper
  were cleared by a full reload; final checks used the final source. The mock
  route lacks the root toast host, so the expected unsafe-copy error was checked
  in the console, not claimed as a rendered toast. Offline config/blocked font
  warnings are expected. Source-byte thumbnails still show embedded marks, not
  the current saved annotation overlay; that existing preview gap remains open.
- Removed the two exact QA library records and five matching recovery sessions;
  the test origin has no remaining library documents or active recovery drafts.
  Original fixture files remain available. Closed only the new browser tab and
  stopped only the test server; the owner's server/tabs were left alone.

Logs: `/tmp/survey-native-state-frozen-tests.log`,
`/tmp/survey-native-state-build.log`, `/tmp/survey-survey-revision-postgres.log`,
`/tmp/survey-native-state-graph.log`. Screenshots are local test evidence at
`/tmp/survey-local-native-deletion-rotation.png` and
`/tmp/survey-local-canonical-form-copy.png`.

No push, deploy, live migration, cloud cost reduction, Microsoft testing or
real-auth multi-user proof is claimed. Atomic cloud PDF/checkpoint publication
and generation-aware reader/writer adoption remain open; this pass deliberately
does not remap cloud tombstones into the old document-scoped durable stream.

## SQL prerequisites for atomic cloud file publication

These changes prepare a checked switch of PDF bytes and shared state. They do
not activate generations, change the current cloud upload path, or create a
public capture/reservation API.

- `20260909070000_document_generation_storage_references.sql` adds a private
  ledger for staged and retained file paths. Its generated hash and exact path
  lookup join the current document reference checks in retirement, object
  deletion, cleanup list/ack and account cleanup scans. Reservations check the
  permanent document owner, open account and common path guard. Rows cannot be
  edited; release and document cascades queue cleanup. Referenced paths stay
  protected even when they are not the active `documents.file_path`. Uploaded
  copies still count against quota. This does not prove provider-byte immutability.
- `20260909071000_annotation_destructive_write_fence.sql` brings privileged
  modern annotation row deletion under the existing document TRY lock and
  READ COMMITTED rule. Parent cascades still work. TRUNCATE is denied, and
  append-only WAL rows cannot be rewritten through a privileged UPDATE.
  This preserves source-state consistency, not a new lifecycle/incarnation
  counter: an exact same-state delete/reinsert is still equal state.
- `20260909072000_document_publication_source_capture.sql` captures the full
  document row, modern snapshot and ordered uncovered WAL, legacy annotation
  rows/state/updates, and all attached survey sessions/items. The private
  function holds the shared source lock, checks editor access and lock state,
  and preserves the direct-role override and project access rules. It refuses
  a capture containing another user's owner-only survey session, including
  inactive sessions; it neither leaks nor silently skips that state.

Capture keeps binary fields as base64 and known bigint fields as decimal
strings. Its digest includes full row metadata, source presence, bytes and
revision counters. Function-local UTC keeps timestamp output and the digest
stable across caller time zones without changing the caller's settings.
Results fail as a whole above 10,000 combined source rows or
16 MiB, with no partial result. This is a result-size bound, not a RAM quota or
a bound on every row the planner may scan. New composite indexes cover the
session/document and item/session capture paths. The future commit path must
reauthorize and recapture inside the commit transaction; this private SQL token
alone proves neither PDF bytes nor a Storage JSON sidecar.

Open work remains the checked staged upload, exact path-change authority,
atomic state/file activation, and generation-aware readers, writers and
recovery. Existing same-path cloud replacement has not been declared safe by
these migrations. No live migration, provider write, account test or Microsoft
test was performed for this SQL slice.

Focused verification: 48 grouped checks against disposable local PostgreSQL
(19 reference/cleanup, 15 destructive-write, 14 capture checks); the combined
opt-in wrappers pass 9/9 with no skips. These cover both lock orders, actual
append/store RPCs, cascade rollback, private permissions, owner-only session
privacy, whole-result limits, exact full-row metadata and time-zone stability.
The fixture seeds historical large/gapped WAL sequences before the final
immutable-write fence; all capture checks run with the final guards installed.
The full `npm test` run exits 0 across 605 files: 5,831 tests, 5,754 pass,
77 skip, zero failures/cancellations. The prior committed baseline was 602
files, 5,822 tests, 5,748 pass and 74 skip. Each of the three added opt-in
PostgreSQL checks passes separately. The build, graph update and diff check
pass; the existing large-bundle warning remains. No browser flow changed in
this SQL-only pass. Logs: `/tmp/survey-publication-foundations-tests.log`,
`/tmp/survey-publication-foundations-postgres.log`,
`/tmp/survey-publication-foundations-build.log`, and
`/tmp/survey-publication-foundations-graph.log`.

## Checked generation upload staging — local, disabled

Migration `20260909080000` and the new `document-generation-upload` endpoint
add the upload prerequisite for a future atomic PDF/state publication. They do
not change `documents.file_path`, activate a generation, or replace the current
client save path. No live migration or deployment occurred.

An authenticated editor reserves one operation with an exact expected SHA-256
and byte length. SQL captures the current source digest and pins a new
owner-scoped path. Exact retries return the same reservation; changed inputs
cannot reuse its identity. Private records survive document/account deletion.
Admission rechecks the editor, lock, account state and permanent owner, uses the
existing owner storage limit, and caps unpublished work at four operations per
document and sixteen per actor. The existing aggregate quota guard still applies.
Partial actor/document/expiry indexes exclude canceled history from pending-work
lookups; the document index also matches cancellation ordering.

Only the checked signed-upload route can admit a protected path. The Storage
guard rejects replacement, metadata changes and moves into that path, including
service-role writes. A migration preflight aborts on an unrelated preexisting
`_generations` namespace object rather than silently adopting it. This SQL rule
depends on the deployed provider writing a fresh physical version before final
metadata admission. The reviewed pinned provider source supports that ordering;
the deployed revision and backend remain unverified. Standard signed uploads
only: no S3 or resumable write capability is issued by this endpoint.

The endpoint remains off unless `SURVEY_GENERATION_STORAGE_CONTRACT` equals
`versioned-standard-v1`. Setting that value requires provider compatibility
proof; passing these local tests alone does not meet that gate. Full streaming
server download verifies both byte count and SHA-256 before SQL records a
receipt against the exact object ID/version. There is no whole-file buffer and
no claim of PDF structural validity. A durable, two-minute verifier claim avoids
concurrent duplicate downloads; used claim IDs cannot be reused after takeover.
Verified retries do not download again. A full exact-length stream with the
wrong hash records a claim/object-fenced rejection; its retries return that
receipt without another download. The rejected candidate stays pinned for
recovery until explicit cancellation or expiry, with its reason and observed
hash retained for audit. A short, oversized, failed or interrupted stream is
not treated as a durable corruption verdict. Lost success or rejection replies retain the claim
for reconciliation, not a blind repeat write. Every fresh verification still
costs one full Storage read; no live bandwidth saving is claimed.

Reserved, rejected and verified-but-unpublished candidates expire after two hours.
Their terminal identity and verification history remain for audit. The existing
archive sweep cancels at most 100 expired candidates, commits reference release
and retirement, then uses the checked cleanup queue. It preserves auth, dry-run
and lock-skip behavior. Invalid or late replies report pending work, never direct
delete authority; a 15-second wait bound lets unrelated cleanup continue. Busy
candidates retry later. Future activation must introduce an explicit published
state and retained references before this path can serve real saves.

Local proof: 36 real disposable-Postgres checks cover exact retries, private
grants, quota rollback, namespace collision rollback, concurrent claims, both
deadline wait races, revoked/transferred/closing access, deletion and bounded
expiry and durable negative verification. The focused combined run passes 52/52 tests with no skips, including
the actual Deno entry point through the repo-approved Supabase SDK 2.110.8 and synthetic
localhost HTTP (14 grouped checks), 26 handler checks, 15 expiry-sweep checks,
and the existing actual cleanup/billing endpoint fixture (22/74 grouped checks).
Synthetic HTTP proves adapter behavior, not hosted provider behavior. Deno
typechecking passes offline. A separate local 512 MiB stream benchmark used
1 MiB chunks, about 51 MiB sampled process RSS, and 200 ms wall time. It is not
a hosted capacity result: target runtime CPU, memory and request limits still
need measurement before deployment. Larger supported files may need the same
stream verifier in a worker with a suitable runtime, not a reduced file limit.

Final regression run: `npm test` exits 0 across 609 files, with 5,879 tests:
5,800 pass, 79 skip, zero failures/cancellations. The prior committed baseline
was 605 files, 5,831 tests, 5,754 pass and 77 skip. Both new opt-in checks pass
in the separate focused run. The first full attempt correctly failed the SDK
release-pin gate; the endpoint now uses the approved direct npm pin, and the
unchanged gate and full rerun pass. The final partial-index adjustment also
passes the complete 36-case local Postgres matrix and all five wrapper checks.
Build, offline Deno checks, graph update and diff check pass. The existing large
bundle warning remains. No browser flow or frontend file changed in this slice.
Logs: `/tmp/survey-generation-stage-tests-final.log`,
`/tmp/survey-generation-stage-focused-final.log`,
`/tmp/survey-generation-stage-postgres-final.log`,
`/tmp/survey-generation-stage-build-final.log`,
`/tmp/survey-generation-stage-deno-final.log`, and
`/tmp/survey-generation-stage-graph-final.log`.

Remaining non-Microsoft work includes atomic PDF/state activation, old-client
read/write fences, generation-aware cache/outbox/realtime recovery and two-client
offline tests. The legacy JSON sidecar also still duplicates shared state,
uses a project-prefixed path that does not match the tracked owner-prefix write
policies, and swallows upload errors. Its loader restores only a subset of the
saved data and delays initial page setup. Replacing it needs a checked, scoped
settings receipt and legacy import plan; local-save acknowledgement must stay
separate from cloud success. No sidecar change was made in this slice.

## Generation-aware annotation transport and local recovery (local foundation)

This slice adds a checked transport and opt-in sync engine, not an activation
route. No live database migration, provider test, browser adoption or Microsoft
test has run. The existing hook/viewer path still opens legacy/null generations.

Migration `20260909090000` keeps generation baselines, heads, WAL and snapshots
in private tables. Five v2 RPCs bind every read, write and receipt to a document
and explicit generation. Decimal strings preserve PostgreSQL bigint values over
JSON. Append receipts bind actor, writer, client sequence and SHA-256; an exact
old receipt can remain recovery proof after replacement, never proof that the
old generation is current. Snapshots use the full prior checkpoint identity for
compare-and-set. Tail reads hold a fixed frontier, return complete rows, and use
a soft 16 MiB page budget with one complete oversized row allowed. SQL builds
one bounded aggregate rather than repeatedly copying a growing JSON array.

Private changes emit only document/generation/frontier/wake/checkpoint-epoch metadata through
`annotation_generation_signals`; no PDF path or annotation bytes go through
that channel. Clients must fetch content through the checked RPCs. The generated
client path scopes its registry, local persistence, durable journal, receipts and
recovery to document/account/generation. It requires IndexedDB, keeps legacy
keys unchanged, and seals a retired scope before more requests or effects can
start. Unsent edits and late exact acceptance receipts remain in the old scope.
Missing or unbound replacement details block sync without guessing a successor.
Generated catch-up starts at the checked covered prefix, not the old snapshot
baseline. Burst notices share one active read and retain a needed follow-up;
snapshot refresh takes precedence. An own-append echo with an already checked
head and checkpoint epoch needs no fetch. Snapshot-only changes and reconnects
use checked snapshot-plus-tail reads, merged without dropping pending local
edits. Failed reads show unhealthy sync; a late own receipt cannot clear a
closed realtime connection. Legacy sequence replay remains unchanged.

Migration `20260909091000` adds restrictive legacy read fences plus checks in
content-returning definer functions. The zero-generation case uses one
statement-level existence probe. Existing permissions remain in force: a
stranger does not gain content or an adoption-status probe. Protected staged
Storage paths cannot be read through old authenticated routes. This does not
revoke previously issued signed links or protect a public bucket; deployment
must still verify private Storage and use a checked download route.

Still required before enabling this path: atomic verified PDF/state publication,
frontend list/open/download and metadata-only lock/unlock adoption, generation-scoped broadcast and viewer
caches, old-client upgrade handling, sidecar migration, and two-client offline
browser tests. The current file-overwrite path has not been replaced by these
foundations. Microsoft 365 testing stays deferred.

The installed Supabase SDK is exercised through a fake HTTP endpoint with real
Yjs and IndexedDB stores: scoped bodies and JWTs, exact counters, save/reopen,
account-switch races, rejected generation writes, and two separate clients
converging on both actors' edits without echoes. This is local module-to-SDK
proof, not a real browser, Supabase Realtime server or provider test. The first
full regression run caught an overbroad supplied-Y.Doc scope check in the
existing erase recovery flow. The guard now applies when either scope is
generated; legacy-to-legacy sharing stays unchanged. All 70 targeted tests,
including the original failing test, then passed.

Final verification: `npm test` exits 0 across 615 files and 5,972 tests:
5,891 pass, 81 skip, zero failures/cancellations. The committed prior baseline
was 609 files, 5,879 tests, 5,800 pass and 79 skip. Both new opt-in PostgreSQL
wrappers pass in the separate 106/106 focused run with no skips; they execute
19 generation-transport and 16 read-fence check groups in disposable local
PostgreSQL. The broader sync/outbox/local-durability/erase set passes 339/339.
The second full attempt found an old source pin for `Number(snapRow.at_seq)`;
the pin now checks the exact sequence parser while retaining the decode-before-
frontier rule. The final full rerun passes unchanged corrupt-byte runtime tests.
Build, graph update and diff checks pass; the existing large-bundle warning
remains. No frontend hook/provider/viewer file was changed, and no browser,
hosted provider, production quota reduction or Microsoft result is claimed.
Logs: `/tmp/survey-generation-transport-tests-final.log`,
`/tmp/survey-generation-transport-focused-final.log`,
`/tmp/survey-generation-transport-regression-fix.log`,
`/tmp/survey-generation-transport-build-final.log`, and
`/tmp/survey-generation-transport-graph-final.log`.

## Pre-transform source receipts and copied-row identity

This slice still does not activate PDF generations or replace the current shared
PDF overwrite path. Migration 092 and `document-generation-source` prepare a
durable source before a future page transform. The endpoint is off unless
`SURVEY_GENERATION_SOURCE_CAPTURE=v1-metadata-only`; that flag is not permission
to publish. Every receipt says `source_byte_state: unverified`. Storage object
ID, version, path and size are metadata, not a hash of the PDF's actual bytes.

The source ID binds the actor, document and expected generation. Retrying that
ID returns the same stored source, never a fresh capture. Read access is checked
again. Legacy state, the active generation, survey state and connector history
are retained privately; the response exposes only document-visible state and
the actor's own survey sessions/items. Complete private-history hashes are kept
separate from the semantic source hash so unrelated connector bookkeeping does
not block a page transform. A generated document without an exact active PDF
binding fails closed rather than silently reading its legacy file path.

Pending captures use deduplicated bodies, a two-hour lifetime, per-document and
per-actor limits, and a byte budget. Cancellation and expiry remove unreferenced
capture bodies while keeping small identity receipts. The route verifies the
caller with the anon client before using the service-only RPC, rejects actor
injection, filters private fields, keeps bigint counters as strings, and bounds
requests even when a dependency ignores cancellation. An unknown reply directs
the client to resume the same source ID; it never claims success or cancels it.
The archive sweep runs source expiry only under the same exact capture flag.
It checks the bounded ID receipt, logs counts only and stops waiting after 15
seconds; failed source expiry does not block unrelated checked storage cleanup.
Busy document locks get a private 30-second retry delay and move behind other
due captures, preventing repeated bounded sweeps from starving later bodies.
Both private tables and all eleven functions explicitly belong to `postgres`;
the service role receives only the four public RPC grants, not raw body access.
Apply migration 092 before enabling either caller. Its connector-write fences
take effect when the migration is applied, independent of the HTTP feature flag.

Page copy/duplicate now removes Excel export receipts and row identity only from
the copied annotation/marker carriers. It preserves the original's row link and
both copies' business fields. Offline tests run the real Excel import matcher
after JSON serialization: only the original remains a stored row identity, and
the copy does not become a candidate deletion. This needs no Microsoft account.
The isolated no-auth app route exercised Duplicate (four to five pages), Copy /
Paste (five to six), and another Duplicate (six to seven) with no logged errors.
The last duplicate's page counter was checked; its final thumbnail render was
not separately verified. This is not an authenticated cloud save/reopen test or
live Microsoft sync proof. The test tab and its Vite process were closed.

Verification: the full `npm test` run exits 0 across 619 files and 6,008 tests:
5,925 pass, 83 skip, zero failures or cancellations. The committed prior baseline
was 615 files / 5,972 tests / 5,891 pass / 81 skip. The new opt-in PostgreSQL and
Deno/SDK suites run separately, rather than counting their default skips as
proof. The final focused run passes 48/48 without skips, including 21 actual
PostgreSQL check groups and 23 actual localhost Deno/SDK HTTP checks. The broader
page-mutation/source-handler set passes 60/60. The final review's starvation
test failed before the retry-delay fix and passes after it. Build and Deno
checks pass; the existing large-bundle warning remains.
Logs: `/tmp/survey-source-capture-tests-final.log`,
`/tmp/survey-source-capture-focused.log`,
`/tmp/survey-source-capture-integration-final.log`, and
`/tmp/survey-source-capture-build-final.log`.

Remaining publication work: bind staging to this source ID, verify and retain
the prior physical PDF as well as the candidate, compare the full captured state
at publication, preserve legacy/foreign survey and connector history, and mount
the confirmed PDF/state bundle in the frontend with generation-scoped providers,
caches and recovery. A path reference alone cannot preserve bytes overwritten
at that path. Microsoft 365 live testing remains deferred.

## Complete source-byte proof and source-bound staging (093–094)

Local implementation only; both paths remain off. Migration 093 adds a private,
complete-stream proof for the captured PDF and all captured sidecars. The HTTP
verifier authenticates the caller, claims the exact source, hashes each full
stream with bounded memory, then records the full manifest in one transaction.
It never holds database locks during a download. It rejects short, long, changed
or missing objects and a hash that contradicts an earlier verified generation.
A checked retry returns the stored proof without downloading again. Claim IDs
cannot be reused after release; 128 distinct claims per source bound retry state.
Cancel and expiry remove byte proofs and claim history with the source body.
Source and claim deadlines also bound the stream wait: expired claims start no
download, and expiry during one file stops the next file and the record call.

The pinned Storage SDK places raw paths in download URLs. The verifier encodes
each name and checks that URL parsing preserves the exact path, including `?`,
`#`, `%`, Unicode and leading slashes. It rejects dot segments that a URL would
normalize. Actual localhost SDK tests check this behavior; hosted Storage's
path decoding and physical-version guarantees still need separate proof.

Migration 094 binds each staged upload to the same durable source ID, its hash,
its expected generation, and either `prior-pdf` or `candidate-pdf`. It does not
capture a newer annotation state after transformation. A prior-PDF upload must
match the source's full byte proof. Source expiry bounds the upload's lifetime.
Old upload routes cannot strip this binding. Changed or expired sources yield
recovery-only descriptors with no byte proof or signed upload URL. New requests
remain gated by the existing storage-contract and source-capture flags. Metadata
recovery and cancellation stay available when the source-capture flag is off.
If SQL rejects a source changed between phases, the handler reads that exact
operation once to recover its status; it does not retry the write or accept a
different binding. Releasing an already-expired claim cannot renew it and stays
safe after source loss.

Verification: the full app run completed 625 files / 6,041 tests: 5,954 pass,
87 skip, zero failures or cancellations. After the final recovery/deadline fixes
and four added regression tests, the final focused run passed 63/63 with no
skips. Its opt-in suites include 34 actual PostgreSQL check groups (15 source
proof, 19 bound upload) and 94 local Deno/SDK HTTP checks (38 source proof, 56
bound upload). Build and Deno type checks pass. The existing large-bundle
warning remains. Logs: `/tmp/survey-source-proof-full.log`,
`/tmp/survey-source-proof-focused-final.log`, and
`/tmp/survey-source-proof-build-final.log`.

These are staging checks, not publication or retained history. Verified stages
still expire. There is no active PDF/head switch, viewer/provider adoption,
sidecar archive, final full-state compare-and-swap, or live collaboration proof
in this slice. No production quota reduction is claimed. Microsoft testing stays
deferred. Do not enable these paths until the remaining publication, retention,
provider and end-to-end checks pass.

## Source-object archives and private page-state plans (095–096)

The first full test run caught a separate existing cleanup deadline defect: a
timer could wake just before a wall-clock deadline and start another batch.
Cleanup now uses a monotonic clock and treats expiry of the total-budget timer
as final, even if that timer wakes early. Deterministic tests cover all three
request phases and wall-clock jumps. Retired paths, pending jobs and late-reply
rules stay unchanged; a timeout does not claim provider work was canceled.

Migration 095 stages an exact member of a verified source manifest, including
JSON sidecars. The caller supplies only source, operation and source-object IDs;
SQL derives the digest, length and immutable `.bin` destination. Version 3
receipts retain the selected object ID even after source loss, but remove the
old source proof. Version 1/2 upload behavior stays separate. A ready archive
read performs one full source check, then projects its member under the same
held locks. It does not repeat that whole check just to format the response.

The HTTP `begin-archive` action and version 3 verification require
`SURVEY_GENERATION_SOURCE_ARCHIVES=v1-complete-source` in addition to the existing
source-capture and storage-contract flags. Inspection and cancellation remain
available with the archive flag off. Archive staging still expires; it is not
permanent history, an active file binding, or a completed publication.

The private transform module accepts the full captured payload, not the public
projection that omits other users' surveys. Its output must never be sent to a
browser: it includes foreign/private survey records and connector history. The
caller remains responsible for source digest, exact PDF dimensions and sidecar
byte proof. The module prepares a fresh annotation baseline and remapped source
projections while retaining an owned, unchanged copy of the input history. It
does not write to Storage or SQL. The shared page-copy helper now exposes the
old ID to copy-ID factories so all representations can use the same new ID.

Migration 096 exposes that full input only through a service-role SQL function.
It reuses the verified source check, holds the source and body locks, and checks
the frozen payload and semantic hashes, byte count, document, generation and WAL
head. It grants no private-table access and does not recapture newer state.
The full result must remain inside a trusted worker; there is no public HTTP
route for it. The transform has Node test evidence, not a deployed worker.

Known unsupported input fails without a candidate: nonempty legacy
`documents.annotations`, unknown page-bound fields, and prototype-named visible
annotation IDs. The real empty document default is supported. The module also
rejects conflicting copies, missing WAL dependencies and future checkpoints.
An accepted empty checkpoint cannot resurrect stale SQL marks. Private survey
IDs stay strings; copied records lose old Excel row receipts, while moved rows
keep theirs. These guards do not establish compatibility for every historical
file or prove live multi-user publication.

The private transform builds one annotation-ID index and assembles fallback
page buckets once. The test first reproduced quadratic work: 100/500 SQL rows
visited 11,500/257,500 bucket objects with an accepted checkpoint and
6,250/131,250 during fallback. The same test now observes 1,500/7,500 and
1,300/6,500 respectively. This measures traversal count, not a production
latency or egress claim. Raw and callout fallback rows also preserve their SQL
author when no embedded author exists; an embedded author takes precedence.

Verification for this local batch:

- Full `npm test`: 630 files, 6,110 tests, 6,020 passed, 90 gated skips, no
  failures or cancellations. The initial run failed the cleanup deadline test;
  the final complete run passed after the fix and four deterministic regressions.
- Actual disposable PostgreSQL: 15 archive groups, 18 SQL-to-transform cases
  across six operations/three checkpoint forms, and 10 private service-read
  access, corruption, expiry and lock groups. Clusters were removed afterward.
- Actual cached Deno/Supabase SDK against localhost: 110 archive HTTP checks.
  The transform plus existing page/form/state tests passed 90/90.
- Vite build passed with the existing large-chunk warning. Upload, scheduled
  cleanup and account-deletion Deno entry-point checks passed. Required graph
  refresh completed; generated graph files remain outside the code commit.
- In-app browser, no-auth fixture: four pages became five on Duplicate and six
  on Copy/Paste; the pasted page opened and rendered. The test tab and local
  server were closed. This is not real-auth cloud save/reopen evidence.

Do not activate publication by adding a head row alone. Before activation:

- Retain each exact prior source object and the candidate under a permanent
  publication binding; require one archive for each captured PDF/sidecar member.
- Copy the full source payload and proof before source expiry releases them.
  Exclude adopted assets from staging caps, cancel and expiry, while preserving
  cleanup when the owning document is truly deleted.
- Replace transient `verified` upload lookups in source capture and byte checks
  with the durable active-asset binding. Prior-actor revocation or closure must
  not destroy another owner's surviving shared file.
- Compare current full semantic state with the captured source under the document
  lock, then publish the new PDF, annotation baseline and all page-bound state
  together. A changed source must retain the candidate for explicit recovery.
- Mount a checked generation bundle in the viewer and isolate its providers,
  caches and pending edits. Verify two-user offline changes and reopen behavior.

Server-side Storage copy could avoid a browser download/re-upload for archives,
but it needs its own durable copy admission and unknown-outcome checks. The
pinned provider performs one insert/upsert after copying to a fresh physical
version; it does not justify weakening the immutable-object update guard.
Its S3 backend uses a single-object copy, so large-object fallback and the actual
hosted provider version still need proof. Never substitute direct Storage-table
mutation for a provider copy or upload.

## Durable source and asset retention (097; private, not publication)

Migration 097 adds a document-owned retained bundle and exact asset bindings.
The private helper accepts an actor/source, verified candidate operation and
the complete set of verified source-object archive operations. It rechecks
current access, account state, object versions, byte proofs and the full current
SQL semantic digest before retaining anything. It checks expiry again after
the final inserts. No browser or service role receives execute permission.
This helper must run inside the future publication transaction, not as a
standalone pre-publication action that leaves failed candidates permanent.

The bundle pins the existing content-addressed source body; it does not copy
another full payload. It preserves the complete byte manifest after transient
source expiry. Exact retries use that durable identity and current access,
not the old source TTL. One staged archive operation belongs to one bundle;
unknown publication outcomes must retry the same candidate operation. Failed
publication must roll back the whole transaction.

Retained uploads, body content and file references are immutable while their
document exists. Closing the original editor's account does not end another
owner's asset lifetime. Actual document deletion still removes bundle/assets,
releases the last source-body pin, cancels staging ledger rows and queues exact
Storage paths for cleanup. No physical provider deletion is claimed by these
local SQL tests.

An exact, guarded `retained_at` marker excludes retained history from pending
actor/document/expiry indexes and admission counts. It is set only to the
matching bundle timestamp with all other upload fields unchanged. The separate
document/state index still finds retained uploads during real document deletion.
This avoids an anti-join through ever-growing retained history on each sweep.
The small-fixture EXPLAIN test forces index eligibility; it is not a claim about
production planner costs or production latency.

Active source capture and source-byte verification now use the durable candidate
binding. They do not depend on an old editor's account, source TTL or transient
upload status. Capture reuses the checked asset descriptor under held locks
instead of looking it up twice. Migration preflight rejects an existing head
without a durable binding and rolls back; it never quietly accepts an expiring
stage as a permanent active file. Reapplying with a retained head is tested.

New publication gates found during this pass:

- The generation guard blocks all writes to legacy annotation/survey tables
  after adoption. A second publication needs an exact private transaction-bound
  write permit or complete generation-scoped replacements, not a GUC bypass or
  removal/reinsertion of the head.
- SQL writes generate annotation/item timestamps. Marker comparison must define
  a narrow policy for `lastSyncedAt` and the copied `id` alias (only when it equals
  `annotationId`), while keeping row ID, version, author, geometry and business
  fields exact. Prove actual SQL write → capture → second transform before using
  a pre-write baseline as the published baseline.
- The current `20260908161000` Storage quota guard already sums committed
  object metadata under each owner's UUID path, including generation staging
  and retained archives, for service-role writes too. `097` grants no byte
  exemption. Older `documents.file_size` metrics are not that authority. The
  tracked guard does not prove every provider-billed byte, abandoned backend
  version or uncommitted upload is covered. History retention and provider-byte
  reconciliation still need explicit policy/proof before activation.
- Pinned history contains private survey/connector records. The closed-editor
  test proves the account write fence and surviving document's file access, not
  full account erasure through every historical copy. Define and test historical
  private-data deletion/restore rules before exposing retention or restoration.
- Sidecar publication needs an immutable generation-specific location or checked
  SQL manifest. Existing legacy Yjs output also needs the exact nested-state
  serializer and covered legacy sequence. Do not restore old connector history
  over live writeback/audit state.

No live migration, cloud publication, Microsoft test, provider copy or quota
reduction occurred in this batch. Full publication and the two-user/offline
viewer checks remain incomplete.

Verification: the full Node suite passed 6,020 tests across 631 files, with 91
gated skips and no failures/cancellations. The separate disposable PostgreSQL
run passed 16 groups, including the actual aggregate quota trigger after
retention, partial-index plans, closed-editor active capture, rollback and
expiry during the final insert. Its exact temporary cluster was removed. Vite
build passed with the existing large-chunk warning. The required AST graph
refresh completed; graph/cache files are not part of the code checkpoint.

## Save and reload consistency: marker receipts and legacy checkpoints

This batch closes two transform prerequisites listed above. It does not enable
cloud publication or change any live database, file, account or Microsoft flow.

- Marker reconciliation now ignores only the top-level `lastSyncedAt` read
  receipt. An optional copied `id` must exactly equal `annotationId`. SQL row
  IDs, versions, authors, modifiers, geometry, business fields and nested
  timestamps remain exact. Source capture and final semantic CAS are unchanged;
  their actual SQL timestamps are still part of the frozen source and archive.
- The private transform returns `legacyCheckpoint` with a standalone raw Yjs
  update, its matching state vector, document ID and exact string `throughSeq`.
  Its floor covers the prior checkpoint and every captured legacy update, even
  beyond JavaScript's safe integer range. It never merges old binary history
  into the new generation. Old history remains in the private archive.
- Fresh annotation/callout records use the nested Y.Maps expected by the legacy
  bridge, including per-field content and attribution. Two decoded replicas can
  still merge edits to different fields. Empty/deleted state is a full checkpoint
  too, so a later read cannot restore old marks through leftover WAL rows.
- A second-edit test found legacy callout fallback adding author metadata to an
  outer field that its next read does not preserve. The fallback now seeds the
  bridge's normalized callout author field when absent and preserves any embedded
  author. Original envelope attribution stays intact; comparison does not ignore
  authors or other callout content.
- Both output checkpoints and the legacy vector share a 64 MiB encoded size
  ceiling. This is an output check, not a claim of a strict process-memory cap.
  The complete transform remains a private, Node-tested prerequisite.

Local verification includes focused save/reload and two-replica tests, plus
actual disposable PostgreSQL row-write → capture → second-transform tests. The
SQL harness installs the tracked annotation timestamp trigger rather than
simulating timestamps. It writes moved/copied marker rows and attached private
survey items, preserves their authors/business data, and tests changed row IDs,
versions, authors and business data as failures. It also writes and recaptures
the legacy checkpoint's real BYTEA state, vector and covered sequence.

These are pre-adoption SQL roundtrips, not the missing atomic publication
transaction. The live publication write permit, complete state/PDF/head switch,
immutable sidecar binding, viewer generation reset, and two-user offline cloud
flow remain activation gates. No legacy write guard was relaxed for these tests.

Next publication work must retain the `090` adopted-document write fence for all
roles. A private, transaction-bound permission should identify the exact
operation, document/generations, table, row, action and expected old/new values;
only the checked publisher may issue it, and each entry must be consumed before
return. Existing account, membership, parent locks, revision counters, timestamp
triggers and immutable WAL checks still apply. In particular, the `097` retained
bundle retry deliberately does not recapture current source state: publication
must make its own fresh full-source comparison even when retention is a retry.
Page-count-only writes also need explicit actor/owner account checks. No such
permission or publication function is implemented in this batch.

Final verification: 68 focused tests passed. The full Node suite passed 6,042
tests across 632 files, with 91 gated skips and zero failures/cancellations.
The separate disposable PostgreSQL run passed 18 transform cases, 10 private
read/authority groups and three writeback roundtrips, including 12 rejected
semantic conflicts. Its exact temporary cluster was removed. Vite build passed
with the existing large-chunk warning, and the required AST graph refresh
completed. No user-visible route changed; no browser/cloud release proof is
claimed by these private transform tests.

## Private atomic generation publication: local only

`20260909098000_document_generation_publication.sql` adds one private,
postgres-owned publication function. It has no client or service-role grant,
HTTP route, or active browser caller. A trusted transformer must supply the
complete checked source and its transformed PDF/Yjs result. SQL checks exact
bindings and writes; it cannot prove the meaning of opaque PDF or Yjs bytes.

The function retains the verified candidate and archive bundle, then checks the
full source again even if retention succeeded on an earlier attempt. In one
transaction it writes the exact annotation, legacy-checkpoint and survey-item
sets, installs the new baseline, switches the PDF pointer and generation head,
and records an immutable receipt. Every changed row needs a one-use permission
bound to its transaction, document, table, row ID, action and complete old/new
values. No application role can issue these permissions. Final checks cover the
actual row sets, unchanged survey sessions, document fields, PDF binding and
whether the successor still fits the full-source capture limit. Any failed check
rolls back the publication, including newly retained bindings.

Same-operation retries return the prior receipt without writing again. A retry
after later publications returns its historical receipt, never rewinds the head,
and still requires current access. Authority checks hold the existing account,
project and document locks; they do not repeat the full access query for each
changed row. Row sets use bounded aggregation and set-based writes.

Page moves can swap page-based form IDs under immediate unique constraints.
Exact temporary keys let those rows keep their SQL primary keys and linked sync
history. The pure transformer now maps each surviving form's actual new ID to
its survey item, separately from copied-form IDs. It preserves notes, author,
row identity, null-page state and existing Excel row positions. Conflicting page
or identity evidence fails rather than guessing a new link. This is local link
preservation, not Microsoft service testing.

The disposable PostgreSQL harness passed all 15 groups: first adoption and later
copy/delete, stable and historical retries, stale collaborator edits, revoked
roles, account closing, isolation-level denial, held locks, failures after row
writes, final-trigger corruption, exact ID swaps with preserved sync history,
receipt immutability, document cleanup and successor-capacity rollback. The
actual authority helper ran seven times for both 102 and 502 annotation rows;
publication took 79 ms and 245 ms respectively in that local run. These timings
are not hosted latency or a production benchmark. The exact temporary database
cluster was stopped and removed.

Verification against the prior 6,133-test baseline: the full offline run covered
633 test files and 6,144 tests, with 6,052 passed, 92 skipped, zero failed and zero
canceled. The new PostgreSQL wrapper also passed with its integration flag on,
rerunning all 15 groups in a separate disposable local cluster. Vite build passed
with the existing large-chunk warning; the required AST graph update completed.
An independent final SQL review found no new blocking defect. No user-visible
route changed in this slice, so these checks do not claim browser release proof.

Activation remains gated on immutable transformed-sidecar binding (sources with
sidecars currently fail explicitly), trusted PDF/Yjs transform validation, a
checked open bundle, generation-aware reader/cache resets and durable retirement
of old outboxes. Two-user offline/browser and actual provider-byte checks remain
required. The private publisher bounds combined baseline and legacy checkpoint
bytes at 16 MiB, narrower than the pure transform's 64 MiB limit; callers must
handle that refusal without losing the old document. Existing committed-object
quota guards already count stages, archives and retained objects; retention
policy, safe asset reuse, provider-byte reconciliation and historical account
data erasure still need separate work. No migration was applied to Supabase and
no cloud quota reduction or live Microsoft result is claimed.

## Checked generation open: local contract, not viewer activation

`20260909099000_document_generation_open.sql` adds an authenticated-only read
for a currently published document generation. A null expected generation means
discover the current adopted one, not fall back to legacy state. An explicit
generation must still be current. Owner, direct collaborator and inherited
project access retain the existing viewer rules; the read also fences both the
actor's and owner's account closure. It does not grant service-role execution,
widen Storage policies, return a signed URL, or expose the private captured
survey/connector/archive history. The full document row is within the existing
viewer-visible document scope.

One short transaction checks the publication receipt, retained bundle, immutable
candidate, current document pointer, storage reference, active path guard, and
physical object ID/version/size. It returns the exact PDF descriptor with its
SHA-256 and the generation-bound annotation checkpoint with its stored-byte
SHA-256 and fixed WAL frontier. It uses shared locks rather than upgrading to
the retention helper's exclusive document lock or touching the path guard on
every read. An existing account guard is read/locked only; the first open by a
never-writing viewer may create its one missing account guard. Snapshot mode
checks raw byte length before constructing hexadecimal output and hashes the
stored bytes directly, avoiding a large decode of its own JSON response.

`documentGenerationReader.js` joins that contract to an injected actor-bound SQL
request and exact-descriptor download. It checks the raw or gzip checkpoint,
reads only the needed WAL pages through the captured frontier, and verifies the
PDF Blob's exact size and hash. The two byte/state reads run together. A final
metadata-only confirmation repeats current access and file binding checks but
does not fetch, encode or hash a second checkpoint. Same-generation annotation
edits after the captured frontier are left for normal catch-up; the result does
not claim those newer edits were read.

The reader never installs partial state or reuses a legacy document-only cache.
Each await rechecks the captured actor, cancellation and a monotonic deadline.
A timer alone was insufficient if synchronous adapter work delayed its callback;
a failing test now covers that case. Adopted WAL sequences are contiguous per
document, unlike legacy global sequences. Another failing test exposed that an
empty/short response could otherwise claim unread coverage. The reader now
requires every sequence and the exact final frontier, then checks for unresolved
Yjs dependencies. It returns caller-owned Yjs bytes without registering a live
document or deleting any old draft/outbox. Its `pdfCacheKey` names PDF byte
identity only; annotation freshness must retain `throughSeq` and catch up.

Reader defaults bound PDF bytes at 256 MiB, combined applied state bytes at
64 MiB, tail pages at 1,000 and the read at 60 seconds. Gzip expansion is bounded
while streaming. Oversize, expired, mismatched or incomplete results fail rather
than truncate or select an old fallback. These are explicit refusal limits, not
a claim of constant RAM, instant cancellation of synchronous parsing, or support
for every possible PDF size.

Verification: 19 focused reader tests passed. The expanded disposable PostgreSQL
run passed all 26 groups (the prior 15 publication groups plus 11 checked-open
groups), including raw and gzip SQL checkpoint -> client reader -> exact owned
PDF Blob -> WAL tail -> final confirmation. Both races between first-viewer
guard creation and actual account closure passed, as did archive owner-only
access, shared reader coexistence, blocked publication/revocation, missing
receipts, changed physical metadata and snapshot range/size checks. Twelve warm
opens (six full, six confirmation) caused zero account/path-row inserts, updates
or deletes and exactly six snapshot-reader calls. Confirmation of a 64 MiB + 1
stored checkpoint made zero snapshot-reader calls; a full read refused it.
The exact temporary clusters were stopped and removed. Storage metadata and the
downloaded Blob were local fixtures, not hosted-provider access proof.

The full regression run covered 634 files and 6,163 tests: 6,071 passed, 92
skipped, zero failed and zero canceled (prior baseline: 6,144 tests). The final
focused reader run, actual PostgreSQL run, Vite build and AST graph refresh all
passed. Vite retains the known large-chunk warning. Independent source review
found no further blocker; separate probes confirmed that either PDF or WAL
failure cancels the open without a late sibling response returning data or
reconfirming access. No user-visible route changed in this slice.

The open-path audit found the remaining integration sites: Dashboard's normal
open and upload-open strip generation proof when creating a File; AppShell's
deep links bypass that path and healthy tabs are reused by actor/document only.
PDFViewer and `useAnnotationDoc` still omit the generation argument, while the
legacy YDocProvider and sidecar view-state loader have separate document-wide
state. All need a shared checked-open result and an explicit old-state recovery
policy. The checked download route must fetch the bound object and preserve
authority through handoff. Retry/derived render bytes must not inherit the
original PDF's proof. No such viewer, provider, download-route or offline-cache
activation is included here; no live cloud or Microsoft testing is claimed.

## Checked generation download: local streaming route, disabled

`document-generation-download` adds a read-only endpoint for the checked reader.
It verifies the Bearer token, then calls the authenticated-only checked-open RPC
with that user's JWT and snapshot mode off. The requested document, generation
and all six PDF descriptor fields must match the server's current authorized
descriptor. Only the server-returned descriptor reaches Storage. The service key
is used for the exact Storage read, not to impersonate the user in a read RPC.
The route creates no signed URL, upload, publication, cleanup job or RLS grant.

The endpoint reads the provider stream with backpressure and an incremental
SHA-256. It hashes and emits the same owned chunk, so provider buffer reuse
cannot alter bytes after hashing. It holds the last byte until exact length,
complete-stream hash and a final authenticated read confirm the same current
PDF/publication. A wrong hash, excess or missing bytes, revoked access, changed
generation, timeout or cancellation errors the body rather than closing it as
success. HTTP status 200 alone is explicitly not proof: callers must finish the
body and verify it. The response has no Content-Length, uses private/no-store/
no-transform and nosniff, and keeps the intentional wildcard CORS policy.

There is no second full-file server buffer. Memory still depends on one owned
provider chunk; this is not a constant-RAM guarantee for arbitrarily large
chunks. The server caps accepted PDF size at 256 MiB and the request lifetime at
110 seconds. It bounds request JSON at 16 KiB. Deadlines also check a monotonic
clock so synchronous work cannot outrun the timer callback. Cancel/timeout
cleanup stops the provider reader and hash without waiting forever for a broken
cancel method. A stream returned after cancellation is also closed.

`documentGenerationDownload.js` supplies the client download adapter to the
checked reader. Configuration owns the trusted Supabase origin; a document
cannot choose a URL. It sends the exact tuple with the captured actor's token,
rejects redirects, omits cookies, bypasses caches and never falls back to the old
Storage route. It waits for complete EOF and exact byte length before returning
an immutable Blob; the checked reader still owns final content hashing and
generation confirmation. No automatic retry can silently switch to new bytes.

Review found that a small response made of many empty/tiny chunks could retain
an unbounded number of Blob objects despite a byte limit. The client now copies
into fixed 64 KiB blocks and uses one fixed 8 KiB error buffer. A 10-byte body with
20,000 empty chunks creates only two Blobs; 65,537 one-byte chunks create three.
The error path creates none. Final Blob creation also gets a post-work deadline
and actor check. The browser still retains the full final PDF; this change bounds
chunk overhead rather than claiming a disk-backed browser cache.

Verification: 53 focused checks passed (15 client download, 19 streaming handler,
19 checked reader). The expanded real PostgreSQL/loopback HTTP fixture passed
all 31 groups, retaining the 26 prior publication/open groups. It uses the actual
handler, client adapter and reader with actual checked-open/tail SQL, an owned
PDF stream and fake test-only authentication. Cases cover complete PDF/Yjs reads,
bad hash/short/excess bodies after HTTP200, actual role revocation and a new
publication after partial client bytes, wrong actors/tokens and slow-stream
abort cleanup. No caller installs an incomplete result.

The separate actual Deno entrypoint plus pinned Supabase SDK passed 20 local HTTP
groups. It checks each disabled flag combination, viewer-token auth/RPC versus
service-only Storage headers, exact encoded paths, unique cache nonce/no-cache,
CORS, final revocation, changed object identity, partial-body failure, redirect
rejection and private diagnostic suppression. The observed SDK download route
is `/storage/v1/object/documents/<encoded>`. Deno uses cached dependencies and
only the owned loopback provider, with fixed synthetic keys rather than inherited
cloud credentials. All temporary HTTP servers, Deno children and PostgreSQL
clusters were closed. Deno type-checking of the actual entrypoint also passed.
These are local runtime checks, not hosted Storage or browser-release proof.

The full offline suite passed across 637 files: 6,199 tests, 6,106 passed,
93 skipped, zero failures or cancellations. The preceding checkpoint had
6,163 tests, 6,071 passed and 92 skipped; the added gated Deno/SDK test was also
run separately and passed. The Vite build passed with the known large-chunk
warning. The required AST graph refresh completed after the code and tests
were frozen (27,661 nodes and 45,008 edges).

The local Deno check does not run through the Supabase function gateway.
`supabase/config.toml` has no explicit entry for this new function. Before
deployment, verify the gateway JWT setting, browser OPTIONS preflight and
Bearer-authenticated request through that gateway; handler-only CORS checks
do not establish that deployment contract.

The route stays off unless both `SURVEY_GENERATION_DOWNLOAD=checked-stream-v1`
and the existing `SURVEY_GENERATION_STORAGE_CONTRACT=versioned-standard-v1`
operator check are set, with all required server keys configured. Physical
provider/version behavior remains a deployment gate. No flag, live environment,
Supabase database or Storage object was changed. App open/viewer/provider wiring,
old-generation draft recovery and two-user offline/browser proof remain required
before activation. Microsoft services remain deferred.

## Generation sync: complete-tail checks before viewer adoption

The ongoing sync path still trusted a final page's claimed frontier even when
it omitted rows. The private generation WAL allocates `head + 1` while holding
the document lock and keeps its rows; this is not the legacy global-sequence
format. The transport now requires exact adjacent sequences and complete final
coverage for non-null generations. Null/legacy generations still allow gaps.
The checked file reader preserves its existing incomplete-state error code.

Cold generation reads now reject unresolved Yjs struct or deletion dependencies.
Ongoing catch-up builds the entire fixed tail in a detached copy of accepted
state before applying any row to the live document or settling journal receipts.
A later failed page or unresolved dependency therefore cannot expose an earlier
partial result. Retry starts from the prior covered prefix. Checked rows still
merge into the current live document, preserving edits made during the read.
Dependencies may resolve in a later row of the same complete tail.

Generated reads cap decoded snapshot plus tail bytes at 64 MiB and tail pages at
1,000. Gzip snapshots are checked while expanding, not after an unbounded
`Response.arrayBuffer()`. Exceeding a bound fails the read without deleting local
work. These bounds do not imply an equal total browser-memory cap: Yjs state,
hex transport strings and the live document also consume memory.

Review also reproduced a malformed Yjs ContentJSON error quoting saved text.
Generated decoding now returns a fixed error without the original cause; tests
cover both cold-open rejection and catch-up status/logs. Initial failing tests
also reproduced accepted missing dependencies and partial catch-up publication.
The focused verification passed 124 checks, including real installed SDK
clients for two actors. Each client keeps its exact unsent journal key and bytes
when a later page is missing or returns HTTP 503; no early row enters the live
or accepted state, and a repaired retry resumes the old prefix. The opted-in
local PostgreSQL run passed all four wrapper checks, including the actual
transport harness and existing 31-group publication/open/download harness.
No live credentials or provider were used.

Full regression verification passed across 637 files: 6,217 tests, 6,124 passed,
93 skipped, zero failures or cancellations. Baseline `728d5f8c` had 6,199 tests,
6,106 passed and the same 93 skips. The Vite build passed with its existing
large-chunk warning. The AST graph refresh completed on the final code/test
files (27,673 nodes, 45,044 edges). No UI or two-user browser-release claim is
made from these local module, SDK and database checks.

The provider audit blocks partial viewer activation: `YDocProvider` supplies
role/revocation gates, unsent legacy recovery-close proof, undo and presence in
addition to its legacy data transport. Its disabled/null context is not a safe
replacement. Adopted tabs need a generation-scoped provider branch that keeps
authority and recovery checks, disables old data/undo merging, uses modern/local
history, and supplies generation-scoped presence/restore behavior. Publication
reconciles accepted visible legacy shapes into the modern baseline, but does
not prove that unsent local legacy state was included. No viewer activation or
live database change is part of this step.

Next provider work can reuse `authSessionBridge` and
`documentCollaborationStatus` without an old Y.Doc. Existing registry capture
and close-proof checks can verify retained bytes, but unsaved actor-scoped
legacy bytes need a separate immutable recovery archive before safe close.
Do not attach the old local lifecycle or close coordinator merely to obtain
access monitoring: their normal paths write or append to the old document.
Presence needs a generation-scoped, expiring channel with independent authority
checks. Remote-delete restore needs accepted modern-change events and a
single-object, current-generation restore, not an old whole-page snapshot.

## Generated collaboration provider: dormant authority, recovery and presence

Added `GeneratedDocumentProvider` and `generationCollaborationSession`, but did
not mount them in legacy app routes. The new provider exposes no legacy Y.Doc,
undo manager, backfill, retry queue or data transport. Unknown authority starts
read-only. Before granting the current role, its shared session checks the exact
generation, PDF identity and publication through the lightweight checked-open
RPC. All SDK reads use the captured actor's request-local JWT and bounded
deadlines. It reuses the existing visible-only collaboration status monitor;
it does not add a second role-poll loop. Failed role reads restrict editing.
Denial, changed generation, wrong-actor auth or modern-handle retirement closes
owned presence/monitor work without destroying the modern handle or disconnecting
the shared Supabase client. Reauthentication needs a new checked open.

The modern annotation handle now exposes its captured actor through a read-only
getter, allowing the provider to reject a mismatched handle. The React wrapper
keeps one render-time identity across keyed children. This invalidates old close
receipts on the first replacement render, not merely after passive cleanup.
Tests reproduced and fixed both that stale-receipt case and a late auth lookup
starting new monitor requests after its deadline.

`generationLegacyRecovery` captures both existing registry entries: the raw
document key and the exact actor-scoped legacy key. It neither creates source
documents nor attaches their lifecycle. A separate immutable, content-addressed
IndexedDB archive stores the real document ID, source registry key, target
generation and explicit provenance. Raw bytes remain unattributed; they are
not silently assigned to the current actor. The archive retains complete v1
updates plus pending v2 structures, missing clocks and pending deletion state.
Fresh existing-only verification must match before a close receipt succeeds.
Source mutation/replacement/appearance, account/open changes, aborted or failed
transactions, missing storage and altered archive records invalidate proof.
Read-only close never creates or writes an archive. This covers captured live
registry entries, not every old persistent database or queued operation, and
never proves cloud acceptance. The existing modern local-save proof remains
the viewer's separate responsibility.

`generationPresence` uses a private document/generation-scoped presence topic
and actor-specific presence keys, with fresh authorization before each join's
tracking. It bounds display
fields, scan work and roster size; expires old peers; coalesces tracking; and
untracks/removes only the owned channel when hidden or disposed. Peer metadata
is display-only and cannot grant rights. It never falls back to a public topic.
One live runtime owns each SDK client/topic; duplicate ownership fails explicitly
and a remount waits for prior removal. Multi-consumer reuse still needs a shared
runtime, not duplicate channel owners. `useRemoteEditors` now accepts this
explicit awareness-only scope without requiring a dummy legacy Y.Doc; the old
Y.Doc path is unchanged.

Focused verification: 104 checks passed across the new authority session,
recovery archive, presence, mounted provider/hook and existing generated-sync
tests. Mounted checks use actual React/context/ReadOnlyGate DOM and keyboard
effects; network/presence ports remain local doubles. The actual viewer undo
callback is also exercised with real history inversion/application helpers.
The installed Supabase SDK validates private channel configuration without a
network subscription. These checks are not live-private-policy, full-viewer or
two-user browser-release proof.

Full regression verification passed across 642 files: 6,292 tests, 6,199 passed,
93 skipped, zero failures or cancellations. Baseline `b1cf0953` had 6,217 tests,
6,124 passed and the same 93 skips. The Vite build passed with its existing
large-chunk warning. The required final-code AST refresh completed with 27,737
nodes and 45,179 edges. The new provider remains unmounted in app routes, so
the build alone is not proof of its full viewer integration.

The current role lookup and generation confirmation are separate RPCs. They
do not establish one atomic role/generation observation: a publication or role
change can occur between them. Before activation, replace them with one locked
server read returning the exact generation binding and effective role together.
Server-side generation and write-permission checks remain mandatory regardless.

Activation remains gated on that combined authority RPC, private Realtime
authorization policies and hosted tests, every open route using one checked
bundle and matching modern handle,
modern hook hydration/generation scope, retained queue inventory/recovery, and
accepted modern remote-delete events with a guarded single-object restore.
No existing cloud database, Storage object, account or Microsoft service changed.

## Combined generation and role authority — September 9 follow-up

The dormant generated collaboration session now uses
`read_document_generation_collaboration` instead of separate generation-open
and role RPCs. Migration `20260909100000` calls the existing checked open in
metadata-only mode, then resolves the effective role within that same
transaction. It keeps the existing shared publication, document, inherited
project, account and PDF identity locks through return. Membership triggers
already lock parent rows, including for an inserted direct viewer that would
override inherited edit access. The Postgres skill informed this reuse of the
existing lock order and authenticated-only execution grant.

The response contains only the contract version, actor, document, generation,
PDF identity, publication identity and role. It returns no document row,
checkpoint bytes, source history or download URL. The client checks the exact
response shape and captured identities before accepting the role. Concurrent
refreshes share one request. A missing RPC or malformed response stays read-only;
there is no fallback to separate reads. An explicit access or generation denial
retires the open. This cuts each authority refresh from two RPCs to one;
it does not claim a measured hosted latency or egress reduction.

The earlier separate-RPC activation gap is addressed in local code, not deployed.
Private Realtime policies, checked-bundle viewer/hook integration, old persistent
queue recovery and real two-user browser checks remain required. Server write
authorization still applies to every edit; a prior read is not a lasting write
grant. Microsoft testing remains deferred.

Local verification: 38 focused SDK, mounted-provider and remote-editor hook
tests passed. All 39 disposable PostgreSQL/publication/HTTP groups passed,
including eight new combined-authority groups, and the opt-in Node wrapper
passed without a skip. These use the current shipped role function and real
membership, account and publication locks. They cover both transaction orders,
direct and inherited roles, absent direct-role insertion, account closure,
generation change, minimal grants, migration replay and snapshot-free reads.
The owned temporary clusters were stopped and removed. Vite build passed with
the existing large-chunk warning; no hosted provider or live UI test occurred.
The full `npm test` run passed across 642 files: 6,295 tests, 6,202 passed,
93 skipped, zero failures or cancellations. Baseline `c1d7d54b` had 6,199
passes and the same 93 skips. Final-code AST refresh passed with 27,738 nodes
and 45,180 edges. `git diff --check` passed.

The next checked-open integration must preserve two distinct annotation
positions: the accepted tail frontier and the original checkpoint's compare-
and-swap metadata (`at_seq`, writer ID and writer epoch). The reader currently
returns only `throughSeq`, so passing its bytes straight into sync would lose
the checkpoint write precondition. Extend that bundle contract first. Then
consume it at `openAnnotationDoc`'s backend-hydration step, before outbox replay
and local reconciliation. Also fence the hook's render-time scope by generation
and checked-open identity, replace empty projected state rather than seeding it
from the prior view, and avoid the first Realtime join re-fetching the same full
checkpoint. Retained local work must still be reconciled, not discarded.

## Checked-bundle annotation bootstrap — September 9 follow-up

The checked reader now retains the original checkpoint's sequence, writer ID
and writer epoch in a frozen `snapshotBase`, separate from its tailed
`throughSeq`. A private issuance record binds those values and the validated
annotation bytes to the exact returned bundle and actor/document/generation.
Public byte access returns a copy; copied objects and changed public byte
arrays cannot supply accepted state. The reader retains its already-owned
encoded bytes rather than making another copy of up to 64 MiB.

`openAnnotationDoc` accepts the issued `checkedBundle` through the existing
startup path. It checks the private scope before any registry acquisition or
local store work. After loading the same actor/generation's local journal, it
stages the verified annotation bytes and a fresh fixed tail in a detached
document, then installs only the complete result. It does not download the
same checkpoint again. The original checkpoint metadata still guards the next
checkpoint write. Existing pending-operation replay, receipt checks, rejection
quarantine and local reconciliation remain in place; matching Yjs content alone
does not acknowledge an operation. The first Realtime join closes only its
missing-tail gap; later joins retain checkpoint-refresh recovery.

The annotation hook now keys its local receipt scope and callbacks by account,
document, generation and exact checked-bundle identity. It rejects stale work on
the first successor render, not only after effect cleanup. Checked hydration
replaces every initial view kind, including empty annotations/spaces/markers,
without previous-view seeding or legacy callout migration. Same-generation ink
repair and transient eraser presentation are retained. The hook marks checked
hydration `embeddedImportAllowed:false`; a four-line viewer guard honors that
before querying or stamping the legacy embedded-import marker. Empty successor
state therefore cannot trigger that old import path.

Verification: 148 focused tests passed across reader, bootstrap, generated
sync/SDK/outbox, mounted hook/local-save and the actual extracted viewer import
effect. The real PostgreSQL/publication/HTTP wrapper passed all 39 internal
groups and removed its owned cluster. Vite build passed with the existing
large-chunk warning; AST refresh passed with 27,772 nodes and 45,265 edges.
An in-app-browser smoke check at the existing local no-account fixture route
loaded `clickable-link-test.pdf`, drew a rectangle, exercised undo/redo and
reported no runtime errors. The test rectangle was undone and the owned tab
closed. This smoke check is not proof of checked-generation route integration
or hosted collaboration; the generated hook behavior uses mounted local tests.
The full regression run passed across 645 files: 6,332 tests, 6,239 passed,
93 skipped, zero failures or cancellations. The prior `33c8e67f` baseline had
6,202 passes and the same 93 skips. The high-risk viewer change is limited to
the embedded-import guard above; `git diff --check` passed.

The codebase-design skill guided reuse of the existing reader and sync startup
interfaces rather than a second persistence path. This work does not activate
the new app routes, deploy migrations or validate hosted collaboration. Checked
bundles are live in-process read results, not a new serialized offline-cache
format. Full checked-open route integration, private presence policy checks,
retained legacy queue recovery and two-user browser proof remain required.

### Hook-owned checked collaboration session (2026-09-09)

The checked annotation hook can now publish its exact successfully hydrated
handle to a stable provider bridge. The hook still owns open, final view capture,
local save proof, and writer close. The provider observes that handle; it does
not mount the legacy Y.Doc, backfill, undo manager, or retry queue.

- Waiting for the handle and publishing it do not remount the viewer child.
- A hidden tab retains only its immediately preceding writer for recovery
  checks. Reactivation blocks editing until a new checked writer publishes.
- Hiding during a pending reopen cannot revive an older writer or close proof.
- Actor, bundle, client, and activation changes reject stale callbacks during
  render. Callback changes alone do not reopen or republish a writer.
- Replacing the SDK client requires a fresh checked bundle/open. Keeping the
  old bundle deliberately leaves the provider blocked.
- Observer errors cannot take ownership of the hook or prevent its local save.

Verification: full `npm test` exited 0 across 645 files, with 6,343 tests,
6,250 passed and 93 skipped. The final focused run passed 87/87, including eight
provider cases added after that file had already run in the full suite. It mounts
the real hook, provider, context, authority session, and read-only gate against
local storage/transport test ports. It covers StrictMode's delayed cancelled
open, client replacement, hide/reopen, stale replies, and cleanup. Vite build and
`graphify update .` passed. The in-app browser loaded the existing no-auth PDF
route, drew a rectangle, undid/redid it, and removed the test mark; runtime error
logs were empty. This browser check covers the existing route, not checked cloud
activation or two-user hosted sync.

The bridge is not yet selected by AppShell. Checked-route integration must
intercept Dashboard downloads, deep links and upload results; keep the issued
bundle identity; load only its verified PDF Blob; and include generation in tab
reuse. The existing raw PDF overwrite path must remain unavailable to adopted
generations until generation-aware publication is connected. No migration,
deployment, live data write, Microsoft test or account change was made here.

### Stable PDF source and render-only recovery (2026-09-09)

The actual PDFViewer loader now reads through one source module per load attempt.
It retains the input Blob and gives each parser a fresh ArrayBuffer. After PDF.js
transfers a buffer to its worker, a lenient retry reads the same Blob instead of
downloading the path again. ID-bearing Blobs without a Storage path also recover.
Tests prove one download across the primary/recovery attempts, with real buffer
detachment and identical bytes at each parser call.

Automatic PDF repair no longer calls `onUpdatePDFFile`. That call reached
AppShell's normal replacement/save path and could overwrite shared source bytes
merely while opening a malformed PDF. Repaired bytes now stay in a render-only
Blob scoped to the file, checked bundle, and cloud actor. Original metadata,
including managed-local state and revision, stays intact. Outer repair retries
once in memory; a failed repair does not trigger an unbounded rewrite loop.

Checked PDF reads use a private reader-issued Blob view without copying the
annotation checkpoint. The reader canonicalizes incoming Blobs before checking
native length or allocating bytes, so overridden `size`/`arrayBuffer` properties
cannot substitute data or bypass the byte bound. Checked parses never fall back
to the file object's methods or an unversioned Storage path.

Failed/pending worker tasks receive one cleanup call, without waiting forever on
a failed worker's destroy promise. Old file/bundle/actor replies and watchdog
timers cannot update a new open. Each cloud scope has its own bounded watchdog
budget. Local-only files stay open across sign-in/out; those changes must not
reload or reimport local annotations.

Verification: final `npm test` exited 0 across 647 files: 6,391 tests, 6,298
passed, 93 skipped, zero failures/cancellations. Focused runs passed 137 loader,
reader, source, open-safety and sidecar checks plus 14 local bookmark/tombstone
checks. Three old partial-source harnesses were updated for the stronger load
cancellation callback; their save/cold-open assertions remain intact. Build and
code-index update passed. The in-app browser loaded the existing PDF route,
drew/undid/redid a rectangle, and removed it; error logs were empty. Forced
recovery cases use the actual load effect with local PDF.js/pdf-lib ports, not a
hosted malformed-file test. No cloud writes, deployment or Microsoft testing
were performed. AppShell's checked-open route selection and its remaining
generation-aware save/reuse guards are still pending.

## Checked tab selection and scoped file replacement — September 9 follow-up

AppShell now accepts a reader-issued checked bundle, builds its File from the
verified PDF bytes, and selects the checked collaboration provider before the
viewer mounts. The original bundle stays attached to the tab. Same-generation
opens keep that tab's file and unsaved work; a different generation gets a
separate tab. An unversioned document-list reply can activate an existing checked
tab but cannot replace it or start a legacy writer. A generation-marked file
without its checked bundle fails closed.

Raw PDF replacement now binds the exact source File, tab, account scope, mount
and storage path. Same-tab replacements are serialized, close waits for a
replacement to finish, and stale completions cannot update another tab or report
confirmed success. Managed-local writes retain their expected-revision check.
Checked files reject raw overwrite until checked publication is connected.
An already dispatched storage write cannot be undone by the UI scope guard; a
lost scope therefore reports an unconfirmed replacement, not a rollback.

Browser checks caught a first-edit regression that the initial unit fixtures
missed: plain local Files receive their canonical name-size identity only during
their first page mutation. The guard now accepts that exact identity transition;
a test using the real file factory covers the first and second replacements.
Repeated browser page edits also exposed a render/queued-state handoff: a
temporary state cache could be installed after its expected file-render reset
had already happened. The hook now uses live state once the replacement File
has rendered. Queued actions select the latest callback only within their
original file/account/mount scope. File/account changes, including switching
away and back, retire pending work instead of moving it to the new scope.

Edits rendered while the old source remains current during a held save are
kept, with an explicit warning that PDF bytes may already have saved. This is
not an atomic rollback or a replacement for the existing page-action UI lock:
unrendered state changes during persistence still need that lock. New mounted
tests use actual PDF byte mutations and synchronous React file publication,
including two queued changes from one page to three.

Browser evidence before the final pending-edit guard: annotation draw/undo/redo
passed, and two successive page duplications grew the fixture to three pages.
The delete action opened a native confirmation that blocked browser input and
focus calls for its tab; the native UI fallback denied access to Codex. The
delete check and final repeated-edit browser recheck therefore remain incomplete.
The final fixture loaded without browser error logs, but input did not open the
page panel while that native dialog remained. No live data was used or changed.

Final local verification: the full offline suite passed across 651 files,
with 6,458 tests, 6,365 passed, 93 skipped and zero failures or cancellations.
All 99 selected route/replacement/queue checks passed in a separate run. The
Vite build passed with the known large-chunk warning, and the AST graph refresh
completed (27,856 nodes, 45,415 edges). Gmail showed no new matching service
alerts since the prior checkpoint. These results do not close the browser
recheck or the hosted activation gates.

This is still local integration, not hosted activation. Dashboard clicks, deep
links and upload completion do not yet acquire checked bundles. The next safe
step is a disabled-by-default, actor-scoped acquisition service. A trusted
legacy/checked discriminator and the existing publication/provider gates remain
required. Do not fall back to a raw download after a checked-open error or infer
generation adoption from a filename. Microsoft work remains deferred.

## Checked acquisition and retryable document links — September 9 follow-up

The prior browser blocker is cleared. A fresh in-app browser run against the
committed page-queue fix opened the Pages panel and duplicated page 1, then
page 2, growing the real fixture from one page to three without error logs.
The owned test tab closed cleanly. This completes the pending repeated-edit
recheck; it does not claim the native delete-confirmation check passed.

Document selection now returns explicit acceptance. The deep-link effect clears
the pending ID and URL parameter only after a tab accepts the document. Busy or
stale-scope opens keep the link; thrown identity checks show a safe message
without crashing the effect. Other query parameters, hashes and browser history
state remain intact. Acceptance means the tab was selected, not that its later
PDF load succeeded. Seven tests execute the actual effect and selection code.
Browser checks confirmed a matching fixture opens and removes only `docId`,
while an unmatched link stays on the dashboard with its URL intact. Both runs
had no browser error logs. These dev fixtures do not certify real authentication
or upload recovery.

The new checked acquisition module composes the existing checked reader and
streamed download behind one explicit, default-off open. Its remote dependencies
are the owned generation RPC/HTTP routes through the installed Supabase SDK;
local adapters exercise the same reader, PDF bytes and Yjs state. Each open owns
an immutable actor-bound JWT, deadline, auth subscription and cancellation
scope. Caller abort and timeout cancel only that open; account changes and
explicit disposal retire the module's pending work. Every success/failure path
detaches subscriptions and external abort listeners. Late callbacks cannot
retire a later open, and a failed checked read never falls back to legacy.

Fourteen acquisition cases pass, including the installed Supabase SDK against
an owned HTTP server. Its RPCs retained the captured Authorization header even
when the ambient token changed; abort closed a held RPC socket. Another real-SDK
case changed a valid shared-storage session from actor A to B without a broadcast
event. The final session read caught B while the auth observer still held A.
Retain the repeated session reads: removing them is not a safe optimization in
that supported runtime. The installed SDK also performs its own session lookup
before each RPC despite an explicit Authorization header. Those reads cannot
be described as one session lookup per open.

No Dashboard, deep-link or upload caller enables this module yet. A trusted
legacy/checked mode discriminator and the existing hosted publication/storage
gates remain prerequisites. No Microsoft testing or live cloud changes occurred.

Next activation work must also cover the catalog, not just opening: migration
091 fences `public.documents` SELECT, and an adopted row can make the old list
query raise `SG001`. Do not loosen that content fence. Add a bounded metadata-only
catalog and an authenticated, minimal open-mode RPC. Discovery must use the
existing shared document advisory lock, document SHARE lock, generation-scope
role checks and account guards. A checked head with bad publication data must
still report checked and then fail verification, never return legacy. A legacy
download needs a second explicit legacy/actor check before tab acceptance; that
check is not a lasting lease, so backend null-generation fences and UI recovery
remain required against later adoption or revocation. Real disposable-Postgres
tests must cover mixed-mode listing, role precedence, membership/adoption races,
closing accounts, missing rows, lock contention and repeated migration before
any hosted activation. This contract audit is not an implemented mode RPC.

Verification: the full offline suite passed across 653 files with 6,478 tests,
6,385 passed, 93 skipped and zero failures or cancellations. The additional
missed-broadcast regression was added after that file ran; no implementation
changed afterward. All 106 final focused tests passed, including that new case,
the actual SDK HTTP/abort checks, reader/download checks and existing invite/open
contracts. The Vite build passed with the known large-chunk warning. Browser
checks above used the actual running AppShell, not just extracted handlers.

## Bounded catalog and explicit open mode — September 9 follow-up

Implemented `read_document_open_mode` as a separate authenticated-only RPC.
It returns exactly version, actor ID, document ID, mode and generation ID. It
uses the existing shared document lock, exact membership checks and sorted
account guards. A head always means checked, even without a valid publication
receipt; that missing receipt must fail the checked reader, never select legacy.
Repeated healthy reads do not rewrite document or guard tuples. Existing content
fences and role precedence remain unchanged. The mode result is not a lease
across later network work. Fourteen disposable-PostgreSQL groups cover real
permission checks, replay, missing/closing accounts, adoption/replacement,
membership changes in both lock orders, and rejection of stale legacy reads and
writes. Fixture adoption seeds private heads, not live provider publication.

Implemented `list_document_catalog` as a distinct metadata-only RPC, not a
replacement for current full-row readers. It collects all four existing access
paths: permanent document owner, direct member, project member and project owner.
The current `useDocuments` query only collects the first two. The catalog applies
the real viewer permission helper before page limits, omits archived/closing-owner
documents, rejects closing callers, and deduplicates overlapping grants. It reads
from a statement snapshot without creating account rows or holding membership
write locks; opening must recheck access. The restrictive generation SELECT fence
still rejects raw content reads, while a mixed legacy/checked list succeeds.

The catalog accepts an immutable UUID cursor and 1–200 rows, returning an explicit
next cursor only when another authorized row exists. Each access branch is bounded
before the union; candidate materialization contains IDs, not unrestricted names.
Final metadata uses primary-key lookups. Owner/project partial indexes cover the
active-library cursor. Project membership seeks within each allowed project.
The name is a display excerpt of at most 1,024 characters with `name_truncated`;
the flag also checks a bounded prefix. This is explicit API behavior, not a full
name suitable for rename/copy. File sizes stay decimal strings. No storage paths,
content hashes, generation receipts, annotation state or PDF bytes are returned.

Ten disposable-PostgreSQL groups passed, including mixed modes, all access paths,
direct-role precedence, overlapping grants, archive rules, exact page boundaries,
a one-million-emoji stored title, no guard writes, revocation on the next statement,
and repeat migration. The larger fixture contains 6,000 additional documents,
including 600 documents with overlapping access paths and 5,400 unrelated rows.
EXPLAIN of the exact inner query exposed an initial project scan that discarded
5,400 unrelated rows. The revised project seek discarded none and used 201 final
primary-key metadata lookups for a 200-row page plus continuation check. One local
run measured 5.19 ms versus 27.415 ms before that seek change; these are fixture
observations, not a hosted latency or scale guarantee.

Both RPCs remain disconnected from UI callers and unapplied to hosted databases.
Activation still needs bounded client paging/deadlines, a trusted legacy metadata
and download path with post-download mode recheck, checked acquisition routing,
deep-link and upload routing, thumbnail identity without raw paths, and copy/rename
handling. Alias search is deliberately not claimed: the catalog excludes the
unbounded `name_aliases` array; complete search needs a bounded server search or
separate exact metadata path. Do not silently replace whole-library results with
partial pages or treat an excerpt as an exact name. Publication, provider bytes,
two-user hosted proof, and Microsoft tests remain separate gates. Production index
rollout must account for write locking; these transactional indexes were tested
only on an owned disposable database.

Final verification: `npm test` completed with 6,481 tests, 6,386 passed, 95 skipped,
zero failures and zero cancellations. The two new PostgreSQL wrappers are opt-in
in that offline suite; both passed when run separately with
`SURVEY_POSTGRES_INTEGRATION=1`, executing all 24 database groups. The Vite build
passed with the existing large-chunk warning. The final graph update and
`git diff --check` passed. No UI code changed in this follow-up, and no new browser
or live-auth claim is made for the inactive database APIs. The Postgres skill
guided the keyset, least-privilege and lock-order review; query-plan evidence,
not the skill's generic performance estimates, drove the final SQL changes.

## Client catalog and bounded legacy reads — September 9 follow-up

The existing, live `libraryPagination` helper now limits a read to 60 seconds,
1,000 requests, 200,000 retained rows and 64 MiB of serialized UTF-8 page data by
default. The ID-chunk helper shares one budget across all its chunks instead of
resetting it per chunk. It still reads beyond the 1,000-row provider cap, removes
duplicate requested IDs, uses immutable keysets, and returns either a complete
result or an error with no partial rows. A full page still needs a later empty
page to prove completion. Oversized page responses and off-chunk rows fail.
Existing hooks retain their previous complete rows when a refresh fails.

An optional caller signal reaches the installed SDK's `abortSignal`. A separate
deadline settles even an uncooperative promise and detaches listeners; late pages
cannot become a result. The final outer return rechecks cancellation, fixing a
reproduced three-microtask handoff race. The UTF-8 check rejects a serialized
string already over budget before allocating another oversized encoding buffer.
This bounds retained serialized data, not JavaScript heap or the SDK's earlier
HTTP parse allocation. Existing hook callers still do not pass their scope's
abort signal: stale reads are rejected by their current state guards but may
continue until this deadline. Owned, membership and shared helper invocations
have separate budgets; this is not one 64 MiB cap on an entire composed hook.
Very large libraries now fail visibly at a limit rather than running indefinitely;
the paged catalog integration remains needed to support them without a whole-list
load. No incomplete result may be reported as a complete search result.

Seventeen pagination tests cover the limits, exact UTF-8 boundaries, global chunk
budget, uncooperative hangs, late cancellation, cleanup and installed SDK request
signals. The related mounted-hook suite also checks project/document/template
paging beyond 1,000 rows, failed refresh retention, coalescing, mutation-only
consumers and account changes. A local 10,000-row metadata microbenchmark measured
median 0.204 ms before versus 1.126 ms with these checks (five measured runs after
warmup); this is modest extra CPU for bounded work, not a speedup or hosted result.
The in-app browser's mock dashboard showed all six documents and filtered to the
MEP document with no error logs. Its project navigation button did not change the
mock route, so no project-navigation pass is claimed. That smoke test does not
exercise live cloud paging; the mounted and SDK checks provide that local evidence.
The no-auth PDF fixture also opened and duplicated from one page to two with no
browser error logs. This is local page-operation smoke coverage, not cloud-sync,
live-collaboration, native save, or viewport-geometry certification.

The new default-off `documentCatalogReader` returns frozen exact metadata only
after every page and a final storage-backed actor check. It captures one JWT per
read, checks the opaque caller scope, retires on account changes, and owns a
deadline/subscription per read. Concurrent reads cancel independently; disposal
retires all pending reads. Strict envelope, row, project, cursor, timestamp,
Unicode and decimal-size validation rejects malformed data, extra content fields,
stuck cursors and out-of-budget pages. Accepted rows are copied before later
network waits so a transport cannot change the returned result. Auth failures
and malformed provider details produce safe errors, never a raw-table fallback.
Twenty tests include the installed Supabase SDK with an owned HTTP server,
captured Authorization headers, socket abort, and a real shared-storage account
switch without an auth event. Completing the paging protocol is not one database
snapshot or continuing access authority; opening must recheck current access.

The new reader is not imported by any UI caller and does not replace exact
names/alias search, thumbnails, copying or cloud-open routing. Those activation
gates remain, alongside generation publication/provider proof and Microsoft
testing. The codebase-design skill kept paging and read lifecycle rules behind
small module interfaces tested with the real SDK and owned transport adapters.

Final verification: the full offline suite completed with 6,512 tests, 6,417
passed, 95 skipped, zero failures and zero cancellations. All 99 focused tests
passed. The Vite build passed with the existing large-chunk warning; graph update
and `git diff --check` passed. No SQL, hosted services, real accounts, cloud
documents or Microsoft flows changed. The existing live-helper changes and the
default-off catalog reader are distinct outcomes; passing these checks does not
activate or deploy the catalog path.

## Mode-aware acquisition and bounded legacy PDF reads — September 9 follow-up

The existing checked acquisition now exposes `openCurrent({ documentId, signal })`
behind the same exact, default-off enable flag. The original `.open()` stays
checked-only. Discovery, metadata, PDF download and final checks share one captured
JWT, actor scope, deadline and subscription. The codebase-design skill kept this
lifecycle inside the existing opening module, not repeated across UI callers.

The new path validates the five-field `read_document_open_mode` response. Checked
mode must open the exact discovered generation through the real issued-bundle
reader. Legacy mode performs a fresh, token-pinned metadata SELECT (including
archive filters), downloads that path, repeats metadata, repeats mode, and checks
the current actor again before returning. Denied, missing, changed or malformed
results never cause a fallback, partial result, cache hit or retry. Owner filtering
is deliberately absent: an authorized collaborator can open another user's file.
Captured metadata primitives and the result are frozen; a hashless legacy result
cannot pass the checked reader's private identity check.

`legacyDocumentDownload` uses trusted-origin Storage GET with segment-encoded raw
object names and round-trip URL identity checks. It rejects redirects, excludes
cookies, pins Authorization, and avoids cached responses. It requires a successful
PDF/octet-stream response, exact expected byte length and EOF. Fixed 64 KiB owned
blocks bound retained chunk count. It checks SHA-256 when metadata has a hash and
bounds token, fetch, body and hash waits; cancellation releases pending bodies and
listeners. Error bodies are canceled without reading or exposing diagnostics.

Limits and rollout gates:

- This adds no UI caller and performs no hosted change. Default-off still means
  zero auth, subscriptions, RPCs or HTTP. Existing local-file and open-tab paths
  are unchanged. No live Microsoft or multi-user account testing took place.
- Legacy success uses five HTTP requests (two mode, two metadata, one PDF), not a
  bandwidth or latency win over an unchecked download. Checked immutable cache
  integration remains separate work. There is no shared download cache here.
- Metadata bounds apply after SDK JSON parsing. Hash validation also holds a full
  PDF ArrayBuffer; maximum accepted PDF bytes is not a total process heap cap.
- No final check is a continuing access grant. Hashless mutable files do not
  prove a physical object version. Neither legacy result proves atomic PDF plus
  annotation state. Checked publication and backend legacy-write fences remain
  required when a document is adopted while a reader is in flight.
- Confirmed in `useStorage.replaceDocument`: the legacy replacement only upserts
  Storage bytes and invalidates the download pool. It does not update database
  file size/hash. AppShell updates its local list only. Stricter reads may reject
  these older replacements, so activation must wait for a guarded replacement
  and recovery plan, not a size/hash fallback or a blanket metadata rewrite.
- Dashboard cloud rows, reused upload results and deep links still need the shared
  caller integration; retain existing-tab activation first and zero-cloud local
  opening. Hosted mode migration, gateway/provider proof and two-user tests are
  also still gates. No claim that the new cloud route is live.

Verification for this slice:

- 52 focused tests pass: 22 acquisition tests, 15 new legacy download tests and
  15 existing checked download tests. The acquisition review found a MIME fixture
  problem that let a race test fail for the wrong reason; fixed fixtures now
  assert exact rejection codes and final metadata/mode call counts.
- Actual installed Supabase SDK plus owned loopback HTTP verifies captured JWTs
  on mode, metadata and PDF requests. Transport tests cover safe encoding, real
  PDF hash, redirect-target refusal, socket abort, hung token/body/hash, short or
  oversized bodies, empty/tiny chunks and cleanup. No hosted provider is implied.
- The no-auth in-app browser fixture opened one page and Duplicate produced two
  pages; no error logs. It still showed the previously observed 78% to 187% zoom
  change after duplication. This is page-operation smoke evidence, not viewport,
  hosted sync or multi-user acceptance. The test tab was closed.
- Full Node suite: 6,535 tests, 6,440 passed, 95 skipped, zero failed/canceled
  (`/tmp/survey-current-open-full.log`, exit 0). Baseline was 6,512 tests,
  6,417 passed, 95 skipped, zero failed/canceled; this adds 23 tests.
- Vite build passed with its existing large-chunk warning
  (`/tmp/survey-current-open-build.log`). Graph refresh completed separately;
  generated graph/cache files are not staged. No push, hosted SQL or deployment.

## Cancel orphaned live library reads — September 9 follow-up

This slice changes the active hooks, not the disabled checked-open path.
Projects, documents and templates now pass cancellation through all seven paging
call sites, including owned rows, membership probes and dependent ID chunks.
New refreshes cancel this hook's previous wait; unmount, account changes, project
changes and mode retirement cancel its active wait. The last completed list stays
visible on a failed refresh within the same scope. Changed scopes hide old rows
and errors on the first render, before effects run. Signed-out scopes do not
claim an initial load. Old refetch and event callbacks cannot start queries or
change request IDs under a newer scope, including actor A-B-A.

The codebase-design skill placed shared cancellation ownership inside
`requestCoalescer`, not inside whichever screen started first. Its opt-in third
argument gives each caller a separate waiter and gives the query its own shared
signal. One consumer leaving does not cancel a remaining consumer's read. The
last cancellation evicts the entry and aborts transport. Late success/rejection
cannot clear a new entry. Both old two-argument promise-identity semantics and
invalidation semantics remain intact. Invalidation detaches an entry without
canceling its live consumers. Neither path is a value cache.

First eligible boot reads still share, including screens mounted before auth
finishes or before queries are enabled. Each instance records whether it has
actually started a read: returning to a previously used account/mode must read
fresh, not rejoin another consumer's older sweep. Explicit refetches remain fresh;
templates with `autoLoad:false` still permit explicit reads and writes, while
documents with `enabled:false` remain mutation-only and do not query.

Evidence and limits:

- 36 new mounted tests execute all three real hook bodies with the real paging
  and coalescing modules. Held transport promises deliberately ignore cancellation
  while recording the actual signals. Tests cover surviving peer consumers,
  orphaned reads, refresh, unmount, A-B-A, first-render masks, same-scope failures,
  first login/enable, explicit template reads and membership/chunk retirement.
- Ten new coalescer tests preserve all six legacy tests and cover pre-abort,
  independent waits, last cancellation, synchronous reentrancy, invalidation,
  cleanup and late settlement. A separate installed-SDK/owned-HTTP test confirms
  a surviving consumer gets its rows and the final cancellation closes the socket.
- Full runs stopped on static tests tied to removed string-scope internals and
  the old uncaptured actor expression. Updated assertions target the stronger
  opaque-scope fields, captured actor and abort guard; the mounted tests verify
  behavior rather than only those field names. The final focused group passed
  102 tests. Independent review reran all 36 new mounted tests successfully.
- A browser tab open during a hook-layout edit hit a development hot-reload hook
  ordering error. Full reload cleared it. A clean tab on final code opened the
  local fixture and duplicated one page into two with no error logs. The prior
  78% to 187% zoom change remains observed, not certified viewport behavior.
  Mock library search still narrowed six fixture rows to the MEP row. These are
  local UI checks, not hosted auth, RLS, cloud collaboration or offline-sync proof.
- Cancellation stops client waits and forwards abort to HTTP; it cannot recover
  bytes already sent or prove the hosted database canceled an already-run query.
  No hosted egress or latency saving is claimed without measurement. The existing
  full-library bounds and last-complete-result semantics remain unchanged.
- AuthContext already keeps identical refreshed users stable. Hook read scopes
  now also key on actor ID, not incidental user-object identity. Access grants
  still need authoritative server checks; these scopes are not access leases.
- Mutation callbacks were not changed in this slice. Their stale-scope state
  updates and token binding need a separate audited write path. The previous
  replacement size/hash issue, checked-mode activation, provider/hosted testing
  and Microsoft gates remain open. Nothing was pushed or deployed here.

Next write audit found a concrete existing risk, confirmed with an actual-hook
local mount: a held actor-A template create can append into actor-B list state,
and a retained A `replaceTemplates([])` callback still dispatches after switching
to B or unmounting. That RPC uses the current request actor and has no expected
actor argument; the SDK supplies ambient credentials unless explicitly pinned.
This is wrong-intended-actor execution, not an RLS bypass. Guard dispatch and every
awaited stage, bind credentials, reject stale state/results, and protect completed
mutations from earlier whole-list reads. Do not assume abort rolls back a write
or add blind retries. No live account or template was touched by this probe.

Final verification: `npm test` passed with 6,582 tests, 6,487 passed, 95 skipped,
zero failures/cancellations (`/tmp/survey-library-cancel-full-verified.log`,
exit 0). Baseline was 6,535 tests, 6,440 passed, 95 skipped, zero failures; this
adds 47 tests. The 102-test focused group and all 210 tests referencing the hooks
also passed. Vite build passed with the existing large-chunk warning; graph
refresh completed. Generated graph/cache files are not part of the commit.

## Bind library writes to their issuing account — September 9 follow-up

The active projects, documents and templates hooks now use an owned write
transport. Before creating a lazy SDK builder, it checks the actual auth session
against the issuing scope. All stages pin the initial JWT in the request header,
disable SDK retry, share a 60-second deadline, and recheck auth after responses
and before returning. A short-lived auth listener catches account A-B-A during
an operation; it is removed on every exit. Retired callbacks reject before auth
or query work. Current mutation-only document/template hooks still allow writes.

This fixes wrong-intended-account execution, not an RLS bypass. RLS remains
authoritative and shared-document writes still rely on server roles. A timeout,
abort or account change after dispatch is an uncertain write outcome with
`mayHaveCommitted:true`, never a rollback receipt or an instruction to retry.
Project/mode retirement is checked at each await boundary; absent an auth event,
a held HTTP request may last until response or deadline. This is not an immediate
scope-change transport-abort guarantee.

Document content dedup keeps lookup, revive, insert and confirmed-23505 winner
lookup under one actor/token. Inputs are copied before auth awaits. Update replies
must match the requested row ID. Invalid row/set replies preserve prior state and
report uncertainty after dispatch. Local input exceptions and server exceptions
expose only fixed safe error text/codes. `updateLastOpened`, which currently has
no source caller, now rejects safe failures instead of silently ignoring SDK
errors; future best-effort callers must consume that rejection explicitly.

A pending list read owns a compact journal of acknowledged changes: one patch
per row plus at most one replacement snapshot. It applies them in linear time
over the returned rows before both state publication and the returned refetch
value. This keeps unseen server rows without letting an older list erase a new
create, undo an update, or revive a deleted row. The journal is per active read,
not a global cache, a cross-hook invalidation bus, or a database transaction.
It does not order concurrent server commits or settle multi-user conflicts.

The codebase-design skill kept transport, publication and reconciliation behind
small interfaces rather than repeating auth/session/error logic in each CRUD
method. No new migrations, live account calls, storage writes, Microsoft tests,
pushes or deployment are part of this slice.

Evidence and remaining gates:

- The old code reproduced a retained template callback dispatch after account
  A-B-A, and all three lists losing acknowledged changes to an earlier read.
- 42 new mounted tests run the actual hook bodies and real mutation helpers with
  local external ports. They cover retained callbacks, unmount, actor/project/mode
  changes, silent stored-session changes, each dedup stage, unknown rows, returned
  refetch data, replacement composition, nested input ownership, malformed/wrong-ID
  replies and safe local input exceptions.
- 16 transport tests include the installed SDK against owned loopback HTTP:
  captured Authorization, no automatic retry on 503, socket cancellation, silent
  stored-session drift, auth A-B-A, whole-operation deadlines and listener cleanup.
  Three journal tests compare compact state to sequential ACK replay, including
  4,000 mixed changes. Focused group: 61 passed, zero failures.
- All 252 tests referencing the database hooks pass. Existing static checks were
  updated to assert guarded reconciled results and copied template payloads;
  mounted tests preserve the real read/CRUD behavior checks.
- Final-code browser checks narrowed six mock library rows to the MEP row and
  duplicated the local PDF fixture from one page to two, with no error logs in
  either fresh tab. The existing 78% to 187% zoom change remains observed, not
  certified viewport behavior. An earlier tab hit a sign-in dialog and a reload
  returned ERR_ABORTED during source updates; a clean tab completed the page flow.
  All owned tabs were closed. These no-auth checks do not test live cloud writes.
- Hosted RLS, two-user collaboration, measured egress, checked-open activation,
  legacy PDF replacement size/hash consistency, provider retention/erasure and
  Microsoft gates remain open. No production performance claim follows from
  local tests. The active goal remains incomplete.

Next replacement audit clarifies the earlier hash gate: `documents.content_sha256`
is the original-import dedup key, while checked-generation assets carry the current
byte hash. Recovery deliberately returns newer published bytes for that import.
Do not overwrite the import hash to repair stale legacy size metadata. The only
raw replacement caller is the page-operation path through PDFViewer and AppShell;
AppShell changes size only in React after Storage upsert. Legacy hash paths may
have references in several projects, and page annotations commit separately.
A client-only upload-then-metadata-write cannot resolve those races. Next work
should compose an isolated page-replacement adapter with the existing immutable
generation publication transaction, preserving import identity and requiring an
exact source version plus annotation frontier. Keep UI activation gated. Actual
Storage sizes already drive quotas; this is not a newly proved quota source.

Final verification: `npm test` passed with 6,643 tests, 6,548 passed, 95 skipped,
zero failures/cancellations (`/tmp/survey-library-mutation-full-verified.log`,
exit 0). This adds 61 tests to the prior 6,582-test checkpoint. The first full
run also passed before the last six review checks were added. The final focused
61-test group and 252 hook-consumer tests pass. Vite build passed with the existing
large-chunk warning (`/tmp/survey-library-mutation-build-verified.log`); graph
refresh completed with 28,023 nodes and 45,673 edges. Generated graph/cache files
remain outside the commit. No live service was changed by this verification.

## Prepare exact page replacements privately — September 9 follow-up

`prepareDocumentGenerationReplacement` now composes the existing real PDF and
complete-state transforms behind one private preparation interface. It accepts
only the trusted transform-source envelope and its exact, verified source object.
Actor, document, source, generation, annotation frontier, SQL digest bindings,
object ID/version, byte length and current-byte SHA-256 must agree. Input JSON and
PDF bytes are owned before the first await. Expired proof, sidecars, nonempty
legacy document annotations and incomplete or unsupported state fail closed.
The original-import `documents.content_sha256` stays unchanged.

The module captures source page count/dimensions before mutating the owned PDF.
It uses the same copied operation and copied-widget map for the PDF and all state
projections, returning candidate bytes/hash/size/count and the exact deeply frozen
publication plan. The loaded-PDF internal entry point avoids parsing a second
whole document. Existing byte-only/identity callers keep their return contract.
The codebase-design skill guided this composition; it adds no mock persistence
or new transport interface. Candidate bytes are caller-owned output, not an
immutable remote receipt; staging must still verify their hash and size.

Limits are explicit: source JSON 16 MiB/depth 64, source/candidate PDF 256 MiB,
10,000 pages, plan 64 MiB and combined checkpoint bytes 16 MiB. Source expiry is
checked before and after awaited stages. These bounds do not create a CPU/heap
sandbox for malformed PDFs, and the module does not cancel synchronous parsing.
A deployed worker still needs bounded concurrency and process/resource limits.

The disposable PostgreSQL publication harness now uses this actual preparation
module before reserving/uploading a candidate; a rejected source avoids that
candidate work. All original 39 publication/open/download/collaboration groups
remain. Four added groups prove import-hash preservation and unchanged aliases
sharing a legacy Storage object, rejection of a competing prepared replacement,
preservation of later accepted annotation WAL, and no recreation after deletion.
The fixture uses the tracked import-identity DDL and unique index. Losing an exact
publication reply still replays the same receipt; a historical receipt does not
authorize rewinding the current generation. Preserve the exact plan/IDs/bytes
through any uncertain outcome, not a recomputed Yjs plan.

Verification and limits:

- Baseline PostgreSQL: 39 groups passed before the change. The composed path also
  passed those 39, and the final extended harness passed all 43 with exact failure
  SQLSTATEs. Earlier assertion-only runs stopped on old group counts and an
  expected deletion code; deletion correctly retires the source byte proof and
  returns 23514. Final log: `/tmp/survey-replacement-pg-final-verified.log`.
- Each run used a newly owned Unix-socket PostgreSQL cluster, then stopped it and
  removed that exact temporary cluster. Storage metadata/byte receipts remain
  synthetic fixtures; this is real SQL/PDF/Yjs/loopback testing, not hosted
  provider verification, measured production latency or live egress proof.
- 16 new module tests pass using real PDF/Yjs computation. They cover seven page
  operations with exact saved page sizes/order/rotations, current generation and
  large annotation frontier, input ownership, wrong identities/proofs/bytes,
  unsupported/private state, expiry, bounds and safe errors. A delegated real
  `PDFDocument.load` counter proves preparation parses exactly once. The existing
  page mutation/history/forms/local replacement/dedup/recovery group passes 228
  tests. Independent review found no blocking defect.
- The complete private plan includes foreign survey data and must never enter
  browser bundles/responses. Its imports are confined to tests and the local
  PostgreSQL harness. No UI activation, endpoint, live grant, schema deployment,
  account, provider upload or Microsoft testing was added. The publisher remains
  denied to both browser and service roles; a trusted worker/authority entry point
  and verified provider flow are still required. This is a tested prerequisite,
  not a claim that the app's legacy cloud replacement path is now atomic.

Final verification for this slice: `npm test` completed with 6,658 tests,
6,563 passed, 95 skipped, zero failed/canceled (`/tmp/survey-replacement-full.log`,
exit 0), against the unchanged final production source. The final parse-count
test and stronger physical-page assertions were added to the test file after
that file had run; all 16 final preparation tests then passed independently
(`/tmp/survey-replacement-new-focused-final.log`). The full-run baseline was
6,643 tests, 6,548 passed, 95 skipped. Vite build passed with the existing large
bundle warning (`/tmp/survey-replacement-build.log`). A fresh no-auth in-app
browser fixture duplicated one page into two with zero error logs; the prior
78% to 187% zoom change remains observed, not viewport acceptance. The owned
browser tab was closed. No live cloud save was attempted.

## Bound private replacement preparation workers — September 9 follow-up

`createDocumentReplacementExecutor` adds one server-private interface around
the exact replacement preparer: `prepare(input, { signal })` and idempotent
`close()`. It snapshots bounded JSON and the source PDF before returning its
promise. It reserves the job count, queue slot and aggregate input-byte charge
before copying the PDF. The caller's buffer stays attached; only a fresh owned
buffer is transferred. Each active job gets a fresh fixed Node module worker
with an empty environment, empty `execArgv`, JavaScript resource limits and
private drained output streams. There is no caller worker factory, code path or
retry hook.

Defaults are one active job, two queued jobs, 384 MiB of aggregate retained
input and a 60-second deadline. The deadline covers queue wait, worker startup
and compute. The input still has the preparer's tighter 16 MiB JSON, 256 MiB
PDF, depth-64 and 10,000-page checks. Executor timeouts cannot exceed Node's
2,147,483,647-millisecond timer limit. These are input, queue and JavaScript
heap controls, not process RSS, ArrayBuffer or network sandbox limits. The
synchronous input copy and parent result checks also do bounded work on the
parent thread.

The parent checks the job, actor, source, document, operation, generation,
annotation frontier, source object and candidate size/format before it returns
the transferred result. It then freezes the plan. Abort, timeout and close win
both before and after result validation, so a late worker reply cannot succeed.
An ended job keeps its running slot and input charge until the worker actually
exits. `close()` rejects queued and active work, starts no replacement jobs and
waits for all worker exits. Fixed executor errors cover bad input, busy, input
limit, abort, timeout, close and worker failure; a worker's valid preparer
rejection keeps `DOCUMENT_GENERATION_REPLACEMENT_INVALID`.

Review added four direct checks: an overdue reply after the parent event loop
was blocked, hostile scalar input that must not run a getter, busy rejection
before hostile JSON traversal and rejection above the Node timer maximum. The
final review also found that input Proxy traps could close, abort or submit a
nested job while the outer call captured data. The executor now rechecks close,
abort and queue state after capture, then close and abort once more after its
owned copy and before worker start. Three tests cover those exact interleavings.
The final executor file passed all 17 focused worker tests. The earlier combined
focused run passed all 16 pure preparation tests plus the then-current 11
executor tests (27 total); the final focused files therefore prove 16 pure plus
17 worker cases separately. Final frozen-source logs are
`/tmp/sol-executor-pure-regression-final-20260909.log` and
`/tmp/sol-executor-worker-tests-final-20260909.log`.

The final disposable PostgreSQL generation publication harness passed 43/43
groups and removed its exact temporary cluster
(`/tmp/sol-executor-pg43-frozen-20260909.log`). `npm test` passed with 6,676
tests: 6,581 passed, 95 skipped and zero failed or canceled
(`/tmp/sol-executor-full-npm-test-final-20260909.log`). The Vite build passed
with the existing large-chunk warning
(`/tmp/sol-executor-vite-build-final-20260909.log`). These are local SQL,
Node and build checks. They do not prove a live provider, cloud deploy or UI
flow.

The local fake/IndexedDB regression group passed 194/194 (exit 0,
`/tmp/survey-local-offline-regression-sol-20260909.log`). This is local proof,
not live cloud proof. The in-app browser was unavailable (`Browser is not
available: iab`). An old process on port 5218 was already dead; the QA pass
started and stopped its owned Vite process and confirmed the port closed. It
did not produce fresh UI proof.

This module remains dormant and private. No browser route, publication call,
activation flag, authority grant, cloud service, Microsoft flow or credential
path imports it. It produces a checked candidate and private plan; it does not
stage, publish or prove durable state.

## Central checked cloud-document open — September 9 follow-up

`AppShell` now owns the one cloud-document open route used by Dashboard clicks,
confirmed uploads and document links. A healthy tab for the same actor opens
first without an auth call, RPC or download. Other duplicate opens share work
only when the actor scope, mount and document ID all match. Actor change,
unmount and React Strict Mode remounts retire the old acquisition and block a
late reply from adding or replacing a tab. Local, managed-local, no-ID and dev
fixture opens remain outside this route.

The route stays off by default. Only the exact build value
`VITE_SURVEY_CHECKED_DOCUMENT_OPEN=mode-v1` turns it on. With the flag off,
AppShell keeps the old Storage/data-URL flow and can reuse the confirmed upload
file hint to avoid a second download. It snapshots the row ID, owner, project,
path and name before any wait and reuses an existing `File` only when those
cloud fields match. With the flag on, it ignores all caller PDF hints for cloud
IDs and asks the existing checked acquisition for current data. A checked result
passes its exact bundle to the checked tab path. A legacy result opens the Blob
returned by the bounded legacy reader and attaches the authorized row metadata.
Discovery or download failure has no raw-byte fallback. A failed legacy tab may
be replaced by new legacy data, while a failed checked tab can only be replaced
by a valid checked bundle and cannot be downgraded to legacy bytes.

Mutable legacy rows use the fresh authorized row for actor, document, path and
mode checks. The reader bounds the actual response stream, checks PDF status and
type, and checks the final count against a supplied response length. It does not
treat `documents.file_size` or `documents.content_sha256` as a current-byte
receipt: old saves can change the PDF at the same path, while that hash remains
the original import and dedup identity. This proves a bounded current download,
not an immutable object version. Checked generation mode still uses its exact
generation receipt.

Document links clear `docId` only after the central route accepts the open; a
failed or stale open keeps the link for retry. A confirmed upload also stays a
confirmed upload if only the later open fails. Dashboard reports that as an open
error instead of a failed upload or recovery attempt.

The final frozen-source focused route run passes 95/95 tests
(`/tmp/checked-cloud-open-focused-final-20260909.log`). It includes 13 new
mounted AppShell/Dashboard cases, 37 acquisition/legacy-reader cases and the
updated prior route groups. It covers edited legacy PDFs with stale row
size/hash, flag on/off paths, fast tab reuse, checked-tab no-downgrade, failed
reload, row mutation, actor A-B-A, unmount, Strict Mode remount, document-link
acceptance, new and reused upload hints, open-only upload errors, stale actor
suppression, real pdf-lib checked data, Dashboard routing and local/dev bypass.
The KAL438 group then passed 16/16 after a one-line source-regex update
(`/tmp/checked-cloud-open-kal438-final-20260909.log`). The final `npm test` run
ran 6,692 tests: 6,597 passed, 95 skipped and zero failed across 661 regular
files plus four isolated timing suites
(`/tmp/checked-cloud-open-full-npm-test-final2-20260909.log`). The final Vite
build passed with 932 modules in 2.64 seconds and the existing large-chunk
warning (`/tmp/checked-cloud-open-vite-build-final-20260909.log`). An earlier
diagnostic full run stopped with one stale KAL438 source-regex failure after
3,801 tests (3,731 passed and 69 skipped); its original log was kept and is not
counted as pass proof.

This is local source and test proof only. The flag remains off; no publication
route, live cloud call, Microsoft 365 flow, credential use or deploy was enabled
or tested in this slice. A final in-app no-auth fixture check loaded
`?testPdf=clickable-link-test.pdf`, used Pages > Page 1 > Duplicate, showed two
rendered thumbnails and logged no errors. The known 78% to 187% zoom jump still
occurred and was not fixed or accepted as viewport proof. The fixture's
`Syncing` label is not cloud-save proof. This check used no live auth and did not
exercise cloud open or the flag-on path.

The next gate must choose a Node host and grant only the narrow publication
authority that host needs. Default flags and migrations stay unchanged until
that choice and its tests pass. The local tested endpoint and injected test
drivers remain separate from a hosted route; they are not hosted or provider
proof.

## Durable private replacement preparation — September 9 follow-up

The prior private worker could keep its exact plan only in process memory. A
worker or host restart after verified uploads could lose that plan, while the
SQL publication receipt stored only its hash. A retry could not prove whether
it should reuse the old plan, rebuild data or return a lost publish result.

Migration `20260909103000_document_generation_replacement_requests.sql` adds a
private SQL checkpoint before publication. The interface has three functions:

- `prepare_document_generation_replacement(actor, source, candidate, archives,
  expected_generation, expected_wal_head, operation, plan)` records one exact
  checked plan only after the source and every candidate/archive upload have
  verified object ID, version, hash and length receipts.
- `read_document_generation_replacement(actor, source, candidate, archives,
  expected_generation, expected_wal_head, operation)` checks the exact retry
  intent and current edit access, then returns `missing`, `untracked`,
  `prepared`, `published` or `expired`.
- `expire_document_generation_replacement_plans(limit)` clears a bounded set of
  expired large plan rows. It does not delete source or Storage objects.

The retained identity row binds actor, owner, document, source, expected
generation and WAL head, sorted archive IDs, canonical request and plan hashes,
source identity, and candidate/archive object receipts. A second row holds the
private plan and a generated byte count. It stores metadata and verified object
references, not PDF bytes. The plan stays private, immutable and at most 64 MiB.
Fixed first-pass admission caps are eight plan rows per actor, two per document,
64 MiB per actor and 64 MiB per document. All unpurged rows, including expired
ones, count against those caps. These fixed safety caps are not tier quota
accounting. Actor and document admission locks make concurrent checks exact.

A matching publication insert clears the large plan row only after actor,
owner, document, source, prior and target generation, archives, plan hash and
WAL head all match. The retained identity row and immutable publication receipt
remain, so a lost reply can return `published` even after source expiry or a
newer active generation. A changed request with the same candidate ID fails.
`untracked` means an older upload or publication used that candidate ID without
this checkpoint; callers must treat it as a hard conflict. Only `missing` may
start first preparation. `expired` needs a fresh source and new IDs after the
lookup has ruled out a committed publication. Fresh edit authority is checked
for prepared and published reads. The final existing publisher remains the sole
fresh source/frontier/access CAS gate. Before it stores a new plan, preparation
also rejects an already-stale generation or WAL head and an exact snapshot that
changed at the same WAL point. These are early stale-work checks under the held
document lock, not a claim that the journal replaces the publisher's full CAS.

Document deletion cascades through both checkpoint tables. Their guards allow
only that real parent deletion while rejecting direct live-row changes,
deletes and truncation. The expiry sweep and publication trigger use the same
candidate lock as prepare, read and publish, so they cannot remove an in-use
plan.

Preparation and publication must be separate committed transactions. A host
must await the prepare commit before it calls the publisher. Calling prepare and
publish in one transaction does not make a durable prepublish checkpoint if the
host or transaction ends. This migration exposes no browser or HTTP route and
grants no function or table access to anon, authenticated or service roles.

The final disposable-PostgreSQL run passes 55/55 checks and removes its owned
cluster (`/tmp/save-orchestration-pg55-trigger-final-20260909.log`). It covers
restart/reconnect reads, lost publication replies, retry conflicts, upload and
source drift, both same-WAL snapshot replacement modes, authority loss, expiry,
newer generations, admission locks and caps, cascade cleanup, grants, and an
exact publication-trigger mismatch that rolls back while preserving the plan.
Restart proof uses a fresh caller and database connection; it is not a database
crash or power-loss test.

This slice does not implement a complete request handler, candidate PUT resume
after restart, a Node host, a DB grant, a browser route, a runtime flag, live
provider use, Microsoft work or a deploy. The full offline app suite and build
remain local proof only. The final offline suite ran 6,692 tests: 6,597 passed,
95 skipped, and zero failed or cancelled
(`/tmp/save-orchestration-full-npm-test-20260909.log`). The required code-graph
refresh also exits 0 with 28,101 nodes and 45,833 edges. The production Vite
build exits 0 after building 932 modules in 940 ms
(`/tmp/save-orchestration-vite-build-20260909.log`).

## Current status: private replacement request composition

`src/services/documentReplacementRequest.js` now composes one private,
unmounted Request handler around the existing source capture, source-byte
proof, source-bound upload, replacement executor, durable journal and sole SQL
publisher. Its factory defaults off. The request body accepts only document,
generation and WAL scope, one supported page operation, and explicit existing
source, candidate and archive IDs. The bearer token alone supplies the actor.
It does not accept or return an actor claim, plan, source envelope, PDF bytes,
hash, Storage path, signed token or provider error.

After auth, the handler reads the exact journal before any source or worker
work. `published` returns a checked immutable receipt. `prepared` publishes the
stored private plan without another source read, worker or upload. `untracked`
and `expired` fail closed; only `missing` starts the full flow. The handler
awaits the prepared-plan commit as its own remote call before it starts the SQL
publisher. A lost prepare or publish reply returns only an unconfirmed result
with the same caller-supplied IDs. It never retries a mutation or makes new
source, candidate or archive IDs.

The existing source-byte verifier still hashes and records the proof. A bounded
pull-through copy owns the one supported PDF while that verifier drains it, so
the first path reads the provider object once. An already-verified source also
requires one exact no-cache provider read and the existing stream hash check. No
`ReadableStream.tee()` or second verifier was added. Sidecars fail before the
provider read, worker, archive upload or candidate upload. The original source
PDF is archived only after the worker accepts the private source state. The
candidate then uses the existing source-bound upload and complete-stream check.

One handler permits one active request by default, with no queue. It holds that
slot from request-body capture through publication and does not release it while
an ignored body, provider, executor or remote call still owns data. The whole
request has a fixed five-minute default deadline; each existing child handler
keeps its own shorter cap. Source PDFs remain capped at 256 MiB, private JSON at
64 MiB and the public request at 16 KiB. These JS and stream caps are not an RSS,
network or provider sandbox.

Focused source tests pass 18/18, including both one-provider-read paths, exact
journal replay, lost commit and publish replies, actor isolation, same-process
admission, late abort settlement, strict output scrubbing,
sidecar rejection and the real replacement worker/PDF path. This is local
proof with the actual three handlers and worker, but injected private database
and provider adapters (`/tmp/document-replacement-request-focused-final-20260909.log`).
The final offline suite ran 6,710 tests: 6,615 passed, 95 skipped, and none
failed, cancelled or remained pending
(`/tmp/document-replacement-request-full-npm-test-20260909.log`). The production
Vite build exits 0 after building 932 modules in 880 ms
(`/tmp/document-replacement-request-vite-build-20260909.log`).
It proves call order, not a committed SQL transaction or hosted provider. The
required no-cache fetch is part of that future provider adapter contract; the
local injected stream does not prove hosted cache behavior. The prior 55/55
disposable-PostgreSQL journal/publication result remains separate. The app's
current raw legacy overwrite path is unchanged, the checked-open flag remains
off, and this handler has no HTTP mount or chosen host/DB role. Client
page-operation routing, sidecars,
provider contract proof, live auth/cloud tests, flags and deployment remain
open. The existing publisher preserves the import hash and changes the current
generation path only when a future host calls this checked flow; this slice does
not change local-file routes.

## Current status: checked viewer page replacement caller

The viewer now has a checked-generation page replacement caller, but it remains
off unless `VITE_SURVEY_CHECKED_PAGE_REPLACEMENT` is exactly `mode-v1`. This is
separate from the checked-open flag. The app has no default transport URL or
chosen host. AppShell accepts a host adapter that takes the body, access token
and abort signal and returns a `Response`; a local test adapter may bridge that
seam to the private Request handler. Normal builds do not mount or guess an
endpoint.

For a checked page action, the viewer first drains the current generation's
write queues, then captures and rechecks the accepted actor, document,
generation and WAL frontier. It sends the existing effective physical page
operation. This keeps private display rotation local while preserving the old
rotate result: source rotation 0 plus local display rotation 90 and a clockwise
90 action requests 180; the matching counter-clockwise action requests 0. The
checked path does not run the browser PDF rewrite or commit its old page graph.
Managed-local files keep their prior byte and revision-CAS path.

An IndexedDB row keyed by actor and document owns the exact seven-field request,
three retry IDs, phase, immutable first local view snapshot and any publication
receipt. Recovery reads this row before it captures a new action. An automatic
attempt runs when the checked writer for that actor, document and generation is
ready. A click may also settle a prior row, but it then reports that the click
did not start a new change. Lost replies reuse the same IDs. A different action
cannot replace an unresolved row. A newly reserved row may be removed only by
exact revision CAS when its accepted frontier fails recheck before any remote
step; a peer-dispatched row stays.

After a published result, the caller opens the current checked generation. It
retires the old generation before an exact same-tab swap, unless that generation
is already installed. The current generation may be newer than the immutable
receipt. The caller never installs the old local PDF result. It stores the
latest private source-generation page view just before an exact-target swap,
remaps that view, stores the target view, then swaps without an await between
capture and install. A later current generation reads its own scoped state or
empty defaults. Storage failure leaves the published intent and old-generation
state for recovery.

Page names, bookmarks, display transforms, region visibility, survey item data
and the active space remain per-device data. They use actor, document and
generation storage keys and are not added to shared annotation metadata. Old
keys and bad entries remain as recovery evidence. The viewer loads each checked
scope through a rendered-state gate, so the first render of generation B cannot
write generation A state under B. The same scope key resets page history across
actor or generation changes.

This is still a gated client slice. Legacy cloud files have not been adopted to
checked generations. The server's public conflict response does not yet split
expired from untracked state, so both remain blocked; an authenticated terminal
subtype and explicit refreshed-source/reset UI are still needed. Sidecars,
host/provider choice, deployment and live auth/cloud or two-user proof remain
open. Same-document generation reset keeps workbook registration and durable
pending-change keys, but it clears the selected template and Excel baseline and
closes the live workbook session. The in-memory Excel modal, import review and
pending callbacks do not yet have mounted generation-scope proof, so this slice
does not claim a safe new-generation Microsoft round trip. An earlier broad
focused set passed 156/156. After the final checked-scope fixes, the frozen
affected set passed 93/93
(`/tmp/page-replacement-save-final-frozen-affected-20260909.log`), including
actual mounted AppShell and viewer callback scopes, late private edits, quota
retention, generation load and history gates, IndexedDB retry state, a real PDF
rotate, accepted frontier/local routes, checked-to-checked swap success, and
legacy-to-checked queued-work retirement. The final mode-transition subset also
passed 26/26. This is local proof; it does not select a host or prove a live
checked cloud write.

The default local browser fixture loaded at 1280 by 720, duplicated page 1 to
two pages, then rotated page 1 while page 2 stayed unchanged. The fresh run had
no app errors and only the known offline credential warning. This does not test
the gated checked route. The existing zoom jump from 78 to 187 percent,
disabled Undo state and offline Syncing display were observed and were not
changed.

The frozen full test run stopped after 5,980 tests: 5,901 passed, 78 skipped and
one unchanged timing test failed. `roundStrokeOutlinePerformance` measured its
target case at 545.3 ms, over its release budget
(`/tmp/page-replacement-save-full-npm-test-frozen-final-20260909.log`). Its test
and both source files have no diff from `HEAD`; an isolated no-overlap rerun
passed 15/15 with the target at 387.99 ms. No threshold was changed and this is
not reported as a green full suite. The production build passed with 935 modules
in 1.89 seconds (`/tmp/page-replacement-save-vite-build-20260909.log`). Earlier
full runs were diagnostic and stopped on stale test-only source extraction
scopes while the high-risk files were moving; those fixture ports now pass and
are not production failures.

## Current status: explicit expired page-request recovery

The private replacement request now reports a resettable terminal state only
when its authenticated journal read returns the exact `expired` record for the
same actor, document, source, candidate, archive list, accepted generation, WAL
and page operation. The public reply is HTTP 409 with a small, fixed-shape
terminal receipt. Generic database errors, `missing`, `untracked`, malformed
replies and uncertain transport results do not produce this receipt and remain
blocked. `prepared` and `published` also cannot be reset, but keep their normal
exact resume and reconciliation paths. This avoids clearing a request that may
have published or may still finish.

The browser caller caps the whole public reply at 16 KiB and uses one
configurable deadline, 30 seconds by default, across the host transport and
response body. Abort, timeout, bad status, oversized or truncated bodies cancel
the readable response when possible and keep the durable request unresolved.
A late host response is not parsed or accepted. This is a local client bound;
the future host adapter must also honor abort.

An exact terminal receipt changes the actor-and-document IndexedDB row to
`expired`. The row keeps its request body, immutable retry IDs, local private
page view and terminal proof. The client exposes one explicit reset CAS bound to
the actor, document, row revision and candidate ID. It deletes only that expired
intent row. It does not run or replay a page action, reopen or replace the PDF,
clear annotations, drafts, history, outbox data or generation-scoped private
view state. A stale callback cannot clear a new row with a reused revision, and
a changed actor, tab, file or checked bundle cannot show or act on the old
notice.

AppShell shows a two-step notice: the first choice keeps the request blocked;
the second says that clearing it allows a later action but runs no page change.
A failed clear keeps the same notice and candidate. A confirmed clear says,
“Expired request cleared. No page change was run.” The next page action must
still take the normal checked fresh-capture and current-generation path and will
mint new IDs. This slice does not add an automatic operation replay.

Late publication cannot follow the exact terminal proof under the existing SQL
contract: journal read and publication share the candidate advisory lock,
publication wins the read if it committed, the prepared plan is gone at the
terminal state, and its expiry does not exceed the bound source and upload
leases. The publisher also rechecks those leases. This is local contract and
disposable-PostgreSQL proof from the prior journal slice, not a database crash,
power-loss or hosted-service test. No SQL changed here.

The frozen post-close focused extraction set passed 344/344
(`/tmp/expired-recovery-post-close-final-focused-20260909.log`); its page and
close subset passed 41/41. The request-only set passed 21/21
(`/tmp/expired-recovery-request-final-20260909.log`). It covers exact proof,
forged and generic conflicts, body size and time bounds, late cancel,
publication and CAS races, old-row compatibility, actor/tab/file/bundle scope,
delayed old-notice failures, and exact recovery cleanup after a confirmed tab
close. The frozen full suite ran 6,754 tests: 6,659 passed, 95 skipped, and none
failed or were cancelled
(`/tmp/expired-recovery-final-full-npm-test-20260909.log`). The production Vite
build passed with 936 modules in 874 ms
(`/tmp/expired-recovery-final-vite-build-20260909.log`).

The in-app browser exercised the shared notice and real client/store with native
IndexedDB at 1280 by 720 through the dev-only
`pageReplacementExpiredE2E=1` fixture. Keeping the request retained the same
candidate; a forced clear failure retained it and showed an alert; exact clear
removed the notice and stated that no action ran; an explicit next fixture used
a new candidate; and the old reset token could not clear that new request. The
fixture uses a unique test-only database and a local response adapter. It is not
live auth, cloud, a production endpoint or checked-document end-to-end proof.
The last fixture row was cleared through the UI and the test tab and dev server
were closed.

The normal local PDF fixture also loaded, duplicated page 1 to two pages and
showed no new app error. That run is a local-route regression only. The known
zoom jump, disabled Undo state, offline Syncing label and offline credential
warning were unchanged. All checked write/open flags remain off; there is still
no chosen host, provider, database role or deployed request route. Legacy cloud
adoption, sidecars, reset UI for any state other than exact expired, live
multi-user proof and the prior Microsoft generation-scope gate remain open.

### Exact duplicate document-owner index cleanup (local only)

The live read-only catalog audit found two valid, ready, non-unique btree
indexes with the same `public.documents(user_id)` key:
`documents_user_id_idx` and `idx_documents_user_id`, 16 KiB each. The former is
the intentional Phase 28 owner-check index. No tracked migration creates or
owns the latter. This is a small catalog cleanup, not an egress, query-latency
or production gain claim. The live project was healthy; the broader advisory
count was 24 unindexed foreign keys, 38 unused indexes, 30 multiple-permissive
policy findings and this one duplicate index. Query statistics had been reset
on 2026-06-03, so cumulative counters do not prove current caller cost. No live
index changed.

Migration `20260909104000_remove_duplicate_document_owner_index.sql` keeps the
intentional index and removes only the exact `idx_documents_user_id` duplicate.
It first sets a transaction-local three-second lock limit, takes an
access-exclusive `NOWAIT` lock on `public.documents`, then resolves both names
under that lock and compares the table, schema, access method, key and
included columns, opclasses, collations, ordering options, expressions,
predicate, relation options, tablespace and persistence. Both indexes must be
live, ready and valid plain non-unique indexes, with no primary, exclusion,
constraint, replica-identity or clustered role. Missing indexes, invalid state
or any catalog drift preserve the candidate index. The drop has no dependent
object removal, and replay is a no-op. A disposable PostgreSQL harness proves
the exact drop without changing owner-filter results, replay, missing and
invalid survivor cases, key/predicate/order and constraint drift, and lock
contention preservation followed by a clean retry. It also proves the retained
index is used under a forced index plan and that real local RLS owner isolation
has the same results before and after the cleanup. The focused Node set passed
2/2 and its disposable PostgreSQL cases passed 13/13. It does not contact or
mutate the live database.

The final frozen release checks ran 6,756 tests: 6,661 passed, 95 skipped,
and none failed or were cancelled
(`/tmp/document-owner-index-post-rename-full-tests-20260909.log`). The Vite
build passed with 936 modules in 809 ms
(`/tmp/document-owner-index-post-rename-build-20260909.log`). These results
include the rename-race fix below; the earlier green run preceded that fix.
No application source, feature flag, hosted route or live schema changed.

The heap lock does not block `ALTER INDEX ... RENAME`. The migration therefore
checks its captured OIDs after the named drop: the original duplicate OID must
be gone and `documents_user_id_idx` must still resolve to the captured survivor.
If a concurrent rename makes the drop name point at another index, the check
raises and PostgreSQL rolls the drop back. The harness forces that rename swap
between proof and drop, places a useful `project_id` index under the candidate
name, and verifies that all three original index OIDs remain. A DO-only run also
holds the candidate index relation lock and proves the timeout set inside the
block preserves both indexes before a clean retry.

Sidecar compatibility remains fail closed in this checkpoint. The current v1
Storage writer uses the mutable canonical path
`{projectId}/{documentId}_data.json` and a legacy viewer `pdfId` based on
`_surveyPdfId` or file name and byte length, not necessarily the document UUID.
The pure transform can remap its known fields, but the save path still lacks a
candidate-sidecar upload receipt tied to the candidate PDF generation, a
retained active-sidecar manifest, durable request/journal binding and atomic
publication checks. Checked open also has no active sidecar manifest. Adding
support therefore needs one end-to-end transport and publication slice; merely
removing current guards could lose or expose state. Sidecar annotation carriers
must reconcile only into the existing shared annotation domains, while legacy
sidecar-only and per-device fields must not be promoted into shared metadata.
The current checked viewer can still reach the old cloud-sync save/load calls:
save mutates the legacy fixed sidecar path, while load skips old annotation
carriers but can apply entities and view values. A checked-sidecar rollout must
turn off that mutable path or replace it with the retained generation manifest;
this checkpoint does neither.
Non-empty `documents.annotations` stays blocked because no current writer or
reader defines a safe format. Legacy adoption, host choice and feature enablement
remain separate gates.

## Sources

- [IndexedDB upgrade and transaction rules](https://www.w3.org/TR/IndexedDB/#upgrade-transaction)
- [PostgreSQL transition-table trigger rules](https://www.postgresql.org/docs/current/sql-createtrigger.html)
- [IndexedDB transactions and upgrades](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
- [Postgres index guidance](https://supabase.com/docs/guides/database/postgres/indexes)
- [PostgreSQL row and transaction lock rules](https://www.postgresql.org/docs/current/explicit-locking.html)
- [PostgreSQL DROP INDEX locking and dependency rules](https://www.postgresql.org/docs/current/sql-dropindex.html)
- [Supabase duplicate-index advisory](https://supabase.com/docs/guides/database/database-linter?lint=0009_duplicate_index)
- [Electron app lifecycle](https://www.electronjs.org/docs/latest/api/app)
- [Stripe webhook retries, event ordering and duplicate handling](https://docs.stripe.com/webhooks)
- [Stripe immutable event data and delivery-count fields](https://docs.stripe.com/api/events/object)
- [Stripe subscription statuses](https://docs.stripe.com/api/subscriptions/object)
- [Brevo idempotency keys and 30-minute lifetime](https://developers.brevo.com/docs/heterogenous-versions-batch-emails)
- [Supabase Storage schema and API-only mutation guidance](https://supabase.com/docs/guides/storage/schema/design)
- [Pinned Storage deletion ordering](https://github.com/supabase/storage/blob/b41d14fa15547284b351ea024f8c83a201cdc83a/src/storage/object.ts#L191-L257)
- [Pinned upload permission and elevated completion ordering](https://github.com/supabase/storage/blob/b41d14fa15547284b351ea024f8c83a201cdc83a/src/storage/uploader.ts#L72-L295)
- [Pinned version cleanup worker](https://github.com/supabase/storage/blob/b41d14fa15547284b351ea024f8c83a201cdc83a/src/storage/events/objects/object-admin-delete.ts#L29-L55)
- [Pinned signed upload token handling](https://github.com/supabase/storage/blob/b41d14fa15547284b351ea024f8c83a201cdc83a/src/http/routes/object/uploadSignedObject.ts#L76-L93)
- [Pinned physical version keys](https://github.com/supabase/storage/blob/b41d14fa15547284b351ea024f8c83a201cdc83a/src/storage/backend/s3/adapter.ts#L187-L248)
- [Supabase function runtime limits](https://supabase.com/docs/guides/functions/limits)
- [Per-function dependencies and Node support](https://supabase.com/docs/guides/functions/dependencies)
- [PostgreSQL row-security policy rules](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [PostgreSQL custom error codes](https://www.postgresql.org/docs/current/plpgsql-errors-and-messages.html)
- [Supabase standard uploads, content types and new paths](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
- [Pinned provider object-copy path](https://github.com/supabase/storage/blob/b41d14fa15547284b351ea024f8c83a201cdc83a/src/storage/object.ts#L289-L433)

## Rollback

Code rollback must keep unsent drafts, backups and outbox records. No live schema
change or deletion is part of this slice. Older clients may not read a new pending
draft format, so resolve or migrate pending work before downgrading those clients.
Once a billing caller uses the transition receipts, preserve those receipts on
rollback; dropping them would discard proof of prior committed events.
Once storage retirement is enabled, preserve guards and pending cleanup jobs.
Deploy the migration before new callers; an old server makes the helper defer
cleanup, not delete unsafely. Rolling callers back can make old direct-delete
requests fail against the guards. Do not remove guards or reopen retired paths to
make those requests succeed. Roll back only with a reviewed, guarded cleanup path.
Preserve account closing markers once enabled. Removing them or reverting the RPC
to its old unfenced version would reopen the late-upload race and project cascade
data loss. A partial closure must resume guarded cleanup, not silently reactivate
the account; a shared-file transfer needs its own reviewed operation.
Keep scan cursors and closure receipts when rolling code back. Do not replace
pending replies with success or return to a full recursive inventory. The older
guarded remover can still service durable jobs, but auth deletion still needs an
independent empty check of metadata and pending cleanup work.
For upload staging, apply the migration before the new endpoint or expiry-sweep
caller. Keep the endpoint disabled until its provider gate passes. On rollback,
disable new reservations but preserve operation/claim identities, Storage guards,
retained references and expiry cleanup. Never reopen a canceled path or remove
its byte guard to make a retry succeed. A verified staging receipt alone is not
permission to publish, including during the two-hour expiry window.
For generation transport, keep immutable baselines, WAL, receipts, retirement
markers and read/write fences on rollback. Do not point a legacy client at an
adopted PDF or merge a retired scope into its successor. Disabling new callers
does not authorize deleting recovery evidence or reopening legacy writes.
For source capture, keep receipt identities and expired/canceled tombstones on
rollback. Turn off new captures but continue bounded expiry until pending bodies
are released (the service-only expiry RPC can run while the HTTP flag is off).
Never reuse an old source ID for different input. The source's SQL
hash cannot replace physical file-byte verification or final publication checks.

# Legacy collaboration isolation and local state exchange

Date: 2026-09-08  
Audited revision: `732886a4`  
Status: private design contract; no product change or migration approved here.

## Scope and evidence limits

This report covers the legacy `YDocProvider` / `ydocLifecycle` path, not the
actor-scoped flat annotation service in `annotationDocSync`. No
`src/lib/collab/localSync.js` module exists in this revision; local state exchange
lives in `ydocLifecycle.js`.

Reproductions used the actual Yjs, registry, lifecycle, and y-indexeddb modules,
fake IndexedDB, and simulated browser Web Locks and BroadcastChannel delivery.
The test data was invented. No account, credential, live backend, Microsoft
service, or real user document was used. These are local module results, not a
claim about a deployed build or a live account's feature flags.

No private data was published. Keep this report inside the private repository.

## Current entry gates

| Surface | Current behavior |
| --- | --- |
| `src/AppShell.jsx:2928` | Mounts `YDocProvider` for each non-home document tab, including hidden tabs. Passes document ID and visibility, not the current actor. |
| `src/components/collab/YDocProvider.jsx:190` | Only gates on a nonempty document ID and `isCRDTEnabled()`. The inner tree's key is document ID alone. |
| `src/lib/collab/crdtFeatureFlag.js:19` | Default is enabled. Local `CRDT_LAYER_DISABLED === '1'` or build-time `VITE_CRDT_LAYER_DISABLED === '1'` disables it. This audit did not inspect a live user's flag. |
| `YDocProvider.jsx:217` | Borrows `getOrCreateYDoc(docId)` before its asynchronous session lookup. |
| `YDocProvider.jsx:436` | Attaches local persistence and BroadcastChannel; the same effect mounts the legacy Supabase transport. Neither attachment waits for an actor identity. |
| `YDocProvider.jsx:958` | The cutover seal changes backfill work. It does not gate registry, local persistence, BroadcastChannel, or transport attachment. |
| `YDocProvider.jsx:644` | Looks up the undo/origin actor once per Y.Doc and session ID. This effect has no reactive current-user dependency. |

The legacy provider is therefore on the default document path in source. It is
not restricted to unsealed documents or an opt-in legacy screen.

Explicit sign-out in `src/contexts/AuthContext.jsx:640` reloads the page. That
reduces the ordinary in-memory account-switch path, but does not fix the shared
IndexedDB key. Re-auth and auth events from another tab can also change the
session without this explicit sign-out function. The provider's auth bridge
handles token refresh and signed-out UI state, not a new actor's ownership of
the existing document instance.

## Reproduced faults

### P1 — local document storage and exchange have no actor boundary

Current keys are all document-only:

- Registry: `getOrCreateYDoc(documentId)` in `ydocRegistry.js:28`; release keeps
  the object alive.
- Web Lock: `y-doc-${documentId}` in `ydocLifecycle.js:76`.
- BroadcastChannel: `y-doc-bc-${documentId}` in `ydocLifecycle.js:77`.
- IndexedDB: `new IndexeddbPersistence(documentId, ydoc)` at line 128.

The lifecycle accepts no actor scope. Supplying an `actorUserId` option today
does not change any key or filter an incoming message.

Observed results:

| Reproduction | Actual result |
| --- | --- |
| A borrows a registry document, writes a value, releases it; B borrows the same document ID. | The returned object is identical and B reads A's value. |
| A writes `actor-A-pending`, closes the lifecycle, then B attaches a new Y.Doc to the same document ID. | B hydrates `actor-A-pending` from IndexedDB. |
| A and B attach to the same document ID before A makes a new edit. | B receives `actor-A-live` through BroadcastChannel. |

This is specifically a failure to separate actors' local state, including
unpublished work. It does not establish that a live unauthorized account can
navigate to any arbitrary document through the product UI. Authorized shared
documents must still exchange server-accepted work across actors; one actor's
unverified local cache must not become another actor's pending work.

### P1 — a late follower never requests the history it missed

`ydocLifecycle.js:94` accepts only update messages. Attachment sends no state
vector or initial-state request. Only the elected leader opens IndexedDB. A
queued follower waits for the leader's lock to be released.

Reproduction:

1. The leader hydrates, then writes one annotation before the follower exists.
2. A same-actor follower opens a separate Y.Doc.
3. Wait 550 ms, then write a second leader annotation.
4. Inspect both documents before closing the leader.

Actual result: the leader had two entries, the follower had zero entries, the
follower's role was `unknown`, and Yjs held unresolved pending structs. The later
delta depended on the earlier history that the follower had never received.
After the leader detached, the follower acquired IndexedDB and recovered both
entries.

The cloud transport has a separate sync request protocol. That can mask this
local failure while connected, but does not fix offline local state exchange.

### P2 — follower role and hydration state hide the wait

The lifecycle assigns only `unknown` and `leader`, never its documented
`loser` role. `YDocProvider.jsx:557` polls every 100 ms until the role stops being
unknown, so a follower keeps that timer for as long as another tab holds the
lock. The 500 ms fallback at line 568 clears the visual hydration flag without
proving that the follower has any history. These are direct consequences of the
reproduced follower state, not evidence of a completed local save.

## What can prove ownership or acceptance of old data?

The old y-indexeddb database stores binary Yjs updates in `updates`, plus a
`custom` store. The current lifecycle writes no actor binding to that database.
Yjs transaction origins are not part of the encoded update. Local `authorId`
fields name a mark's creator, not necessarily the author of a later edit or
deletion. Client-written last-editor metadata is not an authoritative receipt.

| Available server signal | What it can prove | What it cannot prove |
| --- | --- | --- |
| Current document owner / collaborator role | Current authorized access under the server policy. | Who authored arbitrary old local bytes, or whether the server accepted them. |
| `documents.cutover_completed_at` | A document-level cutover marker. | Actor ownership or acceptance of a particular local pending update. |
| Exact `doc_yjs_updates.update` matched to a server row, with server-stamped `origin.userId` | Acceptance and actor attribution of that exact matched server update, subject to verifying the deployed schema and authenticated read. The source migration stamps `auth.uid()` at `20260504000000_phase28_transport_auth_validator.sql:221`. | Attribution of unmatched, merged, or otherwise locally changed bytes. |
| Authoritative annotation rows, including creator and last-modified metadata | A clean server view that the current actor may read. | Permission to replay a stale local edit or local deletion over that view. |
| `doc_yjs_state` snapshot | A server snapshot when read and validated through its supported format. | Actor-bound pending history. The current `snapshotStore.js` writes encoding 2 gzip JSON of row-derived annotations and callouts, not an actor-bound Yjs pending journal. |

There is no supported blanket automatic migration of arbitrary unscoped pending
bytes based on the current actor, document ownership, a cutover stamp, or a
matching annotation ID. Rehydrating authorized server state is safer than
relabeling old local history. Unmatched local bytes must remain recoverable.

## Proposed atomic change: actor scope plus local handshake

Do not ship a handshake on the old unscoped channel alone: that would expand the
future-update exposure into an initial full-history exposure.

1. Resolve a reactive actor before creating or binding the legacy document.
   Key the inner tree and local resources by the exact document/actor pair.
   An unresolved or signed-out actor must not join an actorless fallback
   channel. Retire old transport callbacks synchronously on identity change.
2. Use a distinct legacy namespace for registry, IndexedDB, lock, and channel.
   Do not reuse the flat service's `annoflat:` registry or `anno-*` persistence
   names: their document schemas differ. Keep the cloud document ID unchanged.
3. Preserve old raw-document-ID databases and registry objects. Do not clear,
   rename, copy into the new active document, or bind them to a new actor.
4. Exchange state only on the new actor-scoped channel. Include a version,
   document/actor scope, per-mount sender ID, and bounded request ID. Validate
   the full scope before applying a message, even though the channel is scoped.
5. On attach, advertise the local state vector. The leader responds only after
   its local hydration with the missing update and its own state vector. The
   follower applies the update and sends back any bytes missing from the leader.
   This second direction preserves state that existed before the follower's
   update listener attached. Keep the remote-BC origin guard.
6. Retry the exchange on leader promotion and a bounded wake/reconnect event;
   do not add a continuous full-snapshot poll. Make role changes explicit and
   remove the endless unknown-role polling. Separate a display-ready fallback
   from an actual local-hydration result.
7. Extend the existing explicit document-delete path's exact namespace matching
   to cover the new legacy names. Otherwise a later delete/reupload could
   revive that cache. This is distinct from this rollout: no user data should
   be deleted simply to establish actor scopes.

## Required recovery workflow before namespace rollout

The recovery UI and export behavior are part of the change, not later cleanup.

- Detect a pre-existing unscoped database without creating a missing database or
  opening it through a persistence writer. Read it only into a detached review
  path. A registry-only candidate must also remain available until it has a
  verified local backup; do not assume it reached IndexedDB.
- Expose an explicit `legacy_recovery_needed` state. Do not claim the old bytes
  are all unsaved, owned by the current actor, corrupt, or safely migrated.
  If the existence/read check fails, report that the check failed rather than
  treating the cache as absent.
- Keep the source unchanged. Offer an explicit local export of the raw update
  records, database/version metadata, document ID, and any known provenance.
  The export must label unknown actor attribution as unknown. It must not be
  uploaded, emailed, or published automatically.
- Keep the new active view based on authorized server state and the current
  actor's new local scope. Do not merge the review candidate into that view.
- A restore action needs an explicit preview and choice of target, plus current
  authorization when restoring to cloud. It should create reviewed new edits,
  not re-label old opaque updates. Deletions, shared metadata, and unknown-author
  changes need particular care; creator metadata alone does not authorize them.
- Closing, switching actor, or cancelling review must leave the original bytes
  intact. The UI must not promise durable export until the file write succeeds.
- If legacy content cannot yet be reviewed/exported safely, show a clear blocker
  and retain the source. Do not silently make the new namespace look like a
  complete recovery of the old one.

## Can actor-change cleanup ship on its own?

A narrow defense is possible, but is not a complete isolation fix: suspend the
old transport on `SIGNED_OUT` or an actor-ID mismatch, cancel coordinator
restarts, and refuse outgoing sends or stale asynchronous completions. Never
resume that same document under a different actor. Keeping the old Y.Doc and its
existing local persistence path intact avoids deliberately deleting pending
data. This can stop old-document bytes being sent with a new session's transport.

That alone does not fix the document-only registry, cold cache, BroadcastChannel,
or stale undo origin. It must be described and tested as containment, not as an
account-isolation fix. The unchanged local persistence/BC path still needs the
atomic scoped design above.

Do not blindly detach/destroy the old lifecycle during an auth event to make the
cleanup appear complete. Startup persistence is asynchronous: y-indexeddb's
constructor initially has no database handle, and `fetchUpdates` skips its
initial store/apply callbacks after destruction. An early edit may exist only in
the live registry document. Safe retirement needs a verified durable handoff or
an explicit retained recovery state before the last in-memory owner disappears.
Neither a visual hydration timeout nor a best-effort `destroy()` establishes
that proof. No independent listener change is proposed for immediate merge in
this report.

## Exact acceptance tests

Use real Yjs and fake IndexedDB for storage/clock behavior, with mounted React
tests for identity and lifecycle effects. Keep the existing actual-backend
account-lease rules for any later real-auth tests.

### Isolation and identity

1. A edits, closes, then B opens the same document ID: distinct registry objects,
   database names, lock names, and channels; B receives no A-only pending bytes.
2. Two different actors mount concurrently: edits, state requests, replies, and
   malformed/cross-scope messages do not cross their local actor boundary.
3. Same actor and document still converge across tabs and cold reopen.
4. A to signed-out to B while mounted retires A transport callbacks and undo
   origins; B cannot consume late A setup/read completions. Same-actor token
   refresh does not discard local state or create duplicate providers.
5. Unresolved identity creates no actorless persistence or channel. Preserve and
   explicitly test intended signed-out/local-only document behavior.
6. A's old unscoped database remains byte-for-byte unchanged through B's open,
   close, failed checks, and failed export. No automatic import or deletion.

### Recovery

7. Existing unscoped bytes raise recovery-needed without appearing in the active
   actor's Y.Doc. Missing database detection creates no database. Blocked/read
   failure cannot claim no recovery is needed.
8. Export success is verified by reading the written file back; write failure,
   quota error, cancel, or actor change keeps the source and the recovery state.
9. Mixed-author edits, creator-owned marks later edited by another actor, and
   delete-only updates are never auto-attributed from creator or owner fields.
10. A safe server baseline does not overwrite or silently suppress the preserved
    legacy candidate. Review cancellation leaves both sources unchanged.

### Local state exchange and lifecycle

11. Leader writes before follower opens; offline follower receives all existing
    entries while the leader remains open. A later causal delta applies without
    unresolved Yjs structs.
12. Follower has pre-attach edits: bidirectional exchange makes them reach the
    leader's local persistence and survive both handles closing and reopening.
13. A request before leader hydration waits for a complete response; it must not
    report a blank document as successfully hydrated.
14. Leader closes during a request: next leader hydrates and completes a bounded
    exchange. Aborted followers cannot later acquire a writer or apply replies.
15. Duplicate/reordered replies are idempotent; request/reply traffic is bounded
    and no update echo loop appears. Same-document actors never share replies.
16. Follower role becomes explicit without a perpetual 100 ms poll. Promotion
    updates role again; the presentation fallback is not a durability receipt.
17. Rapid actor change or detach before IndexedDB startup cannot lose the only
    in-memory pending state. Prove the durable handoff or retained recovery
    state, including transaction abort/quota cases.
18. Explicit document deletion removes only its intended new scoped names and
    cannot match a neighboring document prefix; normal scope rollout removes
    none. A delete/reupload does not resurrect a newly scoped legacy cache.

## Existing verification

### Current callback and recovery audit (`9109b5e2`)

The namespace change must retire work inside the called services, not just
detach the provider's React effects:

- `YDocProvider.jsx:208` keys the inner mount by document only; its main cleanup
  dependencies at line 592 contain no actor. Undo setup at lines 651–689 reads
  the actor once, and role lookup at line 1542 depends only on the document.
- The backfill effect checks cancellation before calling `runBackfill`, but
  cannot stop a call already running (`YDocProvider.jsx:988`). That service queues
  a Web Lock without an abort signal (`crdtBackfill.js:436`) and has later local
  changes and a cloud cutover seal after awaited reads. It needs scope checks
  inside the operation, including after waits, not just around the call.
- `annotationCloudSync.js:618` and `:717` start legacy writes with the shared
  auth client, then change a captured Y.Doc at lines 685 and 768. These delayed
  continuations must reject a retired scope before touching the document.
- The registry has no public, non-creating recovery read. `getOrCreateYDoc`
  creates a document and increments its reference count; purge destroys it.
  Recovery therefore needs a narrow snapshot-only accessor, not either API.
- Read old IndexedDB records with an existing-only, read-only transaction over
  the raw `updates` and `custom` stores. Do not use `IndexeddbPersistence` to
  inspect a recovery candidate: opening it applies updates and writes state.

These are current-source findings, not a claim that the fixes have shipped.
Pending raw updates and deletions must survive export; annotation counts or a
matching state vector alone do not establish byte-complete recovery.

The seven existing registry/lifecycle tests passed on the audited revision.
They cover registry reuse, per-document distinction, no-destroy release, lock
release, and cancellation of a waiting lock. They do not cover actor isolation
or late-follower initial state. The read-only reproductions above demonstrate
those missing cases without changing the test or product files.

The original audit above included no product change or migration. The following
checkpoint records later local implementation; it does not enable the new path.

## Helper checkpoint and next close-safety contract

Opt-in scoped lifecycle, read-only recovery, actor-bound runtime and backfill
cancellation helpers now exist. See `non-ms-data-hardening-2026-09-08.md` for
verification and limits. The AppShell/YDocProvider mount is still unchanged.
Routine tests are authorized by the user's standing request; do not wait for
another test-coverage approval.

Review reproduced two close faults in both `ff15dfa7` and the scoped helper:
simultaneous detach before follower-message delivery can leave the final edit
only in memory, and an unresolved IndexedDB open can leave cleanup and the next
writer waiting. The checked-in diagnostic prints those failures; it is not a
passing acceptance suite.

The next proposed fix is a distinct `prepareLocalClose()` proof, not a claim
that `detach()` saves data. Keep each required lifecycle attached until every
close proof succeeds. Bind the proof to exact document, actor, mount generation,
request ID and copied full Yjs update. A follower sends that update to the
leader; the leader validates scope, applies it, appends the full update to the
scoped store and acknowledges only after transaction `oncomplete`. Before close,
recheck identity and exact current bytes, including pending/deletion-only data.
Neither an update event counter nor a matching annotation count is sufficient.

The installed y-indexeddb `synced` event precedes transaction completion;
`storeState()` does not return its nested append/delete chain; `destroy()` seals
listeners but waits on its open promise. None supplies this save proof. Existing
annotation receipts depend on accepted/pending provenance and annotation-specific
maps, so reuse only their low-level transaction patterns, not their authority or
receipt identity for arbitrary legacy roots.

If a leader disappears, storage aborts or a deadline expires, report close
failure in bounded time and retain data. Do not race the writer-lock callback
against a timeout: the old persistence writer may still finish later. A new
per-writer recovery journal is a larger alternative requiring restore, delete
fencing, and compaction, not a safe write-only fallback.

Required new proof before close integration:

- Last follower edit then simultaneous close survives a fresh disk reopen.
- Leader loss, transaction abort, quota and blocked open never report success.
- Deletion-only and unresolved pending bytes survive later predecessor delivery.
- Running compaction cannot erase the acknowledged snapshot.
- Edit, actor change, detach, destroy or explicit purge invalidates an old proof.
- Duplicate, wrong-scope and old-generation acknowledgments are rejected.
- Timeout does not release the old lock; late open cannot revive stale writes.
- A fresh retry succeeds once storage is available.

This close contract is proposed, not implemented. Recovery read/export limits,
the explicit recovery UI and full provider callback wiring also remain required.

## September 8 integration update

The prior paragraphs describe earlier checkpoints. The implementation worktree
now wires the scoped session, combined scoped/recovery close proof, recovery UI,
and tab/native close gates. See the Provider and close integration section in
`non-ms-data-hardening-2026-09-08.md` for actual evidence and remaining gates.
Local mounted and rendered checks do not replace the required new leased
two-user collaboration/offline run. Nothing in this update claims a release.

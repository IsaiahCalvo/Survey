# Data architecture audit and reliability changes — 2026-09-07

## Scope and status

Built from `a5d5c36d` (PR #801), in an isolated worktree. The earlier egress/RLS fixes remain intact. This batch addresses proved defects in file reads, local saves, sync lifetimes, metadata/state, library paging, and upload/cache work. It does **not** claim to make the whole product offline-first.

The database was inspected read-only. No production documents, annotations, storage objects, indexes, or history were removed. No new paid service, VM, or plan upgrade was introduced. Hosted code rollout and installed desktop/mobile rollout are separate steps.

## Acceptance criteria

- Given a failed PDF read, opening it does not delete its document or annotations.
- Given two cloud documents with the same filename and size, opening one does not select the other.
- Given a full local store, Save preserves prior backups, keeps the document dirty, reports failure, and can succeed on retry.
- Given a failed local save during native quit, the app stays open; old save replies cannot affect the next quit attempt.
- Given a file replacement failure, the old target stays intact; concurrent writes to a path run in order.
- Given delayed fetches, an old account, document, or metadata request cannot replace newer state.
- Given a library larger than the server response cap, all rows are fetched with bounded requests and stable cursors; failures do not publish an incomplete success.
- Given concurrent requests for the same PDF and account, one pending transfer serves them; later reads still reach Storage access checks.
- Given a thumbnail write, the image, eviction and byte budget commit together without reading every cached JPEG into memory.
- Given a batch import, at most three jobs run and all page-count tasks are closed, including failures.
- Given a PDF close/reopen, obsolete sync writers stop observing new mutations; old pending work still gets its final flush.

## DO NOT CHANGE

Keep annotation geometry, zoomGeneration, SVG scaling, annotation ownership/RLS rules, quota tiers, production retention, and existing document identities unchanged. Keep local edits and unmerged work in other worktrees untouched. No automatic cloud-to-local migration or local-to-cloud publishing.

Allowed code areas for this batch: library/storage hooks, metadata and thumbnail stores, local save result handling, document tab matching, Dashboard read/import handling, sync teardown and legacy retry safety, Electron atomic write/quit handling, their tests, and one packaging entry for the new Electron helper. Do not rewrite the viewer or change its render model.

## Current data flow

```text
Import PDF
  -> cloud identity/upload setup (still blocks true offline import)
  -> viewer + local render state
       -> current annotationDocSync: actor-scoped Y.Doc + IndexedDB outbox
            -> ordered annotation_updates -> annotation_snapshots
       -> older YDocProvider/dual-write compatibility path
       -> localStorage backup on Save (limited space, not disposable cache)
  -> PDF export: app state projected into a PDF
       -> native atomic file replacement / browser download
```

The current flat-document outbox already scopes data by document and actor, waits for IndexedDB transaction completion, and commits accepted receipts with pending-entry removal in one transaction. Preserve that work. The old dual-write queue is **not** the main current save path; its fixes protect old pending work and compatibility callers.

## Implemented changes

| Area | Defect | Change |
| --- | --- | --- |
| Failed open | Storage-not-found caused a hard delete and cascades | Preserve rows and marks; show a recovery message |
| Tab identity | Name/size matched distinct cloud documents | Cloud ID wins; legacy local fallback stays compatible |
| Local backup | Quota recovery deleted other documents; Save still claimed success | Never evict authoritative backups; return actual status; keep dirty state and show failure |
| Native quit | Timeout quit after a failed local save | Failure veto with attempt IDs; stale replies cannot cancel later attempts |
| Native file writes | Direct overwrite or shared temp/backup names left a crash gap | Unique sibling temp, flush bytes, direct rename, directory flush where supported, per-path serialization |
| Metadata | Client mixing, stale cache resurrection, unbounded expired entries | Client/auth scope, request identity checks, bounded 128-entry TTL cache |
| Hook state | Overlapping mutations lost rows; old reads overwrote current state | Functional state updates; account/document/edit guards; handled refresh errors |
| Library reads | Implicit server cap and large UUID query URLs | Stable ID paging in 500-row requests, 100-ID chunks, then display sorting |
| PDF transfers | Concurrent callers downloaded the same private file separately | Account/client-scoped pending-read sharing; write/auth invalidation; no settled private-blob cache |
| Thumbnail storage | Each write loaded all cached images to count bytes; request success mistaken for commit | Small metadata index + byte counter; atomic write/eviction; v1 streaming upgrade |
| Upload work | Unbounded batch parsing/upload and leaked page-count workers | Three-job cap; task destruction in all parse paths |
| Legacy persistence | Web Lock survived document detach | Abort queued election or release held lock; await old writer teardown |
| Legacy retry | Slow drain replaced newer queue state, wrong-doc replay, missing delete dispatch | Exact-version settlement, scoped/shared handlers, serialized drains, visible storage failures |
| Current sync writer | Old handle observed new edits during close/reopen | One writer for new edits; closing handles reject public mutations; queued work and owned effect receipts finish |

Current-writer teardown is also checked with a shared-registry close/reopen regression. Do not count the older legacy queue as the source of all present-day traffic.

## Database findings

Read-only live inspection on September 7 found about 202.8 MB in `document_annotations`, 24.1 MB in `annotation_updates`, and 18.6 MB in the older `doc_yjs_state`. Table statistics are estimates, not billing totals.

The existing `(document_id, id)` index matches current annotation keyset reads. The history `(document_id, occurred_at DESC)` index also matches its reader. No duplicate full keyset index was added. A marker-only keyset index is a candidate only after a current selective query plan shows a gain. The older marker index keys page number and targets an older read shape.

`pg_stat_statements` was last reset June 3. Its slowest accumulated reads include old annotation count/read queries and older cleanup work. Those totals cannot prove a current regression or measure the savings of this batch. Keep before/after request and byte counts per user flow; do not reset shared production statistics just for this audit.

The RLS initplan/index/function hardening from PR #801 is already applied. Extra indexes, aggressive vacuum, WAL deletion, or removal of apparently unused compatibility tables would need fresh workload evidence and restore proof.

## Local-first target: next staged build

### 1. One local document identity and an explicit storage mode

Use a generated local document ID independent of filename, file size, content hash, project and cloud ID. A content hash identifies immutable bytes, not the annotation workspace: identical PDFs in two projects may have different marks. Keep a mapping to existing cloud IDs and legacy backup keys; never silently combine them.

Add a real `DocumentStore` interface with local and cloud adapters. Local imports must work without sign-in and without a cloud row. Keep local files local; publishing a cloud copy must be an explicit action. Native file handles and browser-managed bytes need separate adapters, not filesystem paths stored as if they were cloud object keys.

### 2. Durable local state before network work

Store the local manifest, bytes reference, accepted checkpoint and pending operations durably. Distinguish **saved on this device** from **synced to cloud**. Never prune pending edits or unique local documents as cache. Only derived thumbnails and re-downloadable, clean copies belong in an eviction budget.

Migrate name/size localStorage keys with a recoverable copy-and-verify process. Large local snapshots need IndexedDB/native sidecars, not synchronous localStorage. Tool preferences need a small durable pending-write queue too; their current debounce is not an offline delivery guarantee.

### 3. Explicit offline access and upload recovery

The current cloud-backed open fails closed when its initial cloud read fails. Simply removing that gate could accept stale permissions or replay rejected data. Add an explicit cached-offline state with account-scoped accepted data, a clear permission/expiry policy, retained unsent changes, and reconnect checks before publish. Test revocation and account switches before enabling it.

Uploads need durable states such as local, uploading, cloud-ready and failed/retry. A cloud row exists before some file uploads finish today. Preserve that record, but do not present it as a ready cloud file until bytes and metadata agree. Retry the exact intended path; do not auto-delete annotations as cleanup.

### 4. Consolidate compatibility writers

Move old retry work into the actor-scoped transactional outbox, with a verified migration of pending operations. The legacy localStorage queue still cannot make simultaneous read-modify-write operations from separate tabs fully atomic and keeps one side per annotation. Do not delete it until pending-work migration is proved.

The legacy YDoc registry/IndexedDB/BroadcastChannel names are document-only; they need account scoping with migration. Its follower path lacks initial offline state exchange, and unsupported Web Locks/BroadcastChannel currently disable that persistence path. These are separate from the main actor-scoped outbox.

### 5. Offline startup, lazy reads, measured budgets

Web cold-start offline needs an app-shell/service-worker plan as well as document storage. Defer legacy project-sidecar downloads from first paint only after guarding against late view-state overwrite. Library paging now preserves the whole-list contract, but very large libraries still need incremental UI loading and virtualization.

Track bytes downloaded per open, requests per library visit, local commit latency, pending-queue age, replay duplicates, retained cache bytes and first-page latency. Use these measurements to decide later schema or hosting changes.

## Verification and rollback

Baseline: 3,942 tests, 3,888 passed, 54 skipped, zero failures. Combined local suite: 4,032 tests, 3,978 passed, 54 skipped, zero failures/cancellations. The final closing-handle guard also passed its 14 focused durability/reopen tests and a fresh production build. New tests cover delayed replies, auth switches, queues, committed/aborted IndexedDB writes, upgrades, large libraries, real filesystem failures and parser cleanup. License and static release-contract gates passed. CI verifies the frozen commit separately.

Review reconciliation: an independent reviewer found that closing handles still accepted public edits after their observer stopped saving them. The final guard rejects those calls explicitly while leaving internal queued writes able to finish. A draft receipt-test fixture also had a missing local origin; that interrupted development run was replaced, not counted as a passing result.

Real local browser check: induced localStorage quota failure kept the unsaved marker and a neighbor document backup, showed the error, and succeeded after restoring storage. Real browser IndexedDB check: concurrent writes stayed within budget and survived reopening without `getAll()` image scans.

Native Electron smoke uses a fresh test-owned profile: real preload/IPC atomic writes, quota failure, native quit veto after the old five-second timeout, and successful save retry. It does not use real account credentials or write cloud test data. Run `node debug/data-architecture-electron.mjs` with Vite on port 5218.

Rollback is a code revert, not a database restore: this batch adds no live schema changes. Thumbnail v2 is disposable derived cache; older v1 code fails safely to uncached rendering if rolled back after upgrade. Local document backups and retry entries must remain untouched.

## References

- [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [IndexedDB transactions and upgrades](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
- [Yjs offline persistence and app-shell caching](https://docs.yjs.dev/getting-started/allowing-offline-editing)

Browser-local persistence and offline app startup are different requirements. Yjs persistence alone does not supply an offline app shell. Request success also must not be presented as a committed transaction.

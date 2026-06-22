# Document Save-and-Restore Architecture — Survey BetaSafeS2

_Author: architecture synthesis pass (9-agent deep audit) · Date: 2026-06-05 · Audience: Isaiah_

> This is the definitive design document for how this app saves and restores annotated PDFs. It explains exactly why embedded annotations vanish after a re-upload, why the three patches the team keeps shipping cannot fix it, and what to build instead — copied from how Google Docs and Figma actually do it, mapped onto our Supabase + Yjs + Electron stack.

---

## 1. Executive Summary

The vanish bug is **not** a sync timing glitch, a dedup gap, or a hydrate race — those are all real but secondary. The single architectural fault is that **embedded PDF annotations are treated as a transient render input, not as durable data, and the one flag that decides whether to import them (`shouldSkipEmbeddedPdfAnnotationImport = !!pdfFile?.id`, `PDFViewer.jsx:17785`) is the same flag that gates whether cloud sync can run — and the two have inverted timing requirements**, so there is no moment in the lifecycle where embedded marks are both imported *and* durably written. On first open `documentId` is null, so the importer runs but the cloud push bails silently with no journal (`useAnnotationCloudSync.js:1859`); on every subsequent open `documentId` exists, so the importer is permanently suppressed and the cloud read finds the empty rows that were never written. The three shipped patches (dedup-at-create, self-heal re-import, merge-preserve-on-hydrate) all accept this broken invariant and paper over its consequences — and dedup-at-create actively makes things *worse* by reliably stamping `file.id` on re-open, which guarantees the importer is skipped. The fix is structural: give file-derived marks a durable owner at the moment of import (a queue that drains when the document id resolves), decouple the import trigger from the cloud-sync prerequisite, and collapse the six competing stores down to one authoritative log per concern, exactly as Figma (journal + checkpoint) and Google Docs (op log + snapshot) do.

---

## 2. Current Architecture, in Detail

### 2.1 The full lifecycle

```
                                     ┌─────────────────────────────────────────────┐
                                     │  USER PICKS A PDF                            │
                                     └──────────────────┬──────────────────────────┘
                                                        │
                   Electron dialog (Dashboard.jsx:490)  │  Browser <input> (Dashboard.jsx:653)
                   ipc dialog:openFile                   │  event.target.files[0]
                   electron-main.js:685 reads bytes      │
                   → {fileName,fileSize,data:Uint8Array} │
                                                        ▼
                                     ┌─────────────────────────────────────────────┐
                                     │ classifyIncomingFile(file, supabaseDocuments)│
                                     │ incomingFileResolver.js:17                    │
                                     │  match key = name + EXACT byte size           │
                                     └───────┬───────────────────────┬───────────────┘
                                'reuse'      │              'new' / 'name-collision'
                          (name+size match)  │              (name-collision UNHANDLED,
                                             │               falls through to 'new')
                                             ▼                       ▼
                        file.id = existing.id          onDocumentSelect(file)  ← OPTIMISTIC
                        (stamped BEFORE open)           fires with file.id === undefined
                        Dashboard.jsx:534                        │
                                             │          background IIFE (fire-and-forget):
                                             │           uploadToStorage → Storage bucket
                                             │           createSupabaseDocument → documents row
                                             │           file.id mutated IN PLACE on File obj
                                             │           (may NOT re-render React)
                                             ▼                       ▼
                                     ┌─────────────────────────────────────────────┐
                                     │ AppShell.handleDocumentSelect (dedup by tab) │
                                     │ → PDFViewer mounts with pdfFile               │
                                     └──────────────────┬──────────────────────────┘
                                                        ▼
        ┌───────────────────────────────────────────────────────────────────────────────────┐
        │ PDFViewer load effect                                                               │
        │ shouldSkipEmbeddedPdfAnnotationImport = !!pdfFile?.id   (PDFViewer.jsx:17785)        │
        │                                                                                     │
        │   id ABSENT (new upload) ──► IMPORT RUNS  ─► setAnnotationsByPage (17959)            │
        │                              isPdfImported=true objects live in REACT STATE ONLY     │
        │                                                                                     │
        │   id PRESENT (reuse/reload) ─► IMPORT SKIPPED ENTIRELY (17786)                       │
        └───────────────────────────────┬─────────────────────────────────────────────────────┘
                                        ▼
        ┌───────────────────────────────────────────────────────────────────────────────────┐
        │ useAnnotationCloudSync                                                               │
        │                                                                                     │
        │  HYDRATE effect (1057): guard `if (!documentId) return` (1061)                       │
        │     id ABSENT → SKIPPED.  id PRESENT → reads stores in waterfall ↓                   │
        │        1. localStorage cloudRenderAnnotationsByPage_<pdfId>  (instant paint, cache)  │
        │        2. doc_yjs_state gzip snapshot (snapshot-prefetch)                            │
        │        3. watermark skip if documents.annotations_changed_at unchanged               │
        │        4. loadCloudWithEmptyVerify → document_annotations keyset sweep (DURABLE)     │
        │           (cutover docs: read in-memory Y.Doc first, durable read still wins)        │
        │     apply via mergePreservingImportedMarks(prev, durable)  (safeSnapshot.js:38)      │
        │                                                                                     │
        │  PUSH effect (1858): guard `if (!documentId) return` (1859) ← BEFORE lastByPageRef   │
        │     id ABSENT → BAILS, no upsert, NO journal entry, marks never serialized           │
        │     id PRESENT → 800ms debounce → buildFabricSyncDelta → upsertAnnotationsByPage     │
        │                  (250-row batches, onConflict document_id,annotation_id)             │
        │                  → fanOutCrdtForAnnotationsByPage (Y.Doc, skips imported marks)       │
        └───────────────────────────────┬─────────────────────────────────────────────────────┘
                                        ▼
        ┌───────────────────────────────────────────────────────────────────────────────────┐
        │ SELF-HEAL effect (PDFViewer.jsx:20610)                                               │
        │   fires ONLY when hydration.ready && hydration.count === 0                           │
        │   per-mount one-shot (embeddedImportFallbackDoneRef)                                 │
        │   re-reads PDF bytes → importAnnotationsFromPdf → handleSaveAnnotations              │
        │   → setAnnotationsByPage → push effect (now documentId present) → upsert             │
        │   FAILS when: count!==0 (any user mark), tab closed before 800ms debounce,           │
        │               already ran once this mount, partial prior push                       │
        └───────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Every store, and whether it is authoritative

| Store | Holds | Authoritative? | Notes |
|---|---|---|---|
| **Supabase `document_annotations`** (Postgres) | One row per annotation, `(document_id, annotation_id)` unique, full Fabric JSON in `annotation_data` | **YES — durable source of truth for reload + cross-device** | Read on every open via keyset sweep. Wins the initial-load comparison over Y.Doc. This is where imported marks *should* be but aren't. |
| **Supabase Storage `documents` bucket** | The raw PDF bytes at `user_id/projectId/Date.now().pdf` | **YES — for the PDF binary** | Time-based path, no content hash, no dedup. Two uploads of the same file = two objects. |
| **Supabase `documents`** (Postgres) | Identity row: id, name, file_path, file_size, page_count, `cutover_completed_at`, `annotations_changed_at` | **YES — for document identity + change/seal markers** | No UNIQUE on (user_id, name, file_size). Soft-delete via `archived=true`. |
| **Supabase `doc_yjs_state`** (Postgres) | Gzip snapshot `{byPage, callouts, meta}`, encoding_version=2 | **NO — cache** | Paint-first optimization. Superseded by `document_annotations` on watermark mismatch. |
| **In-memory Y.Doc** (Yjs) | Y.Map `annotations` + `callouts` | **NO — live-collab cache** | Loses to Supabase durable read on open. **Never contains imported marks** (CRDT fan-out skips them). |
| **IndexedDB `y-doc-<documentId>`** (y-indexeddb) | Serialized Y.Doc binary | **NO — local Y.Doc persistence** | Survives restart; overwritten by cloud hydrate. |
| **localStorage `cloudRenderAnnotationsByPage_<pdfId>`** | Display cache for cloud docs | **NO — display-only** | Validated by documentId + cutoverTs; rejected on mismatch. |
| **localStorage `annotationsByPage_<pdfId>`** | Legacy local cache | **NO — only for local-only PDFs / one-time migration** | **Not written for cloud docs** (`pdfFile?.id` gate, `PDFViewer.jsx:17063`). |
| **localStorage `cloudSyncQueue_<documentId>`** | Failed-upsert retry buffer | **NO — pending-writes buffer** | Per-device. Only written inside `runFabricPush`, which never fires when documentId is null. |
| **localStorage `crdt_dual_write_queue:<userId>`** | Per-annotation CRDT retry | **NO — secondary retry buffer** | Imported marks excluded at enqueue. |
| **React state `annotationsByPage`** | Live render source | **NO — ephemeral, session-only** | Where imported marks live between import and a push that never comes. |
| **`document_revisions`** | Immutable point-in-time JSONB snapshots | YES — for restore ops only | Not in the open/hydrate path. |
| **`doc_yjs_updates`** | (schema-only) | — dead weight | Created Phase 27, deny-all RLS, no client reads/writes. |
| **Physical PDF on disk** | Embedded annotation stream | YES — for its own embedded marks, read-once | App never writes annotations back into the PDF. |

**Precedence when they disagree:** `document_annotations` > `doc_yjs_state` snapshot (on watermark mismatch) > in-memory Y.Doc (when no queued local writes) > localStorage legacy cache (migration only) > embedded PDF marks (self-heal, count=0 only).

### 2.3 Your specific questions, answered explicitly

**Q: When I reopen a document, where does it fetch the annotations from?**
From Supabase `document_annotations` (the keyset sweep in `loadCloudWithEmptyVerify`), with three caches consulted first for speed: localStorage `cloudRenderAnnotationsByPage_<pdfId>` (instant paint), then the `doc_yjs_state` gzip snapshot, then a watermark short-circuit that skips the durable read if `documents.annotations_changed_at` hasn't moved. For cutover-sealed documents the in-memory Y.Doc is materialized first, but the durable `document_annotations` read still runs and wins the initial-load comparison. **The disk PDF is not consulted on a normal reopen** — only by the self-heal effect when the cloud comes back with zero rows.

**Q: If I delete my local copy of the PDF, what happens?**
The PDF bytes still live in Supabase Storage, so reopening downloads the blob and reconstructs a `File`. Annotations come from `document_annotations` regardless of the local file — **if** they were ever pushed there. The localStorage caches are device-local; clearing them just means a slower first paint (state starts `{}` until the durable read lands), not data loss. The danger case is identical to the main bug: if the marks were never written to `document_annotations` (the null-documentId window), deleting the local copy removes your last copy and the self-heal can no longer re-read the disk file (it'll fetch the Storage blob, which is the *original* PDF — fine for embedded marks, but anything you drew is gone).

**Q: What does autosave target?**
The 30-second autosave timer (`PDFViewer.jsx:17416`) is **gated on `pdfFilePath` being non-null** — i.e. it only fires for Electron documents that have a local disk path. It calls `handleSaveDocument(true)`, which writes localStorage then `cloudSyncForceFlush()`. **Cloud documents opened without a local file path are not covered by the interval at all** — they rely entirely on the 800ms debounced push that fires on each `annotationsByPage` change.

**Q: What does Cmd/Ctrl+S target?**
`handleSaveDocument` (`PDFViewer.jsx:17318`): (1) writes localStorage unconditionally via `saveAnnotationsByPage`, (2) clears `hasUnsavedAnnotations`, (3) if cloud sync is on, saves survey data to Storage then calls `cloudSyncForceFlush()` (`useAnnotationCloudSync.js:3427`), which **bypasses the 800ms debounce** and does an immediate, **full-document** `upsertAnnotationsByPage(lastByPageRef.current)` (not a delta). On a large document this full-state write is the "Failed to fetch" push you've seen.

**Q: If I upload a file with the same name (different content), what happens?**
`classifyIncomingFile` returns `kind: 'name-collision'` (`incomingFileResolver.js:38`) — but **Dashboard never handles that kind**. Both the Electron path (`:531`) and browser path (`:684`) only branch on `kind === 'reuse'`; everything else falls through to a fresh upload. So a same-name/different-content file **creates a brand-new second cloud document every time**. There is no UI to reconcile, version, or replace.

**Q: How does the app recognize an exact duplicate? How does the database?**
The **app** recognizes it client-side only, by comparing `file.name` + `Number(file.size)` (exact byte count) against the in-memory `supabaseDocuments` array — which is scoped to the *currently selected project* (`useDocuments(selectedProjectId)`), and may be stale or empty during a cold boot. There is **no content hash** — two different PDFs of identical name and byte length collide. The **database does not recognize duplicates at all**: `createSupabaseDocument` does a plain `INSERT` with no `ON CONFLICT`, and there is **no UNIQUE constraint** on `(user_id, name)` or `(user_id, name, file_size)` in any migration. Every insert that the client doesn't catch creates a new row with a new UUID. Soft-deleted (`archived`) documents are filtered out of the lookup, so re-uploading an archived file always reads as new.

---

## 3. The Root Cause of Vanishing Annotations

### 3.1 The single fault

> **Embedded PDF annotations are file-derived data that the architecture treats as a transient render input. The flag `shouldSkipEmbeddedPdfAnnotationImport = !!pdfFile?.id` (`PDFViewer.jsx:17785`) is simultaneously the import trigger and the cloud-sync prerequisite — but the two have inverted timing. The importer must run when `documentId` is ABSENT; persistence (hydrate + push) can only run when `documentId` is PRESENT. There is no lifecycle state in which embedded marks are both imported and durably written.**

Imported marks therefore have **no owning store**. They exist only in ephemeral React state, in the gap between import and a cloud push that the timing *guarantees* will never fire for them.

### 3.2 The failure chain, step by step

**First open (new upload carrying embedded annotations):**

1. `classifyIncomingFile` → `{kind:'new'}`. `onDocumentSelect(file)` fires **optimistically** with `file.id === undefined` (`Dashboard.jsx:557`). Upload + row-create run fire-and-forget in the background.
2. PDFViewer mounts; `documentId` is null. Import gate is **false** → importer runs → `setAnnotationsByPage` (`PDFViewer.jsx:17959`). Marks are on screen, **React state only**.
3. Push effect fires but bails at `if (!documentId) return` (`useAnnotationCloudSync.js:1859`) — **before** `lastByPageRef.current = annotationsByPage` (`:1890`). Nothing is serialized, nothing is upserted, nothing is enqueued to any retry queue (those live inside `runFabricPush`, which never runs). **There is no write to any durable store.**
4. The background upload later mutates `file.id` in place. This may not re-render React, and even if it does, the imported objects predate `documentId`, so they were never captured as a delta baseline. Marks remain visible but ephemeral.

**Reload, then re-upload the same file:**

5. `classifyIncomingFile` now matches by name+size → `{kind:'reuse'}`. `file.id` is stamped **before** `onDocumentSelect` (`Dashboard.jsx:534`).
6. PDFViewer mounts with `documentId` present. Import gate is **true** → **importer skipped entirely**. React state stays `{}` for imported marks.
7. Hydrate reads `document_annotations` → **empty** (step 3 never wrote). `mergePreservingImportedMarks(prev, durable)` is a no-op pass-through because `prev` is empty (import was skipped). `markInitialHydration({count: 0})`. **Marks are gone on screen.**
8. Self-heal *can* fire here (count === 0) and recover — but only if it hasn't already run this mount, only if no user mark made count !== 0, and only if the 800ms debounce flushes before the tab closes. Partial-failure loss is silent and unrecoverable.

### 3.3 Why the three patches don't fix it

All three accept the broken invariant and treat the symptom.

- **Dedup-at-create (`classifyIncomingFile`)** only changes *which document row gets opened*. It cannot create annotation rows that were never written. **It actively makes the bug worse**: by reliably stamping `file.id` on re-open, it guarantees the import gate skips the importer — converting first-open "visible but ephemeral" into reload "gone." Its own holes (stale project-scoped `supabaseDocuments`, archived invisibility, unhandled name-collision, no content hash) are secondary; even a perfect dedup leaves the cloud row empty.

- **Self-heal re-import (`PDFViewer.jsx:20610`)** is a recovery hack gated on `count === 0`, per-mount one-shot, that re-derives data the system already had and threw away, then routes through the same debounce that can be lost on tab close. It **cannot fire when `count !== 0`** (any user mark, or a partial prior push), so partial loss is silent. It depends on the exact race window it's meant to fix.

- **Merge-preserve-on-hydrate (`mergePreservingImportedMarks`, `safeSnapshot.js:38`)** only preserves `isPdfImported` objects **already in in-memory `prev`**. On a cold reload `prev` is empty (import skipped, no localStorage for cloud docs), so the merge is a transparent pass-through of the empty cloud set. It defends against the cloud overwriting *in-session* imported marks; it can never reconstruct marks absent from both cloud and `prev`.

None of the three establishes a durable owner for embedded annotations at the moment of import.

### 3.4 Resolving conflicts between the lane findings

- **Does the cutover/Supabase-durable path rescue imported marks?** Lane 2 ("Save semantics") says it *should* — the durable `document_annotations` read wins and includes imported rows. Lane 4 ("Embedded import") and the root-cause trace say it *doesn't* on the vanish path. **Resolution: both are right about different preconditions.** The durable read rescues imported marks **only if they were ever written to `document_annotations`**. On the vanish path they never were (step 3), so there is nothing for the durable read to return. The cutover path is a red herring for *this* bug; it matters only once the rows exist.
- **Does self-heal sometimes save the day?** Lane 4 notes it can fire on genuinely-empty clouds. The root-cause analysis agrees but rates it irrelevant to the fault: it's a symptom patch over the same missing-durable-owner fault, and its success is race-dependent. **Resolution: self-heal is a coin-flip mitigation, not a fix.**

---

## 4. How Google Docs and Figma Do It

Both products converge on the same shape: **a server-authoritative log of small deltas + a periodic compacted snapshot, with binary assets content-addressed and stored out-of-band.** The differences (OT vs LWW vs CRDT) are conflict-resolution details; the *persistence* shape is identical and is what we should copy.

| Concern | Google Docs | Figma | Maps to our stack |
|---|---|---|---|
| **Authority** | One Collaboration Service (Sequencer) per doc | One Rust process per doc | One logical writer per `document_id`: a Postgres `SEQUENCE` + a single Hocuspocus/y-websocket room (or Supabase Realtime channel) |
| **Durable WAL** | Append-only Operation Log; **op written before broadcast** | DynamoDB journal flushed every ~0.5s | Append-only `annotation_updates(document_id, seq BIGSERIAL, client_id, client_seq, data BYTEA)` — **insert before broadcast** |
| **Snapshot** | Snapshot Writer compacts log → blob in object storage | Kiwi binary checkpoint to S3 every 30–60s | `annotation_snapshots(document_id, at_seq, snapshot BYTEA)` via `Y.encodeStateAsUpdate`, written by a compaction job |
| **Load** | latest snapshot + tail ops since its revision | S3 checkpoint + replay journal | `applyUpdate(snapshot)` then apply `annotation_updates WHERE seq > at_seq` |
| **Binary assets** | image stored in GCS, doc holds a reference | SHA-hashed blob in S3, node holds `imageHash` | PDF + image annotations in Supabase Storage, **content-addressed by SHA-256**, doc holds only the hash/path |
| **Offline** | IndexedDB op buffer, replay on reconnect | IndexedDB delta per node, fetch fresh checkpoint then replay local | y-indexeddb buffer; on reconnect fetch server snapshot, replay local updates, wipe buffer |
| **Dedup on reconnect** | Redis dedup on (client_id, seq) | sequence-tagged journal | UNIQUE `(document_id, client_id, client_seq)` — re-sent ops silently no-op |
| **Conflict** | OT (server total order) | property-level LWW | Yjs CRDT (per-op clientID+clock; no central transform needed) |

**The copyable rules, ranked by relevance to our bug:**

1. **Persist at the moment of mutation, before anything else.** Google Docs writes the op to the log *before* broadcasting; Figma flushes to the journal every half-second. Our importer must write embedded marks to a durable log the instant they're parsed — never leave them in React state waiting for a `documentId`.
2. **Model annotations as an append-only log of deltas, not a mutable "latest state" row.** This is the difference between "lost-update race" and "can't lose data." Yjs gives us this for free if we stop fighting it with a parallel bulk-row table.
3. **Snapshot to make open fast; never replay the whole log on open.** `doc_yjs_state` already half-implements this — finish it.
4. **Binary out-of-band, content-addressed.** Our time-based Storage path (`Date.now().pdf`) is the anti-pattern; a SHA-256 path is the dedup primitive both products rely on.
5. **One writer per document.** We currently have no sequencer at all — two tabs/devices last-write-wins blindly on `(document_id, annotation_id)`.

---

## 5. Target Architecture

A single authoritative store per concern, with embedded import promoted to a first-class durable producer.

### 5.1 The stores (one authority each)

| Concern | Authoritative store | Caches (derived, disposable) |
|---|---|---|
| Document identity | `documents` row, with `content_sha256` column + UNIQUE `(user_id, content_sha256)` | — |
| PDF bytes | Supabase Storage at `user_id/<sha256>.pdf` (content-addressed, immutable) | local disk path (display only), IndexedDB pdf-cache (render bitmaps) |
| **All annotations (user + imported)** | **Yjs Y.Doc, persisted as an append-only `annotation_updates` log + periodic `annotation_snapshots`** | in-memory Y.Doc, y-indexeddb, `cloudRenderAnnotationsByPage` (paint cache) |
| Live presence/cursors | ephemeral Realtime channel (no persistence) | — |
| History/revisions | `document_revisions` (immutable JSONB) | — |

**Yjs becomes the single source of truth for annotation state.** `document_annotations` (the flat per-row table) is **demoted to a read-only projection** derived from the Y.Doc by a server-side observer — used for search/reporting/RLS, never as an input to the merge. This eliminates the two-sources-that-diverge problem the lanes documented repeatedly.

### 5.2 Document identity & dedup (kills the duplicate-doc class of bugs)

1. On file pick, compute `content_sha256` of the bytes (cheap, in a worker).
2. Storage path becomes `user_id/<sha256>.pdf` — uploading the same bytes twice writes the same object (idempotent).
3. `documents` gets a `content_sha256 TEXT` column and a UNIQUE constraint `(user_id, content_sha256)`. `createSupabaseDocument` upserts with `ON CONFLICT (user_id, content_sha256) DO UPDATE ... RETURNING id`. **The database, not the client, is now the dedup authority.**
4. `classifyIncomingFile` keeps its client-side fast path but matches on `content_sha256`, queries **all** the user's documents (not project-scoped), and **includes archived** rows (un-archive on reuse). Same-name/different-content → genuinely new (different sha). Same-content/different-name → reuse + offer rename. **The `name-collision` kind gets a real handler.**

### 5.3 The write path

```
mutation (draw / erase / edit / EMBEDDED IMPORT)
   → applyToYDoc(ydoc, op)                      // local, immediate, optimistic
   → ydoc 'update' event → Uint8Array delta
   → INSERT annotation_updates(document_id, seq, client_id, client_seq, data)  // DURABLE, before broadcast
        (UNIQUE (document_id, client_id, client_seq) dedupes reconnect re-sends)
   → Realtime broadcast to other clients
   → (offline) y-indexeddb buffers the same delta; drains on reconnect
```

Key change: **embedded import is just another mutation.** `importAnnotationsFromPdf` writes its objects into the Y.Doc, which produces an `annotation_updates` row immediately — **no dependency on `documentId` timing**, because the document identity is resolved synchronously (sha-based upsert returns the id *before* the viewer opens, or the update is buffered locally and flushed the instant the id resolves). Autosave and Cmd+S become redundant for durability (every op is already persisted); Cmd+S downgrades to "force-flush the offline buffer + create a named revision."

### 5.4 The read / hydrate path

```
open(document_id):
   1. applyUpdate(ydoc, latest annotation_snapshots.snapshot)          // fast baseline
   2. apply annotation_updates WHERE seq > snapshot.at_seq IN ORDER     // tail
   3. paint from ydoc → React state
   4. subscribe Realtime for live ops
```

One waterfall, no `mergePreservingImportedMarks`, no `resolveSafeSnapshot`, no watermark-skip, no self-heal — those all exist to compensate for the missing single source of truth and **delete entirely**. There is no "empty cloud + non-empty PDF" branch because imported marks were persisted as ops at import time and are in the log like everything else.

### 5.5 Embedded import — exactly once, never lost

- Tag each imported object with a deterministic id: `import:<content_sha256>:<pdf_object_ref>`. Deterministic across re-parses (fixes the annotation_id-instability finding).
- On first open of a never-imported document, run the importer **once**, gated by a durable per-document marker (`documents.embedded_import_completed_at`), **not** a per-mount React ref. Set it in the same transaction that writes the import ops.
- Because ids are deterministic and the marker is durable, re-import is idempotent and self-suppressing: re-running produces ops with ids that already exist in the Y.Doc → Yjs merges them as no-ops. **No skip-gate flag, no count===0 self-heal, no inverted timing.**

### 5.6 Same-name / duplicate uploads

| Scenario | Behavior |
|---|---|
| Identical bytes (same sha) | DB `ON CONFLICT` returns existing id; reuse; un-archive if needed. One document, one Storage object. |
| Same name, different content | Different sha → new document. UI surfaces "you have a file named X with different contents — open existing / create new version." |
| Same content, different name | Same sha → reuse; offer to add the new name as an alias. |

### 5.7 Offline + reconnect

- y-indexeddb persists every op locally; the app is fully usable offline including import.
- On reconnect: fetch the server snapshot, `Y.applyUpdate` it, then replay buffered local updates (Yjs merge is commutative — order-independent), then wipe the local buffer in one transaction (Figma's exact fix for the short-circuit bug).
- `(document_id, client_id, client_seq)` UNIQUE means a re-sent op that already committed is silently deduped — at-least-once delivery becomes effectively-once.

---

## 6. Migration Path (ordered, lowest-risk first)

Each step is independently shippable and testable. **Highest-risk files — `PDFViewer.jsx`, `useAnnotationCloudSync.js`, `Dashboard.jsx` — are touched late and minimally.** Run `npx vite build` + `node scripts/run-node-tests.mjs` after every step.

1. **Content-addressed storage + DB dedup (no viewer changes).**
   Add `content_sha256` to `documents` + UNIQUE `(user_id, content_sha256)` (new migration). Compute sha in `Dashboard.jsx` upload path; switch Storage path to `user_id/<sha>.pdf`; upsert with `ON CONFLICT`. Backfill sha for existing rows via a one-off script. **Risk: low. Files: `Dashboard.jsx` (upload IIFE only), `useDatabase.js`, new migration.** This alone kills the duplicate-document class.

2. **Fix `classifyIncomingFile` scope + name-collision handling.**
   Query all documents (not project-scoped), include archived, match on sha, add a real `name-collision` UI branch. **Risk: low. Files: `incomingFileResolver.js`, `Dashboard.jsx`.**

3. **Resolve `documentId` before optimistic open.**
   Make the sha-upsert `await`ed so `file.id` is set *before* `onDocumentSelect`. This closes the null-documentId window for the common case without touching the viewer. **Risk: medium (changes open latency by one round-trip — acceptable; show a spinner). Files: `Dashboard.jsx`.**

4. **Durable import queue (the actual root-cause fix, viewer-local).**
   Make the importer write to a durable per-document op buffer (start with a localStorage/IndexedDB journal keyed by sha, independent of `documentId`) that `useAnnotationCloudSync` drains the instant `documentId` resolves. Add the durable `embedded_import_completed_at` marker. **Now embedded marks survive even if the tab closes mid-upload.** **Risk: medium-high. Files: `PDFViewer.jsx` (import effect), `useAnnotationCloudSync.js` (push gate: replace silent `if (!documentId) return` with enqueue-for-later).**

5. **Append-only `annotation_updates` + `annotation_snapshots` tables; Yjs as source of truth.**
   Stand up the WAL + snapshot schema. Route Yjs `update` events to `annotation_updates` (insert-before-broadcast). Demote `document_annotations` to a derived projection written by a server-side observer. Switch the hydrate path to snapshot+tail. **Risk: high — this is the architectural pivot. Files: `useAnnotationCloudSync.js`, `annotationCloudSync.js`, `snapshotStore.js`, new migrations, server observer.** Ship behind a feature flag, dual-write during cutover.

6. **Delete the patches.**
   Once 4–5 are live and verified, remove `mergePreservingImportedMarks`, `resolveSafeSnapshot`'s cloud-backed guard, the watermark-skip, and the self-heal effect. Each deletion gated on regression tests proving reopen/re-upload survives. **Risk: medium (deletion is safe only after the replacement is proven). Files: `safeSnapshot.js`, `PDFViewer.jsx:20610`, `useAnnotationCloudSync.js`.**

7. **One writer per document + reconnect dedup.**
   Add the `(document_id, client_id, client_seq)` UNIQUE and a single-room/advisory-lock writer. **Risk: medium. Files: migration, sync service.**

**Guardrail:** every step that touches `PDFViewer.jsx`, `useAnnotationCloudSync.js`, or `PageAnnotationLayer.jsx` must honor the standing CLAUDE.md invariants (container-aware canvas sizing, single-name fontFamily, `zoomGeneration` signal, no JS zoom coordination in `SVGAnnotationLayer.jsx`) and run `npm test` with baseline reported before "done."

---

## 7. Open Questions / Decisions for You

1. **Yjs as the single source of truth — commit or hedge?** The target demotes `document_annotations` to a derived projection. This is the clean fix but it's the biggest pivot. Alternative: keep `document_annotations` authoritative and just bolt on the durable import queue (steps 1–4). That fixes *this* bug with far less risk but leaves the two-sources-diverge fragility. **Which risk tolerance?**

2. **Where does the server-side Yjs observer run?** Supabase Edge Function on a trigger, a small always-on Node service (Hocuspocus `onStoreDocument`), or the Electron main process for single-user docs? This determines whether you need any new infra.

3. **`await` the document-row create before open (step 3)** adds one network round-trip to the open path. Acceptable with a spinner, or do you want to keep optimistic open and rely solely on the durable import queue (step 4) to cover the window?

4. **Content-hash dedup semantics:** if a user uploads identical bytes under a new name into a different project, is that one document (shared annotations) or two (annotations are project-scoped)? This decides whether the UNIQUE is `(user_id, content_sha256)` or `(user_id, project_id, content_sha256)`. The lanes flagged the project-scoping mismatch as a live source of duplicates — your call on the intended product behavior.

5. **Cutover-sealed documents:** do you want to keep the `cutover_completed_at` Y.Doc-authoritative path, or does the target architecture (Yjs always authoritative) make sealing obsolete? If Yjs is always the source of truth, the cutover flag and its whole branch can be deleted.

6. **`doc_yjs_updates` (dead Phase-27 table):** drop it, or is it the intended home for the `annotation_updates` WAL in step 5 (in which case revive it instead of creating a new table)?

7. **Same-content/different-name aliasing (5.6):** is "one document, multiple names" a feature you want, or should different names always mean different documents even with identical bytes?

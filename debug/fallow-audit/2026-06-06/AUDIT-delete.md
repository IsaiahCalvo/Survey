# Delete-Document Audit — 2026-06-06

**Question:** When a user deletes a document, is all of its data actually removed, or is data
left behind (orphaned) in DB and/or local storage?

---

## 1. Intended Behaviour

Deleting a document should remove:

- The `documents` row
- The PDF bytes in Supabase Storage
- Every annotation record associated with that document
- Every sync/CRDT record (op log, snapshot) associated with that document
- Every collab/social record (collaborators, invites, presence, revisions, history)
- Local durable copies (IndexedDB, localStorage) so a same-SHA re-upload cannot
  resurrect old marks

---

## 2. Delete Entry Points

### 2a. Primary user-delete path (`deleteDocumentEverywhere`)

Defined in `src/Dashboard.jsx:1396`.

Called from four places:
- `handleDeleteDocument` (single-file trash button, line 2097)
- `handleBulkDelete → ctx='documents'` (line 1493)
- `handleBulkDelete → ctx='projectFiles'` (line 1528)
- `hubDeleteDocuments` (Survey Hub view, line 3724)

Sequence (post-commit 191a70a4):

1. SELECT the row to resolve `file_path` if the caller didn't pass it.
2. **Hard-delete** `documents` row: `supabase.from('documents').delete().eq('id', docId)`.
3. `deleteFromStorage(storagePath)` — removes the PDF bytes from the `documents`
   storage bucket (best-effort, errors are swallowed).
4. `purgeAnnotationDoc(docId)` — clears the in-memory `annoflat:{docId}` Y.Doc and
   calls `indexedDB.deleteDatabase('anno-{documentId}')`.
5. Verify the row is gone (`maybeSingle` should return `null`).

### 2b. Stale-file cleanup path (`handleFileNotFound`)

Defined in `src/Dashboard.jsx:1925`. Fires when a user tries to **open** a document
whose PDF bytes are 404 in storage. This is NOT a user-triggered delete.

This path calls `deleteSupabaseDocument` (= `useDatabase.deleteDocument`), which is
the **old soft-delete** that sets `archived = true, updated_at = now()`. It does NOT
hard-delete the row. This means the documents row persists with `archived=true` and
all child rows are NOT cascaded. The annotation log, snapshot, etc. remain.

---

## 3. Database Cascade Table

Below is the complete inventory of all tables that carry a `document_id` FK pointing
at `documents(id)`, and whether they cascade or survive on hard-delete.

| Table | FK behaviour | Cleared by hard-delete? |
|-------|-------------|------------------------|
| `document_annotations` | `ON DELETE CASCADE` | YES |
| `document_collaborators` | `ON DELETE CASCADE` | YES |
| `document_presence` | `ON DELETE CASCADE` | YES |
| `document_invites` | `ON DELETE CASCADE` | YES |
| `document_revisions` | `ON DELETE CASCADE` | YES |
| `document_history_events` | `ON DELETE CASCADE` | YES |
| `doc_yjs_updates` (Phase 27) | `ON DELETE CASCADE` | YES |
| `doc_yjs_state` (Phase 27) | `ON DELETE CASCADE` (PK) | YES |
| `activity_log` (Phase 27) | `ON DELETE CASCADE` | YES |
| `annotation_updates` (Phase 36) | `ON DELETE CASCADE` | YES |
| `annotation_snapshots` (Phase 36) | `ON DELETE CASCADE` (PK) | YES |
| `survey_sessions` | **`ON DELETE SET NULL`** | **NO — row survives, document_id becomes NULL** |

The `survey_sessions.document_id` FK is explicitly `ON DELETE SET NULL`
(migration `20241230000001_create_survey_realtime_tables.sql:12`). This means every
`survey_sessions` row linked to the deleted document is **not removed**; its
`document_id` column becomes NULL. All the tables that cascade from `survey_sessions`
(survey_items, excel_schema_mapping, survey_presence, survey_sync_log) therefore also
**survive**, still belonging to the orphaned session.

---

## 4. Local Storage / IndexedDB Inventory

| Store | Key pattern | Cleared on user-delete? |
|-------|-------------|------------------------|
| IndexedDB `anno-{documentId}` | `y-indexeddb` for `annotationDocSync` | YES — `purgeAnnotationDoc` calls `indexedDB.deleteDatabase('anno-{documentId}')` |
| IndexedDB `{documentId}` (raw UUID) | `y-indexeddb` for `ydocLifecycle` (Phase 27 CRDT layer, currently **enabled by default**) | **NO** — `purgeAnnotationDoc` only deletes `anno-{documentId}`, not the raw-UUID DB |
| localStorage `cloudSyncQueue_{documentId}` | pending offline annotation upserts | **NO** — never cleared on delete |
| localStorage `cloudSyncMigration_{userId}_{documentId}` | Phase 21 one-shot migration marker | **NO** — only removed during migration retry path |
| localStorage `annotationsByPage_{pdfId}` | Legacy annotation cache (key = `{filename}-{size}`, not documentId) | Not applicable — different key shape; no delete-time cleanup |
| localStorage `pdfData_{pdfId}`, `surveyMarkers_{pdfId}`, `callouts_{pdfId}`, `cloudRenderAnnotationsByPage_{pdfId}` | Viewer caches (keyed by filename+size) | Not applicable — different key shape; no delete-time cleanup |

---

## 5. What the Recent Commit 191a70a4 Changed

`feat(persistence): delete now actually removes a document's marks` (2026-06-06):

**Before:** `deleteDocumentEverywhere` did a soft-delete — `UPDATE documents SET
archived=true`. The documents row remained. Because it wasn't removed, no FK cascade
fired. Every annotation row, op-log row, snapshot, collaborator row, etc. was
permanently orphaned.

**After:** `deleteDocumentEverywhere` now issues a hard `DELETE FROM documents`. All
child tables with `ON DELETE CASCADE` are cleaned up automatically by Postgres. Storage
bytes are then removed and the local `anno-{documentId}` IndexedDB is purged.

The commit is **substantially correct** but leaves three gaps (see below).

---

## 6. Identified Gaps

### Gap 1 — `handleFileNotFound` still soft-deletes (stale-file cleanup)

`src/Dashboard.jsx:1937` calls `deleteSupabaseDocument` (the `useDatabase.deleteDocument`
hook, line 321–334 of `useDatabase.js`) which does `UPDATE documents SET archived=true`.
This is the pre-191a70a4 soft-delete. When a file-not-found auto-cleanup fires:

- The documents row is NOT removed (archived=true, not deleted).
- No cascade fires.
- All annotation rows, op-log, snapshots, collaborator rows, etc. remain indefinitely.
- The storage bytes were already missing (that's what triggered this path).

Impact: **Every** document whose PDF was deleted externally (e.g. direct storage
delete, quota purge) gets a permanently orphaned documents row plus all its annotation
data. The user sees the file disappear from the Dashboard, but the DB retains
everything. If the same PDF is re-uploaded it gets a new `documents` row (different
`content_sha256`) so it won't deduplicate, but the orphaned rows remain.

Fix: Call `deleteDocumentEverywhere({ docId, source: 'file-not-found-cleanup' })`
instead of `deleteSupabaseDocument(docId)`. Storage removal is already a no-op when
the file is gone; the cascade handles the rest.

### Gap 2 — `ydocLifecycle` IndexedDB not purged (raw UUID key)

`src/lib/collab/ydocLifecycle.js:124` creates an IndexedDB with key `documentId`
(the raw UUID). `purgeAnnotationDoc` only deletes `anno-{documentId}`. The
`ydocLifecycle`-managed database (used by the Phase 27/28/29 CRDT collab layer, enabled
by default via `isCRDTEnabled()`) is never deleted.

Impact: After a delete, the CRDT Y.Doc's local IndexedDB snapshot (`{uuid}` named
database) persists on disk. If the same document UUID were somehow re-used (it won't
be — UUIDs are random), the old snapshot could contaminate it. More practically, it
wastes IndexedDB quota accumulating over time.

Fix: Add `indexedDB.deleteDatabase(documentId)` to `purgeAnnotationDoc`.

### Gap 3 — `cloudSyncQueue_{documentId}` localStorage never cleared on delete

`src/services/cloudSyncQueue.js` persists pending unanswered sync ops to
`localStorage` under key `cloudSyncQueue_{documentId}`. This queue is cleared when it
drains (all ops succeed) but is never explicitly removed at delete time. If the
document is deleted while offline or while sync retries are pending, the queue entry
stays in localStorage forever.

Impact: Low severity — stale unanswered ops in localStorage, never processed again
(the document row no longer exists so any retry would 404), but never cleaned up.
Each entry is a small JSON array so storage impact is minimal but not zero.

Fix: Add `localStorage.removeItem('cloudSyncQueue_' + documentId)` to
`purgeAnnotationDoc` (or to `deleteDocumentEverywhere` inline).

### Gap 4 (informational) — `survey_sessions` intentionally survives, but the comment should be documented

`survey_sessions.document_id` becomes NULL. The session row and all its child rows
(survey_items, excel_schema_mapping, survey_presence, survey_sync_log) remain. This
may be intentional — a survey session may outlive the original PDF (e.g. the Excel
file is still live). It is NOT a clean-up gap in the annotation/mark sense, but if the
intent is that deleting a document should also close/end any linked sessions, nothing
currently does that.

---

## 7. Summary

| Complaint | Confirmed? | Detail |
|-----------|-----------|--------|
| Deleting left annotations behind | **Was true, now fixed** by commit 191a70a4 for user-initiated deletes | Hard delete + CASCADE clears all annotation rows |
| Storage PDF not removed | **Was true, now fixed** by same commit | `deleteFromStorage` called post-delete |
| Local annotation doc not purged | **Partially fixed** | `anno-{uuid}` IDB purged; raw-UUID IDB (ydocLifecycle) still not |
| `cloudSyncQueue` not cleared | **Gap remains** | localStorage key never removed on delete |
| `handleFileNotFound` still soft-deletes | **Gap remains** | Stale-file cleanup still uses `archived=true`, not hard-delete |
| `survey_sessions` orphaned | Intentional SET NULL, but discuss | Sessions and their children (items, schema, presence, log) survive |

---

## 8. Minimal Correct Fix

Three one-line changes, lowest risk:

1. **`src/Dashboard.jsx:1937`** — replace `deleteSupabaseDocument(docId)` with
   `deleteDocumentEverywhere({ docId, source: 'file-not-found-cleanup' })` and
   `await` it. Remove the `cleaningUpDocumentsRef` dance if desired (it's now
   handled by `deleteDocumentEverywhere`'s verify step).

2. **`src/services/annotationDocSync.js` inside `purgeAnnotationDoc`** — add one line:
   ```js
   if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase(documentId);
   ```
   (In addition to the existing `anno-${documentId}` delete.)

3. **Same `purgeAnnotationDoc` function** — add one line:
   ```js
   if (typeof localStorage !== 'undefined') localStorage.removeItem(`cloudSyncQueue_${documentId}`);
   ```

## 9. Architectural Note

The stale-comment at `src/Dashboard.jsx:1477–1478` ("The database operation below archives
the row so old cutover/Y.Doc annotation blobs are not synchronously hard-deleted.") is now
false — the code calls `deleteDocumentEverywhere` which hard-deletes. The comment should
be updated to reflect the new intent.

Similarly `src/Dashboard.jsx:3711` ("Delete the given documents everywhere (archives row +
storage file)") should read "hard-deletes row + cascades child tables + removes storage file".

---

_Generated by audit agent — 2026-06-06_

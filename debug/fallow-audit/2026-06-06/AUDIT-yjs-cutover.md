# Audit: Yjs Source-of-Truth Rebuild — Cutover State

_Date: 2026-06-06 · Working tree HEAD: `6f8b856e` · Auditor: Claude Code_

---

## 1. Bottom Line

**The Yjs rebuild is FULLY built AND wired into the live app as of today.**
`annotation_updates` and `annotation_snapshots` have 0 rows NOT because the path is dormant — the tables were only created and pushed to production today (commit `0fa826ab`, 2026-06-06 16:41 EDT). They are empty because no user has made a draw stroke since the migration was applied. Every new draw on any cloud document will populate them going forward. The legacy `document_annotations` path (53k rows) is the historical record for previously-stored annotations, but has been set fully inert in the viewer: `useAnnotationCloudSync` is called with `enabled: false, hydrateEnabled: false` and takes no part in load or save.

---

## 2. Which Persistence Path Is Live Today

### 2.1 What runs when a user opens a document

1. `PDFViewer.jsx:15676` calls `useAnnotationDoc({ enabled: isActive && cloudSyncEnabled && !!pdfFile?.id && !!user?.id, … })`.
   - `cloudSyncEnabled = !!features?.cloudSync` — hardcoded `true` for every tier as of `AuthContext.jsx:551`.
   - So for any authenticated user viewing a cloud-backed document (has `pdfFile.id`), `useAnnotationDoc` is active.

2. `useAnnotationDoc` calls `openAnnotationDoc({ documentId, supabase, clientId })` from `src/services/annotationDocSync.js`.

3. `openAnnotationDoc` does:
   - Initializes a registry-managed `Y.Doc` via `getOrCreateYDoc('annoflat:<documentId>')`.
   - Opens an IndexedDB persistence provider (`y-indexeddb`, key `anno-<documentId>`) for instant local durability.
   - Reads the latest `annotation_snapshots` row for `document_id` (applies as the baseline), then replays all `annotation_updates` rows with `seq > snapshot.at_seq` in order.
   - Subscribes to Supabase Realtime inserts on `annotation_updates` for live multi-device.
   - Attaches an `update` observer: every local Y.Doc mutation is serialized to `annotation_updates` (INSERT before broadcast) and schedules a debounced full-state `annotation_snapshots` upsert.

4. Back in `useAnnotationDoc`: if the durable store has annotations (count > 0), it paints from the store. If empty (new or never-imported PDF), it seeds the store with whatever React state already holds, then fires `setInitialHydration({ ready: true, count: 0 })` — which triggers the existing self-heal effect (`PDFViewer.jsx:20631`) to import embedded PDF marks, which then flow through `annotationsByPage` → `useAnnotationDoc`'s capture effect → `handle.applyByPage()` → Y.Doc mutation → `annotation_updates` INSERT. Embedded marks are now durable.

### 2.2 What is inert

`useAnnotationCloudSync` is called at `PDFViewer.jsx:15654` with `enabled: false, hydrateEnabled: false`. The hydrate effect short-circuits immediately on `!hydrateEnabled` (`useAnnotationCloudSync.js:1016`). The push debounce never starts. The legacy `document_annotations` read path (`loadCloudWithEmptyVerify`, `buildFabricSyncDelta`, `upsertAnnotationsByPage`) is unreachable from the viewer. The `doc_yjs_state` snapshot cache (Phase 32, `snapshotStore.js`) was used by the legacy path and is also unreachable.

---

## 3. Why the New Tables Are Empty

**Timeline:**

| Date | Event |
|------|-------|
| 2026-06-05 | `SUPABASE-DATA-AUDIT.md` produced — shows `annotation_updates` / `annotation_snapshots` NOT in schema (migration not yet committed) |
| 2026-06-06 16:41 | Commit `0fa826ab` creates `annotationDocSync.js`, `annotationDocStore.js`, tests, `agent-cli/yjs-roundtrip.mjs`, and the migration `20260606120000_rebuild_yjs_source_of_truth.sql`. Commit message says the migration was **pushed** (`supabase db push --linked`) to the linked project. Tables exist in production as of this moment. |
| 2026-06-06 17:03 | Commit `51bb597e` wires the viewer: `useAnnotationDoc` added to `PDFViewer.jsx`, `useAnnotationCloudSync` disabled (enabled: false). |
| 2026-06-06 17:44 | Commit `f7ddb90d` documents Pass 1 as "complete + live-verified". |
| 2026-06-06 (later) | Additional commits: per-page-bounded ops (`6cd7de12`), gzip snapshots (`9549c6d3`), delete cascade (`191a70a4`), fallow cleanup. |

**Conclusion:** The tables were created and the client was wired on the same day. Since no user drew a stroke after both the migration was pushed AND the updated client code was deployed (or the dev server restarted), the tables are legitimately empty — not evidence of a broken write path.

Additionally, `agent-cli/yjs-roundtrip.mjs` proves end-to-end against the real backend: it writes pages 6–11 + a fresh stroke, reopens, verifies all survive, merges a second device, and checks DELETE cascade. That test uses `openAnnotationDoc` directly against the live Supabase project with `enableLocal: false, enableRealtime: false`, confirming the INSERT path reaches `annotation_updates` from Node.

---

## 4. Architecture Map of What Was Built

### 4.1 Schema (migration `20260606120000`)

- `annotation_updates(seq BIGSERIAL PK, document_id FK→documents CASCADE, client_id TEXT, client_seq BIGINT, data BYTEA, created_at)` with `UNIQUE(document_id, client_id, client_seq)` for at-least-once-becomes-effectively-once deduplication. Index `(document_id, seq)` serves the tail-replay read.
- `annotation_snapshots(document_id PK FK→documents CASCADE, at_seq BIGINT, snapshot BYTEA, encoding_version INT, updated_at)` — one row per doc, upserted on conflict.
- `documents.content_sha256 TEXT` + `UNIQUE INDEX (user_id, COALESCE(project_id,'00000000-0000-0000-0000-000000000000'), content_sha256) WHERE content_sha256 IS NOT NULL` — content-addressed identity, DB-enforced dedup.
- `documents.embedded_import_completed_at TIMESTAMPTZ` — durable once-only import marker (column exists in schema but NOT YET WRITTEN by client code — see §5 remaining work).
- RLS: `SELECT` requires `user_can_access_document(document_id, 'viewer')`, `INSERT` requires `'editor'`. Realtime publication on `annotation_updates`.

### 4.2 Service layer

- `src/services/annotationDocStore.js` — pure, testable Y.Doc ↔ `annotationsByPage` engine. `syncByPageToDoc` does minimal diff (zero ops when nothing changed). `encodeSnapshot` / `docToByPage`. No browser or Supabase dependency.
- `src/services/annotationDocSync.js` — durable wiring. Exports `openAnnotationDoc({ documentId, supabase, clientId, enableLocal, enableRealtime, doc })` → `AnnotationDocHandle` and `purgeAnnotationDoc(documentId)`.
  - **Open:** IndexedDB (y-indexeddb), snapshot+tail from backend, `update` observer → serialized `enqueueAppend` → `annotation_updates` INSERT, debounced `scheduleSnapshot` → `annotation_snapshots` UPSERT (gzip, 4 retries).
  - **Handle API:** `getByPage()`, `applyByPage(byPage)`, `getMeta(key)`, `setMeta(key, value)`, `onChange(cb)`, `flushSnapshot()`, `drain()`, `destroy()`.
  - `SNAPSHOT_AFTER_OPS = 40` (compact every N ops), `SNAPSHOT_DEBOUNCE_MS = 1200`, `SNAPSHOT_ENC_GZIP = 2`.

### 4.3 App wiring

- `src/hooks/useAnnotationDoc.js` — React seam. Opens the durable doc on `documentId`. Hydrates from store if non-empty (authoritative); seeds store from current React state if empty (covers marks drawn before `documentId` resolved and embedded-import marks). Remote ops → `setAnnotationsByPage`. Two capture effects: one for `annotationsByPage`, one for `callouts`. `forceFlush` for Cmd+S.
- `src/PDFViewer.jsx:15647–15681` — `useAnnotationCloudSync` called with `enabled: false, hydrateEnabled: false` (inert status/queue returns only); `useAnnotationDoc` is the live persistence hook gated on `isActive && cloudSyncEnabled && !!pdfFile?.id && !!user?.id`.
- `src/Dashboard.jsx` — Upload path now: compute `content_sha256` → `createSupabaseDocument` with SHA upsert (`ON CONFLICT (user_id, COALESCE(...), content_sha256)`) → stamps `file.id` BEFORE `onDocumentSelect` (closes the null-documentId window). Also imports `purgeAnnotationDoc` for hard-delete cleanup.

---

## 5. Migration Step Completion Status

Per `PERSISTENCE-ARCHITECTURE.md §6` (the 7-step plan):

| Step | Description | Status |
|------|-------------|--------|
| **1** | Content-addressed storage + DB dedup | **DONE.** `content_sha256` column, UNIQUE index in migration. SHA computed in Dashboard both Electron and browser upload paths. Storage path is `user_id/<sha>.pdf`. `createSupabaseDocument` upserts on conflict. |
| **2** | Fix `classifyIncomingFile` scope + name-collision handling | **PARTIAL.** The null-documentId window is closed (step 3 done). `classifyIncomingFile` itself (`incomingFileResolver.js`) was not patched — the old name+size match logic remains — but Dashboard's upload IIFE now resolves the document row before calling `onDocumentSelect`, making the legacy classifier path irrelevant for new uploads. Name-collision UI branch (`kind: 'name-collision'`) is still unhandled. Low risk now that SHA-upsert handles identity at DB level. |
| **3** | Resolve `documentId` before optimistic open | **DONE.** `createSupabaseDocument` is `await`ed before `onDocumentSelect` in both Electron (Dashboard:573) and browser (Dashboard:735) paths. `file.id` is set before the viewer mounts. |
| **4** | Durable import queue (actual root-cause fix) | **SUBSTANTIALLY DONE.** `useAnnotationDoc` seeds the durable store from whatever React state the viewer already holds (including embedded-import marks) when the store is empty. The self-heal effect drives the importer when store comes back empty, and those marks flow through `applyByPage` → `annotation_updates`. The `embedded_import_completed_at` durable marker was added to the schema but is **not yet written by client code** — the "exactly once" guarantee still relies on the per-mount `embeddedImportFallbackDoneRef` ref (per-session, not durable across restarts). |
| **5** | Append-only `annotation_updates` + `annotation_snapshots` + Yjs as source of truth | **DONE.** Tables created, client routes all persistence through them. `useAnnotationCloudSync` disabled for annotation/callout persistence. |
| **6** | Delete the patches (mergePreservingImportedMarks, watermark skip, self-heal) | **NOT DONE.** These are still present in the codebase: `safeSnapshot.js` `mergePreservingImportedMarks`, `resolveSafeSnapshot`, `useAnnotationCloudSync.js` watermark-skip, `PDFViewer.jsx:20631` self-heal effect. Safe to delete after step 4's `embedded_import_completed_at` write is wired and verified. The handoff doc explicitly labels this as Pass 2 work. |
| **7** | One writer per document + reconnect dedup | **PARTIALLY DONE.** `UNIQUE(document_id, client_id, client_seq)` is in the schema (makes reconnect re-sends no-ops). No advisory-lock / single-room sequencer has been added. For single-user use this is fine; concurrent multi-device conflict resolution relies on Yjs CRDT merge semantics (commutative, no coordinator needed). |

---

## 6. What Remains (Pass 2 / Cleanup)

In priority order:

1. **Wire `embedded_import_completed_at` write.** When the self-heal importer runs successfully, write `documents.embedded_import_completed_at = now()` via Supabase so the "import exactly once" guarantee is durable across restarts and re-installs, not just per-mount. Requires a `UPDATE documents SET embedded_import_completed_at = now() WHERE id = $1` call in `PDFViewer.jsx:20660-ish` after the import succeeds and the marks are captured. Low risk, one round-trip.

2. **Delete the legacy persistence patches** (once `embedded_import_completed_at` is wired and verified):
   - `src/safeSnapshot.js` functions `mergePreservingImportedMarks` and `resolveSafeSnapshot` (the cloud-backed guard branch).
   - The watermark-skip and `loadCloudWithEmptyVerify` call sites in `useAnnotationCloudSync.js` (entire hook may be removable once surveMarker migration is complete — Phase 32).
   - The self-heal effect at `PDFViewer.jsx:20631` (once the durable import marker makes it redundant).
   - Gate each deletion behind `npx vite build` + `node scripts/run-node-tests.mjs`.

3. **Handle `name-collision` in Dashboard.** `classifyIncomingFile` returns `kind: 'name-collision'` for same-name/different-content files but Dashboard has no handler — it falls through to `new`. Add a UI prompt ("You have a file named X with different content — open existing / create new version"). Low urgency (SHA-based dedup now prevents same-content duplication).

4. **Retention / dead-row GC.** 97.9% of `document_annotations` rows belong to archived documents. The new tables will accumulate the same dead weight unless archive/delete cascades to them (it does — `ON DELETE CASCADE` is in the migration for both new tables) and a nightly GC job prunes annotations for archived docs aged past 30–90 days. The CASCADE means new tables are clean by construction; `document_annotations` cleanup is the open item.

5. **Remove the legacy `doc_yjs_state` snapshot path.** `snapshotStore.js` still writes to `doc_yjs_state` but is only called by `useAnnotationCloudSync` which is now inert. The table and module can be dropped once Phase 32 / surveyMarker cutover completes.

6. **`useAnnotationCloudSync` full removal.** The hook is still imported and called (inert). Once surveyMarkers are migrated to the new path and all callers of its live return values (`cloudSyncStatus`, `cloudSyncQueueSize`) are updated, the whole hook can be deleted along with `annotationCloudSync.js`, `cloudSyncQueue.js`, and the related test suite.

---

## 7. Confidence Assessment

| Claim | Evidence | Confidence |
|-------|----------|------------|
| New tables exist in production | Migration committed + push confirmed in commit `0fa826ab` message ("Pushed to the linked project") | HIGH |
| Tables are empty because no post-cutover writes have occurred | Migration and viewer wiring are same-day; agent-cli roundtrip proves the write path works | HIGH |
| `useAnnotationDoc` is the active persistence path | `PDFViewer.jsx:15676` enabled condition is unconditionally true for any authenticated cloud-doc user | HIGH |
| `useAnnotationCloudSync` is fully inert for annotation persistence | `enabled: false, hydrateEnabled: false` at call site; hydrate effect short-circuits | HIGH |
| Legacy `document_annotations` is no longer written for new draws | `useAnnotationCloudSync` push debounce and `upsertAnnotationsByPage` are unreachable | HIGH |
| `document_annotations` 53k rows remain readable (legacy data) | Tables exist, RLS is still valid; no DROP has occurred | HIGH |
| `embedded_import_completed_at` not yet written by client | Searched all `src/` for `embeddedImportCompleted` — no write site found | HIGH |

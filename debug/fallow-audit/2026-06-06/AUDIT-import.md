# Import Persistence Audit — 2026-06-06

**Auditor:** automated code audit (Claude Sonnet 4.6)
**Scope:** whether embedded PDF annotations (e.g. pages 6-11 of an imported PDF) are durably saved to the database, and whether the documented root cause in PERSISTENCE-ARCHITECTURE.md still applies.

---

## TL;DR

**The original fault described in PERSISTENCE-ARCHITECTURE.md (2026-06-05) is NO LONGER LIVE in the current code.** The architectural fix (steps 3–5 of the migration plan) has been built and wired: a new append-only `annotation_updates` + `annotation_snapshots` backend was created by migration `20260606120000_rebuild_yjs_source_of_truth.sql`, a new `annotationDocSync.js` service implements the Figma/Google-Docs persistence shape, and `useAnnotationDoc.js` is now the active persistence hook — replacing the disabled `useAnnotationCloudSync` path.

However, the fix has a **residual race window** that the old fault does not apply to, but a new gap does (see §5).

---

## 1. The `shouldSkipEmbeddedPdfAnnotationImport` Flag — Still Present, Still Inverted

**Location:** `src/PDFViewer.jsx:17805`

```js
const shouldSkipEmbeddedPdfAnnotationImport = !!pdfFile?.id;
if (shouldSkipEmbeddedPdfAnnotationImport) {
  // PERF (2026-06-03): skipped embedded PDF annotation import — cloud/Y.Doc is authoritative
  // (for pdfjs engine: just set empty policy; for Syncfusion engine: diagnostics-only pass)
```

The flag is unchanged from what PERSISTENCE-ARCHITECTURE.md describes. The logic remains:
- `pdfFile?.id` absent (new upload) → importer runs → `setAnnotationsByPage` at line 17979
- `pdfFile?.id` present (reload / reuse) → importer skipped entirely

**The flag itself is no longer the root cause,** because the new persistence path does not depend on `useAnnotationCloudSync`'s `!documentId` push guard. See §3.

---

## 2. What Happens to Imported Objects

When the importer runs (new upload, `pdfFile?.id` absent), objects are written into React state via `setAnnotationsByPage` at PDFViewer.jsx:17979. They carry `isPdfImported: true`.

In `useAnnotationDoc.js`, **every change to `annotationsByPage` is captured** by this effect:

```js
// src/hooks/useAnnotationDoc.js:109-113
useEffect(() => {
  const h = handleRef.current;
  if (!h || !readyRef.current) return;
  h.applyByPage(annotationsByPage);
}, [annotationsByPage]);
```

`h.applyByPage()` calls `syncByPageToDoc(state.doc, byPage, ...)` (in `annotationDocStore.js`), which emits a Yjs update delta. The Y.Doc `'update'` observer in `annotationDocSync.js:152` then calls `enqueueAppend(state, update)`, which writes to `annotation_updates`:

```js
// annotationDocSync.js:242-251
const { data, error } = await state.supabase
  .from('annotation_updates')
  .insert(row)
  .select('seq')
  .single();
```

This is the append-only WAL. **Imported marks DO reach `annotation_updates` durably**, provided:
1. `useAnnotationDoc` is enabled and `readyRef.current` is true when the `annotationsByPage` state change fires.

---

## 3. The `!documentId` Push Guard in `useAnnotationCloudSync` — Now Irrelevant

`useAnnotationCloudSync` is now **permanently disabled** in PDFViewer.jsx:

```js
// PDFViewer.jsx:15654-15664
} = useAnnotationCloudSync({
  documentId: pdfFile?.id || null,
  ...
  enabled: false,        // ← HARD-CODED FALSE
  hydrateEnabled: false  // ← HARD-CODED FALSE
});
```

The old `if (!documentId) return` guard at line 1814 of `useAnnotationCloudSync.js` is dead code for production. The document_annotations upsert path (`upsertAnnotationsByPage`) is **not called** by any active code path on annotation saves. The new path writes to `annotation_updates` exclusively.

**The PERSISTENCE-ARCHITECTURE.md root cause — "push effect bails at `if (!documentId) return` before `lastByPageRef.current = annotationsByPage`" — no longer applies.** The old push path is disabled.

There is **no `embedded_import_completed_at` marker** implemented yet (the column was added by the migration, but no code reads or writes it in the current viewer or `useAnnotationDoc`).

---

## 4. The Self-Heal Effect and `mergePreservingImportedMarks`

### Self-heal (`PDFViewer.jsx:20630-20696`)

Still present and still wired. It fires when:
- `normalAnnotationHydration.ready === true` (from `useAnnotationDoc`)
- `normalAnnotationHydration.count === 0`
- `embeddedImportFallbackDoneRef.current !== documentId`

It calls `importAnnotationsFromPdf` then `handleSaveAnnotations`, which calls `setAnnotationsByPage`, which the `useAnnotationDoc` capture effect picks up and persists to `annotation_updates`. The 800ms debounce risk no longer applies — `useAnnotationDoc`'s capture effect fires synchronously on every `annotationsByPage` change, and the WAL append is immediate.

**The self-heal is now a genuine fix when it fires** (not a debounce-losable race), but its guard (`count === 0`) is unchanged.

### `mergePreservingImportedMarks` (`src/utils/safeSnapshot.js:38`)

Still present. Used in `useAnnotationCloudSync.js:1063` (snapshot prefetch) — that path is still in the file but the hook is disabled. Also potentially called by the old hydrate path. In the new path (`useAnnotationDoc`), it is NOT called: the store-wins / seed-from-viewer logic in `useAnnotationDoc.js:79-90` is a simple count-based branch with no merge.

---

## 5. Residual Gap in the New Architecture

`useAnnotationDoc` is gated on:
```js
enabled: isActive && cloudSyncEnabled && !!pdfFile?.id && !!user?.id
```

**The hook only opens when `pdfFile?.id` is present.** For a brand-new upload where `file.id` is still null (the optimistic open window), `useAnnotationDoc` does not open, `readyRef.current` is false, and the capture effect at line 109 silently skips (`if (!h || !readyRef.current) return`).

When `file.id` eventually resolves and `useAnnotationDoc` opens for the first time, it checks:
```js
if (count > 0 || hasCallouts) {
  // Durable store wins — paint from it.
} else {
  // Empty store: seed it with whatever the viewer already holds.
  const curByPage = byPageRef.current;
  if (curByPage && pageCount(curByPage) > 0) handle.applyByPage(curByPage);
}
```

**This is the fix for the inverted-timing problem**: the "seed from viewer" branch captures marks that were imported before the document id resolved. However:

1. **The hook opens only when `pdfFile?.id` changes.** The React `useEffect` dependency is `[enabled, documentId, userId, ...]`. The `enabled` flag includes `!!pdfFile?.id`. So when `file.id` is stamped in-place on the File object (Dashboard.jsx fire-and-forget), React may or may not re-render depending on whether the file mutation triggers a state update.

2. **If `file.id` never causes a re-render** (the architecture doc's concern about in-place mutation), `useAnnotationDoc` never opens for that session, the capture effect never fires with `readyRef.current = true`, and the imported marks are still only in React state — **same silent loss as before**, just via a different code path.

3. **`embedded_import_completed_at` is not yet used.** The migration added the column, but neither `useAnnotationDoc` nor any other code reads or writes it. The "exactly-once import" guarantee from PERSISTENCE-ARCHITECTURE.md §5.5 is not yet implemented in app code.

---

## 6. Current Real Behavior Summary

| Scenario | Outcome |
|---|---|
| New upload, `file.id` resolves and triggers a React re-render before tab close | `useAnnotationDoc` opens, seed-from-viewer branch captures imported marks, WAL append fires, marks survive reopen — **FIXED** |
| New upload, `file.id` stamped in-place with no React re-render | `useAnnotationDoc` never opens for this session, marks stay ephemeral — **STILL BROKEN** (same root cause, different mechanism) |
| Reload of existing cloud document | `useAnnotationDoc` opens with `documentId` present, hydrates from `annotation_snapshots` + `annotation_updates` tail, importer skipped, marks from prior sessions present — **CORRECT** |
| First open ever of cloud document with embedded marks (never imported) | `useAnnotationDoc` opens, empty store → self-heal fires → imports → capture effect fires → WAL append → **FIXED** (provided the hook was open before the self-heal ran) |
| Tab closed within 1200ms of mark capture (before debounced snapshot write) | WAL op was already appended (immediate), snapshot may not be written; next open replays tail ops — **SAFE, no data loss** |

---

## 7. Status of the Documented Fix

| Component | Documented in PERSISTENCE-ARCHITECTURE.md §5 | Current Code Status |
|---|---|---|
| `annotation_updates` WAL table | Step 5 | **DONE** — migration 20260606120000 |
| `annotation_snapshots` table | Step 5 | **DONE** — migration 20260606120000 |
| `content_sha256` + UNIQUE dedup | Step 1 | **SCHEMA DONE**, no client-side sha compute yet |
| `embedded_import_completed_at` column | Step 4 | **SCHEMA DONE**, not yet read/written in code |
| `annotationDocSync.js` service | Step 5 | **DONE** — new file |
| `useAnnotationDoc` hook | Step 5 | **DONE** — new file, wired in PDFViewer |
| `useAnnotationCloudSync` disabled | Step 5 prerequisite | **DONE** — hard-coded `enabled: false` |
| Seed-from-viewer on empty store | Step 4 (durable import queue substitute) | **DONE** — `useAnnotationDoc.js:86-89` |
| `await` document-row create before open | Step 3 | **NOT YET DONE** — still optimistic/fire-and-forget |
| Durable `embedded_import_completed_at` marker usage | Step 4 | **NOT YET DONE** |
| Remove patches (`mergePreservingImportedMarks`, self-heal, watermark-skip) | Step 6 | **NOT YET DONE** (patches left in place alongside new path) |

---

## 8. Verdict

**The import-not-persisted fault as described in PERSISTENCE-ARCHITECTURE.md is PARTIALLY FIXED.**

- The primary mechanism (push gate bailing on null documentId) is neutralized — `useAnnotationCloudSync` is disabled and the new WAL path has no such gate.
- The secondary mechanism (no durable owner during the null-id window) is addressed by the seed-from-viewer branch in `useAnnotationDoc`, **but only if `file.id` causes a React re-render** before the session ends. If Dashboard.jsx mutates `file.id` in place without a state update (the documented risk), the hook never opens and the loss is identical to the old fault.
- The `embedded_import_completed_at` guard (Step 4 of the fix plan) is not yet implemented in code — so "exactly-once import" is not yet enforced durably.

The most likely path to complete the fix is to ensure `pdfFile?.id` resolves via a proper React state update (not an in-place mutation) so `useAnnotationDoc`'s `enabled` gate reliably fires. That is Step 3 in the plan (`await` the document-row create and propagate via `setFile` / equivalent).

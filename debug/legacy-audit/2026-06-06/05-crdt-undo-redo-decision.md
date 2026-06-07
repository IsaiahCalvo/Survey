# CRDT Layer Audit: Two-Y.Doc Architecture, Undo/Redo, and Merge Decision

**Date:** 2026-06-06  
**Scope:** Architectural decision gate for new-engine Y.Doc vs CRDT-layer Y.Doc unification  
**Status:** RECOMMENDATION DELIVERED — read Section 5 before touching code

---

## 1. What the CRDT Collab Layer Does at Runtime

### 1a. ydocLifecycle (src/lib/collab/ydocLifecycle.js)

`attachLifecycle(ydoc, documentId, {onStorageState})` (line 52) wires three sub-systems:

- **IndexedDB persistence** (`new IndexeddbPersistence(documentId, ydoc)`, line 124). Leader tab only, guarded by Web Locks. IDB key = raw `documentId` UUID. The `synced` event fires `onStorageState({ code: 'ok', role: 'leader' })` which is how `YDocProvider` knows hydration is complete and clears the `isHydrating` fade-gate (YDocProvider line 311).
- **BroadcastChannel fan-out** (`y-doc-bc-${documentId}`, line 77). Leader broadcasts every local update; loser tabs apply via `Y.applyUpdate(ydoc, ..., REMOTE_BC_ORIGIN)` (line 94). Echo-loop guard checks `origin === REMOTE_BC_ORIGIN` (line 106).
- **Web Locks election** (`y-doc-${documentId}`, line 76). Lock held for tab lifetime via an intentionally-never-resolving Promise (line 141). Prevents concurrent IDB writes (Pitfall 2 defense).
- **StorageFailureDetector** (line 133): IDB quota/invalid-state surfaced to the `onStorageState` callback → YDocProvider banner.

### 1b. crdtBackfill (src/lib/collab/crdtBackfill.js)

`runBackfill(args)` (line 197): one-time per-(user, document) migration of legacy `document_annotations` rows into the CRDT Y.Doc's `annotations` Y.Map. Key behaviors:

- **Idempotency key**: `ydoc.getMap('meta').get('backfill_done:<userId>')` (line 488). Once set, subsequent opens skip the SELECT loop (unless `markCutoverComplete: true` is passed).
- **Cutover seal**: If `markCutoverComplete: true` (line 240) and `yMapSize >= imported`, writes `documents.cutover_completed_at = NOW()` (line 728). Once sealed, subsequent opens run only the cheap degeneracy probe (lines 260–317) instead of the full SELECT + import loop.
- **IndexedDB race guard** (line 271): waits up to 1.5s for IndexedDB to load before the size probe fires.
- **Writes to**: CRDT Y.Doc's `annotations` map and `meta` map. Does NOT write to `document_annotations`, `annotation_updates`, or `annotation_snapshots`.
- **Called from**: `YDocProvider.jsx` line 847 inside a deferred `Promise.resolve().then(kickoff)` (line 905).

### 1c. crdtDualWriteQueue (src/lib/collab/crdtDualWriteQueue.js)

`enqueue({ userId, annoId, side, payload })` (line 114): persists a failed write (either `'legacy'` side = `document_annotations` or `'crdt'` side = Y.Map) to `localStorage` key `crdt_dual_write_queue:<userId>`.

`drainQueue({ userId, retryLegacyWrite, retryCrdtWrite })` (line 145): 1Hz retry loop (setInterval in YDocProvider line 961). Exponential backoff (line 176), quarantine after 10 attempts (line 197). Kill-switch guard at first line (line 148).

The queue is the missing-side safety net for `dualWriteFabricCommit` (annotationCloudSync.js line 760), which fans out every annotation save to BOTH `upsertFabricAnnotation` (legacy `document_annotations`) AND `applyFabricCommit` (CRDT Y.Map).

### 1d. How Undo/Redo Is Wired

PDFViewer.jsx line 9346:
```
const { ydoc: yjsDoc, undoManager: yjsUndoManager, undoCtx: yjsUndoCtx } = useYDoc();
```

`useYDoc()` (src/hooks/useYDoc.js line 49) reads `YDocContext` which is provided by `YDocProvider`. That context carries the `undoManager` and `undoCtx` set by the async effect at YDocProvider lines 499–548 via `createUndoManager({ ydoc, userId, ... })`.

`createUndoManager` (src/lib/collab/crdtUndoManager.js line 257):
- Creates `new Y.UndoManager([ydoc.getMap('annotations'), ydoc.getMap('callouts')], { trackedOrigins: new Set([origin]) })`.
- The `origin` is the memoized frozen `{ source: 'local-fabric', userId, ... }` object (line 258, via `getLocalFabricOrigin`). This SAME reference is passed to every `ydoc.transact(fn, origin)` call from `crdtAnnotationBridge`, so `trackedOrigins.has(origin)` holds via reference equality (Pitfall 7 mitigation).

**handleUndo** (PDFViewer.jsx line 10427) is a THREE-LANE dispatcher:
1. **Local annotation history lane** (`localAnnotationUndoRef`): in-memory per-annotation undo for shapes drawn since app open. Uses `shouldUndoLocalBeforeLegacy` (imported from `./utils/historyStacks`) to compare timestamps.
2. **Legacy history lane** (`undoHistoryRef` / full-snapshot state array): whole-document state checkpoints for bulk edits, callout operations.
3. **Yjs/CRDT history lane** (line 10595–10597): `userUndo(yjsDoc, yjsUndoManager, yjsUndoCtx)` from `crdtUndoManager.js`. Falls through to this lane when lanes 1 and 2 are both empty/ineligible. The CRDT lane is the **last resort** — it handles Fabric edit-canvas mutations that were written directly to the CRDT Y.Doc via `crdtAnnotationBridge.applyFabricCommit`.

`userUndo` (crdtUndoManager.js line 331): wraps `undoManager.undo()` inside `ydoc.transact(fn, { source: 'local-undo', ... })`. The `'local-undo'` source is NOT in `trackedOrigins`, so the undo transaction itself is not pushed back onto the undo stack (Pitfall 8 mitigation).

The same three-lane pattern applies for `handleRedo` (PDFViewer.jsx line 10619).

---

## 2. Confirming the Two Separate Y.Docs

### CRDT Layer Y.Doc Key

`ydocRegistry.getOrCreateYDoc(documentId)` — called by `YDocProvider.jsx` line 202 with the raw `docId` prop. Registry key = raw `<documentId>` UUID, e.g. `"abc123-..."`.

IDB persistence key = same raw `documentId` (ydocLifecycle.js line 124: `new IndexeddbPersistence(documentId, ydoc)`).

The Y.Doc's maps used: `annotations` (per-annotation Y.Maps with `type`, `pageNumber`, `fabric`, `meta`), `callouts`, `meta`, `__annotationLatestFabric`.

### New Engine Y.Doc Key

`annotationDocSync.js` line 33: `const REGISTRY_PREFIX = 'annoflat:';`

`openAnnotationDoc` line 101–103:
```js
const registryKey = `${REGISTRY_PREFIX}${documentId}`;
const activeDoc = doc || getOrCreateYDoc(registryKey);
```

Registry key = `"annoflat:<documentId>"`, e.g. `"annoflat:abc123-..."`.

IDB persistence key = `anno-${documentId}` (line 129: `new IndexeddbPersistence('anno-${documentId}', activeDoc)`).

The Y.Doc's maps used: `annotations` (value shape `{ p: pageNumber, o: fabricObject }`), `annoMeta`.

### Are They Separate?

**Yes, completely separate.** The registry is a `Map<string, {doc, refCount}>` (`globalThis.__ydocRegistry__`, ydocRegistry.js line 11). The two keys `"<documentId>"` and `"annoflat:<documentId>"` are different strings → two completely distinct `Y.Doc` instances. They share no maps, no observers, no transact scope.

### Is There Any Cross-Sync Code?

No. A grep over the entire `src/` tree finds:
- `annotationDocSync.js` imports only from `ydocRegistry.js` (for registry management) and `annotationDocStore.js` (pure engine). It does NOT import from `YDocProvider`, `crdtAnnotationBridge`, `crdtDualWriteQueue`, or `crdtBackfill`.
- `useAnnotationDoc.js` imports only `openAnnotationDoc` and `getClientId` from `annotationDocSync.js`. It does NOT call `useYDoc()` and does not reference the CRDT Y.Doc.
- `YDocProvider.jsx` does not import anything from `annotationDocSync.js` or `annotationDocStore.js`.

The two Y.Docs are **fully isolated**. There is zero code today that syncs, bridges, or reconciles their state.

---

## 3. Who Reads from the CRDT Layer's Y.Doc

### Undo/Redo (primary consumer)

PDFViewer.jsx line 9346 reads `yjsDoc`, `yjsUndoManager`, `yjsUndoCtx` from `useYDoc()`. The three-lane undo dispatcher (lines 10427–10606) uses `yjsUndoManager?.undoStack` and `userUndo(yjsDoc, yjsUndoManager, yjsUndoCtx)` as the last-resort lane.

`createUndoManager` (crdtUndoManager.js line 259) watches `ydoc.getMap('annotations')` and `ydoc.getMap('callouts')` — these are the CRDT Y.Doc's maps, not the new engine's.

### useAnnotationCloudSync (secondary consumer)

`useAnnotationCloudSync.js` line 486 reads `phase30Ydoc` via `useYDoc()`. It uses this Y.Doc at lines 671, 791, 843 as the write target for `dualWriteFabricCommit` (Fabric annotation + callout mutations → `applyFabricCommit` → CRDT Y.Map). It also reads from `phase30Ydoc.getMap('annotations')` at line 1170 for the cutover-sealed render path.

### CollaboratorOutlineOverlay / remote-delete toasts (tertiary consumers)

YDocProvider.jsx line 581: `ydoc.getMap('annotations').observe(handler)` drives remote-delete toast queue. YDocProvider line 730: `useRemoteEditors()` subscribes to the awareness state of the CRDT Y.Doc.

### Transport (SupabaseYjsProvider)

YDocProvider.jsx line 329: `createTransportProvider({ documentId, ydoc, ... })` streams realtime updates INTO the CRDT Y.Doc via `Y.applyUpdate`. This is the collab sync channel.

---

## 4. What the CRDT Layer Writes Durably vs. the New Engine

### CRDT Layer Durable Writes

Via `dualWriteFabricCommit` (annotationCloudSync.js line 760), every annotation save fires:

1. **Legacy path**: `upsertFabricAnnotation` → `document_annotations` table row (annotationCloudSync.js line 783). This is the same table the old system used.
2. **CRDT path**: `applyFabricCommit` → CRDT Y.Doc `annotations` map mutation (annotationCloudSync.js line 44, crdtAnnotationBridge.js). The CRDT Y.Doc mutation is then propagated by ydocLifecycle (IDB + BroadcastChannel) and by SupabaseYjsProvider (Realtime).

So the CRDT layer writes BOTH to `document_annotations` AND to the CRDT Y.Doc.

### New Engine Durable Writes

`annotationDocSync.js` every-edit observer (line 152–163): each local Y.Doc mutation → `enqueueAppend` → `annotation_updates` row (line 236: `supabase.from('annotation_updates').insert(row)`). Plus debounced full-state checkpoint → `annotation_snapshots` upsert (line 285–296).

The new engine writes to `annotation_updates` and `annotation_snapshots`. It does NOT write to `document_annotations`.

### Dual-Write Risk / Overlap Analysis

| What is written | CRDT layer | New engine |
|---|---|---|
| `document_annotations` rows | YES (dual-write legacy path) | NO |
| `annotation_updates` rows | NO | YES |
| `annotation_snapshots` rows | NO | YES |
| CRDT Y.Doc IDB (`documentId`) | YES (ydocLifecycle) | NO |
| New engine IDB (`anno-documentId`) | NO | YES (annotationDocSync) |
| Realtime push | YES (SupabaseYjsProvider) | YES (annotationDocSync subscribeRealtime) |

**The two layers write to COMPLETELY DIFFERENT TABLES.** There is no overlap in the durable write path today. The `document_annotations` rows that the CRDT layer writes via `dualWriteFabricCommit` are separate from the `annotation_updates` / `annotation_snapshots` rows the new engine writes.

**However, there IS a latent state-coherence risk**: both layers independently hold the full annotation state for the same document. If both are live and a user draws an annotation, the CRDT path writes it to `document_annotations` + CRDT Y.Doc + Realtime, while the new engine path captures the `annotationsByPage` state change and writes it to `annotation_updates` + `annotation_snapshots`. Both describe the same annotation in different tables and different Y.Docs with no reconciliation. This is acceptable as a transitional state only because:
- The new engine is gated by `cloudSyncEnabled` and `enabled` in `useAnnotationDoc` (PDFViewer.jsx line 15676).
- The CRDT layer is gated by `isCRDTEnabled()` (defaults ON).
- **Neither layer reads from the other's store**, so there is no reconcile-on-open conflict yet.

But if both remain enabled for the same document indefinitely, the two stores will diverge over time (e.g., deletes written to one store but not observed by the other at re-open). This is the central risk that makes this architectural decision time-sensitive.

---

## 5. The Decision: Two Options

### Option A — New Engine Replaces CRDT Layer

The new `annoflat:` Y.Doc becomes the single Y.Doc. `YDocProvider` / `crdtBackfill` / `ydocLifecycle` / `crdtDualWriteQueue` / `crdtAnnotationBridge` are all deleted. Undo/redo is rewired onto the new engine's Y.Doc.

**What Has to Change:**
1. `PDFViewer.jsx` line 9346: `useYDoc()` call for `yjsUndoManager`/`yjsDoc`/`yjsUndoCtx` must be replaced by equivalent values from the new engine's handle (`useAnnotationDoc` currently returns `initialHydration` and `forceFlush` only — it does not expose the underlying `Y.Doc` or any undo manager).
2. `handleUndo` / `handleRedo` three-lane dispatcher (PDFViewer.jsx ~10427, ~10619): the Yjs/CRDT lane that calls `userUndo(yjsDoc, yjsUndoManager, yjsUndoCtx)` must be rewired to call `userUndo` on the new engine's `Y.Doc` with a new `Y.UndoManager` scoped to the new engine's `annotations` map.
3. `useAnnotationDoc.js` must be extended to expose `{ doc, undoManager, undoCtx }` alongside its existing handle so PDFViewer can consume them.
4. `annotationDocSync.js` must construct (or accept) a `Y.UndoManager` scoped to the new engine's `annotations` map.
5. `useAnnotationCloudSync.js`: `phase30Ydoc` reads from the old CRDT Y.Doc (line 486). The `dualWriteFabricCommit` / `applyFabricCommit` / `applyCalloutCommit` write targets must be removed or redirected. Since the new engine already captures every `annotationsByPage` change (useAnnotationDoc line 112), the CRDT fan-out is redundant and can be deleted.
6. `AppShell.jsx` lines 2389/2431: `<YDocProvider>` wrapper must be removed. Every consumer of `useYDoc()` (`useAnnotationCloudSync`, `CollaboratorOutlineOverlay`, `StorageFailureBanner`, remote-delete toasts) must be rewired or deleted.
7. `crdtBackfill`: the one-time import into the CRDT Y.Doc is no longer needed. Legacy `document_annotations` rows must instead be seeded into the new engine's `annotation_updates` / Y.Doc, OR the old backfill is left as a one-time migration job and the new engine reads only from `annotation_updates` post-cutover.

**Blast Radius (High-Risk Files):**
- `src/PDFViewer.jsx` (~34k lines, highest-risk): undo/redo wiring change (~9338–10606), `useAnnotationDoc` call (~15673), removal of `useYDoc()` call (~9346), removal of `useAnnotationCloudSync` CRDT fan-out dependency.
- `src/hooks/useAnnotationCloudSync.js` (large): remove `phase30Ydoc`/`dualWriteFabricCommit` write path, remove `applyFabricCommit`/`applyCalloutCommit` CRDT writes.
- `src/AppShell.jsx`: remove `<YDocProvider>` wrapper.
- `src/hooks/useAnnotationDoc.js` (small, ~130 lines): extend to expose `doc`, `undoManager`, `undoCtx`.
- `src/services/annotationDocSync.js` (medium): add `Y.UndoManager` construction.

**Data-Loss Risk:** HIGH during transition.
- The CRDT Y.Doc holds the backfill history of all legacy `document_annotations` rows for sealed documents. At cutover, those annotations must already live in the new engine's `annotation_updates` / `annotation_snapshots` or they are lost.
- If a document was sealed by `crdtBackfill` but the new engine was not yet enabled for that document, deleting the CRDT layer before the new engine has written a snapshot would render the document blank on next open (the IDB for the CRDT doc would be gone, the new engine IDB would be empty, and `annotation_updates` would have no rows for the legacy data).
- Mitigation: run a one-time cloud migration that seeds `annotation_updates` rows from `document_annotations` for all sealed documents before removing the CRDT layer.

**How Undo/Redo Survives:**
The `Y.UndoManager` that `createUndoManager` builds today tracks `ydoc.getMap('annotations')` and `ydoc.getMap('callouts')` on the CRDT Y.Doc. After Option A, the same `createUndoManager` would be called on the NEW engine's Y.Doc, tracking the same map names. The `annotationsByPage` capture in `useAnnotationDoc` (line 112) means every local edit already writes into the new Y.Doc, so all edits are trackable. The three-lane dispatcher in PDFViewer would still have lanes 1 and 2 (local annotation history, legacy full-snapshot history); the Yjs lane (lane 3) would now point to the new engine's undo manager. The functional behavior from the user's perspective is identical.

---

### Option B — Merge: Keep YDocProvider as the Single Y.Doc

The CRDT Y.Doc becomes the single durable store. The new engine (`annotationDocSync`, `annotationDocStore`, `useAnnotationDoc`) is retired. The CRDT Y.Doc's `SupabaseYjsProvider` handles Realtime sync. `annotation_updates` / `annotation_snapshots` are abandoned in favor of the CRDT layer's `SupabaseYjsProvider` + `IndexeddbPersistence` path.

**What Has to Change:**
1. The new engine's durability guarantees (append-only WAL, gzipped snapshots, keyset pagination) must be re-implemented on top of the CRDT Y.Doc or replaced by `SupabaseYjsProvider`'s mechanism.
2. `useAnnotationDoc` must be replaced — its role (capture `annotationsByPage` → Y.Doc, hydrate from Y.Doc → React state) must be done against the CRDT Y.Doc.
3. The `annoflat:` IDB store and `annotation_updates` / `annotation_snapshots` tables are abandoned.
4. `annotationDocSync.js` and `annotationDocStore.js` are deleted.
5. PDFViewer.jsx line 15673 `useAnnotationDoc` call must be removed.

**Blast Radius (High-Risk Files):**
- `src/PDFViewer.jsx`: remove `useAnnotationDoc` call (~15673) and replace with CRDT-native hydrate + capture.
- `src/AppShell.jsx`: no change needed (YDocProvider stays).
- The new engine files (`annotationDocSync.js`, `annotationDocStore.js`, `useAnnotationDoc.js`) are all deleted.

**Data-Loss Risk:** MEDIUM.
- Data already written to `annotation_updates` by the new engine must be migrated back to the CRDT Y.Doc (or those documents re-opened will lose the new-engine writes). This is a smaller migration since the new engine was just introduced.
- The CRDT layer's `SupabaseYjsProvider` does NOT use an append-only WAL. Its durability model is: `IndexeddbPersistence` locally + Realtime-applied remote deltas. If IDB is cleared, data not yet covered by a snapshot can be lost. The new engine's `annotation_updates` WAL prevents this by having every op durable in the cloud before local state.

**How Undo/Redo Survives:**
No change needed. `createUndoManager` already targets the CRDT Y.Doc. `handleUndo`/`handleRedo` lanes are unchanged.

---

## 6. RECOMMENDATION

### Recommendation: OPTION A — New Engine Replaces CRDT Layer

**Rationale:**

1. **The new engine's durability model is stronger.** An append-only `annotation_updates` WAL means every mutation is durable in the cloud the moment it happens, before anything else. The CRDT layer's IDB+Realtime model has a replay gap: if IndexedDB is cleared and the device never re-synced, any local edits that did not propagate via Realtime are gone. The new engine was explicitly designed to close this gap (annotationDocSync.js lines 6–11).

2. **The CRDT layer's `document_annotations` dual-write is a liability, not an asset.** `dualWriteFabricCommit` writes the same annotation to BOTH `document_annotations` AND the CRDT Y.Doc to preserve v2.3 client compatibility. This is temporary migration scaffolding, not a long-term architecture. The CRDT layer description in the task background calls this correctly: it's a "dual-write era" design. The new engine abandons `document_annotations` entirely and writes only to `annotation_updates`+`annotation_snapshots`, which is the cleaner model going forward.

3. **The CRDT Y.Doc is the thing being REPLACED in the Syncfusion removal roadmap.** Per MEMORY.md `project_syncfusion_removal_plan.md` and the north-star note (`project_north_star_own_zoom.md`): "replace Syncfusion with the owned pdf.js renderer." The new engine (`annotationDocSync`/`annotationDocStore`) is the annotation persistence foundation for the post-Syncfusion world. Merging INTO the CRDT layer (Option B) would mean refactoring the new engine again during the Syncfusion removal — doing the same work twice.

4. **The new engine is already live and capturing data.** `useAnnotationDoc` is mounted in PDFViewer (~15673) with `enabled: isActive && cloudSyncEnabled`. Delaying Option A means the two stores diverge further every day.

5. **Undo/redo rewiring is bounded work.** The three-lane dispatcher already handles the case where `yjsUndoManager` is null (returns a null-shape). Adding a fourth Y.Doc source for the new engine's undo manager requires only extending `useAnnotationDoc` to expose `{ doc, undoManager }` and passing those values into the existing `userUndo`/`userRedo` call sites. The legacy-history and local-annotation-history lanes are unaffected.

### Smallest-Blast-Radius Sequence

**Phase I — Data parity gate (pre-deletion, zero code risk)**
1. Audit: for every document with `cutover_completed_at IS NOT NULL` in the `documents` table, verify that the new engine's `annotation_updates` has at least one row for that document. This identifies documents where the CRDT layer's backfill data has NOT been captured by the new engine yet.
2. If any sealed documents have no `annotation_updates` rows, run a one-time migration: for each such document, replay the CRDT Y.Doc state into `annotation_updates` rows (or write a gzip snapshot directly to `annotation_snapshots`). This is the migration protection before CRDT deletion.

**Phase II — Expose doc + undoManager from new engine (small, additive)**
1. Extend `useAnnotationDoc.js` (~130 lines) to return `{ doc, undoManager, undoCtx }` in addition to `{ initialHydration, forceFlush }`. The `doc` is already on `handleRef.current.doc`; `undoManager` is constructed via `createUndoManager` (no new dependencies — same module already in the codebase).
2. Wire the new `undoManager`/`yjsDoc`/`undoCtx` into `handleUndo`/`handleRedo` lane 3 in PDFViewer.jsx. The change is surgical: replace the three destructured values at line 9346 to come from `useAnnotationDoc`'s return instead of `useYDoc()`.
3. Run `npm test`. Verify that `tests/mergePreservingImportedMarks.test.mjs`, `tests/safeSnapshot.test.mjs`, and `tests/pdfAnnotationImporter.test.mjs` pass (these are the modified tests listed in git status).

**Phase III — Disable CRDT writes in useAnnotationCloudSync (medium, high-risk file but surgical)**
1. In `useAnnotationCloudSync.js`, delete the `phase30Ydoc` / `dualWriteFabricCommit` CRDT fan-out path. The `enabled: false` flag at PDFViewer line 15662 already disables hydrate/push, so this is removing dead code, not live behavior.
2. Remove the `applyFabricCommit` / `applyCalloutCommit` CRDT writes from the save path (lines ~671, 791, 843). The new engine already captures these mutations via `useAnnotationDoc`'s effect at line 112.
3. Run `npm test`.

**Phase IV — Remove YDocProvider, crdtBackfill, ydocLifecycle, crdtDualWriteQueue**
1. Remove the `<YDocProvider>` wrapping from AppShell.jsx lines ~2389/2431.
2. Delete: `src/components/collab/YDocProvider.jsx`, `src/lib/collab/crdtBackfill.js`, `src/lib/collab/ydocLifecycle.js`, `src/lib/collab/crdtDualWriteQueue.js`, `src/lib/collab/crdtAnnotationBridge.js`, `src/lib/collab/crdtUndoManager.js`, `src/hooks/useYDoc.js`, `src/components/collab/YDocContext.js`, `src/lib/collab/ydocRegistry.js` (if no longer used by the new engine — NOTE: `annotationDocSync.js` line 20 imports `getOrCreateYDoc` from `ydocRegistry.js`, so the registry file MUST be kept; only the CRDT-specific files are deleted).
3. Update the new engine's `annotationDocSync.js` to use `getOrCreateYDoc('annoflat:${documentId}')` — it already does this (line 101–103). No change needed.
4. Run `npx vite build` + `node scripts/run-node-tests.mjs`.

**CLAUDE.md Invariants Honored Throughout:**
- `PDFViewer.jsx` changes in Phase II and III are surgical: one destructuring swap (line 9346) and conditional deletion in the three-lane dispatcher. No refactoring, no canvas sizing changes, no `zoomGeneration` signal touches.
- `SVGAnnotationLayer.jsx` is untouched.
- `zoomGeneration` signal at `setZoomGeneration(prev => prev + 1)` (still inside `beginSyncfusionScaleConfirmPending` in PDFViewer.jsx) is not in scope for any of these phases.
- The high-risk file waiver (granted 2026-04-29) covers PDFViewer.jsx edits; Phase II touches are minimal-viable-diff only.

---

## Citations Summary

| Claim | File:Line |
|---|---|
| CRDT Y.Doc key = raw documentId | ydocRegistry.js:19, YDocProvider.jsx:202 |
| New engine Y.Doc key = `annoflat:<documentId>` | annotationDocSync.js:33,101–103 |
| CRDT IDB key = raw documentId | ydocLifecycle.js:124 |
| New engine IDB key = `anno-${documentId}` | annotationDocSync.js:129 |
| No cross-sync between the two Y.Docs | (grep confirms no imports between annotationDocSync and YDocProvider families) |
| undo/redo reads from CRDT Y.Doc | PDFViewer.jsx:9346, 10595–10597 |
| phase30Ydoc (useAnnotationCloudSync) reads CRDT Y.Doc | useAnnotationCloudSync.js:486 |
| dualWriteFabricCommit writes to both document_annotations and CRDT Y.Doc | annotationCloudSync.js:760–784 |
| New engine writes to annotation_updates | annotationDocSync.js:236–240 |
| New engine writes to annotation_snapshots | annotationDocSync.js:285–296 |
| Three-lane undo/redo dispatcher | PDFViewer.jsx:10427–10606, 10619–10780 |
| isCRDTEnabled defaults ON | crdtFeatureFlag.js:47 |
| useAnnotationDoc enabled gate | PDFViewer.jsx:15676 |
| useAnnotationCloudSync enabled: false | PDFViewer.jsx:15662 |
| ydocRegistry shared between old and new engine | ydocRegistry.js:11, annotationDocSync.js:20 |

# Keystone Wiring Spec (Phase 5) — callouts[] → annotationsByPage

## UPDATE — 2026-06-28 (owner chose FULL `.fabricObject` migration; backfill + read-shim LANDED)

Owner decision (this session): **migrate DB rows to `annotation_data.fabricObject`** (full
plan-as-written, cleanest on-disk parity), NOT the lazier keep-rows-normalized variant.

Data footprint (Management-API census, read-only): **prod = exactly 11 callout rows across
8 docs, all `.callout` shape, 0 `.fabricObject`; survey-test = empty** (free-tier reset). The
plan's backup-column/rollback/visual-verify ceremony is oversized for 11 disposable rows.

LANDED this session (both gated, flag-OFF byte-identical, on branch `claude/vibrant-lewin-6d7e06`):
- **Backfill script** `scripts/backfill-callouts-to-fabric.mjs` (commit 226a1391). Pure
  `buildFabricAnnotationData` + `verifyRoundTrip` + CLI, default `--dry-run`. Lossless: full
  original at `fabricObject.data.legacyCallout` (incl. fillColor/fillOpacity/borderOpacity/
  arrowheadStyle/meta.authorId), `isPdfImported`/`pdfAnnotationId` lifted to fabricObject root,
  author at `data.authorId`. Idempotent (skips already-migrated). Dry-run on all 11 real rows:
  lossless, maxFracDelta ~1e-16. **`--apply` NOT yet run** (gated — see ordering below).
- **Backward-read shim** `deserializeRowToCallout` (commit e76b7bc3): recovers the normalized
  callout from `fabricObject.data.legacyCallout` when `.callout` is absent. This makes migrated
  rows load via the existing callout→`projectCalloutsIntoByPage` path **FLAG-INDEPENDENTLY**
  (renders flag-OFF too) → **the backfill apply is now DECOUPLED from the flag flip** (safer than
  the plan's flag-coupled read switch). Migrated rows stay excluded from the fabric→annotationsByPage
  path (`shouldDeserializeAsFabricObject` still false for callouts), so no double-load; no separate
  load-time re-projection is needed.

### REVISED ORDERING (because of the decoupling)
1. ✅ Backfill script + dry-run (done). 2. ✅ Backward-read shim (done).
3. ⏭ **R2 keystone write-switch** (below) — retire `callouts[]` as runtime source, reverse the 3
   write-guards, single shared writer, disable legacy push. LARGE/risky — do fresh, adversarially.
4. ⏭ **Adversarial gate** (≥2 passes + harness flag-ON + save→reopen + collab).
5. ⏭ **Flip flag default ON** AND **run `--apply`** (coupled; do together once writes go `.fabricObject`).
   Re-run idempotently if any row drifts back to `.callout` from a flag-OFF edit during transition.

### R2 EXECUTION MAP (callouts[] → annotationsByPage source-of-truth; PATH B = replace setCallouts with setAnnotationsByPage)
~40 touch points / 9 clusters. Mechanical: CREATE/DELETE/EDIT/LOAD/RENDER/HISTORY. Genuinely tricky
(realtime/undo): sync-delta, realtime echo-suppression, live-drag baseline.
- **LOAD**: `PDFViewer.jsx:18927–18980` (setCallouts(loadedCallouts); flag-ON projection 18941–18976);
  cloud hydrate in `useAnnotationDoc.js` (already de-duped onto `projectCalloutsIntoByPage`).
- **CREATE**: `handleCreateCallout` `PDFViewer.jsx:10421`; realtime echo `useAnnotationCloudSync.js:2923–2927`.
- **EDIT**: `PDFViewer.jsx:3430` (text style), `:10454`, `:10467` (geometry/live-drag); realtime `sync:2929`.
- **DELETE**: bulk `handleDeleteSelectedCallouts` `PDFViewer.jsx:10296–10354` (already canModify-gated),
  clipboard cut `:3646`, realtime `sync:2936`. Route bulk via `handleRequestBulkDelete`/`buildBulkDeletePlan`.
- **READ/props**: 13 sites incl. ref sync + prop propagation to SVGAnnotationLayer/PageAnnotationLayer +
  `getHistorySnapshot`/`restoreHistoryState` + PDF export; render loop `SVGAnnotationLayer.jsx:2876–3110`.
- **UNDO/HISTORY**: snapshots `PDFViewer.jsx:9973,9985`; restores `:10001–10026`; `addHistoryCheckpoint('callouts:*')`
  across create/update/delete/cut; `calloutHistoryScope` usage. (Phase 3 post-keystone items 4–6.)
- **LEGACY PUSH (the single effect to STOP firing flag-ON)**: `useAnnotationCloudSync.js:2331–2640`
  (delta `:2481`, durable retry `queueCalloutDurableRetry :904`, CRDT fan-out `fanOutCrdtForCallouts :842`,
  realtime callbacks `:2922–2942`). Retire the six fingerprint refs + `deferredCalloutPushRef`.
- **WRITE-GUARDS to reverse (flag-ON)**: `annotationDocStore.js:202` (Y.Doc flat-map skip),
  `annotationTypeSerializers.js:504` (serializeAnnotationsByPage skip), `:87` (shouldDeserializeAsFabricObject
  → make it `true` for callout rows with `.fabricObject`). Reversing all three lets callout objects in
  annotationsByPage serialize as `.fabricObject` rows AND deserialize straight back into annotationsByPage.
  ⚠ Reverse these ONLY together with disabling the legacy push, else dual-write on the same id (BLOCKER 1).
- **RENDER**: shared dispatch `SVGAnnotationLayer.jsx:1778–1790` (flag-ON); legacy loop `:2876–3110`
  (hit-targets always, visible chrome flag-OFF only). Already correct — leave as-is.
- **PageAnnotationLayer**: fabric constructors `:746`, `:913`; delete callback `:3901` (routes to PDFViewer).

When R2 reverses `:87` (shouldDeserializeAsFabricObject true for `.fabricObject` callouts), migrated rows
then load via the fabric path INTO annotationsByPage directly; the stored children are nominal-dim, so add
load-time re-projection from `fabricObject.data.legacyCallout` (or `legacyNormalizedCoords`) × measured
pageSize at that point (NOT needed before R2, since the backward-read shim routes through callouts[] today).

## CURRENT STATE — 2026-06-27 (all behind `calloutsInSharedStore()`, DEFAULT OFF; production untouched)
DONE + verified (flag-OFF byte-identical; flag-ON proven via agent-cli/callout-e2e.mjs):
- Conversion bridge (`calloutAnnotationBridge.js`) + `projectCalloutsIntoByPage` (single canonical projector).
- LOAD projection: local (PDFViewer) + cloud-hydration (useAnnotationDoc) → annotationsByPage.
- RENDER: shared SVG dispatch (`data.type==='callout'`); legacy loop emits hit-targets only under the flag.
- CREATE/EDIT/DELETE/SELECT: reactive `callouts[]`→annotationsByPage effect (draw renders instantly); interaction via kept legacy hit-targets; delete via gated `handleDeleteSelectedCallouts`. Persists across reload.
- WRITE-PATH GUARDS: `syncByPageToDoc` + `serializeAnnotationsByPage` exclude `data.type==='callout'` (render-projection never contaminates storage) — regression-tested.
- Pre-flip BLOCKERS 1+2 fixed. Dual-rep: `callouts[]` is the PERSISTED source of truth.

REMAINING before the flag can flip (highest-data-risk — treat carefully, fresh focus + the full adversarial gate):
- **Persistence switch (point D)** — make callouts persist via the shared annotation path (reverse the write-guard for callouts deliberately) AND **Phase 6 production data backfill** (existing calloutsList/document_callouts → annotation rows). This is the data-migration finale.
- **Phases 2/3/7 collapse** — they only truly fall out AFTER the persistence switch (delete-modal, undo delta lane, sync still legacy in dual-rep; only render/Phase-4 fell out so far).
- **Live-drag preview** under the flag (minor; positions commit correctly, just no per-frame preview).
- **≥2 fresh adversarial passes** on the whole flag-ON path, then flip the default.



Precise, file:line-anchored implementation spec for the keystone, behind a feature flag
(`calloutsInSharedStore`, default OFF). Foundation already landed: `src/utils/calloutAnnotationBridge.js`
(`calloutToAnnotationObject` / `annotationObjectToCallout`, round-trip verified <1px). Counter is the
template throughout (`data.type === 'counter'` → mirror as `data.type === 'callout'`).

## Feature flag
Mirror `src/lib/collab/snapshotFeatureFlag.js`: ON when `import.meta.env.VITE_CALLOUTS_SHARED_STORE === '1'`
OR `localStorage.getItem('__callouts_shared_store') === '1'`. Add `src/lib/calloutSharedStoreFlag.js`
exporting `calloutsInSharedStore()`. With flag OFF, every branch below falls through to today's behavior
(zero change → safe to land incrementally).

## Wiring points

### A. LOAD / deserialize (callout rows → state)
- `src/PDFViewer.jsx:18917-18918` — `setCallouts(loadedCallouts)`; source is `loadCallouts(id)` (viewerShared.js:1928, localStorage) or DB rows.
- `src/services/annotationCloudSync.js:701` — `deserializeRowToCallout(row)`.
- KEYSTONE: when flag ON, after producing `loadedCallouts`, also project each through
  `calloutToAnnotationObject(callout, pageSize)` and merge into `annotationsByPage[page].objects`.
  pageSize per page = the container-aware page-pixel size (CLAUDE.md: offsetWidth, not pageSize*scale).
  Keep callouts[] populated too during transition (dual-rep) UNTIL render+write are switched, then make
  annotationsByPage the source of truth and stop populating callouts[].

### B. RENDER (add data.type==='callout' to the shared dispatch)
- Counter dispatch branches: `src/components/SVGAnnotationLayer.jsx:1756`, `:3171-3172`, `:3192-3203`
  (`if (obj.data?.type === 'counter') element = renderCounter(obj, i)`).
- KEYSTONE: add sibling `if (obj.data?.type === 'callout') element = renderCallout(<adapted>, i)` at the
  same dispatch points. `renderCallout` (svgAnnotationRenderers.jsx, imported SVGAnnotationLayer:31) today
  takes a normalized callout; adapt it (or pre-convert via `annotationObjectToCallout`) to read the
  annotationsByPage object. When flag ON, RETIRE the separate `filteredCallouts` loop (~SVGAnnotationLayer:2824+)
  so callouts render only via the shared dispatch (no double-render).

### C. CREATE / EDIT (write into annotationsByPage instead of callouts[])
- Create sites: `src/PDFViewer.jsx:3677`, `:10417` (`setCallouts(prev => [...prev, newCallout])`);
  `src/PageAnnotationLayer.jsx:746 createCalloutObjects`, `:913 createCalloutGroup`, `:6851`.
- KEYSTONE: when flag ON, route new/edited callouts through `calloutToAnnotationObject` into
  `setAnnotationsByPage` (mirroring how a counter is added), not `setCallouts`.

### D. SYNC / SERIALIZE (already mostly free)
- `serializeFabricObjectToRow` + `fabricObjectToDbType` already map `data.type==='counter'` → 'counter' DB
  type (annotationTypeSerializers.js:146). Add the `callout` case so a `data.type==='callout'` annotation
  serializes via the shared path. Then the callout-specific upsert/realtime/Y.Map (Phase 7) can be retired.
- Backward-compat read: keep `deserializeRowToCallout` + the `document_callouts` read working so existing
  saved callouts still load (they get projected into annotationsByPage at load, point A).

## Order of implementation (each step safe with flag OFF)
1. Flag module (`calloutSharedStoreFlag.js`).
2. Render branch (B) — dormant until callouts exist in annotationsByPage; add `data.type==='callout'` dispatch.
3. Load projection (A) — flag ON projects loaded callouts into annotationsByPage; verify RENDER via harness.
4. Create/edit (C) — flag ON writes new callouts to annotationsByPage; verify draw+render+persist via harness.
5. Serialize case (D) + retire callouts[] population; verify save→reopen round-trip.
6. Then phases 2/3/4/7 collapse (delete-modal, undo delta lane, sync) — callouts now flow through shared paths.

## Acceptance criteria (flag ON)
- `agent-cli/callout-e2e.mjs` passes: draw callout → renders → right-click delete → removed.
- Save → reopen: a drawn callout survives a document reopen, geometry within ≤1px (bridge round-trip).
- Existing pre-keystone saved callouts still load + render (backward-compat).
- Multi-user: collaborator cannot delete owner's callout (inherits canModify via the shared delete path).
- `npx vite build` + `node scripts/run-node-tests.mjs` green; full suite 0 fail.

## Rollback
Flag OFF restores today's behavior at every step. The keystone is not "done" until the flag is flipped ON
by default AND the above acceptance criteria pass via the harness.

## PRE-FLIP BLOCKERS (from ≥2 adversarial passes, 2026-06-27)
All LATENT — they only fire with the flag ON (default OFF), so production is unaffected. MUST be fixed
before the flag flips. Landed increments verified flag-OFF byte-identical (build + 1659 tests + harness).

- **BLOCKER 1 (HIGH, write-contamination) — must fix with the serialize increment.** Projected
  `data.type==='callout'` objects in `annotationsByPage` would be written into the Y.Doc `annotations`
  flat map by `syncByPageToDoc` (`src/services/annotationDocStore.js:~180`, called from
  `useAnnotationDoc.js:254`), AND serialized by the Supabase bulk push
  (`serializeAnnotationsByPage`/`serializeFabricObjectToRow` — `'callout'` is in `SUPPORTED_DB_TYPES`),
  duplicating the `calloutsList` META and overwriting the real `annotation_data.callout` row with a
  `fabricObject`-shaped row on the same `annotation_id` (→ dual-write-queue-jam corruption).
  FIX: filter `obj?.data?.type === 'callout'` out of `syncByPageToDoc` AND the Supabase push, mirroring
  the existing CRDT fan-out gate `CRDT_FAN_OUT_EXCLUDED_TYPES` (`annotationSyncType.js:13`), UNTIL the
  serialize path is fully switched to the shared callout representation (then re-enable deliberately).
- **BLOCKER 2 (MED, stale pageSize on first paint).** The initial durable-wins hydration fires before
  `pageSizes` is measured (`pageSizesRef.current = {}`), so callouts project at the US-Letter fallback —
  correct for Letter docs, WRONG first-paint position on non-Letter pages (self-corrects on next sync).
  FIX: re-project when `pageSizes` first becomes available (mirror PDFViewer's local point-A retry).
- **MINOR:** `projectCalloutsIntoByPage` line ~105 should `return next` (not `byPage`) for unconditional
  ghost-cleanup; the `catch` stays `return byPage` (safety net). `id == null` callouts bypass dedup
  (upstream data issue, not introduced here).
- **MINOR (eraser ghost mask, found 2026-07-14 unified-renderer parity review):** with the flag ON,
  whole-erasing a callout won't ghost from the eraser live preview —
  `eraseAtomicObjectsFromPreview` (`src/components/FabricEraserCanvas.jsx`) paints its destination-out
  mask via `paintAnnotationCanvas`, whose `drawAnnotationObject` skips `data.type==='callout'`
  projections (they live in the `callouts[]` pipeline). The deleted callout stays visible until the
  commit repaint. Flag-OFF behavior unaffected. FIX before flip: route projected callouts through the
  mask's `callouts` path (or stop skipping them for mask paints).

After these fixes: re-run ≥2 adversarial passes + harness flag-ON before flipping.

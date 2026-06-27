# Keystone Wiring Spec (Phase 5) — callouts[] → annotationsByPage

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

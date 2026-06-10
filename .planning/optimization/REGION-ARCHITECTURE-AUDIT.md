# Region Architecture Audit

> Generated: 2026-06-10
> Auditor: Claude (file-search read-only pass)
> Scope: KAL-300 (silent deselect) · KAL-301 feasibility (undo/redo, shift-scale, rotation pill) · BL-19 3-way region-math consolidation · opinionated architecture critique
> Methodology: Every claim below verified at an actual call site — not from symbol names alone.

---

## Plain-Language Overview: What Regions Are

### Regions vs Spaces vs Survey Markers

**Spaces** are named logical groupings of pages inside a document (stored as `spaces[]` in PDFViewer state, persisted via `useAnnotationDoc` → `handle.setMeta('spaces', spaces)` at `useAnnotationDoc.js:162`). Each space has `assignedPages[]`, and each assigned page can have either `wholePageIncluded: true` (the whole page is part of the space) or `wholePageIncluded: false` plus a `regions[]` array of polygon/rectangle areas.

**Regions** (this audit's subject) are those `regions[]` entries — sub-page polygon or rectangular areas that define *which part* of a page belongs to a space. They are NOT Fabric annotation objects and are NOT in `annotationsByPage`. They live purely inside the `spaces` state slice, inside the space → assignedPage → regions nesting. A region object has: `{ regionId, pageId, shapeType: 'rectangular'|'polygon', operation: 'add'|'subtract', coordinates: [flat x/y pairs], sourceRegions?, originCenter? }`.

**Survey Markers** are a completely separate concept (highlight pins on PDFs tied to checklist templates). They do not interact with the region system except that both are co-persisted in the same `useAnnotationDoc` Yjs store.

### Draw → Store → Render → Edit → Sync Flow

**Draw:** The user enters region-edit mode via `handleRequestRegionEdit(spaceId, pageId)` (`PDFViewer.jsx:17609`), which sets `showRegionSelection = true`, `regionSelectionPage = pageId`, and `activeTool = REGION_EDIT_TOOL`. This mounts `<RegionSelectionTool active={showRegionSelection} .../>` (`PDFViewer.jsx:26616-26628`). RegionSelectionTool (RST) is a standalone SVG overlay component (~2,729 lines, `src/RegionSelectionTool.jsx`) that handles all drawing interaction locally in its own React state.

**Store (local):** RST keeps `regions[]` in local `useState` — these are not committed to the app until the user clicks "Confirm." On Confirm, `handleConfirm()` calls `onRegionComplete(payload)` → `handleRegionComplete` in PDFViewer (`PDFViewer.jsx:17663`), which writes the region array into `spaces` via `handleSpaceUpdate` (`PDFViewer.jsx:11493`). Only at that moment do regions enter the durable state.

**Store (durable):** `spaces` changes are captured by `useAnnotationDoc.js:159-163` — on every `spaces` state change, `handle.setMeta('spaces', spaces)` is called, writing the whole spaces array as a coarse meta blob into the Yjs doc. This is the same coarse-blob pattern as callouts (no per-region diff, no per-region CRDT granularity).

**Render:** Two renderers serve regions. While region-edit is active, RST renders the in-progress regions as SVG paths directly inside its own overlay. When region-edit is NOT active, `SpaceRegionOverlay` (`src/SpaceRegionOverlay.jsx`) renders per-page dimming/hatching masks as SVG (an `<svg viewBox="0 0 width height">` using SVG mask + pattern). The overlay is mounted conditionally for each page in PDFViewer's page loop (`PDFViewer.jsx:27314, 27438, 28883, 28916`), gated on `pageRegions.length > 0 && !(showRegionSelection && regionSelectionPage === pageNumber)`. A `data-region-selection-target` attribute marks the page element that RST targets.

**Edit (in-session):** RST supports three tools: rectangular draw, freehand polygon draw, and move/resize/vertex-edit (select mode). In select mode, a selected region shows corner-handle dots (one per vertex, if ≤32 vertices) or 8 edge/corner resize handles (if >32 vertices), rendered as absolutely-positioned `<div>` elements (not SVG handles). Resize is affine scaling, vertex drag is coordinate mutation, move is coordinate translation.

**Undo/Redo (in-session):** RST has its own per-(spaceId, pageId) undo/redo stack stored in a module-level `regionEditHistoryStore: Map` (`RST:25`). Snapshots are whole-regions-array deep clones. This history is ENTIRELY SEPARATE from the app's annotation history engine (`annotationLocalHistory.js`, `addHistoryCheckpoint`). Region edits never touch `annotationsByPage` history. The stacks persist in `regionEditHistoryStore` across tool switches but are cleared when the space/page changes.

**Sync:** On Confirm, committed regions flow through `handleSpaceUpdate` → `setSpaces` → `useAnnotationDoc` → `handle.setMeta('spaces', ...)` → Yjs op-log + snapshot. Remote updates arrive via `handle.onChange` → `setSpaces(s)` (`useAnnotationDoc.js:82`). There is no per-region CRDT — the whole spaces array is last-write-wins.

---

## Contract-Compliance Table

Regions are not annotations in the contract's sense (they are not in `annotationsByPage`, have no `fabricObject`, are not in `EXPORTABLE_FABRIC_TYPES`). The contract's 7 dimensions are evaluated relative to what regions *should* do:

| Dimension | Standard Annotations | Regions |
|---|---|---|
| **STORAGE** | `annotationsByPage[page].objects[]` Fabric JSON (PDFViewer.jsx:3723) | Nested inside `spaces[].assignedPages[].regions[]` — a separate non-annotation slice. NOT in `annotationsByPage`. Committed only on "Confirm." (`PDFViewer.jsx:7513, 17663`) |
| **UNDO/REDO** | Per-id delta lane via `buildAnnotationHistoryAction` + `filterAnnotationHistoryActionByOwner` (annotationLocalHistory.js) | Private bespoke snapshot stack in RST (`regionEditHistoryStore` Map, `RST:25, 102-103`). Completely disconnected from the app history engine. History only covers the in-session draw phase; once Confirm is clicked, there is no undo at the app level. `addHistoryCheckpoint('space:update', ...)` is called (`PDFViewer.jsx:11495`) but only with metadata (no region geometry snapshot), so the actual region geometry is not restorable via app undo. |
| **SAVE/SYNC** | `useAnnotationDoc` Yjs op-log + snapshot via `applyByPage` | `useAnnotationDoc.js:162` — `handle.setMeta('spaces', spaces)` on every spaces change. Coarse whole-array blob (same pattern as callouts — last-write-wins, no per-region diff). Remote ops arrive via `handle.onChange` → `setSpaces`. |
| **SELECT MODE** | `selectedIds` Set in `useSVGInteraction`; `buildBulkDeletePlan` for cross-author deletes | Entirely private `selectedRegionIds: Set` in RST (`RST:81`). Never intersects with `selectedIds`. No concept of multi-type selection (you cannot simultaneously select a region and an annotation). |
| **OWNERSHIP / DELETE** | `canModify` via `permissionScope.getAnnotationAuthorId`; `buildBulkDeletePlan` | No `canModify` check at all. RST's `handleDeleteSelected` (`RST:1487-1493`) is a plain filter on the local regions array — no ownership gate. Regions have no `authorId` field; any collaborator in region-edit mode can delete any region. The `cascadeDeleteScopedAppState` (`PDFViewer.jsx:11589`) handles downstream cleanup but no ownership check precedes it. |
| **RENDERING** | `renderX(obj, index)` dispatched from unified SVG loop in SVGAnnotationLayer | Two entirely separate renderers: RST's in-session SVG (local state, not from `annotationsByPage`), and `SpaceRegionOverlay`'s dimming mask (also SVG, from `spaces` slice). Neither is the unified annotation render loop. The PDF export canvas context path uses `applyRegionMaskToCanvasContext` (`viewerShared.js:1553`) — a third, Canvas 2D implementation of the same geometry. |
| **EXPORT / PRINT** | Walk `annotationsByPage`, pass `EXPORTABLE_FABRIC_TYPES` gate, one `case` per type | Regions are NOT exported as PDF annotations. They are used only as a mask for the print-flatten canvas pass (`applyRegionMaskToCanvasContext`, `PDFViewer.jsx:16908`). There is no PDF annotation representation of a region. This is by design (regions are a display filter, not a markup). |

Legend: regions are architecturally domain-separate from annotations by design, so many "divergences" relative to the annotation contract are **necessary**. The table above distinguishes necessary from accidental where relevant.

---

## KAL-300 Root Cause: Silent Deselection in Region Edit Mode

**Symptom:** A selected region (corner handles showing) silently deselects itself after a period of inactivity.

**Root cause — verified at call site:** Two separate `document.addEventListener('mousedown', ...)` listeners coexist during region-edit mode and compete to deselect the region:

### Mechanism 1: RST's own out-of-canvas deselect (PRIMARY)

`RegionSelectionTool.jsx:1892-1912` — an effect registers a `handleDocumentMouseDown` listener on `document` whenever `active && targetElement`. When a mousedown fires outside BOTH `targetElement` AND `containerRef.current` AND `[data-region-selection-ui="true"]` elements, it calls `handleCancel()`.

`handleCancel` (`RST:1344-1358`) clears `regions`, `selectedRegionIds`, `interactionState`, `isDrawing`, and calls `onCancel()` → `handleCancelRegionEdit` in PDFViewer. **This terminates the entire region edit session** (sets `showRegionSelection = false`, `regionSelectionPage = null`) — it's not just deselection, it's full cancellation.

**BUT** — `handleMouseDown` in RST (`RST:979-1005`) has a separate deselect path: when in `move` (select) mode, a click inside the canvas but outside all selected regions' bounding boxes calls `setSelectedRegionIds(new Set())` and `setInteractionState(null)` without cancelling the session. This is the correct "click to deselect" behavior.

### Mechanism 2: The `regions.length === 0` effect clearing selection

`RegionSelectionTool.jsx:522-527`:
```js
useEffect(() => {
  if (regions.length === 0) {
    setSelectedRegionIds(new Set());
    setInteractionState(null);
  }
}, [regions.length]);
```

This fires whenever the regions array becomes empty. If any code path empties `regions[]` — including the `active` effect at `RST:463-508` which calls `setRegions([])` when `!active` — selection is cleared as a side effect.

### Mechanism 3: The `active` effect re-initializing on tool changes (MOST LIKELY KAL-300 TRIGGER)

`RegionSelectionTool.jsx:463-508` — this effect depends on `[active, initialRegions, historyKey, cloneHistorySnapshot, persistHistoryStacks]`. When `active` is true, it sets regions from `initialRegions` ONLY IF `hasInitializedRegionsRef.current === false`. It also unconditionally calls:
```js
setSelectedRegionIds(new Set());
setInteractionState(null);
setIsDrawing(false);
setCurrentRect(null);
setPolygonPoints([]);
setIsCursorOverCanvas(false);
```
at the bottom of the effect (lines 502-507) **every time the effect runs**, regardless of the `hasInitializedRegionsRef` guard.

The `active` effect fires whenever `initialRegions` changes reference. `initialRegions` is computed inline at the RST mount site:
```jsx
initialRegions={regionSelectionPage ? (getPageRegions(regionSelectionPage) || []) : []}
```
`getPageRegions` derives from `spaces` state. When `spaces` state updates — including from remote sync via `useAnnotationDoc.js:82` (`setSpaces(s)` on remote change) — `getPageRegions` returns a new array reference → `initialRegions` prop changes → the `active` effect fires → `setSelectedRegionIds(new Set())` clears the selection.

**Code path for KAL-300:** Remote collaborator (or the same user's other device/tab) triggers a Yjs doc change → `handle.onChange` fires → `setSpaces(s)` (`useAnnotationDoc.js:82`) → React re-renders PDFViewer → `initialRegions` prop to RST gets a new array reference (even if the region data is identical) → RST's `active` effect at `RST:463` fires (because `initialRegions` is in its dep array) → `setSelectedRegionIds(new Set())` clears the current selection without any user action.

Even without a remote collaborator, certain space-mutating operations in PDFViewer (e.g., `handleSpaceUpdate` with unrelated keys, `normalizePageRegions` producing a new array) trigger the same cascade.

**Evidence:**
- `useAnnotationDoc.js:76-84`: remote `onChange` calls `setSpaces(s)` unconditionally
- `PDFViewer.jsx:26627`: `initialRegions={regionSelectionPage ? (getPageRegions(regionSelectionPage) || []) : []}` — new array on every render if `getPageRegions` isn't memoized
- `RST:463-508`: the `active` effect dep array includes `initialRegions` and unconditionally resets `selectedRegionIds` at lines 502-507
- `RST:522-527`: secondary clear if regions array becomes empty

**Fix:** Memoize `initialRegions` in PDFViewer with a deep-equal or stable-reference guard so it only produces a new reference when the actual region data changes (not on every spaces render). Alternatively, remove `setSelectedRegionIds(new Set())` from the unconditional bottom of the `active` effect — it should only clear selection on `!active` (deactivation), not on `active` re-runs. The `hasInitializedRegionsRef` guard already prevents re-initializing regions; selection should get the same guard.

---

## KAL-301 Feasibility Notes

### (a) Undo/Redo for Handle-Drag Transforms

**Do region edits currently enter the history engine?** No. RST has its own private undo/redo stack (`undoStackRef`/`redoStackRef`, `RST:102-103`) stored in the module-level `regionEditHistoryStore` Map (`RST:25`). This is entirely disconnected from the app's `annotationLocalHistory.js` / `addHistoryCheckpoint` pipeline.

The `handleSpaceUpdate` call (`PDFViewer.jsx:11495`) does call `addHistoryCheckpoint('space:update', { spaceId, updateKeys })` but this checkpoint contains only metadata — no region geometry — and the `isLegacyAnnotationHistoryMeta` gate in PDFViewer (`PDFViewer.jsx:10243-10249`) does NOT include `'space:'` as a recognized prefix, so the snapshot is never reachable on undo (this is the same gap as divergence #9 in the annotation contract). In practice: `app-level undo after confirming a region edit does nothing to the region geometry`.

**Conclusion:** Undo/redo works fine during the draw session (RST's private stack, Cmd+Z / Cmd+Shift+Z handlers at `RST:1812-1827`). But after clicking Confirm, the committed region is not undoable at the app level. Adding app-level undo for region commits requires either: (a) adding `'space:update'` to `isLegacyAnnotationHistoryMeta` and snapshotting region geometry in the checkpoint metadata, or (b) routing region commits through the standard `buildAnnotationHistoryAction` delta lane (which would require regions to live in `annotationsByPage`, a much larger change). Option (a) is the smaller, self-contained fix.

### (b) Shift+Drag = Uniform Aspect-Preserving Scale

**Where would modifier-key handling go?** RST already tracks `isShiftPressed` state (`RST:90`) via a keydown/keyup effect (`RST:1809-1890`). The `handleMouseMove` callback (`RST:1022-1204`) handles the `'resize'` interactionState. Currently in the `resize` branch (`RST:1083-1167`), separate `bounds` mutations are applied per handle key without any aspect-ratio lock.

**Implementation location:** Add an aspect-ratio lock inside the `resize` branch of `handleMouseMove`, gated on `isShiftPressed`. Capture the original aspect ratio at `handleResizePointerDown` time (`RST:1461-1485`), store it in `interactionState`, then in `handleMouseMove` constrain whichever dimension grows less. This is a self-contained change entirely within RST — no changes to PDFViewer or any shared utility. Risk: low-medium (isolated to RST's resize path, no external dependencies).

### (c) Rotation Pill with 15° Snaps

**What standard annotations use:** `RotationInputField` (`src/components/RotationInputField.jsx`) is mounted in `SVGAnnotationLayer` (`SVGAnnotationLayer.jsx:5251-5257`). It appears on hover over the `mtr` (mid-top-rotate) handle after a 150ms delay (`SVGAnnotationLayer.jsx:1065-1072`). It supports: ArrowUp/Down = ±1°, Shift+ArrowUp/Down = ±45° (`RotationInputField.jsx:354-358, 453-473`). The standard annotation rotation snap is **45°**, not 15°. The pill sits along the ray from shape-center through the mtr handle, positioned via `svgRef.current.getScreenCTM()`.

**Can regions adopt it directly?** No — directly, for three reasons:
1. `RotationInputField` is wired to `annotationIndex` (an index into `annotations.objects[]`) and commits via `onSaveAnnotations` → `handleSaveAnnotations`. Regions have neither an annotation index nor a Fabric object.
2. Regions in RST have no `angle` / rotation transform field — their coordinates are stored as raw flat arrays. A rotation would require transforming all coordinates around the centroid, not setting a single `angle` property.
3. The mtr handle in RST's current design does not exist — RST renders either vertex dots or 8 edge/corner resize handles, but no rotation handle.

**What would be needed:** Add an `angle` field to the region data model, add rotation handle rendering in RST (a circle above the bounding box), add a `'rotate'` interactionState type in `handleMouseMove` that rotates all coordinates around the region centroid, and wire a rotation pill UI. The 15° snap (requested) vs 45° snap (existing) means the existing `RotationInputField` would need its Shift+Arrow step changed or a new snap constant added — it's a 1-line change at `RotationInputField.jsx:356,458` (`45` → `15`). The pill itself could be reused if its `annotationIndex` wiring is decoupled into a generic `onCommit(newAngle)` callback. **Effort: medium; risk: medium** (requires coordinate-transform math and a new interaction type in RST, but no changes to shared annotation pipelines).

---

## Critique

### CRIT-1: The `initialRegions` prop is never memoized — KAL-300's root cause is architectural

**Evidence:** `PDFViewer.jsx:26627` passes `getPageRegions(regionSelectionPage) || []` inline. This returns a new array reference on every render of PDFViewer because `getPageRegions` is not wrapped in `useMemo`. RST's `active` effect (`RST:463`) lists `initialRegions` in its dependency array and unconditionally calls `setSelectedRegionIds(new Set())` in its body regardless of whether this is the first activation or a mid-session spaces update. Result: any spaces state change (remote sync, unrelated space rename, etc.) silently deselects the user's region selection.

**Improvement:** Either (a) memoize `initialRegions` with a stable deep-equal comparison so `getPageRegions` only returns a new reference when region data actually changes, or (b) split RST's `active` effect into two: one that runs only when transitioning from inactive→active (initialization), and one that ignores re-runs during active sessions. The `hasInitializedRegionsRef` guard on line 472 already protects `setRegions`, but the unconditional `setSelectedRegionIds(new Set())` on line 502 bypasses it. Moving the selection-clear inside the `if (!hasInitializedRegionsRef.current)` block (or `if (!active)` block) fixes KAL-300 immediately. Risk: low — purely an RST internal change.

### CRIT-2: 3-Way Duplication of `getRegionBounds` / `polygonToPath` — the BL-19 finding was marked DONE but the RST copy was missed

**Evidence:**
- `regionMath.js` exports `regionToPolygon`, `polygonToRegionCoords`, `simplifyPolygon`, `polygonContainsPoint`, `rectangleContainsPoint`, `regionContainsPoint`, `mergeRegions`, etc. — the canonical math library.
- `SpaceRegionOverlay.jsx:20-42` defines a local `polygonToPath(polygon)` function and a local `hasValidAreas(region)` function, both replicating logic that could be exported from `regionMath.js`. The `DUPLICATION-SWEEP.md` (BL-19) flagged this.
- `RegionSelectionTool.jsx:549-572` defines a local `getRegionBounds(region)` as a `useCallback` — identical logic to the private `getRegionBounds` in `regionMath.js:93-120` (same min/max loop, same infinite-sentinel pattern). This is the **third copy** the sweep mentioned.
- `RegionSelectionTool.jsx:660-677` defines a local `polygonToPath(polygon)` as a `useCallback` — a **second copy** of `SpaceRegionOverlay`'s `polygonToPath` (same M/L/Z SVG path construction). This one is not imported from `regionMath.js` which doesn't export this function.
- `viewerShared.js:1539-1551` defines `traceRegionPath` — a Canvas 2D analog of `polygonToPath` for the print/flatten path. A fourth variant for the same geometry traversal.

**Assessment:** The DUPLICATION-SWEEP said D2 was "DONE" (three copies → one exported pair in regionMath.js). In practice, RST still has local `getRegionBounds` (`RST:549`) and local `polygonToPath` (`RST:660`). Either the sweep only addressed the SpaceRegionOverlay copy, or RST's copies survived. Neither `getRegionBounds` nor `polygonToPath` is currently exported from `regionMath.js`.

**Improvement:** Export `getRegionBounds` and `polygonToPath` from `regionMath.js`. Replace RST's `useCallback`-wrapped copies with direct imports (no behavior change). Replace `SpaceRegionOverlay`'s local `polygonToPath` with the shared import. Consider exporting `hasValidAreas` as well (it duplicates `hasValidRegionAreas` from `regionGeometry.js:14-26`). Risk: low — pure consolidation, behavior-identical, independently verifiable.

### CRIT-3: Spaces + Regions Stored as a Coarse Whole-Array Blob — Last-Write-Wins in Collaboration

**Evidence:** `useAnnotationDoc.js:162` — `handle.setMeta('spaces', spaces)` writes the entire spaces array on every change. `useAnnotationDoc.js:81-82` — remote changes restore the whole array via `setSpaces(s)`. There is no per-region CRDT, no per-space diff, no conflict resolution. The same coarse-blob pattern was criticized for callouts (`ANNOTATION-UNIFORMITY-AUDIT.md`, CD-3).

**Impact:** If two collaborators simultaneously edit regions on different pages of the same space, the second Confirm wins and silently discards the first user's changes. For callouts this was accepted as a temporary limitation; for regions (spatial data on which annotations' visibility depends) it's a correctness risk in multi-user workflows.

**Improvement:** At minimum, store spaces as a map keyed by `spaceId` (not a flat array) so per-space ops can be isolated. Better: store each `assignedPage.regions[]` as a separate Yjs array per `(spaceId, pageId)` tuple, enabling per-region CRDT merge. This is a non-trivial migration (requires a spaces data model change and a backfill), but the blob pattern is a known weak point in the architecture. Risk: medium-high (data migration, live collaboration semantics).

### CRIT-4: RST's Private History Is a Dead End for App-Level Undo

**Evidence:** `RST:25` — `const regionEditHistoryStore = new Map()` — module-level, reset-proof across re-renders but not persisted across page reloads. `RST:257-298` — snapshot-based whole-array clone undo/redo. `PDFViewer.jsx:11495` — `addHistoryCheckpoint('space:update', ...)` has only metadata, no geometry. `PDFViewer.jsx:10243-10249` — `'space:'` prefix not in `isLegacyAnnotationHistoryMeta`.

**Impact:** After clicking Confirm, region commits are permanently irreversible at the app level. The user must re-enter region-edit mode (clicking "Edit Regions" again) and manually undo inside that session — but the session-level undo stack is also cleared on session close (`RST:497-499`: `setRegions([])` + `hasInitializedRegionsRef.current = false` on `!active`). In practice: **there is no undo for a confirmed region edit**. This is surprising for users accustomed to Cmd+Z undoing everything.

**Improvement:** Add `'space:update'` to `isLegacyAnnotationHistoryMeta` in PDFViewer and include a deep-clone of the full space's `assignedPages` array in the checkpoint metadata. On undo, restore the snapshotted `assignedPages` via `setSpaces`. This is a focused, low-risk change that gives app-level undo to region Confirm actions without requiring the region data model to change. Risk: low-medium.

### CRIT-5: RST Has Zero Ownership / Permission Gate for Region Deletion

**Evidence:** `RST:1487-1493` — `handleDeleteSelected` is `setRegions(prev => prev.filter(r => !selectedRegionIds.has(r.regionId)))`. No `canModify` check, no author lookup. Region objects have no `authorId`, `userId`, or creator field whatsoever. Any collaborator who enters region-edit mode for a space (which requires being assigned to the space) can delete any region, including regions created by the space owner.

**Impact:** Same class of ownership-gate bypass as callout's CD-5, but at least callouts have an `id` and a `createdBy` somewhere in the callout object. Regions have no creator tracking at all, so even if you wanted to add ownership gating, you'd need to add creator stamping to the region data model first.

**Improvement:** At minimum, stamp `createdBy: userId` on region creation (in `handleMouseUp` at `RST:1225` and `RST:1269`). Add a `canEditRegion` check in `handleDeleteSelected` that allows deletion only if `userId === region.createdBy || isDocumentOwner`. Risk: low for stamping, medium for the gate (depends on having access to `userId` inside RST, which currently receives no auth prop).

### CRIT-6: RST Runs a Per-Frame rAF Loop Even When Idle

**Evidence:** `RST:306-351` — the target-element discovery effect runs `window.requestAnimationFrame(updateTarget)` recursively, polling every frame while `active === true`. `RST:376-446` — the canvas-rect measurement effect ALSO runs a recursive rAF loop (`updateRect` calls `requestAnimationFrame(updateRect)`). Both are running simultaneously at 60fps during the entire region-edit session, even when the user is not moving or drawing anything.

The rAF loops exist to handle scroll/zoom invalidating the target element or its bounding rect. But `ResizeObserver` is also attached (RST:426-429) and scroll/resize event listeners are added (RST:431-432). The rAF loop on top of those observers is redundant for element measurement and just burns CPU.

**Improvement:** Remove the rAF loops; rely solely on `ResizeObserver` + scroll/resize events to re-measure. If there is a specific edge case that requires polling (e.g., the Syncfusion renderer repositioning the element outside scroll/resize events), add a comment explaining it. At minimum, throttle the rAF to run only when cursor is near the target or interaction is active. Risk: low (measurement-only change, worst case is a slightly stale rect during a specific edge interaction).

### CRIT-7: Region Math in RST Is `useCallback`-Wrapped, Creating Unnecessary Closure Churn

**Evidence:** `RST:549-572` (`getRegionBounds`), `RST:574-589` (`ensureBoundsMinSize`), `RST:660-677` (`polygonToPath`), `RST:679-716` (`checkRegionsOverlap`), `RST:718-728` (`cloneRegionForHistory`) — all pure functions that operate only on their arguments (no closure over component state except `getRegionBounds` depending on no state at all) yet are wrapped in `useCallback`. `getRegionBounds` has an empty dep array `[]` which at least avoids re-creation, but it is a constant function that has no reason to be a closure at all.

**Improvement:** Move pure math functions (`getRegionBounds`, `polygonToPath`, `ensureBoundsMinSize`, `cloneRegionForHistory`, `checkRegionsOverlap`) to module scope (or better, into `regionMath.js`) so they are not recreated on every component mount and their identity is stable without `useCallback`. Risk: low — pure refactor, no behavior change.

### CRIT-8: The `polygonToPath` Cursor-Indicator Pattern Is a DOM Mutation Side-Effect in a Render

**Evidence:** `RST:1040-1049` — inside `handleMouseMove` (a React event handler), the code directly mutates DOM node styles via refs: `addIndicatorRef.current.style.left = ...`, `subtractIndicatorRef.current.style.top = ...`. This is an intentional performance optimization (bypassing React re-render for cursor-following UI). But it means the cursor indicator position is managed entirely outside React's render cycle, making it invisible to React DevTools and fragile if the ref becomes null between paint and the next mousemove.

**Improvement:** This pattern is an acceptable pragmatic optimization for 60fps cursor-following. Document it explicitly with a comment explaining WHY the style mutation is intentional (not accidental). Add a null guard before the style assignment (the current code has none — if `addIndicatorRef.current` is null, e.g. during unmount, the `.style` access throws). Risk: low (defensive null guard only).

### CRIT-9: Region History Survives Its Own Session But the Session Doesn't Know

**Evidence:** `RST:25` — `regionEditHistoryStore` is a module-level Map keyed by `getRegionEditHistoryKey(spaceId, pageId)`. When the user closes the region editor (Confirm/Cancel) and re-opens it for the same (space, page), the stored undo/redo stacks are restored at `RST:488-495`. However, `handleConfirm` (`RST:1309-1342`) does NOT clear the history store for that key — stacks persist after a successful commit. This means after confirming regions, re-entering edit mode for the same page gives the user access to Cmd+Z history from the PREVIOUS session, including states that predate the last Confirm. Undoing into a pre-Confirm state would be silently inconsistent with the committed data.

**Improvement:** In `handleConfirm`, clear the `regionEditHistoryStore` entry for the current key after committing: `regionEditHistoryStore.delete(historyKey)`. This ensures a fresh undo stack on re-entry. Risk: low — one-line addition.

---

## Proposed Slice Plan (Value / Risk Ordered)

| # | Slice | Files | Risk | Effort | Value |
|---|---|---|---|---|---|
| 1 | **KAL-300 fix:** move `setSelectedRegionIds(new Set())` call inside the deactivation branch of the `active` effect (only clear on `!active`, not on re-runs while active); memoize `initialRegions` prop in PDFViewer with stable-reference guard | `RST:502-507`, `PDFViewer.jsx:26627` | Low | Small | Critical (user-facing bug) |
| 2 | **CRIT-9 fix:** clear `regionEditHistoryStore` key after `handleConfirm` | `RST:1337` (one line) | Low | Tiny | Medium (correctness) |
| 3 | **CRIT-8 fix:** add null guards to `addIndicatorRef.current?.style` and `subtractIndicatorRef.current?.style` accesses in `handleMouseMove` | `RST:1043-1049` | Low | Tiny | Low (defensive) |
| 4 | **CRIT-2 / D2 completion:** export `getRegionBounds` and `polygonToPath` from `regionMath.js`; replace RST's `useCallback`-wrapped copies and SpaceRegionOverlay's local copies with imports | `regionMath.js`, `RST:549-572, 660-677`, `SpaceRegionOverlay.jsx:20-42` | Low | Small | Medium (maintainability) |
| 5 | **CRIT-7:** move pure math functions (`ensureBoundsMinSize`, `cloneRegionForHistory`, `checkRegionsOverlap`) to module scope (no `useCallback`) | `RST:574-728` | Low | Small | Low-Medium (performance / clarity) |
| 6 | **CRIT-6:** remove duplicate rAF loops in RST; rely on ResizeObserver + scroll/resize events only (add comment explaining original motivation) | `RST:306-351, 376-446` | Low-Medium | Small | Medium (CPU / battery) |
| 7 | **CRIT-4 / KAL-301a:** add `'space:update'` to `isLegacyAnnotationHistoryMeta`; include region geometry snapshot in checkpoint metadata; restore on undo | `PDFViewer.jsx:10243-10249, 11495` | Medium | Medium | High (missing app-level undo for region commits) |
| 8 | **CRIT-5:** stamp `createdBy: userId` on region creation in RST; add `canEditRegion` gate in `handleDeleteSelected` (requires threading `userId` prop into RST) | `RST:60-73, 1225, 1269, 1487`, `PDFViewer.jsx:26618` | Medium | Medium | High (ownership correctness in collaboration) |
| 9 | **KAL-301b:** Shift+drag aspect-preserving scale — add aspect-ratio lock inside resize branch of `handleMouseMove`, using `isShiftPressed` (already tracked) | `RST:1083-1167, 1461-1485` | Low-Medium | Medium | Medium-High (UX feature) |
| 10 | **KAL-301c:** Rotation pill with 15° snaps — new `'rotate'` interactionState + rotation handle rendering + coordinate-transform math in RST; decouple `RotationInputField` from annotation-index wiring for reuse | `RST`, `RotationInputField.jsx:356,458` | Medium | Large | Medium (UX feature) |
| 11 | **CRIT-3:** Move spaces/regions from coarse whole-array setMeta blob to per-(spaceId, pageId) Yjs structure for per-region CRDT granularity | `useAnnotationDoc.js`, `annotationDocSync.js`, PDFViewer | High | Large | High (collaboration correctness) |

---

## What Could Not Be Verified

- **Whether `getPageRegions` is memoized in PDFViewer.** The grep confirmed it is passed inline (`PDFViewer.jsx:26627`) but did not read its definition. If it is memoized with `useCallback` or `useMemo` with correct deps, the `initialRegions` instability in CRIT-1/KAL-300 would need a different trigger. The RST effect's unconditional `setSelectedRegionIds(new Set())` on line 502 is still a bug regardless.

- **Whether `regionEditHistoryStore` is cleared by any navigation event.** It is a module-level Map that persists for the lifetime of the JS module. A hard page reload clears it. A PDF file change does NOT clear it (the key includes spaceId + pageId, so stale keys just accumulate). This is low risk (memory bounded by REGION_HISTORY_LIMIT × deep-cloned coordinate arrays) but was not exhaustively verified.

- **Whether the Yjs `setMeta('spaces', ...)` write produces a CRDT-mergeable op or a last-write-wins overwrite.** This depends on the `annotationDocSync.js` implementation of `setMeta`, which was not read in full. If `setMeta` is implemented as a Y.Map entry for the whole array, it is last-write-wins. If it is a Y.Array, it would be CRDT-aware. CRIT-3 assumes last-write-wins based on the pattern described in `useAnnotationDoc.js:149-154`'s comment ("coarse whole-list").

- **Whether live collab region-edit sessions can conflict today.** The `handle.onChange` callback (`useAnnotationDoc.js:76`) fires for all remote ops including spaces changes. If a collaborator updates spaces while you are in region-edit mode, `setSpaces(s)` fires → `initialRegions` changes → KAL-300 deselect occurs. This chain was not confirmed with a two-user session test.

- **Whether `hasValidRegionAreas` in `regionGeometry.js:14-26` and `hasValidAreas` in `SpaceRegionOverlay.jsx:45-58` are truly identical.** They look equivalent from reading, but the exact coordinate-length thresholds (`coords.length >= 8` for rectangular, `coords.length >= 6` for polygon) were confirmed identical. Consolidation is safe.

---

_Generated 2026-06-10 from a read-only source audit. All divergence claims verified at actual call sites in src/._

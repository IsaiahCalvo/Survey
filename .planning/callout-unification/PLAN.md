# Callout Unification Plan

**Status: PLAN — owner review required before implementation begins.**

---

## Executive Summary (non-technical)

The callout annotation tool — the one that draws a line from a point on the page to a text label — was built as a one-off feature before the rest of the annotation system was standardized. Today it stores its data in a completely separate place from every other tool (sticky notes, ink drawings, counters, etc.), uses its own save and sync logic, and ignores the ownership rules that prevent one user from deleting another user's work.

This plan brings callouts fully onto the same foundation that every other tool already uses. The practical outcomes are:

- **The delete bug is fixed first.** Right now, any collaborator can right-click a callout they did not create and delete it from the menu. The server stops the deletion from sticking, but the tool still disappears on their screen until they reload — a confusing experience. This gets fixed in Phase 1, before anything else.
- **Callouts gain proper multi-user safeguards.** The confirmation dialog that protects other people's annotations (currently shown for ink, counters, shapes) will now also appear for callouts.
- **Undo/redo will work the same way it does for every other tool.** Currently callout undo snapshots the entire document. After unification, undo will be surgical — only the changed callout is affected.
- **Real-time collaboration sync is simplified.** Callouts currently travel on a separate sync channel. They will be consolidated onto the shared channel.
- **Existing saved callouts are preserved.** All existing callout geometry (the arrow tip, the knee point, the text box position) is migrated carefully with a verified backfill script. A dedicated phase handles this with rollback support.
- **The leader-line geometry is never lost.** The arrow tip, knee, and text-box positions are the defining geometry of a callout. Every migration step explicitly preserves them in both coordinates and proportions.

No user-visible behavior changes are intended by this plan. Callouts will look and behave exactly as they do today. The changes are internal plumbing.

---

## Unified Target Architecture

Counter is the proven template. After unification, callouts mirror counter exactly:

| Dimension | Counter (model) | Callout (target) |
|---|---|---|
| State | `annotationsByPage[page].objects[]` | `annotationsByPage[page].objects[]` |
| Type discriminator | `obj.data.type === 'counter'` | `obj.data.type === 'callout'` |
| Coordinate system | page-pixel Fabric coords | page-pixel Fabric coords |
| Object shape | Fabric circle group JSON | Fabric group JSON (path + textbox children) |
| Text style | Fabric-native fields | Fabric-native fields (`fontWeight`, `fontStyle`, `underline`, `linethrough`) |
| Serialized key | `annotation_data.fabricObject` | `annotation_data.fabricObject` |
| Deserialize path | `deserializeRowsToAnnotationsByPage` | `deserializeRowsToAnnotationsByPage` |
| CRDT map | `getMap('annotations')` | `getMap('annotations')` |
| Sync push | shared fabric push effect | shared fabric push effect |
| Delete gate | `canModify` + `buildBulkDeletePlan` | `canModify` + `buildBulkDeletePlan` |
| Undo | local delta lane (`fabric:create/delete/update`) | local delta lane (`fabric:create/delete/update`) |
| Render | branch in `filteredAnnotations` memo | branch in `filteredAnnotations` memo |
| PDF export | `case 'callout'` in export switch | `case 'callout'` in export switch (keeps 3-ref array) |
| DB table | `document_annotations` | `document_annotations` (unchanged) |

### Leader-line geometry preservation contract

The three geometric points that define a callout — `arrowTip`, `knee`, and `textBoxPosition` (plus `textBoxWidth` and `textBoxHeight`) — MUST survive every migration step without perceptible shift. Today these are stored as 0-to-1 fractions of page dimensions. After migration they are stored as page-pixel coordinates inside a Fabric group. The conversion is:

```
x_px = x_frac * pageWidthPx
y_px = y_frac * pageHeightPx
```

The canonical page-pixel width is the Syncfusion/pdf.js page host `offsetWidth` (the container-aware measurement, not `pageSize.width * scale` — see CLAUDE.md Gotchas). The backfill script must use the same canonical value. A `data.legacyNormalizedCoords` backup field is written to every migrated row so the original fractions can always be recovered if needed.

---

## Phased Plan

Risk ordering: delete/permissions gap (live UX bug) → undo simplification → render unification → state/serialize keystone → data migration → sync/CRDT cleanup → dead-code removal.

Phases 1–4 are pre-keystone (no state shape change, no data migration). Phase 5 is the keystone (state + DB). Phases 6–8 are post-keystone cleanup.

Each phase is independently shippable and testable. Implementation does not begin until this plan is approved.

---

### Phase 1 — Close the Context-Menu Delete Gap

**Scope:** `PageAnnotationLayer.jsx` context-menu handler only. No state shape change.

**Why first:** This is the only live client-side UX bug. Collaborators can currently delete other users' callouts via right-click. Server-side RLS stops the DB deletion from succeeding, but the callout disappears from the UI until reload ("ghost restore"). Owners bypass the cross-author confirmation modal entirely from this path.

**Changes:**

1. In `PageAnnotationLayer.jsx`, replace `handleDeleteCalloutFromMenu` (`lines 3894–3900`) — the current implementation directly filters `callouts` state with no ownership check. Replace with a call to the `onDeleteSelectedCallouts` prop, which routes through `handleDeleteSelectedCallouts` in PDFViewer (already has `canModify` gating as of KAL-125).

2. Verify `onDeleteSelectedCallouts` is threaded as a prop all the way from PDFViewer → SVGAnnotationLayer → PageAnnotationLayer. Confirm or add the prop forwarding if missing.

3. `markCalloutRemovalIntent` is called automatically once the route goes through `handleDeleteSelectedCallouts` — no extra wiring needed.

**What this does NOT do:** It does not yet add the cross-author confirmation modal for the keyboard-delete path or the context-menu path. That modal comes in Phase 2.

**Rollback:** Revert the single handler change. No state or DB impact.

**Test/Verify:**
- T1: Two-user collab session. User B right-clicks User A's callout → delete. Callout remains visible on User B's screen (no ghost-restore). Confirm `document_annotations` row still exists.
- T2: User B right-clicks own callout → deletes successfully.
- T3: `npm test` passes. `npx vite build` passes.

---

### Phase 2 — Wire `buildBulkDeletePlan` for Callout Deletes

**Scope:** `PDFViewer.jsx` keyboard-delete path (`handleDeleteSelectedCallouts`). No state shape change.

**Why now:** The keyboard path already checks `canModify` but silently skips the confirmation modal that shapes get when a collaborator deletes all-their-own or an owner deletes cross-author. Also adds undo-toast parity with shapes.

**Changes:**

1. Inside `handleDeleteSelectedCallouts`, after the `canModify` filter produces `permittedIds`, call `handleRequestBulkDelete` with:
   - `candidateIds`: the permitted callout ids
   - `snapshotObjects`: the permitted callout objects (for `emitBulkTrashRows`)
   - `runDelete`: closure that does the existing `addHistoryCheckpoint('callouts:delete')` + `markCalloutRemovalIntent` + `setCalloutsIfPersistedChanged`

2. Audit `suppressBatchCheckpointsRef` count for mixed shape+callout delete path in `SVGAnnotationLayer.jsx` to ensure the checkpoint suppression count is still correct.

3. Solo-owner path: `buildBulkDeletePlan` returns `owner-own-only` → direct fire, no modal. Behavior identical to today. No regression for single-user documents.

**Rollback:** Revert the `handleRequestBulkDelete` call in `handleDeleteSelectedCallouts`. The pre-Phase-2 keyboard path (`canModify` guard only) is restored.

**Test/Verify:**
- T1: Owner selects collaborator's callout → Delete key → confirmation modal appears → cancel leaves callout, confirm removes it.
- T2: Solo-owner document → Delete key → no modal, immediate delete (same as today).
- T3: Mixed shape + callout select → Delete → both disappear in one undo step. Cmd+Z restores both.
- T4: `npx vite build` + `npm test` pass.

---

### Phase 3 — Undo/History Migration (pre-keystone wiring)

**Scope:** `PDFViewer.jsx` history checkpoint calls, `historyHelpers.js`, `calloutHistoryScope.js`. No state shape change yet — this is prep work so the undo engine is ready for Phase 5.

**Prerequisite:** Phase 5 (keystone) must be complete before the full undo migration can land. This phase performs only the safe pre-work: verifying the callout Fabric group carries `data.id` for the delta engine, and confirming `filterAnnotationHistoryActionByOwner` will handle callout author chains correctly.

**Pre-work changes (land now, before Phase 5):**

1. Confirm `calloutEditAdapter.toFabricGroup` stamps `data.id = callout.id` and `data.type = 'callout'` at the group root — so `getAnnotationHistoryId` can key it. If missing, add the stamp (one-line fix in `calloutEditAdapter.js`).

2. Confirm `filterAnnotationHistoryActionByOwner` resolves author via `meta.authorId` (not `__meta.authorId`). Audit `serializeCalloutToRow` to confirm callout rows always stamp `meta.authorId` (not only `data.authorId`). Fix the stamp location if inconsistent.

3. Add a deprecation-window guard in `isLegacyAnnotationHistoryMeta` (`historyHelpers.js:116`): keep the `reason.startsWith('callouts:')` branch tagged with a `// DEPRECATION: remove after Phase 5 ships` comment. This allows in-flight undo stacks from before Phase 5 to still replay correctly during the transition.

**Post-keystone changes (Phase 5 dependency — do not land early):**

4. Replace all six `addHistoryCheckpoint('callouts:*', ...)` calls with the standard `buildAnnotationHistoryAction` + `localAnnotationUndoRef` push that counter uses (automatic when callout create/update/delete goes through `handleSaveAnnotations`).

5. Remove `calloutHistoryScope.js` and its call sites in `handleUndo`/`handleRedo`.

6. Drop `callouts` field from `getHistorySnapshot` / `restoreHistoryState`.

7. Remove the `callouts:*` branch from `isLegacyAnnotationHistoryMeta` (one release after Phase 5 ships, to drain in-flight undo stacks).

**Rollback (pre-work):** Revert stamp additions and the comment-only guard change. No behavior change.

**Test/Verify (pre-work):**
- Unit: `calloutEditAdapter.toFabricGroup(sampleCallout, pageSize)` returns group with `data.id` and `data.type === 'callout'` at root.
- Unit: `filterAnnotationHistoryActionByOwner` with a callout group authored by user-A, requesting user-B → returns null. Same group, user-A requesting → returns action.

---

### Phase 4 — Render Unification (pre-keystone, SVGAnnotationLayer)

**Scope:** `SVGAnnotationLayer.jsx` `filteredAnnotations` and `filteredCallouts` memos. No state shape change.

**Why pre-keystone:** The render merge can happen now. The `else if (obj.data?.type === 'callout')` branch in `filteredAnnotations` fires for no items today (callouts are not yet in `annotationsByPage`). It is safe dead code at this stage. The second-pass append of existing `callouts[]` consolidates two memos into one, reducing dependency array complexity.

**Changes:**

1. Add `else if (obj.data?.type === 'callout')` branch inside the `filteredAnnotations` useMemo, after the counter guard. This branch calls `renderCallout` with page-pixel coords from the Fabric group (it fires zero times until Phase 5 ships).

2. Append a second loop at the bottom of `filteredAnnotations` iterating over `callouts` (still passed as a separate prop pre-keystone). This loop replicates what `filteredCallouts` does today. Merge dependency arrays.

3. Remove the `filteredCallouts` useMemo. Remove `{filteredCallouts}` from SVG JSX. The `filteredAnnotations` output now covers all types.

4. Thread `editingCalloutId`, `liveCalloutEditBounds`, `liveBoundsForCallout`, `skipAutoRoute`, `activeCalloutDrag`, `inverseScale`, callout pointer handlers, and hit-target wrapper into the merged memo deps. These are already in component scope.

5. Delete the `loadCalloutAnnotation` dead branch in `FabricEditCanvas.jsx` (lines 1826–1827) and its backing function if unused.

**Leader-line preservation note:** `renderCallout` converts normalized coords to page pixels internally via `pageSize`. This call path is unchanged. The geometry transform code is not touched in this phase.

**Rollback:** Revert the memo merge in `SVGAnnotationLayer.jsx`. The `filteredCallouts` memo is restored. The dead `filteredAnnotations` branch is removed.

**Test/Verify:**
- Callout render: create callout, ink, counter, freetext on same page → all render correctly.
- Zoom in/out → leader-line and hit targets scale correctly.
- Group-select callout + shape → drag → both translate in lockstep.
- Space/filter visibility toggle → callout disappears when hidden.
- `node scripts/run-node-tests.mjs` passes (includes `calloutRenderer.test.mjs`).
- `npx vite build` passes.

---

### Phase 5 — Keystone: State + Serialize Migration (callouts[] → annotationsByPage)

**This is the highest-risk phase. It must not be rushed.**

**Scope:** State shape change (`callouts[]` state atom removed), serializer unification, DB write path change. No DB data change yet (that is Phase 6).

**Prerequisite:** Phases 1–4 complete.

#### 5a — Coordinate converter (isolated utility, testable before any wiring)

Write `convertCalloutToFabricGroup(callout, pageWidthPx, pageHeightPx) → fabricGroupJSON`:
- Input: saved callout plain-object with normalized 0-1 coords.
- Output: Fabric group JSON with `data.type = 'callout'`, `data.id = callout.id`, leader-line path child and textbox child in page-pixel coords.
- Text-style mapping: `bold: true → fontWeight: 700`, `italic: true → fontStyle: 'italic'`, `underline` keeps name, `strikethrough → linethrough`.
- Font family: normalize to a single font name (strip any CSS fallback stacks per CLAUDE.md 2026-04-08 gotcha). E.g. `'Inter, Arial, sans-serif'` → `'Arial'`.
- Write `data.legacyNormalizedCoords: { arrowTip, knee, textBoxPosition, textBoxWidth, textBoxHeight }` onto the group for recovery.

Write the reverse: `convertFabricGroupToCallout(fabricGroup, pageWidthPx, pageHeightPx) → calloutShape` (needed by the edit adapter and legacy read path).

Unit-test both functions with known dimensions before any other wiring.

#### 5b — Backward-read guard in deserializer

Before removing the callout bypass entirely, replace the hard `return false` in `shouldDeserializeAsFabricObject` with:

```js
if (row.annotation_type === 'callout') {
  // schemaVersion 2+ rows have fabricObject; legacy rows have callout key (pre-migration)
  return Boolean(row.annotation_data?.fabricObject);
}
```

This allows the app to read both old rows (pre-Phase 6 backfill) and new rows (post-Phase 6 backfill) during the transition window. Old rows still fall through to `deserializeRowsToCallouts` unchanged. New rows go through `deserializeRowToFabricObject` and land in `annotationsByPage`.

#### 5c — Switch the CREATE and UPDATE write path

In `PageAnnotationLayer.jsx`, change callout creation:
- Call `convertCalloutToFabricGroup(callout, containerEl.offsetWidth, containerEl.offsetHeight)` to produce a Fabric group.
- Commit via `onSaveAnnotations(pageNumber, fabricGroupJSON, saveContext)` — the same path counters use.
- Remove the `onSaveCallouts` / `setCallouts` call.

Same change for the update path.

#### 5d — Remove `callouts[]` from PDFViewer state

- Delete `const [callouts, setCallouts] = useState([])`.
- Every `callouts.filter(...)` read becomes `annotationsByPage[pageNum]?.objects?.filter(o => o.data?.type === 'callout') ?? []`.
- Every `setCallouts(...)` write becomes `setAnnotationsByPage(...)` on the appropriate page.
- Remove `callouts` from `getHistorySnapshot` / `restoreHistoryState`.

#### 5e — Update edit entry to read from annotationsByPage

`handleRequestCalloutEditMode`: change `callouts.find(c => c.id === calloutId)` to read from `annotationsByPage[pageNum].objects.find(...)`. The `toFabricGroup`/`fromFabricGroup` adapter functions stay but now work in page-pixel coords directly (no normalization needed when the source is already a Fabric group).

#### 5f — Add Phase 3 post-keystone undo wiring

Apply Phase 3 items 4–6 (the post-keystone undo changes that were deferred).

**Leader-line preservation note:** The `data.legacyNormalizedCoords` field written in 5a allows any callout created during or after Phase 5 to have its original geometry recovered if a coordinate precision issue is found post-deploy.

**Rollback plan:** Phase 5 is the only phase with a true rollback concern. The backward-read guard in 5b means the serializer can safely revert to the pre-Phase-5 state without data loss — old rows still read via the legacy path. Revert steps: restore `callouts[]` state, restore `setCallouts` write paths, restore the hard `return false` in `shouldDeserializeAsFabricObject`. No DB changes to roll back (Phase 6 is separate).

**Test/Verify:**
- Create a callout on page 2. `annotationsByPage[2].objects` contains a group with `data.type === 'callout'`. Hard-reload → callout reappears without coordinate shift.
- `document_annotations` has exactly one row with `annotation_type = 'callout'`, `annotation_data.fabricObject` set, `annotation_data.callout` absent.
- Existing pre-migration callouts (still `annotation_data.callout` rows) load correctly via the legacy fallback path.
- `npm test` + `npx vite build` pass. Run `render-smoke.mjs` (see Test Strategy section).

---

### Phase 6 — Data Migration: Backfill Existing Callout Rows

**Scope:** One-time DB backfill. All callout rows in `document_annotations` currently store `annotation_data.callout` (normalized 0-1 coords). This phase converts them to `annotation_data.fabricObject` (page-pixel Fabric group JSON) in-place.

**Prerequisite:** Phase 5 must be complete and verified in staging.

**Steps:**

1. **Pre-flight audit (no writes):** Query `SELECT COUNT(*), document_id FROM document_annotations WHERE annotation_type = 'callout' GROUP BY document_id`. Confirm all rows have `annotation_data.callout` (no hybrid rows). Count affected rows and documents. Record as backfill scope.

2. **Page-dimension sourcing:** The converter needs `pageWidthPx` and `pageHeightPx`. Source from `document_pages` table if it exists, or from PDF metadata. If dimensions are unavailable for a document, write a `data.backfillStatus: 'pending-dimensions'` marker and skip — do not leave partially-converted rows. Log skipped documents for manual follow-up.

3. **Backfill script (run against survey-test first):**
   ```
   For each callout row:
     1. Read annotation_data.callout
     2. Normalize fontFamily (strip fallback stacks)
     3. Convert via convertCalloutToFabricGroup(callout, pageWidthPx, pageHeightPx)
     4. Write data.legacyNormalizedCoords with original fraction values
     5. Build new annotation_data: { fabricObject: <group>, pageNumber, schemaVersion: 2, clientSessionId: null }
     6. UPDATE row: annotation_data = new value, updated_at = now()
     7. Keep annotation_id, user_id, last_modified_by, page_number unchanged
     8. Recompute bounds via computeBounds(fabricGroup) → update bounds column
   ```

4. **Verify backfill on survey-test:** Load 5 documents in the app. For each, open a page with callouts. Visually compare position, size, and text against a pre-migration screenshot. Acceptable tolerance: ≤1px at reference zoom. Confirm undo/redo still works. Confirm PDF export geometry is unchanged.

5. **Production run:** Run the same script against production (Survey project). Monitor for errors. After completion, confirm the app reads all callouts from `annotation_data.fabricObject`.

6. **Close the backward-read guard (deferred — one release after backfill):** Once all rows are confirmed migrated (no `annotation_data.callout` rows remain), remove the legacy path from `shouldDeserializeAsFabricObject`. Remove `deserializeRowsToCallouts`, `deserializeRowToCallout`, `serializeCalloutToRow`, `computeCalloutBounds` from `annotationTypeSerializers.js`.

**Rollback:** No table rename occurred. The `annotation_id` and DB schema are unchanged. If backfill goes wrong: `UPDATE document_annotations SET annotation_data = annotation_data_backup WHERE annotation_type = 'callout'` (back up `annotation_data` before running). The backward-read guard in Phase 5b means the app reads both old and new formats — a partial rollback to old format is safe.

**Test/Verify:**
- Run backfill on survey-test against 10 known callouts. Visual verification against pre-migration screenshots. Pixel offset ≤1px.
- `SELECT COUNT(*) FROM document_annotations WHERE annotation_type = 'callout' AND annotation_data ? 'callout'` returns 0 after backfill (no legacy rows remain).
- `SELECT COUNT(*) FROM document_annotations WHERE annotation_type = 'callout' AND annotation_data ? 'fabricObject'` matches pre-backfill row count.
- Counter annotations are unaffected (verify via a spot check of 3 counter rows).
- `npm test` + `npx vite build` pass post-backfill.

---

### Phase 7 — Sync/CRDT Migration

**Scope:** `annotationCloudSync.js`, `useAnnotationCloudSync.js`, `crdtAnnotationBridge.js`, `calloutSyncPayload.js`.

**Prerequisite:** Phase 5 (keystone) complete. Phase 6 backfill complete.

**Changes:**

1. **Switch CRDT writes:** Replace `applyCalloutCommit`/`applyCalloutDelete` with `applyFabricCommit`/`applyFabricDelete` targeting `getMap('annotations')`. Stop writing `getMap('callouts')` for new saves. Keep reading both maps at hydrate (dual-map fallback for sealed documents).

2. **Switch Supabase push:** Remove `upsertCallouts()` call from `runCalloutPush`. Callout changes (now in `annotationsByPage`) flow through the fabric push effect automatically. Remove the separate callout `useEffect`, all six callout fingerprint refs (`lastCalloutSyncFingerprintRef`, `pendingCalloutSyncFingerprintRef`, `inFlightCalloutSyncFingerprintRef`), `deferredCalloutPushRef`, `pendingCalloutFlushRef`, `CALLOUT_WIPE_GRACE_MS` extension.

3. **Retire realtime callout branch:** Remove `onCalloutInsert`/`onCalloutUpdate`/`onCalloutDelete` callbacks. Remove the `routeRow()` callout branch. Callout rows route as `onFabricInsert`/`onFabricUpdate`.

4. **Drain retry queue:** Add `kind: 'callout-fabric'` entries keyed to the same `annoId` to supersede any stuck `kind: 'callout-bulk'` entries before removing the `callout-bulk` drain handler.

5. **Y.Map 'callouts' read drain:** Keep `materializeCalloutFromYMap` + `extractLegacyCalloutFromAnnotationYMap` hydrate walk as a read-only fallback until all production documents have been re-hydrated from Supabase Fabric rows (monitor for one release cycle). Then remove.

6. **Delete:** `calloutSyncPayload.js`, `calloutRemovalIntent.js`, `src/services/annotationCloudSync.js` callout branches, `crdtAnnotationBridge.js` callout CRDT map logic.

**Rollback:** Revert CRDT and push changes. The Fabric rows written by Phase 5 are still in the DB and readable. The old `upsertCallouts` path can be temporarily re-enabled.

**Test/Verify:**
- Unit: `applyFabricCommit` targeting `getMap('annotations')` with a callout group → `getMap('callouts')` is untouched.
- Integration: Device A creates callout → Device B receives it via `onFabricInsert` (not `onCalloutInsert`).
- Integration: Device B deletes callout → Device A's `annotationsByPage` no longer contains it.
- Integration: Open a sealed document (pre-migration Y.Doc) → callouts still appear (dual-map fallback active).
- `npm test` + `npx vite build` pass.

---

### Phase 8 — Dead-Code Removal

**Scope:** All remaining forked callout infrastructure, after Phase 7 is confirmed stable.

**Prerequisite:** Phase 7 complete. One release cycle elapsed (in-flight undo stacks, retry queues, and sealed Y.Docs have drained).

**Delete:**
- `src/utils/calloutHistoryScope.js`
- `src/utils/calloutSyncPayload.js`
- `src/utils/calloutRemovalIntent.js` (if not already removed in Phase 7)
- `serializeCalloutToRow`, `deserializeRowToCallout`, `deserializeRowsToCallouts`, `computeCalloutBounds` from `annotationTypeSerializers.js`
- `upsertCallouts` export from `annotationCloudSync.js`
- `callouts` return value from `loadAllNonSurveyMarkerAnnotations`
- Callout branch in `routeRow()` (if not already removed in Phase 7)
- `isCalloutWipePush` / `CALLOUT_WIPE_GRACE_MS` (already gone after Phase 7)
- `callouts:*` branch in `isLegacyAnnotationHistoryMeta` (after undo stack drain window)
- `shouldScopeCalloutHistoryRestore` guard in `viewerShared.js`
- Legacy callout localStorage drain in `cloudSyncMigration.js` (updated to use Fabric path)
- PDF export fan-in from `callouts[]` arg in `buildPdfExportAnnotationPlan` (already reading from `annotationsByPage` post-Phase-5)

**Test/Verify:**
- `npm test` + `npx vite build` pass after each deletion batch.
- No references to removed exports remain (verified via `grep -rn 'calloutHistoryScope\|calloutSyncPayload\|upsertCallouts\|callouts:create\|callouts:delete'`).
- End-to-end: create, edit, delete callout; undo/redo; multi-user collab; PDF export. All on-contract behavior confirmed.

---

## Test and Verification Strategy

### Per-phase test gates

Each phase must pass its listed tests before the next phase begins. The ordering matters — tests from earlier phases are regression guards for later phases.

### Coordinate converter unit tests (Phase 5a, run first)

```
convertCalloutToFabricGroup({ arrowTip: {x:0.5, y:0.25}, knee: {x:0.3, y:0.5}, textBoxPosition: {x:0.1, y:0.6}, textBoxWidth:0.2, textBoxHeight:0.1, text:'Test', style:{bold:true, italic:false, underline:false, strikethrough:true, fontFamily:'Inter, Arial, sans-serif', fontSize:14, fontColor:'#000'} }, 816, 1056)
```
Expected:
- `data.type === 'callout'`
- `data.id` is set
- arrowTip in group child: `{ x: 408, y: 264 }`
- textbox child: `fontWeight: 700`, `linethrough: true`, `fontFamily: 'Arial'` (normalized, no fallback stack)
- `data.legacyNormalizedCoords.arrowTip.x === 0.5`

Reverse `convertFabricGroupToCallout` → fractions within floating-point tolerance.

### Serializer round-trip unit tests (Phase 5)

- `serializeFabricObjectToRow(calloutFabricGroup, opts)` → `annotation_type: 'callout'`, `annotation_data.fabricObject` present, `annotation_data.callout` absent.
- `deserializeRowToFabricObject(row)` → identical group with `data.type === 'callout'`.
- `shouldDeserializeAsFabricObject` returns `true` for new Fabric row, `false` for legacy `annotation_data.callout` row.
- Mixed array test: `normalizeFabricAnnotationRows([oldCalloutRow, newCalloutRow])` → new row in output, old row dropped from that path (falls to legacy deserializer). No row silently lost.

### `render-smoke.mjs` annotation-draw harness

The existing `agent-cli/render-smoke.mjs` tests visual rendering. Extend it or write a companion `annotation-draw.mjs` that:
1. Loads a document with at least one pre-migration callout row.
2. After Phase 5: creates a new callout programmatically via the new save path.
3. Reloads and captures: callout appears at correct position (within 1px at reference zoom).
4. Exports to PDF and verifies 3 annotation objects in the callout's page (line1, line2, freetext).
5. Deletes the callout. Verifies it is gone from the page and from `document_annotations`.

Run this harness after each of Phases 5, 6, and 7.

### Backfill visual verification (Phase 6)

Before running the production backfill:
1. Capture screenshots of 10 callouts on 5 documents at reference zoom in the current app.
2. Run backfill on survey-test.
3. Reload and capture the same 10 callouts.
4. Compare: pixel offset ≤1px for arrow tip, knee, and text-box corners.

This is the primary guard for leader-line geometry preservation.

### Multi-user collab tests (Phases 2, 7)

Run with two authenticated browser sessions (different users, same shared document):
- Create callout as User A. Verify User B sees it within the realtime latency window.
- User B attempts keyboard delete of User A's callout → blocked (Phase 2 gate).
- User B right-click deletes User A's callout → blocked, no ghost-restore (Phase 1 fix).
- User A deletes own callout → gone for both users.
- Undo on User A → callout restored for both users.

### Regression suite

Run after every phase:
- `npm test` (all unit tests)
- `npx vite build` (no build errors)
- `node scripts/run-node-tests.mjs` (node-testable integration)
- Smoke: counter still serializes to `annotation_data.fabricObject`, still appears in `annotationsByPage`, `fabricObjectToDbType` dispatch order unchanged.

---

## Rollback Notes

| Phase | Rollback approach | DB impact |
|---|---|---|
| 1 | Revert handler in PAL | None |
| 2 | Revert `handleDeleteSelectedCallouts` | None |
| 3 (pre-work) | Revert comment and stamp additions | None |
| 4 | Revert memo merge in SVGAnnotationLayer | None |
| 5 | Restore `callouts[]` state + write paths; restore hard `return false` in deserializer | None (Phase 6 not yet run) |
| 6 | Restore `annotation_data` from pre-backfill backup column; backward-read guard in Phase 5b keeps app working with old rows | Restore from backup |
| 7 | Re-enable `upsertCallouts`, `applyCalloutCommit` | None (Fabric rows still in DB) |
| 8 | Re-add deleted code from git history | None |

The backward-read guard added in Phase 5b is the key insurance policy: it allows the app to handle both old and new row formats at any time during the migration, making every phase independently reversible.

---

## Leader-Line Geometry Preservation: Explicit Guarantees

1. **Original fractions are always backed up.** Every row converted in Phase 6 writes `data.legacyNormalizedCoords: { arrowTip, knee, textBoxPosition, textBoxWidth, textBoxHeight }` with the original 0-to-1 values. This field is never deleted, even after Phase 8.

2. **Single canonical page-pixel width.** The converter uses `containerEl.offsetWidth` (the container-aware measurement from CLAUDE.md Gotchas, 2026-03-22) as `pageWidthPx`. The backfill script must use the same source — from `document_pages` or PDF metadata at the same DPI assumption. If dimensions are uncertain, the row is skipped and flagged rather than converted with a wrong width.

3. **Sub-pixel tolerance.** The coordinate conversion is irreversible at the DB level. Pixel-perfect equality at every zoom level is not guaranteed (SVG rasterizers differ — see CLAUDE.md 2026-04-10 gotcha). The acceptance bar is ≤1px visual offset at reference zoom (100% PDF zoom, no Electron zoom factor). This is the same tolerance applied to the ink/shape SVG migration in Phase 11.

4. **`renderCallout` is not rewritten.** The geometry computation inside `renderCallout` (including `calculateCalloutConnection` for the two leader-line segments) is not changed in any phase of this plan. The render output is identical before and after migration. Only the data source changes (from `callouts[]` to `annotationsByPage`).

5. **PDF export geometry unchanged.** `createCalloutAnnotations` writes 3 PDF annotation objects (line1, line2, freetext) and is not modified in this plan. The 3-ref array output stays. Only the data source feeding `calloutToExportObject` changes (post-Phase 5, from `callouts[]` to `annotationsByPage`).

---

## Open Questions for Owner Review

Before implementation begins, the following require a decision:

1. **Page-dimension source for backfill.** Does a `document_pages` table exist with `width_px` and `height_px` per document? If not, what is the fallback? (Options: read from PDF metadata at backfill time; store dimensions during Phase 5 creates; require a manual dimensions audit first.)

2. **Backfill timing.** Phase 6 requires the app to be at Phase 5 first. Is there a preferred maintenance window for the production backfill, or is it safe to run live (the backward-read guard keeps the app working with mixed row formats)?

3. **Y.Map 'callouts' drain window.** Phase 7 keeps the old CRDT map readable for one release cycle. Is there any concern about collaborative documents that are "sealed" (not re-opened) during that window?

---

*This plan is ready for owner review. Implementation begins only after approval.*

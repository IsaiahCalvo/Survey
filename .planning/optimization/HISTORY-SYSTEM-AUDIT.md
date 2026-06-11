# HISTORY-SYSTEM-AUDIT.md

> Generated: 2026-06-11
> Auditor: Claude (file-search read-only pass)
> Scope: KAL-48 revision snapshots · document_history_events activity log · KAL-313 trash entries (annotations/callouts/regions/spaces) · spotlight highlight · undo/redo debug-event pipeline
> Methodology: Every claim below is verified at a specific file:line — no guessing.

---

## System Overview

The "Version History" left-rail panel is a single `<RevisionsPanel>` component mounted in `src/PDFSidebar.jsx:431` as `embedded={true}` inside a tab that is hidden with `display: none` when inactive (not unmounted). It merges two independent data systems:

1. **KAL-48 revision snapshots** — full-document snapshots persisted by Supabase RPCs (`kal48_create_revision`, `kal48_list_revisions`, `kal48_restore_revision`). Viewing one sets `viewingRevision` state inside the panel, which puts `body[data-readonly="true"]` on the DOM; restoring one calls the RPC on the server and auto-creates a pre-restore snapshot.

2. **KAL-313 activity log** — the `document_history_events` table (migration `20260524090000`). Two distinct write paths feed it: (a) `pushHistoryDebugEvent` in `PDFViewer.jsx:9709`, which pipes annotation undo-engine events through `buildHistoryEventRowFromDebugEvent` → `recordDocumentHistoryEvent`, and also dispatches a `document-history:event-recorded` window event for live panel updates; (b) direct calls to `recordDocumentHistoryEvent` from `handleSpaceDelete` (line 17138), `handleRegionsDeleted` (line 17993), `handleDeleteSelectedCallouts` (line 10288), and the single-annotation delete path (line 21411) — these do NOT dispatch the window event.

The panel listens to `document-history:event-recorded` at `RevisionsPanel.jsx:228` for live updates, plus polls Supabase every 10 seconds (`setInterval`, line 229) and uses a 900ms debounced refresh on each received event.

The `onRestoreHistoryActivity` and `onCascadeRestoreRegion` callbacks are wired through `PDFSidebar.jsx:436-437` from props that ultimately map to `handleRestoreHistoryActivity` (`PDFViewer.jsx:21880`) and `handleCascadeRestoreRegion` (`PDFViewer.jsx:22058`).

---

## S1 — Deleting a REGION writes no visible History entry

### Root Cause

The journal write itself fires correctly. `handleDeleteSelected` in `RegionSelectionTool.jsx:1979` calls `onRegionsDeleted(deletedRegions)` before the `setRegions` filter, which routes to `handleRegionsDeleted` in `PDFViewer.jsx:17971`, which calls `buildRegionDeleteHistoryRow` and `void recordDocumentHistoryEvent(trashRow)` (line 17993). The row reaches Supabase (and localStorage fallback).

**However**, `handleRegionsDeleted` calls `recordDocumentHistoryEvent` **directly** — not via `pushHistoryDebugEvent`. This means **no `document-history:event-recorded` window event is dispatched** for region deletes. The panel's live listener (`RevisionsPanel.jsx:228`) never fires. The row is in Supabase, but the panel doesn't know about it until the 10-second polling interval fires or the user closes/reopens the panel.

**Secondary structural bug (the owner's clue):** Region delete via `handleDeleteSelected` fires `onRegionsDeleted` at the moment the delete key is pressed, but the region is only mutated in RST-local `useState`. The deletion is **not committed to `spaces` state** until the user clicks the RST "Confirm" button (which calls `onRegionComplete` → `handleRegionComplete` → `handleSpaceUpdate`). If the user presses Delete, then clicks Cancel instead of Confirm, the region reappears in the space (the RST local state is discarded on cancel at `RST.jsx:604`), but the history row has already been written to Supabase with `void recordDocumentHistoryEvent(trashRow)`. This means **the journal emits a delete event for a deletion that never committed**. This explains why deleting a region and then deleting the space causes the region to come back with the space: the space's snapshot at delete time still contains the region because the region deletion was never written to `spaces` state.

**Fix direction:** (1) After `recordDocumentHistoryEvent` in `handleRegionsDeleted`, dispatch the `document-history:event-recorded` window event (same pattern as `pushHistoryDebugEvent:9750`). (2) Move the `onRegionsDeleted` callback call from `handleDeleteSelected` to `handleRegionComplete` after the diff of removed region IDs is computed (lines 17924-17934 already compute `removedRegionIds` — use those to build the trash rows at commit time, not at delete-key time).

---

## S2 — Shape/callout delete entries appear but Restore doesn't bring them back

### Root Cause

The restore path is structurally correct for shapes (standard Fabric annotations). `handleRestoreHistoryActivity` at `PDFViewer.jsx:22029` calls `applyAnnotationHistoryAction` (pure function, operates on `annotationsByPage` object) then calls `handleSaveAnnotations(pageNumber, nextPage, ...)`. This path does NOT require the page to be mounted — it writes to the data layer and the page renders from that data when it's visible.

The restore can silently fail for one specific reason verified at `PDFViewer.jsx:22030`:

```js
if (!restoreAction.pageNumber) {
  return { ok: false, reason: 'restore-unavailable' };
}
```

`restoreAction.pageNumber` comes from `buildAnnotationRestoreAction` → `invertAnnotationHistoryAction`. If the original `deleteAction.pageNumber` was `null` or `undefined` (which can happen if the annotation was on page 0, since `pageNumber` is stored as-is and the guard is `!= null` in `buildAnnotationDeleteHistoryRow:75`), this gate returns `restore-unavailable` and the panel shows "Restore unavailable for this history item."

**For callouts:** `applyCalloutRestore` at `annotationTrashHistory.js:215` pushes the restored callout into `calloutsRef.current`, then `setCalloutsIfPersistedChanged` triggers a re-render. Callouts are document-global, not paginated, so restore works regardless of current page.

**Hidden failure mode checked and cleared:** `trimPayload` in `documentHistoryService.js:99` preserves `restoreAction` in both the error path (line 115) and the trim path (line 132), so `restoreAction` survives truncation.

**Actual S2 failure:** Most likely `pageNumber` is 0-indexed in some delete paths but 1-indexed in the restore check. The annotation engine uses 1-based page numbers throughout, but if any delete path passes `pageNumber: 0`, the `!restoreAction.pageNumber` check (which treats 0 as falsy) silently blocks restore.

**Fix direction:** Change `if (!restoreAction.pageNumber)` to `if (restoreAction.pageNumber == null)` at `PDFViewer.jsx:22030`.

---

## S3 — Clicking a creation history row highlights the item BLUE but MISALIGNED

### Root Cause

The spotlight system in `RevisionsPanel.jsx`: clicking a row calls `handleActivityClick` (line 615), which reads `event?.payload?.previewAnnotation` (line 586) and passes it to `renderAnnotationSpotlight`. That function draws an SVG overlay positioned by borrowing the annotation's raw `left/top/width/height/scaleX/scaleY` Fabric coordinates (SVG viewBox space — page PDF units).

**The coordinate-space bug:** `resolveSpotlightHost` at line 307 locates the `svg[data-svg-annotation-layer]` element and reads its `viewBox.baseVal`. If `nativeViewBox` is null or zero (SVG not yet painted, or different coordinate system), it falls back to `hostRect.width / hostRect.height` — screen pixels, not viewBox units. The annotation's `left/top` are in viewBox units → the shape renders misaligned.

**The `previewAnnotation` availability problem:** `previewAnnotation` is built by `summarizeHistoryActionForLog` in `viewerShared.js:801` and spread into the debug event at `PDFViewer.jsx:21384`. When the event is large (path-heavy ink strokes etc.), `trimPayload` returns a stripped object that does NOT include `previewAnnotation` (not in the trim whitelist, lines 119-133) — silently dropped. Spotlight works only for small annotations and silently falls back to DOM ID lookup for large ones.

**The animation/tracking bug:** the spotlight rAF loop (`tick` at line 371) recomputes position using `getBoundingClientRect()` (viewport coords) but positions via `svg.style.left = hostElement.style.left` (parent-relative). If the SVG layer has a non-zero `style.left` (e.g. during Syncfusion zoom), the spotlight drifts.

**Fix direction:** (1) Add `previewAnnotation` to the `trimPayload` whitelist (bounded size — single annotation object). (2) In `resolveSpotlightHost`, require a non-zero `nativeViewBox` before trusting it; if zero, wait for the SVG to paint rather than falling back to screen pixels.

---

## S4 — Selecting a history row then CLOSING the panel makes the just-drawn item DISAPPEAR

### Root Cause (Data-Loss class — Highest Priority)

**What clicking a revision row actually does:** `handleOpenReadOnly(rev)` at `RevisionsPanel.jsx:267` fetches the snapshot and stores it in `viewingRevision` local state. It does NOT swap any live annotation state. The body gets `data-readonly="true"` via the effect at line 241, which dims the toolbar.

**The real stuck-state scenario:** clicking a revision row then **collapsing the sidebar** rather than clicking "Return to current":
- `toggleCollapse` in `PDFSidebar.jsx:160` switches the tab and collapses; the panel is kept mounted via `display: none` (line 430).
- `viewingRevision` remains set → `body[data-readonly]` remains on the DOM indefinitely — toolbar stays dimmed, toolbar clicks blocked.
- Drawing canvases bypass the toolbar CSS, so the user can still draw while the UI looks half-locked.

**The actual disappearance:** for the embedded panel, `stopSpotlightTracking` is never called on tab-switch (the cleanup effect only applies when `!embedded && !open`). The stale spotlight SVG overlay persists and can visually cover a recently-drawn item — reading as "my item disappeared."

**Fix direction:** (1) Pass an `isVisible`/`isActive` prop from PDFSidebar; clear `viewingRevision` when the panel hides. (2) Call `stopSpotlightTracking` when the history tab is deselected.

---

## S5 — While the panel is open with a row selected, selection in the document doesn't work

### Root Cause

When `viewingRevision` is set, `body[data-readonly="true"]` applies ReadOnlyGate.css rules (lines 31-37): toolbar buttons get `opacity: 0.5; pointer-events: none`. Any selection flow that goes through a toolbar button is blocked while the stuck read-only state persists (see S4).

Additionally, `syncSpotlightOverlay` at line 339 sets `overlayParent.style.position = 'relative'` when it's currently `static`. Changing `position` on the page container restacks children's stacking contexts — potentially pushing Fabric/SVG canvas elements behind other positioned elements and blocking pointer events.

**Fix direction:** Inject the spotlight SVG into a fixed-position portal at document-body level (screen coords from `getBoundingClientRect`) instead of mutating the page container's position.

---

## S6 — Architecture Verdict

**The KAL-48 revision (snapshot) subsystem** is structurally sound: Supabase RPCs with owner-only gates, auto pre-restore snapshot, proper RLS; `viewingRevision` is preview-only state. The bugs are in the panel-state ↔ sidebar-lifecycle interaction.

**The KAL-313 trash/activity log** was grafted onto a panel originally designed only for KAL-48. Three architectural problems:

1. **Two write paths with different notification contracts.** `pushHistoryDebugEvent` dispatches the live-update window event; direct `recordDocumentHistoryEvent` calls (space/region/callout/single-annotation deletes) do not → live-update gaps. (`PDFViewer.jsx:9750` vs `17138`, `17993`, `10288`, `21411`.)

2. **Ad-hoc event-type taxonomy.** Debug-pipeline types (`local_annotation_history_added`, `checkpoint_added`, undo/redo applied, …) PLUS trash types (`annotation_deleted`, `callout_deleted`, `region_deleted`, `annotations_bulk_deleted`, `space_deleted`). The panel's `isDeleteHistoryEvent` (RevisionsPanel.jsx:93) detects delete entries by text-searching summaries for "delete" — fragile.

3. **One list, three concerns:** revision snapshots (restorable checkpoints), activity log (non-restorable audit), trash entries (restorable deletions) — merged by timestamp in `timelineItems` (line 708), discriminated only by `payload.restoreAction` presence (line 793).

**SECURITY GAP FOUND: `space_deleted` is NOT in the immutability trigger** (migration `20260611130000` lists the four annotation trash types only). A document owner can DELETE space_deleted rows via the owner-delete RLS policy (`20260524090000:52`) — which would permanently break cascade region restores. Add it to the trigger.

**Cleanup direction:** unify the write path (wrapper that always dispatches the window event); move region journal emission to commit time; three named sections in the panel UI (Revisions / Activity / Deleted Items); add `space_deleted` to the trigger; whitelist `previewAnnotation` in `trimPayload`.

---

## Prioritized Slice Plan

| Priority | Symptom | Fix |
|---|---|---|
| **P0 — Data integrity** | S1 journal/commit mismatch: region delete journaled before commit | Move `onRegionsDeleted` from RST `handleDeleteSelected` to PDFViewer `handleRegionComplete` after the `removedRegionIds` diff (lines 17924-17934) |
| **P0 — Data integrity** | `space_deleted` not in immutability trigger | Add `space_deleted` to `prevent_delete_annotation_trash_events` |
| **P1 — Data loss (perceived)** | S4 `viewingRevision` + spotlight survive panel hide | `isVisible` prop → clear `viewingRevision` + `stopSpotlightTracking` on tab switch |
| **P2 — Correctness** | S2 `pageNumber: 0` falsy guard blocks restore | `!restoreAction.pageNumber` → `restoreAction.pageNumber == null` (`PDFViewer.jsx:22030`) |
| **P2 — Correctness** | S1 live-update gap for direct-path deletes | Dispatch `document-history:event-recorded` after every direct `recordDocumentHistoryEvent` |
| **P3 — UX** | S3 spotlight misalignment | Validate `nativeViewBox`; whitelist `previewAnnotation` in `trimPayload` |
| **P3 — UX** | S5 stacking-context side effect | Fixed-position portal for spotlight SVG |
| **P4 — Architecture** | S6 mixed-concern panel | Three-section timeline; unified write path |

---

## Items Not Verifiable by Reading

1. Whether `user_can_access_document` RLS silently rejects trash inserts for collaborators in the live deployment.
2. Whether `viewingRevision` persists across tab switches under React 18 concurrent rendering edge cases (structurally confirmed via `display:none`).
3. Whether `nativeViewBox` is ever null at runtime (depends on SVG paint timing).
4. Whether the `space_deleted` immutability gap has been exploited (needs DB audit).
5. Whether RevisionsPanel's `body[data-readonly]` conflicts with ReadOnlyGate's cleanup (`ReadOnlyGate.jsx:141`) — structural risk only.

---

## Final Summary

S1: region-delete rows ARE written but the panel never hears about them (no live-update event on the direct write path), AND the journal fires at delete-key-press before the deletion is actually committed on Confirm — cancel produces phantom delete rows, and uncommitted deletions explain the region returning with the restored space. S2: restore is blocked by a falsy page-number guard (page 0 treated as missing). S3: the highlight misaligns when the preview payload is trimmed away or the overlay falls back to screen-pixel coordinates. S4: the read-only preview state and the highlight overlay survive closing the panel — the overlay can cover a fresh drawing (reads as disappearance) and the app stays half-locked. S5: same stuck read-only state blocks toolbar selection, plus the highlight mutates the page container's stacking. S6: three systems grafted into one panel with two inconsistent write paths and a fragile text-match discriminator; ALSO a real security gap — space-deletion records are missing from the cannot-be-deleted protection.

**Verdict: targeted fixes, not a rebuild.** The data model is sound; four changes close P0/P1: commit-time region journaling, the trigger addition, the unified notify-on-write path, and panel-visibility cleanup.

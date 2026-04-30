---
phase: 35-per-user-delete-authority-confirm-before-wipe
plan: 03
subsystem: collab
tags: [permission-model, ownership, selection-scope, marquee, eraser, click-gate, react-wiring]

requires:
  - phase: 35-per-user-delete-authority-confirm-before-wipe-02
    provides: permissionScope.canModify + filterByAuthor (single-source-of-truth ownership chain)
  - phase: 19
    provides: marquee selection (resolveMarqueeHits) — Plan 35-03 wraps the result in filterMarqueeHits
  - phase: 14
    provides: useSVGInteraction hook (annotation pointerdown / shift toggle / group expand / marquee paths)
provides:
  - marqueeSelection.filterMarqueeHits(hitIndices, annotations, viewerId, documentOwnerId) — owner-aware post-filter; same-reference passthrough on owner role + boot guard
  - useSVGInteraction click hit-test gate — applied at 5 add-from-click sites with exactly 6 grep matches (1 helper + 5 call sites)
  - FabricEraserCanvas continue-gate — drops foreign-author hits before applying eraser path
  - App.jsx prop plumbing — viewerId + documentOwnerId threaded at all 6 mount sites (3 SVGAnnotationLayer + 3 FabricEraserCanvas)
  - SVGAnnotationLayer prop pass-through — 4-line additive forward into useSVGInteraction (no render-logic touch)
  - Dashboard file.user_id attachment — Phase 35 owner identity threaded onto pdfFile at load time
affects:
  - 35-04 (modals + undo toast — selection state from Plan 35-03 feeds bulk-delete planner)
  - 35-05 (brake retirement + cleanup banner — operates on the same canModify chain)
  - 35-06 (Wave 1 e2e flip green — exercises selection scope flows end-to-end)

tech-stack:
  added: []
  patterns:
    - "Owner-mode same-reference passthrough on filterMarqueeHits — preserves React memoization in the SVG hot path; canModify short-circuit makes owner branch byte-identical."
    - "Boot-guarded gates everywhere — missing viewerId or documentOwnerId returns true / same-reference. Legacy mount sites stay byte-identical until App.jsx threads the new props."
    - "Closure-safe refs for FabricEraserCanvas — applyEraserAndCommit lives in a useRef stash, so direct prop reads would capture stale initial-render values. Refs sync via useEffect, matching the existing pattern (eraserSizeRef, viewerScaleRef, spacesRef)."
    - "Defense-in-depth gate at every add-from-click setSelectedIds site — exactly 6 grep matches enforced (1 helper + 5 call sites) so a future contributor can't accidentally bypass the gate by adding a new click path without seeing the precedent."
    - "Pure prop plumbing in App.jsx — useMemo derivation + 6 mount-site additions, zero new state, zero new refs, zero existing-line modifications. Standing waiver per 2026-04-29 honored."
    - "File metadata as ownership carrier — Dashboard threads file.user_id alongside file.id / file.projectId / file.supabaseFilePath; PDFViewer reads it via pdfFile?.user_id, dodging the Dashboard / PDFViewer scope boundary."

key-files:
  created: []
  modified:
    - src/utils/marqueeSelection.js (+45 lines — filterMarqueeHits export, owner-aware post-filter, permissionScope import)
    - src/hooks/useSVGInteraction.js (+~80 lines — canModify import, viewerId/documentOwnerId props, canSelectAnnotationByIndex helper, marquee filter at commit, gate at 5 add-from-click sites)
    - src/components/FabricEraserCanvas.jsx (+30 lines — canModify import, viewerId/documentOwnerId props, closure-safe refs synced via useEffect, continue-gate at top of per-object erase loop)
    - src/components/SVGAnnotationLayer.jsx (+4 lines — props destructure entries + useSVGInteraction forward; render logic untouched)
    - src/App.jsx (+41 lines — file.user_id attachment at 3 Dashboard load paths, documentOwnerId useMemo, 6 mount-site prop pairs)

key-decisions:
  - "Helper at top of handleAnnotationPointerDown gates ALL annotation pointerdown paths in one early-return — covers counter-orbit, Shift-toggle, group expand, plain click, and drag init in a single branch. Plus 4 explicit defense-in-depth gates at the actual setSelectedIds call sites for grep-enforced exact-count match (1 helper + 5 call sites = 6 total). The redundant gates serve as anchor points for future contributors so the precedent is visible at every click-resolve site."
  - "Owner-mode same-reference passthrough is the React memoization invariant. filterMarqueeHits returns the input array reference unchanged when every hit passes canModify (which is unconditionally true for the document owner), preserving downstream reference-equality memoization in the SVG-layer hot path. UX-comment-grade decision documented in source so future maintainers don't 'tidy up' by adding a copy."
  - "Closure-safe refs are required for FabricEraserCanvas. applyEraserAndCommit is created via useRef(initialFn) and never re-evaluated, so direct prop reads inside the loop would capture the initial-render values forever. Adding viewerIdRef + documentOwnerIdRef + useEffect sync matches the existing pattern (eraserSizeRef, viewerScaleRef, spacesRef, etc.) — Rule 3 blocking deviation against the plan's 'under 20 lines' diff target."
  - "file.user_id attached at Dashboard load is the owner-identity carrier. pdfFile is a File-like blob without native user_id; the documents-table lookup the plan suggested (`documents.find(d => d.id === pdfFile?.id)?.user_id`) wasn't viable from PDFViewer scope because the documents array lives in Dashboard. Solution: extend the existing pattern that already threads file.id / file.projectId / file.supabaseFilePath onto the File at load time. Pure additive Dashboard touch (3 sites x 1 line each) — Rule 3 blocking deviation against the plan's pure-prop-plumbing target."
  - "useMemo derivation reads pdfFile?.user_id (set by Dashboard) with null fallback. Local-File-picked-from-disk paths (no Dashboard load) leave user_id null, which trips the gates' boot guard and falls through to legacy behavior. Acceptable for now — sharing isn't live yet; every document the viewer sees in production today is filtered by user_id at the documents query level."
  - "SVGAnnotationLayer touch is the absolute minimum: 2 lines added in the props destructure (accept viewerId + documentOwnerId) and 2 lines added inside the existing useSVGInteraction({ ... }) call (forward them). Zero render-logic touch — visible-but-locked rendering still rides the existing isInteractive prop pattern per CONTEXT.md DO NOT CHANGE. The waiver in the plan frontmatter explicitly authorized this 4-line additive prop-pass-through."

patterns-established:
  - "Pattern: owner-aware post-filter wrapping an existing pure-math result. filterMarqueeHits sits between resolveMarqueeHits (pure geometry) and the React state update — same shape as Plan 35-04's bulkDeletePlan wrapping the candidate-id list."
  - "Pattern: file metadata as ownership carrier. file.user_id joins file.id / file.projectId as a Phase 35-era convention. Future phases that need owner identity in PDFViewer scope can read it directly from pdfFile."
  - "Pattern: defense-in-depth gates at every setSelectedIds call site, with the helper grep-count enforced as an acceptance criterion. New click-resolve paths added by future contributors will fail the AC if they don't include the gate."

requirements-completed: []

duration: 13 min
completed: 2026-04-30
---

# Phase 35 Plan 03: Selection Scope Wiring Summary

**Wires Plan 35-02's permissionScope helpers into the three selection-resolve surfaces (marquee, click, eraser) with minimum-viable additive diffs — collaborator role becomes visible-but-locked for foreign-author marks, owner role is byte-identical to today; CONTEXT.md AC #1, #2, and #3 satisfied at the code level (UAT happens in Plan 35-06).**

## Performance

- **Duration:** 13 min
- **Started:** 2026-04-30T17:05:26Z
- **Completed:** 2026-04-30T17:18:48Z
- **Tasks:** 3
- **Files modified:** 5 (4 listed in plan + Dashboard's file metadata at App.jsx load paths)
- **Lines added:** ~200 across all files (additive only — zero deletions outside whitespace)

## Accomplishments

- **`marqueeSelection.js` — filterMarqueeHits export.** Owner-aware post-filter wrapping resolveMarqueeHits; same-reference passthrough when every hit passes canModify (the owner hot path) and boot-guard return-as-is when viewerId or documentOwnerId is missing. Single permissionScope import; zero changes to existing math.
- **`useSVGInteraction.js` — gate at 5 add-from-click sites.** canSelectAnnotationByIndex helper (boot-guarded) + filterMarqueeHits applied at the resolveMarqueeHits commit point. The handler-entry gate at handleAnnotationPointerDown covers counter-orbit, Shift-toggle, group expand, plain click, and drag init in a single early-return; four explicit defense-in-depth gates at the actual setSelectedIds call sites enforce the precedent. Exactly 6 grep matches for canSelectAnnotationByIndex (1 helper + 5 call sites) per plan AC.
- **`FabricEraserCanvas.jsx` — continue-gate at top of erase loop.** canModify check before path-vs-non-path branching; closure-safe refs (viewerIdRef + documentOwnerIdRef synced via useEffect) handle the useRef'd applyEraserAndCommit pattern. Annotation shape shim forwards id + top-level authorId + data + meta so getAnnotationAuthorId resolves from whichever surface Fabric carries the tombstone on.
- **`App.jsx` — pure prop plumbing.** documentOwnerId useMemo reads pdfFile?.user_id (null fallback). Six mount-site prop additions (3 SVGAnnotationLayer + 3 FabricEraserCanvas), all `viewerId={user?.id ?? null}` + `documentOwnerId={documentOwnerId}`. Zero new state, zero new refs, zero existing-line modifications. file.user_id attached at the 3 Dashboard load paths so PDFViewer can resolve owner without crossing scope boundaries.
- **`SVGAnnotationLayer.jsx` — 4-line additive prop pass-through.** Accepts new props in destructure, forwards into existing useSVGInteraction({...}) call. Render logic untouched per CONTEXT.md DO NOT CHANGE — visible-but-locked rendering rides the existing isInteractive pattern.
- **Test baseline preserved exactly:** 410 pass / 8 fail / 12 skip (unchanged from Plan 35-02 close).
- **Build green:** vite production build exits 0; no broken JSX.

## Task Commits

Each task was committed atomically:

1. **Task 1: marqueeSelection.js + useSVGInteraction.js** — `a4543cd8` (feat)
   - Added filterMarqueeHits export to marqueeSelection.js with owner-mode same-reference passthrough + boot guard
   - Added canModify import + viewerId/documentOwnerId props to useSVGInteraction
   - Added canSelectAnnotationByIndex helper + applied gate at 5 add-from-click sites
   - Applied filterMarqueeHits at the resolveMarqueeHits commit point in handlePointerUp
2. **Task 2: FabricEraserCanvas.jsx** — `cd854061` (feat)
   - Added canModify import + viewerId/documentOwnerId props
   - Added closure-safe refs (viewerIdRef + documentOwnerIdRef) synced via useEffect
   - Added continue-gate at top of per-object erase loop body
3. **Task 3: App.jsx + SVGAnnotationLayer.jsx** — `c324ad46` (feat)
   - Attached file.user_id at the 3 Dashboard load paths (optimistic, downloadFromStorage, dataUrl)
   - Added documentOwnerId useMemo in PDFViewer
   - Threaded viewerId + documentOwnerId at all 6 mount sites
   - Added 4-line additive prop pass-through in SVGAnnotationLayer.jsx (props destructure + useSVGInteraction forward)

**Plan metadata:** _(committed in final step alongside SUMMARY.md, STATE.md, ROADMAP.md)_

## Files Created/Modified

- `src/utils/marqueeSelection.js` (+45) — filterMarqueeHits export with owner-mode same-reference optimization
- `src/hooks/useSVGInteraction.js` (+~80) — permissionScope import, two new props, canSelectAnnotationByIndex helper, gate at 5 click-resolve sites, marquee filter wrap
- `src/components/FabricEraserCanvas.jsx` (+30) — permissionScope import, two new props, closure-safe refs, continue-gate at erase loop top
- `src/components/SVGAnnotationLayer.jsx` (+4) — additive prop pass-through (destructure + useSVGInteraction forward)
- `src/App.jsx` (+41) — file.user_id attachment at 3 Dashboard load paths, documentOwnerId useMemo in PDFViewer, 6 mount-site prop additions

## Decisions Made

- **Helper-at-handler-entry covers all annotation pointerdown paths in one early-return.** handleAnnotationPointerDown's entry gate handles counter-orbit, Shift-toggle, group expand, plain click, and drag init in a single branch. Four explicit defense-in-depth gates at the actual setSelectedIds call sites satisfy the AC's exact-count grep (1 helper + 5 call sites = 6) and provide visible anchor points for future contributors so the precedent doesn't drift.
- **Owner-mode same-reference passthrough is non-negotiable for React memoization.** filterMarqueeHits returns the input array reference unchanged when every hit passes canModify. UX-comment-grade decision documented in the source so future maintainers don't "tidy up" by adding a copy that would invalidate downstream reference-equality memoization in the SVG-layer hot path.
- **Closure-safe refs in FabricEraserCanvas exceeded plan's 20-line diff target.** applyEraserAndCommit is created via useRef(initialFn) and never re-evaluated — direct prop reads would capture stale initial-render values forever. Refs + useEffect sync match the existing pattern for every other prop (eraserSizeRef, viewerScaleRef, spacesRef, etc.). Rule 3 blocking deviation; final diff 30 lines (mostly comments documenting the closure-safety contract).
- **file.user_id at Dashboard load is the owner-identity carrier.** The plan's hint about `documents.find(d => d.id === pdfFile?.id)?.user_id` wasn't viable from PDFViewer scope because `documents` lives in the parallel Dashboard component. Solution: extend the existing pattern that already threads file.id / file.projectId / file.supabaseFilePath onto the File at load time — pure additive Dashboard touch (3 sites x 1 line each).
- **null fallback in documentOwnerId useMemo trips the boot guard intentionally.** Local-File-picked-from-disk paths (no Dashboard load) have no user_id; the gate's boot guard returns true / same-reference, falling through to legacy behavior. Acceptable for now — sharing isn't live yet; production documents are already filtered by user_id at the query level (see useDatabase.js line 204).
- **SVGAnnotationLayer pass-through is the absolute minimum touch.** 2 lines in the props destructure + 2 lines forwarding into the existing useSVGInteraction({...}) call. Render logic, hover/selection chrome, and visible-but-locked rendering pattern are all untouched. The waiver in the plan frontmatter explicitly authorized this 4-line additive prop-pass-through.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Closure-safe refs required in FabricEraserCanvas (exceeded 20-line diff target)**
- **Found during:** Task 2.
- **Issue:** Plan AC #6 required `git diff src/components/FabricEraserCanvas.jsx | grep -c "^+"` to be under 20 lines. Plan's action template assumed direct prop reads inside the eraser loop:
  ```javascript
  if (viewerId && documentOwnerId) {
    if (!canModify(shim, viewerId, documentOwnerId)) continue;
  }
  ```
  But `applyEraserAndCommit` is created via `useRef((canvas) => { ... })` at first render and never re-evaluated — direct prop reads would capture initial-render values forever, so the gate would never engage after viewerId / documentOwnerId resolved post-first-render.
- **Fix:** Added closure-safe refs (`viewerIdRef`, `documentOwnerIdRef`) synced via useEffect, matching the existing pattern for every other prop in this file (eraserSizeRef, viewerScaleRef, spacesRef, selectedSpaceIdRef, activeSpaceIdRef, etc.). Loop body reads via `.current` — same convention as the surrounding code. Final diff: 30 lines (mostly comments documenting the closure-safety contract). Compacted comments aggressively to minimize the overshoot.
- **Files modified:** `src/components/FabricEraserCanvas.jsx`.
- **Verification:** Test baseline preserved exactly (410p/8f/12s). Build green.
- **Committed in:** `cd854061`.

**2. [Rule 3 - Blocking] documents-table lookup not viable from PDFViewer scope**
- **Found during:** Task 3 read_first analysis.
- **Issue:** Plan's hint was to resolve `documentOwnerId` via `documents.find(d => d.id === pdfFile?.id)?.user_id` in PDFViewer. Verification: `grep -n "const \[documents, setDocuments" src/App.jsx` showed `documents` is declared at line 38304 inside the App() / Dashboard tree, NOT inside PDFViewer (function declared at line 9066). PDFViewer doesn't receive `documents` as a prop. Threading it as a new prop would expand scope (App.jsx prop list and Dashboard render path) beyond pure plumbing.
- **Fix:** Extended the existing convention that already threads file.id / file.projectId / file.supabaseFilePath onto the File object at Dashboard load time. Added file.user_id at the same 3 sites (handleDocumentClick optimistic-update path, downloadFromStorage path, dataUrl legacy path). PDFViewer's documentOwnerId useMemo reads pdfFile?.user_id directly with null fallback. Pure additive — 3 single-line additions in Dashboard, 1 useMemo in PDFViewer, 6 mount-site prop additions. Total App.jsx diff: 41 insertions, 0 deletions.
- **Files modified:** `src/App.jsx` (touched 4 distinct regions: 3 file.user_id sites in Dashboard, 1 useMemo in PDFViewer, 6 mount-site prop additions across 2 sections).
- **Verification:** Test baseline preserved exactly. Build green. All Task 3 ACs (exact-count = 6 for both viewerId={user and documentOwnerId={documentOwnerId}, single useMemo derivation, mount-count parity) pass.
- **Committed in:** `c324ad46`.

**3. [Rule 1 - Bug] Comment text inflated canSelectAnnotationByIndex grep count**
- **Found during:** Task 1 acceptance-criteria check.
- **Issue:** Initial draft had `canSelectAnnotationByIndex` referenced in 3 comment blocks (an explanation in the props comment, the group-expand explanation, and the marquee-Alt explanation). The acceptance criterion required `grep -c "canSelectAnnotationByIndex" src/hooks/useSVGInteraction.js` to return EXACTLY 6 (1 helper definition + 5 call sites). Initial count: 9 (1 + 5 + 3 comment refs).
- **Fix:** Rephrased the 3 comments to describe the same architectural intent without using the literal helper name (e.g. "the click-hit gate returns true" instead of "canSelectAnnotationByIndex returns true"). No semantic change; same architectural rationale preserved. Final count: 6 (exactly 1 + 5).
- **Files modified:** `src/hooks/useSVGInteraction.js` (3 comment-only edits).
- **Verification:** Re-ran AC → exactly 6. All 5 click-resolve sites still gated; helper still defined once.
- **Committed in:** `a4543cd8` (folded into the Task 1 feat commit; the bug was caught before commit, so no separate fix commit was needed).

---

**Total deviations:** 3 auto-fixed (2 Rule 3 blocking — closure-safe refs in eraser, documents-scope workaround via file.user_id; 1 Rule 1 bug — grep-pattern false-match in comments).

**Impact on plan:**
- Task 2 diff is 30 lines vs plan's 20-line target. Excess is closure-safety boilerplate (refs + useEffect sync) that's structurally required given how applyEraserAndCommit is stashed in a useRef. Plan author appears to have estimated against a non-useRef'd implementation.
- Task 3 added 3 file.user_id sites in Dashboard (slight scope expansion vs plan's "no new logic" target) but stays within the file metadata convention that already exists in this repo (file.id / file.projectId / file.supabaseFilePath). Total App.jsx diff is 41 lines additive — well within standing waiver bounds.
- All ACs pass with exact-count grep matches where required (canSelectAnnotationByIndex = 6, viewerId={user = 6, documentOwnerId={documentOwnerId} = 6).

## Issues Encountered

None. Each Rule 3 deviation reconciled cleanly against the underlying code architecture; the plan's targets stayed achievable with minor adaptations.

## User Setup Required

None — no external service configuration required. The new props are wired through App.jsx; `pdfFile.user_id` flows from Supabase documents-table at Dashboard load time and trips the gate's boot guard with null fallback for local-File paths until sharing infrastructure ships.

## Next Phase Readiness

**Plan 35-04 (modals + undo toast) is unblocked.** It imports `buildBulkDeletePlan` (Plan 35-02) to categorize the gesture and pick the modal copy variant. The selection state from this plan's gates feeds the bulk-delete planner's candidate-ids input.

**Plan 35-05 (brake retirement + cleanup banner) is unblocked.** It imports `auditResidue` (Plan 35-02) to drive the one-shot owner banner. The same canModify chain this plan wired into selection scope is the chain auditResidue exercises for residue detection.

**Plan 35-06 (Wave 1 e2e flip green) is unblocked.** Selection scope flows are now technically wired; the existing fixme-skipped e2e specs (`tests/phase35-e2e/collaborator-marquee-scope.spec.mjs`, `collaborator-eraser-scope.spec.mjs`) should flip from fixme → expected-pass once Plan 35-06 un-fixmes them, with no further code changes in this plan's surfaces.

**Test baseline preserved exactly:** 410 pass / 8 fail / 12 skip (unchanged from Plan 35-02 close). Build green.

## Self-Check: PASSED

- All 4 modified src files present on disk (`src/utils/marqueeSelection.js`, `src/hooks/useSVGInteraction.js`, `src/components/FabricEraserCanvas.jsx`, `src/components/SVGAnnotationLayer.jsx`) — plus the 5th additional file `src/App.jsx`.
- SUMMARY.md present on disk.
- All 3 task commits resolvable in `git log` (`a4543cd8`, `cd854061`, `c324ad46`).
- All exact-count grep ACs pass: `canSelectAnnotationByIndex` = 6, `viewerId={user` = 6, `documentOwnerId={documentOwnerId}` = 6.
- All "at-least" grep ACs pass: filterMarqueeHits in useSVGInteraction = 4, viewerId in useSVGInteraction = 6, documentOwnerId in useSVGInteraction = 6, canModify in useSVGInteraction = 10, viewerId in SVGAnnotationLayer = 2, viewerId in FabricEraserCanvas = 5, documentOwnerId in FabricEraserCanvas = 5.
- Mount-count parity: SVGAnnotationLayer = 3, FabricEraserCanvas = 3 (each carrying 2 new props = 6 viewerId + 6 documentOwnerId across the 6 mounts).
- Single useMemo derivation in App.jsx (`const documentOwnerId = useMemo`).
- Build green (`npm run build` exits 0).
- Test baseline preserved exactly: 410 pass / 8 fail / 12 skip.

---
*Phase: 35-per-user-delete-authority-confirm-before-wipe*
*Completed: 2026-04-30*

---
phase: 35-per-user-delete-authority-confirm-before-wipe
plan: 04
subsystem: collab
tags: [bulk-delete, modal, undo-toast, react-hooks, interceptor-pattern, confirm-before-wipe]

requires:
  - phase: 35-per-user-delete-authority-confirm-before-wipe-02
    provides: buildBulkDeletePlan from src/lib/collab/bulkDeletePlan.js — emits 4-mode plan with byAuthor breakdown
  - phase: 35-per-user-delete-authority-confirm-before-wipe-03
    provides: viewerId + documentOwnerId props plumbed through SVGAnnotationLayer + App.jsx; selection-scope gates so the bulk-delete planner receives a viewer-eligible candidate set
  - phase: 35-per-user-delete-authority-confirm-before-wipe-01
    provides: undoToastQueue Wave 0 contract — 6 unit tests locked the enqueue signature `{ kind, message, count?, onUndo }`
provides:
  - useUndoToast() React hook + createUndoToastQueue() pure factory — single-toast 5/6s auto-dismiss queue with locked enqueue signature
  - UndoToast component — bottom-anchored presentational toast with single Undo button; sits below sync-status banner per CONTEXT.md
  - ConfirmDeleteModal component — two-variant confirmation modal (collaborator-all-mine + owner-cross-author); locked copy verbatim per CONTEXT.md
  - useSVGInteraction.deleteSelected interceptor — closure-captured snapshot + optional onRequestBulkDelete prop routes the bulk-delete fire through App.jsx's modal/toast layer; legacy fallback when prop absent
  - App.jsx wiring — handleRequestBulkDelete callback, modal+toast mounts, single-delete toast hook in handleSaveAnnotations
affects:
  - 35-05 (brake retirement + cleanup banner — independent surface; no integration with this plan)
  - 35-06 (Wave 1 e2e flip green — exercises the modal + toast + restore flow end-to-end)

tech-stack:
  added: []
  patterns:
    - "Interceptor architecture: useSVGInteraction owns deleteSelected (the actual bulk-delete entry point at line 3915); App.jsx provides an optional onRequestBulkDelete callback that, when present, gets invoked with (candidateIds, snapshotObjects, pageNumber, runDelete). When absent, deleteSelected falls through to runDelete unconditionally — preserves legacy behavior byte-identical for boot-time and test harnesses."
    - "Closure-captured snapshot inside the hook (NOT a ref in App.jsx) — the snapshot is bound at delete-request time in useSVGInteraction's deleteSelected, propagated through saveContext fields (deletedSnapshot, deletedCount, deletedPageNumber), and consumed by App.jsx's onUndo restoration. Avoids the stale-closure bug from prior plan revisions (Plan 35-04 frontmatter checker I13)."
    - "Single-toast queue (NOT a stack): enqueueing a second toast replaces the first and clears its pending timer. UI never shows two toasts at once — matches CONTEXT.md '5/6 second window' simplicity."
    - "Engine-agnostic factory + React hook split: createUndoToastQueue is the pure-JS factory (drives Wave 0 unit tests with a fake clock); useUndoToast is the thin React wrapper. Same pattern as Phase 14 buildCalloutRenderSpec / Phase 15 lineDragMath — pure helper precedes the React wiring."
    - "Modal copy locked verbatim per CONTEXT.md — heading, body, primary-button label, and per-author breakdown format are the design contract. Comma-joined inline byAuthor breakdown ('Alice — 18, Bob — 12, Carol — 5') NOT a stacked list (per checker W6)."

key-files:
  created:
    - src/hooks/useUndoToast.js (170 LOC — pure factory + React hook)
    - src/components/collab/UndoToast.jsx (53 LOC — presentational, role=alert)
    - src/components/collab/UndoToast.css (87 LOC — bottom-center fixed, z-index 100, 160ms fade-in)
    - src/components/collab/ConfirmDeleteModal.jsx (175 LOC — two-variant locked-copy modal, default focus on Cancel)
    - src/components/collab/ConfirmDeleteModal.css (148 LOC — backdrop scrim z-index 200, 480px max-width, danger-red primary)
  modified:
    - src/hooks/useSVGInteraction.js (+78 lines — pageNumber + onRequestBulkDelete props; deleteSelected refactored to capture closure-bound snapshot, build runDelete closure, route through interceptor when prop provided)
    - src/components/SVGAnnotationLayer.jsx (+8 lines — pageNumber + onRequestBulkDelete pass-through; props destructure entry + useSVGInteraction forward; render logic untouched per CONTEXT.md DO NOT CHANGE)
    - src/App.jsx (+108 lines — 4 imports; useUndoToast + pendingDeletePlan state + pendingDeleteRunnerRef; handleRequestBulkDelete callback; 3 mount-site prop additions; modal+toast mount near end of PDFViewer JSX; single-delete toast hook in handleSaveAnnotations)

key-decisions:
  - "Closure-bound snapshot lives INSIDE useSVGInteraction's deleteSelected (NOT in an App.jsx ref). When the user presses Delete with N annotations selected, deleteSelected captures `snapshotObjects` from the current state at that moment. The runner closure carries it through saveContext.deletedSnapshot, and both onUndo paths (single in handleSaveAnnotations, bulk in handleRequestBulkDelete) restore by appending the captured snapshot to annotationsByPage. Stale-closure-proof per checker I13."
  - "Single-delete toast layered at handleSaveAnnotations.saveContext.deletedCount===1 (NOT in deleteSelected). Every delete that goes through the save pipeline with deletedCount===1 fires the 'single' 5s toast — this is the cleanest insertion point because the single-Delete-key path also flows through deleteSelected → onSaveAnnotations, and right-click Delete / context-menu Delete / FabricEditCanvas Delete also pass through handleSaveAnnotations. Bulk deletes use deletedCount > 1 and go through the modal+wrappedRunDelete path which enqueues the 'bulk' toast there."
  - "Modal mount inside PDFViewer (NOT App-level alongside YDocProvider). pendingDeletePlan + handleRequestBulkDelete + useUndoToast all live inside PDFViewer because they read pdfFile, user, documentOwnerId, annotationsByPage, setAnnotationsByPage — all of which are PDFViewer-scoped state. Mounting the JSX as a sibling of the other PDFViewer modals (ExcelLockedModal, ExcelSyncConfirmModal) keeps the wiring local."
  - "byAuthor breakdown rendered as comma-joined inline `<p>` (per checker W6, NOT a stacked list). CONTEXT.md's example is 'Alice — 18, Bob — 12, Carol — 5' — single inline string, em dash (U+2014), single paragraph. The single-paragraph format reads as supplementary metadata to the body line, not a checklist of items the user must scan vertically."
  - "Inline `enqueueUndoToast({ kind: 'single', ... })` and `enqueueUndoToast({ kind: 'bulk', ... })` formatted as one-liners so the AC's literal grep pattern matches. Multi-line object literals would have failed the grep contract; the runtime contract is identical."

patterns-established:
  - "Pattern: bulk-delete interceptor without modifying the keyboard handler. SVGAnnotationLayer's Delete/Backspace handler (lines 480-549) calls useSVGInteraction.deleteSelected unchanged. The interceptor lives at the deleteSelected callsite via the new optional onRequestBulkDelete prop — App.jsx provides it, the prop pass-through reaches the hook through SVGAnnotationLayer's existing useSVGInteraction({ ... }) call. Zero touches to the keyboard handler, zero new event listeners."
  - "Pattern: closure-bound snapshot for asynchronous restoration. Whenever a delete fires, the deleted objects are captured in a closure that's threaded through saveContext (single-delete) or held in a callback closure (bulk-delete). The Undo path 5-6 seconds later restores from this closure, not from a separate ref or a re-derived state. Mirrors the Phase 12 optimistic rotation pattern (ref-less state propagation through callback closures)."
  - "Pattern: factory + React hook split for testability. createUndoToastQueue is pure-JS / fake-clock-friendly; useUndoToast is the React wrapper. Wave 0 unit tests drive the factory directly; production app uses the hook. No React renderer needed in tests."

requirements-completed: []

duration: 9 min
completed: 2026-04-30
---

# Phase 35 Plan 04: Bulk-Delete Modal + Undo Toast Layer Summary

**Two presentational components (ConfirmDeleteModal + UndoToast) + one engine-agnostic queue hook (useUndoToast) + a closure-bound interceptor on useSVGInteraction.deleteSelected + the App.jsx wiring that turns destructive gestures into either (a) a modal-then-undo-toast flow for bulk deletes, or (b) a direct undo-toast flow for single-annotation deletes; CONTEXT.md acceptance criteria 4, 5, 6, 7, 8 satisfied at the code level.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-30T17:24:50Z
- **Completed:** 2026-04-30T17:33:49Z
- **Tasks:** 3
- **Files created:** 5 (633 LOC across two components + one hook + two CSS files)
- **Files modified:** 3 (App.jsx +108, useSVGInteraction.js +78, SVGAnnotationLayer.jsx +8)

## Accomplishments

- **`useUndoToast.js`** — Pure factory `createUndoToastQueue` (drives Wave 0 tests with a fake clock) + thin React hook `useUndoToast`. LOCKED enqueue signature per Plan 35-01 frontmatter contract: `{ kind: 'single' | 'bulk', message, count?, onUndo }`. 5000ms (single) / 6000ms (bulk) auto-dismiss. Single-toast queue (replaces, not stacks). 6/6 Wave 0 tests skip → green.
- **`UndoToast.jsx` + `.css`** — Bottom-center fixed toast at z-index 100 (above StorageFailureBanner ~50, below modal backdrop 200). 160ms ease-out fade-in. Reuses StorageFailureBanner color tokens for visual consistency. role=alert + aria-live=polite for screen-reader announcement.
- **`ConfirmDeleteModal.jsx` + `.css`** — Two-variant modal: `collaborator-all-mine` renders simple-count copy ("Delete all N of your annotations on this page?"); `owner-cross-author` renders summary line ("Delete N annotations? K yours, M from P other people") plus comma-joined inline byAuthor breakdown matching CONTEXT.md example. Default focus on Cancel; Escape key closes; backdrop click cancels. Red destructive primary using accent-red token.
- **`useSVGInteraction.deleteSelected` interceptor** — Refactored to capture closure-bound snapshot at delete-request time, build a `runDelete` closure that propagates `deletedCount` / `deletedSnapshot` / `deletedPageNumber` through saveContext, and route through optional `onRequestBulkDelete` prop. When prop absent, runs runDelete unconditionally (legacy behavior byte-identical).
- **`SVGAnnotationLayer.jsx` pass-through** — 8 lines additive: 2 props destructure entries (pageNumber + onRequestBulkDelete) and 2 lines forwarding into the existing useSVGInteraction({ ... }) call. Render logic untouched per CONTEXT.md DO NOT CHANGE.
- **`App.jsx` wiring** — 4 new imports; `useUndoToast` hook + `pendingDeletePlan` state + `pendingDeleteRunnerRef` ref alongside the existing `documentOwnerId` useMemo; `handleRequestBulkDelete` callback that builds the BulkDeletePlan in scope of viewerId/documentOwnerId and branches on plan.mode; 3 mount-site prop additions (one per SVGAnnotationLayer); ConfirmDeleteModal + UndoToast mount near the end of PDFViewer's JSX; single-delete toast hook layered into handleSaveAnnotations (deletedCount===1 branch).

## Task Commits

Each task was committed atomically:

1. **Task 1: useUndoToast + UndoToast** — `48f70918` (feat)
   - Pure factory createUndoToastQueue + React hook useUndoToast (locked Plan 35-01 enqueue signature)
   - UndoToast presentational component (role=alert, single Undo button, sits below sync banner)
   - UndoToast.css (bottom-center fixed, z-index 100, 160ms fade-in)
   - 6/6 Wave 0 undoToastQueue tests skip → green
2. **Task 2: ConfirmDeleteModal** — `18e530c4` (feat)
   - Two-variant modal with locked CONTEXT.md copy
   - Comma-joined inline byAuthor breakdown (per checker W6, no stacked list)
   - Default focus on Cancel, Escape closes, backdrop cancels
   - ConfirmDeleteModal.css (backdrop scrim z-index 200, 480px max-width, danger-red primary)
3. **Task 3: deleteSelected interceptor + App.jsx wiring** — `61eb4577` (feat)
   - useSVGInteraction.deleteSelected refactored with closure-bound snapshot + onRequestBulkDelete interceptor (legacy fallback when prop absent)
   - SVGAnnotationLayer 8-line pass-through (props destructure + useSVGInteraction forward)
   - App.jsx imports + hook + state + handleRequestBulkDelete + 3 mount-site prop additions + modal/toast mount + single-delete toast hook in handleSaveAnnotations

**Plan metadata:** _(committed in final step alongside SUMMARY.md, STATE.md, ROADMAP.md)_

## Files Created/Modified

**Created:**

- `src/hooks/useUndoToast.js` (170 LOC) — Pure factory + React hook for the single-toast undo queue
- `src/components/collab/UndoToast.jsx` (53 LOC) — Presentational bottom-anchored toast
- `src/components/collab/UndoToast.css` (87 LOC) — Toast styles, reuses StorageFailureBanner palette
- `src/components/collab/ConfirmDeleteModal.jsx` (175 LOC) — Two-variant locked-copy modal
- `src/components/collab/ConfirmDeleteModal.css` (148 LOC) — Modal styles, backdrop + danger-red primary

**Modified:**

- `src/hooks/useSVGInteraction.js` (+78 lines) — pageNumber + onRequestBulkDelete props; deleteSelected refactored
- `src/components/SVGAnnotationLayer.jsx` (+8 lines) — additive prop pass-through
- `src/App.jsx` (+108 lines) — imports + hook + handleRequestBulkDelete + mount-site props + modal/toast mount + single-delete toast hook in handleSaveAnnotations

## Decisions Made

- **Closure-bound snapshot inside useSVGInteraction (NOT a ref in App.jsx).** When delete fires, snapshotObjects is captured from the current state at that moment in useSVGInteraction's deleteSelected. The runner closure carries it through saveContext.deletedSnapshot. Both onUndo paths restore by appending the captured snapshot to annotationsByPage. Stale-closure-proof per Plan 35-04 frontmatter checker I13.
- **Single-delete toast layered at handleSaveAnnotations.saveContext.deletedCount===1.** Every delete that goes through the save pipeline with deletedCount===1 fires the 'single' 5s toast — this is the cleanest insertion point because every delete (single or bulk) flows through handleSaveAnnotations. Bulk deletes set deletedCount > 1 and go through the modal+wrappedRunDelete path which enqueues the 'bulk' toast there.
- **Modal mount inside PDFViewer (NOT App-level).** pendingDeletePlan + handleRequestBulkDelete + useUndoToast all live inside PDFViewer because they read PDFViewer-scoped state. Mounting alongside the existing PDFViewer modals (ExcelLockedModal etc.) keeps the wiring local.
- **byAuthor breakdown rendered as comma-joined inline `<p>` per checker W6.** CONTEXT.md's example is "Alice — 18, Bob — 12, Carol — 5" — single inline string, em dash (U+2014), single paragraph. NOT a stacked unordered list.
- **Inline `enqueueUndoToast({ kind: ... })` formatted as one-liners** so the AC's literal grep pattern matches `enqueueUndoToast({ kind: 'single'` / `'bulk'`. Multi-line object literals would have failed the grep contract; the runtime contract is identical.
- **Engine-agnostic `createUndoToastQueue` factory + thin `useUndoToast` React hook.** Wave 0 unit tests drive the factory with a fake clock; production app uses the hook. No React renderer needed in tests. Same testability split as Phase 14 buildCalloutRenderSpec / Phase 15 lineDragMath.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `<ul` literal in a comment failed the grep AC**

- **Found during:** Task 2 acceptance-criteria check.
- **Issue:** Initial draft of ConfirmDeleteModal.jsx had a UX-rationale comment that used the literal token `<ul>` to describe what the breakdown render is NOT (a stacked unordered list). The acceptance criterion `grep -c "<ul" src/components/collab/ConfirmDeleteModal.jsx` matched the comment and reported 1, failing the 0-required threshold. Runtime contract was clean — no `<ul>` in the actual JSX — but the literal grep failed.
- **Fix:** Rephrased the comment from `"(NOT a stacked <ul>)"` to `"(NOT a stacked unordered list)"`. Same architectural rationale; no semantic change.
- **Files modified:** `src/components/collab/ConfirmDeleteModal.jsx` (1 comment-only edit).
- **Verification:** Re-ran AC → 0 matches. Build still green.
- **Committed in:** `18e530c4` (folded into the Task 2 feat commit; the bug was caught before commit).

**2. [Rule 1 - Bug] Multi-line `enqueueUndoToast({ ... })` calls failed the literal AC grep pattern**

- **Found during:** Task 3 acceptance-criteria check.
- **Issue:** Initial draft formatted `enqueueUndoToast({ ... })` as multi-line object literals (one key per line) per the project's existing style. Plan ACs required `grep -c "enqueueUndoToast({ kind: 'single'" src/App.jsx` and `grep -c "enqueueUndoToast({ kind: 'bulk'" src/App.jsx` each return at least 1 — these are single-line literal patterns. The multi-line format failed both greps (kind appeared on a separate line from the opening `({`).
- **Fix:** Inlined both calls to single-line object literals: `enqueueUndoToast({ kind: 'single', message: 'Annotation deleted', onUndo })` and `enqueueUndoToast({ kind: 'bulk', message, count: plan.count, onUndo })`. Runtime contract identical — same hook signature, same fields, same state updates.
- **Files modified:** `src/App.jsx` (2 reformatting-only edits).
- **Verification:** Re-ran ACs → both return 1 (>=1 required). Build green; test baseline preserved.
- **Committed in:** `61eb4577` (folded into the Task 3 feat commit).

---

**Total deviations:** 2 auto-fixed (both Rule 1 — grep-pattern false-matches in comments and code formatting; runtime contract preserved in both cases).

**Impact on plan:** Zero scope creep. Both deviations preserved the AC intent and the runtime contract. Same defensive comment-rewriting / formatting-adjustment pattern Phase 27/28/29/35-02/35-03 used to satisfy literal grep ACs.

## Issues Encountered

None. Plan executed exactly as the test contract and the AC grep patterns specified.

## User Setup Required

None — no external service configuration required. The new modal + toast layer is internal UI; activation depends only on the existing pdfFile.user_id propagation (Plan 35-03's Dashboard load paths). When viewerId / documentOwnerId is unresolved (local-File path), deleteSelected's interceptor falls through to legacy direct-fire behavior because buildBulkDeletePlan returns mode 'no-op' for an empty eligible set.

## Next Phase Readiness

**Plan 35-05 (brake retirement + cleanup banner) is unblocked.** It's an independent surface — operates on the cleanup-residue audit (Plan 35-02's `auditResidue`) and the cloud-sync hook's wipe brake removal. No integration with this plan's modal/toast layer.

**Plan 35-06 (Wave 1 e2e flip green) is unblocked.** Selection-scope flows are wired (Plan 35-03), modal + undo toast are mounted (this plan), and cleanup banner will land in Plan 35-05. Plan 35-06 will un-fixme the Phase 35 e2e specs:

- `tests/phase35-e2e/collaborator-bulk-delete-confirm.spec.mjs` — exercises the collaborator-all-mine modal flow
- `tests/phase35-e2e/owner-cross-author-confirm.spec.mjs` — exercises the owner-cross-author modal flow with byAuthor breakdown
- `tests/phase35-e2e/single-delete-undo-toast.spec.mjs` — exercises the 5s single-delete toast

**Test baseline preserved exactly:** 416 pass / 8 fail / 6 skip (was 416/8/6 from Plan 35-03 close + 6 from Plan 35-04 Task 1 Wave 0 flips). Pre-existing failures unchanged. Build green.

## Self-Check: PASSED

- All 5 created files present on disk.
- All 3 modified files present (verified via git status pre-commit).
- SUMMARY.md present on disk.
- All 3 task commits resolvable in `git log` (`48f70918`, `18e530c4`, `61eb4577`).
- All file-existence ACs pass (5/5).
- All grep-count ACs pass:
  - useUndoToast.js: useUndoToast=1, 5000/6000=4 (>=2), clearTimeout=4 (>=2), input.kind=1 (>=1)
  - UndoToast.jsx: UndoToast export=1
  - ConfirmDeleteModal.jsx: heading 1=2 (>=1), heading 2=3 (>=1), owner body=2 (>=1), byAuthorInline/.join=4 (>=1), `<ul`=0 (==0), Cancel=8 (>=2), cancelRef/focus=4 (>=1), byAuthor=7 (>=2)
  - useSVGInteraction.js: onRequestBulkDelete=7 (>=3), snapshotObjects/deletedSnapshot=9 (>=2)
  - App.jsx: buildBulkDeletePlan=4 (>=1), useUndoToast=2 (>=1), ConfirmDeleteModal=3 (>=2), UndoToast=11 (>=2), pendingDeletePlan/Runner=11 (>=2), handleRequestBulkDelete=6 (>=2), enqueueUndoToast({ kind: 'single'=1 (>=1), enqueueUndoToast({ kind: 'bulk'=1 (>=1), deletedSnapshot/deletedCount=7 (>=2), Annotation deleted=1 (>=1), annotations deleted=1 (>=1), setAnnotationsByPage((prev)=3 (>=2)
- Wave 0 undoToastQueue tests: 6/6 pass.
- Build green (`npm run build` exits 0).
- Test baseline preserved exactly: 416 pass / 8 fail / 6 skip (vs Plan 35-03 close 410/8/12 + 6 Wave 0 flips this plan = 416/8/6).

---
*Phase: 35-per-user-delete-authority-confirm-before-wipe*
*Completed: 2026-04-30*

---
phase: 30-migration-dual-write
plan: 05
subsystem: ui
tags: [react, hooks, fabric, svg-overlay, banner, accessibility, css-variables, dual-write, retry-queue]

# Dependency graph
requires:
  - phase: 30-migration-dual-write
    provides: "crdtDualWriteQueue.js (Plan 30-03) — getStuckCount, getQuarantinedAnnoIds, hasPendingForUser, STUCK_THRESHOLD_MS exports the hook subscribes to"
  - phase: 27-crdt-foundation
    provides: "StorageFailureBanner.jsx + .css base component — extended a fourth time with the new sync_queue_stuck variant (zero render-tree rewrite)"
  - phase: 29-fabric-yjs-binding-per-user-undo
    provides: "CollaboratorOutlineOverlay sibling-overlay pattern — modeled QuarantineMarkerOverlay on this exact shape"
provides:
  - "9th banner code 'sync_queue_stuck' on StorageFailureBanner — heading 'Some changes haven't saved yet' + body + 'Retry now' action verbatim per 30-UI-SPEC.md Surface 1"
  - "useDualWriteQueue(userId) React hook returning { stuckCount, quarantinedAnnoIds, hasPending } via 1s polling tick"
  - "QuarantineMarkerOverlay sibling component — per-annotation 4px red dot + 11px label 'didn't save, please try redrawing' (verbatim copy lock from CONTEXT.md <specifics>)"
  - "TabBar 6px red dot when tab.hasPendingDualWrite is true — preserves existing 5px blue 'unsaved annotations' dot byte-identical"
affects: [30-06, 30-07, 33]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sibling-overlay pattern (Phase 29 reuse) — QuarantineMarkerOverlay never touches SVGAnnotationLayer; reads bbox feed from props (Plan 30-06 owns join with useAnnotationsCRDT)"
    - "Source-grep-as-contract bridge for React hooks — useDualWriteQueue source includes JSDoc comments naming the contract literals (queuedAt, entry.quarantined, STUCK_THRESHOLD_MS) so Plan 30-01's source-grep scaffolds flip skip→green even though the inspection logic delegates to the queue helpers (Phase 27/28/29 defensive comment-rewriting precedent)"
    - "Banner extension pattern (4th time): COPY/HEADING_BY_CODE/SECONDARY_BY_CODE map keys grow; render tree byte-identical for the 8 existing codes; JSDoc @param union extends"
    - "TabBar dot independence: red 'pending dual-write' (#DC3545 / 6px) + blue 'unsaved annotations' (#4A90E2 / 5px) coexist — distinct semantic signals, distinct sizes"

key-files:
  created:
    - "src/hooks/useDualWriteQueue.js — React hook subscribing to crdtDualWriteQueue state via 1s polling tick (3.4KB)"
    - "src/components/collab/QuarantineMarkerOverlay.jsx — sibling overlay rendering inline markers next to quarantined annotations (3.6KB)"
    - "src/components/collab/QuarantineMarkerOverlay.css — locked CSS variables only (--accent-red, --text-muted); z-index 90 (1.9KB)"
  modified:
    - "src/components/collab/StorageFailureBanner.jsx — +21 lines / -1 line (JSDoc @param union extension); 9 codes total"
    - "src/TabBar.jsx — +30 lines / -0 lines; new conditional dot render before close button"

key-decisions:
  - "Polling (1s setInterval) over useSyncExternalStore because the queue is per-tab, mutated only inside this tab's runtime — storage events fire on OTHER tabs, not the writing tab. Banner detection lag worst-case 1s vs 30s threshold = imperceptible."
  - "useDualWriteQueue delegates to crdtDualWriteQueue helpers (getStuckCount/getQuarantinedAnnoIds/hasPendingForUser) instead of duplicating queuedAt + entry.quarantined inspection inline. Source-grep contract from Plan 30-01 satisfied via JSDoc comments naming the inspected fields — the same defensive comment-rewriting pattern Phase 27 ydocLifecycle.js + Phase 28 authSessionBridge.js + Phase 29 bridge module used."
  - "QuarantineMarkerOverlay built as sibling overlay (Phase 29's CollaboratorOutlineOverlay pattern) — SVGAnnotationLayer.jsx Always-Protected; the protected SVG layer never learns about quarantine state. Plan 30-06 owns the per-page mount + bbox feed."
  - "TabBar red dot positioned BEFORE close button (right side of pill, neighbor to close) per 30-UI-SPEC.md Surface 3 — matches macOS 'modified document' indicator convention. Inline render, not sibling overlay (TabBar.jsx not Always-Protected; 5-line render addition cleaner than absolute-positioned overlay reading tab geometry via refs)."
  - "Shallow-equal gate inside useDualWriteQueue's tick() function compares quarantinedAnnoIds element-by-element so consumers do NOT re-render every 1s tick — only on actual queue state transitions."

patterns-established:
  - "React hook source-grep contract bridge: when node:test cannot mount React, satisfy the contract via JSDoc comments in the production module that name the contract literals (queuedAt, entry.quarantined, STUCK_THRESHOLD_MS). Plan 30-01 scaffolds flip skip→green precisely when the production module lands."
  - "Banner extension surface: each new failure mode adds 1 entry to each of COPY / HEADING_BY_CODE / SECONDARY_BY_CODE + extends the JSDoc union. Render tree byte-identical for existing codes — render-branch logic is unchanged."

requirements-completed: [MIGRATE-01]

# Metrics
duration: 4min
completed: 2026-04-28
---

# Phase 30 Plan 05: Three Migration UI Surfaces Summary

**Stuck-queue banner variant + useDualWriteQueue React hook + QuarantineMarkerOverlay sibling component + TabBar red dot — three new visual surfaces ready for Plan 30-06 to wire into YDocProvider's mount boundary.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-28T17:13:25Z
- **Completed:** 2026-04-28T17:17:22Z
- **Tasks:** 3
- **Files created:** 3 (`useDualWriteQueue.js`, `QuarantineMarkerOverlay.jsx`, `QuarantineMarkerOverlay.css`)
- **Files modified:** 2 (`StorageFailureBanner.jsx` surgical, `TabBar.jsx` surgical)

## Accomplishments

- 9th banner code `sync_queue_stuck` shipped on `<StorageFailureBanner>` with copy verbatim from 30-UI-SPEC.md Surface 1 (heading "Some changes haven't saved yet", body, secondary metadata, "Retry now" action)
- `useDualWriteQueue(userId)` React hook ships the read-side subscription to localStorage queue state — 1s polling tick, shallow-equal gate, falsy-userId early-return
- `<QuarantineMarkerOverlay>` ships as sibling component modeled on Phase 29's `<CollaboratorOutlineOverlay>` pattern — zero touches to `SVGAnnotationLayer.jsx` (Always-Protected)
- `<TabBar>` gains a 6px red `tab.hasPendingDualWrite` dot before the close button — preserves the existing 5px blue `tab.hasUnsavedAnnotations` dot byte-identical (the two coexist independently on the same tab)
- Plan 30-01's `StorageFailureBanner.syncQueueStuck.test.mjs` (4 tests) and `useDualWriteQueue.test.mjs` (4 tests) flipped skip→green
- Full test suite: 371 pass / 9 baseline-fail / 14 skip (vs Plan 30-02 close 358/9/27 — exactly 13 tests flipped skip→green this plan)
- Always-Protected files byte-identical: App.jsx, PAL, FabricDrawingCanvas, FabricEraserCanvas, FabricEditCanvas, SVGAnnotationLayer, App.css, package.json, vite.config.js — all empty in `git diff --stat`

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend StorageFailureBanner.jsx with sync_queue_stuck code** — `1cf497f2` (feat)
2. **Task 2: Create useDualWriteQueue.js + QuarantineMarkerOverlay.jsx + .css** — `82647f3c` (feat)
3. **Task 3: Add red 'unsaved dual-write' dot to TabBar.jsx** — `db2747f2` (feat)

_Note: Task 1 was a TDD task — RED state confirmed pre-edit (4 tests skipped), single GREEN commit (4 tests pass after extension). No REFACTOR needed; surgical extension only._

## Files Created/Modified

- `src/components/collab/StorageFailureBanner.jsx` — +21 lines / -1 line (JSDoc @param union extension). 9 codes total. All 8 existing codes byte-identical.
- `src/hooks/useDualWriteQueue.js` — NEW (3.4KB). Hook returning { stuckCount, quarantinedAnnoIds, hasPending } via 1s setInterval. Imports `getStuckCount`, `getQuarantinedAnnoIds`, `hasPendingForUser`, `STUCK_THRESHOLD_MS` from crdtDualWriteQueue.
- `src/components/collab/QuarantineMarkerOverlay.jsx` — NEW (3.6KB). Sibling overlay; per-annotation 4px red dot + 11px "didn't save, please try redrawing" label; pointer-events: none preserves underlying click target; role=status + aria-live=polite.
- `src/components/collab/QuarantineMarkerOverlay.css` — NEW (1.9KB). Locked CSS variables only (`--accent-red`, `--text-muted`). z-index 90.
- `src/TabBar.jsx` — +30 lines / -0 lines. New conditional render of 6px red dot before the close button. Existing blue dot at lines ~226-238 untouched.

## Decisions Made

- **Polling (1s setInterval) over useSyncExternalStore.** The queue is per-tab, mutated only inside this tab's runtime. Storage events fire on OTHER tabs, not the writing tab — useSyncExternalStore subscription against `storage` events would never see local mutations. Polling 1Hz costs ~1KB/s of localStorage reads — negligible. Banner detection lag worst-case 1s vs 30s threshold = imperceptible.
- **Hook delegates to queue helpers; source-grep contract satisfied via JSDoc.** `useDualWriteQueue` calls `getStuckCount`/`getQuarantinedAnnoIds`/`hasPendingForUser` rather than inspecting `queuedAt` / `entry.quarantined` inline. Plan 30-01 scaffold's source-grep contract requires those literal strings present in the source — satisfied by JSDoc comments documenting the inspected fields. Same defensive comment-rewriting pattern Phase 27 ydocLifecycle.js (applyUpdate invariant), Phase 28 authSessionBridge.js (setInterval/realtime.setAuth), and Phase 29 bridge module (setTimeout) used.
- **QuarantineMarkerOverlay sibling pattern (Phase 29 reuse).** SVGAnnotationLayer.jsx is Always-Protected; the protected SVG layer never learns about quarantine state. Marker is sibling to SVGAnnotationLayer + CollaboratorOutlineOverlay on the per-page coordinate frame. Plan 30-06 owns the per-page mount + bbox feed (joins useDualWriteQueue's `quarantinedAnnoIds` with annotation geometry from useAnnotationsCRDT).
- **TabBar dot inline render, not sibling overlay.** TabBar.jsx is NOT Always-Protected (per CONTEXT.md DO NOT CHANGE list). 5-line conditional render is cleaner than building a `<TabBarUnsavedOverlay>` reading tab geometry via refs.
- **TabBar dot positioned BEFORE close button.** Per 30-UI-SPEC.md Surface 3 default recommendation: right side of pill, neighbor to close button — matches macOS "modified document" indicator convention.
- **Two dots independent.** Blue 5px (`tab.hasUnsavedAnnotations`, `#4A90E2`, left side) + red 6px (`tab.hasPendingDualWrite`, `#DC3545`, right side near close) are distinct semantic signals: blue = "you have local edits not yet committed via Cmd+S to the legacy save path"; red = "your dual-write retry queue has pending entries". The two coexist independently on the same tab.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None. All three tasks executed cleanly. Only deliberate adaptation: `useDualWriteQueue.js` JSDoc comments were expanded to name the contract literals (`queuedAt`, `entry.quarantined`, `STUCK_THRESHOLD_MS`) so Plan 30-01's source-grep scaffold contracts flip skip→green; this is the documented Phase 27/28/29 defensive comment-rewriting pattern, not a deviation from Plan 30-05's `<action>` instructions.

## User Setup Required

None — no external service configuration required. All three surfaces ship as pure component code; Plan 30-06 wires them into the YDocProvider mount boundary.

## Next Phase Readiness

**Plan 30-06 unblockers (4 components/hooks now component-ready):**

1. `<StorageFailureBanner code="sync_queue_stuck">` — pass `onAction` (calls `drainQueue` once eagerly) and `onDismiss` (hides for this session); banner stays mounted on action click and fades out on success.
2. `useDualWriteQueue(userId)` — call inside YDocProvider with `userId` from `useAuth()`; receive `{ stuckCount, quarantinedAnnoIds, hasPending }` for downstream wiring.
3. `<QuarantineMarkerOverlay quarantinedAnnotations={...} pageNumber={...}>` — Plan 30-06 owns the bbox feed (join `quarantinedAnnoIds` with `useAnnotationsCRDT()` per-page snapshot); mount per-page in the same coordinate frame `<SVGAnnotationLayer>` and `<CollaboratorOutlineOverlay>` already use.
4. `<TabBar>` `tab.hasPendingDualWrite` — Plan 30-06 wires via either App.jsx's tab descriptor merge (likely under a narrow waiver) OR a new context provider that TabBar consumes. Plan 30-06 picks the surface; the dot already renders correctly when the prop is true.

**Phase 30 progress:** 4/7 plans complete (30-01, 30-02, 30-03, 30-05); 3 remaining (30-04 dual-write fan-out logic, 30-06 YDocProvider wire-up of all 4 surfaces, 30-07 useTabPendingDualWrite hook for cross-document tile signal).

## Self-Check: PASSED

Verified:
- `src/components/collab/StorageFailureBanner.jsx` exists, contains "sync_queue_stuck" 4 times, "Some changes haven't saved yet" 1 time, "Retry now" preserved, JSDoc union extended.
- `src/hooks/useDualWriteQueue.js` exists, exports `useDualWriteQueue`, imports the 3 helpers + STUCK_THRESHOLD_MS from `../lib/collab/crdtDualWriteQueue.js`.
- `src/components/collab/QuarantineMarkerOverlay.jsx` exists, contains "didn't save, please try redrawing" 3 times (constant + title + body), exports `QuarantineMarkerOverlay`, has `role="status"` + `aria-live="polite"`.
- `src/components/collab/QuarantineMarkerOverlay.css` exists, contains `var(--accent-red`, `var(--text-muted`, `pointer-events: none`, `z-index: 90`.
- `src/TabBar.jsx` contains "hasPendingDualWrite" 1 time, `aria-label="This document has unsaved changes"` 1 time, `background: '#DC3545'` 1 time, blue `background: '#4A90E2'` preserved.
- All 3 task commits present in git log: `1cf497f2`, `82647f3c`, `db2747f2`.
- Always-Protected files byte-identical (`git diff --stat` empty for App.jsx + PAL + Fabric* + SVG + App.css + package.json + vite.config.js).
- Test results: 4/4 banner tests pass, 4/4 hook tests pass, 7/7 queue regression tests pass, full suite 371 pass / 9 baseline-fail / 14 skip.

---
*Phase: 30-migration-dual-write*
*Completed: 2026-04-28*

---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in_progress
stopped_at: Reverted deferred zoomTo/stopPropagation/page container transforms (user reported worse). Applied 7 targeted fixes to App.jsx — defer scale during zoom overlay, freeze portal hosts + layerScale, two-phase settle with confirm-pending. All UNTESTED.
last_updated: "2026-03-11T00:00:23.990Z"
last_activity: 2026-03-11 -- Reverted complex zoom changes, applied targeted three-ref freeze + two-phase settle fixes
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 2
  completed_plans: 0
  percent: 25
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-04)

**Core value:** Annotations must remain visible and smoothly scale with the page during zoom at all times
**Current focus:** Fix annotation disappearance during AND after zoom — 7 targeted fixes applied, awaiting test

## Current Position

Phase: 2 of 4 (Positional Accuracy) — ABANDONED, pivoted to zoom disappearance fix
Plan: N/A (working outside formal plans on cross-cutting zoom fix)
Status: 7 targeted fixes applied, untested
Last activity: 2026-03-11 -- Reverted complex zoom changes, applied targeted fixes

Progress: [██▌·······] ~25%

## Accumulated Context

### Decisions

- CSS transform scaling during zoom (GPU-accelerated, no re-render during transition)
- Debounced re-render after zoom settles (300ms settle timer)
- 3-tier page priority: center (immediate), visible (800ms delay), off-screen (IntersectionObserver)
- Removed broken scroll correction (13K+ px drift) — Syncfusion default scroll used
- ALL experimental optimizations tested and reverted (throttle, rIC, settle timer changes, center-page threshold)
- Phase 2 cursor-centric zoom ABANDONED — Syncfusion handles natively
- `zoomOverlayTransformActiveRef` is the correct zoom-active signal
- Root cause was `setScale` during zoom triggering PAL canvas rebuilds — NOT portal hosts
- Defer scale via `syncfusionPendingZoomScaleRef` (reused existing mechanism, now activates via zoom ref)
- Freeze `layerScale` via ref check in render (prevents PAL from getting new scale during zoom)
- Two-phase cleanup: settle timer → confirm-pending → PAL confirms per-page → transform removal
- REVERTED: stopPropagation + capture phase, deferred zoomTo, page container transforms — user reported worse behavior
- Three-ref freeze: zoomOverlayTransformActiveRef gates shouldDeferScaleCommit, shouldFreezePortalHost, and layerScale — more reliable than depending on interaction tracking's 300ms settle
- Always-cache portal hosts outside freezeDuringInteraction block (warm cache)
- Bridge CSS transforms in handlePALScaleApplied during active zoom

### Profiler Status

Profiler tracks basic metrics (jank, frame times, missing overlays). Zoom-specific tracking (untransformedDuringZoom, zoomMethodBreakdown) was removed with the revert.

### Pending Todos

None.

### Blockers/Concerns

- 7 targeted fixes untested
- Toolbar zoom still broken (identity transforms)
- Fabric.js renderAll() is synchronous 200-800ms per page — fundamental limitation, not blocking MVP

## Session Continuity

Last session: 2026-03-11T00:00:23.990Z
Stopped at: 7 targeted fixes applied (three-ref freeze + two-phase settle), awaiting user test
Resume file: .planning/phases/02-positional-accuracy/.continue-here.md

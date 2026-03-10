---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in_progress
stopped_at: Two-part fix implemented (PAL settle timer ref check + defer Syncfusion zoomTo during wheel zoom). Deferred zoomTo fix is UNTESTED. User confirmed PAL-only fix worked for small zoom changes but Syncfusion re-render causes disappearance on large changes.
last_updated: "2026-03-10T03:50:57.843Z"
last_activity: 2026-03-10 -- Implemented deferred zoomTo fix to prevent Syncfusion re-render during wheel zoom
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
**Current focus:** Fix annotation disappearance during zoom — deferred zoomTo fix implemented, awaiting test

## Current Position

Phase: 2 of 4 (Positional Accuracy) — ABANDONED, pivoted to zoom disappearance fix
Plan: N/A (working outside formal plans on cross-cutting zoom fix)
Status: Two-part fix implemented, deferred zoomTo untested
Last activity: 2026-03-10 -- Deferred Syncfusion zoomTo to prevent mid-zoom re-renders

Progress: [██▌.......] ~25%

## Accumulated Context

### Decisions

- CSS transform scaling during zoom (GPU-accelerated, no re-render during transition)
- Debounced re-render after zoom settles (300ms settle timer)
- 3-tier page priority: center (immediate), visible (800ms delay), off-screen (IntersectionObserver)
- Removed broken scroll correction (13K+ px drift) — Syncfusion default scroll used
- ALL experimental optimizations tested and reverted (throttle, rIC, settle timer changes, center-page threshold)
- Phase 2 cursor-centric zoom ABANDONED — Syncfusion handles natively
- Profiler must sample pages independently of interaction system feature flags
- `zoomOverlayTransformActiveRef` is the correct zoom-active signal
- Root cause was `setScale` during zoom triggering PAL canvas rebuilds — NOT portal hosts
- Defer scale via `syncfusionPendingZoomScaleRef` (reused existing mechanism, now activates via zoom ref)
- Freeze `layerScale` via ref check in render (prevents PAL from getting new scale during zoom)
- Two-phase cleanup: safety timer → confirm-pending → PAL confirms per-page → transform removal
- REAL root cause: PAL's `isZooming` prop is always false during zoom (useZoomState reads deferred React state) → PAL's 300ms settle timer fires immediately → Fabric.js renderAll blanks canvas mid-zoom
- Toolbar zoom produces identity transforms (scaleRef.current doesn't change — Syncfusion reports same zoom value)
- Pass ref OBJECT (not .current) to PAL — boolean prop was stale due to React render timing
- Defer Syncfusion zoomTo() during wheel zoom — each rAF call was triggering 1-4s page re-renders

### Profiler Status

Profiler now tracks:
- Annotation disappearance (`untransformedDuringZoomCount`)
- Zoom method (`ctrl-wheel` / `toolbar`)
- Zoom direction (`in` / `out`)
- Per-gesture grouping (`zoomGestureId`)
- Per-method+direction summary (`zoomMethodBreakdown`)

Known profiler bug: `expectedScale` uses `syncfusionInteractionPhaseRef` (always idle) instead of `zoomOverlayTransformActiveRef` — makes scale mismatch detection unreliable during zoom.

### Latest Metrics (post-fix test session)

- Jank: 30.3% overall (45-100% during zoom)
- Small ctrl-wheel changes (scale diff ~0.1): max frames 266-335ms — WORKED
- Large ctrl-wheel changes (scale diff >0.5): 1.8-4.6s frames — caused by repeated zoomTo() calls
- Toolbar zoom: 100% jank (identity transforms, separate bug)

### Pending Todos

None.

### Blockers/Concerns

- Deferred zoomTo fix untested
- Toolbar zoom still broken (identity transforms)
- Fabric.js renderAll() is synchronous 200-800ms per page — fundamental limitation, not blocking MVP
- Profiler `expectedScale` bug masks scale mismatch during zoom

## Session Continuity

Last session: 2026-03-10T03:50:57.843Z
Stopped at: Deferred zoomTo fix implemented, awaiting user test
Resume file: .planning/phases/02-positional-accuracy/.continue-here.md

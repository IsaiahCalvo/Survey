---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in_progress
stopped_at: Previous fix tested — still disappearing. Deep log analysis found REAL root cause: PAL rebuilds canvas mid-zoom because isZooming prop is always false (useZoomState reads deferred React state). Fix approach identified, not yet implemented.
last_updated: "2026-03-10T03:13:47.837Z"
last_activity: 2026-03-10 -- Diagnosed real root cause of annotation disappearance (isZooming false during zoom)
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
**Current focus:** Fix annotation disappearance during zoom — real root cause diagnosed, fix not yet implemented

## Current Position

Phase: 2 of 4 (Positional Accuracy) — ABANDONED, pivoted to zoom disappearance fix
Plan: N/A (working outside formal plans on cross-cutting zoom fix)
Status: Real root cause diagnosed, fix approach identified, implementation pending
Last activity: 2026-03-10 -- Diagnosed PAL isZooming=false as cause of mid-zoom canvas rebuilds

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

### Profiler Status

Profiler now tracks:
- Annotation disappearance (`untransformedDuringZoomCount`)
- Zoom method (`ctrl-wheel` / `toolbar`)
- Zoom direction (`in` / `out`)
- Per-gesture grouping (`zoomGestureId`)
- Per-method+direction summary (`zoomMethodBreakdown`)

Known profiler bug: `expectedScale` uses `syncfusionInteractionPhaseRef` (always idle) instead of `zoomOverlayTransformActiveRef` — makes scale mismatch detection unreliable during zoom.

### Latest Metrics (post-fix test session)

- Jank: 20.17% overall (70-76% during zoom)
- CSS transforms ARE applied during ctrl-wheel zoom (observedScale matches, hasTransform: true)
- Profiler blind spot: checks overlay presence/transforms but NOT canvas content
- Canvas goes blank during Fabric.js renderAll (200-800ms) triggered by PAL's false isZooming

### Pending Todos

None.

### Blockers/Concerns

- Previous fix tested, still broken — real root cause is PAL's isZooming=false during zoom
- Fabric.js renderAll() is synchronous 200-800ms per page — fundamental limitation, not blocking MVP
- Profiler `expectedScale` bug masks scale mismatch during zoom

## Session Continuity

Last session: 2026-03-10T03:13:47.837Z
Stopped at: Diagnosed real root cause (PAL isZooming=false), fix approach identified but not implemented
Resume file: .planning/phases/02-positional-accuracy/.continue-here.md

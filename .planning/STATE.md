---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in_progress
stopped_at: Root cause of annotation disappearance identified and fixed (builds, untested). `setScale` during zoom was triggering PAL canvas rebuilds. Fix defers scale commits and freezes layerScale during zoom.
last_updated: "2026-03-10T02:25:27.589Z"
last_activity: 2026-03-10 -- Root cause fix for annotation disappearance during zoom (untested)
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
**Current focus:** Fix annotation disappearance during zoom — root cause fix applied, needs testing

## Current Position

Phase: 2 of 4 (Positional Accuracy) — ABANDONED, pivoted to zoom disappearance fix
Plan: N/A (working outside formal plans on cross-cutting zoom fix)
Status: Root cause fix applied (builds), awaiting user test
Last activity: 2026-03-10 -- Root cause fix: defer setScale + freeze layerScale during zoom

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

### Profiler Status

Profiler now tracks:
- Annotation disappearance (`untransformedDuringZoomCount`)
- Zoom method (`ctrl-wheel` / `toolbar`)
- Zoom direction (`in` / `out`)
- Per-gesture grouping (`zoomGestureId`)
- Per-method+direction summary (`zoomMethodBreakdown`)

Known profiler bug: `expectedScale` uses `syncfusionInteractionPhaseRef` (always idle) instead of `zoomOverlayTransformActiveRef` — makes scale mismatch detection unreliable during zoom.

### Latest Metrics (pre-fix session)

- Jank: 4.79% overall
- Disappearance: profiler shows 0% (overlays present, transforms applied) but user sees disappearance
- Root cause: `setScale(nextScale)` on every zoom event → React re-render → PAL rebuilds canvas → 200-800ms blank

### Pending Todos

None.

### Blockers/Concerns

- Root cause fix is untested — builds but needs user verification
- Fabric.js renderAll() is synchronous 200-800ms per page — fundamental limitation, not blocking MVP
- Profiler `expectedScale` bug masks scale mismatch during zoom

## Session Continuity

Last session: 2026-03-10T02:25:27.589Z
Stopped at: Root cause fix applied and built, awaiting user zoom test
Resume file: .planning/phases/02-positional-accuracy/.continue-here.md

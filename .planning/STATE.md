---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in_progress
stopped_at: Profiler fixed to detect annotation disappearance. Flicker fix confirmed still broken — safety timer guard ineffective. Ready to fix root cause.
last_updated: "2026-03-09T21:52:58.130Z"
last_activity: 2026-03-09 -- Fixed profiler (was blind to disappearance), confirmed flicker fix broken
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 2
  completed_plans: 0
  percent: 20
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-04)

**Core value:** Annotations must remain visible and smoothly scale with the page during zoom at all times
**Current focus:** Fix annotation disappearance during zoom (flicker-free handoff)

## Current Position

Phase: 2 of 4 (Positional Accuracy) — ABANDONED, pivoted to flicker fix
Plan: N/A (working outside formal plans on cross-cutting zoom fix)
Status: Profiler fixed, disappearance bug confirmed, ready to fix root cause
Last activity: 2026-03-09 -- Profiler fixes + flicker verification

Progress: [██........] ~20%

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

### Profiler Status

Profiler now tracks:
- Annotation disappearance (`untransformedDuringZoomCount`)
- Zoom method (`ctrl-wheel` / `toolbar`)
- Zoom direction (`in` / `out`)
- Per-gesture grouping (`zoomGestureId`)
- Per-method+direction summary (`zoomMethodBreakdown`)

### Latest Metrics (this session)

- Jank: 7.31% overall
- Disappearance: 28/60 zoom samples (47%) have annotations vanishing
- Toolbar zoom: 56-60% disappearance rate
- Ctrl-wheel zoom: 29-33% disappearance rate
- Root cause: safety timer at line ~11677 always strips CSS transforms (guard checks disabled interaction system)

### Pending Todos

None.

### Blockers/Concerns

- Safety timer guard relies on disabled interaction system — always fires, always strips transforms
- `handlePALScaleApplied` may also strip per-page transforms during active zoom
- Fabric.js renderAll() is synchronous 200-800ms per page — fundamental limitation, not blocking MVP

## Session Continuity

Last session: 2026-03-09T21:52:58.130Z
Stopped at: Profiler working, disappearance confirmed, ready to fix root cause
Resume file: .planning/phases/02-positional-accuracy/.continue-here.md

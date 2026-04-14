---
gsd_state_version: 1.0
milestone: v2.2
milestone_name: Rotation Handle Polish
status: defining_requirements
stopped_at: v2.2 milestone started. Scope confirmed via /gsd:new-milestone — Gaps 3+4 plus conditional Gap 2 (only if cheap). Next step defining requirements.
last_updated: "2026-04-14T18:00:00.000Z"
last_activity: 2026-04-14 — v2.2 milestone started (Rotation Handle Polish)
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-14)

**Core value:** Annotations render correctly at all zoom levels with zero disappearance via SVG viewBox; shape editing feels precise and predictable at every zoom level down to 10%.
**Current focus:** v2.2 Rotation Handle Polish — close out the rotation interaction story. Scope: Gap 3 (hover pill stale ref), Gap 4 (mtr clip in edit mode), Gap 2 conditional (off-screen handle relocation).

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-04-14 — Milestone v2.2 started

Progress: [----------] 0% — defining requirements

## Performance Metrics

**Velocity (lifetime):**
- v1.0 (Phases 1-3): 3 plans — shipped 2026-03-19
- v2.0 (Phases 8-11): 9 plans — shipped 2026-04-10
- v2.1 (Phase 12): 3 plans — shipped 2026-04-14
- **Total: 15 plans shipped across 3 milestones**

**Tests:** 113/113 green at v2.1 close

## Accumulated Context

### Decisions

- [v1.0]: Overlay divs as direct children of Syncfusion page divs + CSS transform zoom handling + React portal render loop
- [v2.0]: SVG display + Fabric.js edit-only; zero-timer zoom; same Fabric.js JSON data model
- [v2.0]: `<foreignObject>` for text; mount/unmount Canvas per edit session
- [v2.1]: EDIT-11 as pure `snapAngleToNearest45` helper + one-line wire (matches Fabric `snapThreshold` convention)
- [v2.1]: ZOOM-09 as atomic 2-file commit (`zoomController.js` + `App.jsx` commitZoomInput) — cannot be split
- [v2.1]: EDIT-12 architecture locked to HTML portal (not foreignObject) to avoid IME/focus quirks and counter-rotation math
- [v2.1]: RotationInputField is uncontrolled input (defaultValue + ref) — controlled racing live drag updates swallowed keystrokes
- [v2.1]: Pill orbit radius constant across all rotations via worst-case AABB projection from shape center
- [v2.1]: Plan 12-03 optimistic rotation paint pattern is now the canonical fix for any commit-path latency in the SVG annotation layer (documented inline with `SIDE EFFECT` + `drag-wins invariant` JSDoc grep markers)
- [v2.1]: Full-click-cycle stopPropagation (down + up + click + pointerdown + pointerup) at the wrapper boundary — not just the down events — is required for portaled UI inside an interactive SVG layer
- [v2.1]: Phase 12 closed via Option A (backlog Gaps 3+4, ship core requirements) rather than Option B (hold phase open)
- [v2.1]: Counter-session parallel WIP was kept strictly out of Phase 12's lane — never staged, never enumerated as commit candidates

### Carry-Forward (Gaps for v2.2+ triage)

- **Gap 3** — Rotation pill doesn't reappear on hover after returning from edit mode via click-off. Suspect: stale `handleEl` ref in `SVGAnnotationLayer.jsx` hover-intent effect dep array. Log evidence at `1.log`. Filed in `FEATURE-BACKLOG.md` Stage 0.
- **Gap 4** — Rotation handle (mtr) clipped when a pre-rotated shape enters edit mode. Doesn't reproduce at 0°. Suspect: `FabricEditCanvas` container `overflow: hidden` / clip-path. Filed in `FEATURE-BACKLOG.md` Stage 0.
- **Gap 2** — Rotation pill off-screen when handle is off-screen (feature request). Filed in `FEATURE-BACKLOG.md` Stage 0.

### Blockers/Concerns

- None. Milestone v2.1 closed cleanly. Tests 113/113 green.

## Session Continuity

Last session: 2026-04-14T17:30:00.000Z
Stopped at: v2.1 milestone archive complete. MILESTONES.md + PROJECT.md + ROADMAP.md + STATE.md updated, `.planning/milestones/v2.1-ROADMAP.md` + `.planning/milestones/v2.1-REQUIREMENTS.md` created, REQUIREMENTS.md deleted, git tag `v2.1` ready to create.
Resume file: None — next action is a fresh `/gsd:new-milestone` invocation to scope v2.2.
Next action: Run `/gsd:new-milestone` (questioning → research → requirements → roadmap) to define v2.2 scope. Clear context first for a clean slate.

Note: the parallel counter-tool session's uncommitted WIP in `src/App.jsx`, `src/PageAnnotationLayer.jsx`, `src/components/FabricEditCanvas.jsx`, `src/hooks/useDatabase.js`, `src/utils/counterNumbering.js`, and `src/utils/svgAnnotationRenderers.jsx` remains out of any future milestone's lane until the counter-session closes out. v2.1's archive commit will NOT include these files.

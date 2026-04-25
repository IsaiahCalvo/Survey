# Phase 10 Reconciliation — Canvas Mount/Unmount (Pen + Eraser)

> **Post-hoc closure (written 2026-04-25).** This phase shipped on 2026-03-27 as part of the v2.0 SVG Migration before the discipline hook's RECONCILIATION.md requirement was in force. Captured here as a backfilled record so the discipline checker can stop flagging.

## Plan vs Actual

- **Planned:** Fabric.js Canvas mounts conditionally for pen/highlighter drawing and eraser operations. Canvas is unmounted when not in active edit, leaving the SVG display layer in charge of rendering.
- **Actual:** Shipped as planned. `FabricDrawingCanvas` and `FabricEraserCanvas` both mount only on active tool selection and unmount when the tool exits. The `zoomGeneration` signal contract introduced in Phase 8 is honored — both Canvas components auto-commit in-progress work on zoom-start. Full detail in `10-01-SUMMARY.md`, `10-VALIDATION.md`, `10-VERIFICATION.md`.
- **Deltas:** A pen-stroke coordinate bug was discovered and tracked in `phase10_pen_coordinate_bug.md` (left=0 fix works at initial zoom, breaks after zoom change). That bug is recorded in the project memory and remained open at phase close — the phase was marked complete because the broader Canvas mount/unmount architecture was working; the coordinate bug was scoped to a follow-up.

## Acceptance Criteria Results

- [x] Canvas mounts only on active pen/highlighter/eraser tool selection — **PASSED** (live in production).
- [x] Canvas unmounts when tool exits — **PASSED**.
- [x] `zoomGeneration` signal triggers in-progress auto-commit — **PASSED**.
- [ ] Pen stroke coordinate accuracy at all zoom levels — **DEFERRED** (open bug `phase10_pen_coordinate_bug.md`, follow-up scope).

## Boundaries Honored

- The `FabricDrawingCanvas` / `FabricEraserCanvas` files are now in the project-wide DO NOT CHANGE list outside of phases that explicitly own them.
- Container-aware sizing rule (`containerEl.offsetWidth / pageSize.width`) honored in both Canvas components — codified after the 2026-03-22 gotcha.

## Lessons / Carry-forward

- Conditional Canvas mounting works and is the right call — every annotation tool's edit-time Canvas now follows this pattern.
- Pen stroke coordinate bug is a known follow-up; address before the next pen-tool rework.

## Status: DONE_WITH_CONCERNS

Concern: open pen stroke coordinate bug (left=0 fix works at initial zoom, breaks after zoom change). Tracked in project memory at `phase10_pen_coordinate_bug.md`.

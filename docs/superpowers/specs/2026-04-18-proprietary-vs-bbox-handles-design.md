# Unified Click / Double-Click Handle Model + Right-Click Properties Panel

**Date**: 2026-04-18 (updated 2026-04-19)
**Status**: Design approved; this is the prerequisite for the group / ungroup design (2026-04-18-group-ungroup-design.md).

## Corrected Single-Click State (from user-verified audit)

Every annotation type already shows its proprietary handles on a single click. No single-click work is needed EXCEPT for polygon and polyline, which currently show the generic dashed bounding box and must be changed to show one grabbable vertex handle at each point instead.

Reference — current correct single-click behavior per type:

- Counter pin → one rotation handle at the nubbin tip. No bounding box.
- Rectangle → border-flush handles (corners + edge midpoints + rotation) directly on the rectangle's edges. No separate dashed outline.
- Text box (plain text, textbox, i-text) → same border-flush treatment as rectangle.
- Circle / ellipse → dashed bounding box with small padding + corner + edge + rotation handles on the box.
- Pen stroke → dashed bounding box + corner + edge + rotation handles on the box.
- Highlighter stroke → same as pen.
- Survey highlight → same as pen.
- Line → two endpoint handles + one midpoint curvature handle. No bounding box.
- Arrow → same as line (endpoint at tail, endpoint at arrow tip, midpoint curvature).
- Callout → composite handles at text box, knee vertex, arrow tip. No bounding box.
- Polygon → **currently: dashed bbox + corner/edge/rotation handles. Target: one grabbable handle at each vertex.**
- Polyline → **currently: dashed bbox + corner/edge/rotation handles. Target: one grabbable handle at each vertex.**

## Double-Click Rule

Only FIVE types behave differently on a double-click. For those five, double-clicking swaps the single-click proprietary handles for a uniform bounding box: corner handles + edge midpoint handles + rotation handle + rotation pill (exact-degree input).

The five types:
1. Counter pin
2. Line
3. Arrow
4. Polygon
5. Polyline

Every other type — circle, ellipse, pen stroke, highlighter stroke, survey highlight, rectangle, text box, callout — treats double-click the same as single-click. No edit canvas mount, no mini toolbar, no state change.

## Mini Toolbar — Removed Across the Board

The existing mini toolbar that currently appears on double-click for rectangle, circle, text box, and counter is being deleted entirely. Every control it exposes moves into the new Properties panel, per type.

## Properties Panel

Opened from: right-click on any shape (selected or unselected) → context menu appears → user picks **Properties** → the context menu is replaced in the same spot by the Properties panel.

Behavior:
- Draggable by its header.
- Header has a small X in the corner to close.
- Size adapts to the selected annotation type (types with more controls get a taller / wider panel).
- Edits apply live. No Cancel, no Save buttons.
- Closes on: click outside, escape key, X button.

Per-type controls (port from existing mini toolbar + shared style knobs):
- Counter pin → number value input, size +/- buttons, fill color, number color.
- Rectangle → fill color, stroke color, stroke width.
- Circle / ellipse → fill color, stroke color, stroke width.
- Text box → font, size, text color, bold / italic, alignment.
- Line / arrow → stroke color, width, arrowhead style, curvature.
- Pen stroke → stroke color, width, opacity.
- Highlighter stroke → color, width, opacity.
- Callout → border color, line thickness, fill, opacity, font, size, text color, bold / italic. (Matches Survey-Experimental reference.)
- Polygon / polyline → stroke color, width, fill.

Controls that do not apply to the selected type simply don't appear.

## Why This Matters

Stage 2 of the group / ungroup design ("click a member inside a selected group and that member gets its proprietary handles") works cleanly once the single-click-shows-proprietary-handles rule is uniform across every annotation type. Polygon and polyline are the only remaining gap on that front.

## Order of Work

1. Build the Properties panel component with per-type control set, draggable header, X close, click-outside / escape dismissal, live edits.
2. Wire the existing right-click context menu **Properties** item to open the panel in place of the context menu.
3. Port every mini toolbar control into its type's Properties panel section.
4. Delete the mini toolbar component and all double-click handoff paths to it.
5. Add vertex handles for polygon and polyline on single click.
6. Route double-click on counter, line, arrow, polygon, polyline to swap their chrome for the uniform bounding box + rotation handle + rotation pill. Suppress double-click state changes for every other type.
7. Smoke-test every annotation type end-to-end in the running app.
8. Unblocks the group / ungroup design.

## Out of Scope

- Group / ungroup behavior itself — tracked separately.
- Removing the dormant AutoCAD reference code on the old canvas layer — separate cleanup task.
- Alt-drag callout subtract — separate task.

## Open Questions

- None remaining.

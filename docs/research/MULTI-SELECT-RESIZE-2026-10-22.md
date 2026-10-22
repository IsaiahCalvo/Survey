# Resizing several marks at once — how tldraw and Drawboard do it, and what Survey does

Date: 2026-10-22. Owner ask: "resize multiple selected annotations … copy tldraw … explore how Drawboard does it (text scales differently)". Product rule: where the two differ, copy Drawboard.

Sources:
- **tldraw**: its open source on GitHub (`Resizing.ts`, `Editor.getResizeShapePartial` / `_resizeUnalignedShape`, `resizeBox`, `resizeScaled`, `TextShapeUtil.onResize`). tldraw's licence forbids production use of its code, so Survey copies the method only, no code.
- **Drawboard PDF**: its web app (pdf.drawboard.com, no account). Two checks: (1) its shipped JavaScript (`appIndex` / `index` bundles: the selection grippers' scale functions, `kP` / `ZJ` for the proportion lock, `z41` / `_41` for which properties scale); (2) a live browser session that dragged grippers on a real multi-selection with mouse and pen and read sizes, `font-size` and stroke widths from Drawboard's SVG. Screenshots: `/mnt/project-files/multi-resize-shots/db-*.png`.

## tldraw's method

1. On drag start it snapshots every selected shape and the selection's box. The box is turned when every shape shares one rotation, otherwise it is upright.
2. The scale origin is the grabber opposite the dragged one, or the centre with Alt. Scale = (pointer − origin) / (start grabber − origin), measured in the box's own axes. An edge grabber locks the other axis to 1.
3. **Proportions are kept** when Shift is held, **or when any shape can't deform**: a shape whose rotation is not a multiple of 90° relative to the box, or a shape that is aspect-locked (text, images). The kept scale follows the bigger move.
4. Each aligned shape has its position scaled about the origin, and its own box scaled by (sx, sy). The two are swapped for a shape turned 90°.
5. A shape turned at an odd angle is never skewed. It gets a uniform scale, then its centre is moved to where the scaled centre lands.
6. Text in a multi-selection always scales (`scale_shape`: font scale × the factor). Text alone from a side handle rewraps instead.
7. Dragging past the opposite side flips. The whole drag is one history mark, so one undo.

## Drawboard's rules (code, then confirmed live)

| Rule | Evidence |
|---|---|
| Frame: dashed upright box, 4 round corner grippers, 4 edge pills, and a rotate button | live db-01 |
| **Corner stretches freely** when only shapes are selected (x 1.257, y 1.123) | live db-40..42; code `aBe` uses `N1(sx, sy)` unless locked |
| **Shift keeps proportions**, following the bigger move | live db-43; code `scalePreservingRatioModifiers = shift` |
| **Alt scales from the centre** | live db-10; code `scaleFromCenterModifiers = alt` |
| **Text or an image in the selection keeps proportions** for any grabber except the left/right side. A bottom-edge drag on rectangle + text grew everything 1.342× | live db-44..46; code `ZJ`: `name !== scaleRC/scaleLC && type === 'text'`, or image/signature |
| **Text font scales** with a corner / top / bottom drag (16 → 21.46, not rounded) | live db-05/07; code `z41`: text/callout `withProperties` unless the grabber is translate / scaleLC / scaleRC |
| **Text from a side**: the font stays the same, only the width changes, the words rewrap and the box height grows to fit | live db-19 |
| **Line widths stay the same** on shapes and arrows (a pen stroke's outline scales as a shape) | live; code `_41` scales strokeWidth only `withProperties` (grouped marks, text, or holding K) |
| **A tilted rectangle shears into a parallelogram** on an uneven stretch | live db-12/19 (Drawboard stores a full matrix per mark) |
| Past the opposite side: mirrors (text ends up upside down) and has no real minimum | live db-21/22/28/29 |
| One Ctrl+Z undoes the whole group resize | live db-04 |
| Pen gives the same result as the mouse | live db-25/26 |
| A rotate button exists on a multi-selection | live db-23/24 |

## What Survey does now

Drawboard's rules, plus tldraw's rule where Survey can't follow Drawboard.

- The multi-selection frame shows its **eight resize grabbers**. Rotate stays hidden for now.
- **Corner**: free stretch. **Edge**: one axis. **Alt**: from the centre. **Shift**: keeps proportions, following the bigger move. All as Drawboard.
- **Text in the selection** keeps the proportions (corner / top / bottom) and **scales its font** with the frame, rounded to 0.1. The box scales inside its fixed padding so the words don't rewrap. From a **left / right side**, only the width changes and the words rewrap. All as Drawboard.
- **Photos / stamps** keep the proportions, as Drawboard.
- **Line widths** don't change, as Drawboard. Each type resizes exactly like its own single-mark resize.
- **A mark turned by an odd angle** (not 0 / 90 / 180 / 270): Drawboard shears it. Survey stores angle + scale and can't draw a shear, which is what sank the April 2026 attempt. So Survey uses **tldraw's rule**: the whole frame keeps its proportions while such a mark is selected. A mark turned 90° / 270° stretches along the page's axes (its own two scales swap).
- **No mirroring**. A group stops when its smallest member reaches 4 page units, or its own size if it is already smaller. Drawboard mirrors, and its text ends up upside down.
- **One Undo step**, saved field by field on top of the page as it is now, so a co-editor's change made during the drag survives (sync-safe). A list change mid-drag keeps each mark's own preview.
- **Callouts** resize with the group: the arrow tip and bend move with the frame, and the text box acts like text (from a corner / top / bottom the frame keeps its proportions and the font scales; from a side only the width changes). Drawboard's code scales a callout's font like text; whether its corner also locks the proportions is our call, made so the words never get squashed.
- **Survey Markers** resize with the group like rectangles (the box scales; a marker turned 90° takes the scales swapped). Saved in the same Undo step as the marks and callouts.
- **Still move-only**: a selection that includes a locked mark or an old-style arrow (saved as a group of line + head). The frame keeps no grabbers, and a lock badge shows when a member is locked.

## Follow-ups (not in this change)

1. Group **rotate** (Drawboard has it; Survey's old group-rotate code is still in the hook, hidden).
2. ~~Callouts and Survey Markers in a resizable group~~ (done 2026-10-22).
3. Text rewrapped from a side should grow its box height to fit, as Drawboard does. Survey's single-mark side resize doesn't either.
4. Hold **K** to scale line widths too (Drawboard).

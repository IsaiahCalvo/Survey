# DrawBoard-Style Matrix Transform Rewrite — Plan

**Created**: 2026-04-21
**Branch**: post-v2.0/cleanup
**Goal**: Replace the per-shape `(angle, scaleX, scaleY)` transform model with a per-shape 2×3 affine matrix so group rotate/resize behaves like DrawBoard PDF: shapes distort into parallelograms/ovals under non-uniform scale, subsequent rotations tilt the distorted cloud as a rigid frame, the bounding frame always snaps to axis-aligned on release, and undo is the only recovery.

## Motivation

The existing model stores each shape as `left, top, angle, scaleX, scaleY` (plus optional `skewX`, `skewY`, but our renderers don't honor skew). Rotate-then-non-uniform-scale produces a matrix whose QR decomposition has non-zero skew, which the renderer can't draw — so the math gets back-solved into shape-local axes, which produces visible "shapes collide along tilted axes" artifacts at any rotation between 0° and 180°. Last session tried six+ workarounds; all failed because the data model can't represent the required state. DrawBoard, Figma, Illustrator, and Sketch all use a 2×3 affine per shape. We're adopting that model.

## Success Criteria (End State)

A user can:
1. Group a mixed set (rect, ellipse, polygon, line, text, callout, counter).
2. Rotate the group to an arbitrary angle — frame tilts live, shapes ride with it.
3. On release, the frame snaps to the axis-aligned bounding box of the now-transformed members. Shapes stay visually where they are (rotation lives in their new matrix).
4. Resize the group by any handle — shapes distort uniformly in world-axis x/y (circles become ovals, rects become parallelograms if the group was previously rotated).
5. On release, the frame snaps to axis-aligned again.
6. Repeat rotate/resize in any order — the cloud deforms as a rigid unit per DrawBoard.
7. Ctrl+Z restores the previous matrices exactly.
8. Entering Fabric edit on any single shape still works; exiting re-serializes the matrix.

## Phase 1 — Data Model + Renderer Wrapper (Invisible)

**Scope**: Add an optional six-number transform field to every annotation's `data` payload. Update every SVG renderer to wrap its output in an outer group with `transform="matrix(...)"` when the field is present. Identity matrix `[1,0,0,1,0,0]` must paint pixel-identical to no wrapper.

**Files expected to touch**:
- Annotation schema / defaults (wherever shape defaults live).
- Every SVG renderer in the renderer module (rect, ellipse, text, polygon, path, line, arrow, counter, callout).
- Hit test resolver — pointer-to-local conversion must compose the inverse matrix when present.
- Group frame renderer — read transformed vertices of each member when computing the outer bbox.

**Verification**:
- Open an existing PDF with mixed annotations. All shapes paint identically to before.
- Click through every shape type; selection, handles, hit-testing, drag all behave identically.
- No visual diff in the save-log output for equivalent operations.
- Save + reload: shapes with no transform field stay un-wrapped.

**Risks**:
- Hit-test subtly breaks if pointer-to-local skips the inverse on shapes that got a default identity matrix.
- Line/arrow endpoints are stored in world coords; the wrapper changes the paint position but not the stored endpoints. Decide up front: either endpoints move with the matrix (and are re-written on commit), or endpoints stay world-canonical and the matrix is identity for lines/arrows forever. Recommend: matrix wraps line/arrow too, endpoints read inside the matrix, paint follows matrix; saves match what the user sees.

**Out of scope for Phase 1**: any behavior change. This is purely the rails.

## Phase 2 — Group Rotate via Matrix

**Scope**: When the user drags the group rotate handle, compose a rotation-around-pivot matrix into each member's transform every frame. Stop mutating each shape's `angle`/`left`/`top` during group rotation. Outer frame is recomputed each frame as the axis-aligned bbox of the members' transformed vertices.

**Verification**:
- Rotate a group of a rect + ellipse + line 30°. Frame tilts during drag, snaps to axis-aligned on release. Shapes retain their visual rotation.
- Rotate the same group another 30°. Total visual rotation is 60°. No drift on pivot across repeat rotations.
- Rotate, move, rotate again. Pivot stays consistent with DrawBoard behavior (pivot is the current frame center each time).
- Undo once restores the post-first-rotation state. Undo twice restores original.

**Risks**:
- Bbox computation on transformed vertices is the main trap. For each member, derive its four local corners (or the relevant polygon/line endpoints), apply the member's matrix, take the axis-aligned min/max across all members. Cache per-frame to keep the drag smooth.

## Phase 3 — Group Resize via Matrix

**Scope**: When the user drags a group resize handle, compose a world-axis scale matrix into each member's transform. Anchor stays at the opposite corner/edge in world coords. This is the phase where the DrawBoard distortion appears: rotated shapes under non-uniform scale will compose into a matrix with skew, which the new wrapper renders natively.

**Verification**:
- Group a square, rotate 45°, drag the right-edge handle to 2× width. The square becomes a parallelogram. The frame stays axis-aligned during and after.
- Group a circle, rotate 30°, drag bottom-edge handle to 2× height. Circle becomes a tilted oval.
- Resize an un-rotated group — shapes scale cleanly along world axes with no distortion.
- Undo restores exactly.

**Risks**:
- Numerical precision under many chained operations. Each operation multiplies into the matrix; after 20+ gestures, the six numbers may accumulate float drift. Acceptable for now; flag for a later "normalize on idle" pass.
- Callout renderers use normalized 0..1 coords × page dims. The matrix wrapper composes on top of that math; verify callouts distort correctly under group stretch.

## Phase 4 — Undo / Redo + Fabric Edit Round-Trip

**Scope**: On gesture-start, snapshot every affected member's pre-op matrix into one undo entry. On Ctrl+Z, restore those matrices. Bridge Fabric edit mode: on entering edit, decompose the matrix into `angle/scaleX/scaleY/skewX/skewY/translate` so Fabric's own transform properties take over. On exit, recompose into a matrix and write back. Document the known lossy edge where skew + flip combine (Fabric issue #5079).

**Verification**:
- Rotate a group, undo — everything back. Redo — rotation restored.
- Chain rotate + resize + rotate, hit undo three times — three reverse steps.
- Double-click a distorted rect to edit text. Edit opens with the visual tilt/distortion intact. Type some text. Exit edit. Shape stays distorted with new text.
- Edit a shape with a flipped + skewed matrix (rare combo) and verify the documented precision warning fires if drift exceeds threshold.

**Risks**:
- Decompose/recompose is ambiguous under skew+flip. Accept a small precision warning at that boundary rather than forcing perfect round-trip.
- Undo coalescing: a single drag must produce exactly one undo entry, not one per pointermove frame.

## Reconciliation With Single-Shape Transforms

After Phase 4 ships, decide whether to migrate single-shape (non-group) rotate/scale to the matrix model too. Recommend full migration for consistency — one code path, no hybrid state — but this can happen as a follow-on milestone. The four phases above intentionally leave `angle`/`scaleX`/`scaleY` intact on each shape so the existing non-group handles keep working through the transition.

## Open Questions for User Review Before Phase 1 Starts

1. Should line/arrow endpoints be "inside the matrix" (endpoints are local, matrix transforms them) or "world canonical" (matrix is always identity for lines, endpoints are stored in final world coords)? Recommend inside-the-matrix for uniformity.
2. Should callouts' text-box sub-position (normalized 0..1) distort with the matrix, or stay on a separate layer that only translates? Recommend distort-with-matrix for DrawBoard fidelity; it matches how callouts behave under group rotate today.
3. Precision warning threshold for Fabric edit round-trip — what delta in pixels constitutes "lossy enough to warn"? Recommend 0.5px. Adjust after real testing.
4. Ship Phase 1 under a feature flag, or direct? Phase 1 is strictly invisible by design, so direct is defensible. Phase 2+ benefits from a flag for quick rollback. Recommend a single env flag gating Phase 2–4 behavior; Phase 1 ships ungated.

## Rollback Plan

Phase 1 is invisible — if a hit-test bug appears, revert the renderer wrappers; data field stays harmless. Phases 2–4 are gated behind the feature flag recommended above; flip off to restore the previous group-transform code path, which lives on branch `post-v2.0/cleanup` at commit 659db844 (last handoff snapshot).

## Test PDFs

- Canonical: `~/Desktop/SE-011 Security Shop Drawing Rev2 - 05.06.25.pdf`
- Secondary: `Package 2 - Rev 4 -- IC.pdf` (annotation-heavy, page 6+)

## Estimated Session Count

- Phase 1: 1 session (mostly plumbing; identity wrapper must be watertight).
- Phase 2: 1 session (group rotate logic; pivot math well-understood from v11).
- Phase 3: 1 session (group resize; main payoff phase, distortion UX tuning).
- Phase 4: 1–2 sessions (undo entries are quick; Fabric edit bridge needs careful precision work).

Target: four working sessions to ship end-to-end.

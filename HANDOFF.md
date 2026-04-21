# Handoff: DrawBoard-Style Group Transform Rewrite (Plan + Implement Next Session)

**Generated**: 2026-04-21 (session close, ~02:45Z)
**Branch**: post-v2.0/cleanup
**Status**: Ready for Planning — user approved full matrix-per-shape rewrite but we're out of context to start implementation. NEXT SESSION: draft plan doc, then execute in staged phases.

## Goal

Reimplement multi-shape group rotate + resize so it behaves like DrawBoard PDF: rotate a group, the frame returns to axis-aligned on release, stretch the group and shapes distort uniformly (circles → ovals, rects → parallelograms), subsequent rotations tilt the distorted group as a rigid "picture frame." Undo is the only way to restore original shape. The underlying data model must change from per-shape `(left, top, angle, scaleX, scaleY)` to per-shape 2×3 affine matrix as the source of truth.

## Completed This Session

- [x] Fixed group rotation pivot drift across rotate-then-move-then-rotate sequences (locked pivot to persisted snapshot center on subsequent rotations).
- [x] Fixed shape origin drift during resize (scale visible center, back-solve origin via `origin = newVisible - R(angle)·diag(sx,sy)·R(-angle)·origOffset`).
- [x] Tried 5+ approaches to group resize on rotated groups. All had visible artifacts because current data model can't represent skew without a deeper rewrite.
- [x] Researched how Figma, Illustrator, Sketch, PowerPoint, and DrawBoard PDF handle rotated group resize (full findings embedded below).
- [x] User picked DrawBoard's approach (matrix-per-shape, shapes distort into parallelograms/ovals, undo is the recovery mechanism).
- [x] Current state: group rotate bbox snaps flat on release, group resize is world-axis with clean positioning but rotated shapes scale along their tilted axes (artifact user rejects). This is the known limit of the current data model.

## Not Yet Done

- [ ] **NEXT SESSION FIRST TASK**: Draft a multi-phase implementation plan doc for the matrix rewrite. User wants a plan before code.
- [ ] Phase 1: Add optional `data.transform` field (6-element affine matrix) to every annotation, default identity. Update every SVG renderer to apply `transform="matrix(a b c d e f)"` as an outer wrapper when present. Should be a non-visual change because identity matrix paints identically.
- [ ] Phase 2: Switch group rotation to multiply a rotation matrix into each member's `data.transform`. Stop touching each shape's `angle`/`left`/`top` during group rotation. Verify the outer bbox correctly reports axis-aligned bounds of the transformed vertices.
- [ ] Phase 3: Switch group resize to multiply a world-axis scale matrix into each member's `data.transform`. Verify shapes visibly distort into parallelograms / ovals like DrawBoard. Verify bbox remains axis-aligned after release.
- [ ] Phase 4: Wire undo/redo to snapshot the pre-operation matrices for every affected shape. One undo entry per gesture. Wire edit-mode transitions: on entering Fabric edit, decompose the matrix into `angle/scaleX/scaleY/skewX/skewY/translate`; on exiting, recompose into the matrix.
- [ ] Reconcile with per-shape (non-group) rotate/scale handles: decide whether to migrate single-shape transforms to the matrix model too, or keep a hybrid. Recommended: full migration for consistency, but this can happen after group phases ship.

## Failed Approaches (Don't Repeat These)

- **Tilted-local-frame resize (v7 / v8)** — transform pointer + anchor into the group's tilted local frame, scale in local axes, rotate back. Math was correct but non-uniform scale along tilted axes creates an R·diag·R⁻¹ shear in world coords that users describe as "shapes collide at intermediate angles." Only clean at 0° and 180°. Abandoned because the shear is mathematically unavoidable with tilted-axis non-uniform scale.
- **Origin-scale formula for shape position (v8)** — `newLeft = scalePoint(oldLeft)`. Works for un-rotated shapes but leaves a rotation-scale commutator residue for rotated shapes, so shape centers drift by an angle-dependent offset at intermediate angles. Replaced by center-scale formula `newLeft = newVisibleCenter - R(angle)·diag(sx,sy)·R(-angle)·oldOffset` in v9.
- **Clearing persisted group tilt on resize start AND commit (v6)** — frame snapped to axis-aligned during the whole drag, then stayed axis-aligned after. User rejected: "the rotation of the bounding box snaps back to being vertical." (Later accepted in v11 after user explicitly asked for PowerPoint-style snap-back, but shapes' internal angles remain, which produces the "dirty scaling after rotation" user then flagged.)
- **Keeping persisted tilt through the whole rotate-resize flow (v10)** — frame stays tilted during resize, shapes scale along tilted axes via v9 center formula. Reintroduced the "shapes collide" shear. Abandoned.
- **Anchor override from world-axis to tilted-frame-edge for rotated resize (v7)** — moved the resize anchor from the world AABB's opposite edge onto the tilted frame's opposite edge. Math was correct but was part of the abandoned tilted-axis approach above.
- **Snap-shapes-to-un-rotated-at-resize-start** — briefly considered; would permanently lose the rotation on resize. User's preferred model preserves rotation differently (via matrix composition), not by destroying it.

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Adopt the DrawBoard / Figma / Illustrator matrix-per-shape model | User tested DrawBoard directly and described the behavior precisely; it requires full 6-number affine per shape. Separate `(angle, scaleX, scaleY)` can't represent the rotate→non-uniform-scale composition without `skewX/skewY` in the renderer, which our SVG renderers don't yet understand. Fewer edge cases long-term. |
| Frame snaps to axis-aligned after every rotate / resize | Matches DrawBoard. Frame is always the current axis-aligned wrap of the transformed shapes' vertices; no separate "tilted frame" state to persist. |
| Shapes distort (parallelograms, ovals) as part of normal operation | DrawBoard does this. Undo is the recovery path. User explicitly accepted this trade-off. |
| Keep existing `angle`, `scaleX`, `scaleY`, `skewX` properties on the shape and ALSO add a `data.transform` matrix | Incremental migration. New matrix is applied as outer wrapping transform; inner shape math keeps working. Later migration can collapse them. |
| One `data.transform` per annotation, not per-group | Groups are ephemeral selections (tracked by `groupId`). The matrix lives on each shape so ungrouping doesn't lose the distortion. |
| Undo captures pre-op matrices for every affected shape, one entry per gesture | Matches DrawBoard's behavior. Ctrl+Z restores the previous matrix exactly. |
| SVG renderer uses native `transform="matrix(a b c d e f)"` | SVG supports this directly. No manual decomposition needed for rendering. |
| Fabric edit mode will decompose on entry, recompose on exit | Fabric 5 removed `transformMatrix` so individual shape properties are the edit surface. `fabric.util.qrDecompose` bridges matrix → properties. Known to be lossy when skew + flip combine (Fabric issue #5079) — accept this as an edit-mode precision limit. |

## Current State

**Working**:
- Group rotate with pivot-lock across repeat rotations (no drift on rotate-then-move-then-rotate).
- Group resize on un-rotated groups — clean world-axis scale, shapes land exactly where expected.
- Group rotate bbox snaps to axis-aligned on release (PowerPoint-style), shapes keep individual angles.
- Rich mid-drag diagnostic logging via `[GroupTransformDiag]` tag in `1.log` for every start / rotate-move / resize-move / commit.

**Broken / Known Artifact**:
- Group resize AFTER a rotation: bbox is axis-aligned but shapes carry individual angles. Non-uniform world-axis scale on rotated shapes produces scale along each shape's tilted axis (not world axis), which user calls "dirty scaling." This is the known limit of the current data model; it's fixed by the matrix rewrite planned in this handoff.
- Circles, ellipses, and text can't be baked-rotation cleanly without skew support in their renderers — flagged for Phase 1 research.

**Uncommitted Changes**: ~1716 insertions across 7 files on `post-v2.0/cleanup`. Everything from this session is uncommitted. Same scope as the prior handoff plus the v6 → v11 iterations on group resize. Key modified files: `src/hooks/useSVGInteraction.js` (group transform logic, ~1000 new lines), `src/components/SVGAnnotationLayer.jsx` (group frame render + resize broadcast handling), `src/components/SVGSelectionOverlay.jsx` (move-only mode), `src/App.jsx` (group/ungroup wiring), plus new `src/utils/annotationGroups.js` helper.

## Files to Know

| File | Why It Matters |
|------|----------------|
| `src/hooks/useSVGInteraction.js` | All group transform logic lives here: `handleHandlePointerDown` starts group-rotate / group-resize with pivot capture, pointermove branch applies per-frame geometry updates, pointerup commits and updates `persistedGroupTransform`. The v11 state has rotation commit clearing persistence (PowerPoint-style) and resize commit clearing persistence + broadcast. |
| `src/components/SVGAnnotationLayer.jsx` | Outer dashed group bbox renders from live AABB when no persistence; tilted when persistence exists. For the matrix rewrite, this needs to derive the frame from the transformed vertices of each member instead. |
| `src/components/SVGSelectionOverlay.jsx` | The handle set for the outer frame. Needs no change for the matrix rewrite — frame + handles are still drawn on whatever rect we compute as the axis-aligned bbox. |
| `src/App.jsx` | Group / ungroup event wiring, right-click menu, Cmd+G / Cmd+Shift+G keyboard shortcuts, `handleGroupSelected` / `handleUngroupSelected` implementations. Passes `onGroupSelected` / `onUngroupSelected` props to the SVG layer. |
| `src/utils/annotationGroups.js` | Helper module: `generateGroupId`, `getAnnotationGroupId`, `getCalloutGroupId`, `findGroupMembers`, `applyAnnotationGroupId`. Per-shape `data.groupId` + per-callout `groupId` field. |
| `src/utils/svgAnnotationRenderers.jsx` | Every shape renderer (rect, ellipse, text, polygon, path, line, arrow, counter). Phase 1 of the matrix rewrite needs to add an outer `<g transform="matrix(...)">` wrapper to each renderer when `obj.data?.transform` is present. |
| `1.log` | Save Log button dumps here. All `[GroupTransformDiag]` entries land here. User-facing pipeline: user clicks Save Log → file appears → user pastes path into chat → I `grep` / `Read` to diagnose. |

## Code Context

**Shape data shape** (current, `data.transform` is NEW and to be added in Phase 1):
```js
// Annotation object (SVG JSON)
{
  type: 'polygon' | 'line' | 'rect' | 'ellipse' | 'textbox' | 'path' | ...,
  left: number, top: number,
  width?: number, height?: number,
  scaleX: number, scaleY: number, angle: number,
  skewX?: number, skewY?: number,
  x1?: number, y1?: number, x2?: number, y2?: number,  // lines
  points?: Array<{x, y}>,                               // polygons
  data: {
    type?: 'counter' | 'callout' | ...,
    groupId?: string,                                   // existing
    transform?: [a, b, c, d, e, f],                     // NEW — 2×3 affine, identity = [1,0,0,1,0,0]
    midpoint?: {x, y},
    pointerAngle?: number,
    // ...
  },
}
```

**Affine multiplication** (for Phase 2 / 3 — group transform composition):
```js
// 2×3 matrix represented as [a, b, c, d, e, f] where
//   [a c e]     [a c | e]
//   [b d f]  =  [b d | f]
//   [0 0 1]     [0 0 | 1]
//
// Apply point: (x', y') = (a·x + c·y + e, b·x + d·y + f)
// Compose M1 · M2 (apply M2 then M1):
function compose(M1, M2) {
  const [a1, b1, c1, d1, e1, f1] = M1;
  const [a2, b2, c2, d2, e2, f2] = M2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}
// Translate(x, y): [1, 0, 0, 1, x, y]
// Rotate(θ) (CCW math, CW screen-y-down): [cos, sin, -sin, cos, 0, 0]
// Scale(sx, sy): [sx, 0, 0, sy, 0, 0]
// Rotate around pivot (px, py) by θ:
//   Translate(-px, -py) then Rotate(θ) then Translate(px, py)
//   compose(T(px, py), compose(R(θ), T(-px, -py)))
```

**Persisted group transform state shape** (current v11 — rotate clears on commit; resize clears on commit):
```js
persistedGroupTransform = null;  // After matrix rewrite, this state may become obsolete.

// During a live drag, renderer reads visualTransform:
visualTransform = {
  id: 'group',
  dx, dy,                                    // group-move
  groupRotate?: { angle, pivotX, pivotY, snapshotBbox },
  groupResize?: { angle, pivotX, pivotY, centerX, centerY, width, height },
  affectedIds?: Set<number>, affectedCalloutIds?: Set<string>,
}
```

**Diagnostic logging**: all `[GroupTransformDiag]` entries. Fields include `ts`, `mode`, `handleId`, `pivotUsed`, `persistedPrev`, `startPointerSVG`, `scaleFactors`, `memberSnapshots` (full per-member state per 120ms throttle), `frameCenter`, `frameDims`. Saves to `1.log` via the Save Log button.

**Hit test resolver** (to know for Phase 2): `src/components/SVGAnnotationLayer.jsx` uses `data-*` attributes on rendered `<g>` elements to identify annotation / group / callout under the pointer. The matrix wrapper needs to preserve those attributes, and the hit test needs to account for the matrix when converting pointer world coords → local shape space.

## Resume Instructions

1. Read this handoff top to bottom.
2. Review user's accepted direction: "No, I'd rather do the full drawboard thing" → full matrix-per-shape rewrite.
3. **First action**: draft a planning doc at `docs/superpowers/specs/2026-04-21-drawboard-matrix-transform.md` or equivalent. Structure it around the four phases in "Not Yet Done". For each phase: scope, success criteria, test steps, known risks, file list. Get user approval on the plan before writing code.
4. After plan approval, execute Phase 1 (add `data.transform` field + renderer wrappers). Verify no visual regression by running the app and confirming existing annotations paint identically.
5. After Phase 1 passes visual review, proceed to Phase 2 (group rotate via matrix).
6. After Phase 2, verify the group-rotate UX: rotate handle drags, frame tilts live, on release frame becomes the axis-aligned wrap of transformed members, shapes stay individually tilted (or rather, their matrix carries the rotation, not their `angle`).
7. Phase 3: group resize via matrix. Verify distortion: group a polygon and a rect, rotate to 45°, resize the group's right edge to 2x, expect rect to become parallelogram, polygon to distort along world X. Undo should restore both.
8. Phase 4: undo/redo plus Fabric edit mode. Verify entering Fabric edit on a matrix-transformed shape works, and exiting re-serializes the matrix.

## Setup Required

- Dev server: `npm run dev` on port 5173.
- Electron shell for the Save Log button to write to `1.log`.
- Canonical test PDF: `~/Desktop/SE-011 Security Shop Drawing Rev2 - 05.06.25.pdf`.
- Login per `~/.claude/projects/-Users-isaiahcalvo-Desktop-Survey-BetaSafeS2/memory/credentials.md`.
- No new env vars or migrations.

## Edge Cases & Error Handling

- **Shape with existing `angle` / `scaleX` / `scaleY` / `skewX` before the matrix rewrite lands** → Phase 1 treats per-shape transform as `local transform applied INSIDE the matrix wrapper`. Practically: for Phase 1 the matrix just wraps the existing render; no behavior change. Phase 2/3 multiply the GROUP's new transform into the matrix only; they don't touch `angle`/`scaleX`/etc.
- **Ungrouping a distorted group** → the matrix stays on each shape because it's per-shape. Shapes remain distorted after ungroup. User re-groups if they want to keep manipulating the distorted set.
- **Line / arrow after matrix rewrite** → endpoints are stored in world coords, but when a matrix wrapper is present, the renderer paints the line at matrix-transformed endpoint positions. Hit testing needs the inverse matrix applied to the pointer to find which endpoint was clicked. Document this carefully in Phase 1.
- **Callouts** → similar story; arrowTip/knee/textBoxPosition are normalized (0..1) coords multiplied by pageW/pageH. Matrix wrapper composes on top. Phase 1 must not break callout rendering.
- **PDF export of distorted shapes** → out of scope for this handoff but flagged: non-orthonormal matrices on annotations will require PDF export to write the full CTM into each appearance stream. Phase 4 or later.

## Warnings

- **`RotationInputField` and 12-02 files are off-limits** to this session's lane per durable memory. The parallel 12-02 GSD workflow owns those.
- **Always-protected files** per `CLAUDE.md`: `src/App.jsx`, `src/components/PageAnnotationLayer.jsx`, `src/components/SVGAnnotationLayer.jsx`, `src/components/FabricEditCanvas.jsx`, `src/utils/svgAnnotationRenderers.jsx`. This session already has implicit waivers on most of them; the matrix rewrite will touch all of them. Confirm each phase's scope with the user before starting.
- **The `zoomGeneration` signal** in Canvas components must NEVER be removed. Matrix rewrite has nothing to do with zoom, but it's easy to accidentally refactor renderers and drop the signal.
- **Plain-English chat rule is HARD-ENFORCED** by a hook. Code comments + this HANDOFF.md are exempt; chat replies must be plain English with no file paths / camelCase / line numbers / markdown headers / lettered menus / bullets >4 items.
- **Fabric `qrDecompose` is lossy with skew + flip combos** (Fabric issue #5079). Edit mode round-trips won't be bit-exact. Plan for a precision check at edit-mode boundary.
- **DrawBoard engine is native XAML/Direct2D, not a JS library**. Don't waste time searching for a JS equivalent of their engine; the model they use (matrix-per-shape) is what matters, not their rendering stack. The model is identical to Figma's public Transform API.
- **Session-moments log** at `~/.claude/projects/-Users-isaiahcalvo-Desktop-Survey-BetaSafeS2/memory/session-moments/2026-04-21.md` carries the running DECISION / CORRECTION / INSIGHT log. Includes v5 through v11 iteration history on group transforms. Worth skimming if context is thin.

## Research Summary (Embedded — Do Not Re-Research)

Professional apps split into two camps:

- **Matrix-per-shape model (Figma, Illustrator, Sketch/Affinity, DrawBoard PDF, PowerPoint/Keynote rendering engine)**: each shape stores a 2×3 affine; group rotate/scale composes a new matrix into every member; shapes freely distort into parallelograms/ovals; undo stores pre-op matrices. Frame is always the axis-aligned wrap of transformed vertices.
- **Separate-property model (Fabric.js default, Bluebeam Revu, PDF Annotator, Xodo, Kami)**: each shape has `angle`, `scaleX`, `scaleY`, maybe `skewX`/`skewY`. Can't represent arbitrary rotate→non-uniform-scale compositions cleanly because those produce matrices that decompose with non-zero skew, and the renderer has to support skew explicitly.

DrawBoard's specific UX — frame snaps flat on release, shapes distort during stretch, rotations rotate the distorted cloud like a picture frame — is the canonical signature of the matrix-per-shape model. Fabric 5 removed the legacy `transformMatrix` property; shapes are still rendered from `(left, top, angle, scaleX, scaleY, skewX, skewY)` internally, but you can bridge to a matrix via `fabric.util.qrDecompose` / `fabric.util.composeMatrix`. SVG's native `transform="matrix(a b c d e f)"` is literally the same six numbers in the same order — we can render directly from the matrix with zero round-trip.

Fabric issue #5079 flags that QR decomposition is ambiguous when skew and negative determinant (flip) are both present. Acceptable for our use case: we only flip via full negative scale which triggers a known edge in the decomposition, so we add a precision check at Fabric edit-mode entry.

## Backlog Touched but Not Closed

- Group / Ungroup slice 2 (focus-a-member-with-gray-outline) and slice 3 (live-growing gray outline) — both still in the design spec, neither built.
- Group rotation pill — user asked for it; deferred.
- Group resize parity for line / counter / polygon edge cases — current math works for the common cases but hasn't been tested across every shape combo at every zoom level.
- **Matrix rewrite** (this handoff's main goal) — 4 phases, not started.

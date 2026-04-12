# Architecture Research — v2.1 Stage 0 Shape Edit Polish

**Domain:** Polish milestone — integration points inside an existing architecture
**Researched:** 2026-04-12
**Confidence:** HIGH
**Scope note:** This file intentionally OVERWRITES the v2.0-era ARCHITECTURE.md.
It no longer describes the global system — the global architecture is fixed and
documented in `CLAUDE.md`, the v2.0 phase docs, and `PROJECT.md`. This file
answers one question only: **"Where do the two Stage 0 edits plug in, and what
else quietly depends on the values they're changing?"**

---

## TL;DR

Stage 0 is **two independent, surgical edits** across **3 files** (not 4 as
STACK.md originally estimated). Total LOC: ~5.

1. **Shift+rotate 45° snap** — **ONE integration point** in `src/hooks/useSVGInteraction.js:391-408`.
   The Fabric edit path for shapes is **rotation-lossy** (commit discards live
   angle) so adding `snapAngle` inside FabricEditCanvas would be **dead work**.
   STACK.md's Q1 recommendation to add the keydown/keyup handler in
   `loadShapeAnnotation` should be **dropped from Stage 0**.

2. **Zoom floor 0.5 → 0.1** — **TWO integration points**:
   - `src/utils/zoomController.js:15` (primary constant)
   - `src/App.jsx:21999` (pre-clamp in `commitZoomInput`)

Nothing else in the system silently depends on `MIN_SCALE = 0.5` or on
rotation being a free float. The dependency sweep below is exhaustive.

---

## Fixed Architecture Context (already in place)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Syncfusion PDF Viewer                         │
│   (coerceZoom already clamps [10, 1000] — no edit needed)        │
├─────────────────────────────────────────────────────────────────┤
│              React portals → per-page overlay divs               │
│   ┌──────────────────────────┐  ┌─────────────────────────────┐  │
│   │  SVGAnnotationLayer      │  │  FabricEditCanvas           │  │
│   │  (display, viewBox zoom) │  │  (mount-on-demand edit)     │  │
│   │                          │  │                             │  │
│   │  useSVGInteraction       │  │  loadText / loadShape /     │  │
│   │  owns: select, move,     │  │  loadCallout                │  │
│   │  resize, ROTATE          │  │                             │  │
│   │  ← PRIMARY ROTATION PATH │  │  ← NO shape rotation on     │  │
│   │                          │  │    commit (see "Rotation    │  │
│   │                          │  │    Lossiness" below)        │  │
│   └──────────────────────────┘  └─────────────────────────────┘  │
│                                                                  │
│   SVGSelectionOverlay (handles, scaled via inverseScale)         │
├─────────────────────────────────────────────────────────────────┤
│     PageAnnotationLayer.jsx (legacy pan/draw tool Fabric host)   │
│     Has its own rotation handler (see "Hidden Rotation Path")    │
├─────────────────────────────────────────────────────────────────┤
│     zoomController.js  (clampScale, MIN_SCALE, MAX_SCALE)        │
│         ↑                                                        │
│         └──── 22 call sites in App.jsx funnel through here       │
└─────────────────────────────────────────────────────────────────┘
```

The only parts of this picture this milestone touches are:

- `useSVGInteraction.handlePointerMove` (the rotate branch)
- `zoomController.MIN_SCALE`
- `App.jsx:commitZoomInput` (the pre-clamp literal)

Everything else stays untouched.

---

## Question 1 — Rotation Snap Integration

### Q1a. Is `useSVGInteraction.js` the single entry point for SVG rotation?

**YES, for the user-facing rotation flow.** HIGH confidence.

Sweep of every file with rotation-relevant code in the SVG path:

| File | Rotation-relevant content | Live? | Notes |
|------|---------------------------|-------|-------|
| `src/hooks/useSVGInteraction.js:391-408` (move) + `:559-568` (commit) | `ds.mode === 'rotate'` branch, `normalizeAngle(Math.atan2(dy,dx))`, commits `ds.currentAngle` | **YES** — the primary rotation path for every SVG-rendered annotation (shape, text, line, arrow, imported path, etc.) | **ONLY integration point.** Add Shift-snap here. |
| `src/components/SVGSelectionOverlay.jsx` | Reads `bbox.angle` and applies `transform="rotate(angle, cx, cy)"` on the handle group | **YES, but read-only** — just renders the current angle, does not mutate it | No edit needed. |
| `src/utils/svgTransformMath.js:36` | `normalizeAngle(radians)` helper | **YES, but pure math** — called by useSVGInteraction | No edit needed. |
| `src/utils/svgAnnotationRenderers.jsx:155, 224` | `Math.atan2` — computes line/arrow arrowhead rendering angles from endpoint geometry | **YES, but unrelated to rotation gesture** — these compute arrowhead direction from x1,y1,x2,y2, NOT from `obj.angle` | No edit needed. No free-float assumption here. |
| `src/components/LightweightAnnotationOverlay.jsx:363` | `Math.atan2` — legacy overlay (not load-bearing in v2.0+, but still imported) | Unknown — likely dead for shapes, possibly used for imported-annotation rendering | Read-only angle math. Not a rotation gesture path. No edit needed. |
| `src/utils/lineGeometry.js:133, 153` | `Math.atan2` — bezier curve control point math | **YES, but geometric** — used by line/arrow rendering, not rotation gesture | No edit needed. |
| `src/TextLayer.jsx:61` | `atan2(tx[1], tx[0])` — PDF text matrix angle extraction | **YES, but PDF parsing** — reads source PDF rotation, not user gesture | No edit needed. |

**Verdict:** There is **no duplicate rotation gesture math** in the SVG path.
`useSVGInteraction.js:391` is the sole write site for user-driven SVG rotation.
The existing pattern at line 361 (`if (e.shiftKey)` for resize aspect-lock) is
literally the template for the rotate branch.

### Q1b. Hidden rotation path in PageAnnotationLayer.jsx — leave alone

**Finding:** `src/PageAnnotationLayer.jsx:6080-6244` contains a **second complete
rotation implementation** that uses `Math.atan2`, computes a delta, and calls
`obj.set({ angle: newAngle, dirty: true })` directly on a Fabric object.

Code anatomy (verified at src/PageAnnotationLayer.jsx lines 6070-6244):

```js
// PRIORITY 2 in handleMouseDownForPan:
if (activeObject && isModifierPressed(nativeEvent)) {  // requires modifier key
  if (isOutsideBody && !isOnHandle) {
    panInteractionTypeRef.current = 'rotate';
    rotationStateRef.current = { object, startAngle, startPointer, center };
  }
}

// handleMouseMoveForPan:
if (panInteractionTypeRef.current === 'rotate' && rotationStateRef.current) {
  const currentAngle = Math.atan2(...) * 180 / Math.PI;
  const startAngle = Math.atan2(...) * 180 / Math.PI;
  obj.set({ angle: startAngle + (currentAngle - startAngle), dirty: true });
}

// handleMouseUpForPan (line 6346-6355):
if (wasRotating) saveCanvas('object:modified', { action: 'rotate', ... });
```

This handler is gated on **all three** of:
1. `toolRef.current === 'pan'` (active tool is Pan)
2. `activeObject` exists on PAL's Fabric canvas
3. A modifier key (Ctrl/Cmd) is held

**Is it live?** Technically reachable, but only in a legacy interaction mode
that pre-dates v2.0's SVG selection path. In the v2.0+ architecture:
- All shape/text/line/arrow selection happens on `SVGAnnotationLayer`
- PAL's Fabric canvas is used for drawing-in-progress (pen/rect/ellipse/text
  creation) and eraser strokes, not for selecting existing annotations
- `canvas.getActiveObject()` on PAL during "pan" tool is normally empty

**Recommendation for Stage 0: DO NOT touch this path.** Reasons:

1. It is not on the primary rotation flow. A user rotating a shape in v2.0+
   goes through `useSVGInteraction.js`, not here.
2. Adding Shift-snap here would require reaching into
   `src/PageAnnotationLayer.jsx` (~9,858 lines, Always Protected per CLAUDE.md).
   The boundary cost outweighs the benefit of "consistent snap in a legacy
   path the user can barely reach."
3. It is a legacy code smell from pre-v2.0. If it ever resurfaces as a real
   concern, it should be deleted rather than upgraded with snap logic.

**Action:** Add `src/PageAnnotationLayer.jsx` to the Stage 0 phase's DO NOT
CHANGE list with the note "legacy modifier-rotate path in Pan tool, out of
scope."

### Q1c. Is `FabricEditCanvas.jsx` the single place where shape rotation is configured in edit mode?

**NO — shape rotation in FabricEditCanvas is ROTATION-LOSSY.**
Stage 0 should **not** add `snapAngle` there. HIGH confidence.

Evidence from `src/components/FabricEditCanvas.jsx`:

| Line | Code | Meaning |
|------|------|---------|
| 1012 | `bboxOriginRef.current = { left, top, angle: annData.angle \|\| 0 }` | Stash pre-edit angle at load |
| 1036 | `obj.set({ ..., angle: 0, ... })` | **Force-zero the angle on load** — user interacts with an un-rotated shape |
| 1040-1048 | `hasControls: true, opacity: 0` | Handles (incl. mtr rotate handle) are visible; the shape is transparent so SVG is visual truth |
| 476-477 | `if (bboxOriginRef.current.angle) json.angle = bboxOriginRef.current.angle;` in `commitAndClose` | **Commit restores the pre-edit angle** — whatever the user did with the live mtr control is thrown away |

**Implication:** The rotate handle (mtr) is visually present during shape edit,
the user CAN grab it, the shape visually spins in place, and on commit all that
rotation is discarded. This is a pre-existing pseudo-bug unrelated to Stage 0.

Therefore:

- Adding `obj.snapAngle = 45` in `loadShapeAnnotation` would make the live
  rotation preview snap to 45° — but the result is still discarded at commit,
  so **the user sees no persistent change**.
- Installing keydown/keyup listeners on the window is pure overhead for a
  no-op code path.
- STACK.md Q1 ("Implementation pattern for FabricEditCanvas.jsx") is **wrong
  for this milestone's goals**. It would work mechanically but snap nothing
  the user can keep.

**The correct Fabric-edit rotation target, if one existed, would be the
callout load path** (`loadCalloutAnnotation`, line 1159). Callouts DO commit
live angle (line 471: `editTypeRef.current !== 'callout'` gates the angle
restore-override). But:

- Callout edit rotation via the Fabric mtr handle is not in the Stage 0 backlog.
- Callouts already have their own complex geometry pipeline (bezier curves,
  knee handles — see `src/components/Callout/`) and rotation interacts with
  it unpredictably.
- Adding snap to callouts expands scope. **Defer to a future milestone.**

**Stage 0 ships with snap on the SVG rotation path only.** The FabricEditCanvas
integration in FEATURE-BACKLOG.md line 62 should be struck before the phase
plan is written.

### Q1d. Does the rotation handler dispatch persistence/commit events that break on snapped angles?

**NO.** HIGH confidence.

The commit path at `useSVGInteraction.js:559-568`:

```js
} else if (ds.mode === 'rotate' && ds.currentAngle !== undefined) {
  const updatedAnnotations = JSON.parse(JSON.stringify(annotations));
  updatedAnnotations.objects[ds.annotationIndex].angle = ds.currentAngle;
  onSaveAnnotations(updatedAnnotations, {
    source: 'object:modified',
    action: 'rotate',
    checkpointPolicy: 'normal',
  });
}
```

Writes the final float angle directly to `obj.angle`. The save pipeline
(`handleSaveAnnotations` → `saveCanvasAndCheckpoint` at App.jsx:22357+) treats
`angle` as an opaque number. It does not special-case round values, does not
dirty-check by integer equality, does not special-case 0° or 45°, and does not
serialize rotation separately from other geometry.

Swept verification:

- **Undo/redo**: snapshot-based (deep JSON clone), reads `obj.angle` as a
  number. Snap has zero impact.
- **Supabase sync**: `documentAnnotationService.js` sends the Fabric JSON
  verbatim. No angle normalization.
- **SVG renderer** (`svgAnnotationRenderers.jsx`): reads `obj.angle` and
  applies `transform="rotate(angle, cx, cy)"`. Works for any float.
- **Fabric re-serialization** (next edit session): `fabric.util.enlivenObjects`
  reads `angle` as a float. Works for any value.
- **Checkpoint policy** (`checkpointPolicy: 'normal'`): already what the
  non-snapped rotate emits today. Unchanged.

**The snap is pure output rewriting inside `handlePointerMove` before the
commit path sees the value.** No downstream change propagates.

---

## Question 2 — Zoom Floor Integration

### Q2a. Where else does the code assume `scale >= 0.5`?

**Exhaustive sweep performed.** HIGH confidence.

Searches run:
- `MIN_SCALE`, `minScale`, `minZoom`, `min.?zoom` (case-insensitive)
- `Math.max(*, 0.5)` and `Math.max(0.5, *)`
- `scale < 0.` / `scale <= 0.` / `zoom < 0.` / `zoom <= 0.`
- `Math.max(*, 50)` and `Math.min(*, 500)` (for the 50%/500% zoom-percentage space)
- `clampScale` usage

**Results:**

| Location | Matches | Verdict |
|----------|---------|---------|
| `src/utils/zoomController.js:15` | `const MIN_SCALE = 0.5;` | **Primary target.** Change to `0.1`. |
| `src/utils/zoomController.js:23` | `Math.min(Math.max(value, MIN_SCALE), MAX_SCALE)` | Uses the constant. No edit. |
| `src/App.jsx:21999` | `const clamped = Math.min(Math.max(parsed, 50), 500);` inside `commitZoomInput` | **Companion target.** Change `50` → `10`. This pre-clamps the zoom-percentage input BEFORE `clampScale` is called on line 22002, so without this change, typing `10` into the zoom input is silently rounded to `50`. |
| `src/App.jsx:14265, 14278` | `Math.max(1, Math.min(500, ...))` | **False positive.** These are log-ring-buffer entry-count limits, not zoom. No edit. |
| `src/App.jsx:21350` | `Math.min(zoomForWidth, zoomForHeight)` | Fit-zoom compute; result is later passed through `clampScale`. No edit. |
| clampScale call sites (22 total in App.jsx) | lines 9126, 9450, 10395, 12086, 12094, 12200, 12293, 13162, 13720, 13769, 21148, 21208, 21544, 21552, 21579, 21703, 22002, 23588, 24408 + 2 in zoomController | All funnel through the constant. No edits needed. |
| `Math.max(0.5, ...)` or `Math.max(..., 0.5)` (literal 0.5) | **Zero matches.** | No hidden `0.5` floors anywhere in `src/`. |
| `scale < 0.` / `scale <= 0.` / `zoom < 0.` / `zoom <= 0.` | **Zero matches.** | No defensive clamps with hidden floors. |

**Conclusion:** The primary constant in `zoomController.js` + the one
pre-clamp in `App.jsx:21999` are the only two places that encode a zoom floor.
There are no hidden dependencies on `MIN_SCALE = 0.5`.

### Q2b. Any UI components that display or parse a min zoom value?

Sweep:

| Component | Zoom UI | Min-value dependency? |
|-----------|---------|------------------------|
| Zoom input field | `src/App.jsx:26449-26476` — a text `<input type="text">` feeding `commitZoomInput` | **Implicit via line 21999 pre-clamp.** No HTML `min` attribute. Covered by the companion change. |
| Zoom buttons (+ / −) | `src/App.jsx:21544, 21552` — call `clampScale(basisScale * 1.2)` / `clampScale(basisScale / 1.2)` | Automatic — funnels through `clampScale`. No edit. |
| Wheel/pinch zoom | `src/App.jsx:21579` — `clampScale(currentScale * deltaFactor)` | Automatic. No edit. |
| Zoom slider | **Does not exist.** No `<input type="range">` for zoom anywhere in `src/`. | N/A. |
| Fit-page / fit-width / fit-height buttons | `src/utils/zoomController.js:73-100` — `computeScaleForMode` → `clampScale` | Automatic. No edit. |
| Zoom indicator (percentage label) | Reads `scale * 100` — display-only | Automatic. No edit. |

**Conclusion:** No UI widget needs a separate update.

### Q2c. Does Syncfusion's `coerceZoom` need a parallel update?

**NO.** HIGH confidence.

Verified at `src/components/SyncfusionPDFContainer.jsx:29-33`:

```js
const coerceZoom = (value, fallback = 100) => {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(10, Math.min(1000, next));
};
```

Syncfusion's own clamp already accepts `[10, 1000]`. The current app-level
`MIN_SCALE = 0.5` is a self-imposed ceiling tighter than what the viewer
supports. Lowering `MIN_SCALE` to `0.1` aligns the app with what the viewer
already accepts. No Syncfusion-side change.

### Q2d. Any annotation sizing math that divides by scale and could blow up at 0.1?

**NO blow-ups.** HIGH confidence.

Sweep of `/\s*scale`, `/\s*zoom`, `/\s*effectiveScale`, `/\s*viewerScale`,
`/\s*syncfusionViewerScale` divisions:

| Location | Use | Behavior at scale=0.1 |
|----------|-----|------------------------|
| `src/TextLayer.jsx:133-136` | Rect coordinates divided by `scale` to return to unscaled space | Normal — 10x amplification is expected and correct. |
| `src/RegionSelectionTool.jsx:61, 71` | `canvasRectRef.current.width / scale` for hit-testing | Normal — 10x amplification. |
| `src/utils/geometryEraser.js:333` | `eraserRadius / scaleX` for per-object eraser sizing | Normal. Even at `scaleX=0.1` this produces `eraserRadius * 10`, which is still finite. |
| `src/App.jsx:25001, 25002, 25034, 25406, 25407, 25438, 25868, 25869, 25900` | Cursor delta divided by `effectiveScale` for new text box / new region creation | Normal — at scale=0.1 a 1px cursor drag yields a 10pt annotation delta, which is correct and intuitive. |
| `src/PageAnnotationLayer.jsx:6958` | Eraser zoom-compensation | Normal. |

**Division guards:** `safeDivide` at `zoomController.js:66-71` returns `null`
on zero — no NaN injection from the fit-zoom calculations.

**Stroke widths, hit-rect padding, label positioning at 10%:**

- SVG strokes use `vector-effect: non-scaling-stroke` project-wide (invariant
  per CLAUDE.md). Stroke width is constant in screen space regardless of
  viewBox scale, so at 10% zoom a 2pt stroke still renders as 2 screen pixels.
- Selection handles are multiplied by `inverseScale` in
  `src/components/SVGSelectionOverlay.jsx:33-58` (handle sizes, shadow
  offsets, pill dimensions). At 10% zoom, `inverseScale ≈ 10`, which scales
  the handle's viewBox extent by 10x to compensate for the 10x CSS shrink.
  Handles stay at constant screen size.
- `getInverseScale` (svgTransformMath.js:72) is just `1 / (clientWidth /
  viewBoxWidth)`. At clientWidth=61px, viewBox=612pt, returns ~10. No lower
  bound, no clamp, no division-by-zero risk (guarded by `if (!clientWidth)
  return 1`).

**Sub-pixel effects at 10%:** a 2pt stroke on a 61-pixel-wide rendering of a
612pt page is 0.2 device pixels in viewBox mapping, BUT the `non-scaling-stroke`
directive bypasses that math entirely. No precision issues.

**Known accepted behavior:** at very low zoom the handle hit zones may stack
or occlude each other (Illustrator/Photoshop model — see FEATURES.md "Edge
Case Analysis"). This is an accepted table-stakes tradeoff, not a regression.

---

## Question 3 — Build Order

### One phase or two?

**One phase.** Both features are trivial, share the concept of "shape edit
polish," and have zero interaction between their integration points. Splitting
them doubles phase overhead (two CONTEXT.md files, two PLAN.md files, two
RECONCILIATION.md files) for zero risk reduction.

### Are they truly independent?

**Yes, fully independent.** File overlap is zero:

| Feature | Files touched |
|---------|---------------|
| Shift+rotate snap | `src/hooks/useSVGInteraction.js` |
| Zoom floor 10% | `src/utils/zoomController.js` + `src/App.jsx` |

No overlap. No ordering constraint. Either can ship first without breaking
the other's intermediate state.

### Suggested commit order

**Recommend two commits inside one phase, in this order:**

1. **Commit A — Zoom floor 10%.**
   - `src/utils/zoomController.js:15` — `MIN_SCALE: 0.5 → 0.1`
   - `src/App.jsx:21999` — `50 → 10` in `commitZoomInput` pre-clamp
   - These two changes must ship together (either alone leaves a broken
     intermediate state: typing 10 into the zoom input would parse-clamp to
     10 via line 21999 but then clamp to 50 via `clampScale` if only A2 ships,
     or display 50 because the pre-clamp eats it if only A1 ships).
   - Test: verify zoom buttons, wheel, keyboard, fit-page, and typing `10`
     into the input all land at 10%.

2. **Commit B — Shift+rotate 45° snap in SVG path.**
   - `src/hooks/useSVGInteraction.js:391-408` — add `if (e.shiftKey) newAngle
     = Math.round(newAngle / 45) * 45;` and promote `const newAngle` → `let
     newAngle`.
   - Test: select a shape, drag rotate handle, verify free rotate; then drag
     with Shift held, verify snap to 0/45/90/135/180/225/270/315°.

**Rationale for this order:** Commit A is the lower-risk change (literal-swap
in a well-funneled constant). Commit B modifies interaction code that could
theoretically break resize if the `const → let` change is bungled (it won't,
but risk ordering says ship the safer change first).

---

## Question 4 — Data Flow Changes

### Does anything change about annotation persistence or the Fabric→SVG bridge?

**NO.** HIGH confidence.

- **Annotation JSON shape:** unchanged. `obj.angle` is already serialized as
  a float for every annotation type. Whether that float happens to be a
  multiple of 45 has no effect on the Fabric.js JSON format, the SVG renderer,
  Supabase sync, undo/redo snapshots, or PDF export.
- **Fabric→SVG bridge:** unchanged. The SVG renderer reads `obj.angle` and
  applies `transform="rotate(angle, cx, cy)"`. Float angles work. Snapped
  angles work. Zero difference.
- **Zoom persistence:** `loadZoomPreferences` at `zoomController.js:28-48`
  reads any previously-saved `manualScale` and runs it through `clampScale`,
  which now accepts 0.1. A user who previously had zoom stuck at 50% will
  load unchanged; a future 10% zoom is now persistable to localStorage.

### Does rotation snap propagate to committed annotation JSON, or is it purely live-interaction UX?

**It propagates — but invisibly.** The snap is applied inside
`handlePointerMove` at line 391-408, which sets `ds.currentAngle` to the
snapped value. The commit branch at 559-568 reads `ds.currentAngle` and saves
it. So the committed annotation `obj.angle` IS the snapped value (e.g. `45`,
not `44.3`).

This is correct UX — users expect "Shift-drag to 45 and release" to persist
`45°`, not `44.7°` that happens to look snapped during the drag. It is also
entirely transparent to every downstream consumer (see Q1d).

The snap is UX-live AND persistence-live in one motion. No separate commit
transformation, no normalization pass, no opt-in flag.

---

## Exhaustive "Files That Must NOT Change" List for the Phase

Per the project's phase discipline rules (CLAUDE.md), the Stage 0 CONTEXT.md
must carry a DO NOT CHANGE allowlist. The following files are in-scope for
this milestone (subject to explicit carve-outs from the Always Protected
list):

**In scope (edit allowed):**
- `src/utils/zoomController.js` — NEW scope carve-out for this phase
- `src/hooks/useSVGInteraction.js` — NEW scope carve-out for this phase
- `src/App.jsx` — **SCOPED CARVE-OUT**: single-line edit at line 21999 only
  (`50` → `10` inside `commitZoomInput`). Every other line of App.jsx
  remains Always Protected.

**DO NOT CHANGE (must appear verbatim in CONTEXT.md):**
- `src/components/PageAnnotationLayer.jsx` — thin 41-line region-polygon
  wrapper, unrelated to zoom/rotation
- `src/PageAnnotationLayer.jsx` — **including the legacy
  modifier-rotation path at lines 6080-6355**. Always Protected AND
  explicitly out of scope for this milestone. Do not touch its
  `Math.atan2`/`rotationStateRef` code even though it duplicates rotation math.
- `src/components/FabricEditCanvas.jsx` — **fully protected for Stage 0.**
  STACK.md originally suggested adding `snapAngle` here; this milestone
  drops that suggestion because shape rotation in Fabric edit is commit-lossy.
  Leaving FabricEditCanvas untouched also preserves the `zoomGeneration`
  signal contract with zero risk.
- `src/components/FabricDrawingCanvas.jsx` / `FabricEraserCanvas.jsx` — always
  protected, unrelated
- `src/components/SVGAnnotationLayer.jsx` — always protected, unrelated (this
  milestone only touches the interaction hook it consumes, not the renderer)
- `src/components/SVGSelectionOverlay.jsx` — unrelated (rendering only, no
  rotation math)
- `src/components/SyncfusionPDFContainer.jsx` — verified: `coerceZoom` already
  clamps [10, 1000], no change needed
- `src/utils/svgTransformMath.js` — unrelated (pure math helpers)
- `src/utils/svgAnnotationRenderers.jsx` — unrelated (arrowhead geometry)
- `src/components/LightweightAnnotationOverlay.jsx` — unrelated (legacy
  overlay, not touched)
- `src/contexts/*`, `src/sidebar/*`, `src/components/Callout/*` — unrelated
- `package.json` / `vite.config.js` — always protected, no dep changes

---

## Revised Integration Points Summary

STACK.md proposed **4 integration points** (SVG rotate + Fabric shape rotate +
MIN_SCALE + App.jsx:21999). This research reduces that to **3** by dropping
the Fabric shape rotate integration:

| # | File | Line(s) | Change | LOC |
|---|------|---------|--------|-----|
| 1 | `src/hooks/useSVGInteraction.js` | 391-408 (rotate branch of `handlePointerMove`) | Add `if (e.shiftKey) newAngle = Math.round(newAngle / 45) * 45;`. Promote `const newAngle` → `let newAngle`. | 3 |
| 2 | `src/utils/zoomController.js` | 15 | `const MIN_SCALE = 0.5;` → `const MIN_SCALE = 0.1;` | 1 |
| 3 | `src/App.jsx` | 21999 | `Math.min(Math.max(parsed, 50), 500)` → `Math.min(Math.max(parsed, 10), 500)` | 1 |

**Total: 5 LOC across 3 files** (not ~11 LOC across 4 files as STACK.md
estimated). The reduction comes from dropping the dead-code Fabric edit
integration.

**If later validation demands that the Fabric shape rotate also snap** (for
example, if a user complains that the live preview during edit doesn't snap
even though the commit discards it anyway), that can be added in a follow-up
phase with ~5 LOC inside `loadShapeAnnotation`. It is **not required** for
Stage 0 acceptance.

---

## Anti-Patterns to Avoid During Implementation

### Anti-Pattern 1: Touching the PAL legacy rotation path

**What someone might do:** "For consistency, add Shift-snap to
`src/PageAnnotationLayer.jsx:6212-6244` too."

**Why it's wrong:** PAL is Always Protected. The path is effectively dead in
v2.0+. Touching it risks collateral damage to the 9,858-line PAL file for a
flow the user rarely reaches. Scope creep.

**Do this instead:** Add PAL to the DO NOT CHANGE list and move on.

### Anti-Pattern 2: Adding `snapAngle` to FabricEditCanvas shape load

**What someone might do:** Follow STACK.md Q1 literally and add
`window.addEventListener('keydown', ...)` inside `loadShapeAnnotation`.

**Why it's wrong:** Shape rotation inside FabricEditCanvas is discarded on
commit (see Q1c). The snap is cosmetic-only and invisible to the user because
they see the SVG version post-commit.

**Do this instead:** Ship the SVG-side snap only. If a future Fabric-edit
rotation polish is scoped, fix the commit-path first (make
`commitAndClose` preserve `activeObj.angle` for shapes) before adding snap.

### Anti-Pattern 3: Deleting the `commitZoomInput` pre-clamp

**What someone might do:** "`clampScale` already exists, the 21999 pre-clamp
is redundant — delete it."

**Why it's wrong:** The pre-clamp provides input sanitization for the text
field specifically (it caps absurd values like `99999`). Deleting it changes
the error-recovery behavior of the zoom input and could expose NaN paths.

**Do this instead:** Swap `50 → 10` in place. Preserve the `500` upper bound
(which matches `MAX_SCALE * 100`). Do not restructure the function.

### Anti-Pattern 4: Splitting the zoom floor change across two commits

**What someone might do:** Ship the zoomController.js change first, then the
App.jsx:21999 change later.

**Why it's wrong:** Between the two commits, typing `10` into the zoom input
would be silently clamped to `50` by the pre-clamp, then passed through
`clampScale(50/100) = 0.5`. The user would see the zoom snap back to 50%
with no explanation. Broken intermediate state.

**Do this instead:** Ship both changes in one commit (see Build Order above).

---

## Confidence Assessment

| Claim | Confidence | Basis |
|-------|------------|-------|
| `useSVGInteraction.js:391` is the sole SVG rotation write path | HIGH | Direct file read + exhaustive grep of `atan2`, `mode === 'rotate'`, `\.angle =`, `normalizeAngle` |
| Shape rotation in FabricEditCanvas is commit-lossy | HIGH | Direct read of `commitAndClose` (lines 471-500) and `loadShapeAnnotation` (lines 1032-1048) |
| PAL legacy rotation handler is reachable but not on primary flow | HIGH | Direct read of `handleMouseDownForPan` gating logic + knowledge that SVG owns selection in v2.0+ |
| No hidden `MIN_SCALE = 0.5` dependencies anywhere | HIGH | Exhaustive grep across `src/` for literal `0.5`, `MIN_SCALE`, `minScale`, `minZoom`, `Math.max(..., 0.5)`, `scale < 0.`, and `Math.max(..., 50)` |
| Syncfusion already supports 10% | HIGH | Direct read of `coerceZoom` (SyncfusionPDFContainer.jsx:29-33) |
| Handle sizes at 10% remain usable | HIGH | Direct read of SVGSelectionOverlay.jsx:46-58 (multiplies by inverseScale) + getInverseScale formula |
| No scale-division blow-ups at 0.1 | HIGH | Sweep of every `/ scale`-like division in src/. All produce finite amplified values that are intuitive (pixel→point conversion) |
| Data model unchanged | HIGH | Snap is applied inside pointer-move before commit, writes float angle as usual; no serialization change |
| Build order Commit A before Commit B | MEDIUM | Opinion call based on risk ordering; either order works mechanically |

---

## Sources

All findings are grounded in direct file reads during this research session:

- `src/utils/zoomController.js` (full file, 237 lines) — `MIN_SCALE` declaration
  and `clampScale` funnel behavior
- `src/hooks/useSVGInteraction.js` (full file, 724 lines) — rotation branch,
  commit path, existing Shift-key precedents (lines 143, 361)
- `src/components/FabricEditCanvas.jsx` (selected ranges: 380-530, 760-1230) —
  commit path's `json.angle` override, shape load's `angle: 0` force, callout
  differentiation
- `src/components/SyncfusionPDFContainer.jsx:25-75` — `coerceZoom` [10, 1000]
  clamp
- `src/App.jsx:21980-22020` — `commitZoomInput` pre-clamp
- `src/PageAnnotationLayer.jsx:3150-3200, 5995-6355` — legacy rotation
  handler scope and trigger conditions
- `src/components/SVGSelectionOverlay.jsx:1-80` — handle sizing via
  `inverseScale`
- `src/utils/svgTransformMath.js:1-80` — `getInverseScale`, `normalizeAngle`,
  `constrainToPage` helpers
- Exhaustive grep queries (documented inline above) against the full `src/`
  tree for: `MIN_SCALE`, literal `0.5` clamps, `atan2` usage, `clampScale`
  call sites, `snapAngle`, `/ scale` divisions, and `Math.max(..., 50)`.

STACK.md and FEATURES.md from this same research session were consulted for
LOC estimates and UX convention. This file supersedes STACK.md's Q1 Fabric
integration guidance (see Q1c above) and refines STACK.md's "4 integration
points" claim down to 3.

---

*Architecture research for: v2.1 Stage 0 Shape Edit Polish*
*Researched: 2026-04-12*
*Downstream consumer: Stage 0 phase CONTEXT.md + PLAN.md*

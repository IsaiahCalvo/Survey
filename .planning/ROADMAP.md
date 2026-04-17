# Roadmap: PDF Annotation App

## Milestones

- [x] **v1.0 Zoom Flicker Fix** — Phases 1-3 (shipped 2026-03-19), Phases 4-7 superseded/deferred
- [x] **v2.0 SVG Migration** — Phases 8-11 (shipped 2026-04-10) — [archive](milestones/v2.0-ROADMAP.md)
- [x] **v2.1 Shape Edit Polish & Foundation Wins** — Phase 12 (shipped 2026-04-14, DONE_WITH_CONCERNS) — [archive](milestones/v2.1-ROADMAP.md)
- [x] **v2.2 Rotation Handle Polish** — Phase 13 (shipped 2026-04-14)
- [ ] **v2.3 Tools Polish (combined-tools rewrite)** — Phases 14-18 (planning, 26 requirements)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

<details>
<summary>v1.0 Zoom Flicker Fix (Phases 1-7) - Phases 1-3 SHIPPED 2026-03-19</summary>

- [x] **Phase 1: Overlay Attachment Foundation** - Persistent overlay divs as direct children of Syncfusion page divs (completed 2026-03-18)
- [x] **Phase 2: Zoom Handler** - CSS transforms on overlay divs during zoom for visual stability (completed 2026-03-18)
- [x] **Phase 3: Render Loop Rewrite** - React portals render into persistent overlay divs (completed 2026-03-19)
- [ ] ~~**Phase 4: PAL Zoom Simplification**~~ - Superseded by SVG migration (4 failed attempts)
- [ ] ~~**Phase 5: Page Container Re-attachment**~~ - Superseded by SVG migration
- [ ] ~~**Phase 6: Dead Code Removal**~~ - Superseded by SVG migration
- [ ] ~~**Phase 7: Widen Zoom Range**~~ - Deferred to future milestone

</details>

<details>
<summary>v2.0 SVG Migration (Phases 8-11) - SHIPPED 2026-04-10</summary>

- [x] **Phase 8: SVG Display Foundation** - All 7 annotation types render as SVG with viewBox auto-scaling, replacing Canvas-based display
- [x] **Phase 9: SVG Selection and Interaction** - Click-to-select, drag-to-move, resize handles, and multi-select in SVG without Canvas
- [x] **Phase 10: Canvas Mount/Unmount (Pen + Eraser)** - Fabric.js Canvas mounts conditionally for pen/highlighter drawing and eraser operations (completed 2026-03-27)
- [x] **Phase 11: Text/Shape Editing + Zoom Cleanup** - Targeted Canvas mount for text/shape editing, zoom integration, and removal of old timer machinery (completed 2026-04-02)

</details>

<details>
<summary>v2.1 Shape Edit Polish & Foundation Wins (Phase 12) — SHIPPED 2026-04-14 (DONE_WITH_CONCERNS)</summary>

- [x] **Phase 12: Shape Edit Polish** — Soft Shift-snap at 45° with 3° threshold (EDIT-11), rotation degree input field for exact angles (EDIT-12, delivered with 2 polish gaps), zoom floor lowered to 10% (ZOOM-09) (completed 2026-04-14)

See [`milestones/v2.1-ROADMAP.md`](milestones/v2.1-ROADMAP.md) for full phase details, 3-plan breakdown, decisions, issues resolved/deferred, and carry-forward lessons.

</details>

<details>
<summary>v2.2 Rotation Handle Polish (Phase 13) — SHIPPED 2026-04-14</summary>

- [x] **Phase 13: Rotation Handle Edit-Mode Polish** — Hover pill re-arm via event delegation (EDIT-13) + rescoped "no Fabric transform handles in edit mode" (EDIT-14, Figma-style separation under narrow waiver)

</details>

### v2.3 Tools Polish (combined-tools rewrite + unified render)

- [ ] **Phase 14: Unified SVG Callout Render + Shared Tool Foundation** — Port the text callout off its current HTML-overlay React system onto the same SVG pipeline all other annotations use (via `<foreignObject>`), and land the three cross-tool interaction foundations (crosshair cursor, Delete/Backspace, dashed creation preview) while the SVG interaction layer is already being touched for callouts.
- [ ] **Phase 15: Line/Arrow Curvature + Arrowhead Styles** — Wire the already-ported `lineGeometry.js` curvature math (`getCurvedPath` / `getCurveEndAngle` / `shouldSnapToLinear`) into the SVG renderers + `useSVGInteraction.js` midpoint drag mode, and lift the 6-style arrowhead enum from the callout system into the line/arrow data model + render.
- [ ] **Phase 16: Line/Arrow Mini-Toolbar + Curvature Pill + Min-Drag** — Line/arrow "act like regular shapes" with a mini-toolbar matching rect/circle/ellipse lifecycle, a hover-reveal typeable curvature pill mirroring the v2.1 `RotationInputField` + `applyOptimisticRotation` pattern, and a minimum-drag-length threshold on creation.
- [ ] **Phase 17: Callout Handle Collisions + Rollback + Resize** — 30-px collision constraints between arrowTip/knee/textbox handles, whole-callout snap-back on drop into invalid configurations, and correct corner-resize geometry at all zoom levels (fix four underlying issues enumerated in CURRENT-REPO-AUDIT.md Gap 3).
- [ ] **Phase 18: Callout Auto-Routing + Hover Affordances + Self-Destruct** — Liang-Barsky auto-routing so the knee wraps around the textbox without the connector lines crossing the interior, hover-reveal knee/arrowTip handles with 50 ms hide delay, selection-preview hover glow, and empty-text self-destruct on edit-mode exit.

## Phase Details

<details>
<summary>v1.0 + v2.0 phase details (collapsed — shipped)</summary>

### Phase 8: SVG Display Foundation
**Goal**: All committed annotations render correctly as SVG elements with browser-native zoom scaling via viewBox, replacing Canvas-based display rendering
**Depends on**: v1.0 Phase 3 (overlay div foundation -- already shipped)
**Requirements**: DISP-01, DISP-02, DISP-03, DISP-04, DISP-05, DISP-06, DISP-07, DISP-08, DISP-09, DISP-10, DISP-11
**Success Criteria** (what must be TRUE):
  1. User sees all 7 annotation types (pen strokes, highlights, lines, arrows, callouts, shapes, text) rendered on the PDF at correct positions -- visually matching the previous Canvas-based rendering
  2. User can zoom in/out using any method and annotations scale smoothly with zero disappearance, zero flicker, and zero JavaScript coordination
  3. Pen and highlighter strokes appear at exactly the correct position (pathOffset handling verified) -- no 50-200px offset errors
  4. Stroke widths on lines, shapes, and arrows remain constant thickness regardless of zoom level (non-scaling-stroke)
  5. Region/space filtering still works -- toggling a space or module shows/hides the correct annotations
**Plans**: 2 plans

Plans:
- [x] 08-01-PLAN.md -- SVGAnnotationLayer core + renderer toggle + tier 1 types (pen, highlights, lines, arrows)
- [x] 08-02-PLAN.md -- Tier 2 types (shapes, text, callouts) + eraser rendering + full PAL-level filtering

### Phase 9: SVG Selection and Interaction
**Goal**: Users can select, move, and resize annotations entirely in SVG without mounting a Canvas
**Depends on**: Phase 8
**Requirements**: INTR-01, INTR-02, INTR-03, INTR-04, INTR-05, INTR-06, INTR-07, INTR-08, INTR-09, INTR-10
**Success Criteria** (what must be TRUE):
  1. User can click an annotation to select it and see a visual highlight with 8 resize handles at corners and midpoints
  2. User can drag a selected annotation to move it, and the annotation stays at the new position after release
  3. User can drag resize handles to scale an annotation, and the annotation renders correctly at the new size
  4. User can select multiple annotations (shift-click), drag them as a group, and delete the group
  5. Double-clicking an annotation transitions to edit mode (the trigger point for Canvas mount in later phases)
**Plans**: 3 plans

Plans:
- [x] 09-01-PLAN.md -- Utility modules + selection hook + SVGSelectionOverlay + wiring into SVGAnnotationLayer
- [x] 09-02-PLAN.md -- Drag-to-move + resize handles + rotation handle
- [x] 09-03-PLAN.md -- Multi-select (shift-click) + group drag/delete + double-click edit trigger

### Phase 10: Canvas Mount/Unmount (Pen + Eraser)
**Goal**: Fabric.js Canvas mounts only when the user activates pen, highlighter, or eraser tools, captures the work, and unmounts cleanly
**Depends on**: Phase 9
**Requirements**: EDIT-01, EDIT-02, EDIT-03, EDIT-04, EDIT-05, EDIT-09, EDIT-10
**Success Criteria** (what must be TRUE):
  1. User selects the pen or highlighter tool, draws strokes on the page, switches to a different tool, and the strokes persist in SVG -- no Canvas remains mounted
  2. User selects the eraser tool, erases part of an existing annotation, switches tools, and the erased result persists in SVG correctly
  3. User switches tools rapidly (pen -> select -> eraser -> pen) and no strokes are lost, no stale Canvas elements remain in the DOM, and no console errors appear
  4. User is mid-stroke when zoom occurs, and the in-progress stroke is auto-committed before Canvas unmounts -- no data loss
**Plans**: 2 plans

Plans:
- [x] 10-01-PLAN.md -- useFabricCanvas hook + FabricDrawingCanvas (pen/highlighter) + App.jsx wiring
- [x] 10-02-PLAN.md -- FabricEraserCanvas (annotation loading + boolean path subtraction) + App.jsx wiring + full verification

### Phase 11: Text/Shape Editing + Zoom Cleanup
**Goal**: Text and shape annotations are editable via targeted Canvas mount, and all old zoom timer machinery is removed
**Depends on**: Phase 10
**Requirements**: EDIT-06, EDIT-07, EDIT-08, ZOOM-01, ZOOM-02, ZOOM-03, ZOOM-04, ZOOM-05, ZOOM-06, ZOOM-07, ZOOM-08
**Success Criteria** (what must be TRUE):
  1. User double-clicks a text annotation, edits the text content inline, clicks away, and the updated text appears in SVG -- Canvas disappears after commit
  2. User double-clicks a shape or callout, modifies its properties (color, stroke, size), and changes persist in SVG after commit
  3. User zooms while Canvas is mounted for editing, and the Canvas receives a CSS transform for visual stability then remounts at correct dimensions after settle
  4. All 6 zoom methods work with zero timer coordination -- no freeze, snapshot, confirm-pending, or settle timers remain in the codebase
  5. Dead props (onScaleApplied, presentationApiRegistry, isHidden) and the old 5-timer zoom system functions are fully removed from App.jsx and PageAnnotationLayer
**Plans**: 2 plans

Plans:
- [x] 11-01-PLAN.md -- FabricEditCanvas component (text/shape/callout editing) + App.jsx edit mode wiring
- [x] 11-02-PLAN.md -- Old 5-timer zoom system removal from App.jsx + dead prop cleanup from PAL + CLAUDE.md update

</details>

### Phase 12 details archived

See [`milestones/v2.1-ROADMAP.md`](milestones/v2.1-ROADMAP.md) for Phase 12's
full goal, dependencies, requirements, success criteria, 3-plan breakdown,
key decisions, issues resolved/deferred, and technical debt.

### Phase 13: Rotation Handle Edit-Mode Polish

**Goal**: Close out the rotation interaction story by fixing the two Phase 12 carry-forward gaps so the rotation handle and its hover pill behave correctly across every edit-mode entry/exit transition. Users should never need a deselect/reselect workaround to re-arm the pill, and a pre-rotated shape should never enter edit mode with a clipped rotation handle.

**Depends on**: Phase 12 (v2.1 — RotationInputField + optimistic-paint pattern + 113/113 test baseline)

**Requirements**: EDIT-13, EDIT-14

**Why a single phase with two plans (not two phases):** Both gaps live in the same narrow interaction surface — rotation handle chrome during edit-mode transitions on shapes selected in `SVGAnnotationLayer.jsx`. They share the same UAT grid (`{angle=0, angle=30} × {edit exit via click-off / Escape / Enter-commit}`), the same lane-safety profile (SVG-side fixes only, zero counter-session WIP touched), and the same regression baseline (113/113 v2.1 tests + Plan 12-02's 7-round focus-loss scenarios). Splitting into two phases would duplicate verification overhead with no isolation benefit. A single Phase 13 with one plan per requirement keeps the milestone surgical and the reconciliation trivial.

**Success Criteria** (what must be TRUE — all four verified by human UAT at both `angle=0` AND `angle=30` shapes):

  1. **Pill re-arms after every edit-mode exit path** — User selects a shape, double-clicks into edit mode, exits edit mode via click-off / Escape / Enter-commit (all three exit paths), hovers the rotation handle, and sees the typed-degree pill appear within the existing 150ms hover-intent window — without needing to deselect and reselect first. Verified for `editType='shape'` (rect, circle, ellipse) AND `editType='text'`.

  2. **Rotation handle visible on edit-mode entry for pre-rotated shapes** — User double-clicks a shape that already has a non-zero angle (verified at `angle=30`) and sees the full rotation handle (circle + connector + icon) rendered without clipping by any container or page-div ancestor. Visual-only visibility is sufficient; the handle does not need to be draggable in edit mode (rotation interaction is already provided by select-mode drag and the typed-degree pill). Verified for rect, circle, ellipse, and text edit modes.

  3. **No regressions to v2.1 baseline** — All 113/113 v2.1 tests remain green. Plan 12-02's 7-round focus-loss scenarios (RotationInputField focus on Tab, click-out, Arrow nudge, Enter commit, hover during drag, Shift modifier, blur) all still pass. The optimistic-paint pattern is preserved: `console.count` on the hover-intent effect body during a 2-second drag-rotate fires ≤3 times (never at 60fps).

  4. **Counter-session lane stays untouched** — Final commit set for Phase 13 includes ZERO files from the 7-file counter-session WIP allowlist. `git status` cross-check before every commit confirms `src/App.jsx`, `src/components/PageAnnotationLayer.jsx`, `src/components/FabricEditCanvas.jsx`, `src/hooks/useDatabase.js`, `src/utils/counterNumbering.js`, `src/utils/svgAnnotationRenderers.jsx`, and `dist/index.html` are untouched by Phase 13's diffs.

**Plans**: 2 plans

Plans:
- [x] **13-01-PLAN.md — EDIT-13 hover pill stale-ref fix (Gap 3)** — DONE 2026-04-14, commit 6cf9e8c9 — Modify the hover-intent `useEffect` in `SVGAnnotationLayer.jsx:213-313` so the rotation pill re-arms after any edit-mode exit path. Strategy A acceptable (add `editingAnnotationIndex` to dep array + early-return gate at effect top); Strategy B preferred (event delegation on stable SVG ancestor via `e.target.closest('[data-rotation-handle="mtr"]')`). Both must gate on `editingAnnotationIndex == null`. Preserves the load-bearing `eslint-disable react-hooks/exhaustive-deps` invariant by NOT adding tick-rate values (`annotations`, `visualTransform`) to the dep array. Files in scope: `src/components/SVGAnnotationLayer.jsx` only.

- [x] **13-02-PLAN.md — EDIT-14 mtr handle visibility fix (Gap 4)** — DONE 2026-04-14 — Rescoped mid-plan to "no Fabric transform handles in edit mode for any shape" (Figma-style separation). See v2.2 RECONCILIATION for rescope rationale.

### Phase 14: Unified SVG Callout Render + Shared Tool Foundation

**Goal**: Users see the text callout rendered through the same SVG pipeline as every other annotation type (via `<foreignObject>` for the text content, mirroring how text annotations work today), and experience consistent crosshair cursor + Delete/Backspace + dashed creation preview across line, arrow, and callout tools — so all downstream callout polish (collisions, rollback, resize, auto-routing, hover glow) can build against a single unified interaction surface instead of the soon-to-be-deleted `src/components/Callout/` HTML-overlay React system.

**Depends on**: Phase 13 (v2.2 — hover-intent event delegation pattern + 113/113 test baseline), rewrite permission granted 2026-04-14

**Requirements**: CALL-10, UX-01, KBD-01, CREATE-01

**Why this is Phase 14 (the unblocker):** CALL-10 is architecturally load-bearing — once the callout renders through `svgAnnotationRenderers.jsx` + `useSVGInteraction.js` like every other annotation type, the other 9 callout requirements (CALL-01..09) fit into the existing SVG interaction pattern instead of having to be built inside the separate `src/components/Callout/` system and then re-built during unification. Doing CALL-10 first means Phases 17-18 build forward against the final render path, not a dead codepath. The three shared-tool foundations (UX-01 crosshair, KBD-01 Delete/Backspace, CREATE-01 dashed preview) ride along in this phase because they touch the same SVG interaction layer that callouts are being moved into, and because lines/arrows in Phase 15+ will need them as a baseline before their own mini-toolbar work lands.

**Boundary notes (CLAUDE.md Always-Protected):**
- `src/App.jsx` — **per-phase waiver required if touched.** This phase may need to update App-level `activeTool` handling for the new crosshair-cursor contract and the Delete/Backspace keyboard handler (currently at App.jsx:~22480). Flag loudly in plan CONTEXT; prefer routing through existing handlers when possible.
- `src/components/SVGAnnotationLayer.jsx` — in scope for this phase (owns SVG render dispatch + hover/cursor layer).
- `src/components/PageAnnotationLayer.jsx` — DO NOT CHANGE. PAL's legacy callout code is untouched; this phase moves the *new* React callout system, not PAL's.
- `src/components/FabricEditCanvas.jsx` — may need `editType: 'callout'` branch updates once unified callouts enter edit mode via double-click. Flag in plan CONTEXT if touched.
- `src/components/Callout/*` — this directory is explicitly in scope for replacement/removal per user rewrite permission.

**Success Criteria** (what must be TRUE):

  1. **Unified render path** — User creates, selects, and views a text callout on a page at any zoom level and the callout renders through `svgAnnotationRenderers.jsx` (new `renderCallout` implementation using `<foreignObject>` for the text content, same pattern as `renderText`), not through a CSS-transformed React overlay. The old `src/components/Callout/CalloutCanvas.jsx` + `CalloutComponent.jsx` + `index.jsx` system is no longer mounted for new callouts; the directory is either removed or reduced to a type-only shim.

  2. **Crosshair while tool active (UX-01)** — User activates line, arrow, or callout tool and the SVG interaction surface shows a `crosshair` cursor until the tool deactivates or a creation drag starts. Default/move cursor returns immediately on deactivation.

  3. **Delete/Backspace on selection (KBD-01)** — User selects a line, arrow, or callout (single-select), presses `Delete` or `Backspace` with no text-input focused, and the selected annotation is removed from the store with undo support. Keyboard shortcut is suppressed when focus is in a text input / contentEditable / Fabric editing field.

  4. **Dashed creation preview (CREATE-01)** — User starts a click-drag to create a line, arrow, or callout and sees a dashed preview at 0.6 opacity following the pointer in real time using the same color/thickness as the committed annotation will have. Preview disappears on mouse-up and is replaced by the committed SVG annotation.

  5. **Data-model continuity** — Existing callouts saved under the old HTML-overlay system continue to load, render, and select correctly through the new unified SVG path. No Supabase schema change. A callout round-tripped through save + reload + save is byte-identical in its Fabric.js JSON fields.

**Plans**: 3 plans

- [x] `14-01-PLAN.md` — Wave 0 test scaffolds (3 unit + 5 Playwright) + revise `renderCallout` with page-coord signature + data attributes + new `calloutEditAdapter.js` utility + sanitize `defaultCalloutStyle.fontFamily` to single-name (wave 1, parallel) — **DONE 2026-04-15** (`14-01-SUMMARY.md`: 31/31 new unit tests pass, 21 Playwright scaffolds discoverable, 4 commits, lane boundary respected)
- [x] `14-02-PLAN.md` — Shared foundation: UX-01 crosshair class + pointerEvents split derivation + KBD-01 extended Delete/Backspace handler + CREATE-01 line/arrow dashed preview with pre-commit reset (narrow-lane FabricDrawingCanvas waiver ~10-15 LOC) (wave 1, parallel) — **DONE 2026-04-15**
- [ ] `14-03-PLAN.md` — Integration: unwind `filteredCallouts` gate + replace 5 Callout HTML-overlay files with null-render stubs + `callout-part` drag mode (4-place invariant) + edit-mode entry via `calloutEditAdapter` + FabricEditCanvas save-callback wrapper + callout creation state machine + un-skip 3 Playwright scenarios (narrow-lane App.jsx waiver) (wave 2)

### Phase 15: Line/Arrow Curvature + Arrowhead Styles

**Goal**: Users can select a line or arrow, drag its middle handle to bend it into a quadratic bezier that passes through the handle position, drag it back near straight to auto-reset, and drag endpoints of a curved line/arrow to reshape the curve with the midpoint held fixed — and users can choose from six arrowhead styles (`NONE`, `SOLID_TRIANGLE`, `V_SHAPE`, `OPEN_CIRCLE`, `OPEN_TRIANGLE`, `HORIZONTAL_LINE`) on the selected line/arrow, with the arrowhead correctly rotating to the curve's tangent when curved.

**Depends on**: Phase 14 (shared crosshair/Delete/preview foundation in place)

**Requirements**: LINE-01, LINE-02, LINE-03, ARROW-01, ARROW-02, ARROW-03, ARROW-04

**Why these seven together:** LINE-01..03 and ARROW-01..03 are the same wiring job against the already-ported `src/utils/lineGeometry.js` — one new `'midpoint'` drag mode in `useSVGInteraction.js`, two renderer branches (`<line>` → `<path d="M x1 y1 Q cx cy x2 y2">` when `data.midpoint` present), one new handle render in `SVGAnnotationLayer.jsx:~1263`, and the `getCurveEndAngle` tangent swap for curved-arrow heads. The math is already ported — do not rewrite. ARROW-04 (six arrowhead styles) joins this phase because the style picker's `arrowheadStyle` field lives inside the same line/arrow data model that's being extended with `data.midpoint`, the six render-switch cases are adjacent to the tangent math, and the enum is a direct lift from the existing callout system's `ARROWHEAD_STYLES` at `src/components/Callout/types.js:9-16` + `CalloutComponent.jsx:951-1089`.

**Boundary notes:**
- `src/utils/lineGeometry.js` — CONSUME, do not rewrite. `getCurvedPath`, `getCurveEndAngle`, `shouldSnapToLinear`, `getControlPoint` are already correct ports of combined-tools' math.
- `src/components/PageAnnotationLayer.jsx` — DO NOT CHANGE. PAL is the only current live consumer of `lineGeometry.js`; leave its curved-line codepath alone. The new SVG-side wiring imports from `lineGeometry.js` directly without entangling PAL.
- `src/components/SVGAnnotationLayer.jsx` — in scope for the new midpoint handle render at the existing `isLineType` branch (line 1221-1264). Stay out of the adjacent rotation-handle/counter zones.
- `src/utils/svgAnnotationRenderers.jsx` — in scope for `renderLine` curved-path branch + arrow tangent swap.
- `src/hooks/useSVGInteraction.js` — in scope for the new `'midpoint'` drag mode alongside the existing `'endpoint'` mode.
- `src/components/FabricDrawingCanvas.jsx` — minimal changes only (tag new line/arrow JSON with the `arrowheadStyle` default when creating). Do not remove or rename the `zoomGeneration` signal.

**Success Criteria** (what must be TRUE):

  1. **Middle curvature handle on line (LINE-01 + LINE-02)** — User selects a line, sees a third handle at its midpoint, drags it away from the straight baseline, and sees the line bend into a quadratic curve that visibly passes through the handle position at t=0.5 (not a naive bezier control point — use the `getCurvedPath` derivation). Dragging the midpoint handle back within 10 px of the straight line auto-snaps the line to straight (drag threshold 10 px, render hysteresis 1 px). Proximity-based reset only — no click, no keyboard.

  2. **Endpoint drag preserves curve midpoint (LINE-03)** — User drags a curved line's start or end handle and the curve reshapes with the midpoint held fixed in absolute page coordinates (not rigid-translated with the endpoint). If the new start+end+midpoint alignment becomes naturally collinear within the 10 px threshold, the line auto-reverts to straight with a recomputed geometric midpoint.

  3. **Curved arrow tangent (ARROW-01 + ARROW-02 + ARROW-03)** — User selects an arrow, drags its middle handle to curve it, and sees the arrowhead rotate to match the curve's tangent at the endpoint via `getCurveEndAngle(start, end, midpoint)` — not the straight start-to-end angle. Straightening via the same 10 px snap threshold returns the arrowhead to linear tangent. Endpoint drag preserves the midpoint with the same auto-reversion rule as lines.

  4. **Six arrowhead styles (ARROW-04)** — User can select any line or arrow and choose from `NONE`, `SOLID_TRIANGLE`, `V_SHAPE`, `OPEN_CIRCLE`, `OPEN_TRIANGLE`, `HORIZONTAL_LINE` for the head style. Defaults: `NONE` for lines, `SOLID_TRIANGLE` for arrows. Style persists across save/reload through the Fabric.js JSON `arrowheadStyle` field and renders correctly at every zoom level. (The picker UI itself ships in Phase 16 alongside the mini-toolbar; in this phase the style is readable/writable programmatically and renders correctly, so a plan can verify via manual JSON edit + reload.)

  5. **No regression to straight line/arrow rendering** — Existing saved straight lines and arrows with no `data.midpoint` field continue to render through the plain `<line>` branch at identical visual output as v2.2, and 113/113 baseline tests still pass.

**Plans**: 3 plans

Plans:
- [ ] 15-01-PLAN.md — Wave 0 validation scaffolding (4 unit test files + 4 Playwright scaffolds + baseline capture README; no src/ changes)
- [ ] 15-02-PLAN.md — Wave 1 renderer: pure-JS lineRenderHelpers.js + renderArrowhead React helper + curved-path branch in renderLine
- [ ] 15-03-PLAN.md — Wave 1 interaction: lineDragMath.js + midpoint handle in SVGAnnotationLayer.jsx + 'midpoint' drag mode + endpoint auto-revert in useSVGInteraction.js

### Phase 16: Line/Arrow Mini-Toolbar + Curvature Pill + Min-Drag

**Goal**: Users interact with selected lines and arrows the same way they interact with selected rect/circle/ellipse shapes — a mini-toolbar with color, thickness, and arrowhead style picker appears at the same relative position and with the same show/hide lifecycle, a hover-reveal curvature pill near the midpoint handle shows the current curvature magnitude and accepts typed values with optimistic-paint commits (mirroring the v2.1 `RotationInputField` + `applyOptimisticRotation` pattern), and a minimum-drag-length threshold on creation prevents accidental zero-length annotations.

**Depends on**: Phase 15 (curvature data model + midpoint handle wired in)

**Requirements**: LINE-04, LINE-05, LINE-06, ARROW-05, ARROW-06, ARROW-07

**Why these six together:** LINE-06 and ARROW-07 are the mini-toolbar lifecycle (one implementation reused for both). LINE-04 and ARROW-05 are the curvature pill — architecturally a copy of `RotationInputField` targeting the midpoint handle instead of the mtr handle, using the same HTML-portal + full-click-cycle stopPropagation + uncontrolled-input + constant-orbit-radius pattern from v2.1 Phase 12 Plan 12-02, plus `applyOptimisticRotation`-shaped paint helper for curvature. LINE-05 and ARROW-06 are min-drag-length checks in the creation mouseup handler — same check, two call sites. All six land in `FabricDrawingCanvas.jsx` (creation + min-drag) and `SVGAnnotationLayer.jsx` / new curvature-pill component (selection chrome), so they share the same file lane and verification grid.

**Boundary notes:**
- `src/components/FabricDrawingCanvas.jsx` — in scope for min-drag-length check on line/arrow mouseup. Do not touch the `zoomGeneration` signal.
- `src/components/SVGAnnotationLayer.jsx` — in scope for the new mini-toolbar + curvature-pill render (stable mount points for hover delegation).
- New file expected: `src/components/CurvatureInputField.jsx` (or similar) — mirrors `RotationInputField.jsx` architecture verbatim; share any helpers that make sense with `rotationInputHelpers.js`.
- `src/hooks/useSVGInteraction.js` — minor changes for hover-intent event delegation on the midpoint handle (reuse the `data-rotation-handle` pattern from v2.2 EDIT-13).
- Reuse the v2.2 hover-intent event-delegation pattern (`e.target.closest('[data-curvature-handle="mid"]')`) for the pill re-arm story.

**Success Criteria** (what must be TRUE):

  1. **Mini-toolbar parity (LINE-06 + ARROW-07)** — User selects a line or arrow and sees a mini-toolbar at the same relative position and with the same show/hide lifecycle as the rect/circle/ellipse mini-toolbars today (appears on select, hides on deselect, follows the shape across zoom + pan). Toolbar contains color picker, thickness control, and arrowhead style picker (six options from ARROW-04). Curvature value reads out in the toolbar (read-only when the curvature pill is not hovered). Lines default to `NONE` arrowhead; arrows default to `SOLID_TRIANGLE`.

  2. **Hover-reveal typeable curvature pill (LINE-04 + ARROW-05)** — User hovers the midpoint handle of a selected line or arrow and, after the same hover-intent timing as the rotation pill (~150 ms), sees a curvature-indicator pill showing the current curvature magnitude. User clicks the pill, types a custom curvature value, and sees the line/arrow update live via optimistic paint (the visual updates before the store commit lands, using a `applyOptimisticRotation`-shaped helper adapted for curvature). The pill uses the same HTML-portal + full-click-cycle stopPropagation + uncontrolled-input architecture as `RotationInputField`, and the orbit radius around the midpoint stays constant across curvature magnitudes (worst-case AABB projection, v2.1 canonical pattern).

  3. **Minimum-drag creation threshold (LINE-05 + ARROW-06)** — User clicks on the page with the line or arrow tool active without dragging (zero pointer displacement on mouseup, or displacement below the threshold) and NO line/arrow is created — the creation drag is cancelled silently, no zero-length annotation appears in the store, and no console error fires. Threshold is tunable in one place in `FabricDrawingCanvas.jsx`.

  4. **No regression to rotation pill or mini-toolbar baselines** — 113/113 baseline tests still pass, Plan 12-02's 7-round focus-loss scenarios (RotationInputField focus on Tab, click-out, Arrow nudge, Enter commit, hover during drag, Shift modifier, blur) still pass for rotation, and the rect/circle/ellipse mini-toolbars are visually unchanged.

**Plans**: TBD (populated by `/gsd:plan-phase 16`)

### Phase 17: Callout Handle Collisions + Rollback + Resize

**Goal**: Users can no longer drag a callout's arrowTip / knee / textbox handles into visually broken configurations (handles overlapping, knee inside textbox, arrowTip stuck under the textbox) — live 30 px collision constraints push handles apart during drag, invalid on-drop configurations snap the entire callout back to its drag-start positions, and the corner resize math produces correct geometry at every zoom level without anchor-jitter or stale-ref on rapid re-selection.

**Depends on**: Phase 14 (unified SVG render for callout — collision + resize code is built against the new render path, not the old HTML-overlay system)

**Requirements**: CALL-01, CALL-02, CALL-03, CALL-04, CALL-05

**Why these five together:** All five are constraint / rollback / resize math that lives in the callout drag state machine. CALL-01..03 are three symmetric min-separation clamps (arrowTip↔knee, knee↔textbox border, textbox↔knee) — one constraint helper reused in three drag branches. CALL-04 (on-drop rollback) is the safety net that catches edge cases the live clamps miss. CALL-05 (corner resize) is the same file lane as the collision branches — the four underlying bugs (stale-ref on rapid re-select, hardcoded dragOffset, pixel-vs-normalized min-dimensions, corner math jitter + no flip support) are enumerated in `CURRENT-REPO-AUDIT.md` Gap 3 and must all be fixed together to give a coherent resize story.

**Boundary notes:**
- Post-Phase-14, the callout drag state machine lives in the new unified SVG path (probably `useSVGInteraction.js` + new callout-specific helpers under `src/utils/`). Exact file paths depend on how Phase 14 decomposes. Plan CONTEXT must re-read the post-Phase-14 file map before starting.
- `src/components/PageAnnotationLayer.jsx` — DO NOT CHANGE. PAL's legacy callout path is untouched.
- `src/App.jsx` — DO NOT CHANGE unless resize needs container-aware measurement (`containerEl.offsetWidth / pageSize.width`) reads from App-level refs. Flag in plan CONTEXT.

**Success Criteria** (what must be TRUE — all verified at 50%, 100%, and 200% zoom):

  1. **30 px live collision clamps (CALL-01 + CALL-02 + CALL-03)** — User drags a callout's arrowTip handle toward the knee and the handle is clamped live to a 30 px circle around the knee along the drag axis (CALL-01). User drags the knee toward the textbox border and the knee is projected outward live along the box-to-knee axis so it never enters a 30 px buffer around the closest point on the border (CALL-02). User drags the textbox toward the knee and the textbox pops out live along the axis away from the knee (nearest-edge pop-out on exact overlap) so the knee never enters its 30 px buffer (CALL-03).

  2. **On-drop rollback (CALL-04)** — User drops a drag in a visually invalid configuration (arrowTip inside the textbox plus its buffer, OR knee within 24 px of the arrowTip after all live clamps have run) and the entire callout snaps back to the positions it held at drag-start — all four part positions (arrowTip, knee, textBoxPosition, textBoxWidth/Height) are restored together atomically.

  3. **Resize correctness at all zoom levels (CALL-05 — four underlying bugs fixed)** — User grabs any of the four corner handles at 50%, 100%, and 200% zoom and resizes the textbox: (a) min-width / min-height constraints are enforced consistently at every zoom level (normalized-space or screen-space, not raw pixels), (b) no anchor-jitter when the pointer crosses the anchor corner, (c) no stale-ref on rapid re-selection (the initial-state ref is captured from the current `callouts` array synchronously, not one render behind), (d) the hardcoded `{x:0, y:0}` dragOffset bug from `handleCornerMouseDown` is fixed. All four bugs from `CURRENT-REPO-AUDIT.md` Gap 3 closed.

  4. **No regression to single-select / move / keyboard delete** — User can still single-click the callout to select, drag the textbox to move the whole callout, and press Delete/Backspace to remove — all behaviors from Phase 14 still work.

**Plans**: TBD (populated by `/gsd:plan-phase 17`)

### Phase 18: Callout Auto-Routing + Hover Affordances + Self-Destruct

**Goal**: Users see the callout connector auto-route around the textbox when the user drags the box across the connector path (Liang-Barsky segment clipping so the connector lines never cross the textbox interior), unselected callouts show a hover-reveal selection glow on the textbox border + connector lines and hover-reveal arrowTip + knee handles with a 50 ms hide-delay, and a newly created callout that exits edit mode with empty text self-destructs to prevent orphaned empty callouts from click-drag-release-without-typing.

**Depends on**: Phase 17 (collision / rollback / resize infrastructure in place — hover affordances render on top of the stable drag-state model)

**Requirements**: CALL-06, CALL-07, CALL-08, CALL-09

**Why these four together:** All four are callout polish on top of the stable collision / rollback / resize foundation from Phase 17. CALL-07 (Liang-Barsky auto-routing) is ~500 lines of case analysis ported from `combined-tools/src/lib/calloutGeometry.ts:calculateCalloutConnection` — large, but self-contained inside the connector render function. CALL-06 (hover-reveal handles) and CALL-09 (hover glow) share the same hover-intent machinery and reuse the v2.2 event-delegation pattern (`e.target.closest('[data-callout-id=...]')`). CALL-08 (empty-text self-destruct) is a small check in the callout edit-mode exit handler but lives in the same file lane as the hover affordances.

**Boundary notes:**
- New expected files: `src/utils/calloutRouting.js` (or similar) — house the ported Liang-Barsky math from `combined-tools/src/lib/calloutGeometry.ts`. Existing `src/utils/calloutGeometry.js` is currently dead code on the SVG path (see CURRENT-REPO-AUDIT.md) — may be replaced, renamed, or consolidated at planner's discretion.
- `src/components/FabricEditCanvas.jsx` — in scope minimally for the empty-text check on callout edit-mode exit. The `editType: 'callout'` branch at `FabricEditCanvas.jsx:~1335` may need a small commit-hook. Flag any broader changes in plan CONTEXT.
- Reuse hover-intent event delegation pattern from v2.2 EDIT-13.

**Success Criteria** (what must be TRUE):

  1. **Liang-Barsky auto-routing (CALL-07)** — User drags a callout's textbox so that the straight `arrowTip → knee → boxEdge` connector would visually cross the textbox interior, and the knee auto-routes around the box so that neither line1 (arrowTip → knee) nor line2 (knee → boxEdge) ever crosses the textbox interior. The ~500-line case analysis from `combined-tools/src/lib/calloutGeometry.ts:calculateCalloutConnection` is ported, including the `shouldHideLine1` fallback when no valid route exists. Verified by dragging the textbox in a full circle around the arrowTip at 100% zoom and observing no interior crossings.

  2. **Hover-reveal knee / arrowTip handles with 50 ms hide delay (CALL-06)** — User moves the pointer over any part of an unselected callout and the arrowTip + knee handles fade/reveal visually. Moving the pointer away hides them after a 50 ms delay to prevent flicker on transit across adjacent elements. Same hover-intent pattern as rect/circle/ellipse rotation pill, targeting the callout hit surface via event delegation.

  3. **Selection-preview hover glow (CALL-09)** — User hovers an unselected callout and sees a subtle selection-preview glow on the textbox border + connector lines, matching the line tool's selection-hover glow style from Phase 16 — so line, arrow, and callout all share a consistent "you could click me" hover affordance.

  4. **Empty-text self-destruct (CALL-08)** — User starts a click-drag-release to create a callout but never types any text, and when the callout exits edit mode (click-off / Escape / Enter-commit) the empty callout is automatically removed from the store. User does not see orphaned empty callout rectangles after failed creation attempts. The check fires only on *newly created* callouts; existing callouts with empty text are not deleted on edit-mode exit (safety against accidental data loss).

  5. **v2.3 closes with all 26 requirements verified** — At phase close, the Traceability table in `.planning/REQUIREMENTS.md` shows all 26 requirements with Status = Complete, 113+/113+ baseline tests green, and the line / arrow / text callout tools pass a human UAT script at 50% / 100% / 200% zoom.

**Plans**: TBD (populated by `/gsd:plan-phase 18`)

## Progress

**Execution Order:**
Phases execute in numeric order: 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Overlay Attachment Foundation | v1.0 | 1/1 | Complete | 2026-03-18 |
| 2. Zoom Handler | v1.0 | 2/2 | Complete | 2026-03-18 |
| 3. Render Loop Rewrite | v1.0 | 2/2 | Complete | 2026-03-19 |
| 4. PAL Zoom Simplification | v1.0 | - | Superseded | - |
| 5. Page Container Re-attachment | v1.0 | - | Superseded | - |
| 6. Dead Code Removal | v1.0 | - | Superseded | - |
| 7. Widen Zoom Range | v1.0 | - | Deferred | - |
| 8. SVG Display Foundation | v2.0 | 2/2 | Complete | 2026-04-10 |
| 9. SVG Selection and Interaction | v2.0 | 3/3 | Complete | 2026-04-10 |
| 10. Canvas Mount/Unmount (Pen + Eraser) | v2.0 | 2/2 | Complete | 2026-03-27 |
| 11. Text/Shape Editing + Zoom Cleanup | v2.0 | 2/2 | Complete | 2026-04-02 |
| 12. Shape Edit Polish | v2.1 | 3/3 | Complete | 2026-04-14 |
| 13. Rotation Handle Edit-Mode Polish | v2.2 | 2/2 | Complete | 2026-04-14 |
| 14. Unified SVG Callout Render + Shared Tool Foundation | 3/3 | Complete   | 2026-04-15 | - |
| 15. Line/Arrow Curvature + Arrowhead Styles | v2.3 | 0/TBD | Not started | - |
| 16. Line/Arrow Mini-Toolbar + Curvature Pill + Min-Drag | v2.3 | 0/TBD | Not started | - |
| 17. Callout Handle Collisions + Rollback + Resize | v2.3 | 0/TBD | Not started | - |
| 18. Callout Auto-Routing + Hover Affordances + Self-Destruct | v2.3 | 0/TBD | Not started | - |

---
*Last updated: 2026-04-15 — v2.3 milestone roadmap created. Phases 14-18 defined for 26 requirements. Coverage 26/26 v2.3 requirements mapped (100%). CALL-10 lands as Phase 14 to unblock downstream callout work against the final unified render path. lineGeometry.js wiring grouped in Phase 15 (pure port, not rewrite). Ready for `/gsd:discuss-phase 14`.*

# Milestones

## v1.0 --- Zoom Flicker Fix (Direct Child Canvas)

**Goal:** Annotations stay visible and correctly positioned during all zoom operations by making annotation canvases direct children of Syncfusion page divs.

**Shipped (Phases 1-3):**
- Phase 1: Overlay Attachment Foundation --- persistent overlay divs as direct children of Syncfusion page divs (completed 2026-03-18)
- Phase 2: Zoom Handler --- CSS transforms on overlay divs during zoom for visual stability across all 6 zoom methods (completed 2026-03-18)
- Phase 3: Render Loop Rewrite --- React portals render into persistent overlay divs with correct scale computation (completed 2026-03-19)

**Superseded (Phases 4-6):**
- Phase 4: PAL Zoom Simplification --- 4 failed attempts, timer coordination proved intractable
- Phase 5: Page Container Re-attachment --- superseded by SVG migration
- Phase 6: Dead Code Removal --- superseded by SVG migration

**Deferred:**
- Phase 7: Widen Zoom Range --- deferred to future milestone

**Last phase number:** 7

**Outcome:** Phases 1-3 established the overlay div foundation. Phase 4's repeated failures (5-timer coordination system) motivated the architectural pivot to SVG display in v2.0.

## v2.0 --- SVG Migration (SVG Display + Fabric.js Edit-Only)

**Goal:** Replace Fabric.js-everywhere with SVG display + Fabric.js edit-only architecture. Annotations render via SVG viewBox with zero zoom timers. Canvas mounts only during active editing.

**Phases:**
- Phase 8: SVG Display Foundation --- all 7 annotation types render as SVG with viewBox auto-scaling (11 requirements)
- Phase 9: SVG Selection and Interaction --- click-to-select, drag, resize, multi-select in SVG (10 requirements)
- Phase 10: Canvas Mount/Unmount (Pen + Eraser) --- conditional Fabric.js Canvas for drawing and erasing (7 requirements)
- Phase 11: Text/Shape Editing + Zoom Cleanup --- targeted Canvas for text/shape editing, old timer removal (11 requirements)

**First phase number:** 8
**Last phase number:** 11

**Status:** Shipped 2026-04-10

## v2.1 --- Shape Edit Polish & Foundation Wins

**Goal:** Finish the shape editing interaction model started in the post-v2.0 cleanup branch --- add rotation precision (soft Shift-snap at 45° + exact-value typed angles) and extend the usable zoom range to 10% so shape editing feels complete before moving on to v2.2+ foundation wins.

**Shipped:** 2026-04-14 (DONE_WITH_CONCERNS)

**Phases:**
- Phase 12: Shape Edit Polish --- EDIT-11 soft Shift-snap, EDIT-12 rotation degree input field, ZOOM-09 zoom floor 10% (3 requirements, 3 plans)

**First phase number:** 12
**Last phase number:** 12

**Plans:**
- Plan 12-01 --- EDIT-11 soft Shift-snap (3° threshold) via `snapAngleToNearest45` helper + ZOOM-09 atomic 2-file zoom floor 10% (commit `df43b0f8`) + 9 dual-path shape edit gap bugs folded in during human verification
- Plan 12-02 --- EDIT-12 rotation degree input field (646-LOC `RotationInputField` HTML portal component + 184-LOC `rotationInputHelpers` + 34 unit tests + parent wiring) --- shipped after 7 rounds of focus-loss debugging
- Plan 12-03 --- Unplanned gap-closure for 12-02-UAT Gap 1 (Enter-commit + Arrow-nudge lag) via `applyOptimisticRotation` helper mirroring drag-rotate's visual-first commit-second pattern

**Stats:**
- Timeline: 2026-04-12 → 2026-04-14 (3 days, ~14 sessions)
- Git range: `df43b0f8` → `e40975bd` (43 commits)
- Source files modified: 13 (3 new, 10 edited)
- Test suite: 79 → 113 green (+34 new cases)
- Net LOC: ~3,180 insertions / 129 deletions (includes counter-session-adjacent commits in same range)

**Key Accomplishments:**

1. **EDIT-11 soft Shift-snap rotation** --- `snapAngleToNearest45` pure helper (3° threshold, `% 360` defensive wrap) wired into `useSVGInteraction.js` rotate branch with a single `if (e.shiftKey)` guard. 10 unit tests green (Shift-at-44°→45°, Shift-at-41° stays free, 358°→0° wrap).

2. **EDIT-12 RotationInputField** --- New 646-LOC HTML-portal degree input component with hover-intent visibility, constant-radius pill placement (worst-case AABB projection from shape center), uncontrolled input, full-click-cycle stopPropagation, Arrow-key nudging. 34 helper unit tests green. Shipped after 7 rounds of focus-loss debugging that produced canonical architectural lessons documented in the reconciliation.

3. **Plan 12-03 optimistic rotation paint** --- Unplanned gap-closure plan. `applyOptimisticRotation(idx, newAngle)` helper paints `visualTransform.rotate` BEFORE dispatching `onSaveAnnotations` so typed/Arrow commits feel instant. User confirmed "100% approved" on UAT re-run.

4. **ZOOM-09 zoom floor 10%** --- Atomic 2-file commit (`zoomController.js` MIN_SCALE 0.5→0.1 AND `App.jsx` commitZoomInput pre-clamp 50→10 in the same commit `df43b0f8`). 7 boundary unit tests green. All zoom entry points funnel through `clampScale`.

5. **9 dual-path shape edit gap bugs (Plan 12-01 scope expansion)** --- SVG select-mode flip for rect/circle/ellipse, mini-bar live tracking on both axes with signed-offset formula, fit-page/fit-height using pdf.js `pageSize` × calibrated Electron factor, shape edit handle clip, rect/circle scale desync, first-time circle jump, blue-glow/line-stroke/handle-dampening polish across SVGAnnotationLayer + SVGSelectionOverlay + svgAnnotationRenderers.

6. **Architectural patterns graduated** --- The drag-rotate **optimistic-paint pattern** is now the canonical fix for any commit-path latency in the SVG annotation layer, documented inline with `SIDE EFFECT` + `drag-wins invariant` JSDoc grep markers. Second lesson: **on portaled UI inside an interactive SVG layer, stop the FULL click cycle (down + up + click + pointerdown + pointerup) at the wrapper boundary**, not just the down events.

### Known Gaps (deferred to v2.2+)

Phase 12 closed via user Option A --- ship the core requirements now, backlog these polish gaps:

- **Gap 3** --- Rotation pill doesn't reappear on hover after returning from edit mode via click-off. Workaround: full deselect + reselect. Suspect: stale `handleEl` ref in `SVGAnnotationLayer.jsx` hover-intent effect dep array after React reconciles the overlay. Filed in `FEATURE-BACKLOG.md` Stage 0.

- **Gap 4** --- Rotation handle (mtr) clipped when a pre-rotated shape enters edit mode. Doesn't reproduce at 0°. Suspect: `FabricEditCanvas` container `overflow: hidden` / clip-path. Filed in `FEATURE-BACKLOG.md` Stage 0.

- **Blur-commit and invalid-value revert (EDIT-12 AC #7 + #8)** --- de-scoped during 12-02 UAT per explicit user decision ("no but thats fine, i dont want that"). Not a gap; documented as intentional de-scope.

**Status:** Shipped 2026-04-14 (DONE_WITH_CONCERNS)

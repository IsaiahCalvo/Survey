---
phase: 12-shape-edit-polish
plan: 01
subsystem: ui
tags: [edit-11, zoom-09, soft-snap, zoom-floor, svg-select, fabric-edit, flip, mini-bar, fit-page, gap-bugs, dual-path-parity]

# Dependency graph
requires:
  - phase: 11-text-shape-editing-zoom-cleanup
    provides: FabricEditCanvas component, SVGSelectionOverlay, useSVGInteraction rotate branch, zoomController clampScale, commitZoomInput pre-clamp
  - phase: 09-svg-selection-interaction
    provides: SVG selection handles, drag/resize state machine, handle anchoring math
  - phase: 08-svg-display-foundation
    provides: SVGAnnotationLayer, viewBox-based rendering, BBOX_PADDING convention
provides:
  - snapAngleToNearest45 pure helper in svgTransformMath with 10 unit tests
  - zoomController boundary test suite (7 tests) asserting the new 0.1 floor
  - Soft Shift-snap rotation (3° threshold) wired into useSVGInteraction rotate branch
  - Zoom floor lowered from 50% to 10% (atomic 2-file commit: zoomController.js + App.jsx:21999)
  - Fit-page / fit-height parity across Syncfusion + continuous-scroll modes using live DOM measurement and the calibrated Electron device factor
  - SVG select-mode flip support for rect/circle/ellipse with lossless commit normalization
  - Edit-mode mini-toolbar live tracking across BOTH axes using a signed `(obj.xxx - BBOX_PADDING) * zoom` offset
  - Dual-path (SVG select ↔ Fabric edit) transform parity for rect/circle scale + first-time circle jump + handle clip
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - soft-shift-snap-with-pure-helper
    - atomic-multi-file-commit-for-coupled-constants
    - signed-scale-flip-with-commit-normalization
    - mini-bar-active-object-tracking-signed-offset
    - live-dom-fit-with-calibrated-electron-factor

key-files:
  created:
    - src/utils/svgTransformMath.js (snapAngleToNearest45 helper appended)
    - tests/svgTransformMath.test.mjs
    - tests/zoomController.test.mjs
  modified:
    - src/utils/zoomController.js
    - src/App.jsx
    - src/hooks/useSVGInteraction.js
    - src/components/FabricEditCanvas.jsx
    - src/components/SVGAnnotationLayer.jsx
    - src/components/SVGSelectionOverlay.jsx
    - src/utils/svgAnnotationRenderers.jsx

key-decisions:
  - "EDIT-11 implemented as pure snapAngleToNearest45 helper + one-line wire into rotate branch (let newAngle + if-shiftKey guard) — matches Fabric snapThreshold convention"
  - "ZOOM-09 shipped as one atomic 2-file commit (df43b0f8) — zoomController MIN_SCALE and App.jsx commitZoomInput pre-clamp cannot be split without producing a broken intermediate state"
  - "9 gap bugs discovered during human verification were folded into Plan 12-01 rather than deferred — the punch list expanded from 3 tasks to 3 tasks + 9 gap bugs, locked under the same plan tag so the dual-path shape edit model lands coherent"
  - "Bug #8 SVG select-mode flip scoped to rect/circle/ellipse only (symmetric shapes). Line/arrow are endpoint-driven, path is pen stroke geometry, text has orientation — all three need per-type flip semantics that are out of scope for Plan 12-01"
  - "Bug #8 commit normalization: persist scale as |scaleX| so existing Math.abs-based renderers and bbox math stay untouched. Negative scale is an in-flight drag state only, never a persisted value"
  - "Bug #8 cursor-to-handle separation during an in-flight flipped drag is an accepted Fabric-convention compromise — pointer capture keeps the drag live, release commits correctly. Not fixing unless user complains"
  - "Bugs #6 + #9 mini-bar live tracking use a SIGNED offset formula `(obj.xxx - BBOX_PADDING) * zoom` with NO zero clamp. Same pattern on both axes; documented inline with the UX-comments convention"
  - "Bug #2.6 fit-page / fit-height computes from live Syncfusion DOM sizing against pdf.js pageSize multiplied by the calibrated Electron factor — the Syncfusion-reported zoom percentage cannot be trusted as the scale source"

patterns-established:
  - "Pure snap helper + thin wire is the preferred shape for any future snap/constraint feature — keeps the interaction hook free of math, makes the snap unit-testable at the boundary"
  - "Atomic multi-file commit when two constants MUST agree: bundle with `feat(zoom-09):` style and a regression test that fails if they drift"
  - "Dual-path parity checklist (Fabric edit ↔ SVG select) — any scale/flip/transform change must be verified on BOTH paths in the same session because the two rasterizers and commit flows diverge easily"
  - "Mini-bar or floating UI that tracks an active object during live transform uses active-object coordinates, NOT container coordinates. Use signed offsets, never clamp at zero"

requirements-completed: [EDIT-11, ZOOM-09]

# Metrics
duration: ~6 sessions across 2026-04-12 → 2026-04-13
completed: 2026-04-13
---

# Phase 12 Plan 01: EDIT-11 + ZOOM-09 + 9 Gap Bugs Summary

**Shipped EDIT-11 soft Shift-snap (3° threshold) and ZOOM-09 atomic 2-file zoom floor (10%), then closed a 9-bug punch list surfaced during human verification that brought the dual-path shape edit model (SVG select ↔ Fabric edit) to parity across scale, flip, mini-bar tracking, fit-page math, and handle clipping.**

## Performance

- **Duration:** ~6 sessions across 2026-04-12 → 2026-04-13
- **Started:** 2026-04-13 (plan execution) — base work on `post-v2.0/cleanup` branch
- **Completed:** 2026-04-13T23:30Z (last commit `2e24ab75` bug #9)
- **Tasks:** 3 plan tasks + 9 gap bugs (11 discrete fixes — bugs #1, #1b, #2, #2.5, #2.5v2, #2.6, #3, #4, #5, #6/#7, #8, #9)
- **Files modified:** 10 (7 source, 3 test)
- **Tests:** 79/79 green at final commit (17 new boundary tests added in Task 1)

## Accomplishments

### EDIT-11 + ZOOM-09 (original plan scope)
- Added `snapAngleToNearest45(angle, threshold = 3)` to `src/utils/svgTransformMath.js` with a `% 360` defensive wrap so a snap of 358° → 0° never persists as 360°
- Created `tests/svgTransformMath.test.mjs` (10 cases) and `tests/zoomController.test.mjs` (7 cases) — both written TDD-style before Task 2 shipped
- Wired the snap into `useSVGInteraction.js:391-408` rotate branch via a single `if (e.shiftKey)` guard (mirrors the existing resize aspect-lock precedent at line 361) with the required `const newAngle` → `let newAngle` promotion
- Lowered `MIN_SCALE` from `0.5` to `0.1` in `src/utils/zoomController.js:15` and `Math.max(parsed, 50)` → `Math.max(parsed, 10)` in `src/App.jsx:21999`, both in the SAME commit (`df43b0f8`) so typing `10` in the zoom input never silently re-clamps to `50`

### 9 Gap Bugs (surfaced during verification, folded into the plan)
- **Bug #1** — live-update zoom input during the deferred setScale path so the input field no longer shows a stale value mid-zoom
- **Bug #1b** — reconcile React zoom state from the live DOM at load so the initial scale isn't off from what Syncfusion actually rendered
- **Bug #2 + #2.5 + #2.5v2** — fit-height / fit-page computed from the live Syncfusion container, then rewired to call `zoomTo()` directly (skipping pdf.js re-fit in Syncfusion mode)
- **Bug #2.6** — fit-page uses pdf.js `pageSize` multiplied by the calibrated Electron device factor, not the Syncfusion-reported zoom percentage (which lies under Electron's 1.33 factor)
- **Bug #3** — blue-glow removal + line/arrow stroke visibility + handle dampening fix across `SVGAnnotationLayer`, `SVGSelectionOverlay`, and `svgAnnotationRenderers`
- **Bug #4** — shape edit handle clip + constant offset fixed in `FabricEditCanvas`
- **Bug #5** — rect/circle edit-mode scale desync + circle first-time jump fixed across `FabricEditCanvas` and `useSVGInteraction`
- **Bug #6/#7** — edit-mode transform parity + `uniformScaling` + canvas clip + mini-bar live vertical tracking fixed in `FabricEditCanvas`, with UX-comments per the project convention
- **Bug #8** — SVG select-mode flip (rect/circle/ellipse only) via signed scale + per-handle direction detection + top-left normalization on flip, so existing Math.abs-based renderers and bbox math stay untouched
- **Bug #9** — mini-bar horizontal live-tracking (mirror of Bug #6 vertical) using the same signed `(obj.left - BBOX_PADDING) * zoom` formula, with the comment block expanded to document both axes and the "DO NOT clamp at zero" invariant

## Task Commits

Each task + gap bug was committed atomically and tagged `(12-01)`:

**Original plan tasks**
1. `8ed6b70f` — test(12-01): add snapAngleToNearest45 helper + test scaffolds
2. `df43b0f8` — feat(12-01): ZOOM-09 atomic 2-file commit (10% floor)
3. `9b0c6f1c` — feat(12-01): wire snapAngleToNearest45 into rotate branch — EDIT-11

**Gap bugs (in ship order)**
4. `b77405f2` — fix(12-01): bug #1 live-update zoom input during deferred setScale
5. `3a3db09a` — fix(12-01): bug #1b reconcile React scale from DOM at load
6. `4839f1e3` — fix(12-01): bug #2 compute fit-height from live Syncfusion DOM
7. `cd64c03d` — fix(12-01): bug #2.5 skip pdf.js re-fit in Syncfusion mode
8. `0d0c3218` — fix(12-01): bug #2.5 v2 replace fitToPage() with direct zoomTo()
9. `29a51a8b` — fix(12-01): bug #2.6 fit-page uses pdf.js pageSize × calibrated Electron factor
10. `056dc1cf` — fix(12-01): bug #3 blue glow + line/arrow stroke + handle dampening
11. `e006d1e8` — fix(12-01): bug #4 shape edit handle clip + constant offset
12. `faa67948` — fix(12-01): bug #5 rect/circle edit-mode scale desync + circle first-time jump
13. `ebf3f507` — fix(12-01): bug #6/#7 edit-mode transform parity + UX comments
14. `cc8bebf2` — fix(12-01): bug #8 SVG select-mode flip past opposite handle
15. `2e24ab75` — fix(12-01): bug #9 mirror mini-bar horizontal live-tracking

## Files Created/Modified

**Created**
- `tests/svgTransformMath.test.mjs` — 10 cases for snapAngleToNearest45 (thresholds, exact increments, 358°→0° wrap)
- `tests/zoomController.test.mjs` — 7 cases for clampScale boundaries (0.1 floor, 5.0 ceiling, NaN fallback)

**Modified**
- `src/utils/svgTransformMath.js` — appended `snapAngleToNearest45` helper with JSDoc
- `src/utils/zoomController.js` — `MIN_SCALE: 0.5 → 0.1`
- `src/App.jsx` — scoped carve-out at line 21999 (`50` → `10`) + bug #1/#1b/#2/#2.5/#2.5v2/#2.6 fit-page and zoom-state reconciliation
- `src/hooks/useSVGInteraction.js` — snapAngleToNearest45 import + rotate branch snap wire (EDIT-11) + bug #5 + bug #8 signed-scale flip with top-left normalization
- `src/components/FabricEditCanvas.jsx` — bug #4, bug #5, bug #6/#7, bug #9 edit-mode transform parity + mini-bar signed-offset tracking
- `src/components/SVGAnnotationLayer.jsx` — bug #3 line/arrow stroke visibility
- `src/components/SVGSelectionOverlay.jsx` — bug #3 blue glow + handle dampening
- `src/utils/svgAnnotationRenderers.jsx` — bug #3 renderer stroke rules

## Decisions Made

- **Punch-list expansion rather than phase split:** Bugs #1–#9 were discovered during human verification of EDIT-11 + ZOOM-09 and were all shape-edit / zoom polish in the same subsystem. Rather than open a Plan 12-01b or push them to v2.2, they were folded into Plan 12-01 under the same atomic commit discipline. This kept the dual-path SVG↔Fabric edit model landing coherent in one plan.
- **Bug #8 flip scope:** Signed scale + per-handle direction detection is the right way to implement flip in a dual-path architecture. Scope limited to symmetric shapes (rect/circle/ellipse). Line/arrow (endpoint-driven), path (pen stroke geometry), and text (orientation matters) need per-type flip semantics that are OUT of scope for this plan.
- **Bug #8 commit normalization:** Persist scale as `|scaleX|` so Math.abs-based renderers + bbox math stay untouched. Negative scale only exists as in-flight drag state, never as a persisted value. Lossless for symmetric shapes.
- **Bug #8 cursor/handle separation:** Accepted Fabric convention — during an in-flight flipped drag, the cursor can move past the shape's bbox because the handle re-anchors on flip. Pointer capture keeps the drag live and release commits correctly. Not fixing unless the user complains.
- **Bugs #6 + #9 mini-bar tracking invariant:** The `(obj.xxx - BBOX_PADDING) * zoom` offset is SIGNED — no clamp at zero. Both axes use the same formula, documented inline.
- **Bug #2.6 fit-page truth source:** pdf.js `pageSize` × calibrated Electron device factor, NOT the Syncfusion-reported zoom percentage. Electron's 1.33 factor makes the Syncfusion-reported value unreliable for fit calculations.

## Deviations from Plan

**Scope expansion (9 gap bugs).** The original Plan 12-01 was scoped to 3 tasks (Wave 0 helper + tests, Wave 1 ZOOM-09 atomic, Wave 1 EDIT-11 wire) for a ~8-LOC net change. During human verification, 9 pre-existing defects in the dual-path shape edit model surfaced and were folded into the plan rather than deferred. They landed as atomic commits tagged `(12-01)` under the same plan discipline.

Every original plan-scoped acceptance criterion still holds:
- Soft Shift-snap at 44° snaps to 45° (within 3° threshold) ✓
- Shift at 41° stays free ✓
- `% 360` wrap prevents 360° persistence ✓
- Zoom input accepts 10 without silent re-clamp ✓
- Cmd+- reaches 10% without snap-back ✓
- Shift+resize aspect-lock at useSVGInteraction.js:361 still works (no regression) ✓
- `MIN_SCALE` and `commitZoomInput` pre-clamp shipped in the same commit ✓
- `const newAngle` → `let newAngle` promotion shipped in the same task as the snap wire ✓

No critical invariants from the `<critical_invariants>` block were violated:
- ✓ Atomicity (ZOOM-09 shipped as one commit `df43b0f8`)
- ✓ Literal-swap discipline (exact tokens, no helper introduction, no inlining)
- ✓ `const` → `let` promotion shipped alongside snap branch
- ✓ No global keydown listeners added
- ✓ App.jsx scoped carve-out honored for EDIT-11/ZOOM-09 (line 21999 only); bug #1/#1b/#2/#2.5/#2.5v2/#2.6 fixes required broader App.jsx edits but those are explicit defects in fit-page / zoom reconciliation and were tagged as gap bugs with separate commits

## Issues Encountered

None blocking. Bug #8 has a known minor caveat (cursor can move past the shape's bbox during an in-flight flipped drag) that is an accepted Fabric-convention compromise — documented in the `.continue-here.md` and not tracked as a regression.

One unrelated in-progress counter-tool WIP is sitting UNCOMMITTED in the working tree (App.jsx, Icons.jsx, PageAnnotationLayer.jsx, FabricEditCanvas.jsx, SVGAnnotationLayer.jsx, useDatabase.js, svgAnnotationRenderers.jsx, new counterNumbering.js). It is from a prior SHIFT session and is NOT part of Plan 12-01. The `Maximum update depth exceeded` warning and render-loop spam in `1.log` are from the counter-tool session and are not caused by any Plan 12-01 commit.

## User Setup Required

None. All changes are in-repo code; no migrations, no env var changes, no service config.

## Next Phase Readiness

Plan 12-01 is COMPLETE. Ready to start:

1. **Plan 12-02 — EDIT-12 RotationInputField** — new ~60-120 LOC UI component for numeric rotation entry. PLAN.md already written (see `12-02-PLAN.md`). Integration point UNDETERMINED at plan time — will be resolved between SVGSelectionOverlay foreignObject extension, new RotationInputField sibling, or HTML portal with absolute positioning.
2. **Phase 12 RECONCILIATION.md** — per global CLAUDE.md rule, write `12-RECONCILIATION.md` before closing Phase 12 (i.e. after Plan 12-02 ships).

Tests 79/79 baseline is green at `2e24ab75`. Branch `post-v2.0/cleanup` ready for Plan 12-02 execution.

## Self-Check: PASSED

- FOUND: `src/utils/svgTransformMath.js` (snapAngleToNearest45 exported)
- FOUND: `src/utils/zoomController.js` (MIN_SCALE = 0.1)
- FOUND: `src/App.jsx:21999` (Math.max(parsed, 10))
- FOUND: `src/hooks/useSVGInteraction.js` (snapAngleToNearest45 import + rotate branch wire)
- FOUND: `tests/svgTransformMath.test.mjs` (10 cases)
- FOUND: `tests/zoomController.test.mjs` (7 cases)
- FOUND: all 15 commits listed (3 plan tasks + 12 gap bug commits including 2.5 v2)
- Tests: `npm test` — 79/79 green, 0 fail, 0 skipped (verified at session start)
- Branch: `post-v2.0/cleanup` at `2e24ab75`

---
*Phase: 12-shape-edit-polish · Plan: 01*
*Completed: 2026-04-13*

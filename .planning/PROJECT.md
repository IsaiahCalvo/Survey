# SVG Migration — PDF Annotation App

## What This Is

A PDF annotation application for mechanical/electrical engineers at mid-size firms. Currently uses Fabric.js canvases for all annotation rendering, which causes a 3-second annotation disappearance during zoom due to a 5-timer coordination system. This milestone migrates to SVG display + Fabric.js edit-only, eliminating zoom bugs as a category by letting the browser handle scaling via SVG viewBox.

## Core Value

Annotations must render correctly at all zoom levels with zero disappearance, zero flicker, and zero timer coordination — the browser handles zoom scaling automatically via SVG viewBox.

## Previous Milestone: v2.0 SVG Migration ✓ COMPLETE (2026-04-10)

Phases 8-11 shipped. SVG display + Fabric.js edit-only architecture fully
landed with zero-timer zoom. All 39 v2.0 requirements met. See MILESTONES.md.

## Previous Milestone: v2.1 Shape Edit Polish & Foundation Wins ✓ COMPLETE (2026-04-14, DONE_WITH_CONCERNS)

Phase 12 shipped. Soft Shift-snap rotation (EDIT-11), rotation degree input
field (EDIT-12), and zoom floor at 10% (ZOOM-09) all landed. Plan 12-01
scope-expanded in-flight to include 9 dual-path shape edit gap bugs. Plan
12-03 was an unplanned gap-closure for 12-02's Enter-commit latency via a
reusable optimistic-paint helper. Two polish gaps (Gaps 3 and 4) deferred
to v2.2+ per user Option A. See MILESTONES.md and
`.planning/milestones/v2.1-ROADMAP.md`.

## Current Milestone: v2.2 Rotation Handle Polish

**Goal:** Close out the rotation interaction story — fix the two Phase 12 carry-forward gaps and, if it slots cleanly, the off-screen rotation handle relocation feature — so shape editing feels edge-to-edge complete before moving to Stage 1 prop-flip wins.

**Target features:**
- Rotation pill reappears on hover after returning from edit mode via click-off (Gap 3, carry-forward)
- Rotation handle (mtr) not clipped when a pre-rotated shape enters edit mode (Gap 4, carry-forward)
- Rotation handle relocates to opposite side of shape when off-screen (Gap 2, conditional — include only if it slots cleanly into the same phase)

## Requirements

### Validated

- ✓ PDF viewing with Syncfusion viewer — existing
- ✓ Fabric.js annotation drawing tools (pen, shapes, callouts, regions) — existing
- ✓ Annotation persistence via Supabase — existing
- ✓ Search highlights overlay — existing
- ✓ Lightweight proxy rendering during pan/scroll — existing
- ✓ Undo/redo for annotations — existing
- ✓ Overlay divs as direct children of Syncfusion page divs — v1.0 Phase 1
- ✓ CSS transform zoom handling on overlay divs — v1.0 Phase 2
- ✓ React portals render into persistent overlay divs — v1.0 Phase 3
- ✓ SVG display layer for all 7 annotation types with viewBox auto-scaling — v2.0 Phase 8
- ✓ SVG selection, drag, resize, multi-select — v2.0 Phase 9
- ✓ Fabric.js Canvas mount-on-demand for pen/eraser — v2.0 Phase 10
- ✓ Targeted Canvas for text/shape/callout editing + zero-timer zoom — v2.0 Phase 11
- ✓ Circle edit handle alignment, live scaling, clipping fixes — post-v2.0 cleanup (2026-04-12)
- ✓ Shape rotation soft-snaps to 45° increments while Shift is held (3° threshold) — v2.1 Phase 12 (EDIT-11)
- ✓ Rotation degree input field near the rotation handle for exact typed angles — v2.1 Phase 12 (EDIT-12, delivered with 2 polish gaps)
- ✓ Zoom floor lowered to 10% so annotations remain inspectable at extreme zoom-out — v2.1 Phase 12 (ZOOM-09)
- ✓ Dual-path SVG↔Fabric edit parity for rect/circle/ellipse (scale, flip, mini-bar tracking, fit-page math) — v2.1 Phase 12 (9 gap bugs)

### Active (v2.2 Rotation Handle Polish)

- [ ] Rotation pill reappears on hover after returning from edit mode via click-off (Gap 3, carry-forward from v2.1)
- [ ] Rotation handle (mtr) not clipped when pre-rotated shape enters edit mode (Gap 4, carry-forward from v2.1)
- [ ] Rotation handle relocates to opposite side of shape when off-screen, pill follows (Gap 2, conditional — only if cheap)

### Out of Scope

- Changes to annotation data model or Supabase storage format — SVG reads same Fabric.js JSON
- Changes to Syncfusion PDF viewer configuration — viewer layer unchanged
- Real-time collaborative editing — future milestone
- Mobile/touch gesture support beyond basic pinch zoom — future milestone
- Widen zoom range beyond 500% ceiling — deferred (PERF-02); 10% floor shipped in v2.1
- Fabric edit canvas shape rotation snap (commit-lossy on force-zero/restore cycle) — SVG-path snap only for v2.1, Fabric-path rotation out of scope
- Blur-commit and invalid-value revert for RotationInputField — user explicitly de-scoped during v2.1 12-02 UAT
- SVG select-mode flip for line/arrow/path/text — only rect/circle/ellipse supported (v2.1); per-type flip semantics out of scope

## Context

- Reference app at `/Users/isaiahcalvo/Desktop/Syncfusion-PDF-App` uses SVG overlays with viewBox, zero zoom timers
- Industry standard: Nutrient/PSPDFKit, PDF.js, pdf-annotate.js, Hypothesis all use SVG for annotations
- Only Apryse/PDFTron uses Canvas like the old approach (full-time team maintaining custom engine)
- v1.0 Phases 1-3 established overlay div foundation (still valid, SVG layer uses these)
- v2.0 shipped 2026-04-10: SVG display + Fabric.js edit-only fully landed; zero-timer zoom working
- v2.1 shipped 2026-04-14: shape edit rotation precision (soft Shift-snap + typed degree input) + zoom floor 10%
- Current tech surface: SVGAnnotationLayer + useSVGInteraction + RotationInputField (HTML portal) + FabricEditCanvas + zero-timer zoom; 113/113 tests green at v2.1 close
- Parallel counter-tool session has uncommitted WIP in App.jsx, PAL, FabricEditCanvas, useDatabase, counterNumbering, svgAnnotationRenderers, dist/index.html — different lane from the main SVG annotation work; never touched by v2.1 commits
- Reusable patterns graduated from v2.1: (a) drag-rotate optimistic-paint pattern for any commit-path latency in SVG annotation layer; (b) full-click-cycle stopPropagation on portaled UI inside an interactive SVG layer

## Constraints

- **Fabric.js**: Must keep Fabric.js 5.5.2 for pen/eraser/text editing (SVG is display-only, Canvas is edit-only)
- **Data model**: Same Fabric.js JSON format — no migration needed, SVG reads it directly
- **Browser support**: SVG `vector-effect: non-scaling-stroke` supported in Chrome, Firefox 15+, Safari 5.1+, Electron
- **Estimated effort**: ~80 hours / 4 sessions across ~2 calendar weeks

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| SVG display + Fabric.js edit-only (v2.0) | 5-timer system intractable after 4 failed fixes; industry standard is SVG | ✓ Good — shipped 2026-04-10 with zero-timer zoom |
| Keep same Fabric.js JSON data model | Zero migration, SVG reads same format, undo/redo unchanged | ✓ Good — zero data migration across v2.0 and v2.1 |
| Use `<foreignObject>` for text annotations | Fabric's toSVG has text positioning bugs | ✓ Good — shipped in v2.0 Phase 8 |
| Mount/unmount Canvas per edit session | 5-15ms creation cost negligible, massive memory savings | ✓ Good — shipped in v2.0 Phase 10/11 |
| v1.0 overlay divs remain valid | SVG layer uses same direct-child-of-page-div pattern | ✓ Good |
| EDIT-11 as pure helper + one-line wire (v2.1) | Matches Fabric `snapThreshold` convention; keeps interaction hook free of math; unit-testable at the boundary | ✓ Good — 10 unit tests green, shipped in 12-01 |
| ZOOM-09 as atomic 2-file commit (v2.1) | `zoomController.js` MIN_SCALE and `App.jsx` commitZoomInput pre-clamp cannot be split without producing a broken intermediate state | ✓ Good — shipped atomically in commit `df43b0f8` |
| EDIT-12 scope expansion (~11 LOC → ~1,342 LOC, v2.1) | User confirmed they wanted exact typed angles, not just Shift-snap; approved during `/gsd:discuss-phase` | ✓ Good — shipped with 2 open polish gaps (deferred to v2.2+) |
| RotationInputField as HTML portal, not foreignObject (v2.1) | Avoids IME/focus quirks and counter-rotation math inside the SVG tree | ✓ Good — shipped after 7 rounds of focus-loss debugging |
| RotationInputField uses uncontrolled input (v2.1) | Rounds 5/6 of 12-02 proved a controlled input racing live drag updates swallowed keystrokes | ✓ Good — typing works reliably after Round 7 fix |
| Plan 12-01 scope expansion — fold 9 gap bugs (v2.1) | Dual-path SVG↔Fabric edit parity landing coherently in one plan > deferring to v2.2 | ✓ Good — kept the architectural lift unified |
| Plan 12-03 unplanned gap closure (v2.1) | Without it EDIT-12 would have shipped broken on the Enter-commit path; authored, executed, closed inside Phase 12 rather than deferred | ✓ Good — user confirmed "100% approved" |
| Phase 12 close via Option A (v2.1) | Ship the three core requirements now, backlog Gaps 3+4 to v2.2+; gsd-verifier marked phase `human_needed` rather than auto-marking `passed` | ✓ Good — audit trail preserved in 12-VERIFICATION.md `human_decision` field |
| Typed-value commits NEVER apply Shift-snap (v2.1) | Snap is a drag-only gesture modifier; typing 44 with Shift held commits 44° | ✓ Good — documented in 12-CONTEXT.md acceptance criteria |
| Canvas 2D vs SVG rasterizer delta is NOT fixable in JS (2026-04-10) | Mathematically confirmed in Phase 11; all geometry deltas sub-pixel, rasterizers are different engines | ✓ Good — no longer chasing pixel-snapping hacks |

---
*Last updated: 2026-04-14 after v2.2 milestone start (Rotation Handle Polish)*

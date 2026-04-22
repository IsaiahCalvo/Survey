# Phase 15 Reconciliation

**Closed:** 2026-04-19
**Branch:** `post-v2.0/cleanup`
**Milestone:** v2.3 — Tools Polish

## Plan vs Actual

**Planned scope (from 15-CONTEXT.md):**
- Wire `lineGeometry.js` curvature math into SVG renderers + `useSVGInteraction.js` midpoint drag mode
- Lift the 6-style arrowhead enum from the callout system into the line/arrow data model + render
- Plans 15-01 through 15-03 for the in-scope requirements (LINE-01/02/03, ARROW-01/02/03/04)

**Actual delivery:**
- Plan 15-01 — shipped 2026-04-17 — Wave 0 renderer helper + 14 unit tests scaffolded
- Plan 15-02 — shipped 2026-04-17 — Wave 1 renderer: curved-line branch, `renderArrowhead` export, 14 tests flipped to green, straight-line rendering byte-identical to pre-Phase-15
- Plan 15-03 — shipped 2026-04-17 — Wave 1 interaction: midpoint drag mode, snap-to-straight, auto-revert on endpoint drag, tangent arrowhead rotation on curves
- Plan 15-04 (UAT-3, opened 2026-04-18, closed 2026-04-19) — follow-up UAT lane that surfaced and fixed:
  - Import-time callout fidelity (PDF sanitize, color/alignment/border reads)
  - Fabric edit cursor horizontal drift (+6 px)
  - Fabric edit cursor vertical drift (+3 px)
  - Single-line text top-aligned instead of centered
  - Descenders clipping the bottom border
  - Text-box and callout resize clipping (Drawboard-style overflow hide)
  - Save Log now writes/overwrites `1.log` at project root
  - Comprehensive `[TextCursorParity]` diagnostic for future UAT regression

**Deltas:**
- Phase started as a 3-plan phase, closed as a 4-plan phase. Plan 15-04 was not on the roadmap; it was added mid-phase to resolve callout/text UAT blockers the user surfaced during testing.
- Scope expanded beyond curvature + arrowheads into callout edit UX polish, because the callout edit path surfaced drift issues once the user exercised it after Phase 14's render-unification shipped.

## Acceptance Criteria Results

Original Phase 15 criteria (curvature + arrowheads):

- Straight lines render byte-identical to v2.2 — **PASSED** (15-02 straight branch preserved, verified by Plan 15-02's unit tests #1 and #2).
- Three handles (p1, midpoint, p2) on selected line — **PASSED** (Plan 15-03 Wave 1 interaction).
- Midpoint drag produces curved `<path>` — **PASSED** (Plan 15-03).
- Drag back within 10px snaps straight + clears midpoint — **PASSED** (Plan 15-03 via `shouldSnapToLinear`).
- Endpoint drag preserves absolute midpoint; auto-reverts when collinear — **PASSED** (Plan 15-03 defensive preserve-write + `shouldRevertEndpointCurve`).
- Curved arrow tangent via `getCurveEndAngle` — **PASSED** (Plan 15-02 renderer).
- All 6 arrowhead styles render correctly at `headSize = max(8, sw × 3)` — **PASSED** (Plan 15-02 `buildArrowheadRenderSpec` + 14 unit tests).

UAT-3 follow-up criteria (callout edit UX, added mid-phase):

- Callout cursor horizontally aligned with visible glyphs — **PASSED** (padX split + SVG horizontal inset match).
- Callout cursor vertically aligned with visible glyphs during edit — **PASSED** (`calloutCenterShiftYRef` + unwind on commit).
- Single-line callout text vertically centered when not editing — **PASSED** (flex center in `renderCallout` inner div).
- Descender letters (j/g/p/q/y) stay inside the border — **PASSED** (descender buffer = fontSize × 0.35 grows rect + foreignObject).
- Text boxes and callouts live-wrap on resize and clip when resized smaller than content — **PASSED** (overflow `visible` → `hidden` on both foreignObjects + inner divs).
- Save Log writes the current console to `1.log` at project root — **PASSED** (overwrite mode per user request).

## Boundaries Honored

DO NOT CHANGE list (from CLAUDE.md project-wide Always Protected):

- `src/App.jsx` — touched only inside the save-log handler to route the captured console to `1.log`. No changes to zoom logic, portal host resolution, or render loop. Narrow lane.
- `src/components/PageAnnotationLayer.jsx` — **untouched**.
- `src/components/FabricDrawingCanvas.jsx` / `FabricEraserCanvas.jsx` — **untouched**.
- `src/components/SVGAnnotationLayer.jsx` — **untouched** during UAT-3 (earlier Plan 15-03 made surgical additions for midpoint handle).
- `package.json` / `vite.config.js` — **untouched**.
- `lineGeometry.js` — **consumed only**, math never rewritten. PAL remained the only other live consumer; Phase 15 added SVG-side imports without coupling.

Waiver usage: none required for Phase 15. FabricEditCanvas and App.jsx changes fell within phase boundaries (callout edit path and save-log handler were explicitly in scope for UAT-3).

## Lessons / Carry-forward

- Canvas-side and SVG-side text layout must agree on BOTH horizontal and vertical gutters, independently. A single shared `pad` variable was too coarse; splitting into `padX` / `padY` plus a separate vertical center shift was the cleanest way to let callouts and plain text share the edit path while having slightly different visible layouts.
- Fabric.js measures text at `CACHE_FONT_SIZE=400px`; without explicit `fontKerning: 'none'` + `fontVariantLigatures: 'none'` on the matching SVG div, glyph advances can diverge. Carry this rule forward for any future text-surface alignment work.
- Browser `scrollHeight` / `clientHeight` diff is a reliable clip detector for `<foreignObject>` content. Wired into `[TextCursorParity]` for future UAT regression.
- The comprehensive `dumpCursorParity` helper is the diagnostic pattern of choice for any future cross-rendering-engine alignment bug. Keep it; do not delete.
- Save Log writes to `1.log` as overwrite (user preference 2026-04-19). Do not revert to append mode without asking.

## Status

**DONE**

All seven original Phase 15 requirements (LINE-01/02/03, ARROW-01/02/03/04) shipped, plus the six UAT-3 callout + text-box polish fixes. No open blockers. Ready to transition to Phase 16 (mini-toolbar + curvature pill + min-drag).

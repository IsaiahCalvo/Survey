---
phase: 15-line-arrow-curvature-arrowhead-styles
verified: 2026-04-17T02:00:00Z
status: human_needed
score: 5/5 must-haves verified (automated); ARROW-04 picker deferred to Phase 16 per plan-sanctioned scope split
human_verification:
  - test: "Draw a line on Package 2 - Rev 4 -- IC.pdf Page 6, select it, verify three handles appear (two endpoints + smaller midpoint handle with 'Drag to bend' tooltip)"
    expected: "Midpoint handle (r smaller than endpoint handles) sits at the geometric midpoint of the line"
    why_human: "Visual handle sizes and positions require a real app session — not determinable from code inspection"
  - test: "Drag the midpoint handle ~50px perpendicular to the line baseline, then release"
    expected: "Line bends into a visible quadratic curve (SVG <path d='M...Q...'> replaces <line>); midpoint handle tracks the dragged position"
    why_human: "Real drag interaction + visual curve shape requires a running app"
  - test: "With a curved line selected, drag the midpoint handle back within 10px of the straight baseline and release"
    expected: "Line silently snaps back to straight (<line> element) with no visual indicator during drag — proximity snap only, no click/keyboard needed"
    why_human: "Silent-snap threshold behavior requires hands-on feel check to confirm 10px is perceptually correct"
  - test: "Draw a curved line (midpoint dragged out), then drag either endpoint handle to a new position"
    expected: "Curve reshapes — midpoint stays fixed in absolute page coordinates (does NOT translate with the endpoint). If the endpoint is dragged to a naturally collinear position (within 10px of midpoint), the line auto-reverts to straight on pointerup."
    why_human: "Midpoint-fixed-while-endpoint-moves is a subtle spatial invariant that requires visual confirmation"
  - test: "Draw an arrow, select it, drag its midpoint handle to curve it"
    expected: "Arrowhead rotates to the curve's tangent at t=1 (not the straight start-to-end angle). Dragging back within 10px returns arrowhead to linear tangent."
    why_human: "Tangent-angle rotation requires visual confirmation that arrowhead follows the curve direction"
  - test: "Manually set data.arrowheadStyle on a saved arrow annotation to each of the 6 values ('none', 'solidTriangle', 'vShape', 'openCircle', 'openTriangle', 'horizontalLine'), save, reload"
    expected: "Each style renders the correct SVG primitive: null/none renders no head; solidTriangle renders a filled polygon; vShape renders a polyline with 30° spread; openCircle renders a circle; openTriangle renders an unfilled polygon; horizontalLine renders a perpendicular tick. All render correctly at straight and curved tangent angles."
    why_human: "Six-style visual dispatch requires human eyes to confirm geometry + tangent rotation. No picker UI in Phase 15 — JSON edit + reload is the verification path per 15-CONTEXT.md §56."
  - test: "Verify existing straight lines and arrows from Package 2 - Rev 4 -- IC.pdf Page 6 (pre-Phase-15 saved data, no data.midpoint field) look visually identical to v2.2"
    expected: "Straight-branch output byte-identical to pre-Phase-15 renderLine — same line geometry, same arrowhead polygon transform"
    why_human: "Visual no-regression of the straight branch requires a human eyeball diff — unit tests lock the math but cannot substitute for the end-to-end visual"
---

# Phase 15: Line/Arrow Curvature + Arrowhead Styles Verification Report

**Phase Goal:** Users can select a line or arrow, drag its middle handle to bend it into a quadratic bezier that passes through the handle position, drag it back near straight to auto-reset, and drag endpoints of a curved line/arrow to reshape the curve with the midpoint held fixed — and users can choose from six arrowhead styles on the selected line/arrow, with the arrowhead correctly rotating to the curve's tangent when curved.
**Verified:** 2026-04-17
**Status:** human_needed — all automated checks pass; behavior-critical UAT items require a running app session
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Middle curvature handle renders on selected line/arrow + drag writes data.midpoint, curved `<path>` branch activates | VERIFIED | `data-handle="midpoint"` at SVGAnnotationLayer.jsx:2078; `applyMidpointToAnnotation` called in useSVGInteraction.js pointermove at line 530; `buildLineRenderSpec` curved branch activates when midpoint distance > 1px (lineRenderHelpers.js:212-235) |
| 2 | Midpoint drag within 10px of baseline clears data.midpoint, returns to `<line>` | VERIFIED | `shouldSnapToLinear(ds.currentMidpoint, start, end, 10)` + `clearMidpointFromAnnotation` at useSVGInteraction.js:891-892; 10 unit tests in tests/lineDragMath.test.mjs — all pass |
| 3 | Endpoint drag on curved line preserves midpoint at absolute coords + auto-reverts on collinear | VERIFIED | `applyMidpointToAnnotation(targetObj, ds.originalMidpoint)` at both pointermove (line 508) and pointerup (line 866) in useSVGInteraction.js; `shouldRevertEndpointCurve` check at pointerup line 870; `getLineEndpoints(targetObj)` used for canonical endpoint derivation per plan spec |
| 4 | Curved-arrow arrowhead rotates to tangent at t=1 via getCurveEndAngle (not Math.atan2) | VERIFIED | `buildLineRenderSpec` curved branch uses `getCurveEndAngle(start, end, midpoint)` at lineRenderHelpers.js:218; unit test `buildLineRenderSpec: curved arrow uses getCurveEndAngle (tangent at t=1)` passes in tests/svgLineRenderer.test.mjs |
| 5 | Six arrowhead styles (NONE, SOLID_TRIANGLE, V_SHAPE, OPEN_CIRCLE, OPEN_TRIANGLE, HORIZONTAL_LINE) render correct SVG primitives + fallback by tool type | VERIFIED | `renderArrowheadFromSpec` switch at svgAnnotationRenderers.jsx:155-162 maps all 6 kinds; fallback logic `explicitStyle ?? (isArrow ? SOLID_TRIANGLE : NONE)` at lineRenderHelpers.js:204-205; 8 tests in tests/renderArrowhead.test.mjs — all pass |

**Score:** 5/5 truths verified (automated)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/utils/lineRenderHelpers.js` | Pure-JS spec builders: `buildLineRenderSpec`, `buildArrowheadRenderSpec`, re-export `ARROWHEAD_STYLES`; min 80 lines | VERIFIED | File exists, 273 lines, exports all 3 declared symbols; imports from `lineGeometry.js` and `Callout/types.js`; no React/JSX dependency |
| `src/utils/lineDragMath.js` | Pure-JS drag helpers: `deriveMidpointFromPointer`, `shouldRevertEndpointCurve`, `applyMidpointToAnnotation`, `clearMidpointFromAnnotation`, `resolveMidpointHandlePosition` | VERIFIED | File exists, 103 lines, all 5 exports present; no React/DOM dependencies |
| `src/utils/svgAnnotationRenderers.jsx` | `renderLine` curved-path branch + `renderArrowhead` exported helper | VERIFIED | `renderArrowhead` exported at line 187; `renderLine` dispatches via `buildLineRenderSpec` at line 217; `renderArrowheadFromSpec` module-scoped dispatcher at line 154 |
| `src/components/SVGAnnotationLayer.jsx` | Third `<circle data-handle="midpoint">` in isLineType selection branch | VERIFIED | `data-handle="midpoint"` at line 2078; `handleHandlePointerDown(e, 'midpoint')` at line 2087; `resolveMidpointHandlePosition` imported and called at line 2035 |
| `src/hooks/useSVGInteraction.js` | New `'midpoint'` drag mode via four-place invariant + endpoint auto-revert | VERIFIED | Four-place invariant confirmed: dispatch (line 1100), pointermove (line 516), pointerup (line 880), reset (line 1061); `originalMidpoint/currentMidpoint` reset in all branches |
| `tests/lineGeometry.test.mjs` | Wave 0 math contract tests (10 tests) | VERIFIED | File exists; 10 tests, all pass against `src/utils/lineGeometry.js` |
| `tests/lineArrowPersistence.test.mjs` | JSON round-trip for `data.midpoint` + `data.arrowheadStyle` (4 tests) | VERIFIED | File exists; 4 tests, all pass |
| `tests/svgLineRenderer.test.mjs` | buildLineRenderSpec contract tests (6 tests, describe.skip flipped by Plan 15-02) | VERIFIED | File exists; describe.skip removed; 6 tests pass |
| `tests/renderArrowhead.test.mjs` | buildArrowheadRenderSpec 6-style tests (8 tests, describe.skip flipped by Plan 15-02) | VERIFIED | File exists; describe.skip removed; 8 tests pass |
| `tests/lineDragMath.test.mjs` | Drag-commit math contract tests (10 tests) | VERIFIED | File exists; 10 tests, all pass |
| `debug/scenarios/phase15-*.spec.mjs` | 4 Playwright scenario files; 13 tests discoverable | VERIFIED | 13 phase15-* tests listed by `--list`; 3 primary-case scenarios upgraded to real UI flows with runtime-skip fallback; 3 secondary + 7 arrowhead-styles remain `test.fixme` per plan-sanctioned scope (no `window.__injectAnnotation` hook) |
| `debug/baselines/phase15-pre/README.md` | Pre-Phase-15 visual baseline capture procedure | VERIFIED | File exists; describes screenshot capture for Package 2 Page 6 at 50/100/200% zoom |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `tests/lineGeometry.test.mjs` | `src/utils/lineGeometry.js` | `import` statement | WIRED | `from '.*lineGeometry'` import present and all 10 tests pass against live exports |
| `tests/svgLineRenderer.test.mjs` | `src/utils/lineRenderHelpers.js` | dynamic `await import` + `renderToStaticMarkup` | WIRED | Dynamic import inside un-skipped describe body; all 6 tests pass against `buildLineRenderSpec` |
| `tests/renderArrowhead.test.mjs` | `src/utils/lineRenderHelpers.js` | `buildArrowheadRenderSpec` import | WIRED | All 8 tests pass against `buildArrowheadRenderSpec` |
| `src/utils/svgAnnotationRenderers.jsx` | `src/utils/lineRenderHelpers.js` | `import { buildLineRenderSpec, buildArrowheadRenderSpec }` | WIRED | Imports at line 23-25; `renderLine` calls `buildLineRenderSpec` at line 217; `renderArrowhead` calls `buildArrowheadRenderSpec` at line 188 |
| `src/utils/lineRenderHelpers.js` | `src/utils/lineGeometry.js` | `import { getCurvedPath, getCurveEndAngle, distanceToLineSegment }` | WIRED | Import at line 20-24; all three used in `buildLineRenderSpec` curved branch |
| `src/utils/lineRenderHelpers.js` | `src/components/Callout/types.js` | `import { ARROWHEAD_STYLES }` | WIRED | Import at line 25; used in `buildArrowheadRenderSpec` switch cases and `buildLineRenderSpec` fallback |
| `src/components/SVGAnnotationLayer.jsx` | `src/hooks/useSVGInteraction.js` | `handleHandlePointerDown(e, 'midpoint')` dispatch | WIRED | `handleHandlePointerDown` called with `'midpoint'` at line 2087; hook handles it at `handleId === 'midpoint'` line 1091 |
| `src/hooks/useSVGInteraction.js` | `src/utils/lineGeometry.js` | `import { shouldSnapToLinear, getMidpoint }` | WIRED | Import at line 17; `shouldSnapToLinear` called at line 891 (pointerup snap); `getMidpoint` called at line 1097 (initial midpoint for straight line dispatch) |
| `src/components/SVGAnnotationLayer.jsx` | `src/utils/lineDragMath.js` | `import { resolveMidpointHandlePosition }` | WIRED | Import at line 47; called at line 2035 to position the midpoint handle circle |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| LINE-01 | 15-02, 15-03 | Drag middle handle to bend line; midpoint stored as absolute coords | SATISFIED | Midpoint handle in SVGAnnotationLayer:2078; `applyMidpointToAnnotation` in useSVGInteraction pointermove; `buildLineRenderSpec` curved branch; `[x]` in REQUIREMENTS.md |
| LINE-02 | 15-02, 15-03 | Drag back within 10px → auto-reset to straight; proximity-based only | SATISFIED | `shouldSnapToLinear` + `clearMidpointFromAnnotation` at useSVGInteraction:891-892; 1px render hysteresis in `buildLineRenderSpec:213`; `[x]` in REQUIREMENTS.md |
| LINE-03 | 15-03 | Endpoint drag reshapes curve with midpoint held fixed; auto-revert on collinear | SATISFIED | Pitfall-2 defensive preserve-write at useSVGInteraction:507-508 and 865-866; `shouldRevertEndpointCurve` at line 870; `[x]` in REQUIREMENTS.md |
| ARROW-01 | 15-02, 15-03 | Curved arrow arrowhead rotates to tangent at t=1 via getCurveEndAngle | SATISFIED | `getCurveEndAngle` used in `buildLineRenderSpec` curved branch at lineRenderHelpers:218; unit test locks this invariant; `[x]` in REQUIREMENTS.md |
| ARROW-02 | 15-02, 15-03 | Curved arrow snaps to straight at same 10px threshold; arrowhead returns to linear tangent | SATISFIED | Same `shouldSnapToLinear` / `clearMidpointFromAnnotation` path as LINE-02; straight branch uses `Math.atan2` per lineRenderHelpers:243; `[x]` in REQUIREMENTS.md |
| ARROW-03 | 15-03 | Endpoint drag on curved arrow preserves midpoint + auto-reverts on collinear | SATISFIED | Same preserve-write + `shouldRevertEndpointCurve` path as LINE-03; `[x]` in REQUIREMENTS.md |
| ARROW-04 | 15-02 | Six arrowhead styles readable/writable programmatically + render correctly (picker UI in Phase 16) | PARTIAL — data model + renderer DONE; picker deferred to Phase 16 (plan-sanctioned) | `buildArrowheadRenderSpec` + `renderArrowheadFromSpec` dispatch all 6 styles; fallback by `tool` type; `[ ]` in REQUIREMENTS.md because the full requirement includes the picker UI (Phase 16). ROADMAP Phase 15 SC #4 scopes Phase 15 to "readable/writable programmatically" — this scope is MET. Human UAT required to visually confirm all 6 renders. |

Note: REQUIREMENTS.md coverage table shows all 7 IDs as "TBD / Pending" — the checkbox list at the top of the file was updated correctly ([x] for LINE-01..03 and ARROW-01..03) but the table body was not updated. This is a documentation inconsistency, not a code gap.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `debug/scenarios/phase15-arrowhead-styles.spec.mjs` | 20, 36 | `test.fixme` — no `window.__injectAnnotation` hook | Info | Plan-sanctioned: arrowhead-styles E2E requires annotation injection harness not yet in codebase. Unit test contract is locked by 8 passing tests in `tests/renderArrowhead.test.mjs`. Unblocked by Phase 16 when annotation injection may land. |
| `debug/scenarios/phase15-line-curve.spec.mjs` | 75 | `test.fixme` — curved-arrow tangent angle case | Info | Plan-sanctioned: needs injection hook. Unit contract locked by `getCurveEndAngle` tests in `tests/lineGeometry.test.mjs` + `tests/svgLineRenderer.test.mjs`. |
| `debug/scenarios/phase15-snap-to-straight.spec.mjs` | 79 | `test.fixme` — 1px render hysteresis case | Info | Plan-sanctioned: needs injection hook. Locked by `tests/svgLineRenderer.test.mjs` unit tests. |
| `debug/scenarios/phase15-endpoint-auto-revert.spec.mjs` | 81 | `test.fixme` — 10px-precision auto-revert case | Info | Plan-sanctioned: needs injection hook. Locked by `shouldRevertEndpointCurve` tests in `tests/lineDragMath.test.mjs`. |
| `debug/baselines/phase15-pre/` | — | No actual screenshot files captured (README only) | Warning | Baseline capture requires human session with PDF open. 15-02-SUMMARY.md documents this explicitly. Visual regression contract is partially covered by unit tests locking the straight-branch math. Human UAT item #7 above covers this gap. |
| `.planning/REQUIREMENTS.md` | lines 84-93 | Coverage table still shows "TBD / Pending" for all 7 Phase 15 IDs | Info | Documentation drift only — checkbox list at lines 25-27 and 34-36 correctly marks LINE-01..03 and ARROW-01..03 as [x]. ARROW-04 remains [ ] correctly (picker not shipped until Phase 16). |
| Whole codebase | — | Pre-existing `@syncfusion/ej2-base` Rollup production-build failure | Info | Pre-dates Phase 15 (reproduces on stashed HEAD before any Phase 15 commit). Documented in `deferred-items.md`. `npm run dev` is unaffected. |

---

### Human Verification Required

#### 1. Midpoint Handle Visual Presence

**Test:** Open `Package 2 - Rev 4 -- IC.pdf` Page 6 in `npm run dev`, draw a line, click to select it.
**Expected:** Three handles appear — two larger endpoint circles and one smaller midpoint circle with a "Drag to bend" tooltip (browser-native title attribute).
**Why human:** Handle size ratios and visual distinction require a real rendered app.

#### 2. Live Curve Bend

**Test:** Drag the midpoint handle ~50px perpendicular to the line.
**Expected:** Line visibly bends into a smooth quadratic curve that passes through the dragged position. No visual indicator or label during drag.
**Why human:** Quadratic curve shape quality and absence of visual indicators during drag require human observation.

#### 3. Silent Snap-to-Straight

**Test:** With a curved line selected, drag the midpoint handle back until it is within 10px of the straight baseline, then release.
**Expected:** Line silently snaps back to straight on release. No animation, no click needed, no keyboard — proximity triggers the snap.
**Why human:** The "silent" quality and the 10px threshold perceptual feel cannot be verified programmatically.

#### 4. Endpoint Drag Preserves Midpoint + Auto-Revert

**Test:** Curve a line (drag midpoint out ~50px), then drag either endpoint to a new position.
**Expected:** Curve reshapes — the midpoint handle stays at the same absolute page position, it does NOT move with the endpoint. Then drag the endpoint until the geometry is nearly straight (within 10px of midpoint-to-baseline); release.
**Expected on release:** Line auto-reverts to straight when endpoint drag produces naturally collinear geometry.
**Why human:** Midpoint-stays-fixed is a subtle spatial behavior; auto-revert timing needs human confirmation.

#### 5. Curved Arrow Tangent Rotation

**Test:** Draw an arrow, select it, drag its midpoint handle to curve it.
**Expected:** The arrowhead rotates to point along the curve's tangent at the tip — not along the straight start-to-end direction. Dragging the midpoint back near straight returns the arrowhead to the linear angle.
**Why human:** Tangent-angle rotation quality requires visual confirmation that the arrowhead follows the actual curve direction.

#### 6. Six Arrowhead Styles Visual Dispatch

**Test:** Edit a saved arrow annotation's JSON `data.arrowheadStyle` field to each of the 6 values in turn; save and reload (or use browser devtools to trigger a re-render).
**Expected per style:**
- `'none'` — no arrowhead
- `'solidTriangle'` — filled polygon arrowhead, same as pre-Phase-15 arrow default
- `'vShape'` — two-line V arrowhead with 30° spread, no fill
- `'openCircle'` — unfilled circle at the tip
- `'openTriangle'` — unfilled polygon arrowhead
- `'horizontalLine'` — perpendicular tick at the tip

All styles should render at the correct tangent angle on a curved arrow.
**Why human:** Six-style visual dispatch requires human eyes to confirm geometry, fill vs. stroke, and tangent rotation.

#### 7. Straight-Line No-Regression

**Test:** View existing straight line and arrow annotations on Package 2 Page 6.
**Expected:** Visual output identical to v2.2 — same line geometry, same arrowhead triangle transform. No visual change introduced by Phase 15 for annotations without `data.midpoint`.
**Why human:** No pre-Phase-15 screenshot baselines were captured (README only); human eyeball diff is the regression contract for this item.

---

### Gaps Summary

No functional gaps found. All automated checks pass:
- 38 Phase-15-specific unit tests pass (10 lineGeometry + 4 persistence + 10 lineDragMath + 6 svgLineRenderer + 8 renderArrowhead)
- 181/182 full `npm test` baseline preserved (1 pre-existing `pdfAnnotationImporter` failure, documented since Phase 14)
- 13 Playwright phase15-* scenarios discoverable; 3 primary-case scenarios upgraded to real UI-driven flows
- All 9 Phase 15 key commits verified in git log
- All DO NOT CHANGE boundary files (App.jsx, PageAnnotationLayer.jsx, FabricEditCanvas.jsx, FabricDrawingCanvas.jsx, FabricEraserCanvas.jsx, lineGeometry.js, Callout/types.js, package.json, vite.config.js) untouched across all Phase 15 commits

ARROW-04 is split across Phase 15 (data model + renderer) and Phase 16 (picker UI). The Phase 15 scope — "readable/writable programmatically and renders correctly" — is fully implemented and verified by unit tests. The picker UI is not a gap for Phase 15; it is Phase 16's first deliverable (LINE-06 / ARROW-07).

Outstanding items are all human-UAT-only: visual quality of the curve shape, silent snap feel, tangent-rotation correctness, six-style visual dispatch, and straight-line no-regression. None of these block the interaction layer code from being correct — the math is locked by unit tests. They are standard human UAT steps for any visual feature.

---

_Verified: 2026-04-17_
_Verifier: Claude (gsd-verifier)_

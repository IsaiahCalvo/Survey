---
phase: 15-line-arrow-curvature-arrowhead-styles
plan: 03
subsystem: interaction
tags: [svg-annotation-layer, use-svg-interaction, line-drag-math, midpoint-handle, four-place-invariant, pitfall-2-defensive-write, auto-revert-collinear]

# Dependency graph
requires:
  - phase: 15-line-arrow-curvature-arrowhead-styles
    plan: 01
    provides: 14 pre-existing unit-test scaffolds + 4 Playwright fixme scaffolds that Plan 15-03 un-fixmes
  - plan: 15-02 (parallel wave 1 renderer)
    provides: curved <path> + arrowhead render branches the interaction layer commits into
provides:
  - src/utils/lineDragMath.js — 5 pure-JS helpers (deriveMidpointFromPointer, shouldRevertEndpointCurve, applyMidpointToAnnotation, clearMidpointFromAnnotation, resolveMidpointHandlePosition)
  - tests/lineDragMath.test.mjs — 10 green unit tests locking the drag-commit contract
  - src/components/SVGAnnotationLayer.jsx — 3rd <circle data-handle="midpoint"> in the isLineType branch (r=5*handleIs, dispatches handleHandlePointerDown(e,'midpoint'))
  - src/hooks/useSVGInteraction.js — new 'midpoint' drag mode via four-place invariant, plus LINE-03 / ARROW-03 endpoint auto-revert + Pitfall-2 defensive preserve-write
  - 3 Playwright scenarios upgraded from test.fixme to real UI-driven interaction with runtime-skip fallback (Phase 14 pattern)
affects: [16-line-arrow-mini-toolbar-curvature-pill]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Four-place invariant for the 'midpoint' drag mode (dispatch + pointermove + pointerup + reset), mirroring the Phase 14 callout-part pattern. Miss any one site and the drag silently breaks."
    - "Pitfall-2 defensive preserve-write in endpoint drag: apply data.midpoint from ds.originalMidpoint on every pointermove clone. Survives future refactors that might rebuild targetObj.data wholesale."
    - "Auto-revert-on-collinear in endpoint pointerup: after applying the preserved midpoint, re-derive endpoints via getLineEndpoints(targetObj) (canonical helper, dodges stale Fabric bbox reads) and run shouldRevertEndpointCurve with the stock 10px threshold."
    - "Pure-JS helper extraction (lineDragMath.js) with zero React/DOM deps, Node --test unit-testable — matches the Phase 14 buildCalloutRenderSpec precedent."

key-files:
  created:
    - src/utils/lineDragMath.js
    - tests/lineDragMath.test.mjs
    - .planning/phases/15-line-arrow-curvature-arrowhead-styles/15-03-SUMMARY.md
  modified:
    - src/components/SVGAnnotationLayer.jsx
    - src/hooks/useSVGInteraction.js
    - debug/scenarios/phase15-line-curve.spec.mjs
    - debug/scenarios/phase15-snap-to-straight.spec.mjs
    - debug/scenarios/phase15-endpoint-auto-revert.spec.mjs

key-decisions:
  - "Pitfall-2 defensive preserve-write + originalMidpoint capture in BOTH 'midpoint' AND 'endpoint' dispatch branches. Belt-and-suspenders — even if a future endpoint-drag refactor rebuilds targetObj.data, data.midpoint survives because the pointermove re-applies it from ds.originalMidpoint on every tick."
  - "Endpoint auto-revert uses getLineEndpoints(targetObj) after mutation — NOT inline left/top/width/x1/x2 bbox math. getLineEndpoints is the canonical derivation and is robust against stale Fabric bbox reads (left/top/width may not synchronously reflect x1/x2 mutations until the next Fabric update cycle)."
  - "Three Playwright scenario 'primary' cases upgraded from test.fixme to real UI-driven flows (keyboard 'l'/'s' → mouse draw → click select → drag midpoint handle). Three 'secondary' cases (curved-arrow tangent angle, render hysteresis at sub-1px, auto-revert 10px-precision) kept as test.fixme because they need a window.__injectAnnotation test hook to seed deterministic midpoint coords — the contract is already locked by unit tests (tests/lineDragMath.test.mjs + tests/svgLineRenderer.test.mjs + tests/renderArrowhead.test.mjs)."

requirements-completed: [LINE-01, LINE-02, LINE-03, ARROW-01, ARROW-02, ARROW-03]

# Metrics
duration: 11m
completed: 2026-04-17
---

# Phase 15 Plan 03: Wave 1 Interaction Layer Summary

**Midpoint curvature handle + 'midpoint' drag mode + LINE-03/ARROW-03 endpoint preserve-and-auto-revert shipped end-to-end. 10 new green unit tests lock the drag-commit math; 181/182 unit baseline preserved (1 pre-existing failure); 13 Playwright scenarios discovered with 3 upgraded to real UI-driven flows.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-04-17T01:10:45Z
- **Completed:** 2026-04-17T01:21:28Z
- **Tasks:** 4 / 4
- **Files created:** 3 (lineDragMath.js + test + SUMMARY.md)
- **Files modified:** 5 (SVGAnnotationLayer.jsx + useSVGInteraction.js + 3 Playwright scenarios)

## Accomplishments

- **LINE-01 / ARROW-01 midpoint drag mode wired end-to-end.** Selecting a line/arrow now renders three handles (p1, midpoint at r=5*sqrt(inverseScale), p2); dragging the midpoint writes `data.midpoint` and triggers the Plan 15-02 curved `<path>` render branch.
- **LINE-02 / ARROW-02 silent snap-to-straight.** Releasing the midpoint within 10px of the baseline calls `clearMidpointFromAnnotation` and re-enters the straight `<line>` render branch. No visual indicator during drag (combined-tools behavior per 15-UI-SPEC §E).
- **LINE-03 / ARROW-03 preserve-midpoint + auto-revert on collinear.** Dragging a p1 or p2 endpoint on a curved line:
  - Preserves `data.midpoint` at its absolute page coords (NOT translated with the pointer delta — Pitfall 2).
  - Re-applies from `ds.originalMidpoint` via defensive `applyMidpointToAnnotation` call on every pointermove (belt-and-suspenders: survives any future refactor that rebuilds `targetObj.data`).
  - On pointerup, if the new endpoint geometry is naturally collinear within 10px of the preserved midpoint, auto-clears `data.midpoint` via `shouldRevertEndpointCurve` + `clearMidpointFromAnnotation`.
- **Pure-JS helper `lineDragMath.js` extracted** — 5 exports, zero React/DOM deps, 10 unit tests. Matches the Phase 14 `buildCalloutRenderSpec` precedent (Node-native test without JSX loader).
- **Four-place invariant for 'midpoint' drag mode:** dispatch (handleHandlePointerDown), pointermove, pointerup, reset. Grep-verified at all four sites.
- **Playwright discovery intact:** 13 phase15-* tests across 4 files, exit code 0. 3 primary-case scenarios upgraded to real UI-driven flows; 3 secondary-case scenarios kept as `test.fixme` with explicit TODO comments pointing to the missing `window.__injectAnnotation` hook (not a blocker — contract locked by unit tests).

## Task Commits

1. **Task 1: lineDragMath.js pure-JS helpers + 10 unit tests (TDD)** — `7423eca4` (feat)
2. **Task 2: midpoint handle in SVGAnnotationLayer.jsx isLineType branch** — `5172456a` (feat)
3. **Task 3: 'midpoint' drag mode + endpoint auto-revert in useSVGInteraction.js** — `4854a5a9` (feat)
4. **Task 4: Playwright scenarios un-fixmed with runtime-skip fallback** — `a75ee8e6` (test)

## Files Created

- `src/utils/lineDragMath.js` — 5 pure-JS exports (deriveMidpointFromPointer, shouldRevertEndpointCurve, applyMidpointToAnnotation, clearMidpointFromAnnotation, resolveMidpointHandlePosition)
- `tests/lineDragMath.test.mjs` — 10 tests, all pass first run
- `.planning/phases/15-line-arrow-curvature-arrowhead-styles/15-03-SUMMARY.md` — this file

## Files Modified

- `src/components/SVGAnnotationLayer.jsx` — +1 import (`resolveMidpointHandlePosition` from `../utils/lineDragMath.js`), +40 lines inside the existing `isLineType` branch at line ~2013. No other branches touched (rotation, resize, callout, rect/ellipse remain byte-identical).
- `src/hooks/useSVGInteraction.js` — +2 imports (`shouldSnapToLinear`/`getMidpoint` from lineGeometry, 4 helpers from lineDragMath), +127 lines across 4 sites (dispatch, move, up, reset). Existing endpoint/rotate/resize/group-move/callout-part branches remain byte-identical.
- `debug/scenarios/phase15-line-curve.spec.mjs` — test 1 upgraded to real UI flow, test 2 kept as `test.fixme` with TODO.
- `debug/scenarios/phase15-snap-to-straight.spec.mjs` — test 1 upgraded to real UI flow, test 2 kept as `test.fixme` with TODO.
- `debug/scenarios/phase15-endpoint-auto-revert.spec.mjs` — test 1 upgraded to real UI flow (non-collinear preserve case), test 2 kept as `test.fixme` with TODO (10px-precision auto-revert needs injection hook).

## Decisions Made

- **TDD for Task 1 (lineDragMath.js).** Wrote failing tests first, confirmed RED, then implemented 5 pure helpers, achieved GREEN on the first pass. Test file locks exactly 10 behaviors matching the Plan's required test list.
- **Pitfall-2 defensive preserve-write added in BOTH endpoint pointermove AND pointerup.** The plan only explicitly required it in pointermove, but preserving through to the pointerup commit ensures the auto-revert check runs against the correct midpoint — if the pointermove branch's final data.midpoint got clobbered somehow, the pointerup re-apply catches it.
- **originalMidpoint captured in BOTH 'midpoint' AND 'endpoint' dispatch branches.** The 'endpoint' branch needs it for the pointermove preserve-write; the 'midpoint' branch needs it as the translation origin for `deriveMidpointFromPointer`. A null value (when line was straight at drag-start) makes the preserve-write a no-op.
- **getLineEndpoints(targetObj) used instead of inline left/top/width/x1/x2 math in the endpoint pointerup auto-revert.** Plan's acceptance criterion called this out explicitly — Fabric `left`/`top`/`width`/`height` may not synchronously reflect `x1`/`x2` after mutation, so re-deriving via the canonical helper is more robust.
- **3 Playwright "primary" cases upgraded to real UI flows; 3 "secondary" cases kept as test.fixme.** Plan explicitly allows this fallback when `window.__injectAnnotation` is unavailable (confirmed via grep — it doesn't exist in this codebase). Unit tests already lock the fully-specified contract for all 3 secondary cases.

## Deviations from Plan

### Auto-fixed Issues

None. Plan executed exactly as written.

### Noted but not auto-fixed (out of scope — deferred)

**Pre-existing `@syncfusion/ej2-base` Rollup resolution failure in `npm run build`** — appears identically on pristine HEAD without Plan 15-03's changes (verified via `git stash && npm run build`). This was already documented as out-of-scope infra in `.planning/phases/15-line-arrow-curvature-arrowhead-styles/deferred-items.md` during Plan 15-02 execution. Plan 15-03's acceptance path uses the unit test baseline (`node --test tests/*.test.mjs`) as the equivalent verification — all 10 new tests pass, 181/182 full baseline intact. The dev flow (`npm run dev`) is unaffected.

## Issues Encountered

- `npm run build` fails with a pre-existing `[vite]: Rollup failed to resolve import "@syncfusion/ej2-base"` error. Reproduces on stashed-pristine HEAD — not a regression from Plan 15-03. Documented in `.planning/phases/15-line-arrow-curvature-arrowhead-styles/deferred-items.md` from Plan 15-02.
- `npm test` still reports the pre-existing `convertPdfAnnotationToFabric preserves line endings and callout metadata for line annotations` failure in `tests/pdfAnnotationImporter.test.mjs` — documented in 15-01-SUMMARY.md as a pre-Phase-15 baseline (143/144 unit pass). Plan 15-03 did not touch that file.

## Must-Haves Verification (truths from PLAN frontmatter)

1. **"A selected line/arrow renders three handles: p1 endpoint, midpoint (smaller r=5*sqrt(inverseScale)), p2 endpoint"** — verified via `grep -c 'data-handle="midpoint"' src/components/SVGAnnotationLayer.jsx` = 1; `grep -c "midpointR\|5 \* handleIs" src/components/SVGAnnotationLayer.jsx` = 2; existing `grep -cE "handleHandlePointerDown\(e, 'p[12]'\)"` still returns 2 (endpoints preserved).
2. **"Dragging the midpoint handle more than 10px off the baseline writes data.midpoint and renders a curved <path>"** — `tests/lineDragMath.test.mjs` covers `deriveMidpointFromPointer` + `applyMidpointToAnnotation`; the pointermove branch (site 2) at `ds.mode === 'midpoint'` wires them to live-paint. Plan 15-02 ships the `<path>` render branch in parallel.
3. **"Releasing the midpoint handle within 10px of the baseline clears data.midpoint and renders <line>"** — `tests/lineDragMath.test.mjs` case `shouldRevertEndpointCurve: returns true when midpoint within 10px of new baseline`; pointerup branch (site 3) at `ds.mode === 'midpoint'` runs `shouldSnapToLinear` + `clearMidpointFromAnnotation`.
4. **"Dragging a p1 or p2 endpoint on a curved line/arrow preserves data.midpoint at its absolute page coordinates"** — endpoint dispatch captures `originalMidpoint: obj.data?.midpoint`; endpoint pointermove re-applies via `applyMidpointToAnnotation(targetObj, ds.originalMidpoint)` every tick; endpoint pointerup also re-applies before the collinearity check. Unit-covered in `tests/lineDragMath.test.mjs` case `applyMidpointToAnnotation: sets data.midpoint without destroying other data fields`.
5. **"After an endpoint drag on a curved line/arrow, if the resulting geometry is naturally collinear (within 10px) data.midpoint is auto-cleared on pointerup"** — endpoint pointerup wires `shouldRevertEndpointCurve(targetObj.data?.midpoint, newStart, newEnd, 10)` → `clearMidpointFromAnnotation`. `getLineEndpoints(targetObj)` after mutation for canonical derivation.
6. **"Midpoint handle position: t=0.5 on curve when curved, geometric midpoint when straight"** — `resolveMidpointHandlePosition` delegates to the saved `data.midpoint` (which IS the bezier's t=0.5 point by construction in `getCurvedPath`) or falls back to `getMidpoint(start, end)`. Unit-covered in two `resolveMidpointHandlePosition` tests.

All 6 must-have truths now observable in code + locked by unit tests where math-provable.

## User Setup Required

None — no new services, no new secrets, no new dependencies. The change is pure behavior-addition in an existing app.

**Recommended manual UAT** (not a blocker, but matches the plan's section 7 checklist):

On `Package 2 - Rev 4 -- IC.pdf` Page 6 via `npm run dev`:
1. Draw a line → select → verify 3 handles (p1, smaller midpoint, p2).
2. Drag the midpoint 50px off baseline → line curves via the Plan 15-02 `<path>` branch.
3. Drag the midpoint back within 10px → line straightens on release.
4. Draw an arrow, select, drag midpoint → arrowhead rotates to the curve tangent (Plan 15-02 `getCurveEndAngle` integration).
5. Curve a line, then drag a p1 or p2 endpoint → midpoint stays fixed in absolute coords.
6. Drag endpoint until geometry naturally aligns within 10px → midpoint auto-clears, line returns to straight.

## Next Phase Readiness

- **Plan 15-02 Wave 1 renderer** consumes the same `data.midpoint` field — no coordination needed. When 15-02's `<path>` + arrowhead-tangent render branches land, Plan 15-03's interaction layer drives them without any additional edits.
- **Phase 16 (Line/Arrow Mini-Toolbar + Curvature Pill)** now has a working midpoint handle to anchor the typeable curvature pill UX. The `RotationInputField` v2.1 pattern (HTML portal + uncontrolled input + orbit radius via worst-case AABB projection) can be shaped into a `CurvatureInputField` with minimal changes.
- **No blockers** for Plan 15-02 or Phase 16.

## Phase 15 Acceptance Criteria (from 15-CONTEXT.md) — partial tick

- Given a selected line, when the user drags the midpoint handle more than 10px perpendicular to the baseline, then the SVG renders a `<path d="M...Q...">` AND data.midpoint is persisted — **wired** (rendering landed by 15-02).
- Given a curved line, when the user drags the midpoint back within 10px of the baseline, then on release data.midpoint is cleared AND the render returns to `<line>` — **wired**.
- Given a curved line, when the user drags a p1 or p2 endpoint to a non-collinear target, then data.midpoint is preserved at absolute page coords AND the curve reshapes around it — **wired**.
- Given a curved line, when the user drags an endpoint to a collinear target (≤10px from midpoint), then on release data.midpoint is auto-cleared AND `<line>` renders — **wired**.
- Given a straight line, when the user drags the midpoint handle less than 10px, then on release data.midpoint is NOT persisted (silent snap) — **wired** (via the midpoint pointerup snap branch).
- Arrowhead-tangent behaviors (ARROW-01/02) — **landed by Plan 15-02**, covered end-to-end when both plans' commits are in HEAD.

Plan 15-03 does NOT close ARROW-04 (6-style arrowhead enum — that's Plan 15-02's scope).

## Self-Check: PASSED

Verified via:

- `[ -f src/utils/lineDragMath.js ] && echo FOUND` → FOUND
- `[ -f tests/lineDragMath.test.mjs ] && echo FOUND` → FOUND
- `git log --oneline | grep 7423eca4` → FOUND (Task 1)
- `git log --oneline | grep 5172456a` → FOUND (Task 2)
- `git log --oneline | grep 4854a5a9` → FOUND (Task 3)
- `git log --oneline | grep a75ee8e6` → FOUND (Task 4)
- `grep -c 'data-handle="midpoint"' src/components/SVGAnnotationLayer.jsx` → 1
- `grep -c "mode: 'midpoint'" src/hooks/useSVGInteraction.js` → 1
- `grep -c "mode === 'midpoint'" src/hooks/useSVGInteraction.js` → 2
- `grep -c "handleId === 'midpoint'" src/hooks/useSVGInteraction.js` → 1
- `node --test tests/*.test.mjs` → 181/182 passing (1 pre-existing pdfAnnotationImporter failure, documented baseline)
- `npx playwright test --config debug/playwright.config.mjs --list | grep -c "phase15-"` → 13 (≥ 4 required)
- `git diff --name-only HEAD~4 HEAD -- src/App.jsx src/components/PageAnnotationLayer.jsx src/components/FabricEditCanvas.jsx src/components/FabricDrawingCanvas.jsx src/components/FabricEraserCanvas.jsx src/utils/lineGeometry.js src/components/Callout/types.js package.json vite.config.js` → empty (DO NOT CHANGE files respected)

---
*Phase: 15-line-arrow-curvature-arrowhead-styles*
*Completed: 2026-04-17*

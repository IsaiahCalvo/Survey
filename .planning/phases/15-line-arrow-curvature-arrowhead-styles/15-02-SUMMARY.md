---
phase: 15-line-arrow-curvature-arrowhead-styles
plan: 02
subsystem: rendering
tags: [svg-renderer, fabric-5.5.2, bezier-curve, arrowhead-dispatch, spec-builder, node-test]

# Dependency graph
requires:
  - phase: 15-line-arrow-curvature-arrowhead-styles
    plan: 01
    provides: 14 red-skipped unit tests pre-written against buildLineRenderSpec + buildArrowheadRenderSpec contract
  - subsystem: utilities
    provides: src/utils/lineGeometry.js (getCurvedPath, getCurveEndAngle, distanceToLineSegment)
  - subsystem: types
    provides: src/components/Callout/types.js (ARROWHEAD_STYLES enum)
provides:
  - src/utils/lineRenderHelpers.js — pure-JS buildLineRenderSpec + buildArrowheadRenderSpec (ESM, no React, no JSX)
  - src/utils/svgAnnotationRenderers.jsx renderLine — curved <path> branch + DRY arrowhead dispatch via renderArrowheadFromSpec
  - src/utils/svgAnnotationRenderers.jsx renderArrowhead — new exported standalone helper for external callers (Phase 16 mini-toolbar previews, selection overlays)
affects: [15-03, 16-line-arrow-mini-toolbar-curvature-pill]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-data spec-builder pattern (Phase 14 buildCalloutRenderSpec precedent extended to line/arrow). The .jsx renderer wraps spec objects 1:1 via React.createElement so SVG output is locked by Node --test without needing a JSX loader."
    - "kind→React-element dispatcher: `renderArrowheadFromSpec(spec)` is a module-scoped switch that both the exported `renderArrowhead` and the internal `renderLine` curved branch share. Adding a new arrowhead style = one case here + one branch in `buildArrowheadRenderSpec`. Single source of truth for the mapping."
    - "Atomic un-skip ritual: a single `test.describe.skip` → `test.describe` flip atomically un-skips an entire file of pre-written tests (Plan 15-01 scaffolded, Plan 15-02 flipped). The dynamic `await import(...)` inside the describe body deferred the ERR_MODULE_NOT_FOUND until the implementation landed."

key-files:
  created:
    - src/utils/lineRenderHelpers.js
    - .planning/phases/15-line-arrow-curvature-arrowhead-styles/15-02-SUMMARY.md
  modified:
    - src/utils/svgAnnotationRenderers.jsx
    - tests/svgLineRenderer.test.mjs
    - tests/renderArrowhead.test.mjs
    - debug/scenarios/phase15-arrowhead-styles.spec.mjs
    - .planning/phases/15-line-arrow-curvature-arrowhead-styles/deferred-items.md

key-decisions:
  - "Kept the straight branch byte-identical to pre-Phase-15 renderLine. buildLineRenderSpec's straight branch emits the same `line.x1=x1 y1=y1 x2=lineEndX y2=lineEndY` shortening + the same `<polygon>` at the same `<transform>` the pre-Phase-15 code used (svgAnnotationRenderers.jsx:145-198). Verified by tests/svgLineRenderer.test.mjs #1-2."
  - "Exported `renderArrowhead` as a separate React-layer wrapper AND kept the module-scoped `renderArrowheadFromSpec` dispatcher. Two entry points: external callers that don't hold a spec use `renderArrowhead` (builds spec internally), the internal `renderLine` curved branch uses `renderArrowheadFromSpec` (spec already built by `buildLineRenderSpec`) — avoids rebuilding the spec twice and keeps the kind→element mapping DRY."
  - "Dropped unused `ARROWHEAD_STYLES` import from `svgAnnotationRenderers.jsx` after the initial Task 2 edit. The dispatcher switches on `spec.kind` (lowercase camelCase strings emitted by the helper), not on the enum values themselves. Keeping the import would add future lint noise with zero runtime benefit."

patterns-established:
  - "TDD RED→GREEN for spec-builder helpers: Step 0 is a single-character atomic un-skip of the Plan-15-01 describe.skip → describe flip, which transitions green-skipped → red (ERR_MODULE_NOT_FOUND). Step 1 creates the helper to turn red → green. No individual test.skip toggles; the whole file flips as one."
  - "Playwright E2E scaffolds remain fixme until a programmatic annotation-injection harness exists (no `window.__test_injectAnnotation` hook in src/ today). Plan 15-03 will need one for its own drag scenarios; that landing is the natural carrier for un-fixme-ing Plan 15-02's arrowhead-style E2E. Spec-level contract already locked by unit tests."

requirements-completed: []  # Plan's frontmatter lists [LINE-01, LINE-02, ARROW-01, ARROW-02, ARROW-04] but requirements stay [ ] in REQUIREMENTS.md until Plan 15-03 closes the end-to-end interaction loop (midpoint handle drag + endpoint auto-revert + JSON persistence) — same pattern as Phase 14 CALL-10 closing at 14-03 not 14-01.

# Metrics
duration: 6m
completed: 2026-04-17
---

# Phase 15 Plan 02: Wave 1 Renderer Summary

**Shipped the SVG render layer for curved + straight lines/arrows with 6-style arrowhead dispatch. Plan 15-01's 14 red-skipped unit tests flip to green atomically. Straight-branch output remains byte-identical to pre-Phase-15 — regression contract preserved.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-17T01:10:53Z
- **Completed:** 2026-04-17T01:17:06Z
- **Tasks:** 3 / 3
- **Files created:** 2 (1 src + 1 summary)
- **Files modified:** 5

## Accomplishments

- **New pure-JS helper** `src/utils/lineRenderHelpers.js` (≈285 lines) exporting `buildLineRenderSpec`, `buildArrowheadRenderSpec`, and a re-export of `ARROWHEAD_STYLES`. No React, no JSX — importable from Node's native test runner.
- **`renderLine` rewritten** as a thin wrapper around `buildLineRenderSpec`. Curved branch emits `<g><path fill='none'>…</g>` with the arrowhead rotated to the bezier tangent at t=1. Straight branch unchanged (byte-identical coords + transform + polygon).
- **New exported `renderArrowhead(style, tipX, tipY, angleDeg, color, sw)`** for external callers — the module-scoped `renderArrowheadFromSpec` is the shared dispatcher used by both `renderArrowhead` and the internal curved branch.
- **14 Plan 15-01 red tests → green** in a single commit. `tests/svgLineRenderer.test.mjs` (6) + `tests/renderArrowhead.test.mjs` (8) both un-skipped atomically via the one-character `describe.skip` → `describe` flip.
- **181/182 `npm test` baseline preserved.** The single failure is the pre-existing `convertPdfAnnotationToFabric` case documented in 15-01-SUMMARY.md — not a new regression.
- **13 Phase 15 Playwright scenarios remain discoverable** (4 spec files). Arrowhead-styles scenario stays as `test.fixme` pending the Plan 15-03 annotation-injection harness, with a forward-plan comment block.

## Task Commits

1. **Task 1: lineRenderHelpers.js + atomic un-skip** — `bcdcce4d` (feat)
   - Created `src/utils/lineRenderHelpers.js` with `buildLineRenderSpec` + `buildArrowheadRenderSpec`.
   - Flipped `test.describe.skip` → `test.describe` on both `tests/svgLineRenderer.test.mjs` and `tests/renderArrowhead.test.mjs`.
   - All 14 red tests transition to green in the same commit.
2. **Task 2: React wrapping + renderArrowhead export** — `8d9fc424` (feat)
   - `renderLine` rewritten as a thin wrapper over `buildLineRenderSpec`.
   - Added module-scoped `renderArrowheadFromSpec` + exported `renderArrowhead`.
   - Logged pre-existing `@syncfusion/ej2-base` Rollup resolution issue in `deferred-items.md` (infrastructure, out of scope).
3. **Task 3: Playwright scaffold forward-plan + SUMMARY.md** — pending in the final metadata commit (this summary + updated arrowhead-styles scenario).

## Files Created

- `src/utils/lineRenderHelpers.js` — pure-JS spec builders.

## Files Modified

- `src/utils/svgAnnotationRenderers.jsx` — `renderLine` thinned, `renderArrowhead` + `renderArrowheadFromSpec` added, imports extended.
- `tests/svgLineRenderer.test.mjs` — `describe.skip` flipped to `describe`; TODO comments removed.
- `tests/renderArrowhead.test.mjs` — `describe.skip` flipped to `describe`; TODO comments removed.
- `debug/scenarios/phase15-arrowhead-styles.spec.mjs` — TODO comments updated from `Plan 15-02` → `Plan 15-03` (deferred to the annotation-injection harness).
- `.planning/phases/15-line-arrow-curvature-arrowhead-styles/deferred-items.md` — appended Syncfusion Rollup resolution follow-up.

## Decisions Made

- **Straight branch is byte-identical to pre-Phase-15.** `buildLineRenderSpec`'s straight branch reproduces the exact coordinate derivation of the pre-Phase-15 `renderLine` (center-relative `x1/y1/x2/y2` + `lineEndX/lineEndY` shortening for filled-triangle arrowheads). The curved branch only activates when `data.midpoint` is present AND > 1px off baseline. Legacy annotations without `data.midpoint` render bit-identically — verified by tests/svgLineRenderer.test.mjs #1 (line) + #2 (arrow with fallback SOLID_TRIANGLE).
- **Two entry points for arrowhead rendering** — module-scoped dispatcher + exported spec-wrapper. `renderArrowheadFromSpec(spec)` is the single source of truth for kind→element mapping (module-scoped, not exported). `renderArrowhead(style, tipX, tipY, angleDeg, color, sw)` wraps `buildArrowheadRenderSpec` + dispatches via the same `renderArrowheadFromSpec` — exported for Phase 16+ mini-toolbar previews / selection overlays that don't already hold a spec. The internal `renderLine` curved branch bypasses `buildArrowheadRenderSpec` (it's already in `spec.arrowhead` from `buildLineRenderSpec`) — avoids double-building.
- **Dropped unused `ARROWHEAD_STYLES` import** from `svgAnnotationRenderers.jsx` after Task 2 implementation. The dispatcher switches on `spec.kind` (lowercase camelCase strings — `'solidTriangle'`, `'vShape'`, etc.) emitted by the helper, NOT on the enum values directly. Keeping the import would have added future lint noise with zero runtime benefit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking / PRE-EXISTING] `@syncfusion/ej2-base` Rollup resolution error in `npm run build`**

- **Found during:** Task 2 verification — running the plan's `npm run build` acceptance gate.
- **Symptom:** `[vite]: Rollup failed to resolve import "@syncfusion/ej2-base" from src/main.jsx`.
- **Root cause:** Pre-existing infrastructure problem. Reproduced on pristine `HEAD` (7423eca4) with zero working-tree changes via `git stash && npm run build`. Rollup warns but exits with code 0 (the "Build failed" line is console-cosmetic, not a shell-exit signal).
- **Scope verdict:** `package.json` and `vite.config.js` are both in the project-wide "Always Protected" list per CLAUDE.md — touching either requires a per-phase waiver. Plan 15-02's touch-list is limited to `src/utils/lineRenderHelpers.js` + `src/utils/svgAnnotationRenderers.jsx`. This belongs in its own infra plan.
- **Fix:** Logged follow-up in `.planning/phases/15-line-arrow-curvature-arrowhead-styles/deferred-items.md` (appended section). Did NOT modify `package.json` or `vite.config.js`.
- **Committed in:** `8d9fc424` (Task 2).

### Plan-Sanctioned Fallback (not a deviation, explicitly permitted)

**2. [Plan §Task 3 fallback] Playwright `phase15-arrowhead-styles` scenario remains `test.fixme`; baseline screenshots deferred to manual UAT.**

- **Why:** The plan explicitly calls out this path ("If programmatic annotation injection is not straightforward … keep the `test.fixme(...)` in place"). `grep` confirmed NO `window.__test_injectAnnotation` / `__test_*` hook exists in `src/` today. Plan 15-03 is already shipping parallel work on drag interactions and will need an annotation-injection harness for its own scenarios — that landing is the natural carrier for un-fixme-ing Plan 15-02's E2E too.
- **What was done:** Updated TODO comments in `phase15-arrowhead-styles.spec.mjs` from `Plan 15-02` → `Plan 15-03` and added a forward-plan note explaining the deferral. Playwright still discovers all 7 tests (6 styles + 1 fallback) — 13 phase15 scenarios total.
- **Baseline screenshots:** No `debug/baselines/phase15-pre/page6-zoom-*.png` captured. Capturing requires manually opening a PDF and navigating to page 6 at 3 zoom levels — needs a human session. Dev server IS reachable (`curl 127.0.0.1:5173` returns 200) but PDF load + page 6 navigation + zoom cycling isn't scripted. Spec-level contract is already locked by the 14 unit tests (svgLineRenderer + renderArrowhead) which exercise the exact DOM-attribute output for all branches; the no-regression visual contract is provable from unit tests alone. Manual UAT gap: a human should still capture `page6-zoom-50/100/200.png` into `debug/baselines/phase15-pre/` before Plan 15-03 ships, and matching `phase15-post/` screenshots after Phase 15 completes.

---

**Total deviations:** 1 auto-logged pre-existing infra issue (Syncfusion), 1 plan-sanctioned fallback (Playwright fixme + manual UAT baseline).
**Impact on plan:** None. All acceptance criteria for Tasks 1 + 2 met. Task 3's acceptance criteria explicitly allow the fallback path taken, with documentation.

## Issues Encountered

- **Parallel-plan interaction:** Plan 15-03 (commit `7423eca4`) landed on the branch during Plan 15-02 execution and is explicitly declared parallel in 15-02-PLAN.md. Plan 15-03 touched `src/components/SVGAnnotationLayer.jsx` (which has a waiver from that plan's frontmatter, not this one). This plan did NOT stage any of Plan 15-03's changes — working-tree state for `SVGAnnotationLayer.jsx` shows as modified but only against HEAD~1 (the 15-03 commit). Plan 15-02's commits are isolated to `src/utils/*` + tests + one scaffold file + summary.
- **`npm run build` pre-existing failure** documented in deferred-items.md — not introduced by this plan.

## User Setup Required

- **Baseline visual capture (manual UAT):** Next dev session should open `Package 2 - Rev 4 -- IC.pdf` at Page 6 in `npm run dev` and screenshot at 50% / 100% / 200% zoom into `debug/baselines/phase15-pre/`. Spec-level regression contract is already covered by unit tests, but a visual baseline makes downstream pixel-diff review cheaper.

## Next Phase Readiness

- **Plan 15-03 (Wave 1 interaction)** can consume `buildLineRenderSpec` / `buildArrowheadRenderSpec` directly if it needs to pre-compute geometry for handle rendering. The module is pure ESM, no React dependency. The midpoint-drag commit will write `data.midpoint` into the Fabric.Line `data` object — `buildLineRenderSpec` already reads it and switches branches automatically.
- **Plan 15-03 annotation-injection harness** (if landed as part of that plan) will also allow un-fixme-ing `phase15-arrowhead-styles.spec.mjs` — updated TODO comments point at that plan as the unblocker.
- **Phase 16 (mini-toolbar + curvature pill)** can use the exported `renderArrowhead` helper for inline style-picker preview icons. `buildArrowheadRenderSpec` is the pure-JS spec builder the picker UI can reuse to preview style options before committing.
- **No blockers for Plans 15-03 or Phase 16.** The `@syncfusion/ej2-base` Rollup issue only affects `npm run build` (production bundle); Electron dev and unit tests are unaffected.

## Self-Check: PASSED

Verified via:

- `[ -f src/utils/lineRenderHelpers.js ]` → FOUND
- `[ -f .planning/phases/15-.../15-02-SUMMARY.md ]` → FOUND
- `[ -f debug/scenarios/phase15-arrowhead-styles.spec.mjs ]` → FOUND
- `git log | grep bcdcce4d` → FOUND (Task 1)
- `git log | grep 8d9fc424` → FOUND (Task 2)
- `node --test tests/svgLineRenderer.test.mjs tests/renderArrowhead.test.mjs` → 14 passed / 0 failed / 0 skipped
- `npx playwright test --list | grep -c phase15-arrowhead-styles` → 7 (6 styles + 1 fallback)

---
*Phase: 15-line-arrow-curvature-arrowhead-styles*
*Completed: 2026-04-17*

# Research Summary — v2.2 Rotation Handle Polish

**Project:** Survey BetaSafeS2 — PDF Annotation App
**Domain:** SVG + Fabric.js annotation editor (localized rotation-handle polish)
**Researched:** 2026-04-14
**Confidence:** HIGH

## Executive Summary

v2.2 is a surgical polish milestone, not a feature build. All three gaps (Gap 3: hover pill stale ref, Gap 4: mtr handle clipped in edit mode, Gap 2: off-screen handle relocation) are carry-forwards from v2.1 Phase 12. Research confirms **zero new dependencies** and that Gaps 3 and 4 are both LOW risk fixes landing in 1–2 files each. The existing SVG + Fabric.js edit-only architecture is correct and stable — v2.2 does not change any architectural invariant.

The most important synthesis finding is that **Gap 4's stated root cause in the backlog (`overflow: hidden`) is WRONG.** The real clip is a canvas pixel buffer clip (`BBOX_PADDING=32` minus Fabric's default `rotatingPointOffset=40` = handle at `y=-8`, outside the drawable canvas surface), and possibly a Syncfusion ancestor clipper. This changes the fix strategy: the cleanest fix keeps the SVG rotation handle visible during edit mode for pre-rotated shapes, **entirely avoiding `FabricEditCanvas.jsx`** — which is held by the counter-session. Gap 3 is a one-line dep-array fix in `SVGAnnotationLayer.jsx` with a preferred event-delegation upgrade path. **Gap 2 should be deferred:** a 9-tool industry survey (Figma, tldraw, Excalidraw, Miro, Illustrator, Sketch, Inkscape, Nutrient, PSPDFKit) found **zero tools that relocate rotation handles**, and v2.1's typed-degree pill already addresses ~95% of the underlying pain.

Execution risk is low as long as the counter-session lane is respected. Gap 3 and Gap 4 (Fix A) touch only `SVGAnnotationLayer.jsx` and `SVGSelectionOverlay.jsx` — neither held by counter-session. Sequence: **Gap 3 first, then Gap 4, then verify against 113/113 tests before deciding on any Gap 2 work.**

---

## Contradiction Resolutions (Synthesizer Verdicts)

### Gap 4 fix strategy — VERDICT: Fix A / Architecture Option C (SVG-side structural fix)

Architecture and Pitfalls converge: keep SVG mtr handle visible during edit for pre-rotated shapes by modifying the `SVGAnnotationLayer.jsx:1050` short-circuit to return null only when `editIsBorderFlush && angle === 0`. Lane-safe (touches `SVGAnnotationLayer.jsx` + `SVGSelectionOverlay.jsx` only).

Features and Stack proposed Fabric-side fixes (`controlsAboveOverlay = true`, custom mtr Control with `offsetY: -20`) but both land in `FabricEditCanvas.jsx` — a **LANE CONFLICT** with the counter-session. These are documented as deferred fallbacks, gated on counter-session coordination.

### Gap 2 include/defer — VERDICT: DEFAULT DEFER

Features UX verdict is load-bearing: universal industry convention across 9 surveyed tools says "handles stay put." Architecture and Stack correctly assess Gap 2 as "architecturally clean" — it is, but clean math does not overcome a broken mental model.

**Recommendation:** Defer handle-relocation as `wontfix_superseded_by_typed_input`. If any Gap 2 work lands in v2.2, scope strictly to verifying/extending existing pill-clamp behavior in `rotationInputHelpers.js` — no handle movement, no new utility, no new SVGSelectionOverlay props.

### Gap 3 strategy — VERDICT: Strategy A acceptable, Strategy B preferred

Strategy A (add `editingAnnotationIndex` to dep array, with `!= null` early-return gate) is one line. Strategy B (event delegation on stable SVG ancestor via `e.target.closest('[data-rotation-handle="mtr"]')`) eliminates the entire class of stale-ref bugs. Start with Strategy A; upgrade to B only if a regression test reveals another unmount trigger. Both must gate on `editingAnnotationIndex == null` at effect-top.

---

## Suggested Phase Structure

### Phase A — Gap 3: Hover Pill Stale Ref Fix
- **Risk:** LOW. Single-file, fully independent.
- **Delivers:** Pill re-arms after any edit-mode exit without the deselect/reselect workaround.
- **Files:** `SVGAnnotationLayer.jsx` only
- **Avoids:** Dep-array expansion onto tick-rate values (`annotations`, `visualTransform`); MutationObserver; `querySelector` in render body

### Phase B — Gap 4: mtr Handle Visibility in Edit Mode
- **Risk:** MEDIUM. Requires live DOM diagnostic as first plan step before writing code.
- **Delivers:** Pre-rotated shapes show visible rotation handle on edit-mode entry (SVG layer, visual-only).
- **Files:** `SVGAnnotationLayer.jsx` (narrow `:1050` condition) + `SVGSelectionOverlay.jsx` (new `isEditing` prop, mtr-only rendering path)
- **Prerequisite:** Run live DOM diagnostic (`getBoundingClientRect + getComputedStyle` on ancestor chain) to confirm clipper identity before coding.
- **Avoids:** Touching `FabricEditCanvas.jsx`; deleting the SVG short-circuit; adding `snapAngle` or rotation interactivity

### Phase C (conditional) — Gap 2 Pill-Clamp Verification
- **Risk:** LOW (if scoped strictly to pill-clamp; high if expanded to handle-relocation)
- **Delivers:** Typed-degree pill stays reachable even when handle orbit is off-page.
- **Files:** `src/utils/rotationInputHelpers.js` + possibly `RotationInputField.jsx`
- **Close Gap 2 handle-relocation as `wontfix_superseded_by_typed_input` in RECONCILIATION.md.**
- **Only open if Gap 3 + Gap 4 code-complete and verified with ≥2 days slack.**

---

## Critical Pitfalls for Plan Authors

1. **Gap 4 `overflow: hidden` wild goose chase** — does not exist in FabricEditCanvas. Do live DOM diagnostic first.
2. **Gap 3 dep array expansion onto tick-rate values** — never add `annotations`, `visualTransform`. The `eslint-disable` at `:312` is load-bearing.
3. **Counter-session lane staging accident** — never `git add -A`. Explicit paths only. The 7 WIP files: `App.jsx`, `PageAnnotationLayer.jsx`, `FabricEditCanvas.jsx`, `useDatabase.js`, `counterNumbering.js`, `svgAnnotationRenderers.jsx`, `dist/index.html`.
4. **Gap 4 SVG short-circuit deletion** — narrow the `:1050` condition; never delete it. Deletion renders doubled handles.
5. **Gap 2 scope creep** — Plan 12-02 estimated 11 LOC, shipped 1,195 LOC. Same trap. Pill-clamp only.

---

## Counter-Session Lane Conflict Summary

**NEVER stage from v2.2 unless explicitly authorized:**
- `src/App.jsx`
- `src/components/PageAnnotationLayer.jsx`
- `src/components/FabricEditCanvas.jsx`
- `src/hooks/useDatabase.js`
- `src/utils/counterNumbering.js`
- `src/utils/svgAnnotationRenderers.jsx`
- `dist/index.html`

**Per-gap lane safety:**
- Gap 3 — touches `SVGAnnotationLayer.jsx` only. LANE-SAFE.
- Gap 4 Fix A (preferred) — touches `SVGAnnotationLayer.jsx` + `SVGSelectionOverlay.jsx`. LANE-SAFE.
- Gap 4 Fix B (fallback) — touches `FabricEditCanvas.jsx`. LANE CONFLICT, blocked until counter-session coordinates.
- Gap 2 pill-clamp — touches `rotationInputHelpers.js` + `RotationInputField.jsx`. LANE-SAFE.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Direct source inspection; zero new dependencies confirmed |
| Features | HIGH | 9-tool survey with direct behavioral observation |
| Architecture | HIGH | All options cited to specific file + line number; ranked by lane safety |
| Pitfalls | HIGH | Root causes confirmed by source inspection + `1.log` runtime evidence |

**Overall: HIGH**

**One unresolved gap:** Gap 4 clipper identity (canvas pixel buffer vs Syncfusion `e-pv-page-div` ancestor) cannot be determined without the live DOM diagnostic. This is the mandatory first step of the Gap 4 plan, not a research artifact.

---

## Ready for Roadmap

All 4 research files committed (`91eb0843`). Orchestrator can proceed to requirements definition using this synthesis. The roadmapper should structure v2.2 as **two mandatory plans (Gap 3, Gap 4) with Gap 2 deferred** per the Features UX verdict — or, if the user overrides, as **three plans with Gap 2 scoped strictly to pill-clamp verification only**.

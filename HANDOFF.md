# HANDOFF — Phase 12 gap bugs (bugs #1, #1b, #2, #2.5, #2.6, #3 shipped — only #4 remaining)

**Session:** 2026-04-13 (updated) · **Branch:** `post-v2.0/cleanup` · **Context at handoff:** ~40%

## Where we are

Plan 12-01 checkpoint remains OPEN. **Six** gap bugs shipped and user-verified. Only **bug #4** remains before 12-01 can close.

**Do NOT close Plan 12-01 or advance to Wave 2 (Plan 12-02 EDIT-12) until bug #4 is resolved and the user re-verifies the full 15-check manual checklist.**

## Commits landed

```
056dc1cf fix(12-01): bug #3 blue glow + line/arrow stroke + handle dampening
29a51a8b fix(12-01): fit-page/fit-height use pdf.js pageSize × calibrated Electron factor — bug #2.6
8b5d7ee5 chore(12-01): update handoff after bugs #2 + #2.5 ship
0d0c3218 fix(12-01): replace fitToPage() with direct zoomTo() — bug #2.5 v2
cd64c03d fix(12-01): skip pdf.js re-fit effect in Syncfusion mode — bug #2.5  (superseded by v2)
4839f1e3 fix(12-01): compute fit-height from live Syncfusion DOM — bug #2
3a3db09a fix(12-01): reconcile React scale from DOM at load — bug #1b
b77405f2 fix(12-01): live-update zoom input during deferred setScale (bug #1)
9b0c6f15 feat(12-01): wire snapAngleToNearest45 into rotate branch — EDIT-11
df43b0f2 feat(12-01): lower zoom floor 50%→10% — ZOOM-09 atomic 2-file commit
8ed6b703 test(12-01): add snapAngleToNearest45 helper + test scaffolds
```

All on `post-v2.0/cleanup`. 79/79 tests green.

## Bugs — status

| # | Status | Bug | File(s) | Risk |
|---|--------|-----|---------|------|
| 1 | ✅ `b77405f` | Zoom input display lag | `App.jsx:~12202` | — |
| 1b | ✅ `3a3db09` | Load-time React↔Syncfusion scale desync | `App.jsx` onDocumentLoad | — |
| 2 | ✅ `4839f1e` | Fit-height wrong calc | `App.jsx` FIT_HEIGHT | — |
| 2.5 | ✅ `0d0c3218` | Fit-page continuous-scroll cascade | `App.jsx` FIT_PAGE | — |
| **2.6** | ✅ `29a51a8b` | **Fit-page → 10% on first click + "click twice" UI-lag on all four modes** | `App.jsx` handleZoomModeSelect. Root cause: `viewer.getZoomValue()` LEADS the DOM re-layout — at the failing moment, getZoomValue=10 but pageDiv was still rendered at ~88%. Formula `pageDiv / (getZoomValue/100)` produced 14360-px "real" page → clamped to 10%. Also confirmed `magnification.zoomFactor` is undefined in this Syncfusion version. Bug #2.7 (click-twice UI lag) turned out to be an amplification of #2.6, not a separate bug. | — |
| **3** | ✅ `056dc1cf` | **Blue glow + line/arrow stroke + handle dampening** | Three codepaths: (a) `SVGSelectionOverlay.jsx` bbox → use `vector-effect="non-scaling-stroke"` instead of `* inverseScale` math; (b) `SVGAnnotationLayer.jsx` line/arrow hover highlight + endpoint handles bypass SVGSelectionOverlay entirely, same fix + removed buggy double-apply of `* inverseScale`; (c) `svgAnnotationRenderers.jsx` line/arrow annotation body — REMOVED `non-scaling-stroke` since `renderLine` already bakes scaleX/scaleY into coords, so a plain `strokeWidth` gives Fabric `strokeUniform` behavior for free AND lets strokes scale with viewBox zoom as annotation content should. Also dampened handle sizing with `Math.sqrt(inverseScale)` at user's request — linear 1:1 inverse scaling was too dramatic. | — |
| 4 | ⏳ NEXT | Edit-mode shape handles misaligned | `FabricEditCanvas.jsx` + `PageAnnotationLayer.jsx` + `SVGSelectionOverlay.jsx` | high, needs cross-file instrumentation — **earmark own `/clear` session** |

## Key insight (bug #2.6) — add to CLAUDE.md in cleanup pass

**`viewer.getZoomValue()` LEADS the DOM re-layout. `magnification.zoomFactor` is undefined in this Syncfusion version.** Any formula of the form `realPage = pageDiv / (getZoomValue/100)` is fundamentally broken during a zoom-in-flight window — at a failing moment, three sources give three different answers (API=10%, DOM=88%, React scale=100%).

**Fix pattern established:** derive real page dimensions from pdf.js `pageSizes[pageNum]` (scale-invariant, PDF points) × a one-time-calibrated Electron zoom factor. Never divide live pageDiv by getZoomValue(). Calibrate once on the first post-load scale change from a known-commanded scale, re-calibrate on each MANUAL/FIT_WIDTH/FIT_PAGE/FIT_HEIGHT call. Fallback factor=1.0 for the first uncalibrated click is non-catastrophic and self-heals.

Same class of root cause as the 2026-03-22 canvas sizing gotcha: **trust pdf.js point sizes + a calibrated factor, never trust live DOM measurements during a Syncfusion-commanded zoom transition.**

Bug #2.6 also added synchronous `setScale()` calls in all four zoom-mode branches, which incidentally eliminated the "click twice" UX — bug #2.7 was an amplification of #2.6 rather than a separate root cause. A diagnostic polling interval caught only initial-load Syncfusion transients during bug #2.6 diagnosis, no hidden code path.

## Key insight (bug #3) — add to CLAUDE.md in cleanup pass

**Fabric.js `strokeUniform: true` is NOT equivalent to SVG `vector-effect="non-scaling-stroke"`.** They mean different things and conflating them produces visible bugs:

- **Fabric `strokeUniform: true`** — stroke width does not scale with the object's own `scaleX/scaleY` during a resize drag. But the stroke DOES scale with canvas zoom, just like any other content in the canvas.
- **SVG `non-scaling-stroke`** — stroke width stays at fixed screen pixels regardless of ANY transform, including ancestor `viewBox` zoom.

When an SVG renderer bakes `scaleX/scaleY` into the emitted coordinates (rather than applying them as an SVG transform), a plain `strokeWidth` attribute already gives you Fabric `strokeUniform` behavior for free — the stroke doesn't react to object.scaleX/scaleY (desired) but does scale with viewBox zoom (also desired, since annotations are content that should visually shrink when the document shrinks). Adding `non-scaling-stroke` on top BREAKS the second half: strokes pin to screen pixels and look disproportionately bold at low zoom.

**Rule of thumb:** only use `non-scaling-stroke` on SVG elements that represent UI chrome (selection bboxes, handles) where you explicitly want them to stay at constant screen-pixel thickness. For annotation content, never use it — rely on the renderer baking scale into coords.

## First actions in next session

1. Read this file
2. Read `.planning/phases/12-shape-edit-polish/.continue-here.md`
3. Ask user: "All six gap bugs (#1–#3) are user-verified. Ready to start bug #4 (edit-mode shape handles misaligned)?"
4. Bug #4 — instrument handle positioning in `FabricEditCanvas.jsx`, have user repro clicking handles at <50% zoom, save console to `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/1.log`, diagnose from logs, ship minimal atomic fix.

After bug #4 clears → user re-runs the full 15-check manual checklist → write `12-01-SUMMARY.md` → advance `STATE.md` → start Wave 2 (Plan 12-02 EDIT-12 RotationInputField) → write `12-RECONCILIATION.md` before closing Phase 12.

## Environment

- Dev server: http://localhost:5173/ (PID 8990/8997 at session end — verify with `lsof -i:5173`)
- Test PDF: `Package 2 - Rev 4 -- IC.pdf`, page 6
- User preference: laymen's explanations, terse output, no emojis, one-bug-at-a-time, diagnostic logs over Kapture MCP
- Tests: `npm test` — 79/79 green baseline
- User is on Electron wrapper (Electron factor ~1.33 per bug #2.6 calibration)

## User's workflow rule (enforce for #3 and #4)

Per-bug loop:
1. Instrument aggressively (or use existing logs)
2. User reproduces, saves console to `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/1.log` (overwritten per bug)
3. Diagnose from logs
4. Ship minimal fix as own commit (remove instrumentation in same commit)
5. User verifies ONE thing, not fifteen
6. Next bug

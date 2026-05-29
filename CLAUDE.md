# Survey BetaSafeS2 — Claude Code Instructions

## Phase Discipline — ENFORCED

This project uses the global GSD phase discipline rules from `~/.claude/CLAUDE.md`
(PAUL-style acceptance criteria, DO NOT CHANGE boundaries, RECONCILIATION.md at
phase close). A SessionStart hook at `~/.claude/hooks/gsd-phase-discipline.py`
checks `.planning/phases/` and flags gaps.

When creating or editing a phase CONTEXT.md in this project, **always** include:

1. `## Acceptance Criteria` with Given/When/Then bullets
2. `## DO NOT CHANGE` with an explicit file allowlist (start from the "Always
   Protected" list below, then add phase-specific files)

Never close a phase without writing `<phase>/<phase>-RECONCILIATION.md`.

### High-Risk Files (handle with care; standing waiver granted 2026-04-29)

These files are load-bearing for v2.0 and remain high-risk. The user has granted
a standing waiver to edit them without per-edit approval — see
`memory/feedback_protected_files_waiver.md`. Treat them as high-risk: keep edits
small, scoped, and never refactor while you're in there. Always run `npm test`
after touching them and report baseline state before declaring done.

The Enforced Rules in the next section still bind regardless of the waiver:
container-aware canvas sizing, single-name fontFamily, `zoomGeneration` signal
contract, no JavaScript zoom coordination in `SVGAnnotationLayer.jsx`. Those are
not protection-list items — they are correctness invariants.

- `src/PDFViewer.jsx` — ~1.5MB / ~34k-line document viewer: the Syncfusion
  zoom/scale lifecycle, the per-page overlay portal render loop, save/sync, and
  the history engine. The single highest-risk file; minimum viable diff only.
- `src/viewerShared.js` — shared constants + helper functions imported by
  PDFViewer and AppShell. Renamed from the misleading `App.jsx` on 2026-05-29
  (it is NOT the app root and is not the 1.3MB monolith — that history belonged
  to the old pre-extraction App.jsx). Not fragile itself, but both big files
  import it, so run build + `npm test` after any change.
- `src/PageAnnotationLayer.jsx` — per-page Fabric.js canvas overlay
  (~10,097 lines). Only touch when actually needed for the current task.
  (The real file is `src/PageAnnotationLayer.jsx`. A dead 41-line stub at
  `src/components/PageAnnotationLayer.jsx` was deleted 2026-05-28 — do not
  recreate it.)
- `src/components/FabricDrawingCanvas.jsx` / `FabricEraserCanvas.jsx` /
  `FabricEditCanvas.jsx` — all use the `zoomGeneration` signal contract; do not
  remove or rename that signal.
- `src/components/SVGAnnotationLayer.jsx` — SVG viewBox owns all zoom scaling.
  Never reintroduce JavaScript zoom coordination here.
- `package.json` / `vite.config.js` — infra. Touch sparingly and document the why.

### Session Moments

Follow the PSMM logging rules in `~/.claude/CLAUDE.md`. Today's file is at
`~/.claude/projects/-Users-isaiahcalvo-Desktop-Survey-BetaSafeS2/memory/session-moments/YYYY-MM-DD.md`
and is auto-created at session start.

## CRITICAL — DO NOT BREAK (Enforced Rules)

- **Canvas sizing MUST use container-aware measurement, not pageSize * scale.** The Electron/browser zoom factor creates a mismatch. Always measure `containerEl.offsetWidth / pageSize.width` to get `effectiveScale`. This applies to FabricDrawingCanvas, FabricEraserCanvas, FabricEditCanvas, and any future Canvas component. See Gotchas section for details.

- **SVG viewBox handles all zoom scaling.** The old 5-timer zoom system (beginSyncfusionScaleConfirmPending, onScaleApplied, 300ms settle, freeze/snapshot/confirm-pending) was removed in Phase 11 of the v2.0 SVG Migration. SVG annotations scale via `viewBox="0 0 pageWidth pageHeight"` with zero JavaScript coordination. Canvas components (pen, eraser, edit) use `zoomGeneration` signal for auto-commit during zoom.

- **NEVER remove the zoomGeneration signal.** `setZoomGeneration(prev => prev + 1)` fires at zoom-start inside `beginSyncfusionScaleConfirmPending`. All mounted Canvas components (FabricDrawingCanvas, FabricEraserCanvas, FabricEditCanvas) watch this signal to auto-commit in-progress work before the container resizes.

## Gotchas & Lessons Learned

- **2026-05-13 — App-shell chrome publish effects must suppress identity-only API churn:** Lifting PDF chrome out of `PDFViewer` by publishing a large API object to App can create a maximum-update-depth loop if the effect calls an App `setState` every render. The left-rail lift hit this after moving `<PDFSidebar>` to `#chrome-left-host`. Fix: compare the next API against the previous one before returning a new state object, and treat function-only callback identity churn as unchanged; also no-op collapse notifications when the collapsed value is already current. This preserves current callbacks on real state/data changes without republishing on every render.

- **2026-04-10 — Canvas 2D and SVG path rasterizers produce visibly different strokes at non-integer sub-pixel coordinates — NOT fixable in JS:** When a shape in FabricEditCanvas appears "bolder" or "thicker" than the same shape in SVGAnnotationLayer during edit, this is not a code bug. Canvas 2D's `lineTo()` / `rect()` / `stroke()` anti-aliases edges at sub-pixel positions (e.g. `left=18.37`) across 2 pixels with a uniform gradient, producing a visually bolder result. The browser's SVG rasterizer handles the same coordinates via different heuristics and typically produces crisper single-pixel edges. Verified mathematically in Phase 11: all geometry deltas between SVG `getBoundingClientRect()` and Fabric's screen-space shape rect were sub-pixel (max 0.28px from stroke half-width bleed), with `backingRatio=2.0000` and `strokeUniform: true` honored everywhere. The inputs are identical — the rasterizers are different engines. If this ever becomes a UX problem, the fix is structural: hide the Fabric shape (`opacity: 0`) during edit and keep SVG visible as the visual truth, with Fabric only providing selection handles + hit zone. Do NOT chase this with pixel-snapping, DPR tweaks, or stroke-offset hacks — the hypothesis is mathematically confirmed.

- **2026-04-08 — Fabric.js Textbox fontFamily MUST be a single font name, never a CSS fallback stack:** Multi-font fallback stacks like `-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif` cause progressive cursor drift in Fabric.js Textbox/IText. Root cause: Fabric.js measures character widths at `CACHE_FONT_SIZE=400px` and scales down — the browser may resolve different fonts in the fallback chain at 400px vs the actual size, producing wrong measurements. Fix: use single-name fonts only (e.g. `"Helvetica"`, `"Arial"`, `"Times New Roman"`). This applies to DEFAULT_FONT_FAMILY in FabricEditCanvas.jsx and any future font picker — only offer single-name standard PDF fonts.

- **2026-03-22 — Canvas sizing must use container-aware measurement, not pageSize * scale:** The Electron/browser zoom factor creates a mismatch between the computed canvas size (`pageSize.width * syncfusionViewerScale`) and the actual Syncfusion page div size. At 50% PDF zoom with a 4/3 Electron zoom factor, the Syncfusion page div was 816x528 but the Fabric.js canvas was only 612x396, causing annotations to appear smaller and offset up-left. Fix: measure `containerEl.offsetWidth / pageSize.width` to get `effectiveScale` instead of trusting the Syncfusion-reported zoom percentage. Applied in PAL's canvas init (`PageAnnotationLayer.jsx:~5192`), direct resize path, and settle callback in the scale useEffect.

# Handoff: App.jsx breakup — dead code + Dashboard + App shell extracted

**Generated**: 2026-05-29
**Branch**: `main` — all work committed locally on `main`. Working tree: only `HANDOFF.md` modified. Not pushed (Isaiah pushes on his own cadence).
**Status**: 9 commits this session. **App.jsx 46,779 → 36,416 lines (−10,363, 22%).** Build green; `npm test` 834 pass / 0 fail / 6 skip throughout. Isaiah confirmed the extracted home screen renders fine on his dev server.

## Architecture now

The three big pieces live in separate files and can be edited by different agents without colliding:
- `src/AppShell.jsx` (~2,851) — application root: tabs, auth/entity state, chrome hosts, top-right zoom/page pill, Dashboard↔PDFViewer router. The entry point (`main.jsx`) and `DevTestRoute.jsx` import the default from here.
- `src/Dashboard.jsx` (~3,875) — home screen (project tree, document grid, template mgmt, SurveyHub host).
- `src/App.jsx` (~36,416) — now holds **PDFViewer (~34k lines)** + shared module helpers/constants, and exports `PDFViewer` + 10 shared symbols that AppShell imports. Dependency direction is one-way (App.jsx never imports AppShell), so no cycles.
- `src/SurveySpacesRail.jsx` (~2,969) — survey right rail (from a prior session).

## What happened this session (commits oldest→newest)

1. `3cb37412` removed dead `legacyHomeUI` block (~2,952 lines) + dead helper.
2. `37a0c9d1` extracted storage error helpers → `src/utils/storageErrors.js`.
3. `3b9089b3` removed now-dead `PDFThumbnail` + `thumbnailQueue`.
4. `db7d0438` removed orphaned `BottomToolbar` function + audit comment.
5. `ddc8544e` removed 8 unreferenced helper functions.
6. `9a9f1a41` extracted `Dashboard` → `src/Dashboard.jsx`.
7. `85b8ba71` extracted the App shell → `src/AppShell.jsx`.
8. `09ca000c` dropped 23 imports orphaned by the Dashboard/AppShell lifts.
(Steps 1, 3, 4, 5 were dead code from the 2026-05-13 chrome-lift / right-rail refactor, which inlined component rendering into the App shell and left the original functions orphaned.)

## Reusable tooling (built this session — use for every future extraction)

- `scripts/check-undef.mjs <file>` — prints every identifier a file leaves unresolved (Babel scope.globals). Method: capture the known-good monolith's unresolved set as a baseline, then assert an extracted module introduces ZERO unresolved identifiers outside it. **Compare with a Python set-diff, not shell `comm`** (comm mis-sorts case → false positives).
- `scripts/derive-slice-deps.mjs <startLine> <endLine>` — reconstructs the exact import statements + App.jsx module-symbol deps a slice needs (flags which module symbols are also used outside the slice → export vs move). Derive deps mechanically; don't trust an analysis agent's prose (the mapping agent mis-reported deps this session).

## Recommended next step — break up PDFViewer (own session)

PDFViewer (~34k lines, still in App.jsx) is the last parallel-work bottleneck. Start with the LOW-RISK render-tree extractions, each its own commit, verified with check-undef + build + test:
- `LocateModal` (a file already exists — validate/consolidate), the annotation context-menu portal, and the ExcelOneDrive modal cluster. These are presentational, prop-driven JSX blocks inside PDFViewer's render — lifting them shrinks PDFViewer without touching the engine.
- Then the undo/redo engine → `src/hooks/useAnnotationHistory.js` (medium risk).

A full verbatim move of PDFViewer into `src/PDFViewer.jsx` is possible later (App.jsx would shrink to just shared constants), but it has the largest dependency surface — do the smaller extractions first.

## Warnings / invariants (unchanged, still law)

- **NO-GO zones inside PDFViewer**: the zoom/scale lifecycle and the per-page Syncfusion overlay portal render loop. Never extract or refactor these.
- The four invariants in `CLAUDE.md` (container-aware canvas sizing, SVG viewBox owns zoom, never remove the `zoomGeneration` signal, single-name Fabric `fontFamily`) remain correctness law. The identity-churn guard on API-publisher effects must stay verbatim (now in AppShell.jsx).
- No automated test renders PDFViewer/Dashboard/AppShell — build + check-undef + tests cover *static* correctness; runtime/visual changes still want a dev-server look.
- Don't trust "component X is rendered" claims — grep for real JSX/call sites first.
- A few partial imports in App.jsx still have unused specifiers (react's forwardRef/useImperativeHandle, etc.) — harmless, optional cleanup.

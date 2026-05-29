# Handoff: App.jsx breakup — monolith split into four files (95% reduction)

**Generated**: 2026-05-29
**Branch**: `main` — everything below is committed locally on `main`. Working tree: only `HANDOFF.md` modified. Nothing pushed (Isaiah pushes on his own cadence).
**Status**: **`src/App.jsx` went from 46,779 → 2,359 lines this session (95% reduction).** Build green; `npm test` = 834 pass / 0 fail / 6 skip. The home screen was verified rendering on Isaiah's dev server; the viewer move is verified statically + build + tests but still wants a dev-server look.

## How to start (read this, then you have full context — no need to re-explore)

The giant `src/App.jsx` has been broken into separate files so multiple agents can work in parallel without colliding. The pieces:

- `src/AppShell.jsx` (~2,852) — application root: tabs, auth/entity state, chrome host divs, top-right zoom/page pill, and the router between the home screen and the viewer. **This is the entry component** — `src/main.jsx` and `src/DevTestRoute.jsx` import the default from here.
- `src/PDFViewer.jsx` (~34,289) — the document viewer: Syncfusion canvas, annotation overlays, zoom/scroll lifecycle, save/sync, history. The bulk of the app.
- `src/Dashboard.jsx` (~3,875) — the home screen (project tree, document grid, template management, SurveyHub host).
- `src/App.jsx` (~2,359) — **no longer the app**; now just shared module helpers/constants that the viewer + shell import. It is a misnamed grab-bag (rename/split candidate — see next steps).
- `src/SurveySpacesRail.jsx` (~2,969) — survey right rail (from an earlier session).

Import direction is one-way: `AppShell → {PDFViewer, Dashboard, App}` and `PDFViewer → App`. App.jsx imports neither PDFViewer nor AppShell, so there are no cycles.

## Reusable tooling (built this session — USE IT for every future extraction)

- `scripts/check-undef.mjs <file>` — prints every identifier a file leaves unresolved (Babel scope.globals). Method: capture a known-good file's unresolved set as a baseline, extract, then assert the new/changed files introduce ZERO unresolved identifiers outside that baseline. **Diff with a Python set, not shell `comm`** (comm mis-sorts case → false positives).
- `scripts/derive-slice-deps.mjs <startLine> <endLine>` — reconstructs the exact import statements + App.jsx module-symbol deps a slice needs. Derive deps mechanically; don't trust prose analysis (the original mapping agent mis-reported deps repeatedly this session).

## What was done (8 refactor commits, oldest→newest)

1. removed dead `legacyHomeUI` block (~2,952 lines) + dead helper.
2. extracted storage error helpers → `src/utils/storageErrors.js`.
3. removed now-dead `PDFThumbnail` + `thumbnailQueue`.
4. removed orphaned `BottomToolbar` function + audit comment.
5. removed 8 unreferenced helper functions.
6. extracted `Dashboard` → `src/Dashboard.jsx`.
7. extracted the App shell → `src/AppShell.jsx`; dropped 23 orphaned imports.
8. extracted `PDFViewer` → `src/PDFViewer.jsx` (the big one); repointed 7 source-guard tests.

Steps 1, 3, 4, 5 were dead code orphaned by the 2026-05-13 chrome-lift / right-rail refactor (it inlined component rendering into the App shell and left the original functions unused).

## Recommended next steps (all smaller / lower-risk now)

1. **Rename/clean `src/App.jsx`** — it's now just shared helpers/constants, not "the app". Consider renaming to something like `src/viewerShared.js` (or splitting into `constants/` + `utils/`) and updating the imports in PDFViewer.jsx / AppShell.jsx. Mechanical; verify with check-undef + build + test.
2. **Delete the dead `src/components/LocateModal.jsx`** — it exists but is imported nowhere; the live Locate dialog is inline JSX inside PDFViewer.jsx. (It's someone's earlier WIP — confirm with Isaiah before deleting, or extract the inline one into it.)
3. **Break up PDFViewer internally** (its own effort) — lift the undo/redo engine into `src/hooks/useAnnotationHistory.js`, then other cohesive hooks. Each verified with check-undef + build + test. The render-tree dialogs (Excel/OneDrive) are ALREADY their own components.
4. A few partial imports in App.jsx have unused specifiers (react's forwardRef/useImperativeHandle, etc.) — harmless, optional.

## Warnings / invariants (still law)

- **NO-GO zones inside PDFViewer.jsx**: the zoom/scale lifecycle and the per-page Syncfusion overlay portal render loop. Never refactor these (relocating the whole file was fine; rewriting the zoom engine is not).
- The four invariants in `CLAUDE.md` (container-aware canvas sizing, SVG viewBox owns zoom, never remove the `zoomGeneration` signal, single-name Fabric `fontFamily`) remain correctness law. The identity-churn guard on API-publisher effects must stay verbatim (lives in AppShell.jsx).
- **No automated test renders the viewer/home/shell** — build + check-undef + the source-guard tests cover *static* correctness; behavioral/visual changes still want a dev-server look (`npm run dev`, logged-in account).
- **Source-guard tests**: several tests scan source files for required patterns. If you move code, repoint the guard to read the new file (the pattern: read `App.jsx` + the new file concatenated). 7 such tests were repointed this session.
- Don't trust "component X is rendered" claims — grep for real JSX/call sites first. Several "extractions" this session were actually dead code.
- `src/App.jsx` and `src/PDFViewer.jsx` are high-risk; minimum-viable diffs, `npm test` after every touch.

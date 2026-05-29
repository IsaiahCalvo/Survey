# Handoff: App.jsx breakup — dead-code purge + Dashboard extracted

**Generated**: 2026-05-29
**Branch**: `main` — all work below is committed locally on `main`. Working tree: only `HANDOFF.md` modified. Not pushed (Isaiah pushes on his own cadence).
**Status**: 7 commits this session. App.jsx shrank from **46,779 → 39,271 lines** (−7,508, ~16%, first time under 40k). Build green; `npm test` 834 pass / 0 fail / 6 skip throughout.

## What happened this session

Goal: keep chipping away at `src/App.jsx` and make the codebase optimal for future multi-agent parallel work. A 6-agent mapping workflow produced a risk-rated breakup roadmap; then I executed the lowest-risk steps, verifying build + test after each.

Commits (oldest first), each its own verified change:
1. `3cb37412` — removed dead `legacyHomeUI` block (~2,952 lines, never rendered, `void legacyHomeUI`) + dead `getToolFromSyncfusionMarkupType`.
2. `37a0c9d1` — extracted `isStorageFileNotFoundError` / `isSupabaseRowNotFoundError` to **`src/utils/storageErrors.js`**.
3. `3b9089b3` — removed now-dead `PDFThumbnail` + `thumbnailQueue` (all render sites were inside the deleted legacyHomeUI block; live home uses `src/home/PdfPageThumb.jsx`).
4. `db7d0438` — removed orphaned `BottomToolbar(props)` + its audit comment (the 2026-05-13 chrome lift moved toolbar rendering into inline App-shell JSX reading `bottomToolbarApi`; the function had zero call sites).
5. `ddc8544e` — removed 8 unreferenced helper functions (hexToRgb, getHexFromAnnotationColor, getOpacityFromAnnotationColor, rgbToHsl, hslToRgb, generateColorSwatches, getCategoryItems, getCategoryChecklist).
6. `9a9f1a41` — **extracted `Dashboard` (~3,775 lines) into `src/Dashboard.jsx`**, wired via `import Dashboard from './Dashboard'`. Also added the reusable checker `scripts/check-undef.mjs`.

## Key tool: `scripts/check-undef.mjs`

Scope-aware "unresolved identifier" checker (uses `@babel/parser` + `@babel/traverse`, already installed). `node scripts/check-undef.mjs <file>` prints every identifier the file leaves unresolved. **Extraction-safety method**: capture the known-good monolith's unresolved set as a baseline, then assert an extracted module introduces ZERO unresolved identifiers outside that baseline (compare via Python set-diff, NOT shell `comm` — it mis-sorts case). This is how the Dashboard move was verified faithful without running the app. Use it for every future extraction.

## IMPORTANT — verify Dashboard on the dev server

Every commit 1–5 was provably safe (removing unreferenced code can't change behavior; build + test sufficed). **Commit 6 (Dashboard) is different**: no automated test renders Dashboard, so build + test + the undef-checker cover the move's *static* risk but NOT runtime. Please run `npm run dev` with a logged-in account and confirm the home screen renders normally: project tree, document grid, PDF thumbnails, template editor opens, SurveyHub, upload flow. The static checker showed the move introduces zero new unresolved refs, so it *should* be clean — but a human look is the final gate before building on top of it.

## Recommended next step

After Dashboard is confirmed on the dev server: **extract the App shell (step 8, ~2,818 lines) into `src/AppShell.jsx`** — rename the default-export `App` to `AppShell`, move it out, and make `src/App.jsx` a thin file that imports + re-exports it (keeps the Vite entry point unchanged). Medium risk: the shell renders the top-right zoom pill that reads `bottomToolbarApi`, and the **2026-05-13 identity-churn guard** on the API publisher effects must be preserved verbatim (dropping it causes max-update-depth loops). Use `check-undef.mjs` to verify.

Then the PDFViewer render-tree extractions (parallel-safe, low risk): `LocateModal` (already a file — validate/consolidate), the annotation context-menu portal, and the ExcelOneDrive modal cluster. Larger/medium: lift the undo/redo engine into `src/hooks/useAnnotationHistory.js`.

## Warnings / invariants (unchanged, still law)

- **NO-GO zones inside PDFViewer**: the zoom/scale lifecycle and the per-page Syncfusion overlay portal render loop. Never extract or refactor these.
- The four invariants in `CLAUDE.md` (container-aware canvas sizing, SVG viewBox owns zoom, never remove the `zoomGeneration` signal, single-name Fabric `fontFamily`) remain correctness law.
- `src/App.jsx` and `src/Dashboard.jsx` are high-risk; minimum-viable diffs, `npm test` after every touch.
- Don't trust "component X is rendered" claims — grep for real JSX/call sites first. Several planned "extractions" this session turned out to be dead code (the chrome-lift refactor orphaned them).

# Phase 14 Deferred Items

Out-of-scope discoveries logged per Plan 14-01 scope boundary rule. These
are pre-existing working-tree modifications or unrelated test failures that
Plan 14-01 deliberately does NOT fix.

---

## Plan 14-01 discoveries (2026-04-15)

### 1. `src/utils/pdfAnnotationImporter.js` pre-existing dirty-state regression

- **Found:** 2026-04-15 during Plan 14-01 Task 3 verification run
- **Test:** `tests/pdfAnnotationImporter.test.mjs:228` —
  "convertPdfAnnotationToFabric preserves line endings and callout metadata
  for line annotations"
- **Failure:** Expected `strokeDashArray: [4, 2]`, got `undefined`
- **Root cause:** `src/utils/pdfAnnotationImporter.js` carries uncommitted
  modifications at session start (`M` in git status). When the local changes
  are stashed, the test passes against clean HEAD.
- **Scope boundary:** Plan 14-01 touches only renderer + adapter + tests +
  `Callout/types.js`. `pdfAnnotationImporter.js` is OUT OF SCOPE.
- **Ownership:** Whoever left the working tree dirty (likely a prior
  counter-session or an earlier Phase 13 / Phase 12 bug bash).
- **Action:** Do NOT fix in Plan 14-01. Document here and continue. A
  separate cleanup phase or commit can address the importer regression.

### 2. Other pre-existing dirty-state files (not touched by Plan 14-01)

Reported by `git status` at session start:

- `dist/index.html` — build output
- `src/App.jsx` — always-protected, no waiver for Plan 14-01
- `src/components/FabricEraserCanvas.jsx` — always-protected
- `src/components/SVGAnnotationLayer.jsx` — 14-02/14-03 lane, not 14-01
- `src/electron-main.js` — unrelated
- `src/preload.js` — unrelated
- `src/utils/svgBoundingBox.js` — unrelated
- `src/utils/svgAnnotationRenderers.jsx` — owned by Plan 14-01 (edit expected)

All of the above except `svgAnnotationRenderers.jsx` are logged here as
pre-existing and are NOT touched by Plan 14-01.

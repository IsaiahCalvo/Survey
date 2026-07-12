# Survey BetaSafeS2 — Agent Instructions (Codex / non-Claude agents)

Distilled from CLAUDE.md 2026-07-10 (Claude-specific hook/memory sections omitted — do not
assume `~/.claude` loads for you). Full history and gotchas live in CLAUDE.md if you need depth.

## Correctness invariants — DO NOT BREAK

- **Canvas sizing uses container-aware measurement, never `pageSize * scale`.** Measure
  `containerEl.offsetWidth / pageSize.width` for `effectiveScale` (Electron/browser zoom factor
  mismatch). Applies to FabricDrawingCanvas, FabricEraserCanvas, FabricEditCanvas, and any
  future canvas component.
- **SVG viewBox owns all zoom scaling.** Never reintroduce JavaScript zoom coordination in
  `src/components/SVGAnnotationLayer.jsx`.
- **Never remove or rename the `zoomGeneration` signal** — all mounted canvas components watch
  it to auto-commit in-progress work at zoom start.
- **Fabric.js Textbox `fontFamily` must be a single font name** (e.g. `"Helvetica"`), never a
  CSS fallback stack — stacks cause progressive cursor drift.
- **Edge-function CORS `Access-Control-Allow-Origin: '*'` is INTENTIONAL — do not tighten.**
  One bundle serves web, Electron (`file://`), and Capacitor origins; auth is Bearer-JWT, so
  the wildcard is non-exploitable. Investigated + closed 2026-07-05.

## High-risk files (minimum viable diff; never refactor in passing)

- `src/PDFViewer.jsx` (~34k lines — viewer lifecycle, save/sync, history engine; highest risk)
- `src/PageAnnotationLayer.jsx` (~10k lines — per-page Fabric.js overlay)
- `src/components/FabricDrawingCanvas.jsx` / `FabricEraserCanvas.jsx` / `FabricEditCanvas.jsx`
  (all use `zoomGeneration`)
- `src/viewerShared.js` (imported by both big files — run build + tests after any change)
- `package.json` / `vite.config.js` (infra — document the why)

## Required verification

- Run `npm test` after touching any high-risk file; report baseline state before declaring done.
- Gate deletions and risky changes behind `npx vite build` + `node scripts/run-node-tests.mjs`.
- Verify user-visible changes in the running app before calling them done.

## Codebase navigation (graphify)

- For codebase questions run `graphify query "<question>"` first (graphify-out/graph.json
  exists); `graphify path "<A>" "<B>"` for relationships, `graphify explain "<concept>"` for
  concepts. Read graphify-out/GRAPH_REPORT.md only for broad architecture review.
- After modifying code, run `graphify update .` (AST-only, no API cost).

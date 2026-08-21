# Desktop Pages Move up / Move down

**Date:** 2026-08-21  
**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Goal:** stays open

Did **not** replay wave 11 rotate-ccw, wave 10 insert-blank, leftover **18**, or official `npm test`.  
No prod SQL. Cap **8448** / **75/250** not loosened. No secrets. No `.bot-credentials.json` / `.env*`.

`ba4ef0e5` exposed desktop Pages **Move up / Move down** (was `mobileMode`-only), gated by P1-43 `canReorderPages`. That pair was **not** in the wave 11 spec.

## Live prove

Vite already on `http://localhost:5173` (HTTP 200). Reused; not killed.

```bash
node --test tests/pdfViewerUndoOneLiners.test.mjs
# 12 / 12

npx playwright test --config debug/playwright.reuse-5173.config.mjs \
  debug/scenarios/e2e-pages-move-up-down.spec.mjs
```

**Live: 1 / 1 passed (6.2s).**  
Fixture: `?testPdf=text-search-glyph-lab.pdf` (3 native letter pages).

| Hunt | Verdict | Live proof |
|---|---|---|
| **Intended** — middle page Move up remaps annots; export order matches | **pass** | Page-2 rect remapped to page 1. Page-3 ellipse stayed. Export `[Square], [], [Circle]`. |
| **Break** — first-page Move up / last-page Move down disabled; force-click no-op | **pass** | `firstMenu { moveUp: true, moveDown: false }`. `lastMenu { moveUp: false, moveDown: true }`. Page count stayed 3. |
| **Break** — assigned-region subset fails `canReorderPages`; items no-op | **pass** | Space pages `1, 3` (`regionGate: false`). Both Move items disabled. Force Move down left sidebar `[1, 3]`. Store kept rect@1 / ellipse@3. |
| **Edge** — undo after move | **pass** | Undo disabled immediately after move (structure wipe). Post-move line undone; remapped Square/Circle stayed. Export after undo identical. |
| **Edge** — Escape dismisses without moving | **pass** | Menu offered Move up/down; Escape; still 3 pages. |

`PAGES_MOVE_UP_DOWN` log: rect `f950011d-…`, ellipse `abd190cb-…`, line `b77ab709-…`.  
`leftover18: unchanged`.

Isolated `tests/pdfViewerUndoOneLiners.test.mjs` **12 / 12**. Did **not** run official `npm test` (brief).  
`graphify` CLI was not on PATH (`graphify-out/graph.json` still present); no graph refresh this pass.

## Product min-diff

`src/PDFViewer.jsx` (tiny; high-risk)

- `commitPageStructureState` already cleared React `undoHistory` / `redoHistory`. Local-lane refs (`localAnnotationUndoRef` / `localAnnotationRedoRef`) and the parallel legacy refs were **not** wiped, so a post-move Undo could invert a pre-move create against remapped addresses.
- Wipe those same lanes a document switch already wipes; bump `localAnnotationHistoryVersion`.
- DEV `__phase35GetAnnotationById` fills `pageNumber` from the by-page key when the object omits it (key is address truth).

`tests/pdfViewerUndoOneLiners.test.mjs` — source-wiring asserts on the local-lane wipe.

Not edited: `PagesPanel.jsx` (Move up/down + `canReorderPages` already from `ba4ef0e5`), `PageAnnotationLayer.jsx`, `FabricEraserCanvas.jsx`, `SVGAnnotationLayer.jsx`, `viewerShared.js`, `package.json`, `vite.config.js`.

### Invariants (re-grepped)

| Invariant | Holds? |
|---|---|
| `zoomGeneration` / `setZoomGeneration` | yes — `PDFViewer.jsx` |
| SVG `viewBox={`0 0 ${width} ${height}`}` | yes — `SVGAnnotationLayer.jsx` |
| Container-aware canvas / single-name fontFamily / CORS `*` | untouched this pass |

## Leftover 18 — unchanged

Not retried. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

## Spec

`debug/scenarios/e2e-pages-move-up-down.spec.mjs`

Not a replay of `debug/scenarios/e2e-adversarial-wave11.spec.mjs` (rotate-ccw) or wave 10 insert-blank.

## Goal

Stays **open**.

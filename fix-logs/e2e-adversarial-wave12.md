# E2E adversarial wave 12 — History delete-restore + jump-to-page

**Date:** 2026-08-21  
**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Goal:** stays open

Did **not** replay Move up/down, wave 11 rotate-ccw, wave 10 insert-blank, leftover **18**, or official `npm test`.  
No prod SQL. Cap **8448** / **75/250** not loosened. No secrets. No `.bot-credentials.json` / `.env*`.

Sibling page-structure hunt found **zero** leftover local-lane misses (`fix-logs/page-structure-undo-siblings.md`). Wave 12 is a **new** unused surface: History delete-restore + jump-to-page on `?testPdf=` (W4-03 remaining risk). Not pages menu, not flatten, not survey-marker. Not a replay of W4-03 button/empty/activity-list.

## How

Vite already serving `http://localhost:5173` (HTTP 200). Reused; not killed.

```bash
npx playwright test --config debug/playwright.reuse-5173.config.mjs \
  debug/scenarios/e2e-adversarial-wave12.spec.mjs
```

**Live: 1 / 1 passed (6.3s).**  
Fixture: `?testPdf=text-search-glyph-lab.pdf` (3 native letter pages).

`W12_HISTORY_RESTORE_JUMP`: rect `e58da2ba-…`, ellipse `93163b0c-…`, `restoreAfterCreate: 0`.  
`leftover18: unchanged`.

## Verdicts

| Hunt | Verdict | Live proof |
|---|---|---|
| **Break** — empty History | **pass** | "No history yet…". 0 Restore buttons. Footer: "Only the document owner can save or restore versions." |
| **Break** — create/edit rows | **pass** | After page-2 rect + page-3 ellipse, History listed creates. Restore count stayed **0**. |
| **Intended** — delete → Restore on same page | **pass** | Context-menu Delete of page-2 rect. Restore offered ("deleted a rectangle on page 2"). Rect returned on page 2. Ellipse stayed on page 3. No clone on page 1. |
| **Intended** — jump-to-page | **pass** | From page 1, clicking the delete row landed on page 2. |
| **Edge** — second Restore no clone | **pass** | Second Restore left one rect on page 2; none on page 3. |
| **Edge** — Undo after restore | **pass** | Page-3 ellipse stayed on page 3. Rect did not invert onto page 1 or 3. `file.id` stayed `null`. |

## Product fix

**None.** Restore + jump already worked on this route. High-risk files **not** edited: `PDFViewer.jsx`, `PageAnnotationLayer.jsx`, `FabricEraserCanvas.jsx`, `SVGAnnotationLayer.jsx`, `viewerShared.js`, `package.json`, `vite.config.js`.

### Invariants (re-grepped)

| Invariant | Holds? |
|---|---|
| `zoomGeneration` / `setZoomGeneration` | yes — `PDFViewer.jsx` |
| SVG `viewBox={`0 0 ${width} ${height}`}` | yes — `SVGAnnotationLayer.jsx` |
| Container-aware canvas / single-name fontFamily / CORS `*` | untouched this pass |

Named cloud Save/Restore were **not** claimed (owner-gated; no forged `file.id`).

## Leftover 18 — unchanged

Not retried. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

## Spec

`debug/scenarios/e2e-adversarial-wave12.spec.mjs`

## Goal

Stays **open**.

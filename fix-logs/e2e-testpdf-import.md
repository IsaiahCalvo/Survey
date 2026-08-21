# E2E testPdf annotated-fixture import

**Date:** 2026-08-21  
**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Goal:** stays open

Did **not** retry leftover 18 or Electron native File→Open (`UL-03`).  
Did **not** invent a guest hub importer. Hub web upload stays leftover-gated (`A-01` / `X-05`).  
No prod SQL. No budget loosen. No secrets. No `.bot-credentials.json` / `.env*`.

## Path

Unblocked DEV fixture loader only:

`http://localhost:5173/?testPdf=kal412-mixed-import-e2e.pdf`

Fixture exists on disk (`debug/fixtures/kal412-mixed-import-e2e.pdf`) — mixed native annots (Square / Ink / Stamp / Redact; one skipped invisible Square). Served by Vite `/debug-fixtures/`.

## How

Vite already serving `http://localhost:5173` (HTTP 200). Reused; not killed.

```bash
npx playwright test --config debug/playwright.reuse-5173.config.mjs \
  debug/scenarios/e2e-testpdf-import.spec.mjs
```

Live result pending this commit.

## Verdicts

| Hunt | What | Verdict | Live proof |
|---|---|---|---|
| **Intended** | `?testPdf=kal412-mixed-import-e2e.pdf` loads editor; imported annots (or flattened natives) countable | pending | — |
| **Break** | `?testPdf=does-not-exist.pdf` fails closed | pending | DevTestRoute 404 → “Failed to load test PDF”; no ErrorBoundary |
| **Edge** | After load, draw one rectangle; imported ids/count survive | pending | — |

## Product fix

None yet. High-risk files **not** edited: `PDFViewer.jsx`, `PageAnnotationLayer.jsx`, `FabricEraserCanvas.jsx`, `SVGAnnotationLayer.jsx`, `viewerShared.js`, `package.json`, `vite.config.js`.

Invariants held: `zoomGeneration`, SVG `viewBox`, container-aware canvas sizing, single-name `fontFamily`, CORS `Access-Control-Allow-Origin: '*'`.

## Leftover 18 — unchanged

Not replayed. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

Crossing-cuts allocation leftover unchanged. Cap not loosened.

## Spec

`debug/scenarios/e2e-testpdf-import.spec.mjs`

## Goal

Stays **open**.

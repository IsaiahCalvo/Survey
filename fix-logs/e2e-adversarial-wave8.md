# E2E adversarial wave 8 — restored surfaces

**Date:** 2026-08-21  
**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Goal:** stays open

Did **not** replay wave7, the 12+13 live-prove specs, leftover 18, or official `npm test`.  
No prod SQL. No budget loosen. No secrets. No `.bot-credentials.json` / `.env*`.

## How

Vite already serving `http://localhost:5173` (HTTP 200). Reused; not killed.

```bash
npx playwright test --config debug/playwright.reuse-5173.config.mjs \
  debug/scenarios/e2e-adversarial-wave8.spec.mjs
```

**Live: 5 / 5 passed (17.8s)** after spec tightens + one product fix.

`?testPdf=clickable-link-test.pdf`. Each cluster: intended + break + edge.

## Product fix

**`src/utils/pdfAnnotationsPdfLib.js` (min-diff, not a high-risk file)**

P1-01 group flatten already offsets only `left`/`top` so `getLineEndpoints` is world-correct. Export (`createLineAnnotation`) and print flatten (`drawFlattenedLine`) still stroked raw center-relative `x1`/`y1`. A fabric line at `(100,100)→(150,140)` stored `x1=-25`; `/L` and the print stroke landed near the origin. After a group parent move, that is a miss, not a double-offset.

Fix: both writers call `getLineEndpoints`. Callout leaders pass world `x1..y2` with no `left`/`width` — center is 0, so they stay byte-identical.

High-risk files **not** edited: `PDFViewer.jsx`, `PageAnnotationLayer.jsx`, `FabricEraserCanvas.jsx`, `SVGAnnotationLayer.jsx`, `viewerShared.js`, `package.json`, `vite.config.js`.

Invariants held: `zoomGeneration`, SVG `viewBox`, container-aware canvas sizing, single-name `fontFamily`, CORS `Access-Control-Allow-Origin: '*'`.

## Verdicts

| Cluster | Hunt | Verdict | Live proof |
|---|---|---|---|
| **1** | Export flatten: grouped line + move; no double-offset | **pass** (product fix) | Live line export `/L` = world `(122.4, 570.2)` not raw `x1=-79.6` and not `x1+left=42.8`. Vite group child after parent `+40,+30`: world `(140,130)` → `/L [140 662 190 622]`. Double-offset would be `x1=180`. |
| **2** | Print/cloud Square `/BE` vs plain; scaled print size | **pass** | Live export: cloud Square keeps `/BE << /S /C /I 2 >>`; plain Square `be: null`. Print flatten of Fabric group line starts at device `(140, 662)` not double-offset `(180, …)` and not raw `x1=-25`. Scaled plain `60×40` × `(2, 1.5)` prints as path `120 60 l` (pdf-lib uses `cm`+path, not `re`). Cloud flatten emits scallop path. |
| **3** | Callout Shift union / Alt subtract then undo; stale-id after delete | **pass** | Two callouts survive Shift-marquee union then Alt-subtract. Delete B: DOM gone; `resolveAnnotationIndexById(…, B, 0) === -1` (does not fall back to index 0). Undo restores B; A stays. Remap of gone id clears. No error boundary. |
| **4** | Counter renumber after delete + page move; empty page bucket | **pass** | Pins 1–3 on page 1; delete #1 → `[1, 2]`. Drop on page 2 becomes `#3`. Delete page-1 `#1` → remaining `[1, 2]` across pages. Vite-import: empty page bucket `===`; ink-only page `===`; changed counters cloned; `transformPageState` move keeps counters; `null` / `{}` fail-closed. |
| **5** | zoomGeneration mid-callout / mid-export | **pass** | Callout is drag-out (not freehand): zoom mid-drag keeps tracking; callout commits. Export click then Zoom-in still finishes the download; line survives Fit page. No crash. |

## Leftover 18 — unchanged

Not replayed. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

Crossing-cuts allocation leftover unchanged. Cap not loosened.

## Spec

`debug/scenarios/e2e-adversarial-wave8.spec.mjs`

## Goal

Stays **open**.

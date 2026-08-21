# E2E survey-marker — live prove on `?testPdf=`

**Date:** 2026-08-21  
**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Goal:** stays open

Did **not** replay wave9, leftover 18, or official `npm test`.  
No prod SQL. No budget loosen. No secrets. No `.bot-credentials.json` / `.env*`.

Wave 9 covered 10 drawables (pen, highlighter, rect, ellipse, line, arrow, text, callout, counter, form widget) but **not** survey-markers. Stamp worker listed survey-marker as a `?testPdf=` toolbar tool (`survey` category).

## How

Vite already serving `http://localhost:5173` (HTTP 200). Reused; not killed.

```bash
npx playwright test --config debug/playwright.reuse-5173.config.mjs \
  debug/scenarios/e2e-survey-marker.spec.mjs
```

**Live: 1 / 1 passed (38.1s).**

`?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1` — KAL-436 Preservation Template + Walls category (same harness as wave4 / D-02).

## Product fix

**None.** Placement, persist, export exclusion, and regular-print exclusion already match the product contract. High-risk files **not** edited: `PDFViewer.jsx`, `PageAnnotationLayer.jsx`, `FabricEraserCanvas.jsx`, `SVGAnnotationLayer.jsx`, `viewerShared.js`, `package.json`, `vite.config.js`.

Invariants held: `zoomGeneration`, SVG `viewBox`, container-aware canvas sizing, single-name `fontFamily`, CORS `Access-Control-Allow-Origin: '*'`.

## Verdicts

| Hunt | Verdict | Live proof |
|---|---|---|
| **Intended** — place a marker; it persists; export/print match product | **pass** | Marker `surveyMarker-c31a682a-17d4-4e39-a502-fade5a8f597d` stayed on `[data-survey-marker-id]`. UI export annots **matched fixture natives** (`/Widget`×2, `/Link`, `/Squiggly`, `/StrikeOut`, `/Underline`, `/PolyLine`, `/Square`×2, `/Polygon`, `/Ink`). No `/SurveyMarker`, no extra `/Square` or `/Highlight`. Regular print flatten (`Ctrl+Shift+P`) diagnostics `excluded.surveyMarkers: 1`. |
| **Break** — cancel placement / click with no commit | **pass** | Walls armed: click-no-drag did not open the name prompt and did not add a marker. Escape → Selection (`v`) → click is a no-op. Create path requires `width > 2 && height > 2` (`SVGAnnotationLayer` `survey-marker:create`). |
| **Edge** — two markers; undo one; draw a rect without wiping markers | **pass** | Second `surveyMarker-73646583-c78f-4422-91a3-a85c1af5426d` committed. Undo dropped the second; first remained. Rectangle `18a7402d-4bf4-4f23-9dd7-82cf15447c70` committed; first marker still on the page; undone marker stayed gone. |

Print/export contract (already documented in `pdfAnnotationsPdfLib.js`): Survey Markers are survey content. Visual export skips them (`survey-marker-export-excluded`). Regular print flatten returns an empty `surveyMarkers` map on purpose (`buildPrintableRegularAnnotationPayload`). Proven here, not invented.

## Leftover 18 — unchanged

Not replayed. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

Crossing-cuts allocation leftover unchanged. Cap not loosened.

## Spec

`debug/scenarios/e2e-survey-marker.spec.mjs`

## Goal

Stays **open**.

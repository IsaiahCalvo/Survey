# E2E adversarial wave 9 — drawable export / print flatten

**Date:** 2026-08-21  
**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Goal:** stays open

Did **not** replay wave7, wave8, the individual flatten live specs, leftover 18, or official `npm test`.  
No prod SQL. No budget loosen. No secrets. No `.bot-credentials.json` / `.env*`.  
Did **not** invent stamp/image tools.

## How

Vite already serving `http://localhost:5173` (HTTP 200). Reused; not killed.

```bash
npx playwright test --config debug/playwright.reuse-5173.config.mjs \
  debug/scenarios/e2e-adversarial-wave9.spec.mjs
```

**Live: 10 / 10 passed (34.6s).**

`?testPdf=clickable-link-test.pdf` for drawables. `?testPdf=kal441-form-fields.pdf` for the form widget (fixture already has widgets; not invented).

Each tool: intended (draw → move/resize → UI export + print flatten) + break (empty-page export matches native fixture annots; Escape back to select then click is a no-op; form also cancels the download) + edge (mix a sibling type on the same page; undo the sibling; export keeps the first).

## Product fix

**None.** Export and print flatten already wrote geometry/text for every user-facing drawable on this route. High-risk files **not** edited: `PDFViewer.jsx`, `PageAnnotationLayer.jsx`, `FabricEraserCanvas.jsx`, `SVGAnnotationLayer.jsx`, `viewerShared.js`, `package.json`, `vite.config.js`.

Invariants held: `zoomGeneration`, SVG `viewBox`, container-aware canvas sizing, single-name `fontFamily`, CORS `Access-Control-Allow-Origin: '*'`.

## Verdicts

| Tool | Hunt | Verdict | Live proof |
|---|---|---|---|
| **pen** | draw / move / export Ink + flatten path; empty natives unchanged; mix highlighter; undo sibling | **pass** | Extra `/Ink` after draw (fixture already has one). Mixed three Inks; undo back to two. Flatten path points **57**. |
| **highlighter** | same as pen (user highlighter is Ink, not /Highlight) | **pass** | Extra `/Ink`. Mixed + `/Square` sibling; undo drops Square. Flatten points **57**. |
| **rect** | Square export + flatten; mix ellipse; undo | **pass** | Extra `/Square`. Mixed + `/Circle`; undo drops Circle. Flatten points **4**. |
| **ellipse** | Circle export + flatten; mix line; undo | **pass** | Extra `/Circle`. Mixed + `/Line`; undo drops Line. Flatten points **13**. |
| **line** | Line `/L` export + flatten; mix arrow; undo | **pass** | Extra `/Line`. Mixed two Lines; undo back to one. Flatten points **3**. |
| **arrow** | Line + `/LE` arrowhead; mix text; undo | **pass** | Extra `/Line` with arrow `/LE`. Mixed + `/FreeText`; undo drops FreeText. Flatten points **9**. |
| **text** | FreeText `w9-text`; mix rect; undo | **pass** | Extra `/FreeText`. Mixed + `/Square`; undo drops Square. Flatten wrote `Tj` (0 path points — text, not a stroke). |
| **callout** | FreeText `w9-call` + leader Lines; mix rect; undo | **pass** | Export: three `/Line` + `/FreeText`. Mixed + `/Square`; undo drops Square, keeps callout. Flatten points **13**. |
| **counter** | Circle pin + flatten label; mix pen; undo | **pass** | Extra `/Circle`. Mixed + `/Ink`; undo drops Ink. Flatten wrote `Tj` (label). |
| **form widget** | fill `surveyor.name` → export/print `/V`; empty stays blank; cancel download; mix rect; undo keeps value | **pass** | Unfilled export `surveyor.name=""`. Typed `w9-form` survives UI export and print flatten. Mixed Square present; undo Square; field still `w9-form`. |

Break notes: `clickable-link-test.pdf` already contains Widget/Link/Squiggly/StrikeOut/Underline/PolyLine/Square/Polygon/Ink. Empty export **matched that native set** (did not invent a clean page). Pen/highlighter tap and counter click are real commits (dot / pin), so the no-op is Escape → Selection (`v`) → click.

## Leftover 18 — unchanged

Not replayed. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

Crossing-cuts allocation leftover unchanged. Cap not loosened.

## Spec

`debug/scenarios/e2e-adversarial-wave9.spec.mjs`

## Goal

Stays **open**.

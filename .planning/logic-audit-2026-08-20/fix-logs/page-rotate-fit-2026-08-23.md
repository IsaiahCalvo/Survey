# Fit page / Fit width after page CW (viewBox 0 0 792 612) — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

Named leftover after form widgets after page CW (`a36973db`). Unrotated V-04 is `e2e-fit-page` / `e2e-zoom-keyboard-fit-width` (portrait `0 0 612 792`) — that is not this path. Named Save version / Restore stay leftover-18 **X-01**. After CW the page host is landscape (`1012×782`, viewBox `0 0 792 612`). Leftover-portrait overlay caches (Select-text / Search / thumbnails / form widgets; `inset:0` + stale viewport; IDB without `rot`; `pageSize * scale`) are exhausted — links already follow host; bookmark dest XYZ stays stubbed. Distinct from leftover-18 / X-01 / remapper / create-after-rotate / History-restore / eraser-on-remap / `mtr` / page-ops / unrotated V-04 / after-CW Select-text / Search / thumbnails / form widgets (not replayed). Did **not** stamp `file.id`.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_EMAIL` / `PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| `FILE_ID` / `VITE_DEV_AUTO_LOGIN_FILE_ID` / `LEASE_TOKEN` / `SURVEY_TEST_LEASE_TOKEN` | **absent** |
| Coordinator lease (`scripts/test-account-lease.mjs assign`) | **none** |
| `.survey-test-account.json` / `.bot-credentials.json` | **none** |

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write on the personal-like `.env.local` identity. Did **not** write another X-01 receipt.

## Product

No leftover. After CW, `PdfjsViewerContainer` `pageSizes` from the rewritten proxy are already **792×612**. `zoomToScale('fit' / 'fitw')` uses those swapped dims (not leftover **612×792**). Fit page **128%** / host **1012×782**; Fit width **165%** / host **1304×1008**. Leftover portrait Fit page **100%** / Fit width **213%** do not survive CW.

High-risk files untouched (`PDFViewer.jsx` / `SVGAnnotationLayer.jsx` / `PageAnnotationLayer.jsx` / `FabricEraserCanvas.jsx` / `viewerShared.js`). CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-page-rotate-fit.spec.mjs` **2 / 2 (5.8s)** on Vite `http://127.0.0.1:5324` (`npm run dev:ui`). Focused Node `pageRotateFit` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `file.id` null.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Before-rotate checkpoint | viewBox **`0 0 612 792`**; leftover Fit page **100%**; leftover Fit width **213%** |
| After CW | viewBox **`0 0 792 612`**; host landscape |
| Fit page | **128%**; host **1012×782** (not leftover **100%** / 612×792) |
| Fit width | **165%**; host **1304×1008** fills wrapper width |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty CW | rotate with no marks | invents **0** annotations |
| Fit page ≠ Fit width | landscape host | **128% ≠ 165%** |

### Edge

| Slice | Evidence |
|---|---|
| viewBox after Fit | **`0 0 792 612`** |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; Pages rotate not cheap |
| hubPreview | Draw **0**; Fit page chrome **0** |

## Official / focused Node

Focused `pageRotateFit` + leftover18 **15 / 15**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk file). `graphify` CLI absent — skipped.

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

# Form widgets after page CW (viewBox 0 0 792 612) — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

Named leftover after page thumbnails after page CW (`f1b57a03`). Unrotated X-05 is `kal441-form-fields` / `e2e-select-text` form INPUT (portrait `0 0 612 792`) — that is not this path. Named Save version / Restore stay leftover-18 **X-01**. After CW the page host is landscape (`1012×782`, viewBox `0 0 792 612`) while pdf.js AnnotationLayer kept leftover portrait fractions (name **0.363 / 0.338**). Distinct from leftover-18 / X-01 / remapper / create-after-rotate / History-restore / eraser-on-remap / `mtr` / page-ops / unrotated X-05 / after-CW Select-text / Search / thumbnails (not replayed). Did **not** stamp `file.id`. Did **not** invent a Forms editor.

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

Min-viable. After CW the live `.survey-pdfjs-page-div` is landscape while AnnotationLayer paints leftover rawDims percentages onto `inset:0`.

`src/utils/pdfjsTextLayerViewport.js`: `remapFormWidgetRect` — convert the PDF widget rect through the host-aware viewport (same rotation/scale contract as the text layer).  
`PdfjsFormLayer.jsx`: measure `.survey-pdfjs-page-div`, add 90 when host aspect disagrees, pin the layer to the host box, overwrite leftover section percentages. Container-aware `--scale-factor` from `host.offsetWidth / fitted.width`. Never `pageSize * scale`.

High-risk files untouched (`PDFViewer.jsx` / `SVGAnnotationLayer.jsx` / `PageAnnotationLayer.jsx` / `FabricEraserCanvas.jsx` / `viewerShared.js`). CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-page-rotate-form-widgets.spec.mjs` **2 / 2 (6.1s)** on Vite `http://127.0.0.1:5324` (`npm run dev:ui`). Focused Node `pageRotateFormWidgets` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `file.id` null.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Before-rotate checkpoint | viewBox **`0 0 612 792`**; name **0.363 / 0.338** |
| After CW | viewBox **`0 0 792 612`**; host **1012×782** |
| Form layer | **1012×782** matches host (not leftover portrait) |
| Name widget | **0.662 / 0.363** (left leftover **0.363 / 0.338**) |
| Hit-test | leftover fraction misses; remapped center focuses the name `INPUT` |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty CW | rotate with no marks | invents **0** annotations |
| Widget click | remapped name field | focuses input; invents **0** Survey marks |

### Edge

| Slice | Evidence |
|---|---|
| viewBox after widgets | **`0 0 792 612`** |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; Pages rotate not cheap |
| hubPreview | Draw **0**; form widgets **0** |

## Official / focused Node

Focused `pageRotateFormWidgets` + leftover18 **15 / 15**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk file). `graphify` CLI absent — skipped.

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

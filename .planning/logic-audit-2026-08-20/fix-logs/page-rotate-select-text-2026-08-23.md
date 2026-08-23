# Select text after page CW (viewBox 0 0 792 612) — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

Named leftover after Partial/Full eraser on CW-remapped ink (`1100c110`). Unrotated V-03 is `e2e-select-text` (portrait `0 0 612 792`) — that is not this path. Named Save version / Restore stay leftover-18 **X-01**. Distinct from leftover-18 / X-01 / remapper / create-after-rotate / History-restore / eraser-on-remap / `mtr` / page-ops (not replayed). Did **not** stamp `file.id`. Did **not** invent text-markup highlight (`showTextMarkupHighlightMenu = false`).

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

Min-viable. After CW the page host is landscape (`1012×782`) while the text layer still used a leftover portrait viewport (`782×1012`) and `inset:0` locked it to that box. Glyphs were selectable only at the pre-rotate offset.

`src/utils/pdfjsTextLayerViewport.js` + `PdfjsTextLayer.jsx`: measure the live `.survey-pdfjs-page-div`, add 90 when host aspect disagrees with the proxy viewport, `--scale-factor` from `host.offsetWidth / fitted.width` (container-aware, never `pageSize * scale`), drop `inset:0` and pin top-left to the host box.

High-risk files untouched (`PDFViewer.jsx` / `SVGAnnotationLayer.jsx` / `PageAnnotationLayer.jsx` / `FabricEraserCanvas.jsx` / `viewerShared.js`). CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-page-rotate-select-text.spec.mjs` **2 / 2 (8.1s)** on Vite `http://127.0.0.1:5283` (`npm run dev:ui`). Focused Node `pageRotateSelectText` + leftover18 **15 / 15**.

`?testPdf=text-search-glyph-lab.pdf`. `file.id` null.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Before-rotate checkpoint | viewBox **`0 0 612 792`** |
| After CW | viewBox **`0 0 792 612`**; host **1012×782** |
| Text-layer viewport | **1012×782** (not leftover portrait **782×1012**); same host |
| Drag | selected **`ABCDEFGHIJKLMNOPQRSTUV`** (`method: drag`) at visible span **293, 170** |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty CW | rotate with no marks | invents **0** annotations |
| Empty click | landscape corner | OS selection **`""`**; invents **0** |
| Select-text tool | glyph drag | invents **0** annotations |

### Edge

| Slice | Evidence |
|---|---|
| viewBox after select | **`0 0 792 612`** |
| `file.id` | `?testPdf=` **null** |
| 390 user-select lift | **still live** (`user-select: text !important` on `.pdfjsTextLayer.is-interactive`) |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; Pages rotate not cheap |
| hubPreview | Draw **0**; text layer **0** |

## Official / focused Node

Focused `pageRotateSelectText` + leftover18 **15 / 15**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk file). `graphify` CLI absent — skipped.

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

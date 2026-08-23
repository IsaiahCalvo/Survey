# Search after page CW (viewBox 0 0 792 612) — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

Named leftover after Select text after page CW (`bbf05ff9`). Unrotated V-08 is `e2e-search-previous` / `e2e-search-result-click` (portrait `0 0 612 792`) — that is not this path. Named Save version / Restore stay leftover-18 **X-01**. Distinct from leftover-18 / X-01 / remapper / create-after-rotate / History-restore / eraser-on-remap / `mtr` / page-ops / unrotated V-08 / after-CW Select-text (not replayed). Did **not** stamp `file.id`. Did **not** invent text-markup highlight.

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

Min-viable. After CW the Search overlay box already filled the landscape host (`1012×782`, viewBox `0 0 792 612`), but hit rectangles still used leftover portrait measurement (`attr 0, 20`) so marks sat off the visible glyphs.

`src/utils/pdfjsTextLayerViewport.js`: `resolveSearchPageViewport` + `viewportMatchesLiveHost` — same host-aspect rotation as the text layer (container-aware, never `pageSize * scale`).  
`SearchTextPanel.jsx`: drop a cache whose viewport disagrees with the live `.survey-pdfjs-page-div`; measurement layer reuses `ensureTextLayerStyles` / `.pdfjsTextLayer`; leftover-origin rects (`x≤2`, `y<40` on a landscape viewport) fall back to the metric estimate.

High-risk files untouched (`PDFViewer.jsx` / `SVGAnnotationLayer.jsx` / `PageAnnotationLayer.jsx` / `FabricEraserCanvas.jsx` / `viewerShared.js`). `PdfjsTextLayer.jsx` only exported the existing style injector. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-page-rotate-search.spec.mjs` **2 / 2 (16.5s)** on Vite `http://127.0.0.1:5296` (`npm run dev:ui`). Focused Node `pageRotateSearch` + leftover18 **15 / 15**.

`?testPdf=text-search-glyph-lab.pdf`. `file.id` null.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Before-rotate checkpoint | viewBox **`0 0 612 792`** |
| After CW | viewBox **`0 0 792 612`**; host **1012×782** |
| Search overlay | **1012×782** matches host; viewBox **`0 0 792 612`** (not leftover portrait) |
| Hit | `ABCDEFGHIJKLMNOPQRSTUV` **1 of 2**; first mark page **48, 71** × **412 × 31** (not leftover **0, 20**); screen **275, 188** on glyph **293, 170** |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty CW | rotate with no marks | invents **0** annotations |
| Empty query | `""` | invents **0** marks / **0** annotations |
| No-match | `zzzz-no-such-glyph` | invents **0** marks / **0** annotations |
| Dismiss | clear query | invents **0** marks / **0** annotations |

### Edge

| Slice | Evidence |
|---|---|
| viewBox after Search | **`0 0 792 612`** |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; Pages rotate not cheap |
| hubPreview | Draw **0**; search marks **0** |

## Official / focused Node

Focused `pageRotateSearch` + leftover18 **15 / 15**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk file). `graphify` CLI absent — skipped.

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

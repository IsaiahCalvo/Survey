# Page thumbnails after page CW (viewBox 0 0 792 612) — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

Named leftover after Search after page CW (`dc27d806`). Unrotated V-06 is `e2e-thumbnail-click` (portrait `0 0 612 792`) — that is not this path. Named Save version / Restore stay leftover-18 **X-01**. After CW the page host is landscape (`1012×782`, viewBox `0 0 792 612`) while the Pages-panel preview kept leftover portrait measurement (`249×323` box / `306×396` raster = 612×792 at crisp 0.5). Distinct from leftover-18 / X-01 / remapper / create-after-rotate / History-restore / eraser-on-remap / `mtr` / page-ops / unrotated V-06 / after-CW Select-text / Search (not replayed). Did **not** stamp `file.id`.

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

Min-viable. After CW the live `.survey-pdfjs-page-div` is landscape while a leftover pdf.js proxy (or rotate-blind IDB thumb keyed only on fingerprint) still rastered `612×792`.

`src/sidebar/pagesPanelUtils.js`: `resolvePagesPanelThumbRotation` — same host-aspect rotation as the text layer (container-aware, never `pageSize * scale`). Cache key now includes `rot`.  
`PagesPanel.jsx`: measure the live page host, render `getViewport({ scale, rotation: displayRotation })`, drop a cache whose aspect disagrees with the host, force re-queue when preview aspect disagrees.

High-risk files untouched (`PDFViewer.jsx` / `SVGAnnotationLayer.jsx` / `PageAnnotationLayer.jsx` / `FabricEraserCanvas.jsx` / `viewerShared.js`). CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened.

Siblings probed on the same path, **not** this leftover: pdf.js canvas / overlay host / link layer already fill the landscape host (claude.com **0.297/0.183 → 0.817/0.297**). Bookmark dest XYZ is stubbed (`goToBookmarkSource: () => false`) and jumps page-number only. Form widgets on `clickable-link-test.pdf` kept pre-rotate fractions — next overlay sibling, not receipted here.

## Live-proved

Playwright `e2e-page-rotate-thumbnails.spec.mjs` **2 / 2 (7.1s)** on Vite `http://127.0.0.1:5312` (`npm run dev:ui`). Focused Node `pageRotateThumbnails` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `file.id` null.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Before-rotate checkpoint | viewBox **`0 0 612 792`** |
| After CW | viewBox **`0 0 792 612`**; host **1012×782** |
| Thumb preview | **249×192** landscape (not leftover **249×323**) |
| Thumb raster | **396×306** landscape (not leftover **306×396**) |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty CW | rotate with no marks | invents **0** annotations |
| Thumb refresh | host-aware re-raster | invents **0** annotations |

### Edge

| Slice | Evidence |
|---|---|
| viewBox after thumbs | **`0 0 792 612`** |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; Pages rotate not cheap |
| hubPreview | Draw **0**; thumbs **0** |

## Official / focused Node

Focused `pageRotateThumbnails` + leftover18 **15 / 15**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk file). `graphify` CLI absent — skipped.

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

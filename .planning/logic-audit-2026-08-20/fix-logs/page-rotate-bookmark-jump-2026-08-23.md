# Bookmark jump after page CW (page-number dest on landscape host) — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

Named leftover after Fit page / Fit width after page CW (`372988cd`). Unrotated V-07 is `e2e-bookmark-group` / `e2e-bookmark-rename-delete` (portrait `0 0 612 792`) — that is not this path. Named Save version / Restore stay leftover-18 **X-01**. After CW the destination page is landscape (`viewBox` `0 0 792 612`). `goToBookmarkSource` stays stubbed (`() => false`) — page-number jump only. Missing dest does not invent XYZ. Distinct from leftover-18 / X-01 / remapper / create-after-rotate / History-restore / eraser-on-remap / `mtr` / page-ops / unrotated V-07 / after-CW Select-text / Search / thumbnails / form widgets / Fit (not replayed). Did **not** stamp `file.id`. Did **not** write another X-01 receipt.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_EMAIL` / `PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| `FILE_ID` / `VITE_DEV_AUTO_LOGIN_FILE_ID` / `LEASE_TOKEN` / `SURVEY_TEST_LEASE_TOKEN` | **absent** |
| Coordinator lease (`scripts/test-account-lease.mjs assign`) | **none** |
| `.survey-test-account.json` / `.bot-credentials.json` | **none** |

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write on the personal-like `.env.local` identity. Did **not** invent dest XYZ remapping.

## Product

No leftover. After CW, user bookmark `pageIds: [2]` still jumps via `goToPage`. `PdfjsViewerContainer.goToBookmarkSource` returns **false**. Rotate does not invent `dest.xyz`. Missing dest stays missing.

High-risk files untouched (`PDFViewer.jsx` / `SVGAnnotationLayer.jsx` / `PageAnnotationLayer.jsx` / `FabricEraserCanvas.jsx` / `viewerShared.js`). CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-page-rotate-bookmark-jump.spec.mjs` **2 / 2 (9.6s)** on Vite `http://127.0.0.1:5173` (`npm run dev:ui`). Focused Node `pageRotateBookmarkJump` + leftover18 **16 / 16**.

`?testPdf=spike-120-pages.pdf`. `file.id` null.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Before-rotate checkpoint | viewBox **`0 0 612 792`**; page **1** |
| Bookmark | `CW-JUMP-1787476141310` `pageIds: [2]`; dest **absent** |
| After CW page 2 | stay on page **1**; sibling viewBox still portrait |
| Jump | page **2**; host landscape; viewBox **`0 0 792 612`** |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty CW | rotate page 2 with no marks | invents **0** annotations |
| Missing dest | dest still `null` after CW + jump | does **not** invent XYZ |
| Sibling rotate | CW page 2 while on page 1 | does **not** invent a jump off page 1 |

### Edge

| Slice | Evidence |
|---|---|
| viewBox after jump | **`0 0 792 612`** |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; Pages rotate not cheap |
| hubPreview | Draw **0**; Add bookmark **0** |

## Official / focused Node

Focused `pageRotateBookmarkJump` + leftover18 **16 / 16**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk file). `graphify` CLI absent — skipped.

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

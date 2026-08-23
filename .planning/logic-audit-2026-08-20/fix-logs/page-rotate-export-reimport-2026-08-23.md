# Page-rotate remapper then export → `?testPdf=` re-import — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

`41644a94` transform export/reimport only covered bbox-resize on an unrotated page (viewBox stayed `0 0 612 792`). That is not coverage of the rotate remapper: displayed-space remap + `/Rotate` + swapped viewBox. Distinct from leftover-18 / X-01 / pointercancel / tool-switch / paste-after-zoom / 103-ID audit / page-rotate-transformed / page-move / duplicate / insert / delete. Did **not** invent flatten / stamp / Forms. Did **not** pad more page-ops catalogs.

`?testPdf=` fixture remount cannot restore baked `/Rotate` (no `file.id` persist). Local cache still holds remapped left/top/angle. The product path is annotated export → `?testPdf=` re-import of the exported bytes.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_EMAIL` / `PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| `FILE_ID` / `VITE_DEV_AUTO_LOGIN_FILE_ID` / `LEASE_TOKEN` | **absent** |
| Coordinator lease (`scripts/test-account-lease.mjs assign`) | **none** |
| `.bot-credentials.json` | **none** |

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write on the personal-like `.env.local` identity. Did **not** write another X-01 receipt.

## Product

No min-viable product diff. `transformPageState({ type: 'rotate' })` remaps displayed-space centers; `mutatePdfPages` bakes `/Rotate`; `savePDFWithAnnotationsPdfLib` + `applyPdfAppAnnotationMetadata` already restore remapped `left` / `top` / `angle` onto the swapped viewport. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened. No high-risk file.

## Live-proved

Playwright `e2e-page-rotate-export-reimport.spec.mjs` **2 / 2 (10.4s)** on Vite `http://127.0.0.1:5263` (`npm run dev:ui`). Focused Node `pageRotateExportReimport` + leftover18 **16 / 16**.

`?testPdf=clickable-link-test.pdf`. After CW: `viewBox` **`0 0 792 612`**. After wipe-reload of the original fixture: **`0 0 612 792`**. `file.id` null.

Desktop rect `88104b6f-…` create **120.4** then `br` **135.42 × 152.24**. CW maps center **67.71, 76.12 → 715.88, 67.71**; angle **90**; left **0 → 648.17**. Export `clickable-link-test-annotated.pdf` → `?testPdf=` re-import kept the **same id**, remapped center, angle **90**, and viewBox **`0 0 792 612`**. 390 Pages rotate / Export overflow is not cheap (sheet); edge is viewBox + `file.id` + 0 marks.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Create + `br` resize | **120.4 → 135.42 × 152.24**. |
| Page rotate CW | Same id; center **715.88, 67.71**; angle **90**; viewBox **`0 0 792 612`**. |
| Local cache | Remapped left **648.17** stored under `annotationsByPage_*`. |
| Export → `?testPdf=` re-import | Same id `88104b6f-…`; center **715.88, 67.71**; angle **90**; viewBox **`0 0 792 612`**. |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty export | Export with 0 user marks | PDF downloads (`clickable-link-test-annotated.pdf`) |
| Cancel download | `download.cancel()` after empty export | Invents **0** marks |
| Reload without save | Wipe `annotationsByPage_*` then reload original fixture | Invents **0** of the remapped id; viewBox **`0 0 612 792`** |
| `file.id` | `?testPdf=` throughout | **null** |

### Edge

| Slice | Evidence |
|---|---|
| viewBox after rotate / re-import | **`0 0 792 612`** |
| viewBox after wipe-reload | **`0 0 612 792`** (original fixture; no `file.id` persist) |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox + `file.id` + 0 marks; Pages rotate / Export overflow not cheap |
| hubPreview | Draw **0** |

## Official / focused Node

Focused `pageRotateExportReimport` + leftover18 **16 / 16**. Cap **8448** not loosened. Official `npm test` not re-run (no product / high-risk edit).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

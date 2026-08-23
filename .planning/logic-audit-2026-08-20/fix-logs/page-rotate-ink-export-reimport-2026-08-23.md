# Page-rotate remapped-page pen then export → `?testPdf=` re-import — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

`649e75f2` / `page-rotate-export-reimport` only covered a remapped rect (bbox + object angle). Live pen stores `path` + `paperCenterline` in page space (`left: 0`); remapper already bakes those points. This pass is serialize/restore: remapped centerline + swapped viewBox must survive annotated export → `?testPdf=` re-import. Distinct from leftover-18 / X-01 / remapped ink (live only) / remapped counter / callout / midpoint / survey-marker / remapped `mt`/`mtr`/`br` clip. Did **not** invent flatten / stamp / Forms. Did **not** pad more page-ops catalogs.

`pageAnnotationReindex.js` inspected: no new unhandled live kind (callout fractions, page-space ink, counter + `pointerAngle`, survey-marker bounds, line midpoint already landed). Counter skips `buildPdfAppAnnotationMetadata` by design — pen is the kind that writes `paperCenterline`. No serialize/restore bug; metadata + importer keep remapped points and id.

`?testPdf=` fixture remount cannot restore baked `/Rotate` (no `file.id` persist). Local cache still holds remapped centerline. The product path is annotated export → `?testPdf=` re-import of the exported bytes.

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

No min-viable product diff. `rotatePageSpaceInk` already remaps path + `paperCenterline`; `savePDFWithAnnotationsPdfLib` + `applyPdfAppAnnotationMetadata` restore remapped centerline onto the swapped viewport. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened. No high-risk file.

## Live-proved

Playwright `e2e-page-rotate-ink-export-reimport.spec.mjs` **2 / 2 (9.5s)** on Vite `http://localhost:5173` (`npm run dev:ui`). Focused Node `pageRotateInkExportReimport` + leftover18 **16 / 16**.

`?testPdf=clickable-link-test.pdf`. After CW: `viewBox` **`0 0 792 612`**. After wipe-reload of the original fixture: **`0 0 612 792`**. `file.id` null.

Desktop pen `5a109707-…` centerline **134.64, 237.60**. CW maps **134.64, 237.60 → 554.40, 134.64** (exact displayed-space +90). `left` **0**; `angle` **0**. Export `clickable-link-test-annotated.pdf` → `?testPdf=` re-import kept the **same id**, remapped centerline, and viewBox **`0 0 792 612`**. 390 Pages rotate / Export overflow is not cheap (sheet); edge is viewBox + `file.id` + 0 marks.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Live create | pen `5a109707-…` centerline **134.64, 237.60**; `left` **0**; `angle` **0**. |
| Page rotate CW | Same id; centerline **554.40, 134.64**; viewBox **`0 0 792 612`**. |
| Local cache | Remapped centerline stored under `annotationsByPage_*`. |
| Export → `?testPdf=` re-import | Same id `5a109707-…`; centerline **554.40, 134.64**; `left` **0**; `angle` **0**; viewBox **`0 0 792 612`**. |

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

Focused `pageRotateInkExportReimport` + leftover18 **16 / 16**. Cap **8448** not loosened. Official `npm test` not re-run (no product / high-risk edit).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

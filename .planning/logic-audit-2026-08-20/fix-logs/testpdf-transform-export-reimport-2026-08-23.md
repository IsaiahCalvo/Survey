# ?testPdf= create/transform then local save + export re-import — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

The 2026-08-22 `?testPdf=` local save receipt (`e2e-testpdf-local-save-reload`) only drew an untransformed rect and reloaded `annotationsByPage_*`. That is not coverage of current create/transform. Distinct from leftover-18 / X-01 / pointercancel / tool-switch / paste-after-zoom / 103-ID audit. Did **not** invent flatten / stamp / Forms.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_EMAIL` / `PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| `FILE_ID` / `VITE_DEV_AUTO_LOGIN_FILE_ID` / `LEASE_TOKEN` | **absent** |
| Coordinator lease (`scripts/test-account-lease.mjs assign`) | **none** |
| `.bot-credentials.json` | **none** |
| Cursor cloud environment | **null** |

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write on the personal-like `.env.local` identity. Did **not** write another X-01 receipt.

## Product

No min-viable product diff. Persist skip-when-`file.id`, local `annotationsByPage_*` for `!isCloudBackedDoc`, and app-metadata geometry (`angle` / `scaleX` / `scaleY`) on export → `importAnnotationsFromPdf` already restore transformed objects. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened.

Live desktop `mtr` free-drag / degree pill did not commit in this session (handle present). Angle **90** is covered by the focused Node export/reimport contract, not replayed as a new product hunt.

## Live-proved

Playwright `e2e-testpdf-transform-export-reimport.spec.mjs` **2 / 2 (13.2s)** on Vite `http://127.0.0.1:5173` (`npm run dev:ui`). Focused Node `testPdfTransformExportReimport` + leftover18 **16 / 16**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

Desktop rect `50b7bfcd-…` **120.4 → 135.4 × 152.2**. Pen `ad8169ba-…` **199.6 → 216.6**. Reload + export `clickable-link-test-annotated.pdf` → `?testPdf=` re-import kept the same ids and sizes. 390 rect `0e248ca8-…` **206.1 → 275.4** survives reload.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Rect rubber-band then `br` resize | Desktop Δ **+15.0 × +11.7**. 390 Δ **+69.3**. |
| Pen live create then selected `br` | **199.6 → 216.6**. |
| Local save / reload | Same ids; resized vw/vh Δ **< 4**. Not create-time size. |
| Export → `?testPdf=` re-import | Same ids; resized vw held. `file.id` null. |
| Node rotated+scaled export | Rect `angle=90` `scaleX=1.5` `scaleY=1.25`; pen `scaleX=2` `scaleY=1.5`. |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty export | Export with 0 user marks | PDF downloads (`pdfAnnotationsAdded=0`) |
| Cancel download | `download.cancel()` after empty export | Invents **0** marks |
| Reload without save | Wipe `annotationsByPage_*` then reload | Invents **0** of the transformed ids |
| `file.id` | `?testPdf=` throughout | **null** |

### Edge

| Slice | Evidence |
|---|---|
| viewBox | `0 0 612 792` before reload, after reload, after re-import |
| Undo across reload | Not required; Ctrl+Z does not restore create-time size |
| 390 | `br` resize + reload keeps **275.4** |
| hubPreview | Draw **0** |
| `mtr` chrome | Desktop handle **present**; live 90° not committed this session (Node covers) |

## Official / focused Node

Focused `testPdfTransformExportReimport` + leftover18 **16 / 16**. Cap **8448** not loosened. Official `npm test` not re-run (no product / high-risk edit).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

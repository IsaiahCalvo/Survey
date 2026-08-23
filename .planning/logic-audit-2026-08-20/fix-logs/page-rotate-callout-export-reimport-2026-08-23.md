# Page-rotate remapped-page callout then export → `?testPdf=` re-import — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

`649e75f2` / `page-rotate-export-reimport` only covered a remapped rect (bbox + object angle). `a3e9bcff` / `page-rotate-ink-export-reimport` only covered remapped page-space ink. Live callout stores box/knee/arrow as 0–1 fractions; remapper already bakes those (`rotateCalloutFractions`). This pass is serialize/restore: remapped fractions + swapped viewBox must survive annotated export → `?testPdf=` re-import. Distinct from leftover-18 / X-01 / remapped callout (live only) / remapped ink / remapped rect / create-after-CW / leftover-portrait. Did **not** invent flatten / stamp / Forms. Did **not** pad more page-ops catalogs.

Product bug found: `setCalloutsIfPersistedChanged` ran *before* the native `isPdfImported` replace. That replace strips every imported object. Callouts are split out of `filteredImportedAnnotations`, so remapped fractions landed on the floor after `?testPdf=` re-import. Min-viable: project imported SurveyAppCallout rows *after* the native replace. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_EMAIL` / `PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| `FILE_ID` / `VITE_DEV_AUTO_LOGIN_FILE_ID` / `LEASE_TOKEN` | **absent** |
| Coordinator lease (`scripts/test-account-lease.mjs assign`) | **none** |
| `.bot-credentials.json` | **none** |

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write on the personal-like `.env.local` identity. Did **not** write another X-01 receipt.

## Live-proved

Playwright `e2e-page-rotate-callout-export-reimport.spec.mjs` **2 / 2 (9.4s)** on Vite `http://localhost:5173` (`npm run dev:ui`). Focused Node `pageRotateCalloutExportReimport` + leftover18 **16 / 16**.

`?testPdf=clickable-link-test.pdf`. After CW: `viewBox` **`0 0 792 612`**. After wipe-reload of the original fixture: **`0 0 612 792`**. `file.id` null.

Desktop callout `callout-61bd2a0a-…` box **0.440 × 0.420** / center **329.28, 348.64**. CW maps center **329.28, 348.64 → 443.36, 329.28** (exact displayed-space +90); box **0.484 × 0.512**. Export `clickable-link-test-annotated.pdf` → `?testPdf=` re-import kept the **same id**, remapped fractions, and viewBox **`0 0 792 612`**. 390 Pages rotate / Export overflow is not cheap (sheet); edge is viewBox + `file.id` + 0 marks.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Live create | callout `callout-61bd2a0a-…` box **0.440 × 0.420**; center **329.28, 348.64**. |
| Page rotate CW | Same id; box **0.484 × 0.512**; center **443.36, 329.28**; viewBox **`0 0 792 612`**. |
| Local cache | Remapped fractions stored under `annotationsByPage_*`. |
| Export → `?testPdf=` re-import | Same id `callout-61bd2a0a-…`; box **0.484 × 0.512**; center **443.36, 329.28**; viewBox **`0 0 792 612`**. |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty export | Export with 0 user marks | PDF downloads (`clickable-link-test-annotated.pdf`) |
| Cancel download | `download.cancel()` after empty export | Invents **0** marks |
| Reload without save | Wipe `annotationsByPage_*` + `callouts_*` then reload original fixture | Invents **0** of the remapped id; viewBox **`0 0 612 792`** |
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

Focused `pageRotateCalloutExportReimport` + leftover18 **16 / 16**. Cap **8448** not loosened. Official `npm test` after the high-risk `PDFViewer.jsx` min-viable (report baseline).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

Remaining type-unproved export-after-rotate siblings: **counter**, **survey-marker**, **line/arrow**, **textbox**.

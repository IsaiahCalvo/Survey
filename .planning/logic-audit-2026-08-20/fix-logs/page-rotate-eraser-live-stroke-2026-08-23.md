# Partial / Full eraser live stroke on page-CW remapped ink — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

Named leftover after History restore of remapped ink (`c44a07ed`). Unrotated D-03/D-04 live stroke is `e2e-eraser-live-stroke` (portrait `0 0 612 792`) — that is not this path. Named Save version / Restore stay leftover-18 **X-01**. Distinct from leftover-18 / X-01 / remapped ink / remapped History Restore / create-after-rotate / remappers (not replayed). Did **not** stamp `file.id`. Did **not** pad `rotatePageSpaceInk`.

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

No product change. After CW, `rotatePageSpaceInk` already remaps `path` + `paperCenterline` and keeps `left` 0 / `angle` 0. `FabricEraserCanvas` `pagePoint` multiplies the live container by `pageWidth`/`pageHeight` from `resolvedPageSize` (swapped to 792×612). Partial/Full live preview then pointerup hits the remapped centerline. Pre-rotate ghost swipe invents 0. `zoomGeneration` still commits (not discard).

High-risk files untouched. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-page-rotate-eraser-live-stroke.spec.mjs` **2 / 2 (12.6s)** on Vite `http://127.0.0.1:5270` (`npm run dev:ui`). Focused Node `pageRotateEraserLiveStroke` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `file.id` null.

Desktop pen A `5147c038-…` before **110.16, 142.56** left **0** viewBox **`0 0 612 792`**. CW remapped **649.44, 110.16** left **0** angle **0** viewBox **`0 0 792 612`**. Pen B `c9c3ddde-…` remapped **221.76, 379.44**.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Before-rotate checkpoint | viewBox **`0 0 612 792`**; A centerline **110.16, 142.56** |
| After CW remap | same ids; A **649.44, 110.16**; B **221.76, 379.44**; left **0**; viewBox **`0 0 792 612`** |
| Partial live stroke | mask-clone / live-preview then pointerup bites remapped A; isolates B |
| Full live stroke | live preview then deletes remapped A; isolates remapped B |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty swipe | far landscape corner | preview **0**; invents **0** |
| Ghost swipe | pre-rotate A page-space on swapped viewBox | invents **0**; remapped A/B stay |
| `zoomGeneration` | Ctrl+= mid-stroke on remapped B | flushes commit; preview drops |

### Edge

| Slice | Evidence |
|---|---|
| viewBox after remap / erase | **`0 0 792 612`** |
| `file.id` | `?testPdf=` **null** |
| Isolation | Partial + Full leave remapped B |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; Pages rotate / remapped eraser not cheap |
| hubPreview | Draw **0**; eraser wrapper **0** |

## Official / focused Node

Focused `pageRotateEraserLiveStroke` + leftover18 **15 / 15**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk file). `graphify` CLI absent — skipped.

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

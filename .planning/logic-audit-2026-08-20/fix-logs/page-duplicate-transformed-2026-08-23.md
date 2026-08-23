# Page duplicate with a currently transformed rect — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

The page-move leftover-coords hole had siblings. Wave 3 / thin leftovers Duplicate only proved untransformed create then duplicate (fresh id). That is not coverage of current create/transform. Distinct from leftover-18 / X-01 / pointercancel / tool-switch / paste-after-zoom / 103-ID audit / undo-across-tool-switch / transform export-reimport / page-rotate-transformed / page-move-transformed. Did **not** invent flatten / stamp / Forms.

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

No min-viable product diff. Persist-then-commit `usePageOperations` + `addPageClone` / `mintPastedCloneIdentity` already mint a fresh id, copy overlay `left`/`top`/`width`/`height`/`angle`, and leave the original. Page mutations wipe the local undo lane (`setUndoHistory([])`); inverse Delete of the clone page removes the copy only. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened. No high-risk file.

## Live-proved

Playwright `e2e-page-duplicate-transformed.spec.mjs` **2 / 2 (11.0s)** on Vite `http://localhost:5173` (`npm run dev:ui`). Focused Node `pageDuplicateTransformed` + leftover18 **15 / 15**.

`?testPdf=text-search-glyph-lab.pdf` (3 pages). `viewBox` stays `0 0 612 792`. `file.id` null.

Desktop rect `4f256ef8-…` create **120.4** then `br` **210.40 × 210.56**. Duplicate: original stays page **1**; copy `b69837d9-…` on page **2**; left/top **123.4, 206.92**; vw/vh held. Toolbar Undo **disabled** (local-lane wipe). Delete clone page leaves original. Empty first-page Duplicate invents **0**. 390 Pages duplicate is not cheap (sheet backdrop); edge is viewBox + `file.id` + 0 marks.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Create + `br` resize | **120.4 → 210.40 × 210.56**. |
| Page Duplicate | New id `b69837d9-…`; store page **2**; overlay **123.4, 206.92** / **210.40 × 210.56**. |
| Original stays | Same id on page **1**; same overlay coords. |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page duplicate | Duplicate page 1 before create | invents **0** |
| Local undo after duplicate | toolbar Undo | **disabled** (page-mutation wipe) |
| Inverse delete clone page | Delete page 2 | original stays **210.40 × 210.56**; copy gone |

### Edge

| Slice | Evidence |
|---|---|
| viewBox | stays `0 0 612 792` (no rotate swap) |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox + `file.id` + 0 marks; Pages duplicate not cheap |
| hubPreview | Draw **0**; annotation layer **0** |

## Official / focused Node

Focused `pageDuplicateTransformed` + leftover18 **15 / 15**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk file).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

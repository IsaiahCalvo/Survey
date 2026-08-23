# Page move with a currently transformed rect — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

The page-rotate leftover-coords hole had siblings. Wave 11 / pages move-up-down only proved untransformed create then move (id remaps). That is not coverage of current create/transform. Distinct from leftover-18 / X-01 / pointercancel / tool-switch / paste-after-zoom / 103-ID audit / undo-across-tool-switch / transform export-reimport / page-rotate-transformed. Did **not** invent flatten / stamp / Forms.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_EMAIL` / `PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| `FILE_ID` / `VITE_DEV_AUTO_LOGIN_FILE_ID` / `LEASE_TOKEN` | **absent** |
| Coordinator lease (`scripts/test-account-lease.mjs assign`) | **none** |
| `.bot-credentials.json` | **none** |

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write on the personal-like `.env.local` identity. Did **not** write another X-01 receipt.

## Sibling hunt

| Path | Verdict |
|---|---|
| **Move** | **Correct, unreceipted → this receipt.** `transformPageState({ type: 'move' })` remaps the page key + `data.pageNumber`. Overlay `left`/`top`/`width`/`height`/`angle` stay. |
| Duplicate | Remapper correct (fresh id, same placement). Not the live sibling. |
| Mirror H/V | CSS-only (`togglePageMirror` → thumb `scaleX`/`scaleY`). No `transformPageState` type. Overlay coords stay. Already receipted as presentation. |
| Insert | Remapper correct (later-page resized rect shifts with the page; new slot empty). Not the live sibling. |

No product bug. No high-risk file.

## Product

No min-viable product diff. Persist-then-commit `usePageOperations` + `baseRemap` already carry a bbox-resized rect with the page and leave overlay coords in the same displayed space (unlike rotate, which must remap after `/Rotate` + viewBox swap). CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-page-move-transformed.spec.mjs` **2 / 2 (8.6s)** on Vite `http://localhost:5173` (`npm run dev:ui`). Focused Node `pageMoveTransformed` + leftover18 **16 / 16**.

`?testPdf=text-search-glyph-lab.pdf` (3 pages). `viewBox` stays `0 0 612 792`. `file.id` null.

Desktop rect `575d2de6-…` create **120.4** then `br` **135.4 × 152.2**. Move down: same id on page **2**; left/top **0, 0**; vw/vh held. Opposite Move up restores page **1**. Empty Move down then up invents **0**. 390 Pages move is not cheap (sheet backdrop); edge is viewBox + `file.id` + 0 marks.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Create + `br` resize | **120.4 → 135.4 × 152.2**. |
| Page Move down | Same id; store page **2**; overlay **0, 0** / **135.4 × 152.2**. |
| Not left on old index | Page 1 user marks **0** after the move. |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page move | Move down then up before create | invents **0** |
| Opposite page move | Move up after Move down | restores page **1** / **135.4 × 152.2** |

### Edge

| Slice | Evidence |
|---|---|
| viewBox | stays `0 0 612 792` (no rotate swap) |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox + `file.id` + 0 marks; Pages move not cheap |
| hubPreview | Draw **0**; annotation layer **0** |

## Official / focused Node

Focused `pageMoveTransformed` + leftover18 **16 / 16**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk file).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

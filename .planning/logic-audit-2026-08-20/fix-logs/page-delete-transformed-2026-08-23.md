# Page delete of a currently transformed rect — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

The page-insert leftover-coords hole had a Delete sibling: wave 11 / insert-inverse only deleted a blank or clone page while the resized rect stayed. That is not coverage of Delete of the page that currently holds the transformed mark. Distinct from leftover-18 / X-01 / pointercancel / tool-switch / paste-after-zoom / 103-ID audit / page-rotate-transformed / page-move-transformed / page-duplicate-transformed / page-insert-transformed. Did **not** invent flatten / stamp / Forms / Extract. Mirror H+V stays CSS-only.

## Reset hunt (first)

`handleResetPage` → `resetPageTransform` deletes that page’s CSS `pageTransformations` entry. It does **not** call `runMutation` / `transformPageState`. After PDF rotate the remapper already cleared CSS rotation (leftover mirrors may stay). Reset then clears those mirrors and leaves remapped overlay coords on the still-rotated PDF — matches displayed space, not a remapper inverse. Already receipted after Mirror V (`e2e-survey-keep-notes-page-ctx.spec.mjs`). No stale-coords bug. No remapper `type: 'reset'` invented.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_EMAIL` / `PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| `FILE_ID` / `VITE_DEV_AUTO_LOGIN_FILE_ID` / `LEASE_TOKEN` | **absent** |
| Coordinator lease (`scripts/test-account-lease.mjs assign`) | **none** |
| `.bot-credentials.json` | **none** |

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write on the personal-like `.env.local` identity. Did **not** write another X-01 receipt.

## Product contract

`transformPageState({ type: 'delete', page: N })` + `handleDeletePage(N)` + `mutatePdfPages`:

- Page N objects are dropped (ids gone from `annotationsByPage` / `annotations`).
- Pages `> N` shift `-1` and do **not** inherit the deleted ids.
- Last remaining page is refused: `A PDF must keep at least one page.`
- Empty delete invents 0. Local undo lane is wiped.

## Product

No min-viable product diff. Persist-then-commit `usePageOperations` + `baseRemap` already drop the deleted-page ids. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened. No high-risk file.

## Live-proved

Playwright `e2e-page-delete-transformed.spec.mjs` **2 / 2 (7.1s)** on Vite `http://localhost:5173` (`npm run dev:ui`). Focused Node `pageDeleteTransformed` + leftover18 **16 / 16**.

`?testPdf=text-search-glyph-lab.pdf` (3 pages). `viewBox` stays `0 0 612 792`. `file.id` null.

Desktop rect `aec71900-…` create **120.4** then `br` **210.40 × 210.56**. Empty Delete page 3 invents **0** (3→2). Delete page 1 drops the resized id; neighbor page 1 marks **0** (no leak). Store forgets the id. Toolbar Undo **disabled**. Last remaining page Delete toasts `Error deleting page: A PDF must keep at least one page.` and stays **1** page. 390 Pages delete is not cheap (sheet backdrop); edge is viewBox + `file.id` + 0 marks.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Create + `br` resize | **120.4 → 210.40 × 210.56**. |
| Delete page holding it | Same id **gone**; store **null**. |
| No neighbor leak | Remaining page 1 user marks **0**. |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page delete | Delete page 3 before create | invents **0**; 3→2 pages |
| Local undo after delete | toolbar Undo | **disabled** (page-mutation wipe) |
| Last remaining page | Delete the only page left | toast **keep at least one page**; count stays **1** |

### Edge

| Slice | Evidence |
|---|---|
| viewBox | stays `0 0 612 792` (no rotate swap) |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox + `file.id` + 0 marks; Pages delete not cheap |
| hubPreview | Draw **0**; annotation layer **0** |

## Official / focused Node

Focused `pageDeleteTransformed` + leftover18 **16 / 16**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk file).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

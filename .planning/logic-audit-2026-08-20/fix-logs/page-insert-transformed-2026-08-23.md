# Page insert with a currently transformed rect — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

The page-duplicate leftover-coords hole had siblings. Wave 10 / wave 11 insert-blank only proved untransformed create then insert. That is not coverage of current create/transform. Distinct from leftover-18 / X-01 / pointercancel / tool-switch / paste-after-zoom / 103-ID audit / undo-across-tool-switch / transform export-reimport / page-rotate-transformed / page-move-transformed / page-duplicate-transformed. Did **not** invent flatten / stamp / Forms. Mirror H+V stays CSS-only (`togglePageMirror`); no `transformPageState` remapper invented.

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

`transformPageState({ type: 'insert', afterPage: N })` + `handleInsertBlankPage(N)`:

- Pages `<= N` stay on the same index.
- Pages `> N` shift `+1`.
- New page `N+1` is empty (no cloned objects).
- Overlay `left` / `top` / `width` / `height` / `angle` are unchanged (no rotate remapper).

So a bbox-resized rect on page 1 stays on page 1 when inserting after page 1, and does **not** jump onto the blank. A later-page resized rect (page 2 + insert after 1) correctly shifts to page 3 with the same overlay coords. Inverse Delete of the blank restores the prior page count and placement. Empty insert invents 0.

## Product

No min-viable product diff. Persist-then-commit `usePageOperations` + `baseRemap` already keep a same-or-earlier-page resized rect in place and open an empty slot. Page mutations wipe the local undo lane (`setUndoHistory([])`); inverse Delete of the blank page restores. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened. No high-risk file.

## Live-proved

Playwright `e2e-page-insert-transformed.spec.mjs` **2 / 2 (10.1s)** on Vite `http://127.0.0.1:5173` (`npm run dev:ui`). Focused Node `pageInsertTransformed` + leftover18 **15 / 15**.

`?testPdf=text-search-glyph-lab.pdf` (3 pages). `viewBox` stays `0 0 612 792`. `file.id` null.

Desktop rect `99edb660-…` create **120.4** then `br` **210.40 × 210.56**. Insert after page 1: same id on page **1**; left/top **123.4, 206.92**; vw/vh held. Blank page **2** user marks **0**. Toolbar Undo **disabled** (local-lane wipe). Delete blank page restores **4** pages and the resized rect. Empty first-page Insert invents **0**. 390 Pages insert is not cheap (sheet backdrop); edge is viewBox + `file.id` + 0 marks.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Create + `br` resize | **120.4 → 210.40 × 210.56**. |
| Insert after page 1 | Same id; store page **1**; overlay **123.4, 206.92** / **210.40 × 210.56**. |
| Blank does not steal | Page 2 user marks **0**. |
| Later-page shift (Node) | Page-2 resized rect + insert after 1 → page **3**; overlay held; slot 2 empty. |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page insert | Insert after page 1 before create | invents **0** |
| Local undo after insert | toolbar Undo | **disabled** (page-mutation wipe) |
| Inverse delete blank | Delete page 2 | original stays **210.40 × 210.56** on page **1** |

### Edge

| Slice | Evidence |
|---|---|
| viewBox | stays `0 0 612 792` (no rotate swap) |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox + `file.id` + 0 marks; Pages insert not cheap |
| hubPreview | Draw **0**; annotation layer **0** |

## Official / focused Node

Focused `pageInsertTransformed` + leftover18 **15 / 15**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk file).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

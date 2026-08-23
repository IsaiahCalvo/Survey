# Page rotate with a currently transformed rect — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

Wave 11 / pages insert/rotate/move only proved untransformed create then rotate (id stays on the page). That is not coverage of current create/transform. Distinct from leftover-18 / X-01 / pointercancel / tool-switch / paste-after-zoom / 103-ID audit / undo-across-tool-switch / transform export-reimport. Did **not** invent flatten / stamp / Forms.

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

Min-viable remap. `transformPageState({ type: 'rotate' })` kept overlay `left`/`top` in pre-rotate displayed space after pdf.js swapped the viewBox. `usePageOperations` now peeks the displayed page size, and `rotateDisplayedPoint` moves the visual center (+angle) with the baked `/Rotate`. Opposite delta restores. Empty objects stay empty. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened. No high-risk file.

## Live-proved

Playwright `e2e-page-rotate-transformed.spec.mjs` **2 / 2 (7.9s)** on Vite `http://localhost:5173` (`npm run dev:ui`). Focused Node `pageRotateTransformed` + leftover18 **16 / 16**.

`?testPdf=clickable-link-test.pdf`. `viewBox` `0 0 612 792` → `0 0 792 612` after CW → restored. `file.id` null.

Desktop rect `8b6c0b23-…` create **120.4** then `br` **135.4 × 152.2**. CW maps center **67.71, 76.12 → 715.88, 67.71** (exact displayed-space +90). CCW restores **67.71, 76.12**. 390 Pages rotate is not cheap (sheet backdrop / tab detach); edge is viewBox + `file.id` + 0 marks.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Create + `br` resize | **120.4 → 135.4 × 152.2**. |
| Page rotate CW | Same id; center **715.88, 67.71**; angle **90**; viewBox **0 0 792 612**. |
| Not pre-rotate origin | `left` **0 → 648.17**. |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page rotate | CW then CCW before create | invents **0** |
| Opposite page rotate | CCW after CW | restores **67.71, 76.12** / viewBox **0 0 612 792** |

### Edge

| Slice | Evidence |
|---|---|
| viewBox | `0 0 612 792` → `0 0 792 612` → restored |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox + `file.id` + 0 marks; Pages rotate not cheap |
| hubPreview | Draw **0**; annotation layer **0** |

## Official / focused Node

Focused `pageRotateTransformed` + leftover18 **16 / 16**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk file).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

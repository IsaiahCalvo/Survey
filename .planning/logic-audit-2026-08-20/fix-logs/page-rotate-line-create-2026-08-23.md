# Page-rotate then create new Line on swapped viewBox — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

`52d001fd` proved rect+pen create after CW via `screenToSVG`. `e8a2e61a` proved callout fractions. Line create after CW stores **page-space bbox + CENTER-relative x1..y2** (`buildLineCommitJSON`). Distinct from leftover-18 / X-01 / remapped rect / callout / ink / counter / survey-marker / midpoint / remapped `mt`/`mtr`/`br` clip / remapped-page export / rect+pen create / callout create. Did **not** pad another remapper kind. Did **not** invent stamp / Forms. Textbox is a different click-to-place path (not `SHAPE_CREATION_TOOLS`); Line is the unique kind.

`pageAnnotationReindex.js` not extended. `buildLineCommitJSON` has no hardcoded 612×792 — geometry is the pointer's viewBox point.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_EMAIL` / `PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| `FILE_ID` / `VITE_DEV_AUTO_LOGIN_FILE_ID` / `LEASE_TOKEN` | **absent** |
| Coordinator lease (`scripts/test-account-lease.mjs assign`) | **none** |
| `.survey-test-account.json` / `.bot-credentials.json` | **none** |

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** cloud-write on the personal-like `.env.local` identity. Did **not** write another X-01 receipt.

## Product

No min-viable product diff. After empty CW, pdf.js viewport + SVG `viewBox` are already `0 0 792 612`. Line rubber-band maps through `screenToSVG` and `buildLineCommitJSON` (3pt length gate). Displayed endpoints reconstruct as `left + width/2 + x1` (angle 0). CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened. No high-risk file.

## Live-proved

Playwright `e2e-page-rotate-line-create.spec.mjs` **2 / 2 (7.6s)** on Vite `http://127.0.0.1:5173` (`npm run dev:ui`). Focused Node `pageRotateLineCreate` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. Empty CW first: **0** marks; viewBox **`0 0 792 612`**. `file.id` null.

Desktop line `31359628-…` endpoints **174.24, 183.60 → 435.60, 293.76**; bbox **174.24, 183.60** × **261.36 × 110.16**; length **283.63**; angle **0**. Displayed-space expected **174.24, 183.60 → 435.60, 293.76**. Stale portrait would have been **134.64, 237.60 → 336.60, 380.16**. Tiny click invents **0**; pointercancel invents **0**. viewBox held. 390 Pages rotate not cheap; edge viewBox + `file.id`.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Empty CW first | **0** marks; viewBox **`0 0 792 612`**. |
| New line | `31359628-…` **174.24, 183.60 → 435.60, 293.76**; size **261.36 × 110.16**; length **283.63**; angle **0**; on-page. |
| Not stale 612×792 | **174.24 ≠ 134.64**; **183.60 ≠ 237.60**; **435.60 ≠ 336.60**; **293.76 ≠ 380.16**. |
| Preview | live `<line>` start **174.24, 183.60** (swapped, not stale). |
| viewBox held | **`0 0 792 612`** after create. |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Tiny click | Line down/up, no drag | Invents **0** (3pt gate) |
| pointercancel | Mid rubber-band | Invents **0**; intended line stays |
| `file.id` | `?testPdf=` throughout | **null** |

### Edge

| Slice | Evidence |
|---|---|
| viewBox after empty CW / create | **`0 0 792 612`** |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; 0 marks; Pages rotate / create-after-rotate not cheap |
| hubPreview | Line **0** |

## Official / focused Node

Focused `pageRotateLineCreate` + leftover18 **15 / 15**. Cap **8448** not loosened. Official `npm test` not re-run (no product / high-risk edit). `graphify` CLI absent — skipped.

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

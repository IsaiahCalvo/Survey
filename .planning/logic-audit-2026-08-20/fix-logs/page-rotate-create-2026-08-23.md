# Page-rotate then create new rect / pen on swapped viewBox — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

Remappers fix existing objects. Create after the page is already CW-rotated (`viewBox` `0 0 792 612`) is a different path: rubber-band / live pen uses `screenToSVG` against the live SVG viewBox. Distinct from leftover-18 / X-01 / remapped rect / callout / ink / counter / survey-marker / midpoint / remapped `mt`/`mtr`/`br` clip / remapped-page export. Did **not** pad another remapper kind. Did **not** invent stamp / Forms.

`pageAnnotationReindex.js` not extended. `annotationCreationCommit.js` has no hardcoded 612×792 — geometry is the pointer's viewBox point.

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

No min-viable product diff. After empty CW, pdf.js viewport + SVG `viewBox` are already `0 0 792 612`. Create maps through `screenToSVG` and lands in displayed space. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened. No high-risk file.

## Live-proved

Playwright `e2e-page-rotate-create.spec.mjs` **2 / 2 (9.0s)** on Vite `http://127.0.0.1:5173` (`npm run dev:ui`). Focused Node `pageRotateCreate` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. Empty CW first: **0** marks; viewBox **`0 0 792 612`**. `file.id` null.

Desktop rect `9f5c2449-…` **175.24, 184.60** × **140.56 × 71.44**; angle **0**. Displayed-space expected **174.24, 183.60** (stroke inset). Stale portrait would have been **134.64, 237.60**. Pen `3ac2d2f2-…` centerline **435.60, 153.00** (exact `0.55 × 792`, `0.25 × 612`); `left` **0**; `angle` **0**. Stale portrait would have been **336.60, 198.00**. Tiny click invents **0**; pointercancel invents **0**. viewBox held. 390 Pages rotate not cheap; edge viewBox + `file.id`.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Empty CW first | **0** marks; viewBox **`0 0 792 612`**. |
| New rect | `9f5c2449-…` left/top **175.24, 184.60**; size **140.56 × 71.44**; angle **0**; on-page. |
| Not stale 612×792 | **175.24 ≠ 134.64**; **184.60 ≠ 237.60**. |
| New pen | `3ac2d2f2-…` centerline **435.60, 153.00**; `left` **0**; `angle` **0**. |
| viewBox held | **`0 0 792 612`** after rect and after pen. |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Tiny click | Rectangle down/up, no drag | Invents **0** |
| pointercancel | Mid rubber-band | Invents **0**; intended rect + pen stay |
| `file.id` | `?testPdf=` throughout | **null** |

### Edge

| Slice | Evidence |
|---|---|
| viewBox after empty CW / create | **`0 0 792 612`** |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; 0 marks; Pages rotate / create-after-rotate not cheap |
| hubPreview | Draw **0** |

## Official / focused Node

Focused `pageRotateCreate` + leftover18 **15 / 15**. Cap **8448** not loosened. Official `npm test` not re-run (no product / high-risk edit).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

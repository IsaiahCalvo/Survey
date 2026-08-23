# Page-rotate then create new Counter on swapped viewBox — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

`52d001fd` proved rect+pen create after CW via `screenToSVG`. `e8a2e61a` proved callout fractions. `7beeebd8` proved line bbox + CENTER-relative endpoints. `400deca8` proved textbox `[data-text-preview]` then `isNewText`. Counter create after CW is **`[data-counter-overlay]` click-to-place: `left`/`top` as circle origin + `pointerAngle`** — not `screenToSVG` rubber-band. Distinct from leftover-18 / X-01 / remapped rect / callout / ink / counter / survey-marker / midpoint / remapped `mt`/`mtr`/`br` clip / remapped-page export / rect+pen create / callout create / line create / textbox create. Did **not** pad another remapper kind. Did **not** invent stamp / Forms. Did **not** replay remappers / `mtr` / page-ops.

`pageAnnotationReindex.js` not extended. Overlay `effectiveScale = rect.width / pageW` (`pageW = resolvedPageSize.width`) has no hardcoded 612×792 — geometry is the live `pageSizes` after rotate.

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

No min-viable product diff. After empty CW, pdf.js viewport + SVG `viewBox` are already `0 0 792 612`, and `pageSizes[1]` is `{ width: 792, height: 612 }`. Counter overlay maps through `effectiveScale = rect.width / resolvedPageSize.width`, stores `left = x − r` / `top = y − r`, and stamps `pointerAngle: 225`. Series id is held on the second pin. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened. No high-risk file.

## Live-proved

Playwright `e2e-page-rotate-counter-create.spec.mjs` **2 / 2 (9.0s)** on Vite `http://127.0.0.1:5234` (`npm run dev:ui`). Focused Node `pageRotateCounterCreate` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. Empty CW first: **0** marks; viewBox **`0 0 792 612`**. `file.id` null.

Desktop pin `0ca253d2-…` center **174.24, 183.60** (`left`/`top` **160.24, 169.60**, `r` **14**); `pointerAngle` **225**; series `series-1787469751262` #1. Displayed-space expected **174.24, 183.60**. Stale portrait would have been **134.64, 237.60**. Empty click away invents **0**; second pin `7148e22f-…` **316.80, 257.04** keeps the series (#2); nubbin **225**. viewBox held. 390 Pages rotate not cheap; edge viewBox + `file.id`.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Empty CW first | **0** marks; viewBox **`0 0 792 612`**. |
| New pin | `0ca253d2-…` center **174.24, 183.60**; origin **160.24, 169.60**; `r` **14**; `pointerAngle` **225**; series `series-1787469751262` #1; on-page. |
| Not stale 612×792 | **174.24 ≠ 134.64**; **183.60 ≠ 237.60**. |
| Nubbin | place default **225** (not remapped **315**). |
| viewBox held | **`0 0 792 612`** after create. |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty click away | off overlay | invents **0**; overlay held |
| Second pin | 0.40 × 0.42 | `7148e22f-…` **316.80, 257.04**; same series #2; nubbin **225** |
| `file.id` | `?testPdf=` throughout | **null** |

### Edge

| Slice | Evidence |
|---|---|
| viewBox after empty CW / create | **`0 0 792 612`** |
| `file.id` | `?testPdf=` **null** |
| Series | `series-1787469751262` held across two pins |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; 0 marks; Pages rotate / create-after-rotate not cheap |
| hubPreview | Counter **0** |

## Official / focused Node

Focused `pageRotateCounterCreate` + leftover18 **15 / 15**. Cap **8448** not loosened. Official `npm test` not re-run (no product / high-risk edit). `graphify` update skipped (tests/docs only).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

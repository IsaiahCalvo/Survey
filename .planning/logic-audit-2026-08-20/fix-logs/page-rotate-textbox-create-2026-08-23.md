# Page-rotate then create new Textbox on swapped viewBox — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

`52d001fd` proved rect+pen create after CW via `screenToSVG`. `e8a2e61a` proved callout fractions. `7beeebd8` proved line bbox + CENTER-relative endpoints. Textbox create after CW is **`[data-text-preview]` then `setEditingAnnotation({ isNewText: true })`** — not `SHAPE_CREATION_TOOLS`. Distinct from leftover-18 / X-01 / remapped rect / callout / ink / counter / survey-marker / midpoint / remapped `mt`/`mtr`/`br` clip / remapped-page export / rect+pen create / callout create / line create. Did **not** pad another remapper kind. Did **not** invent stamp / Forms. Did **not** replay remappers / `mtr` / page-ops.

`pageAnnotationReindex.js` not extended. Overlay `effectiveScale = rect.width / resolvedPageSize.width` has no hardcoded 612×792 — geometry is the live `pageSizes` after rotate.

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

No min-viable product diff. After empty CW, pdf.js viewport + SVG `viewBox` are already `0 0 792 612`, and `pageSizes[1]` is `{ width: 792, height: 612 }`. Text overlay maps through `effectiveScale = rect.width / resolvedPageSize.width` (10px gate). Auto-edit scaler is `792 × 612`; drag width is page-space. Tight-fit of "A" is T-01 (`25 × 33`), not this leftover. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened. No high-risk file.

## Live-proved

Playwright `e2e-page-rotate-textbox-create.spec.mjs` **2 / 2 (9.5s)** on Vite `http://127.0.0.1:5233` (`npm run dev:ui`). Focused Node `pageRotateTextboxCreate` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. Empty CW first: **0** marks; viewBox **`0 0 792 612`**. `file.id` null.

Desktop textbox `63b106a4-…` auto-edit **142.56, 146.88** × **269.28** (scaler **792 × 612**); commit **142.56, 146.88** × **25 × 33** (`A`, `Helvetica`); angle **0**. Displayed-space expected **142.56, 146.88** × **269.28**. Stale portrait would have been **110.16, 190.08** × **208.08**. Sub-10px band invents **0**; tool-switch invents **0**. viewBox held. 390 Pages rotate not cheap; edge viewBox + `file.id`.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Empty CW first | **0** marks; viewBox **`0 0 792 612`**. |
| New textbox | `63b106a4-…` edit **142.56, 146.88** × **269.28**; commit **25 × 33** `A` `Helvetica`; angle **0**; on-page. |
| Not stale 612×792 | **142.56 ≠ 110.16**; **146.88 ≠ 190.08**; drag **269.28 ≠ 208.08**. |
| Auto-edit | `[data-text-edit-overlay]` scaler **792 × 612**; contenteditable mounted. |
| viewBox held | **`0 0 792 612`** after create. |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Sub-10px band | 4×3 px move | rubber-band **0**; Escape discard invents **0** |
| Tool-switch | V mid-drag | preview **0**; overlay **0**; invents **0** |
| `file.id` | `?testPdf=` throughout | **null** |

### Edge

| Slice | Evidence |
|---|---|
| viewBox after empty CW / create | **`0 0 792 612`** |
| `file.id` | `?testPdf=` **null** |
| Letter | typed **A**; tight-fit **25 × 33** |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; 0 marks; Pages rotate / create-after-rotate not cheap |
| hubPreview | Text **0** |

## Official / focused Node

Focused `pageRotateTextboxCreate` + leftover18 **15 / 15**. Cap **8448** not loosened. Official `npm test` not re-run (no product / high-risk edit). `graphify` update skipped (tests/docs only).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

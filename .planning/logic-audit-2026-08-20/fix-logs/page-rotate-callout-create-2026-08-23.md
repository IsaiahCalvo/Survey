# Page-rotate then create new callout on swapped viewBox — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

`52d001fd` proved rect+pen create after CW via `screenToSVG`. Callout create after CW stores **0–1 fractions** of the current page (`120 / W` × `32 / H`). Distinct from leftover-18 / X-01 / remapped rect / callout / ink / counter / survey-marker / midpoint / remapped `mt`/`mtr`/`br` clip / remapped-page export / rect+pen create. Did **not** pad another remapper kind. Did **not** invent stamp / Forms.

`pageAnnotationReindex.js` not extended. `createCallout` stores the fractions it is given; `SVGAnnotationLayer` divides live `screenToSVG` points by the current `width`/`height` (already `792×612` after empty CW).

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

No min-viable product diff. After empty CW, pdf.js viewport + SVG `viewBox` are already `0 0 792 612`. Callout commit divides by live `W`/`H` (`120 / 792` × `32 / 612` = **0.15152 × 0.05229**), not stale **0.19608 × 0.04040**. Box / knee land in displayed space; handles hittable. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened. No high-risk file.

## Live-proved

Playwright `e2e-page-rotate-callout-create.spec.mjs` **2 / 2 (9.7s)** on Vite `http://127.0.0.1:5173` (`npm run dev:ui`). Focused Node `pageRotateCalloutCreate` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. Empty CW first: **0** callouts; viewBox **`0 0 792 612`**. `file.id` null.

Desktop callout `e3b9ee99-…` arrow **0.160 × 0.220** / box **0.440 × 0.420** / **0.15152 × 0.05229** (120 × 32). Displayed **126.72, 134.64** / **348.48, 257.04**. Stale portrait would have been **0.207** / **0.19608 × 0.04040**. Knee **0.205 × 0.249**; `knee` + `textBox-br` on-page and hittable. Tiny click invents **0**; tool-switch mid-drag invents **0**. viewBox held. 390 Pages rotate not cheap; edge viewBox + `file.id`.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Empty CW first | **0** callouts; viewBox **`0 0 792 612`**. |
| New callout | `callout-e3b9ee99-…` arrow **0.160 × 0.220**; box **0.440 × 0.420**; size **0.15152 × 0.05229**; `Arial`. |
| Not stale 612×792 | **0.15152 ≠ 0.19608**; **0.05229 ≠ 0.04040**; arrow **0.160 ≠ 0.207**. |
| Displayed space | arrow **126.72, 134.64**; box **348.48, 257.04** × **120 × 32**; on-page. |
| Handles | `knee` + `textBox-br` on-page and hittable. |
| viewBox held | **`0 0 792 612`** after create. |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Tiny click | Callout down/up, no drag | Invents **0** (4px gate) |
| Tool-switch | `v` mid-drag | preview **0**; invents **0**; intended callout stays |
| `file.id` | `?testPdf=` throughout | **null** |

### Edge

| Slice | Evidence |
|---|---|
| viewBox after empty CW / create | **`0 0 792 612`** |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; 0 callouts; Pages rotate / create-after-rotate not cheap |
| hubPreview | Callout **0** |

## Official / focused Node

Focused `pageRotateCalloutCreate` + leftover18 **15 / 15**. Cap **8448** not loosened. Official `npm test` not re-run (no product / high-risk edit). `graphify` CLI absent — skipped.

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

# Local History restore after page CW — leftover types — 2026-08-23

Named leftover after rect (`d3fa11a1`) + ink (`c44a07ed`) History restore after CW. A-07 click-restore was proved before the remappers — that is not this path. Named Save version / Restore stay leftover-18 **X-01**. Distinct from leftover-18 / X-01 / remapped rect+ink History Restore / remapped-page export / create-after-rotate (not replayed). Did **not** invent cloud versions. Did **not** stamp `file.id`. Did **not** invent remappers.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_*` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| Coordinator lease | **none** |
| `.bot-credentials.json` | **none** |

## Product

Line delete snapshots store Fabric `left`/`top` as **`-0.00002`** while remapped `data.left`/`data.top` hold the displayed origin (`480.96`, `120.24`). `stampDisplayedPlacement` and `displayedBoxOrigin` only lifted exact `=== 0`. Min-viable: treat `|own| < 1` as the same placeholder. Files: `annotationLocalHistory.js`, `svgBoundingBox.js`. High-risk files untouched.

## Live-proved

Playwright `e2e-page-rotate-history-restore-remaining.spec.mjs` on Vite `http://127.0.0.1:5188` (`npm run dev:ui`). `?testPdf=clickable-link-test.pdf`. viewBox after CW **`0 0 792 612`**. `file.id` null. Cloud History **0**.

| Type | Result |
|---|---|
| Callout `callout-9edbb89a-…` | **proved** — box center **329.28, 348.64 → 443.36, 329.28**; Restore kept remapped fractions |
| Line `b495d3da-…` | **proved** — **183.60, 237.60 → 554.40, 183.60**; Restore kept remapped left **480.96** (not near-zero) |
| Textbox `a3c183d7-…` | **proved** — **306.26, 174.90 → 617.10, 306.26**; `Helvetica` |
| Survey-marker `surveyMarker-8e856b21-…` | **proved** — **373.32, 427.68 → 364.32, 373.32** |
| Counter `0d1421d0-…` | **unreachable** — remapped + Delete; History rows are "made an edit" with **no** Restore |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; Pages rotate / History restore-after-remap not cheap |

Create-event omits Restore. Second Restore invents **0**. Collapse/dismiss does not apply.

## Official / focused Node

Focused `pageRotateHistoryRestoreRemaining` + leftover18 **20 / 20**. Cap **8448** / 75/250 not loosened. Official `npm test` not re-run (no high-risk edit).

## Leftover-18

Still parked. Goal stays OPEN.

# Page-rotate remapped-page pen/highlighter ink after CW — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0. Did **not** replay remapped callout fractions or remapped `mt` / `mtr` / `br` clip.

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

Live `createProductionPaperInk` stores `path` + `paperCenterline` in page space (`left: 0`, `top: 0`). After page CW the viewBox swaps to `0 0 792 612`, but `rotateFabricLikeObject` only remapped the fabric bbox (origin 0,0 + outline w×h) and invented `angle: 90`. SVG still painted the old page-space commands, so the stroke sat in pre-rotate space.

Min-viable in `src/utils/pageAnnotationReindex.js`:

- `rotatePageSpaceInk` / `isPageSpaceInk` — remap path commands, `paperCenterline`, and `polygons` through the same displayed-space point contract as rect. Keep `left/top` 0. Do not invent an object angle.
- Line endpoints stay local (bbox + angle; not rewritten). Empty rotate invents 0. Opposite delta restores.

Did **not** replay remapped callout fractions or remapped `mt`/`mtr`/`br` clamp. Counter nubbin still treats `left/top` as center when `width/height` are missing and does not remap `pointerAngle` — next unique kind, not this leftover. CORS `*` / `zoomGeneration` / SVG viewBox zoom / container-aware canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened. No high-risk 34k-line edit.

## Live-proved

Playwright `e2e-page-rotate-ink-remap.spec.mjs` **2 / 2 (9.4s)** on Vite `http://localhost:5173`. Focused Node `pageRotateInkRemap` + `pageRotateCalloutRemap` + leftover18 **24 / 24**.

`?testPdf=clickable-link-test.pdf`. After CW: `viewBox` **`0 0 792 612`**. `file.id` null.

Desktop pen `8edda8ba-…` centerline **134.64, 237.60**. CW maps **134.64, 237.60 → 554.40, 134.64** (exact displayed-space +90). `left` **0**; `angle` **0**. CCW restores **134.64, 237.60**. Empty CW/CCW invents **0**. 390 Pages rotate not cheap; edge viewBox + `file.id` + 0 marks.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Live create | pen `8edda8ba-…` centerline **134.64, 237.60**; `left` **0**; `angle` **0**. |
| Page rotate CW | Same id; centerline **554.40, 134.64**; viewBox **`0 0 792 612`**. |
| Not pre-rotate point | **134.64 → 554.40**. |
| No invented angle | `angle` stays **0**. |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page rotate | CW then CCW before create | invents **0** |
| Opposite page rotate | CCW after CW | restores **134.64, 237.60** / viewBox **`0 0 612 792`** |

### Edge

| Slice | Evidence |
|---|---|
| viewBox | `0 0 612 792` → `0 0 792 612` → restored |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; ink **0**; Pages rotate not cheap |
| hubPreview | Pen **0**; annotation layer **0** |

## Official / focused Node

Focused `pageRotateInkRemap` + `pageRotateCalloutRemap` + leftover18 **24 / 24**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk 34k-line edit).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

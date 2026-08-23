# Page-rotate remapped-page counter pin after CW — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0. Did **not** replay remapped ink / callout / `mt` / `mtr` / `br` clip.

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

Live Counter create stores `left`/`top` as the circle top-left (`x - radius`) and omits `width`/`height`. `pointerAngle` (3-o'clock, default **225**) aims the nub. After page CW the viewBox swaps to `0 0 792 612`, but `rotateFabricLikeObject` treated missing `width`/`height` as 0 so `left`/`top` was remapped as the center, and `pointerAngle` stayed 225. The pin jumped by ~radius and the nub aimed at pre-rotate page space.

Min-viable in `src/utils/pageAnnotationReindex.js`:

- `rotatePageSpaceCounter` / `isCounterPin` — remap the displayed visual center (`left+r`, `top+r`) through the same contract as rect. Add delta to `data.pointerAngle`. Do not invent an object angle (bubble stays circular).
- Series ids are copied through. Empty rotate invents 0. Opposite delta restores.

Did **not** replay remapped ink / callout / `mt`/`mtr`/`br` clamp. Did **not** replay Counter Start / series Delete / nubbin pointercancel. CORS `*` / `zoomGeneration` / SVG viewBox zoom / container-aware canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened. No high-risk 34k-line edit.

## Live-proved

Playwright `e2e-page-rotate-counter-remap.spec.mjs` **2 / 2 (10.4s)** on Vite `http://localhost:5173`. Focused Node `pageRotateCounterRemap` + `pageRotateInkRemap` + leftover18 **25 / 25**.

`?testPdf=clickable-link-test.pdf`. After CW: `viewBox` **`0 0 792 612`**. `file.id` null.

Desktop pin `e79712a1-…` center **134.64, 237.60**. CW maps **134.64, 237.60 → 554.40, 134.64** (exact displayed-space +90). `pointerAngle` **225 → 315**. Second pin `286d0aeb-…` keeps `series-1787465247246`. CCW restores **134.64, 237.60** / **225**. Empty CW/CCW invents **0**. 390 Pages rotate not cheap; edge viewBox + `file.id` + 0 marks.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Live create | pin `e79712a1-…` center **134.64, 237.60**; `pointerAngle` **225**; no `width`/`height`. |
| Page rotate CW | Same id; center **554.40, 134.64**; `pointerAngle` **315**; viewBox **`0 0 792 612`**. |
| Not left/top-as-center | remapped center is **554.40**, not the stale-origin **~568**. |
| Series held | second pin `286d0aeb-…` same `series-1787465247246`. |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page rotate | CW then CCW before create | invents **0** |
| Opposite page rotate | CCW after CW | restores **134.64, 237.60** / **225** / viewBox **`0 0 612 792`** |
| Second pin | drop while tool stays armed | same series id after CW |

### Edge

| Slice | Evidence |
|---|---|
| viewBox | `0 0 612 792` → `0 0 792 612` → restored |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; counters **0**; Pages rotate not cheap |
| hubPreview | Counter **0**; annotation layer **0** |

## Official / focused Node

Focused `pageRotateCounterRemap` + `pageRotateInkRemap` + leftover18 **25 / 25**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk 34k-line edit).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

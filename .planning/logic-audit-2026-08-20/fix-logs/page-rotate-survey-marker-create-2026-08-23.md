# Page-rotate then create new survey-marker on swapped viewBox — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

`52d001fd` proved rect+pen create after CW via `screenToSVG`. `e8a2e61a` proved callout fractions. `7beeebd8` proved line bbox + CENTER-relative endpoints. `400deca8` proved textbox `[data-text-preview]` then `isNewText`. `48ad5243` proved Counter `[data-counter-overlay]` click-to-place. Survey-marker create after CW is **`SHAPE_CREATION_TOOLS` rubber-band via `screenToSVG` then `onSurveyMarkerCreated({ x, y, width, height })` into `bounds {x,y,width,height,angle}`** — not Fabric `left`/`top`, not Counter origin + `pointerAngle`. Uses compiled-in `surveyTransitionE2E` Walls (no invented checklist seed). Distinct from leftover-18 / X-01 / remapped rect / callout / ink / counter / survey-marker / midpoint / remapped `mt`/`mtr`/`br` clip / remapped-page export / rect+pen create / callout create / line create / textbox create / counter create. Did **not** pad another remapper kind. Did **not** invent stamp / Forms. Did **not** replay remappers / `mtr` / page-ops.

`pageAnnotationReindex.js` not extended. `screenToSVG` reads the live SVG CTM / `viewBox` — no hardcoded 612×792.

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

No min-viable product diff. After empty CW, pdf.js viewport + SVG `viewBox` are already `0 0 792 612`. Survey-marker rubber-band maps through `screenToSVG` into `bounds {x,y,width,height}`; create does not invent `bounds.angle` (stays **0**). Second id is held. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened. No high-risk file.

## Live-proved

Playwright `e2e-page-rotate-survey-marker-create.spec.mjs` **2 / 2 (8.4s)** on Vite `http://127.0.0.1:5235` (`npm run dev:ui`). Focused Node `pageRotateSurveyMarkerCreate` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Empty CW first: **0** marks; viewBox **`0 0 792 612`**. `file.id` null.

Desktop marker `surveyMarker-0c93e4c7-…` bounds **174.24, 183.60** × **190.08 × 110.16** (center **269.28, 238.68**); angle **0**. Store is `bounds` (`left`/`top` absent). Displayed-space expected **174.24, 183.60**. Stale portrait would have been **134.64, 237.60** (center **208.08, 308.88**). Tiny click invents **0**; pointercancel invents **0**; second marker `surveyMarker-01bd014b-…` **411.84, 220.32** keeps its id. viewBox held. 390 Pages rotate not cheap; edge viewBox + `file.id`.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Empty CW first | **0** marks; viewBox **`0 0 792 612`**. |
| New marker | `surveyMarker-0c93e4c7-…` **174.24, 183.60** × **190.08 × 110.16**; center **269.28, 238.68**; angle **0**; on-page. |
| Store | `bounds` only; no Fabric `left`/`top`. |
| Not stale 612×792 | **174.24 ≠ 134.64**; **183.60 ≠ 237.60**; center **269.28 ≠ 208.08**. |
| viewBox held | **`0 0 792 612`** after create. |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Tiny click | 2pt size gate | invents **0**; no name dialog |
| pointercancel | mid-drag | invents **0**; no name dialog |
| Second marker | 0.52 × 0.36 → 0.74 × 0.54 | `surveyMarker-01bd014b-…` **411.84, 220.32**; new id held |
| `file.id` | `?testPdf=` throughout | **null** |

### Edge

| Slice | Evidence |
|---|---|
| viewBox after empty CW / create | **`0 0 792 612`** |
| `file.id` | `?testPdf=` **null** |
| Second id | `surveyMarker-01bd014b-…` held |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; 0 marks; Pages rotate / create-after-rotate not cheap |
| hubPreview | Walls **0** |

## Official / focused Node

Focused `pageRotateSurveyMarkerCreate` + leftover18 **15 / 15**. Cap **8448** not loosened. Official `npm test` not re-run (no product / high-risk edit). `graphify` update skipped (tests/docs only).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

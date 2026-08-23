# Page-rotate remapped-page survey-marker bounds after CW — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0. Did **not** replay remapped counter / ink / callout / `mt` / `mtr` / `br` clip.

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

Live survey-marker place (compiled-in `surveyTransitionE2E` Walls; no invented checklist seed) stores geometry only in `bounds {x,y,width,height,angle}`. `transformPageState` ran `rotateFabricLikeObject` on the marker object, which looks for Fabric `left`/`top` and left `bounds` in pre-rotate space after viewBox `0 0 792 612`.

Min-viable in `src/utils/pageAnnotationReindex.js`:

- `rotateSurveyMarkerBounds` / `isSurveyMarkerBounds` — remap the displayed visual center through the same contract as rect. Add delta to `bounds.angle`. Do not invent Fabric `left`/`top` on the marker.
- Unlocated markers without bounds stay untouched. Empty rotate invents 0. Opposite delta restores.

Did **not** replay remapped counter / ink / callout / `mt`/`mtr`/`br` clamp. CORS `*` / `zoomGeneration` / SVG viewBox zoom / container-aware canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened. No high-risk 34k-line edit.

## PDF links (hunted, not this leftover)

Existing `clickable-link-test.pdf` links are engine-owned (`PdfjsLinkLayer` + baked `/Rotate` viewport). After CW the `https://claude.com/` hit stayed on the glyph: fractions **11.76/16.79 × 35.95×3.03 → 80.18/11.76 × 3.03×35.95**; relative center **0.297 / 0.183 → 0.817 / 0.297**. No remapper invented. Not receipted as a unique kind.

## Live-proved

Playwright `e2e-page-rotate-survey-marker-remap.spec.mjs` **2 / 2 (10.1s)** on Vite `http://localhost:5173`. Focused Node `pageRotateSurveyMarkerRemap` + `pageRotateCounterRemap` + leftover18 **26 / 26**.

`?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. After CW: `viewBox` **`0 0 792 612`**. `file.id` null.

Desktop marker `surveyMarker-0fd63f67-…` center **208.08, 308.88**. CW maps **208.08, 308.88 → 483.12, 208.08** (exact displayed-space +90). `bounds.angle` **0 → 90**. Second marker `surveyMarker-7ab4427a-…` keeps its id. CCW restores. Empty CW/CCW invents **0**. 390 Pages rotate not cheap; edge viewBox + `file.id` + 0 marks.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Live create | marker `surveyMarker-0fd63f67-…` center **208.08, 308.88**; `146.88 × 142.56`; angle **0**. |
| Page rotate CW | Same id; center **483.12, 208.08**; angle **90**; viewBox **`0 0 792 612`**. |
| Not pre-rotate bounds | remapped origin **409.68, 136.80**, not stale **134.64, 237.60**. |
| Second id held | `surveyMarker-7ab4427a-…` stays after CW. |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page rotate | CW then CCW before create | invents **0** |
| Opposite page rotate | CCW after CW | restores **208.08, 308.88** / **0** / viewBox **`0 0 612 792`** |
| Second marker | place while Walls stays armed | same id after CW |

### Edge

| Slice | Evidence |
|---|---|
| viewBox | `0 0 612 792` → `0 0 792 612` → restored |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; markers **0**; Pages rotate not cheap |
| hubPreview | Walls **0**; annotation layer **0** |

## Official / focused Node

Focused `pageRotateSurveyMarkerRemap` + `pageRotateCounterRemap` + leftover18 **26 / 26**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk 34k-line edit).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

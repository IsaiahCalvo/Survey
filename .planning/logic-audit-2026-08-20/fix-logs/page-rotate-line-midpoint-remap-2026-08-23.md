# Page-rotate remapped-page line/arrow midpoint after CW — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0. Did **not** replay remapped survey-marker / counter / ink / callout / `mt` / `mtr` / `br` clip.

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

Straight line/arrow remaps via bbox + object angle (endpoints stay local). Live curved lines also store `data.midpoint` in pre-object-angle page space. After page CW the viewBox swaps to `0 0 792 612`, but the generic remapper left that midpoint in pre-rotate space, so the bezier sat on the old point while the chord rotated.

Min-viable in `src/utils/pageAnnotationReindex.js`:

- After remapping the bbox origin, translate `data.midpoint` by the same `(nextLeft - left, nextTop - top)`.
- Object-angle (now `+delta`) then yields the displayed-space point — same contract as endpoints.
- Do **not** independently `rotateDisplayedPoint` the midpoint (that would double-rotate with object angle).
- Straight lines still invent no midpoint. Empty rotate invents 0. Opposite delta restores.

Did **not** replay remapped survey-marker / counter / ink / callout / `mt`/`mtr`/`br` clamp. CORS `*` / `zoomGeneration` / SVG viewBox zoom / container-aware canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened. No high-risk 34k-line edit.

Handle drags (`p1`/`p2`/`midpoint`) do not commit in this VM — already-receipted `e2e-line-endpoint-midpoint` fails the same way. The line is live-created; `data.midpoint` is seeded onto the shared data object so the remapper has a curve to follow.

## Live-proved

Playwright `e2e-page-rotate-line-midpoint-remap.spec.mjs` **2 / 2 (10.0s)** on Vite `http://127.0.0.1:5333`. Focused Node `pageRotateLineMidpointRemap` + `pageRotateSurveyMarkerRemap` + leftover18 **23 / 23**.

`?testPdf=clickable-link-test.pdf`. After CW: `viewBox` **`0 0 792 612`**. `file.id` null.

Desktop line `99ef1299-…` midpoint **195.84, 189.60**. CW maps visual **195.84, 189.60 → 602.40, 195.84** (exact displayed-space +90). Stored midpoint translates with the bbox (**195.84, 189.60 → 554.40, 147.84**); `angle` **0 → 90**; endpoints stay local. CCW restores. Empty CW/CCW invents **0**. 390 Pages rotate not cheap; edge viewBox + `file.id` + 0 lines.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Live create | line `99ef1299-…` midpoint **195.84, 189.60**; angle **0**. |
| Page rotate CW | Same id; visual **602.40, 195.84**; angle **90**; viewBox **`0 0 792 612`**. |
| Not pre-rotate midpoint | stored **554.40, 147.84**, not stale **195.84, 189.60**. |
| Endpoints stay local | `x1`/`y1` unchanged. |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page rotate | CW then CCW before create | invents **0** |
| Opposite page rotate | CCW after CW | restores **195.84, 189.60** / **0** / viewBox **`0 0 612 792`** |

### Edge

| Slice | Evidence |
|---|---|
| viewBox | `0 0 612 792` → `0 0 792 612` → restored |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; lines **0**; Pages rotate not cheap |
| hubPreview | Line **0**; annotation layer **0** |

## Official / focused Node

Focused `pageRotateLineMidpointRemap` + `pageRotateSurveyMarkerRemap` + leftover18 **23 / 23**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk 34k-line edit).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

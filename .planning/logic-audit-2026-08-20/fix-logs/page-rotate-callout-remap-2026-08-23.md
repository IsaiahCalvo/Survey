# Page-rotate remapped-page callout 0–1 fractions after CW — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0. Did **not** replay remapped `mt` / `mtr` / `br` clip.

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

Live `createCallout` stores box / knee / arrow as 0–1 page fractions (`120 / W`, `32 / H`). `deriveCalloutsFromByPage` reads `data.legacyCallout` verbatim. After page CW the viewBox swaps to `0 0 792 612`, but `rotateFabricLikeObject` only remapped the fabric group bbox (visual-center + angle). SVG still multiplied the old fractions by the new page size, so knee / box sat in the wrong place.

Min-viable in `src/utils/pageAnnotationReindex.js`:

- `rotateNormalizedPoint` / `rotateNormalizedBox` / `rotateCalloutFractions` — same visual-center contract as rect (remap pixel center, keep pixel w×h, re-express as fractions of the swapped page).
- Callout path remaps `data.legacyCallout` + `data.legacyNormalizedCoords`, rebuilds children, recomputes group bbox. No invented angle (SVG callouts stay axis-aligned).
- Line endpoints stay local (not rewritten). Empty rotate invents 0. Opposite delta restores.

Did **not** replay remapped `mt`/`mtr`/`br` clamp. Shift+45 after object-180 still not cheap (`mtr` screen x −516). CORS `*` / `zoomGeneration` / SVG viewBox zoom / container-aware canvas sizing / Fabric `fontFamily` untouched. 8448 / 75/250 not loosened. No high-risk 34k-line edit.

## Live-proved

Playwright `e2e-page-rotate-callout-remap.spec.mjs` **2 / 2 (10.0s)** on Vite `http://localhost:5173`. Focused Node `pageRotateCalloutRemap` + `pageRotateRemapResize` + leftover18 **28 / 28**.

`?testPdf=clickable-link-test.pdf`. After CW: `viewBox` **`0 0 792 612`**. `file.id` null.

Desktop callout `829bb374-…` box **0.440 × 0.420** / **0.19608 × 0.04040** (120 × 32). Center **329.28, 348.64 → 443.36, 329.28** (exact displayed-space +90). Post-rotate fractions **0.484 × 0.512** / **0.15152 × 0.05229** (pixel size held). Knee + `textBox-br` on-page and hittable. CCW restores **0.440 × 0.420**. Empty CW/CCW invents **0**. 390 Pages rotate not cheap; edge viewBox + `file.id` + 0 marks.

### Intended — **pass**

| Slice | Evidence |
|---|---|
| Live create | `callout-829bb374-…` box **0.19608 × 0.04040**. |
| Page rotate CW | Same id; center **443.36, 329.28**; viewBox **`0 0 792 612`**. |
| Not pre-rotate fractions | box **0.440 → 0.484**. |
| Knee / box hit | `knee` + `textBox-br` on remapped page. |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page rotate | CW then CCW before create | invents **0** |
| Opposite page rotate | CCW after CW | restores **0.440 × 0.420** / viewBox **`0 0 612 792`** |

### Edge

| Slice | Evidence |
|---|---|
| viewBox | `0 0 612 792` → `0 0 792 612` → restored |
| `file.id` | `?testPdf=` **null** |
| 390 | viewBox **`0 0 612 792`**; `file.id` null; callouts **0**; Pages rotate not cheap |
| hubPreview | Callout **0**; annotation layer **0** |

## Official / focused Node

Focused `pageRotateCalloutRemap` + `pageRotateRemapResize` + leftover18 **28 / 28**. Cap **8448** not loosened. Official `npm test` not re-run (no high-risk 34k-line edit).

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

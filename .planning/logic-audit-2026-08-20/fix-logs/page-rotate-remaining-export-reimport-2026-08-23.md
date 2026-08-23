# Page-rotate remapped remaining types then export → `?testPdf=` re-import — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

`649e75f2` rect, `a3e9bcff` ink, `ed08b9ed` callout already covered serialize after Pages CW. This pass is the remaining type-unproved siblings: **line**, **textbox**, **counter**, **survey-marker**. Remappers already bake geometry; this is export → `?testPdf=` re-import. Distinct from leftover-18 / X-01 / remapped-live / create-after-CW / rect/ink/callout export-after-rotate. Did **not** invent flatten / stamp / Forms / dest-XYZ.

No product strip-on-import this turn. Combined four-type create hid canvas marks once Walls was armed (survey visibility, not a remapper hole). Isolated proofs. Survey-marker re-import paints after `surveyTransitionE2E` + Walls (hidden layer is excluded from native Annots). CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. High-risk files untouched.

## X-01 glance (names only)

| Check | Result |
|---|---|
| Process `VITE_DEV_AUTO_LOGIN_EMAIL` / `PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` | **absent** |
| `.env.local` those three names | **PRESENT** (gitignored; values not printed) |
| Coordinator lease | **none** |
| `file.id` | **null** on `?testPdf=` |

Did **not** invent a lease or cloud-write.

## Live-proved

Playwright `e2e-page-rotate-remaining-export-reimport.spec.mjs` **5 / 5 (28.3s)** on Vite `http://localhost:5173`. Focused Node `pageRotateRemainingExportReimport` + leftover18 **16 / 16**.

`?testPdf=clickable-link-test.pdf` (+ `surveyTransitionE2E=1` for survey-marker). After CW / re-import: viewBox **`0 0 792 612`**. Wipe-reload original: **`0 0 612 792`**. `file.id` null.

| Type | Id | Created (page pt) | After CW | Re-import |
|---|---|---|---|---|
| Line | `7f355571-…` | **110.16, 174.24** | **617.76, 110.16** | same id + remapped start |
| Textbox | `c6f849a8-…` | center **306.26, 174.90** | **617.10, 306.26** | same id; `Helvetica` |
| Counter | `3c81d574-…` | center **171.36, 411.84**; nub **225** | **380.16, 171.36**; nub **315** | same id + remapped center |
| Survey-marker | `surveyMarker-d8abd2bf-…` | center **373.32, 427.68** | **364.32, 373.32** | same id + remapped bounds |

### Intended — **pass**

Live create → Pages CW remaps displayed-space point → local cache → Export → `?testPdf=` re-import keeps **same id** + remapped placement + swapped viewBox.

### Break — **pass**

Empty export still downloads; cancel invents **0**. Wipe `annotationsByPage_*` / `surveyMarkers_*` then reload original fixture invents **0**; viewBox **`0 0 612 792`**. `file.id` null.

### Edge

390: viewBox + `file.id` + 0 marks; Pages rotate / Export overflow not cheap. hubPreview Draw **0**.

## Official / focused Node

Focused `pageRotateRemainingExportReimport` + leftover18 **16 / 16**. Cap **8448** / 75/250 not loosened. High-risk files untouched; official `npm test` not re-run.

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.

Export-after-rotate type siblings named in the last hunt are now proved (rect, ink, callout, line, textbox, counter, survey-marker).

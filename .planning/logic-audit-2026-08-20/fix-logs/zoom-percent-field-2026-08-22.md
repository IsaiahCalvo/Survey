# Live UL-06 leftover: Zoom % edit field — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after C-04 Color spectrum HSV (`2566a12b`). Prior UL-06 was `e2e-unlisted-live` sample only (200 / 0→min / 9999→4000 / 50→min). V-04 keyboard + Fit width and Fit height already have dedicated intended+break+edge. The typeable rail field never had Escape / empty / letters / append / 390-absent. Not leftover-18. Did **not** replay the 96 proved IDs. Did **not** invent flatten / stamp / Forms.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

Min-viable in `src/PDFViewer.jsx` zoom-input commit:

- `commitZoomInput(liveValue)` prefers the live input (same-tick fill / last keystroke).
- Escape restores the live scale and sets `skipZoomInputCommitRef` so blur does **not** apply the typed draft.
- Without the skip, Escape `setState` is async and blur committed 333 after a restore-to-200.

High-risk file: surgical handler only. No `file.id` stamp. SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched.

## Live-proved

Playwright `e2e-zoom-percent-field.spec.mjs` **2 / 2 (13.5s)** on Vite `http://127.0.0.1:5173`. Focused Node `zoomPercentField` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop Edit zoom percentage. Type **200** + Enter writes 200% and grows the page vs Fit page. Click-away **250** commits. Fit page / Fit width `data-active` false after a typed %. Fit page baseline **100%**.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| 0 / 1 / 50 | Enter | lift to **100** (same engine dynamic min as Fit page) |
| 9999 | sequential type | field **4000**; Enter stays 4000; Fit page leaves the ceiling |
| empty / `abc` | Enter | restore last live % |
| Escape | typed 333 | restore; **not** commit 333 |
| append | ArrowRight + `2` on 200 | field `2002`; Escape restores |

### Edge

| Slice | Evidence |
|---|---|
| Isolation | page-1 rect survives 200% |
| Pen-armed | 175 commits; invents 0 |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Edit zoom percentage **0**; Draw **0** |
| 120-page | typed 200 stays page 1 |
| 390 | Edit zoom percentage **0**; Zoom and fit options stays |

## Official / focused Node

Focused `zoomPercentField` + leftover18 **15 / 15**. High-risk `PDFViewer.jsx` touched. Official `npm test` **exit 1**: main files + isolated `annotationDocConcurrency` / `partialEraseCurveLocality` **15 / 15** proceeded; isolated `partialEraserComplexity` **9 / 10** — leftover `500 crossing cuts` **11961.79 MiB > 8448.00 MiB**. Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

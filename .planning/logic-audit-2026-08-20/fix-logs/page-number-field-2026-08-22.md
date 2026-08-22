# Live UL-07 leftover: page number edit field — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after UL-06 Zoom % field (`a03290e7`). Prior UL-07 was `e2e-unlisted-live` sample only (0+99 stay 1; jump 3) plus thumbnail-click contrast (type 8 vs thumb 3). V-05 keyboard and V-06 thumbnail already have dedicated intended+break+edge. The typeable rail / 390 field never had Escape / empty / letters / append. Not leftover-18. Did **not** replay the 96 proved IDs. Did **not** invent flatten / stamp / Forms. Did **not** redo Zoom %.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

Min-viable in `src/PDFViewer.jsx` page-input commit:

- `commitPageInput(liveValue)` prefers the mounted input (same-tick fill / last keystroke).
- Escape restores the live page and sets `skipPageInputCommitRef` so blur does **not** apply the typed draft.
- Without the skip, Escape `setState` is async and blur committed 8 after a restore-to-1.

High-risk file: surgical handler only. No `file.id` stamp. SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched.

## Live-proved

Playwright `e2e-page-number-field.spec.mjs` **2 / 2 (14.2s)** on Vite `http://127.0.0.1:5173`. Focused Node `pageNumberField` + leftover18 **15 / 15**.

`?testPdf=spike-120-pages.pdf` + `clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop Edit page number. Type **8** + Enter writes page 8. Click-away **12** commits.

### Break

| Control | Input | Result |
|---|---|---|
| 0 / 121 | Enter | restore live page |
| empty / `abc` | Enter | restore last live page |
| Escape | typed 8 | restore; **not** commit 8 |
| append | ArrowRight + `2` on 1 | field `12`; Escape restores |

### Edge

| Slice | Evidence |
|---|---|
| Isolation | page-1 rect survives jump 8 → 1 |
| Pen-armed | 3 commits; invents 0 |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Edit page number **0**; Draw **0** |
| 1-page | 0 / 99 stay 1 |
| 390 | Jump to page + field; type 8; Escape no-commit 12 |

## Official / focused Node

Focused `pageNumberField` + leftover18 **15 / 15**. High-risk `PDFViewer.jsx` touched. Official `npm test` **exit 1**: main files + isolated `annotationDocConcurrency` / `partialEraseCurveLocality` proceeded; isolated `partialEraserComplexity` **9 / 10** — leftover `500 crossing cuts` **11963.03 MiB > 8448.00 MiB**. Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

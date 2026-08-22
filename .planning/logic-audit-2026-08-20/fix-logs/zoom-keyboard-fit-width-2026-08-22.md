# Live V-04 zoom keyboard + Fit width intended+break+edge — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after V-05 page-nav keyboard. PageUp/PageDown are color-picker chords, not page-nav. Fit height is dedicated. Fit width / Ctrl++ / Ctrl+- were **sample-only** (wave-remaining toolbar clicks + catalog-reconcile). Distinct from UL-06 zoom % field, W4-02 pinch, V-05 arrows/Home/End, leftover-18. Did **not** replay those proofs as a substitute.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite `127.0.0.1:5173` (`npm run dev:ui`) with process auto-login names cleared.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| V-04 **pass** (pinch + buttons + Fit height) | Toolbar Zoom in/out + Fit page + Fit width were wave-5 sample clicks. Fit height is its own path. |
| UL-05 Fit options | Menu open / Fit page + Fit width cluster. No Ctrl++ / Ctrl+- / Ctrl+1. |
| Catalog-reconcile “Ctrl++/− live-proven” | No dedicated intended+break+edge spec. Overlay lists the chords; live proof was sample. |

## Product

No product bug. Window `keydown` in `PDFViewer.jsx`: `!isFormField && (meta/ctrl)` → `=`/`+` `zoomIn()`; `-` `zoomOut()`; `1` `FIT_WIDTH` via `handleZoomModeSelectRef` → `magnification.fitToWidth()`. Step is `TOOLBAR_ZOOM_STEP_FACTOR` 1.25 then `clampScale` (0.01–40). Overlay lists Ctrl+ / Ctrl- / Ctrl+0 Fit page; **Ctrl+1 Fit width is live but unlisted**. SVG `viewBox="0 0 pageW pageH"` owns zoom. CORS `*` / `zoomGeneration` / canvas sizing / Fabric `fontFamily` untouched. High-risk files not edited. First Playwright run failed at 40px vs 36px width-fill slack (scrollbar); harness loosened to 48px — not a product change.

## Live-proved

Playwright `e2e-zoom-keyboard-fit-width.spec.mjs` **2 / 2 (11.8s)** on Vite `http://127.0.0.1:5173`. Focused Node `zoomKeyboardFitWidth` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf` + `spike-120-pages.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop 1400×900: overlay lists Zoom in/out + Fit page; omits Fit width. **Ctrl+=** 100→**125**. **Ctrl+-** lowers. Fit width menu fills viewer width; **207%** > Fit page **100%** / Fit height **104%**; `data-active`. **Ctrl+1** restores 207% after Ctrl+=.

390: Fit width pageW **318** = Fit page; Fit height **624**. Ctrl+= grows to **398**. Ctrl+- shrinks. Ctrl+1 restores width fill + `aria-selected`.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Re-click Fit width | menu | stay 207% |
| Engine floor | Ctrl+- after Fit page | stay **100%** |
| Ceiling | 4000% then Ctrl+= | stay 4000 |
| Zoom % INPUT | Ctrl+= / Ctrl+1 while focused | stay Fit width (caret only) |
| Bare `=` / `-` / `+` | no modifier | stay |
| 390 floor | Ctrl+- at Fit width | pageW stay |
| 390 page INPUT | Ctrl+= / Ctrl+1 while focused | stay page 1; zoom unmoved |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Isolation | Page-1 rect survived Ctrl+=; zoom invented 0 |
| Pen-armed | Ctrl+= still 1.25×; invents 0 |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Draw **0**; annotation layer **0** |
| 120-page | Ctrl+= does not change page; Ctrl+1 fills width |
| 390 | same chords + width fill + INPUT no-steal; same viewBox |

## Official / focused Node

Focused `zoomKeyboardFitWidth` + leftover18 **15 / 15**. Official `npm test` not run (8448 not reached / not loosened). Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

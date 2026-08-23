# Live V-04 leftover: Ctrl+wheel cursor zoom intended+break+edge — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after Fit page + Ctrl+0 (`cc97296c` / `e2e-fit-page.spec.mjs`). Fit page / Fit width / Fit height / Ctrl++/− / UL-06 Zoom % / W4-02 pinch already have dedicated intended+break+edge. Wave2 only sampled “Fit width → ctrl-wheel → Fit page”. Distinct from leftover-18, V-05 page-nav. Did **not** invent flatten / stamp / Forms. Did **not** replay 96 IDs.

Skipped (inspected, not unique leftover chrome):

| Candidate | Why skipped |
|---|---|
| Tab reorder / document title rename | No real two-PDF-tab path. `?testPdf=` opens one File. HubPreview `handleOpenDocument` does `location.assign` (remount, one tab). Dashboard Upload calls `createSupabaseDocument` then stamps `file.id` — leftover-18 / forbidden. Electron Open PDF is IPC-only. Title rename is not tab chrome. |
| Text-markup highlight after Select text | Compile-hidden. `showTextMarkupHighlightMenu = false`. |
| Theme / appearance | Absent. |
| Line / Arrow selected 8-handle + `mtr` | Not unique (`p1`/`p2`/`midpoint` only). |
| Callout selected bbox / `mtr` | Not live. |
| Counter bbox / `mtr` | Nubbin-only. |
| Keyboard nudge | Not wired. ArrowLeft/Right are page nav. |
| Insert image / stamp | No create path. |

Product path is distinct: `PdfjsViewerContainer.onWheel` requires `ctrlKey` / `metaKey`, scales with `getWheelZoomScale` (~1.1 per 100px notch, not the Ctrl+= 1.25 step), CSS-previews, then `commitGesture` after `SETTLE_MS=110`. `onZoomPhase('gesture-start', { source: 'wheel' })` bumps `zoomGeneration`. `PDFViewer.performPdfjsCursorWheelZoom` stays dead (`if (true) return false`) so the engine owns the gesture.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

No product change. Harness only.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched.

## Live-proved

Playwright `e2e-ctrl-wheel-zoom.spec.mjs` **2 / 2 (14.1s)** on Vite `http://127.0.0.1:5173`. Focused Node `ctrlWheelZoom` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf` + `spike-120-pages.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop 1400×900: overlay lists Ctrl+ zoom, omits wheel/pinch. From 200%, one Ctrl+wheel-in notch → **220%** (not the Ctrl+= 250 step). Ctrl+wheel-out reverses to 200. Fit page **100%** then three notches → **133%** (`data-active` Fit page false). Actual size / Rotate view **0**.

390: Fit page pageW **318**; three Ctrl+wheel-in notches → **423.25**; Fit page restores 318.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Bare wheel | no Ctrl | stay 200 / 390 width unmoved |
| Zoom % INPUT | Ctrl+wheel on the field (not scroller) | stay 200 (caret only) |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Isolation | Page-1 rect `e227d5e3-…` survived Ctrl+wheel; zoom invented 0 |
| Pen-armed | Ctrl+wheel still zooms; invents 0 |
| Mid-stroke flush | In-drag preview dropped; ink `8a0a4da9-…` committed via `zoomGeneration`; pointerup no double-commit |
| Ceiling | Node `getWheelZoomScale(40) === 40` (live typed-4000 is UL-06 field, not this gesture) |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Draw **0**; scroller **0** |
| 120-page | Ctrl+wheel does not change page |
| 390 | same gesture + bare-wheel no-op; same viewBox |

## Official / focused Node

Focused `ctrlWheelZoom` + leftover18 **15 / 15**. Official `npm test` not run (8448 not reached / not loosened). Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

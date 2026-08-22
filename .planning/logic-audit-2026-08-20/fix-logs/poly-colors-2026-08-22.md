# Poly desktop Color every-swatch — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after Cloud desktop Fill + Border every-swatch. Distinct from selected-solid-rect Fill/Border (`e2e-pickers-every-swatch`), Cloud bump 1–20, Cloud/Text/Callout Fill+Border, Line/Arrow stroke, and vertex-N / bbox leftovers. Not leftover-18. No create-poly tool.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright used Vite `127.0.0.1:5233` with auto-login names cleared.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| Pickers every-swatch C-fill / C-border | Desktop CompactColorPicker on a **solid** rect. Inventory listed imported polygon/polyline; **0** `polygon`/`polyline` recolored. |
| X-04 vertex-N / bbox | Geometry only. Color picker never every-value on those targets. |
| Cloud / Text / Callout Fill+Border | Different targets (`cloud-rect` / `backgroundColor` / callout `style`). Poly is imported `data-shape-kind="polygon"` / `"polyline"`. |

FEATURE-MATRIX C-01 / C-05: same picker, different target. Selected polygon maps to `contextTool === 'rect'` (Fill + Border, Match Fill, no Transparent on Border). Selected polyline maps to `contextTool === 'line'` (stroke-only). No create-poly tool — fixture import only.

## Live-proved

Playwright `e2e-poly-colors.spec.mjs` **2 / 2 (9.0s)** on Vite `http://127.0.0.1:5233` (`npm run dev:ui`, auto-login cleared). Focused Node `polyColors` + `leftover18FailClosed` + `annotationStyleCatalog` **29 / 29**.

`viewBox="0 0 612 792"`. `file.id` null. Polygon A `5R`. Polygon B `7R`. Polyline `6R`.

### Intended — **pass**

Desktop CompactColorPicker Color on imported polys from `?testPdf=e2e-poly-vertices.pdf`. Polygon A Fill every catalog swatch including transparent, then Border 15 solids + Match Fill (Transparent **0** on Border):

`#FF0000` `#FF0080` `#FF00FF` `#8000FF` `#0000FF` `#0080FF` `#00FFFF` `#00FF80` `#00FF00` `#80FF00` `#FFFF00` `#FF8000` `#FFFFFF` `#808080` `#000000` transparent (Fill).

Match Fill copied Fill `#FF0000` onto stroke. Restored first Fill `#FF0000` / Border `#0000FF`. Second polygon Fill every-swatch then `#00FFFF`. Isolation: first stayed red/blue.

Polyline stroke every 16 including transparent, then `#FF8000`. Isolation: polygons held. Shapes stayed `polygon` / `polyline`. No Polygon / Polyline create control.

### Break — **pass**

Select / empty page invents 0. Pen-armed Color `#00FF00` did not clobber first Fill `#FF0000` / Border `#0000FF` / second `#00FFFF` / polyline `#FF8000`. hubPreview Preset colors **0** / Draw **0**.

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Undo | Dedicated Fill `#FFFF00` on A undone. First Fill `#FF0000` / Border `#0000FF`, second `#00FFFF`, polyline `#FF8000` stayed. |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout. |

## Product

No product change. Selected imported polygon already writes `fill` / `stroke` through `patchSelectedFill` / `patchSelectedStroke` (`composeColorForPatch`). Selected polyline already writes stroke. leftover18FailClosed unchanged. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. `graphify` CLI absent — skipped.

## Official / focused Node

Focused `polyColors` + `leftover18FailClosed` + `annotationStyleCatalog` **29 / 29**. Cap **8448** not loosened. Did **not** run official `npm test` (no high-risk file). Did **not** invent a lease.

## Next leftover

No incomplete reachable CompactColorPicker every-swatch remains on `?testPdf=` (Pen / Highlighter / Line / Arrow / Counter / Callout fill+border / Text fill+border / Cloud fill+border / Poly fill+border + polyline stroke / fonts / B/I/U/S / sizes / align already every-value). Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

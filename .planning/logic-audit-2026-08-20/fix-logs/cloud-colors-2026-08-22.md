# Cloud desktop Fill + Border every-swatch — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after Text desktop Fill + Border every-swatch. Distinct from selected-solid-rect Fill/Border (`e2e-pickers-every-swatch`), Cloud bump 1–20, Line/Arrow stroke, Callout/Text Fill+Border. Not leftover-18.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright used Vite `127.0.0.1:5222` with auto-login names cleared.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| Pickers every-swatch C-fill / C-border | Desktop CompactColorPicker 16 fill + 15 border + Match Fill on a **solid** rect. Inventory listed Cloud as a Style option; **0** `cloud-rect` fill/stroke recolored. |
| S-01 Cloud + bump 1–20 | Style → Cloud then `pdfCloudIntensity` 1…20. Color picker never every-value on that target. |
| Text / Callout Fill+Border | Different targets (`backgroundColor` / callout `style`). Cloud is a rect with `data-shape-kind="cloud-rect"`. |

FEATURE-MATRIX C-01 / C-05: same picker, different target. Cloud keeps the rect/ellipse one-visible rule, so Border has Match Fill (no Transparent).

## Live-proved

Playwright `e2e-cloud-colors.spec.mjs` **2 / 2 (12.0s)** on Vite `http://127.0.0.1:5222` (`npm run dev:ui`, auto-login cleared). Focused Node `cloudColors` + `leftover18FailClosed` + `annotationStyleCatalog` **29 / 29**.

`viewBox="0 0 612 792"`. `file.id` null. First `141e64cc-…`. Second `e6b12416-…`. Next-draw `c721f5e9-…`.

### Intended — **pass**

Desktop CompactColorPicker Color with Fill + Border tabs on a selected Style→Cloud rectangle (`cloud-rect`, `pdfCloudIntensity` held). Every catalog Fill swatch including transparent, then Border 15 solids + Match Fill (Transparent **0** on Border):

`#FF0000` `#FF0080` `#FF00FF` `#8000FF` `#0000FF` `#0080FF` `#00FFFF` `#00FF80` `#00FF00` `#80FF00` `#FFFF00` `#FF8000` `#FFFFFF` `#808080` `#000000` transparent (Fill).

Match Fill copied Fill `#FF0000` onto stroke. Restored first Fill `#FF0000` / Border `#0000FF`. Second Cloud Fill every-swatch then `#00FFFF`. Isolation: first stayed red/blue.

Armed next-draw Fill `#80FF00` / Border `#FF8000` **did** stamp create (after empty-page deselect so Style/Color did not re-sync the still-selected second Cloud). Shape stayed `cloud-rect`.

### Break — **pass**

Select / empty page invents 0. Pen-armed Color `#00FF00` did not clobber first Fill `#FF0000` / Border `#0000FF` / second `#00FFFF` / next-draw `#80FF00`/`#FF8000`. hubPreview Preset colors **0** / Draw **0**.

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Undo | Next-draw cloud gone. First Fill `#FF0000` / Border `#0000FF`, second `#00FFFF` stayed. |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout. |

## Product

No product change. Selected Cloud already writes `fill` / `stroke` through `patchSelectedFill` / `patchSelectedStroke` (`composeColorForPatch`). leftover18FailClosed unchanged. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. `graphify` CLI absent — skipped.

## Official / focused Node

Focused `cloudColors` + `leftover18FailClosed` + `annotationStyleCatalog` **29 / 29**. Cap **8448** not loosened. Did **not** run official `npm test` (no high-risk file). Did **not** invent a lease.

## Next leftover

Named next reachable picker slice: **Poly desktop Color every-swatch** (imported polygon Fill+Border / polyline stroke on `?testPdf=e2e-poly-vertices.pdf`). No create-poly tool. Pen / Highlighter / Line / Arrow / Counter / Callout fill+border / Text fill+border / Cloud fill+border / fonts / B/I/U/S / sizes / align already every-value. Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

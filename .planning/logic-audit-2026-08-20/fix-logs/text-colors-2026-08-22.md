# Text desktop Fill + Border every-swatch — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after Callout desktop Fill + Border every-swatch. Distinct from T-07 Font color / 390 `Set Text color` chips (`fontColor` only), Fill every-swatch on a selected rect (`e2e-pickers-every-swatch`), and Callout Fill/Border. Not leftover-18.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright used Vite `127.0.0.1:5216` with auto-login names cleared.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| T-07 / 390 Text color chips | Next-draw `fontColor` / overlay color. Desktop Color Fill/Border never every-value. |
| Pickers every-swatch C-fill / C-border | Desktop CompactColorPicker 16 fill + 15 border on a **selected rect**. Inventory listed Text as sharing the Fill/Border site; **0** textbox `backgroundColor` or `stroke` recolored. |
| Callout Fill + Border | Callout `style.fillColor` / `style.borderColor`. Textbox fill is `backgroundColor`, not `fill` (font). |

FEATURE-MATRIX C-01 / C-05: same picker, different targets. Text opts out of the rect/ellipse one-visible rule, so **both** Fill and Border keep the Transparent cell (no Match Fill).

## Live-proved

Playwright `e2e-text-colors.spec.mjs` **2 / 2 (13.1s)** on Vite `http://127.0.0.1:5216` (`npm run dev:ui`, auto-login cleared). Focused Node `textColors` + `leftover18FailClosed` + `annotationStyleCatalog` **29 / 29**.

`viewBox="0 0 612 792"`. `file.id` null. First `23a11096-…`. Second `a3ef5c03-…`.

### Intended — **pass**

Desktop CompactColorPicker Color with Fill + Border tabs on a selected Textbox. Every catalog swatch stored on Fill (`backgroundColor`), then Border (`stroke`). Transparent present on both; Match Fill **0**. Font `fill` stayed `#000000` through Fill every-swatch (not T-07):

`#FF0000` `#FF0080` `#FF00FF` `#8000FF` `#0000FF` `#0080FF` `#00FFFF` `#00FF80` `#00FF00` `#80FF00` `#FFFF00` `#FF8000` `#FFFFFF` `#808080` `#000000` transparent.

Restored first Fill `#FF0000` / Border `#0000FF`. Second Text Fill every-swatch then `#00FFFF`. Isolation: first stayed red/blue.

Armed next-draw Fill `#80FF00` / Border `#FF8000` did **not** stamp create (`backgroundColor` stayed empty / `stroke` stayed `#000000`). That is current product: `buildNewTextCommitJSON` keeps envelope `backgroundColor: ''` and hardcodes `stroke: '#000000'`; Color while Text-armed updates preference only. Selected-patch every-swatch is the proof. Did not touch `PDFViewer.jsx` to invent create-time fill.

### Break — **pass**

Select / empty page invents 0. Pen-armed Color `#00FF00` did not clobber first Fill `#FF0000` / Border `#0000FF` / font `#000000` / second `#00FFFF`. hubPreview Preset colors **0** / Draw **0**.

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Undo | Next-draw border textbox gone (create + text commit can be two history entries). First Fill `#FF0000` / Border `#0000FF`, second `#00FFFF` stayed. |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout. |

## Product

No product change. Selected Text already writes `backgroundColor` / `stroke` through `patchSelectedFill` / `patchSelectedStroke` (`composeColorForPatch`). leftover18FailClosed unchanged. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. `graphify` CLI absent — skipped.

## Official / focused Node

Focused `textColors` + `leftover18FailClosed` + `annotationStyleCatalog` **29 / 29**. Cap **8448** not loosened. Did **not** run official `npm test` (no high-risk file). Did **not** invent a lease.

## Next leftover

Named next reachable picker slice: **Cloud / Poly desktop Color every-swatch** if that site is still unproved on those targets. Pen / Highlighter / Line / Arrow / Counter / Callout fill+border / Text fill+border / fonts / B/I/U/S / sizes / align already every-value. Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

# Callout desktop Fill + Border every-swatch — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after Line/Arrow desktop every-swatch. Distinct from Fill every-swatch on a selected rect (`e2e-pickers-every-swatch`), Highlighter, C-02 hex lengths, and T-02 handles. Not leftover-18.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright used Vite `127.0.0.1:5215` with auto-login names cleared.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| Pickers every-swatch C-fill / C-border | Desktop CompactColorPicker 16 fill + 15 border on a **selected rect**. Inventory listed Callout as sharing the Fill/Border site; **0** Callout fills or borders recolored. |
| T-02 / knee / text-box | Create + handles + resize + flip. Color picker never every-swatch. |

FEATURE-MATRIX C-01 / C-05: same picker, different targets. Callout opts out of the rect/ellipse one-visible rule, so **both** Fill and Border keep the Transparent cell (no Match Fill).

## Live-proved

Playwright `e2e-callout-colors.spec.mjs` **2 / 2 (13.0s)** on Vite `http://127.0.0.1:5215` (`npm run dev:ui`, auto-login cleared). Focused Node `calloutColors` + `leftover18FailClosed` + `annotationStyleCatalog` **29 / 29**.

`viewBox="0 0 612 792"`. `file.id` null. First `callout-fe018e45-…`. Second `callout-525cf360-…`.

### Intended — **pass**

Desktop CompactColorPicker Color with Fill + Border tabs on a selected Callout. Every catalog swatch stored on Fill, then Border (Transparent present on both; Match Fill **0**):

`#FF0000` `#FF0080` `#FF00FF` `#8000FF` `#0000FF` `#0080FF` `#00FFFF` `#00FF80` `#00FF00` `#80FF00` `#FFFF00` `#FF8000` `#FFFFFF` `#808080` `#000000` transparent.

Restored first Fill `#FF0000` / Border `#0000FF`. Second Callout Fill every-swatch then `#00FFFF`. Isolation: first stayed red/blue. Armed next-draw: Fill `callout-2d826ac0-…` `#80FF00`; Border `callout-b76e2be5-…` `#FF8000`.

### Break — **pass**

Select / empty page invents 0. Pen-armed Color `#00FF00` did not clobber first Fill `#FF0000` / Border `#0000FF` / second `#00FFFF` / next Fill `#80FF00`. hubPreview Preset colors **0** / Draw **0**.

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Undo | Next-draw border callout gone (create + text commit can be two history entries). First Fill `#FF0000` / Border `#0000FF`, second `#00FFFF`, next Fill `#80FF00` stayed. |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout. |

## Product

No product change. Callout already writes `style.fillColor` / `style.borderColor` (and opacity 0 for Transparent) through `handlePatchSelectedCallout`. leftover18FailClosed unchanged. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. `graphify` CLI absent — skipped.

## Official / focused Node

Focused `calloutColors` + `leftover18FailClosed` + `annotationStyleCatalog` **29 / 29**. Cap **8448** not loosened. Did **not** run official `npm test` (no high-risk file). Did **not** invent a lease.

## Next leftover

Named next reachable picker slice: **Text desktop Fill every-swatch** (390 chips were fontColor; desktop Text Fill/Border never every-value). Cloud / Poly if that site is still unproved on those targets. Pen / Highlighter / Line / Arrow / Counter / Callout fill+border / fonts / B/I/U/S / sizes / align already every-value. Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

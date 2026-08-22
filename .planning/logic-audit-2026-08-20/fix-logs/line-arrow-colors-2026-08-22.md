# Line/Arrow desktop every-swatch — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after live C-02 hex lengths. Distinct from Pen select-and-patch (`e2e-pickers-every-swatch`), Highlighter every-swatch, 390 Fill / Text chips, and S-03/S-04 handles. Not leftover-18.

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
| Pickers every-swatch C-stroke | Desktop CompactColorPicker 16 on **selected Pen**. Inventory listed Line / Arrow as sharing the stroke-only site; **0** Line/Arrow strokes recolored. |
| S-03 / S-04 | Create + dash + `p1`/`p2`/`midpoint` + bbox + 6 heads. Color picker never every-swatch. |

FEATURE-MATRIX C-01 / C-05: same picker, different targets. Stroke-only Line/Arrow was the named leftover after C-02.

## Live-proved

Playwright `e2e-line-arrow-colors.spec.mjs` **2 / 2 (9.7s)** on Vite `http://127.0.0.1:5215` (`npm run dev:ui`, auto-login cleared). Focused Node `lineArrowColors` + `leftover18FailClosed` + `annotationStyleCatalog` **29 / 29**.

`viewBox="0 0 612 792"`. `file.id` null. Line `799c966e-…`. Arrow `1453d6e2-…`.

### Intended — **pass**

Desktop CompactColorPicker Color (no Fill / Border tabs) on a selected Line, then a selected Arrow. Every catalog swatch stored:

`#FF0000` `#FF0080` `#FF00FF` `#8000FF` `#0000FF` `#0080FF` `#00FFFF` `#00FF80` `#00FF00` `#80FF00` `#FFFF00` `#FF8000` `#FFFFFF` `#808080` `#000000` transparent.

Restored Line `#FF0000` / Arrow `#0000FF` after transparent. Armed next-draw: Line `d7c1d973-…` `#80FF00`; Arrow `40b3df84-…` `#FF8000`. Isolation: first Line stayed red after Arrow every-swatch and next-draw.

### Break — **pass**

Select / empty page invents 0. Pen-armed Color `#00FF00` did not clobber Line `#FF0000` / Arrow `#0000FF` / next Line `#80FF00`. hubPreview Preset colors **0** / Draw **0**.

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Undo | Next-draw arrow gone; Line `#FF0000`, Arrow `#0000FF`, next Line `#80FF00` stayed. |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout. |

## Product

No product change. Line/Arrow already write `stroke` through the shared Color picker (`buildLineCommitJSON` / CompactColorPicker). leftover18FailClosed aligned: `.env.local` may exist (parked X-01 names, gitignored); fail-closed stays no lease / no `.bot-credentials.json` / no invented tuple. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched.

## Official / focused Node

Focused `lineArrowColors` + `leftover18FailClosed` + `annotationStyleCatalog` **29 / 29**. Cap **8448** not loosened. Did **not** run official `npm test` (no high-risk file). Did **not** invent a lease.

## Next leftover

Named next reachable picker slice: **Callout desktop Fill every-swatch** (Fill every-swatch in `e2e-pickers-every-swatch` was a selected rect; Callout fill/border never every-value). Pen / Highlighter / Line / Arrow / Counter / fonts / B/I/U/S / sizes / align already every-value. Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

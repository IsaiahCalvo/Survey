# Counter Fill + Number every-swatch — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after Callout dash + arrowhead. Distinct from pickers-every-swatch (single selected pin, no isolation / next-draw / 390), Size/Start, series Delete, nubbin, Continue pin, and Continue Count. Not leftover-18.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright used Vite `127.0.0.1:5229` with auto-login names cleared.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| Pickers every-swatch C-counter | Desktop CompactColorPicker 16 on **one selected pin**. No sibling series-wide, no New Count isolation, no armed next-draw, no 390, no undo/Pen/Select. |
| C-05 smoke | Fill `#FF0000` then Number `#0000FF` / `#FFFFFF` without clobbering fill. Not every-value. |
| Size / Start / Delete / nubbin / Continue pin / Continue Count | Other chrome. Color pickers never intended+break+edge. |

FEATURE-MATRIX C-05 / S-05 leftover: Counter Fill vs Number on the same picker, series-wide.

## Live-proved

Playwright `e2e-counter-colors.spec.mjs` **3 / 3 (19.1s)** on Vite `http://127.0.0.1:5229` (`npm run dev:ui`, auto-login cleared). Focused Node `counterColors` + `leftover18FailClosed` **16 / 16**.

`viewBox="0 0 612 792"`. `file.id` null. Series A `111c6671-…` + sibling `cb7389f9-…` (`series-1787423328121`). Series B `5bf829ae-…`. Next-draw `b9616805-…` undone. 390 pin `ebc33ec5-…`.

### Intended — **pass**

Desktop CompactColorPicker Fill + Number (no Border / Match Fill). Every catalog swatch including transparent on series A, then series B Fill. Series-wide sibling A2 matched A1. Restored A Fill `#FF0000` / Number `#0000FF`. Armed next-draw Fill `#80FF00` / Number `#FF8000`. 390 Fill + Stroke tabs catalog all 9 chips; CompactColorPicker every 16 including transparent; restored `#FF0000` / `#0000FF`; New Count isolation `#00FFFF`.

### Break — **pass**

Select / empty page invents 0. Pen-armed Color `#00FF00` did not clobber Counter fill/number. hubPreview Preset colors **0** / Draw **0**. Desktop does not mount 390 chip aria-labels.

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Undo | Next-draw / isolated pin gone; series A `#FF0000` / `#0000FF` stayed. |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout. |

## Product

No product change. Counter already writes series-wide `fill` / `data.numberColor` through Fill + Number (`handleCounterGroupUpdate`). CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched.

390 sheet chips on an already-pressed red fill were not used as the every-value path (toolbar hex can stay `#FF0000` while stored fill is transparent). CompactColorPicker is the shared catalog.

## Official / focused Node

Focused `counterColors` + `leftover18FailClosed` **16 / 16**. Cap **8448** not loosened. Did **not** run official `npm test` (no high-risk file). Did **not** invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Reachable unblocked next: **Counter Fill/Number opacity continuum** if still smoke-only (C-03 was rect Fill + Line stroke, not Counter). Leftover **18** stay parked. Goal stays open.

# Live Counter Fill + Number opacity continuum — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after Counter Fill + Number every-swatch. Distinct from C-03 rect Fill + Line stroke, Counter every-swatch, Size/Start, series Delete, nubbin, Continue pin, and Continue Count. Documented continuum (not every integer 0–100). Not leftover-18.

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
| C-03 **pass** (live % + slider) | Desktop selected **rect Fill** + **Line stroke**. Not Counter Fill/Number. |
| Counter every-swatch | CompactColorPicker 16 hex including transparent. Opacity field/slider never walked. |
| C-05 smoke | Fill vs Number color isolation. Not the 0–100 continuum. |

FEATURE-MATRIX C-03 leftover for Counter: slider + % field 0–100 on Fill and Number (no Border `minOpacity=1`).

## Live-proved

Playwright `e2e-counter-opacity-continuum.spec.mjs` **2 / 2 (13.9s)** on Vite `http://127.0.0.1:5233` (`npm run dev:ui`, auto-login cleared). Focused Node `counterOpacityContinuum` + `leftover18FailClosed` **16 / 16**.

`viewBox="0 0 612 792"`. `file.id` null. Series A `455f2f01-…` + sibling `3ef338c3-…` (`series-1787423639426`). Isolation `08c3a671-…`. 390 pin `f2534040-…`.

### Intended — **pass**

Desktop CompactColorPicker Fill + Number (no Border / Match Fill; slider `min=0`):

| Control | Stops / value | Stored alpha |
|---|---|---|
| Fill % field | 1, 25, 40, 55, 80, 99, 100 | 0.01 … 1.00 (series-wide sibling matched) |
| Fill slider | 70 | 0.70 |
| Number % field | 1, 25, 40, 55, 80, 99, 100 | 0.01 … 1.00 (series-wide sibling matched) |
| Number slider | 33 | 0.33 |

Restored Fill **55** / Number **80**. 390 CompactColorPicker Fill field **25** stored; Number field **40** stored.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Fill % | 999 | 100 / alpha 1 |
| Fill % | −10 / empty / `abc` | 0 |
| Fill Transparent | click | slider disabled; fill alpha 0; Number stayed visible |
| `#FF0000` after Transparent | click | slider enabled; remembered **40** |
| Number % | 999 | 100 |
| Number % | −10 / empty / `abc` | 0 |
| Number Transparent | click | slider disabled; number alpha 0 |
| `#0000FF` after Transparent | click | slider enabled; remembered **40** |
| Select / empty page | click | invents 0 |
| Pen-armed | — | fill 55 / number 80 held |
| hubPreview | — | Opacity percentage **0** / Draw **0** |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Isolation | series B fill **10** left series A fill **55** / number **80** |
| Fill does not clobber Number | number stayed **80** after fill **55** |
| Undo | isolation pin gone; series A 55 / 80 held |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| 390 | Fill 25; 999→100; −10→0; Number 40; 999→100; −10→0; Number clamp did not clobber Fill 25. Desktop Open-fill-picker **0**. |

## Product

No product change. `clampOpacityPercent` + `composeColorForPatch` already stamp continuum rgba onto series-wide `fill` / `data.numberColor`. Counter stays off the rect/ellipse `minOpacity=1` floor. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched.

## Official / focused Node

Focused `counterOpacityContinuum` + `leftover18FailClosed` **16 / 16**. Cap **8448** not loosened. Did **not** run official `npm test` (no high-risk file). Did **not** invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). No other reachable smoke-only Counter opacity slice remains. Leftover **18** stay parked. Goal stays open.

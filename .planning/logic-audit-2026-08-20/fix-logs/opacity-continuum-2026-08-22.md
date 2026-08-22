# Live C-03 fill + stroke opacity continuum — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after Poly desktop Color every-swatch. Distinct from C-01 every-swatch, C-02 hex lengths, Templates entity opacity, and the smoke 55% / slider-40 row. Documented continuum (not every integer 0–100). Not leftover-18.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright used Vite `127.0.0.1:5213` with auto-login names cleared.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| C-03 **pass** (live % + slider) | Field 55 on a selected rect; slider → 40; Transparent disables; `#FF0000` re-enables. No fill/stroke continuum, no Border floor, no Line stroke. |
| Templates entity opacity | Hub role colors. Not viewer fill/stroke. |

FEATURE-MATRIX C-03 intended: slider + % field 0–100. Break/edge: `minOpacity`; transparentMode restore.

## Live-proved

Playwright `e2e-opacity-continuum.spec.mjs` **2 / 2 (11.9s)** on Vite `http://127.0.0.1:5213` (`npm run dev:ui`, auto-login cleared). Focused Node `opacityContinuum` + `annotationStyleCatalog` **18 / 18**.

`viewBox="0 0 612 792"`. `file.id` null. Isolation line `5fabb3c8-…`. 390 drawn rect `555273c2-…`.

### Intended — **pass**

Desktop selected rect Fill (after `#FF0000`):

| Control | Stops / value | Stored alpha |
|---|---|---|
| % field | 1, 25, 40, 55, 80, 99, 100 | 0.01 … 1.00 |
| slider | 70 | 0.70 |

Desktop selected Line stroke (after `#0000FF`): same field stops; slider **33**.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Fill % | 999 | 100 / alpha 1 |
| Fill % | −10 / empty / `abc` | 0 |
| Transparent swatch | click | slider disabled; fill alpha 0 |
| `#FF0000` after Transparent | click | slider enabled; remembered **40** |
| Border tab (rect) | 40 / 999 / `abc` | floor **100** (`minOpacity=1`) |
| Line % | 999 | 100 |
| Line % | −10 | 0 |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Fill 0 keeps border | stroke alpha > 0 (one-visible rule) |
| Border floor does not clobber fill 0 | fill stayed 0 |
| Isolation | other-line **10** left first stroke **80**; rect fill **55** |
| Pen-armed | fill 55 / stroke 80 held |
| Undo | isolation line gone; stroke 80 / fill 55 held |
| Select empty | invents 0 |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Opacity percentage **0** / Draw **0** |
| 390 | Fill field 25; 999→100; Line field 40; 999→100; −10→0. Stored continuum stays desktop — 390 CompactColorPicker session leaves the Pages empty overlay on the draw target. |

## Product

No product change. `clampOpacityPercent` + `composeColorForPatch` already implement the continuum. Desktop Border tab `minOpacity=1` is the existing one-visible rule. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched.

## Official / focused Node

Focused `opacityContinuum` + `annotationStyleCatalog` **18 / 18**. Cap **8448** not loosened. Did **not** run official `npm test` (no high-risk file). Did **not** loosen leftover-18 or invent a lease.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Reachable non-picker next: Pen width / remaining Counter chrome if still smoke-only; otherwise leftover-18 stays the block. Leftover **18** stay parked. Goal stays open.

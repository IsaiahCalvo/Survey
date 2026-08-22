# Live Pen Width every preset + unique chrome — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after C-03 fill + stroke opacity continuum. Distinct from D-05 mixed Width smoke, Eraser Size 1…100, Counter Size 5…64, Cloud bump 1–20, C-03 opacity, and color every-swatch. Not leftover-18.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright used Vite `127.0.0.1:5235` with auto-login names cleared.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| D-05 **pass** (presets) | Mixed Width field `0` / `999` / `12.5` + “all 12” cited. Pickers-every-swatch **skipped** Width as “already D-05”. |
| Eraser Size / Counter Size | Separate catalogs (`1…100` / `5…64`). Explicitly **not** D-05 Width. |
| C-03 opacity continuum | Fill + Line stroke alpha. Not Pen `sourceWidth`. |

FEATURE-MATRIX D-05 intended: presets + numeric. Break/edge: min/max; eraser size vs stroke. Pen unique chrome: create-time filled outline (`sourceWidth`); highlighter floors at 8.

## Live-proved

Playwright `e2e-pen-width-presets.spec.mjs` **2 / 2 (18.2s)** on Vite `http://127.0.0.1:5235` (`npm run dev:ui`, auto-login cleared). Focused Node `penWidthPresets` **2 / 2**.

`viewBox="0 0 612 792"`. `file.id` null. Custom 7 `d8c639b6-…`. 390 drawn `e24e650f-…`.

### Intended — **pass**

Desktop armed Pen Width field + popover (Size **0**, no slider):

| Preset | `sourceWidth` | `strokeWidth` | filled `bboxH` |
|---|---|---|---|
| 1 | 1 | 0 | 5.004 |
| 2 | 2 | 0 | — |
| 3 | 3 | 0 | — |
| 4 | 4 | 0 | — |
| 6 | 6 | 0 | — |
| 8 | 8 | 0 | — |
| 10 | 10 | 0 | — |
| 12 | 12 | 0 | — |
| 16 | 16 | 0 | — |
| 20 | 20 | 0 | — |
| 32 | 32 | 0 | — |
| 50 | 50 | 0 | 53.975 |

Width 50 outline thicker than Width 1 (`53.975 > 5.004 × 8`). Paper ink stays `paperInkGeometry=v1`.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Width field | `abc` | rejected; last value held |
| Width field | `0` | **1** |
| Width field | `999` | **50** (not Eraser 100) |
| Width field | empty | **1** |
| Highlighter Width `1` | next-draw | `sourceWidth` **8** (floor) |
| Eraser Size | after Pen Width `10` | Size default **20**; typed **24** does not clobber Pen **10** |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Custom non-preset | typed **7** stamped `sourceWidth` 7 (`d8c639b6-…`) |
| Isolation | later Width 10 stroke did not rewrite first Width 1 |
| Undo | isolation stroke gone; first `sourceWidth` 1 held |
| Select empty | invents 0 |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Width **0** / Draw **0** |
| 390 | presets listed; Width 12 next-draw `sourceWidth` 12; 999→50; 0→1; letters rejected |

## Product

No product change. Pen create already writes `sourceWidth` via `createProductionPaperInk` / `buildFreehandCommitJSON` (highlighter `Math.max(strokeWidth, 8)`). AppShell / 390 Width clamp is 1–50. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. High-risk files not edited.

Selected ink still stores `strokeWidth: 0` (filled outline). This pass proved **next-draw** Width, not a selected-outline rebuild.

## Official / focused Node

Focused `penWidthPresets` **2 / 2**. Cap **8448** not loosened. Did **not** run official `npm test` (no high-risk file). Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Line/Rect/Callout Width selected-patch uses the same 12-preset chrome but a different apply path — not replayed. Leftover **18** stay parked. Goal stays open.

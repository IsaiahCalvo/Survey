# Live Line / Arrow / shape Width every preset + selected-patch — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after Pen Width every preset. Distinct from Pen `sourceWidth` + baked outline 0, D-05 mixed Width smoke, Eraser Size 1…100, Counter Size 5…64, Cloud bump 1–20, C-03 opacity, and color every-swatch. Not leftover-18.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright used Vite `127.0.0.1:5241` with auto-login names cleared.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| D-05 **pass** (Pen Width) | Create-time Pen `sourceWidth`; pickers cited Width as “already D-05”. |
| S-03 / S-04 | Create + dash + handles + every swatch. Width selected-patch never walked. |
| S-01 / T-02 | Cloud / callout color + handles. Rect `strokeWidth` / callout `lineThickness` not every preset. |

FEATURE-MATRIX D-05 intended: presets + numeric. Break/edge: min/max; eraser size vs stroke. Line/Arrow/Rect store `strokeWidth` as-is. Callout selected-patch writes `lineThickness`.

## Live-proved

Playwright `e2e-shape-stroke-width-presets.spec.mjs` **2 / 2 (33.8s)** on Vite `http://127.0.0.1:5241` (`npm run dev:ui`, auto-login cleared). Focused Node `shapeStrokeWidthPresets` **2 / 2**.

`viewBox="0 0 612 792"`. `file.id` null. Custom 7 `d127b9f2-…`. Isolation undone `5812e45e-…`. Seed Line `23cfc2a0-…`. Seed Arrow `3c94b85d-…`.

### Intended — **pass**

Desktop armed Width field + popover (Size **0**, no slider). Catalog **1/2/3/4/6/8/10/12/16/20/32/50**.

| Path | Evidence |
|---|---|
| Line next-draw every preset | `strokeWidth` = preset; `sourceWidth` null; visual `stroke-width` 50 > 1 × 8 |
| Line selected-patch every preset | seed `23cfc2a0-…` walked 1…50; later next-draw did not rewrite it |
| Arrow selected-patch every preset | seed `3c94b85d-…` next-draw Width 8 then 1…50 |
| Rect selected-patch every preset | next-draw Width 6 then 1…50; visual `stroke-width` 50 |
| Callout selected-patch | leader `line1`/`line2` stroke-width **1 / 16 / 50** |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Width field | `abc` | rejected; last value held |
| Width field | `0` | **1** |
| Width field | `999` | **50** (not Eraser 100) |
| Width field | empty | **1** |
| Eraser Size | after Line Width `10` | Size default **20**; typed **24** does not clobber Line **10** |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Custom non-preset | typed **7** stamped Line `strokeWidth` 7 (`d127b9f2-…`) |
| Isolation | later Line 7 did not rewrite first Width 1; Arrow/Callout patch left Width 1 Line and Rect 50 |
| Undo | isolation Line gone; custom 7 + Width 1 held |
| Select empty | invents 0 |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Width **0** / Draw **0** |
| 390 | presets listed; Line Width 12 next-draw `strokeWidth` 12; 999→50; 0→1; letters rejected |

## Product

No product change. Line/Arrow/Rect create already writes `strokeWidth` via `buildLineCommitJSON` / `buildBoundaryShapeCommitJSON`. Selected-patch uses `handlePatchSelectedAnnotation({ strokeWidth })`. Callout uses `handlePatchSelectedCallout({ lineThickness })`. AppShell / 390 Width clamp is 1–50. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. High-risk files not edited.

SVG `getBBox` / `getBoundingClientRect` on a Line report the centerline box, not painted stroke — thickness proof is the `stroke-width` attribute.

## Official / focused Node

Focused `shapeStrokeWidthPresets` **2 / 2**. Cap **8448** not loosened. Did **not** run official `npm test` (no high-risk file). Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Reachable unblocked next: **Highlighter Width** every discrete preset (Pen pass only proved floor-8). Dash / line-style / arrowhead still later if incomplete. Leftover **18** stay parked. Goal stays open.

# Live Highlighter Width every preset + floor-8 chrome — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after Line / Arrow / shape Width every preset. Distinct from Pen as-is `sourceWidth` (that pass only sampled Highlighter floor 8), Line/Arrow/Rect selected-patch `strokeWidth`, Eraser Size 1…100, Counter Size 5…64, Cloud bump 1–20, C-03 opacity, and color every-swatch. Not leftover-18.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright used Vite `127.0.0.1:5247` with auto-login names cleared.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| D-05 **pass** (Pen Width) | Create-time Pen `sourceWidth`; Highlighter Width `1` next-draw floors **8**. Not every Highlighter preset. |
| D-05 **pass** (Line/Arrow/shape) | `strokeWidth` / Callout `lineThickness`. Not Highlighter `sourceWidth`. |
| D-02 every-swatch | Color only. Width chrome unwalked. |

FEATURE-MATRIX D-05 intended: presets + numeric. Break/edge: min/max; eraser size vs stroke. Highlighter unique chrome: create floors `Math.max(strokeWidth, 8)`; field still shows 1…6.

## Live-proved

Playwright `e2e-highlighter-width-presets.spec.mjs` **2 / 2 (17.1s)** on Vite `http://127.0.0.1:5247` (`npm run dev:ui`, auto-login cleared). Focused Node `highlighterWidthPresets` **2 / 2**.

`viewBox="0 0 612 792"`. `file.id` null. Custom 7 `909e07a9-…`. Custom 9 `8288818a-…`. Isolation undone `a396a8ef-…`. Pen isolation `24a9f994-…`. 390 floor `ceda972d-…`. 390 Width 12 `70405240-…`.

### Intended — **pass**

Desktop armed Highlighter Width field + popover (Size **0**, no slider). Catalog **1/2/3/4/6/8/10/12/16/20/32/50**. Field shows the picked preset; create stamps `sourceWidth = max(preset, 8)`, filled outline `strokeWidth` 0, `paperInkGeometry=v1`, `multiply`.

| Preset | field | `sourceWidth` | `bboxH` |
|---|---|---|---|
| 1 | 1 | **8** | — |
| 2 | 2 | **8** | — |
| 3 | 3 | **8** | — |
| 4 | 4 | **8** | — |
| 6 | 6 | **8** | — |
| 8 | 8 | 8 | 12 |
| 10 | 10 | 10 | — |
| 12 | 12 | 12 | — |
| 16 | 16 | 16 | — |
| 20 | 20 | 20 | — |
| 32 | 32 | 32 | — |
| 50 | 50 | 50 | 53.975 |

Width 50 outline thicker than Width 8 (`53.975 > 12 × 4`).

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Width field | `abc` | rejected; last value held |
| Width field | `0` | field **1**; next-draw `sourceWidth` **8** |
| Width field | `999` | **50** (not Eraser 100) |
| Width field | empty | **1** |
| Eraser Size | after Highlighter Width `10` | Size default **20**; typed **24** does not clobber Highlighter **10** |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Custom below floor | typed **7** stamped `sourceWidth` 8 (`909e07a9-…`) |
| Custom above floor | typed **9** stamped `sourceWidth` 9 (`8288818a-…`) |
| Isolation | later Width 10 + Pen Width 4 did not rewrite first floored 8 |
| Undo | isolation stroke gone; first 8 + custom 9 held |
| Select empty | invents 0 |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Width **0** / Draw **0** |
| 390 | presets listed; Width 1 next-draw floors **8**; Width 12 next-draw `sourceWidth` 12; 999→50; 0→1; letters rejected |

## Product

No product change. Highlighter create already floors via `buildFreehandCommitJSON` / `createProductionPaperInk` (`Math.max(strokeWidth, 8)`). Preview in `SVGAnnotationLayer` uses the same floor. AppShell / 390 Width clamp is 1–50 (field can show 1…6; create still floors). CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. High-risk files not edited.

Selected ink still stores `strokeWidth: 0` (filled outline). This pass proved **next-draw** Width, not a selected-outline rebuild.

## Official / focused Node

Focused `highlighterWidthPresets` **2 / 2**. Cap **8448** not loosened. Did **not** run official `npm test` (no high-risk file). Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Reachable unblocked next: **Line/Arrow dash + arrowhead every discrete style** (UL-33 catalog smoke already pass; not every-style intended+break+edge). Counter remaining chrome still later if incomplete. Leftover **18** stay parked. Goal stays open.

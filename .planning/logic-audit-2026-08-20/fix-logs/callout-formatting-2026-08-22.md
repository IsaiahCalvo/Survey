# Live Callout remaining formatting (font / size / align + B/I/U/S) — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after Rect / Ellipse / Text Style every discrete value. Distinct from T-03…T-06 pickers-every-swatch (Text target), Callout Fill+Border, dash+arrowhead, and leader Width. Not leftover-18.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright used Vite `127.0.0.1:5173` with auto-login names cleared.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| T-03…T-06 **pass** / pickers-every-swatch | Every font / size / B/I/U/S / 3×3 on a **Text** overlay. Callout never every-value. |
| T-02 live edit | Create + commit. Font/size/align unused. |
| Callout Fill + Border / dash / Width | Color / Style / Arrowhead / leader thickness. Not text chrome. |

FEATURE-MATRIX leftover: Callout remaining formatting. Reachable catalogs: 6 single-name fonts, 18 sizes, 9 align cells, B/I/U/S. Justify **0**. Desktop next-draw does **not** stamp `textStyleDefaults` (create stays Arial/14). 390 create stamps Arial/16 + bold (current product).

## Product

390 Font / size / align clicks on the live strip committed the overlay because `onDocMouseDown` only opted out `data-rich-text-toolbar` (desktop host). The mobile strip and portaled `MobileStyledSelect` menu sat outside that list. Min-viable: opt out `[data-mobile-tool-properties]` + `.mobile-styled-select__menu`, and mark the mobile text strip `data-rich-text-toolbar`. Desktop Escape-to-close was harness-only. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. High-risk files not edited. SVG callout view still vertically centers (`justifyContent: 'center'`); 3×3 `verticalAlign` is stored.

## Live-proved

Playwright `e2e-callout-formatting.spec.mjs` **3 / 3 (26.4s)** on Vite `http://127.0.0.1:5173` (`npm run dev:ui`, auto-login cleared). Focused Node `calloutFormatting` + leftover18 **15 / 15**.

`viewBox="0 0 612 792"`. `file.id` null. Desktop first `callout-515671cb-…` (Verdana / 72 / bottom right + B/I/U/S). Isolation Georgia/8 undone `callout-78dd366d-…`. 390 first `callout-9585f90b-…`. 390 next-draw `callout-b378ed10-…` Arial/16.

### Intended — **pass**

Desktop + 390 every Font, every Font size, every 3×3 align, B/I/U/S on a Callout in edit. Stored `style.fontFamily` / `fontSize` / `textAlign` / `verticalAlign` / `bold` / `italic` / `underline` / `strikethrough`. Overlay computed family/size/align during edit. Committed SVG paints family / size / horizontal align / B/I/U/S.

| Catalog | Values |
|---|---|
| Font | Arial, Helvetica, Times New Roman, Courier New, Georgia, Verdana (single names) |
| Size | 8 9 10 11 12 14 16 18 20 24 28 32 36 40 48 56 64 72 |
| Align | top/middle/bottom × left/center/right |
| Format | Bold / Italic / Underline / Strikethrough |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Font options | CSS stack | **0** (option `fontFamily` has no comma; `setFontFamily` rejects stacks) |
| Text alignment | Justify | **0** |
| Pen-armed | Font / Font size / Text alignment | **0**; first Callout held |
| 390 Font size | `1`/`0` → **6**; `999` → **200**; `abc` keeps last valid |
| Desktop next-draw | create | Arial/14 (not `textStyleDefaults`) |
| 390 next-draw | create | Arial/16 + defaults (current product) |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Isolation | later Georgia/8 did not rewrite first Verdana/72 |
| Undo | isolation Callout gone; first held |
| Select empty | invents 0 |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Font / Font size / Text alignment **0** / Draw **0** |
| 390 | same catalogs + numeric clamp + isolation |

## Official / focused Node

Focused `calloutFormatting` + leftover18 **15 / 15**. Official `npm test` not run (8448 not reached / not loosened). Cap **8448** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

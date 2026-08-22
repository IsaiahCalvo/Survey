# Highlighter every-swatch — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after 390 Text color. Distinct from Pen select-and-patch (`e2e-pickers-every-swatch`), 390 Fill chips, and 390 Text color chips. D-02 freehand + print never clicked a highlighter swatch. Not leftover-18.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright used Vite `127.0.0.1:5212` with auto-login names cleared.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| Pickers every swatch | Desktop CompactColorPicker 16 on **selected Pen** stroke. Highlighter listed as sharing the site; **0** highlighter strokes recolored. |
| 390 Fill / Text chips | Next armed **rect fill** / **textbox fontColor**. 0 Highlighter / `Set Stroke color` clicks. |
| D-02 Highlighter | Freehand commit + print exclusion. Color picker unused. |

Highlighter commit used hardcoded `highlightColor="rgba(255, 193, 7, 0.3)"` while the Color picker wrote `strokeColor`. That blocked every-swatch proof.

## Live-proved

Playwright `e2e-highlighter-colors.spec.mjs` **2 / 2 (28.7s)** on Vite `http://127.0.0.1:5212` (`npm run dev:ui`, auto-login cleared). Focused Node `highlighterColors` + `mobileAnnotationColors` + `e2eWave2ResizeRotationDraw` + `productionPaperInk` **22 / 22**.

`viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

390 `Set Stroke color` chips → next highlighter fill:

| Chip | Stored | id prefix |
|---|---|---|
| `#ff0000` | `#FF0000` | `8ad380c7-…` |
| `#4A90E2` | `#4A90E2` | `a648fdde-…` |
| `#27C07D` | `#27C07D` | `27aaaeb5-…` |
| `#F4D35E` | `#F4D35E` | `81215fae-…` |
| `#ffffff` | `#FFFFFF` | `e0fc94eb-…` |
| `#1e293b` | `#1E293B` | `e55a0ffb-…` |
| `#C7A7FF` | `#C7A7FF` | `f10639d8-…` |
| `#FF8A3D` | `#FF8A3D` | `b8853875-…` |
| `#000000` | `#000000` | `b3cf5e03-…` |

Desktop CompactColorPicker (armed Highlighter, then draw) every preset including transparent:

`#FF0000` `#FF0080` `#FF00FF` `#8000FF` `#0000FF` `#0080FF` `#00FFFF` `#00FF80` `#00FF00` `#80FF00` `#FFFF00` `#FF8000` `#FFFFFF` `#808080` `#000000` `TRANSPARENT`.

No Fill tab on the highlighter picker.

### Break — **pass**

| Slice | Evidence |
|---|---|
| Desktop 1440 | All 9 `Set Stroke color …` counts **0**. |
| hubPreview | Chip **0**; Draw **0**. |
| Select / empty click | Did not invent another highlighter. |
| Pen-armed `#00FF00` | First desktop highlighter stayed `#FF0000`. |
| Named / 4-digit hex on CompactColorPicker | Kept `#0000FF` preference. |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| CompactColorPicker large swatch | Next highlighter `5aff7b86-…` fill `#0000FF`. First chip stroke stayed `#FF0000`. |
| Undo | CompactColorPicker highlighter gone; `#000000` chip stroke stayed. |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout. |
| Transparent desktop swatch | Stored `TRANSPARENT`. |

## Product

Highlighter paint was hardcoded yellow (`rgba(255, 193, 7, 0.3)`) on both the live SVG path and legacy PAL. Min-viable: `highlightColor={composeColorForPatch(strokeColor, strokeOpacity)}`. Commit fallback `highlightColor || strokeColor`. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched.

## Official / focused Node

Focused highlighter + related **22 / 22**. Cap **8448** not loosened. Official `npm test` (PDFViewer touch) proceeded through the main file list until `leftover18FailClosed` **11 / 12**: `lease assign cannot invent a second-account tuple` asserts `.env.local` absent; names are **PRESENT** from parked X-01 wiring (gitignored; no lease; this pass did not write it). Isolated **8448** not reached. Did **not** loosen leftover-18 or invent a lease.

## Next leftover

Named next reachable picker slice: **live C-02 hex lengths**. Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

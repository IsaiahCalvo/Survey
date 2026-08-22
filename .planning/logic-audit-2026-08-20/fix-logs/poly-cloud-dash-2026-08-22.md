# Live Poly / Cloud Style every discrete dash — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after Callout remaining formatting. Distinct from Rect/Ellipse/Text every-style, Line/Arrow/Callout every-style, Cloud bump 1–20, and Poly every-swatch. Not leftover-18. No create-poly tool (selected-patch only).

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright used Vite `localhost:5173` (`::1`) with process auto-login names absent.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| UL-33 **pass** / Rect/Ellipse/Text every-style | Create-tool catalogs + selected-patch on those types. Imported poly unused. |
| Line/Arrow / Callout every dash | Those tools only. |
| Cloud bump 1–20 | Intensity field only. Not Style Solid/Dashed/Dotted/Cloud on a polygon. |
| Poly every-swatch | Fill/Border/stroke color. Not dash. |
| X-04 vertex-N / bbox | Handles only. Style unused. |

FEATURE-MATRIX leftover: imported polygon maps to `contextTool === 'rect'` (Style **Solid / Dashed / Dotted / Cloud** → `cloud-polygon`); polyline maps to `line` (Cloud **0**). No create-poly tool.

## Product

No product bug. `handleLineBorderStyleChange` already patches `strokeDashArray` / `pdfCloudIntensity` on selected polygon/polyline. SVG already emits dash on `polygon`/`polyline` and rebuilds `cloud-polygon` when intensity is finite. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. High-risk files not edited.

## Live-proved

Playwright `e2e-poly-cloud-dash.spec.mjs` **3 / 3 (11.9s)** on Vite `http://localhost:5173` (`npm run dev:ui`). Focused Node `polyCloudDash` + leftover18 **15 / 15**.

`viewBox="0 0 612 792"`. `file.id` null. Polygon A `5R`. Polygon B `7R`. Polyline `6R`.

### Intended — **pass**

Desktop + 390 selected-patch every Style on imported polygon A `5R` (**Solid / Dashed `[6,4]` / Dotted `[2,4]` / Cloud** → `data-shape-kind="cloud-polygon"`). Every dash on imported polyline `6R` (**Solid / Dashed / Dotted**). Cloud→Dashed clears intensity and returns to `polygon`.

| Style | stored | SVG |
|---|---|---|
| Solid | no dash / no cloud | `polygon` / `polyline`, no `stroke-dasharray` |
| Dashed | `[6, 4]` | `6 4` |
| Dotted | `[2, 4]` | `2 4` |
| Cloud (polygon only) | `pdfCloudIntensity` + no dash | `data-shape-kind="cloud-polygon"` |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Polyline Style | Cloud | **0** options (rect-mapped polygon only) |
| Create | Polygon / Polyline | **0** buttons; count stays 3 |
| Pen-armed | Style | **0**; `5R` dashed + `6R` dotted held |
| Cloud → Dashed | selected `5R` | cloud path cleared; `[6,4]` |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Isolation | later Dotted `7R` did not rewrite first Dashed `5R` |
| Undo | `7R` back to Solid; `5R` dashed + `6R` dotted held |
| Select empty | invents 0 |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Style **0** / Draw **0** |
| 390 | same catalogs + every selected-patch; Cloud→Dashed; isolation |

## Official / focused Node

Focused `polyCloudDash` + leftover18 **15 / 15**. Official `npm test` not run (8448 not reached / not loosened). Cap **8448** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Counter Number has no Font/size chrome (Size is pin radius). Leftover **18** stay parked. Goal stays open.

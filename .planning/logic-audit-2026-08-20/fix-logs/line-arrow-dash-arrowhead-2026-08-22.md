# Live Line/Arrow dash + arrowhead every discrete style — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after Highlighter Width every preset. Distinct from UL-33 catalog smoke (rect Dashed `6,4` / Dotted `2,4` + ellipse omits Cloud), S-04 selected-arrow sample (vShape / Open circle / None), color every-swatch, and Width every-preset. Not leftover-18.

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
| UL-33 **pass** (catalog completeness) | Armed Rectangle Dashed `6,4` + Dotted `2,4`; ellipse omits Cloud. Not Line/Arrow every style. |
| S-04 selected-arrow sample | vShape / Open circle / None on one selected Arrow. Not every head, not every dash, not Line, not 390. |
| S-03/S-04 every swatch / Width | Color and `strokeWidth` only. |

FEATURE-MATRIX S-03 leftover: dash. S-04 leftover: 6 head styles. Reachable catalogs: Style **Solid / Dashed / Dotted** (Cloud rect-only); Arrowhead **None / Solid triangle / V-shape / Open circle / Open triangle / Horizontal line**.

## Live-proved

Playwright `e2e-line-arrow-dash-arrowhead.spec.mjs` **2 / 2 (30.8s)** on Vite `http://127.0.0.1:5173` (`npm run dev:ui`, auto-login cleared). Focused Node `lineArrowDashArrowhead` **3 / 3**.

`viewBox="0 0 612 792"`. `file.id` null. Line dashed `8529c87d-…`. Arrow vShape `5429a79b-…`. Cloud-armed Line `e5b23919-…`. Isolation undone `f77a4e28-…`. 390 Line dotted `b73eebd2-…`. 390 Horizontal line `fab4248e-…`.

### Intended — **pass**

Desktop Style catalog Line + Arrow **Solid / Dashed / Dotted**. Arrowhead catalog all **6**. Next-draw + selected-patch every dash on Line and Arrow (`strokeDashArray` `null` / `[6,4]` / `[2,4]`; SVG `stroke-dasharray` matches). Next-draw + selected-patch every arrowhead on Arrow (SVG none / filled polygon / polyline / circle / open polygon / tick). Line create never stamps `arrowheadStyle`.

| Style | stored | SVG |
|---|---|---|
| Solid | `null` | no dash |
| Dashed | `[6, 4]` | `6 4` |
| Dotted | `[2, 4]` | `2 4` |

| Arrowhead | stored | SVG |
|---|---|---|
| None | `none` | shaft only |
| Solid triangle | `solidTriangle` | filled polygon |
| V-shape | `vShape` | polyline |
| Open circle | `openCircle` | circle |
| Open triangle | `openTriangle` | unfilled polygon |
| Horizontal line | `horizontalLine` | perpendicular tick |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Line Style | Cloud | **0** options (rect-only) |
| Line armed | Arrowhead | **0** |
| Cloud-armed Line create | after Rect Cloud | solid (`e5b23919-…`); no `pdfCloudIntensity` |
| Pen-armed | Style / Arrowhead | **0**; first dashed Line + dotted vShape Arrow held |
| Unknown head (Node) | `not-a-style` | fails closed to `none` |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Isolation | later Dotted Line did not rewrite first Dashed |
| Undo | isolation Line gone; first Dashed + Arrow dotted/vShape held |
| Select empty | invents 0 |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Style **0** / Arrowhead **0** / Draw **0** |
| 390 | Border style Solid/Dashed/Dotted (Cloud **0** on Line/Arrow); Arrowhead all 6 Title-Case labels; every next-draw dash + head; Rect still offers Cloud |

## Product

No product change. Harness-only: paint-group (not hit-target siblings) for visual head; 390 listbox close via trigger toggle; empty deselect before asserting Line hides Arrowhead. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. High-risk files not edited.

## Official / focused Node

Focused `lineArrowDashArrowhead` **3 / 3**. Cap **8448** not loosened. Did **not** run official `npm test` (no high-risk file). Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Reachable unblocked next: **Callout dash + arrowhead every discrete style** (same Style/Arrowhead pickers; T-02 leftover; this pass was Line/Arrow only). Counter remaining chrome still later if incomplete. Leftover **18** stay parked. Goal stays open.

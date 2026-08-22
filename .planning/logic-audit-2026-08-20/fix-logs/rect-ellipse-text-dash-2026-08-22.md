# Live Rect / Ellipse / Text Style every discrete value — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after Counter Fill + Number opacity continuum. Distinct from UL-33 catalog smoke (armed Rect Dashed/Dotted + ellipse omits Cloud), Line/Arrow/Callout every-style, Cloud bump 1–20, Cloud/Text every-swatch, and Width every-preset. Not leftover-18. No create-poly tool.

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
| UL-33 **pass** (catalog) | Armed Rect Dashed `6,4` / Dotted `2,4` + ellipse omits Cloud. Not every-value next-draw + selected-patch. |
| Line/Arrow / Callout every dash | Those tools only. Rect / Ellipse / Text leftover. |
| Cloud bump 1–20 | Intensity field only. Not Style Solid/Dashed/Dotted/Cloud switching. |
| S-01 every Width + Cloud every swatch | Width / color. Not dash. |
| T-01 live edit | Create + commit. Style picker unused. |

FEATURE-MATRIX leftover: Rect / Ellipse / Text Style. Reachable catalogs: Rect **Solid / Dashed / Dotted / Cloud**; Ellipse + Text **Solid / Dashed / Dotted** (Cloud 0). Poly has no create tool.

## Product

`buildBoundaryShapeCommitJSON` already stamped Rect/Ellipse `strokeDashArray` / Rect Cloud intensity. Selected-patch already wrote the same arrays onto textboxes. SVG `renderEllipse` and `renderText` border did **not** emit `stroke-dasharray`, so Dashed/Dotted stored but painted solid. Min-viable: map Fabric `strokeDashArray` onto those two SVG strokes (same `[6,4]` / `[2,4]` as Rect). Text next-draw create still stays Solid (current product, same as Fill/Border create). CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. High-risk files not edited.

## Live-proved

Playwright `e2e-rect-ellipse-text-dash.spec.mjs` **2 / 2 (27.3s)** on Vite `http://127.0.0.1:5173` (`npm run dev:ui`, auto-login cleared). Focused Node `rectEllipseTextDash` + leftover18 **15 / 15**.

`viewBox="0 0 612 792"`. `file.id` null. Dashed Rect `957a9a32-…`. Dotted Rect `2dbc0dce-…`. Cloud Rect `8354ea35-…`. Dashed Ellipse `bb2dbf94-…`. Dotted Ellipse `638905e4-…`. Cloud-armed Ellipse `e629ccb7-…`. Text selected-patch `dashed`. Text next-draw create `431a0fce-…` stayed Solid. Isolation undone `c41ad70b-…`. 390 Cloud `1aa03082-…`. 390 Dotted Ellipse `98fff71f-…`.

### Intended — **pass**

Desktop Rect Style **Solid / Dashed / Dotted / Cloud**. Ellipse + Text Style **Solid / Dashed / Dotted**. Next-draw + selected-patch every Rect style (`strokeDashArray` `null` / `[6,4]` / `[2,4]` + Cloud `pdfCloudIntensity` + SVG `cloud-rect`). Next-draw + selected-patch every Ellipse dash (SVG ellipse `stroke-dasharray`). Text selected-patch every dash (SVG border rect).

| Style | stored | SVG |
|---|---|---|
| Solid | no dash / no cloud | no `stroke-dasharray` |
| Dashed | `[6, 4]` | `6 4` |
| Dotted | `[2, 4]` | `2 4` |
| Cloud (Rect only) | `pdfCloudIntensity` + no dash | `data-shape-kind="cloud-rect"` |

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Ellipse / Text Style | Cloud | **0** options (rect-only) |
| Cloud-armed Ellipse create | after Rect Cloud | solid (`e629ccb7-…`) |
| Text next-draw | armed Dashed | create stays Solid (`431a0fce-…`; current product) |
| Pen-armed | Style | **0**; first dashed Rect + dotted Ellipse + dashed Text held |
| Cloud → Dashed | selected Rect | cloud path cleared; `[6,4]` |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Isolation | later Dotted Rect did not rewrite first Dashed |
| Undo | isolation Rect gone; first Dashed Rect + dotted Ellipse + dashed Text held |
| Select empty | invents 0 |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Style **0** / Draw **0** |
| 390 | Border style Rect Solid/Dashed/Dotted/Cloud; Ellipse + Text omit Cloud; every next-draw Rect/Ellipse; Text selected-patch all 3 |

## Official / focused Node

Focused `rectEllipseTextDash` + leftover18 **15 / 15**. Official `npm test` not run (8448 not reached / not loosened). Cap **8448** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Reachable unblocked next: **Callout remaining formatting** (font / size / align) if still sample-only on that target. Leftover **18** stay parked. Goal stays open.

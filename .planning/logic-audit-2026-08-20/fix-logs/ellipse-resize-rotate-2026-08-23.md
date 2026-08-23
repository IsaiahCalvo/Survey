# Live E-01 / E-02 leftover: selected ellipse bbox resize + canvas `mtr` — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after D-01/D-02 live freehand stroke (`2b110c08` / `07da5b4c`). Rect 8-handle resize is `e2e-annotation-resize`. Rect `mtr` is `e2e-annotation-rotate`. Ellipse Style dash is `e2e-rect-ellipse-text-dash`. Export-scale leftover resizes then flatten-exports — not this live slice. Callout corners are T-02. Line `p1`/`p2`/`midpoint` are S-03/S-04. Polygon `vertex-N` is X-04. Double-click bbox is `e2e-bbox-edit-mode`. Survey-marker 8 handles / counter nubbin are their own slices. Distinct from leftover-18, E-03 move, V-01 pan, V-02 select, color / Match Fill / zoom / page-field / pill / textbox-create / pan / move / rect resize / rect rotate catalogs. Did **not** invent flatten / stamp / Forms. Did **not** replay 96 IDs.

Ellipse visible size is `rx*2*|sx|` / `ry*2*|sy|` (not `width`/`height`).

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

No product change. Harness only.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched.

## Live-proved

Playwright `e2e-ellipse-resize-rotate.spec.mjs` **2 / 2 (18.2s)** on Vite `http://127.0.0.1:5173`. Focused Node `ellipseResizeRotate` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop: single-click A (`rx 60.2` / `ry 70.28`) shows all 8 handles (`tl tr bl br mt mb ml mr`) + `mtr`. `br` grow `Δw 58.07 / Δh 42.05`; raw rx/ry held (scale grows); opposite left/top pinned; B isolated. Ctrl+Z restores; Ctrl+Shift+Z redo; second undo. `mr` width-only `Δw 50.06`; `mb` height-only `Δh 42.05`. Free-drag `mtr` (no Shift, no pill) to **90.00°** then **180.00°**; width/height/left/top held; B isolated. Undo/redo restores 0 / 90.

390: `br` grow `Δw 71.28 / Δh 55.89`; raw rx held; B isolated; undo. Free-drag `mtr` to **90.00°**; width held; B isolated; undo.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty Select | no selection | handles **0**; `mtr` **0**; drag invents 0 |
| Collapse | `br` 92% inward | floors `vw 1.20` (not vanish) |
| Deselect | empty click | handles **0**; `mtr` **0** |
| Group A+B | Shift-click / 390 marquee | `moveOnly` hides `mtr` |
| Line single-click | endpoints | `mtr` **0** |
| Micro-drag | 1×1 px on `mtr` | angle stays 0 |
| Pen empty-page | freehand | invents ink; A size/angle held |

### Edge

| Slice | Evidence |
|---|---|
| Shift+br | aspect `0.85657` held after grow |
| Flip past opposite | origin `left 77.58`; `|scale|` commit; size > 0 |
| Pen-armed handle | `br` still resizes A |
| Isolation | B held across A resize / flip / rotate |
| Undo / redo | stack restores A size and angle |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Draw **0**; resize handles **0**; `mtr` **0** |
| 390 | `br` grow + `mtr` 90° + collapse floor `vw 9.36` + group hide + deselect |

## Official / focused Node

No high-risk file. Official `npm test` not re-run. Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Next unique live leftover after this ellipse slice: textbox / callout / cloud / counter selected resize or canvas rotate if live handles exist and are not already receipted. Leftover **18** stay parked. Goal stays open.

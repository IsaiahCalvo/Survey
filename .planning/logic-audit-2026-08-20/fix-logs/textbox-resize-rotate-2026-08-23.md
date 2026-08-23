# Live T-01 leftover: selected textbox bbox resize + canvas `mtr` — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after ellipse bbox resize + canvas `mtr` (`49dad1cf` / `c5226a93`). T-01 create auto-edit is `e2e-textbox-create-edit`. UL-36 is Aa re-entry. Style Solid/Dashed/Dotted is `e2e-rect-ellipse-text-dash`. Callout corners are T-02. Rect 8-handle resize is `e2e-annotation-resize`. Rect `mtr` is `e2e-annotation-rotate`. Ellipse transform is `e2e-ellipse-resize-rotate`. Distinct from leftover-18, E-03 move, V-01 pan, V-02 select, color / Match Fill / zoom / page-field / pill / textbox-create / pan / move / rect resize / rect rotate catalogs. Did **not** invent flatten / stamp / Forms. Did **not** replay 96 IDs.

Textbox resize **bakes** scale into `width`/`height` (reflow; `scale` stays 1). Flip is refused (`Math.max(0.1, newScale)`).

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

Playwright `e2e-textbox-resize-rotate.spec.mjs` **2 / 2 (17.8s)** on Vite `http://127.0.0.1:5173`. Focused Node `textboxResizeRotate` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop: wrap-text A (`width 171.36` / `height 75`) single-click shows all 8 handles (`tl tr bl br mt mb ml mr`) + `mtr` and stays out of edit. `br` grow `Δw 56.07 / Δh 40.05`; width/height baked; `scaleX 1`; opposite left/top pinned; B isolated. Ctrl+Z restores; Ctrl+Shift+Z redo; second undo. `mr` width-only `Δw 48.06`; `mb` height-only `Δh 40.05`. Free-drag `mtr` (no Shift, no pill) to **90.00°** then **180.00°**; width/height/left/top/text held; B isolated. Undo/redo restores 0 / 90.

390: `br` grow `Δw 69.28 / Δh 53.89`; bake width; `scaleX 1`; B isolated; undo. Free-drag `mtr` to **90.00°**; width held; B isolated; undo.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty Select | no selection | handles **0**; `mtr` **0**; drag invents 0 |
| Overshoot past opposite | `br` past far corner | **no flip**; left pinned `97.92`; floors `vw 17.14` (~10%); `scaleX 1` |
| Collapse | `br` 92% inward | floors `vw 17.14` (0.1 clamp; not vanish) |
| Deselect | empty click | handles **0**; `mtr` **0** |
| Group A+B | Shift-click / 390 marquee | `moveOnly` hides `mtr` |
| Line single-click | endpoints | `mtr` **0** |
| Micro-drag | 1×1 px on `mtr` | angle stays 0 |
| Pen empty-page | freehand | invents ink; A size/angle/text held |

### Edge

| Slice | Evidence |
|---|---|
| Shift+br | aspect `2.28480` held after grow |
| No flip | origin held; `|scale|` not stored negative |
| Pen-armed handle | `br` still resizes A |
| Isolation | B held across A resize / overshoot / rotate |
| Undo / redo | stack restores A size and angle |
| Single-click | stays out of edit overlay |
| Font | `Helvetica` (single name) |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Draw **0**; Text **0**; resize handles **0**; `mtr` **0** |
| 390 | `br` grow + `mtr` 90° + collapse floor `vw 23.26` + group hide + deselect |

## Official / focused Node

No high-risk file. Official `npm test` not re-run. Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Next unique live leftover after this textbox slice: callout / cloud / counter selected resize or canvas rotate if live handles exist and are not already receipted. Leftover **18** stay parked. Goal stays open.

# Live D-01 leftover: selected Pen / Highlighter bbox resize + canvas `mtr` — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after Cloud bbox resize + canvas `mtr` (`0c2d0d01` / `5275542e` / `8c24623a`). Callout selected bbox/`mtr` is **not live** — selected callouts expose knee / arrowTip / `textBox-tl/tr/bl/br` only (T-02 + knee already receipted). D-01/D-02 live stroke create is `e2e-freehand-live-stroke`. Pen/Highlighter Width catalogs already dedicated. Solid-rect / ellipse / textbox / cloud-rect transform already dedicated. Distinct from leftover-18, E-03 move, V-01 pan, V-02 select, color / Match Fill / zoom / page-field / pill / Width catalogs. Did **not** invent flatten / stamp / Forms. Did **not** replay 96 IDs.

Skipped (inspected, not unique leftover chrome):

| Candidate | Why skipped |
|---|---|
| Counter selected bbox / `mtr` | Single-click chrome is nubbin-only (`data-counter-nubbin-handle`; Shottr-style — no dashed bbox / 8 handles). Nubbin / Size / Start / series Delete + bbox-edit-mode already receipted. |
| Keyboard nudge | Not wired. `PDFViewer` ArrowLeft/Right are page nav. SVG layer keys are Delete/Backspace + cut/copy/z-order. Cmd+Arrow movement was deferred. RotationInputField ArrowUp/Down is already receipted. |
| Insert image / stamp | No `setActiveTool('stamp'\|'image')`. `showTextMarkupHighlightMenu = false`. Forms category `{false && (` compile-hidden. |

Ink resize uses `applyPageAffineToInkObject` / `commitInkObjectResize` (scale/affine; path commands may hold). `sourceWidth` and highlighter `multiply` held. Flip is the `|scale|` commit.

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

Playwright `e2e-ink-resize-rotate.spec.mjs` **2 / 2 (22.7s)** on Vite `http://127.0.0.1:5173`. Focused Node `inkResizeRotate` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop: Pen A (`291606d3-…`) / Highlighter B (`e6e051db-…`) `sourceWidth` **16**; A path `d` 3865. Single-click shows all 8 handles + `mtr`. `br` grow `Δw 58.07 / Δh 42.05` pins left/top; path commands may hold; `sourceWidth` held; B isolated (`multiply` + path). Ctrl+Z restores size; Ctrl+Shift+Z redo; second undo. `mr` width-only `Δw 50.06`; `mb` height-only `Δh 42.05`. Free-drag `mtr` (no Shift, no pill) to **90.00°** then **180.00°**; width/height/`sourceWidth`/Pen held; B isolated. Undo/redo restores 0 / 90.

390: Pen A (`6031db2a-…`) / Highlighter B (`8d8be900-…`); `br` grow `Δw 71.28 / Δh 55.89`; `sourceWidth` 16 held; B isolated; undo. Free-drag `mtr` to **90.00°**; width/Pen held; B isolated; undo.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty Select | no selection | handles **0**; `mtr` **0**; drag invents 0 |
| Flip past opposite | `br` past far corner | origin moves `left 446.19`; `|scale|` commit; Pen held |
| Collapse | `br` 92% inward | floors `vw 6.93` (not vanish); still `path` |
| Deselect | empty click | handles **0**; `mtr` **0** |
| Group A+B | Shift-click / 390 marquee | `moveOnly` hides `mtr` |
| Line single-click | endpoints | `mtr` **0**; A stays Pen |
| Micro-drag | 1×1 px on `mtr` | angle stays 0 |
| Highlighter selected | 8 + `mtr` | `br` grows B; `multiply` + `sourceWidth` held; A isolated |

### Edge

| Slice | Evidence |
|---|---|
| Affine / path hold | `d` 3865 at create; resize writes scale (not Width catalog); `sourceWidth` **16** held |
| Shift+br | aspect `4.18846` held after grow |
| Flip | `|scale|` stored positive; Pen held |
| Isolation | B path/size/`multiply`/`sourceWidth` held across A resize / flip / rotate |
| Undo / redo | stack restores A size and angle |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Draw **0**; resize handles **0**; `mtr` **0** |
| 390 | `br` grow + `mtr` 90° + collapse floor `vw 13.61` + group hide + deselect |

## Official / focused Node

No high-risk file. Official `npm test` not re-run. Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Counter / keyboard nudge / insert image have no unique unblocked chrome. Leftover **18** stay parked. Goal stays open.

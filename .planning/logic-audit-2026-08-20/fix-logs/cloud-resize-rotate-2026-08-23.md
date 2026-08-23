# Live S-01 leftover: selected Cloud bbox resize + canvas `mtr` — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after textbox bbox resize + canvas `mtr` (`ec8d0354` / `3a1aa97c`). Callout selected bbox/`mtr` is **not live** — selected callouts expose knee / arrowTip / `textBox-tl/tr/bl/br` only (T-02 corners + knee already receipted; mid-edge `textBox-mt/ml/mb/mr` does not exist; wave-5 contract: no `mtr`). Cloud bump 1–20 is `e2e-cloud-bump-1-20`. Cloud Fill/Border is `e2e-cloud-colors`. Rect Style catalog is `e2e-rect-ellipse-text-dash`. Solid-rect 8-handle is `e2e-annotation-resize`. Solid-rect `mtr` is `e2e-annotation-rotate`. Distinct from leftover-18, E-03 move, V-01 pan, V-02 select, color / Match Fill / zoom / page-field / pill / bump / dash catalogs. Did **not** invent flatten / stamp / Forms. Did **not** replay 96 IDs.

Style→Cloud (`cloud-rect`) rebuilds the scalloped path from `effectiveWidth`/`effectiveHeight` on every render. Intensity is held. Flip is the rect `|scale|` commit.

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

Playwright `e2e-cloud-resize-rotate.spec.mjs` **2 / 2 (18.5s)** on Vite `http://127.0.0.1:5173`. Focused Node `cloudResizeRotate` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop: Cloud A (`3d88cb0d-…`) / B (`21bac324-…`) `pdfCloudIntensity` **2**; path `d` 1758 / 34 humps. Single-click shows all 8 handles + `mtr`. `br` grow `Δw 56.07 / Δh 40.05` pins left/top; path rebuilds **2996** / **44** humps; intensity held; B isolated. Ctrl+Z restores path + size; Ctrl+Shift+Z redo; second undo. `mr` width-only `Δw 48.06`; `mb` height-only `Δh 40.05`; path rebuilds. Free-drag `mtr` (no Shift, no pill) to **90.00°** then **180.00°**; width/height/left/top/kind/intensity/pathLen held; B isolated. Undo/redo restores 0 / 90.

390: Cloud A (`8d97032c-…`) / B (`01faa2a2-…`); `br` grow `Δw 69.28 / Δh 53.89`; path 2548 → 3794; intensity 2 held; B isolated; undo. Free-drag `mtr` to **90.00°**; width/kind/intensity held; B isolated; undo.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty Select | no selection | handles **0**; `mtr` **0**; drag invents 0 |
| Flip past opposite | `br` past far corner | origin moves `left 63.34`; `|scale|` commit; kind + intensity held |
| Collapse | `br` 92% inward | floors `vw 1.33` (not vanish); still `cloud-rect` |
| Deselect | empty click | handles **0**; `mtr` **0** |
| Group A+B | Shift-click / 390 marquee | `moveOnly` hides `mtr` |
| Line single-click | endpoints | `mtr` **0**; A stays `cloud-rect` |
| Micro-drag | 1×1 px on `mtr` | angle stays 0 |
| Pen empty-page | freehand | invents ink; A size/angle/kind held |

### Edge

| Slice | Evidence |
|---|---|
| Path rebuild | `d` 1758 → 2996; humps 34 → 44; intensity **2** held |
| Shift+br | aspect `0.84808` held after grow |
| Flip | `|scale|` stored positive; kind held |
| Pen-armed handle | `br` still resizes A; kind + intensity held |
| Isolation | B path/size/intensity held across A resize / flip / rotate |
| Undo / redo | stack restores A size, path, and angle |
| Bump field | visible after select (catalog **not** replayed) |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Draw **0**; Style **0**; resize handles **0**; `mtr` **0** |
| 390 | `br` grow + path rebuild + `mtr` 90° + collapse floor `vw 9.81` + group hide + deselect |

## Official / focused Node

No high-risk file. Official `npm test` not re-run. Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Next unique live leftover after this Cloud slice: counter selected resize or canvas rotate if live handles exist and are not already receipted (nubbin/Size/Start/series Delete already proved). Keyboard nudge if wired. Leftover **18** stay parked. Goal stays open.

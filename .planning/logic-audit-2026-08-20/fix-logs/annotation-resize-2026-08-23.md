# Live E-01 leftover: single-click rect bbox resize — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after E-03 selected-annotation move (`1be2f985`). Prior E-01 was wave-2 Node handle names / cursors / adaptive spec. Callout corners are T-02. Line `p1`/`p2`/`midpoint` are S-03/S-04. Polygon `vertex-N` is X-04. Double-click bbox is `e2e-bbox-edit-mode`. Survey-marker 8 handles are their own slice. Distinct from leftover-18, E-02 rotation, E-03 move, V-01 pan, V-02 select, color / Match Fill / zoom / page-field / rotation / textbox-create / pan / move catalogs. Did **not** invent flatten / stamp / Forms. Did **not** replay 96 IDs.

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

Playwright `e2e-annotation-resize.spec.mjs` **2 / 2 (12.7s)** on Vite `http://127.0.0.1:5173`. Focused Node `annotationResize` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop: single-click A shows all 8 handles (`tl tr bl br mt mb ml mr`). `br` grow `Δw 56.07 / Δh 40.05`; opposite left/top pinned; B isolated. Ctrl+Z restores; Ctrl+Shift+Z redo; second undo. `mr` width-only `Δw 48.06`; `mb` height-only `Δh 40.05`.

390: `br` grow `Δw 69.28 / Δh 53.89`; left pinned; B isolated; undo.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty Select | no selection | handles **0**; drag invents 0 |
| Collapse | `br` 92% inward | floors `vw 1.41` (not vanish) |
| Deselect | empty click | handles **0** |
| Pen empty-page | freehand | invents ink; A/B size held |

### Edge

| Slice | Evidence |
|---|---|
| Shift+br | aspect `0.85657` held after grow |
| Flip past opposite | origin `left 75.58`; `|scale|` commit; size > 0 |
| Pen-armed handle | `br` still resizes A |
| Isolation | B held across A resize / flip |
| Undo / redo | stack restores A size |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Draw **0**; resize handles **0** |
| 390 | `br` grow + collapse floor `vw 7.36` + deselect hides |

## Official / focused Node

No high-risk file. Official `npm test` not re-run. Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

# Live E-02 leftover: canvas `mtr` free-drag rotate — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after E-01 single-click rect bbox resize (`547c4a76`). Prior E-02 dedicated the typed degree pill. Survey-marker `mtr` and counter nubbin/orbit are their own slices. Shift+45° handle snap was a followup-2 sample only. Distinct from leftover-18, E-01 resize, E-03 move, V-01 pan, V-02 select, color / Match Fill / zoom / page-field / pill / textbox-create / pan / move / resize catalogs. Did **not** invent flatten / stamp / Forms. Did **not** replay 96 IDs.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

No product change. Harness only: arming Pen does not tear down selection chrome (same as E-01). Empty-page Pen invents ink; A angle held.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched.

## Live-proved

Playwright `e2e-annotation-rotate.spec.mjs` **2 / 2 (12.0s)** on Vite `http://127.0.0.1:5194`. Focused Node `annotationRotate` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop: single-click A shows `mtr`. Free-drag (no Shift, no pill) to **90.00°**; width/height/left/top held; B isolated. Ctrl+Z restores 0; Ctrl+Shift+Z redo; second undo. Second free-drag to **180.00°**; undo.

390: free-drag to **90.00°**; width held; B isolated; undo.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page | Select drag | `mtr` **0**; invents 0 |
| Micro-drag | 1×1 px on `mtr` | angle stays 0 |
| Group A+B | Shift-click / 390 marquee | `moveOnly` hides `mtr` |
| Line single-click | endpoints | `mtr` **0** |
| Pen empty-page | freehand | invents ink; A angle held |

### Edge

| Slice | Evidence |
|---|---|
| Isolation | B angle/left held across A 90° |
| Undo / redo | stack restores 0 / 90 |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Draw **0**; `mtr` **0** |
| 390 | free 90° + group hide |

## Official / focused Node

No high-risk file. Official `npm test` not re-run. Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

# Live E-03 leftover: selected-annotation move — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after V-01 named toolbar Pan (`8d8c0b7e`). Prior E-03 was window “drag a rect off-page; multi-select drag” plus survey-marker body. Distinct from leftover-18, E-01 resize, E-02 rotation, V-01 pan, V-02 select, survey-marker body, color / Match Fill / zoom / page-field / rotation / textbox-create / pan catalogs. Did **not** invent flatten / stamp / Forms. Did **not** replay 96 IDs.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

No product change. Harness only:

- Home Documents chrome can cover `?testPdf=` — dismiss until `No documents yet` is 0.
- Default rect fill is transparent (`pointer-events: stroke`). Intended move uses a next-draw fill so the hit-target interior is body-move. Selected mid-edge is a resize handle.
- Toolbar Select probes scoped to `.btn-icon` / `.mobile-pdf-tools__button`. Creation-tool `tool-crosshair` on the SVG root intercepts child locator clicks — arm Select (`V`) until the crosshair drops, then `page.mouse`.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched.

## Live-proved

Playwright `e2e-annotation-move.spec.mjs` **2 / 2 (13.1s)** on Vite `http://127.0.0.1:5192`. Focused Node `annotationMove` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop: filled A stroke/body-drag `Δ 48.06 / 36.04`; width/height/angle held; B isolated. Ctrl+Z restores; Ctrl+Shift+Z redo; second undo. Shift multi-select group-move `Δ 40.05 / 28.03` on A and B (same delta). Undo group-move restores both.

390: edge-drag A; undo; window marquee A+B; group-move keeps B dx with A.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page | Select drag | invents 0 |
| Micro-drag | 1×1 px | no commit (`> 2px` threshold) |
| Hollow H | center-drag | left/top held (`pointer-events: stroke`) |
| Off-page C | drag −220 / −180 | `left 0` / `top 0` (`constrainToPage`) |
| Pen-armed | freehand | invents ink; A/B stay |

### Edge

| Slice | Evidence |
|---|---|
| Isolation | B held across A move; A held across C clamp |
| Undo / redo | stack restores A; group-move undo restores A+B |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Draw **0**; annotation layer **0** |
| 390 | Edge-drag + marquee group-move + clamp `left/top 0` |

## Official / focused Node

No high-risk file. Official `npm test` not re-run. Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

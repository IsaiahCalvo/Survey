# Live V-01 leftover: named toolbar Pan — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after V-01 Spacebar temporary pan (`6f578d10`). Prior named-Pan was overflow + narrow sample only (`e2e-unblocked-followup`). Distinct from leftover-18, Spacebar hold / INPUT Space, UL-06 Zoom %, V-04 keyboard / Fit width, W4-02 pinch, color / Match Fill / page-field / rotation / textbox-create catalogs. Did **not** invent flatten / stamp / Forms. Did **not** replay 96 IDs.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

No product change. Harness only:

- Default rect fill is transparent — pan-mode quick-click is stroke-only (same Bluebeam-style model as Select). First pass center-clicked the hollow interior (harness miss).
- Toolbar Pan/Select probes scoped to `.btn-icon` / `.mobile-pdf-tools__button` so hub Documents Select is not the probe.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched.

## Live-proved

Playwright `e2e-named-toolbar-pan.spec.mjs` **2 / 2 (9.1s)** on Vite `http://127.0.0.1:5173`. Focused Node `namedToolbarPan` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop toolbar Pan `btn-active` + `data-space-pan=armed` via `interactionMode` (sticky `setActiveTool('pan')`). Empty click invents 0 and stays on Pan. Stroke quick-click selects the rect and auto-switches to Select. Re-arm stays sticky. Overflow drag `top 207`; second drag `top 7` without re-clicking. Pen then drew ink.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page click | 88% / 12% | invents 0; Pan stays |
| Native PDF link | `https://claude.com/` | click-through; viewer stays; Pan stays |
| Fit page (no overflow) | drag | invents 0; no invented horizontal scroll |
| Overlay | `?` | lists Select annotations; omits Pan / Spacebar |

### Edge

| Slice | Evidence |
|---|---|
| Rect isolation | left/top unchanged (scroll, not move) |
| Tool switch | Pen ink after leaving named Pan |
| Sticky | mouseup keeps Pan; second drag pans |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Draw / Pan / scroller **0** |
| 390 | RailButton Pan drag `left 80`; stroke quick-click → Select |

## Official / focused Node

No high-risk file. Official `npm test` not re-run. Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

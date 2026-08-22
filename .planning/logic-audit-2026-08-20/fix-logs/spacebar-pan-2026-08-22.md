# Live V-01 leftover: Spacebar temporary pan — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after T-01 textbox create auto-edit (`b96fe535`). Prior V-01 was named-Pan overflow + narrow sample (`e2e-unblocked-followup`). Distinct from leftover-18, UL-06 Zoom %, V-04 keyboard / Fit width, W4-02 pinch, toolbar Pan sample, color / Match Fill / page-field / rotation / textbox-create catalogs. Did **not** invent flatten / stamp / Forms. Did **not** replay 96 IDs.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

No product change. Harness only:

- Overflow via Ctrl+= (V-04). Desktop Zoom % typing was a setup miss (`4000` leftover) — not a Space pan bug.
- Space hold sets `data-space-pan=armed` and `html[data-survey-pdfjs-pan-active]` without `setActiveTool('pan')`.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched.

## Live-proved

Playwright `e2e-spacebar-pan.spec.mjs` **2 / 2 (9.3s)** on Vite `http://127.0.0.1:5173`. Focused Node `spacebarPan` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop hold Space arms grab; Pen toolbar stays off Pan. Space+drag moved overflow scroll `top 207`. Release disarms; Pen then drew ink. Toolbar Pan contrast does switch the tool.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Search INPUT | `ab` + Space | value `ab `; `data-space-pan=off` |
| Zoom % INPUT | Space | value unchanged; pan off |
| Space click | no drag | invents 0 |

### Edge

| Slice | Evidence |
|---|---|
| Rect isolation | left/top unchanged (scroll, not move) |
| Tool restore | Pen ink after keyup |
| Toolbar contrast | named Pan `btn-active` + `data-space-pan=armed`; `V` drops it |
| Overlay | KeyboardShortcutsOverlay omits Space |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Draw / Pan / scroller **0** |
| 390 | Space+drag `left 80`; Pen ink after release |

## Official / focused Node

No high-risk file. Official `npm test` not re-run. Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

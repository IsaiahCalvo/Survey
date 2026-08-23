# Live D-01 / D-02 leftover: freehand preview then commit — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after E-02 canvas `mtr` free-drag rotate (`aba418bd`). Prior D-01/D-02 dedicated create-time Width / swatch / 1-dot tap of the committed path. Distinct from leftover-18, E-01 resize, E-02 rotate, E-03 move, V-01 pan, V-02 select, color / Match Fill / Width catalogs. Did **not** invent flatten / stamp / Forms. Did **not** replay 96 IDs.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

No product change. Live `.freehand-creation-preview` polyline already paints during drag; pointerup / `zoomGeneration` flush commit via `buildFreehandCommitJSON`; pointercancel discards.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched.

## Live-proved

Playwright `e2e-freehand-live-stroke.spec.mjs` **2 / 2 (9.6s)** on Vite `http://127.0.0.1:34387`. Focused Node `freehandLiveStroke` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop: Pen drag paints `.freehand-creation-preview` (`583b6dd5-…` after pointerup); Highlighter live multiply + Width 4 floors preview at 8, commit `43139375-…` `sourceWidth` **8**. Undo/redo restores Pen. A isolated.

390: Pen live-then-commit `57d3d005-…`; Highlighter multiply preview then `c8d9e743-…`. A isolated.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page | Select drag | live preview **0**; invents 0 |
| pointercancel | mid-stroke | preview **0**; invents 0 |
| Zoom mid-stroke | Ctrl+= while down | flushes `13490ec6-…`; pointerup does not double-commit |

### Edge

| Slice | Evidence |
|---|---|
| Isolation | A left/top held; earlier Pen + Highlighter survive zoom flush |
| Undo / redo | stack drops / restores Pen ink |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. `zoomGeneration` flush. |
| `file.id` | null throughout |
| hubPreview | Draw **0**; live preview **0** |
| 390 | live Pen + Highlighter multiply |

## Official / focused Node

No high-risk file. Official `npm test` not re-run. Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

# Live D-03 / D-04 leftover: Partial / Full eraser stroke then commit — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after selected Pen / Highlighter bbox resize + canvas `mtr` (`91a38d4a` / `e2e-ink-resize-rotate.spec.mjs`). Prior D-03/D-04 dedicated type chrome (`e2e-eraser-type.spec.mjs`) and every Size (`e2e-eraser-size-presets.spec.mjs`). This pass is the in-drag mask-clone / live-preview canvas, then pointerup commit — the freehand-live-stroke analog. Distinct from leftover-18, Size catalog, type dropdown / caret / E vs Shift+E, D-01/D-02 freehand preview. Did **not** invent flatten / stamp / Forms. Did **not** replay 96 IDs.

Skipped (inspected, not unique leftover chrome):

| Candidate | Why skipped |
|---|---|
| Line / Arrow selected bbox / `mtr` | Single-click chrome is `p1` / `p2` / `midpoint` only. 8-handle + `mtr` appear only in already-receipted bbox-edit mode. Prior specs asserted Line `mtr` **0**. |
| Poly selected transform | No create-poly tool (`setActiveTool('polygon'\|'polyline')` **0**). Imported `vertex-N` + bbox-edit already receipted. Do not invent create-poly. |
| Callout selected bbox / `mtr` | Not live (knee / arrowTip / `textBox-tl/tr/bl/br` already receipted). |
| Counter selected bbox / `mtr` | Nubbin-only. |
| Keyboard nudge | Not wired. ArrowLeft/Right are page nav. |
| Insert image / stamp | No create path. |

Eraser preview uses `FabricEraserCanvas` `[data-eraser-mask-clone]` / `[data-eraser-carve-chunk]` / `[data-eraser-live-preview]`. `pointercancel` and `zoomGeneration` **commit** the live erase (user already saw it) — opposite of freehand discard.

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

Playwright `e2e-eraser-live-stroke.spec.mjs` **2 / 2 (14.0s)** on Vite `http://127.0.0.1:5173`. Focused Node `eraserLiveStroke` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop: Partial live mask-clone / carve / canvas before pointerup; ids held mid-drag; pointerup bites ink A `5ff39712-…` and isolates rect A `29f99330-…` / rect B `2a70e217-…` / ink B `22843edf-…`. Undo/redo restores the bite. Full stroke live preview then deletes A and isolates B.

390: Partial live preview then bite ink `5ccfcca8-…`; Full Stroke live preview then deletes rect `11ef832e-…`.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty swipe | far corner | preview **0**; invents **0** |
| pointercancel mid-stroke | cancel after live preview on ink B | preview drops; **commits** the live bite (not discard) |
| zoom mid-stroke | Ctrl+= on ink `e4dd9eab-…` | `zoomGeneration` flushes commit; preview drops; no leftover drag |
| Pen / Select | arm those tools | eraser wrapper **0**; preview **0** |

### Edge

| Slice | Evidence |
|---|---|
| Isolation | Partial bite leaves rects + ink B; Full stroke leaves B |
| Undo / redo | stack restores Partial ink bite |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Draw **0**; eraser wrapper **0**; preview **0** |
| 390 | Partial bite + Full Stroke delete + Pen hide |

## Official / focused Node

No high-risk file. Official `npm test` not re-run. Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Line `mtr` / poly create / callout bbox stay not-live. Leftover **18** stay parked. Goal stays open.

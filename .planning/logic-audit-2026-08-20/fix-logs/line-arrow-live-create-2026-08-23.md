# Live S-03 / S-04 leftover: Line/Arrow rubber-band then commit — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after S-01 / S-02 live rect/ellipse rubber-band (`e0ef0b26` / `e2e-shape-live-create.spec.mjs`). Prior S-03/S-04 dedicated `p1`/`p2`/`midpoint` handles, dash / arrowhead catalogs, swatches, and Width. Distinct from leftover-18, S-01/S-02 filled `g.shape-creation-preview`, D-01/D-02 freehand `.freehand-creation-preview`, E-01 resize, E-02 rotate, E-03 move, V-01 pan, color / Match Fill / Width / dash catalogs. Did **not** invent flatten / stamp / Forms. Did **not** replay 96 IDs.

Skipped (inspected, not unique leftover chrome):

| Candidate | Why skipped |
|---|---|
| Rotation family | Typed pill + Arrow/Shift+Arrow + free-drag + Shift+45 already dedicated. |
| Line / Arrow selected 8-handle + `mtr` | Not unique (`p1`/`p2`/`midpoint` only). |
| Rect / Ellipse live create | Just receipted (`e2e-shape-live-create.spec.mjs`). |
| Callout selected bbox / `mtr` | Not live. Callout create is a different `.callout-preview` path (next leftover). |
| Counter bbox / `mtr` | Nubbin-only. |
| Keyboard nudge | Not wired. ArrowLeft/Right are page nav. |
| Insert image / stamp | No create path. |
| Group-rotate 15° | Group `moveOnly` hides `mtr`. |
| Tab reorder / title rename | No real two-PDF-tab path. |
| Text-markup highlight / Theme | Compile-hidden / absent. |
| Create-poly / Extract / measure / Group / Note-Link / Forms / Print panel | Not live / compile-hidden. |

Product path is distinct: in-drag `line.shape-creation-preview` via CREATE-01 dashed translucent `5,5` / opacity `0.6`; pointerup commits `buildLineCommitJSON` (3pt length gate; Line never stamps `arrowheadStyle`; Arrow stamps toolbar default `solidTriangle`; commit restores solid). `zoomGeneration` does **not** flush drag-out lines (they keep tracking). `pointercancel` discards.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

No product change. Live `line.shape-creation-preview` already paints during drag; pointerup commits; pointercancel discards; zoom mid-drag keeps tracking.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched.

## Live-proved

Playwright `e2e-line-arrow-live-create.spec.mjs` **2 / 2 (8.4s)** on Vite `http://127.0.0.1:5173`. Focused Node `lineArrowLiveCreate` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop: Line drag paints `line.shape-creation-preview` (dashed `5,5` / opacity `0.6`; not Rect `g` / not Callout) then commit `8f221512-…` **len 213.64** (solid; no `arrowheadStyle`). Arrow live then commit `384921ce-…` **len 224.52** / `solidTriangle`. Undo/redo restores Line. A isolated.

390: Line live-then-commit `7864b6f1-…` (no head); Arrow `59c207d3-…` `solidTriangle`. A isolated.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page | Select drag | live line preview **0**; invents 0 |
| Tiny click | same-point pointerup | invents 0 (3pt gate) |
| pointercancel | mid-drag | preview **0**; invents 0 |
| Zoom mid-drag | Ctrl+= while down | does **not** flush; pointerup commits one `9b29bf2a-…` |

### Edge

| Slice | Evidence |
|---|---|
| Isolation | A left/top/length held; earlier Line + Arrow survive zoom keep-track |
| Undo / redo | stack drops / restores Line |
| CREATE-01 | preview dashed `5,5` (not Style `[6,4]`); commit solid |
| Head stamp | Line never stamps `arrowheadStyle`; Arrow stamps `solidTriangle` |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. Drag-out keep-track (not freehand flush). |
| `file.id` | null throughout |
| hubPreview | Draw **0**; live line preview **0** |
| 390 | live Line + Arrow |

## Official / focused Node

No high-risk file. Official `npm test` not re-run. Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Callout live create (`.callout-preview`) is a different path. Leftover **18** stay parked. Goal stays open.

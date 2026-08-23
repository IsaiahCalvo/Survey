# Live S-01 / S-02 leftover: rect/ellipse rubber-band then commit — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after E-02 pill Arrow ±1 / Shift+Arrow ±45 (`871f3547` / `e2e-rotation-input-arrow.spec.mjs`). Prior S-01/S-02 dedicated Style / Width / Cloud catalogs + selected bbox resize / canvas `mtr`. Distinct from leftover-18, D-01/D-02 freehand `.freehand-creation-preview`, E-01 resize, E-02 rotate, E-03 move, V-01 pan, color / Match Fill / Width catalogs. Line/arrow dashed CREATE-01 preview is a different path (not this slice). Did **not** invent flatten / stamp / Forms. Did **not** replay 96 IDs.

Skipped (inspected, not unique leftover chrome):

| Candidate | Why skipped |
|---|---|
| Rotation family | Typed pill + Arrow/Shift+Arrow + free-drag + Shift+45 already dedicated. |
| Line / Arrow selected 8-handle + `mtr` | Not unique (`p1`/`p2`/`midpoint` only). |
| Line / Arrow live create | Dashed translucent preview + 3pt `buildLineCommitJSON` — different path. |
| Callout selected bbox / `mtr` | Not live. |
| Counter bbox / `mtr` | Nubbin-only. |
| Keyboard nudge | Not wired. ArrowLeft/Right are page nav. |
| Insert image / stamp | No create path. |
| Group-rotate 15° | Group `moveOnly` hides `mtr`. |
| Tab reorder / title rename | No real two-PDF-tab path. |
| Text-markup highlight / Theme | Compile-hidden / absent. |
| Create-poly / Extract / measure / Group / Note-Link / Forms / Print panel | Not live / compile-hidden. |

Product path is distinct: in-drag `g.shape-creation-preview` via `computeDrawnBoundaryShapePreviewGeometry`; pointerup commits `buildBoundaryShapeCommitJSON` (2pt gate, `drawn-centered-stroke`). `zoomGeneration` does **not** flush drag-out shapes (they keep tracking). `pointercancel` discards.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

No product change. Live `.shape-creation-preview` already paints during drag; pointerup commits; pointercancel discards; zoom mid-drag keeps tracking.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched.

## Live-proved

Playwright `e2e-shape-live-create.spec.mjs` **2 / 2 (8.7s)** on Vite `http://127.0.0.1:5173`. Focused Node `shapeLiveCreate` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop: Rect drag paints `.shape-creation-preview` then commit `b59d68d0-…` **157.12 × 140.56** (`drawn-centered-stroke`). Ellipse live rx/ry then commit `64ac23e0-…` **78.56 / 78.20**. Undo/redo restores Rect. A isolated.

390: Rect live-then-commit `fd0b2a30-…`; Ellipse `9aabc66c-…` rx held. A isolated.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page | Select drag | live preview **0**; invents 0 |
| Tiny click | same-point pointerup | invents 0 (2pt gate) |
| pointercancel | mid-drag | preview **0**; invents 0 |
| Zoom mid-drag | Ctrl+= while down | does **not** flush; pointerup commits one `4782333b-…` |

### Edge

| Slice | Evidence |
|---|---|
| Isolation | A left/top held; earlier Rect + Ellipse survive zoom keep-track |
| Undo / redo | stack drops / restores Rect |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. Drag-out keep-track (not freehand flush). |
| `file.id` | null throughout |
| hubPreview | Draw **0**; live preview **0** |
| 390 | live Rect + Ellipse |

## Official / focused Node

No high-risk file. Official `npm test` not re-run. Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

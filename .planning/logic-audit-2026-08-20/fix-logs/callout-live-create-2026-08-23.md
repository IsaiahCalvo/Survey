# Live T-02 leftover: Callout rubber-band then commit — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after S-03 / S-04 live Line/Arrow rubber-band (`578425d8` / `e2e-line-arrow-live-create.spec.mjs`). Prior T-02 dedicated create geometry / knee / `textBox-tl/tr/bl/br` / flip / rollback / dash / arrowhead / formatting catalogs. Distinct from leftover-18, S-01/S-02 filled `g.shape-creation-preview`, S-03/S-04 `line.shape-creation-preview`, D-01/D-02 freehand preview, T-01 textbox auto-edit, E-01 resize, E-02 rotate, E-03 move, V-01 pan. Did **not** invent flatten / stamp / Forms. Did **not** replay 96 IDs.

Skipped (inspected, not unique leftover chrome):

| Candidate | Why skipped |
|---|---|
| Rotation family | Typed pill + Arrow/Shift+Arrow + free-drag + Shift+45 already dedicated. |
| Line / Arrow selected 8-handle + `mtr` | Not unique (`p1`/`p2`/`midpoint` only). |
| Rect / Ellipse / Line / Arrow live create | Just receipted. |
| Callout selected bbox / `mtr` | Not live (knee / corners already receipted). |
| Counter bbox / `mtr` | Nubbin-only. Counter pin-to-place already receipted. |
| Cloud live create | Style→Cloud is the Rect rubber-band already receipted (S-01). |
| Keyboard nudge | Not wired. ArrowLeft/Right are page nav. |
| Insert image / stamp | No create path. |
| Group-rotate 15° | Group `moveOnly` hides `mtr`. |
| Tab reorder / title rename | No real two-PDF-tab path. |
| Text-markup highlight / Theme | Compile-hidden / absent. |
| Create-poly / Extract / measure / Group / Note-Link / Forms / Print panel | Not live / compile-hidden. |

Product path is distinct: in-drag `g.callout-preview` via CREATE-01 dashed translucent `5,5` / opacity `0.6` (120×32 box + leader + solid-triangle ghost); pointerup commits `createCallout` (4px distance gate; default box 120×32; single-name `Arial`; commit restores solid). `zoomGeneration` does **not** flush drag-out callouts (they keep tracking). Tool-switch mid-drag clears. Pointercancel is not wired on this listener (tool-switch is the discard path).

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

No product change. Live `.callout-preview` already paints during drag; pointerup commits; tool-switch discards; zoom mid-drag keeps tracking.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched.

## Live-proved

Playwright `e2e-callout-live-create.spec.mjs` **2 / 2 (10.7s)** on Vite `http://127.0.0.1:5173`. Focused Node `calloutLiveCreate` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop: Callout drag paints `g.callout-preview` (dashed `5,5` / opacity `0.6` / 120×32 box + leader + solid-triangle ghost; not Rect `g` / not Line) then commit `2270539c-…` **box 0.19608 × 0.04040** (`Arial`; solid). Second live then commit `52269d05-…`. Undo/redo restores A. A isolated.

390: live-then-commit `4332621f-…`; second `00f601a3-…` isolates A.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page | Select drag | live callout preview **0**; invents 0 |
| Tiny click | same-point pointerup | invents 0 (4px gate) |
| Tool-switch | V mid-drag | preview **0**; invents 0 |
| Zoom mid-drag | Ctrl+= while down | does **not** flush; pointerup commits one `78d08747-…` |

### Edge

| Slice | Evidence |
|---|---|
| Isolation | A arrow/box held; earlier A + B survive zoom keep-track |
| Undo / redo | chrome Undo walks keep-alive glyph then create; Redo restores A |
| CREATE-01 | preview dashed `5,5` (not Style `[6,4]`); commit solid |
| Default box | 120×32 page px → normalized **0.19608 × 0.04040** |
| Font | single-name `Arial` |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. Drag-out keep-track (not freehand flush). |
| `file.id` | null throughout |
| hubPreview | Callout **0**; live callout preview **0** |
| 390 | live A + B |

## Official / focused Node

No high-risk file. Official `npm test` not re-run. Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Textbox in-drag `text-creation-preview` is a different path from T-01 auto-edit (if still unreceipted). Leftover **18** stay parked. Goal stays open.

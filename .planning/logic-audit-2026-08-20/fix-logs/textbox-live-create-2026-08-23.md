# Live T-01 leftover: Textbox rubber-band then auto-edit mount — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after T-02 live Callout rubber-band (`52d7a55a` / `e2e-callout-live-create.spec.mjs`). Prior T-01 dedicated create auto-edit (Hello / tight-fit / wrap / Escape / blank / re-edit) + selected bbox resize / canvas `mtr` + Style dash + UL-36 Aa. Distinct from leftover-18, T-01 auto-edit type/commit, selected resize, T-02 `.callout-preview`, S-01/S-02 filled `g.shape-creation-preview`, S-03/S-04 `line.shape-creation-preview`, D-01/D-02 freehand preview, E-01 resize, E-02 rotate, E-03 move, V-01 pan. Did **not** invent flatten / stamp / Forms. Did **not** replay 96 IDs.

Skipped (inspected, not unique leftover chrome):

| Candidate | Why skipped |
|---|---|
| Cloud live create | No dedicated Cloud tool. Style→Cloud is the Rect rubber-band already receipted (S-01). |
| Counter live create | Window pin already receipted (`[data-counter-overlay]` drag-to-place; Size / Start / nubbin / series Delete / Continue). |
| Callout live create | Just receipted. |
| Rotation family | Typed pill + Arrow/Shift+Arrow + free-drag + Shift+45 already dedicated. |
| Line / Arrow selected 8-handle + `mtr` | Not unique (`p1`/`p2`/`midpoint` only). |
| Callout selected bbox / `mtr` | Not live (knee / corners already receipted). |
| Counter bbox / `mtr` | Nubbin-only. |
| Keyboard nudge | Not wired. ArrowLeft/Right are page nav. |
| Insert image / stamp | No create path. |
| Group-rotate 15° | Group `moveOnly` hides `mtr`. |
| Tab reorder / title rename | No real two-PDF-tab path. |
| Text-markup highlight / Theme | Compile-hidden / absent. |
| Create-poly / Extract / measure / Group / Note-Link / Forms / Print panel | Not live / compile-hidden. |

Product path is distinct: in-drag `[data-text-preview]` dashed translucent box (`2px dashed rgba(59, 130, 246, 0.5)` / `rgba(59, 130, 246, 0.05)` fill) after the 10px gate; pointerup hides the band and mounts T-01 auto-edit via `setEditingAnnotation({ isNewText: true, textBoxWidth })`. Click / sub-10px does **not** paint the band (click-to-place overlay is T-01; Escape discard invents 0). Tool-switch mid-drag unmounts the overlay (never commits). `zoomGeneration` does **not** flush the DOM rubber-band (keep-track then pointerup). Committed "A" tight-fits (`Helvetica` **25 × 33**) — wrap-width is T-01, not this leftover.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

No product change. Live `[data-text-preview]` already paints during drag; pointerup mounts auto-edit; tool-switch discards; zoom mid-drag keeps tracking.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched.

## Live-proved

Playwright `e2e-textbox-live-create.spec.mjs` **2 / 2 (12.6s)** on Vite `http://127.0.0.1:5173`. Focused Node `textboxLiveCreate` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop: Text drag paints `[data-text-preview]` (dashed / translucent; not Rect `g` / not Line / not Callout) then pointerup mounts overlay; keep-alive commit `1d16e1fc-…` **25 × 33** (`Helvetica`; T-01 tight-fit of "A"). Second live then commit `ffa3d4d2-…`. Undo/redo restores A. A isolated.

390: live-then-commit `88611aa7-…`; second `693b4e5f-…` isolates A.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty page | Select drag | live text preview **0**; invents 0 |
| Sub-10px | 4×3 px move | rubber-band **0**; click-to-place Escape invents 0 |
| Tool-switch | V mid-drag | preview **0**; overlay **0**; invents 0 |
| Zoom mid-drag | Ctrl+= while down | does **not** flush; pointerup commits one `eca0b6d2-…` |

### Edge

| Slice | Evidence |
|---|---|
| Isolation | A width/height/text held; earlier A + B survive zoom keep-track |
| Undo / redo | chrome Undo walks keep-alive glyph then create; Redo restores A |
| 10px gate | rubber-band paints only after dx/dy > 10; click-to-place is T-01 |
| Font | single-name `Helvetica` |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. DOM overlay keep-track (not freehand flush). |
| `file.id` | null throughout |
| hubPreview | Text **0**; live text preview **0** |
| 390 | live A + B |

## Official / focused Node

No high-risk file. Official `npm test` not re-run. Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Cloud has no dedicated tool. Counter window pin already receipted. Leftover **18** stay parked. Goal stays open.

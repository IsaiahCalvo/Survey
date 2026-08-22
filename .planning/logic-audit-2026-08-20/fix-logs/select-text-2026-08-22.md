# Live V-03 Select text (⇧V) intended+break+edge — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after A-07 local History click-restore. Prior V-03 was window-only (`⇧V` + drag selected `"Text Sear"`). Not leftover-18. Distinct from V-02 annotation select, V-08 Search, P-04 tool-key smoke. History Save version / named Restore stay leftover-18 **X-01** (coordinator lease + real `file.id`). Did **not** replay style catalogs / leftover-18 as a substitute.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite `127.0.0.1:5210` (`npm run dev:ui`) with process auto-login names cleared.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| Window smoke | `⇧V` + drag on `text-search-glyph-lab.pdf` selected `"Text Sear"`. No caret menu, no form INPUT, no leave-mode clear, no 390. |
| P-04 | `⇧V` arms the tool. No glyph selection. |
| 390 first pass | Layer mounted; `elementFromPoint` hit the span; drag / triple-click left `getSelection()` at `rangeCount: 0`. Range API still worked. |

## Product

Surgical. `PDFViewer.jsx` / `SVGAnnotationLayer.jsx` not edited this close.

1. `AppShell.jsx` — Pan/Select `aria-label={label}` so the Selection-mode caret stays findable (caret had stolen the Select button name).
2. `PdfjsViewerContainer.jsx` — live glyphs are `.pdfjsTextLayer.is-interactive`, not the off-screen measurement `.textLayer`. Exempt that layer from mobile `user-select: none !important` / `selectstart` cancel; two-finger pinch still starts when the first contact is a glyph. Lift the scroller lock while `data-text-select` / `:has(.pdfjsTextLayer.is-interactive)`.
3. `PdfjsTextLayer.jsx` — 390 / coarse Chromium fires `selectstart` on the transformed spans but never creates a range. `pointerup` fills the OS selection from the hit span only when native `getSelection()` is empty. Desktop native drag still wins.

CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. `file.id` stays null on `?testPdf=`.

## Live-proved

Playwright `e2e-select-text.spec.mjs` **3 / 3 (9.7s)** on Vite `http://127.0.0.1:5210`. Focused Node `selectText` + leftover18 **15 / 15**.

`?testPdf=text-search-glyph-lab.pdf` + `kal441-form-fields.pdf`. Desktop viewBox `0 0 612 792`. Form viewBox `0 0 480 380`. `file.id` null.

### Intended — **pass**

Desktop: overlay lists Select text / Shift+V; `⇧V` mounts `.pdfjsTextLayer.is-interactive`; SVG `pointer-events: none`; Selection-mode caret lists Select annotations + Select text; drag selected `ABCDEFGHIJKLMNOPQRSTUV`; `V` tears the layer and clears the OS selection; menu Select text re-arms.

390: no Selection-mode caret / no Select text rail control; `⇧V` still mounts the layer; pointer drag selected `The quick brown fox jumps over lazy glyphs.` (`method: drag`).

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Select annotations `V` | default | interactive text layer **0**; OS selection `""` |
| Zoom % INPUT | `Shift+V` | focus held; tool not stolen |
| Form INPUT | `Shift+V` on `kal441-form-fields.pdf` | focus held; widgets stay `data-interactive=true` |
| Pen-armed | `⇧V` | invents 0 ink |
| 390 page INPUT | `Shift+V` | no steal (when Jump-to-page is present) |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Form widgets | text-select → `data-interactive=false`; `V` restores `true` |
| No-glyph form page | 0 spans; invents 0 OS selection |
| Leave-mode | `V` / leave clears `getSelection()` |
| 390 native gap | `selectstart` allowed + `user-select:text`; Chromium still `rangeCount: 0` until pointerup fill-in |
| Zoom | `viewBox="0 0 612 792"` / form `0 0 480 380`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | text layer **0**; Selection mode **0** |

## Official / focused Node

Focused `selectText` + leftover18 **15 / 15**. Official `npm test` not run (8448 not reached / not loosened). Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI checked at close.

## Next leftover

V-09 shortcuts overlay is still `?` then Esc smoke. Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

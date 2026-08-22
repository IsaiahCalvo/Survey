# Live D-03 / D-04 leftover: Eraser type (Partial vs Full stroke) — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after V-07 Edit rename + delete (`a34989ec`). Prior D-03 was window entire-on-topmost (`e2e-kb1-entire-mode.spec.mjs`). Prior D-04 was every Size (`e2e-eraser-size-presets.spec.mjs`). Desktop **Eraser type** dropdown / caret flyout / `E` vs `Shift+E` and 390 **Eraser mode** were never dedicated. Not leftover-18. Did **not** replay the 96 proved IDs. Did **not** invent flatten / stamp / Forms.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

Min-viable in `src/PDFViewer.jsx` bottom-toolbar layout effect:

- AppShell owns the Eraser type dropdown; PDFViewer owns live `eraserMode`.
- The caret flyout updated the tool button immediately, but the published API waited for the post-paint effect, so the dropdown stayed on Full stroke.
- Mirror `eraserMode` with `activeTool` before paint (same identity guard: no-op unless a discriminator actually changed).

No PDFViewer rewrite. No `file.id` stamp. FabricEraserCanvas / SVGAnnotationLayer untouched.

CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched.

## Live-proved

Playwright `e2e-eraser-type.spec.mjs` **2 / 2 (11.6s)** on Vite `http://127.0.0.1:5173`. Focused Node `eraserType` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop catalog `Partial erase` / `Full stroke erase`. Default Partial skips a rect and bites ink. Full stroke deletes rect A and isolates rect B. `E` keeps stored entire; `Shift+E` forces partial. Caret flyout sets Partial. 390 Eraser mode `Partial Erase` / `Full Stroke`; Full Stroke deletes the rect.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Already-entire reselect | Eraser type again | no-op |
| Empty swipe | far corner | invents **0** |
| Pen / Select | arm those tools | Eraser type **0** |
| Zoom % INPUT | `e` while focused | stays Full stroke |
| 390 Pen | arm Pen | Eraser mode **0** |

### Edge

| Slice | Evidence |
|---|---|
| Undo | restores the full-stroke delete of rect A |
| Pen-armed | invents **0** marks |
| Hollow rect | entire swipe must cross the stroke (transparent fill) |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Eraser type **0**; Draw **0** |
| 390 | Partial skip + Full Stroke delete; Pen hide |

## Official / focused Node

Official `npm test` after the PDFViewer layout-effect edit: `toolbarWidthDraft` now matches the `eraserMode` layout publish. Suite then fail-stopped on the standing `partialEraserComplexity` 500-crossing-cuts budget (`11964.55 MiB` > **8448**). Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

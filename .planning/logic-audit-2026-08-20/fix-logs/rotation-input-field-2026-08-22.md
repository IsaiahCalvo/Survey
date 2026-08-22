# Live E-02 leftover: RotationInputField type / blur / wrap / Escape — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after C-06 Match Fill (`ba6e1a9d`). Prior E-02 was handle Shift-drag +45° plus one ArrowUp / Shift+Arrow sample (`e2e-unblocked-followup-2`). Counter nubbin / survey-marker `mtr` already dedicated. The typed degree pill never had type / blur / wrap / Escape / Line omit. Distinct from leftover-18, UL-06 Zoom %, UL-07 page number, color catalogs. P1-32 hold-arrow coalescing **not** replayed. Did **not** invent flatten / stamp / Forms.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

Min-viable in `src/components/RotationInputField.jsx`:

- Digit filter used to `preventDefault` any single-char `e.key` that is not `0-9`.
- Ctrl+A / Cmd+A is `e.key === 'a'` (not a modifier-only multi-char key), so select-all never ran and Backspace left a leftover digit.
- Both the window-capture guard and the React `onKeyDown` now let `ctrlKey` / `metaKey` / `altKey` chords through.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / FabricEraserCanvas / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched.

## Live-proved

Playwright `e2e-rotation-input-field.spec.mjs` **2 / 2 (10.3s)** on Vite `http://127.0.0.1:5173`. Focused Node `rotationInputField` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop type **90** + Enter commits `angle=90`. Click-away blur commits **180**. 390 type **90** + Enter.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Wrap | 360 / 405 | **0** / **45** |
| Empty Enter | Ctrl+A + Backspace | restores **45** |
| Letters | `abc` | never enter; restore **45** |
| Minus | `-` | blocked; restore **45** |
| Escape | typed 270 | restore **45**, no commit |
| Line single-click | catalog | mtr / pill **0** |
| Empty Select / Pen | chrome | pill **0**; first angle held |

### Edge

| Slice | Evidence |
|---|---|
| Isolation | second rect 90 does not rewrite first 45 |
| Undo | drops second-rect 90; first held 45 |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Rotation angle **0**; Draw **0** |
| 390 | type 90; Escape no-commit 270; 360→0 |

## Official / focused Node

No high-risk file. Official `npm test` not re-run. Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

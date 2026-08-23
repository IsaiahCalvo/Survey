# Live E-02 leftover: Shift+45° `mtr` snap intended+break+edge — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after V-04 Ctrl+wheel cursor zoom (`76cfd2b7` / `e2e-ctrl-wheel-zoom.spec.mjs`). Prior E-02 dedicated free-drag 90°/180° and the typed degree pill. Followup-2 only sampled Shift+44→45 / far 23°. Distinct from leftover-18, E-01 resize, E-03 move, V-01 pan, V-04 zoom, pill Arrow ±1 / Shift+Arrow, counter nubbin, survey-marker `mtr`. Group-rotate 15° is not live (group `moveOnly` hides `mtr`). Did **not** invent flatten / stamp / Forms. Did **not** replay 96 IDs.

Skipped (inspected, not unique leftover chrome):

| Candidate | Why skipped |
|---|---|
| Tab reorder / document title rename | No real two-PDF-tab path. `?testPdf=` opens one File. HubPreview `handleOpenDocument` does `location.assign`. Dashboard Upload stamps `file.id`. |
| Text-markup highlight after Select text | Compile-hidden. `showTextMarkupHighlightMenu = false`. |
| Theme / appearance | Absent. |
| Line / Arrow selected 8-handle + `mtr` | Not unique (`p1`/`p2`/`midpoint` only). |
| Callout selected bbox / `mtr` | Not live. |
| Counter bbox / `mtr` | Nubbin-only. |
| Keyboard nudge | Not wired. ArrowLeft/Right are page nav. |
| Insert image / stamp | No create path. |
| Group-rotate 15° Shift snap | Group `moveOnly` hides `mtr`. |

Product path is distinct: `useSVGInteraction` rotate mode calls `snapAngleToNearest45(newAngle, 3)` only while `e.shiftKey`. Soft band: 44/47→45, 89→90; 23/41 stay. `% 360` wraps 358→0.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

No product change. Harness only.

No high-risk file. No `file.id` stamp. PDFViewer / SVGAnnotationLayer / viewBox / `zoomGeneration` / canvas sizing / Fabric `fontFamily` / CORS `*` untouched.

## Live-proved

Playwright `e2e-rotation-shift-snap.spec.mjs` **2 / 2 (12.8s)** on Vite `http://127.0.0.1:5173`. Focused Node `rotationShiftSnap` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop 1400×900: A `f687da5d-…` / B `c81f7055-…`. Shift+44 → **45.00°**; width/height/left/top held; B isolated. Ctrl+Z restores 0; Ctrl+Shift+Z redo; second undo. Shift+89 → **90.00°**; undo.

390: Shift+44 → **45.00°**; width held; B isolated; undo.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Bare (no Shift) 44° | `mtr` drag | **44.00°** (not 45) |
| Shift+23° | far from increment | **23.00°** (not 0/45/90) |
| Shift micro-drag | 1×1 px on `mtr` | angle stays 0 |
| Group A+B | Shift-click / 390 marquee | `moveOnly` hides `mtr` |
| Line single-click | endpoints | `mtr` **0** |
| Empty page | Select drag | `mtr` **0**; invents 0 |
| Pen empty-page | freehand | invents ink; A angle held |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Isolation | B angle/left held across A 45° |
| Undo / redo | stack restores 0 / 45 |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Draw **0**; `mtr` **0** |
| 390 | bare **43.999°**; Shift snap **45**; group hide |

## Official / focused Node

Focused `rotationShiftSnap` + leftover18 **15 / 15**. Official `npm test` not run (8448 not reached / not loosened). Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

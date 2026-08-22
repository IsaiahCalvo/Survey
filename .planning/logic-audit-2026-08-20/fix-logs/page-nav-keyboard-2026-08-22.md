# Live V-05 page-nav keyboard intended+break+edge — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after E-05 undo/redo stack. Prior V-05 was overlay + window **smoke** (1-page ignores next; multi-page Home/End jump). Distinct from thumbnail left-click (V-06), rail / mobile page input (UL-07), and Fit height. Not leftover-18. Did **not** replay those proofs as a substitute.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright reused Vite `localhost:5173` (`npm run dev:ui` already up) with process auto-login names absent.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| Overlay catalog | Lists ←/→ Home/End. No live first/last clamp, INPUT steal, or 390. |
| V-05 **pass** (window) | 1-page ignores next; multi-page Home/End jump. ←/→ intended+break+edge unproven. |
| Thumbnail / mobile page input / Fit height | Different controls. Not this chord family. |

## Product

No product bug. Capture-phase-adjacent window `keydown` in `PDFViewer.jsx`: Home → `goToPage(1)`; End → `goToPage(numPages || 1)`; ← → `goToPreviousPage`; → → `goToNextPage`. `isFormField` (INPUT / TEXTAREA / contentEditable) skips the chords. `coercePageNumber` rejects `< 1` and `> numPages` (first ← / Home no-op; last → / End clamp). Overlay lists the mapping. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. High-risk files not edited.

## Live-proved

Playwright `e2e-page-nav-keyboard.spec.mjs` **2 / 2 (10.0s)** on Vite `http://localhost:5173`. Focused Node `pageNavKeyboard` + leftover18 **15 / 15**.

`?testPdf=spike-120-pages.pdf` last **120**. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop: **ArrowRight** 1→2; **ArrowLeft** 2→1; **End** → 120; **Home** → 1. Overlay lists Previous/Next + First/Last.

390: same window listener. ArrowRight 1→2; ArrowLeft 2→1; End → 120; Home → 1.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| First page | ← / Home | stay 1 |
| Last page | → / End | stay 120 |
| Page INPUT | ← / → / Home / End while focused | stay 2 (caret only) |
| Zoom % INPUT | ← / Home / End while focused | stay 2 |
| 1-page PDF | ← / → / Home / End | stay 1 |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Isolation | Page-1 rect survived End/Home; nav invented 0 on page 2 |
| Pen-armed | ArrowRight still moved; invents 0 |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Draw **0**; annotation layer **0** |
| 390 | same chords + last-page clamp + page INPUT no-steal; same viewBox |

## Official / focused Node

Focused `pageNavKeyboard` + leftover18 **15 / 15**. Official `npm test` not run (8448 not reached / not loosened). Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

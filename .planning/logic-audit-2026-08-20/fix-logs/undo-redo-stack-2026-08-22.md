# Live E-05 Undo / Redo stack intended+break+edge — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after UL-27–29 + E-04 Cut / Copy / Paste / Delete. Unique leftover **keyboard chord family** after the 2026-08-21 sample matrix (tool letters / Delete / z-order / Ctrl+F / Esc). Prior E-05 was window smoke (toolbar Undo×2 then Redo×2 restored a count). Style / spaces / survey specs only used Undo as an edge. Distinct from P1-45 bookmark undo, keyboard Delete, and leftover-18. Not a style catalog. Not a clipboard hunt.

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
| Keyboard matrix **pass** | Tool letters / Delete / Ctrl+]/[ / Ctrl+F / Esc. **Ctrl+Z / Shift+Z / Y unused.** |
| E-05 **pass** (window cross-tool) | Pen then rect; toolbar Undo×2 then Redo×2 restored the **count**. Empty stack, INPUT block, redo-clear, Ctrl+Y unproven. |
| Style / spaces / survey | Undo used as an **edge** only (isolation / checkpoint). Never a dedicated stack. |
| Overlay catalog | Lists Pen / Esc / Search. **No Undo / Redo rows** (chords are live but undocumented). |

Select-all / multi-select was **not** this pass: V-02 marquee / Shift-click already dedicated; annotation Ctrl+A is not wired (`A` arms Arrow).

## Product

No product bug. Capture-phase listener in `PDFViewer.jsx` uses `isUndoKeyEvent` / `isRedoKeyEvent` / `isUndoRedoBlocked`. New create clears the redo stack (`setRedoHistory([])`). Overlay omits Undo/Redo. CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. High-risk files not edited.

## Live-proved

Playwright `e2e-undo-redo-stack.spec.mjs` **2 / 2 (6.7s)** on Vite `http://localhost:5173`. Focused Node `undoRedoStack` + leftover18 **15 / 15**.

`viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop: create A then B. **Ctrl+Z** drops B, A stays. **Ctrl+Shift+Z** restores B. **Ctrl+Y** also restores B. Toolbar Undo / Redo stay in sync. Two-step Ctrl+Z ×2 then Ctrl+Shift+Z + Ctrl+Y restores create order A then B. Undo enables after first create; Redo enables after undo.

390: toolbar Undo drops B; **Ctrl+Y** restores B.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty stack | Ctrl+Z / Shift+Z / Y / Alt+Z | invents 0; imported natives held |
| Disabled toolbar | force-click Undo / Redo | invents 0 |
| Zoom % INPUT | Ctrl+Z while focused | A + B stay (`isUndoRedoBlocked`) |
| Redo clear | undo B, create C, Shift+Z / Y | B stays gone; C held |
| Overlay `?` | catalog | Undo / Redo **0** |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Isolation | A held across undo of B; imported ids survive |
| Select empty | invents 0 |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Draw **0**; annotation layer **0** |
| 390 | toolbar Undo + Ctrl+Y + redo-clear; same viewBox |

## Official / focused Node

Focused `undoRedoStack` + leftover18 **15 / 15**. Official `npm test` not run (8448 not reached / not loosened). Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

V-05 page-nav keyboard (← / → / Home / End) is still overlay + window smoke — not leftover-18. Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

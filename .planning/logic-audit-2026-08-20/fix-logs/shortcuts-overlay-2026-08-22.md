# Live V-09 shortcuts overlay intended+break+edge — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after V-03 Select text. Prior V-09 was `?` then Esc smoke (keyboard matrix + window). Not leftover-18. Distinct from P-04 tool-key arm, V-05/V-08/E-05 catalog samples. History Save version / named Restore stay leftover-18 **X-01** (coordinator lease + real `file.id`). Did **not** replay style catalogs / leftover-18 as a substitute.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite `127.0.0.1:5220` (`npm run dev:ui`) with process auto-login names cleared.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| Window smoke | press `?` then Esc. No catalog, no click-outside, no Close, no reopen, no second-`?` toggle, no INPUT, no 390. |
| Keyboard matrix | `?` lists Pen / Select / Search / Esc; no Delete / Duplicate / z-order. Esc closes. No dismiss family, no INPUT steal, no 390. |
| E-05 / V-03 / V-05 samples | Overlay used as a catalog check for those slices. Not a dedicated overlay proof. |

## Product

No min-viable product diff. No high-risk files edited.

Documented product (not a bug that blocked the proof):

- `useKeyPress('?')` has **no INPUT / TEXTAREA / contentEditable guard**. `?` while zoom % or Search is focused still opens the overlay (steal). Other chords (page-nav, undo, tool keys) do guard.
- AppShell mounts the overlay only on the home tab (`!isViewerVisible`). Production viewer hides it. `?testPdf=` remounts it via `DevTestRoute`.
- `?hubPreview=1` is a standalone `HubPreview` mount (no AppShell). Overlay **0**.
- Catalog is the hardcoded list. Undo / Redo / Delete / Duplicate / z-order / Fit height / Fit width / F3 are live elsewhere and omitted here. CSS `text-transform: uppercase` shows NAVIGATION / ACTIONS / TOOLS / INTERFACE.

CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched. `file.id` stays null on `?testPdf=`.

## Live-proved

Playwright `e2e-shortcuts-overlay.spec.mjs` **2 / 2 (6.4s)** on Vite `http://127.0.0.1:5220`. Focused Node `shortcutsOverlay` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop: `?` opens `[data-keyboard-shortcuts-modal]`; heading Keyboard shortcuts; Close autofocused; **21** listed chords (page nav, zoom, Fit page, Open, Search, V / ⇧V, P H E T Q L A C, B, ?, Esc). Esc / click-outside (backdrop 8,8) / Close dismiss. Reopen after each. Second `?` toggles closed.

390: overlay exists; same catalog; Esc / second `?` / click-outside / Close.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Second `?` | overlay open | toggles closed |
| Zoom % INPUT | `?` | overlay **opens** (documented steal; no `useKeyPress` guard) |
| Search INPUT | `?` after Ctrl+F | overlay **opens** (same steal) |
| Catalog | omitted chords | Undo / Redo / Delete / Duplicate / Bring forward / Fit height / Fit width / F3 / Select all **0** |
| 390 page INPUT | `?` when Jump-to-page present | overlay **opens** (same steal) |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Isolation | Overlay invents **0** user marks. hubPreview Draw **0**; annotation layer **0**; overlay **0** (standalone HubPreview). |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| 390 | overlay exists; same dismiss family + catalog |

## Official / focused Node

Focused `shortcutsOverlay` + leftover18 **15 / 15**. Official `npm test` not run (8448 not reached / not loosened). Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

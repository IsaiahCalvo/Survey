# Live V-09 shortcuts overlay INPUT guard — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after the V-09 open/dismiss/catalog proof (`5eac3988`). That pass documented a product steal: `useKeyPress('?')` had **no INPUT guard**, so `?` in zoom % / Search opened the overlay. This pass is the min-viable fix + re-proof. Not leftover-18. Did **not** replay the 96 proved IDs. Did **not** invent Undo/Redo catalog rows.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite `127.0.0.1:5233` (`npm run dev:ui`) with process auto-login names cleared.

## Product

Min-viable in `src/utils/hooks.js` (the only `useKeyPress` consumer is the overlay):

- New `isTypingTarget` — `INPUT` / `TEXTAREA` / `isContentEditable` / `contentEditable` `true` | `plaintext-only`.
- `useKeyPress(..., { ignoreWhenTyping: true })` default: matching key while typing returns without `preventDefault` or callback. The field keeps the key.
- Overlay comment documents the contract. No PDFViewer rewrite. No `file.id` stamp.

CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched.

## Live-proved

Playwright `e2e-shortcuts-overlay.spec.mjs` **2 / 2 (6.6s)** on Vite `http://127.0.0.1:5233`. Focused Node `shortcutsOverlay` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop: `?` opens `[data-keyboard-shortcuts-modal]`; heading Keyboard shortcuts; Close autofocused; **21** listed chords. Esc / click-outside (backdrop 8,8) / Close dismiss. Reopen after each. Second `?` toggles closed.

390: overlay exists; same catalog; Esc / second `?` / click-outside / Close.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Second `?` | overlay open | toggles closed |
| Zoom % INPUT | `?` | overlay **0**; field stays focused; value unchanged (digits-only drops the glyph) |
| Search INPUT | `?` after Ctrl+F | overlay **0**; field stays focused; query keeps `?` |
| Catalog | omitted chords | Undo / Redo / Delete / Duplicate / Bring forward / Fit height / Fit width / F3 / Select all **0** |
| 390 page INPUT | `?` when Jump-to-page present | overlay **0**; field stays focused; value unchanged (digits-only) |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| Isolation | Overlay invents **0** user marks. hubPreview Draw **0**; annotation layer **0**; overlay **0** (standalone HubPreview). |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| 390 | overlay exists; same dismiss family + catalog + page INPUT no-steal |

## Official / focused Node

Focused `shortcutsOverlay` + leftover18 **15 / 15**. Official `npm test` not run (8448 not reached / not loosened). Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

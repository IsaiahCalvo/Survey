# Live V-07 New bookmark group / Create group / Add to group — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after the UL-36 Edit text Aa proof (`fefb113d`). Prior V-07 was item create + dnd-kit; 390 was up/down. Desktop **New bookmark group** / Create group / Add bookmark to group were never dedicated. Not leftover-18. Did **not** replay the 96 proved IDs. Did **not** invent flatten / stamp / Forms.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

Min-viable in `src/sidebar/BookmarksPanel.jsx`:

- `handleSaveBookmarkGroup` and `handleSaveAddToGroup` now call `expandFolderOnly` after writing children (same helper `handleAddChildBookmark` already used).
- Before: a just-created folder is not in `expandedFolders`, so `collapsed` hid every child. Create group looked like it dropped the bookmarks.
- No PDFViewer rewrite. No `file.id` stamp.

CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched.

## Live-proved

Playwright `e2e-bookmark-group.spec.mjs` **2 / 2 (10.0s)** on Vite `http://127.0.0.1:5173`. Focused Node `bookmarkGroup` + leftover18 **15 / 15**.

`?testPdf=spike-120-pages.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop: Add bookmark → New bookmark group → named group + child page 3 → Create group expands so the child is visible. Child click jumps to page 3. Add bookmark to group mints `New bookmark`. Existing Solo joins a new group (`${name} Page N` picker). Collapse group chevron named.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty group name | Create group | toast; no folder |
| Named group, 0 children | Create group | toast; no folder |
| Nameless child | Create group | toast; no folder |
| Cancel | click | invents **0** |
| Pen-armed | Create group | group appears; user marks **0** |
| 390 | New bookmark group / Create group / Add bookmark to group | **0** |

### Edge

| Slice | Evidence |
|---|---|
| Isolation | Second group does not rewrite the first |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | New bookmark group **0**; Create group **0**; Add bookmark to group **0** |
| 390 | group chrome absent; `file.id` null |

## Official / focused Node

Official `npm test` not run (8448 not reached / not loosened). Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

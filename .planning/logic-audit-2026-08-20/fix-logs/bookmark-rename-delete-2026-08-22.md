# Live V-07 Edit rename + delete (group + leaf) — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named leftover after the V-07 New bookmark group proof (`abdfc18c`). Prior V-07 was item create + dnd-kit; desktop group create/add; 390 up/down. Desktop **Edit** rename + named Delete (group + leaf) and 390 **group delete** were never dedicated. P1-45 unit + adversarial covered unlabeled desktop group delete / undo only. Not leftover-18. Did **not** replay the 96 proved IDs. Did **not** invent flatten / stamp / Forms.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite via `debug/playwright.config.mjs` (`npm run dev:ui`) with process auto-login names cleared.

## Product

Min-viable in `src/sidebar/bookmarkEditUtils.js` + `src/sidebar/BookmarksPanel.jsx`:

- Group rename clash is type-aware (`bookmark group` vs `bookmark`).
- Desktop Edit name / page / Delete controls are named (`Rename group`, `Rename bookmark`, `Bookmark page`, `Delete group` / `Delete bookmark`). Mobile folder trash matches.
- Escape / Enter no longer blur-commit stale React state (Escape was persisting the typed-over name).

No PDFViewer rewrite. No `file.id` stamp.

CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched.

## Live-proved

Playwright `e2e-bookmark-rename-delete.spec.mjs` **2 / 2 (16.1s)** on Vite `http://127.0.0.1:5173`. Focused Node `bookmarkRenameDelete` + leftover18 **15 / 15**.

`?testPdf=spike-120-pages.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

### Intended — **pass**

Desktop Edit: rename group + leaf + page (3 → 7 → clamp 120). Leaf delete confirm. Nested group delete removes the child. Undo restores the scoped `bookmark:delete` snapshot.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Empty group name | Enter | silent revert; no persist |
| Escape | typed-over name | restores saved name (does not persist) |
| Same-name | Enter | no-op |
| Group rename clash | other group name | type-aware toast; field reverts |
| Leaf rename clash | other leaf name | toast; field reverts |
| Page `0` | blur | restores saved page |
| Cancel confirm | dismiss | invents **0** deletes |
| Pen-armed | Delete group | group gone; user marks **0** |

### Edge

| Slice | Evidence |
|---|---|
| Same-type only | leaf may share a group name |
| Empty group | confirm is `Delete group "…" ?` (no nested count) |
| Isolation | deleting one group leaves the other |
| Undo | toolbar Undo restores group + child |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| hubPreview | Edit / Rename / Delete **0** |
| 390 | folder rename **0**; group delete live (cancel + accept); isolation |

## Official / focused Node

Official `npm test` not run (8448 not reached / not loosened). Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

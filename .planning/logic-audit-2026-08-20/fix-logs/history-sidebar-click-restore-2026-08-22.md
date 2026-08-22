# Live A-07 local History click-restore / collapse intended+break+edge — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.

Named next leftover after V-02 select / multi-select. Prior A-07 was W4-03 empty/after-edit smoke + W5-01 jump page-number + delete-restore in the bundled wave spec. Named **Save version / Restore** stay leftover-18 **X-01** (coordinator lease + real `file.id`). Distinct from E-05 undo/redo. Did **not** replay V-02 / style catalogs / leftover-18 as a substitute.

## X-01 glance (names only)

| Name | Process env | `.env.local` | Lease + `file.id` |
|---|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | absent | PRESENT | no |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | absent | PRESENT | no |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | PRESENT | no |

Did **not** invent a lease, print values, or write another host-bundle. Playwright spawned Vite `127.0.0.1:5198` (`npm run dev:ui`) with process auto-login names cleared.

## Why this was incomplete

| Prior claim | What was actually asserted |
|---|---|
| W4-03 | History button; empty copy; pen stroke listed two local events; 0 Supabase. No click-spotlight, no collapse teardown, no filter catalog. |
| W5-01 jump | Draw on page 3, go to 1, click event → page 3. No spotlight, no “not a snapshot”, no collapse. |
| W5-01 delete-restore | Backspace → Restore → id returns. No second-Restore no-dup, no 390 Close. |
| Named restore | Cloud `file.id` — leftover-18 X-01. Not this slice. |

## Product

Two min-viable chrome fixes. High-risk files not edited.

1. Left-rail chevron was unlabeled. Now `aria-label="Collapse sidebar"` / `"Expand sidebar"` (`type="button"`). Collapse while History is open still switches the tab to Pages so `isActive` goes false and the spotlight tears down.
2. Checkpoint activity rows often stamp `page_number` without `annotation_id` / `previewAnnotation`, so click jumped but the glow never painted (`Showing page N for this history item`). `RevisionsPanel` now also looks up `data-anno-id` and, when the page has exactly one current user mark, spotlights that live SVG node.

Filter chrome is **absent** (not invented). Activity click is jump + spotlight + context, not `restoreRevision`. Create-events omit Restore. Second Restore on a bulk fabric delete row does not duplicate the id (status may stay `Restored deleted item`). CORS `*` / `zoomGeneration` / SVG viewBox / canvas sizing / Fabric `fontFamily` untouched.

## Live-proved

Playwright `e2e-history-sidebar-click-restore.spec.mjs` **2 / 2 (12.4s)** on Vite `http://127.0.0.1:5198`. Focused Node `historySidebarClickRestore` + leftover18 **15 / 15**.

`?testPdf=spike-120-pages.pdf` + `clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null. Cloud History/revision REST **0**.

### Intended — **pass**

Desktop: empty copy; click page-3 row jumps + `#document-history-spotlight-svg` + “not a full-document snapshot” (A+B held); Collapse sidebar tears spotlight; Expand + click page-1; Restore returns deleted B.

390: click-spotlight; Close version history teardown.

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| Filter | Search history / Filter activity | **0** (not invented) |
| Save version | `kal48-save-revision` | **0**; owner footer |
| Create-event | Restore | **0** |
| Second Restore | already-present B | no dup |
| Pen-armed | click History row | invents 0 |
| Zoom % INPUT | B | no collapse steal |

### Edge — **pass**

| Slice | Evidence |
|---|---|
| B key | same teardown as Collapse |
| Enter on row | stays on page + spotlight |
| Isolation | A held across B delete/restore |
| Zoom | `viewBox="0 0 612 792"`. No JS zoom. |
| `file.id` | null throughout |
| Cloud | 0 supabase.co / document_history / document_revisions / kal48 RPC |
| hubPreview | revisions panel **0** |
| 390 | Close version history |

## Official / focused Node

Focused `historySidebarClickRestore` + leftover18 **15 / 15**. Official `npm test` not run (8448 not reached / not loosened). Cap **8448** / **75/250** not loosened. Did **not** loosen leftover-18 or invent a lease. `graphify` CLI absent — skipped.

## Next leftover

History remaining chrome that still needs a real `file.id` (Save version / named Restore) is leftover-18 **X-01**. Leftover-18 first named: **X-01** (names in `.env.local`; still need coordinator lease + real `file.id`; do not invent). Leftover **18** stay parked. Goal stays open.

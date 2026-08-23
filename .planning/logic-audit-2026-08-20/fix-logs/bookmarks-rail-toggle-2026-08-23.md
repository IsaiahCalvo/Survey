# Bookmarks rail toggle — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `7fbd7bb7` Search text rail toggle.  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Unique leftover after Search text rail toggle (`7fbd7bb7` / `31baa5a0`). Last hunt counted collapsed-rail Bookmarks empty chrome and only used it as Search contrast. V-07 is jump/rename/group; dest-XYZ stays stubbed (page-number jump only). This leftover is the collapsed 48px left-rail **Bookmarks** tab (48 → 272 empty panel: No bookmarks yet + Add bookmark) + 390 Open pages, search, and bookmarks → Bookmarks. Distinct from leftover-18 / X-01 / remapped-after-CW / dismiss-family / Search rail toggle / Spaces rail toggle / Expand Survey / left-rail History Collapse sidebar / V-07 jump-rename-group / dest-XYZ / V-06 thumbnails / Home / Close tab / tool-key / toolbar arm.

**Product:** desktop Add bookmark now has `type="button"` + `aria-label="Add bookmark"` (mobile already had both). Isolated 8448 standing. Cap **8448** / 75/250 not loosened.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** invent dest-XYZ remapping or survey Y/N/N-A. Did **not** replay Search / Spaces / V-07 jump-rename-group / bookmark page-number jump.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| X-01 / leftover-18 hosts | **Parked.** `.env.local` names present; process env absent; no `scripts/test-account-lease.mjs` token; no real `file.id`. |
| Dismiss-family / Zoom ± / Home / tool-key / rail Prev-Next / Expand Survey / Spaces / Search rail | **Exhausted / do not replay.** |
| Left-rail Collapse/Expand sidebar | **Already dedicated** on History. Contrast-only this leftover (opens Pages, not Bookmarks). |
| V-07 jump / rename / group / dest-XYZ | Dedicated / stubbed. Not the rail tab switcher. |
| **Bookmarks rail toggle** | **This pass.** Compile-visible on width-48 left rail; never intended+break+edge as the empty-panel switcher. |

## Live-proved

Playwright `e2e-bookmarks-rail-toggle.spec.mjs` **2 / 2** + hunt `e2e-after-search-rail-independent-hunt.spec.mjs` **1 / 1** on Playwright Vite `http://127.0.0.1:5173` (**3 / 3 (16.0s)**). Focused Node `bookmarksRailToggle` + leftover18 **16 / 16**.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `?testPdf=clickable-link-test.pdf` 1400×900. Collapse **0**; Bookmarks live; host **48** / panel **48** → Expand sidebar contrast shows `alt=Page 1` and hides empty chrome; Bookmarks click → No bookmarks yet + Add bookmark; host **48** / panel **272**; New bookmark group / name field **0** (create menu closed); Y/N **0**. Collapse sidebar restores Bookmarks icon. viewBox **`0 0 612 792`**. `file.id` null. |
| Break desktop | Escape / Space do not collapse. Already-open Bookmarks re-click stays panel **272**. Double-click Bookmarks stays expanded and invents **0** create menu. hubPreview viewer empty chrome / Add bookmark **0**. Hidden tools **0**. |
| Edge desktop | Page-1 rect `a5e4ad28-…` survives; Pen-armed Bookmarks invents **0**; 120-page Bookmarks stays page **1** (no dest-XYZ jump). Overlay lists B Toggle sidebar, not a Bookmarks-tab chord. |
| Edge 390 | Open pages, search, and bookmarks defaults to Pages (empty chrome hidden); Bookmarks tab shows No bookmarks yet + Add bookmark; closer hides chrome. viewBox **`0 0 612 792`**. |
| Hunt | Pages tab-as-switcher from Bookmarks shows `alt=Page 1`, hides empty chrome, page stays **1** (no thumbnail jump); Version history live (History-dedicated); Curve / Stamp / Cloud **0**; hub viewer Add bookmark **0**; hub More **6** (already dedicated); 390 hub Bookmarks tab live, defaults to Pages; kal441 Forms create **0**. |

Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. High-risk files not edited; official `npm test` not required this pass. Cap **8448** / 75/250 not loosened. Isolated 8448 standing. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

Hunt after this leftover still names compile-visible **Pages tab-as-switcher** (from Bookmarks → Pages without thumbnail jump; distinct from Expand sidebar→Pages on a fresh pages default, and from V-06 thumbnail jump). Goal stays open.

## Files

- `src/sidebar/BookmarksPanel.jsx`
- `debug/scenarios/e2e-bookmarks-rail-toggle.spec.mjs`
- `debug/scenarios/e2e-after-search-rail-independent-hunt.spec.mjs`
- `tests/bookmarksRailToggle.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

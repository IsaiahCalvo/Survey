# Search text rail toggle — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `05841b84` Spaces rail toggle receipt.  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Unique leftover after Spaces rail toggle (`05841b84` / `cc8d23de`). Last hunt counted collapsed-rail Pages / Search text / Bookmarks and only used Search as Match-case contrast. V-08 Next/Previous/result-row and Match case / Whole word **0** stay dedicated/hidden. This leftover is the collapsed 48px left-rail **Search text** tab (48 → 272 Search panel + focus) + 390 Open pages, search, and bookmarks → Search. Distinct from leftover-18 / X-01 / remapped-after-CW / dismiss-family / Spaces rail toggle / Expand Survey / left-rail History Collapse sidebar / V-06 thumbnails / bookmark page-number jump / Home / Close tab / tool-key / toolbar arm.

**Product:** collapsed + expanded tab clicks now call `openPanel(tab.id)` so Search increments `searchFocusRequestToken` (was `setIsCollapsed(false)` + `setActiveTab` / `setActiveTab` only — Ctrl+F already focused via `openSearchPanel`). Isolated 8448 standing. Cap **8448** / 75/250 not loosened.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** invent survey Y/N/N-A or leftover-18 hosts. Did **not** replay Spaces toggle / Expand Survey / V-08 find.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| X-01 / leftover-18 hosts | **Parked.** `.env.local` names present; process env absent; no `scripts/test-account-lease.mjs` token; no real `file.id`. |
| Dismiss-family / Zoom ± / Home / tool-key / rail Prev-Next / Expand Survey / Spaces rail | **Exhausted / do not replay.** |
| Left-rail Collapse/Expand sidebar | **Already dedicated** on History. Contrast-only this leftover (opens Pages, not Search). |
| V-08 Search Next/Previous / Match case | Dedicated / compile-hidden **0**. Not this leftover. |
| V-06 thumbnail jump / bookmark page-number | Dedicated. Not the rail tab switcher. |
| **Search text rail toggle** | **This pass.** Compile-visible on width-48 left rail; never intended+break+edge as the panel switcher + focus. |

## Live-proved

Playwright `e2e-search-rail-toggle.spec.mjs` **2 / 2** + hunt `e2e-after-spaces-rail-independent-hunt.spec.mjs` **1 / 1** on Playwright Vite `http://localhost:5173` (**3 / 3 (16.4s)**). Focused Node `searchRailToggle` + leftover18 **16 / 16**.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `?testPdf=clickable-link-test.pdf` 1400×900. Collapse **0**; Search text live; host **48** / panel **48** → Expand sidebar contrast shows `alt=Page 1` and hides the field; Search click → field visible + focused; host **48** / panel **272**; Match case / Whole word / Next / Previous **0**; Y/N **0**. Collapse sidebar restores Search text icon. viewBox **`0 0 612 792`**. `file.id` null. |
| Break desktop | Escape / Space do not collapse. Already-open Search re-click stays panel **272** and refocuses. Double-click Search stays expanded and invents **0** results. hubPreview viewer Search field / Search text rail **0**. Hidden tools **0**. |
| Edge desktop | Page-1 rect `5df07496-…` survives; Pen-armed Search invents **0**; 120-page Search stays page **1**. Overlay lists Ctrl+F Search text, not a Search-tab chord. |
| Edge 390 | Open pages, search, and bookmarks defaults to Pages (field hidden); Search tab focuses `Search text`; closer hides field. viewBox **`0 0 612 792`**. |
| Hunt | Bookmarks empty chrome live (No bookmarks yet + Add bookmark; field hidden); Pages tab shows `alt=Page 1` without jumping; Curve / Stamp **0**; hub viewer Search **0**; 390 Open pages, search, and bookmarks live; kal441 Forms create **0**. |

Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. High-risk files not edited; official `npm test` not required this pass. Cap **8448** / 75/250 not loosened. Isolated 8448 standing. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

Hunt after this leftover still names compile-visible collapsed-rail **Bookmarks** (empty panel) and **Pages** tab-as-switcher (distinct from V-06 thumbnail jump). Those stay unproved as dedicated intended+break+edge slices. Goal stays open.

## Files

- `src/PDFSidebar.jsx`
- `debug/scenarios/e2e-search-rail-toggle.spec.mjs`
- `debug/scenarios/e2e-after-spaces-rail-independent-hunt.spec.mjs`
- `tests/searchRailToggle.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

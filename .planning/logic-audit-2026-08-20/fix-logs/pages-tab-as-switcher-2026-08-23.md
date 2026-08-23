# Pages tab-as-switcher — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `daa3f031` Bookmarks rail toggle.  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Unique leftover after Bookmarks rail toggle (`daa3f031` / `b2a8ad42`). Last hunt counted Bookmarks → Pages (`alt=Page 1`, page stays 1, no thumbnail jump) and only used Expand sidebar→Pages as contrast. V-06 is thumbnail left-click jump. This leftover is the expanded left-rail **Pages tab-as-switcher** (Bookmarks / Search / Spaces → Pages without navigating) + 390 hub Bookmarks → Pages. Distinct from leftover-18 / X-01 / remapped-after-CW / dismiss-family / Bookmarks rail toggle / Search rail toggle / Spaces rail toggle / Expand Survey / left-rail History Expand/Collapse sidebar / Expand sidebar→Pages / V-06 thumbnails / V-07 jump-rename-group / dest-XYZ / Home / Close tab / tool-key / toolbar arm.

**Product:** no edit. Tab clicks already call `openPanel(tab.id)` and do not call `onNavigateToPage`. Isolated 8448 standing. Cap **8448** / 75/250 not loosened.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** invent dest-XYZ remapping or survey Y/N/N-A. Did **not** replay Bookmarks / Search / Spaces rail, V-07, V-06 thumbnails, or Expand sidebar as leftover.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| X-01 / leftover-18 hosts | **Parked.** `.env.local` names present; process env absent; no `scripts/test-account-lease.mjs` token; no real `file.id`. |
| Dismiss-family / Zoom ± / Home / tool-key / rail Prev-Next / Expand Survey / Spaces / Search / Bookmarks rail | **Exhausted / do not replay.** |
| Left-rail Collapse/Expand sidebar | **Already dedicated** on History. Contrast-only this leftover (opens Pages from collapsed default). |
| V-06 thumbnail jump / V-07 jump-rename-group / dest-XYZ | Dedicated / stubbed. Not the tab switcher. |
| **Pages tab-as-switcher** | **This pass.** Compile-visible expanded-rail Pages tab from Bookmarks / Search / Spaces; never intended+break+edge without a thumbnail jump. |

## Live-proved

Playwright `e2e-pages-tab-as-switcher.spec.mjs` **2 / 2** + hunt `e2e-after-bookmarks-rail-independent-hunt.spec.mjs` **1 / 1** on Playwright Vite `http://localhost:5173` (**3 / 3 (11.3s)**). Focused Node `pagesTabAsSwitcher` + leftover18 **16 / 16**.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `?testPdf=clickable-link-test.pdf` 1400×900. Collapse **0**; Pages live; host **48** / panel **48** → Expand sidebar contrast shows `alt=Page 1` (not this leftover). Bookmarks → Pages shows `alt=Page 1`, hides empty chrome / Search field / Spaces empty, page stays **1**; Search → Pages and Spaces → Pages stay page **1**; host **48** / panel **272**. Overlay lists B Toggle sidebar, not a Pages-tab chord. viewBox **`0 0 612 792`**. `file.id` null. |
| Break desktop | Escape / Space do not collapse. Already-open Pages re-click stays panel **272** and invents **0** jump. Double-click Pages stays expanded and invents **0** jump. hubPreview viewer Pages thumbnails **0**. Hidden tools **0**. |
| Edge desktop | Page-1 rect `b82fedd8-64ee-4bc0-beb1-80744eb9327d` survives; Pen-armed Pages invents **0**; 120-page Next→**2** then Bookmarks → Pages stays **2** (no reset to 1, no dest-XYZ, no thumbnail click). |
| Edge 390 | Open pages, search, and bookmarks defaults to Pages (`alt=Page 1`); Bookmarks empty chrome; Pages tab shows thumbnails, hides empty chrome, page stays **1**; closer hides thumbs. viewBox **`0 0 612 792`**. |
| Hunt | Version history live (History-dedicated; Restore / Save version **0**); File menu **0** (UL-03); Duplicate / Select all / Ungroup **0**; Curve / Stamp / Cloud **0**; overlay omits Pages-tab / Duplicate / Undo / Fit height / F3; hubPreview viewer Pages **0**; hub More **6** (already dedicated); 390 Version history live (History-dedicated); kal441 Forms create **0**. |

Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. High-risk files not edited; official `npm test` not required this pass. Cap **8448** / 75/250 not loosened. Isolated 8448 standing. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

Hunt after this leftover found no unique compile-visible leftover besides leftover-18 / parked hosts / already-dedicated slices (History, hub More, create-path, V-09 overlay omissions). Goal stays open.

## Files

- `debug/scenarios/e2e-pages-tab-as-switcher.spec.mjs`
- `debug/scenarios/e2e-after-bookmarks-rail-independent-hunt.spec.mjs`
- `tests/pagesTabAsSwitcher.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

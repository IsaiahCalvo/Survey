# Archive Show and sort *menu* name — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `b5b9951d` Documents More menu name live 3/3.  
**Product SHA:** `9cdcd522`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Last hunt named Documents More **menu** name. Did **not** take leftover-18 or exhausted slices. Different axis:

1. Official leftover files vs live source after Documents More `aria-label` (NOT isolated 8448). Overlay-mount / spacesRail / popover / hub nav / Sync / Settings / Confirm / CreateCategory / KeyboardShortcuts / Access / Edit modules labelledby / Manage Team / Selection Mode / Eraser Type / Documents More already match live compile-visible code. Isolated **8448** (`partialEraserComplexity` `8_448 * 1024 * 1024`) still standing — not loosened. Official `annotationContextMenuitem` leftover official vs spec Enter is **not** stale vs live source (`useAnnotationContextMenu.jsx` already has `e.key === 'Enter' || e.key === ' '`; spec-only leftover, not taken).
2. Compile-visible menus with a visible action list but missing `role="menu"` **name** that are NOT leftover-18 hosts and NOT the exhausted nameless-menu hosts (Home tab / annotation / Pages / hub Account / Manage Team More / Selection Mode / Eraser Type / Documents More name).
3. Live open of Archive Show/Sort on `/?hubPreview=1&tab=archive`. PromptModal lock / NewColumnsModal stay leftover-18. Do **not** name the Activity dialog (A-06 roster adjacent). Do **not** click Restore / Delete forever.

Unique leftover: Archive Show/Sort was `role="menu"` of already-named menuitemradios with **no** `aria-label`. `getByRole('menu', { name: 'Show and sort' })` was **0** while Documents radio was **1**. Same a11y *name* class as Documents More / Pages / Manage Team menus, but a new compile-visible host (sort/filter, not document actions). Distinct from leftover-18 / X-01 / Activity dialog name / Documents More name / archive Search-filter-sort apply catalogs / unnamed-dialog family already proved / remapped-after-CW / dismiss / rail-toggle / Home-tab / annotation / Pages / hub Account / Manage Team / Selection Mode / Eraser Type leftovers.

**Product:** min-viable-diff in `ArchiveScreen.jsx` — `archive-sort-menu` `aria-label="Show and sort"`. Isolated 8448 standing. Cap **8448** / 75/250 not loosened. No high-risk file edit.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** name Activity. Did **not** click Restore / Delete forever. Did **not** invent leftover-18 mint / roster / Stripe / delete-forever / account-delete.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| Official leftover files after Documents More | **No stale fail vs live source** besides isolated 8448. Official `annotationContextMenuitem` leftover official vs spec Enter is spec-only — source already has Enter. Focused official leftover18 + `archiveSortMenuName` + hunt **17 / 17**. |
| X-01 / leftover-18 hosts | **Parked.** Process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| PDF AcroForm `name` / `agree` | Forms / X-05 persist stay leftover-18. Idle editor unnamed text+checkbox **2**. |
| PromptModal lock / NewColumnsModal | leftover-18 / X-01 / X-06. Not taken. |
| Manage Team Activity dialog name | **Not taken.** A-06 roster adjacent. Do not invent a roster host. |
| Manage Team role picker | hubPreview creator-only seed — not taken. |
| Exhausted nameless-menu hosts | Home tab / annotation / Pages / hub Account / Manage Team More / Selection Mode / Eraser Type / Documents More name — do not replay. |
| Highlighter caret | Compile-hidden. Trigger **0**. |
| Counter caret | Fresh `?testPdf=` caret **0**. Not taken. |
| Templates More name | Hunt opened nameless `Copy Rename Share Delete`. Not taken. |
| Projects More name | Hunt opened nameless `Add member Get link…`. Not taken. |
| Documents mobile sort | Hunt opened nameless `File Project Last edited Size` at 390. Not taken. |
| **Archive Show and sort *menu* name** | **This pass.** Menu open **1**; before fix named menu **0**. After fix: `Show and sort`. |

## Live-proved

Playwright `e2e-archive-sort-menu-name.spec.mjs` **2 / 2** + hunt `e2e-after-archive-sort-menu-independent-hunt.spec.mjs` **1 / 1**. Pair **3 / 3 (10.0s)** on Playwright Vite `http://127.0.0.1:5175`. Focused Node `archiveSortMenuName` + hunt + leftover18 **17 / 17**.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `/?hubPreview=1&tab=archive`. Filter opens `role="menu"` named `Show and sort`. Menuitemradios All / Documents / Projects / Templates / File / Project / Most recently archived / Size. Escape dismisses. Documents filter hides Atrium + Bravo checklist; Site plan stays. Restore / Delete forever counted, not clicked. |
| Break | Empty idle named menu **0** (empty still opens the control). Guest / Documents tab / `?testPdf=` named menu **0**. Hidden tools **0**. `file.id` null. Isolated 8448 standing. |
| Edge | 390 mobile names the same menu + Documents radio. Documents More still names Share. Manage Team More still names Copy email; Activity **0**. Eraser Type / Selection Mode / shortcuts `?` / Edit modules still named. viewBox **`0 0 612 792`**. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` not required this pass. Isolated 8448 still standing. Cap **8448** / 75/250 not loosened. `graphify` CLI usually absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

Hunt after the name: idle editor unnamed text+checkbox remain Forms / X-05; Activity card stays unnamed (A-06 roster adjacent — not taken); Highlighter caret stays compile-hidden; Counter caret stays **0** on a fresh `?testPdf=` (no series); official spec Enter stays spec-only; Templates / Projects More and Documents mobile sort stay nameless. Goal stays open.

## Files

- `src/home/ArchiveScreen.jsx`
- `debug/scenarios/e2e-archive-sort-menu-name.spec.mjs`
- `debug/scenarios/e2e-after-archive-sort-menu-independent-hunt.spec.mjs`
- `tests/archiveSortMenuName.test.mjs`
- `tests/afterArchiveSortMenuIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

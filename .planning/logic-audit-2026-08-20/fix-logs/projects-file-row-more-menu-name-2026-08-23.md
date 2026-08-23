# Projects file-row More *menu* name — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `b7a14111` Documents Sort menu name live 3/3.  
**Product SHA:** `36f0841c`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Last hunt named Documents mobile Sort **menu** name. Did **not** take leftover-18 or exhausted slices. Different axis:

1. Official leftover files vs live source after Documents Sort `aria-label` (NOT isolated 8448). Overlay-mount / spacesRail / popover / hub nav / Sync / Settings / Confirm / CreateCategory / KeyboardShortcuts / Access / Edit modules labelledby / Manage Team / Selection Mode / Eraser Type / Documents More / Archive Show and sort / Templates More / Projects More / Documents mobile Sort already match live compile-visible code. Isolated **8448** (`partialEraserComplexity` `8_448 * 1024 * 1024`) still standing — not loosened. Official `annotationContextMenuitem` leftover official vs spec Enter is **not** stale vs live source (`useAnnotationContextMenu.jsx` already has `e.key === 'Enter' || e.key === ' '`; spec-only leftover, not taken).
2. Compile-visible menus with a visible action list but missing `role="menu"` **name** that are NOT leftover-18 hosts and NOT the exhausted nameless-menu hosts (Home tab / annotation / Pages / hub Account / Manage Team More / Selection Mode / Eraser Type / Documents More name / Archive Show and sort / Templates More / Projects More / Documents mobile Sort).
3. Live open of Projects file-row More on `/?hubPreview=1&tab=projects`. PromptModal lock / NewColumnsModal stay leftover-18. Do **not** name the Activity dialog (A-06 roster adjacent). Do **not** click Lock / Delete. Do **not** click Upload files. Do **not** apply Pin.

Unique leftover: Projects file-row More was `role="menu"` of already-named menuitems with **no** `aria-label`. `getByRole('menu', { name: /actions$/ })` was **0** while Copy / Paste / Delete / Share / Lock document were **1**. Same a11y *name* class as Documents More / Archive Show and sort / Templates More / Projects More / Documents mobile Sort, but a new compile-visible host (`ProjectsFolderTree` file-row `PopupMenu`). Distinct from leftover-18 / X-01 / Activity dialog name / Documents More name / Archive Show and sort / Templates More name / Projects More name / Documents mobile Sort / unnamed-dialog family already proved / remapped-after-CW / dismiss / rail-toggle / Home-tab / annotation / Pages / hub Account / Manage Team / Selection Mode / Eraser Type leftovers.

**Product:** min-viable-diff in `ProjectsFolderTree.jsx` — file-row `PopupMenu` `aria-label={`${f.name || 'Document'} actions`}`. Isolated 8448 standing. Cap **8448** / 75/250 not loosened. No high-risk file edit.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** name Activity. Did **not** click Lock / Delete / Upload. Did **not** apply Pin. Did **not** invent leftover-18 mint / roster / Stripe / delete-forever / account-delete.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| Official leftover files after Documents Sort | **No stale fail vs live source** besides isolated 8448. Official `annotationContextMenuitem` leftover official vs spec Enter is spec-only — source already has Enter. Focused official leftover18 + `projectsFileRowMoreMenuName` + hunt **17 / 17**. |
| X-01 / leftover-18 hosts | **Parked.** Process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| PDF AcroForm `name` / `agree` | Forms / X-05 persist stay leftover-18. Idle editor unnamed text+checkbox **2**. |
| PromptModal lock / NewColumnsModal | leftover-18 / X-01 / X-06. Not taken. |
| Manage Team Activity dialog name | **Not taken.** A-06 roster adjacent. Do not invent a roster host. |
| Manage Team role picker | hubPreview creator-only seed — not taken. |
| Exhausted nameless-menu hosts | Home tab / annotation / Pages / hub Account / Manage Team More / Selection Mode / Eraser Type / Documents More name / Archive Show and sort / Templates More / Projects More / Documents mobile Sort — do not replay. |
| Highlighter caret | Compile-hidden. Trigger **0**. |
| Counter caret | Fresh `?testPdf=` caret **0**. Not taken. |
| **Projects file-row More *menu* name** | **This pass.** Menu open **1**; before fix named menu **0**. After fix: `SE-011 Security Shop Drawings.pdf actions` / `RFI-014 Lobby Camera Coverage.pdf actions` / `Door Hardware Schedule — A.601.pdf actions`. |

## Live-proved

Playwright `e2e-projects-file-row-more-menu-name.spec.mjs` **2 / 2** + hunt `e2e-after-projects-file-row-more-independent-hunt.spec.mjs` **1 / 1**. Pair **3 / 3 (10.8s)** on Playwright Vite `http://127.0.0.1:5321`. Focused Node `projectsFileRowMoreMenuName` + hunt + leftover18 **17 / 17**.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `/?hubPreview=1&tab=projects`. SE-011 file-row More opens `role="menu"` named `SE-011 Security Shop Drawings.pdf actions`. Menuitems Copy / Paste / Delete / Share / Lock document. Escape dismisses. Share opens named Document Access. RFI More names `RFI-014 Lobby Camera Coverage.pdf actions`. Lab Reno Door Hardware names `Door Hardware Schedule — A.601.pdf actions`. Lock / Delete not clicked. |
| Break | Empty / guest / idle named menu **0**. `?testPdf=` Lock document **0**. Hidden tools **0**. `file.id` null. Isolated 8448 standing. |
| Edge | 390 drill file-row names the same menu + Share. Documents More still names Share. Archive filter still names Show and sort. Templates More still names Security Walk-Through actions. Projects More still names Tower 5 — Security actions. Documents Sort still names Sort. Manage Team More still names Copy email; Activity **0**. Eraser Type / Selection Mode / shortcuts `?` / Edit modules still named. viewBox **`0 0 612 792`**. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` not required this pass. Isolated 8448 still standing. Cap **8448** / 75/250 not loosened. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

Hunt after the name: idle editor unnamed text+checkbox remain Forms / X-05; Activity card stays unnamed (A-06 roster adjacent — not taken); Highlighter caret stays compile-hidden; Counter caret stays **0** on a fresh `?testPdf=` (no series); official spec Enter stays spec-only. Goal stays open.

## Files

- `src/home/ProjectsFolderTree.jsx`
- `debug/scenarios/e2e-projects-file-row-more-menu-name.spec.mjs`
- `debug/scenarios/e2e-after-projects-file-row-more-independent-hunt.spec.mjs`
- `tests/projectsFileRowMoreMenuName.test.mjs`
- `tests/afterProjectsFileRowMoreIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

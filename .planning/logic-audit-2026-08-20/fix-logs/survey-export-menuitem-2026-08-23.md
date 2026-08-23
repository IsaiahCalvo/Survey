# Survey export menu name — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `119e7317` Wait after Create space on the search-fixture edge too.  
**Product:** `src/SurveySpacesRail.jsx`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Last hunt named Spaces export **menuitem** + menu name. Did **not** take leftover-18 or exhausted slices. Different axis:

1. Official leftover files vs live source after Spaces export `aria-label` / `role="menuitem"` (NOT isolated 8448). Overlay-mount / spacesRail / popover / hub nav / Sync / Settings / Confirm / CreateCategory / KeyboardShortcuts / Access / Edit modules labelledby / Manage Team / Selection Mode / Eraser Type / Documents More / Archive Show and sort / Templates More / Projects More / Documents mobile Sort / Projects file-row More / Spaces export already match live compile-visible code. Isolated **8448** (`partialEraserComplexity` `8_448 * 1024 * 1024`) still standing — not loosened. Official `annotationContextMenuitem` leftover official vs spec Enter is **not** stale vs live source (`useAnnotationContextMenu.jsx` already has `e.key === 'Enter' || e.key === ' '`; spec-only leftover, not taken).
2. Compile-visible menus with a visible action list but missing menu **name** that are NOT leftover-18 hosts and NOT the exhausted nameless-menu hosts (Home tab / annotation / Pages / hub Account / Manage Team More / Selection Mode / Eraser Type / Documents More name / Archive Show and sort / Templates More / Projects More / Documents mobile Sort / Projects file-row More / Spaces export).
3. Live open of Survey export on `/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Survey EXPORT / Push / Sync apply stay leftover-18. Space CSV / PDF Pages apply stay leftover-18. PromptModal lock / NewColumnsModal stay leftover-18. Do **not** name the Activity dialog (A-06 roster adjacent). Do **not** click EXPORT / Open linked / Update existing / Export Excel / Sync Microsoft 365 / CSV / PDF Pages.

Unique leftover: last hunt counted Survey export menus **0** (not opened). Desktop Excel actions was `role="menu"` of already-named menuitems with **no** `aria-label`. `getByRole('menu', { name: 'Excel actions' })` was **0** while Open linked / Update existing were visible as menuitems. 390 Export survey data was the same nameless host. Same a11y *name* class as Spaces export / Documents More / Archive Show and sort, but a new compile-visible host (`SurveySpacesRail` `.survey-marker-export-compact-menu` + `.mobile-survey-sheet-export-menu`). Distinct from leftover-18 Survey EXPORT / Push / Sync apply / Space CSV / PDF Pages apply / X-01 / Activity dialog name / Excel actions fail-closed apply / Survey/Spaces menu dismiss / Spaces export menuitem / nameless-menu hosts already proved / unnamed-dialog family already proved / remapped-after-CW / dismiss / rail-toggle.

**Product:** min-viable-diff in `SurveySpacesRail.jsx` — desktop export menu `aria-label="Excel actions"` + mobile export menu `aria-label="Export survey data"`. Isolated 8448 standing. Cap **8448** / 75/250 not loosened. No high-risk file edit.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** name Activity. Did **not** click EXPORT / Open linked / Update existing / Export Excel / Sync / CSV / PDF Pages apply.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| Official leftover files after Spaces export | **No stale fail vs live source** besides isolated 8448. Official `annotationContextMenuitem` leftover official vs spec Enter is spec-only — source already has Enter. |
| X-01 / leftover-18 hosts | **Parked.** Process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| PDF AcroForm `name` / `agree` | Forms / X-05 persist stay leftover-18. Idle editor unnamed text+checkbox **2**. |
| PromptModal lock / NewColumnsModal | leftover-18 / X-01 / X-06. Not taken. |
| Manage Team Activity dialog name | **Not taken.** A-06 roster adjacent. Do not invent a roster host. |
| Manage Team role picker | hubPreview creator-only seed — not taken. |
| Exhausted nameless-menu hosts | Home tab / annotation / Pages / hub Account / Manage Team More / Selection Mode / Eraser Type / Documents More name / Archive Show and sort / Templates More / Projects More / Documents mobile Sort / Projects file-row More / Spaces export — do not replay. |
| Highlighter caret | Compile-hidden. Trigger **0**. |
| Counter caret | Fresh `?testPdf=` caret **0**. Not taken. |
| Survey EXPORT / Push / Sync apply | leftover-18. Not clicked. |
| Space CSV / PDF Pages apply | leftover-18. Not clicked. |
| **Survey export menu name** | **This pass.** Menu open **1**; before fix named menu **0**. After fix: `Excel actions` (desktop) + `Export survey data` (390). |

## Live-proved

Playwright `e2e-survey-export-menuitem.spec.mjs` **2 / 2** + hunt `e2e-after-survey-export-menuitem-independent-hunt.spec.mjs` **1 / 1**. Pair **3 / 3** on Playwright Vite (port filled after live run). Focused Node `surveyExportMenuitem` + hunt + leftover18 **17 / 17**.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Survey → KAL-436 → Excel actions opens `role="menu"` named `Excel actions`. Menuitems Open linked / Update existing. Escape dismisses. EXPORT / Open linked / Update existing not clicked. |
| Break | Hub / idle named menu **0**. `?testPdf=` Open linked menuitem idle **0**. Hidden tools **0**. `file.id` null. Isolated 8448 standing. |
| Edge | 390 Open survey names `Export survey data`. Search fixture names Excel actions. Documents More still names Share. Spaces export still names Export Space 1. viewBox **`0 0 612 792`**. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` not required this pass. Isolated 8448 still standing. Cap **8448** / 75/250 not loosened. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

Hunt after the name: idle editor unnamed text+checkbox remain Forms / X-05; Activity card stays unnamed (A-06 roster adjacent — not taken); Highlighter caret stays compile-hidden; Counter caret stays **0** on a fresh `?testPdf=` (no series); official spec Enter stays spec-only. Goal stays open.

## Files

- `src/SurveySpacesRail.jsx`
- `debug/scenarios/e2e-survey-export-menuitem.spec.mjs`
- `debug/scenarios/e2e-after-survey-export-menuitem-independent-hunt.spec.mjs`
- `tests/surveyExportMenuitem.test.mjs`
- `tests/afterSurveyExportMenuitemIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

# Spaces export menuitem + menu name — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `ab95667e` Projects file-row More menu name live 3/3.  
**Product:** `src/sidebar/SpacesPanel.jsx`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Last hunt named Projects file-row More **menu** name. Did **not** take leftover-18 or exhausted slices. Different axis:

1. Official leftover files vs live source after Projects file-row More `aria-label` (NOT isolated 8448). Overlay-mount / spacesRail / popover / hub nav / Sync / Settings / Confirm / CreateCategory / KeyboardShortcuts / Access / Edit modules labelledby / Manage Team / Selection Mode / Eraser Type / Documents More / Archive Show and sort / Templates More / Projects More / Documents mobile Sort / Projects file-row More already match live compile-visible code. Isolated **8448** (`partialEraserComplexity` `8_448 * 1024 * 1024`) still standing — not loosened. Official `annotationContextMenuitem` leftover official vs spec Enter is **not** stale vs live source (`useAnnotationContextMenu.jsx` already has `e.key === 'Enter' || e.key === ' '`; spec-only leftover, not taken).
2. Compile-visible menus with a visible action list but missing `role="menuitem"` / menu **name** that are NOT leftover-18 hosts and NOT the exhausted nameless-menu hosts (Home tab / annotation / Pages / hub Account / Manage Team More / Selection Mode / Eraser Type / Documents More name / Archive Show and sort / Templates More / Projects More / Documents mobile Sort / Projects file-row More).
3. Live open of Spaces export on `/?testPdf=clickable-link-test.pdf`. Space CSV / PDF Pages **apply** stay leftover-18. PromptModal lock / NewColumnsModal stay leftover-18. Do **not** name the Activity dialog (A-06 roster adjacent). Do **not** click CSV / PDF Pages.

Unique leftover: Spaces header export was `role="menu"` of already-named `<button>`s with **no** `aria-label` and **no** `role="menuitem"`. `getByRole('menuitem', { name: 'CSV' })` was **0** while CSV / PDF Pages were visible as buttons. Same a11y *item* class as hub Account / annotation / Pages / Manage Team / Selection Mode / Eraser Type, but a new compile-visible host (`SpacesPanel` `.spaces-header-export-menu`). Distinct from leftover-18 Space CSV / PDF Pages apply / X-01 / Activity dialog name / Projects file-row More name / Documents More name / Archive Show and sort / Templates More name / Projects More name / Documents mobile Sort / unnamed-dialog family already proved / remapped-after-CW / dismiss / rail-toggle / Survey/Spaces menu dismiss / Spaces rail toggle.

**Product:** min-viable-diff in `SpacesPanel.jsx` — export menu `aria-label={`Export ${spacesExportTarget.name || 'space'}`}` + `role="menuitem"` on CSV / PDF Pages + trigger `aria-haspopup="menu"`. Isolated 8448 standing. Cap **8448** / 75/250 not loosened. No high-risk file edit.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** name Activity. Did **not** click CSV / PDF Pages apply.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| Official leftover files after Projects file-row More | **No stale fail vs live source** besides isolated 8448. Official `annotationContextMenuitem` leftover official vs spec Enter is spec-only — source already has Enter. |
| X-01 / leftover-18 hosts | **Parked.** Process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| PDF AcroForm `name` / `agree` | Forms / X-05 persist stay leftover-18. Idle editor unnamed text+checkbox **2**. |
| PromptModal lock / NewColumnsModal | leftover-18 / X-01 / X-06. Not taken. |
| Manage Team Activity dialog name | **Not taken.** A-06 roster adjacent. Do not invent a roster host. |
| Manage Team role picker | hubPreview creator-only seed — not taken. |
| Exhausted nameless-menu hosts | Home tab / annotation / Pages / hub Account / Manage Team More / Selection Mode / Eraser Type / Documents More name / Archive Show and sort / Templates More / Projects More / Documents mobile Sort / Projects file-row More — do not replay. |
| Highlighter caret | Compile-hidden. Trigger **0**. |
| Counter caret | Fresh `?testPdf=` caret **0**. Not taken. |
| Space CSV / PDF Pages apply | leftover-18. Not clicked. |
| **Spaces export menuitem + menu name** | **This pass.** Menu open **1**; before fix named menuitem **0**. After fix: `Export Space 1` menu + CSV / PDF Pages menuitems. |

## Live-proved

Playwright `e2e-spaces-export-menuitem.spec.mjs` **2 / 2** + hunt `e2e-after-spaces-export-menuitem-independent-hunt.spec.mjs` **1 / 1**. Pair **3 / 3 (15.2s)** on Playwright Vite `http://127.0.0.1:5335`. Focused Node `spacesExportMenuitem` + hunt + leftover18 **17 / 17**.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `/?testPdf=clickable-link-test.pdf`. Spaces → Create space → Export Space 1 opens `role="menu"` named `Export Space 1`. Menuitems CSV / PDF Pages. Escape dismisses. CSV / PDF Pages not clicked. |
| Break | Hub / idle / no-space export disabled named menu **0**. `?testPdf=` CSV menuitem idle **0**. Hidden tools **0**. `file.id` null. Isolated 8448 standing. |
| Edge | 390 Open spaces names the same menu. Search fixture names Export Space 1. Documents More still names Share. Projects file-row More still names SE-011 actions. viewBox **`0 0 612 792`**. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` not required this pass. Isolated 8448 still standing. Cap **8448** / 75/250 not loosened. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

Hunt after the name: idle editor unnamed text+checkbox remain Forms / X-05; Activity card stays unnamed (A-06 roster adjacent — not taken); Highlighter caret stays compile-hidden; Counter caret stays **0** on a fresh `?testPdf=` (no series); official spec Enter stays spec-only. Goal stays open.

## Files

- `src/sidebar/SpacesPanel.jsx`
- `debug/scenarios/e2e-spaces-export-menuitem.spec.mjs`
- `debug/scenarios/e2e-after-spaces-export-menuitem-independent-hunt.spec.mjs`
- `debug/scenarios/e2e-survey-spaces-menu-dismiss.spec.mjs` (CSV / PDF Pages visibility now menuitem)
- `tests/spacesExportMenuitem.test.mjs`
- `tests/afterSpacesExportMenuitemIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

# Add bookmark dialog name — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `47ce3780` docs: record Add bookmarks to group live 3/3 (10.3s).  
**Product:** `src/sidebar/BookmarksPanel.jsx`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Last hunt named Add bookmarks to group **dialog** + Escape. Did **not** take leftover-18 or exhausted slices. Different axis:

1. Official leftover files vs live source after Add bookmarks to group `aria-labelledby` (NOT isolated 8448). Overlay-mount / spacesRail / popover / hub nav / Sync / Settings / Confirm / CreateCategory / KeyboardShortcuts / Access / Edit modules labelledby / Manage Team / Selection Mode / Eraser Type / Documents More / Archive Show and sort / Templates More / Projects More / Documents mobile Sort / Projects file-row More / Spaces export / Survey export / Create bookmark group / Add bookmarks to group already match live compile-visible code. Isolated **8448** (`partialEraserComplexity` `8_448 * 1024 * 1024`) still standing — not loosened. Official `annotationContextMenuitem` leftover official vs spec Enter is **not** stale vs live source (`useAnnotationContextMenu.jsx` already has `e.key === 'Enter' || e.key === ' '`; spec-only leftover, not taken).
2. Compile-visible overlays with a visible heading or actions but missing `role="dialog"` / name that are NOT leftover-18 hosts and NOT the exhausted unnamed-dialog hosts (Settings / Confirm / CreateCategory / KeyboardShortcuts / Access / Edit modules / Create bookmark group / Add bookmarks to group).
3. Live open of Bookmarks → Add bookmark on `/?testPdf=clickable-link-test.pdf`. V-07 Create group apply stays dedicated (not clicked). Add bookmarks apply stays dedicated (not clicked). Create bookmark apply stays dedicated (not clicked). PromptModal lock / NewColumnsModal stay leftover-18. Do **not** name the Activity dialog (A-06 roster adjacent). Hub novel Close preview is already `aria-label`d.

Unique leftover: last hunt opened Add bookmark only as a path to the child dialog. The parent popover had New bookmark group / Add bookmarks to group / Current page / Create bookmark with **no** `role="dialog"` / name. Escape already dismissed via `DismissBarrier`. Same a11y *name* class as Settings / Confirm / CreateCategory / Create bookmark group / Add bookmarks to group, but a new compile-visible host (`BookmarksPanel` create-menu popover). Distinct from leftover-18 / X-01 / Activity dialog name / V-07 Create group apply / Add bookmarks apply / Create bookmark apply / Create bookmark group name / Add bookmarks to group name / nameless-menu hosts already proved / unnamed-dialog family already proved / remapped-after-CW / dismiss / rail-toggle / dest-XYZ.

**Product:** min-viable-diff in `BookmarksPanel.jsx` — trigger `aria-haspopup="dialog"` + `aria-expanded`; popover `role="dialog"` + `aria-label="Add bookmark"`; New bookmark group / Current page / Create bookmark `type="button"`. Isolated 8448 standing. Cap **8448** / 75/250 not loosened. No high-risk file edit.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** name Activity. Did **not** click Create group apply / Add bookmarks apply / Create bookmark apply / EXPORT / Open linked / Update existing / Export Excel / Sync / CSV / PDF Pages apply.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| Official leftover files after Add bookmarks to group | **No stale fail vs live source** besides isolated 8448. Official `annotationContextMenuitem` leftover official vs spec Enter is spec-only — source already has Enter. |
| X-01 / leftover-18 hosts | **Parked.** Process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| PDF AcroForm `name` / `agree` | Forms / X-05 persist stay leftover-18. Idle editor unnamed text+checkbox **2**. |
| PromptModal lock / NewColumnsModal | leftover-18 / X-01 / X-06. Not taken. |
| Manage Team Activity dialog name | **Not taken.** A-06 roster adjacent. Do not invent a roster host. |
| Manage Team role picker | hubPreview creator-only seed — not taken. |
| Hub novel Close preview | Already `aria-label="Close preview"` on DocumentsLedger / Archive. Not taken. |
| Exhausted nameless-menu hosts | Home tab / annotation / Pages / hub Account / Manage Team More / Selection Mode / Eraser Type / Documents More name / Archive Show and sort / Templates More / Projects More / Documents mobile Sort / Projects file-row More / Spaces export / Survey export — do not replay. |
| Exhausted unnamed-dialog hosts | Settings / Confirm / CreateCategory / KeyboardShortcuts / Access / Edit modules / Create bookmark group / Add bookmarks to group — do not replay. |
| Highlighter caret | Compile-hidden. Trigger **0**. |
| Counter caret | Fresh `?testPdf=` caret **0**. Not taken. |
| Survey EXPORT / Push / Sync apply | leftover-18. Not clicked. |
| Space CSV / PDF Pages apply | leftover-18. Not clicked. |
| V-07 Create group apply | Already dedicated. Not clicked. |
| Add bookmarks apply | Already dedicated / leftover-18 adjacent. Not clicked. |
| Create bookmark apply | Already dedicated. Not clicked. |
| **Add bookmark dialog name + Escape** | **This pass.** Before fix named dialog **0** while New bookmark group / Add bookmarks to group / Create bookmark were visible. After fix: named dialog **1**; Escape dismisses; New bookmark group opens the already-named Create bookmark group dialog without applying. |

## Live-proved

Playwright `e2e-add-bookmark-dialog-name.spec.mjs` **2 / 2** + hunt `e2e-after-add-bookmark-dialog-independent-hunt.spec.mjs` **1 / 1**. Pair **3 / 3 (9.4s)** on Playwright Vite `http://127.0.0.1:5365`. Focused Node `addBookmarkDialogName` + hunt + leftover18 **17 / 17**. Live spec does not count `dialog` named Activity (leftover18 Node contract); hunt still checks `/activity/i` after Manage Team without opening Activity.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `/?testPdf=clickable-link-test.pdf`. Bookmarks → Add bookmark opens `role="dialog"` named `Add bookmark`. Escape dismisses. New bookmark group opens Create bookmark group (Escape; Create group apply not clicked). Create bookmark apply not clicked. |
| Break | Hub / idle / 390 named Add bookmark dialog **0**. Hidden tools **0**. `file.id` null. Isolated 8448 standing. |
| Edge | Search fixture names Add bookmark; Add bookmarks to group still named (Close, not apply). Create bookmark group stays named. Documents More still names Share. Survey export still names Excel actions. viewBox **`0 0 612 792`**. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` not required this pass. Isolated 8448 still standing. Cap **8448** / 75/250 not loosened. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

Hunt after the name: idle editor unnamed text+checkbox remain Forms / X-05; Activity card stays unnamed (A-06 roster adjacent — not taken); Highlighter caret stays compile-hidden; Counter caret stays **0** on a fresh `?testPdf=` (no series); official spec Enter stays spec-only; hub novel Close preview already labelled; novel names **[]**. Goal stays open.

## Files

- `src/sidebar/BookmarksPanel.jsx`
- `debug/scenarios/e2e-add-bookmark-dialog-name.spec.mjs`
- `debug/scenarios/e2e-after-add-bookmark-dialog-independent-hunt.spec.mjs`
- `tests/addBookmarkDialogName.test.mjs`
- `tests/afterAddBookmarkDialogIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

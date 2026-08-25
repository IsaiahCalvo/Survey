# Bookmarks Edit / Done type=button — 2026-08-25

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `e734a7a8` docs: record Bookmarks group chrome type live 3/3 (25.4s).  
**Product:** `fd2c268b` Bookmarks panel Edit / Done `type="button"`  
**Prove:** `1933be6a` intended + break + edge + this-pass hunt; `44c46250` Node contract tighten; `96cf632b` rename-field count  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Version history crash did not reproduce; desktop Version history trigger stays **0** on `?testPdf=` (`cloudSync: false`). Did **not** stamp `file.id`. Did **not** replay Bookmarks Expand / Collapse / Add-to-group type. Did **not** replay CreateCategoryModal type. Did **not** replay Draw/Shapes/Text sub-toolbar types. Did **not** replay Edit text type. Did **not** replay Zoom/page-nav type. Did **not** replay Export/Draw/Shapes/Text category type. Did **not** replay Undo/Redo type. Did **not** take leftover-18. Font color / Bold / Italic stay **0** without richTextEditor. Unique leftover after Bookmarks group chrome type: Bookmarks panel Edit / Done omitted `type="button"` (visible name already `Edit` / `Done`). Live `?testPdf=Package 2 - Rev 4 -- IC.pdf` outline already seeds groups. Type only. Opening Edit is OK. Escape on rename inputs + Done exits edit mode. Did **not** apply a bookmark rename/save. Did **not** create a bookmark group. Did **not** apply Add bookmark / Add bookmark to group. Did **not** click Delete.

Looked beyond leftover-18 / History Version history trigger 0 / Bookmarks group chrome type / CreateCategoryModal type / Draw sub-toolbar type / Shapes sub-toolbar type / sub-toolbar Text / Callout type / Edit text type / Zoom / page-nav type / Export / Draw / Shapes / Text category type / Undo / Redo type / Manage Team More type / Manage Team Invite type / AccessManagement Invite type / AccessManagement Close type / AccessManagement dialog name / CreateProjectModal Close name / Confirm Cancel/Confirm type / Rename Cancel/Save type / Rename Close name / Projects More type / Archive Show documents name / Account Settings Sign out type / Edit profile type / sidebar tabs type / Close type.

Official leftover files besides isolated 8448 do not still fail vs live source after Bookmarks Edit `type="button"`. Official `annotationContextMenuitem` leftover official vs spec Enter is **not** stale vs live source (source already has Enter; spec-only — not taken). Isolated **8448** still standing. Cap **8448** / 75/250 not loosened.

Unique leftover: Bookmarks panel Edit / Done omitted `type="button"`. Same a11y *type* class as CreateCategory Cancel / Bookmarks Expand group, new host (`BookmarksPanel` header Edit / Done). Distinct from leftover-18 / X-01 / History Version history trigger 0 / exhausted Create bookmark group / Add bookmarks to group / Add bookmark dialogs / Expand / Collapse / Add-to-group type / Font color / Bold / Italic still behind richTextEditor / Highlighter caret compile-hidden / Counter caret 0.

**Product:** min-viable-diff — one `BookmarksPanel` header button `type="button"` (visible names already present). Isolated 8448 standing. No high-risk file edit. SVG viewBox still owns zoom. `zoomGeneration` untouched. Canvas sizing stays container-aware.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** write another leftover-18 parking note that contradicts the owner-local host-proved set. Did **not** apply `20260820*.sql`. Did **not** click Invite / Send / Manage Team Done / Access Done / Create project / Confirm / Save / Restore / Delete forever / Open file / Share / Upload / Sign out / Delete account / Subscription apply / Templates New entity apply / Delete category / Start trial / **Export annotated PDF** / Version history / Undo / Redo / Pen / Highlighter / Eraser create / Rectangle / Ellipse / Line / Arrow / Counter apply / Callout apply / Font color / Bold / Italic / Color swatch / Fit options apply / Edit zoom percentage / Create bookmark group / Add bookmarks to group / Add bookmark apply / Add bookmark to group apply / Create space / Delete group / Delete bookmark.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| Editor Version history page-crash | **Gone.** No ErrorBoundary / `pageerror`. Desktop trigger **0** (cloud-sync footer). Parked — do not stamp `file.id`. |
| Official leftover files after Bookmarks group chrome type | **No stale fail vs live source** besides isolated 8448. Official `annotationContextMenuitem` leftover official vs spec Enter is spec-only. |
| X-01 / leftover-18 hosts | **Parked.** Host-proved X-01 / X-05 / U-04 / UL-13 / A-06 / UL-45 stay host-proved. Human-gated A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24 stay parked. |
| PDF AcroForm `name` / `agree` | Forms / X-05 persist stay leftover-18. Idle editor unnamed text+checkbox **2**. |
| Manage Team Activity dialog name | **Not taken.** A-06 roster adjacent. Activity Close type-null stays adjacent. |
| Pages unnamed cards | Unnamed `div`s. Tab-as-switcher — parked. |
| Select-gated All / None / Duplicate / Move/Copy / Restore / Delete forever | Stay behind Select apply. MoveCopy Close / Cancel / Confirm still omit `type="button"`. |
| AccessManagement row actions | Compile-visible type-null — not live on empty SE-011. |
| Settings Delete account | leftover-18 / UL-16. Not taken. |
| Subscription Manage subscription / Usage | Stay behind Subscription tab apply. |
| CreateCategory / Draw / Shapes / Text / Edit text / Zoom / Export / Undo / group chrome families | **Already proved.** Do not replay. |
| Font color / Bold / Italic / alignment | Compile-visible. Still **0** without richTextEditor. Not taken. |
| Highlighter-caret series | Compile-hidden (`showTextMarkupHighlightMenu = false`). Do not invent a series. |
| Counter-series type-null | Caret **0** on fresh `?testPdf=`. Do not invent a series. |
| Bookmarks Delete type-null | **Live next leftover.** Visible after opening Edit (`Delete bookmark Door Schedule` and siblings). Omitted `type="button"`. Not taken this pass. |
| **Edit / Done type** | **This pass.** Outline groups already on `Package 2 - Rev 4 -- IC.pdf`. Before fix live `type` **null**. After fix: Edit / Done typed (`type="button"`); accname stays; Escape + Done dismiss without rename apply; implicitSubmit **[]**. |

## Live-proved

Playwright `e2e-bookmark-edit-button-type.spec.mjs` **2 / 2** + hunt `e2e-after-bookmark-edit-button-type-independent-hunt.spec.mjs` **1 / 1**. Pair **3 / 3 (24.9s)** on existing Vite `http://localhost:5173`. Focused Node `bookmarkEditButtonType` + hunt + leftover18 **17 / 17**. Official `npm test` fail-stops on pre-existing `annotationContextMenuitem` spec-only Enter (source already has Enter; not taken). Isolated **8448** still standing (not loosened). Live spec opens Bookmarks on outline-seeded Package 2; clicks Edit only to confirm type; Escape on rename inputs; Done exits edit mode. Hunt still opened Documents More / Settings / Get link / Manage Team / New project (`workflowE2E=1` setup) / Share (Access inventory) / Invite (`data-manage-team-invite` inventory only) / Shapes Rectangle arm for Style/Width/Color inventory / Draw arm for Pen/Highlighter/Partial erase inventory / Confirm Delete selected categories (Cancel only) / Create category rail plus (Cancel only) / Bookmarks Edit (inventory only; Done dismiss). Did **not** click Export annotated PDF / Invite / Send / Manage Team Done apply / Access Done apply / Change role / Remove / Resend / View activity / Invite user / Copy email / Restore / Delete forever / Open file / Upload / Sign out / Delete account / Pin / Lock / Get link / Copy / Paste / Delete menuitem apply / Create project / Version history / Undo / Redo / Highlighter / Eraser create / Rectangle / Ellipse / Line / Arrow / Counter apply / Callout apply / Font color / Bold / Italic / Fit options / Edit zoom percentage / Create bookmark group / Add bookmarks to group / Add bookmark apply / Add bookmark to group apply / Delete group / Delete bookmark apply / Save rename.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf`. Outline seeds groups. Edit typed (`type="button"`), accname **Edit**, not inside a form. Click Edit → Done typed, accname **Done**. Rename inputs appear. Escape restores original values. Second rename field also present. Done exits; names kept. implicitSubmit **[]**. Create / Add-bookmarks / Add-bookmark dialogs **0**. Font color / Bold / Italic **0**. Desktop Version history **0**. `file.id` null. viewBox stays `0 0 <w> <h>`. |
| Break | 390 dock Bookmarks: panel Edit / Done **0** (mobile Toggle path). Empty `clickable-link-test` outline still has typed Edit. Empty hub / guest / Documents / Archive / Projects / Templates: panel Edit **0**. Type does not empty accname or auto-save a rename. Guest after auth Close: Sign in. Hidden tools **0**. Isolated 8448 standing. |
| Edge | `se011.pdf` Edit typed; Escape on rename + Done exits without applying. Keep-mount stays inert under the viewer. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Isolated 8448 still standing (`8_448 * 1024 * 1024` in source; cap not loosened). `graphify` CLI absent.

## Leftover-18

Host-proved stay host-proved: X-01, X-05, U-04, UL-13, A-06 / UL-45. Still human-gated: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24. Fail-closed local slices stay dedicated. Isolated official **8448** still standing. Cap **8448** / 75/250 not loosened. Do **not** re-claim unblocked GAP = 0.

Hunt after the type: idle editor unnamed text+checkbox remain Forms / X-05; Activity card stays unnamed (A-06 roster adjacent — not taken); Manage Team role trigger stays **0** on creator-only seed; History Version history trigger stays **0** on desktop `?testPdf=`; Highlighter caret stays compile-hidden; Counter caret stays **0** on a fresh `?testPdf=`; official spec Enter stays spec-only; Edit / Done `type` **button**. Bookmarks **Delete** (edit-mode) still omits `type="button"` (next unique leftover). Settings-open novel names left Delete account (leftover-18 — not taken). Color-open novel names are swatch hex / Hex color / Transparent (C-01 apply not taken). Share-open novel names left Send viewer invite (Send apply parked). Pages unnamed cards stay tab-as-switcher (parked). Documents More menuitem type-null stay behind exhausted Documents More (not taken). Subscription Manage subscription / Usage tabs stay behind Subscription tab apply. MoveCopy Close / Cancel / Confirm still omit `type="button"` (behind Select apply). Compile-visible AccessManagement row actions still omit `type="button"` — not live on empty SE-011. Font color / Bold / Italic / alignment stay compile-visible but **0** without richTextEditor. Goal stays open.

## Files

- `src/sidebar/BookmarksPanel.jsx`
- `debug/scenarios/e2e-bookmark-edit-button-type.spec.mjs`
- `debug/scenarios/e2e-after-bookmark-edit-button-type-independent-hunt.spec.mjs`
- `tests/bookmarkEditButtonType.test.mjs`
- `tests/afterBookmarkEditButtonTypeIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

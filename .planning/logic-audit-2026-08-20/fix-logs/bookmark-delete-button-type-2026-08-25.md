# Bookmarks Delete type=button — 2026-08-25

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `db5783bf` docs: record Bookmarks Edit type live 3/3 (24.9s).  
**Product:** `f6a80b94` Bookmarks edit-mode Delete `type="button"`  
**Prove:** `63aab17d` intended + break + edge + this-pass hunt; `a27d8dd4` Expand-setup so nested Deletes count 4  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Version history crash did not reproduce; desktop Version history trigger stays **0** on `?testPdf=` (`cloudSync: false`). Did **not** stamp `file.id`. Did **not** replay Bookmarks Edit / Done type. Did **not** replay Bookmarks Expand / Collapse / Add-to-group type. Did **not** replay CreateCategoryModal type. Did **not** replay Draw/Shapes/Text sub-toolbar types. Did **not** replay Edit text type. Did **not** replay Zoom/page-nav type. Did **not** replay Export/Draw/Shapes/Text category type. Did **not** replay Undo/Redo type. Did **not** take leftover-18. Font color / Bold / Italic stay **0** without richTextEditor. Unique leftover after Bookmarks Edit type: Bookmarks edit-mode Delete bookmark / Delete group omitted `type="button"` (visible names already present). Live `?testPdf=Package 2 - Rev 4 -- IC.pdf` outline already seeds groups. Type only. Opening Edit is setup only. Expand one seeded group is setup only so nested Deletes are visible (count **4**, first name **Delete bookmark Door Schedule**). Escape on rename inputs + Done exits edit mode. Did **not** apply a bookmark rename/save. Did **not** create a bookmark group. Did **not** apply Add bookmark / Add bookmark to group. Did **not** click Delete bookmark / Delete group.

Looked beyond leftover-18 / History Version history trigger 0 / Bookmarks Edit / Done type / Bookmarks group chrome type / CreateCategoryModal type / Draw sub-toolbar type / Shapes sub-toolbar type / sub-toolbar Text / Callout type / Edit text type / Zoom / page-nav type / Export / Draw / Shapes / Text category type / Undo / Redo type / Manage Team More type / Manage Team Invite type / AccessManagement Invite type / AccessManagement Close type / AccessManagement dialog name / CreateProjectModal Close name / Confirm Cancel/Confirm type / Rename Cancel/Save type / Rename Close name / Projects More type / Archive Show documents name / Account Settings Sign out type / Edit profile type / sidebar tabs type / Close type.

Official leftover files besides isolated 8448 do not still fail vs live source after Bookmarks Delete `type="button"`. Official `annotationContextMenuitem` leftover official vs spec Enter is **not** stale vs live source (source already has Enter; spec-only — not taken). Isolated **8448** still standing. Cap **8448** / 75/250 not loosened.

Unique leftover: Bookmarks edit-mode Delete bookmark / Delete group omitted `type="button"`. Same a11y *type* class as Bookmarks Edit / Done / Expand group, new host (`BookmarkTreeRow` trash). Distinct from leftover-18 / X-01 / History Version history trigger 0 / exhausted Create bookmark group / Add bookmarks to group / Add bookmark dialogs / Expand / Collapse / Add-to-group type / Edit / Done type / Font color / Bold / Italic still behind richTextEditor / Highlighter caret compile-hidden / Counter caret 0.

**Product:** min-viable-diff — one `BookmarksPanel` desktop Delete button `type="button"` (visible names already present; mobile Delete already typed). Isolated 8448 standing. No high-risk file edit. SVG viewBox still owns zoom. `zoomGeneration` untouched. Canvas sizing stays container-aware.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** write another leftover-18 parking note that contradicts the owner-local host-proved set. Did **not** apply `20260820*.sql`. Did **not** click Invite / Send / Manage Team Done / Access Done / Create project / Confirm / Save / Restore / Delete forever / Open file / Share / Upload / Sign out / Delete account / Subscription apply / Templates New entity apply / Delete category / Start trial / **Export annotated PDF** / Version history / Undo / Redo / Pen / Highlighter / Eraser create / Rectangle / Ellipse / Line / Arrow / Counter apply / Callout apply / Font color / Bold / Italic / Color swatch / Fit options apply / Edit zoom percentage / Create bookmark group / Add bookmarks to group / Add bookmark apply / Add bookmark to group apply / Create space / **Delete group / Delete bookmark**.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| Editor Version history page-crash | **Gone.** No ErrorBoundary / `pageerror`. Desktop trigger **0** (cloud-sync footer). Parked — do not stamp `file.id`. |
| Official leftover files after Bookmarks Edit type | **No stale fail vs live source** besides isolated 8448. Official `annotationContextMenuitem` leftover official vs spec Enter is spec-only. |
| X-01 / leftover-18 hosts | **Parked.** Host-proved X-01 / X-05 / U-04 / UL-13 / A-06 / UL-45 stay host-proved. Human-gated A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24 stay parked. |
| PDF AcroForm `name` / `agree` | Forms / X-05 persist stay leftover-18. Idle editor unnamed text+checkbox **2**. |
| Manage Team Activity dialog name | **Not taken.** A-06 roster adjacent. Activity Close type-null stays adjacent. |
| Pages unnamed cards | Unnamed `div`s. Tab-as-switcher — parked. |
| Select-gated All / None / Duplicate / Move/Copy / Restore / Delete forever | Stay behind Select apply. MoveCopy Close / Cancel / Confirm still omit `type="button"`. |
| AccessManagement row actions | Compile-visible type-null — not live on empty SE-011. |
| Settings Delete account | leftover-18 / UL-16. Not taken. |
| Subscription Manage subscription / Usage | Stay behind Subscription tab apply. |
| CreateCategory / Draw / Shapes / Text / Edit text / Zoom / Export / Undo / group chrome / Edit-Done families | **Already proved.** Do not replay. |
| Font color / Bold / Italic / alignment | Compile-visible. Still **0** without richTextEditor. Not taken. |
| Highlighter-caret series | Compile-hidden (`showTextMarkupHighlightMenu = false`). Do not invent a series. |
| Counter-series type-null | Caret **0** on fresh `?testPdf=`. Do not invent a series. |
| Create bookmark group / Add bookmarks to group dialog internals | Compile-visible type-null (Remove / Save / Add new / existing pickers). Exhausted dialogs — do not open. |
| **Delete type** | **This pass.** Outline groups already on `Package 2 - Rev 4 -- IC.pdf`. Before fix live `type` **null**. After fix: Delete bookmark / Delete group typed (`type="button"`); accname stays; Escape + Done dismiss without deleting; implicitSubmit **[]**. |

## Live-proved

Playwright `e2e-bookmark-delete-button-type.spec.mjs` **2 / 2** + hunt `e2e-after-bookmark-delete-button-type-independent-hunt.spec.mjs` **1 / 1**. Pair **3 / 3 (25.2s)** on existing Vite `http://localhost:5173`. Focused Node `bookmarkDeleteButtonType` + hunt + leftover18 **17 / 17**. Official `npm test` fail-stops on pre-existing `annotationContextMenuitem` spec-only Enter (source already has Enter; not taken). Isolated **8448** still standing (not loosened). Live spec opens Bookmarks on outline-seeded Package 2; Expand one group is setup only; clicks Edit only so Deletes appear; inventories type; Escape on rename inputs; Done exits edit mode. Did **not** click Delete. Hunt still opened Documents More / Settings / Get link / Manage Team / New project (`workflowE2E=1` setup) / Share (Access inventory) / Invite (`data-manage-team-invite` inventory only) / Shapes Rectangle arm for Style/Width/Color inventory / Draw arm for Pen/Highlighter/Partial erase inventory / Confirm Delete selected categories (Cancel only) / Create category rail plus (Cancel only) / Bookmarks Edit (inventory only; Done dismiss). Did **not** click Export annotated PDF / Invite / Send / Manage Team Done apply / Access Done apply / Change role / Remove / Resend / View activity / Invite user / Copy email / Restore / Delete forever / Open file / Upload / Sign out / Delete account / Pin / Lock / Get link / Copy / Paste / Delete menuitem apply / Create project / Version history / Undo / Redo / Highlighter / Eraser create / Rectangle / Ellipse / Line / Arrow / Counter apply / Callout apply / Font color / Bold / Italic / Fit options / Edit zoom percentage / Create bookmark group / Add bookmarks to group / Add bookmark apply / Add bookmark to group apply / Delete group / Delete bookmark apply / Save rename.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf`. Outline seeds groups. Expand setup → Edit setup → Delete bookmark / Delete group typed (`type="button"`), accname kept (first **Delete bookmark Door Schedule** + siblings, count **4**), not inside a form. Escape restores rename values. Done exits; Deletes **0**; names kept. implicitSubmit **[]**. Create / Add-bookmarks / Add-bookmark dialogs **0**. Font color / Bold / Italic **0**. Desktop Version history **0**. `file.id` null. viewBox stays `0 0 <w> <h>`. |
| Break | 390 dock Bookmarks: panel Edit / Done **0**; mobile Delete host **0** on empty outline. Empty `clickable-link-test` outline: Edit typed, Delete count **0**. Empty hub / guest / Archive / Projects / Templates: Delete bookmark **0**. Type does not empty accname or auto-delete. Guest after auth Close: Sign in. Hidden tools **0**. Isolated 8448 standing. |
| Edge | `se011.pdf` Delete typed; sibling Delete also typed when present; Escape on rename + Done exits without deleting. Keep-mount stays inert under the viewer. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Isolated 8448 still standing (`8_448 * 1024 * 1024` in source; cap not loosened). `graphify` CLI absent.

## Leftover-18

Host-proved stay host-proved: X-01, X-05, U-04, UL-13, A-06 / UL-45. Still human-gated: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24. Fail-closed local slices stay dedicated. Isolated official **8448** still standing. Cap **8448** / 75/250 not loosened. Do **not** re-claim unblocked GAP = 0.

Hunt after the type: idle editor unnamed text+checkbox remain Forms / X-05; Activity card stays unnamed (A-06 roster adjacent — not taken); Manage Team role trigger stays **0** on creator-only seed; History Version history trigger stays **0** on desktop `?testPdf=`; Highlighter caret stays compile-hidden; Counter caret stays **0** on a fresh `?testPdf=`; official spec Enter stays spec-only; Delete `type` **button**. Settings-open novel names left Delete account (leftover-18 — not taken). Color-open novel names are swatch hex / Hex color / Transparent (C-01 apply not taken). Share-open novel names left Send viewer invite (Send apply parked). Pages unnamed cards stay tab-as-switcher (parked). Documents More menuitem type-null stay behind exhausted Documents More (not taken). Subscription Manage subscription / Usage tabs stay behind Subscription tab apply. MoveCopy Close / Cancel / Confirm still omit `type="button"` (behind Select apply) — next unique leftover that is not leftover-18. Compile-visible AccessManagement row actions still omit `type="button"` — not live on empty SE-011. Create bookmark group / Add bookmarks to group dialog internals still omit `type="button"` — exhausted dialogs, do not open. Font color / Bold / Italic / alignment stay compile-visible but **0** without richTextEditor. Goal stays open.

## Files

- `src/sidebar/BookmarksPanel.jsx`
- `debug/scenarios/e2e-bookmark-delete-button-type.spec.mjs`
- `debug/scenarios/e2e-after-bookmark-delete-button-type-independent-hunt.spec.mjs`
- `tests/bookmarkDeleteButtonType.test.mjs`
- `tests/afterBookmarkDeleteButtonTypeIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

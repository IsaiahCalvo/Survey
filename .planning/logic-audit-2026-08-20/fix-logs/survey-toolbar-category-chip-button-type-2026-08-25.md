# Survey toolbar category chips type=button — 2026-08-25

## Leftover taken

Unique leftover after Manage Team Edit type (`5e7028a3` / product `33316b58`). AuthModal remaining type-null was already live-typed after Close — not replayed. Manage Team Edit All / Change role / Copy email / Remove type, Manage Team Invite/Done/More type, Manage Team search field name, AuthModal Close type, Settings Connect type — not replayed.

Survey sub-toolbar category chips (`#chrome-sub-toolbar-host` Walls / Windows after Two Category Template) omitted `type="button"` (visible names already `aria-label={category.name || 'Untitled category'}`). Live on `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1` after Survey → Two Category Template setup — not leftover-18. Not Survey category-main / arrow (rail). Not Survey Close. Not Create category apply. Not chip arm / marker place. HIGH-RISK `PDFViewer.jsx` min-viable only.

## Product

`310dc92a` — `type="button"` on the survey dropdown category chip `<button>`. Accnames unchanged. Min-viable. HIGH-RISK `src/PDFViewer.jsx`. `npm test` baseline: fail-stops on pre-existing `annotationContextMenuitem` spec-only Enter (source already has Enter — do not align official down). Isolated **8448** standing. Cap **8448** / 75/250 not loosened.

## Proof

- Live Playwright **3 / 3 (22.6s)** on reused Vite `http://localhost:5173`
  - `e2e-survey-toolbar-category-chip-button-type.spec.mjs` 2/2
  - `e2e-after-survey-toolbar-category-chip-button-type-independent-hunt.spec.mjs` 1/1
- Hunt wrap `2e23d81d`: KAL-436 visit is Walls-only (no Windows chip); Windows `type` asserted only when the chip is live. Intended still proves Walls + Windows via Two Category Template.
- Intended: `/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1` → Survey → Two Category Template setup → `#chrome-sub-toolbar-host` Walls / Windows `type="button"`, names unchanged, implicitSubmit **[]**; Escape keeps chips; no chip click / Create category / Delete category / New entity.
- Break/edge: 390 Open survey Two Category sibling typed when chips mount; guest Auth remaining already typed (Sign in submit; Google button); Archive / Documents / Projects / Templates / idle editor chips **0**; viewBox **`0 0 612 792`**. `file.id` null.
- Focused Node **17 / 17**: `surveyToolbarCategoryChipButtonType` + `afterSurveyToolbarCategoryChipButtonTypeIndependentHunt` + `leftover18FailClosed`
- Isolated 8448 standing. Cap 8448 / 75/250 not loosened.
- Official `npm test` still fail-stops on pre-existing `annotationContextMenuitem` spec-only Enter (source already has Enter — do not align official down).

## Did not click

Export annotated PDF / Invite / Send / Create project / Confirm / Save / Restore / Delete forever / Open file / Share / Upload / Sign out / Delete account / Subscription apply / Start trial / Version history / Templates New entity apply / Callout apply / Pen / Highlighter / Eraser create / Rectangle / Ellipse / Line / Arrow / Counter apply / Create category confirm / Delete category / Create bookmark group / Add bookmark apply / Delete group / Delete bookmark / Create space / Export Excel / Sync / Connect / Reconnect / Disconnect / Manage billing / Edit profile apply / Sign in / Create account / Continue with Google / Continue without an account / Forgot password / All / None / Change role / Copy email / Remove from team / View activity / Walls / Windows chips (arm) / New entity / Y/N/N-A.

Did **not** replay Manage Team Edit type, AuthModal Close type, AuthModal remaining type, Manage Team search field name, Settings Connect type, Search text field name, Bookmarks drag grip name, Survey category-main/arrow type, Survey Close type, Bookmarks Delete/Edit/Done/group chrome types, CreateCategoryModal type, Draw/Shapes/Text sub-toolbar types, Edit text type, Zoom/page-nav type, Undo/Redo type, Settings Close/sidebar/Edit profile/Sign out type, Manage Team Invite/Done/More type.

Did **not** take MoveCopy Close/Cancel/Confirm. Did **not** take Activity Close (A-06). Did **not** take Manage Team role trigger (0 on creator-only seed). Did **not** take Survey item Notes (needs placed marker). Did **not** take Spaces expand/delete (Create space apply). Did **not** stamp `file.id`.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm.

- MoveCopy Close / Cancel / Confirm type-null (behind Select apply)
- AccessManagement row Resend/Revoke type-null (empty SE-011)
- Select-gated All / None / Duplicate / Move/Copy / Restore / Delete forever
- Templates move-modal Close; Edit-modules New module type-null (do not open)
- Documents More menuitem type-null
- Subscription Manage / Usage tabs
- Create bookmark group / Add bookmarks to group dialog internals (exhausted — do not open)
- Spaces expand / delete / visibility / region-delete type-null (need Create space)
- Survey item Notes type-null (needs a placed marker)
- C-01 swatch / hex / Transparent apply; Send viewer invite apply
- Font color / Bold / Italic (0 without richTextEditor)
- Highlighter caret compile-hidden; Counter caret 0
- Pages unnamed cards (tab-as-switcher)
- Idle editor unnamed text+checkbox (Forms / X-05 host-proved)
- Activity unnamed / Activity Close type-null (A-06); Manage Team role trigger 0; History Version history trigger 0

AuthModal remaining live actions already typed (Sign in submit; Google / Create an account / Forgot / Continue without button). Settings Disconnect / Reconnect stay **0** without Connect apply. Invite User remaining type-null: none live. AccessManagement remaining LIVE type-null: none. Survey toolbar chips now typed (this pass). Survey category-main / arrow already typed.

Leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45.
Leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24.

Goal stays OPEN. Parent owns PR 800.

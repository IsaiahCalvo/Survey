# Manage Team Edit All / Change role / Copy email / Remove type=button — 2026-08-25

## Leftover taken

AuthModal remaining type-null was scanned first after Close (`e021e71a` / product `1afd7518`). Live `?hubPreview=1&guest=1` already types Sign in (`submit`), Create an account / Continue with Google / Forgot password? / Continue without an account (`button`). Continue with Microsoft **0**. Not replayed.

Unique leftover after AuthModal remaining type: Manage Team Edit-mode All / Change role / Copy email / Remove from team omitted `type="button"` (visible names already present). Live on `?hubPreview=1&tab=projects` after Manage team + Edit setup — not leftover-18. Not AuthModal Close type. Not Manage Team search field name. Not Manage Team Invite / Done / More type. Not MoveCopy Close/Cancel/Confirm. Role trigger stays **0** on creator-only seed (compile-typed). Activity Close stays parked (A-06).

## Product

`33316b58` — `type="button"` on Edit-mode All / ICON_BTN (Change role / Copy email / Remove from team) + compile-sibling role trigger / options. Accnames unchanged. Min-viable. Not a high-risk file.

## Proof

- Live Playwright **3 / 3 (21.4s)** on reused Vite `http://localhost:5173`
  - `e2e-manage-team-edit-button-type.spec.mjs` 2/2
  - `e2e-after-manage-team-edit-button-type-independent-hunt.spec.mjs` 1/1
- Intended: `/?hubPreview=1&tab=projects` → Manage team → Edit setup → All / Change role / Copy email / Remove `type="button"`, names unchanged, implicitSubmit does not include them; Edit-Done + Escape dismiss; no All / Change role / Copy / Remove apply.
- Break/edge: 390 sibling typed then Escape; empty + guest Manage Team **0**; guest Auth remaining already typed (Sign in submit; Google / Forgot / Continue without button); Archive / Documents / Templates Manage Team **0**; editor `?testPdf=clickable-link-test.pdf` Manage Team **0**; viewBox **`0 0 612 792`**. Role trigger **0**. `file.id` null.
- Focused Node **17 / 17**: `manageTeamEditButtonType` + `afterManageTeamEditButtonTypeIndependentHunt` + `leftover18FailClosed`
- Isolated 8448 standing. Cap 8448 / 75/250 not loosened.
- Official `npm test` still fail-stops on pre-existing `annotationContextMenuitem` spec-only Enter (source already has Enter — do not align official down).

## Did not click

Export annotated PDF / Invite / Send / Create project / Confirm / Save / Restore / Delete forever / Open file / Share / Upload / Sign out / Delete account / Subscription apply / Start trial / Version history / Templates New entity apply / Callout apply / Pen / Highlighter / Eraser create / Rectangle / Ellipse / Line / Arrow / Counter apply / Create category confirm / Delete category / Create bookmark group / Add bookmark apply / Delete group / Delete bookmark / Create space / Export Excel / Sync / Connect / Reconnect / Disconnect / Manage billing / Edit profile apply / Sign in / Create account / Continue with Google / Continue without an account / Forgot password / All / None / Change role / Copy email / Remove from team / View activity.

Did **not** replay AuthModal Close type, AuthModal remaining type, Manage Team search field name, Settings Connect type, Search text field name, Bookmarks drag grip name, Survey category-main/arrow type, Survey Close type, Bookmarks Delete/Edit/Done/group chrome types, CreateCategoryModal type, Draw/Shapes/Text sub-toolbar types, Edit text type, Zoom/page-nav type, Undo/Redo type, Settings Close/sidebar/Edit profile/Sign out type, Manage Team Invite/Done/More type.

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
- Activity unnamed (A-06); Manage Team role trigger 0; History Version history trigger 0

AuthModal remaining live actions already typed (Sign in submit; Google / Create an account / Forgot / Continue without button). Settings Disconnect / Reconnect stay **0** without Connect apply. Invite User remaining type-null: none live. AccessManagement remaining LIVE type-null: none.

Leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45.
Leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24.

Goal stays OPEN. Parent owns PR 800.

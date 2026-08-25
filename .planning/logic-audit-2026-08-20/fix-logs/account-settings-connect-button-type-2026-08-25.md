# Account Settings Connect type=button — 2026-08-25

## Leftover taken

Settings remaining unnamed fields were scanned first on live `?hubPreview=1` Account Settings. View mode has no inputs. Edit-mode First name / Last name / Email / New password / Confirm new password are labeled via `htmlFor` (not unnamed). Unique leftover after that scan: Connected services Microsoft / Google **Connect** omitted `type="button"` (visible name already **Connect**; live `type` **null**). Not leftover-18. Not Search text field name. Not MoveCopy Close/Cancel/Confirm. Do **not** click Connect apply (A-02 / MSAL).

## Product

`3c61bbcb` — `type="button"` on Microsoft Disconnect / Connect / Reconnect and Google Connect / Disconnect in `src/components/AccountSettings.jsx`. Min-viable. Not a high-risk file.

## Proof

- Live Playwright **3 / 3 (23.7s)** on reused Vite `http://localhost:5173`
  - `e2e-account-settings-connect-button-type.spec.mjs` 2/2
  - `e2e-after-account-settings-connect-button-type-independent-hunt.spec.mjs` 1/1
- Intended: `/?hubPreview=1` → Open account menu → Settings → Connected services → Connect count **2**, both `type="button"`, accname **Connect**, implicitSubmit **[]**. Focus + Escape dismisses Settings. Did **not** click Connect / Reconnect / Disconnect.
- Break/edge: 390 sibling typed then Escape; empty hub typed then Escape; guest after auth Close: Sign in visible, Open account menu **0**, Connect **0**. Documents / Archive / Templates / Projects idle Connect **0**. Editor `?testPdf=clickable-link-test.pdf` Connect **0**; viewBox **`0 0 612 792`**; Search text field **0**. `text-search-glyph-lab.pdf` Connect **0**. `file.id` null.
- Focused Node **17 / 17**: `accountSettingsConnectButtonType` + `afterAccountSettingsConnectButtonTypeIndependentHunt` + `leftover18FailClosed`
- Isolated 8448 standing. Cap 8448 / 75/250 not loosened.
- Official `npm test` still fail-stops on pre-existing `annotationContextMenuitem` spec-only Enter (source already has Enter — do not align official down).

## Did not click

Export annotated PDF / Invite / Send / Create project / Confirm / Save / Restore / Delete forever / Open file / Share / Upload / Sign out / Delete account / Subscription apply / Start trial / Version history / Templates New entity apply / Callout apply / Pen / Highlighter / Eraser create / Rectangle / Ellipse / Line / Arrow / Counter apply / Create category confirm / Delete category / Create bookmark group / Add bookmark apply / Delete group / Delete bookmark / Create space / Export Excel / Sync / Connect / Reconnect / Disconnect / Manage billing / Edit profile apply.

Did **not** replay Search text field name, Bookmarks drag grip name, Survey category-main/arrow type, Survey Close type, Bookmarks Delete/Edit/Done/group chrome types, CreateCategoryModal type, Draw/Shapes/Text sub-toolbar types, Edit text type, category chrome types, Zoom/page-nav type, Undo/Redo type.

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

Settings remaining unnamed fields: live-scanned this pass — none unique (labeled edit fields; Connect type taken). Subscription Manage / Usage stay parked.

Leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45.
Leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24.

Goal stays OPEN. Parent owns PR 800.

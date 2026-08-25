# Manage Team search field name — 2026-08-25

## Leftover taken

Settings remaining unnamed fields and Disconnect / Reconnect were scanned first (Disconnect / Reconnect **0** without Connect apply). Unique leftover after Settings Connect type: Manage Team filter `<input>` in `src/home/ManageTeamModal.jsx` was placeholder-only (`Find a teammate…`, no `aria-label`). Live on `?hubPreview=1&tab=projects` after Manage team setup — not behind Invite apply. Not leftover-18. Not Search text field name. Not Settings Connect type. Not MoveCopy Close/Cancel/Confirm.

## Product

`a9f7b627` — `aria-label="Find a teammate"` on the Manage Team filter input. Placeholder unchanged. Min-viable. Not a high-risk file.

## Proof

- Live Playwright **3 / 3 (21.5s)** on reused Vite `http://localhost:5173`
  - `e2e-manage-team-search-field-name.spec.mjs` 2/2
  - `e2e-after-manage-team-search-field-name-independent-hunt.spec.mjs` 1/1
- Intended: `/?hubPreview=1&tab=projects` → Manage team → field accname **Find a teammate**, not in a form, focused Escape keeps name, second Escape dismisses. Did **not** fill the field. Did **not** click Invite / Send / Done.
- Break/edge: 390 project drill named then Escape; guest after auth Close: Sign in, field **0**; Archive / Documents / Templates field **0**; editor `?testPdf=clickable-link-test.pdf` field **0**; viewBox **`0 0 612 792`**; Search text field **0**. `text-search-glyph-lab.pdf` field **0**. `file.id` null.
- Focused Node **17 / 17**: `manageTeamSearchFieldName` + `afterManageTeamSearchFieldNameIndependentHunt` + `leftover18FailClosed`
- Isolated 8448 standing. Cap 8448 / 75/250 not loosened.
- Official `npm test` still fail-stops on pre-existing `annotationContextMenuitem` spec-only Enter (source already has Enter — do not align official down).

## Did not click

Export annotated PDF / Invite / Send / Create project / Confirm / Save / Restore / Delete forever / Open file / Share / Upload / Sign out / Delete account / Subscription apply / Start trial / Version history / Templates New entity apply / Callout apply / Pen / Highlighter / Eraser create / Rectangle / Ellipse / Line / Arrow / Counter apply / Create category confirm / Delete category / Create bookmark group / Add bookmark apply / Delete group / Delete bookmark / Create space / Export Excel / Sync / Connect / Reconnect / Disconnect / Manage billing / Edit profile apply.

Did **not** replay Settings Connect type, Search text field name, Bookmarks drag grip name, Survey category-main/arrow type, Survey Close type, Bookmarks Delete/Edit/Done/group chrome types, CreateCategoryModal type, Draw/Shapes/Text sub-toolbar types, Edit text type, category chrome types, Zoom/page-nav type, Undo/Redo type.

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

Settings Disconnect / Reconnect stay **0** without Connect apply. Settings remaining unnamed fields: already live-scanned — none unique.

Leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45.
Leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24.

Goal stays OPEN. Parent owns PR 800.

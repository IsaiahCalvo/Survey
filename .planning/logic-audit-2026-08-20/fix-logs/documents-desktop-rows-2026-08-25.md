# Documents desktop rows — 2026-08-25

## Leftover taken

Unique leftover after Eraser Type caret (`282f583f` / product `c72e52ad`). Last type/name inventory reported unique implicit-submit **[]** and unique unnamed fields **[]**. This leftover was **not** in those catalogs (they scanned `<button>` without type and unnamed fields). Documents desktop ledger rows were clickable `<div>`s with no `role` / `tabIndex`. Mouse opened preview; Tab never reached a row. Distinct from leftover-18, Documents desktop sort headers, Documents More, Archive desktop rows (already `role=button`), 390 `mobile-doc-card` (already `role=button`), Activity File / Edited, MoveCopy Close/Cancel/Confirm, Eraser Type caret, Selection mode caret, Invite accept type, 390 MobileRailNav Escape.

Live on `/?hubPreview=1` at 1400×900. `src/home/DocumentsLedger.jsx` only — role/tabIndex/name/Enter; no PDFViewer.

## Product

`d37f1267` — desktop row is `role="button"` `tabIndex={0}` with `aria-label="Preview {name}"`. Enter/Space preview the row. Double-click still opens the file (not used).

Activity File / Edited stay clickable `<span>`s (need View activity — not taken). Isolated **8448** standing. Cap **8448** / 75/250 not loosened.

## Proof

- Live Playwright **3 / 3 (9.4s)** on reused Vite `http://127.0.0.1:5173`
  - `e2e-documents-desktop-rows.spec.mjs` 2/2
  - `e2e-after-documents-desktop-rows-independent-hunt.spec.mjs` 1/1
- Intended: desktop `/?hubPreview=1` — File stays `type=button`; Preview rows are `role=button`; Tab from Size reaches the first row; second-row click changes the preview filename; Escape keeps that preview (Open file visible, not clicked; Change role / View activity **0**); focused Enter on the first row restores its preview.
- Break/edge: 390 Preview rows **0** (mobile-doc-card stays). empty=1 File button + 0 rows. Archive Name stays `type=button`. Projects / Templates Preview rows **0**. guest Auth Close `button`. invite / reset Preview rows **0**; viewBox **`0 0 612 792`**. `file.id` null. Highlighter caret **0**. Counter caret **0**. Version history **0**. Selection mode stays `type=button`. Eraser Type **0** until Draw setup.
- Focused Node **17 / 17**: `documentsDesktopRows` + `afterDocumentsDesktopRowsIndependentHunt` + `leftover18FailClosed`
- Isolated 8448 standing. Cap 8448 / 75/250 not loosened.
- Official `npm test` still fail-stops on pre-existing `annotationContextMenuitem` spec-only Enter (source already has Enter — do not align official down).

## Did not click

Export annotated PDF / Invite / Send / Create project / Confirm / Save / Restore / Delete forever / Permanently delete / Open file / Share / Upload / Sign out / Delete account / Subscription apply / Start trial / Version history / Templates New entity apply / Callout apply / Pen / Highlighter / Eraser create / Partial erase menuitem / Full stroke erase menuitem / Rectangle / Ellipse / Line / Arrow / Counter apply / Create category confirm / Delete category / Create bookmark group / Add bookmark apply / Delete group / Delete bookmark / Create space / Export Excel / Sync / Connect / Reconnect / Disconnect / Manage billing / Edit profile apply / Sign in / Create account / Continue with Google / Continue without an account / Forgot password / All / None / Change role / Copy email / Remove from team / View activity / Walls / Windows chips / New template / Duplicate / Move/Copy / Rename / Add checklist item apply / Delete item apply / New category / Y/N/N-A / swatch / hex / Transparent / Sign in to continue apply / Back to Survey apply / Documents / Projects / Templates / Archive drawer apply / Select annotations / Select text apply.

Did **not** replay Eraser Type caret, Selection mode caret, Manage Team sort headers, Archive desktop sort headers, Documents desktop sort headers, Eraser Type menuitem names, 390 MobileRailNav Escape, Invite accept type, invite deeplink resolve, AuthModal Close / remaining type, 390 Templates category title name, desktop Templates Click to rename, Projects Tap to rename, Templates checklist item field name, Templates Fill/Border type, Templates checklist chrome type, Templates More trigger type, Templates More menu name, Survey toolbar category chips, Survey category-main/arrow type, Survey Close type, CreateCategoryModal type, Manage Team Edit type, Manage Team search field name, Settings Connect type, Search text field name, Bookmarks drag grip name.

Did **not** take MoveCopy Close/Cancel/Confirm. Did **not** take Activity Close (A-06). Did **not** take Activity File / Edited sort spans (need View activity). Did **not** take Manage Team role trigger (0). Did **not** take Survey item Notes. Did **not** take Spaces expand/delete (Create space apply). Did **not** take Documents More menuitem type-null. Did **not** take Templates MoreMenu menuitem type-null. Did **not** stamp `file.id`.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited.

- **Projects desktop project rows** — clickable `<div>`s with no `role` / `tabIndex` (`src/home/ProjectsFolderTree.jsx` ~L977); mouse opens the project; Tab never reaches the row. Live on `/?hubPreview=1&tab=projects` (not Open file).
- **Projects desktop file rows** — same class; click opens the file (do-not-click Open file)
- **Activity File / Edited** — clickable `<span>` sorts (`src/home/ManageTeamModal.jsx` ~L144); same class; live only after View activity (do-not-click)
- MoveCopy Close / Cancel / Confirm type-null (behind Select apply)
- AccessManagement row Resend/Revoke type-null (empty SE-011)
- Select-gated All / None / Duplicate / Move/Copy / Restore / Delete forever
- Templates move-modal Close; Edit-modules New module type-null (do not open)
- Documents More menuitem type-null; Templates MoreMenu menuitem type-null (same parked class)
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
- Desktop archived Permanently delete type-null (not live — hubPreview seed has no archived items without Delete-item / Archive apply)
- Desktop dirty Cancel / Save type-null (not live without a working-copy edit apply)
- Edit-modules Search modules field unnamed (do not open Edit-modules)
- Module-tab rename `<input>` unnamed (only after double-click rename — do not open)
- ResetPasswordPage success-phase Back to Survey type-null (not live without a recovery-session success)
- Manage Team edit-mode row checkbox `<span>` (select-gated; do not click All / Edit apply)

AuthModal remaining live actions already typed (Sign in submit; Google / Create an account / Forgot / Continue without button). Settings Disconnect / Reconnect stay **0** without Connect apply. Invite User remaining type-null: none live. AccessManagement remaining LIVE type-null: none. Survey toolbar chips already typed. Survey category-main / arrow already typed. Templates More triggers already typed. Templates checklist Add / Delete already typed. Templates entity color Fill / Border already typed. Templates checklist item fields already named. 390 Templates category titles already named. Desktop category titles stay Click to rename. Invite accept CTAs now typed. 390 hub rail nav Escape now dismisses. Documents desktop sort headers now buttons. Archive desktop sort headers now buttons. Manage Team Users / Role / Added now buttons. Selection mode caret now a button. Eraser Type caret now a button. Documents desktop rows now buttons (this pass).

Leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45.
Leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24.

Goal stays OPEN. Parent owns PR 800.

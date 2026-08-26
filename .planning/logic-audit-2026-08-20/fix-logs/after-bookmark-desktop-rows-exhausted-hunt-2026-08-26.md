# Hunt after Bookmarks desktop rows — 2026-08-26

## Leftover taken

**None.** Real hunt after `69f883f3` / product `e2b4fe20`. Did not invent a leftover. Goal stays OPEN.

Did **not** replay Bookmarks desktop rows, Search result rows, Templates/Projects/Documents desktop rows, sort headers, Eraser Type caret, Selection mode caret, or Bookmarks Expand/Edit/Delete/grip. Did **not** take Projects desktop file rows (Open file). Did **not** take Activity File / Edited. Did **not** take MoveCopy Close/Cancel/Confirm. HIGH-RISK files not touched. Did **not** stamp `file.id`.

## Hunt (live + source)

Reused Vite `http://127.0.0.1:5173`. Source scan of clickable `<div>`/`<span>` without `role`/`tabIndex`, nested `role="button"` without `tabIndex` (**0**), implicit-submit `<button>` without `type`, title-only grips/fields, and Escape no-ops. Live Playwright inventory of the same surfaces. Did not click parked applies.

| Surface | Opened | Unique leftover |
|---|---|---|
| `/?hubPreview=1` Documents | default tab | implicit **[]**; unnamed **[]**; Preview rows stay `role=button`; File `type=button` |
| `/?hubPreview=1&tab=projects` desktop | URL tab | implicit **[]**; unnamed **[]**; Open project rows stay `role=button`; **file rows** stay clickable `<div>`s with no `role`/`tabIndex` (Open file — **not taken**) |
| `/?hubPreview=1&tab=templates` + Security Walk-Through | open template, no apply | implicit **[]**; unnamed **[]**; Open template rows stay `role=button`; category titles stay Click to rename |
| `/?hubPreview=1&tab=archive` | URL tab | implicit **[]**; unnamed **[]**; Name `type=button`; desktop rows already `role=button` |
| `/?hubPreview=1` @ 390 | default rail | implicit **[]**; unnamed **[]**; Escape already dismisses MobileRailNav; Preview rows **0** |
| `/?hubPreview=1&tab=projects` @ 390 | URL tab | implicit **[]**; unnamed **[]**; drill folder rows already `role=button`; `mobile-project-card` **0** (`cards` layout never set — dead) |
| `/invite/leftover-type-probe` | guest invite | Sign in to continue already `button`; implicit **[]** |
| `/?hubPreview=1&guest=1` | AuthModal | Close `button`; Sign in `submit`; implicit **[]** |
| `/reset-password` | no recovery apply | success Back to Survey **not live** |
| Settings (account menu) | open Settings, Escape | implicit **[]**; unnamed **[]**; Disconnect / Reconnect **0**; Subscription tabs not opened |
| Manage Team | open from Projects, Escape | remaining LIVE type-null none; role trigger **0**; Activity File / Edited **0** (need View activity) |
| `/?testPdf=clickable-link-test.pdf` idle editor | Draw visible | implicit **[]**; unnamed text+checkbox (Forms / X-05 parked); highlighter / counter caret **0**; Version history **0**; `file.id` not stamped; viewBox **`0 0 612 792`** |
| Pages | open Pages tab | unnamed cards stay tab-as-switcher (parked) |
| Spaces | open Spaces tab | Expand **0** (need Create space) |
| Search | fill `the` setup only | Jump to match rows stay `role=button`; implicit **[]** |
| Bookmarks | Package 2 outline | Jump/Select rows stay `role=button`; implicit **[]** |
| Survey | Two Category / Existing | Close `type=button`; Notes **0**; Spaces expand **0** |

Source scan of reachable hub / Settings / Templates / Archive / Documents / Projects / Survey / Spaces / Search / Bookmarks / Invite / Share / Auth / Pages: remaining clickable `<div>`s Tab cannot reach are Projects file rows (Open file), Activity File / Edited (View activity), Pages unnamed cards (parked), Spaces header/toggle (Create space), CreateCategoryModal option cards (New category — do not open), Templates category rows (select-gated), `mobile-project-card` (dead `cards` layout). Nested `role="button"` without `tabIndex`: **0**. Implicit-submit unique **[]** on live unparked chrome. Title-only Projects More has `type=button` + title accname — not taken. Share/Settings/Auth/Manage Team already own Escape. Official `annotationContextMenuitem` leftover official vs spec Enter is not stale vs live source (source already has Enter — not taken). Isolated **8448** still standing.

## Did not click

Export annotated PDF / Invite / Send / Create project / Confirm / Save / Restore / Delete forever / Permanently delete / Open file / Share / Upload / Sign out / Delete account / Subscription apply / Start trial / Version history / Templates New entity apply / Callout apply / Pen / Highlighter / Eraser create / Partial erase menuitem / Full stroke erase menuitem / Rectangle / Ellipse / Line / Arrow / Counter apply / Create category confirm / Delete category / Create bookmark group / Add bookmark apply / Add bookmark to group apply / Delete group / Delete bookmark / Expand group / Edit / Done / Create space / Export Excel / Sync / Connect / Reconnect / Disconnect / Manage billing / Edit profile apply / Sign in / Create account / Continue with Google / Continue without an account / Forgot password / All / None / Change role / Copy email / Remove from team / View activity / Walls / Windows chips / New template / Duplicate / Move/Copy / Rename / Add checklist item apply / Delete item apply / New category / Y/N/N-A / swatch / hex / Transparent / Sign in to continue apply / Back to Survey apply / Documents / Projects / Templates / Archive drawer apply / Select annotations / Select text apply / Manage team / New project apply / file rows / Select apply / Previous match / Next match / Clear search apply.

Did **not** replay Bookmarks desktop rows, Search result rows, Search Clear / field name / Previous/Next type, Templates desktop template rows, Projects desktop project rows, Documents desktop rows, Documents/Archive/Manage Team sort headers, Eraser Type caret, Selection mode caret, 390 MobileRailNav Escape, Invite accept type, invite deeplink resolve, AuthModal Close / remaining type, Bookmarks Expand/Edit/Delete/grip name/type.

Did **not** take MoveCopy Close/Cancel/Confirm. Did **not** take Activity Close (A-06). Did **not** take Activity File / Edited sort spans (need View activity). Did **not** take Projects desktop file rows (Open file). Did **not** take Manage Team role trigger (0). Did **not** take Survey item Notes. Did **not** take Spaces expand/delete (Create space apply). Did **not** take Documents More menuitem type-null. Did **not** take Templates MoreMenu menuitem type-null. Did **not** stamp `file.id`.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm. Do **not** take Activity File / Edited. Do **not** take Projects file rows.

- **Projects desktop file rows** — clickable `<div>`s with no `role` / `tabIndex` (`src/home/ProjectsFolderTree.jsx` ~L1187); mouse opens the file (do-not-click Open file). Live on `/?hubPreview=1&tab=projects`.
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
- Desktop archived Permanently delete type-null (not live without Delete-item / Archive apply)
- Desktop dirty Cancel / Save type-null (not live without a working-copy edit apply)
- Edit-modules Search modules field unnamed (do not open Edit-modules)
- Module-tab rename `<input>` unnamed (only after double-click rename — do not open)
- ResetPasswordPage success-phase Back to Survey type-null (not live without a recovery-session success)
- Manage Team edit-mode row checkbox `<span>` (select-gated; do not click All / Edit apply)
- CreateCategoryModal option cards (need New category — do not open)
- `mobile-project-card` (dead — `mobileProjectLayout` stays `'drill'`; no setter)

AuthModal remaining live actions already typed (Sign in submit; Google / Create an account / Forgot / Continue without button). Settings Disconnect / Reconnect stay **0** without Connect apply. Invite User remaining type-null: none live. AccessManagement remaining LIVE type-null: none. Survey toolbar chips already typed. Survey category-main / arrow already typed. Templates More triggers already typed. Templates checklist Add / Delete already typed. Templates entity color Fill / Border already typed. Templates checklist item fields already named. 390 Templates category titles already named. Desktop category titles stay Click to rename. Invite accept CTAs now typed. 390 hub rail nav Escape now dismisses. Documents desktop sort headers now buttons. Archive desktop sort headers now buttons. Manage Team Users / Role / Added now buttons. Selection mode caret now a button. Eraser Type caret now a button. Documents desktop rows now buttons. Projects desktop project rows now buttons. Templates desktop template rows now buttons. Search result rows now buttons. Bookmarks desktop rows now buttons.

Leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45.
Leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24.

Goal stays OPEN. Parent owns PR 800.

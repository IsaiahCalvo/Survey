# Hunt after exhausted Bookmarks-desktop-rows hunt — 2026-08-26

## Leftover taken

**None.** Real hunt after tip `cc9245d6` / product `e2b4fe20`. Did not invent a leftover. Goal stays OPEN.

Did **not** replay Bookmarks desktop rows, Search result rows, Templates/Projects/Documents desktop rows, sort headers, Eraser Type caret, Selection mode caret, or Bookmarks Expand/Edit/Delete/grip. Did **not** take Projects desktop file rows (Open file). Did **not** take Activity File / Edited. Did **not** take MoveCopy Close/Cancel/Confirm. Did **not** take Templates category rows (select-gated). Did **not** take Pages unnamed cards. Did **not** take hub Search `⌘K` (display-only, classified 2026-08-22). Did **not** take overlay Ctrl+O (Electron File menu). HIGH-RISK files not touched. Did **not** stamp `file.id`.

## Hunt (live + source)

Reused Vite `http://127.0.0.1:5173` (HTTP 200). Source scan of clickable `<div>`/`<span>` without `role`/`tabIndex`, nested `role="button"` without `tabIndex`, implicit-submit `<button>` without `type`, title-only grips/fields, Escape no-ops, overlay-listed shortcuts, and hub Search `⌘K`. Live Playwright inventory of the same surfaces plus Keyboard shortcuts overlay, Settings, Pages, Spaces, Search (fill `the` only), Bookmarks (Package 2), Survey. Did not click parked applies.

| Surface | Opened | Unique leftover |
|---|---|---|
| `/?hubPreview=1` Documents | default tab | implicit **[]**; unnamed **[]**; Preview rows stay `role=button`; File `type=button`; Search named; `⌘K` display-only (Ctrl/Meta+K leaves BODY) |
| `/?hubPreview=1&tab=projects` desktop | URL tab | implicit **[]**; unnamed file input only; Open project rows stay `role=button`; **file rows** stay clickable `<div>`s with no `role`/`tabIndex` (Open file — **not taken**) |
| `/?hubPreview=1&tab=templates` | URL tab | implicit **[]**; unnamed **[]**; Open template rows stay `role=button`; category "2 items" rows stay select-gated (**not taken**) |
| `/?hubPreview=1&tab=archive` | URL tab | implicit **[]**; unnamed **[]**; Name `type=button`; Restore / Delete forever **0** |
| `/?hubPreview=1` @ 390 | default rail | implicit **[]**; unnamed **[]**; Escape already dismisses MobileRailNav |
| `/?hubPreview=1&tab=projects` @ 390 | URL tab | implicit **[]**; unnamed file input only; drill folder rows already `role=button`; `mobile-project-card` **0** |
| `/invite/leftover-type-probe` | guest invite | Sign in to continue already `button`; implicit **[]** |
| `/?hubPreview=1&guest=1` | AuthModal | Close `button`; Sign in `submit`; Password requirements **0** (empty field); implicit **[]** |
| `/reset-password` | no recovery apply | success Back to Survey **not live** |
| Settings (account menu) | open Settings, Escape | implicit **[]**; unnamed **[]**; Disconnect / Reconnect **0**; Usage / Manage tabs **0** (not opened) |
| Manage Team | open from Projects, Escape | remaining LIVE type-null none; role trigger **0**; Activity File / Edited **0** |
| `/?testPdf=clickable-link-test.pdf` idle editor | Draw visible | implicit **[]**; unnamed file inputs only; highlighter / counter caret **0**; Version history **0**; sync chip **0**; `file.id` not stamped; viewBox **`0 0 612 792`** |
| Keyboard shortcuts `?` | open overlay | dialog **1**; Escape dismisses; listed chords already dedicated (P2-34) |
| Pages | open Pages tab | unnamed cards stay tab-as-switcher (parked); card `role`/`tabIndex` null |
| Spaces | open Spaces tab | Expand **0**; Create space visible (**not clicked**) |
| Search | fill `the` setup only | Jump to match rows stay `role=button`; implicit **[]** |
| Bookmarks | Package 2 outline | Jump/Select rows stay `role=button`; implicit **[]** |
| Survey | Two Category / Existing | Close `type=button`; Notes **0**; Spaces expand **0** |

Source scan of reachable hub / Settings / Templates / Archive / Documents / Projects / Survey / Spaces / Search / Bookmarks / Invite / Share / Auth / Pages: remaining clickable `<div>`s Tab cannot reach are Projects file rows (Open file), Activity File / Edited (View activity), Pages unnamed cards (parked), Spaces header/toggle (Create space), CreateCategoryModal option cards (New category — do not open), Templates category rows (select-gated), `mobile-project-card` (dead `cards` layout). Nested `role="button"` without `tabIndex`: **0**. Implicit-submit unique **[]** on live unparked chrome. Hidden `<input type="file">` unnamed is upload plumbing, not a unique leftover. Hub Search `⌘K` stays display-only (already classified 2026-08-22). Official `annotationContextMenuitem` leftover official vs spec Enter is not stale vs live source (source already has Enter — not taken). Isolated **8448** still standing.

## Audit IDs checked (still proven; none live-unfixed on this host)

KB-1, KB-2, P1-01…P1-55, P2-01…P2-39, P2-34(a–c), P2-35(a–c). Inventory status remains **96 proved / 0 stomped / 0 weak / 0 missing**. Stomp one-liners P1-12 / P1-38 / P1-53 still live in tree. SQL apply leftovers stay in-tree (not applied). Did **not** write a 103-ID completion-audit refresh (no new product SHA).

## Did not click

Export annotated PDF / Invite / Send / Create project / Confirm / Save / Restore / Delete forever / Permanently delete / Open file / Share / Upload / Sign out / Delete account / Subscription apply / Start trial / Version history / Templates New entity apply / Callout apply / Pen / Highlighter / Eraser create / Partial erase menuitem / Full stroke erase menuitem / Rectangle / Ellipse / Line / Arrow / Counter apply / Create category confirm / Delete category / Create bookmark group / Add bookmark apply / Add bookmark to group apply / Delete group / Delete bookmark / Expand group / Edit / Done / Create space / Export Excel / Sync / Connect / Reconnect / Disconnect / Manage billing / Edit profile apply / Sign in / Create account / Continue with Google / Continue without an account / Forgot password / All / None / Change role / Copy email / Remove from team / View activity / Walls / Windows chips / New template / Duplicate / Move/Copy / Rename / Add checklist item apply / Delete item apply / New category / Y/N/N-A / swatch / hex / Transparent / Sign in to continue apply / Back to Survey apply / Documents / Projects / Templates / Archive drawer apply / Select annotations / Select text apply / Manage team / New project apply / file rows / Select apply / Previous match / Next match / Clear search apply.

Did **not** replay Bookmarks desktop rows, Search result rows, Search Clear / field name / Previous/Next type, Templates desktop template rows, Projects desktop project rows, Documents desktop rows, Documents/Archive/Manage Team sort headers, Eraser Type caret, Selection mode caret, 390 MobileRailNav Escape, Invite accept type, invite deeplink resolve, AuthModal Close / remaining type, Bookmarks Expand/Edit/Delete/grip name/type.

Did **not** take MoveCopy Close/Cancel/Confirm. Did **not** take Activity Close (A-06). Did **not** take Activity File / Edited sort spans (need View activity). Did **not** take Projects desktop file rows (Open file). Did **not** take Manage Team role trigger (0). Did **not** take Survey item Notes. Did **not** take Spaces expand/delete (Create space apply). Did **not** take Documents More menuitem type-null. Did **not** take Templates MoreMenu menuitem type-null. Did **not** take hub Search `⌘K`. Did **not** stamp `file.id`.

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
- Hub Search `⌘K` (display-only; classified 2026-08-22)

Leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45.
Leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24.

Focused Node leftover18FailClosed **12 / 12**. Isolated **8448** still standing. Cap **8448** / 75/250 not loosened.

Goal stays OPEN. Parent owns PR 800.

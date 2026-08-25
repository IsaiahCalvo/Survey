# 390 hub rail nav Escape — 2026-08-25

## Leftover taken

Unique leftover after Invite accept CTA type (`1bb71c3a` / product `60ea5225`). Invite accept type, invite deeplink resolve, AuthModal Close / remaining type, 390 Templates category title name, desktop Templates Click to rename, Projects Tap to rename, Templates checklist item field name, Templates Fill/Border type, Templates checklist chrome type, Templates More trigger type, Templates More menu name — not replayed. Documents More menuitem type-null stays parked. Templates MoreMenu menuitem type-null stays parked.

390 hub `MobileRailNav` open drawer ignored Escape (profile menu already dismissed; Archive filter / Documents More already use `DismissBarrier`). Live on `/?hubPreview=1` at 390 — default rail, not leftover-18. Not Invite accept type. Not AuthModal Close. HIGH-RISK files not touched.

## Product

`ef12af44` — Escape listener on `MobileRailNav` closes the drawer. Visible names unchanged. Min-viable. `src/home/HubShell.jsx`. Isolated **8448** standing. Cap **8448** / 75/250 not loosened.

## Proof

- Live Playwright **3 / 3 (9.3s)** on reused Vite `http://127.0.0.1:5173`
  - `e2e-mobile-rail-nav-escape.spec.mjs` 2/2
  - `e2e-after-mobile-rail-nav-escape-independent-hunt.spec.mjs` 1/1
- Intended: 390 `/?hubPreview=1` → Open navigation opens Mobile navigation; Escape dismisses; Documents tab stays; no Documents / Projects / Templates / Archive drawer apply.
- Break/edge: desktop Open navigation **0**; 390 `mobileNav=tabs` **0**; idle editor **0**; invite Sign in to continue `button`; reset-password Back to Survey **0**; viewBox **`0 0 612 792`**. `file.id` null.
- Focused Node **17 / 17**: `mobileRailNavEscape` + `afterMobileRailNavEscapeIndependentHunt` + `leftover18FailClosed`
- Isolated 8448 standing. Cap 8448 / 75/250 not loosened.
- Official `npm test` still fail-stops on pre-existing `annotationContextMenuitem` spec-only Enter (source already has Enter — do not align official down).

## Did not click

Export annotated PDF / Invite / Send / Create project / Confirm / Save / Restore / Delete forever / Open file / Share / Upload / Sign out / Delete account / Subscription apply / Start trial / Version history / Templates New entity apply / Callout apply / Pen / Highlighter / Eraser create / Rectangle / Ellipse / Line / Arrow / Counter apply / Create category confirm / Delete category / Create bookmark group / Add bookmark apply / Delete group / Delete bookmark / Create space / Export Excel / Sync / Connect / Reconnect / Disconnect / Manage billing / Edit profile apply / Sign in / Create account / Continue with Google / Continue without an account / Forgot password / All / None / Change role / Copy email / Remove from team / View activity / Walls / Windows chips / New template / Duplicate / Move/Copy / Rename / Add checklist item apply / Delete item apply / New category / Y/N/N-A / swatch / hex / Transparent / Sign in to continue apply / Back to Survey apply / Documents / Projects / Templates / Archive drawer apply.

Did **not** replay Invite accept type, invite deeplink resolve, AuthModal Close / remaining type, 390 Templates category title name, desktop Templates Click to rename, Projects Tap to rename, Templates checklist item field name, Templates Fill/Border type, Templates checklist chrome type, Templates More trigger type, Templates More menu name, Survey toolbar category chips, Survey category-main/arrow type, Survey Close type, CreateCategoryModal type, Manage Team Edit type, Manage Team search field name, Settings Connect type, Search text field name, Bookmarks drag grip name.

Did **not** take MoveCopy Close/Cancel/Confirm. Did **not** take Activity Close (A-06). Did **not** take Manage Team role trigger (0 on creator-only seed). Did **not** take Survey item Notes (needs placed marker). Did **not** take Spaces expand/delete (Create space apply). Did **not** take Documents More menuitem type-null. Did **not** take Templates MoreMenu menuitem type-null. Did **not** stamp `file.id`.

## Hunt remaining unique leftovers (NOT leftover-18)

Almost all gated. Do **not** take MoveCopy Close/Cancel/Confirm.

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

AuthModal remaining live actions already typed (Sign in submit; Google / Create an account / Forgot / Continue without button). Settings Disconnect / Reconnect stay **0** without Connect apply. Invite User remaining type-null: none live. AccessManagement remaining LIVE type-null: none. Survey toolbar chips already typed. Survey category-main / arrow already typed. Templates More triggers already typed. Templates checklist Add / Delete already typed. Templates entity color Fill / Border already typed. Templates checklist item fields already named. 390 Templates category titles already named. Desktop category titles stay Click to rename. Invite accept CTAs now typed. 390 hub rail nav Escape now dismisses (this pass).

Leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45.
Leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24.

Goal stays OPEN. Parent owns PR 800.

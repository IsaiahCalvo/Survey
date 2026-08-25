# Templates More trigger type=button — 2026-08-25

## Leftover taken

Unique leftover after Survey toolbar category chips (`96d2b3b4` / product `310dc92a`). Survey toolbar chips, Survey category-main/arrow, Survey Close, CreateCategoryModal type — not replayed. Templates More *menu name* is exhausted — not replayed. Documents More menuitem type-null stays parked — MoreMenu menuitems not typed.

Templates list / entity / 390 list More triggers omitted `type="button"` (visible names already `title="More"` + `aria-label="More"`). Live on `?hubPreview=1&tab=templates` — not leftover-18. Not Projects More type. Not Documents More trigger type. Not Select apply. 390 entity More was already typed. HIGH-RISK files not touched.

## Product

`09ff9c83` — `type="button"` on the three remaining TemplatesEditor More triggers (desktop list, desktop entity, 390 list). Accnames unchanged. Min-viable. `src/home/TemplatesEditor.jsx`. Isolated **8448** standing. Cap **8448** / 75/250 not loosened.

## Proof

- Live Playwright **3 / 3 (11.7s)** on reused Vite `http://127.0.0.1:5173`
  - `e2e-templates-more-button-type.spec.mjs` 2/2
  - `e2e-after-templates-more-button-type-independent-hunt.spec.mjs` 1/1
- Intended: `/?hubPreview=1&tab=templates` → Security Walk-Through More `type="button"`, name unchanged, implicitSubmit More **[]**; click opens `Security Walk-Through actions`; Escape dismisses; GC entity More typed; no Share / Delete / Duplicate / Move/Copy / Rename apply.
- Break/edge: 390 list More typed; empty More **0**; guest after auth Close still typed; Documents / Archive / Projects / idle editor Templates More **0**; viewBox **`0 0 612 792`**. `file.id` null.
- Focused Node **17 / 17**: `templatesMoreButtonType` + `afterTemplatesMoreButtonTypeIndependentHunt` + `leftover18FailClosed`
- Isolated 8448 standing. Cap 8448 / 75/250 not loosened.
- Official `npm test` still fail-stops on pre-existing `annotationContextMenuitem` spec-only Enter (source already has Enter — do not align official down).

## Did not click

Export annotated PDF / Invite / Send / Create project / Confirm / Save / Restore / Delete forever / Open file / Share / Upload / Sign out / Delete account / Subscription apply / Start trial / Version history / Templates New entity apply / Callout apply / Pen / Highlighter / Eraser create / Rectangle / Ellipse / Line / Arrow / Counter apply / Create category confirm / Delete category / Create bookmark group / Add bookmark apply / Delete group / Delete bookmark / Create space / Export Excel / Sync / Connect / Reconnect / Disconnect / Manage billing / Edit profile apply / Sign in / Create account / Continue with Google / Continue without an account / Forgot password / All / None / Change role / Copy email / Remove from team / View activity / Walls / Windows chips / New template / Duplicate / Move/Copy / Rename / Y/N/N-A.

Did **not** replay Survey toolbar category chips, Survey category-main/arrow type, Survey Close type, CreateCategoryModal type, Templates More menu name, Projects More type, Documents More trigger type, Manage Team Edit type, AuthModal Close type, AuthModal remaining type, Manage Team search field name, Settings Connect type, Search text field name, Bookmarks drag grip name.

Did **not** take MoveCopy Close/Cancel/Confirm. Did **not** take Activity Close (A-06). Did **not** take Manage Team role trigger (0 on creator-only seed). Did **not** take Survey item Notes (needs placed marker). Did **not** take Spaces expand/delete (Create space apply). Did **not** take Documents More menuitem type-null. Did **not** stamp `file.id`.

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

AuthModal remaining live actions already typed (Sign in submit; Google / Create an account / Forgot / Continue without button). Settings Disconnect / Reconnect stay **0** without Connect apply. Invite User remaining type-null: none live. AccessManagement remaining LIVE type-null: none. Survey toolbar chips already typed. Survey category-main / arrow already typed. Templates More triggers now typed (this pass).

Leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45.
Leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24.

Goal stays OPEN. Parent owns PR 800.

# Search text field name — 2026-08-25

## Leftover taken

Search query `<input>` in `src/sidebar/SearchTextPanel.jsx` was placeholder-only (`Search text in PDF...` desktop / `Search text` 390). Sibling Clear search / Previous match / Next match already had `aria-label`. Not leftover-18. Not Bookmarks drag grip (already named). Not MoveCopy Close/Cancel/Confirm.

## Product

`ad0c9a13` — `aria-label="Search text in PDF"` on the Search query input. Placeholder unchanged. Min-viable. Not a high-risk file.

## Proof

- Live Playwright **3 / 3 (22.8s)** on Vite `http://localhost:5173`
  - `e2e-search-text-field-name.spec.mjs` 2/2
  - `e2e-after-search-text-field-name-independent-hunt.spec.mjs` 1/1
- Intended: `/?testPdf=clickable-link-test.pdf` → Search tab → field accname **Search text in PDF**, not in a form, Escape keeps name, Clear **0**. Did **not** fill a query. Did **not** click Previous/Next.
- Break/edge: 390 dock Search named (placeholder still `Search text`); hub / guest / Archive / Projects / Templates field **0**; `text-search-glyph-lab.pdf` + `se011.pdf` named after Search tab; keep-mount inert.
- Focused Node **17 / 17**: `searchTextFieldName` + `afterSearchTextFieldNameIndependentHunt` + `leftover18FailClosed`
- Isolated 8448 standing. Cap 8448 / 75/250 not loosened.
- Official `npm test` still fail-stops on pre-existing `annotationContextMenuitem` spec-only Enter (source already has Enter — do not align official down).

## Did not click

Export annotated PDF / Invite / Send / Create project / Confirm / Save / Restore / Delete forever / Open file / Share / Upload / Sign out / Delete account / Subscription apply / Start trial / Version history / Templates New entity apply / Callout apply / Pen / Highlighter / Eraser create / Rectangle / Ellipse / Line / Arrow / Counter apply / Create category confirm / Delete category / Create bookmark group / Add bookmark apply / Delete group / Delete bookmark / Create space / Export Excel / Sync.

Did **not** replay Bookmarks drag grip name, Survey category-main/arrow type, Survey Close type, Bookmarks Delete/Edit/Done/group chrome types, CreateCategoryModal type, Draw/Shapes/Text sub-toolbar types, Edit text type, category chrome types, Zoom/page-nav type, Undo/Redo type.

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
- Settings remaining unnamed fields (if any live unique)

Leftover-18 host-proved stay parked: X-01, X-05, U-04, UL-13, A-06 / UL-45.
Leftover-18 human-gated stay parked: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24.

Goal stays OPEN. Parent owns PR 800.

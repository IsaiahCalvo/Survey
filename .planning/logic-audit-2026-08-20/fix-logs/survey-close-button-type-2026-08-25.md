# Survey Close type=button — 2026-08-25

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `234c2e54` docs: record Bookmarks Delete type live 3/3 (25.2s).  
**Product:** `aba3fd4b` Survey header Close Survey panel `type="button"`  
**Prove:** this-pass intended + break + edge + hunt  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Version history crash did not reproduce; desktop Version history trigger stays **0** on `?testPdf=` (`cloudSync: false`). Did **not** stamp `file.id`. Did **not** replay Bookmarks Delete type. Did **not** replay Bookmarks Edit / Done type. Did **not** replay Bookmarks Expand / Collapse / Add-to-group type. Did **not** replay CreateCategoryModal type. Did **not** replay Draw/Shapes/Text sub-toolbar types. Did **not** replay Edit text type. Did **not** replay Zoom/page-nav type. Did **not** replay Export/Draw/Shapes/Text category type. Did **not** replay Undo/Redo type. Did **not** take leftover-18. Font color / Bold / Italic stay **0** without richTextEditor. Unique leftover after Bookmarks Delete type: Survey header Close Survey panel omitted `type="button"` (visible name already present). Live `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1` Two Category Template pick is setup only so the header Close appears. Type only. Escape keeps the panel open (rail, not a dialog). Close dismisses without applying Create category / Export / Sync. Did **not** click Create category confirm. Did **not** click Export Excel / Sync Microsoft 365. Did **not** take MoveCopy Close / Cancel / Confirm (still behind Select apply). Did **not** open Create bookmark group / Add bookmarks to group / Add bookmark dialogs.

Looked beyond leftover-18 / History Version history trigger 0 / Bookmarks Delete type / Bookmarks Edit / Done type / Bookmarks group chrome type / CreateCategoryModal type / Draw sub-toolbar type / Shapes sub-toolbar type / sub-toolbar Text / Callout type / Edit text type / Zoom / page-nav type / Export / Draw / Shapes / Text category type / Undo / Redo type / Manage Team More type / Manage Team Invite type / AccessManagement Invite type / AccessManagement Close type / AccessManagement dialog name / CreateProjectModal Close name / Confirm Cancel/Confirm type / Rename Cancel/Save type / Rename Close name / Projects More type / Archive Show documents name / Account Settings Sign out type / Edit profile type / sidebar tabs type / Close type.

Official leftover files besides isolated 8448 do not still fail vs live source after Survey Close `type="button"`. Official `annotationContextMenuitem` leftover official vs spec Enter is **not** stale vs live source (source already has Enter; spec-only — not taken). Isolated **8448** still standing. Cap **8448** / 75/250 not loosened.

Unique leftover: Survey header Close Survey panel omitted `type="button"`. Same a11y *type* class as Settings Close / Access Close / Collapse Survey panel, new host (expanded Survey header X). Distinct from leftover-18 / X-01 / History Version history trigger 0 / exhausted Create bookmark group / Add bookmarks to group / Add bookmark dialogs / Bookmarks Delete type / Edit / Done type / Expand / Collapse / Add-to-group type / CreateCategoryModal type / Font color / Bold / Italic still behind richTextEditor / Highlighter caret compile-hidden / Counter caret 0.

**Product:** min-viable-diff — one `SurveySpacesRail` header Close button `type="button"` (visible name already present; mobile backdrop + picker Close + Collapse / Expand already typed). Isolated 8448 standing. No high-risk file edit. SVG viewBox still owns zoom. `zoomGeneration` untouched. Canvas sizing stays container-aware.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** write another leftover-18 parking note that contradicts the owner-local host-proved set. Did **not** apply `20260820*.sql`. Did **not** click Invite / Send / Manage Team Done / Access Done / Create project / Confirm / Save / Restore / Delete forever / Open file / Share / Upload / Sign out / Delete account / Subscription apply / Templates New entity apply / Delete category / Start trial / **Export annotated PDF** / Version history / Undo / Redo / Pen / Highlighter / Eraser create / Rectangle / Ellipse / Line / Arrow / Counter apply / Callout apply / Font color / Bold / Italic / Color swatch / Fit options apply / Edit zoom percentage / Create bookmark group / Add bookmarks to group / Add bookmark apply / Add bookmark to group apply / Create space / Delete group / Delete bookmark / **Create category confirm** / **Export Excel** / **Sync Microsoft 365**.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| Editor Version history page-crash | **Gone.** No ErrorBoundary / `pageerror`. Desktop trigger **0** (cloud-sync footer). Parked — do not stamp `file.id`. |
| Official leftover files after Bookmarks Delete type | **No stale fail vs live source** besides isolated 8448. Official `annotationContextMenuitem` leftover official vs spec Enter is spec-only. |
| X-01 / leftover-18 hosts | **Parked.** Host-proved X-01 / X-05 / U-04 / UL-13 / A-06 / UL-45 stay host-proved. Human-gated A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24 stay parked. |
| PDF AcroForm `name` / `agree` | Forms / X-05 persist stay leftover-18. Idle editor unnamed text+checkbox **2**. |
| Manage Team Activity dialog name | **Not taken.** A-06 roster adjacent. Activity Close type-null stays adjacent. |
| Pages unnamed cards | Unnamed `div`s. Tab-as-switcher — parked. |
| Select-gated All / None / Duplicate / Move/Copy / Restore / Delete forever | Stay behind Select apply. MoveCopy Close / Cancel / Confirm still omit `type="button"`. |
| AccessManagement row actions | Compile-visible type-null — not live on empty SE-011. |
| Settings Delete account | leftover-18 / UL-16. Not taken. |
| Subscription Manage subscription / Usage | Stay behind Subscription tab apply. |
| Bookmarks Delete / Edit-Done / group chrome / CreateCategory / Draw / Shapes / Text / Edit text / Zoom / Export / Undo families | **Already proved.** Do not replay. |
| Create bookmark group / Add bookmarks to group dialog internals | Compile-visible type-null. Exhausted dialogs — do not open. |
| Font color / Bold / Italic / alignment | Compile-visible. Still **0** without richTextEditor. Not taken. |
| Highlighter-caret series | Compile-hidden (`showTextMarkupHighlightMenu = false`). Do not invent a series. |
| Counter-series type-null | Caret **0** on fresh `?testPdf=`. Do not invent a series. |
| **Close Survey panel type** | **This pass.** Two Category Template setup on `surveyTransitionE2E=1`. Before fix live `type` **null**. After fix: header Close typed (`type="button"`); accname stays; Escape keeps rail; Close dismisses without Create category / Export apply; implicitSubmit **[]**. |

## Live-proved

Playwright `e2e-survey-close-button-type.spec.mjs` **2 / 2** + hunt `e2e-after-survey-close-button-type-independent-hunt.spec.mjs` **1 / 1**. Pair **3 / 3 (21.6s)** on existing Vite `http://localhost:5173`. Focused Node `surveyCloseButtonType` + hunt + leftover18FailClosed **17 / 17**. Official `npm test` fail-stops on pre-existing `annotationContextMenuitem` spec-only Enter (source already has Enter; not taken). Isolated **8448** still standing (not loosened). Live spec opens Survey on `surveyTransitionE2E=1`; Two Category Template pick is setup only; inventories type; Escape keeps the panel; Close dismisses. Did **not** click Create category confirm. Hunt still opened Documents More / Settings / Get link / Manage Team / New project (`workflowE2E=1` setup) / Share (Access inventory) / Invite (`data-manage-team-invite` inventory only) / Shapes Rectangle arm for Style/Width/Color inventory / Draw arm for Pen/Highlighter/Partial erase inventory / Confirm Delete selected categories (Cancel only) / Create category rail plus (Cancel only) / Bookmarks Edit (inventory only; Done dismiss) / Survey KAL-436 (Close inventory only; Excel actions Escape). Did **not** click Export annotated PDF / Invite / Send / Manage Team Done apply / Access Done apply / Change role / Remove / Resend / View activity / Invite user / Copy email / Restore / Delete forever / Open file / Upload / Sign out / Delete account / Pin / Lock / Get link / Copy / Paste / Delete menuitem apply / Create project / Version history / Undo / Redo / Highlighter / Eraser create / Rectangle / Ellipse / Line / Arrow / Counter apply / Callout apply / Font color / Bold / Italic / Fit options / Edit zoom percentage / Create bookmark group / Add bookmarks to group / Add bookmark apply / Add bookmark to group apply / Delete group / Delete bookmark apply / Save rename / Create category confirm / Export Excel / Sync Microsoft 365.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Survey → Two Category Template setup. Close Survey panel typed (`type="button"`), accname **Close Survey panel**, not inside a form. Collapse sibling stays typed. Escape keeps Walls/Windows. Close dismisses; Create category dialog **0**; Walls gone. implicitSubmit **[]**. Font color / Bold / Italic **0**. Desktop Version history **0**. `file.id` null. viewBox stays `0 0 612 792`. |
| Break | 390 Open survey: picker Close already typed; after Two Category Template sheet Close typed; Create category plus **0**. Empty hub / guest / Archive / Projects / Templates / idle `clickable-link-test`: Close Survey panel **0**. Type does not empty accname or auto-create a category. Guest after auth Close: Sign in. Hidden tools **0**. Isolated 8448 standing. |
| Edge | Keep-mount stays inert under the viewer. Template-picker (no template yet) header Close **0** until a template is picked. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Isolated 8448 still standing (`8_448 * 1024 * 1024` in source; cap not loosened). `graphify` CLI absent.

## Leftover-18

Host-proved stay host-proved: X-01, X-05, U-04, UL-13, A-06 / UL-45. Still human-gated: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24. Fail-closed local slices stay dedicated. Isolated official **8448** still standing. Cap **8448** / 75/250 not loosened. Do **not** re-claim unblocked GAP = 0.

Hunt after the type: idle editor unnamed text+checkbox remain Forms / X-05; Activity card stays unnamed (A-06 roster adjacent — not taken); Manage Team role trigger stays **0** on creator-only seed; History Version history trigger stays **0** on desktop `?testPdf=`; Highlighter caret stays compile-hidden; Counter caret stays **0** on a fresh `?testPdf=`; official spec Enter stays spec-only; Close Survey panel `type` **button**. Settings-open novel names left Delete account (leftover-18 — not taken). Color-open novel names are swatch hex / Hex color / Transparent (C-01 apply not taken). Share-open novel names left Send viewer invite (Send apply parked). Pages unnamed cards stay tab-as-switcher (parked). Documents More menuitem type-null stay behind exhausted Documents More (not taken). Subscription Manage subscription / Usage tabs stay behind Subscription tab apply. MoveCopy Close / Cancel / Confirm still omit `type="button"` (behind Select apply). Compile-visible AccessManagement row actions still omit `type="button"` — not live on empty SE-011. Create bookmark group / Add bookmarks to group dialog internals still omit `type="button"` — exhausted dialogs, do not open. Survey category-main / category-arrow still omit `type="button"` after a template pick — next unique leftover that is not leftover-18. Bookmarks drag grip stays tip-only without `aria-label`. Font color / Bold / Italic / alignment stay compile-visible but **0** without richTextEditor. Goal stays open.

## Files

- `src/SurveySpacesRail.jsx`
- `debug/scenarios/e2e-survey-close-button-type.spec.mjs`
- `debug/scenarios/e2e-after-survey-close-button-type-independent-hunt.spec.mjs`
- `tests/surveyCloseButtonType.test.mjs`
- `tests/afterSurveyCloseButtonTypeIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

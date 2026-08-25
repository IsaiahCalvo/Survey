# Desktop Draw sub-toolbar type=button — 2026-08-25

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `97ea3ef2` docs: record desktop Shapes sub-toolbar type live 3/3 (16.9s).  
**Product:** `6a65117b` desktop PDFViewer draw-category Pen / Highlighter / Partial erase `type="button"`  
**Prove:** `bebdf056` intended + break + edge + this-pass hunt  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Version history crash did not reproduce; desktop trigger stays **0** on `?testPdf=` (`cloudSync: false`). Did **not** stamp `file.id`. Did **not** replay Shapes sub-toolbar type. Did **not** replay sub-toolbar Text / Callout type. Did **not** replay Edit text type. Did **not** replay Zoom/page-nav type. Did **not** replay Export/Draw/Shapes/Text category type. Did **not** replay Undo/Redo type. Did **not** take leftover-18. Unique leftover after Shapes sub-toolbar type: desktop PDFViewer draw-category sub-toolbar Pen / Highlighter / Partial erase omitted `type="button"` (visible names already present; mobile RailButton siblings already typed). Live `?testPdf=clickable-link-test.pdf` Draw sub-toolbar tools `type` **button** after Draw-category setup. Font color / Bold / Italic stay **0** without entering rich-text edit. Highlighter caret stays **0** (compile-hidden). Counter caret stays **0**.

Looked beyond leftover-18 / History Version history trigger 0 / Shapes sub-toolbar type / sub-toolbar Text / Callout type / Edit text type / Zoom / page-nav type / Export / Draw / Shapes / Text category type / Undo / Redo type / Manage Team More type / Manage Team Invite type / AccessManagement Invite type / AccessManagement Close type / AccessManagement dialog name / CreateProjectModal Close name / Confirm Cancel/Confirm type / Rename Cancel/Save type / Rename Close name / Projects More type / Archive Show documents name / Account Settings Sign out type / Edit profile type / sidebar tabs type / Close type / Projects desktop file Select type / Projects 390 file Select type / Projects desktop Select type / Projects 390 Select type / Documents Select type / Archive Select type / Archive Close preview type / Documents Preview Share type / Open file type / Close preview type / Documents Upload type / Manage team type / Category drag-title type / Entity Select type / Template-list Select type / Category Select type / Module Select type / New module name / New module type / Module count chrome / Category drag titles name / Edit color type / New entity type / New category type / Entity name / Projects Tap to rename / New template type / Templates Expand / Templates Click to rename / Drag to rearrange / Click to rename.

Official leftover files besides isolated 8448 do not still fail vs live source after Draw sub-toolbar `type="button"`. Official `annotationContextMenuitem` leftover official vs spec Enter is **not** stale vs live source (source already has Enter; spec-only — not taken). Isolated **8448** still standing. Cap **8448** / 75/250 not loosened.

Unique leftover: desktop PDFViewer draw-category sub-toolbar Pen / Highlighter / Partial erase omitted `type="button"`. Same a11y *type* class as Shapes / Text / Callout / Edit text / Export / Draw / Undo / Redo / Zoom / page-nav. Distinct from leftover-18 / X-01 / History Version history trigger 0 / exhausted Draw *category* type / mobile RailButton already typed / Font color / Bold / Italic still behind richTextEditor / Highlighter caret compile-hidden / Counter caret 0.

**Product:** min-viable-diff — desktop draw-category Pen + Highlighter + Partial erase `type="button"` (visible names already present). Isolated 8448 standing. High-risk `PDFViewer.jsx` one-line type only. SVG viewBox still owns zoom. `zoomGeneration` untouched. Canvas sizing stays container-aware.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** write another leftover-18 parking note that contradicts the owner-local host-proved set. Did **not** apply `20260820*.sql`. Did **not** click Invite / Send / Done / Create project / Confirm / Save / Restore / Delete forever / Open file / Share / Upload / Sign out / Delete account / Subscription apply / Templates New entity apply / Delete category / Start trial / **Export annotated PDF** / Version history / Undo / Redo / Highlighter / Eraser create / Rectangle / Ellipse / Line / Arrow / Counter apply / Callout apply / Font color / Bold / Italic / Color swatch / Fit options apply / Edit zoom percentage. Draw category click is setup only. Sub-toolbar Pen click is type-edge only (no auto-create).

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| Editor Version history page-crash | **Gone.** No ErrorBoundary / `pageerror`. Desktop trigger **0** (cloud-sync footer). Parked — do not stamp `file.id`. |
| Official leftover files after Shapes sub-toolbar type | **No stale fail vs live source** besides isolated 8448. Official `annotationContextMenuitem` leftover official vs spec Enter is spec-only. |
| X-01 / leftover-18 hosts | **Parked.** Host-proved X-01 / X-05 / U-04 / UL-13 / A-06 / UL-45 stay host-proved. Human-gated A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24 stay parked. |
| PDF AcroForm `name` / `agree` | Forms / X-05 persist stay leftover-18. Idle editor unnamed text+checkbox **2**. |
| Manage Team Activity dialog name | **Not taken.** A-06 roster adjacent. Activity Close type-null stays adjacent. |
| Pages unnamed cards | Unnamed `div`s. Tab-as-switcher — parked. |
| Select-gated All / None / Duplicate / Move/Copy / Restore / Delete forever | Stay behind Select apply. MoveCopy Close / Cancel / Confirm still omit `type="button"`. |
| AccessManagement row actions | Compile-visible type-null — not live on empty SE-011. |
| Settings Delete account | leftover-18 / UL-16. Not taken. |
| Subscription Manage subscription / Usage | Stay behind Subscription tab apply. |
| Shapes sub-toolbar type | **Already proved.** Do not replay. |
| Sub-toolbar Text / Callout type | **Already proved.** Do not replay. |
| Edit text type | **Already proved.** Do not replay. |
| Zoom / page-nav type | **Already proved.** Do not replay. |
| Export / Draw / Shapes / Text category type | **Already proved.** Do not replay. |
| Undo / Redo type | **Already proved.** Do not replay. |
| Font color / Bold / Italic / alignment | Compile-visible. Still **0** after Draw arm without richTextEditor / C-01. Not taken. |
| Highlighter-caret series | Compile-hidden (`showTextMarkupHighlightMenu = false`). Do not invent a series. |
| Counter-series type-null | Caret **0** on fresh `?testPdf=`. Do not invent a series. |
| **Desktop Draw sub-toolbar type** | **This pass.** Before fix live `type` **null** after Draw arm. After fix: Pen / Highlighter / Partial erase typed (`type="button"`); accname stays; Pen click does not auto-create; armed implicitSubmit does not include those three. |

## Live-proved

Playwright `e2e-draw-sub-toolbar-button-type.spec.mjs` **2 / 2** + hunt `e2e-after-draw-sub-toolbar-button-type-independent-hunt.spec.mjs` **1 / 1**. Pair **3 / 3 (16.8s)** on existing Vite `http://localhost:5173`. Focused Node `drawSubToolbarButtonType` + hunt + leftover18 **17 / 17**. Official `npm test` fail-stops on pre-existing `annotationContextMenuitem` spec-only Enter (source already has Enter; not taken). Isolated **8448** still standing (not loosened). Live spec clicks Draw category as setup only; clicks sub-toolbar Pen as type-edge (annotation count unchanged). Hunt still opened Documents More / Settings / Get link / Manage Team / New project (`workflowE2E=1` setup) / Share (Access inventory) / Invite (`data-manage-team-invite` inventory only) / Shapes Rectangle arm for Style/Width/Color inventory / Draw arm for Pen/Highlighter/Partial erase inventory. Did **not** click Export annotated PDF / Invite / Send / Done / Change role / Remove / Resend / View activity / Invite user / Copy email / Restore / Delete forever / Open file / Upload / Sign out / Delete account / Pin / Lock / Get link / Copy / Paste / Delete menuitem apply / Create project / Version history / Undo / Redo / Highlighter / Eraser create / Rectangle / Ellipse / Line / Arrow / Counter apply / Callout apply / Font color / Bold / Italic / Fit options / Edit zoom percentage.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `/?testPdf=clickable-link-test.pdf`. Idle sub-toolbar Pen / Highlighter / Partial erase **0**. After Draw arm: all three typed (`type="button"`), accname kept, not inside a form. Armed implicitSubmit does not include those three. Sub-toolbar Pen click does not auto-create. Font color / Bold / Italic **0**. Desktop Version history **0**. Highlighter caret **0**. Counter caret **0**. `file.id` null. viewBox **`0 0 612 792`**. Sub-toolbar host stays visible. |
| Break | Empty hub / guest / Documents / Archive / Projects / Templates: desktop Draw sub-toolbar tools **0**. Type does not empty accname or auto-create. Guest after auth Close: Sign in. Hidden tools **0**. Isolated 8448 standing. |
| Edge | 390 desktop Draw sub-toolbar tools **0**; mobile Pen sibling already typed in source. Mobile Version history exists disabled (do not stamp `file.id`). Keep-mount stays inert under the viewer. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

High-risk file edit was one `type="button"` on the draw-category button. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Isolated 8448 still standing (`8_448 * 1024 * 1024` in source; cap not loosened). `graphify` CLI absent.

## Leftover-18

Host-proved stay host-proved: X-01, X-05, U-04, UL-13, A-06 / UL-45. Still human-gated: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24. Fail-closed local slices stay dedicated. Isolated official **8448** still standing. Cap **8448** / 75/250 not loosened. Do **not** re-claim unblocked GAP = 0.

Hunt after the type: idle editor unnamed text+checkbox remain Forms / X-05; Activity card stays unnamed (A-06 roster adjacent — not taken); Manage Team role trigger stays **0** on creator-only seed; History Version history trigger stays **0** on desktop `?testPdf=`; Highlighter caret stays compile-hidden; Counter caret stays **0** on a fresh `?testPdf=`; official spec Enter stays spec-only; desktop Pen / Highlighter / Partial erase `type` **button**. Draw-armed implicitSubmit stays **[]**. Settings-open novel names left Delete account (leftover-18 — not taken). Color-open novel names are swatch hex / Hex color / Transparent (C-01 apply not taken). Share-open novel names left Send viewer invite (Send apply parked). Pages unnamed cards stay tab-as-switcher (parked). Documents More menuitem type-null stay behind exhausted Documents More (not taken). Subscription Manage subscription / Usage tabs stay behind Subscription tab apply. MoveCopy Close / Cancel / Confirm still omit `type="button"` (behind Select apply). Compile-visible AccessManagement row actions still omit `type="button"` — not live on empty SE-011. Font color / Bold / Italic / alignment stay compile-visible but **0** without richTextEditor. Goal stays open.

## Files

- `src/PDFViewer.jsx`
- `debug/scenarios/e2e-draw-sub-toolbar-button-type.spec.mjs`
- `debug/scenarios/e2e-after-draw-sub-toolbar-button-type-independent-hunt.spec.mjs`
- `tests/drawSubToolbarButtonType.test.mjs`
- `tests/afterDrawSubToolbarButtonTypeIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

# Desktop Export / Draw / Shapes / Text type=button — 2026-08-25

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `48462550` docs: record desktop Undo/Redo type live 3/3 (17.3s).  
**Product:** `6a57bddc` desktop AppShell Export / Draw / Shapes / Text `type="button"` (Pan / Select same-toolbar siblings)  
**Prove:** `c56078ee` / `7b685c23` intended + break + edge + this-pass hunt  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Version history crash did not reproduce; desktop trigger stays **0** on `?testPdf=` (`cloudSync: false`). Did **not** stamp `file.id`. Did **not** replay Undo/Redo type. Did **not** take leftover-18. Unique leftover after Undo / Redo type: desktop Export / Draw / Shapes / Text omitted `type="button"` (visible names already present; mobile RailButton siblings already typed).

Looked beyond leftover-18 / History Version history trigger 0 / Undo / Redo type / Manage Team More type / Manage Team Invite type / AccessManagement Invite type / AccessManagement Close type / AccessManagement dialog name / CreateProjectModal Close name / Confirm Cancel/Confirm type / Rename Cancel/Save type / Rename Close name / Projects More type / Archive Show documents name / Account Settings Sign out type / Edit profile type / sidebar tabs type / Close type / Projects desktop file Select type / Projects 390 file Select type / Projects desktop Select type / Projects 390 Select type / Documents Select type / Archive Select type / Archive Close preview type / Documents Preview Share type / Open file type / Close preview type / Documents Upload type / Manage team type / Category drag-title type / Entity Select type / Template-list Select type / Category Select type / Module Select type / New module name / New module type / Module count chrome / Category drag titles name / Edit color type / New entity type / New category type / Entity name / Projects Tap to rename / New template type / Templates Expand / Templates Click to rename / Drag to rearrange / Click to rename.

Official leftover files besides isolated 8448 do not still fail vs live source after Export / Draw / Shapes / Text `type="button"`. Official `annotationContextMenuitem` leftover official vs spec Enter is **not** stale vs live source (source already has Enter; spec-only — not taken). Isolated **8448** still standing. Cap **8448** / 75/250 not loosened.

Unique leftover: desktop AppShell Export / Draw / Shapes / Text omitted `type="button"`. Same a11y *type* class as Undo / Redo / Fill / Border / Search Previous-Next. Distinct from leftover-18 / X-01 / History Version history trigger 0 / mobile RailButton Draw / Shapes / Text already typed / mobile More-menu Export already typed / Undo / Redo type already proved.

**Product:** min-viable-diff — desktop Export + Draw + Shapes + Text `type="button"` (visible names already present). Pan / Select typed as the same reachable toolbar siblings. Isolated 8448 standing. No high-risk file edit.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** write another leftover-18 parking note that contradicts the owner-local host-proved set. Did **not** apply `20260820*.sql`. Did **not** click Invite / Send / Done / Create project / Confirm / Save / Restore / Delete forever / Open file / Share / Upload / Sign out / Delete account / Subscription apply / Templates New entity apply / Delete category / Start trial / **Export annotated PDF** / Version history / Undo / Redo / Pen / Rectangle / Callout apply.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| Editor Version history page-crash | **Gone.** No ErrorBoundary / `pageerror`. Desktop trigger **0** (cloud-sync footer). Parked — do not stamp `file.id`. |
| Official leftover files after Undo / Redo type | **No stale fail vs live source** besides isolated 8448. Official `annotationContextMenuitem` leftover official vs spec Enter is spec-only. |
| X-01 / leftover-18 hosts | **Parked.** Host-proved X-01 / X-05 / U-04 / UL-13 / A-06 / UL-45 stay host-proved. Human-gated A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24 stay parked. |
| PDF AcroForm `name` / `agree` | Forms / X-05 persist stay leftover-18. Idle editor unnamed text+checkbox **2**. |
| Manage Team Activity dialog name | **Not taken.** A-06 roster adjacent. Activity Close type-null stays adjacent. |
| Pages unnamed cards | Unnamed `div`s. Tab-as-switcher — parked. |
| Select-gated All / None / Duplicate / Move/Copy / Restore / Delete forever | Stay behind Select apply. MoveCopy Close / Cancel / Confirm still omit `type="button"`. |
| AccessManagement row actions | Compile-visible type-null — not live on empty SE-011. |
| Settings Delete account | leftover-18 / UL-16. Not taken. |
| Subscription Manage subscription / Usage | Stay behind Subscription tab apply. |
| Undo / Redo type | **Already proved.** Do not replay. |
| **Desktop Export / Draw / Shapes / Text type** | **This pass.** Before fix live `type` **null**. After fix: Export / Draw / Shapes / Text `type="button"`; accname stays; chrome implicitSubmit does not include them; Draw / Shapes / Text still open Pen / Rectangle / Callout menus. Export stays typed without being clicked. |

## Live-proved

Playwright `e2e-export-draw-shapes-text-button-type.spec.mjs` **2 / 2 (4.7s)** + hunt `e2e-after-export-draw-shapes-text-button-type-independent-hunt.spec.mjs` **1 / 1 (9.3s)**. Pair **3 / 3 (15.0s)** on existing Vite `http://localhost:5173`. Focused Node `exportDrawShapesTextButtonType` + hunt + leftover18 **17 / 17**. Live spec clicks Draw / Shapes / Text only to open menus (Pen / Rectangle / Callout visible; those create-tools not clicked). Hunt still opened Documents More / Settings / Get link / Manage Team / New project (`workflowE2E=1` setup) / Share (Access inventory) / Invite (`data-manage-team-invite` inventory only) for leftover inventory. Did **not** click Export annotated PDF / Invite / Send / Done / Change role / Remove / Resend / View activity / Invite user / Copy email / Restore / Delete forever / Open file / Upload / Sign out / Delete account / Pin / Lock / Get link / Copy / Paste / Delete menuitem apply / Create project / Version history / Undo / Redo / Pen / Rectangle / Callout apply.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `/?testPdf=clickable-link-test.pdf`. Export / Draw / Shapes / Text typed (`type="button"`), accname kept, not inside a form. Pan / Select same-toolbar siblings typed. Draw opens Pen; Shapes opens Rectangle; Text opens Callout. Export stays typed without being clicked. Chrome implicitSubmit does not include Export / Draw / Shapes / Text / Pan / Select. Desktop Version history **0**. `file.id` null. |
| Break | Empty hub / guest / Documents / Archive / Projects / Templates: desktop Export / Draw **0**. Type does not empty accname or auto-submit / export. Guest after auth Close: Sign in. Hidden tools **0**. Isolated 8448 standing. |
| Edge | 390 uses mobile RailButton Draw / Shapes / Text (already `type="button"`); desktop Export / Draw cluster **0**. Mobile Version history exists disabled (do not stamp `file.id`). viewBox **`0 0 612 792`**. Style / Width / Color / Opacity idle **0**. Keep-mount stays inert under the viewer. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` not required this pass (AppShell is not a high-risk file). Isolated 8448 still standing (`8_448 * 1024 * 1024` in source; cap not loosened). `graphify` CLI absent.

## Leftover-18

Host-proved stay host-proved: X-01, X-05, U-04, UL-13, A-06 / UL-45. Still human-gated: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24. Fail-closed local slices stay dedicated. Isolated official **8448** still standing. Cap **8448** / 75/250 not loosened. Do **not** re-claim unblocked GAP = 0.

Hunt after the type: idle editor unnamed text+checkbox remain Forms / X-05; Activity card stays unnamed (A-06 roster adjacent — not taken); Manage Team role trigger stays **0** on creator-only seed; History Version history trigger stays **0** on desktop `?testPdf=`; Highlighter caret stays compile-hidden; Counter caret stays **0** on a fresh `?testPdf=`; official spec Enter stays spec-only; desktop Export `type` **button** + accname **Export annotated PDF**; desktop Draw / Shapes / Text `type` **button**; Pan / Select `type` **button**. Desktop Zoom in / Zoom out / Previous page / Next page still omit `type="button"` (next unique leftovers that are not leftover-18). Settings-open novel names left Delete account (leftover-18 — not taken). Color-open novel names are swatch hex / Hex color / Transparent (C-01 apply not taken). Share-open novel names left Send viewer invite (Send apply parked). Pages unnamed cards stay tab-as-switcher (parked). Documents More menuitem type-null stay behind exhausted Documents More (not taken). Subscription Manage subscription / Usage tabs stay behind Subscription tab apply. MoveCopy Close / Cancel / Confirm still omit `type="button"` (behind Select apply). Compile-visible AccessManagement row actions still omit `type="button"` — not live on empty SE-011. Goal stays open.

## Files

- `src/AppShell.jsx`
- `debug/scenarios/e2e-export-draw-shapes-text-button-type.spec.mjs`
- `debug/scenarios/e2e-after-export-draw-shapes-text-button-type-independent-hunt.spec.mjs`
- `tests/exportDrawShapesTextButtonType.test.mjs`
- `tests/afterExportDrawShapesTextButtonTypeIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

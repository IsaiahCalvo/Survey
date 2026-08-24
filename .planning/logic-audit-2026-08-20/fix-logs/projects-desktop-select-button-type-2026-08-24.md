# Projects desktop Select type=button — 2026-08-24

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `787f4596` docs: record Projects 390 Select type live 3/3 (13.5s).  
**Product:** `c55f8339` `ProjectsFolderTree` desktop header Select `type="button"`  
**Prove:** `c8be79ce` intended + break + edge + this-pass hunt  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Last hunt named Projects desktop Select type. Did **not** take leftover-18 or exhausted slices. Looked beyond Projects 390 Select type / Documents Select type / Archive Select type / Archive Close preview type / Documents Preview Share type / Documents Preview Open file type / Documents Close preview type / Documents Upload type / Manage team type / Category drag-title type / Entity Select type / Template-list Select type / Category Select type / Module Select type / New module name / New module type / Module count chrome / Category drag titles name / Edit color type / New entity type / New category type / Entity name / Projects Tap to rename / New template type / Templates Expand / Templates Click to rename / Drag to rearrange / Click to rename. Different axis:

1. Official leftover files vs live source after Projects 390 Select `type="button"` (NOT isolated 8448). Overlay-mount / spacesRail / popover / hub nav / Sync / Settings / Confirm / CreateCategory / KeyboardShortcuts / Access / Edit modules labelledby / Manage Team / Selection Mode / Eraser Type / Documents More / Archive Show and sort / Templates More / Projects More / Documents mobile Sort / Projects file-row More / Spaces export / Survey export / Create bookmark group / Add bookmarks to group / Add bookmark / Search clear / Color picker / Width picker / Style picker / Opacity slider / Share Permission / Invite User role / Fill / Border type / Search Previous-Next type / Share-open hub chrome / Invite-open Edit / Click to rename / Drag to rearrange / Templates Click to rename / Templates Expand / New template / Projects Tap to rename / Entity name / New category / New entity / Edit color / Category drag titles name / Module count chrome / New module type / New module name / Module Select type / Category Select type / Template-list Select type / Entity Select type / Category drag-title type / Manage team type / Documents Upload type / Documents Close preview type / Documents Preview Open file type / Documents Preview Share type / Archive Close preview type / Archive Select type / Documents Select type / Projects 390 Select type already match live compile-visible code. Isolated **8448** (`partialEraserComplexity` `8_448 * 1024 * 1024`) still standing — not loosened. Official `annotationContextMenuitem` leftover official vs spec Enter is **not** stale vs live source (`useAnnotationContextMenu.jsx` already has `e.key === 'Enter' || e.key === ' '`; spec-only leftover, not taken).
2. Compile-visible chrome that is NOT leftover-18 and NOT the exhausted Projects 390 Select type family.
3. Live Projects on `/?hubPreview=1&tab=projects` at desktop viewport (not 390). Header Select had a visible name (`Select`) but omitted `type="button"` (live `type` **null** before the type). Hosted on the Projects tab at desktop without clicking Select apply. Select apply / All / None / Duplicate / Move/Copy / Upload apply / Open file apply / Share apply / Close preview apply not taken.

Unique leftover: last hunt left Projects desktop Select omitted `type="button"`. Same a11y *type* class as Projects 390 / Documents / Archive / Entity / Template-list / Category / Module Select, new host (`ProjectsFolderTree` desktop header Select). Distinct from leftover-18 / X-01 / Activity dialog name / Manage Team role picker / Documents Share Access apply / Style-Width dismiss / remapped opacity apply / C-01 swatch apply / Font color / V-08 Next-Previous apply / Search clear name / Search Previous-Next type / Fill / Border type / Invite User role name / Share Permission name / Opacity slider name / Style picker name / Width picker name / Color picker name / Share-open hub chrome type / Invite-open Edit type / Click to rename name / Drag to rearrange name / Templates Click to rename name / Templates Expand name / New template type / Projects Tap to rename name / Entity name name / New category type / New entity type / Edit color type / Category drag titles name / Module count chrome name / New module type / New module name / Module Select type / Category Select type / Template-list Select type / Entity Select type / Category drag-title type / Manage team type / Documents Upload type / Documents Close preview type / Documents Preview Open file type / Documents Preview Share type / Archive Close preview type / Archive Select type / Documents Select type / Projects 390 Select type / nameless-menu hosts already proved / unnamed-dialog family already proved / remapped-after-CW / dismiss / rail-toggle / dest-XYZ.

**Product:** min-viable-diff — `ProjectsFolderTree` desktop header Select `type="button"`. Isolated 8448 standing. Cap **8448** / 75/250 not loosened. No high-risk file edit.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** name Activity. Did **not** apply Select / New module / New category / New entity / Edit color / Entity name / Templates rename / Share / Delete / Drag to rearrange / Click to rename / Edit / Send / Copy / Add files / New project / New template apply / Upload / Pin / Lock / Delete / Previous / Next apply / Create group apply / Add bookmarks apply / Create bookmark apply / EXPORT / Open linked / Update existing / Export Excel / Sync / CSV / PDF Pages apply / color swatches / Width presets apply / Style options apply / Opacity apply / Fill / Border / hex / Transparent. Did **not** apply module edits. Did **not** open Edit-modules. Did **not** drag-apply category reorder. Did **not** click Manage team apply. Did **not** click Upload apply / pick a file. Did **not** click Close preview apply. Did **not** click Open file / Share apply. Did **not** apply archive restore/delete. Hunt still opened Manage Team / Invite / Documents More to inventory next leftovers.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| Official leftover files after Projects 390 Select type | **No stale fail vs live source** besides isolated 8448. Official `annotationContextMenuitem` leftover official vs spec Enter is spec-only — source already has Enter. |
| X-01 / leftover-18 hosts | **Parked.** Process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| PDF AcroForm `name` / `agree` | Forms / X-05 persist stay leftover-18. Idle editor unnamed text+checkbox **2**. |
| PromptModal lock / NewColumnsModal | leftover-18 / X-01 / X-06. Not taken. |
| Manage Team Activity dialog name | **Not taken.** A-06 roster adjacent. Do not invent a roster host. |
| Manage Team role picker | hubPreview creator-only seed — `data-kal31-role-trigger` **0**. Not taken. |
| Pages unnamed cards | Unnamed `div`s (`data-page-number`, no role). Tab-as-switcher / context — parked. |
| Exhausted nameless-menu / unnamed-dialog / type-name families | Do not replay. Documents More menuitem type-null (Rename / Share / Lock document in the open named menu) stays behind exhausted Documents More — not taken. |
| Select-gated All / None / Duplicate / Move/Copy / Restore / Delete forever | Stay behind Select apply. Not taken. |
| Edit-modules New module type | Dialog already named. Type-null host not opened. |
| **Projects desktop Select type** | **This pass.** Before fix live `type` **null**. After fix: desktop header Select `type="button"`; Escape does not apply select; name unchanged. |

## Live-proved

Playwright `e2e-projects-desktop-select-button-type.spec.mjs` **2 / 2** + hunt `e2e-after-projects-desktop-select-button-type-independent-hunt.spec.mjs` **1 / 1**. Pair **3 / 3 (12.8s)** on Playwright Vite `http://127.0.0.1:5173`. Focused Node `projectsDesktopSelectButtonType` + hunt + leftover18 **17 / 17**. Live spec does not click Select apply. Live spec does not click Upload / Open file / Share / Close preview apply. Live spec does not apply archive restore/delete.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `/?hubPreview=1&tab=projects` at 1400. Header Select typed (`type="button"`) and still named. Focus + Escape does not apply select. All / None / Duplicate / Move/Copy **0**. |
| Break | 390 desktop Select stays typed in the hidden desktop layout. Empty Select still typed. Guest still typed after auth-modal Close. Documents / Archive / Templates Projects desktop Select **0**. Hidden tools **0**. `file.id` null. Isolated 8448 standing. |
| Edge | Guest still typed after auth-modal Close (not captcha / A-01). Search fixture idle **0**. Style / Width / Color / Opacity idle **0**. Version history **0**. viewBox **`0 0 612 792`**. Editor host does not keep-mount Projects — accessible Projects desktop Select **0**. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` not required this pass. Isolated 8448 still standing. Cap **8448** / 75/250 not loosened. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

Hunt after the type: idle editor unnamed text+checkbox remain Forms / X-05; Activity card stays unnamed (A-06 roster adjacent — not taken); Manage Team role trigger stays **0** on creator-only seed; Highlighter caret stays compile-hidden; Counter caret stays **0** on a fresh `?testPdf=` (no series); official spec Enter stays spec-only; Projects desktop Select `type` **button**; Projects 390 Select `type` **button**; Documents Select `type` **button**; Archive Select `type` **button**; Archive Close preview `type` **button** after row select; Documents Share / Open file / Close preview `type` **button**; History Version history trigger **0** on this path; Style / Width / Color / Opacity / Share Permission / Invite User role / Fill / Border / Search Previous / Next / Share-open Add files / New project / Invite-open Edit / Click to rename / Drag to rearrange / Templates Click to rename / Templates Expand / New template / Projects Tap to rename / Entity name / New category / New entity / Edit color / Category drag titles / Module count chrome / New module type / New module name / Module Select / Category Select / Template-list Select / Entity Select / Category drag-title / Manage team / Upload still named/typed; idle novel names **[]**; Color-open novel names are swatch hex / Hex color / Transparent (C-01 apply not taken); Search-open Previous / Next `type` **button**; Share-open Click to rename named; Share-open Drag to rearrange named; Share-open novel names left Send viewer invite (Send apply parked); Manage team `type` **button**; Upload `type` **button**; Close preview `type` **button**; Open file `type` **button**; Templates-open novel names **[]**; Invite-open Edit `type` **button**. Pages unnamed cards stay tab-as-switcher (parked). Documents More menuitem type-null stay behind exhausted Documents More (not taken). Next unique leftover that is **not** leftover-18: Projects 390 file Select after drill omitted `type="button"` (`ProjectsFolderTree.jsx`; visible name already `Select`; implicit submit; live `type` **null**). Desktop file Select (open-project pane) type-null stays a later host. Guest 390 drill can hit auth modal — do not invent leftover-18 hosts. Edit-modules New module type-null stays parked (do not open). Select-gated All / None / Duplicate / Move/Copy / Restore / Delete forever type-null stay behind Select apply. Goal stays open.

## Files

- `src/home/ProjectsFolderTree.jsx`
- `debug/scenarios/e2e-projects-desktop-select-button-type.spec.mjs`
- `debug/scenarios/e2e-after-projects-desktop-select-button-type-independent-hunt.spec.mjs`
- `tests/projectsDesktopSelectButtonType.test.mjs`
- `tests/afterProjectsDesktopSelectButtonTypeIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

# Share-open hub chrome type/name — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `59ff403c` docs: record Search match nav type=button live 3/3 (11.6s).  
**Product:** `1e142506` Add files / New project `type="button"`; Search `aria-label={placeholder}`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Last hunt typed Search Previous / Next. Did **not** take leftover-18 or exhausted slices. Looked beyond Search match-nav apply. Different axis:

1. Official leftover files vs live source after Search Previous / Next `type="button"` (NOT isolated 8448). Overlay-mount / spacesRail / popover / hub nav / Sync / Settings / Confirm / CreateCategory / KeyboardShortcuts / Access / Edit modules labelledby / Manage Team / Selection Mode / Eraser Type / Documents More / Archive Show and sort / Templates More / Projects More / Documents mobile Sort / Projects file-row More / Spaces export / Survey export / Create bookmark group / Add bookmarks to group / Add bookmark / Search clear / Color picker / Width picker / Style picker / Opacity slider / Share Permission / Invite User role / Fill / Border type / Search Previous-Next type already match live compile-visible code. Isolated **8448** (`partialEraserComplexity` `8_448 * 1024 * 1024`) still standing — not loosened. Official `annotationContextMenuitem` leftover official vs spec Enter is **not** stale vs live source (`useAnnotationContextMenu.jsx` already has `e.key === 'Enter' || e.key === ' '`; spec-only leftover, not taken).
2. Compile-visible chrome that is NOT leftover-18 and NOT the exhausted Search Previous-Next type / Fill / Border type / Invite User role name / Share Permission name / Opacity name / Style name / Width name / Color name / Search clear name / Search rail / V-08 apply / Search Previous-Next *apply* / Style-Width dismiss / C-01 swatch apply / remapped opacity apply / unnamed-dialog / nameless-menu hosts.
3. Live Projects on `/?hubPreview=1&tab=projects`. Add files / New project had names from innerText but omitted `type="button"` — live `type` was **null**. Search projects was placeholder-only (accname empty until `aria-label`). V-08 / leftover-18 apply stay parked. PromptModal lock / NewColumnsModal stay leftover-18. Do **not** name the Activity dialog. Hub novel Close preview is already `aria-label`d. History Version history trigger stays **0** on `?testPdf=` (no `file.id`; do not stamp one).

Unique leftover: last hunt opened Share and listed Add files / New project / Search projects as novel Share-open hub chrome. The attached list buttons are a live product bug — named buttons that default to submit `type`, plus an unnamed Search field. Same a11y *type/name* class as Search Previous / Next / Fill / Border, but a new compile-visible host (`ProjectsFolderTree` + `HubShell` Search). Distinct from leftover-18 / X-01 / Activity dialog name / Manage Team role picker / Documents Share Access apply / Style-Width dismiss / remapped opacity apply / C-01 swatch apply / Font color (rich-text-only) / V-08 Next-Previous apply / Search clear name / Search Previous-Next type / Fill / Border type / Invite User role name / Share Permission name / Opacity slider name / Style picker name / Width picker name / Color picker name / nameless-menu hosts already proved / unnamed-dialog family already proved / remapped-after-CW / dismiss / rail-toggle / dest-XYZ.

**Product:** min-viable-diff — Add files / New project `type="button"`; Search `aria-label={placeholder}`. Isolated 8448 standing. Cap **8448** / 75/250 not loosened. No high-risk file edit.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** name Activity. Did **not** click Add files / New project apply / Upload / Pin / Lock / Delete / Previous / Next apply / Create group apply / Add bookmarks apply / Create bookmark apply / EXPORT / Open linked / Update existing / Export Excel / Sync / CSV / PDF Pages apply / color swatches / Width presets apply / Style options apply / Opacity apply / Copy link / Send invite / Fill / Border / hex / Transparent. Did **not** change Invite User role or Share Permission.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| Official leftover files after Search Previous / Next type | **No stale fail vs live source** besides isolated 8448. Official `annotationContextMenuitem` leftover official vs spec Enter is spec-only — source already has Enter. |
| X-01 / leftover-18 hosts | **Parked.** Process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| PDF AcroForm `name` / `agree` | Forms / X-05 persist stay leftover-18. Idle editor unnamed text+checkbox **2**. |
| PromptModal lock / NewColumnsModal | leftover-18 / X-01 / X-06. Not taken. |
| Manage Team Activity dialog name | **Not taken.** A-06 roster adjacent. Do not invent a roster host. |
| Manage Team role picker | hubPreview creator-only seed — `data-kal31-role-trigger` **0**. Not taken. |
| Hub novel Close preview | Already `aria-label="Close preview"` on DocumentsLedger / Archive. Not taken. |
| Exhausted nameless-menu hosts | Home tab / annotation / Pages / hub Account / Manage Team More / Selection Mode / Eraser Type / Documents More name / Archive Show and sort / Templates More / Projects More / Documents mobile Sort / Projects file-row More / Spaces export / Survey export — do not replay. |
| Exhausted unnamed-dialog hosts | Settings / Confirm / CreateCategory / KeyboardShortcuts / Access / Edit modules / Create bookmark group / Add bookmarks to group / Add bookmark / Color picker / Width picker / Style picker — do not replay. |
| Style / Width / Color / Opacity / Search clear / Search rail / V-08 / Previous-Next apply | Already dedicated. Not replayed. |
| Search Previous / Next type / Fill / Border type / Invite User role / Share Permission | Already dedicated. Not replayed. |
| Color-open swatch hex / Hex / Transparent | C-01 apply not taken. |
| Highlighter caret | Compile-hidden. Trigger **0**. |
| Counter caret | Fresh `?testPdf=` caret **0**. Not taken. |
| History Version history trigger | Hunt count **0** on `?testPdf=` (HistoryButton mounts only with `tab.file?.id`). Restore not clicked. Do not stamp `file.id`. |
| Invite-open Find a teammate / Edit | Find a teammate already named via placeholder (`teammate` **1**). Edit still `type` **null**. Not taken this pass. |
| **Share-open Add files / New project / Search projects** | **This pass.** Before fix live Add files / New project `type` was **null**; Search projects accname empty. After fix: Add files / New project `type="button"`; Search `aria-label="Search projects..."`; Share Escape dismisses; apply not clicked. |

## Live-proved

Playwright `e2e-share-open-hub-chrome-type.spec.mjs` **2 / 2** + hunt `e2e-after-share-open-hub-chrome-independent-hunt.spec.mjs` **1 / 1**. Pair **3 / 3 (11.1s)** on Playwright Vite `http://127.0.0.1:5523`. Focused Node `shareOpenHubChromeType` + hunt + leftover18 **17 / 17**. Live spec does not count `dialog` named Activity (leftover18 Node contract); hunt still checks `/activity/i` after Manage Team / Invite without opening Activity.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `/?hubPreview=1&tab=projects`. New project + Add files `type="button"`; Search projects named. Get link Share-open still typed/named. Escape dismisses Share. Add files / New project / Send / Copy apply not taken. |
| Break | 390 Add files **0** until drill (New project + Search still typed/named). Documents tab Search projects / New project / Add files **0**. Idle editor / `?testPdf=` those hosts **0**. Hidden tools **0**. `file.id` null. Isolated 8448 standing. |
| Edge | empty=1 New project typed + Search named + Add files **0**. guest Search still named. Documents Search documents named (shared Search `aria-label`). search fixture idle **0**. Style / Width / Color / Opacity idle **0**. Version history **0**. viewBox **`0 0 612 792`**. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` not required this pass. Isolated 8448 still standing. Cap **8448** / 75/250 not loosened. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

Hunt after the type: idle editor unnamed text+checkbox remain Forms / X-05; Activity card stays unnamed (A-06 roster adjacent — not taken); Manage Team role trigger stays **0** on creator-only seed; Highlighter caret stays compile-hidden; Counter caret stays **0** on a fresh `?testPdf=` (no series); official spec Enter stays spec-only; hub novel Close preview already labelled; History Version history trigger **0** on this path; Style / Width / Color / Opacity / Share Permission / Invite User role / Fill / Border / Search Previous / Next still named/typed; idle novel names **[]**; Color-open novel names are swatch hex / Hex color / Transparent (C-01 apply not taken); Search-open Previous / Next `type` **button**; Share-open Add files / New project `type` **button** + Search projects named; Share-open novel names left Click to rename / Drag to rearrange / Send viewer invite (Send apply parked); Invite-open novel names include Find a teammate / Edit / Manage Team — Edit `type` **null** (not taken). Goal stays open.

## Files

- `src/home/ProjectsFolderTree.jsx`
- `src/home/HubShell.jsx`
- `debug/scenarios/e2e-share-open-hub-chrome-type.spec.mjs`
- `debug/scenarios/e2e-after-share-open-hub-chrome-independent-hunt.spec.mjs`
- `tests/shareOpenHubChromeType.test.mjs`
- `tests/afterShareOpenHubChromeIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

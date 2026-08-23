# Invite User role name — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `325ee78b` docs: record Share Permission name live 3/3 (10.1s).  
**Product:** `src/home/ManageTeamModal.jsx` Invite User Share link / Invite by email role comboboxes  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Last hunt named Share Permission. Did **not** take leftover-18 or exhausted slices. Looked beyond Share Copy / Send / Permission apply. Different axis:

1. Official leftover files vs live source after Share Permission `aria-label` (NOT isolated 8448). Overlay-mount / spacesRail / popover / hub nav / Sync / Settings / Confirm / CreateCategory / KeyboardShortcuts / Access / Edit modules labelledby / Manage Team / Selection Mode / Eraser Type / Documents More / Archive Show and sort / Templates More / Projects More / Documents mobile Sort / Projects file-row More / Spaces export / Survey export / Create bookmark group / Add bookmarks to group / Add bookmark / Search clear / Color picker / Width picker / Style picker / Opacity slider / Share Permission already match live compile-visible code. Isolated **8448** (`partialEraserComplexity` `8_448 * 1024 * 1024`) still standing — not loosened. Official `annotationContextMenuitem` leftover official vs spec Enter is **not** stale vs live source (`useAnnotationContextMenu.jsx` already has `e.key === 'Enter' || e.key === ' '`; spec-only leftover, not taken).
2. Compile-visible hub chrome that is NOT leftover-18 and NOT the exhausted Share Permission name / Opacity name / Style name / Width name / Color name / Search rail / V-08 apply / Search Previous-Next / Style-Width dismiss / C-01 swatch apply / remapped opacity apply / unnamed-dialog / nameless-menu hosts.
3. Live open of Invite User on `/?hubPreview=1&tab=projects` via Manage team → Invite. Invite User dialog was already named. The two role `<select>`s had visible Share link / Invite by email headings but no name — `getByRole('combobox', { name: 'Share link role' })` was **0** while Viewer / Editor were selected. Invite-by-email textarea omitted a name. Overlay Close / Copy link / Cancel / Send omitted `type="button"`. Share Permission stay dedicated (Get link still names Permission; Share link role **0** there). AccessManagement stay dedicated (Documents Share opens Document Access; Invite User **0**). Manage Team role picker / Activity stay A-06 adjacent — not taken (`data-kal31-role-trigger` **0** on creator-only seed). PromptModal lock / NewColumnsModal stay leftover-18. Do **not** name the Activity dialog. Hub novel Close preview is already `aria-label`d. History Version history trigger stays **0** on `?testPdf=` (no `file.id`; do not stamp one).

Unique leftover: last hunt opened Manage Team but never opened Invite. The two Invite User role comboboxes are a live product bug — visible Share link / Invite by email headings, unnamed selects. Same a11y *name* class as Share Permission, but a new compile-visible host (Invite User overlay besides ShareModal). Distinct from leftover-18 / X-01 / Activity dialog name / Manage Team role picker / Documents Share Access apply / Style-Width dismiss / remapped opacity apply / C-01 swatch apply / Font color (rich-text-only) / Share Permission name / Opacity slider name / Style picker name / Width picker name / Color picker name / Search clear name / Add bookmark name / nameless-menu hosts already proved / unnamed-dialog family already proved / remapped-after-CW / dismiss / rail-toggle / dest-XYZ.

**Product:** min-viable-diff — Share link role `aria-label="Share link role"`; Invite by email role `aria-label="Invite by email role"`; Invite by email `aria-label`; overlay buttons `type="button"`. Isolated 8448 standing. Cap **8448** / 75/250 not loosened. No high-risk file edit.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** name Activity. Did **not** click Create group apply / Add bookmarks apply / Create bookmark apply / EXPORT / Open linked / Update existing / Export Excel / Sync / CSV / PDF Pages apply / color swatches / Width presets apply / Style options apply / Opacity apply / Copy link / Send invite. Did **not** change Invite User role or Share Permission.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| Official leftover files after Share Permission | **No stale fail vs live source** besides isolated 8448. Official `annotationContextMenuitem` leftover official vs spec Enter is spec-only — source already has Enter. |
| X-01 / leftover-18 hosts | **Parked.** Process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| PDF AcroForm `name` / `agree` | Forms / X-05 persist stay leftover-18. Idle editor unnamed text+checkbox **2**. |
| PromptModal lock / NewColumnsModal | leftover-18 / X-01 / X-06. Not taken. |
| Manage Team Activity dialog name | **Not taken.** A-06 roster adjacent. Do not invent a roster host. |
| Manage Team role picker | hubPreview creator-only seed — `data-kal31-role-trigger` **0**. Not taken. |
| Hub novel Close preview | Already `aria-label="Close preview"` on DocumentsLedger / Archive. Not taken. |
| Exhausted nameless-menu hosts | Home tab / annotation / Pages / hub Account / Manage Team More / Selection Mode / Eraser Type / Documents More name / Archive Show and sort / Templates More / Projects More / Documents mobile Sort / Projects file-row More / Spaces export / Survey export — do not replay. |
| Exhausted unnamed-dialog hosts | Settings / Confirm / CreateCategory / KeyboardShortcuts / Access / Edit modules / Create bookmark group / Add bookmarks to group / Add bookmark / Color picker / Width picker / Style picker — do not replay. |
| Style / Width / Color / Opacity / Search clear / Search rail / V-08 / Previous-Next | Already dedicated. Not replayed. |
| Style / Width dismiss | Already dedicated (`role="option"` + pointerdown). Not replayed. |
| Font / dash / cloud picker names | Already named vs live source. Not replayed. |
| Share Permission name | Already dedicated. Get link still names Permission; Share link role **0** there. |
| Color-open swatch hex / Border / Fill / Hex / Transparent | C-01 apply not taken. Fill / Border still omit `type="button"` (`type` **null**) — not taken this pass. |
| Highlighter caret | Compile-hidden. Trigger **0**. |
| Counter caret | Fresh `?testPdf=` caret **0**. Not taken. |
| History Version history trigger | Hunt count **0** on `?testPdf=` (HistoryButton mounts only with `tab.file?.id`). Restore not clicked. Do not stamp `file.id`. |
| **Invite User role name** | **This pass.** Before fix named Share link / Invite by email role comboboxes **0** while Invite User was visible. After fix: named comboboxes **2**; Escape dismisses Invite User; role apply not changed; Copy / Send not clicked. |

## Live-proved

Playwright `e2e-invite-user-role-name.spec.mjs` **2 / 2** + hunt `e2e-after-invite-user-role-independent-hunt.spec.mjs` **1 / 1**. Pair **3 / 3 (10.4s)** on Playwright Vite `http://127.0.0.1:5479`. Focused Node `inviteUserRoleName` + hunt + leftover18 **17 / 17**. Live spec does not count `dialog` named Activity (leftover18 Node contract); hunt still checks `/activity/i` after Manage Team / Invite without opening Activity.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `/?hubPreview=1&tab=projects`. Manage team → Invite names Share link role (`aria-label="Share link role"`, Viewer) + Invite by email role (`aria-label="Invite by email role"`, Editor) + Invite by email. Escape dismisses Invite User then Manage Team. Copy / Send / role apply not taken. |
| Break | empty / guest Invite User roles **0**. Documents Share opens Document Access (Invite User **0**). Templates Share names Permission, not Invite User roles. Idle editor / 390 without Invite named roles **0**. Hidden tools **0**. `file.id` null. Isolated 8448 standing. |
| Edge | 390 Team → Invite names both roles + Escape. Search fixture idle roles **0**. Style / Width / Color / Opacity idle **0**. Version history **0**. viewBox **`0 0 612 792`**. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` not required this pass. Isolated 8448 still standing. Cap **8448** / 75/250 not loosened. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

Hunt after the name: idle editor unnamed text+checkbox remain Forms / X-05; Activity card stays unnamed (A-06 roster adjacent — not taken); Manage Team role trigger stays **0** on creator-only seed; Highlighter caret stays compile-hidden; Counter caret stays **0** on a fresh `?testPdf=` (no series); official spec Enter stays spec-only; hub novel Close preview already labelled; History Version history trigger **0** on this path; Style / Width / Color / Opacity / Share Permission still named; idle novel names **[]**; Color-open novel names are swatch hex / Border / Fill / Hex color / Transparent (C-01 apply not taken); Fill / Border `type` **null** (missing `type="button"` — not taken). Goal stays open.

## Files

- `src/home/ManageTeamModal.jsx`
- `debug/scenarios/e2e-invite-user-role-name.spec.mjs`
- `debug/scenarios/e2e-after-invite-user-role-independent-hunt.spec.mjs`
- `tests/inviteUserRoleName.test.mjs`
- `tests/afterInviteUserRoleIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

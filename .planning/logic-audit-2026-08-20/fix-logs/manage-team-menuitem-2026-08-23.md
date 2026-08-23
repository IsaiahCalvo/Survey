# Manage Team More *actions* role=menuitem — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `6f2f2140` Templates Edit modules dialog name after `4e7a4a7a`.  
**Product SHA:** `52fdd26a`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Last hunt named Templates **Edit modules**. Did **not** take leftover-18 or exhausted slices. Different axis:

1. Official leftover files vs live source after Templates Edit modules `role="dialog"` (NOT isolated 8448). Overlay-mount / spacesRail / popover / hub nav / Sync / Settings / Confirm / CreateCategory / KeyboardShortcuts / Access / Edit modules labelledby already match live compile-visible code. Isolated **8448** (`partialEraserComplexity` `8_448 * 1024 * 1024`) still standing — not loosened.
2. Compile-visible menus with a visible action list but no `role="menu"` + `role="menuitem"` that are NOT leftover-18 hosts and NOT the four exhausted nameless-menu hosts (Home tab / annotation / Pages / hub Account).
3. Live open of Manage Team on `/?hubPreview=1&tab=projects` via Tower 5 → Manage team → More. PromptModal lock / NewColumnsModal stay leftover-18. Do **not** name the Activity dialog (A-06 roster adjacent). Do **not** invent a roster host.

Unique leftover: Manage Team member More (and pending-invite More) was a nameless `<div>` of `<button>`s. `getByRole('menuitem')` was **0** while More was open. Distinct from leftover-18 / X-01 / Activity dialog name / unnamed-dialog family already proved (Settings / Confirm / CreateCategory / KeyboardShortcuts / Access / Edit modules) / remapped-after-CW / dismiss / rail-toggle / Home-tab / annotation / Pages / hub Account menuitem.

**Product:** min-viable-diff in `ManageTeamModal.jsx` — member + pending-invite popups `role="menu"` + `aria-label` + each action `type="button"` `role="menuitem"`. Isolated 8448 standing. Cap **8448** / 75/250 not loosened.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** name Activity. Did **not** invent leftover-18 mint / roster / Stripe / delete-forever / account-delete.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| Official leftover files after Edit modules `role="dialog"` | **No stale fail** besides isolated 8448. Focused official leftover18 + `manageTeamMenuitem` + hunt **17 / 17**. |
| X-01 / leftover-18 hosts | **Parked.** Process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| PDF AcroForm `name` / `agree` | Forms / X-05 persist stay leftover-18. Idle editor unnamed text+checkbox **2**. |
| PromptModal lock / NewColumnsModal | leftover-18 / X-01 / X-06. Not taken. |
| Manage Team Activity dialog name | **Not taken.** A-06 roster adjacent. Do not invent a roster host. |
| New project click | Catalogued stub (`previewCreateNoop`). Not taken. |
| Exhausted nameless-menu hosts | Home tab / annotation / Pages / hub Account — do not replay. |
| **Manage Team More *actions*** | **This pass.** Menu open **1**; before fix `getByRole('menuitem')` **0**. After fix: Invite user / View activity / Copy email. |

## Live-proved

Playwright `e2e-manage-team-menuitem.spec.mjs` **2 / 2** + hunt `e2e-after-manage-team-menuitem-independent-hunt.spec.mjs` **1 / 1**. Pair **3 / 3 (8.0s)** on Playwright Vite `http://127.0.0.1:5173`. Focused Node `manageTeamMenuitem` + hunt + leftover18 **17 / 17**.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `/?hubPreview=1&tab=projects`. Tower 5 → Manage team. More opens `role="menu"` named `Isaiah Calvo actions`. Menuitems Invite user / View activity / Copy email. Creator Change role / Remove **0**. Copy email dismisses the menu; Manage Team stays; Invite / Activity dialogs **0**. Escape dismisses the menu; Manage Team stays. |
| Break | Empty / guest Manage team **0**. Idle menuitem **0**. Editor `?testPdf=` Draw live; Manage Team / Copy email / Invite user / View activity menuitem **0**. Hidden tools **0**. `file.id` null. Isolated 8448 standing. |
| Edge | 390 drills `.projects-mobile-folder-row[data-project-id="p1"]` then visible Team; menuitems **1**. Shortcuts `?` still named. Documents More → Share still names **Document Access**. Edit modules still named. viewBox **`0 0 612 792`**. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` not required this pass. Cap **8448** / 75/250 not loosened. Isolated 8448 standing. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

Hunt after the name: idle editor unnamed text+checkbox remain Forms / X-05; Activity card stays unnamed (A-06 roster adjacent — not taken); hubPreview role trigger **0** (creator-only seed, no Edit role picker on the implicit owner). Close preview is already labelled. Goal stays open.

## Files

- `src/home/ManageTeamModal.jsx`
- `debug/scenarios/e2e-manage-team-menuitem.spec.mjs`
- `debug/scenarios/e2e-after-manage-team-menuitem-independent-hunt.spec.mjs`
- `tests/manageTeamMenuitem.test.mjs`
- `tests/afterManageTeamMenuitemIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

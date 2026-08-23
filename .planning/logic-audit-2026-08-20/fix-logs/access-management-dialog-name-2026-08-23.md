# AccessManagementModal dialog accessible name — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `363fdb52` KeyboardShortcutsOverlay dialog name after `dae6e2ed`.  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Last hunt claimed no unique leftover after shortcuts dialog name. Did **not** take leftover-18 or exhausted slices. Different axis:

1. Official leftover files vs live source after KeyboardShortcutsOverlay `role="dialog"` (NOT isolated 8448). Overlay-mount / spacesRail `openPanel` / popover `pointerdown` / hub nav `type` / Sync `cloudSync: false` / Settings / Confirm / CreateCategory / KeyboardShortcuts labelledby already match live compile-visible code. Isolated **8448** (`partialEraserComplexity` `8_448 * 1024 * 1024`) still standing — not loosened.
2. Compile-visible overlays with a visible heading but no `role="dialog"` + `aria-labelledby` that are NOT leftover-18 hosts.
3. Live open of AccessManagementModal on `/?hubPreview=1` via Documents More → Share on SE-011. PromptModal lock / NewColumnsModal stay leftover-18. Idle `?testPdf=` / hubPreview walk is not enough — last hunt missed this because Access is not idle-open.

Unique leftover: AccessManagementModal was a modal card with a visible **Document Access** heading but no `role="dialog"` / `aria-label` / `aria-labelledby`. `getByRole('dialog', { name: 'Document Access' })` was **0**. Sibling Share / Create project / Rename / Settings / Confirm / CreateCategory / Auth / KeyboardShortcuts are already named. Distinct from leftover-18 / X-01 / nameless-menu / rail-toggle / dismiss / Home `?` singleton / hub nav type / keep-mount inert / Sync chip / remapped-after-CW / Settings / Confirm / CreateCategory / KeyboardShortcuts dialog name / Documents Share Access *apply* (Invite + Done / A-03 mint).

**Product:** min-viable-diff in `AccessManagementModal.jsx` — `role="dialog"` + `aria-modal` + `aria-labelledby="access-management-modal-title"` on the inner card + `id` on the kind label. Isolated 8448 standing. Cap **8448** / 75/250 not loosened.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** replay KeyboardShortcuts name / Home `?` singleton / Share Access apply / leftover-18 A-03 mint. Did **not** invent leftover-18 delete-forever / Stripe / account-delete. Did **not** take leftover-18 A-06 Presence.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| Official leftover files after KeyboardShortcutsOverlay `role="dialog"` | **No stale fail** besides isolated 8448. Overlay-mount / spacesRail / popover / hub nav / Sync / Settings / Confirm / CreateCategory / KeyboardShortcuts already aligned. Focused official `shortcutsOverlay` + `keyboardShortcutMatrix` + `keyboardShortcutsOverlayDialogName` + leftover18 + `documentsShareAccess` **28 / 28**. |
| X-01 / leftover-18 hosts | **Parked.** Process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| PDF AcroForm `name` / `agree` | Forms / X-05 persist stay leftover-18. Idle editor unnamed text+checkbox **2**. |
| PromptModal lock (`Lock this document?`) | leftover-18 / X-01. Not taken. |
| NewColumnsModal | Excel / X-06 leftover-18. Not opened. Not taken. |
| KeyboardShortcuts / Settings / Confirm / CreateCategory dialog name | **Exhausted / do not replay.** |
| **AccessManagementModal accessible name** | **This pass.** `getByRole('dialog', { name: 'Document Access' })` was **0**. |
| Templates **Edit modules** | **Still unique leftover.** Visible `<h3>Edit modules</h3>` + `.templates-module-edit-modal` host **1**; `getByRole('dialog', { name: 'Edit modules' })` **0** (no `role="dialog"`). Compile-visible on hubPreview Templates. Not leftover-18. Not taken this pass. |

## Live-proved

Playwright `e2e-access-management-dialog-name.spec.mjs` **2 / 2** + hunt `e2e-after-access-dialog-independent-hunt.spec.mjs` **1 / 1** (**3 / 3**, 7.3s) on Playwright Vite `http://localhost:5173`. Focused Node `accessManagementDialogName` + hunt + leftover18 **17 / 17**.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `/?hubPreview=1&tab=documents`. SE-011 More → Share opens one named **Document Access** dialog via `aria-labelledby`. Escape / Close / Done dismiss. Package 2 stays named Share document. |
| Break | Idle named Access **0**. Empty hub More **0**. Guest Sign in; named Access **0** (Auth overlay leftover-18 A-01 not submitted). Hidden tools **0**. Start trial / Turnstile **0**. `file.id` null. Isolated 8448 standing. |
| Edge | 390 More → Share names the dialog (host **1**). Idle `?testPdf=` Access **0**. Shortcuts `?` still named. Keep-mount stays inert. viewBox **`0 0 612 792`**. KeyboardShortcuts name not replayed. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` 8448 / 75/250 not loosened. Isolated 8448 standing. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

PromptModal remains lock-gated leftover-18 / X-01. NewColumnsModal is still unnamed in source but was not opened (Excel / X-06). Hunt after the name found a remaining compile-visible leftover: Templates **Edit modules** (heading **1**, named dialog **0**). Goal stays open.

## Files

- `src/home/AccessManagementModal.jsx`
- `debug/scenarios/e2e-access-management-dialog-name.spec.mjs`
- `debug/scenarios/e2e-after-access-dialog-independent-hunt.spec.mjs`
- `tests/accessManagementDialogName.test.mjs`
- `tests/afterAccessDialogIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

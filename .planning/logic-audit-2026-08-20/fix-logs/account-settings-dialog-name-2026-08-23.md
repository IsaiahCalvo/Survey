# Account Settings dialog accessible name — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `b77d220b` keep-mount hub inert after `2dca006d`.  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Last hunt claimed no unique leftover after keep-mount inert. Did **not** take their word. Different axis:

1. Official leftover files vs live source after the inert wrap (NOT isolated 8448). Overlay-mount / spacesRail `openPanel` / popover `pointerdown` / hub nav `type` / Sync `cloudSync: false` already match live compile-visible code. Isolated **8448** (`partialEraserComplexity` `8_448 * 1024 * 1024`) still standing — not loosened.
2. Compile-visible chrome that is NOT rail-toggle, dismiss, nameless-menu, Home `?`, hub nav type, keep-mount inert, Sync chip, or remapped-after-CW.
3. Live DOM walk of `?testPdf=` / `/?hubPreview=1` for `button` / `input` / `[role=menuitem]` / `[role=dialog]`.

Unique leftover: Account Settings `role="dialog"` had `aria-modal` but no `aria-label` / `aria-labelledby`. `getByRole('dialog', { name: 'Settings' })` was **0** while the visible `<h2>Settings</h2>` sat unnamed. Sibling hub dialogs are already named (Share / Create project / Rename / Auth `aria-labelledby`). Distinct from leftover-18 / X-01 / nameless-menu / rail-toggle / dismiss / Home `?` / hub nav type / keep-mount inert / Sync chip / remapped-after-CW / hub Account menuitem / Settings General *content*.

**Product:** min-viable-diff in `AccountSettings.jsx` — `aria-labelledby="account-settings-title"` on the dialog + `id` on the heading. Isolated 8448 standing. Cap **8448** / 75/250 not loosened.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** replay keep-mount inert / hub nav type / nameless-menu / rail-toggle / dismiss / Home `?`. Did **not** take leftover-18 A-06 Presence “1 active user”.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| Official leftover files after inert wrap | **No stale fail** besides isolated 8448. Overlay-mount / spacesRail / popover / hub nav / Sync already aligned. |
| X-01 / leftover-18 hosts | **Parked.** Process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| PDF AcroForm `name` / `agree` | Forms / X-05 persist stay leftover-18. |
| Keep-mount inert / hub nav type / nameless-menu / rail-toggle / dismiss / Home `?` / Sync chip / remapped-after-CW | **Exhausted / do not replay.** |
| 390 Presence “1 active user” | leftover-18 A-06 — not unique. |
| Settings General / delete / connect / trial **content** | Already dedicated. Not this leftover. |
| **Settings dialog accessible name** | **This pass.** `getByRole('dialog', { name: 'Settings' })` was **0**. |

## Live-proved

Playwright `e2e-account-settings-dialog-name.spec.mjs` + hunt `e2e-after-settings-dialog-independent-hunt.spec.mjs` on Playwright Vite. Focused Node `accountSettingsDialogName` + hunt + leftover18.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `/?hubPreview=1`. Dialog named **Settings** via `aria-labelledby`. General active. Connected services / Subscription keep the same dialog name. Escape / × close. Reopen lands General. |
| Break | Guest Sign in; Settings dialog **0**. Hidden tools **0**. Start trial / Connect Microsoft / Turnstile **0**. `file.id` null. Isolated 8448 standing. |
| Edge | 390 named dialog. `empty=1` invents **0**. `?testPdf=` Home uses Dev Test User email; keep-mount stays inert under the viewer. viewBox **`0 0 612 792`**. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` 8448 / 75/250 not loosened. Isolated 8448 standing. `graphify` CLI checked.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

Hunt after the name found no other unique compile-visible leftover on the idle `?testPdf=` / hubPreview walk. ConfirmModal delete-confirm dialog name was not opened this pass (Documents Delete confirm already has dedicated apply chrome). Goal stays open.

## Files

- `src/components/AccountSettings.jsx`
- `debug/scenarios/e2e-account-settings-dialog-name.spec.mjs`
- `debug/scenarios/e2e-after-settings-dialog-independent-hunt.spec.mjs`
- `tests/accountSettingsDialogName.test.mjs`
- `tests/afterAccountSettingsDialogIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

# KeyboardShortcutsOverlay dialog accessible name — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `58bfacf3` PromptModal lock-gated / NewColumnsModal unopened after CreateCategory name.  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Last hunt parked PromptModal lock / NewColumnsModal as leftover-18. Did **not** take leftover-18 or exhausted slices. Different axis:

1. Official leftover files vs live source after CreateCategoryModal `aria-labelledby` (NOT isolated 8448). Overlay-mount / spacesRail `openPanel` / popover `pointerdown` / hub nav `type` / Sync `cloudSync: false` / Settings / Confirm / CreateCategory labelledby already match live compile-visible code. Isolated **8448** (`partialEraserComplexity` `8_448 * 1024 * 1024`) still standing — not loosened.
2. Compile-visible chrome that is NOT rail-toggle, dismiss, nameless-menu, Home `?` singleton, hub nav type, keep-mount inert, Sync chip, remapped-after-CW, Settings / Confirm / CreateCategory dialog name, or V-09 catalog.
3. Live open of KeyboardShortcutsOverlay on `?testPdf=` via `?`. PromptModal lock is leftover-18 / X-01 (hub Lock does not open a prompt). NewColumnsModal stays Excel / X-06.

Unique leftover: KeyboardShortcutsOverlay was a modal card with a visible `<h2>Keyboard shortcuts</h2>` but no `role="dialog"` / `aria-label` / `aria-labelledby`. `getByRole('dialog', { name: 'Keyboard shortcuts' })` was **0**. Sibling CreateCategory / Confirm / Settings / Share / Create project / Rename / Auth are already named. Distinct from leftover-18 / X-01 / nameless-menu / rail-toggle / dismiss / Home `?` singleton (stack count) / hub nav type / keep-mount inert / Sync chip / remapped-after-CW / Settings / Confirm / CreateCategory dialog name / V-09 catalog / survey-rail Create category apply.

**Product:** min-viable-diff in `KeyboardShortcutsOverlay.jsx` — `role="dialog"` + `aria-modal` + `aria-labelledby="keyboard-shortcuts-title"` on the inner card + `id` on the title. Isolated 8448 standing. Cap **8448** / 75/250 not loosened.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** replay CreateCategory name / ConfirmModal / category Delete / Settings dialog name / nameless-menu / rail-toggle / dismiss / Home `?` singleton. Did **not** invent leftover-18 delete-forever / Stripe / account-delete. Did **not** take leftover-18 A-06 Presence.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| Official leftover files after CreateCategory labelledby | **No stale fail** besides isolated 8448. Overlay-mount / spacesRail / popover / hub nav / Sync / Settings / Confirm / CreateCategory already aligned. |
| X-01 / leftover-18 hosts | **Parked.** Process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| PDF AcroForm `name` / `agree` | Forms / X-05 persist stay leftover-18. |
| PromptModal lock (`Lock this document?`) | leftover-18 / X-01. Not taken. |
| NewColumnsModal | Excel / X-06 leftover-18. Not opened. Not taken. |
| CreateCategory / Confirm / Settings dialog name | **Exhausted / do not replay.** |
| Home `?` singleton | **Exhausted.** Stack count stays dedicated. This leftover is the accessible name. |
| **KeyboardShortcutsOverlay accessible name** | **This pass.** `getByRole('dialog', { name: 'Keyboard shortcuts' })` was **0**. |

## Live-proved

Playwright `e2e-keyboard-shortcuts-overlay-dialog-name.spec.mjs` **2 / 2** + hunt `e2e-after-keyboard-shortcuts-overlay-independent-hunt.spec.mjs` **1 / 1** (**3 / 3**, 8.3s) on Playwright Vite `http://127.0.0.1:5173`. Focused Node `keyboardShortcutsOverlayDialogName` + hunt + leftover18 **17 / 17**.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `?testPdf=clickable-link-test.pdf`. `?` opens one named **Keyboard shortcuts** dialog via `aria-labelledby`. Escape / Close / second `?` dismiss. Overlay host stays **1**. |
| Break | Idle named dialog **0**. HubPreview `?` does not open the named dialog (existing mount). Guest leftover-18 hosts **0**. Hidden tools **0**. Start trial / Turnstile **0**. `file.id` null. Isolated 8448 standing. |
| Edge | 390 viewer `?` names the dialog (host **1**). Survey idle Create category / Confirm / shortcuts **0**. Keep-mount stays inert. viewBox **`0 0 612 792`**. Home `?` singleton not replayed. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` 8448 / 75/250 not loosened. Isolated 8448 standing. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

PromptModal remains lock-gated leftover-18 / X-01. Hunt after the name found no other unique compile-visible leftover on the idle `?testPdf=` / hubPreview walk (unnamed editor text+checkbox remain leftover-18 Forms / X-05; hub novel `Close preview` is already `aria-label`d DocumentsLedger chrome). NewColumnsModal is still unnamed in source but was not opened (Excel / X-06). Goal stays open.

## Files

- `src/components/KeyboardShortcutsOverlay.jsx`
- `debug/scenarios/e2e-keyboard-shortcuts-overlay-dialog-name.spec.mjs`
- `debug/scenarios/e2e-after-keyboard-shortcuts-overlay-independent-hunt.spec.mjs`
- `tests/keyboardShortcutsOverlayDialogName.test.mjs`
- `tests/afterKeyboardShortcutsOverlayIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

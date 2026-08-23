# CreateCategoryModal dialog accessible name — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `1d821d16` ConfirmModal dialog name after `c4531bb1` aria-labelledby.  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Last hunt claimed CreateCategoryModal / PromptModal names were not opened. Did **not** take leftover-18 or exhausted slices. Different axis:

1. Official leftover files vs live source after ConfirmModal `aria-labelledby` (NOT isolated 8448). Overlay-mount / spacesRail `openPanel` / popover `pointerdown` / hub nav `type` / Sync `cloudSync: false` / Settings labelledby / ConfirmModal labelledby already match live compile-visible code. Isolated **8448** (`partialEraserComplexity` `8_448 * 1024 * 1024`) still standing — not loosened.
2. Compile-visible chrome that is NOT rail-toggle, dismiss, nameless-menu, Home `?`, hub nav type, keep-mount inert, Sync chip, remapped-after-CW, Settings dialog name, ConfirmModal name, or category Delete content.
3. Live open of CreateCategoryModal on `?testPdf=` + `surveyTransitionE2E=1`. PromptModal lock is leftover-18 / X-01 (hub Lock does not open a prompt).

Unique leftover: CreateCategoryModal `role="dialog"` had `aria-modal` but no `aria-label` / `aria-labelledby`. `getByRole('dialog', { name: 'Create category' })` was **0** while the visible title sat unnamed. Sibling ConfirmModal / Settings / Share / Create project / Rename / Auth are already named. Distinct from leftover-18 / X-01 / nameless-menu / rail-toggle / dismiss / Home `?` / hub nav type / keep-mount inert / Sync chip / remapped-after-CW / Settings dialog name / ConfirmModal name / survey-rail Create category *apply* / category Delete *content*.

**Product:** min-viable-diff in `CreateCategoryModal.jsx` — `aria-labelledby="create-category-modal-title"` on the dialog + `id` on the title. Isolated 8448 standing. Cap **8448** / 75/250 not loosened.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** replay ConfirmModal name / category Delete content / Settings dialog name / nameless-menu / rail-toggle / dismiss / Home `?`. Did **not** invent leftover-18 delete-forever / Stripe / account-delete. Did **not** take leftover-18 A-06 Presence.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| Official leftover files after ConfirmModal labelledby | **No stale fail** besides isolated 8448. Overlay-mount / spacesRail / popover / hub nav / Sync / Settings / ConfirmModal already aligned. |
| X-01 / leftover-18 hosts | **Parked.** Process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| PDF AcroForm `name` / `agree` | Forms / X-05 persist stay leftover-18. |
| ConfirmModal name / category Delete content | **Exhausted / do not replay.** |
| PromptModal lock (`Lock this document?`) | Compile-present in Dashboard `askPrompt`. HubPreview Lock persist is fail-closed — dialog **0**. leftover-18 / X-01. Not opened. |
| **CreateCategoryModal accessible name** | **This pass.** `getByRole('dialog', { name: 'Create category' })` was **0**. |

## Live-proved

Playwright `e2e-create-category-modal-dialog-name.spec.mjs` **2 / 2** + hunt `e2e-after-create-category-modal-independent-hunt.spec.mjs` **1 / 1** (**3 / 3**, 10.0s) on Playwright Vite `http://127.0.0.1:5322`. Focused Node `createCategoryModalDialogName` + hunt + leftover18 **17 / 17**.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Two Category Template → Create category plus. Dialog named **Create category** via `aria-labelledby`. Cancel keeps Walls + Windows. Escape closes. |
| Break | Idle rail: named dialog **0**. Empty / whitespace name: confirm disabled. Duplicate Walls: error, confirm disabled. HubPreview Lock does not open PromptModal. Guest Sign in; Create category dialog **0**. Hidden tools **0**. Start trial / Turnstile **0**. `file.id` null. Isolated 8448 standing. |
| Edge | 390 Open survey has no Create category plus / named dialog. Idle `?testPdf=` create **0**. Keep-mount stays inert under the viewer. viewBox **`0 0 612 792`**. ConfirmModal **0** (not replayed). |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` 8448 / 75/250 not loosened. Isolated 8448 standing. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

PromptModal remains lock-gated leftover-18 / X-01. Hunt after the name found no other unique compile-visible leftover on the idle `?testPdf=` / hubPreview walk (unnamed editor text+checkbox remain leftover-18 Forms / X-05; hub novel `Close preview` is already `aria-label`d DocumentsLedger chrome). NewColumnsModal is still unnamed in source but was not opened (Excel / X-06). Goal stays open.

## Files

- `src/components/CreateCategoryModal.jsx`
- `debug/scenarios/e2e-create-category-modal-dialog-name.spec.mjs`
- `debug/scenarios/e2e-after-create-category-modal-independent-hunt.spec.mjs`
- `tests/createCategoryModalDialogName.test.mjs`
- `tests/afterCreateCategoryModalIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

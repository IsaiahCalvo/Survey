# ConfirmModal dialog accessible name — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `139beca4` Settings dialog name after `726eb8d3` aria-labelledby.  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Last hunt claimed no unique leftover after Settings dialog name. Did **not** take their word. Different axis:

1. Official leftover files vs live source after Settings `aria-labelledby` (NOT isolated 8448). Overlay-mount / spacesRail `openPanel` / popover `pointerdown` / hub nav `type` / Sync `cloudSync: false` / Settings labelledby already match live compile-visible code. Isolated **8448** (`partialEraserComplexity` `8_448 * 1024 * 1024`) still standing — not loosened.
2. Compile-visible chrome that is NOT rail-toggle, dismiss, nameless-menu, Home `?`, hub nav type, keep-mount inert, Sync chip, remapped-after-CW, or Settings dialog name.
3. Live open of a compile-visible ConfirmModal on `?testPdf=` (hub Rename / Share / Create project already named; hubPreview Documents Delete is immediate).

Unique leftover: ConfirmModal `role="dialog"` had `aria-modal` but no `aria-label` / `aria-labelledby`. `getByRole('dialog', { name: 'Delete 1 category?' })` was **0** while the visible title sat unnamed. Sibling ConfirmDeleteModal / Rename / Share / Create project / Settings / Auth are already named. Distinct from leftover-18 / X-01 / nameless-menu / rail-toggle / dismiss / Home `?` / hub nav type / keep-mount inert / Sync chip / remapped-after-CW / Settings dialog name / Settings General *content* / survey-rail Delete selected categories *apply*.

**Product:** min-viable-diff in `BulkModals.jsx` — `aria-labelledby="confirm-modal-title"` on the dialog + `id` on the title. Isolated 8448 standing. Cap **8448** / 75/250 not loosened.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** replay Settings dialog name / Settings General *content* / nameless-menu / rail-toggle / dismiss / Home `?`. Did **not** invent leftover-18 delete-forever / Stripe / account-delete. Did **not** take leftover-18 A-06 Presence “1 active user”.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| Official leftover files after Settings labelledby | **No stale fail** besides isolated 8448. Overlay-mount / spacesRail / popover / hub nav / Sync / Settings already aligned. |
| X-01 / leftover-18 hosts | **Parked.** Process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| PDF AcroForm `name` / `agree` | Forms / X-05 persist stay leftover-18. Hunt idle walk still sees the unnamed page text+checkbox. |
| Settings dialog name / General content | **Exhausted / do not replay.** |
| Hub Rename / Share / Create project | Already named. |
| HubPreview Documents Delete | Immediate apply — **0** ConfirmModal. Not this leftover. |
| Archive delete-forever / Stripe / account-delete | leftover-18 — not invented. |
| **ConfirmModal accessible name** | **This pass.** `getByRole('dialog', { name: 'Delete 1 category?' })` was **0**. |

## Live-proved

Playwright `e2e-confirm-modal-dialog-name.spec.mjs` **2 / 2** + hunt `e2e-after-confirm-modal-independent-hunt.spec.mjs` **1 / 1** (**3 / 3**, 11.1s) on Playwright Vite `http://127.0.0.1:5321`. Focused Node `confirmModalDialogName` + hunt + leftover18 **17 / 17**.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Two Category Template → category Select → Walls. Dialog named **Delete 1 category?** via `aria-labelledby`. Cancel keeps Walls + Windows. Two selected → **Delete 2 categories?**. Escape / × close. |
| Break | None selected: Delete disabled, named dialog **0**. HubPreview Documents Delete immediate (`d6` gone, dialog **0**). Guest Sign in; ConfirmModal **0**. Hidden tools **0**. Start trial / Turnstile **0**. `file.id` null. Isolated 8448 standing. |
| Edge | 390 Open survey has no category Delete / named confirm. Idle `?testPdf=` confirm **0**. Keep-mount stays inert under the viewer. viewBox **`0 0 612 792`**. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No high-risk file edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` 8448 / 75/250 not loosened. Isolated 8448 standing. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

Hunt after the name found no other unique compile-visible leftover on the idle `?testPdf=` / hubPreview walk (unnamed editor text+checkbox remain leftover-18 Forms / X-05). CreateCategoryModal / PromptModal dialog names were not opened this pass. Goal stays open.

## Files

- `src/home/BulkModals.jsx`
- `debug/scenarios/e2e-confirm-modal-dialog-name.spec.mjs`
- `debug/scenarios/e2e-after-confirm-modal-independent-hunt.spec.mjs`
- `tests/confirmModalDialogName.test.mjs`
- `tests/afterConfirmModalIndependentHunt.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

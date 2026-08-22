# Survey-rail Choose survey template re-pick — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Excel actions fail-closed, the named leftover is rail **Choose survey template** re-pick after already in a template (`aria-label="Choose survey template"`). Distinct from first-entry KAL-436 pick. Live-proved on `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist Y/N/N-A / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, Excel fail-closed, item Copy → space, item reorder, category reorder, empty-module Create template, place-time Entity dialog, rail Entity picker, Jump / Set location, Create category plus, category Delete, Rename, item Delete, overlay delete, handle drag, U-01 Walls create, Keep active, Survey notes, Survey module, nubbin, bbox edit, vertex-N, line handles, callout family, page ctx, thumbnail, Fit height, Bookmarks, Eraser/Counter catalogs, F3, counter-series Delete, Cloud bump, Search, keyboard, every-swatch, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome. UL-31 Continue pin stays parked.

## Why this is a GAP (and not first-entry KAL-436)

| Prior claim | What was actually asserted |
|---|---|
| U-01 Survey rail **pass** (live stamp) | First-entry heading `Choose survey template` → pick KAL-436 → Walls. After pick, desktop title was a display-only `<h2>`. |
| Excel leftover “next” | Named this control. Not proven until this pass. |
| Empty-module Create template | Closed + reopened Survey to see a **new** local template in the first-entry list. Not in-session re-pick. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| Desktop in-session `aria-label="Choose survey template"` | **GAP.** Was mobile-only. Desktop after first pick had no re-pick control. |
| Mobile in-session template button | **Live.** Same aria-label; dropdown already compiled-in. |
| First-entry heading picker | Already used by every survey E2E. Not this leftover. |
| Same-template option | **No-op after fix.** Used to call `handleSelectSurveyTemplate` and clear `selectedCategoryId`. |
| Cancel (Escape / click-outside) | **Live.** Escape capture-closes so undo-Esc does not pop the place. |
| Empty picker | **Source.** First-entry + in-session `"No templates available"`. Live `surveyTransitionE2E=1` seeds 4 templates. |
| Existing markers | **Stay in store.** Overlay hides when the new template’s first module id differs. Not wipe. Not migrate (`categoryId` / `moduleId` unchanged). |
| leftover-18 unplaced-rows / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / checklist Y/N/N-A / copyModeActive Copy-to-space / category Move/Copy stub | Parked / compile-hidden / dead stub. |

Did **not** invent a cloud template or Excel import. No `file.id`.

## Source (before live)

- Mobile: title button `aria-label="Choose survey template"` + dropdown. `ref={mobileMode ? templateSelectorRef : undefined}` so desktop click-outside was unattached.
- Desktop: `<h2>` template / module name only.
- Option click always called `onSelectSurveyTemplate(template)` — same id reset category and armed `survey-marker`.
- `handleSelectSurveyTemplate` sets template + first module + `selectedCategoryId=null`. No history checkpoint. Does not write `surveyMarkers`.
- Overlay visibility is module-scoped (`getSurveyAnnotationVisibilityState`). Foreign-module marks stay in the store and hide.

## Product fix

Min-viable `SurveySpacesRail.jsx` only (not `PDFViewer.jsx`):

1. Desktop chevron `aria-label="Choose survey template"` beside the existing heading (keeps `getByRole('heading', { name: template })` for sibling E2E).
2. Shared listbox for desktop + mobile. `templateSelectorRef` always attached.
3. `pickSurveyTemplate`: same `template.id` closes the picker and returns (no-op).
4. Empty list shows `No templates available`.
5. Escape (capture) + click-outside cancel. Escape stops so survey undo-Esc does not fire.

Did not touch `zoomGeneration`, SVG viewBox zoom, canvas sizing, or high-risk files.

## Live-proved

Playwright `debug/scenarios/e2e-survey-choose-template-repick.spec.mjs` **1 / 1 (6.4s)** on Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Node `surveyChooseTemplateRepick.test.mjs` **3 / 3**. Did **not** run official `npm test` (no high-risk file). 8448 not loosened.

Receipt log: `SURVEY_CHOOSE_TEMPLATE_REPICK_PROOF` persist `null`, 390 `{ chooseTemplate: 1, windows: 1 }`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Picker opens after KAL-436 | **pass** | Desktop chevron + listbox. Options: KAL-436 (selected), Survey Entities, Two Category, Empty Module. |
| Re-pick Two Category | **pass** | Heading + module **Two Category Survey**. Walls + Windows. |
| Markers | **stay** (not wipe / not migrate) | Store keeps `kal436-category` / `kal436-module`. Overlay **hides** on Two Category (foreign first module). Re-pick Entities shows the same id again. Entity trigger present. |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| Re-pick same template | **pass** | KAL-436 option closes picker; heading + Walls + marker stay. |
| Escape cancel | **pass** | Listbox gone; KAL-436 + marker stay. |
| Click-outside cancel | **pass** | Body `mousedown`; KAL-436 + marker stay. |
| Pen-armed | **pass** | After undo, `p` then Two Category still updates the rail; no new mark. |
| Empty picker | **source-only** | Live route seeds 4 templates. Node asserts first-entry + in-session empty copy. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo | **pass** (no template checkpoint) | Ctrl+Z popped the place; heading stayed Survey Entities Template. |
| 390 | **pass** | In-session button **1**. Re-pick Two Category; Windows label **1**. |

No `file.id` (`persist: null`). No error boundary. SVG default.

## Classification after this pass

- **GAP found and proven:** in-session Choose survey template re-pick after already in a template.
- **Product bugs fixed:** desktop control was missing; same-id pick reset category; empty in-session list had no copy; Escape cancel could have hit undo-Esc.
- **Omitted (not invented):** checklist Y/N/N-A, category Move/Copy stub, copy-mode toolbar, leftover-18 unplaced-rows, linked workbook.
- **Next unique leftover (not this pass):** 390 detail **Choose Survey Marker** sibling switcher (`aria-label="Choose Survey Marker"` / listbox `Survey Markers in this category`). Distinct from Entity (`Choose Survey Marker entity`). Not checklist Y/N/N-A. Not category Move/Copy stub. Not leftover-18 unplaced-rows. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/SurveySpacesRail.jsx` (desktop Choose survey template; same-id no-op; empty copy; Escape cancel)
- `debug/scenarios/e2e-survey-choose-template-repick.spec.mjs`
- `tests/surveyChooseTemplateRepick.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.

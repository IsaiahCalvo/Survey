# Survey Previous/Next module — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

The thumbnail-click pass listed Notes / Previous-Next module / keep-category as “not first.” This hunt took **Previous/Next module** as the first unique unblocked control that prior catalogs marked proven only at **cluster** level. U-01 “stamp + filter” clicked the Walls **category** after picking KAL-436. The fixture has two modules (`Existing Survey Data` / `Other Survey Data`); no spec grepped `Previous module` / `Next module`.

Did **not** invent `.env.local`. Did **not** replay Fit height, 390 Bookmarks, thumbnail click, leftover-18. Did **not** invent Print / stamp / measure / Group / Extract / Note / Link create / Actual size / rotate-view / two-page / Comments panel. No 768 tablet pass (`isNarrowShell` is `max-width: 720px` only).

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| U-01 Survey rail | KAL-436 → **Walls** → stamp `[data-survey-marker-id]`. Walls is a category. |
| X-06 Excel / leftover-18 export | Same Walls click, then EXPORT. No module step. |
| kal436 / wave-remaining / helper-only | Template pick + Walls. Never Next/Prev. |
| Mobile 390 chrome | Survey **module dropdown** (`aria-label="Survey module"`), not Previous/Next. |
| Exhausted 2026-08-21 | Lumped under U-01…U-03 cluster-proven. |

Product path is distinct: `resolveSurveyModuleStep` → `selectSurveyModule(moduleId)` (clears `selectedCategoryId`). Category click is `setSelectedCategoryId('kal436-category')` and arms the stamp. Same rail, two controls.

## Hunt (candidate order)

| Candidate | Verdict |
|---|---|
| ZOOM_MODES leftover | **None.** `FIT_PAGE` / `FIT_WIDTH` / `FIT_HEIGHT` / `MANUAL` already live. No Actual size / rotate-view / two-page (`scrollMode` forced `continuous`). |
| PagesPanel remaining clicks | Inspected. Double-click ≡ left-click navigate (no extra behavior). Right-click **Mirror vertically**, **Reset**, page **Cut/Copy/Paste** still unexecuted (UL-32 showed items + Duplicate execute; wave 6 only Mirror H). Not this pass — last hunt deferred Survey first; “do not replay pages” kept these parked as the next hinted siblings. |
| Spaces extras | U-02 create/rename/pages live. Cloud persist leftover-18. |
| **Previous/Next module** | **This pass.** |
| Keep active | Desktop checkbox + mobile “Keep active.” Distinct post-stamp arming. **Not first.** |
| Survey notes | Needs a placed marker. **Not first.** |
| Callout knee / leader / arrowTip | Canvas drag handles. T-02 + paste cover create/clone; never dragged. **Not this chrome GAP.** |
| Right-rail comments | No Comments panel. |

## Live-proved

Playwright `debug/scenarios/e2e-survey-module-nav.spec.mjs` **1 / 1 (2.9s)** on reused Vite `http://localhost:5173`. Node `tests/surveyModuleNav.test.mjs` **2 / 2**.

| Slice | Intended / break / edge |
|---|---|
| Intended Next | `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1` at 1400×900. Next: **Existing → Other**, Doors visible, Walls gone. Next disabled. |
| Intended Previous | Previous: **Other → Existing**, Walls back, Doors gone. |
| Break first Previous | Disabled Previous force-click stays Existing / Walls. |
| Break last Next | After dropdown jump to Other, Next force-click stays Other. No third module. |
| Contrast dropdown | Listbox pick Other ≠ Next (same destination, different control). |
| Edge Walls-armed | Walls click then Next: Other/Doors shows; Doors **not** auto-active; Walls gone. |
| Edge armed | Pen/Draw armed. Next still steps; user-mark count unchanged. |

No product bug. No high-risk edit (`SurveySpacesRail.jsx` + new `src/utils/surveyModuleNav.js` only). Cap **8448 MiB / 75/250** not loosened. Official `npm test` leftover not replayed.

## Classification after this pass

- **GAP found and proven:** desktop Survey Previous/Next module (was cluster-classified under U-01).
- **Do not re-claim unblocked GAP = 0.** Fit-height receipt already forbade a new zero. This file does not stamp one either.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/utils/surveyModuleNav.js`
- `src/SurveySpacesRail.jsx` (Previous/Next click + disabled via the helper)
- `tests/surveyModuleNav.test.mjs`
- `debug/scenarios/e2e-survey-module-nav.spec.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.

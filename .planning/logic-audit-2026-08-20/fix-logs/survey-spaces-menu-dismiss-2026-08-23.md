# Survey / Spaces menu dismiss — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `9e52e13e` Pages context dismiss.  
**This-pass SHA:** `52dde4d0` (capture pointerdown + consume).  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Unique leftover after Pages context dismiss (`5c01eecc` / `9e52e13e`). Last hunt named Survey/Spaces mousedown listeners as not live-proved. Template re-pick **apply**, module Next/Prev **apply**, and Space CSV / PDF Pages **apply** stay dedicated or leftover-18. This leftover is Survey template / module / mobile export / entity + Spaces export **popup dismiss** on a page click while a creation tool is armed. Overlay lists Esc as Close dialogs/cancel. Distinct from leftover-18 / X-01 / remapped-after-CW / Fit apply / Fit dismiss / Style/Width dismiss / Pages context dismiss / Select caret / Home tab / Close tab.

**Product:** SurveySpacesRail and SpacesPanel listened for `mousedown`. SVG `onPointerDown` `preventDefault`s while Rectangle (and other create tools) are armed, which suppresses the compatibility mousedown — so a page click never closed those rail menus. Listeners are now capture `pointerdown`. Page-surface dismiss is consumed so it does not start a rubber-band (same contract as Pages context / AppShell exclusive layer). Space CSV / PDF Pages menuitems were **not** clicked.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** replay remapped-after-CW, Ctrl+2 / Ctrl+M, menu Fit height / Ctrl+0 / Ctrl+1, Fit dismiss, Style/Width dismiss, Pages/annotation context dismiss, rail Previous/Next, keyboard letters, toolbar click-to-arm, or Home/Close tab.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| X-01 / leftover-18 hosts | **Parked.** `.env.local` names PRESENT; process env absent; no `scripts/test-account-lease.mjs` token; no real `file.id`. |
| Pages / Style / Width / Fit dismiss | **Exhausted / do not replay.** |
| Template re-pick apply / module Next-Prev apply | **Already dedicated.** Prior template cancel used body `mousedown`, not a page click with Rectangle armed. |
| Space CSV / PDF Pages apply | **Leftover-18.** Dismiss only this pass. |
| Rectangle/Ellipse create-path | **Already proved** (`e2e-shape-live-create`). |
| Color picker / opacity / dash / overflow | Color trigger **0** until a shape tool is armed; exclusive layer already pointerdown. Opacity / overflow **0**. |
| File export flavors / File menu / Excel / Eraser caret | Export is a single live button. File menu / Excel / Eraser caret **0**. |
| Search Match case / Whole word / Comments / Forms / Print / Actual size / Measure / Group / Extract / Note / Marquee zoom / Layers / Attachments | **0.** |
| Official stale contracts | leftover-18 Node **12 / 12**. Isolated 8448 standing. No new stale official contract. |
| **Survey / Spaces page-click dismiss** | **This pass.** Live hunt: template / module / Spaces export opened **1** with Rectangle armed; after page click **0**. |

## Live-proved

Playwright `debug/scenarios/e2e-survey-spaces-menu-dismiss.spec.mjs` **2 / 2** on Playwright Vite `http://127.0.0.1:5173` (desktop **8.3s**, 390 **2.3s**). Hunt `e2e-after-pages-context-independent-hunt.spec.mjs` **1 / 1 (6.1s)** post-fix. Pair **3 / 3 (11.8s)**. Focused Node `surveySpacesMenuDismiss` + leftover18 **15 / 15**. `surveyChooseTemplateRepick` still **3 / 3** (listener contract updated to pointerdown).

| Slice | Intended / break / edge |
|---|---|
| Intended template Escape | `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1` 1400×900. Rectangle armed. Choose survey template opens. Escape closes. |
| Intended template click-outside | Page click closes. No invented rect (`marksBefore` held). Second Escape invents **0**. |
| Intended module | Choose survey module opens; Escape closes; page click closes; no invented rect. |
| Intended Spaces export | Create Space 1. Export menu shows CSV / PDF Pages (not clicked). Escape closes; page click closes; no invented rect. |
| Break keyboard | Space stays pan (`dataset.spacePan` armed); menus stay closed. |
| Break invent / hub | hubPreview Survey / Spaces / Draw **0**. |
| Edge search fixture | `text-search-glyph-lab.pdf` page click closes template picker; `file.id` null; viewBox **`0 0 612 792`**. |
| Edge 390 | Open survey → KAL-436. Template page click closes. Export survey data closes if open. viewBox **`0 0 612 792`**. `file.id` null. |

Hunt live counts: Match case / Whole word / Comments / Forms / Print / Actual size / Measure / Group / Extract / Note / Marquee zoom / Layers / Attachments **0**. `file.id` null. templateAfterPageClick **0**. moduleAfterPageClick **0**. exportAfterPageClick **0**. File menu / overflow / opacity **0**.

Product edit: `src/SurveySpacesRail.jsx` + `src/sidebar/SpacesPanel.jsx` only — capture `pointerdown` + page-surface consume. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. High-risk files not edited; official `npm test` not required this pass. Cap **8448** / 75/250 not loosened. Isolated 8448 standing. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

## Files

- `src/SurveySpacesRail.jsx` (five rail menus capture `pointerdown` + page-surface consume)
- `src/sidebar/SpacesPanel.jsx` (export menu capture `pointerdown` + page-surface consume)
- `debug/scenarios/e2e-survey-spaces-menu-dismiss.spec.mjs`
- `debug/scenarios/e2e-after-pages-context-independent-hunt.spec.mjs`
- `tests/surveySpacesMenuDismiss.test.mjs`
- `tests/surveyChooseTemplateRepick.test.mjs` (listener contract → pointerdown)
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.

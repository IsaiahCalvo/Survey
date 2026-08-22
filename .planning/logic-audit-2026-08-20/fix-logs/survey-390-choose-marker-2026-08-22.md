# 390 detail Choose Survey Marker sibling switcher — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Choose survey template re-pick, the named leftover is 390 detail **Choose Survey Marker** sibling switcher (`aria-label="Choose Survey Marker"` / listbox `Survey Markers in this category`). Distinct from Entity (`Choose Survey Marker entity`). Not checklist Y/N/N-A. Not category Move/Copy stub. Not leftover-18 unplaced-rows. Live-proved on `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1` (two siblings placed on desktop, then viewport 390×844) + `text-search-glyph-lab.pdf` (one-marker seed). Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist Y/N/N-A / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, Choose survey template re-pick, Excel fail-closed, item Copy → space, item reorder, category reorder, empty-module Create template, place-time Entity dialog, rail Entity picker, Jump / Set location, Create category plus, category Delete, Rename, item Delete, overlay delete, handle drag, U-01 Walls create, Keep active, Survey notes, Survey module, nubbin, bbox edit, vertex-N, line handles, callout family, page ctx, thumbnail, Fit height, Bookmarks, Eraser/Counter catalogs, F3, counter-series Delete, Cloud bump, Search, keyboard, every-swatch, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome. UL-31 Continue pin stays parked.

## Why this is a GAP (and not Entity / checklist)

| Prior claim | What was actually asserted |
|---|---|
| U-01 Survey rail **pass** (live stamp + 390 Entity swatch) | 390 detail `Choose Survey Marker entity` picks GC. Sibling name chevron was unproven. |
| Template leftover “next” | Named this control. Not proven until this pass. |
| 390 Jump | Detail search button. Does not switch siblings. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| 390 `aria-label="Choose Survey Marker"` + listbox `Survey Markers in this category` | **GAP.** Switches `expandedSurveyMarkers` to a same-category sibling. |
| `Choose Survey Marker entity` | Already proven. Different control. |
| Checklist Y/N/N-A | Parked. Not this leftover. |
| One sibling | **Disabled after fix.** Button stayed enabled with a single marker. |
| Cancel (Escape / click-outside) | **Live.** Click-outside already; Escape now capture-closes so undo-Esc does not pop the place. |
| Same-id re-pick | **No-op after fix.** Closes the list without rewriting expanded id. |
| Pen-armed | **Live.** Still switches. |
| Jump after switch | **Live.** 390 detail Jump selects overlay B. |
| leftover-18 unplaced-rows / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / checklist Y/N/N-A / copyModeActive Copy-to-space / category Move/Copy stub | Parked / compile-hidden / dead stub. |

Did **not** invent a persist seam. Seeds use existing `__e2eSurveyMarkers`. No `file.id`.

## Source (before live)

- Detail chevron always opened the list, even with `siblingMarkers.length === 1`.
- Option click always called `setExpandedSurveyMarkers({ [sibling.id]: true })`.
- Outside `mousedown` closed the list. Escape did not (survey undo-Esc could fire).
- Jump uses `locateOrSetSurveyMarker(mobileDetailMarker)` — follows the switched id.

## Product fix

Min-viable `SurveySpacesRail.jsx` only (not `PDFViewer.jsx`):

1. `canSwitchSibling = siblingMarkers.length > 1` — disable + `aria-disabled` when only one marker.
2. Same-id option closes the list without rewriting expanded id.
3. Escape (capture) closes the shared detail dropdown so undo-Esc does not pop a place.

Did not touch `zoomGeneration`, SVG viewBox zoom, canvas sizing, or high-risk files. Did not revert Choose-template in-session picker / same-id no-op / Esc-close.

## Live-proved

Playwright `debug/scenarios/e2e-survey-390-choose-marker.spec.mjs` **1 / 1 (6.0s)** on Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1` (place on desktop → 390×844) + `text-search-glyph-lab.pdf` (solo seed). Node `survey390ChooseMarker.test.mjs` **3 / 3**. Did **not** run official `npm test` (no high-risk file). 8448 not loosened.

Receipt log: `SURVEY_390_CHOOSE_MARKER_PROOF` persist `null`, 390 `{ switcher: 1, disabled: true, jump: 1, entity: 1 }`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Two siblings, A → B | **pass** | Desktop place `switch-a` / `switch-b`; 390 detail name becomes `switch-b`. Store names unchanged. |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| One marker | **pass** | Seed `solo-seed`; switcher **disabled** + `aria-disabled`; list stays closed. |
| Escape cancel | **pass** | Listbox gone; detail stays `switch-a`. |
| Click-outside cancel | **pass** | Category-label `mousedown`; stays `switch-a`. |
| Same-id re-pick | **pass** | `switch-a` option closes list; name stays. |
| Pen-armed | **pass** | Still switches back to `switch-a`; both ids stay. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Switch then Jump | **pass** | After A→B, 390 Jump selects overlay B (`surveyMarker-251c8ebb-…`); A has no resize handles. |
| Entity is a different control | **pass** | `Choose Survey Marker entity` **1**. |

No `file.id` (`persist: null`). No error boundary. SVG default.

## Classification after this pass

- **GAP found and proven:** 390 detail Choose Survey Marker sibling switcher.
- **Product bugs fixed:** one-marker switcher stayed enabled; same-id rewrote expanded id; Escape cancel could have hit undo-Esc.
- **Omitted (not invented):** checklist Y/N/N-A, category Move/Copy stub, copy-mode toolbar, leftover-18 unplaced-rows, linked workbook.
- **Next unique leftover (not this pass):** 390 detail **checklist Y/N/N-A** (`aria-label={`${item.text} ${option}`}` / `applyChecklistResponseSelection`). Distinct from Entity and from this sibling switcher. Not category Move/Copy stub. Not leftover-18 unplaced-rows. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/SurveySpacesRail.jsx` (one-marker disable; same-id no-op; Escape cancel)
- `debug/scenarios/e2e-survey-390-choose-marker.spec.mjs`
- `tests/survey390ChooseMarker.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.

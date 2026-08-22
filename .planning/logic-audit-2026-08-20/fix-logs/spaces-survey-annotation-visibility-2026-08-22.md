# Spaces region-row Hide/Show survey annotations — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Spaces space-card reorder, the named leftover is Spaces region-row **Hide/Show survey annotations** (`aria-label="Hide survey annotations"` / `onToggleSurveyAnnotations`). Survey-context only. Sibling of already-proven canvas Hide/Show — did **not** replay that. Space CSV / PDF Pages stay leftover-18. Live-proved on `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist items / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, notes Photo/Video, 390 Choose Survey Marker, Choose survey template re-pick, Excel fail-closed, item Copy → space, survey-rail family, U-02 create/rename *space* / add-pages / region-row rename / canvas Hide/Show / Delete / space-card reorder. UL-31 Continue pin stays parked.

## Why this is the next GAP (and not canvas Hide/Show)

| Prior claim | What was actually asserted |
|---|---|
| Space-card reorder | Drag to rearrange. Named next leftover: Hide/Show survey annotations. |
| Region-row Hide/Show canvas annotations | Canvas-scoped page flag. Distinct `aria-label="Hide canvas annotations"`. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| `aria-label="Hide survey annotations"` / `onToggleSurveyAnnotations` | **GAP.** Page-level survey scope for the selected space. Survey-context only (`showSurveyPanel && selectedModuleId`). |
| Canvas Hide/Show light-bulb | Already proven. Same `region-visibility-button`; labels swap in survey context. |
| Toggle with no survey marks / absent outside survey / Pen-armed | **GAP.** |
| Two-space isolation / undo / 390 | **GAP.** Product is page-level per selected space, not per-region. |
| leftover-18 unplaced-rows / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / checklist items / copyModeActive Copy-to-space / category Move/Copy stub | Parked / compile-hidden / dead stub. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- Region-row survey icon `className="region-visibility-button"` → `onToggleSurveyAnnotations(spaceId, pageId, !visibilityState)` when `getPageVisibilityControlMode` is `SURVEY`.
- Disabled when `!isActive || activeSpaceId === null`. 300ms same-button debounce.
- `getSurveyAnnotationVisibilityState` reads `getPageAnnotationVisibilityState(page).surveyVisible` (first region on the page; **all areas on the page share it**).
- `isAnnotationVisibleByPageControl` hides **SURVEY** scope only. Canvas / region / survey-region skip the page control (overlay slider owns region-stamped).
- Survey mode itself hides ordinary canvas marks while the panel is open (`isAnnotationVisibleInSurveyMode`).
- `handleToggleSurveyAnnotations` was `setSpaces`-only. No `addHistoryCheckpoint`. Ctrl+Z after Hide rewound the last `space:update` (drawn region).

## Product fix

`PDFViewer.jsx` (min-viable) — `handleToggleSurveyAnnotations` now pre-checks `getPageAnnotationVisibilityState(livePage).surveyVisible` against the requested value, then `addHistoryCheckpoint('space:update', { spaceId, pageId, updateKeys: ['assignedPages'] })` only on a real flip. Sibling of `handleToggleCanvasAnnotations`. Did not loosen the function-only left-rail guard. Did not touch `zoomGeneration`, SVG viewBox zoom, canvas sizing, region Esc-cancel, overlay `role=switch`, `regionOverlayDisabledKey`, `noteHasContent`, region-rename / canvas-visibility / space-card-reorder checkpoints, or survey undo-Esc.

## Live-proved

Playwright `debug/scenarios/e2e-spaces-survey-annotation-visibility.spec.mjs` **1 / 1 (14.0s)** on Vite `http://127.0.0.1:5179` + `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Node `spacesSurveyAnnotationVisibility.test.mjs` **3 / 3**. Official `npm test` after PDFViewer: standing `pageOperationsQueueMounted` (`Cannot find module '/tmp/utils/pageContextOps.js'`). 8448 not loosened.

Receipt log: `SPACES_SURVEY_ANNOTATION_VISIBILITY_PROOF` persist `null`, `hiddenKeptInStore: true`, `regionScopedStays: true`, `canvasIsolation: true`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Hide survey-scoped marker | **pass** | Walls marker (`moduleId` set, `regionId` null) disappears from `[data-survey-marker-id]`. Store keeps it. Overlay switch stays Hide. |
| Show restores | **pass** | Same SVG id returns. |
| Scope | **pass** | Page-level per selected space. Survey-region-stamped marker stays. Canvas-scoped rect stays in store. |

### Break — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| No spaces | **pass** | Hide/Show survey count **0**. |
| Absent outside survey | **pass** | After Add-pages + Edit+Esc, light-bulb is Hide canvas. Hide survey **0** until KAL-436 + Walls. |
| Toggle with no survey marks | **pass** | Space 2 Hide/Show flips with no marks on that space. |
| Pen-armed | **pass** | Hide/Show while Pen `btn-active`. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo / redo | **pass** | Ctrl+Z after Hide restores the survey marker + Hide label; overlay stays. Ctrl+Shift+Z hides again. Region row stays. |
| Canvas isolation | **pass** | Canvas-scoped rect stays stored while survey hides; after Close Survey panel the rect is visible again and the button is Hide canvas. |
| Two spaces | **pass** | Page-level per selected space. Hide on Space 1; Turn on Space 2 shows the survey marker; Space 1 keeps its hidden flag (Show after re-activate). |
| 390 | **pass** | Create **1**; page-row count raced **0**; disabled **1**; Hide **0** this session (`surveyTransitionE2E` picker covers the dock until collapse/close). |

No error boundary. SVG default.

## Classification after this pass

- **GAP found and proven:** Spaces region-row Hide/Show survey annotations (desktop). Actual: hides **survey-scoped** page annotations for the selected space; survey-region-stamped marks stay; canvas-scoped marks stay in store and return after leaving survey.
- **Product bugs fixed:** survey visibility toggle had no undo checkpoint (sibling of canvas Hide/Show).
- **Omitted (not invented):** checklist items, category Move/Copy stub, copy-mode toolbar, leftover-18 unplaced-rows, linked workbook.
- **Next unique leftover (not this pass):** Spaces region-row **Go to page** (`aria-label="Go to page N"` / `onNavigateToPage`). Distinct from thumbnail click and the page-number input. Space CSV / PDF Pages stay leftover-18. Not leftover-18. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/PDFViewer.jsx` (`handleToggleSurveyAnnotations` checkpoint only)
- `debug/scenarios/e2e-spaces-survey-annotation-visibility.spec.mjs`
- `tests/spacesSurveyAnnotationVisibility.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.

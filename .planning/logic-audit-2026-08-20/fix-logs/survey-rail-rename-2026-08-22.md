# Survey-rail Rename — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After rail Delete selected items, the named leftover is rail **Rename** (`aria-label={`Rename ${name}`}` → `commitSurveyMarkerName`). Not overlay Delete. Not rail Delete. Not E-04 rect Backspace. Not counter-series Delete. Not U-01 Walls stamp-create. Not handle drag. Not Keep active / Survey notes / module nav as the GAP (notes only as a rename-blur conflict). Live-proved on `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick. Did **not** invent `.env.local`. Did **not** replay leftover-18, overlay delete, rail Delete, handle drag, U-01 Walls create, Keep active, Survey notes (as the GAP), Survey module, nubbin, bbox edit, vertex-N, line handles, callout family, page ctx, thumbnail, Fit height, Bookmarks, Eraser/Counter catalogs, F3, counter-series Delete, Cloud bump, Search, keyboard, every-swatch, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome. UL-31 Continue pin stays parked.

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| Rail Delete selected items | Select + confirm wipe. Rename field unexecuted. |
| Overlay Delete Survey Marker | SVG chrome + Select Backspace/Delete. Not the rail name field. |
| Survey notes | Save/Cancel on the Note dialog. Did not blur-commit a rename by opening notes. |
| e2e-survey-marker | Place / persist / export-exclude. No rail Rename after place. |
| Keep active / module nav | After-place arm + Previous/Next. Name field unexecuted. |

## Hunt (independent catalog)

Inspected first: `SurveySpacesRail` desktop `input.survey-marker-name-inline` + `commitSurveyMarkerName`.

| Candidate | Verdict |
|---|---|
| `aria-label={`Rename ${name}`}` | **GAP.** Desktop expanded-category row. Enter blurs; blur commits. |
| Empty name | **Fallback.** Trim-or-`Walls N` (`fallbackName`), not rejected, not left blank. |
| Duplicate name | **Allowed.** No unique/reject path in `commitSurveyMarkerName`. |
| Escape | **Cancel.** Restores the previous value, then blur no-ops (`nextName === oldName`). |
| None selected / none placed | **No field** before place. After place, the per-row field commits without item Select. |
| Pen-armed | **Still commits** if the field is focused. |
| Notes open | Blur-commit conflict only: clicking Add item notes commits the draft name. |
| Undo (before fix) | **Bug.** No checkpoint. Ctrl+Z popped B’s `highlight:create` (A reverted to `rail-a`, B gone). |
| 390 | Desktop inline field **absent** (`!mobileMode`). Mobile detail `Rename` exists in source after a placed marker is opened; Playwright place stays blocked (no `Open` rows). |
| leftover-18 / Print / Forms / Note create / Group / stamp / measure / Extract / Link create | Parked / compile-hidden. Not invented. |

## Source (before live)

- Desktop field gated `!mobileMode`. `key={`${annotationId}:${surveyMarkerName}`}` remounts after a stored-name change.
- `commitSurveyMarkerName`: trim; empty → `fallbackName`; same-name return; writes `surveyMarkers[id].name` and the linked item name. No duplicate reject.
- Enter → `blur()`. Escape restores `surveyMarkerName` then blurs.
- 390 list is tap-row `Open ${name}`; detail view has its own `Rename ${detailMarkerName}` input.

## Product fix

`commitSurveyMarkerName` now calls `addHistoryCheckpoint('survey-marker:rename', { annotationId })` before the store write. `PDFViewer` publishes `addHistoryCheckpoint` on `rightRailApi` (identity-only function compare unchanged). Live-before-fix Ctrl+Z deleted B; after-fix Z restores the name and keeps both markers.

Did not touch `data-handle={vertex-N}`, `data-counter-nubbin-handle`, `zoomGeneration`, SVG viewBox zoom, or canvas sizing.

## Live-proved

Playwright `debug/scenarios/e2e-survey-rail-rename.spec.mjs` **1 / 1 (6.2s)** on reused Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Node `surveyRailRename.test.mjs` **3 / 3**.

IDs: markerA `surveyMarker-9c439dbd-…`, markerB `surveyMarker-9d54e6c1-…`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Enter commit | **pass** | `ariaLabel` / value / `data-value` all `renamed-a`. |
| Blur commit | **pass** | Click B’s field; A became `renamed-blur`. |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| None placed | **pass** | No `survey-marker-name-inline` / `Rename rail-a` before place. |
| None selected | **pass** | Not in item Select; per-row field still committed. |
| Escape | **pass** | Typed `escaped-nope`; field stayed `rail-b`. |
| Empty name | **pass** | Fallback `Walls 1` (index can be `Walls 2` when A sorts second). |
| Duplicate | **pass** | Two `Rename rail-b` fields; product does not reject. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Rename one of two | **pass** | B stayed `rail-b` through Enter / blur / empty / Pen / notes-blur. |
| Pen-armed | **pass** | After `p`, Enter still stored `pen-renamed`. |
| Notes-blur conflict | **pass** | Click Add item notes committed `notes-commit`. |
| Undo | **pass** | After fix: both ids stayed; `after-undo` → two `rail-b`. Live-before-fix: B gone, A `rail-a`. |
| 390 | **pass** (absent desktop field) | `desktopInlineCount: 0`, `mobileDetailCount: 0`, `openRowCount: 0`. Desktop-only inline chrome. |

No `file.id`. No error boundary. SVG default. Official `npm test` after PDFViewer: suite exit 1 on unrelated standing `pageOperationsQueueMounted.test.mjs` (`Cannot find module '/tmp/utils/pageContextOps.js'`). Isolated `partialEraserComplexity` 8448 leftover not reached / not loosened.

## Classification after this pass

- **GAP found and proven:** survey-rail Rename Enter/blur + stored name + rail label.
- **Product bug fixed:** rename now has an undo checkpoint.
- **Omitted (not invented):** Delete selected categories, Create category, entity dropdown, Jump/Set location, Copy-to-space, eraser-on-marker replay.
- **Next unique leftover (not this pass):** rail **Delete selected categories** (`aria-label="Delete selected categories"` + confirm → `deleteCategory` + marker wipe). Not this Rename. Not item Delete. Not overlay Delete. Not E-04. Not counter-series Delete. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-survey-rail-rename.spec.mjs`
- `tests/surveyRailRename.test.mjs`
- `src/SurveySpacesRail.jsx` (rename checkpoint)
- `src/PDFViewer.jsx` (`addHistoryCheckpoint` on `rightRailApi`)
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.

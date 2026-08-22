# 390 checklist parked + notes Photo/Video attach — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After 390 Choose Survey Marker, the named leftover is 390 detail **checklist Y/N/N-A** (`aria-label={`${item.text} ${option}`}` / `applyChecklistResponseSelection`). Inspected compiled-in `surveyTransitionE2ETemplates` + `makeKal436Modules()`: **no template has checklist items**. `__e2eSurveyMarkers` patches marker state only; there is no `__e2eSurveyChecklist` / template-checklist seed. HubPreview Security Walk-Through items (`i1`–`i6`) live in the templates editor, not the viewer rail. Did **not** invent checklist items in product data. Parked. Next unique leftover is notes **Photo/Video attach** (desktop `Upload photos` / `Upload videos` + 390 Photo / Video). Distinct from text notes Save/Cancel. Live-proved on `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist items / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, 390 Choose Survey Marker, Choose survey template re-pick, Excel fail-closed, item Copy → space, item reorder, category reorder, empty-module Create template, place-time Entity dialog, rail Entity picker, Jump / Set location, Create category plus, category Delete, Rename, item Delete, overlay delete, handle drag, U-01 Walls create, Keep active, Survey notes **text**, Survey module, nubbin, bbox edit, vertex-N, line handles, callout family, page ctx, thumbnail, Fit height, Bookmarks, Eraser/Counter catalogs, F3, counter-series Delete, Cloud bump, Search, keyboard, every-swatch, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome. UL-31 Continue pin stays parked.

## Why checklist is parked (not a GAP this pass)

| Candidate | Verdict |
|---|---|
| KAL-436 Walls / Doors | Categories have `id` / `name` / `color` only. No `checklist`. |
| Survey Entities Template | Same `makeKal436Modules()` + entities. No items. |
| Empty Module Template | `categories: []`. |
| Two Category Template | Walls + Windows, no `checklist`. |
| `__e2eSurveyMarkers` | Marker store only. Cannot attach items to a category. |
| HubPreview `MOCK_TEMPLATES` | Cameras / Doors items exist, but `?hubPreview=1` is TemplatesEditor (U-04 archive), not 390 detail Y/N/N-A. |
| Invent a fifth seed / patch `category.checklist` | Forbidden unless a DEV seed pattern already exists. None does. |

390 empty-state **No checklist items** is live (source + 390). Y / N / N-A buttons are **0**.

## Why Photo/Video is the next GAP (and not text notes)

| Prior claim | What was actually asserted |
|---|---|
| Survey notes **pass** | Desktop text Save / Cancel / empty / huge. Photo/Video never uploaded. |
| 390 notes button | Opens the in-sheet editor. Attachments unproven. |
| U-04 Checklists | HubPreview archive-with-markers. Not viewer Y/N/N-A. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| 390 `aria-label={`${item.text} ${option}`}` | **Parked.** No items in any compiled-in seed. |
| Desktop `Upload photos` / `Upload videos` + 390 Photo / Video | **GAP.** Writes `note.photos` / `note.videos` `{ name, dataUrl }`. |
| Text notes Save/Cancel | Already proven. Not replayed as the GAP. |
| 390 Rename | Replay of rail Rename. Not this leftover. |
| Category Move/Copy stub toast | Dead stub. Not invented. |
| leftover-18 unplaced-rows / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / copyModeActive Copy-to-space | Parked / compile-hidden / dead stub. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- Desktop Note dialog (PDFViewer) hidden file inputs `#photo-upload-${id}` / `#video-upload-${id}` FileReader → `{ name, dataUrl }`. Save patches `surveyMarkers[id].note`. Cancel closes without a write. No `addHistoryCheckpoint`.
- 390 in-sheet editor uses the same shape via `addMobileNoteMedia` / `saveMobileNotes`. Remove uses `aria-label={`Remove ${name}`}`. Empty file list no-ops.
- Checklist handler `applyChecklistResponseSelection` is compiled-in but unreachable without `category.checklist`.

## Product fix

None. Photo/Video attach already wrote the store. Did not invent checklist items. Did not touch `zoomGeneration`, SVG viewBox zoom, canvas sizing, or high-risk files.

## Live-proved

Playwright `debug/scenarios/e2e-survey-checklist-or-next.spec.mjs` on Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Node `surveyChecklistOrNext.test.mjs` **3 / 3**. Did **not** run official `npm test` (no high-risk file). 8448 not loosened.

Receipt log: `SURVEY_CHECKLIST_OR_NEXT_PROOF` persist `null`.

### Checklist — **parked**

| Slice | Verdict | Evidence |
|---|---|---|
| Compiled-in seeds | **no items** | Four `surveyTransitionE2E` templates; `makeKal436Modules` has no `checklist:`. |
| DEV seed hook | **none** | `__e2eSurveyMarkers` only. |
| 390 empty-state | **live** | `No checklist items`. Y / N / N-A **0**. |

### Photo/Video intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Desktop photo + video Save | **pass** | `keep-photo.png` + `keep-video.webm` on A; dataUrl `data:image/png;base64,…`. |
| B isolated | **pass** | B photos `[]`. |

### Break — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Cancel after draft attach | **pass** | `draft-should-die.png` discarded. |
| Empty Save | **pass** | photos/videos `[]`. |
| Remove draft before Save | **pass** | `remove-me.png` gone; `keep-photo.png` stayed. |
| Pen-armed | **pass** | Still attached `pen-armed.png`; both ids stayed. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo | **pass** (no note checkpoint) | Ctrl+Z left attachments in place. |
| 390 same chrome | **pass** | Photo / Video present; `mobile-extra.png` saved; Cancel after Remove kept the stored extra. |
| no `file.id` | **pass** | `persist: null`. |

No error boundary. SVG default.

## Classification after this pass

- **GAP found and proven:** notes Photo/Video attach (desktop + 390).
- **Parked this pass:** 390 checklist Y/N/N-A (no compiled-in items; no DEV seed hook).
- **Product bugs fixed:** none.
- **Omitted (not invented):** checklist items in product data, category Move/Copy stub, copy-mode toolbar, leftover-18 unplaced-rows, linked workbook.
- **Next unique leftover (not this pass):** Spaces **Edit region areas on the page** (`aria-label="Edit region areas on the page"` / Region Selection Tool) + overlay on/off / last space. Distinct from Create space / rename / add-pages. Not leftover-18. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-survey-checklist-or-next.spec.mjs`
- `tests/surveyChecklistOrNext.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.

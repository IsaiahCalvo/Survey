# Survey-rail item Copy → space selection — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After item reorder, the named leftover is rail item **Copy → `setShowSpaceSelection`**. This is a **live compiled-in control**, distinct from the dead copy-mode stub. Live-proved on `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1` (KAL-436 Walls → Two Category Survey). Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist Y/N/N-A. Did **not** invent `.env.local`. Did **not** replay leftover-18, item reorder, category reorder, empty-module Create template, place-time Entity dialog, rail Entity picker, Jump / Set location, Create category plus, category Delete, Rename, item Delete, overlay delete, handle drag, U-01 Walls create, Keep active, Survey notes, Survey module, nubbin, bbox edit, vertex-N, line handles, callout family, page ctx, thumbnail, Fit height, Bookmarks, Eraser/Counter catalogs, F3, counter-series Delete, Cloud bump, Search, keyboard, every-swatch, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome. UL-31 Continue pin stays parked.

## Why this is a GAP (and not the dead stub)

| Prior claim | What was actually asserted |
|---|---|
| Copy-to-space / `setCopyModeActive` | `setCopyModeActive(true)` has **zero callers**. The "Copy to Spaces" toolbar inside `copyModeActive` is unreachable. Still parked. |
| Category Move/Copy stub | Heading-row Select → `showToast('Move/Copy functionality… to be implemented.')`. Different control. Still parked. |
| Hub documents Move/Copy | Catalog-reconcile extra. Not survey-rail items. |
| Item Delete Select toolbar | Same Select mode; Delete was the GAP. Copy was not hunted. |

## Hunt (independent catalog)

Inspected first: expanded-category item toolbar `Copy` (`aria-label="Item selection actions"`) → `setCopiedItemSelection` + `setShowSpaceSelection(true)` → PDFViewer "Select space" modal. Reachable without `copyModeActive`. Desktop only (`!copyModeActive && !mobileMode`).

| Candidate | Verdict |
|---|---|
| Item toolbar Copy | **GAP / live.** Select ≥1 item → Copy opens "Select space". |
| `setCopyModeActive(true)` / Copy to Spaces | **Dead stub.** Zero callers. Documented, not invented. |
| Category Move/Copy | **Parked stub toast.** |
| Disabled none-selected | **No-op.** Copy present, disabled. |
| Cancel picker (X) | **No-op.** Source stays; dest empty. |
| Dest without Walls (Other) | **Blocked.** Toast: categories don't exist; no dest write. |
| Dest with Walls (Two Category Survey) | **Copies.** New id in `kal436-two-category-module` / `kal436-two-cat-walls`; source id stays. Overlay switches to dest (source overlay hidden). |
| Pen-armed | **Still works.** Place on dest Walls, arm Pen, Copy back to Existing. |
| Undo | **Product checkpoint added.** Live-before-fix: undeclared `sourceSpaceId` + `template.spaces` only (E2E templates have `modules`) → empty picker / crash on confirm. After `survey-marker:copy`, Ctrl+Z drops dest copy; source stays. |
| 390 | **Absent.** No item Select/Copy toolbar; no picker. |
| leftover-18 / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / checklist Y/N/N-A / copyModeActive Copy-to-space / category Move/Copy stub | Parked / compile-hidden / dead stub. |

Did **not** invent a checklist fixture. Cloud persist of `?testPdf=` fails closed — not invented.

## Source (before live)

- Item Copy stores selected ids in `copiedItemSelection` and opens the space modal. Does not call `setCopyModeActive(true)`.
- Modal aggregated `template.spaces` only. E2E / live templates store `modules` → "No spaces available in any template."
- Item-copy confirm used undeclared `sourceSpaceId` (ReferenceError) and `template.spaces.find`.
- Entity-less KAL-436 Save writes surveyMarkers only (no `items`) → legacy clone path.
- Live-before-fix: no `addHistoryCheckpoint` (last place would undo).
- Desktop toolbar only; 390 item rows have no Select/Copy.

## Product fix

Min-viable `PDFViewer.jsx` space-selection modal only:

1. List `template.modules || template.spaces`.
2. Empty dest list after filtering source → same "No spaces available" copy.
3. Use already-computed `sourceModuleId` (not undeclared `sourceSpaceId`).
4. Dest lookup `modules || spaces`.
5. `setSelectedModuleId(space.id)` after copy so the rail follows the dest.
6. `survey-marker:copy` checkpoint before the dest write — sibling of rename/entity/reorder so Ctrl+Z drops the copy instead of the last place.

Did not wire `setCopyModeActive(true)`. Did not revert `survey-marker:reorder` or other survey undo/Esc siblings. Did not touch `data-handle={vertex-N}`, `data-counter-nubbin-handle`, `zoomGeneration`, SVG viewBox zoom, or canvas sizing.

## Live-proved

Playwright `debug/scenarios/e2e-survey-rail-item-copy-space.spec.mjs` **1 / 1 (6.1s)** on Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Node `surveyRailItemCopySpace.test.mjs` **3 / 3**. Official `npm test` after PDFViewer: standing leftover `partialEraserComplexity` **11892.57 > 8448** (not loosened). `pageOperationsQueueMounted` `/tmp/utils/pageContextOps.js` miss is an isolation flake, not this modal.

Receipt log: `SURVEY_RAIL_ITEM_COPY_SPACE_PROOF` sourceId `surveyMarker-67aae8fb-6d8c-44e8-bc4e-1c8b90cc3eb2`, dest `kal436-two-category-module` / `kal436-two-cat-walls`, persist `null`, 390 `{ itemToolbar: 0, copyBtn: 0, spacePicker: 0 }`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Copy → Two Category Survey | **pass** | Dest store has `copy-a` new id, category `kal436-two-cat-walls`; source id stays. Dest overlay shows the copy; source overlay hidden after module switch. |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| Cancel picker | **pass** | X closed "Select space"; dest count 0; source stayed. |
| No usable dest (Other, Doors only) | **pass** | Toast categories don't exist; dest count 0. Empty-state "No spaces available in any template." is the allSpaces/availableModules === 0 path (Node); live E2E templates have dest modules after the modules-or-spaces fix. |
| Pen-armed | **pass** | After undo, place `copy-pen` on dest Walls, arm Pen, Copy → Existing; source `copy-a` stayed. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo | **pass** | Ctrl+Z dest count 0; source id stayed. |
| 390 | **pass** (absent) | `itemToolbar: 0`, `copyBtn: 0`, `spacePicker: 0`. |

No `file.id` (`persist: null`). No error boundary. SVG default.

## Classification after this pass

- **GAP found and proven:** rail item toolbar Copy → space picker → dest module clone (legacy surveyMarker path on `?testPdf=`).
- **Product bugs fixed:** picker ignored `modules`; confirm used undeclared `sourceSpaceId` + `.spaces.find`; missing undo checkpoint; dest switch did not set `selectedModuleId`.
- **Dead stub documented:** `setCopyModeActive(true)` still has zero callers. "Copy to Spaces" stays parked.
- **Omitted (not invented):** checklist Y/N/N-A (KAL-436 still has no checklist items), category Move/Copy stub toast, copy-mode toolbar.
- **Next unique leftover (not this pass):** rail **Excel actions chevron** (`aria-label="Excel actions"` → Open linked / Update existing fail-closed when no `linkedExcelPath`). Distinct from leftover-18 X-06 writeback and from the already-proven EXPORT download. Not checklist Y/N/N-A. Not category Move/Copy stub. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/PDFViewer.jsx` (space-selection modal: modules-or-spaces, `sourceModuleId`, dest lookup, `setSelectedModuleId`, `survey-marker:copy`)
- `debug/scenarios/e2e-survey-rail-item-copy-space.spec.mjs`
- `tests/surveyRailItemCopySpace.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.

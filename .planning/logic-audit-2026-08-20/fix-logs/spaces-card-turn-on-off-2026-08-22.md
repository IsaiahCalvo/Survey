# Spaces card Turn on/off — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Spaces card Expand/Collapse, the named leftover is Spaces card **Turn on/off** (`aria-label="Turn on space"` / `"Turn off space"` / `onToggleSpace` / `handleToggleSpace`). Distinct from Expand/Collapse (`aria-label="Expand"` / `"Collapse"` / `onToggleExpand`) and from leftover-18 Space CSV / PDF Pages (`onExportSpaceCSV` / `onExportSpacePDF`). Last-space off/on and Turn-on-with-no-regions were Edit-region **contrast** only — this pass owns the control’s intended + break + edge (active flag, overlay, page lock). Reused Create + Add pages + draw region only as setup — did **not** replay Expand/Collapse, Go to page, Hide/Show survey or canvas, space-card reorder, region Delete/rename, or Edit region as the GAP. Space CSV / PDF Pages stay leftover-18. Live-proved on `?testPdf=clickable-link-test.pdf` + `spike-120-pages.pdf` for page lock. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist items / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, notes Photo/Video, 390 Choose Survey Marker, Choose survey template re-pick, Excel fail-closed, item Copy → space, survey-rail family, U-02 create/rename *space* / add-pages / region-row rename / canvas Hide/Show / Delete / space-card reorder / survey Hide/Show / Go to page / Expand/Collapse. UL-31 Continue pin stays parked.

## Why this is the next GAP (and not Expand/Collapse or leftover-18 export)

| Prior claim | What was actually asserted |
|---|---|
| Expand/Collapse | Chevron hides/shows inner rows. Named leftover after that pass: Turn on/off. |
| Edit-region last-space off/on | Contrast only — overlay hide/show after Confirm. Not this control’s intended/break/edge. |
| Space CSV / PDF Pages | Leftover-18 header export. Not the toggle. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| `aria-label="Turn on space"` / `"Turn off space"` / `space-toggle-control` / `onToggleSpace` | **GAP.** Spaces tab only. |
| `handleToggleSpace` → `onSetActiveSpace` / `onExitSpaceMode` | **GAP.** Single `activeSpaceId`. No `addHistoryCheckpoint`. |
| `spaceHasActivatableRegions` + `shouldShowPage` page lock | **GAP.** |
| Empty card / two cards / Pen-armed / last-space / 390 | **GAP.** |
| leftover-18 Space CSV / PDF Pages / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / checklist items / copyModeActive Copy-to-space / category Move/Copy stub | Parked / compile-hidden / dead stub. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- Toggle `className="space-toggle-control"` → `aria-label={isActive ? 'Turn off space' : 'Turn on space'}` → `onToggleSpace(space.id, !isActive)` with `stopPropagation`.
- `handleToggleSpace`: on → `setSelectedSpaceId` + `onSetActiveSpace`; off → clear selected + `onExitSpaceMode` if this id is active.
- `handleSetActiveSpace` requires `spaceHasActivatableRegions` (assigned page with `regions.length > 0`); else toast `This space has no regions yet…` and return. `setActiveSpaceId(spaceId)` is a single id — only one space active.
- `handleExitSpaceMode` → `setActiveSpaceId(null)`. Neither path checkpoints history.
- Overlay: `isRegionOverlayEnabled` is false unless `activeSpaceId === spaceId`.
- Page lock: `shouldShowPage` returns true when no active space; otherwise only `activeSpacePages`. pdf.js page divs get `display: none`; Pages rail filters thumbs.

## Product fix

None. Toggle already gated activation on a drawn region; exclusivity is the single `activeSpaceId`; Turn off clears overlay + page lock; undo pops `space:update`, not the toggle. Did not touch `PDFViewer.jsx` / `SpacesPanel.jsx`. Did not loosen 8448. Did not touch `zoomGeneration`, SVG viewBox zoom, canvas sizing, region Esc-cancel, overlay `role=switch`, or survey undo-Esc siblings.

## Live-proved

Playwright `debug/scenarios/e2e-spaces-card-turn-on-off.spec.mjs` **1 / 1 (25.4s)** on Vite `http://127.0.0.1:5188` + `?testPdf=clickable-link-test.pdf` (page lock on `spike-120-pages.pdf`). Node `spacesCardTurnOnOff.test.mjs` **3 / 3**. No high-risk file. 8448 not loosened.

Receipt log: `SPACES_CARD_TURN_ON_OFF_PROOF` persist `null`, `pageLockHidden: true`, `pageLockRestored: true`, `pagesThumbLocked: true`, `pagesThumbRestored: true`, `mobileCreate: 1`, `mobileTurnOn: 2`, `mobileTurnOff: 1`, `mobileToastStayOff: true`, `mobileToggled: true`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Turn off deactivates | **pass** | After Confirm: `Turn off space`, overlay root, `__diagState.activeSpaceId` set. Turn off → overlay **0**, active id **null**. |
| Turn on reactivates | **pass** | Turn on → overlay back, same `activeSpaceId`. |
| Page lock | **pass** | spike-120 assigned page 1 only: page-2 `display:none`; Pages thumb 2 **0**. Turn off restores page 2 + thumb. |
| Scope | **pass** | `handleToggleSpace` / `onSetActiveSpace` / `onExitSpaceMode`. Not `handleToggleExpand`. Not `onExportSpaceCSV` / `onExportSpacePDF`. |

### Break — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| No spaces | **pass** | Turn on/off count **0**. |
| Turn on with no regions | **pass** | Empty Create + Add pages (no draw) toast `no regions yet`, stay `Turn on space`, active id null, overlay **0**. |
| Pen-armed | **pass** | Turn off Space 1 / Turn on Space 2; Pen `btn-active`. |
| Two cards | **pass** | Failed Turn on Space 2 does not steal Space 1. After Space 2 Confirm, only one `Turn off`. Turn on Space 1 exclusivity. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Last-space off/on | **pass** | Only Space 1: off → overlay 0; on → overlay back. |
| Undo | **pass** | Product does **not** checkpoint the toggle. Toolbar Undo after Turn off pops Space 2 `space:update` (drawn region). Page row stays. Overlay stays **0**; Turn on Space 2 toasts. Redo restores the region so Turn on works. |
| 390 | **pass** | Create **1**; Turn on toasted and stayed off (`mobileToastStayOff`). Panel later showed Turn on **2** / Turn off **1** (entering Edit activates; extra accessible names on the sheet). Control exists. |

No error boundary. SVG default.

## Classification after this pass

- **GAP found and proven:** Spaces card Turn on/off (desktop + 390). Actual: Turn off clears `activeSpaceId` + overlay + page lock; Turn on restores them when a drawn region exists; only one space active; Add pages is not enough; Pen-armed still toggles; undo pops `space:update`, not the toggle.
- **Product bugs fixed:** none.
- **Omitted (not invented):** checklist items, category Move/Copy stub, copy-mode toolbar, leftover-18 unplaced-rows, linked workbook.
- **Next unique leftover (not this pass):** leftover-18 Space CSV / PDF Pages (`onExportSpaceCSV` / `onExportSpacePDF`) stay **parked**. Do not invent Print / stamp / measure / Group / Extract / Note-Link / checklist items / Copy-to-Spaces. UL-31 Continue pin stays parked. Do **not** re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`). Space CSV / PDF Pages stay in that park list.
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-spaces-card-turn-on-off.spec.mjs`
- `tests/spacesCardTurnOnOff.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.

# Spaces card Expand/Collapse — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Spaces region-row Go to page, the named leftover is Spaces card **Expand/Collapse** (`aria-label="Expand"` / `"Collapse"` / `onToggleExpand`). Distinct from Turn on/off (`aria-label="Turn on space"` / `"Turn off space"` / `handleToggleSpace`) and from leftover-18 Space CSV / PDF Pages (`onExportSpaceCSV` / `onExportSpacePDF`). Reused Create + Add pages only as setup — did **not** replay Go to page as the GAP, Edit region draw, canvas Hide/Show, survey Hide/Show, Delete, rename, or space-card reorder. Space CSV / PDF Pages stay leftover-18. Live-proved on `?testPdf=clickable-link-test.pdf`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist items / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, notes Photo/Video, 390 Choose Survey Marker, Choose survey template re-pick, Excel fail-closed, item Copy → space, survey-rail family, U-02 create/rename *space* / add-pages / region-row rename / canvas Hide/Show / Delete / space-card reorder / survey Hide/Show / Go to page. UL-31 Continue pin stays parked.

## Why this is the next GAP (and not Turn on/off or leftover-18 export)

| Prior claim | What was actually asserted |
|---|---|
| Region-row Go to page | Pill `Go to page N` → `handleNavigateToSpacePage`. Named leftover after that pass: Expand/Collapse. |
| Turn on/off | Activate/deactivate the space. Used here only as **contrast** (Collapse does not flip the toggle). |
| Space CSV / PDF Pages | Leftover-18 header export. Not the chevron. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| `aria-label="Expand"` / `"Collapse"` / `space-card-expand-button` / `onToggleExpand` | **GAP.** Spaces tab only. |
| `handleToggleExpand` → local `expandedSpaces` Set | **GAP.** Not persisted; not a history checkpoint. |
| Empty card / two cards / Pen-armed / 390 | **GAP.** |
| leftover-18 Space CSV / PDF Pages / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / checklist items / copyModeActive Copy-to-space / category Move/Copy stub | Parked / compile-hidden / dead stub. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- Chevron `className="space-card-expand-button"` → `aria-label={isExpanded ? 'Collapse' : 'Expand'}` → `onToggleExpand(space.id)` with `stopPropagation` (header click also toggles).
- Inner Add-pages + `.space-region-row` list is `{isExpanded && (…)}` — collapsed cards omit those nodes.
- `handleToggleExpand` flips a local `Set`. No `addHistoryCheckpoint`. No `onToggleSpace`. No export.
- Newly created ids are added to `expandedSpaces` (auto-expand). Turn on/off is `handleToggleSpace` → `onSetActiveSpace` / `onExitSpaceMode`.

## Product fix

None. Chevron already hid/showed inner rows; two cards keep independent Set membership; undo pops `space:create`, not the expand flag. Did not touch `PDFViewer.jsx` / `SpacesPanel.jsx`. Did not loosen 8448. Did not touch `zoomGeneration`, SVG viewBox zoom, canvas sizing, region Esc-cancel, overlay `role=switch`, or survey undo-Esc siblings.

## Live-proved

Playwright `debug/scenarios/e2e-spaces-card-expand-collapse.spec.mjs` **1 / 1 (11.5s)** on reused Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf`. Node `spacesCardExpandCollapse.test.mjs` **3 / 3**. No high-risk file. 8448 not loosened.

Receipt log: `SPACES_CARD_EXPAND_COLLAPSE_PROOF` persist `null`, `collapseHidesRegion: true`, `expandShowsRegion: true`, `twoCardIsolation: true`, `undoPopsCreateNotChevron: true`, `mobileCreate: 1`, `mobileCollapse: 1`, `mobileHidRows: true`, `mobileShowedRows: true`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Collapse hides inner rows | **pass** | Add page 1; Collapse → region row **0**, Add pages **0**, `Go to page 1` **0**. Chevron `space-card-expand-button`; not Turn on/off. |
| Expand shows them again | **pass** | Expand → region row **1** + Add pages + `Go to page 1`. |
| Scope | **pass** | Local `expandedSpaces` Set / `handleToggleExpand`. Not `handleToggleSpace`. Not `onExportSpaceCSV` / `onExportSpacePDF`. |

### Break — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| No spaces | **pass** | Expand/Collapse count **0**. |
| Expand with no pages | **pass** | Create auto-expands Add pages; Collapse hides it (region **0**); Expand shows Add pages again. |
| Pen-armed | **pass** | Expand Space 1 / Collapse Space 2; Pen `btn-active`. |
| Two cards | **pass** | Collapse Space 1 hides its row; Space 2 stays Collapse + row. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo | **pass** | Product does **not** checkpoint the chevron. Ctrl+Z after Collapse pops Space 2 `space:create` (card gone). Space 1 stays expanded with its row. Redo re-mints Space 2 auto-expanded (new-id effect). |
| Turn on/off contrast | **pass** | Collapse left `Turn on space` unchanged. |
| 390 | **pass** | Create **1**; Collapse **1**; DOM click hid rows; Expand showed them again (`mobileHidRows` / `mobileShowedRows`). Panel Expand count **3** includes extra accessible names on the sheet; the live card hid/showed. |

No error boundary. SVG default.

## Classification after this pass

- **GAP found and proven:** Spaces card Expand/Collapse (desktop + 390). Actual: chevron flips a local Set; Collapse omits Add pages + region rows; Expand restores them; two cards are independent; Pen-armed still toggles; undo pops create, not the chevron.
- **Product bugs fixed:** none.
- **Omitted (not invented):** checklist items, category Move/Copy stub, copy-mode toolbar, leftover-18 unplaced-rows, linked workbook.
- **Next unique leftover (not this pass):** Spaces card **Turn on/off** (`aria-label="Turn on space"` / `"Turn off space"` / `onToggleSpace` / `handleToggleSpace`). Distinct from Expand/Collapse. Last-space off/on and Turn-on-with-no-regions were Edit-region contrast only — not this control’s intended/break/edge. Space CSV / PDF Pages stay leftover-18. Not leftover-18. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`). Space CSV / PDF Pages stay in that park list.
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-spaces-card-expand-collapse.spec.mjs`
- `tests/spacesCardExpandCollapse.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.

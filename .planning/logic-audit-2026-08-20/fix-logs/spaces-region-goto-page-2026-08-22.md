# Spaces region-row Go to page — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Spaces region-row Hide/Show survey annotations, the named leftover is Spaces region-row **Go to page** (`aria-label="Go to page N"` / `onNavigateToPage` / `handleNavigateToSpacePage`). Distinct from thumbnail left-click (`resolvePageThumbnailClick` → `goToPage`) and from the rail page-number input (`commitPageInput`). Reused Add pages only as setup — did **not** replay Edit region draw, canvas Hide/Show, survey Hide/Show, Delete, rename, or space-card reorder. Space CSV / PDF Pages stay leftover-18. Live-proved on `?testPdf=spike-120-pages.pdf` + `clickable-link-test.pdf` for 1-page stay. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist items / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, notes Photo/Video, 390 Choose Survey Marker, Choose survey template re-pick, Excel fail-closed, item Copy → space, survey-rail family, U-02 create/rename *space* / add-pages / region-row rename / canvas Hide/Show / Delete / space-card reorder / survey Hide/Show. UL-31 Continue pin stays parked.

## Why this is the next GAP (and not thumbnail / page input)

| Prior claim | What was actually asserted |
|---|---|
| Thumbnail left-click | Pages panel `data-page-number` → `resolvePageThumbnailClick`. Named leftover after survey Hide/Show: region-row Go to page. |
| Rail page-number input | UL-07 / `commitPageInput`. Used here only to **leave** the region page. |
| Survey Hide/Show | Light-bulb. Named next leftover: Go to page. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| `aria-label="Go to page N"` / `region-page-pill` / `onNavigateToPage?.(page.pageId)` | **GAP.** Spaces tab only. |
| `handleNavigateToSpacePage` → `goToPage(..., { bypassActiveSpace: true })` | **GAP.** Distinct from Pages `onNavigateToPage: goToPage`. |
| No region / already-on-page stay / Pen-armed | **GAP.** |
| Two regions on different pages / 390 | **GAP.** |
| leftover-18 Space CSV / PDF Pages / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / checklist items / copyModeActive Copy-to-space / category Move/Copy stub | Parked / compile-hidden / dead stub. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- Region-row leading pill `className="region-page-pill region-page-pill-leading"` → `aria-label={`Go to page ${page.pageId}`}` → `onNavigateToPage?.(page.pageId)`.
- `PDFSidebar` Spaces tab passes `onNavigateToPage={onNavigateToSpacePage}`. Pages tab still passes `onNavigateToPage`.
- `handleNavigateToSpacePage` coerces `pageId`, no-ops invalid ids, Fit-page, then `goToPage(targetPage, { fallback: 'nearest', bypassActiveSpace: true })` on 0/120/320/650ms timers.
- Active-space `goToPage` without bypass clamps to `activeSpacePages`. The pill must bypass so it still works after Turn off (needed to leave via page input).

## Product fix

None. Wiring already called `handleNavigateToSpacePage` with `bypassActiveSpace: true`. Did not touch `PDFViewer.jsx` / `SpacesPanel.jsx`. Did not loosen 8448. Did not touch `zoomGeneration`, SVG viewBox zoom, canvas sizing, region Esc-cancel, overlay `role=switch`, or survey undo-Esc siblings.

## Live-proved

Playwright `debug/scenarios/e2e-spaces-region-goto-page.spec.mjs` **1 / 1 (8.2s)** on Vite `http://127.0.0.1:5173` + `?testPdf=spike-120-pages.pdf` (1-page stay on `clickable-link-test.pdf`). Node `spacesRegionGotoPage.test.mjs` **3 / 3**. No high-risk file. 8448 not loosened.

Receipt log: `SPACES_REGION_GOTO_PAGE_PROOF` persist `null`, `returnedViaPill: true`, `twoRegionEachPage: true`, `mobileGoTo: 1`, `mobileJumped: true`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Leave then return | **pass** | Add page 3; Turn off; page input **5**; click `Go to page 3` → viewer page 3. Pill has `region-page-pill`; not a Pages thumbnail. Spaces tab stayed open. |
| Scope | **pass** | `handleNavigateToSpacePage` / `bypassActiveSpace`. Not `commitPageInput`. Not thumb click. |

### Break — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| No spaces | **pass** | Go to page count **0**. |
| Create without Add pages | **pass** | Region rows **0**; Go to page **0**. |
| Already on that page | **pass** | Re-click `Go to page 3` stays 3. 1-page fixture: only `Go to page 1`; click stays 1; `Go to page 2` **0**. |
| Pen-armed | **pass** | Input 8 then pill 3; Pen `btn-active`. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Two regions | **pass** | Space 2 pages `1,5`. From page 2: pill 5 → 5; pill 1 → 1; pill 5 → 5. |
| 390 | **pass** | Create **1**; page-row class raced **0**; `Go to page 3` **1**; DOM click `mobileJumped: true`. |

No error boundary. SVG default.

## Classification after this pass

- **GAP found and proven:** Spaces region-row Go to page (desktop + 390). Actual: pill calls `handleNavigateToSpacePage` → `goToPage` with `bypassActiveSpace`; leaves via page input, returns via pill; stay on same page; two pills go to their own pages.
- **Product bugs fixed:** none.
- **Omitted (not invented):** checklist items, category Move/Copy stub, copy-mode toolbar, leftover-18 unplaced-rows, linked workbook.
- **Next unique leftover (not this pass):** Spaces card **Expand/Collapse** (`aria-label="Expand"` / `"Collapse"` / `onToggleExpand`). Distinct from Turn on/off and from leftover-18 Space CSV / PDF Pages. Not leftover-18. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`). Space CSV / PDF Pages stay in that park list.
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-spaces-region-goto-page.spec.mjs`
- `tests/spacesRegionGotoPage.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.

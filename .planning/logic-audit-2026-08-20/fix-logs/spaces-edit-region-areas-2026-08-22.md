# Spaces Edit region areas + overlay on/off + last space — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After notes Photo/Video attach, the named leftover is Spaces **Edit region areas on the page** (`aria-label="Edit region areas on the page"` / Region Selection Tool) + overlay on/off + last space. Distinct from Create space / rename / add-pages (U-02 cluster that only covered stamp/list presence). Not leftover-18. Live-proved on `?testPdf=clickable-link-test.pdf`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist items / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, notes Photo/Video, 390 Choose Survey Marker, Choose survey template re-pick, Excel fail-closed, item Copy → space, item reorder, category reorder, empty-module Create template, place-time Entity dialog, rail Entity picker, Jump / Set location, Create category plus, category Delete, Rename, item Delete, overlay delete, handle drag, U-01 Walls create, Keep active, Survey notes, Survey module, nubbin, bbox edit, vertex-N, line handles, callout family, page ctx, thumbnail, Fit height, Bookmarks, Eraser/Counter catalogs, F3, counter-series Delete, Cloud bump, Search, keyboard, every-swatch, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome. UL-31 Continue pin stays parked.

## Why this is the next GAP (and not Create/rename/add-pages)

| Prior claim | What was actually asserted |
|---|---|
| U-02 **pass** (create + rename + pages) | Spaces tab + Create space + Hunt Space rename + page `99` reject / page `1` add. Catalog completeness clicked overlay only `if (count)` — the control is a **div**, so count was 0. |
| Adversarial last-space delete | Create then delete with **no region**. Overlay / Edit region unproven. |
| pages-move-up-down | Clicks Edit region only to arm a filter, then Esc + Pages. No draw / Confirm / overlay toggle. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| `aria-label="Edit region areas on the page"` / Region Selection Tool | **GAP.** Draw / Confirm / Exit / Esc / Cancel. |
| Overlay Hide/Show (`role="switch"`) | **GAP.** Catalog completeness never hit the div. |
| Last space on/off + delete with a drawn region | **GAP.** Distinct from empty last-space delete. |
| Create / space rename / add-pages | Already proven. Not replayed as the GAP. |
| leftover-18 unplaced-rows / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / checklist items / copyModeActive Copy-to-space / category Move/Copy stub | Parked / compile-hidden / dead stub. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- `SpacesPanel` page-row edit button toggles `onRequestRegionEdit` / `onCancelRegionEdit`. Label flips to `Exit region edit` while `isRegionSelectionActive` matches this space+page.
- Overlay control was a 28×16 `div` with `tip()` spread after `onClick`. Inactive label **Enable space to toggle overlay**; after region-edit activates the space without a polygon, **Define regions first to enable overlay**; after a confirmed region, Hide/Show.
- `handleSetActiveSpace` toasts `This space has no regions yet` and stays off. `handleRequestRegionEdit` still sets `activeSpaceId`.
- `RegionSelectionTool` Confirm writes via `handleRegionComplete` → `handleSpaceUpdate` (`space:update` checkpoint). Cancel / click-outside discarded. **Escape did not cancel** (sibling of Cancel).
- Empty click stays under `MIN_REGION_SIZE = 5` (no region).
- Page overlay is `SpaceRegionOverlay` with `viewBox="0 0 width height"`. Hidden when the space is off or the per-page switch is disabled.
- Left-rail chrome identity compare treats function-only getter churn as unchanged, so `getRegionOverlayEnabled` stayed stale after toggle.

## Product fix

1. `RegionSelectionTool.jsx` — Escape (when not in an editable target) calls `handleCancel`, same as Cancel / click-outside. No commit.
2. `SpacesPanel.jsx` — overlay control is `role="switch"` + `data-region-overlay-toggle` with click/Space/Enter **after** the tooltip binding.
3. `PDFViewer.jsx` (min-viable) — publish primitive `regionOverlayDisabledKey` so the left-rail identity compare republishes when the overlay Map changes. Did not loosen the function-only guard. Did not touch `zoomGeneration`, SVG viewBox zoom, or canvas sizing.

## Live-proved

Playwright `debug/scenarios/e2e-spaces-edit-region-areas.spec.mjs` **1 / 1 (10.7s)** on Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf`. Node `spacesEditRegionAreas.test.mjs` **3 / 3**. Official `npm test` after PDFViewer: unrelated standing fail `pageOperationsQueueMounted` (`Cannot find module '/tmp/utils/pageContextOps.js'`). 8448 not loosened.

Receipt log: `SPACES_EDIT_REGION_AREAS_PROOF` persist `null`, overlay viewBox `0 0 612 792` (same after zoom).

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Enter / draw / Confirm | **pass** | Overlay root + SVG after rectangular drag. |
| Overlay on/off | **pass** | Hide switch removes overlay; Show restores it. |
| Exit rail control | **pass** | `Exit region edit` leaves overlay in place. |
| Last space off/on | **pass** | Only space off hides overlay; on restores it. |

### Break — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Enter with no spaces | **pass** | Edit region **0**; empty-state copy. |
| Esc after empty click | **pass** | No overlay; toggle becomes Define regions first (edit activates the space). |
| Cancel after empty click | **pass** | No overlay. |
| Pen-armed | **pass** | Confirm still writes; Pen restores `btn-active`. |
| Turn on with no regions | **pass** | Toast copy; stays **Turn on space**. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo / redo | **pass** | Ctrl+Z drops overlay (`space:update`); Ctrl+Shift+Z restores. |
| Zoom viewBox | **pass** | Overlay `0 0 612 792` after Zoom in ×2. |
| Last space delete | **pass** | Confirm wipe → No spaces yet; Edit **0**; overlay **0**. |
| 390 | **present / partial** | `Open spaces` + Create space **1**. Edit region **0** this session (no page row after Create). Control is compiled-in (not `!mobileMode`). |

No error boundary. SVG default.

## Classification after this pass

- **GAP found and proven:** Spaces Edit region areas + overlay on/off + last space (desktop).
- **Product bugs fixed:** Escape did not cancel; overlay switch was a non-operable div; left-rail identity compare left Hide/Show stale.
- **Omitted (not invented):** checklist items, category Move/Copy stub, copy-mode toolbar, leftover-18 unplaced-rows, linked workbook.
- **Next unique leftover (not this pass):** Spaces region-row **Click to rename** (`aria-label="Click to rename"` / `commitRegionRename`). Distinct from space-name rename (Hunt Space) and from Edit region areas. 390 page-row / Edit after Create stays a follow-up (`mobileEdit: 0`). Not leftover-18. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/RegionSelectionTool.jsx`
- `src/sidebar/SpacesPanel.jsx`
- `src/PDFViewer.jsx` (primitive `regionOverlayDisabledKey` only)
- `debug/scenarios/e2e-spaces-edit-region-areas.spec.mjs`
- `tests/spacesEditRegionAreas.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.

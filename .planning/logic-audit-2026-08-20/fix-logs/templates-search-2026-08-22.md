# Templates list Search + mobile content Search + Edit-modules Search modules — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Templates template-list reorder + checklist item reorder, leftover-18 Space CSV / PDF Pages stay parked. Unique leftovers that are **not** leftover-18 and **not** U-03 template create/rename/delete / entity color / Add module / module Duplicate / Add checklist item / New category / category Duplicate / module Delete / template-list Duplicate / New entity / entity Duplicate / entity Delete / category Delete / entity/category/module reorder / Share / template-list reorder / checklist item reorder: Templates **list Search** (`Search templates...` / `templateMatchesSearch`), **mobile content Search** (`Search template...` / `templateContentSearch`), and Edit-modules **`Search modules...`** (`modSearch`). FEATURE-MATRIX named list Search as the leftover. Distinct from PDF find and leftover-18. Live-proved on `/?hubPreview=1&tab=templates`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, the Spaces family, survey-rail family, callout/line/poly handles, nubbin, survey-marker handles/delete, PDF Search, keyboard, every-swatch, Fit height, thumbnails, pages structure, flatten, mobile chrome, Photo/Video, 390 switcher, template re-pick, Excel fail-closed, Copy-space, entity color, Add module / module Duplicate / Add checklist item, New category / category Duplicate / module Delete, template-list Duplicate, New entity / entity Duplicate / entity Delete / category Delete, entity/category/module reorder, Share, template-list reorder, checklist item reorder. UL-31 Continue pin stays parked.

## Why these are the next GAP (and not leftover-18 Space export)

| Prior claim | What was actually asserted |
|---|---|
| U-03 **pass** (hubPreview editor) | Create/rename/delete on the template list. List Search never opened as the GAP. |
| PDF find (V-08) | Find in PDF. Hub `templateMatchesSearch` is a different filter. |
| Catalog completeness hub search | Documents / projects search. Templates list + content + module search never opened as the GAP. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| leftover-18 Space CSV / PDF Pages / A-03 live invites | **Parked.** Do not invent `.env.local`. |
| Spaces / survey-rail / callout handles / nubbin / marker / Search (PDF) / keyboard / swatches / Fit height / thumbs / pages / flatten / mobile chrome / Photo/Video / 390 switcher / template re-pick / Excel fail-closed / Copy-space / entity color / Add module / module Duplicate / Add checklist item / New category / category Duplicate / module Delete / template-list Duplicate / New entity / entity Duplicate / entity Delete / category Delete / entity/category/module reorder / Share / template-list reorder / checklist item reorder | **Proven.** Do not replay. |
| UL-31 Continue pin / Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces | **Parked / compile-hidden / do not invent.** |
| Survey category Move/Copy toast / `copyModeActive` Copy-to-Spaces / Templates Move/Copy modal | **Dead stubs.** Copy/Move buttons only `closeMoveModal`. Not invented. |
| U-04 archive-with-markers | **Proven** hubPreview (`e2e-u04-archive.spec.mjs`). Cloud usage stays leftover-18. |
| Templates list Search (`Search templates...` / `templateMatchesSearch`) | **GAP.** Filters `rich` by name / module / category / item / entity. Does not `mutateTpl`. |
| Mobile content Search (`Search template...` / `templateContentSearch`) | **GAP.** Same family. Filters open-template categories + entities. Reset on open. |
| Edit-modules `Search modules...` (`modSearch`) | **GAP.** Same family. Filters module names. Cleared when the modal closes. |
| Existing-row rename (`renameModule` / `renameCategory` / `renameEntity` / `renameItem`) | **Next leftover.** Create flows only minted new names. Seed Cameras / Installation Phase / GC / item text never opened as the GAP. |
| Template / entity More menu | Sibling overflow chrome. Copy/Share/Delete already proven via Select. Not this GAP. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- `templateMatchesSearch`: empty query → all; case-insensitive substring on template name, module names, category names, item `text` / `lastKnownLabel`, entity `role`. `visibleTemplates = rich.filter(...)`.
- No-match copy: desktop `No templates match your search.` / mobile EmptyState `No templates match your search` (no period). Empty hub stays `No templates yet` even with a query.
- Selected template follows the first visible match; empty visible set keeps the previous selection.
- Mobile list uses the same `search` state. Opening a template swaps the chrome to `templateContentSearch` (`Search template...`) and clears it.
- Mobile content filters `visibleCats` by category/item text and `mobileVisibleEntities` by role. No-match: `No categories match this view.` / `No entities match this view.`
- Edit-modules `modSearch` filters by module name. No-match: `No modules match your search.` `useEffect` clears `modSearch` when `modEdit` is false.
- Search is `useState` only. Does **not** call `mutateTpl` / `markEdited`. Isolation is the seed content after clear.
- Escape on the shared `Search` control: `DismissBarrier` blurs and does **not** clear. Clear is deleting the query.
- Move/Copy modal Copy/Move still only `closeMoveModal`.
- 390: list Search on `.templates-mobile-search-actions`; content Search after opening a row; Edit-modules Search after Modules Select.

## Product fix

Search `DismissBarrier` ate the first click on a filtered result (same trailing-click contract as other dismiss surfaces, but a search result must open on the first gesture). Min-viable: pass `dismissActionSelector="[data-drag-rearrange-row]"` on desktop list Search; mobile list also passes `.templates-mobile-create-button`; mobile content keeps `[data-search-dismiss-action]` and adds rearrange rows + back + Entities. Did not touch `zoomGeneration`, SVG viewBox zoom, or canvas sizing. 8448 not loosened. Dirty-bar `passthroughSelector` and `mutateTpl` no-op-dirty left as-is.

## Live-proved

Playwright `debug/scenarios/e2e-templates-search.spec.mjs` **1 / 1 (4.9s)** on Vite `http://localhost:5173` + `/?hubPreview=1&tab=templates`. Node `templatesSearch.test.mjs` **3 / 3**. High-risk files: none (TemplatesEditor only).

Receipt log: `TEMPLATES_SEARCH_PROOF` `leftoverKind: "templates-list-and-content-and-module-search"`, `emptySearchVisible: true`, `nameMatch: ["Security Walk-Through"]`, `caseMatch: true`, `categoryMatch: ["MEP As-Built Markup"]`, `entityMatch: ["MEP As-Built Markup"]`, `itemMatch: ["Security Walk-Through"]`, `noMatch: true`, `selectedFollowsVisible: true`, `escapeKeepsQuery: true`, `clearRestores: true`, `firstClickOpensFiltered: true`, `listIsolation: true`, `moduleSearchDesktop: true`, `mobileListSearchOk: true`, `mobileContentSearchOk: true`, `contentIsolation: true`, `moduleSearchMobile: true`, `noDirty: true`.

### 1. List Search (`Search templates...`) — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Empty hub | **pass** | Search visible. Query `xyzzy` stays `No templates yet` (not the no-match copy). No dirty. |
| Empty / whitespace query | **pass** | Seed `['Security Walk-Through', 'MEP As-Built Markup']`. |
| Name match | **pass** | `security` → Security only. |
| Case | **pass** | `SECURITY` → Security. |
| Category / entity / item | **pass** | `ahu` / `architect` → MEP; `camera cable` → Security. |
| No match | **pass** | `xyzzy` → empty list + `No templates match your search.` |
| Selected follows visible | **pass** | `mep` opens AHU Equipment editor. |
| Escape | **pass** | Blurs; query stays `mep`. Does **not** invent clear-on-Escape. |
| Clear | **pass** | Empty input restores both templates. |
| First-click result | **pass** | After the passthrough fix, click Security while filtered opens it. |
| Isolation | **pass** | No dirty bar. Cameras / Doors seed items; MEP `Tags updated?`. |
| 390 list | **pass** | `mep` / `XYZZY` / `WALK` / Escape-keeps / clear restores. |

### 2. Mobile content Search (`Search template...`) — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Open resets | **pass** | Opening Security starts empty; Cameras + Doors. |
| Category / item | **pass** | `doors` → Doors; `CABLE` → Cameras. |
| No match | **pass** | `xyzzy` → `No categories match this view.` |
| Escape | **pass** | Keeps `xyzzy`. |
| Clear | **pass** | Restores Cameras + Doors. No dirty. |
| Entities | **pass** | `gc` → `['GC']`; `architect` (Security) → `No entities match this view.` |
| Isolation | **pass** | Opening MEP resets content search; AHU Equipment only. |

### 3. Edit-modules `Search modules...` — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Desktop filter | **pass** | `install` / `INSTALLATION` → Installation Phase; `xyzzy` empty copy; `PHASE` both. |
| Escape | **pass** | Keeps `PHASE`. Does not clear. |
| Close clears | **pass** | Done then re-open: `modSearch` `''`, both modules. No dirty. |
| 390 | **pass** | MEP Equipment: `equip` match / `xyzzy` empty / clear restores. |

No error boundary.

## Classification after this pass

- **GAP found and proven:** Templates list Search + mobile content Search + Edit-modules Search modules (desktop + 390 chrome). Actual: empty query / match / no-match / case / Escape-keeps / clear restore / no dirty / isolation vs MEP. First-click result required the dismiss passthrough.
- **Product bugs fixed:** 1 (Search DismissBarrier ate the first result click).
- **Omitted (not invented):** Templates Move/Copy mutators, leftover-18 unplaced-rows, linked workbook, existing-row rename as the GAP.
- **Next unique leftover (not this pass):** leftover-18 **Space CSV / PDF Pages** stay **parked**. Templates **existing-row rename** (`renameModule` / `renameCategory` / `renameEntity` / `renameItem` on seed Cameras / Installation Phase / GC / item text) remains live chrome not proven as GAP. More menu is sibling overflow. Move/Copy is a dead stub. Do not invent Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces. UL-31 Continue pin stays parked. Do **not** re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`). Space CSV / PDF Pages stay in that park list.
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/home/TemplatesEditor.jsx` (search dismiss passthrough only)
- `debug/scenarios/e2e-templates-search.spec.mjs`
- `tests/templatesSearch.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.

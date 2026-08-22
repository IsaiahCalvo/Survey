# Templates editor entity color — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Spaces space-card Delete, leftover-18 Space CSV / PDF Pages stay parked. Unique leftover that is **not** leftover-18 and **not** the Spaces family: U-03 Templates editor **entity color** (`aria-label="Edit color"` / `setEntityColor` / CompactColorPicker on the roster). FEATURE-MATRIX named “Color on entities” as the U-03 leftover. Cluster create/rename/delete never opened the picker. Distinct from viewer every-swatch (C-01…C-06) and from leftover-18 Space CSV / PDF Pages. Live-proved on `/?hubPreview=1&tab=templates`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist items / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, the Spaces family, survey-rail family, callout/line/poly handles, nubbin, survey-marker handles/delete, Search, keyboard, every-swatch, Fit height, thumbnails, pages structure, flatten, mobile chrome, Photo/Video, 390 switcher, template re-pick, Excel fail-closed, Copy-space. UL-31 Continue pin stays parked.

## Why this is the next GAP (and not leftover-18 Space export)

| Prior claim | What was actually asserted |
|---|---|
| U-03 **pass** (hubPreview editor) | Create `Template 3`, rename+Save, blank-rename no-op, delete `Template 4`. Color on entities never opened. |
| Viewer every-swatch | Fill/border/pen/counter/font sites on `?testPdf=`. Not the Templates roster picker. |
| Spaces space-card Delete | Named leftover-18 Space CSV / PDF Pages as next. That host stays parked. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| leftover-18 Space CSV / PDF Pages | **Parked.** Legal slice already in `leftover18-unblock-2026-08-21.md`. Do not invent `.env.local`. |
| Spaces Create / rename / Add pages / Turn on/off / Expand / Go to page / Hide/Show / reorder / region Delete/rename / Edit region / space-card Delete | **Proven this wave.** Do not replay. |
| Survey-rail family / callout handles / nubbin / marker handles/delete / Search / keyboard / swatches / Fit height / thumbs / pages structure / flatten / mobile chrome / Photo/Video / 390 switcher / template re-pick / Excel fail-closed / Copy-space | **Proven.** Do not replay. |
| UL-31 Continue pin / Print / stamp / measure / Group / Extract / Note-Link / checklist items / Copy-to-Spaces | **Parked / compile-hidden / do not invent.** |
| Survey category Move/Copy toast / `copyModeActive` Copy-to-Spaces / Templates Move/Copy modal | **Dead stubs.** Copy/Move buttons only `closeMoveModal`. Not invented. |
| Templates Add module / Duplicate / Add checklist item | Sibling leftovers. Not this pass. |
| `aria-label="Edit color"` / `setEntityColor` / CompactColorPicker on roster | **GAP.** Named U-03 leftover. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- Desktop + 390 `aria-label="Edit color"` opens `data-entity-color-panel` with Fill/Border + CompactColorPicker.
- Fill `applyColor` writes `roleColors` and `setEntityColor(eid, color)` (roster hex only). Border writes `borderColors`. Match fill sets `matchFill` and `pointerEvents: none`.
- `buildRich` runs HubPreview `rgba(216,168,78,0.5)` through `toHex6` → `#d8a84e`.
- Save uses `richToTemplate` (color / opacity / border / matchFill) → HubPreview `setTemplates`. Cancel `reloadFromProps` when no `onReloadTemplates`.
- Templates Move/Copy modal Copy/Move still only close the dialog.

## Product fix

Open entity-color picker used DismissBarrier with `dismissInsideSelector="[data-entity-color-panel]"` only. Dirty-bar **Cancel** / **Save** sit outside that panel, so the first click closed the picker and consumed the gesture — Cancel never discarded the fill. Min-viable: `data-entity-editor-actions` on the desktop + mobile dirty bars and `passthroughSelector="[data-entity-editor-actions] button"` on both CompactColorPicker mounts. Did not touch `zoomGeneration`, SVG viewBox zoom, or canvas sizing. 8448 not loosened.

## Live-proved

Playwright `debug/scenarios/e2e-templates-entity-color.spec.mjs` **1 / 1 (4.3s)** on Vite `http://localhost:5173` + `/?hubPreview=1&tab=templates`. Node `templatesEntityColor.test.mjs` **3 / 3**. No high-risk file.

Receipt log: `TEMPLATES_ENTITY_COLOR_PROOF` `emptyZero: true`, `cancelRestored: true`, `fillSaved: true`, `isolation: true`, `matchFillLocked: true`, `mobileEdit: 3`, `mobilePicked: true`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Fill preset | **pass** | GC `#d8a84e` → `#ff0000`. |
| Save persists | **pass** | After Save, MEP then Security: GC still `#ff0000`. |
| Scope | **pass** | `Edit color` / `setEntityColor` / CompactColorPicker. Not leftover-18 export. Not viewer swatches. |

### Break — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Cancel while picker open | **pass** | `#00ff00` then Cancel restored `#d8a84e`; Save gone. Before-fix: barrier ate Cancel. |
| Empty templates | **pass** | `/?hubPreview=1&empty=1&tab=templates` Edit color **0**. |
| Match fill lock | **pass** | Border Match fill `pointerEvents: none`; `#0000FF` did not steal fill. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Isolation | **pass** | Subcontractor hex unchanged while GC went red. |
| 390 | **pass** | Entities dialog Edit color **3**; `#0000FF` wrote `--entity-color`. |

No error boundary.

## Classification after this pass

- **GAP found and proven:** Templates editor entity color (desktop + 390). Actual: fill preset writes the swatch; Cancel discards; Save survives template switch; Match fill locks border; second entity isolated.
- **Product bugs fixed:** 1 — dirty-bar Save/Cancel now passthrough the open picker.
- **Omitted (not invented):** checklist items, category Move/Copy stub, Templates Move/Copy mutators, copy-mode toolbar, leftover-18 unplaced-rows, linked workbook.
- **Next unique leftover (not this pass):** leftover-18 **Space CSV / PDF Pages** stay **parked**. Templates Add module / Duplicate / Add item remain siblings. Do not invent Print / stamp / measure / Group / Extract / Note-Link / checklist items / Copy-to-Spaces. UL-31 Continue pin stays parked. Do **not** re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`). Space CSV / PDF Pages stay in that park list.
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/home/TemplatesEditor.jsx`
- `debug/scenarios/e2e-templates-entity-color.spec.mjs`
- `tests/templatesEntityColor.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.

# Feature matrix — Survey BetaSafeS2

Rebuilt 2026-08-20 for the logic-audit E2E wave. `FEATURE-MATRIX.md` was missing from this worktree; this inventory is from the live app (AppShell toolbar, CompactColorPicker, TextEditOverlay, pdf-lib export/print, hub/collab surfaces) plus existing tests.

**Status legend (see `E2E-STATUS.md`):** `untested` · `pass` · `fail` · `partial`

Exact discrete catalogs used by the UI:

- Color swatches (16): `transparent`, `#FF0000`, `#FF0080`, `#FF00FF`, `#8000FF`, `#0000FF`, `#0080FF`, `#00FFFF`, `#00FF80`, `#00FF00`, `#80FF00`, `#FFFF00`, `#FF8000`, `#FFFFFF`, `#808080`, `#000000`
- Fonts (6, single name only): `Arial`, `Helvetica`, `Times New Roman`, `Courier New`, `Georgia`, `Verdana`
- Font sizes (18): `8 9 10 11 12 14 16 18 20 24 28 32 36 40 48 56 64 72`
- Format: bold, italic, underline, strikethrough
- Align: 3×3 (`top|middle|bottom` × `left|center|right`)

| ID | Area | Feature | Intended use | Break / edge |
|---|---|---|---|---|
| V-01 | Viewer | Pan | Drag the page | Pan while a tool is armed; narrow shell |
| V-02 | Viewer | Select annotations | Click / marquee annotations | Empty page; locked/imported; remote-deleted |
| V-03 | Viewer | Select text (⇧V) | Select PDF glyphs | No text layer; form fields |
| V-04 | Viewer | Zoom in/out/fit | Ctrl+/−/0, pinch, toolbar | Floor 10%; Electron zoom factor; `zoomGeneration` auto-commit. **Fit height** is its own mode (not Fit page); live `e2e-fit-height.spec.mjs` |
| V-05 | Viewer | Page nav | ←/→ Home/End, thumbnails | 1-page; missing page; fit-width |
| V-06 | Viewer | Pages panel | Jump via thumbnail **left-click** (not the page-number field). UL-32 Mirror V / Reset / Cut / Copy / Paste execute `e2e-survey-keep-notes-page-ctx.spec.mjs` | Collapse; long docs; no thumb 121; Extract missing |
| V-07 | Viewer | Bookmarks | Add/reorder/jump | Empty; rename clash |
| V-08 | Viewer | Search text | Find in PDF | No hits; wrap; special chars |
| V-09 | Viewer | Keyboard shortcuts overlay | `?` lists tools | Escape; focus trap |
| D-01 | Draw | Pen / ink | Freehand stroke | Zoom mid-stroke; 1-dot tap |
| D-02 | Draw | Highlighter | Translucent stroke | Opacity 0; print exclusion vs markup |
| D-03 | Draw | Eraser (object) | Delete hit annotations | Policy: ink-only vs all; preview |
| D-04 | Draw | Eraser (ink) | Partial path erase | Race; empty path |
| D-05 | Draw | Stroke width | Presets + numeric | Min/max; eraser size vs stroke |
| S-01 | Shapes | Rectangle | Draw + fill/stroke | Zero size; rotation |
| S-02 | Shapes | Ellipse | Draw + fill/stroke | Circle vs ellipse |
| S-03 | Shapes | Line | Draw + dash. Single-click `p1`/`p2`/`midpoint` live `e2e-line-endpoint-midpoint.spec.mjs`. Double-click bbox live `e2e-bbox-edit-mode.spec.mjs` | Zero length; 10px snap-to-straight; Pen-armed handle still edits; Pen exits bbox mode |
| S-04 | Shapes | Arrow + arrowheads | 6 head styles. Same `p1`/`p2`/`midpoint` chrome as Line | Legacy group export |
| S-05 | Shapes | Counter | Numbered pins + series. Double-click bbox live `e2e-bbox-edit-mode.spec.mjs`. Nubbin + Shift-orbit live `e2e-counter-nubbin-orbit.spec.mjs` | Renumber; last-in-series; fill/number color; UL-31 Continue pin |
| T-01 | Text | Textbox create/edit | Same-surface editor | Blank discard; tight-fit; wrap |
| T-02 | Text | Callout create/edit | Leader + text box. Knee / leader / arrowTip / text-box **move** live `e2e-callout-knee-drag.spec.mjs`. **Corner resize** `textBox-tl/tr/bl/br` live `e2e-callout-textbox-resize.spec.mjs`. **Flip + knee-rollback leftovers** `e2e-callout-textbox-resize-leftovers.spec.mjs` | Blank; arrowhead; style patch; Pen-armed no-op; Esc is marquee-only; off-page allow-outside; 20px min clamp; live flip past opposite; resize-into-knee rollback |
| T-03 | Text | Font family | All 6 offered names | CSS stack rejected; import unknown name |
| T-04 | Text | Font size | All 18 presets + custom | Clamp 6–200; non-preset prepend |
| T-05 | Text | Bold / italic / underline / strike | Toggle each | Combo; callout booleans vs fabric fields |
| T-06 | Text | Alignment 3×3 | All 9 cells | justify accepted but not offered |
| T-07 | Text | Font color | All 15 solid swatches + hex | Invalid hex; transparent first cell |
| C-01 | Color | Preset grid | Every discrete swatch | Transparent; Match Fill first cell |
| C-02 | Color | Hex field | `#rgb` / `#rrggbb` / bare | Invalid, rgba(), named, 4/5/7/8 digit |
| C-03 | Color | Opacity | Slider + % field 0–100 | `minOpacity`; transparentMode restore |
| C-04 | Color | Spectrum HSV | Drag + keyboard | Out-of-bounds pointer; hue wrap |
| C-05 | Color | Fill vs stroke vs font sites | Same picker, different targets | Counter number color; armed tool vs selection |
| C-06 | Color | Match Fill | Border snapshots fill | Missing fill; opacity lock |
| E-01 | Edit | Resize | Shape handles + live bounds. Callout corners are T-02 (`textBox-tl/tr/bl/br`). Line `p1`/`p2`/`midpoint` are S-03/S-04. Polygon/polyline `vertex-N` is X-04. Double-click / 390-strip bbox mode live `e2e-bbox-edit-mode.spec.mjs`. Placed survey-marker 8 handles live `e2e-survey-marker-handle-drag.spec.mjs` | Rotated; text wrap height; Pen exits bbox |
| E-02 | Edit | Rotation | Handle + numeric + Shift 45°. Counter nubbin / Shift-orbit live `e2e-counter-nubbin-orbit.spec.mjs`. Survey-marker `mtr` live `e2e-survey-marker-handle-drag.spec.mjs` | Off-screen handle; 0/90/180/270; Shift-click toggle ≠ orbit |
| E-03 | Edit | Move | Drag selected. Survey-marker body live `e2e-survey-marker-handle-drag.spec.mjs` | Multi-select; snap |
| E-04 | Edit | Delete | Backspace / context. Placed survey-marker overlay Delete + Select Backspace/Delete live `e2e-survey-marker-delete.spec.mjs` | Last owner; remote delete; rail list Delete |
| E-05 | Edit | Undo / redo | Cmd+Z / Shift+Z | Collab foreign edits |
| E-06 | Edit | Context menu | Right-click actions | Callout vs text vs counter |
| X-01 | Save | Cloud save | Persist annotations | Offline outbox; identity-only churn |
| X-02 | Export | Annotated PDF | File → Export | Every color/font/format in /DA |
| X-03 | Print | Flatten markup | Print with markup | Decoration first-line only; survey markers excluded |
| X-04 | Import | PDF annotations | Open foreign PDF. Imported polygon/polyline single-click `vertex-N` live `e2e-poly-vertex-handles.spec.mjs`. Double-click bbox live `e2e-bbox-edit-mode.spec.mjs` | Unsupported Stamp; no create-poly tool; rotated page |
| X-05 | Forms | Form field values | Export/print filled fields | Hidden Forms category |
| X-06 | Excel | Export / apply changeset | Sheet sync | Identity SQL; CORS `*` intentional |
| U-01 | Survey | Survey rail / modules | Stamp + filter. **Previous/Next module** is its own navigator (not Walls). **Keep active** + **Survey notes** live `e2e-survey-keep-notes-page-ctx.spec.mjs`. Placed-marker handle drag live `e2e-survey-marker-handle-drag.spec.mjs`. Overlay delete live `e2e-survey-marker-delete.spec.mjs`. Rail Delete selected items live `e2e-survey-rail-delete-selected.spec.mjs`. Rail Rename live `e2e-survey-rail-rename.spec.mjs`. Rail Delete selected categories live `e2e-survey-rail-delete-categories.spec.mjs`. Rail Create category live `e2e-survey-rail-create-category.spec.mjs`. Rail Jump / Set location live `e2e-survey-rail-jump-set-location.spec.mjs`. Rail Entity picker live `e2e-survey-rail-entity.spec.mjs`. Place-time Entity dialog live `e2e-survey-place-entity-dialog.spec.mjs`. Empty-module Create template live `e2e-survey-empty-create-template.spec.mjs`. Category reorder live `e2e-survey-rail-category-reorder.spec.mjs`. Item reorder live `e2e-survey-rail-item-reorder.spec.mjs`. Item Copy → space live `e2e-survey-rail-item-copy-space.spec.mjs`. Excel actions fail-closed live `e2e-survey-excel-actions-failclosed.spec.mjs`. Choose survey template re-pick live `e2e-survey-choose-template-repick.spec.mjs`. 390 Choose Survey Marker sibling switcher live `e2e-survey-390-choose-marker.spec.mjs`. Notes Photo/Video attach live `e2e-survey-checklist-or-next.spec.mjs` | checklist Y/N/N-A parked (no compiled-in items); category Move/Copy stub |
| U-02 | Survey | Spaces / regions | Overlay + stamp. Edit region + overlay on/off + last space live `e2e-spaces-edit-region-areas.spec.mjs`. Region-row Click to rename live `e2e-spaces-region-rename.spec.mjs` (390 Edit after Create in the same session). Region-row Hide/Show canvas annotations live `e2e-spaces-region-visibility.spec.mjs`. Region-row Delete live `e2e-spaces-region-delete.spec.mjs`. Space-card reorder live `e2e-spaces-card-reorder.spec.mjs`. Region-row Hide/Show survey annotations live `e2e-spaces-survey-annotation-visibility.spec.mjs`. Region-row Go to page live `e2e-spaces-region-goto-page.spec.mjs`. Space-card Expand/Collapse live `e2e-spaces-card-expand-collapse.spec.mjs`. Space-card Turn on/off live `e2e-spaces-card-turn-on-off.spec.mjs`. Add pages live `e2e-spaces-add-pages.spec.mjs`. Space-name rename live `e2e-spaces-space-name-rename.spec.mjs`. Create space live `e2e-spaces-create-space.spec.mjs`. Space-card Delete live `e2e-spaces-card-delete.spec.mjs` | Space CSV / PDF Pages leftover-18 |
| U-03 | Survey | Templates | Editor + overwrite warn; **entity color** live `e2e-templates-entity-color.spec.mjs`. **Add module / module Duplicate / Add checklist item** live `e2e-templates-module-dup-checklist.spec.mjs`. **New category / category Duplicate / module Delete** live `e2e-templates-category-module-delete.spec.mjs`. **Template-list Duplicate** live `e2e-templates-list-duplicate.spec.mjs`. **New entity / entity Duplicate / entity Delete / category Delete** live `e2e-templates-entity-dup-category-delete.spec.mjs`. **Entity / category / module reorder + Share** live `e2e-templates-reorder-share.spec.mjs`. **Template-list reorder + checklist item reorder** live `e2e-templates-list-item-reorder.spec.mjs`. **List Search + mobile content Search + Edit-modules Search modules** live `e2e-templates-search.spec.mjs`. **Existing-row rename** live `e2e-templates-existing-row-rename.spec.mjs`. **More menu overflow** live `e2e-templates-more-menu.spec.mjs`. **Checklist item Delete** live `e2e-templates-checklist-item-delete.spec.mjs`. **Permanent-delete of archived items** live `e2e-templates-archived-hard-delete.spec.mjs`. **Entity opacity + independent Border tab** live `e2e-templates-entity-opacity-border.spec.mjs` | leftover-18; Move/Copy stub |
| U-04 | Survey | Checklists | Archive / complete | Empty |
| A-01 | Auth | Sign in / captcha | Password + Turnstile | Guest upload block; auto-login |
| A-02 | Auth | Microsoft / OneDrive | MSAL + Graph | Reconnect; Electron `file://` |
| A-03 | Share | Invites + roles | Owner/Editor/Commenter/Viewer. Hub Projects **Team write** hubPreview fail-closed live `e2e-hub-projects-thin-chrome.spec.mjs` (no invented mint). File Select Move/Copy + project card reorder are local hub chrome on the same spec (not leftover-18). File Search (`Search files...`) + file-row reorder (`reorderFiles`) live `e2e-hub-projects-file-search-reorder.spec.mjs` (not project Search / card reorder). File More/Select **Delete** (`deleteFiles`) live `e2e-hub-projects-file-delete.spec.mjs` (not project delete, not file Copy/Paste; no confirm). File-row **Open** (`onOpenDocument` / HubPreview `handleOpenDocument`) live `e2e-hub-projects-file-open.spec.mjs` (not Documents Preview / Open file; fixture + `previewName` + `returnTab=projects`). Hub Documents **Open file** live `e2e-hub-docs-open-file.spec.mjs` (Preview-pane button + row double-click; 390 `openMobileDoc` + detail Open file; fixture + `previewName` + `returnTab=documents` — not Preview extras, not Projects file-row Open). Hub Archive **Search / filter / sort** live `e2e-archive-search.spec.mjs` (local hubPreview seed; `empty=1` contrast; Restore fail-closed leftover-18). Hub Archive **row Preview / Close preview** + **Show documents** live `e2e-archive-preview.spec.mjs` (not Documents Preview extras / Open file; 390 Preview pane absent; Restore stays leftover-18). Hub Archive **Select / All / None / Done** live `e2e-archive-select.spec.mjs` (local selection chrome; All over visible top-level rows; child rows excluded; Restore / Delete forever fail-closed leftover-18; 390 select row not under the account chip). Hub Documents More **Share** → **Document Access** live `e2e-hub-docs-share-access.spec.mjs` (SE-011 owner Access empty + Invite/Done; Copy link / Send fail-closed; Package 2 stays ShareModal; guest ShareModal; 390 Access; no invented mint). Hub Documents **Select / All / None / Done** live `e2e-hub-docs-select-all.spec.mjs` (local `setSelDocs` over visible docs; empty All keeps 0; search All only `d1`; not extras Duplicate / Move/Copy; not Archive Select). Hub load-error **Try again** live `e2e-hub-load-error-retry.spec.mjs` (`HubLoadError` / HubPreview `retryLoad` on `hubError=documents|projects|templates`; empty=1 / hubLoading have no Try again; Archive ignores documents error; 390 same alert). 2026-08-22 hunt after Try again found **no** new unique unblocked leftover (`fix-logs/after-hub-retry-exhausted-hunt-2026-08-22.md`). | Last owner; expired invite; signed-in writeback leftover-18 |
| A-04 | Account | Account settings | Profile / password. 2026-08-22 **General pane** live `e2e-account-settings-general.spec.mjs`. 2026-08-22 **Usage local empty chrome** live `e2e-account-settings-usage.spec.mjs` (`Projects 0 / ∞` / `Documents 0 / ∞` / `Storage 0 B / 100.0 GB` + DEVELOPER; Manage hides; guest 0; testPdf Home + 390). Menu open/close remains `e2e-a04-account-menu-hunt.spec.mjs`. Connected / Start trial leftover-18. `fix-logs/account-settings-usage-2026-08-22.md` | Overlap; notifications (no such pane) |
| A-05 | Account | Billing | Checkout / portal | CORS `*` must stay |
| A-06 | Collab | Presence / re-sign-in | Roster + banner | Access removed; outbox retry |
| A-07 | History | Revisions / activity | Restore / jump | Quarantine stub bbox |
| P-01 | Mobile | Sheets + chrome | Tool rail + properties | Hook restore; color takeover |
| P-02 | Mobile | Text formatting | Same 6 fonts + formats | Numeric size 1–200 |
| P-03 | Desktop | Electron menus | Open / export / print. Desktop TabBar **Close tab** live `e2e-tab-close.spec.mjs` (not Home / `returnToDevHubPreview`; 390 TabBar absent) | No display in headless; page-drop toast stub |
| P-04 | Desktop | Keyboard tool keys | V ⇧V P H E T Q L A C | Undocumented keys |

## Wave 1 automation scope

Node-only (no Electron window): **T-03, T-04, T-05, T-06, T-07, C-01, C-02, X-02, X-03** (style subset).

## Wave 2 automation scope

Node-only: **C-03, C-04, C-06, D-01, D-02, S-01…S-04, E-01, E-02, X-04** (commit/helpers), plus print all-line decorations. Live windows still untested.

Everything else stays `untested` until a later wave.

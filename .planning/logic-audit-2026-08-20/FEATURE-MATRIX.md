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
| U-01 | Survey | Survey rail / modules | Stamp + filter. **Previous/Next module** is its own navigator (not Walls). **Keep active** + **Survey notes** live `e2e-survey-keep-notes-page-ctx.spec.mjs`. Placed-marker handle drag live `e2e-survey-marker-handle-drag.spec.mjs`. Overlay delete live `e2e-survey-marker-delete.spec.mjs`. Rail Delete selected items live `e2e-survey-rail-delete-selected.spec.mjs`. Rail Rename live `e2e-survey-rail-rename.spec.mjs`. Rail Delete selected categories live `e2e-survey-rail-delete-categories.spec.mjs`. Rail Create category live `e2e-survey-rail-create-category.spec.mjs`. Rail Jump / Set location live `e2e-survey-rail-jump-set-location.spec.mjs`. Rail Entity picker live `e2e-survey-rail-entity.spec.mjs`. Place-time Entity dialog live `e2e-survey-place-entity-dialog.spec.mjs`. Empty-module Create template live `e2e-survey-empty-create-template.spec.mjs`. Category reorder live `e2e-survey-rail-category-reorder.spec.mjs`. Item reorder live `e2e-survey-rail-item-reorder.spec.mjs`. Item Copy → space live `e2e-survey-rail-item-copy-space.spec.mjs`. Excel actions fail-closed live `e2e-survey-excel-actions-failclosed.spec.mjs`. Choose survey template re-pick live `e2e-survey-choose-template-repick.spec.mjs`. 390 Choose Survey Marker sibling switcher live `e2e-survey-390-choose-marker.spec.mjs` | checklist Y/N/N-A; category Move/Copy stub |
| U-02 | Survey | Spaces / regions | Overlay + stamp | Region off; last space |
| U-03 | Survey | Templates | Editor + overwrite warn | Color on entities |
| U-04 | Survey | Checklists | Archive / complete | Empty |
| A-01 | Auth | Sign in / captcha | Password + Turnstile | Guest upload block; auto-login |
| A-02 | Auth | Microsoft / OneDrive | MSAL + Graph | Reconnect; Electron `file://` |
| A-03 | Share | Invites + roles | Owner/Editor/Commenter/Viewer | Last owner; expired invite |
| A-04 | Account | Account settings | Profile / password | Overlap; notifications |
| A-05 | Account | Billing | Checkout / portal | CORS `*` must stay |
| A-06 | Collab | Presence / re-sign-in | Roster + banner | Access removed; outbox retry |
| A-07 | History | Revisions / activity | Restore / jump | Quarantine stub bbox |
| P-01 | Mobile | Sheets + chrome | Tool rail + properties | Hook restore; color takeover |
| P-02 | Mobile | Text formatting | Same 6 fonts + formats | Numeric size 1–200 |
| P-03 | Desktop | Electron menus | Open / export / print | No display in headless |
| P-04 | Desktop | Keyboard tool keys | V ⇧V P H E T Q L A C | Undocumented keys |

## Wave 1 automation scope

Node-only (no Electron window): **T-03, T-04, T-05, T-06, T-07, C-01, C-02, X-02, X-03** (style subset).

## Wave 2 automation scope

Node-only: **C-03, C-04, C-06, D-01, D-02, S-01…S-04, E-01, E-02, X-04** (commit/helpers), plus print all-line decorations. Live windows still untested.

Everything else stays `untested` until a later wave.

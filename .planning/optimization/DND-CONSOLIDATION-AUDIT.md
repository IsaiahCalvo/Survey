# Drag-and-Drop Consolidation Audit (BL-18 → feeds KAL-84)

_2026-06-10, overnight loop. Audit-only: no code changed. Every claim verified against
source this session; Codex adversarial review applied. Companion: Linear KAL-84
"standardize drag-to-rearrange architecture"._

## Scope

This audit covers **list-reorder and cross-surface drag-drop** (the BL-18 intent).
The app also contains large CUSTOM pointer-drag systems that are load-bearing by
nature and intentionally outside consolidation scope — inventoried briefly in
"Adjacent drag systems" below: the SVG annotation interaction system
(`src/components/SVGAnnotationLayer.jsx` + `src/hooks/useSVGInteraction.js`:
annotation/group move, marquee, resize/rotate, vertex/endpoint/midpoint
(`SVGAnnotationLayer.jsx:4763-4793`, `useSVGInteraction.js:1819-2056,3859-3970`),
callout drags), `src/RegionSelectionTool.jsx` (region draw/move/vertex/resize),
and pan/resize/control drags (`PdfjsViewerContainer`, `SyncfusionPDFContainer`,
`CompactColorPicker`, viewer pan). The line/arrow midpoint-drag math helper
(`src/utils/lineDragMath.js`, tested in `tests/lineDragMath.test.mjs`) belongs to
that SVG system.

## Executive summary

Within scope, the headline finding is GOOD news: **list-reorder is already
consolidated** — 9 of the 10 flat-list surfaces ride one shared wrapper
(`src/reorder/SortableRearrangeList.jsx` + `DragRearrangeHandle` +
`flatReorderUtils`), with consistent sensors, axis lock, clamp bounds, and keyboard
support. What remains: **TWO blocks of dead code to delete** (Dashboard's orphaned
reorder sensors AND its disconnected OS file-drop handlers), **duplicate axis-lock
helpers** (two horizontal copies + one unused vertical duplicate alongside the live
one), **one local reimplementation of the shared move util**, and a handful of
cosmetic inconsistencies — plus divergences that are load-bearing and must NOT be
consolidated (cross-tab page drag needs native HTML5 DnD; the bookmark tree's
reparent projection is intrinsically richer). Full inventory below; slice plan at
the end.

## Inventory (in-scope surfaces; adjacent custom drag systems listed under Scope above)

### Group A — already consolidated on `SortableRearrangeList` (9 list surfaces)
| # | Surface | File | Persistence |
|---|---|---|---|
| 1 | Survey panel: category rows | `src/SurveySpacesRail.jsx:1356-2562` (wrapper closes :2562) | `handleReorderSurveyCategories` → `PDFViewer.jsx:23718` → `moveItemById` → template save |
| 2 | Survey panel: Survey Marker rows | `src/SurveySpacesRail.jsx:1671-2552` (wrapper closes :2552) | `reorderSurveyMarkersInCategory` (rail :520) |
| 3 | Spaces panel: space cards | `src/sidebar/SpacesPanel.jsx:1585-1662` | optimistic `moveItem` + `PDFViewer.jsx:11853` (`arrayMove` — see D4) |
| 9 | Templates editor: template rows | `src/home/TemplatesEditor.jsx:1376-1451` | template save flow |
| 10 | Templates editor: category rows | `src/home/TemplatesEditor.jsx:1561-1769` | template save flow |
| 11 | Templates editor: checklist items | `src/home/TemplatesEditor.jsx:1663-1703` | template save flow |
| 12 | Templates editor: entity roster | `src/home/TemplatesEditor.jsx:1831-1989` | template save flow |
| 13 | Projects tree: project rows | `src/home/ProjectsFolderTree.jsx:588-672` | `reorderProjects` (:379) → parent persist |
| 14 | Projects tree: file rows | `src/home/ProjectsFolderTree.jsx:783-857` | `reorderFiles` (:460) → parent persist |

Consistent across Group A: grip-icon handle, vertical axis lock + clamp bounds,
PointerSensor(distance 6) + KeyboardSensor, pre-drag collapse orchestration where
rows expand (survey markers, spaces).

### Group B — bespoke @dnd-kit (3 surfaces, partly justified)
| # | Surface | File | Divergence verdict |
|---|---|---|---|
| 4 | Bookmarks tree (reorder + reparent) | `src/sidebar/BookmarksPanel.jsx:1459-1508` | **LOAD-BEARING** — depth projection, auto-expand-on-hover (420ms), clone ghost row, `MeasuringStrategy.Always`. Folding into the shared wrapper would bloat it. Tested: `tests/bookmarkReorderUtils.test.mjs`. |
| 5 | Tab bar: PDF tab reorder (horizontal) | `src/TabBar.jsx:424-458` | Horizontal axis justified; **incidental**: local `moveArrayItem` duplicates `flatReorderUtils.moveItem` (D1). |
| 8 | Templates editor: module tabs (horizontal) | `src/home/TemplatesEditor.jsx:479-559` | Horizontal axis justified; **incidental**: local `restrictSortableToHorizontalAxis` duplicates TabBar's (D2). |

### Group C — native HTML5 DnD (2 live surfaces, load-bearing)
| # | Surface | File | Why it must stay HTML5 |
|---|---|---|---|
| 6 | Cross-tab page drop target on tabs | `src/TabBar.jsx:327-370` | `dataTransfer` interop with the thumbnail drag source |
| 7 | Pages panel: thumbnail reorder + cross-tab drag source | `src/sidebar/PagesPanel.jsx:672-736,787-797` | the SAME element is the cross-tab drag source (`application/pdf-page`); splitting mechanisms per gesture would be worse. NOTE: internal reorder is a **name-swap stub** (`usePageOperations.js:191`) — real page-content reorder is future work, out of BL-18 scope. |

### Group D — custom pointer/mouse drags (load-bearing, NOT list reorder)
| # | Surface | File |
|---|---|---|
| 17 | Annotation edit-modal reposition | `src/PageAnnotationLayer.jsx:3501,4779-4810,9724-9732` (high-risk file — leave alone) |
| 20 | Counter pin drag-to-place | `PDFViewer.jsx:3185-3234,27871-28048` |

(The line/arrow endpoint+midpoint drag — formerly listed here as #19 — belongs to
the adjacent SVG interaction system and is covered under Scope above.)

### Not drag (listed for completeness)
| # | Surface | Note |
|---|---|---|
| 18 | Annotation z-order "reorder" | keyboard/menu-triggered, `PDFViewer.jsx:22736-22800` — not DnD |
| 21 | Survey-marker collapse/restore on drag | orchestration on top of #2, not a separate system |
| 22 | `src/prototype/FeatureSpike.jsx` | click-only tree; uses `bookmarkReorderUtils` for tree BUILD only. Protected fixture (never delete — see memory: pdf.js reference demos). |

### Group F — DEAD CODE (two blocks)
| # | Surface | File | Evidence |
|---|---|---|---|
| 16 | Dashboard entity/module/category reorder sensors + handlers | `src/Dashboard.jsx:198-236,2346-2360,2603-2617` | No `DndContext` anywhere in Dashboard JSX wires these sensors, and no prop passes them down; the related entity body-class effects and dnd imports are dead too. Template editing moved to `TemplatesEditor` (via SurveyHub). Migration artifact. |
| 15 | Dashboard OS file-drop handlers | `src/Dashboard.jsx:846-865` | The drop handlers exist but have NO callsite — Dashboard's current return renders hidden inputs + `SurveyHub`; no element wires `onDrop`/`onDragOver`/`onDragLeave`. Previously misread as live. Either delete with #16 or rewire deliberately if OS file-drop into the hub is wanted (product call). |

## Shared-code map

- `src/reorder/SortableRearrangeList.jsx` — the consolidation point (9 consumers).
- `src/reorder/DragRearrangeHandle.jsx` — grip handle (all Group A).
- `src/reorder/flatReorderUtils.js` — `moveItem`/`moveItemById`/… (tested: `tests/reorder/flatReorderUtils.test.mjs`).
- `src/home/templateReorderUtils.js` — wraps flatReorderUtils for template shapes; ALSO contains an unused, unexported duplicate of the vertical axis-lock (the live one inside `SortableRearrangeList` is canonical) — see D3.
- `src/sidebar/bookmarkReorderUtils.js` — bookmark-tree-only (tested).

## Incidental divergences (the consolidation backlog)

- **D1** `TabBar.jsx` local `moveArrayItem` ≡ `flatReorderUtils.moveItem` — replace with the shared import.
- **D2** Two horizontal axis-lock copies: `restrictTabsToHorizontalAxis` (`TabBar.jsx:49`) and `restrictSortableToHorizontalAxis` (defined `TemplatesEditor.jsx:76`, used :499) — extract ONE into `src/reorder/` and import from both. (The live VERTICAL lock inside `SortableRearrangeList` is canonical and stays.)
- **D3** `templateReorderUtils.js:11` carries an unused, unexported vertical axis-lock duplicate — delete it (note: its file doc-comment also claims an export that does not exist; fix the comment in the same slice).
- **D4** `PDFViewer.jsx:11863` uses `@dnd-kit/sortable`'s `arrayMove` for spaces while every other flat reorder uses `flatReorderUtils.moveItem` — one-line swap, but it lives in the high-risk viewer file (minimum-diff rules apply).
- **D5** Dragged-row opacity differs per consumer (0.72 / 0.8 / 0.92 / 0.94 as inline overrides of the shared 0.8 default) — **visual decision for Isaiah**: pick one value (or bless the variation) before any code change.
- **D6** Drag-active gold glow (`rgba(216,168,78,0.28)`) appears on some surfaces (module tabs, survey categories) and not others — same: **visual decision for Isaiah**.

## Slice plan (feeds KAL-84 — each slice independently shippable, gated on `npx vite build` + `npm test` i.e. `node scripts/run-node-tests.mjs`)

1. **Slice K84-1 — delete the Dashboard dead code (#16 AND #15).** Sensors + handlers + the dead entity body-class effects + now-unused dnd imports + the disconnected file-drop handlers (unless Isaiah wants OS file-drop rewired — ask first for #15 only). Risk: LOW (no runtime path; re-verify at build time per fallow rules: never auto-delete without re-verification). Files: `src/Dashboard.jsx` only.
2. **Slice K84-2 — de-duplicate helpers (D1 + D2 + D3).** Move the horizontal axis-lock into `src/reorder/` (new tiny module or export from `SortableRearrangeList`'s module), import it in TabBar + TemplatesEditor; swap TabBar's `moveArrayItem` for `flatReorderUtils.moveItem`; delete the unused vertical-lock copy in `templateReorderUtils`. Risk: LOW-MED (touches tab drag UX — manually verify tab + module-tab drag after).
3. **Slice K84-3 — visual consistency (D5 + D6), AFTER Isaiah picks the values.** Encode the chosen opacity/glow as `SortableRearrangeRow` defaults and delete the inline overrides. Risk: LOW (cosmetic), but **blocked on a product/visual decision** — do not start without it.
4. **Slice K84-4 (optional) — `arrayMove` → `moveItem` in PDFViewer (D4).** Risk: MED only because of the host file; one-line diff, run the full gates, no refactoring while in there.
5. **Explicit non-goals (documented divergences):** bookmarks tree stays bespoke; HTML5 page/file drops stay native; modal/canvas drags stay custom; the pages-panel reorder STUB (#7) is a separate feature ticket if real page reordering is ever wanted.

## Open decisions for Isaiah
- D5/D6 visual values (blocks slice K84-3 only).
- #15: delete the disconnected Dashboard file-drop handlers with the dead code, or rewire OS file-drop into the hub deliberately?
- Whether KAL-84's scope should absorb this slice plan as-is (recommended) or split slices into separate tickets.

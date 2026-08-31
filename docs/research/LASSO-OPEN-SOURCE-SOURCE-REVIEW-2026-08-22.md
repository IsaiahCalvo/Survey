# Open-source lasso source review

Checked 2026-08-23 against each project's own repository or docs. Here, **true freehand lasso** means the user draws an irregular pointer path that becomes the selection region. A polygon-click tool or rectangle marquee does not count.

## Ranked recommendation

1. **Infinite Canvas Tutorial** — best main design for a web/vector editor: freehand trail, zoom-aware simplification, bounds query, then object polygon tests.
2. **regl-scatterplot** — best input pipeline: time-and-distance sampling, clear start/extend/end events, long-press support, bounds pruning, and a winding test for self-crossing paths.
3. **BlockSuite 0.14** — best object hit-test reference: rotated corners, segment/polygon intersection, bounds pruning, plus live add/subtract. Its old source is MPL-2.0 and is not a current AFFiNE feature.
4. **ppInk** — best stroke-selection behavior reference: percentage coverage and explicit add/remove, though its Windows Ink code is not portable to the web.
5. **PenEcho** — best pen/touch robustness test reference: coalesced events, zoom-aware spacing, path caps, and pointer cancellation. Treat its AGPL code as study material only.
6. **Pixelorama** — useful for raster/OCR-mask selections and bounded pixel work, not for vector objects.
7. **D3 Lasso** — useful for live possible/not-possible feedback, but its center-point hit rule is too weak.
8. **Annotorious Selector Pack** — a small SVG freehand-region example, not an existing-object selector, and now archived.

Implement the logic in our code rather than importing a full editor:

1. Store coalesced pointer samples in page coordinates.
2. Admit a point only after a zoom-aware minimum distance; cap and simplify long paths.
3. Close the path on release, but cancel a path with fewer than three useful points or too little area.
4. Query annotation bounding boxes first, then run precise polygon tests only on those candidates.
5. Match AutoCAD's direction rules: left-to-right uses full containment, right-to-left selects enclosed or crossed objects, and Space cycles Window, Crossing, and Fence while the pointer stays down.
6. Keep live preview, Shift-add, subtract, pointer capture/cancel, undo, zoom, rotated pages, and cross-page drags in the test plan.

This combines the strongest parts of the sources without adding AGPL code or a raster-only model to Survey.

## Product behavior references

### Drawboard PDF

Drawboard confirms the exact three-mode menu in the supplied screenshot. Its Select tool dropdown offers **Select**, **Lasso Tool**, and **Text Select** on iOS and Mac. The current Windows toolbar groups **Rectangle Select**, **Lasso Select**, and **Text Select** in the same selection group. Drawboard describes lasso as drawing a freeform shape around complex or irregular annotation groups, and lists it for Web, Windows, and iOS. Sources: [iOS/Mac Markup Toolbar](https://support.drawboard.com/hc/en-us/articles/13324412767247-Drawboard-PDF-Using-Markup-tools-on-iOS-Mac), [Windows Markup Toolbar](https://support.drawboard.com/hc/en-us/articles/15630133419279-Drawboard-PDF-Using-the-Markup-Toolbar-on-Windows), and [Select & Pan](https://support.drawboard.com/hc/en-us/articles/360000753815-Select-Pan).

Useful behavior to copy:

- Keep Rectangle, Lasso, and Text Select in one dropdown on desktop and mobile.
- Keep the chosen mode visible as the active tool.
- Use lasso only for annotations; keep PDF text selection as its own mode.
- After selection, expose the same move, delete, copy, property-edit, and stamp actions as rectangle selection.
- Support item-level add/remove after the pass. Drawboard documents Shift-select for adding another annotation, Alt-select for removing one, and `Ctrl+Click` as a lasso shortcut in its [hotkey guide](https://support.drawboard.com/hc/en-us/articles/4406218819727-Hotkeys-and-Shortcuts). It does not confirm that Shift or Alt changes a whole lasso pass.

Drawboard's public help does **not** state whether an annotation must be fully enclosed or merely crossed. It also does not describe live candidate highlighting while the path is drawn. Survey must define and test both behaviors itself.

### AutoCAD

AutoCAD's lasso is a genuine press-drag irregular path: hold the mouse button, drag, then release to complete it. Autodesk documents three live modes: Window selects only fully enclosed objects, Crossing selects both crossed and enclosed objects, and Fence selects crossed objects. Drag direction chooses the first mode, and Space cycles modes while the pointer remains down. Shift can remove objects from the current set. Sources: Autodesk's current [Window, Fence, Lasso, and More guide](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-LT-DidYouKnow/files/GUID-D0D5C0C3-F092-448A-8E81-D38F27094639.htm), [selection steps](https://help.autodesk.com/cloudhelp/2021/ENU/AutoCAD-Core/files/GUID-243E4DD0-8947-4905-AFE2-BE9B903A8C3F.htm), and current [`PICKAUTO` docs](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Core/files/GUID-7BAAA374-8409-4296-B520-C5355941C836.htm).

Useful behavior to copy:

- Start lasso only after press-drag on empty canvas; a click on an object should select that object.
- Show the current lasso mode and selection area while the path changes. Autodesk documents configurable Window/Crossing area colors and opacity in its [visual-effect settings](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-LT/files/GUID-ADBC5107-9DCF-4033-B675-2726AD13FE33.htm), but does not clearly confirm per-object candidate highlighting during the drag.
- Let add/subtract work without redrawing the whole selection.
- Make the hit rule clear through the preview and cursor/state, not through hidden geometry.

Copy AutoCAD's direction-based rules as part of Survey's lasso:

- **Left-to-right:** Window mode; select only objects fully enclosed by the freehand region.
- **Right-to-left:** Crossing mode; select objects that are enclosed or touched by the freehand boundary.
- **Space while drawing:** cycle Window, Crossing, and Fence without ending the gesture.
- Show the active mode through the cursor, line/area color, and a short label so the rule is never hidden.

Survey already implements Window and Crossing direction rules for rectangle selection in `src/utils/marqueeSelection.js`, with coverage in `tests/marqueeSelection.test.mjs`. The lasso should reuse that shared mode decision and selection-state flow, replacing only the rectangle geometry with freehand polygon containment/intersection. The old lasso branch did not do this; it hard-coded full containment.

Keep Drawboard's simpler three-tool dropdown around this behavior: Rectangle Select, Lasso Select, and Text Select.

## Source-by-source findings

| Project | True freehand? | License | What is useful for Survey | Limits |
|---|---:|---|---|---|
| [Infinite Canvas Tutorial](https://github.com/xiaoiver/infinite-canvas-tutorial) | **Yes** | [MIT](https://github.com/xiaoiver/infinite-canvas-tutorial/blob/master/LICENSE) | Its lasso trail takes freehand points, simplifies them by a zoom-linked distance, gets candidates from a bounds query, then tests polygon intersection. See [`lasso-trail.ts`](https://github.com/xiaoiver/infinite-canvas-tutorial/blob/master/packages/plugin-lasso/src/lasso-trail.ts), [`utils.ts`](https://github.com/xiaoiver/infinite-canvas-tutorial/blob/master/packages/plugin-lasso/src/utils.ts), and [Lesson 26](https://infinitecanvas.cc/guide/lesson-026). This is the closest match to a web PDF/vector layer. | The current plugin also has a lasso *draw* mode. Copy only the selection ideas we need, not its editor state model wholesale. |
| [AFFiNE / BlockSuite 0.14](https://github.com/toeverything/blocksuite/releases/tag/v0.14.0) | **Yes in AFFiNE 0.14; not verified in current canary** | The old lasso source is [MPL-2.0](https://github.com/toeverything/blocksuite/blob/v0.14.0/LICENSE); current AFFiNE CE is [mainly MIT with listed exceptions](https://github.com/toeverything/AFFiNE#license). | The [v0.14 controller](https://github.com/toeverything/blocksuite/blob/v0.14.0/packages/blocks/src/root-block/edgeless/controllers/tools/lasso-tool.ts) stored freehand points, live-selected, supported Shift-add and Alt-subtract, pruned by bounds, and tested rotated object corners plus line/polygon intersections. The [v0.14 release](https://github.com/toeverything/blocksuite/releases/tag/v0.14.0) says this BlockSuite release shipped in AFFiNE 0.14. | The current AFFiNE canary tree has no clear lasso source. Do not call it a current feature, and do not treat the older BlockSuite code as MIT. |
| [ppInk](https://github.com/pubpub-zz/ppInk) | **Yes** | [MIT](https://github.com/pubpub-zz/ppInk/blob/master/license.txt) | It captures a drawn point list and uses Windows Ink's `Ink.HitTest(points, percent)` with an [80% stroke-hit threshold](https://github.com/pubpub-zz/ppInk/blob/master/src/Root.cs#L145), then supports add/remove and move/copy/delete behavior. See the [lasso guide](https://github.com/pubpub-zz/ppInk#lasso) and [capture code](https://github.com/pubpub-zz/ppInk/blob/master/src/FormCollection.cs#L2632). This is useful evidence that stroke coverage, not just stroke centers, matters. | Native C#/Windows Ink code cannot drop into the web app. Its 80% rule is tuned for ink and would miss some shape/text cases. |
| [Pixelorama](https://github.com/Orama-Interactive/Pixelorama) | **Yes** | [MIT](https://github.com/Orama-Interactive/Pixelorama/blob/master/LICENSE) | The app exposes a real “Lasso / Free Select Tool”; its [tool source](https://github.com/Orama-Interactive/Pixelorama/blob/master/src/Tools/SelectionTools/Lasso.gd) records a free path and turns it into a pixel selection. The changelog notes bounds-based work so cost follows the selection area rather than the full canvas. | It selects raster pixels, not annotation objects. Use its bounds clipping and out-of-canvas tests as ideas, not its selection data model. |
| [PenEcho](https://github.com/penecho/penecho) | **Yes** | [AGPL-3.0-only](https://github.com/penecho/penecho/blob/main/LICENSE) | It consumes `getCoalescedEvents()`, uses a zoom-aware minimum point distance, caps long trails, tests the closed polygon rather than its box, and handles `pointercancel`. See [gesture handling](https://github.com/penecho/penecho/blob/main/src/client/app/persistence.js#L2470), [geometry helpers](https://github.com/penecho/penecho/blob/main/public/selection.js), and [selection tests](https://github.com/penecho/penecho/blob/main/test/selection.test.js). Those are strong mobile/stylus test ideas. | Do not copy code into a closed-source product without meeting AGPL terms or buying the offered commercial license. It selects bitmap ink fragments, not PDF vector annotations. |
| [regl-scatterplot](https://github.com/flekschas/regl-scatterplot) | **Yes** | [MIT](https://github.com/flekschas/regl-scatterplot/blob/main/LICENSE) | Its default is freeform. It throttles samples by both time and minimum distance, has long-press and explicit lasso modes, publishes start/extend/end events, narrows candidates by lasso bounds, then uses a non-zero winding point-in-polygon test that handles overlapping/self-crossing paths. See [lasso manager](https://github.com/flekschas/regl-scatterplot/blob/main/src/lasso-manager/index.js), [candidate filtering](https://github.com/flekschas/regl-scatterplot/blob/main/src/index.js#L667), and [polygon test](https://github.com/flekschas/regl-scatterplot/blob/main/src/utils.js#L253). | It selects points, so its final hit test is not enough for strokes, boxes, text, or area marks. Adapt the input pipeline, not the point-only selection rule. |
| [Annotorious v2 Selector Pack](https://github.com/annotorious/annotorious-v2-selector-pack) | **Yes, as a freehand region drawing tool** | [BSD-3-Clause](https://github.com/annotorious/annotorious-v2-selector-pack/blob/main/LICENSE) | [`RubberbandFreehand.js`](https://github.com/annotorious/annotorious-v2-selector-pack/blob/main/src/freehand/RubberbandFreehand.js) shows a small SVG rubber-band path built from drag points and saved as an SVG selector. | It creates an image annotation region; it does not select existing annotation objects. The repo was [archived in 2024](https://github.com/annotorious/annotorious-v2-selector-pack), and its source has TODOs for smoothing. Use only as a simple SVG-path reference. |
| [D3 Lasso](https://github.com/skokenes/D3-Lasso) | **Yes** | [BSD-3-Clause](https://github.com/skokenes/D3-Lasso/blob/master/LICENSE) | It records drag points, shows a close-path line near the origin, supports hover-select, and marks candidates live as possible/not possible before committing selected/not selected. See [`src/lasso.js`](https://github.com/skokenes/D3-Lasso/blob/master/src/lasso.js) and the [API guide](https://github.com/skokenes/D3-Lasso#lassoing-tags). | It is old and decides loop inclusion from each element's center point. That is not enough for long strokes or large/rotated objects, so do not use its hit test as Survey's final geometry rule. |

## What should enter Survey's lasso tests

- Pointer: mouse, pen, touch, coalesced events, two pointers, lost capture, cancel, and release outside the page.
- Path: tiny tap, open path, three-point path, self-crossing loop, very dense path, path outside the page, and zoom while drawing.
- Object geometry: ink crossing the boundary, thin lines, rotated boxes, text, grouped marks, stamps/images, partial overlap, full containment, locked/hidden objects, and objects under another page overlay.
- State: replace selection, Shift-add, subtract, clear on empty click, move after selection, undo/redo, save/reload, and no mutation until pointer release.
- Speed: bounding-box candidate query first; measure large annotation sets and cap/simplify path points without changing the visible result.

## License call

MIT/BSD sources are safe references subject to their notices. PenEcho is the exception: treat its code as study material unless the product can comply with AGPL or obtains a commercial license. AFFiNE's root license has path-specific exceptions, so check the exact file's terms before copying anything.

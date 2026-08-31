# PDF text and lasso selection

Date: 2026-08-21

## Decision

Build one Select tool with three modes:

1. **Rectangle Select** — select Survey objects inside a dragged box.
2. **Lasso Select** — select Survey objects inside a free-drawn polygon.
3. **Text Select** — select real PDF text, then offer Copy, Highlight, Underline, Squiggle, and Strikeout.

Use PDF.js for embedded text. Do not add a second PDF parser. Use browser `Selection` and `Range` geometry for the first text-markup release. Add local OCR only when a page has no useful embedded text. Keep rectangle and lasso selection separate from text selection: they select annotation objects, while Text Select selects document text.

The current branch is closer than the toolbar suggests. [`PdfjsTextLayer.jsx`](../../src/components/PdfjsTextLayer.jsx) already renders a selectable PDF.js text layer and gates its pointer input to Text Select. [`SVGAnnotationLayer.jsx`](../../src/components/SVGAnnotationLayer.jsx) already lets empty-page input fall through in `text-select` mode. The missing part is the end-to-end markup path: [`PdfjsViewerContainer.jsx`](../../src/components/PdfjsViewerContainer.jsx) still returns no-ops for text-markup select, delete, and erase, and [`PDFViewer.jsx`](../../src/PDFViewer.jsx) keeps text highlight, underline, strikeout, and squiggle out of the toolbar for that reason.

## Exact Chrome source inventory

The **PDF** tab group was open when inspected. It held 22 tabs and was left open and unchanged. The tabs, in Chrome's order, were:

1. [react-pdf-highlighter-extended](https://github.com/DanielArnould/react-pdf-highlighter-extended?utm_source=chatgpt.com)
2. [OCRmyPDF introduction](https://ocrmypdf.readthedocs.io/en/latest/introduction.html)
3. [dnd kit](https://dndkit.com/)
4. [Mozilla PDF.js viewer](https://mozilla.github.io/pdf.js/web/viewer.html?utm_source=chatgpt.com)
5. [EmbedPDF](https://www.embedpdf.com/)
6. [react-pdf-highlighter-plus demo](https://quocvietha08.github.io/react-pdf-highlighter-plus/example-app/#)
7. [Selecto with Moveable demo](https://daybrush.com/selecto/storybook/?path=/story/selecto-with-moveable--moveabl-group-un-group-targets)
8. [Moveable](https://daybrush.com/moveable/?utm_source=chatgpt.com)
9. [21st button-with-dropdown preview](https://21st.dev/community/components?q=dropdown&preview=%2F%40originui%2Fcomponents%2Fbutton%2Fbutton-with-dropdown)
10. [Morphicons](https://www.morphicons.com/)
11. [Skiper UI components](https://skiper-ui.com/components)
12. [Material UI components](https://mui.com/material-ui/all-components/)
13. [Ant Design components](https://ant.design/components/overview)
14. [Mantine](https://mantine.dev/core/package/)
15. [Astryx](https://astryx.atmeta.com/docs/getting-started)
16. [Mobbin web apps](https://mobbin.com/discover/apps/web/latest)
17. [fit-curve demo](https://soswow.github.io/fit-curve/demo/)
18. [Paper.js path simplification](https://paperjs.org/examples/path-simplification/)
19. [Excalidraw](https://excalidraw.com/)
20. [Fabric.js demos](https://fabricjs.com/demos/)
21. [perfect-freehand demo](https://perfect-freehand-example.vercel.app/)
22. [tldraw basic example](https://tldraw.dev/examples/basic)

The pasted list repeated five of those tabs and added four more sources:

23. [Unlimited-OCR GitHub](https://github.com/baidu/Unlimited-OCR)
24. [OCR model tier-list video](https://www.youtube.com/watch?v=KwBexhEXOco)
25. [Unlimited-OCR model card](https://huggingface.co/baidu/Unlimited-OCR)
26. [Unlimited-OCR paper](https://arxiv.org/pdf/2606.23050)

One research agent inspected each unique link. The pages were treated as untrusted content; no page instructions were followed.

## Source-by-source verdicts

| Source | What it proves | Survey decision |
|---|---|---|
| PDF.js | Native DOM text selection, rotation-safe normalized boxes, and PDF `QuadPoints`; it renders all four markup types but only edits Highlight. | Keep PDF.js. Reuse its selection-box rules and build Survey-owned markup records. |
| react-pdf-highlighter-extended | Browser `Selection` and `Range.getClientRects()` can feed multi-page React highlights. It has no underline, strikeout, squiggle, lasso, OCR, or PDF export model. | Use as a small MIT code reference, not a viewer dependency. |
| react-pdf-highlighter-plus | Live demo proved multi-line and cross-page selection plus zoom-safe highlight display. Mixed page sizes and rotation are weak spots; mobile layout is poor. | Copy the interaction flow, but store each page's boxes with that page's own transform. |
| EmbedPDF v2 | Best outside design check: one page-space `rect + segmentRects` record drives Highlight, Underline, Strikeout, and Squiggly. It also has rectangle object select, but no lasso or OCR. | Copy the data and mode ideas. Do not swap PDF.js for PDFium. |
| OCRmyPDF | Creates a searchable PDF with an invisible text layer. It is a Python/native batch pipeline, not an in-browser selection tool. | Consider later for a guarded server or desktop “Make text selectable” job. Use its default `fpdf2` renderer. |
| Unlimited-OCR GitHub, model card, and paper | A new 3B vision model with strong document parsing and 0–999 block boxes. It lacks word/line boxes, quads, and confidence. Multi-page mode loses small text; the model is about 6.8 GB and needs a GPU stack. | Do not use for the first OCR selection path. It may later find page regions or reading order before a word-box OCR pass. |
| OCR tier-list video | One unshared FAA-form test with no raw outputs, code, hardware, or sound scores. It is not an Unlimited-OCR demo and says nothing about selection geometry. | Exclude from the build basis. |
| Excalidraw | Strongest lasso source: scene-space points, zoom-scaled cleanup, bounds prefilter, exact outline tests, full-containment and overlap modes, group and lock rules, and good edge-case tests. | Port the algorithm shape and tests into Survey's page-space model. Do not import the app. |
| tldraw | Built-in rectangle and scribble select plus a separate strict-containment lasso example. It has sound page-space, spatial-index, touch, pen, and group rules. | Use as a design and test reference. Do not add its licensed SDK. |
| Fabric.js | Survey already has it. It provides rectangle select, `ActiveSelection`, transforms, polygons, and geometry helpers, but no lasso select. | Feed lasso hits into current selection state; do not create a saved Fabric path for the lasso. |
| Paper.js | Good path capture, simplify, contain, and intersection parts, but it would add another canvas and coordinate system. Curve simplification can drift from the user's path. | Build a small pure Survey geometry module instead. |
| fit-curve | Fits cubic curves to pointer samples but can round corners, change topology, and is not a closed-polygon hit-test tool. | Optional paint-only polish after lasso works; never use it as hit-test truth. |
| perfect-freehand | Makes smooth pressure-aware stroke outlines, not lasso polygons. Its output can self-cross. | Optional preview only. Keep raw or line-simplified page points as truth. |
| Selecto | Rectangle DOM/SVG marquee with useful `hitRate` rules; no freehand lasso and no canvas-object access. The supplied old demo now has no preview. | Borrow rectangle semantics and Shift behavior; do not add it for lasso. |
| Moveable | Rich DOM/SVG move, resize, rotate, and group handles; no lasso or text selection. Its screen/CSS transform model can fight Survey's SVG viewBox. | Do not add for this feature. Revisit only for a small transform-handle spike. |
| dnd kit | Good pointer, touch, keyboard, cancel, and access patterns; no PDF text, resize, or lasso geometry. | Use as an input checklist, not a dependency. |
| 21st dropdown | The live split-button and radio menu match the Drawboard model. Its main demo button does not run an action and its stack does not match Survey. | Rebuild the pattern with Survey's toolbar and current Radix base. |
| MUI, Ant Design, Mantine, and Astryx | All support an accessible one-of-three menu pattern. MUI and Ant are too broad; Mantine and Astryx now require React 19 while Survey uses React 18. | Borrow menu roles, keys, focus return, placement, and touch rules; add no new design system. |
| Skiper UI | Its popover and active-icon ideas are useful, but the closest parts are paid and the site terms limit copying. | Use as visual reference only. |
| Morphicons | Can animate between select icons, but would add Morphicons and Lucide for a small gain. | Use clear static Survey icons first. |
| Mobbin | The public page exposed only the sign-in shell; screenshots cannot prove input or geometry. Its terms limit copying. | Do not use as proof. The supplied Drawboard shot is the main UX reference. |

## Why this base is sound

PDF.js's own `TextLayerBuilder` says its job is to create overlay text that matches the PDF so the browser can select it. It streams page text into `TextLayer`, keeps it in step with the page viewport, normalizes copied Unicode, and adds selection handling that the low-level `TextLayer` alone does not provide. Survey should either mount `TextLayerBuilder` or copy all of those behaviors with tests; using the builder is safer. [PDF.js `TextLayerBuilder`](https://github.com/mozilla/pdf.js/blob/v6.1.200/web/text_layer_builder.js#L47-L132) [selection handling](https://github.com/mozilla/pdf.js/blob/v6.1.200/web/text_layer_builder.js#L166-L293)

`getTextContent()` remains useful for scan detection, search, and fallback hit tests. Each `TextItem` has a string, direction, transform, width, height, font name, and end-of-line flag. An item is a text run, not a promised word or glyph, so code must not treat item boundaries as word boundaries. [PDF.js text data types](https://github.com/mozilla/pdf.js/blob/v6.1.200/src/display/api.js#L1114-L1159) [text-content methods](https://github.com/mozilla/pdf.js/blob/v6.1.200/src/display/api.js#L1701-L1747)

PDF.js itself turns a browser selection into markup geometry by reading `Range.getClientRects()`, dropping empty boxes, normalizing each box against the text-layer bounds, and accounting for page rotation. This is the right first path for Survey. [PDF.js `getSelectionBoxes`](https://github.com/mozilla/pdf.js/blob/v6.1.200/src/display/editor/tools.js#L2936-L3008)

An open React viewer uses the same flow: read the browser range, collect its client rects, build one bounding box plus per-line boxes, save zoom-free page positions, and keep the selected text. This is useful as a small React reference, but Survey should keep its own model and UI. [react-pdf-highlighter-extended selection flow](https://github.com/DanielArnould/react-pdf-highlighter-extended/blob/b58a3b387d870a44051a7d032e5f67ecabeb7909/src/components/PdfHighlighter.tsx#L270-L328) [coordinate model](https://github.com/DanielArnould/react-pdf-highlighter-extended/blob/b58a3b387d870a44051a7d032e5f67ecabeb7909/src/lib/coordinates.ts#L10-L117)

## Text selection and markup design

### Interaction

When Text Select is active:

- Put the PDF.js text layer above the page canvas but below the small toolbar shown after selection.
- Turn off whole-page pointer capture in Survey's SVG object layer. Keep annotation hit areas available only if that does not break the browser range.
- On `pointerup` and keyboard selection changes, inspect `window.getSelection()`.
- Reject collapsed ranges and ranges outside the PDF viewer.
- Split a selection that crosses pages into one page record per page.
- For each page, call `range.getClientRects()`, clip each rect to that page's text-layer bounds, discard zero-size rects, and merge near-touching boxes on the same line.
- Show a small action bar: **Copy**, **Highlight**, **Underline**, **Squiggle**, **Strikeout**. The native blue selection remains temporary. A markup action creates persistent Survey annotations and then clears the browser selection.
- `Esc` clears the browser selection and the action bar. Delete acts on a selected saved markup, not on a live text range.

Use `selection.toString()` for Copy, with the same null removal and Unicode normalization that PDF.js uses. Do not rebuild copied text by joining `TextItem.str`; that can harm spacing and reading order.

### One geometry model for all four markups

Use one versioned, zoom-free record. Create one annotation per page, joined by `selectionGroupId` when a drag spans pages.

```ts
type TextMarkup = {
  version: 1;
  id: string;
  selectionGroupId: string;
  pageNumber: number;
  kind: "text-markup";
  style: "highlight" | "underline" | "squiggle" | "strikeout";
  source: "pdf-text" | "ocr";
  text: string;
  // Top-left page space, values from 0 through 1. One box per text fragment/line.
  boxes: Array<{ x: number; y: number; width: number; height: number }>;
  color: string;
  opacity: number;
  ocr?: { engine: string; language: string; meanConfidence?: number; revision: string };
};
```

Keep `boxes` as the source of truth. Derive screen geometry on each render. Derive PDF `QuadPoints` on native export. Do not store both normalized boxes and mutable screen rectangles.

PDF.js stores selected-text highlight boxes in normalized page space and serializes each box as eight PDF coordinates in the order top-left, top-right, bottom-left, bottom-right. The same quads can drive all four PDF text-markup subtypes. [PDF.js highlight deserialization](https://github.com/mozilla/pdf.js/blob/v6.1.200/src/display/editor/highlight.js#L758-L789) [quad serialization](https://github.com/mozilla/pdf.js/blob/v6.1.200/src/display/editor/highlight.js#L962-L990)

For view and export transforms, use the page viewport as the one source of scale, rotation, offsets, user units, and the PDF-to-screen Y flip. `convertToViewportPoint()` maps PDF to view space; `convertToPdfPoint()` maps view space back to PDF. This follows the app rule that the SVG viewBox owns zoom and avoids new JavaScript zoom state. [PDF.js `PageViewport`](https://github.com/mozilla/pdf.js/blob/v6.1.200/src/display/page_viewport.js#L48-L214)

Render from each box as follows:

- **Highlight:** a filled quad or rect, with the saved color and opacity.
- **Underline:** a line close to the bottom edge of each box.
- **Strikeout:** a line near the text midline for each box.
- **Squiggle:** a clipped repeating wave near the bottom edge. Base wave size on box height, not zoom.

For native PDF save, emit `Highlight`, `Underline`, `Squiggly`, or `StrikeOut` with the same `QuadPoints`. PDF.js can render all four existing annotation types, but its built-in editor creates Highlight only; Survey must own creation and editing for the other three. [PDF.js annotation classes](https://github.com/mozilla/pdf.js/blob/v6.1.200/src/core/annotation.js#L5044-L5298) [PDF.js request for the missing editors](https://github.com/mozilla/pdf.js/issues/18683)

### Limits to plan for

- DOM client rects are axis-aligned. They cover normal 0/90/180/270 page text well. Arbitrary angled or curved text may need a later `TextItem.transform`-based quad path.
- PDF text order can be wrong in the source file, especially in old OCR layers or complex columns. PDF.js exposes the file's text order; it cannot always infer the visual reading order. [PDF.js reading-order case](https://github.com/mozilla/pdf.js/issues/17191)
- A saved PDF text markup does not normally store the marked text itself. Keep `text` in Survey data for search and comments, but rebuild it from the PDF text layer when importing a foreign markup if needed. [PDF.js note on annotations and text](https://github.com/mozilla/pdf.js/issues/17509#issuecomment-1890469653)

## Lasso selection design

Lasso is Survey object selection, not PDF text selection.

### Input and geometry

1. Lock the gesture to the page where it starts.
2. Convert every pointer sample into that page's existing annotation coordinate space at capture time. Never store client pixels.
3. Add a point only after it moves about 2–4 screen pixels from the last point. Convert that screen gap through the live page scale so the feel stays stable at every zoom.
4. Draw an open path while dragging. On release, close it if there are at least three points. Treat a very small path as a tap.
5. Use the lasso bounding box as the first, cheap object filter.
6. Line-simplify the finished polygon for hit tests. A smoothed Bézier may be used only for paint because it can move the boundary.
7. For candidates in the bounds, test their real transformed outline. Full containment requires the outline points to be inside and no object edge to cross the lasso edge. This matters for a concave lasso whose spike cuts through an object.

Use **full containment** for the first release. It is easier to predict and avoids grabbing nearby marks:

- Ink/highlighter strokes: all sampled centerline points must be inside the polygon and no segment may cross its edge. Include half the stroke width in the final check where practical.
- Rects, text boxes, images, notes, and callouts: test the transformed outline and its edges, not an unrotated bounding box.
- Lines and arrows: test both ends plus any bend or midpoint.
- Groups: select the group only when every visible child is inside.
- Hidden or locked objects do not enter the candidate set.

Xournal++ uses this same broad model: it stores a freehand polygon, rejects points outside its bounding box, uses an odd-even point-in-polygon test, requires every stroke point to be inside, and requires all four bounds corners for basic elements. Its selection menu also offers separate rectangle and free-area modes. [Xournal++ lasso source](https://github.com/xournalpp/xournalpp/blob/ee8f2def61304f20abcd09ec6be1386144b09118/src/core/control/tools/Selector.cpp#L132-L308) [stroke containment](https://github.com/xournalpp/xournalpp/blob/ee8f2def61304f20abcd09ec6be1386144b09118/src/core/model/Stroke.cpp#L232-L243) [basic element containment](https://github.com/xournalpp/xournalpp/blob/ee8f2def61304f20abcd09ec6be1386144b09118/src/core/model/Element.cpp#L69-L85) [selection menu behavior](https://github.com/xournalpp/xournalpp/wiki/User-Manual#selection-and-movement-tools)

Implement the geometry in a small pure Survey module with unit tests. Do not copy Xournal++ code because its GPL terms are not a fit for code copied into this app.

### Selection rules

- Plain drag replaces the current selection.
- Shift-drag adds the enclosed objects.
- Option/Alt-drag can subtract later; it is not needed for the first release.
- One undo step should cover the next move, resize, delete, group, or style action, not the act of selecting.
- Keep the current multi-select frame and edit rules after hit testing; lasso should only produce the same `selectedIds` shape as rectangle select.
- On touch, cancel or suspend the lasso when a second pointer appears so pinch zoom wins. On pen input, ignore palm or stray touch points while the pen owns the gesture.

## OCR fallback for scanned PDFs

PDF.js extracts text already present in a PDF. It does not recognize text in a page image. When Text Select opens on a page, inspect trimmed `TextItem.str` content. If the page has no useful text, show **Recognize text on this page** and start local OCR when the user taps it. A document-wide OCR command can come later.

Recommended local path:

1. Render the page through the existing PDF.js canvas at about 200–300 DPI (`dpi / 72` viewport scale). Do this off the visible canvas.
2. Reuse one Tesseract.js worker instead of creating a worker per page.
3. Request `blocks`, `hocr`, or `tsv` output because modern Tesseract.js returns only plain text by default. These formats include layout and box data needed for selection.
4. Map OCR pixel boxes into normalized page boxes, then create a synthetic transparent text layer with the same page-local geometry contract as embedded PDF text.
5. Cache the OCR result by document hash, page, render DPI, language set, and OCR engine revision.
6. Keep OCR text local by default. Do not upload a user's plan sheet to an OCR service without a separate product and privacy decision.

Tesseract.js runs in browsers and Node, but it does not read PDFs itself; PDF.js must rasterize the pages first. Its API also says images need enough resolution and non-text outputs must be requested. [Tesseract.js PDF limit](https://github.com/naptha/tesseract.js/blob/a1ca80d9e31c34512d0ded75ff8821ddcf3f2f91/docs/faq.md#are-pdf-files-supported) [recognition output API](https://github.com/naptha/tesseract.js/blob/a1ca80d9e31c34512d0ded75ff8821ddcf3f2f91/docs/api.md#workerrecognizeimage-options-output-jobid-promise)

OCRmyPDF is a good desktop or server batch option when the goal is to produce a new searchable PDF with a hidden text layer. It rasterizes pages, runs OCR, and adds a searchable layer. It is not the first fit for a browser/mobile gesture because it is a Python pipeline and changes or creates a PDF. [OCRmyPDF design](https://github.com/ocrmypdf/OCRmyPDF/blob/ddb8c4dcdc799851a7cc380d975318e8602f2cef/docs/introduction.md)

Do not auto-OCR pages that already have sound embedded text. Do not promise good handwriting support; Tesseract.js states that its model targets printed text, not handwriting. [Tesseract.js FAQ](https://github.com/naptha/tesseract.js/blob/a1ca80d9e31c34512d0ded75ff8821ddcf3f2f91/docs/faq.md#is-handwritten-text-supported)

## Desktop and mobile UI

Match the supplied Drawboard pattern on both:

- The Select button shows the last mode used.
- Main button click turns that mode on.
- The caret opens **Select**, **Lasso Select**, and **Text Select**.
- Keep one mode active until the user changes tools.
- Use the same names and order on desktop and mobile.

For a low-risk first diff, map those menu rows to the app's existing tool IDs: `select`, new `lasso-select`, and `text-select`. A later cleanup may split `activeTool: "select"` from `selectionMode`, but that is not needed to ship the feature.

On mobile, make menu rows and the action bar at least 44 CSS pixels tall. Text selection needs real-device checks on iOS and Android for drag handles, long press, page scroll, pinch zoom, and the system copy menu. Do not assume desktop browser selection behavior will match touch. Lasso should set `touch-action: none` only while its gesture owns the pointer; Text Select must let the browser own the selection gesture.

## Build order

### Slice 1 — complete embedded text selection

- Replace or wrap the current low-level text layer with PDF.js `TextLayerBuilder` behavior.
- Add a pure `selectionRangeToPageBoxes` helper based on PDF.js `getSelectionBoxes`.
- Add the transient action bar and Copy.
- Add tests for zoom, crop boxes, all four right-angle rotations, mixed text direction, multi-line, and multi-page ranges.

### Slice 2 — all text markups

- Add the shared `TextMarkup` record and one renderer.
- Add Highlight, Underline, Squiggle, and Strikeout from the same boxes.
- Wire save, sync, history, select, delete, erase, print, and native PDF export.
- Unhide the existing toolbar menu only after these hooks stop returning no-ops.

### Slice 3 — lasso

- Add `lasso-select` to the Select dropdown.
- Add the pure polygon helper and object-specific containment adapters.
- Feed the result into the current multi-select state and frame.
- Test rotated shapes, thick strokes, callouts, groups, hidden/locked items, page edges, zoom, and pan cancellation.

### Slice 4 — scanned pages

- Add embedded-text detection and the per-page Recognize action.
- Add a local Tesseract.js worker, box output, synthetic text layer, caching, progress, cancel, and error states.
- Test mixed PDFs where some pages have text and others are scans.

### Slice 5 — mobile polish

- Put the same three modes in the mobile Select menu.
- Test touch selection handles and the markup action bar on real iOS and Android devices.
- Test lasso with finger and stylus, plus scroll and pinch handoff.

## Acceptance checks

- Text selection stays aligned at every supported zoom and page rotation.
- A multi-line or multi-page selection produces the right boxes and text.
- Each markup renders, saves, reloads, syncs, prints, deletes, erases, and exports to a PDF that another viewer can open.
- Rectangle and lasso select the same object IDs for equivalent enclosed areas.
- A lasso does not select a partly enclosed object in the first release.
- Text Select does not move Survey objects or start a marquee.
- A scan shows a clear Recognize action, then supports selection from cached OCR boxes.
- Switching Select modes does not leave a live browser range, lasso path, or stale selection frame.
- Desktop mouse, trackpad, keyboard, touch, and pen flows all have explicit tests where the platform supports them.

## License notes

| Project | License | Use here |
|---|---|---|
| [PDF.js](https://github.com/mozilla/pdf.js/blob/v6.1.200/LICENSE) | Apache-2.0 | Already used. Reuse its public package and concepts; keep required notices when shipping its code. |
| [react-pdf-highlighter-extended](https://github.com/DanielArnould/react-pdf-highlighter-extended/blob/b58a3b387d870a44051a7d032e5f67ecabeb7909/LICENSE) | MIT | Safe as a React design reference. If code is copied, keep its license notice. |
| [Tesseract.js](https://github.com/naptha/tesseract.js/blob/a1ca80d9e31c34512d0ded75ff8821ddcf3f2f91/LICENSE.md) | Apache-2.0 | Good local OCR candidate. Account for its core and language-data files in packaging and notices. |
| [OCRmyPDF](https://github.com/ocrmypdf/OCRmyPDF/blob/ddb8c4dcdc799851a7cc380d975318e8602f2cef/LICENSE) | MPL-2.0 | Consider for a separate desktop/server batch path. Check the licenses of its system tools before bundling. |
| [Xournal++](https://github.com/xournalpp/xournalpp/blob/ee8f2def61304f20abcd09ec6be1386144b09118/LICENSE) | GPL-2.0 | Use only as a behavior and algorithm reference unless the app's license plan changes. Do not copy its implementation. |

This is product and engineering guidance, not legal advice.

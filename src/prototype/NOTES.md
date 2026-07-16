# PDF.js Feature Demo - Temporary Development Reference

This demo is tracked by Linear KAL-371. It is a temporary comparison target,
not customer-facing product UI. Keep it until Isaiah physically confirms that
the production PDF experience matches or beats it, then remove it.

The route must remain inside the `import.meta.env.DEV` guard in `src/main.jsx`.
The production build runs `scripts/assert-no-pdfjs-demo-in-dist.mjs` and fails if
demo code appears in the customer bundle.

## Run

Start the dev server and open:

`?spike=features`

For a shareable benchmark URL, use:

`?spike=features&mode=performance`

The Performance button switches between the complete feature surface and the
isolated benchmark surface without changing renderer implementations.

## Feature Mode

- Virtualized PDF.js page rendering and cursor-anchored zoom
- One editable Canvas2D annotation renderer per mounted page
- Imported PDF markups, pen, textbox, select, move, partial erase, and full erase
- Space-drag pan, bookmarks, text search/select/copy, links, and form widgets
- Local PDF upload and bundled real, stress, markup, and large-sheet fixtures

## Performance Mode

- Uses the same `PdfjsArm.jsx` and Canvas2D annotation path as Feature mode
- Hides bookmarks, search, text, link, and form layers to isolate page plus
  annotation rendering costs
- Supports up to 2,000 synthetic annotations per page, or 240,000 document-wide
- Reports zoom, fps, worst frame, mounted pages, raster time, heap, and pass gates
- Records cursor zoom gestures, dropped frames, raster events, and timeline samples
- Saves `PDF.js feature performance <timestamp>.log` with the Save log button or
  Cmd/Ctrl+Shift+L

Filled ink uses polygon subtraction for rounded eraser bites. Thin imported ink
uses swept-capsule centerline cutting. Shortcuts: `P` pen, `E` erase, `V` select,
`T` text, and hold Space while dragging to pan.

The retired `renderer` and `perfgate` routes were consolidated here on 2026-07-15.
The EmbedPDF comparison arm, PDFium WASM, and EmbedPDF packages were removed after
the renderer decision settled on PDF.js.

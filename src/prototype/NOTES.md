# PDF.js Feature Demo - Permanent Reference

Do not delete `src/prototype/` or the `?spike=features` route in `src/main.jsx`.
This is the single gold-standard reference and regression surface for the app's
owned PDF.js renderer and Canvas2D annotation layer. It runs without auth,
Supabase, or the production viewer lifecycle.

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

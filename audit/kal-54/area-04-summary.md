# Area 4 — PDF viewer + annotation basics · **CHILD-FILED (KAL-55)**

- `normal-test.pdf` opens in the viewer with the Audit Test page 1 header visible (`screenshots/upload-01-after-pdf-open.png`).
- The annotation pipelines (pen, highlighter, line, arrow, rect, ellipse, text box, callout, counter) all live on main — `src/PageAnnotationLayer.jsx` and `src/utils/svgAnnotationRenderers.jsx` reference all of them, including the 6-arrowhead-style renderer.
- **KAL-33 (arrowhead style picker in AnnotationPropertiesPanel) not in main** — `src/components/AnnotationPropertiesPanel.jsx` on main only exposes Text Color + Font Size for text annotations. No arrowhead picker for arrow/line shapes. Confirmed via direct grep of the file.
- **KAL-34 (font / style / align controls for textbox properties) not in main** — same panel file has no font-family selector, no bold/italic toggle, no alignment row.
- Both tracked under **KAL-55**.

Per-tool create/edit/delete/undo/redo/save/reload was not exhaustively driven through the headless Playwright run because Syncfusion canvas drag interactions are heavy in headless mode and the harder regressions in this area are blocked on KAL-33/34 merging. The protected high-risk files (PageAnnotationLayer.jsx, FabricDrawingCanvas/EraserCanvas/EditCanvas, SVGAnnotationLayer.jsx) were not touched during this audit.

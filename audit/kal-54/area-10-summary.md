# Area 10 — Export surfaces · **PARTIAL PASS / CHILD-FILED (KAL-55)**

- `handleExportAnnotatedPDF` lives on main (`src/App.jsx:26213`) and writes annotated PDFs via `electronAPI.saveFile`. Survey Excel export utilities, Spaces CSV export utilities, and Spaces PDF Pages export are all present in `src/utils/` (saveAnnotatedPDFFile.js, pdfAnnotationsPdfLib.js, etc.).
- **KAL-51 (rename File menu "Export" → "Export Annotated PDF…") not in main** — `src/electron-main.js:430` still reads `label: 'Export'`. The kal-51 commit (`1417e7c6`) lives only on the kal-51 branch.
- Native bake pipeline UI / Spaces PDF Pages "no annotations" claim was not exercised at the UI level because the export entry points are surfaced through the Electron app shell (not the browser dev server we audited). Tracked under **KAL-55**.

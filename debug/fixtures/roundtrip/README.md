# Round-trip fixtures (synthetic, made 2026-11-14)

Used to check what happens when a marked-up PDF leaves Survey or Drawboard,
is changed in Adobe Acrobat, and comes back.

- `plain-source.pdf`: 3 pages of made-up text (pdf-lib), no marks.
- `drawboard-marked.pdf`: `plain-source.pdf` opened in Drawboard PDF web with
  no account, 2 rectangles + 1 ellipse drawn, then "Download to device".
  Drawboard writes each mark's record id into `/NM`.
- `survey-marked.pdf`: `plain-source.pdf` exported by Survey's PDF writer
  (`savePDFWithAnnotationsPdfLib`) with 2 rectangles + 1 ellipse; `/NM` is the
  Survey mark id.

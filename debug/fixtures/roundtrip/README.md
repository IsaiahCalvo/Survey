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
- `drawboard-marked-acrobat-edited.pdf`, `survey-marked-acrobat-edited.pdf`:
  the two files above opened in real Adobe Acrobat on a Mac and changed there
  (one mark recoloured blue, the ellipse deleted, one mark moved 60 pt right
  and down, three new Acrobat marks: a rectangle, a sticky note, a text box),
  then saved. Acrobat saves incrementally (the old objects stay in the file),
  stamps `/M`, adds a `/Popup` to each touched mark and rounds `/Rect` to
  whole points. Used by `tests/pdfOutsideEdits.test.mjs`.

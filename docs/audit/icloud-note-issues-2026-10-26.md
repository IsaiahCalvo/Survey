Written: 2026-10-26 17:10

# Isaiah's issue note — "These are things that need to get fixed:" (2026-10-26)

Source: Isaiah's shared iCloud note, read from Notes on his Mac. The note's
two screenshots show ChatGPT's phone chat box: a mic and a voice button sit
inside the text field, and voice mode turns the field into a waveform bar with
cancel / stop / send. That is the reference for item 16.

Sort key — **S** = polish, ships to stable. **N** = new building, ships behind
the Nightly switch. **O** = owned by another thread. **Q** = needs Isaiah's
input or material before it can be finished.

| # | Sort | Area | Issue (Isaiah's words, condensed) | Batch |
|---|------|------|-----------------------------------|-------|
| 1 | N | Pinned tools | Pin tools don't work exactly like Walkthru: animation, mechanics, the magnet feel. | E |
| 2 | S | Rendering | Not all annotations show their stroke and colour. Polyline shows colour but not stroke width. Check every type. | A |
| 3 | N | Pinned tools | Pin icon on the pinned tools bar is ugly; use Lucide `pin`. | E |
| 4 | S | Text / callout | When a text box or callout is selected the sub-toolbar shows the regular options; the text-format button reveals the text options in place (not a row underneath). | B |
| 5 | S | Spaces | Region count inside each Space feels wrong; make it minimal (smaller, underneath) or drop it. | C |
| 6 | S | Spaces | Always show a grabber to rearrange. | C |
| 7 | S | Spaces | Regions always offer Edit region, plus move and copy to other Spaces. | C |
| 8 | Q | Spaces | Still not a fan of the Spaces UI overall (no specifics). | C |
| 9 | S | Spaces | Entering edit mode shifts region rows and text to the right. No shift at all. | C |
| 10 | S | App-wide | The Done icon (check in a circle) used everywhere: replace with Lucide `check-check` or the word Done. Not an X. | D |
| 11 | S | Pickers | Stroke width picker still not 100%. Line type picker and arrow-end pickers (both ends, head type) also need work. | B |
| 12 | N | Counters | Creating, renaming, deleting counters looks bolted on; the dropdown looks terrible. Need rename, continue, start new, drag to reorder; show and change each counter's colour (pin and text) in that list. (merges item 26) | E |
| 13 | S | Scale | Setting a page's scale looks ugly. | B |
| 14 | S | Press feel | Text A/A buttons and the eraser partial/whole toggle lack the press animation other buttons have. | D |
| 15 | N | Export | Export PDF as annotated, plain (no annotations), flattened, and other options. | F |
| 16 | N | Chat | Chat box: English only (drop Spanish); move hands-free / read-aloud into the text box beside tap-to-talk and attach, like the ChatGPT screenshots. | F |
| 17 | N+Q | Smart fill | Smart fill not working properly. Audit against every Schneider Electric drawing: fill every SE tag and every cloud type. Design a UI for users to define custom shapes to fill. Needs Isaiah's ChatGPT threads and smart-fill repo. | F |
| 18 | S/N | Grid / layers | Grid: let users change density and a custom scale (N). Layers are fine but replace the slider (S). | B |
| 19 | S | Selection | SE-011 Security Shop Drawing Rev 2: select-all + Cmd+X misses the purple pen stroke when the marquee goes left-to-right (works right-to-left). Find every annotation type affected, fix the class of bug, guard it with tests. | A |
| 20 | S | Viewer | Springback when zooming/scrolling past the PDF edges isn't great; copy Drawboard more closely. | G |
| 21 | N | Templates | Drag to reorder survey templates on the home Templates page. | H |
| 22 | S | Templates | Category edit mode adds a new row; show the icons in place like other edit modes (copy, delete, done swap in and out). | H |
| 23 | S | Templates | Can't move a category item to another category, only another module. Copy says "Select space" instead of the right word. Picker should go template → module → category. | H |
| 24 | — | (not Survey) | Personal aside about a KVM switch. Not app work; skipped. | — |
| 25 | S | Counters | Double-clicking a counter pin shows a rotation handle that doesn't rotate (typed rotation works). | A |
| 26 | N | Counters | Change colour in the counter dropdown; continue, rename, colour of text and pin. (merged into 12) | E |
| 27 | N | Polyline | Polyline can also be drawn as a spline; copy the freehand polyline tool from Isaiah's takeoff repo. | F |
| 28 | S | Survey Marker | Locate Survey Marker doesn't always center and zoom to its extents on the first click. | G |
| 29 | O | Templates | Checklist answers limited to 3; custom should be a modal; default answer sets (Yes, No, N/A, Small, Medium, Large, 1–5), editable; unlimited items; custom value fields with units; a library of data-tracking types; report export to CSV and more. **Owned by the custom-answers thread (PR #1189).** | — |
| 30 | S | Templates | Dragging modules horizontally stretches and squashes their text and tab (dnd-kit used wrong). | H |
| 31 | S | Documents | Select-mode options are huge; None nearly collides with Duplicate. One order app-wide: Select, None, Duplicate, Move, Copy, Share, Delete (skip missing ones, keep the order). | D |
| 32 | Q | — | "We want to pay a little bit more and make sure that it's a visual, particular message." Dictation unclear; no action until clarified. | — |
| 33 | S | Pickers | Stroke width pill in the dropdown cuts off its text; drop the stroke icon from the pill. | B |
| 34 | S/N | Survey panel | Module tabs overflow with many modules: show some, then a dropdown (S). Drag to reorder tabs, kept in sync with the home Templates page (N). | H |
| 35 | S | App-wide | Buttons sometimes get a white border (e.g. "camera" in the place-marker category picker; the selection button once). Find and kill it everywhere. | D |
| 36 | S | Survey mode | Remove Reuse. Default to the first category and an entity. Put the survey bar in one row: module dropdown, category, stroke picker, entities on the left. | I |
| 37 | S | Survey Marker | Replace the "New Survey Marker" text with a default name like "Camera 7" that is editable; Enter commits; on phone, tapping away commits. | I |
| 38 | S | Motion | Left and right rails must open smoothly (survey mode push/jump after closing the right rail), top bars slide smoothly, tab switching smooth. | G |
| 39 | S | Modals | Make every modal match. The "template changed — keep or use latest?" modal looks bad; audit all modals. | D |

## Batches

- **A — Annotation correctness (S):** 2, 19, 25
- **B — Pickers and sub-toolbars (S):** 4, 11, 13, 18 (slider), 33
- **C — Spaces panel (S):** 5, 6, 7, 9 (8 needs input)
- **D — App-wide consistency (S):** 10, 14, 31, 35, 39
- **E — Pinned tools + counters (N):** 1, 3, 12/26
- **F — New tools (N):** 15, 16, 17, 18 (grid density), 27
- **G — Viewer motion and navigation (S):** 20, 28, 38
- **H — Templates (S, with N reorder):** 21, 22, 23, 30, 34
- **I — Survey mode bar and naming (S):** 36, 37

## Overlap with other threads

- 29 → custom answers thread (PR #1189).
- 37 phone commit and phone layout bits of 36 → check with the mobile web thread before landing.

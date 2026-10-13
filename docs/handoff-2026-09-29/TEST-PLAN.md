Written: 2026-09-29 18:02

# Test plan (one step at a time)

Walk this top to bottom, one test at a time. Each test says what to do, what you
should see, and what would be wrong. Codes in brackets (H1, M5 ...) match
WHAT-WE-BUILT.md. Easy looks first; the riskiest parts (two windows, eraser,
undo, History) come last.

## How to run the app

1. Open Terminal in the main project folder and run `npm run dev:ui`.
2. Open http://localhost:5173 in a browser. You are signed in on your own (dev auto sign-in).
3. For phone tests, use your phone (`npm run mobile:phone` publishes the phone shell to Expo Go) or make the browser window phone-narrow.
4. For two-window tests, open the same document in two windows side by side (same account is fine).
5. Use a throwaway document for anything that deletes, erases or locks. Keep runs short; Supabase is on Pro but test traffic should stay small.

---

## Part 1 — Home screens

1. **[H5] Tabs line up (desktop).** Do: switch between Documents, Projects and Templates. See: the lists start at the same height on all three. Wrong: the list jumps up or down between tabs.
2. **[H2] Desktop sidebar lists.** Do: look at the Templates and Projects lists in the left sidebar. See: rows run edge to edge with thin lines, no box inside a box. Wrong: each row in its own card, or lines stop short of the edges.
3. **[H3] Phone title switcher.** Do: on the phone, tap the page title. See: a small dropdown listing the other sections; tapping one goes there. Wrong: nothing opens, or the old menu button is still there.
4. **[H1] Phone lists.** Do: scroll to the bottom of the phone Documents list. See: one panel, thin lines, a closing line under the last row, no empty strip under it. Wrong: cards per row, or a blank band at the end.
5. **[H4] Phone project and template pages.** Do: open a project, then a template, on the phone. See: one divided card each. Wrong: a stack of separate boxes.
6. **[H7] Phone module tabs.** Do: in a phone template, look at the module tabs and drag one to the far right. See: the "+" tab is still there; the dragged tab stops at the last tab. Wrong: "+" missing, or the tab slides past the end.
7. **[H6] Entity color panel.** Do: open a template, go to Entities, tap an entity's color. See: a panel drops down under its row and the grip turns into a down arrow. Then tap another entity's color. See: one smooth switch, no jump at the end. Wrong: the panel closes when you tap inside its own row, or it jumps.
8. **[H8] Thumbnails.** Do: open a document, draw a mark on page 1, wait 5 seconds, go back to Documents. See: its thumbnail shows page 1 with your mark. Wrong: blank placeholder, or the old picture without the mark.

## Part 2 — Look and feel

9. **[U1] No gold rings.** Do: click into any text field (like the search box), then into a text box on the page. See: a cursor, no gold ring or gold underline. Wrong: a gold outline appears.
10. **[U2] No grey squares.** Do: hover over and press icon-only buttons (a grip, a color dot, an X). See: the icon grows a little on hover, shrinks a little on press. Wrong: a grey box shows behind it.
11. **[U3] Popovers get out of the way.** Do: open the color picker, then click a different tool in the toolbar. See: the tool switches with that one click. Wrong: the first click only closes the picker.
12. **[U3] Page click only closes.** Do: open a dropdown, then click the bare page with the pen tool on. See: the dropdown closes and no mark is drawn. Wrong: a stroke or dot appears.
13. **[U3] Escape.** Do: open a dropdown and press Escape. See: only that dropdown closes. Wrong: other things close too.

## Part 3 — Color picker

14. **[C1] Swatches.** Do: open the color picker and hover over, then click, a swatch. See: it grows on hover; once picked it has a ring in its own color and a check. Wrong: a grey plate or no ring.
15. **[C2] Sliders.** Do: hover over the opacity slider, then drag it. See: a number shows on hover; the thumb follows smoothly; the picked mark changes live. Then press Cmd+Z once. See: the whole drag undoes in one step. Wrong: jerky thumb, or undo walks back many tiny steps.
16. **[C3] Fill first and Match fill.** Do: open the picker on a shape. See: Fill tab comes before Border. Switch between them. See: the first grid cell morphs smoothly between see-through and the three-line Match fill mark. Wrong: Border first, or a hard snap.
17. **[C4] Text color opacity.** Do: in a text box, open text color and lower its opacity. See: the text turns see-through. Wrong: no opacity control.
18. **[C5] Callout text color sticks.** Do: while typing in a callout, pick a new text color, keep typing, then click away. See: the color stays. Wrong: it goes back to the old color.

## Part 4 — Phone chrome

19. **[P1] Tool settings panel.** Do: on the phone, pick the pen and tap "..." at the end of its strip. See: the pen's settings panel as it used to be. Wrong: a row-list sheet, or no "...".
20. **[P2] Page above the dock.** Do: scroll to the end of a document on the phone. See: the last page ends above the bottom dock. Wrong: the page runs under the dock.
21. **[P3] Color sheet while typing.** Do: on the phone, type in a text box, then open the color sheet. See: the text box stays open; the tick and cross sit clear of the box. Wrong: the text box closes.

## Part 5 — Side panels

22. **[S1] Sidebar footer.** Do: look at the bottom of the desktop left sidebar. See: one row — active users left, sync status middle, History circle right. Wrong: two rows or uneven tabs.
23. **[S2] Bookmarks.** Do: open Bookmarks. See: one list with a quiet "+ Add" left and "Edit" right, no title. Wrong: separate cards per bookmark.
24. **[S3] Spaces.** Do: open Spaces. See: one list, regions indented under their space, fold arrow beside the grip, no "Spaces" title. Wrong: cards or a title bar.
25. **[S4] Survey panel.** Do: open the Survey panel on desktop, then on the phone. See: one divided list on both. Wrong: separate cards.
26. **[S5] Live search.** Do: open Search and type two or more letters of a word on the page. See: results appear as you type. Click one. See: the page jumps to it, zoomed in and centered, with the highlight on the real word. Wrong: nothing until Enter, or the highlight is off the word.
27. **[S5] Clear search.** Do: clear the search box. See: your zoom goes back to what it was before searching. Wrong: you stay zoomed in.

## Part 6 — Viewing the document

28. **[V1] Scroll out from under toolbars.** Do: pick the Text tool so its rows show, then scroll to the very top of page 1. See: the top of the page sits clear below the rows. Wrong: the rows cover the top of page 1.
29. **[V2] Panels do not move the page.** Do: open and close a side panel, and switch tools so rows appear and go. See: the page stays still. Do the same on the last page. Wrong: the page jumps.
30. **[V3] Right rail.** Do: type a page number in the right rail's page box, then a zoom in its zoom box, then press fit. See: each works; the page dot shows the right page. Wrong: wrong page, or fit is off.
31. **[V4] Big document opens fast.** Do: open "Package 2 - Rev 4 -- IC.pdf". See: marks show within about 2 seconds and the screen does not freeze. Wrong: a long grey cover or a stuck screen.
32. **[V5] Old pen strokes in place.** Do: open "Benjamin Franklin Elementary.pdf", page 1. See: red pen strokes where they were drawn. Wrong: strokes piled in the top-left corner.
33. **[Z1] PDF kept on this device.** Do: open a document, go back, open it again. See: it opens faster the second time. Wrong: it fails to open, or shows an old version of the file.

## Part 7 — Desktop tool bar

34. **[T3] Layout.** Do: look at the top bar. See: Undo/Redo far left; Pan and Select just left of Draw / Shapes / Text with a thin line between. Switch tools and pick marks. See: the group icons never move. Wrong: icons shift.
35. **[T2] Rows flipped.** Do: pick Shapes. See: the shape tools in the top bar and color/width in row 2 below. Pick a rectangle with Select. See: the shape tools come up. Wrong: formatting in the top bar.
36. **[T4] Select modes.** Do: pick Select. See: Box / Lasso / Text to the right of the group icons; with nothing picked, no row 2 for Box/Lasso. Wrong: modes in row 2, or an empty row 2.
37. **[T5] Morphing icons.** Do: switch Draw → Shapes → Text → Select. See: each shared icon morphs into the next. Wrong: icons blink or jump.
38. **[T6] Row motion.** Do: switch from Pen to Rectangle, then to Text. See: row 2 swaps with a small downward motion, no sideways slide; the Aa row drops down from under row 2. Wrong: rows slide sideways or flash.
39. **[T8] Rows centered.** Do: open a side panel and watch row 2. See: it stays centered on the page area beside the panel. Wrong: it sits under the panel.
40. **[T7] Aa.** Do: type in a text box and click Aa. See: the text bar toggles, your cursor stays in the text, the main bar does not move. Wrong: the text box closes or the bar shifts.
41. **[T1] Narrow window.** Do: make the window about 850 pixels wide. See: nothing in the tool bar overlaps; a dropdown opens right under its button. Wrong: overlapping buttons.

## Part 8 — Working with marks

42. **[M1] Restyle a pen stroke.** Do: draw a pen stroke, pick it with Select, change its color and width. See: it changes. Wrong: nothing happens.
43. **[M1] Restyle a group.** Do: pick a red rectangle and a blue ellipse together. See: color reads "Mixed". Pick green. See: both turn green; one Cmd+Z undoes both. Wrong: only one changes, or two undo steps.
44. **[M2] Text bar on a picked callout.** Do: pick a callout (do not type), change its text size in the text bar. See: the text changes. Wrong: nothing.
45. **[M3] Cloud border.** Do: pick a text box, set line style to Cloud. See: a cloud border around the box. Do the same on a callout. See: cloud box, straight leader. Wrong: no Cloud choice, or a clouded leader.
46. **[M4] New text box on one page.** Do: in a multi-page document start a new text box on page 2 and scroll. See: its border only on page 2. Wrong: borders on every page.
47. **[M5] Stacking order.** Do: place a callout over a rectangle, right-click the callout, Send back. See: it goes behind the rectangle. Reload. See: still behind. Wrong: callout stays on top, or it resets after reload.
48. **[M6] Arrow nudge.** Do: pick a mark and hold an arrow key for a second, then press Cmd+Z once. See: it moves smoothly, and one undo puts it all the way back. Wrong: undo moves it back one tiny step.
49. **[M13] Resize flips.** Do: drag a rectangle's right grabber past its left side. See: the shape flips and keeps growing the other way. Wrong: it stops or disappears.
50. **[M13] Tight grab areas.** Do: with a shape picked, start a box-select just outside its corner. See: a box-select starts. Wrong: the shape resizes.
51. **[M12] Cmd-drag.** Do: pick a small mark, hold Cmd, drag from anywhere inside its box. See: grabbers hide and it moves; it stays where you drop it. Wrong: it snaps back.
52. **[M8] Duplicate.** Do: pick a mark, press Cmd+D. See: a copy just down-right, picked. Wrong: nothing, or the original stays picked.
53. **[M14] Paste picks copies.** Do: copy a shape, paste, press an arrow key. See: only the copy moves. Wrong: the original moves.
54. **[M8] Mixed clipboard.** Do: pick a shape, a callout and a Survey Marker together, Cmd+C, Cmd+V. See: all three pasted together in the same layout; the Survey Marker copy is a new survey item. Wrong: something missing.
55. **[M7] Survey Markers join selections.** Do: with a survey module open, box-select over marks and a Survey Marker, then drag. See: they move together; one Cmd+Z puts them back. Wrong: the marker is left behind.
56. **[M11] Survey Marker cut and paste.** Do: pick a Survey Marker, Cmd+X. See: the Survey panel says "Not on page" for that item. Cmd+V. See: the same item back, answers intact. Wrong: the item vanishes from the panel or comes back blank.
57. **[M16] Copy survey items between spaces.** Do: copy survey items from one space to another. See: they copy. Wrong: the app crashes.
58. **[M10] Lock.** Do: right-click a mark you made, Lock. See: a lock badge, no grabbers; drag, delete and erase do nothing. Unlock. See: normal again. Wrong: the locked mark moves or deletes.

## Part 9 — Two windows (sync)

Open the same throwaway document in two windows side by side.

59. **[Y2] Live drawing.** Do: draw a slow pen stroke in window A. See: faint ghost ink follows in window B while you draw, and the real stroke lands right after. Wrong: B shows nothing until much later.
60. **[Y2] Live moves.** Do: drag a rectangle in A. See: it moves in B within a moment. Wrong: B only updates after reload.
61. **[Y1] Two edits to one mark.** Do: change a rectangle's color in A, and at about the same time move it in B. See: both windows end with the new color AND the new spot. Wrong: one change is lost.
62. **[Y3] Survey Markers live.** Do: move a Survey Marker in A. See: it moves in B within about half a second. Wrong: no change in B.
63. **[M15] Delete stays on your mark.** Do: in A pick rectangle 2; in B delete rectangle 1; back in A press Delete. See: only rectangle 2 goes. Wrong: a different rectangle is deleted.
64. **[M9] Open editing.** Do: sign in as a second test account in window B (or ask a helper) and move a mark you made. See: no pop-up, it just moves. Wrong: a block or confirm box.
65. **[M17] Menu on a selection.** Do: pick two marks, right-click one of them. See: the menu acts on both (Lock, Delete). Wrong: only the one under the mouse is affected.

## Part 10 — Eraser

66. **[E1] Erase over old erasing.** Do: on "Package 2" page 1 (or a copy), erase across a stroke that was erased before. See: clean edges, old erased parts stay gone. Wrong: old dabs reappear, thin slivers or missing blocks.
67. **[E2] Tight curves.** Do: draw a tight scribble, erase across it. See: the rest of the scribble keeps its round tips; the app stays responsive. Wrong: a freeze or chunks missing.
68. **[E3] Big ink.** Do: erase across a big imported drawing. See: quick and exact. Wrong: a long pause or wrong pieces removed. (Known: a long perfectly straight diagonal wipe can leave small islands.)

## Part 11 — Undo and Redo

69. **[R1] One timeline.** Do: draw A, undo it, then draw B. See: Redo is greyed out. Wrong: Redo brings A back on top of B.
70. **[R1] Callout create and type.** Do: make a callout, type text, click away, press Cmd+Z once. See: the whole callout goes in one step. Wrong: it takes two presses.
71. **[R2] Undo keeps a colleague's edit.** Do: in A change a mark's color; in B move the same mark; in A press Cmd+Z. See: the color goes back, the new spot stays. Wrong: the mark jumps back too.
72. **[R3] Imported PDF markup.** Do: open a PDF that came with its own markup, draw one stroke, Cmd+Z. See: only your stroke goes. Wrong: the PDF's own markup changes or disappears.

## Part 12 — History (riskiest last)

73. **[HI2] Feed.** Do: open History (circle in the sidebar footer). See: activity grouped by day, repeat edits folded, filters Everyone / Only me / Deleted and a search box. Wrong: raw ids or one line per tiny edit.
74. **[HI2] Jump to a mark.** Do: click a line. See: the page jumps and zooms to that mark, which glows blue and fades. Wrong: nothing happens or the wrong mark lights up.
75. **[HI2] Before/After and ghost.** Do: delete a mark, then click its "deleted" line. See: a ghost of the mark on the page with Restore. Press Restore. See: the mark comes back once. Wrong: two copies, or Restore on a line that is not a delete.
76. **[HI1] Restore does not overwrite.** Do: restore a mark, then press Restore on the same line again (if still shown). See: nothing changes; no duplicate. Wrong: a second copy or an overwrite.
77. **[HI1] Load older.** Do: scroll to the bottom of History and press Load older. See: older days appear with no repeats. Wrong: repeats or gaps.
78. **[HI3] Pick a mark.** Do: with History open, click a mark on the page. See: "Showing history for this ... · Clear" and only that mark's lines. Press Escape. See: full list again. Wrong: the list does not narrow.
79. **[HI2] Phone History.** Do: open History on the phone and tap a mark on the page. See: same feed; the tap picks the mark (the sheet does not dim the page). Wrong: the tap closes the sheet.
80. **[HI4] History clean-up.** Open History with a few changes made (add a shape, move it, recolor it, delete another). Look for: new = blue dot, edited = green dot, deleted = red dot, restored = teal dot, with a small key under the filters. Click a row: the mark gets a soft blue wash and one thin outline fully around it (no pulsing, no drawing-on). A deleted mark shows a faint dashed ghost with one small Restore in its corner (no black pill). Wrong if: the outline stops short of the mark, or anything pulses or floats. Known choices to judge: cutting a Survey Marker shows green (edit); undo/redo rows have a grey dot.

---

## Things I already know are unfinished

- Locks are enforced by the app only, not the server; an old or altered app could still edit a locked mark.
- The server rule for Survey Marker editing and locks (w54) is written but not applied, so there is a raw-write gap.
- Thumbnails (and the canvas painter) do not draw Survey Markers.
- The single "mark type" list for all drawing paths is a plan, not built.
- Excel write-back is off.
- Group resize and rotate stay hidden.
- Survey Markers plus callouts only (no other marks) move as two undo steps.
- Moving a Survey Marker makes a linked Excel sheet read "not synced".
- Duplicate across two pages is one undo step per page.
- Counter tool right-click drops a pin.
- Callout rotation is not built.
- A long straight diagonal erase can leave small islands of ink.
- Shared thumbnails across devices need a database change that is not applied.
- The 30-day trash sweep stays off.

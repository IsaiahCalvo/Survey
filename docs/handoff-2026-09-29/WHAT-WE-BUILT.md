Written: 2026-09-29 17:58

# What we built (local main, not yet on GitHub)

Everything here sits on your Mac's copy of the app and has not been pushed yet.
It covers work from 2026-09-23 to 2026-09-29. There are 72 items, grouped by the
part of the app you would look at.

How to read the status line:

- **Seen working by a helper** — a helper ran the real app in a test browser and saw it work.
- **Built, not yet seen in the app** — it passed the automatic checks and reviews, but nobody has watched it work in the app yet. These need your eyes most.
- **Landing separately** — (none now; the History clean-up has landed).

Test steps for every item are in TEST-PLAN.md (same folder). The item codes (H1, C2, ...) match.

---

## Home screens (Documents, Projects, Templates)

**H1. Phone lists are one clean panel.** Each list on the phone is a single panel with thin lines between rows, a closing line under the last row, and no empty strip below it. Where: phone, Documents / Projects / Templates. Status: built, not yet seen in the app.

**H2. Desktop sidebar lists match.** The Templates and Projects lists on the desktop sidebar use the same panel look: rows run edge to edge with thin lines, no box inside a box. Where: desktop left sidebar on the home screens. Status: built, not yet seen in the app.

**H3. Phone title switches sections.** On the phone, the page title (Documents / Projects / Templates / Archive) has a small arrow; tap it to jump to another section. The old menu button and floating card are gone. Where: phone home screens. Status: built, not yet seen in the app.

**H4. Phone project and template pages are one card.** Inside a project, and inside a template, the phone shows one divided card instead of many boxes. Where: phone, open a project or a template. Status: built, not yet seen in the app.

**H5. All three tabs line up.** Documents, Projects and Templates start their lists at the same height on the desktop. Where: desktop home screens, switch tabs. Status: built, measured by a helper.

**H6. Template entity colors.** In a template's Entities list, the color panel drops down under its row; the grip turns into a down arrow while it is open; switching from one entity's panel to another is one smooth motion with no jump at the end; tapping inside the open row no longer closes it; the phone Entities sheet is slimmer; dragging an entity stops at the bottom. Where: Templates, open a template, Entities. Status: built; the jump fix was measured frame by frame by a helper.

**H7. Phone module tabs.** In a phone template, the module tabs keep their "+" tab and you can no longer drag a tab past the last one. Where: phone, a template's module tabs. Status: built, not yet seen in the app.

**H8. Document thumbnails stay current.** Thumbnails now show page 1 with your markup, update a few seconds after you edit page 1, and fill in quietly for documents that had none (only while you are idle on the list). Where: Documents list. Status: built, not yet seen in the app. Gaps: thumbnails do not draw Survey Markers yet; thumbnails are stored per device (sharing them across devices is a proposed database change, not applied).

## Look and feel across the app

**U1. No gold rings on text fields.** Clicking into a text field or the canvas text editor no longer draws a gold ring. The first click away from a field only leaves the field. Where: any text field, and typing in a text box on the page. Status: built, checked in a test browser by a helper.

**U2. No grey squares on icon buttons.** Buttons that are only an icon or a color dot no longer show a grey box when you hover or press; the icon grows a little on hover and shrinks a little on press. Where: everywhere (grips, color dots, X buttons, phone bars). Status: built; a helper audited this across the app in a test browser.

**U3. Popovers get out of your way (dismiss rules).** With a dropdown or the color picker open, clicking another button does that thing right away instead of just closing the popover. Clicking the bare page only closes the popover (it will not draw a mark). Escape closes only the top popover. Only one popover is open at a time. Where: toolbar dropdowns and the color picker. Status: built, not yet seen in the app.

## Color picker

**C1. Swatches behave like HeroUI.** Every color swatch grows on hover; the chosen one gets a ring in its own color and a check. Where: color picker, toolbar quick-color dots. Status: built, not yet seen in the app.

**C2. New sliders.** Hue and opacity sliders have a round track, a thumb in the live color and a number that shows on hover. Drags are smooth, and one drag is one undo step. Where: color picker. Status: built; the "undo never touches a colleague's work" part was checked with two live sessions.

**C3. Slimmer picker, Fill first, Match fill mark.** The desktop picker is slimmer with the same colors. Fill comes before Border everywhere. The first grid cell morphs between "see-through" and a "Match fill" mark (three plain lines) when you switch tabs. Where: color picker on the desktop. Status: built, not yet seen in the app.

**C4. Text color can be see-through.** Text color now has an opacity slider. Where: text bar color, desktop and phone. Status: built, not yet seen in the app.

**C5. Callout text color sticks.** A text color or style you pick while typing in a callout stays when you finish typing. Where: callout text. Status: built, not yet seen in the app.

## Phone chrome

**P1. Per-tool settings panels are back.** Every phone tool strip ends in "...", which opens that tool's settings panel as it was before. With a mark picked, "..." edits that mark. The color circle still opens the new picker. Where: phone, any tool. Status: built, not yet seen in the app.

**P2. Page stops above the bottom dock.** The page area on the phone no longer runs under the bottom dock. Where: phone, open a document. Status: built, not yet seen in the app.

**P3. Phone color sheet keeps the text box open.** Opening the color sheet while typing no longer closes the text box, and the tick/cross buttons stay clear of the box and under any panel. Where: phone, typing in a text box. Status: built, not yet seen in the app.

## Side panels (desktop left sidebar and phone sheets)

**S1. Sidebar footer is one row.** Active users on the left, sync status in the middle, History as a small circle on the right. The four panel tabs sit evenly. Where: desktop left sidebar, bottom. Status: built, not yet seen in the app.

**S2. Bookmarks are one list.** One integrated list with a quiet Add / Edit header. Where: Bookmarks panel, desktop and phone. Status: built, spacing measured by a helper.

**S3. Spaces are one list.** No cards, no title; regions sit indented under their space; the fold arrow is back beside the grip. Where: Spaces panel. Status: built, not yet seen in the app.

**S4. Survey panel is one list.** Desktop and phone Survey panels are one divided list; the survey sub-row matches the rest of the chrome. Where: Survey panel. Status: built, not yet seen in the app.

**S5. Search shows results as you type.** Results appear after two letters. Clicking one jumps to it, zoomed in and centered. On the phone the sheet closes and remembers your search. Clearing the search puts your zoom back. Match highlights now sit on the real words. Where: Search panel. Status: built, not yet seen in the app.

## Viewing the document

**V1. Scroll the page out from under the toolbars.** Toolbars that drop over the page no longer hide the top of page 1: you can scroll it clear. Where: any document, with a tool's settings row open. Status: built, measured by a helper.

**V2. Panels do not move the page.** Opening or closing side panels or tool rows leaves the page where it is, including at the end of a document; "fit" uses the space between the panels. Where: any document. Status: built, checked live by a helper.

**V3. Right rail works.** The page number box, zoom box, fit buttons and the page dot on the right rail are fixed. Where: right rail of the viewer. Status: built, not yet seen in the app.

**V4. Big documents open fast.** A large document (about 3,000 marks) shows its marks in 1 to 2 seconds instead of 6 to 10, and opening no longer freezes the screen. Where: open your biggest document ("Package 2 - Rev 4"). Status: built, measured by a helper.

**V5. Old pen strokes are back in place.** Old red pen strokes that showed piled in the top-left corner (for example in "Benjamin Franklin Elementary.pdf") draw where they were made. Where: that document, page 1. Status: built, not yet seen in the app.

## Desktop tool bar

**T1. Narrow windows.** On a narrow window the tool bar never overlaps itself, and dropdowns open right under their button. Where: make the window narrow. Status: built, not yet seen in the app.

**T2. Rows flipped.** The top bar holds each group's tools; row 2 below holds formatting (color, width and so on). Picking a mark brings up its group's tools. Desktop only. Where: top tool bar. Status: built, not yet seen in the app.

**T3. Fixed layout.** Undo/Redo sit far left. Pan and Select sit just left of Draw / Shapes / Text with a thin line between. The group icons stay centered and never move when you switch tool or pick a mark. Where: top tool bar. Status: built; a helper's live check ran at several window widths.

**T4. Select modes in the top bar.** Box / Lasso / Text select modes sit to the right of the group icons like other tools. Row 2 only shows settings that apply (hidden for Box/Lasso with nothing picked). Where: Select tool. Status: built, not yet seen in the app.

**T5. Morphing icons.** Switching Draw / Shapes / Text / Select morphs each shared tool slot's icon into the next (pen to rectangle to text box to Box) in about a fifth of a second. Where: top tool bar. Status: built, not yet seen in the app.

**T6. Row motion.** When row 2's set of settings changes, the old row sinks as it fades and the new one drops into place. Row 2 appears by dropping down from under the tool bar; row 3 (Aa text bar) drops down from under row 2. No sideways sliding. Where: switch between tools. Status: built, not yet seen in the app.

**T7. Aa only toggles the text bar.** Clicking Aa while typing keeps your cursor in the text and the main bar does not shift. Where: typing in a text box, click Aa. Status: built; a helper's live check passed at two widths.

**T8. Rows centered on the page area.** Row 2 and row 3 are centered on the space between the side rails (or beside an open side panel). Undo/Redo and Export stay pinned. Where: top tool bar with and without a side panel open. Status: built, not yet seen in the app.

## Working with marks

**M1. Restyle picked marks.** Picking a pen stroke and changing color, width or line style now works. Picking several marks shows their shared values ("Mixed" where they differ), and a change applies to all of them as one undo step. Where: Select, pick marks, change color/width. Status: built, not yet seen in the app.

**M2. Text bar formats a picked text box or callout.** With a callout or text box picked (not typing), the text bar changes its text. Only what you change is written. Where: pick a callout, use the text bar. Status: built, seen working by a helper.

**M3. Cloud border for text boxes and callouts.** Line style "Cloud" now works on text boxes and callouts (the box gets a cloud border; the callout's leader stays straight). Prints and exports the same. Where: text box or callout, line style. Status: built, not yet seen in the app.

**M4. New text box preview on one page only.** While typing a new text box, its border no longer shows on every page. Where: any multi-page document. Status: built, not yet seen in the app.

**M5. Stacking order for every mark, callouts included.** Bring forward / Send back works on every mark type including callouts (right-click menu and Cmd+] / Cmd+[), keeps after a reload, and is one undo step. Where: right-click a mark. Status: built, not yet seen in the app.

**M6. Arrow-key nudge for every mark.** Arrow keys move any picked mark by 1 (Shift: 10). Holding a key is one save and one undo step, not one per press. Where: pick a mark, press arrows. Status: built, measured live by a helper.

**M7. Survey Markers act like other marks.** Survey Markers can be picked with box or lasso along with other marks, moved together, nudged, stacked, and get the normal right-click menu. Where: a document with a survey module open. Status: built, seen working by a helper.

**M8. One clipboard and Duplicate.** Copy / Cut / Paste work on any mix of marks, callouts and Survey Markers. Cmd+D (and a Duplicate menu item) makes a copy just down-right. A copied Survey Marker becomes a new survey item. Where: pick several marks, Cmd+C then Cmd+V. Status: built, seen working by a helper.

**M9. Open editing.** Anyone who can edit a document can move, restyle, cut or delete anyone's marks with no pop-up and no block. Undo covers your own edits on anyone's marks. Where: a shared document. Status: built, checked with two real test accounts by a helper.

**M10. Lock and Unlock.** Right-click Lock on any mark or selection (for its author or the document owner). A locked mark shows a lock badge and cannot be moved, resized, restyled, cut, deleted or erased by anyone until unlocked. Where: right-click a mark. Status: built, checked with two test accounts. Gap: the lock is only enforced by the app, not by the server (see known gaps).

**M11. Survey Marker Cut = pick it up.** Cutting a Survey Marker keeps its survey item, Excel row and answers; the panel says "Not on page". Paste puts the same item back. Where: Survey Marker, Cmd+X then Cmd+V. Status: built, not yet seen in the app.

**M12. Hold Cmd (Mac) / Ctrl (Windows) to move.** With a selection, hold Cmd and drag anywhere inside its box to move it; the resize grabbers hide while the key is down. A Cmd-drag no longer snaps back. Where: pick a mark, hold Cmd, drag. Status: built; a helper's live check covered the snap-back.

**M13. Resize flips through.** Dragging a grabber past the other side flips the mark instead of stopping; nothing gets thinner than a small minimum. Grab areas for the mouse are tighter, so a box-select started next to a picked mark no longer resizes it. Where: resize any shape. Status: built, not yet seen in the app.

**M14. Paste picks the copies.** After a paste, the pasted copies are selected (so arrow keys move the copies, not the originals). Where: copy and paste a shape. Status: built, not yet seen in the app.

**M15. Delete never hits the wrong mark.** If someone else (or another tab) adds or deletes a mark while you have one picked, your selection stays on your mark instead of sliding to its neighbor. Where: two tabs on one document. Status: built, reproduced and fixed live by a helper.

**M16. Copying survey items between spaces no longer crashes.** Where: Survey panel, copy items to another space. Status: built, not yet seen in the app.

**M17. Two-user fixes.** A counter records who placed it (so they can lock it); right-clicking inside a multi-selection acts on the whole selection; a pasted mark belongs to whoever pasted it. Where: shared document. Status: built, checked with two test accounts.

## Eraser

**E1. Erased bits stay erased.** Erasing a stroke that was erased before (or by another session) no longer paints old dabs back or leaves thin slivers and missing blocks. Where: your "Package 2" page 1, erase over old erasing. Status: built, proven on your stored strokes by automatic checks; not yet seen in the app.

**E2. Tight curves and no freeze.** The eraser keeps the tips of tight pen curves, and one erase can no longer freeze the app. Where: erase through a tight scribble. Status: built, not yet seen in the app.

**E3. Faster and more exact on big marks.** Erasing huge or very detailed ink is more exact and quicker. Where: erase on a big imported drawing. Status: built, not yet seen in the app. Known open: erasing along a long, perfectly straight diagonal can still leave small islands of ink.

## Sync between screens

**Y1. Two people, one mark.** Each mark is now saved field by field, so if one person changes a mark's color while another moves it, both changes survive. Where: two windows, same mark. Status: built, not yet seen in the app by you.

**Y2. Live drawing and edits.** A stroke shows on another screen in about a tenth of a second; a pen stroke streams as faint "ghost ink" while it is being drawn; moves and restyles show live. Where: two windows side by side. Status: built, measured by helpers.

**Y3. Survey Markers and space outlines go live.** Moving a Survey Marker or changing a space's outline shows on the other screen within about half a second. Where: two windows with a survey module open. Status: built, measured by a helper.

**Y4. Nothing lost on odd pages or old marks.** Markup on a page the PDF reader cannot open is kept; marks drawn on older builds show again; a document's own PDF annotations are brought in once. Where: older documents. Status: built, not yet seen in the app.

**Y5. Leaner saving.** Fewer and smaller save points, so the store stays small and big documents stay quick. Where: nothing to see directly. Status: built, measured by a helper.

## Data use and Supabase

**Z1. PDFs are kept on this device.** Reopening an unchanged document downloads no PDF data (the server still checks you may open it). Signing out empties the copy. Where: open, close, reopen a document. Status: built, measured by a helper.

**Z2. No background downloads nobody is looking at.** The Documents list stops filling thumbnails while a document is open; hidden tabs stop polling. Where: nothing to see directly. Status: built, measured by a helper.

**Z3. Supabase housekeeping (done, nothing to test).** You upgraded to the Pro plan on 2026-09-25. Old unused tables were cleaned up (database 318 MB down to 107 MB, backed up to your Mac first), 61 unused PDFs (380 MB) were backed up and removed, the live-drawing channel's access rules are in place, and two nightly clean-up jobs trim old save rows and keep History to 60 days. Status: applied on the live database.

## Undo and Redo

**R1. One timeline.** A new action clears Redo everywhere; dead steps are skipped in the same press; creating a callout and typing in it is one step; Cmd+Z only acts on the document you are looking at. Where: any document. Status: built, not yet seen in the app.

**R2. Undo only puts back what you changed.** Undo and Redo write back only the fields your action changed, so a colleague's later edit to the same mark survives. A drag's undo step holds only that drag. Where: two windows. Status: built, not yet seen in the app.

**R3. Opening a PDF with its own annotations no longer lands in your next undo.** Where: open a PDF that came with markup, draw, then undo. Status: built, not yet seen in the app.

## History panel

**HI1. Restore is safe.** Restore never overwrites a mark or Survey Marker that is already back; undo rows no longer look deleted; viewers never see Restore; "Load older" pages back through time. Where: History panel. Status: built, not yet seen in the app.

**HI2. New History feed ("option A").** Activity grouped by day with repeat edits folded together; filters Everyone / Only me / Deleted plus search; clicking a line jumps and zooms to the mark with a blue highlight; Before / After peek; a deleted mark shows as a ghost on the page with Restore; lines for partial erases and color changes. Works on the phone sheet too. Where: History (circle in the sidebar footer). Status: built, not yet seen in the app.

**HI3. Pick a mark to see its history.** With History open, picking a mark on the page narrows the list to that mark ("Showing history for this ... · Clear"). Clear, Escape or picking nothing ends it. Where: History open, click a mark. Status: built, not yet seen in the app.

**HI4. History clean-up.** History rows have status dots (new blue, edited green, deleted red, restored teal) with a small key; the page highlight is a soft wash plus one thin outline that fully covers the mark (no pulsing); deleted marks show a faint ghost with one small Restore; rows are one sentence with details only on the selected row. Status: built, and a helper saw it work in the app on desktop and phone.

---

## Known gaps (from the docs)

- **Lock is app-only.** The server does not enforce locks on regular marks; a changed or old app could still edit a locked mark. Enforcing it needs a server check on every save (your decision). The Survey Marker server rule is written but not applied.
- **"Raw write" gap from open editing (w54).** The server rule that would let every editor change Survey Marker rows and protect locked ones is proposed, not applied.
- **Thumbnails and the canvas painter skip Survey Markers.**
- **One shared "mark type" list for all drawing paths** is a plan only (it would stop a mark type from going missing in print or export).
- **Excel write-back is off.**
- **Group resize and rotate** stay hidden for every type.
- **A selection of Survey Markers plus callouts only** (no other marks) moves as two undo steps.
- **Moving a Survey Marker** makes a linked Excel sheet read "not synced".
- **Duplicate across two pages** is one undo step per page.
- **Counter tool right-click** drops a pin (needs your go-ahead to fix).
- **Callout rotation** is not built.
- **Straight diagonal erase** can leave small islands of ink.
- **Shared thumbnails across devices** need a database change that is proposed, not applied.
- **30-day trash sweep** stays off.

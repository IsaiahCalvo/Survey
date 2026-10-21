Written: 2026-10-13

# Gesture contract — what a press, drag, pinch or hold does on the page

Linear KAL-463 ("one touch gesture contract across mobile annotation tools")
and the Drawboard interaction audit of 2026-10-13 (items C1-C6). One rule set
for every tool and every input: mouse, trackpad, pen (Apple Pencil, Surface,
Wacom) and finger, on desktop, tablet and phone. Keep this page, the code
named under each rule and the tests at the bottom in step — the same way
`docs/DISMISS-RULES.md` works for popovers.

Words used here:

- **Tool** — the armed tool: Pan, Select (Box / Lasso / Text), Pen,
  Highlighter, Eraser, the shapes, Text, Callout, Counter, Survey marker, the
  region tools.
- **Page** — a PDF page. **Grey margin** — the empty area around and between
  pages.
- **Navigate** — move or zoom the view: pan (with flick and edge spring) or
  pinch. Navigating never changes the armed tool.

## How one press is decided (the order)

Every press goes through these steps in this order. The first step that
claims the press owns it until every pointer lifts.

1. **Open popover / typing** (`docs/DISMISS-RULES.md` R2/R3). With a light
   popover open, a press on the bare page only closes it; while typing, the
   first press outside only ends the typing.
2. **Selection grab.** A press on the selected mark or one of its handles
   moves / resizes / rotates it (`hooks/useSelectionGrabHandoff.js`), never
   pans the page under it. *Pencil-only mode: a finger is not allowed to grab
   (rule P2).*
3. **Navigation presses** — always navigate, whatever the tool:
   two or more fingers (T1), the middle mouse button (M1), a press in the
   grey margin (G1), Space held (K1), the Pan tool, and a finger in
   Pencil-only mode (P2).
4. **The tool**, if this pointer type may use it (P1). Ink draws from the
   first pixel; shapes need a short drag first (D2); a click / tap selects or
   does nothing.
5. **Nothing.** A press the tool refuses does nothing; it never becomes a
   different tool's action.

## Rules

### Who may use the tool

**P1 The pointer type decides who may use the tool — never which tool.**
Mouse and pen always may. A finger may in "Pencil or Touch" mode (the
starting mode, P4) and may not in "Pencil only" mode. (`utils/pencilMode.js`
`pointerMayUseTool`.)

**P2 Pencil only: a finger always navigates.** One finger pans (flick and
edge spring as the Pan tool), two fingers pan and pinch, a finger tap on the
page does nothing (no select, no dot, no marker, no menu from a tap). This
holds for every tool, including Select and Text Select — only the pen draws,
creates or selects. Controls on or over the page (the mini toolbar, buttons,
form fields, links, the text editor) still work with a finger. Built as a
window/capture pointer gate in `utils/pencilMode.js` that keeps finger
pointer events from every tool layer, plus the touch routing in
`PdfjsViewerContainer.jsx` (`resolveTouchStartRoute`, `fingerActsAsPan`).

**P3 Pencil only: a finger resting while the pen writes is ignored.** It does
not pan, pinch or mark, and the stroke is kept. A finger that was panning
when the pen lands stops where it is (no glide) and is set aside until it
lifts. A pen landing next to a resting finger still draws.

**P4 The first pen switches to Pencil only.** Every device starts in
"Pencil or Touch", so pen-less tablets, touch laptops and phones keep finger
drawing. The first `pointerType: 'pen'` press on the device reveals the
control (localStorage `surveyPenSeen`) and, when it lands on the page, also
switches to "Pencil only" (Drawboard behaviour: from then on a finger
navigates, the pen draws). That press still draws its own mark. The switch
is remembered per device in the same key as the setting (`surveyDrawMode`),
and it never overrides a mode already stored there (a hand-made choice);
later pens never switch again, so a manual switch back to "Pencil or Touch"
sticks. Storage blocked = defaults, the in-memory switch still works.

**P5 Where the control is.** Drawboard keeps it in its bottom utility bar,
beside the page controls. Survey's equivalent spot is the utility end of each
rail: the foot of the desktop right rail (below zoom / page / fit) and the
foot of the phone tool rail (above More). One icon button (a pointing finger
= Pencil or Touch, a pencil = Pencil only) opening the same two-row menu
"Annotate with Pencil or Touch" / "Annotate with Pencil only", a check on the
chosen row. `components/PencilModeControl.jsx`.

**P6 Pencil or Touch (the starting mode until a pen is used, P4).** One
finger runs the tool, exactly like a pen.

### Navigating without changing the tool

**G1 A drag that starts in the grey margin pans with any tool** — mouse, pen
or finger, momentum and edge spring included. The margin is the scroller or
the page-list node itself: never a page, a mark, a handle, a scrollbar, a
rail or a popover. Right-click there still opens its menu. Desktop:
`PdfjsViewerContainer.jsx` `isGutterPress` + `resolveViewerPressRoute`;
phone: the gutter test in `onTouchStart`. The margin shows the grab cursor.

**M1 Middle mouse button drag pans** from anywhere in the viewer (page,
mark, the selected mark, link or margin), with momentum, and never draws,
selects or switches the tool. A text field being typed in keeps the middle
button (paste on Linux). The browser's autoscroll circle and middle-click link opening are
switched off inside the viewer (`mousedown` / `auxclick`).
Better than Drawboard, whose middle drag inks with the Pen.

**K1 Space** (desktop). Held: a temporary Pan while held; the tool returns on
release. Tapped (under 333 ms, no drag): toggles Pan and the previous tool,
like Drawboard's "Swap to pan / previous tool". *(Tap-toggle: dbInputA's
part of this round.)* `M` arms Pan; Escape with nothing selected returns to
Pan.

**K2 Wheel and trackpad.** Plain wheel scrolls 1:1; Ctrl/Cmd + wheel and
trackpad pinch zoom about the cursor (eased, symmetric steps). Edges give
with a rubber band and spring back (`utils/elasticEdges.js`).

**P7 Pan pans - and selects text after a rest** (owner 2026-10-14, Drawboard
parity; this replaces the 2026-10-13 "Pan never selects text", which misread
the owner). With Pan the page shows the grab hand and a press-drag pans, also
when it starts on an unselected mark. Over a mark Pan shows the blue hover
halo (still the grab hand, no pointer hand); a click picks the mark and stays
Pan (`utils/selectModes.js`). Over PDF text, a mouse or pen that RESTS 200 ms
turns the cursor into an I-beam; a press-drag then selects text, a double-click
picks a word, a triple-click a line, and the text quick menu (Highlight,
Underline, Squiggle, Strike, Copy) shows, as under Text Select. A drag that
starts on text before the rest, or anywhere off the text, pans as before. A
click on blank page clears the selection; Escape closes the menu first. Space
held is a pure pan (never text). A finger always pans (no hover), so on a
phone or a finger-only iPad Pan does not even mount the text layer; an iPad
with a trackpad or a touch laptop's mouse gets the rest-to-select rule. Form
fields and the text editor keep their own caret.
(`utils/panTextSelect.js` - the pure rule; `PdfjsViewerContainer.jsx` - the
rest timer, the `data-pan-text` state and the pan press yielding to text;
`PdfjsTextLayer.jsx` - the `is-pan-text` layer; `PDFViewer.jsx` - mounts it
where a pointer can hover and feeds the quick menu; the hover halo effect
includes Pan.)

### Two fingers and more

**T1 Two or more fingers always navigate** — pan and pinch together, glued to
the fingers (the page point under the fingers stays under them), whatever
the tool. (A pen contact is never a finger, in either mode: a finger landing
while the pen writes is set aside as in P3, so a stroke never turns into a pan.)

**T2 A second finger mid-gesture cancels the one-finger gesture — it is
never committed.** A stroke, a shape draft, a marquee, a lasso, an eraser
pass, a region draw, a move or a resize in progress is dropped and the
gesture becomes a pan/pinch (`survey-pdfjs-pinch-start` event, listened to by
the SVG layer, the selection interaction and the region tool). **Pinch never
leaves a partial mark.**

**T3 Flick.** Let go while moving and the page glides on one curve for finger
and mouse (`utils/panMomentum.js`); a finger that rests before lifting does
not glide. A glide is caught by any new press.

### Taps, drags and holds

**D1 Click vs drag.** A press that moves no more than 4 px (mouse / pen) or
8 px (finger) is a click / tap: it selects or does nothing
(`utils/moveCommit.js`). A tap on a live form field or link is the control's;
a drag that starts there pans (8 px slop).

**D2 Shapes need a real drag.** Rectangle, ellipse, line, arrow, cloud,
callout and the region tools create a shape only after the pointer has moved
more than 6 px (mouse / pen) or 10 px (finger); less is a click (select the
mark under it, or nothing). Ink (Pen, Highlighter) has no threshold: a tap
leaves a dot. *(Thresholds: dbInputA's part of this round.)*

**D3 Palm.** A touch whose contact is larger than about 120 CSS px (pointer
`width`/`height` or touch `radiusX`/`radiusY`) is never a tool press: no ink,
no shape. *(dbInputA's part of this round.)*

**L1 Long press** (every touch screen — phone, iPad, Android tablet, touch
laptop — in either layout; Pan and Select tools only): a finger or a pen
held still 380 ms opens the context menu for what is under it (page, mark,
region), the same menu a right-click opens. Moving more than 10 px first, a
second finger, or lifting cancels it, so **a long press never fires while a
pan, a pinch, a drag or a stroke is under way.** With a drawing tool a held
finger or pen is part of the stroke, never a menu. A press on a resize /
rotate handle or its hit pad never arms it, nor does a palm (D3) or a mouse
(it has the right button).
*Pencil only:* a finger always navigates (P2), so a finger's long press
opens nothing; the pen's long press still opens the menu (only the pen
selects). *Pencil or Touch:* finger and pen alike.
*Rows:* a menu opened by a finger or a pen has rows at least 44 px tall (the
phone's menus always do); a mouse right-click keeps the compact desktop
rows. Drawboard opens the same menu after 666 ms with zero slop — we keep
380 ms / 10 px because a fingertip always wobbles a little.
(`utils/touchLongPress.js`; the effect in `PdfjsViewerContainer.jsx`; the
rows in `hooks/useAnnotationContextMenu.jsx` + `styles/touchTargets.css`.)

**L2 Double tap / double click** on a text mark opens its editor; on the bare
page it does nothing (no zoom).

### System edges (phone)

**E1** The iOS app's WebView keeps the system back-swipe from the left screen
edge; the phone tool rail sits on that edge, so the swipe starts on the rail,
not on the page. The home indicator area at the bottom belongs to the dock.
The page never claims a gesture that starts outside the viewer.

## Tests

- `tests/pencilMode.test.mjs` — P1-P6, G1, M1 routing, the remembered
  setting, the finger gate (what reaches a tool layer and what does not).
- `debug/scenarios/gesture-contract.spec.mjs` — Playwright, real flows at
  1440x900 (mouse, middle button, pen), 1024x1366 tablet (pen + touch) and
  390x844 phone (touch): per tool (Pen, Highlighter, Rectangle, Survey
  marker, Select) — margin drag pans and adds nothing; middle drag pans and
  keeps the tool; Pencil-only finger pans and adds nothing while the pen
  draws; pinch never leaves a partial mark; long press never fires mid-drag;
  Pan pans from text at once and selects it only after a 200 ms rest (I-beam,
  quick menu), shows the hover halo and keeps the grab hand; blank page pans;
  a phone finger pans; Text Select still selects. Each tool first proves it is armed (one finger
  makes a mark) so a "nothing was added" result means something.
- `tests/selectModes.test.mjs` — Pan shows the hover halo, no pointer hand (P7).
- `tests/panTextSelect.test.mjs` — P7 Pan over text: the rest, who may select,
  Space / finger / middle button pan, and the wiring.
- `tests/touchLongPress.test.mjs` — L1: the timer and slop, who may arm it
  (finger / pen / mouse, Pencil only), the input carried to the menu, and the
  viewer wiring (every touch surface, not the phone flag).
- `debug/scenarios/touch-long-press-menu.spec.mjs` — Playwright: tablet
  1024x1366 finger and pen long press per tool (menu under Pan / Select with
  44 px rows, none under a drawing tool), none during a pan, a pinch or a
  stroke, Pencil only (finger: no menu, pen: menu), desktop right-click rows
  unchanged, phone long press unchanged.
- Existing: `tests/panMomentum.test.mjs`, `tests/dismissRules.test.mjs`,
  `tests/doubleTapMultiTouchGuard.test.mjs`, `tests/pdfjsTextLayerTouchContract.test.mjs`.

What only a real device can confirm: Apple Pencil touch streams
(`touchType: 'stylus'`) and palm contact sizes on an iPad, a Windows pen's
pointer stream, and the feel of the system back-swipe beside the rail.

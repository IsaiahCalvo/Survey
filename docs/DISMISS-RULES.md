Written: 2026-09-23 22:00

# Dismiss rules — what a press outside an open thing does

Owner ruling 2026-09-23: "If I have a dropdown open or the color picker open,
and I click on something else, like another button, it should invoke that
button or that dropdown … is clicking off just clicking off, or is clicking
off actually switching to another tool?"

One rule set for the whole app — desktop, phone, the PDF screen's chrome and
the home screens. The code lives in one place:
`src/components/dismissRules.js` (the rules, the shared registry and the two
window guards) and `src/components/DismissBarrier.jsx` (the component most
popovers use). Keep this page, that file's header comment and the code in step.

## The rules

**R1 Light popovers never block.** Dropdowns, menus, the colour picker, tool
sub-menus, "…" menus, sort/filter menus, the zoom/fit menu, right-click menus.
A press outside closes the popover AND the same press does its normal job:
opens the other dropdown, switches tool, presses the button, selects the
annotation that was pressed, focuses the field. One press, never two.
Pressing the control that opened the popover closes it (a toggle) — it does
not close and reopen.

**R2 Bare page exception.** A press on the PDF viewing area with nothing under
it (the empty page, the grey area around pages) while a light popover is open
ONLY closes the popover. No stroke, no shape, no text box, no Survey Marker,
no cleared selection — that press was aimed at the popover, not the page.
The Pan tool is exempt (its press never marks, so its drag still pans), and
wheel, trackpad and two-finger gestures are never touched. A right-click still
opens its menu.

**R3 Typing.** While you are typing — in the text editor on the page, in a
field inside an open popover, or in a search box — the first press outside
only ends the typing (the text editor commits, as it always did; a field
blurs) and does nothing else. Exceptions that work at once: controls that act
on the text (the formatting bar, the mini toolbar, the font colour picker, the
phone text sheet), other popover openers, and other text/title fields.

**R4 Blocking windows block.** Modal dialogs and sheets with a backdrop
(confirm delete, share, settings and account windows, phone bottom sheets, the
colour picker sheet on the phone): a press on the backdrop only closes the
window (destructive confirms: nothing happens) and never reaches what is
behind it.

**R5 Escape closes only the topmost** popover or window. A popover open on top
of a selection closes and the selection stays; a popover open while you type
closes and the text box stays; the right-click series menu closes before the
series menu under it; one dialog over another closes alone.

**R6 One light popover at a time.** Opening one closes the other in the same
press (this falls out of R1: the press on the second opener is an outside press
for the first).

## How it is built

- Every open light popover registers in one list (`registerLightPopover`).
  `DismissBarrier` does it for you; hand-rolled popovers call
  `watchLightPopover({ contains, close })`, which also gives them the R1
  outside-press close (pointerdown, capture phase, never consumed).
- Two listeners on `window`, capture phase, installed when `dismissRules.js`
  loads — so they run before every canvas listener:
  - **pointerdown**: R3 first (you are typing and the press is not an
    exception → consume it, end the typing), then R2 (a light popover is open
    and the press is bare page → consume it, close every open popover).
    Everything else passes untouched (R1).
  - **keydown Escape**: R5 — close the last-opened entry only. An entry that
    owns its own Escape (`escape: false`, e.g. the text editor, which commits
    on Escape) keeps it.
- "Consume" means `swallowRestOfPress`: the pointerdown, its moves and release,
  and the trailing click are all stopped, so nothing behind reacts. It holds
  for as long as the finger or button is down (no timer), and the click window
  opens only at release and lasts 300ms — so a long press still loses its
  click and a drag never leaves a blocker behind. Used ONLY for R2, R3 and
  R4 — never for an ordinary R1 outside press.
- When R3 ends the typing it also closes any light popover open beside the
  text (e.g. the colour picker), since the consumed press never reaches that
  popover's own outside handler.
- A Space-held temporary pan (desktop) is exempt from R2 like the Pan tool.
- A popover's own opener toggles it closed: the opener is the control whose
  press opened it (a right-click opens with no opener), or an expanded control
  whose `aria-controls` names it. Each surface registers once per opening, so
  the Escape order (R5) follows the order things opened.
- `isBarePagePress` decides R2 from the DOM: inside the pdf.js scroller
  (`[data-mobile-pdf-surface]`), not under Pan (`data-interaction-mode`), not a
  control, link, live form widget, the text editor or an annotation hit target;
  inside the SVG layer only the layer's root counts as bare. A future on-page
  control can opt out with `data-dismiss-press-through`.
- Modals keep their backdrops (R4). `useFocusTrap` keeps a stack so only the
  topmost dialog answers Escape (R5).

## Where each place stands

| Place | Kind | Now |
|---|---|---|
| Desktop colour picker (border/fill, font colour), Templates entity colour panels | light | R1 (the old first-tap swallow is gone), R2, R5 |
| Desktop toolbar dropdowns: width, style, arrowheads, arrow ends, font, font size, blend, counter series (+ its right-click menu) | light | R1, R2, R5, R6. Fixed: a second dropdown opened from the first no longer shuts itself (focus was handed back to the first trigger) |
| Zoom/fit menu, Survey export menus, Survey module/template/marker dropdowns, page right-click menu, Spaces export menu, annotation right-click menu | light | R1, R2, R5 via `watchLightPopover` |
| Phone strip dropdowns, header page/zoom, More menu, sync details | light | R1 (the old first-tap swallow is gone), R2, R5 |
| Home: document/project/template "…" menus, sort/filter menus, title switcher, Bookmarks add menu, sync details, print page list, Manage Team menus | light | R1 (the old first-tap swallow is gone), toggles on their own opener |
| Text editor on the page | typing | R3 |
| Home search, Manage Team search, the right rail's page and zoom fields | typing | R3 (as before) |
| Phone colour picker sheet | blocking | R4 (its backdrop tap only closes it) |
| Modals and phone sheets with a backdrop | blocking | R4 (unchanged), R5 |

## Deliberately left alone

- The legacy Fabric "Edit" panel in `PageAnnotationLayer.jsx` and the region
  tool's own menus: special-purpose surfaces with their own rules; not changed.
- The four caret popups in `PDFViewer.jsx` (counter, highlighter, underline,
  strike): unreachable today.
- Inline fields that are not in a popover (zoom %, page number, rename fields):
  they behave as before; R3 covers the text editor, fields in popovers and
  search boxes.
- An imported "select/delete only" text markup sits under the pdf.js text
  layer, which looks like bare page: with a popover open, a press there only
  closes the popover; the next press selects it.

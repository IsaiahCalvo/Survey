Written: 2026-10-22 13:45 ET

# Tooltip rules — every hover hint works the same way

Owner ruling 2026-10-22: "Make sure we have some type of rule regarding
tooltips within the code base so that all tooltips work the exact same way,
as that video said they should." The video is "Why the best software must LIE
to you" (Kole Jain), 3:35: wait once, then show the rest at once.

One tooltip for the whole app — desktop, tablet, the PDF screen's chrome, the
home screens, dialogs and overlays. The code lives in one place:
`src/components/Tooltip.jsx`. Keep this page, that file's header comment and
the code in step. `tests/tooltipRule.test.mjs` fails the build on a break.

## The rules

**T1 One tooltip.** Every hover hint is the shared chip from
`components/Tooltip.jsx`. Spread the binder onto the control:

```jsx
const tip = useTooltip();
<button aria-label="Zoom in" {...tip('Zoom in', 'below')}>…</button>
```

Never a native `title=` attribute (the OS tooltip: ~1.5 s late, styled by the
operating system, and it stacks on top of ours), never `el.title = …` in DOM
code, never a hand-made hover box, a CSS `:hover` hint or a tooltip library.

**T2 Wait once, then show the rest at once.** The first chip waits
`TOOLTIP_DELAY_MS` (400 ms) with the pointer resting on the control, so a
pointer crossing the toolbar on its way somewhere else flashes nothing. Once a
chip has shown, the next one within `TOOLTIP_WARM_MS` (600 ms) of the last one
hiding shows with no wait, so moving along a row of buttons reads each one at
once. The timing is shared by every surface: moving from a toolbar chip to a
tab chip stays warm.

**T3 One place and one look.** Placement is `below`, `above`, `left` or
`right` of the control, a fixed gap away, kept on screen. The look is
`TOOLTIP_SURFACE`: one line for a name, wrapping at 320 px for a sentence. Pick
the side with room: `below` for the top bars and tabs, `above` for bottom bars
and toasts, `left` from the right rail, `right` from the left rail.

**T4 Keyboard.** Tabbing to a control shows its chip at once (focus is
deliberate, never a pass-through). Escape hides it without moving focus.

**T5 Touch is pan-only.** A finger or pen never raises a chip, not even a
flash after a tap. Phone controls still carry the binder; it simply never
fires for touch.

**T6 Press hides it.** Pressing a control hides its chip and keeps it hidden
until the pointer leaves, so a chip never sits over the menu the control just
opened. A held button (a drag) raises no chips.

**T7 The chip is never the name.** The control carries its own `aria-label`
(or visible text). The chip is `aria-hidden`, so a screen reader never reads a
name twice.

**T8 A tab shows its full name.** Every document tab shows its whole file name
on hover, cut short or not.

## How to add one

- In a React component: `const tip = useTooltip();` then `{...tip(text, side)}`.
  An empty or undefined text gives no chip.
- The control already has its own `onMouseEnter`, `onFocus`, `onPointerDown`
  and so on: join them with `withOwnHandlers(tip(text, side), { onMouseEnter, … })`
  so neither side is dropped.
- A text field whose hint is about the pointer ("Click to rename"):
  `hoverOnly(tip(text, side))`.
- A control built outside React (an overlay that makes its own DOM): take a
  binder from React and call `attachTooltip(el, tip, text, side)`.
- Outside every host (a test, a dev route) the binder is a no-op, never an
  error.

## Not a tooltip

A panel you can click inside (the survey marker review card, the people list
under the presence avatars) is a popover, not a tooltip. It may borrow
`TOOLTIP_SURFACE`'s look but follows the dismiss rules
(`docs/DISMISS-RULES.md`), not these.

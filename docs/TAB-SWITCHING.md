Written: 2026-10-27 ET

# Tab switching — what each tab keeps, and how a switch looks

Owner 2026-10-27: "The PDF needs to switch smoothly ... and the top, left,
and right rails need to be solid without flickering (just a smooth switch of
selected buttons and annotation tools and whether the rails were left open or
closed). Figure out whatever ruleset we should follow and make sure it is
consistent, reliable, and solid. See what Drawboard does, but don't just copy
blindly."

`tests/e2e-signed-in/tab-switch-smooth.spec.mjs` records every frame of a
switch and fails on a break; `tests/tabSwitchChrome.test.mjs` guards the
wiring.

## The rules

**S1 A tab comes back exactly as it was left.** Switching away and back
changes nothing in that tab. What belongs to a tab:

| Kept per tab | Where it lives |
| --- | --- |
| Place in the document: page, zoom, scroll | the tab's own viewer (never unmounted) |
| Active tool, selection, text being edited | the tab's own viewer |
| Left panel open or shut, and which panel | the tab's left rail; also saved per document (`sidebar/panelLayoutStore.js`) |
| Search text and results | the tab's left rail (kept mounted) |
| Survey on or off, template, Survey panel open or shut | the tab's viewer and right rail |

**S2 Settings are shared.** Theme, tool bar layout, tool presets and colours,
pinned tools and every other user setting are the same in every tab; changing
one in a tab changes it everywhere.

**S3 A switch is one frame.** The frame before the switch shows the old tab
whole; the next shows the new tab whole: its document, its rails, its footer
zoom and page count. No in-between frame mixes the two, and nothing fades,
slides or reloads.

**S4 The chrome is never rebuilt.** The top bar, the tab strip and both rails
keep their elements across a switch. Each open tab keeps its own left and
right rail mounted in a `TabChromeSlot` (`display: contents` in front,
`display: none` behind), so a switch only flips which slot shows; the shared
top bar just shows the front tab's tool and buttons.

**S5 No entry animation on a switch.** Panels that slide in when you open
them do not slide in again because their tab came to the front. A switch sets
`data-viewer-returning` on `:root` for a moment, which runs those entry
animations at 0 s (`hooks/useViewerReturnQuiet.js`, `styles/motion.css`).

**S6 Only the front tab acts on shared things.** A rail behind does not
publish its width, answer keys (Escape, F3 / Ctrl+G), yield space to other
panels, or run the Survey agent. One-shot requests from the shell ("open the
Survey sheet") reach only the front tab, and a tab coming back does not replay
the ones it missed (`hooks/useActiveOnlyCounter.js`).

**S7 A switch writes nothing onto `:root`'s style.** Every element inherits a
custom property set on `:root`, so changing one makes the browser restyle the
whole document: about 0.1 s on a 36-sheet drawing set (~12k elements). Edges
other things line up with (rail widths, the bottom of the top bar) go through
`utils/chromeInsets.js` and each consumer sets them on itself. A value that
must stay on `:root` is written only when it changes, and is left in place for
the next tab to overwrite rather than cleared and set again. (Toggling a data
attribute on `:root`, as S5 does, is cheap: ~1 ms.)

**S8 Phone.** Only the front tab's rails exist (the phone shows one thing at
a time and has the least memory). The top bar's bottom edge is still written
to `:root` there, for the phone CSS that reads it.

## How this differs from Drawboard, and why

Measured in Drawboard PDF (web), 2026-10-27:

- Its chrome stays put across a switch, as S4. Same here.
- Its active tool is shared by all tabs. Here each tab keeps its own (S1): a
  markup tool picked for one drawing set should not arm itself on a
  contract in the next tab, and switching back should find the tool you left.
- An unpinned side panel closes when you switch. Here each tab keeps its
  panels as you left them (S1), which is what the owner asked for.
- The document reloads: a white flash of about 0.25 s, and the zoom and
  scroll go back to the start. Not copied: here the viewer stays mounted
  and the switch is one frame (S3).

## Speed

A switch to a big drawing set (36 sheets) shows its first frame about 0.2 s
after the click in a production build (a one-page document: under 0.1 s).
Almost all of that is the one restyle of the tab coming out of
`display: none`, which S7 keeps to one. Making that restyle cheaper means
fewer elements per page or cheaper CSS selectors; see the per-page
native-annotation hide rules in `PDFViewer.jsx` (`[id=…] *`), left over from
the Syncfusion viewer.

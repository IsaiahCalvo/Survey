// The colour group at the left of the desktop tool bar's settings row: which
// colour controls it shows, and whether the rule that closes the group stands.
// Moved out of AppShell (w43, 2026-09-26) so the no-shift contract for the
// "Aa" toggle can be tested without rendering the shell
// (tests/textFormatToggleNoShift.test.mjs).

/**
 * Whether the tool-properties row is showing a colour control at all, i.e.
 * whether the quick colour dots have a swatch to stand beside. The three arms
 * are the three swatch variants rendered below — stroke-only, counter,
 * fill+border — so a dot can never appear beside a row with no colour to
 * change. Rich-text edit mode is the one deliberate exception: the swatch
 * there paints the text box's own fill and border while the sub-row owns the
 * font colour, and four dots that look like font colours but are not would be
 * a trap.
 */
export const showsColorSwatch = (api) => {
  if (!api || api.activeTool === 'eraser' || api.richTextEditor) return false;
  const tool = api.contextTool;
  if (['pen', 'highlighter', 'arrow', 'line', 'polyline', 'text-markup', 'text-select'].includes(tool)) return true;
  if (tool === 'counter') return !!api.handleFillColorChange;
  return ['rect', 'ellipse', 'polygon', 'text', 'callout'].includes(tool) && !!api.handleFillColorChange;
};

/**
 * PASS 7 (boards 8-12, owner ruling): which tools show the QUICK COLOUR DISCS.
 *
 * A SINGLE-COLOUR tool — pen, highlighter, line, arrow, polyline, a text mark —
 * has one colour, so three ready colours and a way out to the picker are the
 * whole control. A MULTI-COLOUR tool — rectangle, ellipse, polygon, counter,
 * text box, callout — has a fill AND a border, and a disc cannot say which of
 * the two it would change: those tools show ONE combined swatch instead (the
 * fill with the border as a ring, or the pin with its number), which opens the
 * picker on its Border / Fill tabs. Boards 9, 11 and 12 draw exactly that.
 */
export const showsQuickColourDots = (api) => (
  showsColorSwatch(api)
  && ['pen', 'highlighter', 'arrow', 'line', 'polyline', 'text-markup', 'text-select'].includes(api.contextTool)
);

/**
 * PASS 7 (boards 9, 11, 12): which tools show the ONE COMBINED SWATCH.
 *
 * The other half of the ruling above: a tool that has both a fill and a border
 * shows the swatch and no preset discs. A polyline is deliberately NOT in here —
 * it is a stroke with no fill in this app (see resolveAnnotationPaint), so a
 * "fill centre with a border ring" would preview a colour the mark never paints
 * and the picker's Fill tab would write somewhere nothing reads.
 *
 * Rich-text edit mode keeps the swatch (`api.richTextEditor`) even though
 * showsColorSwatch hides the discs there: the swatch paints the text BOX — its
 * fill and its border — while the third bar owns the font colour, so the two
 * never compete for the same control.
 */
export const showsPaintSwatch = (api) => {
  if (!api || api.activeTool === 'eraser') return false;
  if (api.contextTool === 'counter') return !!api.handleFillColorChange;
  return (['rect', 'ellipse', 'polygon', 'text', 'callout'].includes(api.contextTool) || !!api.richTextEditor)
    && !!api.handleFillColorChange;
};

/**
 * w43 (2026-09-26, owner report "clicking Aa shifts the bar"): the rule that
 * closes the colour group stands whenever EITHER colour control is on screen.
 * Keyed on showsColorSwatch alone it vanished while a text box was open for
 * typing (the swatch stays there, only the dots go), so opening or closing the
 * editor from the Aa slid every setting to its right sideways by one rule.
 * `hasPaint` is whether a resolved paint exists for the swatch to show.
 */
export const showsColourRule = (api, hasPaint = true) => (
  showsColorSwatch(api) || (showsPaintSwatch(api) && !!hasPaint)
);

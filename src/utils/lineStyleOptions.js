/*
 * PASS 7 (boards 9-12 + 15): the four LINE STYLES and the drawing each one
 * shows. The drawing is the same glyph in the pill and in the menu row, at two
 * sizes, so what the row promises is what the pill reports back.
 *
 * Shared by the desktop tool bar's Style pill (AppShell) and the selection
 * quick bar's Line popover (components/SelectionQuickBar.jsx), so the two
 * offer the same styles under the same names and drawings.
 */
export const LINE_STYLE_OPTIONS = Object.freeze([
  Object.freeze({ value: 'solid', label: 'Solid' }),
  Object.freeze({ value: 'dashed', label: 'Dashed' }),
  Object.freeze({ value: 'dotted', label: 'Dotted' }),
  Object.freeze({ value: 'cloud', label: 'Cloud' }),
]);

export const LINE_STYLE_SAMPLE_ICONS = Object.freeze({
  solid: 'lineSampleSolid',
  dashed: 'lineSampleDashed',
  dotted: 'lineSampleDotted',
  cloud: 'lineSampleCloud',
});

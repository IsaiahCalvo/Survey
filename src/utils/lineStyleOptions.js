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
  longDash: 'lineSampleLongDash',
  dashDot: 'lineSampleDashDot',
  cloud: 'lineSampleCloud',
});

/*
 * Nightly 'line-dashes' (Drawboard PDF's five patterns, checked live
 * 2026-11-10): Long dash and Dash-dot join Solid, Dashed and Dotted. Their
 * dash : gap runs follow Drawboard's menu (13 : 6 and 11 : 4 : 2 : 4).
 */
export const MORE_LINE_STYLE_OPTIONS = Object.freeze([
  Object.freeze({ value: 'longDash', label: 'Long dash' }),
  Object.freeze({ value: 'dashDot', label: 'Dash-dot' }),
]);

/** The styles a picker offers: the four, plus the two more with the flag (before Cloud). */
export function lineStyleOptionsWith(more = false) {
  if (!more) return LINE_STYLE_OPTIONS;
  const at = LINE_STYLE_OPTIONS.findIndex((option) => option.value === 'cloud');
  return [...LINE_STYLE_OPTIONS.slice(0, at), ...MORE_LINE_STYLE_OPTIONS, ...LINE_STYLE_OPTIONS.slice(at)];
}

/** Each dashed style's stroke-dasharray, in page units. Solid and Cloud have none. */
export const LINE_STYLE_DASHES = Object.freeze({
  dashed: Object.freeze([6, 4]),
  dotted: Object.freeze([2, 4]),
  longDash: Object.freeze([13, 6]),
  dashDot: Object.freeze([11, 4, 2, 4]),
});

/** A fresh dash array for `style`, or null (solid, cloud, anything else). */
export const dashForLineStyle = (style) => (LINE_STYLE_DASHES[style] ? [...LINE_STYLE_DASHES[style]] : null);

/** The style a mark's dash array reads as ('solid' when it has none or one we do not know). */
export function lineStyleForDash(dash) {
  if (!Array.isArray(dash) || dash.length < 2) return 'solid';
  const first = Number(dash[0]);
  if (dash.length >= 4 && first === 11) return 'dashDot';
  if (first === 13) return 'longDash';
  if (first === 6) return 'dashed';
  if (first === 2) return 'dotted';
  return 'solid';
}

/** The dashed styles a shape line can take (callouts keep the first three). */
export const isDashLineStyle = (style) => Object.prototype.hasOwnProperty.call(LINE_STYLE_DASHES, style);

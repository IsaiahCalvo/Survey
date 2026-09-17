/**
 * quickStylePresets.js — the one list of quick styles that opens the
 * tool-properties row, on the desktop top bar AND on the phone strip.
 *
 * INTENDED UX (owner, 2026-09-17): "three or four default colors; to the right
 * or left of them the color swatch that opens the picker; three default line
 * widths, next to them the input field to type a width and the dropdown to
 * select more; then the line type." The three things a user changes most about
 * a mark are its colour, its line width and its line type, and every one of
 * them used to cost a press plus a popover. The row now leads with the
 * defaults, and the full picker and the typed width field stay right beside
 * them for everything else.
 *
 * WHY THE CONSTANTS LIVE HERE AND NOT IN EITHER CHROME FILE: the desktop bar
 * and the phone strip are two different files with two different layouts, and
 * a quick colour that differs between them is a bug the user reads as "my red
 * moved". One module, imported by both, so the two can never drift apart.
 * tests/quickStyleRow.test.mjs pins that both platforms import from here.
 *
 * REFERENCE BEHAVIOUR MATCHED: Drawboard PDF's tool strip, which keeps a short
 * row of default colours and default weights inline and reserves the popover
 * for the long tail.
 */

/**
 * The four defaults. These are not new colours: they are the red, blue, green
 * and black cells of the shared CompactColorPicker's own grid
 * (src/components/CompactColorPicker.jsx PRESET_COLORS), spelled with the same
 * hex, so pressing a dot and picking that cell out of the picker land on
 * exactly the same value and the picker opens showing the dot's colour as the
 * selected one. Red is also the app's own default stroke and fill.
 */
export const QUICK_COLOURS = Object.freeze(['#FF0000', '#0000FF', '#00FF00', '#000000']);

/** Plain names for the dots' accessible labels and tooltips. */
export const QUICK_COLOUR_NAMES = Object.freeze({
  '#FF0000': 'Red',
  '#0000FF': 'Blue',
  '#00FF00': 'Green',
  '#000000': 'Black',
});

/**
 * The three default line widths, taken from the app's existing width presets
 * (ANNOTATION_SIZE_PRESETS.width = 1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 32, 50).
 * 1 / 2 / 4 are the three that survey markup actually uses: a hairline, the
 * everyday line, and a line that still reads from across a printed sheet.
 * They are members of the preset list, so a quick width and a width picked out
 * of the dropdown are the same value and the dropdown shows it as selected.
 */
export const QUICK_WIDTHS = Object.freeze([1, 2, 4]);

/** The brand gold the chrome already uses for "this is the current one". */
export const QUICK_CURRENT_RING = '#d8a84e';

/**
 * Colour comparison for "is this dot the current colour". Colours reach the
 * chrome as #rgb, #rrggbb, #rrggbbaa or a named colour depending on where they
 * were last written, so compare the six hex digits and nothing else — the
 * alpha belongs to the opacity control, not to the dot.
 */
export const normaliseQuickColour = (value) => {
  const raw = String(value ?? '').trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/.exec(raw);
  if (short) return `#${short[1].split('').map((c) => c + c).join('')}`;
  const long = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(raw);
  if (long) return `#${long[1]}`;
  return raw;
};

/** The quick colour `value` is, or null when it is a colour the dots do not hold. */
export const matchedQuickColour = (value) => {
  const wanted = normaliseQuickColour(value);
  return QUICK_COLOURS.find((colour) => normaliseQuickColour(colour) === wanted) || null;
};

/**
 * Width comparison. Widths keep one decimal (the Cloud style's 2.5 default),
 * so a committed "2.0" and the preset 2 are the same width.
 */
export const isQuickWidth = (value, width) => {
  const current = Number(value);
  return Number.isFinite(current) && Math.abs(current - width) < 0.001;
};

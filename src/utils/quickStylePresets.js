/**
 * quickStylePresets.js — the one list of quick styles that opens the
 * tool-properties row, on the desktop top bar AND on the phone strip, plus the
 * one place that decides how a CHOSEN colour is marked.
 *
 * INTENDED UX (owner, pass 7, 2026-09-21, boards 1-12 and 17-19): a
 * single-colour tool (pen, highlighter, line, arrow) shows three quick colour
 * discs — red, blue, black — and one rainbow "custom" disc that opens the
 * shared picker. A multi-colour tool (rectangle, ellipse, polygon, polyline,
 * callout, text box, counter) shows NO preset discs: it shows one combined
 * swatch instead, and that swatch opens the picker on its Border tab.
 *
 * WHY GREEN LEFT (owner, 2026-09-21): the approved boards carry exactly three
 * presets plus the custom disc. Four presets plus a custom disc is five 22px
 * buttons, which no longer fits the 375px phone strip beside the width and
 * line-style pills, and the owner picked which three survive: red, blue, black.
 * Green is still one press away in the picker's own presets row.
 *
 * WHY THE CONSTANTS LIVE HERE AND NOT IN EITHER CHROME FILE: the desktop bar
 * and the phone strip are two different files with two different layouts, and
 * a quick colour that differs between them is a bug the user reads as "my red
 * moved". One module, imported by both, so the two can never drift apart.
 * tests/quickStyleRow.test.mjs pins that both platforms import from here.
 *
 * REFERENCE BEHAVIOUR MATCHED: HeroUI's ColorSwatchPicker for the chosen-state
 * mark (a ring in the swatch's OWN colour with a gap, and a check in the
 * middle), which is what the owner approved on boards 1-12 and 17-19.
 */

/**
 * The three quick colours. These are not new colours: they are cells of the
 * shared CompactColorPicker's own presets row (PRESET_COLORS in
 * src/components/CompactColorPicker.jsx), spelled with the same hex, so
 * pressing a disc and picking that cell out of the picker land on exactly the
 * same value and the picker opens showing the disc's colour as the chosen one.
 * Red is also the app's own default stroke and fill.
 */
export const QUICK_COLOURS = Object.freeze(['#FF0000', '#0000FF', '#000000']);

/** Plain names for the discs' accessible labels and tooltips. */
export const QUICK_COLOUR_NAMES = Object.freeze({
  '#FF0000': 'Red',
  '#0000FF': 'Blue',
  '#000000': 'Black',
});

/**
 * The three default line widths, kept for the width chips' own component.
 *
 * NOTE (owner, pass 7): width is a DROPDOWN only in the approved bars — the
 * chips are not rendered there any more. The list stays because it is also the
 * list a typed width is checked against.
 */
export const QUICK_WIDTHS = Object.freeze([1, 2, 4]);

/*
 * THE CHOSEN-STATE MARK. Owner ruling 2026-09-21, verbatim: "Chosen quick
 * colour = HeroUI ColorSwatchPicker look: a ring in the disc's OWN colour, a
 * gap, and a white check in the middle. NEVER a gold ring. NEVER a gold fill
 * or wash."
 *
 * So the ring is the colour itself, drawn outside a gap in the panel's own
 * background. The three numbers below are the only judgement in it, and each is
 * a readability floor rather than a style choice.
 */

/**
 * The ring colour for a disc whose own colour cannot be seen against the panel
 * it sits on — pure black, and the grid's bottom row of near-blacks. Boards 17
 * and 19 draw exactly this: the chosen black disc and the chosen hsl(0 0% 8%)
 * cell both ring in #d7dce5 and keep the white check.
 */
export const SWATCH_RING_FALLBACK = '#d7dce5';

/** The check's ink on a light swatch (boards 17/19). White is used on dark. */
export const CHECK_INK_ON_LIGHT = '#0b0d12';

/**
 * The panel a swatch sits on: --surface-1 (#171a21), which is the boards'
 * --ui-toolbar. A ring has to clear this, not clear the page behind it.
 */
const PANEL_LUMINANCE = 0.0107;

/** How far off the panel a ring must be before it counts as visible. */
const RING_MIN_CONTRAST = 1.6;

/** Above this relative luminance a swatch is "light" and takes a dark check. */
const LIGHT_SWATCH_LUMINANCE = 0.45;

const srgbToLinear = (channel) => (channel <= 0.04045
  ? channel / 12.92
  : ((channel + 0.055) / 1.055) ** 2.4);

/**
 * Colour comparison for "is this disc the current colour". Colours reach the
 * chrome as #rgb, #rrggbb, #rrggbbaa or a named colour depending on where they
 * were last written, so compare the six hex digits and nothing else — the
 * alpha belongs to the opacity control, not to the disc.
 */
export const normaliseQuickColour = (value) => {
  const raw = String(value ?? '').trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/.exec(raw);
  if (short) return `#${short[1].split('').map((c) => c + c).join('')}`;
  const long = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(raw);
  if (long) return `#${long[1]}`;
  return raw;
};

/** WCAG relative luminance of a #rgb / #rrggbb colour, or null if not hex. */
export const relativeLuminance = (value) => {
  const hex = normaliseQuickColour(value);
  const match = /^#([0-9a-f]{6})$/.exec(hex);
  if (!match) return null;
  const n = parseInt(match[1], 16);
  const r = srgbToLinear(((n >> 16) & 255) / 255);
  const g = srgbToLinear(((n >> 8) & 255) / 255);
  const b = srgbToLinear((n & 255) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrastWithPanel = (luminance) => {
  const lighter = Math.max(luminance, PANEL_LUMINANCE);
  const darker = Math.min(luminance, PANEL_LUMINANCE);
  return (lighter + 0.05) / (darker + 0.05);
};

/**
 * The ring colour for a chosen swatch: its OWN colour, unless that ring would
 * be invisible against the panel, in which case the light fallback the boards
 * use. Never gold, on any path.
 */
export const swatchRingColour = (value) => {
  const luminance = relativeLuminance(value);
  if (luminance === null) return SWATCH_RING_FALLBACK;
  return contrastWithPanel(luminance) < RING_MIN_CONTRAST
    ? SWATCH_RING_FALLBACK
    : value;
};

/** The check's ink on a swatch: dark on a light colour, white on a dark one. */
export const swatchCheckInk = (value) => {
  const luminance = relativeLuminance(value);
  if (luminance === null) return '#ffffff';
  return luminance > LIGHT_SWATCH_LUMINANCE ? CHECK_INK_ON_LIGHT : '#ffffff';
};

/**
 * True when a dark swatch needs the faint hairline the boards draw round pure
 * black, so the disc has an edge instead of dissolving into the panel.
 */
export const needsSwatchHairline = (value) => {
  const luminance = relativeLuminance(value);
  return luminance !== null && contrastWithPanel(luminance) < RING_MIN_CONTRAST;
};

/** The quick colour `value` is, or null when it is a colour the discs do not hold. */
export const matchedQuickColour = (value) => {
  const wanted = normaliseQuickColour(value);
  return QUICK_COLOURS.find((colour) => normaliseQuickColour(colour) === wanted) || null;
};

/**
 * True when the current colour is not one of the three presets — which is when
 * the custom disc, and only the custom disc, wears the chosen mark.
 */
export const isCustomQuickColour = (value) => matchedQuickColour(value) === null;

/**
 * Width comparison. Widths keep one decimal (the Cloud style's 2.5 default),
 * so a committed "2.0" and the preset 2 are the same width.
 */
export const isQuickWidth = (value, width) => {
  const current = Number(value);
  return Number.isFinite(current) && Math.abs(current - width) < 0.001;
};

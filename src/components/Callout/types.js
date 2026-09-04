/**
 * Callout Types and Defaults
 * Ported from reference Callout app (TypeScript to JavaScript)
 */

/**
 * Arrowhead style options
 */
export const ARROWHEAD_STYLES = {
  NONE: 'none',
  SOLID_TRIANGLE: 'solidTriangle',
  V_SHAPE: 'vShape',
  OPEN_CIRCLE: 'openCircle',
  OPEN_TRIANGLE: 'openTriangle',
  HORIZONTAL_LINE: 'horizontalLine',
  // PDF /LE Diamond and /LE Slash drawn as themselves (owner ruling 2026-09-03:
  // never substitute a V for what the file asked for).
  DIAMOND: 'diamond',
  SLASH: 'slash'
};

export const ARROWHEAD_STYLE_LABELS = {
  [ARROWHEAD_STYLES.NONE]: 'None',
  [ARROWHEAD_STYLES.SOLID_TRIANGLE]: 'Solid triangle',
  [ARROWHEAD_STYLES.V_SHAPE]: 'V-shape',
  [ARROWHEAD_STYLES.OPEN_CIRCLE]: 'Open circle',
  [ARROWHEAD_STYLES.OPEN_TRIANGLE]: 'Open triangle',
  [ARROWHEAD_STYLES.HORIZONTAL_LINE]: 'Horizontal line',
  [ARROWHEAD_STYLES.DIAMOND]: 'Diamond',
  [ARROWHEAD_STYLES.SLASH]: 'Slash'
};

/**
 * Leader line-style options (the toolbar's Style picker for callouts).
 * Values match the shared lineBorderStyle vocabulary the shape tools use
 * ('solid' | 'dashed' | 'dotted') so one picker drives both families.
 */
export const CALLOUT_LINE_STYLES = {
  SOLID: 'solid',
  DASHED: 'dashed',
  DOTTED: 'dotted',
};

/**
 * Map a callout style.lineStyle onto the app's canonical dash arrays —
 * the EXACT patterns the shape tools persist in Fabric strokeDashArray
 * (annotationCreationCommit applyBorderStyle: dashed [6,4], dotted [2,4]).
 * Page-unit values: dashes scale with zoom via the SVG viewBox, same as
 * shape dashes (locked zoom convention 2026-07-14 — no non-scaling-stroke).
 *
 * @param {string|null|undefined} lineStyle
 * @returns {number[]|null} dash array, or null for solid/absent (legacy
 *   callouts have no lineStyle field — they stay solid, byte-identical).
 */
export const calloutLineDashArray = (lineStyle) => {
  if (lineStyle === CALLOUT_LINE_STYLES.DASHED) return [6, 4];
  if (lineStyle === CALLOUT_LINE_STYLES.DOTTED) return [2, 4];
  return null;
};

/**
 * Inverse of calloutLineDashArray — recover a lineStyle name from a stored
 * Fabric strokeDashArray (used by the bridge's group→callout fallback reader
 * so a projected dashed callout round-trips its style losslessly).
 *
 * @param {number[]|null|undefined} dash
 * @returns {string} one of CALLOUT_LINE_STYLES values
 */
export const calloutLineStyleFromDash = (dash) => {
  if (!Array.isArray(dash) || dash.length < 2) return CALLOUT_LINE_STYLES.SOLID;
  if (dash[0] === 6) return CALLOUT_LINE_STYLES.DASHED;
  if (dash[0] === 2) return CALLOUT_LINE_STYLES.DOTTED;
  return CALLOUT_LINE_STYLES.SOLID;
};

/**
 * @typedef {Object} Point
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {Object} CalloutStyle
 * @property {string} borderColor - Hex color for border/line
 * @property {number} borderOpacity - 0-1 opacity for border
 * @property {number} lineThickness - Line width in pixels (1-6)
 * @property {string} arrowheadStyle - Arrowhead style (see ARROWHEAD_STYLES)
 * @property {string} fillColor - Hex color for text box fill
 * @property {number} fillOpacity - 0-1 opacity for fill
 * @property {string} fontFamily - Font family name
 * @property {number} fontSize - Font size in pixels
 * @property {string} fontColor - Hex color for text
 * @property {boolean} bold
 * @property {boolean} italic
 * @property {boolean} underline
 * @property {boolean} strikethrough
 * @property {'left'|'center'|'right'} textAlign
 */

/**
 * @typedef {Object} Callout
 * @property {string} id - Unique identifier
 * @property {number} pageNumber - 1-indexed page number
 * @property {Point} arrowTip - Arrow endpoint position (percentage of page)
 * @property {Point} knee - Bend point position (percentage of page)
 * @property {Point} textBoxPosition - Top-left of text box (percentage of page)
 * @property {number} textBoxWidth - Width as percentage of page width
 * @property {number} textBoxHeight - Height as percentage of page height
 * @property {string} text - Text content
 * @property {CalloutStyle} style
 * @property {boolean} isSelected
 */

/**
 * @typedef {Object} DragTargetNone
 * @property {'none'} type
 */

/**
 * @typedef {Object} DragTargetArrowTip
 * @property {'arrowTip'} type
 * @property {string} calloutId
 */

/**
 * @typedef {Object} DragTargetKnee
 * @property {'knee'} type
 * @property {string} calloutId
 */

/**
 * @typedef {Object} DragTargetTextBox
 * @property {'textBox'} type
 * @property {string} calloutId
 */

/**
 * @typedef {Object} DragTargetWhole
 * @property {'whole'} type
 * @property {string} calloutId
 */

/**
 * @typedef {Object} DragTargetTextBoxCorner
 * @property {'textBoxCorner'} type
 * @property {string} calloutId
 * @property {'nw'|'ne'|'se'|'sw'} corner
 */

/**
 * @typedef {DragTargetNone|DragTargetArrowTip|DragTargetKnee|DragTargetTextBox|DragTargetWhole|DragTargetTextBoxCorner} DragTarget
 */

/**
 * @typedef {Object} CreationState
 * @property {boolean} isCreating
 * @property {Point|null} arrowTip
 * @property {Point|null} currentMouse
 */

/**
 * Default callout style matching the reference app
 */
export const defaultCalloutStyle = {
  borderColor: '#1e293b',
  borderOpacity: 1,
  lineThickness: 2,
  arrowheadStyle: ARROWHEAD_STYLES.SOLID_TRIANGLE,
  // UX: leader + box border line style — 'solid' | 'dashed' | 'dotted',
  // driven by the same toolbar Style picker the shape tools use. Absent on
  // legacy callouts (all render paths treat missing as solid).
  lineStyle: CALLOUT_LINE_STYLES.SOLID,
  // UX: transparent by default so view mode matches Fabric edit overlay
  // (backgroundColor: '' → transparent on the textbox in calloutEditAdapter
  // toFabricGroup :171). User rule 2026-04-17: "There visually needs to be
  // no difference between edit mode and not edit mode regarding fill, stroke,
  // and line weight." A baked-in white fill made view look opaque while edit
  // looked hollow. A future mini-toolbar (Phase 16+) will control fill as
  // an explicit user choice.
  fillColor: 'transparent',
  fillOpacity: 1,
  // UX: single-name fontFamily prevents Fabric.js Textbox cursor drift
  // when the default style is assigned to an edit-mode Textbox. Fabric
  // measures chars at CACHE_FONT_SIZE=400px and the browser may resolve
  // different fonts in a fallback chain at 400px vs actual display size,
  // producing wrong widths. See CLAUDE.md 2026-04-08 gotcha and
  // Phase 14-RESEARCH.md Pitfall 2.
  fontFamily: 'Arial',
  fontSize: 14,
  fontColor: '#1e293b',
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  textAlign: 'left',
};

/**
 * Generate a unique ID for callouts
 * @returns {string}
 */
export const generateId = () => {
  return 'callout-' + crypto.randomUUID();
};

/**
 * Create a new callout with default values
 * @param {number} pageNumber
 * @param {Point} arrowTip - Position as percentage of page (0-1)
 * @param {Point} knee - Position as percentage of page (0-1)
 * @param {Point} textBoxPosition - Position as percentage of page (0-1)
 * @param {number} textBoxWidth - Width as percentage of page width
 * @param {number} textBoxHeight - Height as percentage of page height
 * @returns {Callout}
 */
export const createCallout = (pageNumber, arrowTip, knee, textBoxPosition, textBoxWidth, textBoxHeight) => {
  return {
    id: generateId(),
    pageNumber,
    arrowTip,
    knee,
    textBoxPosition,
    textBoxWidth,
    textBoxHeight,
    text: '',
    style: { ...defaultCalloutStyle },
    isSelected: true,
  };
};

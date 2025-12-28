/**
 * Callout Types and Defaults
 * Ported from reference Callout app (TypeScript to JavaScript)
 */

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
  fillColor: '#fef3c7',
  fillOpacity: 1,
  fontFamily: 'Inter, Arial, sans-serif',
  fontSize: 14,
  fontColor: '#1e293b',
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  textAlign: 'left',
};

/**
 * Preset colors for border/line
 */
export const presetBorderColors = [
  '#1e293b', // slate-800
  '#dc2626', // red-600
  '#16a34a', // green-600
  '#2563eb', // blue-600
  '#9333ea', // purple-600
  '#ea580c', // orange-600
  '#0891b2', // cyan-600
  '#000000', // black
];

/**
 * Preset colors for fill
 */
export const presetFillColors = [
  '#fef3c7', // amber-100
  '#fee2e2', // red-100
  '#dcfce7', // green-100
  '#dbeafe', // blue-100
  '#f3e8ff', // purple-100
  '#ffedd5', // orange-100
  '#cffafe', // cyan-100
  '#ffffff', // white
  'transparent',
];

/**
 * Preset font families
 */
export const fontFamilies = [
  'Inter, Arial, sans-serif',
  'Arial, sans-serif',
  'Georgia, serif',
  'Times New Roman, serif',
  'Courier New, monospace',
  'Verdana, sans-serif',
];

/**
 * Preset font sizes
 */
export const fontSizes = [10, 12, 14, 16, 18, 20, 24, 28, 32];

/**
 * Convert hex color to rgba string
 * @param {string} hex - Hex color (e.g., '#ff0000')
 * @param {number} opacity - Opacity 0-1
 * @returns {string} rgba color string
 */
export const hexToRgba = (hex, opacity) => {
  if (hex === 'transparent') return 'transparent';
  if (!hex || !hex.startsWith('#')) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

/**
 * Generate a unique ID for callouts
 * @returns {string}
 */
export const generateId = () => {
  return 'callout-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
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

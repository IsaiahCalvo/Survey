/**
 * The text-formatting bar acting on a SELECTED text box or callout.
 *
 * UX 2026-09-23 (bug: "changing a selected callout's text colour does
 * nothing"). The desktop text bar (AppShell resolveTextFormatting) and the
 * phone Text settings card read one `{ textStyleDefaults,
 * onTextStyleDefaultsChange }` pair. Since 2026-09-22 (board 12) that pair was
 * the tool's defaults whenever the context tool was 'text' or 'callout' - and
 * a selected callout or text box maps its context tool onto exactly those, so
 * every colour dot, the custom picker, B/I/U/S, font, size and alignment
 * silently changed what the NEXT box would get while the selected one stayed
 * as it was. With one text box or callout selected (and no live editor), the
 * pair now reads that object's own text style and writes back to it; with the
 * tool merely armed it is still the tool's defaults. Reference: Acrobat,
 * Bluebeam and Drawboard all format the whole selected box from the same bar.
 *
 * Bar state keys (the same the live editor publishes): fontColor, fontFamily,
 * fontSize, bold, italic, underline, strike, textAlign, verticalAlign.
 */

import { isTextColorValue } from './textColorOpacity.js';

const CALLOUT_FALLBACK = Object.freeze({
  fontColor: '#1e293b',
  fontFamily: 'Arial',
  fontSize: 14,
});

const TEXTBOX_FALLBACK = Object.freeze({
  fontColor: '#1e293b',
  fontFamily: 'Arial',
  fontSize: 16,
});

const TEXTBOX_TYPES = new Set(['textbox', 'i-text', 'text']);

/** True for a saved object the bar can format as a whole text box. */
export function isFormattableTextObject(annotation) {
  if (!annotation || typeof annotation !== 'object') return false;
  if (annotation.data?.type === 'callout') return false;
  return TEXTBOX_TYPES.has(String(annotation.type || '').toLowerCase());
}

/** The bar state for a callout, from its stored style. */
export function readCalloutTextStyle(callout) {
  const style = callout?.style || {};
  return {
    fontColor: style.fontColor || style.textColor || CALLOUT_FALLBACK.fontColor,
    fontFamily: style.fontFamily || CALLOUT_FALLBACK.fontFamily,
    fontSize: Math.round(Number(style.fontSize) || CALLOUT_FALLBACK.fontSize),
    bold: !!style.bold,
    italic: !!style.italic,
    underline: !!style.underline,
    strike: !!style.strikethrough,
    textAlign: style.textAlign || 'left',
    verticalAlign: style.verticalAlign || 'top',
  };
}

/** The bar state for a Fabric text box. */
export function readTextboxTextStyle(annotation) {
  const fill = typeof annotation?.fill === 'string' && annotation.fill !== 'rgba(0,0,0,0)'
    ? annotation.fill
    : TEXTBOX_FALLBACK.fontColor;
  return {
    fontColor: fill,
    fontFamily: annotation?.fontFamily || TEXTBOX_FALLBACK.fontFamily,
    fontSize: Math.round(Number(annotation?.fontSize) || TEXTBOX_FALLBACK.fontSize),
    bold: annotation?.fontWeight === 'bold' || Number(annotation?.fontWeight) >= 600,
    italic: annotation?.fontStyle === 'italic' || annotation?.fontStyle === 'oblique',
    underline: !!annotation?.underline,
    strike: !!annotation?.linethrough,
    textAlign: annotation?.textAlign || 'left',
    verticalAlign: annotation?.verticalAlign || 'top',
  };
}

const sanitizeValue = (key, value) => {
  switch (key) {
    case 'fontColor': return isTextColorValue(value) ? String(value).trim() : null;
    case 'fontFamily':
      // Single-name fonts only (Fabric measurement contract, CLAUDE.md).
      return typeof value === 'string' && value.length > 0 && !value.includes(',') ? value : null;
    case 'fontSize': {
      const size = Math.round(Number(value));
      return Number.isFinite(size) ? Math.max(1, Math.min(200, size)) : null;
    }
    case 'textAlign': return ['left', 'center', 'right', 'justify'].includes(value) ? value : null;
    case 'verticalAlign': return ['top', 'middle', 'bottom'].includes(value) ? value : null;
    case 'bold':
    case 'italic':
    case 'underline':
    case 'strike':
      return !!value;
    default: return null;
  }
};

const CALLOUT_KEY = {
  fontColor: 'fontColor',
  fontFamily: 'fontFamily',
  fontSize: 'fontSize',
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'strikethrough',
  textAlign: 'textAlign',
  verticalAlign: 'verticalAlign',
};

const toTextboxEntry = (key, value) => {
  switch (key) {
    case 'fontColor': return ['fill', value];
    case 'bold': return ['fontWeight', value ? 'bold' : 'normal'];
    case 'italic': return ['fontStyle', value ? 'italic' : 'normal'];
    case 'strike': return ['linethrough', value];
    default: return [key, value];
  }
};

/**
 * The write for one bar change. `current` is the bar state that was on screen
 * (what the consumer merged its change into), `next` is that state with the
 * change applied. Only keys whose value changed are written - plus the text
 * colour whenever `forceColor` is set, so a colour drag's release is always
 * written (and so recorded as its one undo step) even when the last preview
 * frame already showed the released value.
 *
 * @returns {object|null} a callout `style` patch or a Fabric text box patch
 */
export function buildSelectedTextStylePatch(kind, current, next, { forceColor = false } = {}) {
  if ((kind !== 'callout' && kind !== 'textbox') || !next || typeof next !== 'object') return null;
  const patch = {};
  Object.keys(CALLOUT_KEY).forEach((key) => {
    if (!(key in next)) return;
    const value = sanitizeValue(key, next[key]);
    if (value === null) return;
    const changed = !current || sanitizeValue(key, current[key]) !== value;
    if (!changed && !(forceColor && key === 'fontColor')) return;
    if (kind === 'callout') {
      patch[CALLOUT_KEY[key]] = value;
    } else {
      const [field, fieldValue] = toTextboxEntry(key, value);
      patch[field] = fieldValue;
    }
  });
  return Object.keys(patch).length ? patch : null;
}

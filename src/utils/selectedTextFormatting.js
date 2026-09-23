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
      // 6-200: the live editor's range (TextEditOverlay setFontSize).
      return Number.isFinite(size) ? Math.max(6, Math.min(200, size)) : null;
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

/*
 * Box refit (review 2026-09-23): a bigger size, another font, or bold / italic
 * on a PICKED text box or callout reflows its text, and both renderers trust
 * the stored box height and hide overflow, so the new lines were clipped. The
 * live editor never lets that happen - it re-measures on every style change
 * and grows the box (TextEditOverlay broadcastLiveBounds + textEditCommit):
 * the width stays locked, the height becomes max(text height + padding,
 * current height), a tilted text box keeps its top-left corner. The same rule
 * runs here, in the SAME write as the style (one undo step). A callout's knee
 * never moves (KAL-30); its leader re-attaches to the grown box on render, as
 * it does after an edit.
 */

// Same gutter as svgAnnotationRenderers / textEditCommit TEXT_PADDING.
export const TEXT_BOX_PADDING = 6;

/** Keys whose change can reflow the text (colour / decoration / align cannot). */
const REFLOW_KEYS = {
  callout: ['fontSize', 'fontFamily', 'bold', 'italic'],
  textbox: ['fontSize', 'fontFamily', 'fontWeight', 'fontStyle'],
};

export function patchCanReflowText(kind, patch) {
  const keys = REFLOW_KEYS[kind];
  return !!(keys && patch && keys.some((key) => key in patch));
}

/**
 * The height the text box needs, or null when its current height already fits
 * (boxes grow, never shrink - the editor's rule).
 *
 * @param {object} args
 * @param {number} args.width outer width in page units
 * @param {number} args.height current outer height in page units
 * @param {number} args.padY vertical padding (text box 6, callout 0)
 * @param {(request: object) => number|null} args.measure the text's laid-out
 *   height at `innerWidth` with the given font (page units)
 */
export function fittedTextBoxHeight({ text, width, height, padY, font, measure }) {
  if (typeof measure !== 'function') return null;
  const innerWidth = Math.max(0, Number(width) - 2 * TEXT_BOX_PADDING);
  const natural = Number(measure({ text: String(text ?? ''), innerWidth, ...font }));
  if (!Number.isFinite(natural) || natural <= 0) return null;
  const needed = natural + 2 * padY;
  const current = Number(height) || 0;
  return needed > current + 0.5 ? needed : null;
}

/**
 * A callout with its box grown to fit its (already patched) text style.
 * Only textBoxHeight changes; position, width, knee and tip are untouched.
 */
export function refitCalloutToText(callout, pageSize, measure) {
  const W = Number(pageSize?.width);
  const H = Number(pageSize?.height);
  if (!callout || !(W > 0) || !(H > 0)) return callout;
  const style = callout.style || {};
  const width = Math.max(18, (callout.textBoxWidth ?? callout.textBox?.width ?? 0.1) * W);
  const height = Math.max(18, (callout.textBoxHeight ?? callout.textBox?.height ?? 0.05) * H);
  const needed = fittedTextBoxHeight({
    text: callout.text,
    width,
    height,
    padY: 0,
    font: {
      fontSize: Number(style.fontSize) || 12,
      fontFamily: style.fontFamily || 'Arial',
      fontWeight: style.bold ? 'bold' : 'normal',
      fontStyle: style.italic ? 'italic' : 'normal',
      // The callout renderer's line step: (lineHeight || 1) x 1.13.
      lineHeight: (Number(style.lineHeight) || 1) * 1.13,
      // buildCalloutTextContentStyle turns kerning and ligatures off.
      plainGlyphs: true,
    },
    measure,
  });
  if (needed == null) return callout;
  return { ...callout, textBoxHeight: needed / H };
}

/**
 * A Fabric text box with its height grown to fit its (already patched) font.
 * Width is locked; a tilted box keeps its rotated top-left corner in place
 * (the same shift textEditCommit applies after an edit).
 */
export function refitTextboxToText(annotation, measure) {
  if (!annotation) return annotation;
  const scaleX = Math.abs(Number(annotation.scaleX) || 1);
  const scaleY = Math.abs(Number(annotation.scaleY) || 1);
  const width = (Number(annotation.width) || 0) * scaleX;
  const height = (Number(annotation.height) || 0) * scaleY;
  if (!(width > 0)) return annotation;
  const needed = fittedTextBoxHeight({
    text: annotation.text,
    width,
    height,
    padY: TEXT_BOX_PADDING,
    font: {
      fontSize: Number(annotation.fontSize) || 16,
      fontFamily: annotation.fontFamily || 'sans-serif',
      fontWeight: annotation.fontWeight || 'normal',
      fontStyle: annotation.fontStyle || 'normal',
      // The text box renderer's line step: (lineHeight || 1.16) x 1.13.
      lineHeight: (Number(annotation.lineHeight) || 1.16) * 1.13,
    },
    measure,
  });
  if (needed == null) return annotation;
  const next = { ...annotation, height: needed / scaleY };
  const angle = Number(annotation.angle) || 0;
  const dh = needed - height;
  if (angle !== 0 && dh !== 0) {
    const rad = (angle * Math.PI) / 180;
    next.left = (Number(annotation.left) || 0) - (dh / 2) * Math.sin(rad);
    next.top = (Number(annotation.top) || 0) - (dh / 2) * (1 - Math.cos(rad));
  }
  return next;
}

/**
 * Browser measurer: lays the text out off-screen with the renderers' wrap
 * rules (pre-wrap, break-all; callouts also drop kerning/ligatures) and reads scrollHeight,
 * exactly what the live editor reads. Null outside a browser.
 */
export function measureTextLayoutHeight({
  text, innerWidth, fontSize, fontFamily, fontWeight, fontStyle, lineHeight, plainGlyphs = false,
}) {
  if (typeof document === 'undefined' || !document.body) return null;
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'absolute',
    left: '-100000px',
    top: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
    width: `${Math.max(0, innerWidth)}px`,
    minHeight: '1em',
    fontSize: `${fontSize}px`,
    // Single-name fonts only (Fabric measurement contract, CLAUDE.md).
    fontFamily: String(fontFamily || 'Arial').split(',')[0].trim().replace(/^['"]|['"]$/g, '') || 'Arial',
    fontWeight: String(fontWeight || 'normal'),
    fontStyle: fontStyle || 'normal',
    lineHeight: String(lineHeight),
    ...(plainGlyphs ? {
      fontKerning: 'none',
      fontVariantLigatures: 'none',
      textRendering: 'geometricPrecision',
    } : {}),
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
    wordBreak: 'break-all',
    boxSizing: 'border-box',
    padding: '0',
    margin: '0',
  });
  el.textContent = text;
  document.body.appendChild(el);
  try {
    return el.scrollHeight;
  } finally {
    el.remove();
  }
}

/**
 * What one text-bar change does (review 2026-09-23). Pure, so the rules are
 * tested without a browser:
 *  - a drag remembers the source it began on (its first frame); a frame or
 *    release whose source is gone or different is ignored,
 *  - under Select with no picked mark (it vanished) nothing is written - the
 *    tool's defaults are never repainted with a picked mark's value,
 *  - with the tool armed, the change is the tool's defaults,
 *  - with a picked mark, it is that mark's patch (null patch = ignore), plus
 *    whether the box must be re-measured.
 *
 * @returns {{ action: 'ignore'|'defaults'|'patch', defaults?: object,
 *   patch?: object, reflows?: boolean, dragRecord: object|null }}
 */
export function resolveTextStyleWrite({ next, phase, target, activeTool, dragRecord, now = Date.now() }) {
  const inDrag = phase === 'preview' || phase === 'settle' || phase === 'commit';
  const targetKey = target?.key ?? '';
  // A held thumb re-sends every 0.5s, so a record older than 2s belongs to a
  // drag whose release never arrived, not this one.
  const liveRecord = dragRecord && now - dragRecord.at < 2000 ? dragRecord : null;
  const nextRecord = (phase === 'preview' || phase === 'settle')
    ? { key: liveRecord ? liveRecord.key : targetKey, at: now }
    : null;
  const ignore = { action: 'ignore', dragRecord: nextRecord };
  if (inDrag && liveRecord && liveRecord.key !== targetKey) return ignore;
  if (!target) {
    if (activeTool === 'select') return ignore;
    const { supportsVerticalAlign: _ignored, ...defaults } = next || {};
    return { action: 'defaults', defaults, dragRecord: nextRecord };
  }
  const patch = buildSelectedTextStylePatch(target.kind, target.style, next, { forceColor: inDrag });
  if (!patch) return ignore;
  return {
    action: 'patch',
    patch,
    reflows: patchCanReflowText(target.kind, patch),
    dragRecord: nextRecord,
  };
}

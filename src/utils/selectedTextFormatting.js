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
import { placeResizedCalloutBox } from './calloutGeometry.js';

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
 * refit runs here, in the SAME write as the style (one undo step).
 *
 * Owner Test 44 (2026-10-06): the box now fits its text BOTH ways - it grows
 * and it shrinks (never under one line) - and a callout's box moves AWAY from
 * its leader (calloutGeometry placeResizedCalloutBox): knee below = bottom
 * edge stays, knee above or beside = top edge stays, the knee and arrow tip
 * never move, and a box that would still run into the leader shifts clear of
 * it. The width stays, except that a callout widens when one word cannot fit
 * on a line (the text would wrap mid-word). Text boxes keep their top edge.
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
 * The height the text box needs - grow or shrink, never under one line - or
 * null when its current height already fits to within half a unit.
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
  const oneLine = (Number(font?.fontSize) || 0) * (Number(font?.lineHeight) || 1);
  const needed = Math.max(natural, oneLine) + 2 * padY;
  const current = Number(height) || 0;
  return Math.abs(needed - current) > 0.5 ? needed : null;
}

const calloutFont = (style) => ({
  fontSize: Number(style?.fontSize) || 12,
  fontFamily: style?.fontFamily || 'Arial',
  fontWeight: style?.bold ? 'bold' : 'normal',
  fontStyle: style?.italic ? 'italic' : 'normal',
  // The callout renderer's line step: (lineHeight || 1) x 1.13.
  lineHeight: (Number(style?.lineHeight) || 1) * 1.13,
  // buildCalloutTextContentStyle turns kerning and ligatures off.
  plainGlyphs: true,
});

/** A callout's stored box and leader in page units. */
function calloutBoxInPageUnits(callout, W, H) {
  return {
    left: (callout.textBoxPosition?.x ?? callout.textBox?.x ?? 0) * W,
    top: (callout.textBoxPosition?.y ?? callout.textBox?.y ?? 0) * H,
    width: Math.max(18, (callout.textBoxWidth ?? callout.textBox?.width ?? 0.1) * W),
    height: (callout.textBoxHeight ?? callout.textBox?.height ?? 0.05) * H,
    knee: callout.knee ? { x: callout.knee.x * W, y: callout.knee.y * H } : null,
    arrowTip: callout.arrowTip ? { x: callout.arrowTip.x * W, y: callout.arrowTip.y * H } : null,
  };
}

/**
 * A callout with its box fitted to its (already patched) text style.
 * The knee and tip never move; the box keeps the edge that faces its leader.
 *
 * @param {object} callout the callout with the new style
 * @param {{width:number, height:number}} pageSize unscaled page size
 * @param {(request: object) => number|null} measure layout measurer
 *   (measureTextLayoutHeight). A request with `query: 'widestWord'` asks for
 *   the widest single word's width; a measurer that cannot answer returns
 *   null and the width stays.
 * @param {{ before?: object }} [options] `before`: the callout as it was
 *   before the style change (its font size sets the old drawn box edge)
 */
export function refitCalloutToText(callout, pageSize, measure, { before = null } = {}) {
  const W = Number(pageSize?.width);
  const H = Number(pageSize?.height);
  if (!callout || !(W > 0) || !(H > 0) || typeof measure !== 'function') return callout;
  const font = calloutFont(callout.style);
  const box = calloutBoxInPageUnits(callout, W, H);
  const text = String(callout.text ?? '');

  let width = box.width;
  const widest = Number(measure({ query: 'widestWord', text, ...font }));
  if (Number.isFinite(widest) && widest > 0) {
    // +1: a word measured at exactly the inner width may still wrap.
    const wordWidth = widest + 2 * TEXT_BOX_PADDING + 1;
    if (wordWidth > width + 0.5) width = Math.min(wordWidth, Math.max(width, W));
  }
  const fitted = fittedTextBoxHeight({ text, width, height: box.height, padY: 0, font, measure });
  const height = fitted ?? box.height;
  const beforeFontSize = Number(before?.style?.fontSize) || font.fontSize;
  if (fitted == null && width === box.width && beforeFontSize === font.fontSize) return callout;

  const pos = placeResizedCalloutBox({
    box,
    fontSize: beforeFontSize,
    next: { width, height, fontSize: font.fontSize },
    knee: box.knee,
    arrowTip: box.arrowTip,
    page: { width: W, height: H },
  });
  const moved = Math.abs(pos.left - box.left) > 1e-6 || Math.abs(pos.top - box.top) > 1e-6;
  if (fitted == null && width === box.width && !moved) return callout;
  const next = { ...callout };
  if (fitted != null) next.textBoxHeight = height / H;
  if (width !== box.width) next.textBoxWidth = width / W;
  if (moved) next.textBoxPosition = { x: pos.left / W, y: pos.top / H };
  return next;
}

/**
 * Typing into a callout (live editor): where its growing box goes, by the
 * same away-from-the-leader rule, measured from the callout as it was when
 * the edit began. Page units in and out.
 *
 * @param {object} startCallout the callout at the start of the edit
 * @param {{width:number, height:number}} pageSize unscaled page size
 * @param {{width:number, height:number, fontSize:number}} live the editor's
 *   current box size and font size
 * @returns {{left:number, top:number}|null}
 */
export function placeCalloutEditBox(startCallout, pageSize, live) {
  const W = Number(pageSize?.width);
  const H = Number(pageSize?.height);
  if (!startCallout || !(W > 0) || !(H > 0) || !live) return null;
  const box = calloutBoxInPageUnits(startCallout, W, H);
  return placeResizedCalloutBox({
    box,
    fontSize: Number(startCallout.style?.fontSize) || 12,
    next: { width: live.width, height: live.height, fontSize: live.fontSize },
    knee: box.knee,
    arrowTip: box.arrowTip,
    page: { width: W, height: H },
  });
}


/**
 * A Fabric text box with its height fitted - grow or shrink, at least one
 * line - to its (already patched) font. Width is locked; the top edge stays,
 * and a tilted box keeps its rotated top-left corner in place (the same shift
 * textEditCommit applies after an edit).
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
 * With `query: 'widestWord'` it returns the width of the widest single word
 * laid out on one line instead (refitCalloutToText widens a box to it).
 */
export function measureTextLayoutHeight({
  text, innerWidth, fontSize, fontFamily, fontWeight, fontStyle, lineHeight, plainGlyphs = false, query = null,
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
  if (query === 'widestWord') {
    Object.assign(el.style, { width: 'auto', whiteSpace: 'pre', display: 'inline-block', minHeight: '0' });
    document.body.appendChild(el);
    try {
      return String(text ?? '').split(/\s+/).reduce((widest, word) => {
        if (!word) return widest;
        el.textContent = word;
        // Layout units (like scrollHeight), immune to any page zoom transform.
        return Math.max(widest, el.scrollWidth);
      }, 0);
    } finally {
      el.remove();
    }
  }
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
 * Hardening 2026-09-23 (second review):
 *  - `changed` is ONLY the field(s) the user touched (the consumer's own
 *    `fields`). The patch is built from those alone, so a colour / opacity drag
 *    writes only the colour and a size change only the size (+ the refit
 *    height). Diffing the bar's WHOLE merged state against the mark's latest
 *    style used to write back a stale size / bold / font a collaborator had
 *    just changed, whenever a frame arrived before the bar re-rendered.
 *    Without `changed` (no caller left does this) the old whole-state diff runs.
 *  - A text box that had no id when picked is keyed by its place
 *    (`textbox:@page:index`) and carries that as `target.aliasKey`; the first
 *    save gives it an id mid-drag, so a drag begun on the alias carries on onto
 *    the id key (and adopts it) instead of dropping the rest of the drag.
 *
 * @returns {{ action: 'ignore'|'defaults'|'patch', defaults?: object,
 *   patch?: object, reflows?: boolean, dragRecord: object|null }}
 */
export function resolveTextStyleWrite({
  next, changed = null, phase, target, activeTool, dragRecord, now = Date.now(),
}) {
  const inDrag = phase === 'preview' || phase === 'settle' || phase === 'commit';
  const targetKey = target?.key ?? '';
  // A held thumb re-sends every 0.5s, so a record older than 2s belongs to a
  // drag whose release never arrived, not this one.
  const liveRecord = dragRecord && now - dragRecord.at < 2000 ? dragRecord : null;
  const sameMark = !liveRecord
    || liveRecord.key === targetKey
    || (!!target?.aliasKey && liveRecord.key === target.aliasKey);
  const nextRecord = (phase === 'preview' || phase === 'settle')
    ? { key: sameMark ? targetKey : liveRecord.key, at: now }
    : null;
  const ignore = { action: 'ignore', dragRecord: nextRecord };
  if (inDrag && !sameMark) return ignore;
  if (!target) {
    if (activeTool === 'select') return ignore;
    const { supportsVerticalAlign: _ignored, ...defaults } = next || {};
    return { action: 'defaults', defaults, dragRecord: nextRecord };
  }
  const fields = changed && typeof changed === 'object' ? changed : next;
  const patch = buildSelectedTextStylePatch(target.kind, target.style, fields, { forceColor: inDrag });
  if (!patch) return ignore;
  return {
    action: 'patch',
    patch,
    reflows: patchCanReflowText(target.kind, patch),
    dragRecord: nextRecord,
  };
}

/**
 * The phone "Text size" field's pending draft as the size to save, or null
 * when there is nothing to save (no draft, not a number, or the size it
 * already has). Clamped to the live editor's 6-200 range.
 */
export function resolveFontSizeDraft(pending, value) {
  if (pending === null || pending === undefined) return null;
  const parsed = Number.parseInt(pending, 10);
  if (!Number.isFinite(parsed)) return null;
  const fontSize = Math.max(6, Math.min(200, parsed));
  return fontSize !== Number(value) ? fontSize : null;
}

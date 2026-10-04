/**
 * Restyling marks that are already drawn (w41, 2026-09-25).
 *
 * UX (owner report 2026-09-25: "I'm not able to change the color of a pen
 * stroke ... once it's drawn, it's drawn"): with one or more marks selected,
 * the formatting controls - line colour, fill colour, opacity, line width,
 * line style, arrow ends - show the SELECTION's values and a change lands on
 * the selected marks. Reference: Drawboard PDF, Bluebeam Revu and Acrobat all
 * restyle the whole selection from the same bar that sets the next mark's
 * style. A mixed selection shows a mixed state and each mark takes only the
 * properties it has (a pen stroke has no fill, a rectangle has no arrow end).
 *
 * WHY THE PEN BROKE (regression, a3380bbf9 2026-07-10): since the capsule
 * eraser landed, a pen or highlighter stroke is stored as a FILLED OUTLINE
 * ("paper ink": fill = the ink colour, stroke 'transparent', strokeWidth 0,
 * the width baked into the outline and kept as `sourceWidth`). The toolbar
 * still wrote `stroke` / `strokeWidth`, which the renderer ignores for that
 * shape, so every colour and width change on a pen stroke did nothing.
 * Imported pressure ink (Drawboard / Adobe filled outlines) has the same shape.
 *
 * Everything here is pure (no DOM, no React) so the rules are unit tested.
 */

import { composeColorForPatch } from './annotationData.js';
import { renderPathToSvgAttrs } from './svgPathAttrs.js';
import { createInkAnnotation, boundsOfCommands } from './paperAnnotationGeometry.js';
import { isAbsoluteInkGeometry } from './inkGeometryTransform.js';
import { toolSupportsCloudBorderStyle } from './pdfAnnotationAppearance.js';
import { getAnnotationRenderIdentity } from './annotationStorageIdentity.js';
import { isArrowLineMark, isCounterMark, markToolForAnnotation } from './markToolGroup.js';

const NONE_ARROWHEAD = 'none';
const DEFAULT_ARROWHEAD = 'solidTriangle';

const lower = (value) => String(value || '').toLowerCase();

const clampPct = (value, fallback = 100) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
};

const isVisiblePaint = (value) => {
  if (value == null) return false;
  const text = String(value).trim().toLowerCase();
  return text !== '' && text !== 'none' && text !== 'transparent'
    && text !== 'rgba(0,0,0,0)' && text !== 'rgba(0, 0, 0, 0)';
};

/** '#rrggbb' from a hex or rgb(a) colour, or null. */
export function colorToHex(color) {
  if (typeof color !== 'string') return null;
  const text = color.trim();
  const rgb = text.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]]
      .map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))).toString(16).padStart(2, '0'))
      .join('')}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return `#${text.slice(1).split('').map((c) => c + c).join('')}`.toLowerCase();
  }
  if (/^#[0-9a-f]{8}$/i.test(text)) return text.slice(0, 7).toLowerCase();
  return null;
}

/** 0-100 alpha of a colour (hex / named = 100). */
export function colorToOpacity(color) {
  if (typeof color !== 'string') return 100;
  const rgba = color.trim().match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/i);
  if (rgba) return clampPct(Number(rgba[1]) * 100);
  const hex8 = color.trim().match(/^#[0-9a-f]{6}([0-9a-f]{2})$/i);
  if (hex8) return clampPct((parseInt(hex8[1], 16) / 255) * 100);
  return 100;
}

const isCounter = isCounterMark;
const isArrowLine = isArrowLineMark;

/**
 * True for a path whose visible body is its FILL (native paper ink,
 * eraser-carved ink, imported pressure-ink outlines). Its colour lives in
 * `fill`; its `stroke` is never painted.
 */
// Saved marks are replaced, never mutated, so the answer per object is fixed:
// cached, because a group of hundreds of strokes asks on every drag frame.
const filledInkCache = new WeakMap();
export function isFilledInkPath(annotation) {
  if (lower(annotation?.type) !== 'path' || !Array.isArray(annotation?.path)) return false;
  if (filledInkCache.has(annotation)) return filledInkCache.get(annotation);
  let filled = false;
  try {
    filled = renderPathToSvgAttrs(annotation).filledOutline === true;
  } catch {
    filled = false;
  }
  filledInkCache.set(annotation, filled);
  return filled;
}

/**
 * The page-unit scale a path is drawn at (resizing a stroke scales its
 * outline). Width is shown and set in drawn units, so a stroke that was
 * shrunk to half size and says "4" really looks 4 wide.
 */
const inkDrawScale = (annotation) => {
  const sx = Math.abs(Number(annotation?.scaleX) || 1);
  const sy = Math.abs(Number(annotation?.scaleY) || 1);
  const scale = Math.sqrt(sx * sy);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
};

/**
 * A native pen / highlighter outline can be rebuilt at a new width from its
 * stored centreline. Not when it was partly erased (the survivor is a cut
 * polygon, and rebuilding would paint erased ink back) and not for imported
 * outlines (no centreline). Only on the two coordinate contracts where the
 * rebuilt outline lands exactly where the old one was (page space, or
 * centre-origin ink after a move/resize: its pathOffset is the outline's
 * centre, which a symmetric width change does not move).
 */
export function canRebuildInkWidth(annotation) {
  if (!isFilledInkPath(annotation)) return false;
  if (annotation.paperInkGeometry !== 'v1') return false;
  if (!Array.isArray(annotation.paperCenterline) || annotation.paperCenterline.length === 0) return false;
  if (annotation.paperEraserGeometry || annotation.paperSourceStroke
    || (Array.isArray(annotation.paperEraserCuts) && annotation.paperEraserCuts.length > 0)
    || (Array.isArray(annotation.paperCenterlineRuns) && annotation.paperCenterlineRuns.length > 0)) {
    return false;
  }
  const space = annotation.inkGeometrySpace || annotation.data?.inkGeometrySpace;
  const origin = annotation.inkGeometryOrigin || annotation.data?.inkGeometryOrigin;
  if (space === 'page') return true;
  // Only Survey's own centre contract: its pathOffset is the outline centre.
  // Any other stored origin (Fabric left/top, legacy) would move the stroke
  // by the width change, so its width is left alone.
  if (origin === 'center-v1' && annotation.pathOffset
    && Number.isFinite(Number(annotation.pathOffset.x))
    && Number.isFinite(Number(annotation.pathOffset.y))) return true;
  return isAbsoluteInkGeometry(annotation);
}

/**
 * What the formatting bar can change on this mark. Counters (their paint
 * belongs to the whole series), text-mark highlights (their own grouped
 * transaction), stamps and images, Survey Markers and callouts are not
 * restyled through this module; callouts go through calloutRestylePatch.
 */
export function restyleCapabilities(annotation) {
  const none = {
    stroke: false, fill: false, width: false, lineStyle: false, cloud: false, arrowheads: false,
  };
  if (!annotation || typeof annotation !== 'object') return none;
  if (annotation.data?.type === 'callout' || annotation.data?.type === 'text-markup') return none;
  if (isCounter(annotation)) return none;
  const type = lower(annotation.type);
  if (type === 'path') {
    if (isFilledInkPath(annotation)) {
      return { ...none, stroke: true, width: canRebuildInkWidth(annotation) };
    }
    return { ...none, stroke: true, width: true };
  }
  if (type === 'rect' || type === 'ellipse' || type === 'polygon' || type === 'circle') {
    return {
      ...none, stroke: true, fill: true, width: true, lineStyle: true,
      cloud: toolSupportsCloudBorderStyle(type),
    };
  }
  if (type === 'polyline') {
    return {
      ...none, stroke: true, width: true, lineStyle: true, cloud: toolSupportsCloudBorderStyle(type),
    };
  }
  if (type === 'line') {
    return { ...none, stroke: true, width: true, lineStyle: true, arrowheads: isArrowLine(annotation) };
  }
  if (type === 'textbox') {
    // w43 (2026-09-26, owner request): a text box's border takes Cloud too
    // (utils/textCloudBorder.js draws it as the house rectangle cloud).
    return { ...none, stroke: true, fill: true, width: true, lineStyle: true, cloud: true };
  }
  return none;
}

const lineStyleOf = (annotation) => {
  if (annotation?.data?.pdfCloudIntensity != null
    && (toolSupportsCloudBorderStyle(lower(annotation.type)) || lower(annotation.type) === 'textbox')) {
    return 'cloud';
  }
  const dash = Array.isArray(annotation?.strokeDashArray) ? annotation.strokeDashArray : null;
  if (dash && dash.length >= 2) {
    if (Number(dash[0]) === 6) return 'dashed';
    if (Number(dash[0]) === 2) return 'dotted';
  }
  return 'solid';
};

/**
 * The mark's current style as the bar shows it:
 * { strokeColor '#rrggbb', strokeOpacity 0-100, fillColor, fillOpacity,
 *   width, lineStyle, cloudIntensity, arrowheadStyle }. Fields the mark does
 * not have are null.
 */
export function readRestyleStyle(annotation) {
  const caps = restyleCapabilities(annotation);
  const style = {
    strokeColor: null,
    strokeOpacity: null,
    fillColor: null,
    fillOpacity: null,
    width: null,
    lineStyle: null,
    cloudIntensity: null,
    arrowheadStyle: null,
  };
  if (!caps.stroke) return style;
  const inkBody = isFilledInkPath(annotation);
  const strokeSource = inkBody ? annotation.fill : annotation.stroke;
  style.strokeColor = colorToHex(strokeSource);
  style.strokeOpacity = isVisiblePaint(strokeSource) ? colorToOpacity(strokeSource) : 0;
  if (caps.fill) {
    const fillSource = lower(annotation.type) === 'textbox' ? annotation.backgroundColor : annotation.fill;
    style.fillColor = colorToHex(fillSource);
    style.fillOpacity = isVisiblePaint(fillSource) ? colorToOpacity(fillSource) : 0;
  }
  if (inkBody) {
    const source = Number(annotation.sourceWidth);
    style.width = Number.isFinite(source) && source > 0
      ? Math.round(source * inkDrawScale(annotation) * 10) / 10
      : null;
  } else {
    const width = Number(annotation.strokeWidth);
    style.width = Number.isFinite(width) ? width : null;
  }
  if (caps.lineStyle) {
    style.lineStyle = lineStyleOf(annotation);
    if (style.lineStyle === 'cloud') style.cloudIntensity = Number(annotation.data.pdfCloudIntensity) || 2;
  }
  if (caps.arrowheads) {
    style.arrowheadStyle = annotation.data?.arrowheadStyle || DEFAULT_ARROWHEAD;
    const start = annotation.data?.startArrowheadStyle ?? null;
    style.arrowBothEnds = Boolean(start && start !== NONE_ARROWHEAD && start === style.arrowheadStyle);
  }
  return style;
}

/** A callout's style in the same shape (callout.style fields). */
export function readCalloutRestyleStyle(callout) {
  const style = callout?.style || {};
  const border = style.borderColor || style.lineColor || '#1e293b';
  const fill = style.fillColor;
  const borderOpacity = Number(style.borderOpacity);
  const fillOpacity = Number(style.fillOpacity);
  return {
    strokeColor: colorToHex(border),
    strokeOpacity: Number.isFinite(borderOpacity) ? clampPct(borderOpacity * 100) : 100,
    fillColor: isVisiblePaint(fill) ? colorToHex(fill) : null,
    fillOpacity: isVisiblePaint(fill)
      ? (Number.isFinite(fillOpacity) ? clampPct(fillOpacity * 100) : 100)
      : 0,
    width: Number.isFinite(Number(style.lineThickness)) ? Number(style.lineThickness) : null,
    lineStyle: ['dashed', 'dotted', 'cloud'].includes(style.lineStyle) ? style.lineStyle : 'solid',
    // w43: a clouded callout text box carries its own bump size.
    cloudIntensity: style.lineStyle === 'cloud' ? (Number(style.cloudIntensity) || 2) : null,
    arrowheadStyle: style.arrowheadStyle || null,
  };
}

const CALLOUT_CAPABILITIES = Object.freeze({
  // w43: Cloud clouds the callout's TEXT BOX only; the leader stays straight.
  stroke: true, fill: true, width: true, lineStyle: true, cloud: true, arrowheads: true,
});

/**
 * Rebuilds a native ink outline at `width` (drawn units). Returns the patched
 * object, or null when the mark cannot be rebuilt (see canRebuildInkWidth).
 */
export function rebuildInkAtWidth(annotation, width) {
  if (!canRebuildInkWidth(annotation)) return null;
  const drawn = Number(width);
  if (!Number.isFinite(drawn) || drawn <= 0) return null;
  const isHighlighter = annotation.tool === 'highlighter' || annotation.data?.tool === 'highlighter';
  // The highlighter tool never draws thinner than 8 (buildFreehandCommitJSON).
  const drawnWidth = isHighlighter ? Math.max(8, drawn) : drawn;
  const localWidth = drawnWidth / inkDrawScale(annotation);
  // Already that wide (a highlighter asked for less than 8): nothing to write.
  if (Math.abs(localWidth - Number(annotation.sourceWidth)) < 1e-9) return null;
  // The same pipeline and settings the stroke was drawn with (the pen commit
  // passes no sloppiness, i.e. 0; a stored one is honoured).
  const sloppiness = Number(annotation.sloppiness ?? annotation.data?.sloppiness) || 0;
  const ink = createInkAnnotation(annotation.paperCenterline, {
    id: annotation.id,
    color: annotation.fill,
    width: localWidth,
    sloppiness,
  });
  if (!Array.isArray(ink?.cmds) || ink.cmds.length === 0) return null;
  const bounds = boundsOfCommands(ink.cmds);
  return {
    ...annotation,
    path: ink.cmds,
    polygons: ink.polygons,
    sourceWidth: ink.sourceWidth,
    width: bounds.w,
    height: bounds.h,
  };
}

const DASH_FOR_STYLE = {
  dashed: [6, 4],
  dotted: [2, 4],
};

const mergeData = (annotation, dataPatch) => ({
  ...annotation,
  data: { ...(annotation.data || {}), ...dataPatch },
});

/**
 * One bar change applied to one mark. Returns the new object, or null when
 * the mark does not have that property or it already has that value
 * (callers skip nulls, so a no-op never becomes an undo step).
 *
 * change:
 *   { kind: 'strokeColor', color: '#rrggbb' }    keeps the mark's own opacity
 *   { kind: 'strokeOpacity', opacity: 0-100 }    keeps the mark's own colour
 *   { kind: 'fillColor', color } / { kind: 'fillOpacity', opacity }
 *   { kind: 'width', width }
 *   { kind: 'lineStyle', style: 'solid'|'dashed'|'dotted'|'cloud', cloudIntensity }
 *   { kind: 'cloudIntensity', cloudIntensity }
 *   { kind: 'arrowhead', style, bothEnds }
 *   { kind: 'arrowBothEnds', on }
 */
export function applyRestyleChange(annotation, change) {
  if (!annotation || !change) return null;
  const caps = restyleCapabilities(annotation);
  const current = readRestyleStyle(annotation);
  const inkBody = isFilledInkPath(annotation);
  const type = lower(annotation.type);
  switch (change.kind) {
    case 'strokeColor':
    case 'strokeOpacity': {
      if (!caps.stroke) return null;
      const color = change.kind === 'strokeColor' ? colorToHex(change.color) : current.strokeColor;
      if (!color) return null;
      const opacity = change.kind === 'strokeOpacity'
        ? clampPct(change.opacity)
        // A colour picked for a mark whose line is switched off (0%) turns
        // it back on, or picking a colour would look like it did nothing.
        : (current.strokeOpacity > 0 ? current.strokeOpacity : 100);
      if (color === current.strokeColor && opacity === current.strokeOpacity) return null;
      const paint = composeColorForPatch(color, opacity);
      return inkBody ? { ...annotation, fill: paint } : { ...annotation, stroke: paint };
    }
    case 'fillColor':
    case 'fillOpacity': {
      if (!caps.fill) return null;
      const color = change.kind === 'fillColor' ? colorToHex(change.color) : (current.fillColor || '#ffffff');
      if (!color) return null;
      const opacity = change.kind === 'fillOpacity'
        ? clampPct(change.opacity)
        : (current.fillOpacity > 0 ? current.fillOpacity : 100);
      if (color === current.fillColor && opacity === current.fillOpacity) return null;
      const paint = composeColorForPatch(color, opacity);
      return type === 'textbox' ? { ...annotation, backgroundColor: paint } : { ...annotation, fill: paint };
    }
    case 'width': {
      if (!caps.width) return null;
      const width = Number(change.width);
      if (!Number.isFinite(width) || width <= 0) return null;
      if (current.width != null && Math.abs(current.width - width) < 1e-9) return null;
      // An ink width is shown rounded to 0.1: committing the shown value
      // again (a blur with no edit) must not rebuild - and nudge - the stroke.
      if (inkBody && current.width != null && Math.abs(current.width - width) < 0.05) return null;
      if (inkBody) return rebuildInkAtWidth(annotation, width);
      return { ...annotation, strokeWidth: width };
    }
    case 'lineStyle': {
      if (!caps.lineStyle) return null;
      const style = change.style;
      if (style === 'cloud') {
        if (!caps.cloud) return null;
        const intensity = Math.max(1, Number(change.cloudIntensity) || 2);
        if (current.lineStyle === 'cloud' && current.cloudIntensity === intensity) return null;
        return mergeData({ ...annotation, strokeDashArray: null }, { pdfCloudIntensity: intensity });
      }
      if (style !== 'solid' && style !== 'dashed' && style !== 'dotted') return null;
      if (current.lineStyle === style) return null;
      return mergeData(
        { ...annotation, strokeDashArray: DASH_FOR_STYLE[style] || null },
        { pdfCloudIntensity: null },
      );
    }
    case 'cloudIntensity': {
      if (current.lineStyle !== 'cloud') return null;
      const intensity = Math.max(1, Number(change.cloudIntensity) || 2);
      if (current.cloudIntensity === intensity) return null;
      return mergeData(annotation, { pdfCloudIntensity: intensity });
    }
    case 'arrowhead': {
      if (!caps.arrowheads || !change.style) return null;
      const dataPatch = { arrowheadStyle: change.style };
      // bothEnds: true = put the head on the start too, false = end only
      // (the start is left as it is), 'keep' (a group) = each arrow keeps its
      // own ends - one that had the same head on both ends keeps both.
      const mirror = change.bothEnds === 'keep' ? current.arrowBothEnds === true : change.bothEnds === true;
      if (mirror) dataPatch.startArrowheadStyle = change.style;
      const unchanged = annotation.data?.arrowheadStyle === change.style
        && (!mirror || annotation.data?.startArrowheadStyle === change.style);
      return unchanged ? null : mergeData(annotation, dataPatch);
    }
    case 'arrowEnds': {
      // The Arrow ends menu on a group (End / Both / None) in ONE write: an
      // arrow that has no head gets the default one back for End / Both,
      // every other arrow keeps its own head style.
      if (!caps.arrowheads) return null;
      const ends = change.ends;
      if (ends !== 'none' && ends !== 'end' && ends !== 'both') return null;
      const ownHead = annotation.data?.arrowheadStyle || DEFAULT_ARROWHEAD;
      const head = ends === 'none'
        ? NONE_ARROWHEAD
        : (ownHead === NONE_ARROWHEAD ? DEFAULT_ARROWHEAD : ownHead);
      const start = ends === 'both' ? head : NONE_ARROWHEAD;
      if (annotation.data?.arrowheadStyle === head
        && (annotation.data?.startArrowheadStyle ?? NONE_ARROWHEAD) === start) return null;
      return mergeData(annotation, { arrowheadStyle: head, startArrowheadStyle: start });
    }
    case 'arrowBothEnds': {
      if (!caps.arrowheads) return null;
      const endStyle = annotation.data?.arrowheadStyle || DEFAULT_ARROWHEAD;
      const start = change.on ? endStyle : NONE_ARROWHEAD;
      if ((annotation.data?.startArrowheadStyle ?? NONE_ARROWHEAD) === start) return null;
      return mergeData(annotation, { startArrowheadStyle: start });
    }
    default:
      return null;
  }
}

/**
 * The same change as a callout.style patch, or null (no such property / no
 * change). Callouts keep hex colours plus separate 0-1 opacities.
 */
export function calloutRestylePatch(callout, change) {
  if (!callout || !change) return null;
  const style = callout.style || {};
  const current = readCalloutRestyleStyle(callout);
  switch (change.kind) {
    case 'strokeColor': {
      const color = colorToHex(change.color);
      if (!color || color === current.strokeColor) return null;
      return { borderColor: color };
    }
    case 'strokeOpacity': {
      const opacity = clampPct(change.opacity);
      if (opacity === current.strokeOpacity) return null;
      return { borderOpacity: opacity / 100 };
    }
    case 'fillColor': {
      const color = colorToHex(change.color);
      if (!color || (color === current.fillColor && current.fillOpacity > 0)) return null;
      return current.fillOpacity > 0 ? { fillColor: color } : { fillColor: color, fillOpacity: 1 };
    }
    case 'fillOpacity': {
      const opacity = clampPct(change.opacity);
      if (opacity === current.fillOpacity) return null;
      return current.fillColor || opacity === 0
        ? { fillOpacity: opacity / 100 }
        : { fillColor: '#ffffff', fillOpacity: opacity / 100 };
    }
    case 'width': {
      const width = Math.max(1, Number(change.width) || 0);
      if (!Number.isFinite(width) || width === Number(style.lineThickness)) return null;
      return { lineThickness: width };
    }
    case 'lineStyle': {
      const next = change.style;
      if (next === 'cloud') {
        // w43: Cloud on a callout clouds its text box (the leader and head
        // never cloud); it keeps the bump size the bar is showing.
        const intensity = Math.max(1, Number(change.cloudIntensity) || 2);
        if (current.lineStyle === 'cloud' && current.cloudIntensity === intensity) return null;
        return { lineStyle: 'cloud', cloudIntensity: intensity };
      }
      if (next !== 'solid' && next !== 'dashed' && next !== 'dotted') return null;
      if (next === current.lineStyle) return null;
      return { lineStyle: next };
    }
    case 'cloudIntensity': {
      if (current.lineStyle !== 'cloud') return null;
      const intensity = Math.max(1, Number(change.cloudIntensity) || 2);
      if (current.cloudIntensity === intensity) return null;
      return { cloudIntensity: intensity };
    }
    case 'arrowhead': {
      if (!change.style || change.style === style.arrowheadStyle) return null;
      return { arrowheadStyle: change.style };
    }
    default:
      return null;
  }
}

/** The bar's tool for one selected mark (utils/markToolGroup.js owns the mapping). */
export const selectionToolForAnnotation = markToolForAnnotation;

const SAME = Symbol('same');

const agree = (values) => {
  const present = values.filter((value) => value != null);
  if (present.length === 0) return { value: null, mixed: false };
  const first = present[0];
  const mixed = present.some((value) => value !== first) || present.length !== values.length;
  return { value: first, mixed, [SAME]: true };
};

/**
 * What the bar shows for a selection of several marks.
 *
 * members: [{ kind: 'annotation', annotation } | { kind: 'callout', callout }]
 *
 * Returns null for fewer than two restylable members. Otherwise:
 *  - contextTool: the bar layout to show. Every member the same tool -> that
 *    tool; any member with a fill (rectangle, ellipse, polygon, text box,
 *    callout) -> 'rect' (the swatch with Fill / Border tabs); else 'line'
 *    when any member has a line style, else 'pen'.
 *  - capabilities: the union - a control is shown when at least one member
 *    has it, and a change skips members that do not.
 *  - values: the first member (in selection order) that has each property.
 *  - mixed: per property, true when the members that have it disagree.
 */
export function summarizeSelectionRestyle(members) {
  const entries = (members || []).map((member) => {
    if (member?.kind === 'callout' && member.callout) {
      return {
        tool: 'callout',
        caps: CALLOUT_CAPABILITIES,
        style: readCalloutRestyleStyle(member.callout),
      };
    }
    const annotation = member?.annotation;
    const caps = restyleCapabilities(annotation);
    if (!caps.stroke && !caps.fill) return null;
    return {
      tool: selectionToolForAnnotation(annotation),
      caps,
      style: readRestyleStyle(annotation),
    };
  }).filter(Boolean);
  // Two or more marks picked, at least one of them restylable (a counter or
  // a stamp picked with a pen stroke still lets the stroke be restyled).
  if (entries.length < 1 || (members || []).length < 2) return null;
  const capabilities = {
    stroke: false, fill: false, width: false, lineStyle: false, cloud: false, arrowheads: false,
  };
  entries.forEach(({ caps }) => {
    Object.keys(capabilities).forEach((key) => { if (caps[key]) capabilities[key] = true; });
  });
  const tools = new Set(entries.map((entry) => entry.tool));
  let contextTool;
  if (tools.size === 1) contextTool = entries[0].tool;
  else if (capabilities.fill) contextTool = 'rect';
  else if (capabilities.lineStyle) contextTool = 'line';
  else contextTool = 'pen';
  const pick = (key, capKey) => agree(entries
    .filter((entry) => entry.caps[capKey])
    .map((entry) => entry.style[key]));
  const strokeColor = pick('strokeColor', 'stroke');
  const strokeOpacity = pick('strokeOpacity', 'stroke');
  const fillColor = pick('fillColor', 'fill');
  const fillOpacity = pick('fillOpacity', 'fill');
  const width = pick('width', 'width');
  const lineStyle = pick('lineStyle', 'lineStyle');
  const arrowheadStyle = pick('arrowheadStyle', 'arrowheads');
  const arrowBothEnds = pick('arrowBothEnds', 'arrowheads');
  const cloudIntensity = agree(entries
    .filter((entry) => entry.style.lineStyle === 'cloud')
    .map((entry) => entry.style.cloudIntensity));
  return {
    count: entries.length,
    contextTool,
    // w44: the picked marks are of more than one kind (e.g. a pen stroke and
    // a rectangle). The tool bar then borrows no drawing group's tools.
    mixedKinds: tools.size > 1,
    capabilities,
    values: {
      strokeColor: strokeColor.value,
      strokeOpacity: strokeOpacity.value,
      fillColor: fillColor.value,
      fillOpacity: fillOpacity.value,
      width: width.value,
      lineStyle: lineStyle.value,
      cloudIntensity: cloudIntensity.value,
      arrowheadStyle: arrowheadStyle.value,
      arrowBothEnds: arrowBothEnds.value,
    },
    mixed: {
      strokeColor: strokeColor.mixed,
      strokeOpacity: strokeOpacity.mixed,
      fillColor: fillColor.mixed,
      fillOpacity: fillOpacity.mixed,
      width: width.mixed,
      lineStyle: lineStyle.mixed,
      arrowheadStyle: arrowheadStyle.mixed,
      arrowBothEnds: arrowBothEnds.mixed,
    },
  };
}

/**
 * The picked marks as they are NOW: [{ index, annotation }]. A mark picked
 * with an id is found by that id wherever it sits (a collaborator's insert or
 * delete may have moved it); an id-less mark only at its picked index, and
 * only while the object there is still id-less. Marks that are gone drop out,
 * so a change can never land on a mark that was not picked.
 */
export function resolvePickedMembers(objects, indices, ids) {
  if (!Array.isArray(objects) || !Array.isArray(indices)) return [];
  const byId = new Map();
  objects.forEach((object, index) => {
    const id = getAnnotationRenderIdentity(object).annotationId;
    if (id && !byId.has(id)) byId.set(id, index);
  });
  const seen = new Set();
  const members = [];
  indices.forEach((pickedIndex, position) => {
    const id = Array.isArray(ids) ? ids[position] : '';
    let index = -1;
    if (id) {
      index = byId.has(id) ? byId.get(id) : -1;
    } else if (Number.isInteger(pickedIndex) && pickedIndex >= 0 && pickedIndex < objects.length
      && !getAnnotationRenderIdentity(objects[pickedIndex]).annotationId) {
      index = pickedIndex;
    }
    if (index < 0 || seen.has(index) || !objects[index]) return;
    seen.add(index);
    members.push({ index, annotation: objects[index] });
  });
  return members;
}

/**
 * Applies one change to every picked mark on a page. Returns the new page
 * (same shape, new objects array) or null when no mark changed.
 */
export function applyRestyleChangeToPage(pageJSON, members, change) {
  if (!pageJSON || !Array.isArray(pageJSON.objects) || !Array.isArray(members)) return null;
  let objects = null;
  members.forEach(({ index }) => {
    const current = (objects || pageJSON.objects)[index];
    const next = applyRestyleChange(current, change);
    if (!next) return;
    if (!objects) objects = pageJSON.objects.slice();
    objects[index] = next;
  });
  return objects ? { ...pageJSON, objects } : null;
}

/**
 * What one picker write does to a restyle group (the bar's colour / opacity
 * handlers). The picker always sends colour AND opacity together, so the one
 * the user did not touch arrives unchanged: an opacity drag re-sends the
 * shown colour, a colour click re-sends the shown opacity. Re-applying those
 * would flatten a mixed group onto its first member, so an unchanged value is
 * skipped - except a CLICKED colour (picking the colour shown makes a mixed
 * group that one colour) and a drag's release, which must still reach the
 * save path so the drag records its one undo step (a release that changed
 * nothing records none).
 *
 * @returns {{ action: 'skip' } | { action: 'release' } | { action: 'apply', change: object }}
 */
export function resolveGroupPaintWrite(kind, value, previous, phase) {
  const unchanged = String(previous ?? '') === String(value ?? '');
  const isOpacity = kind === 'strokeOpacity' || kind === 'fillOpacity';
  if (unchanged) {
    if (phase === 'commit') return { action: 'release' };
    if (isOpacity || phase) return { action: 'skip' };
  }
  return {
    action: 'apply',
    change: isOpacity ? { kind, opacity: value } : { kind, color: value },
  };
}

/**
 * The pages a group change writes, before anything is saved (pure).
 *
 *  - selection: { pageNumber, indices, ids } - the picked marks (callouts
 *    excluded; they come through calloutIds),
 *  - calloutIds + calloutPageOf(id): the picked callouts and their pages,
 *  - annotationPage(pageJSON, members) -> new page or null,
 *  - calloutStyle(callout, page) -> style patch or null, calloutRefit
 *    optional (callout, page, stylePatch) -> callout,
 *  - deriveCallouts / applyCalloutList: the callout <-> page bridge,
 *  - release: a drag's release - every page the group lives on is written
 *    even if unchanged, so the drag's baseline resolves into its one step.
 *
 * @returns {{ nextPages: Map<number, object>, groupPages: number[] }}
 */
export function planGroupUpdate({
  byPage,
  selection = null,
  calloutIds = [],
  calloutPageOf = () => null,
  annotationPage,
  calloutStyle,
  calloutRefit = null,
  deriveCallouts,
  applyCalloutList,
  pageSizes = {},
  release = false,
}) {
  const pageOf = (page) => byPage?.[page] || byPage?.[String(page)] || null;
  const nextPages = new Map();
  const groupPages = new Set();
  if (selection && typeof annotationPage === 'function') {
    const page = Number(selection.pageNumber);
    const pageJSON = pageOf(page);
    if (pageJSON && Array.isArray(pageJSON.objects)) {
      groupPages.add(page);
      const members = resolvePickedMembers(pageJSON.objects, selection.indices, selection.ids)
        .filter(({ annotation }) => annotation?.data?.type !== 'callout');
      const next = annotationPage(pageJSON, members);
      if (next) nextPages.set(page, next);
    }
  }
  if (calloutIds.length > 0 && typeof calloutStyle === 'function') {
    const ids = new Set(calloutIds);
    const pages = new Set(calloutIds.map((id) => Number(calloutPageOf(id))).filter(Number.isFinite));
    pages.forEach((page) => {
      groupPages.add(page);
      const basePage = nextPages.get(page) || pageOf(page);
      if (!basePage) return;
      const single = { [page]: basePage };
      let changed = false;
      const list = deriveCallouts(single).map((callout) => {
        if (!callout || !ids.has(callout.id)) return callout;
        const stylePatch = calloutStyle(callout, page);
        if (!stylePatch) return callout;
        changed = true;
        const patched = { ...callout, style: { ...(callout.style || {}), ...stylePatch } };
        return typeof calloutRefit === 'function' ? (calloutRefit(patched, page, stylePatch) || patched) : patched;
      });
      if (!changed) return;
      const nextByPage = applyCalloutList(single, list, pageSizes || {});
      const next = nextByPage[page] ?? nextByPage[String(page)];
      if (next) nextPages.set(page, next);
    });
  }
  if (release) {
    groupPages.forEach((page) => {
      if (!nextPages.has(page) && pageOf(page)) nextPages.set(page, { ...pageOf(page) });
    });
  }
  return { nextPages, groupPages: [...groupPages].sort((a, b) => a - b) };
}

/**
 * How a planned group change is written - the ONE-undo-step rule (pure; the
 * viewer's applyGroupUpdate runs exactly this):
 *  - the group lives on one page: plain page saves ({ kind: 'saves' }); the
 *    viewer's save path turns a slider drag into one step on that page,
 *  - it spans pages: ONE document transaction. A drag frame records no step
 *    (skipHistory) and grows the drag's baseline; the release records one
 *    step from that baseline; a release that changed nothing records none.
 *
 * `buildDocumentAction(previousByPage, nextByPage)` builds the step
 * (textMarkupGroupTransactions buildTextMarkupDocumentAction in the viewer).
 * `baseline` is the drag's Map (mutated on frames).
 */
export function resolveGroupWrite({ byPage, plan, phase, baseline, buildDocumentAction }) {
  const { nextPages, groupPages } = plan;
  if (groupPages.length <= 1) {
    return { kind: 'saves', saves: [...nextPages.entries()] };
  }
  if (nextPages.size === 0) return { kind: 'none' };
  const nextByPage = { ...(byPage || {}) };
  nextPages.forEach((pageJSON, page) => {
    nextByPage[byPage?.[page] ? page : String(page)] = pageJSON;
  });
  // The step is built from the group's pages only: comparing every page of a
  // big document on each drag frame would stall the slider.
  const onGroupPages = (source) => {
    const out = {};
    groupPages.forEach((page) => {
      const key = source?.[page] ? page : String(page);
      if (source?.[key]) out[key] = source[key];
    });
    return out;
  };
  const actionOn = (previous, next) => buildDocumentAction(onGroupPages(previous), onGroupPages(next));
  const isPreview = phase === 'preview' || phase === 'settle';
  if (isPreview) {
    recordDragBaseline(baseline, byPage, nextPages);
    const frameAction = actionOn(byPage, nextByPage);
    return frameAction
      ? { kind: 'transaction', action: frameAction, nextByPage, skipHistory: true }
      : { kind: 'none' };
  }
  const previousByPage = phase === 'commit'
    ? restoreDragBaseline(byPage, groupPages, baseline)
    : byPage;
  const action = actionOn(previousByPage, nextByPage);
  if (action) return { kind: 'transaction', action, nextByPage, skipHistory: false };
  // A release back on the starting paint: show it (the last frame may still
  // be on screen), record nothing.
  const showAction = actionOn(byPage, nextByPage);
  return showAction
    ? { kind: 'transaction', action: showAction, nextByPage, skipHistory: true }
    : { kind: 'none' };
}

/**
 * A group drag's baseline, one frame at a time, per object (`page:id`) and
 * per top-level FIELD: the first time a frame changes a field of an object,
 * that field's value from before the frame (= before the drag) is kept.
 * Mutates and returns `baseline`.
 */
export function recordDragBaseline(baseline, byPage, nextPages) {
  nextPages.forEach((next, page) => {
    const current = byPage?.[page] || byPage?.[String(page)];
    const currentById = new Map((current?.objects || [])
      .map((object) => [getAnnotationRenderIdentity(object).annotationId, object]));
    (next?.objects || []).forEach((object) => {
      const id = getAnnotationRenderIdentity(object).annotationId;
      const before = id ? currentById.get(id) : null;
      if (!before || before === object) return;
      const key = `${page}:${id}`;
      const fields = baseline.get(key) || {};
      new Set([...Object.keys(before), ...Object.keys(object)]).forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(fields, field)) return;
        if (before[field] === object[field]) return;
        if (JSON.stringify(before[field]) === JSON.stringify(object[field])) return;
        fields[field] = { value: before[field], present: Object.prototype.hasOwnProperty.call(before, field) };
      });
      baseline.set(key, fields);
    });
  });
  return baseline;
}

/**
 * The document as it was before a group drag, for the drag's ONE undo step:
 * the current pages with only the FIELDS the drag changed put back to their
 * pre-drag values - a collaborator's mid-drag edit to anything else (another
 * mark, or another field of a picked mark, e.g. moving it) stays out of this
 * user's step.
 */
export function restoreDragBaseline(byPage, pages, baseline) {
  const previous = { ...(byPage || {}) };
  (pages || []).forEach((page) => {
    const key = byPage?.[page] ? page : String(page);
    const current = byPage?.[key];
    if (!current || !Array.isArray(current.objects)) return;
    let touched = false;
    const objects = current.objects.map((object) => {
      const id = getAnnotationRenderIdentity(object).annotationId;
      const fields = id ? baseline?.get(`${page}:${id}`) : null;
      if (!fields) return object;
      touched = true;
      const restored = { ...object };
      Object.entries(fields).forEach(([field, { value, present }]) => {
        if (present) restored[field] = value;
        else delete restored[field];
      });
      return restored;
    });
    if (touched) previous[key] = { ...current, objects };
  });
  return previous;
}

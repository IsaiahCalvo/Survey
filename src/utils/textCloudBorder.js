// textCloudBorder.js — the revision-cloud BORDER of a text box or a callout's
// text box (w43, 2026-09-26, owner request: "text boxes and callouts must
// allow line style Cloud for the box border").
//
// There is still exactly ONE cloud: the house v17 engine behind
// resolveAnnotationCloudSpec / resolveCloudAnnotationGeometry
// (tests/revisionCloudGeometryParity.test.mjs). A clouded box border is that
// engine's RECTANGLE cloud, fed a rect STAND-IN built here with the box's own
// frame, border paint and fill, so every render path (SVG, canvas painter,
// PDF /AP, print flatten) draws the box cloud with the code it already uses
// for a clouded rectangle, byte for byte.
//
// Why a stand-in rather than teaching the shape map about 'textbox':
//  * on a text box `fill` is the TEXT colour (the box fill is backgroundColor)
//    and every cloud path reads `fill` as the cloud's fill;
//  * a callout is not a page shape at all (normalised coordinates, own style);
//  * hit testing, handles and vertex drags all key off the shape map, and a
//    text box must keep selecting by its whole box, not only by its scallops.
//
// Storage:
//  * text box — data.pdfCloudIntensity, the same field a clouded shape uses
//    (so the toolbar restyle code, sync and the PDF metadata round trip
//    already carry it);
//  * callout — style.lineStyle 'cloud' + style.cloudIntensity. Only the BOX
//    clouds: the leader line and its arrowhead always stay a straight line and
//    a head (calloutLineDashArray gives no dash for 'cloud').

import { toolSupportsCloudBorderStyle } from './pdfAnnotationAppearance.js';

const TEXT_CLOUD_TOOLS = new Set(['text', 'textbox', 'callout']);

const num = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export const DEFAULT_TEXT_CLOUD_INTENSITY = 2;

const clampIntensity = (value) => Math.max(1, Math.min(20, num(value, DEFAULT_TEXT_CLOUD_INTENSITY) || DEFAULT_TEXT_CLOUD_INTENSITY));

/** The cloud bump size of a clouded text box, or null when its border is not a cloud. */
export function textboxCloudIntensity(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (String(obj.type || '').toLowerCase() !== 'textbox') return null;
  const raw = obj.data?.pdfCloudIntensity;
  if (raw == null || raw === '') return null;
  const intensity = Number(raw);
  return Number.isFinite(intensity) ? clampIntensity(intensity) : null;
}

/** The cloud bump size of a callout whose text box is clouded, or null. */
export function calloutCloudIntensity(callout) {
  const style = callout?.style;
  if (!style || style.lineStyle !== 'cloud') return null;
  return clampIntensity(style.cloudIntensity);
}

/**
 * The rect stand-in for a clouded text box border. `bounds` optionally
 * overrides the box (live editing / creation previews pass the live box);
 * otherwise the stored width/height x scale is used, exactly as renderText
 * sizes the plain border rect. Returns null when the border is not a cloud or
 * would not be painted (no stroke width / colour - the plain branch draws no
 * border either).
 */
export function textboxCloudStandIn(obj, bounds = null) {
  const intensity = textboxCloudIntensity(obj);
  if (intensity == null) return null;
  const strokeWidth = num(obj.strokeWidth);
  if (!(strokeWidth > 0) || !obj.stroke) return null;
  const width = bounds && num(bounds.width) > 0
    ? num(bounds.width)
    : Math.abs(num(obj.width) * (num(obj.scaleX, 1) || 1));
  const height = bounds && num(bounds.height) > 0
    ? num(bounds.height)
    : Math.abs(num(obj.height) * (num(obj.scaleY, 1) || 1));
  if (!(width > 0) || !(height > 0)) return null;
  const background = obj.backgroundColor && obj.backgroundColor !== 'transparent'
    ? obj.backgroundColor
    : 'transparent';
  return {
    type: 'rect',
    id: obj.id,
    left: bounds && Number.isFinite(Number(bounds.left)) ? Number(bounds.left) : num(obj.left),
    top: bounds && Number.isFinite(Number(bounds.top)) ? Number(bounds.top) : num(obj.top),
    width,
    height,
    scaleX: 1,
    scaleY: 1,
    angle: num(obj.angle),
    stroke: obj.stroke,
    strokeWidth,
    fill: background,
    opacity: obj.opacity ?? 1,
    data: { pdfCloudIntensity: intensity },
  };
}

// '#rgb' / '#rrggbb' / 'rgb()' / 'rgba()' with an extra alpha multiplied in.
export function colorWithAlpha(color, alpha = 1) {
  const a = Math.max(0, Math.min(1, num(alpha, 1)));
  if (!color || color === 'transparent' || color === 'none') return 'transparent';
  const text = String(color).trim();
  let match = /^#([0-9a-f]{3})$/i.exec(text);
  if (match) {
    const [r, g, b] = match[1].split('').map((c) => parseInt(c + c, 16));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(text);
  if (match) {
    const hex = match[1];
    const base = match[2] ? parseInt(match[2], 16) / 255 : 1;
    return `rgba(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)}, ${base * a})`;
  }
  match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(text);
  if (match) {
    const base = match[4] != null ? num(match[4], 1) : 1;
    return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${base * a})`;
  }
  return text;
}

/**
 * The rect stand-in for a clouded callout's text box. `box` is the VISIBLE
 * box in page units - {x, y, width, height} with the descender buffer already
 * added, exactly the rect renderCallout draws. `paint` carries the box
 * border's colour and width and its fill (already combined with the fill
 * opacity); the callout's overall opacity is applied by each renderer the way
 * it applies it to the plain box. Returns null when the callout is not
 * clouded.
 */
export function calloutBoxCloudStandIn(callout, box, paint = {}) {
  const intensity = calloutCloudIntensity(callout);
  if (intensity == null || !box) return null;
  const width = num(box.width);
  const height = num(box.height);
  if (!(width > 0) || !(height > 0)) return null;
  return {
    type: 'rect',
    id: callout.id,
    left: num(box.x),
    top: num(box.y),
    width,
    height,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    stroke: paint.stroke || '#1e293b',
    strokeWidth: Math.max(0.1, num(paint.strokeWidth, 1)),
    fill: paint.fill || 'transparent',
    opacity: paint.opacity ?? 1,
    data: { pdfCloudIntensity: intensity },
  };
}

/**
 * Whether the Style picker offers Cloud for this tool / selected mark type:
 * every cloud SHAPE (toolSupportsCloudBorderStyle) plus, since w43, the text
 * box and the callout, whose BOX border clouds. Kept separate from
 * toolSupportsCloudBorderStyle, which answers the different question "is this
 * a cloud-shaped mark" and drives hit testing, handles and paint preferences.
 */
export function toolOffersCloudLineStyle(tool) {
  const key = String(tool || '').toLowerCase();
  return TEXT_CLOUD_TOOLS.has(key) || toolSupportsCloudBorderStyle(key);
}

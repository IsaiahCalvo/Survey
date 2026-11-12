/*
 * Nightly 'link-tool': how a link mark looks. No imports on purpose: the
 * canvas painter runs in a worker and reads this too (linkTool.js has the
 * rest of the rules).
 */
export const LINK_DEFAULT_COLOR = '#0066D4';
const STYLE_IDS = new Set(['box', 'dashed', 'underline', 'none']);

// The see-through fill a link shows on screen (Drawboard: the system
// highlight colour at 30 %). The PDF export draws the border only.
export const LINK_FILL = 'rgba(0, 120, 215, 0.3)';

export const normalizeLinkStyle = (style) => (STYLE_IDS.has(style) ? style : 'box');

export function isLinkMark(obj) {
  const link = obj?.data?.link;
  return Boolean(link) && typeof link === 'object' && String(obj?.type || '').toLowerCase() === 'rect';
}

/**
 * How a link mark paints, in its own box (0,0 to w,h): the fill always, and
 * the border its style asks for. The dash follows the width (4w, 2w), so a
 * width change never leaves a stale dash behind.
 */
export function linkMarkPaint(obj, width, height) {
  const linkStyle = normalizeLinkStyle(obj?.data?.linkStyle);
  const strokeWidth = linkStyle === 'none' ? 0 : Math.max(0, Number(obj?.strokeWidth) || 0);
  return {
    style: linkStyle,
    fill: obj?.fill || LINK_FILL,
    stroke: obj?.stroke || LINK_DEFAULT_COLOR,
    strokeWidth,
    dash: linkStyle === 'dashed' && strokeWidth > 0 ? [strokeWidth * 4, strokeWidth * 2] : null,
    // Underline: one line along the bottom edge only.
    underline: linkStyle === 'underline' ? { x1: 0, y1: height, x2: width, y2: height } : null,
    box: linkStyle === 'box' || linkStyle === 'dashed',
  };
}

/**
 * A link mark as the print draws it: the border only (no fill), as a plain
 * rect the flattener already knows. Underline prints as a thin filled strip
 * along the bottom edge, turned with the mark. Null for style "none".
 */
export function linkMarkForPrint(obj) {
  if (!isLinkMark(obj)) return obj;
  const w = Math.abs((Number(obj.width) || 0) * (Number(obj.scaleX) || 1));
  const h = Math.abs((Number(obj.height) || 0) * (Number(obj.scaleY) || 1));
  const paint = linkMarkPaint(obj, w, h);
  if (!(paint.strokeWidth > 0) || !(w > 0) || !(h > 0)) return null;
  const base = {
    ...obj,
    width: w,
    height: h,
    scaleX: 1,
    scaleY: 1,
    globalCompositeOperation: 'source-over',
    data: { ...(obj.data || {}), link: undefined },
  };
  if (paint.box) {
    return { ...base, fill: 'transparent', stroke: paint.stroke, strokeWidth: paint.strokeWidth, strokeDashArray: paint.dash };
  }
  const sw = paint.strokeWidth;
  const rad = ((Number(obj.angle) || 0) * Math.PI) / 180;
  const cx = (Number(obj.left) || 0) + w / 2;
  const cy = (Number(obj.top) || 0) + h / 2;
  // The strip's middle sits h/2 below the mark's middle, turned with it.
  const mx = cx - (h / 2) * Math.sin(rad);
  const my = cy + (h / 2) * Math.cos(rad);
  return {
    ...base,
    left: mx - w / 2,
    top: my - sw / 2,
    height: sw,
    fill: paint.stroke,
    stroke: 'transparent',
    strokeWidth: 0,
    strokeDashArray: null,
  };
}

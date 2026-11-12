/**
 * dimensionLayout.js — a dimension mark's caption lines, sizes and geometry
 * (Nightly 'measure-plus'). Shared by the SVG renderer, the layer's caption
 * drag target and the canvas painter (thumbnails, zoom proxy, eraser, the
 * flattened print), so every surface draws the same line.
 */
import { buildMeasureLabel } from './measureScale.js';
import {
  dimensionCaptionOffset,
  dimensionCaptionPlace,
  dimensionCaptionPt,
  dimensionCaptionStyle,
  dimensionCaptionWidth,
  dimensionLeader,
  dimensionLineGeometry,
} from './dimensionLine.js';

/** Layout from the mark's endpoints in its own (unturned) frame. */
export function dimensionMarkLayout(obj, { x1, y1, x2, y2 }) {
  const label = buildMeasureLabel(obj, obj.data?.measure?.scale || null);
  const lines = label ? (Array.isArray(label.lines) ? label.lines : [String(label.text)]) : [];
  const fontPt = dimensionCaptionPt(obj);
  const captionWidth = Math.max(0, ...lines.map((line) => dimensionCaptionWidth(line, fontPt)));
  const lineHeight = fontPt * 1.2;
  const captionHeight = lines.length * lineHeight;
  const geo = dimensionLineGeometry({ x1, y1, x2, y2 }, {
    leader: dimensionLeader(obj),
    captionWidth,
    captionHeight,
    place: dimensionCaptionPlace(obj),
    captionOffset: dimensionCaptionOffset(obj),
    turn: obj.angle ?? 0,
  });
  // style: { color (null = the stroke), bg (null = none), bgOpacity }.
  return { label, lines, fontPt, lineHeight, captionWidth, captionHeight, geo, style: dimensionCaptionStyle(obj) };
}

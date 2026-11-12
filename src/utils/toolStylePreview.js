/**
 * toolStylePreview.js — Nightly 'tool-style-preview' (Drawboard PDF Pro push
 * 2026-11-12, the pen panel's live preview): what the armed tool (or the
 * picked mark) will draw, for the desktop colour popover. Returns the props
 * of the phone sheet's <SheetPreview> (mobile/MobileToolSheetControls.jsx),
 * or null for a tool the preview does not draw (text, eraser, text markup).
 * Pure, for tests.
 */

const FILL_SHAPES = new Set(['rect', 'ellipse', 'polygon']);
const STROKES = new Set(['pen', 'highlighter', 'line', 'arrow', 'polyline']);

function hexOf(value, fallback) {
  const source = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(source)) return source;
  if (/^#[0-9a-f]{3}$/i.test(source)) return `#${source.slice(1).split('').map((c) => c + c).join('')}`;
  const rgb = source.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgb) return fallback;
  return `#${rgb.slice(1, 4).map((p) => Math.max(0, Math.min(255, Number(p))).toString(16).padStart(2, '0')).join('')}`;
}

/** `#rrggbb` + opacity 0-100 as an rgba() string. */
export function previewPaint(color, opacity, fallback) {
  const hex = hexOf(color, fallback);
  const a = Math.max(0, Math.min(1, (Number.isFinite(Number(opacity)) ? Number(opacity) : 100) / 100));
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function toolStylePreview(api) {
  if (!api) return null;
  const tool = api.contextTool || api.activeTool;
  if (!FILL_SHAPES.has(tool) && !STROKES.has(tool) && tool !== 'counter') return null;
  const stroke = previewPaint(api.strokeColor, api.strokeOpacity, '#ff0000');
  const fill = previewPaint(api.fillColor, api.fillOpacity, '#ffffff');
  const width = api.strokeWidthInputValue;
  const lineStyle = api.lineBorderStyle === 'cloud' && !api.supportsCloudStyle ? 'solid' : (api.lineBorderStyle || 'solid');
  if (tool === 'counter') return { kind: 'counter', stroke, fill, width };
  if (FILL_SHAPES.has(tool)) return { kind: 'shape', shape: tool, stroke, fill, width, lineStyle };
  return {
    kind: tool === 'line' || tool === 'arrow' ? 'line' : tool === 'polyline' ? 'polyline' : 'stroke',
    stroke,
    width,
    lineStyle: tool === 'pen' || tool === 'highlighter' ? 'solid' : lineStyle,
    arrowhead: tool === 'arrow' ? (api.arrowheadStyle || 'solidTriangle') : 'none',
  };
}

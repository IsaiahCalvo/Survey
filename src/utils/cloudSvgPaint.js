// cloudSvgPaint.js — the ONE description of how a resolved cloud is painted
// as SVG. The on-screen CloudOutline (svgAnnotationRenderers.jsx) maps this
// model to JSX; node tests and the export-fidelity harness serialise the SAME
// model to markup, so what they rasterise is what the page shows.
//
// UX 2026-09-09 (Drawboard/studio parity):
//  * FILL KNOCKOUT — a filled cloud's fill is knocked out under the whole
//    stroke band before the crowns are painted (Drawboard: the fill path
//    carries a mask = the same region filled white with the outline stroked
//    black at the ink width). A translucent stroke therefore composites over
//    the page, never over its own fill: the on-stroke colour equals
//    stroke-over-page everywhere along the band, and the fill alpha stays
//    independent of the stroke alpha. Open polylines never fill.
//  * ONE PATH PER RUN — the studio paints every crown as its own <path>
//    (page.tsx cloud-ink group), so each run composites on its own and a
//    translucent stroke darkens at the run junctions exactly as it does there.
//    The single-path outline stays the hover glow / hit surface.

import { cloudCommandsToPathData, cloudOutlineBounds } from './cloudAnnotationGeometry.js';
import { hasVisibleCloudFill } from './pdfAnnotationAppearance.js';

const num = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const isVisibleStroke = (value) => {
  if (value == null) return false;
  const text = String(value).trim().toLowerCase();
  return text !== '' && text !== 'none' && text !== 'transparent' && hasVisibleCloudFill(text);
};

/**
 * Sanitise a caller-provided id fragment for `url(#…)` (React's useId emits
 * colons, which CSS url() rejects).
 */
export const cloudMaskIdFor = (seed) => `cloud-fill-mask-${String(seed ?? '').replace(/[^a-zA-Z0-9_-]/g, '') || 'x'}`;

/**
 * Resolve the paint model for a cloud geometry.
 *
 * @param {object} geometry  resolveCloudAnnotationGeometry() result
 * @param {{ fill?: string, stroke?: string, maskId?: string }} paint
 * @returns {{
 *   transform: string, strokeWidth: number, stroke: string,
 *   fill: string|null, fillD: string|null,
 *   outlineD: string, runDs: string[],
 *   mask: { id: string, x: number, y: number, width: number, height: number }|null,
 * }|null}
 */
export function buildCloudSvgPaint(geometry, paint = {}) {
  if (!geometry?.outline) return null;
  const strokeWidth = Math.max(0, num(geometry.strokeWidth));
  const stroke = paint.stroke == null || paint.stroke === '' ? 'transparent' : String(paint.stroke);
  const hasStroke = strokeWidth > 0 && isVisibleStroke(stroke);
  const fillPaint = geometry.fill && hasVisibleCloudFill(paint.fill) ? String(paint.fill) : null;
  const fillD = fillPaint ? cloudCommandsToPathData(geometry.fill) : null;
  const runs = Array.isArray(geometry.outlineRuns) && geometry.outlineRuns.length > 0
    ? geometry.outlineRuns
    : [geometry.outline];
  let mask = null;
  if (fillD && hasStroke) {
    // The mask must cover the whole fill plus the stroke band around it
    // (userSpaceOnUse in the cloud's local frame); the default objectBoundingBox
    // region would clip the knockout at the hull.
    const hull = cloudOutlineBounds(geometry);
    const pad = strokeWidth + 2;
    mask = hull
      ? {
        id: paint.maskId || cloudMaskIdFor('static'),
        x: hull.left - pad,
        y: hull.top - pad,
        width: hull.width + pad * 2,
        height: hull.height + pad * 2,
      }
      : null;
  }
  return {
    transform: geometry.transform,
    strokeWidth,
    stroke,
    fill: fillPaint,
    fillD,
    outlineD: cloudCommandsToPathData(geometry.outline),
    runDs: runs.map((run) => cloudCommandsToPathData(run)),
    mask,
  };
}

const fmt = (value) => String(Math.round(Number(value) * 1e4) / 1e4);

/**
 * Serialise the paint model to the exact markup CloudOutline renders (minus
 * React's data-* bookkeeping), for rasterising outside the app.
 */
export function cloudSvgPaintMarkup(model, { opacity = 1, multiply = false } = {}) {
  if (!model) return '';
  // `multiply` mirrors CloudOutline's mix-blend-mode (2026-09-10) so this
  // stand-in stays a faithful transcription of what the app renders.
  const parts = [`<g transform="${model.transform}" opacity="${opacity}"${multiply ? ' style="mix-blend-mode:multiply"' : ''}>`];
  if (model.mask) {
    parts.push(
      `<mask id="${model.mask.id}" maskUnits="userSpaceOnUse" x="${fmt(model.mask.x)}" y="${fmt(model.mask.y)}" width="${fmt(model.mask.width)}" height="${fmt(model.mask.height)}">`
      + `<path d="${model.fillD}" fill="#fff" fill-rule="nonzero" stroke="none"/>`
      + `<path d="${model.outlineD}" fill="none" stroke="#000" stroke-width="${fmt(model.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"/>`
      + '</mask>',
    );
  }
  if (model.fillD) {
    parts.push(
      `<path d="${model.fillD}" fill="${model.fill}" fill-rule="nonzero" stroke="none"${model.mask ? ` mask="url(#${model.mask.id})"` : ''}/>`,
    );
  }
  parts.push(
    `<g fill="none" stroke="${model.stroke}" stroke-width="${fmt(model.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round">`
    + model.runDs.map((d, index) => `<path d="${d}" data-run="${index}"/>`).join('')
    + '</g>',
  );
  parts.push('</g>');
  return parts.join('');
}

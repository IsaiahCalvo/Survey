/**
 * blankPagePaper.js — a paper template's lines on one page (Nightly
 * 'page-templates': "Template page below" in the page menu; Home > New uses
 * the same marks through utils/blankPdf.js).
 *
 * A blank page in the page view carries its paper in `blank.paper`; the PDF
 * writer (utils/pdfPageMutation.js) draws the same marks with pdf-lib, and the
 * page view's stand-in page (utils/pageViewDocument.js) paints them on its
 * canvas, so the page looks the same before and after the reload.
 */

import { isPaperTemplate, templateMarks } from '../home/paperTemplates.js';

/** Line colour (0-1 RGB) and weight (pt) per tone. */
export const PAPER_TONES = Object.freeze({
  rule: Object.freeze({ rgb: [0.72, 0.8, 0.9], thickness: 0.5 }),
  major: Object.freeze({ rgb: [0.48, 0.62, 0.8], thickness: 0.75 }),
  margin: Object.freeze({ rgb: [0.88, 0.45, 0.45], thickness: 0.75 }),
  ink: Object.freeze({ rgb: [0.35, 0.35, 0.38], thickness: 0.6 }),
});
const DOT_PT = 1.6;

/** The template id a new blank page draws, or null (blank, unknown). */
export function pagePaper(id) {
  return typeof id === 'string' && id !== 'blank' && isPaperTemplate(id) ? id : null;
}

/** The marks `paper` puts on a `box` page (PDF space), or []. */
export function pagePaperMarks(paper, box) {
  const id = pagePaper(paper);
  if (!id || !(box?.width > 0) || !(box?.height > 0)) return [];
  return templateMarks(id, { width: box.width, height: box.height });
}

/** Draws the marks on a pdf-lib page. `pdfLib` is { rgb, LineCapStyle }. */
export function drawPaperOnPdfPage(page, marks, { rgb, LineCapStyle }) {
  for (const m of marks || []) {
    const tone = PAPER_TONES[m.tone] || PAPER_TONES.rule;
    const color = rgb(...tone.rgb);
    if (m.kind === 'line') {
      page.drawLine({ start: { x: m.x1, y: m.y1 }, end: { x: m.x2, y: m.y2 }, thickness: tone.thickness, color });
    } else {
      page.drawLine({ start: { x: m.x, y: m.y }, end: { x: m.x, y: m.y }, thickness: DOT_PT, color, lineCap: LineCapStyle.Round });
    }
  }
}

const css = ([r, g, b]) => `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;

/**
 * Paints the marks on a 2D canvas. `transform` maps PDF space to canvas
 * pixels (a pdf.js viewport transform, after any output scale).
 */
export function drawPaperOnCanvas(ctx, marks, transform) {
  if (!ctx || !marks?.length || !Array.isArray(transform)) return;
  ctx.save();
  ctx.setTransform(...transform);
  ctx.lineCap = 'round';
  // Hairlines stay visible when the page is drawn small.
  const pxPerPt = Math.hypot(transform[0], transform[1]) || 1;
  for (const m of marks) {
    const tone = PAPER_TONES[m.tone] || PAPER_TONES.rule;
    ctx.strokeStyle = css(tone.rgb);
    ctx.lineWidth = m.kind === 'line' ? Math.max(tone.thickness, 0.75 / pxPerPt) : DOT_PT;
    ctx.beginPath();
    if (m.kind === 'line') {
      ctx.moveTo(m.x1, m.y1);
      ctx.lineTo(m.x2, m.y2);
    } else {
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x, m.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Multiplies two 2D affine transforms [a, b, c, d, e, f]: first `inner`, then `outer`. */
export function composeTransforms(outer, inner) {
  const [a1, b1, c1, d1, e1, f1] = outer;
  const [a2, b2, c2, d2, e2, f2] = inner;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

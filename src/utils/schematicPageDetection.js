/**
 * Schematic Mode detection (KAL-402 / F12).
 *
 * Decides whether a PDF page is a drawing (a P&ID, one-line, panel schedule,
 * structural sheet, a scan) rather than a text page, using only what pdf.js
 * already gives the viewer: the page's text content and its operator list.
 * No second PDF engine, no pixels.
 *
 *   raster  - a picture covers most of the page and there is little or no
 *             real text on it (a scanned or image-only sheet).
 *   vector  - many drawn paths and only scattered labels (a CAD export).
 *   mixed   - a big picture plus many drawn paths, with only labels.
 *
 * A page with real body text is never a schematic, however many lines it
 * draws. A blank page is never one either.
 *
 * Kept pure (no pdf.js import) so it runs in node tests: the caller passes
 * pdf.js's OPS table. detectSchematicPage() does the pdf.js calls.
 */

/** Tuning. Exported so tests and the fixture probe read the same numbers. */
export const SCHEMATIC_THRESHOLDS = Object.freeze({
  /** Fewer non-space characters than this is "no real text layer". */
  minTextChars: 40,
  /** Text boxes covering at least this share of the page are body text. */
  bodyTextCoverage: 0.08,
  /** Words per 100x100 pt above this read as body text, not labels. */
  bodyTextCharsPer10kPt: 60,
  /** A picture covering this share of the page makes it a raster page. */
  rasterImageCoverage: 0.5,
  /** This many drawn paths make a page a vector drawing. */
  vectorPathCount: 150,
});

const IMAGE_OP_NAMES = [
  'paintImageXObject',
  'paintInlineImageXObject',
  'paintImageXObjectRepeat',
  'paintInlineImageXObjectGroup',
  'paintImageMaskXObject',
  'paintImageMaskXObjectGroup',
  'paintImageMaskXObjectRepeat',
  'paintSolidColorImageMask',
];

const multiply = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

const isMatrix = (value) => (
  value && typeof value.length === 'number' && value.length >= 6
  && Array.from(value).slice(0, 6).every((n) => Number.isFinite(Number(n)))
);

/** Count text characters and the share of the page their boxes cover. */
export function measureTextContent(textContent, pageArea) {
  let chars = 0;
  let area = 0;
  for (const item of textContent?.items || []) {
    const str = String(item?.str || '').replace(/\s/g, '');
    if (!str) continue;
    chars += str.length;
    const width = Math.abs(Number(item.width) || 0);
    const t = item.transform || [];
    const height = Math.abs(Number(item.height) || Math.hypot(Number(t[2]) || 0, Number(t[3]) || 0));
    area += width * height;
  }
  const coverage = pageArea > 0 ? Math.min(1, area / pageArea) : 0;
  const charsPer10kPt = pageArea > 0 ? (chars / pageArea) * 10000 : 0;
  return { chars, coverage, charsPer10kPt };
}

/**
 * Walk the operator list once: count drawn paths, and add up the page area
 * pictures cover (a picture fills the unit square under the current matrix).
 */
export function measureOperatorList(operatorList, ops, pageArea) {
  const fnArray = operatorList?.fnArray || [];
  const argsArray = operatorList?.argsArray || [];
  const imageOps = new Set(IMAGE_OP_NAMES.map((name) => ops?.[name]).filter((id) => id != null));
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let paths = 0;
  let images = 0;
  let imageArea = 0;
  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === ops.save) stack.push(ctm);
    else if (fn === ops.restore) ctm = stack.pop() || ctm;
    else if (fn === ops.transform && args) ctm = multiply(ctm, Array.from(args).map(Number));
    else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      if (isMatrix(args?.[0])) ctm = multiply(ctm, Array.from(args[0]).map(Number));
    } else if (fn === ops.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === ops.constructPath) paths += 1;
    else if (imageOps.has(fn)) {
      images += 1;
      imageArea += Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
    }
  }
  const imageCoverage = pageArea > 0 ? Math.min(1, imageArea / pageArea) : 0;
  return { paths, images, imageCoverage };
}

/** True when the text on a page reads as real body text, not labels. */
export function hasBodyText(text, thresholds = SCHEMATIC_THRESHOLDS) {
  if (!text || text.chars < thresholds.minTextChars) return false;
  return text.coverage >= thresholds.bodyTextCoverage
    || text.charsPer10kPt >= thresholds.bodyTextCharsPer10kPt;
}

/**
 * Classify one page from its measurements.
 * @returns {{ schematic: boolean, kind: 'raster'|'vector'|'mixed'|null, reason: string }}
 */
export function classifySchematicPage({ text, drawing }, thresholds = SCHEMATIC_THRESHOLDS) {
  if (hasBodyText(text, thresholds)) return { schematic: false, kind: null, reason: 'body-text' };
  if (!drawing) return { schematic: false, kind: null, reason: 'labels-only-unmeasured' };
  const bigPicture = drawing.imageCoverage >= thresholds.rasterImageCoverage;
  const manyPaths = drawing.paths >= thresholds.vectorPathCount;
  if (bigPicture && manyPaths) return { schematic: true, kind: 'mixed', reason: 'picture-and-paths' };
  if (bigPicture) return { schematic: true, kind: 'raster', reason: 'picture' };
  if (manyPaths) return { schematic: true, kind: 'vector', reason: 'paths' };
  return { schematic: false, kind: null, reason: 'sparse-page' };
}

/**
 * Read one pdf.js page and classify it. The operator list is only read when
 * the text alone does not already show a text page, so text documents pay
 * only for getTextContent.
 */
export async function detectSchematicPage(page, { ops, readTextContent } = {}) {
  const viewport = page.getViewport({ scale: 1 });
  const pageArea = Math.abs(viewport.width * viewport.height);
  const textContent = readTextContent ? await readTextContent(page) : await page.getTextContent();
  const text = measureTextContent(textContent, pageArea);
  if (hasBodyText(text)) return { ...classifySchematicPage({ text }), text, drawing: null };
  // AnnotationMode.DISABLE (0): measure the page's own content, not the
  // markup on top of it, the same mode the viewer paints the page with.
  const operatorList = await page.getOperatorList({ intent: 'display', annotationMode: 0 });
  const drawing = measureOperatorList(operatorList, ops, pageArea);
  return { ...classifySchematicPage({ text, drawing }), text, drawing };
}

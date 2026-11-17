// Smart Fill for a job file's devices (KAL-617, suite spec: "Devices from Plot
// land with Plot's exact tag outline, filled by Smart Fill").
//
// Plot prints each device's Tag inside its tag shape. On arrival Survey looks
// on the page for that exact Tag text and takes the closed shape the PDF draws
// around it, the same shape Smart Fill picks on a tap (smartFillVector.js).
// When the Tag is not printed on its own (a grouped label such as "ACP-1-01
// to ACP-1-04", outlined fonts, a scan), the device lands as a dot where Plot
// put it, like a Walkthru node, and the field can Smart Fill it by hand. The
// shape under the device's own spot is not used: in Plot that is the device
// symbol, not its tag.
//
// Plain rules only: the exact Tag text, else a dot. No guess.

import { extractClosedShapes, pickShapeAtPoint, shapeToPolygon } from '../survey/smartFillVector.js';
import { pageToPoint } from './walkthruHandoff.js';

const norm = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/**
 * Middle of each pdf.js text item, in page units (top-left origin, the page
 * as shown). `viewport` is page.getViewport({ scale: 1 }).
 * @returns {Array<{text:string, x:number, y:number}>}
 */
export function textCenters(items, viewport) {
  const out = [];
  for (const item of items || []) {
    const text = norm(item?.str);
    const m = item?.transform;
    if (!text || !Array.isArray(m) || m.length < 6) continue;
    const [a, b, c, d, e, f] = m.map(Number);
    const along = Math.hypot(a, b) || 1;
    const up = Math.hypot(c, d) || 1;
    const width = Number(item.width) || 0;
    const height = Number(item.height) || up;
    const ux = e + (a / along) * (width / 2) + (c / up) * (height / 2);
    const uy = f + (b / along) * (width / 2) + (d / up) * (height / 2);
    const [x, y] = viewport.convertToViewportPoint(ux, uy);
    if (Number.isFinite(x) && Number.isFinite(y)) out.push({ text, x, y });
  }
  return out;
}

/**
 * The tag outline for one device, or null.
 * @param {object} input
 * @param {Array<object>} input.shapes  extractClosedShapes for the page
 * @param {Array<{text:string,x:number,y:number}>} input.texts  textCenters for the page
 * @param {string|null} input.tag
 * @param {[number, number]|null} input.point  the device's spot, page units;
 *   picks between two prints of the same Tag
 * @returns {{polygon: object, by: 'tag'} | null}
 */
export function pickTagOutline({ shapes = [], texts = [], tag = null, point = null }) {
  const pool = (shapes || []).filter((s) => s && !s.cloud);
  if (!pool.length) return null;
  const wanted = norm(tag);
  if (wanted) {
    const found = [];
    for (const t of texts || []) {
      if (t.text !== wanted) continue;
      const shape = pickShapeAtPoint(pool, { x: t.x, y: t.y });
      if (shape) found.push(shape);
    }
    if (found.length) {
      // The same Tag twice on one page: the one nearest the device's spot.
      if (point && found.length > 1) {
        const dist = (s) => Math.hypot((s.minX + s.maxX) / 2 - point[0], (s.minY + s.maxY) / 2 - point[1]);
        found.sort((p, q) => dist(p) - dist(q));
      }
      return { polygon: shapeToPolygon(found[0]), by: 'tag' };
    }
  }
  return null;
}

/**
 * outlines(blob, nodes) for sendWalkToProject: reads each page that has
 * devices once and returns node -> polygon. Any read that fails leaves those
 * devices as dots.
 * @returns {Promise<Map<object, object>>}
 */
export async function readJobOutlines(blob, nodes, loadPdfjs) {
  const found = new Map();
  const byPage = new Map();
  for (const node of nodes || []) {
    if (node?.node_type_id == null || !Number.isInteger(node.page_index)) continue;
    const pageNodes = byPage.get(node.page_index) || [];
    pageNodes.push(node);
    byPage.set(node.page_index, pageNodes);
  }
  if (!byPage.size) return found;
  const pdfjsLib = await loadPdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  const task = pdfjsLib.getDocument({ data, isEvalSupported: false, verbosity: pdfjsLib.VerbosityLevel.ERRORS });
  try {
    const pdf = await task.promise;
    for (const [pageIndex, pageNodes] of byPage) {
      if (pageIndex + 1 > pdf.numPages) continue;
      try {
        const page = await pdf.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale: 1 });
        // pdf.js AnnotationMode.DISABLE: markups already on the PDF are not the drawing.
        const [ops, text] = await Promise.all([
          page.getOperatorList({ intent: 'display', annotationMode: 0 }),
          page.getTextContent(),
        ]);
        const shapes = extractClosedShapes(ops, pdfjsLib.OPS, viewport.transform);
        const texts = textCenters(text?.items, viewport);
        const size = { width: viewport.width, height: viewport.height, rotation: page.rotate || 0 };
        for (const node of pageNodes) {
          const point = pageToPoint(node.x_pct, node.y_pct, size);
          const hit = pickTagOutline({ shapes, texts, tag: node.title, point });
          if (hit) found.set(node, hit.polygon);
        }
      } catch (error) {
        console.warn('[suite] job file: could not read tag outlines on a page', error);
      }
    }
  } finally {
    try { await task.destroy(); } catch { /* the outlines are already read */ }
  }
  return found;
}

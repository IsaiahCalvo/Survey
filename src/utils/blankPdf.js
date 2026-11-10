/**
 * blankPdf — a new blank document made in the browser (Nightly flag
 * 'new-document', Drawboard PDF Pro trial audit 2026-11-09: Home could only
 * upload, never start a document from nothing).
 *
 * Sizes are in PDF points (72 a inch). A paper (lined, grid, dots) is drawn
 * once on a pattern page and stamped on every page as one shared form, so a
 * 100-page ARCH D grid stays small.
 */

import { templateMarks } from '../home/paperTemplates.js';

const MM = 72 / 25.4;

export const BLANK_PAGE_SIZES = Object.freeze([
  { id: 'letter', label: 'Letter (8.5 × 11 in)', width: 612, height: 792, metric: false },
  { id: 'legal', label: 'Legal (8.5 × 14 in)', width: 612, height: 1008, metric: false },
  { id: 'tabloid', label: 'Tabloid (11 × 17 in)', width: 792, height: 1224, metric: false },
  { id: 'arch-d', label: 'ARCH D (24 × 36 in)', width: 1728, height: 2592, metric: false },
  { id: 'a4', label: 'A4 (210 × 297 mm)', width: 210 * MM, height: 297 * MM, metric: true },
  { id: 'a3', label: 'A3 (297 × 420 mm)', width: 297 * MM, height: 420 * MM, metric: true },
  { id: 'a1', label: 'A1 (594 × 841 mm)', width: 594 * MM, height: 841 * MM, metric: true },
]);

export const BLANK_PAPERS = Object.freeze([
  { id: 'blank', label: 'Blank' },
  { id: 'lined', label: 'Lined' },
  { id: 'grid', label: 'Grid' },
  { id: 'dots', label: 'Dots' },
]);

export const MAX_BLANK_PAGES = 100;

export function clampBlankPages(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MAX_BLANK_PAGES, n);
}

/** Page box for a size id and 'portrait' | 'landscape'. Unknown ids fall back to Letter. */
export function blankPageBox(sizeId, orientation = 'portrait') {
  const size = BLANK_PAGE_SIZES.find((s) => s.id === sizeId) || BLANK_PAGE_SIZES[0];
  const short = Math.min(size.width, size.height);
  const long = Math.max(size.width, size.height);
  return orientation === 'landscape' ? { width: long, height: short } : { width: short, height: long };
}

/** Line or dot spacing: a quarter inch (or 5 mm), doubled on big sheets. */
export function paperSpacing(box, metric = false) {
  const base = metric ? 5 * MM : 18;
  return Math.min(box.width, box.height) > 1000 ? base * 2 : base;
}

/**
 * The marks a paper puts on one page, in PDF space (origin bottom left):
 * { kind: 'line', x1, y1, x2, y2 } or { kind: 'dot', x, y }. Pure, for tests.
 */
export function paperMarks(paper, box, metric = false) {
  if (!box || !(box.width > 0) || !(box.height > 0)) return [];
  const step = paperSpacing(box, metric);
  const marks = [];
  if (paper === 'lined') {
    const margin = step * 4;
    for (let y = box.height - margin; y > step * 2; y -= step * 1.5) {
      marks.push({ kind: 'line', x1: step * 2, y1: y, x2: box.width - step * 2, y2: y });
    }
  } else if (paper === 'grid') {
    for (let x = step; x < box.width; x += step) marks.push({ kind: 'line', x1: x, y1: 0, x2: x, y2: box.height });
    for (let y = step; y < box.height; y += step) marks.push({ kind: 'line', x1: 0, y1: y, x2: box.width, y2: y });
  } else if (paper === 'dots') {
    for (let x = step; x < box.width; x += step) {
      for (let y = step; y < box.height; y += step) marks.push({ kind: 'dot', x, y });
    }
  }
  return marks;
}

/** "Blank document", or "Blank document 2", 3 … when a name is taken (any case). */
export function uniqueDocumentName(base, existingNames = []) {
  const clean = String(base || '').trim() || 'Blank document';
  const taken = new Set(
    Array.from(existingNames || [], (n) => String(n || '').trim().replace(/\.pdf$/i, '').toLowerCase()),
  );
  if (!taken.has(clean.toLowerCase())) return clean;
  for (let i = 2; i < 10000; i += 1) {
    const next = `${clean} ${i}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
  return `${clean} ${Date.now()}`;
}

/**
 * Bytes of a new PDF. `options`: { title, sizeId, orientation, pages, paper }.
 */
export async function buildBlankPdf({ title = 'Blank document', sizeId = 'letter', orientation = 'portrait', pages = 1, paper = 'blank' } = {}) {
  const { PDFDocument, rgb, LineCapStyle } = await import('pdf-lib');
  const box = blankPageBox(sizeId, orientation);
  const metric = Boolean(BLANK_PAGE_SIZES.find((s) => s.id === sizeId)?.metric);
  const count = clampBlankPages(pages);
  const doc = await PDFDocument.create();
  const now = new Date();
  doc.setTitle(String(title || 'Blank document'));
  doc.setCreator('Survey');
  doc.setProducer('Survey');
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  // A paper template from Home > New (flag 'home-templates') has its own
  // marks (home/paperTemplates.js); the four basic papers keep theirs.
  const basic = BLANK_PAPERS.some((p) => p.id === paper);
  const marks = basic ? paperMarks(paper, box, metric) : templateMarks(paper, box, metric);
  let pattern = null;
  if (marks.length) {
    const scratch = await PDFDocument.create();
    const sheet = scratch.addPage([box.width, box.height]);
    const color = rgb(0.72, 0.8, 0.9);
    const tones = {
      rule: { color, thickness: 0.5 },
      major: { color: rgb(0.48, 0.62, 0.8), thickness: 0.75 },
      margin: { color: rgb(0.88, 0.45, 0.45), thickness: 0.75 },
      ink: { color: rgb(0.35, 0.35, 0.38), thickness: 0.6 },
    };
    for (const m of marks) {
      if (m.kind === 'line') {
        const tone = tones[m.tone] || tones.rule;
        sheet.drawLine({ start: { x: m.x1, y: m.y1 }, end: { x: m.x2, y: m.y2 }, thickness: tone.thickness, color: tone.color });
      } else {
        sheet.drawLine({ start: { x: m.x, y: m.y }, end: { x: m.x, y: m.y }, thickness: 1.6, color, lineCap: LineCapStyle.Round });
      }
    }
    pattern = await doc.embedPage(sheet);
  }
  for (let i = 0; i < count; i += 1) {
    const page = doc.addPage([box.width, box.height]);
    if (pattern) page.drawPage(pattern, { x: 0, y: 0, width: box.width, height: box.height });
  }
  return doc.save();
}

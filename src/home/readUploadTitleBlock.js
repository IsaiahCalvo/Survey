// Reads page 1's title block of a PDF being uploaded (Nightly flag
// 'sheet-revisions'). Loaded only when that flag is on. Owns a short-lived
// pdf.js task, like the page-count probe, never a viewer document.
import { displaySheetNumber, readSheetFromFileName, readTitleBlock } from '../utils/titleBlock.js';

// Past this size the file name alone decides: parsing a huge set just for
// one sheet number would hold up the upload.
const MAX_BYTES = 60 * 1024 * 1024;
const TIME_LIMIT_MS = 4000;

/** pdf.js text items of one page, as { str, x, y, w, h } in display space (y down). */
export function textItemsToPieces(items, viewport) {
  const out = [];
  for (const item of items || []) {
    const str = item?.str;
    if (!str || !String(str).trim() || !Array.isArray(item.transform)) continue;
    const [a, b, c, d, e, f] = item.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b) || 1;
    const width = Number(item.width) || 0;
    // Corners of the run in PDF space, then into the shown page.
    const ux = Math.hypot(a, b) ? a / Math.hypot(a, b) : 1;
    const uy = Math.hypot(a, b) ? b / Math.hypot(a, b) : 0;
    const corners = [
      [e, f],
      [e + ux * width, f + uy * width],
      [e - uy * size, f + ux * size],
      [e + ux * width - uy * size, f + uy * width + ux * size],
    ].map(([x, y]) => viewport.convertToViewportPoint(x, y));
    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    out.push({ str: String(str), x, y, w: Math.max(...xs) - x, h: size });
  }
  return out;
}

async function readFirstPage(bytes, loadPdfjs) {
  const pdfjsLib = await loadPdfjs();
  let task;
  try {
    task = pdfjsLib.getDocument({
      isEvalSupported: false,
      data: bytes.slice(0),
      verbosity: pdfjsLib.VerbosityLevel.ERRORS,
      disableAutoFetch: true,
      disableStream: true,
    });
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    return readTitleBlock(textItemsToPieces(content.items, viewport), { width: viewport.width, height: viewport.height });
  } finally {
    try { await task?.destroy(); } catch { /* the reading, or its error, stands */ }
  }
}

/**
 * { sheetNumber, sheetLabel, revision, source } for an upload: the title block first,
 * the file name for whatever it leaves out. Never throws.
 */
export async function readUploadSheet({ bytes, fileName, loadPdfjs }) {
  const fromName = readSheetFromFileName(fileName);
  let fromPage = { sheetNumber: null, sheetLabel: null, revision: null };
  if (bytes?.byteLength && bytes.byteLength <= MAX_BYTES && loadPdfjs) {
    let timer;
    try {
      fromPage = await Promise.race([
        readFirstPage(bytes, loadPdfjs),
        new Promise((resolve) => { timer = setTimeout(() => resolve(fromPage), TIME_LIMIT_MS); }),
      ]);
    } catch (err) {
      console.warn('[sheet-revisions] could not read the title block:', err?.message || err);
    } finally {
      clearTimeout(timer);
    }
  }
  const sheetNumber = fromPage.sheetNumber || fromName.sheetNumber || null;
  return {
    sheetNumber,
    sheetLabel: fromPage.sheetNumber ? (fromPage.sheetLabel || displaySheetNumber(sheetNumber)) : (sheetNumber ? displaySheetNumber(sheetNumber) : null),
    revision: fromPage.revision || fromName.revision || null,
    source: fromPage.sheetNumber ? 'title-block' : (fromName.sheetNumber ? 'file-name' : null),
  };
}

const CROP_WIDTH_PX = 360;
const CROP_TIME_LIMIT_MS = 4000;

// The piece the sheet number came from, to centre the title-block picture on.
function sheetPiece(pieces, reading) {
  if (!reading?.sheetNumber) return null;
  const label = String(reading.sheetLabel || '').trim();
  return pieces.find((p) => label && p.str.trim() === label)
    || pieces.find((p) => p.str.includes(label || '\u0000'))
    || null;
}

async function renderCrop(page, box) {
  if (typeof document === 'undefined' || !box) return null;
  const scale = CROP_WIDTH_PX / box.w;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(box.w * scale));
  canvas.height = Math.max(1, Math.round(box.h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const viewport = page.getViewport({ scale, offsetX: -box.x * scale, offsetY: -box.y * scale });
  const task = page.render({ canvasContext: ctx, viewport });
  let timer;
  try {
    const done = await Promise.race([
      task.promise.then(() => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), CROP_TIME_LIMIT_MS); }),
    ]);
    if (!done) { task.cancel?.(); return null; }
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    clearTimeout(timer);
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Upload review (Nightly flag 'upload-review'): one page of an upload read
 * like readUploadSheet, plus the file's page count and a picture of the
 * page's title block (a JPEG data URL, or null). Never throws.
 * -> { sheetNumber, sheetLabel, revision, source, pageCount, crop }
 */
export async function readUploadPage({ bytes, fileName, loadPdfjs, page: pageNumber = 1, crop = true }) {
  const fromName = pageNumber > 1 ? { sheetNumber: null, revision: null } : readSheetFromFileName(fileName);
  let fromPage = { sheetNumber: null, sheetLabel: null, revision: null };
  let pageCount = null;
  let picture = null;
  if (bytes?.byteLength && bytes.byteLength <= MAX_BYTES && loadPdfjs) {
    let task;
    let timer;
    try {
      const work = (async () => {
        const pdfjsLib = await loadPdfjs();
        task = pdfjsLib.getDocument({
          isEvalSupported: false,
          data: bytes.slice(0),
          verbosity: pdfjsLib.VerbosityLevel.ERRORS,
          disableAutoFetch: true,
          disableStream: true,
        });
        const doc = await task.promise;
        pageCount = doc.numPages;
        const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const pieces = textItemsToPieces(content.items, viewport);
        const size = { width: viewport.width, height: viewport.height };
        fromPage = readTitleBlock(pieces, size);
        if (crop) {
          const { titleBlockCropBox } = await import('./uploadReview.js');
          picture = await renderCrop(page, titleBlockCropBox(size, sheetPiece(pieces, fromPage))).catch(() => null);
        }
      })();
      work.catch(() => {}); // a late failure after the time limit says nothing
      await Promise.race([
        work,
        new Promise((resolve) => { timer = setTimeout(resolve, TIME_LIMIT_MS + (crop ? CROP_TIME_LIMIT_MS : 0)); }),
      ]);
    } catch (err) {
      console.warn('[upload-review] could not read the page:', err?.message || err);
    } finally {
      clearTimeout(timer);
      try { await task?.destroy(); } catch { /* the reading, or its error, stands */ }
    }
  }
  const sheetNumber = fromPage.sheetNumber || fromName.sheetNumber || null;
  return {
    sheetNumber,
    sheetLabel: fromPage.sheetNumber ? (fromPage.sheetLabel || displaySheetNumber(sheetNumber)) : (sheetNumber ? displaySheetNumber(sheetNumber) : null),
    revision: fromPage.revision || fromName.revision || null,
    source: fromPage.sheetNumber ? 'title-block' : (fromName.sheetNumber ? 'file-name' : null),
    pageCount,
    crop: picture,
  };
}

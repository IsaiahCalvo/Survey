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
